const mapWidth = 400;
const mapHeight = 400;
let frameRate = 60;
let frameCount = 0;
let renderNowMs = 0;
const renderMaxFps = 0; // 0 = uncapped (vsync-limited)
const debugRenderMaxFps = 0; // keep debug uncapped to avoid hidden global frame caps
const wizardDirectionRowOffset = 0; // 0 when row 0 faces left. Adjust to align sprite sheet rows.
let debugMode = false; // Toggle all debug graphics (hitboxes, grid, animal markers)
let showHexGrid = false; // Toggle hex grid only (g key)
let showBlockedNeighbors = false; // Toggle display of blocked neighbor connections

let viewport = {width: 0, height: 0, innerWindow: {width: 0, height: 0}, x: 488, y: 494}
let previousViewport = {x: viewport.x, y: viewport.y};
let interpolatedViewport = {x: viewport.x, y: viewport.y};
let renderAlpha = 1;
let viewScale = 1;
let xyratio = 0.66; // Adjust for isometric scaling (height/width ratio)
let projectiles = [];
let animals = [];
let mousePos = {x: 0, y: 0, clientX: NaN, clientY: NaN};
let pointerLockActive = false;
let pointerLockAimWorld = {x: NaN, y: NaN};
let pointerLockSensitivity = 1.0;
let pendingPointerLockEntry = null;
var messages = [];
let keysPressed = {}; // Track which keys are currently pressed
let spacebarDownAt = null;
let spellMenuKeyboardIndex = -1;
let auraMenuKeyboardIndex = -1;
let suppressNextCanvasMenuClose = false;

let textures = {};
let fireFrames = null;
let perfPanel = null;
let showPerfReadout = false;
let perfStats = {
    lastLoopAt: 0,
    fps: 0,
    loopMs: 0,
    drawMs: 0,
    simMs: 0,
    idleMs: 0,
    simSteps: 0,
    lastUiUpdateAt: 0
};
let simPerfBreakdown = {
    steps: 0,
    totalMs: 0,
    maxStepMs: 0,
    aimSyncMs: 0,
    facingMs: 0,
    movementMs: 0,
    collisionMs: 0,
    pointerPostMs: 0,
    maxAimSyncMs: 0,
    maxFacingMs: 0,
    maxMovementMs: 0,
    maxCollisionMs: 0,
    maxPointerPostMs: 0
};
const runaroundViewportNodeSampleEpsilon = 1e-4;

function applyViewportWrapShift(deltaX, deltaY) {
    if (!map) return;
    const eps = 1e-6;

    if (Math.abs(deltaX) > eps) {
        viewport.x += deltaX;
        previousViewport.x += deltaX;
        interpolatedViewport.x += deltaX;
        if (Number.isFinite(mousePos.worldX)) mousePos.worldX += deltaX;
        if (Number.isFinite(pointerLockAimWorld.x)) pointerLockAimWorld.x += deltaX;
    }
    if (Math.abs(deltaY) > eps) {
        viewport.y += deltaY;
        previousViewport.y += deltaY;
        interpolatedViewport.y += deltaY;
        if (Number.isFinite(mousePos.worldY)) mousePos.worldY += deltaY;
        if (Number.isFinite(pointerLockAimWorld.y)) pointerLockAimWorld.y += deltaY;
    }

    if (Number.isFinite(mousePos.worldX) && typeof map.wrapWorldX === "function") mousePos.worldX = map.wrapWorldX(mousePos.worldX);
    if (Number.isFinite(mousePos.worldY) && typeof map.wrapWorldY === "function") mousePos.worldY = map.wrapWorldY(mousePos.worldY);
    if (Number.isFinite(pointerLockAimWorld.x) && typeof map.wrapWorldX === "function") pointerLockAimWorld.x = map.wrapWorldX(pointerLockAimWorld.x);
    if (Number.isFinite(pointerLockAimWorld.y) && typeof map.wrapWorldY === "function") pointerLockAimWorld.y = map.wrapWorldY(pointerLockAimWorld.y);
}

function worldToNodeCanonical(worldX, worldY) {
    if (!map || !map.nodes) return null;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
    const wrappedX = (map && typeof map.wrapWorldX === "function") ? map.wrapWorldX(worldX) : worldX;
    const wrappedY = (map && typeof map.wrapWorldY === "function") ? map.wrapWorldY(worldY) : worldY;
    const approxX = Math.round(wrappedX / 0.866);
    const clampedX = Math.max(0, Math.min(map.width - 1, approxX));
    const approxY = Math.round(wrappedY - (clampedX % 2 === 0 ? 0.5 : 0));
    const clampedY = Math.max(0, Math.min(map.height - 1, approxY));
    return (map.nodes[clampedX] && map.nodes[clampedX][clampedY]) ? map.nodes[clampedX][clampedY] : null;
}

function getViewportCornerNodes() {
    if (!map) {
        return { startNode: null, endNode: null };
    }
    const sampleMaxX = viewport.x + Math.max(0, viewport.width - runaroundViewportNodeSampleEpsilon);
    const sampleMaxY = viewport.y + Math.max(0, viewport.height - runaroundViewportNodeSampleEpsilon);
    return {
        startNode: worldToNodeCanonical(viewport.x, viewport.y),
        endNode: worldToNodeCanonical(sampleMaxX, sampleMaxY)
    };
}

// Pixi.js setup
const app = new PIXI.Application({
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: 0x000000,
    antialias: true
});

// Game rendering layers
let gameContainer = new PIXI.Container();
let landLayer = new PIXI.Container();
let roadLayer = new PIXI.Container();
let gridLayer = new PIXI.Container();
let neighborDebugLayer = new PIXI.Container();
let lastDebugWizardPos = {x: -1, y: -1}; // Track wizard position to cache debug labels
let objectLayer = new PIXI.Container();
let roofLayer = new PIXI.Container();
let characterLayer = new PIXI.Container();
let projectileLayer = new PIXI.Container();
let hitboxLayer = new PIXI.Container();
let cursorLayer = new PIXI.Container();

app.stage.addChild(gameContainer);
gameContainer.addChild(landLayer);
gameContainer.addChild(roadLayer);
gameContainer.addChild(gridLayer);
gameContainer.addChild(neighborDebugLayer);
gameContainer.addChild(objectLayer);
gameContainer.addChild(roofLayer);
gameContainer.addChild(characterLayer);
gameContainer.addChild(projectileLayer);
gameContainer.addChild(hitboxLayer);
// Keep cursor unmasked so it remains visible outside indoor visibility masks.
app.stage.addChild(cursorLayer);

let landTileSprite = null;
let gridGraphics = null;
let hitboxGraphics = null;
let groundPlaneHitboxGraphics = null;
let wizardBoundaryGraphics = null;
let wizardFrames = []; // Array of frame textures for wizard animation
let wizard = null;
let roof = null; // Roof preview mesh
let cursorSprite = null; // Cursor sprite that points away from wizard
let spellCursor = null; // Alternate cursor for spacebar mode (line art)
let onscreenObjects = new Set(); // Track visible staticObjects each frame
const roadWidth = 3;

// Load sprite sheets before starting game
PIXI.Loader.shared
    .add('/assets/spritesheet/bear.json')
    .add('/assets/spritesheet/deer.json')
    .add('/assets/spritesheet/squirrel.json')
    .add('/assets/images/runningman.png')
    .add('/assets/images/fireball.png')
    .add('/assets/images/arrow.png')
    .load(onAssetsLoaded);

function onAssetsLoaded() {
    // create an array to store the textures
    let spriteNames = ["walk_left", "walk_right", "attack_left", "attack_right"];
    let animalNames = ["bear", "deer", "squirrel"]
    animalNames.forEach(animal => {
        let sheet = PIXI.Loader.shared.resources[`/assets/spritesheet/${animal}.json`].spritesheet;
        textures[animal] = {list: [], byKey: {}};
        for (let i = 0; i < spriteNames.length; i++) {
            const texture = sheet.textures[`${animal}_${spriteNames[i]}.png`];
            textures[animal].list.push(texture);
            textures[animal].byKey[spriteNames[i]] = texture;
        }    
    })
    
    // Load wizard sprite sheet (12 rows x 9 columns)
    // Extract frames from the sheet: all rows, columns 0-8
    const wizardSheet = PIXI.Texture.from('/assets/images/runningman.png');
    const baseTexture = wizardSheet.baseTexture;
    const cols = 9;
    const rows = 12;
    const frameWidth = baseTexture.width / cols;
    const frameHeight = baseTexture.height / rows;
    
    // Create textures for each frame (row-major: row 0..11, col 0..8)
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const frameRect = new PIXI.Rectangle(
                col * frameWidth,
                row * frameHeight,
                frameWidth,
                frameHeight
            );
            const frameTexture = new PIXI.Texture(baseTexture, frameRect);
            wizardFrames.push(frameTexture);
        }
    }
    
    // Initialize cursor sprite
    const cursorTexture = PIXI.Texture.from('/assets/images/arrow.png');
    cursorTexture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR; // Enable antialiasing
    cursorSprite = new PIXI.Sprite(cursorTexture);
    cursorSprite.anchor.set(0.5, 0);
    cursorLayer.addChild(cursorSprite);
    
    // Initialize spacebar cursor (line art)
    spellCursor = new PIXI.Graphics();
    cursorLayer.addChild(spellCursor);
    spellCursor.visible = false; // Hidden by default
    
    // Draw your custom cursor design here
    const cursorSize = 20;
    tenpoints = Array.from(
        { length: 10 }, (_, i) => i * 36
    ).map(angle => ({x: Math.cos(angle * Math.PI / 180) * cursorSize, y: Math.sin(angle * Math.PI / 180) * cursorSize}));
    fivepoints = Array.from(
        { length: 5 }, (_, i) => i * 72 + 18
    ).map(angle => ({x: Math.cos(angle * Math.PI / 180) * cursorSize * 0.5, y: Math.sin(angle * Math.PI / 180) * cursorSize * 0.5}));
    
    spellCursor.lineStyle(2, 0x44aaff, 1);
    for (let i = 0; i < 5; i++) {
        spellCursor.moveTo(tenpoints[i*2].x, tenpoints[i*2].y);
        spellCursor.lineTo(fivepoints[i].x, fivepoints[i].y);
        spellCursor.lineTo(tenpoints[i*2+1].x, tenpoints[i*2+1].y);
    }

    if (typeof SpellSystem !== "undefined" && typeof SpellSystem.primeSpellAssets === "function") {
        SpellSystem.primeSpellAssets();
    }
    
    console.log("Pixi assets loaded successfully");
}

function initRoadLayer() {
    // Legacy road layer disabled: roads render as regular sprites.
}

