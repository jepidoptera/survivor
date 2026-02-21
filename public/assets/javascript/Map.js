function pointInPolygon2D(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x;
        const yi = points[i].y;
        const xj = points[j].x;
        const yj = points[j].y;
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-7) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function distanceToSegment2D(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const abLen2 = abx * abx + aby * aby;
    if (abLen2 <= 1e-7) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2));
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    return Math.hypot(px - cx, py - cy);
}

function buildBlendedGroundTextureFromBase(baseTexture, options = {}) {
    const source = baseTexture && baseTexture.baseTexture && baseTexture.baseTexture.resource
        ? baseTexture.baseTexture.resource.source
        : null;
    if (!source) return null;

    const outSize = options.outSize || 200;
    const scale = options.scale || 1.1;
    const featherRatio = Number.isFinite(options.featherRatio) ? options.featherRatio : 0.25;
    const featherPx = Math.max(1, featherRatio * outSize);
    const minFeatherAlpha = Number.isFinite(options.minFeatherAlpha) ? options.minFeatherAlpha : 0.0;

    const canvas = document.createElement("canvas");
    canvas.width = outSize;
    canvas.height = outSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const drawSize = outSize * scale;
    const drawOffset = (outSize - drawSize) / 2;
    ctx.clearRect(0, 0, outSize, outSize);
    ctx.drawImage(source, drawOffset, drawOffset, drawSize, drawSize);

    const imageData = ctx.getImageData(0, 0, outSize, outSize);
    const data = imageData.data;

    // Hex matching existing forest tile orientation (flat top/bottom, points on left/right).
    const hex = [
        { x: 0, y: outSize * 0.5 },
        { x: outSize * 0.25, y: 0 },
        { x: outSize * 0.75, y: 0 },
        { x: outSize, y: outSize * 0.5 },
        { x: outSize * 0.75, y: outSize },
        { x: outSize * 0.25, y: outSize }
    ];

    // Feather only the top-facing edges for top-down painter's-order blending.
    // Edge indices in this hex:
    // 0: left-mid -> top-left
    // 1: top-left -> top-right
    // 2: top-right -> right-mid
    // 3: right-mid -> bottom-right
    // 4: bottom-right -> bottom-left
    // 5: bottom-left -> left-mid
    const featherEdgeIndices = [0, 1, 2];

    for (let y = 0; y < outSize; y++) {
        for (let x = 0; x < outSize; x++) {
            const idx = (y * outSize + x) * 4;
            if (!pointInPolygon2D(x + 0.5, y + 0.5, hex)) {
                data[idx + 3] = 0;
                continue;
            }

            let minDist = Infinity;
            for (const i of featherEdgeIndices) {
                const a = hex[i];
                const b = hex[(i + 1) % hex.length];
                const d = distanceToSegment2D(x + 0.5, y + 0.5, a.x, a.y, b.x, b.y);
                if (d < minDist) minDist = d;
            }
            const edgeFactor = Math.max(0, Math.min(1, minDist / featherPx));
            const alphaFactor = minFeatherAlpha + (1 - minFeatherAlpha) * edgeFactor;
            data[idx + 3] = Math.round(255 * alphaFactor);
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return PIXI.Texture.from(canvas);
}

function createRuntimeGroundTexture(texturePath, onReady) {
    const base = PIXI.Texture.from(texturePath);
    const apply = () => {
        const blended = buildBlendedGroundTextureFromBase(base, {
            outSize: 200,
            scale: 1.0,
            featherRatio: 0.25,
            minFeatherAlpha: 0.0
        });
        if (blended && typeof onReady === "function") {
            onReady(blended);
        }
    };
    if (base.baseTexture && base.baseTexture.valid) {
        apply();
    } else if (base.baseTexture) {
        base.baseTexture.once("loaded", apply);
    }
    return base;
}

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
        this.groundTextureId = 0;
        
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
        
        // Store neighbor offsets. Active map tiles keep full offsets so torus
        // stitching can reconnect edges later in setNeighbors.
        for (let i = 0; i < offsets.length; i++) {
            const offset = offsets[i];
            const nx = x + offset.x;
            const ny = y + offset.y;

            const isActiveTile = x >= 0 && x < mapWidth && y >= 0 && y < mapHeight;
            if (isActiveTile) {
                this.neighborOffsets[i] = offset;
            } else if (nx >= -1 && nx < mapWidth && ny >= -1 && ny < mapHeight) {
                this.neighborOffsets[i] = offset;
            }
        }
    }
    
    setNeighbors(nodes, mapRef = null) {
        // Populate the neighbors array after all nodes are created
        for (let i = 0; i < this.neighborOffsets.length; i++) {
            if (this.neighborOffsets[i]) {
                const offset = this.neighborOffsets[i];
                let nx = this.xindex + offset.x;
                let ny = this.yindex + offset.y;

                if (mapRef && this.xindex >= 0 && this.yindex >= 0) {
                    if (mapRef.wrapX) {
                        nx = mapRef.wrapIndexX(nx);
                    }
                    if (mapRef.wrapY) {
                        ny = mapRef.wrapIndexY(ny);
                    }
                }

                this.neighbors[i] = (nodes[nx] && nodes[nx][ny]) ? nodes[nx][ny] : null;
            }
        }
    }

    addObject(obj) {
        if (!this.objects) this.objects = [];
        this.objects.push(obj);
        this.recountBlockingObjects();
    }

    removeObject(obj) {
        if (!this.objects) return;
        const idx = this.objects.indexOf(obj);
        if (idx !== -1) this.objects.splice(idx, 1);
        this.recountBlockingObjects();
    }

    recountBlockingObjects() {
        if (!this.objects || this.objects.length === 0) {
            this.blockedByObjects = 0;
            return;
        }
        let count = 0;
        for (let i = 0; i < this.objects.length; i++) {
            const obj = this.objects[i];
            if (obj && obj.blocksTile !== false) count += 1;
        }
        this.blockedByObjects = count;
    }

    hasObjects() {
        return !!(this.objects && this.objects.length > 0);
    }

    hasBlockingObject() {
        return this.blockedByObjects > 0;
    }
}

