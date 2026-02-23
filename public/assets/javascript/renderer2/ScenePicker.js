(function attachRenderer2ScenePicker(global) {
    class Renderer2ScenePicker {
        constructor() {
            this.highlightSprite = null;
            this.highlightMesh = null;
            this.highlightGraphics = null;
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
            if (this.highlightSprite) this.highlightSprite.visible = false;
            if (this.highlightMesh) this.highlightMesh.visible = false;
            if (this.highlightGraphics) {
                this.highlightGraphics.clear();
                this.highlightGraphics.visible = false;
            }
        }

        getPulse(frameCount) {
            const tick = Number.isFinite(frameCount) ? frameCount : 0;
            return 0.55 + 0.45 * (Math.sin(tick * 0.12) * 0.5 + 0.5);
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
            if (!wizard || !uiLayer || !spellSystem || typeof spellSystem.getHoverTargetForCurrentSpell !== "function") {
                return;
            }
            if (!mousePos || !Number.isFinite(mousePos.worldX) || !Number.isFinite(mousePos.worldY)) {
                return;
            }
            if (wizard.currentSpell === "placeobject") return;

            const target = spellSystem.getHoverTargetForCurrentSpell(wizard, mousePos.worldX, mousePos.worldY);
            if (!target || target.gone || target.vanishing) return;
            const pulse = this.getPulse((ctx && ctx.frameCount) || global.frameCount || 0);
            const targetDisplay = this.getTargetDisplayObject(target, ctx);
            if (!targetDisplay) {
                this.drawHitboxOverlay(target, ctx, pulse);
                if (this.highlightGraphics.visible && this.highlightGraphics.parent !== uiLayer) {
                    uiLayer.addChild(this.highlightGraphics);
                }
                return;
            }

            if (targetDisplay instanceof PIXI.Sprite) {
                const hl = this.highlightSprite;
                hl.texture = targetDisplay.texture || PIXI.Texture.WHITE;
                if (targetDisplay.anchor && hl.anchor) {
                    hl.anchor.set(targetDisplay.anchor.x, targetDisplay.anchor.y);
                }
                hl.position.set(targetDisplay.position.x, targetDisplay.position.y);
                hl.scale.set(targetDisplay.scale.x, targetDisplay.scale.y);
                hl.rotation = targetDisplay.rotation;
                hl.skew.set(targetDisplay.skew.x, targetDisplay.skew.y);
                hl.pivot.set(targetDisplay.pivot.x, targetDisplay.pivot.y);
                hl.tint = 0x66c2ff;
                hl.alpha = 0.35 * pulse;
                hl.visible = true;
                if (hl.parent !== uiLayer) uiLayer.addChild(hl);
                return;
            }

            if (targetDisplay instanceof PIXI.Mesh) {
                const hl = this.highlightMesh;
                const targetGeom = targetDisplay.geometry;
                const sourceVerts = targetGeom && targetGeom.getBuffer ? (
                    targetGeom.getBuffer("aVertexPosition") || targetGeom.getBuffer("aWorldPosition")
                ) : null;
                const sourceUvs = targetGeom && targetGeom.getBuffer ? targetGeom.getBuffer("aUvs") : null;
                const sourceIdx = targetGeom && targetGeom.getIndex ? targetGeom.getIndex() : null;
                const hlVerts = hl.geometry.getBuffer("aVertexPosition");
                const hlUvs = hl.geometry.getBuffer("aUvs");
                const hlIdx = hl.geometry.getIndex();
                if (sourceVerts && sourceVerts.data && hlVerts && hlVerts.data) {
                    const incoming = sourceVerts.data;
                    const use2d = incoming.length % 2 === 0;
                    let verts2d = null;
                    if (use2d) {
                        verts2d = incoming;
                    } else if (incoming.length % 3 === 0) {
                        const projected = new Float32Array((incoming.length / 3) * 2);
                        const cam = ctx && ctx.camera;
                        for (let i = 0, j = 0; i <= incoming.length - 3; i += 3, j += 2) {
                            const p = cam.worldToScreen(incoming[i], incoming[i + 1], incoming[i + 2]);
                            projected[j] = p.x;
                            projected[j + 1] = p.y;
                        }
                        verts2d = projected;
                    }
                    if (verts2d) {
                        const next = (verts2d instanceof Float32Array) ? verts2d : Float32Array.from(verts2d);
                        if (hlVerts.data.length !== next.length) hlVerts.data = new Float32Array(next.length);
                        hlVerts.data.set(next);
                        hlVerts.update();
                    }
                }
                if (sourceUvs && sourceUvs.data && hlUvs) {
                    const nextUvs = (sourceUvs.data instanceof Float32Array) ? sourceUvs.data : Float32Array.from(sourceUvs.data);
                    if (hlUvs.data.length !== nextUvs.length) hlUvs.data = new Float32Array(nextUvs.length);
                    hlUvs.data.set(nextUvs);
                    hlUvs.update();
                }
                if (sourceIdx && sourceIdx.data && hlIdx) {
                    const ctor = sourceIdx.data.constructor || Uint16Array;
                    const nextIdx = (sourceIdx.data instanceof ctor) ? sourceIdx.data : new ctor(sourceIdx.data);
                    if (hlIdx.data.length !== nextIdx.length || hlIdx.data.constructor !== nextIdx.constructor) {
                        hlIdx.data = new ctor(nextIdx.length);
                    }
                    hlIdx.data.set(nextIdx);
                    hlIdx.update();
                }

                if (hl.material) {
                    const tex = (targetDisplay.material && targetDisplay.material.texture)
                        ? targetDisplay.material.texture
                        : ((targetDisplay.shader && targetDisplay.shader.uniforms && targetDisplay.shader.uniforms.uSampler)
                            ? targetDisplay.shader.uniforms.uSampler
                            : PIXI.Texture.WHITE);
                    hl.material.texture = tex;
                }
                hl.position.set(targetDisplay.position.x, targetDisplay.position.y);
                hl.scale.set(targetDisplay.scale.x, targetDisplay.scale.y);
                hl.rotation = targetDisplay.rotation;
                hl.skew.set(targetDisplay.skew.x, targetDisplay.skew.y);
                hl.pivot.set(targetDisplay.pivot.x, targetDisplay.pivot.y);
                hl.tint = 0x66c2ff;
                hl.alpha = 0.35 * pulse;
                hl.visible = true;
                if (hl.parent !== uiLayer) uiLayer.addChild(hl);
                return;
            }

            this.drawHitboxOverlay(target, ctx, pulse);
            if (this.highlightGraphics.visible && this.highlightGraphics.parent !== uiLayer) {
                uiLayer.addChild(this.highlightGraphics);
            }
        }
    }

    global.Renderer2ScenePicker = Renderer2ScenePicker;
})(typeof globalThis !== "undefined" ? globalThis : window);
