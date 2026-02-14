class StaticObject {
    constructor(type, location, width, height, textures, map) {
        this.type = type;
        this.map = map;
        this.width = width;
        this.height = height;
        this.blocksTile = true;
        this.groundRadius = 0.5;
        this.visualRadius = Math.max(width, height) / 2;

        const loc = location || {x: 0, y: 0};
        this.x = loc.x;
        this.y = loc.y;
        this.node = this.map && typeof this.map.worldToNode === "function"
            ? this.map.worldToNode(this.x, this.y)
            : null;
        if (this.node) {
            this.node.addObject(this);
        }
        
        // Create Pixi sprite with random texture variant and persist that variant index.
        const textureCount = Array.isArray(textures) ? textures.length : 0;
        this.textureIndex = textureCount > 0 ? Math.floor(Math.random() * textureCount) : -1;
        const texture = this.textureIndex >= 0 ? textures[this.textureIndex] : PIXI.Texture.WHITE;
        this.pixiSprite = new PIXI.Sprite(texture);
        this.pixiSprite.anchor.set(0.5, 1);
        objectLayer.addChild(this.pixiSprite);

        this.visualHitbox = new CircleHitbox(this.x, this.y, this.visualRadius);
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, this.groundRadius);

        
        // Default properties (can be overridden in subclasses)
        this.hp = 100;
        this.isOnFire = false;
        this.burned = false;
    }


    getNode() {
        if (!this.node && this.map && typeof this.map.worldToNode === "function") {
            this.node = this.map.worldToNode(this.x, this.y);
        }
        return this.node;
    }

    moveNode(node) {
        const oldNode = this.getNode();
        if (oldNode) {
            oldNode.removeObject(this);
        }
        this.node = node;
        if (this.node) {
            this.node.addObject(this);
        }
    }

    removeFromNodes() {
        const node = this.getNode();
        if (node) {
            node.removeObject(this);
        }
    }
    
    ignite() {
        this.isOnFire = true;
    }
    
    update() {
        // Initialize max HP on first fire ignition
        if (this.isOnFire && !this.maxHP) {
            this.maxHP = this.hp;
        }
        
        // Gradually turn black as item burns (start at 50% HP)
        if (this.maxHP && this.hp !== undefined) {
            const hpThreshold = this.maxHP * 0.5;
            if (this.hp < hpThreshold) {
                // Tint from white (0xffffff) to black (0x000000) as HP goes from 50% to 0%
                const blackProgress = Math.max(0, (hpThreshold - this.hp) / hpThreshold);
                const brightness = Math.floor(255 * (1 - blackProgress * 0.8));
                const tintValue = (brightness << 16) | (brightness << 8) | brightness;
                this.pixiSprite.tint = tintValue;
            }
        }
        
        // Reduce HP while on fire
        if (this.isOnFire && this.hp > 0) {
            this.hp -= 0.5; // Burn damage over time
        }
        
        // Mark as burned when HP reaches 0
        if (this.hp <= 0 && !this.burned) {
            this.burned = true;
        }
        
        // Fade out fire after destruction
        if (this.fireFadeStart !== undefined) {
            const fadeFrames = 120; // ~4 seconds at 30fps
            const timeSinceFade = frameCount - this.fireFadeStart;
            if (timeSinceFade > fadeFrames) {
                this.fireAlphaMult = 0;
            } else {
                this.fireAlphaMult = Math.max(0, 1 - (timeSinceFade / fadeFrames));
            }
        }
    }

    saveJson() {
        return {
            type: this.type,
            x: this.x,
            y: this.y,
            hp: this.hp,
            isOnFire: this.isOnFire,
            textureIndex: this.textureIndex
        };
    }

    static loadJson(data, map) {
        if (!data || !data.type || !map) return null;

        try {
            const node = map.worldToNode(data.x, data.y);

            if (!node) return null;

            let obj;
            let textures = [];

            // Get textures from map if available
            if (map.scenery && map.scenery[data.type] && map.scenery[data.type].textures) {
                textures = map.scenery[data.type].textures;
            }

            // Create appropriate object type
            switch (data.type) {
                case 'tree':
                    obj = new Tree(node, textures, map);
                    break;
                case 'road':
                    obj = new Road(node, textures, map, {
                        fillTexturePath: (typeof data.fillTexturePath === 'string' && data.fillTexturePath.length > 0)
                            ? data.fillTexturePath
                            : undefined
                    });
                    break;
                case 'wall':
                    return Wall.loadJson(data, map);
                case 'playground':
                    obj = new Playground(node, textures, map);
                    break;
                default:
                    obj = new StaticObject(data.type, node, 4, 4, textures, map);
            }

            if (obj) {
                obj.x = data.x;
                obj.y = data.y;
                if (data.hp !== undefined) obj.hp = data.hp;
                if (data.isOnFire) obj.ignite();

                // Preserve tree sprite variant across save/load.
                if (
                    data.type === 'tree' &&
                    Number.isInteger(data.textureIndex) &&
                    obj.pixiSprite
                ) {
                    const restoredTexture = textures[data.textureIndex] || PIXI.Texture.from(`/assets/images/tree${data.textureIndex}.png`);
                    if (restoredTexture) {
                        obj.pixiSprite.texture = restoredTexture;
                        obj.textureIndex = data.textureIndex;
                    }
                }

                if (data.type === 'tree' && obj && typeof obj.applySize === 'function') {
                    if (Number.isFinite(data.size)) {
                        obj.applySize(data.size);
                    } else if (Number.isFinite(data.scale)) {
                        // Backward compatibility: legacy scale used 1 -> default 4-unit tree.
                        obj.applySize(data.scale * 4);
                    } else {
                        obj.applySize(4);
                    }
                }
            }

            return obj;
        } catch (e) {
            console.error("Error loading static object:", e);
            return null;
        }
    }
}

