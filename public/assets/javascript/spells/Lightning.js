const LIGHTNING_SPELL_IMAGE_PATH = "/assets/images/magic/lightning.png";

class LightningBoltProjectile {
    static IMAGE_PATH = LIGHTNING_SPELL_IMAGE_PATH;
    static SPEED = 37;
    static DAMAGE = 50;
    static RADIUS = 0.22;
    static MAX_RANGE = 120;
    static START_OFFSET = 0.45;

    constructor(config = {}) {
        this.image = document.createElement("img");
        this.image.src = LightningBoltProjectile.IMAGE_PATH;
        this.texturePath = LightningBoltProjectile.IMAGE_PATH;
        this.type = "lightning";
        this.visible = true;
        this.gone = false;
        this.hideProjectileSprite = false;
        this.rotateSpriteToMovement = true;
        this.spriteRotationOffset = Math.PI * 0.5;
        this.speed = LightningBoltProjectile.SPEED;
        this.radius = LightningBoltProjectile.RADIUS;
        this.apparentSize = 52;
        this.x = Number(config.x) || 0;
        this.y = Number(config.y) || 0;
        this.z = 0.55;
        this.dirX = Number(config.dirX) || 1;
        this.dirY = Number(config.dirY) || 0;
        this.source = config.source || null;
        this.map = config.map || null;
        this.forcedTarget = config.forcedTarget || null;
        this.ageMs = 0;
        this.maxLifetimeMs = (LightningBoltProjectile.MAX_RANGE / Math.max(0.001, this.speed)) * 1000;
        this.hitbox = new CircleHitbox(this.x, this.y, this.radius);
        this.groundPlaneHitbox = this.hitbox;
        this.visualHitbox = this.hitbox;
        this.movement = {
            x: this.dirX * this.speed / Math.max(1, frameRate),
            y: this.dirY * this.speed / Math.max(1, frameRate),
            z: 0
        };
        this._pausedAt = null;
        this._lastUpdateTime = 0;
    }

    static isValidTarget(target) {
        if (!target || target.gone || target.vanishing || target.dead) return false;
        if (target.type === "powerup" || target.type === "triggerArea" || target.isTriggerArea === true) return false;
        if (target.type === "wall" || target.type === "wallSection" || target.type === "roof") return false;
        if (globalThis.Spell && typeof globalThis.Spell.isGroundLayerTarget === "function" && globalThis.Spell.isGroundLayerTarget(target)) {
            return false;
        }
        return !!(
            target.type === "human" ||
            typeof target.takeDamage === "function" ||
            typeof target.move === "function" ||
            typeof target.moveDirection === "function" ||
            Number.isFinite(target.hp)
        );
    }

    static applyHpDamage(target, damage) {
        const amount = Math.max(0, Number(damage) || 0);
        if (!(amount > 0) || !target) return 0;
        if (target.type === "human") {
            const prevHp = Number.isFinite(target.hp) ? Number(target.hp) : 0;
            target.hp = Math.max(0, prevHp - amount);
            if (typeof target.updateStatusBars === "function") {
                target.updateStatusBars();
            }
            return Math.max(0, prevHp - target.hp);
        }
        const prevHp = Number.isFinite(target.hp) ? Number(target.hp) : 0;
        if (typeof target.takeDamage === "function") {
            target.takeDamage(amount, { source: null, healthBarDurationMs: 900 });
        } else {
            target.hp = Math.max(0, prevHp - amount);
        }
        return Math.max(0, prevHp - (Number.isFinite(target.hp) ? Number(target.hp) : 0));
    }

    static applyMpDamage(target, damage) {
        const amount = Math.max(0, Number(damage) || 0);
        if (!(amount > 0) || !target) return 0;
        if (Number.isFinite(target.magic)) {
            const prevMagic = Number(target.magic);
            target.magic = Math.max(0, prevMagic - amount);
            if (typeof target.updateStatusBars === "function") {
                target.updateStatusBars();
            }
            return Math.max(0, prevMagic - target.magic);
        }
        if (typeof target.ensureMagicPointsInitialized === "function") {
            target.ensureMagicPointsInitialized();
        }
        if (!Number.isFinite(target.mp)) return 0;
        const prevMp = Number(target.mp);
        target.mp = Math.max(0, prevMp - amount);
        if (typeof target.showHealthBar === "function") {
            target.showHealthBar(900);
        }
        if (target.mp <= 0 && typeof target.vanishFromMagicDepletion === "function") {
            target.vanishFromMagicDepletion();
        }
        return Math.max(0, prevMp - target.mp);
    }

