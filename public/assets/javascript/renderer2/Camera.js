(function attachRenderer2Camera(global) {
    class Renderer2Camera {
        constructor() {
            this.x = 0;
            this.y = 0;
            this.viewscale = 1;
            this.xyratio = 0.66;
            this.map = null;
        }

        update({ camera, wizard, viewport, viewscale, xyratio, map }) {
            this.viewscale = Number.isFinite(viewscale) ? viewscale : this.viewscale;
            this.xyratio = Number.isFinite(xyratio) ? xyratio : this.xyratio;
            this.map = map || null;

            if (camera && Number.isFinite(camera.x) && Number.isFinite(camera.y)) {
                this.x = camera.x;
                this.y = camera.y;
                return;
            }

            if (wizard && Number.isFinite(wizard.x) && Number.isFinite(wizard.y)) {
                const width = viewport && Number.isFinite(viewport.width) ? viewport.width : 40;
                const height = viewport && Number.isFinite(viewport.height) ? viewport.height : 30;
                this.x = wizard.x - width * 0.5;
                this.y = wizard.y - height * 0.5;
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

    global.Renderer2Camera = Renderer2Camera;
    global.RenderingCamera = Renderer2Camera;
})(typeof globalThis !== "undefined" ? globalThis : window);