class Tree extends StaticObject {
    constructor(location, textures, map) {
        super('tree', location, 4, 4, textures, map);
        this.baseWidth = 4;
        this.baseHeight = 4;
        this.baseVisualRadius = 1.75;
        this.baseGroundRadius = 0.5;
        this.size = 4;
        this.height = this.baseHeight;
        this.hp = 100;
        this.maxHP = 100;
        this.visualRadius = this.baseVisualRadius;
        this.visualHitbox = new CircleHitbox(this.x, this.y - this.height, this.visualRadius);
        this.groundRadius = this.baseGroundRadius;
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, this.groundRadius);
        this.applySize(this.size);
    }

    applySize(nextSize) {
        const clamped = Math.max(0.05, Number(nextSize) || 4);
        this.size = clamped;
        this.width = clamped;
        this.height = clamped;
        const radiusScale = clamped / 4;
        this.visualRadius = this.baseVisualRadius * radiusScale;
        this.groundRadius = this.baseGroundRadius * radiusScale;

        if (this.visualHitbox && this.visualHitbox.type === 'circle') {
            this.visualHitbox.x = this.x;
            this.visualHitbox.y = this.y - this.height;
            this.visualHitbox.radius = this.visualRadius;
        }
        if (this.groundPlaneHitbox && this.groundPlaneHitbox.type === 'circle') {
            this.groundPlaneHitbox.x = this.x;
            this.groundPlaneHitbox.y = this.y;
            this.groundPlaneHitbox.radius = this.groundRadius;
        }
    }

    // Backward-compatible alias for older callsites.
    applyScale(nextScale) {
        this.applySize(nextScale);
    }
    
    update() {
        // Handle growth animation if tree is growing
        if (this.isGrowing && this.growthStartFrame !== undefined && this.growthFrames !== undefined) {
            const elapsedFrames = frameCount - this.growthStartFrame;
            const progress = Math.min(elapsedFrames / this.growthFrames, 1);
            
            // Ease-out growth curve for natural feel
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            
            // Set width and height based on growth progress
            this.width = (this.growthFullWidth || 4) * easeProgress;
            this.height = (this.growthFullHeight || 4) * easeProgress;
            
            // Mark growth complete and stop tracking
            if (progress >= 1) {
                this.isGrowing = false;
                this.width = this.growthFullWidth || 4;
                this.height = this.growthFullHeight || 4;
            }
        }
        
        // Call parent update for burning logic
        super.update();
        
        // Start falling when HP reaches 0
        if (this.hp <= 0 || this.burned) {
            if (!this.falling) {
                this.falling = true;
                this.rotation = 0;
                this.pixiSprite.tint = 0x222222; // Ensure fully black
                // Set random fall direction
                this.fallDirection = Math.random() < 0.5 ? 'left' : 'right';
                this.fallStart = frameCount; // Track when fall started
            }
            
            // Gradually fall over with acceleration that tops out at 1.5°/frame
            const absRotation = Math.abs(this.rotation);
            if (absRotation < 90) {
                // Calculate elapsed frames since fall started
                const framesSinceFall = frameCount - this.fallStart;
                // Accelerating ease-in, but capped at 1.5 degrees per frame
                const accelFactor = Math.min(framesSinceFall / 40, 1); // Reach max by frame 40
                const rotationRate = 1.5 * accelFactor; // Scale from 0 to 1.5 deg/frame
                const sign = this.fallDirection === 'right' ? 1 : -1;
                this.rotation += sign * rotationRate;
                
                // Snap to final rotation
                if (Math.abs(this.rotation) > 90) {
                    this.rotation = this.fallDirection === 'right' ? 90 : -90;
                }
            } else {
                this.rotation = this.fallDirection === 'right' ? 90 : -90;
                
                // Once tree is fully fallen, create diamond-shaped hitbox
                if (!this.fallenHitboxCreated) {
                    // Diamond shape: 4 units wide, 2 units high
                    // Centered 2 units to the side of the base node
                    const offsetX = this.fallDirection === 'right' ? 2 : -2;
                    const centerX = this.x + offsetX;
                    const centerY = this.y;
                    let treepoints;

                    if (this.fallDirection === 'right') {
                        this.visualHitbox = new PolygonHitbox([
                            {x: centerX, y: centerY - 1.5},     
                            {x: centerX + 2, y: centerY - 1.2}, 
                            {x: centerX + 2, y: centerY + 1.2}, 
                            {x: centerX, y: centerY + 1.5},     
                            {x: centerX - 2, y: centerY + 0.5}, 
                            {x: centerX - 2, y: centerY - 0.5}
                        ]);
                        this.groundPlaneHitbox = new PolygonHitbox([
                            {x: centerX, y: centerY - 0.75},     
                            {x: centerX + 1.5, y: centerY - 0.6}, 
                            {x: centerX + 1.5, y: centerY + 1.2}, 
                            {x: centerX, y: centerY + 1.5},     
                            {x: centerX - 2, y: centerY + 0.5}, 
                            {x: centerX - 2, y: centerY - 0.5}
                        ]);
                    } else {
                        this.visualHitbox = new PolygonHitbox([
                            {x: centerX, y: centerY - 1.5},     
                            {x: centerX + 2, y: centerY - 0.5}, 
                            {x: centerX + 2, y: centerY + 0.5}, 
                            {x: centerX, y: centerY + 1.5},     
                            {x: centerX - 2, y: centerY + 1.2}, 
                            {x: centerX - 2, y: centerY - 1.2}
                        ]);
                        this.groundPlaneHitbox = new PolygonHitbox([
                            {x: centerX, y: centerY - 0.75},     
                            {x: centerX + 2, y: centerY - 0.5}, 
                            {x: centerX + 2, y: centerY + 0.5}, 
                            {x: centerX, y: centerY + 1.5},     
                            {x: centerX - 1.5, y: centerY + 1.2}, 
                            {x: centerX - 1.5, y: centerY - 0.6}
                        ]);
                    }
                    this.moveNode(this.map.worldToNode(centerX, centerY));                     
                    this.fallenHitboxCreated = true;

                }
                
                if (this.isOnFire) {
                    // Once tree is fully fallen, start fading fire
                    this.isOnFire = false;
                    this.fireFadeStart = frameCount;
                }
            }
        }
    }

    saveJson() {
        const data = super.saveJson();
        data.size = this.size;
        return data;
    }
}


class Playground extends StaticObject {
    constructor(location, textures, map) {
        super('playground', location, 4, 3, textures, map);
        this.hp = 100;
        this.blocksDiamond = true;
        
        // Set custom anchor for playground
        this.pixiSprite.anchor.set(0.5, 1);
        
        // Block additional tiles in a horizontal diamond pattern for pathfinding
        this.blockDiamondTiles();
    }
    
    blockDiamondTiles() {
        const node = this.getNode();
        if (!node) return;
        const baseX = node.xindex;
        const baseY = node.yindex;

        // Block the 4 tiles in a horizontal diamond pattern
        // Diamond: one above, one up-left, one up-right (current tile already has object)
        const diamondTiles = [];
        diamondTiles.push({x: baseX, y: baseY - 1}); // Up
        
        if (baseX % 2 === 0) {
            // Even column: left and right at same y level
            diamondTiles.push(
                {x: baseX - 1, y: baseY},      // Left
                {x: baseX + 1, y: baseY}       // Right
            );
        } else {
            // Odd column: up-left and up-right are offset up
            diamondTiles.push(
                {x: baseX - 1, y: baseY - 1},  // Up-left
                {x: baseX + 1, y: baseY - 1}   // Up-right
            );
        }
        
        for (let tile of diamondTiles) {
            if (this.map.nodes[tile.x] && this.map.nodes[tile.x][tile.y]) {
                this.map.nodes[tile.x][tile.y].blocked = true;
            }
        }
    }
    
    update() {
        // Call parent update for burning logic
        super.update();
        
        // For playgrounds, destroy when HP reaches 0 (fade out fire instead of falling)
        if (this.hp <= 0 && !this.destroyed) {
            this.destroyed = true;
            this.pixiSprite.tint = 0x222222; // Ensure fully black
            if (this.isOnFire) {
                this.isOnFire = false;
                this.fireFadeStart = frameCount;
            }
        }
    }
}

class Wall {
    static _stoneWallTexture = null;
    static _nextLineGroupId = 1;

    constructor(endpointA, endpointB, height, thickness, map, direction) {
        this.type = 'wall';
        this.map = map;
        
        if (endpointB instanceof MapNode && !(endpointA instanceof MapNode)) {
            this.a = endpointB;
            this.b = endpointA;
            this.isDiagonal = true;
        } else if (endpointA instanceof MapNode && !(endpointB instanceof MapNode)) {
            this.a = endpointA;
            this.b = endpointB;
            this.isDiagonal = true;
        } else {
            this.a = endpointA;
            this.b = endpointB;
            this.isDiagonal = false;
        }
        // Position is at the center between endpoints
        this.x = (this.a.x + this.b.x) / 2;
        this.y = (this.a.y + this.b.y) / 2;
        
        this.height = height;
        this.thickness = thickness;
        this.direction = Number.isFinite(direction)
            ? direction
            : (this.map && typeof this.map.getHexDirection === "function"
                ? this.map.getHexDirection(this.a.x - this.b.x, this.a.y - this.b.y)
                : 0);
        this.lineAxis = Wall.normalizeDirectionAxis(this.direction);
        this.lineGroupId = null;
        this.texturePhaseA = 0;
        this.texturePhaseB = 1 / 3; // three map units per horizontal texture repeat
        this.joinCorners = null;
        this.blocksTile = false;
        this.pixiSprite = new PIXI.Graphics();
        this.skipTransform = true;
        this.rebuildHitboxesFromJoinState();

        // Arrays to track what this wall affects
        this.nodes = [];           // All nodes this wall sits on
        this.blockedLinks = [];    // All node connections this wall blocks
        
        for (let direction = 0; direction < 12; direction++) {
            this.addBlockedLink(this.a.neighbors[direction], (direction + 6) % 12);
            if (this.b instanceof MapNode) {
                this.addBlockedLink(this.b.neighbors[direction], (direction + 6) % 12);
            }
        }
        
        if (this.isDiagonal) {
            const d1 = (9 + direction) % 12;  // neighbor 9+dir
            const d2 = (1 + direction) % 12;  // neighbor 1+dir
            const d3 = (11 + direction) % 12; // neighbor 11+dir
            const d4 = (3 + direction) % 12;  // neighbor 3+dir
            
            // Block the three cross-diagonal connections
            this.blockCrossConnection(this.a, d1, d2);  // 9+dir ↔ 5+dir
            this.blockCrossConnection(this.a, d3, d4);  // 7+dir ↔ 3+dir
            this.blockCrossConnection(this.a, d2, d3);  // 5+dir ↔ 7+dir
        } else {
            // block one diagonal connection across the wall
            const crossNodeA = this.a.neighbors[(direction + 2) % 12];
            const crossNodeB = this.a.neighbors[(direction + 10) % 12];
            this.addBlockedLink(crossNodeA, (direction + 9) % 12);
            this.addBlockedLink(crossNodeB, (direction + 3) % 12);
        }

        this.findNodesAlongWall(endpointA, endpointB);
        this.addToNodes();
        this.updateConnectedWallJoins();
        Wall.recomputeLineGroups(this.map);

        objectLayer.addChild(this.pixiSprite);
    }