    updateHitbox() {
        if (!this.hitbox) return;
        this.hitbox.x = this.x;
        this.hitbox.y = this.y;
        this.hitbox.radius = this.radius;
    }

    getTargetHitbox(target) {
        if (!target) return null;
        return target.visualHitbox || target.groundPlaneHitbox || target.hitbox || null;
    }

    getPotentialTargets() {
        const candidates = [];
        const pushUnique = (target) => {
            if (!target || candidates.includes(target)) return;
            if (!LightningBoltProjectile.isValidTarget(target)) return;
            candidates.push(target);
        };

        if (this.map && typeof this.map.getGameObjects === "function") {
            const mapObjects = this.map.getGameObjects({ refresh: true }) || [];
            for (let i = 0; i < mapObjects.length; i++) pushUnique(mapObjects[i]);
        }
        if (this.map && Array.isArray(this.map.objects)) {
            for (let i = 0; i < this.map.objects.length; i++) pushUnique(this.map.objects[i]);
        }
        if (Array.isArray(globalThis.animals)) {
            for (let i = 0; i < globalThis.animals.length; i++) pushUnique(globalThis.animals[i]);
        }
        if (typeof globalThis.wizard !== "undefined" && globalThis.wizard) {
            pushUnique(globalThis.wizard);
        }
        if (Array.isArray(globalThis.onscreenObjects)) {
            for (let i = 0; i < globalThis.onscreenObjects.length; i++) pushUnique(globalThis.onscreenObjects[i]);
        } else if (globalThis.onscreenObjects && typeof globalThis.onscreenObjects.forEach === "function") {
            globalThis.onscreenObjects.forEach(pushUnique);
        }

        return candidates;
    }

    intersectsTarget(target) {
        if (!target || target === this.source) return false;
        const targetHitbox = this.getTargetHitbox(target);
        if (!targetHitbox || !this.hitbox) return false;
        if (typeof this.hitbox.intersects === "function" && this.hitbox.intersects(targetHitbox)) return true;
        if (typeof targetHitbox.intersects === "function" && targetHitbox.intersects(this.hitbox)) return true;
        const dx = (Number(target.x) || 0) - this.x;
        const dy = (Number(target.y) || 0) - this.y;
        const targetRadius = Number.isFinite(targetHitbox.radius)
            ? Number(targetHitbox.radius)
            : (Number.isFinite(target.groundRadius) ? Number(target.groundRadius) : 0.35);
        return Math.hypot(dx, dy) <= (this.radius + Math.max(0.05, targetRadius));
    }

    getForcedTargetAimPoint() {
        if (!this.forcedTarget || !LightningBoltProjectile.isValidTarget(this.forcedTarget)) return null;
        if (typeof globalThis.getSpellTargetAimPoint === "function") {
            const aim = globalThis.getSpellTargetAimPoint(globalThis.wizard || null, this.forcedTarget);
            if (aim && Number.isFinite(aim.x) && Number.isFinite(aim.y)) {
                return { x: Number(aim.x), y: Number(aim.y) };
            }
        }
        if (Number.isFinite(this.forcedTarget.x) && Number.isFinite(this.forcedTarget.y)) {
            return { x: Number(this.forcedTarget.x), y: Number(this.forcedTarget.y) };
        }
        return null;
    }

