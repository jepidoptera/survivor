let spellKeyBindings = {
    "F": "fireball",
    "B": "wall",
    "V": "vanish",
    "T": "treegrow",
    "R": "buildroad",
    "FW": "firewall"
};

class Spell {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.image = document.createElement('img');
        this.image.src = "./assets/images/mokeball.png";
        this.size = 6;
        this.apparentSize = 16;
        this.speed = 7;
        this.range = 8;
        this.bounced = 0;
        this.bounces = 2;
        this.gravity = .5;
        this.bounceFactor = 1/3;
        this.landed = false;
        this.landedWorldX = 0;
        this.landedWorldY = 0;
        this.delayTime = 0;
        this.radius = 0.25; // Default hitbox radius in hex units
    }
    canTrackForcedTarget(target) {
        if (!target || target.gone || target.vanishing || target.dead) return false;
        if (Array.isArray(animals) && animals.includes(target)) return true;
        if (target.type === "human") return true;
        if (typeof target.moveDirection === "function") return true;
        if (typeof target.move === "function") return true;
        return false;
    }
    getForcedTargetAimPoint() {
        const target = this.forcedTarget;
        if (!this.canTrackForcedTarget(target)) return null;
        if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
        return { x: target.x, y: target.y };
    }
    retargetMovementTo(point, speedPerFrame = null) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
        const dx = point.x - this.x;
        const dy = point.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1e-6) return false;
        const currentSpeed = Math.hypot(this.movement?.x || 0, this.movement?.y || 0);
        const step = Number.isFinite(speedPerFrame)
            ? Math.max(0, speedPerFrame)
            : (currentSpeed > 1e-6 ? currentSpeed : (this.speed / frameRate));
        this.movement.x = (dx / dist) * step;
        this.movement.y = (dy / dist) * step;
        return true;
    }
    cast(targetX, targetY) {
        this.visible = true;
        this.x = wizard.x;
        this.y = wizard.y;
        this.z = 0;
        
        let xdist = (targetX - this.x);
        let ydist = targetY - this.y;
        let dist = Math.sqrt(xdist ** 2 + ydist ** 2);
        
        // Prevent division by zero
        if (dist < 0.1) {
            dist = 0.1;
            xdist = 0.1;
            ydist = 0;
        }
        
        if (dist > this.range) {
            let fraction = this.range / dist;
            ydist *= fraction;
            xdist *= fraction;
            dist = this.range;
        }
        this.movement = {
            x: xdist / dist * this.speed / frameRate,
            y: ydist / dist * this.speed / frameRate,
            z: (dist - 0.5) / this.speed / 2 * this.gravity,
        }


        this.castInterval = setInterval(() => {
            if (paused) return;
            const forcedAim = this.getForcedTargetAimPoint();
            if (forcedAim) {
                this.retargetMovementTo(forcedAim);
            }
            this.x += this.movement.x;
            this.y += this.movement.y;
            this.z += this.movement.z;
            this.movement.z -= this.gravity / frameRate;

            // this.z = Math.sqrt((this.movement.max / 2  - Math.abs(this.movement.max / 2 - this.movement.total)) / 2) || 0 ;
            this.apparentSize = (this.size * (this.z + 1) / 2 + 10) * Math.max($(document).width(), $(document).height()) / 1280;

            // Call land for continuous effects (like fireball damage)
            if (this.z === 0 && this.bounces === 0) {
                this.land();
            }

            if (this.z <= 0) {
                this.z = 0;
                this.land();
                this.bounce();
            }
        }, 1000 / frameRate);
        return this;
    }
    bounce() {
        if (this.bounced < this.bounces) {
            this.movement = {
                x: this.movement.x * this.bounceFactor,
                y: this.movement.y * this.bounceFactor,
                z: -this.movement.z * this.bounceFactor,
            }
            this.bounced += 1;
        }
        else {
            this.landed = true;
            this.landedWorldX = this.x;
            this.landedWorldY = this.y;
            this.vanishTimeout = setTimeout(() => {
                this.visible = false;
                if (this.pixiSprite) {
                    projectileLayer.removeChild(this.pixiSprite);
                    this.pixiSprite = null;
                }
            }, 3000);
            clearInterval(this.castInterval);
        }
    }
    land() {
    }
}

class Grenade extends Spell {
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
                    if (this.pixiSprite) {
                        projectileLayer.removeChild(this.pixiSprite);
                        this.pixiSprite = null;
                    }
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

class Rock extends Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = `./assets/images/rock${Math.floor(Math.random() * 5)}.png`;
        this.range = 10;
        this.delayTime = 0.5;
    }
    land() {
        if (this.bounced === 0) {
            animals.forEach((animal, n) => {
                let margin = animal.size + .15;
                if (animal._onScreen && !animal.dead) {
                    const targetCoors = worldToScreen(animal);
                    targetCoors.y += animal.height / 2;
                    targetCoors.x += animal.width / 2;
                    if (withinRadius(this.x, this.y, targetCoors.x, targetCoors.y, margin)) {
                        animal.hp -= 1;
                        if (animal.hp <= 0) {
                            let messageText = `You killed: ${animal.type}!` 
                            if (animal.foodValue > 0) messageText += `  You gain ${animal.foodValue} food.`;
                            wizard.food += animal.foodValue;
                            message(messageText);
                            animal.die();
                            saveGame();
                        }
                        else {
                            // didn't die
                            let xmove = this.movement.x;
                            let ymove = this.movement.y;
                            // bounce off at 90 degrees
                            if (Math.random() > .5) {
                                xmove = -this.movement.y;
                                ymove = this.movement.x;
                            }
                            else {
                                xmove = this.movement.y;
                                ymove = -this.movement.x;
                            }
                            this.movement.x = xmove * 2;
                            this.movement.y = ymove * 2;
                            if (animal.fleeRadius > 0) {
                                animal.flee();
                            }
                            else if (animal.chaseRadius > 0) {
                                animal.attack(wizard);
                            }
                        }
                    }
                }
            })
        }
    }
}

class Fireball extends Spell {
    static frames = null;
    static frameSourcePath = "/assets/images/fireball.png";

