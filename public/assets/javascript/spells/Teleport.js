class Teleport extends globalThis.Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/magic/teleport.png";
        this.gravity = 0;
        this.speed = 0;
        this.range = Infinity;
        this.bounces = 0;
        this.apparentSize = 0;
        this.delayTime = 0;
        this.magicCost = 25;
        this.radius = 0;
    }

    cast(targetX, targetY, options = {}) {
        const logTeleportDebug = (event, details = {}) => {
            if (typeof console === "undefined" || typeof console.log !== "function") return;
            const node = details.destinationNode || (options && options.destinationNode) || null;
            const debugTarget = options && options.teleportDebugTarget ? options.teleportDebugTarget : null;
            const floorFragment = debugTarget && debugTarget.floorTarget && debugTarget.floorTarget.fragment
                ? debugTarget.floorTarget.fragment
                : null;
            console.log("[TeleportDebug] cast-" + event, {
                targetX,
                targetY,
                destinationX: details.destinationX,
                destinationY: details.destinationY,
                destinationLayer: Number.isFinite(options && options.destinationLayer) ? Number(options.destinationLayer) : null,
                destinationBaseZ: Number.isFinite(options && options.destinationBaseZ) ? Number(options.destinationBaseZ) : null,
                destinationFragmentId: typeof (options && options.destinationFragmentId) === "string" ? options.destinationFragmentId : "",
                destinationSurfaceId: typeof (options && options.destinationSurfaceId) === "string" ? options.destinationSurfaceId : "",
                wizardLayer: Number.isFinite(wizard && wizard.currentLayer) ? Number(wizard.currentLayer) : null,
                wizardTraversalLayer: Number.isFinite(wizard && wizard.traversalLayer) ? Number(wizard.traversalLayer) : null,
                wizardBaseZ: Number.isFinite(wizard && wizard.currentLayerBaseZ) ? Number(wizard.currentLayerBaseZ) : null,
                hasNode: !!node,
                node: node ? {
                    xindex: node.xindex,
                    yindex: node.yindex,
                    traversalLayer: node.traversalLayer,
                    baseZ: node.baseZ,
                    fragmentId: node.fragmentId,
                    surfaceId: node.surfaceId
                } : null,
                floorTarget: floorFragment ? {
                    fragmentId: floorFragment.fragmentId,
                    surfaceId: floorFragment.surfaceId,
                    ownerSectionKey: floorFragment.ownerSectionKey,
                    level: floorFragment.level,
                    nodeBaseZ: floorFragment.nodeBaseZ,
                    renderedByBuildingCutaway: floorFragment.renderedByBuildingCutaway === true
                } : null,
                reason: details.reason || ""
            });
        };
        if (!wizard || !wizard.map) return this;
        if (!globalThis.Spell.canAffordMagicCost(this.magicCost, wizard)) {
            logTeleportDebug("reject", { reason: "insufficient-magic" });
            globalThis.Spell.indicateInsufficientMagic();
            message("Not enough magic to cast Teleport!");
            return this;
        }

        let destinationX = targetX;
        let destinationY = targetY;
        if (typeof wizard.map.wrapWorldX === "function") destinationX = wizard.map.wrapWorldX(destinationX);
        if (typeof wizard.map.wrapWorldY === "function") destinationY = wizard.map.wrapWorldY(destinationY);
        if (!Number.isFinite(destinationX) || !Number.isFinite(destinationY)) {
            logTeleportDebug("reject", { destinationX, destinationY, reason: "non-finite-destination" });
            message("Cannot teleport there!");
            return this;
        }
        const destinationNode = options && options.destinationNode ? options.destinationNode : null;
        const destinationLayer = Number.isFinite(options && options.destinationLayer)
            ? Math.round(Number(options.destinationLayer))
            : (Number.isFinite(destinationNode && destinationNode.traversalLayer)
                ? Math.round(Number(destinationNode.traversalLayer))
                : (Number.isFinite(destinationNode && destinationNode.level) ? Math.round(Number(destinationNode.level)) : 0));
        const destinationBaseZ = Number.isFinite(options && options.destinationBaseZ)
            ? Number(options.destinationBaseZ)
            : (Number.isFinite(destinationNode && destinationNode.baseZ)
                ? Number(destinationNode.baseZ)
                : destinationLayer * 3);
        const destinationFragmentId = typeof (options && options.destinationFragmentId) === "string"
            ? options.destinationFragmentId
            : (typeof (destinationNode && destinationNode.fragmentId) === "string" ? destinationNode.fragmentId : "");
        const destinationSurfaceId = typeof (options && options.destinationSurfaceId) === "string"
            ? options.destinationSurfaceId
            : (typeof (destinationNode && destinationNode.surfaceId) === "string" ? destinationNode.surfaceId : "");
        const hasFloorFragmentDestination = !!(
            destinationFragmentId &&
            Number.isFinite(destinationLayer) &&
            Number.isFinite(destinationBaseZ)
        );
        if (!destinationNode && !hasFloorFragmentDestination) {
            logTeleportDebug("reject", { destinationX, destinationY, destinationNode, reason: "missing-destination-support" });
            message("Cannot teleport there!");
            return this;
        }

        const renderingApi = (typeof globalThis !== "undefined") ? globalThis.Rendering : null;
        if (
            renderingApi &&
            typeof renderingApi.isWorldPointTargetable === "function" &&
            !renderingApi.isWorldPointTargetable(destinationX, destinationY, wizard, wizard.map || null)
        ) {
            logTeleportDebug("reject", { destinationX, destinationY, destinationNode, reason: "los-shadow" });
            message("You cannot teleport into darkness!");
            return this;
        }

        logTeleportDebug("accept", { destinationX, destinationY, destinationNode, reason: "ok" });
        globalThis.Spell.spendMagicCost(this.magicCost, wizard);
        wizard.x = destinationX;
        wizard.y = destinationY;
        wizard.node = destinationNode || null;
        if (destinationNode && typeof wizard.syncTraversalLayerFromNode === "function") {
            wizard.syncTraversalLayerFromNode(destinationNode);
        } else {
            wizard.currentLayer = destinationLayer;
            wizard.traversalLayer = destinationLayer;
            wizard.currentLayerBaseZ = destinationBaseZ;
            if (destinationSurfaceId) wizard.surfaceId = destinationSurfaceId;
            if (destinationFragmentId) wizard.fragmentId = destinationFragmentId;
        }
        wizard.z = 0;
        wizard._floorFallState = null;
        wizard.path = [];
        wizard.nextNode = null;
        wizard.destination = null;
        wizard.moving = false;
        wizard.movementVector = { x: 0, y: 0 };
        wizard.prevX = destinationX;
        wizard.prevY = destinationY;
        wizard.updateHitboxes();
        if (typeof centerViewport === "function") {
            centerViewport(wizard, 0);
        }

        this.visible = false;
        this.detachPixiSprite();
        return this;
    }
}



globalThis.Teleport = Teleport;