class Character {
    constructor(type, location, size, map) {
        this.type = type;
        this.map = map;
        this.size = Number.isFinite(size) ? size : 1;
        this.z = 0;
        this.travelFrames = 0;
        this.moving = false;
        this.isOnFire = false;
        this.fireSprite = null;
        this.fireFrameIndex = 1;
        this.fireDamageScale = 1;
        this.groundRadius = this.size / 3; // Default hitbox radius in hex units
        this.visualRadius = this.size / 2; // Default visual hitbox radius in hex units
        this.frameRate = 1;
        this.moveTimeout = this.nextMove();
        this.attackTimeout = null;

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
        this.destination = null;
        this.path = []; // Array of MapNodes to follow
        this.nextNode = null;
        
        // Create hitboxes
        this.visualHitbox = new CircleHitbox(this.x, this.y, this.visualRadius);
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, this.groundRadius);
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
    freeze() {
        clearTimeout(this.moveTimeout);
        this.moveTimeout = null;
    }
    delete() {
        this.gone = true;
        this.destination = null;
        this.path = [];
        this.nextNode = null;
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
    }
    getDirectionRow() {
        if (!this.direction) return 0;
        return (this.direction.x > 0 || (this.direction.x === 0 && this.direction.y > 0)) ? 1 : 0;
    }
    goto(destinationNode) {
        if (!destinationNode) return;
        
        this.node = this.map.worldToNode(this.x, this.y);
        this.destination = destinationNode;
        this.path = this.map.findPath(this.node, destinationNode);
        if (!Array.isArray(this.path)) {
            this.path = [];
        }
        this.travelFrames = 0;
        this.nextNode = null;
    }
    move() {
        this.moveTimeout = this.nextMove();
        
        if (paused) {
            return;
        }
        
        if (this.isOnFire) {
            this.burn();
        }        

        // Check if we have a destination to move toward
        if (!this.destination) {
            this.moving = false;
            return;
        }
        
        this.moving = true;
        
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
            this.direction = this.node.neighbors.indexOf(this.nextNode);

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
    ignite(duration, damageScale = null) {
        this.isOnFire = true;
        this.fireDuration = duration * frameRate; 
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
            if (this.fireSprite) {
                characterLayer.removeChild(this.fireSprite);
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
            this.hp -= 0.05 * Math.max(0, damageScale); // Fire damage over time
        }
    }
    die() {
        this.dead = true;
        this.rotation = 180;
    }
}

class Wizard extends Character {
    constructor(location, map) {
        super('human', location, 1, map);
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
        this.activeAura = null;
        this.activeAuras = [];
        this.name = 'you';
        this.groundRadius = 0.3;
        this.visualRadius = 0.5; // Hitbox radius in hex units
        this.occlusionRadius = 1.0; // Radius for occlusion checks in hex units
        this.animationSpeedMultiplier = 0.95; // Multiplier for animation speed (lower is faster)
        
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
        characterLayer.addChild(this.hatGraphics);
        this.shadowGraphics = new PIXI.Graphics();
        characterLayer.addChild(this.shadowGraphics);
        this.hatColor = 0x000099; // Royal Blue
        this.hatBandColor = 0xFFD700; // Gold
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
    turnToward(targetX, targetY) {
        // Calculate vector from wizard to target (in world coordinates)
        const normalizeDeg = (deg) => {
            let out = deg;
            while (out <= -180) out += 360;
            while (out > 180) out -= 360;
            return out;
        };

        // Calculate angle in radians, then convert to degrees.
        const angle = Math.atan2(targetY, targetX);
        const angleInDegrees = normalizeDeg(angle * 180 / Math.PI);

        // Smooth facing angle before quantizing to 12 sprite directions.
        // This prevents tiny aim oscillations from causing visible pose jitter.
        if (!Number.isFinite(this.smoothedFacingAngleDeg)) {
            this.smoothedFacingAngleDeg = angleInDegrees;
        } else {
            const delta = normalizeDeg(angleInDegrees - this.smoothedFacingAngleDeg);
            const smoothing = this.moving ? 0.38 : 0.28;
            this.smoothedFacingAngleDeg = normalizeDeg(this.smoothedFacingAngleDeg + delta * smoothing);
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
                    this.turnToward(facingVector.x, facingVector.y);
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
        
        // Use accumulated movement vector for this frame's position change
        let newX = this.x + this.movementVector.x / this.frameRate;
        let newY = this.y + this.movementVector.y / this.frameRate;
        
        const wizardRadius = this.groundRadius;
        
        // Collect nearby objects once to avoid repeated grid traversal
        const nearbyObjects = Array.isArray(this._movementNearbyObjects) ? this._movementNearbyObjects : [];
        nearbyObjects.length = 0;
        this._movementNearbyObjects = nearbyObjects;
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
                        if (obj && obj.groundPlaneHitbox && !obj.isPassable) {
                            nearbyObjects.push(obj);
                        }
                    }
                }
            }
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
        return true;
    }
    
