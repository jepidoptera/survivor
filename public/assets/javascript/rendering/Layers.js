(function attachRenderingLayers(global) {
    class RenderingLayers {
        constructor() {
            this.root = new PIXI.Container();
            this.root.name = "renderingRoot";

            this.ground = new PIXI.Container();
            this.ground.name = "renderingGround";

            this.roadsFloor = new PIXI.Container();
            this.roadsFloor.name = "renderingRoadsFloor";

            this.losShadow = new PIXI.Container();
            this.losShadow.name = "renderer2LosShadow";

            this.depthObjects = new PIXI.Container();
            this.depthObjects.name = "renderingDepthObjects";

            this.objects3d = new PIXI.Container();
            this.objects3d.name = "renderingObjects3d";

            this.entities = new PIXI.Container();
            this.entities.name = "renderingEntities";

            this.ui = new PIXI.Container();
            this.ui.name = "renderingUi";

            this.root.addChild(this.ground);
            this.root.addChild(this.roadsFloor);
            this.root.addChild(this.losShadow);
            this.root.addChild(this.depthObjects);
            this.root.addChild(this.objects3d);
            this.root.addChild(this.entities);
            this.root.addChild(this.ui);
        }
    }

    global.RenderingLayers = RenderingLayers;
})(typeof globalThis !== "undefined" ? globalThis : window);
