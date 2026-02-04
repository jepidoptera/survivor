const mapWidth = 400;
const mapHeight = 400;
let frameRate = 60;
let frameCount = 0;
const animationSpeedMultiplier = 0.75; // Adjustable: lower = faster, higher = slower
const wizardDirectionRowOffset = 0; // 0 when row 0 faces left. Adjust to align sprite sheet rows.
let debugMode = false; // Toggle all debug graphics (hitboxes, grid, animal markers)

let viewport = {width: 0, height: 0, innerWindow: {width: 0, height: 0}, x: 488, y: 494}
let projectiles = [];
let animals = [];
let mousePos = {x: 0, y: 0};
var messages = [];

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
let gridLayer = new PIXI.Container();
let neighborDebugLayer = new PIXI.Container();
let lastDebugWizardPos = {x: -1, y: -1}; // Track wizard position to cache debug labels
let objectLayer = new PIXI.Container();
let characterLayer = new PIXI.Container();
let projectileLayer = new PIXI.Container();
let hitboxLayer = new PIXI.Container();

app.stage.addChild(gameContainer);
gameContainer.addChild(landLayer);
gameContainer.addChild(gridLayer);
gameContainer.addChild(neighborDebugLayer);
gameContainer.addChild(objectLayer);
gameContainer.addChild(characterLayer);
gameContainer.addChild(projectileLayer);
gameContainer.addChild(hitboxLayer);

let landTileSprite = null;
let gridGraphics = null;
let hitboxGraphics = null;
let wizardFrames = []; // Array of frame textures for wizard animation
let wizard = null;

// Load sprite sheets before starting game
PIXI.Loader.shared
    .add('/assets/spritesheet/bear.json')
    .add('/assets/spritesheet/deer.json')
    .add('/assets/spritesheet/squirrel.json')
    .add('/assets/images/runningman.png')
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
    
    console.log("Pixi assets loaded successfully");
}

class Projectile {
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
    }
    throw(targetX, targetY) {
        this.visible = true;
        this.x = wizard.x + wizard.offset.x;
        this.y = wizard.y + wizard.offset.y + (wizard.x % 2 === 0 ? 0.5 : 0);
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


        this.throwInterval = setInterval(() => {
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
            this.landedWorldX = this.x * map.hexWidth;
            this.landedWorldY = this.y * map.hexHeight;
            this.vanishTimeout = setTimeout(() => {
                this.visible = false;
                if (this.pixiSprite) {
                    projectileLayer.removeChild(this.pixiSprite);
                    this.pixiSprite = null;
                }
            }, 3000);
            clearInterval(this.throwInterval);
        }
    }
    land() {
    }
}

