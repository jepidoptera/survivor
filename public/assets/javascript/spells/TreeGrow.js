class TreeGrow extends globalThis.Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/thumbnails/tree.png";
        this.gravity = 0;
        this.speed = 0;
        this.range = 20;
        this.bounces = 0;
        this.apparentSize = 0;
        this.delayTime = 0;
        this.magicCost = 0;
        this.initialSize = 1;
        this.maxSize = 20;
        this.growthPerSecond = 2.5;
        this.magicPerSecond = 10;
        this.radius = 0;
    }
    
    cast(targetX, targetY) {
        // Snap to nearest hex tile
        const targetNode = wizard.map.worldToNode(targetX, targetY);
        if (!targetNode) {
            message("Cannot grow tree there!");
            return this;
        }
        
        // Check if there's already an object at this location
        if (targetNode.objects && targetNode.objects.length > 0) {
            message("Something is already growing there!");
            return this;
        }
        
        // Reuse map-managed tree textures when available to preserve variants.
        const treeTextures = (wizard.map.scenery && wizard.map.scenery.tree && wizard.map.scenery.tree.textures)
            ? wizard.map.scenery.tree.textures
            : Array.from({length: 5}, (_, n) => PIXI.Texture.from(`/assets/images/trees/tree${n}.png`));
        
        const newTree = new Tree({x: targetNode.x, y: targetNode.y}, treeTextures, wizard.map);
        const selectedTreeVariant = (
            wizard &&
            Number.isInteger(wizard.selectedTreeTextureVariant) &&
            wizard.selectedTreeTextureVariant >= 0 &&
            wizard.selectedTreeTextureVariant < treeTextures.length
        )
            ? wizard.selectedTreeTextureVariant
            : null;
        if (selectedTreeVariant !== null && newTree.pixiSprite) {
            const selectedTexture = treeTextures[selectedTreeVariant];
            if (selectedTexture) {
                if (typeof newTree.setTreeTextureIndex === "function") {
                    newTree.setTreeTextureIndex(selectedTreeVariant, treeTextures);
                } else {
                    newTree.pixiSprite.texture = selectedTexture;
                    newTree.textureIndex = selectedTreeVariant;
                }
            }
        }
        newTree.applySize(this.initialSize);

        // Holding space grows only the newly planted tree from this cast.
        if (keysPressed[" "]) {
            SpellSystem.startTreeGrowthChannel(
                wizard,
                newTree,
                this.growthPerSecond,
                this.magicPerSecond,
                this.maxSize
            );
        }
        
        // Deactivate this spell projectile immediately (tree is now placed)
        this.visible = false;
        this.detachPixiSprite();
        
        return this;
    }
}


globalThis.TreeGrow = TreeGrow;