    drawHat(interpolatedJumpHeight = null) {
        // Wizard hat positioning constants
        const hatBrimOffsetX = 0;
        const hatBrimOffsetY = -0.625;
        const hatBrimWidth = 0.5;
        const hatBrimHeight = 0.15;
        const hatPointOffsetX = 0;
        const hatPointOffsetY = -0.65;
        const hatPointHeight = 0.35;

        // Recalculate screen position from world coordinates
        const screenCoors = worldToScreen(this);
        let wizardScreenX = screenCoors.x;
        const jumpHeightForRender = Number.isFinite(interpolatedJumpHeight)
            ? interpolatedJumpHeight
            : (Number.isFinite(this.jumpHeight) ? this.jumpHeight : 0);
        const jumpOffsetPx = jumpHeightForRender * viewscale * xyratio;
        let wizardScreenY = screenCoors.y - jumpOffsetPx;
        
        this.hatGraphics.clear();
        
        // Calculate hat brim position (blue oval)
        const brimX = wizardScreenX + hatBrimOffsetX * viewscale;
        const brimY = wizardScreenY + hatBrimOffsetY * viewscale;
        const brimWidth = hatBrimWidth * viewscale;
        const brimHeight = hatBrimHeight * viewscale;
        const pointWidth = hatBrimWidth * viewscale * 0.6;
        const bandInnerHeight = brimHeight * 0.4;
        const bandInnerWidth = pointWidth * 0.8;
        const bandOuterWidth = pointWidth;
        const bandOuterHeight = brimHeight / brimWidth * bandOuterWidth;

        // Draw hat brim (oval/ellipse)
        this.hatGraphics.beginFill(this.hatColor, 1);
        this.hatGraphics.drawEllipse(brimX, brimY, brimWidth / 2, brimHeight / 2);
        this.hatGraphics.endFill();
        
        // Draw hat band outer (gold oval, slightly smaller than brim)
        this.hatGraphics.beginFill(this.hatBandColor, 1);
        this.hatGraphics.drawEllipse(brimX, brimY, bandOuterWidth / 2, bandOuterHeight / 2);
        this.hatGraphics.endFill();
        
        // Draw hat band inner (blue oval, smaller, same width as point)
        this.hatGraphics.beginFill(this.hatColor, 1);
        this.hatGraphics.drawEllipse(brimX, brimY, bandInnerWidth / 2, bandInnerHeight / 2);
        this.hatGraphics.drawRect(brimX - bandInnerWidth / 2, brimY - bandInnerHeight, bandInnerWidth, bandInnerHeight);
        this.hatGraphics.endFill();
        
        // Calculate hat point position (blue triangle)
        const pointX = wizardScreenX + hatPointOffsetX * viewscale;
        const pointY = wizardScreenY + hatPointOffsetY * viewscale;
        const pointHeight = hatPointHeight * viewscale;
        
        // Draw hat point (triangle)
        this.hatGraphics.beginFill(this.hatColor, 1);
        this.hatGraphics.moveTo(pointX, pointY - pointHeight); // Top point
        this.hatGraphics.lineTo(pointX - pointWidth / 2, pointY); // Bottom left
        this.hatGraphics.lineTo(pointX + pointWidth / 2, pointY); // Bottom right
        this.hatGraphics.closePath();
        this.hatGraphics.endFill();
        
        // Ensure hat graphics are rendered on top by moving to end of container
        if (this.hatGraphics.parent && characterLayer.children.indexOf(this.hatGraphics) !== characterLayer.children.length - 1) {
            characterLayer.removeChild(this.hatGraphics);
            characterLayer.addChild(this.hatGraphics);
        }
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

        const alpha = (typeof renderAlpha === "number") ? Math.max(0, Math.min(1, renderAlpha)) : 1;
        const previousJumpHeight = Number.isFinite(this.prevJumpHeight) ? this.prevJumpHeight : (Number.isFinite(this.jumpHeight) ? this.jumpHeight : 0);
        const currentJumpHeight = Number.isFinite(this.jumpHeight) ? this.jumpHeight : 0;
        const interpolatedJumpHeight = previousJumpHeight + (currentJumpHeight - previousJumpHeight) * alpha;

        // Draw a ground shadow from the same interpolated world position as the sprite.
        const screenCoors = worldToScreen(this);
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
        let rowIndex = this.lastDirectionRow;
        if (isVisuallyMoving && Number.isInteger(this.direction) && this.direction >= 0) {
            rowIndex = (this.direction + wizardDirectionRowOffset + 12) % 12;
            this.lastDirectionRow = rowIndex;
        }
        
        // Determine which frame (column) to show for animation
        let frameIndex = rowIndex * 9; // Start of this row
        if (this.isJumping) {
            // Keep a fixed airborne pose while jumping.
            const airborneFrameCol = 2;
            frameIndex = rowIndex * 9 + airborneFrameCol;
        } else if (isVisuallyMoving) {
            // Columns 1-8 = running animation (8 frames)
            // Column 0 = standing still
            const speedRatio = (this.currentMaxSpeed && this.speed) ? (this.currentMaxSpeed / this.speed) : 1;
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

        this.drawHat(interpolatedJumpHeight);
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
            selectedWallHeight: this.selectedWallHeight,
            selectedWallThickness: this.selectedWallThickness,
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
        if (data.x !== undefined) this.x = data.x;
        if (data.y !== undefined) this.y = data.y;
        if (data.hp !== undefined) this.hp = data.hp;
        if (data.maxHp !== undefined) this.maxHp = data.maxHp;
        if (data.magic !== undefined) this.magic = data.magic;
        if (data.maxMagic !== undefined) this.maxMagic = data.maxMagic;
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
        if (data.selectedPlaceableTexturePath !== undefined) this.selectedPlaceableTexturePath = data.selectedPlaceableTexturePath;
        if (data.selectedPlaceableByCategory !== undefined) this.selectedPlaceableByCategory = data.selectedPlaceableByCategory;
        if (data.selectedPlaceableRenderOffset !== undefined) this.selectedPlaceableRenderOffset = data.selectedPlaceableRenderOffset;
        if (data.selectedPlaceableRenderOffsetByTexture !== undefined) this.selectedPlaceableRenderOffsetByTexture = data.selectedPlaceableRenderOffsetByTexture;
        if (data.selectedPlaceableScale !== undefined) this.selectedPlaceableScale = data.selectedPlaceableScale;
        if (data.selectedPlaceableScaleByTexture !== undefined) this.selectedPlaceableScaleByTexture = data.selectedPlaceableScaleByTexture;
        if (data.selectedWallHeight !== undefined) this.selectedWallHeight = data.selectedWallHeight;
        if (data.selectedWallThickness !== undefined) this.selectedWallThickness = data.selectedWallThickness;
        if (typeof data.showPerfReadout === "boolean") {
            showPerfReadout = data.showPerfReadout;
            if (perfPanel) {
                perfPanel.css("display", showPerfReadout ? "block" : "none");
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

        this.node = this.map.worldToNode(this.x, this.y) || this.node;
        this.updateHitboxes();

        if (data.viewport && Number.isFinite(data.viewport.x) && Number.isFinite(data.viewport.y)) {
            viewport.x = data.viewport.x;
            viewport.y = data.viewport.y;
        } else {
            centerViewport(this, 0, 0);
        }

        if (this.map && typeof this.map.wrapWorldX === "function") {
            viewport.x = this.map.wrapWorldX(viewport.x);
        }
        if (this.map && typeof this.map.wrapWorldY === "function") {
            viewport.y = this.map.wrapWorldY(viewport.y);
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
        this.prevJumpHeight = Number.isFinite(this.jumpHeight) ? this.jumpHeight : 0;
        if (typeof previousViewport !== "undefined") {
            previousViewport.x = viewport.x;
            previousViewport.y = viewport.y;
        }
        if (typeof interpolatedViewport !== "undefined") {
            interpolatedViewport.x = viewport.x;
            interpolatedViewport.y = viewport.y;
        }
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
        if (typeof SpellSystem !== "undefined" && typeof SpellSystem.refreshAuraSelector === "function") {
            SpellSystem.refreshAuraSelector(this);
        }
    }
}

class Animal extends Character {
    constructor(type, location, size, map) {
        super(type, location, size, map);
        this.radius = this.size / 2; // Animal hitbox radius in hex units
        this.isOnFire = false;
        this.fireSprite = null;
        this.fireFrameIndex = 0;
        
        // Create Pixi sprite
        if (map.animalImages && map.animalImages[type]) {
            this.pixiSprite = new PIXI.Sprite(map.animalImages[type]);
        } else {
            this.pixiSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        }
        this.pixiSprite.anchor.set(0.5, 0.5);

        this.spriteRows = 1;
        this.spriteCols = 1;
        this.spriteCol = 0;
        this.spriteFrames = [[this.pixiSprite.texture]];
        this.spriteSheet = null;
        this.spriteSheetReady = false;

        this.imageFrame = {x: 0, y: 0};
        this.frameCount = {x: 1, y: 1};
        
        // Default stats (can be overridden in subclasses)
        this.size = 1;
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
        this.randomMotion = 1;
        
        this.speed = this.walkSpeed;
        this._onScreen = false;
        this.rotation = 0;
        this.dead = false;
        this.frameRate = this.onScreen ? 30 : 1;
        ensureSpriteFrames(this);
    }
    move() {
        if (this.dead || this.gone) {
            clearTimeout(this.moveTimeout);
            clearTimeout(this.attackTimeout);
            return;
        } 
        super.move();
        // wander around
        if (this.x && this.y && !this.moving) {
            const wanderX = this.x + (Math.random() - 0.5) * 10;
            const wanderY = this.y + (Math.random() - 0.5) * 10;
            const wanderNode = this.map.worldToNode(wanderX, wanderY);
            if (wanderNode) this.goto(wanderNode);
            this.speed = this.walkSpeed;
        }

        // maintain a reasonable framerate only when visible
        if (this.travelFrames === 0) {
            this.frameRate = this.onScreen ? 30 : this.speed;
        }

        // face the correct direction
        if (this.direction && !this.attacking && this.frameCount.y > 1) {
            if (this.direction.x > 0 || this.direction.x === 0 && this.direction.y > 0) {
                this.imageFrame.y = 1;
            }
            else {
                this.imageFrame.y = 0;
            }
        }
        if (this.fleeRadius > 0 && withinRadius(this.x, this.y, wizard.x, wizard.y, this.fleeRadius)) {
            this.flee()
        }
        else if (this.chaseRadius > 0 && withinRadius(this.x, this.y, wizard.x, wizard.y, this.chaseRadius)) {
            this.attack(wizard);
        }
    }
    get onScreen() {
        const safetyMargin = 5; // world units
        if (this.gone) return false;
        const camera = viewport;
        const centerX = camera.x + camera.width * 0.5;
        const centerY = camera.y + camera.height * 0.5;
        const dx = (this.map && typeof this.map.shortestDeltaX === "function")
            ? this.map.shortestDeltaX(centerX, this.x)
            : (this.x - centerX);
        const dy = (this.map && typeof this.map.shortestDeltaY === "function")
            ? this.map.shortestDeltaY(centerY, this.y)
            : (this.y - centerY);
        const maxX = camera.width * 0.5 + this.width + safetyMargin;
        const maxY = camera.height * 0.5 + this.height + safetyMargin / xyratio;
        this._onScreen = Math.abs(dx) <= maxX && Math.abs(dy) <= maxY;
        return this._onScreen;
    }
    flee() {
        // flee the player
        let dist = distance(this.x, this.y, wizard.x, wizard.y);

        let xdist = this.x - wizard.x;
        let ydist = this.y - wizard.y;
        const fleeX = Math.floor(Math.max(Math.min(this.x + xdist / dist * 10, this.map.width - 1), 0));
        const fleeY = Math.floor(Math.max(Math.min(this.y + ydist / dist * 10, this.map.height - 1), 0));
        const fleeNode = this.map.nodes[fleeX] ? this.map.nodes[fleeX][fleeY] : null;
        if (fleeNode) this.goto(fleeNode);
        this.speed = this.runSpeed;
    }
    attack(target) {
        const targetNode = this.map.worldToNode(target.x, target.y);
        if (targetNode) this.goto(targetNode);
        this.speed = this.runSpeed;
        this.attacking = this.attacking || 1;
        if (withinRadius(this.x, this.y, target.x, target.y, 1) && this.attacking == 1) {
            this.attacking = 2
            if (this.spriteCols > 1) this.spriteCol = 1;
            this.imageFrame.y = (this.x > target.x) ? 0 : 1;
            let damage = Math.floor((1 - Math.random() * Math.random()) * this.damage + 1);
            // message(`${this.type} ${this.attackVerb} ${target.name} for ${damage} damage!`)
            target.hp = Math.max(0, target.hp - damage);
            this.attackTimeout = setTimeout(() => {
                if (this.spriteCols > 1) this.spriteCol = 0;
                this.attacking = 1;
            }, 1000);
        }
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
            hp: this.hp
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
        this.fleeRadius = 5;
        this.foodValue = Math.floor(6 * this.size);
        this.hp = 1;
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
        this.fleeRadius = 9;
        this.foodValue = Math.floor(90 * size);
        this.hp = 10 * size;
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
        this.frameCount = {x: 2, y: 2};
        this.width = this.size * 1.4;
        this.height = this.size;
        this.walkSpeed = 1;
        this.runSpeed = 3;
        this.chaseRadius = 9;
        this.fleeRadius = -1;
        this.attackVerb = "mauls";
        this.damage = 20;
        this.foodValue = Math.floor(240 * this.size);
        this.hp = 25 * this.size;
        this.spriteSheetReady = false;
        ensureSpriteFrames(this);
    }
}


class Scorpion extends Animal {
    constructor(location, map) {
        super('scorpion', location, map);
        this.frameCount = {x: 1, y: 2};
        this.size = Math.random() * .1 + .4;
        this.width = this.size;
        this.height = this.size;
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
        super('armadillo', location, map);
        this.frameCount = {x: 1, y: 2};
        this.size = Math.random() * .2 + .5;
        this.width = this.size;
        this.height = this.size;
        this.walkSpeed = 1;
        this.runSpeed = 2;
        this.fleeRadius = 7;
        this.foodValue = Math.floor(20 * this.size);
        this.hp = 10 * this.size;
        this.randomMotion = 3;
    }
}

class Coyote extends Animal {
    constructor(location, map) {
        super('coyote', location, map);
        this.frameCount = {x: 1, y: 2};
        this.size = Math.random() * .25 + .7;
        this.width = this.size * 1.75;
        this.height = this.size;
        this.walkSpeed = 1;
        this.runSpeed = 3.5;
        this.fleeRadius = 10;
        this.foodValue = Math.floor(60 * this.size);
        this.hp = 15 * this.size;
        this.randomMotion = 6;
    }
}

class Goat extends Animal {
    constructor(location, map) {
        super('goat', location, map);
        this.frameCount = {x: 1, y: 2};
        this.size = Math.random() * .25 + .7;
        this.width = this.size * 1.2;
        this.height = this.size;
        this.walkSpeed = 1;
        this.runSpeed = 2.5;
        this.fleeRadius = 8;
        this.foodValue = Math.floor(80 * this.size);
        this.hp = 15 * this.size;
        this.randomMotion = 6;
    }
}

class Porcupine extends Animal {
    constructor(location, map) {
        super('porcupine', location, map);
        this.frameCount = {x: 2, y: 2};
        this.size = Math.random() * .2 + .5;
        this.width = this.size * 1.15;
        this.height = this.size;
        this.walkSpeed = 1;
        this.runSpeed = 2;
        this.fleeRadius = 7;
        this.chaseRadius = 4;
        this.damage = 3;
        this.attackVerb = "pokes";
        this.foodValue = Math.floor(20 * this.size);
        this.hp = 5 * this.size;
        this.randomMotion = 3;
    }
}

class Yeti extends Animal {
    constructor(location, map) {
        super('yeti', location, map);
        this.frameCount = {x: 2, y: 2};
        this.size = Math.random() * .5 + 1.5;
        this.width = this.size * 1.2;
        this.height = this.size;
        this.walkSpeed = 1;
        this.runSpeed = 2.75;
        this.chaseRadius = 6;
        this.attackVerb = "mauls";
        this.damage = 50;
        this.foodValue = Math.floor(400 * this.size);
        this.hp = 40 * this.size;
    }
}

jQuery(() => {
    if (typeof sanitizeSavedGameState === 'function') {
        sanitizeSavedGameState();
    }

    // Append Pixi canvas to display
    $("#display").append(app.view);
    perfPanel = $("<div id='perfReadout'></div>").css({
        position: "fixed",
        top: "8px",
        right: "8px",
        "z-index": 99999,
        padding: "6px 8px",
        "font-family": "monospace",
        "font-size": "11px",
        color: "#d8f6ff",
        background: "rgba(0,0,0,0.55)",
        border: "1px solid rgba(180,220,235,0.45)",
        "border-radius": "4px",
        "pointer-events": "none",
        "white-space": "pre"
    });
    perfPanel.css("display", showPerfReadout ? "block" : "none");
    $("body").append(perfPanel);

    if (app.view && app.view.style) {
        app.view.style.cursor = "url('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), default";
    }

    document.addEventListener("mousemove", event => {
        mousePos.clientX = event.clientX;
        mousePos.clientY = event.clientY;
    });

    function isPointerLockedOnCanvas() {
        return document.pointerLockElement === app.view;
    }

    function syncMouseWorldFromScreenWithViewport() {
        if (!Number.isFinite(mousePos.screenX) || !Number.isFinite(mousePos.screenY)) return;
        const world = screenToWorld(mousePos.screenX, mousePos.screenY);
        const normalized = normalizeAimWorldPointForWizard(world.x, world.y);
        mousePos.worldX = normalized.x;
        mousePos.worldY = normalized.y;
    }

    function normalizeAimWorldPointForWizard(worldX, worldY) {
        let outX = worldX;
        let outY = worldY;
        if (map && typeof map.wrapWorldX === "function" && Number.isFinite(outX)) {
            outX = map.wrapWorldX(outX);
        }
        if (map && typeof map.wrapWorldY === "function" && Number.isFinite(outY)) {
            outY = map.wrapWorldY(outY);
        }
        if (
            wizard &&
            map &&
            typeof map.shortestDeltaX === "function" &&
            typeof map.shortestDeltaY === "function" &&
            Number.isFinite(wizard.x) &&
            Number.isFinite(wizard.y) &&
            Number.isFinite(outX) &&
            Number.isFinite(outY)
        ) {
            outX = wizard.x + map.shortestDeltaX(wizard.x, outX);
            outY = wizard.y + map.shortestDeltaY(wizard.y, outY);
        }
        return { x: outX, y: outY };
    }

    function getWizardAimVectorTo(worldX, worldY) {
        const normalized = normalizeAimWorldPointForWizard(worldX, worldY);
        return {
            x: normalized.x - wizard.x,
            y: normalized.y - wizard.y,
            worldX: normalized.x,
            worldY: normalized.y
        };
    }

    function syncMouseScreenFromWorldWithViewport(useInterpolatedCamera = false) {
        if (!Number.isFinite(pointerLockAimWorld.x) || !Number.isFinite(pointerLockAimWorld.y)) return;
        const camera = (
            useInterpolatedCamera &&
            interpolatedViewport &&
            Number.isFinite(interpolatedViewport.x) &&
            Number.isFinite(interpolatedViewport.y)
        )
            ? interpolatedViewport
            : viewport;
        const dx = (map && typeof map.shortestDeltaX === "function")
            ? map.shortestDeltaX(camera.x, pointerLockAimWorld.x)
            : (pointerLockAimWorld.x - camera.x);
        const dy = (map && typeof map.shortestDeltaY === "function")
            ? map.shortestDeltaY(camera.y, pointerLockAimWorld.y)
            : (pointerLockAimWorld.y - camera.y);
        mousePos.screenX = dx * viewscale;
        mousePos.screenY = dy * viewscale * xyratio;
    }

    function clampVirtualCursorToCanvas(paddingPx = 1) {
        if (!app || !app.screen) return false;
        const width = Number.isFinite(app.screen.width) ? app.screen.width : 0;
        const height = Number.isFinite(app.screen.height) ? app.screen.height : 0;
        if (width <= 0 || height <= 0) return false;
        const pad = Math.max(0, Number.isFinite(paddingPx) ? paddingPx : 0);
        const minX = pad;
        const minY = pad;
        const maxX = Math.max(minX, width - pad);
        const maxY = Math.max(minY, height - pad);
        if (!Number.isFinite(mousePos.screenX)) mousePos.screenX = width * 0.5;
        if (!Number.isFinite(mousePos.screenY)) mousePos.screenY = height * 0.5;
        const clampedX = Math.max(minX, Math.min(maxX, mousePos.screenX));
        const clampedY = Math.max(minY, Math.min(maxY, mousePos.screenY));
        const changed = (clampedX !== mousePos.screenX) || (clampedY !== mousePos.screenY);
        mousePos.screenX = clampedX;
        mousePos.screenY = clampedY;
        return changed;
    }

    function ensurePointerLockAimInitialized() {
        if (Number.isFinite(pointerLockAimWorld.x) && Number.isFinite(pointerLockAimWorld.y)) return;
        if (Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY)) {
            const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
            pointerLockAimWorld.x = normalized.x;
            pointerLockAimWorld.y = normalized.y;
            return;
        }
        if (Number.isFinite(mousePos.screenX) && Number.isFinite(mousePos.screenY)) {
            const world = screenToWorld(mousePos.screenX, mousePos.screenY);
            const normalized = normalizeAimWorldPointForWizard(world.x, world.y);
            pointerLockAimWorld.x = normalized.x;
            pointerLockAimWorld.y = normalized.y;
            return;
        }
        if (wizard && Number.isFinite(wizard.x) && Number.isFinite(wizard.y)) {
            pointerLockAimWorld.x = wizard.x;
            pointerLockAimWorld.y = wizard.y;
            syncMouseScreenFromWorldWithViewport();
        }
    }

    function requestGameplayPointerLock(event = null) {
        if (!app.view || typeof app.view.requestPointerLock !== "function") return;
        const rect = app.view.getBoundingClientRect();
        const fallbackX = Number.isFinite(mousePos.screenX) ? mousePos.screenX : app.screen.width * 0.5;
        const fallbackY = Number.isFinite(mousePos.screenY) ? mousePos.screenY : app.screen.height * 0.5;
        const screenX = (
            event &&
            Number.isFinite(event.clientX) &&
            Number.isFinite(rect.left)
        ) ? (event.clientX - rect.left) : fallbackX;
        const screenY = (
            event &&
            Number.isFinite(event.clientY) &&
            Number.isFinite(rect.top)
        ) ? (event.clientY - rect.top) : fallbackY;
        mousePos.screenX = screenX;
        mousePos.screenY = screenY;
        clampVirtualCursorToCanvas(1);
        syncMouseWorldFromScreenWithViewport();
        pendingPointerLockEntry = {
            screenX: mousePos.screenX,
            screenY: mousePos.screenY,
            worldX: mousePos.worldX,
            worldY: mousePos.worldY
        };
        app.view.requestPointerLock();
    }

    function exitGameplayPointerLock() {
        if (document.pointerLockElement !== app.view) return;
        if (typeof document.exitPointerLock === "function") {
            document.exitPointerLock();
        }
    }

    if (typeof globalThis !== "undefined" && typeof globalThis.setPointerLockSensitivity !== "function") {
        globalThis.setPointerLockSensitivity = function setPointerLockSensitivity(value) {
            const n = Number(value);
            if (!Number.isFinite(n)) return;
            pointerLockSensitivity = Math.max(0.05, Math.min(3, n));
        };
    }

    function getVirtualCursorClientPoint() {
        if (!app || !app.view) return { x: NaN, y: NaN };
        if (!Number.isFinite(mousePos.screenX) || !Number.isFinite(mousePos.screenY)) return { x: NaN, y: NaN };
        const rect = app.view.getBoundingClientRect();
        return {
            x: rect.left + mousePos.screenX,
            y: rect.top + mousePos.screenY
        };
    }

    function getVirtualCursorHoveredElement() {
        const pt = getVirtualCursorClientPoint();
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y) || typeof document === "undefined") return null;
        return document.elementFromPoint(pt.x, pt.y);
    }

    function isVirtualCursorOverMenuArea() {
        const hovered = getVirtualCursorHoveredElement();
        if (!hovered || typeof hovered.closest !== "function") return false;
        return !!hovered.closest("#spellMenu, #selectedSpell, #spellSelector, #auraMenu, #selectedAura, #auraSelector, #activeAuraIcons");
    }

    document.addEventListener("pointerlockchange", () => {
        pointerLockActive = isPointerLockedOnCanvas();
        if (pointerLockActive) {
            if (
                pendingPointerLockEntry &&
                Number.isFinite(pendingPointerLockEntry.screenX) &&
                Number.isFinite(pendingPointerLockEntry.screenY)
            ) {
                mousePos.screenX = pendingPointerLockEntry.screenX;
                mousePos.screenY = pendingPointerLockEntry.screenY;
                if (Number.isFinite(pendingPointerLockEntry.worldX) && Number.isFinite(pendingPointerLockEntry.worldY)) {
                    const normalized = normalizeAimWorldPointForWizard(pendingPointerLockEntry.worldX, pendingPointerLockEntry.worldY);
                    pointerLockAimWorld.x = normalized.x;
                    pointerLockAimWorld.y = normalized.y;
                } else {
                    syncMouseWorldFromScreenWithViewport();
                    const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
                    pointerLockAimWorld.x = normalized.x;
                    pointerLockAimWorld.y = normalized.y;
                }
            } else {
                ensurePointerLockAimInitialized();
                mousePos.worldX = pointerLockAimWorld.x;
                mousePos.worldY = pointerLockAimWorld.y;
                syncMouseScreenFromWorldWithViewport();
            }
            clampVirtualCursorToCanvas(1);
            syncMouseWorldFromScreenWithViewport();
            const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
            pointerLockAimWorld.x = normalized.x;
            pointerLockAimWorld.y = normalized.y;
            updateCursor();
        }
        pendingPointerLockEntry = null;
    });
    
    // Handle window resize
    window.addEventListener('resize', sizeView);

    function sizeView() {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        
        if (window.innerWidth > window.innerHeight) {
            viewport.width = 31;
        }
        else {
            viewport.width = 20;
        }

        viewport.height = Math.ceil(viewport.width * (app.screen.height / app.screen.width) / xyratio);

        centerViewport(wizard, 0);

        viewscale = app.screen.width / viewport.width;

        // Reposition background tiles after resize
        updateLandLayer();

    }

    function clearOnScreenObjects() {
        if (!map || !wizard) return;

        const { startNode, endNode } = getViewportCornerNodes();
        if (!startNode || !endNode) return;

        const xStart = Math.max(0, Math.min(startNode.xindex, endNode.xindex));
        const xEnd = Math.min(mapWidth - 1, Math.max(startNode.xindex, endNode.xindex));
        const yStart = Math.max(0, Math.min(startNode.yindex, endNode.yindex));
        const yEnd = Math.min(mapHeight - 1, Math.max(startNode.yindex, endNode.yindex));

        for (let y = yStart; y <= yEnd; y++) {
            for (let x = xStart; x <= xEnd; x++) {
                const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
                if (!node || !node.objects || node.objects.length === 0) continue;

                const objectsToRemove = node.objects.filter(obj => obj && obj.type === "tree");
                objectsToRemove.forEach(obj => {
                    obj.gone = true;
                    obj.removeFromNodes();
                    if (obj.pixiSprite && obj.pixiSprite.parent) {
                        obj.pixiSprite.parent.removeChild(obj.pixiSprite);
                    }
                });
            }
        }

        animals = animals.filter(animal => {
            if (!animal || animal.gone) return false;
            if (animal.onScreen) {
                if (typeof animal.delete === "function") animal.delete();
                else animal.gone = true;
                return false;
            }
            return true;
        });
    }

    function getSpellMenuIconElements() {
        const grid = document.getElementById("spellGrid");
        if (!grid) return [];
        return Array.from(grid.querySelectorAll(".spellIcon, button"));
    }

    function getAuraMenuIconElements() {
        const grid = document.getElementById("auraGrid");
        if (!grid) return [];
        return Array.from(grid.querySelectorAll(".auraIcon, button"));
    }

    function clearSpellMenuKeyboardFocus() {
        getSpellMenuIconElements().forEach(icon => icon.classList.remove("keyboard-nav-focus"));
        spellMenuKeyboardIndex = -1;
    }

    function clearAuraMenuKeyboardFocus() {
        getAuraMenuIconElements().forEach(icon => icon.classList.remove("keyboard-nav-focus"));
        auraMenuKeyboardIndex = -1;
    }

    function setSpellMenuKeyboardFocus(index) {
        const icons = getSpellMenuIconElements();
        if (!icons.length) {
            spellMenuKeyboardIndex = -1;
            return false;
        }
        const clamped = Math.max(0, Math.min(icons.length - 1, index));
        icons.forEach(icon => icon.classList.remove("keyboard-nav-focus"));
        icons[clamped].classList.add("keyboard-nav-focus");
        spellMenuKeyboardIndex = clamped;
        return true;
    }

    function initSpellMenuKeyboardFocus() {
        const icons = getSpellMenuIconElements();
        if (!icons.length) {
            spellMenuKeyboardIndex = -1;
            return false;
        }
        const selectedIndex = icons.findIndex(icon => icon.classList.contains("selected"));
        return setSpellMenuKeyboardFocus(selectedIndex >= 0 ? selectedIndex : 0);
    }

    function moveSpellMenuKeyboardFocus(dx, dy) {
        const icons = getSpellMenuIconElements();
        if (!icons.length) return false;
        if (!Number.isInteger(spellMenuKeyboardIndex) || spellMenuKeyboardIndex < 0 || spellMenuKeyboardIndex >= icons.length) {
            initSpellMenuKeyboardFocus();
        }
        const grid = document.getElementById("spellGrid");
        const computed = grid ? window.getComputedStyle(grid) : null;
        const cols = (() => {
            if (!computed) return 4;
            const template = computed.gridTemplateColumns || "";
            if (!template || template === "none") return 4;
            const count = template.split(" ").filter(token => token && token !== "/").length;
            return Math.max(1, count);
        })();
        const current = Math.max(0, spellMenuKeyboardIndex);
        const row = Math.floor(current / cols);
        const col = current % cols;
        const nextRow = Math.max(0, row + dy);
        const nextCol = Math.max(0, Math.min(cols - 1, col + dx));
        let next = nextRow * cols + nextCol;
        if (next >= icons.length) next = icons.length - 1;
        return setSpellMenuKeyboardFocus(next);
    }

    function setAuraMenuKeyboardFocus(index) {
        const icons = getAuraMenuIconElements();
        if (!icons.length) {
            auraMenuKeyboardIndex = -1;
            return false;
        }
        const clamped = Math.max(0, Math.min(icons.length - 1, index));
        icons.forEach(icon => icon.classList.remove("keyboard-nav-focus"));
        icons[clamped].classList.add("keyboard-nav-focus");
        auraMenuKeyboardIndex = clamped;
        return true;
    }

    function initAuraMenuKeyboardFocus() {
        const icons = getAuraMenuIconElements();
        if (!icons.length) {
            auraMenuKeyboardIndex = -1;
            return false;
        }
        const selectedIndex = icons.findIndex(icon => icon.classList.contains("selected"));
        return setAuraMenuKeyboardFocus(selectedIndex >= 0 ? selectedIndex : 0);
    }

    function moveAuraMenuKeyboardFocus(dx, dy) {
        const icons = getAuraMenuIconElements();
        if (!icons.length) return false;
        if (!Number.isInteger(auraMenuKeyboardIndex) || auraMenuKeyboardIndex < 0 || auraMenuKeyboardIndex >= icons.length) {
            initAuraMenuKeyboardFocus();
        }
        const grid = document.getElementById("auraGrid");
        const computed = grid ? window.getComputedStyle(grid) : null;
        const cols = (() => {
            if (!computed) return 3;
            const template = computed.gridTemplateColumns || "";
            if (!template || template === "none") return 3;
            const count = template.split(" ").filter(token => token && token !== "/").length;
            return Math.max(1, count);
        })();
        const current = Math.max(0, auraMenuKeyboardIndex);
        const row = Math.floor(current / cols);
        const col = current % cols;
        const nextRow = Math.max(0, row + dy);
        const nextCol = Math.max(0, Math.min(cols - 1, col + dx));
        let next = nextRow * cols + nextCol;
        if (next >= icons.length) next = icons.length - 1;
        return setAuraMenuKeyboardFocus(next);
    }

    function activateSelectedAuraFromMenu() {
        const icons = getAuraMenuIconElements();
        if (!icons.length) return { activated: false, shouldCloseMenu: false };
        let target = icons.find(icon => icon.classList.contains("keyboard-nav-focus"));
        if (!target) {
            target = icons.find(icon => icon.classList.contains("selected"));
        }
        if (!target) {
            target = icons[0];
        }
        if (!target) return { activated: false, shouldCloseMenu: false };
        target.click();
        return { activated: true, shouldCloseMenu: false };
    }

    function activateSelectedSpellFromMenu() {
        const icons = getSpellMenuIconElements();
        if (!icons.length) return { activated: false, shouldCloseMenu: false };
        let target = icons.find(icon => icon.classList.contains("keyboard-nav-focus"));
        if (!target) {
            target = icons.find(icon => icon.classList.contains("selected"));
        }
        if (!target) {
            target = icons[0];
        }
        if (!target) return { activated: false, shouldCloseMenu: false };
        const targetLabel = (target.textContent || "").trim().toLowerCase();
        const isBackAction = targetLabel === "back";
        target.click();
        return { activated: true, shouldCloseMenu: !isBackAction };
    }

    function getFocusedSpellNameFromMenu() {
        const icons = getSpellMenuIconElements();
        if (!icons.length) return null;
        let target = icons.find(icon => icon.classList.contains("keyboard-nav-focus"));
        if (!target) {
            target = icons.find(icon => icon.classList.contains("selected"));
        }
        if (!target) {
            target = icons[0];
        }
        if (!target || !target.dataset) return null;
        return target.dataset.spell || null;
    }

    function openFocusedSpellSubmenu() {
        if (!wizard || typeof SpellSystem === "undefined") return false;
        const spellName = getFocusedSpellNameFromMenu();
        if (!spellName) return false;
        if (spellName === "buildroad" && typeof SpellSystem.showFlooringMenu === "function") {
            SpellSystem.showFlooringMenu(wizard);
            initSpellMenuKeyboardFocus();
            return true;
        }
        if (spellName === "wall" && typeof SpellSystem.showWallMenu === "function") {
            SpellSystem.showWallMenu(wizard);
            initSpellMenuKeyboardFocus();
            return true;
        }
        if (spellName === "treegrow" && typeof SpellSystem.showTreeMenu === "function") {
            SpellSystem.showTreeMenu(wizard);
            initSpellMenuKeyboardFocus();
            return true;
        }
        if (spellName === "placeobject" && typeof SpellSystem.showPlaceableMenu === "function") {
            SpellSystem.showPlaceableMenu(wizard);
            initSpellMenuKeyboardFocus();
            return true;
        }
        return false;
    }

    console.log("Generating map...");
    initRoadLayer();
    map = new GameMap(mapHeight, mapWidth, {}, () => {
        frameRate = 30;
        const simStepMs = 1000 / frameRate;
        let simAccumulatorMs = 0;
        let lastFrameMs = performance.now();
        let lastPresentedMs = 0;
        let nextPresentAtMs = 0;
        const maxSimStepsPerFrame = 5;
        
        // Draw immediately on first frame
        drawCanvas();
        
        function runSimulationStep() {
            if (!wizard) return;
            const stepStartMs = performance.now();
            let aimSyncMs = 0;
            let facingMs = 0;
            let movementMs = 0;
            let collisionMs = 0;
            let pointerPostMs = 0;
            // Keep aim stable through camera drift:
            // pointer lock stores world aim directly, unlocked mode maps screen->world.
            const aimSyncStartMs = performance.now();
            if (pointerLockActive) {
                ensurePointerLockAimInitialized();
                const cursorOverMenu = isVirtualCursorOverMenuArea();
                if (cursorOverMenu) {
                    // Over menu UI, keep screen-space cursor pinned and derive world aim from it.
                    syncMouseWorldFromScreenWithViewport();
                    const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
                    pointerLockAimWorld.x = normalized.x;
                    pointerLockAimWorld.y = normalized.y;
                } else {
                    mousePos.worldX = pointerLockAimWorld.x;
                    mousePos.worldY = pointerLockAimWorld.y;
                    syncMouseScreenFromWorldWithViewport();
                    if (clampVirtualCursorToCanvas(1)) {
                        syncMouseWorldFromScreenWithViewport();
                        const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
                        pointerLockAimWorld.x = normalized.x;
                        pointerLockAimWorld.y = normalized.y;
                    }
                }
            } else if (Number.isFinite(mousePos.screenX) && Number.isFinite(mousePos.screenY)) {
                syncMouseWorldFromScreenWithViewport();
            }
            aimSyncMs = performance.now() - aimSyncStartMs;

            // Always face the mouse when a valid aim vector exists,
            // even when the wizard is not moving.
            const facingStartMs = performance.now();
            if (Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY)) {
                const aim = getWizardAimVectorTo(mousePos.worldX, mousePos.worldY);
                const faceX = aim.x;
                const faceY = aim.y;
                if (Math.hypot(faceX, faceY) > 1e-6) {
                    wizard.turnToward(faceX, faceY);
                }
            }
            facingMs = performance.now() - facingStartMs;
            
            // Calculate desired movement direction from input
            let moveVector = null;
            let moveOptions = {};
            const forwardAim = getWizardAimVectorTo(mousePos.worldX, mousePos.worldY);
            const forwardVector = {
                x: forwardAim.x,
                y: forwardAim.y
            };
            const movingForward = !!keysPressed['w'];
            const movingBackward = !!keysPressed['s'];
            if (wizard.isJumping) {
                moveVector = wizard.movementVector;
                moveOptions = {
                    speedMultiplier: wizard.jumpLockedMovingBackward ? wizard.backwardSpeedMultiplier : 1,
                    animateBackward: wizard.jumpLockedMovingBackward,
                    lockMovementVector: true
                };
            } else if (movingForward && !movingBackward) {
                moveVector = forwardVector;
                moveOptions = {
                    speedMultiplier: 1,
                    animateBackward: false,
                    facingVector: forwardVector
                };
                wizard.path = [];
                wizard.nextNode = null;
            } else if (movingBackward && !movingForward) {
                moveVector = {
                    x: -forwardVector.x,
                    y: -forwardVector.y
                };
                moveOptions = {
                    speedMultiplier: wizard.backwardSpeedMultiplier,
                    animateBackward: true,
                    facingVector: forwardVector
                };
                wizard.path = [];
                wizard.nextNode = null;
            }
            
            // Process movement every frame (with or without input)
            const movementStartMs = performance.now();
            const wizardStartX = wizard.x;
            const wizardStartY = wizard.y;
            wizard.prevJumpHeight = Number.isFinite(wizard.jumpHeight) ? wizard.jumpHeight : 0;
            wizard.moveDirection(moveVector, moveOptions);
            wizard.updateJump(1 / frameRate);
            movementMs = performance.now() - movementStartMs;
            const collisionStartMs = performance.now();
            if (typeof SpellSystem !== "undefined" && typeof SpellSystem.updateCharacterObjectCollisions === "function") {
                SpellSystem.updateCharacterObjectCollisions(wizard);
            }
            collisionMs = performance.now() - collisionStartMs;
            const pointerPostStartMs = performance.now();
            if (
                pointerLockActive &&
                Number.isFinite(pointerLockAimWorld.x) &&
                Number.isFinite(pointerLockAimWorld.y) &&
                !isVirtualCursorOverMenuArea()
            ) {
                // Keep lock-mode aim anchored relative to the wizard's movement.
                const wizardDeltaX = wizard.x - wizardStartX;
                const wizardDeltaY = wizard.y - wizardStartY;
                pointerLockAimWorld.x += wizardDeltaX;
                pointerLockAimWorld.y += wizardDeltaY;
                const normalized = normalizeAimWorldPointForWizard(pointerLockAimWorld.x, pointerLockAimWorld.y);
                pointerLockAimWorld.x = normalized.x;
                pointerLockAimWorld.y = normalized.y;
                mousePos.worldX = normalized.x;
                mousePos.worldY = normalized.y;
            }
            if (pointerLockActive) {
                if (isVirtualCursorOverMenuArea()) {
                    syncMouseWorldFromScreenWithViewport();
                    const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
                    pointerLockAimWorld.x = normalized.x;
                    pointerLockAimWorld.y = normalized.y;
                } else {
                    syncMouseScreenFromWorldWithViewport();
                    if (clampVirtualCursorToCanvas(1)) {
                        syncMouseWorldFromScreenWithViewport();
                        const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
                        pointerLockAimWorld.x = normalized.x;
                        pointerLockAimWorld.y = normalized.y;
                    }
                }
            }
            pointerPostMs = performance.now() - pointerPostStartMs;
            const stepTotalMs = performance.now() - stepStartMs;
            simPerfBreakdown.steps += 1;
            simPerfBreakdown.totalMs += stepTotalMs;
            simPerfBreakdown.maxStepMs = Math.max(simPerfBreakdown.maxStepMs, stepTotalMs);
            simPerfBreakdown.aimSyncMs += aimSyncMs;
            simPerfBreakdown.facingMs += facingMs;
            simPerfBreakdown.movementMs += movementMs;
            simPerfBreakdown.collisionMs += collisionMs;
            simPerfBreakdown.pointerPostMs += pointerPostMs;
            simPerfBreakdown.maxAimSyncMs = Math.max(simPerfBreakdown.maxAimSyncMs, aimSyncMs);
            simPerfBreakdown.maxFacingMs = Math.max(simPerfBreakdown.maxFacingMs, facingMs);
            simPerfBreakdown.maxMovementMs = Math.max(simPerfBreakdown.maxMovementMs, movementMs);
            simPerfBreakdown.maxCollisionMs = Math.max(simPerfBreakdown.maxCollisionMs, collisionMs);
            simPerfBreakdown.maxPointerPostMs = Math.max(simPerfBreakdown.maxPointerPostMs, pointerPostMs);
            frameCount ++;
        }

        function renderFrame(nowMs) {
            const frameDeltaMs = Math.min(250, Math.max(0, nowMs - lastFrameMs));
            lastFrameMs = nowMs;
            const simStartMs = performance.now();

            if (paused) {
                perfStats.simSteps = 0;
                perfStats.simMs = 0;
                renderAlpha = 1;
                interpolatedViewport.x = viewport.x;
                interpolatedViewport.y = viewport.y;
            } else {
                simAccumulatorMs += frameDeltaMs;
                let simSteps = 0;

                while (simAccumulatorMs >= simStepMs && simSteps < maxSimStepsPerFrame) {
                    previousViewport.x = viewport.x;
                    previousViewport.y = viewport.y;
                    if (wizard) {
                        wizard.prevX = wizard.x;
                        wizard.prevY = wizard.y;
                    }
                    runSimulationStep();
                    simAccumulatorMs -= simStepMs;
                    simSteps++;
                }

                if (simSteps === maxSimStepsPerFrame && simAccumulatorMs >= simStepMs) {
                    simAccumulatorMs = simStepMs; // prevent runaway catch-up stutter
                }

                perfStats.simSteps = simSteps;
                if (typeof globalThis !== "undefined") {
                    globalThis.simPerfBreakdown = {
                        steps: simPerfBreakdown.steps,
                        totalMs: simPerfBreakdown.totalMs,
                        maxStepMs: simPerfBreakdown.maxStepMs,
                        aimSyncMs: simPerfBreakdown.aimSyncMs,
                        facingMs: simPerfBreakdown.facingMs,
                        movementMs: simPerfBreakdown.movementMs,
                        collisionMs: simPerfBreakdown.collisionMs,
                        pointerPostMs: simPerfBreakdown.pointerPostMs,
                        maxAimSyncMs: simPerfBreakdown.maxAimSyncMs,
                        maxFacingMs: simPerfBreakdown.maxFacingMs,
                        maxMovementMs: simPerfBreakdown.maxMovementMs,
                        maxCollisionMs: simPerfBreakdown.maxCollisionMs,
                        maxPointerPostMs: simPerfBreakdown.maxPointerPostMs,
                        accumulatorMs: simAccumulatorMs
                    };
                }
                simPerfBreakdown.steps = 0;
                simPerfBreakdown.totalMs = 0;
                simPerfBreakdown.maxStepMs = 0;
                simPerfBreakdown.aimSyncMs = 0;
                simPerfBreakdown.facingMs = 0;
                simPerfBreakdown.movementMs = 0;
                simPerfBreakdown.collisionMs = 0;
                simPerfBreakdown.pointerPostMs = 0;
                simPerfBreakdown.maxAimSyncMs = 0;
                simPerfBreakdown.maxFacingMs = 0;
                simPerfBreakdown.maxMovementMs = 0;
                simPerfBreakdown.maxCollisionMs = 0;
                simPerfBreakdown.maxPointerPostMs = 0;
                renderAlpha = Math.max(0, Math.min(1, simAccumulatorMs / simStepMs));
                interpolatedViewport.x = previousViewport.x + (viewport.x - previousViewport.x) * renderAlpha;
                interpolatedViewport.y = previousViewport.y + (viewport.y - previousViewport.y) * renderAlpha;
                perfStats.simMs = performance.now() - simStartMs;
            }
            if (paused) {
                perfStats.simMs = 0;
            }

            // Use a scheduled present clock so frame pacing does not alias between 60/120.
            const debugRenderCapActive = !!debugMode;
            const effectiveRenderMaxFps = debugRenderCapActive ? debugRenderMaxFps : renderMaxFps;
            const renderIntervalMs = effectiveRenderMaxFps > 0 ? (1000 / effectiveRenderMaxFps) : 0;

            if (renderIntervalMs > 0) {
                if (nextPresentAtMs === 0) {
                    nextPresentAtMs = nowMs;
                }

                if ((nowMs + 0.25) < nextPresentAtMs) {
                    requestAnimationFrame(renderFrame);
                    return;
                }

                const latenessMs = nowMs - nextPresentAtMs;
                if (latenessMs > renderIntervalMs * 4) {
                    nextPresentAtMs = nowMs;
                } else {
                    nextPresentAtMs += renderIntervalMs;
                }
            } else {
                nextPresentAtMs = nowMs;
            }

            const presentedDeltaMs = lastPresentedMs > 0
                ? (nowMs - lastPresentedMs)
                : (renderIntervalMs > 0 ? renderIntervalMs : 0);
            lastPresentedMs = nowMs;
            perfStats.loopMs = presentedDeltaMs;
            perfStats.fps = presentedDeltaMs > 0 ? 1000 / presentedDeltaMs : 0;
            const drawStart = performance.now();
            renderNowMs = nowMs;
            if (pointerLockActive) {
                if (!isVirtualCursorOverMenuArea()) {
                    // Reproject lock-mode aim every render frame using the interpolated camera
                    // to keep cursor motion smooth while the viewport drifts.
                    syncMouseScreenFromWorldWithViewport(true);
                    clampVirtualCursorToCanvas(1);
                }
            }
            drawCanvas();
            perfStats.drawMs = performance.now() - drawStart;
            perfStats.idleMs = Math.max(0, perfStats.loopMs - perfStats.simMs - perfStats.drawMs);
            const panelNow = performance.now();
            if (showPerfReadout && perfPanel && panelNow - perfStats.lastUiUpdateAt > 200) {
                const losVisibleObjects = (typeof globalThis !== "undefined" && Array.isArray(globalThis.losDebugVisibleObjects))
                    ? globalThis.losDebugVisibleObjects
                    : [];
                const losBreakdown = (typeof globalThis !== "undefined" && globalThis.losDebugBreakdown)
                    ? globalThis.losDebugBreakdown
                    : null;
                const losBuildMs = (losBreakdown && Number.isFinite(losBreakdown.buildMs)) ? losBreakdown.buildMs : 0;
                const losTraceMs = (losBreakdown && Number.isFinite(losBreakdown.traceMs)) ? losBreakdown.traceMs : 0;
                const losTotalMs = (losBreakdown && Number.isFinite(losBreakdown.totalMs))
                    ? losBreakdown.totalMs
                    : ((typeof globalThis !== "undefined" && Number.isFinite(globalThis.losDebugLastMs)) ? globalThis.losDebugLastMs : 0);
                const losRecomputed = !!(losBreakdown && losBreakdown.recomputed);
                const losCandidates = (losBreakdown && Number.isFinite(losBreakdown.candidates))
                    ? losBreakdown.candidates
                    : 0;
                const losSummary =
                    `\nlos ${losTotalMs.toFixed(2)} ms${losRecomputed ? "" : " (cached)"}` +
                    `\n  b ${losBuildMs.toFixed(2)} t ${losTraceMs.toFixed(2)} vis ${losVisibleObjects.length} cand ${losCandidates}`;
                const drawBreakdown = (typeof globalThis !== "undefined" && globalThis.drawPerfBreakdown)
                    ? globalThis.drawPerfBreakdown
                    : null;
                const simBreakdown = (typeof globalThis !== "undefined" && globalThis.simPerfBreakdown)
                    ? globalThis.simPerfBreakdown
                    : null;
                const cpuMs = perfStats.simMs + perfStats.drawMs;
                const drawBuckets = drawBreakdown
                    ? (
                        `\ndrawb lz ${Number(drawBreakdown.lazyMs || 0).toFixed(2)}` +
                        ` pr ${Number(drawBreakdown.prepMs || 0).toFixed(2)}` +
                        ` co ${Number(drawBreakdown.collectMs || 0).toFixed(2)}` +
                        ` lo ${Number(drawBreakdown.losMs || 0).toFixed(2)}` +
                        ` cp ${Number(drawBreakdown.composeMs || 0).toFixed(2)}`
                    )
                    : "";
                const drawCounts = drawBreakdown
                    ? (
                        `\nobjs ${Number(drawBreakdown.mapItems || 0)}` +
                        ` on ${Number(drawBreakdown.onscreen || 0)}` +
                        ` hyd r${Number(drawBreakdown.hydratedRoads || 0)}` +
                        ` t${Number(drawBreakdown.hydratedTrees || 0)}`
                    )
                    : "";
                const simBuckets = simBreakdown
                    ? (
                        `\nsimb a ${Number(simBreakdown.aimSyncMs || 0).toFixed(2)}` +
                        ` f ${Number(simBreakdown.facingMs || 0).toFixed(2)}` +
                        ` m ${Number(simBreakdown.movementMs || 0).toFixed(2)}` +
                        ` c ${Number(simBreakdown.collisionMs || 0).toFixed(2)}` +
                        ` p ${Number(simBreakdown.pointerPostMs || 0).toFixed(2)}`
                    )
                    : "";
                const simMeta = simBreakdown
                    ? (
                        `\nstepmx ${Number(simBreakdown.maxStepMs || 0).toFixed(2)}` +
                        ` acc ${Number(simBreakdown.accumulatorMs || 0).toFixed(1)}`
                    )
                    : "";
                const simMaxBuckets = simBreakdown
                    ? (
                        `\nstepb a ${Number(simBreakdown.maxAimSyncMs || 0).toFixed(2)}` +
                        ` f ${Number(simBreakdown.maxFacingMs || 0).toFixed(2)}` +
                        ` m ${Number(simBreakdown.maxMovementMs || 0).toFixed(2)}` +
                        ` c ${Number(simBreakdown.maxCollisionMs || 0).toFixed(2)}` +
                        ` p ${Number(simBreakdown.maxPointerPostMs || 0).toFixed(2)}`
                    )
                    : "";
                perfPanel.text(
                    `FPS ${perfStats.fps.toFixed(1)}\n` +
                    `loop ${perfStats.loopMs.toFixed(1)} ms\n` +
                    `cpu ${cpuMs.toFixed(1)} ms\n` +
                    `simms ${perfStats.simMs.toFixed(1)} ms\n` +
                    `draw ${perfStats.drawMs.toFixed(1)} ms\n` +
                    `idle ${perfStats.idleMs.toFixed(1)} ms\n` +
                    `sim ${perfStats.simSteps}\n` +
                    `target ${frameRate}` +
                    simBuckets +
                    simMeta +
                    simMaxBuckets +
                    (effectiveRenderMaxFps > 0 ? ` / render ${effectiveRenderMaxFps}` : "") +
                    drawBuckets +
                    drawCounts +
                    losSummary
                );
                perfStats.lastUiUpdateAt = panelNow;
            }
            requestAnimationFrame(renderFrame);
        }

        requestAnimationFrame(renderFrame);
    });

    wizard = new Wizard({x: mapWidth/2, y: mapHeight/2}, map);
    sizeView();
    centerViewport(wizard, 0, 0);
    clearOnScreenObjects();
    
    // Create roof preview
    roof = new Roof(0, 0, 0);
    if (typeof setVisibilityMaskSources === "function") {
        setVisibilityMaskSources([() => {
            if (!roof || !roof.placed || !roof.groundPlaneHitbox || !wizard) return null;
            if (typeof roof.groundPlaneHitbox.containsPoint !== "function") return null;
            const wizardUnderRoof = roof.groundPlaneHitbox.containsPoint(wizard.x, wizard.y);
            return wizardUnderRoof ? roof.groundPlaneHitbox : null;
        }]);
    }
    if (typeof setVisibilityMaskEnabled === "function") {
        setVisibilityMaskEnabled(true);
    }
    SpellSystem.startMagicInterval(wizard);
    
    // Initialize status bar updates
    setInterval(() => {
        if (wizard) wizard.updateStatusBars();
    }, 100);
    SpellSystem.initWizardSpells(wizard);

    $("#selectedSpell").click(() => {
        const wasHidden = $("#spellMenu").hasClass('hidden');
        if ($("#spellMenu").hasClass('hidden') && typeof SpellSystem !== "undefined" && typeof SpellSystem.showMainSpellMenu === "function") {
            SpellSystem.showMainSpellMenu(wizard);
        }
        $("#spellMenu").toggleClass('hidden');
        const nowHidden = $("#spellMenu").hasClass('hidden');
        if (nowHidden) {
            clearSpellMenuKeyboardFocus();
        } else if (wasHidden) {
            initSpellMenuKeyboardFocus();
        }
    });

    $("#selectedAura").click(() => {
        const wasHidden = $("#auraMenu").hasClass("hidden");
        $("#auraMenu").toggleClass("hidden");
        if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.refreshAuraSelector === "function") {
            SpellSystem.refreshAuraSelector(wizard);
        }
        const nowHidden = $("#auraMenu").hasClass("hidden");
        if (nowHidden) {
            clearAuraMenuKeyboardFocus();
        } else if (wasHidden) {
            initAuraMenuKeyboardFocus();
        }
    });

