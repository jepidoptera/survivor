const mapWidth = 400;
const mapHeight = 400;
let frameRate = 60;
let frameCount = 0;
const animationSpeedMultiplier = 0.75; // Adjustable: lower = faster, higher = slower
const hunterDirectionRowOffset = 0; // 0 when row 0 faces left. Adjust to align sprite sheet rows.
let showHexGrid = true; // Toggle hex grid overlay

let viewport = {width: 0, height: 0, innerWindow: {width: 0, height: 0}, x: 488, y: 494}
let map = {};
let hunter = {};
let projectiles = [];
let animals = [];
let mousePos = {x: 0, y: 0};
var mapHexWidth, mapHexHeight;
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
let objectLayer = new PIXI.Container();
let characterLayer = new PIXI.Container();
let projectileLayer = new PIXI.Container();

app.stage.addChild(gameContainer);
gameContainer.addChild(landLayer);
gameContainer.addChild(gridLayer);
gameContainer.addChild(objectLayer);
gameContainer.addChild(characterLayer);
gameContainer.addChild(projectileLayer);

let landTileSprite = null;
let gridGraphics = null;
let hunterFrames = []; // Array of frame textures for hunter animation

// Load sprite sheets before starting game
PIXI.Loader.shared
    .add('/assets/spritesheet/bear.json')
    .add('/assets/spritesheet/deer.json')
    .add('/assets/images/hunter2.png')
    .load(onAssetsLoaded);

function onAssetsLoaded() {
    // create an array to store the textures
    let spriteNames = ["walk_left", "walk_right", "attack_left", "attack_right"];
    let animalNames = ["bear", "deer"]
    animalNames.forEach(animal => {
        let sheet = PIXI.Loader.shared.resources[`/assets/spritesheet/${animal}.json`].spritesheet;
        textures[animal] = {list: [], byKey: {}};
        for (let i = 0; i < spriteNames.length; i++) {
            const texture = sheet.textures[`${animal}_${spriteNames[i]}.png`];
            textures[animal].list.push(texture);
            textures[animal].byKey[spriteNames[i]] = texture;
        }    
    })
    
    // Load hunter sprite sheet (12 rows x 9 columns)
    // Extract frames from the sheet: all rows, columns 0-8
    const hunterSheet = PIXI.Texture.from('/assets/images/hunter2.png');
    const baseTexture = hunterSheet.baseTexture;
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
            hunterFrames.push(frameTexture);
        }
    }
    
    console.log("Pixi assets loaded successfully");
}

class Map {
    constructor(width, height, options, callback) {
        this.width = width;
        this.height = height;
        this.scenery = {};
        this.animalImages = {};
        this.nodes = [];
        const scenery = [
            {type: "tree", frequency: 4},
            {type: "playground", frequency: 0}
        ]
        const animal_types = [
            {type: "deer", frequency: 50, isMokemon: false},
            {type: "bear", frequency: 8, isMokemon: false},
            {type: "squirrel", frequency: 80, isMokemon: false},
        ]
        const terrain = {type: "forest"};
        scenery.forEach((item, i) => {
            this.scenery[item.type] = [];
            try {
                this.scenery[item.type] = {type: item.type, textures: [], frequency: item.frequency};
                // For playground (single image), load just one texture
                if (item.type === "playground") {
                    this.scenery[item.type].textures[0] = PIXI.Texture.from(`/assets/images/${item.type}.png`);
                    for (let n = 1; n < 5; n++) {
                        this.scenery[item.type].textures[n] = this.scenery[item.type].textures[0]; // Reuse single texture
                    }
                } else {
                    // For trees, rocks, etc., load 5 variants
                    for (let n = 0; n < 5; n++) {
                        this.scenery[item.type].textures[n] = PIXI.Texture.from(`/assets/images/${item.type.replace(' ', '')}${n}.png`);
                    }
                }
            }
            catch{
                this.scenery[item.type] = undefined;
            }

        })
        animal_types.forEach((animal, i) => {
            if (animal.frequency > 0 && !animal.isMokemon) {
                this.animalImages[animal.type] = PIXI.Texture.from(`./assets/images/animals/${animal.type}.png`);
            } else if (animal.frequency > 0 && animal.isMokemon) {
                this.animalImages[animal.type] = PIXI.Texture.from(`./assets/images/mokemon/${animal.type}.png`);
            }
        })

        // loading background images as Pixi textures
        let backgroundTexture = PIXI.Texture.from(`/assets/images/land tiles/${terrain.type}.png`);
        
        // Create 2x2 grid of background tiles positioned edge-to-edge
        // This ensures the background fills the screen without gaps
        const bgSprites = [];
        for (let ty = 0; ty < 2; ty++) {
            for (let tx = 0; tx < 2; tx++) {
                const bgSprite = new PIXI.Sprite(backgroundTexture);
                bgSprite.x = tx * app.screen.width;
                bgSprite.y = ty * app.screen.height;
                bgSprite.width = app.screen.width;
                bgSprite.height = app.screen.height;
                landLayer.addChild(bgSprite);
                bgSprites.push(bgSprite);
            }
        }
        landTileSprite = bgSprites;

        console.log("generating nodes...");

        for (let x = -1; x < this.width; x++) {
            this.nodes[x] = [];
            for (let y = -1; y < this.height; y++) {
                this.nodes[x][y] = {
                    x: x * .866,
                    y: y + (x % 2 === 0 ? 0.5 : 0),
                    xindex: x,
                    yindex: y
                };

                Object.keys(this.scenery).forEach(index => {
                    let item = this.scenery[index];
                    if (!this.nodes[Math.max(x-1, -1)][y].object 
                    && !this.nodes[x][Math.max(y-1,-1)].object 
                    && !this.nodes[Math.max(x-1, -1)][Math.max(x-1, -1)].object 
                    && !this.nodes[x][y].blocked
                    && Math.random() * 100 < item.frequency) {
                        let pixiSprite = new PIXI.Sprite(item.textures[Math.floor(Math.random() * 5)]);
                        
                        let mapObject = {
                            pixiSprite: pixiSprite,
                            type: item.type,
                            width: 4,
                            height: 4,
                            x: x,
                            y: y
                        }
        
                        if (item.type === "rock") {
                            mapObject.height = .25 + Math.random() * .5;
                            mapObject.width = .25 + Math.random() * .5;
                        }
                        else if (item.type === "cactus") {
                            mapObject.height = 2;
                            mapObject.width = 1;
                        }

                        // mapObject.offset = {x: -mapObject.width / 2 + 0.25, y: -mapObject.height + 1}
                        mapObject.pixiSprite.anchor.set(0.5, 1);
                        this.nodes[x][y].object = mapObject;
                    }
                })
            }
        }
        animal_types.forEach((animal, i) => {
            console.log("generating animals:", animal.type);
            for (let n = 0; n < animal.frequency; n++) {
                const x = Math.floor(Math.random() * this.width);
                const y = Math.floor(Math.random() * this.height);
                let animalInstance;
                
                // Create the appropriate animal subclass
                switch(animal.type) {
                    case 'deer':
                        animalInstance = new Deer(x, y, this);
                        break;
                    case 'bear':
                        animalInstance = new Bear(x, y, this);
                        break;
                    case 'squirrel':
                        animalInstance = new Squirrel(x, y, this);
                        break;
                    case 'scorpion':
                        animalInstance = new Scorpion(x, y, this);
                        break;
                    case 'armadillo':
                        animalInstance = new Armadillo(x, y, this);
                        break;
                    case 'coyote':
                        animalInstance = new Coyote(x, y, this);
                        break;
                    case 'goat':
                        animalInstance = new Goat(x, y, this);
                        break;
                    case 'porcupine':
                        animalInstance = new Porcupine(x, y, this);
                        break;
                    case 'yeti':
                        animalInstance = new Yeti(x, y, this);
                        break;
                    default:
                        animalInstance = new Animal(animal.type, x, y, this);
                }
                
                animals.push(animalInstance);
            }
        })
        
        // // Special handling: spawn playground near player start
        // const startX = Math.floor(this.width / 2);
        // const startY = Math.floor(this.height / 2);
        // let playgroundSpawned = false;
        // for (let dx = -5; dx <= 5 && !playgroundSpawned; dx++) {
        //     for (let dy = -5; dy <= 5; dy++) {
        //         const px = startX + dx;
        //         const py = startY + dy;
        //         if (this.nodes[px] && this.nodes[px][py] && !this.nodes[px][py].object && !this.nodes[px][py].blocked) {
        //             let pixiSprite = new PIXI.Sprite(this.scenery["playground"].textures[0]);
        //             let playground = {
        //                 pixiSprite: pixiSprite,
        //                 type: "playground",
        //                 width: 4,
        //                 height: 3,
        //                 x: px,
        //                 y: py,
        //                 blocksDiamond: true
        //             };
        //             playground.pixiSprite.anchor.set(0.5, 1);
        //             this.nodes[px][py].object = playground;
                    
        //             // Block the 4 tiles in a horizontal diamond pattern for pathfinding
        //             // Use proper hex neighbor offsets based on whether px is even or odd
        //             // Diamond: one above, one up-left, one up-right (current tile has object, doesn't need blocked flag)
        //             let diamondTiles = [];
        //             diamondTiles.push({x: px, y: py - 1}); // Up
                    
        //             if (px % 2 === 0) {
        //                 // Even column: left and right at same y level
        //                 diamondTiles.push(
        //                     {x: px - 1, y: py},      // Left
        //                     {x: px + 1, y: py}       // Right
        //                 );
        //             } else {
        //                 // Odd column: up-left and up-right are offset up
        //                 diamondTiles.push(
        //                     {x: px - 1, y: py - 1},  // Up-left
        //                     {x: px + 1, y: py - 1}   // Up-right
        //                 );
        //             }
                    
        //             for (let tile of diamondTiles) {
        //                 if (this.nodes[tile.x] && this.nodes[tile.x][tile.y]) {
        //                     this.nodes[tile.x][tile.y].blocked = true;
        //                 }
        //             }
                    
        //             playgroundSpawned = true;
        //             break;
        //         }
        //     }
        // }
        
        if (callback) setTimeout(() => callback(this), 100 );
    }

