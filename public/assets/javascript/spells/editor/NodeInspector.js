// NodeInspector — passive editor tool that visualises anchor neighbours.
// No projectile is fired; all overlay drawing is done by
// drawNodeInspectorOverlay() in debug.js, called from the render pipeline.
class NodeInspector extends globalThis.Spell {
    constructor(x, y) {
        super(x, y);
        this.gravity = 0;
        this.speed = 0;
        this.range = 0;
        this.bounces = 0;
        this.apparentSize = 0;
        this.delayTime = 0;
        this.radius = 0;
    }

    cast(_targetX, _targetY) {
        this.visible = false;
        this.detachPixiSprite();
        return this;
    }
}

globalThis.NodeInspector = NodeInspector;
