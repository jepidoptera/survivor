const WIZARD_GAME_MODE_GOD = "god";
const WIZARD_GAME_MODE_ADVENTURE = "adventure";

const WIZARD_SHIELD_DEPTH_NEAR_METRIC = -128;
const WIZARD_SHIELD_DEPTH_FAR_METRIC = 256;
const WIZARD_SHIELD_WIREFRAME_VS = `
precision highp float;
attribute vec3 aWorldPosition;
uniform vec2 uScreenSize;
uniform vec2 uScreenJitter;
uniform vec2 uCameraWorld;
uniform float uViewScale;
uniform float uXyRatio;
uniform vec2 uDepthRange;
uniform vec2 uWorldSize;
uniform vec2 uWrapEnabled;
uniform vec2 uWrapAnchorWorld;
uniform float uZOffset;
void main(void) {
    float anchorDx = uWrapAnchorWorld.x - uCameraWorld.x;
    float anchorDy = uWrapAnchorWorld.y - uCameraWorld.y;
    if (uWrapEnabled.x > 0.5 && uWorldSize.x > 0.0) {
        anchorDx = mod(anchorDx + 0.5 * uWorldSize.x, uWorldSize.x);
        if (anchorDx < 0.0) anchorDx += uWorldSize.x;
        anchorDx -= 0.5 * uWorldSize.x;
    }
    if (uWrapEnabled.y > 0.5 && uWorldSize.y > 0.0) {
        anchorDy = mod(anchorDy + 0.5 * uWorldSize.y, uWorldSize.y);
        if (anchorDy < 0.0) anchorDy += uWorldSize.y;
        anchorDy -= 0.5 * uWorldSize.y;
    }
    float localDx = aWorldPosition.x - uWrapAnchorWorld.x;
    float localDy = aWorldPosition.y - uWrapAnchorWorld.y;
    float camDx = anchorDx + localDx;
    float camDy = anchorDy + localDy;
    float camDz = aWorldPosition.z;
    float sx = max(1.0, uScreenSize.x);
    float sy = max(1.0, uScreenSize.y);
    float screenX = camDx * uViewScale;
    float screenY = (camDy - camDz) * uViewScale * uXyRatio;
    float depthMetric = camDy + camDz;
    float farMetric = uDepthRange.x;
    float invSpan = max(1e-6, uDepthRange.y);
    float nd = clamp((farMetric - depthMetric) * invSpan, 0.0, 1.0);
    vec2 clip = vec2(
        (screenX / sx) * 2.0 - 1.0,
        1.0 - (screenY / sy) * 2.0
    );
    clip += vec2(
        (uScreenJitter.x / sx) * 2.0,
        -(uScreenJitter.y / sy) * 2.0
    );
    gl_Position = vec4(clip, nd * 2.0 - 1.0 + (uZOffset * 0.001), 1.0);
}
`;
const WIZARD_SHIELD_WIREFRAME_FS = `
precision highp float;
uniform vec4 uColor;
void main(void) {
    gl_FragColor = uColor;
}
`;

let wizardShieldWireframeState = null;
let wizardShieldDodecahedronCache = null;

function ensureWizardShieldWireframeState() {
    if (typeof PIXI === "undefined" || !PIXI.State) return null;
    if (wizardShieldWireframeState) return wizardShieldWireframeState;
    const state = new PIXI.State();
    state.depthTest = true;
    state.depthMask = false;
    state.blend = true;
    state.culling = false;
    wizardShieldWireframeState = state;
    return state;
}

function getWizardShieldDodecahedronModel() {
    if (wizardShieldDodecahedronCache) return wizardShieldDodecahedronCache;
    const phi = (1 + Math.sqrt(5)) / 2;
    const invPhi = 1 / phi;
    const vertices = [];
    const pushVertex = (x, y, z) => vertices.push({ x, y, z });
    [-1, 1].forEach(x => {
        [-1, 1].forEach(y => {
            [-1, 1].forEach(z => pushVertex(x, y, z));
        });
    });
    [-1, 1].forEach(y => {
        [-1, 1].forEach(z => pushVertex(0, y * invPhi, z * phi));
    });
    [-1, 1].forEach(x => {
        [-1, 1].forEach(y => pushVertex(x * invPhi, y * phi, 0));
    });
    [-1, 1].forEach(x => {
        [-1, 1].forEach(z => pushVertex(x * phi, 0, z * invPhi));
    });

    let minDist = Infinity;
    for (let i = 0; i < vertices.length; i++) {
        for (let j = i + 1; j < vertices.length; j++) {
            const dx = vertices[i].x - vertices[j].x;
            const dy = vertices[i].y - vertices[j].y;
            const dz = vertices[i].z - vertices[j].z;
            const dist = Math.hypot(dx, dy, dz);
            if (dist > 1e-6 && dist < minDist) {
                minDist = dist;
            }
        }
    }

    const edges = [];
    const tolerance = 1e-4;
    for (let i = 0; i < vertices.length; i++) {
        for (let j = i + 1; j < vertices.length; j++) {
            const dx = vertices[i].x - vertices[j].x;
            const dy = vertices[i].y - vertices[j].y;
            const dz = vertices[i].z - vertices[j].z;
            const dist = Math.hypot(dx, dy, dz);
            if (Math.abs(dist - minDist) <= tolerance) {
                edges.push([i, j]);
            }
        }
    }

    wizardShieldDodecahedronCache = { vertices, edges };
    return wizardShieldDodecahedronCache;
}

function rotateShieldModelVertex(vertex, yawRad, pitchRad, rollRad = 0) {
    const cy = Math.cos(yawRad);
    const sy = Math.sin(yawRad);
    const cp = Math.cos(pitchRad);
    const sp = Math.sin(pitchRad);
    const cr = Math.cos(rollRad);
    const sr = Math.sin(rollRad);

    const x1 = vertex.x * cy - vertex.y * sy;
    const y1 = vertex.x * sy + vertex.y * cy;
    const z1 = vertex.z;

    const x2 = x1 * cr + z1 * sr;
    const y2 = y1;
    const z2 = -x1 * sr + z1 * cr;

    return {
        x: x2,
        y: (y2 * cp) - (z2 * sp),
        z: (y2 * sp) + (z2 * cp)
    };
}

function getWizardShieldRenderScreenSize() {
    const renderer = globalThis.app && globalThis.app.renderer ? globalThis.app.renderer : null;
    const screen = renderer && renderer.screen ? renderer.screen : null;
    const width = (screen && Number.isFinite(screen.width)) ? Number(screen.width) : window.innerWidth;
    const height = (screen && Number.isFinite(screen.height)) ? Number(screen.height) : window.innerHeight;
    return {
        width: Math.max(1, width || 1),
        height: Math.max(1, height || 1)
    };
}

function interpolateShieldPoint(a, b, t) {
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t
    };
}

function clipShieldSegmentToMinZ(a, b, minZ = 0) {
    if (!a || !b) return null;
    const aAbove = Number.isFinite(a.z) && a.z >= minZ;
    const bAbove = Number.isFinite(b.z) && b.z >= minZ;
    if (aAbove && bAbove) {
        return {
            start: { x: a.x, y: a.y, z: a.z },
            end: { x: b.x, y: b.y, z: b.z }
        };
    }
    if (!aAbove && !bAbove) return null;
    const dz = b.z - a.z;
    if (Math.abs(dz) < 1e-6) return null;
    const t = (minZ - a.z) / dz;
    if (!Number.isFinite(t) || t < 0 || t > 1) return null;
    const intersection = interpolateShieldPoint(a, b, t);
    intersection.z = minZ;
    return aAbove
        ? { start: { x: a.x, y: a.y, z: a.z }, end: intersection }
        : { start: intersection, end: { x: b.x, y: b.y, z: b.z } };
}

