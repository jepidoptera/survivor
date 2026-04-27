const CHARACTER_FREEZE_TEMPERATURE_DEGREES = -20;
const CHARACTER_FIRE_WARM_RATE_DEGREES_PER_SECOND = 10;

class FrozenDeathBurstEffect {
    static PARTICLE_COUNT = 60;

    constructor(config = {}) {
        this.type = "frozenDeathBurst";
        this.visible = true;
        this.hideProjectileSprite = true;
        this.x = Number(config.x) || 0;
        this.y = Number(config.y) || 0;
        this.z = Math.max(0, Number(config.z) || 0);
        this.size = Math.max(0.5, Number(config.size) || 1);
        this.height = Math.max(0.6, Number(config.height) || this.size);
        this.width = Math.max(0.4, Number(config.width) || this.size);
        this.snowParticles = [];
        this.particleGraphics = null;
        this.gone = false;
        this._lastUpdateTime = 0;
        this._pausedAt = null;
    }

    spawnParticles() {
        const count = Math.max(8, Math.round(FrozenDeathBurstEffect.PARTICLE_COUNT * Math.max(0.6, this.size)));
        const centerZ = this.z + (this.height * 0.5);
        for (let i = 0; i < count; i++) {
            const spawnHeight = Math.random() * this.height;
            const lateralX = (Math.random() - 0.5) * this.width;
            const lateralY = (Math.random() - 0.5) * this.width * 0.45;
            const spawnX = this.x + lateralX;
            const spawnY = this.y + lateralY;
            const spawnZ = this.z + spawnHeight;
            let burstX = lateralX;
            let burstY = lateralY;
            let burstZ = spawnZ - centerZ;
            const burstLength = Math.hypot(burstX, burstY, burstZ);
            if (!(burstLength > 1e-6)) {
                const fallbackAngle = Math.random() * Math.PI * 2;
                burstX = Math.cos(fallbackAngle);
                burstY = Math.sin(fallbackAngle) * 0.45;
                burstZ = (Math.random() - 0.5) * 0.75;
            }
            const burstNorm = Math.max(1e-6, Math.hypot(burstX, burstY, burstZ));
            const burstSpeed = 0.9 + Math.random() * (1.8 * this.size);
            this.snowParticles.push({
                x: spawnX,
                y: spawnY,
                z: spawnZ,
                vx: (burstX / burstNorm) * burstSpeed,
                vy: (burstY / burstNorm) * burstSpeed,
                vz: (burstZ / burstNorm) * burstSpeed,
                lifeMs: 450 + Math.random() * 450,
                ageMs: 0,
                size: 1.8 + Math.random() * (3.4 * this.size),
                color: Math.random() < 0.2 ? 0xffffff : (Math.random() < 0.65 ? 0x9fd8ff : 0x4f9dff),
                alpha: 0.7 + Math.random() * 0.28,
                shrink: 0.45 + Math.random() * 0.25,
                gravity: 3.6 + Math.random() * 1.8,
                fadeDelayMs: Math.random() * 120,
                airDrag: 0.22 + Math.random() * 0.18,
                groundDrag: 6 + Math.random() * 2.5,
                grounded: false
            });
        }
    }

    updateParticles(deltaSec) {
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
            const gravity = Number.isFinite(particle.gravity) ? Number(particle.gravity) : 0;
            const airDrag = Math.max(0, Math.min(0.999, (Number(particle.airDrag) || 0) * deltaSec));
            const groundDrag = Math.max(0, Math.min(0.999, (Number(particle.groundDrag) || 0) * deltaSec));
            if (!particle.grounded) {
                particle.vz = (Number(particle.vz) || 0) - (gravity * deltaSec);
            }
            particle.x += (Number(particle.vx) || 0) * deltaSec;
            particle.y += (Number(particle.vy) || 0) * deltaSec;
            const nextZ = (Number(particle.z) || 0) + ((Number(particle.vz) || 0) * deltaSec);
            if (nextZ <= 0) {
                particle.z = 0;
                particle.vz = 0;
                particle.grounded = true;
                particle.vx *= Math.max(0, 1 - groundDrag);
                particle.vy *= Math.max(0, 1 - groundDrag);
            } else {
                particle.z = nextZ;
                particle.vx *= Math.max(0, 1 - airDrag);
                particle.vy *= Math.max(0, 1 - airDrag);
            }
        }
    }

    cast() {
        this.spawnParticles();
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
            this.updateParticles(deltaMs / 1000);
            if (!this.snowParticles.length) {
                this.finish();
            }
        }, 1000 / Math.max(1, Number(frameRate) || 60));
        return this;
    }

    finish() {
        this.gone = true;
        if (this.castInterval) {
            clearInterval(this.castInterval);
            this.castInterval = null;
        }
        if (this.pixiSprite && this.pixiSprite.parent) {
            this.pixiSprite.parent.removeChild(this.pixiSprite);
        }
        this.pixiSprite = null;
        if (this.particleGraphics && this.particleGraphics.parent) {
            this.particleGraphics.parent.removeChild(this.particleGraphics);
        }
        this.particleGraphics = null;
    }
}

class Character {
    constructor(type, location, size, map, options = {}) {
        this.type = type;
        this.map = map;
        this.size = Number.isFinite(size) ? size : 1;
        this.z = 0;
        this.travelFrames = 0;
        this.travelZ = 0;
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
        this.acceleration = 50;
        this.movementVector = {x: 0, y: 0};
        this.currentMaxSpeed = 0;
        this._closeCombatState = null;
        this._hitboxCollisionDebug = null;
        this._scriptFrozenUntilMs = 0;
        this.baselineTemperature = 0;
        this.temperature = this.baselineTemperature;
        this.nodeVisitLogLimit = 200;
        this.nodeVisitLog = [];
        this._tracePathState = null;
        /** @type {Inventory} */
        this.inventory = new Inventory();

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
        this.z = this.getNodeStandingZ(this.node);
        this.prevX = this.x;
        this.prevY = this.y;
        this.prevZ = this.z;
        this.destination = null;
        this.path = []; // Array of MapNodes or traversal steps to follow
        this.nextNode = null;
        this.currentPathStep = null;
        this.useAStarPathfinding = false;

        // Pathfinding clearance — how many hex-ring steps around each tile
        // on the path must be obstacle-free for this character to fit.
        // Computed dynamically via getter from current this.size.
        
        // Create hitboxes
        this.visualHitbox = new CircleHitbox(this.x, this.y, this.visualRadius);
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, this.groundRadius);
        this._recordVisitedNode(this.node, "spawn");

        if (this.map && typeof this.map.registerGameObject === "function") {
            this.map.registerGameObject(this);
        }

