class SpikeProjectile {
    static IMAGE_PATH = "/assets/images/magic/spike.png";
    static SPEED = 12;
    static DAMAGE = 5;
    static RADIUS = 0.12;
    static FLASH_PARTICLE_COUNT = 7;
    static FLASH_DURATION_MS = 180;
    static MAX_RANGE = 40;

    constructor(config = {}) {
        this.image = document.createElement("img");
        this.image.src = SpikeProjectile.IMAGE_PATH;
        this.texturePath = SpikeProjectile.IMAGE_PATH;
        this.type = "spike";
        this.visible = true;
        this.hideProjectileSprite = false;
        this.rotateSpriteToMovement = true;
        this.spriteRotationOffset = Math.PI * 0.5;
        this.speed = SpikeProjectile.SPEED;
        this.damage = SpikeProjectile.DAMAGE;
        this.radius = SpikeProjectile.RADIUS;
        this.apparentSize = 22;
        this.x = Number(config.x) || 0;
        this.y = Number(config.y) || 0;
        this.z = 0.2;
        this.dirX = Number(config.dirX) || 1;
        this.dirY = Number(config.dirY) || 0;
        this.source = config.source || null;
        this.map = config.map || null;
        this.ageMs = 0;
        this.maxLifetimeMs = (SpikeProjectile.MAX_RANGE / Math.max(0.001, this.speed)) * 1000;
        this.snowParticles = [];
        this._impactResolved = false;
        this._impactElapsedMs = 0;
        this._lastUpdateTime = 0;
        this._pausedAt = null;
        this.hitbox = new CircleHitbox(this.x, this.y, this.radius);
        this.groundPlaneHitbox = this.hitbox;
        this.visualHitbox = this.hitbox;
        this.movement = {
            x: this.dirX * this.speed / Math.max(1, frameRate),
            y: this.dirY * this.speed / Math.max(1, frameRate),
            z: 0
        };
    }

    cast() {
        this.visible = true;
        this._lastUpdateTime = performance.now();
        this.castInterval = setInterval(() => {
            if (paused) {
                if (!this._pausedAt) this._pausedAt = performance.now();
                return;
            }
            if (this._pausedAt) {
                this._lastUpdateTime += performance.now() - this._pausedAt;
                this._pausedAt = null;
            }

            const now = performance.now();
            const deltaMs = Math.max(0, now - (this._lastUpdateTime || now));
            this._lastUpdateTime = now;
            const deltaSec = deltaMs / 1000;

            if (this._impactResolved) {
                this._impactElapsedMs += deltaMs;
                this.updateFlashParticles(deltaSec);
                if (this._impactElapsedMs >= SpikeProjectile.FLASH_DURATION_MS && this.snowParticles.length === 0) {
                    this.finish();
                }
                return;
            }

            const step = this.speed * deltaSec;
            this.x += this.dirX * step;
            this.y += this.dirY * step;
            this.ageMs += deltaMs;
            this.updateHitboxes();

            const hit = this.findImpactTarget();
            if (hit) {
                this.resolveImpact(hit);
                return;
            }

            if (this.ageMs >= this.maxLifetimeMs) {
                this.finish();
            }
        }, 1000 / Math.max(1, frameRate));
        return this;
    }

    updateHitboxes() {
        if (!this.hitbox) return;
        this.hitbox.x = this.x;
        this.hitbox.y = this.y;
        this.hitbox.radius = this.radius;
    }

