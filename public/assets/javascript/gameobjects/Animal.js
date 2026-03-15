class Animal extends Character {
    static FIRE_TEXTURE_PATH = "/assets/images/magic/fire.png";
    static FIRE_FRAME_COUNT_X = 5;
    static FIRE_FRAME_COUNT_Y = 5;
    static FIRE_FPS = 12;
    static _fireFramesCache = null;

    static getFireFrames() {
        if (Animal._fireFramesCache && Animal._fireFramesCache.length > 0) {
            return Animal._fireFramesCache;
        }
        const baseTex = PIXI.Texture.from(Animal.FIRE_TEXTURE_PATH).baseTexture;
        if (!baseTex || !baseTex.valid) return null;
        const cols = Animal.FIRE_FRAME_COUNT_X;
        const rows = Animal.FIRE_FRAME_COUNT_Y;
        const fw = baseTex.width / cols;
        const fh = baseTex.height / rows;
        const frames = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                frames.push(new PIXI.Texture(baseTex, new PIXI.Rectangle(c * fw, r * fh, fw, fh)));
            }
        }
        Animal._fireFramesCache = frames;
        return frames;
    }

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
        this.mp = this.hp;
        this.maxMp = this.maxHp;
        this.randomMotion = 1;
        this.lungeRadius = 2;
        this.lungeSpeed = 5.0;
        this.attackCooldown = 1.5;
        this.strikeRange = 0.8;
        this.retreatThreshold = 0.25;
        this.healthBarHoldMs = 3000;
        this._healthBarVisibleUntilMs = 0;
        this._healthBarGraphics = null;

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
        this.pursuitRepathMs = 250;
        this.aggroDurationMs = 12000;
        this.disengageRadius = 40;
        this._aggroUntilMs = 0;
        this._lastPursuitPathMs = 0;
        this._lastAStarAggroMs = 0;     // timestamp of last A* run during no-LOS pursuit
        this._suppressGreedyRepath = false; // true while an A* no-LOS path is active
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

    _ensureFireSprite() {
        if (this.fireSprite) return this.fireSprite;
        const frames = Animal.getFireFrames();
        if (!frames || frames.length === 0) return null;
        this._fireFrameIndex = Math.floor(Math.random() * frames.length);
        this._fireFrameProgress = 0;
        this._fireLastFrameCount = null;
        this.fireSprite = new PIXI.Sprite(frames[this._fireFrameIndex % frames.length]);
        this.fireSprite.anchor.set(0.5, 1);
        this.fireSprite.blendMode = PIXI.BLEND_MODES.ADD;
        return this.fireSprite;
    }

    _updateFireAnimation() {
        if (!this.fireSprite) return;
        const frames = Animal.getFireFrames();
        if (!frames || frames.length <= 1) return;

        const currentFC = Number.isFinite(frameCount) ? Number(frameCount) : 0;
        if (!Number.isFinite(this._fireLastFrameCount)) {
            this._fireLastFrameCount = currentFC;
            this.fireSprite.texture = frames[this._fireFrameIndex % frames.length];
            return;
        }

        const delta = Math.max(0, currentFC - this._fireLastFrameCount);
        this._fireLastFrameCount = currentFC;
        if (delta <= 0) return;

        const simFps = Math.max(1, Number(frameRate) || 30);
        this._fireFrameProgress += delta * (Animal.FIRE_FPS / simFps);
        const advance = Math.floor(this._fireFrameProgress);
        if (advance > 0) {
            this._fireFrameProgress -= advance;
            this._fireFrameIndex = (this._fireFrameIndex + advance) % frames.length;
        }
        this.fireSprite.texture = frames[this._fireFrameIndex % frames.length];
    }

    _removeFireSprite() {
        if (!this.fireSprite) return;
        if (this.fireSprite.parent) {
            this.fireSprite.parent.removeChild(this.fireSprite);
        }
        if (typeof this.fireSprite.destroy === "function") {
            this.fireSprite.destroy({ children: true, texture: false, baseTexture: false });
        }
        this.fireSprite = null;
    }

    _syncFireVisualState() {
        if (!this.isOnFire) {
            this._removeFireSprite();
            return;
        }
        this._ensureFireSprite();
        this._updateFireAnimation();
    }

    _ensureDeathState() {
        if (this.dead) return;
        if (!Number.isFinite(this.hp) || this.hp > 0) return;
        this.die();
    }

    getStrikeDistance(target = null) {
        const baseRange = Number.isFinite(this.strikeRange) ? this.strikeRange : 0;
        const selfRadius = Number.isFinite(this.groundRadius)
            ? this.groundRadius
            : (Number.isFinite(this.visualRadius) ? this.visualRadius : 0);
        const targetRadius = (target && Number.isFinite(target.groundRadius))
            ? target.groundRadius
            : ((target && Number.isFinite(target.visualRadius)) ? target.visualRadius : 0);
        return Math.max(baseRange, selfRadius + targetRadius);
    }

    burn() {
        super.burn();
        this._syncFireVisualState();
    }

    die() {
        if (this.dead) return;
        super.die();
        this.rotation = 180;
        if (this.isOnFire) {
            this.fireDuration = Math.max(1, Math.round(Math.max(1, Number(frameRate) || 30) * 5));
            if (!this.fireAnimationInterval) {
                this.fireAnimationInterval = setInterval(() => {
                    if (paused) return;
                    this.burn();
                }, 1000 / Math.max(1, Number(frameRate) || 30));
            }
        }
        this.speed = 0;
        this.moving = false;
        this.travelX = 0;
        this.travelY = 0;
        this.destination = null;
        this.path = [];
        this.nextNode = null;
        this.travelFrames = 0;
        this.prevX = this.x;
        this.prevY = this.y;
        this.prevZ = this.z;
        this.attackTarget = null;
        this.attackState = "idle";
        this.attacking = false;
        this.spriteDirectionLock = null;
    }
    tickDeadFire() {
        if (!this.dead || !this.isOnFire) return;
        if (this.fireAnimationInterval) return;
        if (paused) return;

        const currentFC = Number.isFinite(frameCount) ? Number(frameCount) : 0;
        if (!Number.isFinite(this._deadFireLastFrameCount)) {
            this._deadFireLastFrameCount = currentFC;
            return;
        }

        const delta = Math.max(0, currentFC - this._deadFireLastFrameCount);
        this._deadFireLastFrameCount = currentFC;
        if (delta <= 0) return;

        this.fireDuration = Number.isFinite(this.fireDuration) ? (this.fireDuration - delta) : this.fireDuration;
        if (Number.isFinite(this.fireDuration) && this.fireDuration <= 0) {
            this.isOnFire = false;
            this.fireDamageScale = 1;
            this._removeFireSprite();
            return;
        }
    }
    getInterpolatedPosition(alpha = null) {
        if (this.dead) {
            return { x: this.x, y: this.y, z: this.z };
        }
        return super.getInterpolatedPosition(alpha);
    }
    showHealthBar(durationMs = null) {
        const holdMs = Number.isFinite(durationMs)
            ? Math.max(0, Number(durationMs))
            : (Number.isFinite(this.healthBarHoldMs) ? Math.max(0, Number(this.healthBarHoldMs)) : 3000);
        const now = Date.now();
        this._healthBarVisibleUntilMs = Math.max(this._healthBarVisibleUntilMs || 0, now + holdMs);
    }
    ensureMagicPointsInitialized(resetCurrent = false) {
        const fallbackHp = Number.isFinite(this.hp) ? Number(this.hp) : 0;
        const fallbackMaxHp = Math.max(
            fallbackHp,
            Number.isFinite(this.maxHp) ? Number(this.maxHp) : 0
        );
        if (!Number.isFinite(this.maxHp) || this.maxHp < fallbackHp) {
            this.maxHp = fallbackMaxHp;
        }
        if (resetCurrent || !Number.isFinite(this.mp)) {
            this.mp = fallbackHp;
        }
        if (resetCurrent || !Number.isFinite(this.maxMp)) {
            this.maxMp = fallbackMaxHp;
        }
        if (Number.isFinite(this.maxMp) && Number.isFinite(this.mp) && this.mp > this.maxMp) {
            this.mp = this.maxMp;
        }
    }
    vanishFromMagicDepletion() {
        if (this.gone || this.vanishing || this.dead) return false;
        this.vanishing = true;
        this.vanishStartTime = frameCount;
        this.vanishDuration = 0.25 * frameRate;
        this.percentVanished = 0;
        if (this._vanishFinalizeTimeout) {
            clearTimeout(this._vanishFinalizeTimeout);
        }
        const finalizeAfterMs = Math.max(0, (this.vanishDuration / Math.max(1, frameRate)) * 1000);
        this._vanishFinalizeTimeout = setTimeout(() => {
            if (!this || this.gone) return;
            if (typeof this.removeFromGame === "function") {
                this.removeFromGame();
            } else {
                this.gone = true;
            }
            this.vanishing = false;
            this._vanishFinalizeTimeout = null;
        }, finalizeAfterMs);
        return true;
    }
    takeDamage(amount, options = null) {
        const rawDamage = Number(amount);
        if (!Number.isFinite(rawDamage) || rawDamage <= 0) return 0;
        const isSpellDamage = !!(options && options.isSpell);
        this.ensureMagicPointsInitialized();
        if (isSpellDamage) {
            const prevMp = Number.isFinite(this.mp) ? this.mp : 0;
            const nextMp = Math.max(0, prevMp - rawDamage);
            const absorbed = Math.max(0, prevMp - nextMp);
            this.mp = nextMp;
            if (absorbed > 0 || this.mp <= 0) {
                const holdMs = (options && Number.isFinite(options.healthBarDurationMs))
                    ? Number(options.healthBarDurationMs)
                    : null;
                this.showHealthBar(holdMs);
            }
            if (this.mp <= 0) {
                this.vanishFromMagicDepletion();
            }
            return absorbed;
        }
        let remainingDamage = rawDamage;
        if (remainingDamage <= 0) return 0;
        if (!Number.isFinite(this.hp)) this.hp = 0;
        const prevHp = this.hp;
        this.hp = Math.max(0, this.hp - remainingDamage);
        const applied = Math.max(0, prevHp - this.hp);
        if (applied > 0) {
            const holdMs = (options && Number.isFinite(options.healthBarDurationMs))
                ? Number(options.healthBarDurationMs)
                : null;
            this.showHealthBar(holdMs);
        }
        return applied;
    }
    hideHealthBarOverlay() {
        if (this._healthBarGraphics) {
            this._healthBarGraphics.visible = false;
        }
    }
    updateHealthBarOverlay(camera, container) {
        if (!camera || !container) return;
        if (this.gone || this.vanishing || this.dead || !Number.isFinite(this.maxHp) || this.maxHp <= 0 || !Number.isFinite(this.hp)) {
            this.hideHealthBarOverlay();
            return;
        }
        const now = Date.now();
        if (now > (this._healthBarVisibleUntilMs || 0)) {
            this.hideHealthBarOverlay();
            return;
        }

        if (!this._healthBarGraphics) {
            this._healthBarGraphics = new PIXI.Graphics();
            this._healthBarGraphics.name = "animalHealthBar";
            this._healthBarGraphics.visible = false;
            this._healthBarGraphics.interactive = false;
        }
        const g = this._healthBarGraphics;
        if (g.parent !== container) {
            container.addChild(g);
        }

        const interp = (typeof this.getInterpolatedPosition === "function")
            ? this.getInterpolatedPosition()
            : { x: this.x, y: this.y };
        const pos = camera.worldToScreen(
            Number.isFinite(interp && interp.x) ? interp.x : this.x,
            Number.isFinite(interp && interp.y) ? interp.y : this.y,
            0
        );
        if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
            g.visible = false;
            return;
        }

        const widthPx = Math.max(24, Math.min(70, (Number(this.width) || Number(this.size) || 1) * camera.viewscale * 0.85));
        const heightPx = 5;
        const pad = 1;
        const gapPx = 2;
        const healthRatio = Math.max(0, Math.min(1, this.hp / this.maxHp));
        const healthFillColor = (healthRatio > 0.6) ? 0x3ed36a : ((healthRatio > 0.3) ? 0xf2bf3b : 0xde4a4a);
        const hasMagicBar = Number.isFinite(this.maxMp) && this.maxMp > 0 && Number.isFinite(this.mp);
        const magicRatio = hasMagicBar ? Math.max(0, Math.min(1, this.mp / this.maxMp)) : 0;
        const totalHeightPx = hasMagicBar ? (heightPx * 2 + gapPx) : heightPx;

        g.clear();
        const drawBar = (y, ratio, fillColor) => {
            g.beginFill(0x000000, 0.75);
            g.drawRoundedRect(0, y, widthPx, heightPx, 2);
            g.endFill();
            if (ratio > 0) {
                g.beginFill(fillColor, 0.95);
                g.drawRoundedRect(pad, y + pad, (widthPx - pad * 2) * ratio, Math.max(1, heightPx - pad * 2), 1);
                g.endFill();
            }
        };
        if (hasMagicBar) {
            drawBar(0, magicRatio, 0x3b82f6);
        }
        drawBar(hasMagicBar ? (heightPx + gapPx) : 0, healthRatio, healthFillColor);
        g.x = pos.x - widthPx / 2;
        g.y = pos.y - (Number(this.height) || Number(this.size) || 1) * camera.viewscale - totalHeightPx - 8;
        g.visible = true;
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

        if (this.dead && result && this._depthBillboardWorldPositions && this._depthBillboardWorldPositions.length >= 12) {
            const signature = (typeof this._depthBillboardLastSignature === "string")
                ? this._depthBillboardLastSignature
                : "";
            if (this._deadDepthFlipSignature !== signature) {
                const positions = this._depthBillboardWorldPositions;
                const cx = (positions[0] + positions[3] + positions[6] + positions[9]) / 4;
                const cy = (positions[1] + positions[4] + positions[7] + positions[10]) / 4;
                const cz = (positions[2] + positions[5] + positions[8] + positions[11]) / 4;
                for (let i = 0; i <= 9; i += 3) {
                    positions[i] = 2 * cx - positions[i];
                    positions[i + 1] = 2 * cy - positions[i + 1];
                    positions[i + 2] = 2 * cz - positions[i + 2];
                }
                const worldBuffer = result.geometry && typeof result.geometry.getBuffer === "function"
                    ? result.geometry.getBuffer("aWorldPosition")
                    : null;
                if (worldBuffer && typeof worldBuffer.update === "function") {
                    worldBuffer.update();
                }
                this._deadDepthFlipSignature = signature;
            }
        } else {
            this._deadDepthFlipSignature = null;
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
    distanceToPoint(x, y) {
        if (this.map && typeof this.map.distanceBetweenPoints === "function") {
            return this.map.distanceBetweenPoints(this.x, this.y, x, y);
        }
        return Math.hypot((x - this.x), (y - this.y));
    }
    isPointWithinRadius(x, y, radius) {
        if (!Number.isFinite(radius) || radius <= 0) return false;
        if (this.map && typeof this.map.pointWithinRadius === "function") {
            return this.map.pointWithinRadius(this.x, this.y, x, y, radius);
        }
        const dx = (x - this.x);
        const dy = (y - this.y);
        return (dx * dx + dy * dy) <= (radius * radius);
    }
    scaledChaseRadius(baseRadius) {
        if (!Number.isFinite(baseRadius) || baseRadius <= 0) return -1;
        return baseRadius * Math.sqrt(Math.max(0, this.size));
    }
    _refreshAggro(now = Date.now()) {
        const duration = Number.isFinite(this.aggroDurationMs) ? Math.max(0, this.aggroDurationMs) : 0;
        this._aggroUntilMs = now + duration;
    }
    _hasAggro(now = Date.now()) {
        return Number.isFinite(this._aggroUntilMs) && now <= this._aggroUntilMs;
    }
    _shouldDisengage(target, now = Date.now()) {
        if (!target) return true;
        if (this._hasAggro(now)) return false;
        const leash = Math.max(
            Number.isFinite(this.disengageRadius) ? this.disengageRadius : 0,
            (Number.isFinite(this.chaseRadius) && this.chaseRadius > 0) ? this.chaseRadius * 2 : 0
        );
        if (leash <= 0) return true;
        return !this.isPointWithinRadius(target.x, target.y, leash);
    }
    _clearPursuit() {
        this.resetAttackState();
        this.path = [];
        this.destination = null;
        this.nextNode = null;
        this.travelFrames = 0;
    }
    _applyPursuitPath(path, destinationNode, preserveStep) {
        this.path = Array.isArray(path) ? path : [];
        this.destination = destinationNode || null;
        if (!preserveStep) {
            this.travelFrames = 0;
            this.nextNode = null;
        }
    }
    resetAttackState() {
        this.attackState = "idle";
        this.attackTarget = null;
        this.attacking = false;
        this.spriteDirectionLock = null;
        this._committedToAttack = false;
        this._lungeStartMs = undefined;
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
        // Don't reset spriteCol here — keep the attack frame visible during retreat.
        // resetAttackState() (called when retreat ends) will clear it.
        this.setRetreatDestination(target);
    }
    updatePursuitDestination(target) {
        if (!target) return;
        // While an A* no-LOS path is active, don't let the greedy repath overwrite it —
        // but only while nodes remain. If the path is exhausted, drop suppression so the
        // animal can immediately get a new greedy path and doesn't freeze in place.
        if (this._suppressGreedyRepath) {
            if (Array.isArray(this.path) && this.path.length > 0) return;
            this._suppressGreedyRepath = false;
        }
        const now = Date.now();
        const targetNode = this.map.worldToNode(target.x, target.y);
        if (!targetNode) return;

        const startNode = this.map.worldToNode(this.x, this.y) || this.node;
        if (!startNode) return;
        const repathInterval = Number.isFinite(this.pursuitRepathMs) ? Math.max(0, this.pursuitRepathMs) : 0;
        const repathDue = (now - (this._lastPursuitPathMs || 0)) >= repathInterval;
        const destinationChanged = this.destination !== targetNode;
        const pathEmpty = !Array.isArray(this.path) || this.path.length === 0;
        const betweenMoves = this.travelFrames === 0 || !this.moving;
        if (!destinationChanged && !pathEmpty && !repathDue) return;
        if (!betweenMoves && !pathEmpty && !destinationChanged && !repathDue) return;

        const pathOptions = {};
        if (this.pathfindingClearance > 0) {
            pathOptions.clearance = this.pathfindingClearance;
        }
        const path = this.map.findPath(startNode, targetNode, pathOptions);
        this._lastPursuitPathMs = now;
        this._applyPursuitPath(path, targetNode, !betweenMoves);
    }
    runAiBehaviorTick() {
        if (typeof this.isScriptFrozen === "function" && this.isScriptFrozen()) {
            this.moving = false;
            return;
        }
        // Still recovering from knocking down a tree — let retreat movement continue
        // but skip all AI decision-making until the cooldown expires.
        if (this._pauseUntilMs && Date.now() < this._pauseUntilMs) {
            return;
        }
        if (this._pauseUntilMs) {
            this._pauseUntilMs = null;
            // Clean up the retreat state from the tree knock so we go straight back
            // into attack mode rather than wandering or extending the retreat.
            this.resetAttackState();
            // Stay committed to the attack regardless of chaseRadius — the bear
            // already decided to charge, it will keep knocking trees and pursuing.
            this._committedToAttack = true;
            // Clear the retreat path so attack() immediately issues a fresh path
            // toward the wizard rather than finishing the old retreat path first.
            this.path = [];
            this.destination = null;
            this.travelFrames = 0;
            this.nextNode = null;
            if (typeof wizard !== "undefined") {
                this.attack(wizard);
                return;
            }
        }

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

        if (this.fleeRadius > 0 && this.isPointWithinRadius(wizard.x, wizard.y, this.fleeRadius)) {
            this.resetAttackState();
            this.flee();
            return;
        }

        const now = Date.now();
        const inChaseRadius = this.chaseRadius > 0 && this.isPointWithinRadius(wizard.x, wizard.y, this.chaseRadius);
        if (inChaseRadius) {
            const alreadyAggro = this._hasAggro(now) || this.attacking || this.attackState !== "idle";
            const animalNode = this.map && this.map.worldToNode ? this.map.worldToNode(this.x, this.y) || this.node : this.node;
            const wizardNode = this.map && this.map.worldToNode ? this.map.worldToNode(wizard.x, wizard.y) : null;
            const hasLOS = (animalNode && wizardNode && typeof this.map.hasLineOfSight === 'function')
                ? this.map.hasLineOfSight(animalNode, wizardNode)
                : true; // fallback: allow if LOS check unavailable

            if (hasLOS) {
                // Direct line of sight — clear any no-LOS A* state and pursue normally.
                this._suppressGreedyRepath = false;
                this._lastAStarAggroMs = 0;
                this._refreshAggro(now);
                this.attack(wizard);
                return;
            }

            if (alreadyAggro) {
                // Aggro'd but no LOS — try A* maze routing at most once per second.
                const aStarIntervalMs = 1000;
                const aStarDue = (now - (this._lastAStarAggroMs || 0)) >= aStarIntervalMs;

                if (aStarDue) {
                    this._lastAStarAggroMs = now;
                    const maxChasePathDist = (Number.isFinite(this.chaseRadius) && this.chaseRadius > 0)
                        ? this.chaseRadius * 2
                        : 0;
                    // maxIterations scales with search area to keep CPU bounded.
                    const maxIter = Math.max(100, Math.ceil(maxChasePathDist * 10));
                    const pathOpts = { maxIterations: maxIter };
                    if (this.pathfindingClearance > 0) pathOpts.clearance = this.pathfindingClearance;

                    const aStarPath = (animalNode && wizardNode && typeof this.map.findPathAStar === 'function')
                        ? this.map.findPathAStar(animalNode, wizardNode, pathOpts)
                        : null;

                    // Check path exists and its world-distance is within 2x chase radius.
                    let pathUsable = false;
                    if (Array.isArray(aStarPath) && aStarPath.length > 0 && maxChasePathDist > 0) {
                        let totalDist = 0;
                        let prev = animalNode;
                        for (const node of aStarPath) {
                            const dx = (typeof this.map.shortestDeltaX === 'function')
                                ? this.map.shortestDeltaX(prev.x, node.x) : (node.x - prev.x);
                            const dy = (typeof this.map.shortestDeltaY === 'function')
                                ? this.map.shortestDeltaY(prev.y, node.y) : (node.y - prev.y);
                            totalDist += Math.hypot(dx, dy);
                            if (totalDist > maxChasePathDist) break;
                            prev = node;
                        }
                        pathUsable = totalDist <= maxChasePathDist;
                    }

                    if (pathUsable) {
                        this._refreshAggro(now);
                        this._suppressGreedyRepath = true;
                        this._applyPursuitPath(aStarPath, wizardNode, false);
                        this._lastPursuitPathMs = now;
                        this.attacking = true;
                        this.attackState = "approach";
                        this.speed = this.runSpeed;
                        return;
                    }

                    // A* failed or path too long — drop back to greedy pathfinding.
                    this._suppressGreedyRepath = false;
                }

                // Between A* ticks (or after A* fallback) — proceed with normal attack().
                this._refreshAggro(now);
                this.attack(wizard);
                return;
            }

            // Not yet aggro'd and no LOS — don't engage.
        }
        if (
            this.chaseRadius > 0 &&
            !this._hasAggro(now) &&
            (this.attackState !== "idle" || this.attacking)
        ) {
            this._clearPursuit();
            this._aggroUntilMs = 0;
            return;
        }

        if (
            this._hasAggro(now) &&
            (this.chaseRadius > 0 || this.attacking || this.attackState !== "idle")
        ) {
            this.attack(wizard);
            return;
        }

        if (this.attackState !== "idle" || this.attacking) {
            if (this._shouldDisengage(wizard, now)) {
                this._clearPursuit();
                this._aggroUntilMs = 0;
            } else {
                this.attack(wizard);
                return;
            }
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
        this._ensureDeathState();
        if (this.dead || this.gone) return;
        if (Number.isFinite(simHz) && simHz > 0) {
            this.frameRate = simHz;
        }
        super.move();
        this._ensureDeathState();
        this._syncFireVisualState();
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
        this._ensureDeathState();
        if (this.dead || this.gone) return;
        if (typeof this.isScriptFrozen === "function" && this.isScriptFrozen()) {
            this.moving = false;
            return;
        }
        this.runAiBehaviorTick();
    }

    move() {
        this._ensureDeathState();
        if (this.dead || this.gone) {
            clearTimeout(this.moveTimeout);
            clearTimeout(this.attackTimeout);
            return;
        } 
        super.move();
        if (typeof this.isScriptFrozen === "function" && this.isScriptFrozen()) {
            this.moving = false;
            return;
        }
        this._ensureDeathState();
        this._syncFireVisualState();
        if (this.dead || this.gone) return;

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
        let dist = this.distanceToPoint(wizard.x, wizard.y);
        if (!Number.isFinite(dist) || dist < 1e-6) return;

        let xdist = (this.map && typeof this.map.shortestDeltaX === "function")
            ? this.map.shortestDeltaX(wizard.x, this.x)
            : (this.x - wizard.x);
        let ydist = (this.map && typeof this.map.shortestDeltaY === "function")
            ? this.map.shortestDeltaY(wizard.y, this.y)
            : (this.y - wizard.y);
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

    getKnockableObstacleSize(obj) {
        if (!obj) return Infinity;
        if (Number.isFinite(obj.size)) return Number(obj.size);
        const width = Number.isFinite(obj.width) ? Number(obj.width) : 1;
        const height = Number.isFinite(obj.height) ? Number(obj.height) : width;
        return Math.max(width, height);
    }

    isKnockableObstacle(obj) {
        if (!obj || obj.gone || obj.falling) return false;
        if (!(Number.isFinite(obj.hp) && obj.hp > 0)) return false;
        const isDoor = !!(
            obj.type === "door" ||
            ((typeof obj.category === "string") && obj.category.trim().toLowerCase() === "doors")
        );
        const isTree = obj.type === "tree";
        if (!isTree && !isDoor) return false;
        if (isDoor && (obj.isOpen || obj._doorLockedOpen || obj.isFallenDoorEffect)) return false;
        if (isDoor) return true;
        return this.size > this.getKnockableObstacleSize(obj);
    }

    rollAttackDamage() {
        return Math.floor((1 - Math.random() * Math.random()) * this.damage + 1);
    }

    /**
     * Find the closest knockable obstacle near this animal — checks live trees and
     * doors plus lazy tree records that still block pathfinding.
     */
    findKnockableTreeNearby() {
        if (!this.map) return null;

        const sDeltaX = (this.map && typeof this.map.shortestDeltaX === 'function')
            ? (a, b) => this.map.shortestDeltaX(a, b) : (a, b) => b - a;
        const sDeltaY = (this.map && typeof this.map.shortestDeltaY === 'function')
            ? (a, b) => this.map.shortestDeltaY(a, b) : (a, b) => b - a;

        // 1. Check live objects via BFS over nearby nodes
        const start = this.map.worldToNode(this.x, this.y);
        let best = null;
        let bestDist = Infinity;

        if (start) {
            const maxRings = this.pathfindingClearance + 10;
            const visited = new Set();
            visited.add(`${start.xindex},${start.yindex}`);
            let frontier = [start];

            for (let ring = 1; ring <= maxRings; ring++) {
                const nextFrontier = [];
                for (let fi = 0; fi < frontier.length; fi++) {
                    const node = frontier[fi];
                    for (let ni = 0; ni < node.neighbors.length; ni++) {
                        const nb = node.neighbors[ni];
                        if (!nb) continue;
                        const key = `${nb.xindex},${nb.yindex}`;
                        if (visited.has(key)) continue;
                        visited.add(key);
                        nextFrontier.push(nb);
                        if (!nb.objects || nb.objects.length === 0) continue;
                        for (let oi = 0; oi < nb.objects.length; oi++) {
                            const obj = nb.objects[oi];
                            if (!this.isKnockableObstacle(obj)) continue;
                            const d = Math.hypot(sDeltaX(this.x, obj.x), sDeltaY(this.y, obj.y));
                            if (d < bestDist) { bestDist = d; best = obj; }
                        }
                    }
                }
                frontier = nextFrontier;
                if (frontier.length === 0) break;
            }
        }

        // 2. Also check lazy tree records (unhydrated trees that still block pathfinding)
        if (typeof getLazyTreeRecordsForMinimap === 'function') {
            const maxWorldDist = (this.pathfindingClearance + 12) * 2;
            const lazys = getLazyTreeRecordsForMinimap();
            for (let i = 0; i < lazys.length; i++) {
                const rec = lazys[i];
                if (!rec || (rec.hp !== undefined && rec.hp <= 0)) continue;
                if (this.size <= this.getKnockableObstacleSize(rec)) continue;
                const d = Math.hypot(sDeltaX(this.x, rec.x), sDeltaY(this.y, rec.y));
                if (d > maxWorldDist || d >= bestDist) continue;
                // Hydrate this lazy record into a real Tree object so we can target it
                const created = (typeof StaticObject !== 'undefined' && typeof StaticObject.loadJson === 'function')
                    ? StaticObject.loadJson(rec, this.map) : null;
                if (created) {
                    // Remove from lazy store — it's now a live object
                    if (typeof unregisterLazyTreeRecordAt === 'function') {
                        unregisterLazyTreeRecordAt(rec.x, rec.y);
                    }
                    bestDist = d;
                    best = created;
                }
            }
        }

        return best;
    }

    attack(target) {
        if (!target || target.gone || target.dead) {
            this.resetAttackState();
            return;
        }
        const now = Date.now();
        const cooldownMs = Math.max(0, Number(this.attackCooldown) || 0) * 1000;
        this._refreshAggro(now);

        // If already targeting a knockable obstacle, keep pursuing it.
        if (this.isKnockableObstacle(this.attackTarget)) {
            const obstacle = this.attackTarget;
            this.attackState = "lunge";
            this.speed = this.lungeSpeed;
            if (this.hasAttackAnimation()) {
                this.spriteCol = 1;
            } else if (this.spriteCols > 1) {
                this.spriteCol = 0;
            }
            this.direction = {
                x: (this.map && typeof this.map.shortestDeltaX === "function")
                    ? this.map.shortestDeltaX(this.x, obstacle.x)
                    : (obstacle.x - this.x),
                y: (this.map && typeof this.map.shortestDeltaY === "function")
                    ? this.map.shortestDeltaY(this.y, obstacle.y)
                    : (obstacle.y - this.y)
            };
            const obstacleNode = this.map.worldToNode(obstacle.x, obstacle.y);
            const hasNoPath = !Array.isArray(this.path) || this.path.length === 0;
            const betweenMoves = this.travelFrames === 0 || !this.moving;
            if (obstacleNode && (this.destination !== obstacleNode) && (hasNoPath || betweenMoves)) {
                const startNode = this.map.worldToNode(this.x, this.y) || this.node;
                    const obstacleIsDoor = !!(
                        obstacle.type === "door" ||
                        ((typeof obstacle.category === "string") && obstacle.category.trim().toLowerCase() === "doors")
                    );
                const obstaclePath = startNode
                    ? this.map.findPath(startNode, obstacleNode, obstacleIsDoor ? {} : { allowBlockedDestination: true })
                    : [];
                this._applyPursuitPath(obstaclePath, obstacleNode, !betweenMoves);
                this._lastPursuitPathMs = now;

                // If another knockable blocker is in the way, target it first.
                const lungeBlockers = this.path.blockers || [];
                if (lungeBlockers.length > 0) {
                    let closerObstacle = null;
                    let closerDist = Infinity;
                    const currentObstacleDist = this.distanceToPoint(obstacle.x, obstacle.y);
                    for (let bi = 0; bi < lungeBlockers.length; bi++) {
                        const obj = lungeBlockers[bi];
                        if (!this.isKnockableObstacle(obj)) continue;
                        const dx = (this.map && typeof this.map.shortestDeltaX === "function")
                            ? this.map.shortestDeltaX(this.x, obj.x) : (obj.x - this.x);
                        const dy = (this.map && typeof this.map.shortestDeltaY === "function")
                            ? this.map.shortestDeltaY(this.y, obj.y) : (obj.y - this.y);
                        const d = Math.hypot(dx, dy);
                        if (d < currentObstacleDist && d < closerDist) { closerDist = d; closerObstacle = obj; }
                    }
                    if (closerObstacle) {
                        this.attackTarget = closerObstacle;
                        const closerNode = this.map.worldToNode(closerObstacle.x, closerObstacle.y);
                        if (closerNode) {
                            const closerIsDoor = !!(
                                closerObstacle.type === "door" ||
                                ((typeof closerObstacle.category === "string") && closerObstacle.category.trim().toLowerCase() === "doors")
                            );
                            const closerPath = startNode
                                ? this.map.findPath(startNode, closerNode, closerIsDoor ? {} : { allowBlockedDestination: true })
                                : [];
                            this._applyPursuitPath(closerPath, closerNode, !betweenMoves);
                            this._lastPursuitPathMs = now;
                        }
                    }
                }
            }
            const distToObstacle = this.distanceToPoint(obstacle.x, obstacle.y);
            if (distToObstacle <= (this.strikeRange || 1.0)) {
                if (obstacle.type === "tree") {
                    const knockDx = (this.map && typeof this.map.shortestDeltaX === "function")
                        ? this.map.shortestDeltaX(this.x, obstacle.x)
                        : (obstacle.x - this.x);
                    obstacle.fallDirection = knockDx >= 0 ? 'left' : 'right';
                    obstacle.hp = 0;
                    if (typeof globalThis !== "undefined" && globalThis.activeSimObjects instanceof Set) {
                        globalThis.activeSimObjects.add(obstacle);
                    }
                    const obstacleSizeRatio = (this.size > 0)
                        ? this.getKnockableObstacleSize(obstacle) / this.size
                        : 1;
                    const pauseMs = Math.max(300, this.attackCooldown * 1000 * (obstacleSizeRatio ** 2));
                    this._pauseUntilMs = Date.now() + pauseMs;
                    this.attackTarget = null;
                    this.beginRetreat(obstacle);
                } else if (obstacle.type === "door") {
                    if ((now - this.lastAttackTimeMs) < cooldownMs) {
                        return;
                    }
                    const damage = this.rollAttackDamage();
                    if (typeof obstacle.triggerDoorHitShake === "function") {
                        obstacle.triggerDoorHitShake();
                    }
                    obstacle.hp = Math.max(0, obstacle.hp - damage);
                    if (obstacle.hp <= 0) {
                        if (typeof obstacle.setDoorFallAwayFromPoint === "function") {
                            let hitOriginX = this.x;
                            let hitOriginY = this.y;
                            const attackDir = this.spriteDirectionLock || this.direction;
                            const dirX = Number(attackDir && attackDir.x);
                            const dirY = Number(attackDir && attackDir.y);
                            const dirLen = Math.hypot(dirX, dirY);
                            if (dirLen > 1e-6) {
                                const backstep = Math.max(
                                    Number.isFinite(this.strikeRange) ? Number(this.strikeRange) : 0,
                                    Number.isFinite(this.size) ? Number(this.size) * 0.5 : 0,
                                    0.75
                                );
                                hitOriginX = this.x - (dirX / dirLen) * backstep;
                                hitOriginY = this.y - (dirY / dirLen) * backstep;
                            } else if (Number.isFinite(this.prevX) && Number.isFinite(this.prevY)) {
                                hitOriginX = Number(this.prevX);
                                hitOriginY = Number(this.prevY);
                            }
                            obstacle.setDoorFallAwayFromPoint(hitOriginX, hitOriginY);
                        }
                        if (typeof globalThis !== "undefined" && globalThis.activeSimObjects instanceof Set) {
                            globalThis.activeSimObjects.add(obstacle);
                        }
                    }
                    this.lastAttackTimeMs = now;
                    this.beginRetreat(obstacle);
                } else {
                    obstacle.hp = 0;
                    if (typeof globalThis !== "undefined" && globalThis.activeSimObjects instanceof Set) {
                        globalThis.activeSimObjects.add(obstacle);
                    }
                    this.attackTarget = null;
                    this.beginRetreat(obstacle);
                }
            }
            return;
        }

        if (this.attackTarget && (
            this.attackTarget.type === "tree" ||
            this.attackTarget.type === "door" ||
            (typeof this.attackTarget.category === "string" && this.attackTarget.category.trim().toLowerCase() === "doors")
        )) {
            this.attackTarget = null;
            this.attackState = "idle";
        }

        this.attackTarget = target;
        this.attacking = true;

        const dist = this.distanceToPoint(target.x, target.y);

        // Retreat check must come first — before the distance check — so retreat state
        // is never overridden by the approach block when the target drifts outside lungeRadius.
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

            // Check the currently-owned path for knockable blockers.
            const blockers = (Array.isArray(this.path) && this.path.blockers) ? this.path.blockers : [];
            if (blockers.length > 0) {
                    let knockableObstacle = null;
                    let closestDist = Infinity;
                    for (let bi = 0; bi < blockers.length; bi++) {
                        const obj = blockers[bi];
                        if (!this.isKnockableObstacle(obj)) continue;
                        const dx = (this.map && typeof this.map.shortestDeltaX === "function")
                            ? this.map.shortestDeltaX(this.x, obj.x) : (obj.x - this.x);
                        const dy = (this.map && typeof this.map.shortestDeltaY === "function")
                            ? this.map.shortestDeltaY(this.y, obj.y) : (obj.y - this.y);
                        const d = Math.hypot(dx, dy);
                        if (d < closestDist) { closestDist = d; knockableObstacle = obj; }
                    }
                    if (knockableObstacle) {
                        this.attackTarget = knockableObstacle;
                        this.direction = {
                            x: (this.map && typeof this.map.shortestDeltaX === "function")
                                ? this.map.shortestDeltaX(this.x, knockableObstacle.x)
                                : (knockableObstacle.x - this.x),
                            y: (this.map && typeof this.map.shortestDeltaY === "function")
                                ? this.map.shortestDeltaY(this.y, knockableObstacle.y)
                                : (knockableObstacle.y - this.y)
                        };
                        this.attackState = "lunge";
                        this.speed = this.lungeSpeed;
                        if (this.hasAttackAnimation()) this.spriteCol = 1;
                        const obstacleNode = this.map.worldToNode(knockableObstacle.x, knockableObstacle.y);
                        if (obstacleNode) {
                            const startNode = this.map.worldToNode(this.x, this.y) || this.node;
                            const betweenMoves = this.travelFrames === 0 || !this.moving;
                            const obstacleIsDoor = !!(
                                knockableObstacle.type === "door" ||
                                ((typeof knockableObstacle.category === "string") && knockableObstacle.category.trim().toLowerCase() === "doors")
                            );
                            const obstaclePath = startNode
                                ? this.map.findPath(startNode, obstacleNode, obstacleIsDoor ? {} : { allowBlockedDestination: true })
                                : [];
                            this._applyPursuitPath(obstaclePath, obstacleNode, !betweenMoves);
                            this._lastPursuitPathMs = now;
                        }
                    }
                }
            return;
        }

        // Record when the lunge began (only on the first tick entering lunge state).
        if (this.attackState !== "lunge") {
            this._lungeStartMs = now;
        }

        // Abort the lunge if it has lasted too long without landing a hit.
        // Allowed duration = time it would take to travel lungeRadius*2 at lungeSpeed.
        const lungeMaxMs = (this.lungeRadius * 2 / this.lungeSpeed) * 1000;
        if ((now - this._lungeStartMs) > lungeMaxMs) {
            this._lungeStartMs = undefined;
            // Kill any in-progress movement step so speed visibly resets immediately.
            this.travelFrames = 0;
            this.path = [];
            this.destination = null;
            this.nextNode = null;
            // Stamp attack time so the cooldown enforces a real wait before re-lunging.
            this.lastAttackTimeMs = now;
            this.beginRetreat(target);
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
        this.direction = {
            x: (this.map && typeof this.map.shortestDeltaX === "function")
                ? this.map.shortestDeltaX(this.x, target.x)
                : (target.x - this.x),
            y: (this.map && typeof this.map.shortestDeltaY === "function")
                ? this.map.shortestDeltaY(this.y, target.y)
                : (target.y - this.y)
        };

        if (dist > this.getStrikeDistance(target) || (now - this.lastAttackTimeMs) < cooldownMs) {
            return;
        }

        if (this.hasAttackAnimation()) this.spriteCol = 1;
        const damage = this.rollAttackDamage();
        target.hp = Math.max(0, target.hp - damage);
        this.lastAttackTimeMs = now;
        this.beginRetreat(target);
    }
    catch(x, y) {
        this.dead = 1;
        this.triggerDieScriptEvent({ cause: "catch" });
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
        this.triggerDieScriptEvent({ cause: "explode" });
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
        this.ensureMagicPointsInitialized();
        const data = {
            type: this.type,
            x: this.x,
            y: this.y,
            hp: this.hp,
            maxHp: this.maxHp,
            mp: this.mp,
            maxMp: this.maxMp,
            size: this.size
        };
        if (typeof this.visible === "boolean") {
            data.visible = this.visible;
        }
        if (Number.isFinite(this.brightness)) {
            data.brightness = Number(this.brightness);
        }
        if (Number.isFinite(this.tint)) {
            data.tint = Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(this.tint))));
        } else if (this.pixiSprite && Number.isFinite(this.pixiSprite.tint)) {
            data.tint = Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(this.pixiSprite.tint))));
        }
        if (Number.isFinite(this.chaseRadius)) {
            data.chaseRadius = Number(this.chaseRadius);
        }
        if (typeof this.script !== "undefined") {
            try {
                data.script = JSON.parse(JSON.stringify(this.script));
            } catch (_err) {
                data.script = this.script;
            }
        }
        if (typeof this.scriptingName === "string" && this.scriptingName.trim().length > 0) {
            data.scriptingName = this.scriptingName.trim();
        }
        return data;
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
                case 'blodia':
                    animalInstance = new Blodia(node, map);
                    break;
                default:
                    animalInstance = new Animal(data.type, node, map);
            }

            if (animalInstance) {
                animalInstance.x = data.x;
                animalInstance.y = data.y;
                if (data.hp !== undefined) animalInstance.hp = data.hp;
                if (data.maxHp !== undefined) animalInstance.maxHp = data.maxHp;
                animalInstance.ensureMagicPointsInitialized(true);
                if (data.mp !== undefined) animalInstance.mp = data.mp;
                if (data.maxMp !== undefined) animalInstance.maxMp = data.maxMp;
                animalInstance.ensureMagicPointsInitialized();
                if (typeof data.visible === "boolean") {
                    animalInstance.visible = data.visible;
                }
                if (Number.isFinite(data.brightness)) {
                    animalInstance.brightness = Number(data.brightness);
                }
                if (Number.isFinite(data.tint)) {
                    const normalizedTint = Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(data.tint))));
                    animalInstance.tint = normalizedTint;
                    if (animalInstance.pixiSprite) {
                        animalInstance.pixiSprite.tint = normalizedTint;
                    }
                }
                if (Number.isFinite(data.chaseRadius)) {
                    animalInstance.chaseRadius = Number(data.chaseRadius);
                }
                if (Object.prototype.hasOwnProperty.call(data, "script")) {
                    animalInstance.script = data.script;
                }
                if (typeof data.scriptingName === "string") {
                    animalInstance.scriptingName = data.scriptingName.trim();
                }

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
        this.ensureMagicPointsInitialized(true);
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
        this.ensureMagicPointsInitialized(true);
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
        this.chaseRadius = this.scaledChaseRadius(9);
        this.fleeRadius = -1;
        this.attackVerb = "mauls";
        this.damage = 20;
        this.foodValue = Math.floor(240 * this.size);
        this.hp = 25 * this.size;
        this.maxHp = this.hp;
        this.ensureMagicPointsInitialized(true);
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
        this.ensureMagicPointsInitialized(true);
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
        this.ensureMagicPointsInitialized(true);
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
        this.ensureMagicPointsInitialized(true);
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
        this.ensureMagicPointsInitialized(true);
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
        this.ensureMagicPointsInitialized(true);
        this.randomMotion = 3;
    }
}

