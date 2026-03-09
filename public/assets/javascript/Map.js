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
        this.clearance = Infinity; // min hex-ring distance to nearest obstacle (0 = blocked)
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
        const wasClear = !this.isBlocked();
        this.recountBlockingObjects();
        if (wasClear && this.isBlocked()) {
            // Tile just became blocked — propagate clearance update
            // (skipped when bulk-loading a save with cached clearance).
            if (typeof globalThis !== "undefined" && globalThis.map &&
                !globalThis.map._suppressClearanceUpdates &&
                typeof globalThis.map.updateClearanceAround === "function") {
                globalThis.map.updateClearanceAround(this);
            }
        }
        if (typeof globalThis !== "undefined" && typeof globalThis.invalidateMinimap === "function") {
            globalThis.invalidateMinimap();
        }
    }

    removeObject(obj) {
        if (!this.objects) return;
        const idx = this.objects.indexOf(obj);
        if (idx !== -1) this.objects.splice(idx, 1);
        const wasBlocked = this.isBlocked();
        this.recountBlockingObjects();
        if (wasBlocked && !this.isBlocked()) {
            // Tile just became passable — recompute clearance in neighbourhood
            // (skipped when bulk-loading a save with cached clearance).
            if (typeof globalThis !== "undefined" && globalThis.map &&
                !globalThis.map._suppressClearanceUpdates &&
                typeof globalThis.map.updateClearanceAround === "function") {
                globalThis.map.updateClearanceAround(this);
            }
        }
        if (typeof globalThis !== "undefined" && typeof globalThis.invalidateMinimap === "function") {
            globalThis.invalidateMinimap();
        }
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

    /**
     * Returns true when this tile is impassable (blocked flag or blocking object).
     */
    isBlocked() {
        return this.blocked || this.blockedByObjects > 0;
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
        const _t0 = performance.now();
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

        // Ground is rendered per-tile by the active rendering pipeline using node.groundTextureId.
        landTileSprite = null;

        console.log("generating nodes...");
        const _t1 = performance.now();
        console.log(`[MAP TIMING] setup/textures: ${(_t1 - _t0).toFixed(1)}ms`);

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
        const _t2 = performance.now();
        console.log(`[MAP TIMING] node creation + scenery: ${(_t2 - _t1).toFixed(1)}ms`);
        for (let x = -1; x < this.width; x++) {
            for (let y = -1; y < this.height; y++) {
                this.nodes[x][y].setNeighbors(this.nodes, this);
            }
        }
        const _t3 = performance.now();
        console.log(`[MAP TIMING] setNeighbors: ${(_t3 - _t2).toFixed(1)}ms`);
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
        
        // Compute initial clearance values after all scenery is placed,
        // unless the caller signals a save-file load will supply them.
        if (!opts.skipClearance) {
            const _t4 = performance.now();
            this.computeClearance();
            console.log(`[MAP TIMING] computeClearance: ${(performance.now() - _t4).toFixed(1)}ms`);
        } else {
            console.log(`[MAP TIMING] computeClearance: SKIPPED`);
        }
        const _tEnd = performance.now();
        console.log(`[MAP TIMING] TOTAL constructor: ${(_tEnd - _t0).toFixed(1)}ms`);

        if (callback) setTimeout(() => callback(this), 100 );
    }

    // ── Clearance map ────────────────────────────────────────────────
    // Each node stores `clearance`: the minimum number of hex-ring steps
    // to the nearest blocked tile.  0 = blocked, 1 = adjacent to blocked,
    // Infinity = no obstacle within BFS horizon.
    //
    // Large animals require `node.clearance >= requiredClearanceRings` to
    // pathfind through a tile.

    /**
     * Encode every node's clearance value into a compact base-36 char-grid
     * string (one character per tile, row-major order).  Values 0–35 map
     * to '0'–'z'; Infinity is stored as 'z' (cap at 35).
     * Returns an object shaped like groundTiles for easy JSON storage,
     * or null if the map isn't ready.
     */
    serializeClearance() {
        if (!this.nodes) return null;
        let out = "";
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const node = this.nodes[x] && this.nodes[x][y] ? this.nodes[x][y] : null;
                const raw  = node ? node.clearance : 0;
                const v    = Number.isFinite(raw) ? Math.max(0, Math.min(35, raw)) : 35;
                out += v.toString(36);
            }
        }
        return {
            encoding: "base36-char-grid",
            width:    this.width,
            height:   this.height,
            data:     out
        };
    }

    /**
     * Restore clearance values from a previously serialised char-grid.
     * Returns true on success, false if the data doesn't match.
     */
    deserializeClearance(encoded) {
        if (!this.nodes || !encoded ||
            encoded.encoding !== "base36-char-grid" ||
            typeof encoded.data !== "string") {
            return false;
        }
        if (encoded.width !== this.width || encoded.height !== this.height) {
            return false;
        }
        const expectedLen = this.width * this.height;
        if (encoded.data.length < expectedLen) return false;

        let i = 0;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const node = this.nodes[x] && this.nodes[x][y] ? this.nodes[x][y] : null;
                if (!node) { i++; continue; }
                const v = parseInt(encoded.data[i], 36);
                node.clearance = Number.isFinite(v) ? v : 0;
                // 35 was the cap sentinel — treat it as "far from obstacles"
                // but NOT Infinity, so the saved value round-trips cleanly.
                i++;
            }
        }
        return true;
    }

    /**
     * Full BFS clearance recompute — called once after map generation and
     * optionally after bulk edits.
     */
    computeClearance() {
        // Adjacent-only direction indices (odd indices in the 12-neighbor scheme).
        const adjDirs = [1, 3, 5, 7, 9, 11];

        // Seed queue with all blocked tiles at clearance 0,
        // and tiles with wall-blocked edges at clearance 1
        // (the tile itself is passable but a large entity shouldn't
        // path through it because a wall runs along its edge).
        const queue = []; // entries: [node, clearance]
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const node = this.nodes[x][y];
                if (node.isBlocked()) {
                    node.clearance = 0;
                    queue.push([node, 0]);
                } else {
                    node.clearance = Infinity;
                }
            }
        }

        // Second pass: seed wall-adjacent tiles at clearance 0.
        // Tiles with wall edges are treated as obstacles for clearance
        // purposes — large entities must not overlap them.
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const node = this.nodes[x][y];
                if (node.clearance <= 0) continue; // already seeded
                if (node.blockedNeighbors && node.blockedNeighbors.size > 0) {
                    node.clearance = 0;
                    queue.push([node, 0]);
                }
            }
        }

        let head = 0;
        while (head < queue.length) {
            const [current, dist] = queue[head++];
            const nextDist = dist + 1;
            for (let i = 0; i < adjDirs.length; i++) {
                const neighbor = current.neighbors[adjDirs[i]];
                if (!neighbor) continue;
                if (neighbor.xindex < 0 || neighbor.yindex < 0) continue;
                if (nextDist < neighbor.clearance) {
                    neighbor.clearance = nextDist;
                    queue.push([neighbor, nextDist]);
                }
            }
        }
    }

    /**
     * Incremental clearance update around a single tile — call after a
     * tile's blocked status changes (add/remove object, flip `blocked`).
     * Re-runs BFS outward from a neighbourhood large enough to cover the
     * maximum clearance ring any animal might need.
     *
     * @param {MapNode} centerNode  The node whose status changed.
     * @param {number}  [radius=8]  How many rings outward to recompute.
     */
    updateClearanceAround(centerNode, radius) {
        if (!centerNode) return;
        const r = Number.isFinite(radius) ? Math.max(1, radius) : 8;
        const adjDirs = [1, 3, 5, 7, 9, 11];

        // 1. Collect all nodes within `r` rings of centerNode via BFS.
        const region = new Set();
        const bfs = [[centerNode, 0]];
        region.add(centerNode);
        let head = 0;
        while (head < bfs.length) {
            const [cur, d] = bfs[head++];
            if (d >= r) continue;
            for (let i = 0; i < adjDirs.length; i++) {
                const nb = cur.neighbors[adjDirs[i]];
                if (!nb || nb.xindex < 0 || nb.yindex < 0) continue;
                if (region.has(nb)) continue;
                region.add(nb);
                bfs.push([nb, d + 1]);
            }
        }

        // 2. Reset clearance for all nodes in region, seed blocked ones.
        const seedQueue = [];
        for (const node of region) {
            if (node.isBlocked()) {
                node.clearance = 0;
                seedQueue.push([node, 0]);
            } else {
                node.clearance = Infinity;
            }
        }

        // Seed wall-adjacent tiles in the region at clearance 0.
        for (const node of region) {
            if (node.clearance <= 0) continue;
            if (node.blockedNeighbors && node.blockedNeighbors.size > 0) {
                node.clearance = 0;
                seedQueue.push([node, 0]);
            }
        }

        // Also seed from nodes just outside the region (their clearance is
        // assumed correct and propagates inward).
        for (const node of region) {
            for (let i = 0; i < adjDirs.length; i++) {
                const nb = node.neighbors[adjDirs[i]];
                if (!nb || nb.xindex < 0 || nb.yindex < 0) continue;
                if (region.has(nb)) continue;
                // nb is outside region — its clearance is still valid.
                if (Number.isFinite(nb.clearance)) {
                    seedQueue.push([nb, nb.clearance]);
                }
            }
        }

        // 3. BFS propagation within the region only.
        head = 0;
        while (head < seedQueue.length) {
            const [cur, dist] = seedQueue[head++];
            const nextDist = dist + 1;
            for (let i = 0; i < adjDirs.length; i++) {
                const nb = cur.neighbors[adjDirs[i]];
                if (!nb || !region.has(nb)) continue;
                if (nextDist < nb.clearance) {
                    nb.clearance = nextDist;
                    seedQueue.push([nb, nextDist]);
                }
            }
        }
    }

    findPath(startingNode, destinationNode, options) {
        const opts = options || {};
        // Clearance: number of hex rings that must be obstacle-free around
        // each tile on the path.  0 = legacy point-entity behaviour.
        const requiredClearance = Number.isFinite(opts.clearance)
            ? Math.max(0, Math.floor(opts.clearance))
            : 0;

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

        /**
         * Returns true when the move from currentNode in direction n is
         * passable, respecting walls, blocked tiles, far-move anti-corner-cut,
         * and the clearance requirement for large entities.
         *
         * If the animal is already in a tile that doesn't meet its clearance
         * requirement (e.g. spawned/loaded too close to a wall), moves that
         * improve clearance are allowed so it can escape.
         */
        const canMoveDirection = (currentNode, n) => {
            const neighborNode = currentNode.neighbors[n];
            if (!neighborNode) return false;

            // Wall blocking
            const blockingWalls = currentNode.blockedNeighbors ? currentNode.blockedNeighbors.get(n) : null;
            if (blockingWalls && blockingWalls.size > 0) return false;

            // Tile blocking
            if (neighborNode.hasBlockingObject() || neighborNode.blocked) return false;

            // Anti-corner-cut for far moves
            if (blockerPairs[n]) {
                const [b1, b2] = blockerPairs[n];
                const bn1 = currentNode.neighbors[b1];
                const bn2 = currentNode.neighbors[b2];
                if ((bn1 && bn1.hasBlockingObject()) || (bn2 && bn2.hasBlockingObject())) return false;
            }

            // Clearance check for large entities
            if (requiredClearance > 0) {
                const curCl = Number.isFinite(currentNode.clearance) ? currentNode.clearance : 0;
                const nbCl = Number.isFinite(neighborNode.clearance) ? neighborNode.clearance : 0;
                if (nbCl < requiredClearance) {
                    // Normally blocked, but allow if we're already in a bad
                    // spot and this move improves (or at least doesn't worsen)
                    // our clearance — lets the animal escape to open ground.
                    if (curCl >= requiredClearance || nbCl <= curCl) {
                        return false;
                    }
                }
            }

            return true;
        };

        const path = [];
        let currentNode = startingNode;
        const visited = new Set();
        const maxSteps = Math.max(200, (this.width + this.height));
        let stuckCount = 0; // consecutive times the greedy pick was visited
        if (currentNode) {
            visited.add(`${currentNode.xindex},${currentNode.yindex}`);
        }

        while (currentNode && path.length < maxSteps) {
            // --- build list of all valid (unvisited) neighbor moves ---
            let bestDistance = Infinity;
            let bestDirection = -1;
            const validDirections = []; // indices of passable, unvisited directions

            for (let n = 0; n < 12; n++) {
                if (!canMoveDirection(currentNode, n)) continue;

                const neighborNode = currentNode.neighbors[n];

                // Reached destination?
                if (neighborNode === destinationNode) {
                    path.push(destinationNode);
                    return path;
                }

                const nKey = `${neighborNode.xindex},${neighborNode.yindex}`;
                if (visited.has(nKey)) continue;

                validDirections.push(n);

                // Greedy heuristic: pick the direction closest to destination
                const distFactor = distFactors[n];
                const xdist = this.shortestDeltaX(currentNode.x, destinationNode.x)
                            - this.shortestDeltaX(currentNode.x, neighborNode.x) * distFactor;
                const ydist = this.shortestDeltaY(currentNode.y, destinationNode.y)
                            - this.shortestDeltaY(currentNode.y, neighborNode.y) * distFactor;
                const dist = xdist ** 2 + ydist ** 2;

                if (dist < bestDistance) {
                    bestDistance = dist;
                    bestDirection = n;
                }
            }

            // No valid unvisited direction — stuck for real
            if (validDirections.length === 0) {
                return path.length ? path : null;
            }

            // If the greedy pick keeps hitting dead-ends (stuckCount > 0),
            // try a random valid direction instead to wander around the
            // obstacle.  Resets once forward progress resumes.
            let chosenDirection = bestDirection;
            if (stuckCount > 0 && validDirections.length > 1) {
                // Pick a random direction that isn't the greedy choice,
                // so the animal explores a different route.
                const others = validDirections.filter(d => d !== bestDirection);
                chosenDirection = others[Math.floor(Math.random() * others.length)];
            }

            const chosenNeighbor = currentNode.neighbors[chosenDirection];
            if (!chosenNeighbor) {
                return path.length ? path : null;
            }

            const chosenKey = `${chosenNeighbor.xindex},${chosenNeighbor.yindex}`;
            // Shouldn't happen (we filtered visited above) but guard anyway.
            if (visited.has(chosenKey)) {
                stuckCount++;
                if (stuckCount > 3) return path.length ? path : null;
                continue;
            }

            // Track "stuck": if we moved but got *farther* from the goal
            // than when we started this segment, bump stuckCount.
            const prevDist = bestDistance;
            const newDx = this.shortestDeltaX(chosenNeighbor.x, destinationNode.x);
            const newDy = this.shortestDeltaY(chosenNeighbor.y, destinationNode.y);
            const newDist = newDx * newDx + newDy * newDy;
            if (newDist > prevDist) {
                stuckCount++;
            } else {
                stuckCount = Math.max(0, stuckCount - 1);
            }

            path.push(chosenNeighbor);
            visited.add(chosenKey);
            currentNode = chosenNeighbor;
        }

        return path.length ? path : null;
    }

    findPathAStar(startingNode, destinationNode, options = {}) {
        if (!startingNode || !destinationNode) return null;
        if (startingNode === destinationNode) return [];

        // Keep traversal rules aligned with legacy findPath().
        // Even indices are far moves, odd indices are adjacent moves.
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

        const allowBlockedDestination = options.allowBlockedDestination === true;
        // Clearance requirement: number of hex-ring steps that must be
        // obstacle-free around every tile on the path.  0 = point-entity
        // (default / legacy behaviour).
        const requiredClearance = Number.isFinite(options.clearance)
            ? Math.max(0, Math.floor(options.clearance))
            : 0;

        if (!allowBlockedDestination && (destinationNode.blocked || destinationNode.hasBlockingObject())) {
            return null;
        }
        // If we need clearance, the destination must also satisfy it (unless caller opts out).
        if (
            !allowBlockedDestination &&
            requiredClearance > 0 &&
            destinationNode.clearance < requiredClearance
        ) {
            return null;
        }

        const keyFor = (node) => `${node.xindex},${node.yindex}`;
        const movementCost = (fromNode, toNode) => {
            const dx = this.shortestDeltaX(fromNode.x, toNode.x);
            const dy = this.shortestDeltaY(fromNode.y, toNode.y);
            return Math.hypot(dx, dy);
        };
        const heuristic = (node) => {
            const dx = this.shortestDeltaX(node.x, destinationNode.x);
            const dy = this.shortestDeltaY(node.y, destinationNode.y);
            return Math.hypot(dx, dy);
        };
        const canTraverseDirection = (currentNode, directionIndex) => {
            const neighborNode = currentNode.neighbors[directionIndex];
            if (!neighborNode) return false;

            // Directional wall blocking from current -> neighbor.
            const blockingWalls = currentNode.blockedNeighbors ? currentNode.blockedNeighbors.get(directionIndex) : null;
            if (blockingWalls && blockingWalls.size > 0) return false;

            // Destination occupancy blocking.
            if (
                neighborNode !== destinationNode &&
                (neighborNode.blocked || neighborNode.hasBlockingObject())
            ) {
                return false;
            }

            // Preserve legacy anti-corner-cut for far moves.
            const blockers = blockerPairs[directionIndex];
            if (blockers) {
                const [blocker1, blocker2] = blockers;
                const blockerNode1 = currentNode.neighbors[blocker1];
                const blockerNode2 = currentNode.neighbors[blocker2];
                if (
                    (blockerNode1 && blockerNode1.hasBlockingObject()) ||
                    (blockerNode2 && blockerNode2.hasBlockingObject())
                ) {
                    return false;
                }
            }

            // Clearance check for large entities.
            if (requiredClearance > 0 && neighborNode !== destinationNode) {
                if (!Number.isFinite(neighborNode.clearance) || neighborNode.clearance < requiredClearance) {
                    return false;
                }
            }

            return true;
        };

        const reconstructPath = (cameFrom, currentKey) => {
            const result = [];
            let walkKey = currentKey;
            while (cameFrom.has(walkKey)) {
                const node = openOrClosedNodes.get(walkKey);
                if (node) result.unshift(node);
                walkKey = cameFrom.get(walkKey);
            }
            return result;
        };

        const openSet = new Set();
        const cameFrom = new Map();
        const gScore = new Map();
        const fScore = new Map();
        const openOrClosedNodes = new Map();

        const startKey = keyFor(startingNode);
        const goalKey = keyFor(destinationNode);
        openSet.add(startKey);
        gScore.set(startKey, 0);
        fScore.set(startKey, heuristic(startingNode));
        openOrClosedNodes.set(startKey, startingNode);
        openOrClosedNodes.set(goalKey, destinationNode);

        const maxIterations = Number.isFinite(options.maxIterations)
            ? Math.max(1, Math.floor(options.maxIterations))
            : Math.max(1000, this.width * this.height * 2);

        let iterations = 0;
        while (openSet.size > 0 && iterations < maxIterations) {
            iterations += 1;

            // Pick node in open set with smallest f-score.
            let currentKey = null;
            let currentBestF = Infinity;
            for (const key of openSet) {
                const score = fScore.has(key) ? fScore.get(key) : Infinity;
                if (score < currentBestF) {
                    currentBestF = score;
                    currentKey = key;
                }
            }
            if (!currentKey) break;

            const currentNode = openOrClosedNodes.get(currentKey);
            if (!currentNode) {
                openSet.delete(currentKey);
                continue;
            }

            if (currentKey === goalKey) {
                return reconstructPath(cameFrom, currentKey);
            }

            openSet.delete(currentKey);

            for (let directionIndex = 0; directionIndex < 12; directionIndex++) {
                if (!canTraverseDirection(currentNode, directionIndex)) continue;

                const neighborNode = currentNode.neighbors[directionIndex];
                if (!neighborNode) continue;

                const neighborKey = keyFor(neighborNode);
                openOrClosedNodes.set(neighborKey, neighborNode);

                const currentG = gScore.has(currentKey) ? gScore.get(currentKey) : Infinity;
                const tentativeG = currentG + movementCost(currentNode, neighborNode);
                const existingG = gScore.has(neighborKey) ? gScore.get(neighborKey) : Infinity;
                if (tentativeG >= existingG) continue;

                cameFrom.set(neighborKey, currentKey);
                gScore.set(neighborKey, tentativeG);
                fScore.set(neighborKey, tentativeG + heuristic(neighborNode));
                openSet.add(neighborKey);
            }
        }

        return null;
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

    _normalizeHexDirection(direction) {
        return ((Math.round(Number(direction)) % 12) + 12) % 12;
    }

    _getAdjacentHexDirections() {
        return [1, 3, 5, 7, 9, 11];
    }

    _findAdjacentDirectionBetween(nodeA, nodeB) {
        if (!nodeA || !nodeB || !Array.isArray(nodeA.neighbors)) return null;
        const dirs = this._getAdjacentHexDirections();
        for (let i = 0; i < dirs.length; i++) {
            const dir = dirs[i];
            if (nodeA.neighbors[dir] === nodeB) return dir;
        }
        return null;
    }

    _isAdjacentHexNeighbor(nodeA, nodeB) {
        return Number.isFinite(this._findAdjacentDirectionBetween(nodeA, nodeB));
    }

    _getSingleHexLineNodesAdjacent(nodeA, nodeB) {
        if (!nodeA || !nodeB) return [];
        let current = this.worldToNode(nodeA.x, nodeA.y);
        const target = this.worldToNode(nodeB.x, nodeB.y);
        if (!current || !target) return [];
        if (current === target) return [current];

        const path = [current];
        const dirs = this._getAdjacentHexDirections();
        const maxSteps = Math.max(16, (this.width + this.height) * 4);

        for (let step = 0; step < maxSteps; step++) {
            if (current === target) break;
            let bestNext = null;
            let bestDist = Infinity;
            const prev = path.length > 1 ? path[path.length - 2] : null;

            for (let i = 0; i < dirs.length; i++) {
                const dir = dirs[i];
                const candidate = current.neighbors[dir];
                if (!candidate) continue;
                if (prev && candidate === prev) continue;
                const dist = Math.hypot(
                    this.shortestDeltaX(candidate.x, target.x),
                    this.shortestDeltaY(candidate.y, target.y)
                );
                if (dist < bestDist) {
                    bestDist = dist;
                    bestNext = candidate;
                }
            }

            if (!bestNext && prev) {
                // Dead-end fallback: allow one backtrack if no forward-adjacent step exists.
                bestNext = prev;
            }
            if (!bestNext) break;

            path.push(bestNext);
            if (bestNext === target) break;
            current = bestNext;
        }

        return path;
    }

    _getMidpointDirectionBase(midpoint) {
        if (!this._isNodeMidpoint(midpoint) || !midpoint.nodeA || !midpoint.nodeB) return null;
        const dx = this.shortestDeltaX(midpoint.nodeA.x, midpoint.nodeB.x);
        const dy = this.shortestDeltaY(midpoint.nodeA.y, midpoint.nodeB.y);
        const axisDirection = this._normalizeHexDirection(this.getHexDirection(dx, dy));
        const axisClass = ((axisDirection % 6) + 6) % 6;
        if (axisClass !== 1 && axisClass !== 3 && axisClass !== 5) return null;
        return axisClass;
    }

    _midpointSupportsDirection(midpoint, direction) {
        const base = this._getMidpointDirectionBase(midpoint);
        if (!Number.isFinite(base)) return false;
        const dir = this._normalizeHexDirection(direction);
        return ((dir - base + 12) % 3) === 0;
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
        const centerLine = this._getSingleHexLineNodesAdjacent(nodeStart, nodeEnd);
        if (!Array.isArray(centerLine) || centerLine.length === 0) {
            return this._getSingleHexLine(nodeStart, nodeEnd);
        }

        const startNodes = new Set(centerLine);
        let allNodes = new Set(startNodes);
        if (width <= 1) {
            return Array.from(allNodes);
        }

        if (width == 2) {
            const adjacentDirs = this._getAdjacentHexDirections();
            const sideNodes = [];
            let sideTurn = 1; // pick a consistent side of travel.
            if (centerLine.length >= 2) {
                const firstDir = this._findAdjacentDirectionBetween(centerLine[0], centerLine[1]);
                const secondDir = (centerLine.length >= 3)
                    ? this._findAdjacentDirectionBetween(centerLine[1], centerLine[2])
                    : null;
                if (Number.isFinite(firstDir) && Number.isFinite(secondDir)) {
                    const i0 = adjacentDirs.indexOf(firstDir);
                    const i1 = adjacentDirs.indexOf(secondDir);
                    if (i0 >= 0 && i1 >= 0) {
                        const delta = (i1 - i0 + adjacentDirs.length) % adjacentDirs.length;
                        if (delta === 1) sideTurn = -1;
                        else if (delta === adjacentDirs.length - 1) sideTurn = 1;
                    }
                }
            }

            for (let i = 0; i < centerLine.length; i++) {
                const current = centerLine[i];
                const next = centerLine[i + 1] || null;
                const prev = centerLine[i - 1] || null;
                const travelDir = this._findAdjacentDirectionBetween(current, next)
                    || (prev ? this._findAdjacentDirectionBetween(prev, current) : null);
                if (!Number.isFinite(travelDir)) continue;
                const dirIdx = adjacentDirs.indexOf(travelDir);
                if (dirIdx < 0) continue;
                const sideDir = adjacentDirs[(dirIdx + sideTurn + adjacentDirs.length) % adjacentDirs.length];
                const sideNode = current.neighbors[sideDir];
                if (sideNode) sideNodes.push(sideNode);
            }

            let prevSideNode = null;
            for (let i = 0; i < sideNodes.length; i++) {
                const sideNode = sideNodes[i];
                if (!sideNode) continue;
                allNodes.add(sideNode);
                if (prevSideNode && !this._isAdjacentHexNeighbor(prevSideNode, sideNode)) {
                    const bridge = this._getSingleHexLineNodesAdjacent(prevSideNode, sideNode);
                    for (let b = 0; b < bridge.length; b++) {
                        const bridgeNode = bridge[b];
                        if (bridgeNode) allNodes.add(bridgeNode);
                    }
                }
                prevSideNode = sideNode;
            }

            return Array.from(allNodes);
        }

        let sideLineStarts = [];
        if (width == 3) {
            sideLineStarts.push(1);
            sideLineStarts.push(3);
            sideLineStarts.push(5);
            sideLineStarts.push(7);
            sideLineStarts.push(9);
            sideLineStarts.push(11);
        }
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
