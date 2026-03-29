class Iceball extends globalThis.Fireball {
    static frameSourcePath = "/assets/images/magic/iceball.png";
    static frames = null;
    static frameCountX = 1;
    static frameCountY = 1;
    static animatedFps = 0;
    static _metadataLoadPromise = null;
    static _metadataLoaded = false;
    static FREEZE_TINT = 0x9fd8ff;
    static MAGIC_COST = 20;
    static TRAIL_PARTICLES_PER_UNIT = 10;
    static IMPACT_PARTICLE_COUNT = 70;
    static PARTICLE_GRAVITY = 4.8;
    static IMPACT_EFFECT_DURATION_MS = 650;
    static TRAIL_PARTICLE_LIFE_MS = 1200;
    static TRAIL_PARTICLE_FADE_DELAY_MS = 650;
    static IMPACT_PARTICLE_LIFE_MS = 1800;
    static IMPACT_PARTICLE_FADE_DELAY_MS = 950;

    static isValidObjectTarget(target, _wizardRef = null) {
        if (!target || target.gone || target.vanishing || target.dead) return false;
        if (globalThis.Spell.isGroundLayerTarget(target)) return false;
        if (target.type === "wallSection" || target.type === "wall" || target.type === "tree") return false;
        return typeof target.freeze === "function";
    }

    static ensureMagicMetadataLoaded() {
        if (Iceball._metadataLoaded) return;
        if (Iceball._metadataLoadPromise) return;
        const getMetadata = (typeof globalThis.getMagicAssetMetadata === "function")
            ? globalThis.getMagicAssetMetadata
            : null;
        const resolveConfig = (typeof globalThis.resolveAnimatedSheetConfig === "function")
            ? globalThis.resolveAnimatedSheetConfig
            : null;
        if (!getMetadata || !resolveConfig) return;
        Iceball._metadataLoadPromise = getMetadata(Iceball.frameSourcePath)
            .then(meta => {
                if (!meta) return;
                const cfg = resolveConfig(
                    meta,
                    Iceball.frameCountX,
                    Iceball.frameCountY,
                    Iceball.animatedFps
                );
                const changed = (
                    cfg.frameCountX !== Iceball.frameCountX ||
                    cfg.frameCountY !== Iceball.frameCountY
                );
                Iceball.frameCountX = cfg.frameCountX;
                Iceball.frameCountY = cfg.frameCountY;
                Iceball.animatedFps = cfg.animatedFps;
                if (changed) Iceball.frames = null;
            })
            .catch(() => null)
            .finally(() => {
                Iceball._metadataLoaded = true;
                Iceball._metadataLoadPromise = null;
            });
    }

    static getFrames() {
        Iceball.ensureMagicMetadataLoaded();
        if (Array.isArray(Iceball.frames) && Iceball.frames.length > 0) {
            return Iceball.frames;
        }
        const preloadedResource = PIXI.Loader.shared.resources[Iceball.frameSourcePath];
        const baseTexture = (preloadedResource && preloadedResource.texture && preloadedResource.texture.baseTexture)
            ? preloadedResource.texture.baseTexture
            : PIXI.Texture.from(Iceball.frameSourcePath).baseTexture;
        if (!baseTexture || !baseTexture.valid) return null;

        const frames = [];
        const cols = Math.max(1, Math.floor(Iceball.frameCountX) || 1);
        const rows = Math.max(1, Math.floor(Iceball.frameCountY) || 1);
        const frameWidth = baseTexture.width / cols;
        const frameHeight = baseTexture.height / rows;

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                frames.push(
                    new PIXI.Texture(baseTexture, new PIXI.Rectangle(col * frameWidth, row * frameHeight, frameWidth, frameHeight))
                );
            }
        }

        Iceball.frames = frames;
        return Iceball.frames;
    }

    constructor(x, y) {
        super(x, y);
        this.image.src = Iceball.frameSourcePath;
        this.speed = 5;
        this.range = 10;
        this.apparentSize = 42;
        this.damage = 5;
        this.radius = 0.3;
        this.damageRadius = this.radius;
        this.snowParticles = [];
        this._trailParticleSpacing = 1 / Iceball.TRAIL_PARTICLES_PER_UNIT;
        this._trailDistanceAccumulator = 0;
        this.hideProjectileSprite = false;
        this._impactResolved = false;
        this._impactEffectElapsedMs = 0;
        this._impactEffectDurationMs = Iceball.IMPACT_EFFECT_DURATION_MS;
    }

    spawnSnowParticle(config = {}) {
        const particle = {
            x: Number.isFinite(config.x) ? Number(config.x) : this.x,
            y: Number.isFinite(config.y) ? Number(config.y) : this.y,
            z: Number.isFinite(config.z) ? Number(config.z) : (Number.isFinite(this.z) ? this.z : 0),
            vx: Number.isFinite(config.vx) ? Number(config.vx) : 0,
            vy: Number.isFinite(config.vy) ? Number(config.vy) : 0,
            vz: Number.isFinite(config.vz) ? Number(config.vz) : 0,
            lifeMs: Math.max(1, Number.isFinite(config.lifeMs) ? Number(config.lifeMs) : 450),
            ageMs: 0,
            size: Math.max(1, Number.isFinite(config.size) ? Number(config.size) : 3),
            color: Number.isFinite(config.color) ? Number(config.color) : 0xeaf7ff,
            alpha: Math.max(0, Math.min(1, Number.isFinite(config.alpha) ? Number(config.alpha) : 0.9)),
            shrink: Math.max(0, Number.isFinite(config.shrink) ? Number(config.shrink) : 0.3),
            gravity: Number.isFinite(config.gravity) ? Number(config.gravity) : Iceball.PARTICLE_GRAVITY,
            fadeDelayMs: Math.max(0, Number.isFinite(config.fadeDelayMs) ? Number(config.fadeDelayMs) : 0),
            airDrag: Math.max(0, Number.isFinite(config.airDrag) ? Number(config.airDrag) : 0),
            groundDrag: Math.max(0, Number.isFinite(config.groundDrag) ? Number(config.groundDrag) : 0),
            grounded: false
        };
        this.snowParticles.push(particle);
        return particle;
    }

    getCurrentTravelDirection() {
        if (Number.isFinite(this._lastHomingDirX) && Number.isFinite(this._lastHomingDirY)) {
            return { x: this._lastHomingDirX, y: this._lastHomingDirY };
        }
        if (Number.isFinite(this.baseDirX) && Number.isFinite(this.baseDirY)) {
            return { x: this.baseDirX, y: this.baseDirY };
        }
        return { x: 1, y: 0 };
    }

    emitTrailParticles(previousX, previousY, previousZ, currentX, currentY, currentZ) {
        const dx = currentX - previousX;
        const dy = currentY - previousY;
        const segmentDist = Math.hypot(dx, dy);
        if (!(segmentDist > 1e-6)) return;

        const spacing = Math.max(0.01, this._trailParticleSpacing || (1 / Iceball.TRAIL_PARTICLES_PER_UNIT));
        this._trailDistanceAccumulator += segmentDist;
        const dirX = dx / segmentDist;
        const dirY = dy / segmentDist;
        let distRemaining = this._trailDistanceAccumulator;

        while (distRemaining >= spacing) {
            const along = segmentDist - (distRemaining - spacing);
            const t = Math.max(0, Math.min(1, along / segmentDist));
            const baseX = previousX + dx * t;
            const baseY = previousY + dy * t;
            const baseZ = previousZ + (currentZ - previousZ) * t;
            const sideways = (Math.random() - 0.5) * 0.12;
            const swirlX = -dirY * sideways;
            const swirlY = dirX * sideways;
            this.spawnSnowParticle({
                x: baseX + swirlX,
                y: baseY + swirlY,
                z: Math.max(0, baseZ + (Math.random() - 0.5) * 0.12),
                vx: dirX * 0.35 + (Math.random() - 0.5) * 0.12,
                vy: dirY * 0.35 + (Math.random() - 0.5) * 0.12,
                vz: -0.05 - Math.random() * 0.2,
                lifeMs: Iceball.TRAIL_PARTICLE_LIFE_MS + Math.random() * 450,
                size: 2 + Math.random() * 2.4,
                alpha: 0.55 + Math.random() * 0.25,
                shrink: 0.35,
                gravity: 1.8 + Math.random() * 0.9,
                fadeDelayMs: Iceball.TRAIL_PARTICLE_FADE_DELAY_MS + Math.random() * 180,
                airDrag: 0.45 + Math.random() * 0.15,
                groundDrag: 4.8 + Math.random() * 1.8
            });
            distRemaining -= spacing;
        }

        this._trailDistanceAccumulator = Math.max(0, distRemaining);
    }

    emitImpactBurst(options = {}) {
        const countScale = Math.max(0, Number.isFinite(options.countScale) ? Number(options.countScale) : 1);
        const count = Math.max(1, Math.floor(Iceball.IMPACT_PARTICLE_COUNT * countScale));
        const baseZ = Math.max(0, Number.isFinite(this.z) ? this.z : 0.2);
        const travelDir = this.getCurrentTravelDirection();
        const inheritedSpeed = Math.max(0, Number.isFinite(options.inheritedSpeed) ? Number(options.inheritedSpeed) : (this.speed * 0.18));
        const inheritedVx = travelDir.x * inheritedSpeed;
        const inheritedVy = travelDir.y * inheritedSpeed;
        const spreadScale = Math.max(0, Number.isFinite(options.spreadScale) ? Number(options.spreadScale) : 1);
        const upwardBias = Number.isFinite(options.upwardBias) ? Number(options.upwardBias) : 0;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const planarSpeed = (0.35 + Math.random() * 1.2) * spreadScale;
            const upwardSpeed = 0.35 + Math.random() * 1.15 + upwardBias;
            this.spawnSnowParticle({
                x: this.x + (Math.random() - 0.5) * 0.18,
                y: this.y + (Math.random() - 0.5) * 0.18,
                z: baseZ * (0.4 + Math.random() * 0.4),
                vx: inheritedVx + Math.cos(angle) * planarSpeed,
                vy: inheritedVy + Math.sin(angle) * planarSpeed,
                vz: upwardSpeed,
                lifeMs: Iceball.IMPACT_PARTICLE_LIFE_MS + Math.random() * 500,
                size: 2.5 + Math.random() * 4,
                alpha: 0.65 + Math.random() * 0.3,
                shrink: 0.45,
                gravity: 3.2 + Math.random() * 1.4,
                fadeDelayMs: Iceball.IMPACT_PARTICLE_FADE_DELAY_MS + Math.random() * 240,
                airDrag: 0.3 + Math.random() * 0.15,
                groundDrag: 5.4 + Math.random() * 1.8
            });
        }
    }

    updateSnowParticles(deltaSec) {
        if (!Array.isArray(this.snowParticles) || this.snowParticles.length === 0) return;
        const deltaMs = Math.max(0, deltaSec * 1000);
        for (let i = this.snowParticles.length - 1; i >= 0; i--) {
            const particle = this.snowParticles[i];
            if (!particle) {
                this.snowParticles.splice(i, 1);
                continue;
            }
            particle.ageMs += deltaMs;
            if (particle.ageMs >= particle.lifeMs) {
                this.snowParticles.splice(i, 1);
                continue;
            }
            particle.x += (particle.vx || 0) * deltaSec;
            particle.y += (particle.vy || 0) * deltaSec;
            const nextZ = (particle.z || 0) + ((particle.vz || 0) * deltaSec);
            if (nextZ <= 0) {
                particle.z = 0;
                particle.vz = 0;
                particle.grounded = true;
            } else {
                particle.z = nextZ;
                particle.vz = (particle.vz || 0) - (particle.gravity || Iceball.PARTICLE_GRAVITY) * deltaSec;
            }
            const drag = particle.grounded ? (particle.groundDrag || 0) : (particle.airDrag || 0);
            if (drag > 0) {
                const damping = Math.max(0, 1 - (drag * deltaSec));
                particle.vx = (particle.vx || 0) * damping;
                particle.vy = (particle.vy || 0) * damping;
            }
        }
    }

    beginImpactEffect(options = {}) {
        if (this._impactResolved) return;
        this._impactResolved = true;
        this.hideProjectileSprite = true;
        this.explosionFrame = 0;
        this.emitImpactBurst(options);
    }

    maybeFinishAfterParticles() {
        if (this.snowParticles.length > 0) return;
        this.visible = false;
        this.detachPixiSprite();
        clearInterval(this.castInterval);
    }

    cast(targetX, targetY) {
        const iceballFrames = Iceball.getFrames();

        if (!globalThis.Spell.canAffordMagicCost(Iceball.MAGIC_COST, wizard)) {
            globalThis.Spell.indicateInsufficientMagic();
            message("Not enough magic to cast Freeze!");
            return this;
        }
        globalThis.Spell.spendMagicCost(Iceball.MAGIC_COST, wizard);
        this.explosionFrames = iceballFrames || [];
        
        this.targetX = targetX;
        this.targetY = targetY;
        this.traveledDist = 0;
        
        this.visible = true;
        this.x = wizard.x;
        this.y = wizard.y;
        this.z = Iceball.FLIGHT_Z;
        
        let xdist = targetX - this.x;
        let ydist = targetY - this.y;
        let aimDist = Math.hypot(xdist, ydist);
        if (aimDist < 1e-4) {
            xdist = (wizard && wizard.direction && Number.isFinite(wizard.direction.x)) ? wizard.direction.x : 1;
            ydist = (wizard && wizard.direction && Number.isFinite(wizard.direction.y)) ? wizard.direction.y : 0;
            aimDist = Math.max(1e-4, Math.hypot(xdist, ydist));
        }
        const dirX = xdist / aimDist;
        const dirY = ydist / aimDist;

        this.x += dirX * 0.5;
        this.y += dirY * 0.5;
        this.startX = this.x;
        this.startY = this.y;
        this.castWizardX = wizard.x;
        this.castWizardY = wizard.y;
        this.baseDirX = dirX;
        this.baseDirY = dirY;
        this.totalDist = Math.max(0.1, this.range);
        this.movement = { x: 0, y: 0, z: 0 };

        const initialForcedAim = this.getForcedTargetAimPoint();
        if (initialForcedAim) {
            const distToTarget = Math.hypot(initialForcedAim.x - this.x, initialForcedAim.y - this.y);
            if (distToTarget > 0.1) {
                this.totalDist = distToTarget * 1.08;
            }
        }

        const cycleDurationMs = Math.max(1, (this.totalDist / Math.max(this.speed, 0.001)) * 1000);
        this.travelStartTime = performance.now();
        this.travelPausedTime = 0;
        this._pausedAt = null;
        this._lastUpdateTime = this.travelStartTime;
        this.animationElapsedMs = 0;
        this._wallImpactStateActive = false;
        this._lastWizardTrackedX = wizard.x;
        this._lastWizardTrackedY = wizard.y;
        this.hideProjectileSprite = false;
        this._impactResolved = false;
        this._impactEffectElapsedMs = 0;
        this._trailDistanceAccumulator = 0;
        this.snowParticles.length = 0;

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

            if (this._impactResolved) {
                this._impactEffectElapsedMs += deltaMs;
                this.updateSnowParticles(deltaSec);
                if (this._impactEffectElapsedMs >= this._impactEffectDurationMs) {
                    this.maybeFinishAfterParticles();
                }
                return;
            }

            this.animationElapsedMs += deltaMs * this.getAnimationSpeedMultiplier();
            const animationProgress = this.animationElapsedMs / cycleDurationMs;
            const animationFinished = animationProgress >= 1;
            
            if (this.explosionFrames && this.explosionFrames.length > 0) {
                const maxFrameIndex = this.explosionFrames.length - 1;
                this.explosionFrame = animationFinished
                    ? maxFrameIndex
                    : (Math.floor(animationProgress * this.explosionFrames.length) % this.explosionFrames.length);
            }

                    const previousX = this.x;
                    const previousY = this.y;
                    const previousZ = this.z;
            
            const step = Math.max(0, Math.min(this.totalDist - this.traveledDist, this.speed * this.getMovementSpeedMultiplier() * deltaSec));
            const forcedAim = this.getForcedTargetAimPoint();
            if (forcedAim) {
                const dx = forcedAim.x - this.x;
                const dy = forcedAim.y - this.y;
                const aimDistToTarget = Math.hypot(dx, dy);
                if (aimDistToTarget > 1e-6 && step > 0) {
                    const ndx = dx / aimDistToTarget;
                    const ndy = dy / aimDistToTarget;
                    this.x += ndx * step;
                    this.y += ndy * step;
                    this._lastHomingDirX = ndx;
                    this._lastHomingDirY = ndy;
                }
                this.traveledDist += step;
            } else if (this._lastHomingDirX !== undefined) {
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
                const currentWizardX = Number.isFinite(wizard && wizard.x) ? wizard.x : this.castWizardX;
                const currentWizardY = Number.isFinite(wizard && wizard.y) ? wizard.y : this.castWizardY;
                if (Number.isFinite(this._lastWizardTrackedX) && Number.isFinite(this._lastWizardTrackedY)) {
                    this.x += currentWizardX - this._lastWizardTrackedX;
                    this.y += currentWizardY - this._lastWizardTrackedY;
                }
                this._lastWizardTrackedX = currentWizardX;
                this._lastWizardTrackedY = currentWizardY;
            }

            this.emitTrailParticles(previousX, previousY, previousZ, this.x, this.y, this.z);
            this.updateSnowParticles(deltaSec);
            
            this.land();

            if (this._impactResolved) {
                return;
            }
            
            if (animationFinished) {
                this.beginImpactEffect({
                    inheritedSpeed: this.speed * 0.34,
                    spreadScale: 0.75,
                    upwardBias: 0.15
                });
            }
        }, 1000 / frameRate);
        return this;
    }

    getAnimationSpeedMultiplier() {
        return this._wallImpactStateActive ? Iceball.WALL_IMPACT_ANIMATION_MULTIPLIER : 1;
    }

    canAffectTarget(obj) {
        if (!obj || obj.gone || obj.vanishing || obj.dead) return false;
        if (globalThis.Spell.isGroundLayerTarget(obj)) return false;
        return typeof obj.freeze === "function";
    }

    isCharacterImpactTarget(obj) {
        if (!obj || obj.gone || obj.vanishing) return false;
        if (obj === wizard || obj.type === "human") return true;
        if (Array.isArray(animals) && animals.includes(obj)) return true;
        if (typeof obj.moveDirection === "function" || typeof obj.move === "function") return true;
        return this.canAffectTarget(obj);
    }

    shouldExplodeOnImpact(obj, directTarget = null) {
        if (!obj || obj.gone || obj.vanishing) return false;
        if (globalThis.Spell.isGroundLayerTarget(obj)) return false;
        if (obj === directTarget) return true;
        if (obj.type === "wallSection" || obj.type === "wall" || obj.type === "tree") return true;
        if (typeof globalThis.doesObjectBlockPassage === "function" && globalThis.doesObjectBlockPassage(obj)) {
            return true;
        }
        if (obj === wizard || obj.type === "human") return true;
        if (Array.isArray(animals) && animals.includes(obj)) return true;
        if (typeof obj.moveDirection === "function" || typeof obj.move === "function") return true;
        return this.canAffectTarget(obj);
    }

    getTargetMaxMp(target) {
        const candidates = [target.maxMp, target.maxMP, target.mp];
        for (let i = 0; i < candidates.length; i++) {
            const value = Number(candidates[i]);
            if (Number.isFinite(value) && value > 0) return value;
        }
        return 0;
    }

    getTargetMaxHp(target) {
        const candidates = [target.maxHp, target.maxHP, target.hp];
        for (let i = 0; i < candidates.length; i++) {
            const value = Number(candidates[i]);
            if (Number.isFinite(value) && value > 0) return value;
        }
        return 0;
    }

    extinguishBurningTarget(target) {
        if (!target || target.isOnFire !== true) return false;
        if (typeof target.extinguish === "function") {
            return !!target.extinguish();
        }
        target.isOnFire = false;
        if (Number.isFinite(target.fireDuration)) {
            target.fireDuration = 0;
        }
        if (Number.isFinite(target.fireDamageScale)) {
            target.fireDamageScale = 1;
        }
        if (target.fireAnimationInterval) {
            clearInterval(target.fireAnimationInterval);
            target.fireAnimationInterval = null;
        }
        if (target.fireSprite) {
            target.fireSprite.visible = false;
        }
        return true;
    }

    hitTarget(target) {
        if (!this.canAffectTarget(target)) return false;

        const wasAlreadyFrozen = typeof target.isFrozen === "function" && target.isFrozen();
        const impactDamage = this.damage * (wasAlreadyFrozen ? 1.5 : 1);
        this.extinguishBurningTarget(target);
        const maxMp = this.getTargetMaxMp(target);
        const freezeSeconds = 1 + (maxMp > 0 ? (100 / maxMp) : 0);
        const rawCasterDifficulty = (this.caster && Number.isFinite(this.caster.difficulty))
            ? Number(this.caster.difficulty)
            : ((typeof globalThis !== "undefined" && globalThis.wizard && Number.isFinite(globalThis.wizard.difficulty))
                ? Number(globalThis.wizard.difficulty)
                : 2);
        const casterDifficulty = Math.max(1, Math.min(3, Math.round(rawCasterDifficulty || 2)));
        const difficultyTemperatureDrop = (4 - casterDifficulty) * 2;
        const mpTemperatureDrop = maxMp > 0 ? (200 / maxMp) : 0;
        const temperatureDrop = difficultyTemperatureDrop + mpTemperatureDrop;
        if (typeof target.dropTemperature === "function") {
            target.dropTemperature(temperatureDrop);
        } else if (typeof target.changeTemperature === "function") {
            target.changeTemperature(-temperatureDrop);
        } else if (typeof target.freeze === "function") {
            target.freeze(freezeSeconds);
        }
        target._freezeTintUntilMs = Date.now() + Math.max(1200, freezeSeconds * 350);
        target._freezeTintColor = Iceball.FREEZE_TINT;

        if (typeof target.takeDamage === "function") {
            target.takeDamage(impactDamage);
        } else if (Number.isFinite(target.hp)) {
            target.hp -= impactDamage;
        }

        if (
            Number.isFinite(target.hp) &&
            target.hp <= 0 &&
            !target.dead &&
            typeof target.shatterFrozenDeath === "function"
        ) {
            target.shatterFrozenDeath({ source: this.caster || null, projectile: this, cause: "iceball-shatter" });
            return true;
        }

        if (Number.isFinite(target.hp) && target.hp <= 0 && !target.dead && typeof target.die === "function") {
            target.die();
        }
        return true;
    }

    finishImpact(options = {}) {
        this.beginImpactEffect(options);
    }

    land() {
        const impactCircle = { type: "circle", x: this.x, y: this.y, radius: this.radius };
        const directTarget = (this.forcedTarget && !this.forcedTarget.gone && !this.forcedTarget.vanishing)
            ? this.forcedTarget
            : null;

        const doesImpactHitObject = (obj) => {
            if (!obj) return false;
            const hitboxes = (obj.type === "tree")
                ? [obj.groundPlaneHitbox, obj.hitbox]
                : [obj.visualHitbox, obj.groundPlaneHitbox, obj.hitbox];
            for (let i = 0; i < hitboxes.length; i++) {
                const hb = hitboxes[i];
                if (!hb || typeof hb.intersects !== "function") continue;
                if (hb.intersects(impactCircle)) return true;
            }
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
                    return distance(this.x, this.y, targetX, targetY) <= Math.max(this.radius + 0.35, 0.6);
                }
            }
            return false;
        };

        for (const obj of onscreenObjects) {
            if (!doesImpactHitObject(obj)) continue;
            if (!this.shouldExplodeOnImpact(obj, directTarget)) continue;

            if (this.canAffectTarget(obj)) {
                this.hitTarget(obj);
            }
            const characterImpact = this.isCharacterImpactTarget(obj);
            this.finishImpact(characterImpact ? {
                countScale: 1 / 3,
                spreadScale: 1 / 3
            } : {});
            return;
        }
    }
}

globalThis.Iceball = Iceball;