class Blodia extends Animal {
    constructor(location, map) {
        const size = Math.random() * .5 + 1.5;
        super('blodia', location, size, map);
        this.spriteSheet = {
            rows: 1,
            cols: 2,
            frameKeys: [
                "walk_left",
                "attack_left"
            ]
        };
        this.frameCount = {x: 2, y: 1};
        this.width = size * 0.75;
        this.height = size * 1.6;
        this.walkSpeed = 1.2;
        this.runSpeed = 3.7;
        this.lungeSpeed = 6.0;
        this.chaseRadius = this.scaledChaseRadius(9);
        this.attackVerb = "mauls";
        this.damage = 50;
        this.foodValue = Math.floor(400 * size);
        this.hp = 40 * size;
        this.maxHp = this.hp;
        this.ensureMagicPointsInitialized(true);
        this.useAStarPathfinding = true;
        this._lockedOnWizard = false;
        this._lastAStarMs = 0;       // A* throttle — at most once per second
        this._lastPathDist = Infinity; // total world-distance of last A* path
        this._lungeStartMs = 0;      // when path became short enough to lunge (0 = not lunging)
        this._retreatStartMs = 0;    // when a successful hit triggered retreat
        this.spriteSheetReady = false;
        ensureSpriteFrames(this);
    }

