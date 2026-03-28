class Fireball extends globalThis.Spell {
    static FLIGHT_Z = 1;
    static WALL_IMPACT_SPEED_MULTIPLIER = 0.1;
    static WALL_IMPACT_ANIMATION_MULTIPLIER = 10;
    static MAGIC_COST = 20;

    static supportsObjectTargeting = true;

    static isValidObjectTarget(target, _wizardRef = null) {
        if (!target || target.gone || target.vanishing || target.dead) return false;
        if (target.type === "wallSection" || target.type === "wall") return false;
        if (globalThis.Spell.isGroundLayerTarget(target)) return false;
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
        this.damageRadius = 0.25;
        this.delayTime = 0.5;
        this.radius = this.damageRadius;
        this.z = Fireball.FLIGHT_Z;
        this.animationElapsedMs = 0;
        this._wallImpactStateActive = false;
        this._lastUpdateTime = null;
        this._lastWizardTrackedX = null;
        this._lastWizardTrackedY = null;
    }

    canTrackForcedTarget(target) {
        if (!target || target.gone || target.vanishing || target.dead) return false;
        if (target.type === "tree") return true;
        return super.canTrackForcedTarget(target);
    }

    cast(targetX, targetY) {
        const fireballFrames = Fireball.getFrames();

        // check magic
        if (!globalThis.Spell.canAffordMagicCost(Fireball.MAGIC_COST, wizard)) {
            globalThis.Spell.indicateInsufficientMagic();
            message("Not enough magic to cast Fireball!");
            return this;
        }
        globalThis.Spell.spendMagicCost(Fireball.MAGIC_COST, wizard);
        this.explosionFrames = fireballFrames || [];
        
        // For fireball, only use target for direction.
        // Speed and range are independent from click distance.
        this.targetX = targetX;
        this.targetY = targetY;
        this.traveledDist = 0;
        
        this.visible = true;
        this.x = wizard.x;
        this.y = wizard.y;
        this.z = Fireball.FLIGHT_Z;
        
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

        // For targeted fireballs, tune totalDist so the fireball burns out
        // just before reaching the target's center rather than flying past it.
        const initialForcedAim = this.getForcedTargetAimPoint();
        if (initialForcedAim) {
            const distToTarget = Math.hypot(initialForcedAim.x - this.x, initialForcedAim.y - this.y);
            if (distToTarget > 0.1) {
                this.totalDist = distToTarget * 1.08;
            }
        }

        // Lifetime tied to base spell range/speed.
        const cycleDurationMs = Math.max(1, (this.totalDist / Math.max(this.speed, 0.001)) * 1000);
        this.travelStartTime = performance.now();
        this.travelPausedTime = 0;
        this._pausedAt = null;
        this._lastUpdateTime = this.travelStartTime;
        this.animationElapsedMs = 0;
        this._wallImpactStateActive = false;
        this._lastWizardTrackedX = wizard.x;
        this._lastWizardTrackedY = wizard.y;

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
            const deltaMs = Math.max(0, now - (this._lastUpdateTime || now));
            this._lastUpdateTime = now;
            const deltaSec = deltaMs / 1000;

            this.animationElapsedMs += deltaMs * this.getAnimationSpeedMultiplier();
            const animationProgress = this.animationElapsedMs / cycleDurationMs;
            const animationFinished = animationProgress >= 1;
            
            // Update animation frame based on same progress
            if (this.explosionFrames && this.explosionFrames.length > 0) {
                const maxFrameIndex = this.explosionFrames.length - 1;
                this.explosionFrame = animationFinished
                    ? maxFrameIndex
                    : (Math.floor(animationProgress * this.explosionFrames.length) % this.explosionFrames.length);
            }
            
            // Base projectile movement (in aiming direction)
            const step = Math.max(0, Math.min(this.totalDist - this.traveledDist, this.speed * this.getMovementSpeedMultiplier() * deltaSec));
            const forcedAim = this.getForcedTargetAimPoint();
            if (forcedAim) {
                const dx = forcedAim.x - this.x;
                const dy = forcedAim.y - this.y;
                const aimDist = Math.hypot(dx, dy);
                if (aimDist > 1e-6 && step > 0) {
                    const ndx = dx / aimDist;
                    const ndy = dy / aimDist;
                    this.x += ndx * step;
                    this.y += ndy * step;
                    this._lastHomingDirX = ndx;
                    this._lastHomingDirY = ndy;
                }
                this.traveledDist += step;
            } else if (this._lastHomingDirX !== undefined) {
                // Target is gone — keep coasting in the last homing direction
                // to avoid any position snap/freeze.
                if (step > 0) {
                    this.x += this._lastHomingDirX * step;
                    this.y += this._lastHomingDirY * step;
                    this.traveledDist += step;
                }
            } else {
                if (step > 0) {
                    this.x += this.baseDirX * step;
                    this.y += this.baseDirY * step;
                    this.traveledDist += step;
                }
                // Preserve the existing "caster carries the projectile" behavior
                // by adding only the wizard's per-frame displacement.
                const currentWizardX = Number.isFinite(wizard && wizard.x) ? wizard.x : this.castWizardX;
                const currentWizardY = Number.isFinite(wizard && wizard.y) ? wizard.y : this.castWizardY;
                if (Number.isFinite(this._lastWizardTrackedX) && Number.isFinite(this._lastWizardTrackedY)) {
                    this.x += currentWizardX - this._lastWizardTrackedX;
                    this.y += currentWizardY - this._lastWizardTrackedY;
                }
                this._lastWizardTrackedX = currentWizardX;
                this._lastWizardTrackedY = currentWizardY;
            }
            
            // Check for continuous damage while moving
            this.land();
            
            // Check if reached target
            if (animationFinished) {
                this.visible = false;
                this.detachPixiSprite();
                clearInterval(this.castInterval);
            }
        }, 1000 / frameRate);
        return this;
    }

    getMovementSpeedMultiplier() {
        return this._wallImpactStateActive ? Fireball.WALL_IMPACT_SPEED_MULTIPLIER : 1;
    }

    getAnimationSpeedMultiplier() {
        return this._wallImpactStateActive ? Fireball.WALL_IMPACT_ANIMATION_MULTIPLIER : 1;
    }

    activateWallImpactState() {
        this._wallImpactStateActive = true;
    }

    land() {
        const impactCircle = {type: "circle", x: this.x, y: this.y, radius: this.radius};
        const directTarget = (this.forcedTarget && !this.forcedTarget.gone && !this.forcedTarget.vanishing)
            ? this.forcedTarget
            : null;

        const doesImpactHitObject = (obj) => {
            if (!obj) return false;
            const hitboxes = (obj.type === "tree")
                ? [obj.visualHitbox, obj.groundPlaneHitbox, obj.hitbox]
                : [obj.visualHitbox, obj.groundPlaneHitbox, obj.hitbox];
            for (let i = 0; i < hitboxes.length; i++) {
                const hb = hitboxes[i];
                if (!hb || typeof hb.intersects !== "function") continue;
                if (hb.intersects(impactCircle)) return true;
            }

            // Small proximity fallback for directly forced targets to tolerate
            // tiny center/anchor mismatches while homing.
            if (obj === directTarget) {
                const resolver = (typeof globalThis.getSpellTargetAimPoint === "function")
                    ? globalThis.getSpellTargetAimPoint
                    : null;
                const resolvedAim = resolver
                    ? resolver((typeof wizard !== "undefined") ? wizard : null, obj)
                    : null;
                const targetX = Number.isFinite(resolvedAim && resolvedAim.x)
                    ? Number(resolvedAim.x)
                    : (Number.isFinite(obj.x) ? Number(obj.x) : null);
                const targetY = Number.isFinite(resolvedAim && resolvedAim.y)
                    ? Number(resolvedAim.y)
                    : (Number.isFinite(obj.y) ? Number(obj.y) : null);
                if (Number.isFinite(targetX) && Number.isFinite(targetY)) {
                    const sizeBias = (obj.type === "tree")
                        ? Math.max(0.4, (Math.max(Number(obj.width) || 0, Number(obj.height) || 0) * 0.3))
                        : 0;
                    return distance(this.x, this.y, targetX, targetY) <= Math.max(this.radius + 0.35 + sizeBias, 0.6);
                }
            }
            return false;
        };

        for (let obj of onscreenObjects) {
            if (!obj || obj.gone || obj.vanishing) continue;
            if (globalThis.Spell.isGroundLayerTarget(obj)) continue;
            if (obj.type === "tree" && obj !== directTarget) continue;

            if (doesImpactHitObject(obj)) {
                if (obj.type === "wallSection" || obj.type === "wall") {
                    this.activateWallImpactState();
                    continue;
                }
                // Don't re-ignite objects that are already dead
                if (obj.burned || obj.hp <= 0) {
                    continue;
                }
                if (!Number.isFinite(obj.hp)) {
                    const inferredMaxHp = Number.isFinite(obj.maxHp)
                        ? Number(obj.maxHp)
                        : (Number.isFinite(obj.maxHP) ? Number(obj.maxHP) : 100);
                    obj.hp = inferredMaxHp;
                }
                const canonicalMaxHp = Number.isFinite(obj.maxHp)
                    ? Number(obj.maxHp)
                    : (Number.isFinite(obj.maxHP) ? Number(obj.maxHP) : Number(obj.hp));
                if (!Number.isFinite(obj.maxHp)) obj.maxHp = canonicalMaxHp;
                if (!Number.isFinite(obj.maxHP)) obj.maxHP = canonicalMaxHp;

                const maxHpForIgnite = Number.isFinite(canonicalMaxHp) ? canonicalMaxHp : Number(obj.hp);
                if (!Number.isFinite(maxHpForIgnite) || maxHpForIgnite <= 0) {
                    continue;
                }
                const burnTickDamage = 0.1 * (obj.flamability || 1);
                if (typeof obj.takeDamage === "function") {
                    obj.takeDamage(burnTickDamage);
                } else {
                    obj.hp -= burnTickDamage; // Damage per frame
                }
                if (obj.hp <= 0 && !obj.dead && typeof obj.die === "function") {
                    obj.die();
                }
                if (obj.hp < maxHpForIgnite) {
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