    findPath(startingNode, destinationNode) {
        let directions = [];
        let startingPoint = {x: this.nodes[startingNode.x][startingNode.y].x, y: this.nodes[startingNode.x][startingNode.y].y};
        let destinationPoint = {x: this.nodes[destinationNode.x][destinationNode.y].x, y: this.nodes[destinationNode.x][destinationNode.y].y};
        if (startingNode.x % 2 === 0) {
            directions = [
                {x: 0, y: -1, index: 3},
                {x: 1, y: 0, index: 5},
                {x: 1, y: 1, index: 7},
                {x: 0, y: 1, index: 9},
                {x: -1, y: 1, index: 11},
                {x: -1, y: 0, index: 1},

                {x: 1, y: -1, index: 4},
                {x: 2, y: 0, index: 6},
                {x: 1, y: 2, index: 8},
                {x: -1, y: 2, index: 10},
                {x: -2, y: 0, index: 0},
                {x: -1, y: -1, index: 2},
            ]
        }
        else {
            directions = [
                {x: 0, y: -1, index: 3},
                {x: 1, y: -1, index: 5},
                {x: 1, y: 0, index: 7},
                {x: 0, y: 1, index: 9},
                {x: -1, y: 0, index: 11},
                {x: -1, y: -1, index: 1},

                {x: 1, y: -2, index: 4},
                {x: 2, y: 0, index: 6},
                {x: 1, y: 1, index: 8},
                {x: -1, y: 1, index: 10},
                {x: -2, y: 0, index: 0},
                {x: -1, y: -2, index: 2}
            ]
        }
        for (let n = 0; n < 12; n++) {
            if (n > 5) {
                directions[n].blockers = [n - 6, (n - 5) % 6]
                directions[n].distFactor = .577;
            }
        }
        // find the available direction which gets us closest
        let bestDistance = Infinity;
        let bestDirection = -1;
        for (let n = 0; n < directions.length; n++) {
            let x = startingNode.x + directions[n].x;
            let y = startingNode.y + directions[n].y;
            if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
                if (!this.nodes[x][y].object && !this.nodes[x][y].blocked) {
                    let blocked = false;
                    if (directions[n].blockers) {
                        directions[n].blockers.forEach(d => {
                            let x = startingNode.x + directions[d].x;
                            let y = startingNode.y + directions[d].y;
                            if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
                                if (this.nodes[startingNode.x + directions[d].x][startingNode.y + directions[d].y].object){
                                    blocked = true;
                                }
                            }
                        })
                    }
                    if (!blocked) {
                        let moveToPoint = {
                            x: this.nodes[x][y].x,
                            y: this.nodes[x][y].y
                        }
                        let xdist = destinationPoint.x - startingPoint.x - (moveToPoint.x - startingPoint.x) * (directions[n].distFactor || 1);
                        let ydist = destinationPoint.y - startingPoint.y - (moveToPoint.y - startingPoint.y) * (directions[n].distFactor || 1);
                
                        let dist = xdist ** 2 + ydist ** 2;
                        if (dist < bestDistance) {
                            bestDistance = dist;
                            bestDirection = n;
                        }
                    }
                }
                else if (x === destinationNode.x && y === destinationNode.y && n < 6) {
                    return {x: 0, y: 0}
                }
            }
        }
        return directions[bestDirection];
    }
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
        this.x = hunter.x + hunter.offset.x;
        this.y = hunter.y + hunter.offset.y + (hunter.x % 2 === 0 ? 0.5 : 0);
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
            this.landedWorldX = this.x * mapHexWidth;
            this.landedWorldY = this.y * mapHexHeight;
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

