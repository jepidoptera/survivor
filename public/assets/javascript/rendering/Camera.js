(function attachRenderingCamera(global) {
    class RenderingCamera {
        static interpolateWrappedValue(mapRef, fromValue, toValue, alpha, axis = "x") {
            const from = Number(fromValue);
            const to = Number(toValue);
            const t = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
            if (!Number.isFinite(from) || !Number.isFinite(to)) {
                return Number.isFinite(to) ? to : from;
            }
            const shortestDeltaName = axis === "y" ? "shortestDeltaY" : "shortestDeltaX";
            if (mapRef && typeof mapRef[shortestDeltaName] === "function") {
                return from + mapRef[shortestDeltaName](from, to) * t;
            }
            return from + (to - from) * t;
        }

        static getContinuousWrappedValue(mapRef, referenceValue, worldValue, axis = "x") {
            const raw = Number(worldValue);
            if (!Number.isFinite(raw)) return raw;
            const reference = Number(referenceValue);
            const shortestDeltaName = axis === "y" ? "shortestDeltaY" : "shortestDeltaX";
            const wrapName = axis === "y" ? "wrapWorldY" : "wrapWorldX";
            if (mapRef && typeof mapRef[shortestDeltaName] === "function" && Number.isFinite(reference)) {
                return reference + mapRef[shortestDeltaName](reference, raw);
            }
            if (mapRef && typeof mapRef[wrapName] === "function") {
                return mapRef[wrapName](raw);
            }
            return raw;
        }

        static alignWorldPointToReference(mapRef, referenceX, referenceY, worldX, worldY) {
            return {
                x: RenderingCamera.getContinuousWrappedValue(mapRef, referenceX, worldX, "x"),
                y: RenderingCamera.getContinuousWrappedValue(mapRef, referenceY, worldY, "y")
            };
        }

        static getViewportWorldCenter(viewport) {
            return {
                x: (Number(viewport && viewport.x) || 0) + (Number(viewport && viewport.width) || 0) * 0.5,
                y: (Number(viewport && viewport.y) || 0) + (Number(viewport && viewport.height) || 0) * 0.5
            };
        }

        constructor() {
            this.x = 0;
            this.y = 0;
            this.prevX = 0;
            this.prevY = 0;
            this.viewscale = 1;
            this.xyratio = 0.66;
            this.map = null;
        }

        update({ camera, wizard, viewport, viewscale, xyratio, map, renderAlpha }) {
            this.viewscale = Number.isFinite(viewscale) ? viewscale : this.viewscale;
            this.xyratio = Number.isFinite(xyratio) ? xyratio : this.xyratio;
            this.map = map || null;
            const alpha = Number.isFinite(renderAlpha) ? Math.max(0, Math.min(1, renderAlpha)) : 1;

            if (camera && Number.isFinite(camera.x) && Number.isFinite(camera.y)) {
                const prevX = Number.isFinite(camera.prevX) ? camera.prevX : camera.x;
                const prevY = Number.isFinite(camera.prevY) ? camera.prevY : camera.y;
                this.x = RenderingCamera.interpolateWrappedValue(this.map, prevX, camera.x, alpha, "x");
                this.y = RenderingCamera.interpolateWrappedValue(this.map, prevY, camera.y, alpha, "y");
                this.prevX = prevX;
                this.prevY = prevY;
                return;
            }

            if (wizard && Number.isFinite(wizard.x) && Number.isFinite(wizard.y)) {
                const width = viewport && Number.isFinite(viewport.width) ? viewport.width : 40;
                const height = viewport && Number.isFinite(viewport.height) ? viewport.height : 30;
                this.x = wizard.x - width * 0.5;
                this.y = wizard.y - height * 0.5;
                this.prevX = this.x;
                this.prevY = this.y;
            }
        }

        worldToScreen(worldX, worldY, worldZ = 0) {
            const mapRef = this.map || (typeof global !== "undefined" ? global.map : null);
            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(this.x, worldX)
                : (worldX - this.x);
            const dyBase = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(this.y, worldY)
                : (worldY - this.y);
            const dy = dyBase - worldZ;
            return {
                x: dx * this.viewscale,
                y: dy * this.viewscale * this.xyratio
            };
        }
    }

    global.RenderingCamera = RenderingCamera;
})(typeof globalThis !== "undefined" ? globalThis : window);
