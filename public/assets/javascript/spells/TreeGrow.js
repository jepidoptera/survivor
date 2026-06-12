function resolveTreeGrowPlacementSize(wizardRef, fallbackSize) {
    if (
        wizardRef &&
        typeof SpellSystem !== "undefined" &&
        typeof SpellSystem.resolveTreePlacementSize === "function"
    ) {
        return SpellSystem.resolveTreePlacementSize(wizardRef);
    }
    if (wizardRef && Number.isFinite(wizardRef.treeGrowPlacementSize)) {
        return Math.max(0.5, Math.min(20, wizardRef.treeGrowPlacementSize));
    }
    return fallbackSize;
}

function doesTreePlacementObjectBlock(obj) {
    if (!obj || obj.gone || obj.vanishing) return false;
    if (typeof globalThis !== "undefined" && typeof globalThis.doesObjectBlockPassage === "function") {
        return !!globalThis.doesObjectBlockPassage(obj);
    }
    const sinkState = (obj && typeof obj === "object" && obj._scriptSinkState && typeof obj._scriptSinkState === "object")
        ? obj._scriptSinkState
        : null;
    return !!(
        (obj.blocksTile === true || obj.isPassable === false) &&
        (!sinkState || sinkState.nonBlocking === false)
    );
}

function describeTreePlacementObject(obj) {
    if (!obj) return "(unknown)";
    const type = typeof obj.type === "string" && obj.type.length > 0 ? obj.type : "object";
    const id = obj.id !== undefined && obj.id !== null ? String(obj.id) : "";
    return id ? `${type} ${id}` : type;
}

function getTreePlacementObjectHitbox(obj) {
    return obj && (obj.groundPlaneHitbox || obj.hitbox || null);
}

function treePlacementHitboxesIntersect(hitboxA, hitboxB) {
    if (!hitboxA || !hitboxB) return false;
    if (typeof hitboxA.intersects === "function" && hitboxA.intersects(hitboxB)) return true;
    if (typeof hitboxB.intersects === "function" && hitboxB.intersects(hitboxA)) return true;
    return false;
}

function collectTreePlacementCandidateObjects(mapRef, targetNode, placementHitbox) {
    const out = [];
    const seen = new Set();
    const collectNode = (node) => {
        if (!node || !Array.isArray(node.objects)) return;
        for (let i = 0; i < node.objects.length; i++) {
            const obj = node.objects[i];
            if (!obj || seen.has(obj)) continue;
            seen.add(obj);
            out.push(obj);
        }
    };

    if (
        mapRef &&
        placementHitbox &&
        typeof placementHitbox.getBounds === "function" &&
        typeof mapRef.worldToNode === "function"
    ) {
        const bounds = placementHitbox.getBounds();
        if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)) {
            const minNode = mapRef.worldToNode(bounds.x - 1, bounds.y - 1);
            const maxNode = mapRef.worldToNode(bounds.x + bounds.width + 1, bounds.y + bounds.height + 1);
            if (
                minNode &&
                maxNode &&
                typeof mapRef.getNodesInIndexWindow === "function" &&
                Number.isFinite(minNode.xindex) &&
                Number.isFinite(minNode.yindex) &&
                Number.isFinite(maxNode.xindex) &&
                Number.isFinite(maxNode.yindex)
            ) {
                const nodes = mapRef.getNodesInIndexWindow(minNode.xindex, maxNode.xindex, minNode.yindex, maxNode.yindex);
                if (Array.isArray(nodes)) {
                    for (let i = 0; i < nodes.length; i++) collectNode(nodes[i]);
                    return out;
                }
            }
        }
    }

    collectNode(targetNode);
    if (targetNode && Array.isArray(targetNode.neighbors)) {
        for (let i = 0; i < targetNode.neighbors.length; i++) collectNode(targetNode.neighbors[i]);
    }
    return out;
}

function findTreePlacementBlockingOverlap(mapRef, targetNode, placementHitbox) {
    const candidates = collectTreePlacementCandidateObjects(mapRef, targetNode, placementHitbox);
    for (let i = 0; i < candidates.length; i++) {
        const obj = candidates[i];
        if (!doesTreePlacementObjectBlock(obj)) continue;
        const objHitbox = getTreePlacementObjectHitbox(obj);
        if (!objHitbox || typeof objHitbox.intersects !== "function") {
            throw new Error(`tree placement blocking object is missing a ground hitbox: ${describeTreePlacementObject(obj)}`);
        }
        if (treePlacementHitboxesIntersect(placementHitbox, objHitbox)) {
            return obj;
        }
    }
    return null;
}