    $("#selectedSpell").on("contextmenu", event => {
        if (
            wizard &&
            wizard.currentSpell === "wall" &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.showWallMenu === "function"
        ) {
            event.preventDefault();
            SpellSystem.showWallMenu(wizard);
            return;
        }
        if (
            wizard &&
            wizard.currentSpell === "buildroad" &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.showFlooringMenu === "function"
        ) {
            event.preventDefault();
            SpellSystem.showFlooringMenu(wizard);
            return;
        }
        if (
            wizard &&
            wizard.currentSpell === "treegrow" &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.showTreeMenu === "function"
        ) {
            event.preventDefault();
            SpellSystem.showTreeMenu(wizard);
            return;
        }
        if (
            wizard &&
            wizard.currentSpell === "placeobject" &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.showPlaceableMenu === "function"
        ) {
            event.preventDefault();
            SpellSystem.showPlaceableMenu(wizard);
        }
    });

    app.view.addEventListener("click", () => {
        if (suppressNextCanvasMenuClose) {
            suppressNextCanvasMenuClose = false;
            return;
        }
        $("#spellMenu").addClass('hidden');
        $("#auraMenu").addClass('hidden');
        clearSpellMenuKeyboardFocus();
        clearAuraMenuKeyboardFocus();
    });

    app.view.addEventListener("mousemove", event => {
        mousePos.clientX = event.clientX;
        mousePos.clientY = event.clientY;
        if (pointerLockActive) {
            ensurePointerLockAimInitialized();
            const dx = (Number(event.movementX) || 0) * pointerLockSensitivity;
            const dy = (Number(event.movementY) || 0) * pointerLockSensitivity;
            if (isVirtualCursorOverMenuArea()) {
                // Keep menu interaction stable in screen space while locked.
                if (!Number.isFinite(mousePos.screenX)) mousePos.screenX = app.screen.width * 0.5;
                if (!Number.isFinite(mousePos.screenY)) mousePos.screenY = app.screen.height * 0.5;
                mousePos.screenX += dx;
                mousePos.screenY += dy;
                clampVirtualCursorToCanvas(1);
                syncMouseWorldFromScreenWithViewport();
                const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
                pointerLockAimWorld.x = normalized.x;
                pointerLockAimWorld.y = normalized.y;
            } else {
                pointerLockAimWorld.x += dx / viewscale;
                pointerLockAimWorld.y += dy / (viewscale * xyratio);
                const normalized = normalizeAimWorldPointForWizard(pointerLockAimWorld.x, pointerLockAimWorld.y);
                pointerLockAimWorld.x = normalized.x;
                pointerLockAimWorld.y = normalized.y;
                mousePos.worldX = normalized.x;
                mousePos.worldY = normalized.y;
                syncMouseScreenFromWorldWithViewport();
                if (clampVirtualCursorToCanvas(1)) {
                    syncMouseWorldFromScreenWithViewport();
                    const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
                    pointerLockAimWorld.x = normalized.x;
                    pointerLockAimWorld.y = normalized.y;
                }
            }
        } else {
            let rect = app.view.getBoundingClientRect();
            const screenX = event.clientX - rect.left;
            const screenY = event.clientY - rect.top;
            // Store screen coordinates for cursor
            mousePos.screenX = screenX;
            mousePos.screenY = screenY;
            // Store exact world coordinates for pixel-accurate aiming
            const worldCoors = screenToWorld(screenX, screenY);
            const normalized = normalizeAimWorldPointForWizard(worldCoors.x, worldCoors.y);
            mousePos.worldX = normalized.x;
            mousePos.worldY = normalized.y;
        }

        // Also store hex tile for movement
        if (Number.isFinite(mousePos.screenX) && Number.isFinite(mousePos.screenY)) {
            const dest = screenToHex(mousePos.screenX, mousePos.screenY);
            mousePos.x = dest.x;
            mousePos.y = dest.y;
        }

        // Update cursor immediately (don't wait for render loop)
        updateCursor();

        if (
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.updateDragPreview === "function"
        ) {
            SpellSystem.updateDragPreview(wizard, mousePos.worldX, mousePos.worldY);
        }
    })

