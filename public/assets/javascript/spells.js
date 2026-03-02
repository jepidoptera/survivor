let spellKeyBindings = {
    "F": "fireball",
    "B": "wall",
    "D": "blackdiamond",
    "M": "maze",
    "V": "vanish",
    "T": "treegrow",
    "J": "teleport",
    "R": "buildroad",
    "FW": "firewall"
};

const MAGIC_ITEMS_CATEGORY = "magic";

function resolveAnimatedSheetConfig(metaEntry, fallbackX = 1, fallbackY = 1, fallbackFps = 0) {
    const meta = (metaEntry && typeof metaEntry === "object") ? metaEntry : {};
    const frameCountObj = (meta.framecount && typeof meta.framecount === "object")
        ? meta.framecount
        : ((meta.frameCount && typeof meta.frameCount === "object") ? meta.frameCount : null);
    const frameCountX = Number.isFinite(meta.framecount_x)
        ? Number(meta.framecount_x)
        : (Number.isFinite(meta.frameCountX)
            ? Number(meta.frameCountX)
            : (Number.isFinite(frameCountObj && frameCountObj.x) ? Number(frameCountObj.x) : fallbackX));
    const frameCountY = Number.isFinite(meta.framecount_y)
        ? Number(meta.framecount_y)
        : (Number.isFinite(meta.frameCountY)
            ? Number(meta.frameCountY)
            : (Number.isFinite(frameCountObj && frameCountObj.y) ? Number(frameCountObj.y) : fallbackY));
    const animatedFps = Number.isFinite(meta.animated_fps)
        ? Number(meta.animated_fps)
        : (Number.isFinite(meta.animatedFps) ? Number(meta.animatedFps) : fallbackFps);
    return {
        frameCountX: Math.max(1, Math.floor(frameCountX) || Math.floor(fallbackX) || 1),
        frameCountY: Math.max(1, Math.floor(frameCountY) || Math.floor(fallbackY) || 1),
        animatedFps: Math.max(0, Number(animatedFps) || 0)
    };
}

async function getMagicAssetMetadata(texturePath) {
    if (
        !(typeof globalThis !== "undefined" && typeof globalThis.getResolvedPlaceableMetadata === "function") ||
        typeof texturePath !== "string" ||
        texturePath.length === 0
    ) {
        return null;
    }
    try {
        return await globalThis.getResolvedPlaceableMetadata(MAGIC_ITEMS_CATEGORY, texturePath);
    } catch (_) {
        return null;
    }
}

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
                this.detachPixiSprite();
            }, 3000);
            clearInterval(this.castInterval);
        }
    }
    land() {
    }

    detachPixiSprite() {
        if (!this.pixiSprite) return;
        if (this.pixiSprite.parent) {
            this.pixiSprite.parent.removeChild(this.pixiSprite);
        }
        this.pixiSprite = null;
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
    static frameSourcePath = "/assets/images/magic/hi%20fi%20fireball.png";
    static frameCountX = 5;
    static frameCountY = 2;
    static animatedFps = 12;
    static _metadataLoadPromise = null;
    static _metadataLoaded = false;

    static ensureMagicMetadataLoaded() {
        if (Fireball._metadataLoaded) return;
        if (Fireball._metadataLoadPromise) return;
        Fireball._metadataLoadPromise = getMagicAssetMetadata(Fireball.frameSourcePath)
            .then(meta => {
                if (!meta) return;
                const cfg = resolveAnimatedSheetConfig(
                    meta,
                    Fireball.frameCountX,
                    Fireball.frameCountY,
                    Fireball.animatedFps
                );
                const changed = (
                    cfg.frameCountX !== Fireball.frameCountX ||
                    cfg.frameCountY !== Fireball.frameCountY
                );
                Fireball.frameCountX = cfg.frameCountX;
                Fireball.frameCountY = cfg.frameCountY;
                Fireball.animatedFps = cfg.animatedFps;
                if (changed) {
                    Fireball.frames = null;
                }
            })
            .catch(() => null)
            .finally(() => {
                Fireball._metadataLoaded = true;
                Fireball._metadataLoadPromise = null;
            });
    }

    static getFrames() {
        Fireball.ensureMagicMetadataLoaded();
        if (Array.isArray(Fireball.frames) && Fireball.frames.length > 0) {
            return Fireball.frames;
        }
        const preloadedResource = PIXI.Loader.shared.resources[Fireball.frameSourcePath];
        const baseTexture = (preloadedResource && preloadedResource.texture && preloadedResource.texture.baseTexture)
            ? preloadedResource.texture.baseTexture
            : PIXI.Texture.from(Fireball.frameSourcePath).baseTexture;
        if (!baseTexture || !baseTexture.valid) return null;

        const frames = [];
        const cols = Math.max(1, Math.floor(Fireball.frameCountX) || 1);
        const rows = Math.max(1, Math.floor(Fireball.frameCountY) || 1);
        const frameWidth = baseTexture.width / cols;
        const frameHeight = baseTexture.height / rows;

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                frames.push(
                    new PIXI.Texture(baseTexture, new PIXI.Rectangle(col * frameWidth, row * frameHeight, frameWidth, frameHeight))
                );
            }
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
                this.detachPixiSprite();
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


const VANISH_DEFAULT_SPEED = 10;
const VANISH_DEFAULT_RANGE = 20;
const VANISH_REMOVE_WIDTH_WORLD = 1;

function buildVanishTravelPlan(casterX, casterY, targetX, targetY, options = {}) {
    const originX = Number(casterX);
    const originY = Number(casterY);
    const aimX = Number(targetX);
    const aimY = Number(targetY);
    if (!Number.isFinite(originX) || !Number.isFinite(originY) || !Number.isFinite(aimX) || !Number.isFinite(aimY)) {
        return null;
    }

    const speed = Number.isFinite(options.speed) ? Math.max(0.0001, Number(options.speed)) : VANISH_DEFAULT_SPEED;
    const range = Number.isFinite(options.range) ? Math.max(0.0001, Number(options.range)) : VANISH_DEFAULT_RANGE;
    const frameRateValue = Number.isFinite(options.frameRateValue)
        ? Math.max(1, Number(options.frameRateValue))
        : Math.max(1, Number.isFinite(frameRate) ? Number(frameRate) : 60);
    const mapRef = options.mapRef || null;

    let xdist = aimX - originX;
    let ydist = aimY - originY;
    let totalDist = Math.hypot(xdist, ydist);

    if (totalDist < 0.1) {
        totalDist = 0.1;
        xdist = 0.1;
        ydist = 0;
    }

    if (totalDist > range) {
        const fraction = range / totalDist;
        ydist *= fraction;
        xdist *= fraction;
        totalDist = range;
    }

    const stepX = (xdist / totalDist) * (speed / frameRateValue);
    const stepY = (ydist / totalDist) * (speed / frameRateValue);
    const stepDist = Math.hypot(stepX, stepY);
    if (!(stepDist > 0)) return null;

    return {
        originX,
        originY,
        targetX: aimX,
        targetY: aimY,
        totalDist,
        stepX,
        stepY,
        stepDist,
        speed,
        range,
        frameRateValue,
        mapRef
    };
}

function predictVanishImpactPoint(plan) {
    if (!plan) return null;
    const mapRef = plan.mapRef || null;
    let x = Number(plan.originX);
    let y = Number(plan.originY);
    const stepX = Number(plan.stepX);
    const stepY = Number(plan.stepY);
    const stepDist = Number(plan.stepDist);
    const totalDist = Number(plan.totalDist);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(stepX) || !Number.isFinite(stepY)) return null;
    if (!(stepDist > 0) || !(totalDist > 0)) return null;

    // Mirror Vanish.cast(): one immediate pre-step before interval begins.
    x += stepX;
    y += stepY;

    let traveledDist = 0;
    const maxTicks = Math.max(1, Math.ceil(totalDist / stepDist) + 8);
    for (let tick = 0; tick < maxTicks; tick++) {
        x += stepX;
        y += stepY;
        if (mapRef && typeof mapRef.wrapWorldX === "function") {
            x = mapRef.wrapWorldX(x);
        }
        if (mapRef && typeof mapRef.wrapWorldY === "function") {
            y = mapRef.wrapWorldY(y);
        }
        traveledDist += stepDist;
        if (traveledDist >= totalDist) {
            return { x, y };
        }
    }

    return { x, y };
}


class Vanish extends Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/thumbnails/vanish.png";
        this.gravity = 0; // No arc - straight line
        this.speed = VANISH_DEFAULT_SPEED;
        this.range = VANISH_DEFAULT_RANGE;
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
        const travelPlan = buildVanishTravelPlan(this.x, this.y, targetX, targetY, {
            speed: this.speed,
            range: this.range,
            frameRateValue: frameRate,
            mapRef: this.map || wizard.map || null
        });
        if (!travelPlan) {
            this.visible = false;
            return this;
        }

        this.totalDist = travelPlan.totalDist;
        this.movement = {
            x: travelPlan.stepX,
            y: travelPlan.stepY,
            z: 0,
        };
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
                        this.vanishTarget(obj, { x: this.x, y: this.y });
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
        this.detachPixiSprite();
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
                this.vanishTarget(obj, { x: this.x, y: this.y });
                this.deactivate();
            }
        }
    }
    
    vanishTarget(target, impactPoint = null) {
        if (
            target &&
            target.type === "wallSection" &&
            !target._vanishAsWholeSection &&
            typeof target.vanishAroundPoint === "function" &&
            impactPoint &&
            Number.isFinite(impactPoint.x) &&
            Number.isFinite(impactPoint.y)
        ) {
            const vanishFrames = 0.25 * frameRate;
            const handled = target.vanishAroundPoint(
                { x: Number(impactPoint.x), y: Number(impactPoint.y) },
                { removeWidthWorld: VANISH_REMOVE_WIDTH_WORLD, vanishDurationFrames: vanishFrames }
            );
            if (handled) return;
        }

        // Mark as vanishing to avoid hitting multiple times
        target.vanishing = true;
        target.vanishStartTime = frameCount;
        target.vanishDuration = 0.25 * frameRate; // 1/4 second fade (after 1-frame flash)
        target.percentVanished = 0;
        if (target.type === "wallSection" && target._vanishAsWholeSection) {
            target._disableChunkSplitOnVanish = true;
        }
        if (impactPoint && Number.isFinite(impactPoint.x) && Number.isFinite(impactPoint.y)) {
            target._vanishWorldPoint = {
                x: Number(impactPoint.x),
                y: Number(impactPoint.y)
            };
        } else {
            target._vanishWorldPoint = null;
        }
        if (target._vanishFinalizeTimeout) {
            clearTimeout(target._vanishFinalizeTimeout);
        }
        const finalizeAfterMs = Math.max(0, (target.vanishDuration / Math.max(1, frameRate)) * 1000);
        target._vanishFinalizeTimeout = setTimeout(() => {
            if (!target || target.gone) return;
            if (typeof target.removeFromGame === "function") {
                target.removeFromGame();
            } else if (typeof target.remove === "function") {
                target.remove();
            } else if (typeof target.delete === "function") {
                // Backward compatibility for entities not yet migrated.
                target.delete();
            } else {
                target.gone = true;
            }
            target._vanishWorldPoint = null;
            target.vanishing = false;
            target._vanishAsWholeSection = false;
            target._vanishFinalizeTimeout = null;
        }, finalizeAfterMs);
    }
}

class Teleport extends Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/thumbnails/vanish.png";
        this.gravity = 0;
        this.speed = 0;
        this.range = Infinity;
        this.bounces = 0;
        this.apparentSize = 0;
        this.delayTime = 0;
        this.magicCost = 5;
        this.radius = 0;
    }

    cast(targetX, targetY) {
        if (!wizard || !wizard.map) return this;
        if (wizard.magic < this.magicCost) {
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

        wizard.magic -= this.magicCost;
        wizard.x = destinationX;
        wizard.y = destinationY;
        wizard.node = wizard.map.worldToNode(destinationX, destinationY) || wizard.node;
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
        this.detachPixiSprite();
        
        return this;
    }
}

