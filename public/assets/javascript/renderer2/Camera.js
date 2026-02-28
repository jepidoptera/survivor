(function attachRenderer2Camera(global) {
    class Renderer2Camera {
        constructor() {
            this.x = 0;
            this.y = 0;
            this.viewscale = 1;
            this.xyratio = 0.66;
        }

        update({ camera, wizard, viewport, viewscale, xyratio }) {
            this.viewscale = Number.isFinite(viewscale) ? viewscale : this.viewscale;
            this.xyratio = Number.isFinite(xyratio) ? xyratio : this.xyratio;

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
            const dx = worldX - this.x;
            const dy = worldY - this.y - worldZ;
            return {
                x: dx * this.viewscale,
                y: dy * this.viewscale * this.xyratio
            };
        }
    }

    global.Renderer2Camera = Renderer2Camera;
    global.RenderingCamera = Renderer2Camera;
})(typeof globalThis !== "undefined" ? globalThis : window);
