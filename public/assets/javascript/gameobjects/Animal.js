class Animal extends Character {
    constructor(type, location, size, map) {
        super(type, location, size, map);
        this.useExternalScheduler = true;
        if (this.moveTimeout) {
            clearTimeout(this.moveTimeout);
            this.moveTimeout = null;
        }
        this.radius = this.size / 2; // Animal hitbox radius in hex units
        this.isOnFire = false;
        this.fireSprite = null;
        this.fireFrameIndex = 0;
        
        // Create Pixi sprite — use the first frame from the sliced spritesheet
        // textures if available, NOT the raw full-sheet image from map.animalImages.
        const texGroup = (typeof textures !== "undefined" && textures[type]) ? textures[type] : null;
        const firstFrameTexture = (texGroup && Array.isArray(texGroup.list) && texGroup.list.length > 0)
            ? (texGroup.list.find(Boolean) || texGroup.list[0])
            : PIXI.Texture.WHITE;
        this.pixiSprite = new PIXI.Sprite(firstFrameTexture);
        this.pixiSprite.anchor.set(0.5, 1.0);

        this.spriteRows = 1;
        this.spriteCols = 1;
        this.spriteCol = 0;
        this.spriteFrames = [[firstFrameTexture]];
        this.spriteSheet = null;
        this.spriteSheetReady = false;

        this.imageFrame = {x: 0, y: 0};
        this.frameCount = {x: 1, y: 1};
        
        // Default stats (can be overridden in subclasses)
        // Keep constructor-provided size so class-specific sizing survives.
        this.width = this.size;
        this.height = this.size;
        this.walkSpeed = 1;
        this.runSpeed = 2;
        this.fleeRadius = -1;
        this.chaseRadius = -1;
        this.attackVerb = "attacks";
        this.damage = 0;
        this.foodValue = 0;
        this.hp = 1;
        this.maxHp = this.hp;
        this.randomMotion = 1;
        this.lungeRadius = 2;
        this.lungeSpeed = 5.0;
        this.attackCooldown = 1.5;
        this.strikeRange = 0.8;
        this.retreatThreshold = 0.25;

        this.speed = this.walkSpeed;
        this._onScreen = false;
        this.rotation = 0;
        this.dead = false;
        this.frameRate = this.onScreen ? 30 : 1;
        this.attackState = "idle";
        this.attackTarget = null;
        this.lastAttackTimeMs = -Infinity;
        this.spriteDirectionLock = null;
        this.attacking = false;
        this._aiAccumulatorMs = Math.random() * 200;
        ensureSpriteFrames(this);

        // --- Depth billboard support (renders animal as a depth-tested billboard like trees) ---
        this._depthBillboardMesh = null;
        this._depthBillboardWorldPositions = null;
        this._depthBillboardLastSignature = "";
        this._depthBillboardLastUvSignature = "";
        this._depthBillboardMeshMode = "";
        const staticProto = (typeof globalThis.StaticObject === "function" && globalThis.StaticObject.prototype)
            ? globalThis.StaticObject.prototype
            : null;
        if (staticProto) {
            if (typeof staticProto.ensureDepthBillboardMesh === "function") {
                this.ensureDepthBillboardMesh = staticProto.ensureDepthBillboardMesh;
            }
            if (typeof staticProto.updateDepthBillboardUvsForTexture === "function") {
                this.updateDepthBillboardUvsForTexture = staticProto.updateDepthBillboardUvsForTexture;
            }
        }
    }
    updateDepthBillboardMesh(ctx, camera, options) {
        // Use interpolated position for smooth movement between sim ticks
        const interpolated = this.getInterpolatedPosition();
        const savedX = this.x, savedY = this.y, savedZ = this.z;
        this.x = interpolated.x;
        this.y = interpolated.y;
        this.z = interpolated.z;
        const staticProto = (typeof globalThis.StaticObject === "function" && globalThis.StaticObject.prototype)
            ? globalThis.StaticObject.prototype
            : null;
        let result = null;
        if (staticProto && typeof staticProto.updateDepthBillboardMesh === "function") {
            result = staticProto.updateDepthBillboardMesh.call(this, ctx, camera, options);
        }
        this.x = savedX;
        this.y = savedY;
        this.z = savedZ;
        return result;
    }
    getDirectionRow() {
        const activeDirection = this.spriteDirectionLock || this.direction;
        if (!activeDirection) return 0;
        return (activeDirection.x > 0 || (activeDirection.x === 0 && activeDirection.y > 0)) ? 1 : 0;
    }
    hasAttackAnimation() {
        if (this.spriteSheet && Array.isArray(this.spriteSheet.frameKeys)) {
            return this.spriteSheet.frameKeys.some(key => typeof key === "string" && key.indexOf("attack_") === 0);
        }
        return this.spriteCols > 1;
    }
    hasReachedRetreatThreshold() {
        if (!Number.isFinite(this.retreatThreshold) || this.retreatThreshold <= 0) return false;
        if (!Number.isFinite(this.maxHp) || this.maxHp <= 0) return false;
        const damageTakenRatio = (this.maxHp - Math.max(0, this.hp)) / this.maxHp;
        return damageTakenRatio >= this.retreatThreshold;
    }
    resetAttackState() {
        this.attackState = "idle";
        this.attackTarget = null;
        this.attacking = false;
        this.spriteDirectionLock = null;
        if (this.spriteCols > 1) this.spriteCol = 0;
    }
    setRetreatDestination(target) {
        if (!target) return;
        const dx = (this.map && typeof this.map.shortestDeltaX === "function")
            ? this.map.shortestDeltaX(target.x, this.x)
            : (this.x - target.x);
        const dy = (this.map && typeof this.map.shortestDeltaY === "function")
            ? this.map.shortestDeltaY(target.y, this.y)
            : (this.y - target.y);
        const dist = Math.hypot(dx, dy);
        if (!Number.isFinite(dist) || dist < 1e-6) return;

        const retreatDistance = Math.max(2, this.lungeRadius);
        let retreatX = this.x + (dx / dist) * retreatDistance;
        let retreatY = this.y + (dy / dist) * retreatDistance;
        if (this.map && typeof this.map.wrapWorldX === "function") {
            retreatX = this.map.wrapWorldX(retreatX);
        }
        if (this.map && typeof this.map.wrapWorldY === "function") {
            retreatY = this.map.wrapWorldY(retreatY);
        }
        const retreatNode = this.map.worldToNode(retreatX, retreatY);
        if (retreatNode) this.goto(retreatNode);
    }
    beginRetreat(target) {
        this.attackState = "retreat";
        this.attacking = true;
        this.speed = this.walkSpeed;
        this.spriteDirectionLock = this.direction
            ? { x: this.direction.x, y: this.direction.y }
            : this.spriteDirectionLock;
        if (this.spriteCols > 1) this.spriteCol = 0;
        this.setRetreatDestination(target);
    }
    updatePursuitDestination(target) {
        if (!target) return;
        const targetNode = this.map.worldToNode(target.x, target.y);
        if (!targetNode) return;

        const destinationChanged = this.destination !== targetNode;
        const hasNoPath = !Array.isArray(this.path) || this.path.length === 0;
        const betweenMoves = this.travelFrames === 0 || !this.moving;
        if (destinationChanged && (hasNoPath || betweenMoves)) {
            this.goto(targetNode);
        }
    }
    runAiBehaviorTick() {
        if (this.hasReachedRetreatThreshold()) {
            this.resetAttackState();
            if (!Number.isFinite(this._retreatBaseFleeRadius)) {
                this._retreatBaseFleeRadius = this.fleeRadius;
            }
            this.fleeRadius = 20;
        } else if (Number.isFinite(this._retreatBaseFleeRadius)) {
            this.fleeRadius = this._retreatBaseFleeRadius;
            this._retreatBaseFleeRadius = null;
        }

        if (this.fleeRadius > 0 && withinRadius(this.x, this.y, wizard.x, wizard.y, this.fleeRadius)) {
            this.resetAttackState();
            this.flee();
            return;
        }

        if (this.chaseRadius > 0 && withinRadius(this.x, this.y, wizard.x, wizard.y, this.chaseRadius)) {
            this.attack(wizard);
            return;
        }

        if (this.attackState !== "idle") {
            this.resetAttackState();
        }

        // Wander around when idle.
        if (Number.isFinite(this.x) && Number.isFinite(this.y) && !this.moving) {
            const wanderX = this.x + (Math.random() - 0.5) * 10;
            const wanderY = this.y + (Math.random() - 0.5) * 10;
            const wanderNode = this.map.worldToNode(wanderX, wanderY);
            if (wanderNode) this.goto(wanderNode);
            this.speed = this.walkSpeed;
        }
    }

    tickMovementOnly(simHz = null, movementScale = 1) {
        if (this.dead || this.gone) return;
        if (Number.isFinite(simHz) && simHz > 0) {
            this.frameRate = simHz;
        }
        super.move();
        const stepScale = Number.isFinite(movementScale) ? Math.max(1, movementScale) : 1;
        if (
            stepScale > 1 &&
            this.moving &&
            Number.isFinite(this.travelX) &&
            Number.isFinite(this.travelY) &&
            Number.isFinite(this.travelFrames) &&
            this.travelFrames > 0
        ) {
            const extraWholeSteps = Math.max(0, Math.floor(stepScale - 1));
            if (extraWholeSteps > 0) {
                const consumedExtra = Math.min(extraWholeSteps, this.travelFrames);
                this.x += this.travelX * consumedExtra;
                this.y += this.travelY * consumedExtra;
                this.travelFrames = Math.max(0, this.travelFrames - consumedExtra);
            }
            if (this.map && typeof this.map.wrapWorldX === "function") {
                this.x = this.map.wrapWorldX(this.x);
            }
            if (this.map && typeof this.map.wrapWorldY === "function") {
                this.y = this.map.wrapWorldY(this.y);
            }
            this.updateHitboxes();
        }
        if (!Number.isFinite(this.maxHp) || this.maxHp < this.hp) {
            this.maxHp = this.hp;
        }
    }

    tickBehaviorOnly() {
        if (this.dead || this.gone) return;
        this.runAiBehaviorTick();
    }

    move() {
        if (this.dead || this.gone) {
            clearTimeout(this.moveTimeout);
            clearTimeout(this.attackTimeout);
            return;
        } 
        super.move();

        if (!Number.isFinite(this.maxHp) || this.maxHp < this.hp) {
            this.maxHp = this.hp;
        }

        // Timer-driven mode keeps legacy dynamic rate selection.
        if (this.travelFrames === 0) {
            this.frameRate = this.onScreen ? 30 : this.speed;
        }
        this.runAiBehaviorTick();
    }
    get onScreen() {
        const safetyMargin = 5; // world units
        if (this.gone) return false;
        const interpolated = this.getInterpolatedPosition();
        const itemX = Number.isFinite(interpolated.x) ? interpolated.x : this.x;
        const itemY = Number.isFinite(interpolated.y) ? interpolated.y : this.y;
        const camera = viewport;
        const centerX = camera.x + camera.width * 0.5;
        const centerY = camera.y + camera.height * 0.5;
        const dx = (this.map && typeof this.map.shortestDeltaX === "function")
            ? this.map.shortestDeltaX(centerX, itemX)
            : (itemX - centerX);
        const dy = (this.map && typeof this.map.shortestDeltaY === "function")
            ? this.map.shortestDeltaY(centerY, itemY)
            : (itemY - centerY);
        const maxX = camera.width * 0.5 + this.width + safetyMargin;
        const maxY = camera.height * 0.5 + this.height + safetyMargin / xyratio;
        this._onScreen = Math.abs(dx) <= maxX && Math.abs(dy) <= maxY;
        return this._onScreen;
    }
    flee() {
        // flee the player
        let dist = distance(this.x, this.y, wizard.x, wizard.y);
        if (!Number.isFinite(dist) || dist < 1e-6) return;

        let xdist = this.x - wizard.x;
        let ydist = this.y - wizard.y;
        let fleeX = this.x + xdist / dist * 10;
        let fleeY = this.y + ydist / dist * 10;
        if (this.map && typeof this.map.wrapWorldX === "function") {
            fleeX = this.map.wrapWorldX(fleeX);
        }
        if (this.map && typeof this.map.wrapWorldY === "function") {
            fleeY = this.map.wrapWorldY(fleeY);
        }
        const fleeNode = this.map.worldToNode(fleeX, fleeY);
        if (fleeNode) this.goto(fleeNode);
        this.speed = this.runSpeed;
    }
    attack(target) {
        if (!target || target.gone || target.dead) {
            this.resetAttackState();
            return;
        }

        this.attackTarget = target;
        this.attacking = true;

        const now = Date.now();
        const cooldownMs = Math.max(0, Number(this.attackCooldown) || 0) * 1000;
        const dist = distance(this.x, this.y, target.x, target.y);

        if (this.attackState === "retreat") {
            this.speed = this.walkSpeed;
            if (!this.destination || !this.moving) {
                this.setRetreatDestination(target);
            }
            const hasRetreatedFarEnough = dist >= this.lungeRadius;
            if ((now - this.lastAttackTimeMs) >= cooldownMs && hasRetreatedFarEnough) {
                this.attackState = "approach";
                this.spriteDirectionLock = null;
            }
            return;
        }

        if (dist > this.lungeRadius) {
            this.attackState = "approach";
            this.speed = this.runSpeed;
            this.spriteDirectionLock = null;
            if (this.spriteCols > 1) this.spriteCol = 0;
            this.updatePursuitDestination(target);
            return;
        }

        this.attackState = "lunge";
        this.speed = this.lungeSpeed;
        if (this.hasAttackAnimation()) {
            this.spriteCol = 1;
        } else if (this.spriteCols > 1) {
            this.spriteCol = 0;
        }
        this.updatePursuitDestination(target);
        this.direction = {x: target.x - this.x, y: target.y - this.y};

        if (dist > this.strikeRange || (now - this.lastAttackTimeMs) < cooldownMs) {
            return;
        }

        if (this.hasAttackAnimation()) this.spriteCol = 1;
        const damage = Math.floor((1 - Math.random() * Math.random()) * this.damage + 1);
        target.hp = Math.max(0, target.hp - damage);
        this.lastAttackTimeMs = now;
        this.beginRetreat(target);
    }
    catch(x, y) {
        this.dead = 1;
        // what we want is 
        // (this.y + this.offset.y) * map.hexHeight === y
        // and
        // (this.x + this.offset.x) * map.hexWidth === x
        // so
        this.dieAnimation = setInterval(() => {
            if (paused) return;

            this.rotation -= 600 / this.frameRate;
            this.dead ++;
            this.height *= .96;
            this.width *= .96;
            if (this.dead > 100) {
                this.gone = true;
                clearInterval(this.dieAnimation);
            }
            this.y = this.y * .95 + ((y - this.width/ 2) - this.y) * .05;
            this.x = this.x * .95 + ((x - this.width / 2) - this.x) * .05;
            }, 1000 / this.frameRate);
        this.rotation = 180;
    }
    explode(x, y) {
        this.dead = 1;
        // this.rotation = 180;
        let xdist = this.x - this.width/2 - x;
        let ydist = this.y - this.height/2 - y;
        let dist = distance(this.x, this.y, x, y);
        this.z = 0;
        this.motion = {
            x: xdist / Math.min(dist, 2) / this.size / this.frameRate * 1.155,
            y: ydist / Math.min(dist, 2) / this.size / this.frameRate,
            z: 5 / Math.min(dist, 1) / this.size / this.frameRate
        }
        this.dieAnimation = setInterval(() => {
            if (paused) return;

            this.x += this.motion.x;
            this.y += this.motion.y;
            this.z += this.motion.z;
            this.motion.z -= .5 / frameRate;
            if (this.rotation < 180) this.rotation += 360/frameRate;
            if (this.z <= 0) {
                this.z = 0;
                this.rotation = 180;
                clearInterval(this.dieAnimation);
            }
        }, 1000 / this.frameRate);
    }

    saveJson() {
        return {
            type: this.type,
            x: this.x,
            y: this.y,
            hp: this.hp,
            size: this.size
        };
    }

    static loadJson(data, map) {
        if (!data || !data.type || !map) return null;

        let animalInstance;
        const node = map.worldToNode(data.x, data.y);

        if (!node) return null;

        try {
            switch (data.type) {
                case 'squirrel':
                    animalInstance = new Squirrel(node, map);
                    break;
                case 'deer':
                    animalInstance = new Deer(node, map);
                    break;
                case 'bear':
                    animalInstance = new Bear(node, map);
                    break;
                case 'scorpion':
                    animalInstance = new Scorpion(node, map);
                    break;
                case 'armadillo':
                    animalInstance = new Armadillo(node, map);
                    break;
                case 'coyote':
                    animalInstance = new Coyote(node, map);
                    break;
                case 'goat':
                    animalInstance = new Goat(node, map);
                    break;
                case 'porcupine':
                    animalInstance = new Porcupine(node, map);
                    break;
                case 'yeti':
                    animalInstance = new Yeti(node, map);
                    break;
                default:
                    animalInstance = new Animal(data.type, node, map);
            }

            if (animalInstance) {
                animalInstance.x = data.x;
                animalInstance.y = data.y;
                if (data.hp !== undefined) animalInstance.hp = data.hp;

                // Restore saved size and rescale derived properties
                if (Number.isFinite(data.size) && data.size > 0) {
                    const baseSize = animalInstance.size;
                    const savedSize = data.size;
                    if (Math.abs(baseSize - savedSize) > 1e-6 && baseSize > 0) {
                        const ratio = savedSize / baseSize;
                        animalInstance.size = savedSize;
                        animalInstance.width = (animalInstance.width / baseSize) * savedSize;
                        animalInstance.height = (animalInstance.height / baseSize) * savedSize;
                        if (Number.isFinite(animalInstance.radius)) {
                            animalInstance.radius *= ratio;
                        }
                        if (Number.isFinite(animalInstance.lungeRadius)) {
                            animalInstance.lungeRadius *= ratio;
                        }
                        if (Number.isFinite(animalInstance.strikeRange)) {
                            animalInstance.strikeRange *= ratio;
                        }
                        if (Number.isFinite(animalInstance.damage)) {
                            animalInstance.damage *= ratio;
                        }
                        if (Number.isFinite(animalInstance.groundRadius)) {
                            animalInstance.groundRadius *= ratio;
                        }
                        if (Number.isFinite(animalInstance.visualRadius)) {
                            animalInstance.visualRadius *= ratio;
                        }
                        if (typeof animalInstance.updateHitboxes === "function") {
                            animalInstance.updateHitboxes();
                        }
                    }
                }
            }

            return animalInstance;
        } catch (e) {
            console.error("Error loading animal:", e);
            return null;
        }
    }
}

