(function attachRenderingScenePicker(global) {
    const PICK_READBACK_HZ = 30;
    const PICK_READBACK_MIN_FRAME_DELAY = 1;
    const PICK_RENDER_BASE_SCALE = 0.5;
    const PICK_RENDER_DEBUG_SCALE = 1;
    const PICK_PREVIEW_BLACK_KEY_FS = `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uBlackCutoff;
void main(void) {
    vec4 c = texture2D(uSampler, vTextureCoord);
    float m = max(max(c.r, c.g), c.b);
    float a = (m <= uBlackCutoff) ? 0.0 : c.a;
    gl_FragColor = vec4(c.rgb, a);
}
`;
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
uniform vec2 uWorldSize;
uniform vec2 uWrapEnabled;
uniform vec2 uWrapAnchorWorld;
varying vec2 vUvs;
void main(void) {
    float anchorDx = uWrapAnchorWorld.x - uCameraWorld.x;
    float anchorDy = uWrapAnchorWorld.y - uCameraWorld.y;
    if (uWrapEnabled.x > 0.5 && uWorldSize.x > 0.0) {
        anchorDx = mod(anchorDx + 0.5 * uWorldSize.x, uWorldSize.x);
        if (anchorDx < 0.0) anchorDx += uWorldSize.x;
        anchorDx -= 0.5 * uWorldSize.x;
    }
    if (uWrapEnabled.y > 0.5 && uWorldSize.y > 0.0) {
        anchorDy = mod(anchorDy + 0.5 * uWorldSize.y, uWorldSize.y);
        if (anchorDy < 0.0) anchorDy += uWorldSize.y;
        anchorDy -= 0.5 * uWorldSize.y;
    }
    float localDx = aWorldPosition.x - uWrapAnchorWorld.x;
    float localDy = aWorldPosition.y - uWrapAnchorWorld.y;
    float camDx = anchorDx + localDx;
    float camDy = anchorDy + localDy;
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
    const PICK_LOCAL_DEPTH_MESH_VS = `
precision mediump float;
attribute vec2 aVertexPosition;
attribute vec3 aDepthWorld;
attribute vec2 aUvs;
uniform vec2 uScreenSize;
uniform vec2 uCameraWorld;
uniform float uViewScale;
uniform float uXyRatio;
uniform vec2 uDepthRange;
uniform vec3 uModelOrigin;
uniform vec2 uWorldSize;
uniform vec2 uWrapEnabled;
uniform vec2 uWrapAnchorWorld;
varying vec2 vUvs;
float shortestDelta(float fromV, float toV, float sizeV, float wrapEnabled) {
    if (wrapEnabled < 0.5 || sizeV <= 0.0) return toV - fromV;
    float d = toV - fromV;
    float halfSize = sizeV * 0.5;
    if (d > halfSize) d -= sizeV;
    else if (d < -halfSize) d += sizeV;
    return d;
}
void main(void) {
    float anchorWrappedX = uWrapAnchorWorld.x + shortestDelta(uWrapAnchorWorld.x, uModelOrigin.x, uWorldSize.x, uWrapEnabled.x);
    float anchorWrappedY = uWrapAnchorWorld.y + shortestDelta(uWrapAnchorWorld.y, uModelOrigin.y, uWorldSize.y, uWrapEnabled.y);
    float anchorCamDx = shortestDelta(uCameraWorld.x, anchorWrappedX, uWorldSize.x, uWrapEnabled.x);
    float anchorCamDy = shortestDelta(uCameraWorld.y, anchorWrappedY, uWorldSize.y, uWrapEnabled.y);
    float screenX = anchorCamDx * uViewScale + aVertexPosition.x * uViewScale;
    float screenY = (anchorCamDy - uModelOrigin.z) * uViewScale * uXyRatio + aVertexPosition.y * uViewScale;

    float worldY = uModelOrigin.y + aDepthWorld.y;
    float worldZ = uModelOrigin.z + aDepthWorld.z;
    float wrappedY = uWrapAnchorWorld.y + shortestDelta(uWrapAnchorWorld.y, worldY, uWorldSize.y, uWrapEnabled.y);
    float camDy = shortestDelta(uCameraWorld.y, wrappedY, uWorldSize.y, uWrapEnabled.y);
    float camDz = worldZ;

    float sx = max(1.0, uScreenSize.x);
    float sy = max(1.0, uScreenSize.y);
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

    class RenderingScenePicker {
        constructor() {
            this.highlightSprite = null;
            this.highlightMesh = null;
            this.highlightGraphics = null;
            this.pickerGroundHitboxGraphics = null;
            this.objectIdByObject = new WeakMap();
            this.objectById = new Map();
            this.pickContainer = new PIXI.Container();
            this.pickContainer.name = "renderingPickerContainer";
            this.pickPreviewSprite = null;
            this.pickPreviewBlackKeyFilter = null;
            this.pickBackgroundSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
            this.pickBackgroundSprite.name = "renderingPickerBackground";
            this.pickBackgroundSprite.tint = 0x000000;
            this.pickBackgroundSprite.alpha = 1;
            this.pickBackgroundSprite.interactive = false;
            this.pickBackgroundSprite.visible = true;
            this.pickRenderTexture = null;
            this.pickRenderer = null;
            this.pickPixelReadMode = null;
            this.pickPendingReadback = null;
            this.pickReadbackIntervalMs = PICK_READBACK_HZ > 0 ? (1000 / PICK_READBACK_HZ) : Infinity;
            this.pickLastReadbackSubmitAtMs = -Infinity;
            this.pickLastReadbackScreenX = NaN;
            this.pickLastReadbackScreenY = NaN;
            this.pickReadbackFenceSupported = true;
            this.pickProxyByObject = new WeakMap();
            this.pickProxiesActiveThisFrame = new Set();
            this.pickEntriesThisFrame = [];
            this.pickPixelScratch = new Uint8Array(4);
            this.latestPickFrame = -1;
            this.latestPickX = 0;
            this.latestPickY = 0;
            this.latestPickObject = null;
            this.latestPickId = 0;
            this.latestPickColor = new Uint8Array(4);
            this.pickLastCamera = null;
            this.pickLastDepthRange = null;
            this.pickRenderScale = PICK_RENDER_BASE_SCALE;
            this.idAssignmentSalt = Math.floor(Math.random() * 0x7fffffff);
            this.activeTintStates = new Map();
            this.hoverProfiler = {
                startMs: null,
                deadlineMs: null,
                frameCount: 0,
                totalFrameMs: 0,
                maxFrameMs: 0,
                sections: Object.create(null),
                printed: false
            };
            this.publicApi = {
                getHoveredObject: (options = null) => this.getHoveredObject(options)
            };
            global.renderingScenePicker = this.publicApi;
        }

        isDebugModeEnabled() {
            return !!(
                (typeof debugMode !== "undefined" && debugMode) ||
                global.debugMode
            );
        }

        getPickRenderScale(showPickerScreen = false) {
            if (showPickerScreen && this.isDebugModeEnabled()) {
                return PICK_RENDER_DEBUG_SCALE;
            }
            return PICK_RENDER_BASE_SCALE;
        }

        ensureObjects() {
            if (!this.highlightSprite) {
                this.highlightSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
                this.highlightSprite.name = "renderingHoverHighlightSprite";
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
                this.highlightMesh.name = "renderingHoverHighlightMesh";
                this.highlightMesh.visible = false;
                this.highlightMesh.interactive = false;
                this.highlightMesh.blendMode = PIXI.BLEND_MODES.ADD;
            }
            if (!this.highlightGraphics) {
                this.highlightGraphics = new PIXI.Graphics();
                this.highlightGraphics.name = "renderingHoverHighlightGraphics";
                this.highlightGraphics.visible = false;
                this.highlightGraphics.interactive = false;
                this.highlightGraphics.blendMode = PIXI.BLEND_MODES.ADD;
            }
            if (!this.pickerGroundHitboxGraphics) {
                this.pickerGroundHitboxGraphics = new PIXI.Graphics();
                this.pickerGroundHitboxGraphics.name = "renderingPickerGroundHitboxGraphics";
                this.pickerGroundHitboxGraphics.visible = false;
                this.pickerGroundHitboxGraphics.interactive = false;
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
            if (this.pickerGroundHitboxGraphics) {
                this.pickerGroundHitboxGraphics.clear();
                this.pickerGroundHitboxGraphics.visible = false;
                if (this.pickerGroundHitboxGraphics.parent) {
                    this.pickerGroundHitboxGraphics.parent.removeChild(this.pickerGroundHitboxGraphics);
                }
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
            if (!(this.activeTintStates instanceof Map) || this.activeTintStates.size === 0) return;
            this.activeTintStates.forEach((state, target) => {
                if (!target || !state || target.destroyed) return;
                if (state.hasTintProp && Number.isFinite(state.tint)) {
                    try {
                        target.tint = state.tint;
                    } catch (_err) {
                        // Display object may have been partially destroyed.
                    }
                }
                if (state.hasAlphaProp && Number.isFinite(state.alpha)) {
                    try {
                        target.alpha = state.alpha;
                    } catch (_err) {
                        // Ignore teardown race during cleanup.
                    }
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
            });
            this.activeTintStates.clear();
        }

        applyTintHighlight(targetDisplay, pulse) {
            if (!targetDisplay || targetDisplay.destroyed) return false;
            const hasTintProp = Number.isFinite(targetDisplay.tint);
            const hasAlphaProp = Number.isFinite(targetDisplay.alpha);
            if (!hasTintProp && !(targetDisplay.shader && targetDisplay.shader.uniforms && targetDisplay.shader.uniforms.uTint)) {
                return false;
            }
            const baseTint = hasTintProp ? Number(targetDisplay.tint) : 0xFFFFFF;
            const blendAmount = 0.25 + 0.15 * Math.max(0, Math.min(1, Number(pulse) || 0));
            const nextTint = this.blendTintToward(baseTint, 0x66c2ff, blendAmount);
            const existingState = (this.activeTintStates instanceof Map)
                ? (this.activeTintStates.get(targetDisplay) || null)
                : null;
            const state = {
                hasTintProp,
                hasAlphaProp,
                tint: existingState && Number.isFinite(existingState.tint)
                    ? Number(existingState.tint)
                    : (hasTintProp ? Number(targetDisplay.tint) : null),
                alpha: existingState && Number.isFinite(existingState.alpha)
                    ? Number(existingState.alpha)
                    : (hasAlphaProp ? Number(targetDisplay.alpha) : null),
                shaderTintOriginal: null
            };
            if (hasTintProp) {
                try {
                    targetDisplay.tint = nextTint;
                } catch (_err) {
                    state.hasTintProp = false;
                }
            }
            if (targetDisplay.shader && targetDisplay.shader.uniforms && targetDisplay.shader.uniforms.uTint) {
                const u = targetDisplay.shader.uniforms.uTint;
                if (u && typeof u.length === "number" && u.length >= 4) {
                    state.shaderTintOriginal = existingState && Array.isArray(existingState.shaderTintOriginal)
                        ? existingState.shaderTintOriginal.slice()
                        : [
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
            this.activeTintStates.set(targetDisplay, state);
            return true;
        }

        applyTintHighlightForTarget(target, ctx, pulse) {
            if (!target || target.gone || target.vanishing) return false;
            if (target.type === "triggerArea" || target.isTriggerArea === true) {
                const debugEnabled = !!(
                    (typeof debugMode !== "undefined" && debugMode) ||
                    global.debugMode
                );
                if (!debugEnabled) return false;
                return this.drawHitboxOverlay(target, ctx, pulse);
            }
            const display = this.getTargetDisplayObject(target, ctx);
            if (!display) return false;
            if (target.type === "roof" && typeof PIXI !== "undefined" && display instanceof PIXI.Container) {
                const children = Array.isArray(display.children) ? display.children : [];
                let applied = false;
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    if (!child || child.destroyed || !child.visible) continue;
                    if (!(child instanceof PIXI.Mesh) && !(child instanceof PIXI.Sprite)) continue;
                    if (this.applyTintHighlight(child, pulse)) {
                        applied = true;
                    }
                }
                return applied;
            }
            return this.applyTintHighlight(display, pulse);
        }

        drawVanishWallChunkVolume(g, camera, target, preview, pulse) {
            if (!g || !camera || typeof camera.worldToScreen !== "function") return false;
            if (!target || target.gone || target.vanishing) return false;
            const points = preview && Array.isArray(preview.points) ? preview.points : null;
            if (!points || points.length < 3) return false;

            const bottomZ = Number.isFinite(preview && preview.z)
                ? Number(preview.z)
                : ((Number.isFinite(target.bottomZ) ? Number(target.bottomZ) : 0) + 0.001);
            const wallHeight = Number.isFinite(target.height) ? Math.max(0.01, Number(target.height)) : 1;
            const topZ = bottomZ + wallHeight;
            const sideAlpha = Math.max(0.12, 0.22 * pulse);
            const topAlpha = Math.max(0.18, 0.32 * pulse);
            const mapRef = target.map || null;

            const validPoints = [];
            for (let i = 0; i < points.length; i++) {
                const pt = points[i];
                if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
                validPoints.push({ x: Number(pt.x), y: Number(pt.y) });
            }
            if (validPoints.length < 3) return false;

            let drew = false;

            const edgeLength = (a, b) => {
                if (!a || !b) return 0;
                const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(a.x, b.x)
                    : (b.x - a.x);
                const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(a.y, b.y)
                    : (b.y - a.y);
                return Math.hypot(dx, dy);
            };

            // For wall previews (rectangles), draw only the visible long side.
            if (validPoints.length >= 4) {
                const n = validPoints.length;
                const edge = (idx) => {
                    const i = ((idx % n) + n) % n;
                    const j = (i + 1) % n;
                    const a = validPoints[i];
                    const b = validPoints[j];
                    const len = edgeLength(a, b);
                    const ab = camera.worldToScreen(a.x, a.y, bottomZ);
                    const bb = camera.worldToScreen(b.x, b.y, bottomZ);
                    const at = camera.worldToScreen(a.x, a.y, topZ);
                    const bt = camera.worldToScreen(b.x, b.y, topZ);
                    const avgY = (ab && bb) ? ((ab.y + bb.y) * 0.5) : -Infinity;
                    return { a, b, len, ab, bb, at, bt, avgY };
                };

                const e0 = edge(0);
                const e1 = edge(1);
                const e2 = edge(2);
                const e3 = edge(3);
                const edges = [e0, e1, e2, e3];
                let pairA = null;

                const start = target.startPoint;
                const end = target.endPoint;
                if (
                    start &&
                    end &&
                    Number.isFinite(start.x) &&
                    Number.isFinite(start.y) &&
                    Number.isFinite(end.x) &&
                    Number.isFinite(end.y)
                ) {
                    const wallDx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                        ? mapRef.shortestDeltaX(Number(start.x), Number(end.x))
                        : (Number(end.x) - Number(start.x));
                    const wallDy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                        ? mapRef.shortestDeltaY(Number(start.y), Number(end.y))
                        : (Number(end.y) - Number(start.y));
                    const wallLen = Math.hypot(wallDx, wallDy);
                    if (wallLen > 1e-6) {
                        const wallUx = wallDx / wallLen;
                        const wallUy = wallDy / wallLen;
                        const ranked = [];
                        for (let i = 0; i < edges.length; i++) {
                            const seg = edges[i];
                            if (!seg || !seg.a || !seg.b) continue;
                            const edx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                                ? mapRef.shortestDeltaX(Number(seg.a.x), Number(seg.b.x))
                                : (Number(seg.b.x) - Number(seg.a.x));
                            const edy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                                ? mapRef.shortestDeltaY(Number(seg.a.y), Number(seg.b.y))
                                : (Number(seg.b.y) - Number(seg.a.y));
                            const elen = Math.hypot(edx, edy);
                            if (elen <= 1e-6) continue;
                            const align = Math.abs((edx / elen) * wallUx + (edy / elen) * wallUy);
                            ranked.push({ seg, align });
                        }
                        ranked.sort((a, b) => b.align - a.align);
                        if (ranked.length >= 2) {
                            pairA = [ranked[0].seg, ranked[1].seg];
                        }
                    }
                }

                if (!pairA) {
                    pairA = (e0.len + e2.len) >= (e1.len + e3.len) ? [e0, e2] : [e1, e3];
                }
                const front = pairA[0].avgY >= pairA[1].avgY ? pairA[0] : pairA[1];
                const back = pairA[0] === front ? pairA[1] : pairA[0];

                // If side is effectively edge-on, skip side face entirely.
                if (
                    front && front.ab && front.bb && front.at && front.bt &&
                    Number.isFinite(front.avgY) && Number.isFinite(back.avgY) &&
                    Math.abs(front.avgY - back.avgY) > 0.5
                ) {
                    g.beginFill(0x66c2ff, sideAlpha);
                    g.moveTo(front.ab.x, front.ab.y);
                    g.lineTo(front.bb.x, front.bb.y);
                    g.lineTo(front.bt.x, front.bt.y);
                    g.lineTo(front.at.x, front.at.y);
                    g.closePath();
                    g.endFill();
                    drew = true;
                }
            }

            let startedTop = false;
            g.beginFill(0x66c2ff, topAlpha);
            for (let i = 0; i < validPoints.length; i++) {
                const pt = validPoints[i];
                const top = camera.worldToScreen(pt.x, pt.y, topZ);
                if (!top) continue;
                if (!startedTop) {
                    g.moveTo(top.x, top.y);
                    startedTop = true;
                } else {
                    g.lineTo(top.x, top.y);
                }
            }
            if (startedTop) {
                g.closePath();
                drew = true;
            }
            g.endFill();
            return drew;
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
            const show = !!global.renderingShowPickerScreen;
            if (!uiLayer) return;
            if (!this.pickPreviewSprite) {
                this.pickPreviewSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
                this.pickPreviewSprite.name = "renderingPickerPreviewSprite";
                this.pickPreviewSprite.interactive = false;
                this.pickPreviewSprite.visible = false;
                this.pickPreviewSprite.alpha = 1;
                if (typeof PIXI !== "undefined" && typeof PIXI.Filter === "function") {
                    this.pickPreviewBlackKeyFilter = new PIXI.Filter(
                        undefined,
                        PICK_PREVIEW_BLACK_KEY_FS,
                        { uBlackCutoff: 0.02 }
                    );
                    this.pickPreviewSprite.filters = [this.pickPreviewBlackKeyFilter];
                }
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
            }
        }

        renderPickerGroundHitboxOutlines(camera, onscreenObjects) {
            if (!camera || typeof camera.worldToScreen !== "function") return false;
            if (!this.pickerGroundHitboxGraphics) this.ensureObjects();
            const g = this.pickerGroundHitboxGraphics;
            if (!g) return false;

            const items = Array.isArray(onscreenObjects)
                ? onscreenObjects
                : ((onscreenObjects && typeof onscreenObjects[Symbol.iterator] === "function")
                    ? Array.from(onscreenObjects)
                    : []);
            g.clear();
            g.visible = true;
            let drewAny = false;
            for (let i = 0; i < items.length; i++) {
                const obj = items[i];
                if (!obj || obj.gone || obj.vanishing) continue;
                const hitbox = obj.groundPlaneHitbox;
                if (!hitbox) continue;
                const isTriggerArea = !!(obj.type === "triggerArea" || obj.isTriggerArea === true);
                const isCircle = (
                    hitbox.type === "circle" &&
                    Number.isFinite(hitbox.x) &&
                    Number.isFinite(hitbox.y) &&
                    Number.isFinite(hitbox.radius)
                );
                if (isCircle) {
                    g.lineStyle(2, isTriggerArea ? 0xffff00 : 0xffffff, 1);
                    const center = camera.worldToScreen(hitbox.x, hitbox.y, 0);
                    const rx = hitbox.radius * camera.viewscale;
                    const ry = hitbox.radius * camera.viewscale * camera.xyratio;
                    g.drawEllipse(center.x, center.y, rx, ry);
                    drewAny = true;
                    continue;
                }
                const points = Array.isArray(hitbox.points) ? hitbox.points : null;
                if (!points || points.length < 2) continue;
                const screenPoints = [];
                for (let p = 0; p < points.length; p++) {
                    const point = points[p];
                    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
                    const screenPoint = camera.worldToScreen(point.x, point.y, 0);
                    if (!screenPoint || !Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) continue;
                    screenPoints.push(screenPoint);
                }
                if (screenPoints.length < 2) continue;
                if (isTriggerArea) {
                    const dashLengthPx = 10;
                    const gapLengthPx = 6;
                    g.lineStyle(3, 0xffff00, 1);
                    for (let p = 0; p < screenPoints.length; p++) {
                        const a = screenPoints[p];
                        const b = screenPoints[(p + 1) % screenPoints.length];
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
                            dist += dashLengthPx + gapLengthPx;
                        }
                    }
                    const wizardRef = (typeof globalThis !== "undefined" && globalThis.wizard) ? globalThis.wizard : null;
                    const spellSystemRef = (typeof SpellSystem !== "undefined")
                        ? SpellSystem
                        : ((typeof globalThis !== "undefined" && globalThis.SpellSystem) ? globalThis.SpellSystem : null);
                    const triggerEditActive = !!(
                        wizardRef &&
                        (
                            wizardRef.currentSpell === "triggerarea" ||
                            wizardRef.selectedSpellName === "triggerarea"
                        )
                    );
                    const selection = (
                        triggerEditActive &&
                        spellSystemRef &&
                        typeof spellSystemRef.getTriggerAreaVertexSelection === "function"
                    )
                        ? spellSystemRef.getTriggerAreaVertexSelection(wizardRef)
                        : null;
                    if (triggerEditActive) {
                        g.lineStyle(2, 0xffffff, 1);
                        for (let p = 0; p < screenPoints.length; p++) {
                            const sp = screenPoints[p];
                            const isSelected = !!(
                                selection &&
                                selection.area === obj &&
                                selection.vertexIndex === p
                            );
                            g.drawCircle(sp.x, sp.y, isSelected ? 10 : 3);
                        }
                    }
                } else {
                    g.lineStyle(2, 0xffffff, 1);
                    g.moveTo(screenPoints[0].x, screenPoints[0].y);
                    for (let p = 1; p < screenPoints.length; p++) {
                        const screenPoint = screenPoints[p];
                        g.lineTo(screenPoint.x, screenPoint.y);
                    }
                    g.closePath();
                }
                drewAny = true;
            }
            g.visible = drewAny;
            return drewAny;
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

        getObjectAtPickPixel(screenX, screenY, renderTexture = null) {
            const sourceTexture = renderTexture || this.pickRenderTexture;
            if (!sourceTexture || !Number.isFinite(screenX) || !Number.isFinite(screenY)) {
                return { object: null, id: 0, color: this.pickPixelScratch };
            }
            const renderer = this.pickRenderer || (global.app && global.app.renderer ? global.app.renderer : null);
            if (!renderer) {
                return { object: null, id: 0, color: this.pickPixelScratch };
            }
            const x = Math.floor(screenX);
            const y = Math.floor(screenY);
            const width = Number(sourceTexture.width) || 0;
            const height = Number(sourceTexture.height) || 0;
            if (x < 0 || y < 0 || x >= width || y >= height) {
                return { object: null, id: 0, color: this.pickPixelScratch };
            }
            const tryReadDirectWebGL = () => {
                const gl = renderer.gl;
                const rt = sourceTexture;
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
                return { object: null, id: 0, color: this.pickPixelScratch };
            }
            this.pickPixelScratch[0] = pixels[0];
            this.pickPixelScratch[1] = pixels[1];
            this.pickPixelScratch[2] = pixels[2];
            this.pickPixelScratch[3] = pixels[3];
            const id = this.rgbToId(this.pickPixelScratch[0], this.pickPixelScratch[1], this.pickPixelScratch[2]);
            return {
                object: this.getObjectForColor(this.pickPixelScratch),
                id,
                color: this.pickPixelScratch
            };
        }

        cleanupPickReadbackRequest(req) {
            if (!req) return;
            const renderer = this.pickRenderer || (global.app && global.app.renderer ? global.app.renderer : null);
            const gl = renderer && renderer.gl ? renderer.gl : null;
            if (req.fence && gl && typeof gl.deleteSync === "function") {
                try {
                    gl.deleteSync(req.fence);
                } catch (_err) {
                    // Ignore cleanup races.
                }
            }
            req.fence = null;
        }

        clearPendingPickReadbacks() {
            if (this.pickPendingReadback) {
                this.cleanupPickReadbackRequest(this.pickPendingReadback);
                this.pickPendingReadback = null;
            }
        }

        ensurePickRenderTargets(screenWidth, screenHeight) {
            const width = Math.max(1, Math.round(Number(screenWidth) || 1));
            const height = Math.max(1, Math.round(Number(screenHeight) || 1));
            const needsRebuild = !!(
                !this.pickRenderTexture ||
                this.pickRenderTexture.width !== width ||
                this.pickRenderTexture.height !== height
            );
            if (!needsRebuild) return;

            this.clearPendingPickReadbacks();
            if (this.pickRenderTexture) {
                this.pickRenderTexture.destroy(true);
            }
            this.pickRenderTexture = PIXI.RenderTexture.create({
                width,
                height,
                resolution: 1
            });
            const baseTex = this.pickRenderTexture.baseTexture || null;
            if (baseTex) {
                if (typeof PIXI !== "undefined" && PIXI.SCALE_MODES) {
                    baseTex.scaleMode = PIXI.SCALE_MODES.NEAREST;
                }
                if (typeof PIXI !== "undefined" && PIXI.MIPMAP_MODES) {
                    baseTex.mipmap = PIXI.MIPMAP_MODES.OFF;
                } else if (Object.prototype.hasOwnProperty.call(baseTex, "mipmap")) {
                    baseTex.mipmap = false;
                }
                if (Object.prototype.hasOwnProperty.call(baseTex, "anisotropicLevel")) {
                    baseTex.anisotropicLevel = 0;
                }
                if (typeof baseTex.update === "function") {
                    baseTex.update();
                }
            }
            const fb = this.pickRenderTexture.framebuffer
                ? this.pickRenderTexture.framebuffer
                : (baseTex && baseTex.framebuffer ? baseTex.framebuffer : null);
            if (fb && Object.prototype.hasOwnProperty.call(fb, "multisample")) {
                if (typeof PIXI !== "undefined" && Object.prototype.hasOwnProperty.call(PIXI, "MSAA_QUALITY")) {
                    fb.multisample = PIXI.MSAA_QUALITY.NONE;
                } else {
                    fb.multisample = 0;
                }
            }
        }

        acquirePickRenderTexture() {
            return this.pickRenderTexture || null;
        }

        shouldSubmitPickReadbackRequest(screenX, screenY) {
            if (!this.pickReadbackFenceSupported) return false;
            if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return false;
            if (this.pickPendingReadback) return false;
            const nowMs = performance.now();
            return (nowMs - this.pickLastReadbackSubmitAtMs) >= this.pickReadbackIntervalMs;
        }

        submitPickReadbackRequest(screenX, screenY, frameCount = null) {
            if (!this.pickRenderTexture) return false;
            if (!this.pickReadbackFenceSupported) return false;
            if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return false;
            if (this.pickPendingReadback) return false;
            const renderer = this.pickRenderer || (global.app && global.app.renderer ? global.app.renderer : null);
            const gl = renderer && renderer.gl ? renderer.gl : null;
            let fence = null;
            if (gl && typeof gl.fenceSync === "function" && typeof gl.flush === "function") {
                try {
                    fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
                    gl.flush();
                } catch (_err) {
                    fence = null;
                }
            }
            if (!fence) {
                this.pickReadbackFenceSupported = false;
                return false;
            }
            const frame = Number.isFinite(frameCount) ? Math.floor(Number(frameCount)) : -1;
            const texW = Math.max(1, Math.floor(Number(this.pickRenderTexture.width) || 1));
            const texH = Math.max(1, Math.floor(Number(this.pickRenderTexture.height) || 1));
            const renderScale = (Number.isFinite(this.pickRenderScale) && this.pickRenderScale > 0)
                ? this.pickRenderScale
                : PICK_RENDER_BASE_SCALE;
            const rtX = Math.max(0, Math.min(texW - 1, Math.floor(Number(screenX) * renderScale)));
            const rtY = Math.max(0, Math.min(texH - 1, Math.floor(Number(screenY) * renderScale)));
            this.pickPendingReadback = {
                x: rtX,
                y: rtY,
                screenX: Math.floor(screenX),
                screenY: Math.floor(screenY),
                frame,
                renderTexture: this.pickRenderTexture,
                fence,
                submittedAtMs: performance.now()
            };
            this.pickLastReadbackSubmitAtMs = this.pickPendingReadback.submittedAtMs;
            this.pickLastReadbackScreenX = this.pickPendingReadback.screenX;
            this.pickLastReadbackScreenY = this.pickPendingReadback.screenY;
            return true;
        }

        resolvePickReadbackRequests(currentFrame = null) {
            if (!this.pickPendingReadback) return;
            const renderer = this.pickRenderer || (global.app && global.app.renderer ? global.app.renderer : null);
            const gl = renderer && renderer.gl ? renderer.gl : null;
            const req = this.pickPendingReadback;
            const frame = Number.isFinite(currentFrame) ? Math.floor(Number(currentFrame)) : -1;
            if (
                Number.isFinite(req.frame) &&
                req.frame >= 0 &&
                frame >= 0 &&
                (frame - req.frame) < PICK_READBACK_MIN_FRAME_DELAY
            ) {
                return;
            }
            if (!req.fence || !gl || typeof gl.clientWaitSync !== "function") {
                this.cleanupPickReadbackRequest(req);
                this.pickPendingReadback = null;
                this.pickReadbackFenceSupported = false;
                return;
            }
            let waitResult = null;
            try {
                waitResult = gl.clientWaitSync(req.fence, 0, 0);
            } catch (_err) {
                waitResult = null;
            }
            if (waitResult !== gl.ALREADY_SIGNALED && waitResult !== gl.CONDITION_SATISFIED) {
                if (waitResult === gl.WAIT_FAILED) {
                    this.cleanupPickReadbackRequest(req);
                    this.pickPendingReadback = null;
                    this.pickReadbackFenceSupported = false;
                }
                return;
            }

            const sampled = this.getObjectAtPickPixel(req.x, req.y, req.renderTexture);
            this.cleanupPickReadbackRequest(req);
            this.pickPendingReadback = null;
            this.latestPickFrame = req.frame;
            this.latestPickX = Number.isFinite(req.screenX) ? req.screenX : req.x;
            this.latestPickY = Number.isFinite(req.screenY) ? req.screenY : req.y;
            this.latestPickObject = sampled && sampled.object ? sampled.object : null;
            this.latestPickId = sampled && Number.isFinite(sampled.id) ? Number(sampled.id) : 0;
            if (sampled && sampled.color && sampled.color.length >= 4) {
                this.latestPickColor[0] = Number(sampled.color[0]) || 0;
                this.latestPickColor[1] = Number(sampled.color[1]) || 0;
                this.latestPickColor[2] = Number(sampled.color[2]) || 0;
                this.latestPickColor[3] = Number(sampled.color[3]) || 0;
            } else {
                this.latestPickColor[0] = 0;
                this.latestPickColor[1] = 0;
                this.latestPickColor[2] = 0;
                this.latestPickColor[3] = 0;
            }
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
            mesh.name = "renderingPickerSpriteProxyMesh";
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
            const dBuf = safeGetBuffer("aDepthWorld");
            const uvBuf = safeGetBuffer("aUvs");
            if ((!vBuf || !vBuf.data) && (!wBuf || !wBuf.data) && (!dBuf || !dBuf.data)) return null;
            if (!uvBuf || !uvBuf.data) return null;
            const useWorldPositions = !!(wBuf && wBuf.data);
            const useLocalDepthPositions = !!(!useWorldPositions && dBuf && dBuf.data && vBuf && vBuf.data);
            const shader = (useWorldPositions || useLocalDepthPositions)
                ? PIXI.Shader.from(useLocalDepthPositions ? PICK_LOCAL_DEPTH_MESH_VS : PICK_WORLD_MESH_VS, PICK_MESH_FS, {
                    uScreenSize: new Float32Array([1, 1]),
                    uCameraWorld: new Float32Array([0, 0]),
                    uViewScale: 1,
                    uXyRatio: 1,
                    uDepthRange: new Float32Array([0, 1]),
                    uModelOrigin: new Float32Array([0, 0, 0]),
                    uWorldSize: new Float32Array([0, 0]),
                    uWrapEnabled: new Float32Array([0, 0]),
                    uWrapAnchorWorld: new Float32Array([0, 0]),
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
                (() => {
                    const sourceState = sourceMesh.state || null;
                    if (!sourceState || !PIXI.State) {
                        const fallbackState = PIXI.State.for2d();
                        fallbackState.depthTest = true;
                        fallbackState.depthMask = true;
                        return fallbackState;
                    }
                    const state = new PIXI.State();
                    state.blend = sourceState.blend;
                    state.offsets = sourceState.offsets;
                    state.culling = sourceState.culling;
                    state.depthTest = sourceState.depthTest;
                    state.depthMask = sourceState.depthMask;
                    state.clockwiseFrontFace = sourceState.clockwiseFrontFace;
                    state.blendMode = sourceState.blendMode;
                    return state;
                })(),
                sourceMesh.drawMode || PIXI.DRAW_MODES.TRIANGLES
            );
            mesh.name = "renderingPickerMeshProxy";
            mesh.visible = false;
            mesh.interactive = false;
            mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
            return { proxy: mesh, type: "mesh", shader, useWorldPositions: (useWorldPositions || useLocalDepthPositions), useLocalDepthPositions };
        }

        createPickGraphicsProxy() {
            const graphics = new PIXI.Graphics();
            graphics.name = "renderingPickerGraphicsProxy";
            graphics.visible = false;
            graphics.interactive = false;
            graphics.blendMode = PIXI.BLEND_MODES.NORMAL;
            return { proxy: graphics, type: "graphics" };
        }

        ensurePickProxyForDisplayObject(item, displayObj) {
            if (!item || !displayObj) return null;
            // Key proxy records by display object, not logical item.
            // Roofs submit many child meshes for one item and each needs its own proxy.
            let record = this.pickProxyByObject.get(displayObj) || null;
            if (!record) {
                if (item && item.type === "triggerArea") {
                    const created = this.createPickGraphicsProxy();
                    if (!created) return null;
                    record = { ...created, sourceType: PIXI.Graphics };
                } else if (displayObj instanceof PIXI.Sprite) {
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
                this.pickProxyByObject.set(displayObj, record);
            }
            return record;
        }

        syncPickProxyFromDisplayObject(record, displayObj, rgbColor, item = null) {
            if (!record || !record.proxy || !displayObj) return false;
            const proxy = record.proxy;
            if (record.type === "graphics") {
                const camera = this.pickLastCamera || null;
                const points = (
                    item &&
                    item.groundPlaneHitbox &&
                    Array.isArray(item.groundPlaneHitbox.points)
                ) ? item.groundPlaneHitbox.points : null;
                if (!camera || !points || points.length < 3) {
                    proxy.visible = false;
                    return false;
                }
                proxy.clear();
                const colorHex = ((Number(rgbColor[0]) & 255) << 16) |
                    ((Number(rgbColor[1]) & 255) << 8) |
                    (Number(rgbColor[2]) & 255);
                proxy.beginFill(colorHex, 1);
                let moved = false;
                for (let i = 0; i < points.length; i++) {
                    const pt = points[i];
                    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
                    const sp = camera.worldToScreen(Number(pt.x), Number(pt.y), 0);
                    if (!sp || !Number.isFinite(sp.x) || !Number.isFinite(sp.y)) continue;
                    if (!moved) {
                        proxy.moveTo(sp.x, sp.y);
                        moved = true;
                    } else {
                        proxy.lineTo(sp.x, sp.y);
                    }
                }
                if (!moved) {
                    proxy.endFill();
                    proxy.visible = false;
                    return false;
                }
                proxy.closePath();
                proxy.endFill();
                proxy.visible = true;
                proxy.alpha = 1;
                return true;
            }
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
                        const mapRef = (item && item.map) ? item.map : (global.map || null);
                        const anchorX = Number.isFinite(item && item.x)
                            ? Number(item.x)
                            : (Number.isFinite(item && item.center && item.center.x)
                                ? Number(item.center.x)
                                : (
                                    Number.isFinite(item && item.startPoint && item.startPoint.x) &&
                                    Number.isFinite(item && item.endPoint && item.endPoint.x)
                                )
                                    ? (Number(item.startPoint.x) + Number(item.endPoint.x)) * 0.5
                                    : 0);
                        const anchorY = Number.isFinite(item && item.y)
                            ? Number(item.y)
                            : (Number.isFinite(item && item.center && item.center.y)
                                ? Number(item.center.y)
                                : (
                                    Number.isFinite(item && item.startPoint && item.startPoint.y) &&
                                    Number.isFinite(item && item.endPoint && item.endPoint.y)
                                )
                                    ? (Number(item.startPoint.y) + Number(item.endPoint.y)) * 0.5
                                    : 0);
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
                        record.shader.uniforms.uWorldSize[0] = (mapRef && Number.isFinite(mapRef.worldWidth) && mapRef.worldWidth > 0)
                            ? Number(mapRef.worldWidth)
                            : 0;
                        record.shader.uniforms.uWorldSize[1] = (mapRef && Number.isFinite(mapRef.worldHeight) && mapRef.worldHeight > 0)
                            ? Number(mapRef.worldHeight)
                            : 0;
                        record.shader.uniforms.uWrapEnabled[0] = (mapRef && mapRef.wrapX !== false) ? 1 : 0;
                        record.shader.uniforms.uWrapEnabled[1] = (mapRef && mapRef.wrapY !== false) ? 1 : 0;
                        record.shader.uniforms.uWrapAnchorWorld[0] = anchorX;
                        record.shader.uniforms.uWrapAnchorWorld[1] = anchorY;
                        record.shader.uniforms.uViewScale = (Number(camera && camera.viewscale) || 1) * this.pickRenderScale;
                        record.shader.uniforms.uXyRatio = Number(camera && camera.xyratio) || 1;
                        record.shader.uniforms.uDepthRange[0] = Number(depthRange && depthRange.farMetric) || 1;
                        record.shader.uniforms.uDepthRange[1] = Number(depthRange && depthRange.invSpan) || 1;
                        if (
                            record.shader.uniforms.uModelOrigin &&
                            typeof record.shader.uniforms.uModelOrigin.length === "number" &&
                            record.shader.uniforms.uModelOrigin.length >= 3
                        ) {
                            const modelZ = Number.isFinite(item && item.z)
                                ? Number(item.z)
                                : (Number.isFinite(item && item.heightFromGround) ? Number(item.heightFromGround) : 0);
                            record.shader.uniforms.uModelOrigin[0] = Number(item && item.x) || 0;
                            record.shader.uniforms.uModelOrigin[1] = Number(item && item.y) || 0;
                            record.shader.uniforms.uModelOrigin[2] = modelZ;
                        }
                    }
                }
                return true;
            }
            return false;
        }

        ensurePickRenderTextureDepthAttachment() {
            const rt = this.pickRenderTexture;
            if (!rt) return;
            const fb = rt.framebuffer
                ? rt.framebuffer
                : (rt.baseTexture && rt.baseTexture.framebuffer ? rt.baseTexture.framebuffer : null);
            if (!fb) return;
            try {
                if (typeof fb.enableDepth === "function") {
                    fb.enableDepth();
                } else if (Object.prototype.hasOwnProperty.call(fb, "depth")) {
                    fb.depth = true;
                }
            } catch (_err) {
                // Keep picker resilient across PIXI variants.
            }
        }

        buildPickPass(ctx, onscreenObjects) {
            const pickPassStartMs = performance.now();
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
            const setupStartMs = performance.now();
            const screenWidth = Math.max(1, Math.round(Number(app.screen && app.screen.width) || 1));
            const screenHeight = Math.max(1, Math.round(Number(app.screen && app.screen.height) || 1));
            const showPickerScreen = !!global.renderingShowPickerScreen;
            const renderScale = this.getPickRenderScale(showPickerScreen);
            this.pickRenderScale = renderScale;
            const scaledWidth = Math.max(1, Math.round(screenWidth * renderScale));
            const scaledHeight = Math.max(1, Math.round(screenHeight * renderScale));
            this.ensurePickRenderTargets(scaledWidth, scaledHeight);
            this.pickRenderTexture = this.acquirePickRenderTexture();
            if (!this.pickRenderTexture) return;
            this.ensurePickRenderTextureDepthAttachment();
            this.recordHoverProfileSection("pickPass.setupRenderTarget", performance.now() - setupStartMs);

            this.pickContainer.scale.set(renderScale, renderScale);
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
            const collectStartMs = performance.now();
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
            this.recordHoverProfileSection("pickPass.collectSortable", performance.now() - collectStartMs);

            if (showPickerScreen) {
                const hitboxOverlayDrawn = this.renderPickerGroundHitboxOutlines(this.pickLastCamera, onscreenObjects);
                if (hitboxOverlayDrawn && this.pickerGroundHitboxGraphics) {
                    this.pickContainer.addChild(this.pickerGroundHitboxGraphics);
                }
            }

            const proxyBuildStartMs = performance.now();
            for (let i = 0; i < sortable.length; i++) {
                const item = sortable[i].item;
                const displayObj = sortable[i].displayObj;
                const id = this.ensureObjectPickerId(item);
                if (!id) continue;
                const rgb = this.idToRgb(id);
                const record = this.ensurePickProxyForDisplayObject(item, displayObj);
                if (!record) continue;
                if (!this.syncPickProxyFromDisplayObject(record, displayObj, rgb, item)) continue;
                this.pickContainer.addChild(record.proxy);
                this.pickProxiesActiveThisFrame.add(record);
                this.pickEntriesThisFrame.push({ item, displayObj, record, rgb });
            }
            this.recordHoverProfileSection("pickPass.buildProxies", performance.now() - proxyBuildStartMs);

            const renderRtStartMs = performance.now();
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
            this.recordHoverProfileSection("pickPass.renderToTexture", performance.now() - renderRtStartMs);
            this.recordHoverProfileSection("pickPass.total", performance.now() - pickPassStartMs);
        }

        getHoveredObject(options = null) {
            const picked = this.latestPickObject || null;
            if (!picked) return null;
            const opts = options && typeof options === "object" ? options : {};
            if (opts && typeof opts.filter === "function" && !opts.filter(picked)) {
                return null;
            }
            return picked;
        }

        getCachedPickInfo() {
            return {
                frame: this.latestPickFrame,
                screenX: this.latestPickX,
                screenY: this.latestPickY,
                id: this.latestPickId,
                color: [
                    this.latestPickColor[0],
                    this.latestPickColor[1],
                    this.latestPickColor[2],
                    this.latestPickColor[3]
                ],
                object: this.latestPickObject || null
            };
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

        drawVanishWallChunkOverlay(target, ctx, pulse, worldX, worldY, resolvedPreview = null) {
            const g = this.highlightGraphics;
            const camera = ctx && ctx.camera;
            const uiLayer = ctx && ctx.uiLayer;
            if (!g || !camera || typeof camera.worldToScreen !== "function" || !uiLayer) return false;
            if (!target || target.type !== "wallSection" || target.gone || target.vanishing) return false;
            if (typeof target.getVanishPreviewPolygon !== "function") return false;
            if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;

            const preview = resolvedPreview || target.getVanishPreviewPolygon(
                { x: Number(worldX), y: Number(worldY) },
                { removeWidthWorld: 1 }
            );
            const points = preview && Array.isArray(preview.points) ? preview.points : null;
            if (!points || points.length < 3) return false;

            g.clear();
            const drew = this.drawVanishWallChunkVolume(g, camera, target, preview, pulse);
            if (!drew) {
                g.clear();
                g.visible = false;
                return false;
            }
            g.visible = true;

            if (g.parent !== uiLayer) {
                uiLayer.addChild(g);
            } else {
                uiLayer.setChildIndex(g, uiLayer.children.length - 1);
            }
            return true;
        }

        drawVanishWallChunkOverlayBatch(ctx, pulse, entries = []) {
            const g = this.highlightGraphics;
            const camera = ctx && ctx.camera;
            const uiLayer = ctx && ctx.uiLayer;
            if (!g || !camera || typeof camera.worldToScreen !== "function" || !uiLayer) return false;
            if (!Array.isArray(entries) || entries.length === 0) return false;

            g.clear();
            let drewAny = false;
            for (let e = 0; e < entries.length; e++) {
                const entry = entries[e];
                const target = entry && entry.target;
                const preview = entry && entry.preview;
                if (!target || target.gone || target.vanishing) continue;
                const points = preview && Array.isArray(preview.points) ? preview.points : null;
                if (!points || points.length < 3) continue;

                if (this.drawVanishWallChunkVolume(g, camera, target, preview, pulse)) {
                    drewAny = true;
                }
            }

            g.visible = drewAny;
            if (!drewAny) return false;
            if (g.parent !== uiLayer) {
                uiLayer.addChild(g);
            } else {
                uiLayer.setChildIndex(g, uiLayer.children.length - 1);
            }
            return true;
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

        beginHoverProfile(ctx) {
            const profiler = this.hoverProfiler;
            if (!profiler || profiler.printed) return null;
            const nowMs = (ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : performance.now();
            if (!Number.isFinite(profiler.startMs)) {
                profiler.startMs = nowMs;
                profiler.deadlineMs = nowMs + 60000;
            }
            return profiler;
        }

        recordHoverProfileSection(sectionName, elapsedMs) {
            const profiler = this.hoverProfiler;
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

        profileHoverSection(sectionName, fn) {
            const startMs = performance.now();
            const result = fn();
            this.recordHoverProfileSection(sectionName, performance.now() - startMs);
            return result;
        }

        maybePrintHoverProfileSummary(ctx) {
            const profiler = this.hoverProfiler;
            if (!profiler || profiler.printed || !Number.isFinite(profiler.deadlineMs)) return;
            const nowMs = (ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : performance.now();
            if (nowMs < profiler.deadlineMs) return;

            const sections = {};
            const sectionNames = Object.keys(profiler.sections);
            for (let i = 0; i < sectionNames.length; i++) {
                const name = sectionNames[i];
                const section = profiler.sections[name];
                if (!section) continue;
                sections[name] = {
                    samples: section.count,
                    avgMs: section.count > 0 ? section.totalMs / section.count : 0,
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
            global.renderingScenePickerProfileSummary = summary;
            console.log("ScenePicker hover profile (60s):", summary);
            profiler.printed = true;
        }

        renderHoverHighlight(ctx) {
            const hoverFrameStartMs = performance.now();
            this.beginHoverProfile(ctx);
            const finalizeHoverProfile = () => {
                const hoverFrameMs = performance.now() - hoverFrameStartMs;
                this.recordHoverProfileSection("hover.total", hoverFrameMs);
                if (this.hoverProfiler && !this.hoverProfiler.printed) {
                    this.hoverProfiler.frameCount += 1;
                    this.hoverProfiler.totalFrameMs += hoverFrameMs;
                    if (hoverFrameMs > this.hoverProfiler.maxFrameMs) {
                        this.hoverProfiler.maxFrameMs = hoverFrameMs;
                    }
                }
                this.maybePrintHoverProfileSummary(ctx);
            };
            this.profileHoverSection("hover.ensureObjects", () => {
                this.ensureObjects();
            });
            this.profileHoverSection("hover.hideAll", () => {
                this.hideAll();
            });

            const wizard = ctx && ctx.wizard;
            const spellSystem = (ctx && ctx.spellSystem) || null;
            const mousePos = (ctx && ctx.mousePos) || global.mousePos || null;
            const uiLayer = ctx && ctx.uiLayer;
            const showPickerScreen = !!global.renderingShowPickerScreen;
            const spaceHeld = !!(ctx && ctx.spaceHeld);
            const currentSpell = (wizard && typeof wizard.currentSpell === "string")
                ? wizard.currentSpell
                : "";
            const spellNeedsHoverTarget = (
                currentSpell === "wall" ||
                currentSpell === "buildroad" ||
                currentSpell === "firewall" ||
                currentSpell === "vanish" ||
                currentSpell === "editorvanish" ||
                currentSpell === "fireball" ||
                currentSpell === "placeobject" ||
                currentSpell === "editscript"
            );
            const editscriptReadyForHover = currentSpell !== "editscript" || spaceHeld;
            let target = null;
            const canResolveTarget = !!(
                wizard &&
                spellSystem &&
                typeof spellSystem.isValidHoverTargetForCurrentSpell === "function" &&
                mousePos &&
                Number.isFinite(mousePos.screenX) &&
                Number.isFinite(mousePos.screenY) &&
                spellNeedsHoverTarget &&
                editscriptReadyForHover
            );
            const needsPickPass = !!(showPickerScreen || canResolveTarget);
            if (!needsPickPass) {
                this.profileHoverSection("hover.resolvePickReadbackRequests", () => {
                    this.resolvePickReadbackRequests((ctx && ctx.frameCount));
                });
                this.profileHoverSection("hover.renderPickerScreenPreview", () => {
                    this.renderPickerScreenPreview(ctx || {});
                });
                finalizeHoverProfile();
                return;
            }

            let onscreenObjectsRef = [];
            this.profileHoverSection("hover.resolveOnscreenObjects", () => {
                if (global.onscreenObjects instanceof Set) {
                    // Hot path: avoid calling global.getOnscreenObjects() because it allocates
                    // a fresh Array.from(...) every frame. Build pick pass directly from the Set.
                    onscreenObjectsRef = global.onscreenObjects;
                } else if (typeof global.getOnscreenObjects === "function") {
                    onscreenObjectsRef = global.getOnscreenObjects();
                } else if (Array.isArray(global.onscreenObjects)) {
                    onscreenObjectsRef = global.onscreenObjects;
                }
            });

            const hasMouseScreen = !!(
                mousePos &&
                Number.isFinite(mousePos.screenX) &&
                Number.isFinite(mousePos.screenY)
            );
            const shouldSubmitPickRequest = hasMouseScreen
                ? this.shouldSubmitPickReadbackRequest(
                    mousePos.screenX,
                    mousePos.screenY
                )
                : false;
            const shouldBuildPickPass = !!(showPickerScreen || shouldSubmitPickRequest);
            if (shouldBuildPickPass) {
                this.profileHoverSection("hover.buildPickPass", () => {
                    this.buildPickPass(ctx || {}, onscreenObjectsRef);
                });
            }
            if (hasMouseScreen && shouldSubmitPickRequest) {
                this.profileHoverSection("hover.submitPickReadbackRequest", () => {
                    this.submitPickReadbackRequest(
                        mousePos.screenX,
                        mousePos.screenY,
                        (ctx && ctx.frameCount)
                    );
                });
            } else if (!hasMouseScreen) {
                this.clearPendingPickReadbacks();
                this.latestPickObject = null;
                this.latestPickId = 0;
                this.latestPickColor[0] = 0;
                this.latestPickColor[1] = 0;
                this.latestPickColor[2] = 0;
                this.latestPickColor[3] = 0;
            }
            this.profileHoverSection("hover.resolvePickReadbackRequests", () => {
                this.resolvePickReadbackRequests((ctx && ctx.frameCount));
            });
            if (canResolveTarget) {
                this.profileHoverSection("hover.resolveSpellTarget", () => {
                    const hovered = this.getHoveredObject() || null;
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
                });
            }
            if (showPickerScreen && target && !target.gone && !target.vanishing) {
                this.profileHoverSection("hover.applyPickerPreviewHighlight", () => {
                    this.applyPickerPreviewHighlight(target);
                });
            }
            this.profileHoverSection("hover.renderPickerScreenPreview", () => {
                this.renderPickerScreenPreview(ctx || {});
            });
            if (!wizard || !uiLayer) {
                finalizeHoverProfile();
                return;
            }
            const pulse = this.getPulse((ctx && ctx.frameCount) || global.frameCount || 0);

            let queuedVanish = null;
            if (
                (currentSpell === "vanish" || currentSpell === "editorvanish") &&
                spellSystem &&
                typeof spellSystem.getVanishDragHighlightState === "function"
            ) {
                queuedVanish = spellSystem.getVanishDragHighlightState(wizard);
            }

            if (queuedVanish && Array.isArray(queuedVanish.objects)) {
                this.profileHoverSection("hover.applyQueuedVanishTint", () => {
                    for (let i = 0; i < queuedVanish.objects.length; i++) {
                        const queuedTarget = queuedVanish.objects[i];
                        if (!queuedTarget || queuedTarget.gone || queuedTarget.vanishing) continue;
                        this.applyTintHighlightForTarget(queuedTarget, ctx, pulse);
                    }
                });
            }

            const wallOverlayEntries = [];
            if (queuedVanish && Array.isArray(queuedVanish.wallPreviews)) {
                for (let i = 0; i < queuedVanish.wallPreviews.length; i++) {
                    const entry = queuedVanish.wallPreviews[i];
                    if (!entry || !entry.target || !entry.preview) continue;
                    wallOverlayEntries.push(entry);
                }
            }

            if (!canResolveTarget) {
                if (wallOverlayEntries.length > 0) {
                    this.profileHoverSection("hover.drawVanishWallChunkOverlayBatch", () => {
                        this.drawVanishWallChunkOverlayBatch(ctx, pulse, wallOverlayEntries);
                    });
                }
                finalizeHoverProfile();
                return;
            }

            if (!target || target.gone || target.vanishing) {
                if (wallOverlayEntries.length > 0) {
                    this.profileHoverSection("hover.drawVanishWallChunkOverlayBatch", () => {
                        this.drawVanishWallChunkOverlayBatch(ctx, pulse, wallOverlayEntries);
                    });
                }
                finalizeHoverProfile();
                return;
            }

            if ((currentSpell === "vanish" || currentSpell === "editorvanish") && target.type === "wallSection") {
                const vanishPreview = (
                    spellSystem &&
                    typeof spellSystem.getVanishWallPreviewPolygonForHover === "function" &&
                    mousePos &&
                    Number.isFinite(mousePos.worldX) &&
                    Number.isFinite(mousePos.worldY)
                )
                    ? spellSystem.getVanishWallPreviewPolygonForHover(
                        wizard,
                        target,
                        Number(mousePos.worldX),
                        Number(mousePos.worldY)
                    )
                    : null;
                if (vanishPreview) {
                    wallOverlayEntries.push({ target, preview: vanishPreview });
                }
                const drewVanishChunk = this.profileHoverSection("hover.drawVanishWallChunkOverlayBatch", () =>
                    this.drawVanishWallChunkOverlayBatch(ctx, pulse, wallOverlayEntries)
                );
                if (drewVanishChunk) {
                    finalizeHoverProfile();
                    return;
                }
            }

            this.profileHoverSection("hover.applyTintHighlightForTarget", () => {
                this.applyTintHighlightForTarget(target, ctx, pulse);
            });
            finalizeHoverProfile();
        }
    }

    global.RenderingScenePicker = RenderingScenePicker;
})(typeof globalThis !== "undefined" ? globalThis : window);
