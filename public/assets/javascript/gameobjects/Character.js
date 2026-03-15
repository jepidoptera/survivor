class Character {
    constructor(type, location, size, map) {
        this.type = type;
        this.map = map;
        this.size = Number.isFinite(size) ? size : 1;
        this.z = 0;
        this.travelFrames = 0;
        this.moving = false;
        this.useExternalScheduler = false;
        this.isOnFire = false;
        this.fireSprite = null;
        this.fireFrameIndex = 1;
        this.fireDamageScale = 1;
        this.healRate = 0.005; // Fraction of max HP restored per second
        this.healRateMultiplier = 1;
        this.groundRadius = this.size / 3; // Default hitbox radius in hex units
        this.visualRadius = this.size / 2; // Default visual hitbox radius in hex units
        this.frameRate = 1;
        this.moveTimeout = this.nextMove();
        this.attackTimeout = null;
        this._scriptFrozenUntilMs = 0;

        // Try to get node - if coords look like array indices (integers in map range), use them directly
        let node;
        if (Number.isInteger(location.x) && Number.isInteger(location.y) && location.x >= 0 && location.x < map.width && location.y >= 0 && location.y < map.height) {
            // Treat as array indices
            node = map.nodes[location.x][location.y];
        } else {
            // Treat as world coordinates
            node = map.worldToNode(location.x, location.y);
        }
        
        this.node = node;
        this.x = this.node.x;
        this.y = this.node.y;
        this.prevX = this.x;
        this.prevY = this.y;
        this.prevZ = this.z;
        this.destination = null;
        this.path = []; // Array of MapNodes to follow
        this.nextNode = null;
        this.useAStarPathfinding = false;

        // Pathfinding clearance — how many hex-ring steps around each tile
        // on the path must be obstacle-free for this character to fit.
        // Computed dynamically via getter from current this.size.
        
        // Create hitboxes
        this.visualHitbox = new CircleHitbox(this.x, this.y, this.visualRadius);
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, this.groundRadius);
    }

    get onfire() {
        return !!this.isOnFire;
    }

    set onfire(value) {
        this.isOnFire = !!value;
        if (this.isOnFire && !Number.isFinite(this.fireDuration)) {
            this.fireDuration = Number.POSITIVE_INFINITY;
        }
        if (!this.isOnFire) {
            this.fireDamageScale = 1;
            if (this.fireAnimationInterval) {
                clearInterval(this.fireAnimationInterval);
                this.fireAnimationInterval = null;
            }
            if (this.fireSprite && this.fireSprite.parent) {
                this.fireSprite.parent.removeChild(this.fireSprite);
            }
            if (this.fireSprite && typeof this.fireSprite.destroy === "function") {
                this.fireSprite.destroy({ children: true, texture: false, baseTexture: false });
            }
            this.fireSprite = null;
        }
    }

    /**
     * Pathfinding clearance — always derived from current size so it
     * stays correct after save-load rescaling or runtime resizing.
     * Size ≤1 → 0,  1.1–2.0 → 1,  2.1–4.0 → 2,  4.1–6.0 → 3, etc.
     */
    get pathfindingClearance() {
        return Math.max(0, Math.ceil(this.size / 2) - 1);
    }
    
    updateHitboxes() {
        // Update hitbox positions to match character position
        if (this.visualHitbox) {
            this.visualHitbox.x = this.x;
            this.visualHitbox.y = this.y;
            if (Number.isFinite(this.visualRadius)) {
                this.visualHitbox.radius = this.visualRadius;
            }
        }
        if (this.groundPlaneHitbox) {
            this.groundPlaneHitbox.x = this.x;
            this.groundPlaneHitbox.y = this.y;
            if (Number.isFinite(this.groundRadius)) {
                this.groundPlaneHitbox.radius = this.groundRadius;
            }
        }
    }
    
    nextMove() {
        return setTimeout(() => {this.move()}, 1000 / this.frameRate);
    }
    freeze(seconds = null) {
        clearTimeout(this.moveTimeout);
        this.moveTimeout = null;
        this.moving = false;
        this.destination = null;
        this.path = [];
        this.nextNode = null;
        this.travelFrames = 0;
        this.travelX = 0;
        this.travelY = 0;
        if (typeof this.resetAttackState === "function") {
            this.resetAttackState();
        }
        this.attackTarget = null;
        this.attacking = false;
        this.spriteDirectionLock = null;
        if (typeof this.updateHitboxes === "function") {
            this.updateHitboxes();
        }

        const durationSec = Number(seconds);
        if (!Number.isFinite(durationSec)) return;
        if (durationSec <= 0) {
            this._scriptFrozenUntilMs = 0;
            return;
        }
        const nowMs = Date.now();
        const existingUntilMs = Number(this._scriptFrozenUntilMs);
        const nextUntilMs = nowMs + (durationSec * 1000);
        this._scriptFrozenUntilMs = Number.isFinite(existingUntilMs)
            ? Math.max(existingUntilMs, nextUntilMs)
            : nextUntilMs;
    }
    isScriptFrozen(nowMs = null) {
        const frozenUntilMs = Number(this._scriptFrozenUntilMs);
        if (!Number.isFinite(frozenUntilMs) || frozenUntilMs <= 0) return false;
        const now = Number.isFinite(nowMs) ? Number(nowMs) : Date.now();
        if (now < frozenUntilMs) return true;
        this._scriptFrozenUntilMs = 0;
        return false;
    }
    removeFromGame() {
        this.gone = true;
        this.destination = null;
        this.path = [];
        this.nextNode = null;
        this._scriptFrozenUntilMs = 0;
        this.freeze();

        if (this.attackTimeout) {
            clearTimeout(this.attackTimeout);
            this.attackTimeout = null;
        }
        if (this.dieAnimation) {
            clearInterval(this.dieAnimation);
            this.dieAnimation = null;
        }
        if (this.fireAnimationInterval) {
            clearInterval(this.fireAnimationInterval);
            this.fireAnimationInterval = null;
        }

        if (this.pixiSprite && this.pixiSprite.parent) {
            this.pixiSprite.parent.removeChild(this.pixiSprite);
        }
        if (this.pixiSprite && typeof this.pixiSprite.destroy === "function") {
            this.pixiSprite.destroy({ children: true, texture: false, baseTexture: false });
        }
        this.pixiSprite = null;
        if (this._depthBillboardMesh && this._depthBillboardMesh.parent) {
            this._depthBillboardMesh.parent.removeChild(this._depthBillboardMesh);
        }
        if (this._depthBillboardMesh && typeof this._depthBillboardMesh.destroy === "function") {
            this._depthBillboardMesh.destroy({ children: false, texture: false, baseTexture: false });
        }
        this._depthBillboardMesh = null;
        if (this.fireSprite && this.fireSprite.parent) {
            this.fireSprite.parent.removeChild(this.fireSprite);
        }
        if (this.fireSprite && typeof this.fireSprite.destroy === "function") {
            this.fireSprite.destroy({ children: true, texture: false, baseTexture: false });
        }
        this.fireSprite = null;
        if (this.hatGraphics && this.hatGraphics.parent) {
            this.hatGraphics.parent.removeChild(this.hatGraphics);
        }
        if (this.hatGraphics && typeof this.hatGraphics.destroy === "function") {
            this.hatGraphics.destroy();
        }
        this.hatGraphics = null;
        if (this.shadowGraphics && this.shadowGraphics.parent) {
            this.shadowGraphics.parent.removeChild(this.shadowGraphics);
        }
        if (this.shadowGraphics && typeof this.shadowGraphics.destroy === "function") {
            this.shadowGraphics.destroy();
        }
        this.shadowGraphics = null;
        if (this._healthBarGraphics && this._healthBarGraphics.parent) {
            this._healthBarGraphics.parent.removeChild(this._healthBarGraphics);
        }
        if (this._healthBarGraphics && typeof this._healthBarGraphics.destroy === "function") {
            this._healthBarGraphics.destroy();
        }
        this._healthBarGraphics = null;
        if (Array.isArray(animals)) {
            const idx = animals.indexOf(this);
            if (idx >= 0) animals.splice(idx, 1);
        }
    }
    remove() {
        this.removeFromGame();
    }
    delete() {
        // Backward compatibility: use unified removal API.
        this.removeFromGame();
    }
    getDirectionRow() {
        if (!this.direction) return 0;
        return (this.direction.x > 0 || (this.direction.x === 0 && this.direction.y > 0)) ? 1 : 0;
    }
    goto(destinationNode) {
        if (!destinationNode) return;
        
        this.node = this.map.worldToNode(this.x, this.y);
        this.destination = destinationNode;
        const pathOptions = {};
        if (this.pathfindingClearance > 0) {
            pathOptions.clearance = this.pathfindingClearance;
        }
        this.path = (this.useAStarPathfinding && typeof this.map.findPathAStar === "function")
            ? this.map.findPathAStar(this.node, destinationNode, pathOptions)
            : this.map.findPath(this.node, destinationNode, pathOptions);
        if (!Array.isArray(this.path)) {
            this.path = [];
        }
        this.travelFrames = 0;
        this.nextNode = null;
    }
    move() {
        if (!this.useExternalScheduler) {
            this.moveTimeout = this.nextMove();
        } else {
            this.moveTimeout = null;
        }
        
        if (paused) {
            return;
        }
        if (this.isScriptFrozen()) {
            this.moving = false;
            return;
        }
        
        if (this.isOnFire) {
            this.burn();
        }

        if (
            !this.dead &&
            Number.isFinite(this.maxHp) &&
            this.maxHp > 0 &&
            Number.isFinite(this.hp) &&
            this.hp < this.maxHp
        ) {
            const dtSec = 1 / Math.max(1, Number(this.frameRate) || 1);
            const healRate = Number.isFinite(this.healRate) ? Math.max(0, Number(this.healRate)) : 0;
            const healMult = Number.isFinite(this.healRateMultiplier) ? Math.max(0, Number(this.healRateMultiplier)) : 1;
            const healPerSecond = this.maxHp * healRate * healMult;
            if (healPerSecond > 0) {
                this.hp = Math.min(this.maxHp, this.hp + healPerSecond * dtSec);
            }
        }

        // Check if we have a destination to move toward
        if (!this.destination) {
            this.moving = false;
            return;
        }
        
        this.moving = true;
        const moveStartX = this.x;
        const moveStartY = this.y;
        this.prevX = this.x;
        this.prevY = this.y;
        this.prevZ = this.z;
        
        if (this.travelFrames === 0) {
            this.casting = false;
            
            // If we've reached the nextNode, update our position and request next step
            if (this.nextNode) {
                this.node = this.nextNode;
                this.x = this.node.x;
                this.y = this.node.y;
            }
            
            // Get next node from path
            this.nextNode = this.path.shift();
            this.directionIndex = this.node.neighbors.indexOf(this.nextNode);

            if (!this.nextNode) {
                // Reached destination
                this.destination = null;
                this.moving = false;
                return;
            }
            
            // Calculate travel parameters using world coordinates
            let xdist = (this.map && typeof this.map.shortestDeltaX === "function")
                ? this.map.shortestDeltaX(this.x, this.nextNode.x)
                : (this.nextNode.x - this.x);
            let ydist = (this.map && typeof this.map.shortestDeltaY === "function")
                ? this.map.shortestDeltaY(this.y, this.nextNode.y)
                : (this.nextNode.y - this.y);
            let direction_distance = Math.sqrt(xdist ** 2 + ydist ** 2);
            this.travelFrames = Math.ceil(direction_distance / this.speed * this.frameRate);
            this.travelX = xdist / this.travelFrames;
            this.travelY = ydist / this.travelFrames;
            this.direction = {x: xdist, y: ydist};
        }
        
        this.travelFrames--;
        this.x += this.travelX;
        this.y += this.travelY;
        if (this.map && typeof this.map.wrapWorldX === "function") {
            this.x = this.map.wrapWorldX(this.x);
        }
        if (this.map && typeof this.map.wrapWorldY === "function") {
            this.y = this.map.wrapWorldY(this.y);
        }
        
        // Update hitboxes after movement
        this.updateHitboxes();
    }
    ignite(duration = 8, damageScale = null) {
        this.isOnFire = true;
        const durationSec = Number(duration);
        this.fireDuration = (Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 8) * frameRate;
        if (Number.isFinite(damageScale)) {
            this.fireDamageScale = Math.max(0, damageScale);
        } else {
            this.fireDamageScale = 1;
        }
        if (!this.fireAnimationInterval) {
            this.fireAnimationInterval = setInterval(() => {
                if (paused) return;
                this.burn();
            }, 1000 / frameRate);
        }
    }
    burn() {
        this.fireDuration--;
        if (this.fireDuration <= 0) {
            this.isOnFire = false;
            this.fireDamageScale = 1;
            if (this.fireSprite && this.fireSprite.parent) {
                this.fireSprite.parent.removeChild(this.fireSprite);
                this.fireSprite = null;
            }
            if (this.fireAnimationInterval) {
                clearInterval(this.fireAnimationInterval);
                this.fireAnimationInterval = null;
            }
            return;
        }
        if (this.hp <= 0 && !this.dead) {
            this.die();
        } else {
            const damageScale = Number.isFinite(this.fireDamageScale) ? this.fireDamageScale : 1;
            const burnDamage = 0.05 * Math.max(0, damageScale);
            if (typeof this.takeDamage === "function") {
                this.takeDamage(burnDamage);
            } else {
                this.hp -= burnDamage; // Fire damage over time
            }
        }
    }
    triggerDieScriptEvent(context = null) {
        if (this._scriptDieEventFired) return false;
        this._scriptDieEventFired = true;
        const scriptingApi = (typeof Scripting !== "undefined" && Scripting)
            ? Scripting
            : ((typeof globalThis !== "undefined" && globalThis.Scripting) ? globalThis.Scripting : null);
        if (!scriptingApi || typeof scriptingApi.fireObjectScriptEvent !== "function") return false;
        const wizardRef = (typeof wizard !== "undefined" && wizard)
            ? wizard
            : ((typeof globalThis !== "undefined" && globalThis.wizard) ? globalThis.wizard : null);
        return !!scriptingApi.fireObjectScriptEvent(this, "die", wizardRef, context);
    }
    die() {
        this.dead = true;
        this.rotation = 180;
        this.triggerDieScriptEvent({ cause: "die" });
    }

    getInterpolatedPosition(alpha = null) {
        const clampedAlpha = Number.isFinite(alpha)
            ? Math.max(0, Math.min(1, alpha))
            : ((typeof renderAlpha === "number") ? Math.max(0, Math.min(1, renderAlpha)) : 1);

        const prevX = Number.isFinite(this.prevX) ? this.prevX : this.x;
        const prevY = Number.isFinite(this.prevY) ? this.prevY : this.y;
        const prevZ = Number.isFinite(this.prevZ) ? this.prevZ : this.z;
        const currX = Number.isFinite(this.x) ? this.x : prevX;
        const currY = Number.isFinite(this.y) ? this.y : prevY;
        const currZ = Number.isFinite(this.z) ? this.z : prevZ;

        const x = (this.map && typeof this.map.shortestDeltaX === "function")
            ? (prevX + this.map.shortestDeltaX(prevX, currX) * clampedAlpha)
            : (prevX + (currX - prevX) * clampedAlpha);
        const y = (this.map && typeof this.map.shortestDeltaY === "function")
            ? (prevY + this.map.shortestDeltaY(prevY, currY) * clampedAlpha)
            : (prevY + (currY - prevY) * clampedAlpha);
        const z = prevZ + (currZ - prevZ) * clampedAlpha;

        return { x, y, z };
    }

    get interpolatedX() {
        return this.getInterpolatedPosition().x;
    }

    get interpolatedY() {
        return this.getInterpolatedPosition().y;
    }

    get interpolatedZ() {
        return this.getInterpolatedPosition().z;
    }
}
