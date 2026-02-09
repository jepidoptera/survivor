const mapWidth = 400;
const mapHeight = 400;
let frameRate = 60;
let frameCount = 0;
const animationSpeedMultiplier = 0.75; // Adjustable: lower = faster, higher = slower
const wizardDirectionRowOffset = 0; // 0 when row 0 faces left. Adjust to align sprite sheet rows.
let debugMode = false; // Toggle all debug graphics (hitboxes, grid, animal markers)
let showHexGrid = false; // Toggle hex grid only (g key)
let showBlockedNeighbors = false; // Toggle display of blocked neighbor connections

let viewport = {width: 0, height: 0, innerWindow: {width: 0, height: 0}, x: 488, y: 494}
let viewScale = 1;
let xyratio = 0.66; // Adjust for isometric scaling (height/width ratio)
let projectiles = [];
let animals = [];
let mousePos = {x: 0, y: 0};
var messages = [];
let keysPressed = {}; // Track which keys are currently pressed
let spacebarDownAt = null;
let spellKeyBindings = {
    "F": "fireball",
    "B": "wall",
    "V": "vanish",
    "T": "treegrow",
    "R": "buildroad"
}

let textures = {};
let fireFrames = null;

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
gameContainer.addChild(cursorLayer);

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
let roadTileSprite = null;
let roadMaskGraphics = null;
const roadRepeatWorldUnits = 1;
const roadTextureRotation = 10 * Math.PI / 180;
const roadLayerOversize = 1.5;
const roadWidth = 1.5;

// Load sprite sheets before starting game
PIXI.Loader.shared
    .add('/assets/spritesheet/bear.json')
    .add('/assets/spritesheet/deer.json')
    .add('/assets/spritesheet/squirrel.json')
    .add('/assets/images/runningman.png')
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
    
    console.log("Pixi assets loaded successfully");
}

function initRoadLayer() {
    const texture = PIXI.Texture.from('/assets/images/dirt.jpg');
    if (texture && texture.baseTexture) {
        texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
        texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
    }

    if (!roadTileSprite) {
        roadTileSprite = new PIXI.TilingSprite(
            texture,
            app.screen.width * roadLayerOversize,
            app.screen.height * roadLayerOversize
        );
        const oversizeOffsetX = (roadTileSprite.width - app.screen.width) / 2;
        const oversizeOffsetY = (roadTileSprite.height - app.screen.height) / 2;
        roadTileSprite.x = -oversizeOffsetX;
        roadTileSprite.y = -oversizeOffsetY;
        roadTileSprite.tileTransform.rotation = roadTextureRotation;
        roadLayer.addChild(roadTileSprite);
    }

    if (!roadMaskGraphics) {
        roadMaskGraphics = new PIXI.Graphics();
        roadLayer.addChild(roadMaskGraphics);
        roadTileSprite.mask = roadMaskGraphics;
    }

    if (texture && texture.baseTexture && !texture.baseTexture.valid) {
        texture.baseTexture.once('loaded', () => {
            initRoadLayer();
        });
    }
}

class Spell {
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
                if (this.pixiSprite) {
                    projectileLayer.removeChild(this.pixiSprite);
                    this.pixiSprite = null;
                }
            }, 3000);
            clearInterval(this.castInterval);
        }
    }
    land() {
    }
}

class Grenade extends Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/grenade.png";
        this.altimage = document.createElement('img');
        this.altimage.src = "./assets/images/explosion.png";
        this.explosionFrame = 0;
        this.explosionFrames = null;
        this.isExploding = false;
        this.delayTime = 2;
    }
    land() {
        if (this.bounced === this.bounces) setTimeout(() => {
            this.isExploding = true;
            this.explosionFrame = 0;
            
            // Load explosion spritesheet frames (5x2)
            if (!this.explosionFrames) {
                const baseTexture = PIXI.Texture.from(this.altimage.src).baseTexture;
                this.explosionFrames = [];
                const frameWidth = baseTexture.width / 5;
                const frameHeight = baseTexture.height / 2;
                
                // Row 1 (frames 0-4)
                for (let col = 0; col < 5; col++) {
                    this.explosionFrames.push(
                        new PIXI.Texture(baseTexture, new PIXI.Rectangle(col * frameWidth, 0, frameWidth, frameHeight))
                    );
                }
                // Row 2 (frames 5-9)
                for (let col = 0; col < 5; col++) {
                    this.explosionFrames.push(
                        new PIXI.Texture(baseTexture, new PIXI.Rectangle(col * frameWidth, frameHeight, frameWidth, frameHeight))
                    );
                }
            }
            
            this.explodeInterval = setInterval(() => {
                if (paused) return;
                this.explosionFrame++;
                if (this.explosionFrame >= this.explosionFrames.length) {
                    clearInterval(this.explodeInterval);
                    this.visible = false;
                    if (this.pixiSprite) {
                        projectileLayer.removeChild(this.pixiSprite);
                        this.pixiSprite = null;
                    }
                }
            }, 50);
            this.apparentSize = 80;
            animals.forEach((animal, n) => {
                let margin = 4;
                if (animal._onScreen && !animal.dead) {
                    const targetCoors = worldToScreen(animal);
                    targetCoors.y += animal.height / 2;
                    targetCoors.x += animal.width / 2;
                    const dist = distance(this.x, this.y, targetCoors.x, targetCoors.y);
                    if (withinRadius(this.x, this.y, targetCoors.x, targetCoors.y, margin)) {
                        console.log('blast radius: ', dist);
                        let damage = Math.min(40 / dist / Math.max(dist - 1, 1), 40);
                        console.log('damage: ', damage);
                        animal.hp -= damage;
                        if (animal.hp <= 0) {
                            let messageText = `You killed: ${animal.type}!` 
                            if (animal.foodValue > 0) messageText += `  You gain ${animal.foodValue} food.`;
                            message(messageText);
                            wizard.food += animal.foodValue;
                            animal.explode(this.x, this.y - this.z);
                            saveGame();
                        }
                        else if (animal.chaseRadius > 0) animal.attack(wizard);
                    }
                    // all visible animals flee
                    if (animal.fleeRadius != 0 && !animal.attacking) animal.flee();
                }
            })
        }, 500);
    }
}