class NodeMidpoint {
    constructor(nodeA, nodeB, mapRef) {
        this.nodeA = nodeA;
        this.nodeB = nodeB;
        this.map = mapRef || null;
        this.x = (Number(nodeA && nodeA.x) + Number(nodeB && nodeB.x)) * 0.5;
        this.y = (Number(nodeA && nodeA.y) + Number(nodeB && nodeB.y)) * 0.5;
        this.neighbors = [];

        const pushUnique = (node) => {
            if (!node || typeof node.xindex !== "number" || typeof node.yindex !== "number") return;
            if (this.neighbors.some(existing => existing === node)) return;
            this.neighbors.push(node);
        };

        pushUnique(nodeA);
        pushUnique(nodeB);

        const common = [];
        const neighborsA = (nodeA && Array.isArray(nodeA.neighbors)) ? nodeA.neighbors : [];
        const neighborsB = (nodeB && Array.isArray(nodeB.neighbors)) ? nodeB.neighbors : [];
        for (let i = 0; i < neighborsA.length; i++) {
            const candidate = neighborsA[i];
            if (!candidate || candidate === nodeA || candidate === nodeB) continue;
            if (!neighborsB.includes(candidate)) continue;
            if (common.includes(candidate)) continue;
            common.push(candidate);
        }
        common.sort((left, right) => {
            const ldx = (this.map && typeof this.map.shortestDeltaX === "function")
                ? this.map.shortestDeltaX(this.x, left.x)
                : (left.x - this.x);
            const ldy = (this.map && typeof this.map.shortestDeltaY === "function")
                ? this.map.shortestDeltaY(this.y, left.y)
                : (left.y - this.y);
            const rdx = (this.map && typeof this.map.shortestDeltaX === "function")
                ? this.map.shortestDeltaX(this.x, right.x)
                : (right.x - this.x);
            const rdy = (this.map && typeof this.map.shortestDeltaY === "function")
                ? this.map.shortestDeltaY(this.y, right.y)
                : (right.y - this.y);
            return (ldx * ldx + ldy * ldy) - (rdx * rdx + rdy * rdy);
        });
        for (let i = 0; i < common.length && i < 2; i++) {
            pushUnique(common[i]);
        }
    }
}