    static normalizeDirectionAxis(direction) {
        const d = Number(direction) || 0;
        return ((d % 6) + 6) % 6;
    }

    getLineAxis() {
        return Wall.normalizeDirectionAxis(this.direction);
    }

    sharesLineEndpointAndAxis(otherWall) {
        if (!otherWall || otherWall.type !== 'wall') return false;
        if (this.getLineAxis() !== otherWall.getLineAxis()) return false;
        return (
            Wall.pointsMatch(this.a, otherWall.a) ||
            Wall.pointsMatch(this.a, otherWall.b) ||
            Wall.pointsMatch(this.b, otherWall.a) ||
            Wall.pointsMatch(this.b, otherWall.b)
        );
    }

    collectConnectedLineNeighbors() {
        return this.collectPotentialJoinWalls().filter(wall => this.sharesLineEndpointAndAxis(wall));
    }

    static collectAllWalls(map) {
        if (!map || !map.nodes) return [];
        const walls = new Set();
        Object.keys(map.nodes).forEach(xKey => {
            const col = map.nodes[xKey];
            if (!col) return;
            Object.keys(col).forEach(yKey => {
                const node = col[yKey];
                if (!node || !Array.isArray(node.objects)) return;
                node.objects.forEach(obj => {
                    if (obj && obj.type === 'wall') {
                        walls.add(obj);
                    }
                });
            });
        });
        return Array.from(walls);
    }

    static recomputeLineGroups(map) {
        const walls = Wall.collectAllWalls(map);
        walls.forEach(wall => {
            wall.lineAxis = wall.getLineAxis();
            wall.lineGroupId = null;
        });

        let nextId = 1;
        walls.forEach(seed => {
            if (!seed || Number.isInteger(seed.lineGroupId)) return;
            const groupId = nextId++;
            const queue = [seed];
            seed.lineGroupId = groupId;

            while (queue.length > 0) {
                const wall = queue.shift();
                if (!wall) continue;
                const neighbors = wall.collectConnectedLineNeighbors();
                neighbors.forEach(neighbor => {
                    if (!neighbor || Number.isInteger(neighbor.lineGroupId)) return;
                    neighbor.lineGroupId = groupId;
                    queue.push(neighbor);
                });
            }
        });

        Wall._nextLineGroupId = nextId;
    }

    static pointsMatch(p1, p2, eps = 1e-6) {
        if (!p1 || !p2) return false;
        if (!Number.isFinite(p1.x) || !Number.isFinite(p1.y) || !Number.isFinite(p2.x) || !Number.isFinite(p2.y)) return false;
        return Math.abs(p1.x - p2.x) <= eps && Math.abs(p1.y - p2.y) <= eps;
    }

    static lineIntersection(p, r, q, s) {
        const cross = r.x * s.y - r.y * s.x;
        if (Math.abs(cross) < 1e-7) return null;
        const qpx = q.x - p.x;
        const qpy = q.y - p.y;
        const t = (qpx * s.y - qpy * s.x) / cross;
        return {
            x: p.x + r.x * t,
            y: p.y + r.y * t
        };
    }

    static distancePointToLine(point, linePoint, lineDir) {
        if (!point || !linePoint || !lineDir) return Infinity;
        const vx = point.x - linePoint.x;
        const vy = point.y - linePoint.y;
        const cross = Math.abs(vx * lineDir.y - vy * lineDir.x);
        const dirLen = Math.hypot(lineDir.x, lineDir.y);
        if (dirLen < 1e-7) return Infinity;
        return cross / dirLen;
    }

    static hasFinitePoint(point) {
        return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
    }

    getTexturePhaseAtEndpoint(endpoint) {
        if (!endpoint) return null;
        if (Wall.pointsMatch(endpoint, this.a)) return this.texturePhaseA;
        if (Wall.pointsMatch(endpoint, this.b)) return this.texturePhaseB;
        return null;
    }

    setTexturePhaseForOrderedEndpoints(fromEndpoint, toEndpoint, phaseFrom, phaseTo) {
        if (Wall.pointsMatch(fromEndpoint, this.a) && Wall.pointsMatch(toEndpoint, this.b)) {
            this.texturePhaseA = phaseFrom;
            this.texturePhaseB = phaseTo;
            return true;
        }
        if (Wall.pointsMatch(fromEndpoint, this.b) && Wall.pointsMatch(toEndpoint, this.a)) {
            this.texturePhaseA = phaseTo;
            this.texturePhaseB = phaseFrom;
            return true;
        }
        return false;
    }

    static getStoneWallTexture() {
        if (!Wall._stoneWallTexture) {
            Wall._stoneWallTexture = PIXI.Texture.from('/assets/images/stonewall.png');
            if (Wall._stoneWallTexture && Wall._stoneWallTexture.baseTexture) {
                Wall._stoneWallTexture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
                Wall._stoneWallTexture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
            }
        }
        return Wall._stoneWallTexture;
    }

