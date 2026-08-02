class ConstructionTrap extends globalThis.Spell {
    static ICON_PATH = "/assets/images/thumbnails/trap.svg";
    static GOLD_COST = 1;
    static TRIGGER_RADIUS = 0.34;

    constructor() {
        super();
        this.type = "constructionTrap";
        this.texturePath = ConstructionTrap.ICON_PATH;
        this.image.src = ConstructionTrap.ICON_PATH;
        this.apparentSize = 42;
        this.radius = ConstructionTrap.TRIGGER_RADIUS;
        this.damageRadius = this.radius;
        this.speed = 0;
        this.visible = false;
        this.armed = false;
        this.level = 1;
        this.delayTime = 2;
        this._buildTimer = null;
        this._triggerTimer = null;
    }

    cast(targetX, targetY) {
        const wizardRef = globalThis.wizard;
        if (!wizardRef) throw new Error("trap construction requires a wizard");
        if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
            throw new Error("trap construction requires a finite cursor location");
        }
        const inventory = typeof wizardRef.getInventory === "function"
            ? wizardRef.getInventory()
            : wizardRef.inventory;
        if (!inventory || typeof inventory.remove !== "function") {
            throw new Error("trap construction requires the wizard inventory");
        }
        if (!inventory.remove("gold", ConstructionTrap.GOLD_COST)) {
            if (typeof message === "function") message("A trap costs 1 coin.");
            this.visible = false;
            this.gone = true;
            return this;
        }

        const constructionLevel = globalThis.SpellSystem.getWizardSpellLevel(wizardRef, "construction");
        if (constructionLevel < 1) {
            inventory.add("gold", ConstructionTrap.GOLD_COST);
            throw new Error("trap construction requires construction level 1");
        }
        this.level = constructionLevel;
        this.buildSeconds = constructionLevel >= 2 ? 1.6 : 2;
        this.delayTime = this.buildSeconds;
        this.x = Number(targetX);
        this.y = Number(targetY);
        this.z = 0;
        this.visualBaseZ = globalThis.Spell.getTargetWorldBaseZ(wizardRef);
        this._buildTimer = setTimeout(() => this.arm(), this.buildSeconds * 1000);
        return this;
    }

    arm() {
        if (this.gone) return false;
        this._buildTimer = null;
        this.armed = true;
        this.visible = true;
        this._triggerTimer = setInterval(() => this.checkTriggers(), 50);
        return true;
    }

    isEnemy(character) {
        if (!character || character === globalThis.wizard || character.dead || character.gone) return false;
        if (character.owner === globalThis.wizard || character.summoner === globalThis.wizard || character.isPlayerAlly === true) return false;
        return true;
    }

    touchesEnemy() {
        const enemies = Array.isArray(globalThis.animals) ? globalThis.animals : [];
        const trapCircle = { type: "circle", x: this.x, y: this.y, radius: this.radius };
        return enemies.some(enemy => {
            if (!this.isEnemy(enemy)) return false;
            for (const hitbox of [enemy.touchBox, enemy.shadowBox, enemy.hitbox]) {
                if (hitbox && typeof hitbox.intersects === "function" && hitbox.intersects(trapCircle)) return true;
            }
            return Number.isFinite(enemy.x) && Number.isFinite(enemy.y) &&
                Math.hypot(enemy.x - this.x, enemy.y - this.y) <= this.radius + Math.max(0, Number(enemy.radius) || 0);
        });
    }

    touchesFireballExplosion() {
        const list = Array.isArray(globalThis.projectiles) ? globalThis.projectiles : [];
        return list.some(projectile => {
            const isFireball = projectile && (
                projectile.isFireballExplosion === true ||
                (typeof globalThis.Fireball === "function" && projectile instanceof globalThis.Fireball)
            );
            return isFireball && projectile !== this && projectile.visible !== false && !projectile.gone &&
                Number.isFinite(projectile.explosionRadius) &&
                Math.hypot(projectile.x - this.x, projectile.y - this.y) <= projectile.explosionRadius;
        });
    }

    checkTriggers() {
        if (!this.armed || this.gone) return false;
        if (!this.touchesEnemy() && !this.touchesFireballExplosion()) return false;
        return this.detonate();
    }

    detonate() {
        if (this.gone) return false;
        this.gone = true;
        this.armed = false;
        this.visible = false;
        if (this._triggerTimer) clearInterval(this._triggerTimer);
        this._triggerTimer = null;
        this.detachPixiSprite();
        if (typeof globalThis.Fireball.createStationaryExplosion !== "function") {
            throw new Error("trap detonation requires stationary fireball explosions");
        }
        const explosion = globalThis.Fireball.createStationaryExplosion(this.x, this.y, this.level, this.visualBaseZ);
        if (!Array.isArray(globalThis.projectiles)) throw new Error("trap detonation requires the projectile collection");
        globalThis.projectiles.push(explosion);
        return true;
    }
}

globalThis.ConstructionTrap = ConstructionTrap;
