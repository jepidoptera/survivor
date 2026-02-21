let lastRenderedMessageHtml = "";
let visibilityMaskGraphics = null;
let visibilityMaskEnabled = false;
let visibilityMaskSources = [];
let activeVisibilityMaskHitboxes = [];
const groundChunkTileSize = 24;
const groundChunkRenderPaddingTiles = 4;
const groundTileOverlapScale = 1.5;
const groundTileFeatherRatio = 0.25;
const groundChunkCacheMaxEntries = 96;
let groundChunkCache = new Map();
let groundChunkLastViewscale = 0;
let spellHoverHighlightSprite = null;
let spellHoverHighlightWallGraphics = null;
let spellHoverHighlightMesh = null;
let placeObjectPreviewSprite = null;
let placeObjectPreviewSpatialMesh = null;
let placeObjectPreviewTexturePath = "";
let placeObjectCenterSnapGuideGraphics = null;
let uiArrowCursorElement = null;
let losGroundMaskGraphics = null;
let losShadowGraphics = null;
let losShadowMaskGraphics = null;
let losObjectTransparencyMaskGraphics = null;
let losObjectTransparencyMaskTexture = null;
let losObjectTransparencyFilter = null;
let losObjectTransparencyMaskWidth = 0;
let losObjectTransparencyMaskHeight = 0;
let losObjectTransparencyMaskPreviewSprite = null;
let losObjectTransparencyMaskPreviewPanel = null;
let indoorGroundTexture = null;
let indoorGroundTextureWidth = 0;
let indoorGroundTextureHeight = 0;
let indoorGroundTextureDirty = false;
let indoorGroundSprite = null;
let indoorMaskGraphics = null;
let indoorObjectLayer = null;
let indoorOverlayWasActive = false;
let indoorCompositeLastRenderMs = 0;
let indoorCompositeLastCameraX = NaN;
let indoorCompositeLastCameraY = NaN;
// Debug/LOS config/state lives in debug.js.
const losNearRevealRadius = 1.0; // Keep a small omnivision pocket around the wizard.
const losMinStaticBrightness = 0.2;
const renderingViewportNodeSampleEpsilon = 1e-4;
let currentLosState = null;
let currentLosVisibleSet = null;
let lastLosWizardX = null;
let lastLosWizardY = null;
let lastLosFacingAngle = null;
let lastLosCandidateCount = -1;
let lastLosCandidateHash = 0;
let lastLosComputeAtMs = 0;
let nextLosObjectId = 1;
let lastRenderFrameMs = 0;
const wallSectionBatchingEnabled = true;
const opaqueDepthMeshEnabled = true;
const defaultWallTexturePath = "/assets/images/walls/stonewall.png";
const defaultWallTextureRepeatsPerMapUnitX = 0.1; // 1 repetition per 2 map units.
const defaultWallTextureRepeatsPerMapUnitY = 0.1; // 1 repetition per 2 map units.
let wallTextureConfigCache = null;
let wallTextureConfigPromise = null;
let opaqueDepthMeshState = null;
const OPAQUE_DEPTH_VS = `
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
const OPAQUE_DEPTH_FS = `
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

function getWallSectionsRendererApi() {
    return (typeof globalThis !== "undefined" && globalThis.WallSectionsRenderer)
        ? globalThis.WallSectionsRenderer
        : null;
}

function getLosVisualSetting(key, fallback) {
    const settings = (typeof LOSVisualSettings !== "undefined") ? LOSVisualSettings : null;
    if (!settings || typeof settings !== "object") return fallback;
    return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
}

function normalizeWallTextureConfigPath(texturePath) {
    if (typeof texturePath !== "string" || texturePath.length === 0) return "";
    const raw = texturePath.split("?")[0].split("#")[0];
    if (raw.startsWith("/")) return raw;
    try {
        if (typeof window !== "undefined" && window.location && window.location.origin) {
            return new URL(raw, window.location.origin).pathname || raw;
        }
    } catch (_) {}
    return raw;
}

function ensureWallTextureConfigLoaded() {
    if (wallTextureConfigCache) return Promise.resolve(wallTextureConfigCache);
    if (wallTextureConfigPromise) return wallTextureConfigPromise;
    const invalidateWallDepthGeometryCaches = () => {
        if (!(map && Array.isArray(map.objects))) return;
        for (let i = 0; i < map.objects.length; i++) {
            const obj = map.objects[i];
            if (!obj) continue;
            if (obj._wallDepthGeometryCache) obj._wallDepthGeometryCache = null;
            if (obj._sectionDepthGeometryCache) obj._sectionDepthGeometryCache = null;
        }
    };
    const rebuildSectionCompositesAfterTextureConfigLoad = () => {
        const wallSections = getWallSectionsRendererApi();
        if (wallSections && typeof wallSections.queueRebuildPass === "function") {
            wallSections.queueRebuildPass(2);
            return;
        }
        if (typeof globalThis !== "undefined" && typeof globalThis.queueWallSectionRebuildPass === "function") {
            globalThis.queueWallSectionRebuildPass(2);
        }
    };
    wallTextureConfigPromise = fetch("/assets/images/walls/items.json", { cache: "no-cache" })
        .then(resp => (resp && resp.ok) ? resp.json() : null)
        .then(doc => {
            const cfg = { byPath: new Map(), byFile: new Map() };
            const items = (doc && Array.isArray(doc.items)) ? doc.items : [];
            for (let i = 0; i < items.length; i++) {
                const entry = items[i];
                if (!entry || typeof entry !== "object") continue;
                const texturePath = normalizeWallTextureConfigPath(entry.texturePath);
                const fallbackRepeat = Number.isFinite(entry.repeatsPerMapUnit)
                    ? Math.max(0.0001, Number(entry.repeatsPerMapUnit))
                    : null;
                const repeatsPerMapUnitX = Number.isFinite(entry.repeatsPerMapUnitX)
                    ? Math.max(0.0001, Number(entry.repeatsPerMapUnitX))
                    : (fallbackRepeat || defaultWallTextureRepeatsPerMapUnitX);
                const repeatsPerMapUnitY = Number.isFinite(entry.repeatsPerMapUnitY)
                    ? Math.max(0.0001, Number(entry.repeatsPerMapUnitY))
                    : (fallbackRepeat || defaultWallTextureRepeatsPerMapUnitY);
                const normalizedEntry = { texturePath, repeatsPerMapUnitX, repeatsPerMapUnitY };
                if (texturePath) cfg.byPath.set(texturePath, normalizedEntry);
                const file = (typeof entry.file === "string" && entry.file.length > 0) ? entry.file : null;
                if (file) cfg.byFile.set(file, normalizedEntry);
            }
            wallTextureConfigCache = cfg;
            invalidateWallDepthGeometryCaches();
            rebuildSectionCompositesAfterTextureConfigLoad();
            return wallTextureConfigCache;
        })
        .catch(() => {
            wallTextureConfigCache = { byPath: new Map(), byFile: new Map() };
            return wallTextureConfigCache;
        })
        .finally(() => {
            wallTextureConfigPromise = null;
        });
    return wallTextureConfigPromise;
}

function getWallTextureConfig(texturePath) {
    if (!wallTextureConfigCache) {
        void ensureWallTextureConfigLoaded();
    }
    const normalized = normalizeWallTextureConfigPath(texturePath || defaultWallTexturePath);
    const file = normalized.split("/").pop() || "";
    const byPath = wallTextureConfigCache && wallTextureConfigCache.byPath ? wallTextureConfigCache.byPath : null;
    const byFile = wallTextureConfigCache && wallTextureConfigCache.byFile ? wallTextureConfigCache.byFile : null;
    const entry = (byPath && byPath.get(normalized))
        || (byFile && byFile.get(file))
        || null;
    return {
        texturePath: (entry && typeof entry.texturePath === "string" && entry.texturePath.length > 0)
            ? entry.texturePath
            : (normalized || defaultWallTexturePath),
        repeatsPerMapUnitX: (entry && Number.isFinite(entry.repeatsPerMapUnitX))
            ? Math.max(0.0001, Number(entry.repeatsPerMapUnitX))
            : defaultWallTextureRepeatsPerMapUnitX,
        repeatsPerMapUnitY: (entry && Number.isFinite(entry.repeatsPerMapUnitY))
            ? Math.max(0.0001, Number(entry.repeatsPerMapUnitY))
            : defaultWallTextureRepeatsPerMapUnitY
    };
}

function ensureOpaqueDepthMeshState() {
    if (!opaqueDepthMeshEnabled || typeof PIXI === "undefined") return null;
    if (opaqueDepthMeshState) return opaqueDepthMeshState;
    opaqueDepthMeshState = new PIXI.State();
    opaqueDepthMeshState.depthTest = true;
    opaqueDepthMeshState.depthMask = true;
    opaqueDepthMeshState.blend = false;
    opaqueDepthMeshState.culling = false;
    return opaqueDepthMeshState;
}

function createOpaqueDepthMesh() {
    if (typeof PIXI === "undefined") return null;
    const state = ensureOpaqueDepthMeshState();
    if (!state) return null;
    const geometry = new PIXI.Geometry()
        .addAttribute("aWorldPosition", new Float32Array(0), 3)
        .addAttribute("aUvs", new Float32Array(0), 2)
        .addIndex(new Uint16Array(0));
    const shader = PIXI.Shader.from(OPAQUE_DEPTH_VS, OPAQUE_DEPTH_FS, {
        uScreenSize: new Float32Array([1, 1]),
        uCameraWorld: new Float32Array([0, 0]),
        uViewScale: 1,
        uXyRatio: 1,
        uDepthRange: new Float32Array([0, 1]),
        uTint: new Float32Array([1, 1, 1, 1]),
        uAlphaCutoff: 0.1,
        uSampler: PIXI.Texture.WHITE
    });
    const mesh = new PIXI.Mesh(geometry, shader, state, PIXI.DRAW_MODES.TRIANGLES);
    mesh.interactive = false;
    mesh.roundPixels = true;
    return mesh;
}

function setOpaqueDepthMeshGeometry(mesh, worldPositions, uvs, indices) {
    if (!mesh || !mesh.geometry) return false;
    const posBuffer = mesh.geometry.getBuffer("aWorldPosition");
    const uvBuffer = mesh.geometry.getBuffer("aUvs");
    const indexBuffer = mesh.geometry.getIndex();
    if (!posBuffer || !uvBuffer || !indexBuffer) return false;
    posBuffer.data = worldPositions;
    uvBuffer.data = uvs;
    indexBuffer.data = indices;
    posBuffer.update();
    uvBuffer.update();
    indexBuffer.update();
    return true;
}

function getDepthMetricRange() {
    const camera = (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
        ? interpolatedViewport
        : viewport;
    const viewportHeight = Number(camera.height) || 30;
    const nearMetric = -Math.max(80, viewportHeight * 0.6);
    const farMetric = Math.max(180, viewportHeight * 2.0 + 80);
    const span = Math.max(1e-4, farMetric - nearMetric);
    return { nearMetric, farMetric, span, invSpan: 1 / span, camera };
}

function appendDepthQuad(builder, p0, p1, p2, p3, uvRect = null) {
    if (!builder || !p0 || !p1 || !p2 || !p3) return;
    const u0 = uvRect && Number.isFinite(uvRect.u0) ? uvRect.u0 : 0;
    const v0 = uvRect && Number.isFinite(uvRect.v0) ? uvRect.v0 : 0;
    const u1 = uvRect && Number.isFinite(uvRect.u1) ? uvRect.u1 : 1;
    const v1 = uvRect && Number.isFinite(uvRect.v1) ? uvRect.v1 : 1;
    const base = builder.vertexCount;
    builder.positions.push(
        p0.x, p0.y, p0.z,
        p1.x, p1.y, p1.z,
        p2.x, p2.y, p2.z,
        p3.x, p3.y, p3.z
    );
    builder.uvs.push(u0, v1, u1, v1, u1, v0, u0, v0);
    builder.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    builder.vertexCount += 4;
}

function appendDepthTriangle(builder, p0, p1, p2, uv0 = null, uv1 = null, uv2 = null) {
    if (!builder || !p0 || !p1 || !p2) return;
    const base = builder.vertexCount;
    builder.positions.push(
        p0.x, p0.y, p0.z,
        p1.x, p1.y, p1.z,
        p2.x, p2.y, p2.z
    );
    builder.uvs.push(
        uv0 && Number.isFinite(uv0.u) ? uv0.u : 0, uv0 && Number.isFinite(uv0.v) ? uv0.v : 1,
        uv1 && Number.isFinite(uv1.u) ? uv1.u : 1, uv1 && Number.isFinite(uv1.v) ? uv1.v : 1,
        uv2 && Number.isFinite(uv2.u) ? uv2.u : 0.5, uv2 && Number.isFinite(uv2.v) ? uv2.v : 0
    );
    builder.indices.push(base, base + 1, base + 2);
    builder.vertexCount += 3;
}

function ensureItemOpaqueDepthMesh(item) {
    if (!item) return null;
    if (item._opaqueDepthMesh && !item._opaqueDepthMesh.destroyed) return item._opaqueDepthMesh;
    const mesh = createOpaqueDepthMesh();
    if (!mesh) return null;
    item._opaqueDepthMesh = mesh;
    return mesh;
}

function removeItemOpaqueDepthMeshFromParent(item) {
    if (!item || !item._opaqueDepthMesh) return;
    if (item._opaqueDepthMesh.parent) {
        item._opaqueDepthMesh.parent.removeChild(item._opaqueDepthMesh);
    }
}

function tintHexToUniform(tintHex, alpha = 1) {
    const t = Number.isFinite(tintHex) ? (tintHex >>> 0) : 0xFFFFFF;
    const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
    return new Float32Array([
        ((t >> 16) & 0xFF) / 255,
        ((t >> 8) & 0xFF) / 255,
        (t & 0xFF) / 255,
        a
    ]);
}

function isAnimalEntity(item) {
    if (!item) return false;
    if (typeof Animal !== "undefined" && item instanceof Animal) return true;
    return false;
}

function isPlacedObjectEntity(item) {
    if (!item) return false;
    return !!(item.isPlacedObject || item.objectType === "placedObject" || item.type === "placedObject");
}

function isLosOccluder(item) {
    if (!item || !item.groundPlaneHitbox) return false;
    if (isAnimalEntity(item)) return false;
    if (item.type === "road") return false;
    if (item.type === "firewall") return false;
    if (item.type === "roof") return false;
    if (
        isPlacedObjectEntity(item) &&
        typeof item.category === "string" &&
        item.category.trim().toLowerCase() === "windows"
    ) return false;
    return true;
}

function isWallMountedPlaceable(item) {
    if (!item) return false;
    const explicitType = (typeof item.type === "string") ? item.type.trim().toLowerCase() : "";
    const isExplicitWindowDoorType = explicitType === "window" || explicitType === "door";
    const isPlacedOrPreview = isPlacedObjectEntity(item) || item.type === "placedObjectPreview" || isExplicitWindowDoorType;
    if (!isPlacedOrPreview) return false;
    const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
    if (category === "windows" || category === "doors") return true;
    return isExplicitWindowDoorType;
}

function getWallMountedDepthBias(item) {
    return isWallMountedPlaceable(item) ? 0.00005 : 0;
}

function getGroundHitboxCenter(hitbox) {
    if (!hitbox) return null;
    if (hitbox.type === "circle" && Number.isFinite(hitbox.x) && Number.isFinite(hitbox.y)) {
        return { x: hitbox.x, y: hitbox.y };
    }
    if (Array.isArray(hitbox.points) && hitbox.points.length >= 3) {
        const cx = hitbox.points.reduce((sum, pt) => sum + pt.x, 0) / hitbox.points.length;
        const cy = hitbox.points.reduce((sum, pt) => sum + pt.y, 0) / hitbox.points.length;
        return { x: cx, y: cy };
    }
    return null;
}

function hitboxContainsWorldPoint(hitbox, x, y) {
    return !!(hitbox && typeof hitbox.containsPoint === "function" && hitbox.containsPoint(x, y));
}

function groundHitboxLikelyIntersectsHitbox(groundHitbox, maskHitbox) {
    if (!groundHitbox || !maskHitbox) return false;
    if (groundHitbox.type === "circle" && Number.isFinite(groundHitbox.x) && Number.isFinite(groundHitbox.y) && Number.isFinite(groundHitbox.radius)) {
        const r = groundHitbox.radius;
        const samples = [
            { x: groundHitbox.x, y: groundHitbox.y },
            { x: groundHitbox.x + r, y: groundHitbox.y },
            { x: groundHitbox.x - r, y: groundHitbox.y },
            { x: groundHitbox.x, y: groundHitbox.y + r },
            { x: groundHitbox.x, y: groundHitbox.y - r }
        ];
        return samples.some(pt => hitboxContainsWorldPoint(maskHitbox, pt.x, pt.y));
    }
    if (Array.isArray(groundHitbox.points) && groundHitbox.points.length >= 3) {
        const pts = groundHitbox.points;
        if (pts.some(pt => hitboxContainsWorldPoint(maskHitbox, pt.x, pt.y))) return true;
        const cx = pts.reduce((sum, pt) => sum + pt.x, 0) / pts.length;
        const cy = pts.reduce((sum, pt) => sum + pt.y, 0) / pts.length;
        return hitboxContainsWorldPoint(maskHitbox, cx, cy);
    }
    const center = getGroundHitboxCenter(groundHitbox);
    return !!(center && hitboxContainsWorldPoint(maskHitbox, center.x, center.y));
}

function ensureIndoorOverlayResources() {
    if (!app || !app.renderer || !gameContainer || typeof PIXI === "undefined") return false;

    const targetWidth = Math.max(1, Math.ceil((app.screen && app.screen.width) ? app.screen.width : (app.renderer.width || 1)));
    const targetHeight = Math.max(1, Math.ceil((app.screen && app.screen.height) ? app.screen.height : (app.renderer.height || 1)));
    if (!indoorGroundTexture || indoorGroundTextureWidth !== targetWidth || indoorGroundTextureHeight !== targetHeight) {
        if (indoorGroundTexture) indoorGroundTexture.destroy(true);
        indoorGroundTexture = PIXI.RenderTexture.create({ width: targetWidth, height: targetHeight });
        indoorGroundTextureWidth = targetWidth;
        indoorGroundTextureHeight = targetHeight;
        indoorGroundTextureDirty = true;
        if (indoorGroundSprite) indoorGroundSprite.texture = indoorGroundTexture;
    }

    if (!indoorGroundSprite) {
        indoorGroundSprite = new PIXI.Sprite(indoorGroundTexture);
        indoorGroundSprite.anchor.set(0, 0);
        indoorGroundSprite.x = 0;
        indoorGroundSprite.y = 0;
        indoorGroundSprite.visible = false;
        gameContainer.addChild(indoorGroundSprite);
    }
    if (!indoorMaskGraphics) {
        indoorMaskGraphics = new PIXI.Graphics();
        indoorMaskGraphics.visible = false;
        gameContainer.addChild(indoorMaskGraphics);
    }
    if (!indoorObjectLayer) {
        indoorObjectLayer = new PIXI.Container();
        indoorObjectLayer.visible = true;
        gameContainer.addChild(indoorObjectLayer);
    }
    indoorGroundSprite.mask = indoorMaskGraphics;
    return true;
}

function drawHitboxMaskToGraphics(hitbox, graphics) {
    if (!hitbox || !graphics) return false;
    let drew = false;
    if (hitbox.type === "circle" && Number.isFinite(hitbox.x) && Number.isFinite(hitbox.y) && Number.isFinite(hitbox.radius)) {
        const center = worldToScreen({ x: hitbox.x, y: hitbox.y });
        graphics.drawEllipse(
            center.x,
            center.y,
            hitbox.radius * viewscale,
            hitbox.radius * viewscale * xyratio
        );
        drew = true;
    } else if (Array.isArray(hitbox.points) && hitbox.points.length >= 3) {
        const points = projectPolygonPointsToScreen(hitbox.points);
        if (points.length >= 3) {
            graphics.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                graphics.lineTo(points[i].x, points[i].y);
            }
            graphics.closePath();
            drew = true;
        }
    }
    return drew;
}

function updateIndoorOverlay(houseHitbox, wizardInsideHouse) {
    if (!ensureIndoorOverlayResources()) return;
    if (!wizardInsideHouse || !houseHitbox) {
        if (indoorGroundSprite) indoorGroundSprite.visible = false;
        if (indoorMaskGraphics) {
            indoorMaskGraphics.clear();
            indoorMaskGraphics.visible = false;
        }
        if (indoorObjectLayer) indoorObjectLayer.visible = false;
        indoorOverlayWasActive = false;
        indoorCompositeLastCameraX = NaN;
        indoorCompositeLastCameraY = NaN;
        return;
    }

    if (indoorMaskGraphics) {
        indoorMaskGraphics.clear();
        indoorMaskGraphics.beginFill(0xffffff, 1);
        const drew = drawHitboxMaskToGraphics(houseHitbox, indoorMaskGraphics);
        indoorMaskGraphics.endFill();
        indoorMaskGraphics.visible = drew;
    }

    const camera = (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
        ? interpolatedViewport
        : viewport;
    const cameraMoved = (
        !Number.isFinite(indoorCompositeLastCameraX) ||
        !Number.isFinite(indoorCompositeLastCameraY) ||
        Math.abs(camera.x - indoorCompositeLastCameraX) > 1e-4 ||
        Math.abs(camera.y - indoorCompositeLastCameraY) > 1e-4
    );
    const shouldRenderComposite = (
        indoorGroundTextureDirty ||
        !indoorOverlayWasActive ||
        cameraMoved
    );

    if (shouldRenderComposite) {
        try {
            app.renderer.render({ container: landLayer, target: indoorGroundTexture, clear: true });
            app.renderer.render({ container: roadLayer, target: indoorGroundTexture, clear: false });
        } catch (e) {
            app.renderer.render(landLayer, indoorGroundTexture, true);
            app.renderer.render(roadLayer, indoorGroundTexture, false);
        }
        indoorCompositeLastRenderMs = (typeof renderNowMs === "number" && Number.isFinite(renderNowMs) && renderNowMs > 0)
            ? renderNowMs
            : performance.now();
        indoorCompositeLastCameraX = camera.x;
        indoorCompositeLastCameraY = camera.y;
        indoorGroundTextureDirty = false;
    }

    indoorGroundSprite.visible = true;
    indoorObjectLayer.visible = true;
    indoorOverlayWasActive = true;

    // Keep indoor composite on top of world layers.
    if (gameContainer && indoorGroundSprite && indoorObjectLayer) {
        gameContainer.setChildIndex(indoorGroundSprite, gameContainer.children.length - 1);
        gameContainer.setChildIndex(indoorObjectLayer, gameContainer.children.length - 1);
    }
}

function routeWizardToIndoorLayer(wizardInsideHouse) {
    if (!wizard) return;
    const targetLayer = (wizardInsideHouse && indoorObjectLayer) ? indoorObjectLayer : characterLayer;
    if (!targetLayer) return;
    const moveToLayer = (displayObj) => {
        if (!displayObj) return;
        if (displayObj.parent !== targetLayer) {
            if (displayObj.parent) displayObj.parent.removeChild(displayObj);
            targetLayer.addChild(displayObj);
        }
    };
    moveToLayer(wizard.shadowGraphics);
    moveToLayer(wizard.pixiSprite);
    moveToLayer(wizard.hatGraphics);
}

function isLosPointVisible(worldX, worldY, slack = 0.05) {
    if (!wizard || !currentLosState) return true;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return true;
    const dx = (map && typeof map.shortestDeltaX === "function")
        ? map.shortestDeltaX(wizard.x, worldX)
        : (worldX - wizard.x);
    const dy = (map && typeof map.shortestDeltaY === "function")
        ? map.shortestDeltaY(wizard.y, worldY)
        : (worldY - wizard.y);
    const distanceToPoint = Math.hypot(dx, dy);
    if (!Number.isFinite(distanceToPoint) || distanceToPoint <= 1e-6) return true;
    if (distanceToPoint <= losNearRevealRadius) return true;

    const bins = Number.isFinite(currentLosState.bins) ? currentLosState.bins : 0;
    const depth = currentLosState.depth;
    if (!bins || !depth || depth.length !== bins) return true;

    let angle = Math.atan2(dy, dx) + Math.PI;
    const twoPi = Math.PI * 2;
    angle = ((angle % twoPi) + twoPi) % twoPi;
    const bin = Math.max(0, Math.min(bins - 1, Math.floor((angle / twoPi) * bins)));
    const nearestDepth = depth[bin];
    if (!Number.isFinite(nearestDepth)) return true;
    return distanceToPoint <= nearestDepth + slack;
}

function getWallVisibleLongEdgeSegment(item) {
    if (!item || item.type !== "wall" || !item.a || !item.b) return null;
    const ax = Number(item.a.x);
    const ay = Number(item.a.y);
    const bx = Number(item.b.x);
    const by = Number(item.b.y);
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 1e-6) return null;

    const wallThickness = Math.max(0.001, Number(item.thickness) || 0.001);
    const halfThickness = wallThickness * 0.5;
    const nx = -dy / len;
    const ny = dx / len;

    const aLeft = { x: ax + nx * halfThickness, y: ay + ny * halfThickness };
    const bLeft = { x: bx + nx * halfThickness, y: by + ny * halfThickness };
    const aRight = { x: ax - nx * halfThickness, y: ay - ny * halfThickness };
    const bRight = { x: bx - nx * halfThickness, y: by - ny * halfThickness };

    // The "visible onscreen" long face is the one with larger world-y average
    // (since screen y increases with world y in this projection).
    let useLeft = ny >= 0;
    if (Math.abs(ny) < 1e-6 && wizard) {
        // Tie-break nearly vertical walls by wizard side-of-wall.
        const midX = (ax + bx) * 0.5;
        const midY = (ay + by) * 0.5;
        const toWizardX = (map && typeof map.shortestDeltaX === "function")
            ? map.shortestDeltaX(midX, wizard.x)
            : (wizard.x - midX);
        const toWizardY = (map && typeof map.shortestDeltaY === "function")
            ? map.shortestDeltaY(midY, wizard.y)
            : (wizard.y - midY);
        const side = toWizardX * nx + toWizardY * ny;
        useLeft = side >= 0;
    }

    return useLeft
        ? { x0: aLeft.x, y0: aLeft.y, x1: bLeft.x, y1: bLeft.y }
        : { x0: aRight.x, y0: aRight.y, x1: bRight.x, y1: bRight.y };
}

function isCurrentlyVisibleByLos(item) {
    if (!item || !item.groundPlaneHitbox || !wizard || !currentLosState) return true;
    if (currentLosVisibleSet && currentLosVisibleSet.has(item)) return true;
    if (item.type === "wall" && item.a && item.b) {
        const visibleEdge = getWallVisibleLongEdgeSegment(item);
        if (visibleEdge) {
            // Sample only along the wall's long span; ignore endpoint caps so
            // touching an attached short end does not mark the whole wall lit.
            const sampleTs = [0.2, 0.35, 0.5, 0.65, 0.8];
            for (let i = 0; i < sampleTs.length; i++) {
                const t = sampleTs[i];
                const sx = visibleEdge.x0 + (visibleEdge.x1 - visibleEdge.x0) * t;
                const sy = visibleEdge.y0 + (visibleEdge.y1 - visibleEdge.y0) * t;
                if (isLosPointVisible(sx, sy, 0.1)) return true;
            }
            return false;
        }
    }
    const center = getGroundHitboxCenter(item.groundPlaneHitbox);
    if (!center) return true;
    return isLosPointVisible(center.x, center.y, 0.05);
}

