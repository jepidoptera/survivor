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
        this.radius = 0.25; // Default hitbox radius in hex units
    }
    throw(targetX, targetY) {
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
        this.radius = this.damageRadius;
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
                const hit = checkCircleVsCircle(
                    {x: this.x, y: this.y, radius: this.radius},
                    {x: animal.x, y: animal.y, radius: animal.radius || 0}
                );
                if (hit) {
                    let damage = 0.1; // Damage per frame
                    animal.hp -= damage;
                    animal.ignite(5);
                    if (animal.chaseRadius > 0) animal.attack(wizard);
                    if (animal.fleeRadius > 0 && !animal.attacking) animal.flee();
                }
            }
        });
        
        // Check for trees/objects in range
        const minNode = map.worldToNode(this.x - 2, this.y);
        const maxNode = map.worldToNode(this.x + 2, this.y + 4);
        if (minNode && maxNode) {
            const xStart = Math.max(minNode.xindex - 1, 0);
            const xEnd = Math.min(maxNode.xindex + 1, mapWidth - 1);
            const yStart = Math.max(minNode.yindex - 1, 0);
            const yEnd = Math.min(maxNode.yindex + 1, mapHeight - 1);

            for (let x = xStart; x <= xEnd; x++) {
                for (let y = yStart; y <= yEnd; y++) {
                    if (map.nodes[x] && map.nodes[x][y] && map.nodes[x][y].objects) {
                        const nodeObjects = map.nodes[x][y].objects;
                        nodeObjects.forEach(obj => {
                            if (!obj || !obj.hitbox) return;
                            if (obj.type === "tree" || obj.type === "playground") {
                                const hit = checkCircleVsPolygon(
                                    {x: this.x, y: this.y, radius: this.radius},
                                    obj.hitbox
                                );
                                if (hit) {
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
        this.effectRadius = 0.5;
        this.magicCost = 5;
        this.radius = this.effectRadius;
    }
    
    throw(targetX, targetY) {
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
                const hit = checkCircleVsCircle(
                    {x: this.x, y: this.y, radius: this.radius},
                    {x: animal.x, y: animal.y, radius: animal.radius || 0.35}
                );
                if (hit) {
                    this.vanishTarget(animal);
                }
            }
        });
        
        // Check for objects in range
        const minNode = map.worldToNode(this.x - 2, this.y);
        const maxNode = map.worldToNode(this.x + 2, this.y + 4);
        if (minNode && maxNode) {
            const xStart = Math.max(minNode.xindex - 1, 0);
            const xEnd = Math.min(maxNode.xindex + 1, mapWidth - 1);
            const yStart = Math.max(minNode.yindex - 1, 0);
            const yEnd = Math.min(maxNode.yindex + 1, mapHeight - 1);

            for (let x = xStart; x <= xEnd; x++) {
                for (let y = yStart; y <= yEnd; y++) {
                    if (map.nodes[x] && map.nodes[x][y] && map.nodes[x][y].objects) {
                        const nodeObjects = map.nodes[x][y].objects;
                        nodeObjects.forEach(obj => {
                            if (!obj || !obj.hitbox) return;
                            let hit = false;
                            if (obj.hitbox instanceof PolygonHitbox) {
                                hit = checkCircleVsPolygon(this, obj.hitbox);
                            } else if (obj.hitbox instanceof CircleHitbox) {
                                hit = checkCircleVsCircle(this, obj.hitbox);
                            }
                            if (hit && !obj.vanishing) {
                                this.vanishTarget(obj);
                            }
                        });
                    }
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
    constructor(type, location, map) {
        this.type = type;
        this.map = map;
        this.z = 0;
        this.travelFrames = 0;
        this.moving = false;
        this.isOnFire = false;
        this.fireSprite = null;
        this.fireFrameIndex = 1;
        this.radius = 0.35; // Default hitbox radius in hex units
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
                const wallPath = getHexLine(nodeA, nodeB);
                Wall.createWallLine(wallPath, 1.5, 0.2, this.map);
                
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

        // Recalculate screen position from world coordinates
        const screenCoors = displayCoors(this);
        let wizardScreenX = screenCoors.x;
        let wizardScreenY = screenCoors.y;
        
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
        const screenCoors = displayCoors(this);
        
        this.pixiSprite.x = screenCoors.x;
        this.pixiSprite.y = screenCoors.y;
        this.pixiSprite.anchor.set(0.5, 0.5);
        this.pixiSprite.width = map.hexHeight * 1.1547;
        this.pixiSprite.height = map.hexHeight;

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
        if (this.x + this.width + safetyMargin > viewport.x && this.y + this.height + safetyMargin > viewport.y) {
            if (this.x - this.width - safetyMargin < viewport.x + viewport.width && this.y - this.height - safetyMargin < viewport.y + viewport.height) {
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
    });

    wizard = new Wizard({x: mapWidth/2, y: mapHeight/2}, map);
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
            updatePhantomWall(wizard.wallStartPoint.x, wizard.wallStartPoint.y, mousePos.worldX, mousePos.worldY);
        }
    })

    app.view.addEventListener("click", event => {
        let rect = app.view.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        // Convert screen coordinates to world coordinates
        const worldX = screenX / map.hexWidth + viewport.x;
        const worldY = screenY / map.hexHeight + viewport.y;
        
        // Check if destination tile has blocking objects
        const destNode = map.worldToNode(worldX, worldY);
        if (destNode) wizard.goto(destNode);
        if (destNode && destNode.hasBlockingObject()) {
            console.log("blocked at world coordinates", worldX, worldY);
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
            // Stop wizard movement by setting destination to current node
            wizard.destination = null;
            wizard.path = [];
            wizard.travelFrames = 0;
            // Turn toward mouse position using world coordinates
            wizard.turnToward(mousePos.worldX, mousePos.worldY);
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
        updatePhantomWall(wizard.wallStartPoint.x, wizard.wallStartPoint.y, mousePos.worldX, mousePos.worldY);
        objectLayer.addChild(wizard.phantomWall);
    }
    
    let mapItems = [];

    const topLeftNode = map.worldToNode(viewport.x, viewport.y);
    const bottomRightNode = map.worldToNode(viewport.x + viewport.width, viewport.y + viewport.height);

    if (topLeftNode && bottomRightNode) {
        const xStart = Math.max(-1, topLeftNode.xindex - 2);
        const xEnd = Math.min(mapWidth - 1, bottomRightNode.xindex + 2);
        const yStart = Math.max(-1, topLeftNode.yindex - 2);
        const yEnd = Math.min(mapHeight - 1, bottomRightNode.yindex + 3);

        const startColA = Math.floor(xStart / 2) * 2 - 1;
        const startColB = startColA - 1;

        for (let y = yStart; y <= yEnd; y++) {
            for (let x = startColA; x <= xEnd + 2; x += 2) {
                if (map.nodes[x] && map.nodes[x][y] && map.nodes[x][y].objects && map.nodes[x][y].objects.length > 0) {
                    map.nodes[x][y].objects.forEach(obj => mapItems.push(obj));
                }
            }
            for (let x = startColB; x <= xEnd + 2; x += 2) {
                if (map.nodes[x] && map.nodes[x][y] && map.nodes[x][y].objects && map.nodes[x][y].objects.length > 0) {
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
                } else {
                    const itemNode = map.worldToNode(item.x, item.y);
                    if (itemNode) itemNode.removeObject(item);
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

    const hexWidth = map.hexWidth * 1.1547;
    const hexHeight = map.hexHeight;
    const halfW = hexWidth / 2;
    const quarterW = hexWidth / 4;
    const halfH = hexHeight / 2;

    startNode = map.worldToNode(viewport.x, viewport.y);
    endNode = map.worldToNode(viewport.x + viewport.width, viewport.y + viewport.height);

    const yStart = Math.max(Math.floor(startNode.yindex) - 2, 0);
    const yEnd = Math.min(Math.ceil(endNode.yindex) + 2, mapHeight - 1);
    const xStart = Math.max(Math.floor(startNode.xindex) - 2, 0);
    const xEnd = Math.min(Math.ceil(endNode.xindex) + 2, mapWidth - 1);

    const animalTiles = new Set();
    animals.forEach(animal => {
        if (!animal || animal.gone || animal.dead) return;
        animalTiles.add(`${animal.x},${animal.y}`);
    });

    for (let y = yStart; y <= yEnd; y++) {
        for (let x = xStart; x <= xEnd; x++) {
            if (!map.nodes[x] || !map.nodes[x][y]) continue;
            const node = map.nodes[x][y];
            const screenCoors = displayCoors(node);
            const centerX = screenCoors.x;
            const centerY = screenCoors.y;

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

function displayCoors(item) {
    return {
        x: (item.x - viewport.x) * map.hexWidth,
        y: (item.y - viewport.y) * map.hexHeight
    }
}

function centerViewport(obj, margin) {
    // viewport is in array index units
    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;
    
    // Convert obj world coordinates to index units
    const objIndexX = obj.x;
    const objIndexY = obj.y;
    
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
    
    if (objIndexX < leftBound) {
        targetOffsetX = (objIndexX - leftBound);
    } else if (objIndexX > rightBound) {
        targetOffsetX = (objIndexX - rightBound);
    }
    
    if (objIndexY < topBound) {
        targetOffsetY = (objIndexY - topBound);
    } else if (objIndexY > bottomBound) {
        targetOffsetY = (objIndexY - bottomBound);
    }
    
    // Smoothly interpolate viewport position
    viewport.x += targetOffsetX * smoothFactor;
    viewport.y += targetOffsetY * smoothFactor;
    
    // Clamp viewport to map bounds
    viewport.x = Math.max(0, Math.min(viewport.x, mapWidth - viewport.width));
    viewport.y = Math.max(0, Math.min(viewport.y, mapHeight - viewport.height));
}

function getHexLine(nodeA, nodeB) {
    if (!map || !nodeA || !nodeB) return [];
    
    // Convert world coordinates to map nodes if needed
    let current = map.worldToNode(nodeA.x, nodeA.y);
    const target = map.worldToNode(nodeB.x, nodeB.y);
    
    if (!current || !target) return [];
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

    const nodeA = map.worldToNode(ax, ay);
    const nodeB = map.worldToNode(bx, by);
    if (!nodeA || !nodeB) return;
    
    const wallPath = getHexLine(nodeA, nodeB);
    for (let i = 0; i < wallPath.length - 1; i++) {
        const nodeA = wallPath[i];
        const nodeB = wallPath[i + 1];
        
        // Use the static NewWall.drawWall method with phantom styling
        Wall.drawWall(wizard.phantomWall, nodeA, nodeB, 1.5, 0.2, 0x888888, 0.5);
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

    // Projectile hitboxes
    projectiles.forEach(ball => {
        if (!ball.visible || !ball.radius) return;
        const ballCoors = displayCoors(ball);
        const radiusPx = ball.radius * map.hexHeight;
        hitboxGraphics.lineStyle(2, 0xffaa00, 0.9);
        hitboxGraphics.drawCircle(ballCoors.x, ballCoors.y, radiusPx);
    });

    // Animal hitboxes
    animals.forEach(animal => {
        if (!animal || animal.dead || !animal._onScreen) return;
        const animalCoors = displayCoors(animal);
        const radiusPx = (animal.radius || 0.35) * map.hexHeight;
        hitboxGraphics.lineStyle(2, 0x00ff66, 0.9);
        hitboxGraphics.drawCircle(animalCoors.x, animalCoors.y, radiusPx);
    });

    // Tree hitboxes (match occlusion/catching fire bounds)
    hitboxGraphics.lineStyle(2, 0x33cc33, 0.9);
    const topLeftNode = map.worldToNode(viewport.x, viewport.y);
    const bottomRightNode = map.worldToNode(viewport.x + viewport.width, viewport.y + viewport.height);

    if (topLeftNode && bottomRightNode) {
        const yStart = Math.max(topLeftNode.yindex - 2, 0);
        const yEnd = Math.min(bottomRightNode.yindex + 3, mapHeight - 1);
        const xStart = Math.max(topLeftNode.xindex - 2, 0);
        const xEnd = Math.min(bottomRightNode.xindex + 2, mapWidth - 1);

        onscreenObjects = new Set();
        for (let y = yStart; y <= yEnd; y++) {
            for (let x = xStart; x <= xEnd; x++) {
                if (!map.nodes[x] || !map.nodes[x][y]) continue;
                const nodeObjects = map.nodes[x][y].objects || [];
                nodeObjects.forEach(obj => {
                    if (obj.hitbox) {
                        onscreenObjects.add(obj);
                    }
                });
            }
        }

        // Draw polygon hitboxes for all onscreen objects that have them
        if (onscreenObjects.size > 0) {
            onscreenObjects.entries().forEach(([key, obj]) => {
                if (!obj) {
                    console.log('Undefined object in onscreenObjects set:', key);
                    return;
                }
                if (obj.hitbox instanceof PolygonHitbox) {
                    hitboxGraphics.lineStyle(2, 0x33cc33, 0.9);
                    const points = obj.hitbox.points;
                    if (!points || points.length === 0) return;
                    
                    // Convert world coordinates to screen coordinates using displayCoors logic
                    const screenPoints = points.map(p => ({
                        x: (p.x - viewport.x) * map.hexWidth,
                        y: (p.y - viewport.y) * map.hexHeight
                    }));
                    
                    // Draw polygon
                    const flatPoints = screenPoints.flatMap(p => [p.x, p.y]);
                    hitboxGraphics.drawPolygon(flatPoints);
                } else if (obj.hitbox instanceof CircleHitbox) {
                    const centerX = (obj.hitbox.x - viewport.x) * map.hexWidth;
                    const centerY = (obj.hitbox.y - viewport.y) * map.hexHeight;
                    const radiusPx = obj.hitbox.radius * map.hexHeight;
                    hitboxGraphics.lineStyle(2, 0x33cc33, 0.9);
                    hitboxGraphics.drawCircle(centerX, centerY, radiusPx);
                }
            });
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