class Rock extends Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = `./assets/images/rock${Math.floor(Math.random() * 5)}.png`;
        this.range = 10;
        this.delayTime = 0.5;
    }
    land() {
        if (this.bounced === 0) {
            animals.forEach((animal, n) => {
                let margin = animal.size + .15;
                if (animal._onScreen && !animal.dead) {
                    const targetCoors = worldToScreen(animal);
                    targetCoors.y += animal.height / 2;
                    targetCoors.x += animal.width / 2;
                    if (withinRadius(this.x, this.y, targetCoors.x, targetCoors.y, margin)) {
                        animal.hp -= 1;
                        if (animal.hp <= 0) {
                            let messageText = `You killed: ${animal.type}!` 
                            if (animal.foodValue > 0) messageText += `  You gain ${animal.foodValue} food.`;
                            wizard.food += animal.foodValue;
                            message(messageText);
                            animal.die();
                            saveGame();
                        }
                        else {
                            // didn't die
                            let xmove = this.movement.x;
                            let ymove = this.movement.y;
                            // bounce off at 90 degrees
                            if (Math.random() > .5) {
                                xmove = -this.movement.y;
                                ymove = this.movement.x;
                            }
                            else {
                                xmove = this.movement.y;
                                ymove = -this.movement.x;
                            }
                            this.movement.x = xmove * 2;
                            this.movement.y = ymove * 2;
                            if (animal.fleeRadius > 0) {
                                animal.flee();
                            }
                            else if (animal.chaseRadius > 0) {
                                animal.attack(wizard);
                            }
                        }
                    }
                }
            })
        }
    }
}

class Fireball extends Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/fireball.png";
        this.gravity = 0; // No arc - straight line
        this.speed = 5;
        this.range = 10;
        this.bounces = 0;
        this.apparentSize = 60;
        this.explosionFrame = 0;
        this.explosionFrames = null;
        this.isAnimating = true;
        this.damageRadius = 0.75;
        this.delayTime = 0.5;
        this.radius = this.damageRadius;
    }
    cast(targetX, targetY) {
        // check magic
        if (wizard.magic < 10) {
            message("Not enough magic to cast Fireball!");
            return this;
        }
        wizard.magic -= 10;
        // Load explosion spritesheet frames (5x2)
        const baseTexture = PIXI.Texture.from(this.image.src).baseTexture;
        if (!baseTexture.valid) {
            this.visible = false;
            if (!this._pendingCast) {
                this._pendingCast = {targetX, targetY};
                baseTexture.once('loaded', () => {
                    if (this._pendingCast) {
                        const {targetX: pendingX, targetY: pendingY} = this._pendingCast;
                        this._pendingCast = null;
                        this.visible = true;
                        this.cast(pendingX, pendingY);
                    }
                });
            }
            return this;
        }
        this.explosionFrames = [];
        const frameWidth = baseTexture.width / 5;
        const frameHeight = baseTexture.height / 2;
        
        // Row 1 (frames 0-4)
        for (let col = 0; col < 5; col++) {
            this.explosionFrames.push(
                new PIXI.Texture(baseTexture, new PIXI.Rectangle(col * frameWidth, 0, frameWidth, frameHeight))
            );
        }
        // Row 2 (frames 5-9)
        for (let col = 0; col < 5; col++) {
            this.explosionFrames.push(
                new PIXI.Texture(baseTexture, new PIXI.Rectangle(col * frameWidth, frameHeight, frameWidth, frameHeight))
            );
        }
        
        // For fireball, calculate distance to target and track progress
        this.targetX = targetX;
        this.targetY = targetY;
        this.traveledDist = 0;
        
        this.visible = true;
        this.x = wizard.x;
        this.y = wizard.y;
        this.z = 0;
        
        let xdist = targetX - this.x;
        let ydist = targetY - this.y;
        this.totalDist = distance(0, 0, xdist, ydist);

        this.x += (xdist / this.totalDist) * 0.5; // Start slightly away from wizard to avoid self-collision
        this.y += (ydist / this.totalDist) * 0.5;
        this.totalDist -= 0.5; // Adjust total distance accordingly

        this.movement = {
            x: xdist / this.totalDist * this.speed / frameRate,
            y: ydist / this.totalDist * this.speed / frameRate,
            z: 0,
        }
        
        // Prevent division by zero
        if (this.totalDist < 0.1) {
            this.totalDist = 0.1;
            xdist = 0.1;
            ydist = 0;
        }
        
        if (this.totalDist > this.range) {
            let fraction = this.range / this.totalDist;
            ydist *= fraction;
            xdist *= fraction;
            this.totalDist = this.range;
        }
                
        // Both animation and travel controlled by the same time basis
        const cycleDurationMs = 2000;
        const startX = this.x;
        const startY = this.y;
        this.travelStartTime = performance.now();
        this.travelPausedTime = 0;
        this._pausedAt = null;
        
        // Single interval: update both movement and animation based on elapsed time
        this.castInterval = setInterval(() => {
            if (paused) {
                if (!this._pausedAt) {
                    this._pausedAt = performance.now();
                }
                return;
            }
            if (this._pausedAt) {
                this.travelPausedTime += performance.now() - this._pausedAt;
                this._pausedAt = null;
            }
            
            const now = performance.now();
            const elapsedMs = now - this.travelStartTime - this.travelPausedTime;
            const progress = Math.min(elapsedMs / cycleDurationMs, 1);
            
            // Update animation frame based on same progress
            if (this.explosionFrames && this.explosionFrames.length > 0) {
                this.explosionFrame = Math.floor(progress * this.explosionFrames.length) % this.explosionFrames.length;
            }
            
            // Update position
            this.x+= this.movement.x;
            this.y += this.movement.y;
            this.traveledDist = this.totalDist * progress;
            
            // Check for continuous damage while moving
            this.land();
            
            // Check if reached target
            if (progress >= 1) {
                // Snap to exact target position before finishing
                this.visible = false;
                if (this.pixiSprite) {
                    projectileLayer.removeChild(this.pixiSprite);
                    this.pixiSprite = null;
                }
                clearInterval(this.castInterval);
            }
        }, 1000 / frameRate);
        return this;
    }
    land() {

        for (let obj of onscreenObjects) {
            if (!obj || obj.gone || obj.vanishing) continue;
            const visualHitbox = obj.visualHitbox || obj.hitbox;
            if (!visualHitbox) continue;
            if (obj.visualHitbox.intersects({type: "circle", x: this.x, y: this.y, radius: this.radius})) {
                // Don't re-ignite objects that are already dead
                if (obj.burned || obj.hp <= 0) {
                    continue;
                }
                if (!obj.hp) {
                    obj.hp = obj.maxHP || 100;
                    obj.maxHP = obj.hp;
                }
                obj.hp -= 0.1 * (obj.flamability || 1); // Damage per frame
                if (obj.hp < obj.maxHP) obj.isOnFire = true;
                const fireDuration = 5 * (obj.flamability || 1)
                obj.fireDuration = fireDuration * frameRate;
                obj.ignite(fireDuration);
            }
        }
    }
}