function getLosCoverageRatio(item, slack = 0.05) {
    if (!item || !wizard || !currentLosState) return 1;
    if (!item.groundPlaneHitbox) return 1;

    if (item._losCoverageCacheState === currentLosState && item._losCoverageCacheFrame === frameCount) {
        const cached = Number(item._losCoverageCacheValue);
        if (Number.isFinite(cached)) return Math.max(0, Math.min(1, cached));
    }

    const bins = Number.isFinite(currentLosState.bins) ? Math.max(1, Math.floor(currentLosState.bins)) : 0;
    const depth = currentLosState.depth;
    if (!bins || !depth || depth.length !== bins) return 1;

    const wx = wizard.x;
    const wy = wizard.y;
    const minAngle = Number.isFinite(currentLosState.minAngle) ? currentLosState.minAngle : -Math.PI;
    const twoPi = Math.PI * 2;
    const angleForBin = idx => minAngle + ((idx + 0.5) / bins) * twoPi;

    let possibleBins = 0;
    let litBins = 0;
    const countBin = (binIdx, t) => {
        if (!Number.isFinite(t) || t < 0) return;
        possibleBins += 1;
        const nearestDepth = depth[binIdx];
        if (Number.isFinite(nearestDepth) && t <= nearestDepth + slack) {
            litBins += 1;
        }
    };

    const hitbox = item.groundPlaneHitbox;
    if (hitbox instanceof CircleHitbox) {
        const cxRaw = hitbox.x;
        const cyRaw = hitbox.y;
        const r = hitbox.radius;
        if (Number.isFinite(cxRaw) && Number.isFinite(cyRaw) && Number.isFinite(r) && r > 0) {
            const dx = (map && typeof map.shortestDeltaX === "function")
                ? map.shortestDeltaX(wx, cxRaw)
                : (cxRaw - wx);
            const dy = (map && typeof map.shortestDeltaY === "function")
                ? map.shortestDeltaY(wy, cyRaw)
                : (cyRaw - wy);
            const cx = wx + dx;
            const cy = wy + dy;
            const centerDist = Math.hypot(dx, dy);
            if (centerDist <= r + 1e-6) {
                // Wizard inside object footprint: object can occupy any LOS bin.
                possibleBins = bins;
                litBins = bins;
            } else {
                const centerAngle = Math.atan2(dy, dx);
                const halfSpan = Math.asin(Math.min(1, r / centerDist));
                const a0 = centerAngle - halfSpan;
                const a1 = centerAngle + halfSpan;
                forEachBinInShortSpan(a0, a1, bins, b => {
                    const theta = angleForBin(b);
                    if (!angleInSpan(theta, a0, a1)) return;
                    const dirX = Math.cos(theta);
                    const dirY = Math.sin(theta);
                    const t = rayCircleDistance(wx, wy, dirX, dirY, cx, cy, r);
                    if (t !== null) countBin(b, t);
                });
            }
        }
    } else if (hitbox instanceof PolygonHitbox && Array.isArray(hitbox.points) && hitbox.points.length >= 2) {
        const points = hitbox.points.map(p => ({
            x: wx + ((map && typeof map.shortestDeltaX === "function") ? map.shortestDeltaX(wx, p.x) : (p.x - wx)),
            y: wy + ((map && typeof map.shortestDeltaY === "function") ? map.shortestDeltaY(wy, p.y) : (p.y - wy))
        }));
        const minDistByBin = new Map();
        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            if (!p1 || !p2) continue;
            const a0 = Math.atan2(p1.y - wy, p1.x - wx);
            const a1 = Math.atan2(p2.y - wy, p2.x - wx);
            forEachBinInShortSpan(a0, a1, bins, b => {
                const theta = angleForBin(b);
                const dirX = Math.cos(theta);
                const dirY = Math.sin(theta);
                const t = raySegmentDistance(wx, wy, dirX, dirY, p1.x, p1.y, p2.x, p2.y);
                if (t === null) return;
                const prev = minDistByBin.get(b);
                if (!Number.isFinite(prev) || t < prev) minDistByBin.set(b, t);
            });
        }
        minDistByBin.forEach((t, b) => countBin(b, t));
    } else {
        const center = getGroundHitboxCenter(hitbox);
        if (center) {
            const dx = (map && typeof map.shortestDeltaX === "function")
                ? map.shortestDeltaX(wx, center.x)
                : (center.x - wx);
            const dy = (map && typeof map.shortestDeltaY === "function")
                ? map.shortestDeltaY(wy, center.y)
                : (center.y - wy);
            const t = Math.hypot(dx, dy);
            const angle = Math.atan2(dy, dx);
            const normalized = ((normalizeAngle(angle) - minAngle) / twoPi);
            const bin = Math.max(0, Math.min(bins - 1, Math.floor((((normalized % 1) + 1) % 1) * bins)));
            countBin(bin, t);
        }
    }

    let ratio = possibleBins > 0 ? (litBins / possibleBins) : (isCurrentlyVisibleByLos(item) ? 1 : 0);
    ratio = Math.max(0, Math.min(1, ratio));
    item._losCoverageCacheState = currentLosState;
    item._losCoverageCacheFrame = frameCount;
    item._losCoverageCacheValue = ratio;
    return ratio;
}

function getLosObjectId(item) {
    if (!item) return 0;
    if (!Number.isInteger(item._losObjectId)) {
        item._losObjectId = nextLosObjectId++;
    }
    return item._losObjectId;
}

function computeLosCandidateHash(candidates) {
    let xor = 0;
    let sum = 0;
    for (let i = 0; i < candidates.length; i++) {
        const id = getLosObjectId(candidates[i]) >>> 0;
        xor = (xor ^ id) >>> 0;
        sum = (sum + ((id * 2654435761) >>> 0)) >>> 0;
    }
    return (xor ^ sum) >>> 0;
}

