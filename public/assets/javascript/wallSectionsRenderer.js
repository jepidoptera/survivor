(function initWallSectionsRenderer(globalScope) {
    const sectionCompositeCache = new Map();
    const wallSectionInstances = new Map();
    const SECTION_DEPTH_VS = `
precision mediump float;
attribute vec3 aWorldPosition;
attribute vec2 aUvs;
attribute vec4 aColor;
attribute float aTextureMix;
uniform vec2 uScreenSize;
uniform vec2 uCameraWorld;
uniform float uViewScale;
uniform float uXyRatio;
uniform vec2 uDepthRange;
varying vec2 vUvs;
varying vec4 vColor;
varying float vTextureMix;
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
    vColor = aColor;
    vTextureMix = aTextureMix;
}
`;
    const SECTION_DEPTH_FS = `
precision mediump float;
varying vec2 vUvs;
varying vec4 vColor;
varying float vTextureMix;
uniform sampler2D uSampler;
uniform vec4 uTint;
uniform float uAlphaCutoff;
void main(void) {
    vec4 sampled = texture2D(uSampler, vUvs);
    vec4 tex = mix(vec4(1.0, 1.0, 1.0, 1.0), sampled, clamp(vTextureMix, 0.0, 1.0));
    vec4 outColor = tex * uTint * vColor;
    if (outColor.a < uAlphaCutoff) discard;
    gl_FragColor = outColor;
}
`;
    const sectionObjectIdMap = new WeakMap();
    let nextSectionObjectId = 1;
    let sectionDirtyAll = true;
    const sectionDirtyIds = new Set();
    const placementSectionCache = new Map();
    let placementDirtyAll = true;
    const placementDirtyIds = new Set();
    let sectionLastViewscale = NaN;
    let sectionLastXyRatio = NaN;
    let sectionForcedRebuildFrames = 0;
    let sectionDepthMeshState = null;
    const defaultWallTexturePath = "/assets/images/walls/stonewall.png";
    const defaultWallTextureRepeatsPerMapUnitX = 0.1;
    const defaultWallTextureRepeatsPerMapUnitY = 0.1;
    let wallTextureConfigCache = null;
    let wallTextureConfigPromise = null;

    function getSectionObjectId(item) {
        if (!item || (typeof item !== "object" && typeof item !== "function")) return 0;
        if (sectionObjectIdMap.has(item)) return sectionObjectIdMap.get(item);
        const nextId = nextSectionObjectId++;
        sectionObjectIdMap.set(item, nextId);
        return nextId;
    }

    function markDirty(sectionId = null) {
        if (Number.isInteger(sectionId)) {
            sectionDirtyIds.add(Number(sectionId));
            placementDirtyIds.add(Number(sectionId));
            return;
        }
        sectionDirtyAll = true;
        placementDirtyAll = true;
    }

    function markAllDirty() {
        sectionDirtyAll = true;
        placementDirtyAll = true;
    }

    function destroyBundle(bundle) {
        if (!bundle) return;
        if (bundle.sprite && bundle.sprite.parent) {
            bundle.sprite.parent.removeChild(bundle.sprite);
        }
        if (bundle.sprite && typeof bundle.sprite.destroy === "function") {
            bundle.sprite.destroy({ children: false, texture: false, baseTexture: false });
        }
        if (bundle.renderTexture && typeof bundle.renderTexture.destroy === "function") {
            bundle.renderTexture.destroy(true);
        }
        if (bundle.mesh && bundle.mesh.parent) {
            bundle.mesh.parent.removeChild(bundle.mesh);
        }
        if (bundle.mesh && typeof bundle.mesh.destroy === "function") {
            bundle.mesh.destroy({ children: false, texture: false, baseTexture: false });
        }
    }

    function ensureSectionDepthMeshState(pixiRef) {
        if (!pixiRef) return null;
        if (sectionDepthMeshState) return sectionDepthMeshState;
        const state = new pixiRef.State();
        state.depthTest = true;
        state.depthMask = true;
        state.blend = false;
        state.culling = false;
        sectionDepthMeshState = state;
        return state;
    }

    function createSectionDepthMesh(pixiRef) {
        if (!pixiRef) return null;
        const state = ensureSectionDepthMeshState(pixiRef);
        if (!state) return null;
        const geometry = new pixiRef.Geometry()
            .addAttribute("aWorldPosition", new Float32Array(0), 3)
            .addAttribute("aUvs", new Float32Array(0), 2)
            .addAttribute("aColor", new Float32Array(0), 4)
            .addAttribute("aTextureMix", new Float32Array(0), 1)
            .addIndex(new Uint16Array(0));
        const shader = pixiRef.Shader.from(SECTION_DEPTH_VS, SECTION_DEPTH_FS, {
            uScreenSize: new Float32Array([1, 1]),
            uCameraWorld: new Float32Array([0, 0]),
            uViewScale: 1,
            uXyRatio: 1,
            uDepthRange: new Float32Array([0, 1]),
            uTint: new Float32Array([1, 1, 1, 1]),
            uAlphaCutoff: 0.02,
            uSampler: pixiRef.Texture.WHITE
        });
        const mesh = new pixiRef.Mesh(geometry, shader, state, pixiRef.DRAW_MODES.TRIANGLES);
        mesh.name = "wallSectionCompositeDepthMesh";
        mesh.roundPixels = true;
        mesh.interactive = false;
        mesh.visible = false;
        return mesh;
    }

    function setSectionMeshGeometry(mesh, geometry) {
        if (!mesh || !mesh.geometry || !geometry) return false;
        const posBuffer = mesh.geometry.getBuffer("aWorldPosition");
        const uvBuffer = mesh.geometry.getBuffer("aUvs");
        const colorBuffer = mesh.geometry.getBuffer("aColor");
        const textureMixBuffer = mesh.geometry.getBuffer("aTextureMix");
        const indexBuffer = mesh.geometry.getIndex();
        if (!posBuffer || !uvBuffer || !colorBuffer || !textureMixBuffer || !indexBuffer) return false;
        posBuffer.data = geometry.positions;
        uvBuffer.data = geometry.uvs;
        colorBuffer.data = geometry.colors;
        textureMixBuffer.data = geometry.textureMix;
        indexBuffer.data = geometry.indices;
        posBuffer.update();
        uvBuffer.update();
        colorBuffer.update();
        textureMixBuffer.update();
        indexBuffer.update();
        return true;
    }

    function updateSectionMeshUniforms(mesh, options = {}) {
        if (!mesh || !mesh.shader || !mesh.shader.uniforms) return;
        const camera = options.camera || null;
        const viewscale = Number(options.viewscale);
        const xyratio = Number(options.xyratio);
        const appRef = options.app || null;
        const texture = options.texture || null;
        const alphaCutoff = Number(options.alphaCutoff);
        const tint = Number.isFinite(options.tint) ? Number(options.tint) : 0xFFFFFF;
        const alpha = Number.isFinite(options.alpha) ? Number(options.alpha) : 1;
        const viewportHeight = Number(camera && camera.height) || 30;
        const nearMetric = -Math.max(80, viewportHeight * 0.6);
        const farMetric = Math.max(180, viewportHeight * 2.0 + 80);
        const depthSpanInv = 1 / Math.max(1e-6, farMetric - nearMetric);
        const screenW = (appRef && appRef.screen && Number.isFinite(appRef.screen.width))
            ? Number(appRef.screen.width)
            : 1;
        const screenH = (appRef && appRef.screen && Number.isFinite(appRef.screen.height))
            ? Number(appRef.screen.height)
            : 1;
        const uniforms = mesh.shader.uniforms;
        uniforms.uScreenSize[0] = Math.max(1, screenW);
        uniforms.uScreenSize[1] = Math.max(1, screenH);
        uniforms.uCameraWorld[0] = Number(camera && camera.x) || 0;
        uniforms.uCameraWorld[1] = Number(camera && camera.y) || 0;
        uniforms.uViewScale = Number.isFinite(viewscale) ? Number(viewscale) : 1;
        uniforms.uXyRatio = Number.isFinite(xyratio) ? Number(xyratio) : 1;
        uniforms.uDepthRange[0] = farMetric;
        uniforms.uDepthRange[1] = depthSpanInv;
        uniforms.uTint[0] = ((tint >> 16) & 255) / 255;
        uniforms.uTint[1] = ((tint >> 8) & 255) / 255;
        uniforms.uTint[2] = (tint & 255) / 255;
        uniforms.uTint[3] = alpha;
        uniforms.uAlphaCutoff = Number.isFinite(alphaCutoff) ? Number(alphaCutoff) : 0.02;
        uniforms.uSampler = texture || ((typeof globalScope.PIXI !== "undefined" && globalScope.PIXI && globalScope.PIXI.Texture)
            ? globalScope.PIXI.Texture.WHITE
            : null);
    }

    function clearCache() {
        if (sectionCompositeCache.size > 0) {
            sectionCompositeCache.forEach(bundle => {
                destroyBundle(bundle);
            });
            sectionCompositeCache.clear();
        }
        wallSectionInstances.clear();
        placementSectionCache.clear();
        sectionDirtyIds.clear();
        placementDirtyIds.clear();
        sectionDirtyAll = true;
        placementDirtyAll = true;
    }

    function queueRebuildPass(frameCount = 6) {
        const frames = Number.isFinite(frameCount) ? Math.max(1, Math.floor(frameCount)) : 6;
        sectionForcedRebuildFrames = Math.max(sectionForcedRebuildFrames, frames);
        clearCache();
        markAllDirty();
    }

    function prepareFrame(viewscale, xyratio, options = {}) {
        const outputMode = (options && options.outputMode === "mesh3d") ? "mesh3d" : "sprite";
        if (sectionForcedRebuildFrames > 0) {
            markAllDirty();
        }
        if (outputMode === "mesh3d") {
            void ensureWallTextureConfigLoaded();
        }
        if (outputMode === "mesh3d") return;
        if (!Number.isFinite(sectionLastViewscale) || Math.abs(sectionLastViewscale - viewscale) > 1e-6) {
            sectionLastViewscale = viewscale;
            markAllDirty();
        }
        if (!Number.isFinite(sectionLastXyRatio) || Math.abs(sectionLastXyRatio - xyratio) > 1e-6) {
            sectionLastXyRatio = xyratio;
            markAllDirty();
        }
    }

    function endFrame() {
        sectionDirtyAll = false;
        if (sectionForcedRebuildFrames > 0) {
            sectionForcedRebuildFrames -= 1;
        }
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
        if (typeof fetch !== "function") {
            wallTextureConfigCache = { byPath: new Map(), byFile: new Map() };
            return Promise.resolve(wallTextureConfigCache);
        }
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
                queueRebuildPass(2);
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

    function appendDepthQuad(builder, p0, p1, p2, p3, uvRect = null, options = {}) {
        if (!builder || !p0 || !p1 || !p2 || !p3) return;
        if (!Array.isArray(builder.positions)) builder.positions = [];
        if (!Array.isArray(builder.uvs)) builder.uvs = [];
        if (!Array.isArray(builder.colors)) builder.colors = [];
        if (!Array.isArray(builder.textureMix)) builder.textureMix = [];
        if (!Array.isArray(builder.indices)) builder.indices = [];
        if (!Number.isFinite(builder.vertexCount)) builder.vertexCount = 0;
        const u0 = uvRect && Number.isFinite(uvRect.u0) ? Number(uvRect.u0) : 0;
        const v0 = uvRect && Number.isFinite(uvRect.v0) ? Number(uvRect.v0) : 0;
        const u1 = uvRect && Number.isFinite(uvRect.u1) ? Number(uvRect.u1) : 1;
        const v1 = uvRect && Number.isFinite(uvRect.v1) ? Number(uvRect.v1) : 1;
        const rgba = Array.isArray(options.color) && options.color.length >= 4
            ? [Number(options.color[0]), Number(options.color[1]), Number(options.color[2]), Number(options.color[3])]
            : [1, 1, 1, 1];
        const cr = Number.isFinite(rgba[0]) ? Math.max(0, Math.min(1, rgba[0])) : 1;
        const cg = Number.isFinite(rgba[1]) ? Math.max(0, Math.min(1, rgba[1])) : 1;
        const cb = Number.isFinite(rgba[2]) ? Math.max(0, Math.min(1, rgba[2])) : 1;
        const ca = Number.isFinite(rgba[3]) ? Math.max(0, Math.min(1, rgba[3])) : 1;
        const textureMix = Number.isFinite(options.textureMix) ? Math.max(0, Math.min(1, Number(options.textureMix))) : 1;
        const base = builder.vertexCount;
        builder.positions.push(
            p0.x, p0.y, p0.z,
            p1.x, p1.y, p1.z,
            p2.x, p2.y, p2.z,
            p3.x, p3.y, p3.z
        );
        builder.uvs.push(u0, v1, u1, v1, u1, v0, u0, v0);
        builder.colors.push(
            cr, cg, cb, ca,
            cr, cg, cb, ca,
            cr, cg, cb, ca,
            cr, cg, cb, ca
        );
        builder.textureMix.push(textureMix, textureMix, textureMix, textureMix);
        builder.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        builder.vertexCount += 4;
    }

    function getWallCapBasesForMesh(wall, wallHeight) {
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

    function resolveWallUvInfoForMesh(wall, profile) {
        if (!wall || !profile) return null;
        const pixiRef = (typeof globalScope.PIXI !== "undefined") ? globalScope.PIXI : null;
        if (!pixiRef) return null;
        const aLeft = profile.aLeft;
        const aRight = profile.aRight;
        const bLeft = profile.bLeft;
        const bRight = profile.bRight;
        if (!aLeft || !aRight || !bLeft || !bRight) return null;
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
        const texture = pixiRef.Texture.from(wallTextureCfg.texturePath || defaultWallTexturePath);
        if (texture && texture.baseTexture) {
            texture.baseTexture.wrapMode = pixiRef.WRAP_MODES.REPEAT;
            texture.baseTexture.scaleMode = pixiRef.SCALE_MODES.LINEAR;
        }
        return {
            uStart,
            uEnd,
            repeatsPerMapUnitX,
            repeatsPerMapUnitY,
            texture
        };
    }

    function appendSingleWallWorldGeometry(builder, wall, profile, uvInfo, capInfo) {
        if (!builder || !wall || !profile || !uvInfo || !capInfo) return false;
        const wallHeight = Math.max(0.001, Number(wall.height) || 0.001);
        const wallThickness = Math.max(0.001, Number(wall.thickness) || 0.001);
        const wallHeightV = wallHeight * uvInfo.repeatsPerMapUnitY;
        const topThicknessV = Math.max(0.0001, wallThickness * uvInfo.repeatsPerMapUnitX);
        const capWidthV = Math.max(0.0001, wallThickness * uvInfo.repeatsPerMapUnitX);
        const capStartV0 = capInfo.capBaseA * uvInfo.repeatsPerMapUnitY;
        const capStartV1 = wallHeight * uvInfo.repeatsPerMapUnitY;
        const capEndV0 = capInfo.capBaseB * uvInfo.repeatsPerMapUnitY;
        const capEndV1 = wallHeight * uvInfo.repeatsPerMapUnitY;
        const gAL = { x: profile.aLeft.x, y: profile.aLeft.y, z: 0 };
        const gAR = { x: profile.aRight.x, y: profile.aRight.y, z: 0 };
        const gBL = { x: profile.bLeft.x, y: profile.bLeft.y, z: 0 };
        const gBR = { x: profile.bRight.x, y: profile.bRight.y, z: 0 };
        const tAL = { x: profile.aLeft.x, y: profile.aLeft.y, z: wallHeight };
        const tAR = { x: profile.aRight.x, y: profile.aRight.y, z: wallHeight };
        const tBL = { x: profile.bLeft.x, y: profile.bLeft.y, z: wallHeight };
        const tBR = { x: profile.bRight.x, y: profile.bRight.y, z: wallHeight };
        const mAL = { x: profile.aLeft.x, y: profile.aLeft.y, z: capInfo.capBaseA };
        const mAR = { x: profile.aRight.x, y: profile.aRight.y, z: capInfo.capBaseA };
        const mBL = { x: profile.bLeft.x, y: profile.bLeft.y, z: capInfo.capBaseB };
        const mBR = { x: profile.bRight.x, y: profile.bRight.y, z: capInfo.capBaseB };
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

    function barycentricAtPoint(px, py, ax, ay, bx, by, cx, cy) {
        const v0x = bx - ax;
        const v0y = by - ay;
        const v1x = cx - ax;
        const v1y = cy - ay;
        const v2x = px - ax;
        const v2y = py - ay;
        const denom = v0x * v1y - v1x * v0y;
        if (Math.abs(denom) < 1e-8) return null;
        const invDen = 1 / denom;
        const v = (v2x * v1y - v1x * v2y) * invDen;
        const w = (v0x * v2y - v2x * v0y) * invDen;
        const u = 1 - v - w;
        return { u, v, w };
    }

    function pointInSectionQuad(p, q0, q1, q2, q3) {
        const inTri = (a, b, c) => {
            const bc = barycentricAtPoint(p.x, p.y, a.x, a.y, b.x, b.y, c.x, c.y);
            if (!bc) return false;
            const eps = 1e-4;
            return bc.u >= -eps && bc.v >= -eps && bc.w >= -eps;
        };
        return inTri(q0, q1, q2) || inTri(q0, q2, q3);
    }

    function buildCompositeSubgroups(layerItems, mapRef = null, isWallMountedPredicate = null) {
        const isWallMounted = (typeof isWallMountedPredicate === "function")
            ? isWallMountedPredicate
            : (() => false);
        const grouped = new Map();
        for (let i = 0; i < layerItems.length; i++) {
            const item = layerItems[i];
            if (!item || !item.pixiSprite || item.gone || item.vanishing) continue;
            if (!(item.type === "wall" || (item.type !== "placedObjectPreview" && isWallMounted(item)))) continue;
            const baseGroupId = (item.type === "wall")
                ? (Number.isInteger(item.lineGroupId) ? item.lineGroupId : null)
                : (Number.isInteger(item.mountedWallLineGroupId) ? item.mountedWallLineGroupId : null);
            if (!Number.isInteger(baseGroupId)) continue;
            if (!grouped.has(baseGroupId)) {
                grouped.set(baseGroupId, { walls: [], mounted: [] });
            }
            const bucket = grouped.get(baseGroupId);
            if (item.type === "wall") {
                bucket.walls.push(item);
            } else {
                bucket.mounted.push(item);
            }
        }

        const subgroups = new Map();
        grouped.forEach((bucket, baseGroupId) => {
            if (!bucket || !Array.isArray(bucket.walls) || bucket.walls.length === 0) return;
            const subgroupKey = String(baseGroupId);
            const subgroup = {
                key: subgroupKey,
                baseGroupId,
                members: bucket.walls.slice(),
                walls: bucket.walls.slice()
            };
            if (Array.isArray(bucket.mounted) && bucket.mounted.length > 0) {
                subgroup.members.push(...bucket.mounted);
            }
            subgroups.set(subgroupKey, subgroup);
        });
        return subgroups;
    }

    function getSectionRegistry(mapRef) {
        const wallClass = (typeof globalScope.Wall !== "undefined") ? globalScope.Wall : null;
        const registry = wallClass && wallClass._sectionsById instanceof Map
            ? wallClass._sectionsById
            : null;
        if (!(registry instanceof Map)) return null;
        if (registry.size === 0 && wallClass && typeof wallClass.rebuildSectionRegistryFromWalls === "function" && mapRef) {
            const walls = Array.isArray(mapRef.objects)
                ? mapRef.objects.filter(obj => obj && obj.type === "wall")
                : [];
            wallClass.rebuildSectionRegistryFromWalls(walls);
        }
        return wallClass._sectionsById instanceof Map ? wallClass._sectionsById : registry;
    }

    function getOrBuildPlacementSection(sectionId, mapRef) {
        if (!Number.isInteger(sectionId)) return null;
        const id = Number(sectionId);
        const registry = getSectionRegistry(mapRef);
        if (!(registry instanceof Map)) return null;
        const entry = registry.get(id);
        const walls = entry && Array.isArray(entry.walls) ? entry.walls : null;
        if (!walls || walls.length === 0) return null;
        const isDirty = placementDirtyAll || placementDirtyIds.has(id) || !placementSectionCache.has(id);
        if (!isDirty) return placementSectionCache.get(id) || null;
        const section = new WallSection({ id });
        const ok = section.setFromWalls(walls, mapRef, id, []);
        if (!ok) {
            placementSectionCache.delete(id);
            return null;
        }
        placementSectionCache.set(id, section);
        placementDirtyIds.delete(id);
        return section;
    }

    class WallSection {
        constructor(options = {}) {
            this.id = options.id || "";
            this.walls = Array.isArray(options.walls) ? options.walls.slice() : [];
            this.mounted = Array.isArray(options.mounted) ? options.mounted.slice() : [];
            this.mapRef = options.mapRef || null;
            this.height = Number.isFinite(options.height) ? Number(options.height) : 0;
            this.halfThickness = Number.isFinite(options.halfThickness) ? Number(options.halfThickness) : 0.05;
            this.origin = options.origin || { x: 0, y: 0 };
            this.u = options.u || { x: 1, y: 0 };
            this.v = options.v || { x: 0, y: 1 };
            this.minAlong = Number.isFinite(options.minAlong) ? Number(options.minAlong) : 0;
            this.maxAlong = Number.isFinite(options.maxAlong) ? Number(options.maxAlong) : 0;
            this.capBaseStart = Number.isFinite(options.capBaseStart) ? Number(options.capBaseStart) : 0;
            this.capBaseEnd = Number.isFinite(options.capBaseEnd) ? Number(options.capBaseEnd) : 0;
            this.startEndpointState = options.startEndpointState || null;
            this.endEndpointState = options.endEndpointState || null;
            this.startEndpointRef = options.startEndpointRef || null;
            this.endEndpointRef = options.endEndpointRef || null;
            this.sectionSpanLength = Number.isFinite(options.sectionSpanLength) ? Number(options.sectionSpanLength) : 0;
            this.textureConfigPending = false;
        }

        setFromWalls(walls, mapRef = null, id = this.id, mounted = this.mounted) {
            if (!Array.isArray(walls) || walls.length === 0) return false;
            const first = walls[0];
            if (!first || !first.a || !first.b) return false;
            const ax = Number(first.a.x);
            const ay = Number(first.a.y);
            const bx = Number(first.b.x);
            const by = Number(first.b.y);
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return false;

            const shortestDX = (fromX, toX) =>
                (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(fromX, toX)
                    : (toX - fromX);
            const shortestDY = (fromY, toY) =>
                (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(fromY, toY)
                    : (toY - fromY);

            const dx = shortestDX(ax, bx);
            const dy = shortestDY(ay, by);
            const len = Math.hypot(dx, dy);
            if (!(len > 1e-6)) return false;
            const ux = dx / len;
            const uy = dy / len;
            const vx = -uy;
            const vy = ux;

            let minAlong = Infinity;
            let maxAlong = -Infinity;
            let maxHalfThickness = 0.05;
            let height = 0;
            const projectPoint = (px, py) => {
                const rx = shortestDX(ax, px);
                const ry = shortestDY(ay, py);
                return rx * ux + ry * uy;
            };

            for (let i = 0; i < walls.length; i++) {
                const wall = walls[i];
                if (!wall || !wall.a || !wall.b) continue;
                const wax = Number(wall.a.x);
                const way = Number(wall.a.y);
                const wbx = Number(wall.b.x);
                const wby = Number(wall.b.y);
                if (!Number.isFinite(wax) || !Number.isFinite(way) || !Number.isFinite(wbx) || !Number.isFinite(wby)) continue;
                minAlong = Math.min(minAlong, projectPoint(wax, way), projectPoint(wbx, wby));
                maxAlong = Math.max(maxAlong, projectPoint(wax, way), projectPoint(wbx, wby));
                const half = Math.max(0.001, Number(wall.thickness) || 0.001) * 0.5;
                maxHalfThickness = Math.max(maxHalfThickness, half);
                height = Math.max(height, Math.max(0, Number(wall.height) || 0));
            }
            if (!Number.isFinite(minAlong) || !Number.isFinite(maxAlong) || maxAlong <= minAlong) return false;

            const endpointKey = (point) => `${Number(point.x).toFixed(6)},${Number(point.y).toFixed(6)}`;
            const endpointWalls = new Map();
            for (let i = 0; i < walls.length; i++) {
                const wall = walls[i];
                if (!wall || !wall.a || !wall.b) continue;
                const ka = endpointKey(wall.a);
                const kb = endpointKey(wall.b);
                if (!endpointWalls.has(ka)) endpointWalls.set(ka, []);
                if (!endpointWalls.has(kb)) endpointWalls.set(kb, []);
                endpointWalls.get(ka).push({ wall, endpoint: wall.a, endpointKey: "a" });
                endpointWalls.get(kb).push({ wall, endpoint: wall.b, endpointKey: "b" });
            }
            let startEndpoint = null;
            let endEndpoint = null;
            let startEntry = null;
            let endEntry = null;
            const endpointRecords = [];
            endpointWalls.forEach((entries) => {
                if (!Array.isArray(entries) || entries.length === 0) return;
                const entry = entries[0];
                const endpoint = entry.endpoint;
                const along = projectPoint(endpoint.x, endpoint.y);
                endpointRecords.push({ entry, endpoint, along });
            });
            if (endpointRecords.length === 0) return false;

            let startRecord = endpointRecords[0];
            let endRecord = endpointRecords[0];
            for (let i = 1; i < endpointRecords.length; i++) {
                const rec = endpointRecords[i];
                if (rec.along < startRecord.along) startRecord = rec;
                if (rec.along > endRecord.along) endRecord = rec;
            }

            if (endpointRecords.length >= 2) {
                let furthestA = null;
                let furthestB = null;
                let furthestDist = -Infinity;
                for (let i = 0; i < endpointRecords.length; i++) {
                    const aRec = endpointRecords[i];
                    for (let j = i + 1; j < endpointRecords.length; j++) {
                        const bRec = endpointRecords[j];
                        const spanDx = shortestDX(aRec.endpoint.x, bRec.endpoint.x);
                        const spanDy = shortestDY(aRec.endpoint.y, bRec.endpoint.y);
                        const dist = Math.hypot(spanDx, spanDy);
                        if (dist > furthestDist) {
                            furthestDist = dist;
                            furthestA = aRec;
                            furthestB = bRec;
                        }
                    }
                }
                if (furthestA && furthestB && furthestDist > 1e-6) {
                    if (furthestA.along <= furthestB.along) {
                        startRecord = furthestA;
                        endRecord = furthestB;
                    } else {
                        startRecord = furthestB;
                        endRecord = furthestA;
                    }
                }
            }

            startEndpoint = startRecord.endpoint;
            endEndpoint = endRecord.endpoint;
            startEntry = startRecord.entry;
            endEntry = endRecord.entry;
            const sectionSpanDx = shortestDX(startEndpoint.x, endEndpoint.x);
            const sectionSpanDy = shortestDY(startEndpoint.y, endEndpoint.y);
            const sectionSpanLength = Math.hypot(sectionSpanDx, sectionSpanDy);

            const findNeighborHeightAtEndpoint = endpoint => {
                if (!endpoint) return 0;
                let maxNeighborHeight = 0;
                for (let i = 0; i < walls.length; i++) {
                    const wall = walls[i];
                    if (!wall || typeof wall.collectPotentialJoinWalls !== "function") continue;
                    const matchesEndpoint = (wall.a && Math.abs(wall.a.x - endpoint.x) <= 1e-6 && Math.abs(wall.a.y - endpoint.y) <= 1e-6) ||
                        (wall.b && Math.abs(wall.b.x - endpoint.x) <= 1e-6 && Math.abs(wall.b.y - endpoint.y) <= 1e-6);
                    if (!matchesEndpoint) continue;
                    const neighbors = wall.collectPotentialJoinWalls();
                    if (!Array.isArray(neighbors)) continue;
                    for (let j = 0; j < neighbors.length; j++) {
                        const n = neighbors[j];
                        if (!n || n.type !== "wall") continue;
                        const sameSection = Number.isInteger(n.sectionId) && Number.isInteger(wall.sectionId) && n.sectionId === wall.sectionId;
                        if (sameSection) continue;
                        const sameAxis = (typeof wall.getLineAxis === "function" && typeof n.getLineAxis === "function")
                            ? wall.getLineAxis() === n.getLineAxis()
                            : true;
                        if (!sameAxis) continue;
                        const nh = Math.max(0, Number(n.height) || 0);
                        maxNeighborHeight = Math.max(maxNeighborHeight, nh);
                    }
                }
                return Math.min(height, maxNeighborHeight);
            };

            const capBaseStart = findNeighborHeightAtEndpoint(startEndpoint);
            const capBaseEnd = findNeighborHeightAtEndpoint(endEndpoint);
            const wallSet = new Set(walls);
            const startEndpointRef = (startEntry && startEntry.wall && startEndpoint)
                ? {
                    wall: startEntry.wall,
                    endpointKey: startEntry.endpointKey === "b" ? "b" : "a",
                    endpoint: { x: Number(startEndpoint.x), y: Number(startEndpoint.y) }
                }
                : null;
            const endEndpointRef = (endEntry && endEntry.wall && endEndpoint)
                ? {
                    wall: endEntry.wall,
                    endpointKey: endEntry.endpointKey === "b" ? "b" : "a",
                    endpoint: { x: Number(endEndpoint.x), y: Number(endEndpoint.y) }
                }
                : null;
            const buildEndpointState = (entry, endpoint) => {
                if (!entry || !entry.wall || !endpoint) return null;
                const wall = entry.wall;
                if (typeof wall.collectPotentialJoinWalls !== "function" || typeof wall.sharesEndpointWith !== "function") {
                    return null;
                }
                const neighbors = wall.collectPotentialJoinWalls();
                if (!Array.isArray(neighbors) || neighbors.length === 0) return null;
                const hasExternalNeighbor = neighbors.some(neighbor =>
                    !!neighbor &&
                    neighbor.type === "wall" &&
                    !wallSet.has(neighbor) &&
                    wall.sharesEndpointWith(neighbor, endpoint)
                );
                if (!hasExternalNeighbor) return null;
                return {
                    wall,
                    endpointKey: entry.endpointKey === "b" ? "b" : "a",
                    endpoint: { x: Number(endpoint.x), y: Number(endpoint.y) }
                };
            };
            const startEndpointState = buildEndpointState(startEntry, startEndpoint);
            const endEndpointState = buildEndpointState(endEntry, endEndpoint);

            this.id = id;
            this.walls = walls.slice();
            this.mounted = Array.isArray(mounted) ? mounted.slice() : [];
            this.mapRef = mapRef;
            this.height = height;
            this.halfThickness = maxHalfThickness;
            this.origin = { x: ax, y: ay };
            this.u = { x: ux, y: uy };
            this.v = { x: vx, y: vy };
            this.minAlong = minAlong;
            this.maxAlong = maxAlong;
            this.capBaseStart = capBaseStart;
            this.capBaseEnd = capBaseEnd;
            this.startEndpointState = startEndpointState;
            this.endEndpointState = endEndpointState;
            this.startEndpointRef = startEndpointRef;
            this.endEndpointRef = endEndpointRef;
            this.sectionSpanLength = Number.isFinite(sectionSpanLength) ? sectionSpanLength : 0;
            return true;
        }

        getVisibleFacingSign(worldToScreenFn) {
            if (!(this.maxAlong > this.minAlong) || typeof worldToScreenFn !== "function") return 1;
            const startCenter = {
                x: this.origin.x + this.u.x * this.minAlong,
                y: this.origin.y + this.u.y * this.minAlong
            };
            const endCenter = {
                x: this.origin.x + this.u.x * this.maxAlong,
                y: this.origin.y + this.u.y * this.maxAlong
            };
            const plusA = {
                x: startCenter.x + this.v.x * this.halfThickness,
                y: startCenter.y + this.v.y * this.halfThickness
            };
            const plusB = {
                x: endCenter.x + this.v.x * this.halfThickness,
                y: endCenter.y + this.v.y * this.halfThickness
            };
            const minusA = {
                x: startCenter.x - this.v.x * this.halfThickness,
                y: startCenter.y - this.v.y * this.halfThickness
            };
            const minusB = {
                x: endCenter.x - this.v.x * this.halfThickness,
                y: endCenter.y - this.v.y * this.halfThickness
            };
            const plusAScreen = worldToScreenFn(plusA);
            const plusBScreen = worldToScreenFn(plusB);
            const minusAScreen = worldToScreenFn(minusA);
            const minusBScreen = worldToScreenFn(minusB);
            const plusAvgY = (plusAScreen.y + plusBScreen.y) * 0.5;
            const minusAvgY = (minusAScreen.y + minusBScreen.y) * 0.5;
            return plusAvgY >= minusAvgY ? 1 : -1;
        }

        generateMountedPlacementCandidate(options = {}) {
            const category = (typeof options.category === "string") ? options.category.trim().toLowerCase() : "";
            if (category !== "windows" && category !== "doors") return null;
            if (!Number.isFinite(this.height) || !(this.maxAlong > this.minAlong)) return null;
            const worldToScreenFn = (typeof options.worldToScreen === "function") ? options.worldToScreen : null;
            if (!worldToScreenFn) return null;

            const objectWorldWidth = Math.max(0.2, Number(options.objectWorldWidth) || 1);
            const objectWorldHeight = Math.max(0.2, Number(options.objectWorldHeight) || 1);
            const anchorY = Number.isFinite(options.anchorY) ? Number(options.anchorY) : 1;
            const viewscale = Number(options.viewscale);
            const xyratio = Number(options.xyratio);
            const mapRef = options.map || this.mapRef || null;
            const mouseWorldX = Number(options.worldX);
            const mouseWorldY = Number(options.worldY);
            const mouseScreen = options.mouseScreen && Number.isFinite(options.mouseScreen.x) && Number.isFinite(options.mouseScreen.y)
                ? { x: Number(options.mouseScreen.x), y: Number(options.mouseScreen.y) }
                : null;
            if (
                !mouseScreen ||
                !Number.isFinite(viewscale) ||
                !Number.isFinite(xyratio) ||
                !Number.isFinite(mouseWorldX) ||
                !Number.isFinite(mouseWorldY)
            ) {
                return null;
            }

            const wallHalfT = Math.max(0.001, Number(this.halfThickness) || 0.05);
            const sectionLength = this.maxAlong - this.minAlong;
            const fitsLength = sectionLength + 1e-6 >= objectWorldWidth;
            const wallHeight = Math.max(0, Number(this.height) || 0);
            const fitsHeight = objectWorldHeight <= wallHeight + 1e-6;
            const toScreen = (pt, z = 0) => {
                const s = worldToScreenFn(pt);
                return {
                    x: s.x,
                    y: s.y - z * viewscale * xyratio
                };
            };
            const startCenter = {
                x: this.origin.x + this.u.x * this.minAlong,
                y: this.origin.y + this.u.y * this.minAlong
            };
            const endCenter = {
                x: this.origin.x + this.u.x * this.maxAlong,
                y: this.origin.y + this.u.y * this.maxAlong
            };
            const gSL = { x: startCenter.x + this.v.x * wallHalfT, y: startCenter.y + this.v.y * wallHalfT };
            const gSR = { x: startCenter.x - this.v.x * wallHalfT, y: startCenter.y - this.v.y * wallHalfT };
            const gEL = { x: endCenter.x + this.v.x * wallHalfT, y: endCenter.y + this.v.y * wallHalfT };
            const gER = { x: endCenter.x - this.v.x * wallHalfT, y: endCenter.y - this.v.y * wallHalfT };
            const tSL = toScreen(gSL, wallHeight);
            const tSR = toScreen(gSR, wallHeight);
            const tEL = toScreen(gEL, wallHeight);
            const tER = toScreen(gER, wallHeight);
            const mSL = toScreen(gSL, this.capBaseStart);
            const mSR = toScreen(gSR, this.capBaseStart);
            const mEL = toScreen(gEL, this.capBaseEnd);
            const mER = toScreen(gER, this.capBaseEnd);
            const longFaceA = [toScreen(gSL, 0), toScreen(gEL, 0), tEL, tSL];
            const longFaceB = [toScreen(gSR, 0), toScreen(gER, 0), tER, tSR];
            const capFaceStart = [mSR, mSL, tSL, tSR];
            const capFaceEnd = [mEL, mER, tER, tEL];
            const topFace = [tSL, tEL, tER, tSR];
            const faceDepth = pts => pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
            const longAFront = faceDepth(longFaceA) >= faceDepth(longFaceB);
            const startCapFront = faceDepth(capFaceStart) >= faceDepth(capFaceEnd);
            const showStartCap = this.capBaseStart < wallHeight - 1e-5;
            const showEndCap = this.capBaseEnd < wallHeight - 1e-5;
            const visiblePolygons = [];
            visiblePolygons.push(longAFront ? longFaceA : longFaceB);
            visiblePolygons.push(topFace);
            if (startCapFront && showStartCap) visiblePolygons.push(capFaceStart);
            if (!startCapFront && showEndCap) visiblePolygons.push(capFaceEnd);
            const containsMouse = visiblePolygons.some(poly => pointInSectionQuad(mouseScreen, poly[0], poly[1], poly[2], poly[3]));

            if (!containsMouse) return null;

            const facingSign = longAFront ? 1 : -1;
            const sectionStartWorld = (facingSign > 0) ? gSL : gSR;
            const sectionEndWorld = (facingSign > 0) ? gEL : gER;
            const sectionStartScreen = (facingSign > 0) ? longFaceA[0] : longFaceB[0];
            const sectionEndScreen = (facingSign > 0) ? longFaceA[1] : longFaceB[1];
            const sdx = sectionEndScreen.x - sectionStartScreen.x;
            const sdy = sectionEndScreen.y - sectionStartScreen.y;
            const sLen2 = sdx * sdx + sdy * sdy;
            if (!(sLen2 > 1e-6)) return null;
            const mouseRelX = mouseScreen.x - sectionStartScreen.x;
            const mouseRelY = mouseScreen.y - sectionStartScreen.y;
            const sectionProjTRaw = (mouseRelX * sdx + mouseRelY * sdy) / sLen2;
            const sectionProjT = Math.max(0, Math.min(1, sectionProjTRaw));
            const projScreen = {
                x: sectionStartScreen.x + sdx * sectionProjT,
                y: sectionStartScreen.y + sdy * sectionProjT
            };

            const halfWidth = objectWorldWidth * 0.5;
            const projectedAlong = this.minAlong + sectionProjT * sectionLength;
            let along = fitsLength
                ? Math.max(this.minAlong + halfWidth, Math.min(this.maxAlong - halfWidth, projectedAlong))
                : Math.max(this.minAlong, Math.min(this.maxAlong, projectedAlong));
            const sectionCenterAlong = (this.minAlong + this.maxAlong) * 0.5;
            const sectionCenterWorld = {
                x: this.origin.x + this.u.x * sectionCenterAlong + this.v.x * wallHalfT * facingSign,
                y: this.origin.y + this.u.y * sectionCenterAlong + this.v.y * wallHalfT * facingSign
            };
            const sectionCenterScreen = worldToScreenFn(sectionCenterWorld);
            const centerSnapPx = 10;
            const faceMinX = Math.min(sectionStartScreen.x, sectionEndScreen.x);
            const faceMaxX = Math.max(sectionStartScreen.x, sectionEndScreen.x);
            const faceSpanX = faceMaxX - faceMinX;
            const spanEps = 1e-4;
            let centerDistPx = Infinity;
            if (faceSpanX > spanEps) {
                const faceCenterX = (faceMinX + faceMaxX) * 0.5;
                centerDistPx = Math.abs(mouseScreen.x - faceCenterX);
            } else {
                let topMinY = Infinity;
                let topMaxY = -Infinity;
                for (let i = 0; i < topFace.length; i++) {
                    const p = topFace[i];
                    if (!p) continue;
                    if (p.y < topMinY) topMinY = p.y;
                    if (p.y > topMaxY) topMaxY = p.y;
                }
                if (Number.isFinite(topMinY) && Number.isFinite(topMaxY) && (topMaxY - topMinY) > spanEps) {
                    const topCenterY = (topMinY + topMaxY) * 0.5;
                    centerDistPx = Math.abs(mouseScreen.y - topCenterY);
                } else {
                    centerDistPx = Math.hypot(projScreen.x - sectionCenterScreen.x, projScreen.y - sectionCenterScreen.y);
                }
            }
            let centerSnapActive = false;
            if (Number.isFinite(centerDistPx) && centerDistPx <= centerSnapPx) {
                const centerAlong = sectionCenterAlong;
                along = fitsLength
                    ? Math.max(this.minAlong + halfWidth, Math.min(this.maxAlong - halfWidth, centerAlong))
                    : Math.max(this.minAlong, Math.min(this.maxAlong, centerAlong));
                centerSnapActive = true;
            }

            const rotDeg = Math.atan2(this.u.y, this.u.x) * (180 / Math.PI);
            const isDoorPlacement = category === "doors";
            const nx = this.v.x;
            const ny = this.v.y;
            const tx = this.u.x;
            const ty = this.u.y;
            const hitboxHalfT = isDoorPlacement ? (wallHalfT * 1.1) : wallHalfT;
            let centerXRaw = 0;
            let centerYRaw = 0;
            let wallFaceCenterRawX = 0;
            let wallFaceCenterRawY = 0;
            if (centerSnapActive) {
                centerXRaw = this.origin.x + this.u.x * along;
                centerYRaw = this.origin.y + this.u.y * along;
                wallFaceCenterRawX = centerXRaw + nx * wallHalfT * facingSign;
                wallFaceCenterRawY = centerYRaw + ny * wallHalfT * facingSign;
            } else {
                const shortestDX = (fromX, toX) =>
                    (mapRef && typeof mapRef.shortestDeltaX === "function")
                        ? mapRef.shortestDeltaX(fromX, toX)
                        : (toX - fromX);
                const shortestDY = (fromY, toY) =>
                    (mapRef && typeof mapRef.shortestDeltaY === "function")
                        ? mapRef.shortestDeltaY(fromY, toY)
                        : (toY - fromY);
                const faceStartX = mouseWorldX + shortestDX(mouseWorldX, Number(sectionStartWorld.x));
                const faceStartY = mouseWorldY + shortestDY(mouseWorldY, Number(sectionStartWorld.y));
                const faceEndX = mouseWorldX + shortestDX(mouseWorldX, Number(sectionEndWorld.x));
                const faceEndY = mouseWorldY + shortestDY(mouseWorldY, Number(sectionEndWorld.y));
                const faceDx = faceEndX - faceStartX;
                const faceDy = faceEndY - faceStartY;
                let faceT = 0;
                if (Math.abs(faceDx) > 1e-6) {
                    const rawT = (mouseWorldX - faceStartX) / faceDx;
                    if (rawT < -1e-6 || rawT > 1 + 1e-6) return null;
                    faceT = Math.max(0, Math.min(1, rawT));
                } else {
                    if (Math.abs(mouseWorldX - faceStartX) > 1e-4) return null;
                    faceT = sectionProjT;
                }
                wallFaceCenterRawX = mouseWorldX;
                wallFaceCenterRawY = faceStartY + faceDy * faceT;
                centerXRaw = wallFaceCenterRawX - nx * wallHalfT * facingSign;
                centerYRaw = wallFaceCenterRawY - ny * wallHalfT * facingSign;
                const alongMin = fitsLength ? (this.minAlong + halfWidth) : this.minAlong;
                const alongMax = fitsLength ? (this.maxAlong - halfWidth) : this.maxAlong;
                const alongRaw =
                    (centerXRaw - this.origin.x) * this.u.x +
                    (centerYRaw - this.origin.y) * this.u.y;
                if (alongRaw < alongMin - 1e-6 || alongRaw > alongMax + 1e-6) return null;
                along = Math.max(alongMin, Math.min(alongMax, alongRaw));
            }
            let centerX = centerXRaw;
            let centerY = centerYRaw;
            if (mapRef && typeof mapRef.wrapWorldX === "function") centerX = mapRef.wrapWorldX(centerX);
            if (mapRef && typeof mapRef.wrapWorldY === "function") centerY = mapRef.wrapWorldY(centerY);
            let wallFaceCenterX = wallFaceCenterRawX;
            let wallFaceCenterY = wallFaceCenterRawY;
            if (mapRef && typeof mapRef.wrapWorldX === "function") wallFaceCenterX = mapRef.wrapWorldX(wallFaceCenterX);
            if (mapRef && typeof mapRef.wrapWorldY === "function") wallFaceCenterY = mapRef.wrapWorldY(wallFaceCenterY);

            const alongOffset = 0;
            const verticalOffset = (1 - anchorY) * objectWorldHeight;
            const normalBias = (category === "windows") ? 0.001 : 0;
            const desiredBaseX = wallFaceCenterX + nx * normalBias * facingSign;
            const desiredBaseY = wallFaceCenterY + ny * normalBias * facingSign;
            let snappedX = desiredBaseX + tx * alongOffset;
            let snappedY = isDoorPlacement
                ? (desiredBaseY + ty * alongOffset - verticalOffset)
                : (desiredBaseY + ty * alongOffset);
            const snappedZ = (category === "windows") ? (wallHeight * 0.5) : 0;
            if (mapRef && typeof mapRef.wrapWorldX === "function") snappedX = mapRef.wrapWorldX(snappedX);
            if (mapRef && typeof mapRef.wrapWorldY === "function") snappedY = mapRef.wrapWorldY(snappedY);

            const p1 = { x: centerXRaw - tx * halfWidth + nx * hitboxHalfT, y: centerYRaw - ty * halfWidth + ny * hitboxHalfT };
            const p2 = { x: centerXRaw + tx * halfWidth + nx * hitboxHalfT, y: centerYRaw + ty * halfWidth + ny * hitboxHalfT };
            const p3 = { x: centerXRaw + tx * halfWidth - nx * hitboxHalfT, y: centerYRaw + ty * halfWidth - ny * hitboxHalfT };
            const p4 = { x: centerXRaw - tx * halfWidth - nx * hitboxHalfT, y: centerYRaw - ty * halfWidth - ny * hitboxHalfT };
            const wrapPoint = (pt) => ({
                x: (mapRef && typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(pt.x) : pt.x,
                y: (mapRef && typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(pt.y) : pt.y
            });

            const id = Number.isInteger(this.id) ? Number(this.id) : (Number.isInteger(options.sectionId) ? Number(options.sectionId) : null);
            return {
                valid: fitsLength && fitsHeight,
                reason: !fitsLength
                    ? ((category === "doors")
                        ? "Door is wider than this wall section."
                        : "Window is wider than this wall section.")
                    : (!fitsHeight
                        ? ((category === "doors")
                            ? "Door is taller than this wall."
                            : "Window is taller than this wall.")
                        : null),
                targetWall: Array.isArray(this.walls) && this.walls.length > 0 ? this.walls[0] : null,
                mountedWallLineGroupId: id,
                mountedSectionId: id,
                mountedWallFacingSign: facingSign,
                snappedX,
                snappedY,
                snappedZ,
                snappedRotationDeg: rotDeg,
                wallGroundHitboxPoints: [wrapPoint(p1), wrapPoint(p2), wrapPoint(p3), wrapPoint(p4)],
                wallHeight,
                wallThickness: wallHalfT * 2,
                centerSnapActive,
                sectionCenterX: (mapRef && typeof mapRef.wrapWorldX === "function")
                    ? mapRef.wrapWorldX(sectionCenterWorld.x)
                    : sectionCenterWorld.x,
                sectionCenterY: (mapRef && typeof mapRef.wrapWorldY === "function")
                    ? mapRef.wrapWorldY(sectionCenterWorld.y)
                    : sectionCenterWorld.y,
                sectionFacingSign: facingSign,
                sectionNormalX: nx,
                sectionNormalY: ny,
                sectionDirX: tx,
                sectionDirY: ty,
                wallFaceCenterX,
                wallFaceCenterY,
                placementHalfWidth: halfWidth,
                placementCenterX: desiredBaseX,
                placementCenterY: desiredBaseY,
                sectionFaceQuadScreenPoints: [
                    { x: sectionStartScreen.x, y: sectionStartScreen.y },
                    { x: sectionEndScreen.x, y: sectionEndScreen.y },
                    {
                        x: sectionEndScreen.x,
                        y: sectionEndScreen.y - wallHeight * viewscale * xyratio
                    },
                    {
                        x: sectionStartScreen.x,
                        y: sectionStartScreen.y - wallHeight * viewscale * xyratio
                    }
                ],
                sectionVisiblePolygonsScreen: visiblePolygons.map(poly => poly.map(p => ({ x: p.x, y: p.y })))
            };
        }

        computeMembershipSignature(getObjectId) {
            if (typeof getObjectId !== "function") return "";
            const wallIds = this.walls.map(item => String(getObjectId(item))).filter(Boolean);
            const mountedIds = this.mounted.map(item => String(getObjectId(item))).filter(Boolean);
            return `${wallIds.join(",")}::${mountedIds.join(",")}`;
        }

        getSectionUvInfoForMesh() {
            const pixiRef = (typeof globalScope.PIXI !== "undefined") ? globalScope.PIXI : null;
            if (!pixiRef) return null;
            if (!wallTextureConfigCache) {
                this.textureConfigPending = true;
                void ensureWallTextureConfigLoaded();
                return null;
            }
            let uvInfo = null;
            if (Array.isArray(this.walls)) {
                for (let i = 0; i < this.walls.length; i++) {
                    const wall = this.walls[i];
                    if (!wall || typeof wall.getWallProfile !== "function") continue;
                    const profile = wall.getWallProfile();
                    if (!profile || !profile.aLeft || !profile.aRight || !profile.bLeft || !profile.bRight) continue;
                    const resolved = resolveWallUvInfoForMesh(wall, profile);
                    if (resolved) {
                        uvInfo = resolved;
                        break;
                    }
                }
            }
            const baseInfo = uvInfo || {
                repeatsPerMapUnitX: defaultWallTextureRepeatsPerMapUnitX,
                repeatsPerMapUnitY: defaultWallTextureRepeatsPerMapUnitY,
                texture: pixiRef.Texture.from(defaultWallTexturePath)
            };
            const repeatsPerMapUnitX = Math.max(0.0001, Number(baseInfo.repeatsPerMapUnitX) || defaultWallTextureRepeatsPerMapUnitX);
            const repeatsPerMapUnitY = Math.max(0.0001, Number(baseInfo.repeatsPerMapUnitY) || defaultWallTextureRepeatsPerMapUnitY);
            const phaseScale = 3 * repeatsPerMapUnitX;
            const startCenter = {
                x: this.origin.x + this.u.x * this.minAlong,
                y: this.origin.y + this.u.y * this.minAlong
            };
            const endCenter = {
                x: this.origin.x + this.u.x * this.maxAlong,
                y: this.origin.y + this.u.y * this.maxAlong
            };
            const alongAt = pt => (pt.x * this.u.x + pt.y * this.u.y);
            const resolveEndpointPhaseU = (endpointRef, fallbackPoint) => {
                const fallback = alongAt(fallbackPoint) * repeatsPerMapUnitX;
                if (!endpointRef || !endpointRef.wall) return fallback;
                const wall = endpointRef.wall;
                const endpoint = endpointRef.endpoint || null;
                let phase = null;
                if (endpoint && typeof wall.getTexturePhaseAtEndpoint === "function") {
                    const fromMethod = wall.getTexturePhaseAtEndpoint(endpoint);
                    if (Number.isFinite(fromMethod)) phase = Number(fromMethod);
                }
                if (!Number.isFinite(phase)) {
                    if (endpointRef.endpointKey === "a" && Number.isFinite(wall.texturePhaseA)) phase = Number(wall.texturePhaseA);
                    if (endpointRef.endpointKey === "b" && Number.isFinite(wall.texturePhaseB)) phase = Number(wall.texturePhaseB);
                }
                return Number.isFinite(phase) ? (phase * phaseScale) : fallback;
            };
            const uStart = resolveEndpointPhaseU(this.startEndpointRef, startCenter);
            const sectionLengthWorld = (Number.isFinite(this.sectionSpanLength) && this.sectionSpanLength > 1e-6)
                ? Number(this.sectionSpanLength)
                : Math.max(0, Number(this.maxAlong) - Number(this.minAlong));
            const uEnd = uStart + sectionLengthWorld * repeatsPerMapUnitX;
            return {
                uStart,
                uEnd,
                repeatsPerMapUnitX,
                repeatsPerMapUnitY,
                texture: baseInfo.texture || pixiRef.Texture.from(defaultWallTexturePath)
            };
        }

        resolveEndpointSplice(endpointState, defaultPlus, defaultMinus) {
            if (!endpointState || !endpointState.wall || typeof endpointState.wall.computeJoinedEndpointCorners !== "function") {
                return { plus: defaultPlus, minus: defaultMinus };
            }
            const joined = endpointState.wall.computeJoinedEndpointCorners(endpointState.endpointKey);
            if (!joined || !joined.left || !joined.right) {
                return { plus: defaultPlus, minus: defaultMinus };
            }
            const endpoint = endpointState.endpoint
                ? { x: Number(endpointState.endpoint.x), y: Number(endpointState.endpoint.y) }
                : null;
            if (!endpoint || !Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) {
                return { plus: defaultPlus, minus: defaultMinus };
            }
            const leftDot = (Number(joined.left.x) - endpoint.x) * this.v.x + (Number(joined.left.y) - endpoint.y) * this.v.y;
            const rightDot = (Number(joined.right.x) - endpoint.x) * this.v.x + (Number(joined.right.y) - endpoint.y) * this.v.y;
            if (!Number.isFinite(leftDot) || !Number.isFinite(rightDot)) {
                return { plus: defaultPlus, minus: defaultMinus };
            }
            const leftIsPlus = leftDot >= rightDot;
            const plus = leftIsPlus ? joined.left : joined.right;
            const minus = leftIsPlus ? joined.right : joined.left;
            if (!plus || !minus) return { plus: defaultPlus, minus: defaultMinus };
            if (!Number.isFinite(plus.x) || !Number.isFinite(plus.y) || !Number.isFinite(minus.x) || !Number.isFinite(minus.y)) {
                return { plus: defaultPlus, minus: defaultMinus };
            }
            if (Math.hypot(plus.x - minus.x, plus.y - minus.y) < 1e-5) {
                return { plus: defaultPlus, minus: defaultMinus };
            }
            return {
                plus: { x: Number(plus.x), y: Number(plus.y) },
                minus: { x: Number(minus.x), y: Number(minus.y) }
            };
        }

        buildWorldMeshGeometry() {
            const pixiRef = (typeof globalScope.PIXI !== "undefined") ? globalScope.PIXI : null;
            if (!pixiRef) return null;
            if (!Array.isArray(this.walls) || this.walls.length === 0) return null;
            if (!(this.maxAlong > this.minAlong) || !(this.height > 0)) return null;
            const uvInfo = this.getSectionUvInfoForMesh();
            if (!uvInfo) return null;
            this.textureConfigPending = false;
            const builder = { positions: [], uvs: [], colors: [], textureMix: [], indices: [], vertexCount: 0 };
            const wallHeight = Math.max(0.001, Number(this.height) || 0.001);
            const wallThickness = Math.max(0.001, Number(this.halfThickness) || 0.001) * 2;
            const startCenter = {
                x: this.origin.x + this.u.x * this.minAlong,
                y: this.origin.y + this.u.y * this.minAlong
            };
            const endCenter = {
                x: this.origin.x + this.u.x * this.maxAlong,
                y: this.origin.y + this.u.y * this.maxAlong
            };
            const defaultStartPlus = { x: startCenter.x + this.v.x * this.halfThickness, y: startCenter.y + this.v.y * this.halfThickness };
            const defaultStartMinus = { x: startCenter.x - this.v.x * this.halfThickness, y: startCenter.y - this.v.y * this.halfThickness };
            const defaultEndPlus = { x: endCenter.x + this.v.x * this.halfThickness, y: endCenter.y + this.v.y * this.halfThickness };
            const defaultEndMinus = { x: endCenter.x - this.v.x * this.halfThickness, y: endCenter.y - this.v.y * this.halfThickness };
            const startSplice = this.resolveEndpointSplice(this.startEndpointState, defaultStartPlus, defaultStartMinus);
            const endSplice = this.resolveEndpointSplice(this.endEndpointState, defaultEndPlus, defaultEndMinus);
            const gSP = { x: startSplice.plus.x, y: startSplice.plus.y, z: 0 };
            const gSM = { x: startSplice.minus.x, y: startSplice.minus.y, z: 0 };
            const gEP = { x: endSplice.plus.x, y: endSplice.plus.y, z: 0 };
            const gEM = { x: endSplice.minus.x, y: endSplice.minus.y, z: 0 };
            const tSP = { x: gSP.x, y: gSP.y, z: wallHeight };
            const tSM = { x: gSM.x, y: gSM.y, z: wallHeight };
            const tEP = { x: gEP.x, y: gEP.y, z: wallHeight };
            const tEM = { x: gEM.x, y: gEM.y, z: wallHeight };
            const capStart = Math.max(0, Math.min(wallHeight, Number(this.capBaseStart) || 0));
            const capEnd = Math.max(0, Math.min(wallHeight, Number(this.capBaseEnd) || 0));
            const mSP = { x: gSP.x, y: gSP.y, z: capStart };
            const mSM = { x: gSM.x, y: gSM.y, z: capStart };
            const mEP = { x: gEP.x, y: gEP.y, z: capEnd };
            const mEM = { x: gEM.x, y: gEM.y, z: capEnd };
            const uStart = Number.isFinite(uvInfo.uStart) ? Number(uvInfo.uStart) : (this.minAlong * uvInfo.repeatsPerMapUnitX);
            const uEnd = Number.isFinite(uvInfo.uEnd) ? Number(uvInfo.uEnd) : (this.maxAlong * uvInfo.repeatsPerMapUnitX);
            const wallHeightV = wallHeight * uvInfo.repeatsPerMapUnitY;
            const topThicknessV = Math.max(0.0001, wallThickness * uvInfo.repeatsPerMapUnitX);
            const capWidthV = Math.max(0.0001, wallThickness * uvInfo.repeatsPerMapUnitX);
            appendDepthQuad(builder, gSP, gEP, tEP, tSP, { u0: uStart, v0: 0, u1: uEnd, v1: wallHeightV });
            appendDepthQuad(builder, gSM, gEM, tEM, tSM, { u0: uStart, v0: 0, u1: uEnd, v1: wallHeightV });
            appendDepthQuad(
                builder,
                tSP, tEP, tEM, tSM,
                { u0: uStart, v0: 0, u1: uEnd, v1: topThicknessV },
                { color: [0.62, 0.62, 0.62, 1], textureMix: 0 }
            );
            if (capStart < wallHeight - 1e-5) {
                appendDepthQuad(builder, mSM, mSP, tSP, tSM, {
                    u0: 0,
                    v0: capStart * uvInfo.repeatsPerMapUnitY,
                    u1: capWidthV,
                    v1: wallHeightV
                });
            }
            if (capEnd < wallHeight - 1e-5) {
                appendDepthQuad(builder, mEP, mEM, tEM, tEP, {
                    u0: 0,
                    v0: capEnd * uvInfo.repeatsPerMapUnitY,
                    u1: capWidthV,
                    v1: wallHeightV
                });
            }
            if (builder.vertexCount === 0) return null;
            const key = [
                Number(gSP.x).toFixed(4), Number(gSP.y).toFixed(4),
                Number(gSM.x).toFixed(4), Number(gSM.y).toFixed(4),
                Number(gEP.x).toFixed(4), Number(gEP.y).toFixed(4),
                Number(gEM.x).toFixed(4), Number(gEM.y).toFixed(4),
                Number(wallHeight).toFixed(4),
                Number(capStart).toFixed(4),
                Number(capEnd).toFixed(4),
                Number(uStart).toFixed(4),
                Number(uEnd).toFixed(4)
            ].join("|");
            return {
                positions: new Float32Array(builder.positions),
                uvs: new Float32Array(builder.uvs),
                colors: new Float32Array(builder.colors),
                textureMix: new Float32Array(builder.textureMix),
                indices: new Uint16Array(builder.indices),
                texture: uvInfo.texture || pixiRef.Texture.from(defaultWallTexturePath),
                alphaCutoff: 0.02,
                key
            };
        }

        buildMeshSprite(pixiRef, options = {}) {
            if (!pixiRef || !(this.maxAlong > this.minAlong) || !(this.height > 0)) return null;
            const viewscale = Number(options.viewscale);
            const xyratio = Number(options.xyratio);
            const screenOffsetX = Number(options.screenOffsetX) || 0;
            const screenOffsetY = Number(options.screenOffsetY) || 0;
            if (!Number.isFinite(viewscale) || !Number.isFinite(xyratio)) return null;
            if (typeof worldToScreen !== "function") return null;

            const wallClass = (typeof globalScope.Wall !== "undefined") ? globalScope.Wall : null;
            const stoneTexture = (wallClass && typeof wallClass.getStoneWallTexture === "function")
                ? wallClass.getStoneWallTexture()
                : null;
            const color = Number.isFinite(options.color) ? Number(options.color) : 0x555555;
            const alpha = Number.isFinite(options.alpha) ? Number(options.alpha) : 1;

            const startCenter = {
                x: this.origin.x + this.u.x * this.minAlong,
                y: this.origin.y + this.u.y * this.minAlong
            };
            const endCenter = {
                x: this.origin.x + this.u.x * this.maxAlong,
                y: this.origin.y + this.u.y * this.maxAlong
            };
            const gSL = { x: startCenter.x + this.v.x * this.halfThickness, y: startCenter.y + this.v.y * this.halfThickness };
            const gSR = { x: startCenter.x - this.v.x * this.halfThickness, y: startCenter.y - this.v.y * this.halfThickness };
            const gEL = { x: endCenter.x + this.v.x * this.halfThickness, y: endCenter.y + this.v.y * this.halfThickness };
            const gER = { x: endCenter.x - this.v.x * this.halfThickness, y: endCenter.y - this.v.y * this.halfThickness };

            const toScreen = (pt, z = 0) => {
                const s = worldToScreen(pt);
                return {
                    x: s.x + screenOffsetX,
                    y: (s.y - z * viewscale * xyratio) + screenOffsetY
                };
            };
            const tSL = toScreen(gSL, this.height);
            const tSR = toScreen(gSR, this.height);
            const tEL = toScreen(gEL, this.height);
            const tER = toScreen(gER, this.height);
            const mSL = toScreen(gSL, this.capBaseStart);
            const mSR = toScreen(gSR, this.capBaseStart);
            const mEL = toScreen(gEL, this.capBaseEnd);
            const mER = toScreen(gER, this.capBaseEnd);

            const longFaceA = [toScreen(gSL, 0), toScreen(gEL, 0), tEL, tSL];
            const longFaceB = [toScreen(gSR, 0), toScreen(gER, 0), tER, tSR];
            const capFaceStart = [mSR, mSL, tSL, tSR];
            const capFaceEnd = [mEL, mER, tER, tEL];
            const topFace = [tSL, tEL, tER, tSR];

            const faceDepth = pts => pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
            const shadeColor = (hex, factor) => {
                const f = Math.max(0, factor);
                const r = Math.min(255, Math.max(0, Math.round(((hex >> 16) & 0xff) * f)));
                const g = Math.min(255, Math.max(0, Math.round(((hex >> 8) & 0xff) * f)));
                const b = Math.min(255, Math.max(0, Math.round((hex & 0xff) * f)));
                return (r << 16) | (g << 8) | b;
            };
            const longAFront = faceDepth(longFaceA) >= faceDepth(longFaceB);
            const startCapFront = faceDepth(capFaceStart) >= faceDepth(capFaceEnd);
            const showStartCap = this.capBaseStart < this.height - 1e-5;
            const showEndCap = this.capBaseEnd < this.height - 1e-5;

            const graphics = new pixiRef.Graphics();
            const faces = [
                longAFront
                    ? { pts: longFaceA, color: shadeColor(color, 1.18), textured: true, phaseA: this.minAlong / 3, phaseB: this.maxAlong / 3 }
                    : { pts: longFaceB, color: shadeColor(color, 1.18), textured: true, phaseA: this.minAlong / 3, phaseB: this.maxAlong / 3 }
            ];
            if (startCapFront && showStartCap) {
                faces.push({ pts: capFaceStart, color: shadeColor(color, 1.08), textured: true, phaseA: 0, phaseB: Math.max(1e-6, this.halfThickness * 2 / 3) });
            }
            if (!startCapFront && showEndCap) {
                faces.push({ pts: capFaceEnd, color: shadeColor(color, 1.08), textured: true, phaseA: 0, phaseB: Math.max(1e-6, this.halfThickness * 2 / 3) });
            }
            faces.sort((a, b) => faceDepth(a.pts) - faceDepth(b.pts));

            const zUnitPx = Math.max(1, viewscale * xyratio);
            graphics.lineStyle(0);
            for (let i = 0; i < faces.length; i++) {
                const face = faces[i];
                const pts = face.pts;
                const canTexture = !!stoneTexture && face.textured;
                if (canTexture) {
                    const bottomA = pts[0];
                    const bottomB = pts[1];
                    const topA = pts[3];
                    const u = { x: bottomB.x - bottomA.x, y: bottomB.y - bottomA.y };
                    const v = { x: topA.x - bottomA.x, y: topA.y - bottomA.y };
                    const uLen = Math.max(1e-6, Math.hypot(u.x, u.y));
                    const vLen = Math.max(1e-6, Math.hypot(v.x, v.y));
                    const uDir = { x: u.x / uLen, y: u.y / uLen };
                    const vDir = { x: v.x / vLen, y: v.y / vLen };
                    const texW = Math.max(1, stoneTexture.width || (stoneTexture.baseTexture && stoneTexture.baseTexture.width) || 256);
                    const texH = Math.max(1, stoneTexture.height || (stoneTexture.baseTexture && stoneTexture.baseTexture.height) || 256);
                    const repeatsAcrossFace = Math.max(1e-6, Math.abs(face.phaseB - face.phaseA));
                    const uRepeatPx = Math.max(1, uLen / repeatsAcrossFace);
                    const vRepeatPx = zUnitPx * 3;
                    const phaseShiftPx = face.phaseA * uRepeatPx;
                    const matrix = new pixiRef.Matrix(
                        uDir.x * (uRepeatPx / texW),
                        uDir.y * (uRepeatPx / texW),
                        vDir.x * (vRepeatPx / texH),
                        vDir.y * (vRepeatPx / texH),
                        bottomA.x - uDir.x * phaseShiftPx,
                        bottomA.y - uDir.y * phaseShiftPx
                    );
                    graphics.beginTextureFill({ texture: stoneTexture, color: face.color, alpha, matrix });
                } else {
                    graphics.beginFill(face.color, alpha);
                }
                graphics.moveTo(pts[0].x, pts[0].y);
                for (let p = 1; p < pts.length; p++) graphics.lineTo(pts[p].x, pts[p].y);
                graphics.closePath();
                graphics.endFill();
            }

            const topCenter = topFace.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
            topCenter.x /= topFace.length;
            topCenter.y /= topFace.length;
            const orderedTop = topFace.slice().sort(
                (p1, p2) => Math.atan2(p1.y - topCenter.y, p1.x - topCenter.x) - Math.atan2(p2.y - topCenter.y, p2.x - topCenter.x)
            );
            graphics.beginFill(shadeColor(color, 1.2), alpha);
            graphics.moveTo(orderedTop[0].x, orderedTop[0].y);
            for (let i = 1; i < orderedTop.length; i++) graphics.lineTo(orderedTop[i].x, orderedTop[i].y);
            graphics.closePath();
            graphics.endFill();
            return graphics;
        }

        buildSectionImage(appRef, pixiRef, options = {}) {
            if (!appRef || !appRef.renderer || !pixiRef) return null;
            const viewscale = Number(options.viewscale);
            const xyratio = Number(options.xyratio);
            const color = Number.isFinite(options.color) ? Number(options.color) : 0x555555;
            const alpha = Number.isFinite(options.alpha) ? Number(options.alpha) : 1;
            const pad = Number.isFinite(options.pad) ? Math.max(0, Number(options.pad)) : 2;
            if (!Number.isFinite(viewscale) || !Number.isFinite(xyratio)) return null;

            const wallMeshAtOrigin = this.buildMeshSprite(pixiRef, {
                viewscale,
                xyratio,
                screenOffsetX: 0,
                screenOffsetY: 0,
                color,
                alpha
            });
            if (!wallMeshAtOrigin) return null;

            let wallBounds = null;
            try {
                wallBounds = wallMeshAtOrigin.getBounds(false);
            } catch (_) {
                wallBounds = null;
            }
            if (!wallBounds || !Number.isFinite(wallBounds.x) || !Number.isFinite(wallBounds.y) || !Number.isFinite(wallBounds.width) || !Number.isFinite(wallBounds.height)) {
                wallMeshAtOrigin.destroy();
                return null;
            }

            let minX = wallBounds.x;
            let minY = wallBounds.y;
            let maxX = wallBounds.x + wallBounds.width;
            let maxY = wallBounds.y + wallBounds.height;
            const mountedEntries = [];
            for (let i = 0; i < this.mounted.length; i++) {
                const item = this.mounted[i];
                const displayObj = item && item.pixiSprite ? item.pixiSprite : null;
                if (!displayObj) continue;
                let bounds = null;
                try {
                    bounds = displayObj.getBounds(false);
                } catch (_) {
                    bounds = null;
                }
                if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) continue;
                if (!(bounds.width > 0 && bounds.height > 0)) continue;
                mountedEntries.push({ item, displayObj, bounds });
                minX = Math.min(minX, bounds.x);
                minY = Math.min(minY, bounds.y);
                maxX = Math.max(maxX, bounds.x + bounds.width);
                maxY = Math.max(maxY, bounds.y + bounds.height);
            }

            const baseX = Math.floor(minX) - pad;
            const baseY = Math.floor(minY) - pad;
            const width = Math.max(2, Math.ceil(maxX - minX) + (pad * 2) + 2);
            const height = Math.max(2, Math.ceil(maxY - minY) + (pad * 2) + 2);

            wallMeshAtOrigin.destroy();
            const wallMesh = this.buildMeshSprite(pixiRef, {
                viewscale,
                xyratio,
                screenOffsetX: -baseX,
                screenOffsetY: -baseY,
                color,
                alpha
            });
            if (!wallMesh) return null;

            const tempContainer = new pixiRef.Container();
            tempContainer.addChild(wallMesh);
            const tempTextures = [];
            let generationFailed = false;
            for (let i = 0; i < mountedEntries.length; i++) {
                const entry = mountedEntries[i];
                const displayObj = entry.displayObj;
                let generatedTexture = null;
                const originalAlpha = Number.isFinite(displayObj.alpha) ? displayObj.alpha : 1;
                const originalTint = Number.isFinite(displayObj.tint) ? displayObj.tint : 0xFFFFFF;
                try {
                    displayObj.alpha = 1;
                    if (Number.isFinite(displayObj.tint)) displayObj.tint = 0xFFFFFF;
                    generatedTexture = appRef.renderer.generateTexture(displayObj);
                } catch (_) {
                    generatedTexture = null;
                } finally {
                    displayObj.alpha = originalAlpha;
                    if (Number.isFinite(displayObj.tint)) displayObj.tint = originalTint;
                }
                if (!generatedTexture) {
                    generationFailed = true;
                    break;
                }
                tempTextures.push(generatedTexture);
                const sprite = new pixiRef.Sprite(generatedTexture);
                sprite.anchor.set(0, 0);
                sprite.x = entry.bounds.x - baseX;
                sprite.y = entry.bounds.y - baseY;
                tempContainer.addChild(sprite);
            }
            if (generationFailed) {
                tempContainer.destroy({ children: true });
                for (let i = 0; i < tempTextures.length; i++) {
                    if (tempTextures[i] && typeof tempTextures[i].destroy === "function") {
                        tempTextures[i].destroy(true);
                    }
                }
                return null;
            }

            const renderTexture = pixiRef.RenderTexture.create({ width, height });
            try {
                appRef.renderer.render({ container: tempContainer, target: renderTexture, clear: true });
            } catch (_) {
                appRef.renderer.render(tempContainer, renderTexture, true);
            }
            tempContainer.destroy({ children: true });
            for (let i = 0; i < tempTextures.length; i++) {
                if (tempTextures[i] && typeof tempTextures[i].destroy === "function") {
                    tempTextures[i].destroy(true);
                }
            }

            return { renderTexture, baseX, baseY, width, height };
        }
    }

    function getWallMountedPlacementCandidate(options = {}) {
        const mapRef = options.map || null;
        const category = (typeof options.category === "string") ? options.category.trim().toLowerCase() : "";
        if (category !== "windows" && category !== "doors") return null;
        if (!mapRef) return null;
        const worldToScreenFn = (typeof options.worldToScreen === "function")
            ? options.worldToScreen
            : ((typeof worldToScreen === "function") ? worldToScreen : null);
        if (!worldToScreenFn) return null;
        const worldX = Number(options.worldX);
        const worldY = Number(options.worldY);
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const mouseScreen = options.mouseScreen && Number.isFinite(options.mouseScreen.x) && Number.isFinite(options.mouseScreen.y)
            ? options.mouseScreen
            : worldToScreenFn({ x: worldX, y: worldY });

        const onscreenSource = (typeof globalScope !== "undefined" && globalScope)
            ? (
                globalScope.onscreenObjects ||
                (typeof globalScope.getOnscreenObjects === "function" ? globalScope.getOnscreenObjects() : null)
            )
            : null;
        if (!onscreenSource || typeof onscreenSource.forEach !== "function") return null;
        const onscreenSectionIds = new Set();
        onscreenSource.forEach(obj => {
            if (!obj) return;
            if (obj.gone || obj.vanishing) return;
            if (obj.type !== "wall" || !obj.a || !obj.b) return;
            if (Number.isInteger(obj.sectionId)) {
                onscreenSectionIds.add(Number(obj.sectionId));
                return;
            }
            if (Number.isInteger(obj.lineGroupId)) {
                onscreenSectionIds.add(Number(obj.lineGroupId));
            }
        });
        if (onscreenSectionIds.size === 0) return null;

        let best = null;
        const sectionIds = Array.from(onscreenSectionIds);
        for (let i = 0; i < sectionIds.length; i++) {
            const sectionId = sectionIds[i];
            const section = getOrBuildPlacementSection(sectionId, mapRef);
            if (!section) continue;
            const candidate = section.generateMountedPlacementCandidate({
                category,
                objectWorldWidth: options.objectWorldWidth,
                objectWorldHeight: options.objectWorldHeight,
                anchorY: options.anchorY,
                worldX,
                worldY,
                viewscale: options.viewscale,
                xyratio: options.xyratio,
                mouseScreen,
                map: mapRef,
                worldToScreen: worldToScreenFn,
                sectionId: sectionId
            });
            if (!candidate) continue;
            if (!best) best = candidate;
        }
        placementDirtyAll = false;
        return best;
    }

    function restoreRenderable(items, isWallMountedPlaceable) {
        if (!Array.isArray(items)) return;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item || !item.pixiSprite) continue;
            if (item.type === "wall" || (isWallMountedPlaceable(item) && item.type !== "placedObjectPreview")) {
                item.pixiSprite.renderable = true;
            }
        }
    }

    function buildCompositeRenderItems(options = {}) {
        const enabled = !!options.enabled;
        const items = Array.isArray(options.items) ? options.items : [];
        const cachePrefix = (typeof options.cachePrefix === "string" && options.cachePrefix.length > 0) ? options.cachePrefix : "default";
        const outputMode = (options.outputMode === "mesh3d") ? "mesh3d" : "sprite";
        const camera = options.camera || null;
        const mapRef = options.map || null;
        const appRef = options.app || null;
        const pixiRef = options.PIXI || (typeof globalScope.PIXI !== "undefined" ? globalScope.PIXI : null);
        const viewscale = Number(options.viewscale);
        const xyratio = Number(options.xyratio);
        const isWallMountedPlaceable = (typeof options.isWallMountedPlaceable === "function")
            ? options.isWallMountedPlaceable
            : (() => false);

        if (!enabled || !pixiRef || (outputMode !== "mesh3d" && (!appRef || !appRef.renderer))) {
            return { renderItems: [], hiddenItems: new Set(), stats: { groups: 0, rebuilt: 0 } };
        }

        // Reset section-member renderability each frame. Compositing will hide
        // only the members represented by active composite items this frame.
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item || !item.pixiSprite || item.gone || item.vanishing) continue;
            if (item.type === "wall" || (isWallMountedPlaceable(item) && item.type !== "placedObjectPreview")) {
                item.pixiSprite.renderable = true;
                item._wallSectionCompositeSprite = null;
                item._wallSectionCompositeDisplayObject = null;
            }
        }

        const groups = buildCompositeSubgroups(items, mapRef, isWallMountedPlaceable);
        const seenSectionIds = new Set();
        const dirtyGroupIdsToClear = new Set();
        const seenKeys = new Set();
        const hiddenItems = new Set();
        const renderItems = [];
        let groupsCount = 0;
        let rebuiltCount = 0;
        const wallSortAxisEpsilon = 1e-4;
        const getWallSortPoint = wall => {
            if (!wall || !wall.a || !wall.b) return { x: Infinity, y: Infinity };
            const ax = Number(wall.a.x);
            const ay = Number(wall.a.y);
            const bx = Number(wall.b.x);
            const by = Number(wall.b.y);
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
                return { x: Infinity, y: Infinity };
            }
            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(ax, bx)
                : (bx - ax);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(ay, by)
                : (by - ay);
            let midX = ax + dx * 0.5;
            let midY = ay + dy * 0.5;
            if (mapRef && typeof mapRef.wrapWorldX === "function") midX = mapRef.wrapWorldX(midX);
            if (mapRef && typeof mapRef.wrapWorldY === "function") midY = mapRef.wrapWorldY(midY);
            return { x: midX, y: midY };
        };
        const compareWallsByPosition = (a, b) => {
            const pa = getWallSortPoint(a);
            const pb = getWallSortPoint(b);
            const dy = pa.y - pb.y;
            if (Math.abs(dy) > wallSortAxisEpsilon) return dy;
            const dx = pa.x - pb.x;
            if (Math.abs(dx) > wallSortAxisEpsilon) return dx;
            return getSectionObjectId(a) - getSectionObjectId(b);
        };

        groups.forEach(groupEntry => {
            const members = Array.isArray(groupEntry && groupEntry.members) ? groupEntry.members : [];
            const groupId = Number.isInteger(groupEntry && groupEntry.baseGroupId) ? groupEntry.baseGroupId : null;
            const subgroupKey = (groupEntry && typeof groupEntry.key === "string" && groupEntry.key.length > 0)
                ? groupEntry.key
                : null;
            if (!Array.isArray(members) || members.length === 0 || !subgroupKey) return;

            const wallMembers = members.filter(item => item && item.type === "wall");
            const mountedMembers = members.filter(item => item && item.type !== "wall");
            if (wallMembers.length === 0) return;
            wallMembers.sort(compareWallsByPosition);
            mountedMembers.sort((a, b) => getSectionObjectId(a) - getSectionObjectId(b));
            groupsCount += 1;

            const compositeKey = `${cachePrefix}:${subgroupKey}`;
            seenKeys.add(compositeKey);
            seenSectionIds.add(subgroupKey);
            let bundle = sectionCompositeCache.get(compositeKey);
            if (!bundle) {
                bundle = {
                    key: compositeKey,
                    sprite: new pixiRef.Sprite(pixiRef.Texture.WHITE),
                    mesh: null,
                    renderTexture: null,
                    renderItem: null,
                    membershipSignature: "",
                    buildCameraX: Number.isFinite(camera && camera.x) ? Number(camera.x) : 0,
                    buildCameraY: Number.isFinite(camera && camera.y) ? Number(camera.y) : 0,
                    baseScreenX: 0,
                    baseScreenY: 0,
                    textureWidth: 0,
                    textureHeight: 0,
                    meshGeometry: null,
                    meshGeometryKey: "",
                    viewscale,
                    xyratio
                };
                bundle.sprite.anchor.set(0, 0);
                bundle.sprite.roundPixels = false;
                sectionCompositeCache.set(compositeKey, bundle);
            }

            const groupDirty = sectionDirtyAll || (Number.isInteger(groupId) && sectionDirtyIds.has(groupId));
            const wallIds = wallMembers.map(item => String(getSectionObjectId(item))).filter(Boolean);
            const mountedIds = mountedMembers.map(item => String(getSectionObjectId(item))).filter(Boolean);
            const membershipSignature = `${wallIds.join(",")}::${mountedIds.join(",")}`;
            const needsRebuild = (
                groupDirty ||
                ((outputMode === "mesh3d") ? !bundle.mesh : !bundle.renderTexture) ||
                bundle.membershipSignature !== membershipSignature ||
                (
                    outputMode !== "mesh3d" &&
                    (
                        !Number.isFinite(bundle.viewscale) ||
                        Math.abs(bundle.viewscale - viewscale) > 1e-6 ||
                        !Number.isFinite(bundle.xyratio) ||
                        Math.abs(bundle.xyratio - xyratio) > 1e-6
                    )
                )
            );

            if (needsRebuild) {
                let section = wallSectionInstances.get(subgroupKey);
                if (!section) {
                    section = new WallSection({ id: subgroupKey });
                    wallSectionInstances.set(subgroupKey, section);
                }
                const sectionReady = section.setFromWalls(wallMembers, mapRef, subgroupKey, mountedMembers);
                if (!sectionReady) {
                    bundle.sprite.visible = false;
                    bundle.membershipSignature = "";
                    return;
                }
                if (outputMode === "mesh3d") {
                    if (bundle.renderTexture && typeof bundle.renderTexture.destroy === "function") {
                        bundle.renderTexture.destroy(true);
                        bundle.renderTexture = null;
                    }
                    if (!bundle.mesh) {
                        bundle.mesh = createSectionDepthMesh(pixiRef);
                    }
                    const meshGeometry = section.buildWorldMeshGeometry();
                    if (!meshGeometry || !bundle.mesh) {
                        const waitingForTextureConfig = !!(section && section.textureConfigPending);
                        if (bundle.sprite) bundle.sprite.visible = false;
                        bundle.meshGeometry = null;
                        bundle.meshGeometryKey = "";
                        if (bundle.mesh) bundle.mesh.visible = false;
                        if (waitingForTextureConfig) {
                            bundle.membershipSignature = membershipSignature;
                            bundle.buildCameraX = Number.isFinite(camera && camera.x) ? Number(camera.x) : 0;
                            bundle.buildCameraY = Number.isFinite(camera && camera.y) ? Number(camera.y) : 0;
                            bundle.viewscale = viewscale;
                            bundle.xyratio = xyratio;
                            if (Number.isInteger(groupId)) dirtyGroupIdsToClear.add(groupId);
                        } else {
                            bundle.membershipSignature = "";
                        }
                        return;
                    }
                    bundle.meshGeometry = meshGeometry;
                    bundle.meshGeometryKey = (typeof meshGeometry.key === "string" && meshGeometry.key.length > 0)
                        ? meshGeometry.key
                        : `${meshGeometry.positions.length}|${meshGeometry.indices.length}`;
                    if (!setSectionMeshGeometry(bundle.mesh, meshGeometry)) {
                        bundle.mesh.visible = false;
                        bundle.meshGeometry = null;
                        bundle.meshGeometryKey = "";
                        bundle.membershipSignature = "";
                        return;
                    }
                } else {
                    if (bundle.mesh) bundle.mesh.visible = false;
                    const generatedImage = section.buildSectionImage(appRef, pixiRef, {
                        viewscale,
                        xyratio,
                        color: 0x555555,
                        alpha: 1,
                        pad: 2
                    });
                    if (!generatedImage || !generatedImage.renderTexture) {
                        bundle.sprite.visible = false;
                        bundle.membershipSignature = "";
                        return;
                    }
                    const nextRenderTexture = generatedImage.renderTexture;
                    if (bundle.renderTexture && typeof bundle.renderTexture.destroy === "function") {
                        bundle.renderTexture.destroy(true);
                    }
                    bundle.renderTexture = nextRenderTexture;
                    bundle.sprite.texture = nextRenderTexture;
                    bundle.baseScreenX = generatedImage.baseX;
                    bundle.baseScreenY = generatedImage.baseY;
                    bundle.textureWidth = generatedImage.width;
                    bundle.textureHeight = generatedImage.height;
                    bundle.meshGeometry = null;
                    bundle.meshGeometryKey = "";
                }
                bundle.membershipSignature = membershipSignature;
                bundle.buildCameraX = Number.isFinite(camera && camera.x) ? Number(camera.x) : 0;
                bundle.buildCameraY = Number.isFinite(camera && camera.y) ? Number(camera.y) : 0;
                bundle.viewscale = viewscale;
                bundle.xyratio = xyratio;
                if (Number.isInteger(groupId)) dirtyGroupIdsToClear.add(groupId);
                rebuiltCount += 1;
            }

            if (outputMode !== "mesh3d") {
                const camDx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(camera.x, bundle.buildCameraX)
                    : (bundle.buildCameraX - camera.x);
                const camDy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(camera.y, bundle.buildCameraY)
                    : (bundle.buildCameraY - camera.y);
                bundle.sprite.x = bundle.baseScreenX + camDx * viewscale;
                bundle.sprite.y = bundle.baseScreenY + camDy * viewscale * xyratio;
            }

            let sectionVisualSource = wallMembers.find(item => item && item.pixiSprite && item.pixiSprite.visible);
            if (!sectionVisualSource && wallMembers.length > 0) sectionVisualSource = wallMembers[0];
            if (!sectionVisualSource && members.length > 0) sectionVisualSource = members[0];
            const sourceSprite = sectionVisualSource && sectionVisualSource.pixiSprite ? sectionVisualSource.pixiSprite : null;
            const sourceAlpha = sourceSprite && Number.isFinite(sourceSprite.alpha) ? Number(sourceSprite.alpha) : 1;
            const sourceTint = sourceSprite && Number.isFinite(sourceSprite.tint) ? Number(sourceSprite.tint) : 0xFFFFFF;
            if (outputMode === "mesh3d") {
                if (bundle.mesh) {
                    updateSectionMeshUniforms(bundle.mesh, {
                        camera,
                        app: appRef,
                        viewscale,
                        xyratio,
                        texture: bundle.meshGeometry ? bundle.meshGeometry.texture : null,
                        alphaCutoff: bundle.meshGeometry ? bundle.meshGeometry.alphaCutoff : 0.02,
                        tint: sourceTint,
                        alpha: sourceAlpha
                    });
                    bundle.mesh.visible = true;
                }
            } else {
                bundle.sprite.alpha = sourceAlpha;
                bundle.sprite.tint = sourceTint;
                bundle.sprite.visible = true;
            }

            for (let i = 0; i < members.length; i++) {
                const member = members[i];
                if (!member || !member.pixiSprite) continue;
                member.pixiSprite.renderable = false;
                member._wallSectionCompositeSprite = bundle.sprite;
                member._wallSectionCompositeDisplayObject = null;
                hiddenItems.add(member);
            }

            let minBottom = Infinity;
            let maxTop = -Infinity;
            let avgX = 0;
            let avgY = 0;
            let count = 0;
            for (let i = 0; i < wallMembers.length; i++) {
                const wall = wallMembers[i];
                if (!wall) continue;
                const bottom = Number.isFinite(wall.bottomZ) ? Number(wall.bottomZ) : (Number.isFinite(wall.z) ? Number(wall.z) : 0);
                const top = bottom + (Number.isFinite(wall.height) ? Math.max(0, Number(wall.height)) : 0);
                minBottom = Math.min(minBottom, bottom);
                maxTop = Math.max(maxTop, top);
                if (Number.isFinite(wall.x) && Number.isFinite(wall.y)) {
                    avgX += Number(wall.x);
                    avgY += Number(wall.y);
                    count += 1;
                }
            }
            if (!Number.isFinite(minBottom)) minBottom = 0;
            if (!Number.isFinite(maxTop)) maxTop = minBottom;
            if (count > 0) {
                avgX /= count;
                avgY /= count;
            } else {
                avgX = 0;
                avgY = 0;
            }
            const representativeWall = wallMembers[0] || null;
            const representativeHitbox = representativeWall && representativeWall.groundPlaneHitbox
                ? representativeWall.groundPlaneHitbox
                : null;
            if (!bundle.renderItem) {
                bundle.renderItem = {
                    type: "wallSectionComposite",
                    x: 0,
                    y: 0,
                    z: 0,
                    bottomZ: 0,
                    height: 0,
                    lineGroupId: null,
                    mountedWallLineGroupId: null,
                    sectionId: null,
                    groundPlaneHitbox: null,
                    pixiSprite: bundle.sprite,
                    skipTransform: true,
                    draw: () => {},
                    _sectionCompositeBundleKey: compositeKey,
                    _sectionMemberWalls: [],
                    _sectionMountedMembers: [],
                    _sectionCompositeMembershipSignature: "",
                    _sectionCompositeOutputMode: "sprite",
                    _sectionMeshGeometry: null
                };
            }
            bundle.renderItem.x = avgX;
            bundle.renderItem.y = avgY;
            bundle.renderItem.z = minBottom;
            bundle.renderItem.bottomZ = minBottom;
            bundle.renderItem.height = Math.max(0, maxTop - minBottom);
            bundle.renderItem.lineGroupId = Number.isInteger(groupId) ? Number(groupId) : null;
            bundle.renderItem.mountedWallLineGroupId = Number.isInteger(groupId) ? Number(groupId) : null;
            bundle.renderItem.sectionId = Number.isInteger(groupId) ? Number(groupId) : null;
            bundle.renderItem.groundPlaneHitbox = representativeHitbox;
            bundle.renderItem.pixiSprite = (outputMode === "mesh3d") ? bundle.mesh : bundle.sprite;
            bundle.renderItem._sectionMemberWalls = wallMembers.slice();
            bundle.renderItem._sectionMountedMembers = mountedMembers.slice();
            bundle.renderItem._sectionCompositeMembershipSignature = membershipSignature;
            bundle.renderItem._sectionCompositeOutputMode = outputMode;
            bundle.renderItem._sectionMeshGeometry = (outputMode === "mesh3d") ? bundle.meshGeometry : null;
            bundle.renderItem.alpha = sourceAlpha;
            bundle.renderItem.tint = sourceTint;
            renderItems.push(bundle.renderItem);
        });

        const cacheKeys = Array.from(sectionCompositeCache.keys());
        for (let i = 0; i < cacheKeys.length; i++) {
            const key = cacheKeys[i];
            if (!key.startsWith(`${cachePrefix}:`)) continue;
            if (seenKeys.has(key)) continue;
            const bundle = sectionCompositeCache.get(key);
            destroyBundle(bundle);
            sectionCompositeCache.delete(key);
        }
        const sectionIds = Array.from(wallSectionInstances.keys());
        for (let i = 0; i < sectionIds.length; i++) {
            const id = sectionIds[i];
            if (seenSectionIds.has(id)) continue;
            wallSectionInstances.delete(id);
        }
        dirtyGroupIdsToClear.forEach(id => {
            sectionDirtyIds.delete(id);
        });

        return { renderItems, hiddenItems, stats: { groups: groupsCount, rebuilt: rebuiltCount } };
    }

    globalScope.WallSectionsRenderer = {
        markDirty,
        markAllDirty,
        queueRebuildPass,
        clearCache,
        prepareFrame,
        endFrame,
        restoreRenderable,
        buildCompositeRenderItems,
        getWallMountedPlacementCandidate
    };

    // Backward-compatible globals used by other files.
    globalScope.markWallSectionDirty = markDirty;
    globalScope.markAllWallSectionsDirty = markAllDirty;
    globalScope.queueWallSectionRebuildPass = queueRebuildPass;
})(typeof globalThis !== "undefined" ? globalThis : window);