class Vanish extends Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/thumbnails/vanish.png";
        this.gravity = 0; // No arc - straight line
        this.speed = 10;
        this.range = 20;
        this.bounces = 0;
        this.apparentSize = 40;
        this.delayTime = 0;
        this.effectRadius = 0.5;
        this.magicCost = 5;
        this.radius = this.effectRadius;
    }
    
    cast(targetX, targetY) {
        // Check magic
        if (wizard.magic < 15) {
            message("Not enough magic to cast Vanish!");
            return this;
        }
        wizard.magic -= this.magicCost;
        
        this.visible = true;
        this.x = wizard.x;
        this.y = wizard.y;
        this.z = 0;
        
        let xdist = (targetX - this.x);
        let ydist = targetY - this.y;
        this.totalDist = distance(0, 0, xdist, ydist);
        
        // Prevent division by zero
        if (this.totalDist < 0.1) {
            this.totalDist = 0.1;
            xdist = 0.1;
            ydist = 0;
        }
        
        if (this.totalDist > this.range) {
            let fraction = this.range / this.totalDist;
            ydist *= fraction;
            xdist *= fraction;
            this.totalDist = this.range;
        }

        this.movement = {
            x: xdist / this.totalDist * this.speed / frameRate,
            y: ydist / this.totalDist * this.speed / frameRate,
            z: 0,
        }
        this.x += this.movement.x;
        this.y += this.movement.y;
        this.traveledDist = 0;
        
        this.castInterval = setInterval(() => {
            if (paused) return;
            this.x += this.movement.x;
            this.y += this.movement.y;
            this.traveledDist += Math.sqrt(this.movement.x ** 2 + this.movement.y ** 2);
            
            if (!this.forcedTarget) {
                // they didn't pinpoint a target, so this is a loose spell
                this.land();
            }

            // Check if reached target
            if (this.traveledDist >= this.totalDist) {
                // If cursor was over a staticObject, only hit that object
                if (this.forcedTarget) {
                    const obj = this.forcedTarget;
                    if (!obj.vanishing) {
                        this.vanishTarget(obj);
                    }
                    this.deactivate();
                    return;
                }
            }
        }, 1000 / frameRate);
        return this;
    }

    deactivate() {
        this.visible = false;
        if (this.pixiSprite) {
            projectileLayer.removeChild(this.pixiSprite);
            this.pixiSprite = null;
        }
        clearInterval(this.castInterval);
    }
    
    land() {
        // Check all onscreen objects
        for(let obj of onscreenObjects) {
            if (!obj || obj.gone || obj.vanishing) continue;
            if (obj.type === "road") continue;
            if (!obj.visualHitbox) continue;
            let hit = obj.visualHitbox.intersects({type: "circle", x: this.x, y: this.y, radius: this.radius});
            if (hit && !obj.vanishing) {
                this.vanishTarget(obj);
                this.deactivate();
            }
        }
    }
    
    vanishTarget(target) {
        // Mark as vanishing to avoid hitting multiple times
        target.vanishing = true;
        target.vanishStartTime = frameCount;
        target.vanishDuration = 0.25 * frameRate; // 1/4 second fade (after 1-frame flash)
        target.percentVanished = 0;
    }
}


