class StaticObject {
    constructor(type, location, width, height, textures, map) {
        this.type = type;
        this.map = map;
        this.width = width;
        this.height = height;
        this.blocksTile = true;

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

    removeFromNodes() {
        const node = this.getNode();
        if (node) {
            node.removeObject(this);
        }
    }
    
    ignite() {
        this.isOnFire = true;
        this.burned = true;
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
    }
    
    update() {
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
    constructor(endpointA, endpointB, height, thickness, map, diagonalWallInfo = null) {
        this.type = 'newwall';
        this.map = map;
        
        // Store world coordinates for endpoints
        // Endpoints can be either MapNodes or plain {x, y} objects
        this.a = {x: endpointA.x, y: endpointA.y};
        this.b = {x: endpointB.x, y: endpointB.y};
        
        // Position is at the center between endpoints
        this.x = (this.a.x + this.b.x) / 2;
        this.y = (this.a.y + this.b.y) / 2;
        
        this.height = height;
        this.thickness = thickness;
        this.blocksTile = true;
        this.pixiSprite = new PIXI.Graphics();
        this.skipTransform = true;
        
        // Arrays to track what this wall affects
        this.nodes = [];           // All nodes this wall sits on
        this.blockedLinks = [];    // All node connections this wall blocks
        
        // Store diagonal wall info if this is part of a split diagonal
        this.diagonalWallInfo = diagonalWallInfo;
        
        this.findNodesAlongWall(endpointA, endpointB);
        this.addToNodes();
        if (diagonalWallInfo) {
            this.blockDiagonal();
        } else {
            this.blockPerpendicular();
        }
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
    
    blockPerpendicular() {
        // Find shared neighbors in odd directions and block between them
        if (this.nodes.length < 2) return;
        
        const nodeA = this.nodes[0];
        const nodeB = this.nodes[1];
        
        // Get the odd-direction neighbors of both endpoints
        const aOddNeighbors = this.getOddNeighbors(nodeA);
        const bOddNeighbors = this.getOddNeighbors(nodeB);
        
        // Find which odd directions are shared
        for (let dir of [1, 3, 9, 11]) {
            if (aOddNeighbors.has(dir) && bOddNeighbors.has(dir)) {
                this.addBlockedLink(nodeA, dir);
            }
        }
    }
    
    getOddNeighbors(node) {
        const oddDirs = new Set();
        if (node.xindex % 2 === 0) {
            oddDirs.add(1);  // NE
            oddDirs.add(3);  // E
            oddDirs.add(9);  // W
            oddDirs.add(11); // NW
        } else {
            oddDirs.add(1);  // NW
            oddDirs.add(3);  // NE
            oddDirs.add(9);  // SW
            oddDirs.add(11); // SE
        }
        return oddDirs;
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
    
    blockDiagonal() {
        // For diagonal walls, block three specific node connections based on direction
        // diagonalWallInfo contains: {baseNode, intermediate, segment, direction}
        const {baseNode, intermediate, segment, direction} = this.diagonalWallInfo;
        
        if (!baseNode || !intermediate || direction === undefined) return;
        
        // The blocking pattern depends on the direction of the diagonal
        // Direction can be 0, 2, 4, 6, 8, or 10 (even neighbors)
        
        if (segment === 1) {
            // Wall 1 blocks three pairs based on direction
            // If direction is 0: blocks 9↔5, 7↔3, 5↔7
            // If direction is 2: blocks all numbers +2 mod 12
            const d1 = (9 + direction) % 12;  // neighbor at position 9+dir
            const d2 = (5 + direction) % 12;  // neighbor at position 5+dir
            const d3 = (7 + direction) % 12;  // neighbor at position 7+dir
            const d4 = (3 + direction) % 12;  // neighbor at position 3+dir
            
            // Block the three cross-diagonal connections
            this.blockCrossConnection(baseNode, d1, d2);  // 9+dir ↔ 5+dir
            this.blockCrossConnection(baseNode, d3, d4);  // 7+dir ↔ 3+dir
            this.blockCrossConnection(baseNode, d2, d3);  // 5+dir ↔ 7+dir
        } else if (segment === 2) {
            // Wall 2 blocks three pairs for the ending node
            const d1 = (9 + direction) % 12;  // neighbor 9+dir
            const d2 = (1 + direction) % 12;  // neighbor 1+dir
            const d3 = (11 + direction) % 12; // neighbor 11+dir
            const d4 = (3 + direction) % 12;  // neighbor 3+dir
            
            // Block the three cross-diagonal connections
            this.blockCrossConnection(baseNode, d1, d2);  // 9+dir ↔ 1+dir
            this.blockCrossConnection(baseNode, d3, d4);  // 11+dir ↔ 3+dir
            this.blockCrossConnection(baseNode, d3, d2);  // 11+dir ↔ 1+dir
        }
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
        
        for (let i = 0; i < wallPath.length - 1; i++) {
            const nodeA = wallPath[i];
            const nodeB = wallPath[i + 1];
            
            // Check if this is a long diagonal (not adjacent)
            const directionAtoB = nodeA.neighbors.indexOf(nodeB);
            if (directionAtoB % 2 == 0) {
                
                const midpointX = (nodeA.x + nodeB.x) / 2;
                const midpointY = (nodeA.y + nodeB.y) / 2;
                const midpoint = {x: midpointX, y: midpointY};
                
                // Get intermediate nodes for blocking
                const intermediateA = nodeA.neighbors[directionAtoB];
                const intermediateB = nodeB.neighbors[(directionAtoB + 6) % 12];
                
                // Wall 1: from nodeA to midpoint
                const wall1 = new Wall(nodeA, midpoint, height, thickness, map, {
                    baseNode: nodeA,
                    intermediate: intermediateA,
                    direction: directionAtoB,
                    segment: 1
                });
                walls.push(wall1);
                
                // Wall 2: from midpoint to nodeB
                const wall2 = new Wall(midpoint, nodeB, height, thickness, map, {
                    baseNode: nodeB,
                    intermediate: intermediateB,
                    direction: (directionAtoB + 6) % 12,
                    segment: 2
                });
                walls.push(wall2);
            } else {
                // Regular adjacent wall
                const wall = new Wall(nodeA, nodeB, height, thickness, map);
                walls.push(wall);
            }
        }
        
        return walls;
    }

    static drawWall(graphics, endpointA, endpointB, height, thickness, color, alpha) {
        thickness = thickness * map.hexWidth; // Use wall's thickness property
        // Convert world coordinates to screen coordinates
        const screenAx = endpointA.x * map.hexWidth - viewport.x * map.hexWidth;
        const screenAy = endpointA.y * map.hexHeight - viewport.y * map.hexHeight;
        const screenBx = endpointB.x * map.hexWidth - viewport.x * map.hexWidth;
        const screenBy = endpointB.y * map.hexHeight - viewport.y * map.hexHeight;
        
        // Draw post at the lower endpoint
        graphics.lineStyle(thickness, color, alpha);
        if (screenAy > screenBy) {
            graphics.moveTo(screenAx, screenAy);
            graphics.lineTo(screenAx, screenAy - height * map.hexHeight);
        } else if (screenBy > screenAy) {
            graphics.moveTo(screenBx, screenBy);
            graphics.lineTo(screenBx, screenBy - height * map.hexHeight);
        }
        
        // Draw main wall body (no outline)
        graphics.lineStyle(0);
        graphics.beginFill(color, alpha);
        graphics.moveTo(screenAx, screenAy);
        graphics.lineTo(screenBx, screenBy);
        graphics.lineTo(screenBx, screenBy - height * map.hexHeight);
        graphics.lineTo(screenAx, screenAy - height * map.hexHeight);
        graphics.closePath();
        graphics.endFill();
        
        // Draw top edge highlight
        graphics.lineStyle(thickness, 0x999999, alpha);
        graphics.moveTo(screenBx, screenBy - height * map.hexHeight);
        graphics.lineTo(screenAx, screenAy - height * map.hexHeight);
    }
}