    updateFlashParticles(deltaSec) {
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
            particle.z = Math.max(0, (particle.z || 0) + ((particle.vz || 0) * deltaSec));
            particle.vx *= Math.max(0, 1 - (4.5 * deltaSec));
            particle.vy *= Math.max(0, 1 - (4.5 * deltaSec));
            particle.vz *= Math.max(0, 1 - (6.0 * deltaSec));
        }
    }

    getCandidateTargets() {
        const candidates = [];
        const pushUnique = (target) => {
            if (!target || target === this || candidates.includes(target)) return;
            candidates.push(target);
        };

        if (Array.isArray(animals)) {
            for (let i = 0; i < animals.length; i++) pushUnique(animals[i]);
        }
        if (this.map && Array.isArray(this.map.objects)) {
            for (let i = 0; i < this.map.objects.length; i++) pushUnique(this.map.objects[i]);
        }
        if (Array.isArray(onscreenObjects)) {
            for (let i = 0; i < onscreenObjects.length; i++) pushUnique(onscreenObjects[i]);
        } else if (onscreenObjects && typeof onscreenObjects.forEach === "function") {
            onscreenObjects.forEach(pushUnique);
        }
        return candidates;
    }

    isIgnoredTarget(target) {
        if (!target || target.gone || target.vanishing) return true;
        if (target === this.source) return true;
        if (this.isGroundLayerTarget(target)) return true;
        return false;
    }

    isGroundLayerTarget(target) {
        if (!target) return false;
        if (target.type === "road") return true;
        if (target.type === "triggerArea" || target.isTriggerArea === true) return true;
        return target.rotationAxis === "ground";
    }

    getTargetHitbox(target) {
        const isAnimalTarget = !!(
            target &&
            Array.isArray(animals) &&
            animals.includes(target)
        );
        if (isAnimalTarget) {
            return target.visualHitbox || target.groundPlaneHitbox || target.hitbox || null;
        }
        return target.groundPlaneHitbox || target.visualHitbox || target.hitbox || null;
    }

    canDamageTarget(target) {
        return !!(
            target &&
            !this.isGroundLayerTarget(target) &&
            !target.dead &&
            Number.isFinite(target.hp) &&
            target.hp > 0
        );
    }

    getTemperatureBonusDamage(target) {
        if (!target) return 0;
        const temperature = (typeof target.getTemperature === "function")
            ? Number(target.getTemperature())
            : Number(target.temperature);
        if (!Number.isFinite(temperature) || temperature >= 0) return 0;
        return Math.abs(temperature) * 0.2;
    }

    shouldDisappearOnImpact(target) {
        if (!target) return false;
        if (this.canDamageTarget(target)) return true;
        if (target.type === "wall" || target.type === "wallSection") return true;
        if (typeof globalThis.doesObjectBlockPassage === "function" && globalThis.doesObjectBlockPassage(target)) {
            return true;
        }
        return !!(
            target.blocksTile === true ||
            target.isPassable === false
        );
    }

    findImpactTarget() {
        const candidates = this.getCandidateTargets();
        for (let i = 0; i < candidates.length; i++) {
            const target = candidates[i];
            if (this.isIgnoredTarget(target)) continue;
            const targetHitbox = this.getTargetHitbox(target);
            if (!targetHitbox || typeof targetHitbox.intersects !== "function") continue;
            if (targetHitbox.intersects(this.hitbox)) {
                if (this.shouldDisappearOnImpact(target)) return target;
            }
        }
        return null;
    }

    applyDamage(target) {
        if (!this.canDamageTarget(target)) return;
        const totalDamage = this.damage + this.getTemperatureBonusDamage(target);
        if (typeof target.takeDamage === "function") {
            target.takeDamage(totalDamage, { source: this.source, isSpell: false });
        } else {
            target.hp = Math.max(0, Number(target.hp) - totalDamage);
        }
        if (
            Number.isFinite(target.hp) &&
            target.hp <= 0 &&
            !target.dead &&
            typeof target.shatterFrozenDeath === "function" &&
            typeof target.isFrozen === "function" &&
            target.isFrozen()
        ) {
            target.shatterFrozenDeath({ source: this.source, projectile: this });
            return;
        }
        if (Number.isFinite(target.hp) && target.hp <= 0 && !target.dead && typeof target.die === "function") {
            target.die();
        }
    }

    spawnImpactFlash() {
        this.snowParticles.length = 0;
        for (let i = 0; i < SpikeProjectile.FLASH_PARTICLE_COUNT; i++) {
            const angle = (Math.PI * 2 * i) / SpikeProjectile.FLASH_PARTICLE_COUNT;
            const speed = 1.2 + Math.random() * 1.4;
            this.snowParticles.push({
                x: this.x,
                y: this.y,
                z: 0.18 + Math.random() * 0.06,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                vz: 0,
                lifeMs: 90 + Math.random() * 90,
                ageMs: 0,
                size: 2.8 + Math.random() * 1.8,
                color: 0xfff1ad,
                alpha: 0.95,
                shrink: 0.85
            });
        }
    }

    resolveImpact(target) {
        this.applyDamage(target);
        this._impactResolved = true;
        this.hideProjectileSprite = true;
        this.spawnImpactFlash();
    }

    detachPixiSprite() {
        if (this.pixiSprite && this.pixiSprite.parent) {
            this.pixiSprite.parent.removeChild(this.pixiSprite);
        }
        this.pixiSprite = null;
        if (this.particleGraphics && this.particleGraphics.parent) {
            this.particleGraphics.parent.removeChild(this.particleGraphics);
        }
        this.particleGraphics = null;
    }

    finish() {
        this.visible = false;
        this.gone = true;
        clearInterval(this.castInterval);
        this.detachPixiSprite();
    }
}