    static getFrames() {
        if (Array.isArray(Fireball.frames) && Fireball.frames.length > 0) {
            return Fireball.frames;
        }
        const preloadedResource = PIXI.Loader.shared.resources[Fireball.frameSourcePath];
        const baseTexture = (preloadedResource && preloadedResource.texture && preloadedResource.texture.baseTexture)
            ? preloadedResource.texture.baseTexture
            : PIXI.Texture.from(Fireball.frameSourcePath).baseTexture;
        if (!baseTexture || !baseTexture.valid) return null;

        const frames = [];
        const frameWidth = baseTexture.width / 5;
        const frameHeight = baseTexture.height / 2;

        for (let col = 0; col < 5; col++) {
            frames.push(
                new PIXI.Texture(baseTexture, new PIXI.Rectangle(col * frameWidth, 0, frameWidth, frameHeight))
            );
        }
        for (let col = 0; col < 5; col++) {
            frames.push(
                new PIXI.Texture(baseTexture, new PIXI.Rectangle(col * frameWidth, frameHeight, frameWidth, frameHeight))
            );
        }

        Fireball.frames = frames;
        return Fireball.frames;
    }

    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = Fireball.frameSourcePath;
        this.gravity = 0; // No arc - straight line
        this.speed = 5;
        this.range = 10;
        this.bounces = 0;
        this.apparentSize = 60;
        this.explosionFrame = 0;
        this.explosionFrames = null;
        this.isAnimating = true;
        this.damageRadius = 0.75;
        this.delayTime = 0.5;
        this.radius = this.damageRadius;
    }
    cast(targetX, targetY) {
        const fireballFrames = Fireball.getFrames();

        // check magic
        if (wizard.magic < 10) {
            message("Not enough magic to cast Fireball!");
            return this;
        }
        wizard.magic -= 10;
        this.explosionFrames = fireballFrames || [];
        
        // For fireball, only use target for direction.
        // Speed and range are independent from click distance.
        this.targetX = targetX;
        this.targetY = targetY;
        this.traveledDist = 0;
        
        this.visible = true;
        this.x = wizard.x;
        this.y = wizard.y;
        this.z = 0;
        
        let xdist = targetX - this.x;
        let ydist = targetY - this.y;
        let aimDist = Math.hypot(xdist, ydist);
        if (aimDist < 1e-4) {
            // Fallback to facing direction when target is too close to define aim.
            xdist = (wizard && wizard.direction && Number.isFinite(wizard.direction.x)) ? wizard.direction.x : 1;
            ydist = (wizard && wizard.direction && Number.isFinite(wizard.direction.y)) ? wizard.direction.y : 0;
            aimDist = Math.max(1e-4, Math.hypot(xdist, ydist));
        }
        const dirX = xdist / aimDist;
        const dirY = ydist / aimDist;

        // Start slightly away from wizard to avoid immediate self-collision.
        this.x += dirX * 0.5;
        this.y += dirY * 0.5;
        this.startX = this.x;
        this.startY = this.y;
        this.castWizardX = wizard.x;
        this.castWizardY = wizard.y;
        this.baseDirX = dirX;
        this.baseDirY = dirY;
        this.totalDist = Math.max(0.1, this.range);
        this.movement = {x: 0, y: 0, z: 0};
                
        // Lifetime tied to base spell range/speed.
        const cycleDurationMs = Math.max(1, (this.totalDist / Math.max(this.speed, 0.001)) * 1000);
        this.travelStartTime = performance.now();
        this.travelPausedTime = 0;
        this._pausedAt = null;
        
        // Single interval: update both movement and animation based on elapsed time
        this.castInterval = setInterval(() => {
            if (paused) {
                if (!this._pausedAt) {
                    this._pausedAt = performance.now();
                }
                return;
            }
            if (this._pausedAt) {
                this.travelPausedTime += performance.now() - this._pausedAt;
                this._pausedAt = null;
            }
            
            const now = performance.now();
            const elapsedMs = now - this.travelStartTime - this.travelPausedTime;
            const progress = Math.min(elapsedMs / cycleDurationMs, 1);
            
            // Update animation frame based on same progress
            if (this.explosionFrames && this.explosionFrames.length > 0) {
                this.explosionFrame = Math.floor(progress * this.explosionFrames.length) % this.explosionFrames.length;
            }
            
            // Base projectile movement (in aiming direction)
            const elapsedSec = elapsedMs / 1000;
            const baseDist = Math.min(this.totalDist, this.speed * elapsedSec);
            const forcedAim = this.getForcedTargetAimPoint();
            if (forcedAim) {
                const dx = forcedAim.x - this.x;
                const dy = forcedAim.y - this.y;
                const aimDist = Math.hypot(dx, dy);
                if (aimDist > 1e-6) {
                    const step = this.speed / frameRate;
                    this.x += (dx / aimDist) * step;
                    this.y += (dy / aimDist) * step;
                }
                this.traveledDist += this.speed / frameRate;
            } else {
                // Add wizard displacement during flight. If wizard keeps moving at
                // the same velocity, relative fireball speed/distance stay constant.
                const wizardOffsetX = wizard.x - this.castWizardX;
                const wizardOffsetY = wizard.y - this.castWizardY;

                this.x = this.startX + this.baseDirX * baseDist + wizardOffsetX;
                this.y = this.startY + this.baseDirY * baseDist + wizardOffsetY;
                this.traveledDist = baseDist;
            }
            
            // Check for continuous damage while moving
            this.land();
            
            // Check if reached target
            if (progress >= 1) {
                // Snap to exact target position before finishing
                this.visible = false;
                if (this.pixiSprite) {
                    projectileLayer.removeChild(this.pixiSprite);
                    this.pixiSprite = null;
                }
                clearInterval(this.castInterval);
            }
        }, 1000 / frameRate);
        return this;
    }
    land() {

        for (let obj of onscreenObjects) {
            if (!obj || obj.gone || obj.vanishing) continue;
            const visualHitbox = obj.visualHitbox || obj.hitbox;
            if (!visualHitbox) continue;
            if (obj.visualHitbox.intersects({type: "circle", x: this.x, y: this.y, radius: this.radius})) {
                // Don't re-ignite objects that are already dead
                if (obj.burned || obj.hp <= 0) {
                    continue;
                }
                if (!obj.hp) {
                    obj.hp = obj.maxHP || 100;
                    obj.maxHP = obj.hp;
                }
                obj.hp -= 0.1 * (obj.flamability || 1); // Damage per frame
                if (obj.hp < obj.maxHP) obj.isOnFire = true;
                const fireDuration = 5 * (obj.flamability || 1)
                obj.fireDuration = fireDuration * frameRate;
                obj.ignite(fireDuration);
            }
        }
    }
}


class Vanish extends Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/thumbnails/vanish.png";
        this.gravity = 0; // No arc - straight line
        this.speed = 10;
        this.range = 20;
        this.bounces = 0;
        this.apparentSize = 40;
        this.delayTime = 0;
        this.effectRadius = 0.5;
        this.magicCost = 5;
        this.radius = this.effectRadius;
    }
    
    cast(targetX, targetY) {
        // Check magic
        if (wizard.magic < 15) {
            message("Not enough magic to cast Vanish!");
            return this;
        }
        wizard.magic -= this.magicCost;
        
        this.visible = true;
        this.x = wizard.x;
        this.y = wizard.y;
        this.z = 0;
        
        let xdist = (targetX - this.x);
        let ydist = targetY - this.y;
        this.totalDist = distance(0, 0, xdist, ydist);
        
        // Prevent division by zero
        if (this.totalDist < 0.1) {
            this.totalDist = 0.1;
            xdist = 0.1;
            ydist = 0;
        }
        
        if (this.totalDist > this.range) {
            let fraction = this.range / this.totalDist;
            ydist *= fraction;
            xdist *= fraction;
            this.totalDist = this.range;
        }

        this.movement = {
            x: xdist / this.totalDist * this.speed / frameRate,
            y: ydist / this.totalDist * this.speed / frameRate,
            z: 0,
        }
        this.x += this.movement.x;
        this.y += this.movement.y;
        this.traveledDist = 0;
        
        this.castInterval = setInterval(() => {
            if (paused) return;
            const forcedAim = this.getForcedTargetAimPoint();
            if (forcedAim) {
                this.retargetMovementTo(forcedAim);
            }
            this.x += this.movement.x;
            this.y += this.movement.y;
            if (this.map && typeof this.map.wrapWorldX === "function") {
                this.x = this.map.wrapWorldX(this.x);
            }
            if (this.map && typeof this.map.wrapWorldY === "function") {
                this.y = this.map.wrapWorldY(this.y);
            }
            this.traveledDist += Math.sqrt(this.movement.x ** 2 + this.movement.y ** 2);
            
            if (!this.forcedTarget) {
                // they didn't pinpoint a target, so this is a loose spell
                this.land();
            }

            // Check if reached target
            if (this.traveledDist >= this.totalDist) {
                // If cursor was over a staticObject, only hit that object.
                if (this.forcedTarget) {
                    const obj = this.forcedTarget;
                    if (obj && !obj.gone && !obj.vanishing) {
                        this.vanishTarget(obj);
                    }
                }
                // Always end projectile at max travel distance (including misses).
                this.deactivate();
                return;
            }
        }, 1000 / frameRate);
        return this;
    }

    deactivate() {
        this.visible = false;
        if (this.pixiSprite) {
            projectileLayer.removeChild(this.pixiSprite);
            this.pixiSprite = null;
        }
        clearInterval(this.castInterval);
    }
    
    land() {
        // Check all onscreen objects
        for(let obj of onscreenObjects) {
            if (!obj || obj.gone || obj.vanishing) continue;
            if (obj.type === "road") continue;
            if (!obj.visualHitbox) continue;
            let hit = obj.visualHitbox.intersects({type: "circle", x: this.x, y: this.y, radius: this.radius});
            if (hit && !obj.vanishing) {
                this.vanishTarget(obj);
                this.deactivate();
            }
        }
    }
    
    vanishTarget(target) {
        // Mark as vanishing to avoid hitting multiple times
        target.vanishing = true;
        target.vanishStartTime = frameCount;
        target.vanishDuration = 0.25 * frameRate; // 1/4 second fade (after 1-frame flash)
        target.percentVanished = 0;
    }
}


class Arrow extends Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = `./assets/images/pointy arrow.png`;
        this.range = 12
        this.speed = 15
        this.bounces = 0
        this.gravity = .5
        this.type = "arrow"
        this.size = 50
    }
    bounce () {}
    land() {
        super.land()
        clearInterval(this.castInterval)
        animals.forEach((animal, n) => {
            let margin = animal.size
            if (animal._onScreen && !animal.dead) {
                const dist = distance(this.x, this.y, animal.center_x, animal.center_y);
                if (withinRadius(this.x, this.y, animal.center_x, animal.center_y, margin)) {
                    this.hurt(animal, 25 * (margin - dist) / margin)
                    this.x = animal.center_x
                    this.y = animal.center_y
                    if (animal.hp > 0) {
                        this.visible = false
                    }
                }
            }
        })
    }
}

