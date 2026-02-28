(function attachRenderer2Layers(global) {
    class Renderer2Layers {
        constructor() {
            this.root = new PIXI.Container();
            this.root.name = "renderer2Root";

            this.ground = new PIXI.Container();
            this.ground.name = "renderer2Ground";

            this.roadsFloor = new PIXI.Container();
            this.roadsFloor.name = "renderer2RoadsFloor";

            this.depthObjects = new PIXI.Container();
            this.depthObjects.name = "renderer2DepthObjects";

            this.objects3d = new PIXI.Container();
            this.objects3d.name = "renderer2Objects3d";

            this.entities = new PIXI.Container();
            this.entities.name = "renderer2Entities";

            this.ui = new PIXI.Container();
            this.ui.name = "renderer2Ui";

            this.root.addChild(this.ground);
            this.root.addChild(this.roadsFloor);
            this.root.addChild(this.depthObjects);
            this.root.addChild(this.objects3d);
            this.root.addChild(this.entities);
            this.root.addChild(this.ui);
        }
    }

    global.Renderer2Layers = Renderer2Layers;
    global.RenderingLayers = Renderer2Layers;
})(typeof globalThis !== "undefined" ? globalThis : window);