class Arrow extends Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = `./assets/images/pointy arrow.png`;
        this.range = 12
        this.speed = 15
        this.bounces = 0
        this.gravity = .5
        this.type = "arrow"
        this.size = 50
    }
    bounce () {}
    land() {
        super.land()
        clearInterval(this.castInterval)
        animals.forEach((animal, n) => {
            let margin = animal.size
            if (animal._onScreen && !animal.dead) {
                const dist = distance(this.x, this.y, animal.center_x, animal.center_y);
                if (withinRadius(this.x, this.y, animal.center_x, animal.center_y, margin)) {
                    this.hurt(animal, 25 * (margin - dist) / margin)
                    this.x = animal.center_x
                    this.y = animal.center_y
                    if (animal.hp > 0) {
                        this.visible = false
                    }
                }
            }
        })
    }
}

class TreeGrow extends Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/thumbnails/tree.png";
        this.gravity = 0;
        this.speed = 0; // Instant placement, no travel
        this.range = 20;
        this.bounces = 0;
        this.apparentSize = 0;
        this.delayTime = 0;
        this.magicCost = 20;
        this.growthDuration = 2; // 2 seconds to grow
        this.radius = 0;
    }
    
    cast(targetX, targetY) {
        // Check magic
        if (wizard.magic < this.magicCost) {
            message("Not enough magic to cast Tree Grow!");
            return this;
        }
        wizard.magic -= this.magicCost;
        
        // Snap to nearest hex tile
        const targetNode = wizard.map.worldToNode(targetX, targetY);
        if (!targetNode) {
            message("Cannot grow tree there!");
            return this;
        }
        
        // Check if there's already an object at this location
        if (targetNode.objects && targetNode.objects.length > 0) {
            message("Something is already growing there!");
            return this;
        }
        
        // Load tree textures (5 variants like trees normally loaded)
        const treeTextures = [];
        for (let n = 0; n < 5; n++) {
            const texture = PIXI.Texture.from(`/assets/images/tree${n}.png`);
            treeTextures.push(texture);
        }
        
        // Create tree
        const newTree = new Tree({x: targetNode.x, y: targetNode.y}, treeTextures, wizard.map);
        
        // Store full dimensions for growth animation
        newTree.growthFullWidth = newTree.width;
        newTree.growthFullHeight = newTree.height;
        
        // Start at size 0
        newTree.width = 0;
        newTree.height = 0;
        
        // Mark tree as growing with animation properties
        newTree.isGrowing = true;
        newTree.growthStartFrame = frameCount;
        newTree.growthFrames = this.growthDuration * frameRate; // 2 seconds * 30fps = 60 frames
        
        // Deactivate this spell projectile immediately (tree is now placed)
        this.visible = false;
        if (this.pixiSprite) {
            projectileLayer.removeChild(this.pixiSprite);
            this.pixiSprite = null;
        }
        
        return this;
    }
}

class BuildRoad extends Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.gravity = 0;
        this.speed = 0; // Instant placement
        this.range = 20;
        this.bounces = 0;
        this.apparentSize = 0;
        this.delayTime = 0;
        this.magicCost = 5;
        this.radius = 0;
    }
    
    cast(targetX, targetY) {
        // Check magic
        if (wizard.magic < this.magicCost) {
            message("Not enough magic to cast Build Road!");
            return this;
        }
        wizard.magic -= this.magicCost;
        
        // Snap to nearest hex tile
        const targetNode = wizard.map.worldToNode(targetX, targetY);
        if (!targetNode) {
            message("Cannot place road there!");
            return this;
        }
        
        // Check if there's already road at this location
        if (targetNode.objects && targetNode.objects.some(obj => obj.type === 'road')) {
            message("Road already there!");
            return this;
        }
        
        // Create road (textures are generated dynamically in the constructor)
        const newRoad = new Road({x: targetNode.x, y: targetNode.y}, [], wizard.map);
        
        // Deactivate this spell projectile immediately
        this.visible = false;
        if (this.pixiSprite) {
            projectileLayer.removeChild(this.pixiSprite);
            this.pixiSprite = null;
        }
        
        return this;
    }
}

class Character {
    constructor(type, location, map) {
        this.type = type;
        this.map = map;
        this.z = 0;
        this.travelFrames = 0;
        this.moving = false;
        this.isOnFire = false;
        this.fireSprite = null;
        this.fireFrameIndex = 1;
        this.groundRadius = 0.35; // Default hitbox radius in hex units
        this.visualRadius = 0.5; // Default visual hitbox radius in hex units
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
        }
        if (this.groundPlaneHitbox) {
            this.groundPlaneHitbox.x = this.x;
            this.groundPlaneHitbox.y = this.y;
        }
    }
    
    nextMove() {
        return setTimeout(() => {this.move()}, 1000 / this.frameRate);
    }
    freeze() {
        clearTimeout(this.moveTimeout);
        this.moveTimeout = null;
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
            let xdist = this.nextNode.x - this.x;
            let ydist = this.nextNode.y - this.y;
            let direction_distance = Math.sqrt(xdist ** 2 + ydist ** 2);
            this.travelFrames = Math.ceil(direction_distance / this.speed * this.frameRate);
            this.travelX = xdist / this.travelFrames;
            this.travelY = ydist / this.travelFrames;
        }
        
        this.travelFrames--;
        this.x += this.travelX;
        this.y += this.travelY;
        
        // Update hitboxes after movement
        this.updateHitboxes();
    }
    ignite(duration) {
        this.isOnFire = true;
        this.fireDuration = duration * frameRate; 
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
            if (this.fireSprite) {
                characterLayer.removeChild(this.fireSprite);
                this.fireSprite = null;
            }
        }
        if (this.hp <= 0 && !this.dead) {
            this.die();
        } else {
            this.hp -= 0.05; // Fire damage over time
        }
    }
    die() {
        this.dead = true;
        this.rotation = 180;
    }
}