class Squirrel extends Animal {
    constructor(location, map) {
        const size = Math.random() * .2 + .4;
        super('squirrel', location, size, map);
        this.spriteSheet = {
            rows: 2,
            cols: 1,
            frameKeys: [
                "walk_left",
                "walk_right"
            ]
        };
        this.radius = 0.25; 
        this.frameCount = {x: 1, y: 2};
        this.width = size;
        this.height = size;
        this.walkSpeed = 2;
        this.runSpeed = 2.5;
        this.lungeRadius = 3;
        this.lungeSpeed = 5.5;
        this.attackCooldown = 2.5;
        this.strikeRange = 0.5;
        this.retreatThreshold = 1;
        this.fleeRadius = 5;
        this.foodValue = Math.floor(6 * this.size);
        this.hp = 1;
        this.maxHp = this.hp;
        this.randomMotion = 3;
        this.spriteSheetReady = false;
        ensureSpriteFrames(this);
    }
}

class Deer extends Animal {
    constructor(location, map) {
        const size = Math.random() * .5 + .75;
        super('deer', location, size, map);
        this.spriteSheet = {
            rows: 2,
            cols: 1,
            frameKeys: [
                "walk_left",
                "walk_right"
            ]
        };
        this.radius = 0.55; // Animal hitbox radius in hex units
        this.frameCount = {x: 1, y: 2};
        this.width = size;
        this.height = size;
        this.walkSpeed = 1;
        this.runSpeed = 3.5;
        this.lungeRadius = 2.5;
        this.lungeSpeed = 4.5;
        this.attackCooldown = 2.0;
        this.strikeRange = 0.8;
        this.retreatThreshold = 0.5;
        this.fleeRadius = 9;
        this.foodValue = Math.floor(90 * size);
        this.hp = 10 * size;
        this.maxHp = this.hp;
        this.spriteSheetReady = false;
        ensureSpriteFrames(this);
    }
}

