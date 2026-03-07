(function attachRenderingMazeMode(global) {
    class RenderingMazeMode {
        constructor() {
            this.blackBackdropGraphics = null;
            this.occlusionMaskGraphics = null;
            this.active = false;
        }

        isActive() {
            return !!this.active;
        }

        ensureBackdropGraphics(layers) {
            if (!layers || !layers.root) return null;
            if (!this.blackBackdropGraphics) {
                this.blackBackdropGraphics = new PIXI.Graphics();
                this.blackBackdropGraphics.name = "renderingMazeModeBackdrop";
            }
            if (this.blackBackdropGraphics.parent !== layers.root) {
                layers.root.addChild(this.blackBackdropGraphics);
            }
            return this.blackBackdropGraphics;
        }

        ensureOcclusionMaskGraphics(layers) {
            if (!layers || !layers.root) return null;
            if (!this.occlusionMaskGraphics) {
                this.occlusionMaskGraphics = new PIXI.Graphics();
                this.occlusionMaskGraphics.name = "renderingMazeModeMask";
            }
            if (this.occlusionMaskGraphics.parent !== layers.root) {
                layers.root.addChild(this.occlusionMaskGraphics);
            }
            return this.occlusionMaskGraphics;
        }

        drawBlackBackdrop(backdrop, appRef) {
            if (!backdrop) return;
            const width = Math.max(1, (appRef && appRef.renderer && Number(appRef.renderer.width)) || window.innerWidth || 800);
            const height = Math.max(1, (appRef && appRef.renderer && Number(appRef.renderer.height)) || window.innerHeight || 600);
            backdrop.clear();
            backdrop.beginFill(0x000000, 1);
            backdrop.drawRect(0, 0, width, height);
            backdrop.endFill();
            backdrop.visible = true;
        }

        drawLosOcclusionMask(maskGraphics, rendering, ctx) {
            if (!maskGraphics || !rendering) return false;
            maskGraphics.clear();

            const state = rendering.currentLosState;
            const wizard = ctx && ctx.wizard ? ctx.wizard : null;
            const camera = rendering.camera;
            if (!camera || !wizard || !state || !state.depth || !Number.isFinite(state.bins)) {
                maskGraphics.visible = false;
                return false;
            }

            const bins = Math.max(3, Math.floor(state.bins));
            const depth = state.depth;
            if (!depth || depth.length !== bins) {
                maskGraphics.visible = false;
                return false;
            }

            const viewportRef = (ctx && ctx.viewport) || null;
            const viewportW = viewportRef && Number.isFinite(viewportRef.width) ? viewportRef.width : 24;
            const viewportH = viewportRef && Number.isFinite(viewportRef.height) ? viewportRef.height : 24;
            const farDist = Math.max(viewportW, viewportH) * 1.5;
            if (!global.LOSSystem || typeof global.LOSSystem.buildPolygonWorldPoints !== "function") {
                maskGraphics.visible = false;
                return false;
            }
            const worldPoints = global.LOSSystem.buildPolygonWorldPoints(wizard, state, farDist);
            if (!Array.isArray(worldPoints) || worldPoints.length < 3) {
                maskGraphics.visible = false;
                return false;
            }

            maskGraphics.visible = true;
            maskGraphics.lineStyle(0);
            maskGraphics.beginFill(0xffffff, 1);
            let started = false;
            for (let i = 0; i < worldPoints.length; i++) {
                const pt = worldPoints[i];
                if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
                const screen = camera.worldToScreen(pt.x, pt.y, 0);
                if (!started) {
                    maskGraphics.moveTo(screen.x, screen.y);
                    started = true;
                } else {
                    maskGraphics.lineTo(screen.x, screen.y);
                }
            }
            if (started) maskGraphics.closePath();
            maskGraphics.endFill();
            return started;
        }

        apply(rendering, ctx, options = {}) {
            if (!rendering || !rendering.layers) return false;
            const layers = rendering.layers;
            const enabled = !!options.enabled;

            if (!enabled) {
                if (layers.ground) layers.ground.mask = null;
                if (layers.roadsFloor) layers.roadsFloor.mask = null;
                if (layers.groundObjects) layers.groundObjects.mask = null;
                if (this.blackBackdropGraphics) this.blackBackdropGraphics.visible = false;
                if (this.occlusionMaskGraphics) this.occlusionMaskGraphics.visible = false;
                this.active = false;
                return false;
            }

            const backdrop = this.ensureBackdropGraphics(layers);
            const occlusionMask = this.ensureOcclusionMaskGraphics(layers);
            this.drawBlackBackdrop(backdrop, ctx && ctx.app ? ctx.app : null);
            const hasMask = this.drawLosOcclusionMask(occlusionMask, rendering, ctx || {});

            if (layers.ground) layers.ground.mask = hasMask ? occlusionMask : null;
            if (layers.roadsFloor) layers.roadsFloor.mask = hasMask ? occlusionMask : null;
            if (layers.groundObjects) layers.groundObjects.mask = hasMask ? occlusionMask : null;
            this.active = true;
            return true;
        }
    }

    global.RenderingMazeMode = RenderingMazeMode;
})(typeof globalThis !== "undefined" ? globalThis : window);