function getWizardFacingAngleRad() {
    if (!wizard) return 0;
    if (Number.isFinite(wizard.smoothedFacingAngleDeg)) {
        return Number(wizard.smoothedFacingAngleDeg) * (Math.PI / 180);
    }

    // Fallback to sprite row facing when smoothed angle is unavailable.
    if (Number.isInteger(wizard.lastDirectionRow)) {
        const rowAngleDegByDirectionIndex = [180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
        const directionIndex = ((wizard.lastDirectionRow - wizardDirectionRowOffset) % 12 + 12) % 12;
        const deg = rowAngleDegByDirectionIndex[directionIndex];
        if (Number.isFinite(deg)) return deg * (Math.PI / 180);
    }

    return 0;
}

function ensureVisibilityMaskGraphics() {
    if (!visibilityMaskGraphics) {
        visibilityMaskGraphics = new PIXI.Graphics();
        visibilityMaskGraphics.alpha = 0.001;
        app.stage.addChild(visibilityMaskGraphics);
    }
    return visibilityMaskGraphics;
}

function ensureLosGroundMaskGraphics() {
    if (!losGroundMaskGraphics) {
        losGroundMaskGraphics = new PIXI.Graphics();
        losGroundMaskGraphics.visible = false;
        gameContainer.addChild(losGroundMaskGraphics);
    }
    return losGroundMaskGraphics;
}

function ensureLosShadowGraphics() {
    if (!gameContainer) return null;
    if (!losShadowGraphics) {
        losShadowGraphics = new PIXI.Graphics();
        losShadowGraphics.visible = false;
        losShadowGraphics.interactive = false;
        gameContainer.addChild(losShadowGraphics);
    }
    if (losShadowGraphics.mask) {
        losShadowGraphics.mask = null;
    }
    const shadowBlurEnabled = !!getLosVisualSetting("shadowBlurEnabled", true);
    const shadowBlurStrength = Number(getLosVisualSetting("shadowBlurStrength", 12));
    if (shadowBlurEnabled && shadowBlurStrength > 0 && typeof PIXI !== "undefined") {
        if (typeof PIXI.BlurFilter === "function") {
            if (!losShadowGraphics._losBlurFilter || !(losShadowGraphics._losBlurFilter instanceof PIXI.BlurFilter)) {
                losShadowGraphics._losBlurFilter = new PIXI.BlurFilter();
            }
            losShadowGraphics._losBlurFilter.blur = shadowBlurStrength;
            losShadowGraphics.filters = [losShadowGraphics._losBlurFilter];
        } else if (PIXI.filters && typeof PIXI.filters.BlurFilter === "function") {
            if (!losShadowGraphics._losBlurFilter || !(losShadowGraphics._losBlurFilter instanceof PIXI.filters.BlurFilter)) {
                losShadowGraphics._losBlurFilter = new PIXI.filters.BlurFilter();
            }
            losShadowGraphics._losBlurFilter.blur = shadowBlurStrength;
            losShadowGraphics.filters = [losShadowGraphics._losBlurFilter];
        } else {
            losShadowGraphics.filters = null;
        }
    } else {
        losShadowGraphics.filters = null;
    }
    if (losShadowGraphics && losShadowGraphics.parent === gameContainer) {
        // Keep shadow above ground/roads but below non-ground objects.
        const desiredIndex = (roadLayer && roadLayer.parent === gameContainer)
            ? Math.min(gameContainer.children.length - 1, gameContainer.getChildIndex(roadLayer) + 1)
            : Math.max(0, gameContainer.children.length - 1);
        const currentIndex = gameContainer.getChildIndex(losShadowGraphics);
        if (currentIndex !== desiredIndex) {
            gameContainer.setChildIndex(losShadowGraphics, desiredIndex);
        }
    }
    return losShadowGraphics;
}

function ensureLosObjectTransparencyResources() {
    if (!app || !app.renderer || typeof PIXI === "undefined") return false;
    if (!losObjectTransparencyMaskGraphics) {
        losObjectTransparencyMaskGraphics = new PIXI.Graphics();
        losObjectTransparencyMaskGraphics.visible = false;
        losObjectTransparencyMaskGraphics.interactive = false;
    }

    const targetWidth = Math.max(1, Math.ceil((app.screen && app.screen.width) ? app.screen.width : (app.renderer.width || 1)));
    const targetHeight = Math.max(1, Math.ceil((app.screen && app.screen.height) ? app.screen.height : (app.renderer.height || 1)));
    if (
        !losObjectTransparencyMaskTexture ||
        losObjectTransparencyMaskWidth !== targetWidth ||
        losObjectTransparencyMaskHeight !== targetHeight
    ) {
        if (losObjectTransparencyMaskTexture) {
            losObjectTransparencyMaskTexture.destroy(true);
        }
        losObjectTransparencyMaskTexture = PIXI.RenderTexture.create({
            width: targetWidth,
            height: targetHeight
        });
        losObjectTransparencyMaskWidth = targetWidth;
        losObjectTransparencyMaskHeight = targetHeight;
        if (losObjectTransparencyMaskPreviewSprite) {
            losObjectTransparencyMaskPreviewSprite.texture = losObjectTransparencyMaskTexture;
        }
    }

    if (!losObjectTransparencyMaskPreviewSprite) {
        losObjectTransparencyMaskPreviewPanel = new PIXI.Graphics();
        losObjectTransparencyMaskPreviewPanel.interactive = false;
        losObjectTransparencyMaskPreviewPanel.zIndex = 999998;
        losObjectTransparencyMaskPreviewPanel.visible = true;
        losObjectTransparencyMaskPreviewPanel.x = 4;
        losObjectTransparencyMaskPreviewPanel.y = 4;

        losObjectTransparencyMaskPreviewSprite = new PIXI.Sprite(losObjectTransparencyMaskTexture);
        losObjectTransparencyMaskPreviewSprite.anchor.set(0, 0);
        losObjectTransparencyMaskPreviewSprite.x = 8;
        losObjectTransparencyMaskPreviewSprite.y = 8;
        losObjectTransparencyMaskPreviewSprite.alpha = 0.9;
        losObjectTransparencyMaskPreviewSprite.zIndex = 999999;
        if (app.stage && typeof app.stage.sortableChildren === "boolean") {
            app.stage.sortableChildren = true;
        }
        if (app.stage) {
            app.stage.addChild(losObjectTransparencyMaskPreviewPanel);
            app.stage.addChild(losObjectTransparencyMaskPreviewSprite);
        }
    }
    // Keep a readable preview size.
    const previewW = Math.max(200, Math.floor(targetWidth * 0.28));
    const previewH = Math.max(120, Math.floor(targetHeight * 0.28));
    losObjectTransparencyMaskPreviewSprite.width = previewW;
    losObjectTransparencyMaskPreviewSprite.height = previewH;
    const showMaskPreview = !!getLosVisualSetting("objectLitMaskPreview", false);
    losObjectTransparencyMaskPreviewSprite.visible = showMaskPreview;
    if (losObjectTransparencyMaskPreviewPanel) {
        losObjectTransparencyMaskPreviewPanel.clear();
        losObjectTransparencyMaskPreviewPanel.lineStyle(2, 0xff00ff, 1);
        losObjectTransparencyMaskPreviewPanel.beginFill(0x101010, 0.85);
        losObjectTransparencyMaskPreviewPanel.drawRect(0, 0, previewW + 12, previewH + 12);
        losObjectTransparencyMaskPreviewPanel.endFill();
        losObjectTransparencyMaskPreviewPanel.visible = showMaskPreview;
    }

    if (!losObjectTransparencyFilter) {
        const fragment = `
            precision mediump float;
            varying vec2 vTextureCoord;
            uniform sampler2D uSampler;
            uniform sampler2D losMask;
            uniform float litAlpha;
            uniform float shadowOpacity;
            uniform float debugMaskOnly;
            uniform vec2 screenSize;
            void main(void) {
                vec4 color = texture2D(uSampler, vTextureCoord);
                vec2 maskUv = vTextureCoord;
                vec4 maskSample = texture2D(losMask, maskUv);
                float shadowAmountRaw = maskSample.a;
                float shadowAmount = clamp(shadowAmountRaw / max(shadowOpacity, 0.0001), 0.0, 1.0);
                if (debugMaskOnly > 0.5) {
                    gl_FragColor = vec4(vec3(shadowAmount), color.a);
                    return;
                }
                float alphaFactor = mix(litAlpha, 1.0, shadowAmount);
                color.rgb *= alphaFactor;
                color.a *= alphaFactor;
                gl_FragColor = color;
            }
        `;
        try {
            losObjectTransparencyFilter = new PIXI.Filter(undefined, fragment, {
                losMask: losObjectTransparencyMaskTexture,
                litAlpha: 0.5,
                shadowOpacity: 0.4,
                debugMaskOnly: 0,
                screenSize: new Float32Array([targetWidth, targetHeight])
            });
        } catch (err) {
            losObjectTransparencyFilter = null;
            return false;
        }
    } else {
        losObjectTransparencyFilter.uniforms.losMask = losObjectTransparencyMaskTexture;
        losObjectTransparencyFilter.uniforms.screenSize = new Float32Array([targetWidth, targetHeight]);
    }
    return true;
}

function setLosObjectTransparencyFilterEnabled(enabled) {
    if (!objectLayer || !losObjectTransparencyFilter) return;
    const filters = Array.isArray(objectLayer.filters)
        ? objectLayer.filters.filter(Boolean)
        : [];
    const hasFilter = filters.includes(losObjectTransparencyFilter);
    if (enabled) {
        if (!hasFilter) filters.push(losObjectTransparencyFilter);
        objectLayer.filters = filters;
        if (app && app.screen) {
            objectLayer.filterArea = app.screen;
        }
    } else if (hasFilter) {
        const next = filters.filter(f => f !== losObjectTransparencyFilter);
        objectLayer.filters = next.length ? next : null;
    }
}

function updateLosObjectTransparencyMask() {
    const enabled = !!getLosVisualSetting("objectLitTransparencyEnabled", false);
    if (!enabled) {
        setLosObjectTransparencyFilterEnabled(false);
        if (losObjectTransparencyMaskPreviewSprite) {
            losObjectTransparencyMaskPreviewSprite.visible = false;
        }
        if (losObjectTransparencyMaskPreviewPanel) {
            losObjectTransparencyMaskPreviewPanel.visible = false;
        }
        return;
    }
    if (!wizard || !currentLosState || !LOSSystem || typeof LOSSystem.buildPolygonWorldPoints !== "function") {
        setLosObjectTransparencyFilterEnabled(false);
        if (losObjectTransparencyMaskPreviewSprite) {
            losObjectTransparencyMaskPreviewSprite.visible = false;
        }
        if (losObjectTransparencyMaskPreviewPanel) {
            losObjectTransparencyMaskPreviewPanel.visible = false;
        }
        return;
    }
    if (!ensureLosObjectTransparencyResources()) {
        setLosObjectTransparencyFilterEnabled(false);
        if (losObjectTransparencyMaskPreviewSprite) {
            losObjectTransparencyMaskPreviewSprite.visible = false;
        }
        if (losObjectTransparencyMaskPreviewPanel) {
            losObjectTransparencyMaskPreviewPanel.visible = false;
        }
        return;
    }

    const shadowEnabled = !!getLosVisualSetting("shadowEnabled", true);
    if (!shadowEnabled) {
        setLosObjectTransparencyFilterEnabled(false);
        if (losObjectTransparencyMaskPreviewSprite) {
            losObjectTransparencyMaskPreviewSprite.visible = false;
        }
        if (losObjectTransparencyMaskPreviewPanel) {
            losObjectTransparencyMaskPreviewPanel.visible = false;
        }
        return;
    }

    const litAlphaRaw = Number(getLosVisualSetting("objectLitAlpha", 0.5));
    const litAlpha = Number.isFinite(litAlphaRaw) ? Math.max(0, Math.min(1, litAlphaRaw)) : 0.5;
    const shadowOpacityRaw = Number(getLosVisualSetting("shadowOpacity", 0.4));
    const shadowOpacity = Number.isFinite(shadowOpacityRaw) ? Math.max(0.0001, Math.min(1, shadowOpacityRaw)) : 0.4;
    const debugMaskOnly = !!getLosVisualSetting("objectLitMaskDebugOnly", false);
    losObjectTransparencyFilter.uniforms.losMask = losObjectTransparencyMaskTexture;
    losObjectTransparencyFilter.uniforms.litAlpha = litAlpha;
    losObjectTransparencyFilter.uniforms.shadowOpacity = shadowOpacity;
    losObjectTransparencyFilter.uniforms.debugMaskOnly = debugMaskOnly ? 1 : 0;
    const existingScreenSize = losObjectTransparencyFilter.uniforms.screenSize;
    if (existingScreenSize && existingScreenSize.length >= 2) {
        existingScreenSize[0] = losObjectTransparencyMaskWidth;
        existingScreenSize[1] = losObjectTransparencyMaskHeight;
    } else {
        losObjectTransparencyFilter.uniforms.screenSize = new Float32Array([
            losObjectTransparencyMaskWidth,
            losObjectTransparencyMaskHeight
        ]);
    }

    const graphics = losObjectTransparencyMaskGraphics;
    graphics.clear();
    // Source the mask from the already-rendered LOS shadow graphics to ensure
    // exact shape/placement parity with what appears on screen.
    const sourceMask = (losShadowGraphics && losShadowGraphics.visible) ? losShadowGraphics : graphics;
    try {
        // Pixi v8 signature.
        app.renderer.render({
            container: sourceMask,
            target: losObjectTransparencyMaskTexture,
            clear: true
        });
    } catch (e) {
        // Pixi v7 and older signature fallback.
        app.renderer.render(sourceMask, losObjectTransparencyMaskTexture, true);
    }
    const showMaskPreview = !!getLosVisualSetting("objectLitMaskPreview", false);
    if (losObjectTransparencyMaskPreviewSprite) {
        losObjectTransparencyMaskPreviewSprite.visible = showMaskPreview;
    }
    if (losObjectTransparencyMaskPreviewPanel) {
        losObjectTransparencyMaskPreviewPanel.visible = showMaskPreview;
    }
    setLosObjectTransparencyFilterEnabled(true);
}

function applyLosGroundMask() {
    if (!landLayer) return;
    if (!getLosVisualSetting("groundMaskEnabled", false)) {
        landLayer.mask = null;
        if (losGroundMaskGraphics) {
            losGroundMaskGraphics.clear();
            losGroundMaskGraphics.visible = false;
        }
        return;
    }
    if (!wizard || !currentLosState || !LOSSystem || typeof LOSSystem.buildPolygonWorldPoints !== "function") {
        landLayer.mask = null;
        if (losGroundMaskGraphics) {
            losGroundMaskGraphics.clear();
            losGroundMaskGraphics.visible = false;
        }
        return;
    }
    const graphics = ensureLosGroundMaskGraphics();
    graphics.clear();
    const farDist = Math.max(viewport.width, viewport.height) * 1.5;
    graphics.beginFill(0xffffff, 1);
    const worldPoints = LOSSystem.buildPolygonWorldPoints(wizard, currentLosState, farDist);
    if (Array.isArray(worldPoints) && worldPoints.length >= 3) {
        const screenPoints = worldPoints.map(pt => worldToScreen(pt));
        graphics.moveTo(screenPoints[0].x, screenPoints[0].y);
        for (let i = 1; i < screenPoints.length; i++) {
            graphics.lineTo(screenPoints[i].x, screenPoints[i].y);
        }
        graphics.closePath();
    }
    const wizardScreen = worldToScreen(wizard);
    const radiusX = losNearRevealRadius * viewscale;
    const radiusY = losNearRevealRadius * viewscale * xyratio;
    graphics.drawEllipse(wizardScreen.x, wizardScreen.y, radiusX, radiusY);
    graphics.endFill();
    graphics.visible = true;
    landLayer.mask = graphics;
}

function applyLosShadow() {
    const graphics = ensureLosShadowGraphics();
    if (!graphics) return;
    graphics.clear();

    const shadowEnabled = !!getLosVisualSetting("shadowEnabled", true);
    const shadowOpacityRaw = Number(getLosVisualSetting("shadowOpacity", 0.4));
    const shadowOpacity = Number.isFinite(shadowOpacityRaw) ? Math.max(0, Math.min(1, shadowOpacityRaw)) : 0.4;
    if (!shadowEnabled || shadowOpacity <= 0) {
        graphics.visible = false;
        return;
    }
    if (!wizard || !currentLosState || !currentLosState.depth || !Number.isFinite(currentLosState.bins)) {
        graphics.visible = false;
        return;
    }

    const bins = Math.max(3, Math.floor(currentLosState.bins));
    const depth = currentLosState.depth;
    if (!depth || depth.length !== bins) {
        graphics.visible = false;
        return;
    }

    const minAngle = Number.isFinite(currentLosState.minAngle) ? currentLosState.minAngle : -Math.PI;
    const twoPi = Math.PI * 2;
    const farDist = Math.max(viewport.width, viewport.height) * 1.5;
    const angleForBin = idx => minAngle + ((idx + 0.5) / bins) * twoPi;
    const wizardScreen = worldToScreen(wizard);
    const scaleX = viewscale;
    const scaleY = viewscale * xyratio;
    const wizardScreenX = wizardScreen.x;
    const wizardScreenY = wizardScreen.y;
    graphics.visible = true;
    graphics.lineStyle(0);
    const shadowColorRaw = Number(getLosVisualSetting("shadowColor", 0x777777));
    const shadowColor = Number.isFinite(shadowColorRaw)
        ? Math.max(0, Math.min(0xffffff, Math.floor(shadowColorRaw)))
        : 0x777777;
    graphics.beginFill(shadowColor, shadowOpacity);
    for (let i = 0; i < bins; i++) {
        const j = (i + 1) % bins;
        const d0 = Number.isFinite(depth[i]) ? Math.max(losNearRevealRadius, depth[i]) : farDist;
        const d1 = Number.isFinite(depth[j]) ? Math.max(losNearRevealRadius, depth[j]) : farDist;
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

function resolveVisibilityHitboxes() {
    const hitboxes = [];
    visibilityMaskSources.forEach(source => {
        const resolved = (typeof source === "function") ? source() : source;
        if (!resolved) return;
        if (Array.isArray(resolved)) {
            resolved.forEach(h => { if (h) hitboxes.push(h); });
        } else {
            hitboxes.push(resolved);
        }
    });
    return hitboxes;
}

function pointInsideVisibilityMask(x, y) {
    if (!activeVisibilityMaskHitboxes || activeVisibilityMaskHitboxes.length === 0) return true;
    return activeVisibilityMaskHitboxes.some(maskHitbox =>
        maskHitbox &&
        typeof maskHitbox.containsPoint === "function" &&
        maskHitbox.containsPoint(x, y)
    );
}

function projectPolygonPointsToScreen(points) {
    if (!Array.isArray(points) || points.length < 3) return [];
    const anchor = points[0];
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return [];
    const anchorScreen = worldToScreen({ x: anchor.x, y: anchor.y });
    return points.map(pt => {
        if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
            return { x: anchorScreen.x, y: anchorScreen.y };
        }
        const dx = (map && typeof map.shortestDeltaX === "function")
            ? map.shortestDeltaX(anchor.x, pt.x)
            : (pt.x - anchor.x);
        const dy = (map && typeof map.shortestDeltaY === "function")
            ? map.shortestDeltaY(anchor.y, pt.y)
            : (pt.y - anchor.y);
        return {
            x: anchorScreen.x + dx * viewscale,
            y: anchorScreen.y + dy * viewscale * xyratio
        };
    });
}

function pointInsideMaskHitboxes(x, y, maskHitboxes) {
    if (!Array.isArray(maskHitboxes) || maskHitboxes.length === 0) return false;
    return maskHitboxes.some(maskHitbox =>
        maskHitbox &&
        typeof maskHitbox.containsPoint === "function" &&
        maskHitbox.containsPoint(x, y)
    );
}

function inflateScreenPolygon(points, inflatePx = 0) {
    if (!Array.isArray(points) || points.length < 3 || !Number.isFinite(inflatePx) || inflatePx === 0) {
        return Array.isArray(points) ? points.slice() : [];
    }
    const centroid = points.reduce((acc, pt) => {
        acc.x += pt.x;
        acc.y += pt.y;
        return acc;
    }, { x: 0, y: 0 });
    centroid.x /= points.length;
    centroid.y /= points.length;

    return points.map(pt => {
        const dx = pt.x - centroid.x;
        const dy = pt.y - centroid.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return { x: pt.x, y: pt.y };
        const s = (len + inflatePx) / len;
        return { x: centroid.x + dx * s, y: centroid.y + dy * s };
    });
}

function isGroundHitboxInsideVisibilityMask(hitbox, requireFull = false) {
    if (!hitbox) return false;
    if (!activeVisibilityMaskHitboxes || activeVisibilityMaskHitboxes.length === 0) return true;

    // Circle hitbox: sample center and perimeter points.
    if (hitbox.type === "circle" && Number.isFinite(hitbox.x) && Number.isFinite(hitbox.y) && Number.isFinite(hitbox.radius)) {
        const r = hitbox.radius;
        const samples = [
            { x: hitbox.x, y: hitbox.y },
            { x: hitbox.x + r, y: hitbox.y },
            { x: hitbox.x - r, y: hitbox.y },
            { x: hitbox.x, y: hitbox.y + r },
            { x: hitbox.x, y: hitbox.y - r },
            { x: hitbox.x + r * 0.70710678, y: hitbox.y + r * 0.70710678 },
            { x: hitbox.x - r * 0.70710678, y: hitbox.y + r * 0.70710678 },
            { x: hitbox.x + r * 0.70710678, y: hitbox.y - r * 0.70710678 },
            { x: hitbox.x - r * 0.70710678, y: hitbox.y - r * 0.70710678 }
        ];
        return requireFull
            ? samples.every(pt => pointInsideVisibilityMask(pt.x, pt.y))
            : samples.some(pt => pointInsideVisibilityMask(pt.x, pt.y));
    }

    // Polygon hitbox: vertex and centroid checks.
    if (Array.isArray(hitbox.points) && hitbox.points.length >= 3) {
        const pts = hitbox.points;
        const cx = pts.reduce((sum, pt) => sum + pt.x, 0) / pts.length;
        const cy = pts.reduce((sum, pt) => sum + pt.y, 0) / pts.length;
        if (requireFull) {
            const verticesInside = pts.every(pt => pointInsideVisibilityMask(pt.x, pt.y));
            if (!verticesInside) return false;
            return pointInsideVisibilityMask(cx, cy);
        }
        const verticesInside = pts.some(pt => pointInsideVisibilityMask(pt.x, pt.y));
        if (verticesInside) return true;
        return pointInsideVisibilityMask(cx, cy);
    }

    return false;
}

function isGroundHitboxFullyInsideVisibilityMask(hitbox) {
    return isGroundHitboxInsideVisibilityMask(hitbox, true);
}

function isGroundHitboxVisibleInVisibilityMask(hitbox) {
    return isGroundHitboxInsideVisibilityMask(hitbox, false);
}

// True only when every sampled point is outside the provided mask hitboxes.
function isGroundHitboxFullyOutsideMaskHitboxes(hitbox, maskHitboxes) {
    if (!hitbox) return false;
    if (!Array.isArray(maskHitboxes) || maskHitboxes.length === 0) return true;

    // Circle hitbox: sample center and perimeter points.
    if (hitbox.type === "circle" && Number.isFinite(hitbox.x) && Number.isFinite(hitbox.y) && Number.isFinite(hitbox.radius)) {
        const r = hitbox.radius;
        const samples = [
            { x: hitbox.x, y: hitbox.y },
            { x: hitbox.x + r, y: hitbox.y },
            { x: hitbox.x - r, y: hitbox.y },
            { x: hitbox.x, y: hitbox.y + r },
            { x: hitbox.x, y: hitbox.y - r },
            { x: hitbox.x + r * 0.70710678, y: hitbox.y + r * 0.70710678 },
            { x: hitbox.x - r * 0.70710678, y: hitbox.y + r * 0.70710678 },
            { x: hitbox.x + r * 0.70710678, y: hitbox.y - r * 0.70710678 },
            { x: hitbox.x - r * 0.70710678, y: hitbox.y - r * 0.70710678 }
        ];
        return samples.every(pt => !pointInsideMaskHitboxes(pt.x, pt.y, maskHitboxes));
    }

    // Polygon hitbox: vertex and centroid checks.
    if (Array.isArray(hitbox.points) && hitbox.points.length >= 3) {
        const pts = hitbox.points;
        const cx = pts.reduce((sum, pt) => sum + pt.x, 0) / pts.length;
        const cy = pts.reduce((sum, pt) => sum + pt.y, 0) / pts.length;
        const verticesOutside = pts.every(pt => !pointInsideMaskHitboxes(pt.x, pt.y, maskHitboxes));
        if (!verticesOutside) return false;
        return !pointInsideMaskHitboxes(cx, cy, maskHitboxes);
    }

    return false;
}

// True only when every sampled point is inside the provided mask hitboxes.
function isGroundHitboxFullyInsideMaskHitboxes(hitbox, maskHitboxes) {
    if (!hitbox) return false;
    if (!Array.isArray(maskHitboxes) || maskHitboxes.length === 0) return false;

    // Circle hitbox: sample center and perimeter points.
    if (hitbox.type === "circle" && Number.isFinite(hitbox.x) && Number.isFinite(hitbox.y) && Number.isFinite(hitbox.radius)) {
        const r = hitbox.radius;
        const samples = [
            { x: hitbox.x, y: hitbox.y },
            { x: hitbox.x + r, y: hitbox.y },
            { x: hitbox.x - r, y: hitbox.y },
            { x: hitbox.x, y: hitbox.y + r },
            { x: hitbox.x, y: hitbox.y - r },
            { x: hitbox.x + r * 0.70710678, y: hitbox.y + r * 0.70710678 },
            { x: hitbox.x - r * 0.70710678, y: hitbox.y + r * 0.70710678 },
            { x: hitbox.x + r * 0.70710678, y: hitbox.y - r * 0.70710678 },
            { x: hitbox.x - r * 0.70710678, y: hitbox.y - r * 0.70710678 }
        ];
        return samples.every(pt => pointInsideMaskHitboxes(pt.x, pt.y, maskHitboxes));
    }

    // Polygon hitbox: vertex and centroid checks.
    if (Array.isArray(hitbox.points) && hitbox.points.length >= 3) {
        const pts = hitbox.points;
        const cx = pts.reduce((sum, pt) => sum + pt.x, 0) / pts.length;
        const cy = pts.reduce((sum, pt) => sum + pt.y, 0) / pts.length;
        const verticesInside = pts.every(pt => pointInsideMaskHitboxes(pt.x, pt.y, maskHitboxes));
        if (!verticesInside) return false;
        return pointInsideMaskHitboxes(cx, cy, maskHitboxes);
    }

    return false;
}

function wallIntersectsMaskHitboxes(wall, maskHitboxes) {
    if (!wall || !Array.isArray(maskHitboxes) || maskHitboxes.length === 0) return false;

    // Prefer existing ground hitbox overlap when available.
    if (
        wall.groundPlaneHitbox &&
        !isGroundHitboxFullyOutsideMaskHitboxes(wall.groundPlaneHitbox, maskHitboxes)
    ) {
        return true;
    }

    // Fallback: sample the wall baseline segment in world space.
    if (
        wall.a && wall.b &&
        Number.isFinite(wall.a.x) && Number.isFinite(wall.a.y) &&
        Number.isFinite(wall.b.x) && Number.isFinite(wall.b.y)
    ) {
        const samples = [0, 0.25, 0.5, 0.75, 1];
        for (let i = 0; i < samples.length; i++) {
            const t = samples[i];
            const x = wall.a.x + (wall.b.x - wall.a.x) * t;
            const y = wall.a.y + (wall.b.y - wall.a.y) * t;
            if (pointInsideMaskHitboxes(x, y, maskHitboxes)) return true;
        }
    }

    return false;
}

function drawVisibilityMask() {
    if (!visibilityMaskEnabled || !app || !gameContainer) {
        if (visibilityMaskGraphics) visibilityMaskGraphics.visible = false;
        if (gameContainer) gameContainer.mask = null;
        activeVisibilityMaskHitboxes = [];
        return;
    }

    const graphics = ensureVisibilityMaskGraphics();
    const hitboxes = resolveVisibilityHitboxes();
    activeVisibilityMaskHitboxes = hitboxes || [];

    if (!hitboxes.length) {
        graphics.visible = false;
        gameContainer.mask = null;
        activeVisibilityMaskHitboxes = [];
        return;
    }

    graphics.clear();
    graphics.alpha = 1;
    graphics.beginFill(0xffffff, 1);
    let drewMaskShape = false;
    hitboxes.forEach(hitbox => {
        if (!hitbox) return;
        if (hitbox.type === "circle" && Number.isFinite(hitbox.x) && Number.isFinite(hitbox.y) && Number.isFinite(hitbox.radius)) {
            const center = worldToScreen({ x: hitbox.x, y: hitbox.y });
            graphics.drawEllipse(center.x, center.y, hitbox.radius * viewscale, hitbox.radius * viewscale * xyratio);
            drewMaskShape = true;
            return;
        }
        const points = Array.isArray(hitbox.points) ? hitbox.points : null;
        if (!points || points.length < 3) return;
        const screenPoints = projectPolygonPointsToScreen(points);
        const flatPoints = [];
        screenPoints.forEach(pt => {
            flatPoints.push(pt.x, pt.y);
        });
        graphics.drawPolygon(flatPoints);
        drewMaskShape = true;
    });
    graphics.endFill();
    graphics.visible = drewMaskShape;
    gameContainer.mask = drewMaskShape ? graphics : null;
}

function setVisibilityMaskEnabled(enabled) {
    visibilityMaskEnabled = !!enabled;
    if (!visibilityMaskEnabled) {
        if (visibilityMaskGraphics) visibilityMaskGraphics.visible = false;
        if (gameContainer) gameContainer.mask = null;
    }
}

function setVisibilityMaskSources(sources) {
    visibilityMaskSources = Array.isArray(sources) ? sources.slice() : [];
}

function addVisibilityMaskSource(source) {
    if (source) visibilityMaskSources.push(source);
}

function clearVisibilityMaskSources() {
    visibilityMaskSources = [];
}

function getGroundChunkKey(chunkX, chunkY) {
    return `${chunkX},${chunkY}`;
}

function destroyGroundChunk(chunk) {
    if (!chunk) return;
    if (chunk.sprite && chunk.sprite.parent) {
        chunk.sprite.parent.removeChild(chunk.sprite);
    }
    if (chunk.sprite) {
        chunk.sprite.destroy({ texture: true, baseTexture: false });
    }
    if (chunk.renderTexture) {
        chunk.renderTexture.destroy(true);
    }
}

function clearGroundChunkCache() {
    groundChunkCache.forEach(chunk => destroyGroundChunk(chunk));
    groundChunkCache.clear();
}

function drawSpellHoverTargetHighlight() {
    if (!objectLayer) return;
    if (!spellHoverHighlightSprite) {
        spellHoverHighlightSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        spellHoverHighlightSprite.visible = false;
        spellHoverHighlightSprite.blendMode = PIXI.BLEND_MODES.ADD;
        spellHoverHighlightSprite.interactive = false;
        spellHoverHighlightSprite.renderable = true;
    }
    if (!spellHoverHighlightWallGraphics) {
        spellHoverHighlightWallGraphics = new PIXI.Graphics();
        spellHoverHighlightWallGraphics.visible = false;
        spellHoverHighlightWallGraphics.skipTransform = true;
        spellHoverHighlightWallGraphics.blendMode = PIXI.BLEND_MODES.ADD;
        spellHoverHighlightWallGraphics.interactive = false;
    }
    if (!spellHoverHighlightMesh) {
        spellHoverHighlightMesh = new PIXI.Mesh(
            new PIXI.Geometry()
                .addAttribute("aVertexPosition", new Float32Array(8), 2)
                .addAttribute("aUvs", new Float32Array([
                    0, 1,
                    1, 1,
                    1, 0,
                    0, 0
                ]), 2)
                .addIndex(new Uint16Array([0, 1, 2, 0, 2, 3])),
            new PIXI.MeshMaterial(PIXI.Texture.WHITE)
        );
        spellHoverHighlightMesh.visible = false;
        spellHoverHighlightMesh.interactive = false;
        spellHoverHighlightMesh.blendMode = PIXI.BLEND_MODES.ADD;
    }

    if (
        !wizard ||
        !SpellSystem ||
        typeof SpellSystem.getHoverTargetForCurrentSpell !== "function" ||
        !Number.isFinite(mousePos.worldX) ||
        !Number.isFinite(mousePos.worldY)
    ) {
        if (spellHoverHighlightSprite) spellHoverHighlightSprite.visible = false;
        if (spellHoverHighlightWallGraphics) {
            spellHoverHighlightWallGraphics.clear();
            spellHoverHighlightWallGraphics.visible = false;
        }
        if (spellHoverHighlightMesh) {
            spellHoverHighlightMesh.visible = false;
        }
        return;
    }

    const getHoverDisplayObject = obj => {
        if (!obj) return null;
        if (obj._wallSectionCompositeDisplayObject && obj._wallSectionCompositeDisplayObject.parent) return obj._wallSectionCompositeDisplayObject;
        if (obj._opaqueDepthMesh && obj._opaqueDepthMesh.parent) return obj._opaqueDepthMesh;
        if (obj.pixiSprite && obj.pixiSprite.parent) return obj.pixiSprite;
        if (obj._wallSectionCompositeSprite && obj._wallSectionCompositeSprite.parent) return obj._wallSectionCompositeSprite;
        return null;
    };

    const target = SpellSystem.getHoverTargetForCurrentSpell(wizard, mousePos.worldX, mousePos.worldY);
    const targetSprite = getHoverDisplayObject(target);
    if (!target || !targetSprite || target.gone || target.vanishing) {
        spellHoverHighlightSprite.visible = false;
        if (spellHoverHighlightWallGraphics) {
            spellHoverHighlightWallGraphics.clear();
            spellHoverHighlightWallGraphics.visible = false;
        }
        if (spellHoverHighlightMesh) {
            spellHoverHighlightMesh.visible = false;
        }
        return;
    }
    if (wizard && wizard.currentSpell === "placeobject") {
        spellHoverHighlightSprite.visible = false;
        if (spellHoverHighlightWallGraphics) {
            spellHoverHighlightWallGraphics.clear();
            spellHoverHighlightWallGraphics.visible = false;
        }
        if (spellHoverHighlightMesh) {
            spellHoverHighlightMesh.visible = false;
        }
        return;
    }
    const pulse = 0.55 + 0.45 * (Math.sin(frameCount * 0.12) * 0.5 + 0.5);

    if (
        target.type === "wall" &&
        typeof Wall !== "undefined" &&
        typeof Wall.drawWall === "function" &&
        spellHoverHighlightWallGraphics
    ) {
        spellHoverHighlightSprite.visible = false;
        if (spellHoverHighlightMesh) {
            spellHoverHighlightMesh.visible = false;
        }
        const parent = targetSprite.parent;
        spellHoverHighlightWallGraphics.clear();
        const profile = (typeof target.getWallProfile === "function")
            ? target.getWallProfile()
            : null;
        const renderCapA = (typeof target.hasConnectedWallAtEndpoint === "function")
            ? !target.hasConnectedWallAtEndpoint("a")
            : true;
        const renderCapB = (typeof target.hasConnectedWallAtEndpoint === "function")
            ? !target.hasConnectedWallAtEndpoint("b")
            : true;
        Wall.drawWall(
            spellHoverHighlightWallGraphics,
            target.a,
            target.b,
            target.height,
            target.thickness,
            0x66c2ff,
            0.3 * pulse,
            {
                profile,
                renderCapA,
                renderCapB,
                disableWallTexture: true,
                texturePhaseA: target.texturePhaseA,
                texturePhaseB: target.texturePhaseB
            }
        );
        spellHoverHighlightWallGraphics.visible = true;
        if (spellHoverHighlightWallGraphics.parent !== parent) {
            if (spellHoverHighlightWallGraphics.parent) {
                spellHoverHighlightWallGraphics.parent.removeChild(spellHoverHighlightWallGraphics);
            }
            parent.addChild(spellHoverHighlightWallGraphics);
        } else {
            const targetIndex = parent.getChildIndex(targetSprite);
            const glowIndex = parent.getChildIndex(spellHoverHighlightWallGraphics);
            const desiredIndex = Math.min(parent.children.length - 1, targetIndex + 1);
            if (glowIndex !== desiredIndex) {
                parent.setChildIndex(spellHoverHighlightWallGraphics, desiredIndex);
            }
        }
        return;
    }

    if (targetSprite instanceof PIXI.Sprite) {
        if (spellHoverHighlightWallGraphics) {
            spellHoverHighlightWallGraphics.clear();
            spellHoverHighlightWallGraphics.visible = false;
        }
        if (spellHoverHighlightMesh) {
            spellHoverHighlightMesh.visible = false;
        }
        spellHoverHighlightSprite.texture = targetSprite.texture || PIXI.Texture.WHITE;
        if (targetSprite.anchor && spellHoverHighlightSprite.anchor) {
            spellHoverHighlightSprite.anchor.set(targetSprite.anchor.x, targetSprite.anchor.y);
        }
        spellHoverHighlightSprite.position.set(targetSprite.position.x, targetSprite.position.y);
        spellHoverHighlightSprite.scale.set(targetSprite.scale.x, targetSprite.scale.y);
        spellHoverHighlightSprite.rotation = targetSprite.rotation;
        spellHoverHighlightSprite.skew.set(targetSprite.skew.x, targetSprite.skew.y);
        spellHoverHighlightSprite.pivot.set(targetSprite.pivot.x, targetSprite.pivot.y);
        spellHoverHighlightSprite.tint = 0x66c2ff;
        spellHoverHighlightSprite.alpha = 0.35 * pulse;
        spellHoverHighlightSprite.visible = true;

        const parent = targetSprite.parent;
        if (spellHoverHighlightSprite.parent !== parent) {
            if (spellHoverHighlightSprite.parent) {
                spellHoverHighlightSprite.parent.removeChild(spellHoverHighlightSprite);
            }
            parent.addChild(spellHoverHighlightSprite);
        } else {
            // Keep the glow directly above the target sprite.
            const targetIndex = parent.getChildIndex(targetSprite);
            const glowIndex = parent.getChildIndex(spellHoverHighlightSprite);
            const desiredIndex = Math.min(parent.children.length - 1, targetIndex + 1);
            if (glowIndex !== desiredIndex) {
                parent.setChildIndex(spellHoverHighlightSprite, desiredIndex);
            }
        }
        return;
    }

    spellHoverHighlightSprite.visible = false;
    if (spellHoverHighlightMesh) {
        spellHoverHighlightMesh.visible = false;
    }

    if (targetSprite instanceof PIXI.Mesh && spellHoverHighlightMesh) {
        const parent = targetSprite.parent;
        const safeGetBuffer = (geometry, attrName) => {
            if (!geometry || typeof geometry.getBuffer !== "function") return null;
            try {
                return geometry.getBuffer(attrName);
            } catch (_err) {
                return null;
            }
        };
        const vertexBuffer = safeGetBuffer(targetSprite.geometry, "aVertexPosition");
        const worldVertexBuffer = safeGetBuffer(targetSprite.geometry, "aWorldPosition");
        const uvBuffer = safeGetBuffer(targetSprite.geometry, "aUvs");
        const indexBuffer = targetSprite.geometry && targetSprite.geometry.getIndex
            ? targetSprite.geometry.getIndex()
            : null;
        const verts = vertexBuffer && vertexBuffer.data ? vertexBuffer.data : null;
        const worldVerts = worldVertexBuffer && worldVertexBuffer.data ? worldVertexBuffer.data : null;
        const uvs = uvBuffer && uvBuffer.data ? uvBuffer.data : null;
        const idx = indexBuffer && indexBuffer.data ? indexBuffer.data : null;
        const has2DVerts = !!(verts && verts.length >= 8);
        const hasWorldVerts = !!(worldVerts && worldVerts.length >= 12);
        if ((has2DVerts || hasWorldVerts) && uvs && uvs.length >= 8 && idx && idx.length >= 3) {
            const hlGeom = spellHoverHighlightMesh.geometry;
            const hlVertsBuffer = hlGeom.getBuffer("aVertexPosition");
            const hlUvsBuffer = hlGeom.getBuffer("aUvs");
            const hlIndex = hlGeom.getIndex();
            if (hlVertsBuffer && hlVertsBuffer.data) {
                let projectedVerts = null;
                if (has2DVerts) {
                    projectedVerts = verts;
                } else if (hasWorldVerts) {
                    const projected = new Float32Array((worldVerts.length / 3) * 2);
                    for (let i = 0, j = 0; i <= worldVerts.length - 3; i += 3, j += 2) {
                        const screenPt = worldToScreen({ x: worldVerts[i], y: worldVerts[i + 1] });
                        projected[j] = screenPt.x;
                        projected[j + 1] = screenPt.y - (worldVerts[i + 2] * viewscale * xyratio);
                    }
                    projectedVerts = projected;
                }
                if (projectedVerts) {
                    const nextVerts = (projectedVerts instanceof Float32Array)
                        ? projectedVerts
                        : Float32Array.from(projectedVerts);
                    if (hlVertsBuffer.data.length !== nextVerts.length) {
                        hlVertsBuffer.data = new Float32Array(nextVerts.length);
                    }
                    hlVertsBuffer.data.set(nextVerts);
                    hlVertsBuffer.update();
                }
            }
            if (hlUvsBuffer && hlUvsBuffer.data) {
                const nextUvs = (uvs instanceof Float32Array) ? uvs : Float32Array.from(uvs);
                if (hlUvsBuffer.data.length !== nextUvs.length) {
                    hlUvsBuffer.data = new Float32Array(nextUvs.length);
                }
                hlUvsBuffer.data.set(nextUvs);
                hlUvsBuffer.update();
            }
            if (hlIndex && hlIndex.data) {
                const indexCtor = (idx && idx.constructor) ? idx.constructor : Uint16Array;
                const nextIdx = (idx instanceof indexCtor) ? idx : new indexCtor(idx);
                if (hlIndex.data.length !== nextIdx.length || hlIndex.data.constructor !== nextIdx.constructor) {
                    hlIndex.data = new indexCtor(nextIdx.length);
                }
                hlIndex.data.set(nextIdx);
                hlIndex.update();
            }
            if (spellHoverHighlightMesh.material) {
                const tex = (targetSprite.material && targetSprite.material.texture)
                    ? targetSprite.material.texture
                    : ((targetSprite.shader && targetSprite.shader.uniforms && targetSprite.shader.uniforms.uSampler)
                        ? targetSprite.shader.uniforms.uSampler
                        : PIXI.Texture.WHITE);
                spellHoverHighlightMesh.material.texture = tex;
            }
            spellHoverHighlightMesh.tint = 0x66c2ff;
            spellHoverHighlightMesh.alpha = 0.35 * pulse;
            spellHoverHighlightMesh.position.set(targetSprite.position.x, targetSprite.position.y);
            spellHoverHighlightMesh.scale.set(targetSprite.scale.x, targetSprite.scale.y);
            spellHoverHighlightMesh.rotation = targetSprite.rotation;
            spellHoverHighlightMesh.skew.set(targetSprite.skew.x, targetSprite.skew.y);
            spellHoverHighlightMesh.pivot.set(targetSprite.pivot.x, targetSprite.pivot.y);
            spellHoverHighlightMesh.visible = true;

            if (spellHoverHighlightMesh.parent !== parent) {
                if (spellHoverHighlightMesh.parent) {
                    spellHoverHighlightMesh.parent.removeChild(spellHoverHighlightMesh);
                }
                parent.addChild(spellHoverHighlightMesh);
            } else {
                const targetIndex = parent.getChildIndex(targetSprite);
                const glowIndex = parent.getChildIndex(spellHoverHighlightMesh);
                const desiredIndex = Math.min(parent.children.length - 1, targetIndex + 1);
                if (glowIndex !== desiredIndex) {
                    parent.setChildIndex(spellHoverHighlightMesh, desiredIndex);
                }
            }
            return;
        }
    }

    if (spellHoverHighlightWallGraphics) {
        const targetHitbox = target.visualHitbox || target.groundPlaneHitbox || target.hitbox || null;
        let drewGenericHighlight = false;
        if (targetHitbox) {
            const parent = targetSprite.parent;
            const glowColor = 0x66c2ff;
            spellHoverHighlightWallGraphics.clear();
            spellHoverHighlightWallGraphics.lineStyle(2, glowColor, Math.max(0.2, 0.55 * pulse));
            spellHoverHighlightWallGraphics.beginFill(glowColor, 0.12 * pulse);

            if (
                targetHitbox.type === "circle" &&
                Number.isFinite(targetHitbox.x) &&
                Number.isFinite(targetHitbox.y) &&
                Number.isFinite(targetHitbox.radius)
            ) {
                const c = worldToScreen({ x: targetHitbox.x, y: targetHitbox.y });
                spellHoverHighlightWallGraphics.drawEllipse(
                    c.x,
                    c.y,
                    targetHitbox.radius * viewscale,
                    targetHitbox.radius * viewscale * xyratio
                );
                drewGenericHighlight = true;
            } else if (Array.isArray(targetHitbox.points) && targetHitbox.points.length >= 3) {
                const screenPoints = targetHitbox.points.map(pt => worldToScreen({ x: pt.x, y: pt.y }));
                if (screenPoints.length >= 3) {
                    spellHoverHighlightWallGraphics.moveTo(screenPoints[0].x, screenPoints[0].y);
                    for (let i = 1; i < screenPoints.length; i++) {
                        spellHoverHighlightWallGraphics.lineTo(screenPoints[i].x, screenPoints[i].y);
                    }
                    spellHoverHighlightWallGraphics.closePath();
                    drewGenericHighlight = true;
                }
            }

            spellHoverHighlightWallGraphics.endFill();
            spellHoverHighlightWallGraphics.visible = drewGenericHighlight;
            if (drewGenericHighlight) {
                if (spellHoverHighlightWallGraphics.parent !== parent) {
                    if (spellHoverHighlightWallGraphics.parent) {
                        spellHoverHighlightWallGraphics.parent.removeChild(spellHoverHighlightWallGraphics);
                    }
                    parent.addChild(spellHoverHighlightWallGraphics);
                } else {
                    const targetIndex = parent.getChildIndex(targetSprite);
                    const glowIndex = parent.getChildIndex(spellHoverHighlightWallGraphics);
                    const desiredIndex = Math.min(parent.children.length - 1, targetIndex + 1);
                    if (glowIndex !== desiredIndex) {
                        parent.setChildIndex(spellHoverHighlightWallGraphics, desiredIndex);
                    }
                }
                return;
            }
        }
    }

    if (spellHoverHighlightWallGraphics) {
        spellHoverHighlightWallGraphics.clear();
        spellHoverHighlightWallGraphics.visible = false;
    }
}

function buildPlaceObjectPreviewRenderItem() {
    if (!objectLayer || !wizard || wizard.currentSpell !== "placeobject") {
        if (placeObjectPreviewSprite) placeObjectPreviewSprite.visible = false;
        return null;
    }
    if (!Number.isFinite(mousePos.worldX) || !Number.isFinite(mousePos.worldY)) {
        if (placeObjectPreviewSprite) placeObjectPreviewSprite.visible = false;
        return null;
    }

    const texturePath = (
        typeof wizard.selectedPlaceableTexturePath === "string" &&
        wizard.selectedPlaceableTexturePath.length > 0
    ) ? wizard.selectedPlaceableTexturePath : "/assets/images/doors/door5.png";
    const selectedCategory = (
        wizard &&
        typeof wizard.selectedPlaceableCategory === "string" &&
        wizard.selectedPlaceableCategory.length > 0
    ) ? wizard.selectedPlaceableCategory : "doors";
    const rawAxis = (wizard && typeof wizard.selectedPlaceableRotationAxis === "string")
        ? wizard.selectedPlaceableRotationAxis.trim().toLowerCase()
        : "";
    const rotationAxis = (rawAxis === "spatial" || rawAxis === "visual" || rawAxis === "none")
        ? rawAxis
        : ((selectedCategory === "doors" || selectedCategory === "windows") ? "spatial" : "visual");
    const placementRotation = (wizard && Number.isFinite(wizard.selectedPlaceableRotation))
        ? Number(wizard.selectedPlaceableRotation)
        : 0;
    const effectivePlacementRotation = (rotationAxis === "none") ? 0 : placementRotation;

    if (!placeObjectPreviewSprite) {
        placeObjectPreviewSprite = new PIXI.Sprite(PIXI.Texture.from(texturePath));
        placeObjectPreviewSprite.anchor.set(0.5, 0.5);
        placeObjectPreviewSprite.alpha = 0.5;
        placeObjectPreviewSprite.interactive = false;
        placeObjectPreviewSprite.visible = false;
        placeObjectPreviewTexturePath = texturePath;
    } else if (placeObjectPreviewTexturePath !== texturePath) {
        placeObjectPreviewSprite.texture = PIXI.Texture.from(texturePath);
        placeObjectPreviewTexturePath = texturePath;
    }

    const worldX = (map && typeof map.wrapWorldX === "function")
        ? map.wrapWorldX(mousePos.worldX)
        : mousePos.worldX;
    const worldY = (map && typeof map.wrapWorldY === "function")
        ? map.wrapWorldY(mousePos.worldY)
        : mousePos.worldY;
    const isWallMountedPlacement = selectedCategory === "windows" || selectedCategory === "doors";
    const snapPlacement = (
        isWallMountedPlacement &&
        typeof SpellSystem !== "undefined" &&
        SpellSystem &&
        typeof SpellSystem.getPlaceObjectPlacementCandidate === "function"
    ) ? SpellSystem.getPlaceObjectPlacementCandidate(wizard, worldX, worldY) : null;
    const hasWallSnapTarget = !!(
        isWallMountedPlacement &&
        snapPlacement &&
        snapPlacement.targetWall
    );
    const useSnapPlacement = hasWallSnapTarget;
    const placeableScale = (wizard && Number.isFinite(wizard.selectedPlaceableScale))
        ? Number(wizard.selectedPlaceableScale)
        : 1;
    const clampedScale = Math.max(0.2, Math.min(5, placeableScale));
    const selectedAnchorY = (wizard && Number.isFinite(wizard.selectedPlaceableAnchorY))
        ? Number(wizard.selectedPlaceableAnchorY)
        : 1;
    const yScale = Math.max(0.1, Math.abs(Number.isFinite(xyratio) ? xyratio : 0.66));
    const placementYOffset = (rotationAxis === "spatial")
        ? 0
        : (((selectedAnchorY - 0.5) * clampedScale) / yScale);
    const previewX = (useSnapPlacement && Number.isFinite(snapPlacement.snappedX)) ? snapPlacement.snappedX : worldX;
    let placedY = (useSnapPlacement && Number.isFinite(snapPlacement.snappedY))
        ? snapPlacement.snappedY
        : (worldY + placementYOffset);
    if (map && typeof map.wrapWorldY === "function") {
        placedY = map.wrapWorldY(placedY);
    }
    const renderDepthOffset = (wizard && Number.isFinite(wizard.selectedPlaceableRenderOffset))
        ? Number(wizard.selectedPlaceableRenderOffset)
        : 0;
    placeObjectPreviewSprite.tint = 0xffffff;
    placeObjectPreviewSprite.visible = true;
    return {
        type: "placedObjectPreview",
        x: previewX,
        y: (useSnapPlacement && Number.isFinite(snapPlacement.snappedY)) ? snapPlacement.snappedY : worldY,
        width: clampedScale,
        height: clampedScale,
        renderZ: placedY + renderDepthOffset,
        previewAlpha: 0.5,
        texturePath,
        category: selectedCategory,
        placeableAnchorX: (wizard && Number.isFinite(wizard.selectedPlaceableAnchorX))
            ? Number(wizard.selectedPlaceableAnchorX)
            : 0.5,
        placeableAnchorY: (wizard && Number.isFinite(wizard.selectedPlaceableAnchorY))
            ? Number(wizard.selectedPlaceableAnchorY)
            : 1,
        rotationAxis: useSnapPlacement ? "spatial" : rotationAxis,
        placementRotation: (useSnapPlacement && Number.isFinite(snapPlacement.snappedRotationDeg)) ? snapPlacement.snappedRotationDeg : effectivePlacementRotation,
        mountedWallLineGroupId: (
            useSnapPlacement &&
            Number.isInteger(snapPlacement.mountedWallLineGroupId)
        ) ? Number(snapPlacement.mountedWallLineGroupId) : (
            useSnapPlacement &&
            snapPlacement.targetWall &&
            Number.isInteger(snapPlacement.targetWall.lineGroupId)
        ) ? Number(snapPlacement.targetWall.lineGroupId) : null,
        mountedSectionId: (
            useSnapPlacement &&
            Number.isInteger(snapPlacement.mountedSectionId)
        ) ? Number(snapPlacement.mountedSectionId) : (
            useSnapPlacement &&
            Number.isInteger(snapPlacement.mountedWallLineGroupId)
        ) ? Number(snapPlacement.mountedWallLineGroupId) : null,
        mountedWallFacingSign: (
            useSnapPlacement &&
            Number.isFinite(snapPlacement.mountedWallFacingSign)
        ) ? Number(snapPlacement.mountedWallFacingSign) : null,
        previewDrawAfterWalls: !!(isWallMountedPlacement && useSnapPlacement),
        centerSnapGuide: useSnapPlacement
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
            : null,
        groundPlaneHitbox: (useSnapPlacement && Array.isArray(snapPlacement.wallGroundHitboxPoints))
            ? new PolygonHitbox(snapPlacement.wallGroundHitboxPoints.map(p => ({ x: p.x, y: p.y })))
            : undefined,
        pixiSprite: placeObjectPreviewSprite
    };
}

function drawPlaceObjectCenterSnapGuide(previewItem) {
    if (typeof PIXI === "undefined") return;
    const targetLayer = (
        previewItem &&
        previewItem.pixiSprite &&
        previewItem.pixiSprite.parent
    ) ? previewItem.pixiSprite.parent : objectLayer;
    if (!targetLayer) return;
    if (!placeObjectCenterSnapGuideGraphics) {
        placeObjectCenterSnapGuideGraphics = new PIXI.Graphics();
        placeObjectCenterSnapGuideGraphics.skipTransform = true;
        placeObjectCenterSnapGuideGraphics.interactive = false;
        placeObjectCenterSnapGuideGraphics.visible = false;
    }
    if (placeObjectCenterSnapGuideGraphics.parent !== targetLayer) {
        if (placeObjectCenterSnapGuideGraphics.parent) {
            placeObjectCenterSnapGuideGraphics.parent.removeChild(placeObjectCenterSnapGuideGraphics);
        }
        targetLayer.addChild(placeObjectCenterSnapGuideGraphics);
    }

    placeObjectCenterSnapGuideGraphics.clear();
    const guide = previewItem && previewItem.centerSnapGuide ? previewItem.centerSnapGuide : null;
    if (
        !guide ||
        !Number.isFinite(guide.placementCenterX) ||
        !Number.isFinite(guide.placementCenterY) ||
        !Number.isFinite(guide.sectionCenterX) ||
        !Number.isFinite(guide.sectionCenterY)
    ) {
        placeObjectCenterSnapGuideGraphics.visible = false;
        return;
    }

    const placementCenterScreen = worldToScreen({ x: guide.placementCenterX, y: guide.placementCenterY });
    const sectionCenterScreen = worldToScreen({ x: guide.sectionCenterX, y: guide.sectionCenterY });
    const topCenterScreen = {
        x: sectionCenterScreen.x,
        y: sectionCenterScreen.y - (Math.max(0, Number(guide.wallHeight) || 0) * viewscale * xyratio)
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
            placeObjectCenterSnapGuideGraphics.lineStyle(2, 0x4fc3ff, 0.8);
            placeObjectCenterSnapGuideGraphics.beginFill(0x4fc3ff, 0.12);
            placeObjectCenterSnapGuideGraphics.moveTo(poly[0].x, poly[0].y);
            for (let p = 1; p < poly.length; p++) {
                placeObjectCenterSnapGuideGraphics.lineTo(poly[p].x, poly[p].y);
            }
            placeObjectCenterSnapGuideGraphics.closePath();
            placeObjectCenterSnapGuideGraphics.endFill();
        }
    } else if (Array.isArray(guide.sectionFaceQuadScreenPoints) && guide.sectionFaceQuadScreenPoints.length >= 4) {
        const quad = guide.sectionFaceQuadScreenPoints
            .slice(0, 4)
            .map(pt => ({ x: Number(pt.x), y: Number(pt.y) }))
            .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y));
        if (quad.length === 4) {
            placeObjectCenterSnapGuideGraphics.lineStyle(2, 0x4fc3ff, 0.8);
            placeObjectCenterSnapGuideGraphics.beginFill(0x4fc3ff, 0.12);
            placeObjectCenterSnapGuideGraphics.moveTo(quad[0].x, quad[0].y);
            placeObjectCenterSnapGuideGraphics.lineTo(quad[1].x, quad[1].y);
            placeObjectCenterSnapGuideGraphics.lineTo(quad[2].x, quad[2].y);
            placeObjectCenterSnapGuideGraphics.lineTo(quad[3].x, quad[3].y);
            placeObjectCenterSnapGuideGraphics.closePath();
            placeObjectCenterSnapGuideGraphics.endFill();
        }
    }

    const facingSign = Number.isFinite(guide.sectionFacingSign) ? Number(guide.sectionFacingSign) : 1;
    const insideWorld = {
        x: guide.sectionCenterX - (Number.isFinite(guide.sectionNormalX) ? guide.sectionNormalX : 0) * Math.max(0, Number(guide.wallThickness) || 0) * facingSign,
        y: guide.sectionCenterY - (Number.isFinite(guide.sectionNormalY) ? guide.sectionNormalY : 0) * Math.max(0, Number(guide.wallThickness) || 0) * facingSign
    };
    const insideScreen = worldToScreen(insideWorld);
    const topInsideScreen = {
        x: insideScreen.x,
        y: insideScreen.y - (Math.max(0, Number(guide.wallHeight) || 0) * viewscale * xyratio)
    };

    if (guide.centerSnapActive) {
        placeObjectCenterSnapGuideGraphics.lineStyle(2, 0xff0000, 0.5);
        placeObjectCenterSnapGuideGraphics.moveTo(placementCenterScreen.x, placementCenterScreen.y);
        placeObjectCenterSnapGuideGraphics.lineTo(topCenterScreen.x, topCenterScreen.y);
        placeObjectCenterSnapGuideGraphics.moveTo(topCenterScreen.x, topCenterScreen.y);
        placeObjectCenterSnapGuideGraphics.lineTo(topInsideScreen.x, topInsideScreen.y);
    }

    // Draw black top-edge markers at each end of the placed window/door span.
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
            const s = worldToScreen(pt);
            return {
                x: s.x,
                y: s.y - (Math.max(0, Number(guide.wallHeight) || 0) * viewscale * xyratio)
            };
        };
        const topFacingA = toTop(facingEndA);
        const topInsideA = toTop(insideEndA);
        const topFacingB = toTop(facingEndB);
        const topInsideB = toTop(insideEndB);
        placeObjectCenterSnapGuideGraphics.lineStyle(2, 0x000000, 0.6);
        placeObjectCenterSnapGuideGraphics.moveTo(topFacingA.x, topFacingA.y);
        placeObjectCenterSnapGuideGraphics.lineTo(topInsideA.x, topInsideA.y);
        placeObjectCenterSnapGuideGraphics.moveTo(topFacingB.x, topFacingB.y);
        placeObjectCenterSnapGuideGraphics.lineTo(topInsideB.x, topInsideB.y);
    }
    placeObjectCenterSnapGuideGraphics.visible = true;
}