class Bear extends Animal {
    constructor(location, map) {
        const size = Math.random() * .5 + 1.2;
        super('bear', location, size, map);
        this.spriteSheet = {
            rows: 2,
            cols: 2,
            frameKeys: [
                "walk_left",
                "attack_left",
                "walk_right",
                "attack_right"
            ]
        };
        this.radius = 1.0; // Animal hitbox radius in hex units
        this.groundRadius *= 1.5;
        this.visualRadius *= 1.5;
        this.updateHitboxes();
        this.frameCount = {x: 2, y: 2};
        this.width = this.size * 1.4;
        this.height = this.size;
        this.walkSpeed = 1;
        this.runSpeed = 3.5;
        this.lungeRadius = 2;
        this.lungeSpeed = 5.0;
        this.attackCooldown = 1.5;
        this.strikeRange = 0.8;
        this.retreatThreshold = 0.25;
        this.chaseRadius = 9;
        this.fleeRadius = -1;
        this.attackVerb = "mauls";
        this.damage = 20;
        this.foodValue = Math.floor(240 * this.size);
        this.hp = 25 * this.size;
        this.maxHp = this.hp;
        this.spriteSheetReady = false;
        ensureSpriteFrames(this);
    }
}


class Scorpion extends Animal {
    constructor(location, map) {
        const size = Math.random() * .1 + .4;
        super('scorpion', location, size, map);
        this.frameCount = {x: 1, y: 2};
        this.width = size;
        this.height = size;
        this.walkSpeed = .75;
        this.runSpeed = 1.5;
        this.chaseRadius = 4;
        this.attackVerb = "stings";
        this.damage = 1;
        this.foodValue = 1;
        this.hp = 1;
        this.randomMotion = 2;
    }
}

