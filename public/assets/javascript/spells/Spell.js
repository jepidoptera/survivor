class Spell {
    static supportsObjectTargeting = false;

    static flashMagicBar() {
        if (typeof $ !== "function") return;
        const $magicBar = $("#magicBar");
        if ($magicBar.length === 0) return;
        const $magicBarBackground = $magicBar.parent();
        const restartFlash = ($element, className, dataKey) => {
            if (!$element || $element.length === 0) return;
            const previousTimeout = $element.data(dataKey);
            if (previousTimeout) {
                clearTimeout(previousTimeout);
            }
            $element.removeClass(className);
            void $element[0].offsetWidth;
            $element.addClass(className);
            const timeoutId = setTimeout(() => {
                $element.removeClass(className);
                $element.removeData(dataKey);
            }, 240);
            $element.data(dataKey, timeoutId);
        };

        restartFlash($magicBarBackground, "magicBarBackgroundFlash", "magicBarBackgroundFlashTimeout");
        restartFlash($magicBar, "magicBarFlash", "magicBarFlashTimeout");
    }

    static ignoresMagicCosts(wizardRef = globalThis.wizard) {
        return !!(
            wizardRef &&
            typeof wizardRef.isGodMode === "function" &&
            wizardRef.isGodMode()
        );
    }

    static canAffordMagicCost(cost, wizardRef = globalThis.wizard) {
        const normalizedCost = Number.isFinite(cost) ? Math.max(0, Number(cost)) : 0;
        if (normalizedCost <= 0) return true;
        if (Spell.ignoresMagicCosts(wizardRef)) return true;
        const currentMagic = Number.isFinite(wizardRef?.magic) ? wizardRef.magic : 0;
        return currentMagic >= normalizedCost;
    }

    static spendMagicCost(cost, wizardRef = globalThis.wizard) {
        const normalizedCost = Number.isFinite(cost) ? Math.max(0, Number(cost)) : 0;
        if (normalizedCost <= 0) return true;
        if (!wizardRef) return false;
        if (Spell.ignoresMagicCosts(wizardRef)) return true;
        const currentMagic = Number.isFinite(wizardRef.magic) ? wizardRef.magic : 0;
        if (currentMagic < normalizedCost) return false;
        wizardRef.magic = Math.max(0, currentMagic - normalizedCost);
        return true;
    }

    static indicateInsufficientMagic() {
        Spell.flashMagicBar();
    }

    static isValidObjectTarget(_target, _wizardRef = null) {
        return false;
    }

    static isGroundLayerTarget(target) {
        if (!target || target.gone || target.vanishing) return false;
        if (target.type === "road") return true;
        if (target.type === "triggerArea" || target.isTriggerArea === true) return true;
        return target.rotationAxis === "ground";
    }

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
        const resolver = (typeof globalThis.getSpellTargetAimPoint === "function")
            ? globalThis.getSpellTargetAimPoint
            : null;
        if (resolver) {
            const aim = resolver((typeof wizard !== "undefined") ? wizard : null, target);
            if (aim && Number.isFinite(aim.x) && Number.isFinite(aim.y)) {
                return { x: Number(aim.x), y: Number(aim.y) };
            }
        }
        if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
        return { x: Number(target.x), y: Number(target.y) };
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


globalThis.Spell = Spell;