    getWallProfile() {
        const ax = Number(this.a && this.a.x);
        const ay = Number(this.a && this.a.y);
        const bx = Number(this.b && this.b.x);
        const by = Number(this.b && this.b.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;

        const wallThickness = Math.max(0.001, Number(this.thickness) || 0.001);
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return null;

        const nx = -dy / len;
        const ny = dx / len;
        const halfThickness = wallThickness / 2;
        const defaultALeft = { x: ax + nx * halfThickness, y: ay + ny * halfThickness };
        const defaultARight = { x: ax - nx * halfThickness, y: ay - ny * halfThickness };
        const defaultBLeft = { x: bx + nx * halfThickness, y: by + ny * halfThickness };
        const defaultBRight = { x: bx - nx * halfThickness, y: by - ny * halfThickness };

        const aLeft = this.joinCorners && this.joinCorners.aLeft ? this.joinCorners.aLeft : defaultALeft;
        const aRight = this.joinCorners && this.joinCorners.aRight ? this.joinCorners.aRight : defaultARight;
        const bLeft = this.joinCorners && this.joinCorners.bLeft ? this.joinCorners.bLeft : defaultBLeft;
        const bRight = this.joinCorners && this.joinCorners.bRight ? this.joinCorners.bRight : defaultBRight;

        return { aLeft, aRight, bLeft, bRight };
    }

    getEndpointLineData(endpointKey) {
        const endpoint = endpointKey === 'a' ? this.a : this.b;
        const other = endpointKey === 'a' ? this.b : this.a;
        if (!endpoint || !other) return null;
        const ex = Number(endpoint.x);
        const ey = Number(endpoint.y);
        const ox = Number(other.x);
        const oy = Number(other.y);
        if (!Number.isFinite(ex) || !Number.isFinite(ey) || !Number.isFinite(ox) || !Number.isFinite(oy)) return null;

        const tx = ox - ex;
        const ty = oy - ey;
        const tLen = Math.hypot(tx, ty);
        if (tLen < 1e-7) return null;
        const dir = { x: tx / tLen, y: ty / tLen };
        const normal = { x: -dir.y, y: dir.x };
        const half = Math.max(0.001, Number(this.thickness) || 0.001) / 2;
        const plusPoint = { x: ex + normal.x * half, y: ey + normal.y * half };
        const minusPoint = { x: ex - normal.x * half, y: ey - normal.y * half };
        const leftPoint = endpointKey === 'a' ? plusPoint : minusPoint;
        const rightPoint = endpointKey === 'a' ? minusPoint : plusPoint;

        return {
            endpoint: { x: ex, y: ey },
            dir,
            segmentLength: tLen,
            leftPoint,
            rightPoint
        };
    }

    computeJoinedEndpointCorners(endpointKey) {
        const lineData = this.getEndpointLineData(endpointKey);
        if (!lineData) return null;
        const endpoint = lineData.endpoint;
        const otherEndpoint = endpointKey === 'a' ? this.b : this.a;
        const ox = Number(otherEndpoint && otherEndpoint.x);
        const oy = Number(otherEndpoint && otherEndpoint.y);
        const candidates = this.collectPotentialJoinWalls().filter(wall => this.sharesEndpointWith(wall, endpoint));
        if (!candidates.length) return null;

        const defaultLeft = lineData.leftPoint;
        const defaultRight = lineData.rightPoint;
        const wallThickness = Math.max(0.001, Number(this.thickness) || 0.001);
        const maxMiterDistance = Math.max(wallThickness * 24, lineData.segmentLength * 2);
        const maxAlong = Math.max(
            wallThickness * 24,
            lineData.segmentLength + wallThickness * 2
        );

        const isEndpointLocalPoint = point => {
            if (!point) return false;
            const along = (point.x - endpoint.x) * lineData.dir.x + (point.y - endpoint.y) * lineData.dir.y;
            if (along < -wallThickness * 2 || along > maxAlong) return false;
            if (!Number.isFinite(ox) || !Number.isFinite(oy)) return true;
            const distToEndpoint = Math.hypot(point.x - endpoint.x, point.y - endpoint.y);
            const distToOther = Math.hypot(point.x - ox, point.y - oy);
            return distToEndpoint <= distToOther + wallThickness * 2;
        };

        const orderPlanesByReference = (baseLineData, referencePoint) => {
            if (!Wall.hasFinitePoint(referencePoint)) {
                return {
                    insidePoint: baseLineData.leftPoint,
                    outsidePoint: baseLineData.rightPoint,
                    insideIsLeft: true
                };
            }
            const leftDist = Wall.distancePointToLine(referencePoint, baseLineData.leftPoint, baseLineData.dir);
            const rightDist = Wall.distancePointToLine(referencePoint, baseLineData.rightPoint, baseLineData.dir);
            const insideIsLeft = leftDist <= rightDist;
            return {
                insidePoint: insideIsLeft ? baseLineData.leftPoint : baseLineData.rightPoint,
                outsidePoint: insideIsLeft ? baseLineData.rightPoint : baseLineData.leftPoint,
                insideIsLeft
            };
        };

        let bestLeft = null;
        let bestRight = null;
        let bestLeftDist = Infinity;
        let bestRightDist = Infinity;

        for (const neighbor of candidates) {
            if (!neighbor) continue;
            const neighborEndpointKey = Wall.pointsMatch(endpoint, neighbor.a) ? 'a' : (Wall.pointsMatch(endpoint, neighbor.b) ? 'b' : null);
            if (!neighborEndpointKey) continue;
            const neighborLineData = neighbor.getEndpointLineData(neighborEndpointKey);
            if (!neighborLineData) continue;
            const neighborOtherEndpoint = neighborEndpointKey === 'a' ? neighbor.b : neighbor.a;
            if (!Wall.hasFinitePoint(neighborOtherEndpoint) || !Wall.hasFinitePoint(otherEndpoint)) continue;

            const thisOrder = orderPlanesByReference(lineData, neighborOtherEndpoint);
            const neighborOrder = orderPlanesByReference(neighborLineData, otherEndpoint);

            // Join inside-to-inside and outside-to-outside.
            const insideHit = Wall.lineIntersection(
                thisOrder.insidePoint, lineData.dir,
                neighborOrder.insidePoint, neighborLineData.dir
            );
            const outsideHit = Wall.lineIntersection(
                thisOrder.outsidePoint, lineData.dir,
                neighborOrder.outsidePoint, neighborLineData.dir
            );

            const mapInsideToLeft = thisOrder.insideIsLeft;
            const leftCandidate = mapInsideToLeft ? insideHit : outsideHit;
            const rightCandidate = mapInsideToLeft ? outsideHit : insideHit;

            if (leftCandidate && isEndpointLocalPoint(leftCandidate)) {
                const d = Math.hypot(leftCandidate.x - endpoint.x, leftCandidate.y - endpoint.y);
                if (d <= maxMiterDistance && d < bestLeftDist) {
                    bestLeftDist = d;
                    bestLeft = leftCandidate;
                }
            }
            if (rightCandidate && isEndpointLocalPoint(rightCandidate)) {
                const d = Math.hypot(rightCandidate.x - endpoint.x, rightCandidate.y - endpoint.y);
                if (d <= maxMiterDistance && d < bestRightDist) {
                    bestRightDist = d;
                    bestRight = rightCandidate;
                }
            }
        }

        let left = bestLeft || defaultLeft;
        let right = bestRight || defaultRight;

        // Keep wall volume valid even with pathological join geometry.
        if (Math.hypot(left.x - right.x, left.y - right.y) < wallThickness * 0.15) {
            left = defaultLeft;
            right = defaultRight;
        }
        return { left, right };
    }

    shouldPreserveEndpointJunction(endpointKey) {
        const endpoint = endpointKey === 'a' ? this.a : this.b;
        if (!endpoint) return false;
        const neighbors = this.collectPotentialJoinWalls().filter(wall => this.sharesEndpointWith(wall, endpoint));
        if (neighbors.length < 2) return false;
        if (!this.joinCorners) return false;
        if (endpointKey === 'a') {
            return Wall.hasFinitePoint(this.joinCorners.aLeft) && Wall.hasFinitePoint(this.joinCorners.aRight);
        }
        return Wall.hasFinitePoint(this.joinCorners.bLeft) && Wall.hasFinitePoint(this.joinCorners.bRight);
    }

    sharesEndpointWith(otherWall, endpoint) {
        if (!otherWall || !endpoint) return false;
        return (
            Wall.pointsMatch(endpoint, otherWall.a) ||
            Wall.pointsMatch(endpoint, otherWall.b)
        );
    }

    collectPotentialJoinWalls() {
        if (!this.map) return [];
        const candidates = new Set();
        const nodesToCheck = new Set();
        const endpoints = [this.a, this.b];

        endpoints.forEach(endpoint => {
            if (!endpoint || !Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) return;
            const node = this.map.worldToNode(endpoint.x, endpoint.y);
            if (!node) return;
            nodesToCheck.add(node);
            if (Array.isArray(node.neighbors)) {
                node.neighbors.forEach(neighbor => {
                    if (neighbor) nodesToCheck.add(neighbor);
                });
            }
        });

        this.nodes.forEach(node => {
            if (node) nodesToCheck.add(node);
        });

        nodesToCheck.forEach(node => {
            if (!node || !Array.isArray(node.objects)) return;
            node.objects.forEach(obj => {
                if (!obj || obj === this || obj.type !== 'wall') return;
                if (
                    this.sharesEndpointWith(obj, this.a) ||
                    this.sharesEndpointWith(obj, this.b)
                ) {
                    candidates.add(obj);
                }
            });
        });

        return Array.from(candidates);
    }

    hasConnectedWallAtEndpoint(endpointKey) {
        const endpoint = endpointKey === "a" ? this.a : this.b;
        if (!endpoint) return false;
        return this.collectPotentialJoinWalls().some(wall => this.sharesEndpointWith(wall, endpoint));
    }

    collectWallsSharingDeletedEndpoints() {
        if (!this.map) return [];
        const walls = new Set();
        const endpoints = [this.a, this.b];
        const nodesToCheck = new Set();

        endpoints.forEach(endpoint => {
            if (!endpoint || !Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) return;
            const node = this.map.worldToNode(endpoint.x, endpoint.y);
            if (!node) return;
            nodesToCheck.add(node);
            if (Array.isArray(node.neighbors)) {
                node.neighbors.forEach(neighbor => {
                    if (neighbor) nodesToCheck.add(neighbor);
                });
            }
        });

        nodesToCheck.forEach(node => {
            if (!node || !Array.isArray(node.objects)) return;
            node.objects.forEach(obj => {
                if (!obj || obj === this || obj.type !== 'wall') return;
                if (
                    this.sharesEndpointWith(obj, this.a) ||
                    this.sharesEndpointWith(obj, this.b)
                ) {
                    walls.add(obj);
                }
            });
        });

        return Array.from(walls);
    }

    rebuildHitboxesFromJoinState() {
        const profile = this.getWallProfile();
        if (!profile) {
            this.visualHitbox = null;
            this.groundPlaneHitbox = null;
            return;
        }

        const wallHeight = Math.max(0.001, Number(this.height) || 0.001);
        const { aLeft, aRight, bLeft, bRight } = profile;
        this.groundPlaneHitbox = new PolygonHitbox([aLeft, aRight, bRight, bLeft]);
        this.visualHitbox = new PolygonHitbox([
            { x: aLeft.x, y: aLeft.y },
            { x: aLeft.x, y: aLeft.y - wallHeight },
            { x: bLeft.x, y: bLeft.y - wallHeight },
            { x: bLeft.x, y: bLeft.y },
            { x: bRight.x, y: bRight.y },
            { x: bRight.x, y: bRight.y - wallHeight },
            { x: aRight.x, y: aRight.y - wallHeight },
            { x: aRight.x, y: aRight.y }
        ]);
    }

    recomputeJoins(options = {}) {
        const preserveMultiJunction = !!(options && options.preserveMultiJunction);
        const keepA = preserveMultiJunction && this.shouldPreserveEndpointJunction('a');
        const keepB = preserveMultiJunction && this.shouldPreserveEndpointJunction('b');

        const aJoin = keepA
            ? { left: this.joinCorners.aLeft, right: this.joinCorners.aRight }
            : this.computeJoinedEndpointCorners('a');
        const bJoin = keepB
            ? { left: this.joinCorners.bLeft, right: this.joinCorners.bRight }
            : this.computeJoinedEndpointCorners('b');

        this.joinCorners = {
            aLeft: aJoin ? aJoin.left : null,
            aRight: aJoin ? aJoin.right : null,
            bLeft: bJoin ? bJoin.left : null,
            bRight: bJoin ? bJoin.right : null
        };
        this.rebuildHitboxesFromJoinState();
    }

    updateConnectedWallJoins() {
        const neighbors = this.collectPotentialJoinWalls();
        this.recomputeJoins();
        neighbors.forEach(wall => {
            if (wall && typeof wall.recomputeJoins === 'function') {
                wall.recomputeJoins({ preserveMultiJunction: true });
            }
        });
    }
    
    findNodesAlongWall(endpointA, endpointB) {
        // Find all nodes between the two endpoints
        // Only add actual MapNodes (check if they have xindex property)
        if (this.isMapNode(endpointA)) {
            this.nodes.push(endpointA);
        }
        if (this.isMapNode(endpointB) && endpointB !== endpointA) {
            this.nodes.push(endpointB);
        }
    }
    
    isMapNode(obj) {
        // MapNodes have xindex and yindex properties
        return obj && typeof obj.xindex === 'number' && typeof obj.yindex === 'number';
    }
    
    addToNodes() {
        // Add this wall to all nodes it sits on
        for (const node of this.nodes) {
            if (node) {
                node.addObject(this);
            }
        }
    }
    
    removeFromNodes() {
        // Remove this wall from all nodes it sits on
        for (const node of this.nodes) {
            if (node) {
                node.removeObject(this);
            }
        }
        
        // Clear all blocked links
        for (const link of this.blockedLinks) {
            const {node, direction} = link;
            if (node.blockedNeighbors && node.blockedNeighbors.has(direction)) {
                const blockSet = node.blockedNeighbors.get(direction);
                blockSet.delete(this);
                if (blockSet.size === 0) {
                    node.blockedNeighbors.delete(direction);
                }
            }
        }
        this.blockedLinks = [];

        // Recompute only walls that shared an endpoint with this deleted wall.
        // Their joins now resolve against the reduced local wall set.
        const adjacentWalls = this.collectWallsSharingDeletedEndpoints();
        adjacentWalls.forEach(wall => {
            if (wall && typeof wall.recomputeJoins === 'function') {
                wall.recomputeJoins();
            }
        });
        Wall.recomputeLineGroups(this.map);
    }
    
    addBlockedLink(node, direction) {
        if (!node.blockedNeighbors) {
            node.blockedNeighbors = new Map();
        }
        if (!node.blockedNeighbors.has(direction)) {
            node.blockedNeighbors.set(direction, new Set());
        }
        node.blockedNeighbors.get(direction).add(this);
        
        // Track this blocked link for cleanup later
        this.blockedLinks.push({node, direction});
    }
    
    blockCrossConnection(node, dirA, dirB) {
        // Block the connection between node.neighbors[dirA] and node.neighbors[dirB]
        const neighborA = node.neighbors[dirA];
        const neighborB = node.neighbors[dirB];
        
        if (!neighborA || !neighborB) return;
        
        // Find the directions between the two neighbors
        const dirAtoB = neighborA.neighbors.indexOf(neighborB);
        const dirBtoA = neighborB.neighbors.indexOf(neighborA);
        
        if (dirAtoB !== -1) {
            this.addBlockedLink(neighborA, dirAtoB);
        }
        if (dirBtoA !== -1) {
            this.addBlockedLink(neighborB, dirBtoA);
        }
    }
    
    draw() {
        // Clear previous frame's drawing
        this.pixiSprite.clear();
        // Use the static method to draw this wall
        const profile = this.getWallProfile();
        const renderCapA = !this.hasConnectedWallAtEndpoint("a");
        const renderCapB = !this.hasConnectedWallAtEndpoint("b");
        Wall.drawWall(
            this.pixiSprite,
            this.a,
            this.b,
            this.height,
            this.thickness,
            0x555555,
            1.0,
            {
                profile,
                texturePhaseA: this.texturePhaseA,
                texturePhaseB: this.texturePhaseB,
                renderCapA,
                renderCapB
            }
        );
    }
    
    static createWallLine(wallPath, height, thickness, map) {
        // Create a chain of walls along a path, handling long diagonals
        const walls = [];
        const isMapNode = (obj) => obj && typeof obj.xindex === 'number' && typeof obj.yindex === 'number';
        const nearlyEqual = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
        const pointsMatch = (p1, p2) => nearlyEqual(p1.x, p2.x) && nearlyEqual(p1.y, p2.y);
        const wallExistsBetween = (endpointA, endpointB) => {
            const nodesToCheck = [];
            if (isMapNode(endpointA)) nodesToCheck.push(endpointA);
            if (isMapNode(endpointB) && endpointB !== endpointA) nodesToCheck.push(endpointB);
            for (const node of nodesToCheck) {
                const nodeObjects = node.objects || [];
                for (const obj of nodeObjects) {
                    if (!obj || obj.type !== 'wall' || !obj.a || !obj.b) continue;
                    const forwardMatch = pointsMatch(obj.a, endpointA) && pointsMatch(obj.b, endpointB);
                    const reverseMatch = pointsMatch(obj.a, endpointB) && pointsMatch(obj.b, endpointA);
                    if (forwardMatch || reverseMatch) return true;
                }
            }
            return false;
        };
        const getWallsSharingEndpoint = endpoint => {
            if (!endpoint || !Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) return [];
            const node = map.worldToNode(endpoint.x, endpoint.y);
            if (!node || !Array.isArray(node.objects)) return [];
            return node.objects.filter(obj =>
                obj &&
                obj.type === 'wall' &&
                (Wall.pointsMatch(obj.a, endpoint) || Wall.pointsMatch(obj.b, endpoint))
            );
        };

        if (wallPath.length > 1) {
            const startWalls = getWallsSharingEndpoint(wallPath[0]);
            const endWalls = getWallsSharingEndpoint(wallPath[wallPath.length - 1]);
            if (!startWalls.length && endWalls.length) {
                wallPath = wallPath.slice().reverse();
            }
        }

        const newSegments = [];
        
        for (let i = 0; i < wallPath.length - 1; i++) {
            let nodeA = wallPath[i];
            let nodeB = wallPath[i + 1];
            
            // Check if this is a long diagonal (not adjacent)
            const directionAtoB = nodeA.neighbors.indexOf(nodeB);
            const directionBtoA = nodeB.neighbors.indexOf(nodeA);
            let wallDirection;
            if (directionBtoA < directionAtoB) {
                wallDirection = directionBtoA;
                let nodeC = nodeA;
                nodeA = nodeB;
                nodeB = nodeC;
            } else {
                wallDirection = directionAtoB;
            }
            if (directionAtoB % 2 == 0) {
                
                const midpointX = (nodeA.x + nodeB.x) / 2;
                const midpointY = (nodeA.y + nodeB.y) / 2;
                const midpoint = {x: midpointX, y: midpointY};
                
                // Wall 1: from nodeA to midpoint
                if (!wallExistsBetween(nodeA, midpoint)) {
                    const wall1 = new Wall(nodeA, midpoint, height, thickness, map, wallDirection);
                    walls.push(wall1);
                    newSegments.push({ wall: wall1, from: nodeA, to: midpoint });
                }
                
                // Wall 2: from midpoint to nodeB
                if (!wallExistsBetween(midpoint, nodeB)) {
                    const wall2 = new Wall(midpoint, nodeB, height, thickness, map, wallDirection + 6);
                    walls.push(wall2);
                    newSegments.push({ wall: wall2, from: midpoint, to: nodeB });
                }
            } else {
                // Regular adjacent wall
                if (!wallExistsBetween(nodeA, nodeB)) {
                    const wall = new Wall(nodeA, nodeB, height, thickness, map, wallDirection);
                    walls.push(wall);
                    newSegments.push({ wall, from: nodeA, to: nodeB });
                }
            }
        }

        // Keep horizontal wall texture phase continuous across newly placed segments.
        if (newSegments.length > 0) {
            const startEndpoint = newSegments[0].from;
            const startAttachedWalls = getWallsSharingEndpoint(startEndpoint).filter(w => !newSegments.some(s => s.wall === w));
            let phaseCursor = 0;
            if (startAttachedWalls.length > 0) {
                const inherited = startAttachedWalls[0].getTexturePhaseAtEndpoint(startEndpoint);
                if (Number.isFinite(inherited)) phaseCursor = inherited;
            }
            for (const segment of newSegments) {
                const segmentLength = Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
                const phaseStep = segmentLength / 3; // three map units per repeat
                const nextPhase = phaseCursor + phaseStep;
                segment.wall.setTexturePhaseForOrderedEndpoints(
                    segment.from,
                    segment.to,
                    phaseCursor,
                    nextPhase
                );
                phaseCursor = nextPhase;
            }
        }
        
        return walls;
    }

    static drawWall(graphics, endpointA, endpointB, height, thickness, color, alpha, options = {}) {
        if (!graphics || !endpointA || !endpointB) return;
        const ax = Number(endpointA.x);
        const ay = Number(endpointA.y);
        const bx = Number(endpointB.x);
        const by = Number(endpointB.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return;

        const wallHeight = Math.max(0.001, Number(height) || 0.001);
        const wallThickness = Math.max(0.001, Number(thickness) || 0.001);
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return;

        const halfThickness = wallThickness / 2;
        const nx = -dy / len;
        const ny = dx / len;

        let aLeft = { x: ax + nx * halfThickness, y: ay + ny * halfThickness };
        let aRight = { x: ax - nx * halfThickness, y: ay - ny * halfThickness };
        let bLeft = { x: bx + nx * halfThickness, y: by + ny * halfThickness };
        let bRight = { x: bx - nx * halfThickness, y: by - ny * halfThickness };
        if (options && options.profile) {
            const p = options.profile;
            if (p.aLeft) aLeft = p.aLeft;
            if (p.aRight) aRight = p.aRight;
            if (p.bLeft) bLeft = p.bLeft;
            if (p.bRight) bRight = p.bRight;
        }

        const toScreen = (pt, z = 0) => {
            const screen = worldToScreen(pt);
            return { x: screen.x, y: screen.y - z * viewscale * xyratio };
        };

        const gAL = toScreen(aLeft, 0);
        const gAR = toScreen(aRight, 0);
        const gBL = toScreen(bLeft, 0);
        const gBR = toScreen(bRight, 0);
        const tAL = toScreen(aLeft, wallHeight);
        const tAR = toScreen(aRight, wallHeight);
        const tBL = toScreen(bLeft, wallHeight);
        const tBR = toScreen(bRight, wallHeight);

        const shadeColor = (hex, factor) => {
            const f = Math.max(0, factor);
            const r = Math.min(255, Math.max(0, Math.round(((hex >> 16) & 0xff) * f)));
            const g = Math.min(255, Math.max(0, Math.round(((hex >> 8) & 0xff) * f)));
            const b = Math.min(255, Math.max(0, Math.round((hex & 0xff) * f)));
            return (r << 16) | (g << 8) | b;
        };

        const faceDepth = pts => pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
        const longFaceA = [gAL, gBL, tBL, tAL];
        const longFaceB = [gAR, gBR, tBR, tAR];
        const capFaceA = [gAR, gAL, tAL, tAR];
        const capFaceB = [gBL, gBR, tBR, tBL];
        const topFace = [tAL, tBL, tBR, tAR];
        const renderCapA = options.renderCapA !== false;
        const renderCapB = options.renderCapB !== false;

        const longAFront = faceDepth(longFaceA) >= faceDepth(longFaceB);
        const capAFront = faceDepth(capFaceA) >= faceDepth(capFaceB);
        const stoneTexture = options.disableWallTexture ? null : Wall.getStoneWallTexture();
        const zUnitPx = Math.max(1, viewscale * xyratio);
        const phaseA = Number.isFinite(options.texturePhaseA) ? options.texturePhaseA : 0;
        const phaseB = Number.isFinite(options.texturePhaseB) ? options.texturePhaseB : (phaseA + len / 3);
        const shadeColorFactor = 1.2;

        const faces = [
            longAFront
                ? {
                    pts: longFaceA,
                    color: shadeColor(color, 1.18 * shadeColorFactor),
                    textured: true
                }
                : {
                    pts: longFaceB,
                    color: shadeColor(color, 1.18 * shadeColorFactor),
                    textured: true
                },
        ];
        const frontCapIsA = capAFront;
        if (frontCapIsA && renderCapA) {
            faces.push({
                pts: capFaceA,
                color: shadeColor(color, 1.08 * shadeColorFactor),
                textured: true
            });
        }
        if (!frontCapIsA && renderCapB) {
            faces.push({
                pts: capFaceB,
                color: shadeColor(color, 1.08 * shadeColorFactor),
                textured: true
            });
        }

        faces.sort((aFace, bFace) => faceDepth(aFace.pts) - faceDepth(bFace.pts));
        graphics.lineStyle(0);
        for (const face of faces) {
            const pts = face.pts;
            const shouldTexture = !!stoneTexture && face.textured;
            if (shouldTexture) {
                const bottomA = pts[0];
                const bottomB = pts[1];
                const topA = pts[3];
                const u = {
                    x: bottomB.x - bottomA.x,
                    y: bottomB.y - bottomA.y
                };
                const v = {
                    x: topA.x - bottomA.x,
                    y: topA.y - bottomA.y
                };
                const uLen = Math.max(1e-6, Math.hypot(u.x, u.y));
                const vLen = Math.max(1e-6, Math.hypot(v.x, v.y));
                const uDir = { x: u.x / uLen, y: u.y / uLen };
                const vDir = { x: v.x / vLen, y: v.y / vLen };
                const texW = Math.max(1, stoneTexture.width || (stoneTexture.baseTexture && stoneTexture.baseTexture.width) || 256);
                const texH = Math.max(1, stoneTexture.height || (stoneTexture.baseTexture && stoneTexture.baseTexture.height) || 256);
                const repeatsAcrossFace = Math.max(1e-6, Math.abs(phaseB - phaseA));
                const uRepeatPx = Math.max(1, uLen / repeatsAcrossFace);
                const vRepeatPx = zUnitPx * 3; // three map height units per vertical repeat
                const phaseShiftPx = phaseA * uRepeatPx;
                const matrix = new PIXI.Matrix(
                    uDir.x * (uRepeatPx / texW),
                    uDir.y * (uRepeatPx / texW),
                    vDir.x * (vRepeatPx / texH),
                    vDir.y * (vRepeatPx / texH),
                    bottomA.x - uDir.x * phaseShiftPx,
                    bottomA.y - uDir.y * phaseShiftPx
                );
                graphics.beginTextureFill({
                    texture: stoneTexture,
                    color: face.color,
                    alpha,
                    matrix
                });
            } else {
                graphics.beginFill(face.color, alpha);
            }
            graphics.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                graphics.lineTo(pts[i].x, pts[i].y);
            }
            graphics.closePath();
            graphics.endFill();
        }

        // Draw the top cap last to ensure the prism appears closed.
        const topCenter = topFace.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        topCenter.x /= topFace.length;
        topCenter.y /= topFace.length;
        const orderedTop = topFace
            .slice()
            .sort((p1, p2) => Math.atan2(p1.y - topCenter.y, p1.x - topCenter.x) - Math.atan2(p2.y - topCenter.y, p2.x - topCenter.x));

        graphics.lineStyle(0);
        graphics.beginFill(shadeColor(color, 1.2), alpha);
        graphics.moveTo(orderedTop[0].x, orderedTop[0].y);
        for (let i = 1; i < orderedTop.length; i++) {
            graphics.lineTo(orderedTop[i].x, orderedTop[i].y);
        }
        graphics.closePath();
        graphics.endFill();
    }

    saveJson() {
        return {
            type: 'wall',
            aX: this.a.x,
            aY: this.a.y,
            bX: this.b.x,
            bY: this.b.y,
            height: this.height,
            thickness: this.thickness,
            texturePhaseA: this.texturePhaseA,
            texturePhaseB: this.texturePhaseB
        };
    }

    static loadJson(data, map) {
        if (!data || data.type !== 'wall' || !map) return null;

        try {
            let nodeA = map.worldToNode(data.aX, data.aY);
            let nodeB = map.worldToNode(data.bX, data.bY);
            if (Math.abs(nodeA.x - data.aX) > 0.1 || Math.abs(nodeA.y - data.aY) > 0.1) {
                nodeA = {x: data.aX, y: data.aY}; // Use raw coordinates if no close node found
            }
            if (Math.abs(nodeB.x - data.bX) > 0.1 || Math.abs(nodeB.y - data.bY) > 0.1) {
                nodeB = {x: data.bX, y: data.bY}; // Use raw coordinates if no close node found
            }
            if (!nodeA || !nodeB) return null;
            let direction = map.getHexDirection(nodeA.x - nodeB.x, nodeA.y - nodeB.y) % 6;
            const wall = new Wall(nodeA, nodeB, data.height || 1, data.thickness || 0.1, map, direction);
            if (Number.isFinite(data.texturePhaseA)) wall.texturePhaseA = data.texturePhaseA;
            if (Number.isFinite(data.texturePhaseB)) wall.texturePhaseB = data.texturePhaseB;
            return wall;
        } catch (e) {
            console.error("Error loading wall:", e);
            return null;
        }
    }

    ignite() {
        // these walls are non-flammable, so do nothing
    }
}

class Road extends StaticObject {
    static _geometryCache = new Map();
    static _textureCache = new Map();
    static _textureCacheVersion = 5;
    static _oddDirections = [1, 3, 5, 7, 9, 11];
    static _gravelTexture = null;
    static _fillTextureCache = new Map();
    static _defaultFillTexturePath = '/assets/images/flooring/dirt.jpg';
    static _repeatWorldUnits = 10;
    static _pixelsPerWorldUnit = (128 * 2) / 1.1547;
    static _edgeFadePx = 64;
    static _phaseQuantPx = 8;
    static _textureScaleByName = {
        "cobblestones.png": { x: 0.5, y: 0.5, squashByXyRatio: true }
    };