    let lastPlaceScaleMessageMs = 0;
    app.view.addEventListener("wheel", event => {
        if (
            !wizard ||
            wizard.currentSpell !== "placeobject" ||
            typeof SpellSystem === "undefined" ||
            typeof SpellSystem.adjustPlaceableScale !== "function"
        ) {
            return;
        }
        const overMenu = pointerLockActive
            ? isVirtualCursorOverMenuArea()
            : !!(event.target && typeof event.target.closest === "function" && event.target.closest("#spellMenu, #selectedSpell, #spellSelector, #auraMenu, #selectedAura, #auraSelector, #activeAuraIcons, #statusBars"));
        if (overMenu) return;

        event.preventDefault();
        let deltaPixels = Number(event.deltaY) || 0;
        if (!Number.isFinite(deltaPixels) || deltaPixels === 0) return;
        if (event.deltaMode === 1) {
            // Convert line-based wheel deltas to pixel-ish units.
            deltaPixels *= 16;
        } else if (event.deltaMode === 2) {
            // Convert page-based deltas.
            deltaPixels *= Math.max(200, window.innerHeight || 800);
        }
        // Continuous scaling from wheel input: negative scroll grows, positive shrinks.
        const unclampedDelta = -deltaPixels * 0.0015;
        const delta = Math.max(-0.05, Math.min(0.05, unclampedDelta));
        if (Math.abs(delta) < 0.0005) return;

        const next = SpellSystem.adjustPlaceableScale(wizard, delta);
        if (Number.isFinite(next)) {
            const now = performance.now();
            if (now - lastPlaceScaleMessageMs >= 90) {
                message(`Place scale: ${next.toFixed(2)}x`);
                lastPlaceScaleMessageMs = now;
            }
        }
    }, { passive: false });