class Mokeball extends Projectile {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/mokeball.png";
        this.delayTime = 1;
    }
    land() {
        animals.forEach((animal, n) => {
            let margin = 1;
            if (animal._onScreen && !animal.dead) {
                const targetCoors = displayCoors(animal);
                targetCoors.y += animal.height / 2;
                let dist = approxDist(this.x, this.y, targetCoors.x, targetCoors.y);
                if (dist < margin) {
                    if (animal.hp > 20) {
                        // that shit don't work on bears
                        this.movement.z = 1 / this.bounceFactor;
                        this.movement.max = Infinity;
                        this.bounced--;
                        this.bounce();
                        if (animal.chaseRadius > 0) animal.attack(this);
                    }
                    else {
                        let messageText = `You caught: ${animal.type}!` 
                        if (animal.isMokemon) {
                            player.posse.push({
                                name: animal.type,
                                health: animal.hp
                            })
                        }
                        else if (animal.foodValue > 0) messageText += `  You gain ${animal.foodValue} food.`;
                        message(messageText);
                        player.food += animal.foodValue;
                        hunter.food += animal.foodValue;
                        animal.catch(this.x, this.y - this.z);
                        // stop bouncing
                        this.bounced = this.bounces;
                        this.visible = false;
                        saveGame();
                    }
                }
            }
        })
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
                    let dist = approxDist(this.x, this.y, targetCoors.x, targetCoors.y);
                    if (dist < margin) {
                        console.log('blast radius: ', dist);
                        let damage = Math.min(40 / dist / Math.max(dist - 1, 1), 40);
                        console.log('damage: ', damage);
                        animal.hp -= damage;
                        if (animal.hp <= 0) {
                            let messageText = `You killed: ${animal.type}!` 
                            if (animal.foodValue > 0) messageText += `  You gain ${animal.foodValue} food.`;
                            message(messageText);
                            player.food += animal.foodValue;
                            hunter.food += animal.foodValue;
                            animal.explode(this.x, this.y - this.z);
                            saveGame();
                        }
                        else if (animal.chaseRadius > 0) animal.attack(this);
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
                    let dist = approxDist(this.x, this.y, targetCoors.x, targetCoors.y);
                    if (dist < margin) {
                        animal.hp -= 1;
                        if (animal.hp <= 0) {
                            let messageText = `You killed: ${animal.type}!` 
                            if (animal.foodValue > 0) messageText += `  You gain ${animal.foodValue} food.`;
                            player.food += animal.foodValue;
                            hunter.food += animal.foodValue;
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
                                animal.attack(this);
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
        this.damageRadius = 1.5;
        this.delayTime = 2;
    }
    throw(targetX, targetY) {
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
        this.x = hunter.x + hunter.offset.x;
        this.y = hunter.y + hunter.offset.y + (hunter.x % 2 === 0 ? 0.5 : 0);
        this.z = 0;
        
        let xdist = (targetX - this.x);
        let ydist = targetY - this.y;
        this.totalDist = approxDist(0, 0, xdist, ydist);
        
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
                let dist = approxDist(this.x, this.y, animal.x, animal.y);
                if (dist < this.damageRadius) {
                    let damage = 0.1; // Damage per frame
                    animal.hp -= damage;
                    animal.ignite(5);
                    if (animal.chaseRadius > 0) animal.attack(hunter);
                    if (animal.fleeRadius > 0 && !animal.attacking) animal.flee();
                }
            }
        });
        
        // Check for trees/objects in range
        for (let x = Math.floor(this.x - this.damageRadius); x <= Math.ceil(this.x + this.damageRadius); x++) {
            for (let y = Math.floor(this.y - this.damageRadius); y <= Math.ceil(this.y + this.damageRadius); y++) {
                if (map.nodes[x] && map.nodes[x][y] && map.nodes[x][y].object) {
                    const obj = map.nodes[x][y].object;
                    if (obj.type === "tree" || obj.type === "playground") {
                        // Check if fireball is within object's bounding box (including height)
                        const objLeft = obj.x - (obj.width || 4) / 2;
                        const objRight = obj.x + (obj.width || 4) / 2;
                        const objBottom = obj.y;
                        const objTop = obj.y - (obj.height || 4);
                        
                        const withinX = this.x >= objLeft && this.x <= objRight;
                        const withinY = this.y >= objTop && this.y <= objBottom;
                        
                        if (withinX && withinY) {
                            // Don't re-ignite objects that are already burned or falling
                            if (obj.burned || (obj.rotation && obj.rotation > 0) || obj.fireFadeStart !== undefined || obj.hp <= 0) {
                                continue;
                            }
                            if (!obj.hp) obj.hp = 100;
                            obj.hp -= 1;
                            obj.isOnFire = true;
                            obj.fireDuration = 25 * frameRate;
                        }
                    }
                }
            }
        }
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
                let dist = approxDist(this.x, this.y, animal.center_x, animal.center_y);
                if (dist < margin) {
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
        this.fireFrameIndex = 0;
    }
    getDirectionRow() {
        if (!this.direction) return 0;
        return (this.direction.x > 0 || (this.direction.x === 0 && this.direction.y > 0)) ? 1 : 0;
    }
    move() {
        if (this.x !== this.destination.x || this.y !== this.destination.y) {
            this.moving = true;
            if (this.travelFrames === 0) {
                this.offset = {x: 0, y: 0};
                this.throwing = false;
                // console.log(this.x, this.y);

                if (this.nextNode) {
                    this.x = this.nextNode.xindex;
                    this.y = this.nextNode.yindex;
                }
                if (this.y === this.destination.y && this.x === this.destination.x) return;
                else {
                    let currentDirectionIndex = Number.isInteger(this.direction?.index) ? this.direction.index : 0;
                    this.direction = this.map.findPath(this, this.destination);
                    if (!Number.isInteger(this.direction?.index)) {
                        this.direction.index = currentDirectionIndex;
                    }
                    // don't do a 180 course reversal. just don't. it looks stupid and gets you stuck in a loop.
                    // if (Math.abs(this.direction.index - currentDirection.index) === 3) {
                    //     this.direction = currentDirection;
                    // }
                    if (this.direction.x === 0 && this.direction.y === 0) {
                        this.destination = {x: this.x, y: this.y}
                        return;
                    }
                    this.nextNode = this.map.nodes[this.x + this.direction.x][this.y + this.direction.y];
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
        this.fireDuration = duration * frameRate; // Fire lasts for the specified duration
        if (!this.fireSprite) {
            this.fireSprite = new PIXI.Sprite(PIXI.Texture.from('./assets/images/fire_spritesheet.png'));
            this.fireSprite.anchor.set(0.5, 1);
            characterLayer.addChild(this.fireSprite);
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

class Hunter extends Character {
    constructor(x, y, map) {
        super('human', x, y, map);
        this.speed = 2.5;
        this.frameRate = 60;
        this.ammo = "fireball";
        this.throwDelayTime = 0.3; // configurable delay in seconds before throwing
        this.image = $("<img>").attr('src', './assets/images/hunter.png')[0];
        this.moveInterval = setInterval(() => {this.move()}, 1000 / this.frameRate);
        this.food = 0;
        this.hp = 40;
        this.name = 'you';
        
        // Wizard hat positioning constants
        this.hatBrimOffsetX = 0;
        this.hatBrimOffsetY = -0.375;
        this.hatBrimWidth = 0.5;
        this.hatBrimHeight = 0.15;
        this.hatPointOffsetX = 0;
        this.hatPointOffsetY = -0.4;
        this.hatPointHeight = 0.35;
        this.hatColor = 0x000099; // Royal Blue
        this.hatBandColor = 0xFFD700; // Gold
        
        // Create wizard hat graphics
        this.hatGraphics = new PIXI.Graphics();
        characterLayer.addChild(this.hatGraphics);
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
        this.lastDirectionRow = (bestDir.index + hunterDirectionRowOffset + 12) % 12;
    }
    move() {
        if (paused) return;

        super.move();
        const realX = this.x + this.offset.x;
        const realY = this.y + this.offset.y + (this.x % 2 === 0 ? 0.5 : 0);
        viewport.upperbound = {
            x: realX - viewport.width / 2 + viewport.width * viewport.innerWindow.width / 2,
            y: realY - viewport.height / 2 + viewport.height * viewport.innerWindow.height / 2
        }
        viewport.lowerbound = {
            x: realX - viewport.width / 2 - viewport.width * viewport.innerWindow.width / 2,
            y: realY - viewport.height / 2 - viewport.height * viewport.innerWindow.height / 2
        }
        viewport.x = Math.min(Math.max(Math.min(viewport.x, viewport.upperbound.x), viewport.lowerbound.x, 0), mapWidth - viewport.width)
        viewport.y = Math.min(Math.max(Math.min(viewport.y, viewport.upperbound.y), viewport.lowerbound.y, 0), mapHeight - viewport.height)
    }
    throw(worldX, worldY) {
        if (this.throwDelay) return;
        let projectile;
        let delayTime;
        if (hunter.ammo === "mokeballs") {
            if (player.mokeballs <= 0) return;
            player.mokeballs--;
            projectile = new Mokeball();
        }
        else if (hunter.ammo === "grenades") {
            if (player.grenades <= 0) return;
            player.grenades--;
            projectile = new Grenade();
        }
        else if (hunter.ammo === "rocks") {
            projectile = new Rock();
        }
        else if (hunter.ammo === "fireball") {
            projectile = new Fireball();
        }
        delayTime = projectile.delayTime || this.throwDelayTime;
        $('div[name="mokeballs"').html(`mokeballs (${player.mokeballs})`)
        $('div[name="grenades"').html(`grenades (${player.grenades})`)
        $("#selectedAmmo").text($(`div[name="${hunter.ammo}"`).text() + " ▼")

        this.throwDelay = true;
        projectiles.push(projectile.throw(worldX, worldY))
        hunter.throwing = true;
        if (hunter.nextNode) {
            hunter.destination.x = hunter.nextNode.xindex || hunter.x;
            hunter.destination.y = hunter.nextNode.yindex || hunter.y;
        }
        setTimeout(() => {
            this.throwDelay = false;
            this.throwing = false;
        }, 1000 * delayTime);
    }
}

class Animal extends Character {
    constructor(type, x, y, map) {
        super(type, x, y, map);
        this.frameRate = 60;
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
        this.move();
    }
    move() {
        if (this.dead) return;
        if (paused) return;

        // wander around
        if (!this.moving || Math.random() * this.randomMotion * this.frameRate < 1 && this.speed == this.walkSpeed) {
            this.destination.x = Math.min(Math.max(Math.floor(Math.random() * 50 - 25 + this.x), 0), this.map.width - 1);
            this.destination.y = Math.min(Math.max(Math.floor(Math.random() * 50 - 25 + this.y), 0), this.map.height - 1);
            this.speed = this.walkSpeed;
        }

        super.move();
        // maintain a reasonable framerate only when visible
        if (this.travelFrames === 0) {
            this.frameRate = this.onScreen ? 30 : this.speed;
        }
        setTimeout(() => {
            this.move();
        }, 1000 / this.frameRate);

        // face the correct direction
        if (this.direction && !this.attacking && this.frameCount.y > 1) {
            if (this.direction.x > 0 || this.direction.x === 0 && this.direction.y > 0) {
                this.imageFrame.y = 1;
            }
            else {
                this.imageFrame.y = 0;
            }
        }
        let dist = approxDist(this.x, this.y, hunter.x, hunter.y);
        if (dist < this.fleeRadius) {
            this.flee()
        }
        else if (dist < this.chaseRadius) {
            this.attack(hunter);
        }
    }
    get onScreen() {
        this._onScreen = false;
        if (this.x + this.width + 5 > viewport.x && this.y + this.height + 5 > viewport.y) {
            if (this.x - this.width - 5 < viewport.x + viewport.width && this.y - this.height - 5 < viewport.y + viewport.height) {
                this._onScreen = true;
            }
        }
        return this._onScreen;
    }
    flee() {
        // flee the player
        let dist = approxDist(this.x, this.y, hunter.x, hunter.y);

        let xdist = this.x - hunter.x;
        let ydist = this.y - hunter.y;
        this.destination.x = Math.floor(Math.max(Math.min(this.x + xdist / dist * 10, this.map.width - 1), 0));  
        this.destination.y = Math.floor(Math.max(Math.min(this.y + ydist / dist * 10, this.map.height - 1), 0));  
        this.speed = this.runSpeed;
    }
    attack(target) {
        this.destination.x = target.x;
        this.destination.y = target.y;
        this.speed = this.runSpeed;
        this.attacking = this.attacking || 1;
        let dist = approxDist(this.x, this.y, target.x, target.y);
        if (dist < 1 && this.attacking == 1) {
            this.attacking = 2
            if (this.spriteCols > 1) this.spriteCol = 1;
            this.imageFrame.y = (this.x + this.offset.x > target.x + target.offset.x) ? 0 : 1;
            let damage = Math.floor((1 - Math.random() * Math.random()) * this.damage + 1);
            message(`${this.type} ${this.attackVerb} ${target.name} for ${damage} damage!`)
            setTimeout(() => {
                if (this.spriteCols > 1) this.spriteCol = 0;
                this.attacking = 1;
            }, 1000);
        }
    }
    catch(x, y) {
        this.dead = 1;
        // what we want is 
        // (this.y + this.offset.y) * mapHexHeight === y
        // and
        // (this.x + this.offset.x) * mapHexWidth === x
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
        let dist = approxDist(this.x + this.offset.x, realY, x, y);
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

class Squirrel extends Animal {
    constructor(x, y, map) {
        super('squirrel', x, y, map);
        this.spriteSheet = {
            rows: 2,
            cols: 1,
            framePaths: [
                "./assets/images/animals/squirrel_left.png",
                "./assets/images/animals/squirrel_right.png"
            ]
        };
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

class Mokemon extends Animal {
    constructor(type, x, y) {
        super(type, x, y);
        this.isMokemon = true;
        this.image =$("<img>").attr('src', `./assets/images/mokemon/${type}.png`)[0]
        if (this.type==="Apismanion") {
            this.frameCount = {x: 1, y: 1};
            this.width = .875;
            this.height = 1;
            this.walkSpeed = 1;
            this.runSpeed = 2;
            this.fleeRadius = 10;
            this.foodValue = 100;
            this.hp = 10;
        }
        if (this.type==="Dezzy") {
            this.frameCount = {x: 1, y: 1};
            this.width = .75;
            this.height = 1.2;
            this.walkSpeed = 1;
            this.runSpeed = 2;
            this.fleeRadius = 10;
            this.foodValue = 160;
            this.hp = 9;
        }
        if (this.type==="Mallowbear") {
            this.frameCount = {x: 1, y: 1};
            this.width = 1;
            this.height = 1.2;
            this.walkSpeed = 1;
            this.runSpeed = 2;
            this.fleeRadius = 6;
            this.hp = 20;
            this.foodValue = 200;
        }
        if (this.type==="Marlequin"){
            this.frameCount = {x: 1, y: 1};
            this.width = .75;
            this.height = 1;
            this.walkSpeed = 1;
            this.runSpeed = 3;
            this.fleeRadius = 10;
            this.foodValue = 90;
            this.hp = 11;
            this.randomMotion = 3;
        }
        if (this.type==="Wingmat"){
            this.frameCount = {x: 1, y: 1};
            this.width = 1.75;
            this.height = 1;
            this.walkSpeed = 1;
            this.runSpeed = 2;
            this.fleeRadius = 10;
            this.foodValue = 210;
            this.hp = 10;

        }
        if (this.type==="Zyant"){
            this.frameCount = {x: 1, y: 1};
            this.width = 1.2;
            this.height = 1.2;
            this.walkSpeed = 1;
            this.runSpeed = 2;
            this.fleeRadius = 10;
            this.foodValue = 200;
            this.hp = 15;
        }
        if (this.type==="Shadowdragon"){
            this.frameCount = {x: 1, y: 2};
            this.width = 2;
            this.height = 1.75;
            this.walkSpeed = .75;
            this.runSpeed = 3;
            this.chaseRadius = 10;
            this.attackVerb = "strikes";
            this.damage = 75;
            this.foodValue = 350;
            this.hp = 45;
        }
    }
    get onScreen() {
        // disappears if you already have one of this type
        this._onScreen = super.onScreen;
        return (player.posse.map(moke => moke.name).includes(this.type) ? false : super.onScreen);
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
        
        if (hunter && hunter.x !== undefined) {
            playerWithinViewport = {
                x: (hunter.x - viewport.x) / viewport.width,
                y: (hunter.y - viewport.y) / viewport.height
            }
        }
        if (window.innerWidth > window.innerHeight) {
            viewport.width = 31;
            viewport.height = 17;
        }
        else {
            viewport.height = 28;
            viewport.width = 20;
        }

        if (hunter && hunter.x !== undefined) {
            viewport.x = Math.min(Math.max(0, hunter.x - playerWithinViewport.x * viewport.width), mapWidth - viewport.width);
            viewport.y = Math.min(Math.max(0, hunter.y - playerWithinViewport.y * viewport.height), mapHeight - viewport.height);
        }
        mapHexHeight = app.screen.width / viewport.width * 1.1547;
        mapHexWidth = mapHexHeight * .866;

        // Reposition background tiles after resize
        updateLandLayer();
    }

    // Initialize viewport sizing on first load
    sizeView();

    if (player.mokeballs === undefined) player.mokeballs = 30;
    if (player.grenades === undefined) player.grenades = 12;
    if (player.time === undefined) player.time = 0;
    if (player.food === undefined) player.food = 0;
    player.hour = 0;

    let location =  "The Forest of Doom";

    console.log("Generating map...");
    map = new Map(mapHeight, mapWidth, {}, () => {
        frameRate = 30;
        setTimeout(() => {
            message("Click to move.  Right-click or double-tap to throw.")
        }, 1000);
        setTimeout(() => {
            message("Use F and G, or tap the menu to switch weapons.")
        }, 3000);

        setInterval(() => {
            if (paused) return;
            drawCanvas();
            frameCount ++;
        }, 1000 / frameRate);
    });

    // count down til dark
    function timeDown() {
        player.time ++;
        if (player.time > 24) {
            player.time = 0;
            player.day ++;
        }
        player.hour ++;
        hoursTilDark = parseInt(14 - player.hour); 
        $("#time").text('Hours til dark: '+ hoursTilDark);
        if (hoursTilDark == 0) {
            player.messages.push(`You scored ${hunter.food} food while hunting.`);
            saveGame();
            msgBox('darkness', `The sun has gone down.  You head back to camp with your day's catch of ${hunter.food} food.`,
            [{text: "ok", function: () => {
                window.location.href = `/journey?name=${player.name}&auth=${player.authtoken}`;
            }}]);
        }
        else {
            setTimeout(timeDown, 6400);
        }
    }    
    if (player.time) timeDown();

    hunter = new Hunter(mapWidth/2, mapHeight/2, map);
    sizeView();

    hunter.weapons = [
        'mokeballs',
        'grenades',
        'rocks',
        'fireball'
    ]

    // set player weapons and controls
    $("#selectedAmmo").text(`fireball (∞) ▼`)
    hunter.weapons.forEach(weapon => {
        $("#ammoSelect").append(
            $("<div>")
            .addClass("ammo")
            .addClass("outline")
            .attr('name', weapon)
        )
    })
    refreshWeapons();
    $(".ammo").hide();
    $("#selectedAmmo").click(() => {
        $(".ammo").show();
    })
    function refreshWeapons() {
        hunter.weapons.forEach(weapon => {
            $(`div[name=${weapon}]`).html(`${weapon} (${player[weapon] !== undefined ? player[weapon] : '∞'})`)
        })
        $("#selectedAmmo").text($(`div[name="${hunter.ammo}"`).text() + " ▼")
    }
    $(".ammo").click(event => {
        hunter.ammo = $(event.target).attr('name');
        refreshWeapons();
        $(".ammo").hide();
    });
    app.view.addEventListener("click", () => {$(".ammo").hide()})

    app.view.addEventListener("mousemove", event => {
        let rect = app.view.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        // Store exact world coordinates for pixel-accurate aiming
        mousePos.worldX = screenX / mapHexWidth + viewport.x;
        mousePos.worldY = screenY / mapHexHeight + viewport.y;
        // Also store hex tile for movement
        const dest = screenToHex(screenX, screenY);
        mousePos.x = dest.x;
        mousePos.y = dest.y;
    })

    app.view.addEventListener("click", event => {
        let rect = app.view.getBoundingClientRect();
        const dest = screenToHex(event.clientX - rect.left, event.clientY - rect.top);
        hunter.destination.x = dest.x;
        hunter.destination.y = dest.y;

        if (map.nodes[hunter.destination.x] && map.nodes[hunter.destination.x][hunter.destination.y] && map.nodes[hunter.destination.x][hunter.destination.y].object) {
            console.log(map.nodes[hunter.destination.x][hunter.destination.y].object.type, "x", hunter.destination.x, "y", hunter.destination.y);
        }
    })

    app.view.addEventListener("dblclick", event => {
        let rect = app.view.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        const worldX = screenX / mapHexWidth + viewport.x;
        const worldY = screenY / mapHexHeight + viewport.y;
        hunter.throw(worldX, worldY);
    })        
    app.view.addEventListener("contextmenu", event => {
        event.preventDefault();
        let rect = app.view.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        const worldX = screenX / mapHexWidth + viewport.x;
        const worldY = screenY / mapHexHeight + viewport.y;
        hunter.throw(worldX, worldY);
    })        
    $("#msg").contextmenu(event => event.preventDefault())
    $(document).keypress(event => {
        if (event.key === "f") {
            hunter.ammo = hunter.weapons[(hunter.weapons.indexOf(hunter.ammo) - 1 + hunter.weapons.length) % hunter.weapons.length]
        }
        if (event.key === "g") {
            hunter.ammo = hunter.weapons[(hunter.weapons.indexOf(hunter.ammo) + 1) % hunter.weapons.length]
        }
        refreshWeapons();
    })
    $(document).keydown(event => {
        if (event.key === " " || event.code === "Space") {
            event.preventDefault();
            // Stop hunter movement
            hunter.destination.x = hunter.x;
            hunter.destination.y = hunter.y;
            // Turn toward mouse position
            hunter.turnToward(mousePos.x, mousePos.y);
            // Throw after delay
            setTimeout(() => {
                hunter.throw(mousePos.worldX, mousePos.worldY);
            }, hunter.throwDelayTime * 1000);
        }
    })

})

function drawCanvas() {
    // Update land layer position (tiling background)
    updateLandLayer();

    drawHexGrid();
    
    // Clear and rebuild object layer with sorted items
    objectLayer.removeChildren();
    
    let mapItems = [];
    for (let y = Math.floor(viewport.y) - 1; y < Math.min(viewport.y + viewport.height + 3, mapHeight); y++) {
        for (let x = Math.floor(viewport.x / 2) * 2 - 1; x < viewport.x + viewport.width + 2; x+= 2) {
            if (map.nodes[x]) {
                if (map.nodes[x][y].object) {
                    mapItems.push(map.nodes[x][y].object);
                }
            }
        }
        for (let x = Math.floor(viewport.x / 2) * 2 - 2; x < viewport.x + viewport.width + 2; x+= 2) {
            if (map.nodes[x]) {
                if (map.nodes[x][y].object) {
                    mapItems.push(map.nodes[x][y].object);
                }
            }
        }
    }
    animals.forEach(animal => {
        if (animal._onScreen && !animal.gone) {
            mapItems.push(animal);
        }
    })

    mapItems.sort((a, b) => displayCoors(a).y > displayCoors(b).y ? 1: -1);
    
    const hunterCoors = displayCoors(hunter);
    
    // Update burning trees and playgrounds
    mapItems.forEach(item => {
        if (item.type === "tree" || item.type === "playground") {
            // Initialize max HP on first fire ignition
            if (item.isOnFire && !item.maxHP) {
                item.maxHP = 100;
            }
            
            // Gradually turn black as item burns (start at 50% HP)
            if (item.maxHP && item.hp !== undefined) {
                const hpThreshold = item.maxHP * 0.5;
                if (item.hp < hpThreshold) {
                    // Tint from white (0xffffff) to black (0x000000) as HP goes from 50% to 0%
                    const blackProgress = Math.max(0, (hpThreshold - item.hp) / hpThreshold);
                    const brightness = Math.floor(255 * (1 - blackProgress * 0.8));
                    const tintValue = (brightness << 16) | (brightness << 8) | brightness;
                    item.pixiSprite.tint = tintValue;
                }
            }
            
            // Reduce HP while on fire
            if (item.isOnFire) {
                if (item.hp > 0) {
                    item.hp -= 0.5; // Burn damage over time
                }
            }
            
            // Start falling when HP reaches 0 (only for trees, not playgrounds)
            if (item.type === "tree" && (item.hp <= 0 || item.burned)) {
                if (!item.burned) {
                    item.burned = true;
                    item.rotation = 0;
                    item.pixiSprite.tint = 0x222222; // Ensure fully black
                    // Set random fall direction
                    item.fallDirection = Math.random() < 0.5 ? 'left' : 'right';
                    item.fallStart = frameCount; // Track when fall started
                }
                
                // Gradually fall over with acceleration that tops out at 1.5°/frame
                const absRotation = Math.abs(item.rotation);
                if (absRotation < 90) {
                    // Calculate elapsed frames since fall started
                    const framesSinceFall = frameCount - item.fallStart;
                    // Accelerating ease-in, but capped at 1.5 degrees per frame
                    // Reaches max speed around frame 60, then maintains it
                    const accelFactor = Math.min(framesSinceFall / 40, 1); // Reach max by frame 40
                    const rotationRate = 1.5 * accelFactor; // Scale from 0 to 1.5 deg/frame
                    const sign = item.fallDirection === 'right' ? 1 : -1;
                    item.rotation += sign * rotationRate;
                    
                    // Snap to final rotation
                    if (absRotation > 90) {
                        item.rotation = item.fallDirection === 'right' ? 90 : -90;
                    }
                } else {
                    item.rotation = item.fallDirection === 'right' ? 90 : -90;
                    if (item.isOnFire) {
                        // Once tree is fully fallen, start fading fire
                        item.isOnFire = false;
                        item.fireFadeStart = frameCount;
                    }
                }
            }
            
            // For playgrounds, destroy when HP reaches 0 (fade out fire instead of falling)
            if (item.type === "playground" && item.hp <= 0 && !item.burned) {
                item.burned = true;
                item.pixiSprite.tint = 0x222222; // Ensure fully black
                if (item.isOnFire) {
                    item.isOnFire = false;
                    item.fireFadeStart = frameCount;
                }
            }
            
            // Fade out fire after tree falls
            if (item.fireFadeStart !== undefined) {
                const fadeFrames = 120; // ~4 seconds at 30fps
                const timeSinceFade = frameCount - item.fireFadeStart;
                if (timeSinceFade > fadeFrames) {
                    item.fireAlphaMult = 0;
                } else {
                    item.fireAlphaMult = Math.max(0, 1 - (timeSinceFade / fadeFrames));
                }
            }
        }
    });
    
    // Add sorted items to object layer
    mapItems.forEach(item => {
        if (item.pixiSprite) {
            applySpriteTransform(item);
            // Update sprite alpha for occlusion
            itemCoors = displayCoors(item);
            let itemLeft = itemCoors.x - ((item.width || 1) * mapHexHeight) / 2;
            let itemRight = itemCoors.x + ((item.width || 1) * mapHexHeight) / 2;
            let itemTop = itemCoors.y - (item.height || 1) * mapHexHeight;
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
            const hunterPixelWidth = (hunter.width || 1) * mapHexHeight;
            const hunterPixelHeight = (hunter.height || 1) * mapHexHeight;

            const hunterLeft = hunterCoors.x - hunterPixelWidth / 2;
            const hunterRight = hunterCoors.x + hunterPixelWidth / 2;
            const hunterTop = hunterCoors.y - hunterPixelHeight / 2;
            const hunterBottom = hunterCoors.y + hunterPixelHeight / 2;

            const overlapX = Math.max(0, Math.min(itemRight, hunterRight) - Math.max(itemLeft, hunterLeft));
            const overlapY = Math.max(0, Math.min(itemBottom, hunterBottom) - Math.max(itemTop, hunterTop));
            const overlapArea = overlapX * overlapY;
            const hunterArea = Math.max(1, hunterPixelWidth * hunterPixelHeight);
            const overlapRatio = Math.max(0, Math.min(overlapArea / hunterArea, 1));

            let fadeRatio = overlapRatio;
            let shouldFade = itemCoors.y > hunterCoors.y && itemCoors.y - itemPixelHeight < hunterCoors.y && overlapRatio > 0;

            // Softer approach fade for fallen trees using trapezoid bounds
            if (item.type === "tree" && item.taperBounds) {
                const xOverlapRatio = Math.max(0, Math.min(overlapX / hunterPixelWidth, 1));
                const fadeRange = hunterPixelHeight * 0.1; // Very tight approach range
                let verticalProximity = 0;

                // Calculate distance from hunter top to item bottom
                const distToBottom = hunterTop - itemBottom;
                
                // Only fade when hunter is below or within the tree's vertical bounds
                if (distToBottom > 0 && distToBottom < fadeRange) {
                    // Approaching from below - fade increases as distance decreases
                    verticalProximity = 1 - (distToBottom / fadeRange);
                } else if (hunterTop >= itemTop && hunterTop <= itemBottom) {
                    // Hunter is within the vertical bounds of the tree - maintain full fade
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

            if (shouldFade) {
                item.pixiSprite.alpha = 1 - 0.5 * smoothFade;
            } else {
                item.pixiSprite.alpha = 1;
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
                const itemHeight = (item.height || 1) * mapHexHeight;
                
                // Calculate fire position accounting for tree rotation
                // Tree rotates around its anchor point (bottom center for trees)
                // Fire should stay at the center of the tree but remain upright
                if (item.rotation && item.type === "tree") {
                    const rotRad = item.rotation * (Math.PI / 180);
                    // Center of tree rotates around anchor point
                    const centerOffsetX = (itemHeight / 2) * Math.sin(rotRad);
                    const centerOffsetY = -(itemHeight / 2) * Math.cos(rotRad);
                    item.fireSprite.x = fireCoors.x + centerOffsetX;
                    item.fireSprite.y = fireCoors.y + centerOffsetY;
                } else {
                    item.fireSprite.x = fireCoors.x;
                    item.fireSprite.y = fireCoors.y - itemHeight / 2;
                }
                
                item.fireSprite.anchor.set(0.5, 1); // Bottom center of fire at position
                
                // Scale fire size based on HP loss
                if (item.maxHP && item.hp !== undefined) {
                    const hpLossRatio = Math.max(0, (item.maxHP - item.hp) / item.maxHP);
                    let fireScale = 0.5 + hpLossRatio * 1.5; // Scale from 0.5x to 2x
                    
                    // During fade phase, shrink fire proportionally
                    const alphaMult = item.fireAlphaMult !== undefined ? item.fireAlphaMult : 1;
                    fireScale *= alphaMult;
                    
                    item.fireSprite.width = (item.width || 1) * mapHexHeight * fireScale;
                    item.fireSprite.height = (item.height || 1) * mapHexHeight * fireScale;
                } else {
                    item.fireSprite.width = (item.width || 1) * mapHexHeight;
                    item.fireSprite.height = (item.height || 1) * mapHexHeight;
                }
                
                // Apply alpha fade
                const alphaMult = item.fireAlphaMult !== undefined ? item.fireAlphaMult : 1;
                item.fireSprite.alpha = item.pixiSprite.alpha * alphaMult;
                item.fireSprite.rotation = 0; // Fire stays upright
                objectLayer.addChild(item.fireSprite);
            }
        }
    });

    drawHunter();
    drawWizardHat(hunter, 0, 0); // Hat position will be calculated inside the function
    drawProjectiles();
    
    $('#msg').html(messages.join("<br>"))
}

function drawHexGrid() {
    if (!showHexGrid) {
        if (gridGraphics) gridGraphics.visible = false;
        return;
    }

    if (!gridGraphics) {
        gridGraphics = new PIXI.Graphics();
        gridLayer.addChild(gridGraphics);
    }
    gridGraphics.visible = true;
    gridGraphics.clear();

    const hexWidth = mapHexHeight * 1.1547;
    const hexHeight = mapHexHeight;
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
            const centerX = node.xindex * mapHexWidth - viewport.x * mapHexWidth;
            const centerY = (node.yindex + (node.xindex % 2 === 0 ? 0.5 : 0)) * mapHexHeight - viewport.y * mapHexHeight;

            const isBlocked = !!node.object || !!node.blocked;
            const hasAnimal = animalTiles.has(`${x},${y}`);
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
        x: (item.x + (item.offset?.x || 0)) * mapHexWidth,
        y: (item.y + (item.offset?.y || 0) + (item.x % 2 === 0 ? 0.5 : 0)) * mapHexHeight - (item.z || 0)
    }
}

function displayCoors(item) {
    const world = worldCoors(item);
    return {
        x: world.x - viewport.x * mapHexWidth,
        y: world.y - viewport.y * mapHexHeight
    }
}

function screenToHex(screenX, screenY) {
    const worldX = screenX / mapHexWidth + viewport.x;
    const worldY = screenY / mapHexHeight + viewport.y;

    const approxCol = Math.round(worldX);
    const approxRow = Math.round(worldY - (approxCol % 2 === 0 ? 0.5 : 0));

    let best = {x: approxCol, y: approxRow};
    let bestDist = Infinity;

    for (let cx = approxCol - 1; cx <= approxCol + 1; cx++) {
        for (let cy = approxRow - 1; cy <= approxRow + 1; cy++) {
            if (cx < 0 || cy < 0 || cx >= mapWidth || cy >= mapHeight) continue;
            const centerX = cx * mapHexWidth - viewport.x * mapHexWidth;
            const centerY = (cy + (cx % 2 === 0 ? 0.5 : 0)) * mapHexHeight - viewport.y * mapHexHeight;
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
    item.pixiSprite.width = (item.width || 1) * mapHexHeight;
    item.pixiSprite.height = (item.height || 1) * mapHexHeight;
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
    const offsetX = -(viewport.x * mapHexWidth) % bgWidth;
    const offsetY = -(viewport.y * mapHexHeight) % bgHeight;
    
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

function drawHunter() {
    if (!hunter.pixiSprite) {
        hunter.pixiSprite = new PIXI.Sprite(hunterFrames[0] || PIXI.Texture.WHITE);
        characterLayer.addChild(hunter.pixiSprite);
    }
    
    // Determine which row (direction) to use
    if (hunter.lastDirectionRow === undefined) hunter.lastDirectionRow = 0;
    let rowIndex = hunter.lastDirectionRow;
    if (hunter.moving && hunter.direction && Number.isInteger(hunter.direction.index) && hunter.direction.index >= 0) {
        rowIndex = (hunter.direction.index + hunterDirectionRowOffset + 12) % 12;
        hunter.lastDirectionRow = rowIndex;
    }
    
    // Determine which frame (column) to show for animation
    let frameIndex = rowIndex * 9; // Start of this row
    if (hunter.moving) {
        // Columns 1-8 = running animation (8 frames)
        // Column 0 = standing still
        const animFrame = Math.floor(frameCount * animationSpeedMultiplier / 2) % 8;
        frameIndex = rowIndex * 9 + 1 + animFrame;
    }
    
    // Set the texture to the appropriate frame
    if (hunterFrames[frameIndex]) {
        hunter.pixiSprite.texture = hunterFrames[frameIndex];
    }
    
    // Update hunter sprite position
    let hunterScreenX = (hunter.x - viewport.x + hunter.offset.x) * mapHexWidth;
    let hunterScreenY = (hunter.y - viewport.y + hunter.offset.y + (hunter.x % 2 === 0 ? 0.5 : 0)) * mapHexHeight;
    
    hunter.pixiSprite.x = hunterScreenX;
    hunter.pixiSprite.y = hunterScreenY;
    hunter.pixiSprite.anchor.set(0.5, 0.5);
    hunter.pixiSprite.width = mapHexHeight * 1.1547;
    hunter.pixiSprite.height = mapHexHeight;
}


function drawWizardHat(hunter, hunterScreenX, hunterScreenY) {
    // Recalculate screen position
    hunterScreenX = (hunter.x - viewport.x + hunter.offset.x) * mapHexWidth;
    hunterScreenY = (hunter.y - viewport.y + hunter.offset.y + (hunter.x % 2 === 0 ? 0.5 : 0)) * mapHexHeight;
    
    hunter.hatGraphics.clear();
    
    // Calculate hat brim position (blue oval)
    const brimX = hunterScreenX + hunter.hatBrimOffsetX * mapHexWidth;
    const brimY = hunterScreenY + hunter.hatBrimOffsetY * mapHexHeight;
    const brimWidth = hunter.hatBrimWidth * mapHexWidth;
    const brimHeight = hunter.hatBrimHeight * mapHexHeight;
    const pointWidth = hunter.hatBrimWidth * mapHexWidth * 0.6;
    const bandInnerHeight = brimHeight * 0.4;
    const bandInnerWidth = pointWidth * 0.8;
    const bandOuterWidth = pointWidth;
    const bandOuterHeight = brimHeight / brimWidth * bandOuterWidth;

    // Draw hat brim (oval/ellipse)
    hunter.hatGraphics.beginFill(hunter.hatColor, 1);
    hunter.hatGraphics.drawEllipse(brimX, brimY, brimWidth / 2, brimHeight / 2);
    hunter.hatGraphics.endFill();
    
    // Draw hat band outer (gold oval, slightly smaller than brim)

    hunter.hatGraphics.beginFill(hunter.hatBandColor, 1);
    hunter.hatGraphics.drawEllipse(brimX, brimY, bandOuterWidth / 2, bandOuterHeight / 2);
    hunter.hatGraphics.endFill();
    
    // Draw hat band inner (blue oval, smaller, same width as point)

    hunter.hatGraphics.beginFill(hunter.hatColor, 1);
    hunter.hatGraphics.drawEllipse(brimX, brimY, bandInnerWidth / 2, bandInnerHeight / 2);
    hunter.hatGraphics.drawRect(brimX - bandInnerWidth / 2, brimY - bandInnerHeight, bandInnerWidth, bandInnerHeight);
    hunter.hatGraphics.endFill();
    
    // Calculate hat point position (blue triangle)
    const pointX = hunterScreenX + hunter.hatPointOffsetX * mapHexWidth;
    const pointY = hunterScreenY + hunter.hatPointOffsetY * mapHexHeight;
    const pointHeight = hunter.hatPointHeight * mapHexHeight;
    
    // Draw hat point (triangle)
    hunter.hatGraphics.beginFill(hunter.hatColor, 1);
    hunter.hatGraphics.moveTo(pointX, pointY - pointHeight); // Top point
    hunter.hatGraphics.lineTo(pointX - pointWidth / 2, pointY); // Bottom left
    hunter.hatGraphics.lineTo(pointX + pointWidth / 2, pointY); // Bottom right
    hunter.hatGraphics.closePath();
    hunter.hatGraphics.endFill();
    
    // Ensure hat graphics are rendered on top by moving to end of container
    if (hunter.hatGraphics.parent && characterLayer.children.indexOf(hunter.hatGraphics) !== characterLayer.children.length - 1) {
        characterLayer.removeChild(hunter.hatGraphics);
        characterLayer.addChild(hunter.hatGraphics);
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
            ball.pixiSprite.x = ball.landedWorldX - viewport.x * mapHexWidth;
            ball.pixiSprite.y = ball.landedWorldY - viewport.y * mapHexHeight;
        } else {
            const ballWorldX = ball.x * mapHexWidth;
            const ballWorldY = (ball.y - ball.z) * mapHexHeight;
            ball.pixiSprite.x = ballWorldX - viewport.x * mapHexWidth;
            ball.pixiSprite.y = ballWorldY - viewport.y * mapHexHeight;
        }
        
        ball.pixiSprite.width = ball.apparentSize;
        ball.pixiSprite.height = ball.apparentSize;
        ball.pixiSprite.visible = true;
        
        remainingBalls.push(ball)
    })
    projectiles = remainingBalls;
}

function approxDist (x1, y1, x2, y2) {
    return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), (Math.abs(x1 - x2) + Math.abs(y1 - y2)) * .707)
}

function message (text) {
    messages.push(text);
    setTimeout(() => {
        messages.shift();
    }, 8000);
}