    static _getTextureScale(texturePath) {
        const rawPath = (typeof texturePath === 'string') ? texturePath : '';
        const filename = rawPath.split('/').pop().toLowerCase();
        const rule = Road._textureScaleByName[filename];
        if (!rule) return { x: 1, y: 1 };

        const sx = Number.isFinite(rule.x) ? rule.x : 1;
        let sy = Number.isFinite(rule.y) ? rule.y : 1;
        if (rule.squashByXyRatio) {
            const yRatio = (typeof globalThis !== 'undefined' && Number.isFinite(globalThis.xyratio))
                ? globalThis.xyratio
                : 0.66;
            sy *= yRatio;
        }
        return { x: sx, y: sy };
    }

    static _getGravelTexture() {
        if (!Road._gravelTexture) {
            Road._gravelTexture = PIXI.Texture.from('/assets/images/gravel.jpeg');
            if (Road._gravelTexture && Road._gravelTexture.baseTexture) {
                Road._gravelTexture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
                Road._gravelTexture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
            }
        }
        return Road._gravelTexture;
    }

    static _getFillTexture(texturePath = Road._defaultFillTexturePath) {
        const resolvedPath = (typeof texturePath === 'string' && texturePath.length > 0)
            ? texturePath
            : Road._defaultFillTexturePath;
        if (!Road._fillTextureCache.has(resolvedPath)) {
            const tex = PIXI.Texture.from(resolvedPath);
            if (tex && tex.baseTexture) {
                tex.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
                tex.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
            }
            Road._fillTextureCache.set(resolvedPath, tex);
        }
        return Road._fillTextureCache.get(resolvedPath);
    }

