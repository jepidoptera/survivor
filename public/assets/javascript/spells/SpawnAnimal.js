class SpawnAnimal extends globalThis.Spell {
    static NATURAL_SIZE_RANGES = {
        squirrel: { min: 0.4, max: 0.6 },
        goat: { min: 0.7, max: 0.95 },
        deer: { min: 0.75, max: 1.25 },
        bear: { min: 1.2, max: 1.7 },
        eagleman: { min: 1.2, max: 1.7 },
        fragglegod: { min: 1.2, max: 1.7 },
        yeti: { min: 1.5, max: 2.0 },
        blodia: { min: 1.5, max: 2.0 }
    };

    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.image.src = "./assets/images/animals/squirrel.png";
        this.gravity = 0;
        this.speed = 0;
        this.range = 20;
        this.bounces = 0;
        this.apparentSize = 0;
        this.delayTime = 0;
        this.magicCost = 0;
        this.radius = 0;
    }

    static ANIMAL_TYPES = [
        { name: "squirrel", icon: "/assets/images/animals/squirrel.png", ctor: () => Squirrel, frameCount: {x:1, y:2} },
        { name: "goat",     icon: "/assets/images/animals/goat.png",     ctor: () => Goat,     frameCount: {x:1, y:2} },
        { name: "deer",     icon: "/assets/images/animals/deer.png",     ctor: () => Deer,     frameCount: {x:1, y:2} },
        { name: "bear",     icon: "/assets/images/animals/bear.png",     ctor: () => Bear,     frameCount: {x:2, y:2} },
        { name: "eagleman", icon: "/assets/images/animals/eagleman/eagleman_down.png", ctor: () => Eagleman, frameCount: {x:1, y:1} },
        { name: "fragglegod", icon: "/assets/images/animals/fragglegod.png", ctor: () => Fragglegod, frameCount: {x:2, y:2} },
        { name: "yeti",     icon: "/assets/images/animals/yeti.png",     ctor: () => Yeti,     frameCount: {x:2, y:2} },
        { name: "blodia",   icon: "/assets/images/animals/blodia.png",   ctor: () => Blodia,   frameCount: {x:2, y:1} }
    ];

    // Log-scale slider helpers:
    // The slider range [0, 1] maps to [25%, 400%] on a log scale with 0.5 → 100%.
    // ln(0.25) at 0, ln(1) at 0.5, ln(4) at 1.
    static LOG_MIN = Math.log(0.25);  // -1.386
    static LOG_MAX = Math.log(4);     //  1.386

    static sliderToScale(t) {
        // t in [0, 1] → scale in [0.25, 4]
        return Math.exp(SpawnAnimal.LOG_MIN + t * (SpawnAnimal.LOG_MAX - SpawnAnimal.LOG_MIN));
    }

    static scaleToSlider(scale) {
        // scale in [0.25, 4] → t in [0, 1]
        const clamped = Math.max(0.25, Math.min(4, scale));
        return (Math.log(clamped) - SpawnAnimal.LOG_MIN) / (SpawnAnimal.LOG_MAX - SpawnAnimal.LOG_MIN);
    }

    static getNaturalSizeRange(typeName) {
        const key = (typeof typeName === "string" && typeName.length > 0)
            ? typeName.toLowerCase()
            : "squirrel";
        return SpawnAnimal.NATURAL_SIZE_RANGES[key] || { min: 1, max: 1 };
    }

    static sampleNaturalSize(typeName) {
        const range = SpawnAnimal.getNaturalSizeRange(typeName);
        const min = Number.isFinite(range.min) ? Number(range.min) : 1;
        const max = Number.isFinite(range.max) ? Number(range.max) : min;
        if (!(max > min)) return min;
        return min + Math.random() * (max - min);
    }

    static getRepresentativeNaturalSize(typeName) {
        const range = SpawnAnimal.getNaturalSizeRange(typeName);
        const min = Number.isFinite(range.min) ? Number(range.min) : 1;
        const max = Number.isFinite(range.max) ? Number(range.max) : min;
        return (min + max) * 0.5;
    }

    static ensurePendingPlacementState(wizardRef) {
        const selectedType = (wizardRef && typeof wizardRef.selectedAnimalType === "string")
            ? wizardRef.selectedAnimalType
            : "squirrel";
        const existing = (wizardRef && wizardRef._pendingAnimalPlacementState && typeof wizardRef._pendingAnimalPlacementState === "object")
            ? wizardRef._pendingAnimalPlacementState
            : null;
        if (
            existing &&
            existing.type === selectedType &&
            Number.isFinite(existing.naturalSize) &&
            existing.naturalSize > 0
        ) {
            return existing;
        }
        const nextState = {
            type: selectedType,
            naturalSize: SpawnAnimal.sampleNaturalSize(selectedType)
        };
        if (wizardRef) {
            wizardRef._pendingAnimalPlacementState = nextState;
        }
        return nextState;
    }

    static getPendingPlacementNaturalSize(wizardRef) {
        const state = SpawnAnimal.ensurePendingPlacementState(wizardRef);
        return Number.isFinite(state && state.naturalSize) && state.naturalSize > 0
            ? Number(state.naturalSize)
            : 1;
    }

    static clearPendingPlacementState(wizardRef) {
        if (wizardRef && Object.prototype.hasOwnProperty.call(wizardRef, "_pendingAnimalPlacementState")) {
            wizardRef._pendingAnimalPlacementState = null;
        }
    }

    cast(targetX, targetY, options = {}) {
        const mapRef = wizard.map;
        if (!mapRef || typeof mapRef.worldToNode !== "function") {
            message("Cannot spawn animal here!");
            return this;
        }

        const layerPoint = (typeof globalThis.resolveEditorWorldPointOnLayer === "function")
            ? globalThis.resolveEditorWorldPointOnLayer(wizard, targetX, targetY, options)
            : {
                x: targetX,
                y: targetY,
                layer: Number.isFinite(wizard && wizard.selectedFloorEditLevel)
                    ? Math.round(Number(wizard.selectedFloorEditLevel))
                    : 0,
                baseZ: Number.isFinite(wizard && wizard.currentLayerBaseZ)
                    ? Number(wizard.currentLayerBaseZ)
                    : 0
            };
        const placementX = Number.isFinite(layerPoint && layerPoint.x) ? Number(layerPoint.x) : targetX;
        const placementY = Number.isFinite(layerPoint && layerPoint.y) ? Number(layerPoint.y) : targetY;
        const targetLayer = Number.isFinite(layerPoint && layerPoint.layer) ? Math.round(Number(layerPoint.layer)) : 0;
        const wrappedX = typeof mapRef.wrapWorldX === "function" ? mapRef.wrapWorldX(placementX) : placementX;
        const wrappedY = typeof mapRef.wrapWorldY === "function" ? mapRef.wrapWorldY(placementY) : placementY;
        const targetNode = (typeof globalThis.resolveEditorNodeOnLayer === "function")
            ? globalThis.resolveEditorNodeOnLayer(mapRef, wrappedX, wrappedY, targetLayer)
            : mapRef.worldToNode(wrappedX, wrappedY);

        if (!targetNode) {
            message("Cannot spawn animal there!");
            return this;
        }

        // Read selected animal type and size scale from wizard
        const selectedType = (wizard && typeof wizard.selectedAnimalType === "string")
            ? wizard.selectedAnimalType
            : "squirrel";
        const sizeScale = (wizard && Number.isFinite(wizard.selectedAnimalSizeScale))
            ? wizard.selectedAnimalSizeScale
            : 1;

        const typeDef = SpawnAnimal.ANIMAL_TYPES.find(t => t.name === selectedType);
        if (!typeDef) {
            message("Unknown animal type!");
            return this;
        }

        const AnimalClass = typeDef.ctor();
        const animal = new AnimalClass(targetNode, mapRef);
        if (typeof animal.syncTraversalLayerFromNode === "function") {
            animal.syncTraversalLayerFromNode(targetNode);
        } else {
            animal.traversalLayer = targetLayer;
            animal.currentLayer = targetLayer;
            animal.currentLayerBaseZ = Number.isFinite(targetNode.baseZ)
                ? Number(targetNode.baseZ)
                : (Number.isFinite(layerPoint && layerPoint.baseZ) ? Number(layerPoint.baseZ) : targetLayer * 3);
        }
        const naturalSize = SpawnAnimal.getPendingPlacementNaturalSize(wizard);
        SpawnAnimal.clearPendingPlacementState(wizard);

        // Apply size scale relative to the same pending natural size used by the preview.
        const baseSize = animal.size;
        const newSize = naturalSize * sizeScale;
        animal.size = newSize;
        animal.width = (animal.width / baseSize) * newSize;
        animal.height = (animal.height / baseSize) * newSize;
        if (Number.isFinite(animal.radius)) {
            animal.radius = (animal.radius / baseSize) * newSize;
        }
        if (Number.isFinite(animal.lungeRadius)) {
            animal.lungeRadius = (animal.lungeRadius / baseSize) * newSize;
        }
        if (Number.isFinite(animal.strikeRange)) {
            animal.strikeRange = (animal.strikeRange / baseSize) * newSize;
        }
        if (Number.isFinite(animal.damage)) {
            animal.damage = (animal.damage / baseSize) * newSize;
        }
        if (Number.isFinite(animal.groundRadius)) {
            animal.groundRadius = (animal.groundRadius / baseSize) * newSize;
        }
        if (Number.isFinite(animal.visualRadius)) {
            animal.visualRadius = (animal.visualRadius / baseSize) * newSize;
        }
        if (typeof animal.updateHitboxes === "function") {
            animal.updateHitboxes();
        }

        // Place at the exact click location
        animal.x = wrappedX;
        animal.y = wrappedY;
        animal.z = typeof animal.getNodeStandingZ === "function"
            ? animal.getNodeStandingZ(targetNode)
            : (Number.isFinite(targetNode.baseZ) ? Number(targetNode.baseZ) : 0);
        animal.node = targetNode;
        if (typeof animal.updateHitboxes === "function") {
            animal.updateHitboxes();
        }

        // Add to the global animals array
        if (Array.isArray(animals)) {
            animals.push(animal);
        }

        this.visible = false;
        this.detachPixiSprite();
        return this;
    }
}


globalThis.SpawnAnimal = SpawnAnimal;