class Grenade extends Projectile {
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
                    const targetCoors = displayCoors(animal);
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

class Rock extends Projectile {
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
                    const targetCoors = displayCoors(animal);
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

class Fireball extends Projectile {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/explosion.png";
        this.gravity = 0; // No arc - straight line
        this.speed = 5;
        this.range = 10;
        this.bounces = 0;
        this.apparentSize = 60;
        this.explosionFrame = 0;
        this.explosionFrames = null;
        this.isAnimating = true;
        this.damageRadius = 0.75;
        this.delayTime = 2;
    }
    throw(targetX, targetY) {
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
            if (!this._pendingThrow) {
                this._pendingThrow = {targetX, targetY};
                baseTexture.once('loaded', () => {
                    if (this._pendingThrow) {
                        const {targetX: pendingX, targetY: pendingY} = this._pendingThrow;
                        this._pendingThrow = null;
                        this.visible = true;
                        this.throw(pendingX, pendingY);
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
        this.x = wizard.x + wizard.offset.x;
        this.y = wizard.y + wizard.offset.y + (wizard.x % 2 === 0 ? 0.5 : 0);
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
                
        // Start animation
        this.animationInterval = setInterval(() => {
            if (paused) return;
            this.explosionFrame = (this.explosionFrame + 1) % this.explosionFrames.length;
        }, 1000 / this.speed * this.totalDist / 6);

        this.movement = {
            x: xdist / this.totalDist * this.speed / frameRate,
            y: ydist / this.totalDist * this.speed / frameRate,
            z: 0,
        }
        this.x += this.movement.x;
        this.y += this.movement.y;
        
        this.throwInterval = setInterval(() => {
            if (paused) return;
            this.x += this.movement.x;
            this.y += this.movement.y;
            this.traveledDist += Math.sqrt(this.movement.x ** 2 + this.movement.y ** 2);
            
            // Check for continuous damage while moving
            this.land();
            
            // Check if reached target
            if (this.traveledDist >= this.totalDist) {
                this.visible = false;
                if (this.pixiSprite) {
                    projectileLayer.removeChild(this.pixiSprite);
                    this.pixiSprite = null;
                }
                clearInterval(this.throwInterval);
                if (this.animationInterval) clearInterval(this.animationInterval);
            }
        }, 1000 / frameRate);
        return this;
    }
    bounce() {
        // Fireball doesn't bounce, it just disappears
        this.visible = false;
        if (this.pixiSprite) {
            projectileLayer.removeChild(this.pixiSprite);
            this.pixiSprite = null;
        }
        clearInterval(this.throwInterval);
        if (this.animationInterval) clearInterval(this.animationInterval);
    }
    land() {
        // Check for damage on every frame while moving
        animals.forEach((animal, n) => {
            if (animal._onScreen && !animal.dead) {
                // Use world coordinates for accurate collision detection
                const ballWorld = displayCoors(this);
                const animalWorld = displayCoors(animal);
                const animalRadiusPx = (animal.hitboxRadius || 0) * map.hexHeight;
                const ballRadiusPx = this.damageRadius * map.hexHeight;
                if (withinRadius(ballWorld.x, ballWorld.y, animalWorld.x, animalWorld.y, ballRadiusPx + animalRadiusPx)) {
                    let damage = 0.1; // Damage per frame
                    animal.hp -= damage;
                    animal.ignite(5);
                    if (animal.chaseRadius > 0) animal.attack(wizard);
                    if (animal.fleeRadius > 0 && !animal.attacking) animal.flee();
                }
            }
        });
        
        // Check for trees/objects in range
        for (let x = Math.floor(this.x - 2); x <= Math.ceil(this.x + 2); x++) {
            for (let y = Math.floor(this.y); y <= Math.ceil(this.y + 4); y++) {
                if (map.nodes[x] && map.nodes[x][y] && map.nodes[x][y].objects) {
                    const nodeObjects = map.nodes[x][y].objects;
                    nodeObjects.forEach(obj => {
                        if (!obj) return;
                        if (obj.type === "tree" || obj.type === "playground") {
                        // Check if fireball is within object's bounding box (world coords)
                        const objWorld = worldCoors(obj);
                        const objLeft = objWorld.x - (obj.width || 4) * map.hexHeight / 2;
                        const objRight = objWorld.x + (obj.width || 4) * map.hexHeight / 2;
                        const objBottom = objWorld.y;
                        const objTop = objWorld.y - (obj.height || 4) * map.hexHeight;
                        
                        const ballWorld = worldCoors(this);
                        const withinX = ballWorld.x >= objLeft && ballWorld.x <= objRight;
                        const withinY = ballWorld.y >= objTop && ballWorld.y <= objBottom;
                        
                        if (withinX && withinY) {
                            // Don't re-ignite objects that are already burned or falling
                            if (obj.burned || (obj.rotation && obj.rotation > 0) || obj.fireFadeStart !== undefined || obj.hp <= 0) {
                                return;
                            }
                            if (!obj.hp) obj.hp = 100;
                            obj.hp -= 1;
                            obj.isOnFire = true;
                            obj.fireDuration = 25 * frameRate;
                        }
                    }
                    });
                }
            }
        }
    }
}


class Vanish extends Projectile {
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
        this.effectRadius = 0.1;
        this.magicCost = 5;
    }
    
    throw(targetX, targetY) {
        // Check magic
        if (wizard.magic < 15) {
            message("Not enough magic to cast Vanish!");
            return this;
        }
        wizard.magic -= this.magicCost;
        
        this.visible = true;
        this.x = wizard.x + wizard.offset.x;
        this.y = wizard.y + wizard.offset.y + (wizard.x % 2 === 0 ? 0.5 : 0);
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
        
        this.throwInterval = setInterval(() => {
            if (paused) return;
            this.x += this.movement.x;
            this.y += this.movement.y;
            this.traveledDist += Math.sqrt(this.movement.x ** 2 + this.movement.y ** 2);
            
            // Check if reached target
            if (this.traveledDist >= this.totalDist) {
                // Check for hits only at destination
                this.land();
                
                this.visible = false;
                if (this.pixiSprite) {
                    projectileLayer.removeChild(this.pixiSprite);
                    this.pixiSprite = null;
                }
                clearInterval(this.throwInterval);
            }
        }, 1000 / frameRate);
        return this;
    }
    
    land() {
        // Check for animals in range
        animals.forEach((animal, n) => {
            if (animal._onScreen && !animal.dead) {
                const ballWorld = worldCoors(this);
                const animalWorld = worldCoors(animal);
                const animalRadiusPx = (animal.hitboxRadius || 0.35) * map.hexHeight;
                const ballRadiusPx = this.effectRadius * map.hexHeight;
                
                if (withinRadius(ballWorld.x, ballWorld.y, animalWorld.x, animalWorld.y, ballRadiusPx + animalRadiusPx)) {
                    this.vanishTarget(animal);
                }
            }
        });
        
        // Check for objects in range
        for (let x = Math.floor(this.x - 2); x <= Math.ceil(this.x + 2); x++) {
            for (let y = Math.floor(this.y); y <= Math.ceil(this.y + 4); y++) {
                if (map.nodes[x] && map.nodes[x][y] && map.nodes[x][y].objects) {
                    const nodeObjects = map.nodes[x][y].objects;
                    nodeObjects.forEach(obj => {
                        if (!obj) return;
                        
                        // Check if vanish spell is within object's bounding box (world coords)
                        const objWorld = worldCoors(obj);
                        const objLeft = objWorld.x - (obj.width || 4) * map.hexHeight / 2;
                        const objRight = objWorld.x + (obj.width || 4) * map.hexHeight / 2;
                        const objBottom = objWorld.y;
                        const objTop = objWorld.y - (obj.height || 4) * map.hexHeight;
                        
                        const ballWorld = worldCoors(this);
                        const withinX = ballWorld.x >= objLeft && ballWorld.x <= objRight;
                        const withinY = ballWorld.y >= objTop && ballWorld.y <= objBottom;
                        
                        if (withinX && withinY && !obj.vanishing) {
                            this.vanishTarget(obj);
                        }
                    });
                }
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


class Arrow extends Projectile {
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
        clearInterval(this.throwInterval)
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

class Character {
    constructor(type, x, y, map) {
        this.type = type;
        this.x = x;
        this.y = y;
        this.z = 0;
        this.destination = {x: this.x, y: this.y};
        this.offset = {x: 0, y: 0};
        this.travelFrames = 0;
        this.moving = false;
        this.nextNode = null;
        this.map = map;
        this.isOnFire = false;
        this.fireSprite = null;
        this.fireFrameIndex = 1;
        this.hitboxRadius = 0.35; // Default hitbox radius in hex units
        this.frameRate = 1;
        this.moveTimeout = this.nextMove();
        this.attackTimeout = null;
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
    move() {
        this.moveTimeout = this.nextMove();
        
        if (paused) {
            return;
        }
        if (this.x !== this.destination.x || this.y !== this.destination.y) {

            this.moving = true;
            if (this.travelFrames === 0) {
                this.offset = {x: 0, y: 0};
                this.casting = false;
                // console.log(this.x, this.y);

                if (this.nextNode) {
                    this.x = this.nextNode.xindex;
                    this.y = this.nextNode.yindex;
                }
                if (this.y === this.destination.y && this.x === this.destination.x) return;
                else {
                    let currentDirection = Number.isInteger(this.direction) ? this.direction : 0;
                    const pathResult = this.map.findPath(this, this.destination);
                    this.direction = Number.isInteger(pathResult.direction) ? pathResult.direction : currentDirection;
                    
                    // don't do a 180 course reversal. just don't. it looks stupid and gets you stuck in a loop.
                    // if (Math.abs(this.direction - currentDirection) === 4 || Math.abs(this.direction - currentDirection) === -4) {
                    //     this.direction = currentDirection;
                    // }
                    
                    if (pathResult.x === 0 && pathResult.y === 0) {
                        this.destination = {x: this.x, y: this.y}
                        return;
                    }
                    
                    this.nextNode = this.map.nodes[this.x + pathResult.x][this.y + pathResult.y];
                    let xdist = this.nextNode.x - this.map.nodes[this.x][this.y].x;
                    let ydist = this.nextNode.y - this.map.nodes[this.x][this.y].y;
                    let direction_distance = Math.sqrt(xdist ** 2 + ydist ** 2);
                    this.travelFrames = Math.ceil(direction_distance / this.speed * this.frameRate);
                    this.travelX = xdist / this.travelFrames / .866;
                    this.travelY = ydist / this.travelFrames;
                }
            }
            this.travelFrames --;
            this.offset.x += this.travelX;
            this.offset.y += this.travelY;
        }
        else {
            this.moving = false;
        }
        if (this.isOnFire) {
            this.burn();
        }
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
    constructor(x, y, map) {
        super('human', x, y, map);
        this.speed = 2.5;
        this.frameRate = 60;
        this.cooldownTime = 0; // configurable delay in seconds before throwing
        this.food = 0;
        this.hp = 100;
        this.maxHp = 100;
        this.magic = 100;
        this.maxMagic = 100;
        this.name = 'you';
        
        // Wall placement state
        this.wallLayoutMode = false;
        this.wallStartPoint = null;
        this.phantomWall = null;

        // Create wizard hat graphics
        this.hatGraphics = new PIXI.Graphics();
        characterLayer.addChild(this.hatGraphics);
        this.hatColor = 0x000099; // Royal Blue
        this.hatBandColor = 0xFFD700; // Gold
        this.move();
        clearTimeout(this.moveTimeout);
    }
    turnToward(targetX, targetY) {
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const directionOptions = this.x % 2 === 0 ? [
            {x: 0, y: -1, index: 3},
            {x: 1, y: 0, index: 5},
            {x: 1, y: 1, index: 7},
            {x: 0, y: 1, index: 9},
            {x: -1, y: 1, index: 11},
            {x: -1, y: 0, index: 1}
        ] : [
            {x: 0, y: -1, index: 3},
            {x: 1, y: -1, index: 5},
            {x: 1, y: 0, index: 7},
            {x: 0, y: 1, index: 9},
            {x: -1, y: 0, index: 11},
            {x: -1, y: -1, index: 1}
        ];
        let bestDir = directionOptions[0];
        let bestDot = -Infinity;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
            const ndx = dx / len;
            const ndy = dy / len;
            directionOptions.forEach(dir => {
                const dot = dir.x * ndx + dir.y * ndy;
                if (dot > bestDot) {
                    bestDot = dot;
                    bestDir = dir;
                }
            });
        }
        this.direction = bestDir;
        this.lastDirectionRow = (bestDir.index + wizardDirectionRowOffset + 12) % 12;
    }
    move() {
        super.move();
        centerViewport(this, 2);
    }
    cast(worldX, worldY) {
        if (this.throwDelay) return;
        let projectile;
        let delayTime;
        
        if (wizard.currentSpell === "wall") {
            const screenX = (worldX - viewport.x) * map.hexWidth;
            const screenY = (worldY - viewport.y) * map.hexHeight;
            const dest = screenToHex(screenX, screenY);
            const wallX = dest.x;
            const wallY = dest.y;
            
            if (!this.map.nodes[wallX] || !this.map.nodes[wallX][wallY]) return;
            
            // First click: enter layout mode
            if (!this.wallLayoutMode) {
                this.wallLayoutMode = true;
                this.wallStartPoint = {x: wallX, y: wallY};
                // Create phantom wall graphics
                this.phantomWall = new PIXI.Graphics();
                this.phantomWall.skipTransform = true;
                objectLayer.addChild(this.phantomWall);
                return;
            }
            
            // Second click: place the wall
            if (this.wallLayoutMode && this.wallStartPoint) {
                const x1 = this.wallStartPoint.x;
                const y1 = this.wallStartPoint.y;
                const x2 = wallX;
                const y2 = wallY;
                
                // Validate both endpoints
                if (!this.map.nodes[x2] || !this.map.nodes[x2][y2]) {
                    this.wallLayoutMode = false;
                    this.wallStartPoint = null;
                    if (this.phantomWall) {
                        objectLayer.removeChild(this.phantomWall);
                        this.phantomWall = null;
                    }
                    return;
                }
                
                // Create a chain of walls along the straightest path
                const wallPath = getHexLine(x1, y1, x2, y2);
                NewWall.createWallLine(wallPath, 1.5, 0.2, this.map);
                
                // Clean up layout mode
                this.wallLayoutMode = false;
                this.wallStartPoint = null;
                if (this.phantomWall) {
                    objectLayer.removeChild(this.phantomWall);
                    this.phantomWall = null;
                }
                
                delayTime = this.cooldownTime;
                this.throwDelay = true;
                this.casting = true;
                setTimeout(() => {
                    this.throwDelay = false;
                    this.casting = false;
                }, 1000 * delayTime);
            }
            return;
        }
        else if (wizard.currentSpell === "grenades") {
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
        delayTime = projectile.delayTime || this.cooldownTime;

        this.throwDelay = true;
        projectiles.push(projectile.throw(worldX, worldY))
        wizard.casting = true;
        if (wizard.nextNode) {
            wizard.destination.x = wizard.nextNode.xindex || wizard.x;
            wizard.destination.y = wizard.nextNode.yindex || wizard.y;
        }
        setTimeout(() => {
            this.throwDelay = false;
            this.casting = false;
        }, 1000 * delayTime);
    }
    
    drawHat() {
        // Wizard hat positioning constants
        const hatBrimOffsetX = 0;
        const hatBrimOffsetY = -0.375;
        const hatBrimWidth = 0.5;
        const hatBrimHeight = 0.15;
        const hatPointOffsetX = 0;
        const hatPointOffsetY = -0.4;
        const hatPointHeight = 0.35;

        // Recalculate screen position
        let wizardScreenX = (this.x - viewport.x + this.offset.x) * map.hexWidth;
        let wizardScreenY = (this.y - viewport.y + this.offset.y + (this.x % 2 === 0 ? 0.5 : 0)) * map.hexHeight;
        
        this.hatGraphics.clear();
        
        // Calculate hat brim position (blue oval)
        const brimX = wizardScreenX + hatBrimOffsetX * map.hexWidth;
        const brimY = wizardScreenY + hatBrimOffsetY * map.hexHeight;
        const brimWidth = hatBrimWidth * map.hexWidth;
        const brimHeight = hatBrimHeight * map.hexHeight;
        const pointWidth = hatBrimWidth * map.hexWidth * 0.6;
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
        const pointX = wizardScreenX + hatPointOffsetX * map.hexWidth;
        const pointY = wizardScreenY + hatPointOffsetY * map.hexHeight;
        const pointHeight = hatPointHeight * map.hexHeight;
        
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
            const animFrame = Math.floor(frameCount * animationSpeedMultiplier / 2) % 8;
            frameIndex = rowIndex * 9 + 1 + animFrame;
        }
        
        // Set the texture to the appropriate frame
        if (wizardFrames[frameIndex]) {
            this.pixiSprite.texture = wizardFrames[frameIndex];
        }
        
        // Update wizard sprite position
        let wizardScreenX = (this.x - viewport.x + this.offset.x) * map.hexWidth;
        let wizardScreenY = (this.y - viewport.y + this.offset.y + (this.x % 2 === 0 ? 0.5 : 0)) * map.hexHeight;
        
        this.pixiSprite.x = wizardScreenX;
        this.pixiSprite.y = wizardScreenY;
        this.pixiSprite.anchor.set(0.5, 0.5);
        this.pixiSprite.width = map.hexHeight * 1.1547;
        this.pixiSprite.height = map.hexHeight;

        this.drawHat();
    }
}

class Animal extends Character {
    constructor(type, x, y, map) {
        super(type, x, y, map);
        this.hitboxRadius = 0.45; // Animal hitbox radius in hex units
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
            this.destination.x = Math.min(Math.max(Math.floor(Math.random() * 50 - 25 + this.x), 0), this.map.width - 1);
            this.destination.y = Math.min(Math.max(Math.floor(Math.random() * 50 - 25 + this.y), 0), this.map.height - 1);
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
        this._onScreen = false;
        if (this.gone) return false;
        if (this.x + this.width + 5 > viewport.x && this.y + this.height + 5 > viewport.y) {
            if (this.x - this.width - 5 < viewport.x + viewport.width && this.y - this.height - 5 < viewport.y + viewport.height) {
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
        this.destination.x = Math.floor(Math.max(Math.min(this.x + xdist / dist * 10, this.map.width - 1), 0));  
        this.destination.y = Math.floor(Math.max(Math.min(this.y + ydist / dist * 10, this.map.height - 1), 0));  
        this.speed = this.runSpeed;
    }
    attack(target) {
        this.destination.x = Math.floor(target.x);
        this.destination.y = Math.floor(target.y);
        this.speed = this.runSpeed;
        this.attacking = this.attacking || 1;
        if (withinRadius(this.x, this.y, target.x, target.y, 1) && this.attacking == 1) {
            this.attacking = 2
            if (this.spriteCols > 1) this.spriteCol = 1;
            this.imageFrame.y = (this.x + this.offset.x > target.x + target.offset.x) ? 0 : 1;
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
            this.offset.y = this.offset.y * .95 + ((y - (this.x % 2 === 0 ? 0.5 : 0) - this.width/ 2) - this.y) * .05;
            this.offset.x = this.offset.x * .95 + ((x - this.width / 2) - this.x) * .05;
            }, 1000 / this.frameRate);
        this.rotation = 180;
    }
    explode(x, y) {
        this.dead = 1;
        // this.rotation = 180;
        let xdist = this.x + this.offset.x - this.width/2 - x;
        const realY = worldCoors(this).y;
        let ydist = realY - this.height/2 - y;
        let dist = distance(this.x + this.offset.x, realY, x, y);
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
    constructor(x, y, map) {
        super('squirrel', x, y, map);
        this.spriteSheet = {
            rows: 2,
            cols: 1,
            frameKeys: [
                "walk_left",
                "walk_right"
            ]
        };
        this.hitboxRadius = 0.25; 
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
    constructor(x, y, map) {
        super('deer', x, y, map);
        this.spriteSheet = {
            rows: 2,
            cols: 1,
            frameKeys: [
                "walk_left",
                "walk_right"
            ]
        };
        this.hitboxRadius = 0.55; // Animal hitbox radius in hex units
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
    constructor(x, y, map) {
        super('bear', x, y, map);
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
        this.hitboxRadius = 1.0; // Animal hitbox radius in hex units
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
    constructor(x, y, map) {
        super('scorpion', x, y, map);
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
    constructor(x, y, map) {
        super('armadillo', x, y, map);
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
    constructor(x, y, map) {
        super('coyote', x, y, map);
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
    constructor(x, y, map) {
        super('goat', x, y, map);
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
    constructor(x, y, map) {
        super('porcupine', x, y, map);
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
    constructor(x, y, map) {
        super('yeti', x, y, map);
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

        viewport.height = Math.ceil(viewport.width * (app.screen.height / app.screen.width) * (map.hexWidthRatio));

        centerViewport(wizard, 0);

        map.hexWidth = app.screen.width / viewport.width;
        map.hexHeight = map.hexWidth / map.hexWidthRatio;

        // Reposition background tiles after resize
        updateLandLayer();
    }

    console.log("Generating map...");
    map = new GameMap(mapHeight, mapWidth, {}, () => {
        frameRate = 30;
        
        // Draw immediately on first frame
        drawCanvas();
        
        // Set up rendering loop
        setInterval(() => {
            if (paused) return;
            drawCanvas();
            frameCount ++;
        }, 1000 / frameRate);
        
        setTimeout(() => {
            message("Click to move.  Right-click or double-tap to throw.")
        }, 1000);
        setTimeout(() => {
            message("Use F and G, or tap the menu to switch weapons.")
        }, 3000);
    });

    wizard = new Wizard(mapWidth/2, mapHeight/2, map);
    viewport.x = Math.max(0, wizard.x - viewport.width / 2);
    viewport.y = Math.max(0, wizard.y - viewport.height / 2);
    centerViewport(wizard, 0);
    sizeView();
    
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
        { name: 'fireball', icon: '/assets/images/thumbnails/fireball.png' },
        { name: 'wall', icon: '/assets/images/thumbnails/wall.png' },
        { name: 'vanish', icon: '/assets/images/thumbnails/vanish.png' }
    ];
    wizard.currentSpell = 'vanish';
    
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
                .css('background-image', `url('${spell.icon}')`)
                .attr('data-spell', spell.name)
                .click(() => {
                    wizard.currentSpell = spell.name;
                    updateSpellSelector();
                    $("#spellMenu").addClass('hidden');
                });
            
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
        // Store exact world coordinates for pixel-accurate aiming
        mousePos.worldX = screenX / map.hexWidth + viewport.x;
        mousePos.worldY = screenY / map.hexHeight + viewport.y;
        // Also store hex tile for movement
        const dest = screenToHex(screenX, screenY);
        mousePos.x = dest.x;
        mousePos.y = dest.y;
        
        // Update phantom wall preview if in layout mode
        if (wizard.wallLayoutMode && wizard.wallStartPoint && wizard.phantomWall) {
            updatePhantomWall(wizard.wallStartPoint.x, wizard.wallStartPoint.y, mousePos.x, mousePos.y);
        }
    })

    app.view.addEventListener("click", event => {
        let rect = app.view.getBoundingClientRect();
        const dest = screenToHex(event.clientX - rect.left, event.clientY - rect.top);
        wizard.destination.x = dest.x;
        wizard.destination.y = dest.y;

        if (map.nodes[wizard.destination.x] && map.nodes[wizard.destination.x][wizard.destination.y] && map.nodes[wizard.destination.x][wizard.destination.y].hasBlockingObject()) {
            console.log("blocked", "x", wizard.destination.x, "y", wizard.destination.y);
        }
    })

    app.view.addEventListener("dblclick", event => {
        let rect = app.view.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        const worldX = screenX / map.hexWidth + viewport.x;
        const worldY = screenY / map.hexHeight + viewport.y;
        wizard.cast(worldX, worldY);
    })        
    app.view.addEventListener("contextmenu", event => {
        event.preventDefault();
        let rect = app.view.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        const worldX = screenX / map.hexWidth + viewport.x;
        const worldY = screenY / map.hexHeight + viewport.y;
        wizard.cast(worldX, worldY);
    })        
    $("#msg").contextmenu(event => event.preventDefault())
    $(document).keydown(event => {
        if (event.key === " " || event.code === "Space") {
            event.preventDefault();
            // Stop wizard movement
            wizard.destination.x = wizard.x;
            wizard.destination.y = wizard.y;
            // Turn toward mouse position
            wizard.turnToward(mousePos.x, mousePos.y);
            // Throw after delay
            setTimeout(() => {
                wizard.cast(mousePos.worldX, mousePos.worldY);
            }, wizard.cooldownTime * 1000);
        }
        
        // Toggle debug graphics with 'd' key
        if (event.key === 'd' || event.key === 'D') {
            event.preventDefault();
            debugMode = !debugMode;
            console.log('Debug mode:', debugMode ? 'ON' : 'OFF');
        }
    })

})

function drawCanvas() {
    if (!wizard) return;
    // Update land layer position (tiling background)
    updateLandLayer();

    drawHexGrid();
    
    // Clear and rebuild object layer with sorted items
    objectLayer.removeChildren();

    // Keep phantom wall visible during layout mode
    if (wizard.wallLayoutMode && wizard.wallStartPoint && wizard.phantomWall) {
        updatePhantomWall(wizard.wallStartPoint.x, wizard.wallStartPoint.y, mousePos.x, mousePos.y);
        objectLayer.addChild(wizard.phantomWall);
    }
    
    let mapItems = [];
    for (let y = Math.floor(viewport.y) - 1; y < Math.min(viewport.y + viewport.height + 3, mapHeight); y++) {
        for (let x = Math.floor(viewport.x / 2) * 2 - 1; x < viewport.x + viewport.width + 2; x+= 2) {
            if (map.nodes[x]) {
                if (map.nodes[x][y].objects && map.nodes[x][y].objects.length > 0) {
                    map.nodes[x][y].objects.forEach(obj => mapItems.push(obj));
                }
            }
        }
        for (let x = Math.floor(viewport.x / 2) * 2 - 2; x < viewport.x + viewport.width + 2; x+= 2) {
            if (map.nodes[x]) {
                if (map.nodes[x][y].objects && map.nodes[x][y].objects.length > 0) {
                    map.nodes[x][y].objects.forEach(obj => mapItems.push(obj));
                }
            }
        }
    }
    animals.forEach(animal => {
        if (animal.onScreen) {
            mapItems.push(animal);
        }
    })

    mapItems.sort((a, b) => displayCoors(a).y > displayCoors(b).y ? 1: -1);
    
    const wizardCoors = displayCoors(wizard);
    
    // Update all static objects (handles burning, falling, etc.)
    mapItems.forEach(item => {
        if (item.update) {
            item.update();
        }
        
        // Handle vanish spell fading
        if (item.vanishing && item.vanishStartTime !== undefined) {
            const elapsedFrames = frameCount - item.vanishStartTime;
            const progress = Math.min(1, elapsedFrames / item.vanishDuration);
            
            // Alpha will be set later when combining with occlusion alpha
            
            // Mark for removal when fully vanished (don't remove yet to avoid modifying arrays during iteration)
            if (progress >= 1) {
                if (item.pixiSprite && item.pixiSprite.parent === characterLayer) {
                    characterLayer.removeChild(item.pixiSprite);
                }
                if (item.pixiSprite && item.pixiSprite.parent === objectLayer) {
                    objectLayer.removeChild(item.pixiSprite);
                }
                // Remove from map node
                if (typeof item.removeFromNodes === "function") {
                    item.removeFromNodes();
                } else if (map.nodes[item.x] && map.nodes[item.x][item.y]) {
                    map.nodes[item.x][item.y].removeObject(item);
                }
                item.gone = true;
            }
        }
    });
    
    // Add sorted items to object layer
    mapItems.forEach(item => {
        // Skip items that have been fully vanished
        if (item.gone) return;
        
        if (item.pixiSprite) {
            if (item.skipTransform && typeof item.draw === "function") {
                item.draw();
            } else {
                applySpriteTransform(item);
            }
            // Update sprite alpha for occlusion
            itemCoors = displayCoors(item);
            let itemLeft = itemCoors.x - ((item.width || 1) * map.hexHeight) / 2;
            let itemRight = itemCoors.x + ((item.width || 1) * map.hexHeight) / 2;
            let itemTop = itemCoors.y - (item.height || 1) * map.hexHeight;
            let itemBottom = itemCoors.y;

            // Use trapezoid bounds for falling trees when available
            if (item.type === "tree" && item.taperBounds) {
                itemLeft = item.taperBounds.left;
                itemRight = item.taperBounds.right;
                itemTop = item.taperBounds.top;
                itemBottom = item.taperBounds.bottom;
            }

            const itemPixelWidth = Math.max(1, itemRight - itemLeft);
            const itemPixelHeight = Math.max(1, itemBottom - itemTop);
            const wizardPixelWidth = (wizard.width || 1) * map.hexHeight;
            const wizardPixelHeight = (wizard.height || 1) * map.hexHeight;

            const wizardLeft = wizardCoors.x - wizardPixelWidth / 2;
            const wizardRight = wizardCoors.x + wizardPixelWidth / 2;
            const wizardTop = wizardCoors.y - wizardPixelHeight / 2;
            const wizardBottom = wizardCoors.y + wizardPixelHeight / 2;

            const overlapX = Math.max(0, Math.min(itemRight, wizardRight) - Math.max(itemLeft, wizardLeft));
            const overlapY = Math.max(0, Math.min(itemBottom, wizardBottom) - Math.max(itemTop, wizardTop));
            const overlapArea = overlapX * overlapY;
            const wizardArea = Math.max(1, wizardPixelWidth * wizardPixelHeight);
            const overlapRatio = Math.max(0, Math.min(overlapArea / wizardArea, 1));

            let fadeRatio = overlapRatio;
            let shouldFade = itemCoors.y > wizardCoors.y && itemCoors.y - itemPixelHeight < wizardCoors.y && overlapRatio > 0;

            // Softer approach fade for fallen trees using trapezoid bounds
            if (item.type === "tree" && item.taperBounds) {
                const xOverlapRatio = Math.max(0, Math.min(overlapX / wizardPixelWidth, 1));
                const fadeRange = wizardPixelHeight * 0.1; // Very tight approach range
                let verticalProximity = 0;

                // Calculate distance from wizard top to item bottom
                const distToBottom = wizardTop - itemBottom;
                
                // Only fade when wizard is below or within the tree's vertical bounds
                if (distToBottom > 0 && distToBottom < fadeRange) {
                    // Approaching from below - fade increases as distance decreases
                    verticalProximity = 1 - (distToBottom / fadeRange);
                } else if (wizardTop >= itemTop && wizardTop <= itemBottom) {
                    // wizard is within the vertical bounds of the tree - maintain full fade
                    verticalProximity = 1;
                }

                // Combine horizontal overlap with vertical proximity
                fadeRatio = Math.max(fadeRatio, xOverlapRatio * verticalProximity);
                
                // Fade if there's any horizontal overlap and vertical proximity
                if (xOverlapRatio > 0 && verticalProximity > 0) {
                    shouldFade = true;
                }
            }

            // Smoothstep for less sudden transitions
            const smoothFade = fadeRatio * fadeRatio * (3 - 2 * fadeRatio);

            let occlusionAlpha = 1;
            if (shouldFade) {
                occlusionAlpha = 1 - 0.5 * smoothFade;
            }
            
            // Combine vanish alpha with occlusion alpha
            if (item.vanishing === true && item.vanishStartTime !== undefined && item.vanishDuration !== undefined) {
                const elapsedFrames = frameCount - item.vanishStartTime;
                
                if (elapsedFrames < 1) {
                    // First frame: show blue tint
                    item.pixiSprite.tint = 0x0099FF;
                    item.pixiSprite.alpha = occlusionAlpha;
                } else {
                    // Fade phase: fade from blue to transparent over 1/4 second
                    const fadeElapsed = elapsedFrames - 1;
                    const fadeDuration = 0.25 * frameRate; // 1/4 second
                    this.percentVanished = Math.min(1, fadeElapsed / fadeDuration);
                    const vanishAlpha = Math.max(0, 1 - this.percentVanished);
                    item.pixiSprite.tint = 0x0099FF; // Keep blue tint while fading
                    item.pixiSprite.alpha = occlusionAlpha * vanishAlpha;
                }
            } else {
                item.pixiSprite.alpha = occlusionAlpha;
            }
            // item.pixiSprite.anchor.set(0.1, 0.1);
            objectLayer.addChild(item.pixiSprite);

            // Render fire if burning or fading out
            if (item.isOnFire || item.fireFadeStart !== undefined) {
                ensureFireFrames();
                if (!fireFrames || fireFrames.length === 0) return;
                if (item.fireFrameIndex === undefined || item.fireFrameIndex === null) {
                    item.fireFrameIndex = 0;
                }
                if (!item.fireSprite) {
                    item.fireSprite = new PIXI.Sprite(fireFrames[0]);
                    item.fireSprite.anchor.set(0.5, 0.5);
                }
                if (frameCount % 2 === 0) {
                    item.fireFrameIndex = (item.fireFrameIndex + 1) % fireFrames.length;
                }
                item.fireSprite.texture = fireFrames[item.fireFrameIndex];
                const fireCoors = displayCoors(item);
                const itemHeight = (item.height || 1) * map.hexHeight;
                
                // Calculate fire position accounting for tree rotation
                // Tree rotates around its anchor point (bottom center for trees)
                // Fire should stay at the center of the tree but remain upright
                if (item.type === "tree") {
                    const rotRad = (item.rotation ?? 0) * (Math.PI / 180);
                    // Center of tree rotates around anchor point
                    const centerOffsetX = (itemHeight / 2) * Math.sin(rotRad);
                    const centerOffsetY = -(itemHeight / 2) * Math.cos(rotRad);
                    item.fireSprite.x = fireCoors.x + centerOffsetX;
                    item.fireSprite.y = fireCoors.y + centerOffsetY;
                } else {
                    // For animals, position fire lower (closer to ground)
                    item.fireSprite.x = fireCoors.x;
                    item.fireSprite.y = fireCoors.y;
                }
                
                item.fireSprite.anchor.set(0.5, 1); // Bottom center of fire at position
                
                // Scale fire size based on HP loss
                if (item.maxHP && item.hp !== undefined) {
                    const hpLossRatio = Math.max(0, (item.maxHP - item.hp) / item.maxHP);
                    let fireScale = 0.5 + hpLossRatio * 1.5; // Scale from 0.5x to 2x
                    
                    // During fade phase, shrink fire proportionally
                    const alphaMult = item.fireAlphaMult !== undefined ? item.fireAlphaMult : 1;
                    fireScale *= alphaMult;
                    
                    item.fireSprite.width = (item.width || 1) * map.hexHeight * fireScale;
                    item.fireSprite.height = (item.height || 1) * map.hexHeight * fireScale;
                } else {
                    item.fireSprite.width = (item.width || 1) * map.hexHeight;
                    item.fireSprite.height = (item.height || 1) * map.hexHeight;
                }
                
                // Apply alpha fade
                const alphaMult = item.fireAlphaMult !== undefined ? item.fireAlphaMult : 1;
                item.fireSprite.alpha = item.pixiSprite.alpha * alphaMult;
                item.fireSprite.rotation = 0; // Fire stays upright
                objectLayer.addChild(item.fireSprite);
            }
        }
    });

    wizard.draw();
    wizard.updateStatusBars();
    drawProjectiles();
    drawHitboxes();
    
    $('#msg').html(messages.join("<br>"))
}

function drawHexGrid() {
    if (!debugMode) {
        if (gridGraphics) gridGraphics.visible = false;
        return;
    }

    if (!gridGraphics) {
        gridGraphics = new PIXI.Graphics();
        gridLayer.addChild(gridGraphics);
    }
    gridGraphics.visible = true;
    gridGraphics.clear();

    const hexWidth = map.hexWidth * 1.1547 * 1.1547;
    const hexHeight = map.hexHeight;
    const halfW = hexWidth / 2;
    const quarterW = hexWidth / 4;
    const halfH = hexHeight / 2;

    const yStart = Math.max(Math.floor(viewport.y) - 2, 0);
    const yEnd = Math.min(Math.ceil(viewport.y + viewport.height) + 2, mapHeight - 1);
    const xStart = Math.max(Math.floor(viewport.x) - 2, 0);
    const xEnd = Math.min(Math.ceil(viewport.x + viewport.width) + 2, mapWidth - 1);

    const animalTiles = new Set();
    animals.forEach(animal => {
        if (!animal || animal.gone || animal.dead) return;
        animalTiles.add(`${animal.x},${animal.y}`);
    });

    for (let y = yStart; y <= yEnd; y++) {
        for (let x = xStart; x <= xEnd; x++) {
            if (!map.nodes[x] || !map.nodes[x][y]) continue;
            const node = map.nodes[x][y];
            const centerX = node.xindex * map.hexWidth - viewport.x * map.hexWidth;
            const centerY = (node.yindex + (node.xindex % 2 === 0 ? 0.5 : 0)) * map.hexHeight - viewport.y * map.hexHeight;

            const isBlocked = node.hasBlockingObject() || !!node.blocked;
            const hasAnimal = debugMode && animalTiles.has(`${x},${y}`);
            const color = isBlocked ? 0xff0000 : 0xffffff;
            const alpha = isBlocked ? 0.9 : 0.35;
            if (hasAnimal) {
                gridGraphics.beginFill(0x3399ff, 0.25);
                gridGraphics.moveTo(centerX - halfW, centerY);
                gridGraphics.lineTo(centerX - quarterW, centerY - halfH);
                gridGraphics.lineTo(centerX + quarterW, centerY - halfH);
                gridGraphics.lineTo(centerX + halfW, centerY);
                gridGraphics.lineTo(centerX + quarterW, centerY + halfH);
                gridGraphics.lineTo(centerX - quarterW, centerY + halfH);
                gridGraphics.closePath();
                gridGraphics.endFill();
            }

            gridGraphics.lineStyle(1, color, alpha);
            gridGraphics.moveTo(centerX - halfW, centerY);
            gridGraphics.lineTo(centerX - quarterW, centerY - halfH);
            gridGraphics.lineTo(centerX + quarterW, centerY - halfH);
            gridGraphics.lineTo(centerX + halfW, centerY);
            gridGraphics.lineTo(centerX + quarterW, centerY + halfH);
            gridGraphics.lineTo(centerX - quarterW, centerY + halfH);
            gridGraphics.closePath();
        }
    }
}

function worldCoors(item) {
    return {
        x: (item.x + (item.offset?.x || 0)) * 0.866,
        y: (item.y + (item.offset?.y || 0) + (item.x % 2 === 0 ? 0.5 : 0))
    }
}

function displayCoors(item) {
    const world = worldCoors(item);
    return {
        x: (world.x / 0.866) * map.hexWidth - viewport.x * map.hexWidth,
        y: world.y * map.hexHeight - viewport.y * map.hexHeight
    }
}

function centerViewport(obj, margin) {
    // Calculate viewport center
    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;
    
    // Calculate object's real position (including offset)
    const realX = obj.x + (obj.offset?.x || 0);
    const realY = obj.y + (obj.offset?.y || 0);
    
    // Check if object is outside the margin box
    const leftBound = centerX - margin;
    const rightBound = centerX + margin;
    const topBound = centerY - margin;
    const bottomBound = centerY + margin;
    
    // Smooth interpolation factor (lower = smoother but slower to respond)
    const smoothFactor = 0.15;
    
    // Calculate desired viewport adjustment
    let targetOffsetX = 0;
    let targetOffsetY = 0;
    
    if (realX < leftBound) {
        targetOffsetX = (realX - leftBound);
    } else if (realX > rightBound) {
        targetOffsetX = (realX - rightBound);
    }
    
    if (realY < topBound) {
        targetOffsetY = (realY - topBound);
    } else if (realY > bottomBound) {
        targetOffsetY = (realY - bottomBound);
    }
    
    // Smoothly interpolate viewport position
    viewport.x += targetOffsetX * smoothFactor;
    viewport.y += targetOffsetY * smoothFactor;
    
    // Clamp viewport to map bounds
    viewport.x = Math.max(0, Math.min(viewport.x, mapWidth - viewport.width));
    viewport.y = Math.max(0, Math.min(viewport.y, mapHeight - viewport.height));
}

function getHexLine(x1, y1, x2, y2) {
    if (!map || !map.nodes[x1] || !map.nodes[x1][y1]) return [];
    if (!map.nodes[x2] || !map.nodes[x2][y2]) return [];

    let current = map.nodes[x1][y1];
    const target = map.nodes[x2][y2];
    const path = [current];
    const startPos = {x: current.x, y: current.y};
    const lineVec = {x: target.x - startPos.x, y: target.y - startPos.y};
    const lineLen = Math.hypot(lineVec.x, lineVec.y) || 1;
    const maxSteps = (mapWidth + mapHeight) * 2;
    const visited = new Set();

    for (let step = 0; step < maxSteps; step++) {
        if (current === target) break;
        visited.add(`${current.xindex},${current.yindex}`);

        const dx = target.x - current.x;
        const dy = target.y - current.y;
        const dist = Math.hypot(dx, dy) || 1;

        let best = null;
        let bestScore = -Infinity;
        let bestDist = Infinity;
        let bestLineDist = Infinity;

        for (let i = 0; i < current.neighbors.length; i++) {
            const neighbor = current.neighbors[i];
            if (!neighbor) continue;
            if (visited.has(`${neighbor.xindex},${neighbor.yindex}`)) continue;

            const ndx = neighbor.x - current.x;
            const ndy = neighbor.y - current.y;
            const ndist = Math.hypot(ndx, ndy) || 1;
            const dirScore = (ndx * dx + ndy * dy) / (ndist * dist);
            const distToTarget = Math.hypot(target.x - neighbor.x, target.y - neighbor.y);
            const reduces = distToTarget < dist - 1e-6;
            const lineDist = Math.abs((neighbor.x - startPos.x) * lineVec.y - (neighbor.y - startPos.y) * lineVec.x) / lineLen;
            const score = dirScore + (reduces ? 1 : 0) - lineDist * 1.2;

            if (
                score > bestScore ||
                (score === bestScore && lineDist < bestLineDist) ||
                (score === bestScore && lineDist === bestLineDist && distToTarget < bestDist)
            ) {
                bestScore = score;
                bestDist = distToTarget;
                bestLineDist = lineDist;
                best = neighbor;
            }
        }

        if (!best) break;
        current = best;
        path.push(current);
    }

    return path;
}

function updatePhantomWall(ax, ay, bx, by) {
    if (!wizard.phantomWall) return;
    
    wizard.phantomWall.clear();

    const wallPath = getHexLine(ax, ay, bx, by);
    for (let i = 0; i < wallPath.length - 1; i++) {
        const nodeA = wallPath[i];
        const nodeB = wallPath[i + 1];
        
        // Use the static NewWall.drawWall method with phantom styling
        NewWall.drawWall(wizard.phantomWall, nodeA, nodeB, 1.5, 0.2, 0x888888, 0.5);
    }
}

function screenToHex(screenX, screenY) {
    const worldX = screenX / map.hexWidth + viewport.x;
    const worldY = screenY / map.hexHeight + viewport.y;

    const approxCol = Math.round(worldX);
    const approxRow = Math.round(worldY - (approxCol % 2 === 0 ? 0.5 : 0));

    let best = {x: approxCol, y: approxRow};
    let bestDist = Infinity;

    for (let cx = approxCol - 1; cx <= approxCol + 1; cx++) {
        for (let cy = approxRow - 1; cy <= approxRow + 1; cy++) {
            if (cx < 0 || cy < 0 || cx >= mapWidth || cy >= mapHeight) continue;
            const centerX = cx * map.hexWidth - viewport.x * map.hexWidth;
            const centerY = (cy + (cx % 2 === 0 ? 0.5 : 0)) * map.hexHeight - viewport.y * map.hexHeight;
            const dx = centerX - screenX;
            const dy = centerY - screenY;
            const dist = dx * dx + dy * dy;
            if (dist < bestDist) {
                bestDist = dist;
                best = {x: cx, y: cy};
            }
        }
    }

    return best;
}

function buildSpriteFramesFromList(list, rows, cols) {
    if (!list || list.length < rows * cols) return null;
    const frames = [];
    for (let r = 0; r < rows; r++) {
        frames[r] = [];
        for (let c = 0; c < cols; c++) {
            frames[r][c] = list[r * cols + c];
        }
    }
    return frames;
}

function ensureSpriteFrames(item) {
    if (!item || !item.spriteSheet || item.spriteSheetReady) return;

    const sheet = item.spriteSheet;
    const rows = sheet.rows || 1;
    const cols = sheet.cols || 1;
    let frameList = null;

    if (Array.isArray(sheet.frameTextures)) {
        frameList = sheet.frameTextures;
    } else if (Array.isArray(sheet.frameKeys)) {
        const texGroup = textures[item.type];
        if (texGroup && texGroup.byKey) {
            frameList = sheet.frameKeys.map(key => texGroup.byKey[key]).filter(Boolean);
        }
    } else if (Array.isArray(sheet.framePaths)) {
        frameList = sheet.framePaths.map(path => PIXI.Texture.from(path));
    }

    const frames = buildSpriteFramesFromList(frameList, rows, cols);
    if (!frames) return;

    item.spriteRows = rows;
    item.spriteCols = cols;
    item.spriteCol = item.spriteCol || 0;
    item.spriteFrames = frames;
    item.spriteSheetReady = true;

    if (item.pixiSprite && frames[0] && frames[0][0]) {
        item.pixiSprite.texture = frames[0][0];
    }
}

function ensureFireFrames() {
    if (fireFrames) return;
    const baseTexture = PIXI.Texture.from('./assets/images/fire.png').baseTexture;
    if (!baseTexture.valid) {
        baseTexture.once('loaded', () => {
            fireFrames = null;
            ensureFireFrames();
        });
        return;
    }
    const cols = 5;
    const rows = 5;
    const frameWidth = baseTexture.width / cols;
    const frameHeight = baseTexture.height / rows;
    fireFrames = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            fireFrames.push(
                new PIXI.Texture(
                    baseTexture,
                    new PIXI.Rectangle(col * frameWidth, row * frameHeight, frameWidth, frameHeight)
                )
            );
        }
    }
}

function applySpriteTransform(item) {
    const coors = displayCoors(item);
    ensureSpriteFrames(item);
    if (item.spriteFrames && item.pixiSprite) {
        const rowIndex = typeof item.getDirectionRow === "function" ? item.getDirectionRow() : 0;
        const safeRow = Math.max(0, Math.min(rowIndex, (item.spriteRows || 1) - 1));
        const safeCol = Math.max(0, Math.min(item.spriteCol || 0, (item.spriteCols || 1) - 1));
        const rowFrames = item.spriteFrames[safeRow] || item.spriteFrames[0];
        const nextTexture = rowFrames && (rowFrames[safeCol] || rowFrames[0]);
        if (nextTexture) item.pixiSprite.texture = nextTexture;
    }
    item.pixiSprite.x = coors.x;
    item.pixiSprite.y = coors.y;
    // item.pixiSprite.anchor.set(0, 1);
    item.pixiSprite.width = (item.width || 1) * map.hexHeight;
    item.pixiSprite.height = (item.height || 1) * map.hexHeight;
    item.pixiSprite.skew.x = 0;
    
    // Apply tree taper mesh deformation during fall
    if (item.type === "tree") {
        applyTreeTaperMesh(item, coors);
    }
    
    if (item.rotation) {
        item.pixiSprite.rotation = item.rotation * (Math.PI / 180);
    } else {
        item.pixiSprite.rotation = 0;
    }
}

function updateLandLayer() {
    if (!landTileSprite || !Array.isArray(landTileSprite)) return;
    
    // Update positions of the 4 background tiles to stay centered on viewport
    // Calculate which tile should appear at each position
    const bgWidth = app.screen.width;
    const bgHeight = app.screen.height;
    
    // Calculate offset in pixels from viewport
    const offsetX = -(viewport.x * map.hexWidth) % bgWidth;
    const offsetY = -(viewport.y * map.hexHeight) % bgHeight;
    
    // Position the 4 tiles in a 2x2 grid
    for (let ty = 0; ty < 2; ty++) {
        for (let tx = 0; tx < 2; tx++) {
            const spriteIndex = ty * 2 + tx;
            const sprite = landTileSprite[spriteIndex];
            sprite.x = offsetX + tx * bgWidth;
            sprite.y = offsetY + ty * bgHeight;
        }
    }
}

function drawProjectiles() {
    remainingBalls = [];
    projectiles.forEach(ball => {
        if (!ball.visible) return;
        
        if (!ball.pixiSprite) {
            // Create sprite from actual texture
            const texture = PIXI.Texture.from(ball.image.src);
            ball.pixiSprite = new PIXI.Sprite(texture);
            ball.pixiSprite.anchor.set(0.5, 0.5);
            ball.pixiSprite._lastImageSrc = ball.image.src;
            projectileLayer.addChild(ball.pixiSprite);
        }
        
        // Handle fireball animation (animates while moving)
        if (ball.explosionFrames && ball.explosionFrames.length > 0) {
            ball.pixiSprite.texture = ball.explosionFrames[Math.floor(ball.explosionFrame) % ball.explosionFrames.length];
        }
        // Handle grenade explosion animation (animates when landed)
        else if (ball.isExploding && ball.explosionFrames) {
            ball.pixiSprite.texture = ball.explosionFrames[ball.explosionFrame];
        }
        // Update texture if image changed (for non-animated transitions)
        else if (ball.pixiSprite._lastImageSrc !== ball.image.src) {
            ball.pixiSprite.texture = PIXI.Texture.from(ball.image.src);
            ball.pixiSprite._lastImageSrc = ball.image.src;
        }
        
        // If landed, use fixed world position; otherwise follow projectile
        if (ball.landed) {
            ball.pixiSprite.x = ball.landedWorldX - viewport.x * map.hexWidth;
            ball.pixiSprite.y = ball.landedWorldY - viewport.y * map.hexHeight;
        } else {
            const ballWorldX = ball.x * map.hexWidth;
            const ballWorldY = (ball.y - ball.z) * map.hexHeight;
            ball.pixiSprite.x = ballWorldX - viewport.x * map.hexWidth;
            ball.pixiSprite.y = ballWorldY - viewport.y * map.hexHeight;
        }
        
        ball.pixiSprite.width = ball.apparentSize;
        ball.pixiSprite.height = ball.apparentSize;
        ball.pixiSprite.visible = true;
        
        remainingBalls.push(ball)
    })
    projectiles = remainingBalls;
}

function drawHitboxes() {
    if (!debugMode) {
        if (hitboxGraphics) hitboxGraphics.visible = false;
        return;
    }

    if (!hitboxGraphics) {
        hitboxGraphics = new PIXI.Graphics();
        hitboxLayer.addChild(hitboxGraphics);
    }
    hitboxGraphics.clear();

    // Fireball hitboxes (damage radius)
    projectiles.forEach(ball => {
        if (!ball.visible || !ball.damageRadius) return;
        const ballCoors = displayCoors(ball);
        const radiusPx = ball.damageRadius * map.hexHeight;
        hitboxGraphics.lineStyle(2, 0xffaa00, 0.9);
        hitboxGraphics.drawCircle(ballCoors.x, ballCoors.y, radiusPx);
    });

    // Animal hitboxes
    animals.forEach(animal => {
        if (!animal || animal.dead || !animal._onScreen) return;
        const animalCoors = displayCoors(animal);
        const radiusPx = (animal.hitboxRadius || 0.35) * map.hexHeight;
        hitboxGraphics.lineStyle(2, 0x00ff66, 0.9);
        hitboxGraphics.drawCircle(animalCoors.x, animalCoors.y, radiusPx);
    });

    // Tree hitboxes (match occlusion/catching fire bounds)
    hitboxGraphics.lineStyle(2, 0x33cc33, 0.9);
    const yStart = Math.max(Math.floor(viewport.y) - 2, 0);
    const yEnd = Math.min(Math.ceil(viewport.y + viewport.height) + 2, mapHeight - 1);
    const xStart = Math.max(Math.floor(viewport.x) - 2, 0);
    const xEnd = Math.min(Math.ceil(viewport.x + viewport.width) + 2, mapWidth - 1);

    for (let y = yStart; y <= yEnd; y++) {
        for (let x = xStart; x <= xEnd; x++) {
            if (!map.nodes[x] || !map.nodes[x][y]) continue;
            const nodeObjects = map.nodes[x][y].objects || [];
            const obj = nodeObjects.find(item => item && item.type === "tree");
            if (!obj) continue;

            if (obj.taperBounds) {
                // Trapezoid bounds used for fallen trees
                hitboxGraphics.moveTo(obj.taperBounds.left, obj.taperBounds.bottom);
                hitboxGraphics.lineTo(obj.taperBounds.right, obj.taperBounds.bottom);
                hitboxGraphics.lineTo(obj.taperBounds.right, obj.taperBounds.top);
                hitboxGraphics.lineTo(obj.taperBounds.left, obj.taperBounds.top);
                hitboxGraphics.closePath();
            } else {
                // Rectangular bounds (same as occlusion/catching fire)
                const itemCoors = displayCoors(obj);
                const itemLeft = itemCoors.x - ((obj.width || 1) * map.hexHeight) / 2;
                const itemRight = itemCoors.x + ((obj.width || 1) * map.hexHeight) / 2;
                const itemTop = itemCoors.y - (obj.height || 1) * map.hexHeight;
                const itemBottom = itemCoors.y;
                hitboxGraphics.drawRect(itemLeft, itemTop, itemRight - itemLeft, itemBottom - itemTop);
            }
        }
    }
}

function distance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.hypot(dx, dy);
}

function withinRadius(x1, y1, x2, y2, radius) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy <= radius * radius;
}

function message (text) {
    messages.push(text);
    setTimeout(() => {
        messages.shift();
    }, 8000);
}