function ensureSpellCursorShape(mode) {
    if (!spellCursor) return;
    if (mode === "placeobject") {
        const halfW = Math.max(1, viewscale * 0.5);
        const halfH = Math.max(1, viewscale * xyratio * 0.5);
        const shapeKey = `cross:${Math.round(halfW * 1000)}:${Math.round(halfH * 1000)}`;
        if (spellCursor._shapeKey === shapeKey) return;
        spellCursor.clear();
        spellCursor.lineStyle(1, 0x000000, 1);
        spellCursor.moveTo(-halfW, 0);
        spellCursor.lineTo(halfW, 0);
        spellCursor.moveTo(0, -halfH);
        spellCursor.lineTo(0, halfH);
        spellCursor._shapeKey = shapeKey;
        return;
    }

    const shapeKey = "default";
    if (spellCursor._shapeKey === shapeKey) return;
    spellCursor.clear();
    const cursorSize = 20;
    const tenpoints = Array.from(
        { length: 10 }, (_, i) => i * 36
    ).map(angle => ({ x: Math.cos(angle * Math.PI / 180) * cursorSize, y: Math.sin(angle * Math.PI / 180) * cursorSize }));
    const fivepoints = Array.from(
        { length: 5 }, (_, i) => i * 72 + 18
    ).map(angle => ({ x: Math.cos(angle * Math.PI / 180) * cursorSize * 0.5, y: Math.sin(angle * Math.PI / 180) * cursorSize * 0.5 }));
    spellCursor.lineStyle(2, 0x44aaff, 1);
    for (let i = 0; i < 5; i++) {
        spellCursor.moveTo(tenpoints[i * 2].x, tenpoints[i * 2].y);
        spellCursor.lineTo(fivepoints[i].x, fivepoints[i].y);
        spellCursor.lineTo(tenpoints[i * 2 + 1].x, tenpoints[i * 2 + 1].y);
    }
    spellCursor._shapeKey = shapeKey;
}

function invalidateGroundChunks() {
    groundChunkCache.forEach(chunk => {
        chunk.dirty = true;
    });
}

function buildGroundChunk(chunkX, chunkY) {
    if (!map || !map.nodes || !app || !app.renderer) return null;

    const xStart = chunkX * groundChunkTileSize;
    const yStart = chunkY * groundChunkTileSize;
    const xEnd = Math.min(map.width - 1, xStart + groundChunkTileSize - 1);
    const yEnd = Math.min(map.height - 1, yStart + groundChunkTileSize - 1);
    if (xStart > xEnd || yStart > yEnd) return null;

    const renderXStart = Math.max(0, xStart - groundChunkRenderPaddingTiles);
    const renderYStart = Math.max(0, yStart - groundChunkRenderPaddingTiles);
    const renderXEnd = Math.min(map.width - 1, xEnd + groundChunkRenderPaddingTiles);
    const renderYEnd = Math.min(map.height - 1, yEnd + groundChunkRenderPaddingTiles);

    let coreMinWorldX = Infinity;
    let coreMinWorldY = Infinity;
    let coreMaxWorldX = -Infinity;
    let coreMaxWorldY = -Infinity;

    for (let x = xStart; x <= xEnd; x++) {
        for (let y = yStart; y <= yEnd; y++) {
            const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
            if (!node) continue;
            coreMinWorldX = Math.min(coreMinWorldX, node.x - map.hexWidth / 2);
            coreMaxWorldX = Math.max(coreMaxWorldX, node.x + map.hexWidth / 2);
            coreMinWorldY = Math.min(coreMinWorldY, node.y - map.hexHeight / 2);
            coreMaxWorldY = Math.max(coreMaxWorldY, node.y + map.hexHeight / 2);
        }
    }
    if (!Number.isFinite(coreMinWorldX) || !Number.isFinite(coreMinWorldY) || !Number.isFinite(coreMaxWorldX) || !Number.isFinite(coreMaxWorldY)) {
        return null;
    }

    let minWorldX = Infinity;
    let minWorldY = Infinity;
    let maxWorldX = -Infinity;
    let maxWorldY = -Infinity;

    for (let x = renderXStart; x <= renderXEnd; x++) {
        for (let y = renderYStart; y <= renderYEnd; y++) {
            const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
            if (!node) continue;
            minWorldX = Math.min(minWorldX, node.x - map.hexWidth / 2);
            maxWorldX = Math.max(maxWorldX, node.x + map.hexWidth / 2);
            minWorldY = Math.min(minWorldY, node.y - map.hexHeight / 2);
            maxWorldY = Math.max(maxWorldY, node.y + map.hexHeight / 2);
        }
    }
    if (!Number.isFinite(minWorldX) || !Number.isFinite(minWorldY) || !Number.isFinite(maxWorldX) || !Number.isFinite(maxWorldY)) {
        return null;
    }

    const scalePadWorldX = (map.hexWidth * (groundTileOverlapScale - 1)) / 2;
    const scalePadWorldY = (map.hexHeight * (groundTileOverlapScale - 1)) / 2;
    // Preserve enough overlap for top-edge alpha feathering across chunk crop boundaries.
    const featherPadWorldX = map.hexWidth * groundTileOverlapScale * groundTileFeatherRatio;
    const featherPadWorldY = map.hexHeight * groundTileOverlapScale * groundTileFeatherRatio;
    const overlapPadWorldX = scalePadWorldX + featherPadWorldX + 0.02;
    const overlapPadWorldY = scalePadWorldY + featherPadWorldY + 0.02;
    minWorldX -= overlapPadWorldX;
    maxWorldX += overlapPadWorldX;
    minWorldY -= overlapPadWorldY;
    maxWorldY += overlapPadWorldY;

    const pixelWidth = Math.max(2, Math.ceil((maxWorldX - minWorldX) * viewscale) + 2);
    const pixelHeight = Math.max(2, Math.ceil((maxWorldY - minWorldY) * viewscale * xyratio) + 2);

    const renderTexture = PIXI.RenderTexture.create({ width: pixelWidth, height: pixelHeight });
    const chunkContainer = new PIXI.Container();
    const chunkNodes = [];

    for (let x = renderXStart; x <= renderXEnd; x++) {
        for (let y = renderYStart; y <= renderYEnd; y++) {
            const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
            if (!node) continue;
            chunkNodes.push(node);
        }
    }
    chunkNodes.sort((a, b) => {
        if (a.y !== b.y) return a.y - b.y;
        return a.x - b.x;
    });

    chunkNodes.forEach(node => {
        const textureId = Number.isFinite(node.groundTextureId) ? node.groundTextureId : 0;
        const texture = (map.groundTextures && map.groundTextures[textureId]) ? map.groundTextures[textureId] : PIXI.Texture.WHITE;
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5, 0.5);
        sprite.x = (node.x - minWorldX) * viewscale;
        sprite.y = (node.y - minWorldY) * viewscale * xyratio;
        sprite.width = map.hexWidth * viewscale * groundTileOverlapScale;
        sprite.height = map.hexHeight * viewscale * xyratio * groundTileOverlapScale;
        chunkContainer.addChild(sprite);
    });

    app.renderer.render(chunkContainer, renderTexture, true);
    chunkContainer.destroy({ children: true });

    const displayMinWorldX = coreMinWorldX - overlapPadWorldX;
    const displayMaxWorldX = coreMaxWorldX + overlapPadWorldX;
    const displayMinWorldY = coreMinWorldY - overlapPadWorldY;
    const displayMaxWorldY = coreMaxWorldY + overlapPadWorldY;

    let frameX = Math.floor((displayMinWorldX - minWorldX) * viewscale);
    let frameY = Math.floor((displayMinWorldY - minWorldY) * viewscale * xyratio);
    let frameW = Math.ceil((displayMaxWorldX - displayMinWorldX) * viewscale) + 2;
    let frameH = Math.ceil((displayMaxWorldY - displayMinWorldY) * viewscale * xyratio) + 2;

    frameX = Math.max(0, Math.min(frameX, pixelWidth - 1));
    frameY = Math.max(0, Math.min(frameY, pixelHeight - 1));
    frameW = Math.max(1, Math.min(frameW, pixelWidth - frameX));
    frameH = Math.max(1, Math.min(frameH, pixelHeight - frameY));

    const frameTexture = new PIXI.Texture(renderTexture, new PIXI.Rectangle(frameX, frameY, frameW, frameH));
    const sprite = new PIXI.Sprite(frameTexture);
    sprite.roundPixels = true;
    landLayer.addChild(sprite);

    return {
        key: getGroundChunkKey(chunkX, chunkY),
        chunkX,
        chunkY,
        minWorldX: displayMinWorldX,
        minWorldY: displayMinWorldY,
        renderTexture,
        sprite,
        dirty: false
    };
}

function ensureGroundChunk(chunkX, chunkY) {
    const key = getGroundChunkKey(chunkX, chunkY);
    const existing = groundChunkCache.get(key);
    if (existing && !existing.dirty) return existing;

    if (existing) {
        destroyGroundChunk(existing);
        groundChunkCache.delete(key);
    }

    const rebuilt = buildGroundChunk(chunkX, chunkY);
    if (!rebuilt) return null;
    groundChunkCache.set(key, rebuilt);
    return rebuilt;
}

function resolveWallDepthUvAndTexture(wall, profile) {
    if (!wall || !profile) return null;
    const { aLeft, aRight, bLeft, bRight } = profile;
    const centerA = { x: (aLeft.x + aRight.x) * 0.5, y: (aLeft.y + aRight.y) * 0.5 };
    const centerB = { x: (bLeft.x + bRight.x) * 0.5, y: (bLeft.y + bRight.y) * 0.5 };
    const dirX = centerB.x - centerA.x;
    const dirY = centerB.y - centerA.y;
    const dirLen = Math.hypot(dirX, dirY);
    const ux = dirLen > 1e-6 ? (dirX / dirLen) : 1;
    const uy = dirLen > 1e-6 ? (dirY / dirLen) : 0;
    const wallTexturePath = (typeof wall.wallTexturePath === "string" && wall.wallTexturePath.length > 0)
        ? wall.wallTexturePath
        : defaultWallTexturePath;
    const wallTextureCfg = getWallTextureConfig(wallTexturePath);
    const repeatsPerMapUnitX = Math.max(0.0001, Number(wallTextureCfg.repeatsPerMapUnitX) || defaultWallTextureRepeatsPerMapUnitX);
    const repeatsPerMapUnitY = Math.max(0.0001, Number(wallTextureCfg.repeatsPerMapUnitY) || defaultWallTextureRepeatsPerMapUnitY);
    const alongAt = pt => (pt.x * ux + pt.y * uy);
    const fallbackUStart = alongAt(centerA) * repeatsPerMapUnitX;
    const fallbackUEnd = alongAt(centerB) * repeatsPerMapUnitX;
    const uStart = Number.isFinite(wall && wall.texturePhaseA)
        ? Number(wall.texturePhaseA) * (3 * repeatsPerMapUnitX)
        : fallbackUStart;
    const uEnd = Number.isFinite(wall && wall.texturePhaseB)
        ? Number(wall.texturePhaseB) * (3 * repeatsPerMapUnitX)
        : fallbackUEnd;
    const texture = PIXI.Texture.from(wallTextureCfg.texturePath || defaultWallTexturePath);
    if (texture && texture.baseTexture) {
        texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
        texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
    }
    return {
        wallTextureCfg,
        repeatsPerMapUnitX,
        repeatsPerMapUnitY,
        uStart,
        uEnd,
        texture
    };
}

function getWallCapBasesForDepth(wall, wallHeight) {
    const adjacentHeightA = (wall && typeof wall.getAdjacentCollinearWallHeightAtEndpoint === "function")
        ? wall.getAdjacentCollinearWallHeightAtEndpoint("a")
        : null;
    const adjacentHeightB = (wall && typeof wall.getAdjacentCollinearWallHeightAtEndpoint === "function")
        ? wall.getAdjacentCollinearWallHeightAtEndpoint("b")
        : null;
    const capBaseA = Number.isFinite(adjacentHeightA)
        ? Math.max(0, Math.min(wallHeight, Number(adjacentHeightA)))
        : 0;
    const capBaseB = Number.isFinite(adjacentHeightB)
        ? Math.max(0, Math.min(wallHeight, Number(adjacentHeightB)))
        : 0;
    const capVisibleEps = 1e-5;
    return {
        capBaseA,
        capBaseB,
        renderCapA: capBaseA < (wallHeight - capVisibleEps),
        renderCapB: capBaseB < (wallHeight - capVisibleEps)
    };
}

function appendSingleWallDepthGeometry(builder, wall, profile, uvInfo, capInfo) {
    if (!builder || !wall || !profile || !uvInfo) return false;
    const wallHeight = Math.max(0.001, Number(wall.height) || 0.001);
    const wallThickness = Math.max(0.001, Number(wall.thickness) || 0.001);
    const { aLeft, aRight, bLeft, bRight } = profile;
    const wallHeightV = wallHeight * uvInfo.repeatsPerMapUnitY;
    const topThicknessV = Math.max(0.0001, wallThickness * uvInfo.repeatsPerMapUnitX);
    const capWidthV = Math.max(0.0001, wallThickness * uvInfo.repeatsPerMapUnitX);
    const capStartV0 = capInfo.capBaseA * uvInfo.repeatsPerMapUnitY;
    const capStartV1 = wallHeight * uvInfo.repeatsPerMapUnitY;
    const capEndV0 = capInfo.capBaseB * uvInfo.repeatsPerMapUnitY;
    const capEndV1 = wallHeight * uvInfo.repeatsPerMapUnitY;
    const gAL = { x: aLeft.x, y: aLeft.y, z: 0 };
    const gAR = { x: aRight.x, y: aRight.y, z: 0 };
    const gBL = { x: bLeft.x, y: bLeft.y, z: 0 };
    const gBR = { x: bRight.x, y: bRight.y, z: 0 };
    const tAL = { x: aLeft.x, y: aLeft.y, z: wallHeight };
    const tAR = { x: aRight.x, y: aRight.y, z: wallHeight };
    const tBL = { x: bLeft.x, y: bLeft.y, z: wallHeight };
    const tBR = { x: bRight.x, y: bRight.y, z: wallHeight };
    const mAL = { x: aLeft.x, y: aLeft.y, z: capInfo.capBaseA };
    const mAR = { x: aRight.x, y: aRight.y, z: capInfo.capBaseA };
    const mBL = { x: bLeft.x, y: bLeft.y, z: capInfo.capBaseB };
    const mBR = { x: bRight.x, y: bRight.y, z: capInfo.capBaseB };

    appendDepthQuad(builder, gAL, gBL, tBL, tAL, { u0: uvInfo.uStart, v0: 0, u1: uvInfo.uEnd, v1: wallHeightV });
    appendDepthQuad(builder, gAR, gBR, tBR, tAR, { u0: uvInfo.uStart, v0: 0, u1: uvInfo.uEnd, v1: wallHeightV });
    appendDepthQuad(builder, tAL, tBL, tBR, tAR, { u0: uvInfo.uStart, v0: 0, u1: uvInfo.uEnd, v1: topThicknessV });
    if (capInfo.renderCapA) {
        appendDepthQuad(builder, mAR, mAL, tAL, tAR, { u0: 0, v0: capStartV0, u1: capWidthV, v1: capStartV1 });
    }
    if (capInfo.renderCapB) {
        appendDepthQuad(builder, mBL, mBR, tBR, tBL, { u0: 0, v0: capEndV0, u1: capWidthV, v1: capEndV1 });
    }
    return true;
}

function buildWallOpaqueDepthGeometry(item, range) {
    if (!item || typeof item.getWallProfile !== "function") return null;
    const profile = item.getWallProfile();
    if (!profile) return null;
    const uvInfo = resolveWallDepthUvAndTexture(item, profile);
    if (!uvInfo) return null;
    const wallHeight = Math.max(0.001, Number(item.height) || 0.001);
    const capInfo = getWallCapBasesForDepth(item, wallHeight);
    const cacheKey = [
        Number(profile.aLeft.x).toFixed(4), Number(profile.aLeft.y).toFixed(4),
        Number(profile.aRight.x).toFixed(4), Number(profile.aRight.y).toFixed(4),
        Number(profile.bLeft.x).toFixed(4), Number(profile.bLeft.y).toFixed(4),
        Number(profile.bRight.x).toFixed(4), Number(profile.bRight.y).toFixed(4),
        wallHeight.toFixed(4),
        Number(item.thickness || 0).toFixed(4),
        uvInfo.uStart.toFixed(4),
        uvInfo.uEnd.toFixed(4),
        uvInfo.repeatsPerMapUnitX.toFixed(6),
        uvInfo.repeatsPerMapUnitY.toFixed(6),
        capInfo.capBaseA.toFixed(4),
        capInfo.capBaseB.toFixed(4),
        capInfo.renderCapA ? "1" : "0",
        capInfo.renderCapB ? "1" : "0",
        uvInfo.wallTextureCfg.texturePath || defaultWallTexturePath
    ].join("|");
    if (item._wallDepthGeometryCache && item._wallDepthGeometryCache.key === cacheKey) {
        return item._wallDepthGeometryCache.geometry;
    }

    const builder = { positions: [], uvs: [], indices: [], vertexCount: 0 };
    appendSingleWallDepthGeometry(builder, item, profile, uvInfo, capInfo);
    if (builder.vertexCount === 0) return null;
    const geometry = {
        positions: new Float32Array(builder.positions),
        uvs: new Float32Array(builder.uvs),
        indices: new Uint16Array(builder.indices),
        texture: uvInfo.texture || PIXI.Texture.WHITE,
        alphaCutoff: 0.02
    };
    item._wallDepthGeometryCache = { key: cacheKey, geometry };
    return geometry;
}

