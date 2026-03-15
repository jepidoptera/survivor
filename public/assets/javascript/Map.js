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

// ─── Hex anchor navigation (nodes + midpoints unified) ────────────────────
//
// A midpoint is a pure value-type: { nodeA, nodeB, k } where
//   nodeA.neighbors[k] === nodeB  and  k ∈ [0, 5].
// Canonical form: the node whose neighbor slot index (k) is in 0–5 is nodeA.
// No caching needed — identity is the unordered (nodeA, nodeB) pair.
//
// Direction numbering follows MapNode convention (0=far-left, 1=up-left, …).
// Odd directions are immediate (1 hex step); even are diagonal (2 hex steps).
// Both nodes and midpoints have neighbors at all 12 directions.

function makeMidpoint(nodeX, nodeY) {
    if (!nodeX || !nodeY) return null;
    for (let d = 0; d < 6; d++) {
        if (nodeX.neighbors[d] === nodeY) return { nodeA: nodeX, nodeB: nodeY, k: d,
            x: (nodeX.x + nodeY.x) * 0.5, y: (nodeX.y + nodeY.y) * 0.5 };
        if (nodeY.neighbors[d] === nodeX) return { nodeA: nodeY, nodeB: nodeX, k: d,
            x: (nodeX.x + nodeY.x) * 0.5, y: (nodeX.y + nodeY.y) * 0.5 };
    }
    return null; // nodes are not adjacent
}

// Returns the next anchor (node or midpoint) from midpoint (nodeA, nodeB, k)
// when stepping in direction d (0–11).
//
// Derivation: for k=3, the full table (verified against geometric layout) is:
//   d=3 -> nodeB,  d=9 -> nodeA  (axis endpoints)
//   all others -> a midpoint one step away, via one of the bounding nodes.
// The general formula uses offset o = (d - k + 12) % 12 and two pivot
// directions fwd=(k+4)%12 and bck=(k+10)%12.
function midpointNeighborInDirection(nodeA, nodeB, k, d) {
    const norm = v => ((v % 12) + 12) % 12;
    const o   = norm(d - k);
    const fwd = norm(k + 4);
    const bck = norm(k + 10);
    switch (o) {
        case 0:  return nodeB;
        case 1:  return makeMidpoint(nodeB, nodeB.neighbors[norm(k + 2)]);
        case 2:  return makeMidpoint(nodeB, nodeB.neighbors[fwd]);
        case 3:  return nodeB.neighbors[fwd];
        case 4:  return makeMidpoint(nodeA, nodeB.neighbors[fwd]);
        case 5:  return makeMidpoint(nodeA, nodeA.neighbors[fwd]);
        case 6:  return nodeA;
        case 7:  return makeMidpoint(nodeA, nodeA.neighbors[norm(k + 8)]);
        case 8:  return makeMidpoint(nodeA, nodeA.neighbors[bck]);
        case 9:  return nodeA.neighbors[bck];
        case 10: return makeMidpoint(nodeB, nodeA.neighbors[bck]);
        case 11: return makeMidpoint(nodeB, nodeB.neighbors[bck]);
        default: return null;
    }
}

// Returns the next anchor from a plain node when stepping in direction d.
//   Odd  d → midpoint between node and its immediate neighbor[d]
//   Even d → midpoint between the two immediate neighbors flanking direction d
//            i.e. between neighbors[d-1] and neighbors[d+1]
function nodeNeighborInDirection(node, d) {
    const dir = ((d % 12) + 12) % 12;
    if (dir % 2 === 1) {
        // Odd: land on the midpoint shared with the immediate neighbor.
        const nb = node.neighbors[dir];
        if (!nb) return null;
        return makeMidpoint(node, nb);
    } else {
        // Even: diagonal step — land on midpoint between the two flanking nodes.
        const L = node.neighbors[(dir + 11) % 12];
        const R = node.neighbors[(dir +  1) % 12];
        if (!L || !R) return null;
        return makeMidpoint(L, R);
    }
}

// Uniform entry point — works identically for nodes and midpoints.
// anchor is either a MapNode or a midpoint descriptor { nodeA, nodeB, k }.
function anchorNeighborInDirection(anchor, dir) {
    if (!anchor) return null;
    if (anchor.k !== undefined) {
        return midpointNeighborInDirection(anchor.nodeA, anchor.nodeB, anchor.k, dir);
    }
    return nodeNeighborInDirection(anchor, dir);
}