class TreeGrow extends Spell {
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
        this.maxSize = 10;
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
            : Array.from({length: 5}, (_, n) => PIXI.Texture.from(`/assets/images/tree${n}.png`));
        
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
                newTree.pixiSprite.texture = selectedTexture;
                newTree.textureIndex = selectedTreeVariant;
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
        if (this.pixiSprite) {
            projectileLayer.removeChild(this.pixiSprite);
            this.pixiSprite = null;
        }
        
        return this;
    }
}

class BuildRoad extends Spell {
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
        if (this.pixiSprite) {
            projectileLayer.removeChild(this.pixiSprite);
            this.pixiSprite = null;
        }
        
        return this;
    }
}

function hitboxesIntersect(hitboxA, hitboxB) {
    if (!hitboxA || !hitboxB) return false;
    if (typeof hitboxA.intersects === "function" && hitboxA.intersects(hitboxB)) return true;
    if (typeof hitboxB.intersects === "function" && hitboxB.intersects(hitboxA)) return true;
    return false;
}

class FirewallEmitter {
    constructor(location, map) {
        this.type = "firewall";
        this.map = map;
        const rawX = location && Number.isFinite(location.x) ? location.x : 0;
        const rawY = location && Number.isFinite(location.y) ? location.y : 0;
        this.x = (this.map && typeof this.map.wrapWorldX === "function")
            ? this.map.wrapWorldX(rawX)
            : rawX;
        this.y = (this.map && typeof this.map.wrapWorldY === "function")
            ? this.map.wrapWorldY(rawY)
            : rawY;
        this.width = 0.5;
        this.height = 1.0; // flames 1 map unit high
        this.blocksTile = false;
        this.isPassable = true;
        this.gone = false;
        this.pixiSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        this.pixiSprite.anchor.set(0.5, 1);
        this.pixiSprite.renderable = false; // invisible body, only flame should render
        this.pixiSprite.alpha = 1;
        this.visualHitbox = new CircleHitbox(this.x, this.y, 0.25);
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, 0.1);
        this.isOnFire = true;
        this.fireSprite = null;
        this.fireFrameIndex = Math.floor(Math.random() * 25); // random phase
        this.fireWidthScale = 3.0; // stretch flames wider
        this.fireHeightScale = 1.0;

        const node = this.map && typeof this.map.worldToNode === "function"
            ? this.map.worldToNode(this.x, this.y)
            : null;
        if (node && typeof node.addObject === "function") {
            node.addObject(this);
            this.node = node;
        } else {
            this.node = null;
        }
    }

    removeFromNodes() {
        if (this.node && typeof this.node.removeObject === "function") {
            this.node.removeObject(this);
        }
    }

    handleCharacterCollision(character) {
        if (!character || character.gone || character.dead) return;
        const characterHitbox = character.visualHitbox || character.groundPlaneHitbox || character.hitbox;
        const emitterHitbox = this.visualHitbox || this.groundPlaneHitbox || this.hitbox;
        if (!characterHitbox || !emitterHitbox) return;
        if (!hitboxesIntersect(characterHitbox, emitterHitbox)) return;

        const characterZ = Number.isFinite(character.z) ? character.z : 0;
        const flameHeight = Number.isFinite(this.height) ? this.height : 1;
        if (characterZ >= flameHeight) return;
        const exposureRatio = flameHeight > 0
            ? Math.max(0, Math.min(1, (flameHeight - characterZ) / flameHeight))
            : 1;

        if (typeof character.ignite === "function") {
            // Refresh while touching so persistent contact keeps the target burning.
            character.ignite(8.0 * exposureRatio, exposureRatio);
        } else {
            character.isOnFire = true;
        }
    }
}