class TreeGrow extends globalThis.Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/thumbnails/tree.png";
        this.gravity = 0;
        this.speed = 0;
        this.range = 20;
        this.bounces = 0;
        this.apparentSize = 0;
        this.delayTime = 0;
        this.magicCost = 0;
        this.initialSize = 4;
        this.maxSize = 20;
        this.growthPerSecond = 2.5;
        this.magicPerSecond = 20;
        this.radius = 0;
    }
    
    cast(targetX, targetY) {
        // Snap to nearest hex tile
        const targetNode = wizard.map.worldToNode(targetX, targetY);
        if (!targetNode) {
            message("Cannot grow tree there!");
            return this;
        }
        
        const placementSize = resolveTreeGrowPlacementSize(wizard, this.initialSize);
        if (typeof CircleHitbox !== "function") {
            throw new Error("tree placement requires CircleHitbox to be loaded");
        }
        const placementHitbox = new CircleHitbox(targetNode.x, targetNode.y, Math.max(0.01, placementSize * 0.125));
        if (findTreePlacementBlockingOverlap(wizard.map, targetNode, placementHitbox)) {
            message("Something is already growing there!");
            return this;
        }
        
        // Reuse map-managed tree textures when available to preserve variants.
        const treeTextures = (wizard.map.scenery && wizard.map.scenery.tree && wizard.map.scenery.tree.textures)
            ? wizard.map.scenery.tree.textures
            : Array.from({length: 5}, (_, n) => PIXI.Texture.from(`/assets/images/trees/tree${n}.png`));
        
        const newTree = new Tree({x: targetNode.x, y: targetNode.y}, treeTextures, wizard.map);
        const selectedTreeVariant = (
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.resolveTreePlacementTextureVariant === "function"
        )
            ? SpellSystem.resolveTreePlacementTextureVariant(wizard)
            : (
                wizard &&
                Number.isInteger(wizard.selectedTreeTextureVariant) &&
                wizard.selectedTreeTextureVariant >= 0 &&
                wizard.selectedTreeTextureVariant < treeTextures.length
            )
                ? wizard.selectedTreeTextureVariant
                : null;
        if (selectedTreeVariant !== null && newTree.pixiSprite) {
            const selectedTexture = PIXI.Texture.from(`/assets/images/trees/tree${selectedTreeVariant}.png`);
            if (selectedTexture) {
                if (typeof newTree.setTreeTextureIndex === "function") {
                    newTree.setTreeTextureIndex(selectedTreeVariant, treeTextures);
                } else {
                    newTree.pixiSprite.texture = selectedTexture;
                    newTree.textureIndex = selectedTreeVariant;
                }
            }
        }

        newTree.applySize(placementSize);

        if (
            typeof globalThis !== "undefined" &&
            globalThis.Scripting &&
            typeof globalThis.Scripting.runObjectInitScript === "function"
        ) {
            globalThis.Scripting.runObjectInitScript(
                newTree,
                (typeof wizard !== "undefined") ? wizard : null,
                { reason: "objectCreated" }
            );
        }
        
        // Deactivate this spell projectile immediately (tree is now placed)
        this.visible = false;
        this.detachPixiSprite();
        if (
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.clearTreePlacementPreviewVariant === "function"
        ) {
            SpellSystem.clearTreePlacementPreviewVariant(wizard);
            if (typeof SpellSystem.clearTreePlacementPreviewSize === "function") {
                SpellSystem.clearTreePlacementPreviewSize(wizard);
            }
            if (
                keysPressed &&
                keysPressed[" "] &&
                typeof SpellSystem.resolveTreePlacementTextureVariant === "function"
            ) {
                SpellSystem.resolveTreePlacementTextureVariant(wizard, { forceNew: true });
                if (typeof SpellSystem.resolveTreePlacementSize === "function") {
                    SpellSystem.resolveTreePlacementSize(wizard, { forceNew: true });
                }
            }
        }
        
        return this;
    }
}


globalThis.TreeGrow = TreeGrow;