function cloneShieldSegment(segment) {
    if (!segment || !segment.start || !segment.end) return null;
    return {
        start: { x: segment.start.x, y: segment.start.y, z: segment.start.z },
        end: { x: segment.end.x, y: segment.end.y, z: segment.end.z }
    };
}

function getWizardShieldOverlayContainer() {
    const layers = (typeof globalThis !== "undefined" && globalThis.Rendering && typeof globalThis.Rendering.getLayers === "function")
        ? globalThis.Rendering.getLayers()
        : null;
    return (layers && (layers.entities || layers.characters || layers.depthObjects))
        || characterLayer
        || null;
}

function normalizeWizardGameMode(mode) {
    const normalized = String(mode || "").trim().toLowerCase();
    return normalized === WIZARD_GAME_MODE_ADVENTURE
        ? WIZARD_GAME_MODE_ADVENTURE
        : WIZARD_GAME_MODE_GOD;
}

function normalizeWizardDifficulty(rawDifficulty, fallback = 2) {
    const parsed = Number(rawDifficulty);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(3, Math.round(parsed)));
}

function getWizardIncomingDamageMultiplier(rawDifficulty) {
    const difficulty = normalizeWizardDifficulty(rawDifficulty, 2);
    if (difficulty === 1) return 0.5;
    if (difficulty === 2) return 0.75;
    return 1;
}

function doesObjectBlockWizardMovement(obj) {
    if (typeof globalThis !== "undefined" && typeof globalThis.doesObjectBlockPassage === "function") {
        return globalThis.doesObjectBlockPassage(obj);
    }
    const sinkState = (obj && typeof obj === "object" && obj._scriptSinkState && typeof obj._scriptSinkState === "object")
        ? obj._scriptSinkState
        : null;
    return !!(obj && !obj.gone && obj.isPassable === false && (!sinkState || sinkState.nonBlocking === false));
}

if (typeof globalThis !== "undefined") {
    globalThis.WIZARD_GAME_MODE_GOD = WIZARD_GAME_MODE_GOD;
    globalThis.WIZARD_GAME_MODE_ADVENTURE = WIZARD_GAME_MODE_ADVENTURE;
    globalThis.normalizeWizardGameMode = normalizeWizardGameMode;
}

