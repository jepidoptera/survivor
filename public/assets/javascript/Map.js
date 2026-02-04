class MapNode {
    constructor(x, y, mapWidth, mapHeight) {
        this.x = x * 0.866;
        this.y = y + (x % 2 === 0 ? 0.5 : 0);
        this.xindex = x;
        this.yindex = y;
        
        // Initialize neighbors array with length 12
        // Indices correspond to hunter sprite rows, starting with left and going counterclockwise:
        // 0: left, 1: up-left, 2: up, 3: up-right, 4: right, 5: down-right
        // 6: down, 7: down-left, 8-11: double-distance variants
        this.neighbors = new Array(12).fill(null);
        this.neighborOffsets = new Array(12).fill(null);
        
        // Track which walls are blocking each neighbor direction
        // Map<direction, Set<wallObjects>>
        this.blockedNeighbors = new Map();

        // Multiple static objects can occupy the same tile
        this.objects = [];
        this.blockedByObjects = 0;
        this.blocked = false;
        
        // Define direction offsets based on even/odd column
        // All indices follow counterclockwise from left
        const isEven = x % 2 === 0;
        let offsets;
        
        if (isEven) {
            offsets = [
                {x: -2, y: 0},   // 0: far left
                {x: -1, y: 0},   // 1: up-left
                {x: -1, y: -1},  // 2: far up-left
                {x: 0, y: -1},    // 3: up
                {x: 1, y: -1},   // 4: far up-right
                {x: 1, y: 0},    // 5: up-right
                {x: 2, y: 0},    // 6: far right
                {x: 1, y: 1},    // 7: down-right
                {x: 1, y: 2},    // 8: far down-right
                {x: 0, y: 1},    // 9: down
                {x: -1, y: 2},   // 10: far down left
                {x: -1, y: 1},   // 11: down-left
            ];
        } else {
            offsets = [
                {x: -2, y: 0},   // 0: far left
                {x: -1, y: -1},  // 1: up-left
                {x: -1, y: -2},  // 2: far up-left
                {x: 0, y: -1},   // 3: up
                {x: 1, y: -2},   // 4: far up-right
                {x: 1, y: -1},   // 5: up-right
                {x: 2, y: 0},    // 6: far right
                {x: 1, y: 0},    // 7: down-right
                {x: 1, y: 1},    // 8: far down-right
                {x: 0, y: 1},    // 9: down
                {x: -1, y: 1},   // 10: far down left
                {x: -1, y: 0},   // 11: down-left
            ];
        }
        
        // Store offsets and validate neighbors are within map bounds
        for (let i = 0; i < offsets.length; i++) {
            const offset = offsets[i];
            const nx = x + offset.x;
            const ny = y + offset.y;
            
            // Only store offset if the neighbor would be within map bounds
            if (nx >= -1 && nx < mapWidth && ny >= -1 && ny < mapHeight) {
                this.neighborOffsets[i] = offset;
            }
        }
    }
    
    setNeighbors(nodes) {
        // Populate the neighbors array after all nodes are created
        for (let i = 0; i < this.neighborOffsets.length; i++) {
            if (this.neighborOffsets[i]) {
                const offset = this.neighborOffsets[i];
                const nx = this.xindex + offset.x;
                const ny = this.yindex + offset.y;
                this.neighbors[i] = nodes[nx][ny];
            }
        }
    }

    addObject(obj) {
        if (!this.objects) this.objects = [];
        this.objects.push(obj);
        if (obj.blocksTile !== false) {
            this.blockedByObjects += 1;
        }
    }

    removeObject(obj) {
        if (!this.objects) return;
        const idx = this.objects.indexOf(obj);
        if (idx !== -1) this.objects.splice(idx, 1);
        if (obj.blocksTile !== false) {
            this.blockedByObjects = Math.max(0, this.blockedByObjects - 1);
        }
    }

    hasObjects() {
        return !!(this.objects && this.objects.length > 0);
    }

    hasBlockingObject() {
        return this.blockedByObjects > 0;
    }
}

class GameMap {
    constructor(width, height, options, callback) {
        this.width = width;
        this.height = height;
        this.scenery = {};
        this.animalImages = {};
        this.nodes = [];
        this.hexHeight = 1;
        this.hexWidthRatio = 1.2;
        this.hexWidth = this.hexHeight * this.hexWidthRatio;

        const scenery = [
            {type: "tree", frequency: 4},
            {type: "playground", frequency: 0}
        ]
        const animal_types = [
            {type: "squirrel", frequency: 180, isMokemon: false},
            {type: "deer", frequency: 75, isMokemon: false},
            {type: "bear", frequency: 14, isMokemon: false},
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
                this.nodes[x][y] = new MapNode(x, y, this.width, this.height);
                
                // Randomly spawn scenery on this node
                Object.keys(this.scenery).forEach(index => {
                    let item = this.scenery[index];
                        if (!this.nodes[Math.max(x-1, -1)][y].hasObjects()
                        && !this.nodes[x][Math.max(y-1,-1)].hasObjects()
                        && !this.nodes[Math.max(x-1, -1)][Math.max(x-1, -1)].hasObjects()
                        && !this.nodes[x][y].blocked
                    && Math.random() * 100 < item.frequency) {
                        let staticObject;
                        let width = 4;
                        let height = 4;
                        
                        if (item.type === "tree") {
                            staticObject = new Tree(x, y, item.textures, this);
                        }
                        else if (item.type === "wall") {
                            width = 1;
                            height = 2;
                            staticObject = new Wall(x, y, item.textures, this);
                        }
                        else if (item.type === "rock") {
                            width = .25 + Math.random() * .5;
                            height = .25 + Math.random() * .5;
                            staticObject = new StaticObject(item.type, x, y, width, height, item.textures, this);
                        }
                        else if (item.type === "cactus") {
                            width = 1;
                            height = 2;
                            staticObject = new StaticObject(item.type, x, y, width, height, item.textures, this);
                        }
                        else if (item.type === "playground") {
                            staticObject = new Playground(x, y, item.textures, this);
                        }
                        else {
                            staticObject = new StaticObject(item.type, x, y, width, height, item.textures, this);
                        }
                    }
                })
            }
        }
        