function buildWallSectionCompositeOpaqueDepthGeometry(item, range) {
    if (!item || item.type !== "wallSectionComposite") return null;
    const walls = Array.isArray(item._sectionMemberWalls) ? item._sectionMemberWalls : [];
    if (walls.length === 0) return null;
    const cacheKey = [
        String(item._sectionCompositeMembershipSignature || ""),
        String(Number.isInteger(item.lineGroupId) ? item.lineGroupId : "na"),
        String(walls.length)
    ].join("|");
    if (item._sectionDepthGeometryCache && item._sectionDepthGeometryCache.key === cacheKey) {
        return item._sectionDepthGeometryCache.geometry;
    }

    const builder = { positions: [], uvs: [], indices: [], vertexCount: 0 };
    let sharedTexture = null;
    for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        if (!wall || typeof wall.getWallProfile !== "function") continue;
        const profile = wall.getWallProfile();
        if (!profile) continue;
        const uvInfo = resolveWallDepthUvAndTexture(wall, profile);
        if (!uvInfo) continue;
        if (!sharedTexture) sharedTexture = uvInfo.texture;
        const wallHeight = Math.max(0.001, Number(wall.height) || 0.001);
        const capInfo = getWallCapBasesForDepth(wall, wallHeight);
        appendSingleWallDepthGeometry(builder, wall, profile, uvInfo, capInfo);
    }
    if (builder.vertexCount === 0) return null;
    const geometry = {
        positions: new Float32Array(builder.positions),
        uvs: new Float32Array(builder.uvs),
        indices: new Uint16Array(builder.indices),
        texture: sharedTexture || PIXI.Texture.from(defaultWallTexturePath),
        alphaCutoff: 0.02
    };
    item._sectionDepthGeometryCache = { key: cacheKey, geometry };
    return geometry;
}

function buildRoofOpaqueDepthGeometry(item, range) {
    if (!item || item.type !== "roof" || !Array.isArray(item.vertices) || !Array.isArray(item.faces)) return null;
    const builder = { positions: [], uvs: [], indices: [], vertexCount: 0 };
    const scale = 0.05;
    for (let i = 0; i < item.faces.length; i++) {
        const face = item.faces[i];
        if (!Array.isArray(face) || face.length < 3) continue;
        const v0 = item.vertices[face[0]];
        const v1 = item.vertices[face[1]];
        const v2 = item.vertices[face[2]];
        if (!v0 || !v1 || !v2) continue;
        const p0 = { x: item.x + v0.x, y: item.y + v0.y, z: Number(v0.z) || 0 };
        const p1 = { x: item.x + v1.x, y: item.y + v1.y, z: Number(v1.z) || 0 };
        const p2 = { x: item.x + v2.x, y: item.y + v2.y, z: Number(v2.z) || 0 };
        appendDepthTriangle(
            builder,
            p0,
            p1,
            p2,
            { u: 0.5 + v0.x * scale, v: 0.5 + v0.y * scale },
            { u: 0.5 + v1.x * scale, v: 0.5 + v1.y * scale },
            { u: 0.5 + v2.x * scale, v: 0.5 + v2.y * scale }
        );
    }
    if (builder.vertexCount === 0) return null;
    const texturePath = (typeof item.textureName === "string" && item.textureName.length > 0)
        ? item.textureName
        : "assets/images/smallshingles.png";
    return {
        positions: new Float32Array(builder.positions),
        uvs: new Float32Array(builder.uvs),
        indices: new Uint16Array(builder.indices),
        texture: PIXI.Texture.from(texturePath),
        alphaCutoff: 0.02
    };
}

function buildBillboardOpaqueDepthGeometry(item, range) {
    if (!item || !item.pixiSprite || !item.pixiSprite.texture) return null;
    const texture = item.pixiSprite.texture;
    const width = Math.max(0.01, Number.isFinite(item.width) ? Number(item.width) : 1);
    const height = Math.max(0.01, Number.isFinite(item.height) ? Number(item.height) : 1);
    const yIsoScale = Math.max(0.0001, Math.abs(Number.isFinite(xyratio) ? Number(xyratio) : 0.66));
    // Match legacy sprite apparent height: non-road sprites were not Y-squashed.
    const verticalWorldHeight = height / yIsoScale;
    const anchorX = (item.pixiSprite.anchor && Number.isFinite(item.pixiSprite.anchor.x)) ? Number(item.pixiSprite.anchor.x) : 0.5;
    const anchorY = (item.pixiSprite.anchor && Number.isFinite(item.pixiSprite.anchor.y)) ? Number(item.pixiSprite.anchor.y) : 1;
    const rotationDeg = (isPlacedObjectEntity(item) && Number.isFinite(item.placementRotation))
        ? Number(item.placementRotation)
        : 0;
    const theta = rotationDeg * (Math.PI / 180);
    const axisX = Math.cos(theta);
    const axisY = Math.sin(theta);
    const halfWidth = width * 0.5;
    const centerX = Number.isFinite(item.x) ? item.x : 0;
    const centerY = Number.isFinite(item.y) ? item.y : 0;
    const alongOffset = (anchorX - 0.5) * width;
    const zBottom = -((1 - anchorY) * verticalWorldHeight);
    const zTop = zBottom + verticalWorldHeight;
    const baseX = centerX - axisX * alongOffset;
    const baseY = centerY - axisY * alongOffset;
    const blWorld = { x: baseX - axisX * halfWidth, y: baseY - axisY * halfWidth };
    const brWorld = { x: baseX + axisX * halfWidth, y: baseY + axisY * halfWidth };

    const pBL = { x: blWorld.x, y: blWorld.y, z: zBottom };
    const pBR = { x: brWorld.x, y: brWorld.y, z: zBottom };
    const pTR = { x: brWorld.x, y: brWorld.y, z: zTop };
    const pTL = { x: blWorld.x, y: blWorld.y, z: zTop };

    const builder = { positions: [], uvs: [], indices: [], vertexCount: 0 };
    appendDepthQuad(builder, pBL, pBR, pTR, pTL);
    return {
        positions: new Float32Array(builder.positions),
        uvs: new Float32Array(builder.uvs),
        indices: new Uint16Array(builder.indices),
        texture,
        alphaCutoff: 0.25
    };
}

function closestPointOnSegment2D(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (!(len2 > 1e-8)) {
        const ddx = px - ax;
        const ddy = py - ay;
        return { x: ax, y: ay, t: 0, dist2: ddx * ddx + ddy * ddy };
    }
    const rawT = ((px - ax) * dx + (py - ay) * dy) / len2;
    const t = Math.max(0, Math.min(1, rawT));
    const x = ax + dx * t;
    const y = ay + dy * t;
    const ddx = px - x;
    const ddy = py - y;
    return { x, y, t, dist2: ddx * ddx + ddy * ddy };
}

function getMountedWallFaceCenters(item) {
    const mountedId = Number.isInteger(item && item.mountedWallLineGroupId)
        ? Number(item.mountedWallLineGroupId)
        : null;
    if (!Number.isInteger(mountedId)) return null;
    const worldX = Number(item && item.x);
    const worldY = Number(item && item.y);
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;

    let walls = null;
    const wallClass = (typeof Wall !== "undefined") ? Wall : null;
    const sectionRegistry = wallClass && wallClass._sectionsById instanceof Map
        ? wallClass._sectionsById
        : null;
    const sectionEntry = sectionRegistry ? sectionRegistry.get(mountedId) : null;
    if (sectionEntry && Array.isArray(sectionEntry.walls) && sectionEntry.walls.length > 0) {
        walls = sectionEntry.walls;
    } else if (map && Array.isArray(map.objects)) {
        walls = map.objects.filter(obj =>
            obj &&
            obj.type === "wall" &&
            Number.isInteger(obj.lineGroupId) &&
            Number(obj.lineGroupId) === mountedId &&
            typeof obj.getWallProfile === "function"
        );
    }
    if (!Array.isArray(walls) || walls.length === 0) return null;

    let best = null;
    for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        if (!wall || typeof wall.getWallProfile !== "function") continue;
        const profile = wall.getWallProfile();
        if (!profile || !profile.aLeft || !profile.bLeft || !profile.aRight || !profile.bRight) continue;
        const left = closestPointOnSegment2D(
            worldX, worldY,
            Number(profile.aLeft.x), Number(profile.aLeft.y),
            Number(profile.bLeft.x), Number(profile.bLeft.y)
        );
        const right = closestPointOnSegment2D(
            worldX, worldY,
            Number(profile.aRight.x), Number(profile.aRight.y),
            Number(profile.bRight.x), Number(profile.bRight.y)
        );
        const score = Math.min(left.dist2, right.dist2);
        if (!best || score < best.score) {
            best = { left, right, score };
        }
    }
    if (!best) return null;

    const facingSign = Number.isFinite(item && item.mountedWallFacingSign)
        ? Number(item.mountedWallFacingSign)
        : 1;
    const frontRaw = (facingSign >= 0) ? best.left : best.right;
    const backRaw = (facingSign >= 0) ? best.right : best.left;
    let nx = frontRaw.x - backRaw.x;
    let ny = frontRaw.y - backRaw.y;
    const nLen = Math.hypot(nx, ny);
    if (!(nLen > 1e-6)) return null;
    nx /= nLen;
    ny /= nLen;
    const eps = 0.01;
    return {
        front: { x: frontRaw.x + nx * eps, y: frontRaw.y + ny * eps },
        back: { x: backRaw.x - nx * eps, y: backRaw.y - ny * eps }
    };
}

function buildMountedWallOpaqueDepthGeometry(item, range) {
    if (!item || !isWallMountedPlaceable(item) || item.rotationAxis !== "spatial") return null;
    const texturePath = (typeof item.texturePath === "string" && item.texturePath.length > 0)
        ? item.texturePath
        : null;
    const texture = texturePath ? PIXI.Texture.from(texturePath) : (item.pixiSprite && item.pixiSprite.texture);
    if (!texture) return null;

    const width = Math.max(0.01, Number.isFinite(item.width) ? Number(item.width) : 1);
    const height = Math.max(0.01, Number.isFinite(item.height) ? Number(item.height) : 1);
    const yIsoScale = Math.max(0.0001, Math.abs(Number.isFinite(xyratio) ? Number(xyratio) : 0.66));
    const verticalWorldHeight = height / yIsoScale;
    const anchorX = Number.isFinite(item.placeableAnchorX) ? Number(item.placeableAnchorX) : 0.5;
    const anchorY = Number.isFinite(item.placeableAnchorY) ? Number(item.placeableAnchorY) : 1;
    const angleDeg = Number.isFinite(item.placementRotation) ? Number(item.placementRotation) : 0;
    const theta = angleDeg * (Math.PI / 180);
    const axisX = Math.cos(theta);
    const axisY = Math.sin(theta);
    const faceSignRaw = Number.isFinite(item.mountedWallFacingSign) ? Number(item.mountedWallFacingSign) : 1;
    const faceSign = faceSignRaw >= 0 ? 1 : -1;
    let normalX = (-axisY) * faceSign;
    let normalY = axisX * faceSign;
    const normalLen = Math.hypot(normalX, normalY);
    if (!(normalLen > 1e-6)) return null;
    normalX /= normalLen;
    normalY /= normalLen;
    const faceCenters = getMountedWallFaceCenters(item);
    if (!faceCenters) return null;

    const cacheKey = [
        Number(item.x || 0).toFixed(4),
        Number(item.y || 0).toFixed(4),
        width.toFixed(4),
        verticalWorldHeight.toFixed(4),
        anchorX.toFixed(4),
        anchorY.toFixed(4),
        angleDeg.toFixed(4),
        faceSign,
        Number(yIsoScale).toFixed(4),
        faceCenters && Number.isFinite(faceCenters.front && faceCenters.front.x) ? Number(faceCenters.front.x).toFixed(4) : "na",
        faceCenters && Number.isFinite(faceCenters.front && faceCenters.front.y) ? Number(faceCenters.front.y).toFixed(4) : "na",
        faceCenters && Number.isFinite(faceCenters.back && faceCenters.back.x) ? Number(faceCenters.back.x).toFixed(4) : "na",
        faceCenters && Number.isFinite(faceCenters.back && faceCenters.back.y) ? Number(faceCenters.back.y).toFixed(4) : "na",
        texturePath || "__sprite_tex__"
    ].join("|");
    if (item._mountedDepthGeometryCache && item._mountedDepthGeometryCache.key === cacheKey) {
        return item._mountedDepthGeometryCache.geometry;
    }

    const halfWidth = width * 0.5;
    const alongOffset = (anchorX - 0.5) * width;
    const zBottom = -((1 - anchorY) * verticalWorldHeight);
    const zTop = zBottom + verticalWorldHeight;

    const frontCenterX = Number(faceCenters.front.x);
    const frontCenterY = Number(faceCenters.front.y);
    const backCenterX = Number(faceCenters.back.x);
    const backCenterY = Number(faceCenters.back.y);

    const centerWithAnchor = (cx, cy) => ({
        x: cx - axisX * alongOffset,
        y: cy - axisY * alongOffset
    });
    const frontBase = centerWithAnchor(frontCenterX, frontCenterY);
    const backBase = centerWithAnchor(backCenterX, backCenterY);

    const frontBL = { x: frontBase.x - axisX * halfWidth, y: frontBase.y - axisY * halfWidth, z: zBottom };
    const frontBR = { x: frontBase.x + axisX * halfWidth, y: frontBase.y + axisY * halfWidth, z: zBottom };
    const frontTR = { x: frontBR.x, y: frontBR.y, z: zTop };
    const frontTL = { x: frontBL.x, y: frontBL.y, z: zTop };

    const backBL = { x: backBase.x - axisX * halfWidth, y: backBase.y - axisY * halfWidth, z: zBottom };
    const backBR = { x: backBase.x + axisX * halfWidth, y: backBase.y + axisY * halfWidth, z: zBottom };
    const backTR = { x: backBR.x, y: backBR.y, z: zTop };
    const backTL = { x: backBL.x, y: backBL.y, z: zTop };

    const builder = { positions: [], uvs: [], indices: [], vertexCount: 0 };
    appendDepthQuad(builder, frontBL, frontBR, frontTR, frontTL);
    // Mirror the back face texture.
    appendDepthQuad(builder, backBL, backBR, backTR, backTL, { u0: 1, v0: 0, u1: 0, v1: 1 });

    const geometry = {
        positions: new Float32Array(builder.positions),
        uvs: new Float32Array(builder.uvs),
        indices: new Uint16Array(builder.indices),
        texture,
        alphaCutoff: 0.25
    };
    item._mountedDepthGeometryCache = { key: cacheKey, geometry };
    return geometry;
}

function buildOpaqueDepthGeometryForItem(item, range) {
    if (!item) return null;
    if (item.type === "wall") return buildWallOpaqueDepthGeometry(item, range);
    if (item.type === "wallSectionComposite") return buildWallSectionCompositeOpaqueDepthGeometry(item, range);
    if (item.type === "roof") return buildRoofOpaqueDepthGeometry(item, range);
    if (isWallMountedPlaceable(item) && item.rotationAxis === "spatial") {
        const mounted = buildMountedWallOpaqueDepthGeometry(item, range);
        if (mounted) return mounted;
    }
    return buildBillboardOpaqueDepthGeometry(item, range);
}

function getOpaqueDepthDisplayObject(item, options = {}) {
    if (!opaqueDepthMeshEnabled || !item || typeof PIXI === "undefined") return null;
    const mesh = ensureItemOpaqueDepthMesh(item);
    if (!mesh || !mesh.shader || !mesh.shader.uniforms) return null;
    const range = getDepthMetricRange();
    const geometry = buildOpaqueDepthGeometryForItem(item, range);
    if (!geometry) return null;
    if (item._opaqueDepthLastGeometry !== geometry) {
        if (!setOpaqueDepthMeshGeometry(mesh, geometry.positions, geometry.uvs, geometry.indices)) return null;
        item._opaqueDepthLastGeometry = geometry;
    }
    const uniforms = mesh.shader.uniforms;
    const screenW = (app && app.screen && Number.isFinite(app.screen.width)) ? app.screen.width : 1;
    const screenH = (app && app.screen && Number.isFinite(app.screen.height)) ? app.screen.height : 1;
    uniforms.uScreenSize[0] = screenW;
    uniforms.uScreenSize[1] = screenH;
    const camera = range && range.camera ? range.camera : viewport;
    uniforms.uCameraWorld[0] = Number(camera.x) || 0;
    uniforms.uCameraWorld[1] = Number(camera.y) || 0;
    uniforms.uViewScale = Number(viewscale) || 1;
    uniforms.uXyRatio = Number(xyratio) || 1;
    uniforms.uDepthRange[0] = Number(range.farMetric) || 180;
    uniforms.uDepthRange[1] = Number(range.invSpan) || (1 / 256);
    uniforms.uSampler = geometry.texture || PIXI.Texture.WHITE;
    uniforms.uTint = tintHexToUniform(options.tint, options.alpha);
    uniforms.uAlphaCutoff = Number.isFinite(geometry.alphaCutoff) ? Number(geometry.alphaCutoff) : 0.1;
    mesh.visible = true;
    return mesh;
}