    get pathfindingClearance() {
        return Math.max(0, super.pathfindingClearance - 1);
    }

    // Override move() so AI runs *before* the movement step — no one-tick lag when a path
    // is freshly generated (destination is already set when Character.move() looks at it).
    // Also skips Animal.move()'s own runAiBehaviorTick() call to avoid double-execution.
    move() {
        if (this.dead || this.gone) {
            clearTimeout(this.moveTimeout);
            clearTimeout(this.attackTimeout);
            return;
        }
        if (!this.useExternalScheduler) {
            this.moveTimeout = this.nextMove();
        } else {
            this.moveTimeout = null;
        }
        if (paused) return;
        if (typeof this.isScriptFrozen === "function" && this.isScriptFrozen()) {
            this.moving = false;
            return;
        }

        if (this.isOnFire) this.burn();

        // HP regen (mirrors Character.move())
        if (
            Number.isFinite(this.maxHp) && this.maxHp > 0 &&
            Number.isFinite(this.hp) && this.hp < this.maxHp
        ) {
            const dtSec = 1 / Math.max(1, Number(this.frameRate) || 1);
            const hps = this.maxHp *
                Math.max(0, Number.isFinite(this.healRate) ? this.healRate : 0) *
                Math.max(0, Number.isFinite(this.healRateMultiplier) ? this.healRateMultiplier : 1);
            if (hps > 0) this.hp = Math.min(this.maxHp, this.hp + hps * dtSec);
        }

        // AI first — destination/path is ready when the movement step runs below
        this._blodiaAi();

        // Movement — inlined from Character.move() (frameRate adjustment from Animal.move() added)
        this.frameRate = this.onScreen ? 30 : this.speed;

        if (!this.destination) {
            this.moving = false;
            if (!Number.isFinite(this.maxHp) || this.maxHp < this.hp) this.maxHp = this.hp;
            return;
        }

        this.moving = true;
        this.prevX = this.x;
        this.prevY = this.y;
        this.prevZ = this.z;

        if (this.travelFrames === 0) {
            this.casting = false;
            if (this.nextNode) {
                this.node = this.nextNode;
                this.x = this.node.x;
                this.y = this.node.y;
            }
            this.nextNode = this.path.shift();
            this.directionIndex = this.node.neighbors.indexOf(this.nextNode);
            if (!this.nextNode) {
                this.destination = null;
                this.moving = false;
                if (!Number.isFinite(this.maxHp) || this.maxHp < this.hp) this.maxHp = this.hp;
                return;
            }
            const xdist = typeof this.map.shortestDeltaX === "function"
                ? this.map.shortestDeltaX(this.x, this.nextNode.x)
                : (this.nextNode.x - this.x);
            const ydist = typeof this.map.shortestDeltaY === "function"
                ? this.map.shortestDeltaY(this.y, this.nextNode.y)
                : (this.nextNode.y - this.y);
            const d = Math.sqrt(xdist ** 2 + ydist ** 2);
            this.travelFrames = Math.max(1, Math.ceil(d / this.speed * this.frameRate));
            this.travelX = xdist / this.travelFrames;
            this.travelY = ydist / this.travelFrames;
            this.direction = {x: xdist, y: ydist};
        }

        this.travelFrames--;
        this.x += this.travelX;
        this.y += this.travelY;
        if (this.map.wrapWorldX) this.x = this.map.wrapWorldX(this.x);
        if (this.map.wrapWorldY) this.y = this.map.wrapWorldY(this.y);
        this.updateHitboxes();
        if (!Number.isFinite(this.maxHp) || this.maxHp < this.hp) this.maxHp = this.hp;
    }