    findImpactTarget() {
        if (this.forcedTarget && this.intersectsTarget(this.forcedTarget)) {
            return this.forcedTarget;
        }
        const targets = this.getPotentialTargets();
        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            if (target === this.source) continue;
            if (this.intersectsTarget(target)) return target;
        }
        return null;
    }

    resolveImpact(target) {
        if (!target) {
            this.finish();
            return;
        }

        LightningBoltProjectile.applyHpDamage(target, LightningBoltProjectile.DAMAGE);
        LightningBoltProjectile.applyMpDamage(target, LightningBoltProjectile.DAMAGE);

        if (
            target.type !== "human" &&
            Number.isFinite(target.hp) &&
            target.hp <= 0 &&
            !target.dead &&
            typeof target.die === "function"
        ) {
            target.die();
        }

        this.finish();
    }

    detachPixiSprite() {
        if (this.pixiSprite && this.pixiSprite.parent) {
            this.pixiSprite.parent.removeChild(this.pixiSprite);
        }
        this.pixiSprite = null;
    }

    finish() {
        this.visible = false;
        this.gone = true;
        if (this.castInterval) {
            clearInterval(this.castInterval);
            this.castInterval = null;
        }
        this.detachPixiSprite();
    }

    cast() {
        this.visible = true;
        this.gone = false;
        this._lastUpdateTime = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
            ? performance.now()
            : Date.now();

        this.castInterval = setInterval(() => {
            if (paused) {
                if (!this._pausedAt) {
                    this._pausedAt = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                        ? performance.now()
                        : Date.now();
                }
                return;
            }
            const now = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                ? performance.now()
                : Date.now();
            if (this._pausedAt) {
                this._lastUpdateTime += now - this._pausedAt;
                this._pausedAt = null;
            }

            const deltaMs = Math.max(0, now - (this._lastUpdateTime || now));
            this._lastUpdateTime = now;
            const deltaSec = deltaMs / 1000;
            if (!(deltaSec > 0)) return;

            const forcedAim = this.getForcedTargetAimPoint();
            if (forcedAim) {
                let dx = forcedAim.x - this.x;
                let dy = forcedAim.y - this.y;
                const dist = Math.hypot(dx, dy);
                if (dist > 1e-6) {
                    dx /= dist;
                    dy /= dist;
                    this.dirX = dx;
                    this.dirY = dy;
                }
            }

            const step = this.speed * deltaSec;
            this.x += this.dirX * step;
            this.y += this.dirY * step;
            this.ageMs += deltaMs;
            this.movement.x = this.dirX * this.speed / Math.max(1, frameRate);
            this.movement.y = this.dirY * this.speed / Math.max(1, frameRate);
            this.updateHitbox();

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
}

class Lightning extends globalThis.Spell {
    static supportsObjectTargeting = true;

    static isValidObjectTarget(target, _wizardRef = null) {
        return LightningBoltProjectile.isValidTarget(target);
    }

    constructor(x, y) {
        super(x, y);
        this.image = document.createElement("img");
        this.image.src = LIGHTNING_SPELL_IMAGE_PATH;
        this.texturePath = LIGHTNING_SPELL_IMAGE_PATH;
        this.delayTime = 0.05;
        this.visible = false;
        this.gone = false;
    }

    cast(targetX, targetY) {
        const caster = globalThis.wizard || null;
        if (!caster || !caster.map) {
            this.visible = false;
            this.gone = true;
            return this;
        }

        let dx = targetX - caster.x;
        let dy = targetY - caster.y;
        if (caster.map && typeof caster.map.shortestDeltaX === "function") {
            dx = caster.map.shortestDeltaX(caster.x, targetX);
        }
        if (caster.map && typeof caster.map.shortestDeltaY === "function") {
            dy = caster.map.shortestDeltaY(caster.y, targetY);
        }

        let dist = Math.hypot(dx, dy);
        if (dist < 1e-6) {
            dx = Number(caster.direction && caster.direction.x) || 1;
            dy = Number(caster.direction && caster.direction.y) || 0;
            dist = Math.max(1e-6, Math.hypot(dx, dy));
        }

        const dirX = dx / dist;
        const dirY = dy / dist;
        let spawnX = caster.x + dirX * LightningBoltProjectile.START_OFFSET;
        let spawnY = caster.y + dirY * LightningBoltProjectile.START_OFFSET;
        if (caster.map && typeof caster.map.wrapWorldX === "function") spawnX = caster.map.wrapWorldX(spawnX);
        if (caster.map && typeof caster.map.wrapWorldY === "function") spawnY = caster.map.wrapWorldY(spawnY);

        const bolt = new LightningBoltProjectile({
            x: spawnX,
            y: spawnY,
            dirX,
            dirY,
            source: caster,
            map: caster.map,
            forcedTarget: this.forcedTarget || null
        });

        if (Array.isArray(globalThis.projectiles)) {
            globalThis.projectiles.push(bolt.cast());
        } else if (typeof projectiles !== "undefined" && Array.isArray(projectiles)) {
            projectiles.push(bolt.cast());
        }

        this.visible = false;
        this.gone = true;
        return this;
    }
}

globalThis.LightningBoltProjectile = LightningBoltProjectile;
globalThis.Lightning = Lightning;