function drawCanvas() {
    if (!wizard) return;
    const perfStartMs = performance.now();
    const drawPerf = {
        lazyMs: 0,
        prepMs: 0,
        collectMs: 0,
        losMs: 0,
        passWorldMs: 0,
        passLosMs: 0,
        passObjectsMs: 0,
        passPostMs: 0,
        composeMs: 0,
        composeMaskMs: 0,
        composeSortMs: 0,
        composePopulateMs: 0,
        composeInvariantMs: 0,
        composeWallSectionsMs: 0,
        composeWallSectionsGroups: 0,
        composeWallSectionsRebuilt: 0,
        composeUnaccountedMs: 0,
        composeInvariantSkipped: 0,
        totalMs: 0,
        hydratedRoads: 0,
        hydratedTrees: 0,
        mapItems: 0,
        onscreen: 0
    };
    const renderCamera = (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
        ? interpolatedViewport
        : viewport;
    const lazyStartMs = performance.now();
    if (typeof hydrateVisibleLazyRoads === "function") {
        drawPerf.hydratedRoads = hydrateVisibleLazyRoads({ maxPerFrame: 48, paddingWorld: 12 }) || 0;
    }
    if (typeof hydrateVisibleLazyTrees === "function") {
        drawPerf.hydratedTrees = hydrateVisibleLazyTrees({ maxPerFrame: 48, paddingWorld: 12 }) || 0;
    }
    drawPerf.lazyMs = performance.now() - lazyStartMs;
    const frameNowMs = (typeof renderNowMs === "number" && Number.isFinite(renderNowMs) && renderNowMs > 0)
        ? renderNowMs
        : performance.now();
    if (!Number.isFinite(lastRenderFrameMs) || lastRenderFrameMs <= 0) {
        lastRenderFrameMs = frameNowMs;
    }
    const frameDtSec = Math.max(0, (frameNowMs - lastRenderFrameMs) / 1000);
    lastRenderFrameMs = frameNowMs;
    const losFadeTimeSec = 0.05;
    const losLerpFactor = (losFadeTimeSec <= 0)
        ? 1
        : (1 - Math.exp(-frameDtSec / losFadeTimeSec));
    const overlapCache = new WeakMap();
    function groundHitboxLikelyIntersectsCached(aHitbox, bHitbox) {
        if (!aHitbox || !bHitbox) return false;
        if (aHitbox === bHitbox) return true;
        if (typeof aHitbox !== "object" || typeof bHitbox !== "object") {
            return groundHitboxLikelyIntersectsHitbox(aHitbox, bHitbox);
        }
        let mapForA = overlapCache.get(aHitbox);
        if (mapForA && mapForA.has(bHitbox)) return mapForA.get(bHitbox);
        let mapForB = overlapCache.get(bHitbox);
        if (mapForB && mapForB.has(aHitbox)) return mapForB.get(aHitbox);
        const result = groundHitboxLikelyIntersectsHitbox(aHitbox, bHitbox);
        if (!mapForA) {
            mapForA = new WeakMap();
            overlapCache.set(aHitbox, mapForA);
        }
        mapForA.set(bHitbox, result);
        if (!mapForB) {
            mapForB = new WeakMap();
            overlapCache.set(bHitbox, mapForB);
        }
        mapForB.set(aHitbox, result);
        return result;
    }

    let mapItems = [];
    let roadItems = [];
    let omnivisionActive = false;
    let losForwardFovDegrees = 200;
    let losMaxDarken = 0.5;
    let objectLitTransparencyEnabled = false;
    let houseHitbox = null;
    let wizardInsideHouse = false;
    let composeStartMs = 0;

    function renderWorldPass() {
    const passWorldStartMs = performance.now();
    const prepStartMs = performance.now();
    const debugRedrawPlan = getDebugRedrawPlan();
    updateRoofPreview(roof);
    // Update land layer position (tiling background)
    updateLandLayer();

    // Keep grid locked to camera movement; redraw every frame when visible.
    drawHexGrid(showHexGrid || debugMode ? true : debugRedrawPlan.hex);
    drawMapBorder();
    drawGroundPlaneHitboxes(debugRedrawPlan.ground);

    // Clear and rebuild render layers
    if (roadLayer) {
        roadLayer.removeChildren();
    }
    if (opaqueMeshLayer) {
        opaqueMeshLayer.removeChildren();
    }
    objectLayer.removeChildren();
    if (indoorObjectLayer) {
        indoorObjectLayer.removeChildren();
    }

    // Keep phantom wall visible during layout mode
    if (wizard.wallLayoutMode && wizard.wallStartPoint && wizard.phantomWall) {
        const adjustedWallDragPoint = (
            typeof SpellSystem !== "undefined" &&
            SpellSystem &&
            typeof SpellSystem.getAdjustedWallDragWorldPoint === "function"
        ) ? SpellSystem.getAdjustedWallDragWorldPoint(wizard, mousePos.worldX, mousePos.worldY) : null;
        const dragWorldX = adjustedWallDragPoint && Number.isFinite(adjustedWallDragPoint.x)
            ? adjustedWallDragPoint.x
            : mousePos.worldX;
        const dragWorldY = adjustedWallDragPoint && Number.isFinite(adjustedWallDragPoint.y)
            ? adjustedWallDragPoint.y
            : mousePos.worldY;
        updatePhantomWall(wizard.wallStartPoint.x, wizard.wallStartPoint.y, dragWorldX, dragWorldY);
        objectLayer.addChild(wizard.phantomWall);
    }

    // Keep phantom road visible during layout mode
    if (wizard.roadLayoutMode && wizard.roadStartPoint && wizard.phantomRoad) {
        updatePhantomRoad(wizard.roadStartPoint.x, wizard.roadStartPoint.y, mousePos.worldX, mousePos.worldY);
        if (roadLayer) {
            roadLayer.addChild(wizard.phantomRoad);
        } else {
            objectLayer.addChild(wizard.phantomRoad);
        }
    }
    drawPerf.prepMs = performance.now() - prepStartMs;

    const collectStartMs = performance.now();
    mapItems = [];
    roadItems = [];
    const seenMapItems = new Set();
    const seenRoadItems = new Set();
    onscreenObjects.clear();

    if (map && map.nodes) {
        // Keep large trees in the object set before their base tile reaches the viewport.
        // This prevents tall trees from "popping in" at the top/bottom edges.
        const maxExpectedTreeSize = 20;
        const maxTreeWidth = maxExpectedTreeSize;
        const maxTreeHeight = maxExpectedTreeSize;
        const xPadding = Math.ceil(maxTreeWidth / 2) + 2;
        const yPadding = Math.ceil(maxTreeHeight) + 2;

        forEachWrappedNodeInViewport(xPadding, yPadding, (node) => {
            if (!node.objects || node.objects.length === 0) return;
            node.objects.forEach(obj => {
                if (!obj || seenMapItems.has(obj)) return;
                seenMapItems.add(obj);
                if (obj && obj.type === "road") {
                    if (!seenRoadItems.has(obj)) {
                        seenRoadItems.add(obj);
                        roadItems.push(obj);
                    }
                    mapItems.push(obj);
                    if (obj && obj.visualHitbox && !obj.gone && !obj.vanishing) {
                        onscreenObjects.add(obj);
                    }
                } else {
                    mapItems.push(obj);
                    if (obj && (obj.visualHitbox || obj.hitbox) && !obj.gone && !obj.vanishing) {
                        onscreenObjects.add(obj);
                    }
                }
            });
        }, renderCamera);
    }
    animals.forEach(animal => {
        if (animal.onScreen) {
            mapItems.push(animal);
            onscreenObjects.add(animal);
        }
    });
    // Roof is rendered through a separate path, so include it explicitly
    // in onscreenObjects for debugging/console inspection.
    if (roof && roof.placed && roof.pixiMesh && roof.pixiMesh.visible) {
        onscreenObjects.add(roof);
    }
    drawPerf.collectMs = performance.now() - collectStartMs;
    drawPerf.mapItems = mapItems.length;
    drawPerf.onscreen = onscreenObjects.size;
    drawPerf.passWorldMs = performance.now() - passWorldStartMs;
    }

    function renderLosPass() {
    const passLosStartMs = performance.now();
    const activeAuras = (wizard && Array.isArray(wizard.activeAuras))
        ? wizard.activeAuras
        : ((wizard && typeof wizard.activeAura === "string") ? [wizard.activeAura] : []);
    omnivisionActive = activeAuras.includes("omnivision");
    const losForwardFovDegreesRaw = Number(getLosVisualSetting("forwardFovDegrees", 200));
    losForwardFovDegrees = Number.isFinite(losForwardFovDegreesRaw)
        ? Math.max(0, Math.min(360, losForwardFovDegreesRaw))
        : 200;
    const losMaxDarkenRaw = Number(getLosVisualSetting("maxDarken", 0.5));
    losMaxDarken = Number.isFinite(losMaxDarkenRaw)
        ? Math.max(0, Math.min(1, losMaxDarkenRaw))
        : 0.5;
    objectLitTransparencyEnabled = !!getLosVisualSetting("objectLitTransparencyEnabled", false);
    houseHitbox = (roof && roof.placed && roof.groundPlaneHitbox) ? roof.groundPlaneHitbox : null;
    wizardInsideHouse = !!(wizard && houseHitbox && hitboxContainsWorldPoint(houseHitbox, wizard.x, wizard.y));
    let losPerfMs = 0;

    if (!omnivisionActive && typeof LOSSystem !== "undefined" && LOSSystem && typeof LOSSystem.computeState === "function") {
        const losBuildStartMs = performance.now();
        const losCandidates = [];
        const losWindowOpenings = [];
        if (onscreenObjects && onscreenObjects.size > 0) {
            onscreenObjects.forEach(obj => {
                if (!obj || obj === wizard || obj.gone || obj.vanishing) return;
                if (
                    isPlacedObjectEntity(obj) &&
                    typeof obj.category === "string" &&
                    obj.category.trim().toLowerCase() === "windows" &&
                    obj.groundPlaneHitbox
                ) {
                    losWindowOpenings.push(obj);
                }
                if (isLosOccluder(obj)) losCandidates.push(obj);
            });
        }
        const losBuildMs = performance.now() - losBuildStartMs;
        const candidateCount = losCandidates.length;
        const candidateHash = computeLosCandidateHash(losCandidates);
        const facingAngle = getWizardFacingAngleRad();
        const movedDx = (map && typeof map.shortestDeltaX === "function" && Number.isFinite(lastLosWizardX))
            ? map.shortestDeltaX(lastLosWizardX, wizard.x)
            : (Number.isFinite(lastLosWizardX) ? (wizard.x - lastLosWizardX) : Infinity);
        const movedDy = (map && typeof map.shortestDeltaY === "function" && Number.isFinite(lastLosWizardY))
            ? map.shortestDeltaY(lastLosWizardY, wizard.y)
            : (Number.isFinite(lastLosWizardY) ? (wizard.y - lastLosWizardY) : Infinity);
        const movedDist = Math.hypot(movedDx, movedDy);
        const facingDelta = Number.isFinite(lastLosFacingAngle)
            ? Math.abs(Math.atan2(Math.sin(facingAngle - lastLosFacingAngle), Math.cos(facingAngle - lastLosFacingAngle)))
            : Infinity;
        const structuralChange = (
            !currentLosState ||
            candidateCount !== lastLosCandidateCount ||
            candidateHash !== lastLosCandidateHash
        );
        const losThrottleMs = 33; // ~30 Hz LOS updates are usually sufficient.
        const timeSinceLastLosMs = Number.isFinite(lastLosComputeAtMs) ? (frameNowMs - lastLosComputeAtMs) : Infinity;
        const shouldRecomputeLos = (
            structuralChange ||
            movedDist > 0.03 ||
            facingDelta > 0.05 ||
            timeSinceLastLosMs >= losThrottleMs
        );
        let losTraceMs = 0;

        if (shouldRecomputeLos) {
            currentLosState = LOSSystem.computeState(wizard, losCandidates, {
                bins: 3600, // 0.1 degree bins for occluder edge sorting; more bins increases accuracy but also increases compute time.
                facingAngle,
                fovDegrees: losForwardFovDegrees,
                windowOpenings: losWindowOpenings
            });
            currentLosVisibleSet = new Set(currentLosState.visibleObjects || []);
            losTraceMs = Number.isFinite(currentLosState.elapsedMs) ? currentLosState.elapsedMs : 0;
            lastLosWizardX = wizard.x;
            lastLosWizardY = wizard.y;
            lastLosFacingAngle = facingAngle;
            lastLosCandidateCount = candidateCount;
            lastLosCandidateHash = candidateHash;
            lastLosComputeAtMs = frameNowMs;
        }
        if (typeof globalThis !== "undefined") {
            globalThis.losDebugVisibleObjects = currentLosState.visibleObjects || [];
            globalThis.losDebugLastMs = losBuildMs + losTraceMs;
            globalThis.losDebugBreakdown = {
                buildMs: losBuildMs,
                traceMs: losTraceMs,
                totalMs: losBuildMs + losTraceMs,
                recomputed: shouldRecomputeLos,
                candidates: candidateCount
            };
        }
        losPerfMs = losBuildMs + losTraceMs;
    } else {
        currentLosState = null;
        currentLosVisibleSet = null;
        lastLosWizardX = null;
        lastLosWizardY = null;
        lastLosFacingAngle = null;
        lastLosCandidateCount = -1;
        lastLosCandidateHash = 0;
        lastLosComputeAtMs = 0;
        if (typeof globalThis !== "undefined") {
            globalThis.losDebugVisibleObjects = [];
            globalThis.losDebugLastMs = 0;
            globalThis.losDebugBreakdown = {
                buildMs: 0,
                traceMs: 0,
                totalMs: 0,
                recomputed: false,
                candidates: 0
            };
        }
        losPerfMs = 0;
    }
    drawPerf.losMs = losPerfMs;
    composeStartMs = performance.now();
    const composeMaskStartMs = performance.now();
    applyLosGroundMask();
    applyLosShadow();
    updateLosObjectTransparencyMask();
    drawPerf.composeMaskMs = performance.now() - composeMaskStartMs;
    drawPerf.passLosMs = performance.now() - passLosStartMs;
    }

    function renderObjectsPass() {
    const passObjectsStartMs = performance.now();

    // Process vanishing roads and update the list before rendering
    roadItems = roadItems.filter(road => {
        if (road.vanishing && road.vanishStartTime !== undefined) {
            const elapsedFrames = frameCount - road.vanishStartTime;
            const progress = Math.min(1, elapsedFrames / road.vanishDuration);

            // Mark for removal when fully vanished
            if (progress >= 1) {
                road.removeFromNodes();
                return false; // Remove from array
            }
        }
        return true; // Keep in array
    });

    // Legacy road mask layer disabled; roads render as regular sprites.

    wizardCoors = worldToScreen(wizard);

    function getRenderBottomZ(item) {
        if (!item) return 0;
        const baseZ = Number.isFinite(item.bottomZ)
            ? Number(item.bottomZ)
            : (Number.isFinite(item.z) ? Number(item.z) : 0);
        return baseZ + getWallMountedDepthBias(item);
    }

    function getRenderTopZ(item) {
        const bottomZ = getRenderBottomZ(item);
        const height = Number.isFinite(item && item.height) ? Math.max(0, Number(item.height)) : 0;
        return bottomZ + height;
    }

    function getRenderAnchorY(item) {
        if (!item) return 0;
        if (Number.isFinite(item.anchorYSort)) return Number(item.anchorYSort);
        if (Number.isFinite(item.y)) return Number(item.y);
        return 0;
    }

    if (roof && roof.placed && roof.pixiMesh && roof.pixiMesh.visible) {
        const roofBottomZ = Number.isFinite(roof.z)
            ? Number(roof.z)
            : (Number.isFinite(roof.heightFromGround) ? Number(roof.heightFromGround) : 0);
        const roofHeight = (
            Number.isFinite(roof.peakHeight) && Number.isFinite(roof.heightFromGround)
        ) ? Math.max(0, Number(roof.peakHeight) - Number(roof.heightFromGround))
            : (Number.isFinite(roof.peakHeight) ? Math.max(0, Number(roof.peakHeight)) : 0);
        mapItems.push({
            type: "roof",
            x: roof.x,
            y: roof.y,
            z: roofBottomZ,
            height: roofHeight,
            pixiSprite: roof.pixiMesh,
            vertices: Array.isArray(roof.vertices) ? roof.vertices : [],
            faces: Array.isArray(roof.faces) ? roof.faces : [],
            textureName: roof.textureName
        });
    }
    const placePreviewItem = buildPlaceObjectPreviewRenderItem();
    if (placePreviewItem) {
        mapItems.push(placePreviewItem);
    }
    let wallSectionHiddenItems = new Set();
    const composeWallSectionsStartMs = performance.now();
    if (wallSectionBatchingEnabled) {
        const wallSections = getWallSectionsRendererApi();
        const sectionCamera = (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
            ? interpolatedViewport
            : viewport;
        if (wallSections && typeof wallSections.buildCompositeRenderItems === "function") {
            wallSections.prepareFrame(viewscale, xyratio);
            const sectionResult = wallSections.buildCompositeRenderItems({
                enabled: wallSectionBatchingEnabled,
                items: mapItems,
                cachePrefix: "world",
                camera: sectionCamera,
                map,
                app,
                PIXI,
                viewscale,
                xyratio,
                isWallMountedPlaceable
            });
            const compositeItems = (sectionResult && Array.isArray(sectionResult.renderItems))
                ? sectionResult.renderItems
                : [];
            const sectionStats = (sectionResult && sectionResult.stats && typeof sectionResult.stats === "object")
                ? sectionResult.stats
                : null;
            wallSectionHiddenItems = (sectionResult && sectionResult.hiddenItems instanceof Set)
                ? sectionResult.hiddenItems
                : new Set();
            drawPerf.composeWallSectionsGroups = sectionStats && Number.isFinite(sectionStats.groups)
                ? Number(sectionStats.groups)
                : 0;
            drawPerf.composeWallSectionsRebuilt = sectionStats && Number.isFinite(sectionStats.rebuilt)
                ? Number(sectionStats.rebuilt)
                : 0;
            if (compositeItems.length > 0) {
                mapItems.push(...compositeItems);
            }
            wallSections.endFrame();
        }
    } else {
        const wallSections = getWallSectionsRendererApi();
        if (wallSections) {
            wallSections.restoreRenderable(mapItems, isWallMountedPlaceable);
            wallSections.clearCache();
        }
    }
    if (wallSectionHiddenItems.size > 0) {
        mapItems = mapItems.filter(item => !wallSectionHiddenItems.has(item));
    }
    drawPerf.composeWallSectionsMs = performance.now() - composeWallSectionsStartMs;
    drawPerf.composeSortMs = 0;

    if (typeof globalThis !== "undefined" && globalThis.windowWallDebugDumpRequested) {
        const roofs = mapItems.filter(obj => obj && obj.type === "roof");
        const trees = mapItems.filter(obj => obj && obj.type === "tree");
        const walls = mapItems.filter(obj => obj && obj.type === "wall");
        const sortedIndex = new Map();
        mapItems.forEach((obj, idx) => sortedIndex.set(obj, idx));
        const roofRows = roofs.map((roofItem, idx) => ({
            idx,
            sortedIdx: sortedIndex.get(roofItem),
            x: Number(roofItem.x || 0).toFixed(3),
            y: Number(roofItem.y || 0).toFixed(3),
            z: Number((Number.isFinite(roofItem.z) ? roofItem.z : 0)).toFixed(3),
            h: Number((Number.isFinite(roofItem.height) ? roofItem.height : 0)).toFixed(3),
            bottom: Number(getRenderBottomZ(roofItem)).toFixed(3),
            top: Number(getRenderTopZ(roofItem)).toFixed(3),
            aY: Number(getRenderAnchorY(roofItem)).toFixed(3)
        }));
        const treeRows = trees.map((treeItem, idx) => ({
            idx,
            sortedIdx: sortedIndex.get(treeItem),
            x: Number(treeItem.x || 0).toFixed(3),
            y: Number(treeItem.y || 0).toFixed(3),
            z: Number((Number.isFinite(treeItem.z) ? treeItem.z : 0)).toFixed(3),
            h: Number((Number.isFinite(treeItem.height) ? treeItem.height : 0)).toFixed(3),
            bottom: Number(getRenderBottomZ(treeItem)).toFixed(3),
            top: Number(getRenderTopZ(treeItem)).toFixed(3),
            aY: Number(getRenderAnchorY(treeItem)).toFixed(3)
        }));
        const wallRows = walls.map((wallItem, idx) => ({
            idx,
            lineGroupId: Number.isInteger(wallItem.lineGroupId) ? wallItem.lineGroupId : null,
            sortedIdx: sortedIndex.get(wallItem),
            x: Number(wallItem.x || 0).toFixed(3),
            y: Number(wallItem.y || 0).toFixed(3),
            z: Number((Number.isFinite(wallItem.z) ? wallItem.z : 0)).toFixed(3),
            h: Number((Number.isFinite(wallItem.height) ? wallItem.height : 0)).toFixed(3),
            bottom: Number(getRenderBottomZ(wallItem)).toFixed(3),
            top: Number(getRenderTopZ(wallItem)).toFixed(3),
            aY: Number(getRenderAnchorY(wallItem)).toFixed(3)
        }));

        console.groupCollapsed(`[RWT-DUMP] frame ${frameCount} roofs=${roofs.length} trees=${trees.length} walls=${walls.length}`);
        console.table(roofRows);
        console.table(treeRows);
        console.table(wallRows);
        console.groupEnd();
        globalThis.windowWallDebugDumpRequested = false;
    }

    const composePopulateStartMs = performance.now();
    const objectLayerInvariantItems = [];
    const indoorLayerInvariantItems = [];
    let invariantRelevantPresent = false;
    const indoorWallLineGroupIds = new Set();
    if (wizardInsideHouse && indoorObjectLayer && houseHitbox) {
        for (let i = 0; i < mapItems.length; i++) {
            const candidate = mapItems[i];
            if (
                !candidate ||
                (candidate.type !== "wall" && candidate.type !== "wallSectionComposite") ||
                !Number.isInteger(candidate.lineGroupId) ||
                !candidate.groundPlaneHitbox
            ) {
                continue;
            }
            if (groundHitboxLikelyIntersectsCached(candidate.groundPlaneHitbox, houseHitbox)) {
                indoorWallLineGroupIds.add(Number(candidate.lineGroupId));
            }
        }
    }

    // Add items to render layers. Opaque visuals route to the depth/mesh path.
    mapItems.forEach(item => {
        if (
            !invariantRelevantPresent &&
            item &&
            (item.type === "wall" || item.type === "wallSectionComposite" || item.type === "roof" || item.type === "tree")
        ) {
            invariantRelevantPresent = true;
        }
        // Skip items that have been fully vanished
        if (item.gone) return;
        let interiorFadeAlpha = 1;
        
        // Run object simulation updates at most once per simulation frame.
        if (typeof item.update === "function" && item._lastUpdateFrame !== frameCount) {
            item.update();
            item._lastUpdateFrame = frameCount;
        }

        if (item.vanishing && item.vanishStartTime !== undefined && item.vanishDuration !== undefined) {
            const elapsedFrames = frameCount - item.vanishStartTime;
            if (elapsedFrames >= item.vanishDuration) {
                if (item.pixiSprite && item.pixiSprite.parent) {
                    item.pixiSprite.parent.removeChild(item.pixiSprite);
                }
                removeItemOpaqueDepthMeshFromParent(item);
                if (item._vanishFinalizeTimeout) {
                    clearTimeout(item._vanishFinalizeTimeout);
                    item._vanishFinalizeTimeout = null;
                }
                if (typeof item.removeFromNodes === "function") {
                    item.removeFromNodes();
                } else {
                    const itemNode = map.worldToNode(item.x, item.y);
                    if (itemNode) itemNode.removeObject(item);
                }
                if (typeof globalThis !== "undefined") {
                    if (item.type === "tree" && typeof globalThis.unregisterLazyTreeRecordAt === "function") {
                        globalThis.unregisterLazyTreeRecordAt(item.x, item.y);
                    } else if (item.type === "road" && typeof globalThis.unregisterLazyRoadRecordAt === "function") {
                        globalThis.unregisterLazyRoadRecordAt(item.x, item.y);
                    }
                }
                item.gone = true;
                item.vanishing = false;
                return;
            }
        }

            if (item.pixiSprite) {
                const skipLegacyWallGraphicsDraw = !!(opaqueDepthMeshEnabled && item && item.type === "wall");
                const skipLegacyRoofTransform = !!(opaqueDepthMeshEnabled && item && item.type === "roof");
                if (item.skipTransform && typeof item.draw === "function" && !skipLegacyWallGraphicsDraw) {
                    item.draw();
                } else if (!skipLegacyRoofTransform) {
                    applySpriteTransform(item);
                }
            const isAnimal = isAnimalEntity(item);
            let losBrightness = 1;
            let losAlpha = 1;
            const useLegacyLosTinting = !objectLitTransparencyEnabled;
            if (!omnivisionActive && item.groundPlaneHitbox) {
                if (isAnimal) {
                    // Animals should remain strictly LOS-gated even when
                    // object transparency masking is enabled.
                    const currentlyVisible = isCurrentlyVisibleByLos(item);
                    const losTargetAlpha = currentlyVisible ? 1 : 0;
                    if (!Number.isFinite(item._losBrightnessCurrent)) {
                        item._losBrightnessCurrent = 1.0;
                    }
                    const animalLosLerpFactor = Math.min(1, losLerpFactor * 3);
                    item._losBrightnessCurrent += (losTargetAlpha - item._losBrightnessCurrent) * animalLosLerpFactor;
                    losAlpha = Math.max(0, Math.min(1, item._losBrightnessCurrent));
                } else if (useLegacyLosTinting) {
                    const isRoad = item.type === "road";
                    if (isRoad) {
                        // Roads behave like ground: never partially fade by LOS visibility rules.
                        losBrightness = 1;
                    } else {
                        const coverageRatio = getLosCoverageRatio(item, 0.05);
                        const losTargetBrightness = Math.max(
                            losMinStaticBrightness,
                            (1 - losMaxDarken) + coverageRatio * losMaxDarken
                        );
                        if (!Number.isFinite(item._losBrightnessCurrent)) {
                            item._losBrightnessCurrent = 1.0;
                        }
                        item._losBrightnessCurrent += (losTargetBrightness - item._losBrightnessCurrent) * losLerpFactor;
                        losBrightness = Math.max(0, Math.min(1, item._losBrightnessCurrent));
                    }
                }
            }
            const combinedBaseAlpha = interiorFadeAlpha * losAlpha;
            const perItemAlpha = Number.isFinite(item.previewAlpha)
                ? Math.max(0, Math.min(1, item.previewAlpha))
                : 1;
            const opaqueAlphaEps = 0.999;
            const losTintValue = Math.max(0, Math.min(255, Math.round(255 * losBrightness)));
            const losTint = (losTintValue << 16) | (losTintValue << 8) | losTintValue;
            let burnTintValue = null;
            let finalSpriteAlpha = combinedBaseAlpha * perItemAlpha;
            if (Number.isFinite(item && item.maxHP) && Number.isFinite(item && item.hp) && item.maxHP > 0) {
                const hpThreshold = item.maxHP * 0.5;
                if (item.hp < hpThreshold) {
                    const blackProgress = Math.max(0, (hpThreshold - item.hp) / hpThreshold);
                    const burnBrightness = Math.max(0, Math.min(255, Math.floor(255 * (1 - blackProgress * 0.8))));
                    burnTintValue = burnBrightness;
                }
            }
            if ((item && item.burned) || (Number.isFinite(item && item.hp) && item.hp <= 0)) {
                burnTintValue = 0x22;
            }

            // Combine vanish alpha with occlusion alpha
            if (item.vanishing === true && item.vanishStartTime !== undefined && item.vanishDuration !== undefined) {
                const elapsedFrames = frameCount - item.vanishStartTime;

                if (elapsedFrames < 1) {
                    // First frame: show blue tint
                    item.pixiSprite.tint = 0x0099FF;
                    item.pixiSprite.alpha = combinedBaseAlpha * perItemAlpha;
                } else {
                    // Fade phase: fade from blue to transparent over 1/4 second
                    const fadeElapsed = elapsedFrames - 1;
                    const fadeDuration = 0.25 * frameRate; // 1/4 second
                    const percentVanished = Math.min(1, fadeElapsed / fadeDuration);
                    const vanishAlpha = Math.max(0, 1 - percentVanished);
                    item.pixiSprite.tint = 0x0099FF; // Keep blue tint while fading
                    finalSpriteAlpha = combinedBaseAlpha * vanishAlpha * perItemAlpha;
                    item.pixiSprite.alpha = finalSpriteAlpha;
                }
            } else {
                if (Number.isFinite(burnTintValue)) {
                    const combinedTintValue = Math.min(losTintValue, Math.max(0, Math.min(255, Math.round(burnTintValue))));
                    item.pixiSprite.tint = (combinedTintValue << 16) | (combinedTintValue << 8) | combinedTintValue;
                } else {
                    item.pixiSprite.tint = losTint;
                }
                finalSpriteAlpha = combinedBaseAlpha * perItemAlpha;
                item.pixiSprite.alpha = finalSpriteAlpha;
            }
            if (item.pixiSprite.mask === losGroundMaskGraphics) {
                item.pixiSprite.mask = null;
            }
            // item.pixiSprite.anchor.set(0.1, 0.1);
            const isPlacementPreview = item.type === "placedObjectPreview";
            const canRouteToIndoorLayer = !!(wizardInsideHouse && indoorObjectLayer && item.type !== "road");
            const itemInsideHouse = canRouteToIndoorLayer
                ? !!(houseHitbox && item.groundPlaneHitbox && groundHitboxLikelyIntersectsCached(item.groundPlaneHitbox, houseHitbox))
                : false;
            const mountedGroupId = Number.isInteger(item && item.mountedWallLineGroupId)
                ? Number(item.mountedWallLineGroupId)
                : (Number.isInteger(item && item.lineGroupId) ? Number(item.lineGroupId) : null);
            const followsIndoorWallGroup = Number.isInteger(mountedGroupId) && indoorWallLineGroupIds.has(mountedGroupId);
            const useIndoorObjectLayer = !!(
                canRouteToIndoorLayer &&
                (itemInsideHouse || isPlacementPreview || followsIndoorWallGroup)
            );
            const isOpaqueVisual = finalSpriteAlpha >= opaqueAlphaEps && !item.vanishing;
            const useOpaqueMeshLayer = !!(
                !useIndoorObjectLayer &&
                opaqueMeshLayer &&
                item &&
                item.type !== "road" &&
                isOpaqueVisual
            );
            const targetLayer = (item.type === "road" && roadLayer)
                ? roadLayer
                : (useIndoorObjectLayer
                    ? indoorObjectLayer
                    : (useOpaqueMeshLayer ? opaqueMeshLayer : (isAnimal && characterLayer ? characterLayer : objectLayer)));
            let displayObject = item.pixiSprite;
            if (useOpaqueMeshLayer) {
                const depthDisplay = getOpaqueDepthDisplayObject(item, {
                    tint: item.pixiSprite && Number.isFinite(item.pixiSprite.tint) ? item.pixiSprite.tint : 0xFFFFFF,
                    alpha: finalSpriteAlpha
                });
                if (depthDisplay) {
                    displayObject = depthDisplay;
                }
            } else {
                removeItemOpaqueDepthMeshFromParent(item);
            }
            if (item && item.type === "wallSectionComposite" && Array.isArray(item._sectionMemberWalls)) {
                for (let i = 0; i < item._sectionMemberWalls.length; i++) {
                    const memberWall = item._sectionMemberWalls[i];
                    if (!memberWall) continue;
                    memberWall._wallSectionCompositeDisplayObject = displayObject;
                    if (item.pixiSprite && item.pixiSprite.parent) {
                        memberWall._wallSectionCompositeSprite = item.pixiSprite;
                    }
                }
            }
            targetLayer.addChild(displayObject);
            if (targetLayer === objectLayer) {
                objectLayerInvariantItems.push(item);
            } else if (targetLayer === indoorObjectLayer) {
                indoorLayerInvariantItems.push(item);
            }

            // Render fire if burning or fading out
            if (item.isOnFire || item.fireFadeStart !== undefined) {
                ensureFireFrames();
                if (!fireFrames || fireFrames.length === 0) return;
                if (item.fireFrameIndex === undefined || item.fireFrameIndex === null) {
                    item.fireFrameIndex = 0;
                }
                if (!item.fireSprite) {
                    item.fireSprite = new PIXI.Sprite(fireFrames[0]);
                    item.fireSprite.anchor.set(0.5, 0.5);
                }
                if (fireFrames.length > 0) {
                    const normalized = ((Math.floor(item.fireFrameIndex) % fireFrames.length) + fireFrames.length) % fireFrames.length;
                    item.fireFrameIndex = normalized;
                }
                // Advance fire animation once per simulation frame to avoid
                // speeding up on high render FPS.
                if (item._lastFireAnimFrame !== frameCount && frameCount % 2 === 0) {
                    item.fireFrameIndex = (item.fireFrameIndex + 1) % fireFrames.length;
                }
                item._lastFireAnimFrame = frameCount;
                item.fireSprite.texture = fireFrames[item.fireFrameIndex];
                const fireCoors = worldToScreen(item);
                const itemHeight = (item.height || 1) * viewscale * xyratio;

                // Calculate fire position accounting for tree rotation
                // Tree rotates around its anchor point (bottom center for trees)
                // Fire should stay at the center of the tree but remain upright
                if (item.type === "tree") {
                    const rotRad = (item.rotation ?? 0) * (Math.PI / 180);
                    // Center of tree rotates around anchor point
                    const centerOffsetX = (itemHeight / 2) * Math.sin(rotRad);
                    const centerOffsetY = -(itemHeight / 2) * Math.cos(rotRad);
                    item.fireSprite.x = fireCoors.x + centerOffsetX;
                    item.fireSprite.y = fireCoors.y + centerOffsetY;
                } else {
                    // For animals, position fire lower (closer to ground)
                    item.fireSprite.x = fireCoors.x;
                    item.fireSprite.y = fireCoors.y;
                }

                item.fireSprite.anchor.set(0.5, 1); // Bottom center of fire at position

                // Scale fire size based on HP loss
                if (item.maxHP && item.hp !== undefined) {
                    const hpLossRatio = Math.max(0, (item.maxHP - item.hp) / item.maxHP);
                    let fireScale = 0.5 + hpLossRatio * 1.5; // Scale from 0.5x to 2x

                    // During fade phase, shrink fire proportionally
                    const alphaMult = item.fireAlphaMult !== undefined ? item.fireAlphaMult : 1;
                    fireScale *= alphaMult;

                    const widthScale = Number.isFinite(item.fireWidthScale) ? item.fireWidthScale : 1;
                    const heightScale = Number.isFinite(item.fireHeightScale) ? item.fireHeightScale : 1;
                    item.fireSprite.width = (item.width || 1) * viewscale * fireScale * widthScale;
                    item.fireSprite.height = (item.height || 1) * viewscale * fireScale * heightScale;
                } else {
                    const widthScale = Number.isFinite(item.fireWidthScale) ? item.fireWidthScale : 1;
                    const heightScale = Number.isFinite(item.fireHeightScale) ? item.fireHeightScale : 1;
                    item.fireSprite.width = (item.width || 1) * viewscale * widthScale;
                    item.fireSprite.height = (item.height || 1) * viewscale * heightScale;
                }

                // Apply alpha fade
                const alphaMult = item.fireAlphaMult !== undefined ? item.fireAlphaMult : 1;
                item.fireSprite.alpha = item.pixiSprite.alpha * alphaMult;
                item.fireSprite.rotation = 0; // Fire stays upright
                const fireLayer = useIndoorObjectLayer ? indoorObjectLayer : objectLayer;
                fireLayer.addChild(item.fireSprite);
            }
        }
    });
    drawPerf.composePopulateMs = performance.now() - composePopulateStartMs;

    // Deterministic invariant pass:
    // Preserve roof/tree relationships over base sorted order.
    const runInvariantPass = !!(
        invariantRelevantPresent ||
        (typeof globalThis !== "undefined" && globalThis.windowWallDebugDumpRequested)
    );
    const composeInvariantStartMs = performance.now();
    if (runInvariantPass) {
        [
            { layer: objectLayer, layerItems: objectLayerInvariantItems },
            { layer: indoorObjectLayer, layerItems: indoorLayerInvariantItems }
        ].forEach(layerState => {
        const layer = layerState.layer;
        if (!layer) return;
        const layerItems = Array.isArray(layerState.layerItems) ? layerState.layerItems : [];
        if (layerItems.length === 0) return;

        const wallItems = [];

        layerItems.forEach(item => {
            if (
                (item.type === "wall" || item.type === "wallSectionComposite") &&
                Number.isInteger(item.lineGroupId)
            ) {
                wallItems.push(item);
            }
        });

        // Roof ordering invariants:
        // 1) roof above supporting walls
        // 2) trees in front of roof (below front eave in world y) above roof
        const roofItems = [];
        const treeItems = [];
        layerItems.forEach(item => {
            if (!item || !item.pixiSprite || item.pixiSprite.parent !== layer) return;
            if (item.type === "roof") {
                roofItems.push(item);
            } else if (item.type === "tree") {
                treeItems.push(item);
            }
        });
        roofItems.forEach(roofItem => {
            const roofSprite = roofItem.pixiSprite;
            if (!roofSprite || roofSprite.parent !== layer) return;

            if (roofItem.groundPlaneHitbox) {
                const supportIndices = [];
                for (let i = 0; i < wallItems.length; i++) {
                    const wall = wallItems[i];
                    if (!wall || !wall.pixiSprite || wall.pixiSprite.parent !== layer || !wall.groundPlaneHitbox) continue;
                    if (!groundHitboxLikelyIntersectsCached(wall.groundPlaneHitbox, roofItem.groundPlaneHitbox)) continue;
                    const idx = layer.getChildIndex(wall.pixiSprite);
                    if (idx >= 0) supportIndices.push(idx);
                }
                if (supportIndices.length > 0) {
                    const minRoofIdx = Math.max(...supportIndices) + 1;
                    const roofIdx = layer.getChildIndex(roofSprite);
                    if (roofIdx >= 0 && roofIdx < minRoofIdx) {
                        layer.removeChild(roofSprite);
                        const clamped = Math.max(0, Math.min(minRoofIdx, layer.children.length));
                        layer.addChildAt(roofSprite, clamped);
                    }
                }
            }

            const roofFrontY = (() => {
                const hb = roofItem.groundPlaneHitbox;
                if (!hb) return Number.isFinite(roofItem.y) ? roofItem.y : 0;
                if (hb.type === "circle" && Number.isFinite(hb.y) && Number.isFinite(hb.radius)) {
                    return hb.y + hb.radius;
                }
                if (Array.isArray(hb.points) && hb.points.length >= 3) {
                    return hb.points.reduce((m, p) => Math.max(m, Number.isFinite(p && p.y) ? p.y : -Infinity), -Infinity);
                }
                return Number.isFinite(roofItem.y) ? roofItem.y : 0;
            })();

            const roofHitbox = roofItem.groundPlaneHitbox || null;
            const roofIdx = layer.getChildIndex(roofSprite);
            if (roofIdx >= 0) {
                const treesToMove = [];
                for (let i = 0; i < treeItems.length; i++) {
                    const treeItem = treeItems[i];
                    if (
                        !treeItem ||
                        !treeItem.pixiSprite ||
                        treeItem.pixiSprite.parent !== layer ||
                        !Number.isFinite(treeItem.y) ||
                        treeItem.y <= roofFrontY
                    ) {
                        continue;
                    }
                    if (
                        roofHitbox &&
                        treeItem.groundPlaneHitbox &&
                        !groundHitboxLikelyIntersectsCached(treeItem.groundPlaneHitbox, roofHitbox)
                    ) {
                        continue;
                    }
                    const treeIdx = layer.getChildIndex(treeItem.pixiSprite);
                    if (treeIdx < 0 || treeIdx > roofIdx) continue;
                    treesToMove.push({ sprite: treeItem.pixiSprite, idx: treeIdx });
                }

                if (treesToMove.length > 0) {
                    treesToMove.sort((a, b) => a.idx - b.idx);
                    treesToMove.forEach(entry => layer.removeChild(entry.sprite));

                    const nextRoofIdx = layer.getChildIndex(roofSprite);
                    let insertAt = Math.max(0, Math.min(nextRoofIdx + 1, layer.children.length));
                    treesToMove.forEach(entry => {
                        layer.addChildAt(entry.sprite, insertAt);
                        insertAt += 1;
                    });
                }
            }
        });
        });
        drawPerf.composeInvariantMs = performance.now() - composeInvariantStartMs;
        drawPerf.composeInvariantSkipped = 0;
    } else {
        drawPerf.composeInvariantMs = 0;
        drawPerf.composeInvariantSkipped = 1;
    }

    if (
        placePreviewItem &&
        placePreviewItem.previewDrawAfterWalls &&
        placePreviewItem.pixiSprite &&
        placePreviewItem.pixiSprite.parent
    ) {
        const previewParent = placePreviewItem.pixiSprite.parent;
        const topIndex = previewParent.children.length - 1;
        if (topIndex >= 0) {
            const currentIndex = previewParent.getChildIndex(placePreviewItem.pixiSprite);
            if (currentIndex !== topIndex) {
                previewParent.setChildIndex(placePreviewItem.pixiSprite, topIndex);
            }
        }
    }

    // Keep firewall preview visible above rendered map objects (including roads).
    if (wizard.firewallLayoutMode && wizard.firewallStartPoint && wizard.phantomFirewall) {
        updatePhantomFirewall(
            wizard.firewallStartPoint.x,
            wizard.firewallStartPoint.y,
            mousePos.worldX,
            mousePos.worldY
        );
        objectLayer.addChild(wizard.phantomFirewall);
    }

    updateIndoorOverlay(houseHitbox, wizardInsideHouse);
    drawPlaceObjectCenterSnapGuide(placePreviewItem);

    drawSpellHoverTargetHighlight();

    wizard.draw();
    routeWizardToIndoorLayer(wizardInsideHouse);
    drawProjectiles(houseHitbox, wizardInsideHouse);
    drawPerf.passObjectsMs = performance.now() - passObjectsStartMs;
    }

    function renderPostPass() {
    const passPostStartMs = performance.now();
    drawHitboxes(true);
    drawWizardBoundaries(true);
    drawLosDebug(true);
    updateCursor();
    drawVisibilityMask();

    const nextMessageHtml = messages.join("<br>");
    if (nextMessageHtml !== lastRenderedMessageHtml) {
        $('#msg').html(nextMessageHtml);
        lastRenderedMessageHtml = nextMessageHtml;
    }
    drawPerf.passPostMs = performance.now() - passPostStartMs;
    drawPerf.composeMs = performance.now() - composeStartMs;
    drawPerf.composeUnaccountedMs = Math.max(
        0,
        drawPerf.composeMs -
            drawPerf.composeMaskMs -
            drawPerf.composeSortMs -
            drawPerf.composePopulateMs -
            drawPerf.composeInvariantMs -
            drawPerf.composeWallSectionsMs
    );
    drawPerf.totalMs = performance.now() - perfStartMs;
    if (typeof globalThis !== "undefined") {
        globalThis.drawPerfBreakdown = drawPerf;
    }
    }

    renderWorldPass();
    renderLosPass();
    renderObjectsPass();
    renderPostPass();
}

function worldToScreen(item) {
    const camera = (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
        ? interpolatedViewport
        : viewport;
    const alpha = (typeof renderAlpha === "number") ? Math.max(0, Math.min(1, renderAlpha)) : 1;
    const worldX = (item && Number.isFinite(item.prevX) && Number.isFinite(item.x))
        ? (
            Number.isFinite(alpha) && map && typeof map.shortestDeltaX === "function"
                ? (item.prevX + map.shortestDeltaX(item.prevX, item.x) * alpha)
                : (item.prevX + (item.x - item.prevX) * alpha)
        )
        : item.x;
    const worldY = (item && Number.isFinite(item.prevY) && Number.isFinite(item.y))
        ? (
            Number.isFinite(alpha) && map && typeof map.shortestDeltaY === "function"
                ? (item.prevY + map.shortestDeltaY(item.prevY, item.y) * alpha)
                : (item.prevY + (item.y - item.prevY) * alpha)
        )
        : item.y;
    const dx = (map && typeof map.shortestDeltaX === "function")
        ? map.shortestDeltaX(camera.x, worldX)
        : (worldX - camera.x);
    const dy = (map && typeof map.shortestDeltaY === "function")
        ? map.shortestDeltaY(camera.y, worldY)
        : (worldY - camera.y);
    return {
        x: dx * viewscale,
        y: dy * viewscale * xyratio
    };
}

function worldToNodeCanonical(worldX, worldY) {
    if (!map || !map.nodes) return null;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
    const wrappedX = (map && typeof map.wrapWorldX === "function") ? map.wrapWorldX(worldX) : worldX;
    const wrappedY = (map && typeof map.wrapWorldY === "function") ? map.wrapWorldY(worldY) : worldY;
    const approxX = Math.round(wrappedX / 0.866);
    const clampedX = Math.max(0, Math.min(map.width - 1, approxX));
    const approxY = Math.round(wrappedY - (clampedX % 2 === 0 ? 0.5 : 0));
    const clampedY = Math.max(0, Math.min(map.height - 1, approxY));
    return (map.nodes[clampedX] && map.nodes[clampedX][clampedY]) ? map.nodes[clampedX][clampedY] : null;
}

function getViewportNodeCorners() {
    if (!map) {
        return { topLeftNode: null, bottomRightNode: null };
    }
    const sampleMaxX = viewport.x + Math.max(0, viewport.width - renderingViewportNodeSampleEpsilon);
    const sampleMaxY = viewport.y + Math.max(0, viewport.height - renderingViewportNodeSampleEpsilon);
    return {
        topLeftNode: worldToNodeCanonical(viewport.x, viewport.y),
        bottomRightNode: worldToNodeCanonical(sampleMaxX, sampleMaxY)
    };
}

function getWrappedIndexRanges(start, end, size, wrapEnabled) {
    if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(start) || !Number.isFinite(end)) return [];
    const rawStart = Math.floor(Math.min(start, end));
    const rawEnd = Math.floor(Math.max(start, end));
    if (!wrapEnabled) {
        const clampedStart = Math.max(0, Math.min(size - 1, rawStart));
        const clampedEnd = Math.max(0, Math.min(size - 1, rawEnd));
        if (clampedEnd < clampedStart) return [];
        return [{ start: clampedStart, end: clampedEnd }];
    }
    if ((rawEnd - rawStart + 1) >= size) {
        return [{ start: 0, end: size - 1 }];
    }
    const wrap = (n) => ((n % size) + size) % size;
    const s = wrap(rawStart);
    const e = wrap(rawEnd);
    if (s <= e) return [{ start: s, end: e }];
    return [
        { start: 0, end: e },
        { start: s, end: size - 1 }
    ];
}

function screenToWorld(screenX, screenY) {
    const camera = (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
        ? interpolatedViewport
        : viewport;
    let worldX = screenX / viewscale + camera.x;
    let worldY = screenY / (viewscale * xyratio) + camera.y;
    if (map && typeof map.wrapWorldX === "function" && Number.isFinite(worldX)) {
        worldX = map.wrapWorldX(worldX);
    }
    if (map && typeof map.wrapWorldY === "function" && Number.isFinite(worldY)) {
        worldY = map.wrapWorldY(worldY);
    }
    if (
        wizard &&
        map &&
        typeof map.shortestDeltaX === "function" &&
        typeof map.shortestDeltaY === "function" &&
        Number.isFinite(wizard.x) &&
        Number.isFinite(wizard.y) &&
        Number.isFinite(worldX) &&
        Number.isFinite(worldY)
    ) {
        worldX = wizard.x + map.shortestDeltaX(wizard.x, worldX);
        worldY = wizard.y + map.shortestDeltaY(wizard.y, worldY);
    }
    return { x: worldX, y: worldY };
}

function centerViewport(obj, margin, smoothing = null) {
    // viewport is in array index units
    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;

    // Convert obj world coordinates to index units
    const objIndexX = obj.x;
    const objIndexY = obj.y;
    const leadDistance = Math.min(viewport.width, viewport.height) * cameraForwardLeadRatio;
    const facingAngle = getWizardFacingAngleRad();
    const leadX = Math.cos(facingAngle) * leadDistance;
    const leadY = Math.sin(facingAngle) * leadDistance;
    const focusX = objIndexX + leadX;
    const focusY = objIndexY + leadY;

    // Check if object is outside the margin box
    const leftBound = centerX - margin;
    const rightBound = centerX + margin;
    const topBound = centerY - margin;
    const bottomBound = centerY + margin;

    // Calculate desired viewport adjustment
    let targetOffsetX = 0;
    let targetOffsetY = 0;

    if (focusX < leftBound) {
        targetOffsetX = (focusX - leftBound);
    } else if (focusX > rightBound) {
        targetOffsetX = (focusX - rightBound);
    }

    if (focusY < topBound) {
        targetOffsetY = (focusY - topBound);
    } else if (focusY > bottomBound) {
        targetOffsetY = (focusY - bottomBound);
    }

    // Move camera toward desired position asymptotically.
    const desiredX = viewport.x + targetOffsetX;
    const desiredY = viewport.y + targetOffsetY;
    const requestedSmoothing = Number.isFinite(smoothing) ? smoothing : cameraFollowSmoothing;
    const smoothFactor = Math.max(0, Math.min(1, requestedSmoothing));
    const factor = smoothFactor > 0 ? smoothFactor : 1;
    const deadband = 0.01;
    let nextX = viewport.x + (desiredX - viewport.x) * factor;
    let nextY = viewport.y + (desiredY - viewport.y) * factor;
    if (Math.abs(nextX - viewport.x) < deadband) nextX = viewport.x;
    if (Math.abs(nextY - viewport.y) < deadband) nextY = viewport.y;

    viewport.x = nextX;
    viewport.y = nextY;

    // Keep camera center on the same torus copy as the followed object to avoid
    // accumulating huge viewport coordinates across seam crossings.
    let seamShiftX = 0;
    let seamShiftY = 0;
    if (map && obj && Number.isFinite(obj.x) && Number.isFinite(obj.y)) {
        const currentCenterX = viewport.x + viewport.width * 0.5;
        const currentCenterY = viewport.y + viewport.height * 0.5;
        if (typeof map.shortestDeltaX === "function" && Number.isFinite(currentCenterX)) {
            const nearestCenterX = obj.x + map.shortestDeltaX(obj.x, currentCenterX);
            seamShiftX = (nearestCenterX - viewport.width * 0.5) - viewport.x;
        }
        if (typeof map.shortestDeltaY === "function" && Number.isFinite(currentCenterY)) {
            const nearestCenterY = obj.y + map.shortestDeltaY(obj.y, currentCenterY);
            seamShiftY = (nearestCenterY - viewport.height * 0.5) - viewport.y;
        }
    }
    const seamEps = 1e-6;
    if ((Math.abs(seamShiftX) > seamEps || Math.abs(seamShiftY) > seamEps)) {
        if (typeof applyViewportWrapShift === "function") {
            applyViewportWrapShift(seamShiftX, seamShiftY);
        } else {
            viewport.x += seamShiftX;
            viewport.y += seamShiftY;
            if (typeof previousViewport !== "undefined") {
                previousViewport.x += seamShiftX;
                previousViewport.y += seamShiftY;
            }
            if (typeof interpolatedViewport !== "undefined") {
                interpolatedViewport.x += seamShiftX;
                interpolatedViewport.y += seamShiftY;
            }
        }
    }

    // Keep precision stable to avoid float-noise shaking over time.
    viewport.x = Math.round(viewport.x * 1000) / 1000;
    viewport.y = Math.round(viewport.y * 1000) / 1000;
}

function updatePhantomWall(ax, ay, bx, by) {
    if (!wizard.phantomWall) return;

    wizard.phantomWall.clear();

    const startPoint = { x: Number(ax), y: Number(ay) };
    const endPoint = { x: Number(bx), y: Number(by) };
    if (
        !Number.isFinite(startPoint.x) ||
        !Number.isFinite(startPoint.y) ||
        !Number.isFinite(endPoint.x) ||
        !Number.isFinite(endPoint.y)
    ) {
        return;
    }
    const wallPath = (
        typeof Wall !== "undefined" &&
        Wall &&
        typeof Wall.buildPlacementPath === "function"
    ) ? Wall.buildPlacementPath(map, startPoint, endPoint, { maxAnchorDistance: 1.0001 }) : [];
    if (!Array.isArray(wallPath) || wallPath.length === 0) return;
    const planned = (
        typeof Wall !== "undefined" &&
        Wall &&
        typeof Wall.planWallLineSegments === "function"
    ) ? Wall.planWallLineSegments(wallPath, map, {
        skipExisting: true,
        startReferenceWall: (wizard && wizard.wallStartReferenceWall && wizard.wallStartReferenceWall.type === "wall")
            ? wizard.wallStartReferenceWall
            : null
    }) : null;
    const previewSegments = planned && Array.isArray(planned.segments) ? planned.segments : null;
    const wallHeight = Number.isFinite(wizard.selectedWallHeight) ? wizard.selectedWallHeight : 3.0;
    const wallThickness = Number.isFinite(wizard.selectedWallThickness) ? wizard.selectedWallThickness : 0.2;
    const drawSegment = (from, to) => {
        if (!from || !to || (typeof Wall !== "undefined" && Wall && Wall.pointsMatch(from, to))) return;
        Wall.drawWall(wizard.phantomWall, from, to, wallHeight, wallThickness, 0x888888, 0.5);
    };

    if (previewSegments) {
        for (let i = 0; i < previewSegments.length; i++) {
            const seg = previewSegments[i];
            if (!seg) continue;
            drawSegment(seg.from, seg.to);
        }
        return;
    }

    if (!(typeof Wall !== "undefined" && Wall && Wall.pointsMatch(startPoint, wallPath[0]))) {
        drawSegment(startPoint, wallPath[0]);
    }
    for (let i = 0; i < wallPath.length - 1; i++) {
        const pathNodeA = wallPath[i];
        const pathNodeB = wallPath[i + 1];

        // Use the static NewWall.drawWall method with phantom styling
        drawSegment(pathNodeA, pathNodeB);
    }
    if (!(typeof Wall !== "undefined" && Wall && Wall.pointsMatch(wallPath[wallPath.length - 1], endPoint))) {
        drawSegment(wallPath[wallPath.length - 1], endPoint);
    }
}

function updatePhantomFirewall(ax, ay, bx, by) {
    if (!wizard || !wizard.phantomFirewall) return;
    wizard.phantomFirewall.clear();

    const start = worldToScreen({ x: ax, y: ay });
    const end = worldToScreen({ x: bx, y: by });
    wizard.phantomFirewall.lineStyle(4, 0xff3333, 0.95);
    wizard.phantomFirewall.moveTo(start.x, start.y);
    wizard.phantomFirewall.lineTo(end.x, end.y);
}

function updatePhantomRoad(ax, ay, bx, by) {
    if (!wizard.phantomRoad) return;

    wizard.phantomRoad.removeChildren();

    const nodeA = map.worldToNode(ax, ay);
    const nodeB = map.worldToNode(bx, by);
    if (!nodeA || !nodeB) return;

    const width = (nodeA === nodeB) ? 1 : roadWidth;
    const roadNodes = map.getHexLine(nodeA, nodeB, width);

    const roadNodeKeys = new Set(
        roadNodes.map(node => `${node.xindex},${node.yindex}`)
    );

    const oddDirections = [1, 3, 5, 7, 9, 11];

    roadNodes.forEach(node => {
        const neighborDirections = oddDirections.filter(direction => {
            const neighbor = node.neighbors[direction];
            if (!neighbor) return false;

            if (roadNodeKeys.has(`${neighbor.xindex},${neighbor.yindex}`)) return true;

            return neighbor.objects && neighbor.objects.some(obj => obj.type === 'road');
        });

        // Get the geometry for this road piece
        const { keptCorners, radius } = Road.getGeometryForNeighbors(neighborDirections);

        // Create a simple graphics display for the phantom
        const sprite = new PIXI.Graphics();
        sprite.beginFill(0x888888, 0.6);

        if (keptCorners.length >= 3) {
            keptCorners.forEach((pt, idx) => {
                const screenPt = worldToScreen({x: node.x + pt.x / radius / 2, y: node.y + pt.y / radius / 2});
                if (idx === 0) {
                    sprite.moveTo(screenPt.x, screenPt.y);
                } else {
                    sprite.lineTo(screenPt.x, screenPt.y);
                }
            });
            sprite.closePath();
        }
        sprite.endFill();

        wizard.phantomRoad.addChild(sprite);
    });
}

function updateRoadMask(roadItems) {
    return;
}

function screenToHex(screenX, screenY) {
    const worldCoors = screenToWorld(screenX, screenY);
    const worldX = worldCoors.x;
    const worldY = worldCoors.y;

    const approxCol = Math.round(worldX);
    const approxRow = Math.round(worldY - (approxCol % 2 === 0 ? 0.5 : 0));

    let best = {x: approxCol, y: approxRow};
    let bestDist = Infinity;

    for (let cx = approxCol - 1; cx <= approxCol + 1; cx++) {
        for (let cy = approxRow - 1; cy <= approxRow + 1; cy++) {
            if (cx < 0 || cy < 0 || cx >= mapWidth || cy >= mapHeight) continue;
            const worldCenter = {x: cx, y: cy + (cx % 2 === 0 ? 0.5 : 0)};
            const screenCenter = worldToScreen(worldCenter);
            const dx = screenCenter.x - screenX;
            const dy = screenCenter.y - screenY;
            const dist = dx * dx + dy * dy;
            if (dist < bestDist) {
                bestDist = dist;
                best = {x: cx, y: cy};
            }
        }
    }

    return best;
}

function buildSpriteFramesFromList(list, rows, cols) {
    if (!list || list.length < rows * cols) return null;
    const frames = [];
    for (let r = 0; r < rows; r++) {
        frames[r] = [];
        for (let c = 0; c < cols; c++) {
            frames[r][c] = list[r * cols + c];
        }
    }
    return frames;
}

function ensureSpriteFrames(item) {
    if (!item || !item.spriteSheet || item.spriteSheetReady) return;

    const sheet = item.spriteSheet;
    const rows = sheet.rows || 1;
    const cols = sheet.cols || 1;
    let frameList = null;

    if (Array.isArray(sheet.frameTextures)) {
        frameList = sheet.frameTextures;
    } else if (Array.isArray(sheet.frameKeys)) {
        const texGroup = textures[item.type];
        if (texGroup && texGroup.byKey) {
            frameList = sheet.frameKeys.map(key => texGroup.byKey[key]).filter(Boolean);
        }
    } else if (Array.isArray(sheet.framePaths)) {
        frameList = sheet.framePaths.map(path => PIXI.Texture.from(path));
    }

    const frames = buildSpriteFramesFromList(frameList, rows, cols);
    if (!frames) return;

    item.spriteRows = rows;
    item.spriteCols = cols;
    item.spriteCol = item.spriteCol || 0;
    item.spriteFrames = frames;
    item.spriteSheetReady = true;

    if (item.pixiSprite && frames[0] && frames[0][0]) {
        item.pixiSprite.texture = frames[0][0];
    }
}

function ensureFireFrames() {
    if (fireFrames) return;
    const baseTexture = PIXI.Texture.from('./assets/images/fire.png').baseTexture;
    if (!baseTexture.valid) {
        baseTexture.once('loaded', () => {
            fireFrames = null;
            ensureFireFrames();
        });
        return;
    }
    const cols = 5;
    const rows = 5;
    const frameWidth = baseTexture.width / cols;
    const frameHeight = baseTexture.height / rows;
    fireFrames = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            fireFrames.push(
                new PIXI.Texture(
                    baseTexture,
                    new PIXI.Rectangle(col * frameWidth, row * frameHeight, frameWidth, frameHeight)
                )
            );
        }
    }
}

function resolvePlacedObjectLodTexturePath(item) {
    if (!item || !isPlacedObjectEntity(item)) return null;
    const basePath = (typeof item.texturePath === "string" && item.texturePath.length > 0)
        ? item.texturePath
        : null;
    const lodList = Array.isArray(item.lodTextures) ? item.lodTextures : null;
    if (!lodList || lodList.length === 0) return basePath;
    const itemWidthWorld = Math.max(0.01, Number.isFinite(item.width) ? Number(item.width) : 1);
    const itemHeightWorld = Math.max(0.01, Number.isFinite(item.height) ? Number(item.height) : 1);
    const rotationAxis = (typeof item.rotationAxis === "string") ? item.rotationAxis : "visual";
    const yIsoScale = Math.max(0.0001, Math.abs(Number.isFinite(xyratio) ? xyratio : 0.66));
    const screenWidthPx = itemWidthWorld * viewscale;
    const screenHeightPx = (rotationAxis === "spatial")
        ? (itemHeightWorld * viewscale)
        : (itemHeightWorld * viewscale * yIsoScale);
    // Size metric used for LOD thresholds: larger on-screen objects use higher-detail textures.
    const sizeMetric = Math.max(screenWidthPx, screenHeightPx);

    for (let i = 0; i < lodList.length; i++) {
        const entry = lodList[i];
        if (!entry || typeof entry.texturePath !== "string" || entry.texturePath.length === 0) continue;
        // Backward-compatible field name: "maxDistance" now interpreted as max on-screen size in px.
        const maxSize = Number.isFinite(entry.maxDistance) ? Number(entry.maxDistance) : Infinity;
        if (sizeMetric <= maxSize) return entry.texturePath;
    }
    return basePath || (lodList[lodList.length - 1] && lodList[lodList.length - 1].texturePath) || null;
}

function applySpriteTransform(item) {
    if (item && item.type === "roof" && item.pixiSprite) {
        const coors = worldToScreen(item);
        item.pixiSprite.x = coors.x;
        item.pixiSprite.y = coors.y;
        if (item.pixiSprite.scale && typeof item.pixiSprite.scale.set === "function") {
            item.pixiSprite.scale.set(viewscale, viewscale);
        }
        item.pixiSprite.rotation = 0;
        return;
    }

    if (
        item &&
        (isPlacedObjectEntity(item) || item.type === "placedObjectPreview") &&
        item.rotationAxis === "spatial"
    ) {
        const useDualWallPlanes = !!(
            item &&
            item.type !== "placedObjectPreview" &&
            isPlacedObjectEntity(item) &&
            isWallMountedPlaceable(item)
        );
        const texturePath = (
            useDualWallPlanes &&
            typeof item.texturePath === "string" &&
            item.texturePath.length > 0
        ) ? item.texturePath : (
            resolvePlacedObjectLodTexturePath(item) || (
                (typeof item.texturePath === "string" && item.texturePath.length > 0)
                    ? item.texturePath
                    : null
            )
        );
        const makeSpatialGeometry = (dualPlanes = false) => {
            if (!dualPlanes) {
                return new PIXI.Geometry()
                    .addAttribute('aVertexPosition', new Float32Array(8), 2)
                    .addAttribute('aUvs', new Float32Array([
                        0, 1,
                        1, 1,
                        1, 0,
                        0, 0
                    ]), 2)
                    .addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
            }
            return new PIXI.Geometry()
                .addAttribute('aVertexPosition', new Float32Array(16), 2)
                .addAttribute('aUvs', new Float32Array([
                    0, 1,
                    1, 1,
                    1, 0,
                    0, 0,
                    1, 1,
                    0, 1,
                    0, 0,
                    1, 0
                ]), 2)
                .addIndex(new Uint16Array([
                    0, 1, 2, 0, 2, 3,
                    4, 5, 6, 4, 6, 7
                ]));
        };
        const meshNeedsGeometryShape = (meshRef, dualPlanes = false) => {
            if (!meshRef || !meshRef.geometry) return true;
            const vb = meshRef.geometry.getBuffer('aVertexPosition');
            const ub = meshRef.geometry.getBuffer('aUvs');
            const ib = meshRef.geometry.getIndex();
            const expectedVerts = dualPlanes ? 16 : 8;
            const expectedUvs = dualPlanes ? 16 : 8;
            const expectedIdx = dualPlanes ? 12 : 6;
            return !(
                vb && vb.data && vb.data.length === expectedVerts &&
                ub && ub.data && ub.data.length === expectedUvs &&
                ib && ib.data && ib.data.length === expectedIdx
            );
        };
        const mesh = (() => {
            if (item.type === "placedObjectPreview") {
                if (!placeObjectPreviewSpatialMesh) {
                    const geometry = makeSpatialGeometry(false);
                    const material = new PIXI.MeshMaterial(texturePath ? PIXI.Texture.from(texturePath) : PIXI.Texture.WHITE);
                    placeObjectPreviewSpatialMesh = new PIXI.Mesh(geometry, material);
                    placeObjectPreviewSpatialMesh.skipTransform = true;
                    placeObjectPreviewSpatialMesh.interactive = false;
                }
                if (placeObjectPreviewSpatialMesh.material) {
                    placeObjectPreviewSpatialMesh.material.texture = texturePath ? PIXI.Texture.from(texturePath) : PIXI.Texture.WHITE;
                }
                return placeObjectPreviewSpatialMesh;
            }
            if (item._spatialPlaneMesh) {
                if (meshNeedsGeometryShape(item._spatialPlaneMesh, useDualWallPlanes)) {
                    if (typeof item._spatialPlaneMesh.destroy === "function") {
                        item._spatialPlaneMesh.destroy({ children: false, texture: false, baseTexture: false });
                    }
                    item._spatialPlaneMesh = null;
                }
            }
            if (item._spatialPlaneMesh) {
                if (item._spatialPlaneMesh.material) {
                    item._spatialPlaneMesh.material.texture = texturePath ? PIXI.Texture.from(texturePath) : PIXI.Texture.WHITE;
                }
                return item._spatialPlaneMesh;
            }
            const geometry = makeSpatialGeometry(useDualWallPlanes);
            const material = new PIXI.MeshMaterial(texturePath ? PIXI.Texture.from(texturePath) : PIXI.Texture.WHITE);
            const m = new PIXI.Mesh(geometry, material);
            m.skipTransform = true;
            m.interactive = false;
            item._spatialPlaneMesh = m;
            if (!item._placedObjectBaseSprite && item.pixiSprite && item.pixiSprite instanceof PIXI.Sprite) {
                item._placedObjectBaseSprite = item.pixiSprite;
            }
            return m;
        })();

        item.pixiSprite = mesh;
        const worldX = Number.isFinite(item.x) ? item.x : 0;
        const worldY = Number.isFinite(item.y) ? item.y : 0;
        const activeTexture = (mesh.material && mesh.material.texture) ? mesh.material.texture : null;
        const nativeTexW = activeTexture && Number.isFinite(activeTexture.width) ? Number(activeTexture.width) : null;
        const nativeTexH = activeTexture && Number.isFinite(activeTexture.height) ? Number(activeTexture.height) : null;
        const width = (debugUseLodNativePixelSize && isPlacedObjectEntity(item) && Number.isFinite(nativeTexW) && viewscale > 0)
            ? Math.max(0.01, nativeTexW / viewscale)
            : Math.max(0.01, Number.isFinite(item.width) ? item.width : 1);
        const baseHeight = (debugUseLodNativePixelSize && isPlacedObjectEntity(item) && Number.isFinite(nativeTexH) && viewscale > 0)
            ? Math.max(0.01, nativeTexH / viewscale)
            : Math.max(0.01, Number.isFinite(item.height) ? item.height : 1);
        const yIsoScale = Math.max(0.0001, Math.abs(Number.isFinite(xyratio) ? xyratio : 0.66));
        // Compensate for worldToScreen Y squash so spatial quads keep source aspect.
        const height = baseHeight / yIsoScale;
        const angleDeg = Number.isFinite(item.placementRotation) ? item.placementRotation : 0;
        const theta = angleDeg * (Math.PI / 180);
        const halfWidth = width * 0.5;
        const axisX = Math.cos(theta);
        const axisY = Math.sin(theta);
        const anchorX = Number.isFinite(item.placeableAnchorX) ? Number(item.placeableAnchorX) : 0.5;
        const anchorY = Number.isFinite(item.placeableAnchorY) ? Number(item.placeableAnchorY) : 1;
        // Spatial planes should treat item.x/item.y as the anchor world point, same as sprite mode.
        const alongOffset = (anchorX - 0.5) * width;
        const verticalOffset = (1 - anchorY) * height;
        const baseX = worldX - axisX * alongOffset;
        const baseY = worldY - axisY * alongOffset + verticalOffset;

        const planePointsToScreen = (centerX, centerY) => {
            const lb = { x: centerX - axisX * halfWidth, y: centerY - axisY * halfWidth };
            const rb = { x: centerX + axisX * halfWidth, y: centerY + axisY * halfWidth };
            const lt = { x: lb.x, y: lb.y - height };
            const rt = { x: rb.x, y: rb.y - height };
            return {
                sBL: worldToScreen(lb),
                sBR: worldToScreen(rb),
                sTR: worldToScreen(rt),
                sTL: worldToScreen(lt)
            };
        };

        let planeA = planePointsToScreen(baseX, baseY);
        let planeB = null;
        if (useDualWallPlanes) {
            const faceCenters = getMountedWallFaceCenters(item);
            if (faceCenters) {
                planeA = planePointsToScreen(Number(faceCenters.front.x), Number(faceCenters.front.y));
                planeB = planePointsToScreen(Number(faceCenters.back.x), Number(faceCenters.back.y));
            }
        }

        const vertexBuffer = mesh.geometry.getBuffer('aVertexPosition');
        const vertices = vertexBuffer && vertexBuffer.data ? vertexBuffer.data : null;
        if (vertices && vertices.length >= 8) {
            vertices[0] = planeA.sBL.x; vertices[1] = planeA.sBL.y;
            vertices[2] = planeA.sBR.x; vertices[3] = planeA.sBR.y;
            vertices[4] = planeA.sTR.x; vertices[5] = planeA.sTR.y;
            vertices[6] = planeA.sTL.x; vertices[7] = planeA.sTL.y;
            if (planeB && vertices.length >= 16) {
                vertices[8] = planeB.sBL.x; vertices[9] = planeB.sBL.y;
                vertices[10] = planeB.sBR.x; vertices[11] = planeB.sBR.y;
                vertices[12] = planeB.sTR.x; vertices[13] = planeB.sTR.y;
                vertices[14] = planeB.sTL.x; vertices[15] = planeB.sTL.y;
            }
            vertexBuffer.update();
        }
        mesh.rotation = 0;
        return;
    }

    if (
        item &&
        isPlacedObjectEntity(item) &&
        item._spatialPlaneMesh &&
        item.pixiSprite === item._spatialPlaneMesh
    ) {
        if (item._placedObjectBaseSprite) {
            item.pixiSprite = item._placedObjectBaseSprite;
        } else {
            const fallbackTexture = (typeof item.texturePath === "string" && item.texturePath.length > 0)
                ? PIXI.Texture.from(item.texturePath)
                : PIXI.Texture.WHITE;
            item.pixiSprite = new PIXI.Sprite(fallbackTexture);
            item.pixiSprite.anchor.set(0.5, 1);
        }
    }

    const coors = worldToScreen(item);
    ensureSpriteFrames(item);
    if (item.spriteFrames && item.pixiSprite) {
        const rowIndex = typeof item.getDirectionRow === "function" ? item.getDirectionRow() : 0;
        const safeRow = Math.max(0, Math.min(rowIndex, (item.spriteRows || 1) - 1));
        const safeCol = Math.max(0, Math.min(item.spriteCol || 0, (item.spriteCols || 1) - 1));
        const rowFrames = item.spriteFrames[safeRow] || item.spriteFrames[0];
        const nextTexture = rowFrames && (rowFrames[safeCol] || rowFrames[0]);
        if (nextTexture) item.pixiSprite.texture = nextTexture;
    }
    item.pixiSprite.x = coors.x;
    item.pixiSprite.y = coors.y;
    if (item && isPlacedObjectEntity(item) && item.rotationAxis !== "spatial" && item.pixiSprite instanceof PIXI.Sprite) {
        const lodTexturePath = resolvePlacedObjectLodTexturePath(item);
        if (typeof lodTexturePath === "string" && lodTexturePath.length > 0 && lodTexturePath !== item._activeLodTexturePath) {
            item.pixiSprite.texture = PIXI.Texture.from(lodTexturePath);
            item._activeLodTexturePath = lodTexturePath;
        }
    }
    const spriteTexture = item.pixiSprite && item.pixiSprite.texture ? item.pixiSprite.texture : null;
    const nativeTexW = spriteTexture && Number.isFinite(spriteTexture.width) ? Number(spriteTexture.width) : null;
    const nativeTexH = spriteTexture && Number.isFinite(spriteTexture.height) ? Number(spriteTexture.height) : null;
    const useNativeLodSize = (
        debugUseLodNativePixelSize &&
        item &&
        isPlacedObjectEntity(item) &&
        item.rotationAxis !== "spatial" &&
        Number.isFinite(nativeTexW) &&
        Number.isFinite(nativeTexH)
    );
    // item.pixiSprite.anchor.set(0, 1);
    item.pixiSprite.width = useNativeLodSize ? nativeTexW : ((item.width || 1) * viewscale);
    // Pavement gets squashed by xyratio for isometric effect, but trees/animals/walls display at full height
    if (item.type === "road") {
        item.pixiSprite.width = (item.width || 1) * viewscale * 1.1547;
        item.pixiSprite.height = (item.height || 1) * viewscale * xyratio;
    } else {
        if (useNativeLodSize) {
            item.pixiSprite.height = nativeTexH;
            item.pixiSprite.width = nativeTexW;
        } else {
            item.pixiSprite.height = (item.height || 1) * viewscale;
            item.pixiSprite.width = (item.width || 1) * viewscale;
        }
    }
    item.pixiSprite.skew.x = 0;

    // Apply tree taper mesh deformation during fall
    if (item.type === "tree") {
        applyTreeTaperMesh(item, coors);
    }

    const visualRotation = (item && item.rotationAxis === "none")
        ? 0
        : Number.isFinite(item.placementRotation)
        ? item.placementRotation
        : item.rotation;
    if (visualRotation) {
        item.pixiSprite.rotation = visualRotation * (Math.PI / 180);
    } else {
        item.pixiSprite.rotation = 0;
    }

}

function updateLandLayer() {
    if (!map || !landLayer) return;
    const camera = (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
        ? interpolatedViewport
        : viewport;
    const cameraWidth = Number.isFinite(camera.width) ? camera.width : viewport.width;
    const cameraHeight = Number.isFinite(camera.height) ? camera.height : viewport.height;
    if (!Number.isFinite(groundChunkLastViewscale) || Math.abs(groundChunkLastViewscale - viewscale) > 0.001) {
        clearGroundChunkCache();
        groundChunkLastViewscale = viewscale;
    }
    const xScale = 0.866;
    const rawXStart = Math.floor(camera.x / xScale) - groundChunkRenderPaddingTiles;
    const rawXEnd = Math.ceil((camera.x + cameraWidth) / xScale) + groundChunkRenderPaddingTiles;
    const rawYStart = Math.floor(camera.y) - groundChunkRenderPaddingTiles;
    const rawYEnd = Math.ceil(camera.y + cameraHeight) + groundChunkRenderPaddingTiles;
    const xRanges = getWrappedIndexRanges(rawXStart, rawXEnd, map.width, map.wrapX);
    const yRanges = getWrappedIndexRanges(rawYStart, rawYEnd, map.height, map.wrapY);
    if (xRanges.length === 0 || yRanges.length === 0) return;
    const chunkCountX = Math.ceil(map.width / groundChunkTileSize);
    const chunkCountY = Math.ceil(map.height / groundChunkTileSize);

    groundChunkCache.forEach(chunk => {
        if (chunk && chunk.sprite) chunk.sprite.visible = false;
    });

    const visibleChunkKeys = new Set();
    yRanges.forEach(yRange => {
        for (let y = yRange.start; y <= yRange.end; y++) {
            const chunkY = Math.floor(y / groundChunkTileSize);
            if (!Number.isFinite(chunkY) || chunkY < 0 || chunkY >= chunkCountY) continue;
            xRanges.forEach(xRange => {
                for (let x = xRange.start; x <= xRange.end; x++) {
                    const chunkX = Math.floor(x / groundChunkTileSize);
                    if (!Number.isFinite(chunkX) || chunkX < 0 || chunkX >= chunkCountX) continue;
                    visibleChunkKeys.add(getGroundChunkKey(chunkX, chunkY));
                }
            });
        }
    });

    visibleChunkKeys.forEach(chunkKey => {
        const parts = chunkKey.split(",");
        if (parts.length !== 2) return;
        const chunkX = Number(parts[0]);
        const chunkY = Number(parts[1]);
        if (!Number.isFinite(chunkX) || !Number.isFinite(chunkY)) return;
        const chunk = ensureGroundChunk(chunkX, chunkY);
        if (!chunk || !chunk.sprite) return;
        chunk.lastUsedFrame = frameCount;

        const dx = (map && typeof map.shortestDeltaX === "function")
            ? map.shortestDeltaX(camera.x, chunk.minWorldX)
            : (chunk.minWorldX - camera.x);
        const dy = (map && typeof map.shortestDeltaY === "function")
            ? map.shortestDeltaY(camera.y, chunk.minWorldY)
            : (chunk.minWorldY - camera.y);
        chunk.sprite.visible = true;
        chunk.sprite.x = Math.round(dx * viewscale);
        chunk.sprite.y = Math.round(dy * viewscale * xyratio);
    });

    if (groundChunkCache.size > groundChunkCacheMaxEntries) {
        const evictable = [];
        groundChunkCache.forEach((chunk, key) => {
            if (!visibleChunkKeys.has(key)) {
                evictable.push({
                    key,
                    chunk,
                    lastUsedFrame: Number.isFinite(chunk.lastUsedFrame) ? chunk.lastUsedFrame : -Infinity
                });
            }
        });
        evictable.sort((a, b) => a.lastUsedFrame - b.lastUsedFrame);
        for (let i = 0; i < evictable.length && groundChunkCache.size > groundChunkCacheMaxEntries; i++) {
            const entry = evictable[i];
            destroyGroundChunk(entry.chunk);
            groundChunkCache.delete(entry.key);
        }
    }
}

function forEachWrappedNodeInViewport(xPadding, yPadding, callback, cameraOverride = null) {
    if (!map || typeof callback !== "function") return;
    const camera = cameraOverride || (
        (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
            ? interpolatedViewport
            : viewport
    );
    const cameraWidth = Number.isFinite(camera.width) ? camera.width : viewport.width;
    const cameraHeight = Number.isFinite(camera.height) ? camera.height : viewport.height;
    const xScale = 0.866;
    const xStart = Math.floor(camera.x / xScale) - xPadding;
    const xEnd = Math.ceil((camera.x + cameraWidth) / xScale) + xPadding;
    const yStart = Math.floor(camera.y) - yPadding;
    const yEnd = Math.ceil(camera.y + cameraHeight) + yPadding;
    const xRanges = getWrappedIndexRanges(xStart, xEnd, map.width, map.wrapX);
    const yRanges = getWrappedIndexRanges(yStart, yEnd, map.height, map.wrapY);
    if (xRanges.length === 0 || yRanges.length === 0) return;

    yRanges.forEach(yRange => {
        for (let y = yRange.start; y <= yRange.end; y++) {
            xRanges.forEach(xRange => {
                for (let x = xRange.start; x <= xRange.end; x++) {
                    const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
                    if (node) callback(node);
                }
            });
        }
    });
}

function drawProjectiles(houseHitbox = null, wizardInsideHouse = false) {
    remainingBalls = [];
    projectiles.forEach(ball => {
        if (!ball.visible) return;
        const projectileWorldX = ball.landed ? ball.landedWorldX : ball.x;
        const projectileWorldY = ball.landed ? ball.landedWorldY : ball.y;
        const projectileInsideHouse = !!(
            wizardInsideHouse &&
            indoorObjectLayer &&
            houseHitbox &&
            Number.isFinite(projectileWorldX) &&
            Number.isFinite(projectileWorldY) &&
            hitboxContainsWorldPoint(houseHitbox, projectileWorldX, projectileWorldY)
        );
        const targetLayer = projectileInsideHouse && indoorObjectLayer ? indoorObjectLayer : projectileLayer;

        if (!ball.pixiSprite) {
            // Create sprite from actual texture
            const texture = PIXI.Texture.from(ball.image.src);
            ball.pixiSprite = new PIXI.Sprite(texture);
            ball.pixiSprite.anchor.set(0.5, 0.5);
            ball.pixiSprite._lastImageSrc = ball.image.src;
            targetLayer.addChild(ball.pixiSprite);
        } else if (ball.pixiSprite.parent !== targetLayer) {
            targetLayer.addChild(ball.pixiSprite);
        }

        // Handle fireball animation (animates while moving)
        if (ball.explosionFrames && ball.explosionFrames.length > 0) {
            ball.pixiSprite.texture = ball.explosionFrames[Math.floor(ball.explosionFrame) % ball.explosionFrames.length];
        }
        // Handle grenade explosion animation (animates when landed)
        else if (ball.isExploding && ball.explosionFrames) {
            ball.pixiSprite.texture = ball.explosionFrames[ball.explosionFrame];
        }
        // Update texture if image changed (for non-animated transitions)
        else if (ball.pixiSprite._lastImageSrc !== ball.image.src) {
            ball.pixiSprite.texture = PIXI.Texture.from(ball.image.src);
            ball.pixiSprite._lastImageSrc = ball.image.src;
        }

        // If landed, use fixed world position; otherwise follow projectile
        if (ball.landed) {
            const landedScreenCoors = worldToScreen({x: ball.landedWorldX, y: ball.landedWorldY});
            ball.pixiSprite.x = landedScreenCoors.x;
            ball.pixiSprite.y = landedScreenCoors.y;
        } else {
            const ballScreenCoors = worldToScreen(ball);
            ball.pixiSprite.x = ballScreenCoors.x;
            ball.pixiSprite.y = ballScreenCoors.y;
        }
        ball.pixiSprite.width = ball.apparentSize;
        ball.pixiSprite.height = ball.apparentSize;
        ball.pixiSprite.visible = true;

        remainingBalls.push(ball);
    });
    projectiles = remainingBalls;
}

function normalizeAngle(theta) {
    let a = theta;
    const twoPi = Math.PI * 2;
    while (a <= -Math.PI) a += twoPi;
    while (a > Math.PI) a -= twoPi;
    return a;
}

function angleInSpan(theta, a0, a1) {
    const t = normalizeAngle(theta);
    const s0 = normalizeAngle(a0);
    const s1 = normalizeAngle(a1);
    let span = normalizeAngle(s1 - s0);
    if (span < 0) span += Math.PI * 2;
    let rel = normalizeAngle(t - s0);
    if (rel < 0) rel += Math.PI * 2;
    return rel <= span;
}

function angleToBin(theta, bins) {
    const twoPi = Math.PI * 2;
    const norm = normalizeAngle(theta);
    const unit = (norm + Math.PI) / twoPi;
    const idx = Math.floor(unit * bins);
    if (idx < 0) return 0;
    if (idx >= bins) return bins - 1;
    return idx;
}

function forEachBinInShortSpan(a0, a1, bins, callback) {
    const twoPi = Math.PI * 2;
    const start = normalizeAngle(a0);
    const delta = normalizeAngle(a1 - a0); // shortest signed arc in [-pi, pi]
    const direction = delta >= 0 ? 1 : -1;
    const spanBins = Math.max(1, Math.ceil((Math.abs(delta) / twoPi) * bins));
    const startIdx = angleToBin(start, bins);
    let prevIdx = -1;
    for (let i = 0; i <= spanBins; i++) {
        const idx = (startIdx + (direction * i) + bins) % bins;
        if (idx === prevIdx) continue;
        prevIdx = idx;
        callback(idx);
    }
}

function cross2(ax, ay, bx, by) {
    return ax * by - ay * bx;
}

function raySegmentDistance(wx, wy, dirX, dirY, x1, y1, x2, y2) {
    const rx = dirX;
    const ry = dirY;
    const sx = x2 - x1;
    const sy = y2 - y1;
    const qpx = x1 - wx;
    const qpy = y1 - wy;
    const denom = cross2(rx, ry, sx, sy);
    if (Math.abs(denom) < 1e-8) return null;
    const t = cross2(qpx, qpy, sx, sy) / denom;
    const u = cross2(qpx, qpy, rx, ry) / denom;
    if (t >= 0 && u >= 0 && u <= 1) return t;
    return null;
}

function rayCircleDistance(wx, wy, dirX, dirY, cx, cy, r) {
    const ox = wx - cx;
    const oy = wy - cy;
    const b = 2 * (ox * dirX + oy * dirY);
    const c = ox * ox + oy * oy - r * r;
    const disc = b * b - 4 * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const t1 = (-b - s) / 2;
    const t2 = (-b + s) / 2;
    if (t1 >= 0) return t1;
    if (t2 >= 0) return t2;
    return null;
}

function computeLosDebugState(candidates) {
    if (!wizard || !Array.isArray(candidates)) {
        return { bins: 1000, minAngle: -Math.PI, owner: [], depth: [], boundaryBins: [], visibleObjects: [], elapsedMs: 0 };
    }
    const startMs = performance.now();
    const bins = 1000;
    const twoPi = Math.PI * 2;
    const minAngle = -Math.PI;
    const depth = new Float32Array(bins);
    const owner = new Array(bins).fill(null);
    for (let i = 0; i < bins; i++) depth[i] = Infinity;

    const wx = wizard.x;
    const wy = wizard.y;
    const angleForBin = idx => minAngle + ((idx + 0.5) / bins) * twoPi;

    const processHit = (obj, binIdx, hitDist) => {
        if (!Number.isFinite(hitDist) || hitDist < 0) return;
        if (hitDist < depth[binIdx]) {
            depth[binIdx] = hitDist;
            owner[binIdx] = obj;
        }
    };

    for (const obj of candidates) {
        if (!obj || obj.gone || obj.vanishing) continue;
        const hitbox = obj.groundPlaneHitbox;
        if (!hitbox) continue;

        if (hitbox instanceof CircleHitbox) {
            const cx = hitbox.x;
            const cy = hitbox.y;
            const r = hitbox.radius;
            if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || r <= 0) continue;
            const dx = cx - wx;
            const dy = cy - wy;
            const centerDist = Math.hypot(dx, dy);
            if (centerDist <= r + 1e-6) {
                for (let b = 0; b < bins; b++) processHit(obj, b, 0);
                continue;
            }
            const centerAngle = Math.atan2(dy, dx);
            const halfSpan = Math.asin(Math.min(1, r / centerDist));
            const a0 = centerAngle - halfSpan;
            const a1 = centerAngle + halfSpan;
            for (let b = 0; b < bins; b++) {
                const theta = angleForBin(b);
                if (!angleInSpan(theta, a0, a1)) continue;
                const dirX = Math.cos(theta);
                const dirY = Math.sin(theta);
                const t = rayCircleDistance(wx, wy, dirX, dirY, cx, cy, r);
                if (t !== null) processHit(obj, b, t);
            }
            continue;
        }

        if (hitbox instanceof PolygonHitbox && Array.isArray(hitbox.points) && hitbox.points.length >= 2) {
            const points = hitbox.points;
            for (let i = 0; i < points.length; i++) {
                const p1 = points[i];
                const p2 = points[(i + 1) % points.length];
                if (!p1 || !p2) continue;
                for (let b = 0; b < bins; b++) {
                    const theta = angleForBin(b);
                    const dirX = Math.cos(theta);
                    const dirY = Math.sin(theta);
                    const t = raySegmentDistance(wx, wy, dirX, dirY, p1.x, p1.y, p2.x, p2.y);
                    if (t !== null) processHit(obj, b, t);
                }
            }
        }
    }

    const boundaryBins = [];
    for (let i = 0; i < bins; i++) {
        const prev = owner[(i - 1 + bins) % bins];
        if (owner[i] !== prev) boundaryBins.push(i);
    }
    const visibleSet = new Set();
    for (let i = 0; i < bins; i++) {
        if (owner[i]) visibleSet.add(owner[i]);
    }
    return {
        bins,
        minAngle,
        owner,
        depth,
        boundaryBins,
        visibleObjects: Array.from(visibleSet),
        elapsedMs: performance.now() - startMs
    };
}

function ensureUiArrowCursorElement() {
    if (uiArrowCursorElement || typeof document === "undefined" || !document.body) return uiArrowCursorElement;
    const el = document.createElement("img");
    el.id = "uiArrowCursorOverlay";
    el.src = "/assets/images/arrow.png";
    el.alt = "";
    el.style.position = "fixed";
    el.style.left = "0px";
    el.style.top = "0px";
    el.style.width = "40px";
    el.style.height = "50px";
    el.style.transform = "translate(-50%, 0)";
    el.style.transformOrigin = "50% 0%";
    el.style.pointerEvents = "none";
    el.style.zIndex = "200000";
    el.style.display = "none";
    document.body.appendChild(el);
    uiArrowCursorElement = el;
    return uiArrowCursorElement;
}

function setUiArrowCursorVisible(visible, clientX = null, clientY = null) {
    const el = ensureUiArrowCursorElement();
    if (!el) return;
    if (!visible) {
        el.style.display = "none";
        return;
    }
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    el.style.left = `${clientX}px`;
    el.style.top = `${clientY}px`;
    el.style.display = "block";
}

function getVirtualCursorClientPosition() {
    if (!app || !app.view) return { x: NaN, y: NaN };
    const rect = app.view.getBoundingClientRect();
    if (!Number.isFinite(mousePos.screenX) || !Number.isFinite(mousePos.screenY)) {
        return { x: NaN, y: NaN };
    }
    return {
        x: rect.left + mousePos.screenX,
        y: rect.top + mousePos.screenY
    };
}

function isCursorOverUiAtClientPoint(clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || typeof document === "undefined") return false;
    const perfReadoutEl = document.getElementById("perfReadout");
    if (perfReadoutEl && perfReadoutEl.style.display !== "none") {
        const rect = perfReadoutEl.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
            return true;
        }
    }
    const hovered = document.elementFromPoint(clientX, clientY);
    if (!hovered || typeof hovered.closest !== "function") return false;
    return !!hovered.closest("#spellMenu, #selectedSpell, #spellSelector, #auraMenu, #selectedAura, #auraSelector, #activeAuraIcons, #statusBars");
}

