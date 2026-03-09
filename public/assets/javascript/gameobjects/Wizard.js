class Wizard extends Character {
    constructor(location, map) {
        super('human', location, 1, map);
        this.useAStarPathfinding = true;
        this.speed = 5;
        this.roadSpeedMultiplier = 1.3;
        this.backwardSpeedMultiplier = 0.667; // Configurable backward movement speed
        this.frameRate = 60;
        this.cooldownTime = 0; // configurable delay in seconds before casting
        this.food = 0;
        this.hp = 100;
        this.maxHp = 100;
        this.magic = 100;
        this.maxMagic = 100;
        this.magicRegenPerSecond = 8;
        this.activeAura = null;
        this.activeAuras = [];
        this.showEditorPanel = true;
        this.editorPlacementActive = false;
        this.selectedEditorCategory = "doors";
        this.name = 'you';
        this.groundRadius = 0.3;
        this.visualRadius = 0.5; // Hitbox radius in hex units
        this.occlusionRadius = 1.0; // Radius for occlusion checks in hex units
        this.animationSpeedMultiplier = 0.95; // Multiplier for animation speed (lower is faster)
        this.maxTurnSpeedDegPerSec = 180;
        this.zeroTurnDistanceUnits = wizardMouseTurnZeroDistanceUnits;
        this.fullTurnSpeedDistanceUnits = wizardMouseTurnFullDistanceUnits;
        
        // Movement acceleration via vector interpolation
        this.acceleration = 50; // Rate of acceleration in units/second²
        this.movementVector = {x: 0, y: 0}; // Accumulated momentum vector
        
        // Wall placement state
        this.wallLayoutMode = false;
        this.wallStartPoint = null;
        this.phantomWall = null;
        
        // Road placement state
        this.roadLayoutMode = false;
        this.roadStartPoint = null;
        this.phantomRoad = null;
        
        // Firewall placement state
        this.firewallLayoutMode = false;
        this.firewallStartPoint = null;
        this.phantomFirewall = null;

        // Create wizard hat graphics
        this.hatGraphics = new PIXI.Graphics();
        this.hatResolution = 128;
        this.hatRenderScale = 0.9; // Compensate apparent size after hat shape updates
        this.hatRenderYOffsetUnits = 0.14; // Hat Y offset in map units (positive = up)
        characterLayer.addChild(this.hatGraphics);
        this.shadowGraphics = new PIXI.Graphics();
        characterLayer.addChild(this.shadowGraphics);
        this.hatColor = 0x000099; // Royal Blue
        this.hatBandColor = 0xFFD700; // Gold
        this.redrawHatGeometry();
        this.treeGrowthChannel = null;
        this.isJumping = false;
        this.jumpCount = 0;
        this.maxJumpCount = 2;
        this.jumpElapsedSec = 0;
        this.baseJumpDurationSec = 0.55;
        this.baseJumpMaxHeight = 0.5; // world units
        this.doubleJumpDurationSec = 1.2;
        this.jumpDurationSec = this.baseJumpDurationSec;
        this.jumpMaxHeight = this.baseJumpMaxHeight;
        this.jumpMode = "single";
        this.jumpPolyA = 0;
        this.jumpPolyB = 0;
        this.jumpPolyC = 0;
        this.jumpHeight = 0;
        this._doorTraversalStateById = new Map();
        this.jumpLockedMovingBackward = false;
        this.isMovingBackward = false;
        this.updateHitboxes();
        this.move();
        clearTimeout(this.moveTimeout);
    }
    startJump() {
        if (this.jumpCount >= this.maxJumpCount) return;
        if (this.jumpCount === 0) {
            this.isJumping = true;
            this.jumpMode = "single";
            this.jumpCount = 1;
            this.jumpElapsedSec = 0;
            this.jumpDurationSec = this.baseJumpDurationSec;
            this.jumpMaxHeight = this.baseJumpMaxHeight;
            this.jumpHeight = 0;
            this.jumpLockedMovingBackward = !!this.isMovingBackward;
            return;
        }

        if (this.jumpCount === 1 && this.isJumping) {
            // Start a boosted second jump from the CURRENT height so there is
            // no instant dip between first and second jump.
            const h0 = Math.max(0, Number(this.jumpHeight) || 0);
            const T = this.doubleJumpDurationSec;
            const peakTime = T * 0.35;
            const targetPeak = Math.max(this.baseJumpMaxHeight * 2, h0 + 0.1);
            const denom = (peakTime * peakTime - peakTime * T);
            let a = 0;
            let b = 0;
            if (Math.abs(denom) > 1e-6) {
                a = (targetPeak - h0 + (peakTime * h0) / T) / denom;
                b = (-h0 - a * T * T) / T;
            } else {
                // Fallback if timing parameters are degenerate.
                a = -h0 / Math.max(1e-6, T * T);
                b = 0;
            }

            this.isJumping = true;
            this.jumpMode = "double";
            this.jumpCount = 2;
            this.jumpElapsedSec = 0;
            this.jumpDurationSec = T;
            this.jumpPolyA = a;
            this.jumpPolyB = b;
            this.jumpPolyC = h0;
        }
    }
    updateJump(dtSec) {
        if (!this.isJumping) {
            this.z = 0;
            return;
        }
        const dt = Math.max(0, Number(dtSec) || 0);
        this.jumpElapsedSec += dt;

        if (this.jumpMode === "double") {
            const t = Math.max(0, this.jumpElapsedSec);
            this.jumpHeight = Math.max(0, this.jumpPolyA * t * t + this.jumpPolyB * t + this.jumpPolyC);
        } else {
            const t = Math.max(0, Math.min(1, this.jumpElapsedSec / this.jumpDurationSec));
            // Symmetric arc: 0 at ends, max at midpoint.
            this.jumpHeight = 4 * this.jumpMaxHeight * t * (1 - t);
        }
        this.z = this.jumpHeight;

        if (this.jumpElapsedSec >= this.jumpDurationSec || this.jumpHeight <= 0.0001) {
            this.isJumping = false;
            this.jumpElapsedSec = 0;
            this.jumpHeight = 0;
            this.jumpCount = 0;
            this.jumpMode = "single";
            this.jumpLockedMovingBackward = false;
            this.z = 0;
        }
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
    getTurnStrengthFromAimVector(targetX, targetY) {
        const zeroDistance = Number.isFinite(this.zeroTurnDistanceUnits)
            ? Math.max(0, this.zeroTurnDistanceUnits)
            : 1;
        const fullDistance = Number.isFinite(this.fullTurnSpeedDistanceUnits)
            ? Math.max(zeroDistance + 1e-6, this.fullTurnSpeedDistanceUnits)
            : 5;
        const distance = Math.hypot(Number(targetX) || 0, Number(targetY) || 0);
        if (distance <= zeroDistance) return 0;
        return Math.max(0, Math.min(1, (distance - zeroDistance) / (fullDistance - zeroDistance)));
    }
    turnToward(targetX, targetY, turnStrength = 1) {
        // Calculate vector from wizard to target (in world coordinates)
        const normalizeDeg = (deg) => {
            let out = deg;
            while (out <= -180) out += 360;
            while (out > 180) out -= 360;
            return out;
        };
        const facingAngleDegByDirectionIndex = [180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];

        // Calculate angle in radians, then convert to degrees.
        const angle = Math.atan2(targetY, targetX);
        const angleInDegrees = normalizeDeg(angle * 180 / Math.PI);
        const nowMs = (Number.isFinite(renderNowMs) && renderNowMs > 0)
            ? renderNowMs
            : performance.now();

        // Smooth facing angle before quantizing to 12 sprite directions.
        // This prevents tiny aim oscillations from causing visible pose jitter.
        if (!Number.isFinite(this.smoothedFacingAngleDeg)) {
            const currentRow = Number.isInteger(this.lastDirectionRow)
                ? this.lastDirectionRow
                : ((Number.isInteger(this.directionIndex) && this.directionIndex >= 0)
                    ? ((this.directionIndex + wizardDirectionRowOffset + 12) % 12)
                    : 0);
            const directionIndex = ((currentRow - wizardDirectionRowOffset) % 12 + 12) % 12;
            const currentFacing = facingAngleDegByDirectionIndex[directionIndex];
            this.smoothedFacingAngleDeg = Number.isFinite(currentFacing)
                ? normalizeDeg(currentFacing)
                : angleInDegrees;
            this._lastTurnTowardMs = nowMs;
        } else if (!Number.isFinite(this._lastTurnTowardMs)) {
            this._lastTurnTowardMs = nowMs;
        } else {
            const dtSecRaw = (nowMs - this._lastTurnTowardMs) / 1000;
            const dtSec = Math.max(1 / 240, Math.min(0.25, Number.isFinite(dtSecRaw) ? dtSecRaw : 0));
            this._lastTurnTowardMs = nowMs;
            const delta = normalizeDeg(angleInDegrees - this.smoothedFacingAngleDeg);
            const smoothing = this.moving ? 0.38 : 0.28;
            const desiredStep = delta * smoothing;
            const clampedStrength = Number.isFinite(turnStrength)
                ? Math.max(0, Math.min(1, turnStrength))
                : 1;
            const maxStep = Math.max(0, Number(this.maxTurnSpeedDegPerSec) || 0) * clampedStrength * dtSec;
            const clampedStep = Math.max(-maxStep, Math.min(maxStep, desiredStep));
            this.smoothedFacingAngleDeg = normalizeDeg(this.smoothedFacingAngleDeg + clampedStep);
        }
        const facingDeg = this.smoothedFacingAngleDeg;
        
        // 12 sprite directions with their center angles
        // East = 0°, going counterclockwise
        const directions = [
            { angle: 0, index: 6 },      // E
            { angle: 30, index: 7 },     // ESE  
            { angle: 60, index: 8 },     // SE
            { angle: 90, index: 9 },     // SSE
            { angle: 120, index: 10 },    // S
            { angle: 150, index: 11 },   // SSW
            { angle: 180, index: 0 },   // W
            { angle: -150, index: 1 },   // WNW
            { angle: -120, index: 2 },   // NW
            { angle: -90, index: 3 },    // NNW
            { angle: -60, index: 4 },    // N
            { angle: -30, index: 5 }     // NNE
        ];
        
        // Find closest direction
        let closestDir = directions[0];
        let minDiff = Math.abs(facingDeg - directions[0].angle);
        
        for (const dir of directions) {
            // Handle angle wrapping (e.g., -170° is close to 170°)
            let diff = Math.abs(facingDeg - dir.angle);
            if (diff > 180) diff = 360 - diff;
            
            if (diff < minDiff) {
                minDiff = diff;
                closestDir = dir;
            }
        }
        
        this.lastDirectionRow = (closestDir.index + wizardDirectionRowOffset + 12) % 12;
    }
    move() {
        super.move();
        centerViewport(this, 0);
    }
    
    getTouchingTiles() {
        // Get all hex tiles that the wizard's circular hitbox is touching
        // Use wizard's radius and current position
        const radius = 0.9; // Wizard ground-plane hitbox radius
        const touchingTiles = new Set();
        
        // Get the center tile
        const centerNode = this.map.worldToNode(this.x, this.y);
        if (centerNode) {
            touchingTiles.add(`${centerNode.xindex},${centerNode.yindex}`);
        }
        
        // Check all neighboring hexes - a circle can touch up to 7 hexes
        // (center + up to 6 neighbors)
        for (let dir = 0; dir < 6; dir++) {
            // Check each neighbor
            const testNode = centerNode?.neighbors[1 + dir * 2];
            if (testNode) {
                // Simple distance check - if neighbor center is within radius + hex distance, include it
                const dx = testNode.x - this.x;
                const dy = testNode.y - this.y;
                const dist = Math.hypot(dx, dy);
                if (dist <= radius) { // 1.0 is approximate hex-to-hex distance
                    touchingTiles.add(`${testNode.xindex},${testNode.yindex}`);
                }
            }
        }
        
        return touchingTiles;
    }

    isOnRoad() {
        const node = this.map.worldToNode(this.x, this.y);
        if (!node || !node.objects) return false;
        if (node.objects.some(obj => obj.type === "road")) {
            return true;
        }

        return false;
    }
    
    moveDirection(vector, options = {}) {
        // Apply physics and collision resolution to the wizard's movement vector
        // Called every frame to process movement, regardless of input

        const lockMovementVector = !!options.lockMovementVector;
        const inputSpeedMultiplier = Number.isFinite(options.speedMultiplier) ? Math.max(0, options.speedMultiplier) : 1;
        const activeAuras = Array.isArray(this.activeAuras)
            ? this.activeAuras
            : (typeof this.activeAura === "string" ? [this.activeAura] : []);
        const auraSpeedMultiplier = activeAuras.includes("speed") ? 2 : 1;
        const maxSpeed = this.speed * inputSpeedMultiplier * auraSpeedMultiplier * (this.isOnRoad() ? this.roadSpeedMultiplier : 1);
        this.currentMaxSpeed = maxSpeed;
        this.isMovingBackward = !!options.animateBackward;
        
        const inputLen = vector ? Math.hypot(vector.x || 0, vector.y || 0) : 0;
        if (lockMovementVector) {
            // Airborne lock: preserve momentum and ignore steering/braking input.
        } else if (vector && inputLen > 1e-6) {
            // Input provided: add acceleration toward desired direction
            if (inputLen > 0) {
                const nx = vector.x / inputLen;
                const ny = vector.y / inputLen;
                
                // If current momentum is opposite of desired direction, remove that component
                const desiredDot = this.movementVector.x * nx + this.movementVector.y * ny;
                if (desiredDot < 0) {
                    // Cancel the opposing component so we don't briefly move backward
                    this.movementVector.x -= nx * desiredDot;
                    this.movementVector.y -= ny * desiredDot;
                    // Damp leftover tangential momentum slightly to reduce yo-yo oscillation
                    this.movementVector.x *= 0.5;
                    this.movementVector.y *= 0.5;
                }
                
                // Add acceleration in the desired direction to movement vector
                const accelerationFactor = this.acceleration / this.frameRate;
                this.movementVector.x += nx * accelerationFactor;
                this.movementVector.y += ny * accelerationFactor;

                const facingVector = options.facingVector;
                if (
                    facingVector &&
                    Number.isFinite(facingVector.x) &&
                    Number.isFinite(facingVector.y) &&
                    Math.hypot(facingVector.x, facingVector.y) > 1e-6
                ) {
                    const facingTurnStrength = Number.isFinite(options.facingTurnStrength)
                        ? Math.max(0, Math.min(1, options.facingTurnStrength))
                        : 1;
                    this.turnToward(facingVector.x, facingVector.y, facingTurnStrength);
                } else {
                    this.turnToward(nx, ny);
                }
            }
        } else {
            // No input: decelerate quickly using same acceleration rate
            this.isMovingBackward = false;
            const currentMag = Math.hypot(this.movementVector.x, this.movementVector.y);
            if (currentMag > 0) {
                const decelerationFactor = this.acceleration / this.frameRate;
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
        
        // Clamp magnitude to max speed
        const currentMag = Math.hypot(this.movementVector.x, this.movementVector.y);
        if (currentMag > maxSpeed) {
            const scale = maxSpeed / currentMag;
            this.movementVector.x *= scale;
            this.movementVector.y *= scale;
        }
        
        // If no movement, skip physics
        if (currentMag < 0.001) {
            this.moving = false;
            return false;
        }
        
        this.moving = true;
        const moveStartX = this.x;
        const moveStartY = this.y;
        
        // Use accumulated movement vector for this frame's position change
        let newX = this.x + this.movementVector.x / this.frameRate;
        let newY = this.y + this.movementVector.y / this.frameRate;
        
        const wizardRadius = this.groundRadius;
        const scriptingApi = (typeof Scripting !== "undefined" && Scripting)
            ? Scripting
            : ((typeof globalThis !== "undefined" && globalThis.Scripting) ? globalThis.Scripting : null);
        const isDoorPlacedObjectFn = (scriptingApi && typeof scriptingApi.isDoorPlacedObject === "function")
            ? scriptingApi.isDoorPlacedObject
            : null;
        const isPointInDoorHitboxFn = (scriptingApi && typeof scriptingApi.isPointInDoorHitbox === "function")
            ? scriptingApi.isPointInDoorHitbox
            : null;
        const processDoorTraversalEventsFn = (scriptingApi && typeof scriptingApi.processDoorTraversalEvents === "function")
            ? scriptingApi.processDoorTraversalEvents
            : null;
        const processObjectTouchEventsFn = (scriptingApi && typeof scriptingApi.processObjectTouchEvents === "function")
            ? scriptingApi.processObjectTouchEvents
            : null;
        
        // Collect nearby objects once to avoid repeated grid traversal
        const nearbyObjects = Array.isArray(this._movementNearbyObjects) ? this._movementNearbyObjects : [];
        nearbyObjects.length = 0;
        this._movementNearbyObjects = nearbyObjects;
        const nearbyDoors = Array.isArray(this._movementNearbyDoors) ? this._movementNearbyDoors : [];
        nearbyDoors.length = 0;
        this._movementNearbyDoors = nearbyDoors;
        const nearbyScriptTouchables = Array.isArray(this._movementNearbyScriptTouchables) ? this._movementNearbyScriptTouchables : [];
        nearbyScriptTouchables.length = 0;
        this._movementNearbyScriptTouchables = nearbyScriptTouchables;
        const nearbyScriptTouchableSet = (this._movementNearbyScriptTouchableSet instanceof Set) ? this._movementNearbyScriptTouchableSet : new Set();
        nearbyScriptTouchableSet.clear();
        this._movementNearbyScriptTouchableSet = nearbyScriptTouchableSet;
        const nearbyScriptTouchableEntryByObject = (this._movementNearbyScriptTouchableEntryByObject instanceof Map)
            ? this._movementNearbyScriptTouchableEntryByObject
            : new Map();
        nearbyScriptTouchableEntryByObject.clear();
        this._movementNearbyScriptTouchableEntryByObject = nearbyScriptTouchableEntryByObject;
        const minNode = this.map.worldToNode(newX - 2, newY - 2);
        const maxNode = this.map.worldToNode(newX + 2, newY + 2);
        
        if (minNode && maxNode) {
            const xStart = Math.max(minNode.xindex - 1, 0);
            const xEnd = Math.min(maxNode.xindex + 1, mapWidth - 1);
            const yStart = Math.max(minNode.yindex - 1, 0);
            const yEnd = Math.min(maxNode.yindex + 1, mapHeight - 1);

            for (let x = xStart; x <= xEnd; x++) {
                for (let y = yStart; y <= yEnd; y++) {
                    if (!this.map.nodes[x] || !this.map.nodes[x][y] || !this.map.nodes[x][y].objects) continue;
                    const nodeObjects = this.map.nodes[x][y].objects;
                    for (const obj of nodeObjects) {
                        if (!obj || obj.gone) continue;
                        const doorCandidate = !!(isDoorPlacedObjectFn && isDoorPlacedObjectFn(obj));
                        if (doorCandidate) {
                            const doorHitbox = obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox;
                            if (doorHitbox && (typeof doorHitbox.containsPoint === "function" || typeof doorHitbox.intersects === "function")) {
                                nearbyDoors.push({ obj, hitbox: doorHitbox });
                            }
                        }
                        const touchHitbox = obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox;
                        if (
                            touchHitbox &&
                            (typeof touchHitbox.containsPoint === "function" || typeof touchHitbox.intersects === "function") &&
                            !nearbyScriptTouchableSet.has(obj)
                        ) {
                            nearbyScriptTouchableSet.add(obj);
                            const entry = { obj, hitbox: touchHitbox, forceTouch: false };
                            nearbyScriptTouchables.push(entry);
                            nearbyScriptTouchableEntryByObject.set(obj, entry);
                        }
                        if (obj.groundPlaneHitbox && !obj.isPassable) {
                            nearbyObjects.push(obj);
                        }
                    }
                }
            }
        }

        const isInOrTouchingNearbyDoor = (px, py, radius = 0) => {
            for (let i = 0; i < nearbyDoors.length; i++) {
                const hb = nearbyDoors[i] && nearbyDoors[i].hitbox;
                if (isPointInDoorHitboxFn && isPointInDoorHitboxFn(hb, px, py, radius)) {
                    return true;
                }
            }
            return false;
        };

        // While inside a door hitbox, bypass all blocking object collisions.
        if (
            isInOrTouchingNearbyDoor(this.x, this.y, wizardRadius) ||
            isInOrTouchingNearbyDoor(newX, newY, wizardRadius)
        ) {
            const wrappedX = this.map && typeof this.map.wrapWorldX === "function" ? this.map.wrapWorldX(newX) : newX;
            const wrappedY = this.map && typeof this.map.wrapWorldY === "function" ? this.map.wrapWorldY(newY) : newY;
            if (this === wizard) {
                applyViewportWrapShift(wrappedX - newX, wrappedY - newY);
            }
            this.x = wrappedX;
            this.y = wrappedY;
            this.updateHitboxes();
            centerViewport(this, 0);
            if (this === wizard) {
                if (processDoorTraversalEventsFn) {
                    processDoorTraversalEventsFn(this, moveStartX, moveStartY, this.x, this.y, nearbyDoors, wizardRadius);
                }
                if (processObjectTouchEventsFn) {
                    processObjectTouchEventsFn(this, nearbyScriptTouchables, wizardRadius);
                }
            }
            return true;
        }
        
        // Iteratively resolve collisions until we find a clear position
        let testX = newX;
        let testY = newY;
        let iteration = 0;
        const maxIterations = 3; // Prevent infinite loops
        
        while (iteration < maxIterations) {
            iteration++;
            const testHitbox = this._movementTestHitbox || { type: "circle", x: testX, y: testY, radius: wizardRadius };
            testHitbox.x = testX;
            testHitbox.y = testY;
            testHitbox.radius = wizardRadius;
            this._movementTestHitbox = testHitbox;
            
            // Check all nearby objects for collisions at current test position
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
                    if (this === wizard) {
                        const touchEntry = nearbyScriptTouchableEntryByObject.get(obj);
                        if (touchEntry) {
                            touchEntry.forceTouch = true;
                        }
                    }
                }
            }
            
            // If no collisions, we're done
            if (!hasCollision) {
                const wrappedX = this.map && typeof this.map.wrapWorldX === "function" ? this.map.wrapWorldX(testX) : testX;
                const wrappedY = this.map && typeof this.map.wrapWorldY === "function" ? this.map.wrapWorldY(testY) : testY;
                if (this === wizard) {
                    applyViewportWrapShift(wrappedX - testX, wrappedY - testY);
                }
                this.x = wrappedX;
                this.y = wrappedY;
                this.updateHitboxes();
                centerViewport(this, 0);
                if (this === wizard) {
                    if (processDoorTraversalEventsFn) {
                        processDoorTraversalEventsFn(this, moveStartX, moveStartY, this.x, this.y, nearbyDoors, wizardRadius);
                    }
                    if (processObjectTouchEventsFn) {
                        processObjectTouchEventsFn(this, nearbyScriptTouchables, wizardRadius);
                    }
                }
                return true;
            }
            
            // Resolve collision
            let pushLen = Math.hypot(totalPushX, totalPushY);
            
            // Cap push vector to the maximum individual penetration depth
            if (pushLen > maxPushLen && maxPushLen > 0) {
                const scale = maxPushLen / pushLen;
                totalPushX *= scale;
                totalPushY *= scale;
                pushLen = maxPushLen;
            }
            
            if (pushLen > 0) {
                const normalX = totalPushX / pushLen;
                const normalY = totalPushY / pushLen;
                
                // Soft collision: allow compression up to a threshold with proportional resistance
                const compressionThreshold = 0.15;
                const compression = Math.max(0, pushLen - compressionThreshold);
                
                if (compression > 0) {
                    // Hard push-back: reduce velocity component along normal
                    const resistanceFactor = Math.min(1, compression / 0.1);
                    const normalComponent = this.movementVector.x * normalX + this.movementVector.y * normalY;
                    
                    if (normalComponent > 0) {
                        this.movementVector.x -= normalX * normalComponent * resistanceFactor;
                        this.movementVector.y -= normalY * normalComponent * resistanceFactor;
                    }
                } else {
                    // Within compression threshold - apply gentle damping
                    const dampingFactor = 1 - (pushLen / compressionThreshold) * 0.4;
                    this.movementVector.x *= dampingFactor;
                    this.movementVector.y *= dampingFactor;
                    
                    const normalComponent = this.movementVector.x * normalX + this.movementVector.y * normalY;
                    if (normalComponent > 0) {
                        this.movementVector.x -= normalX * normalComponent * 0.2;
                        this.movementVector.y -= normalY * normalComponent * 0.2;
                    }
                }
                
                // Push out minimally and apply modified movement
                const pushOutDistance = pushLen + 0.01;
                testX = this.x + normalX * pushOutDistance + this.movementVector.x / this.frameRate;
                testY = this.y + normalY * pushOutDistance + this.movementVector.y / this.frameRate;
            } else {
                break;
            }
        }
        
        // If we exhausted iterations, at least push out to clear the collision
        const testHitbox = this._movementTestHitbox || { type: "circle", x: testX, y: testY, radius: wizardRadius };
        testHitbox.x = testX;
        testHitbox.y = testY;
        testHitbox.radius = wizardRadius;
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
                if (this === wizard) {
                    const touchEntry = nearbyScriptTouchableEntryByObject.get(obj);
                    if (touchEntry) {
                        touchEntry.forceTouch = true;
                    }
                }
            }
        }
        
        if (maxPushLen > 0) {
            const pushLen = Math.hypot(totalPushX, totalPushY);
            if (pushLen > maxPushLen && maxPushLen > 0) {
                const scale = maxPushLen / pushLen;
                totalPushX *= scale;
                totalPushY *= scale;
            }
            
            const normalX = totalPushX / Math.hypot(totalPushX, totalPushY);
            const normalY = totalPushY / Math.hypot(totalPushX, totalPushY);
            const pushOutDistance = maxPushLen + 0.01;
            
            const resolvedX = this.x + normalX * pushOutDistance;
            const resolvedY = this.y + normalY * pushOutDistance;
            const wrappedX = this.map && typeof this.map.wrapWorldX === "function" ? this.map.wrapWorldX(resolvedX) : resolvedX;
            const wrappedY = this.map && typeof this.map.wrapWorldY === "function" ? this.map.wrapWorldY(resolvedY) : resolvedY;
            if (this === wizard) {
                applyViewportWrapShift(wrappedX - resolvedX, wrappedY - resolvedY);
            }
            this.x = wrappedX;
            this.y = wrappedY;
            this.updateHitboxes();
            centerViewport(this, 0);
            if (this === wizard) {
                if (processDoorTraversalEventsFn) {
                    processDoorTraversalEventsFn(this, moveStartX, moveStartY, this.x, this.y, nearbyDoors, wizardRadius);
                }
                if (processObjectTouchEventsFn) {
                    processObjectTouchEventsFn(this, nearbyScriptTouchables, wizardRadius);
                }
            }
            return true;
        }
        
        // No collision - apply the movement
        const wrappedX = this.map && typeof this.map.wrapWorldX === "function" ? this.map.wrapWorldX(newX) : newX;
        const wrappedY = this.map && typeof this.map.wrapWorldY === "function" ? this.map.wrapWorldY(newY) : newY;
        if (this === wizard) {
            applyViewportWrapShift(wrappedX - newX, wrappedY - newY);
        }
        this.x = wrappedX;
        this.y = wrappedY;
        this.updateHitboxes();
        centerViewport(this, 0);
        if (this === wizard) {
            if (processDoorTraversalEventsFn) {
                processDoorTraversalEventsFn(this, moveStartX, moveStartY, this.x, this.y, nearbyDoors, wizardRadius);
            }
            if (processObjectTouchEventsFn) {
                processObjectTouchEventsFn(this, nearbyScriptTouchables, wizardRadius);
            }
        }
        return true;
    }
    
    drawHat(interpolatedJumpHeight = null, interpolatedWorldPosition = null) {
        // Recalculate screen position from world coordinates
        const renderWorld = interpolatedWorldPosition || this.getInterpolatedPosition();
        const screenCoors = worldToScreen({ x: renderWorld.x, y: renderWorld.y });
        let wizardScreenX = screenCoors.x;
        const jumpHeightForRender = Number.isFinite(interpolatedJumpHeight)
            ? interpolatedJumpHeight
            : (Number.isFinite(renderWorld.z) ? renderWorld.z : 0);
        const jumpOffsetPx = jumpHeightForRender * viewscale * xyratio;
        const hatYOffset = (Number.isFinite(this.hatRenderYOffsetUnits) ? this.hatRenderYOffsetUnits : 0) * viewscale * xyratio;
        let wizardScreenY = screenCoors.y - jumpOffsetPx - hatYOffset;

        if (!this.hatGraphics) return;
        if (this.hatGraphics.parent !== characterLayer) {
            characterLayer.addChild(this.hatGraphics);
        }
        this.hatGraphics.x = wizardScreenX;
        this.hatGraphics.y = wizardScreenY;
        const hatResolution = Number.isFinite(this.hatResolution) ? Math.max(1, this.hatResolution) : 1;
        const hatRenderScale = Number.isFinite(this.hatRenderScale) ? Math.max(0.05, this.hatRenderScale) : 1;
        this.hatGraphics.scale.set((viewscale / hatResolution) * hatRenderScale, (viewscale / hatResolution) * hatRenderScale);
        this.hatGraphics.visible = true;

        // Ensure hat graphics are rendered on top by moving to end of container
        if (characterLayer.children.indexOf(this.hatGraphics) !== characterLayer.children.length - 1) {
            characterLayer.setChildIndex(this.hatGraphics, characterLayer.children.length - 1);
        }
    }

    redrawHatGeometry() {
        const hatResolution = Number.isFinite(this.hatResolution) ? Math.max(1, this.hatResolution) : 1;

        // Wizard hat positioning constants
        const brimX = 0 * hatResolution;
        const brimY = -0.625 * hatResolution;
        const brimWidth = 0.5 * hatResolution;
        const brimHeight = 0.25 * hatResolution;
        const pointX = 0 * hatResolution;
        const pointY = -0.65 * hatResolution;
        const pointHeight = 0.35 * hatResolution;
        const pointWidth = brimWidth * 0.6;
        const bandInnerHeight = brimHeight * 0.4;
        const bandInnerWidth = pointWidth * 0.8;
        const bandOuterWidth = pointWidth;
        const bandOuterHeight = brimHeight / brimWidth * bandOuterWidth;

        this.hatGraphics.clear();
        // Draw hat brim (oval/ellipse)
        this.hatGraphics.beginFill(this.hatColor, 1);
        this.hatGraphics.drawEllipse(brimX, brimY, brimWidth / 2, brimHeight / 2);
        this.hatGraphics.endFill();
        
        // Draw hat band outer (gold oval, slightly smaller than brim)
        this.hatGraphics.beginFill(this.hatBandColor, 1);
        this.hatGraphics.drawEllipse(brimX, brimY, bandOuterWidth / 2, bandOuterHeight / 2);
        this.hatGraphics.endFill();
        
        // // Draw hat band inner (blue oval, smaller, same width as point)
        this.hatGraphics.beginFill(this.hatColor, 1);
        this.hatGraphics.drawEllipse(brimX, brimY, bandInnerWidth / 2, bandInnerHeight / 2);
        this.hatGraphics.drawRect(brimX - bandInnerWidth / 2, brimY - bandInnerHeight, bandInnerWidth, bandInnerHeight);
        this.hatGraphics.endFill();
        
        // Draw hat point (triangle)
        this.hatGraphics.beginFill(this.hatColor, 1);
        this.hatGraphics.moveTo(pointX, pointY - pointHeight); // Top point
        this.hatGraphics.lineTo(pointX - pointWidth / 2, pointY); // Bottom left
        this.hatGraphics.lineTo(pointX + pointWidth / 2, pointY); // Bottom right
        this.hatGraphics.closePath();
        this.hatGraphics.endFill();
    }
    
    updateStatusBars() {
        // Update health bar width
        const healthRatio = Math.max(0, Math.min(1, this.hp / this.maxHp));
        $("#healthBar").css('width', (healthRatio * 100) + '%');
        
        // Update magic bar width
        const magicRatio = Math.max(0, Math.min(1, this.magic / this.maxMagic));
        $("#magicBar").css('width', (magicRatio * 100) + '%');
    }
    
    draw() {
        if (!this.pixiSprite) {
            this.pixiSprite = new PIXI.Sprite(wizardFrames[0] || PIXI.Texture.WHITE);
            characterLayer.addChild(this.pixiSprite);
        }

        const renderWorld = this.getInterpolatedPosition();
        const interpolatedJumpHeight = Number.isFinite(renderWorld.z) ? renderWorld.z : 0;

        // Draw a ground shadow from the same interpolated world position as the sprite.
        const screenCoors = worldToScreen({ x: renderWorld.x, y: renderWorld.y });
        const shadowCoors = {
            x: screenCoors.x,
            y: screenCoors.y + 0.2 * viewscale * xyratio
        };
        const shadowRadiusX = 0.2 * viewscale; // 0.3 map units wide (diameter)
        const shadowRadiusY = shadowRadiusX * xyratio;
        this.shadowGraphics.clear();
        this.shadowGraphics.beginFill(0x000000, 0.3);
        this.shadowGraphics.drawEllipse(shadowCoors.x, shadowCoors.y, shadowRadiusX, shadowRadiusY);
        this.shadowGraphics.endFill();
        if (this.pixiSprite && this.shadowGraphics.parent) {
            const spriteIndex = characterLayer.children.indexOf(this.pixiSprite);
            const shadowIndex = characterLayer.children.indexOf(this.shadowGraphics);
            if (spriteIndex > 0 && shadowIndex >= spriteIndex) {
                characterLayer.setChildIndex(this.shadowGraphics, spriteIndex - 1);
            }
        }
        
        // Determine which row (direction) to use
        const visualSpeed = Math.hypot(this.movementVector?.x || 0, this.movementVector?.y || 0);
        const isVisuallyMoving = this.moving || visualSpeed > 0.02;
        if (this.lastDirectionRow === undefined) this.lastDirectionRow = 0;
        const rowIndex = this.lastDirectionRow;
        
        // Determine which frame (column) to show for animation
        let frameIndex = rowIndex * 9; // Start of this row
        if (this.isJumping) {
            // Keep a fixed airborne pose while jumping.
            const airborneFrameCol = 2;
            frameIndex = rowIndex * 9 + airborneFrameCol;
        } else if (isVisuallyMoving) {
            // Columns 1-8 = running animation (8 frames)
            // Column 0 = standing still
            const speedRatio = (this.speed > 0) ? (visualSpeed / this.speed) : 0;
            const simTicks = (renderNowMs / 1000) * frameRate;
            const animFrame = Math.floor(simTicks * this.animationSpeedMultiplier * speedRatio / 2) % 8;
            const effectiveAnimFrame = this.isMovingBackward ? (7 - animFrame) : animFrame;
            frameIndex = rowIndex * 9 + 1 + effectiveAnimFrame;
        }
        
        // Set the texture to the appropriate frame
        if (wizardFrames[frameIndex]) {
            this.pixiSprite.texture = wizardFrames[frameIndex];
        }
        
        // Update wizard sprite position
        const jumpOffsetPx = interpolatedJumpHeight * viewscale * xyratio;
        
        this.pixiSprite.x = screenCoors.x;
        this.pixiSprite.y = screenCoors.y - jumpOffsetPx;
        this.pixiSprite.anchor.set(0.5, 0.75);
        this.pixiSprite.width = viewscale;
        this.pixiSprite.height = viewscale;

        this.drawHat(interpolatedJumpHeight, renderWorld);
    }

    saveJson() {
        const viewportX = (this.map && typeof this.map.wrapWorldX === "function")
            ? this.map.wrapWorldX(viewport.x)
            : viewport.x;
        const viewportY = (this.map && typeof this.map.wrapWorldY === "function")
            ? this.map.wrapWorldY(viewport.y)
            : viewport.y;
        return {
            type: 'wizard',
            x: (this.map && typeof this.map.wrapWorldX === "function") ? this.map.wrapWorldX(this.x) : this.x,
            y: (this.map && typeof this.map.wrapWorldY === "function") ? this.map.wrapWorldY(this.y) : this.y,
            hp: this.hp,
            maxHp: this.maxHp,
            magic: this.magic,
            maxMagic: this.maxMagic,
            magicRegenPerSecond: this.magicRegenPerSecond,
            food: this.food,
            currentSpell: this.currentSpell,
            activeAura: this.activeAura || null,
            activeAuras: Array.isArray(this.activeAuras) ? this.activeAuras.slice() : (this.activeAura ? [this.activeAura] : []),
            selectedFlooringTexture: this.selectedFlooringTexture,
            selectedTreeTextureVariant: this.selectedTreeTextureVariant,
            selectedPlaceableCategory: this.selectedPlaceableCategory,
            selectedPlaceableTexturePath: this.selectedPlaceableTexturePath,
            selectedPlaceableByCategory: this.selectedPlaceableByCategory,
            selectedPlaceableRenderOffset: this.selectedPlaceableRenderOffset,
            selectedPlaceableRenderOffsetByTexture: this.selectedPlaceableRenderOffsetByTexture,
            selectedPlaceableScale: this.selectedPlaceableScale,
            selectedPlaceableScaleByTexture: this.selectedPlaceableScaleByTexture,
            selectedPlaceableRotation: this.selectedPlaceableRotation,
            selectedPlaceableRotationByTexture: this.selectedPlaceableRotationByTexture,
            selectedPlaceableRotationAxis: this.selectedPlaceableRotationAxis,
            selectedPlaceableRotationAxisByTexture: this.selectedPlaceableRotationAxisByTexture,
            selectedPlaceableAnchorX: this.selectedPlaceableAnchorX,
            selectedPlaceableAnchorY: this.selectedPlaceableAnchorY,
            selectedPlaceableAnchorXByTexture: this.selectedPlaceableAnchorXByTexture,
            selectedPlaceableAnchorYByTexture: this.selectedPlaceableAnchorYByTexture,
            selectedPowerupPlacementScale: this.selectedPowerupPlacementScale,
            selectedEditorCategory: this.selectedEditorCategory,
            selectedWallHeight: this.selectedWallHeight,
            selectedWallThickness: this.selectedWallThickness,
            selectedWallTexture: this.selectedWallTexture,
            selectedRoofOverhang: this.selectedRoofOverhang,
            selectedRoofPeakHeight: this.selectedRoofPeakHeight,
            showEditorPanel: this.showEditorPanel !== false,
            showPerfReadout: !!showPerfReadout,
            spells: this.spells,
            inventory: this.inventory,
            viewport: {
                x: viewportX,
                y: viewportY
            }
        };
    }

    loadJson(data) {
        const normalizeTexturePath = (value) => {
            if (typeof globalThis !== "undefined" && typeof globalThis.normalizeLegacyAssetPath === "function") {
                return globalThis.normalizeLegacyAssetPath(value);
            }
            return value;
        };
        const normalizeTextureKeyMap = (obj) => {
            if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
            const out = {};
            Object.keys(obj).forEach((key) => {
                const normalizedKey = normalizeTexturePath(key);
                out[normalizedKey] = obj[key];
            });
            return out;
        };
        const normalizeTextureValueMap = (obj) => {
            if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
            const out = {};
            Object.keys(obj).forEach((key) => {
                const value = obj[key];
                out[key] = (typeof value === "string") ? normalizeTexturePath(value) : value;
            });
            return out;
        };

        if (data.x !== undefined) this.x = data.x;
        if (data.y !== undefined) this.y = data.y;
        if (data.hp !== undefined) this.hp = data.hp;
        if (data.maxHp !== undefined) this.maxHp = data.maxHp;
        if (data.magic !== undefined) this.magic = data.magic;
        if (data.maxMagic !== undefined) this.maxMagic = data.maxMagic;
        if (Number.isFinite(data.magicRegenPerSecond)) this.magicRegenPerSecond = Math.max(0, data.magicRegenPerSecond);
        if (data.food !== undefined) this.food = data.food;
        if (data.currentSpell !== undefined) this.currentSpell = data.currentSpell;
        if (Array.isArray(data.activeAuras)) {
            this.activeAuras = data.activeAuras.slice();
            this.activeAura = this.activeAuras.length > 0 ? this.activeAuras[0] : null;
        } else if (data.activeAura !== undefined) {
            this.activeAura = data.activeAura;
            this.activeAuras = (typeof data.activeAura === "string" && data.activeAura.length > 0) ? [data.activeAura] : [];
        }
        if (data.selectedFlooringTexture !== undefined) this.selectedFlooringTexture = data.selectedFlooringTexture;
        if (data.selectedTreeTextureVariant !== undefined) this.selectedTreeTextureVariant = data.selectedTreeTextureVariant;
        if (data.selectedPlaceableCategory !== undefined) this.selectedPlaceableCategory = data.selectedPlaceableCategory;
        if (data.selectedPlaceableTexturePath !== undefined) this.selectedPlaceableTexturePath = normalizeTexturePath(data.selectedPlaceableTexturePath);
        if (data.selectedPlaceableByCategory !== undefined) this.selectedPlaceableByCategory = normalizeTextureValueMap(data.selectedPlaceableByCategory);
        if (data.selectedPlaceableRenderOffset !== undefined) this.selectedPlaceableRenderOffset = data.selectedPlaceableRenderOffset;
        if (data.selectedPlaceableRenderOffsetByTexture !== undefined) this.selectedPlaceableRenderOffsetByTexture = normalizeTextureKeyMap(data.selectedPlaceableRenderOffsetByTexture);
        if (data.selectedPlaceableScale !== undefined) this.selectedPlaceableScale = data.selectedPlaceableScale;
        if (data.selectedPlaceableScaleByTexture !== undefined) this.selectedPlaceableScaleByTexture = normalizeTextureKeyMap(data.selectedPlaceableScaleByTexture);
        if (data.selectedPlaceableRotation !== undefined) this.selectedPlaceableRotation = data.selectedPlaceableRotation;
        if (data.selectedPlaceableRotationByTexture !== undefined) this.selectedPlaceableRotationByTexture = normalizeTextureKeyMap(data.selectedPlaceableRotationByTexture);
        if (data.selectedPlaceableRotationAxis !== undefined) this.selectedPlaceableRotationAxis = data.selectedPlaceableRotationAxis;
        if (data.selectedPlaceableRotationAxisByTexture !== undefined) this.selectedPlaceableRotationAxisByTexture = normalizeTextureKeyMap(data.selectedPlaceableRotationAxisByTexture);
        if (data.selectedPlaceableAnchorX !== undefined) this.selectedPlaceableAnchorX = data.selectedPlaceableAnchorX;
        if (data.selectedPlaceableAnchorY !== undefined) this.selectedPlaceableAnchorY = data.selectedPlaceableAnchorY;
        if (data.selectedPlaceableAnchorXByTexture !== undefined) this.selectedPlaceableAnchorXByTexture = normalizeTextureKeyMap(data.selectedPlaceableAnchorXByTexture);
        if (data.selectedPlaceableAnchorYByTexture !== undefined) this.selectedPlaceableAnchorYByTexture = normalizeTextureKeyMap(data.selectedPlaceableAnchorYByTexture);
        if (data.selectedPowerupPlacementScale !== undefined) this.selectedPowerupPlacementScale = data.selectedPowerupPlacementScale;
        if (data.selectedEditorCategory !== undefined) this.selectedEditorCategory = data.selectedEditorCategory;
        if (data.selectedWallHeight !== undefined) this.selectedWallHeight = data.selectedWallHeight;
        if (data.selectedWallThickness !== undefined) this.selectedWallThickness = data.selectedWallThickness;
        if (data.selectedWallTexture !== undefined) this.selectedWallTexture = data.selectedWallTexture;
        if (data.selectedRoofOverhang !== undefined) this.selectedRoofOverhang = data.selectedRoofOverhang;
        if (data.selectedRoofPeakHeight !== undefined) this.selectedRoofPeakHeight = data.selectedRoofPeakHeight;
        if (typeof data.showEditorPanel === "boolean") this.showEditorPanel = data.showEditorPanel;
        if (typeof data.showPerfReadout === "boolean") {
            if (typeof setShowPerfReadout === "function") {
                setShowPerfReadout(data.showPerfReadout);
            } else {
                showPerfReadout = data.showPerfReadout;
                if (perfPanel) {
                    perfPanel.css("display", showPerfReadout ? "block" : "none");
                }
            }
        }
        if (data.spells !== undefined) this.spells = data.spells;
        if (data.inventory !== undefined) this.inventory = data.inventory;
        if (this.map && typeof this.map.wrapWorldX === "function" && Number.isFinite(this.x)) {
            this.x = this.map.wrapWorldX(this.x);
        }
        if (this.map && typeof this.map.wrapWorldY === "function" && Number.isFinite(this.y)) {
            this.y = this.map.wrapWorldY(this.y);
        }
        this._doorTraversalStateById = new Map();

        this.node = this.map.worldToNode(this.x, this.y) || this.node;
        this.updateHitboxes();

        if (data.viewport && Number.isFinite(data.viewport.x) && Number.isFinite(data.viewport.y)) {
            viewport.x = data.viewport.x;
            viewport.y = data.viewport.y;
            viewport.prevX = viewport.x;
            viewport.prevY = viewport.y;
        } else {
            centerViewport(this, 0, 0);
            viewport.prevX = viewport.x;
            viewport.prevY = viewport.y;
        }

        if (this.map && typeof this.map.wrapWorldX === "function") {
            viewport.x = this.map.wrapWorldX(viewport.x);
            viewport.prevX = this.map.wrapWorldX(Number.isFinite(viewport.prevX) ? viewport.prevX : viewport.x);
        }
        if (this.map && typeof this.map.wrapWorldY === "function") {
            viewport.y = this.map.wrapWorldY(viewport.y);
            viewport.prevY = this.map.wrapWorldY(Number.isFinite(viewport.prevY) ? viewport.prevY : viewport.y);
        }
        // Keep loaded camera on the wizard's nearest torus copy.
        if (
            this.map &&
            typeof this.map.shortestDeltaX === "function" &&
            typeof this.map.shortestDeltaY === "function" &&
            Number.isFinite(this.x) &&
            Number.isFinite(this.y)
        ) {
            const centerX = viewport.x + viewport.width * 0.5;
            const centerY = viewport.y + viewport.height * 0.5;
            const nearestCenterX = this.x + this.map.shortestDeltaX(this.x, centerX);
            const nearestCenterY = this.y + this.map.shortestDeltaY(this.y, centerY);
            viewport.x += (nearestCenterX - centerX);
            viewport.y += (nearestCenterY - centerY);
        }
        // Prevent stale interpolation from drawing wizard at pre-load coordinates.
        this.prevX = this.x;
        this.prevY = this.y;
        this.prevZ = this.z;
        this.prevJumpHeight = Number.isFinite(this.jumpHeight) ? this.jumpHeight : 0;
        if (typeof mousePos !== "undefined") {
            if (
                typeof syncMouseWorldFromScreenWithViewport === "function" &&
                Number.isFinite(mousePos.screenX) &&
                Number.isFinite(mousePos.screenY)
            ) {
                syncMouseWorldFromScreenWithViewport();
            } else {
                mousePos.worldX = this.x;
                mousePos.worldY = this.y;
            }
        }
        if (typeof pointerLockAimWorld !== "undefined") {
            pointerLockAimWorld.x = this.x;
            pointerLockAimWorld.y = this.y;
        }

        if (typeof this.refreshSpellSelector === 'function') {
            this.refreshSpellSelector();
        }
        if (typeof this.refreshEditorSelector === "function") {
            this.refreshEditorSelector();
        }
        if (typeof SpellSystem !== "undefined" && typeof SpellSystem.setEditorPanelVisible === "function") {
            SpellSystem.setEditorPanelVisible(this, this.showEditorPanel !== false);
        }
        if (typeof SpellSystem !== "undefined" && typeof SpellSystem.refreshAuraSelector === "function") {
            SpellSystem.refreshAuraSelector(this);
        }
    }
}