        // Now that all nodes are created, populate their neighbor references
        for (let x = -1; x < this.width; x++) {
            for (let y = -1; y < this.height; y++) {
                this.nodes[x][y].setNeighbors(this.nodes);
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
        
        if (callback) setTimeout(() => callback(this), 100 );
    }

    findPath(startingNode, destinationNode) {
        const startingNodeObj = this.nodes[startingNode.x][startingNode.y];
        const destinationNodeObj = this.nodes[destinationNode.x][destinationNode.y];
        const startingPoint = {x: startingNodeObj.x, y: startingNodeObj.y};
        const destinationPoint = {x: destinationNodeObj.x, y: destinationNodeObj.y};
        
        // Even indices are far (diagonal) moves, odd indices are adjacent moves
        // Blocker pairs for far moves: the two adjacent directions that flank the far direction
        const blockerPairs = [
            [11, 1], // 0: far left (between down-left and up-left)
            null,    // 1: up-left (adjacent)
            [1, 3],  // 2: far up-left (between up-left and up)
            null,    // 3: up (adjacent)
            [3, 5],  // 4: far up-right (between up and up-right)
            null,    // 5: up-right (adjacent)
            [5, 7],  // 6: far right (between up-right and down-right)
            null,    // 7: down-right (adjacent)
            [7, 9],  // 8: far down-right (between down-right and down)
            null,    // 9: down (adjacent)
            [9, 11], // 10: far down-left (between down and down-left)
            null     // 11: down-left (adjacent)
        ];
        const distFactors = [0.577, 1, 0.577, 1, 0.577, 1, 0.577, 1, 0.577, 1, 0.577, 1];
        
        let bestDistance = Infinity;
        let bestDirection = -1;
        
        // Try each of the 12 neighbor directions
        for (let n = 0; n < 12; n++) {
            const neighborNode = startingNodeObj.neighbors[n];
            
            // Skip if this direction has no neighbor (edge of map)
            if (!neighborNode) continue;
            
            // Skip if this direction is blocked by wall connectors
            const blockingWalls = startingNodeObj.blockedNeighbors ? startingNodeObj.blockedNeighbors.get(n) : null;
            if (blockingWalls && blockingWalls.size > 0) continue;
            
            // Skip if the neighbor is blocked or has an object
                if (neighborNode.hasBlockingObject() || neighborNode.blocked) continue;
            
            let canMove = true;
            
            // For double-distance moves, check if adjacent tiles are blocked
            if (blockerPairs[n]) {
                const [blocker1, blocker2] = blockerPairs[n];
                const blockerNode1 = startingNodeObj.neighbors[blocker1];
                const blockerNode2 = startingNodeObj.neighbors[blocker2];
                
                    if ((blockerNode1 && blockerNode1.hasBlockingObject()) || (blockerNode2 && blockerNode2.hasBlockingObject())) {
                    canMove = false;
                }
            }
            
            if (!canMove) continue;
            
            // Check if we reached the destination
            if (neighborNode.xindex === destinationNode.x && neighborNode.yindex === destinationNode.y) {
                return {
                    x: neighborNode.xindex - startingNode.x,
                    y: neighborNode.yindex - startingNode.y,
                    direction: n
                };
            }
            
            // Calculate distance to destination
            const moveToPoint = {x: neighborNode.x, y: neighborNode.y};
            const distFactor = distFactors[n];
            const xdist = destinationPoint.x - startingPoint.x - (moveToPoint.x - startingPoint.x) * distFactor;
            const ydist = destinationPoint.y - startingPoint.y - (moveToPoint.y - startingPoint.y) * distFactor;
            const dist = xdist ** 2 + ydist ** 2;
            
            if (dist < bestDistance) {
                bestDistance = dist;
                bestDirection = n;
            }
        }
        
        // If no valid direction found, return no movement
        if (bestDirection === -1) {
            return {x: 0, y: 0, direction: -1};
        }
        
        // Return the offset for the best direction
        const bestNeighbor = startingNodeObj.neighbors[bestDirection];
        return {
            x: bestNeighbor.xindex - startingNode.x,
            y: bestNeighbor.yindex - startingNode.y,
            direction: bestDirection
        };
    }
    
    // Convert world coordinates to the nearest MapNode
    worldToNode(worldX, worldY) {
        // Reverse the world coordinate calculation to get approximate indices
        const approxX = Math.round(worldX / 0.866);
        const approxY = Math.round(worldY - (approxX % 2 === 0 ? 0.5 : 0));
        
        // Search nearby nodes to find the closest one
        let best = null;
        let bestDist = Infinity;
        
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const nx = approxX + dx;
                const ny = approxY + dy;
                if (nx < -1 || nx >= this.width || ny < -1 || ny >= this.height) continue;
                if (!this.nodes[nx] || !this.nodes[nx][ny]) continue;
                
                const node = this.nodes[nx][ny];
                const dist = Math.hypot(node.x - worldX, node.y - worldY);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = node;
                }
            }
        }
        
        return best;
    }
}