function updateCursor() {
    const virtualClient = getVirtualCursorClientPosition();
    const physicalClientX = Number.isFinite(mousePos.clientX) ? mousePos.clientX : NaN;
    const physicalClientY = Number.isFinite(mousePos.clientY) ? mousePos.clientY : NaN;
    const useVirtualPoint = !!pointerLockActive;
    const hoverClientX = useVirtualPoint ? virtualClient.x : (Number.isFinite(physicalClientX) ? physicalClientX : virtualClient.x);
    const hoverClientY = useVirtualPoint ? virtualClient.y : (Number.isFinite(physicalClientY) ? physicalClientY : virtualClient.y);
    const overMenuUi = isCursorOverUiAtClientPoint(hoverClientX, hoverClientY);
    if (overMenuUi) {
        if (cursorSprite) cursorSprite.visible = false;
        if (spellCursor) spellCursor.visible = false;
        setUiArrowCursorVisible(true, hoverClientX, hoverClientY);
        return;
    } else {
        setUiArrowCursorVisible(false);
    }

    if (!Number.isFinite(mousePos.screenX) || !Number.isFinite(mousePos.screenY) || !wizard) {
        return;
    }

    // Toggle cursor visibility based on spacebar state
    const spacePressed = keysPressed[' '] || false;

    if (cursorSprite) {
        cursorSprite.visible = false // !spacePressed;
    }
    if (spellCursor) {
        spellCursor.visible = true // spacePressed;
    }

    // Use whichever cursor is active
    const activeCursor = spellCursor; // spacePressed ? spellCursor : cursorSprite;
    if (!activeCursor) return;

    // Set cursor position to mouse position
    activeCursor.x = mousePos.screenX;
    activeCursor.y = mousePos.screenY;
    const placingObject = wizard && wizard.currentSpell === "placeobject";
    ensureSpellCursorShape(placingObject ? "placeobject" : "default");

    // Calculate wizard position in screen coordinates
    wizardScreenCoors = worldToScreen(wizard);
    const wizardScreenX = wizardScreenCoors.x;
    const wizardScreenY = wizardScreenCoors.y;

    // Calculate vector from mouse to wizard
    const dx = wizardScreenX - mousePos.screenX;
    const dy = wizardScreenY - mousePos.screenY;

    // Calculate rotation angle (atan2 returns angle from -PI to PI)
    // Add PI to point away from wizard, then add PI/2 for visual alignment
    if (placingObject) {
        activeCursor.rotation = 0;
    } else {
        const angle = Math.atan2(dy, dx) + Math.PI * 1.5;
        activeCursor.rotation = angle;
    }

    // Set size for sprite cursor
    if (!spacePressed && cursorSprite) {
        cursorSprite.width = 40;
        cursorSprite.height = 50;
    }
}

