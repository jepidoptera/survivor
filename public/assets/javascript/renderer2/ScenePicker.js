(function attachRenderer2ScenePicker(global) {
    const PICK_MESH_VS = `
precision mediump float;
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUvs;
void main(void) {
    vec3 pos = projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0);
    gl_Position = vec4(pos.xy, 0.0, 1.0);
    vUvs = aUvs;
}
`;
    const PICK_MESH_FS = `
precision mediump float;
varying vec2 vUvs;
uniform sampler2D uSampler;
uniform vec3 uPickColor;
uniform float uAlphaCutoff;
void main(void) {
    float a = texture2D(uSampler, vUvs).a;
    if (a < uAlphaCutoff) discard;
    gl_FragColor = vec4(uPickColor, 1.0);
}
`;
    const PICK_WORLD_MESH_VS = `
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
        (screenY / sy) * 2.0 - 1.0
    );
    gl_Position = vec4(clip, nd * 2.0 - 1.0, 1.0);
    vUvs = aUvs;
}
`;

    class Renderer2ScenePicker {
        constructor() {
            this.highlightSprite = null;
            this.highlightMesh = null;
            this.highlightGraphics = null;
            this.objectIdByObject = new WeakMap();
            this.objectById = new Map();
            this.pickContainer = new PIXI.Container();
            this.pickContainer.name = "renderer2PickerContainer";
            this.pickPreviewSprite = null;
            this.pickBackgroundSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
            this.pickBackgroundSprite.name = "renderer2PickerBackground";
            this.pickBackgroundSprite.tint = 0x000000;
            this.pickBackgroundSprite.alpha = 1;
            this.pickBackgroundSprite.interactive = false;
            this.pickBackgroundSprite.visible = true;
            this.pickRenderTexture = null;
            this.pickRenderer = null;
            this.pickPixelReadMode = null;
            this.pickProxyByObject = new WeakMap();
            this.pickProxiesActiveThisFrame = new Set();
            this.pickEntriesThisFrame = [];
            this.pickPixelScratch = new Uint8Array(4);
            this.latestPickFrame = -1;
            this.latestPickX = 0;
            this.latestPickY = 0;
            this.latestPickObject = null;
            this.lastReadbackFrame = -1;
            this.pickLastCamera = null;
            this.pickLastDepthRange = null;
            this.idAssignmentSalt = Math.floor(Math.random() * 0x7fffffff);
            this.activeTintTarget = null;
            this.activeTintState = null;
            this.publicApi = {
                pickObjectAtScreenPoint: (screenX, screenY, options = null) =>
                    this.pickObjectAtScreenPoint(screenX, screenY, options),
                getObjectForColor: (rgb) => this.getObjectForColor(rgb),
                registerObject: (obj) => this.ensureObjectPickerId(obj)
            };
            global.renderer2ScenePicker = this.publicApi;
            global.renderingScenePicker = this.publicApi;
        }

        ensureObjects() {
            if (!this.highlightSprite) {
                this.highlightSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
                this.highlightSprite.name = "renderer2HoverHighlightSprite";
                this.highlightSprite.visible = false;
                this.highlightSprite.interactive = false;
                this.highlightSprite.blendMode = PIXI.BLEND_MODES.ADD;
            }
            if (!this.highlightMesh) {
                this.highlightMesh = new PIXI.Mesh(
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
                this.highlightMesh.name = "renderer2HoverHighlightMesh";
                this.highlightMesh.visible = false;
                this.highlightMesh.interactive = false;
                this.highlightMesh.blendMode = PIXI.BLEND_MODES.ADD;
            }
            if (!this.highlightGraphics) {
                this.highlightGraphics = new PIXI.Graphics();
                this.highlightGraphics.name = "renderer2HoverHighlightGraphics";
                this.highlightGraphics.visible = false;
                this.highlightGraphics.interactive = false;
                this.highlightGraphics.blendMode = PIXI.BLEND_MODES.ADD;
            }
        }

        hideAll() {
            this.clearTintHighlight();
            if (this.highlightSprite) this.highlightSprite.visible = false;
            if (this.highlightMesh) this.highlightMesh.visible = false;
            if (this.highlightGraphics) {
                this.highlightGraphics.clear();
                this.highlightGraphics.visible = false;
            }
            if (this.pickContainer && this.pickContainer.parent) {
                this.pickContainer.parent.removeChild(this.pickContainer);
            }
            if (this.pickPreviewSprite) {
                this.pickPreviewSprite.visible = false;
                if (this.pickPreviewSprite.parent) {
                    this.pickPreviewSprite.parent.removeChild(this.pickPreviewSprite);
                }
            }
        }

        blendTintToward(baseTint, targetTint, amount) {
            const t = Math.max(0, Math.min(1, Number.isFinite(amount) ? Number(amount) : 0));
            const br = (baseTint >> 16) & 255;
            const bg = (baseTint >> 8) & 255;
            const bb = baseTint & 255;
            const tr = (targetTint >> 16) & 255;
            const tg = (targetTint >> 8) & 255;
            const tb = targetTint & 255;
            const rr = Math.round(br + (tr - br) * t);
            const rg = Math.round(bg + (tg - bg) * t);
            const rb = Math.round(bb + (tb - bb) * t);
            return (rr << 16) | (rg << 8) | rb;
        }

        clearTintHighlight() {
            const target = this.activeTintTarget;
            const state = this.activeTintState;
            if (!target || !state) {
                this.activeTintTarget = null;
                this.activeTintState = null;
                return;
            }
            if (state.hasTintProp && Number.isFinite(state.tint)) {
                target.tint = state.tint;
            }
            if (state.hasAlphaProp && Number.isFinite(state.alpha)) {
                target.alpha = state.alpha;
            }
            if (state.shaderTintOriginal && target.shader && target.shader.uniforms && target.shader.uniforms.uTint) {
                const u = target.shader.uniforms.uTint;
                if (u && typeof u.length === "number" && u.length >= 4) {
                    u[0] = state.shaderTintOriginal[0];
                    u[1] = state.shaderTintOriginal[1];
                    u[2] = state.shaderTintOriginal[2];
                    u[3] = state.shaderTintOriginal[3];
                }
            }
            this.activeTintTarget = null;
            this.activeTintState = null;
        }

        applyTintHighlight(targetDisplay, pulse) {
            if (!targetDisplay) return false;
            const hasTintProp = Number.isFinite(targetDisplay.tint);
            const hasAlphaProp = Number.isFinite(targetDisplay.alpha);
            const baseTint = hasTintProp ? Number(targetDisplay.tint) : 0xFFFFFF;
            const blendAmount = 0.25 + 0.15 * Math.max(0, Math.min(1, Number(pulse) || 0));
            const nextTint = this.blendTintToward(baseTint, 0x66c2ff, blendAmount);
            const state = {
                hasTintProp,
                hasAlphaProp,
                tint: hasTintProp ? Number(targetDisplay.tint) : null,
                alpha: hasAlphaProp ? Number(targetDisplay.alpha) : null,
                shaderTintOriginal: null
            };
            if (hasTintProp) {
                targetDisplay.tint = nextTint;
            }
            if (targetDisplay.shader && targetDisplay.shader.uniforms && targetDisplay.shader.uniforms.uTint) {
                const u = targetDisplay.shader.uniforms.uTint;
                if (u && typeof u.length === "number" && u.length >= 4) {
                    state.shaderTintOriginal = [
                        Number(u[0]) || 1,
                        Number(u[1]) || 1,
                        Number(u[2]) || 1,
                        Number(u[3]) || 1
                    ];
                    u[0] = ((nextTint >> 16) & 255) / 255;
                    u[1] = ((nextTint >> 8) & 255) / 255;
                    u[2] = (nextTint & 255) / 255;
                }
            }
            this.activeTintTarget = targetDisplay;
            this.activeTintState = state;
            return true;
        }

        applyPickerPreviewHighlight(target) {
            if (!target || !Array.isArray(this.pickEntriesThisFrame) || this.pickEntriesThisFrame.length === 0) {
                return false;
            }
            let entry = null;
            for (let i = 0; i < this.pickEntriesThisFrame.length; i++) {
                const candidate = this.pickEntriesThisFrame[i];
                if (!candidate || !candidate.item) continue;
                if (candidate.item === target) {
                    entry = candidate;
                    break;
                }
            }
            if (!entry || !entry.record || !entry.record.shader || !entry.record.shader.uniforms) return false;
            const uniforms = entry.record.shader.uniforms;
            const base = Array.isArray(entry.rgb) ? entry.rgb : [0, 0, 0];
            const r = (((Number(base[0]) || 0) + 64) % 256) / 255;
            const g = (((Number(base[1]) || 0) + 64) % 256) / 255;
            const b = (((Number(base[2]) || 0) + 64) % 256) / 255;
            uniforms.uPickColor = new Float32Array([r, g, b]);
            return true;
        }

        renderPickerScreenPreview(ctx) {
            const uiLayer = ctx && ctx.uiLayer;
            const app = ctx && ctx.app;
            const show = (typeof global.renderer2ShowPickerScreen === "boolean")
                ? !!global.renderer2ShowPickerScreen
                : !!global.renderingShowPickerScreen;
            if (!uiLayer) return;
            if (!this.pickPreviewSprite) {
                this.pickPreviewSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
                this.pickPreviewSprite.name = "renderer2PickerPreviewSprite";
                this.pickPreviewSprite.interactive = false;
                this.pickPreviewSprite.visible = false;
                this.pickPreviewSprite.alpha = 1;
            }
            if (!show) {
                if (this.pickPreviewSprite.parent) {
                    this.pickPreviewSprite.parent.removeChild(this.pickPreviewSprite);
                }
                this.pickPreviewSprite.visible = false;
                return;
            }
            if (!this.pickRenderTexture) {
                this.pickPreviewSprite.visible = false;
                return;
            }
            const screenWidth = Math.max(1, Math.round(Number(app && app.screen && app.screen.width) || Number(this.pickRenderTexture.width) || 1));
            const screenHeight = Math.max(1, Math.round(Number(app && app.screen && app.screen.height) || Number(this.pickRenderTexture.height) || 1));
            this.pickPreviewSprite.texture = this.pickRenderTexture;
            this.pickPreviewSprite.position.set(0, 0);
            this.pickPreviewSprite.width = screenWidth;
            this.pickPreviewSprite.height = screenHeight;
            this.pickPreviewSprite.visible = true;
            if (this.pickPreviewSprite.parent !== uiLayer) {
                uiLayer.addChild(this.pickPreviewSprite);
            } else {
                uiLayer.setChildIndex(this.pickPreviewSprite, uiLayer.children.length - 1);
            }
        }

        getPulse(frameCount) {
            const tick = Number.isFinite(frameCount) ? frameCount : 0;
            return 0.55 + 0.45 * (Math.sin(tick * 0.12) * 0.5 + 0.5);
        }

        rgbToId(r, g, b) {
            return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
        }

        idToRgb(id) {
            return [
                (id >> 16) & 255,
                (id >> 8) & 255,
                id & 255
            ];
        }

        generateUniqueObjectId(obj) {
            const maxAttempts = 512;
            const objectSalt = Math.floor(Math.random() * 0x7fffffff);
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const seed = (this.idAssignmentSalt + objectSalt + attempt * 2654435761) >>> 0;
                const r = ((seed >> 16) ^ (seed >> 8) ^ seed) & 255;
                const g = ((seed >> 10) ^ (seed >> 2) ^ (seed >> 24)) & 255;
                const b = ((seed >> 4) ^ (seed >> 18) ^ (seed >> 12)) & 255;
                const id = this.rgbToId(r, g, b);
                if (id === 0) continue;
                const existing = this.objectById.get(id);
                if (!existing || existing === obj) return id;
            }
            for (let id = 1; id <= 0xFFFFFF; id++) {
                const existing = this.objectById.get(id);
                if (!existing || existing === obj) return id;
            }
            return 0;
        }

        ensureObjectPickerId(obj) {
            if (!obj || (obj.gone || obj.vanishing)) return 0;

            const existingId = this.objectIdByObject.get(obj);
            if (Number.isInteger(existingId) && existingId > 0 && existingId <= 0xFFFFFF) {
                const mappedObj = this.objectById.get(existingId);
                if (!mappedObj || mappedObj === obj) {
                    this.objectById.set(existingId, obj);
                    if (!Array.isArray(obj.uniqueID) || obj.uniqueID.length !== 3) {
                        obj.uniqueID = this.idToRgb(existingId);
                    }
                    return existingId;
                }
            }

            const provided = Array.isArray(obj.uniqueID) && obj.uniqueID.length === 3
                ? obj.uniqueID
                : null;
            if (provided) {
                const r = Number(provided[0]) & 255;
                const g = Number(provided[1]) & 255;
                const b = Number(provided[2]) & 255;
                const providedId = this.rgbToId(r, g, b);
                if (providedId !== 0) {
                    const mappedObj = this.objectById.get(providedId);
                    if (!mappedObj || mappedObj === obj) {
                        this.objectIdByObject.set(obj, providedId);
                        this.objectById.set(providedId, obj);
                        obj.uniqueID = [r, g, b];
                        return providedId;
                    }
                }
            }

            const id = this.generateUniqueObjectId(obj);
            if (!id) return 0;
            this.objectIdByObject.set(obj, id);
            this.objectById.set(id, obj);
            obj.uniqueID = this.idToRgb(id);
            return id;
        }

        getObjectForColor(rgb) {
            const isArrayLike = !!(
                rgb &&
                typeof rgb.length === "number" &&
                rgb.length >= 3
            );
            if (!isArrayLike) return null;
            const id = this.rgbToId(Number(rgb[0]) || 0, Number(rgb[1]) || 0, Number(rgb[2]) || 0);
            if (!id) return null;
            const obj = this.objectById.get(id) || null;
            if (!obj || obj.gone || obj.vanishing) return null;
            return obj;
        }

        getObjectAtPickPixel(screenX, screenY) {
            if (!this.pickRenderTexture || !Number.isFinite(screenX) || !Number.isFinite(screenY)) {
                return null;
            }
            const renderer = this.pickRenderer || (global.app && global.app.renderer ? global.app.renderer : null);
            if (!renderer) {
                return null;
            }
            const x = Math.floor(screenX);
            const y = Math.floor(screenY);
            const width = Number(this.pickRenderTexture.width) || 0;
            const height = Number(this.pickRenderTexture.height) || 0;
            if (x < 0 || y < 0 || x >= width || y >= height) {
                return null;
            }
            const tryReadDirectWebGL = () => {
                const gl = renderer.gl;
                const rt = this.pickRenderTexture;
                const fb = rt && rt.framebuffer
                    ? rt.framebuffer
                    : (rt && rt.baseTexture && rt.baseTexture.framebuffer ? rt.baseTexture.framebuffer : null);
                const fbSystem = renderer.framebuffer;
                if (!gl || !fb || !fbSystem || typeof fbSystem.bind !== "function") return null;
                const prev = fbSystem.current;
                const out = this.pickPixelScratch;
                try {
                    fbSystem.bind(fb, false);
                    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
                    return [out[0], out[1], out[2], out[3]];
                } catch (_err) {
                    return null;
                } finally {
                    try {
                        fbSystem.bind(prev, false);
                    } catch (_err2) {
                        // no-op
                    }
                }
            };
            let pixels = null;
            pixels = tryReadDirectWebGL();
            this.pickPixelReadMode = "webgl";

            if (!pixels) {
                return null;
            }
            this.pickPixelScratch[0] = pixels[0];
            this.pickPixelScratch[1] = pixels[1];
            this.pickPixelScratch[2] = pixels[2];
            this.pickPixelScratch[3] = pixels[3];
            return this.getObjectForColor(this.pickPixelScratch);
        }

        createPickSpriteProxy() {
            const geometry = new PIXI.Geometry()
                .addAttribute("aVertexPosition", new Float32Array(8), 2)
                .addAttribute("aUvs", new Float32Array([
                    0, 1,
                    1, 1,
                    1, 0,
                    0, 0
                ]), 2)
                .addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
            const shader = PIXI.Shader.from(PICK_MESH_VS, PICK_MESH_FS, {
                uSampler: PIXI.Texture.WHITE,
                uPickColor: new Float32Array([1, 1, 1]),
                uAlphaCutoff: 0.08
            });
            const mesh = new PIXI.Mesh(geometry, shader, PIXI.State.for2d(), PIXI.DRAW_MODES.TRIANGLES);
            mesh.name = "renderer2PickerSpriteProxyMesh";
            mesh.visible = false;
            mesh.interactive = false;
            mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
            return { proxy: mesh, type: "spriteMesh", shader };
        }

        createPickMeshProxy(sourceMesh) {
            if (!sourceMesh || !(sourceMesh instanceof PIXI.Mesh)) return null;
            const geometry = sourceMesh.geometry || null;
            if (!geometry || typeof geometry.getBuffer !== "function") return null;
            const safeGetBuffer = (attrName) => {
                if (!geometry || typeof geometry.getBuffer !== "function") return null;
                try {
                    return geometry.getBuffer(attrName);
                } catch (_err) {
                    return null;
                }
            };
            const vBuf = safeGetBuffer("aVertexPosition");
            const wBuf = safeGetBuffer("aWorldPosition");
            const uvBuf = safeGetBuffer("aUvs");
            if ((!vBuf || !vBuf.data) && (!wBuf || !wBuf.data)) return null;
            if (!uvBuf || !uvBuf.data) return null;
            const useWorldPositions = !!(wBuf && wBuf.data);
            const shader = useWorldPositions
                ? PIXI.Shader.from(PICK_WORLD_MESH_VS, PICK_MESH_FS, {
                    uScreenSize: new Float32Array([1, 1]),
                    uCameraWorld: new Float32Array([0, 0]),
                    uViewScale: 1,
                    uXyRatio: 1,
                    uDepthRange: new Float32Array([0, 1]),
                    uSampler: PIXI.Texture.WHITE,
                    uPickColor: new Float32Array([1, 1, 1]),
                    uAlphaCutoff: 0.08
                })
                : PIXI.Shader.from(PICK_MESH_VS, PICK_MESH_FS, {
                    uSampler: PIXI.Texture.WHITE,
                    uPickColor: new Float32Array([1, 1, 1]),
                    uAlphaCutoff: 0.08
                });
            const mesh = new PIXI.Mesh(
                geometry,
                shader,
                sourceMesh.state || PIXI.State.for2d(),
                sourceMesh.drawMode || PIXI.DRAW_MODES.TRIANGLES
            );
            mesh.name = "renderer2PickerMeshProxy";
            mesh.visible = false;
            mesh.interactive = false;
            mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
            return { proxy: mesh, type: "mesh", shader, useWorldPositions };
        }

        ensurePickProxyForDisplayObject(item, displayObj) {
            if (!item || !displayObj) return null;
            let record = this.pickProxyByObject.get(item) || null;
            if (record && record.sourceType !== displayObj.constructor) {
                if (record.proxy && record.proxy.parent) {
                    record.proxy.parent.removeChild(record.proxy);
                }
                this.pickProxyByObject.delete(item);
                record = null;
            }
            if (!record) {
                if (displayObj instanceof PIXI.Sprite) {
                    const created = this.createPickSpriteProxy();
                    if (!created) return null;
                    record = { ...created, sourceType: PIXI.Sprite };
                } else if (displayObj instanceof PIXI.Mesh) {
                    const created = this.createPickMeshProxy(displayObj);
                    if (!created) return null;
                    record = { ...created, sourceType: PIXI.Mesh };
                } else {
                    return null;
                }
                this.pickProxyByObject.set(item, record);
            }
            return record;
        }

        syncPickProxyFromDisplayObject(record, displayObj, rgbColor) {
            if (!record || !record.proxy || !displayObj) return false;
            const proxy = record.proxy;
            if (record.type === "spriteMesh") {
                const texture = displayObj.texture || PIXI.Texture.WHITE;
                const sxAbs = Math.max(1e-6, Math.abs(Number(displayObj.scale && displayObj.scale.x) || 0));
                const syAbs = Math.max(1e-6, Math.abs(Number(displayObj.scale && displayObj.scale.y) || 0));
                const w = (texture && texture.orig && Number.isFinite(texture.orig.width))
                    ? Number(texture.orig.width)
                    : (Math.abs(Number(displayObj.width) || 0) / sxAbs);
                const h = (texture && texture.orig && Number.isFinite(texture.orig.height))
                    ? Number(texture.orig.height)
                    : (Math.abs(Number(displayObj.height) || 0) / syAbs);
                const anchorX = (displayObj.anchor && Number.isFinite(displayObj.anchor.x))
                    ? Number(displayObj.anchor.x)
                    : 0;
                const anchorY = (displayObj.anchor && Number.isFinite(displayObj.anchor.y))
                    ? Number(displayObj.anchor.y)
                    : 0;
                const x0 = -anchorX * w;
                const y0 = -anchorY * h;
                const x1 = x0 + w;
                const y1 = y0 + h;
                const vbuf = proxy.geometry.getBuffer("aVertexPosition");
                if (vbuf && vbuf.data && vbuf.data.length >= 8) {
                    vbuf.data[0] = x0; vbuf.data[1] = y0;
                    vbuf.data[2] = x1; vbuf.data[3] = y0;
                    vbuf.data[4] = x1; vbuf.data[5] = y1;
                    vbuf.data[6] = x0; vbuf.data[7] = y1;
                    vbuf.update();
                }
                const ubuf = proxy.geometry.getBuffer("aUvs");
                if (ubuf && ubuf.data && ubuf.data.length >= 8) {
                    const uvs = texture && texture._uvs ? texture._uvs : null;
                    if (uvs) {
                        ubuf.data[0] = uvs.x0; ubuf.data[1] = uvs.y0;
                        ubuf.data[2] = uvs.x1; ubuf.data[3] = uvs.y1;
                        ubuf.data[4] = uvs.x2; ubuf.data[5] = uvs.y2;
                        ubuf.data[6] = uvs.x3; ubuf.data[7] = uvs.y3;
                    } else {
                        ubuf.data[0] = 0; ubuf.data[1] = 1;
                        ubuf.data[2] = 1; ubuf.data[3] = 1;
                        ubuf.data[4] = 1; ubuf.data[5] = 0;
                        ubuf.data[6] = 0; ubuf.data[7] = 0;
                    }
                    ubuf.update();
                }
                proxy.position.set(displayObj.position.x, displayObj.position.y);
                proxy.scale.set(displayObj.scale.x, displayObj.scale.y);
                proxy.rotation = displayObj.rotation;
                proxy.skew.set(displayObj.skew.x, displayObj.skew.y);
                proxy.pivot.set(displayObj.pivot.x, displayObj.pivot.y);
                proxy.alpha = 1;
                proxy.visible = true;
                if (record.shader && record.shader.uniforms) {
                    record.shader.uniforms.uSampler = texture;
                    record.shader.uniforms.uPickColor = new Float32Array([
                        rgbColor[0] / 255,
                        rgbColor[1] / 255,
                        rgbColor[2] / 255
                    ]);
                }
                return true;
            }
            if (record.type === "mesh") {
                if (record.useWorldPositions) {
                    // World-space proxies are projected from aWorldPosition in shader.
                    // Keep display transform identity so we don't double-transform.
                    proxy.position.set(0, 0);
                    proxy.scale.set(1, 1);
                    proxy.rotation = 0;
                    proxy.skew.set(0, 0);
                    proxy.pivot.set(0, 0);
                } else {
                    proxy.position.set(displayObj.position.x, displayObj.position.y);
                    proxy.scale.set(displayObj.scale.x, displayObj.scale.y);
                    proxy.rotation = displayObj.rotation;
                    proxy.skew.set(displayObj.skew.x, displayObj.skew.y);
                    proxy.pivot.set(displayObj.pivot.x, displayObj.pivot.y);
                }
                proxy.alpha = 1;
                proxy.visible = true;
                if (record.shader && record.shader.uniforms) {
                    const sourceTexture = (displayObj.material && displayObj.material.texture)
                        ? displayObj.material.texture
                        : ((displayObj.shader && displayObj.shader.uniforms && displayObj.shader.uniforms.uSampler)
                            ? displayObj.shader.uniforms.uSampler
                            : PIXI.Texture.WHITE);
                    record.shader.uniforms.uSampler = sourceTexture || PIXI.Texture.WHITE;
                    record.shader.uniforms.uPickColor = new Float32Array([
                        rgbColor[0] / 255,
                        rgbColor[1] / 255,
                        rgbColor[2] / 255
                    ]);
                    if (
                        displayObj &&
                        displayObj.shader &&
                        displayObj.shader.uniforms &&
                        Number.isFinite(displayObj.shader.uniforms.uAlphaCutoff) &&
                        Number.isFinite(record.shader.uniforms.uAlphaCutoff)
                    ) {
                        record.shader.uniforms.uAlphaCutoff = Number(displayObj.shader.uniforms.uAlphaCutoff);
                    }
                    if (record.useWorldPositions) {
                        const camera = this.pickLastCamera || null;
                        const depthRange = this.pickLastDepthRange || null;
                        const screenW = (this.pickRenderTexture && Number.isFinite(this.pickRenderTexture.width))
                            ? Number(this.pickRenderTexture.width)
                            : 1;
                        const screenH = (this.pickRenderTexture && Number.isFinite(this.pickRenderTexture.height))
                            ? Number(this.pickRenderTexture.height)
                            : 1;
                        record.shader.uniforms.uScreenSize[0] = Math.max(1, screenW);
                        record.shader.uniforms.uScreenSize[1] = Math.max(1, screenH);
                        record.shader.uniforms.uCameraWorld[0] = Number(camera && camera.x) || 0;
                        record.shader.uniforms.uCameraWorld[1] = Number(camera && camera.y) || 0;
                        record.shader.uniforms.uViewScale = Number(camera && camera.viewscale) || 1;
                        record.shader.uniforms.uXyRatio = Number(camera && camera.xyratio) || 1;
                        record.shader.uniforms.uDepthRange[0] = Number(depthRange && depthRange.farMetric) || 1;
                        record.shader.uniforms.uDepthRange[1] = Number(depthRange && depthRange.invSpan) || 1;
                    }
                }
                return true;
            }
            return false;
        }

        buildPickPass(ctx, onscreenObjects) {
            const app = ctx && ctx.app;
            if (!app || !app.renderer) return;
            const renderer = app.renderer;
            this.pickRenderer = renderer;
            this.pickLastCamera = (ctx && ctx.camera) || null;
            const viewportHeight = Number(ctx && ctx.viewport && ctx.viewport.height) || 30;
            const nearMetric = -Math.max(80, viewportHeight * 0.6);
            const farMetric = Math.max(180, viewportHeight * 2.0 + 80);
            const depthSpanInv = 1 / Math.max(1e-6, farMetric - nearMetric);
            this.pickLastDepthRange = {
                farMetric,
                invSpan: depthSpanInv
            };
            const screenWidth = Math.max(1, Math.round(Number(app.screen && app.screen.width) || 1));
            const screenHeight = Math.max(1, Math.round(Number(app.screen && app.screen.height) || 1));
            if (
                !this.pickRenderTexture ||
                this.pickRenderTexture.width !== screenWidth ||
                this.pickRenderTexture.height !== screenHeight
            ) {
                if (this.pickRenderTexture) {
                    this.pickRenderTexture.destroy(true);
                }
                this.pickRenderTexture = PIXI.RenderTexture.create({
                    width: screenWidth,
                    height: screenHeight,
                    resolution: 1
                });
            }

            this.pickContainer.removeChildren();
            this.pickProxiesActiveThisFrame.clear();
            this.pickEntriesThisFrame.length = 0;
            this.pickBackgroundSprite.position.set(0, 0);
            this.pickBackgroundSprite.width = screenWidth;
            this.pickBackgroundSprite.height = screenHeight;
            this.pickBackgroundSprite.visible = true;
            this.pickContainer.addChild(this.pickBackgroundSprite);

            const explicitDrawOrder = Array.isArray(ctx && ctx.pickRenderItems)
                ? ctx.pickRenderItems
                : null;
            const sortable = [];
            if (explicitDrawOrder) {
                for (let i = 0; i < explicitDrawOrder.length; i++) {
                    const rec = explicitDrawOrder[i];
                    if (!rec || !rec.item || !rec.displayObj) continue;
                    const item = rec.item;
                    const displayObj = rec.displayObj;
                    const forceInclude = !!rec.forceInclude;
                    if (item.gone || item.vanishing) continue;
                    if (!displayObj.parent) continue;
                    if (!forceInclude && !displayObj.visible) continue;
                    sortable.push({ item, displayObj, idx: i });
                }
            } else {
                const items = Array.isArray(onscreenObjects)
                    ? onscreenObjects
                    : ((onscreenObjects && typeof onscreenObjects[Symbol.iterator] === "function")
                        ? onscreenObjects
                        : []);
                let i = 0;
                for (const item of items) {
                    const idx = i++;
                    if (!item || item.gone || item.vanishing) continue;
                    const displayObj = this.getTargetDisplayObject(item, ctx);
                    if (!displayObj || !displayObj.parent || !displayObj.visible) continue;
                    let childIndex = idx;
                    try {
                        childIndex = displayObj.parent.getChildIndex(displayObj);
                    } catch (_err) {
                        childIndex = idx;
                    }
                    sortable.push({ item, displayObj, childIndex, idx });
                }
                sortable.sort((a, b) => {
                    if (a.displayObj.parent === b.displayObj.parent && a.childIndex !== b.childIndex) {
                        return a.childIndex - b.childIndex;
                    }
                    return a.idx - b.idx;
                });
            }

            for (let i = 0; i < sortable.length; i++) {
                const item = sortable[i].item;
                const displayObj = sortable[i].displayObj;
                const id = this.ensureObjectPickerId(item);
                if (!id) continue;
                const rgb = this.idToRgb(id);
                const record = this.ensurePickProxyForDisplayObject(item, displayObj);
                if (!record) continue;
                if (!this.syncPickProxyFromDisplayObject(record, displayObj, rgb)) continue;
                this.pickContainer.addChild(record.proxy);
                this.pickProxiesActiveThisFrame.add(record);
                this.pickEntriesThisFrame.push({ item, displayObj, record, rgb });
            }

            try {
                // PIXI render signatures vary by major version; match the proven compatibility
                // pattern used elsewhere in this project so we always render into the RT.
                renderer.render({
                    container: this.pickContainer,
                    target: this.pickRenderTexture,
                    clear: true
                });
            } catch (_err) {
                try {
                    renderer.render(this.pickContainer, this.pickRenderTexture, true);
                } catch (_err2) {
                    // Keep picker resilient: failed pass should not break main rendering.
                }
            }
        }

        refreshCachedPickAtScreenPoint(screenX, screenY, frameCount = null) {
            const x = Math.floor(screenX);
            const y = Math.floor(screenY);
            const fallbackFrame = Number.isFinite(global.frameCount) ? Number(global.frameCount) : NaN;
            const frameSource = Number.isFinite(frameCount) ? Number(frameCount) : fallbackFrame;
            const hasFrame = Number.isFinite(frameSource);
            const frame = hasFrame ? Math.floor(frameSource) : -1;
            const readbackIntervalFrames = Math.max(
                1,
                Number.isFinite(global.renderer2PickerReadbackIntervalFrames)
                    ? Number(global.renderer2PickerReadbackIntervalFrames)
                    : 2
            );
            if (
                hasFrame &&
                x === this.latestPickX &&
                y === this.latestPickY &&
                this.latestPickFrame === frame
            ) {
                return;
            }
            if (
                hasFrame &&
                x === this.latestPickX &&
                y === this.latestPickY &&
                this.lastReadbackFrame >= 0 &&
                (frame - this.lastReadbackFrame) < readbackIntervalFrames
            ) {
                return;
            }
            const picked = this.getObjectAtPickPixel(x, y);
            this.latestPickFrame = frame;
            this.latestPickX = x;
            this.latestPickY = y;
            this.latestPickObject = picked || null;
            this.lastReadbackFrame = hasFrame ? frame : -1;
        }

        pickObjectAtScreenPoint(screenX, screenY, options = null) {
            const x = Math.floor(screenX);
            const y = Math.floor(screenY);
            let picked = null;
            if (this.latestPickX === x && this.latestPickY === y) {
                picked = this.latestPickObject || null;
            } else if (global.renderer2PickerAllowSyncReadback === true) {
                picked = this.getObjectAtPickPixel(x, y);
            }
            if (!picked) return null;
            const opts = options && typeof options === "object" ? options : {};
            if (opts && typeof opts.filter === "function") {
                if (!opts.filter(picked)) return null;
            }
            return picked;
        }

        drawHitboxOverlay(target, ctx, pulse) {
            const g = this.highlightGraphics;
            if (!g || !target || !target.hitbox && !target.visualHitbox && !target.groundPlaneHitbox) return false;
            const hitbox = target.visualHitbox || target.groundPlaneHitbox || target.hitbox || null;
            if (!hitbox) return false;
            const camera = ctx && ctx.camera;
            if (!camera || typeof camera.worldToScreen !== "function") return false;

            g.clear();
            g.lineStyle(2, 0x66c2ff, Math.max(0.2, 0.55 * pulse));
            g.beginFill(0x66c2ff, 0.12 * pulse);

            let drew = false;
            if (
                hitbox.type === "circle" &&
                Number.isFinite(hitbox.x) &&
                Number.isFinite(hitbox.y) &&
                Number.isFinite(hitbox.radius)
            ) {
                const p = camera.worldToScreen(hitbox.x, hitbox.y, 0);
                g.drawEllipse(
                    p.x,
                    p.y,
                    hitbox.radius * camera.viewscale,
                    hitbox.radius * camera.viewscale * camera.xyratio
                );
                drew = true;
            } else if (Array.isArray(hitbox.points) && hitbox.points.length >= 3) {
                for (let i = 0; i < hitbox.points.length; i++) {
                    const pt = hitbox.points[i];
                    if (!pt) continue;
                    const p = camera.worldToScreen(Number(pt.x) || 0, Number(pt.y) || 0, 0);
                    if (i === 0) g.moveTo(p.x, p.y);
                    else g.lineTo(p.x, p.y);
                }
                g.closePath();
                drew = true;
            }

            g.endFill();
            g.visible = drew;
            return drew;
        }

        getTargetDisplayObject(target, ctx) {
            if (!target) return null;
            if (ctx && typeof ctx.getDisplayObjectForItem === "function") {
                const displayObj = ctx.getDisplayObjectForItem(target);
                if (displayObj) return displayObj;
            }
            if (target.pixiSprite && target.pixiSprite.parent) return target.pixiSprite;
            return null;
        }

        renderHoverHighlight(ctx) {
            this.ensureObjects();
            this.hideAll();

            const wizard = ctx && ctx.wizard;
            const spellSystem = (ctx && ctx.spellSystem) || null;
            const mousePos = (ctx && ctx.mousePos) || global.mousePos || null;
            const uiLayer = ctx && ctx.uiLayer;
            const showPickerScreen = (typeof global.renderer2ShowPickerScreen === "boolean")
                ? !!global.renderer2ShowPickerScreen
                : !!global.renderingShowPickerScreen;
            const currentSpell = (wizard && typeof wizard.currentSpell === "string")
                ? wizard.currentSpell
                : "";
            const spellNeedsHoverTarget = (
                currentSpell === "wall" ||
                currentSpell === "buildroad" ||
                currentSpell === "firewall" ||
                currentSpell === "vanish" ||
                currentSpell === "placeobject"
            );
            let target = null;
            const canResolveTarget = !!(
                wizard &&
                spellSystem &&
                typeof spellSystem.isValidHoverTargetForCurrentSpell === "function" &&
                mousePos &&
                Number.isFinite(mousePos.screenX) &&
                Number.isFinite(mousePos.screenY) &&
                spellNeedsHoverTarget
            );
            const needsPickPass = !!(showPickerScreen || canResolveTarget);
            if (!needsPickPass) {
                this.renderPickerScreenPreview(ctx || {});
                return;
            }

            let onscreenObjectsRef = [];
            if (global.onscreenObjects instanceof Set) {
                // Hot path: avoid calling global.getOnscreenObjects() because it allocates
                // a fresh Array.from(...) every frame. Build pick pass directly from the Set.
                onscreenObjectsRef = global.onscreenObjects;
            } else if (typeof global.getOnscreenObjects === "function") {
                onscreenObjectsRef = global.getOnscreenObjects();
            } else if (Array.isArray(global.onscreenObjects)) {
                onscreenObjectsRef = global.onscreenObjects;
            }

            this.buildPickPass(ctx || {}, onscreenObjectsRef);
            if (mousePos && Number.isFinite(mousePos.screenX) && Number.isFinite(mousePos.screenY)) {
                this.refreshCachedPickAtScreenPoint(
                    mousePos.screenX,
                    mousePos.screenY,
                    (ctx && ctx.frameCount)
                );
            }
            if (canResolveTarget) {
                const hovered = this.pickObjectAtScreenPoint(mousePos.screenX, mousePos.screenY) || null;
                if (
                    hovered &&
                    spellSystem.isValidHoverTargetForCurrentSpell(
                        wizard,
                        hovered,
                        mousePos.worldX,
                        mousePos.worldY
                    )
                ) {
                    target = hovered;
                }
            }
            if (showPickerScreen && target && !target.gone && !target.vanishing) {
                this.applyPickerPreviewHighlight(target);
            }
            this.renderPickerScreenPreview(ctx || {});
            if (!wizard || !uiLayer) return;
            if (!canResolveTarget) return;
            if (!target || target.gone || target.vanishing) return;
            const pulse = this.getPulse((ctx && ctx.frameCount) || global.frameCount || 0);
            const targetDisplay = this.getTargetDisplayObject(target, ctx);
            if (!targetDisplay) {
                return;
            }
            this.applyTintHighlight(targetDisplay, pulse);
        }
    }

    global.Renderer2ScenePicker = Renderer2ScenePicker;
    global.RenderingScenePicker = Renderer2ScenePicker;
})(typeof globalThis !== "undefined" ? globalThis : window);