        const suppressAutoScriptingName = !!(options && options.suppressAutoScriptingName);
        const scriptingApi = (typeof globalThis !== "undefined" && globalThis.Scripting)
            ? globalThis.Scripting
            : null;
        if (!suppressAutoScriptingName && scriptingApi && typeof scriptingApi.ensureObjectScriptingName === "function") {
            scriptingApi.ensureObjectScriptingName(this, { map: this.map });
        }
    }

    dropPowerup(powerupType, options = {}) {
        if (typeof globalThis.dropPowerupNearSource !== "function") return null;
        return globalThis.dropPowerupNearSource(this, powerupType, options);
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

    _getHitboxDebugLabel(entity) {
        if (!entity || typeof entity !== "object") return "unknown";
        if (typeof entity.scriptingName === "string" && entity.scriptingName.trim()) {
            return entity.scriptingName.trim();
        }
        if (typeof entity.name === "string" && entity.name.trim()) {
            return entity.name.trim();
        }
        if (typeof entity.type === "string" && entity.type.trim()) {
            return entity.type.trim();
        }
        if (entity.constructor && typeof entity.constructor.name === "string" && entity.constructor.name) {
            return entity.constructor.name;
        }
        return "unknown";
    }

    _emitCloseCombatLifecycleLog(eventName, target = null, details = {}) {
        if (typeof console === "undefined" || typeof console.log !== "function") return;
        const actorLabel = this._getHitboxDebugLabel(this);
        const targetLabel = this._getHitboxDebugLabel(target);
        const payload = {
            actor: actorLabel,
            target: targetLabel,
            phase: details.phase || null,
            reason: details.reason || null,
            x: Number(this.x),
            y: Number(this.y)
        };
        console.log(`[CloseCombat] ${eventName}`, payload);
    }

    _buildHitboxDebugCandidateSummary(entity, sampleX, sampleY, sampleRadius, options = {}) {
        if (!entity) return null;
        const hitbox = entity.groundPlaneHitbox || entity.visualHitbox || entity.hitbox || null;
        const entityRadius = Number.isFinite(entity.groundRadius)
            ? Math.max(0, Number(entity.groundRadius))
            : (Number.isFinite(entity.visualRadius) ? Math.max(0, Number(entity.visualRadius)) : 0);
        const centerDistance = (this.map && typeof this.map.distanceBetweenPoints === "function")
            ? this.map.distanceBetweenPoints(sampleX, sampleY, Number(entity.x) || 0, Number(entity.y) || 0)
            : Math.hypot((Number(entity.x) || 0) - sampleX, (Number(entity.y) || 0) - sampleY);
        const edgeGap = centerDistance - (sampleRadius + entityRadius);
        const sampleHitbox = this._hitboxDebugSampleHitbox || {
            type: "circle",
            x: sampleX,
            y: sampleY,
            radius: sampleRadius
        };
        sampleHitbox.x = sampleX;
        sampleHitbox.y = sampleY;
        sampleHitbox.radius = sampleRadius;
        this._hitboxDebugSampleHitbox = sampleHitbox;
        const collision = (hitbox && typeof hitbox.intersects === "function")
            ? hitbox.intersects(sampleHitbox)
            : null;
        const overlapMagnitude = (collision && Number.isFinite(collision.pushX) && Number.isFinite(collision.pushY))
            ? Math.hypot(collision.pushX, collision.pushY)
            : Math.max(0, -edgeGap);
        return {
            label: this._getHitboxDebugLabel(entity),
            type: entity.type || (entity.constructor && entity.constructor.name) || "unknown",
            x: Number(entity.x),
            y: Number(entity.y),
            radius: entityRadius,
            centerDistance,
            edgeGap,
            overlap: overlapMagnitude,
            intersects: !!collision,
            pushX: collision && Number.isFinite(collision.pushX) ? Number(collision.pushX) : 0,
            pushY: collision && Number.isFinite(collision.pushY) ? Number(collision.pushY) : 0,
            isTarget: entity === options.target,
            isHitboxMode: typeof entity.isUsingHitboxMovement === "function"
                ? !!entity.isUsingHitboxMovement()
                : !!(entity._closeCombatState && typeof entity._closeCombatState === "object")
        };
    }

    _updateHitboxCollisionDebugSnapshot(patch = {}) {
        const previous = (this._hitboxCollisionDebug && typeof this._hitboxCollisionDebug === "object")
            ? this._hitboxCollisionDebug
            : {};
        this._hitboxCollisionDebug = {
            ...previous,
            ...patch,
            updatedAt: Date.now()
        };
        return this._hitboxCollisionDebug;
    }

    getHitboxCollisionDebugInfo() {
        if (!this._hitboxCollisionDebug || typeof this._hitboxCollisionDebug !== "object") {
            return null;
        }
        try {
            return JSON.parse(JSON.stringify(this._hitboxCollisionDebug));
        } catch (_err) {
            return { ...this._hitboxCollisionDebug };
        }
    }

    distanceToPoint(x, y) {
        if (this.map && typeof this.map.distanceBetweenPoints === "function") {
            return this.map.distanceBetweenPoints(this.x, this.y, x, y);
        }
        return Math.hypot((x - this.x), (y - this.y));
    }

    getStrikeDistance(target = null, baseRange = null) {
        const baseDistance = Number.isFinite(baseRange)
            ? Number(baseRange)
            : (Number.isFinite(this.strikeRange) ? Number(this.strikeRange) : 0);
        const selfRadius = Number.isFinite(this.groundRadius)
            ? this.groundRadius
            : (Number.isFinite(this.visualRadius) ? this.visualRadius : 0);
        const targetRadius = (target && Number.isFinite(target.groundRadius))
            ? target.groundRadius
            : ((target && Number.isFinite(target.visualRadius)) ? target.visualRadius : 0);
        return Math.max(baseDistance, selfRadius + targetRadius);
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

    isTargetWithinStrikeContact(target, options = {}) {
        if (!target || target.gone || target.dead) return false;

        const strikeDistance = Number.isFinite(options.strikeDistance)
            ? Number(options.strikeDistance)
            : this.getStrikeDistance(target, options.strikeRange);
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
                const sweptDistance = this._distanceFromPointToLocalSegment(
                    currentDelta,
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

    cancelPathMovement() {
        this.destination = null;
        this.path = [];
        this.nextNode = null;
        this.currentPathStep = null;
        this.travelFrames = 0;
        this.travelX = 0;
        this.travelY = 0;
        this.travelZ = 0;
    }

    getNodeStandingZ(node) {
        if (this.map && typeof this.map.getNodeBaseZ === "function") {
            return this.map.getNodeBaseZ(node);
        }
        if (node && Number.isFinite(node.baseZ)) {
            return Number(node.baseZ);
        }
        return 0;
    }

    getPathItemDestinationNode(pathItem) {
        if (!pathItem) return null;
        if (pathItem.toNode) return pathItem.toNode;
        return pathItem;
    }

    getTraversalStepWorldPosition(step, progress = 1) {
        if (!step) return null;
        if (typeof step.getWorldPositionAt === "function") {
            const sampledPosition = step.getWorldPositionAt(progress);
            if (
                sampledPosition
                && Number.isFinite(sampledPosition.x)
                && Number.isFinite(sampledPosition.y)
            ) {
                return {
                    x: Number(sampledPosition.x),
                    y: Number(sampledPosition.y),
                    z: Number.isFinite(sampledPosition.z)
                        ? Number(sampledPosition.z)
                        : this.getNodeStandingZ(step.toNode || null)
                };
            }
        }
        const fromNode = step.fromNode || this.node || null;
        const toNode = step.toNode || null;
        if (!toNode) return null;
        const clampedProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, Number(progress))) : 1;
        if (!fromNode) {
            return {
                x: Number(toNode.x),
                y: Number(toNode.y),
                z: this.getNodeStandingZ(toNode)
            };
        }
        const x = fromNode.x + ((this.map && typeof this.map.shortestDeltaX === "function")
            ? this.map.shortestDeltaX(fromNode.x, toNode.x)
            : (toNode.x - fromNode.x)) * clampedProgress;
        const y = fromNode.y + ((this.map && typeof this.map.shortestDeltaY === "function")
            ? this.map.shortestDeltaY(fromNode.y, toNode.y)
            : (toNode.y - fromNode.y)) * clampedProgress;
        const fromZ = this.getNodeStandingZ(fromNode);
        const toZ = this.getNodeStandingZ(toNode);
        return {
            x,
            y,
            z: fromZ + (toZ - fromZ) * clampedProgress
        };
    }

    resolvePathStep(pathItem, fromNode = null) {
        if (!pathItem) return null;
        if (pathItem.toNode) return pathItem;

        const originNode = fromNode || this.node || null;
        const destinationNode = pathItem;
        const directionIndex = (
            originNode
            && Array.isArray(originNode.neighbors)
            && originNode.neighbors.indexOf(destinationNode) >= 0
        )
            ? originNode.neighbors.indexOf(destinationNode)
            : null;

        return {
            fromNode: originNode,
            toNode: destinationNode,
            type: "planar",
            directionIndex,
            getWorldPositionAt: (progress = 1) => this.getTraversalStepWorldPosition({
                fromNode: originNode,
                toNode: destinationNode
            }, progress)
        };
    }

    getVectorMovementInputSpeedMultiplier(options = {}) {
        return Number.isFinite(options.speedMultiplier)
            ? Math.max(0, Number(options.speedMultiplier))
            : 1;
    }

    getVectorMovementEnvironmentSpeedMultiplier(_options = {}) {
        return 1;
    }

    getVectorMovementMaxSpeed(options = {}) {
        const baseSpeed = this.getEffectiveMovementSpeed(this.speed);
        const inputSpeedMultiplier = this.getVectorMovementInputSpeedMultiplier(options);
        const environmentSpeedMultiplier = this.getVectorMovementEnvironmentSpeedMultiplier(options);
        return baseSpeed * inputSpeedMultiplier * environmentSpeedMultiplier;
    }

    getVectorMovementCollisionRadius(_options = {}) {
        return Number.isFinite(this.groundRadius)
            ? Math.max(0, Number(this.groundRadius))
            : 0;
    }

    getVectorMovementSearchPadding(radius, _options = {}) {
        const resolvedRadius = Number.isFinite(radius) ? Math.max(0, Number(radius)) : 0;
        return Math.max(2, resolvedRadius + 1.5);
    }

    getVectorMovementSearchNodes(newX, newY, padding) {
        if (!this.map || typeof this.map.worldToNode !== "function") {
            return [];
        }

        const sampledNodes = [
            this.map.worldToNode(newX, newY),
            this.map.worldToNode(newX - padding, newY - padding),
            this.map.worldToNode(newX - padding, newY + padding),
            this.map.worldToNode(newX + padding, newY - padding),
            this.map.worldToNode(newX + padding, newY + padding)
        ];
        const uniqueNodes = [];
        const seen = new Set();
        for (let i = 0; i < sampledNodes.length; i++) {
            const node = sampledNodes[i];
            if (!node) continue;
            const key = `${Number(node.xindex)}:${Number(node.yindex)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            uniqueNodes.push(node);
        }
        return uniqueNodes;
    }

    doesObjectBlockVectorMovement(obj, _options = {}) {
        if (!obj || obj === this || obj.gone || !obj.groundPlaneHitbox) return false;
        if (typeof globalThis !== "undefined" && typeof globalThis.doesObjectBlockPassage === "function") {
            return !!globalThis.doesObjectBlockPassage(obj);
        }
        const sinkState = (obj && typeof obj === "object" && obj._scriptSinkState && typeof obj._scriptSinkState === "object")
            ? obj._scriptSinkState
            : null;
        return !!(obj.isPassable === false && (!sinkState || sinkState.nonBlocking === false));
    }

    collectNearbyBlockingObjects(newX, newY, radius, options = {}) {
        const nearbyObjects = [];
        if (!this.map || typeof this.map.worldToNode !== "function") {
            return nearbyObjects;
        }
        const padding = this.getVectorMovementSearchPadding(radius, options);
        const searchNodes = this.getVectorMovementSearchNodes(newX, newY, padding);
        if (searchNodes.length === 0) return nearbyObjects;

        const xIndices = searchNodes.map(node => Number(node.xindex));
        const yIndices = searchNodes.map(node => Number(node.yindex));
        const minXIndex = Math.min(...xIndices);
        const maxXIndex = Math.max(...xIndices);
        const minYIndex = Math.min(...yIndices);
        const maxYIndex = Math.max(...yIndices);

        if (typeof this.map.getNodesInIndexWindow === "function") {
            const xStart = minXIndex - 1;
            const xEnd = maxXIndex + 1;
            const yStart = minYIndex - 1;
            const yEnd = maxYIndex + 1;
            const nearbyNodes = this.map.getNodesInIndexWindow(xStart, xEnd, yStart, yEnd);
            for (let i = 0; i < nearbyNodes.length; i++) {
                const node = nearbyNodes[i];
                if (!node || !node.objects) continue;
                for (const obj of node.objects) {
                    if (!this.doesObjectBlockVectorMovement(obj, options)) continue;
                    nearbyObjects.push(obj);
                }
            }
            return nearbyObjects;
        }

        const mapWidth = Number.isFinite(this.map.width) ? this.map.width : 0;
        const mapHeight = Number.isFinite(this.map.height) ? this.map.height : 0;
    const xStart = Math.max(minXIndex - 1, 0);
    const xEnd = Math.min(maxXIndex + 1, Math.max(0, mapWidth - 1));
    const yStart = Math.max(minYIndex - 1, 0);
    const yEnd = Math.min(maxYIndex + 1, Math.max(0, mapHeight - 1));

        for (let x = xStart; x <= xEnd; x++) {
            for (let y = yStart; y <= yEnd; y++) {
                if (!this.map.nodes[x] || !this.map.nodes[x][y] || !this.map.nodes[x][y].objects) continue;
                const nodeObjects = this.map.nodes[x][y].objects;
                for (const obj of nodeObjects) {
                    if (!this.doesObjectBlockVectorMovement(obj, options)) continue;
                    nearbyObjects.push(obj);
                }
            }
        }
        return nearbyObjects;
    }

    doesCharacterBlockVectorMovement(otherCharacter, options = {}) {
        if (!otherCharacter || otherCharacter === this) return false;
        if (otherCharacter === options.target || otherCharacter === options.ignoreCharacter) return false;
        if (otherCharacter.gone || otherCharacter.dead) return false;
        return !!otherCharacter.groundPlaneHitbox;
    }

    isUsingHitboxMovement() {
        return !!(this._closeCombatState && typeof this._closeCombatState === "object" && !this.gone && !this.dead);
    }

    getCharacterVectorMovementCandidates() {
        const candidates = [];
        const seen = new Set();

        const maybeAdd = (candidate) => {
            if (!candidate || seen.has(candidate)) return;
            seen.add(candidate);
            candidates.push(candidate);
        };

        const wizardCandidates = [
            (typeof globalThis !== "undefined" && globalThis.wizard) ? globalThis.wizard : null,
            (typeof wizard !== "undefined" && wizard) ? wizard : null
        ];
        for (let i = 0; i < wizardCandidates.length; i++) {
            maybeAdd(wizardCandidates[i]);
        }

        const animalCandidates = [
            (typeof globalThis !== "undefined" && Array.isArray(globalThis.animals)) ? globalThis.animals : null,
            (typeof animals !== "undefined" && Array.isArray(animals)) ? animals : null
        ];
        for (let i = 0; i < animalCandidates.length; i++) {
            const list = animalCandidates[i];
            if (!Array.isArray(list)) continue;
            list.forEach(maybeAdd);
        }

        return candidates;
    }

    collectNearbyBlockingCharacters(newX, newY, radius, options = {}) {
        const nearbyCharacters = [];
        const candidates = this.getCharacterVectorMovementCandidates();
        const resolvedRadius = Number.isFinite(radius) ? Math.max(0, Number(radius)) : 0;
        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i];
            if (!this.doesCharacterBlockVectorMovement(candidate, options)) continue;
            const candidateRadius = Number.isFinite(candidate.groundRadius)
                ? Math.max(0, Number(candidate.groundRadius))
                : (Number.isFinite(candidate.visualRadius) ? Math.max(0, Number(candidate.visualRadius)) : 0);
            const distance = (this.map && typeof this.map.distanceBetweenPoints === "function")
                ? this.map.distanceBetweenPoints(newX, newY, candidate.x, candidate.y)
                : Math.hypot(candidate.x - newX, candidate.y - newY);
            const maxDistance = resolvedRadius + candidateRadius + this.getVectorMovementSearchPadding(radius, options);
            if (distance <= maxDistance) {
                nearbyCharacters.push(candidate);
            }
        }
        return nearbyCharacters;
    }

    prepareVectorMovementContext(newX, newY, radius, options = {}) {
        const forceTouchedObjects = (this._movementForceTouchedObjects instanceof Set)
            ? this._movementForceTouchedObjects
            : new Set();
        forceTouchedObjects.clear();
        this._movementForceTouchedObjects = forceTouchedObjects;
        const nearbyObjects = this.collectNearbyBlockingObjects(newX, newY, radius, options);
        const nearbyCharacters = options.includeCharacterBlockers === true
            ? this.collectNearbyBlockingCharacters(newX, newY, radius, options)
            : [];
        this._updateHitboxCollisionDebugSnapshot({
            actor: this._getHitboxDebugLabel(this),
            actorType: this.type || (this.constructor && this.constructor.name) || "unknown",
            currentPosition: { x: Number(this.x), y: Number(this.y) },
            candidatePosition: { x: Number(newX), y: Number(newY) },
            movementVector: {
                x: Number(this.movementVector && this.movementVector.x) || 0,
                y: Number(this.movementVector && this.movementVector.y) || 0
            },
            frameRate: Number(this.frameRate) || 0,
            radius: Number(radius) || 0,
            includeCharacterBlockers: options.includeCharacterBlockers === true,
            closeCombatPhase: this._closeCombatState && this._closeCombatState.phase ? this._closeCombatState.phase : null,
            nearbyObjectBlockers: nearbyObjects.map(obj => this._buildHitboxDebugCandidateSummary(obj, newX, newY, radius, options)),
            nearbyCharacterBlockers: nearbyCharacters.map(char => this._buildHitboxDebugCandidateSummary(char, newX, newY, radius, options)),
            staticCollisions: [],
            dynamicCharacterInteractions: [],
            dynamicResolutionIterations: 0
        });
        return {
            nearbyObjects,
            nearbyCharacters,
            forceTouchedObjects
        };
    }

    canBypassVectorMovementCollisions(_currentX, _currentY, _newX, _newY, _radius, _context, _options = {}) {
        return false;
    }

    onVectorMovementApplied(_movementResult, _options = {}) {
    }

    _setVectorMovementPositionRaw(targetX, targetY) {
        const wrappedX = this.map && typeof this.map.wrapWorldX === "function"
            ? this.map.wrapWorldX(targetX)
            : targetX;
        const wrappedY = this.map && typeof this.map.wrapWorldY === "function"
            ? this.map.wrapWorldY(targetY)
            : targetY;
        this.x = wrappedX;
        this.y = wrappedY;
        this.updateHitboxes();
        return { targetX, targetY, wrappedX, wrappedY };
    }

    resolveDynamicCharacterHitboxInteractions(movementContext = {}, options = {}) {
        const nearbyCharacters = Array.isArray(movementContext.nearbyCharacters)
            ? movementContext.nearbyCharacters
            : [];
        if (nearbyCharacters.length === 0 || !this.groundPlaneHitbox) return;

        let changed = false;
        const interactionLog = (this._hitboxCollisionDebug && Array.isArray(this._hitboxCollisionDebug.dynamicCharacterInteractions))
            ? this._hitboxCollisionDebug.dynamicCharacterInteractions
            : [];

        for (let i = 0; i < nearbyCharacters.length; i++) {
            const other = nearbyCharacters[i];
            if (!this.doesCharacterBlockVectorMovement(other, options) || !other.groundPlaneHitbox) continue;

            const collision = other.groundPlaneHitbox.intersects(this.groundPlaneHitbox);
            if (!collision || collision.pushX === undefined || collision.pushY === undefined) continue;

            const overlap = Math.hypot(collision.pushX, collision.pushY);
            if (!(overlap > 0)) continue;

            const normalX = collision.pushX / overlap;
            const normalY = collision.pushY / overlap;
            const otherDynamic = typeof other.isUsingHitboxMovement === "function"
                ? other.isUsingHitboxMovement()
                : !!(other._closeCombatState && typeof other._closeCombatState === "object");
            const selfShare = otherDynamic ? 0.5 : 1;
            const otherShare = otherDynamic ? 0.5 : 0;
            const separation = overlap + 0.01;
            changed = true;
            const selfVector = this.movementVector && typeof this.movementVector === "object"
                ? this.movementVector
                : { x: 0, y: 0 };
            const otherVector = (other.movementVector && typeof other.movementVector === "object")
                ? other.movementVector
                : { x: 0, y: 0 };
            const relativeNormalSpeed = (Number(selfVector.x) - Number(otherVector.x)) * normalX
                + (Number(selfVector.y) - Number(otherVector.y)) * normalY;
            interactionLog.push({
                label: this._getHitboxDebugLabel(other),
                overlap,
                normalX,
                normalY,
                relativeNormalSpeed,
                selfShare,
                otherShare,
                otherDynamic
            });

            this._setVectorMovementPositionRaw(
                this.x + normalX * separation * selfShare,
                this.y + normalY * separation * selfShare
            );

            if (otherShare > 0 && typeof other._setVectorMovementPositionRaw === "function") {
                other._setVectorMovementPositionRaw(
                    other.x - normalX * separation * otherShare,
                    other.y - normalY * separation * otherShare
                );
                if (
                    typeof other.prepareVectorMovementContext === "function" &&
                    typeof other.getVectorMovementCollisionRadius === "function" &&
                    typeof other._resolveStaticVectorMovementCandidate === "function"
                ) {
                    const otherRadius = other.getVectorMovementCollisionRadius(options);
                    const otherContext = other.prepareVectorMovementContext(other.x, other.y, otherRadius, {
                        ...options,
                        includeCharacterBlockers: false,
                        ignoreCharacter: this
                    }) || {};
                    const otherResolved = other._resolveStaticVectorMovementCandidate(
                        other.x,
                        other.y,
                        otherRadius,
                        otherContext,
                        {
                            ...options,
                            includeCharacterBlockers: false,
                            ignoreCharacter: this
                        }
                    );
                    other._setVectorMovementPositionRaw(otherResolved.x, otherResolved.y);
                }
            }

            if (relativeNormalSpeed < 0) {
                if (otherDynamic) {
                    const halfImpulse = relativeNormalSpeed * 0.5;
                    this.movementVector.x -= normalX * halfImpulse;
                    this.movementVector.y -= normalY * halfImpulse;
                    other.movementVector.x += normalX * halfImpulse;
                    other.movementVector.y += normalY * halfImpulse;
                } else {
                    this.movementVector.x -= normalX * relativeNormalSpeed;
                    this.movementVector.y -= normalY * relativeNormalSpeed;
                }
            }

        }

        return changed;
    }

    _resolveStaticVectorMovementCandidate(candidateX, candidateY, movementRadius, movementContext = {}, options = {}) {
        let testX = candidateX;
        let testY = candidateY;
        let iteration = 0;
        const maxIterations = 3;
        const nearbyObjects = Array.isArray(movementContext.nearbyObjects) ? movementContext.nearbyObjects : [];
        let collided = false;
        const staticCollisionLog = (this._hitboxCollisionDebug && Array.isArray(this._hitboxCollisionDebug.staticCollisions))
            ? this._hitboxCollisionDebug.staticCollisions
            : [];

        while (iteration < maxIterations) {
            iteration++;
            const testHitbox = this._movementTestHitbox || { type: "circle", x: testX, y: testY, radius: movementRadius };
            testHitbox.x = testX;
            testHitbox.y = testY;
            testHitbox.radius = movementRadius;
            this._movementTestHitbox = testHitbox;

            let totalPushX = 0;
            let totalPushY = 0;
            let maxPushLen = 0;
            let hasCollision = false;

            for (const obj of nearbyObjects) {
                const collision = obj.groundPlaneHitbox.intersects(testHitbox);
                if (collision && collision.pushX !== undefined) {
                    hasCollision = true;
                    totalPushX += collision.pushX;
                    totalPushY += collision.pushY;
                    const pushLen = Math.hypot(collision.pushX, collision.pushY);
                    maxPushLen = Math.max(maxPushLen, pushLen);
                    if (movementContext.forceTouchedObjects instanceof Set) {
                        movementContext.forceTouchedObjects.add(obj);
                    }
                    staticCollisionLog.push({
                        label: this._getHitboxDebugLabel(obj),
                        iteration,
                        sampleX: testX,
                        sampleY: testY,
                        pushX: Number(collision.pushX) || 0,
                        pushY: Number(collision.pushY) || 0,
                        overlap: pushLen
                    });
                }
            }

            if (!hasCollision) {
                return { x: testX, y: testY, collided };
            }

            collided = true;
            let pushLen = Math.hypot(totalPushX, totalPushY);
            if (pushLen > maxPushLen && maxPushLen > 0) {
                const scale = maxPushLen / pushLen;
                totalPushX *= scale;
                totalPushY *= scale;
                pushLen = maxPushLen;
            }

            if (pushLen <= 0) break;

            const normalX = totalPushX / pushLen;
            const normalY = totalPushY / pushLen;
            const compressionThreshold = 0.15;
            const compression = Math.max(0, pushLen - compressionThreshold);

            if (compression > 0) {
                const resistanceFactor = Math.min(1, compression / 0.1);
                const normalComponent = this.movementVector.x * normalX + this.movementVector.y * normalY;
                if (normalComponent > 0) {
                    this.movementVector.x -= normalX * normalComponent * resistanceFactor;
                    this.movementVector.y -= normalY * normalComponent * resistanceFactor;
                }
            } else {
                const dampingFactor = 1 - (pushLen / compressionThreshold) * 0.4;
                this.movementVector.x *= dampingFactor;
                this.movementVector.y *= dampingFactor;
                const normalComponent = this.movementVector.x * normalX + this.movementVector.y * normalY;
                if (normalComponent > 0) {
                    this.movementVector.x -= normalX * normalComponent * 0.2;
                    this.movementVector.y -= normalY * normalComponent * 0.2;
                }
            }

            const pushOutDistance = pushLen + 0.01;
            testX = this.x + normalX * pushOutDistance + this.movementVector.x / Math.max(1, Number(this.frameRate) || 1);
            testY = this.y + normalY * pushOutDistance + this.movementVector.y / Math.max(1, Number(this.frameRate) || 1);
        }

        const testHitbox = this._movementTestHitbox || { type: "circle", x: testX, y: testY, radius: movementRadius };
        testHitbox.x = testX;
        testHitbox.y = testY;
        testHitbox.radius = movementRadius;
        this._movementTestHitbox = testHitbox;

        let totalPushX = 0;
        let totalPushY = 0;
        let maxPushLen = 0;
        for (const obj of nearbyObjects) {
            const collision = obj.groundPlaneHitbox.intersects(testHitbox);
            if (collision && collision.pushX !== undefined) {
                totalPushX += collision.pushX;
                totalPushY += collision.pushY;
                const pushLen = Math.hypot(collision.pushX, collision.pushY);
                maxPushLen = Math.max(maxPushLen, pushLen);
                if (movementContext.forceTouchedObjects instanceof Set) {
                    movementContext.forceTouchedObjects.add(obj);
                }
                staticCollisionLog.push({
                    label: this._getHitboxDebugLabel(obj),
                    iteration: "final",
                    sampleX: testX,
                    sampleY: testY,
                    pushX: Number(collision.pushX) || 0,
                    pushY: Number(collision.pushY) || 0,
                    overlap: pushLen
                });
            }
        }

        if (maxPushLen > 0) {
            collided = true;
            const pushLen = Math.hypot(totalPushX, totalPushY);
            if (pushLen > maxPushLen && maxPushLen > 0) {
                const scale = maxPushLen / pushLen;
                totalPushX *= scale;
                totalPushY *= scale;
            }
            const normalMag = Math.hypot(totalPushX, totalPushY);
            if (normalMag > 0) {
                const normalX = totalPushX / normalMag;
                const normalY = totalPushY / normalMag;
                const pushOutDistance = maxPushLen + 0.01;
                return {
                    x: this.x + normalX * pushOutDistance,
                    y: this.y + normalY * pushOutDistance,
                    collided
                };
            }
        }

        return { x: candidateX, y: candidateY, collided };
    }

    _resolveHitboxMovementConstraints(candidateX, candidateY, movementRadius, movementContext = {}, options = {}) {
        let resolved = this._resolveStaticVectorMovementCandidate(candidateX, candidateY, movementRadius, movementContext, options);
        this._setVectorMovementPositionRaw(resolved.x, resolved.y);
        let dynamicIterations = 0;

        if (options.includeCharacterBlockers !== true) {
            this._updateHitboxCollisionDebugSnapshot({
                resolvedPosition: { x: Number(resolved.x), y: Number(resolved.y) },
                dynamicResolutionIterations: dynamicIterations
            });
            return resolved;
        }

        const maxConstraintIterations = Number.isFinite(options.hitboxConstraintIterations)
            ? Math.max(1, Math.floor(options.hitboxConstraintIterations))
            : 4;

        for (let i = 0; i < maxConstraintIterations; i++) {
            dynamicIterations = i + 1;
            const dynamicChanged = !!this.resolveDynamicCharacterHitboxInteractions(movementContext, options);
            const staticResolved = this._resolveStaticVectorMovementCandidate(this.x, this.y, movementRadius, movementContext, options);
            this._setVectorMovementPositionRaw(staticResolved.x, staticResolved.y);
            resolved = {
                x: staticResolved.x,
                y: staticResolved.y,
                collided: resolved.collided || staticResolved.collided || dynamicChanged
            };
            if (!dynamicChanged && !staticResolved.collided) {
                break;
            }
        }

        this._updateHitboxCollisionDebugSnapshot({
            resolvedPosition: { x: Number(resolved.x), y: Number(resolved.y) },
            dynamicResolutionIterations: dynamicIterations
        });

        return resolved;
    }

    _applyVectorMovementPosition(targetX, targetY, options = {}, movementContext = null) {
        if (
            this.map &&
            typeof this.map.canOccupyWorldPosition === "function" &&
            this.map.canOccupyWorldPosition(targetX, targetY, this, options) !== true
        ) {
            if (this.movementVector && typeof this.movementVector === "object") {
                this.movementVector.x = 0;
                this.movementVector.y = 0;
            }
            return false;
        }
        const position = this._setVectorMovementPositionRaw(targetX, targetY);
        this.onVectorMovementApplied({
            previousX: this.prevX,
            previousY: this.prevY,
            ...position
        }, options);
        return true;
    }

    moveDirection(vector, options = {}) {
        if (this.isFrozen()) {
            this.applyFrozenState({ clearMoveTimeout: false });
            return false;
        }
        const lockMovementVector = !!options.lockMovementVector;
        const maxSpeed = this.getVectorMovementMaxSpeed(options);
        this.currentMaxSpeed = maxSpeed;
        this.isMovingBackward = !!options.animateBackward;

        const inputLen = vector ? Math.hypot(vector.x || 0, vector.y || 0) : 0;
        if (lockMovementVector) {
            // Preserve momentum and ignore steering/braking input.
        } else if (vector && inputLen > 1e-6) {
            const nx = vector.x / inputLen;
            const ny = vector.y / inputLen;

            const desiredDot = this.movementVector.x * nx + this.movementVector.y * ny;
            if (desiredDot < 0) {
                this.movementVector.x -= nx * desiredDot;
                this.movementVector.y -= ny * desiredDot;
                this.movementVector.x *= 0.5;
                this.movementVector.y *= 0.5;
            }

            const accelerationFactor = (Number.isFinite(this.acceleration) ? this.acceleration : 0) / Math.max(1, Number(this.frameRate) || 1);
            this.movementVector.x += nx * accelerationFactor;
            this.movementVector.y += ny * accelerationFactor;

            const facingVector = options.facingVector;
            if (
                typeof this.turnToward === "function" &&
                facingVector &&
                Number.isFinite(facingVector.x) &&
                Number.isFinite(facingVector.y) &&
                Math.hypot(facingVector.x, facingVector.y) > 1e-6
            ) {
                const facingTurnStrength = Number.isFinite(options.facingTurnStrength)
                    ? Math.max(0, Math.min(1, options.facingTurnStrength))
                    : 1;
                this.turnToward(facingVector.x, facingVector.y, facingTurnStrength);
            } else if (typeof this.turnToward === "function") {
                this.turnToward(nx, ny);
            }
        } else {
            this.isMovingBackward = false;
            const currentMag = Math.hypot(this.movementVector.x, this.movementVector.y);
            if (currentMag > 0) {
                const decelerationFactor = (Number.isFinite(this.acceleration) ? this.acceleration : 0) / Math.max(1, Number(this.frameRate) || 1);
                const newMag = Math.max(0, currentMag - decelerationFactor);
                if (newMag === 0) {
                    this.movementVector.x = 0;
                    this.movementVector.y = 0;
                } else {
                    const scale = newMag / currentMag;
                    this.movementVector.x *= scale;
                    this.movementVector.y *= scale;
                }
            }
        }

        const currentMag = Math.hypot(this.movementVector.x, this.movementVector.y);
        if (currentMag > maxSpeed && currentMag > 0) {
            const scale = maxSpeed / currentMag;
            this.movementVector.x *= scale;
            this.movementVector.y *= scale;
        }

        if (Math.hypot(this.movementVector.x, this.movementVector.y) < 0.001) {
            this.moving = false;
            return false;
        }

        this.moving = true;
        this.prevX = this.x;
        this.prevY = this.y;
        this.prevZ = this.z;

        const newX = this.x + this.movementVector.x / Math.max(1, Number(this.frameRate) || 1);
        const newY = this.y + this.movementVector.y / Math.max(1, Number(this.frameRate) || 1);
        const movementRadius = this.getVectorMovementCollisionRadius(options);
        const movementContext = this.prepareVectorMovementContext(newX, newY, movementRadius, options) || {};

        if (this.canBypassVectorMovementCollisions(this.x, this.y, newX, newY, movementRadius, movementContext, options)) {
            return this._applyVectorMovementPosition(newX, newY, options, movementContext);
        }

        const resolved = this._resolveHitboxMovementConstraints(newX, newY, movementRadius, movementContext, options);
        return this._applyVectorMovementPosition(resolved.x, resolved.y, options, movementContext);
    }

    getTargetMovementVelocity(target) {
        if (!target) return { x: 0, y: 0 };
        if (
            target.movementVector &&
            Number.isFinite(target.movementVector.x) &&
            Number.isFinite(target.movementVector.y)
        ) {
            return {
                x: Number(target.movementVector.x),
                y: Number(target.movementVector.y)
            };
        }
        if (Number.isFinite(target.prevX) && Number.isFinite(target.prevY)) {
            const delta = this._getLocalWrappedDelta(target.prevX, target.prevY, target.x, target.y);
            const velocityFrameRate = Number.isFinite(target.frameRate) && target.frameRate > 0
                ? Number(target.frameRate)
                : Math.max(1, Number(this.frameRate) || 1);
            return {
                x: delta.x * velocityFrameRate,
                y: delta.y * velocityFrameRate
            };
        }
        return { x: 0, y: 0 };
    }

    predictTargetPosition(target, lookaheadSeconds = 0) {
        if (!target) return null;
        const lookahead = Number.isFinite(lookaheadSeconds) ? Math.max(0, Number(lookaheadSeconds)) : 0;
        const velocity = this.getTargetMovementVelocity(target);
        let x = Number(target.x) || 0;
        let y = Number(target.y) || 0;
        if (lookahead > 0) {
            x += velocity.x * lookahead;
            y += velocity.y * lookahead;
        }
        if (this.map && typeof this.map.wrapWorldX === "function") {
            x = this.map.wrapWorldX(x);
        }
        if (this.map && typeof this.map.wrapWorldY === "function") {
            y = this.map.wrapWorldY(y);
        }
        return { x, y, velocityX: velocity.x, velocityY: velocity.y };
    }

    getPredictedCloseCombatTargetPoint(target, options = {}) {
        if (!target) return null;
        const lungeRadius = Number.isFinite(options.lungeRadius)
            ? Math.max(0, Number(options.lungeRadius))
            : Math.max(0, Number(this.lungeRadius) || 0);
        const approachSpeed = Number.isFinite(options.approachSpeed)
            ? Math.max(1e-4, Number(options.approachSpeed))
            : Math.max(1e-4, this.getEffectiveMovementSpeed(this.runSpeed));
        const currentDistance = this.distanceToPoint(target.x, target.y);
        const timeToClose = Math.max(0, currentDistance - lungeRadius) / approachSpeed;
        const extraLeadSeconds = Number.isFinite(options.predictionLeadSeconds)
            ? Math.max(0, Number(options.predictionLeadSeconds))
            : 0;
        return this.predictTargetPosition(target, timeToClose + extraLeadSeconds);
    }

    getCloseCombatInterceptPoint(target, options = {}) {
        if (!target) return null;
        const interceptSpeed = Number.isFinite(options.interceptSpeed)
            ? Math.max(1e-4, Number(options.interceptSpeed))
            : Math.max(
                1e-4,
                Number(options.lungeSpeed)
                || Number(options.approachSpeed)
                || Number(this.lungeSpeed)
                || Number(this.runSpeed)
                || 1
            );
        const strikeDistance = Number.isFinite(options.strikeDistance)
            ? Math.max(0, Number(options.strikeDistance))
            : this.getStrikeDistance(target, options.strikeRange);
        const maxDistance = Number.isFinite(options.maxDistance)
            ? Math.max(0, Number(options.maxDistance))
            : Number.POSITIVE_INFINITY;
        const maxTimeSeconds = Number.isFinite(options.maxTimeSeconds)
            ? Math.max(0, Number(options.maxTimeSeconds))
            : Number.POSITIVE_INFINITY;
        const relative = this._getLocalWrappedDelta(this.x, this.y, target.x, target.y);
        const velocity = this.getTargetMovementVelocity(target);
        const relativeDistance = Math.hypot(relative.x, relative.y);

        let interceptTimeSeconds = null;
        if (relativeDistance <= strikeDistance) {
            interceptTimeSeconds = 0;
        } else {
            const a = (velocity.x * velocity.x + velocity.y * velocity.y) - (interceptSpeed * interceptSpeed);
            const b = 2 * ((relative.x * velocity.x) + (relative.y * velocity.y) - (interceptSpeed * strikeDistance));
            const c = (relativeDistance * relativeDistance) - (strikeDistance * strikeDistance);
            const epsilon = 1e-8;

            if (Math.abs(a) <= epsilon) {
                if (Math.abs(b) <= epsilon) {
                    interceptTimeSeconds = c <= 0 ? 0 : null;
                } else {
                    const linearRoot = -c / b;
                    interceptTimeSeconds = linearRoot >= 0 ? linearRoot : null;
                }
            } else {
                const discriminant = (b * b) - (4 * a * c);
                if (discriminant >= 0) {
                    const sqrtDiscriminant = Math.sqrt(discriminant);
                    const candidateRoots = [
                        (-b - sqrtDiscriminant) / (2 * a),
                        (-b + sqrtDiscriminant) / (2 * a)
                    ].filter(root => Number.isFinite(root) && root >= 0);
                    if (candidateRoots.length > 0) {
                        interceptTimeSeconds = Math.min(...candidateRoots);
                    }
                }
            }
        }

        if (!Number.isFinite(interceptTimeSeconds) || interceptTimeSeconds < 0) {
            return null;
        }
        if (interceptTimeSeconds > maxTimeSeconds) {
            return null;
        }

        let x = Number(target.x) + velocity.x * interceptTimeSeconds;
        let y = Number(target.y) + velocity.y * interceptTimeSeconds;
        if (this.map && typeof this.map.wrapWorldX === "function") {
            x = this.map.wrapWorldX(x);
        }
        if (this.map && typeof this.map.wrapWorldY === "function") {
            y = this.map.wrapWorldY(y);
        }

        const travelDistance = this.distanceToPoint(x, y);
        if (travelDistance > maxDistance) {
            return null;
        }

        return {
            x,
            y,
            timeSeconds: interceptTimeSeconds,
            travelDistance,
            velocityX: velocity.x,
            velocityY: velocity.y,
            strikeDistance
        };
    }

    resolveCloseCombatLungeTargetPoint(target, state = null, options = {}) {
        if (!target) return null;
        if (typeof options.lungeTargetResolver === "function") {
            const resolvedPoint = options.lungeTargetResolver(target, state, this, options);
            if (
                resolvedPoint &&
                Number.isFinite(resolvedPoint.x) &&
                Number.isFinite(resolvedPoint.y)
            ) {
                return resolvedPoint;
            }
            return null;
        }
        if (options.useCloseCombatInterceptPoint === true || options.requireCommittedLungeTarget === true) {
            return this.getCloseCombatInterceptPoint(target, {
                ...options,
                interceptSpeed: Number.isFinite(options.interceptSpeed)
                    ? Number(options.interceptSpeed)
                    : (Number.isFinite(options.lungeSpeed) ? Number(options.lungeSpeed) : Number(this.lungeSpeed) || Number(this.runSpeed) || 1),
                maxDistance: Number.isFinite(options.maxDistance)
                    ? Number(options.maxDistance)
                    : (Number.isFinite(options.lungeRadius) ? Number(options.lungeRadius) : Number(this.lungeRadius) || 0)
            });
        }
        return null;
    }

    isTargetCloseEnoughToLunge(target, options = {}) {
        if (!target) return false;
        const lungeRadius = Number.isFinite(options.lungeRadius)
            ? Math.max(0, Number(options.lungeRadius))
            : Math.max(0, Number(this.lungeRadius) || 0);
        if (!(lungeRadius > 0)) return false;

        if (
            options.targetPoint &&
            Number.isFinite(options.targetPoint.x) &&
            Number.isFinite(options.targetPoint.y)
        ) {
            return this.distanceToPoint(options.targetPoint.x, options.targetPoint.y) <= lungeRadius;
        }

        const approachSpeed = Number.isFinite(options.approachSpeed)
            ? Math.max(1e-4, Number(options.approachSpeed))
            : Math.max(1e-4, this.getEffectiveMovementSpeed(this.runSpeed));
        const currentDistance = this.distanceToPoint(target.x, target.y);
        if (currentDistance <= lungeRadius) return true;

        const predictedTarget = this.getPredictedCloseCombatTargetPoint(target, {
            ...options,
            lungeRadius,
            approachSpeed
        });
        if (!predictedTarget) return false;
        return this.distanceToPoint(predictedTarget.x, predictedTarget.y) <= lungeRadius;
    }

    hasDirectCloseCombatCorridor(target, options = {}) {
        if (!target) return false;
        const targetPoint = options.targetPoint || this.getPredictedCloseCombatTargetPoint(target, options);
        if (!targetPoint || !Number.isFinite(targetPoint.x) || !Number.isFinite(targetPoint.y)) {
            return false;
        }
        const strikeDistance = Number.isFinite(options.strikeDistance)
            ? Math.max(0, Number(options.strikeDistance))
            : this.getStrikeDistance(target, options.strikeRange);

        const corridorRadius = Number.isFinite(options.corridorRadius)
            ? Math.max(0.05, Number(options.corridorRadius))
            : Math.max(0.05, this.getVectorMovementCollisionRadius(options));
        const localDelta = this._getLocalWrappedDelta(this.x, this.y, targetPoint.x, targetPoint.y);
        const corridorDistanceToTarget = Math.hypot(localDelta.x, localDelta.y);
        if (corridorDistanceToTarget <= 1e-6) return true;
        const desiredDirX = localDelta.x / corridorDistanceToTarget;
        const desiredDirY = localDelta.y / corridorDistanceToTarget;
        const corridorSweepDistance = Math.max(0, corridorDistanceToTarget - strikeDistance);
        if (corridorSweepDistance <= 1e-6) return true;

        const sampleStep = Number.isFinite(options.corridorSampleStep)
            ? Math.max(0.05, Number(options.corridorSampleStep))
            : Math.max(0.15, corridorRadius * 0.5);
        const sampleCount = Math.max(1, Math.ceil(corridorSweepDistance / sampleStep));
        const testHitbox = this._closeCombatCorridorHitbox || {
            type: "circle",
            x: this.x,
            y: this.y,
            radius: corridorRadius
        };
        testHitbox.radius = corridorRadius;
        this._closeCombatCorridorHitbox = testHitbox;

        for (let i = 1; i <= sampleCount; i++) {
            const t = i / sampleCount;
            let sampleX = this.x + desiredDirX * corridorSweepDistance * t;
            let sampleY = this.y + desiredDirY * corridorSweepDistance * t;
            if (this.map && typeof this.map.wrapWorldX === "function") {
                sampleX = this.map.wrapWorldX(sampleX);
            }
            if (this.map && typeof this.map.wrapWorldY === "function") {
                sampleY = this.map.wrapWorldY(sampleY);
            }
            testHitbox.x = sampleX;
            testHitbox.y = sampleY;

            const nearbyObjects = this.collectNearbyBlockingObjects(sampleX, sampleY, corridorRadius, {
                ...options,
                includeCharacterBlockers: options.includeCharacterBlockers !== false,
                target
            });
            if (options.includeCharacterBlockers !== false) {
                nearbyObjects.push(...this.collectNearbyBlockingCharacters(sampleX, sampleY, corridorRadius, {
                    ...options,
                    target
                }));
            }
            for (let j = 0; j < nearbyObjects.length; j++) {
                const obj = nearbyObjects[j];
                if (!obj || !obj.groundPlaneHitbox) continue;
                const collision = obj.groundPlaneHitbox.intersects(testHitbox);
                if (collision && collision.pushX !== undefined) {
                    return false;
                }
            }
        }

        return true;
    }

    shouldCloseCombatCorridorIncludeCharacterBlockers(options = {}) {
        if (Object.prototype.hasOwnProperty.call(options, "corridorIncludesCharacterBlockers")) {
            return options.corridorIncludesCharacterBlockers === true;
        }
        if (Object.prototype.hasOwnProperty.call(options, "closeCombatIgnoreCharacterBlockers")) {
            return options.closeCombatIgnoreCharacterBlockers !== true;
        }
        return false;
    }

    hasCloseCombatLineOfSight(target, _options = {}) {
        if (!target || !this.map || typeof this.map.worldToNode !== "function") return true;
        if (typeof this.map.hasLineOfSight !== "function") return true;
        const actorNode = this.map.worldToNode(this.x, this.y);
        const targetNode = this.map.worldToNode(target.x, target.y);
        if (!actorNode || !targetNode) return true;
        return !!this.map.hasLineOfSight(actorNode, targetNode);
    }

    evaluateCloseCombatOpportunity(target, options = {}) {
        if (!target) {
            return {
                canEngage: false,
                targetPoint: null,
                withinLungeRange: false,
                lineOfSightClear: false,
                corridorClear: false,
                includeCharacterBlockers: this.shouldCloseCombatCorridorIncludeCharacterBlockers(options),
                failReason: "no-target"
            };
        }

        const targetPoint = (
            options.targetPoint &&
            Number.isFinite(options.targetPoint.x) &&
            Number.isFinite(options.targetPoint.y)
        )
            ? options.targetPoint
            : this.getPredictedCloseCombatTargetPoint(target, options);
        if (!targetPoint) {
            return {
                canEngage: false,
                targetPoint: null,
                withinLungeRange: false,
                lineOfSightClear: false,
                corridorClear: false,
                includeCharacterBlockers: this.shouldCloseCombatCorridorIncludeCharacterBlockers(options),
                failReason: "no-target-point"
            };
        }

        const withinLungeRange = this.isTargetCloseEnoughToLunge(target, { ...options, targetPoint });
        const lineOfSightClear = withinLungeRange && this.hasCloseCombatLineOfSight(target, options);
        const includeCharacterBlockers = this.shouldCloseCombatCorridorIncludeCharacterBlockers(options);
        const corridorClear = lineOfSightClear && this.hasDirectCloseCombatCorridor(target, {
            ...options,
            targetPoint,
            includeCharacterBlockers,
            target
        });

        return {
            canEngage: withinLungeRange && lineOfSightClear && corridorClear,
            targetPoint,
            withinLungeRange,
            lineOfSightClear,
            corridorClear,
            includeCharacterBlockers,
            failReason: !withinLungeRange
                ? "out-of-lunge-range"
                : (!lineOfSightClear
                    ? "line-of-sight-blocked"
                    : (corridorClear ? null : "corridor-blocked"))
        };
    }

    canEnterCloseCombat(target, options = {}) {
        return this.evaluateCloseCombatOpportunity(target, options).canEngage;
    }

    shouldReengageCloseCombat(target, options = {}) {
        return this.evaluateCloseCombatOpportunity(target, options).canEngage;
    }

    shouldAbortCloseCombat(target, state = null, options = {}) {
        if (!target) return true;
        if (!state) return true;
        if (
            state.phase === "lunge" &&
            Number.isFinite(state.lungeTargetX) &&
            Number.isFinite(state.lungeTargetY)
        ) {
            return false;
        }
        const now = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
        const abortGraceMs = Number.isFinite(options.closeCombatAbortGraceMs)
            ? Math.max(0, Number(options.closeCombatAbortGraceMs))
            : 250;

        if (this.isTargetWithinStrikeContact(target, {
            strikeDistance: Number.isFinite(options.strikeDistance)
                ? Number(options.strikeDistance)
                : this.getStrikeDistance(target, options.strikeRange)
        })) {
            state.abortBlockedSinceMs = null;
            state.abortReason = null;
            return false;
        }

        const opportunity = this.evaluateCloseCombatOpportunity(target, options);
        const canContinue = opportunity.canEngage;

        if (canContinue) {
            state.abortBlockedSinceMs = null;
            state.abortReason = null;
            return false;
        }

        if (!Number.isFinite(state.abortBlockedSinceMs)) {
            state.abortBlockedSinceMs = now;
            state.abortReason = opportunity.failReason || "close-combat-invalid";
        } else if (!state.abortReason) {
            state.abortReason = opportunity.failReason || "close-combat-invalid";
        }

        return (now - state.abortBlockedSinceMs) >= abortGraceMs;
    }

    resetCloseCombatState(reason = null) {
        if (this._closeCombatState && this._closeCombatState.target) {
            this._emitCloseCombatLifecycleLog("exit", this._closeCombatState.target, {
                phase: this._closeCombatState.phase,
                reason: reason || "reset"
            });
        }
        this._closeCombatState = null;
        return null;
    }

    onCloseCombatStateUpdated(_state, _target, _options = {}) {
    }

    getCloseCombatState() {
        return this._closeCombatState && typeof this._closeCombatState === "object"
            ? { ...this._closeCombatState }
            : null;
    }

    beginCloseCombat(target, options = {}) {
        if (!target || target.gone || target.dead) {
            return this.resetCloseCombatState("invalid-target");
        }
        const now = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
        if (this._closeCombatState && this._closeCombatState.target && this._closeCombatState.target !== target) {
            this.resetCloseCombatState("retarget");
        }
        if (!this._closeCombatState || this._closeCombatState.target !== target) {
            this._closeCombatState = {
                target,
                phase: "approach",
                phaseStartedMs: now,
                abortBlockedSinceMs: null,
                abortReason: null,
                lungeStartedMs: null,
                lungeOriginX: null,
                lungeOriginY: null,
                lungeTargetX: null,
                lungeTargetY: null,
                lungeTargetTimeSeconds: null,
                lastAttackResolvedMs: null,
                lastAttackResult: null,
                attackCount: 0,
                lastDistance: this.distanceToPoint(target.x, target.y),
                options: { ...options }
            };
            this._emitCloseCombatLifecycleLog("enter", target, {
                phase: this._closeCombatState.phase,
                reason: options.reason || "engage"
            });
        } else if (options && typeof options === "object") {
            this._closeCombatState.options = {
                ...(this._closeCombatState.options && typeof this._closeCombatState.options === "object"
                    ? this._closeCombatState.options
                    : {}),
                ...options
            };
        }
        return this._closeCombatState;
    }

    _setCloseCombatPhase(state, phase, now = Date.now()) {
        if (!state) return null;
        state.phase = phase;
        state.phaseStartedMs = now;
        state.abortBlockedSinceMs = null;
        state.abortReason = null;
        if (phase === "lunge") {
            state.lungeStartedMs = now;
            state.lungeOriginX = Number(this.x);
            state.lungeOriginY = Number(this.y);
        } else if (phase !== "backoff") {
            state.lungeStartedMs = null;
            state.lungeOriginX = null;
            state.lungeOriginY = null;
        }
        if (phase !== "lunge") {
            state.lungeTargetX = null;
            state.lungeTargetY = null;
            state.lungeTargetTimeSeconds = null;
        }
        return state;
    }

    _getCloseCombatLungeTravelDistance(state) {
        if (!state || !Number.isFinite(state.lungeOriginX) || !Number.isFinite(state.lungeOriginY)) {
            return 0;
        }
        if (this.map && typeof this.map.distanceBetweenPoints === "function") {
            return this.map.distanceBetweenPoints(state.lungeOriginX, state.lungeOriginY, this.x, this.y);
        }
        const delta = this._getLocalWrappedDelta(state.lungeOriginX, state.lungeOriginY, this.x, this.y);
        return Math.hypot(delta.x, delta.y);
    }

    _resolveCloseCombatStrike(target, state, options = {}) {
        const resolver = typeof options.resolveStrike === "function"
            ? options.resolveStrike
            : null;
        const rawResult = resolver ? resolver(target, state, this) : { hit: true };
        if (rawResult && typeof rawResult === "object") {
            return {
                ...rawResult,
                resolved: rawResult.resolved !== false,
                hit: rawResult.hit !== false
            };
        }
        return { resolved: true, hit: rawResult !== false };
    }

    _getCloseCombatVectorToTarget(target) {
        if (!target) return { x: 0, y: 0 };
        return this._getLocalWrappedDelta(this.x, this.y, target.x, target.y);
    }

    _getCloseCombatBackoffVector(target) {
        const toward = this._getCloseCombatVectorToTarget(target);
        if (Math.hypot(toward.x, toward.y) > 1e-6) {
            return { x: -toward.x, y: -toward.y };
        }
        if (Math.hypot(this.movementVector.x, this.movementVector.y) > 1e-6) {
            return { x: -this.movementVector.x, y: -this.movementVector.y };
        }
        return { x: -1, y: 0 };
    }

    updateCloseCombat(target = null, options = {}) {
        const mergedOptions = {
            ...(this._closeCombatState && this._closeCombatState.options && typeof this._closeCombatState.options === "object"
                ? this._closeCombatState.options
                : {}),
            ...(options && typeof options === "object" ? options : {})
        };
        const state = this.beginCloseCombat(target || this._closeCombatState?.target, mergedOptions);
        if (!state) return null;

        const targetRef = state.target;
        if (!targetRef || targetRef.gone || targetRef.dead) {
            return this.resetCloseCombatState("target-lost");
        }

        const now = Number.isFinite(mergedOptions.nowMs) ? Number(mergedOptions.nowMs) : Date.now();
        const approachSpeed = Number.isFinite(mergedOptions.approachSpeed)
            ? Math.max(1e-4, Number(mergedOptions.approachSpeed))
            : Math.max(1e-4, Number(this.runSpeed) || this.getEffectiveMovementSpeed(this.speed));
        const lungeSpeed = Number.isFinite(mergedOptions.lungeSpeed)
            ? Math.max(1e-4, Number(mergedOptions.lungeSpeed))
            : Math.max(approachSpeed, Number(this.lungeSpeed) || approachSpeed);
        const lungeRadius = Number.isFinite(mergedOptions.lungeRadius)
            ? Math.max(0, Number(mergedOptions.lungeRadius))
            : Math.max(0, Number(this.lungeRadius) || 0);
        const strikeDistance = Number.isFinite(mergedOptions.strikeDistance)
            ? Math.max(0, Number(mergedOptions.strikeDistance))
            : this.getStrikeDistance(targetRef, mergedOptions.strikeRange);
        const backoffRadius = Number.isFinite(mergedOptions.backoffRadius)
            ? Math.max(0, Number(mergedOptions.backoffRadius))
            : lungeRadius;
        const backoffSpeed = Number.isFinite(mergedOptions.backoffSpeed)
            ? Math.max(1e-4, Number(mergedOptions.backoffSpeed))
            : approachSpeed;
        const lungeTravelLimit = Number.isFinite(mergedOptions.lungeTravelLimit)
            ? Math.max(0, Number(mergedOptions.lungeTravelLimit))
            : lungeRadius;
        const lungeMaxMs = Number.isFinite(mergedOptions.lungeMaxMs)
            ? Math.max(0, Number(mergedOptions.lungeMaxMs))
            : ((Math.max(lungeRadius, strikeDistance) * 2 / Math.max(1e-4, lungeSpeed)) * 1000);
        const canStartLunge = typeof mergedOptions.canStartLunge === "function"
            ? (mergedOptions.canStartLunge(targetRef, state, this) !== false)
            : (mergedOptions.canStartLunge !== false);
        const requireCommittedLungeTarget = mergedOptions.requireCommittedLungeTarget === true;

        state.target = targetRef;
        state.lastDistance = this.distanceToPoint(targetRef.x, targetRef.y);

        if (this.shouldAbortCloseCombat(targetRef, state, mergedOptions)) {
            return this.resetCloseCombatState(state.abortReason || "close-combat-invalid");
        }

        this.cancelPathMovement();

        if (state.phase === "approach" && canStartLunge) {
            const resolvedLungeTargetPoint = this.resolveCloseCombatLungeTargetPoint(targetRef, state, {
                ...mergedOptions,
                lungeRadius,
                lungeSpeed,
                strikeDistance
            });
            const lungeEntryOptions = {
                ...mergedOptions,
                lungeRadius,
                approachSpeed
            };
            if (resolvedLungeTargetPoint) {
                lungeEntryOptions.targetPoint = resolvedLungeTargetPoint;
            }
            if ((!requireCommittedLungeTarget || resolvedLungeTargetPoint) && this.canEnterCloseCombat(targetRef, lungeEntryOptions)) {
                this._setCloseCombatPhase(state, "lunge", now);
                if (resolvedLungeTargetPoint) {
                    state.lungeTargetX = Number(resolvedLungeTargetPoint.x);
                    state.lungeTargetY = Number(resolvedLungeTargetPoint.y);
                    state.lungeTargetTimeSeconds = Number.isFinite(resolvedLungeTargetPoint.timeSeconds)
                        ? Number(resolvedLungeTargetPoint.timeSeconds)
                        : null;
                }
                if (mergedOptions.resetMovementVectorOnLunge === true && this.movementVector) {
                    this.movementVector.x = 0;
                    this.movementVector.y = 0;
                }
            }
        }

        if (state.phase === "lunge" && !Number.isFinite(state.lungeStartedMs)) {
            state.lungeStartedMs = now;
            state.lungeOriginX = Number(this.x);
            state.lungeOriginY = Number(this.y);
        }

        if (state.phase === "approach") {
            const towardVector = this._getCloseCombatVectorToTarget(targetRef);
            this.speed = approachSpeed;
            this.moveDirection(towardVector, {
                ...mergedOptions,
                target: targetRef,
                facingVector: towardVector
            });
            this.onCloseCombatStateUpdated(state, targetRef, mergedOptions);
            return { ...state, strikeDistance, lungeRadius, backoffRadius };
        }

        if (state.phase === "lunge") {
            const lungeTargetPoint = (
                Number.isFinite(state.lungeTargetX) &&
                Number.isFinite(state.lungeTargetY)
            )
                ? { x: Number(state.lungeTargetX), y: Number(state.lungeTargetY) }
                : targetRef;
            const towardVector = this._getLocalWrappedDelta(this.x, this.y, lungeTargetPoint.x, lungeTargetPoint.y);
            this.speed = lungeSpeed;
            this.moveDirection(towardVector, {
                ...mergedOptions,
                target: targetRef,
                targetPoint: lungeTargetPoint,
                facingVector: towardVector
            });

            const lungeTravelDistance = this._getCloseCombatLungeTravelDistance(state);
            if (lungeTravelDistance >= lungeTravelLimit) {
                state.attackCount += 1;
                state.lastAttackResolvedMs = now;
                state.lastAttackResult = "miss";
                if (typeof mergedOptions.onMiss === "function") {
                    mergedOptions.onMiss(targetRef, state, {
                        hit: false,
                        reason: "range-exceeded",
                        travelDistance: lungeTravelDistance,
                        travelLimit: lungeTravelLimit,
                        nowMs: now
                    }, this);
                }
                this._setCloseCombatPhase(state, "backoff", now);
                this.onCloseCombatStateUpdated(state, targetRef, mergedOptions);
                return { ...state, strikeDistance, lungeRadius, backoffRadius, lungeTravelDistance, lungeTravelLimit };
            }

            if (this.isTargetWithinStrikeContact(targetRef, { strikeDistance })) {
                const result = this._resolveCloseCombatStrike(targetRef, state, mergedOptions);
                if (result.resolved === false) {
                    this.onCloseCombatStateUpdated(state, targetRef, mergedOptions);
                    return { ...state, strikeDistance, lungeRadius, backoffRadius };
                }
                state.attackCount += 1;
                state.lastAttackResolvedMs = now;
                state.lastAttackResult = result.hit ? "hit" : "miss";
                if (result.hit) {
                    if (typeof mergedOptions.onHit === "function") {
                        mergedOptions.onHit(targetRef, state, result, this);
                    }
                    const postHitPhase = typeof mergedOptions.postHitPhase === "string"
                        ? mergedOptions.postHitPhase
                        : "backoff";
                    if (postHitPhase === "retreat" && typeof this.beginRetreat === "function") {
                        this.beginRetreat(targetRef, {
                            holdAttackAnimation: mergedOptions.holdAttackAnimationOnHit === true
                        });
                        return {
                            ...state,
                            strikeDistance,
                            lungeRadius,
                            backoffRadius,
                            transitionedTo: "retreat"
                        };
                    }
                } else if (typeof mergedOptions.onMiss === "function") {
                    mergedOptions.onMiss(targetRef, state, result, this);
                }
                this._setCloseCombatPhase(state, "backoff", now);
                this.onCloseCombatStateUpdated(state, targetRef, mergedOptions);
                return { ...state, strikeDistance, lungeRadius, backoffRadius };
            }

            if ((now - state.lungeStartedMs) >= lungeMaxMs) {
                state.attackCount += 1;
                state.lastAttackResolvedMs = now;
                state.lastAttackResult = "miss";
                if (typeof mergedOptions.onMiss === "function") {
                    mergedOptions.onMiss(targetRef, state, { hit: false, reason: "timeout" }, this);
                }
                this._setCloseCombatPhase(state, "backoff", now);
            }

            this.onCloseCombatStateUpdated(state, targetRef, mergedOptions);
            return { ...state, strikeDistance, lungeRadius, backoffRadius, lungeTravelDistance, lungeTravelLimit };
        }

        const backoffVector = this._getCloseCombatBackoffVector(targetRef);
        this.speed = backoffSpeed;
        if (state.lastDistance >= backoffRadius) {
            this._setCloseCombatPhase(state, "approach", now);
        } else {
            this.moveDirection(backoffVector, {
                ...mergedOptions,
                target: targetRef,
                facingVector: this._getCloseCombatVectorToTarget(targetRef)
            });
        }

        this.onCloseCombatStateUpdated(state, targetRef, mergedOptions);
        return { ...state, strikeDistance, lungeRadius, backoffRadius };
    }

    _recordVisitedNode(node, reason = "move") {
        if (!node) return null;
        if (!Array.isArray(this.nodeVisitLog)) {
            this.nodeVisitLog = [];
        }
        const lastEntry = this.nodeVisitLog.length > 0
            ? this.nodeVisitLog[this.nodeVisitLog.length - 1]
            : null;
        if (lastEntry && lastEntry.xindex === node.xindex && lastEntry.yindex === node.yindex) {
            if (typeof reason === "string" && reason && !lastEntry.reason) {
                lastEntry.reason = reason;
            }
            return lastEntry;
        }
        const entry = {
            node,
            xindex: node.xindex,
            yindex: node.yindex,
            x: node.x,
            y: node.y,
            reason,
            time: Date.now(),
        };
        this.nodeVisitLog.push(entry);
        const limit = Number.isFinite(this.nodeVisitLogLimit)
            ? Math.max(1, Math.floor(this.nodeVisitLogLimit))
            : 200;
        if (this.nodeVisitLog.length > limit) {
            this.nodeVisitLog.splice(0, this.nodeVisitLog.length - limit);
        }
        return entry;
    }

    getNodeVisitLog() {
        return Array.isArray(this.nodeVisitLog)
            ? this.nodeVisitLog.map(entry => ({ ...entry }))
            : [];
    }

    clearNodeVisitLog(reason = "reset") {
        this.nodeVisitLog = [];
        if (this.node) {
            this._recordVisitedNode(this.node, reason);
        }
        return this.getNodeVisitLog();
    }

    getInventory() {
        if (!(this.inventory instanceof Inventory)) {
            const existing = (this.inventory && typeof this.inventory === "object") ? this.inventory : {};
            this.inventory = new Inventory(existing);
        }
        return this.inventory;
    }

    serializeInventory() {
        const inventory = this.getInventory();
        return inventory && typeof inventory.toJSON === "function"
            ? inventory.toJSON()
            : {};
    }

    loadInventory(data) {
        const inventory = this.getInventory();
        if (inventory && typeof inventory.load === "function") {
            inventory.load(data);
        }
        return inventory;
    }

    tracePath(seconds = 0) {
        const durationMs = Math.max(0, Number(seconds) || 0) * 1000;
        if (!durationMs) {
            this._tracePathState = null;
            return false;
        }
        this._tracePathState = {
            remainingMs: durationMs,
            lastUpdateMs: null
        };
        return true;
    }

    getTracePathState() {
        return (this._tracePathState && typeof this._tracePathState === "object")
            ? { ...this._tracePathState }
            : null;
    }

    updateTracePathLifetime(nowMs = null, isPaused = false) {
        const traceState = (this._tracePathState && typeof this._tracePathState === "object")
            ? this._tracePathState
            : null;
        if (!traceState) return null;
        const resolvedNowMs = Number.isFinite(nowMs) ? Number(nowMs) : Date.now();
        if (!Number.isFinite(resolvedNowMs)) return traceState;
        if (!isPaused && Number.isFinite(traceState.lastUpdateMs)) {
            traceState.remainingMs = Math.max(0, Number(traceState.remainingMs) - Math.max(0, resolvedNowMs - traceState.lastUpdateMs));
        }
        traceState.lastUpdateMs = resolvedNowMs;
        if (!(Number(traceState.remainingMs) > 0)) {
            this._tracePathState = null;
            return null;
        }
        return traceState;
    }
    
    nextMove() {
        return setTimeout(() => {this.move()}, 1000 / this.frameRate);
    }
    ensureMagicPointsInitialized(resetCurrent = false) {
        const fallbackHp = Number.isFinite(this.hp) ? Number(this.hp) : 0;
        const fallbackMaxHp = Math.max(
            fallbackHp,
            Number.isFinite(this.maxHp)
                ? Number(this.maxHp)
                : (Number.isFinite(this.maxHP) ? Number(this.maxHP) : 0)
        );
        if (!Number.isFinite(this.maxHp) || this.maxHp < fallbackHp) {
            this.maxHp = fallbackMaxHp;
        }
        if (!Number.isFinite(this.maxHP) || this.maxHP < this.maxHp) {
            this.maxHP = this.maxHp;
        }
        if (resetCurrent || !Number.isFinite(this.mp)) {
            this.mp = fallbackHp;
        }
        const existingMaxMp = Number.isFinite(this.maxMp)
            ? Number(this.maxMp)
            : (Number.isFinite(this.maxMP) ? Number(this.maxMP) : null);
        const normalizedMaxMp = Number.isFinite(existingMaxMp)
            ? Math.max(0, existingMaxMp)
            : fallbackMaxHp;
        this.maxMp = resetCurrent ? fallbackMaxHp : normalizedMaxMp;
        this.maxMP = this.maxMp;
        if (Number.isFinite(this.mp)) {
            this.mp = Math.max(0, Math.min(Number(this.mp), this.maxMp));
        }
        return this.mp;
    }
    getTemperatureBaseline() {
        return Number.isFinite(this.baselineTemperature) ? Number(this.baselineTemperature) : 0;
    }
    getTemperature() {
        return Number.isFinite(this.temperature) ? Number(this.temperature) : this.getTemperatureBaseline();
    }
    getFreezeTemperatureThreshold() {
        return CHARACTER_FREEZE_TEMPERATURE_DEGREES;
    }
    setTemperature(nextTemperature) {
        this.temperature = Number.isFinite(nextTemperature)
            ? Number(nextTemperature)
            : this.getTemperatureBaseline();
        return this.temperature;
    }
    changeTemperature(deltaDegrees = 0) {
        const delta = Number(deltaDegrees);
        if (!Number.isFinite(delta) || delta === 0) return this.getTemperature();
        return this.setTemperature(this.getTemperature() + delta);
    }
    dropTemperature(deltaDegrees = 0) {
        const delta = Number(deltaDegrees);
        if (!Number.isFinite(delta) || delta <= 0) return this.getTemperature();
        return this.changeTemperature(-delta);
    }
    getDegreesBelowBaseline() {
        return Math.max(0, this.getTemperatureBaseline() - this.getTemperature());
    }
    isTemperatureFrozen() {
        return this.getTemperature() <= this.getFreezeTemperatureThreshold();
    }
    isFrozen(nowMs = null) {
        return this.isTemperatureFrozen() || this.isScriptFrozen(nowMs);
    }
    applyFrozenState(options = {}) {
        if (options.clearMoveTimeout && this.moveTimeout) {
            clearTimeout(this.moveTimeout);
            this.moveTimeout = null;
        }
        if (options.clearAttackTimeout !== false && this.attackTimeout) {
            clearTimeout(this.attackTimeout);
            this.attackTimeout = null;
        }
        this.moving = false;
        this.destination = null;
        this.path = [];
        this.nextNode = null;
        this.travelFrames = 0;
        this.travelX = 0;
        this.travelY = 0;
        this.currentMaxSpeed = 0;
        this.isMovingBackward = false;
        if (this.movementVector && typeof this.movementVector === "object") {
            this.movementVector.x = 0;
            this.movementVector.y = 0;
        }
        if (typeof this.resetAttackState === "function") {
            this.resetAttackState();
        }
        this.attackTarget = null;
        this.attacking = false;
        this.spriteDirectionLock = null;
        if (typeof this.updateHitboxes === "function") {
            this.updateHitboxes();
        }
    }
    getTemperatureSpeedMultiplier() {
        if (this.isTemperatureFrozen()) return 0;
        const degreesBelow = this.getDegreesBelowBaseline();
        if (!(degreesBelow > 0)) return 1;
        return 1 / (2 ** (degreesBelow / 10));
    }
    getEffectiveMovementSpeed(baseSpeed = null) {
        const fallbackSpeed = Number.isFinite(this.speed) ? Number(this.speed) : 0;
        const normalizedBaseSpeed = Number.isFinite(baseSpeed) ? Number(baseSpeed) : fallbackSpeed;
        return normalizedBaseSpeed * this.getTemperatureSpeedMultiplier();
    }
    recoverTemperature(deltaSeconds = 0) {
        const dt = Number(deltaSeconds);
        if (!Number.isFinite(dt) || dt <= 0) return this.getTemperature();
        const baseline = this.getTemperatureBaseline();
        const current = this.getTemperature();
        if (current >= baseline) return current;
        return this.setTemperature(Math.min(baseline, current + dt));
    }
    freeze(seconds) {
        this.applyFrozenState({ clearMoveTimeout: true });

        if (arguments.length === 0 || typeof seconds === "undefined") {
            this._scriptFrozenUntilMs = Infinity;
            return;
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
        this._scriptFrozenUntilMs = existingUntilMs > 0
            ? Math.max(existingUntilMs, nextUntilMs)
            : nextUntilMs;
    }
    unFreeze() {
        this._scriptFrozenUntilMs = 0;
        if (!this.useExternalScheduler && !this.gone && !this.moveTimeout && !this.isTemperatureFrozen()) {
            this.moveTimeout = this.nextMove();
        }
    }
    isScriptFrozen(nowMs = null) {
        const frozenUntilMs = Number(this._scriptFrozenUntilMs);
        if (!(frozenUntilMs > 0)) return false;
        if (frozenUntilMs === Infinity) return true;
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
        if (this._tracePathGraphics && this._tracePathGraphics.parent) {
            this._tracePathGraphics.parent.removeChild(this._tracePathGraphics);
        }
        if (this._tracePathGraphics && typeof this._tracePathGraphics.destroy === "function") {
            this._tracePathGraphics.destroy();
        }
        this._tracePathGraphics = null;
        this._tracePathState = null;
        if (Array.isArray(animals)) {
            const idx = animals.indexOf(this);
            if (idx >= 0) animals.splice(idx, 1);
        }
        if (this.map && typeof this.map.unregisterGameObject === "function") {
            this.map.unregisterGameObject(this);
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
        pathOptions.returnPathSteps = true;
        this.path = (this.useAStarPathfinding && typeof this.map.findPathAStar === "function")
            ? this.map.findPathAStar(this.node, destinationNode, pathOptions)
            : this.map.findPath(this.node, destinationNode, pathOptions);
        if (!Array.isArray(this.path)) {
            this.path = [];
        }
        this.travelFrames = 0;
        this.travelZ = 0;
        this.nextNode = null;
        this.currentPathStep = null;
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
        const dtSeconds = 1 / Math.max(1, Number(this.frameRate) || 1);
        const temperatureFrozen = this.isTemperatureFrozen();
        const scriptFrozen = this.isScriptFrozen();
        if (temperatureFrozen || scriptFrozen) {
            this.applyFrozenState({ clearMoveTimeout: false });
            if (temperatureFrozen && !scriptFrozen) {
                this.recoverTemperature(dtSeconds);
            }
            return;
        }
        this.recoverTemperature(dtSeconds);
        
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

        if (this._closeCombatState && this._closeCombatState.target) {
            this.updateCloseCombat();
            return;
        }

        // Check if we have a destination to move toward
        if (!this.destination) {
            this.moving = false;
            return;
        }

        const currentNodeIsActive = (
            this.map &&
            typeof this.map.isPrototypeNodeActive === "function" &&
            this.node
        )
            ? this.map.isPrototypeNodeActive(this.node)
            : !!this.node;
        if (!currentNodeIsActive) {
            this.node = (this.map && typeof this.map.worldToNode === "function")
                ? this.map.worldToNode(this.x, this.y)
                : this.node;
        }
        if (!this.node) {
            this._movementSuspendedByStreaming = true;
            this.destination = null;
            this.path = [];
            this.nextNode = null;
            this.travelFrames = 0;
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
                const arrivalPosition = this.getTraversalStepWorldPosition(this.currentPathStep, 1);
                this.node = this.nextNode;
                this.x = arrivalPosition && Number.isFinite(arrivalPosition.x) ? arrivalPosition.x : this.node.x;
                this.y = arrivalPosition && Number.isFinite(arrivalPosition.y) ? arrivalPosition.y : this.node.y;
                this.z = arrivalPosition && Number.isFinite(arrivalPosition.z) ? arrivalPosition.z : this.getNodeStandingZ(this.node);
                this._recordVisitedNode(this.node);
                this.currentPathStep = null;
            }
            
            // Get next step from path
            const nextPathItem = this.path.shift();
            this.currentPathStep = this.resolvePathStep(nextPathItem, this.node);
            this.nextNode = this.getPathItemDestinationNode(this.currentPathStep);
            if (!this.nextNode) {
                // Reached destination
                this.destination = null;
                this.moving = false;
                return;
            }
            if (
                this.map &&
                typeof this.map.isPrototypeNodeActive === "function" &&
                !this.map.isPrototypeNodeActive(this.nextNode)
            ) {
                this._movementSuspendedByStreaming = true;
                this.destination = null;
                this.path = [];
                this.nextNode = null;
                this.travelFrames = 0;
                this.moving = false;
                return;
            }
            this.directionIndex = Number.isInteger(this.currentPathStep && this.currentPathStep.directionIndex)
                ? Number(this.currentPathStep.directionIndex)
                : (Array.isArray(this.node.neighbors)
                    ? this.node.neighbors.indexOf(this.nextNode)
                    : -1);
            
            // Calculate travel parameters using world coordinates
            const targetPosition = this.getTraversalStepWorldPosition(this.currentPathStep, 1) || {
                x: this.nextNode.x,
                y: this.nextNode.y,
                z: this.getNodeStandingZ(this.nextNode)
            };
            let xdist = (this.map && typeof this.map.shortestDeltaX === "function")
                ? this.map.shortestDeltaX(this.x, targetPosition.x)
                : (targetPosition.x - this.x);
            let ydist = (this.map && typeof this.map.shortestDeltaY === "function")
                ? this.map.shortestDeltaY(this.y, targetPosition.y)
                : (targetPosition.y - this.y);
            const zdist = (Number.isFinite(targetPosition.z) ? targetPosition.z : this.getNodeStandingZ(this.nextNode)) - this.z;
            let direction_distance = Math.sqrt(xdist ** 2 + ydist ** 2);
            const effectiveSpeed = this.getEffectiveMovementSpeed(this.speed);
            if (!(effectiveSpeed > 0)) {
                this.applyFrozenState({ clearMoveTimeout: false });
                return;
            }
            this.travelFrames = Math.max(1, Math.ceil(direction_distance / effectiveSpeed * this.frameRate));
            this.travelX = xdist / this.travelFrames;
            this.travelY = ydist / this.travelFrames;
            this.travelZ = zdist / this.travelFrames;
            this.direction = {x: xdist, y: ydist};
        }
        
        this.travelFrames--;
        this.x += this.travelX;
        this.y += this.travelY;
        this.z += this.travelZ;
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
    extinguish() {
        this.onfire = false;
        if (Number.isFinite(this.fireDuration)) {
            this.fireDuration = 0;
        }
        return true;
    }
    burn() {
        this.fireDuration--;
        if (this.fireDuration <= 0) {
            this.extinguish();
            return;
        }
        if (this.hp <= 0 && !this.dead) {
            this.die();
        } else {
            const warmAmount = CHARACTER_FIRE_WARM_RATE_DEGREES_PER_SECOND / Math.max(1, Number(frameRate) || 1);
            if (typeof this.setTemperature === "function" && typeof this.getTemperature === "function") {
                this.setTemperature(Math.min(0, this.getTemperature() + warmAmount));
            } else if (typeof this.changeTemperature === "function") {
                this.changeTemperature(warmAmount);
                if (Number.isFinite(this.temperature) && this.temperature > 0) {
                    this.temperature = 0;
                }
            }
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
    triggerVanishDieEventIfAdventureMode(context = null) {
        const wizardRef = (typeof wizard !== "undefined" && wizard)
            ? wizard
            : ((typeof globalThis !== "undefined" && globalThis.wizard) ? globalThis.wizard : null);
        if (!wizardRef || typeof wizardRef.isAdventureMode !== "function" || !wizardRef.isAdventureMode()) {
            return false;
        }
        if (this.gone || this.dead) return false;

        if (this === wizardRef) {
            if (typeof this.die === "function") {
                this.die();
            } else {
                this.dead = true;
                this.triggerDieScriptEvent(context || { cause: "vanish" });
            }
            this.hp = 0;
            if (typeof this.updateAdventureDeathState === "function") {
                this.updateAdventureDeathState();
            }
            return true;
        }

        return this.triggerDieScriptEvent(context || { cause: "vanish" });
    }
    spawnFrozenDeathBurst() {
        const projectileList = (typeof projectiles !== "undefined" && Array.isArray(projectiles))
            ? projectiles
            : ((typeof globalThis !== "undefined" && Array.isArray(globalThis.projectiles)) ? globalThis.projectiles : null);
        if (!projectileList) return null;
        const burst = new FrozenDeathBurstEffect({
            x: this.x,
            y: this.y,
            z: Math.max(0, Number(this.z) || 0),
            size: Math.max(0.6, Number(this.size) || 1),
            width: Math.max(
                0.4,
                Number(this.width) || 0,
                Number(this.size) || 1,
                Number(this.visualRadius) * 2 || 0
            ),
            height: Math.max(
                0.6,
                Number(this.height) || Number(this.size) || 1,
                Number(this.visualRadius) * 2 || 0
            )
        });
        projectileList.push(burst.cast());
        return burst;
    }
    shatterFrozenDeath(options = {}) {
        if (this.gone || this._frozenSpikeShattered) return false;
        this._frozenSpikeShattered = true;
        this.dead = true;
        this.rotation = 0;
        this.triggerDieScriptEvent({
            cause: (options && typeof options.cause === "string" && options.cause.length > 0)
                ? options.cause
                : "spikes-frozen-shatter",
            source: options && options.source ? options.source : null
        });
        this.spawnFrozenDeathBurst();
        this.removeFromGame();
        return true;
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

if (typeof globalThis !== "undefined") {
    globalThis.FrozenDeathBurstEffect = FrozenDeathBurstEffect;
}

function getAnimalMoveLogCollection() {
    if (typeof animals !== "undefined" && Array.isArray(animals)) {
        return animals;
    }
    if (typeof globalThis !== "undefined" && Array.isArray(globalThis.animals)) {
        return globalThis.animals;
    }
    return [];
}

function resolveAnimalMoveLogTarget(target = 0) {
    if (target && typeof target.getNodeVisitLog === "function") {
        return target;
    }

    const collection = getAnimalMoveLogCollection();
    if (typeof target === "number" && Number.isInteger(target)) {
        return collection[target] || null;
    }
    if (typeof target === "string") {
        const needle = target.trim().toLowerCase();
        if (!needle) return null;
        return collection.find(animal => {
            const scriptingName = typeof animal?.scriptingName === "string"
                ? animal.scriptingName.trim().toLowerCase()
                : "";
            const animalType = typeof animal?.type === "string"
                ? animal.type.trim().toLowerCase()
                : "";
            return scriptingName === needle || animalType === needle;
        }) || null;
    }
    return collection[0] || null;
}

function getHitboxDebugCollection() {
    const collection = [];
    if (typeof globalThis !== "undefined" && globalThis.wizard) {
        collection.push(globalThis.wizard);
    } else if (typeof wizard !== "undefined" && wizard) {
        collection.push(wizard);
    }

    const animalCollection = getAnimalMoveLogCollection();
    for (let i = 0; i < animalCollection.length; i++) {
        if (animalCollection[i]) collection.push(animalCollection[i]);
    }
    return collection;
}

function resolveHitboxDebugTarget(target = 0) {
    if (target && typeof target.getHitboxCollisionDebugInfo === "function") {
        return target;
    }

    const collection = getHitboxDebugCollection();
    if (typeof target === "number" && Number.isInteger(target)) {
        return collection[target] || null;
    }
    if (typeof target === "string") {
        const needle = target.trim().toLowerCase();
        if (!needle) return null;
        return collection.find(entry => {
            const label = typeof entry?._getHitboxDebugLabel === "function"
                ? entry._getHitboxDebugLabel(entry).toLowerCase()
                : "";
            const type = typeof entry?.type === "string" ? entry.type.toLowerCase() : "";
            const name = typeof entry?.name === "string" ? entry.name.toLowerCase() : "";
            return label === needle || type === needle || name === needle;
        }) || null;
    }
    return collection[0] || null;
}

if (typeof globalThis !== "undefined") {
    globalThis.dumpAnimalMoveLog = function(target = 0) {
        const animal = resolveAnimalMoveLogTarget(target);
        if (!animal || typeof animal.getNodeVisitLog !== "function") {
            console.warn("No animal move log target found.");
            return [];
        }
        const log = animal.getNodeVisitLog();
        console.table(log);
        return log;
    };

    globalThis.clearAnimalMoveLog = function(target = 0) {
        const animal = resolveAnimalMoveLogTarget(target);
        if (!animal || typeof animal.clearNodeVisitLog !== "function") {
            console.warn("No animal move log target found.");
            return [];
        }
        return animal.clearNodeVisitLog();
    };

    globalThis.dumpHitboxCollisionDebug = function(target = 0) {
        const character = resolveHitboxDebugTarget(target);
        if (!character || typeof character.getHitboxCollisionDebugInfo !== "function") {
            console.warn("No hitbox collision debug target found.");
            return null;
        }
        const snapshot = character.getHitboxCollisionDebugInfo();
        if (!snapshot) {
            console.warn("No hitbox collision debug snapshot available.");
            return null;
        }
        console.log("Hitbox collision debug snapshot:", snapshot);
        if (Array.isArray(snapshot.nearbyCharacterBlockers) && snapshot.nearbyCharacterBlockers.length > 0) {
            console.table(snapshot.nearbyCharacterBlockers);
        }
        if (Array.isArray(snapshot.nearbyObjectBlockers) && snapshot.nearbyObjectBlockers.length > 0) {
            console.table(snapshot.nearbyObjectBlockers);
        }
        if (Array.isArray(snapshot.dynamicCharacterInteractions) && snapshot.dynamicCharacterInteractions.length > 0) {
            console.table(snapshot.dynamicCharacterInteractions);
        }
        if (Array.isArray(snapshot.staticCollisions) && snapshot.staticCollisions.length > 0) {
            console.table(snapshot.staticCollisions);
        }
        return snapshot;
    };
}
