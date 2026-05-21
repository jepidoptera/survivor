class Teleport extends globalThis.Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/magic/teleport.png";
        this.gravity = 0;
        this.speed = 0;
        this.range = Infinity;
        this.bounces = 0;
        this.apparentSize = 0;
        this.delayTime = 0;
        this.magicCost = 25;
        this.radius = 0;
    }

    cast(targetX, targetY, options = {}) {
        if (!wizard || !wizard.map) return this;
        if (!globalThis.Spell.canAffordMagicCost(this.magicCost, wizard)) {
            globalThis.Spell.indicateInsufficientMagic();
            message("Not enough magic to cast Teleport!");
            return this;
        }

        let destinationX = targetX;
        let destinationY = targetY;
        if (typeof wizard.map.wrapWorldX === "function") destinationX = wizard.map.wrapWorldX(destinationX);
        if (typeof wizard.map.wrapWorldY === "function") destinationY = wizard.map.wrapWorldY(destinationY);
        if (!Number.isFinite(destinationX) || !Number.isFinite(destinationY)) {
            message("Cannot teleport there!");
            return this;
        }
        const destinationNode = options && options.destinationNode ? options.destinationNode : null;
        if (!destinationNode) {
            message("Cannot teleport there!");
            return this;
        }

        const renderingApi = (typeof globalThis !== "undefined") ? globalThis.Rendering : null;
        if (
            renderingApi &&
            typeof renderingApi.isWorldPointTargetable === "function" &&
            !renderingApi.isWorldPointTargetable(destinationX, destinationY, wizard, wizard.map || null)
        ) {
            message("You cannot teleport into darkness!");
            return this;
        }

        globalThis.Spell.spendMagicCost(this.magicCost, wizard);
        wizard.x = destinationX;
        wizard.y = destinationY;
        wizard.node = destinationNode;
        if (typeof wizard.syncTraversalLayerFromNode === "function") {
            wizard.syncTraversalLayerFromNode(destinationNode);
        } else {
            const destinationLayer = Number.isFinite(options && options.destinationLayer)
                ? Math.round(Number(options.destinationLayer))
                : (Number.isFinite(destinationNode.traversalLayer)
                    ? Math.round(Number(destinationNode.traversalLayer))
                    : (Number.isFinite(destinationNode.level) ? Math.round(Number(destinationNode.level)) : 0));
            wizard.currentLayer = destinationLayer;
            wizard.traversalLayer = destinationLayer;
            wizard.currentLayerBaseZ = Number.isFinite(destinationNode.baseZ)
                ? Number(destinationNode.baseZ)
                : (Number.isFinite(options && options.destinationBaseZ) ? Number(options.destinationBaseZ) : destinationLayer * 3);
        }
        wizard.z = 0;
        wizard._floorFallState = null;
        wizard.path = [];
        wizard.nextNode = null;
        wizard.destination = null;
        wizard.moving = false;
        wizard.movementVector = { x: 0, y: 0 };
        wizard.prevX = destinationX;
        wizard.prevY = destinationY;
        wizard.updateHitboxes();
        if (typeof centerViewport === "function") {
            centerViewport(wizard, 0);
        }

        this.visible = false;
        this.detachPixiSprite();
        return this;
    }
}



globalThis.Teleport = Teleport;