class Spikes extends globalThis.Spell {
    static HOTKEY_DELAY_MS = 62.5;

    constructor(x, y) {
        super(x, y);
        this.image = document.createElement("img");
        this.image.src = SpikeProjectile.IMAGE_PATH;
        this.delayTime = (Spikes.HOTKEY_DELAY_MS * 2) / 1000;
        this.magicCost = 25;
    }

    cast(targetX, targetY) {
        if (!wizard || !wizard.map) return this;

        if (!globalThis.Spell.canAffordMagicCost(this.magicCost, wizard)) {
            globalThis.Spell.indicateInsufficientMagic();
            message("Not enough magic to cast Spikes!");
            return this;
        }
        globalThis.Spell.spendMagicCost(this.magicCost, wizard);

        let dx = targetX - wizard.x;
        let dy = targetY - wizard.y;
        if (wizard.map && typeof wizard.map.shortestDeltaX === "function") {
            dx = wizard.map.shortestDeltaX(wizard.x, targetX);
        }
        if (wizard.map && typeof wizard.map.shortestDeltaY === "function") {
            dy = wizard.map.shortestDeltaY(wizard.y, targetY);
        }

        let dist = Math.hypot(dx, dy);
        if (dist < 1e-6) {
            dx = Number(wizard.direction && wizard.direction.x) || 1;
            dy = Number(wizard.direction && wizard.direction.y) || 0;
            dist = Math.max(1e-6, Math.hypot(dx, dy));
        }

        const dirX = dx / dist;
        const dirY = dy / dist;
        const perpX = -dirY;
        const perpY = dirX;
        const offsets = [0, 0.1, -0.1, 0.2, -0.2];
        const castOriginX = wizard.x;
        const castOriginY = wizard.y;
        const mapRef = wizard.map || null;

        offsets.forEach((offset, index) => {
            setTimeout(() => {
                if (!wizard || wizard.gone) return;
                let spawnX = castOriginX + (perpX * offset);
                let spawnY = castOriginY + (perpY * offset);
                if (mapRef && typeof mapRef.wrapWorldX === "function") spawnX = mapRef.wrapWorldX(spawnX);
                if (mapRef && typeof mapRef.wrapWorldY === "function") spawnY = mapRef.wrapWorldY(spawnY);
                const projectile = new SpikeProjectile({
                    x: spawnX,
                    y: spawnY,
                    dirX,
                    dirY,
                    source: wizard,
                    map: mapRef
                });
                projectiles.push(projectile.cast());
            }, Math.round(index * Spikes.HOTKEY_DELAY_MS));
        });

        this.visible = false;
        this.gone = true;
        return this;
    }
}

globalThis.SpikeProjectile = SpikeProjectile;
globalThis.Spikes = Spikes;