class Armadillo extends Animal {
    constructor(location, map) {
        const size = Math.random() * .2 + .5;
        super('armadillo', location, size, map);
        this.frameCount = {x: 1, y: 2};
        this.width = size;
        this.height = size;
        this.walkSpeed = 1;
        this.runSpeed = 2;
        this.fleeRadius = 7;
        this.foodValue = Math.floor(20 * size);
        this.hp = 10 * size;
        this.randomMotion = 3;
    }
}

class Coyote extends Animal {
    constructor(location, map) {
        const size = Math.random() * .25 + .7;
        super('coyote', location, size, map);
        this.frameCount = {x: 1, y: 2};
        this.width = size * 1.75;
        this.height = size;
        this.walkSpeed = 1;
        this.runSpeed = 3.5;
        this.fleeRadius = 10;
        this.foodValue = Math.floor(60 * size);
        this.hp = 15 * size;
        this.randomMotion = 6;
    }
}

class Goat extends Animal {
    constructor(location, map) {
        const size = Math.random() * .25 + .7;
        super('goat', location, size, map);
        this.spriteSheet = {
            rows: 2,
            cols: 1,
            frameKeys: [
                "walk_left",
                "walk_right"
            ]
        };
        this.frameCount = {x: 1, y: 2};
        this.width = size * 1.2;
        this.height = size;
        this.walkSpeed = 1;
        this.runSpeed = 2.5;
        this.fleeRadius = 8;
        this.foodValue = Math.floor(80 * size);
        this.hp = 15 * size;
        this.randomMotion = 6;
        this.spriteSheetReady = false;
        ensureSpriteFrames(this);
    }
}