    // runAiBehaviorTick is called by tickBehaviorOnly() from the external scheduler.
    // Delegate to the same logic so both code paths stay in sync.
    runAiBehaviorTick() {
        this._blodiaAi();
    }

    // All AI logic in one place.
    _blodiaAi() {
        if (this.dead || this.gone) return;
        if (typeof wizard === "undefined" || !wizard) return;

        // Suppress base-class pause/flee machinery unconditionally.
        this._pauseUntilMs = null;
        this._committedToAttack = false;

        // Aggro: lock on once wizard enters chase radius.
        if (!this._lockedOnWizard) {
            if (this.chaseRadius <= 0 || this.isPointWithinRadius(wizard.x, wizard.y, this.chaseRadius)) {
                this._lockedOnWizard = true;
            }
        }

        if (!this._lockedOnWizard) {
            // Not yet aggro'd — wander slowly.
            if (!this.moving) {
                const wNode = this.map.worldToNode(
                    this.x + (Math.random() - 0.5) * 10,
                    this.y + (Math.random() - 0.5) * 10
                );
                if (wNode) this.goto(wNode);
                this.speed = this.walkSpeed;
            }
            return;
        }

        const now = Date.now();
        const dist = this.distanceToPoint(wizard.x, wizard.y);
        // Always derive start node from actual world position — this.node is stale mid-step.
        const startNode = this.map.worldToNode(this.x, this.y) || this.node;
        const targetNode = this.map.worldToNode(wizard.x, wizard.y);

        // ── Retreat phase: briefly back off after a successful hit ──────────────────
        if (this.attackState === "retreat") {
            // 600 ms of retreat movement, then resume approach with an immediate A* refresh.
            if ((now - this._retreatStartMs) >= 600) {
                this.resetAttackState();
                this._lungeStartMs = 0;
                this._lastPathDist = Infinity;
                this._lastAStarMs = 0; // force immediate A* re-route
            }
            return;
        }

        // ── Lunge phase: path is short enough to close in and strike ────────────────
        // We enter lunge only when _lastPathDist (computed in approach) confirms the
        // actual maze route is ≤ lungeRadius. Straight-line dist alone is not enough.
        if (this._lungeStartMs) {
            // Hard timeout — if no hit, the player escaped; retreat and cool down.
            const lungeMaxMs = (this.lungeRadius * 2 / this.lungeSpeed) * 1000;
            if ((now - this._lungeStartMs) >= lungeMaxMs) {
                this._lungeStartMs = 0;
                this._lastPathDist = Infinity;
                this._lastAStarMs = 0;
                // Kill the baked-in lunge-speed movement step immediately.
                this.travelFrames = 0;
                this.path = [];
                this.destination = null;
                this.nextNode = null;
                this.resetAttackState();
                return;
            }

            // Set lunge state visuals.
            this.attackTarget = wizard;
            this.attacking = true;
            this.attackState = "lunge";
            this.speed = this.lungeSpeed;
            this.spriteDirectionLock = null;
            if (this.hasAttackAnimation()) this.spriteCol = 1;
            else if (this.spriteCols > 1) this.spriteCol = 0;
            if (startNode) {
                this.direction = {
                    x: typeof this.map.shortestDeltaX === "function"
                        ? this.map.shortestDeltaX(this.x, wizard.x) : (wizard.x - this.x),
                    y: typeof this.map.shortestDeltaY === "function"
                        ? this.map.shortestDeltaY(this.y, wizard.y) : (wizard.y - this.y),
                };
            }

            // Check for a successful hit.
            const cooldownMs = Math.max(0, Number(this.attackCooldown) || 0) * 1000;
            if (dist <= this.getStrikeDistance(wizard) && (now - this.lastAttackTimeMs) >= cooldownMs) {
                const damage = Math.floor((1 - Math.random() * Math.random()) * this.damage + 1);
                wizard.hp = Math.max(0, wizard.hp - damage);
                this.lastAttackTimeMs = now;
                this._lungeStartMs = 0;
                this._lastPathDist = Infinity;
                this._retreatStartMs = now;
                this.beginRetreat(wizard);
                return;
            }

            // Keep closing in — re-path via A* when queue is empty or target moved.
            if (startNode && targetNode) {
                const pathEmpty = !Array.isArray(this.path) || this.path.length === 0;
                const destChanged = this.destination !== targetNode;
                if (pathEmpty || destChanged) {
                    const p = this.map.findPathAStar(startNode, targetNode,
                        { clearance: 0, allowBlockedDestination: true });
                    if (Array.isArray(p) && p.length > 0) {
                        this._lastPathDist = this._pathTotalDist(p);
                        this._applyPath(p, targetNode, this.travelFrames > 0);
                    }
                }
            }
            return;
        }

        // ── Approach phase: follow A* route toward the player ───────────────────────
        this.attackTarget = wizard;
        this.attacking = true;
        this.attackState = "approach";
        this.speed = this.runSpeed;
        this.spriteDirectionLock = null;
        if (this.spriteCols > 1) this.spriteCol = 0;

        if (!startNode || !targetNode) return;

        const midStep = this.travelFrames > 0;
        const pathEmpty = !Array.isArray(this.path) || this.path.length === 0;

        // A* every second for an accurate wall-aware route.
        // Blodia always uses clearance:0 — it squeezes through every corridor.
        if ((now - this._lastAStarMs) >= 1000) {
            this._lastAStarMs = now;
            const p = this.map.findPathAStar(startNode, targetNode, { clearance: 0 });
            if (Array.isArray(p) && p.length > 0) {
                this._lastPathDist = this._pathTotalDist(p);
                this._applyPath(p, targetNode, midStep);
            }
        }
        // Greedy BFS fallback — only when completely pathless so we never freeze.
        // Also updates _lastPathDist so lunge can trigger even when A* hasn't run yet.
        if (pathEmpty && !this.destination) {
            const p = this.map.findPath(startNode, targetNode, { clearance: 0 });
            if (Array.isArray(p) && p.length > 0) {
                this._lastPathDist = this._pathTotalDist(p);
            }
            this._applyPath(p, targetNode, midStep);
        }

        // Switch to lunge only when the A* path (not straight-line) is short enough.
        // This prevents maze false-positives where dist is small but the route is long.
        const cooldownMs = Math.max(0, Number(this.attackCooldown) || 0) * 1000;
        if (
            this._lastPathDist <= this.lungeRadius &&
            (now - this.lastAttackTimeMs) >= cooldownMs
        ) {
            this._lungeStartMs = now;
        }
    }

