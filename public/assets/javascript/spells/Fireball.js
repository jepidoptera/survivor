class Fireball extends globalThis.Spell {
    static supportsObjectTargeting = true;

    static isValidObjectTarget(target, _wizardRef = null) {
        if (!target || target.gone || target.vanishing || target.dead) return false;
        // Fireball can force-target trees and any other pickable object.
        return true;
    }

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
        const getMetadata = (typeof globalThis.getMagicAssetMetadata === "function")
            ? globalThis.getMagicAssetMetadata
            : null;
        const resolveConfig = (typeof globalThis.resolveAnimatedSheetConfig === "function")
            ? globalThis.resolveAnimatedSheetConfig
            : null;
        if (!getMetadata || !resolveConfig) return;
        Fireball._metadataLoadPromise = getMetadata(Fireball.frameSourcePath)
            .then(meta => {
                if (!meta) return;
                const cfg = resolveConfig(
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

    canTrackForcedTarget(target) {
        if (!target || target.gone || target.vanishing || target.dead) return false;
        if (target.type === "tree") return true;
        return super.canTrackForcedTarget(target);
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
        const impactCircle = {type: "circle", x: this.x, y: this.y, radius: this.radius};
        const directTarget = (this.forcedTarget && !this.forcedTarget.gone && !this.forcedTarget.vanishing)
            ? this.forcedTarget
            : null;

        const doesImpactHitObject = (obj) => {
            if (!obj) return false;
            // Tree targeting should key off the trunk/base location (ground plane),
            // not canopy-only visual hitboxes.
            const primaryHitbox = (obj.type === "tree")
                ? (obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox)
                : (obj.visualHitbox || obj.groundPlaneHitbox || obj.hitbox);
            if (!primaryHitbox || typeof primaryHitbox.intersects !== "function") return false;
            if (primaryHitbox.intersects(impactCircle)) return true;

            // Small proximity fallback for directly forced targets to tolerate
            // tiny center/anchor mismatches while homing.
            if (obj === directTarget && Number.isFinite(obj.x) && Number.isFinite(obj.y)) {
                return distance(this.x, this.y, obj.x, obj.y) <= Math.max(this.radius + 0.35, 0.6);
            }
            return false;
        };

        for (let obj of onscreenObjects) {
            if (!obj || obj.gone || obj.vanishing) continue;
            if (obj.type === "tree" && obj !== directTarget) continue;

            if (doesImpactHitObject(obj)) {
                // Don't re-ignite objects that are already dead
                if (obj.burned || obj.hp <= 0) {
                    continue;
                }
                if (!obj.hp) {
                    obj.hp = obj.maxHP || 100;
                    obj.maxHP = obj.hp;
                }
                obj.hp -= 0.1 * (obj.flamability || 1); // Damage per frame
                if (obj.hp < obj.maxHP) {
                    if (typeof obj.ignite === "function") {
                        obj.ignite();
                    } else {
                        obj.isOnFire = true;
                    }
                }
            }
        }
    }
}



globalThis.Fireball = Fireball;