class GameMap {
    constructor(width, height, options, callback) {
        const opts = options || {};
        this.width = width;
        this.height = height;
        this.wrapX = opts.wrapX !== false;
        this.wrapY = opts.wrapY !== false;
        if ((this.wrapX || this.wrapY) && ((this.width % 2 !== 0) || (this.height % 2 !== 0)) && typeof console !== "undefined") {
            console.warn("Torus wrap works best with even map dimensions; current size is", this.width, "x", this.height);
        }
        this.scenery = {};
        this.animalImages = {};
        this.nodes = [];
        this.hexHeight = 1;
        this.hexWidth = 1 / 0.866;
        this.worldWidth = this.width * 0.866;
        this.worldHeight = this.height;
        this.groundPalette = [
            "forest0", "forest1", "forest2", "forest3",
            "forest4", "forest5", "forest6", "forest7", "forest8", "forest9",
            "forest10", "forest11", "forest12"
        ];
        this.groundTextures = this.groundPalette.map(() => PIXI.Texture.WHITE);
        this.groundPalette.forEach((name, idx) => {
            const path = `/assets/images/land tiles/${name}.png`;
            this.groundTextures[idx] = createRuntimeGroundTexture(path, (processed) => {
                this.groundTextures[idx] = processed;
                if (typeof invalidateGroundChunks === "function") {
                    invalidateGroundChunks();
                }
            });
        });

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
                        if (item.type === "tree") {
                            this.scenery[item.type].textures[n] = PIXI.Texture.from(`/assets/images/trees/tree${n}.png`);
                        } else {
                            this.scenery[item.type].textures[n] = PIXI.Texture.from(`/assets/images/${item.type.replace(' ', '')}${n}.png`);
                        }
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

        // Ground is rendered per-tile in rendering.js using node.groundTextureId.
        landTileSprite = null;

        console.log("generating nodes...");

        let index = 0;
        for (let x = -1; x < this.width; x++) {
            this.nodes[x] = [];
            for (let y = -1; y < this.height; y++) {
                this.nodes[x][y] = new MapNode(x, y, this.width, this.height);
                this.nodes[x][y].index = index;
                if (x >= 0 && y >= 0) {
                    this.nodes[x][y].groundTextureId = Math.floor(Math.random() * this.groundTextures.length);
                }
                
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
                        
                        const node = this.nodes[x][y];
                        if (item.type === "tree") {
                            staticObject = new Tree(node, item.textures, this);
                        }
                        else if (item.type === "wall") {
                            width = 1;
                            height = 2;
                            staticObject = new Wall(node, item.textures, this);
                        }
                        else if (item.type === "rock") {
                            width = .25 + Math.random() * .5;
                            height = .25 + Math.random() * .5;
                            staticObject = new StaticObject(item.type, node, width, height, item.textures, this);
                        }
                        else if (item.type === "cactus") {
                            width = 1;
                            height = 2;
                            staticObject = new StaticObject(item.type, node, width, height, item.textures, this);
                        }
                        else if (item.type === "playground") {
                            staticObject = new Playground(node, item.textures, this);
                        }
                        else if (item.type === "road") {
                            staticObject = new Road(node, item.textures, this);
                        }
                        else {
                            staticObject = new StaticObject(item.type, node, width, height, item.textures, this);
                        }
                    }
                })
            }
        }
        
        // Now that all nodes are created, populate their neighbor references
        for (let x = -1; x < this.width; x++) {
            for (let y = -1; y < this.height; y++) {
                this.nodes[x][y].setNeighbors(this.nodes, this);
            }
        }
        animal_types.forEach((animal, i) => {
            console.log("generating animals:", animal.type);
            for (let n = 0; n < animal.frequency; n++) {
                const x = Math.floor(Math.random() * this.width);
                const y = Math.floor(Math.random() * this.height);
                const node = this.nodes[x][y];
                let animalInstance;
                
                // Create the appropriate animal subclass
                switch(animal.type) {
                    case 'deer':
                        animalInstance = new Deer(node, this);
                        break;
                    case 'bear':
                        animalInstance = new Bear(node, this);
                        break;
                    case 'squirrel':
                        animalInstance = new Squirrel(node, this);
                        break;
                    case 'scorpion':
                        animalInstance = new Scorpion(node, this);
                        break;
                    case 'armadillo':
                        animalInstance = new Armadillo(node, this);
                        break;
                    case 'coyote':
                        animalInstance = new Coyote(node, this);
                        break;
                    case 'goat':
                        animalInstance = new Goat(node, this);
                        break;
                    case 'porcupine':
                        animalInstance = new Porcupine(node, this);
                        break;
                    case 'yeti':
                        animalInstance = new Yeti(node, this);
                        break;
                    default:
                        animalInstance = new Animal(animal.type, node, this);
                }
                
                animals.push(animalInstance);
            }
        })
        
        if (callback) setTimeout(() => callback(this), 100 );
    }

    findPath(startingNode, destinationNode) {
        
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
        
        const path = [];
        let currentNode = startingNode;
        const visited = new Set();
        if (currentNode) {
            visited.add(`${currentNode.xindex},${currentNode.yindex}`);
        }

        while (currentNode) {
            let bestDistance = Infinity;
            let bestDirection = -1;

            // Try each of the 12 neighbor directions
            for (let n = 0; n < 12; n++) {
                const neighborNode = currentNode.neighbors[n];

                // Skip if this direction has no neighbor (edge of map)
                if (!neighborNode) continue;

                // Skip if this direction is blocked by wall connectors
                const blockingWalls = currentNode.blockedNeighbors ? currentNode.blockedNeighbors.get(n) : null;
                if (blockingWalls && blockingWalls.size > 0) continue;

                // Skip if the neighbor is blocked or has an object
                if (neighborNode.hasBlockingObject() || neighborNode.blocked) continue;

                let canMove = true;

                // For double-distance moves, check if adjacent tiles are blocked
                if (blockerPairs[n]) {
                    const [blocker1, blocker2] = blockerPairs[n];
                    const blockerNode1 = currentNode.neighbors[blocker1];
                    const blockerNode2 = currentNode.neighbors[blocker2];

                    if ((blockerNode1 && blockerNode1.hasBlockingObject()) || (blockerNode2 && blockerNode2.hasBlockingObject())) {
                        canMove = false;
                    }
                }

                if (!canMove) continue;

                // Check if we reached the destination
                if (neighborNode == destinationNode) {
                    path.push(destinationNode);
                    return path;
                }

                // Calculate distance to destination
                const moveToPoint = {x: neighborNode.x, y: neighborNode.y};
                const distFactor = distFactors[n];
                const xdist = this.shortestDeltaX(currentNode.x, destinationNode.x) - this.shortestDeltaX(currentNode.x, moveToPoint.x) * distFactor;
                const ydist = this.shortestDeltaY(currentNode.y, destinationNode.y) - this.shortestDeltaY(currentNode.y, moveToPoint.y) * distFactor;
                const dist = xdist ** 2 + ydist ** 2;

                if (dist < bestDistance) {
                    bestDistance = dist;
                    bestDirection = n;
                }
            }

            // If no valid direction found, return what we have
            if (bestDirection === -1) {
                return path.length ? path : null;
            }

            const bestNeighbor = currentNode.neighbors[bestDirection];
            if (!bestNeighbor) {
                return path.length ? path : null;
            }

            const bestKey = `${bestNeighbor.xindex},${bestNeighbor.yindex}`;
            if (visited.has(bestKey)) {
                return path;
            }

            path.push(bestNeighbor);
            visited.add(bestKey);
            currentNode = bestNeighbor;
        }

        return path.length ? path : null;
    }
    
    // Convert world coordinates to the nearest MapNode
    worldToNode(worldX, worldY) {
        const wrappedWorldX = this.wrapWorldX(worldX);
        const wrappedWorldY = this.wrapWorldY(worldY);

        // Reverse the world coordinate calculation to get approximate indices
        const approxX = this.wrapIndexX(Math.round(wrappedWorldX / 0.866));
        const approxY = this.wrapIndexY(Math.round(wrappedWorldY - (approxX % 2 === 0 ? 0.5 : 0)));
        
        // Search nearby nodes to find the closest one
        let best = null;
        let bestDist = Infinity;
        
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                let nx = approxX + dx;
                let ny = approxY + dy;
                if (this.wrapX) nx = this.wrapIndexX(nx);
                if (this.wrapY) ny = this.wrapIndexY(ny);
                if (nx < -1 || nx >= this.width || ny < -1 || ny >= this.height) continue;
                if (!this.nodes[nx] || !this.nodes[nx][ny]) continue;
                
                const node = this.nodes[nx][ny];
                const dist = Math.hypot(
                    this.shortestDeltaX(node.x, wrappedWorldX),
                    this.shortestDeltaY(node.y, wrappedWorldY)
                );
                if (dist < bestDist) {
                    bestDist = dist;
                    best = node;
                }
            }
        }
        
        return best;
    }

    worldToNodeOrMidpoint(worldX, worldY) {
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const wrappedWorldX = this.wrapWorldX(worldX);
        const wrappedWorldY = this.wrapWorldY(worldY);
        const node = this.worldToNode(wrappedWorldX, wrappedWorldY);
        if (!node) return null;

        const nodeDist = Math.hypot(
            this.shortestDeltaX(node.x, wrappedWorldX),
            this.shortestDeltaY(node.y, wrappedWorldY)
        );

        const midpointDirections = [1, 3, 5, 7, 9, 11];
        let bestMidpoint = null;
        let bestMidpointDist = Infinity;
        const seenPairs = new Set();
        for (let i = 0; i < midpointDirections.length; i++) {
            const dir = midpointDirections[i];
            const neighbor = node.neighbors[dir];
            if (!neighbor || typeof neighbor.xindex !== "number" || typeof neighbor.yindex !== "number") continue;
            const ax = Math.min(node.xindex, neighbor.xindex);
            const ay = Math.min(node.yindex, neighbor.yindex);
            const bx = Math.max(node.xindex, neighbor.xindex);
            const by = Math.max(node.yindex, neighbor.yindex);
            const pairKey = `${ax},${ay}|${bx},${by}`;
            if (seenPairs.has(pairKey)) continue;
            seenPairs.add(pairKey);

            const midpoint = new NodeMidpoint(node, neighbor, this);
            const midDist = Math.hypot(
                this.shortestDeltaX(midpoint.x, wrappedWorldX),
                this.shortestDeltaY(midpoint.y, wrappedWorldY)
            );
            if (midDist < bestMidpointDist) {
                bestMidpointDist = midDist;
                bestMidpoint = midpoint;
            }
        }

        if (bestMidpoint && bestMidpointDist < nodeDist) {
            return bestMidpoint;
        }
        return node;
    }

    _isNodeMidpoint(entity) {
        return entity instanceof NodeMidpoint;
    }

    _resolveHexLineEndpoint(entity) {
        if (!entity) return null;
        if (entity instanceof MapNode) return entity;
        if (this._isNodeMidpoint(entity)) return entity;
        if (Number.isFinite(entity.x) && Number.isFinite(entity.y)) {
            return this.worldToNodeOrMidpoint(entity.x, entity.y);
        }
        return null;
    }

    _hexEntitiesMatch(a, b, eps = 1e-6) {
        if (!a || !b) return false;
        return (
            Math.abs(this.shortestDeltaX(a.x, b.x)) <= eps &&
            Math.abs(this.shortestDeltaY(a.y, b.y)) <= eps
        );
    }

    _chooseMidpointBridgeNode(midpoint, towardEntity) {
        if (!this._isNodeMidpoint(midpoint) || !Array.isArray(midpoint.neighbors) || midpoint.neighbors.length === 0) return null;
        const tx = Number(towardEntity && towardEntity.x);
        const ty = Number(towardEntity && towardEntity.y);
        let bestNode = null;
        let bestDist = Infinity;
        for (let i = 0; i < midpoint.neighbors.length; i++) {
            const node = midpoint.neighbors[i];
            if (!node || typeof node.xindex !== "number" || typeof node.yindex !== "number") continue;
            const dist = Number.isFinite(tx) && Number.isFinite(ty)
                ? Math.hypot(this.shortestDeltaX(node.x, tx), this.shortestDeltaY(node.y, ty))
                : 0;
            if (dist < bestDist) {
                bestDist = dist;
                bestNode = node;
            }
        }
        return bestNode;
    }

    getHexDirection(x, y) {
        if (x === 0 && y === 0) return 0;
        const angle = Math.atan2(-y, x) * (180 / Math.PI);
        let direction = Math.round((180 - angle) / 30);
        if (direction < 0) direction += 12;
        return direction % 12;
    }

    getHexLine(nodeA, nodeB, width = 0) {
        const start = this._resolveHexLineEndpoint(nodeA);
        const end = this._resolveHexLineEndpoint(nodeB);
        if (!start || !end) return [];
        if (this._hexEntitiesMatch(start, end)) return [start];

        // Get the center line first
        if (width == 0 || this._isNodeMidpoint(start) || this._isNodeMidpoint(end)) {
            return this._getSingleHexLine(start, end);
        }

        const nodeStart = start;
        const nodeEnd = end;

        // get direction (0-11) corresponding to the travel vector from A to B
        const firstNeighborDirection = -1
        const dx = this.shortestDeltaX(nodeStart.x, nodeEnd.x);
        const dy = this.shortestDeltaY(nodeStart.y, nodeEnd.y);
        let direction = this.getHexDirection(dx, dy);
        let sideLineStarts = [];
        if (width == 2) {
            if (direction % 2 === 0) {
                sideLineStarts.push((direction + 3) % 12);
            } else {
                sideLineStarts.push((direction + 2) % 12);
            }

        }
        if (width == 3) {
            sideLineStarts.push(1);
            sideLineStarts.push(3);
            sideLineStarts.push(5);
            sideLineStarts.push(7);
            sideLineStarts.push(9);
            sideLineStarts.push(11);
        }        
        
        const startNodes = new Set(this._getSingleHexLine(nodeStart, nodeEnd));
        let allNodes = new Set(startNodes);
        for (let node of startNodes) {
            if (!node || !Array.isArray(node.neighbors)) continue;
            for (let sideStart of sideLineStarts) {
                const sideNode = node.neighbors[sideStart];
                if (sideNode) allNodes.add(sideNode);
            }
        }
        // sideLineStarts.forEach(sideStart => {
        //     // allNodes.add(nodeA.neighbors[(direction + sideStart) % 12])
        //     // allNodes.add(nodeB.neighbors[(direction +sideStart) % 12])
        //     if (sideStart) {
        //         const sideLine = this._getSingleHexLine(
        //             nodeA.neighbors[(direction + sideStart) % 12], 
        //             nodeB.neighbors[(direction + sideStart) % 12]
        //         );
        //         sideLine.forEach(n => allNodes.add(n));
        //     }
        // })
        
        return Array.from(allNodes);
    }
    
    _getSingleHexLine(nodeA, nodeB) {
        if (!nodeA || !nodeB) return [];
        const start = this._resolveHexLineEndpoint(nodeA);
        const end = this._resolveHexLineEndpoint(nodeB);
        if (!start || !end) return [];
        if (this._hexEntitiesMatch(start, end)) return [start];

        const path = [];
        let startNode = start;
        let endNode = end;

        if (this._isNodeMidpoint(start)) {
            path.push(start);
            startNode = this._chooseMidpointBridgeNode(start, end);
        }
        if (this._isNodeMidpoint(end)) {
            endNode = this._chooseMidpointBridgeNode(end, start);
        }
        if (!startNode || !endNode) return path;

        const corePath = this._getSingleHexLineNodes(startNode, endNode);
        for (let i = 0; i < corePath.length; i++) {
            if (!path.length || !this._hexEntitiesMatch(path[path.length - 1], corePath[i])) {
                path.push(corePath[i]);
            }
        }

        if (this._isNodeMidpoint(end)) {
            if (!path.length || !this._hexEntitiesMatch(path[path.length - 1], end)) {
                path.push(end);
            }
        }

        return path;
    }

    _getSingleHexLineNodes(nodeA, nodeB) {
        if (!nodeA || !nodeB) return [];
        let current = this.worldToNode(nodeA.x, nodeA.y);
        const target = this.worldToNode(nodeB.x, nodeB.y);
        if (!current || !target) return [];
        if (current === target) return [current];
        const path = [current];
        const maxSteps = (mapWidth + mapHeight) * 2;

        for (let step = 0; step < maxSteps; step++) {
            if (current === target) break;
            let nextDirection = this.getHexDirection(
                this.shortestDeltaX(current.x, target.x),
                this.shortestDeltaY(current.y, target.y)
            );
            const next = current.neighbors[nextDirection % 12];
            if (!next) break;
            path.push(next);
            
            if (next === target) break;
            current = next;
        }

        return path;
    }

    getGroundTextureId(x, y) {
        const tx = this.wrapX ? this.wrapIndexX(x) : x;
        const ty = this.wrapY ? this.wrapIndexY(y) : y;
        const node = this.nodes[tx] && this.nodes[tx][ty] ? this.nodes[tx][ty] : null;
        if (!node) return 0;
        return Number.isFinite(node.groundTextureId) ? node.groundTextureId : 0;
    }

    setGroundTextureId(x, y, textureId) {
        const tx = this.wrapX ? this.wrapIndexX(x) : x;
        const ty = this.wrapY ? this.wrapIndexY(y) : y;
        const node = this.nodes[tx] && this.nodes[tx][ty] ? this.nodes[tx][ty] : null;
        if (!node) return false;
        const maxId = Math.max(0, (Array.isArray(this.groundTextures) ? this.groundTextures.length : 1) - 1);
        const nextId = Math.max(0, Math.min(maxId, Math.floor(Number(textureId) || 0)));
        if (node.groundTextureId === nextId) return false;
        node.groundTextureId = nextId;
        if (typeof invalidateGroundChunks === "function") {
            invalidateGroundChunks();
        }
        return true;
    }

    normalizeIndex(value, size) {
        const n = Number.isFinite(value) ? Math.floor(value) : 0;
        if (!Number.isFinite(size) || size <= 0) return n;
        const wrapped = ((n % size) + size) % size;
        return wrapped;
    }

    wrapIndexX(value) {
        return this.normalizeIndex(value, this.width);
    }

    wrapIndexY(value) {
        return this.normalizeIndex(value, this.height);
    }

    wrapWorldX(worldX) {
        if (!this.wrapX || !Number.isFinite(worldX) || this.worldWidth <= 0) return worldX;
        return ((worldX % this.worldWidth) + this.worldWidth) % this.worldWidth;
    }

    wrapWorldY(worldY) {
        if (!this.wrapY || !Number.isFinite(worldY) || this.worldHeight <= 0) return worldY;
        return ((worldY % this.worldHeight) + this.worldHeight) % this.worldHeight;
    }

    shortestDeltaX(fromX, toX) {
        let delta = (toX - fromX);
        if (!this.wrapX || !Number.isFinite(delta) || this.worldWidth <= 0) return delta;
        delta = ((delta + this.worldWidth * 0.5) % this.worldWidth + this.worldWidth) % this.worldWidth - this.worldWidth * 0.5;
        return delta;
    }

    shortestDeltaY(fromY, toY) {
        let delta = (toY - fromY);
        if (!this.wrapY || !Number.isFinite(delta) || this.worldHeight <= 0) return delta;
        delta = ((delta + this.worldHeight * 0.5) % this.worldHeight + this.worldHeight) % this.worldHeight - this.worldHeight * 0.5;
        return delta;
    }

    wrapWorldPoint(point) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return point;
        return {
            x: this.wrapWorldX(point.x),
            y: this.wrapWorldY(point.y)
        };
    }
}
