class SpawnAnimal extends globalThis.Spell {
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

    cast(targetX, targetY) {
        const mapRef = wizard.map;
        if (!mapRef || typeof mapRef.worldToNode !== "function") {
            message("Cannot spawn animal here!");
            return this;
        }

        const wrappedX = typeof mapRef.wrapWorldX === "function" ? mapRef.wrapWorldX(targetX) : targetX;
        const wrappedY = typeof mapRef.wrapWorldY === "function" ? mapRef.wrapWorldY(targetY) : targetY;
        const targetNode = mapRef.worldToNode(wrappedX, wrappedY);

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

        // Apply size scale relative to the animal's natural randomly-chosen size
        const baseSize = animal.size;
        const newSize = baseSize * sizeScale;
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