    static _pointInPolygon(px, py, points) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x;
            const yi = points[i].y;
            const xj = points[j].x;
            const yj = points[j].y;
            const intersect = ((yi > py) !== (yj > py)) &&
                (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-7) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    static _getNeighborMask(neighborDirections) {
        if (!Array.isArray(neighborDirections) || neighborDirections.length === 0) return 0;
        let mask = 0;
        Road._oddDirections.forEach((dir, idx) => {
            if (neighborDirections.includes(dir)) mask |= (1 << idx);
        });
        return mask;
    }

    static _buildGeometryForMask(mask) {
        const radius = 128;
        const corners = [];
        for (let i = 0; i < 6; i++) {
            const angle = (i * Math.PI / 3) + Math.PI;  // Start at left (180°)
            const x = radius * Math.cos(angle);
            const y = radius * Math.sin(angle);
            corners.push({x, y});
        }

        const bounds = {
            x: corners[0].x,
            y: corners[1].y,
            width: corners[3].x - corners[0].x,
            height: corners[4].y - corners[1].y
        };

        const neighbors = Road._oddDirections.filter((_, idx) => (mask & (1 << idx)) !== 0);

        const skipCorners = new Set();
        for (let i = 0; i < Road._oddDirections.length; i++) {
            const a = Road._oddDirections[i];
            const b = Road._oddDirections[(i + 5) % 6];
            if (neighbors.includes(a) || neighbors.includes(b)) {
                continue; // Don't skip if either neighbor is road
            }
            const c = Road._oddDirections[(i + 1) % 6];
            const d = Road._oddDirections[(i + 4) % 6];
            if (neighbors.includes(c) || neighbors.includes(d)) {
                skipCorners.add(i); // Skip this corner it's one away from another road
            }
        }
        for (let i = 0; i < 6; i++) {
            if (!skipCorners.has(i) && skipCorners.has((i + 5) % 6) && skipCorners.has((i + 1) % 6)) {
                corners[i].x = 0; // Move skipped corners to center to create a straight edge
                corners[i].y = 0;
            }
        }

        const keptCorners = [];
        const keptCornerIndices = [];
        for (let i = 0; i < corners.length; i++) {
            if (skipCorners.has(i)) continue;
            keptCorners.push(corners[i]);
            keptCornerIndices.push(i);
        }

        return { keptCorners, keptCornerIndices, radius, bounds, mask };
    }