    // Sum world-distance along a path array of MapNodes.
    _pathTotalDist(nodes) {
        if (!Array.isArray(nodes) || nodes.length === 0) return Infinity;
        let d = 0;
        for (let i = 1; i < nodes.length; i++) {
            const dx = typeof this.map.shortestDeltaX === "function"
                ? this.map.shortestDeltaX(nodes[i - 1].x, nodes[i].x)
                : (nodes[i].x - nodes[i - 1].x);
            const dy = typeof this.map.shortestDeltaY === "function"
                ? this.map.shortestDeltaY(nodes[i - 1].y, nodes[i].y)
                : (nodes[i].y - nodes[i - 1].y);
            d += Math.hypot(dx, dy);
        }
        return d;
    }

    // Apply a new path. When preserveStep is true (mid-step), replace the path queue
    // without resetting travelFrames/nextNode so the current step finishes smoothly.
    _applyPath(newPath, targetNode, preserveStep) {
        if (!Array.isArray(newPath) || newPath.length === 0) return;
        this.path = newPath;
        this.destination = targetNode;
        if (!preserveStep) {
            this.travelFrames = 0;
            this.nextNode = null;
        }
    }

    die() {
        if (this.dead) return;
        // Snapshot pre-death fire anchor world position (top-center of the upright billboard).
        const h = Number.isFinite(this.height) ? this.height : 0;
        this._deathFireAnchorWorld = { x: this.x, y: this.y, z: h * 0.75 };
        // Mark this animal as using a gradual death fall so the renderer
        // doesn't swap the sprite anchor (which would shift the billboard down).
        this._useGradualDeathFall = true;
        // Double the fire duration so the flame fades out 2x slower than normal.
        if (this.isOnFire && Number.isFinite(this.fireDuration)) {
            this._deathFireOrigDuration = this.fireDuration;
        }
        super.die();
        // Make the post-death fire last twice as long.
        if (Number.isFinite(this.fireDuration)) {
            this.fireDuration = this.fireDuration * 2;
        }
        this._deathFireTotalDuration = Number.isFinite(this.fireDuration) ? this.fireDuration : null;
        // Override the instant flip — start at 0 and fall sideways gradually.
        this.rotation = 0;
        this._deathFalling = true;
        this._deathFallSpeed = 0;          // degrees per render tick — accelerates
        // Fire scale/alpha animation state — renderer reads _deathFireScale and _deathFireAlpha.
        this._deathFireScale = 1;
        this._deathFireAlpha = 1;
        this._deathFireFading = false;     // starts fading after the fall completes
    }