class Wizard extends Character {
    constructor(location, map) {
        super('human', location, 1, map);
        this.useAStarPathfinding = true;
        this.speed = 2.5;
        this.roadSpeedMultiplier = 1.3;
        this.backwardSpeedMultiplier = 0.667; // Configurable backward movement speed
        this.frameRate = 60;
        this.cooldownTime = 0; // configurable delay in seconds before casting
        this.food = 0;
        this.hp = 100;
        this.maxHp = 100;
        this.ensureMagicPointsInitialized(true);
        this.dead = false;
        this._adventureDeathAnimationActive = false;
        this._adventureDeathAnimationStartedAtMs = null;
        this._adventureDeathAnimationDurationMs = 4000;
        this.magic = 100;
        this.maxMagic = 100;
        this.gameMode = WIZARD_GAME_MODE_GOD;
        this._adventureRespawnPending = false;
        this.unlockedMagic = [];
        this.difficulty = 2;
        this.magicRegenPerSecond = 8 - this.difficulty;
        this.activeAura = null;
        this.activeAuras = [];
        this.shieldHp = 0;
        this.maxShieldHp = 0;
        this.shieldFlashUntilMs = 0;
        this.shieldDecayPerSecond = 7;
        this._lastShieldDecayMs = null;
        this.shieldBreakParticles = [];
        this.shieldBreakBurstSegments = [];
        this.shieldBreakBurstUntilMs = 0;
        this._shieldRenderedSegments = [];
        this._shieldRenderCenter = null;
        this.showEditorPanel = true;
        this.editorPlacementActive = false;
        this.selectedEditorCategory = "doors";
        this.name = 'you';
        this.groundRadius = 0.3;
        this.visualRadius = 0.5; // Hitbox radius in hex units
        this.occlusionRadius = 1.0; // Radius for occlusion checks in hex units
        this.animationSpeedMultiplier = 0.475; // Animation speed multiplier (1.0 = normal, 0.5 = half speed, 2.0 = double speed)
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
        this.shieldGraphics = new PIXI.Graphics();
        characterLayer.addChild(this.shieldGraphics);
        this.shieldDebrisGraphics = new PIXI.Graphics();
        characterLayer.addChild(this.shieldDebrisGraphics);
        this.shieldWireframeMesh = null;
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
    isAdventureMode() {
        return normalizeWizardGameMode(this.gameMode) === WIZARD_GAME_MODE_ADVENTURE;
    }
    isGodMode() {
        return !this.isAdventureMode();
    }
    setGameMode(mode) {
        this.gameMode = normalizeWizardGameMode(mode);
        if (!this.isAdventureMode()) {
            this._adventureRespawnPending = false;
            this.dead = false;
            this.clearAdventureDeathAnimation();
        }
        this.updateModeToggleUi();
        if (typeof SpellSystem !== "undefined" && SpellSystem && typeof SpellSystem.syncWizardUnlockState === "function") {
            SpellSystem.syncWizardUnlockState(this);
        }
        return this.gameMode;
    }
    toggleGameMode() {
        return this.setGameMode(this.isAdventureMode() ? WIZARD_GAME_MODE_GOD : WIZARD_GAME_MODE_ADVENTURE);
    }
    updateModeToggleUi() {
        if (typeof globalThis !== "undefined") {
            globalThis.currentWizardGameMode = this.gameMode;
        }
    }
    startAdventureDeathAnimation(durationMs = 4000) {
        const nowMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
        this._adventureDeathAnimationActive = true;
        this._adventureDeathAnimationStartedAtMs = nowMs;
        this._adventureDeathAnimationDurationMs = Number.isFinite(durationMs)
            ? Math.max(0, durationMs)
            : 4000;
        return nowMs;
    }
    clearAdventureDeathAnimation() {
        this._adventureDeathAnimationActive = false;
        this._adventureDeathAnimationStartedAtMs = null;
    }
    getAdventureDeathAnimationProgress(nowMs = null) {
        if (!this._adventureDeathAnimationActive) return 0;
        const durationMs = Number.isFinite(this._adventureDeathAnimationDurationMs)
            ? Math.max(0, this._adventureDeathAnimationDurationMs)
            : 4000;
        if (durationMs <= 0) return 1;
        const currentMs = Number.isFinite(nowMs)
            ? nowMs
            : ((typeof performance !== "undefined" && performance && typeof performance.now === "function")
                ? performance.now()
                : Date.now());
        const startMs = Number.isFinite(this._adventureDeathAnimationStartedAtMs)
            ? this._adventureDeathAnimationStartedAtMs
            : currentMs;
        return Math.max(0, Math.min(1, (currentMs - startMs) / durationMs));
    }
    isAdventureDeathAnimationActive(nowMs = null) {
        if (!this._adventureDeathAnimationActive) return false;
        return this.getAdventureDeathAnimationProgress(nowMs) < 1;
    }
    queueAdventureRespawn() {
        if (this._adventureRespawnPending) return true;
        const deathAnimationMs = 4000;
        this._adventureRespawnPending = true;
        this.hp = 0;
        this.dead = true;
        this.startAdventureDeathAnimation(deathAnimationMs);
        if (typeof pause === "function") {
            pause();
        }
        if (typeof message === "function") {
            message("You died. Reloading last save...");
        }
        setTimeout(() => {
            const reloadLastSave = (typeof globalThis !== "undefined" && typeof globalThis.reloadLastSaveFromCheckpoint === "function")
                ? globalThis.reloadLastSaveFromCheckpoint
                : null;
            const reloaded = reloadLastSave ? !!reloadLastSave() : false;
            if (reloaded) return;
            this._adventureRespawnPending = false;
            this.dead = false;
            this.clearAdventureDeathAnimation();
            if (typeof unpause === "function") {
                unpause();
            }
            if (typeof msgBox === "function") {
                msgBox("No save to reload", "Adventure mode could not find a previous save to reload.");
            } else if (typeof message === "function") {
                message("Adventure mode could not find a previous save to reload.");
            }
        }, deathAnimationMs);
        return true;
    }
    updateAdventureDeathState() {
        if (!this.isAdventureMode()) {
            this._adventureRespawnPending = false;
            this.dead = false;
            this.clearAdventureDeathAnimation();
            return false;
        }
        if (!Number.isFinite(this.hp) || this.hp > 0) {
            this._adventureRespawnPending = false;
            this.dead = false;
            this.clearAdventureDeathAnimation();
            return false;
        }
        this.hp = 0;
        return this.queueAdventureRespawn();
    }
    startJump() {
        if (typeof this.isFrozen === "function" && this.isFrozen()) return;
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
        if (typeof this.isFrozen === "function" && this.isFrozen()) {
            this.z = Number.isFinite(this.jumpHeight) ? this.jumpHeight : Math.max(0, Number(this.z) || 0);
            return;
        }
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
        if (typeof this.isFrozen === "function" && this.isFrozen()) return;
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
        this.updateShieldDecay();
        super.move();
        centerViewport(this, 0);
    }

    updateShieldDecay(nowMs = null) {
        const shieldHp = Number.isFinite(this.shieldHp) ? Math.max(0, this.shieldHp) : 0;
        const maxShieldHp = Number.isFinite(this.maxShieldHp) ? Math.max(0, this.maxShieldHp) : 0;
        if (shieldHp <= 0 || maxShieldHp <= 0) {
            this._lastShieldDecayMs = null;
            return 0;
        }

        const decayPerSecond = Number.isFinite(this.shieldDecayPerSecond)
            ? Math.max(0, this.shieldDecayPerSecond)
            : 0;
        const currentMs = Number.isFinite(nowMs)
            ? nowMs
            : ((typeof performance !== "undefined" && performance && typeof performance.now === "function")
                ? performance.now()
                : Date.now());
        if (!Number.isFinite(this._lastShieldDecayMs)) {
            this._lastShieldDecayMs = currentMs;
            return 0;
        }
        const elapsedSec = Math.max(0, (currentMs - this._lastShieldDecayMs) / 1000);
        this._lastShieldDecayMs = currentMs;
        if (!(elapsedSec > 0) || !(decayPerSecond > 0)) {
            return 0;
        }

        const decayAmount = elapsedSec * decayPerSecond;
        const nextShieldHp = Math.max(0, shieldHp - decayAmount);
        const applied = shieldHp - nextShieldHp;
        this.shieldHp = nextShieldHp;
        if (this.shieldHp <= 0) {
            this.clearShieldSpell({ shattered: true });
        }
        if (applied > 0 && typeof this.updateStatusBars === "function") {
            this.updateStatusBars();
        }
        return applied;
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

    getVectorMovementEnvironmentSpeedMultiplier(_options = {}) {
        const activeAuras = Array.isArray(this.activeAuras)
            ? this.activeAuras
            : (typeof this.activeAura === "string" ? [this.activeAura] : []);
        const auraSpeedMultiplier = activeAuras.includes("speed") ? 2 : 1;
        const roadSpeedMultiplier = this.isOnRoad() ? this.roadSpeedMultiplier : 1;
        return auraSpeedMultiplier * roadSpeedMultiplier;
    }

    heal(amount) {
        const rawHeal = Number(amount);
        if (!Number.isFinite(rawHeal) || rawHeal <= 0) {
            return 0;
        }

        const finiteMaxHp = Number.isFinite(this.maxHp)
            ? Number(this.maxHp)
            : (Number.isFinite(this.maxHP) ? Number(this.maxHP) : null);
        const normalizedMaxHp = Number.isFinite(finiteMaxHp)
            ? Math.max(0, finiteMaxHp)
            : Math.max(0, Number.isFinite(this.hp) ? Number(this.hp) : 100);
        const currentHp = Number.isFinite(this.hp) ? Number(this.hp) : normalizedMaxHp;
        const nextHp = Math.max(0, Math.min(normalizedMaxHp, currentHp + rawHeal));
        const applied = Math.max(0, nextHp - currentHp);

        this.maxHp = normalizedMaxHp;
        this.maxHP = normalizedMaxHp;
        this.hp = nextHp;
        if (typeof this.updateStatusBars === "function") {
            this.updateStatusBars();
        }
        return applied;
    }

    takeDamage(amount, _options = null) {
        const rawDamage = Number(amount);
        if (!Number.isFinite(rawDamage) || rawDamage <= 0) {
            return 0;
        }
        const damageMultiplier = getWizardIncomingDamageMultiplier(this.difficulty);
        const scaledDamage = rawDamage * damageMultiplier;

        if (!Number.isFinite(this.hp)) {
            this.hp = Number.isFinite(this.maxHp) ? this.maxHp : 0;
        }
        if (!Number.isFinite(this.magic)) {
            this.magic = 0;
        }
        if (!Number.isFinite(this.shieldHp)) {
            this.shieldHp = 0;
        }
        if (!Number.isFinite(this.maxShieldHp)) {
            this.maxShieldHp = Math.max(0, Number(this.shieldHp) || 0);
        }

        if (this.shieldHp > 0) {
            this.shieldFlashUntilMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                ? performance.now() + 150
                : Date.now() + 150;
        }

        let remainingDamage = scaledDamage;
        if (this.shieldHp > 0) {
            const absorbedByShield = Math.min(this.shieldHp, remainingDamage);
            this.shieldHp = Math.max(0, this.shieldHp - absorbedByShield);
            remainingDamage -= absorbedByShield;
            if (this.shieldHp <= 0) {
                this.clearShieldSpell({ shattered: true });
            }
        }

        if (remainingDamage <= 0) {
            if (typeof this.updateStatusBars === "function") {
                this.updateStatusBars();
            }
            return 0;
        }

        const prevHp = this.hp;
        this.hp = Math.max(0, this.hp - remainingDamage);
        const applied = Math.max(0, prevHp - this.hp);
        if (typeof this.updateStatusBars === "function") {
            this.updateStatusBars();
        }
        return applied;
    }

    hasShieldSpellActive() {
        return Number.isFinite(this.shieldHp) && this.shieldHp > 0;
    }

    applyShieldSpell(amount = 100) {
        const shieldAmount = Number(amount);
        const nextShield = Number.isFinite(shieldAmount) ? Math.max(0, shieldAmount) : 0;
        this.maxShieldHp = nextShield;
        this.shieldHp = nextShield;
        this._lastShieldDecayMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
        this._shieldRenderedSegments = [];
        this._shieldRenderCenter = null;
        if (typeof this.updateStatusBars === "function") {
            this.updateStatusBars();
        }
        return this.shieldHp;
    }

    clearShieldSpell(options = {}) {
        if (options && options.shattered) {
            this.spawnShieldBreakParticles();
        }
        this.shieldHp = 0;
        this.maxShieldHp = 0;
        this.shieldFlashUntilMs = 0;
        this._lastShieldDecayMs = null;
        if (this.shieldGraphics) {
            this.shieldGraphics.clear();
            this.shieldGraphics.visible = false;
        }
        if (this.shieldWireframeMesh) {
            this.shieldWireframeMesh.visible = false;
            if (Object.prototype.hasOwnProperty.call(this.shieldWireframeMesh, "renderable")) {
                this.shieldWireframeMesh.renderable = false;
            }
        }
        return 0;
    }

    spawnShieldBreakParticles() {
        const sourceSegments = Array.isArray(this._shieldRenderedSegments)
            ? this._shieldRenderedSegments.map(cloneShieldSegment).filter(Boolean)
            : [];
        if (sourceSegments.length === 0) {
            return [];
        }

        const nowMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
        this.shieldBreakBurstSegments = sourceSegments.map(cloneShieldSegment).filter(Boolean);
        this.shieldBreakBurstUntilMs = nowMs + 150;
        const center = this._shieldRenderCenter && Number.isFinite(this._shieldRenderCenter.x) && Number.isFinite(this._shieldRenderCenter.y)
            ? this._shieldRenderCenter
            : { x: this.x, y: this.y, z: Math.max(0, Number(this.z) || 0) + 0.95 };
        const particles = sourceSegments.map((segment, index) => {
            const midpoint = {
                x: (segment.start.x + segment.end.x) * 0.5,
                y: (segment.start.y + segment.end.y) * 0.5,
                z: (segment.start.z + segment.end.z) * 0.5
            };
            const halfVector = {
                x: (segment.end.x - segment.start.x) * 0.5,
                y: (segment.end.y - segment.start.y) * 0.5,
                z: (segment.end.z - segment.start.z) * 0.5
            };
            let dx = midpoint.x - center.x;
            let dy = midpoint.y - center.y;
            let dz = (midpoint.z - center.z) + 0.15;
            let length = Math.hypot(dx, dy, dz);
            if (!(length > 1e-6)) {
                const theta = (index / Math.max(1, sourceSegments.length)) * Math.PI * 2;
                dx = Math.cos(theta);
                dy = Math.sin(theta);
                dz = 0.25;
                length = Math.hypot(dx, dy, dz);
            }

            return {
                spawnMs: nowMs,
                durationMs: 750,
                origin: midpoint,
                velocity: {
                    x: dx / length,
                    y: dy / length,
                    z: dz / length
                },
                halfVector,
                yaw0: 0,
                pitch0: 0,
                roll0: 0,
                yawSpeed: (Math.random() - 0.5) * 4,
                pitchSpeed: (Math.random() - 0.5) * 4,
                rollSpeed: (Math.random() - 0.5) * 4
            };
        });

        this.shieldBreakParticles = (Array.isArray(this.shieldBreakParticles) ? this.shieldBreakParticles : []).concat(particles);
        return particles;
    }

    drawShieldBreakBurst(nowMs) {
        if (!this.shieldGraphics) return false;
        const overlayContainer = getWizardShieldOverlayContainer();
        if (!overlayContainer) return false;
        const burstUntilMs = Number.isFinite(this.shieldBreakBurstUntilMs) ? this.shieldBreakBurstUntilMs : 0;
        const burstSegments = Array.isArray(this.shieldBreakBurstSegments) ? this.shieldBreakBurstSegments : [];
        if (burstUntilMs <= nowMs || burstSegments.length === 0) {
            this.shieldBreakBurstSegments = [];
            this.shieldBreakBurstUntilMs = 0;
            return false;
        }

        if (this.shieldGraphics.parent !== overlayContainer) {
            overlayContainer.addChild(this.shieldGraphics);
        }
        const screenScale = Math.max(1e-6, Number(viewscale) || 1);
        const screenRatio = Math.max(1e-6, Number(xyratio) || 1);
        const fade = Math.max(0, Math.min(1, (burstUntilMs - nowMs) / 150));
        this.shieldGraphics.clear();
        this.shieldGraphics.visible = true;
        this.shieldGraphics.lineStyle(Math.max(2.5, screenScale * 0.03), 0xFFFFFF, 0.95 * fade);
        for (let i = 0; i < burstSegments.length; i++) {
            const seg = burstSegments[i];
            if (!seg || !seg.start || !seg.end) continue;
            const screenA = worldToScreen({ x: seg.start.x, y: seg.start.y });
            const screenB = worldToScreen({ x: seg.end.x, y: seg.end.y });
            this.shieldGraphics.moveTo(screenA.x, screenA.y - (seg.start.z * screenScale * screenRatio));
            this.shieldGraphics.lineTo(screenB.x, screenB.y - (seg.end.z * screenScale * screenRatio));
        }
        if (overlayContainer.children.indexOf(this.shieldGraphics) !== overlayContainer.children.length - 1) {
            overlayContainer.setChildIndex(this.shieldGraphics, overlayContainer.children.length - 1);
        }
        return true;
    }

    drawShieldBreakParticles(nowMs) {
        if (!this.shieldDebrisGraphics) return false;
        const overlayContainer = getWizardShieldOverlayContainer();
        if (!overlayContainer) return false;
        const particles = Array.isArray(this.shieldBreakParticles) ? this.shieldBreakParticles : [];
        this.shieldDebrisGraphics.clear();
        if (particles.length === 0) {
            this.shieldDebrisGraphics.visible = false;
            this.shieldBreakParticles = [];
            return false;
        }

        const screenScale = Math.max(1e-6, Number(viewscale) || 1);
        const screenRatio = Math.max(1e-6, Number(xyratio) || 1);
        const activeParticles = [];

        for (let i = 0; i < particles.length; i++) {
            const particle = particles[i];
            if (!particle) continue;

            const ageMs = nowMs - particle.spawnMs;
            if (!(ageMs >= 0) || ageMs >= particle.durationMs) continue;

            const ageSec = ageMs / 1000;
            const fade = 1 - Math.max(0, Math.min(1, ageMs / particle.durationMs));
            const midpoint = {
                x: particle.origin.x + particle.velocity.x * ageSec,
                y: particle.origin.y + particle.velocity.y * ageSec,
                z: Math.max(0, particle.origin.z + particle.velocity.z * ageSec)
            };
            const rotatedHalf = rotateShieldModelVertex(
                particle.halfVector,
                particle.yaw0 + particle.yawSpeed * ageSec,
                particle.pitch0 + particle.pitchSpeed * ageSec,
                particle.roll0 + particle.rollSpeed * ageSec
            );
            const clipped = clipShieldSegmentToMinZ(
                {
                    x: midpoint.x - rotatedHalf.x,
                    y: midpoint.y - rotatedHalf.y,
                    z: midpoint.z - rotatedHalf.z
                },
                {
                    x: midpoint.x + rotatedHalf.x,
                    y: midpoint.y + rotatedHalf.y,
                    z: midpoint.z + rotatedHalf.z
                },
                0
            );
            if (!clipped) continue;

            const screenA = worldToScreen({ x: clipped.start.x, y: clipped.start.y });
            const screenB = worldToScreen({ x: clipped.end.x, y: clipped.end.y });
            this.shieldDebrisGraphics.lineStyle(Math.max(1.25, screenScale * 0.018 * fade), 0xFFFFFF, 0.9 * fade);
            this.shieldDebrisGraphics.moveTo(screenA.x, screenA.y - (clipped.start.z * screenScale * screenRatio));
            this.shieldDebrisGraphics.lineTo(screenB.x, screenB.y - (clipped.end.z * screenScale * screenRatio));
            activeParticles.push(particle);
        }

        this.shieldBreakParticles = activeParticles;
        this.shieldDebrisGraphics.visible = activeParticles.length > 0;
        if (activeParticles.length > 0 && this.shieldDebrisGraphics.parent !== overlayContainer) {
            overlayContainer.addChild(this.shieldDebrisGraphics);
        }
        if (activeParticles.length > 0 && overlayContainer.children.indexOf(this.shieldDebrisGraphics) !== overlayContainer.children.length - 1) {
            overlayContainer.setChildIndex(this.shieldDebrisGraphics, overlayContainer.children.length - 1);
        }
        return activeParticles.length > 0;
    }

    doesObjectBlockVectorMovement(obj, options = {}) {
        if (!obj || obj === this || obj.gone || !obj.groundPlaneHitbox) return false;
        if (!doesObjectBlockWizardMovement(obj)) return false;

        const wizardZ = Number.isFinite(this.z) ? Number(this.z) : 0;
        if (wizardZ > 0) {
            const objBottomZ = Number.isFinite(obj.bottomZ) ? Number(obj.bottomZ) : 0;
            const objHeight = Number.isFinite(obj.height) ? Number(obj.height) : 0;
            const objTopZ = objBottomZ + objHeight;
            if (objTopZ > 0 && wizardZ >= objTopZ) {
                return false;
            }
        }

        return super.doesObjectBlockVectorMovement(obj, options);
    }

    prepareVectorMovementContext(newX, newY, radius, options = {}) {
        const scriptingApi = (typeof Scripting !== "undefined" && Scripting)
            ? Scripting
            : ((typeof globalThis !== "undefined" && globalThis.Scripting) ? globalThis.Scripting : null);
        const isDoorPlacedObjectFn = (scriptingApi && typeof scriptingApi.isDoorPlacedObject === "function")
            ? scriptingApi.isDoorPlacedObject
            : null;
        const isDoorLockedFn = (scriptingApi && typeof scriptingApi.isDoorLocked === "function")
            ? scriptingApi.isDoorLocked
            : null;
        const isPointInDoorHitboxFn = (scriptingApi && typeof scriptingApi.isPointInDoorHitbox === "function")
            ? scriptingApi.isPointInDoorHitbox
            : null;

        const nearbyObjects = Array.isArray(this._movementNearbyObjects) ? this._movementNearbyObjects : [];
        nearbyObjects.length = 0;
        this._movementNearbyObjects = nearbyObjects;

        const nearbyDoors = Array.isArray(this._movementNearbyDoors) ? this._movementNearbyDoors : [];
        nearbyDoors.length = 0;
        this._movementNearbyDoors = nearbyDoors;

        const forceTouchedObjects = (this._movementForceTouchedObjects instanceof Set)
            ? this._movementForceTouchedObjects
            : new Set();
        forceTouchedObjects.clear();
        this._movementForceTouchedObjects = forceTouchedObjects;

        const padding = this.getVectorMovementSearchPadding(radius, options);
        const searchNodes = this.getVectorMovementSearchNodes(newX, newY, padding);
        if (searchNodes.length > 0) {
            const xIndices = searchNodes.map(node => Number(node.xindex));
            const yIndices = searchNodes.map(node => Number(node.yindex));
            const minXIndex = Math.min(...xIndices);
            const maxXIndex = Math.max(...xIndices);
            const minYIndex = Math.min(...yIndices);
            const maxYIndex = Math.max(...yIndices);
            const collectFromNode = (node) => {
                if (!node || !Array.isArray(node.objects)) return;
                const nodeObjects = node.objects;
                for (let i = 0; i < nodeObjects.length; i++) {
                    const obj = nodeObjects[i];
                    if (!obj || obj.gone) continue;
                    const doorCandidate = !!(isDoorPlacedObjectFn && isDoorPlacedObjectFn(obj));
                    if (doorCandidate) {
                        const doorHitbox = obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox;
                        if (doorHitbox && (typeof doorHitbox.containsPoint === "function" || typeof doorHitbox.intersects === "function")) {
                            const locked = isDoorLockedFn ? !!isDoorLockedFn(obj) : (obj.isPassable === false);
                            nearbyDoors.push({ obj, hitbox: doorHitbox, canTraverse: !locked });
                        }
                    }
                    if (this.doesObjectBlockVectorMovement(obj, options)) {
                        nearbyObjects.push(obj);
                    }
                }
            };

            if (typeof this.map.getNodesInIndexWindow === "function") {
                const xStart = minXIndex - 1;
                const xEnd = maxXIndex + 1;
                const yStart = minYIndex - 1;
                const yEnd = maxYIndex + 1;
                const nearbyNodes = this.map.getNodesInIndexWindow(xStart, xEnd, yStart, yEnd);
                for (let i = 0; i < nearbyNodes.length; i++) {
                    collectFromNode(nearbyNodes[i]);
                }
            } else {
                const xStart = Math.max(minXIndex - 1, 0);
                const xEnd = Math.min(maxXIndex + 1, Math.max(0, (this.map.width || 0) - 1));
                const yStart = Math.max(minYIndex - 1, 0);
                const yEnd = Math.min(maxYIndex + 1, Math.max(0, (this.map.height || 0) - 1));

                for (let x = xStart; x <= xEnd; x++) {
                    for (let y = yStart; y <= yEnd; y++) {
                        if (!this.map.nodes[x] || !this.map.nodes[x][y]) continue;
                        collectFromNode(this.map.nodes[x][y]);
                    }
                }
            }
        }

        return {
            nearbyObjects,
            nearbyCharacters: options.includeCharacterBlockers === true
                ? this.collectNearbyBlockingCharacters(newX, newY, radius, options)
                : [],
            nearbyDoors,
            forceTouchedObjects,
            isPointInDoorHitboxFn
        };
    }

    canBypassVectorMovementCollisions(currentX, currentY, newX, newY, radius, context, _options = {}) {
        const nearbyDoors = Array.isArray(context?.nearbyDoors) ? context.nearbyDoors : [];
        const nearbyObjects = Array.isArray(context?.nearbyObjects) ? context.nearbyObjects : [];
        const isPointInDoorHitboxFn = context?.isPointInDoorHitboxFn;
        if (typeof isPointInDoorHitboxFn !== "function" || nearbyDoors.length === 0) {
            return false;
        }

        const hasDoorSpanClearance = (entry, px, py, doorRadius = 0) => {
            if (!entry || !entry.hitbox) return false;
            const hitbox = entry.hitbox;
            const resolvedRadius = Math.max(0, Number(doorRadius) || 0);
            const points = Array.isArray(hitbox.points) ? hitbox.points : null;
            const widthHint = Number.isFinite(entry.obj?.width) ? Math.max(0, Number(entry.obj.width)) : null;
            if (!(resolvedRadius > 0) || !points || points.length !== 4 || !(widthHint > 0)) {
                return true;
            }

            const edgeA = {
                dx: Number(points[1].x) - Number(points[0].x),
                dy: Number(points[1].y) - Number(points[0].y)
            };
            const edgeB = {
                dx: Number(points[2].x) - Number(points[1].x),
                dy: Number(points[2].y) - Number(points[1].y)
            };
            const lenA = Math.hypot(edgeA.dx, edgeA.dy);
            const lenB = Math.hypot(edgeB.dx, edgeB.dy);
            const useEdgeA = Math.abs(lenA - widthHint) <= Math.abs(lenB - widthHint);
            const widthLen = useEdgeA ? lenA : lenB;
            if (!(widthLen > 1e-6)) {
                return true;
            }

            const axisDx = useEdgeA ? edgeA.dx : edgeB.dx;
            const axisDy = useEdgeA ? edgeA.dy : edgeB.dy;
            const axisX = axisDx / widthLen;
            const axisY = axisDy / widthLen;
            const centerX = (Number(points[0].x) + Number(points[1].x) + Number(points[2].x) + Number(points[3].x)) * 0.25;
            const centerY = (Number(points[0].y) + Number(points[1].y) + Number(points[2].y) + Number(points[3].y)) * 0.25;
            const projectedSpan = Math.abs((px - centerX) * axisX + (py - centerY) * axisY);
            const halfSpan = widthLen * 0.5;
            const insetClearance = Math.max(0, halfSpan - resolvedRadius);
            const minimumViableCenterCorridor = Math.min(halfSpan, resolvedRadius * 0.5);
            return projectedSpan <= Math.max(insetClearance, minimumViableCenterCorridor) + 1e-6;
        };

        const findTraversableDoorAtPoint = (px, py, doorRadius = 0, requireSpanClearance = false) => {
            for (let i = 0; i < nearbyDoors.length; i++) {
                const entry = nearbyDoors[i];
                if (!entry || !entry.canTraverse) continue;
                if (!isPointInDoorHitboxFn(entry.hitbox, px, py, doorRadius)) continue;
                if (requireSpanClearance && !hasDoorSpanClearance(entry, px, py, doorRadius)) continue;
                return entry;
            }
            return null;
        };

        const currentDoor = findTraversableDoorAtPoint(currentX, currentY, radius);
        const nextDoor = findTraversableDoorAtPoint(newX, newY, radius);
        const currentDoorWithClearance = findTraversableDoorAtPoint(currentX, currentY, radius, true);
        const nextDoorWithClearance = findTraversableDoorAtPoint(newX, newY, radius, true);
        if (!currentDoor && !nextDoor) {
            return false;
        }

        if (nextDoorWithClearance) {
            return true;
        }

        const candidateHitbox = { type: "circle", x: newX, y: newY, radius: Math.max(0, Number(radius) || 0) };
        for (let i = 0; i < nearbyObjects.length; i++) {
            const obj = nearbyObjects[i];
            if (!obj || !obj.groundPlaneHitbox || typeof obj.groundPlaneHitbox.intersects !== "function") continue;
            const collision = obj.groundPlaneHitbox.intersects(candidateHitbox);
            if (collision && collision.pushX !== undefined) {
                return false;
            }
        }

        return !!currentDoorWithClearance;
    }

    onVectorMovementApplied(movementResult, _options = {}) {
        applyViewportWrapShift(
            movementResult.wrappedX - movementResult.targetX,
            movementResult.wrappedY - movementResult.targetY
        );
        centerViewport(this, 0);
    }
    
    moveDirection(vector, options = {}) {
        return super.moveDirection(vector, options);
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

    drawShield(interpolatedJumpHeight = null, interpolatedWorldPosition = null) {
        const nowMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
        const drewBreakBurst = this.drawShieldBreakBurst(nowMs);
        this.drawShieldBreakParticles(nowMs);

        const shieldHp = Number.isFinite(this.shieldHp) ? Math.max(0, this.shieldHp) : 0;
        const maxShieldHp = Number.isFinite(this.maxShieldHp) ? Math.max(0, this.maxShieldHp) : 0;
        if (shieldHp <= 0 || maxShieldHp <= 0) {
            if (this.shieldGraphics && !drewBreakBurst) {
                this.shieldGraphics.clear();
                this.shieldGraphics.visible = false;
            }
            if (this.shieldWireframeMesh) {
                this.shieldWireframeMesh.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.shieldWireframeMesh, "renderable")) {
                    this.shieldWireframeMesh.renderable = false;
                }
            }
            return;
        }

        if (this.shieldGraphics) {
            this.shieldGraphics.clear();
            this.shieldGraphics.visible = false;
        }

        const layers = (typeof globalThis !== "undefined" && globalThis.Rendering && typeof globalThis.Rendering.getLayers === "function")
            ? globalThis.Rendering.getLayers()
            : null;
        const shieldContainer = layers && layers.objects3d ? layers.objects3d : null;
        if (!shieldContainer || typeof PIXI === "undefined" || !PIXI.Geometry || !PIXI.Shader || !PIXI.Mesh) {
            if (this.shieldWireframeMesh) {
                this.shieldWireframeMesh.visible = false;
            }
            return;
        }

        const renderWorld = interpolatedWorldPosition || this.getInterpolatedPosition();
        const shieldRatio = Math.max(0, Math.min(1, shieldHp / maxShieldHp));
        const state = ensureWizardShieldWireframeState();
        if (!state) return;
        const flashActive = Number.isFinite(this.shieldFlashUntilMs) && this.shieldFlashUntilMs > nowMs;

        if (!this.shieldWireframeMesh || this.shieldWireframeMesh.destroyed) {
            const geometry = new PIXI.Geometry()
                .addAttribute("aWorldPosition", new Float32Array(0), 3)
                .addIndex(new Uint16Array(0));
            const shader = PIXI.Shader.from(WIZARD_SHIELD_WIREFRAME_VS, WIZARD_SHIELD_WIREFRAME_FS, {
                uScreenSize: new Float32Array([1, 1]),
                uScreenJitter: new Float32Array([0, 0]),
                uCameraWorld: new Float32Array([0, 0]),
                uViewScale: 1,
                uXyRatio: 1,
                uDepthRange: new Float32Array([0, 1]),
                uWorldSize: new Float32Array([0, 0]),
                uWrapEnabled: new Float32Array([0, 0]),
                uWrapAnchorWorld: new Float32Array([0, 0]),
                uZOffset: 0.5,
                uColor: new Float32Array([0.63, 0.9, 1.0, 0.72])
            });
            this.shieldWireframeMesh = new PIXI.Mesh(geometry, shader, state, PIXI.DRAW_MODES.TRIANGLES);
            this.shieldWireframeMesh.name = "wizardShieldWireframeMesh";
            this.shieldWireframeMesh.interactive = false;
            this.shieldWireframeMesh.roundPixels = false;
            this.shieldWireframeMesh.visible = false;
        }

        if (this.shieldWireframeMesh.parent !== shieldContainer) {
            shieldContainer.addChild(this.shieldWireframeMesh);
        }

        const cameraX = Number.isFinite(viewport && viewport.x) ? Number(viewport.x) : Number(renderWorld.x) || 0;
        const cameraY = Number.isFinite(viewport && viewport.y) ? Number(viewport.y) : Number(renderWorld.y) || 0;
        const scale = Math.max(0.65, Number(this.visualRadius) || 0.5) * 0.95;
        const centerZ = 0.45 + ((Number.isFinite(interpolatedJumpHeight) ? interpolatedJumpHeight : (Number(renderWorld.z) || 0)) * 0.55);
        const edgeThicknessPx = Math.max(1.25, (Number(viewscale) || 1) * 0.016);
        const model = getWizardShieldDodecahedronModel();
        const animationTime = (Number.isFinite(renderNowMs) ? Number(renderNowMs) : performance.now()) / 1000;
        const yawRad = animationTime * 0.55;
        const pitchRad = 0.42 + (Math.sin(animationTime * 0.8) * 0.08);
        const rollRad = animationTime * 0.275;
        const transformedVertices = model.vertices.map(vertex => {
            const rotated = rotateShieldModelVertex(vertex, yawRad, pitchRad, rollRad);
            return {
                x: renderWorld.x + rotated.x * scale,
                y: renderWorld.y + rotated.y * scale,
                z: centerZ + rotated.z * scale
            };
        });
        this._shieldRenderCenter = { x: renderWorld.x, y: renderWorld.y, z: centerZ };

        const screenScale = Math.max(1e-6, Number(viewscale) || 1);
        const screenYScale = Math.max(1e-6, screenScale * (Number(xyratio) || 1));
        const positionsList = [];
        const indexList = [];
        const fullOverlaySegments = [];
        const overlaySegments = [];
        const dashedMode = shieldRatio < 0.92;
        const dashCount = dashedMode ? (4 + Math.floor((1 - shieldRatio) * 10)) : 1;
        const dutyCycle = dashedMode ? Math.max(0.25, shieldRatio * 0.9) : 1;
        let quadIndex = 0;

        for (let edgeIndex = 0; edgeIndex < model.edges.length; edgeIndex++) {
            const [startIndex, endIndex] = model.edges[edgeIndex];
            const edgeStart = transformedVertices[startIndex];
            const edgeEnd = transformedVertices[endIndex];
            const fullClipped = clipShieldSegmentToMinZ(edgeStart, edgeEnd, 0);
            if (fullClipped) {
                fullOverlaySegments.push({ start: fullClipped.start, end: fullClipped.end });
            }
            for (let dashIndex = 0; dashIndex < dashCount; dashIndex++) {
                const cycleStartT = dashIndex / dashCount;
                const cycleEndT = (dashIndex + 1) / dashCount;
                const segmentEndT = Math.min(1, cycleStartT + ((cycleEndT - cycleStartT) * dutyCycle));
                if (segmentEndT <= cycleStartT + 1e-4) continue;
                const rawA = interpolateShieldPoint(edgeStart, edgeEnd, cycleStartT);
                const rawB = interpolateShieldPoint(edgeStart, edgeEnd, segmentEndT);
                const clipped = clipShieldSegmentToMinZ(rawA, rawB, 0);
                if (!clipped) continue;
                const a = clipped.start;
                const b = clipped.end;
                overlaySegments.push({ start: a, end: b });

                const sx = (b.x - a.x) * screenScale;
                const sy = ((b.y - a.y) - (b.z - a.z)) * (Number(xyratio) || 1) * screenScale;
                const screenLen = Math.hypot(sx, sy);
                let nx = 0;
                let ny = -1;
                if (screenLen > 1e-6) {
                    nx = -sy / screenLen;
                    ny = sx / screenLen;
                }
                const halfThickness = edgeThicknessPx * 0.5;
                const offset = {
                    x: (nx * halfThickness) / screenScale,
                    y: (ny * halfThickness) / (2 * screenYScale),
                    z: (-ny * halfThickness) / (2 * screenYScale)
                };

                positionsList.push(
                    a.x + offset.x, a.y + offset.y, a.z + offset.z,
                    a.x - offset.x, a.y - offset.y, a.z - offset.z,
                    b.x - offset.x, b.y - offset.y, b.z - offset.z,
                    b.x + offset.x, b.y + offset.y, b.z + offset.z
                );
                const baseIndex = quadIndex * 4;
                indexList.push(
                    baseIndex + 0,
                    baseIndex + 1,
                    baseIndex + 2,
                    baseIndex + 0,
                    baseIndex + 2,
                    baseIndex + 3
                );
                quadIndex += 1;
            }
        }

        const worldPositions = new Float32Array(positionsList);
        const indices = new Uint16Array(indexList);

        const geometry = this.shieldWireframeMesh.geometry;
        const positionBuffer = geometry.getBuffer("aWorldPosition");
        const indexBuffer = geometry.getIndex();
        if (!positionBuffer || !indexBuffer) return;
        positionBuffer.data = worldPositions;
        indexBuffer.data = indices;
        positionBuffer.update();
        indexBuffer.update();

        const uniforms = this.shieldWireframeMesh.shader.uniforms;
        const screenSize = getWizardShieldRenderScreenSize();
        const mapRef = this.map || (typeof map !== "undefined" ? map : null);
        const worldW = Math.max(0, Number(mapRef && mapRef.width) || 0);
        const worldH = Math.max(0, Number(mapRef && mapRef.height) || 0);
        const wrapX = (mapRef && mapRef.loopX) ? 1 : 0;
        const wrapY = (mapRef && mapRef.loopY) ? 1 : 0;
        uniforms.uScreenSize[0] = screenSize.width;
        uniforms.uScreenSize[1] = screenSize.height;
        uniforms.uScreenJitter[0] = 0;
        uniforms.uScreenJitter[1] = 0;
        uniforms.uCameraWorld[0] = cameraX;
        uniforms.uCameraWorld[1] = cameraY;
        uniforms.uViewScale = screenScale;
        uniforms.uXyRatio = Math.max(1e-6, Number(xyratio) || 1);
        uniforms.uDepthRange[0] = WIZARD_SHIELD_DEPTH_FAR_METRIC;
        uniforms.uDepthRange[1] = 1 / Math.max(1e-6, WIZARD_SHIELD_DEPTH_FAR_METRIC - WIZARD_SHIELD_DEPTH_NEAR_METRIC);
        uniforms.uWorldSize[0] = worldW;
        uniforms.uWorldSize[1] = worldH;
        uniforms.uWrapEnabled[0] = wrapX;
        uniforms.uWrapEnabled[1] = wrapY;
        uniforms.uWrapAnchorWorld[0] = Number(renderWorld.x) || 0;
        uniforms.uWrapAnchorWorld[1] = Number(renderWorld.y) || 0;
        uniforms.uZOffset = 0.5;
        if (flashActive) {
            uniforms.uColor[0] = 1.0;
            uniforms.uColor[1] = 1.0;
            uniforms.uColor[2] = 1.0;
            uniforms.uColor[3] = 0.95;
        } else {
            uniforms.uColor[0] = 0.58 + (0.12 * shieldRatio);
            uniforms.uColor[1] = 0.84 + (0.10 * shieldRatio);
            uniforms.uColor[2] = 1.0;
            uniforms.uColor[3] = 0.52 + (0.26 * shieldRatio);
        }

        this.shieldWireframeMesh.visible = indices.length > 0;
        if (Object.prototype.hasOwnProperty.call(this.shieldWireframeMesh, "renderable")) {
            this.shieldWireframeMesh.renderable = indices.length > 0;
        }
        this._shieldRenderedSegments = fullOverlaySegments.map(cloneShieldSegment).filter(Boolean);

        if (this.shieldGraphics) {
            const overlayContainer = getWizardShieldOverlayContainer();
            if (overlayContainer && this.shieldGraphics.parent !== overlayContainer) {
                overlayContainer.addChild(this.shieldGraphics);
            }
            this.shieldGraphics.clear();
            this.shieldGraphics.visible = overlaySegments.length > 0;
            const overlayLineWidth = Math.max(1.5, screenScale * 0.022);
            const overlayAlpha = flashActive ? 0.95 : (0.22 + (0.28 * shieldRatio));
            const overlayColor = flashActive ? 0xFFFFFF : 0x9BE7FF;
            this.shieldGraphics.lineStyle(overlayLineWidth, overlayColor, overlayAlpha);
            for (let edgeIndex = 0; edgeIndex < overlaySegments.length; edgeIndex++) {
                const seg = overlaySegments[edgeIndex];
                const screenA = worldToScreen({ x: seg.start.x, y: seg.start.y });
                const screenB = worldToScreen({ x: seg.end.x, y: seg.end.y });
                this.shieldGraphics.moveTo(screenA.x, screenA.y - (seg.start.z * screenScale * (Number(xyratio) || 1)));
                this.shieldGraphics.lineTo(screenB.x, screenB.y - (seg.end.z * screenScale * (Number(xyratio) || 1)));
            }
            if (overlayContainer && overlayContainer.children.indexOf(this.shieldGraphics) !== overlayContainer.children.length - 1) {
                overlayContainer.setChildIndex(this.shieldGraphics, overlayContainer.children.length - 1);
            }
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
        const safeMaxHp = Number.isFinite(this.maxHp) && this.maxHp > 0 ? this.maxHp : 1;
        const healthRatio = Math.max(0, Math.min(1, this.hp / safeMaxHp));
        $("#healthBar").css('width', (healthRatio * 100) + '%');
        
        // Update magic bar width
        const safeMaxMagic = Number.isFinite(this.maxMagic) && this.maxMagic > 0 ? this.maxMagic : 1;
        const magicRatio = Math.max(0, Math.min(1, this.magic / safeMaxMagic));
        $("#magicBar").css('width', (magicRatio * 100) + '%');
        this.updateModeToggleUi();
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

        this.drawShield(interpolatedJumpHeight, renderWorld);
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
            mp: this.mp,
            maxMp: this.maxMp,
            temperature: this.getTemperature(),
            baselineTemperature: this.getTemperatureBaseline(),
            gameMode: this.gameMode,
            name: this.name,
            difficulty: this.difficulty,
            magic: this.magic,
            maxMagic: this.maxMagic,
            magicRegenPerSecond: this.magicRegenPerSecond,
            shieldHp: this.shieldHp,
            maxShieldHp: this.maxShieldHp,
            food: this.food,
            currentSpell: this.currentSpell,
            activeAura: this.activeAura || null,
            activeAuras: Array.isArray(this.activeAuras) ? this.activeAuras.slice() : (this.activeAura ? [this.activeAura] : []),
            unlockedMagic: Array.isArray(this.unlockedMagic) ? this.unlockedMagic.slice() : [],
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
            selectedPowerupFileName: this.selectedPowerupFileName,
            selectedEditorCategory: this.selectedEditorCategory,
            selectedWallHeight: this.selectedWallHeight,
            selectedWallThickness: this.selectedWallThickness,
            selectedRoadWidth: this.selectedRoadWidth,
            selectedWallTexture: this.selectedWallTexture,
            selectedRoofOverhang: this.selectedRoofOverhang,
            selectedRoofPeakHeight: this.selectedRoofPeakHeight,
            selectedRoofTextureRepeat: this.selectedRoofTextureRepeat,
            showEditorPanel: this.showEditorPanel !== false,
            showPerfReadout: !!showPerfReadout,
            spells: this.spells,
            inventory: this.serializeInventory(),
            scriptingName: (typeof this.scriptingName === "string" && this.scriptingName.trim().length > 0)
                ? this.scriptingName.trim()
                : "",
            _scriptFrozenInfinite: Number(this._scriptFrozenUntilMs) === Infinity,
            _scriptFrozenRemainingMs: (
                Number.isFinite(Number(this._scriptFrozenUntilMs)) && Number(this._scriptFrozenUntilMs) > Date.now()
            )
                ? Math.max(1, Math.ceil(Number(this._scriptFrozenUntilMs) - Date.now()))
                : 0,
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
        this.ensureMagicPointsInitialized(true);
        if (data.mp !== undefined) this.mp = data.mp;
        if (data.maxMp !== undefined || data.maxMP !== undefined) {
            const nextMaxMp = data.maxMp !== undefined ? data.maxMp : data.maxMP;
            this.maxMp = nextMaxMp;
            this.maxMP = nextMaxMp;
        }
        this.ensureMagicPointsInitialized();
        if (typeof data.name === "string" && data.name.trim().length > 0) {
            this.name = data.name.trim();
        }
        if (data.baselineTemperature !== undefined) {
            this.baselineTemperature = Number.isFinite(data.baselineTemperature)
                ? Number(data.baselineTemperature)
                : this.getTemperatureBaseline();
        }
        if (data.temperature !== undefined && typeof this.setTemperature === "function") {
            this.setTemperature(data.temperature);
        }
        if (data._scriptFrozenInfinite === true) {
            this._scriptFrozenUntilMs = Infinity;
        } else if (Number.isFinite(data._scriptFrozenRemainingMs) && Number(data._scriptFrozenRemainingMs) > 0) {
            this._scriptFrozenUntilMs = Date.now() + Math.max(1, Number(data._scriptFrozenRemainingMs));
        } else {
            this._scriptFrozenUntilMs = 0;
        }
        if (typeof this.isFrozen === "function" && this.isFrozen()) {
            this.applyFrozenState({ clearMoveTimeout: true });
        }
        const nextGameMode = (data && data.gameMode !== undefined) ? data.gameMode : this.gameMode;
        this.setGameMode(nextGameMode);
        if (Number.isFinite(data.difficulty)) {
            this.setDifficulty(data.difficulty);
        }
        if (data.magic !== undefined) this.magic = data.magic;
        if (data.maxMagic !== undefined) this.maxMagic = data.maxMagic;
        if (!Number.isFinite(data.difficulty) && Number.isFinite(data.magicRegenPerSecond)) this.magicRegenPerSecond = Math.max(0, data.magicRegenPerSecond);
        if (data.shieldHp !== undefined) this.shieldHp = Math.max(0, Number(data.shieldHp) || 0);
        if (data.maxShieldHp !== undefined) {
            this.maxShieldHp = Math.max(0, Number(data.maxShieldHp) || 0);
        } else if (this.shieldHp > 0) {
            this.maxShieldHp = Math.max(this.shieldHp, 100);
        }
        this._lastShieldDecayMs = this.shieldHp > 0
            ? ((typeof performance !== "undefined" && performance && typeof performance.now === "function")
                ? performance.now()
                : Date.now())
            : null;
        if (data.food !== undefined) this.food = data.food;
        if (data.currentSpell !== undefined) this.currentSpell = data.currentSpell;
        if (typeof data.scriptingName === "string") {
            const scriptingApi = (typeof globalThis !== "undefined" && globalThis.Scripting)
                ? globalThis.Scripting
                : null;
            const restoredName = data.scriptingName.trim();
            if (scriptingApi && typeof scriptingApi.setObjectScriptingName === "function") {
                    scriptingApi.setObjectScriptingName(this, restoredName, { map: this.map, restoreFromSave: true });
            } else {
                this.scriptingName = restoredName;
            }
        }
        if (Array.isArray(data.activeAuras)) {
            this.activeAuras = data.activeAuras.slice();
            this.activeAura = this.activeAuras.length > 0 ? this.activeAuras[0] : null;
        } else if (data.activeAura !== undefined) {
            this.activeAura = data.activeAura;
            this.activeAuras = (typeof data.activeAura === "string" && data.activeAura.length > 0) ? [data.activeAura] : [];
        }
        this.unlockedMagic = Array.isArray(data.unlockedMagic) ? data.unlockedMagic.slice() : [];
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
        if (data.selectedPowerupFileName !== undefined) this.selectedPowerupFileName = data.selectedPowerupFileName;
        if (data.selectedEditorCategory !== undefined) this.selectedEditorCategory = data.selectedEditorCategory;
        if (data.selectedWallHeight !== undefined) this.selectedWallHeight = data.selectedWallHeight;
        if (data.selectedWallThickness !== undefined) this.selectedWallThickness = data.selectedWallThickness;
        if (data.selectedRoadWidth !== undefined) this.selectedRoadWidth = data.selectedRoadWidth;
        if (data.selectedWallTexture !== undefined) this.selectedWallTexture = data.selectedWallTexture;
        if (data.selectedRoofOverhang !== undefined) this.selectedRoofOverhang = data.selectedRoofOverhang;
        if (data.selectedRoofPeakHeight !== undefined) this.selectedRoofPeakHeight = data.selectedRoofPeakHeight;
        if (data.selectedRoofTextureRepeat !== undefined) this.selectedRoofTextureRepeat = data.selectedRoofTextureRepeat;
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
        if (Object.prototype.hasOwnProperty.call(data, "inventory")) {
            this.loadInventory(data.inventory);
        }
        if (this.map && typeof this.map.wrapWorldX === "function" && Number.isFinite(this.x)) {
            this.x = this.map.wrapWorldX(this.x);
        }
        if (this.map && typeof this.map.wrapWorldY === "function" && Number.isFinite(this.y)) {
            this.y = this.map.wrapWorldY(this.y);
        }
        this._doorTraversalStateById = new Map();
        this._triggerAreaTraversalStateById = new Map();
        this._scriptTouchedObjectsById = new Map();
        this._scriptPrevX = Number(this.x);
        this._scriptPrevY = Number(this.y);

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
        if (typeof SpellSystem !== "undefined" && typeof SpellSystem.syncWizardUnlockState === "function") {
            SpellSystem.syncWizardUnlockState(this);
        }
        if (typeof SpellSystem !== "undefined" && typeof SpellSystem.refreshAuraSelector === "function") {
            SpellSystem.refreshAuraSelector(this);
        }
    }

    setDifficulty(rawDifficulty) {
        this.difficulty = normalizeWizardDifficulty(rawDifficulty, this.difficulty);
        this.magicRegenPerSecond = Math.max(0, 8 - this.difficulty);
        return this.difficulty;
    }
}
