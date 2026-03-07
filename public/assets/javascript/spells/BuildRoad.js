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
        this.magicCost = 5;
        this.radius = 0;
    }
    
    cast(targetX, targetY) {
        // Check magic
        if (wizard.magic < this.magicCost) {
            message("Not enough magic to cast Build Road!");
            return this;
        }
        wizard.magic -= this.magicCost;
        
        // Snap to nearest hex tile
        const targetNode = wizard.map.worldToNode(targetX, targetY);
        if (!targetNode) {
            message("Cannot place road there!");
            return this;
        }
        
        // Check if there's already road at this location
        if (targetNode.objects && targetNode.objects.some(obj => obj.type === 'road')) {
            message("Road already there!");
            return this;
        }
        
        // Create road (textures are generated dynamically in the constructor)
        const selectedFlooring = (wizard && typeof wizard.selectedFlooringTexture === "string" && wizard.selectedFlooringTexture.length > 0)
            ? wizard.selectedFlooringTexture
            : "/assets/images/flooring/dirt.jpg";
        const newRoad = new Road({x: targetNode.x, y: targetNode.y}, [], wizard.map, {
            fillTexturePath: selectedFlooring
        });
        
        // Deactivate this spell projectile immediately
        this.visible = false;
        this.detachPixiSprite();
        
        return this;
    }
}


globalThis.BuildRoad = BuildRoad;