class Porcupine extends Animal {
    constructor(location, map) {
        const size = Math.random() * .2 + .5;
        super('porcupine', location, size, map);
        this.frameCount = {x: 2, y: 2};
        this.width = size * 1.15;
        this.height = size;
        this.walkSpeed = 1;
        this.runSpeed = 2;
        this.fleeRadius = 7;
        this.chaseRadius = 4;
        this.damage = 3;
        this.attackVerb = "pokes";
        this.foodValue = Math.floor(20 * size);
        this.hp = 5 * size;
        this.randomMotion = 3;
    }
}

class Yeti extends Animal {
    constructor(location, map) {
        const size = Math.random() * .5 + 1.5;
        super('yeti', location, size, map);
        this.spriteSheet = {
            rows: 2,
            cols: 2,
            frameKeys: [
                "walk_left",
                "attack_left",
                "walk_right",
                "attack_right"
            ]
        };
        this.frameCount = {x: 2, y: 2};
        this.width = size * 1.2;
        this.height = size;
        this.walkSpeed = 1;
        this.runSpeed = 2.75;
        this.chaseRadius = 6;
        this.attackVerb = "mauls";
        this.damage = 50;
        this.foodValue = Math.floor(400 * size);
        this.hp = 40 * size;
        this.spriteSheetReady = false;
        ensureSpriteFrames(this);
    }
}

