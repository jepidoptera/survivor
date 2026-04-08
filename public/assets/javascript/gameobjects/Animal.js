class Animal extends Character {
    static FIRE_TEXTURE_PATH = "/assets/images/magic/fire.png";
    static FIRE_FRAME_COUNT_X = 5;
    static FIRE_FRAME_COUNT_Y = 5;
    static FIRE_FPS = 12;
    static _fireFramesCache = null;
    static METADATA_CATEGORY = "animals";

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
        this.ensureMagicPointsInitialized(true);
        this.randomMotion = 1;
        this.lungeRadius = 2;
        this.lungeSpeed = 5.0;
        this.attackCooldown = 1.5;
        this.attackAnimationHoldMs = 250;
        this.secondsPerAttack = 2;
        this.strikeRange = 0.8;
        this.retreatThreshold = 0.25;
        this.retreatDuration = 2;
        this.retreatDistanceCap = 2;
        this.preferAttackAStar = true;
        this.preferRetreatAStar = true;
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
        this.fleeRepathMs = 400;
        this.aggroDurationMs = 0;
        this.disengageRadius = 20;
        this._aggroUntilMs = 0;
        this._lastPursuitPathMs = 0;
        this._lastFleePathMs = 0;
        this._skipNextRetreatOnce = false;
        this._corneredAttackPending = false;
        this._retreatOrigin = null;
        this._retreatThreatPoint = null;
        this._retreatDestinationPoint = null;
        this._retreatThreatDistanceBaseline = null;
        this._lastRetreatBudgetRefreshMs = 0;
        this._attackAnimationHoldUntilMs = 0;
        this._playerVisibleLastAiTick = false;
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

        this._animalMetadata = null;
        this._animalMetadataPromise = null;
        this.texturePath = this.resolveAnimalTexturePath();
        this.loadAnimalMetadata();
    }

    resolveAnimalTexturePath() {
        const normalizePath = (typeof globalThis.normalizeTexturePathForMetadata === "function")
            ? globalThis.normalizeTexturePathForMetadata
            : (value => value);
        const spriteTexture = this.pixiSprite && this.pixiSprite.texture;
        const baseTexture = spriteTexture && spriteTexture.baseTexture;
        const resource = baseTexture && baseTexture.resource;
        const resourceUrl = resource && typeof resource.url === "string"
            ? normalizePath(resource.url)
            : "";
        if (resourceUrl) return resourceUrl;

        const animalTypes = (typeof globalThis.SpawnAnimal !== "undefined" && Array.isArray(globalThis.SpawnAnimal.ANIMAL_TYPES))
            ? globalThis.SpawnAnimal.ANIMAL_TYPES
            : [];
        const typeDef = animalTypes.find(entry => entry && entry.name === this.type);
        if (typeDef && typeof typeDef.icon === "string" && typeDef.icon.length > 0) {
            return normalizePath(typeDef.icon);
        }
        return normalizePath(`/assets/images/animals/${encodeURIComponent(this.type || "squirrel")}.png`);
    }

    loadAnimalMetadata() {
        if (this._animalMetadataPromise || !(typeof globalThis.getResolvedPlaceableMetadata === "function")) {
            return this._animalMetadataPromise;
        }
        this._animalMetadataPromise = globalThis.getResolvedPlaceableMetadata(
            Animal.METADATA_CATEGORY,
            this.texturePath || this.resolveAnimalTexturePath()
        )
            .then(meta => {
                if (!meta || typeof meta !== "object") return null;
                this._animalMetadata = meta;
                this.applyMetadataDimensions();
                if (meta.anchor && typeof meta.anchor === "object" && this.pixiSprite && this.pixiSprite.anchor) {
                    const ax = Number.isFinite(meta.anchor.x) ? Number(meta.anchor.x) : this.pixiSprite.anchor.x;
                    const ay = Number.isFinite(meta.anchor.y) ? Number(meta.anchor.y) : this.pixiSprite.anchor.y;
                    this.pixiSprite.anchor.set(ax, ay);
                }
                this.updateHitboxes();
                return meta;
            })
            .catch(() => null);
        return this._animalMetadataPromise;
    }

    applyMetadataDimensions() {
        const metadata = this._animalMetadata;
        if (!metadata || typeof metadata !== "object") return false;
        const metaWidth = Number.isFinite(metadata.width) ? Number(metadata.width) : null;
        const metaHeight = Number.isFinite(metadata.height) ? Number(metadata.height) : null;
        if (!(metaWidth > 0) || !(metaHeight > 0) || !(Number.isFinite(this.size) && this.size > 0)) {
            return false;
        }

        // Keep `size` as the creature's overall scale while letting metadata
        // control the rendered proportions relative to that scale.
        this.width = this.size * (metaWidth / metaHeight);
        this.height = this.size;
        return true;
    }

    cloneHitbox(hitbox) {
        if (!hitbox) return null;
        if (hitbox instanceof CircleHitbox) {
            return new CircleHitbox(hitbox.x, hitbox.y, hitbox.radius);
        }
        if (hitbox instanceof PolygonHitbox && Array.isArray(hitbox.points)) {
            return new PolygonHitbox(hitbox.points.map(point => ({ x: point.x, y: point.y })));
        }
        if (
            hitbox.type === "circle" &&
            Number.isFinite(hitbox.x) &&
            Number.isFinite(hitbox.y) &&
            Number.isFinite(hitbox.radius)
        ) {
            return new CircleHitbox(hitbox.x, hitbox.y, hitbox.radius);
        }
        if (Array.isArray(hitbox.points)) {
            return new PolygonHitbox(hitbox.points.map(point => ({ x: point.x, y: point.y })));
        }
        return null;
    }

    inferHitboxRadius(hitbox, fallbackRadius) {
        if (hitbox instanceof CircleHitbox || (hitbox && hitbox.type === "circle" && Number.isFinite(hitbox.radius))) {
            return Math.max(0.01, Number(hitbox.radius));
        }
        const points = Array.isArray(hitbox && hitbox.points) ? hitbox.points : null;
        if (!points || points.length === 0) return Math.max(0.01, Number(fallbackRadius) || 0.01);
        let maxDistance = 0;
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
            maxDistance = Math.max(maxDistance, Math.hypot(point.x - this.x, point.y - this.y));
        }
        return Math.max(0.01, maxDistance || Number(fallbackRadius) || 0.01);
    }

    updateHitboxes() {
        const baseGroundRadius = Number.isFinite(this.groundRadius) ? Number(this.groundRadius) : (this.size / 3);
        const baseVisualRadius = Number.isFinite(this.visualRadius) ? Number(this.visualRadius) : baseGroundRadius;
        const metadata = this._animalMetadata;
        const buildHitbox = (typeof globalThis.buildHitboxFromSpec === "function")
            ? globalThis.buildHitboxFromSpec
            : null;
        const resolveScaleContext = (typeof globalThis.resolveHitboxScaleContext === "function")
            ? globalThis.resolveHitboxScaleContext
            : null;

        if (metadata && buildHitbox && resolveScaleContext) {
            const baseWidth = Number.isFinite(metadata.hitboxBaseWidth)
                ? Number(metadata.hitboxBaseWidth)
                : (Number.isFinite(metadata.width) ? Number(metadata.width) : (Number.isFinite(this.width) ? Number(this.width) : 1));
            const baseHeight = Number.isFinite(metadata.hitboxBaseHeight)
                ? Number(metadata.hitboxBaseHeight)
                : (Number.isFinite(metadata.height) ? Number(metadata.height) : (Number.isFinite(this.height) ? Number(this.height) : 1));
            const groundSpec = (metadata.groundPlaneHitbox && typeof metadata.groundPlaneHitbox === "object")
                ? metadata.groundPlaneHitbox
                : {};
            const hasVisualSpec = Object.prototype.hasOwnProperty.call(metadata, "visualHitbox");
            const visualSpec = hasVisualSpec ? metadata.visualHitbox : null;

            const groundScaleContext = resolveScaleContext(groundSpec, this, baseWidth, baseHeight);
            const builtGroundHitbox = buildHitbox(groundSpec, this, baseGroundRadius, groundScaleContext);
            this.groundPlaneHitbox = builtGroundHitbox || new CircleHitbox(this.x, this.y, baseGroundRadius);

            if (hasVisualSpec) {
                const visualScaleContext = resolveScaleContext(visualSpec, this, baseWidth, baseHeight);
                this.visualHitbox = buildHitbox(visualSpec, this, baseVisualRadius, visualScaleContext) || this.cloneHitbox(this.groundPlaneHitbox);
            } else {
                this.visualHitbox = this.cloneHitbox(this.groundPlaneHitbox);
            }
        } else {
            if (this.groundPlaneHitbox && this.groundPlaneHitbox.type === "circle") {
                this.groundPlaneHitbox.x = this.x;
                this.groundPlaneHitbox.y = this.y;
                this.groundPlaneHitbox.radius = baseGroundRadius;
            } else {
                this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, baseGroundRadius);
            }
            this.visualHitbox = this.cloneHitbox(this.groundPlaneHitbox);
        }

        this.groundRadius = this.inferHitboxRadius(this.groundPlaneHitbox, baseGroundRadius);
        this.visualRadius = this.inferHitboxRadius(this.visualHitbox, this.groundRadius);
        this.radius = this.groundRadius;
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

    _getLocalWrappedDelta(fromX, fromY, toX, toY) {
        return {
            x: (this.map && typeof this.map.shortestDeltaX === "function")
                ? this.map.shortestDeltaX(fromX, toX)
                : (toX - fromX),
            y: (this.map && typeof this.map.shortestDeltaY === "function")
                ? this.map.shortestDeltaY(fromY, toY)
                : (toY - fromY)
        };
    }

    _distanceFromPointToLocalSegment(point, segStart, segEnd) {
        const segDx = segEnd.x - segStart.x;
        const segDy = segEnd.y - segStart.y;
        const segLenSq = segDx * segDx + segDy * segDy;
        if (segLenSq <= 1e-9) {
            return Math.hypot(point.x - segStart.x, point.y - segStart.y);
        }
        const t = Math.max(
            0,
            Math.min(
                1,
                ((point.x - segStart.x) * segDx + (point.y - segStart.y) * segDy) / segLenSq
            )
        );
        const closestX = segStart.x + segDx * t;
        const closestY = segStart.y + segDy * t;
        return Math.hypot(point.x - closestX, point.y - closestY);
    }

    isTargetWithinStrikeContact(target) {
        if (!target || target.gone || target.dead) return false;

        const strikeDistance = this.getStrikeDistance(target);
        if (!Number.isFinite(strikeDistance) || strikeDistance < 0) return false;

        const ownHitbox = this.groundPlaneHitbox || this.visualHitbox || null;
        const targetHitbox = target.groundPlaneHitbox || target.visualHitbox || null;
        if (
            ownHitbox &&
            targetHitbox &&
            typeof ownHitbox.intersects === "function" &&
            ownHitbox.intersects(targetHitbox)
        ) {
            return true;
        }

        const targetPositions = [{ x: target.x, y: target.y }];
        if (
            Number.isFinite(target.prevX) &&
            Number.isFinite(target.prevY) &&
            (Math.abs(target.prevX - target.x) > 1e-6 || Math.abs(target.prevY - target.y) > 1e-6)
        ) {
            targetPositions.push({ x: Number(target.prevX), y: Number(target.prevY) });
        }

        for (let i = 0; i < targetPositions.length; i++) {
            const pos = targetPositions[i];
            if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;

            const currentDelta = this._getLocalWrappedDelta(this.x, this.y, pos.x, pos.y);
            if (Math.hypot(currentDelta.x, currentDelta.y) <= strikeDistance) {
                return true;
            }

            if (Number.isFinite(this.prevX) && Number.isFinite(this.prevY)) {
                const prevLocal = this._getLocalWrappedDelta(this.x, this.y, this.prevX, this.prevY);
                const targetLocal = currentDelta;
                const sweptDistance = this._distanceFromPointToLocalSegment(
                    targetLocal,
                    prevLocal,
                    { x: 0, y: 0 }
                );
                if (sweptDistance <= strikeDistance) {
                    return true;
                }
            }
        }

        return false;
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
        return super.ensureMagicPointsInitialized(resetCurrent);
    }
    vanishFromMagicDepletion() {
        if (this.gone || this.vanishing || this.dead) return false;
        if (typeof this.triggerVanishDieEventIfAdventureMode === "function") {
            this.triggerVanishDieEventIfAdventureMode({ cause: "vanish" });
        }
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
    getAdditionalSpriteRotationDegrees() {
        return 0;
    }
    rotateDepthBillboardQuadInScreenSpace(result, camera, rotationDeg) {
        if (!result || !camera || !this._depthBillboardWorldPositions || this._depthBillboardWorldPositions.length < 12) {
            return false;
        }
        const rotation = Number(rotationDeg);
        if (!Number.isFinite(rotation) || Math.abs(rotation) <= 1e-4) {
            return false;
        }

        const positions = this._depthBillboardWorldPositions;
        const vs = Math.max(1e-6, Math.abs(Number(camera.viewscale) || 1));
        const xyr = Math.max(1e-6, Math.abs(Number(camera.xyratio) || 0.66));
        const camX = Number(camera.x) || 0;
        const camY = Number(camera.y) || 0;
        const wY = positions[1];

        const sv = [];
        for (let i = 0; i < 12; i += 3) {
            sv.push({
                sx: (positions[i] - camX) * vs,
                sy: (wY - camY - positions[i + 2]) * vs * xyr
            });
        }

        const px = (sv[0].sx + sv[1].sx) / 2;
        const py = (sv[0].sy + sv[1].sy) / 2;
        const rotRad = rotation * (Math.PI / 180);
        const cosR = Math.cos(rotRad);
        const sinR = Math.sin(rotRad);
        for (let i = 0; i < 4; i++) {
            const dx = sv[i].sx - px;
            const dy = sv[i].sy - py;
            sv[i].sx = px + dx * cosR - dy * sinR;
            sv[i].sy = py + dx * sinR + dy * cosR;
        }

        for (let i = 0; i < 4; i++) {
            positions[i * 3] = sv[i].sx / vs + camX;
            positions[i * 3 + 1] = wY;
            positions[i * 3 + 2] = wY - camY - sv[i].sy / (vs * xyr);
        }

        const worldBuffer = result.geometry && typeof result.geometry.getBuffer === "function"
            ? result.geometry.getBuffer("aWorldPosition")
            : null;
        if (worldBuffer && typeof worldBuffer.update === "function") {
            worldBuffer.update();
        }
        return true;
    }
    getDirectionRow() {
        const activeDirection = this.spriteDirectionLock || this.direction;
        if (!activeDirection) return 0;
        if ((this.spriteRows || 1) >= 4) {
            const dx = Number(activeDirection.x) || 0;
            const dy = Number(activeDirection.y) || 0;
            if (Math.abs(dy) > Math.abs(dx)) {
                return dy < 0 ? 3 : 0;
            }
            return dx < 0 ? 1 : 2;
        }
        return (activeDirection.x > 0 || (activeDirection.x === 0 && activeDirection.y > 0)) ? 1 : 0;
    }
    getCurrentSpriteFrameKey() {
        if (!this.spriteSheet || !Array.isArray(this.spriteSheet.frameKeys)) return null;
        const rows = Math.max(1, Number(this.spriteRows) || Number(this.spriteSheet.rows) || 1);
        const cols = Math.max(1, Number(this.spriteCols) || Number(this.spriteSheet.cols) || 1);
        const rowIndex = typeof this.getDirectionRow === "function" ? this.getDirectionRow() : 0;
        const safeRow = Math.max(0, Math.min(rowIndex, rows - 1));
        const safeCol = Math.max(0, Math.min(Number(this.spriteCol) || 0, cols - 1));
        const frameIndex = safeRow * cols + safeCol;
        const frameKey = this.spriteSheet.frameKeys[frameIndex];
        return (typeof frameKey === "string" && frameKey.length > 0) ? frameKey : null;
    }
    getSpriteFrameScale(frameKey = null) {
        const key = (typeof frameKey === "string" && frameKey.length > 0)
            ? frameKey
            : this.getCurrentSpriteFrameKey();
        const frameScales = (this.spriteSheet && this.spriteSheet.frameScales && typeof this.spriteSheet.frameScales === "object")
            ? this.spriteSheet.frameScales
            : null;
        const scaleSpec = (frameScales && key)
            ? frameScales[key]
            : null;
        if (Number.isFinite(scaleSpec) && scaleSpec > 0) {
            return { width: Number(scaleSpec), height: Number(scaleSpec) };
        }
        const width = scaleSpec && Number.isFinite(scaleSpec.width) && scaleSpec.width > 0
            ? Number(scaleSpec.width)
            : 1;
        const height = scaleSpec && Number.isFinite(scaleSpec.height) && scaleSpec.height > 0
            ? Number(scaleSpec.height)
            : 1;
        return { width, height };
    }
    hasAttackAnimation() {
        if (this.spriteSheet && Array.isArray(this.spriteSheet.frameKeys)) {
            return this.spriteSheet.frameKeys.some(key => typeof key === "string" && key.indexOf("attack") >= 0);
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
    getRetreatDurationMs() {
        return Math.max(
            0,
            (Number.isFinite(this.secondsPerAttack) ? Number(this.secondsPerAttack) : 2) * 1000
        );
    }
    getRetreatDistanceCap() {
        return Math.max(
            0,
            Number.isFinite(this.retreatDistanceCap) ? Number(this.retreatDistanceCap) : 2
        );
    }
    getRetreatDistanceFromOrigin() {
        const origin = this._retreatOrigin;
        if (!origin) return 0;
        if (this.map && typeof this.map.distanceBetweenPoints === "function") {
            return this.map.distanceBetweenPoints(origin.x, origin.y, this.x, this.y);
        }
        return Math.hypot(this.x - origin.x, this.y - origin.y);
    }
    getRemainingRetreatDistanceBudget() {
        return Math.max(0, this.getRetreatDistanceCap() - this.getRetreatDistanceFromOrigin());
    }
    getRetreatThreatDistance(threatPoint = null) {
        const point = threatPoint || this._retreatThreatPoint;
        if (!point) return Infinity;
        if (this.map && typeof this.map.distanceBetweenPoints === "function") {
            return this.map.distanceBetweenPoints(this.x, this.y, point.x, point.y);
        }
        return Math.hypot(this.x - point.x, this.y - point.y);
    }
    maybeRefreshRetreatBudget(target, now = Date.now()) {
        if (!target || this.attackState !== "retreat") return false;
        if (!this.onScreen) return false;
        if ((now - (this._lastRetreatBudgetRefreshMs || 0)) < 1000) return false;

        this._lastRetreatBudgetRefreshMs = now;
        const threatPoint = { x: target.x, y: target.y };
        const currentThreatDistance = this.getRetreatThreatDistance(threatPoint);
        if (!Number.isFinite(currentThreatDistance)) return false;

        if (!Number.isFinite(this._retreatThreatDistanceBaseline)) {
            this._retreatThreatDistanceBaseline = currentThreatDistance;
            this._retreatThreatPoint = threatPoint;
            return false;
        }

        if (currentThreatDistance >= (this._retreatThreatDistanceBaseline - 1e-6)) {
            this._retreatThreatPoint = threatPoint;
            return false;
        }

        this._retreatOrigin = { x: this.x, y: this.y };
        this._retreatThreatPoint = threatPoint;
        this._retreatThreatDistanceBaseline = currentThreatDistance;
        this._retreatDestinationPoint = null;
        return true;
    }
    hasRetreatMovementPlanned() {
        return (
            (Number.isFinite(this.travelFrames) && this.travelFrames > 0) ||
            (Array.isArray(this.path) && this.path.length > 0) ||
            !!this.nextNode
        );
    }
    shouldEndRetreat(now = Date.now()) {
        const elapsedMs = now - (this._retreatStartMs || now);
        if (elapsedMs >= this.getRetreatDurationMs()) {
            return true;
        }
        if (this.getRetreatDistanceFromOrigin() >= this.getRetreatDistanceCap()) {
            return true;
        }
        return elapsedMs >= 100 && !this.hasRetreatMovementPlanned();
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
        const normalizedPath = Array.isArray(path) ? path.slice() : [];
        if (preserveStep && this.nextNode) {
            while (normalizedPath.length > 0 && this.getPathItemDestinationNode(normalizedPath[0]) === this.nextNode) {
                normalizedPath.shift();
            }
        }
        this.path = normalizedPath;
        this.destination = destinationNode || null;
        if (!preserveStep) {
            this.travelFrames = 0;
            this.nextNode = null;
        }
    }
    _isMidTraversalStep() {
        return !!(
            Number.isFinite(this.travelFrames) &&
            this.travelFrames > 0 &&
            this.nextNode
        );
    }
    _getPathStartNode(preserveCurrentStep = false) {
        if (this._isMidTraversalStep()) {
            if (preserveCurrentStep && this.nextNode) {
                return this.nextNode;
            }
            if (this.node) {
                return this.node;
            }
        }
        if (this.map && typeof this.map.worldToNode === "function") {
            const worldNode = this.map.worldToNode(this.x, this.y);
            if (worldNode) return worldNode;
        }
        return this.node || this.nextNode || null;
    }
    isTargetHiddenByInvisibilityAura(target) {
        if (!target || target !== wizard) return false;
        return !!(
            typeof SpellSystem !== "undefined" &&
            SpellSystem &&
            typeof SpellSystem.isPlayerInvisibleToEnemies === "function" &&
            SpellSystem.isPlayerInvisibleToEnemies(target)
        );
    }
    isActivelyInteractingWithPlayer(now = Date.now()) {
        const closeCombatTarget = this._closeCombatState && this._closeCombatState.target;
        return !!(
            this.attackTarget === wizard ||
            closeCombatTarget === wizard ||
            this._hasAggro(now) ||
            this._committedToAttack ||
            this._corneredAttackPending
        );
    }
    hasAttackLineOfSight(target, startNode = null) {
        if (this.isTargetHiddenByInvisibilityAura(target)) return false;
        if (!target || !this.map || typeof this.map.worldToNode !== "function") return true;
        if (typeof this.map.hasLineOfSight !== "function") return true;
        const originNode = startNode || this._getPathStartNode();
        const targetNode = this.map.worldToNode(target.x, target.y);
        if (!originNode || !targetNode) return true;
        return !!this.map.hasLineOfSight(originNode, targetNode);
    }
    clearCloseCombatOnLostLineOfSight(target, startNode = null, reason = "line-of-sight-lost") {
        const hasLOS = this.hasAttackLineOfSight(target, startNode);
        if (!hasLOS && this._closeCombatState && this._closeCombatState.target === target) {
            this.resetCloseCombatState(reason);
        }
        return hasLOS;
    }
    resetAttackState() {
        this.resetCloseCombatState();
        this.attackState = "idle";
        this.attackTarget = null;
        this.attacking = false;
        this.spriteDirectionLock = null;
        this._committedToAttack = false;
        this._lungeStartMs = undefined;
        this._retreatStartMs = undefined;
        this._attackAStarDisabled = false;
        this._retreatOrigin = null;
        this._retreatThreatPoint = null;
        this._retreatDestinationPoint = null;
        this._retreatThreatDistanceBaseline = null;
        this._lastRetreatBudgetRefreshMs = 0;
        this._attackAnimationHoldUntilMs = 0;
        this._skipNextRetreatOnce = false;
        this._corneredAttackPending = false;
        if (this.spriteCols > 1) this.spriteCol = 0;
    }
    onCloseCombatStateUpdated(state, target, _options = {}) {
        if (!state || !target) return;
        this.attackTarget = target;
        this.attacking = true;

        const targetVector = {
            x: (this.map && typeof this.map.shortestDeltaX === "function")
                ? this.map.shortestDeltaX(this.x, target.x)
                : (target.x - this.x),
            y: (this.map && typeof this.map.shortestDeltaY === "function")
                ? this.map.shortestDeltaY(this.y, target.y)
                : (target.y - this.y)
        };
        const targetVectorLen = Math.hypot(targetVector.x, targetVector.y);
        if (targetVectorLen > 1e-6) {
            this.direction = targetVector;
        }

        if (state.phase === "approach") {
            this.attackState = "approach";
            this.spriteDirectionLock = null;
            if (this.spriteCols > 1) this.spriteCol = 0;
            return;
        }

        if (state.phase === "lunge") {
            this.attackState = "lunge";
            this.spriteDirectionLock = null;
            if (this.hasAttackAnimation()) this.spriteCol = 1;
            else if (this.spriteCols > 1) this.spriteCol = 0;
            return;
        }

        this.attackState = "close_backoff";
        this.spriteDirectionLock = targetVectorLen > 1e-6
            ? { x: targetVector.x, y: targetVector.y }
            : this.spriteDirectionLock;
        this.updateRetreatAttackAnimation(Date.now());
    }
    updateRetreatAttackAnimation(now = Date.now()) {
        if (!this.hasAttackAnimation() || this.spriteCols <= 1) return;
        const holdUntil = Number(this._attackAnimationHoldUntilMs) || 0;
        this.spriteCol = now < holdUntil ? 1 : 0;
    }
    getThreatDistanceFromNode(node, threatPoint) {
        if (!node || !threatPoint) return Infinity;
        if (this.map && typeof this.map.distanceBetweenPoints === "function") {
            return this.map.distanceBetweenPoints(node.x, node.y, threatPoint.x, threatPoint.y);
        }
        return Math.hypot(node.x - threatPoint.x, node.y - threatPoint.y);
    }
    shouldAttackInsteadOfRetreat(target, route, startNode) {
        if (!target || this.isKnockableObstacle(target)) return false;
        if (!route || !Array.isArray(route.path) || route.path.length === 0) return false;
        if (!startNode || !this.map || typeof this.map.worldToNode !== "function") return false;

        const firstStep = this.getPathItemDestinationNode(route.path[0]);
        if (!firstStep || firstStep === startNode) return false;

        const targetNode = this.map.worldToNode(target.x, target.y);
        if (!targetNode) return false;
        if (typeof this.map.hasLineOfSight === "function" && !this.map.hasLineOfSight(startNode, targetNode)) {
            return false;
        }

        const currentDistance = this.getThreatDistanceFromNode(startNode, target);
        const firstStepDistance = this.getThreatDistanceFromNode(firstStep, target);
        return Number.isFinite(currentDistance) &&
            Number.isFinite(firstStepDistance) &&
            firstStepDistance < (currentDistance - 1e-6);
    }
    commitCorneredAttack(target) {
        if (!target) return false;

        this._skipNextRetreatOnce = true;
        this._corneredAttackPending = true;
        this.attackState = "idle";
        this.attackTarget = null;
        this.attacking = false;
        this.path = [];
        this.destination = null;
        this.nextNode = null;
        this.travelFrames = 0;
        this.travelX = 0;
        this.travelY = 0;
        this._retreatOrigin = null;
        this._retreatThreatPoint = null;
        this._retreatDestinationPoint = null;
        this._retreatThreatDistanceBaseline = null;
        this._lastRetreatBudgetRefreshMs = 0;
        this._retreatStartMs = undefined;
        this._attackAnimationHoldUntilMs = 0;
        this.spriteDirectionLock = null;
        this._committedToAttack = true;
        if (this.spriteCols > 1) this.spriteCol = 0;

        this.attack(target);
        return true;
    }
    getRetreatRoute(threatPoint, originPoint, retreatDistance, options = {}) {
        if (!threatPoint || !this.map || typeof this.map.worldToNode !== "function") return null;

        const startNode = options.startNode || this._getPathStartNode(options.preserveCurrentStep === true);
        if (!startNode) return null;

        const maxRetreatDistance = Number.isFinite(retreatDistance)
            ? Math.max(0, Number(retreatDistance))
            : 0;

        const retreatOptions = this.buildAttackAStarPathOptions(maxRetreatDistance);
        retreatOptions.threatX = threatPoint.x;
        retreatOptions.threatY = threatPoint.y;
        const retreatPath = (typeof this.map.findRetreatPathAStar === "function")
            ? this.map.findRetreatPathAStar(startNode, threatPoint, retreatOptions)
            : null;
        if (!Array.isArray(retreatPath)) return null;

        const destinationNode = retreatPath.length > 0
            ? this.getPathItemDestinationNode(retreatPath[retreatPath.length - 1])
            : startNode;
        return {
            path: retreatPath,
            destinationNode,
            destinationPoint: destinationNode
                ? { x: destinationNode.x, y: destinationNode.y }
                : (originPoint || { x: this.x, y: this.y }),
            source: "retreatAStar"
        };
    }
    _cancelCurrentTraversalAndSnapToNode(reason = "retreat-repath") {
        this.travelFrames = 0;
        this.travelX = 0;
        this.travelY = 0;
        this.nextNode = null;

        let snappedNode = this.node || null;
        if (this.map && typeof this.map.worldToNode === "function") {
            snappedNode = this.map.worldToNode(this.x, this.y) || snappedNode;
        }
        if (snappedNode) {
            this.node = snappedNode;
            this.x = snappedNode.x;
            this.y = snappedNode.y;
            this.prevX = this.x;
            this.prevY = this.y;
            this.prevZ = this.z;
            this._recordVisitedNode(snappedNode, reason);
        }
        this.updateHitboxes();
        return snappedNode;
    }
    _canPreserveRetreatStep() {
        if (
            !this._isMidTraversalStep() ||
            !this.node ||
            !this.nextNode ||
            !this.map ||
            typeof this.map.getTraversalInfo !== "function"
        ) {
            return false;
        }
        const directionIndex = Array.isArray(this.node.neighbors)
            ? this.node.neighbors.indexOf(this.nextNode)
            : -1;
        if (directionIndex < 0) return false;

        const retreatOptions = this.buildAttackAStarPathOptions(this.getRemainingRetreatDistanceBudget());
        const traversal = this.map.getTraversalInfo(this.node, directionIndex, {
            requiredClearance: retreatOptions.clearance,
            knockableTraversalCost: retreatOptions.knockableTraversalCost,
            canTraverseObject: retreatOptions.canTraverseObject,
            clearanceReferenceNode: this.node
        });
        return !!(traversal && traversal.allowed && traversal.neighborNode === this.nextNode);
    }
    setRetreatDestination(target) {
        const origin = this._retreatOrigin || { x: this.x, y: this.y };
        const threatPoint = target
            ? { x: target.x, y: target.y }
            : this._retreatThreatPoint;
        if (!threatPoint || !this.map || typeof this.map.worldToNode !== "function") return;
        let preserveStep = false;
        let startNode = null;

        if (this._isMidTraversalStep()) {
            preserveStep = this._canPreserveRetreatStep();
            if (!preserveStep) {
                startNode = this._cancelCurrentTraversalAndSnapToNode();
            }
        }
        if (!startNode) {
            startNode = this._getPathStartNode(preserveStep);
        }
        if (!startNode) return;

        this._retreatThreatPoint = threatPoint;
        if (!Number.isFinite(this._retreatThreatDistanceBaseline)) {
            this._retreatThreatDistanceBaseline = this.getRetreatThreatDistance(threatPoint);
        }

        const retreatRoute = this.getRetreatRoute(
            threatPoint,
            origin,
            this.getRemainingRetreatDistanceBudget(),
            {
                preserveCurrentStep: preserveStep,
                startNode
            }
        );
        if (!retreatRoute) return;
        if (this.shouldAttackInsteadOfRetreat(target, retreatRoute, startNode)) {
            this.commitCorneredAttack(target);
            return;
        }

        this._retreatDestinationPoint = retreatRoute.destinationPoint;
        this._applyPursuitPath(retreatRoute.path, retreatRoute.destinationNode, preserveStep);
    }
    beginRetreat(target, options = null) {
        if (this._skipNextRetreatOnce) {
            this._skipNextRetreatOnce = false;
            this._corneredAttackPending = false;
            this._committedToAttack = true;
            return false;
        }
        this.resetCloseCombatState();
        this.attackState = "retreat";
        this.attacking = true;
        this.speed = this.walkSpeed;
        this._lungeStartMs = undefined;
        this._retreatStartMs = Date.now();
        this._retreatOrigin = { x: this.x, y: this.y };
        this._retreatThreatPoint = target
            ? { x: target.x, y: target.y }
            : null;
        this._retreatDestinationPoint = null;
        this._retreatThreatDistanceBaseline = this.getRetreatThreatDistance(this._retreatThreatPoint);
        this._lastRetreatBudgetRefreshMs = 0;
        this.spriteDirectionLock = this.direction
            ? { x: this.direction.x, y: this.direction.y }
            : this.spriteDirectionLock;
        const holdAttackAnimation = !!(options && options.holdAttackAnimation);
        const holdMs = holdAttackAnimation
            ? Math.max(0, Number.isFinite(this.attackAnimationHoldMs) ? Number(this.attackAnimationHoldMs) : 250)
            : 0;
        this._attackAnimationHoldUntilMs = holdMs > 0 ? (Date.now() + holdMs) : 0;
        this.updateRetreatAttackAnimation();
        this.setRetreatDestination(target);
        return this.attackState === "retreat";
    }
    updatePursuitDestination(target) {
        if (!target) return;
        const now = Date.now();
        const targetNode = this.map.worldToNode(target.x, target.y);
        if (!targetNode) return;
        const preserveStep = this._isMidTraversalStep();

        const startNode = this._getPathStartNode(preserveStep);
        if (!startNode) return;
        const repathInterval = Number.isFinite(this.pursuitRepathMs) ? Math.max(0, this.pursuitRepathMs) : 0;
        const repathDue = (now - (this._lastPursuitPathMs || 0)) >= repathInterval;
        const destinationChanged = this.destination !== targetNode;
        const pathEmpty = !Array.isArray(this.path) || this.path.length === 0;
        const betweenMoves = this.travelFrames === 0 || !this.moving;
        if (!destinationChanged && !pathEmpty && !repathDue) return;
        if (!betweenMoves && !pathEmpty && !destinationChanged && !repathDue) return;

        const route = this.getCombatRouteToTarget(target, {
            startNode,
            targetNode,
            preserveCurrentStep: preserveStep
        });
        const path = route ? route.path : null;
        this._lastPursuitPathMs = now;
        this._applyPursuitPath(path, targetNode, preserveStep);
    }

    getCombatRouteToTarget(target, options = {}) {
        if (!target || !this.map) return null;

        const startNode = options.startNode || this._getPathStartNode(options.preserveCurrentStep === true);
        const targetNode = options.targetNode || (this.map.worldToNode ? this.map.worldToNode(target.x, target.y) : null);
        if (!startNode || !targetNode) return null;

        const maxPathLength = Object.prototype.hasOwnProperty.call(options, "maxPathLength")
            ? options.maxPathLength
            : ((Number.isFinite(this.chaseRadius) && this.chaseRadius > 0) ? this.chaseRadius * 2 : null);
        const allowBlockedDestination = options.allowBlockedDestination === true;
        const straightLineTargetDist = this.distanceToPoint(target.x, target.y);
        let path = null;
        let source = "none";
        let aStarPath = null;

        const canUseAttackAStar = (
            typeof this.map.findPathAStar === "function" &&
            this.preferAttackAStar !== false &&
            !this._attackAStarDisabled
        );
        if (canUseAttackAStar) {
            const aStarOptions = this.buildAttackAStarPathOptions(maxPathLength);
            if (allowBlockedDestination) {
                aStarOptions.allowBlockedDestination = true;
            }
            aStarPath = this.map.findPathAStar(startNode, targetNode, aStarOptions);
            if (Array.isArray(aStarPath)) {
                path = aStarPath;
                source = "aStar";
            } else if (
                Number.isFinite(maxPathLength) &&
                Number.isFinite(straightLineTargetDist) &&
                straightLineTargetDist > maxPathLength
            ) {
                this._attackAStarDisabled = true;
            }
        }

        if (!Array.isArray(path)) {
            const pathOptions = this.buildTraversalPathOptions();
            if (allowBlockedDestination) {
                pathOptions.allowBlockedDestination = true;
            }
            path = this.map.findPath(startNode, targetNode, pathOptions);
            if (Array.isArray(path)) {
                source = "findPath";
            }
        }

        return {
            path: Array.isArray(path) ? path : [],
            source,
            startNode,
            targetNode
        };
    }

    runAiBehaviorTick() {
        if (typeof wizard === "undefined" || !wizard) {
            this._playerVisibleLastAiTick = false;
            return;
        }

        const now = Date.now();
        let playerVisibleThisTick = false;
        if (Number.isFinite(this._pauseUntilMs) && now < this._pauseUntilMs) {
            this._playerVisibleLastAiTick = false;
            return;
        }
        if (Number.isFinite(this._pauseUntilMs) && now >= this._pauseUntilMs) {
            this._pauseUntilMs = null;
            // Clean up the retreat state from the tree knock so we go straight back
            // into attack mode rather than wandering or extending the retreat.
            this.resetAttackState();
            // Stay committed to the attack regardless of chaseRadius — the animal
            // already decided to charge, it will keep knocking obstacles and pursuing.
            this._committedToAttack = true;
            // Clear the retreat path so attack() immediately issues a fresh path
            // toward the wizard rather than finishing the old retreat path first.
            this.path = [];
            this.destination = null;
            this.travelFrames = 0;
            this.nextNode = null;
            this._playerVisibleLastAiTick = false;
            this.attack(wizard);
            return;
        }

        const playerHiddenByInvisibility = this.isTargetHiddenByInvisibilityAura(wizard);
        if (playerHiddenByInvisibility && this.isActivelyInteractingWithPlayer(now)) {
            this._clearPursuit();
            this._aggroUntilMs = 0;
            this._committedToAttack = false;
            this._corneredAttackPending = false;
        }
        if (playerHiddenByInvisibility) this._playerVisibleLastAiTick = false;

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

        if (!playerHiddenByInvisibility && this.fleeRadius > 0 && this.isPointWithinRadius(wizard.x, wizard.y, this.fleeRadius)) {
            if (this._corneredAttackPending) {
                this._playerVisibleLastAiTick = false;
                this.attack(wizard);
                return;
            }
            this.resetAttackState();
            this._playerVisibleLastAiTick = false;
            this.flee();
            return;
        }

        const inChaseRadius = !playerHiddenByInvisibility && this.chaseRadius > 0 && this.isPointWithinRadius(wizard.x, wizard.y, this.chaseRadius);
        if (inChaseRadius || this._committedToAttack) {
            const alreadyAggro = this._hasAggro(now) || this.attacking || this.attackState !== "idle" || this._committedToAttack;
            const animalNode = this._getPathStartNode();
            const hasLOS = this.clearCloseCombatOnLostLineOfSight(wizard, animalNode);
            playerVisibleThisTick = !!hasLOS;

            if (playerVisibleThisTick && !this._playerVisibleLastAiTick) {
                const scriptingApi = (typeof globalThis !== "undefined" && globalThis.Scripting) ? globalThis.Scripting : null;
                if (scriptingApi && typeof scriptingApi.fireObjectScriptEvent === "function") {
                    scriptingApi.fireObjectScriptEvent(this, "seePlayer", wizard, {
                        x: Number(wizard.x),
                        y: Number(wizard.y),
                        hasLineOfSight: true
                    });
                }
            }

            if (hasLOS) {
                this._playerVisibleLastAiTick = playerVisibleThisTick;
                this._refreshAggro(now);
                this.attack(wizard);
                return;
            }

            if (alreadyAggro) {
                this._playerVisibleLastAiTick = playerVisibleThisTick;
                this._refreshAggro(now);
                this.attack(wizard);
                return;
            }
        }

        if (
            !playerHiddenByInvisibility &&
            this.chaseRadius > 0 &&
            !this._hasAggro(now) &&
            !this._committedToAttack &&
            (this.attackState !== "idle" || this.attacking)
        ) {
            this._clearPursuit();
            this._aggroUntilMs = 0;
            this._playerVisibleLastAiTick = playerVisibleThisTick;
            return;
        }

        if (
            !playerHiddenByInvisibility &&
            (this._hasAggro(now) || this._committedToAttack) &&
            (this.chaseRadius > 0 || this.attacking || this.attackState !== "idle" || this._committedToAttack)
        ) {
            if (!playerVisibleThisTick) {
                this.clearCloseCombatOnLostLineOfSight(wizard, this._getPathStartNode());
            }
            this._playerVisibleLastAiTick = playerVisibleThisTick;
            this.attack(wizard);
            return;
        }

        if (!playerHiddenByInvisibility && (this.attackState !== "idle" || this.attacking)) {
            if (this._committedToAttack || !this._shouldDisengage(wizard, now)) {
                if (!playerVisibleThisTick) {
                    this.clearCloseCombatOnLostLineOfSight(wizard, this._getPathStartNode());
                }
                this._playerVisibleLastAiTick = playerVisibleThisTick;
                this.attack(wizard);
                return;
            }
            this._clearPursuit();
            this._aggroUntilMs = 0;
            this._committedToAttack = false;
        }

        // Wander around when idle.
        this._playerVisibleLastAiTick = playerVisibleThisTick;
        if (Number.isFinite(this.x) && Number.isFinite(this.y) && !this.moving) {
            const wanderX = this.x + (Math.random() - 0.5) * 10;
            const wanderY = this.y + (Math.random() - 0.5) * 10;
            const wanderNode = this.map.worldToNode(wanderX, wanderY);
            if (wanderNode) this.goto(wanderNode);
            this.speed = this.walkSpeed;
        }
    }

    updateSeePlayerState() {
        if (typeof wizard === "undefined" || !wizard) {
            this._playerVisibleLastAiTick = false;
            return false;
        }
        if (this.isTargetHiddenByInvisibilityAura(wizard)) {
            this._playerVisibleLastAiTick = false;
            return false;
        }
        const inSenseRadius = !(this.chaseRadius > 0) || this.isPointWithinRadius(wizard.x, wizard.y, this.chaseRadius);
        if (!inSenseRadius) {
            this._playerVisibleLastAiTick = false;
            return false;
        }
        const animalNode = this._getPathStartNode();
        const wizardNode = this.map && this.map.worldToNode ? this.map.worldToNode(wizard.x, wizard.y) : null;
        const hasLOS = (animalNode && wizardNode && typeof this.map.hasLineOfSight === "function")
            ? this.map.hasLineOfSight(animalNode, wizardNode)
            : true;
        const playerVisibleThisTick = !!hasLOS;
        if (playerVisibleThisTick && !this._playerVisibleLastAiTick) {
            const scriptingApi = (typeof globalThis !== "undefined" && globalThis.Scripting) ? globalThis.Scripting : null;
            if (scriptingApi && typeof scriptingApi.fireObjectScriptEvent === "function") {
                scriptingApi.fireObjectScriptEvent(this, "seePlayer", wizard, {
                    x: Number(wizard.x),
                    y: Number(wizard.y),
                    hasLineOfSight: true
                });
            }
        }
        this._playerVisibleLastAiTick = playerVisibleThisTick;
        return playerVisibleThisTick;
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
        if (this._movementSuspendedByStreaming === true) {
            const resolvedNode = (this.map && typeof this.map.worldToNode === "function")
                ? this.map.worldToNode(this.x, this.y)
                : null;
            if (!resolvedNode) {
                this.moving = false;
                return;
            }
            this.node = resolvedNode;
            this._movementSuspendedByStreaming = false;
        }
        if (typeof this.isFrozen === "function" && this.isFrozen()) {
            if (typeof this.applyFrozenState === "function") {
                this.applyFrozenState({ clearMoveTimeout: false });
            }
            this.updateSeePlayerState();
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
        if (typeof this.isFrozen === "function" && this.isFrozen()) {
            if (typeof this.applyFrozenState === "function") {
                this.applyFrozenState({ clearMoveTimeout: false });
            }
            this.updateSeePlayerState();
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
        const now = Date.now();
        const repathInterval = Number.isFinite(this.fleeRepathMs)
            ? Math.max(0, Number(this.fleeRepathMs))
            : 0;
        const repathDue = (now - (this._lastFleePathMs || 0)) >= repathInterval;
        const hasMovementPlanned = this.hasRetreatMovementPlanned();
        if (hasMovementPlanned && !repathDue) {
            this.speed = this.runSpeed;
            return;
        }

        let preserveStep = false;
        let startNode = null;
        if (this._isMidTraversalStep()) {
            preserveStep = this._canPreserveRetreatStep();
            if (!preserveStep) {
                if (hasMovementPlanned) {
                    this.speed = this.runSpeed;
                    return;
                }
                startNode = this._cancelCurrentTraversalAndSnapToNode("flee-repath");
            }
        }
        if (!startNode) {
            startNode = this._getPathStartNode(preserveStep);
        }
        const fleeRoute = this.getRetreatRoute(
            { x: wizard.x, y: wizard.y },
            { x: this.x, y: this.y },
            10,
            {
                preserveCurrentStep: preserveStep,
                startNode
            }
        );
        if (fleeRoute) {
            if (this.shouldAttackInsteadOfRetreat(wizard, fleeRoute, startNode)) {
                this.commitCorneredAttack(wizard);
                return;
            }
            this._applyPursuitPath(fleeRoute.path, fleeRoute.destinationNode, preserveStep);
            this._lastFleePathMs = now;
        }
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

    isDoorObstacle(obj) {
        return !!(
            obj &&
            !obj.gone &&
            (
                obj.type === "door" ||
                ((typeof obj.category === "string") && obj.category.trim().toLowerCase() === "doors")
            )
        );
    }

    canTraverseObject(obj) {
        if (!obj || obj.gone) return false;
        if (obj.type !== "tree") return false;
        const knockableBySize = this.size > this.getKnockableObstacleSize(obj);
        if (!knockableBySize) return false;
        const fallenOrFalling = !!obj.falling || !((Number.isFinite(obj.hp) && obj.hp > 0));
        return fallenOrFalling;
    }

    estimateKnockableHitsToBreak(obj) {
        if (!this.isKnockableObstacle(obj)) return Infinity;
        if (obj.type === "tree") return 1;
        const hp = Math.max(0, Number(obj.hp) || 0);
        if (hp <= 0) return 0;
        const expectedDamagePerHit = Math.max(1, (Number(this.damage) || 0) * (2 / 3));
        return Math.max(1, Math.ceil(hp / expectedDamagePerHit));
    }

    getAStarKnockableTraversalCost(obj) {
        const hits = this.estimateKnockableHitsToBreak(obj);
        if (!Number.isFinite(hits)) return Infinity;
        return hits * 2;
    }

    buildAttackAStarPathOptions(maxPathLength = null) {
        const pathOpts = this.buildTraversalPathOptions();
        if (Number.isFinite(maxPathLength) && maxPathLength > 0) {
            pathOpts.maxPathLength = Number(maxPathLength);
            pathOpts.maxIterations = Math.max(100, Math.ceil(Number(maxPathLength) * 12));
        }
        pathOpts.knockableTraversalCost = (obj) => this.getAStarKnockableTraversalCost(obj);
        return pathOpts;
    }

    buildTraversalPathOptions() {
        const pathOpts = {};
        if (this.pathfindingClearance > 0) {
            pathOpts.clearance = this.pathfindingClearance;
        }
        pathOpts.returnPathSteps = true;
        pathOpts.debugOwner = this;
        pathOpts.canTraverseObject = (obj, context = null) => this.canTraverseObject(obj, context);
        return pathOpts;
    }

    buildObstaclePathOptions(maxPathLength = null) {
        const pathOpts = this.buildAttackAStarPathOptions(maxPathLength);
        pathOpts.allowBlockedDestination = true;
        return pathOpts;
    }

    getPathToObstacle(obstacle, startNode, obstacleNode) {
        if (!this.map || !startNode || !obstacleNode || !obstacle) return [];
        const maxPathLength = (Number.isFinite(this.chaseRadius) && this.chaseRadius > 0)
            ? this.chaseRadius * 2
            : null;
        const canUseAttackAStar = (
            typeof this.map.findPathAStar === "function" &&
            this.preferAttackAStar !== false &&
            !this._attackAStarDisabled
        );
        if (canUseAttackAStar) {
            const aStarPath = this.map.findPathAStar(
                startNode,
                obstacleNode,
                this.buildObstaclePathOptions(maxPathLength)
            );
            if (Array.isArray(aStarPath)) {
                return aStarPath;
            }
        }
        const pathOptions = this.buildTraversalPathOptions();
        pathOptions.allowBlockedDestination = true;
        return this.map.findPath(startNode, obstacleNode, pathOptions);
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

    getNearestKnockablePathBlocker(blockers) {
        if (!Array.isArray(blockers) || blockers.length === 0) return null;
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
            if (d < closestDist) {
                closestDist = d;
                knockableObstacle = obj;
            }
        }
        return knockableObstacle;
    }

    getPriorityBlockerFromRoute(route) {
        const blockers = (route && Array.isArray(route.path) && Array.isArray(route.path.blockers))
            ? route.path.blockers
            : [];
        return this.getNearestKnockablePathBlocker(blockers);
    }

    pursueObstacleTarget(obstacle, now = Date.now()) {
        if (!this.isKnockableObstacle(obstacle)) return false;

        this.attackTarget = obstacle;
        this.attacking = true;
        this.attackState = "approach";
        this.speed = this.runSpeed;
        this.spriteDirectionLock = null;
        if (this.spriteCols > 1) this.spriteCol = 0;
        this.direction = {
            x: (this.map && typeof this.map.shortestDeltaX === "function")
                ? this.map.shortestDeltaX(this.x, obstacle.x)
                : (obstacle.x - this.x),
            y: (this.map && typeof this.map.shortestDeltaY === "function")
                ? this.map.shortestDeltaY(this.y, obstacle.y)
                : (obstacle.y - this.y)
        };

        const obstacleNode = this.map && typeof this.map.worldToNode === "function"
            ? this.map.worldToNode(obstacle.x, obstacle.y)
            : null;
        if (!obstacleNode) return true;

        const preserveStep = this._isMidTraversalStep();
        const startNode = this._getPathStartNode(preserveStep);
        if (!startNode) return true;

        const repathInterval = Number.isFinite(this.pursuitRepathMs) ? Math.max(0, this.pursuitRepathMs) : 0;
        const repathDue = (now - (this._lastPursuitPathMs || 0)) >= repathInterval;
        const destinationChanged = this.destination !== obstacleNode;
        const pathEmpty = !Array.isArray(this.path) || this.path.length === 0;
        const betweenMoves = this.travelFrames === 0 || !this.moving;
        if (!destinationChanged && !pathEmpty && !repathDue) return true;
        if (!betweenMoves && !pathEmpty && !destinationChanged && !repathDue) return true;

        const obstaclePath = this.getPathToObstacle(obstacle, startNode, obstacleNode);
        this._applyPursuitPath(obstaclePath, obstacleNode, preserveStep);
        this._lastPursuitPathMs = now;
        return true;
    }

    tryStrikeObstacleTarget(obstacle, now = Date.now(), cooldownMs = 0) {
        if (!this.isKnockableObstacle(obstacle)) return false;

        const distToObstacle = this.distanceToPoint(obstacle.x, obstacle.y);
        const strikeDistance = this.getStrikeDistance(obstacle);
        if (!Number.isFinite(distToObstacle) || distToObstacle > strikeDistance) return false;

        this.attackTarget = obstacle;
        this.attackState = "lunge";
        this.attacking = true;
        this.speed = this.lungeSpeed;
        this.direction = {
            x: (this.map && typeof this.map.shortestDeltaX === "function")
                ? this.map.shortestDeltaX(this.x, obstacle.x)
                : (obstacle.x - this.x),
            y: (this.map && typeof this.map.shortestDeltaY === "function")
                ? this.map.shortestDeltaY(this.y, obstacle.y)
                : (obstacle.y - this.y)
        };
        this.travelFrames = 0;
        this.path = [];
        this.destination = null;
        this.nextNode = null;
        if (this.hasAttackAnimation()) this.spriteCol = 1;

        if ((now - this.lastAttackTimeMs) < cooldownMs) {
            return true;
        }

        if (this.isDoorObstacle(obstacle)) {
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
            this.beginRetreat(obstacle, { holdAttackAnimation: true });
            return true;
        }

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
            this.beginRetreat(obstacle, { holdAttackAnimation: true });
            return true;
        }

        obstacle.hp = 0;
        if (typeof globalThis !== "undefined" && globalThis.activeSimObjects instanceof Set) {
            globalThis.activeSimObjects.add(obstacle);
        }
        this.attackTarget = null;
        this.beginRetreat(obstacle, { holdAttackAnimation: true });
        return true;
    }

    attack(target) {
        if (!target || target.gone || target.dead) {
            this.resetAttackState();
            return;
        }
        if (this.isTargetHiddenByInvisibilityAura(target)) {
            this._clearPursuit();
            this._aggroUntilMs = 0;
            this._playerVisibleLastAiTick = false;
            return;
        }
        const now = Date.now();
        const cooldownMs = Math.max(0, Number(this.attackCooldown) || 0) * 1000;
        this._refreshAggro(now);

        const currentObstacleTarget = this.isKnockableObstacle(this.attackTarget)
            ? this.attackTarget
            : null;
        const activeCloseCombatTarget = this._closeCombatState && this._closeCombatState.target;

        if (activeCloseCombatTarget && activeCloseCombatTarget !== target) {
            this.resetCloseCombatState();
        }

        if (this._closeCombatState && this._closeCombatState.target === target) {
            this.attackTarget = target;
            this.attacking = true;
            this.onCloseCombatStateUpdated(this._closeCombatState, target, this._closeCombatState.options || {});
            return;
        }

        // Retreat check must come first — before the distance check — so retreat state
        // is never overridden by the approach block when the target drifts outside lungeRadius.
        if (this.attackState === "retreat") {
            this.speed = this.walkSpeed;
            this.updateRetreatAttackAnimation(now);
            const retreatBudgetRefreshed = this.maybeRefreshRetreatBudget(target, now);
            if (retreatBudgetRefreshed || !this.hasRetreatMovementPlanned()) {
                this.setRetreatDestination(target);
                if (this.attackState !== "retreat") {
                    return;
                }
            }
            if (this.shouldEndRetreat(now)) {
                this._clearPursuit();
            }
            return;
        }

        if (currentObstacleTarget) {
            this.resetCloseCombatState();
            if (this.tryStrikeObstacleTarget(currentObstacleTarget, now, cooldownMs)) {
                return;
            }
            this.pursueObstacleTarget(currentObstacleTarget, now);
            return;
        }

        const preserveStep = this._isMidTraversalStep();
        const route = this.getCombatRouteToTarget(target, {
            preserveCurrentStep: preserveStep
        });
        const routeBlocker = this.getPriorityBlockerFromRoute(route);
        if (routeBlocker) {
            this.resetCloseCombatState();
            this.attackTarget = routeBlocker;
            this.attacking = true;
            if (this.tryStrikeObstacleTarget(routeBlocker, now, cooldownMs)) {
                return;
            }
            this.pursueObstacleTarget(routeBlocker, now);
            return;
        }

        this.attackTarget = target;
        this.attacking = true;

        const dist = this.distanceToPoint(target.x, target.y);

        const subclassCloseCombatOptions = typeof this.getCloseCombatOptions === "function"
            ? (this.getCloseCombatOptions(target, { now, cooldownMs }) || {})
            : {};

        const closeCombatPredictionLeadSeconds = Number.isFinite(subclassCloseCombatOptions.predictionLeadSeconds)
            ? Math.max(0, Number(subclassCloseCombatOptions.predictionLeadSeconds))
            : (
                this.getStrikeDistance(target)
                / Math.max(1e-4, Number(this.lungeSpeed) || Number(this.runSpeed) || 1)
            );
        const canStartLunge = (now - this.lastAttackTimeMs) >= cooldownMs;
        const closeCombatEntryOptions = {
            ...subclassCloseCombatOptions,
            lungeRadius: this.lungeRadius,
            approachSpeed: this.runSpeed,
            predictionLeadSeconds: closeCombatPredictionLeadSeconds
        };
        const closeCombatEntryTargetPoint = typeof this.resolveCloseCombatLungeTargetPoint === "function"
            ? this.resolveCloseCombatLungeTargetPoint(target, this._closeCombatState, {
                ...closeCombatEntryOptions,
                lungeSpeed: this.lungeSpeed,
                strikeDistance: this.getStrikeDistance(target)
            })
            : null;
        if (closeCombatEntryTargetPoint) {
            closeCombatEntryOptions.targetPoint = closeCombatEntryTargetPoint;
        }

        if (
            (!closeCombatEntryOptions.requireCommittedLungeTarget || closeCombatEntryTargetPoint)
            && this.shouldReengageCloseCombat(target, closeCombatEntryOptions)
        ) {
            this.beginCloseCombat(target, {
                nowMs: now,
                approachSpeed: this.runSpeed,
                lungeSpeed: this.lungeSpeed,
                lungeRadius: this.lungeRadius,
                strikeDistance: this.getStrikeDistance(target),
                backoffSpeed: this.walkSpeed,
                backoffRadius: this.lungeRadius,
                includeCharacterBlockers: true,
                predictionLeadSeconds: closeCombatPredictionLeadSeconds,
                ...subclassCloseCombatOptions,
                ...(closeCombatEntryTargetPoint ? { targetPoint: closeCombatEntryTargetPoint } : {}),
                canStartLunge: () => (Date.now() - this.lastAttackTimeMs) >= cooldownMs,
                resolveStrike: (strikeTarget, _state, attacker) => {
                    const strikeNow = Date.now();
                    if ((strikeNow - attacker.lastAttackTimeMs) < cooldownMs) {
                        return { resolved: false };
                    }
                    const damage = attacker.rollAttackDamage();
                    if (typeof strikeTarget.takeDamage === "function") {
                        strikeTarget.takeDamage(damage, { source: attacker });
                    } else {
                        strikeTarget.hp = Math.max(0, strikeTarget.hp - damage);
                    }
                    return { resolved: true, hit: true, damage, nowMs: strikeNow };
                },
                onHit: (_strikeTarget, _state, result, attacker) => {
                    const hitNow = Number.isFinite(result?.nowMs) ? Number(result.nowMs) : Date.now();
                    attacker.lastAttackTimeMs = hitNow;
                    attacker._attackAnimationHoldUntilMs = hitNow + Math.max(0, Number(attacker.attackAnimationHoldMs) || 0);
                    if (typeof attacker.onCloseCombatStrikeResolved === "function") {
                        attacker.onCloseCombatStrikeResolved(_strikeTarget, result, { hit: true, state: _state });
                    }
                },
                onMiss: (_strikeTarget, _state, result, attacker) => {
                    const missNow = Number.isFinite(result?.nowMs) ? Number(result.nowMs) : Date.now();
                    attacker.lastAttackTimeMs = missNow;
                    attacker._attackAnimationHoldUntilMs = missNow + Math.max(0, Number(attacker.attackAnimationHoldMs) || 0);
                    if (typeof attacker.onCloseCombatStrikeResolved === "function") {
                        attacker.onCloseCombatStrikeResolved(_strikeTarget, result, { hit: false, state: _state });
                    }
                }
            });
            this.onCloseCombatStateUpdated(this._closeCombatState, target, this._closeCombatState.options || {});
            return;
        }

        if (dist > this.lungeRadius) {
            this.attackState = "approach";
            this.speed = this.runSpeed;
            this.spriteDirectionLock = null;
            if (this.spriteCols > 1) this.spriteCol = 0;

            if (route && route.targetNode) {
                this._lastPursuitPathMs = now;
                this._applyPursuitPath(route.path, route.targetNode, preserveStep);
            } else {
                this.updatePursuitDestination(target);
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
        if (route && route.targetNode) {
            this._lastPursuitPathMs = now;
            this._applyPursuitPath(route.path, route.targetNode, preserveStep);
        } else {
            this.updatePursuitDestination(target);
        }
        this.direction = {
            x: (this.map && typeof this.map.shortestDeltaX === "function")
                ? this.map.shortestDeltaX(this.x, target.x)
                : (target.x - this.x),
            y: (this.map && typeof this.map.shortestDeltaY === "function")
                ? this.map.shortestDeltaY(this.y, target.y)
                : (target.y - this.y)
        };

        if (!this.isTargetWithinStrikeContact(target) || (now - this.lastAttackTimeMs) < cooldownMs) {
            return;
        }

        if (this.hasAttackAnimation()) this.spriteCol = 1;
        const damage = this.rollAttackDamage();
        if (typeof target.takeDamage === "function") {
            target.takeDamage(damage, { source: this });
        } else {
            target.hp = Math.max(0, target.hp - damage);
        }
        this.lastAttackTimeMs = now;
        this.beginRetreat(target, { holdAttackAnimation: true });
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
            temperature: this.getTemperature(),
            baselineTemperature: this.getTemperatureBaseline(),
            size: this.size,
            inventory: this.serializeInventory()
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
        if (Array.isArray(this._scriptMessages) && this._scriptMessages.length > 0) {
            data._scriptMessages = this._scriptMessages.map(msg => ({
                text: String((msg && msg.text) || ""),
                x: Number.isFinite(msg && msg.x) ? Number(msg.x) : 0,
                y: Number.isFinite(msg && msg.y) ? Number(msg.y) : 0,
                color: (typeof (msg && msg.color) === "string" || Number.isFinite(msg && msg.color)) ? msg.color : undefined,
                fontsize: Number.isFinite(Number(msg && msg.fontsize)) ? Number(msg.fontsize) : undefined
            })).filter(msg => msg.text.length > 0);
        }
        if (this._scriptDeactivated === true) {
            data._scriptDeactivated = true;
        }
        const scriptFrozenUntilMs = Number(this._scriptFrozenUntilMs);
        if (scriptFrozenUntilMs === Infinity) {
            data._scriptFrozenInfinite = true;
        } else if (Number.isFinite(scriptFrozenUntilMs) && scriptFrozenUntilMs > Date.now()) {
            data._scriptFrozenRemainingMs = Math.max(1, Math.ceil(scriptFrozenUntilMs - Date.now()));
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
                case 'eagleman':
                    animalInstance = new Eagleman(node, map);
                    break;
                case 'fragglegod':
                    animalInstance = new Fragglegod(node, map);
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
                if (data.baselineTemperature !== undefined) {
                    animalInstance.baselineTemperature = Number.isFinite(data.baselineTemperature)
                        ? Number(data.baselineTemperature)
                        : animalInstance.getTemperatureBaseline();
                }
                if (data.temperature !== undefined && typeof animalInstance.setTemperature === "function") {
                    animalInstance.setTemperature(data.temperature);
                }
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
                if (Object.prototype.hasOwnProperty.call(data, "inventory")) {
                    animalInstance.loadInventory(data.inventory);
                }
                if (Object.prototype.hasOwnProperty.call(data, "script")) {
                    animalInstance.script = data.script;
                }
                if (typeof data.scriptingName === "string") {
                    const scriptingApi = (typeof globalThis !== "undefined" && globalThis.Scripting)
                        ? globalThis.Scripting
                        : null;
                    const restoredName = data.scriptingName.trim();
                    if (scriptingApi && typeof scriptingApi.setObjectScriptingName === "function") {
                            scriptingApi.setObjectScriptingName(animalInstance, restoredName, { map, restoreFromSave: true });
                    } else {
                        animalInstance.scriptingName = restoredName;
                    }
                }
                if (Array.isArray(data._scriptMessages)) {
                    animalInstance._scriptMessages = data._scriptMessages
                        .map(msg => ({
                            text: String((msg && msg.text) || ""),
                            x: Number.isFinite(msg && msg.x) ? Number(msg.x) : 0,
                            y: Number.isFinite(msg && msg.y) ? Number(msg.y) : 0,
                            color: (typeof (msg && msg.color) === "string" || Number.isFinite(msg && msg.color)) ? msg.color : undefined,
                            fontsize: Number.isFinite(Number(msg && msg.fontsize)) ? Number(msg.fontsize) : undefined
                        }))
                        .filter(msg => msg.text.length > 0);
                    if (animalInstance._scriptMessages.length > 0 && typeof globalThis !== "undefined") {
                        if (!(globalThis._scriptMessageTargets instanceof Set)) {
                            globalThis._scriptMessageTargets = new Set();
                        }
                        globalThis._scriptMessageTargets.add(animalInstance);
                    }
                }
                if (data._scriptDeactivated === true) {
                    animalInstance._scriptDeactivated = true;
                }
                if (data._scriptFrozenInfinite === true) {
                    animalInstance._scriptFrozenUntilMs = Infinity;
                } else if (Number.isFinite(data._scriptFrozenRemainingMs) && Number(data._scriptFrozenRemainingMs) > 0) {
                    animalInstance._scriptFrozenUntilMs = Date.now() + Math.max(1, Number(data._scriptFrozenRemainingMs));
                }
                if (typeof animalInstance.isFrozen === "function" && animalInstance.isFrozen()) {
                    animalInstance.applyFrozenState({ clearMoveTimeout: true });
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
        this.frameCount = {x: 1, y: 2};
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
        this._playerSummoned = false;
        this._playerSummonCaster = null;
        this._playerSummonExpiresAtMs = 0;
        this._playerSummonOrbitAngle = Math.random() * Math.PI * 2;
        this._playerSummonImpactUntilMs = 0;
        this._playerSummonImpactHoldMs = 90;
        this._playerSummonAttackRotation = 0;
        this._playerSummonLaunchState = null;
        this.spriteSheetReady = false;
        ensureSpriteFrames(this);
    }

    getCloseCombatOptions(target, _context = {}) {
        const strikeDistance = this.getStrikeDistance(target);
        return {
            requireCommittedLungeTarget: true,
            useCloseCombatInterceptPoint: true,
            resetMovementVectorOnLunge: true,
            postHitPhase: "retreat",
            holdAttackAnimationOnHit: true,
            lungeTargetResolver: (resolvedTarget, _state, attacker, options = {}) => attacker.getCloseCombatInterceptPoint(resolvedTarget, {
                ...options,
                lungeSpeed: attacker.lungeSpeed,
                strikeDistance,
                maxDistance: attacker.lungeRadius
            })
        };
    }

    configureAsPlayerSummon(options = {}) {
        const durationMs = Number.isFinite(options.durationMs)
            ? Math.max(250, Number(options.durationMs))
            : 20000;
        const originalSize = Number.isFinite(this.size) && this.size > 0 ? Number(this.size) : 1;
        const desiredSize = Math.max(0.95, originalSize);
        const sizeRatio = desiredSize / Math.max(0.001, originalSize);
        this._playerSummoned = true;
        this._playerSummonCaster = options.caster || globalThis.wizard || null;
        this._playerSummonExpiresAtMs = Date.now() + durationMs;
        this._playerSummonImpactUntilMs = 0;
        this._playerSummonAttackRotation = 0;
        if (Math.abs(sizeRatio - 1) > 1e-6) {
            this.size = desiredSize;
            this.width *= sizeRatio;
            this.height *= sizeRatio;
            if (Number.isFinite(this.radius)) this.radius *= sizeRatio;
            if (Number.isFinite(this.groundRadius)) this.groundRadius *= sizeRatio;
            if (Number.isFinite(this.visualRadius)) this.visualRadius *= sizeRatio;
            if (Number.isFinite(this.lungeRadius)) this.lungeRadius *= sizeRatio;
            if (Number.isFinite(this.strikeRange)) this.strikeRange *= sizeRatio;
            if (typeof this.updateHitboxes === "function") {
                this.updateHitboxes();
            }
        }
        this.randomMotion = 0;
        this.walkSpeed = Math.max(this.walkSpeed, 2.4);
        this.runSpeed = Math.max(this.runSpeed, 4.2);
        this.lungeRadius = Math.max(this.lungeRadius, 3.2);
        this.lungeSpeed = Math.max(this.lungeSpeed, 7.0);
        this.attackCooldown = Math.min(this.attackCooldown, 1.1);
        this.strikeRange = Math.max(this.strikeRange, 0.55);
        this.fleeRadius = -1;
        this.chaseRadius = this.scaledChaseRadius(18);
        this.attackVerb = "bites";
        this.damage = Math.max(4, Math.round(this.size * 6));
        this.hp = Math.max(this.hp, 3);
        this.maxHp = Math.max(this.maxHp, this.hp);
        this.tint = 0xffffff;
        if (this.pixiSprite) {
            this.pixiSprite.tint = 0xffffff;
        }
        return this;
    }

    launchAsPlayerSummon(options = {}) {
        const mapRef = this.map || null;
        const startX = Number.isFinite(options.startX) ? Number(options.startX) : this.x;
        const startY = Number.isFinite(options.startY) ? Number(options.startY) : this.y;
        let targetX = Number.isFinite(options.targetX) ? Number(options.targetX) : startX;
        let targetY = Number.isFinite(options.targetY) ? Number(options.targetY) : startY;
        if (mapRef && typeof mapRef.wrapWorldX === "function") targetX = mapRef.wrapWorldX(targetX);
        if (mapRef && typeof mapRef.wrapWorldY === "function") targetY = mapRef.wrapWorldY(targetY);
        const dx = mapRef && typeof mapRef.shortestDeltaX === "function"
            ? mapRef.shortestDeltaX(startX, targetX)
            : (targetX - startX);
        const dy = mapRef && typeof mapRef.shortestDeltaY === "function"
            ? mapRef.shortestDeltaY(startY, targetY)
            : (targetY - startY);
        const distance = Math.max(0.001, Math.hypot(dx, dy));
        const speed = Number.isFinite(options.speed) ? Math.max(0.001, Number(options.speed)) : 7;

        this.x = startX;
        this.y = startY;
        this.z = 0;
        this.destination = null;
        this.path = [];
        this.nextNode = null;
        this.travelFrames = 0;
        this.moving = true;
        this.direction = { x: dx, y: dy };
        this._playerSummonLaunchState = {
            startedMs: Date.now(),
            durationMs: (distance / speed) * 1000,
            startX,
            startY,
            targetX,
            targetY,
            dx,
            dy,
            peakZ: Math.max(0.8, Math.min(1.8, distance * 0.12))
        };
        if (typeof this.updateHitboxes === "function") {
            this.updateHitboxes();
        }
        if (typeof console !== "undefined" && typeof console.log === "function") {
            console.log("[AttackSquirrel]", "launch-start", {
                id: this._attackSquirrelDebugId || null,
                startX,
                startY,
                targetX,
                targetY,
                distance,
                speed,
                durationMs: this._playerSummonLaunchState.durationMs,
                width: this.width,
                height: this.height,
                size: this.size
            });
        }
        return this;
    }

    isPlayerSummonLaunching() {
        return !!(this._playerSummonLaunchState && typeof this._playerSummonLaunchState === "object");
    }

    updatePlayerSummonLaunch(now = Date.now()) {
        const state = this._playerSummonLaunchState;
        if (!state) return false;

        const durationMs = Math.max(1, Number(state.durationMs) || 1);
        const progress = Math.max(0, Math.min(1, (now - Number(state.startedMs || now)) / durationMs));
        let worldX = Number(state.startX) + Number(state.dx) * progress;
        let worldY = Number(state.startY) + Number(state.dy) * progress;
        if (this.map && typeof this.map.wrapWorldX === "function") worldX = this.map.wrapWorldX(worldX);
        if (this.map && typeof this.map.wrapWorldY === "function") worldY = this.map.wrapWorldY(worldY);

        this.x = worldX;
        this.y = worldY;
        this.z = Math.sin(progress * Math.PI) * Math.max(0, Number(state.peakZ) || 0);
        this.direction = { x: Number(state.dx) || 0, y: Number(state.dy) || 0 };
        this._playerSummonAttackRotation = -18 + (progress * 36);
        this.moving = progress < 1;
        if (typeof this.updateHitboxes === "function") {
            this.updateHitboxes();
        }

        if (progress < 1) {
            return true;
        }

        this.x = Number(state.targetX);
        this.y = Number(state.targetY);
        this.z = 0;
        this.moving = false;
        this._playerSummonLaunchState = null;
        if (this.map && typeof this.map.worldToNode === "function") {
            const resolvedNode = this.map.worldToNode(this.x, this.y);
            if (resolvedNode) {
                this.node = resolvedNode;
            }
        }
        if (typeof this.updateHitboxes === "function") {
            this.updateHitboxes();
        }
        if (typeof console !== "undefined" && typeof console.log === "function") {
            console.log("[AttackSquirrel]", "launch-complete", {
                id: this._attackSquirrelDebugId || null,
                x: this.x,
                y: this.y,
                nodeX: this.node && this.node.xindex,
                nodeY: this.node && this.node.yindex,
                onScreen: this._onScreen,
                gone: this.gone,
                dead: this.dead
            });
        }
        return false;
    }

    isPlayerAlliedSummon() {
        return this._playerSummoned === true;
    }

    isValidPlayerThreatTarget(candidate, now = Date.now()) {
        if (!candidate || candidate === this || candidate === wizard) return false;
        if (candidate.gone || candidate.dead) return false;
        if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return false;
        if (typeof candidate.takeDamage !== "function" && !Number.isFinite(candidate.hp)) return false;
        if (typeof candidate.isPlayerAlliedSummon === "function" && candidate.isPlayerAlliedSummon()) return false;
        if (candidate._playerSummoned === true) return false;
        if (typeof candidate.isActivelyInteractingWithPlayer === "function") {
            return candidate.isActivelyInteractingWithPlayer(now);
        }
        if (candidate.attackTarget === wizard) return true;
        return !!(candidate._closeCombatState && candidate._closeCombatState.target === wizard);
    }

    findNearestPlayerThreatTarget(now = Date.now()) {
        const currentTarget = this.attackTarget;
        if (this.isValidPlayerThreatTarget(currentTarget, now)) {
            return currentTarget;
        }

        const mapObjects = (this.map && typeof this.map.getGameObjects === "function")
            ? this.map.getGameObjects({ refresh: true })
            : [];
        let bestTarget = null;
        let bestDistance = Infinity;
        for (let i = 0; i < mapObjects.length; i++) {
            const candidate = mapObjects[i];
            if (!this.isValidPlayerThreatTarget(candidate, now)) continue;
            const candidateDistance = this.distanceToPoint(candidate.x, candidate.y);
            if (candidateDistance < bestDistance) {
                bestDistance = candidateDistance;
                bestTarget = candidate;
            }
        }
        return bestTarget;
    }

    updatePlayerSummonAttackVisuals(now = Date.now()) {
        if (!this.isPlayerAlliedSummon() || this.dead || this.gone) {
            this._playerSummonAttackRotation = 0;
            return;
        }

        if (this.isPlayerSummonLaunching()) {
            this.updatePlayerSummonLaunch(now);
            return;
        }

        const peakHeight = Math.max(0.18, this.size * 0.8);
        const state = this._closeCombatState;
        const impactUntil = Number(this._playerSummonImpactUntilMs) || 0;

        if (state && state.phase === "lunge") {
            const elapsedMs = Math.max(0, now - (Number(state.phaseStartedMs) || now));
            const strikeDistance = Number.isFinite(state.options && state.options.strikeDistance)
                ? Number(state.options.strikeDistance)
                : this.getStrikeDistance(state.target);
            const lungeTravelDistance = Math.max(strikeDistance, this._getCloseCombatLungeTravelDistance(state), 0.6);
            const durationMs = Math.max(140, (lungeTravelDistance / Math.max(1e-4, Number(this.lungeSpeed) || 1)) * 1000);
            const progress = Math.max(0, Math.min(1, elapsedMs / durationMs));
            this.z = peakHeight * Math.sin(progress * Math.PI * 0.92);
            this._playerSummonAttackRotation = -26 + (progress * 48);
            return;
        }

        if (impactUntil > now) {
            const impactProgress = 1 - ((impactUntil - now) / Math.max(1, this._playerSummonImpactHoldMs));
            this.z = peakHeight * 0.14;
            this._playerSummonAttackRotation = 28 - (impactProgress * 16);
            return;
        }

        if (state && state.phase === "backoff") {
            const elapsedMs = Math.max(0, now - (Number(state.phaseStartedMs) || now));
            const progress = Math.max(0, Math.min(1, elapsedMs / 180));
            this.z = peakHeight * 0.4 * ((1 - progress) ** 2);
            this._playerSummonAttackRotation = 18 * (1 - progress);
            return;
        }

        this.z *= 0.5;
        if (Math.abs(this.z) < 0.01) this.z = 0;
        this._playerSummonAttackRotation *= 0.5;
        if (Math.abs(this._playerSummonAttackRotation) < 0.5) {
            this._playerSummonAttackRotation = 0;
        }
    }

    updateSquirrelLungeVisuals(now = Date.now()) {
        if (this.isPlayerAlliedSummon()) return;
        if (this.dead || this.gone) {
            this.z = 0;
            return;
        }

        const state = this._closeCombatState;
        if (state && state.phase === "lunge") {
            const elapsedMs = Math.max(0, now - (Number(state.phaseStartedMs) || now));
            const strikeDistance = Number.isFinite(state.options && state.options.strikeDistance)
                ? Number(state.options.strikeDistance)
                : this.getStrikeDistance(state.target);
            const committedTargetDistance = (
                Number.isFinite(state.lungeTargetX) &&
                Number.isFinite(state.lungeTargetY)
            )
                ? this.distanceToPoint(state.lungeTargetX, state.lungeTargetY)
                : 0;
            const lungeTravelDistance = Math.max(
                strikeDistance,
                committedTargetDistance,
                this._getCloseCombatLungeTravelDistance(state),
                0.45
            );
            const durationMs = Math.max(120, (lungeTravelDistance / Math.max(1e-4, Number(this.lungeSpeed) || 1)) * 1000);
            const progress = Math.max(0, Math.min(1, elapsedMs / durationMs));
            const peakHeight = Math.max(0.15, this.size * 0.65);
            this.z = peakHeight * Math.sin(progress * Math.PI);
            return;
        }

        this.z *= 0.35;
        if (Math.abs(this.z) < 0.01) {
            this.z = 0;
        }
    }

    onCloseCombatStateUpdated(state, target, options = {}) {
        super.onCloseCombatStateUpdated(state, target, options);
        this.updatePlayerSummonAttackVisuals(Date.now());
        this.updateSquirrelLungeVisuals(Date.now());
    }

    onCloseCombatStrikeResolved(_target, result, details = {}) {
        if (!this.isPlayerAlliedSummon()) return;
        const now = Number.isFinite(result && result.nowMs) ? Number(result.nowMs) : Date.now();
        this._playerSummonImpactUntilMs = now + this._playerSummonImpactHoldMs;
        if (details.hit === true) {
            this.z = Math.max(this.z, this.size * 0.12);
        }
    }

    getAdditionalSpriteRotationDegrees() {
        if (this.isPlayerAlliedSummon() && !this.dead && !this.gone) {
            return this._playerSummonAttackRotation || 0;
        }
        return super.getAdditionalSpriteRotationDegrees();
    }

    runPlayerSummonAi() {
        const now = Date.now();
        if (this._playerSummonExpiresAtMs > 0 && now >= this._playerSummonExpiresAtMs) {
            this.removeFromGame();
            return;
        }

        if (this.isPlayerSummonLaunching()) {
            this.updatePlayerSummonLaunch(now);
            return;
        }

        const target = this.findNearestPlayerThreatTarget(now);
        if (target) {
            this._refreshAggro(now);
            this.attack(target);
            this.updatePlayerSummonAttackVisuals(now);
            return;
        }

        if (this.attacking || this.attackState !== "idle" || (this._closeCombatState && this._closeCombatState.target)) {
            this.resetAttackState();
        }

        const caster = this._playerSummonCaster || globalThis.wizard || null;
        if (caster && !caster.gone && !caster.dead && this.map && typeof this.map.worldToNode === "function") {
            const followDistance = this.distanceToPoint(caster.x, caster.y);
            if (followDistance > 3.5) {
                this._playerSummonOrbitAngle += 0.55;
                let followX = caster.x + Math.cos(this._playerSummonOrbitAngle) * 1.6;
                let followY = caster.y + Math.sin(this._playerSummonOrbitAngle) * 1.1;
                if (typeof this.map.wrapWorldX === "function") followX = this.map.wrapWorldX(followX);
                if (typeof this.map.wrapWorldY === "function") followY = this.map.wrapWorldY(followY);
                const followNode = this.map.worldToNode(followX, followY);
                if (followNode) {
                    this.speed = this.runSpeed;
                    this.goto(followNode);
                }
            }
        }

        this.updatePlayerSummonAttackVisuals(now);
    }

    runAiBehaviorTick() {
        if (this.isPlayerAlliedSummon()) {
            this.runPlayerSummonAi();
            return;
        }
        super.runAiBehaviorTick();
    }

    tickMovementOnly(simHz = null, movementScale = 1) {
        if (this.isPlayerAlliedSummon() && this.isPlayerSummonLaunching()) {
            this._ensureDeathState();
            if (this.dead || this.gone) return;
            if (Number.isFinite(simHz) && simHz > 0) {
                this.frameRate = simHz;
            }
            this.updatePlayerSummonLaunch(Date.now());
            return;
        }
        super.tickMovementOnly(simHz, movementScale);
        this.updatePlayerSummonAttackVisuals(Date.now());
        this.updateSquirrelLungeVisuals(Date.now());
    }

    tickBehaviorOnly() {
        super.tickBehaviorOnly();
        this.updatePlayerSummonAttackVisuals(Date.now());
        this.updateSquirrelLungeVisuals(Date.now());
    }

    move() {
        if (this.isPlayerAlliedSummon() && this.isPlayerSummonLaunching()) {
            if (this.dead || this.gone) return;
            if (!this.useExternalScheduler) {
                this.moveTimeout = this.nextMove();
            } else {
                this.moveTimeout = null;
            }
            if (paused) return;
            this.prevX = this.x;
            this.prevY = this.y;
            this.prevZ = this.z;
            this.updatePlayerSummonLaunch(Date.now());
            return;
        }
        super.move();
        this.updatePlayerSummonAttackVisuals(Date.now());
        this.updateSquirrelLungeVisuals(Date.now());
    }

    die() {
        const wasPlayerSummoned = this.isPlayerAlliedSummon();
        super.die();
        if (!wasPlayerSummoned) return;
        if (typeof console !== "undefined" && typeof console.log === "function") {
            console.log("[AttackSquirrel]", "die", {
                id: this._attackSquirrelDebugId || null,
                x: this.x,
                y: this.y,
                nodeX: this.node && this.node.xindex,
                nodeY: this.node && this.node.yindex
            });
        }
        if (this._playerSummonRemovalTimeout) {
            clearTimeout(this._playerSummonRemovalTimeout);
        }
        this._playerSummonRemovalTimeout = setTimeout(() => {
            if (!this.gone) {
                if (typeof console !== "undefined" && typeof console.log === "function") {
                    console.log("[AttackSquirrel]", "remove-after-death", {
                        id: this._attackSquirrelDebugId || null,
                        x: this.x,
                        y: this.y
                    });
                }
                this.removeFromGame();
            }
        }, 450);
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
        this.frameCount = {x: 1, y: 2};
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
        this.frameCount = {x: 2, y: 2};
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
        this.hp = 50 * this.size;
        this.maxHp = this.hp;
        this.ensureMagicPointsInitialized(true);
        this.spriteSheetReady = false;
        ensureSpriteFrames(this);
    }
}

class Eagleman extends Animal {
    constructor(location, map) {
        const size = Math.random() * .5 + 1.2;
        super('eagleman', location, size, map);
        this._deathCoinsSpawned = false;
        this._depthBillboardAttackTiltDeg = 0;
        this.pixiSprite.anchor.set(0.5, 0.8);
        this.spriteSheet = {
            rows: 4,
            cols: 2,
            frameKeys: [
                "down",
                "down_attack",
                "left",
                "left_attack",
                "right",
                "right_attack",
                "up",
                "up_attack"
            ],
            frameScales: {
                down_attack: 1.2,
                down: {width: 0.95, height: 1.2},
                up: { width: 0.95, height: 1.2 },
                up_attack: { width: 0.95, height: 1.6 },
                left_attack: {width: 1.25, height: 0.9},
                right_attack: { width: 1.25, height: 0.9 },
                left: { width: 0.9, height: 1.1 },
                right: { width: 0.9, height: 1.1 }
            }
        };
        this.frameCount = {x: 2, y: 4};
        this.walkSpeed = 1;
        this.runSpeed = 3.5;
        this.lungeRadius = 3;
        this.lungeSpeed = 10.0;
        this.attackCooldown = 1.5;
        this.strikeRange = 1.25;
        this.retreatThreshold = 0.25;
        this.chaseRadius = this.scaledChaseRadius(9);
        this.fleeRadius = -1;
        this.attackVerb = "strikes";
        this.damage = 37;
        this.foodValue = Math.floor(240 * this.size);
        this.hp = 75 * this.size;
        this.maxHp = this.hp;
        this.ensureMagicPointsInitialized(true);
        this.maxMp = this.maxHp * 2;
        this.mp = this.maxMp;
        this.spriteSheetReady = false;
        ensureSpriteFrames(this);
    }

    getAdditionalSpriteRotationDegrees() {
        if (this.dead || this.gone) return 0;
        if (!this.attacking || this.attackState === "idle") return 0;

        const target = this.attackTarget;
        if (!target || target.gone || target.dead) return 0;
        if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return 0;

        const selfX = Number.isFinite(this.x) ? Number(this.x) : 0;
        const selfY = Number.isFinite(this.y) ? Number(this.y) : 0;
        const dx = (this.map && typeof this.map.shortestDeltaX === "function")
            ? this.map.shortestDeltaX(selfX, target.x)
            : (target.x - selfX);
        const dy = (this.map && typeof this.map.shortestDeltaY === "function")
            ? this.map.shortestDeltaY(selfY, target.y)
            : (target.y - selfY);
        if (Math.hypot(dx, dy) <= 1e-6) return 0;

        const rowIndex = this.getDirectionRow();
        let baseAngleDeg = 0;
        switch (rowIndex) {
            case 0:
                baseAngleDeg = 90;
                break;
            case 1:
                baseAngleDeg = 180;
                break;
            case 3:
                baseAngleDeg = -90;
                break;
            case 2:
            default:
                baseAngleDeg = 0;
                break;
        }

        const targetAngleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
        let deltaDeg = targetAngleDeg - baseAngleDeg;
        while (deltaDeg <= -180) deltaDeg += 360;
        while (deltaDeg > 180) deltaDeg -= 360;
        return Math.max(-10, Math.min(10, deltaDeg));
    }

    updateDepthBillboardMesh(ctx, camera, options) {
        const attackTiltDeg = this.getAdditionalSpriteRotationDegrees();
        const previousTiltDeg = Number.isFinite(this._depthBillboardAttackTiltDeg)
            ? Number(this._depthBillboardAttackTiltDeg)
            : 0;
        if (Math.abs(attackTiltDeg) > 1e-4 || Math.abs(previousTiltDeg) > 1e-4) {
            this._depthBillboardLastSignature = "";
        }

        const result = super.updateDepthBillboardMesh(ctx, camera, options);
        this._depthBillboardAttackTiltDeg = attackTiltDeg;

        if (!this.dead) {
            this.rotateDepthBillboardQuadInScreenSpace(result, camera, attackTiltDeg);
        }

        return result;
    }

    die() {
        if (this.dead || this.gone) return;

        this.spawnDeathCoins();
        super.die();
        this.attackState = "idle";
        this.attacking = false;
        this.spriteCol = 0;
        this.spriteDirectionLock = { x: 0, y: 1 };
    }

    spawnDeathCoins() {
        if (this._deathCoinsSpawned || typeof this.dropPowerup !== "function") return [];

        this._deathCoinsSpawned = true;
        const dropDistance = Math.max(0.45, (Number.isFinite(this.groundRadius) ? Number(this.groundRadius) : 0.55) + 0.15);
        return this.dropPowerup("gold_coin", {
            // Gold coin metadata height is 0.8, so 0.625 scale preserves the
            // earlier "size 0.5" request while keeping the normal aspect ratio.
            size: 0.625,
            count: 3,
            preferredDistance: dropDistance
        });
    }
}

class Fragglegod extends Animal {
    constructor(location, map) {
        const size = Math.random() * .5 + 1.2;
        super('fragglegod', location, size, map);
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
        this.walkSpeed = 1;
        this.runSpeed = 3.5;
        this.lungeRadius = 2;
        this.lungeSpeed = 5.0;
        this.attackCooldown = 1.5;
        this.strikeRange = 0.8;
        this.retreatThreshold = 1;
        this.chaseRadius = this.scaledChaseRadius(12);
        this.fleeRadius = -1;
        this.attackVerb = "zaps";
        this.damage = 25 * this.size;
        this.foodValue = Math.floor(240 * this.size);
        this.hp = 75 * this.size;
        this.maxHp = this.hp;
        this.maxMp = 60 * this.size;
        this.ensureMagicPointsInitialized(true);
        this.spriteSheetReady = false;
        ensureSpriteFrames(this);
    }

    die() {
        if (this.dead || this.gone) return;

        const facingRight = this.getDirectionRow() === 1;
        Blodia.prototype.die.call(this);
        this.attackState = "idle";
        this.attacking = false;
        this.spriteCol = 0;
        this.spriteDirectionLock = facingRight ? { x: 1, y: 0 } : { x: -1, y: 0 };
    }

    tickDeathAnimation() {
        const wasFalling = !!this._deathFalling;
        Blodia.prototype.tickDeathAnimation.call(this);
        if (wasFalling && !this._deathFalling) {
            this.spawnCorpsePowerup();
        }
    }

    updateDepthBillboardMesh(ctx, camera, options) {
        return Blodia.prototype.updateDepthBillboardMesh.call(this, ctx, camera, options);
    }

    spawnCorpsePowerup() {
        if (this._droppedPowerup || typeof this.dropPowerup !== "function") return null;

        const dropRadius = Number.isFinite(this.groundRadius)
            ? Math.max(0.35, this.groundRadius)
            : 0.75;
        const dropCount = Math.max(1, Math.floor(this.size * 3));

        this._droppedPowerup = this.dropPowerup("lightning", {
            size: 0.75,
            count: dropCount,
            preferredDistance: Math.max(0.45, dropRadius + 0.15),
            registerWithMap: true,
            onCollect: () => {
                if (!this.gone) {
                    this.removeFromGame();
                }
            }
        });

        return this._droppedPowerup;
    }
}


class Scorpion extends Animal {
    constructor(location, map) {
        const size = Math.random() * .1 + .4;
        super('scorpion', location, size, map);
        this.frameCount = {x: 1, y: 2};
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
        const dtSeconds = 1 / Math.max(1, Number(this.frameRate) || 1);
        const temperatureFrozen = typeof this.isTemperatureFrozen === "function" && this.isTemperatureFrozen();
        const scriptFrozen = typeof this.isScriptFrozen === "function" && this.isScriptFrozen();
        if (temperatureFrozen || scriptFrozen) {
            if (typeof this.applyFrozenState === "function") {
                this.applyFrozenState({ clearMoveTimeout: false });
            }
            if (temperatureFrozen && !scriptFrozen && typeof this.recoverTemperature === "function") {
                this.recoverTemperature(dtSeconds);
            }
            this.updateSeePlayerState();
            this.moving = false;
            return;
        }
        this.recoverTemperature(dtSeconds);

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
                const arrivalPosition = this.getTraversalStepWorldPosition(this.currentPathStep, 1);
                this.node = this.nextNode;
                this.x = arrivalPosition && Number.isFinite(arrivalPosition.x) ? arrivalPosition.x : this.node.x;
                this.y = arrivalPosition && Number.isFinite(arrivalPosition.y) ? arrivalPosition.y : this.node.y;
                this.z = arrivalPosition && Number.isFinite(arrivalPosition.z) ? arrivalPosition.z : this.getNodeStandingZ(this.node);
                this._recordVisitedNode(this.node);
                this.currentPathStep = null;
            }
            const nextPathItem = this.path.shift();
            this.currentPathStep = this.resolvePathStep(nextPathItem, this.node);
            this.nextNode = this.getPathItemDestinationNode(this.currentPathStep);
            this.directionIndex = Number.isInteger(this.currentPathStep && this.currentPathStep.directionIndex)
                ? Number(this.currentPathStep.directionIndex)
                : this.node.neighbors.indexOf(this.nextNode);
            if (!this.nextNode) {
                this.destination = null;
                this.moving = false;
                if (!Number.isFinite(this.maxHp) || this.maxHp < this.hp) this.maxHp = this.hp;
                return;
            }
            const targetPosition = this.getTraversalStepWorldPosition(this.currentPathStep, 1) || {
                x: this.nextNode.x,
                y: this.nextNode.y,
                z: this.getNodeStandingZ(this.nextNode)
            };
            const xdist = typeof this.map.shortestDeltaX === "function"
                ? this.map.shortestDeltaX(this.x, targetPosition.x)
                : (targetPosition.x - this.x);
            const ydist = typeof this.map.shortestDeltaY === "function"
                ? this.map.shortestDeltaY(this.y, targetPosition.y)
                : (targetPosition.y - this.y);
            const zdist = (Number.isFinite(targetPosition.z) ? targetPosition.z : this.getNodeStandingZ(this.nextNode)) - this.z;
            const d = Math.sqrt(xdist ** 2 + ydist ** 2);
            const effectiveSpeed = this.getEffectiveMovementSpeed(this.speed);
            if (!(effectiveSpeed > 0)) {
                if (typeof this.applyFrozenState === "function") {
                    this.applyFrozenState({ clearMoveTimeout: false });
                }
                this.updateSeePlayerState();
                this.moving = false;
                return;
            }
            this.travelFrames = Math.max(1, Math.ceil(d / effectiveSpeed * this.frameRate));
            this.travelX = xdist / this.travelFrames;
            this.travelY = ydist / this.travelFrames;
            this.travelZ = zdist / this.travelFrames;
            this.direction = {x: xdist, y: ydist};
        }

        this.travelFrames--;
        this.x += this.travelX;
        this.y += this.travelY;
        this.z += this.travelZ;
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
        const preserveStep = this._isMidTraversalStep();
        const startNode = this._getPathStartNode(preserveStep);
        const hasLOS = this.clearCloseCombatOnLostLineOfSight(wizard, startNode);
        const activeCloseCombatTarget = this._closeCombatState && this._closeCombatState.target;

        if (activeCloseCombatTarget && activeCloseCombatTarget !== wizard) {
            this.resetCloseCombatState();
        }

        if (this._closeCombatState && this._closeCombatState.target === wizard) {
            this.attackTarget = wizard;
            this.attacking = true;
            this.onCloseCombatStateUpdated(this._closeCombatState, wizard, this._closeCombatState.options || {});
            return;
        }

        // While a movement step is in progress, queue the new path from the
        // already-committed next node so we don't stitch a fresh path onto the
        // wrong side of the current edge and cut through walls.
        const targetNode = this.map.worldToNode(wizard.x, wizard.y);

        // ── Retreat phase: briefly back off after a successful hit ──────────────────
        if (this.attackState === "retreat") {
            this.speed = this.walkSpeed;
            this.updateRetreatAttackAnimation(now);
            const retreatBudgetRefreshed = this.maybeRefreshRetreatBudget(wizard, now);
            if (retreatBudgetRefreshed || !this.hasRetreatMovementPlanned()) {
                this.setRetreatDestination(wizard);
            }
            if (this.shouldEndRetreat(now)) {
                this._clearPursuit();
                this._lungeStartMs = 0;
                this._lastPathDist = Infinity;
                this._lastAStarMs = 0; // force immediate A* re-route
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

        if (!hasLOS) {
            this._lastPathDist = Infinity;
        }

        if (!startNode || !targetNode) return;

        const midStep = preserveStep;
        const pathEmpty = !Array.isArray(this.path) || this.path.length === 0;

        // A* every second for an accurate wall-aware route.
        // Blodia always uses clearance:0 — it squeezes through every corridor.
        if ((now - this._lastAStarMs) >= 1000) {
            this._lastAStarMs = now;
            const p = this.map.findPathAStar(startNode, targetNode, {
                clearance: 0,
                collectBlockers: false
            });
            if (Array.isArray(p) && p.length > 0) {
                this._lastPathDist = this._pathTotalDist(p);
                this._applyPath(p, targetNode, midStep);
            }
        }
        // Greedy BFS fallback — only when completely pathless so we never freeze.
        // Also updates _lastPathDist so lunge can trigger even when A* hasn't run yet.
        if (pathEmpty && !this.destination) {
            const p = this.map.findPath(startNode, targetNode, {
                clearance: 0,
                collectBlockers: false
            });
            if (Array.isArray(p) && p.length > 0) {
                this._lastPathDist = this._pathTotalDist(p);
            }
            this._applyPath(p, targetNode, midStep);
        }

        // Switch to lunge only when the A* path (not straight-line) is short enough.
        // This prevents maze false-positives where dist is small but the route is long.
        const strikeDistance = this.getStrikeDistance(wizard);
        const closeCombatPredictionLeadSeconds = strikeDistance
            / Math.max(1e-4, Number(this.lungeSpeed) || Number(this.runSpeed) || 1);
        const closeCombatEntryOptions = {
            lungeRadius: this.lungeRadius,
            approachSpeed: this.runSpeed,
            predictionLeadSeconds: closeCombatPredictionLeadSeconds
        };
        const closeCombatEntryTargetPoint = typeof this.resolveCloseCombatLungeTargetPoint === "function"
            ? this.resolveCloseCombatLungeTargetPoint(wizard, this._closeCombatState, {
                ...closeCombatEntryOptions,
                lungeSpeed: this.lungeSpeed,
                strikeDistance
            })
            : null;
        if (closeCombatEntryTargetPoint) {
            closeCombatEntryOptions.targetPoint = closeCombatEntryTargetPoint;
        }
        if (
            this._lastPathDist <= this.lungeRadius
            && this.shouldReengageCloseCombat(wizard, closeCombatEntryOptions)
        ) {
            this.beginCloseCombat(wizard, {
                nowMs: now,
                approachSpeed: this.runSpeed,
                lungeSpeed: this.lungeSpeed,
                lungeRadius: this.lungeRadius,
                strikeDistance,
                backoffSpeed: this.walkSpeed,
                backoffRadius: this.lungeRadius,
                includeCharacterBlockers: true,
                predictionLeadSeconds: closeCombatPredictionLeadSeconds,
                ...(closeCombatEntryTargetPoint ? { targetPoint: closeCombatEntryTargetPoint } : {}),
                canStartLunge: () => (Date.now() - this.lastAttackTimeMs) >= Math.max(0, Number(this.attackCooldown) || 0) * 1000,
                resolveStrike: (strikeTarget, _state, attacker) => {
                    const strikeNow = Date.now();
                    const cooldownMs = Math.max(0, Number(attacker.attackCooldown) || 0) * 1000;
                    if ((strikeNow - attacker.lastAttackTimeMs) < cooldownMs) {
                        return { resolved: false };
                    }
                    const damage = Math.floor((1 - Math.random() * Math.random()) * attacker.damage + 1);
                    if (typeof strikeTarget.takeDamage === "function") {
                        strikeTarget.takeDamage(damage, { source: attacker });
                    } else {
                        strikeTarget.hp = Math.max(0, strikeTarget.hp - damage);
                    }
                    return { resolved: true, hit: true, damage, nowMs: strikeNow };
                },
                onHit: (_strikeTarget, _state, result, attacker) => {
                    const hitNow = Number.isFinite(result?.nowMs) ? Number(result.nowMs) : Date.now();
                    attacker.lastAttackTimeMs = hitNow;
                    attacker._attackAnimationHoldUntilMs = hitNow + Math.max(0, Number(attacker.attackAnimationHoldMs) || 0);
                    attacker._lastPathDist = Infinity;
                    attacker._lastAStarMs = 0;
                },
                onMiss: (_strikeTarget, _state, result, attacker) => {
                    const missNow = Number.isFinite(result?.nowMs) ? Number(result.nowMs) : Date.now();
                    attacker.lastAttackTimeMs = missNow;
                    attacker._attackAnimationHoldUntilMs = missNow + Math.max(0, Number(attacker.attackAnimationHoldMs) || 0);
                    attacker._lastPathDist = Infinity;
                    attacker._lastAStarMs = 0;
                }
            });
            this.onCloseCombatStateUpdated(this._closeCombatState, wizard, this._closeCombatState.options || {});
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
        const normalizedPath = newPath.slice();
        if (preserveStep && this.nextNode) {
            while (normalizedPath.length > 0 && this.getPathItemDestinationNode(normalizedPath[0]) === this.nextNode) {
                normalizedPath.shift();
            }
        }
        this.path = normalizedPath;
        this.destination = targetNode;
        if (!preserveStep) {
            this.travelFrames = 0;
            this.nextNode = null;
        }
    }

    die() {
        if (this.dead) return;
        // Keep corpse fire rooted at the animal's ground pivot so it shares
        // the host billboard's effective depth instead of the upright top edge.
        this._deathFireAnchorWorld = { x: this.x, y: this.y, z: 0 };
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

if (typeof globalThis !== "undefined") {
    globalThis.Animal = Animal;
    globalThis.Squirrel = Squirrel;
    globalThis.Deer = Deer;
    globalThis.Bear = Bear;
    globalThis.Eagleman = Eagleman;
    globalThis.Fragglegod = Fragglegod;
    globalThis.Scorpion = Scorpion;
    globalThis.Armadillo = Armadillo;
    globalThis.Coyote = Coyote;
    globalThis.Goat = Goat;
    globalThis.Porcupine = Porcupine;
    globalThis.Blodia = Blodia;
    globalThis.Yeti = Yeti;
}
