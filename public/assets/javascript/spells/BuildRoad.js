class BuildRoad extends globalThis.Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.gravity = 0;
        this.speed = 0; // Instant placement
        this.range = 20;
        this.bounces = 0;
        this.apparentSize = 0;
        this.delayTime = 0;
        this.magicCost = 10;
        this.radius = 0;
    }
    
    cast(targetX, targetY) {
        // Check magic
        if (!globalThis.Spell.canAffordMagicCost(this.magicCost, wizard)) {
            globalThis.Spell.indicateInsufficientMagic();
            message("Not enough magic to cast Build Road!");
            return this;
        }
        globalThis.Spell.spendMagicCost(this.magicCost, wizard);
        
        // Snap to nearest hex tile
        const targetNode = wizard.map.worldToNode(targetX, targetY);
        if (!targetNode) {
            message("Cannot place road there!");
            return this;
        }

        const selectedFlooring = (wizard && typeof wizard.selectedFlooringTexture === "string" && wizard.selectedFlooringTexture.length > 0)
            ? wizard.selectedFlooringTexture
            : "/assets/images/flooring/dirt.jpg";
        
        // Only block placing an identical flooring tile on the same node.
        if (typeof Road !== "undefined" && typeof Road.hasMatchingRoadAtNode === "function"
            ? Road.hasMatchingRoadAtNode(targetNode, selectedFlooring)
            : (targetNode.objects && targetNode.objects.some(obj => obj.type === 'road'))) {
            message("Road already there!");
            return this;
        }
        
        // Create road (textures are generated dynamically in the constructor)
        const newRoad = new Road({x: targetNode.x, y: targetNode.y}, [], wizard.map, {
            fillTexturePath: selectedFlooring
        });
        if (
            newRoad &&
            wizard &&
            wizard.map &&
            wizard.map._prototypeObjectState
        ) {
            wizard.map._prototypeObjectState.captureScanNeeded = true;
        }
        
        // Deactivate this spell projectile immediately
        this.visible = false;
        this.detachPixiSprite();
        
        return this;
    }
}


globalThis.BuildRoad = BuildRoad;