const SpellSystem = (() => {
    const DEFAULT_FLOORING_TEXTURE = "/assets/images/flooring/dirt.jpg";
    const RANDOM_TREE_VARIANT = "random";
    const AURA_MENU_ICON = "/assets/images/thumbnails/aura.png";
    const SPELL_DEFS = [
        { name: "fireball", icon: "/assets/images/thumbnails/fireball.png" },
        { name: "wall", icon: "/assets/images/thumbnails/wall.png" },
        { name: "vanish", icon: "/assets/images/thumbnails/vanish.png" },
        { name: "treegrow", icon: "/assets/images/thumbnails/tree.png" },
        { name: "buildroad", icon: "/assets/images/thumbnails/road.png" },
        { name: "firewall", icon: "/assets/images/thumbnails/firewall.png" }
    ];
    const AURA_DEFS = [
        { name: "omnivision", icon: "/assets/images/thumbnails/eye.png", key: "O", magicPerSecond: 2 },
        { name: "speed", icon: "/assets/images/thumbnails/speed.png", key: "P", magicPerSecond: 2 },
        { name: "healing", icon: "/assets/images/thumbnails/cross.png", key: "H", magicPerSecond: 2 }
    ];

    const MAGIC_TICK_MS = 50;
    const HP_REGEN_PER_SECOND = 0.25;
    const MAGIC_REGEN_PER_SECOND = 4;
    let healingAuraHpMultiplier = 5;
    const WALL_HEIGHT_MIN = 0.5;
    const WALL_HEIGHT_MAX = 7.0;
    const WALL_HEIGHT_STEP = 0.5;
    const WALL_THICKNESS_MIN = 0.125;
    const WALL_THICKNESS_MAX = 1.0;
    const WALL_THICKNESS_STEP = 0.125;

    let magicIntervalId = null;
    let lastMagicTickMs = 0;
    let spellMenuMode = "main";
    let flooringTexturePaths = [];
    let flooringTextureFetchPromise = null;

    function getSelectedFlooringTexture(wizardRef) {
        if (!wizardRef) return DEFAULT_FLOORING_TEXTURE;
        if (typeof wizardRef.selectedFlooringTexture === "string" && wizardRef.selectedFlooringTexture.length > 0) {
            return wizardRef.selectedFlooringTexture;
        }
        wizardRef.selectedFlooringTexture = DEFAULT_FLOORING_TEXTURE;
        return wizardRef.selectedFlooringTexture;
    }

    function getAuraDefinition(name) {
        return AURA_DEFS.find(aura => aura.name === name) || null;
    }

    function normalizeActiveAuras(wizardRef) {
        if (!wizardRef) return [];
        const source = Array.isArray(wizardRef.activeAuras)
            ? wizardRef.activeAuras
            : (typeof wizardRef.activeAura === "string" ? [wizardRef.activeAura] : []);
        const unique = [];
        source.forEach(name => {
            if (typeof name !== "string") return;
            const def = getAuraDefinition(name);
            if (!def) return;
            if (!unique.includes(def.name)) {
                unique.push(def.name);
            }
        });
        wizardRef.activeAuras = unique;
        wizardRef.activeAura = unique.length > 0 ? unique[0] : null; // backward compatibility
        return unique;
    }

    function getActiveAuraNames(wizardRef) {
        return normalizeActiveAuras(wizardRef);
    }

    function isAuraActive(wizardRef, auraName) {
        if (!wizardRef || !auraName) return false;
        return getActiveAuraNames(wizardRef).includes(auraName);
    }

    function setActiveAuras(wizardRef, auraNames) {
        if (!wizardRef) return false;
        const previous = normalizeActiveAuras(wizardRef);
        const requested = Array.isArray(auraNames) ? auraNames : [];
        const next = [];
        requested.forEach(name => {
            const def = getAuraDefinition(name);
            if (!def) return;
            if (!next.includes(def.name)) next.push(def.name);
        });
        if (previous.length === next.length && previous.every((name, index) => name === next[index])) {
            return false;
        }
        wizardRef.activeAuras = next;
        wizardRef.activeAura = next.length > 0 ? next[0] : null; // backward compatibility
        refreshAuraSelector(wizardRef);
        return true;
    }

    function toggleAura(wizardRef, auraName) {
        if (!wizardRef) return false;
        const aura = getAuraDefinition(auraName);
        if (!aura) return false;
        const active = normalizeActiveAuras(wizardRef).slice();
        const idx = active.indexOf(aura.name);
        if (idx >= 0) {
            active.splice(idx, 1);
        } else {
            active.push(aura.name);
        }
        return setActiveAuras(wizardRef, active);
    }

    function getActiveAuraMagicDrainPerSecond(wizardRef) {
        const active = normalizeActiveAuras(wizardRef);
        if (!active.length) return 0;
        let total = 0;
        active.forEach(name => {
            const aura = getAuraDefinition(name);
            if (aura && Number.isFinite(aura.magicPerSecond)) {
                total += Math.max(0, aura.magicPerSecond);
            }
        });
        return total;
    }

    function getHealingAuraHpMultiplier() {
        return Math.max(1, Number.isFinite(healingAuraHpMultiplier) ? healingAuraHpMultiplier : 5);
    }

    function setHealingAuraHpMultiplier(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return getHealingAuraHpMultiplier();
        healingAuraHpMultiplier = Math.max(1, n);
        return healingAuraHpMultiplier;
    }

    function getRoadSpellIcon(wizardRef) {
        return getSelectedFlooringTexture(wizardRef);
    }

    function getTreeVariantCount(wizardRef) {
        const textures = (
            wizardRef &&
            wizardRef.map &&
            wizardRef.map.scenery &&
            wizardRef.map.scenery.tree &&
            Array.isArray(wizardRef.map.scenery.tree.textures)
        ) ? wizardRef.map.scenery.tree.textures : null;
        return textures && textures.length > 0 ? textures.length : 5;
    }

    function getSelectedTreeTextureVariant(wizardRef) {
        if (!wizardRef) return RANDOM_TREE_VARIANT;
        if (wizardRef.selectedTreeTextureVariant === RANDOM_TREE_VARIANT) {
            return RANDOM_TREE_VARIANT;
        }
        const count = getTreeVariantCount(wizardRef);
        if (
            Number.isInteger(wizardRef.selectedTreeTextureVariant) &&
            wizardRef.selectedTreeTextureVariant >= 0 &&
            wizardRef.selectedTreeTextureVariant < count
        ) {
            return wizardRef.selectedTreeTextureVariant;
        }
        wizardRef.selectedTreeTextureVariant = RANDOM_TREE_VARIANT;
        return wizardRef.selectedTreeTextureVariant;
    }

    function getTreeSpellIcon(wizardRef) {
        const selected = getSelectedTreeTextureVariant(wizardRef);
        if (Number.isInteger(selected)) {
            return `/assets/images/tree${selected}.png`;
        }
        return "/assets/images/thumbnails/tree.png";
    }

    function quantizeToStep(value, min, max, step) {
        const v = Number(value);
        const clamped = Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
        const snapped = Math.round((clamped - min) / step) * step + min;
        const precision = Math.max(0, (String(step).split(".")[1] || "").length);
        return Number(snapped.toFixed(precision));
    }

    function getSelectedWallHeight(wizardRef) {
        if (!wizardRef) return 3.0;
        wizardRef.selectedWallHeight = quantizeToStep(
            wizardRef.selectedWallHeight,
            WALL_HEIGHT_MIN,
            WALL_HEIGHT_MAX,
            WALL_HEIGHT_STEP
        );
        return wizardRef.selectedWallHeight;
    }

    function getSelectedWallThickness(wizardRef) {
        if (!wizardRef) return 0.2;
        wizardRef.selectedWallThickness = quantizeToStep(
            wizardRef.selectedWallThickness,
            WALL_THICKNESS_MIN,
            WALL_THICKNESS_MAX,
            WALL_THICKNESS_STEP
        );
        return wizardRef.selectedWallThickness;
    }

    function fetchFlooringTextures() {
        if (flooringTexturePaths.length > 0) {
            return Promise.resolve(flooringTexturePaths);
        }
        if (flooringTextureFetchPromise) {
            return flooringTextureFetchPromise;
        }
        flooringTextureFetchPromise = fetch("/api/flooring")
            .then(response => response.json())
            .then(payload => {
                if (payload && payload.ok && Array.isArray(payload.files)) {
                    flooringTexturePaths = payload.files;
                } else {
                    flooringTexturePaths = [];
                }
                if (!flooringTexturePaths.includes(DEFAULT_FLOORING_TEXTURE)) {
                    flooringTexturePaths.unshift(DEFAULT_FLOORING_TEXTURE);
                }
                return flooringTexturePaths;
            })
            .catch(() => {
                flooringTexturePaths = [DEFAULT_FLOORING_TEXTURE];
                return flooringTexturePaths;
            })
            .finally(() => {
                flooringTextureFetchPromise = null;
            });
        return flooringTextureFetchPromise;
    }

    function cooldown(wizardRef, delayTime) {
        wizardRef.castDelay = true;
        wizardRef.casting = true;
        setTimeout(() => {
            wizardRef.castDelay = false;
            wizardRef.casting = false;
        }, 1000 * delayTime);
    }

    function stopTreeGrowthChannel(wizardRef, lockUntilRelease = false) {
        if (!wizardRef) return;
        wizardRef.treeGrowthChannel = null;
        wizardRef.treeGrowHoldLocked = !!lockUntilRelease;
    }

    function startTreeGrowthChannel(wizardRef, targetTree, growthPerSecond = 1, magicPerSecond = 15, maxSize = 10) {
        if (!wizardRef || !targetTree || typeof targetTree.applySize !== "function") return false;
        wizardRef.treeGrowHoldLocked = false;
        wizardRef.treeGrowthChannel = {
            targetTree,
            growthPerSecond,
            magicPerSecond,
            maxSize
        };
        return true;
    }

    function tickMagic(wizardRef) {
        if (!wizardRef || paused) return;
        const now = performance.now();
        if (!lastMagicTickMs) {
            lastMagicTickMs = now;
            return;
        }
        const dtSec = Math.max(0, (now - lastMagicTickMs) / 1000);
        lastMagicTickMs = now;

        const healingAuraActive = isAuraActive(wizardRef, "healing");
        const hpRegenMultiplier = healingAuraActive ? getHealingAuraHpMultiplier() : 1;
        if (wizardRef.hp < wizardRef.maxHp) {
            wizardRef.hp = Math.min(wizardRef.maxHp, wizardRef.hp + HP_REGEN_PER_SECOND * hpRegenMultiplier * dtSec);
        }
        const auraDrainPerSecond = getActiveAuraMagicDrainPerSecond(wizardRef);
        const auraActive = auraDrainPerSecond > 0;
        if (wizardRef.magic < wizardRef.maxMagic) {
            wizardRef.magic = Math.min(wizardRef.maxMagic, wizardRef.magic + MAGIC_REGEN_PER_SECOND * dtSec);
        }
        if (auraActive) {
            const auraCost = auraDrainPerSecond * dtSec;
            if (wizardRef.magic < auraCost) {
                setActiveAuras(wizardRef, []);
            } else {
                wizardRef.magic = Math.max(0, wizardRef.magic - auraCost);
            }
        }

        const channel = wizardRef.treeGrowthChannel;
        if (!channel) return;

        if (!keysPressed[" "]) {
            stopTreeGrowthChannel(wizardRef, false);
            return;
        }
        if (!channel.targetTree || channel.targetTree.gone || typeof channel.targetTree.applySize !== "function") {
            stopTreeGrowthChannel(wizardRef, false);
            return;
        }

        const currentSize = Number(channel.targetTree.size) || 4;
        if (currentSize >= channel.maxSize - 0.0001) {
            channel.targetTree.applySize(channel.maxSize);
            stopTreeGrowthChannel(wizardRef, true);
            return;
        }

        const magicCost = channel.magicPerSecond * dtSec;
        if (wizardRef.magic < magicCost) {
            stopTreeGrowthChannel(wizardRef, false);
            return;
        }

        wizardRef.magic = Math.max(0, wizardRef.magic - magicCost);
        const nextSize = Math.min(channel.maxSize, currentSize + channel.growthPerSecond * dtSec);
        channel.targetTree.applySize(nextSize);
        if (nextSize >= channel.maxSize - 0.0001) {
            stopTreeGrowthChannel(wizardRef, true);
        }
    }

    function startMagicInterval(wizardRef) {
        stopMagicInterval();
        lastMagicTickMs = performance.now();
        magicIntervalId = setInterval(() => tickMagic(wizardRef), MAGIC_TICK_MS);
    }

    function stopMagicInterval() {
        if (magicIntervalId) {
            clearInterval(magicIntervalId);
            magicIntervalId = null;
        }
        lastMagicTickMs = 0;
    }

    function ensureDragPreview(wizardRef, spellName) {
        if (!wizardRef) return null;
        if (spellName === "wall") {
            if (!wizardRef.phantomWall) {
                wizardRef.phantomWall = new PIXI.Graphics();
                wizardRef.phantomWall.skipTransform = true;
                objectLayer.addChild(wizardRef.phantomWall);
            }
            return wizardRef.phantomWall;
        }
        if (spellName === "buildroad") {
            if (!wizardRef.phantomRoad) {
                wizardRef.phantomRoad = new PIXI.Container();
                wizardRef.phantomRoad.skipTransform = true;
                objectLayer.addChild(wizardRef.phantomRoad);
            }
            return wizardRef.phantomRoad;
        }
        if (spellName === "firewall") {
            if (!wizardRef.phantomFirewall) {
                wizardRef.phantomFirewall = new PIXI.Graphics();
                wizardRef.phantomFirewall.skipTransform = true;
                objectLayer.addChild(wizardRef.phantomFirewall);
            }
            return wizardRef.phantomFirewall;
        }
        return null;
    }

    function clearDragPreview(wizardRef, spellName) {
        if (!wizardRef) return;
        if (spellName === "wall" && wizardRef.phantomWall) {
            objectLayer.removeChild(wizardRef.phantomWall);
            wizardRef.phantomWall = null;
            return;
        }
        if (spellName === "buildroad" && wizardRef.phantomRoad) {
            objectLayer.removeChild(wizardRef.phantomRoad);
            wizardRef.phantomRoad = null;
            return;
        }
        if (spellName === "firewall" && wizardRef.phantomFirewall) {
            objectLayer.removeChild(wizardRef.phantomFirewall);
            wizardRef.phantomFirewall.destroy();
            wizardRef.phantomFirewall = null;
        }
    }

    function isDragSpellActive(wizardRef, spellName) {
        if (!wizardRef) return false;
        if (spellName === "wall") return !!wizardRef.wallLayoutMode && !!wizardRef.wallStartPoint;
        if (spellName === "buildroad") return !!wizardRef.roadLayoutMode && !!wizardRef.roadStartPoint;
        if (spellName === "firewall") return !!wizardRef.firewallLayoutMode && !!wizardRef.firewallStartPoint;
        return false;
    }

    function cancelDragSpell(wizardRef, spellName) {
        if (!wizardRef) return;
        if (spellName === "wall") {
            wizardRef.wallLayoutMode = false;
            wizardRef.wallStartPoint = null;
            clearDragPreview(wizardRef, "wall");
            return;
        }
        if (spellName === "buildroad") {
            wizardRef.roadLayoutMode = false;
            wizardRef.roadStartPoint = null;
            clearDragPreview(wizardRef, "buildroad");
            return;
        }
        if (spellName === "firewall") {
            wizardRef.firewallLayoutMode = false;
            wizardRef.firewallStartPoint = null;
            clearDragPreview(wizardRef, "firewall");
        }
    }

    function getDragSpellObjectType(spellName) {
        if (spellName === "wall") return "wall";
        if (spellName === "buildroad") return "road";
        if (spellName === "firewall") return "firewall";
        return null;
    }

    function getSpellTargetHistorySet(wizardRef, spellName) {
        if (!wizardRef || !spellName) return null;
        if (!(wizardRef._spellTargetHistory instanceof Map)) {
            wizardRef._spellTargetHistory = new Map();
        }
        let setForSpell = wizardRef._spellTargetHistory.get(spellName);
        if (!(setForSpell instanceof WeakSet)) {
            setForSpell = new WeakSet();
            wizardRef._spellTargetHistory.set(spellName, setForSpell);
        }
        return setForSpell;
    }

    function hasSpellAlreadyTargetedObject(wizardRef, spellName, obj) {
        if (!wizardRef || !spellName || !obj) return false;
        const setForSpell = getSpellTargetHistorySet(wizardRef, spellName);
        return !!(setForSpell && setForSpell.has(obj));
    }

    function markObjectAsTargetedBySpell(wizardRef, spellName, obj) {
        if (!wizardRef || !spellName || !obj) return;
        const setForSpell = getSpellTargetHistorySet(wizardRef, spellName);
        if (setForSpell) {
            setForSpell.add(obj);
        }
    }

    function getSameTypeObjectTargetAt(wizardRef, spellName, worldX, worldY) {
        const objectType = getDragSpellObjectType(spellName);
        if (!wizardRef || !objectType || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const clickScreen = worldToScreen({ x: worldX, y: worldY });
        const targetCandidates = Array.from(onscreenObjects)
            .filter(obj =>
                obj &&
                !obj.gone &&
                obj.type === objectType &&
                obj.pixiSprite &&
                !hasSpellAlreadyTargetedObject(wizardRef, spellName, obj)
            )
            .sort((a, b) => worldToScreen(b).y - worldToScreen(a).y);
        for (const obj of targetCandidates) {
            if (obj.pixiSprite.containsPoint(clickScreen)) return obj;
        }
        return null;
    }

    function getGroundAnchorPointForObject(obj, worldX, worldY) {
        if (!obj) return null;
        if (
            obj.type === "wall" &&
            obj.a && obj.b &&
            Number.isFinite(obj.a.x) && Number.isFinite(obj.a.y) &&
            Number.isFinite(obj.b.x) && Number.isFinite(obj.b.y) &&
            Number.isFinite(worldX) && Number.isFinite(worldY)
        ) {
            const da = Math.hypot(worldX - obj.a.x, worldY - obj.a.y);
            const db = Math.hypot(worldX - obj.b.x, worldY - obj.b.y);
            return da <= db
                ? { x: obj.a.x, y: obj.a.y }
                : { x: obj.b.x, y: obj.b.y };
        }
        if (Number.isFinite(obj.x) && Number.isFinite(obj.y)) {
            return { x: obj.x, y: obj.y };
        }
        return null;
    }

    function getDragStartSnapTargetAt(wizardRef, spellName, worldX, worldY) {
        const obj = getSameTypeObjectTargetAt(wizardRef, spellName, worldX, worldY);
        if (!obj) return null;
        const anchor = getGroundAnchorPointForObject(obj, worldX, worldY);
        if (!anchor) return null;
        if (spellName === "wall" || spellName === "buildroad") {
            const node = wizardRef.map.worldToNode(anchor.x, anchor.y);
            if (node) return { obj, node, point: { x: node.x, y: node.y } };
        } else {
            return { obj, point: anchor };
        }
        return null;
    }

    function getHoverTargetForCurrentSpell(wizardRef, worldX, worldY) {
        if (!wizardRef || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const spell = wizardRef.currentSpell;
        if (spell === "wall" || spell === "buildroad" || spell === "firewall") {
            return getSameTypeObjectTargetAt(wizardRef, spell, worldX, worldY);
        }
        if (spell === "vanish") {
            return getObjectTargetAt(wizardRef, worldX, worldY);
        }
        return null;
    }

    function beginDragSpell(wizardRef, spellName, worldX, worldY) {
        if (!wizardRef || wizardRef.castDelay) return false;
        if (!keysPressed[" "]) return false;
        const snapTarget = getDragStartSnapTargetAt(wizardRef, spellName, worldX, worldY);

        if (spellName === "wall") {
            if (!keysPressed[" "]) return false;
            const wallNode = (snapTarget && snapTarget.node)
                ? snapTarget.node
                : wizardRef.map.worldToNode(worldX, worldY);
            if (!wallNode) return false;
            wizardRef.wallLayoutMode = true;
            wizardRef.wallStartPoint = wallNode;
            ensureDragPreview(wizardRef, "wall");
            return true;
        }

        if (spellName === "buildroad") {
            const roadNode = (snapTarget && snapTarget.node)
                ? snapTarget.node
                : wizardRef.map.worldToNode(worldX, worldY);
            if (!roadNode) return false;
            wizardRef.roadLayoutMode = true;
            wizardRef.roadStartPoint = roadNode;
            ensureDragPreview(wizardRef, "buildroad");
            return true;
        }

        if (spellName === "firewall") {
            wizardRef.firewallLayoutMode = true;
            wizardRef.firewallStartPoint = (snapTarget && snapTarget.point)
                ? { x: snapTarget.point.x, y: snapTarget.point.y }
                : { x: worldX, y: worldY };
            ensureDragPreview(wizardRef, "firewall");
            return true;
        }

        return false;
    }

    function updateDragPreview(wizardRef, worldX, worldY) {
        if (!wizardRef || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
        if (!keysPressed[" "]) {
            if (wizardRef.currentSpell === "wall") cancelDragSpell(wizardRef, "wall");
            if (wizardRef.currentSpell === "buildroad") cancelDragSpell(wizardRef, "buildroad");
            if (wizardRef.currentSpell === "firewall") cancelDragSpell(wizardRef, "firewall");
            return false;
        }
        if (wizardRef.currentSpell === "wall" && wizardRef.wallLayoutMode && wizardRef.wallStartPoint && wizardRef.phantomWall) {
            updatePhantomWall(wizardRef.wallStartPoint.x, wizardRef.wallStartPoint.y, worldX, worldY);
            return true;
        }
        if (wizardRef.currentSpell === "buildroad" && wizardRef.roadLayoutMode && wizardRef.roadStartPoint && wizardRef.phantomRoad) {
            updatePhantomRoad(wizardRef.roadStartPoint.x, wizardRef.roadStartPoint.y, worldX, worldY);
            return true;
        }
        if (wizardRef.currentSpell === "firewall" && wizardRef.firewallLayoutMode && wizardRef.firewallStartPoint && wizardRef.phantomFirewall) {
            updatePhantomFirewall(wizardRef.firewallStartPoint.x, wizardRef.firewallStartPoint.y, worldX, worldY);
            return true;
        }
        return false;
    }

    function completeDragSpell(wizardRef, spellName, worldX, worldY) {
        if (!wizardRef || wizardRef.castDelay) return false;

        if (spellName === "wall") {
            if (!isDragSpellActive(wizardRef, "wall")) return false;
            const wallNode = wizardRef.map.worldToNode(worldX, worldY);
            if (!wallNode) {
                cancelDragSpell(wizardRef, "wall");
                return true;
            }
            const nodeA = wizardRef.wallStartPoint;
            const nodeB = wallNode;
            if (nodeA === nodeB) {
                cancelDragSpell(wizardRef, "wall");
                return true;
            }
            const wallPath = wizardRef.map.getHexLine(nodeA, nodeB);
            Wall.createWallLine(
                wallPath,
                getSelectedWallHeight(wizardRef),
                getSelectedWallThickness(wizardRef),
                wizardRef.map
            );
            cancelDragSpell(wizardRef, "wall");
            cooldown(wizardRef, wizardRef.cooldownTime);
            return true;
        }

        if (spellName === "buildroad") {
            if (!isDragSpellActive(wizardRef, "buildroad")) return false;
            const roadNode = wizardRef.map.worldToNode(worldX, worldY);
            if (!roadNode) {
                cancelDragSpell(wizardRef, "buildroad");
                return true;
            }
            const nodeA = wizardRef.roadStartPoint;
            const nodeB = roadNode;
            const width = (nodeA === nodeB) ? 1 : roadWidth;
            const roadNodes = wizardRef.map.getHexLine(nodeA, nodeB, width);
            roadNodes.forEach(node => {
                const hasRoad = node.objects && node.objects.some(obj => obj.type === "road");
                if (!hasRoad) {
                    new Road({x: node.x, y: node.y}, [], wizardRef.map, {
                        fillTexturePath: getSelectedFlooringTexture(wizardRef)
                    });
                }
            });
            wizardRef.magic -= 5;
            cancelDragSpell(wizardRef, "buildroad");
            cooldown(wizardRef, wizardRef.cooldownTime);
            return true;
        }

        if (spellName === "firewall") {
            if (!isDragSpellActive(wizardRef, "firewall")) return false;
            const startPoint = wizardRef.firewallStartPoint;
            const endPoint = { x: worldX, y: worldY };
            const dx = endPoint.x - startPoint.x;
            const dy = endPoint.y - startPoint.y;
            const dist = Math.hypot(dx, dy);
            const spacing = 0.5;
            const steps = Math.max(1, Math.ceil(dist / spacing));

            for (let i = 0; i <= steps; i++) {
                const t = steps === 0 ? 0 : i / steps;
                const px = startPoint.x + dx * t;
                const py = startPoint.y + dy * t;
                new FirewallEmitter({ x: px, y: py }, wizardRef.map);
            }
            cancelDragSpell(wizardRef, "firewall");
            cooldown(wizardRef, wizardRef.cooldownTime);
            return true;
        }

        return false;
    }

    function getNearbyObjects(mapRef, hitbox) {
        if (!mapRef || !hitbox || typeof hitbox.getBounds !== "function") return [];
        const bounds = hitbox.getBounds();
        if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
            return [];
        }

        const margin = 1.0;
        const minNode = mapRef.worldToNode(bounds.x - margin, bounds.y - margin);
        const maxNode = mapRef.worldToNode(bounds.x + bounds.width + margin, bounds.y + bounds.height + margin);
        if (!minNode || !maxNode) return [];

        const xStart = Math.max(0, Math.min(minNode.xindex, maxNode.xindex));
        const xEnd = Math.min(mapRef.width - 1, Math.max(minNode.xindex, maxNode.xindex));
        const yStart = Math.max(0, Math.min(minNode.yindex, maxNode.yindex));
        const yEnd = Math.min(mapRef.height - 1, Math.max(minNode.yindex, maxNode.yindex));
        const nearbyObjects = [];
        const seen = new Set();

        for (let x = xStart; x <= xEnd; x++) {
            for (let y = yStart; y <= yEnd; y++) {
                const node = mapRef.nodes[x] && mapRef.nodes[x][y] ? mapRef.nodes[x][y] : null;
                if (!node || !Array.isArray(node.objects) || node.objects.length === 0) continue;
                for (const obj of node.objects) {
                    if (!obj || obj.gone) continue;
                    if (seen.has(obj)) continue;
                    seen.add(obj);
                    nearbyObjects.push(obj);
                }
            }
        }

        return nearbyObjects;
    }

    function updateCharacterObjectCollisions(wizardRef) {
        if (!wizardRef || !wizardRef.map) return;
        const targets = [];
        if (!wizardRef.gone && !wizardRef.dead) targets.push(wizardRef);
        if (Array.isArray(animals)) {
            for (const animal of animals) {
                if (!animal || animal.gone || animal.dead) continue;
                targets.push(animal);
            }
        }

        for (const target of targets) {
            const targetHitbox = target.visualHitbox || target.groundPlaneHitbox || target.hitbox;
            if (!targetHitbox) continue;
            const nearbyObjects = getNearbyObjects(wizardRef.map, targetHitbox);
            for (const obj of nearbyObjects) {
                if (!obj || typeof obj.handleCharacterCollision !== "function") continue;
                obj.handleCharacterCollision(target);
            }
        }
    }

    function getObjectTargetAt(wizardRef, worldX, worldY) {
        let clickTarget = null;
        const clickScreen = worldToScreen({x: worldX, y: worldY});
        const activeSpell = wizardRef ? wizardRef.currentSpell : null;
        const targetCandidates = Array.from(onscreenObjects)
            .filter(obj =>
                obj &&
                !obj.gone &&
                !obj.vanishing &&
                !hasSpellAlreadyTargetedObject(wizardRef, activeSpell, obj)
            )
            .sort((a, b) => worldToScreen(b).y - worldToScreen(a).y);

        for (const obj of targetCandidates) {
            if (obj.pixiSprite && obj.pixiSprite.containsPoint(clickScreen)) {
                clickTarget = obj;
                break;
            }
        }

        if (wizardRef.currentSpell === "vanish") {
            const clickedNode = wizardRef.map.worldToNode(worldX, worldY);
            if (clickedNode && clickedNode.objects && clickedNode.objects.length > 0) {
                const roadTarget = clickedNode.objects.find(obj =>
                    obj &&
                    obj.type === "road" &&
                    !obj.gone &&
                    !obj.vanishing &&
                    !hasSpellAlreadyTargetedObject(wizardRef, wizardRef.currentSpell, obj)
                );
                if (roadTarget) {
                    clickTarget = roadTarget;
                }
            }
        }

        return clickTarget;
    }

    function castWizardSpell(wizardRef, worldX, worldY) {
        if (!wizardRef || wizardRef.castDelay) return;

        if (wizardRef.currentSpell === "wall") {
            if (isDragSpellActive(wizardRef, "wall")) {
                completeDragSpell(wizardRef, "wall", worldX, worldY);
            } else {
                beginDragSpell(wizardRef, "wall", worldX, worldY);
            }
            return;
        }

        if (wizardRef.currentSpell === "buildroad") {
            if (isDragSpellActive(wizardRef, "buildroad")) {
                completeDragSpell(wizardRef, "buildroad", worldX, worldY);
            } else {
                beginDragSpell(wizardRef, "buildroad", worldX, worldY);
            }
            return;
        }

        if (wizardRef.currentSpell === "firewall") {
            if (isDragSpellActive(wizardRef, "firewall")) {
                completeDragSpell(wizardRef, "firewall", worldX, worldY);
            } else {
                beginDragSpell(wizardRef, "firewall", worldX, worldY);
            }
            return;
        }

        let clickTarget = getObjectTargetAt(wizardRef, worldX, worldY);
        if (wizardRef.currentSpell === "treegrow") clickTarget = null;
        if (
            wizardRef.currentSpell === "treegrow" &&
            keysPressed[" "] &&
            (
                wizardRef.treeGrowHoldLocked ||
                (
                    wizardRef.treeGrowthChannel &&
                    wizardRef.treeGrowthChannel.targetTree &&
                    !wizardRef.treeGrowthChannel.targetTree.gone
                )
            )
        ) {
            return;
        }
        let projectile = null;

        if (wizardRef.currentSpell === "grenades") {
            if (!wizardRef.inventory.includes("grenades") || wizardRef.inventory.grenades <= 0) return;
            wizardRef.inventory.grenades--;
            projectile = new Grenade();
        } else if (wizardRef.currentSpell === "rocks") {
            projectile = new Rock();
        } else if (wizardRef.currentSpell === "fireball") {
            projectile = new Fireball();
        } else if (wizardRef.currentSpell === "vanish") {
            projectile = new Vanish();
        } else if (wizardRef.currentSpell === "treegrow") {
            projectile = new TreeGrow();
        } else if (wizardRef.currentSpell === "buildroad") {
            projectile = new BuildRoad();
        }

        if (!projectile) return;
        if (clickTarget) {
            projectile.forcedTarget = clickTarget;
            markObjectAsTargetedBySpell(wizardRef, wizardRef.currentSpell, clickTarget);
        }
        const delayTime = projectile.delayTime || wizardRef.cooldownTime;
        wizardRef.castDelay = true;
        projectiles.push(projectile.cast(worldX, worldY));
        wizardRef.casting = true;
        setTimeout(() => {
            wizardRef.castDelay = false;
            wizardRef.casting = false;
        }, 1000 * delayTime);
    }

    function buildSpellList(wizardRef) {
        return SPELL_DEFS.map(spell => {
            const key = spell.name === "firewall"
                ? "F+W"
                : Object.keys(spellKeyBindings).find(k => spellKeyBindings[k] === spell.name);
            if (spell.name === "buildroad") {
                return {...spell, key, icon: getRoadSpellIcon(wizardRef)};
            }
            if (spell.name === "treegrow") {
                return {...spell, key, icon: getTreeSpellIcon(wizardRef)};
            }
            return {...spell, key};
        });
    }

    function refreshAuraSelector(wizardRef) {
        const $selectedAura = $("#selectedAura");
        if ($selectedAura.length) {
            $selectedAura.css("background-image", `url('${AURA_MENU_ICON}')`);
        }

        const activeAuraNames = getActiveAuraNames(wizardRef);
        const $activeAuraIcons = $("#activeAuraIcons");
        if ($activeAuraIcons.length) {
            $activeAuraIcons.empty();
            activeAuraNames.forEach(name => {
                const auraDef = getAuraDefinition(name);
                if (!auraDef) return;
                const badge = $("<div>")
                    .addClass("activeAuraIconBadge")
                    .css("background-image", `url('${auraDef.icon}')`);
                $activeAuraIcons.append(badge);
            });
            if (activeAuraNames.length > 0) {
                $activeAuraIcons.removeClass("hidden");
            } else {
                $activeAuraIcons.addClass("hidden");
            }
        }

        const $grid = $("#auraGrid");
        if (!$grid.length) return;
        $grid.empty();

        AURA_DEFS.forEach(aura => {
            const auraIcon = $("<div>")
                .addClass("auraIcon")
                .css({
                    "background-image": `url('${aura.icon}')`,
                    "position": "relative"
                })
                .attr("data-aura", aura.name)
                .attr("title", aura.name)
                .click(() => {
                    toggleAura(wizardRef, aura.name);
                });

            if (aura.key) {
                const keyLabel = $("<span>")
                    .addClass("spellKeyBinding")
                    .text(aura.key)
                    .css({
                        "position": "absolute",
                        "top": "4px",
                        "left": "4px",
                        "color": "white",
                        "font-size": "12px",
                        "font-weight": "bold",
                        "pointer-events": "none",
                        "text-shadow": "1px 1px 2px rgba(0, 0, 0, 0.8)",
                        "z-index": "10"
                    });
                auraIcon.append(keyLabel);
            }

            if (activeAuraNames.includes(aura.name)) {
                auraIcon.addClass("selected");
            }
            $grid.append(auraIcon);
        });
    }

    function renderFlooringSelector(wizardRef) {
        const $grid = $("#spellGrid");
        $grid.empty();
        $grid.css({
            display: "",
            "flex-direction": "",
            gap: ""
        });
        const backButton = $("<div>")
            .addClass("spellIcon")
            .css({
                "display": "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "13px",
                "font-weight": "bold",
                "color": "#ffffff",
                "background": "rgba(20,20,20,0.9)"
            })
            .text("Back")
            .click(() => {
                spellMenuMode = "main";
                refreshSpellSelector(wizardRef);
            });
        $grid.append(backButton);

        const selected = getSelectedFlooringTexture(wizardRef);
        flooringTexturePaths.forEach(texturePath => {
            const icon = $("<div>")
                .addClass("spellIcon")
                .css({
                    "background-image": `url('${texturePath}')`,
                    "background-size": "cover",
                    "background-position": "center center"
                })
                .attr("title", texturePath.split("/").pop() || texturePath)
                .click(() => {
                    wizardRef.selectedFlooringTexture = texturePath;
                    spellMenuMode = "main";
                    setCurrentSpell(wizardRef, "buildroad");
                    $("#spellMenu").addClass("hidden");
                });
            if (texturePath === selected) {
                icon.addClass("selected");
            }
            $grid.append(icon);
        });
    }

    function openFlooringSelector(wizardRef) {
        spellMenuMode = "flooring";
        $("#spellMenu").removeClass("hidden");
        renderFlooringSelector(wizardRef);
        fetchFlooringTextures().then(() => {
            if (spellMenuMode === "flooring") {
                renderFlooringSelector(wizardRef);
            }
        });
    }

    function renderTreeSelector(wizardRef) {
        const $grid = $("#spellGrid");
        $grid.empty();
        $grid.css({
            display: "",
            "flex-direction": "",
            gap: ""
        });
        const backButton = $("<div>")
            .addClass("spellIcon")
            .css({
                "display": "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "13px",
                "font-weight": "bold",
                "color": "#ffffff",
                "background": "rgba(20,20,20,0.9)"
            })
            .text("Back")
            .click(() => {
                spellMenuMode = "main";
                refreshSpellSelector(wizardRef);
            });
        $grid.append(backButton);

        const selected = getSelectedTreeTextureVariant(wizardRef);
        const randomIcon = $("<div>")
            .addClass("spellIcon")
            .css({
                "display": "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "36px",
                "font-weight": "bold",
                "color": "#ffffff",
                "background": "rgba(20,20,20,0.9)",
                "line-height": "1"
            })
            .attr("title", "Random Tree")
            .text("?")
            .click(() => {
                wizardRef.selectedTreeTextureVariant = RANDOM_TREE_VARIANT;
                spellMenuMode = "main";
                setCurrentSpell(wizardRef, "treegrow");
                $("#spellMenu").addClass("hidden");
            });
        if (selected === RANDOM_TREE_VARIANT) {
            randomIcon.addClass("selected");
        }
        $grid.append(randomIcon);

        const variantCount = getTreeVariantCount(wizardRef);
        for (let textureIndex = 0; textureIndex < variantCount; textureIndex++) {
            const texturePath = `/assets/images/tree${textureIndex}.png`;
            const icon = $("<div>")
                .addClass("spellIcon")
                .css({
                    "background-image": `url('${texturePath}')`,
                    "background-size": "cover",
                    "background-position": "center center"
                })
                .attr("title", `Tree ${textureIndex}`)
                .click(() => {
                    wizardRef.selectedTreeTextureVariant = textureIndex;
                    spellMenuMode = "main";
                    setCurrentSpell(wizardRef, "treegrow");
                    $("#spellMenu").addClass("hidden");
                });
            if (textureIndex === selected) {
                icon.addClass("selected");
            }
            $grid.append(icon);
        }
    }

    function openTreeSelector(wizardRef) {
        spellMenuMode = "tree";
        $("#spellMenu").removeClass("hidden");
        renderTreeSelector(wizardRef);
    }

    function renderWallSelector(wizardRef) {
        const $grid = $("#spellGrid");
        $grid.empty();
        $grid.css({
            display: "flex",
            "flex-direction": "column",
            gap: "10px",
            color: "#ffffff",
            "min-width": "220px"
        });

        const $back = $("<button>")
            .text("Back")
            .css({
                "align-self": "flex-start",
                padding: "4px 8px",
                "font-size": "12px",
                cursor: "pointer",
                color: "#ffffff",
                background: "rgba(20,20,20,0.95)",
                border: "1px solid #ffd700",
                "border-radius": "4px"
            })
            .on("click", () => {
                spellMenuMode = "main";
                refreshSpellSelector(wizardRef);
            });
        $grid.append($back);

        const wallHeight = getSelectedWallHeight(wizardRef);
        const wallThickness = getSelectedWallThickness(wizardRef);

        const $heightLabel = $("<div>")
            .text(`Height: ${wallHeight.toFixed(1)}`)
            .css({ color: "#ffffff", "font-size": "13px" });
        const $heightSlider = $("<input>")
            .attr({
                type: "range",
                min: WALL_HEIGHT_MIN,
                max: WALL_HEIGHT_MAX,
                step: WALL_HEIGHT_STEP,
                value: wallHeight
            })
            .css({
                width: "100%",
                "accent-color": "#ffd700",
                cursor: "pointer"
            })
            .on("input change", event => {
                const value = quantizeToStep(event.target.value, WALL_HEIGHT_MIN, WALL_HEIGHT_MAX, WALL_HEIGHT_STEP);
                wizardRef.selectedWallHeight = value;
                $heightLabel.text(`Height: ${value.toFixed(1)}`);
            });

        const $thicknessLabel = $("<div>")
            .text(`Thickness: ${wallThickness.toFixed(3)}`)
            .css({ color: "#ffffff", "font-size": "13px" });
        const $thicknessSlider = $("<input>")
            .attr({
                type: "range",
                min: WALL_THICKNESS_MIN,
                max: WALL_THICKNESS_MAX,
                step: WALL_THICKNESS_STEP,
                value: wallThickness
            })
            .css({
                width: "100%",
                "accent-color": "#ffd700",
                cursor: "pointer"
            })
            .on("input change", event => {
                const value = quantizeToStep(event.target.value, WALL_THICKNESS_MIN, WALL_THICKNESS_MAX, WALL_THICKNESS_STEP);
                wizardRef.selectedWallThickness = value;
                $thicknessLabel.text(`Thickness: ${value.toFixed(3)}`);
            });

        $grid.append($("<div>").text("Wall Height").css({ color: "#ffffff", "font-weight": "bold" }));
        $grid.append($heightSlider);
        $grid.append($heightLabel);
        $grid.append($("<div>").text("Wall Thickness").css({ color: "#ffffff", "font-weight": "bold" }));
        $grid.append($thicknessSlider);
        $grid.append($thicknessLabel);
    }

    function openWallSelector(wizardRef) {
        spellMenuMode = "wall";
        $("#spellMenu").removeClass("hidden");
        renderWallSelector(wizardRef);
    }

    function refreshSpellSelector(wizardRef) {
        if (!wizardRef) return;
        if (spellMenuMode === "flooring") {
            renderFlooringSelector(wizardRef);
            return;
        }
        if (spellMenuMode === "tree") {
            renderTreeSelector(wizardRef);
            return;
        }
        if (spellMenuMode === "wall") {
            renderWallSelector(wizardRef);
            return;
        }
        $("#spellGrid").css({
            display: "",
            "flex-direction": "",
            gap: ""
        });
        wizardRef.spells = buildSpellList(wizardRef);
        const currentSpell = wizardRef.spells.find(s => s.name === wizardRef.currentSpell);
        if (currentSpell) {
            $("#selectedSpell").css("background-image", `url('${currentSpell.icon}')`);
        }

        $("#spellGrid").empty();
        wizardRef.spells.forEach(spell => {
            const spellIcon = $("<div>")
                .addClass("spellIcon")
                .css({
                    "background-image": `url('${spell.icon}')`,
                    "position": "relative"
                })
                .attr("data-spell", spell.name)
                .click(() => {
                    setCurrentSpell(wizardRef, spell.name);
                    $("#spellMenu").addClass("hidden");
                });

            if (spell.name === "buildroad") {
                spellIcon.on("contextmenu", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openFlooringSelector(wizardRef);
                });
            } else if (spell.name === "wall") {
                spellIcon.on("contextmenu", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openWallSelector(wizardRef);
                });
            } else if (spell.name === "treegrow") {
                spellIcon.on("contextmenu", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openTreeSelector(wizardRef);
                });
            }

            if (spell.key) {
                const keyLabel = $("<span>")
                    .addClass("spellKeyBinding")
                    .text(spell.key)
                    .css({
                        "position": "absolute",
                        "top": "4px",
                        "left": "4px",
                        "color": "white",
                        "font-size": "12px",
                        "font-weight": "bold",
                        "pointer-events": "none",
                        "text-shadow": "1px 1px 2px rgba(0, 0, 0, 0.8)",
                        "z-index": "10"
                    });
                spellIcon.append(keyLabel);
            }

            if (spell.name === wizardRef.currentSpell) {
                spellIcon.addClass("selected");
            }
            $("#spellGrid").append(spellIcon);
        });
    }

    function setCurrentSpell(wizardRef, spellName) {
        if (!wizardRef) return;
        const previousSpell = wizardRef.currentSpell;
        spellMenuMode = "main";
        if (spellName !== "wall") cancelDragSpell(wizardRef, "wall");
        if (spellName !== "buildroad") cancelDragSpell(wizardRef, "buildroad");
        if (spellName !== "firewall") cancelDragSpell(wizardRef, "firewall");
        wizardRef.currentSpell = spellName;
        if (previousSpell !== spellName) {
            const setForSpell = getSpellTargetHistorySet(wizardRef, spellName);
            if (setForSpell) {
                wizardRef._spellTargetHistory.set(spellName, new WeakSet());
            }
        }
        wizardRef.spells = buildSpellList(wizardRef);
        refreshSpellSelector(wizardRef);
        if (wizardRef.currentSpell !== "treegrow") {
            stopTreeGrowthChannel(wizardRef, false);
        }
    }

    function initWizardSpells(wizardRef) {
        if (!wizardRef) return;
        getSelectedFlooringTexture(wizardRef);
        getSelectedTreeTextureVariant(wizardRef);
        getSelectedWallHeight(wizardRef);
        getSelectedWallThickness(wizardRef);
        wizardRef.spells = buildSpellList(wizardRef);
        normalizeActiveAuras(wizardRef);
        if (!wizardRef.currentSpell || !wizardRef.spells.some(s => s.name === wizardRef.currentSpell)) {
            wizardRef.currentSpell = "wall";
        }
        wizardRef.refreshSpellSelector = () => refreshSpellSelector(wizardRef);
        refreshSpellSelector(wizardRef);
        refreshAuraSelector(wizardRef);
        fetchFlooringTextures();
    }

    function showMainSpellMenu(wizardRef) {
        if (!wizardRef) return;
        spellMenuMode = "main";
        wizardRef.spells = buildSpellList(wizardRef);
        refreshSpellSelector(wizardRef);
    }

    function showFlooringMenu(wizardRef) {
        if (!wizardRef) return;
        setCurrentSpell(wizardRef, "buildroad");
        openFlooringSelector(wizardRef);
    }

    function showTreeMenu(wizardRef) {
        if (!wizardRef) return;
        setCurrentSpell(wizardRef, "treegrow");
        openTreeSelector(wizardRef);
    }

    function showWallMenu(wizardRef) {
        if (!wizardRef) return;
        setCurrentSpell(wizardRef, "wall");
        openWallSelector(wizardRef);
    }

    function primeSpellAssets() {
        Fireball.getFrames();
    }

    return {
        castWizardSpell,
        initWizardSpells,
        refreshSpellSelector,
        refreshAuraSelector,
        setCurrentSpell,
        toggleAura,
        isAuraActive,
        showMainSpellMenu,
        showFlooringMenu,
        showTreeMenu,
        showWallMenu,
        beginDragSpell,
        updateDragPreview,
        completeDragSpell,
        cancelDragSpell,
        isDragSpellActive,
        primeSpellAssets,
        startMagicInterval,
        stopMagicInterval,
        setHealingAuraHpMultiplier,
        startTreeGrowthChannel,
        stopTreeGrowthChannel,
        updateCharacterObjectCollisions
        ,
        getHoverTargetForCurrentSpell
    };
})();