class PlaceObject extends Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.gravity = 0;
        this.speed = 0;
        this.range = 20;
        this.bounces = 0;
        this.apparentSize = 0;
        this.delayTime = 0;
        this.magicCost = 0;
        this.radius = 0;
    }

    cast(targetX, targetY) {
        const wrappedX = (wizard.map && typeof wizard.map.wrapWorldX === "function")
            ? wizard.map.wrapWorldX(targetX)
            : targetX;
        const wrappedY = (wizard.map && typeof wizard.map.wrapWorldY === "function")
            ? wizard.map.wrapWorldY(targetY)
            : targetY;
        if (!Number.isFinite(wrappedX) || !Number.isFinite(wrappedY)) {
            message("Cannot place object there!");
            return this;
        }
        if (typeof PlacedObject !== "function") {
            message("Object placement is unavailable.");
            return this;
        }

        const selectedTexturePath = (
            wizard &&
            typeof wizard.selectedPlaceableTexturePath === "string" &&
            wizard.selectedPlaceableTexturePath.length > 0
        ) ? wizard.selectedPlaceableTexturePath : "/assets/images/doors/door5.png";
        const selectedCategory = (
            wizard &&
            typeof wizard.selectedPlaceableCategory === "string" &&
            wizard.selectedPlaceableCategory.length > 0
        ) ? wizard.selectedPlaceableCategory : "doors";
        const renderDepthOffset = (wizard && Number.isFinite(wizard.selectedPlaceableRenderOffset))
            ? Number(wizard.selectedPlaceableRenderOffset)
            : 0;
        const placeableScale = (wizard && Number.isFinite(wizard.selectedPlaceableScale))
            ? Number(wizard.selectedPlaceableScale)
            : 1;
        const clampedScale = Math.max(0.2, Math.min(5, placeableScale));
        const selectedAnchorX = (wizard && Number.isFinite(wizard.selectedPlaceableAnchorX))
            ? Number(wizard.selectedPlaceableAnchorX)
            : 0.5;
        const selectedAnchorY = (wizard && Number.isFinite(wizard.selectedPlaceableAnchorY))
            ? Number(wizard.selectedPlaceableAnchorY)
            : 1;
        const placementRotation = (wizard && Number.isFinite(wizard.selectedPlaceableRotation))
            ? Number(wizard.selectedPlaceableRotation)
            : 0;
        const rotationAxisRaw = wizard ? wizard.selectedPlaceableRotationAxis : null;
        const rotationAxisNormalized = (typeof rotationAxisRaw === "string")
            ? rotationAxisRaw.trim().toLowerCase()
            : "";
        const rotationAxis = (rotationAxisNormalized === "spatial" || rotationAxisNormalized === "visual" || rotationAxisNormalized === "none")
            ? rotationAxisNormalized
            : ((selectedCategory === "doors" || selectedCategory === "windows") ? "spatial" : "visual");
        const effectivePlacementRotation = (rotationAxis === "none") ? 0 : placementRotation;
        const isWallMountedPlacement = selectedCategory === "windows" || selectedCategory === "doors";
        const wallSnapPlacement = isWallMountedPlacement
            ? (
                (typeof SpellSystem !== "undefined" &&
                    SpellSystem &&
                    typeof SpellSystem.getPlaceObjectPlacementCandidate === "function")
                    ? SpellSystem.getPlaceObjectPlacementCandidate(wizard, wrappedX, wrappedY)
                    : null
            )
            : null;
        const useWallSnapPlacement = !!(
            isWallMountedPlacement &&
            wallSnapPlacement &&
            wallSnapPlacement.targetWall
        );
        const effectiveAnchorX = useWallSnapPlacement ? 0.5 : selectedAnchorX;
        const rawYScale = Number(
            (typeof globalThis !== "undefined" && Number.isFinite(globalThis.xyratio))
                ? globalThis.xyratio
                : 0.66
        );
        const yScale = Math.max(0.1, Math.abs(rawYScale));
        const placementYOffset = (rotationAxis === "spatial")
            ? 0
            : (((selectedAnchorY - 0.5) * clampedScale) / yScale);
        const placedX = (
            useWallSnapPlacement &&
            Number.isFinite(wallSnapPlacement.snappedX)
        ) ? Number(wallSnapPlacement.snappedX) : wrappedX;
        let placedY = (
            useWallSnapPlacement &&
            Number.isFinite(wallSnapPlacement.snappedY)
        ) ? Number(wallSnapPlacement.snappedY) : (wrappedY + placementYOffset);
        if (wizard.map && typeof wizard.map.wrapWorldY === "function") {
            placedY = wizard.map.wrapWorldY(placedY);
        }
        if (
            wizard.map &&
            typeof wizard.map.worldToNode === "function" &&
            !wizard.map.worldToNode(wrappedX, placedY) &&
            wizard.map.worldToNode(wrappedX, wrappedY)
        ) {
            placedY = wrappedY;
        }

        const resolvedPlacementRotation = (
            useWallSnapPlacement &&
            Number.isFinite(wallSnapPlacement.snappedRotationDeg)
        ) ? Number(wallSnapPlacement.snappedRotationDeg) : effectivePlacementRotation;

        const placedObject = new PlacedObject({ x: placedX, y: placedY }, wizard.map, {
            texturePath: selectedTexturePath,
            category: selectedCategory,
            renderDepthOffset,
            width: clampedScale,
            height: clampedScale,
            placeableAnchorX: effectiveAnchorX,
            placeableAnchorY: selectedAnchorY,
            rotationAxis: useWallSnapPlacement ? "spatial" : rotationAxis,
            placementRotation: resolvedPlacementRotation,
            mountedSectionId: (
                useWallSnapPlacement &&
                Number.isInteger(wallSnapPlacement.mountedSectionId)
            ) ? Number(wallSnapPlacement.mountedSectionId) : null,
            mountedWallSectionUnitId: (
                useWallSnapPlacement &&
                Number.isInteger(wallSnapPlacement.mountedWallSectionUnitId)
            ) ? Number(wallSnapPlacement.mountedWallSectionUnitId) : null,
            mountedWallFacingSign: (
                useWallSnapPlacement &&
                Number.isFinite(wallSnapPlacement.mountedWallFacingSign)
            ) ? Number(wallSnapPlacement.mountedWallFacingSign) : null,
            groundPlaneHitboxOverridePoints: useWallSnapPlacement ? wallSnapPlacement.wallGroundHitboxPoints : undefined
        });
        if (
            useWallSnapPlacement &&
            Number.isFinite(wallSnapPlacement.snappedZ) &&
            placedObject
        ) {
            placedObject.z = Number(wallSnapPlacement.snappedZ);
        }

        this.visible = false;
        this.detachPixiSprite();

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
    constructor(location, map, animatedFrameIndex=null) {
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
        this.width = 1.0;
        this.height = 1.0; // flames 1 map unit high
        this.texturePath = "/assets/images/magic/fire.png";
        this.blocksTile = false;
        this.isPassable = true;
        this.gone = false;
        this.pixiSprite = new PIXI.Sprite(PIXI.Texture.from(this.texturePath));
        this.pixiSprite.anchor.set(0.5, 1);
        this.pixiSprite.renderable = false; // invisible body, only flame should render
        this.pixiSprite.alpha = 1;
        this.visualHitbox = new CircleHitbox(this.x, this.y, 0.25);
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, 0.1);
        this.isOnFire = true;
        this.fireSprite = null;
        this.fireFrameIndex = (animatedFrameIndex !== null) ? animatedFrameIndex : Math.floor(Math.random() * 25); // random phase
        this.fireWidthScale = 3.0; // stretch flames wider
        this.fireHeightScale = 1.0;
        this.animatedFrameCountX = 5;
        this.animatedFrameCountY = 5;
        this.animatedFps = 12;
        this._animatedFrames = null;
        this._animatedFrameIndex = Math.floor(Math.random() * 25);
        this._animatedFrameProgress = 0;
        this._animatedLastFrameCount = null;
        this._animatedFrameSignature = "";
        this._depthBillboardMesh = null;
        this._depthBillboardWorldPositions = null;
        this._depthBillboardLastSignature = "";
        this._depthBillboardMeshMode = "";

        const staticProto = (typeof globalThis.StaticObject === "function" && globalThis.StaticObject.prototype)
            ? globalThis.StaticObject.prototype
            : null;
        if (staticProto && typeof staticProto.ensureDepthBillboardMesh === "function") {
            this.ensureDepthBillboardMesh = staticProto.ensureDepthBillboardMesh;
        }
        if (staticProto && typeof staticProto.updateDepthBillboardMesh === "function") {
            this.updateDepthBillboardMesh = staticProto.updateDepthBillboardMesh;
        }
        if (staticProto && typeof staticProto.rebuildAnimatedSpriteFrames === "function") {
            this.rebuildAnimatedSpriteFrames = staticProto.rebuildAnimatedSpriteFrames;
        }
        if (staticProto && typeof staticProto.updateSpriteAnimation === "function") {
            this.updateSpriteAnimation = staticProto.updateSpriteAnimation;
        }

        if (typeof this.rebuildAnimatedSpriteFrames === "function") {
            this.rebuildAnimatedSpriteFrames(true);
        }
        this.hydrateMagicMetadata();

        const node = this.map && typeof this.map.worldToNode === "function"
            ? this.map.worldToNode(this.x, this.y)
            : null;
        if (node && typeof node.addObject === "function") {
            node.addObject(this);
            this.node = node;
        } else {
            this.node = null;
        }
        this._removedFromNodes = false;
        if (typeof globalThis !== "undefined") {
            const current = Number(globalThis.activeFirewallEmitterCount || 0);
            globalThis.activeFirewallEmitterCount = current + 1;
        }
    }

    removeFromNodes() {
        if (this._removedFromNodes) return;
        this._removedFromNodes = true;
        if (this.node && typeof this.node.removeObject === "function") {
            this.node.removeObject(this);
        }
        if (typeof globalThis !== "undefined") {
            const current = Number(globalThis.activeFirewallEmitterCount || 0);
            globalThis.activeFirewallEmitterCount = Math.max(0, current - 1);
        }
    }

    removeFromGame() {
        if (this.gone) return;
        this.gone = true;
        this.vanishing = false;
        if (this._vanishFinalizeTimeout) {
            clearTimeout(this._vanishFinalizeTimeout);
            this._vanishFinalizeTimeout = null;
        }
        this.removeFromNodes();
        if (Array.isArray(this.map && this.map.objects)) {
            const idx = this.map.objects.indexOf(this);
            if (idx >= 0) this.map.objects.splice(idx, 1);
        }
        if (this.pixiSprite && this.pixiSprite.parent) {
            this.pixiSprite.parent.removeChild(this.pixiSprite);
        }
        if (this.pixiSprite && typeof this.pixiSprite.destroy === "function") {
            this.pixiSprite.destroy({ children: true, texture: false, baseTexture: false });
        }
        this.pixiSprite = null;
        if (this.fireSprite && this.fireSprite.parent) {
            this.fireSprite.parent.removeChild(this.fireSprite);
        }
        if (this.fireSprite && typeof this.fireSprite.destroy === "function") {
            this.fireSprite.destroy({ children: true, texture: false, baseTexture: false });
        }
        this.fireSprite = null;
    }
    remove() {
        this.removeFromGame();
    }

    saveJson() {
        return {
            type: "firewall",
            x: this.x,
            y: this.y
        };
    }

    async hydrateMagicMetadata() {
        const meta = await getMagicAssetMetadata(this.texturePath);
        if (!meta || this.gone) return;
        const cfg = resolveAnimatedSheetConfig(meta, this.animatedFrameCountX, this.animatedFrameCountY, this.animatedFps);
        this.animatedFrameCountX = cfg.frameCountX;
        this.animatedFrameCountY = cfg.frameCountY;
        this.animatedFps = cfg.animatedFps;
        this._animatedFrames = null;
        this._animatedFrameProgress = 0;
        this._animatedLastFrameCount = null;
        this._animatedFrameSignature = "";
        if (typeof this.rebuildAnimatedSpriteFrames === "function") {
            this.rebuildAnimatedSpriteFrames(true);
        }
    }

    update() {
        if (typeof this.updateSpriteAnimation === "function") {
            this.updateSpriteAnimation();
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
    const PLACEABLE_CATEGORIES = ["flowers", "windows", "doors", "furniture", "signs"];
    const DEFAULT_PLACEABLE_CATEGORY = "doors";
    const DEFAULT_PLACEABLE_BY_CATEGORY = {
        doors: "/assets/images/doors/door5.png",
        flowers: "/assets/images/flowers/red%20flower.png",
        windows: "/assets/images/windows/window.png",
        furniture: "/assets/images/furniture/chair.png",
        signs: "/assets/images/signs/princess.png"
    };
    const AURA_MENU_ICON = "/assets/images/thumbnails/aura.png";
    const SPELL_DEFS = [
        { name: "fireball", icon: "/assets/images/thumbnails/fireball.png" },
        { name: "blackdiamond", icon: "/assets/images/powerups/black%20diamond.png" },
        { name: "maze", icon: "/assets/images/thumbnails/maze.png" },
        { name: "wall", icon: "/assets/images/thumbnails/wall.png" },
        { name: "vanish", icon: "/assets/images/thumbnails/vanish.png" },
        { name: "teleport", icon: "/assets/images/thumbnails/vanish.png" },
        { name: "treegrow", icon: "/assets/images/thumbnails/tree.png" },
        { name: "buildroad", icon: "/assets/images/thumbnails/road.png" },
        { name: "placeobject", icon: "/assets/images/doors/door5.png" },
        { name: "firewall", icon: "/assets/images/thumbnails/firewall.png" }
    ];
    const AURA_DEFS = [
        { name: "omnivision", icon: "/assets/images/thumbnails/eye.png", key: "O", magicPerSecond: 2 },
        { name: "speed", icon: "/assets/images/thumbnails/speed.png", key: "P", magicPerSecond: 2 },
        { name: "healing", icon: "/assets/images/thumbnails/cross.png", key: "H", magicPerSecond: 2 }
    ];

    const MAGIC_TICK_MS = 50;
    const HP_REGEN_PER_SECOND = 0.25;
    let healingAuraHpMultiplier = 10;
    const WALL_HEIGHT_MIN = 0.5;
    const WALL_HEIGHT_MAX = 7.0;
    const WALL_HEIGHT_STEP = 0.5;
    const WALL_THICKNESS_MIN = 0.125;
    const WALL_THICKNESS_MAX = 1.0;
    const WALL_THICKNESS_STEP = 0.125;
    const VANISH_WALL_TARGET_SEGMENT_LENGTH_WORLD = 1;
    const VANISH_BURST_SHOT_INTERVAL_MS = 45;
    const PLACEABLE_ROTATION_STEP_DEGREES = 5;
    const POWERUP_PLACEMENT_FILE_NAME = "black diamond.png";
    const POWERUP_PLACEMENT_IMAGE_PATH = "/assets/images/powerups/black%20diamond.png";
    const POWERUP_PLACEMENT_DEFAULT_WIDTH = 0.8;
    const POWERUP_PLACEMENT_DEFAULT_HEIGHT = 0.8;
    const POWERUP_PLACEMENT_DEFAULT_RADIUS = 0.35;
    const POWERUP_PLACEMENT_SCALE_MIN = 0.2;
    const POWERUP_PLACEMENT_SCALE_MAX = 5;
    const POWERUP_PLACEMENT_SCALE_DEFAULT = 1;

    let magicIntervalId = null;
    let lastMagicTickMs = 0;
    let spellMenuMode = "main";
    let flooringTexturePaths = [];
    let flooringTextureFetchPromise = null;
    let placeableImagePathsByCategory = null;
    let placeableImageFetchPromise = null;
    let placeableMenuCategory = DEFAULT_PLACEABLE_CATEGORY;
    const textureAlphaMaskCache = new Map();

    function getTextureAlphaMask(texture) {
        if (!texture || !texture.baseTexture || !texture.frame) return null;
        const baseTexture = texture.baseTexture;
        const frame = texture.frame;
        const key = [
            baseTexture.uid,
            Math.floor(frame.x),
            Math.floor(frame.y),
            Math.floor(frame.width),
            Math.floor(frame.height)
        ].join(":");
        if (textureAlphaMaskCache.has(key)) {
            return textureAlphaMaskCache.get(key);
        }
        try {
            const source = baseTexture.resource && baseTexture.resource.source;
            if (!source) {
                textureAlphaMaskCache.set(key, null);
                return null;
            }
            const w = Math.max(1, Math.floor(frame.width));
            const h = Math.max(1, Math.floor(frame.height));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) {
                textureAlphaMaskCache.set(key, null);
                return null;
            }
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(
                source,
                frame.x,
                frame.y,
                frame.width,
                frame.height,
                0,
                0,
                w,
                h
            );
            const rgba = ctx.getImageData(0, 0, w, h).data;
            const alpha = new Uint8Array(w * h);
            for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
                alpha[j] = rgba[i + 3];
            }
            const mask = { width: w, height: h, alpha };
            textureAlphaMaskCache.set(key, mask);
            return mask;
        } catch (_err) {
            textureAlphaMaskCache.set(key, null);
            return null;
        }
    }

    function isOpaqueSpritePixelAtScreenPoint(sprite, screenPoint, alphaThreshold = 10) {
        if (!sprite || !sprite.texture || !screenPoint) return true;
        if (!(sprite instanceof PIXI.Sprite)) return true;
        try {
            if (!sprite.worldTransform || typeof sprite.worldTransform.applyInverse !== "function") return true;
            const local = new PIXI.Point();
            sprite.worldTransform.applyInverse(new PIXI.Point(screenPoint.x, screenPoint.y), local);

            const bounds = (typeof sprite.getLocalBounds === "function") ? sprite.getLocalBounds() : null;
            if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
                return true;
            }

            const u = (local.x - bounds.x) / bounds.width;
            const v = (local.y - bounds.y) / bounds.height;
            if (!Number.isFinite(u) || !Number.isFinite(v)) return true;
            if (u < 0 || u > 1 || v < 0 || v > 1) return false;

            const mask = getTextureAlphaMask(sprite.texture);
            if (!mask) return true;
            const px = Math.max(0, Math.min(mask.width - 1, Math.floor(u * (mask.width - 1))));
            const py = Math.max(0, Math.min(mask.height - 1, Math.floor(v * (mask.height - 1))));
            const a = mask.alpha[py * mask.width + px];
            return a >= alphaThreshold;
        } catch (_err) {
            // Never break targeting because alpha sampling failed.
            return true;
        }
    }

    function barycentricAtPoint(px, py, ax, ay, bx, by, cx, cy) {
        const v0x = bx - ax;
        const v0y = by - ay;
        const v1x = cx - ax;
        const v1y = cy - ay;
        const v2x = px - ax;
        const v2y = py - ay;
        const denom = (v0x * v1y - v1x * v0y);
        if (Math.abs(denom) < 1e-8) return null;
        const invDenom = 1 / denom;
        const v = (v2x * v1y - v1x * v2y) * invDenom;
        const w = (v0x * v2y - v2x * v0y) * invDenom;
        const u = 1 - v - w;
        return { u, v, w };
    }

    function isOpaqueMeshPixelAtScreenPoint(mesh, screenPoint, alphaThreshold = 10) {
        if (!mesh || !mesh.geometry || !screenPoint) return true;
        try {
            const safeGetBuffer = (geometry, attrName) => {
                if (!geometry || typeof geometry.getBuffer !== "function") return null;
                try {
                    return geometry.getBuffer(attrName);
                } catch (_err) {
                    return null;
                }
            };
            const texture = (mesh.material && mesh.material.texture)
                ? mesh.material.texture
                : ((mesh.shader && mesh.shader.uniforms && mesh.shader.uniforms.uSampler) ? mesh.shader.uniforms.uSampler : null);
            if (!texture) return true;
            const mask = getTextureAlphaMask(texture);
            if (!mask) return true;

            const vb = safeGetBuffer(mesh.geometry, "aVertexPosition");
            const wb = safeGetBuffer(mesh.geometry, "aWorldPosition");
            const ub = safeGetBuffer(mesh.geometry, "aUvs");
            const ib = mesh.geometry.getIndex && mesh.geometry.getIndex();
            const vertices = vb && vb.data ? vb.data : null;
            const worldVertices = wb && wb.data ? wb.data : null;
            const uvs = ub && ub.data ? ub.data : null;
            const indices = ib && ib.data ? ib.data : null;
            if ((!vertices && !worldVertices) || !uvs || !indices || indices.length < 3) return true;

            const camera = (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
                ? interpolatedViewport
                : viewport;
            const projectWorldToScreen = (wx, wy, wz) => {
                const dx = (map && typeof map.shortestDeltaX === "function")
                    ? map.shortestDeltaX(camera.x, wx)
                    : (wx - camera.x);
                const dy = (map && typeof map.shortestDeltaY === "function")
                    ? map.shortestDeltaY(camera.y, wy)
                    : (wy - camera.y);
                return {
                    x: dx * viewscale,
                    y: (dy - wz) * viewscale * xyratio
                };
            };

            let uv = null;
            for (let i = 0; i <= indices.length - 3; i += 3) {
                const ia = indices[i];
                const ibx = indices[i + 1];
                const ic = indices[i + 2];

                let ax, ay, bx, by, cx, cy;
                if (worldVertices) {
                    const a = projectWorldToScreen(
                        worldVertices[ia * 3],
                        worldVertices[ia * 3 + 1],
                        worldVertices[ia * 3 + 2]
                    );
                    const b = projectWorldToScreen(
                        worldVertices[ibx * 3],
                        worldVertices[ibx * 3 + 1],
                        worldVertices[ibx * 3 + 2]
                    );
                    const c = projectWorldToScreen(
                        worldVertices[ic * 3],
                        worldVertices[ic * 3 + 1],
                        worldVertices[ic * 3 + 2]
                    );
                    ax = a.x; ay = a.y;
                    bx = b.x; by = b.y;
                    cx = c.x; cy = c.y;
                } else {
                    if (!mesh.worldTransform || typeof mesh.worldTransform.apply !== "function") return true;
                    const a = mesh.worldTransform.apply(new PIXI.Point(vertices[ia * 2], vertices[ia * 2 + 1]));
                    const b = mesh.worldTransform.apply(new PIXI.Point(vertices[ibx * 2], vertices[ibx * 2 + 1]));
                    const c = mesh.worldTransform.apply(new PIXI.Point(vertices[ic * 2], vertices[ic * 2 + 1]));
                    ax = a.x; ay = a.y;
                    bx = b.x; by = b.y;
                    cx = c.x; cy = c.y;
                }
                const bc = barycentricAtPoint(screenPoint.x, screenPoint.y, ax, ay, bx, by, cx, cy);
                if (!bc) continue;
                const epsilon = 1e-4;
                if (bc.u < -epsilon || bc.v < -epsilon || bc.w < -epsilon) continue;

                const au = uvs[ia * 2];
                const av = uvs[ia * 2 + 1];
                const bu = uvs[ibx * 2];
                const bv = uvs[ibx * 2 + 1];
                const cu = uvs[ic * 2];
                const cv = uvs[ic * 2 + 1];
                uv = {
                    u: (au * bc.u) + (bu * bc.v) + (cu * bc.w),
                    v: (av * bc.u) + (bv * bc.v) + (cv * bc.w)
                };
                break;
            }

            if (!uv) return false;
            if (!Number.isFinite(uv.u) || !Number.isFinite(uv.v)) return true;

            const baseTexture = texture.baseTexture || null;
            const wrapMode = baseTexture ? baseTexture.wrapMode : null;
            const repeatWrap = (
                wrapMode === PIXI.WRAP_MODES.REPEAT ||
                wrapMode === PIXI.WRAP_MODES.MIRRORED_REPEAT
            );
            let sampleU = uv.u;
            let sampleV = uv.v;
            if (repeatWrap) {
                sampleU = sampleU - Math.floor(sampleU);
                sampleV = sampleV - Math.floor(sampleV);
            } else if (sampleU < 0 || sampleU > 1 || sampleV < 0 || sampleV > 1) {
                return false;
            }

            const px = Math.max(0, Math.min(mask.width - 1, Math.floor(sampleU * (mask.width - 1))));
            const py = Math.max(0, Math.min(mask.height - 1, Math.floor(sampleV * (mask.height - 1))));
            const a = mask.alpha[py * mask.width + px];
            return a >= alphaThreshold;
        } catch (_err) {
            return true;
        }
    }

    function isOpaqueRenderablePixelAtScreenPoint(displayObj, screenPoint, alphaThreshold = 10) {
        if (!displayObj) return true;
        if (typeof PIXI !== "undefined" && displayObj instanceof PIXI.Sprite) {
            return isOpaqueSpritePixelAtScreenPoint(displayObj, screenPoint, alphaThreshold);
        }
        if (typeof PIXI !== "undefined" && displayObj instanceof PIXI.Mesh) {
            return isOpaqueMeshPixelAtScreenPoint(displayObj, screenPoint, alphaThreshold);
        }
        return true;
    }

    function getSpellTargetDisplayObject(item) {
        if (!item) return null;
        if (item._renderingDepthMesh && item._renderingDepthMesh.parent) return item._renderingDepthMesh;
        if (item._opaqueDepthMesh && item._opaqueDepthMesh.parent) return item._opaqueDepthMesh;
        if (item.pixiSprite && item.pixiSprite.parent) return item.pixiSprite;
        return null;
    }

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
            return `/assets/images/trees/tree${selected}.png`;
        }
        return "/assets/images/thumbnails/tree.png";
    }

    function getPlaceableCategories() {
        return PLACEABLE_CATEGORIES.slice();
    }

    function normalizePlaceableSelections(wizardRef) {
        if (!wizardRef) return;
        if (!wizardRef.selectedPlaceableByCategory || typeof wizardRef.selectedPlaceableByCategory !== "object") {
            wizardRef.selectedPlaceableByCategory = {};
        }
        if (!wizardRef.selectedPlaceableRenderOffsetByTexture || typeof wizardRef.selectedPlaceableRenderOffsetByTexture !== "object") {
            wizardRef.selectedPlaceableRenderOffsetByTexture = {};
        }
        if (!wizardRef.selectedPlaceableScaleByTexture || typeof wizardRef.selectedPlaceableScaleByTexture !== "object") {
            wizardRef.selectedPlaceableScaleByTexture = {};
        }
        if (!wizardRef.selectedPlaceableRotationByTexture || typeof wizardRef.selectedPlaceableRotationByTexture !== "object") {
            wizardRef.selectedPlaceableRotationByTexture = {};
        }
        if (!wizardRef.selectedPlaceableRotationAxisByTexture || typeof wizardRef.selectedPlaceableRotationAxisByTexture !== "object") {
            wizardRef.selectedPlaceableRotationAxisByTexture = {};
        }
        if (!wizardRef.selectedPlaceableAnchorXByTexture || typeof wizardRef.selectedPlaceableAnchorXByTexture !== "object") {
            wizardRef.selectedPlaceableAnchorXByTexture = {};
        }
        if (!wizardRef.selectedPlaceableAnchorYByTexture || typeof wizardRef.selectedPlaceableAnchorYByTexture !== "object") {
            wizardRef.selectedPlaceableAnchorYByTexture = {};
        }
        PLACEABLE_CATEGORIES.forEach(category => {
            const existing = wizardRef.selectedPlaceableByCategory[category];
            if (typeof existing !== "string" || existing.length === 0) {
                wizardRef.selectedPlaceableByCategory[category] = DEFAULT_PLACEABLE_BY_CATEGORY[category];
            }
        });
        const selectedCategory = (typeof wizardRef.selectedPlaceableCategory === "string")
            ? wizardRef.selectedPlaceableCategory
            : DEFAULT_PLACEABLE_CATEGORY;
        wizardRef.selectedPlaceableCategory = PLACEABLE_CATEGORIES.includes(selectedCategory)
            ? selectedCategory
            : DEFAULT_PLACEABLE_CATEGORY;
        const selectedPath = wizardRef.selectedPlaceableByCategory[wizardRef.selectedPlaceableCategory];
        wizardRef.selectedPlaceableTexturePath = (typeof selectedPath === "string" && selectedPath.length > 0)
            ? selectedPath
            : DEFAULT_PLACEABLE_BY_CATEGORY[wizardRef.selectedPlaceableCategory];
        const activeTexturePath = wizardRef.selectedPlaceableTexturePath;
        const selectedCategoryForActive = wizardRef.selectedPlaceableCategory;
        const defaultAxis = (selectedCategoryForActive === "doors" || selectedCategoryForActive === "windows")
            ? "spatial"
            : "visual";
        const defaultAnchorYForCategory = (selectedCategoryForActive === "windows") ? 0.5 : 1;
        if (typeof activeTexturePath === "string" && activeTexturePath.length > 0) {
            const oldGlobalOffset = Number.isFinite(wizardRef.selectedPlaceableRenderOffset)
                ? Number(wizardRef.selectedPlaceableRenderOffset)
                : 0;
            const oldGlobalScale = Number.isFinite(wizardRef.selectedPlaceableScale)
                ? Number(wizardRef.selectedPlaceableScale)
                : 1;
            const oldGlobalRotation = Number.isFinite(wizardRef.selectedPlaceableRotation)
                ? Number(wizardRef.selectedPlaceableRotation)
                : 0;
            const oldGlobalAxis = (typeof wizardRef.selectedPlaceableRotationAxis === "string")
                ? wizardRef.selectedPlaceableRotationAxis
                : defaultAxis;
            const oldGlobalAnchorX = Number.isFinite(wizardRef.selectedPlaceableAnchorX)
                ? Number(wizardRef.selectedPlaceableAnchorX)
                : 0.5;
            const oldGlobalAnchorY = Number.isFinite(wizardRef.selectedPlaceableAnchorY)
                ? Number(wizardRef.selectedPlaceableAnchorY)
                : defaultAnchorYForCategory;

            if (!Number.isFinite(wizardRef.selectedPlaceableRenderOffsetByTexture[activeTexturePath])) {
                wizardRef.selectedPlaceableRenderOffsetByTexture[activeTexturePath] = oldGlobalOffset;
            }
            if (!Number.isFinite(wizardRef.selectedPlaceableScaleByTexture[activeTexturePath])) {
                wizardRef.selectedPlaceableScaleByTexture[activeTexturePath] = oldGlobalScale;
            }
            if (!Number.isFinite(wizardRef.selectedPlaceableRotationByTexture[activeTexturePath])) {
                wizardRef.selectedPlaceableRotationByTexture[activeTexturePath] = oldGlobalRotation;
            }
            if (
                typeof wizardRef.selectedPlaceableRotationAxisByTexture[activeTexturePath] !== "string" ||
                wizardRef.selectedPlaceableRotationAxisByTexture[activeTexturePath].length === 0
            ) {
                wizardRef.selectedPlaceableRotationAxisByTexture[activeTexturePath] = oldGlobalAxis;
            }
            if (!Number.isFinite(wizardRef.selectedPlaceableAnchorXByTexture[activeTexturePath])) {
                wizardRef.selectedPlaceableAnchorXByTexture[activeTexturePath] = oldGlobalAnchorX;
            }
            if (!Number.isFinite(wizardRef.selectedPlaceableAnchorYByTexture[activeTexturePath])) {
                wizardRef.selectedPlaceableAnchorYByTexture[activeTexturePath] = oldGlobalAnchorY;
            }

            const nextOffset = Number(wizardRef.selectedPlaceableRenderOffsetByTexture[activeTexturePath]);
            const nextScale = Number(wizardRef.selectedPlaceableScaleByTexture[activeTexturePath]);
            const nextRotation = Number(wizardRef.selectedPlaceableRotationByTexture[activeTexturePath]);
            const nextAxisRaw = wizardRef.selectedPlaceableRotationAxisByTexture[activeTexturePath];
            const nextAnchorX = Number(wizardRef.selectedPlaceableAnchorXByTexture[activeTexturePath]);
            const nextAnchorY = Number(wizardRef.selectedPlaceableAnchorYByTexture[activeTexturePath]);
            wizardRef.selectedPlaceableRenderOffset = Number.isFinite(nextOffset) ? nextOffset : 0;
            wizardRef.selectedPlaceableScale = Number.isFinite(nextScale) ? Math.max(0.2, Math.min(5, nextScale)) : 1;
            wizardRef.selectedPlaceableRotation = Number.isFinite(nextRotation) ? nextRotation : 0;
            wizardRef.selectedPlaceableRotationAxis = (nextAxisRaw === "spatial" || nextAxisRaw === "visual" || nextAxisRaw === "none")
                ? nextAxisRaw
                : defaultAxis;
            wizardRef.selectedPlaceableAnchorX = Number.isFinite(nextAnchorX) ? nextAnchorX : 0.5;
            wizardRef.selectedPlaceableAnchorY = Number.isFinite(nextAnchorY) ? nextAnchorY : defaultAnchorYForCategory;
        } else {
            wizardRef.selectedPlaceableRenderOffset = 0;
            wizardRef.selectedPlaceableScale = 1;
            wizardRef.selectedPlaceableRotation = 0;
            wizardRef.selectedPlaceableRotationAxis = defaultAxis;
            wizardRef.selectedPlaceableAnchorX = 0.5;
            wizardRef.selectedPlaceableAnchorY = defaultAnchorYForCategory;
        }
    }

    function normalizePlaceableRotationAxisForWizard(wizardRef, axis, category = null) {
        const normalized = (typeof axis === "string") ? axis.trim().toLowerCase() : "";
        if (normalized === "spatial" || normalized === "visual" || normalized === "none") return normalized;
        const fallbackCategory = (typeof category === "string" && category.length > 0)
            ? category
            : (wizardRef && typeof wizardRef.selectedPlaceableCategory === "string" ? wizardRef.selectedPlaceableCategory : DEFAULT_PLACEABLE_CATEGORY);
        return (fallbackCategory === "doors" || fallbackCategory === "windows") ? "spatial" : "visual";
    }

    async function refreshSelectedPlaceableMetadata(wizardRef) {
        if (!wizardRef) return null;
        normalizePlaceableSelections(wizardRef);
        const category = getSelectedPlaceableCategory(wizardRef);
        const texturePath = getSelectedPlaceableTexture(wizardRef);
        if (!(typeof globalThis !== "undefined" && typeof globalThis.getResolvedPlaceableMetadata === "function")) {
            const fallbackAxis = normalizePlaceableRotationAxisForWizard(wizardRef, null, category);
            const fallbackAnchorY = category === "windows" ? 0.5 : 1;
            wizardRef.selectedPlaceableRotationAxisByTexture[texturePath] = fallbackAxis;
            wizardRef.selectedPlaceableRotationAxis = fallbackAxis;
            wizardRef.selectedPlaceableAnchorXByTexture[texturePath] = 0.5;
            wizardRef.selectedPlaceableAnchorYByTexture[texturePath] = fallbackAnchorY;
            wizardRef.selectedPlaceableAnchorX = 0.5;
            wizardRef.selectedPlaceableAnchorY = fallbackAnchorY;
            return null;
        }
        const meta = await globalThis.getResolvedPlaceableMetadata(category, texturePath);
        const axis = normalizePlaceableRotationAxisForWizard(wizardRef, meta && meta.rotationAxis, category);
        const anchorX = Number.isFinite(meta && meta.anchor && meta.anchor.x) ? Number(meta.anchor.x) : 0.5;
        const anchorY = Number.isFinite(meta && meta.anchor && meta.anchor.y) ? Number(meta.anchor.y) : (category === "windows" ? 0.5 : 1);
        wizardRef.selectedPlaceableRotationAxisByTexture[texturePath] = axis;
        wizardRef.selectedPlaceableAnchorXByTexture[texturePath] = anchorX;
        wizardRef.selectedPlaceableAnchorYByTexture[texturePath] = anchorY;
        if (wizardRef.selectedPlaceableTexturePath === texturePath) {
            wizardRef.selectedPlaceableRotationAxis = axis;
            wizardRef.selectedPlaceableAnchorX = anchorX;
            wizardRef.selectedPlaceableAnchorY = anchorY;
        }
        return meta;
    }

    function adjustPlaceableRenderOffset(wizardRef, delta) {
        if (!wizardRef || !Number.isFinite(delta) || delta === 0) return null;
        normalizePlaceableSelections(wizardRef);
        const texturePath = (typeof wizardRef.selectedPlaceableTexturePath === "string" && wizardRef.selectedPlaceableTexturePath.length > 0)
            ? wizardRef.selectedPlaceableTexturePath
            : DEFAULT_PLACEABLE_BY_CATEGORY[DEFAULT_PLACEABLE_CATEGORY];
        const current = Number.isFinite(wizardRef.selectedPlaceableRenderOffset)
            ? Number(wizardRef.selectedPlaceableRenderOffset)
            : 0;
        const unclamped = current + delta;
        const next = Math.max(-10, Math.min(10, Math.round(unclamped * 10) / 10));
        wizardRef.selectedPlaceableRenderOffset = next;
        if (!wizardRef.selectedPlaceableRenderOffsetByTexture || typeof wizardRef.selectedPlaceableRenderOffsetByTexture !== "object") {
            wizardRef.selectedPlaceableRenderOffsetByTexture = {};
        }
        wizardRef.selectedPlaceableRenderOffsetByTexture[texturePath] = next;
        return next;
    }

    function adjustPlaceableScale(wizardRef, delta) {
        if (!wizardRef || !Number.isFinite(delta) || delta === 0) return null;
        normalizePlaceableSelections(wizardRef);
        const texturePath = (typeof wizardRef.selectedPlaceableTexturePath === "string" && wizardRef.selectedPlaceableTexturePath.length > 0)
            ? wizardRef.selectedPlaceableTexturePath
            : DEFAULT_PLACEABLE_BY_CATEGORY[DEFAULT_PLACEABLE_CATEGORY];
        const current = Number.isFinite(wizardRef.selectedPlaceableScale)
            ? Number(wizardRef.selectedPlaceableScale)
            : 1;
        const rawNext = Math.max(0.2, Math.min(5, current + delta));
        const next = Math.round(rawNext * 1000) / 1000;
        wizardRef.selectedPlaceableScale = next;
        if (!wizardRef.selectedPlaceableScaleByTexture || typeof wizardRef.selectedPlaceableScaleByTexture !== "object") {
            wizardRef.selectedPlaceableScaleByTexture = {};
        }
        wizardRef.selectedPlaceableScaleByTexture[texturePath] = next;
        return next;
    }

    function clampPowerupPlacementScale(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return POWERUP_PLACEMENT_SCALE_DEFAULT;
        const clamped = Math.max(POWERUP_PLACEMENT_SCALE_MIN, Math.min(POWERUP_PLACEMENT_SCALE_MAX, n));
        return Math.round(clamped * 1000) / 1000;
    }

    function getPowerupPlacementBaseData() {
        let imageData = null;
        if (typeof getPowerupImageDataByFile === "function") {
            imageData = getPowerupImageDataByFile(POWERUP_PLACEMENT_FILE_NAME);
        }
        const width = Number.isFinite(imageData && imageData.width)
            ? Math.max(0.01, Number(imageData.width))
            : POWERUP_PLACEMENT_DEFAULT_WIDTH;
        const height = Number.isFinite(imageData && imageData.height)
            ? Math.max(0.01, Number(imageData.height))
            : POWERUP_PLACEMENT_DEFAULT_HEIGHT;
        const radius = Number.isFinite(imageData && imageData.groundPlaneHitbox && imageData.groundPlaneHitbox.radius)
            ? Math.max(0.01, Number(imageData.groundPlaneHitbox.radius))
            : POWERUP_PLACEMENT_DEFAULT_RADIUS;
        const imagePath = (imageData && typeof imageData.imagePath === "string" && imageData.imagePath.length > 0)
            ? imageData.imagePath
            : POWERUP_PLACEMENT_IMAGE_PATH;
        return {
            fileName: POWERUP_PLACEMENT_FILE_NAME,
            imagePath,
            width,
            height,
            radius
        };
    }

    function getSelectedPowerupPlacementScale(wizardRef) {
        if (!wizardRef) return POWERUP_PLACEMENT_SCALE_DEFAULT;
        const scale = clampPowerupPlacementScale(wizardRef.selectedPowerupPlacementScale);
        wizardRef.selectedPowerupPlacementScale = scale;
        return scale;
    }

    function adjustPowerupPlacementScale(wizardRef, delta) {
        if (!wizardRef || !Number.isFinite(delta) || delta === 0) return null;
        const current = getSelectedPowerupPlacementScale(wizardRef);
        const next = clampPowerupPlacementScale(current + delta);
        wizardRef.selectedPowerupPlacementScale = next;
        return next;
    }

    function getPowerupPlacementPreviewConfig(wizardRef) {
        const base = getPowerupPlacementBaseData();
        const scale = getSelectedPowerupPlacementScale(wizardRef);
        return {
            fileName: base.fileName,
            imagePath: base.imagePath,
            width: Math.max(0.01, base.width * scale),
            height: Math.max(0.01, base.height * scale),
            radius: Math.max(0.01, base.radius * scale),
            scale
        };
    }

    function adjustPlaceableRotation(wizardRef, deltaDegrees) {
        if (!wizardRef || !Number.isFinite(deltaDegrees) || deltaDegrees === 0) return null;
        normalizePlaceableSelections(wizardRef);
        const axisRaw = (typeof wizardRef.selectedPlaceableRotationAxis === "string")
            ? wizardRef.selectedPlaceableRotationAxis.trim().toLowerCase()
            : "";
        const texturePath = (typeof wizardRef.selectedPlaceableTexturePath === "string" && wizardRef.selectedPlaceableTexturePath.length > 0)
            ? wizardRef.selectedPlaceableTexturePath
            : DEFAULT_PLACEABLE_BY_CATEGORY[DEFAULT_PLACEABLE_CATEGORY];
        if (axisRaw === "none") {
            wizardRef.selectedPlaceableRotation = 0;
            if (!wizardRef.selectedPlaceableRotationByTexture || typeof wizardRef.selectedPlaceableRotationByTexture !== "object") {
                wizardRef.selectedPlaceableRotationByTexture = {};
            }
            wizardRef.selectedPlaceableRotationByTexture[texturePath] = 0;
            return 0;
        }
        const current = Number.isFinite(wizardRef.selectedPlaceableRotation)
            ? Number(wizardRef.selectedPlaceableRotation)
            : 0;
        let next = current + Number(deltaDegrees);
        next = ((next % 360) + 360) % 360;
        if (next > 180) next -= 360;
        const snapped = Math.round(next / PLACEABLE_ROTATION_STEP_DEGREES) * PLACEABLE_ROTATION_STEP_DEGREES;
        wizardRef.selectedPlaceableRotation = snapped;
        if (!wizardRef.selectedPlaceableRotationByTexture || typeof wizardRef.selectedPlaceableRotationByTexture !== "object") {
            wizardRef.selectedPlaceableRotationByTexture = {};
        }
        wizardRef.selectedPlaceableRotationByTexture[texturePath] = snapped;
        return snapped;
    }

    function getPlaceableImageList(category) {
        if (!placeableImagePathsByCategory || !category) return [];
        const list = placeableImagePathsByCategory[category];
        return Array.isArray(list) ? list.slice() : [];
    }

    function getSelectedPlaceableCategory(wizardRef) {
        normalizePlaceableSelections(wizardRef);
        return wizardRef && typeof wizardRef.selectedPlaceableCategory === "string"
            ? wizardRef.selectedPlaceableCategory
            : DEFAULT_PLACEABLE_CATEGORY;
    }

    function setSelectedPlaceableCategory(wizardRef, category) {
        if (!wizardRef || !PLACEABLE_CATEGORIES.includes(category)) return;
        normalizePlaceableSelections(wizardRef);
        wizardRef.selectedPlaceableCategory = category;
        const selectedForCategory = wizardRef.selectedPlaceableByCategory[category];
        wizardRef.selectedPlaceableTexturePath = (typeof selectedForCategory === "string" && selectedForCategory.length > 0)
            ? selectedForCategory
            : DEFAULT_PLACEABLE_BY_CATEGORY[category];
        normalizePlaceableSelections(wizardRef);
    }

    function getSelectedPlaceableTextureForCategory(wizardRef, category) {
        normalizePlaceableSelections(wizardRef);
        if (!wizardRef || !PLACEABLE_CATEGORIES.includes(category)) return DEFAULT_PLACEABLE_BY_CATEGORY[DEFAULT_PLACEABLE_CATEGORY];
        const selected = wizardRef.selectedPlaceableByCategory[category];
        if (typeof selected === "string" && selected.length > 0) return selected;
        return DEFAULT_PLACEABLE_BY_CATEGORY[category];
    }

    function getSelectedPlaceableTexture(wizardRef) {
        const category = getSelectedPlaceableCategory(wizardRef);
        return getSelectedPlaceableTextureForCategory(wizardRef, category);
    }

    function getPlaceObjectSpellIcon(wizardRef) {
        return getSelectedPlaceableTexture(wizardRef);
    }

    function fetchPlaceableImages() {
        if (placeableImagePathsByCategory && typeof placeableImagePathsByCategory === "object") {
            return Promise.resolve(placeableImagePathsByCategory);
        }
        if (placeableImageFetchPromise) {
            return placeableImageFetchPromise;
        }
        placeableImageFetchPromise = fetch("/api/placeables")
            .then(response => response.json())
            .then(payload => {
                const next = {};
                PLACEABLE_CATEGORIES.forEach(category => {
                    const listed = payload && payload.ok && payload.categories && Array.isArray(payload.categories[category])
                        ? payload.categories[category]
                        : [];
                    next[category] = listed.length > 0 ? listed : [DEFAULT_PLACEABLE_BY_CATEGORY[category]];
                });
                placeableImagePathsByCategory = next;
                return placeableImagePathsByCategory;
            })
            .catch(() => {
                const fallback = {};
                PLACEABLE_CATEGORIES.forEach(category => {
                    fallback[category] = [DEFAULT_PLACEABLE_BY_CATEGORY[category]];
                });
                placeableImagePathsByCategory = fallback;
                return placeableImagePathsByCategory;
            })
            .finally(() => {
                placeableImageFetchPromise = null;
            });
        return placeableImageFetchPromise;
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

    function startTreeGrowthChannel(wizardRef, targetTree, growthPerSecond = 1, magicPerSecond = 15, maxSize = 20) {
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
        const magicRegenPerSecond = Number.isFinite(wizardRef.magicRegenPerSecond)
            ? Math.max(0, wizardRef.magicRegenPerSecond)
            : 0;
        if (wizardRef.magic < wizardRef.maxMagic) {
            wizardRef.magic = Math.min(wizardRef.maxMagic, wizardRef.magic + magicRegenPerSecond * dtSec);
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
        if (spellName === "vanish") return !!wizardRef.vanishDragMode;
        return false;
    }

    function cancelDragSpell(wizardRef, spellName) {
        if (!wizardRef) return;
        if (spellName === "wall") {
            wizardRef.wallLayoutMode = false;
            wizardRef.wallStartPoint = null;
            wizardRef.wallStartReferenceWall = null;
            wizardRef.wallDragMouseStartWorld = null;
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
            return;
        }
        if (spellName === "vanish") {
            wizardRef.vanishDragMode = false;
            resetVanishDragTargetingState(wizardRef);
        }
    }

    function getDragSpellObjectType(spellName) {
        if (spellName === "wall") return "wallSection";
        if (spellName === "buildroad") return "road";
        if (spellName === "firewall") return "firewall";
        return null;
    }

    function wrapWorldPointForMap(mapRef, x, y) {
        let outX = Number(x);
        let outY = Number(y);
        if (mapRef && typeof mapRef.wrapWorldX === "function") outX = mapRef.wrapWorldX(outX);
        if (mapRef && typeof mapRef.wrapWorldY === "function") outY = mapRef.wrapWorldY(outY);
        return { x: outX, y: outY };
    }

    function projectWallDragPointFromMouseDelta(wizardRef, wrappedCurrentPoint) {
        if (!wizardRef || !wrappedCurrentPoint) return null;
        const mapRef = wizardRef.map || null;
        const startAnchor = wizardRef.wallStartPoint;
        const dragMouseStart = wizardRef.wallDragMouseStartWorld;
        if (
            !startAnchor ||
            !dragMouseStart ||
            !Number.isFinite(dragMouseStart.x) ||
            !Number.isFinite(dragMouseStart.y)
        ) {
            return wrappedCurrentPoint;
        }
        const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(dragMouseStart.x, wrappedCurrentPoint.x)
            : (wrappedCurrentPoint.x - dragMouseStart.x);
        const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(dragMouseStart.y, wrappedCurrentPoint.y)
            : (wrappedCurrentPoint.y - dragMouseStart.y);
        return wrapWorldPointForMap(
            mapRef,
            Number(startAnchor.x) + dx,
            Number(startAnchor.y) + dy
        );
    }

    function snapProjectedWallDragPoint(wizardRef, projectedPoint) {
        if (!wizardRef || !projectedPoint) return null;
        const mapRef = wizardRef.map || null;
        const snapTarget = getDragStartSnapTargetAt(wizardRef, "wall", projectedPoint.x, projectedPoint.y);
        if (snapTarget && snapTarget.point) {
            return { x: Number(snapTarget.point.x), y: Number(snapTarget.point.y) };
        }
        if (!mapRef) return projectedPoint;
        const fallbackAnchor = (typeof mapRef.worldToNodeOrMidpoint === "function")
            ? mapRef.worldToNodeOrMidpoint(projectedPoint.x, projectedPoint.y)
            : (typeof mapRef.worldToNode === "function" ? mapRef.worldToNode(projectedPoint.x, projectedPoint.y) : null);
        if (fallbackAnchor && Number.isFinite(fallbackAnchor.x) && Number.isFinite(fallbackAnchor.y)) {
            return { x: Number(fallbackAnchor.x), y: Number(fallbackAnchor.y) };
        }
        return projectedPoint;
    }

    function getAdjustedWallDragWorldPoint(wizardRef, worldX, worldY) {
        if (!wizardRef || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const mapRef = wizardRef.map || null;
        const wrappedCurrentPoint = wrapWorldPointForMap(mapRef, worldX, worldY);
        if (
            wizardRef.wallLayoutMode &&
            wizardRef.currentSpell === "wall"
        ) {
            return wrappedCurrentPoint;
        }
        return wrappedCurrentPoint;
    }

    function pointsMatchWorld(mapRef, a, b, epsilon = 1e-6) {
        if (!a || !b) return false;
        const ax = Number(a.x);
        const ay = Number(a.y);
        const bx = Number(b.x);
        const by = Number(b.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return false;
        const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(ax, bx)
            : (bx - ax);
        const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(ay, by)
            : (by - ay);
        return Math.abs(dx) <= epsilon && Math.abs(dy) <= epsilon;
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

    function getTargetAimPoint(wizardRef, target) {
        if (!target || target.gone) return null;
        if (Number.isFinite(target.x) && Number.isFinite(target.y)) {
            return { x: Number(target.x), y: Number(target.y) };
        }
        if (
            target.type === "wallSection" &&
            target.startPoint && target.endPoint &&
            Number.isFinite(target.startPoint.x) && Number.isFinite(target.startPoint.y) &&
            Number.isFinite(target.endPoint.x) && Number.isFinite(target.endPoint.y)
        ) {
            const mapRef = (wizardRef && wizardRef.map) || null;
            const sx = Number(target.startPoint.x);
            const sy = Number(target.startPoint.y);
            const ex = Number(target.endPoint.x);
            const ey = Number(target.endPoint.y);
            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(sx, ex)
                : (ex - sx);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(sy, ey)
                : (ey - sy);
            let x = sx + dx * 0.5;
            let y = sy + dy * 0.5;
            if (mapRef && typeof mapRef.wrapWorldX === "function") x = mapRef.wrapWorldX(x);
            if (mapRef && typeof mapRef.wrapWorldY === "function") y = mapRef.wrapWorldY(y);
            return { x, y };
        }
        return null;
    }

    function getWizardDistanceToTarget(wizardRef, target) {
        if (!wizardRef || !target || target.gone) return Infinity;
        const aim = getTargetAimPoint(wizardRef, target);
        if (!aim || !Number.isFinite(aim.x) || !Number.isFinite(aim.y)) return Infinity;
        const mapRef = wizardRef.map || null;
        const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(wizardRef.x, aim.x)
            : (aim.x - wizardRef.x);
        const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(wizardRef.y, aim.y)
            : (aim.y - wizardRef.y);
        return Math.hypot(dx, dy);
    }

    function ensureVanishDragTargetingState(wizardRef) {
        if (!wizardRef) return null;
        if (!wizardRef.vanishDragTargetingState || typeof wizardRef.vanishDragTargetingState !== "object") {
            wizardRef.vanishDragTargetingState = {
                queuedObjects: [],
                queuedObjectSet: new Set(),
                wallRanges: new Map()
            };
        }
        return wizardRef.vanishDragTargetingState;
    }

    function resetVanishDragTargetingState(wizardRef) {
        if (!wizardRef) return;
        wizardRef.vanishDragTargetingState = null;
    }

    function queueVanishDragTargetAtPoint(wizardRef, worldX, worldY) {
        if (!wizardRef || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
        if (wizardRef.currentSpell !== "vanish") return false;
        if (!wizardRef.vanishDragMode) return false;

        const state = ensureVanishDragTargetingState(wizardRef);
        if (!state) return false;

        const candidate = getObjectTargetAt(wizardRef, worldX, worldY);
        if (!candidate || candidate.gone || candidate.vanishing) return false;

        if (
            candidate.type === "wallSection" &&
            typeof candidate._parameterForWorldPointOnSection === "function"
        ) {
            const tRaw = candidate._parameterForWorldPointOnSection({ x: worldX, y: worldY });
            const t = Number.isFinite(tRaw)
                ? Math.max(0, Math.min(1, Number(tRaw)))
                : 0.5;
            const existing = state.wallRanges.get(candidate);
            if (existing) {
                existing.tStart = Math.min(existing.tStart, t);
                existing.tEnd = Math.max(existing.tEnd, t);
            } else {
                state.wallRanges.set(candidate, {
                    wall: candidate,
                    tStart: t,
                    tEnd: t
                });
            }
            return true;
        }

        if (state.queuedObjectSet.has(candidate)) return false;
        state.queuedObjectSet.add(candidate);
        state.queuedObjects.push(candidate);
        markObjectAsTargetedBySpell(wizardRef, "vanish", candidate);
        return true;
    }

    function buildVanishBurstTargetsFromQueuedState(wizardRef) {
        const state = wizardRef && wizardRef.vanishDragTargetingState;
        if (!wizardRef || !state) return [];

        const targets = [];
        const seen = new Set();
        const pushUnique = (obj) => {
            if (!obj || obj.gone || obj.vanishing) return;
            if (seen.has(obj)) return;
            seen.add(obj);
            targets.push(obj);
        };

        if (Array.isArray(state.queuedObjects)) {
            for (let i = 0; i < state.queuedObjects.length; i++) {
                pushUnique(state.queuedObjects[i]);
            }
        }

        if (state.wallRanges instanceof Map) {
            state.wallRanges.forEach(entry => {
                const wall = entry && entry.wall;
                if (!wall || wall.gone || wall.vanishing) return;

                if (typeof wall.splitIntoTargetableVanishSegments === "function") {
                    const split = wall.splitIntoTargetableVanishSegments(
                        {
                            tStart: Number(entry.tStart),
                            tEnd: Number(entry.tEnd)
                        },
                        {
                            targetSegmentLengthWorld: VANISH_WALL_TARGET_SEGMENT_LENGTH_WORLD
                        }
                    );
                    if (split && Array.isArray(split.targetSegments) && split.targetSegments.length > 0) {
                        for (let i = 0; i < split.targetSegments.length; i++) {
                            pushUnique(split.targetSegments[i]);
                        }
                        return;
                    }
                }

                pushUnique(wall);
            });
        }

        targets.sort((a, b) => getWizardDistanceToTarget(wizardRef, a) - getWizardDistanceToTarget(wizardRef, b));
        return targets;
    }

    function castQueuedVanishBurst(wizardRef, queuedTargets = []) {
        if (!wizardRef || !Array.isArray(queuedTargets) || queuedTargets.length === 0) return false;

        const shots = queuedTargets.slice();
        let shotIndex = 0;
        wizardRef.castDelay = true;
        wizardRef.casting = true;

        const finishBurst = () => {
            wizardRef.castDelay = false;
            wizardRef.casting = false;
        };

        const fireNext = () => {
            if (!wizardRef || wizardRef.gone || shotIndex >= shots.length) {
                finishBurst();
                return;
            }

            const target = shots[shotIndex++];
            if (target && !target.gone && !target.vanishing) {
                const projectile = new Vanish();
                const requiredMagic = Math.max(15, Number.isFinite(projectile.magicCost) ? Number(projectile.magicCost) : 0);
                if (wizard.magic < requiredMagic) {
                    finishBurst();
                    return;
                }

                const aim = getTargetAimPoint(wizardRef, target);
                if (aim && Number.isFinite(aim.x) && Number.isFinite(aim.y)) {
                    projectile.forcedTarget = target;
                    if (target.type === "wallSection") {
                        target._vanishAsWholeSection = true;
                        target._disableChunkSplitOnVanish = true;
                    }
                    markObjectAsTargetedBySpell(wizardRef, "vanish", target);
                    const dx = aim.x - wizardRef.x;
                    const dy = aim.y - wizardRef.y;
                    if (typeof wizardRef.turnToward === "function") {
                        wizardRef.turnToward(dx, dy);
                    }
                    projectiles.push(projectile.cast(aim.x, aim.y));
                }
            }

            if (shotIndex >= shots.length) {
                setTimeout(finishBurst, VANISH_BURST_SHOT_INTERVAL_MS);
                return;
            }
            setTimeout(fireNext, VANISH_BURST_SHOT_INTERVAL_MS);
        };

        fireNext();
        return true;
    }

    function getVanishDragHighlightState(wizardRef) {
        if (!wizardRef || !wizardRef.vanishDragMode) return null;
        const state = wizardRef.vanishDragTargetingState;
        if (!state || typeof state !== "object") {
            return { objects: [], wallPreviews: [] };
        }

        const objects = [];
        const seen = new Set();
        if (Array.isArray(state.queuedObjects)) {
            for (let i = 0; i < state.queuedObjects.length; i++) {
                const obj = state.queuedObjects[i];
                if (!obj || obj.gone || obj.vanishing || seen.has(obj)) continue;
                seen.add(obj);
                objects.push(obj);
            }
        }

        const wallPreviews = [];
        if (state.wallRanges instanceof Map) {
            state.wallRanges.forEach(entry => {
                const wall = entry && entry.wall;
                if (!wall || wall.gone || wall.vanishing) return;
                if (typeof wall.getVanishPreviewPolygonForRange !== "function") return;
                const preview = wall.getVanishPreviewPolygonForRange({
                    tStart: Number(entry.tStart),
                    tEnd: Number(entry.tEnd)
                });
                if (!preview || !Array.isArray(preview.points) || preview.points.length < 3) return;
                wallPreviews.push({ target: wall, preview });
            });
        }

        return { objects, wallPreviews };
    }

    function getRenderPriority(item) {
        if (!item) {
            return { band: 1, depth: 0, y: 0, x: 0 };
        }
        const band = (item.type === "road") ? 0 : 1;
        let depth = 0;
        if (Number.isFinite(item.renderZ)) {
            depth = Number(item.renderZ);
        } else if (item.type === "road") {
            depth = 0;
        } else {
            const baseDepth = Number.isFinite(item.y) ? item.y : 0;
            const depthOffset = Number.isFinite(item.renderDepthOffset) ? item.renderDepthOffset : 0;
            depth = baseDepth + depthOffset;
        }
        const y = Number.isFinite(item.y) ? item.y : 0;
        const x = Number.isFinite(item.x) ? item.x : 0;
        return { band, depth, y, x };
    }

    function getDisplayPriority(item) {
        const displayObj = getSpellTargetDisplayObject(item);
        if (!displayObj || !displayObj.parent) return null;
        try {
            const parent = displayObj.parent;
            const index = parent.getChildIndex(displayObj);
            if (!Number.isFinite(index)) return null;
            return { parent, index };
        } catch (_err) {
            return null;
        }
    }

    function compareTargetPriorityTopFirst(a, b) {
        const da = getDisplayPriority(a);
        const db = getDisplayPriority(b);
        if (da && db && da.parent === db.parent && da.index !== db.index) {
            return db.index - da.index;
        }
        const pa = getRenderPriority(a);
        const pb = getRenderPriority(b);
        if (pa.band !== pb.band) return pb.band - pa.band;
        if (pa.depth !== pb.depth) return pb.depth - pa.depth;
        if (pa.y !== pb.y) return pb.y - pa.y;
        return pb.x - pa.x;
    }

    function pickObjectViaRenderingColorId(worldX, worldY, filterFn = null) {
        const pickerApi = (typeof globalThis !== "undefined") ? globalThis.renderingScenePicker : null;
        if (!pickerApi) {
            return { picked: null, attempted: false };
        }
        if (typeof pickerApi.pickObjectAtScreenPoint !== "function") {
            return { picked: null, attempted: false };
        }
        const mouseScreen = (
            typeof mousePos !== "undefined" &&
            mousePos &&
            Number.isFinite(mousePos.screenX) &&
            Number.isFinite(mousePos.screenY)
        ) ? { x: mousePos.screenX, y: mousePos.screenY } : null;
        const clickScreen = mouseScreen || (
            (typeof worldToScreen === "function")
                ? worldToScreen({ x: worldX, y: worldY })
                : null
        );
        if (!clickScreen || !Number.isFinite(clickScreen.x) || !Number.isFinite(clickScreen.y)) {
            return { picked: null, attempted: false };
        }
        let picked = null;
        try {
            picked = pickerApi.pickObjectAtScreenPoint(clickScreen.x, clickScreen.y, {
                filter: filterFn
            });
        } catch (_err) {
            picked = null;
        }
        return { picked: picked || null, attempted: true };
    }

    function getSameTypeObjectTargetAt(wizardRef, spellName, worldX, worldY) {
        const objectType = getDragSpellObjectType(spellName);
        if (!wizardRef || !objectType || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const canTargetObject = (obj) => !!(
            obj &&
            !obj.gone &&
            obj.type === objectType &&
            !hasSpellAlreadyTargetedObject(wizardRef, spellName, obj)
        );

        const pickResult = pickObjectViaRenderingColorId(worldX, worldY, (obj) =>
            canTargetObject(obj)
        );
        if (pickResult && pickResult.attempted) {
            const picked = pickResult.picked;
            if (picked && canTargetObject(picked)) return picked;
            return null;
        }
        return null;
    }

    function getGroundAnchorPointForObject(obj, worldX, worldY) {
        if (!obj) return null;
        if (
            obj.type === "wallSection" &&
            obj.startPoint && obj.endPoint &&
            Number.isFinite(obj.startPoint.x) && Number.isFinite(obj.startPoint.y) &&
            Number.isFinite(obj.endPoint.x) && Number.isFinite(obj.endPoint.y) &&
            Number.isFinite(worldX) && Number.isFinite(worldY)
        ) {
            const endpointConnected = endpointKey => {
                if (typeof obj.hasConnectedWallAtEndpoint === "function") {
                    try {
                        return !!obj.hasConnectedWallAtEndpoint(endpointKey);
                    } catch (_) {
                        // Fall through to proximity fallback.
                    }
                }
                return false;
            };
            const aConnected = endpointConnected("a");
            const bConnected = endpointConnected("b");
            // Prefer extending from the free end when only one side is connected.
            if (aConnected !== bConnected) {
                return aConnected
                    ? { x: obj.endPoint.x, y: obj.endPoint.y }
                    : { x: obj.startPoint.x, y: obj.startPoint.y };
            }

            const clickScreen = (typeof worldToScreen === "function")
                ? worldToScreen({ x: worldX, y: worldY })
                : null;
            const endpointAScreen = (typeof worldToScreen === "function")
                ? worldToScreen({ x: obj.startPoint.x, y: obj.startPoint.y })
                : null;
            const endpointBScreen = (typeof worldToScreen === "function")
                ? worldToScreen({ x: obj.endPoint.x, y: obj.endPoint.y })
                : null;
            const hasScreenDistances = !!(
                clickScreen &&
                endpointAScreen &&
                endpointBScreen &&
                Number.isFinite(clickScreen.x) &&
                Number.isFinite(clickScreen.y) &&
                Number.isFinite(endpointAScreen.x) &&
                Number.isFinite(endpointAScreen.y) &&
                Number.isFinite(endpointBScreen.x) &&
                Number.isFinite(endpointBScreen.y)
            );

            let da = Infinity;
            let db = Infinity;
            if (hasScreenDistances) {
                da = Math.hypot(clickScreen.x - endpointAScreen.x, clickScreen.y - endpointAScreen.y);
                db = Math.hypot(clickScreen.x - endpointBScreen.x, clickScreen.y - endpointBScreen.y);
            } else {
                const dxA = (map && typeof map.shortestDeltaX === "function")
                    ? map.shortestDeltaX(worldX, obj.startPoint.x)
                    : (obj.startPoint.x - worldX);
                const dyA = (map && typeof map.shortestDeltaY === "function")
                    ? map.shortestDeltaY(worldY, obj.startPoint.y)
                    : (obj.startPoint.y - worldY);
                const dxB = (map && typeof map.shortestDeltaX === "function")
                    ? map.shortestDeltaX(worldX, obj.endPoint.x)
                    : (obj.endPoint.x - worldX);
                const dyB = (map && typeof map.shortestDeltaY === "function")
                    ? map.shortestDeltaY(worldY, obj.endPoint.y)
                    : (obj.endPoint.y - worldY);
                da = Math.hypot(dxA, dyA);
                db = Math.hypot(dxB, dyB);
            }
            return da <= db
                ? { x: obj.startPoint.x, y: obj.startPoint.y }
                : { x: obj.endPoint.x, y: obj.endPoint.y };
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
        if (spellName === "wall") {
            const node = wizardRef.map.worldToNode(anchor.x, anchor.y);
            return {
                obj,
                node,
                point: { x: anchor.x, y: anchor.y }
            };
        }
        if (spellName === "buildroad") {
            const node = wizardRef.map.worldToNode(anchor.x, anchor.y);
            if (node) return { obj, node, point: { x: node.x, y: node.y } };
        } else {
            return { obj, point: anchor };
        }
        return null;
    }

    function getDragStartSnapTargetForSpell(wizardRef, spellName, worldX, worldY) {
        if (!wizardRef || typeof spellName !== "string") return null;
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        return getDragStartSnapTargetAt(wizardRef, spellName, worldX, worldY);
    }

    function getVanishWallPreviewPolygonForHover(wizardRef, candidate, worldX, worldY) {
        if (!wizardRef || !candidate || candidate.gone || candidate.vanishing) return null;
        if (candidate.type !== "wallSection") return null;
        if (typeof candidate.getVanishPreviewPolygon !== "function") return null;
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;

        const travelPlan = buildVanishTravelPlan(wizardRef.x, wizardRef.y, worldX, worldY, {
            speed: VANISH_DEFAULT_SPEED,
            range: VANISH_DEFAULT_RANGE,
            frameRateValue: frameRate,
            mapRef: wizardRef.map || null
        });
        if (!travelPlan) return null;

        const impactPoint = predictVanishImpactPoint(travelPlan);
        if (!impactPoint || !Number.isFinite(impactPoint.x) || !Number.isFinite(impactPoint.y)) return null;

        return candidate.getVanishPreviewPolygon(
            { x: impactPoint.x, y: impactPoint.y },
            { removeWidthWorld: VANISH_REMOVE_WIDTH_WORLD }
        );
    }

    function getHoverTargetForCurrentSpell(wizardRef, worldX, worldY) {
        if (!wizardRef || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const spell = wizardRef.currentSpell;
        if (spell === "wall" || spell === "buildroad" || spell === "firewall") {
            return getSameTypeObjectTargetAt(wizardRef, spell, worldX, worldY);
        }
        if (spell === "placeobject") {
            const category = (typeof wizardRef.selectedPlaceableCategory === "string")
                ? wizardRef.selectedPlaceableCategory.trim().toLowerCase()
                : "";
            if (category === "windows" || category === "doors") {
                const placement = getPlaceObjectPlacementCandidate(wizardRef, worldX, worldY);
                return placement && placement.targetWall ? placement.targetWall : null;
            }
        }
        if (spell === "vanish") {
            return getObjectTargetAt(wizardRef, worldX, worldY);
        }
        return null;
    }

    function isValidHoverTargetForCurrentSpell(wizardRef, candidate, worldX, worldY) {
        if (!wizardRef || !candidate || candidate.gone || candidate.vanishing) return false;
        const spell = wizardRef.currentSpell;
        if (spell === "wall" || spell === "buildroad" || spell === "firewall") {
            const objectType = getDragSpellObjectType(spell);
            if (!objectType) return false;
            if (candidate.type !== objectType) return false;
            return !hasSpellAlreadyTargetedObject(wizardRef, spell, candidate);
        }
        if (spell === "placeobject") {
            const category = (typeof wizardRef.selectedPlaceableCategory === "string")
                ? wizardRef.selectedPlaceableCategory.trim().toLowerCase()
                : "";
            if (category === "windows" || category === "doors") {
                if (candidate.type !== "wallSection") return false;
                const placement = getPlaceObjectPlacementCandidate(wizardRef, worldX, worldY);
                return !!(placement && placement.targetWall === candidate);
            }
            return false;
        }
        if (spell === "vanish") {
            return !hasSpellAlreadyTargetedObject(wizardRef, spell, candidate);
        }
        return false;
    }

    function getPlaceObjectPlacementCandidate(wizardRef, worldX, worldY) {
        if (!wizardRef || !wizardRef.map || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const category = (typeof wizardRef.selectedPlaceableCategory === "string")
            ? wizardRef.selectedPlaceableCategory.trim().toLowerCase()
            : "";
        if (category !== "windows" && category !== "doors") return null;

        const placeableScale = Number.isFinite(wizardRef.selectedPlaceableScale)
            ? Number(wizardRef.selectedPlaceableScale)
            : 1;
        const clampedScale = Math.max(0.2, Math.min(5, placeableScale));
        const selectedAnchorY = Number.isFinite(wizardRef.selectedPlaceableAnchorY)
            ? Number(wizardRef.selectedPlaceableAnchorY)
            : 1;
        const windowWorldWidth = clampedScale;
        // Height fit is in world units; object height is clampedScale (not screen-scaled).
        const windowWorldHeight = clampedScale;
        const mouseScreen = (
            typeof mousePos !== "undefined" &&
            mousePos &&
            Number.isFinite(mousePos.screenX) &&
            Number.isFinite(mousePos.screenY)
        ) ? { x: mousePos.screenX, y: mousePos.screenY } : worldToScreen({ x: worldX, y: worldY });

        // Wall-mounted placement: iterate over all WallSectionUnit instances
        // and find the best placement candidate under the mouse cursor.
        const WSU = (typeof globalThis !== "undefined") ? globalThis.WallSectionUnit : null;
        if (!WSU || !WSU._allSections || WSU._allSections.size === 0) return null;

        const worldToScreenFn = (typeof worldToScreen === "function") ? worldToScreen : null;
        if (!worldToScreenFn) return null;

        const mapRef = wizardRef.map;
        const vs = Number.isFinite(viewscale) ? viewscale : 1;
        const xyr = Number.isFinite(xyratio) ? xyratio : 0.66;

        const pointInQuad = (p, q0, q1, q2, q3) => {
            const inTri = (pt, a, b, c) => {
                const bc = barycentricAtPoint(pt.x, pt.y, a.x, a.y, b.x, b.y, c.x, c.y);
                if (!bc) return false;
                const eps = 1e-4;
                return bc.u >= -eps && bc.v >= -eps && bc.w >= -eps;
            };
            return inTri(p, q0, q1, q2) || inTri(p, q0, q2, q3);
        };

        let best = null;

        WSU._allSections.forEach(section => {
            if (!section || !section.startPoint || !section.endPoint) return;
            const profile = section.getWallProfile();
            if (!profile) return;

            const wallHeight = Math.max(0, Number(section.height) || 0);
            const halfT = Math.max(0.001, Number(section.thickness) || 0.001) * 0.5;

            const sx = Number(section.startPoint.x);
            const sy = Number(section.startPoint.y);
            const ex = Number(section.endPoint.x);
            const ey = Number(section.endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
                !Number.isFinite(ex) || !Number.isFinite(ey)) return;

            const dx = ex - sx;
            const dy = ey - sy;
            const len = Math.hypot(dx, dy);
            if (!(len > 1e-6)) return;

            const ux = dx / len;
            const uy = dy / len;
            const vx = -uy;
            const vy = ux;
            const { aLeft, aRight, bLeft, bRight } = profile;

            // Compute cap base heights
            const adjHA = (typeof section.getAdjacentCollinearWallHeightAtEndpoint === "function")
                ? section.getAdjacentCollinearWallHeightAtEndpoint("a") : null;
            const adjHB = (typeof section.getAdjacentCollinearWallHeightAtEndpoint === "function")
                ? section.getAdjacentCollinearWallHeightAtEndpoint("b") : null;
            const capBaseA = Number.isFinite(adjHA) ? Math.max(0, Math.min(wallHeight, Number(adjHA))) : 0;
            const capBaseB = Number.isFinite(adjHB) ? Math.max(0, Math.min(wallHeight, Number(adjHB))) : 0;

            const toScreen = (pt, z) => {
                const s = worldToScreenFn(pt);
                return { x: s.x, y: s.y - z * vs * xyr };
            };

            // Screen-space face polygons
            const longFaceA = [toScreen(aLeft, 0), toScreen(bLeft, 0), toScreen(bLeft, wallHeight), toScreen(aLeft, wallHeight)];
            const longFaceB = [toScreen(aRight, 0), toScreen(bRight, 0), toScreen(bRight, wallHeight), toScreen(aRight, wallHeight)];
            const capFaceStart = [toScreen(aRight, capBaseA), toScreen(aLeft, capBaseA), toScreen(aLeft, wallHeight), toScreen(aRight, wallHeight)];
            const capFaceEnd = [toScreen(bLeft, capBaseB), toScreen(bRight, capBaseB), toScreen(bRight, wallHeight), toScreen(bLeft, wallHeight)];
            const topFace = [toScreen(aLeft, wallHeight), toScreen(bLeft, wallHeight), toScreen(bRight, wallHeight), toScreen(aRight, wallHeight)];

            const faceDepth = pts => pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
            const longAFront = faceDepth(longFaceA) >= faceDepth(longFaceB);
            const startCapFront = faceDepth(capFaceStart) >= faceDepth(capFaceEnd);
            const showStartCap = capBaseA < wallHeight - 1e-5;
            const showEndCap = capBaseB < wallHeight - 1e-5;

            const visiblePolygons = [];
            visiblePolygons.push(longAFront ? longFaceA : longFaceB);
            visiblePolygons.push(topFace);
            if (startCapFront && showStartCap) visiblePolygons.push(capFaceStart);
            if (!startCapFront && showEndCap) visiblePolygons.push(capFaceEnd);

            const containsMouse = visiblePolygons.some(poly =>
                pointInQuad(mouseScreen, poly[0], poly[1], poly[2], poly[3])
            );
            if (!containsMouse) return;

            // Mouse is over this wall section – compute placement.
            const facingSign = longAFront ? 1 : -1;
            const sectionStartScreen = (facingSign > 0) ? longFaceA[0] : longFaceB[0];
            const sectionEndScreen = (facingSign > 0) ? longFaceA[1] : longFaceB[1];
            const sdx = sectionEndScreen.x - sectionStartScreen.x;
            const sdy = sectionEndScreen.y - sectionStartScreen.y;
            const sLen2 = sdx * sdx + sdy * sdy;
            if (!(sLen2 > 1e-6)) return;

            const mouseRelX = mouseScreen.x - sectionStartScreen.x;
            const mouseRelY = mouseScreen.y - sectionStartScreen.y;
            const sectionProjT = Math.max(0, Math.min(1,
                (mouseRelX * sdx + mouseRelY * sdy) / sLen2));

            const sectionLength = len;
            const halfWidth = windowWorldWidth * 0.5;
            const fitsLength = sectionLength + 1e-6 >= windowWorldWidth;
            const fitsHeight = windowWorldHeight <= wallHeight + 1e-6;

            let along = sectionProjT * sectionLength;
            along = fitsLength
                ? Math.max(halfWidth, Math.min(sectionLength - halfWidth, along))
                : Math.max(0, Math.min(sectionLength, along));

            // Center-snap when mouse is near section center
            const sectionCenterAlong = sectionLength * 0.5;
            const sectionCenterWorld = {
                x: sx + ux * sectionCenterAlong + vx * halfT * facingSign,
                y: sy + uy * sectionCenterAlong + vy * halfT * facingSign
            };
            const faceMinX = Math.min(sectionStartScreen.x, sectionEndScreen.x);
            const faceMaxX = Math.max(sectionStartScreen.x, sectionEndScreen.x);
            const faceSpanX = faceMaxX - faceMinX;
            const centerSnapPx = 10;
            let centerDistPx = Infinity;
            if (faceSpanX > 1e-4) {
                centerDistPx = Math.abs(mouseScreen.x - (faceMinX + faceMaxX) * 0.5);
            } else {
                let topMinY = Infinity, topMaxY = -Infinity;
                for (let ti = 0; ti < topFace.length; ti++) {
                    if (topFace[ti].y < topMinY) topMinY = topFace[ti].y;
                    if (topFace[ti].y > topMaxY) topMaxY = topFace[ti].y;
                }
                if (Number.isFinite(topMinY) && Number.isFinite(topMaxY) && (topMaxY - topMinY) > 1e-4) {
                    centerDistPx = Math.abs(mouseScreen.y - (topMinY + topMaxY) * 0.5);
                }
            }
            let centerSnapActive = false;
            if (Number.isFinite(centerDistPx) && centerDistPx <= centerSnapPx) {
                along = fitsLength
                    ? Math.max(halfWidth, Math.min(sectionLength - halfWidth, sectionCenterAlong))
                    : Math.max(0, Math.min(sectionLength, sectionCenterAlong));
                centerSnapActive = true;
            }

            const rotDeg = Math.atan2(uy, ux) * (180 / Math.PI);
            const isDoorPlacement = category === "doors";
            const hitboxHalfT = isDoorPlacement ? (halfT * 1.1) : halfT;

            let centerX = sx + ux * along;
            let centerY = sy + uy * along;
            let wallFaceCenterX = centerX + vx * halfT * facingSign;
            let wallFaceCenterY = centerY + vy * halfT * facingSign;
            if (mapRef && typeof mapRef.wrapWorldX === "function") {
                centerX = mapRef.wrapWorldX(centerX);
                wallFaceCenterX = mapRef.wrapWorldX(wallFaceCenterX);
            }
            if (mapRef && typeof mapRef.wrapWorldY === "function") {
                centerY = mapRef.wrapWorldY(centerY);
                wallFaceCenterY = mapRef.wrapWorldY(wallFaceCenterY);
            }

            const normalBias = (category === "windows") ? 0.001 : 0;
            const desiredBaseX = wallFaceCenterX + vx * normalBias * facingSign;
            const desiredBaseY = wallFaceCenterY + vy * normalBias * facingSign;
            const verticalOffset = (1 - selectedAnchorY) * windowWorldHeight;
            let snappedX = desiredBaseX;
            let snappedY = isDoorPlacement
                ? (desiredBaseY - verticalOffset)
                : desiredBaseY;
            const snappedZ = (category === "windows") ? (wallHeight * 0.5) : 0;
            if (mapRef && typeof mapRef.wrapWorldX === "function") snappedX = mapRef.wrapWorldX(snappedX);
            if (mapRef && typeof mapRef.wrapWorldY === "function") snappedY = mapRef.wrapWorldY(snappedY);

            // Ground hitbox
            const p1 = { x: centerX - ux * halfWidth + vx * hitboxHalfT, y: centerY - uy * halfWidth + vy * hitboxHalfT };
            const p2 = { x: centerX + ux * halfWidth + vx * hitboxHalfT, y: centerY + uy * halfWidth + vy * hitboxHalfT };
            const p3 = { x: centerX + ux * halfWidth - vx * hitboxHalfT, y: centerY + uy * halfWidth - vy * hitboxHalfT };
            const p4 = { x: centerX - ux * halfWidth - vx * hitboxHalfT, y: centerY - uy * halfWidth - vy * hitboxHalfT };
            const wrapPt = (pt) => ({
                x: (mapRef && typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(pt.x) : pt.x,
                y: (mapRef && typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(pt.y) : pt.y
            });

            const candidate = {
                valid: fitsLength && fitsHeight,
                reason: !fitsLength
                    ? (isDoorPlacement ? "Door is wider than this wall section." : "Window is wider than this wall section.")
                    : (!fitsHeight
                        ? (isDoorPlacement ? "Door is taller than this wall." : "Window is taller than this wall.")
                        : null),
                targetWall: section,
                mountedWallLineGroupId: section.id,
                mountedSectionId: section.id,
                mountedWallSectionUnitId: section.id,
                mountedWallFacingSign: facingSign,
                snappedX,
                snappedY,
                snappedZ,
                snappedRotationDeg: rotDeg,
                wallGroundHitboxPoints: [wrapPt(p1), wrapPt(p2), wrapPt(p3), wrapPt(p4)],
                wallHeight,
                wallThickness: halfT * 2,
                centerSnapActive,
                sectionCenterX: (mapRef && typeof mapRef.wrapWorldX === "function")
                    ? mapRef.wrapWorldX(sectionCenterWorld.x) : sectionCenterWorld.x,
                sectionCenterY: (mapRef && typeof mapRef.wrapWorldY === "function")
                    ? mapRef.wrapWorldY(sectionCenterWorld.y) : sectionCenterWorld.y,
                sectionFacingSign: facingSign,
                sectionNormalX: vx,
                sectionNormalY: vy,
                sectionDirX: ux,
                sectionDirY: uy,
                wallFaceCenterX,
                wallFaceCenterY,
                placementHalfWidth: halfWidth,
                placementCenterX: desiredBaseX,
                placementCenterY: desiredBaseY
            };

            if (!best) {
                best = candidate;
            }
        });

        return best;
    }

    function beginDragSpell(wizardRef, spellName, worldX, worldY) {
        if (!wizardRef || wizardRef.castDelay) return false;
        if (!keysPressed[" "]) return false;
        const snapTarget = getDragStartSnapTargetAt(wizardRef, spellName, worldX, worldY);

        if (spellName === "wall") {
            if (!keysPressed[" "]) return false;
            const mapRef = wizardRef.map || null;
            const startPoint = (snapTarget && snapTarget.point)
                ? wrapWorldPointForMap(mapRef, Number(snapTarget.point.x), Number(snapTarget.point.y))
                : wrapWorldPointForMap(mapRef, worldX, worldY);
            if (!startPoint) return false;
            wizardRef.wallLayoutMode = true;
            wizardRef.wallStartPoint = startPoint;
            wizardRef.wallStartReferenceWall = (snapTarget && snapTarget.obj && snapTarget.obj.type === "wallSection")
                ? snapTarget.obj
                : null;
            wizardRef.wallDragMouseStartWorld = {
                x: (mapRef && typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(worldX) : worldX,
                y: (mapRef && typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(worldY) : worldY
            };
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

        if (spellName === "vanish") {
            wizardRef.vanishDragMode = true;
            ensureVanishDragTargetingState(wizardRef);
            queueVanishDragTargetAtPoint(wizardRef, worldX, worldY);
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
            if (wizardRef.currentSpell === "vanish") cancelDragSpell(wizardRef, "vanish");
            return false;
        }
        if (wizardRef.currentSpell === "wall" && wizardRef.wallLayoutMode && wizardRef.wallStartPoint && wizardRef.phantomWall) {
            const adjustedPoint = getAdjustedWallDragWorldPoint(wizardRef, worldX, worldY);
            if (!adjustedPoint) return false;
            updatePhantomWall(wizardRef.wallStartPoint.x, wizardRef.wallStartPoint.y, adjustedPoint.x, adjustedPoint.y);
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
        if (wizardRef.currentSpell === "vanish" && wizardRef.vanishDragMode) {
            queueVanishDragTargetAtPoint(wizardRef, worldX, worldY);
            return true;
        }
        return false;
    }

    function completeDragSpell(wizardRef, spellName, worldX, worldY) {
        if (!wizardRef || wizardRef.castDelay) return false;

        if (spellName === "wall") {
            if (!isDragSpellActive(wizardRef, "wall")) return false;
            const adjustedPoint = getAdjustedWallDragWorldPoint(wizardRef, worldX, worldY);
            if (!adjustedPoint) {
                cancelDragSpell(wizardRef, "wall");
                return true;
            }
            const endPoint = adjustedPoint;
            const startPoint = wizardRef.wallStartPoint;
            if (pointsMatchWorld(wizardRef.map, startPoint, endPoint)) {
                cancelDragSpell(wizardRef, "wall");
                return true;
            }

            // Create permanent WallSectionUnit walls from the drag.
            if (typeof WallSectionUnit !== "undefined" && wizardRef.map) {
                const thickness = Number.isFinite(wizardRef.selectedWallThickness)
                    ? wizardRef.selectedWallThickness : 0.1;
                const height = Number.isFinite(wizardRef.selectedWallHeight)
                    ? wizardRef.selectedWallHeight : 1;
                const result = WallSectionUnit.createPlacementFromWorldPoints(
                    wizardRef.map, startPoint, endPoint, {
                        thickness,
                        height,
                        bottomZ: 0,
                        autoMergeContinuous: false
                    }
                );
                if (result && Array.isArray(result.sections)) {
                    for (let i = 0; i < result.sections.length; i++) {
                        result.sections[i].addToMapNodes();
                    }
                }
            }
            cancelDragSpell(wizardRef, "wall");
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
                new FirewallEmitter({ x: px, y: py }, wizardRef.map, (i * 11) % 25);
            }
            cancelDragSpell(wizardRef, "firewall");
            cooldown(wizardRef, wizardRef.cooldownTime);
            return true;
        }

        if (spellName === "vanish") {
            if (!isDragSpellActive(wizardRef, "vanish")) return false;
            if (Number.isFinite(worldX) && Number.isFinite(worldY)) {
                queueVanishDragTargetAtPoint(wizardRef, worldX, worldY);
            }
            const burstTargets = buildVanishBurstTargetsFromQueuedState(wizardRef);
            cancelDragSpell(wizardRef, "vanish");
            if (burstTargets.length === 0) return true;
            castQueuedVanishBurst(wizardRef, burstTargets);
            return true;
        }

        return false;
    }

    const CHARACTER_COLLISION_ANIMAL_STEP_INTERVAL = 2;
    let collisionQueryStamp = 1;
    const collisionNearbyObjectsScratch = [];
    const collisionTargetsScratch = [];

    function getNearbyObjects(mapRef, hitbox, outArray = null, options = {}) {
        if (!mapRef || !hitbox || typeof hitbox.getBounds !== "function") return [];
        const bounds = hitbox.getBounds();
        if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
            return [];
        }

        const margin = Number.isFinite(options.margin) ? Number(options.margin) : 1.0;
        const requireCollisionHandler = !!options.requireCollisionHandler;
        const minNode = mapRef.worldToNode(bounds.x - margin, bounds.y - margin);
        const maxNode = mapRef.worldToNode(bounds.x + bounds.width + margin, bounds.y + bounds.height + margin);
        if (!minNode || !maxNode) return [];

        const toWrappedRanges = (startIdx, endIdx, size, wrapEnabled) => {
            if (!Number.isFinite(startIdx) || !Number.isFinite(endIdx) || !Number.isFinite(size) || size <= 0) {
                return [];
            }
            const sRaw = Math.floor(startIdx);
            const eRaw = Math.floor(endIdx);
            const lo = Math.min(sRaw, eRaw);
            const hi = Math.max(sRaw, eRaw);
            if (!wrapEnabled) {
                const s = Math.max(0, Math.min(size - 1, lo));
                const e = Math.max(0, Math.min(size - 1, hi));
                if (e < s) return [];
                return [{ start: s, end: e }];
            }
            if ((hi - lo + 1) >= size) return [{ start: 0, end: size - 1 }];
            const wrap = (n) => ((n % size) + size) % size;
            const s = wrap(lo);
            const e = wrap(hi);
            if (s <= e) return [{ start: s, end: e }];
            return [
                { start: 0, end: e },
                { start: s, end: size - 1 }
            ];
        };

        const xRanges = toWrappedRanges(minNode.xindex, maxNode.xindex, mapRef.width, !!mapRef.wrapX);
        const yRanges = toWrappedRanges(minNode.yindex, maxNode.yindex, mapRef.height, !!mapRef.wrapY);
        if (xRanges.length === 0 || yRanges.length === 0) return [];
        const nearbyObjects = Array.isArray(outArray) ? outArray : [];
        nearbyObjects.length = 0;

        collisionQueryStamp += 1;
        if (!Number.isFinite(collisionQueryStamp) || collisionQueryStamp > 2147483000) {
            collisionQueryStamp = 1;
        }
        const queryStamp = collisionQueryStamp;

        for (const xRange of xRanges) {
            for (let x = xRange.start; x <= xRange.end; x++) {
                for (const yRange of yRanges) {
                    for (let y = yRange.start; y <= yRange.end; y++) {
                        const node = mapRef.nodes[x] && mapRef.nodes[x][y] ? mapRef.nodes[x][y] : null;
                        if (!node || !Array.isArray(node.objects) || node.objects.length === 0) continue;
                        for (const obj of node.objects) {
                            if (!obj || obj.gone) continue;
                            if (requireCollisionHandler && typeof obj.handleCharacterCollision !== "function") continue;
                            if (obj._collisionQueryStamp === queryStamp) continue;
                            obj._collisionQueryStamp = queryStamp;
                            nearbyObjects.push(obj);
                        }
                    }
                }
            }
        }

        return nearbyObjects;
    }

    function getNearbyObjectsAroundWizard(mapRef, wizardRef, outArray = null, options = {}) {
        if (!mapRef || !wizardRef || typeof mapRef.worldToNode !== "function") return [];
        const centerNode = mapRef.worldToNode(wizardRef.x, wizardRef.y);
        if (!centerNode) return [];

        const tileRadius = Number.isFinite(options.tileRadius)
            ? Math.max(0, Math.floor(options.tileRadius))
            : 2;
        const requireCollisionHandler = !!options.requireCollisionHandler;
        const nearbyObjects = Array.isArray(outArray) ? outArray : [];
        nearbyObjects.length = 0;

        collisionQueryStamp += 1;
        if (!Number.isFinite(collisionQueryStamp) || collisionQueryStamp > 2147483000) {
            collisionQueryStamp = 1;
        }
        const queryStamp = collisionQueryStamp;

        for (let dx = -tileRadius; dx <= tileRadius; dx++) {
            for (let dy = -tileRadius; dy <= tileRadius; dy++) {
                let xi = centerNode.xindex + dx;
                let yi = centerNode.yindex + dy;
                if (mapRef.wrapX && typeof mapRef.wrapIndexX === "function") {
                    xi = mapRef.wrapIndexX(xi);
                }
                if (mapRef.wrapY && typeof mapRef.wrapIndexY === "function") {
                    yi = mapRef.wrapIndexY(yi);
                }
                if (!mapRef.wrapX && (xi < 0 || xi >= mapRef.width)) continue;
                if (!mapRef.wrapY && (yi < 0 || yi >= mapRef.height)) continue;

                const node = mapRef.nodes[xi] && mapRef.nodes[xi][yi] ? mapRef.nodes[xi][yi] : null;
                if (!node || !Array.isArray(node.objects) || node.objects.length === 0) continue;
                for (const obj of node.objects) {
                    if (!obj || obj.gone) continue;
                    if (requireCollisionHandler && typeof obj.handleCharacterCollision !== "function") continue;
                    if (obj._collisionQueryStamp === queryStamp) continue;
                    obj._collisionQueryStamp = queryStamp;
                    nearbyObjects.push(obj);
                }
            }
        }

        return nearbyObjects;
    }

    function updateCharacterObjectCollisions(wizardRef) {
        if (!wizardRef || !wizardRef.map) return;
        const activeFirewalls = Number(
            (typeof globalThis !== "undefined" && globalThis.activeFirewallEmitterCount)
                ? globalThis.activeFirewallEmitterCount
                : 0
        );
        if (activeFirewalls <= 0) return;
        if (wizardRef.gone || wizardRef.dead) return;
        const target = wizardRef;
        const targetHitbox = target.visualHitbox || target.groundPlaneHitbox || target.hitbox;
        if (!targetHitbox) return;
        const nearbyObjects = getNearbyObjectsAroundWizard(
            wizardRef.map,
            wizardRef,
            collisionNearbyObjectsScratch,
            { tileRadius: 2, requireCollisionHandler: true }
        );
        for (const obj of nearbyObjects) {
            if (!obj) continue;
            obj.handleCharacterCollision(target);
        }
    }

    function getObjectTargetAt(wizardRef, worldX, worldY) {
        const activeSpell = wizardRef ? wizardRef.currentSpell : null;
        const canTargetObject = (obj) => !!(
            obj &&
            !obj.gone &&
            !obj.vanishing &&
            !hasSpellAlreadyTargetedObject(wizardRef, activeSpell, obj)
        );

        const pickResult = pickObjectViaRenderingColorId(worldX, worldY, (obj) =>
            canTargetObject(obj)
        );
        if (!pickResult || !pickResult.attempted) return null;
        const picked = pickResult.picked;
        if (picked && canTargetObject(picked)) return picked;
        return null;
    }

    function castWizardSpell(wizardRef, worldX, worldY) {
        if (!wizardRef || wizardRef.castDelay) return;

        if (wizardRef.currentSpell === "vanish" && isDragSpellActive(wizardRef, "vanish")) {
            completeDragSpell(wizardRef, "vanish", worldX, worldY);
            return;
        }

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

        if (wizardRef.currentSpell === "teleport") {
            const projectile = new Teleport();
            const delayTime = projectile.delayTime || wizardRef.cooldownTime;
            wizardRef.castDelay = true;
            projectiles.push(projectile.cast(worldX, worldY));
            wizardRef.casting = true;
            setTimeout(() => {
                wizardRef.castDelay = false;
                wizardRef.casting = false;
            }, 1000 * delayTime);
            return;
        }

        if (wizardRef.currentSpell === "blackdiamond") {
            const mapRef = wizardRef.map || (typeof map !== "undefined" ? map : null);
            const placeX = mapRef && typeof mapRef.wrapWorldX === "function"
                ? mapRef.wrapWorldX(worldX)
                : worldX;
            const placeY = mapRef && typeof mapRef.wrapWorldY === "function"
                ? mapRef.wrapWorldY(worldY)
                : worldY;
            const powerupPlacement = getPowerupPlacementPreviewConfig(wizardRef);
            if (Number.isFinite(placeX) && Number.isFinite(placeY) && typeof addPowerup === "function") {
                addPowerup(powerupPlacement.fileName, {
                    x: placeX,
                    y: placeY,
                    map: mapRef,
                    imagePath: powerupPlacement.imagePath,
                    width: powerupPlacement.width,
                    height: powerupPlacement.height,
                    radius: powerupPlacement.radius
                });
            }
            const delayTime = Math.max(0.05, Number(wizardRef.cooldownTime) || 0.1);
            wizardRef.castDelay = true;
            wizardRef.casting = true;
            setTimeout(() => {
                wizardRef.castDelay = false;
                wizardRef.casting = false;
            }, 1000 * delayTime);
            return;
        }

        if (wizardRef.currentSpell === "maze") {
            const mapRef = wizardRef.map || (typeof map !== "undefined" ? map : null);
            if (
                !mapRef ||
                typeof mapRef.worldToNode !== "function" ||
                typeof mapRef.findPathAStar !== "function"
            ) {
                message("Pathfinding is unavailable.");
                return;
            }

            const wrappedX = typeof mapRef.wrapWorldX === "function" ? mapRef.wrapWorldX(worldX) : worldX;
            const wrappedY = typeof mapRef.wrapWorldY === "function" ? mapRef.wrapWorldY(worldY) : worldY;
            const startNode = mapRef.worldToNode(wizardRef.x, wizardRef.y);
            const destinationNode = mapRef.worldToNode(wrappedX, wrappedY);

            if (!startNode || !destinationNode) {
                message("Cannot find a path there.");
                return;
            }

            const directDx = (typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(startNode.x, destinationNode.x)
                : (destinationNode.x - startNode.x);
            const directDy = (typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(startNode.y, destinationNode.y)
                : (destinationNode.y - startNode.y);
            const directDistance = Math.hypot(directDx, directDy);
            const maxIterations = Math.max(
                800,
                Math.min(12000, Math.floor((directDistance + 8) * 180))
            );

            const astarPath = mapRef.findPathAStar(startNode, destinationNode, {
                maxIterations
            });

            if (!Array.isArray(astarPath)) {
                message("No path found.");
                return;
            }

            const nodesAlongPath = [startNode, ...astarPath];
            const seenNodes = new Set();
            for (let i = 0; i < nodesAlongPath.length; i++) {
                const node = nodesAlongPath[i];
                if (!node) continue;
                const key = `${node.xindex},${node.yindex}`;
                if (seenNodes.has(key)) continue;
                seenNodes.add(key);
                if (typeof addPowerup === "function") {
                    addPowerup("black diamond.png", {
                        x: node.x,
                        y: node.y,
                        map: mapRef
                    });
                }
            }

            const delayTime = Math.max(0.05, Number(wizardRef.cooldownTime) || 0.1);
            wizardRef.castDelay = true;
            wizardRef.casting = true;
            setTimeout(() => {
                wizardRef.castDelay = false;
                wizardRef.casting = false;
            }, 1000 * delayTime);
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
        } else if (wizardRef.currentSpell === "placeobject") {
            projectile = new PlaceObject();
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
            if (spell.name === "placeobject") {
                return {...spell, key, icon: getPlaceObjectSpellIcon(wizardRef)};
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
            const texturePath = `/assets/images/trees/tree${textureIndex}.png`;
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

    function renderPlaceableCategorySelector(wizardRef) {
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

        getPlaceableCategories().forEach(category => {
            const selectedTexture = getSelectedPlaceableTextureForCategory(wizardRef, category);
            const icon = $("<div>")
                .addClass("spellIcon")
                .css({
                    "background-image": `url('${selectedTexture}')`,
                    "background-size": "cover",
                    "background-position": "center center"
                })
                .attr("title", category)
                .click(() => {
                    setSelectedPlaceableCategory(wizardRef, category);
                    placeableMenuCategory = category;
                    spellMenuMode = "placeable-items";
                    renderPlaceableItemSelector(wizardRef, category);
                    fetchPlaceableImages().then(() => {
                        if (spellMenuMode === "placeable-items" && placeableMenuCategory === category) {
                            renderPlaceableItemSelector(wizardRef, category);
                        }
                    });
                });
            $grid.append(icon);
        });
    }

    function renderPlaceableItemSelector(wizardRef, category) {
        const safeCategory = PLACEABLE_CATEGORIES.includes(category) ? category : DEFAULT_PLACEABLE_CATEGORY;
        placeableMenuCategory = safeCategory;
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
                spellMenuMode = "placeable-categories";
                renderPlaceableCategorySelector(wizardRef);
            });
        $grid.append(backButton);

        const selectedTexture = getSelectedPlaceableTextureForCategory(wizardRef, safeCategory);
        const texturePaths = getPlaceableImageList(safeCategory);
        texturePaths.forEach(texturePath => {
            const icon = $("<div>")
                .addClass("spellIcon")
                .css({
                    "background-image": `url('${texturePath}')`,
                    "background-size": "cover",
                    "background-position": "center center"
                })
                .attr("title", decodeURIComponent((texturePath.split("/").pop() || texturePath)))
                .click(() => {
                    normalizePlaceableSelections(wizardRef);
                    wizardRef.selectedPlaceableByCategory[safeCategory] = texturePath;
                    wizardRef.selectedPlaceableCategory = safeCategory;
                    wizardRef.selectedPlaceableTexturePath = texturePath;
                    normalizePlaceableSelections(wizardRef);
                    refreshSelectedPlaceableMetadata(wizardRef);
                    spellMenuMode = "main";
                    setCurrentSpell(wizardRef, "placeobject");
                    $("#spellMenu").addClass("hidden");
                });
            if (texturePath === selectedTexture) {
                icon.addClass("selected");
            }
            $grid.append(icon);
        });
    }

    function openPlaceableSelector(wizardRef) {
        spellMenuMode = "placeable-categories";
        $("#spellMenu").removeClass("hidden");
        placeableMenuCategory = getSelectedPlaceableCategory(wizardRef);
        renderPlaceableCategorySelector(wizardRef);
        fetchPlaceableImages().then(() => {
            if (spellMenuMode === "placeable-items") {
                renderPlaceableItemSelector(wizardRef, placeableMenuCategory || getSelectedPlaceableCategory(wizardRef));
            } else if (spellMenuMode === "placeable-categories") {
                renderPlaceableCategorySelector(wizardRef);
            }
        });
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
        if (spellMenuMode === "placeable-items") {
            renderPlaceableItemSelector(wizardRef, placeableMenuCategory || getSelectedPlaceableCategory(wizardRef));
            return;
        }
        if (spellMenuMode === "placeable-categories") {
            renderPlaceableCategorySelector(wizardRef);
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
            } else if (spell.name === "placeobject") {
                spellIcon.on("contextmenu", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openPlaceableSelector(wizardRef);
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
        if (spellName !== "vanish") cancelDragSpell(wizardRef, "vanish");
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
        normalizePlaceableSelections(wizardRef);
        getSelectedPowerupPlacementScale(wizardRef);
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
        fetchPlaceableImages().then(() => {
            normalizePlaceableSelections(wizardRef);
            refreshSelectedPlaceableMetadata(wizardRef);
            wizardRef.spells = buildSpellList(wizardRef);
            refreshSpellSelector(wizardRef);
        });
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

    function showPlaceableMenu(wizardRef) {
        if (!wizardRef) return;
        setCurrentSpell(wizardRef, "placeobject");
        openPlaceableSelector(wizardRef);
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
        showPlaceableMenu,
        adjustPlaceableRenderOffset,
        adjustPlaceableScale,
        adjustPowerupPlacementScale,
        adjustPlaceableRotation,
        getPowerupPlacementPreviewConfig,
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
        getHoverTargetForCurrentSpell,
        isValidHoverTargetForCurrentSpell,
        getVanishWallPreviewPolygonForHover,
        getVanishDragHighlightState,
        getDragStartSnapTargetForSpell,
        getPlaceObjectPlacementCandidate,
        getAdjustedWallDragWorldPoint
    };
})();