    static getGeometryForNeighbors(neighborDirections) {
        const mask = Road._getNeighborMask(neighborDirections);
        if (!Road._geometryCache.has(mask)) {
            Road._geometryCache.set(mask, Road._buildGeometryForMask(mask));
        }
        return Road._geometryCache.get(mask);
    }

    static _buildTextureForMask(mask, phaseX, phaseY, fillTexturePath = Road._defaultFillTexturePath) {
        const geometry = Road._geometryCache.has(mask)
            ? Road._geometryCache.get(mask)
            : Road._buildGeometryForMask(mask);
        if (!Road._geometryCache.has(mask)) {
            Road._geometryCache.set(mask, geometry);
        }

        const { keptCorners, keptCornerIndices } = geometry;
        const size = 256;
        const canvasWidth = size;
        const canvasHeight = Math.round(size * 0.866);
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        const repeatPx = Road._repeatWorldUnits * Road._pixelsPerWorldUnit;
        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return PIXI.Texture.WHITE;

        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        ctx.save();
        ctx.beginPath();
        keptCorners.forEach((pt, idx) => {
            const x = centerX + pt.x;
            const y = centerY + pt.y;
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.clip();

        const fillTexture = Road._getFillTexture(fillTexturePath);
        const baseTexture = fillTexture && fillTexture.baseTexture ? fillTexture.baseTexture : null;
        const source = baseTexture && baseTexture.valid && baseTexture.resource
            ? baseTexture.resource.source
            : null;
        let drewSource = false;

        if (source && source.width > 0 && source.height > 0) {
            try {
                const texScale = Road._getTextureScale(fillTexturePath);
                const tileW = Math.max(1, repeatPx * texScale.x);
                const tileH = Math.max(1, repeatPx * texScale.y);
                // Keep world-phase offsets unscaled so neighboring road tiles
                // sample the same global texture field without seam drift.
                const startX = centerX - phaseX;
                const startY = centerY - phaseY;
                for (let x = startX - tileW; x < canvasWidth + tileW; x += tileW) {
                    for (let y = startY - tileH; y < canvasHeight + tileH; y += tileH) {
                        ctx.drawImage(source, x, y, tileW, tileH);
                    }
                }
                drewSource = true;
            } catch (e) {
                drewSource = false;
            }
        }
        if (!drewSource) {
            ctx.fillStyle = '#8d7558';
            ctx.fill();
        }
        ctx.restore();

        // Fade inward on polygon edges that do NOT border another road.
        // Keep polygon boundaries unchanged by only reducing alpha inside the edge.
        const fadePx = Road._edgeFadePx;
        const neighborBits = [];
        for (let i = 0; i < 6; i++) {
            neighborBits.push((mask & (1 << i)) !== 0);
        }

        const fadeEdges = [];
        for (let i = 0; i < keptCorners.length; i++) {
            const j = (i + 1) % keptCorners.length;
            const aIdx = keptCornerIndices[i];
            const bIdx = keptCornerIndices[j];
            const step = (bIdx - aIdx + 6) % 6;

            // Edge is between original adjacent corners.
            // Treat it as bordered if that side has a road neighbor.
            const bordersRoad = (step === 1) && neighborBits[aIdx];
            if (bordersRoad) continue;

            const p0 = { x: centerX + keptCorners[i].x, y: centerY + keptCorners[i].y };
            const p1 = { x: centerX + keptCorners[j].x, y: centerY + keptCorners[j].y };
            fadeEdges.push({ ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y });
        }

        if (fadeEdges.length > 0) {
            // Fast path: approximate distance fade using clipped gradient strips
            // instead of per-pixel CPU processing.
            const polygonPoints = keptCorners.map(pt => ({ x: centerX + pt.x, y: centerY + pt.y }));
            ctx.save();
            ctx.beginPath();
            keptCorners.forEach((pt, idx) => {
                const x = centerX + pt.x;
                const y = centerY + pt.y;
                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.closePath();
            ctx.clip();

            for (let i = 0; i < fadeEdges.length; i++) {
                const edge = fadeEdges[i];
                const p0 = { x: edge.ax, y: edge.ay };
                const p1 = { x: edge.bx, y: edge.by };
                const mx = (p0.x + p1.x) * 0.5;
                const my = (p0.y + p1.y) * 0.5;

                const ex = p1.x - p0.x;
                const ey = p1.y - p0.y;
                const edgeLen = Math.hypot(ex, ey) || 1;
                const tx = ex / edgeLen;
                const ty = ey / edgeLen;
                let nx = -ey / edgeLen;
                let ny = ex / edgeLen;
                // Choose the normal that points inward using multiple probes.
                const centroid = polygonPoints.reduce((acc, pt) => {
                    acc.x += pt.x;
                    acc.y += pt.y;
                    return acc;
                }, { x: 0, y: 0 });
                centroid.x /= polygonPoints.length;
                centroid.y /= polygonPoints.length;
                const probeDistances = [2, Math.max(4, fadePx * 0.2), Math.max(6, fadePx * 0.45)];
                const scoreNormal = (sx, sy) => {
                    let score = 0;
                    for (let k = 0; k < probeDistances.length; k++) {
                        const d = probeDistances[k];
                        if (Road._pointInPolygon(mx + sx * d, my + sy * d, polygonPoints)) {
                            score += 1;
                        }
                    }
                    return score;
                };
                const scoreA = scoreNormal(nx, ny);
                const scoreB = scoreNormal(-nx, -ny);
                if (scoreB > scoreA) {
                    nx = -nx;
                    ny = -ny;
                } else if (scoreA === scoreB) {
                    // Tie-break toward polygon centroid.
                    const toCenterX = centroid.x - mx;
                    const toCenterY = centroid.y - my;
                    if ((toCenterX * nx + toCenterY * ny) < 0) {
                        nx = -nx;
                        ny = -ny;
                    }
                }

                // Extend strip along tangent so fade width tracks interior shape
                // better near corners.
                const ext = fadePx * 1.5;
                const a0 = { x: p0.x - tx * ext, y: p0.y - ty * ext };
                const a1 = { x: p1.x + tx * ext, y: p1.y + ty * ext };
                const b0 = { x: a0.x + nx * fadePx, y: a0.y + ny * fadePx };
                const b1 = { x: a1.x + nx * fadePx, y: a1.y + ny * fadePx };

                ctx.save();
                ctx.globalCompositeOperation = 'destination-out';
                const grad = ctx.createLinearGradient(mx, my, mx + nx * fadePx, my + ny * fadePx);
                grad.addColorStop(0, 'rgba(0,0,0,1)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.moveTo(a0.x, a0.y);
                ctx.lineTo(a1.x, a1.y);
                ctx.lineTo(b1.x, b1.y);
                ctx.lineTo(b0.x, b0.y);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
            ctx.restore();
        }

        return PIXI.Texture.from(canvas);
    }

    static _getTextureForMaskAndPhase(mask, phaseX, phaseY, fillTexturePath = Road._defaultFillTexturePath) {
        const q = Math.max(1, Road._phaseQuantPx);
        const qx = Math.round(phaseX / q) * q;
        const qy = Math.round(phaseY / q) * q;
        const textureKey = (typeof fillTexturePath === 'string' && fillTexturePath.length > 0)
            ? fillTexturePath
            : Road._defaultFillTexturePath;
        const key = `${Road._textureCacheVersion}:${Road._edgeFadePx}:${q}:${textureKey}:${mask}:${qx}:${qy}`;
        if (!Road._textureCache.has(key)) {
            Road._textureCache.set(key, Road._buildTextureForMask(mask, qx, qy, textureKey));
        }
        return Road._textureCache.get(key);
    }
    constructor(location, textures, map, options = {}) {
        // Create initial textures array (will be populated by updateTexture)
        const dynamicTextures = [PIXI.Texture.WHITE];
        
        super('road', location, 1, 1, dynamicTextures, map);
        this.blocksTile = false; // Pavement doesn't block movement
        this.isPassable = true; // Can be walked on
        this.visualRadius = 0.5;
        this.groundRadius = 0.5;
        this.pixiSprite.anchor.set(0.5, 0.5); // Center the sprite on the node
        this.pixiSprite.visible = true;
        this.visualHitbox = null;
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, this.groundRadius);
        this.width = 1;
        this.height = 1;
        this.renderZ = 0;
        this.fillTexturePath = (options && typeof options.fillTexturePath === 'string' && options.fillTexturePath.length > 0)
            ? options.fillTexturePath
            : Road._defaultFillTexturePath;
        // super() registers the object before road-specific flags are set.
        // Recount so this road is not treated as blocking.
        if (this.node && typeof this.node.recountBlockingObjects === 'function') {
            this.node.recountBlockingObjects();
        }
        
        // Generate the initial texture
        this.updateTexture();
        // Adjacent roads also need to update
        [1, 3, 5, 7, 9, 11].forEach(direction => {
            const neighbor = this.node.neighbors[direction];
            if (neighbor && neighbor.objects) {
                neighbor.objects.forEach(obj => {
                    if (obj.type === 'road' && typeof obj.updateTexture === 'function') {
                        obj.updateTexture();
                    }
                });
            }
        });
        if (location instanceof MapNode) {
            this.node = location;
        }
    }

    // Roads are intentionally non-flammable.
    ignite() {
        this.isOnFire = false;
        this.fireDuration = 0;
        if (this.fireSprite && this.fireSprite.parent) {
            this.fireSprite.parent.removeChild(this.fireSprite);
            this.fireSprite = null;
        }
    }

    removeFromNodes() {
        super.removeFromNodes();

        const node = this.getNode();
        const neighborNodes = node ? [1, 3, 5, 7, 9, 11]
            .map(direction => node.neighbors[direction])
            .filter(Boolean)
            : [];

        neighborNodes.forEach(neighbor => {
            if (neighbor && neighbor.objects) {
                neighbor.objects.forEach(obj => {
                    if (obj.type === 'road' && typeof obj.updateTexture === 'function') {
                        obj.updateTexture();
                    }
                });
            }
        });
    }
    
    updateTexture(neighborDirectionsOverride = null) {
        const neighbors = Array.isArray(neighborDirectionsOverride)
            ? neighborDirectionsOverride
            : Road._oddDirections.filter(direction => {
                const neighbor = this.node.neighbors[direction];
                return neighbor && neighbor.objects && neighbor.objects.some(obj => obj.type === 'road');
            });

        const mask = Road._getNeighborMask(neighbors);
        const { keptCorners, radius } = Road.getGeometryForNeighbors(neighbors);
        const repeat = Road._repeatWorldUnits;
        const offsetWorldX = ((this.x % repeat) + repeat) % repeat;
        const offsetWorldY = ((this.y % repeat) + repeat) % repeat;
        const repeatPx = repeat * Road._pixelsPerWorldUnit;
        const phaseX = (offsetWorldX / repeat) * repeatPx;
        const phaseY = (offsetWorldY / repeat) * repeatPx;
        const texture = Road._getTextureForMaskAndPhase(mask, phaseX, phaseY, this.fillTexturePath);
        if (texture) this.pixiSprite.texture = texture;

        const fillTexture = Road._getFillTexture(this.fillTexturePath);
        if (fillTexture && fillTexture.baseTexture && !fillTexture.baseTexture.valid) {
            fillTexture.baseTexture.once('loaded', () => {
                Road._textureCache.clear();
                this.updateTexture(neighborDirectionsOverride);
            });
        }
        
        const hitboxCorners = keptCorners.map(pt => ({x: this.x + pt.x / radius / 2, y: this.y + pt.y / radius / 2}));
        this.visualHitbox = new PolygonHitbox(hitboxCorners);
        this.groundPlaneHitbox = new PolygonHitbox(hitboxCorners);
    }

    saveJson() {
        const data = super.saveJson();
        data.fillTexturePath = this.fillTexturePath || Road._defaultFillTexturePath;
        return data;
    }
}

// Ensure map generation can resolve these constructors across script files.
if (typeof globalThis !== "undefined") {
    globalThis.StaticObject = StaticObject;
    globalThis.Tree = Tree;
    globalThis.Playground = Playground;
    globalThis.Wall = Wall;
    globalThis.Road = Road;
}