function distance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.hypot(dx, dy);
}

function withinRadius(x1, y1, x2, y2, radius) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy <= radius * radius;
}

function pointInPolygon(point, polygon) {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || 1e-7) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function updateRoofPreview(roof) {
    if (!roof) return;

    // Show/hide based on Q+R keys
    const qPressed = keysPressed['q'] || false;
    const rPressed = keysPressed['r'] || false;
    const hotkeysPressed = qPressed && rPressed;

    if (!roof.pixiMesh) {
        roof.createPixiMesh();
        // Render roof through objectLayer depth sorting instead of fixed roof layer order.
        if (roof.pixiMesh.parent) {
            roof.pixiMesh.parent.removeChild(roof.pixiMesh);
        }
    }

    // Place once per key chord press.
    const justPressed = hotkeysPressed && !roof._placementChordWasDown;
    roof._placementChordWasDown = hotkeysPressed;
    if (justPressed) {
        roof.x = wizard.x;
        roof.y = wizard.y;
        roof.placed = true;
        if (typeof roof.updateGroundPlaneHitbox === 'function') {
            roof.updateGroundPlaneHitbox();
        }
    }

    const wizardInsideRoof = !!(
        roof.placed &&
        roof.groundPlaneHitbox &&
        typeof roof.groundPlaneHitbox.containsPoint === 'function' &&
        roof.groundPlaneHitbox.containsPoint(wizard.x, wizard.y)
    );
    roof.pixiMesh.visible = !!roof.placed && !wizardInsideRoof;

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

    if (roof.placed) {
        const roofCoords = worldToScreen(roof);
        roof.pixiMesh.x = roofCoords.x;
        roof.pixiMesh.y = roofCoords.y;
        roof.pixiMesh.scale.set(viewscale, viewscale);
    }
}

function message(text) {
    messages.push(text);
    setTimeout(() => {
        messages.shift();
    }, 8000);
}