// Bump this whenever the clearance BFS algorithm changes so that
// save files with stale cached clearance are automatically recomputed.
const CLEARANCE_VERSION = 2;

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
        // Legacy static-object list used by existing save/load/editor paths.
        this.objects = [];
        // Canonical cross-system runtime registry (walls, placed objects, animals, powerups, etc).
        this.gameObjects = [];
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

    registerGameObject(obj) {
        if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return false;
        if (!Array.isArray(this.gameObjects)) this.gameObjects = [];
        if (!this.gameObjects.includes(obj)) {
            this.gameObjects.push(obj);
            return true;
        }
        return false;
    }

    unregisterGameObject(obj) {
        if (!obj || !Array.isArray(this.gameObjects)) return false;
        const idx = this.gameObjects.indexOf(obj);
        if (idx < 0) return false;
        this.gameObjects.splice(idx, 1);
        return true;
    }

    rebuildGameObjectRegistry() {
        if (!Array.isArray(this.gameObjects)) this.gameObjects = [];
        this.gameObjects.length = 0;
        const seen = new Set();
        const addObject = (obj) => {
            if (!obj || obj.gone || (typeof obj !== "object" && typeof obj !== "function")) return;
            if (obj.map && obj.map !== this) return;
            if (seen.has(obj)) return;
            seen.add(obj);
            this.gameObjects.push(obj);
        };

        // Objects attached to map nodes (static objects, walls, placed objects, etc).
        for (let x = 0; x < this.width; x++) {
            const column = this.nodes[x];
            if (!Array.isArray(column)) continue;
            for (let y = 0; y < this.height; y++) {
                const node = column[y];
                if (!node || !Array.isArray(node.objects)) continue;
                for (let i = 0; i < node.objects.length; i++) {
                    addObject(node.objects[i]);
                }
            }
        }

        // Wall sections are authoritative in their own map.
        const wallCtor = (typeof globalThis !== "undefined" && globalThis.WallSectionUnit)
            ? globalThis.WallSectionUnit
            : null;
        if (wallCtor && wallCtor._allSections instanceof Map) {
            for (const section of wallCtor._allSections.values()) {
                addObject(section);
            }
        }

        // Dynamic characters/pickups. Prefer globalThis refs, with loose-global
        // fallback for runtime setups that don't mirror arrays onto globalThis.
        const animalsCandidates = [
            (typeof globalThis !== "undefined" && Array.isArray(globalThis.animals)) ? globalThis.animals : null,
            (typeof animals !== "undefined" && Array.isArray(animals)) ? animals : null
        ];
        for (let i = 0; i < animalsCandidates.length; i++) {
            const animalsList = animalsCandidates[i];
            if (!Array.isArray(animalsList)) continue;
            for (let j = 0; j < animalsList.length; j++) {
                addObject(animalsList[j]);
            }
        }

        const powerupsCandidates = [
            (typeof globalThis !== "undefined" && Array.isArray(globalThis.powerups)) ? globalThis.powerups : null,
            (typeof powerups !== "undefined" && Array.isArray(powerups)) ? powerups : null
        ];
        for (let i = 0; i < powerupsCandidates.length; i++) {
            const powerupsList = powerupsCandidates[i];
            if (!Array.isArray(powerupsList)) continue;
            for (let j = 0; j < powerupsList.length; j++) {
                addObject(powerupsList[j]);
            }
        }

        const wizardRef = (typeof globalThis !== "undefined" && globalThis.wizard)
            ? globalThis.wizard
            : null;
        if (wizardRef) {
            addObject(wizardRef);
        }

        return this.gameObjects;
    }

    getGameObjects(options = null) {
        const opts = (options && typeof options === "object") ? options : {};
        if (!Array.isArray(this.gameObjects)) this.gameObjects = [];
        if (opts.refresh === true || this.gameObjects.length === 0) {
            this.rebuildGameObjectRegistry();
        }
        return this.gameObjects;
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
            version:  CLEARANCE_VERSION,
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
        // Reject stale clearance from an older algorithm version.
        if (!encoded.version || encoded.version < CLEARANCE_VERSION) {
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

        // Second pass: seed wall-adjacent tiles.
        // Tiles with wall edges are treated as near-obstacles for clearance
        // purposes — large entities must not overlap them.
        // Tiles whose blocked neighbors are ALL diagonal (even-index, i.e.
        // far moves) seed at clearance 1 instead of 0, because the wall is
        // farther away than a direct adjacency.
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const node = this.nodes[x][y];
                if (node.clearance <= 0) continue; // already seeded
                if (node.blockedNeighbors && node.blockedNeighbors.size > 0) {
                    let hasAdjacentBlocker = false;
                    for (const dir of node.blockedNeighbors.keys()) {
                        if (dir % 2 === 1) { hasAdjacentBlocker = true; break; }
                    }
                    const seed = hasAdjacentBlocker ? 0 : 1;
                    if (seed < node.clearance) {
                        node.clearance = seed;
                        queue.push([node, seed]);
                    }
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

        // Seed wall-adjacent tiles in the region.
        // Diagonal-only blockers seed at 1 instead of 0.
        for (const node of region) {
            if (node.clearance <= 0) continue;
            if (node.blockedNeighbors && node.blockedNeighbors.size > 0) {
                let hasAdjacentBlocker = false;
                for (const dir of node.blockedNeighbors.keys()) {
                    if (dir % 2 === 1) { hasAdjacentBlocker = true; break; }
                }
                const seed = hasAdjacentBlocker ? 0 : 1;
                if (seed < node.clearance) {
                    node.clearance = seed;
                    seedQueue.push([node, seed]);
                }
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
        const allowBlockedDestination = opts.allowBlockedDestination === true;
        // Clearance: number of hex rings that must be obstacle-free around
        // each tile on the path.  0 = legacy point-entity behaviour.
        const requiredClearance = Number.isFinite(opts.clearance)
            ? Math.max(0, Math.floor(opts.clearance))
            : 0;
        // Allow only brief random detours before re-attempting a direct beeline.
        const maxRandomDetours = Number.isFinite(opts.maxRandomDetours)
            ? Math.max(0, Math.floor(opts.maxRandomDetours))
            : 0; // unused — kept for API compatibility

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

            // Tile blocking — allow if this is the destination and caller opts in
            if (neighborNode.hasBlockingObject() || neighborNode.blocked) {
                if (allowBlockedDestination && neighborNode === destinationNode) {
                    // fall through — let canMoveDirection return true for the destination
                } else {
                    return false;
                }
            }

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
        path.blockers = []; // blocking objects found when the ideal direction is impassable
        const blockersSeen = new Set();
        let currentNode = startingNode;
        const visited = new Set();
        const maxSteps = Math.max(200, (this.width + this.height));
        if (currentNode) {
            visited.add(`${currentNode.xindex},${currentNode.yindex}`);
        }

        while (currentNode && path.length < maxSteps) {
            let bestValidDistance = Infinity;
            let bestValidDirection = -1;
            let idealDirection = -1;
            let idealDist = Infinity;
            let idealDirectionPassable = false; // true if idealDirection passes canMoveDirection
            const validDirections = [];

            for (let n = 0; n < 12; n++) {
                const neighborNode = currentNode.neighbors[n];
                if (!neighborNode) continue;

                const distFactor = distFactors[n];
                const xdist = this.shortestDeltaX(currentNode.x, destinationNode.x)
                            - this.shortestDeltaX(currentNode.x, neighborNode.x) * distFactor;
                const ydist = this.shortestDeltaY(currentNode.y, destinationNode.y)
                            - this.shortestDeltaY(currentNode.y, neighborNode.y) * distFactor;
                const dist = xdist ** 2 + ydist ** 2;

                // Track the best direction regardless of passability or visited state
                if (dist < idealDist) {
                    idealDist = dist;
                    idealDirection = n;
                    idealDirectionPassable = canMoveDirection(currentNode, n);
                }

                if (!canMoveDirection(currentNode, n)) continue;

                // Reached destination?
                if (neighborNode === destinationNode) {
                    path.push(destinationNode);
                    return path;
                }

                const nKey = `${neighborNode.xindex},${neighborNode.yindex}`;
                if (visited.has(nKey)) continue;

                validDirections.push(n);
                if (dist < bestValidDistance) {
                    bestValidDistance = dist;
                    bestValidDirection = n;
                }
            }

            // The ideal direction toward the destination is physically blocked (fails
            // canMoveDirection — not merely visited). Collect the culprit objects,
            // take one random bounce step so the animal keeps moving, then return.
            if (idealDirection !== -1 && !idealDirectionPassable) {
                const directionalBlockers = currentNode.blockedNeighbors
                    ? currentNode.blockedNeighbors.get(idealDirection)
                    : null;
                if (directionalBlockers instanceof Set) {
                    directionalBlockers.forEach(blocker => {
                        if (!blocker || blockersSeen.has(blocker)) return;
                        blockersSeen.add(blocker);
                        path.blockers.push(blocker);
                    });
                }

                // BFS the entire clearance+1 hex area around currentNode.
                // Collect all blocking objects that are closer to the destination
                // than currentNode is — those are the objects in the way.
                const ringRadius = requiredClearance + 1;
                const scanNodes = new Set();
                scanNodes.add(currentNode);
                let bfsFrontier = [currentNode];
                for (let r = 0; r < ringRadius; r++) {
                    const next = [];
                    for (let fi = 0; fi < bfsFrontier.length; fi++) {
                        const fn = bfsFrontier[fi];
                        for (let ni = 0; ni < fn.neighbors.length; ni++) {
                            const nb = fn.neighbors[ni];
                            if (!nb || scanNodes.has(nb)) continue;
                            scanNodes.add(nb);
                            next.push(nb);
                        }
                    }
                    bfsFrontier = next;
                }
                const animalDistSq = this.shortestDeltaX(currentNode.x, destinationNode.x) ** 2
                                   + this.shortestDeltaY(currentNode.y, destinationNode.y) ** 2;
                scanNodes.forEach(sn => {
                    if (!sn.objects) return;
                    for (let oi = 0; oi < sn.objects.length; oi++) {
                        const obj = sn.objects[oi];
                        if (!obj || obj.blocksTile === false) continue;
                        if (blockersSeen.has(obj)) continue;
                        const objDistSq = this.shortestDeltaX(obj.x, destinationNode.x) ** 2
                                        + this.shortestDeltaY(obj.y, destinationNode.y) ** 2;
                        if (objDistSq < animalDistSq) {
                            blockersSeen.add(obj);
                            path.blockers.push(obj);
                        }
                    }
                });

                // Find a bounce step. Try valid (clearance-respecting) directions first;
                // fall back to any unblocked direction so the animal never fully freezes.
                let bounceDirections = validDirections.length > 0 ? validDirections : null;
                if (!bounceDirections) {
                    // Clearance-ignoring fallback: any neighbor that isn't hard-blocked
                    bounceDirections = [];
                    for (let n = 0; n < 12; n++) {
                        const nb = currentNode.neighbors[n];
                        const directionalBlockers = currentNode.blockedNeighbors
                            ? currentNode.blockedNeighbors.get(n)
                            : null;
                        if (directionalBlockers && directionalBlockers.size > 0) continue;
                        if (!nb || nb.hasBlockingObject() || nb.blocked) continue;
                        const nKey = `${nb.xindex},${nb.yindex}`;
                        if (visited.has(nKey)) continue;
                        bounceDirections.push(n);
                    }
                }
                if (bounceDirections.length > 0) {
                    const bounce = bounceDirections[Math.floor(Math.random() * bounceDirections.length)];
                    path.push(currentNode.neighbors[bounce]);
                }
                return path;
            }

            // Ideal direction is passable — take the greedy step.
            // If no valid (clearance-respecting) direction exists, fall back to any
            // unblocked direction so the animal can escape a tight spot.
            if (validDirections.length === 0) {
                for (let n = 0; n < 12; n++) {
                    const nb = currentNode.neighbors[n];
                    const directionalBlockers = currentNode.blockedNeighbors
                        ? currentNode.blockedNeighbors.get(n)
                        : null;
                    if (directionalBlockers && directionalBlockers.size > 0) continue;
                    if (!nb || nb.hasBlockingObject() || nb.blocked) continue;
                    const nKey = `${nb.xindex},${nb.yindex}`;
                    if (visited.has(nKey)) continue;
                    validDirections.push(n);
                    // Pick any single escape direction; recompute best as closest to dest
                    const distFactor = distFactors[n];
                    const xdist = this.shortestDeltaX(currentNode.x, destinationNode.x)
                                - this.shortestDeltaX(currentNode.x, nb.x) * distFactor;
                    const ydist = this.shortestDeltaY(currentNode.y, destinationNode.y)
                                - this.shortestDeltaY(currentNode.y, nb.y) * distFactor;
                    const dist = xdist ** 2 + ydist ** 2;
                    if (dist < bestValidDistance) { bestValidDistance = dist; bestValidDirection = n; }
                }
                if (validDirections.length === 0) return path; // truly surrounded, give up
            }

            const chosenNeighbor = currentNode.neighbors[bestValidDirection];
            if (!chosenNeighbor) return path;

            const chosenKey = `${chosenNeighbor.xindex},${chosenNeighbor.yindex}`;
            if (visited.has(chosenKey)) return path;

            path.push(chosenNeighbor);
            visited.add(chosenKey);
            currentNode = chosenNeighbor;
        }

        return path;
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

        // wallAvoidance: when > 0, tiles near walls cost more to traverse.
        // The penalty added per step is  wallAvoidance / (1 + clearance),
        // so tiles with clearance 0 pay the full weight, tiles far from
        // walls pay almost nothing.  Typical value: 2–5.
        const wallAvoidance = Number.isFinite(options.wallAvoidance)
            ? Math.max(0, options.wallAvoidance)
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
            const dist = Math.hypot(dx, dy);
            // Penalise tiles close to walls so the path hugs open space.
            // The penalty is proportional to step distance so that far moves
            // (which cover more ground per step) aren't artificially cheap
            // due to fewer penalty applications.
            if (wallAvoidance > 0) {
                const cl = Number.isFinite(toNode.clearance) ? toNode.clearance : 0;
                return dist * (1 + wallAvoidance / (1 + cl));
            }
            return dist;
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

            const midpoint = makeMidpoint(node, neighbor);
            if (!midpoint) continue;
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
        return !!(entity && entity.nodeA && entity.nodeB && entity.k !== undefined);
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
        if (!this._isNodeMidpoint(midpoint)) return null;
        const candidates = [midpoint.nodeA, midpoint.nodeB];
        const tx = Number(towardEntity && towardEntity.x);
        const ty = Number(towardEntity && towardEntity.y);
        let bestNode = null;
        let bestDist = Infinity;
        for (let i = 0; i < candidates.length; i++) {
            const node = candidates[i];
            if (!node || typeof node.xindex !== "number") continue;
            const dist = Number.isFinite(tx) && Number.isFinite(ty)
                ? Math.hypot(this.shortestDeltaX(node.x, tx), this.shortestDeltaY(node.y, ty))
                : i;
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

    /**
     * Returns true when there is an unobstructed hex path (adjacent steps only)
     * between nodeA and nodeB.  Checks every intermediate node for blockage and
     * every connection for wall blockage via blockedNeighbors.
     *
     * This is intentionally a greedy walk so it is O(steps) with no allocations.
     *
     * @param {MapNode} nodeA  Starting node.
     * @param {MapNode} nodeB  Destination node.
     * @returns {boolean}  True if LOS is clear.
     */
    hasLineOfSight(nodeA, nodeB) {
        if (!nodeA || !nodeB) return true;
        if (nodeA === nodeB) return true;

        // Adjacent direction indices (odd = one-step hex neighbours).
        const adjDirs = [1, 3, 5, 7, 9, 11];
        const maxSteps = Math.max(16, (this.width + this.height) * 2);

        let current = nodeA;
        for (let step = 0; step < maxSteps; step++) {
            if (current === nodeB) return true;

            // Greedy step: choose the adjacent neighbour that minimises distance to nodeB.
            let bestNext = null;
            let bestDir  = -1;
            let bestDist = Infinity;
            for (let i = 0; i < adjDirs.length; i++) {
                const dir       = adjDirs[i];
                const candidate = current.neighbors[dir];
                if (!candidate) continue;
                const dist = Math.hypot(
                    this.shortestDeltaX(candidate.x, nodeB.x),
                    this.shortestDeltaY(candidate.y, nodeB.y)
                );
                if (dist < bestDist) {
                    bestDist = dist;
                    bestNext = candidate;
                    bestDir  = dir;
                }
            }

            if (!bestNext) return false; // no reachable neighbour

            // Wall blocking on this edge.
            const blockingWalls = current.blockedNeighbors
                ? current.blockedNeighbors.get(bestDir)
                : null;
            if (blockingWalls && blockingWalls.size > 0) return false;

            // Blocking object / terrain on the next tile (skip endpoints).
            if (bestNext !== nodeB && bestNext.isBlocked()) return false;

            current = bestNext;
        }

        return current === nodeB;
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

    distanceBetweenPoints(ax, ay, bx, by) {
        const dx = this.shortestDeltaX(ax, bx);
        const dy = this.shortestDeltaY(ay, by);
        return Math.hypot(dx, dy);
    }

    pointWithinRadius(ax, ay, bx, by, radius) {
        if (!Number.isFinite(radius) || radius < 0) return false;
        const dx = this.shortestDeltaX(ax, bx);
        const dy = this.shortestDeltaY(ay, by);
        return (dx * dx + dy * dy) <= (radius * radius);
    }

    wrapWorldPoint(point) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return point;
        return {
            x: this.wrapWorldX(point.x),
            y: this.wrapWorldY(point.y)
        };
    }
}