    app.view.addEventListener("mousedown", event => {
        if (pointerLockActive) {
            const hovered = getVirtualCursorHoveredElement();
            const selectedSpellEl = hovered && typeof hovered.closest === "function"
                ? hovered.closest("#selectedSpell")
                : null;
            const selectedAuraEl = hovered && typeof hovered.closest === "function"
                ? hovered.closest("#selectedAura, #activeAuraIcons")
                : null;
            const menuInteractiveEl = hovered && typeof hovered.closest === "function"
                ? hovered.closest("#spellMenu .spellIcon, #spellMenu button, #spellMenu input, #spellMenu label, #auraMenu .auraIcon, #auraMenu button, #auraMenu input, #auraMenu label")
                : null;
            const forwardTarget = menuInteractiveEl || selectedSpellEl || selectedAuraEl;
            const isRightClick = (event.button === 2);
            if (forwardTarget) {
                event.preventDefault();
                event.stopPropagation();
                if (isRightClick) {
                    suppressNextCanvasMenuClose = true;
                    forwardTarget.dispatchEvent(new MouseEvent("contextmenu", {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    }));
                } else {
                    suppressNextCanvasMenuClose = true;
                    forwardTarget.dispatchEvent(new MouseEvent("click", {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    }));
                }
                return;
            }
        }
        if (!pointerLockActive) {
            requestGameplayPointerLock(event);
        }
        if (
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.beginDragSpell === "function" &&
            (wizard.currentSpell === "wall" || wizard.currentSpell === "buildroad" || wizard.currentSpell === "firewall")
        ) {
            event.preventDefault();
            const worldCoors = (pointerLockActive && Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY))
                ? {x: mousePos.worldX, y: mousePos.worldY}
                : (() => {
                    const rect = app.view.getBoundingClientRect();
                    const screenX = event.clientX - rect.left;
                    const screenY = event.clientY - rect.top;
                    return screenToWorld(screenX, screenY);
                })();
            SpellSystem.beginDragSpell(wizard, wizard.currentSpell, worldCoors.x, worldCoors.y);
            return;
        }
    });

    app.view.addEventListener("mouseup", event => {
        if (
            !wizard ||
            typeof SpellSystem === "undefined" ||
            typeof SpellSystem.completeDragSpell !== "function" ||
            typeof SpellSystem.isDragSpellActive !== "function" ||
            !SpellSystem.isDragSpellActive(wizard, wizard.currentSpell)
        ) return;

        event.preventDefault();
        const worldCoors = (pointerLockActive && Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY))
            ? {x: mousePos.worldX, y: mousePos.worldY}
            : (() => {
                const rect = app.view.getBoundingClientRect();
                const screenX = event.clientX - rect.left;
                const screenY = event.clientY - rect.top;
                return screenToWorld(screenX, screenY);
            })();
        SpellSystem.completeDragSpell(wizard, wizard.currentSpell, worldCoors.x, worldCoors.y);
    });

    app.view.addEventListener("click", event => {
        if (keysPressed[' ']) {
            if (wizard.currentSpell === "treegrow") {
                event.preventDefault();
                return;
            }
            event.preventDefault();
            const worldCoors = (pointerLockActive && Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY))
                ? {x: mousePos.worldX, y: mousePos.worldY}
                : (() => {
                    const rect = app.view.getBoundingClientRect();
                    const screenX = event.clientX - rect.left;
                    const screenY = event.clientY - rect.top;
                    return screenToWorld(screenX, screenY);
                })();
            const aim = getWizardAimVectorTo(worldCoors.x, worldCoors.y);
            // Stop wizard movement by setting destination to current node
            wizard.destination = null;
            wizard.path = [];
            wizard.travelFrames = 0;
            // Turn and cast at exact click coordinates.
            wizard.turnToward(aim.x, aim.y);
            if (wizard.currentSpell === "wall") return;
            SpellSystem.castWizardSpell(wizard, aim.worldX, aim.worldY);
            // Prevent keyup quick-cast from firing a duplicate cast.
            spacebarDownAt = null;
        }
    })
     
    $("#msg").contextmenu(event => event.preventDefault())
    $(document).keydown(event => {
        const keyLower = event.key.toLowerCase();
        const spellMenuVisible = !$("#spellMenu").hasClass("hidden");
        const auraMenuVisible = !$("#auraMenu").hasClass("hidden");

        if (event.ctrlKey && keyLower === "f") {
            event.preventDefault();
            showPerfReadout = !showPerfReadout;
            if (perfPanel) {
                perfPanel.css("display", showPerfReadout ? "block" : "none");
            }
            return;
        }

        if (event.key === "Tab") {
            event.preventDefault();
            if (event.shiftKey) {
                if (spellMenuVisible) {
                    $("#spellMenu").addClass("hidden");
                    clearSpellMenuKeyboardFocus();
                    if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.refreshAuraSelector === "function") {
                        SpellSystem.refreshAuraSelector(wizard);
                    }
                    $("#auraMenu").removeClass("hidden");
                    initAuraMenuKeyboardFocus();
                } else if (auraMenuVisible) {
                    $("#auraMenu").addClass("hidden");
                    clearAuraMenuKeyboardFocus();
                } else {
                    if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.refreshAuraSelector === "function") {
                        SpellSystem.refreshAuraSelector(wizard);
                    }
                    $("#auraMenu").removeClass("hidden");
                    initAuraMenuKeyboardFocus();
                }
            } else if (auraMenuVisible) {
                $("#auraMenu").addClass("hidden");
                clearAuraMenuKeyboardFocus();
                if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.showMainSpellMenu === "function") {
                    SpellSystem.showMainSpellMenu(wizard);
                }
                $("#spellMenu").removeClass("hidden");
                initSpellMenuKeyboardFocus();
            } else if (spellMenuVisible) {
                $("#spellMenu").addClass("hidden");
                $("#auraMenu").addClass("hidden");
                clearSpellMenuKeyboardFocus();
                clearAuraMenuKeyboardFocus();
            } else if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.showMainSpellMenu === "function") {
                SpellSystem.showMainSpellMenu(wizard);
                $("#spellMenu").removeClass("hidden");
                initSpellMenuKeyboardFocus();
            }
            return;
        }

        if (event.key === "Escape" && (spellMenuVisible || auraMenuVisible)) {
            event.preventDefault();
            $("#spellMenu").addClass("hidden");
            $("#auraMenu").addClass("hidden");
            clearSpellMenuKeyboardFocus();
            clearAuraMenuKeyboardFocus();
            return;
        }

        if (spellMenuVisible && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            if (event.key === "ArrowLeft") moveSpellMenuKeyboardFocus(-1, 0);
            if (event.key === "ArrowRight") moveSpellMenuKeyboardFocus(1, 0);
            if (event.key === "ArrowUp") moveSpellMenuKeyboardFocus(0, -1);
            if (event.key === "ArrowDown") moveSpellMenuKeyboardFocus(0, 1);
            return;
        }

        if (auraMenuVisible && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            if (event.key === "ArrowLeft") moveAuraMenuKeyboardFocus(-1, 0);
            if (event.key === "ArrowRight") moveAuraMenuKeyboardFocus(1, 0);
            if (event.key === "ArrowUp") moveAuraMenuKeyboardFocus(0, -1);
            if (event.key === "ArrowDown") moveAuraMenuKeyboardFocus(0, 1);
            return;
        }

        if (spellMenuVisible && (
            event.key === "Shift" ||
            event.key === "Control" ||
            event.key === "Alt" ||
            event.key === "Meta" ||
            event.key === "ContextMenu"
        )) {
            event.preventDefault();
            openFocusedSpellSubmenu();
            return;
        }

        if (spellMenuVisible && (event.key === "Enter" || event.key === " " || event.code === "Space")) {
            event.preventDefault();
            spacebarDownAt = null;
            const activation = activateSelectedSpellFromMenu();
            if (activation.activated && activation.shouldCloseMenu) {
                $("#spellMenu").addClass("hidden");
                clearSpellMenuKeyboardFocus();
            } else if (activation.activated) {
                initSpellMenuKeyboardFocus();
            }
            return;
        }

        if (auraMenuVisible && (event.key === "Enter" || event.key === " " || event.code === "Space")) {
            event.preventDefault();
            spacebarDownAt = null;
            const activation = activateSelectedAuraFromMenu();
            if (activation.activated) {
                initAuraMenuKeyboardFocus();
            }
            return;
        }

        // Track key state
        keysPressed[keyLower] = true;

        // Combo binding: F+W selects Firewall spell.
        if (
            wizard &&
            keysPressed['f'] &&
            keysPressed['w'] &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.setCurrentSpell === "function"
        ) {
            SpellSystem.setCurrentSpell(wizard, "firewall");
            return;
        }

        const isPlusKey = (event.key === "+") || (event.code === "NumpadAdd") || (event.code === "Equal" && event.shiftKey);
        const isMinusKey = (event.key === "-") || (event.code === "NumpadSubtract");
        if (
            wizard &&
            wizard.currentSpell === "placeobject" &&
            (isPlusKey || isMinusKey) &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.adjustPlaceableRenderOffset === "function"
        ) {
            event.preventDefault();
            if (!event.repeat) {
                const delta = isPlusKey ? 0.1 : -0.1;
                const next = SpellSystem.adjustPlaceableRenderOffset(wizard, delta);
                if (Number.isFinite(next)) {
                    const sign = next >= 0 ? "+" : "";
                    message(`Place depth offset: ${sign}${next.toFixed(1)}`);
                }
            }
            return;
        }

        if (event.key === " " || event.code === "Space") {
            event.preventDefault();
            if (!event.repeat) {
                spacebarDownAt = Date.now();
                if (
                    wizard &&
                    wizard.currentSpell === "treegrow" &&
                    mousePos.worldX !== undefined &&
                    mousePos.worldY !== undefined
                ) {
                    const aim = getWizardAimVectorTo(mousePos.worldX, mousePos.worldY);
                    wizard.turnToward(aim.x, aim.y);
                    SpellSystem.castWizardSpell(wizard, aim.worldX, aim.worldY);
                }
            }
        } else if ((event.key === "a" || event.key === "A") && !event.repeat) {
            if (wizard && typeof wizard.startJump === "function") {
                wizard.startJump();
            }
        } else if ((event.key === "o" || event.key === "O") && !event.repeat) {
            event.preventDefault();
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.toggleAura === "function") {
                SpellSystem.toggleAura(wizard, "omnivision");
            }
            return;
        } else if ((event.key === "p" || event.key === "P") && !event.repeat) {
            event.preventDefault();
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.toggleAura === "function") {
                SpellSystem.toggleAura(wizard, "speed");
            }
            return;
        } else if ((event.key === "h" || event.key === "H") && !event.repeat) {
            event.preventDefault();
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.toggleAura === "function") {
                SpellSystem.toggleAura(wizard, "healing");
            }
            return;
        } else if (Object.keys(spellKeyBindings).includes(event.key.toUpperCase())) {
            SpellSystem.setCurrentSpell(wizard, spellKeyBindings[event.key.toUpperCase()]);
        }
        
        // Toggle debug graphics with ctrl+d
        if ((event.key === 'd' || event.key === 'D') && event.ctrlKey) {
            event.preventDefault();
            debugMode = !debugMode;
            console.log('Debug mode:', debugMode ? 'ON' : 'OFF');
        }

        // Toggle hex grid only with 'g' key
        if (event.key === 'g' || event.key === 'G') {
            event.preventDefault();
            showHexGrid = !showHexGrid;
            console.log('Hex grid:', showHexGrid ? 'ON' : 'OFF');
        }

        // Save game to fixed server path with Ctrl+Shift+S
        if ((event.key === 's' || event.key === 'S') && event.ctrlKey && event.shiftKey) {
            event.preventDefault();
            if (typeof saveGameStateToServerFile === 'function') {
                saveGameStateToServerFile().then(result => {
                    if (result && result.ok) {
                        message('Saved to /assets/saves/savefile.json');
                    } else {
                        message('Failed to save file');
                        console.error('Failed to save file:', result);
                    }
                });
            } else {
                message('Server file save is unavailable');
            }
            return;
        }

        // Load game from fixed server path with Ctrl+Shift+L
        if ((event.key === 'l' || event.key === 'L') && event.ctrlKey && event.shiftKey) {
            event.preventDefault();
            if (typeof loadGameStateFromServerFile === 'function') {
                loadGameStateFromServerFile().then(result => {
                    if (result && result.ok) {
                        message('Loaded /assets/saves/savefile.json');
                        console.log('Game loaded from fixed save file');
                    } else {
                        const reason = (result && result.reason) ? String(result.reason) : 'unknown';
                        message(`Failed to load fixed save file (${reason})`);
                        console.error('Failed to load fixed save file:', result);
                        if (result && result.error) {
                            console.error('Fixed save load error detail:', result.error);
                        }
                    }
                });
            } else {
                message('Server file load is unavailable');
            }
            return;
        }

        // Save game with Ctrl+S
        if ((event.key === 's' || event.key === 'S') && event.ctrlKey) {
            event.preventDefault();
            const saveData = saveGameState();
            if (saveData) {
                localStorage.setItem('survivor_save', JSON.stringify(saveData));
                message('Game saved!');
                console.log('Game saved to localStorage');
            }
        }

        // Load game with Ctrl+L
        if ((event.key === 'l' || event.key === 'L') && event.ctrlKey) {
            event.preventDefault();
            const parsedSave = (typeof getSavedGameState === 'function')
                ? getSavedGameState()
                : { ok: false, reason: 'unavailable' };

            if (parsedSave.ok) {
                if (loadGameState(parsedSave.data)) {
                    message('Game loaded!');
                    console.log('Game loaded from localStorage');
                } else {
                    message('Failed to load game');
                }
            } else {
                if (parsedSave.reason === 'missing') {
                    message('No saved game found');
                } else {
                    localStorage.removeItem('survivor_save');
                    message('Save was invalid and has been reset');
                    console.error('Invalid save data:', parsedSave.reason, parsedSave.error || '');
                }
            }
        }
    })
    
    $(document).keyup(event => {
        // Track key state
        keysPressed[event.key.toLowerCase()] = false;
        if (event.key === " " || event.code === "Space") {
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.cancelDragSpell === "function") {
                SpellSystem.cancelDragSpell(wizard, "wall");
                SpellSystem.cancelDragSpell(wizard, "buildroad");
                SpellSystem.cancelDragSpell(wizard, "firewall");
            }
            SpellSystem.stopTreeGrowthChannel(wizard);
            if (wizard.currentSpell === "treegrow") {
                spacebarDownAt = null;
                event.preventDefault();
                return;
            }
            if (wizard.currentSpell === "wall") return;
            event.preventDefault();
            const now = Date.now();
            const downAt = spacebarDownAt;
            spacebarDownAt = null;

            if (downAt && (now - downAt) <= 250) {
                // Quick tap: cast immediately
                if (wizard && mousePos.worldX !== undefined && mousePos.worldY !== undefined) {
                    const aim = getWizardAimVectorTo(mousePos.worldX, mousePos.worldY);
                    wizard.turnToward(aim.x, aim.y);
                    SpellSystem.castWizardSpell(wizard, aim.worldX, aim.worldY);
                }
            }
        }
    })

})

// Rendering and utility helpers moved to rendering.js