    /**
     * Called every render frame (via applySpriteTransform) while dead.
     * Gradually rotates the sprite to 90° (lying on its side) with
     * a gentle gravity-like acceleration.
     * Also drives the flame grow → shrink + fade animation.
     */
    tickDeathAnimation() {
        if (this._deathFalling) {
            // Accelerate the fall (like gravity); cap the speed so it doesn't overshoot wildly.
            this._deathFallSpeed = Math.min(this._deathFallSpeed + 0.066, 1.125);
            this.rotation = Math.min(this.rotation + this._deathFallSpeed, 90);
            // While falling: flame scales from 1× to 2× proportional to rotation.
            const t = Math.min(1, (Number.isFinite(this.rotation) ? this.rotation : 0) / 90);
            this._deathFireScale = 1 + t;  // 1 at start → 2 at ground
            if (this.rotation >= 90) {
                this.rotation = 90;
                this._deathFalling = false;
                this._deathFireFading = true;
            }
        } else if (this._deathFireFading) {
            // After landing: shrink from 2× back to 0 and fade alpha to 0.
            // At ~30fps the scale takes 2/0.008 = 250 frames ≈ 8.3s,
            // ensuring at least 5s of visible fire after death.
            this._deathFireScale = Math.max(0, (this._deathFireScale || 0) - 0.008);
            this._deathFireAlpha = Math.max(0, (this._deathFireAlpha || 0) - 0.005);
            if (this._deathFireScale <= 0 || this._deathFireAlpha <= 0) {
                this._deathFireScale = 0;
                this._deathFireAlpha = 0;
                this._deathFireFading = false;
                // Extinguish
                this.isOnFire = false;
                this._removeFireSprite();
            }
        }
    }

