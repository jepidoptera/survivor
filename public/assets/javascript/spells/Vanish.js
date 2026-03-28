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


class Vanish extends globalThis.Spell {
    static supportsObjectTargeting = true;

    static isValidObjectTarget(target, _wizardRef = null) {
        if (!target || target.gone || target.vanishing) return false;
        if (
            globalThis.Spell.isGroundLayerTarget(target) &&
            this.allowGroundLayerDirectTargeting !== true
        ) {
            return false;
        }
        if (target.type === "roof") return !!target.placed;
        return true;
    }

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
        this.magicCost = 10;
        this.radius = this.effectRadius;
    }
    
    cast(targetX, targetY) {
        // Check magic
        if (!globalThis.Spell.canAffordMagicCost(this.magicCost, wizard)) {
            globalThis.Spell.indicateInsufficientMagic();
            message("Not enough magic to cast Vanish!");
            return this;
        }
        globalThis.Spell.spendMagicCost(this.magicCost, wizard);
        
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
            if (globalThis.Spell.isGroundLayerTarget(obj)) continue;
            if (!obj.visualHitbox) continue;
            let hit = obj.visualHitbox.intersects({type: "circle", x: this.x, y: this.y, radius: this.radius});
            if (hit && !obj.vanishing) {
                this.vanishTarget(obj, { x: this.x, y: this.y });
                this.deactivate();
            }
        }
    }

    beginTargetVanish(target, impactPoint = null) {
        if (!target || target.gone || target.vanishing) return false;
        if (typeof target.triggerVanishDieEventIfAdventureMode === "function") {
            target.triggerVanishDieEventIfAdventureMode({ cause: "vanish" });
        }
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
        return true;
    }
    
    vanishTarget(target, impactPoint = null) {
        const isAnimalTarget = Array.isArray(animals) && animals.includes(target);
        if (isAnimalTarget) {
            if (target.dead) {
                this.beginTargetVanish(target, impactPoint);
                if (typeof message === "function") {
                    message(`${target.type} vanishes!`);
                }
                return;
            }
            const vanishDamage = 17;
            if (typeof target.takeDamage === "function") {
                target.takeDamage(vanishDamage, { isSpell: true });
            }
            if (target.gone || target.vanishing) {
                if (typeof message === "function") {
                    message(`${target.type} vanishes!`);
                }
            } else if (target.fleeRadius > 0) {
                target.flee();
            } else if (target.chaseRadius > 0) {
                target.attack(wizard);
            }
            return;
        }
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

        this.beginTargetVanish(target, impactPoint);
    }
}

class EditorVanish extends Vanish {
    static allowGroundLayerDirectTargeting = true;

    constructor(x, y) {
        super(x, y);
        this.magicCost = 0;
    }

    cast(targetX, targetY) {
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
                this.land();
            }

            if (this.traveledDist >= this.totalDist) {
                if (this.forcedTarget) {
                    const obj = this.forcedTarget;
                    if (obj && !obj.gone && !obj.vanishing) {
                        this.vanishTarget(obj, { x: this.x, y: this.y });
                    }
                }
                this.deactivate();
                return;
            }
        }, 1000 / frameRate);
        return this;
    }

    vanishTarget(target, impactPoint = null) {
        if (!target || target.gone || target.vanishing) return;
        if (target.type === "wallSection" && target._vanishAsWholeSection) {
            target._disableChunkSplitOnVanish = true;
        }
        target.vanishing = true;
        target.vanishStartTime = frameCount;
        target.vanishDuration = 0;
        target.percentVanished = 1;
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
            target._vanishFinalizeTimeout = null;
        }
        if (typeof target.removeFromGame === "function") {
            target.removeFromGame();
        } else if (typeof target.remove === "function") {
            target.remove();
        } else if (typeof target.delete === "function") {
            target.delete();
        } else {
            target.gone = true;
        }
        target._vanishWorldPoint = null;
        target.vanishing = false;
        target._vanishAsWholeSection = false;
    }
}


globalThis.Vanish = Vanish;
globalThis.EditorVanish = EditorVanish;
