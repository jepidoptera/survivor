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
        
        // Create Pixi sprite with random texture variant
        const texture = textures[Math.floor(Math.random() * textures.length)];
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
}

class Tree extends StaticObject {
    constructor(location, textures, map) {
        super('tree', location, 4, 4, textures, map);
        this.height = 4;
        this.hp = 100;
        this.maxHP = 100;
        this.visualRadius = 1.75;
        this.visualHitbox = new CircleHitbox(this.x, this.y - this.height, this.visualRadius);
        this.groundRadius = 0.5;
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, this.groundRadius);
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
        this.blocksTile = false;
        this.pixiSprite = new PIXI.Graphics();
        this.skipTransform = true;
        
        if (direction == 3 || direction == 9) {
            this.visualHitbox = new PolygonHitbox([
                {x: endpointA.x - this.thickness, y: endpointA.y - this.height},
                {x: endpointA.x + this.thickness, y: endpointA.y - this.height},
                {x: endpointB.x + this.thickness, y: endpointB.y - this.height},
                {x: endpointB.x - this.thickness, y: endpointB.y - this.height}
            ]);
        } else {
            this.visualHitbox = new PolygonHitbox([
                {x: endpointA.x, y: endpointA.y},
                {x: endpointA.x, y: endpointA.y - this.height},
                {x: endpointB.x, y: endpointB.y - this.height},
                {x: endpointB.x, y: endpointB.y}
            ]);
        }
        const crossVector = {
            x: Math.abs(endpointB.y - endpointA.y) * (thickness / Math.hypot(endpointB.x - endpointA.x, endpointB.y - endpointA.y)),
            y: Math.abs(endpointA.x - endpointB.x) * (thickness / Math.hypot(endpointB.x - endpointA.x, endpointB.y - endpointA.y))
        }
        this.groundPlaneHitbox = new PolygonHitbox([
            {x: endpointA.x + crossVector.x / 2, y: endpointA.y},
            {x: endpointA.x - crossVector.x / 2, y: endpointA.y - crossVector.y},
            {x: endpointB.x - crossVector.x / 2, y: endpointB.y - crossVector.y},
            {x: endpointB.x + crossVector.x / 2, y: endpointB.y}
        ]);

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

        objectLayer.addChild(this.pixiSprite);
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
        Wall.drawWall(this.pixiSprite, this.a, this.b, this.height, this.thickness, 0x555555, 1.0);
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
                }
                
                // Wall 2: from midpoint to nodeB
                if (!wallExistsBetween(midpoint, nodeB)) {
                    const wall2 = new Wall(midpoint, nodeB, height, thickness, map, wallDirection + 6);
                    walls.push(wall2);
                }
            } else {
                // Regular adjacent wall
                if (!wallExistsBetween(nodeA, nodeB)) {
                    const wall = new Wall(nodeA, nodeB, height, thickness, map, wallDirection);
                    walls.push(wall);
                }
            }
        }
        
        return walls;
    }

    static drawWall(graphics, endpointA, endpointB, height, thickness, color, alpha) {
        thickness = thickness * viewscale; // Use wall's thickness property
        // Convert world coordinates to screen coordinates
        const screenA = worldToScreen(endpointA);
        const screenB = worldToScreen(endpointB);
        const screenAx = screenA.x;
        const screenAy = screenA.y;
        const screenBx = screenB.x;
        const screenBy = screenB.y;
        
        // Draw post at the lower endpoint
        graphics.lineStyle(thickness, color, alpha);
        if (screenAy > screenBy) {
            graphics.moveTo(screenAx, screenAy);
            graphics.lineTo(screenAx, screenAy - height * viewscale * xyratio);
        } else if (screenBy > screenAy) {
            graphics.moveTo(screenBx, screenBy);
            graphics.lineTo(screenBx, screenBy - height * viewscale * xyratio);
        }
        
        // Draw main wall body (no outline)
        graphics.lineStyle(0);
        graphics.beginFill(color, alpha);
        graphics.moveTo(screenAx, screenAy);
        graphics.lineTo(screenBx, screenBy);
        graphics.lineTo(screenBx, screenBy - height * viewscale * xyratio);
        graphics.lineTo(screenAx, screenAy - height * viewscale * xyratio);
        graphics.closePath();
        graphics.endFill();
        
        // Draw top edge highlight
        graphics.lineStyle(thickness, 0x999999, alpha);
        graphics.moveTo(screenBx, screenBy - height * viewscale * xyratio);
        graphics.lineTo(screenAx, screenAy - height * viewscale * xyratio);

        graphics.lineStyle(0);
        graphics.beginFill(0x999999, alpha);
        graphics.drawCircle(screenAx, screenAy - height * viewscale * xyratio, thickness / 2 * viewScale);
        graphics.drawCircle(screenBx, screenBy - height * viewscale * xyratio, thickness / 2 * viewScale);
        graphics.endFill();
    }
}

class Road extends StaticObject {
    static _geometryCache = new Map();
    static _oddDirections = [1, 3, 5, 7, 9, 11];
    static _gravelTexture = null;
    blocksTile = false;

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

        const keptCorners = corners.filter((_, idx) => !skipCorners.has(idx));

        return { keptCorners, radius, bounds };
    }

    static getGeometryForNeighbors(neighborDirections) {
        const mask = Road._getNeighborMask(neighborDirections);
        if (!Road._geometryCache.has(mask)) {
            Road._geometryCache.set(mask, Road._buildGeometryForMask(mask));
        }
        return Road._geometryCache.get(mask);
    }
    constructor(location, textures, map) {
        // Create initial textures array (will be populated by updateTexture)
        const dynamicTextures = [PIXI.Texture.WHITE];
        
        super('road', location, 1, 1, dynamicTextures, map);
        this.blocksTile = false; // Pavement doesn't block movement
        this.isPassable = true; // Can be walked on
        this.visualRadius = 0.5;
        this.groundRadius = 0.5;
        this.pixiSprite.anchor.set(0.5, 0.5); // Center the sprite on the node
        this.pixiSprite.visible = false;
        if (this.pixiSprite.parent) {
            this.pixiSprite.parent.removeChild(this.pixiSprite);
        }
        this.visualHitbox = null;
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, this.groundRadius);
        this.width = 1.1547;
        this.height = 1;
        
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

        const { keptCorners, radius, bounds } = Road.getGeometryForNeighbors(neighbors);

        // Skip texture generation - roads render via masked layer, not individual sprites
        // This was causing lag on road placement; hitbox is what matters for interaction
        
        const hitboxCorners = keptCorners.map(pt => ({x: this.x + pt.x / radius / 2, y: this.y + pt.y / radius / 2}));
        this.visualHitbox = new PolygonHitbox(hitboxCorners);
        this.groundPlaneHitbox = new PolygonHitbox(hitboxCorners);
    }
}