    /**
     * Override the depth billboard mesh update so that instead of the instant
     * center-mirror flip that Animal applies to dead creatures, Blodia's quad
     * rotates in screen space around the bottom-center pivot (i.e. around the
     * camera's look axis), then converts back to world coordinates.
     * This preserves the billboard's shape throughout the fall.
     */
    updateDepthBillboardMesh(ctx, camera, options) {
        // Run the base StaticObject logic (builds/positions the upright quad).
        const interpolated = this.getInterpolatedPosition();
        const savedX = this.x, savedY = this.y, savedZ = this.z;
        this.x = interpolated.x;
        this.y = interpolated.y;
        this.z = interpolated.z;

        // Force the base code to always recompute the upright quad positions
        // when dead so our rotation doesn't compound on already-rotated verts.
        if (this.dead) {
            this._depthBillboardLastSignature = "";
        }

        const staticProto = (typeof globalThis.StaticObject === "function" && globalThis.StaticObject.prototype)
            ? globalThis.StaticObject.prototype
            : null;
        let result = null;
        if (staticProto && typeof staticProto.updateDepthBillboardMesh === "function") {
            result = staticProto.updateDepthBillboardMesh.call(this, ctx, camera, options);
        }

        // Rotate the entire quad in screen space around the bottom-center pivot,
        // then project back to world coords so the billboard keeps its shape.
        if (this.dead && result && this._depthBillboardWorldPositions && this._depthBillboardWorldPositions.length >= 12) {
            const positions = this._depthBillboardWorldPositions;
            const vs = Math.max(1e-6, Math.abs(Number(camera.viewscale) || 1));
            const xyr = Math.max(1e-6, Math.abs(Number(camera.xyratio) || 0.66));
            const camX = Number(camera.x) || 0;
            const camY = Number(camera.y) || 0;
            const wY = positions[1]; // worldY (same for all 4 verts in a visual billboard)

            // 1) World → screen for each vertex: BL[0], BR[1], TR[2], TL[3]
            const sv = [];
            for (let i = 0; i < 12; i += 3) {
                sv.push({
                    sx: (positions[i] - camX) * vs,
                    sy: (wY - camY - positions[i + 2]) * vs * xyr
                });
            }

            // 2) Pivot = bottom-center (midpoint of BL and BR)
            const px = (sv[0].sx + sv[1].sx) / 2;
            const py = (sv[0].sy + sv[1].sy) / 2;

            // 3) Rotate all 4 verts around pivot by this.rotation degrees
            const rotRad = (Number.isFinite(this.rotation) ? this.rotation : 0) * (Math.PI / 180);
            const cosR = Math.cos(rotRad);
            const sinR = Math.sin(rotRad);
            for (let i = 0; i < 4; i++) {
                const dx = sv[i].sx - px;
                const dy = sv[i].sy - py;
                sv[i].sx = px + dx * cosR - dy * sinR;
                sv[i].sy = py + dx * sinR + dy * cosR;
            }

            // 4) Screen → world (keep worldY unchanged, solve for worldX and worldZ)
            for (let i = 0; i < 4; i++) {
                positions[i * 3]     = sv[i].sx / vs + camX;                          // worldX
                positions[i * 3 + 1] = wY;                                            // worldY
                positions[i * 3 + 2] = wY - camY - sv[i].sy / (vs * xyr);            // worldZ
            }

            // Force GPU buffer update
            const worldBuffer = result.geometry && typeof result.geometry.getBuffer === "function"
                ? result.geometry.getBuffer("aWorldPosition")
                : null;
            if (worldBuffer && typeof worldBuffer.update === "function") {
                worldBuffer.update();
            }
            // Prevent the base Animal code from re-applying
            this._deadDepthFlipSignature = this._depthBillboardLastSignature;
        }

        this.x = savedX;
        this.y = savedY;
        this.z = savedZ;
        return result;
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
        this.chaseRadius = this.scaledChaseRadius(9);
        this.attackVerb = "mauls";
        this.damage = 50;
        this.foodValue = Math.floor(400 * size);
        this.hp = 40 * size;
        this.spriteSheetReady = false;
        ensureSpriteFrames(this);
    }
}
