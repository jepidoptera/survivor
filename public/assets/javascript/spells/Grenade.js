class Grenade extends globalThis.Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/grenade.png";
        this.altimage = document.createElement('img');
        this.altimage.src = "./assets/images/explosion.png";
        this.explosionFrame = 0;
        this.explosionFrames = null;
        this.isExploding = false;
        this.delayTime = 2;
    }
    land() {
        if (this.bounced === this.bounces) setTimeout(() => {
            this.isExploding = true;
            this.explosionFrame = 0;
            
            // Load explosion spritesheet frames (5x2)
            if (!this.explosionFrames) {
                const baseTexture = PIXI.Texture.from(this.altimage.src).baseTexture;
                this.explosionFrames = [];
                const frameWidth = baseTexture.width / 5;
                const frameHeight = baseTexture.height / 2;
                
                // Row 1 (frames 0-4)
                for (let col = 0; col < 5; col++) {
                    this.explosionFrames.push(
                        new PIXI.Texture(baseTexture, new PIXI.Rectangle(col * frameWidth, 0, frameWidth, frameHeight))
                    );
                }
                // Row 2 (frames 5-9)
                for (let col = 0; col < 5; col++) {
                    this.explosionFrames.push(
                        new PIXI.Texture(baseTexture, new PIXI.Rectangle(col * frameWidth, frameHeight, frameWidth, frameHeight))
                    );
                }
            }
            
            this.explodeInterval = setInterval(() => {
                if (paused) return;
                this.explosionFrame++;
                if (this.explosionFrame >= this.explosionFrames.length) {
                    clearInterval(this.explodeInterval);
                    this.visible = false;
                    this.detachPixiSprite();
                }
            }, 50);
            this.apparentSize = 80;
            animals.forEach((animal, n) => {
                let margin = 4;
                if (animal._onScreen && !animal.dead) {
                    const targetCoors = worldToScreen(animal);
                    targetCoors.y += animal.height / 2;
                    targetCoors.x += animal.width / 2;
                    const dist = distance(this.x, this.y, targetCoors.x, targetCoors.y);
                    if (withinRadius(this.x, this.y, targetCoors.x, targetCoors.y, margin)) {
                        console.log('blast radius: ', dist);
                        let damage = Math.min(40 / dist / Math.max(dist - 1, 1), 40);
                        console.log('damage: ', damage);
                        animal.hp -= damage;
                        if (animal.hp <= 0) {
                            let messageText = `You killed: ${animal.type}!` 
                            if (animal.foodValue > 0) messageText += `  You gain ${animal.foodValue} food.`;
                            message(messageText);
                            wizard.food += animal.foodValue;
                            animal.explode(this.x, this.y - this.z);
                            saveGame();
                        }
                        else if (animal.chaseRadius > 0) animal.attack(wizard);
                    }
                    // all visible animals flee
                    if (animal.fleeRadius != 0 && !animal.attacking) animal.flee();
                }
            })
        }, 500);
    }
}


globalThis.Grenade = Grenade;