class Wizard extends Character {
    constructor(location, map) {
        super('human', location, map);
        this.speed = 5;
        this.roadSpeedMultiplier = 1.5;
        this.frameRate = 60;
        this.cooldownTime = 0; // configurable delay in seconds before casting
        this.food = 0;
        this.hp = 100;
        this.maxHp = 100;
        this.magic = 100;
        this.maxMagic = 100;
        this.name = 'you';
        this.groundRadius = 0.3;
        this.visualRadius = 0.5; // Hitbox radius in hex units
        this.occlusionRadius = 1.0; // Radius for occlusion checks in hex units
        
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

        // Create wizard hat graphics
        this.hatGraphics = new PIXI.Graphics();
        characterLayer.addChild(this.hatGraphics);
        this.hatColor = 0x000099; // Royal Blue
        this.hatBandColor = 0xFFD700; // Gold
        this.move();
        clearTimeout(this.moveTimeout);
    }
    turnToward(targetX, targetY) {
        // Calculate vector from wizard to target (in world coordinates)
        
        // Calculate angle in radians, then convert to degrees
        const angle = Math.atan2(targetY, targetX);
        const angleInDegrees = angle * 180 / Math.PI;
        
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
        let minDiff = Math.abs(angleInDegrees - directions[0].angle);
        
        for (const dir of directions) {
            // Handle angle wrapping (e.g., -170° is close to 170°)
            let diff = Math.abs(angleInDegrees - dir.angle);
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
        centerViewport(this, 2);
    }
    cast(worldX, worldY) {
        if (this.castDelay) return;

                
        if (wizard.currentSpell === "wall") {
            // Resolve world coordinates to the nearest map node
            const wallNode = this.map.worldToNode(worldX, worldY);
            if (!wallNode) return;
            
            // First click: enter layout mode
            if (!this.wallLayoutMode) {
                this.wallLayoutMode = true;
                this.wallStartPoint = wallNode;
                // Create phantom wall graphics
                this.phantomWall = new PIXI.Graphics();
                this.phantomWall.skipTransform = true;
                objectLayer.addChild(this.phantomWall);
                return;
            }
            
            // Second click: place the wall
            if (this.wallLayoutMode && this.wallStartPoint) {
                const nodeA = this.wallStartPoint;
                const nodeB = wallNode;
                
                if (nodeA === nodeB) {
                    // Can't place a wall from a node to itself
                    this.wallLayoutMode = false;
                    this.wallStartPoint = null;
                    if (this.phantomWall) {
                        objectLayer.removeChild(this.phantomWall);
                        this.phantomWall = null;
                    }
                    return;
                }
                
                // Create a chain of walls along the straightest path
                const wallPath = this.map.getHexLine(nodeA, nodeB);
                Wall.createWallLine(wallPath, 2.0, 0.2, this.map);
                
                // Clean up layout mode
                this.wallLayoutMode = false;
                this.wallStartPoint = null;
                if (this.phantomWall) {
                    objectLayer.removeChild(this.phantomWall);
                    this.phantomWall = null;
                }
                
                const delayTime = this.cooldownTime;
                this.castDelay = true;
                this.casting = true;
                setTimeout(() => {
                    this.castDelay = false;
                    this.casting = false;
                }, 1000 * delayTime);
            }
            return;
        }
        
        if (wizard.currentSpell === "buildroad") {
            // Resolve world coordinates to the nearest map node
            const roadNode = this.map.worldToNode(worldX, worldY);
            if (!roadNode) return;
            
            // Place the road (this is called from mouseup when in layout mode)
            if (this.roadLayoutMode && this.roadStartPoint) {
                const nodeA = this.roadStartPoint;
                const nodeB = roadNode;
                
                // Determine width based on whether it's a single tile or a line
                const width = (nodeA === nodeB) ? 1 : roadWidth; // 1 tile wide for single click, wider for drag
                
                // Get line of hexes (1 tile wide for single click, 3 tiles wide for drag)
                const roadNodes = this.map.getHexLine(nodeA, nodeB, width);
                
                // Place road on each node
                roadNodes.forEach(node => {
                    // Check if there's already road at this location
                    const hasRoad = node.objects && node.objects.some(obj => obj.type === 'road');
                    if (!hasRoad) {
                        new Road({x: node.x, y: node.y}, [], this.map);
                    }
                });
                
                // Deduct magic cost once for the whole line
                wizard.magic -= 5;
                
                // Clean up layout mode
                this.roadLayoutMode = false;
                this.roadStartPoint = null;
                if (this.phantomRoad) {
                    objectLayer.removeChild(this.phantomRoad);
                    this.phantomRoad = null;
                }
                
                const delayTime = this.cooldownTime;
                this.castDelay = true;
                this.casting = true;
                setTimeout(() => {
                    this.castDelay = false;
                    this.casting = false;
                }, 1000 * delayTime);
            }
            return;
        }
        
        // Check if cursor is inside any visible staticObject hitbox
        // Check if cursor is inside any visible staticObject sprite (topmost by y first)
        let clickTarget = null;
 
        const clickScreen = worldToScreen({x: worldX, y: worldY});
        const targetCandidates = Array.from(onscreenObjects)
            .filter(obj => obj && !obj.gone && !obj.vanishing)
            .sort((a, b) => worldToScreen(b).y - worldToScreen(a).y);

        for (let obj of targetCandidates) {
            if (obj.pixiSprite.containsPoint(clickScreen)) {
                clickTarget = obj;
                console.log("target acquired: ", obj);
                break;
            }
        }
        
        let projectile;
        let delayTime;

        if (wizard.currentSpell === "grenades") {
            if (!wizard.inventory.includes("grenades") || wizard.inventory.grenades <= 0) return;
            wizard.inventory.grenades--;
            projectile = new Grenade();
        }
        else if (wizard.currentSpell === "rocks") {
            projectile = new Rock();
        }
        else if (wizard.currentSpell === "fireball") {
            projectile = new Fireball();
        }
        else if (wizard.currentSpell === "vanish") {
            projectile = new Vanish();
        }
        else if (wizard.currentSpell === "treegrow") {
            projectile = new TreeGrow();
        }
        else if (wizard.currentSpell === "buildroad") {
            projectile = new BuildRoad();
        }
        
        // Pass forced target to projectile if cursor was over an object
        if (clickTarget) {
            projectile.forcedTarget = clickTarget;
        }
        
        delayTime = projectile.delayTime || this.cooldownTime;

        this.castDelay = true;
        projectiles.push(projectile.cast(worldX, worldY))
        wizard.casting = true;
        setTimeout(() => {
            this.castDelay = false;
            this.casting = false;
        }, 1000 * delayTime);
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
    
    moveDirection(vector) {
        // Apply physics and collision resolution to the wizard's movement vector
        // Called every frame to process movement, regardless of input

        const maxSpeed = this.speed * (this.isOnRoad() ? this.roadSpeedMultiplier : 1);
        this.currentMaxSpeed = maxSpeed;
        
        if (vector && vector.x !== 0 && vector.y !== 0) {
            // Input provided: add acceleration toward desired direction
            const len = Math.hypot(vector.x, vector.y);
            if (len > 0) {
                const nx = vector.x / len;
                const ny = vector.y / len;
                
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
                
                this.turnToward(nx, ny);
            }
        } else {
            // No input: decelerate quickly using same acceleration rate
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
        if (currentMag < 0.01) {
            this.moving = false;
            return false;
        }
        
        this.moving = true;
        
        // Use accumulated movement vector for this frame's position change
        let newX = this.x + this.movementVector.x / this.frameRate;
        let newY = this.y + this.movementVector.y / this.frameRate;
        
        const wizardRadius = this.groundRadius;
        
        // Collect nearby objects once to avoid repeated grid traversal
        const nearbyObjects = [];
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
            const testHitbox = new CircleHitbox(testX, testY, wizardRadius);
            
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
                this.x = testX;
                this.y = testY;
                this.updateHitboxes();
                centerViewport(this, 2);
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
        const testHitbox = new CircleHitbox(testX, testY, wizardRadius);
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
            
            this.x = this.x + normalX * pushOutDistance;
            this.y = this.y + normalY * pushOutDistance;
            this.updateHitboxes();
            centerViewport(this, 2);
            return true;
        }
        
        // No collision - apply the movement
        this.x = newX;
        this.y = newY;
        this.updateHitboxes();
        centerViewport(this, 2);
        return true;
    }
    
    drawHat() {
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
        let wizardScreenY = screenCoors.y;
        
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
        
        // Determine which row (direction) to use
        if (this.lastDirectionRow === undefined) this.lastDirectionRow = 0;
        let rowIndex = this.lastDirectionRow;
        if (this.moving && Number.isInteger(this.direction) && this.direction >= 0) {
            rowIndex = (this.direction + wizardDirectionRowOffset + 12) % 12;
            this.lastDirectionRow = rowIndex;
        }
        
        // Determine which frame (column) to show for animation
        let frameIndex = rowIndex * 9; // Start of this row
        if (this.moving) {
            // Columns 1-8 = running animation (8 frames)
            // Column 0 = standing still
            const speedRatio = (this.currentMaxSpeed && this.speed) ? (this.currentMaxSpeed / this.speed) : 1;
            const animFrame = Math.floor(frameCount * animationSpeedMultiplier * speedRatio / 2) % 8;
            frameIndex = rowIndex * 9 + 1 + animFrame;
        }
        
        // Set the texture to the appropriate frame
        if (wizardFrames[frameIndex]) {
            this.pixiSprite.texture = wizardFrames[frameIndex];
        }
        
        // Update wizard sprite position
        const screenCoors = worldToScreen(this);
        
        this.pixiSprite.x = screenCoors.x;
        this.pixiSprite.y = screenCoors.y;
        this.pixiSprite.anchor.set(0.5, 0.75);
        this.pixiSprite.width = viewscale;
        this.pixiSprite.height = viewscale;

        this.drawHat();
    }
}

class Animal extends Character {
    constructor(type, location, map) {
        super(type, location, map);
        this.radius = 0.45; // Animal hitbox radius in hex units
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
        if (!this.moving || Math.random() * this.randomMotion * this.frameRate < 1 && this.speed == this.walkSpeed) {
            const direction = Math.floor(Math.random() * 12);
            const wanderNode = this.node.neighbors[direction];
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
        this._onScreen = false;
        if (this.gone) return false;
        if (this.x + this.width + safetyMargin > viewport.x && this.y + safetyMargin / xyratio > viewport.y) {
            if (this.x - this.width - safetyMargin < viewport.x + viewport.width && this.y - this.height - safetyMargin / xyratio < viewport.y + viewport.height) {
                this._onScreen = true;
            }
        }
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
}

class Squirrel extends Animal {
    constructor(location, map) {
        super('squirrel', location, map);
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
        this.size = Math.random() * .2 + .4;
        this.width = this.size;
        this.height = this.size;
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
        super('deer', location, map);
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
        this.size = Math.random() * .5 + .75;
        this.width = this.size;
        this.height = this.size;
        this.walkSpeed = 1;
        this.runSpeed = 3.5;
        this.fleeRadius = 9;
        this.foodValue = Math.floor(90 * this.size);
        this.hp = 10 * this.size;
        this.spriteSheetReady = false;
        ensureSpriteFrames(this);
    }
}

class Bear extends Animal {
    constructor(location, map) {
        super('bear', location, map);
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
        this.size = Math.random() * .3 + 1.2;
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
    // Append Pixi canvas to display
    $("#display").append(app.view);

    app.ticker.add(() => {
        // Force the cursor style directly on the canvas 60 times a second
        if (app.view && app.view.style) {
            app.view.style.cursor = "url('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), default";
        }
    });
    
    // Handle window resize
    window.addEventListener('resize', sizeView);

    function sizeView() {
        app.renderer.resize(window.innerWidth, window.innerHeight);

        // Resize background tiles to match new screen size
        if (Array.isArray(landTileSprite)) {
            for (let i = 0; i < landTileSprite.length; i++) {
                landTileSprite[i].width = app.screen.width;
                landTileSprite[i].height = app.screen.height;
            }
        }
        
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

        if (roadTileSprite) {
            roadTileSprite.width = app.screen.width * roadLayerOversize;
            roadTileSprite.height = app.screen.height * roadLayerOversize;
            const oversizeOffsetX = (roadTileSprite.width - app.screen.width) / 2;
            const oversizeOffsetY = (roadTileSprite.height - app.screen.height) / 2;
            roadTileSprite.x = -oversizeOffsetX;
            roadTileSprite.y = -oversizeOffsetY;
            roadTileSprite.tileTransform.rotation = roadTextureRotation;
        }
    }

    console.log("Generating map...");
    initRoadLayer();
    map = new GameMap(mapHeight, mapWidth, {}, () => {
        frameRate = 30;
        
        // Draw immediately on first frame
        drawCanvas();
        
        // Set up rendering loop
        setInterval(() => {
            if (paused) return;
            
            // Calculate desired movement direction from input
            let moveVector = null;
            if (keysPressed['w']) {
                moveVector = {
                    x: mousePos.worldX - wizard.x,
                    y: mousePos.worldY - wizard.y
                };
                wizard.path = [];
                wizard.nextNode = null;
            }
            
            // Process movement every frame (with or without input)
            wizard.moveDirection(moveVector);
            
            drawCanvas();
            frameCount ++;
        }, 1000 / frameRate);
    });

    wizard = new Wizard({x: mapWidth/2, y: mapHeight/2}, map);
    viewport.x = Math.max(0, wizard.x - viewport.width / 2);
    viewport.y = Math.max(0, wizard.y - viewport.height / 2);
    centerViewport(wizard, 0);
    sizeView();
    
    // Create roof preview
    roof = new Roof(0, 0, 0);
    
    // once-per-second time update
    function timeDown() {
        if (wizard.hp < wizard.maxHp) {
            wizard.hp = Math.min(wizard.maxHp, wizard.hp + 0.0625);
        }
        if (wizard.magic < wizard.maxMagic) {
            wizard.magic = Math.min(wizard.maxMagic, wizard.magic + 1);
        }
        setTimeout(timeDown, 250);
    }    
    timeDown();
    
    // Initialize status bar updates
    setInterval(() => {
        if (wizard) wizard.updateStatusBars();
    }, 100);

    // Spell system
    wizard.spells = [
        { name: 'fireball', icon: '/assets/images/thumbnails/fireball.png'},
        { name: 'wall', icon: '/assets/images/thumbnails/wall.png'},
        { name: 'vanish', icon: '/assets/images/thumbnails/vanish.png'},
        { name: 'treegrow', icon: '/assets/images/thumbnails/tree.png'},
        { name: 'buildroad', icon: '/assets/images/thumbnails/road.png'}
    ].map((spell) => {
        spell.key = Object.keys(spellKeyBindings).find(k => spellKeyBindings[k] === spell.name);
        return spell;
    });
    wizard.currentSpell = 'wall';
    
    // Initialize spell selector UI
    function updateSpellSelector() {
        const currentSpell = wizard.spells.find(s => s.name === wizard.currentSpell);
        if (currentSpell) {
            $("#selectedSpell").css('background-image', `url('${currentSpell.icon}')`);
        }
        
        // Build spell grid
        $("#spellGrid").empty();
        wizard.spells.forEach(spell => {
            const spellIcon = $("<div>")
                .addClass("spellIcon")
                .css({
                    'background-image': `url('${spell.icon}')`,
                    'position': 'relative'
                })
                .attr('data-spell', spell.name)
                .click(() => {
                    wizard.currentSpell = spell.name;
                    updateSpellSelector();
                    $("#spellMenu").addClass('hidden');
                });
            
            // Add key binding label to upper left corner
            if (spell.key) {
                const keyLabel = $("<span>")
                    .addClass("spellKeyBinding")
                    .text(spell.key)
                    .css({
                        'position': 'absolute',
                        'top': '4px',
                        'left': '4px',
                        'color': 'white',
                        'font-size': '12px',
                        'font-weight': 'bold',
                        'pointer-events': 'none',
                        'text-shadow': '1px 1px 2px rgba(0, 0, 0, 0.8)',
                        'z-index': '10'
                    });
                spellIcon.append(keyLabel);
            }
            
            if (spell.name === wizard.currentSpell) {
                spellIcon.addClass('selected');
            }
            
            $("#spellGrid").append(spellIcon);
        });
    }
    
    updateSpellSelector();
    
    // Toggle spell menu
    $("#selectedSpell").click(() => {
        $("#spellMenu").toggleClass('hidden');
    });
    
    // Close spell menu when clicking on canvas
    app.view.addEventListener("click", () => {
        $("#spellMenu").addClass('hidden');
    })

    app.view.addEventListener("mousemove", event => {
        let rect = app.view.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        // Store screen coordinates for cursor
        mousePos.screenX = screenX;
        mousePos.screenY = screenY;
        // Store exact world coordinates for pixel-accurate aiming
        const worldCoors = screenToWorld(screenX, screenY);
        mousePos.worldX = worldCoors.x;
        mousePos.worldY = worldCoors.y;
        // Also store hex tile for movement
        const dest = screenToHex(screenX, screenY);
        mousePos.x = dest.x;
        mousePos.y = dest.y;
        
        // Update cursor immediately (don't wait for render loop)
        updateCursor();
        
        // Update phantom wall preview if in layout mode
        if (wizard.wallLayoutMode && wizard.wallStartPoint && wizard.phantomWall) {
            updatePhantomWall(wizard.wallStartPoint.x, wizard.wallStartPoint.y, mousePos.worldX, mousePos.worldY);
        }

        // Update phantom road preview if in layout mode
        if (wizard.roadLayoutMode && wizard.roadStartPoint && wizard.phantomRoad) {
            updatePhantomRoad(wizard.roadStartPoint.x, wizard.roadStartPoint.y, mousePos.worldX, mousePos.worldY);
        }
    })

    app.view.addEventListener("mousedown", event => {
        // For walls: requires spacebar
        if (wizard.currentSpell === "wall") {
            if (!keysPressed[' ']) return;
            event.preventDefault();

            const rect = app.view.getBoundingClientRect();
            const screenX = event.clientX - rect.left;
            const screenY = event.clientY - rect.top;
            const worldCoors = screenToWorld(screenX, screenY);

            wizard.cast(worldCoors.x, worldCoors.y);
            return;
        }
        
        // For roads: set the start point on mousedown
        if (wizard.currentSpell === "buildroad" && !wizard.roadLayoutMode) {
            const rect = app.view.getBoundingClientRect();
            const screenX = event.clientX - rect.left;
            const screenY = event.clientY - rect.top;
            const worldCoors = screenToWorld(screenX, screenY);
            const roadNode = wizard.map.worldToNode(worldCoors.x, worldCoors.y);
            if (roadNode) {
                wizard.roadLayoutMode = true;
                wizard.roadStartPoint = roadNode;
                if (!wizard.phantomRoad) {
                    wizard.phantomRoad = new PIXI.Container();
                    wizard.phantomRoad.skipTransform = true;
                    objectLayer.addChild(wizard.phantomRoad);
                }
            }
            return;
        }
    });

    app.view.addEventListener("mouseup", event => {
        if (wizard.currentSpell === "wall") {
            if (!wizard.wallLayoutMode || !wizard.wallStartPoint) return;
        } else if (wizard.currentSpell === "buildroad") {
            if (!wizard.roadLayoutMode || !wizard.roadStartPoint) return;
        } else {
            return;
        }
        event.preventDefault();

        const rect = app.view.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        const worldCoors = screenToWorld(screenX, screenY);

        wizard.cast(worldCoors.x, worldCoors.y);
    });

    app.view.addEventListener("click", event => {
        if (keysPressed[' ']) {
            event.preventDefault();
            // Stop wizard movement by setting destination to current node
            wizard.destination = null;
            wizard.path = [];
            wizard.travelFrames = 0;
            // Turn toward mouse position using world coordinates
            wizard.turnToward(mousePos.worldX - wizard.x, mousePos.worldY - wizard.y);
            if (wizard.currentSpell === "wall") return;
            // Cast after delay
            setTimeout(() => {
                wizard.cast(mousePos.worldX, mousePos.worldY);
            }, wizard.cooldownTime * 1000);
        }
    })
     
    $("#msg").contextmenu(event => event.preventDefault())
    $(document).keydown(event => {
        // Track key state
        keysPressed[event.key.toLowerCase()] = true;
        
        if (event.key === " " || event.code === "Space") {
            event.preventDefault();
            if (!event.repeat) {
                spacebarDownAt = Date.now();
            }
        } else if (Object.keys(spellKeyBindings).includes(event.key.toUpperCase())) {
            wizard.currentSpell = spellKeyBindings[event.key.toUpperCase()];
            updateSpellSelector();
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
    })
    
    $(document).keyup(event => {
        // Track key state
        keysPressed[event.key.toLowerCase()] = false;

        if (event.key === " " || event.code === "Space") {
            if (wizard.currentSpell === "wall") return;
            event.preventDefault();
            const now = Date.now();
            const downAt = spacebarDownAt;
            spacebarDownAt = null;

            if (downAt && (now - downAt) <= 250) {
                // Quick tap: cast immediately
                if (wizard && mousePos.worldX !== undefined && mousePos.worldY !== undefined) {
                    wizard.turnToward(mousePos.worldX - wizard.x, mousePos.worldY - wizard.y);
                    wizard.cast(mousePos.worldX, mousePos.worldY);
                }
            }
        }
    })

})

// Rendering and utility helpers moved to rendering.js