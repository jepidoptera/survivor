let spellKeyBindings = {
    "F": "fireball",
    "I": "freeze",
    "L": "lightning",
    "K": "spikes",
    "Q": "attacksquirrel",
    "M": "maze",
    "V": "vanish",
    "D": "shield",
    "T": "treegrow",
    "G": "triggerarea",
    "ET": "editscript",
    "J": "teleport",
    "FW": "firewall",
    "A": "spawnanimal"
};

let editorKeyBindings = {
    "B": "wall",
    "R": "buildroad",
    "M": "moveobject",
    "N": "nodeinspector"
};

const MAGIC_ITEMS_CATEGORY = "magic";

function resolveAnimatedSheetConfig(metaEntry, fallbackX = 1, fallbackY = 1, fallbackFps = 0) {
    const meta = (metaEntry && typeof metaEntry === "object") ? metaEntry : {};
    const frameCountObj = (meta.framecount && typeof meta.framecount === "object")
        ? meta.framecount
        : ((meta.frameCount && typeof meta.frameCount === "object") ? meta.frameCount : null);
    const frameCountX = Number.isFinite(meta.framecount_x)
        ? Number(meta.framecount_x)
        : (Number.isFinite(meta.frameCountX)
            ? Number(meta.frameCountX)
            : (Number.isFinite(frameCountObj && frameCountObj.x) ? Number(frameCountObj.x) : fallbackX));
    const frameCountY = Number.isFinite(meta.framecount_y)
        ? Number(meta.framecount_y)
        : (Number.isFinite(meta.frameCountY)
            ? Number(meta.frameCountY)
            : (Number.isFinite(frameCountObj && frameCountObj.y) ? Number(frameCountObj.y) : fallbackY));
    const animatedFps = Number.isFinite(meta.animated_fps)
        ? Number(meta.animated_fps)
        : (Number.isFinite(meta.animatedFps) ? Number(meta.animatedFps) : fallbackFps);
    return {
        frameCountX: Math.max(1, Math.floor(frameCountX) || Math.floor(fallbackX) || 1),
        frameCountY: Math.max(1, Math.floor(frameCountY) || Math.floor(fallbackY) || 1),
        animatedFps: Math.max(0, Number(animatedFps) || 0)
    };
}

async function getMagicAssetMetadata(texturePath) {
    if (
        !(typeof globalThis !== "undefined" && typeof globalThis.getResolvedPlaceableMetadata === "function") ||
        typeof texturePath !== "string" ||
        texturePath.length === 0
    ) {
            return null; 
    }
    try {
        return await globalThis.getResolvedPlaceableMetadata(MAGIC_ITEMS_CATEGORY, texturePath);
    } catch (_) {
        return null;
    }
}
globalThis.resolveAnimatedSheetConfig = resolveAnimatedSheetConfig;
globalThis.getMagicAssetMetadata = getMagicAssetMetadata;

function hitboxesIntersect(hitboxA, hitboxB) {
    if (!hitboxA || !hitboxB) return false;
    if (typeof hitboxA.intersects === "function" && hitboxA.intersects(hitboxB)) return true;
    if (typeof hitboxB.intersects === "function" && hitboxB.intersects(hitboxA)) return true;
    return false;
}

class FirewallEmitter {
    constructor(location, map, animatedFrameIndex=null) {
        this.type = "firewall";
        this.map = map;
        const rawX = location && Number.isFinite(location.x) ? location.x : 0;
        const rawY = location && Number.isFinite(location.y) ? location.y : 0;
        this.x = (this.map && typeof this.map.wrapWorldX === "function")
            ? this.map.wrapWorldX(rawX)
            : rawX;
        this.y = (this.map && typeof this.map.wrapWorldY === "function")
            ? this.map.wrapWorldY(rawY)
            : rawY;
        this.width = 1.0;
        this.height = 1.0; // flames 1 map unit high
        this.texturePath = "/assets/images/magic/fire.png";
        this.blocksTile = false;
        this.isPassable = true;
        this.gone = false;
        this.pixiSprite = new PIXI.Sprite(PIXI.Texture.from(this.texturePath));
        this.pixiSprite.anchor.set(0.5, 1);
        this.pixiSprite.renderable = false; // invisible body, only flame should render
        this.pixiSprite.alpha = 1;
        this.visualHitbox = new CircleHitbox(this.x, this.y, 0.25);
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, 0.1);
        this.isOnFire = true;
        this.fireSprite = null;
        this.fireFrameIndex = (animatedFrameIndex !== null) ? animatedFrameIndex : Math.floor(Math.random() * 25); // random phase
        this.fireWidthScale = 3.0; // stretch flames wider
        this.fireHeightScale = 1.0;
        this.animatedFrameCountX = 5;
        this.animatedFrameCountY = 5;
        this.animatedFps = 12;
        this._animatedFrames = null;
        this._animatedFrameIndex = Math.floor(Math.random() * 25);
        this._animatedFrameProgress = 0;
        this._animatedLastFrameCount = null;
        this._animatedFrameSignature = "";
        this._depthBillboardMesh = null;
        this._depthBillboardWorldPositions = null;
        this._depthBillboardLastSignature = "";
        this._depthBillboardMeshMode = "";

        const staticProto = (typeof globalThis.StaticObject === "function" && globalThis.StaticObject.prototype)
            ? globalThis.StaticObject.prototype
            : null;
        if (staticProto && typeof staticProto.ensureDepthBillboardMesh === "function") {
            this.ensureDepthBillboardMesh = staticProto.ensureDepthBillboardMesh;
        }
        if (staticProto && typeof staticProto.updateDepthBillboardMesh === "function") {
            this.updateDepthBillboardMesh = staticProto.updateDepthBillboardMesh;
        }
        if (staticProto && typeof staticProto.rebuildAnimatedSpriteFrames === "function") {
            this.rebuildAnimatedSpriteFrames = staticProto.rebuildAnimatedSpriteFrames;
        }
        if (staticProto && typeof staticProto.updateSpriteAnimation === "function") {
            this.updateSpriteAnimation = staticProto.updateSpriteAnimation;
        }

        if (typeof this.rebuildAnimatedSpriteFrames === "function") {
            this.rebuildAnimatedSpriteFrames(true);
        }
        this.hydrateMagicMetadata();

        const node = this.map && typeof this.map.worldToNode === "function"
            ? this.map.worldToNode(this.x, this.y)
            : null;
        if (node && typeof node.addObject === "function") {
            node.addObject(this);
            this.node = node;
        } else {
            this.node = null;
        }
        this._removedFromNodes = false;
        if (typeof globalThis !== "undefined") {
            const current = Number(globalThis.activeFirewallEmitterCount || 0);
            globalThis.activeFirewallEmitterCount = current + 1;
        }
    }

    removeFromNodes() {
        if (this._removedFromNodes) return;
        this._removedFromNodes = true;
        if (this.node && typeof this.node.removeObject === "function") {
            this.node.removeObject(this);
        }
        if (typeof globalThis !== "undefined") {
            const current = Number(globalThis.activeFirewallEmitterCount || 0);
            globalThis.activeFirewallEmitterCount = Math.max(0, current - 1);
        }
    }

    removeFromGame() {
        if (this.gone) return;
        this.gone = true;
        this.vanishing = false;
        if (this._vanishFinalizeTimeout) {
            clearTimeout(this._vanishFinalizeTimeout);
            this._vanishFinalizeTimeout = null;
        }
        this.removeFromNodes();
        if (Array.isArray(this.map && this.map.objects)) {
            const idx = this.map.objects.indexOf(this);
            if (idx >= 0) this.map.objects.splice(idx, 1);
        }
        if (this.pixiSprite && this.pixiSprite.parent) {
            this.pixiSprite.parent.removeChild(this.pixiSprite);
        }
        if (this.pixiSprite && typeof this.pixiSprite.destroy === "function") {
            this.pixiSprite.destroy({ children: true, texture: false, baseTexture: false });
        }
        this.pixiSprite = null;
        if (this.fireSprite && this.fireSprite.parent) {
            this.fireSprite.parent.removeChild(this.fireSprite);
        }
        if (this.fireSprite && typeof this.fireSprite.destroy === "function") {
            this.fireSprite.destroy({ children: true, texture: false, baseTexture: false });
        }
        this.fireSprite = null;
    }
    remove() {
        this.removeFromGame();
    }

    saveJson() {
        return {
            type: "firewall",
            x: this.x,
            y: this.y
        };
    }

    async hydrateMagicMetadata() {
        const meta = await getMagicAssetMetadata(this.texturePath);
        if (!meta || this.gone) return;
        const cfg = resolveAnimatedSheetConfig(meta, this.animatedFrameCountX, this.animatedFrameCountY, this.animatedFps);
        this.animatedFrameCountX = cfg.frameCountX;
        this.animatedFrameCountY = cfg.frameCountY;
        this.animatedFps = cfg.animatedFps;
        this._animatedFrames = null;
        this._animatedFrameProgress = 0;
        this._animatedLastFrameCount = null;
        this._animatedFrameSignature = "";
        if (typeof this.rebuildAnimatedSpriteFrames === "function") {
            this.rebuildAnimatedSpriteFrames(true);
        }
    }

    update() {
        if (typeof this.updateSpriteAnimation === "function") {
            this.updateSpriteAnimation();
        }
    }

    handleCharacterCollision(character) {
        if (!character || character.gone || character.dead) return;
        const characterHitbox = character.visualHitbox || character.groundPlaneHitbox || character.hitbox;
        const emitterHitbox = this.visualHitbox || this.groundPlaneHitbox || this.hitbox;
        if (!characterHitbox || !emitterHitbox) return;
        if (!hitboxesIntersect(characterHitbox, emitterHitbox)) return;

        const characterZ = Number.isFinite(character.z) ? character.z : 0;
        const flameHeight = Number.isFinite(this.height) ? this.height : 1;
        if (characterZ >= flameHeight) return;
        const exposureRatio = flameHeight > 0
            ? Math.max(0, Math.min(1, (flameHeight - characterZ) / flameHeight))
            : 1;

        if (typeof character.ignite === "function") {
            // Refresh while touching so persistent contact keeps the target burning.
            character.ignite(8.0 * exposureRatio, exposureRatio);
        } else {
            character.isOnFire = true;
        }
    }
}

const SpellSystem = (() => {
    const DEFAULT_FLOORING_TEXTURE = "/assets/images/flooring/dirt.jpg";
    const RANDOM_TREE_VARIANT = "random";
    const PLACEABLE_CATEGORIES = ["flowers", "windows", "doors", "furniture", "signs", "roof"];
    const EDITOR_PLACEABLE_CATEGORIES = ["flowers", "windows", "doors", "furniture", "roof"];
    const EDITOR_CATEGORIES = [...EDITOR_PLACEABLE_CATEGORIES, "powerups"];
    const EDITOR_MENU_ICON = "/assets/images/thumbnails/edit.png";
    const ROOF_EDITOR_ICON = "/assets/images/thumbnails/roof.png";
    const DEFAULT_ROOF_TEXTURE = "/assets/images/roofs/smallshingles.png";
    const DEFAULT_PLACEABLE_CATEGORY = "doors";
    const DEFAULT_PLACEABLE_BY_CATEGORY = {
        doors: "/assets/images/doors/door5.png",
        flowers: "/assets/images/flowers/red%20flower.png",
        windows: "/assets/images/windows/window.png",
        furniture: "/assets/images/furniture/chair.png",
        signs: "/assets/images/signs/princess.png",
        roof: DEFAULT_ROOF_TEXTURE
    };
    const AURA_MENU_ICON = "/assets/images/thumbnails/aura.png";
    const SPELL_DEFS = [
        { name: "fireball", icon: "/assets/images/thumbnails/fireball.png" },
        { name: "freeze", icon: "/assets/images/magic/iceball.png" },
        { name: "lightning", icon: "/assets/images/magic/lightning.png" },
        { name: "spikes", icon: "/assets/images/magic/spike.png" },
        { name: "attacksquirrel", icon: "/assets/images/animals/squirrel.png" },
        { name: "maze", icon: "/assets/images/thumbnails/maze.png" },
        { name: "vanish", icon: "/assets/images/thumbnails/vanish.png" },
        { name: "teleport", icon: "/assets/images/magic/teleport.png" },
        { name: "shield", icon: "/assets/images/thumbnails/aura.png" },
        { name: "treegrow", icon: "/assets/images/thumbnails/tree.png" },
        { name: "triggerarea", icon: "/assets/images/thumbnails/wall.png" },
        { name: "editscript", icon: "/assets/images/thumbnails/edit.png" },
        { name: "firewall", icon: "/assets/images/thumbnails/firewall.png" },
        { name: "spawnanimal", icon: "/assets/images/animals/squirrel.png" }
    ];
    const EDITOR_TOOL_DEFS = [
        { name: "wall", icon: "/assets/images/thumbnails/wall.png" },
        { name: "buildroad", icon: "/assets/images/thumbnails/road.png" },
        { name: "flooredit", icon: "/assets/images/thumbnails/layers.png" },
        { name: "moveobject", icon: "/assets/images/thumbnails/move.png" },
        { name: "editorvanish", icon: "/assets/images/thumbnails/vanish.png" },
        { name: "nodeinspector", icon: "/assets/images/thumbnails/maze.png", debugOnly: true }
    ];
    const FLOOR_EDIT_TOOL_DEFS = [
        { name: "floorshape", icon: "/assets/images/thumbnails/polygon.png", title: "Floor Shape" },
        { name: "floorhole", icon: "/assets/images/thumbnails/scissors.png", title: "Floor Hole" },
        { name: "floorstair", icon: "/assets/images/thumbnails/stairs.png", title: "Floor Stairs" }
    ];
    const FLOOR_EDIT_LEVEL_MIN = -7;
    const FLOOR_EDIT_LEVEL_MAX = 7;
    const FLOOR_EDIT_LEVEL_DEFAULT = 0;
    const AURA_DEFS = [
        { name: "omnivision", icon: "/assets/images/thumbnails/eye.png", key: "O", magicPerSecond: 10 },
        { name: "speed", icon: "/assets/images/thumbnails/speed.png", key: "P", magicPerSecond: 10 },
        { name: "healing", icon: "/assets/images/thumbnails/cross.png", key: "H", magicPerSecond: 10 },
        { name: "invisibility", icon: "/assets/images/magic/invisible.png", key: "U", magicPerSecond: 12 }
    ];

    const MAGIC_TICK_MS = 50;
    const HEALING_AURA_EFFECT_MULTIPLIER = 2;
    let healingAuraHpMultiplier = 10 * HEALING_AURA_EFFECT_MULTIPLIER;
    const SHIELD_SPELL_MAGIC_COST = 25;
    const SHIELD_SPELL_HP = 100;
    const WALL_HEIGHT_MIN = 0.5;
    const WALL_HEIGHT_MAX = 7.0;
    const WALL_HEIGHT_STEP = 0.5;
    const DEFAULT_WALL_TEXTURE = "/assets/images/walls/stonewall.png";
    const WALL_THICKNESS_MIN = 0.125;
    const WALL_THICKNESS_MAX = 1.0;
    const WALL_THICKNESS_STEP = 0.125;
    const ROAD_WIDTH_MIN = 1;
    const ROAD_WIDTH_MAX = 5;
    const ROAD_WIDTH_STEP = 1;
    const ROAD_WIDTH_DEFAULT = (typeof roadWidth !== "undefined" && Number.isFinite(roadWidth))
        ? Number(roadWidth)
        : 3;
    const ROOF_OVERHANG_MIN = 0;
    const ROOF_OVERHANG_MAX = 1;
    const ROOF_OVERHANG_STEP = 0.0625;
    const ROOF_OVERHANG_DEFAULT = 0.25;
    const ROOF_PEAK_HEIGHT_MIN = 0;
    const ROOF_PEAK_HEIGHT_MAX = 10;
    const ROOF_PEAK_HEIGHT_STEP = 0.25;
    const ROOF_PEAK_HEIGHT_DEFAULT = 2;
    const ROOF_TEXTURE_REPEAT_MIN = 0.0625;
    const ROOF_TEXTURE_REPEAT_MAX = 1;
    const ROOF_TEXTURE_REPEAT_STEP = 0.03125;
    const ROOF_TEXTURE_REPEAT_DEFAULT = 0.125;
    const VANISH_WALL_TARGET_SEGMENT_LENGTH_WORLD = 1;
    const VANISH_BURST_SHOT_INTERVAL_MS = 45;
    const VANISH_MAGIC_COST_PER_CAST = 10;
    const PLACEABLE_ROTATION_STEP_DEGREES = 5;
    const POWERUP_PLACEMENT_FILE_NAME = "button.png";
    const POWERUP_PLACEMENT_IMAGE_PATH = "/assets/images/powerups/button.png";
    const POWERUP_PLACEMENT_DEFAULT_WIDTH = 0.8;
    const POWERUP_PLACEMENT_DEFAULT_HEIGHT = 0.8;
    const POWERUP_PLACEMENT_DEFAULT_RADIUS = 0.35;
    const POWERUP_PLACEMENT_SCALE_MIN = 0.2;
    const POWERUP_PLACEMENT_SCALE_MAX = 5;
    const POWERUP_PLACEMENT_SCALE_DEFAULT = 1;
    const TRIGGER_AREA_CLOSE_DISTANCE_PX = 10;
    const TRIGGER_AREA_VERTEX_SELECT_DISTANCE_PX = 10;
    const TRIGGER_AREA_HELP_PANEL_ID = "triggerAreaHelpPanel";
    const FLOOR_EDIT_DIAGNOSTICS_MAX_EVENTS = 500;

    const floorEditDiagnosticsLastByKey = new Map();

    function isFloorEditDiagnosticsEnabled() {
        if (typeof globalThis === "undefined") return false;
        if (globalThis.floorEditDiagnosticsEnabled === true) return true;
        try {
            if (globalThis.localStorage && globalThis.localStorage.getItem("floorEditDiagnostics") === "1") {
                return true;
            }
        } catch (_err) {}
        return false;
    }

    function setFloorEditDiagnosticsEnabled(enabled) {
        if (typeof globalThis === "undefined") return false;
        const next = !!enabled;
        globalThis.floorEditDiagnosticsEnabled = next;
        try {
            if (globalThis.localStorage) {
                if (next) {
                    globalThis.localStorage.setItem("floorEditDiagnostics", "1");
                } else {
                    globalThis.localStorage.removeItem("floorEditDiagnostics");
                }
            }
        } catch (_err) {}
        return next;
    }

    function getFloorEditDiagnosticsLog() {
        if (typeof globalThis === "undefined") return [];
        if (!Array.isArray(globalThis.__floorEditDiagnosticsLog)) {
            globalThis.__floorEditDiagnosticsLog = [];
        }
        return globalThis.__floorEditDiagnosticsLog;
    }

    function clearFloorEditDiagnosticsLog() {
        if (typeof globalThis === "undefined") return;
        globalThis.__floorEditDiagnosticsLog = [];
        floorEditDiagnosticsLastByKey.clear();
    }

    function recordFloorEditDiagnostic(eventName, payload = null, options = null) {
        if (!isFloorEditDiagnosticsEnabled()) return;
        const opts = options && typeof options === "object" ? options : {};
        const throttleKey = (typeof opts.throttleKey === "string" && opts.throttleKey.length > 0)
            ? opts.throttleKey
            : "";
        const throttleMs = Number.isFinite(opts.throttleMs) ? Math.max(0, Number(opts.throttleMs)) : 0;
        const now = Date.now();
        if (throttleKey && throttleMs > 0) {
            const last = Number(floorEditDiagnosticsLastByKey.get(throttleKey) || 0);
            if (now - last < throttleMs) return;
            floorEditDiagnosticsLastByKey.set(throttleKey, now);
        }
        const entry = {
            timeMs: now,
            event: String(eventName || "unknown"),
            payload: (payload && typeof payload === "object") ? payload : payload
        };
        const log = getFloorEditDiagnosticsLog();
        log.push(entry);
        if (log.length > FLOOR_EDIT_DIAGNOSTICS_MAX_EVENTS) {
            log.splice(0, log.length - FLOOR_EDIT_DIAGNOSTICS_MAX_EVENTS);
        }
        try {
            console.log("[FloorEditDiagnostics]", entry.event, entry.payload);
        } catch (_err) {}
    }

    if (typeof globalThis !== "undefined") {
        globalThis.__recordFloorEditDiagnostic = recordFloorEditDiagnostic;
        globalThis.__clearFloorEditDiagnosticsLog = clearFloorEditDiagnosticsLog;
        globalThis.__getFloorEditDiagnosticsLog = getFloorEditDiagnosticsLog;
    }

    const SPELL_CLASS_BY_NAME = {
        fireball: "Fireball",
        freeze: "Iceball",
        lightning: "Lightning",
        spikes: "Spikes",
        vanish: "Vanish",
        editorvanish: "EditorVanish",
        moveobject: "MoveObject",
        editscript: "EditScript",
        triggerarea: "TriggerAreaSpell"
    };

    let magicIntervalId = null;
    let lastMagicTickMs = 0;
    let editorMode = false;
    let spellMenuMode = "main";
    let editorMenuMode = "categories";
    let flooringTexturePaths = [];
    let flooringTextureFetchPromise = null;
    let wallTexturePaths = [];
    let wallTextureFetchPromise = null;
    let placeableImagePathsByCategory = null;
    let placeableImageFetchPromise = null;
    let editorMenuCategory = DEFAULT_PLACEABLE_CATEGORY;
    const textureAlphaMaskCache = new Map();

    function normalizeFloorEditLevel(level) {
        const n = Number(level);
        if (!Number.isFinite(n)) return FLOOR_EDIT_LEVEL_DEFAULT;
        return Math.max(FLOOR_EDIT_LEVEL_MIN, Math.min(FLOOR_EDIT_LEVEL_MAX, Math.round(n)));
    }

    function getSelectedFloorEditLevel(wizardRef) {
        if (wizardRef && Number.isFinite(wizardRef.selectedFloorEditLevel)) {
            return normalizeFloorEditLevel(wizardRef.selectedFloorEditLevel);
        }
        if (typeof globalThis !== "undefined" && Number.isFinite(globalThis.selectedFloorEditLevel)) {
            return normalizeFloorEditLevel(globalThis.selectedFloorEditLevel);
        }
        return FLOOR_EDIT_LEVEL_DEFAULT;
    }

    function setSelectedFloorEditLevel(wizardRef, level, options = {}) {
        const normalized = normalizeFloorEditLevel(level);
        const shouldMoveWizard = !!(options && options.moveWizard === true);
        const targetBaseZ = normalized * 3;
        const wizardTarget = wizardRef || ((typeof globalThis !== "undefined") ? globalThis.wizard : null);
        const previousLayer = wizardTarget && Number.isFinite(wizardTarget.currentLayer)
            ? Number(wizardTarget.currentLayer)
            : null;
        const previousBaseZ = wizardTarget && Number.isFinite(wizardTarget.currentLayerBaseZ)
            ? Number(wizardTarget.currentLayerBaseZ)
            : null;
        if (wizardTarget) {
            wizardTarget.selectedFloorEditLevel = normalized;
            if (shouldMoveWizard) {
                wizardTarget.z = 0;
                wizardTarget._floorFallState = null;
                console.log("[wizard.layer.set]", {
                    source: "setSelectedFloorEditLevel",
                    reason: "editor-level-change",
                    previousLayer,
                    nextLayer: normalized,
                    previousBaseZ,
                    nextBaseZ: targetBaseZ,
                    spell: wizardTarget && typeof wizardTarget.currentSpell === "string" ? wizardTarget.currentSpell : null
                });
            }
        }
        if (typeof globalThis !== "undefined") {
            globalThis.selectedFloorEditLevel = normalized;
            if (shouldMoveWizard && globalThis.viewport && typeof globalThis.viewport === "object") {
                globalThis.viewport.prevZ = Number.isFinite(globalThis.viewport.z)
                    ? Number(globalThis.viewport.z)
                    : targetBaseZ;
                globalThis.viewport.z = targetBaseZ;
            }
            if (typeof globalThis.presentGameFrame === "function") {
                globalThis.presentGameFrame();
            }
        }
        return normalized;
    }

    function getTextureAlphaMask(texture) {
        if (!texture || !texture.baseTexture || !texture.frame) return null;
        const baseTexture = texture.baseTexture;
        const frame = texture.frame;
        const key = [
            baseTexture.uid,
            Math.floor(frame.x),
            Math.floor(frame.y),
            Math.floor(frame.width),
            Math.floor(frame.height)
        ].join(":");
        if (textureAlphaMaskCache.has(key)) {
            return textureAlphaMaskCache.get(key);
        }
        try {
            const source = baseTexture.resource && baseTexture.resource.source;
            if (!source) {
                textureAlphaMaskCache.set(key, null);
                return null;
            }
            const w = Math.max(1, Math.floor(frame.width));
            const h = Math.max(1, Math.floor(frame.height));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) {
                textureAlphaMaskCache.set(key, null);
                return null;
            }
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(
                source,
                frame.x,
                frame.y,
                frame.width,
                frame.height,
                0,
                0,
                w,
                h
            );
            const rgba = ctx.getImageData(0, 0, w, h).data;
            const alpha = new Uint8Array(w * h);
            for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
                alpha[j] = rgba[i + 3];
            }
            const mask = { width: w, height: h, alpha };
            textureAlphaMaskCache.set(key, mask);
            return mask;
        } catch (_err) {
            textureAlphaMaskCache.set(key, null);
            return null;
        }
    }

    function isOpaqueSpritePixelAtScreenPoint(sprite, screenPoint, alphaThreshold = 10) {
        if (!sprite || !sprite.texture || !screenPoint) return true;
        if (!(sprite instanceof PIXI.Sprite)) return true;
        try {
            if (!sprite.worldTransform || typeof sprite.worldTransform.applyInverse !== "function") return true;
            const local = new PIXI.Point();
            sprite.worldTransform.applyInverse(new PIXI.Point(screenPoint.x, screenPoint.y), local);

            const bounds = (typeof sprite.getLocalBounds === "function") ? sprite.getLocalBounds() : null;
            if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
                return true;
            }

            const u = (local.x - bounds.x) / bounds.width;
            const v = (local.y - bounds.y) / bounds.height;
            if (!Number.isFinite(u) || !Number.isFinite(v)) return true;
            if (u < 0 || u > 1 || v < 0 || v > 1) return false;

            const mask = getTextureAlphaMask(sprite.texture);
            if (!mask) return true;
            const px = Math.max(0, Math.min(mask.width - 1, Math.floor(u * (mask.width - 1))));
            const py = Math.max(0, Math.min(mask.height - 1, Math.floor(v * (mask.height - 1))));
            const a = mask.alpha[py * mask.width + px];
            return a >= alphaThreshold;
        } catch (_err) {
            // Never break targeting because alpha sampling failed.
            return true;
        }
    }

    function barycentricAtPoint(px, py, ax, ay, bx, by, cx, cy) {
        const v0x = bx - ax;
        const v0y = by - ay;
        const v1x = cx - ax;
        const v1y = cy - ay;
        const v2x = px - ax;
        const v2y = py - ay;
        const denom = (v0x * v1y - v1x * v0y);
        if (Math.abs(denom) < 1e-8) return null;
        const invDenom = 1 / denom;
        const v = (v2x * v1y - v1x * v2y) * invDenom;
        const w = (v0x * v2y - v2x * v0y) * invDenom;
        const u = 1 - v - w;
        return { u, v, w };
    }

    function isOpaqueMeshPixelAtScreenPoint(mesh, screenPoint, alphaThreshold = 10) {
        if (!mesh || !mesh.geometry || !screenPoint) return true;
        try {
            const safeGetBuffer = (geometry, attrName) => {
                if (!geometry || typeof geometry.getBuffer !== "function") return null;
                try {
                    return geometry.getBuffer(attrName);
                } catch (_err) {
                    return null;
                }
            };
            const texture = (mesh.material && mesh.material.texture)
                ? mesh.material.texture
                : ((mesh.shader && mesh.shader.uniforms && mesh.shader.uniforms.uSampler) ? mesh.shader.uniforms.uSampler : null);
            if (!texture) return true;
            const mask = getTextureAlphaMask(texture);
            if (!mask) return true;

            const vb = safeGetBuffer(mesh.geometry, "aVertexPosition");
            const wb = safeGetBuffer(mesh.geometry, "aWorldPosition");
            const ub = safeGetBuffer(mesh.geometry, "aUvs");
            const ib = mesh.geometry.getIndex && mesh.geometry.getIndex();
            const vertices = vb && vb.data ? vb.data : null;
            const worldVertices = wb && wb.data ? wb.data : null;
            const uvs = ub && ub.data ? ub.data : null;
            const indices = ib && ib.data ? ib.data : null;
            if ((!vertices && !worldVertices) || !uvs || !indices || indices.length < 3) return true;

            const camera = viewport;
            const projectWorldToScreen = (wx, wy, wz) => {
                const dx = (map && typeof map.shortestDeltaX === "function")
                    ? map.shortestDeltaX(camera.x, wx)
                    : (wx - camera.x);
                const dy = (map && typeof map.shortestDeltaY === "function")
                    ? map.shortestDeltaY(camera.y, wy)
                    : (wy - camera.y);
                return {
                    x: dx * viewscale,
                    y: (dy - wz) * viewscale * xyratio
                };
            };

            let uv = null;
            for (let i = 0; i <= indices.length - 3; i += 3) {
                const ia = indices[i];
                const ibx = indices[i + 1];
                const ic = indices[i + 2];

                let ax, ay, bx, by, cx, cy;
                if (worldVertices) {
                    const a = projectWorldToScreen(
                        worldVertices[ia * 3],
                        worldVertices[ia * 3 + 1],
                        worldVertices[ia * 3 + 2]
                    );
                    const b = projectWorldToScreen(
                        worldVertices[ibx * 3],
                        worldVertices[ibx * 3 + 1],
                        worldVertices[ibx * 3 + 2]
                    );
                    const c = projectWorldToScreen(
                        worldVertices[ic * 3],
                        worldVertices[ic * 3 + 1],
                        worldVertices[ic * 3 + 2]
                    );
                    ax = a.x; ay = a.y;
                    bx = b.x; by = b.y;
                    cx = c.x; cy = c.y;
                } else {
                    if (!mesh.worldTransform || typeof mesh.worldTransform.apply !== "function") return true;
                    const a = mesh.worldTransform.apply(new PIXI.Point(vertices[ia * 2], vertices[ia * 2 + 1]));
                    const b = mesh.worldTransform.apply(new PIXI.Point(vertices[ibx * 2], vertices[ibx * 2 + 1]));
                    const c = mesh.worldTransform.apply(new PIXI.Point(vertices[ic * 2], vertices[ic * 2 + 1]));
                    ax = a.x; ay = a.y;
                    bx = b.x; by = b.y;
                    cx = c.x; cy = c.y;
                }
                const bc = barycentricAtPoint(screenPoint.x, screenPoint.y, ax, ay, bx, by, cx, cy);
                if (!bc) continue;
                const epsilon = 1e-4;
                if (bc.u < -epsilon || bc.v < -epsilon || bc.w < -epsilon) continue;

                const au = uvs[ia * 2];
                const av = uvs[ia * 2 + 1];
                const bu = uvs[ibx * 2];
                const bv = uvs[ibx * 2 + 1];
                const cu = uvs[ic * 2];
                const cv = uvs[ic * 2 + 1];
                uv = {
                    u: (au * bc.u) + (bu * bc.v) + (cu * bc.w),
                    v: (av * bc.u) + (bv * bc.v) + (cv * bc.w)
                };
                break;
            }

            if (!uv) return false;
            if (!Number.isFinite(uv.u) || !Number.isFinite(uv.v)) return true;

            const baseTexture = texture.baseTexture || null;
            const wrapMode = baseTexture ? baseTexture.wrapMode : null;
            const repeatWrap = (
                wrapMode === PIXI.WRAP_MODES.REPEAT ||
                wrapMode === PIXI.WRAP_MODES.MIRRORED_REPEAT
            );
            let sampleU = uv.u;
            let sampleV = uv.v;
            if (repeatWrap) {
                sampleU = sampleU - Math.floor(sampleU);
                sampleV = sampleV - Math.floor(sampleV);
            } else if (sampleU < 0 || sampleU > 1 || sampleV < 0 || sampleV > 1) {
                return false;
            }

            const px = Math.max(0, Math.min(mask.width - 1, Math.floor(sampleU * (mask.width - 1))));
            const py = Math.max(0, Math.min(mask.height - 1, Math.floor(sampleV * (mask.height - 1))));
            const a = mask.alpha[py * mask.width + px];
            return a >= alphaThreshold;
        } catch (_err) {
            return true;
        }
    }

    function isOpaqueRenderablePixelAtScreenPoint(displayObj, screenPoint, alphaThreshold = 10) {
        if (!displayObj) return true;
        if (typeof PIXI !== "undefined" && displayObj instanceof PIXI.Sprite) {
            return isOpaqueSpritePixelAtScreenPoint(displayObj, screenPoint, alphaThreshold);
        }
        if (typeof PIXI !== "undefined" && displayObj instanceof PIXI.Mesh) {
            return isOpaqueMeshPixelAtScreenPoint(displayObj, screenPoint, alphaThreshold);
        }
        return true;
    }

    function getSpellTargetDisplayObject(item) {
        if (!item) return null;
        if (item._renderingDepthMesh && item._renderingDepthMesh.parent) return item._renderingDepthMesh;
        if (item._opaqueDepthMesh && item._opaqueDepthMesh.parent) return item._opaqueDepthMesh;
        if (item.pixiSprite && item.pixiSprite.parent) return item.pixiSprite;
        return null;
    }

    function getSelectedFlooringTexture(wizardRef) {
        if (!wizardRef) return DEFAULT_FLOORING_TEXTURE;
        if (typeof wizardRef.selectedFlooringTexture === "string" && wizardRef.selectedFlooringTexture.length > 0) {
            return wizardRef.selectedFlooringTexture;
        }
        wizardRef.selectedFlooringTexture = DEFAULT_FLOORING_TEXTURE;
        return wizardRef.selectedFlooringTexture;
    }

    function getAuraDefinition(name) {
        return AURA_DEFS.find(aura => aura.name === name) || null;
    }

    function isAuraSpellName(spellName) {
        return !!getAuraDefinition(spellName);
    }

    function getAllMagicNames() {
        return SPELL_DEFS.map(spell => spell.name).concat(AURA_DEFS.map(aura => aura.name));
    }

    function isKnownMagicName(magicName) {
        return typeof magicName === "string" && getAllMagicNames().includes(magicName);
    }

    function normalizeUnlockedNames(source, allowedNames) {
        const seen = new Set();
        const out = [];
        const append = (name) => {
            if (typeof name !== "string") return;
            const normalized = name.trim().toLowerCase();
            if (!normalized || !allowedNames.includes(normalized) || seen.has(normalized)) return;
            seen.add(normalized);
            out.push(normalized);
        };
        if (Array.isArray(source)) source.forEach(append);
        return out;
    }

    function migrateLegacyShieldAuraState(wizardRef) {
        if (!wizardRef) return;

        if (Array.isArray(wizardRef.activeAuras)) {
            wizardRef.activeAuras = wizardRef.activeAuras.filter(name => name !== "shield");
        }
        if (wizardRef.activeAura === "shield") {
            wizardRef.activeAura = Array.isArray(wizardRef.activeAuras) && wizardRef.activeAuras.length > 0
                ? wizardRef.activeAuras[0]
                : null;
        }
    }

    function syncUnifiedMagicUnlockState(wizardRef) {
        const allMagicNames = getAllMagicNames();
        if (!wizardRef) return allMagicNames.slice();

        migrateLegacyShieldAuraState(wizardRef);

        const combined = Array.isArray(wizardRef.unlockedMagic)
            ? wizardRef.unlockedMagic
            : [];

        const unlockedMagic = normalizeUnlockedNames(combined, allMagicNames);
        wizardRef.unlockedMagic = unlockedMagic.slice();

        return unlockedMagic;
    }

    function grantMagicUnlock(wizardRef, magicName) {
        if (!wizardRef || typeof magicName !== "string") return false;
        const normalizedName = magicName.trim().toLowerCase();
        if (!isKnownMagicName(normalizedName)) return false;
        const unlockedMagic = syncUnifiedMagicUnlockState(wizardRef);
        if (unlockedMagic.includes(normalizedName)) return false;
        wizardRef.unlockedMagic = unlockedMagic.concat(normalizedName);
        syncUnifiedMagicUnlockState(wizardRef);
        return true;
    }

    function revokeMagicUnlock(wizardRef, magicName) {
        if (!wizardRef || typeof magicName !== "string") return false;
        const normalizedName = magicName.trim().toLowerCase();
        if (!isKnownMagicName(normalizedName)) return false;
        const unlockedMagic = syncUnifiedMagicUnlockState(wizardRef);
        if (!unlockedMagic.includes(normalizedName)) return false;
        wizardRef.unlockedMagic = unlockedMagic.filter(name => name !== normalizedName);
        syncUnifiedMagicUnlockState(wizardRef);
        return true;
    }

    function getUnlockedSpellNames(wizardRef) {
        const allSpellNames = SPELL_DEFS.map(spell => spell.name);
        if (!wizardRef) return allSpellNames.slice();
        const unlockedMagic = syncUnifiedMagicUnlockState(wizardRef);
        const unlocked = allSpellNames.filter(name => unlockedMagic.includes(name));
        if (unlocked.includes("spawnanimal") && !unlocked.includes("attacksquirrel")) {
            unlocked.push("attacksquirrel");
        }
        if (typeof wizardRef.isGodMode === "function" && wizardRef.isGodMode()) {
            return allSpellNames.filter(name => name !== "vanish");
        }
        return unlocked;
    }

    function getUnlockedAuraNames(wizardRef) {
        const allAuraNames = AURA_DEFS.map(aura => aura.name);
        if (!wizardRef) return allAuraNames.slice();
        const unlockedMagic = syncUnifiedMagicUnlockState(wizardRef);
        const unlocked = allAuraNames.filter(name => unlockedMagic.includes(name));
        if (typeof wizardRef.isGodMode === "function" && wizardRef.isGodMode()) {
            return allAuraNames.slice();
        }
        return unlocked;
    }

    function isSpellUnlocked(wizardRef, spellName) {
        if (typeof spellName !== "string" || spellName.length === 0) return false;
        if (spellName === "lightning") {
            const inventory = (wizardRef && typeof wizardRef.getInventory === "function")
                ? wizardRef.getInventory()
                : wizardRef?.inventory;
            if (!inventory) return false;
            if (typeof inventory.get === "function") {
                return Number(inventory.get("lightning")) > 0;
            }
            if (typeof inventory.has === "function") {
                return inventory.has("lightning", 1);
            }
            const raw = inventory.items && typeof inventory.items === "object"
                ? inventory.items.lightning
                : 0;
            return Number(raw) > 0;
        }
        return getUnlockedSpellNames(wizardRef).includes(spellName);
    }

    function isAuraUnlocked(wizardRef, auraName) {
        if (typeof auraName !== "string" || auraName.length === 0) return false;
        return getUnlockedAuraNames(wizardRef).includes(auraName);
    }

    function getMagicIconPath(magicName) {
        if (typeof magicName !== "string") return "";
        const normalizedName = magicName.trim().toLowerCase();
        if (!normalizedName.length) return "";
        const spellDef = SPELL_DEFS.find(spell => spell.name === normalizedName);
        if (spellDef && typeof spellDef.icon === "string") return spellDef.icon;
        const auraDef = AURA_DEFS.find(aura => aura.name === normalizedName);
        if (auraDef && typeof auraDef.icon === "string") return auraDef.icon;
        return "";
    }

    function getAvailableAuraDefinitions(wizardRef) {
        const unlocked = new Set(getUnlockedAuraNames(wizardRef));
        return AURA_DEFS.filter(aura => unlocked.has(aura.name));
    }

    function shouldFoldAurasIntoSpellList(wizardRef) {
        return !!(
            wizardRef &&
            typeof wizardRef.isAdventureMode === "function" &&
            wizardRef.isAdventureMode()
        );
    }

    function normalizeActiveAuras(wizardRef) {
        if (!wizardRef) return [];
        syncUnifiedMagicUnlockState(wizardRef);
        const source = Array.isArray(wizardRef.activeAuras)
            ? wizardRef.activeAuras
            : (typeof wizardRef.activeAura === "string" ? [wizardRef.activeAura] : []);
        const unique = [];
        source.forEach(name => {
            if (typeof name !== "string") return;
            const def = getAuraDefinition(name);
            if (!def || !isAuraUnlocked(wizardRef, def.name)) return;
            if (!unique.includes(def.name)) {
                unique.push(def.name);
            }
        });
        wizardRef.activeAuras = unique;
        wizardRef.activeAura = unique.length > 0 ? unique[0] : null; // backward compatibility
        return unique;
    }

    function getActiveAuraNames(wizardRef) {
        return normalizeActiveAuras(wizardRef);
    }

    function isAuraActive(wizardRef, auraName) {
        if (!wizardRef || !auraName) return false;
        return getActiveAuraNames(wizardRef).includes(auraName);
    }

    function isAuraSpellInactive(wizardRef, auraName) {
        return isAuraSpellName(auraName) && !isAuraActive(wizardRef, auraName);
    }

    function isPlayerInvisibleToEnemies(wizardRef) {
        return isAuraActive(wizardRef, "invisibility");
    }

    function setActiveAuras(wizardRef, auraNames) {
        if (!wizardRef) return false;
        const previous = normalizeActiveAuras(wizardRef);
        const requested = Array.isArray(auraNames) ? auraNames : [];
        const next = [];
        requested.forEach(name => {
            const def = getAuraDefinition(name);
            if (!def || !isAuraUnlocked(wizardRef, def.name)) return;
            if (!next.includes(def.name)) next.push(def.name);
        });
        if (previous.length === next.length && previous.every((name, index) => name === next[index])) {
            return false;
        }
        wizardRef.activeAuras = next;
        wizardRef.activeAura = next.length > 0 ? next[0] : null; // backward compatibility
        refreshSpellSelector(wizardRef);
        refreshAuraSelector(wizardRef);
        return true;
    }

    function toggleAura(wizardRef, auraName) {
        if (!wizardRef) return false;
        const aura = getAuraDefinition(auraName);
        if (!aura || !isAuraUnlocked(wizardRef, aura.name)) return false;
        const active = normalizeActiveAuras(wizardRef).slice();
        const idx = active.indexOf(aura.name);
        if (idx >= 0) {
            active.splice(idx, 1);
        } else {
            active.push(aura.name);
        }
        return setActiveAuras(wizardRef, active);
    }

    function syncAdventureAuraSelectionState(wizardRef) {
        if (!wizardRef || !shouldFoldAurasIntoSpellList(wizardRef)) return false;
        normalizeActiveAuras(wizardRef);
        return false;
    }

    function getActiveAuraMagicDrainPerSecond(wizardRef) {
        const active = normalizeActiveAuras(wizardRef);
        if (!active.length) return 0;
        let total = 0;
        active.forEach(name => {
            total += getAuraMagicDrainPerSecond(name);
        });
        return total;
    }

    function getAuraMagicDrainPerSecond(auraName) {
        const aura = getAuraDefinition(auraName);
        if (!aura || !Number.isFinite(aura.magicPerSecond)) return 0;
        const baseDrainPerSecond = Math.max(0, Number(aura.magicPerSecond));
        if (aura.name === "healing") {
            return baseDrainPerSecond * HEALING_AURA_EFFECT_MULTIPLIER;
        }
        return baseDrainPerSecond;
    }

    function getHealingAuraHpMultiplier() {
        return Math.max(1, Number.isFinite(healingAuraHpMultiplier) ? healingAuraHpMultiplier : 5);
    }

    function setHealingAuraHpMultiplier(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return getHealingAuraHpMultiplier();
        healingAuraHpMultiplier = Math.max(1, n);
        return healingAuraHpMultiplier;
    }

    function castShieldSpell(wizardRef) {
        if (!wizardRef) return false;
        if (!canAffordMagicCost(wizardRef, SHIELD_SPELL_MAGIC_COST)) {
            if (globalThis.Spell && typeof globalThis.Spell.indicateInsufficientMagic === "function") {
                globalThis.Spell.indicateInsufficientMagic();
            }
            return false;
        }

        if (!spendMagicCost(wizardRef, SHIELD_SPELL_MAGIC_COST)) {
            return false;
        }

        if (typeof wizardRef.applyShieldSpell === "function") {
            wizardRef.applyShieldSpell(SHIELD_SPELL_HP);
        } else {
            wizardRef.shieldHp = SHIELD_SPELL_HP;
            wizardRef.maxShieldHp = SHIELD_SPELL_HP;
        }

        const delayTime = Math.max(0.05, Number(wizardRef.cooldownTime) || 0.1);
        wizardRef.castDelay = true;
        wizardRef.casting = true;
        setTimeout(() => {
            wizardRef.castDelay = false;
            wizardRef.casting = false;
        }, 1000 * delayTime);
        return true;
    }

    function getRoadSpellIcon(wizardRef) {
        return getSelectedFlooringTexture(wizardRef);
    }

    function getWallSpellIcon(wizardRef) {
        return getSelectedWallTexture(wizardRef);
    }

    function getTreeVariantCount(wizardRef) {
        const textures = (
            wizardRef &&
            wizardRef.map &&
            wizardRef.map.scenery &&
            wizardRef.map.scenery.tree &&
            Array.isArray(wizardRef.map.scenery.tree.textures)
        ) ? wizardRef.map.scenery.tree.textures : null;
        return textures && textures.length > 0 ? textures.length : 5;
    }

    function getSelectedTreeTextureVariant(wizardRef) {
        if (!wizardRef) return RANDOM_TREE_VARIANT;
        if (wizardRef.treeGrowRandomMode === true || wizardRef.selectedTreeTextureVariant === RANDOM_TREE_VARIANT) {
            wizardRef.treeGrowRandomMode = true;
            wizardRef.selectedTreeTextureVariant = RANDOM_TREE_VARIANT;
            return RANDOM_TREE_VARIANT;
        }
        const count = getTreeVariantCount(wizardRef);
        if (
            Number.isInteger(wizardRef.selectedTreeTextureVariant) &&
            wizardRef.selectedTreeTextureVariant >= 0 &&
            wizardRef.selectedTreeTextureVariant < count
        ) {
            wizardRef.treeGrowRandomMode = false;
            return wizardRef.selectedTreeTextureVariant;
        }
        wizardRef.treeGrowRandomMode = true;
        wizardRef.selectedTreeTextureVariant = RANDOM_TREE_VARIANT;
        return wizardRef.selectedTreeTextureVariant;
    }

    function clearTreePlacementPreviewVariant(wizardRef) {
        if (!wizardRef) return;
        wizardRef.treeGrowPreviewTextureVariant = undefined;
    }

    function resolveTreePlacementTextureVariant(wizardRef, options = null) {
        const forceNew = !!(options && options.forceNew);
        const selected = getSelectedTreeTextureVariant(wizardRef);
        if (selected !== RANDOM_TREE_VARIANT) {
            if (wizardRef) {
                wizardRef.treeGrowPreviewTextureVariant = selected;
            }
            clearTreePlacementPreviewVariant(wizardRef);
            return selected;
        }
        const variantCount = getTreeVariantCount(wizardRef);
        if (!(variantCount > 0)) {
            clearTreePlacementPreviewVariant(wizardRef);
            return 0;
        }
        if (forceNew) {
            clearTreePlacementPreviewVariant(wizardRef);
        }
        const lockedVariant = wizardRef ? wizardRef.treeGrowPreviewTextureVariant : undefined;
        if (
            Number.isInteger(lockedVariant) &&
            lockedVariant >= 0 &&
            lockedVariant < variantCount
        ) {
            return lockedVariant;
        }
        const randomVariant = Math.floor(Math.random() * variantCount);
        if (wizardRef) {
            wizardRef.treeGrowPreviewTextureVariant = randomVariant;
        }
        return randomVariant;
    }

    function getTreeSpellIcon(wizardRef) {
        const selected = getSelectedTreeTextureVariant(wizardRef);
        if (Number.isInteger(selected)) {
            return `/assets/images/trees/tree${selected}.png`;
        }
        return "/assets/images/thumbnails/tree.png";
    }

    function normalizePlaceableSelections(wizardRef) {
        if (!wizardRef) return;
        const normalizeRoofTexturePath = (texturePath) => {
            if (typeof texturePath !== "string" || texturePath.length === 0) return DEFAULT_ROOF_TEXTURE;
            if (texturePath === ROOF_EDITOR_ICON) return DEFAULT_ROOF_TEXTURE;
            const base = texturePath.split("?")[0].split("#")[0];
            if (base.startsWith("/assets/images/roof/")) {
                return texturePath.replace("/assets/images/roof/", "/assets/images/roofs/");
            }
            return texturePath;
        };
        if (!wizardRef.selectedPlaceableByCategory || typeof wizardRef.selectedPlaceableByCategory !== "object") {
            wizardRef.selectedPlaceableByCategory = {};
        }
        if (!wizardRef.selectedPlaceableRenderOffsetByTexture || typeof wizardRef.selectedPlaceableRenderOffsetByTexture !== "object") {
            wizardRef.selectedPlaceableRenderOffsetByTexture = {};
        }
        if (!wizardRef.selectedPlaceableScaleByTexture || typeof wizardRef.selectedPlaceableScaleByTexture !== "object") {
            wizardRef.selectedPlaceableScaleByTexture = {};
        }
        if (!wizardRef.selectedPlaceableScaleMinByTexture || typeof wizardRef.selectedPlaceableScaleMinByTexture !== "object") {
            wizardRef.selectedPlaceableScaleMinByTexture = {};
        }
        if (!wizardRef.selectedPlaceableScaleMaxByTexture || typeof wizardRef.selectedPlaceableScaleMaxByTexture !== "object") {
            wizardRef.selectedPlaceableScaleMaxByTexture = {};
        }
        if (!wizardRef.selectedPlaceableRotationByTexture || typeof wizardRef.selectedPlaceableRotationByTexture !== "object") {
            wizardRef.selectedPlaceableRotationByTexture = {};
        }
        if (!wizardRef.selectedPlaceableRotationAxisByTexture || typeof wizardRef.selectedPlaceableRotationAxisByTexture !== "object") {
            wizardRef.selectedPlaceableRotationAxisByTexture = {};
        }
        if (!wizardRef.selectedPlaceableAnchorXByTexture || typeof wizardRef.selectedPlaceableAnchorXByTexture !== "object") {
            wizardRef.selectedPlaceableAnchorXByTexture = {};
        }
        if (!wizardRef.selectedPlaceableAnchorYByTexture || typeof wizardRef.selectedPlaceableAnchorYByTexture !== "object") {
            wizardRef.selectedPlaceableAnchorYByTexture = {};
        }
        if (!wizardRef.selectedPlaceableSizingByTexture || typeof wizardRef.selectedPlaceableSizingByTexture !== "object") {
            wizardRef.selectedPlaceableSizingByTexture = {};
        }
        PLACEABLE_CATEGORIES.forEach(category => {
            const existing = wizardRef.selectedPlaceableByCategory[category];
            if (typeof existing !== "string" || existing.length === 0) {
                wizardRef.selectedPlaceableByCategory[category] = DEFAULT_PLACEABLE_BY_CATEGORY[category];
                return;
            }
            if (category === "roof") {
                wizardRef.selectedPlaceableByCategory[category] = normalizeRoofTexturePath(existing);
            }
        });
        const selectedCategory = (typeof wizardRef.selectedPlaceableCategory === "string")
            ? wizardRef.selectedPlaceableCategory
            : DEFAULT_PLACEABLE_CATEGORY;
        wizardRef.selectedPlaceableCategory = PLACEABLE_CATEGORIES.includes(selectedCategory)
            ? selectedCategory
            : DEFAULT_PLACEABLE_CATEGORY;
        const selectedPath = wizardRef.selectedPlaceableByCategory[wizardRef.selectedPlaceableCategory];
        wizardRef.selectedPlaceableTexturePath = (typeof selectedPath === "string" && selectedPath.length > 0)
            ? selectedPath
            : DEFAULT_PLACEABLE_BY_CATEGORY[wizardRef.selectedPlaceableCategory];
        if (wizardRef.selectedPlaceableCategory === "roof") {
            wizardRef.selectedPlaceableTexturePath = normalizeRoofTexturePath(wizardRef.selectedPlaceableTexturePath);
        }
        const activeTexturePath = wizardRef.selectedPlaceableTexturePath;
        const selectedCategoryForActive = wizardRef.selectedPlaceableCategory;
        const defaultAxis = (selectedCategoryForActive === "doors" || selectedCategoryForActive === "windows")
            ? "spatial"
            : "visual";
        const defaultAnchorYForCategory = (selectedCategoryForActive === "windows") ? 0.5 : 1;
        if (typeof activeTexturePath === "string" && activeTexturePath.length > 0) {
            const oldGlobalOffset = Number.isFinite(wizardRef.selectedPlaceableRenderOffset)
                ? Number(wizardRef.selectedPlaceableRenderOffset)
                : 0;
            const oldGlobalScale = Number.isFinite(wizardRef.selectedPlaceableScale)
                ? Number(wizardRef.selectedPlaceableScale)
                : 1;
            const oldGlobalRotation = Number.isFinite(wizardRef.selectedPlaceableRotation)
                ? Number(wizardRef.selectedPlaceableRotation)
                : 0;
            const oldGlobalAxis = (typeof wizardRef.selectedPlaceableRotationAxis === "string")
                ? wizardRef.selectedPlaceableRotationAxis
                : defaultAxis;
            const oldGlobalAnchorX = Number.isFinite(wizardRef.selectedPlaceableAnchorX)
                ? Number(wizardRef.selectedPlaceableAnchorX)
                : 0.5;
            const oldGlobalAnchorY = Number.isFinite(wizardRef.selectedPlaceableAnchorY)
                ? Number(wizardRef.selectedPlaceableAnchorY)
                : defaultAnchorYForCategory;

            if (!Number.isFinite(wizardRef.selectedPlaceableRenderOffsetByTexture[activeTexturePath])) {
                wizardRef.selectedPlaceableRenderOffsetByTexture[activeTexturePath] = oldGlobalOffset;
            }
            if (!Number.isFinite(wizardRef.selectedPlaceableScaleByTexture[activeTexturePath])) {
                wizardRef.selectedPlaceableScaleByTexture[activeTexturePath] = oldGlobalScale;
            }
            if (!Number.isFinite(wizardRef.selectedPlaceableRotationByTexture[activeTexturePath])) {
                wizardRef.selectedPlaceableRotationByTexture[activeTexturePath] = oldGlobalRotation;
            }
            if (
                typeof wizardRef.selectedPlaceableRotationAxisByTexture[activeTexturePath] !== "string" ||
                wizardRef.selectedPlaceableRotationAxisByTexture[activeTexturePath].length === 0
            ) {
                wizardRef.selectedPlaceableRotationAxisByTexture[activeTexturePath] = oldGlobalAxis;
            }
            if (!Number.isFinite(wizardRef.selectedPlaceableAnchorXByTexture[activeTexturePath])) {
                wizardRef.selectedPlaceableAnchorXByTexture[activeTexturePath] = oldGlobalAnchorX;
            }
            if (!Number.isFinite(wizardRef.selectedPlaceableAnchorYByTexture[activeTexturePath])) {
                wizardRef.selectedPlaceableAnchorYByTexture[activeTexturePath] = oldGlobalAnchorY;
            }

            const nextOffset = Number(wizardRef.selectedPlaceableRenderOffsetByTexture[activeTexturePath]);
            const nextScale = Number(wizardRef.selectedPlaceableScaleByTexture[activeTexturePath]);
            const nextRotation = Number(wizardRef.selectedPlaceableRotationByTexture[activeTexturePath]);
            const nextAxisRaw = wizardRef.selectedPlaceableRotationAxisByTexture[activeTexturePath];
            const nextAnchorX = Number(wizardRef.selectedPlaceableAnchorXByTexture[activeTexturePath]);
            const nextAnchorY = Number(wizardRef.selectedPlaceableAnchorYByTexture[activeTexturePath]);
            const nextScaleMin = Number(wizardRef.selectedPlaceableScaleMinByTexture[activeTexturePath]);
            const nextScaleMax = Number(wizardRef.selectedPlaceableScaleMaxByTexture[activeTexturePath]);
            const effectiveScaleMin = Number.isFinite(nextScaleMin) ? nextScaleMin : 0.2;
            const effectiveScaleMax = Number.isFinite(nextScaleMax) ? nextScaleMax : 5;
            wizardRef.selectedPlaceableRenderOffset = Number.isFinite(nextOffset) ? nextOffset : 0;
            wizardRef.selectedPlaceableScaleMin = effectiveScaleMin;
            wizardRef.selectedPlaceableScaleMax = effectiveScaleMax;
            wizardRef.selectedPlaceableScale = Number.isFinite(nextScale) ? Math.max(effectiveScaleMin, Math.min(effectiveScaleMax, nextScale)) : 1;
            wizardRef.selectedPlaceableRotation = Number.isFinite(nextRotation) ? nextRotation : 0;
            wizardRef.selectedPlaceableRotationAxis = (nextAxisRaw === "spatial" || nextAxisRaw === "visual" || nextAxisRaw === "none" || nextAxisRaw === "ground")
                ? nextAxisRaw
                : defaultAxis;
            wizardRef.selectedPlaceableAnchorX = Number.isFinite(nextAnchorX) ? nextAnchorX : 0.5;
            wizardRef.selectedPlaceableAnchorY = Number.isFinite(nextAnchorY) ? nextAnchorY : defaultAnchorYForCategory;
        } else {
            wizardRef.selectedPlaceableRenderOffset = 0;
            wizardRef.selectedPlaceableScale = 1;
            wizardRef.selectedPlaceableScaleMin = 0.2;
            wizardRef.selectedPlaceableScaleMax = 5;
            wizardRef.selectedPlaceableRotation = 0;
            wizardRef.selectedPlaceableRotationAxis = defaultAxis;
            wizardRef.selectedPlaceableAnchorX = 0.5;
            wizardRef.selectedPlaceableAnchorY = defaultAnchorYForCategory;
        }
    }

    function normalizePlaceableRotationAxisForWizard(wizardRef, axis, category = null) {
        const normalized = (typeof axis === "string") ? axis.trim().toLowerCase() : "";
        if (normalized === "spatial" || normalized === "visual" || normalized === "none" || normalized === "ground") return normalized;
        const fallbackCategory = (typeof category === "string" && category.length > 0)
            ? category
            : (wizardRef && typeof wizardRef.selectedPlaceableCategory === "string" ? wizardRef.selectedPlaceableCategory : DEFAULT_PLACEABLE_CATEGORY);
        return (fallbackCategory === "doors" || fallbackCategory === "windows") ? "spatial" : "visual";
    }

    async function refreshSelectedPlaceableMetadata(wizardRef) {
        if (!wizardRef) return null;
        normalizePlaceableSelections(wizardRef);
        const category = getSelectedPlaceableCategory(wizardRef);
        const texturePath = getSelectedPlaceableTexture(wizardRef);
        if (category === "roof") {
            wizardRef.selectedPlaceableRotationAxisByTexture[texturePath] = "visual";
            wizardRef.selectedPlaceableRotationAxis = "visual";
            wizardRef.selectedPlaceableAnchorXByTexture[texturePath] = 0.5;
            wizardRef.selectedPlaceableAnchorYByTexture[texturePath] = 0.5;
            wizardRef.selectedPlaceableSizingByTexture[texturePath] = {
                width: 1,
                height: 1,
                baseSize: 1
            };
            wizardRef.selectedPlaceableAnchorX = 0.5;
            wizardRef.selectedPlaceableAnchorY = 0.5;
            return null;
        }
        if (!(typeof globalThis !== "undefined" && typeof globalThis.getResolvedPlaceableMetadata === "function")) {
            const fallbackAxis = normalizePlaceableRotationAxisForWizard(wizardRef, null, category);
            const fallbackAnchorY = category === "windows" ? 0.5 : 1;
            wizardRef.selectedPlaceableRotationAxisByTexture[texturePath] = fallbackAxis;
            wizardRef.selectedPlaceableRotationAxis = fallbackAxis;
            wizardRef.selectedPlaceableAnchorXByTexture[texturePath] = 0.5;
            wizardRef.selectedPlaceableAnchorYByTexture[texturePath] = fallbackAnchorY;
            wizardRef.selectedPlaceableSizingByTexture[texturePath] = {
                width: 1,
                height: 1,
                baseSize: 1
            };
            wizardRef.selectedPlaceableAnchorX = 0.5;
            wizardRef.selectedPlaceableAnchorY = fallbackAnchorY;
            return null;
        }
        const meta = await globalThis.getResolvedPlaceableMetadata(category, texturePath);
        const axis = normalizePlaceableRotationAxisForWizard(wizardRef, meta && meta.rotationAxis, category);
        const anchorX = Number.isFinite(meta && meta.anchor && meta.anchor.x) ? Number(meta.anchor.x) : 0.5;
        const anchorY = Number.isFinite(meta && meta.anchor && meta.anchor.y) ? Number(meta.anchor.y) : (category === "windows" ? 0.5 : 1);
        wizardRef.selectedPlaceableRotationAxisByTexture[texturePath] = axis;
        wizardRef.selectedPlaceableAnchorXByTexture[texturePath] = anchorX;
        wizardRef.selectedPlaceableAnchorYByTexture[texturePath] = anchorY;

        if (!wizardRef.selectedPlaceableCompositeLayersByTexture || typeof wizardRef.selectedPlaceableCompositeLayersByTexture !== "object") {
            wizardRef.selectedPlaceableCompositeLayersByTexture = {};
        }
        if (meta && Array.isArray(meta.compositeLayers) && meta.compositeLayers.length >= 2) {
            wizardRef.selectedPlaceableCompositeLayersByTexture[texturePath] = meta.compositeLayers.map(layer => ({
                name: String((layer && layer.name) || ""),
                uRegion: (Array.isArray(layer && layer.uRegion) && layer.uRegion.length >= 2)
                    ? [Number(layer.uRegion[0]) || 0, Number(layer.uRegion[1]) || 1]
                    : [0, 1]
            }));
        } else {
            wizardRef.selectedPlaceableCompositeLayersByTexture[texturePath] = null;
        }
        if (wizardRef.selectedPlaceableTexturePath === texturePath) {
            wizardRef.selectedPlaceableCompositeLayers = wizardRef.selectedPlaceableCompositeLayersByTexture[texturePath];
        }

        const metaWidth = (meta && Number.isFinite(meta.width) && meta.width > 0) ? Number(meta.width) : 1;
        const metaHeight = (meta && Number.isFinite(meta.height) && meta.height > 0) ? Number(meta.height) : 1;
        // Apply baseSize / minSize / maxSize from item metadata
        const metaBaseSize = (meta && Number.isFinite(meta.baseSize) && meta.baseSize > 0) ? Number(meta.baseSize) : null;
        const metaMinSize = (meta && Number.isFinite(meta.minSize) && meta.minSize > 0) ? Number(meta.minSize) : null;
        const metaMaxSize = (meta && Number.isFinite(meta.maxSize) && meta.maxSize > 0) ? Number(meta.maxSize) : null;
        wizardRef.selectedPlaceableSizingByTexture[texturePath] = {
            width: metaWidth,
            height: metaHeight,
            baseSize: metaBaseSize ?? Math.max(metaWidth, metaHeight)
        };
        const effectiveScaleMin = metaMinSize ?? (metaBaseSize ? metaBaseSize * 0.2 : 0.2);
        const effectiveScaleMax = metaMaxSize ?? (metaBaseSize ? metaBaseSize * 5 : 5);
        if (!wizardRef.selectedPlaceableScaleMinByTexture || typeof wizardRef.selectedPlaceableScaleMinByTexture !== "object") {
            wizardRef.selectedPlaceableScaleMinByTexture = {};
        }
        if (!wizardRef.selectedPlaceableScaleMaxByTexture || typeof wizardRef.selectedPlaceableScaleMaxByTexture !== "object") {
            wizardRef.selectedPlaceableScaleMaxByTexture = {};
        }
        wizardRef.selectedPlaceableScaleMinByTexture[texturePath] = effectiveScaleMin;
        wizardRef.selectedPlaceableScaleMaxByTexture[texturePath] = effectiveScaleMax;
        if (!wizardRef._baseSizeApplied) wizardRef._baseSizeApplied = new Set();
        if (metaBaseSize !== null && !wizardRef._baseSizeApplied.has(texturePath)) {
            wizardRef._baseSizeApplied.add(texturePath);
            wizardRef.selectedPlaceableScaleByTexture[texturePath] = metaBaseSize;
        }
        if (wizardRef.selectedPlaceableTexturePath === texturePath) {
            wizardRef.selectedPlaceableRotationAxis = axis;
            wizardRef.selectedPlaceableAnchorX = anchorX;
            wizardRef.selectedPlaceableAnchorY = anchorY;
            wizardRef.selectedPlaceableScaleMin = effectiveScaleMin;
            wizardRef.selectedPlaceableScaleMax = effectiveScaleMax;
            if (metaBaseSize !== null && wizardRef._baseSizeApplied.size > 0 &&
                !Number.isFinite(wizardRef.selectedPlaceableScaleByTexture[texturePath])) {
                wizardRef.selectedPlaceableScale = metaBaseSize;
            }
            const currentScale = Number(wizardRef.selectedPlaceableScaleByTexture[texturePath]);
            if (Number.isFinite(currentScale)) {
                wizardRef.selectedPlaceableScale = Math.max(effectiveScaleMin, Math.min(effectiveScaleMax, currentScale));
            }
        }
        return meta;
    }

    function adjustPlaceableRenderOffset(wizardRef, delta) {
        if (!wizardRef || !Number.isFinite(delta) || delta === 0) return null;
        normalizePlaceableSelections(wizardRef);
        const texturePath = (typeof wizardRef.selectedPlaceableTexturePath === "string" && wizardRef.selectedPlaceableTexturePath.length > 0)
            ? wizardRef.selectedPlaceableTexturePath
            : DEFAULT_PLACEABLE_BY_CATEGORY[DEFAULT_PLACEABLE_CATEGORY];
        const current = Number.isFinite(wizardRef.selectedPlaceableRenderOffset)
            ? Number(wizardRef.selectedPlaceableRenderOffset)
            : 0;
        const unclamped = current + delta;
        const next = Math.max(-10, Math.min(10, Math.round(unclamped * 10) / 10));
        wizardRef.selectedPlaceableRenderOffset = next;
        if (!wizardRef.selectedPlaceableRenderOffsetByTexture || typeof wizardRef.selectedPlaceableRenderOffsetByTexture !== "object") {
            wizardRef.selectedPlaceableRenderOffsetByTexture = {};
        }
        wizardRef.selectedPlaceableRenderOffsetByTexture[texturePath] = next;
        return next;
    }

    function adjustPlaceableScale(wizardRef, delta) {
        if (!wizardRef || !Number.isFinite(delta) || delta === 0) return null;
        normalizePlaceableSelections(wizardRef);
        const texturePath = (typeof wizardRef.selectedPlaceableTexturePath === "string" && wizardRef.selectedPlaceableTexturePath.length > 0)
            ? wizardRef.selectedPlaceableTexturePath
            : DEFAULT_PLACEABLE_BY_CATEGORY[DEFAULT_PLACEABLE_CATEGORY];
        const current = Number.isFinite(wizardRef.selectedPlaceableScale)
            ? Number(wizardRef.selectedPlaceableScale)
            : 1;
        const scaleMin = Number.isFinite(wizardRef.selectedPlaceableScaleMin) ? wizardRef.selectedPlaceableScaleMin : 0.2;
        const scaleMax = Number.isFinite(wizardRef.selectedPlaceableScaleMax) ? wizardRef.selectedPlaceableScaleMax : 5;
        const rawNext = Math.max(scaleMin, Math.min(scaleMax, current + delta));
        const next = Math.round(rawNext * 1000) / 1000;
        wizardRef.selectedPlaceableScale = next;
        if (!wizardRef.selectedPlaceableScaleByTexture || typeof wizardRef.selectedPlaceableScaleByTexture !== "object") {
            wizardRef.selectedPlaceableScaleByTexture = {};
        }
        wizardRef.selectedPlaceableScaleByTexture[texturePath] = next;
        return next;
    }

    function clampPowerupPlacementScale(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return POWERUP_PLACEMENT_SCALE_DEFAULT;
        const clamped = Math.max(POWERUP_PLACEMENT_SCALE_MIN, Math.min(POWERUP_PLACEMENT_SCALE_MAX, n));
        return Math.round(clamped * 1000) / 1000;
    }

    function getSelectedPowerupFileName(wizardRef) {
        if (wizardRef && typeof wizardRef.selectedPowerupFileName === "string" && wizardRef.selectedPowerupFileName.trim().length > 0) {
            return wizardRef.selectedPowerupFileName.trim();
        }
        return POWERUP_PLACEMENT_FILE_NAME;
    }

    function setSelectedPowerupFileName(wizardRef, fileName) {
        if (!wizardRef) return;
        wizardRef.selectedPowerupFileName = (typeof fileName === "string" && fileName.trim().length > 0)
            ? fileName.trim()
            : POWERUP_PLACEMENT_FILE_NAME;
    }

    function getPowerupPlacementBaseData(wizardRef) {
        const selectedFile = getSelectedPowerupFileName(wizardRef);
        let imageData = null;
        if (typeof getPowerupImageDataByFile === "function") {
            imageData = getPowerupImageDataByFile(selectedFile);
        }
        const width = Number.isFinite(imageData && imageData.width)
            ? Math.max(0.01, Number(imageData.width))
            : POWERUP_PLACEMENT_DEFAULT_WIDTH;
        const height = Number.isFinite(imageData && imageData.height)
            ? Math.max(0.01, Number(imageData.height))
            : POWERUP_PLACEMENT_DEFAULT_HEIGHT;
        const radius = Number.isFinite(imageData && imageData.groundPlaneHitbox && imageData.groundPlaneHitbox.radius)
            ? Math.max(0.01, Number(imageData.groundPlaneHitbox.radius))
            : POWERUP_PLACEMENT_DEFAULT_RADIUS;
        const imagePath = (imageData && typeof imageData.imagePath === "string" && imageData.imagePath.length > 0)
            ? imageData.imagePath
            : POWERUP_PLACEMENT_IMAGE_PATH;
        const anchorObj = (imageData && imageData.anchor && typeof imageData.anchor === "object")
            ? imageData.anchor : null;
        const anchorX = Number.isFinite(anchorObj && anchorObj.x) ? Number(anchorObj.x) : 0.5;
        const anchorY = Number.isFinite(anchorObj && anchorObj.y) ? Number(anchorObj.y) : 0.5;
        return {
            fileName: selectedFile,
            imagePath,
            width,
            height,
            radius,
            anchorX,
            anchorY
        };
    }

    function getSelectedPowerupPlacementScale(wizardRef) {
        if (!wizardRef) return POWERUP_PLACEMENT_SCALE_DEFAULT;
        const scale = clampPowerupPlacementScale(wizardRef.selectedPowerupPlacementScale);
        wizardRef.selectedPowerupPlacementScale = scale;
        return scale;
    }

    function adjustPowerupPlacementScale(wizardRef, delta) {
        if (!wizardRef || !Number.isFinite(delta) || delta === 0) return null;
        const current = getSelectedPowerupPlacementScale(wizardRef);
        const next = clampPowerupPlacementScale(current + delta);
        wizardRef.selectedPowerupPlacementScale = next;
        return next;
    }

    function clampAnimalSizeScale(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return 1;
        return Math.max(0.25, Math.min(4, n));
    }

    function getSelectedAnimalSizeScale(wizardRef) {
        if (!wizardRef) return 1;
        const scale = clampAnimalSizeScale(wizardRef.selectedAnimalSizeScale);
        wizardRef.selectedAnimalSizeScale = scale;
        return scale;
    }

    function syncAnimalSizeControls(wizardRef) {
        if (!wizardRef) return;
        const scale = getSelectedAnimalSizeScale(wizardRef);
        const sliderValue = (typeof SpawnAnimal !== "undefined" && typeof SpawnAnimal.scaleToSlider === "function")
            ? SpawnAnimal.scaleToSlider(scale)
            : ((scale - 0.25) / (4 - 0.25));
        const $sizeSlider = $("#animalSizeSlider");
        if ($sizeSlider.length > 0) {
            $sizeSlider.val(String(sliderValue));
        }
        const $sizeLabel = $("#animalSizeLabel");
        if ($sizeLabel.length > 0) {
            $sizeLabel.text(`Size: ${Math.round(scale * 100)}%`);
        }
    }

    function adjustAnimalSizeScale(wizardRef, delta) {
        if (!wizardRef || !Number.isFinite(delta) || delta === 0) return null;
        const currentScale = getSelectedAnimalSizeScale(wizardRef);
        const currentSlider = (typeof SpawnAnimal !== "undefined" && typeof SpawnAnimal.scaleToSlider === "function")
            ? SpawnAnimal.scaleToSlider(currentScale)
            : ((currentScale - 0.25) / (4 - 0.25));
        const nextSlider = Math.max(0, Math.min(1, currentSlider + delta));
        const nextScale = (typeof SpawnAnimal !== "undefined" && typeof SpawnAnimal.sliderToScale === "function")
            ? SpawnAnimal.sliderToScale(nextSlider)
            : clampAnimalSizeScale(0.25 + nextSlider * (4 - 0.25));
        wizardRef.selectedAnimalSizeScale = clampAnimalSizeScale(nextScale);
        syncAnimalSizeControls(wizardRef);
        return wizardRef.selectedAnimalSizeScale;
    }

    const TREE_GROW_SIZE_MIN = 0.5;
    const TREE_GROW_SIZE_MAX = 20;
    const TREE_GROW_SIZE_DEFAULT = 4;
    const TREE_GROW_SIZE_SCROLL_SPEED = 10;
    const TREE_GROW_RANDOM_SIZE_MIN = 1;
    const TREE_GROW_RANDOM_SIZE_MAX = 7;
    const TREE_GROW_RANDOM_SIZE_MEAN = 4;
    const TREE_GROW_SIZE_SLIDER_STEP = 0.05;

    function getSelectedTreeGrowSize(wizardRef) {
        if (!wizardRef) return TREE_GROW_SIZE_DEFAULT;
        const n = Number(wizardRef.treeGrowPlacementSize);
        if (!Number.isFinite(n) || n <= 0) {
            wizardRef.treeGrowPlacementSize = TREE_GROW_SIZE_DEFAULT;
            return TREE_GROW_SIZE_DEFAULT;
        }
        return Math.max(TREE_GROW_SIZE_MIN, Math.min(TREE_GROW_SIZE_MAX, n));
    }

    function adjustTreeGrowSize(wizardRef, delta) {
        if (!wizardRef || !Number.isFinite(delta) || delta === 0) return null;
        const current = getSelectedTreeGrowSize(wizardRef);
        const next = Math.max(TREE_GROW_SIZE_MIN, Math.min(TREE_GROW_SIZE_MAX, current + delta * TREE_GROW_SIZE_SCROLL_SPEED));
        wizardRef.treeGrowPlacementSize = Math.round(next * 100) / 100;
        return wizardRef.treeGrowPlacementSize;
    }

    function isTreeGrowRandomSizeEnabled(wizardRef) {
        return !!(wizardRef && wizardRef.treeGrowRandomSizeMode === true);
    }

    function clearTreePlacementPreviewSize(wizardRef) {
        if (!wizardRef) return;
        wizardRef.treeGrowPreviewSize = undefined;
    }

    function sampleRandomTreePlacementSize() {
        let total = 0;
        const samples = 6;
        for (let i = 0; i < samples; i++) {
            total += Math.random();
        }
        const normalized = total / samples;
        const size = TREE_GROW_RANDOM_SIZE_MIN + normalized * (TREE_GROW_RANDOM_SIZE_MAX - TREE_GROW_RANDOM_SIZE_MIN);
        return Math.round(size * 100) / 100;
    }

    function resolveTreePlacementSize(wizardRef, options = null) {
        const fixedSize = getSelectedTreeGrowSize(wizardRef);
        if (!wizardRef || !isTreeGrowRandomSizeEnabled(wizardRef)) {
            clearTreePlacementPreviewSize(wizardRef);
            return fixedSize;
        }
        const forceNew = !!(options && options.forceNew === true);
        const lockedSize = Number(wizardRef.treeGrowPreviewSize);
        if (!forceNew && Number.isFinite(lockedSize) && lockedSize > 0) {
            return Math.max(TREE_GROW_RANDOM_SIZE_MIN, Math.min(TREE_GROW_RANDOM_SIZE_MAX, lockedSize));
        }
        const sampledSize = sampleRandomTreePlacementSize();
        wizardRef.treeGrowPreviewSize = sampledSize;
        return sampledSize;
    }

    function syncTreeGrowSizeControls(wizardRef) {
        const size = getSelectedTreeGrowSize(wizardRef);
        const randomEnabled = isTreeGrowRandomSizeEnabled(wizardRef);
        const $sizeSlider = $("#treeGrowSizeSlider");
        if ($sizeSlider.length > 0) {
            $sizeSlider.val(String(size));
        }
        const $sizeLabel = $("#treeGrowSizeLabel");
        if ($sizeLabel.length > 0) {
            if (randomEnabled) {
                $sizeLabel.text(`Size: random bell curve around ${TREE_GROW_RANDOM_SIZE_MEAN} (${TREE_GROW_RANDOM_SIZE_MIN}-${TREE_GROW_RANDOM_SIZE_MAX})`);
            } else {
                $sizeLabel.text(`Size: ${size.toFixed(2)}`);
            }
        }
        const $randomToggle = $("#treeGrowRandomSizeToggle");
        if ($randomToggle.length > 0) {
            $randomToggle.toggleClass("selected", randomEnabled);
            $randomToggle.attr("aria-pressed", randomEnabled ? "true" : "false");
        }
    }

    function getPowerupPlacementPreviewConfig(wizardRef) {
        const base = getPowerupPlacementBaseData(wizardRef);
        const scale = getSelectedPowerupPlacementScale(wizardRef);
        return {
            fileName: base.fileName,
            imagePath: base.imagePath,
            width: Math.max(0.01, base.width * scale),
            height: Math.max(0.01, base.height * scale),
            radius: Math.max(0.01, base.radius * scale),
            scale,
            anchorX: Number.isFinite(base.anchorX) ? base.anchorX : 0.5,
            anchorY: Number.isFinite(base.anchorY) ? base.anchorY : 0.5
        };
    }

    function adjustPlaceableRotation(wizardRef, deltaDegrees) {
        if (!wizardRef || !Number.isFinite(deltaDegrees) || deltaDegrees === 0) return null;
        normalizePlaceableSelections(wizardRef);
        const axisRaw = (typeof wizardRef.selectedPlaceableRotationAxis === "string")
            ? wizardRef.selectedPlaceableRotationAxis.trim().toLowerCase()
            : "";
        const texturePath = (typeof wizardRef.selectedPlaceableTexturePath === "string" && wizardRef.selectedPlaceableTexturePath.length > 0)
            ? wizardRef.selectedPlaceableTexturePath
            : DEFAULT_PLACEABLE_BY_CATEGORY[DEFAULT_PLACEABLE_CATEGORY];
        if (axisRaw === "none") {
            wizardRef.selectedPlaceableRotation = 0;
            if (!wizardRef.selectedPlaceableRotationByTexture || typeof wizardRef.selectedPlaceableRotationByTexture !== "object") {
                wizardRef.selectedPlaceableRotationByTexture = {};
            }
            wizardRef.selectedPlaceableRotationByTexture[texturePath] = 0;
            return 0;
        }
        const current = Number.isFinite(wizardRef.selectedPlaceableRotation)
            ? Number(wizardRef.selectedPlaceableRotation)
            : 0;
        let next = current + Number(deltaDegrees);
        next = ((next % 360) + 360) % 360;
        if (next > 180) next -= 360;
        const snapped = Math.round(next / PLACEABLE_ROTATION_STEP_DEGREES) * PLACEABLE_ROTATION_STEP_DEGREES;
        wizardRef.selectedPlaceableRotation = snapped;
        if (!wizardRef.selectedPlaceableRotationByTexture || typeof wizardRef.selectedPlaceableRotationByTexture !== "object") {
            wizardRef.selectedPlaceableRotationByTexture = {};
        }
        wizardRef.selectedPlaceableRotationByTexture[texturePath] = snapped;
        return snapped;
    }

    function getPlaceableImageList(category) {
        if (!placeableImagePathsByCategory || !category) return [];
        const list = placeableImagePathsByCategory[category];
        return Array.isArray(list) ? list.slice() : [];
    }

    function getSelectedPlaceableCategory(wizardRef) {
        normalizePlaceableSelections(wizardRef);
        return wizardRef && typeof wizardRef.selectedPlaceableCategory === "string"
            ? wizardRef.selectedPlaceableCategory
            : DEFAULT_PLACEABLE_CATEGORY;
    }

    function setSelectedPlaceableCategory(wizardRef, category) {
        if (!wizardRef || !PLACEABLE_CATEGORIES.includes(category)) return;
        normalizePlaceableSelections(wizardRef);
        wizardRef.selectedPlaceableCategory = category;
        const selectedForCategory = wizardRef.selectedPlaceableByCategory[category];
        wizardRef.selectedPlaceableTexturePath = (typeof selectedForCategory === "string" && selectedForCategory.length > 0)
            ? selectedForCategory
            : DEFAULT_PLACEABLE_BY_CATEGORY[category];
        normalizePlaceableSelections(wizardRef);
    }

    function getSelectedPlaceableTextureForCategory(wizardRef, category) {
        normalizePlaceableSelections(wizardRef);
        if (!wizardRef || !PLACEABLE_CATEGORIES.includes(category)) return DEFAULT_PLACEABLE_BY_CATEGORY[DEFAULT_PLACEABLE_CATEGORY];
        const selected = wizardRef.selectedPlaceableByCategory[category];
        if (typeof selected === "string" && selected.length > 0) return selected;
        return DEFAULT_PLACEABLE_BY_CATEGORY[category];
    }

    function getSelectedPlaceableTexture(wizardRef) {
        const category = getSelectedPlaceableCategory(wizardRef);
        return getSelectedPlaceableTextureForCategory(wizardRef, category);
    }

    function applyCompositeLayersToThumbnail($icon, category, texturePath) {
        if (typeof globalThis.getResolvedPlaceableMetadata === "function") {
            globalThis.getResolvedPlaceableMetadata(category, texturePath).then(meta => {
                if (!meta) return;
                $icon.empty(); // Clear any existing sub-layers
                if (Array.isArray(meta.compositeLayers) && meta.compositeLayers.length >= 2) {
                    $icon.css({ "background-image": "none", "position": "relative", "overflow": "hidden" });
                    meta.compositeLayers.forEach(layer => {
                        if (!layer) return;
                        const uRegion = (Array.isArray(layer.uRegion) && layer.uRegion.length >= 2)
                            ? [Number(layer.uRegion[0]) || 0, Number(layer.uRegion[1]) || 1]
                            : [0, 1];
                        const u0 = uRegion[0];
                        const u1 = uRegion[1];
                        const fWidth = Math.max(0.0001, u1 - u0);
                        const subLayer = $("<div>").css({
                            "position": "absolute",
                            "top": "0", "left": "0", "width": "100%", "height": "100%",
                            "overflow": "hidden",
                            "pointer-events": "none"
                        });
                        const innerImg = $("<img>").attr("src", texturePath).css({
                            "position": "absolute",
                            "top": "0",
                            "left": `-${(u0 / fWidth) * 100}%`,
                            "width": `${100 / fWidth}%`,
                            "height": "100%",
                            "pointer-events": "none"
                        });
                        subLayer.append(innerImg);
                        $icon.append(subLayer);
                    });
                } else {
                    const fcX = Number.isFinite(meta.framecount_x) ? meta.framecount_x : (Number.isFinite(meta.frameCountX) ? meta.frameCountX : (meta.framecount && meta.framecount.x ? meta.framecount.x : 1));
                    if (fcX > 1) {
                        $icon.css({
                            "background-size": `${fcX * 100}% 100%`,
                            "background-position": "0 0"
                        });
                    }
                }
            });
        }
    }

    function isEditorSpellName(spellName) {
        return spellName === "placeobject" || spellName === "blackdiamond";
    }

    function canUseEditorFeatures(wizardRef) {
        if (!wizardRef) return false;
        if (typeof wizardRef.isGodMode === "function") {
            return !!wizardRef.isGodMode();
        }
        return true;
    }

    function ignoresMagicCosts(wizardRef) {
        return !!(
            globalThis.Spell &&
            typeof globalThis.Spell.ignoresMagicCosts === "function" &&
            globalThis.Spell.ignoresMagicCosts(wizardRef)
        );
    }

    function canAffordMagicCost(wizardRef, cost) {
        if (globalThis.Spell && typeof globalThis.Spell.canAffordMagicCost === "function") {
            return globalThis.Spell.canAffordMagicCost(cost, wizardRef);
        }
        const normalizedCost = Number.isFinite(cost) ? Math.max(0, Number(cost)) : 0;
        if (normalizedCost <= 0) return true;
        if (ignoresMagicCosts(wizardRef)) return true;
        const currentMagic = Number.isFinite(wizardRef?.magic) ? wizardRef.magic : 0;
        return currentMagic >= normalizedCost;
    }

    function spendMagicCost(wizardRef, cost) {
        if (globalThis.Spell && typeof globalThis.Spell.spendMagicCost === "function") {
            return globalThis.Spell.spendMagicCost(cost, wizardRef);
        }
        const normalizedCost = Number.isFinite(cost) ? Math.max(0, Number(cost)) : 0;
        if (normalizedCost <= 0) return true;
        if (!wizardRef) return false;
        if (ignoresMagicCosts(wizardRef)) return true;
        const currentMagic = Number.isFinite(wizardRef.magic) ? wizardRef.magic : 0;
        if (currentMagic < normalizedCost) return false;
        wizardRef.magic = Math.max(0, currentMagic - normalizedCost);
        return true;
    }

    function isEditorToolName(spellName) {
        return spellName === "wall" || spellName === "buildroad" || spellName === "flooredit" || isFloorEditorToolName(spellName) || spellName === "moveobject" || spellName === "editorvanish" || spellName === "placeobject" || spellName === "blackdiamond" || spellName === "nodeinspector";
    }

    function isFloorEditorToolName(spellName) {
        return FLOOR_EDIT_TOOL_DEFS.some(tool => tool.name === spellName);
    }

    function isMoveObjectToolName(spellName) {
        return spellName === "moveobject";
    }

    function isVanishToolName(spellName) {
        return spellName === "vanish" || spellName === "editorvanish";
    }

    function isEditorMode() {
        return !!editorMode;
    }

    function setEditorMode(active, wizardRef) {
        const next = !!active && canUseEditorFeatures(wizardRef);
        if (editorMode === next) return next;
        editorMode = next;
        if (wizardRef) {
            wizardRef.editorMode = next;
            if (!next) {
                wizardRef.showEditorPanel = false;
            }
        }
        // Rebuild the spell menu to add/remove editor options
        spellMenuMode = "main";
        if (wizardRef) {
            refreshSpellSelector(wizardRef);
        }
        return editorMode;
    }

    function toggleEditorMode(wizardRef) {
        if (!canUseEditorFeatures(wizardRef)) return false;
        return setEditorMode(!editorMode, wizardRef);
    }

    function getSelectedSpellName(wizardRef) {
        if (!wizardRef) return "";
        const spellList = (Array.isArray(wizardRef.spells) && wizardRef.spells.length > 0)
            ? wizardRef.spells
            : buildSpellList(wizardRef);
        const availableSpellNames = spellList
            .map(spell => (spell && typeof spell.name === "string") ? spell.name : null)
            .filter(Boolean);
        const selected = (typeof wizardRef.selectedSpellName === "string") ? wizardRef.selectedSpellName : "";
        if (selected && availableSpellNames.includes(selected) && !isEditorSpellName(selected)) {
            return selected;
        }
        const current = (typeof wizardRef.currentSpell === "string") ? wizardRef.currentSpell : "";
        if (current && availableSpellNames.includes(current) && !isEditorSpellName(current)) {
            return current;
        }
        return availableSpellNames[0] || "";
    }

    function getSelectedEditorCategory(wizardRef) {
        if (!wizardRef) return DEFAULT_PLACEABLE_CATEGORY;
        const raw = (typeof wizardRef.selectedEditorCategory === "string")
            ? wizardRef.selectedEditorCategory.trim().toLowerCase()
            : "";
        if (EDITOR_CATEGORIES.includes(raw)) return raw;
        if (wizardRef.currentSpell === "blackdiamond") return "powerups";
        const placeableCategory = getSelectedPlaceableCategory(wizardRef);
        return EDITOR_PLACEABLE_CATEGORIES.includes(placeableCategory)
            ? placeableCategory
            : DEFAULT_PLACEABLE_CATEGORY;
    }

    function normalizeSelectedEditorCategory(wizardRef) {
        if (!wizardRef) return DEFAULT_PLACEABLE_CATEGORY;
        const normalized = getSelectedEditorCategory(wizardRef);
        wizardRef.selectedEditorCategory = normalized;
        return normalized;
    }

    function getSelectedEditorIcon(wizardRef) {
        // If current spell is an editor tool (wall/road/vanish), show that tool's icon
        if (wizardRef && wizardRef.currentSpell === "wall") {
            return getWallSpellIcon(wizardRef);
        }
        if (wizardRef && wizardRef.currentSpell === "buildroad") {
            return getRoadSpellIcon(wizardRef);
        }
        if (wizardRef && wizardRef.currentSpell === "flooredit") {
            return "/assets/images/thumbnails/layers.png";
        }
        const floorTool = wizardRef ? FLOOR_EDIT_TOOL_DEFS.find(tool => tool.name === wizardRef.currentSpell) : null;
        if (floorTool) {
            return floorTool.icon;
        }
        if (wizardRef && wizardRef.currentSpell === "moveobject" && editorMode) {
            return "/assets/images/thumbnails/move.png";
        }
        if (wizardRef && wizardRef.currentSpell === "editorvanish" && editorMode) {
            return "/assets/images/thumbnails/vanish.png";
        }
        const category = normalizeSelectedEditorCategory(wizardRef);
        if (category === "powerups") {
            const preview = getPowerupPlacementPreviewConfig(wizardRef);
            if (preview && typeof preview.imagePath === "string" && preview.imagePath.length > 0) {
                return preview.imagePath;
            }
            return POWERUP_PLACEMENT_IMAGE_PATH;
        }
        return getSelectedPlaceableTextureForCategory(wizardRef, category);
    }

    function getPowerupEditorCategoryIcon(wizardRef) {
        const preview = getPowerupPlacementPreviewConfig(wizardRef);
        if (preview && typeof preview.imagePath === "string" && preview.imagePath.length > 0) {
            return preview.imagePath;
        }
        return POWERUP_PLACEMENT_IMAGE_PATH;
    }

    function fetchPlaceableImages(options = {}) {
        const forceRefresh = !!(options && options.forceRefresh);
        if (forceRefresh) {
            placeableImagePathsByCategory = null;
        }
        if (!forceRefresh && placeableImagePathsByCategory && typeof placeableImagePathsByCategory === "object") {
            return Promise.resolve(placeableImagePathsByCategory);
        }
        if (!forceRefresh && placeableImageFetchPromise) {
            return placeableImageFetchPromise;
        }
        placeableImageFetchPromise = fetch("/api/placeables", { cache: "no-cache" })
            .then(response => response.json())
            .then(payload => {
                const next = {};
                PLACEABLE_CATEGORIES.forEach(category => {
                    const listedRaw = payload && payload.ok && payload.categories && Array.isArray(payload.categories[category])
                        ? payload.categories[category]
                        : (
                            category === "roof" &&
                            payload &&
                            payload.ok &&
                            payload.categories &&
                            Array.isArray(payload.categories.roofs)
                        )
                            ? payload.categories.roofs
                            : [];
                    const listed = (category === "roof")
                        ? listedRaw.map(path => {
                            if (typeof path !== "string") return DEFAULT_ROOF_TEXTURE;
                            if (path.startsWith("/assets/images/roof/")) {
                                return path.replace("/assets/images/roof/", "/assets/images/roofs/");
                            }
                            if (path === ROOF_EDITOR_ICON) return DEFAULT_ROOF_TEXTURE;
                            return path;
                        })
                        : listedRaw;
                    next[category] = listed.length > 0 ? listed : [DEFAULT_PLACEABLE_BY_CATEGORY[category]];
                });
                placeableImagePathsByCategory = next;
                return placeableImagePathsByCategory;
            })
            .catch(() => {
                const fallback = {};
                PLACEABLE_CATEGORIES.forEach(category => {
                    fallback[category] = [DEFAULT_PLACEABLE_BY_CATEGORY[category]];
                });
                placeableImagePathsByCategory = fallback;
                return placeableImagePathsByCategory;
            })
            .finally(() => {
                placeableImageFetchPromise = null;
            });
        return placeableImageFetchPromise;
    }

    function quantizeToStep(value, min, max, step) {
        const v = Number(value);
        const clamped = Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
        const snapped = Math.round((clamped - min) / step) * step + min;
        const precision = Math.max(0, (String(step).split(".")[1] || "").length);
        return Number(snapped.toFixed(precision));
    }

    function getSelectedWallHeight(wizardRef) {
        if (!wizardRef) return 3.0;
        wizardRef.selectedWallHeight = quantizeToStep(
            wizardRef.selectedWallHeight,
            WALL_HEIGHT_MIN,
            WALL_HEIGHT_MAX,
            WALL_HEIGHT_STEP
        );
        return wizardRef.selectedWallHeight;
    }

    function getSelectedWallThickness(wizardRef) {
        if (!wizardRef) return 0.2;
        wizardRef.selectedWallThickness = quantizeToStep(
            wizardRef.selectedWallThickness,
            WALL_THICKNESS_MIN,
            WALL_THICKNESS_MAX,
            WALL_THICKNESS_STEP
        );
        return wizardRef.selectedWallThickness;
    }

    function getSelectedWallTexture(wizardRef) {
        if (!wizardRef) return DEFAULT_WALL_TEXTURE;
        const current = (typeof wizardRef.selectedWallTexture === "string" && wizardRef.selectedWallTexture.length > 0)
            ? wizardRef.selectedWallTexture
            : DEFAULT_WALL_TEXTURE;
        wizardRef.selectedWallTexture = current;
        return current;
    }

    function getSelectedRoadWidth(wizardRef) {
        if (!wizardRef) return ROAD_WIDTH_DEFAULT;
        wizardRef.selectedRoadWidth = quantizeToStep(
            wizardRef.selectedRoadWidth,
            ROAD_WIDTH_MIN,
            ROAD_WIDTH_MAX,
            ROAD_WIDTH_STEP
        );
        return wizardRef.selectedRoadWidth;
    }

    function fetchWallTextures() {
        if (wallTexturePaths.length > 0) {
            return Promise.resolve(wallTexturePaths);
        }
        if (wallTextureFetchPromise) {
            return wallTextureFetchPromise;
        }
        wallTextureFetchPromise = fetch("/api/placeables")
            .then(response => response.json())
            .then(payload => {
                const listed = (
                    payload &&
                    payload.ok &&
                    payload.categories &&
                    Array.isArray(payload.categories.walls)
                ) ? payload.categories.walls : [];
                const filtered = listed.filter(path =>
                    typeof path === "string" &&
                    path.length > 0 &&
                    /\.(png|jpg|jpeg|webp|gif)(?:[?#].*)?$/i.test(path)
                );
                wallTexturePaths = (filtered.length > 0) ? filtered : [DEFAULT_WALL_TEXTURE];
                return wallTexturePaths;
            })
            .catch(() => {
                wallTexturePaths = [DEFAULT_WALL_TEXTURE];
                return wallTexturePaths;
            })
            .finally(() => {
                wallTextureFetchPromise = null;
            });
        return wallTextureFetchPromise;
    }

    function getSelectedRoofOverhang(wizardRef) {
        if (!wizardRef) return ROOF_OVERHANG_DEFAULT;
        wizardRef.selectedRoofOverhang = quantizeToStep(
            wizardRef.selectedRoofOverhang,
            ROOF_OVERHANG_MIN,
            ROOF_OVERHANG_MAX,
            ROOF_OVERHANG_STEP
        );
        return wizardRef.selectedRoofOverhang;
    }

    function getSelectedRoofPeakHeight(wizardRef) {
        if (!wizardRef) return ROOF_PEAK_HEIGHT_DEFAULT;
        wizardRef.selectedRoofPeakHeight = quantizeToStep(
            wizardRef.selectedRoofPeakHeight,
            ROOF_PEAK_HEIGHT_MIN,
            ROOF_PEAK_HEIGHT_MAX,
            ROOF_PEAK_HEIGHT_STEP
        );
        return wizardRef.selectedRoofPeakHeight;
    }

    function getSelectedRoofTextureRepeat(wizardRef) {
        if (!wizardRef) return ROOF_TEXTURE_REPEAT_DEFAULT;
        wizardRef.selectedRoofTextureRepeat = quantizeToStep(
            wizardRef.selectedRoofTextureRepeat,
            ROOF_TEXTURE_REPEAT_MIN,
            ROOF_TEXTURE_REPEAT_MAX,
            ROOF_TEXTURE_REPEAT_STEP
        );
        return wizardRef.selectedRoofTextureRepeat;
    }

    function fetchFlooringTextures() {
        if (flooringTexturePaths.length > 0) {
            return Promise.resolve(flooringTexturePaths);
        }
        if (flooringTextureFetchPromise) {
            return flooringTextureFetchPromise;
        }
        flooringTextureFetchPromise = fetch("/api/flooring")
            .then(response => response.json())
            .then(payload => {
                if (payload && payload.ok && Array.isArray(payload.files)) {
                    flooringTexturePaths = payload.files;
                } else {
                    flooringTexturePaths = [];
                }
                if (!flooringTexturePaths.includes(DEFAULT_FLOORING_TEXTURE)) {
                    flooringTexturePaths.unshift(DEFAULT_FLOORING_TEXTURE);
                }
                return flooringTexturePaths;
            })
            .catch(() => {
                flooringTexturePaths = [DEFAULT_FLOORING_TEXTURE];
                return flooringTexturePaths;
            })
            .finally(() => {
                flooringTextureFetchPromise = null;
            });
        return flooringTextureFetchPromise;
    }

    function cooldown(wizardRef, delayTime) {
        wizardRef.castDelay = true;
        wizardRef.casting = true;
        setTimeout(() => {
            wizardRef.castDelay = false;
            wizardRef.casting = false;
        }, 1000 * delayTime);
    }

    function stopTreeGrowthChannel(wizardRef, lockUntilRelease = false) {
        if (!wizardRef) return;
        wizardRef.treeGrowthChannel = null;
        wizardRef.treeGrowHoldLocked = !!lockUntilRelease;
    }

    function startTreeGrowthChannel(wizardRef, targetTree, growthPerSecond = 1, magicPerSecond = 30, maxSize = 20) {
        if (!wizardRef || !targetTree || typeof targetTree.applySize !== "function") return false;
        wizardRef.treeGrowHoldLocked = false;
        wizardRef.treeGrowthChannel = {
            targetTree,
            growthPerSecond,
            magicPerSecond,
            maxSize
        };
        return true;
    }

    function tickMagic(wizardRef) {
        const now = performance.now();
        if (!wizardRef) return;
        if (paused) {
            lastMagicTickMs = now;
            return;
        }
        if (!lastMagicTickMs) {
            lastMagicTickMs = now;
            return;
        }
        const dtSec = Math.max(0, (now - lastMagicTickMs) / 1000);
        lastMagicTickMs = now;

        const healingAuraActive = isAuraActive(wizardRef, "healing");
        const hpRegenMultiplier = healingAuraActive ? getHealingAuraHpMultiplier() : 1;
        wizardRef.healRateMultiplier = hpRegenMultiplier;
        let auraDrainPerSecond = getActiveAuraMagicDrainPerSecond(wizardRef);
        if (healingAuraActive) {
            const maxHp = Number.isFinite(wizardRef.maxHp)
                ? Number(wizardRef.maxHp)
                : (Number.isFinite(wizardRef.maxHP) ? Number(wizardRef.maxHP) : null);
            const currentHp = Number.isFinite(wizardRef.hp) ? Number(wizardRef.hp) : null;
            const healingNeedsHp = Number.isFinite(maxHp) && maxHp > 0 && Number.isFinite(currentHp) && currentHp < maxHp;
            if (!healingNeedsHp) {
                const healingDrainPerSecond = getAuraMagicDrainPerSecond("healing");
                auraDrainPerSecond = Math.max(0, auraDrainPerSecond - healingDrainPerSecond);
            }
        }
        if (isAuraActive(wizardRef, "speed")) {
            const movementVector = (wizardRef.movementVector && typeof wizardRef.movementVector === "object")
                ? wizardRef.movementVector
                : null;
            const movementSpeed = movementVector ? Math.hypot(Number(movementVector.x) || 0, Number(movementVector.y) || 0) : 0;
            const isActuallyMoving = !!wizardRef.moving || movementSpeed > 0.001;
            if (!isActuallyMoving) {
                const speedAura = getAuraDefinition("speed");
                const speedDrainPerSecond = Number.isFinite(speedAura?.magicPerSecond)
                    ? Math.max(0, Number(speedAura.magicPerSecond))
                    : 0;
                auraDrainPerSecond = Math.max(0, auraDrainPerSecond - speedDrainPerSecond);
            }
        }
        const auraActive = auraDrainPerSecond > 0;
        const magicRegenPerSecond = Number.isFinite(wizardRef.magicRegenPerSecond)
            ? Math.max(0, wizardRef.magicRegenPerSecond)
            : 0;
        if (wizardRef.magic < wizardRef.maxMagic) {
            wizardRef.magic = Math.min(wizardRef.maxMagic, wizardRef.magic + magicRegenPerSecond * dtSec);
        }
        if (auraActive) {
            const auraCost = auraDrainPerSecond * dtSec;
            if (!canAffordMagicCost(wizardRef, auraCost)) {
                setActiveAuras(wizardRef, []);
            } else {
                spendMagicCost(wizardRef, auraCost);
            }
        }

        const channel = wizardRef.treeGrowthChannel;
        if (!channel) return;

        if (!keysPressed[" "]) {
            stopTreeGrowthChannel(wizardRef, false);
            return;
        }
        if (!channel.targetTree || channel.targetTree.gone || typeof channel.targetTree.applySize !== "function") {
            stopTreeGrowthChannel(wizardRef, false);
            return;
        }

        const currentSize = Number(channel.targetTree.size) || 4;
        if (currentSize >= channel.maxSize - 0.0001) {
            channel.targetTree.applySize(channel.maxSize);
            stopTreeGrowthChannel(wizardRef, true);
            return;
        }

        const magicCost = channel.magicPerSecond * dtSec;
        if (!canAffordMagicCost(wizardRef, magicCost)) {
            stopTreeGrowthChannel(wizardRef, false);
            return;
        }

        spendMagicCost(wizardRef, magicCost);
        const nextSize = Math.min(channel.maxSize, currentSize + channel.growthPerSecond * dtSec);
        channel.targetTree.applySize(nextSize);
        if (nextSize >= channel.maxSize - 0.0001) {
            stopTreeGrowthChannel(wizardRef, true);
        }
    }

    function startMagicInterval(wizardRef) {
        stopMagicInterval();
        lastMagicTickMs = performance.now();
        magicIntervalId = setInterval(() => tickMagic(wizardRef), MAGIC_TICK_MS);
    }

    function stopMagicInterval() {
        if (magicIntervalId) {
            clearInterval(magicIntervalId);
            magicIntervalId = null;
        }
        lastMagicTickMs = 0;
    }

    function ensureDragPreview(wizardRef, spellName) {
        if (!wizardRef) return null;
        if (spellName === "wall") {
            if (!wizardRef.phantomWall) {
                wizardRef.phantomWall = new PIXI.Graphics();
                wizardRef.phantomWall.skipTransform = true;
                objectLayer.addChild(wizardRef.phantomWall);
            }
            return wizardRef.phantomWall;
        }
        if (spellName === "buildroad") {
            if (!wizardRef.phantomRoad) {
                wizardRef.phantomRoad = new PIXI.Container();
                wizardRef.phantomRoad.skipTransform = true;
                objectLayer.addChild(wizardRef.phantomRoad);
            }
            return wizardRef.phantomRoad;
        }
        if (spellName === "firewall") {
            if (!wizardRef.phantomFirewall) {
                wizardRef.phantomFirewall = new PIXI.Graphics();
                wizardRef.phantomFirewall.skipTransform = true;
                objectLayer.addChild(wizardRef.phantomFirewall);
            }
            return wizardRef.phantomFirewall;
        }
        return null;
    }

    function clearDragPreview(wizardRef, spellName) {
        if (!wizardRef) return;
        if (spellName === "wall" && wizardRef.phantomWall) {
            objectLayer.removeChild(wizardRef.phantomWall);
            wizardRef.phantomWall = null;
            return;
        }
        if (spellName === "buildroad" && wizardRef.phantomRoad) {
            objectLayer.removeChild(wizardRef.phantomRoad);
            wizardRef.phantomRoad = null;
            return;
        }
        if (spellName === "firewall" && wizardRef.phantomFirewall) {
            objectLayer.removeChild(wizardRef.phantomFirewall);
            wizardRef.phantomFirewall.destroy();
            wizardRef.phantomFirewall = null;
        }
    }

    function isDragSpellActive(wizardRef, spellName) {
        if (!wizardRef) return false;
        if (spellName === "wall") return !!wizardRef.wallLayoutMode && !!wizardRef.wallStartPoint;
        if (spellName === "buildroad") return !!wizardRef.roadLayoutMode && !!wizardRef.roadStartPoint;
        if (spellName === "firewall") return !!wizardRef.firewallLayoutMode && !!wizardRef.firewallStartPoint;
        if (isMoveObjectToolName(spellName)) return !!(wizardRef.moveObjectDragState && wizardRef.moveObjectDragState.target);
        if (isVanishToolName(spellName)) return !!wizardRef.vanishDragMode;
        return false;
    }

    function cancelDragSpell(wizardRef, spellName) {
        if (!wizardRef) return;
        if (spellName === "wall") {
            wizardRef.wallLayoutMode = false;
            wizardRef.wallStartPoint = null;
            wizardRef.wallStartReferenceWall = null;
            wizardRef.wallStartSplitReference = null;
            wizardRef.wallDragMouseStartWorld = null;
            wizardRef.wallStartFromExistingWall = false;
            wizardRef.wallPreviewPlacement = null;
            clearDragPreview(wizardRef, "wall");
            return;
        }
        if (spellName === "buildroad") {
            wizardRef.roadLayoutMode = false;
            wizardRef.roadStartPoint = null;
            clearDragPreview(wizardRef, "buildroad");
            return;
        }
        if (spellName === "firewall") {
            wizardRef.firewallLayoutMode = false;
            wizardRef.firewallStartPoint = null;
            clearDragPreview(wizardRef, "firewall");
            return;
        }
        if (isMoveObjectToolName(spellName)) {
            wizardRef.moveObjectDragState = null;
            return;
        }
        if (isVanishToolName(spellName)) {
            wizardRef.vanishDragMode = false;
            resetVanishDragTargetingState(wizardRef);
            // Note: do NOT clear _pendingVanishWallBurst here — the
            // pending burst must survive between the two clicks of a
            // double-click (space is released and re-pressed between
            // them).
        }
    }

    function getDragSpellObjectType(spellName) {
        if (spellName === "wall") return "wallSection";
        if (spellName === "buildroad") return "road";
        if (spellName === "firewall") return "firewall";
        return null;
    }

    function wrapWorldPointForMap(mapRef, x, y) {
        let outX = Number(x);
        let outY = Number(y);
        if (mapRef && typeof mapRef.wrapWorldX === "function") outX = mapRef.wrapWorldX(outX);
        if (mapRef && typeof mapRef.wrapWorldY === "function") outY = mapRef.wrapWorldY(outY);
        return { x: outX, y: outY };
    }

    function projectWallDragPointFromMouseDelta(wizardRef, wrappedCurrentPoint) {
        if (!wizardRef || !wrappedCurrentPoint) return null;
        const mapRef = wizardRef.map || null;
        const startAnchor = wizardRef.wallStartPoint;
        const dragMouseStart = wizardRef.wallDragMouseStartWorld;
        if (
            !startAnchor ||
            !dragMouseStart ||
            !Number.isFinite(dragMouseStart.x) ||
            !Number.isFinite(dragMouseStart.y)
        ) {
            return wrappedCurrentPoint;
        }
        const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(dragMouseStart.x, wrappedCurrentPoint.x)
            : (wrappedCurrentPoint.x - dragMouseStart.x);
        const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(dragMouseStart.y, wrappedCurrentPoint.y)
            : (wrappedCurrentPoint.y - dragMouseStart.y);
        return wrapWorldPointForMap(
            mapRef,
            Number(startAnchor.x) + dx,
            Number(startAnchor.y) + dy
        );
    }

    function snapProjectedWallDragPoint(wizardRef, projectedPoint) {
        if (!wizardRef || !projectedPoint) return null;
        const mapRef = wizardRef.map || null;
        const snapTarget = getDragStartSnapTargetAt(wizardRef, "wall", projectedPoint.x, projectedPoint.y);
        if (snapTarget && snapTarget.point) {
            return { x: Number(snapTarget.point.x), y: Number(snapTarget.point.y) };
        }
        if (!mapRef) return projectedPoint;
        const fallbackAnchor = (typeof mapRef.worldToNodeOrMidpoint === "function")
            ? mapRef.worldToNodeOrMidpoint(projectedPoint.x, projectedPoint.y)
            : (typeof mapRef.worldToNode === "function" ? mapRef.worldToNode(projectedPoint.x, projectedPoint.y) : null);
        if (fallbackAnchor && Number.isFinite(fallbackAnchor.x) && Number.isFinite(fallbackAnchor.y)) {
            return { x: Number(fallbackAnchor.x), y: Number(fallbackAnchor.y) };
        }
        return projectedPoint;
    }

    function getAdjustedWallDragWorldPoint(wizardRef, worldX, worldY) {
        if (!wizardRef || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const mapRef = wizardRef.map || null;
        const wrappedCurrentPoint = wrapWorldPointForMap(mapRef, worldX, worldY);
        if (
            wizardRef.wallLayoutMode &&
            wizardRef.currentSpell === "wall"
        ) {
            const projected = projectWallDragPointFromMouseDelta(wizardRef, wrappedCurrentPoint);
            return projected || wrappedCurrentPoint;
        }
        return wrappedCurrentPoint;
    }

    function getActiveWallPlacementLayer(wizardRef) {
        if (wizardRef && Number.isFinite(wizardRef.currentLayer)) {
            return Math.round(Number(wizardRef.currentLayer));
        }
        return getSelectedFloorEditLevel(wizardRef);
    }

    function getWallPlacementBaseZ(wizardRef, layer) {
        const normalizedLayer = Number.isFinite(layer) ? Math.round(Number(layer)) : 0;
        if (
            wizardRef &&
            Number.isFinite(wizardRef.currentLayer) &&
            Math.round(Number(wizardRef.currentLayer)) === normalizedLayer &&
            Number.isFinite(wizardRef.currentLayerBaseZ)
        ) {
            return Number(wizardRef.currentLayerBaseZ);
        }
        return normalizedLayer * 3;
    }

    function getWallLikeTraversalLayer(target, fallback = 0) {
        if (!target) return Math.round(Number(fallback) || 0);
        if (Number.isFinite(target.traversalLayer)) return Math.round(Number(target.traversalLayer));
        if (Number.isFinite(target.level)) return Math.round(Number(target.level));
        if (Number.isFinite(target.bottomZ)) return Math.round(Number(target.bottomZ) / 3);
        return Math.round(Number(fallback) || 0);
    }

    function isWallTargetOnActivePlacementLayer(wizardRef, target) {
        if (!target || target.type !== "wallSection") return true;
        return getWallLikeTraversalLayer(target, 0) === getActiveWallPlacementLayer(wizardRef);
    }

    function isPointInWallLayerPolygon(point, polygon) {
        if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
        const x = Number(point.x);
        const y = Number(point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const pi = polygon[i] || {};
            const pj = polygon[j] || {};
            const xi = Number(pi.x);
            const yi = Number(pi.y);
            const xj = Number(pj.x);
            const yj = Number(pj.y);
            if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) continue;
            const crosses = ((yi > y) !== (yj > y))
                && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-7) + xi);
            if (crosses) inside = !inside;
        }
        return inside;
    }

    function getWallLayerFloorFragments(mapRef, layer) {
        const normalizedLayer = Number.isFinite(layer) ? Math.round(Number(layer)) : 0;
        const fragments = [];
        const seen = new Set();
        const pushFragment = (fragment) => {
            if (!fragment || typeof fragment !== "object") return;
            const fragmentLayer = Number.isFinite(fragment.level)
                ? Math.round(Number(fragment.level))
                : (Number.isFinite(fragment.traversalLayer) ? Math.round(Number(fragment.traversalLayer)) : 0);
            if (fragmentLayer !== normalizedLayer) return;
            const outer = Array.isArray(fragment.outerPolygon) ? fragment.outerPolygon : [];
            if (outer.length < 3) return;
            const id = (typeof fragment.fragmentId === "string" && fragment.fragmentId.length > 0)
                ? fragment.fragmentId
                : ((typeof fragment.id === "string" && fragment.id.length > 0)
                    ? fragment.id
                    : `${fragments.length}:${outer.length}`);
            if (seen.has(id)) return;
            seen.add(id);
            fragments.push(fragment);
        };

        if (mapRef && mapRef.floorsById instanceof Map) {
            for (const fragment of mapRef.floorsById.values()) {
                pushFragment(fragment);
            }
        }
        if (fragments.length === 0 && mapRef && mapRef._prototypeSectionState && mapRef._prototypeSectionState.sectionAssetsByKey instanceof Map) {
            for (const asset of mapRef._prototypeSectionState.sectionAssetsByKey.values()) {
                const floors = Array.isArray(asset && asset.floors) ? asset.floors : [];
                for (let i = 0; i < floors.length; i++) {
                    pushFragment(floors[i]);
                }
            }
        }
        return fragments;
    }

    function isPointInsideWallLayerFloor(mapRef, point, layer, fragments = null) {
        if (!mapRef || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
        const normalizedLayer = Number.isFinite(layer) ? Math.round(Number(layer)) : 0;
        if (normalizedLayer === 0) return !!(typeof mapRef.worldToNode === "function" && mapRef.worldToNode(point.x, point.y));
        const floorFragments = Array.isArray(fragments) ? fragments : getWallLayerFloorFragments(mapRef, normalizedLayer);
        if (floorFragments.length === 0) return false;
        const wrappedPoint = wrapWorldPointForMap(mapRef, Number(point.x), Number(point.y));
        for (let i = 0; i < floorFragments.length; i++) {
            const fragment = floorFragments[i];
            const outer = Array.isArray(fragment.outerPolygon) ? fragment.outerPolygon : [];
            if (!isPointInWallLayerPolygon(wrappedPoint, outer)) continue;
            const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
            let inHole = false;
            for (let h = 0; h < holes.length; h++) {
                if (isPointInWallLayerPolygon(wrappedPoint, holes[h])) {
                    inHole = true;
                    break;
                }
            }
            if (!inHole) return true;
        }
        return false;
    }

    function doesWallPlacementFitActiveFloorLayer(mapRef, segments, layer) {
        if (!mapRef || !Array.isArray(segments) || segments.length === 0) return false;
        const normalizedLayer = Number.isFinite(layer) ? Math.round(Number(layer)) : 0;
        const fragments = normalizedLayer === 0 ? null : getWallLayerFloorFragments(mapRef, normalizedLayer);
        if (normalizedLayer !== 0 && (!Array.isArray(fragments) || fragments.length === 0)) return false;
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            if (!segment || !segment.start || !segment.end) continue;
            const sx = Number(segment.start.x);
            const sy = Number(segment.start.y);
            const ex = Number(segment.end.x);
            const ey = Number(segment.end.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) return false;
            const dx = (typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(sx, ex) : (ex - sx);
            const dy = (typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(sy, ey) : (ey - sy);
            const length = Math.hypot(dx, dy);
            const sampleCount = Math.max(1, Math.min(256, Math.ceil(length / 0.2)));
            for (let sample = 0; sample <= sampleCount; sample++) {
                const t = sample / sampleCount;
                let px = sx + dx * t;
                let py = sy + dy * t;
                if (typeof mapRef.wrapWorldX === "function") px = mapRef.wrapWorldX(px);
                if (typeof mapRef.wrapWorldY === "function") py = mapRef.wrapWorldY(py);
                if (!isPointInsideWallLayerFloor(mapRef, { x: px, y: py }, normalizedLayer, fragments)) {
                    return false;
                }
            }
        }
        return true;
    }

    function pointsMatchWorld(mapRef, a, b, epsilon = 1e-6) {
        if (!a || !b) return false;
        const ax = Number(a.x);
        const ay = Number(a.y);
        const bx = Number(b.x);
        const by = Number(b.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return false;
        const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(ax, bx)
            : (bx - ax);
        const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(ay, by)
            : (by - ay);
        return Math.abs(dx) <= epsilon && Math.abs(dy) <= epsilon;
    }

    function getSpellTargetHistorySet(wizardRef, spellName) {
        if (!wizardRef || !spellName) return null;
        if (!(wizardRef._spellTargetHistory instanceof Map)) {
            wizardRef._spellTargetHistory = new Map();
        }
        let setForSpell = wizardRef._spellTargetHistory.get(spellName);
        if (!(setForSpell instanceof WeakSet)) {
            setForSpell = new WeakSet();
            wizardRef._spellTargetHistory.set(spellName, setForSpell);
        }
        return setForSpell;
    }

    function spellUsesTargetHistory(spellName) {
        // Fireball and most click-cast spells should be able to target the same
        // object repeatedly; history is only for multi-step/drag workflows.
        return isVanishToolName(spellName) ||
            spellName === "wall" ||
            spellName === "buildroad" ||
            spellName === "firewall" ||
            spellName === "triggerarea";
    }

    function isTrackedAnimalTarget(obj) {
        if (!obj) return false;
        const candidateLists = [
            (typeof globalThis !== "undefined" && Array.isArray(globalThis.animals)) ? globalThis.animals : null,
            (typeof animals !== "undefined" && Array.isArray(animals)) ? animals : null
        ];
        for (let i = 0; i < candidateLists.length; i++) {
            const list = candidateLists[i];
            if (Array.isArray(list) && list.includes(obj)) return true;
        }
        return false;
    }

    function hasSpellAlreadyTargetedObject(wizardRef, spellName, obj) {
        if (!spellUsesTargetHistory(spellName)) return false;
        if (!wizardRef || !spellName || !obj) return false;
        if (
            isVanishToolName(spellName) &&
            isTrackedAnimalTarget(obj) &&
            !obj.gone &&
            !obj.vanishing &&
            !obj.dead &&
            (!(Number.isFinite(obj.hp)) || Number(obj.hp) > 0)
        ) {
            return false;
        }
        const setForSpell = getSpellTargetHistorySet(wizardRef, spellName);
        return !!(setForSpell && setForSpell.has(obj));
    }

    function getSpellClassForName(spellName) {
        if (typeof spellName !== "string" || spellName.length === 0) return null;
        const className = SPELL_CLASS_BY_NAME[spellName];
        if (typeof className !== "string" || className.length === 0) return null;
        const spellClass = globalThis[className];
        return (typeof spellClass === "function") ? spellClass : null;
    }

    function spellSupportsObjectTargeting(spellName) {
        const spellClass = getSpellClassForName(spellName);
        return !!(spellClass && spellClass.supportsObjectTargeting);
    }

    function isValidObjectTargetForSpell(spellName, obj, wizardRef = null) {
        const spellClass = getSpellClassForName(spellName);
        if (!spellClass || typeof spellClass.isValidObjectTarget !== "function") return false;
        return !!spellClass.isValidObjectTarget(obj, wizardRef);
    }

    function markObjectAsTargetedBySpell(wizardRef, spellName, obj) {
        if (!spellUsesTargetHistory(spellName)) return;
        if (!wizardRef || !spellName || !obj) return;
        const setForSpell = getSpellTargetHistorySet(wizardRef, spellName);
        if (setForSpell) {
            setForSpell.add(obj);
        }
    }

    function getTargetAimPoint(wizardRef, target) {
        if (!target || target.gone) return null;
        const resolveTargetZ = () => {
            if (globalThis.Spell && typeof globalThis.Spell.getTargetWorldBaseZ === "function") {
                const z = globalThis.Spell.getTargetWorldBaseZ(target);
                return Number.isFinite(z) ? Number(z) : 0;
            }
            return Number.isFinite(target.z) ? Number(target.z) : 0;
        };
        const resolveSpellTargetPoint = () => {
            const spec = target && target.spellTargetPoint;
            if (!Array.isArray(spec) || spec.length < 2) return null;
            const rawU = Number(spec[0]);
            const rawV = Number(spec[1]);
            if (!Number.isFinite(rawU) || !Number.isFinite(rawV)) return null;
            return {
                u: Math.max(0, Math.min(1, rawU)),
                v: Math.max(0, Math.min(1, rawV))
            };
        };
        const spellTargetPoint = resolveSpellTargetPoint();
        const worldPositions = target && target._depthBillboardWorldPositions;
        if (spellTargetPoint && worldPositions && worldPositions.length >= 12) {
            const mapRef = (wizardRef && wizardRef.map) || (target && target.map) || null;
            const u = spellTargetPoint.u;
            const v = spellTargetPoint.v;
            const bl = { x: Number(worldPositions[0]), y: Number(worldPositions[1]), z: Number(worldPositions[2]) };
            const br = { x: Number(worldPositions[3]), y: Number(worldPositions[4]), z: Number(worldPositions[5]) };
            const tr = { x: Number(worldPositions[6]), y: Number(worldPositions[7]), z: Number(worldPositions[8]) };
            const tl = { x: Number(worldPositions[9]), y: Number(worldPositions[10]), z: Number(worldPositions[11]) };
            const allFinite = [bl, br, tr, tl].every(pt =>
                Number.isFinite(pt.x) && Number.isFinite(pt.y) && Number.isFinite(pt.z)
            );
            if (allFinite) {
                const invU = 1 - u;
                const invV = 1 - v;
                let x = (bl.x * invU * invV) + (br.x * u * invV) + (tr.x * u * v) + (tl.x * invU * v);
                let y = (bl.y * invU * invV) + (br.y * u * invV) + (tr.y * u * v) + (tl.y * invU * v);
                const localZ = (bl.z * invU * invV) + (br.z * u * invV) + (tr.z * u * v) + (tl.z * invU * v);
                const localBottomZ = (bl.z + br.z) * 0.5;
                if (mapRef && typeof mapRef.wrapWorldX === "function") x = mapRef.wrapWorldX(x);
                if (mapRef && typeof mapRef.wrapWorldY === "function") y = mapRef.wrapWorldY(y);
                return {
                    x,
                    y,
                    z: resolveTargetZ() + (localZ - localBottomZ)
                };
            }
        }
        if (
            target.type === "wallSection" &&
            target.startPoint && target.endPoint &&
            Number.isFinite(target.startPoint.x) && Number.isFinite(target.startPoint.y) &&
            Number.isFinite(target.endPoint.x) && Number.isFinite(target.endPoint.y)
        ) {
            const mapRef = (wizardRef && wizardRef.map) || (target && target.map) || null;
            const sx = Number(target.startPoint.x);
            const sy = Number(target.startPoint.y);
            const ex = Number(target.endPoint.x);
            const ey = Number(target.endPoint.y);
            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(sx, ex)
                : (ex - sx);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(sy, ey)
                : (ey - sy);
            let x = sx + dx * 0.5;
            let y = sy + dy * 0.5;
            if (mapRef && typeof mapRef.wrapWorldX === "function") x = mapRef.wrapWorldX(x);
            if (mapRef && typeof mapRef.wrapWorldY === "function") y = mapRef.wrapWorldY(y);
            return { x, y, z: resolveTargetZ() };
        }

        // For deformed fallen trees, aim at the current rendered billboard center.
        // (Do not use this for standing trees: single-plane billboard Y stays at trunk/base.)
        const useDeformedTreeBillboardCenter = !!(
            target &&
            target.type === "tree" &&
            (
                target.falling ||
                target.fallenHitboxCreated ||
                Math.abs(Number(target.rotation) || 0) > 1e-4
            )
        );
        if (useDeformedTreeBillboardCenter && worldPositions && worldPositions.length >= 12) {
            let centerX = 0;
            let centerY = 0;
            let count = 0;
            for (let i = 0; i <= 9; i += 3) {
                const vx = Number(worldPositions[i]);
                const vy = Number(worldPositions[i + 1]);
                if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
                centerX += vx;
                centerY += vy;
                count += 1;
            }
            if (count > 0) {
                centerX /= count;
                centerY /= count;
                const mapRef = (wizardRef && wizardRef.map) || (target && target.map) || null;
                if (mapRef && typeof mapRef.wrapWorldX === "function") centerX = mapRef.wrapWorldX(centerX);
                if (mapRef && typeof mapRef.wrapWorldY === "function") centerY = mapRef.wrapWorldY(centerY);
                if (Number.isFinite(centerX) && Number.isFinite(centerY)) {
                    return { x: centerX, y: centerY, z: resolveTargetZ() };
                }
            }
        }

        // Fallen trees update their collision polygons; prefer those over anchor math.
        if (target && target.type === "tree" && (target.falling || target.fallenHitboxCreated)) {
            const fallenHitbox = target.visualHitbox || target.groundPlaneHitbox || target.hitbox || null;
            if (fallenHitbox && typeof fallenHitbox.getBounds === "function") {
                try {
                    const bounds = fallenHitbox.getBounds();
                    if (
                        bounds &&
                        Number.isFinite(bounds.x) &&
                        Number.isFinite(bounds.y) &&
                        Number.isFinite(bounds.width) &&
                        Number.isFinite(bounds.height)
                    ) {
                        const centerX = Number(bounds.x) + Number(bounds.width) * 0.5;
                        const centerY = Number(bounds.y) + Number(bounds.height) * 0.5;
                        if (Number.isFinite(centerX) && Number.isFinite(centerY)) {
                            return { x: centerX, y: centerY, z: resolveTargetZ() };
                        }
                    }
                } catch (_err) {
                    // Fall through to generic center math.
                }
            }
        }

        if (Number.isFinite(target.x) && Number.isFinite(target.y)) {
            const mapRef = (wizardRef && wizardRef.map) || (target && target.map) || null;
            const baseX = Number(target.x);
            const baseY = Number(target.y);
            const width = Number.isFinite(target.width) ? Math.max(0, Number(target.width)) : 0;
            const height = Number.isFinite(target.height) ? Math.max(0, Number(target.height)) : 0;
            const spriteAnchorX = Number(target && target.pixiSprite && target.pixiSprite.anchor && target.pixiSprite.anchor.x);
            const spriteAnchorY = Number(target && target.pixiSprite && target.pixiSprite.anchor && target.pixiSprite.anchor.y);
            const anchorX = Number.isFinite(target.placeableAnchorX)
                ? Number(target.placeableAnchorX)
                : (Number.isFinite(target.anchorX)
                    ? Number(target.anchorX)
                    : (Number.isFinite(spriteAnchorX) ? spriteAnchorX : 0.5));
            const anchorY = Number.isFinite(target.placeableAnchorY)
                ? Number(target.placeableAnchorY)
                : (Number.isFinite(target.anchorY)
                    ? Number(target.anchorY)
                    : (Number.isFinite(spriteAnchorY) ? spriteAnchorY : 0.5));
            const rotationAxis = (typeof target.rotationAxis === "string")
                ? target.rotationAxis.trim().toLowerCase()
                : "";
            const angleDeg = Number.isFinite(target.placementRotation)
                ? Number(target.placementRotation)
                : (Number.isFinite(target.rotation) ? Number(target.rotation) : 0);
            const theta = angleDeg * (Math.PI / 180);
            const tx = Math.cos(theta);
            const ty = Math.sin(theta);
            const nx = -ty;
            const ny = tx;
            let x = baseX;
            let y = baseY;

            if (rotationAxis === "ground") {
                const alongOffset = (0.5 - anchorX) * width;
                const depthOffset = (0.5 - anchorY) * height;
                x += (tx * alongOffset) + (nx * depthOffset);
                y += (ty * alongOffset) + (ny * depthOffset);
            } else if (rotationAxis === "spatial") {
                const alongOffset = (0.5 - anchorX) * width;
                x += tx * alongOffset;
                y += ty * alongOffset;
            } else {
                x += (0.5 - anchorX) * width;
                y += (0.5 - anchorY) * height;
            }

            if (mapRef && typeof mapRef.wrapWorldX === "function") x = mapRef.wrapWorldX(x);
            if (mapRef && typeof mapRef.wrapWorldY === "function") y = mapRef.wrapWorldY(y);
            if (Number.isFinite(x) && Number.isFinite(y)) {
                return { x, y, z: resolveTargetZ() };
            }
        }

        const hitbox = target.visualHitbox || target.groundPlaneHitbox || target.hitbox || null;
        if (hitbox && typeof hitbox.getBounds === "function") {
            try {
                const bounds = hitbox.getBounds();
                if (
                    bounds &&
                    Number.isFinite(bounds.x) &&
                    Number.isFinite(bounds.y) &&
                    Number.isFinite(bounds.width) &&
                    Number.isFinite(bounds.height)
                ) {
                    const centerX = Number(bounds.x) + Number(bounds.width) * 0.5;
                    const centerY = Number(bounds.y) + Number(bounds.height) * 0.5;
                    if (Number.isFinite(centerX) && Number.isFinite(centerY)) {
                        return { x: centerX, y: centerY, z: resolveTargetZ() };
                    }
                }
            } catch (_err) {
                // Keep failing closed; null below.
            }
        }

        return null;
    }
    globalThis.getSpellTargetAimPoint = getTargetAimPoint;

    function getSpellCasterWorldBaseZ(wizardRef) {
        if (globalThis.Spell && typeof globalThis.Spell.getTargetWorldBaseZ === "function") {
            const z = globalThis.Spell.getTargetWorldBaseZ(wizardRef);
            return Number.isFinite(z) ? Number(z) : 0;
        }
        if (wizardRef && Number.isFinite(wizardRef.currentLayerBaseZ)) {
            return Number(wizardRef.currentLayerBaseZ) + (Number.isFinite(wizardRef.z) ? Number(wizardRef.z) : 0);
        }
        return Number.isFinite(wizardRef && wizardRef.z) ? Number(wizardRef.z) : 0;
    }

    function getWizardDistanceToTarget(wizardRef, target) {
        if (!wizardRef || !target || target.gone) return Infinity;
        const aim = getTargetAimPoint(wizardRef, target);
        if (!aim || !Number.isFinite(aim.x) || !Number.isFinite(aim.y)) return Infinity;
        const mapRef = wizardRef.map || null;
        const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(wizardRef.x, aim.x)
            : (aim.x - wizardRef.x);
        const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(wizardRef.y, aim.y)
            : (aim.y - wizardRef.y);
        return Math.hypot(dx, dy);
    }

    function ensureVanishDragTargetingState(wizardRef) {
        if (!wizardRef) return null;
        if (!wizardRef.vanishDragTargetingState || typeof wizardRef.vanishDragTargetingState !== "object") {
            wizardRef.vanishDragTargetingState = {
                queuedObjects: [],
                queuedObjectSet: new Set(),
                wallRanges: new Map(),
                selectionTimeline: []
            };
        }
        return wizardRef.vanishDragTargetingState;
    }

    function getMaxSelectableVanishTargets(wizardRef) {
        if (editorMode) return 9999;
        const magic = (wizardRef && Number.isFinite(wizardRef.magic)) ? Number(wizardRef.magic) : 0;
        const perCastCost = Math.max(1, Number(VANISH_MAGIC_COST_PER_CAST) || 1);
        return Math.max(0, Math.floor(magic / perCastCost));
    }

    function getVanishWallRangeTargetCount(entry) {
        if (!entry || !entry.wall || entry.wall.gone || entry.wall.vanishing) return 0;
        const wall = entry.wall;
        if (typeof wall.getVanishTargetSegmentCountForRange === "function") {
            return Math.max(0, Number(wall.getVanishTargetSegmentCountForRange(
                { tStart: Number(entry.tStart), tEnd: Number(entry.tEnd) },
                { targetSegmentLengthWorld: VANISH_WALL_TARGET_SEGMENT_LENGTH_WORLD }
            )) || 0);
        }
        return 1;
    }

    function getVanishQueuedSelectionCount(state, overrideWall = null) {
        if (!state || typeof state !== "object") return 0;
        let count = 0;
        if (Array.isArray(state.queuedObjects)) {
            count += state.queuedObjects.length;
        }
        if (state.wallRanges instanceof Map) {
            state.wallRanges.forEach(entry => {
                if (!entry || !entry.wall) return;
                if (overrideWall && overrideWall.wall === entry.wall) {
                    count += getVanishWallRangeTargetCount(overrideWall);
                } else {
                    count += getVanishWallRangeTargetCount(entry);
                }
            });
            if (overrideWall && overrideWall.wall && !state.wallRanges.has(overrideWall.wall)) {
                count += getVanishWallRangeTargetCount(overrideWall);
            }
        } else if (overrideWall && overrideWall.wall) {
            count += getVanishWallRangeTargetCount(overrideWall);
        }
        return count;
    }

    function clampUnitInterval(value, fallback = 0) {
        const n = Number(value);
        if (!Number.isFinite(n)) return Math.max(0, Math.min(1, Number(fallback) || 0));
        return Math.max(0, Math.min(1, n));
    }

    function fitVanishWallRangeToSelectionBudget(state, options = {}) {
        if (!state || typeof state !== "object") return null;
        const wall = options.wall || null;
        const desired = options.desired || null;
        const maxSelectable = Number.isFinite(options.maxSelectable)
            ? Math.max(0, Number(options.maxSelectable))
            : 0;
        if (!wall || !desired || maxSelectable <= 0) return null;

        const desiredEntry = {
            ...desired,
            wall,
            tStart: clampUnitInterval(desired.tStart),
            tEnd: clampUnitInterval(desired.tEnd)
        };
        if (desiredEntry.tStart > desiredEntry.tEnd) {
            const swap = desiredEntry.tStart;
            desiredEntry.tStart = desiredEntry.tEnd;
            desiredEntry.tEnd = swap;
        }

        const desiredCount = getVanishQueuedSelectionCount(state, desiredEntry);
        if (desiredCount <= maxSelectable) return desiredEntry;

        const tCenter = clampUnitInterval(
            options.tCenter,
            (desiredEntry.tStart + desiredEntry.tEnd) * 0.5
        );
        const base = options.base
            ? {
                ...options.base,
                wall,
                tStart: clampUnitInterval(options.base.tStart, tCenter),
                tEnd: clampUnitInterval(options.base.tEnd, tCenter)
            }
            : {
                wall,
                tStart: tCenter,
                tEnd: tCenter
            };
        if (base.tStart > base.tEnd) {
            const swap = base.tStart;
            base.tStart = base.tEnd;
            base.tEnd = swap;
        }

        const baseCount = getVanishQueuedSelectionCount(state, base);
        if (baseCount > maxSelectable) return null;

        let bestEntry = null;
        let bestCount = -1;
        let bestSpan = -1;

        const tryFactor = (factorRaw) => {
            const factor = Math.max(0, Math.min(1, Number(factorRaw) || 0));
            const start = clampUnitInterval(base.tStart + (desiredEntry.tStart - base.tStart) * factor, tCenter);
            const end = clampUnitInterval(base.tEnd + (desiredEntry.tEnd - base.tEnd) * factor, tCenter);
            const entry = {
                ...desiredEntry,
                tStart: Math.min(start, end),
                tEnd: Math.max(start, end)
            };
            const totalCount = getVanishQueuedSelectionCount(state, entry);
            if (totalCount > maxSelectable) return;
            const span = entry.tEnd - entry.tStart;
            if (
                totalCount > bestCount ||
                (totalCount === bestCount && span > bestSpan)
            ) {
                bestEntry = entry;
                bestCount = totalCount;
                bestSpan = span;
            }
        };

        tryFactor(0);
        tryFactor(1);

        // Discrete target-count transitions may happen at irregular t-values;
        // sample and then refine to keep as much range as possible under budget.
        const sampleSteps = 24;
        for (let i = 1; i < sampleSteps; i++) {
            tryFactor(i / sampleSteps);
        }

        let low = 0;
        let high = 1;
        for (let i = 0; i < 20; i++) {
            const mid = (low + high) * 0.5;
            const start = clampUnitInterval(base.tStart + (desiredEntry.tStart - base.tStart) * mid, tCenter);
            const end = clampUnitInterval(base.tEnd + (desiredEntry.tEnd - base.tEnd) * mid, tCenter);
            const entry = {
                ...desiredEntry,
                tStart: Math.min(start, end),
                tEnd: Math.max(start, end)
            };
            const totalCount = getVanishQueuedSelectionCount(state, entry);
            if (totalCount <= maxSelectable) {
                tryFactor(mid);
                low = mid;
            } else {
                high = mid;
            }
        }

        return bestEntry;
    }

    function resetVanishDragTargetingState(wizardRef) {
        if (!wizardRef) return;
        wizardRef.vanishDragTargetingState = null;
    }

    function queueVanishDragTargetAtPoint(wizardRef, worldX, worldY) {
        if (!wizardRef || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
        if (!isVanishToolName(wizardRef.currentSpell)) return false;
        if (!wizardRef.vanishDragMode) return false;

        const maxSelectable = getMaxSelectableVanishTargets(wizardRef);
        if (maxSelectable <= 0) return false;

        const state = ensureVanishDragTargetingState(wizardRef);
        if (!state) return false;

        const candidate = getObjectTargetAt(wizardRef, worldX, worldY);
        if (!candidate || candidate.gone || candidate.vanishing) return false;

        if (
            candidate.type === "wallSection" &&
            typeof candidate._parameterForWorldPointOnSection === "function"
        ) {
            const mouseScreen = (
                typeof mousePos !== "undefined" &&
                mousePos &&
                Number.isFinite(mousePos.screenX) &&
                Number.isFinite(mousePos.screenY)
            ) ? { x: mousePos.screenX, y: mousePos.screenY } : (
                (typeof worldToScreen === "function")
                    ? worldToScreen({ x: Number(worldX), y: Number(worldY) })
                    : null
            );
            const hitSegment = (
                mouseScreen &&
                Number.isFinite(mouseScreen.x) &&
                Number.isFinite(mouseScreen.y) &&
                typeof candidate.getSegmentAtScreenPoint === "function"
            ) ? candidate.getSegmentAtScreenPoint(
                Number(mouseScreen.x),
                Number(mouseScreen.y),
                {
                    worldX: Number(worldX),
                    worldY: Number(worldY),
                    worldToScreenFn: (typeof worldToScreen === "function") ? worldToScreen : null,
                    viewscale: Number.isFinite(viewscale) ? Number(viewscale) : 1,
                    xyratio: Number.isFinite(xyratio) ? Number(xyratio) : 0.66
                }
            ) : null;

            const tRaw = candidate._parameterForWorldPointOnSection({ x: worldX, y: worldY });
            const tCenter = (hitSegment && Number.isFinite(hitSegment.t))
                ? Math.max(0, Math.min(1, Number(hitSegment.t)))
                : (Number.isFinite(tRaw) ? Math.max(0, Math.min(1, Number(tRaw))) : 0.5);
            const touchedStart = (hitSegment && Number.isFinite(hitSegment.tStart))
                ? Math.max(0, Math.min(1, Number(hitSegment.tStart)))
                : tCenter;
            const touchedEnd = (hitSegment && Number.isFinite(hitSegment.tEnd))
                ? Math.max(0, Math.min(1, Number(hitSegment.tEnd)))
                : tCenter;

            const existing = state.wallRanges.get(candidate);
            if (existing) {
                const proposed = {
                    ...existing,
                    tStart: Math.min(existing.tStart, touchedStart),
                    tEnd: Math.max(existing.tEnd, touchedEnd),
                    lastTouchT: tCenter
                };
                const proposedCount = getVanishQueuedSelectionCount(state, proposed);
                if (proposedCount > maxSelectable) {
                    const fitted = fitVanishWallRangeToSelectionBudget(state, {
                        wall: candidate,
                        base: existing,
                        desired: proposed,
                        tCenter,
                        maxSelectable
                    });
                    if (!fitted) return false;
                    existing.tStart = fitted.tStart;
                    existing.tEnd = fitted.tEnd;
                    existing.lastTouchT = proposed.lastTouchT;
                    return true;
                }
                existing.tStart = proposed.tStart;
                existing.tEnd = proposed.tEnd;
                existing.lastTouchT = proposed.lastTouchT;
            } else {
                const entry = {
                    wall: candidate,
                    tStart: touchedStart,
                    tEnd: touchedEnd,
                    firstTouchT: tCenter,
                    lastTouchT: tCenter
                };
                const proposedCount = getVanishQueuedSelectionCount(state, entry);
                if (proposedCount > maxSelectable) {
                    const fitted = fitVanishWallRangeToSelectionBudget(state, {
                        wall: candidate,
                        base: {
                            wall: candidate,
                            tStart: tCenter,
                            tEnd: tCenter
                        },
                        desired: entry,
                        tCenter,
                        maxSelectable
                    });
                    if (!fitted) return false;
                    const fittedEntry = {
                        ...entry,
                        tStart: fitted.tStart,
                        tEnd: fitted.tEnd
                    };
                    if (getVanishWallRangeTargetCount(fittedEntry) <= 0) return false;
                    state.wallRanges.set(candidate, fittedEntry);
                    if (Array.isArray(state.selectionTimeline)) {
                        state.selectionTimeline.push({ kind: "wall", wall: candidate });
                    }
                    return true;
                }
                state.wallRanges.set(candidate, entry);
                if (Array.isArray(state.selectionTimeline)) {
                    state.selectionTimeline.push({ kind: "wall", wall: candidate });
                }
            }
            return true;
        }

        if (state.queuedObjectSet.has(candidate)) return false;
        const currentCount = getVanishQueuedSelectionCount(state);
        if (currentCount >= maxSelectable) return false;
        state.queuedObjectSet.add(candidate);
        state.queuedObjects.push(candidate);
        if (Array.isArray(state.selectionTimeline)) {
            state.selectionTimeline.push({ kind: "object", object: candidate });
        }
        markObjectAsTargetedBySpell(wizardRef, wizardRef.currentSpell, candidate);
        return true;
    }

    function buildVanishBurstTargetsFromQueuedState(wizardRef) {
        const state = wizardRef && wizardRef.vanishDragTargetingState;
        if (!wizardRef || !state) return [];

        const targets = [];
        const seen = new Set();
        const pushUnique = (obj) => {
            if (!obj || obj.gone || obj.vanishing) return;
            if (seen.has(obj)) return;
            seen.add(obj);
            targets.push(obj);
        };

        const timeline = Array.isArray(state.selectionTimeline)
            ? state.selectionTimeline
            : [];

        for (let i = 0; i < timeline.length; i++) {
            const step = timeline[i];
            if (!step || typeof step !== "object") continue;

            if (step.kind === "object") {
                pushUnique(step.object);
                continue;
            }

            if (step.kind === "wall") {
                const entry = (state.wallRanges instanceof Map)
                    ? state.wallRanges.get(step.wall)
                    : null;
                const wall = entry && entry.wall;
                if (!wall || wall.gone || wall.vanishing) continue;

                if (typeof wall.splitIntoTargetableVanishSegments === "function") {
                    const split = wall.splitIntoTargetableVanishSegments(
                        {
                            tStart: Number(entry.tStart),
                            tEnd: Number(entry.tEnd)
                        },
                        {
                            targetSegmentLengthWorld: VANISH_WALL_TARGET_SEGMENT_LENGTH_WORLD
                        }
                    );
                    if (split && Array.isArray(split.targetSegments) && split.targetSegments.length > 0) {
                        const orderedSegments = split.targetSegments.slice();
                        const firstT = Number(entry.firstTouchT);
                        const lastT = Number(entry.lastTouchT);
                        if (Number.isFinite(firstT) && Number.isFinite(lastT) && lastT < firstT) {
                            orderedSegments.reverse();
                        }
                        for (let s = 0; s < orderedSegments.length; s++) {
                            pushUnique(orderedSegments[s]);
                        }
                        continue;
                    }
                }

                pushUnique(wall);
            }
        }

        const maxSelectable = getMaxSelectableVanishTargets(wizardRef);
        if (maxSelectable <= 0) return [];
        if (targets.length <= maxSelectable) return targets;
        return targets.slice(0, maxSelectable);
    }

    function castQueuedVanishBurst(wizardRef, queuedTargets = [], spellName = null) {
        if (!wizardRef || !Array.isArray(queuedTargets) || queuedTargets.length === 0) return false;
        const vanishSpellName = isVanishToolName(spellName)
            ? spellName
            : (isVanishToolName(wizardRef.currentSpell) ? wizardRef.currentSpell : "vanish");

        const shots = queuedTargets.slice();
        let shotIndex = 0;
        wizardRef.castDelay = true;
        wizardRef.casting = true;

        const finishBurst = () => {
            wizardRef.castDelay = false;
            wizardRef.casting = false;
        };

        const fireNext = () => {
            if (!wizardRef || wizardRef.gone || shotIndex >= shots.length) {
                finishBurst();
                return;
            }

            const target = shots[shotIndex++];
            if (target && !target.gone && !target.vanishing) {
                const ProjectileClass = getSpellClassForName(vanishSpellName) || globalThis.Vanish;
                const projectile = new ProjectileClass();
                const requiredMagic = (vanishSpellName === "editorvanish")
                    ? 0
                    : Math.max(VANISH_MAGIC_COST_PER_CAST, Number.isFinite(projectile.magicCost) ? Number(projectile.magicCost) : 0);
                if (!canAffordMagicCost(wizardRef, requiredMagic)) {
                    if (globalThis.Spell && typeof globalThis.Spell.indicateInsufficientMagic === "function") {
                        globalThis.Spell.indicateInsufficientMagic();
                    }
                    finishBurst();
                    return;
                }

                const aim = getTargetAimPoint(wizardRef, target);
                if (aim && Number.isFinite(aim.x) && Number.isFinite(aim.y)) {
                    const casterZ = getSpellCasterWorldBaseZ(wizardRef);
                    projectile.forcedTarget = target;
                    projectile.visualStartZ = casterZ;
                    projectile.visualBaseZ = casterZ;
                    if (Number.isFinite(aim.z)) {
                        projectile.visualTargetZ = Number(aim.z);
                        projectile.targetWorldZ = Number(aim.z);
                    }
                    markObjectAsTargetedBySpell(wizardRef, vanishSpellName, target);
                    const dx = aim.x - wizardRef.x;
                    const dy = aim.y - wizardRef.y;
                    if (typeof wizardRef.turnToward === "function") {
                        wizardRef.turnToward(dx, dy);
                    }
                    projectiles.push(projectile.cast(aim.x, aim.y));
                }
            }

            if (shotIndex >= shots.length) {
                setTimeout(finishBurst, VANISH_BURST_SHOT_INTERVAL_MS);
                return;
            }
            setTimeout(fireNext, VANISH_BURST_SHOT_INTERVAL_MS);
        };

        fireNext();
        return true;
    }

    function getVanishDragHighlightState(wizardRef) {
        if (!wizardRef || !wizardRef.vanishDragMode) return null;
        const state = wizardRef.vanishDragTargetingState;
        if (!state || typeof state !== "object") {
            return { objects: [], wallPreviews: [] };
        }

        const objects = [];
        const seen = new Set();
        if (Array.isArray(state.queuedObjects)) {
            for (let i = 0; i < state.queuedObjects.length; i++) {
                const obj = state.queuedObjects[i];
                if (!obj || obj.gone || obj.vanishing || seen.has(obj)) continue;
                seen.add(obj);
                objects.push(obj);
            }
        }

        const wallPreviews = [];
        if (state.wallRanges instanceof Map) {
            state.wallRanges.forEach(entry => {
                const wall = entry && entry.wall;
                if (!wall || wall.gone || wall.vanishing) return;
                if (typeof wall.getVanishPreviewPolygonForRange !== "function") return;
                const preview = wall.getVanishPreviewPolygonForRange({
                    tStart: Number(entry.tStart),
                    tEnd: Number(entry.tEnd)
                });
                if (!preview || !Array.isArray(preview.points) || preview.points.length < 3) return;
                wallPreviews.push({ target: wall, preview });
            });
        }

        return { objects, wallPreviews };
    }

    function getRenderPriority(item) {
        if (!item) {
            return { band: 1, depth: 0, y: 0, x: 0 };
        }
        const band = (item.type === "road") ? 0 : 1;
        let depth = 0;
        if (Number.isFinite(item.renderZ)) {
            depth = Number(item.renderZ);
        } else if (item.type === "road") {
            depth = 0;
        } else {
            const baseDepth = Number.isFinite(item.y) ? item.y : 0;
            const depthOffset = Number.isFinite(item.renderDepthOffset) ? item.renderDepthOffset : 0;
            depth = baseDepth + depthOffset;
        }
        const y = Number.isFinite(item.y) ? item.y : 0;
        const x = Number.isFinite(item.x) ? item.x : 0;
        return { band, depth, y, x };
    }

    function getDisplayPriority(item) {
        const displayObj = getSpellTargetDisplayObject(item);
        if (!displayObj || !displayObj.parent) return null;
        try {
            const parent = displayObj.parent;
            const index = parent.getChildIndex(displayObj);
            if (!Number.isFinite(index)) return null;
            return { parent, index };
        } catch (_err) {
            return null;
        }
    }

    function compareTargetPriorityTopFirst(a, b) {
        const da = getDisplayPriority(a);
        const db = getDisplayPriority(b);
        if (da && db && da.parent === db.parent && da.index !== db.index) {
            return db.index - da.index;
        }
        const pa = getRenderPriority(a);
        const pb = getRenderPriority(b);
        if (pa.band !== pb.band) return pb.band - pa.band;
        if (pa.depth !== pb.depth) return pb.depth - pa.depth;
        if (pa.y !== pb.y) return pb.y - pa.y;
        return pb.x - pa.x;
    }

    function pickObjectViaRenderingColorId(filterFn = null) {
        const pickerApi = (typeof globalThis !== "undefined") ? globalThis.renderingScenePicker : null;
        if (!pickerApi) {
            return { picked: null, attempted: false };
        }
        if (typeof pickerApi.getHoveredObject !== "function") {
            return { picked: null, attempted: false };
        }
        let picked = null;
        try {
            picked = pickerApi.getHoveredObject({
                filter: filterFn
            });
        } catch (_err) {
            picked = null;
        }
        return { picked: picked || null, attempted: true };
    }

    function getSameTypeObjectTargetAt(wizardRef, spellName, worldX, worldY) {
        const objectType = getDragSpellObjectType(spellName);
        if (!wizardRef || !objectType || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const canTargetObject = (obj) => !!(
            obj &&
            !obj.gone &&
            obj.type === objectType &&
            (spellName !== "wall" || isWallTargetOnActivePlacementLayer(wizardRef, obj)) &&
            !hasSpellAlreadyTargetedObject(wizardRef, spellName, obj)
        );

        const pickResult = pickObjectViaRenderingColorId((obj) =>
            canTargetObject(obj)
        );
        if (pickResult && pickResult.attempted) {
            const picked = pickResult.picked;
            if (picked && canTargetObject(picked)) return picked;
            return null;
        }
        return null;
    }

    function getGroundAnchorPointForObject(obj, worldX, worldY) {
        if (!obj) return null;
        if (
            obj.type === "wallSection" &&
            obj.startPoint && obj.endPoint &&
            Number.isFinite(obj.startPoint.x) && Number.isFinite(obj.startPoint.y) &&
            Number.isFinite(obj.endPoint.x) && Number.isFinite(obj.endPoint.y) &&
            Number.isFinite(worldX) && Number.isFinite(worldY)
        ) {
            const endpointConnected = endpointKey => {
                if (typeof obj.hasConnectedWallAtEndpoint === "function") {
                    try {
                        return !!obj.hasConnectedWallAtEndpoint(endpointKey);
                    } catch (_) {
                        // Fall through to proximity fallback.
                    }
                }
                return false;
            };
            const aConnected = endpointConnected("a");
            const bConnected = endpointConnected("b");
            // Prefer extending from the free end when only one side is connected.
            if (aConnected !== bConnected) {
                return aConnected
                    ? { x: obj.endPoint.x, y: obj.endPoint.y }
                    : { x: obj.startPoint.x, y: obj.startPoint.y };
            }

            const clickScreen = (typeof worldToScreen === "function")
                ? worldToScreen({ x: worldX, y: worldY })
                : null;
            const endpointAScreen = (typeof worldToScreen === "function")
                ? worldToScreen({ x: obj.startPoint.x, y: obj.startPoint.y })
                : null;
            const endpointBScreen = (typeof worldToScreen === "function")
                ? worldToScreen({ x: obj.endPoint.x, y: obj.endPoint.y })
                : null;
            const hasScreenDistances = !!(
                clickScreen &&
                endpointAScreen &&
                endpointBScreen &&
                Number.isFinite(clickScreen.x) &&
                Number.isFinite(clickScreen.y) &&
                Number.isFinite(endpointAScreen.x) &&
                Number.isFinite(endpointAScreen.y) &&
                Number.isFinite(endpointBScreen.x) &&
                Number.isFinite(endpointBScreen.y)
            );

            let da = Infinity;
            let db = Infinity;
            if (hasScreenDistances) {
                da = Math.hypot(clickScreen.x - endpointAScreen.x, clickScreen.y - endpointAScreen.y);
                db = Math.hypot(clickScreen.x - endpointBScreen.x, clickScreen.y - endpointBScreen.y);
            } else {
                const dxA = (map && typeof map.shortestDeltaX === "function")
                    ? map.shortestDeltaX(worldX, obj.startPoint.x)
                    : (obj.startPoint.x - worldX);
                const dyA = (map && typeof map.shortestDeltaY === "function")
                    ? map.shortestDeltaY(worldY, obj.startPoint.y)
                    : (obj.startPoint.y - worldY);
                const dxB = (map && typeof map.shortestDeltaX === "function")
                    ? map.shortestDeltaX(worldX, obj.endPoint.x)
                    : (obj.endPoint.x - worldX);
                const dyB = (map && typeof map.shortestDeltaY === "function")
                    ? map.shortestDeltaY(worldY, obj.endPoint.y)
                    : (obj.endPoint.y - worldY);
                da = Math.hypot(dxA, dyA);
                db = Math.hypot(dxB, dyB);
            }
            return da <= db
                ? { x: obj.startPoint.x, y: obj.startPoint.y }
                : { x: obj.endPoint.x, y: obj.endPoint.y };
        }
        if (Number.isFinite(obj.x) && Number.isFinite(obj.y)) {
            return { x: obj.x, y: obj.y };
        }
        return null;
    }

    function getWallBuildStartAnchorForObject(obj, worldX, worldY, minSplitDistanceWorld = 0.1) {
        if (!obj || obj.type !== "wallSection") return null;
        const baseAnchor = getGroundAnchorPointForObject(obj, worldX, worldY);
        if (!baseAnchor) return null;
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return { point: baseAnchor };

        const mapRef = obj.map || map || null;
        const sx = Number(obj.startPoint && obj.startPoint.x);
        const sy = Number(obj.startPoint && obj.startPoint.y);
        const ex = Number(obj.endPoint && obj.endPoint.x);
        const ey = Number(obj.endPoint && obj.endPoint.y);
        if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) {
            return { point: baseAnchor };
        }

        const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(sx, ex)
            : (ex - sx);
        const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(sy, ey)
            : (ey - sy);
        const lenSq = dx * dx + dy * dy;
        if (!(lenSq > 1e-6)) return { point: baseAnchor };

        const vx = (mapRef && typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(sx, worldX)
            : (worldX - sx);
        const vy = (mapRef && typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(sy, worldY)
            : (worldY - sy);
        const tProjected = Math.max(0, Math.min(1, (vx * dx + vy * dy) / lenSq));
        const projectedPoint = { x: sx + dx * tProjected, y: sy + dy * tProjected };
        const nearest = (typeof obj.getNearestLineAnchorToWorldPoint === "function")
            ? obj.getNearestLineAnchorToWorldPoint(projectedPoint)
            : null;
        if (!nearest || !nearest.anchor) {
            return { point: baseAnchor };
        }

        const maxSnapDistanceWorld = 0.75;
        if (Number.isFinite(nearest.distanceWorld) && nearest.distanceWorld > maxSnapDistanceWorld) {
            return { point: baseAnchor };
        }
        const splitT = Number(nearest.t);
        const sectionLength = Number.isFinite(obj.length) ? Number(obj.length) : Math.hypot(dx, dy);
        const distToStart = Math.max(0, splitT * sectionLength);
        const distToEnd = Math.max(0, (1 - splitT) * sectionLength);
        const canSplit = !nearest.isEndpoint &&
            distToStart >= Number(minSplitDistanceWorld) &&
            distToEnd >= Number(minSplitDistanceWorld);
        if (!canSplit) return { point: baseAnchor };

        return {
            point: { x: Number(nearest.anchor.x), y: Number(nearest.anchor.y) },
            splitReference: {
                wall: obj,
                anchor: nearest.anchor
            }
        };
    }

    function getDragStartSnapTargetAt(wizardRef, spellName, worldX, worldY) {
        const obj = getSameTypeObjectTargetAt(wizardRef, spellName, worldX, worldY);
        if (!obj) return null;
        if (spellName === "wall" && obj.type === "wallSection") {
            const wallStart = getWallBuildStartAnchorForObject(obj, worldX, worldY, 0.1);
            if (!wallStart || !wallStart.point) return null;
            const node = wizardRef.map.worldToNode(wallStart.point.x, wallStart.point.y);
            return {
                obj,
                node,
                point: { x: wallStart.point.x, y: wallStart.point.y },
                splitReference: wallStart.splitReference || null
            };
        }
        const anchor = getGroundAnchorPointForObject(obj, worldX, worldY);
        if (!anchor) return null;
        if (spellName === "wall") {
            const node = wizardRef.map.worldToNode(anchor.x, anchor.y);
            return {
                obj,
                node,
                point: { x: anchor.x, y: anchor.y }
            };
        }
        if (spellName === "buildroad") {
            const node = wizardRef.map.worldToNode(anchor.x, anchor.y);
            if (node) return { obj, node, point: { x: node.x, y: node.y } };
        } else {
            return { obj, point: anchor };
        }
        return null;
    }

    function getDragStartSnapTargetForSpell(wizardRef, spellName, worldX, worldY) {
        if (!wizardRef || typeof spellName !== "string") return null;
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        return getDragStartSnapTargetAt(wizardRef, spellName, worldX, worldY);
    }

    function getMoveObjectAnchorPoint(target) {
        if (!target || target.gone || target.vanishing) return null;
        if (Number.isFinite(target.x) && Number.isFinite(target.y)) {
            return { x: Number(target.x), y: Number(target.y) };
        }
        if (Array.isArray(target.polygonPoints) && target.polygonPoints.length >= 3) {
            let sumX = 0;
            let sumY = 0;
            let count = 0;
            for (let i = 0; i < target.polygonPoints.length; i++) {
                const point = target.polygonPoints[i];
                if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
                sumX += Number(point.x);
                sumY += Number(point.y);
                count += 1;
            }
            if (count > 0) {
                return { x: sumX / count, y: sumY / count };
            }
        }
        return null;
    }

    function translatePointArray(points, dx, dy, mapRef) {
        if (!Array.isArray(points)) return [];
        const translated = [];
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
            translated.push(wrapWorldPointForMap(
                mapRef,
                Number(point.x) + dx,
                Number(point.y) + dy
            ));
        }
        return translated;
    }

    function translateHitboxInPlace(hitbox, dx, dy, mapRef) {
        if (!hitbox || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
        if (hitbox.type === "circle") {
            const translated = wrapWorldPointForMap(mapRef, Number(hitbox.x) + dx, Number(hitbox.y) + dy);
            hitbox.x = translated.x;
            hitbox.y = translated.y;
            return;
        }
        if (Array.isArray(hitbox.points)) {
            const translated = translatePointArray(hitbox.points, dx, dy, mapRef);
            if (translated.length === hitbox.points.length) {
                hitbox.points = translated;
            }
        }
    }

    function clearMovedPlacedObjectMountState(target) {
        if (!target || typeof target !== "object") return;
        if (typeof target._refreshMountedWallDirectionalBlocking === "function") {
            target._refreshMountedWallDirectionalBlocking(target.mountedWallSectionUnitId);
        }
        target.mountedWallLineGroupId = null;
        target.mountedSectionId = null;
        target.mountedWallSectionUnitId = null;
    }

    function isWallMountedMoveSnapCandidate(target) {
        if (!target || target.type !== "placedObject") return false;
        const category = (typeof target.category === "string") ? target.category.trim().toLowerCase() : "";
        return (category === "windows" || category === "doors") && target.rotationAxis === "spatial";
    }

    function closestPointOnSegment2DForMove(px, py, ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        if (!(len2 > 1e-8)) {
            const ddx = px - ax;
            const ddy = py - ay;
            return { x: ax, y: ay, t: 0, dist2: ddx * ddx + ddy * ddy };
        }
        const rawT = ((px - ax) * dx + (py - ay) * dy) / len2;
        const t = Math.max(0, Math.min(1, rawT));
        const x = ax + dx * t;
        const y = ay + dy * t;
        const ddx = px - x;
        const ddy = py - y;
        return { x, y, t, dist2: ddx * ddx + ddy * ddy };
    }

    function getMoveObjectMountedWallPlacement(target, targetX, targetY, mapRef) {
        if (!isWallMountedMoveSnapCandidate(target) || !mapRef) return null;
        if (
            typeof WallSectionUnit === "undefined" ||
            !WallSectionUnit ||
            !(WallSectionUnit._allSections instanceof Map)
        ) {
            return null;
        }

        const category = (typeof target.category === "string") ? target.category.trim().toLowerCase() : "";
        const width = Math.max(0.01, Number.isFinite(target.width) ? Number(target.width) : 1);
        const height = Math.max(0.01, Number.isFinite(target.height) ? Number(target.height) : 1);
        const anchorX = Number.isFinite(target.placeableAnchorX) ? Number(target.placeableAnchorX) : 0.5;
        const anchorY = Number.isFinite(target.placeableAnchorY) ? Number(target.placeableAnchorY) : 1;
        const effectiveAnchorY = (category === "windows") ? 0.5 : anchorY;
        const halfWidth = width * 0.5;

        const shortestDX = (fromX, toX) =>
            (typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(fromX, toX)
                : (toX - fromX);
        const shortestDY = (fromY, toY) =>
            (typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(fromY, toY)
                : (toY - fromY);
        const wrapX = (x) =>
            (typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(x) : x;
        const wrapY = (y) =>
            (typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(y) : y;

        let bestPlacement = null;
        let bestScore = Infinity;
        for (const section of WallSectionUnit._allSections.values()) {
            if (!section || section.type !== "wallSection" || section.gone || section.vanishing) continue;
            if (!section.startPoint || !section.endPoint) continue;

            const sx = Number(section.startPoint.x);
            const sy = Number(section.startPoint.y);
            const ex = Number(section.endPoint.x);
            const ey = Number(section.endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) continue;

            const ax = targetX + shortestDX(targetX, sx);
            const ay = targetY + shortestDY(targetY, sy);
            const bx = targetX + shortestDX(targetX, ex);
            const by = targetY + shortestDY(targetY, ey);
            const dx = bx - ax;
            const dy = by - ay;
            const len = Math.hypot(dx, dy);
            if (!(len > 1e-6)) continue;

            const wallHeight = Math.max(0, Number(section.height) || 0);
            if (width > len + 1e-6 || height > wallHeight + 1e-6) continue;

            const ux = dx / len;
            const uy = dy / len;
            const vx = -uy;
            const vy = ux;
            const halfT = Math.max(0.001, Number(section.thickness) || 0.001) * 0.5;
            const centerPoint = closestPointOnSegment2DForMove(targetX, targetY, ax, ay, bx, by);

            let along = centerPoint.t * len;
            along = Math.max(halfWidth, Math.min(len - halfWidth, along));

            let facingSign = null;
            if (typeof section.getWallProfile === "function") {
                const profile = section.getWallProfile();
                if (profile && profile.aLeft && profile.bLeft && profile.aRight && profile.bRight) {
                    const leftA = {
                        x: targetX + shortestDX(targetX, Number(profile.aLeft.x)),
                        y: targetY + shortestDY(targetY, Number(profile.aLeft.y))
                    };
                    const leftB = {
                        x: targetX + shortestDX(targetX, Number(profile.bLeft.x)),
                        y: targetY + shortestDY(targetY, Number(profile.bLeft.y))
                    };
                    const rightA = {
                        x: targetX + shortestDX(targetX, Number(profile.aRight.x)),
                        y: targetY + shortestDY(targetY, Number(profile.aRight.y))
                    };
                    const rightB = {
                        x: targetX + shortestDX(targetX, Number(profile.bRight.x)),
                        y: targetY + shortestDY(targetY, Number(profile.bRight.y))
                    };
                    const leftPoint = closestPointOnSegment2DForMove(targetX, targetY, leftA.x, leftA.y, leftB.x, leftB.y);
                    const rightPoint = closestPointOnSegment2DForMove(targetX, targetY, rightA.x, rightA.y, rightB.x, rightB.y);
                    facingSign = leftPoint.dist2 <= rightPoint.dist2 ? 1 : -1;
                }
            }
            if (!Number.isFinite(facingSign)) {
                const signed = ((targetX - centerPoint.x) * vx) + ((targetY - centerPoint.y) * vy);
                facingSign = signed >= 0 ? 1 : -1;
            }

            const centerX = ax + ux * along;
            const centerY = ay + uy * along;
            const wallFaceCenterX = centerX + vx * halfT * facingSign;
            const wallFaceCenterY = centerY + vy * halfT * facingSign;
            const normalBias = (category === "windows") ? 0.001 : 0;
            const desiredBaseX = wallFaceCenterX + vx * normalBias * facingSign;
            const desiredBaseY = wallFaceCenterY + vy * normalBias * facingSign;
            const verticalOffset = (1 - effectiveAnchorY) * height;
            const snappedX = wrapX(desiredBaseX);
            const snappedY = wrapY(category === "doors" ? (desiredBaseY - verticalOffset) : desiredBaseY);
            const rotDeg = Math.atan2(uy, ux) * (180 / Math.PI);
            const wallBottomZ = Number.isFinite(section.bottomZ) ? Number(section.bottomZ) : 0;
            const snappedZ = (category === "windows") ? (wallBottomZ + wallHeight * 0.5) : 0;
            const hitboxHalfT = (category === "doors") ? (halfT * 1.1) : halfT;
            const p1 = { x: wrapX(centerX - ux * halfWidth + vx * hitboxHalfT), y: wrapY(centerY - uy * halfWidth + vy * hitboxHalfT) };
            const p2 = { x: wrapX(centerX + ux * halfWidth + vx * hitboxHalfT), y: wrapY(centerY + uy * halfWidth + vy * hitboxHalfT) };
            const p3 = { x: wrapX(centerX + ux * halfWidth - vx * hitboxHalfT), y: wrapY(centerY + uy * halfWidth - vy * hitboxHalfT) };
            const p4 = { x: wrapX(centerX - ux * halfWidth - vx * hitboxHalfT), y: wrapY(centerY - uy * halfWidth - vy * hitboxHalfT) };
            const snapDx = (typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(targetX, wallFaceCenterX)
                : (wallFaceCenterX - targetX);
            const snapDy = (typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(targetY, wallFaceCenterY)
                : (wallFaceCenterY - targetY);
            const score = (snapDx * snapDx) + (snapDy * snapDy);
            if (score < bestScore) {
                bestScore = score;
                bestPlacement = {
                    targetWall: section,
                    mountedWallLineGroupId: Number(section.id),
                    mountedSectionId: Number(section.id),
                    mountedWallSectionUnitId: Number(section.id),
                    mountedWallFacingSign: facingSign,
                    snappedX,
                    snappedY,
                    snappedZ,
                    snappedRotationDeg: rotDeg,
                    wallGroundHitboxPoints: [p1, p2, p3, p4]
                };
            }
        }

        if (!bestPlacement) return null;
        const maxSnapDistance = Math.max(1.5, width, height);
        if (bestScore > (maxSnapDistance * maxSnapDistance)) return null;
        return bestPlacement;
    }

    function applyMoveObjectMountedWallPlacement(target, placement, dragState = null) {
        if (!target || !placement) return false;
        target.x = placement.snappedX;
        target.y = placement.snappedY;
        if (Number.isFinite(placement.snappedZ)) target.z = placement.snappedZ;
        if (Number.isFinite(target.prevX)) target.prevX = target.x;
        if (Number.isFinite(target.prevY)) target.prevY = target.y;
        if (Object.prototype.hasOwnProperty.call(target, "destination")) target.destination = null;
        if (Array.isArray(target.path)) target.path.length = 0;
        if (Object.prototype.hasOwnProperty.call(target, "nextNode")) target.nextNode = null;
        if (Number.isFinite(target.travelFrames)) target.travelFrames = 0;
        if (Number.isFinite(target.travelX)) target.travelX = 0;
        if (Number.isFinite(target.travelY)) target.travelY = 0;
        if (Object.prototype.hasOwnProperty.call(target, "moving")) target.moving = false;

        target.placementRotation = placement.snappedRotationDeg;
        target.rotation = placement.snappedRotationDeg;
        target.mountedWallLineGroupId = placement.mountedWallLineGroupId;
        target.mountedSectionId = placement.mountedSectionId;
        target.mountedWallSectionUnitId = placement.mountedWallSectionUnitId;
        target.mountedWallFacingSign = placement.mountedWallFacingSign;
        target.groundPlaneHitboxOverridePoints = Array.isArray(placement.wallGroundHitboxPoints)
            ? placement.wallGroundHitboxPoints.map(point => ({ x: Number(point.x), y: Number(point.y) }))
            : null;

        if (typeof target.applyPlaceableMetadata === "function" && target._placedObjectMetadata) {
            target.applyPlaceableMetadata(target._placedObjectMetadata);
            return true;
        }

        if (typeof target.snapToMountedWall === "function") {
            target.snapToMountedWall();
        }
        if (
            Array.isArray(target.groundPlaneHitboxOverridePoints) &&
            target.groundPlaneHitboxOverridePoints.length >= 3 &&
            typeof PolygonHitbox === "function"
        ) {
            target.groundPlaneHitbox = new PolygonHitbox(
                target.groundPlaneHitboxOverridePoints.map(point => ({ x: point.x, y: point.y }))
            );
        }
        if (typeof target.refreshIndexedNodesFromHitbox === "function") {
            target.refreshIndexedNodesFromHitbox({ minExtent: 1.5, sampleSpacing: 1.0 });
            return true;
        }
        syncMovedObjectNodeState(target, target.map || map || null, dragState);
        return true;
    }

    function syncMovedObjectNodeState(target, mapRef, dragState = null) {
        if (!target || !mapRef || typeof mapRef.worldToNode !== "function") return;
        if (typeof target.refreshIndexedNodesFromHitbox === "function") {
            target.refreshIndexedNodesFromHitbox(
                target.isTriggerArea === true
                    ? { forceExpanded: true, sampleSpacing: 1.0, extraPoints: target.polygonPoints }
                    : {}
            );
            return;
        }

        const nextNode = mapRef.worldToNode(target.x, target.y);
        if (dragState && dragState.occupiesNodeObjects) {
            const previousNode = dragState.currentOccupancyNode || null;
            if (previousNode && previousNode !== nextNode && typeof previousNode.removeObject === "function") {
                previousNode.removeObject(target);
            }
            if (nextNode && nextNode !== previousNode && typeof nextNode.addObject === "function") {
                nextNode.addObject(target);
            }
            dragState.currentOccupancyNode = nextNode || null;
        }
        if (nextNode) {
            target.node = nextNode;
        }
    }

    function applyMoveObjectTargetPosition(target, targetX, targetY, dragState = null) {
        if (!target || target.gone || target.vanishing) return false;
        const mapRef = target.map || map || null;
        const anchor = getMoveObjectAnchorPoint(target);
        if (!mapRef || !anchor || !Number.isFinite(targetX) || !Number.isFinite(targetY)) return false;

        const wrappedTarget = wrapWorldPointForMap(mapRef, targetX, targetY);
        const dx = (typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(anchor.x, wrappedTarget.x)
            : (wrappedTarget.x - anchor.x);
        const dy = (typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(anchor.y, wrappedTarget.y)
            : (wrappedTarget.y - anchor.y);

        if ((target.type === "triggerArea" || target.isTriggerArea === true) && typeof target.setPolygonPoints === "function") {
            const translatedPoints = translatePointArray(target.polygonPoints, dx, dy, mapRef);
            if (translatedPoints.length >= 3) {
                target.setPolygonPoints(translatedPoints);
                return true;
            }
            return false;
        }

        const mountedWallPlacement = getMoveObjectMountedWallPlacement(target, wrappedTarget.x, wrappedTarget.y, mapRef);
        if (mountedWallPlacement) {
            return applyMoveObjectMountedWallPlacement(target, mountedWallPlacement, dragState);
        }

        target.x = wrappedTarget.x;
        target.y = wrappedTarget.y;
        if (Number.isFinite(target.prevX)) target.prevX = target.x;
        if (Number.isFinite(target.prevY)) target.prevY = target.y;
        if (Object.prototype.hasOwnProperty.call(target, "destination")) target.destination = null;
        if (Array.isArray(target.path)) target.path.length = 0;
        if (Object.prototype.hasOwnProperty.call(target, "nextNode")) target.nextNode = null;
        if (Number.isFinite(target.travelFrames)) target.travelFrames = 0;
        if (Number.isFinite(target.travelX)) target.travelX = 0;
        if (Number.isFinite(target.travelY)) target.travelY = 0;
        if (Object.prototype.hasOwnProperty.call(target, "moving")) target.moving = false;

        if (Array.isArray(target.groundPlaneHitboxOverridePoints) && target.groundPlaneHitboxOverridePoints.length >= 3) {
            target.groundPlaneHitboxOverridePoints = translatePointArray(target.groundPlaneHitboxOverridePoints, dx, dy, mapRef);
        }

        if (target.visualHitbox) {
            translateHitboxInPlace(target.visualHitbox, dx, dy, mapRef);
        }
        if (target.groundPlaneHitbox && target.groundPlaneHitbox !== target.visualHitbox) {
            translateHitboxInPlace(target.groundPlaneHitbox, dx, dy, mapRef);
        }
        if (target.hitbox && target.hitbox !== target.groundPlaneHitbox && target.hitbox !== target.visualHitbox) {
            translateHitboxInPlace(target.hitbox, dx, dy, mapRef);
        }

        if (target.type === "placedObject") {
            clearMovedPlacedObjectMountState(target);
        }

        syncMovedObjectNodeState(target, mapRef, dragState);
        return true;
    }

    function beginMoveObjectDrag(wizardRef, worldX, worldY) {
        if (!wizardRef || !keysPressed[" "]) return false;
        const target = getObjectTargetAt(wizardRef, worldX, worldY);
        if (!target || !isValidObjectTargetForSpell("moveobject", target, wizardRef)) return false;

        const mapRef = target.map || wizardRef.map || null;
        const anchor = getMoveObjectAnchorPoint(target);
        if (!mapRef || !anchor) return false;

        wizardRef.moveObjectDragState = {
            target,
            offsetX: (typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(worldX, anchor.x)
                : (anchor.x - worldX),
            offsetY: (typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(worldY, anchor.y)
                : (anchor.y - worldY),
            occupiesNodeObjects: !!(
                target.node &&
                Array.isArray(target.node.objects) &&
                target.node.objects.includes(target)
            ),
            currentOccupancyNode: target.node || null
        };
        return true;
    }

    function updateMoveObjectDrag(wizardRef, worldX, worldY) {
        const dragState = wizardRef && wizardRef.moveObjectDragState;
        if (!dragState || !dragState.target) return false;
        const target = dragState.target;
        const mapRef = target.map || wizardRef.map || null;
        if (!mapRef || target.gone || target.vanishing) {
            cancelDragSpell(wizardRef, "moveobject");
            return false;
        }
        const desired = wrapWorldPointForMap(
            mapRef,
            Number(worldX) + Number(dragState.offsetX || 0),
            Number(worldY) + Number(dragState.offsetY || 0)
        );
        return applyMoveObjectTargetPosition(target, desired.x, desired.y, dragState);
    }

    function getVanishWallPreviewPolygonForHover(wizardRef, candidate, worldX, worldY) {
        if (!wizardRef || !candidate || candidate.gone || candidate.vanishing) return null;
        if (candidate.type !== "wallSection") return null;
        if (typeof candidate.getVanishPreviewPolygonForRange !== "function") return null;
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;

        const mouseScreen = (
            typeof mousePos !== "undefined" &&
            mousePos &&
            Number.isFinite(mousePos.screenX) &&
            Number.isFinite(mousePos.screenY)
        ) ? { x: mousePos.screenX, y: mousePos.screenY } : (
            (typeof worldToScreen === "function")
                ? worldToScreen({ x: Number(worldX), y: Number(worldY) })
                : null
        );
        if (!mouseScreen || !Number.isFinite(mouseScreen.x) || !Number.isFinite(mouseScreen.y)) return null;
        if (typeof candidate.getSegmentAtScreenPoint !== "function") return null;

        const hitSegment = candidate.getSegmentAtScreenPoint(
            Number(mouseScreen.x),
            Number(mouseScreen.y),
            {
                worldX: Number(worldX),
                worldY: Number(worldY),
                worldToScreenFn: (typeof worldToScreen === "function") ? worldToScreen : null,
                viewscale: Number.isFinite(viewscale) ? Number(viewscale) : 1,
                xyratio: Number.isFinite(xyratio) ? Number(xyratio) : 0.66
            }
        );
        if (!hitSegment || !Number.isFinite(hitSegment.tStart) || !Number.isFinite(hitSegment.tEnd)) return null;

        return candidate.getVanishPreviewPolygonForRange({
            tStart: Number(hitSegment.tStart),
            tEnd: Number(hitSegment.tEnd)
        });
    }

    function getHoverTargetForCurrentSpell(wizardRef, worldX, worldY) {
        if (!wizardRef || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const spell = wizardRef.currentSpell;
        if (spellSupportsObjectTargeting(spell)) {
            return getObjectTargetAt(wizardRef, worldX, worldY);
        }
        if (spell === "wall" || spell === "buildroad" || spell === "firewall") {
            return getSameTypeObjectTargetAt(wizardRef, spell, worldX, worldY);
        }
        if (spell === "placeobject") {
            const category = (typeof wizardRef.selectedPlaceableCategory === "string")
                ? wizardRef.selectedPlaceableCategory.trim().toLowerCase()
                : "";
            if (category === "windows" || category === "doors") {
                const placement = getPlaceObjectPlacementCandidate(wizardRef, worldX, worldY);
                return placement && placement.targetWall ? placement.targetWall : null;
            }
            if (category === "roof") {
                const placement = getRoofPlacementCandidate(wizardRef, worldX, worldY);
                return placement && placement.targetWall ? placement.targetWall : null;
            }
        }
        return null;
    }

    function isValidHoverTargetForCurrentSpell(wizardRef, candidate, worldX, worldY) {
        if (!wizardRef || !candidate || candidate.gone || candidate.vanishing) return false;
        const spell = wizardRef.currentSpell;
        if (spellSupportsObjectTargeting(spell)) {
            if (hasSpellAlreadyTargetedObject(wizardRef, spell, candidate)) return false;
            return isValidObjectTargetForSpell(spell, candidate, wizardRef);
        }
        if (spell === "wall" || spell === "buildroad" || spell === "firewall") {
            const objectType = getDragSpellObjectType(spell);
            if (!objectType) return false;
            if (candidate.type !== objectType) return false;
            return !hasSpellAlreadyTargetedObject(wizardRef, spell, candidate);
        }
        if (spell === "placeobject") {
            const category = (typeof wizardRef.selectedPlaceableCategory === "string")
                ? wizardRef.selectedPlaceableCategory.trim().toLowerCase()
                : "";
            if (category === "windows" || category === "doors") {
                if (candidate.type !== "wallSection") return false;
                const placement = getPlaceObjectPlacementCandidate(wizardRef, worldX, worldY);
                return !!(placement && placement.targetWall === candidate);
            }
            if (category === "roof") {
                if (candidate.type !== "wallSection") return false;
                const placement = getRoofPlacementCandidate(wizardRef, worldX, worldY);
                return !!(placement && placement.targetWall === candidate && Array.isArray(placement.wallSections) && placement.wallSections.length >= 3);
            }
            return false;
        }
        return false;
    }

    function getPlaceObjectPlacementCandidate(wizardRef, worldX, worldY) {
        if (!wizardRef || !wizardRef.map || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const category = (typeof wizardRef.selectedPlaceableCategory === "string")
            ? wizardRef.selectedPlaceableCategory.trim().toLowerCase()
            : "";
        if (category === "roof") return getRoofPlacementCandidate(wizardRef, worldX, worldY);
        if (category !== "windows" && category !== "doors") return null;

        const placeableScale = Number.isFinite(wizardRef.selectedPlaceableScale)
            ? Number(wizardRef.selectedPlaceableScale)
            : 1;
        const scaleMin = Number.isFinite(wizardRef.selectedPlaceableScaleMin) ? wizardRef.selectedPlaceableScaleMin : 0.2;
        const scaleMax = Number.isFinite(wizardRef.selectedPlaceableScaleMax) ? wizardRef.selectedPlaceableScaleMax : 5;
        const clampedScale = Math.max(scaleMin, Math.min(scaleMax, placeableScale));
        const selectedAnchorY = Number.isFinite(wizardRef.selectedPlaceableAnchorY)
            ? Number(wizardRef.selectedPlaceableAnchorY)
            : 1;
        const effectiveAnchorY = (category === "windows") ? 0.5 : selectedAnchorY;
        const windowWorldWidth = clampedScale;
        // Height fit is in world units; object height is clampedScale (not screen-scaled).
        const windowWorldHeight = clampedScale;
        const mouseScreen = (
            typeof mousePos !== "undefined" &&
            mousePos &&
            Number.isFinite(mousePos.screenX) &&
            Number.isFinite(mousePos.screenY)
        ) ? { x: mousePos.screenX, y: mousePos.screenY } : worldToScreen({ x: worldX, y: worldY });
        if (!mouseScreen || !Number.isFinite(mouseScreen.x) || !Number.isFinite(mouseScreen.y)) return null;
        const worldToScreenFn = (typeof worldToScreen === "function") ? worldToScreen : null;
        if (!worldToScreenFn) return null;

        const pickResult = pickObjectViaRenderingColorId((obj) =>
            !!(obj && obj.type === "wallSection" && !obj.gone && !obj.vanishing)
        );
        if (!pickResult || !pickResult.picked || pickResult.picked.type !== "wallSection") return null;
        const section = pickResult.picked;
        if (!section.startPoint || !section.endPoint) return null;
        const profile = section.getWallProfile();
        if (!profile) return null;

        const mapRef = wizardRef.map;
        const vs = Number.isFinite(viewscale) ? viewscale : 1;
        const xyr = Number.isFinite(xyratio) ? xyratio : 0.66;

        const wallHeight = Math.max(0, Number(section.height) || 0);
        const halfT = Math.max(0.001, Number(section.thickness) || 0.001) * 0.5;

        const sx = Number(section.startPoint.x);
        const sy = Number(section.startPoint.y);
        const ex = Number(section.endPoint.x);
        const ey = Number(section.endPoint.y);
        if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
            !Number.isFinite(ex) || !Number.isFinite(ey)) return null;

        const dx = ex - sx;
        const dy = ey - sy;
        const len = Math.hypot(dx, dy);
        if (!(len > 1e-6)) return null;

        const ux = dx / len;
        const uy = dy / len;
        const vx = -uy;
        const vy = ux;
        const { aLeft, aRight, bLeft, bRight } = profile;

        const toScreen = (pt, z) => {
            const s = worldToScreenFn(pt);
            return { x: s.x, y: s.y - z * vs * xyr };
        };

        const longFaceA = [toScreen(aLeft, 0), toScreen(bLeft, 0), toScreen(bLeft, wallHeight), toScreen(aLeft, wallHeight)];
        const longFaceB = [toScreen(aRight, 0), toScreen(bRight, 0), toScreen(bRight, wallHeight), toScreen(aRight, wallHeight)];
        const topFace = [toScreen(aLeft, wallHeight), toScreen(bLeft, wallHeight), toScreen(bRight, wallHeight), toScreen(aRight, wallHeight)];
        const faceDepth = pts => pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
        const longAFront = faceDepth(longFaceA) >= faceDepth(longFaceB);
        const facingSign = longAFront ? 1 : -1;

        const sectionStartScreen = (facingSign > 0) ? longFaceA[0] : longFaceB[0];
        const sectionEndScreen = (facingSign > 0) ? longFaceA[1] : longFaceB[1];
        const sdx = sectionEndScreen.x - sectionStartScreen.x;
        const sdy = sectionEndScreen.y - sectionStartScreen.y;
        const sLen2 = sdx * sdx + sdy * sdy;
        if (!(sLen2 > 1e-6)) return null;

        const wallPosition = (typeof section.getWallPositionAtScreenPoint === "function")
            ? section.getWallPositionAtScreenPoint(
                Number(mouseScreen.x),
                Number(mouseScreen.y),
                {
                    worldX: Number(worldX),
                    worldY: Number(worldY),
                    worldToScreenFn,
                    viewscale: vs,
                    xyratio: xyr
                }
            )
            : null;
        const mouseRelX = mouseScreen.x - sectionStartScreen.x;
        const mouseRelY = mouseScreen.y - sectionStartScreen.y;
        const fallbackProjT = Math.max(0, Math.min(1,
            (mouseRelX * sdx + mouseRelY * sdy) / sLen2));
        const sectionProjT = Number.isFinite(wallPosition)
            ? Math.max(0, Math.min(1, Number(wallPosition)))
            : fallbackProjT;

        const sectionLength = len;
        const halfWidth = windowWorldWidth * 0.5;
        const fitsLength = sectionLength + 1e-6 >= windowWorldWidth;
        const fitsHeight = windowWorldHeight <= wallHeight + 1e-6;

        let along = sectionProjT * sectionLength;
        along = fitsLength
            ? Math.max(halfWidth, Math.min(sectionLength - halfWidth, along))
            : Math.max(0, Math.min(sectionLength, along));

        const sectionCenterAlong = sectionLength * 0.5;
        const sectionCenterWorld = {
            x: sx + ux * sectionCenterAlong + vx * halfT * facingSign,
            y: sy + uy * sectionCenterAlong + vy * halfT * facingSign
        };
        const faceMinX = Math.min(sectionStartScreen.x, sectionEndScreen.x);
        const faceMaxX = Math.max(sectionStartScreen.x, sectionEndScreen.x);
        const faceSpanX = faceMaxX - faceMinX;
        const centerSnapPx = 10;
        let centerDistPx = Infinity;
        if (faceSpanX > 1e-4) {
            centerDistPx = Math.abs(mouseScreen.x - (faceMinX + faceMaxX) * 0.5);
        } else {
            let topMinY = Infinity, topMaxY = -Infinity;
            for (let ti = 0; ti < topFace.length; ti++) {
                if (topFace[ti].y < topMinY) topMinY = topFace[ti].y;
                if (topFace[ti].y > topMaxY) topMaxY = topFace[ti].y;
            }
            if (Number.isFinite(topMinY) && Number.isFinite(topMaxY) && (topMaxY - topMinY) > 1e-4) {
                centerDistPx = Math.abs(mouseScreen.y - (topMinY + topMaxY) * 0.5);
            }
        }
        let centerSnapActive = false;
        if (Number.isFinite(centerDistPx) && centerDistPx <= centerSnapPx) {
            along = fitsLength
                ? Math.max(halfWidth, Math.min(sectionLength - halfWidth, sectionCenterAlong))
                : Math.max(0, Math.min(sectionLength, sectionCenterAlong));
            centerSnapActive = true;
        }

        const rotDeg = Math.atan2(uy, ux) * (180 / Math.PI);
        const isDoorPlacement = category === "doors";
        const hitboxHalfT = isDoorPlacement ? (halfT * 1.1) : halfT;

        let centerX = sx + ux * along;
        let centerY = sy + uy * along;
        let wallFaceCenterX = centerX + vx * halfT * facingSign;
        let wallFaceCenterY = centerY + vy * halfT * facingSign;
        if (mapRef && typeof mapRef.wrapWorldX === "function") {
            centerX = mapRef.wrapWorldX(centerX);
            wallFaceCenterX = mapRef.wrapWorldX(wallFaceCenterX);
        }
        if (mapRef && typeof mapRef.wrapWorldY === "function") {
            centerY = mapRef.wrapWorldY(centerY);
            wallFaceCenterY = mapRef.wrapWorldY(wallFaceCenterY);
        }

        const normalBias = (category === "windows") ? 0.001 : 0;
        const desiredBaseX = wallFaceCenterX + vx * normalBias * facingSign;
        const desiredBaseY = wallFaceCenterY + vy * normalBias * facingSign;
        const verticalOffset = (1 - effectiveAnchorY) * windowWorldHeight;
        let snappedX = desiredBaseX;
        let snappedY = isDoorPlacement
            ? (desiredBaseY - verticalOffset)
            : desiredBaseY;
        const wallBottomZ = Number.isFinite(section.bottomZ) ? Number(section.bottomZ) : 0;
        const snappedZ = (category === "windows") ? (wallBottomZ + wallHeight * 0.5) : 0;
        if (mapRef && typeof mapRef.wrapWorldX === "function") snappedX = mapRef.wrapWorldX(snappedX);
        if (mapRef && typeof mapRef.wrapWorldY === "function") snappedY = mapRef.wrapWorldY(snappedY);

        const p1 = { x: centerX - ux * halfWidth + vx * hitboxHalfT, y: centerY - uy * halfWidth + vy * hitboxHalfT };
        const p2 = { x: centerX + ux * halfWidth + vx * hitboxHalfT, y: centerY + uy * halfWidth + vy * hitboxHalfT };
        const p3 = { x: centerX + ux * halfWidth - vx * hitboxHalfT, y: centerY + uy * halfWidth - vy * hitboxHalfT };
        const p4 = { x: centerX - ux * halfWidth - vx * hitboxHalfT, y: centerY - uy * halfWidth - vy * hitboxHalfT };
        const wrapPt = (pt) => ({
            x: (mapRef && typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(pt.x) : pt.x,
            y: (mapRef && typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(pt.y) : pt.y
        });

        return {
            valid: fitsLength && fitsHeight,
            reason: !fitsLength
                ? (isDoorPlacement ? "Door is wider than this wall section." : "Window is wider than this wall section.")
                : (!fitsHeight
                    ? (isDoorPlacement ? "Door is taller than this wall." : "Window is taller than this wall.")
                    : null),
            targetWall: section,
            mountedWallLineGroupId: section.id,
            mountedSectionId: section.id,
            mountedWallSectionUnitId: section.id,
            mountedWallFacingSign: facingSign,
            snappedX,
            snappedY,
            snappedZ,
            snappedRotationDeg: rotDeg,
            wallGroundHitboxPoints: [wrapPt(p1), wrapPt(p2), wrapPt(p3), wrapPt(p4)],
            wallHeight,
            wallThickness: halfT * 2,
            centerSnapActive,
            sectionCenterX: (mapRef && typeof mapRef.wrapWorldX === "function")
                ? mapRef.wrapWorldX(sectionCenterWorld.x) : sectionCenterWorld.x,
            sectionCenterY: (mapRef && typeof mapRef.wrapWorldY === "function")
                ? mapRef.wrapWorldY(sectionCenterWorld.y) : sectionCenterWorld.y,
            sectionFacingSign: facingSign,
            sectionNormalX: vx,
            sectionNormalY: vy,
            sectionDirX: ux,
            sectionDirY: uy,
            wallFaceCenterX,
            wallFaceCenterY,
            placementHalfWidth: halfWidth,
            placementCenterX: desiredBaseX,
            placementCenterY: desiredBaseY
        };
    }

    function getRoofPlacementCandidate(wizardRef, worldX, worldY) {
        const roofApi = (typeof globalThis !== "undefined" && globalThis.Roof) ? globalThis.Roof : null;
        if (!roofApi || typeof roofApi.getPlacementCandidate !== "function") return null;
        return roofApi.getPlacementCandidate(wizardRef, worldX, worldY, { maxDepth: null });
    }

    function beginDragSpell(wizardRef, spellName, worldX, worldY) {
        if (!wizardRef || wizardRef.castDelay) return false;
        if (!keysPressed[" "]) return false;
        const snapTarget = getDragStartSnapTargetAt(wizardRef, spellName, worldX, worldY);

        if (spellName === "wall") {
            if (!keysPressed[" "]) return false;
            const mapRef = wizardRef.map || null;
            const wrappedMouseStart = wrapWorldPointForMap(mapRef, worldX, worldY);
            const nearestAnchor = (
                mapRef && typeof mapRef.worldToNodeOrMidpoint === "function"
            ) ? mapRef.worldToNodeOrMidpoint(worldX, worldY) : null;
            const startPoint = (snapTarget && snapTarget.point)
                ? wrapWorldPointForMap(mapRef, Number(snapTarget.point.x), Number(snapTarget.point.y))
                : (
                    nearestAnchor && Number.isFinite(nearestAnchor.x) && Number.isFinite(nearestAnchor.y)
                        ? wrapWorldPointForMap(
                            mapRef,
                            Number(nearestAnchor.x),
                            Number(nearestAnchor.y)
                        )
                        : wrapWorldPointForMap(mapRef, worldX, worldY)
                );
            if (!startPoint) return false;
            wizardRef.wallLayoutMode = true;
            wizardRef.wallStartPoint = startPoint;
            wizardRef.wallStartReferenceWall = (snapTarget && snapTarget.obj && snapTarget.obj.type === "wallSection")
                ? snapTarget.obj
                : null;
            wizardRef.wallStartSplitReference = (
                snapTarget &&
                snapTarget.splitReference &&
                snapTarget.splitReference.wall &&
                snapTarget.splitReference.anchor
            ) ? {
                wall: snapTarget.splitReference.wall,
                anchor: snapTarget.splitReference.anchor
            } : null;
            wizardRef.wallStartFromExistingWall = !!wizardRef.wallStartReferenceWall;
            wizardRef.wallDragMouseStartWorld = wizardRef.wallStartFromExistingWall
                ? { x: Number(wrappedMouseStart.x), y: Number(wrappedMouseStart.y) }
                : { x: Number(startPoint.x), y: Number(startPoint.y) };
            wizardRef.wallPreviewPlacement = null;
            ensureDragPreview(wizardRef, "wall");
            return true;
        }

        if (spellName === "buildroad") {
            const roadNode = (snapTarget && snapTarget.node)
                ? snapTarget.node
                : wizardRef.map.worldToNode(worldX, worldY);
            if (!roadNode) return false;
            wizardRef.roadLayoutMode = true;
            wizardRef.roadStartPoint = roadNode;
            ensureDragPreview(wizardRef, "buildroad");
            return true;
        }

        if (spellName === "firewall") {
            wizardRef.firewallLayoutMode = true;
            wizardRef.firewallStartPoint = (snapTarget && snapTarget.point)
                ? { x: snapTarget.point.x, y: snapTarget.point.y }
                : { x: worldX, y: worldY };
            ensureDragPreview(wizardRef, "firewall");
            return true;
        }

        if (isMoveObjectToolName(spellName)) {
            return beginMoveObjectDrag(wizardRef, worldX, worldY);
        }

        if (isVanishToolName(spellName)) {
            wizardRef.vanishDragMode = true;
            ensureVanishDragTargetingState(wizardRef);
            queueVanishDragTargetAtPoint(wizardRef, worldX, worldY);
            return true;
        }

        return false;
    }

    function updateDragPreview(wizardRef, worldX, worldY) {
        if (!wizardRef || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
        if (!keysPressed[" "]) {
            if (wizardRef.currentSpell === "wall") cancelDragSpell(wizardRef, "wall");
            if (wizardRef.currentSpell === "buildroad") cancelDragSpell(wizardRef, "buildroad");
            if (wizardRef.currentSpell === "firewall") cancelDragSpell(wizardRef, "firewall");
            if (isMoveObjectToolName(wizardRef.currentSpell)) cancelDragSpell(wizardRef, wizardRef.currentSpell);
            if (isVanishToolName(wizardRef.currentSpell)) cancelDragSpell(wizardRef, wizardRef.currentSpell);
            return false;
        }
        if (wizardRef.currentSpell === "wall" && wizardRef.wallLayoutMode && wizardRef.wallStartPoint) {
            const adjustedPoint = getAdjustedWallDragWorldPoint(wizardRef, worldX, worldY);
            if (!adjustedPoint) return false;
            return true;
        }
        if (wizardRef.currentSpell === "buildroad" && wizardRef.roadLayoutMode && wizardRef.roadStartPoint) {
            return true;
        }
        if (wizardRef.currentSpell === "firewall" && wizardRef.firewallLayoutMode && wizardRef.firewallStartPoint) {
            return true;
        }
        if (isMoveObjectToolName(wizardRef.currentSpell) && wizardRef.moveObjectDragState) {
            return updateMoveObjectDrag(wizardRef, worldX, worldY);
        }
        if (isVanishToolName(wizardRef.currentSpell) && wizardRef.vanishDragMode) {
            queueVanishDragTargetAtPoint(wizardRef, worldX, worldY);
            return true;
        }
        return false;
    }

    function completeDragSpell(wizardRef, spellName, worldX, worldY) {
        if (!wizardRef || wizardRef.castDelay) return false;

        if (spellName === "wall") {
            if (!isDragSpellActive(wizardRef, "wall")) return false;
            const adjustedPoint = getAdjustedWallDragWorldPoint(wizardRef, worldX, worldY);
            if (!adjustedPoint) {
                cancelDragSpell(wizardRef, "wall");
                return true;
            }
            const startPoint = wizardRef.wallStartPoint;
            let placementStartPoint = startPoint;
            let placementEndPoint = adjustedPoint;
            const placementOptions = {
                rawStartWorld: wizardRef.wallDragMouseStartWorld || startPoint,
                startFromExistingWall: !!wizardRef.wallStartFromExistingWall,
                startReferenceWall: wizardRef.wallStartReferenceWall || null,
                startSplitReference: wizardRef.wallStartSplitReference || null,
                endSplitReference: null
            };

            const previewPlacement = (
                wizardRef.wallPreviewPlacement &&
                typeof wizardRef.wallPreviewPlacement === "object"
            ) ? wizardRef.wallPreviewPlacement : null;
            if (
                previewPlacement &&
                previewPlacement.startWorld &&
                previewPlacement.endWorld &&
                pointsMatchWorld(wizardRef.map, startPoint, previewPlacement.startWorld)
            ) {
                placementStartPoint = previewPlacement.startWorld;
                placementEndPoint = previewPlacement.endWorld;
                if (
                    previewPlacement.rawStartWorld &&
                    Number.isFinite(previewPlacement.rawStartWorld.x) &&
                    Number.isFinite(previewPlacement.rawStartWorld.y)
                ) {
                    placementOptions.rawStartWorld = {
                        x: Number(previewPlacement.rawStartWorld.x),
                        y: Number(previewPlacement.rawStartWorld.y)
                    };
                }
                if (Array.isArray(previewPlacement.segments)) {
                    placementOptions.preResolvedSegments = previewPlacement.segments;
                }
                if (previewPlacement.plan) {
                    placementOptions.preResolvedPlan = previewPlacement.plan;
                }
            }

            const findEndSplitReference = (probePoint) => {
                if (!probePoint || !Number.isFinite(probePoint.x) || !Number.isFinite(probePoint.y)) return null;
                const endSnapTarget = getDragStartSnapTargetAt(wizardRef, "wall", Number(probePoint.x), Number(probePoint.y));
                if (!endSnapTarget || !endSnapTarget.splitReference) return null;
                const splitRef = endSnapTarget.splitReference;
                if (!splitRef.wall || !splitRef.anchor) return null;
                const startSplit = placementOptions.startSplitReference;
                if (
                    startSplit &&
                    startSplit.wall === splitRef.wall &&
                    pointsMatchWorld(wizardRef.map, startSplit.anchor, splitRef.anchor)
                ) {
                    return null;
                }
                return splitRef;
            };
            placementOptions.endSplitReference = findEndSplitReference(placementEndPoint)
                || findEndSplitReference(adjustedPoint)
                || null;

            if (pointsMatchWorld(wizardRef.map, placementStartPoint, placementEndPoint)) {
                cancelDragSpell(wizardRef, "wall");
                return true;
            }

            // Create permanent WallSectionUnit walls from the drag.
            if (typeof WallSectionUnit !== "undefined" && wizardRef.map) {
                const thickness = Number.isFinite(wizardRef.selectedWallThickness)
                    ? wizardRef.selectedWallThickness : 0.1;
                const height = Number.isFinite(wizardRef.selectedWallHeight)
                    ? wizardRef.selectedWallHeight : 1;
                const wallTexturePath = getSelectedWallTexture(wizardRef);
                const wallLayer = getActiveWallPlacementLayer(wizardRef);
                const wallBaseZ = getWallPlacementBaseZ(wizardRef, wallLayer);
                let resolvedPlacementSegments = Array.isArray(placementOptions.preResolvedSegments)
                    ? placementOptions.preResolvedSegments
                    : null;
                if (!resolvedPlacementSegments && typeof WallSectionUnit.resolvePlacementSegmentsFromWorldPoints === "function") {
                    const resolved = WallSectionUnit.resolvePlacementSegmentsFromWorldPoints(
                        wizardRef.map,
                        placementStartPoint,
                        placementEndPoint,
                        placementOptions
                    );
                    if (resolved && Array.isArray(resolved.segments)) {
                        resolvedPlacementSegments = resolved.segments;
                        placementOptions.preResolvedSegments = resolved.segments;
                        if (resolved.plan) placementOptions.preResolvedPlan = resolved.plan;
                    }
                }
                if (!doesWallPlacementFitActiveFloorLayer(wizardRef.map, resolvedPlacementSegments, wallLayer)) {
                    message(`Cannot place wall outside floor level ${wallLayer > 0 ? `+${wallLayer}` : wallLayer}.`);
                    cancelDragSpell(wizardRef, "wall");
                    return true;
                }
                // Snapshot existing walls so we can detect newly created/merged ones.
                const wallsBefore = new Set(
                    Array.from(WallSectionUnit._allSections.values())
                        .filter(w => w && !w.gone && w.map === wizardRef.map)
                );
                const result = WallSectionUnit.createPlacementFromWorldPoints(
                    wizardRef.map, placementStartPoint, placementEndPoint, {
                        thickness,
                        height,
                        bottomZ: wallBaseZ,
                        traversalLayer: wallLayer,
                        level: wallLayer,
                        wallTexturePath,
                        ...placementOptions
                    }
                );
                if (result && Array.isArray(result.sections)) {
                    for (let i = 0; i < result.sections.length; i++) {
                        const w = result.sections[i];
                        if (w && !w.gone && typeof w.addToMapNodes === "function") {
                            w.addToMapNodes();
                        }
                    }
                    // Also check for brand-new walls that ended up outside
                    // result.sections (e.g. created during cross-wall splits
                    // inside createPlacementFromWorldPoints).
                    const wallsAfter = Array.from(WallSectionUnit._allSections.values())
                        .filter(w => w && !w.gone && w.map === wizardRef.map && !wallsBefore.has(w));
                    // Combine: result.sections (may include pre-existing walls
                    // that grew via merge) + truly new walls not yet listed.
                    const seen = new Set(result.sections);
                    const wallsToSplit = result.sections.slice();
                    for (let i = 0; i < wallsAfter.length; i++) {
                        if (!seen.has(wallsAfter[i])) wallsToSplit.push(wallsAfter[i]);
                    }
                    // Immediately split any wall that crosses a section seam
                    // into separate runtime wall objects (one per section).
                    const splitting = (typeof globalThis !== "undefined") && globalThis.__wallSectionSplitting;
                    if (splitting && wizardRef.map._prototypeSectionState) {
                        for (let i = 0; i < wallsToSplit.length; i++) {
                            const wall = wallsToSplit[i];
                            if (!wall || wall.gone) continue;
                            if (typeof wall._collectOrderedLineAnchors !== "function") continue;
                            let orderedAnchors;
                            try { orderedAnchors = wall._collectOrderedLineAnchors(); } catch (_e) { continue; }
                            if (!Array.isArray(orderedAnchors) || orderedAnchors.length < 2) continue;
                            const record = wall.saveJson();
                            const splitResult = splitting.computeWallRecordSplits(record, orderedAnchors);
                            if (!splitResult || !splitResult.needsSplit) continue;
                            // Remove original wall; no attached objects on a freshly built wall.
                            wall._removeWallPreserving([], { skipAutoMerge: true });
                            // Create runtime wall objects for each piece.
                            for (let p = 0; p < splitResult.pieces.length; p++) {
                                const pieceRecord = splitResult.pieces[p].record;
                                const piece = WallSectionUnit.loadJson(pieceRecord, wizardRef.map);
                                if (piece) {
                                    piece.addToMapNodes();
                                    if (typeof piece.handleJoineryOnPlacement === "function") {
                                        piece.handleJoineryOnPlacement();
                                    }
                                }
                            }
                        }
                    }
                }
            }
            cancelDragSpell(wizardRef, "wall");
            return true;
        }

        if (spellName === "buildroad") {
            if (!isDragSpellActive(wizardRef, "buildroad")) return false;
            const roadNode = wizardRef.map.worldToNode(worldX, worldY);
            if (!roadNode) {
                cancelDragSpell(wizardRef, "buildroad");
                return true;
            }
            const nodeA = wizardRef.roadStartPoint;
            const nodeB = roadNode;
            const width = (nodeA === nodeB) ? 1 : getSelectedRoadWidth(wizardRef);
            const roadNodes = wizardRef.map.getHexLine(nodeA, nodeB, width);
            const selectedFlooring = getSelectedFlooringTexture(wizardRef);
            roadNodes.forEach(node => {
                const hasRoad = (typeof Road !== "undefined" && typeof Road.hasMatchingRoadAtNode === "function")
                    ? Road.hasMatchingRoadAtNode(node, selectedFlooring)
                    : (node.objects && node.objects.some(obj => obj.type === "road"));
                if (!hasRoad) {
                    new Road({x: node.x, y: node.y}, [], wizardRef.map, {
                        fillTexturePath: selectedFlooring
                    });
                    markLevel0SurfaceRoadDirtyForNode(wizardRef.map, node);
                }
            });
            if (!editorMode) {
                wizardRef.magic -= 5;
            }
            cancelDragSpell(wizardRef, "buildroad");
            cooldown(wizardRef, wizardRef.cooldownTime);
            return true;
        }

        if (spellName === "firewall") {
            if (!isDragSpellActive(wizardRef, "firewall")) return false;
            const startPoint = wizardRef.firewallStartPoint;
            const endPoint = { x: worldX, y: worldY };
            const dx = endPoint.x - startPoint.x;
            const dy = endPoint.y - startPoint.y;
            const dist = Math.hypot(dx, dy);
            const spacing = 0.5;
            const steps = Math.max(1, Math.ceil(dist / spacing));

            for (let i = 0; i <= steps; i++) {
                const t = steps === 0 ? 0 : i / steps;
                const px = startPoint.x + dx * t;
                const py = startPoint.y + dy * t;
                new FirewallEmitter({ x: px, y: py }, wizardRef.map, (i * 11) % 25);
            }
            cancelDragSpell(wizardRef, "firewall");
            cooldown(wizardRef, wizardRef.cooldownTime);
            return true;
        }

        if (isMoveObjectToolName(spellName)) {
            if (!isDragSpellActive(wizardRef, spellName)) return false;
            updateMoveObjectDrag(wizardRef, worldX, worldY);
            cancelDragSpell(wizardRef, spellName);
            return true;
        }

        if (isVanishToolName(spellName)) {
            if (!isDragSpellActive(wizardRef, spellName)) return false;
            if (Number.isFinite(worldX) && Number.isFinite(worldY)) {
                queueVanishDragTargetAtPoint(wizardRef, worldX, worldY);
            }
            const state = wizardRef.vanishDragTargetingState;

            // Detect whether this was a quick single-click on one wall
            // BEFORE calling buildVanishBurstTargetsFromQueuedState,
            // because that function destructively splits the wall into
            // sub-sections and removes the original.
            const isSingleWallClick = (
                state &&
                state.wallRanges instanceof Map &&
                state.wallRanges.size === 1 &&
                state.queuedObjects.length === 0
            );
            const singleWallEntry = isSingleWallClick
                ? [...state.wallRanges.values()][0]
                : null;
            const singleWall = singleWallEntry?.wall ?? null;

            const VANISH_DBLCLICK_MS = 400;
            const now = Date.now();
            const pending = wizardRef._pendingVanishWallBurst;

            // Double-click: second click on the same wall within the
            // timeout window.  Cancel the deferred partial vanish and
            // fire a whole-wall vanish instead (no split needed).
            if (
                pending &&
                singleWall &&
                pending.wall === singleWall &&
                (now - pending.time) < VANISH_DBLCLICK_MS
            ) {
                clearTimeout(pending.timeout);
                wizardRef._pendingVanishWallBurst = null;
                cancelDragSpell(wizardRef, spellName);
                singleWall._vanishAsWholeSection = true;
                castQueuedVanishBurst(wizardRef, [singleWall], spellName);
                return true;
            }

            // First click on a single wall: defer to allow a potential
            // double-click.  Do NOT build burst targets yet (that
            // would split the wall and destroy the original object,
            // making the second click pick a different reference).
            if (isSingleWallClick && singleWall && !singleWall.gone && !singleWall.vanishing) {
                const savedRange = {
                    tStart: Number(singleWallEntry.tStart),
                    tEnd: Number(singleWallEntry.tEnd),
                    firstTouchT: Number(singleWallEntry.firstTouchT),
                    lastTouchT: Number(singleWallEntry.lastTouchT)
                };
                cancelDragSpell(wizardRef, spellName);
                const pendingBurst = {
                    wall: singleWall,
                    spellName,
                    range: savedRange,
                    time: now,
                    timeout: setTimeout(() => {
                        if (wizardRef._pendingVanishWallBurst !== pendingBurst) return;
                        wizardRef._pendingVanishWallBurst = null;
                        if (singleWall.gone || singleWall.vanishing) return;
                        // NOW split and fire the partial-wall vanish.
                        if (typeof singleWall.splitIntoTargetableVanishSegments === "function") {
                            const split = singleWall.splitIntoTargetableVanishSegments(
                                { tStart: savedRange.tStart, tEnd: savedRange.tEnd },
                                { targetSegmentLengthWorld: VANISH_WALL_TARGET_SEGMENT_LENGTH_WORLD }
                            );
                            if (split && Array.isArray(split.targetSegments) && split.targetSegments.length > 0) {
                                const segments = split.targetSegments.slice();
                                if (
                                    Number.isFinite(savedRange.firstTouchT) &&
                                    Number.isFinite(savedRange.lastTouchT) &&
                                    savedRange.lastTouchT < savedRange.firstTouchT
                                ) {
                                    segments.reverse();
                                }
                                castQueuedVanishBurst(wizardRef, segments, pendingBurst.spellName);
                                return;
                            }
                        }
                        // Fallback: vanish the whole wall.
                        castQueuedVanishBurst(wizardRef, [singleWall], pendingBurst.spellName);
                    }, VANISH_DBLCLICK_MS)
                };
                wizardRef._pendingVanishWallBurst = pendingBurst;
                return true;
            }

            // Non-wall target, drag selection, or empty click.
            // Build burst targets and fire immediately.
            const burstTargets = buildVanishBurstTargetsFromQueuedState(wizardRef);
            cancelDragSpell(wizardRef, spellName);

            // Flush any pending deferred burst first.
            if (pending) {
                clearTimeout(pending.timeout);
                wizardRef._pendingVanishWallBurst = null;
                if (pending.wall && !pending.wall.gone && !pending.wall.vanishing) {
                    if (typeof pending.wall.splitIntoTargetableVanishSegments === "function") {
                        const split = pending.wall.splitIntoTargetableVanishSegments(
                            { tStart: pending.range.tStart, tEnd: pending.range.tEnd },
                            { targetSegmentLengthWorld: VANISH_WALL_TARGET_SEGMENT_LENGTH_WORLD }
                        );
                        if (split && Array.isArray(split.targetSegments) && split.targetSegments.length > 0) {
                            castQueuedVanishBurst(wizardRef, split.targetSegments, pending.spellName || spellName);
                        } else {
                            castQueuedVanishBurst(wizardRef, [pending.wall], pending.spellName || spellName);
                        }
                    } else {
                        castQueuedVanishBurst(wizardRef, [pending.wall], pending.spellName || spellName);
                    }
                }
            }
            if (burstTargets.length > 0) {
                castQueuedVanishBurst(wizardRef, burstTargets, spellName);
            }
            return true;
        }

        return false;
    }

    const CHARACTER_COLLISION_ANIMAL_STEP_INTERVAL = 2;
    let collisionQueryStamp = 1;
    const collisionNearbyObjectsScratch = [];
    const collisionTargetsScratch = [];

    function getNearbyObjects(mapRef, hitbox, outArray = null, options = {}) {
        if (!mapRef || !hitbox || typeof hitbox.getBounds !== "function") return [];
        const bounds = hitbox.getBounds();
        if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
            return [];
        }

        const margin = Number.isFinite(options.margin) ? Number(options.margin) : 1.0;
        const requireCollisionHandler = !!options.requireCollisionHandler;
        const minNode = mapRef.worldToNode(bounds.x - margin, bounds.y - margin);
        const maxNode = mapRef.worldToNode(bounds.x + bounds.width + margin, bounds.y + bounds.height + margin);
        if (!minNode || !maxNode) return [];

        const toWrappedRanges = (startIdx, endIdx, size, wrapEnabled) => {
            if (!Number.isFinite(startIdx) || !Number.isFinite(endIdx) || !Number.isFinite(size) || size <= 0) {
                return [];
            }
            const sRaw = Math.floor(startIdx);
            const eRaw = Math.floor(endIdx);
            const lo = Math.min(sRaw, eRaw);
            const hi = Math.max(sRaw, eRaw);
            if (!wrapEnabled) {
                const s = Math.max(0, Math.min(size - 1, lo));
                const e = Math.max(0, Math.min(size - 1, hi));
                if (e < s) return [];
                return [{ start: s, end: e }];
            }
            if ((hi - lo + 1) >= size) return [{ start: 0, end: size - 1 }];
            const wrap = (n) => ((n % size) + size) % size;
            const s = wrap(lo);
            const e = wrap(hi);
            if (s <= e) return [{ start: s, end: e }];
            return [
                { start: 0, end: e },
                { start: s, end: size - 1 }
            ];
        };

        const xRanges = toWrappedRanges(minNode.xindex, maxNode.xindex, mapRef.width, !!mapRef.wrapX);
        const yRanges = toWrappedRanges(minNode.yindex, maxNode.yindex, mapRef.height, !!mapRef.wrapY);
        if (xRanges.length === 0 || yRanges.length === 0) return [];
        const nearbyObjects = Array.isArray(outArray) ? outArray : [];
        nearbyObjects.length = 0;

        collisionQueryStamp += 1;
        if (!Number.isFinite(collisionQueryStamp) || collisionQueryStamp > 2147483000) {
            collisionQueryStamp = 1;
        }
        const queryStamp = collisionQueryStamp;

        for (const xRange of xRanges) {
            for (let x = xRange.start; x <= xRange.end; x++) {
                for (const yRange of yRanges) {
                    for (let y = yRange.start; y <= yRange.end; y++) {
                        const node = mapRef.nodes[x] && mapRef.nodes[x][y] ? mapRef.nodes[x][y] : null;
                        if (!node || !Array.isArray(node.objects) || node.objects.length === 0) continue;
                        for (const obj of node.objects) {
                            if (!obj || obj.gone) continue;
                            if (requireCollisionHandler && typeof obj.handleCharacterCollision !== "function") continue;
                            if (obj._collisionQueryStamp === queryStamp) continue;
                            obj._collisionQueryStamp = queryStamp;
                            nearbyObjects.push(obj);
                        }
                    }
                }
            }
        }

        return nearbyObjects;
    }

    function getNearbyObjectsAroundWizard(mapRef, wizardRef, outArray = null, options = {}) {
        if (!mapRef || !wizardRef || typeof mapRef.worldToNode !== "function") return [];
        const centerNode = mapRef.worldToNode(wizardRef.x, wizardRef.y);
        if (!centerNode) return [];

        const tileRadius = Number.isFinite(options.tileRadius)
            ? Math.max(0, Math.floor(options.tileRadius))
            : 2;
        const requireCollisionHandler = !!options.requireCollisionHandler;
        const nearbyObjects = Array.isArray(outArray) ? outArray : [];
        nearbyObjects.length = 0;

        collisionQueryStamp += 1;
        if (!Number.isFinite(collisionQueryStamp) || collisionQueryStamp > 2147483000) {
            collisionQueryStamp = 1;
        }
        const queryStamp = collisionQueryStamp;

        const collectFromNode = (node) => {
            if (!node || !Array.isArray(node.objects) || node.objects.length === 0) return;
            for (const obj of node.objects) {
                if (!obj || obj.gone) continue;
                if (requireCollisionHandler && typeof obj.handleCharacterCollision !== "function") continue;
                if (obj._collisionQueryStamp === queryStamp) continue;
                obj._collisionQueryStamp = queryStamp;
                nearbyObjects.push(obj);
            }
        };

        if (typeof mapRef.getNodesInIndexWindow === "function") {
            const xStart = centerNode.xindex - tileRadius;
            const xEnd = centerNode.xindex + tileRadius;
            const yStart = centerNode.yindex - tileRadius;
            const yEnd = centerNode.yindex + tileRadius;
            const nearbyNodes = mapRef.getNodesInIndexWindow(xStart, xEnd, yStart, yEnd);
            for (let i = 0; i < nearbyNodes.length; i++) {
                collectFromNode(nearbyNodes[i]);
            }
            return nearbyObjects;
        }

        for (let dx = -tileRadius; dx <= tileRadius; dx++) {
            for (let dy = -tileRadius; dy <= tileRadius; dy++) {
                let xi = centerNode.xindex + dx;
                let yi = centerNode.yindex + dy;
                if (mapRef.wrapX && typeof mapRef.wrapIndexX === "function") {
                    xi = mapRef.wrapIndexX(xi);
                }
                if (mapRef.wrapY && typeof mapRef.wrapIndexY === "function") {
                    yi = mapRef.wrapIndexY(yi);
                }
                if (!mapRef.wrapX && (xi < 0 || xi >= mapRef.width)) continue;
                if (!mapRef.wrapY && (yi < 0 || yi >= mapRef.height)) continue;

                const node = mapRef.nodes[xi] && mapRef.nodes[xi][yi] ? mapRef.nodes[xi][yi] : null;
                collectFromNode(node);
            }
        }

        return nearbyObjects;
    }

    function updateCharacterObjectCollisions(wizardRef) {
        if (!wizardRef || !wizardRef.map) return;
        if (wizardRef.gone || wizardRef.dead) return;
        const target = wizardRef;
        const targetHitbox = target.visualHitbox || target.groundPlaneHitbox || target.hitbox;
        const activeFirewalls = Number(
            (typeof globalThis !== "undefined" && globalThis.activeFirewallEmitterCount)
                ? globalThis.activeFirewallEmitterCount
                : 0
        );

        if (activeFirewalls > 0 && targetHitbox) {
            const nearbyObjects = getNearbyObjectsAroundWizard(
                wizardRef.map,
                wizardRef,
                collisionNearbyObjectsScratch,
                { tileRadius: 2, requireCollisionHandler: true }
            );
            for (const obj of nearbyObjects) {
                if (!obj) continue;
                obj.handleCharacterCollision(target);
            }
        }

        const scriptingApi = (
            typeof globalThis !== "undefined" &&
            globalThis.Scripting &&
            typeof globalThis.Scripting === "object"
        ) ? globalThis.Scripting : null;
        if (!scriptingApi) return;
        if (
            typeof scriptingApi.processDoorTraversalEvents !== "function" ||
            typeof scriptingApi.processObjectTouchEvents !== "function" ||
            typeof scriptingApi.processTriggerAreaTraversalEvents !== "function"
        ) {
            return;
        }

        const fromX = Number.isFinite(wizardRef._scriptPrevX) ? Number(wizardRef._scriptPrevX) : Number(wizardRef.x);
        const fromY = Number.isFinite(wizardRef._scriptPrevY) ? Number(wizardRef._scriptPrevY) : Number(wizardRef.y);
        const toX = Number(wizardRef.x);
        const toY = Number(wizardRef.y);
        wizardRef._scriptPrevX = toX;
        wizardRef._scriptPrevY = toY;

        const nearbyAll = getNearbyObjectsAroundWizard(
            wizardRef.map,
            wizardRef,
            collisionTargetsScratch,
            { tileRadius: 3, requireCollisionHandler: false }
        );
        const nearbyScriptEntries = [];
        const nearbyScriptObjects = new Set();
        const forceTouchedObjects = (wizardRef._movementForceTouchedObjects instanceof Set)
            ? wizardRef._movementForceTouchedObjects
            : null;
        for (let i = 0; i < nearbyAll.length; i++) {
            const obj = nearbyAll[i];
            if (!obj || obj.gone || obj.vanishing) continue;
            if (obj.type === "triggerArea" || obj.isTriggerArea === true) continue;
            const hitbox = obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox || null;
            if (!hitbox) continue;
            const forceTouch = !!(forceTouchedObjects && forceTouchedObjects.has(obj));
            nearbyScriptEntries.push({ obj, hitbox, forceTouch });
            nearbyScriptObjects.add(obj);
        }

        const mapPowerups = (
            typeof globalThis !== "undefined" &&
            Array.isArray(globalThis.powerups)
        ) ? globalThis.powerups : [];
        for (let i = 0; i < mapPowerups.length; i++) {
            const obj = mapPowerups[i];
            if (!obj || obj.gone || obj.vanishing || obj.collected) continue;
            if (obj.map && wizardRef.map && obj.map !== wizardRef.map) continue;
            if (nearbyScriptObjects.has(obj)) continue;
            const hitbox = obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox || null;
            if (!hitbox) continue;
            nearbyScriptEntries.push({ obj, hitbox, forceTouch: false });
            nearbyScriptObjects.add(obj);
        }

        const runtimeScriptObjects = (wizardRef.map && typeof wizardRef.map.getGameObjects === "function")
            ? (wizardRef.map.getGameObjects({ refresh: false }) || [])
            : [];
        for (let i = 0; i < runtimeScriptObjects.length; i++) {
            const obj = runtimeScriptObjects[i];
            if (!obj || obj === wizardRef || obj.gone || obj.vanishing) continue;
            if (obj.type === "triggerArea" || obj.isTriggerArea === true) continue;
            if (nearbyScriptObjects.has(obj)) continue;
            if (obj.map && wizardRef.map && obj.map !== wizardRef.map) continue;
            const hitbox = obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox || null;
            if (!hitbox) continue;
            const hasTouchScript = (
                (typeof globalThis !== "undefined" && globalThis.Scripting && typeof globalThis.Scripting.hasEventScriptForTarget === "function")
                    ? (globalThis.Scripting.hasEventScriptForTarget(obj, "playerTouches") || globalThis.Scripting.hasEventScriptForTarget(obj, "playerUntouches"))
                    : false
            );
            if (!hasTouchScript) continue;
            const forceTouch = !!(forceTouchedObjects && forceTouchedObjects.has(obj));
            nearbyScriptEntries.push({ obj, hitbox, forceTouch });
            nearbyScriptObjects.add(obj);
        }

        if (wizardRef.map && typeof wizardRef.map.getPrototypeActiveTriggerTraversalEntriesForActor === "function") {
            const triggerEntries = wizardRef.map.getPrototypeActiveTriggerTraversalEntriesForActor(wizardRef);
            for (let i = 0; i < triggerEntries.length; i++) {
                const entry = triggerEntries[i];
                const obj = entry && entry.obj;
                const hitbox = entry && entry.hitbox;
                if (!obj || !hitbox) continue;
                nearbyScriptEntries.push({ obj, hitbox, forceTouch: false });
            }
        } else {
            const allMapObjects = Array.isArray(wizardRef.map.objects) ? wizardRef.map.objects : [];
            for (let i = 0; i < allMapObjects.length; i++) {
                const obj = allMapObjects[i];
                if (!obj || obj.gone || obj.vanishing) continue;
                if (!(obj.type === "triggerArea" || obj.isTriggerArea === true)) continue;
                if (nearbyScriptObjects.has(obj)) continue;
                const hitbox = obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox || null;
                if (!hitbox) continue;
                nearbyScriptEntries.push({ obj, hitbox });
            }
        }

        scriptingApi.processDoorTraversalEvents(
            wizardRef,
            fromX,
            fromY,
            toX,
            toY,
            nearbyScriptEntries,
            0
        );
        scriptingApi.processTriggerAreaTraversalEvents(
            wizardRef,
            fromX,
            fromY,
            toX,
            toY,
            nearbyScriptEntries,
            0
        );
        scriptingApi.processObjectTouchEvents(
            wizardRef,
            nearbyScriptEntries,
            Number(wizardRef.groundRadius) || 0
        );
    }

    function getObjectTargetAt(wizardRef, worldX, worldY) {
        const activeSpell = wizardRef ? wizardRef.currentSpell : null;
        const debugEnabled = !!(
            (typeof debugMode !== "undefined" && debugMode) ||
            (typeof globalThis !== "undefined" && globalThis.debugMode)
        );
        const triggerAreaTargetingEnabled = !!(
            debugEnabled ||
            activeSpell === "editscript" ||
            activeSpell === "moveobject" ||
            activeSpell === "triggerarea"
        );
        const canTargetObject = (obj) => !!(
            obj &&
            !obj.gone &&
            !obj.vanishing &&
            (!(obj.type === "triggerArea" || obj.isTriggerArea === true) || triggerAreaTargetingEnabled) &&
            isValidObjectTargetForSpell(activeSpell, obj, wizardRef) &&
            !hasSpellAlreadyTargetedObject(wizardRef, activeSpell, obj)
        );

        const pickResult = pickObjectViaRenderingColorId((obj) =>
            canTargetObject(obj)
        );
        if (!pickResult || !pickResult.attempted) return null;
        const picked = pickResult.picked;
        if (picked && canTargetObject(picked)) return picked;
        return null;
    }

    function clearTriggerAreaPlacementDraft(wizardRef) {
        if (!wizardRef || !wizardRef._triggerAreaPlacementDraft) return;
        wizardRef._triggerAreaPlacementDraft = null;
    }

    function clearFloorShapePlacementDraft(wizardRef) {
        if (!wizardRef || !wizardRef._floorShapePlacementDraft) return;
        wizardRef._floorShapePlacementDraft = null;
    }

    function clearFloorHolePlacementDraft(wizardRef) {
        if (!wizardRef || !wizardRef._floorHolePlacementDraft) return;
        wizardRef._floorHolePlacementDraft = null;
    }

    function isTriggerAreaDebugEditEnabled(wizardRef) {
        return !!(wizardRef && wizardRef.currentSpell === "triggerarea");
    }

    function clearTriggerAreaVertexSelection(wizardRef) {
        if (!wizardRef || !wizardRef._triggerAreaVertexSelection) return;
        wizardRef._triggerAreaVertexSelection = null;
    }

    function getTriggerAreaVertexSelection(wizardRef) {
        if (!wizardRef) return null;
        const selection = wizardRef._triggerAreaVertexSelection;
        if (!selection || typeof selection !== "object") return null;
        const area = selection.area || null;
        const vertexIndex = Math.floor(Number(selection.vertexIndex));
        if (
            !area ||
            area.gone ||
            area.vanishing ||
            !Number.isInteger(vertexIndex)
        ) {
            clearTriggerAreaVertexSelection(wizardRef);
            return null;
        }
        const points = Array.isArray(area.polygonPoints) ? area.polygonPoints : null;
        if (!points || vertexIndex < 0 || vertexIndex >= points.length) {
            clearTriggerAreaVertexSelection(wizardRef);
            return null;
        }
        selection.vertexIndex = vertexIndex;
        selection.dragging = !!selection.dragging;
        return selection;
    }

    function getAllTriggerAreaObjects(mapRef, actorRef = null) {
        const prototypeTriggerObjects = (
            mapRef &&
            actorRef &&
            typeof mapRef.getPrototypeActiveTriggerDisplayObjectsForActor === "function"
        ) ? mapRef.getPrototypeActiveTriggerDisplayObjectsForActor(actorRef) : null;
        const allMapObjects = Array.isArray(prototypeTriggerObjects)
            ? prototypeTriggerObjects
            : (Array.isArray(mapRef && mapRef.objects) ? mapRef.objects : []);
        const results = [];
        for (let i = 0; i < allMapObjects.length; i++) {
            const obj = allMapObjects[i];
            if (!obj || obj.gone || obj.vanishing) continue;
            if (!(obj.type === "triggerArea" || obj.isTriggerArea === true)) continue;
            if (!Array.isArray(obj.polygonPoints) || obj.polygonPoints.length < 3) continue;
            results.push(obj);
        }
        return results;
    }

    function findTriggerAreaVertexAtScreenPoint(wizardRef, screenX, screenY) {
        if (!isTriggerAreaDebugEditEnabled(wizardRef)) return null;
        if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
        const worldToScreenFn = (typeof worldToScreen === "function") ? worldToScreen : null;
        if (!worldToScreenFn) return null;
        const triggerAreas = getAllTriggerAreaObjects(wizardRef.map, wizardRef);
        if (triggerAreas.length === 0) return null;

        let best = null;
        let bestDistanceSq = TRIGGER_AREA_VERTEX_SELECT_DISTANCE_PX * TRIGGER_AREA_VERTEX_SELECT_DISTANCE_PX;
        for (let i = 0; i < triggerAreas.length; i++) {
            const area = triggerAreas[i];
            const points = area.polygonPoints;
            for (let j = 0; j < points.length; j++) {
                const point = points[j];
                if (!point) continue;
                const screenPoint = worldToScreenFn({ x: Number(point.x), y: Number(point.y) });
                if (!screenPoint || !Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) continue;
                const dx = Number(screenPoint.x) - Number(screenX);
                const dy = Number(screenPoint.y) - Number(screenY);
                const distanceSq = (dx * dx) + (dy * dy);
                if (distanceSq > bestDistanceSq) continue;
                bestDistanceSq = distanceSq;
                best = { area, vertexIndex: j };
            }
        }
        return best;
    }

    function getDistanceSqToScreenSegment(screenX, screenY, ax, ay, bx, by) {
        const abx = bx - ax;
        const aby = by - ay;
        const abLenSq = (abx * abx) + (aby * aby);
        if (!(abLenSq > 0)) {
            const dx = screenX - ax;
            const dy = screenY - ay;
            return dx * dx + dy * dy;
        }
        const apx = screenX - ax;
        const apy = screenY - ay;
        const t = Math.max(0, Math.min(1, ((apx * abx) + (apy * aby)) / abLenSq));
        const closestX = ax + (abx * t);
        const closestY = ay + (aby * t);
        const dx = screenX - closestX;
        const dy = screenY - closestY;
        return dx * dx + dy * dy;
    }

    function findTriggerAreaEdgeAtScreenPoint(wizardRef, screenX, screenY) {
        if (!isTriggerAreaDebugEditEnabled(wizardRef)) return null;
        if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
        const worldToScreenFn = (typeof worldToScreen === "function") ? worldToScreen : null;
        if (!worldToScreenFn) return null;
        const triggerAreas = getAllTriggerAreaObjects(wizardRef.map, wizardRef);
        if (triggerAreas.length === 0) return null;

        let best = null;
        let bestDistanceSq = TRIGGER_AREA_VERTEX_SELECT_DISTANCE_PX * TRIGGER_AREA_VERTEX_SELECT_DISTANCE_PX;
        for (let i = 0; i < triggerAreas.length; i++) {
            const area = triggerAreas[i];
            const points = area.polygonPoints;
            for (let j = 0; j < points.length; j++) {
                const a = points[j];
                const b = points[(j + 1) % points.length];
                const screenA = worldToScreenFn({ x: Number(a.x), y: Number(a.y) });
                const screenB = worldToScreenFn({ x: Number(b.x), y: Number(b.y) });
                if (
                    !screenA || !screenB ||
                    !Number.isFinite(screenA.x) || !Number.isFinite(screenA.y) ||
                    !Number.isFinite(screenB.x) || !Number.isFinite(screenB.y)
                ) {
                    continue;
                }
                const distanceSq = getDistanceSqToScreenSegment(
                    Number(screenX),
                    Number(screenY),
                    Number(screenA.x),
                    Number(screenA.y),
                    Number(screenB.x),
                    Number(screenB.y)
                );
                if (distanceSq > bestDistanceSq) continue;
                bestDistanceSq = distanceSq;
                best = { area, insertAfterIndex: j };
            }
        }
        return best;
    }

    function insertTriggerAreaVertexOnEdge(wizardRef, screenX, screenY, worldX, worldY) {
        const hit = findTriggerAreaEdgeAtScreenPoint(wizardRef, screenX, screenY);
        if (!hit) return false;
        const area = hit.area;
        const points = Array.isArray(area.polygonPoints) ? area.polygonPoints : null;
        if (!points || points.length < 3) return false;
        const mapRef = area.map || wizardRef.map || null;
        const wrappedX = (mapRef && typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(worldX) : worldX;
        const wrappedY = (mapRef && typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(worldY) : worldY;
        if (!Number.isFinite(wrappedX) || !Number.isFinite(wrappedY)) return false;
        const insertIndex = Math.max(0, Math.min(points.length, hit.insertAfterIndex + 1));
        const nextPoints = points.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
        nextPoints.splice(insertIndex, 0, { x: wrappedX, y: wrappedY });
        const updated = area.setPolygonPoints(nextPoints);
        if (!updated) return false;
        wizardRef._triggerAreaVertexSelection = {
            area,
            vertexIndex: insertIndex,
            dragging: true
        };
        return true;
    }

    function beginTriggerAreaVertexDrag(wizardRef, screenX, screenY) {
        const hit = findTriggerAreaVertexAtScreenPoint(wizardRef, screenX, screenY);
        if (!hit) {
            clearTriggerAreaVertexSelection(wizardRef);
            return false;
        }
        wizardRef._triggerAreaVertexSelection = {
            area: hit.area,
            vertexIndex: hit.vertexIndex,
            dragging: true
        };
        return true;
    }

    function updateTriggerAreaVertexDrag(wizardRef, worldX, worldY) {
        if (!isTriggerAreaDebugEditEnabled(wizardRef)) return false;
        const selection = getTriggerAreaVertexSelection(wizardRef);
        if (!selection || !selection.dragging) return false;
        const area = selection.area;
        const mapRef = area.map || wizardRef.map || null;
        const wrappedX = (mapRef && typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(worldX) : worldX;
        const wrappedY = (mapRef && typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(worldY) : worldY;
        if (!Number.isFinite(wrappedX) || !Number.isFinite(wrappedY)) return false;
        const nextPoints = area.polygonPoints.map((point, index) => (
            index === selection.vertexIndex
                ? { x: wrappedX, y: wrappedY }
                : { x: Number(point.x), y: Number(point.y) }
        ));
        return area.setPolygonPoints(nextPoints);
    }

    function endTriggerAreaVertexDrag(wizardRef) {
        const selection = getTriggerAreaVertexSelection(wizardRef);
        if (!selection || !selection.dragging) return false;
        selection.dragging = false;
        return true;
    }

    function deleteSelectedTriggerAreaVertex(wizardRef) {
        if (!isTriggerAreaDebugEditEnabled(wizardRef)) return false;
        const selection = getTriggerAreaVertexSelection(wizardRef);
        if (!selection) return false;
        const area = selection.area;
        const points = Array.isArray(area.polygonPoints) ? area.polygonPoints : null;
        if (!points || points.length <= 3) return false;
        const nextPoints = points
            .filter((_point, index) => index !== selection.vertexIndex)
            .map((point) => ({ x: Number(point.x), y: Number(point.y) }));
        const updated = area.setPolygonPoints(nextPoints);
        clearTriggerAreaVertexSelection(wizardRef);
        return updated;
    }

    function isFloorEditorDebugEditEnabled(wizardRef) {
        if (!wizardRef) return false;
        return wizardRef.currentSpell === "flooredit" || isFloorEditorToolName(wizardRef.currentSpell);
    }

    function clearFloorEditorVertexSelection(wizardRef) {
        if (!wizardRef || !wizardRef._floorEditorVertexSelection) return;
        wizardRef._floorEditorVertexSelection = null;
    }

    function cloneFloorEditorRing(points) {
        const out = [];
        if (!Array.isArray(points)) return out;
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            const x = Number(point && point.x);
            const y = Number(point && point.y);
            if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
        }
        return out;
    }

    function getFloorEditorRingFromFragment(fragment, ringKind, holeIndex = -1) {
        if (!fragment) return null;
        if (ringKind === "outer") {
            return Array.isArray(fragment.outerPolygon) ? fragment.outerPolygon : null;
        }
        if (ringKind === "hole") {
            const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
            const index = Math.floor(Number(holeIndex));
            return index >= 0 && index < holes.length && Array.isArray(holes[index]) ? holes[index] : null;
        }
        return null;
    }

    function getFloorEditorVertexSelection(wizardRef) {
        if (!wizardRef) return null;
        const selection = wizardRef._floorEditorVertexSelection;
        if (!selection || typeof selection !== "object") return null;
        const mapRef = wizardRef.map || null;
        const fragmentId = typeof selection.fragmentId === "string" ? selection.fragmentId : "";
        const fragment = fragmentId && mapRef && mapRef.floorsById instanceof Map
            ? mapRef.floorsById.get(fragmentId)
            : null;
        const vertexIndex = Math.floor(Number(selection.vertexIndex));
        const holeIndex = Math.floor(Number(selection.holeIndex));
        const ringKind = selection.ringKind === "hole" ? "hole" : "outer";
        const ring = getFloorEditorRingFromFragment(fragment, ringKind, holeIndex);
        if (
            !fragment ||
            fragment._prototypeGroundFloor === true ||
            fragment._floorEditEmpty === true ||
            !Array.isArray(ring) ||
            ring.length < 3 ||
            !Number.isInteger(vertexIndex) ||
            vertexIndex < 0 ||
            vertexIndex >= ring.length
        ) {
            clearFloorEditorVertexSelection(wizardRef);
            return null;
        }
        selection.fragment = fragment;
        selection.vertexIndex = vertexIndex;
        selection.holeIndex = Number.isInteger(holeIndex) ? holeIndex : -1;
        selection.ringKind = ringKind;
        selection.dragging = !!selection.dragging;
        selection.dirty = !!selection.dirty;
        return selection;
    }

    function floorEditorWorldToScreen(point, baseZ = 0) {
        const worldToScreenFn = (typeof worldToScreen === "function") ? worldToScreen : null;
        if (!worldToScreenFn || !point) return null;
        return worldToScreenFn({
            x: Number(point.x),
            y: Number(point.y),
            z: Number.isFinite(baseZ) ? Number(baseZ) : 0
        });
    }

    function getEditableFloorEditorFragments(wizardRef) {
        const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
        if (!mapRef || !(mapRef.floorsById instanceof Map)) return [];
        const level = getSelectedFloorEditLevel(wizardRef);
        const fragments = [];
        for (const fragment of mapRef.floorsById.values()) {
            if (!fragment) continue;
            const fragmentLevel = Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0;
            if (fragmentLevel !== level) continue;
            if (fragment._prototypeGroundFloor === true || fragment._floorEditEmpty === true) continue;
            if (!Array.isArray(fragment.outerPolygon) || fragment.outerPolygon.length < 3) continue;
            fragments.push(fragment);
        }
        return fragments;
    }

    function getFloorEditorRingsForFragment(fragment) {
        const rings = [];
        if (fragment && Array.isArray(fragment.outerPolygon) && fragment.outerPolygon.length >= 3) {
            rings.push({ ringKind: "outer", holeIndex: -1, points: fragment.outerPolygon });
        }
        const holes = Array.isArray(fragment && fragment.holes) ? fragment.holes : [];
        for (let i = 0; i < holes.length; i++) {
            if (Array.isArray(holes[i]) && holes[i].length >= 3) {
                rings.push({ ringKind: "hole", holeIndex: i, points: holes[i] });
            }
        }
        return rings;
    }

    function findFloorEditorVertexAtScreenPoint(wizardRef, screenX, screenY) {
        if (!isFloorEditorDebugEditEnabled(wizardRef)) return null;
        if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
        const fragments = getEditableFloorEditorFragments(wizardRef);
        let best = null;
        let bestDistanceSq = TRIGGER_AREA_VERTEX_SELECT_DISTANCE_PX * TRIGGER_AREA_VERTEX_SELECT_DISTANCE_PX;
        for (let i = 0; i < fragments.length; i++) {
            const fragment = fragments[i];
            const baseZ = Number.isFinite(fragment.nodeBaseZ) ? Number(fragment.nodeBaseZ) : (getSelectedFloorEditLevel(wizardRef) * 3);
            const rings = getFloorEditorRingsForFragment(fragment);
            for (let r = 0; r < rings.length; r++) {
                const ring = rings[r];
                for (let j = 0; j < ring.points.length; j++) {
                    const screenPoint = floorEditorWorldToScreen(ring.points[j], baseZ);
                    if (!screenPoint || !Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) continue;
                    const dx = Number(screenPoint.x) - Number(screenX);
                    const dy = Number(screenPoint.y) - Number(screenY);
                    const distanceSq = (dx * dx) + (dy * dy);
                    if (distanceSq > bestDistanceSq) continue;
                    bestDistanceSq = distanceSq;
                    best = {
                        fragmentId: fragment.fragmentId,
                        ringKind: ring.ringKind,
                        holeIndex: ring.holeIndex,
                        vertexIndex: j
                    };
                }
            }
        }
        return best;
    }

    function getClosestScreenSegmentInfo(screenX, screenY, ax, ay, bx, by) {
        const abx = bx - ax;
        const aby = by - ay;
        const abLenSq = (abx * abx) + (aby * aby);
        if (!(abLenSq > 0)) {
            const dx = screenX - ax;
            const dy = screenY - ay;
            return { distanceSq: dx * dx + dy * dy, t: 0 };
        }
        const apx = screenX - ax;
        const apy = screenY - ay;
        const t = Math.max(0, Math.min(1, ((apx * abx) + (apy * aby)) / abLenSq));
        const closestX = ax + (abx * t);
        const closestY = ay + (aby * t);
        const dx = screenX - closestX;
        const dy = screenY - closestY;
        return { distanceSq: dx * dx + dy * dy, t };
    }

    function findFloorEditorEdgeAtScreenPoint(wizardRef, screenX, screenY) {
        if (!isFloorEditorDebugEditEnabled(wizardRef)) return null;
        if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
        const fragments = getEditableFloorEditorFragments(wizardRef);
        let best = null;
        let bestDistanceSq = TRIGGER_AREA_VERTEX_SELECT_DISTANCE_PX * TRIGGER_AREA_VERTEX_SELECT_DISTANCE_PX;
        for (let i = 0; i < fragments.length; i++) {
            const fragment = fragments[i];
            const baseZ = Number.isFinite(fragment.nodeBaseZ) ? Number(fragment.nodeBaseZ) : (getSelectedFloorEditLevel(wizardRef) * 3);
            const rings = getFloorEditorRingsForFragment(fragment);
            for (let r = 0; r < rings.length; r++) {
                const ring = rings[r];
                for (let j = 0; j < ring.points.length; j++) {
                    const a = ring.points[j];
                    const b = ring.points[(j + 1) % ring.points.length];
                    const screenA = floorEditorWorldToScreen(a, baseZ);
                    const screenB = floorEditorWorldToScreen(b, baseZ);
                    if (
                        !screenA || !screenB ||
                        !Number.isFinite(screenA.x) || !Number.isFinite(screenA.y) ||
                        !Number.isFinite(screenB.x) || !Number.isFinite(screenB.y)
                    ) {
                        continue;
                    }
                    const hit = getClosestScreenSegmentInfo(
                        Number(screenX),
                        Number(screenY),
                        Number(screenA.x),
                        Number(screenA.y),
                        Number(screenB.x),
                        Number(screenB.y)
                    );
                    if (!hit || hit.distanceSq > bestDistanceSq) continue;
                    bestDistanceSq = hit.distanceSq;
                    best = {
                        fragmentId: fragment.fragmentId,
                        ringKind: ring.ringKind,
                        holeIndex: ring.holeIndex,
                        insertAfterIndex: j,
                        t: hit.t
                    };
                }
            }
        }
        return best;
    }

    function findAssetFloorForFloorEditorFragment(mapRef, fragment) {
        const state = mapRef && mapRef._prototypeSectionState;
        const sectionKey = fragment && typeof fragment.ownerSectionKey === "string" ? fragment.ownerSectionKey : "";
        const asset = sectionKey && state && state.sectionAssetsByKey instanceof Map
            ? state.sectionAssetsByKey.get(sectionKey)
            : null;
        if (!asset || !Array.isArray(asset.floors)) return { asset: null, floor: null };
        const fragmentId = typeof fragment.fragmentId === "string" ? fragment.fragmentId : "";
        let floor = fragmentId ? asset.floors.find(item => item && item.fragmentId === fragmentId) : null;
        if (!floor) {
            const level = Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0;
            floor = asset.floors.find(item =>
                item &&
                Math.round(Number(item.level) || 0) === level &&
                item.surfaceId === fragment.surfaceId &&
                Array.isArray(item.outerPolygon)
            ) || null;
        }
        return { asset, floor };
    }

    function getFloorEditorPointLevel(wizardRef) {
        if (wizardRef && Number.isFinite(wizardRef.selectedFloorEditLevel)) {
            return normalizeFloorEditLevel(wizardRef.selectedFloorEditLevel);
        }
        if (typeof globalThis !== "undefined" && Number.isFinite(globalThis.selectedFloorEditLevel)) {
            return normalizeFloorEditLevel(globalThis.selectedFloorEditLevel);
        }
        if (wizardRef && Number.isFinite(wizardRef.currentLayer)) {
            return normalizeFloorEditLevel(wizardRef.currentLayer);
        }
        return getSelectedFloorEditLevel(wizardRef);
    }

    function getFloorEditorPolygonArea(points) {
        if (!Array.isArray(points) || points.length < 3) return 0;
        let sum = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            const ax = Number(a && a.x);
            const ay = Number(a && a.y);
            const bx = Number(b && b.x);
            const by = Number(b && b.y);
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
            sum += (ax * by) - (bx * ay);
        }
        return Math.abs(sum) * 0.5;
    }

    function isPointInsideFloorEditorFragment(worldX, worldY, fragment) {
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !fragment) return false;
        const outer = Array.isArray(fragment.outerPolygon) && fragment.outerPolygon.length >= 3
            ? fragment.outerPolygon
            : null;
        if (!outer || !pointInOrOnFloorEditPolygon2D(worldX, worldY, outer)) return false;
        const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
        for (let i = 0; i < holes.length; i++) {
            const hole = holes[i];
            if (Array.isArray(hole) && hole.length >= 3 && pointInOrOnFloorEditPolygon2D(worldX, worldY, hole)) {
                return false;
            }
        }
        return true;
    }

    function findFloorEditorFragmentAtWorldPoint(wizardRef, worldX, worldY) {
        const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
        if (!mapRef || !(mapRef.floorsById instanceof Map)) return null;
        const level = getFloorEditorPointLevel(wizardRef);
        if (level === 0) return null;
        let best = null;
        let bestArea = Infinity;
        for (const fragment of mapRef.floorsById.values()) {
            if (!fragment) continue;
            const fragmentLevel = Number.isFinite(fragment.level) ? normalizeFloorEditLevel(fragment.level) : 0;
            if (fragmentLevel !== level) continue;
            if (fragment._prototypeGroundFloor === true || fragment._floorEditEmpty === true) continue;
            if (!isPointInsideFloorEditorFragment(worldX, worldY, fragment)) continue;
            const area = getFloorEditorPolygonArea(fragment.outerPolygon);
            if (!best || area < bestArea) {
                best = fragment;
                bestArea = area;
            }
        }
        return best;
    }

    function resolveWorldPointOnFloorPlaneFromScreen(wizardRef, screenX, screenY, baseZ) {
        if (
            Number.isFinite(screenX) &&
            Number.isFinite(screenY) &&
            typeof viewport !== "undefined" &&
            viewport &&
            Number.isFinite(viewport.x) &&
            Number.isFinite(viewport.y)
        ) {
            const vs = (typeof viewscale !== "undefined" && Number.isFinite(viewscale) && viewscale)
                ? Number(viewscale)
                : 1;
            const xyr = (typeof xyratio !== "undefined" && Number.isFinite(xyratio) && xyratio)
                ? Number(xyratio)
                : 1;
            const floorBaseZ = Number.isFinite(baseZ) ? Number(baseZ) : 0;
            const cameraZ = Number.isFinite(viewport.z) ? Number(viewport.z) : 0;
            const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
            let resolvedX = (screenX / vs) + Number(viewport.x);
            let resolvedY = (screenY / (vs * xyr)) + Number(viewport.y) + (floorBaseZ - cameraZ);
            if (mapRef && typeof mapRef.wrapWorldX === "function" && Number.isFinite(resolvedX)) {
                resolvedX = mapRef.wrapWorldX(resolvedX);
            }
            if (mapRef && typeof mapRef.wrapWorldY === "function" && Number.isFinite(resolvedY)) {
                resolvedY = mapRef.wrapWorldY(resolvedY);
            }
            if (
                wizardRef &&
                mapRef &&
                typeof mapRef.shortestDeltaX === "function" &&
                typeof mapRef.shortestDeltaY === "function" &&
                Number.isFinite(wizardRef.x) &&
                Number.isFinite(wizardRef.y) &&
                Number.isFinite(resolvedX) &&
                Number.isFinite(resolvedY)
            ) {
                resolvedX = Number(wizardRef.x) + mapRef.shortestDeltaX(Number(wizardRef.x), resolvedX);
                resolvedY = Number(wizardRef.y) + mapRef.shortestDeltaY(Number(wizardRef.y), resolvedY);
            }
            return { x: resolvedX, y: resolvedY };
        }
        return null;
    }

    function getVisibleFloorPolygonTargetAtScreenPoint(wizardRef, screenX, screenY, options = {}) {
        const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
        if (!mapRef || !(mapRef.floorsById instanceof Map)) return null;
        if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
        const includeHidden = !!(options && options.includeHidden === true);
        const currentVisibleLevel = wizardRef && Number.isFinite(wizardRef.currentLayer)
            ? normalizeFloorEditLevel(wizardRef.currentLayer)
            : getSelectedFloorEditLevel(wizardRef);
        let best = null;
        for (const fragment of mapRef.floorsById.values()) {
            if (!fragment) continue;
            const level = Number.isFinite(fragment.level) ? normalizeFloorEditLevel(fragment.level) : 0;
            if (level === 0) continue;
            if (!includeHidden && level > currentVisibleLevel) continue;
            if (fragment._prototypeGroundFloor === true || fragment._floorEditEmpty === true) continue;
            if (!Array.isArray(fragment.outerPolygon) || fragment.outerPolygon.length < 3) continue;
            const baseZ = Number.isFinite(fragment.nodeBaseZ) ? Number(fragment.nodeBaseZ) : (level * 3);
            const point = resolveWorldPointOnFloorPlaneFromScreen(wizardRef, screenX, screenY, baseZ);
            if (!point || !isPointInsideFloorEditorFragment(point.x, point.y, fragment)) continue;
            const area = getFloorEditorPolygonArea(fragment.outerPolygon);
            if (
                !best ||
                baseZ > best.baseZ ||
                (baseZ === best.baseZ && area < best.area)
            ) {
                best = { fragment, level, baseZ, point, area };
            }
        }
        return best;
    }

    function resolveFloorEditorPaintWorldPoint(wizardRef, worldX, worldY, options = {}) {
        const screenX = Number(options && options.screenX);
        const screenY = Number(options && options.screenY);
        const baseZ = getFloorEditorPointLevel(wizardRef) * 3;
        const screenPoint = resolveWorldPointOnFloorPlaneFromScreen(wizardRef, screenX, screenY, baseZ);
        if (screenPoint) {
            return screenPoint;
        }
        return { x: worldX, y: worldY };
    }

    function paintFloorPolygonAtWorldPoint(wizardRef, worldX, worldY, options = {}) {
        if (!wizardRef || !wizardRef.map) return false;
        const screenX = Number(options && options.screenX);
        const screenY = Number(options && options.screenY);
        const visibleTarget = getVisibleFloorPolygonTargetAtScreenPoint(wizardRef, screenX, screenY);
        const paintPoint = visibleTarget ? visibleTarget.point : resolveFloorEditorPaintWorldPoint(wizardRef, worldX, worldY, options);
        const fragment = visibleTarget ? visibleTarget.fragment : findFloorEditorFragmentAtWorldPoint(wizardRef, paintPoint.x, paintPoint.y);
        if (!fragment) return false;
        const level = Number.isFinite(fragment.level) ? normalizeFloorEditLevel(fragment.level) : 0;
        if (level === 0) return false;
        const texturePath = getSelectedFlooringTexture(wizardRef);
        if (typeof texturePath !== "string" || texturePath.length === 0) return false;
        const assetMatch = findAssetFloorForFloorEditorFragment(wizardRef.map, fragment);
        fragment.texturePath = texturePath;
        if (assetMatch.floor && assetMatch.floor !== fragment) {
            assetMatch.floor.texturePath = texturePath;
        }
        if (assetMatch.asset) {
            assetMatch.asset._floorTextureVersion = (Number(assetMatch.asset._floorTextureVersion) || 0) + 1;
        }
        if (typeof presentGameFrame === "function") {
            presentGameFrame();
        }
        if (!(options && options.silent) && typeof message === "function") {
            const levelLabel = level > 0 ? `+${level}` : `${level}`;
            const textureName = decodeURIComponent(texturePath.split("/").pop() || texturePath);
            message(`Painted floor ${levelLabel} with ${textureName}`);
        }
        return true;
    }

    function refreshFloorEditorFloorTileKeys(asset, floor) {
        if (!asset || !floor) return false;
        const outer = cloneFloorEditorRing(floor.outerPolygon);
        if (outer.length < 3) return false;
        const holes = Array.isArray(floor.holes)
            ? floor.holes.map(cloneFloorEditorRing).filter(ring => ring.length >= 3)
            : [];
        floor.tileCoordKeys = getFloorEditTileCoordKeysForPolygon(asset, outer, holes);
        return true;
    }

    function applyFloorEditorRingToFragment(wizardRef, selection, nextRing, options = {}) {
        if (!wizardRef || !wizardRef.map || !selection) return false;
        const mapRef = wizardRef.map;
        const fragment = selection.fragment || (
            mapRef.floorsById instanceof Map ? mapRef.floorsById.get(selection.fragmentId) : null
        );
        if (!fragment) return false;
        const ring = cloneFloorEditorRing(nextRing);
        if (ring.length < 3) return false;

        const assetMatch = findAssetFloorForFloorEditorFragment(mapRef, fragment);
        const targets = [fragment];
        if (assetMatch.floor && assetMatch.floor !== fragment) targets.push(assetMatch.floor);
        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            if (!target) continue;
            if (selection.ringKind === "hole") {
                const holeIndex = Math.floor(Number(selection.holeIndex));
                if (holeIndex < 0) return false;
                if (!Array.isArray(target.holes)) target.holes = [];
                if (!Array.isArray(target.visibilityHoles)) target.visibilityHoles = [];
                target.holes[holeIndex] = ring.map(point => ({ ...point }));
                target.visibilityHoles[holeIndex] = ring.map(point => ({ ...point }));
            } else {
                target.outerPolygon = ring.map(point => ({ ...point }));
                target.visibilityPolygon = ring.map(point => ({ ...point }));
            }
        }
        if (assetMatch.asset && assetMatch.floor) {
            refreshFloorEditorFloorTileKeys(assetMatch.asset, assetMatch.floor);
        }

        const shouldRematerialize = !(options && options.rematerialize === false);
        if (shouldRematerialize && typeof rematerializeFloorEditSections === "function") {
            const sectionKey = typeof fragment.ownerSectionKey === "string" ? fragment.ownerSectionKey : "";
            if (sectionKey) rematerializeFloorEditSections(mapRef, new Set([sectionKey]));
        } else {
            selection.dirty = true;
        }
        if (typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
            globalThis.presentGameFrame();
        }
        return true;
    }

    function rematerializeSelectedFloorEditorFragment(wizardRef, selection = null) {
        const activeSelection = selection || getFloorEditorVertexSelection(wizardRef);
        if (!wizardRef || !wizardRef.map || !activeSelection) return false;
        const fragment = activeSelection.fragment || (
            wizardRef.map.floorsById instanceof Map ? wizardRef.map.floorsById.get(activeSelection.fragmentId) : null
        );
        if (!fragment) return false;
        const assetMatch = findAssetFloorForFloorEditorFragment(wizardRef.map, fragment);
        if (assetMatch.asset && assetMatch.floor) {
            refreshFloorEditorFloorTileKeys(assetMatch.asset, assetMatch.floor);
        }
        const sectionKey = typeof fragment.ownerSectionKey === "string" ? fragment.ownerSectionKey : "";
        if (sectionKey && typeof rematerializeFloorEditSections === "function") {
            rematerializeFloorEditSections(wizardRef.map, new Set([sectionKey]));
        }
        activeSelection.dirty = false;
        if (typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
            globalThis.presentGameFrame();
        }
        return true;
    }

    function insertFloorEditorVertexOnEdge(wizardRef, screenX, screenY) {
        const hit = findFloorEditorEdgeAtScreenPoint(wizardRef, screenX, screenY);
        if (!hit) return false;
        const selection = {
            fragmentId: hit.fragmentId,
            ringKind: hit.ringKind,
            holeIndex: hit.holeIndex,
            vertexIndex: hit.insertAfterIndex,
            dragging: true
        };
        wizardRef._floorEditorVertexSelection = selection;
        const resolved = getFloorEditorVertexSelection(wizardRef);
        if (!resolved) return false;
        const ring = getFloorEditorRingFromFragment(resolved.fragment, resolved.ringKind, resolved.holeIndex);
        if (!Array.isArray(ring) || ring.length < 3) return false;
        const a = ring[hit.insertAfterIndex];
        const b = ring[(hit.insertAfterIndex + 1) % ring.length];
        const mapRef = wizardRef.map || null;
        const dx = mapRef && typeof mapRef.shortestDeltaX === "function"
            ? mapRef.shortestDeltaX(Number(a.x), Number(b.x))
            : (Number(b.x) - Number(a.x));
        const dy = mapRef && typeof mapRef.shortestDeltaY === "function"
            ? mapRef.shortestDeltaY(Number(a.y), Number(b.y))
            : (Number(b.y) - Number(a.y));
        let insertX = Number(a.x) + dx * hit.t;
        let insertY = Number(a.y) + dy * hit.t;
        if (mapRef && typeof mapRef.wrapWorldX === "function") insertX = mapRef.wrapWorldX(insertX);
        if (mapRef && typeof mapRef.wrapWorldY === "function") insertY = mapRef.wrapWorldY(insertY);
        if (!Number.isFinite(insertX) || !Number.isFinite(insertY)) return false;
        const insertIndex = Math.max(0, Math.min(ring.length, hit.insertAfterIndex + 1));
        const nextRing = cloneFloorEditorRing(ring);
        nextRing.splice(insertIndex, 0, { x: insertX, y: insertY });
        resolved.vertexIndex = insertIndex;
        resolved.dragging = true;
        const updated = applyFloorEditorRingToFragment(wizardRef, resolved, nextRing, { rematerialize: false });
        if (!updated) return false;
        wizardRef._floorEditorVertexSelection = {
            fragmentId: hit.fragmentId,
            ringKind: hit.ringKind,
            holeIndex: hit.holeIndex,
            vertexIndex: insertIndex,
            dragging: true,
            dirty: true
        };
        return true;
    }

    function beginFloorEditorVertexDrag(wizardRef, screenX, screenY) {
        const hit = findFloorEditorVertexAtScreenPoint(wizardRef, screenX, screenY);
        if (!hit) {
            clearFloorEditorVertexSelection(wizardRef);
            return false;
        }
        wizardRef._floorEditorVertexSelection = {
            fragmentId: hit.fragmentId,
            ringKind: hit.ringKind,
            holeIndex: hit.holeIndex,
            vertexIndex: hit.vertexIndex,
            dragging: true,
            dirty: false
        };
        return true;
    }

    function updateFloorEditorVertexDrag(wizardRef, worldX, worldY) {
        if (!isFloorEditorDebugEditEnabled(wizardRef)) return false;
        const selection = getFloorEditorVertexSelection(wizardRef);
        if (!selection || !selection.dragging) return false;
        const mapRef = wizardRef.map || null;
        const wrappedX = (mapRef && typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(worldX) : worldX;
        const wrappedY = (mapRef && typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(worldY) : worldY;
        if (!Number.isFinite(wrappedX) || !Number.isFinite(wrappedY)) return false;
        const ring = getFloorEditorRingFromFragment(selection.fragment, selection.ringKind, selection.holeIndex);
        if (!Array.isArray(ring) || ring.length < 3) return false;
        const nextRing = ring.map((point, index) => (
            index === selection.vertexIndex
                ? { x: wrappedX, y: wrappedY }
                : { x: Number(point.x), y: Number(point.y) }
        ));
        return applyFloorEditorRingToFragment(wizardRef, selection, nextRing, { rematerialize: false });
    }

    function endFloorEditorVertexDrag(wizardRef) {
        const selection = getFloorEditorVertexSelection(wizardRef);
        if (!selection || !selection.dragging) return false;
        selection.dragging = false;
        if (selection.dirty) rematerializeSelectedFloorEditorFragment(wizardRef, selection);
        return true;
    }

    function deleteSelectedFloorEditorVertex(wizardRef) {
        if (!isFloorEditorDebugEditEnabled(wizardRef)) return false;
        const selection = getFloorEditorVertexSelection(wizardRef);
        if (!selection) return false;
        const ring = getFloorEditorRingFromFragment(selection.fragment, selection.ringKind, selection.holeIndex);
        if (!Array.isArray(ring) || ring.length <= 3) return false;
        const nextRing = ring
            .filter((_point, index) => index !== selection.vertexIndex)
            .map(point => ({ x: Number(point.x), y: Number(point.y) }));
        const updated = applyFloorEditorRingToFragment(wizardRef, selection, nextRing, { rematerialize: true });
        clearFloorEditorVertexSelection(wizardRef);
        return updated;
    }

    function cancelTriggerAreaPlacement(wizardRef) {
        if (!wizardRef || wizardRef.currentSpell !== "triggerarea") return false;
        const draft = wizardRef._triggerAreaPlacementDraft;
        if (!draft || !Array.isArray(draft.points) || draft.points.length === 0) return false;
        clearTriggerAreaPlacementDraft(wizardRef);
        return true;
    }

    function cancelFloorShapePlacement(wizardRef) {
        if (!wizardRef || wizardRef.currentSpell !== "floorshape") return false;
        const draft = wizardRef._floorShapePlacementDraft;
        if (!draft || !Array.isArray(draft.points) || draft.points.length === 0) return false;
        clearFloorShapePlacementDraft(wizardRef);
        return true;
    }

    function cancelFloorHolePlacement(wizardRef) {
        if (!wizardRef || wizardRef.currentSpell !== "floorhole") return false;
        const draft = wizardRef._floorHolePlacementDraft;
        if (!draft || !Array.isArray(draft.points) || draft.points.length === 0) return false;
        clearFloorHolePlacementDraft(wizardRef);
        return true;
    }

    function getTriggerAreaHelpMarkup() {
        return [
            "<h2 style=\"margin:0 0 10px 0;color:#ffd700;\">Trigger Areas</h2>",
            "<p>A trigger area is an invisible polygon on the map. When the player enters or exits it, its script can run.</p>",
            "<h3 style=\"margin:12px 0 6px 0;color:#ffd700;\">How To Build One</h3>",
            "<ul style=\"margin:0 0 10px 18px;padding:0;line-height:1.4;\">",
            "<li>Select the trigger constructor spell.</li>",
            "<li>Hold space and click to place vertices.</li>",
            "<li>Double-click, or click back on the first point, to finish the polygon.</li>",
            "<li>Press Escape to cancel an unfinished polygon.</li>",
            "</ul>",
            "<h3 style=\"margin:12px 0 6px 0;color:#ffd700;\">How To See And Edit Them</h3>",
            "<ul style=\"margin:0 0 10px 18px;padding:0;line-height:1.4;\">",
            "<li>Press <code>Ctrl+D</code> to turn on debug mode so trigger outlines become visible.</li>",
            "<li>With debug mode on and the trigger constructor selected, click and drag an existing vertex to move it.</li>",
            "<li>Click a vertex to select it. The selected vertex gets a small white circle.</li>",
            "<li>Press <code>Delete</code> or <code>Backspace</code> to remove the selected vertex.</li>",
            "<li><code>Shift</code>+click along an edge to insert a new vertex there.</li>",
            "</ul>",
            "<h3 style=\"margin:12px 0 6px 0;color:#ffd700;\">How To Script A Trigger</h3>",
            "<ul style=\"margin:0 0 10px 18px;padding:0;line-height:1.4;\">",
            "<li>After you create a trigger, the script editor opens automatically.</li>",
            "<li>You can also select the edit-script spell and click an existing trigger to edit it later.</li>",
            "<li>Useful trigger events are <code>playerEnters:</code> and <code>playerExits:</code>.</li>",
            "<li>Example:</li>",
            "</ul>",
            "<pre style=\"margin:0 0 10px 0;padding:10px;background:#090909;border:1px solid #444;border-radius:6px;overflow:auto;line-height:1.35;\">playerEnters{\n  message(text=\"Entered the grove\")\n  spawnCreature(type=\"bear\", size=1)\n}\nplayerExits{\n  message(text=\"Left the grove\")\n}</pre>",
            "<p style=\"margin:0;\">Inside trigger scripts, <code>\"this\"</code> refers to the trigger itself. You can use the normal scripting commands shown in the script editor help for messages, spawning creatures, visibility, activation, and more.</p>"
        ].join("");
    }

    function getTriggerAreaHelpPanel() {
        let $panel = $(`#${TRIGGER_AREA_HELP_PANEL_ID}`);
        if ($panel.length) return $panel;

        $panel = $("<div>")
            .attr("id", TRIGGER_AREA_HELP_PANEL_ID)
            .css({
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "min(760px, 84vw)",
                height: "min(560px, 74vh)",
                display: "none",
                "z-index": 200220,
                background: "rgba(12,12,12,0.98)",
                border: "1px solid #ffd700",
                "border-radius": "8px",
                padding: "12px",
                "box-sizing": "border-box",
                color: "#fff"
            })
            .on("mousedown click keydown keyup", event => {
                event.stopPropagation();
            });

        const $content = $("<div>")
            .html(getTriggerAreaHelpMarkup())
            .css({
                height: "calc(100% - 44px)",
                overflow: "auto",
                "padding-right": "4px",
                "line-height": "1.35"
            });

        const $actions = $("<div>")
            .css({
                display: "flex",
                "justify-content": "flex-end",
                gap: "8px",
                "margin-top": "10px"
            });

        const $close = $("<button>")
            .text("Close")
            .css({
                padding: "6px 12px",
                color: "#111",
                background: "#ffd700",
                border: "1px solid #caa700",
                "border-radius": "4px",
                cursor: "pointer",
                "font-weight": "bold"
            })
            .on("click", () => closeTriggerAreaHelpPanel());

        $actions.append($close);
        $panel.append($content, $actions);
        $(document.body).append($panel);
        return $panel;
    }

    function openTriggerAreaHelpPanel() {
        getTriggerAreaHelpPanel().show();
    }

    function closeTriggerAreaHelpPanel() {
        $(`#${TRIGGER_AREA_HELP_PANEL_ID}`).hide();
    }

    function getTriggerAreaPlacementPreview(wizardRef) {
        if (!wizardRef || wizardRef.currentSpell !== "triggerarea") return null;
        const draft = wizardRef._triggerAreaPlacementDraft;
        if (!draft || !Array.isArray(draft.points) || draft.points.length === 0) return null;
        return {
            points: draft.points
        };
    }

    function getFloorShapePlacementPreview(wizardRef, options) {
        if (!wizardRef || wizardRef.currentSpell !== "floorshape") return null;
        const draft = wizardRef._floorShapePlacementDraft;
        if (!draft || !Array.isArray(draft.points) || draft.points.length === 0) {
            // No drawing in progress — check if we are hovering over a valid wall loop.
            const mousePosHint = (options && options.mouseWorldPos) ? options.mouseWorldPos : null;
            const mouseX = (mousePosHint && Number.isFinite(mousePosHint.x)) ? mousePosHint.x
                : ((typeof globalThis !== "undefined" && globalThis.mousePos && Number.isFinite(globalThis.mousePos.worldX)) ? globalThis.mousePos.worldX : null);
            const mouseY = (mousePosHint && Number.isFinite(mousePosHint.y)) ? mousePosHint.y
                : ((typeof globalThis !== "undefined" && globalThis.mousePos && Number.isFinite(globalThis.mousePos.worldY)) ? globalThis.mousePos.worldY : null);
            if (!Number.isFinite(mouseX) || !Number.isFinite(mouseY)) return null;
            const wallLoop = getFloorShapeWallLoopCandidate(wizardRef, mouseX, mouseY);
            if (wallLoop) {
                return { points: wallLoop.polygonPoints, isWallLoop: true, wallSections: wallLoop.wallSections };
            }
            return null;
        }
        return {
            points: draft.points
        };
    }

    function getFloorHolePlacementPreview(wizardRef) {
        if (!wizardRef || wizardRef.currentSpell !== "floorhole") return null;
        const draft = wizardRef._floorHolePlacementDraft;
        if (!draft || !Array.isArray(draft.points) || draft.points.length === 0) return null;
        return {
            points: draft.points
        };
    }

    // Returns a wall-loop candidate when hovering a valid closed wall shape with no floor
    // drawing in progress. The candidate polygon becomes the floor outline on one click.
    function getFloorShapeWallLoopCandidate(wizardRef, worldX, worldY) {
        if (!wizardRef || wizardRef.currentSpell !== "floorshape") return null;
        const draft = wizardRef._floorShapePlacementDraft;
        if (draft && Array.isArray(draft.points) && draft.points.length > 0) return null;
        const mapRef = wizardRef.map;
        if (!mapRef || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const roofApi = (typeof globalThis !== "undefined" && typeof globalThis.Roof === "function")
            ? globalThis.Roof
            : ((typeof Roof === "function") ? Roof : null);
        if (!roofApi) return null;
        const wallCtor = (typeof globalThis !== "undefined" && globalThis.WallSectionUnit) || null;
        if (!wallCtor || !(wallCtor._allSections instanceof Map) || wallCtor._allSections.size === 0) return null;

        // Use world-space proximity so detection works at any floor level (not just level 0).
        // Find the nearest wall section whose midpoint is within a reasonable world-unit radius.
        const SNAP_RADIUS_WORLD = 3;
        let bestSection = null;
        let bestDist = SNAP_RADIUS_WORLD;
        for (const section of wallCtor._allSections.values()) {
            if (!section || section.gone || section.vanishing || !section.startPoint || !section.endPoint) continue;
            const sx = Number(section.startPoint.x);
            const sy = Number(section.startPoint.y);
            const ex = Number(section.endPoint.x);
            const ey = Number(section.endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) continue;
            // Wrap-corrected shortest delta for torus-map support.
            const dsx = (typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(worldX, sx) : (sx - worldX);
            const dsy = (typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(worldY, sy) : (sy - worldY);
            const dex = (typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(worldX, ex) : (ex - worldX);
            const dey = (typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(worldY, ey) : (ey - worldY);
            // Distance from cursor to segment using projected closest point.
            const segDx = dex - dsx;
            const segDy = dey - dsy;
            const segLen2 = segDx * segDx + segDy * segDy;
            let dist;
            if (segLen2 < 1e-8) {
                dist = Math.hypot(dsx, dsy);
            } else {
                const t = Math.max(0, Math.min(1, (-dsx * segDx - dsy * segDy) / segLen2));
                dist = Math.hypot(dsx + segDx * t, dsy + segDy * t);
            }
            if (dist < bestDist) {
                bestDist = dist;
                bestSection = section;
            }
        }
        if (!bestSection) return null;

        let loopSections = null;
        if (typeof roofApi.findWallLoopFromStartSection === "function") {
            loopSections = roofApi.findWallLoopFromStartSection(bestSection, mapRef, wallCtor);
        }
        if ((!loopSections || loopSections.length < 3) && typeof roofApi.findConvexWallLoopFromStartSection === "function") {
            loopSections = roofApi.findConvexWallLoopFromStartSection(bestSection, mapRef, wallCtor);
        }
        if (!Array.isArray(loopSections) || loopSections.length < 3) return null;
        if (typeof roofApi.extractWallLoopPolygonPoints !== "function") return null;
        const polygonPoints = roofApi.extractWallLoopPolygonPoints(loopSections, mapRef, wallCtor);
        if (!polygonPoints || polygonPoints.length < 3) return null;
        return { wallSections: loopSections, polygonPoints };
    }

    function getScreenDistancePxBetweenWorldPoints(a, b) {
        if (
            !a || !b ||
            !Number.isFinite(a.x) || !Number.isFinite(a.y) ||
            !Number.isFinite(b.x) || !Number.isFinite(b.y)
        ) {
            return Infinity;
        }
        const toScreen = (typeof worldToScreen === "function")
            ? worldToScreen
            : null;
        if (!toScreen) return Infinity;
        const as = toScreen({ x: Number(a.x), y: Number(a.y) });
        const bs = toScreen({ x: Number(b.x), y: Number(b.y) });
        if (
            !as || !bs ||
            !Number.isFinite(as.x) || !Number.isFinite(as.y) ||
            !Number.isFinite(bs.x) || !Number.isFinite(bs.y)
        ) {
            return Infinity;
        }
        return Math.hypot(Number(as.x) - Number(bs.x), Number(as.y) - Number(bs.y));
    }

    function finalizeTriggerAreaPlacement(wizardRef) {
        if (!wizardRef || !wizardRef.map) return false;
        const draft = wizardRef._triggerAreaPlacementDraft;
        if (!draft || !Array.isArray(draft.points) || draft.points.length < 3) return false;
        const points = draft.points.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
        const TriggerAreaCtor = (typeof globalThis !== "undefined" && typeof globalThis.TriggerArea === "function")
            ? globalThis.TriggerArea
            : null;
        if (!TriggerAreaCtor) {
            message("Trigger area object is unavailable.");
            return false;
        }
        const created = new TriggerAreaCtor({ x: points[0].x, y: points[0].y }, wizardRef.map, { points });
        if (Array.isArray(wizardRef.map.objects) && !wizardRef.map.objects.includes(created)) {
            wizardRef.map.objects.push(created);
        }
        // Immediately flush the dirty-capture queue so the trigger area is registered
        // in the prototype trigger registry and becomes visible in the editor right away.
        // Without this, the TriggerArea sits in dirtyRuntimeObjects and is invisible
        // until the next bubble-shift async cycle processes it.
        if (
            wizardRef.map._prototypeTriggerState &&
            typeof wizardRef.map.capturePendingPrototypeObjects === "function"
        ) {
            wizardRef.map.capturePendingPrototypeObjects();
        }
        if (
            typeof globalThis !== "undefined" &&
            globalThis.Scripting &&
            typeof globalThis.Scripting.runObjectInitScript === "function"
        ) {
            globalThis.Scripting.runObjectInitScript(created, wizardRef, { reason: "objectCreated" });
        }
        if (
            typeof globalThis !== "undefined" &&
            globalThis.Scripting &&
            typeof globalThis.Scripting.openScriptEditorForTarget === "function"
        ) {
            globalThis.Scripting.openScriptEditorForTarget(created);
        }
        wizardRef._triggerAreaPlacementDraft = null;
        return true;
    }

    function pointInFloorEditPolygon2D(x, y, polygon) {
        if (!Array.isArray(polygon) || polygon.length < 3) return false;
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const pi = polygon[i] || {};
            const pj = polygon[j] || {};
            const xi = Number(pi.x);
            const yi = Number(pi.y);
            const xj = Number(pj.x);
            const yj = Number(pj.y);
            if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) continue;
            const intersects = ((yi > y) !== (yj > y)) &&
                (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    function pointOnFloorEditSegment2D(x, y, a, b) {
        const ax = Number(a && a.x);
        const ay = Number(a && a.y);
        const bx = Number(b && b.x);
        const by = Number(b && b.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return false;
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (lenSq <= 1e-12) return Math.hypot(x - ax, y - ay) <= 1e-6;
        const t = ((x - ax) * dx + (y - ay) * dy) / lenSq;
        if (t < -1e-6 || t > 1 + 1e-6) return false;
        const px = ax + t * dx;
        const py = ay + t * dy;
        return Math.hypot(x - px, y - py) <= 1e-6;
    }

    function pointInOrOnFloorEditPolygon2D(x, y, polygon) {
        if (!Array.isArray(polygon) || polygon.length < 3) return false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            if (pointOnFloorEditSegment2D(x, y, polygon[j], polygon[i])) return true;
        }
        return pointInFloorEditPolygon2D(x, y, polygon);
    }

    function normalizeFloorEditPolygonRing(points) {
        if (!Array.isArray(points)) return [];
        const out = [];
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            const x = Number(point && point.x);
            const y = Number(point && point.y);
            if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
        }
        return out;
    }

    function floorEditPolygonContainsRing(coveringPolygon, ring) {
        const cover = normalizeFloorEditPolygonRing(coveringPolygon);
        const target = normalizeFloorEditPolygonRing(ring);
        if (cover.length < 3 || target.length < 3) return false;
        for (let i = 0; i < target.length; i++) {
            if (!pointInOrOnFloorEditPolygon2D(target[i].x, target[i].y, cover)) return false;
        }
        return true;
    }

    function filterCoveredFloorEditHolePairs(holes, visibilityHoles, coveringPolygon) {
        const sourceHoles = Array.isArray(holes) ? holes : [];
        const sourceVisibilityHoles = Array.isArray(visibilityHoles) ? visibilityHoles : [];
        const nextHoles = [];
        const nextVisibilityHoles = [];
        let removed = 0;
        const count = Math.max(sourceHoles.length, sourceVisibilityHoles.length);
        for (let i = 0; i < count; i++) {
            const hole = sourceHoles[i];
            const visibilityHole = sourceVisibilityHoles[i];
            const ring = Array.isArray(visibilityHole) && visibilityHole.length >= 3 ? visibilityHole : hole;
            if (floorEditPolygonContainsRing(coveringPolygon, ring)) {
                removed += 1;
                continue;
            }
            if (Array.isArray(hole)) nextHoles.push(hole);
            if (Array.isArray(visibilityHole)) nextVisibilityHoles.push(visibilityHole);
        }
        return { holes: nextHoles, visibilityHoles: nextVisibilityHoles, removed };
    }

    function clearCoveredFloorEditHiddenKeys(mapRef, level, tileCoordKeysBySection) {
        if (!mapRef || !(mapRef._floorEditHiddenTileKeysByLevel instanceof Map)) return 0;
        const hiddenKeys = mapRef._floorEditHiddenTileKeysByLevel.get(normalizeFloorEditLevel(level));
        if (!(hiddenKeys instanceof Set) || !(tileCoordKeysBySection instanceof Map)) return 0;
        let cleared = 0;
        for (const tileCoordKeys of tileCoordKeysBySection.values()) {
            if (!Array.isArray(tileCoordKeys)) continue;
            for (let i = 0; i < tileCoordKeys.length; i++) {
                if (hiddenKeys.delete(tileCoordKeys[i])) cleared += 1;
            }
        }
        return cleared;
    }

    function removeFloorEditHolesCoveredByPolygon(mapRef, level, coveringPolygon, tileCoordKeysBySection) {
        if (!mapRef) return { holes: 0, hiddenTiles: 0 };
        let removedHoles = 0;
        const normalizedLevel = normalizeFloorEditLevel(level);
        const hiddenTiles = clearCoveredFloorEditHiddenKeys(mapRef, normalizedLevel, tileCoordKeysBySection);
        if (mapRef.floorsById instanceof Map) {
            for (const fragment of mapRef.floorsById.values()) {
                if (!fragment || normalizeFloorEditLevel(fragment.level) !== normalizedLevel) continue;
                const filtered = filterCoveredFloorEditHolePairs(fragment.holes, fragment.visibilityHoles, coveringPolygon);
                if (filtered.removed <= 0) continue;
                fragment.holes = filtered.holes;
                fragment.visibilityHoles = filtered.visibilityHoles;
                removedHoles += filtered.removed;
            }
        }
        const state = mapRef._prototypeSectionState || null;
        if (state && state.sectionAssetsByKey instanceof Map) {
            for (const asset of state.sectionAssetsByKey.values()) {
                if (!asset) continue;
                if (Array.isArray(asset.floorHoles) && asset.floorHoles.length > 0) {
                    const keptHoles = [];
                    for (let i = 0; i < asset.floorHoles.length; i++) {
                        const hole = asset.floorHoles[i];
                        if (
                            hole &&
                            normalizeFloorEditLevel(hole.level) === normalizedLevel &&
                            floorEditPolygonContainsRing(coveringPolygon, hole.points)
                        ) {
                            removedHoles += 1;
                            continue;
                        }
                        keptHoles.push(hole);
                    }
                    asset.floorHoles = keptHoles;
                }
                if (!Array.isArray(asset.floors)) continue;
                for (let i = 0; i < asset.floors.length; i++) {
                    const floor = asset.floors[i];
                    if (!floor || normalizeFloorEditLevel(floor.level) !== normalizedLevel) continue;
                    const filtered = filterCoveredFloorEditHolePairs(floor.holes, floor.visibilityHoles, coveringPolygon);
                    if (filtered.removed <= 0) continue;
                    floor.holes = filtered.holes;
                    floor.visibilityHoles = filtered.visibilityHoles;
                    removedHoles += filtered.removed;
                }
            }
        }
        return { holes: removedHoles, hiddenTiles };
    }

    function getFloorBooleanApi() {
        return (typeof globalThis !== "undefined" && globalThis.polygonClipping)
            ? globalThis.polygonClipping
            : null;
    }

    function floorEditPointsToClipRing(points) {
        const normalized = normalizeFloorEditPolygonRing(points);
        if (normalized.length < 3) return null;
        const ring = normalized.map(point => [point.x, point.y]);
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (!last || Math.abs(first[0] - last[0]) > 1e-9 || Math.abs(first[1] - last[1]) > 1e-9) {
            ring.push([first[0], first[1]]);
        }
        return ring;
    }

    function floorEditClipRingToPoints(ring) {
        if (!Array.isArray(ring)) return [];
        const points = [];
        for (let i = 0; i < ring.length; i++) {
            const pair = ring[i];
            const x = Number(pair && pair[0]);
            const y = Number(pair && pair[1]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            if (
                i === ring.length - 1 &&
                points.length > 0 &&
                Math.abs(points[0].x - x) <= 1e-9 &&
                Math.abs(points[0].y - y) <= 1e-9
            ) {
                continue;
            }
            points.push({ x, y });
        }
        return points;
    }

    function floorEditClipMultiPolygonFromPoints(points) {
        const ring = floorEditPointsToClipRing(points);
        return ring ? [[ring]] : [];
    }

    function isFloorEditClipGeometryEmpty(geometry) {
        return !Array.isArray(geometry) || geometry.length === 0;
    }

    function floorEditSafeBoolean(operation, ...geometries) {
        const api = getFloorBooleanApi();
        if (!api || typeof api[operation] !== "function") return [];
        if (operation === "difference") {
            const subject = geometries[0];
            if (isFloorEditClipGeometryEmpty(subject)) return [];
            const clips = geometries.slice(1).filter(geometry => !isFloorEditClipGeometryEmpty(geometry));
            if (clips.length === 0) return subject;
            return api.difference(subject, ...clips);
        }
        const usable = geometries.filter(geometry => !isFloorEditClipGeometryEmpty(geometry));
        if (usable.length === 0) return [];
        if (usable.length === 1) return usable[0];
        return api[operation](...usable);
    }

    function floorEditWorldFromTileKey(tileKey) {
        const [xRaw, yRaw] = String(tileKey || "").split(",");
        const x = Number(xRaw);
        const y = Number(yRaw);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x: x * 0.866, y: y + (x % 2 === 0 ? 0.5 : 0) };
    }

    function floorEditCross(a, b, c) {
        return ((b.x - a.x) * (c.y - a.y)) - ((b.y - a.y) * (c.x - a.x));
    }

    function floorEditConvexHull(points) {
        const normalized = normalizeFloorEditPolygonRing(points)
            .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
        if (normalized.length <= 1) return normalized;
        const unique = [];
        for (let i = 0; i < normalized.length; i++) {
            const point = normalized[i];
            const prev = unique[unique.length - 1];
            if (!prev || Math.abs(prev.x - point.x) > 1e-9 || Math.abs(prev.y - point.y) > 1e-9) {
                unique.push(point);
            }
        }
        if (unique.length <= 2) return unique;
        const lower = [];
        for (let i = 0; i < unique.length; i++) {
            while (lower.length >= 2 && floorEditCross(lower[lower.length - 2], lower[lower.length - 1], unique[i]) <= 0) {
                lower.pop();
            }
            lower.push(unique[i]);
        }
        const upper = [];
        for (let i = unique.length - 1; i >= 0; i--) {
            while (upper.length >= 2 && floorEditCross(upper[upper.length - 2], upper[upper.length - 1], unique[i]) <= 0) {
                upper.pop();
            }
            upper.push(unique[i]);
        }
        lower.pop();
        upper.pop();
        return lower.concat(upper);
    }

    function getFloorEditSectionPolygon(asset) {
        if (!asset || typeof asset !== "object") return [];
        if (Array.isArray(asset._floorEditSectionPolygon) && asset._floorEditSectionPolygon.length >= 3) {
            return asset._floorEditSectionPolygon;
        }
        const tileCoordKeys = Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys : [];
        const points = [];
        for (let i = 0; i < tileCoordKeys.length; i++) {
            const point = floorEditWorldFromTileKey(tileCoordKeys[i]);
            if (point) points.push(point);
        }
        const hull = floorEditConvexHull(points);
        asset._floorEditSectionPolygon = hull.length >= 3 ? hull : [];
        return asset._floorEditSectionPolygon;
    }

    function getFloorEditAssetAreaGeometry(asset, level) {
        const normalizedLevel = normalizeFloorEditLevel(level);
        const floorGeometries = [];
        const floors = Array.isArray(asset && asset.floors) ? asset.floors : [];
        for (let i = 0; i < floors.length; i++) {
            const floor = floors[i];
            if (!floor || normalizeFloorEditLevel(floor.level) !== normalizedLevel) continue;
            const outerRing = floorEditPointsToClipRing(floor.outerPolygon);
            if (!outerRing) continue;
            const polygon = [outerRing];
            const holes = Array.isArray(floor.holes) ? floor.holes : [];
            for (let h = 0; h < holes.length; h++) {
                const holeRing = floorEditPointsToClipRing(holes[h]);
                if (holeRing) polygon.push(holeRing);
            }
            floorGeometries.push([polygon]);
        }
        let area = floorGeometries.length > 0
            ? floorEditSafeBoolean("union", ...floorGeometries)
            : [];
        if (floorGeometries.length === 0 && normalizedLevel === 0) {
            area = floorEditClipMultiPolygonFromPoints(getFloorEditSectionPolygon(asset));
        }
        const legacyHoles = Array.isArray(asset && asset.floorHoles) ? asset.floorHoles : [];
        for (let i = 0; i < legacyHoles.length; i++) {
            const hole = legacyHoles[i];
            if (!hole || normalizeFloorEditLevel(hole.level) !== normalizedLevel) continue;
            const holeGeom = floorEditClipMultiPolygonFromPoints(hole.points);
            if (!isFloorEditClipGeometryEmpty(holeGeom)) {
                area = floorEditSafeBoolean("difference", area, holeGeom);
            }
        }
        return area;
    }

    function getFloorEditTileCoordKeysForPolygon(asset, outer, holes) {
        const tileCoordKeys = Array.isArray(asset && asset.tileCoordKeys) ? asset.tileCoordKeys : [];
        const out = [];
        for (let i = 0; i < tileCoordKeys.length; i++) {
            const tileKey = tileCoordKeys[i];
            const point = floorEditWorldFromTileKey(tileKey);
            if (!point) continue;
            if (!pointInOrOnFloorEditPolygon2D(point.x, point.y, outer)) continue;
            let inHole = false;
            const normalizedHoles = Array.isArray(holes) ? holes : [];
            for (let h = 0; h < normalizedHoles.length; h++) {
                if (pointInOrOnFloorEditPolygon2D(point.x, point.y, normalizedHoles[h])) {
                    inHole = true;
                    break;
                }
            }
            if (!inHole) out.push(tileKey);
        }
        return out;
    }

    function floorEditVoidRecordsFromGeometry(level, geometry) {
        const out = [];
        if (!Array.isArray(geometry)) return out;
        for (let i = 0; i < geometry.length; i++) {
            const polygon = geometry[i];
            if (!Array.isArray(polygon) || polygon.length === 0) continue;
            const points = floorEditClipRingToPoints(polygon[0]);
            if (points.length < 3) continue;
            const holes = [];
            for (let h = 1; h < polygon.length; h++) {
                const hole = floorEditClipRingToPoints(polygon[h]);
                if (hole.length >= 3) holes.push(hole);
            }
            out.push({ level, points, holes });
        }
        return out;
    }

    function setFloorEditAssetAreaGeometry(asset, level, geometry) {
        if (!asset) return { fragments: 0, tiles: 0, voids: 0 };
        const normalizedLevel = normalizeFloorEditLevel(level);
        const existingFloors = Array.isArray(asset.floors) ? asset.floors : [];
        const nextFloors = existingFloors.filter(floor => !floor || normalizeFloorEditLevel(floor.level) !== normalizedLevel);
        const surfaceId = `floor_area:${asset.key}:${normalizedLevel}`;
        let fragments = 0;
        let tiles = 0;
        if (Array.isArray(geometry)) {
            for (let i = 0; i < geometry.length; i++) {
                const polygon = geometry[i];
                if (!Array.isArray(polygon) || polygon.length === 0) continue;
                const outer = floorEditClipRingToPoints(polygon[0]);
                if (outer.length < 3) continue;
                const holes = [];
                for (let h = 1; h < polygon.length; h++) {
                    const hole = floorEditClipRingToPoints(polygon[h]);
                    if (hole.length >= 3) holes.push(hole);
                }
                const tileCoordKeys = getFloorEditTileCoordKeysForPolygon(asset, outer, holes);
                tiles += tileCoordKeys.length;
                nextFloors.push({
                    fragmentId: `${surfaceId}:${i}`,
                    surfaceId,
                    ownerSectionKey: asset.key,
                    level: normalizedLevel,
                    nodeBaseZOffset: 0,
                    nodeBaseZ: normalizedLevel * 3,
                    outerPolygon: outer,
                    holes,
                    visibilityPolygon: outer.map(p => ({ ...p })),
                    visibilityHoles: holes.map(hole => hole.map(p => ({ ...p }))),
                    tileCoordKeys
                });
                fragments += 1;
            }
        }
        if (fragments === 0 && normalizedLevel === 0) {
            nextFloors.push({
                fragmentId: `${surfaceId}:empty`,
                surfaceId,
                ownerSectionKey: asset.key,
                level: 0,
                nodeBaseZOffset: 0,
                nodeBaseZ: 0,
                outerPolygon: [],
                holes: [],
                visibilityPolygon: [],
                visibilityHoles: [],
                tileCoordKeys: [],
                _floorEditEmpty: true
            });
        }
        asset.floors = nextFloors;
        if (Array.isArray(asset.floorHoles)) {
            asset.floorHoles = asset.floorHoles.filter(hole => !hole || normalizeFloorEditLevel(hole.level) !== normalizedLevel);
        }
        if (!Array.isArray(asset.floorVoids)) asset.floorVoids = [];
        asset.floorVoids = asset.floorVoids.filter(record => !record || normalizeFloorEditLevel(record.level) !== normalizedLevel);
        if (normalizedLevel === 0) {
            asset._level0SurfaceVersion = (Number(asset._level0SurfaceVersion) || 0) + 1;
        }
        let voids = 0;
        return { fragments, tiles, voids };
    }

    function markLevel0SurfaceRoadDirtyForNode(mapRef, node) {
        if (!mapRef || !node) return false;
        const sectionKey = typeof node._prototypeSectionKey === "string" ? node._prototypeSectionKey : "";
        const state = mapRef._prototypeSectionState || null;
        const asset = sectionKey && state && state.sectionAssetsByKey instanceof Map
            ? state.sectionAssetsByKey.get(sectionKey)
            : null;
        if (!asset) return false;
        if (typeof globalThis.markPrototypeLevel0RoadSurfaceDirty === "function") {
            return globalThis.markPrototypeLevel0RoadSurfaceDirty(mapRef, node);
        }
        asset._level0RoadSurfaceVersion = (Number(asset._level0RoadSurfaceVersion) || 0) + 1;
        return true;
    }

    function rematerializeFloorEditSections(mapRef, sectionKeys) {
        if (!mapRef || !(sectionKeys instanceof Set)) return 0;
        let count = 0;
        for (const sectionKey of sectionKeys) {
            if (typeof mapRef.unregisterSectionFloorNodes === "function") {
                mapRef.unregisterSectionFloorNodes(sectionKey);
            } else if (typeof mapRef.unregisterFloorSection === "function") {
                mapRef.unregisterFloorSection(sectionKey);
            }
            if (typeof mapRef.registerSectionFloorNodes === "function") {
                mapRef.registerSectionFloorNodes(sectionKey);
            }
            count += 1;
        }
        return count;
    }

    function applyFloorBooleanEdit(wizardRef, operation) {
        if (!wizardRef || !wizardRef.map) return false;
        const draft = operation === "subtract" ? wizardRef._floorHolePlacementDraft : wizardRef._floorShapePlacementDraft;
        if (!draft || !Array.isArray(draft.points) || draft.points.length < 3) return false;
        const api = getFloorBooleanApi();
        if (!api) {
            message("Floor boolean editing is unavailable: polygon-clipping did not load.");
            return false;
        }
        const mapRef = wizardRef.map;
        const state = mapRef._prototypeSectionState || null;
        if (!state || !(state.sectionAssetsByKey instanceof Map)) return false;
        const level = getSelectedFloorEditLevel(wizardRef);
        const points = normalizeFloorEditPolygonRing(draft.points);
        if (points.length < 3) return false;
        recordFloorEditDiagnostic("boolean.apply.start", {
            operation,
            level,
            points: points.length,
            firstPoint: points[0] || null,
            wizardLayer: Number.isFinite(wizardRef.currentLayer) ? Number(wizardRef.currentLayer) : null,
            wizardBaseZ: Number.isFinite(wizardRef.currentLayerBaseZ) ? Number(wizardRef.currentLayerBaseZ) : null,
            cameraZ: (typeof globalThis !== "undefined" && globalThis.viewport && Number.isFinite(globalThis.viewport.z))
                ? Number(globalThis.viewport.z)
                : null
        });
        const drawnGeometry = floorEditClipMultiPolygonFromPoints(points);
        if (isFloorEditClipGeometryEmpty(drawnGeometry)) return false;
        const changedSectionKeys = new Set();
        let totalFragments = 0;
        let totalTiles = 0;
        for (const [sectionKey, asset] of state.sectionAssetsByKey.entries()) {
            const sectionGeometry = floorEditClipMultiPolygonFromPoints(getFloorEditSectionPolygon(asset));
            if (isFloorEditClipGeometryEmpty(sectionGeometry)) continue;
            const editGeometry = floorEditSafeBoolean("intersection", sectionGeometry, drawnGeometry);
            if (isFloorEditClipGeometryEmpty(editGeometry)) continue;
            const currentGeometry = getFloorEditAssetAreaGeometry(asset, level);
            const nextGeometry = operation === "subtract"
                ? floorEditSafeBoolean("difference", currentGeometry, editGeometry)
                : floorEditSafeBoolean("union", currentGeometry, editGeometry);
            const result = setFloorEditAssetAreaGeometry(asset, level, nextGeometry);
            changedSectionKeys.add(sectionKey);
            totalFragments += result.fragments;
            totalTiles += result.tiles;
        }
        if (mapRef._floorEditHiddenTileKeysByLevel instanceof Map) {
            mapRef._floorEditHiddenTileKeysByLevel.delete(level);
        }
        rematerializeFloorEditSections(mapRef, changedSectionKeys);
        if (operation === "subtract") {
            wizardRef._floorHolePlacementDraft = null;
            message(`Subtracted from floor level ${level > 0 ? `+${level}` : level}: updated ${changedSectionKeys.size} section${changedSectionKeys.size === 1 ? "" : "s"}.`);
        } else {
            wizardRef._floorShapePlacementDraft = null;
            message(`Added to floor level ${level > 0 ? `+${level}` : level}: ${totalTiles} tiles across ${totalFragments} fragment${totalFragments === 1 ? "" : "s"}.`);
        }
        recordFloorEditDiagnostic("boolean.apply.finish", {
            operation,
            level,
            changedSections: changedSectionKeys.size,
            totalFragments,
            totalTiles
        });
        if (typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
            globalThis.presentGameFrame();
        }
        return true;
    }

    function getFloorEditSourceNodes(mapRef) {
        if (!mapRef) return [];
        if (typeof mapRef.getAllPrototypeNodes === "function") {
            const nodes = mapRef.getAllPrototypeNodes();
            if (Array.isArray(nodes) && nodes.length > 0) return nodes;
        }
        if (!Array.isArray(mapRef.nodes)) return [];
        const out = [];
        for (let x = 0; x < mapRef.nodes.length; x++) {
            const col = mapRef.nodes[x];
            if (!Array.isArray(col)) continue;
            for (let y = 0; y < col.length; y++) {
                if (col[y]) out.push(col[y]);
            }
        }
        return out;
    }

    function finalizeFloorShapePlacement(wizardRef) {
        return applyFloorBooleanEdit(wizardRef, "add");
        /*
        if (!wizardRef || !wizardRef.map) return false;
        const draft = wizardRef._floorShapePlacementDraft;
        if (!draft || !Array.isArray(draft.points) || draft.points.length < 3) return false;
        const mapRef = wizardRef.map;
        const points = draft.points.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
            .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (points.length < 3) return false;
        const level = getSelectedFloorEditLevel(wizardRef);
        const surfaceId = `floor_edit_surface:${level}:${Date.now().toString(36)}:${Math.floor(Math.random() * 100000).toString(36)}`;
        const sourceNodes = getFloorEditSourceNodes(mapRef);
        const nodesBySection = new Map();
        const tileCoordKeysBySection = new Map();
        for (let i = 0; i < sourceNodes.length; i++) {
            const node = sourceNodes[i];
            if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
            if (typeof mapRef.isPrototypeNodeActive === "function" && !mapRef.isPrototypeNodeActive(node)) continue;
            if (!pointInFloorEditPolygon2D(Number(node.x), Number(node.y), points)) continue;
            const sectionKey = (typeof node._prototypeSectionKey === "string" && node._prototypeSectionKey.length > 0)
                ? node._prototypeSectionKey
                : "runtime";
            if (!nodesBySection.has(sectionKey)) nodesBySection.set(sectionKey, []);
            nodesBySection.get(sectionKey).push(node);
            if (!tileCoordKeysBySection.has(sectionKey)) tileCoordKeysBySection.set(sectionKey, []);
            tileCoordKeysBySection.get(sectionKey).push(`${node.xindex},${node.yindex}`);
        }
        const healed = removeFloorEditHolesCoveredByPolygon(mapRef, level, points, tileCoordKeysBySection);
        if (nodesBySection.size === 0) {
            wizardRef._floorShapePlacementDraft = null;
            if (healed.holes > 0 || healed.hiddenTiles > 0) {
                message(`Healed floor level ${level > 0 ? `+${level}` : level}: removed ${healed.holes} hole${healed.holes === 1 ? "" : "s"}.`);
            } else {
                message("Floor polygon created, but no active tiles were inside it.");
            }
            return true;
        }

        const createdNodes = [];
        let fragmentCount = 0;
        for (const [sectionKey, sectionNodes] of nodesBySection.entries()) {
            const fragmentId = `${surfaceId}:${sectionKey}`;
            const tileCoordKeys = tileCoordKeysBySection.get(sectionKey) || [];
            const floorRecord = {
                fragmentId,
                surfaceId,
                ownerSectionKey: sectionKey,
                level,
                nodeBaseZ: level,
                outerPolygon: points,
                holes: [],
                visibilityPolygon: points,
                visibilityHoles: [],
                tileCoordKeys
            };
            const fragment = mapRef.registerFloorFragment(floorRecord);
            if (!fragment) continue;
            const state = mapRef._prototypeSectionState || null;
            const asset = state && state.sectionAssetsByKey instanceof Map
                ? state.sectionAssetsByKey.get(sectionKey)
                : null;
            if (asset) {
                if (!Array.isArray(asset.floors)) asset.floors = [];
                asset.floors.push({ ...floorRecord, outerPolygon: points.map(p => ({ ...p })), visibilityPolygon: points.map(p => ({ ...p })) });
            }
            fragmentCount += 1;
            for (let i = 0; i < sectionNodes.length; i++) {
                const node = sectionNodes[i];
                const floorNode = mapRef.createFloorNodeFromSource(node, fragment, {
                    baseZ: level,
                    traversalLayer: level
                });
                if (!floorNode) continue;
                createdNodes.push(floorNode);
            }
        }
        if (createdNodes.length > 0 && typeof mapRef._connectFloorNodesIncremental === "function") {
            const newNodeIdSet = new Set(createdNodes.map(node => node && node.id).filter(Boolean));
            mapRef._connectFloorNodesIncremental(createdNodes, newNodeIdSet);
        }
        wizardRef._floorShapePlacementDraft = null;
        if (createdNodes.length > 0) {
            const healedText = healed.holes > 0
                ? ` Removed ${healed.holes} covered hole${healed.holes === 1 ? "" : "s"}.`
                : "";
            message(`Added floor level ${level > 0 ? `+${level}` : level}: ${createdNodes.length} tiles across ${fragmentCount} fragment${fragmentCount === 1 ? "" : "s"}.${healedText}`);
        } else {
            message("Floor polygon created, but no active tiles were inside it.");
        }
        if (typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
            globalThis.presentGameFrame();
        }
        return true;
        */
    }

    function ensureFloorEditHiddenKeySet(mapRef, level) {
        if (!mapRef) return null;
        if (!(mapRef._floorEditHiddenTileKeysByLevel instanceof Map)) {
            mapRef._floorEditHiddenTileKeysByLevel = new Map();
        }
        const normalizedLevel = normalizeFloorEditLevel(level);
        if (!mapRef._floorEditHiddenTileKeysByLevel.has(normalizedLevel)) {
            mapRef._floorEditHiddenTileKeysByLevel.set(normalizedLevel, new Set());
        }
        return mapRef._floorEditHiddenTileKeysByLevel.get(normalizedLevel);
    }

    function addFloorHoleToSectionAssets(mapRef, level, points, tileCoordKeysBySection) {
        const state = mapRef && mapRef._prototypeSectionState;
        if (!state || !(state.sectionAssetsByKey instanceof Map)) return;
        for (const [sectionKey, tileCoordKeys] of tileCoordKeysBySection.entries()) {
            const asset = state.sectionAssetsByKey.get(sectionKey);
            if (!asset) continue;
            if (!Array.isArray(asset.floorHoles)) asset.floorHoles = [];
            asset.floorHoles.push({
                level,
                points: points.map(p => ({ x: Number(p.x), y: Number(p.y) })),
                tileCoordKeys: Array.isArray(tileCoordKeys) ? tileCoordKeys.slice() : []
            });
            if (!Array.isArray(asset.floors)) continue;
            for (let i = 0; i < asset.floors.length; i++) {
                const floor = asset.floors[i];
                if (!floor || Number(floor.level) !== Number(level)) continue;
                if (!Array.isArray(floor.holes)) floor.holes = [];
                if (!Array.isArray(floor.visibilityHoles)) floor.visibilityHoles = [];
                floor.holes.push(points.map(p => ({ x: Number(p.x), y: Number(p.y) })));
                floor.visibilityHoles.push(points.map(p => ({ x: Number(p.x), y: Number(p.y) })));
                if (Array.isArray(floor.tileCoordKeys) && tileCoordKeys.length > 0) {
                    const removeKeys = new Set(tileCoordKeys);
                    floor.tileCoordKeys = floor.tileCoordKeys.filter(key => !removeKeys.has(key));
                }
            }
        }
    }

    function removeFloorNodesInsideHole(mapRef, level, points) {
        if (!mapRef || !(mapRef.floorNodesById instanceof Map)) return 0;
        const removedNodes = [];
        const removedNodeIds = new Set();
        for (const [fragmentId, nodes] of mapRef.floorNodesById.entries()) {
            if (!Array.isArray(nodes) || nodes.length === 0) continue;
            const keep = [];
            const removeTileKeys = [];
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                const nodeLevel = Number.isFinite(node && node.traversalLayer)
                    ? Number(node.traversalLayer)
                    : (Number.isFinite(node && node.level) ? Number(node.level) : 0);
                if (
                    Math.round(nodeLevel) === Math.round(level) &&
                    node &&
                    Number.isFinite(node.x) &&
                    Number.isFinite(node.y) &&
                    pointInFloorEditPolygon2D(Number(node.x), Number(node.y), points)
                ) {
                    removedNodes.push(node);
                    if (typeof node.id === "string") removedNodeIds.add(node.id);
                    removeTileKeys.push(`${node.xindex},${node.yindex}`);
                    if (mapRef.floorNodeIndex instanceof Map && typeof node.id === "string") {
                        mapRef.floorNodeIndex.delete(node.id);
                    }
                } else {
                    keep.push(node);
                }
            }
            if (keep.length !== nodes.length) {
                mapRef.floorNodesById.set(fragmentId, keep);
                const fragment = mapRef.floorsById instanceof Map ? mapRef.floorsById.get(fragmentId) : null;
                if (fragment) {
                    if (!Array.isArray(fragment.holes)) fragment.holes = [];
                    if (!Array.isArray(fragment.visibilityHoles)) fragment.visibilityHoles = [];
                    fragment.holes.push(points.map(p => ({ x: Number(p.x), y: Number(p.y) })));
                    fragment.visibilityHoles.push(points.map(p => ({ x: Number(p.x), y: Number(p.y) })));
                    if (Array.isArray(fragment.tileCoordKeys) && removeTileKeys.length > 0) {
                        const removeKeys = new Set(removeTileKeys);
                        fragment.tileCoordKeys = fragment.tileCoordKeys.filter(key => !removeKeys.has(key));
                    }
                }
            }
        }
        if (removedNodeIds.size > 0 && mapRef.floorNodesById instanceof Map) {
            for (const nodes of mapRef.floorNodesById.values()) {
                if (!Array.isArray(nodes)) continue;
                for (let i = 0; i < nodes.length; i++) {
                    const node = nodes[i];
                    if (!node || !Array.isArray(node.neighbors)) continue;
                    for (let d = 0; d < node.neighbors.length; d++) {
                        const neighbor = node.neighbors[d];
                        if (neighbor && typeof neighbor.id === "string" && removedNodeIds.has(neighbor.id)) {
                            node.neighbors[d] = null;
                        }
                    }
                }
            }
        }
        return removedNodes.length;
    }

    function finalizeFloorHolePlacement(wizardRef) {
        return applyFloorBooleanEdit(wizardRef, "subtract");
        /*
        if (!wizardRef || !wizardRef.map) return false;
        const draft = wizardRef._floorHolePlacementDraft;
        if (!draft || !Array.isArray(draft.points) || draft.points.length < 3) return false;
        const mapRef = wizardRef.map;
        const points = draft.points.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
            .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (points.length < 3) return false;
        const level = getSelectedFloorEditLevel(wizardRef);
        const hiddenKeys = level === 0 ? null : ensureFloorEditHiddenKeySet(mapRef, level);
        const tileCoordKeysBySection = new Map();
        const sourceNodes = getFloorEditSourceNodes(mapRef);
        let hiddenCount = 0;
        for (let i = 0; i < sourceNodes.length; i++) {
            const node = sourceNodes[i];
            if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
            if (typeof mapRef.isPrototypeNodeActive === "function" && !mapRef.isPrototypeNodeActive(node)) continue;
            if (!pointInFloorEditPolygon2D(Number(node.x), Number(node.y), points)) continue;
            const tileKey = `${node.xindex},${node.yindex}`;
            if (hiddenKeys && !hiddenKeys.has(tileKey)) {
                hiddenKeys.add(tileKey);
                hiddenCount += 1;
            }
            const sectionKey = (typeof node._prototypeSectionKey === "string" && node._prototypeSectionKey.length > 0)
                ? node._prototypeSectionKey
                : "runtime";
            if (!tileCoordKeysBySection.has(sectionKey)) tileCoordKeysBySection.set(sectionKey, []);
            tileCoordKeysBySection.get(sectionKey).push(tileKey);
        }
        const removedFloorNodeCount = removeFloorNodesInsideHole(mapRef, level, points);
        addFloorHoleToSectionAssets(mapRef, level, points, tileCoordKeysBySection);
        wizardRef._floorHolePlacementDraft = null;
        message(`Cut floor level ${level > 0 ? `+${level}` : level}: ${hiddenCount + removedFloorNodeCount} tiles.`);
        if (typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
            globalThis.presentGameFrame();
        }
        return true;
        */
    }

    function placeTriggerAreaVertex(wizardRef, worldX, worldY, options = {}) {
        if (!wizardRef || !wizardRef.map) return;
        const mapRef = wizardRef.map;
        const wrappedX = (typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(worldX) : worldX;
        const wrappedY = (typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(worldY) : worldY;
        if (!Number.isFinite(wrappedX) || !Number.isFinite(wrappedY)) return;
        const clickCount = Number.isFinite(options.clickCount) ? Math.max(1, Math.floor(Number(options.clickCount))) : 1;

        const draft = (
            wizardRef._triggerAreaPlacementDraft &&
            Array.isArray(wizardRef._triggerAreaPlacementDraft.points)
        )
            ? wizardRef._triggerAreaPlacementDraft
            : { points: [] };
        wizardRef._triggerAreaPlacementDraft = draft;

        if (clickCount >= 2 && draft.points.length >= 3) {
            finalizeTriggerAreaPlacement(wizardRef);
            return;
        }

        if (draft.points.length >= 3) {
            const start = draft.points[0];
            const click = { x: wrappedX, y: wrappedY };
            const closeDistancePx = getScreenDistancePxBetweenWorldPoints(start, click);
            if (closeDistancePx <= TRIGGER_AREA_CLOSE_DISTANCE_PX) {
                finalizeTriggerAreaPlacement(wizardRef);
                return;
            }
        }

        draft.points.push({ x: wrappedX, y: wrappedY });
    }

    function placeFloorShapeVertex(wizardRef, worldX, worldY, options = {}) {
        if (!wizardRef || !wizardRef.map) return;
        const mapRef = wizardRef.map;
        const wrappedX = (typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(worldX) : worldX;
        const wrappedY = (typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(worldY) : worldY;
        if (!Number.isFinite(wrappedX) || !Number.isFinite(wrappedY)) return;
        const clickCount = Number.isFinite(options.clickCount) ? Math.max(1, Math.floor(Number(options.clickCount))) : 1;
        const level = getSelectedFloorEditLevel(wizardRef);

        const draft = (
            wizardRef._floorShapePlacementDraft &&
            Array.isArray(wizardRef._floorShapePlacementDraft.points)
        )
            ? wizardRef._floorShapePlacementDraft
            : { points: [] };
        wizardRef._floorShapePlacementDraft = draft;

        // If no drawing has started yet, check for a wall-loop snap target.
        // A single click on a valid closed wall shape immediately places the floor polygon.
        if (draft.points.length === 0) {
            const wallLoop = getFloorShapeWallLoopCandidate(wizardRef, wrappedX, wrappedY);
            if (wallLoop) {
                recordFloorEditDiagnostic("vertex.floorshape.wallloop.snap", {
                    level,
                    sectionCount: wallLoop.wallSections.length,
                    pointCount: wallLoop.polygonPoints.length,
                    worldX: wrappedX,
                    worldY: wrappedY
                });
                draft.points = wallLoop.polygonPoints.slice();
                finalizeFloorShapePlacement(wizardRef);
                return;
            }
        }

        if (clickCount >= 2 && draft.points.length >= 3) {
            recordFloorEditDiagnostic("vertex.floorshape.finish.click", {
                clickCount,
                level,
                pointsBeforeFinish: draft.points.length,
                worldX: wrappedX,
                worldY: wrappedY
            });
            finalizeFloorShapePlacement(wizardRef);
            return;
        }

        if (draft.points.length >= 3) {
            const start = draft.points[0];
            const click = { x: wrappedX, y: wrappedY };
            const closeDistancePx = getScreenDistancePxBetweenWorldPoints(start, click);
            if (closeDistancePx <= TRIGGER_AREA_CLOSE_DISTANCE_PX) {
                recordFloorEditDiagnostic("vertex.floorshape.finish.proximity", {
                    level,
                    pointsBeforeFinish: draft.points.length,
                    closeDistancePx,
                    worldX: wrappedX,
                    worldY: wrappedY
                });
                finalizeFloorShapePlacement(wizardRef);
                return;
            }
        }

        draft.points.push({ x: wrappedX, y: wrappedY });
        recordFloorEditDiagnostic("vertex.floorshape.add", {
            level,
            clickCount,
            pointsAfterAdd: draft.points.length,
            worldX: wrappedX,
            worldY: wrappedY
        });
    }

    function placeFloorHoleVertex(wizardRef, worldX, worldY, options = {}) {
        if (!wizardRef || !wizardRef.map) return;
        const mapRef = wizardRef.map;
        const wrappedX = (typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(worldX) : worldX;
        const wrappedY = (typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(worldY) : worldY;
        if (!Number.isFinite(wrappedX) || !Number.isFinite(wrappedY)) return;
        const clickCount = Number.isFinite(options.clickCount) ? Math.max(1, Math.floor(Number(options.clickCount))) : 1;
        const level = getSelectedFloorEditLevel(wizardRef);

        const draft = (
            wizardRef._floorHolePlacementDraft &&
            Array.isArray(wizardRef._floorHolePlacementDraft.points)
        )
            ? wizardRef._floorHolePlacementDraft
            : { points: [] };
        wizardRef._floorHolePlacementDraft = draft;

        if (clickCount >= 2 && draft.points.length >= 3) {
            recordFloorEditDiagnostic("vertex.floorhole.finish.click", {
                clickCount,
                level,
                pointsBeforeFinish: draft.points.length,
                worldX: wrappedX,
                worldY: wrappedY
            });
            finalizeFloorHolePlacement(wizardRef);
            return;
        }

        if (draft.points.length >= 3) {
            const start = draft.points[0];
            const click = { x: wrappedX, y: wrappedY };
            const closeDistancePx = getScreenDistancePxBetweenWorldPoints(start, click);
            if (closeDistancePx <= TRIGGER_AREA_CLOSE_DISTANCE_PX) {
                recordFloorEditDiagnostic("vertex.floorhole.finish.proximity", {
                    level,
                    pointsBeforeFinish: draft.points.length,
                    closeDistancePx,
                    worldX: wrappedX,
                    worldY: wrappedY
                });
                finalizeFloorHolePlacement(wizardRef);
                return;
            }
        }

        draft.points.push({ x: wrappedX, y: wrappedY });
        recordFloorEditDiagnostic("vertex.floorhole.add", {
            level,
            clickCount,
            pointsAfterAdd: draft.points.length,
            worldX: wrappedX,
            worldY: wrappedY
        });
    }

    function castWizardSpell(wizardRef, worldX, worldY, options = null) {
        if (!wizardRef || wizardRef.castDelay) return;
        const castOptions = options && typeof options === "object" ? options : {};
        if (wizardRef.currentSpell === "attacksquirrel") {
            console.log("[AttackSquirrelSelection] cast-dispatch", {
                worldX,
                worldY,
                castDelay: !!wizardRef.castDelay,
                casting: !!wizardRef.casting,
                options
            });
        }
        if (typeof wizardRef.isFrozen === "function" && wizardRef.isFrozen()) return;
        if (Number(castOptions.clickCount) >= 2 && paintFloorPolygonAtWorldPoint(wizardRef, worldX, worldY)) {
            return;
        }

        if (wizardRef.currentSpell === "shield") {
            castShieldSpell(wizardRef);
            return;
        }

        if (isVanishToolName(wizardRef.currentSpell) && isDragSpellActive(wizardRef, wizardRef.currentSpell)) {
            completeDragSpell(wizardRef, wizardRef.currentSpell, worldX, worldY);
            return;
        }

        if (wizardRef.currentSpell === "wall") {
            if (isDragSpellActive(wizardRef, "wall")) {
                completeDragSpell(wizardRef, "wall", worldX, worldY);
            } else {
                beginDragSpell(wizardRef, "wall", worldX, worldY);
            }
            return;
        }

        if (wizardRef.currentSpell === "buildroad") {
            if (isDragSpellActive(wizardRef, "buildroad")) {
                completeDragSpell(wizardRef, "buildroad", worldX, worldY);
            } else {
                beginDragSpell(wizardRef, "buildroad", worldX, worldY);
            }
            return;
        }

        if (wizardRef.currentSpell === "firewall") {
            if (isDragSpellActive(wizardRef, "firewall")) {
                completeDragSpell(wizardRef, "firewall", worldX, worldY);
            } else {
                beginDragSpell(wizardRef, "firewall", worldX, worldY);
            }
            return;
        }

        if (wizardRef.currentSpell === "teleport") {
            const projectile = new globalThis.Teleport();
            const delayTime = projectile.delayTime || wizardRef.cooldownTime;
            wizardRef.castDelay = true;
            projectiles.push(projectile.cast(worldX, worldY));
            wizardRef.casting = true;
            setTimeout(() => {
                wizardRef.castDelay = false;
                wizardRef.casting = false;
            }, 1000 * delayTime);
            return;
        }

        if (wizardRef.currentSpell === "triggerarea") {
            placeTriggerAreaVertex(wizardRef, worldX, worldY, options || {});
            return;
        }

        if (wizardRef.currentSpell === "floorshape") {
            placeFloorShapeVertex(wizardRef, worldX, worldY, options || {});
            return;
        }

        if (wizardRef.currentSpell === "floorhole") {
            placeFloorHoleVertex(wizardRef, worldX, worldY, options || {});
            return;
        }

        if (wizardRef.currentSpell === "blackdiamond") {
            const mapRef = wizardRef.map || (typeof map !== "undefined" ? map : null);
            const placeX = mapRef && typeof mapRef.wrapWorldX === "function"
                ? mapRef.wrapWorldX(worldX)
                : worldX;
            const placeY = mapRef && typeof mapRef.wrapWorldY === "function"
                ? mapRef.wrapWorldY(worldY)
                : worldY;
            const powerupPlacement = getPowerupPlacementPreviewConfig(wizardRef);
            if (Number.isFinite(placeX) && Number.isFinite(placeY) && typeof addPowerup === "function") {
                addPowerup(powerupPlacement.fileName, {
                    x: placeX,
                    y: placeY,
                    map: mapRef,
                    size: powerupPlacement.scale,
                    imagePath: powerupPlacement.imagePath,
                    width: powerupPlacement.width,
                    height: powerupPlacement.height,
                    radius: powerupPlacement.radius
                });
            }
            const delayTime = Math.max(0.05, Number(wizardRef.cooldownTime) || 0.1);
            wizardRef.castDelay = true;
            wizardRef.casting = true;
            setTimeout(() => {
                wizardRef.castDelay = false;
                wizardRef.casting = false;
            }, 1000 * delayTime);
            return;
        }

        if (wizardRef.currentSpell === "maze") {
            // Set castDelay immediately to prevent double-fire from
            // spacebar-up quick-cast arriving while pathfinding runs.
            wizardRef.castDelay = true;

            const scriptingApi = (typeof Scripting !== "undefined" && Scripting)
                ? Scripting
                : ((typeof globalThis !== "undefined" && globalThis.Scripting) ? globalThis.Scripting : null);
            const isDoorPlacedObjectFn = (scriptingApi && typeof scriptingApi.isDoorPlacedObject === "function")
                ? scriptingApi.isDoorPlacedObject
                : null;
            const isDoorLockedFn = (scriptingApi && typeof scriptingApi.isDoorLocked === "function")
                ? scriptingApi.isDoorLocked
                : null;

            const blinkNoPathCursor = () => {
                if (typeof globalThis !== "undefined" && typeof globalThis.blinkCursorNoPath === "function") {
                    globalThis.blinkCursorNoPath(500);
                }
            };
            const mapRef = wizardRef.map || (typeof map !== "undefined" ? map : null);
            if (
                !mapRef ||
                typeof mapRef.worldToNode !== "function" ||
                typeof mapRef.findPathAStar !== "function"
            ) {
                message("Pathfinding is unavailable.");
                wizardRef.castDelay = false;
                return;
            }

            const wrappedX = typeof mapRef.wrapWorldX === "function" ? mapRef.wrapWorldX(worldX) : worldX;
            const wrappedY = typeof mapRef.wrapWorldY === "function" ? mapRef.wrapWorldY(worldY) : worldY;

            // worldToNode may snap to a wall tile when the wizard is
            // standing right against a wall.  If that happens, search
            // the 12 neighbours for the closest free tile instead.
            const nearestFreeNode = (candidate, wx, wy) => {
                if (!candidate) return null;
                if (!candidate.blocked && !candidate.hasBlockingObject()) return candidate;
                let best = null;
                let bestDist = Infinity;
                for (let d = 0; d < 12; d++) {
                    const nb = candidate.neighbors[d];
                    if (!nb || nb.blocked || nb.hasBlockingObject()) continue;
                    const dx = typeof mapRef.shortestDeltaX === "function"
                        ? mapRef.shortestDeltaX(nb.x, wx) : (nb.x - wx);
                    const dy = typeof mapRef.shortestDeltaY === "function"
                        ? mapRef.shortestDeltaY(nb.y, wy) : (nb.y - wy);
                    const dist = dx * dx + dy * dy;
                    if (dist < bestDist) { bestDist = dist; best = nb; }
                }
                return best;
            };

            const startNode = nearestFreeNode(
                mapRef.worldToNode(wizardRef.x, wizardRef.y),
                wizardRef.x, wizardRef.y
            );
            const destinationNode = nearestFreeNode(
                mapRef.worldToNode(wrappedX, wrappedY),
                wrappedX, wrappedY
            );

            if (!startNode || !destinationNode) {
                message("Cannot find a path there.");
                blinkNoPathCursor();
                wizardRef.castDelay = false;
                return;
            }

            const mapNodeCount = Math.max(1, Math.floor((Number(mapRef.width) || 0) * (Number(mapRef.height) || 0)));
            const exhaustiveMaxIterations = Math.max(1000, mapNodeCount * 20);

            const canTraverseMazeObject = (obj) => {
                if (!obj || obj.gone) return false;
                const isDoor = isDoorPlacedObjectFn
                    ? !!isDoorPlacedObjectFn(obj)
                    : !!(
                        obj &&
                        (((typeof obj.type === "string") && obj.type.trim().toLowerCase() === "door") ||
                        ((typeof obj.category === "string") && obj.category.trim().toLowerCase() === "doors"))
                    );
                if (!isDoor) return false;
                return isDoorLockedFn
                    ? !isDoorLockedFn(obj)
                    : obj.isPassable !== false;
            };

            const astarPath = mapRef.findPathAStar(startNode, destinationNode, {
                maxIterations: exhaustiveMaxIterations,
                wallAvoidance: 3,
                canTraverseObject: canTraverseMazeObject
            });

            if (!Array.isArray(astarPath)) {
                message("No path found.");
                blinkNoPathCursor();
                wizardRef.castDelay = false;
                return;
            }

            // Remove all existing maze-marker buttons before placing new ones.
            const pList = (typeof globalThis !== "undefined" && Array.isArray(globalThis.powerups))
                ? globalThis.powerups : [];
            for (let pi = pList.length - 1; pi >= 0; pi--) {
                const p = pList[pi];
                if (p && !p.gone && !p.collected && p.imageFileName === POWERUP_PLACEMENT_FILE_NAME) {
                    p.gone = true;
                    if (p.pixiSprite && p.pixiSprite.parent) {
                        p.pixiSprite.parent.removeChild(p.pixiSprite);
                    }
                    pList.splice(pi, 1);
                }
            }

            const nodesAlongPath = [startNode, ...astarPath];
            const isAdjacentMazeStep = (fromNode, toNode) => {
                if (!fromNode || !toNode) return false;
                if (typeof mapRef._isAdjacentHexNeighbor === "function") {
                    return !!mapRef._isAdjacentHexNeighbor(fromNode, toNode);
                }
                if (!Array.isArray(fromNode.neighbors)) return false;
                const adjacentDirs = [1, 3, 5, 7, 9, 11];
                for (let ai = 0; ai < adjacentDirs.length; ai++) {
                    if (fromNode.neighbors[adjacentDirs[ai]] === toNode) return true;
                }
                return false;
            };

            const seenNodes = new Set();
            let previousUniqueNode = null;
            let adjacentStepCounter = 0;
            for (let i = 0; i < nodesAlongPath.length; i++) {
                const node = nodesAlongPath[i];
                if (!node) continue;
                const key = `${node.xindex},${node.yindex}`;
                if (seenNodes.has(key)) continue;
                seenNodes.add(key);

                const isFirstNode = previousUniqueNode === null;
                const isLastNode = node === destinationNode;
                let shouldPlacePowerup = true;

                if (!isFirstNode && !isLastNode) {
                    if (isAdjacentMazeStep(previousUniqueNode, node)) {
                        adjacentStepCounter += 1;
                        shouldPlacePowerup = (adjacentStepCounter % 2 === 0);
                    } else {
                        adjacentStepCounter = 0;
                    }
                }

                if (shouldPlacePowerup && typeof addPowerup === "function") {
                    addPowerup(POWERUP_PLACEMENT_FILE_NAME, {
                        x: node.x,
                        y: node.y,
                        map: mapRef
                    });
                }

                previousUniqueNode = node;
            }

            const delayTime = Math.max(0.05, Number(wizardRef.cooldownTime) || 0.1);
            wizardRef.castDelay = true;
            wizardRef.casting = true;
            setTimeout(() => {
                wizardRef.castDelay = false;
                wizardRef.casting = false;
            }, 1000 * delayTime);
            return;
        }

        let clickTarget = getObjectTargetAt(wizardRef, worldX, worldY);
        if (wizardRef.currentSpell === "editscript") {
            if (!keysPressed[" "]) return;
            if (!clickTarget) {
                message("Hold space and click an object to edit its script.");
                return;
            }
            const scriptingApi = (typeof globalThis !== "undefined" && globalThis.Scripting)
                ? globalThis.Scripting
                : null;
            if (!scriptingApi || typeof scriptingApi.openScriptEditorForTarget !== "function") {
                message("Script editor is unavailable.");
                return;
            }
            scriptingApi.openScriptEditorForTarget(clickTarget);
            return;
        }
        if (wizardRef.currentSpell === "treegrow") clickTarget = null;
        let projectile = null;

        if (wizardRef.currentSpell === "grenades") {
            const inventory = (wizardRef && typeof wizardRef.getInventory === "function")
                ? wizardRef.getInventory()
                : wizardRef.inventory;
            if (!inventory || typeof inventory.remove !== "function" || !inventory.remove("grenades", 1)) return;
            projectile = new globalThis.Grenade();
        } else if (wizardRef.currentSpell === "rocks") {
            projectile = new globalThis.Rock();
        } else if (wizardRef.currentSpell === "fireball") {
            projectile = new globalThis.Fireball();
        } else if (wizardRef.currentSpell === "freeze") {
            projectile = new globalThis.Iceball();
        } else if (wizardRef.currentSpell === "lightning") {
            const inventory = (wizardRef && typeof wizardRef.getInventory === "function")
                ? wizardRef.getInventory()
                : wizardRef.inventory;
            if (!inventory || typeof inventory.remove !== "function" || !inventory.remove("lightning", 1)) {
                syncWizardUnlockState(wizardRef);
                return;
            }
            projectile = new globalThis.Lightning();
        } else if (wizardRef.currentSpell === "spikes") {
            projectile = new globalThis.Spikes();
        } else if (wizardRef.currentSpell === "attacksquirrel") {
            console.log("[AttackSquirrelSelection] branch-enter", {
                ctorType: typeof globalThis.AttackSquirrel
            });
            if (typeof globalThis.AttackSquirrel !== "function") {
                console.log("[AttackSquirrelSelection] branch-missing-ctor");
                message("Attack squirrel spell is not loaded. Reload the page.");
                return;
            }
            projectile = new globalThis.AttackSquirrel();
            console.log("[AttackSquirrelSelection] branch-constructed", {
                projectileType: projectile && projectile.constructor ? projectile.constructor.name : null,
                hasCast: !!(projectile && typeof projectile.cast === "function")
            });
        } else if (wizardRef.currentSpell === "vanish") {
            projectile = new globalThis.Vanish();
        } else if (wizardRef.currentSpell === "editorvanish") {
            projectile = new globalThis.EditorVanish();
        } else if (wizardRef.currentSpell === "treegrow") {
            projectile = new globalThis.TreeGrow();
        } else if (wizardRef.currentSpell === "buildroad") {
            projectile = new globalThis.BuildRoad();
        } else if (wizardRef.currentSpell === "placeobject") {
            projectile = new globalThis.PlaceObject();
        } else if (wizardRef.currentSpell === "spawnanimal") {
            projectile = new globalThis.SpawnAnimal();
        }

        if (!projectile) return;
        const casterZ = getSpellCasterWorldBaseZ(wizardRef);
        projectile.visualStartZ = casterZ;
        projectile.visualBaseZ = casterZ;
        if (clickTarget) {
            const aim = getTargetAimPoint(wizardRef, clickTarget);
            if (aim && Number.isFinite(aim.x) && Number.isFinite(aim.y)) {
                worldX = aim.x;
                worldY = aim.y;
                if (Number.isFinite(aim.z)) {
                    projectile.visualTargetZ = Number(aim.z);
                    projectile.targetWorldZ = Number(aim.z);
                }
            }
        }
        if (clickTarget) {
            projectile.forcedTarget = clickTarget;
            markObjectAsTargetedBySpell(wizardRef, wizardRef.currentSpell, clickTarget);
        }
        const delayTime = projectile.delayTime || wizardRef.cooldownTime;
        wizardRef.castDelay = true;
        if (wizardRef.currentSpell === "attacksquirrel") {
            console.log("[AttackSquirrelSelection] branch-before-cast", {
                worldX,
                worldY,
                projectileType: projectile && projectile.constructor ? projectile.constructor.name : null
            });
        }
        projectiles.push(projectile.cast(worldX, worldY, castOptions));
        if (wizardRef.currentSpell === "attacksquirrel") {
            console.log("[AttackSquirrelSelection] branch-after-cast", {
                projectileCount: Array.isArray(projectiles) ? projectiles.length : null
            });
        }
        if (wizardRef.currentSpell === "lightning") {
            syncWizardUnlockState(wizardRef);
        }
        wizardRef.casting = true;
        setTimeout(() => {
            wizardRef.castDelay = false;
            wizardRef.casting = false;
        }, 1000 * delayTime);
    }

    function buildSpellList(wizardRef) {
        const spells = SPELL_DEFS.filter(spell => isSpellUnlocked(wizardRef, spell.name)).map(spell => {
            const key = spell.name === "firewall"
                ? "F+W"
                : spell.name === "editscript"
                    ? "E+T"
                    : Object.keys(spellKeyBindings).find(k => spellKeyBindings[k] === spell.name);
            if (spell.name === "treegrow") {
                return {...spell, key, icon: getTreeSpellIcon(wizardRef)};
            }
            if (spell.name === "spawnanimal") {
                return {...spell, key, icon: getSpawnAnimalSpellIcon(wizardRef)};
            }
            return {...spell, key};
        });
        if (!shouldFoldAurasIntoSpellList(wizardRef)) {
            return spells;
        }
        const auraSpells = getAvailableAuraDefinitions(wizardRef).map(aura => ({
            ...aura,
            key: aura.key
        }));
        return spells.concat(auraSpells);
    }

    function shouldShowSpellSelector(wizardRef) {
        if (!wizardRef) return false;
        const spellList = Array.isArray(wizardRef.spells)
            ? wizardRef.spells
            : buildSpellList(wizardRef);
        return spellList.length > 0 || (canUseEditorFeatures(wizardRef) && editorMode);
    }

    function syncWizardUnlockState(wizardRef, options = {}) {
        if (!wizardRef) return [];
        const editorAllowed = canUseEditorFeatures(wizardRef);
        wizardRef.showEditorPanel = editorAllowed;
        if (editorMode !== editorAllowed) {
            setEditorMode(editorAllowed, wizardRef);
        }
        const spells = buildSpellList(wizardRef);
        wizardRef.spells = spells;
        normalizeActiveAuras(wizardRef);

        const availableSpellNames = spells.map(spell => spell.name);
        const currentSpell = (typeof wizardRef.currentSpell === "string") ? wizardRef.currentSpell : "";
        const canKeepCurrent = !!currentSpell && (
            availableSpellNames.includes(currentSpell) ||
            (editorAllowed && (isEditorSpellName(currentSpell) || isEditorToolName(currentSpell)))
        );
        if (!canKeepCurrent) {
            wizardRef.currentSpell = availableSpellNames[0] || "";
        }
        if (!availableSpellNames.includes(wizardRef.selectedSpellName)) {
            wizardRef.selectedSpellName = availableSpellNames[0] || "";
        }
        syncAdventureAuraSelectionState(wizardRef);

        if (options.refreshUi !== false) {
            refreshSpellSelector(wizardRef);
            refreshAuraSelector(wizardRef);
        }
        return spells;
    }

    function buildEditorToolList(wizardRef) {
        const isDebug = (typeof debugMode !== "undefined" && debugMode) ||
            (typeof globalThis !== "undefined" && globalThis.debugMode);
        return EDITOR_TOOL_DEFS.filter(tool => !tool.debugOnly || isDebug).map(tool => {
            const key = tool.name === "editorvanish"
                ? "S+V"
                : Object.keys(editorKeyBindings).find(k => editorKeyBindings[k] === tool.name);
            if (tool.name === "wall") {
                return {...tool, key, icon: getWallSpellIcon(wizardRef)};
            }
            if (tool.name === "buildroad") {
                return {...tool, key, icon: getRoadSpellIcon(wizardRef)};
            }
            return {...tool, key};
        });
    }

    function refreshAuraSelector(wizardRef) {
        const showAuraSelector = !!(
            wizardRef &&
            typeof wizardRef.isGodMode === "function" &&
            wizardRef.isGodMode() &&
            getAvailableAuraDefinitions(wizardRef).length > 0
        );
        const $auraSelector = $("#auraSelector");
        if ($auraSelector.length) {
            $auraSelector.toggleClass("hidden", !showAuraSelector);
        }
        const $selectedAura = $("#selectedAura");
        if ($selectedAura.length) {
            $selectedAura.css("background-image", `url('${AURA_MENU_ICON}')`);
        }

        const activeAuraNames = getActiveAuraNames(wizardRef);
        const $activeAuraIcons = $("#activeAuraIcons");
        const $grid = $("#auraGrid");
        if (!showAuraSelector) {
            $("#auraMenu").addClass("hidden");
            if ($activeAuraIcons.length) {
                $activeAuraIcons.empty().addClass("hidden");
            }
            if ($grid.length) {
                $grid.empty();
            }
            return;
        }
        if ($activeAuraIcons.length) {
            $activeAuraIcons.empty();
            activeAuraNames.forEach(name => {
                const auraDef = getAuraDefinition(name);
                if (!auraDef) return;
                const badge = $("<div>")
                    .addClass("activeAuraIconBadge")
                    .css("background-image", `url('${auraDef.icon}')`);
                $activeAuraIcons.append(badge);
            });
            if (activeAuraNames.length > 0) {
                $activeAuraIcons.removeClass("hidden");
            } else {
                $activeAuraIcons.addClass("hidden");
            }
        }

        if (!$grid.length) return;
        $grid.empty();

        getAvailableAuraDefinitions(wizardRef).forEach(aura => {
            const auraIcon = $("<div>")
                .addClass("auraIcon")
                .css({
                    "background-image": `url('${aura.icon}')`,
                    "position": "relative"
                })
                .attr("data-aura", aura.name)
                .attr("title", aura.name)
                .click(() => {
                    toggleAura(wizardRef, aura.name);
                });

            if (aura.key) {
                const keyLabel = $("<span>")
                    .addClass("spellKeyBinding")
                    .text(aura.key)
                    .css({
                        "position": "absolute",
                        "top": "4px",
                        "left": "4px",
                        "color": "white",
                        "font-size": "12px",
                        "font-weight": "bold",
                        "pointer-events": "none",
                        "text-shadow": "1px 1px 2px rgba(0, 0, 0, 0.8)",
                        "z-index": "10"
                    });
                auraIcon.append(keyLabel);
            }

            if (activeAuraNames.includes(aura.name)) {
                auraIcon.addClass("selected");
            } else {
                auraIcon.addClass("inactiveAura");
            }
            $grid.append(auraIcon);
        });
    }

    function renderFlooringSelector(wizardRef) {
        const $grid = $("#spellGrid");
        $grid.empty();
        $grid.css({
            display: "",
            "flex-direction": "",
            gap: ""
        });
        const backButton = $("<div>")
            .addClass("spellIcon")
            .css({
                "display": "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "13px",
                "font-weight": "bold",
                "color": "#ffffff",
                "background": "rgba(20,20,20,0.9)"
            })
            .text("Back")
            .click(() => {
                spellMenuMode = "main";
                refreshSpellSelector(wizardRef);
            });
        $grid.append(backButton);

        const selectedRoadWidth = getSelectedRoadWidth(wizardRef);
        const $widthHeader = $("<div>")
            .text("Road Width")
            .css({
                color: "#ffffff",
                "font-weight": "bold",
                "grid-column": "1 / -1"
            });
        const $widthLabel = $("<div>")
            .text(`Width: ${selectedRoadWidth}`)
            .css({
                color: "#ffffff",
                "font-size": "13px",
                "grid-column": "1 / -1"
            });
        const $widthSlider = $("<input>")
            .attr({
                type: "range",
                min: ROAD_WIDTH_MIN,
                max: ROAD_WIDTH_MAX,
                step: ROAD_WIDTH_STEP,
                value: selectedRoadWidth
            })
            .css({
                width: "100%",
                "accent-color": "#ffd700",
                cursor: "pointer",
                "grid-column": "1 / -1"
            })
            .on("input change", event => {
                const value = quantizeToStep(event.target.value, ROAD_WIDTH_MIN, ROAD_WIDTH_MAX, ROAD_WIDTH_STEP);
                wizardRef.selectedRoadWidth = value;
                $widthLabel.text(`Width: ${value}`);
            });
        $grid.append($widthHeader);
        $grid.append($widthSlider);
        $grid.append($widthLabel);

        const selected = getSelectedFlooringTexture(wizardRef);
        flooringTexturePaths.forEach(texturePath => {
            const icon = $("<div>")
                .addClass("spellIcon")
                .css({
                    "background-image": `url('${texturePath}')`,
                    "background-size": "cover",
                    "background-position": "center center"
                })
                .attr("title", texturePath.split("/").pop() || texturePath)
                .click(() => {
                    wizardRef.selectedFlooringTexture = texturePath;
                    spellMenuMode = "main";
                    setCurrentSpell(wizardRef, "buildroad");
                    $("#spellMenu").addClass("hidden");
                });
            if (texturePath === selected) {
                icon.addClass("selected");
            }
            $grid.append(icon);
        });
    }

    function openFlooringSelector(wizardRef) {
        if (wizardRef && wizardRef.currentSpell !== "buildroad") {
            setCurrentSpell(wizardRef, "buildroad");
        }
        spellMenuMode = "flooring";
        $("#spellMenu").removeClass("hidden");
        renderFlooringSelector(wizardRef);
        fetchFlooringTextures().then(() => {
            if (spellMenuMode === "flooring") {
                renderFlooringSelector(wizardRef);
            }
        });
    }

    function renderTreeSelector(wizardRef) {
        const $grid = $("#spellGrid");
        $grid.empty();
        $grid.css({
            display: "",
            "flex-direction": "",
            gap: ""
        });
        const backButton = $("<div>")
            .addClass("spellIcon")
            .css({
                "display": "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "13px",
                "font-weight": "bold",
                "color": "#ffffff",
                "background": "rgba(20,20,20,0.9)"
            })
            .text("Back")
            .click(() => {
                spellMenuMode = "main";
                refreshSpellSelector(wizardRef);
            });
        $grid.append(backButton);

        const selectedTreeSize = getSelectedTreeGrowSize(wizardRef);
        const randomSizeEnabled = isTreeGrowRandomSizeEnabled(wizardRef);
        const $sizeHeader = $("<div>")
            .text("Tree Size")
            .css({
                color: "#ffffff",
                "font-weight": "bold",
                "grid-column": "1 / -1"
            });
        const $sizeRow = $("<div>")
            .css({
                display: "flex",
                gap: "8px",
                "align-items": "center",
                width: "100%",
                "grid-column": "1 / -1"
            });
        const $sizeSlider = $("<input>")
            .attr("id", "treeGrowSizeSlider")
            .attr({
                type: "range",
                min: TREE_GROW_SIZE_MIN,
                max: TREE_GROW_SIZE_MAX,
                step: TREE_GROW_SIZE_SLIDER_STEP,
                value: selectedTreeSize
            })
            .css({
                flex: "1 1 auto",
                width: "100%",
                "accent-color": "#ffd700",
                cursor: "pointer"
            })
            .on("input change", event => {
                wizardRef.treeGrowPlacementSize = quantizeToStep(
                    event.target.value,
                    TREE_GROW_SIZE_MIN,
                    TREE_GROW_SIZE_MAX,
                    TREE_GROW_SIZE_SLIDER_STEP
                );
                clearTreePlacementPreviewSize(wizardRef);
                syncTreeGrowSizeControls(wizardRef);
            });
        const $randomSizeToggle = $("<button>")
            .attr("id", "treeGrowRandomSizeToggle")
            .attr("type", "button")
            .addClass("spellIcon")
            .attr("title", "Randomize tree size with a bell curve centered on 4")
            .text("?")
            .css({
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                background: "rgba(20,20,20,0.95)",
                color: "#ffd700",
                "font-size": "28px",
                "font-weight": "bold",
                "line-height": "1",
                flex: "0 0 auto"
            })
            .on("click", () => {
                wizardRef.treeGrowRandomSizeMode = !isTreeGrowRandomSizeEnabled(wizardRef);
                clearTreePlacementPreviewSize(wizardRef);
                syncTreeGrowSizeControls(wizardRef);
            });
        const $sizeLabel = $("<div>")
            .attr("id", "treeGrowSizeLabel")
            .css({
                color: "#ffffff",
                "font-size": "13px",
                "grid-column": "1 / -1"
            });
        if (randomSizeEnabled) {
            $randomSizeToggle.addClass("selected");
        }
        $sizeRow.append($sizeSlider, $randomSizeToggle);
        $grid.append($sizeHeader);
        $grid.append($sizeRow);
        $grid.append($sizeLabel);
        syncTreeGrowSizeControls(wizardRef);

        const selected = getSelectedTreeTextureVariant(wizardRef);
        const randomIcon = $("<div>")
            .addClass("spellIcon")
            .css({
                "display": "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "36px",
                "font-weight": "bold",
                "color": "#ffffff",
                "background": "rgba(20,20,20,0.9)",
                "line-height": "1"
            })
            .attr("title", "Random Tree")
            .text("?")
            .click(() => {
                wizardRef.treeGrowRandomMode = true;
                wizardRef.selectedTreeTextureVariant = RANDOM_TREE_VARIANT;
                spellMenuMode = "main";
                setCurrentSpell(wizardRef, "treegrow");
                $("#spellMenu").addClass("hidden");
            });
        if (selected === RANDOM_TREE_VARIANT) {
            randomIcon.addClass("selected");
        }
        $grid.append(randomIcon);

        const variantCount = getTreeVariantCount(wizardRef);
        for (let textureIndex = 0; textureIndex < variantCount; textureIndex++) {
            const texturePath = `/assets/images/trees/tree${textureIndex}.png`;
            const icon = $("<div>")
                .addClass("spellIcon")
                .css({
                    "background-image": `url('${texturePath}')`,
                    "background-size": "cover",
                    "background-position": "center center"
                })
                .attr("title", `Tree ${textureIndex}`)
                .click(() => {
                    wizardRef.treeGrowRandomMode = false;
                    wizardRef.selectedTreeTextureVariant = textureIndex;
                    spellMenuMode = "main";
                    setCurrentSpell(wizardRef, "treegrow");
                    $("#spellMenu").addClass("hidden");
                });
            if (textureIndex === selected) {
                icon.addClass("selected");
            }
            $grid.append(icon);
        }
    }

    function openTreeSelector(wizardRef) {
        if (wizardRef && wizardRef.currentSpell !== "treegrow") {
            setCurrentSpell(wizardRef, "treegrow");
        }
        spellMenuMode = "tree";
        $("#spellMenu").removeClass("hidden");
        renderTreeSelector(wizardRef);
    }

    function renderEditorCategorySelector(wizardRef) {
        const $grid = $("#editorGrid");
        $grid.empty();
        $grid.css({
            display: "",
            "flex-direction": "",
            gap: ""
        });

        // Render editor tools (wall, road, vanish) first
        const editorTools = buildEditorToolList(wizardRef);
        editorTools.forEach(tool => {
            const iconCss = {
                "background-image": `url('${tool.icon}')`,
                "background-size": "cover",
                "background-position": "center center",
                "position": "relative"
            };
            const icon = $("<div>")
                .addClass("spellIcon")
                .css(iconCss)
                .attr("data-spell", tool.name)
                .attr("title", tool.name)
                .click(() => {
                    if (tool.name === "flooredit") {
                        openFloorEditingSelector(wizardRef);
                        return;
                    }
                    setCurrentSpell(wizardRef, tool.name);
                    refreshEditorSelector(wizardRef);
                    $("#spellMenu").addClass("hidden");
                });
            if (tool.name === "flooredit") {
                icon.attr("data-opens-submenu", "true");
            }
            if (tool.name === "buildroad") {
                icon.on("contextmenu", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openFlooringSelector(wizardRef);
                });
            } else if (tool.name === "wall") {
                icon.on("contextmenu", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openWallSelector(wizardRef);
                });
            } else if (tool.name === "flooredit") {
                icon.on("contextmenu", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openFloorEditingSelector(wizardRef);
                });
            }
            if (tool.key) {
                const keyLabel = $("<span>")
                    .addClass("spellKeyBinding")
                    .text(tool.key)
                    .css({
                        "position": "absolute",
                        "top": "4px",
                        "left": "4px",
                        "color": "white",
                        "font-size": "12px",
                        "font-weight": "bold",
                        "pointer-events": "none",
                        "text-shadow": "1px 1px 2px rgba(0, 0, 0, 0.8)",
                        "z-index": "10"
                    });
                icon.append(keyLabel);
            }
            if (tool.name === wizardRef.currentSpell || (tool.name === "flooredit" && isFloorEditorToolName(wizardRef.currentSpell))) {
                icon.addClass("selected");
            }
            $grid.append(icon);
        });

        // Render editor categories (placeable objects, powerups)
        const selectedEditorCategory = normalizeSelectedEditorCategory(wizardRef);
        EDITOR_CATEGORIES.forEach(category => {
            const selectedTexture = (category === "powerups")
                ? getPowerupEditorCategoryIcon(wizardRef)
                : getSelectedPlaceableTextureForCategory(wizardRef, category);
            const icon = $("<div>")
                .addClass("spellIcon")
                .css({
                    "background-image": `url('${selectedTexture}')`,
                    "background-size": "cover",
                    "background-position": "center center"
                })
                .attr("title", category)
                .click(() => {
                    if (category === "powerups") {
                        wizardRef.selectedEditorCategory = "powerups";
                        setCurrentSpell(wizardRef, "blackdiamond");
                    } else {
                        setSelectedPlaceableCategory(wizardRef, category);
                        wizardRef.selectedEditorCategory = category;
                        refreshSelectedPlaceableMetadata(wizardRef);
                        setCurrentSpell(wizardRef, "placeobject");
                    }
                    refreshEditorSelector(wizardRef);
                    $("#spellMenu").addClass("hidden");
                })
                .on("contextmenu", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (category === "powerups") {
                        wizardRef.selectedEditorCategory = "powerups";
                        setCurrentSpell(wizardRef, "blackdiamond");
                    } else {
                        setSelectedPlaceableCategory(wizardRef, category);
                        wizardRef.selectedEditorCategory = category;
                        refreshSelectedPlaceableMetadata(wizardRef);
                        setCurrentSpell(wizardRef, "placeobject");
                    }
                    editorMenuMode = "items";
                    editorMenuCategory = category;
                    renderEditorItemSelector(wizardRef, category);
                    if (category !== "powerups") {
                        fetchPlaceableImages({ forceRefresh: true }).then(() => {
                            if (editorMenuMode === "items" && editorMenuCategory === category) {
                                renderEditorItemSelector(wizardRef, category);
                            }
                        });
                    }
                });
            if (category !== "powerups") {
                applyCompositeLayersToThumbnail(icon, category, selectedTexture);
            }
            if (selectedEditorCategory === category) {
                icon.addClass("selected");
            }
            $grid.append(icon);
        });
    }

    function renderEditorItemSelector(wizardRef, category) {
        const safeCategory = EDITOR_CATEGORIES.includes(category) ? category : DEFAULT_PLACEABLE_CATEGORY;
        editorMenuCategory = safeCategory;
        const $grid = $("#spellGrid");
        $grid.empty();
        $grid.css({
            display: "",
            "flex-direction": "",
            gap: ""
        });
        const backButton = $("<div>")
            .addClass("spellIcon")
            .css({
                "display": "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "13px",
                "font-weight": "bold",
                "color": "#ffffff",
                "background": "rgba(20,20,20,0.9)"
            })
            .text("Back")
            .click(() => {
                spellMenuMode = "main";
                refreshSpellSelector(wizardRef);
            });
        $grid.append(backButton);

        if (safeCategory === "powerups") {
            const selectedFile = getSelectedPowerupFileName(wizardRef);
            const renderPowerupItems = (items) => {
                items.forEach(item => {
                    if (!item || typeof item !== "object") return;
                    const file = item.file || item.imageFileName || "";
                    const imgPath = (item.imagePath && typeof item.imagePath === "string" && item.imagePath.length > 0)
                        ? item.imagePath
                        : POWERUP_PLACEMENT_IMAGE_PATH;
                    const displayName = item.name || item.id || file;
                    const icon = $("<div>")
                        .addClass("spellIcon")
                        .css({
                            "background-image": `url('${imgPath}')`,
                            "background-size": "cover",
                            "background-position": "center center"
                        })
                        .attr("title", displayName)
                        .click(() => {
                            setSelectedPowerupFileName(wizardRef, file);
                            wizardRef.selectedEditorCategory = "powerups";
                            setCurrentSpell(wizardRef, "blackdiamond");
                            spellMenuMode = "main";
                            refreshSpellSelector(wizardRef);
                            $("#spellMenu").addClass("hidden");
                        });
                    if (file.toLowerCase() === selectedFile.toLowerCase()) {
                        icon.addClass("selected");
                    }
                    $grid.append(icon);
                });
            };
            if (typeof loadPowerupItemsDoc === "function") {
                loadPowerupItemsDoc().then(doc => {
                    if (doc && Array.isArray(doc.items) && doc.items.length > 0) {
                        renderPowerupItems(doc.items);
                    } else {
                        renderPowerupItems([{ file: POWERUP_PLACEMENT_FILE_NAME, imagePath: POWERUP_PLACEMENT_IMAGE_PATH, name: "Button" }]);
                    }
                });
            } else {
                renderPowerupItems([{ file: POWERUP_PLACEMENT_FILE_NAME, imagePath: POWERUP_PLACEMENT_IMAGE_PATH, name: "Button" }]);
            }
            return;
        }

        const selectedTexture = getSelectedPlaceableTextureForCategory(wizardRef, safeCategory);
        const texturePaths = getPlaceableImageList(safeCategory);
        const buildTextureIcon = (texturePath) => {
            const icon = $("<div>")
                .addClass("spellIcon")
                .css({
                    "background-image": `url('${texturePath}')`,
                    "background-size": "cover",
                    "background-position": "center center",
                    "position": "relative"
                })
                .attr("title", decodeURIComponent((texturePath.split("/").pop() || texturePath)))
                .click(() => {
                    normalizePlaceableSelections(wizardRef);
                    wizardRef.selectedPlaceableByCategory[safeCategory] = texturePath;
                    wizardRef.selectedPlaceableCategory = safeCategory;
                    wizardRef.selectedPlaceableTexturePath = texturePath;
                    wizardRef.selectedEditorCategory = safeCategory;
                    normalizePlaceableSelections(wizardRef);
                    refreshSelectedPlaceableMetadata(wizardRef);
                    setCurrentSpell(wizardRef, "placeobject");
                    spellMenuMode = "main";
                    refreshSpellSelector(wizardRef);
                    $("#spellMenu").addClass("hidden");
                });

            applyCompositeLayersToThumbnail(icon, safeCategory, texturePath);

            if (texturePath === selectedTexture) {
                icon.addClass("selected");
            }
            return icon;
        };

        if (safeCategory === "roof") {
            $grid.css({
                display: "flex",
                "flex-direction": "column",
                gap: "10px",
                color: "#ffffff",
                "min-width": "220px"
            });
            backButton.detach();
            const $topRow = $("<div>")
                .css({
                    display: "flex",
                    "align-items": "flex-start",
                    "flex-wrap": "wrap",
                    gap: "6px"
                });
            $topRow.append(backButton);
            const $textureRow = $("<div>")
                .css({
                    display: "flex",
                    "flex-wrap": "wrap",
                    gap: "6px"
                });
            texturePaths.forEach(texturePath => {
                $textureRow.append(buildTextureIcon(texturePath));
            });
            $topRow.append($textureRow);
            $grid.append($topRow);

            const roofOverhang = getSelectedRoofOverhang(wizardRef);
            const roofPeakHeight = getSelectedRoofPeakHeight(wizardRef);
            const roofTextureRepeat = getSelectedRoofTextureRepeat(wizardRef);

            const $overhangLabel = $("<div>")
                .text(`Overhang: ${roofOverhang.toFixed(4)} map units`)
                .css({ color: "#ffffff", "font-size": "13px" });
            const $textureRepeatLabel = $("<div>")
                .text(`Texture Repeat: ${roofTextureRepeat.toFixed(5)} repeats per map unit`)
                .css({ color: "#ffffff", "font-size": "13px" });
            const $textureRepeatSlider = $("<input>")
                .attr({
                    type: "range",
                    min: ROOF_TEXTURE_REPEAT_MIN,
                    max: ROOF_TEXTURE_REPEAT_MAX,
                    step: ROOF_TEXTURE_REPEAT_STEP,
                    value: roofTextureRepeat
                })
                .css({
                    width: "100%",
                    "accent-color": "#ffd700",
                    cursor: "pointer"
                })
                .on("input change", event => {
                    const value = quantizeToStep(event.target.value, ROOF_TEXTURE_REPEAT_MIN, ROOF_TEXTURE_REPEAT_MAX, ROOF_TEXTURE_REPEAT_STEP);
                    wizardRef.selectedRoofTextureRepeat = value;
                    $textureRepeatLabel.text(`Texture Repeat: ${value.toFixed(5)} repeats per map unit`);
                });
            const $overhangSlider = $("<input>")
                .attr({
                    type: "range",
                    min: ROOF_OVERHANG_MIN,
                    max: ROOF_OVERHANG_MAX,
                    step: ROOF_OVERHANG_STEP,
                    value: roofOverhang
                })
                .css({
                    width: "100%",
                    "accent-color": "#ffd700",
                    cursor: "pointer"
                })
                .on("input change", event => {
                    const value = quantizeToStep(event.target.value, ROOF_OVERHANG_MIN, ROOF_OVERHANG_MAX, ROOF_OVERHANG_STEP);
                    wizardRef.selectedRoofOverhang = value;
                    $overhangLabel.text(`Overhang: ${value.toFixed(4)} map units`);
                });

            const $peakHeightLabel = $("<div>")
                .text(`Peak Height: ${roofPeakHeight.toFixed(2)} map units`)
                .css({ color: "#ffffff", "font-size": "13px" });
            const $peakHeightSlider = $("<input>")
                .attr({
                    type: "range",
                    min: ROOF_PEAK_HEIGHT_MIN,
                    max: ROOF_PEAK_HEIGHT_MAX,
                    step: ROOF_PEAK_HEIGHT_STEP,
                    value: roofPeakHeight
                })
                .css({
                    width: "100%",
                    "accent-color": "#ffd700",
                    cursor: "pointer"
                })
                .on("input change", event => {
                    const value = quantizeToStep(event.target.value, ROOF_PEAK_HEIGHT_MIN, ROOF_PEAK_HEIGHT_MAX, ROOF_PEAK_HEIGHT_STEP);
                    wizardRef.selectedRoofPeakHeight = value;
                    $peakHeightLabel.text(`Peak Height: ${value.toFixed(2)} map units`);
                });

            $grid.append($("<div>").text("Texture Repeat").css({ color: "#ffffff", "font-weight": "bold" }));
            $grid.append($textureRepeatSlider);
            $grid.append($textureRepeatLabel);
            $grid.append($("<div>").text("Overhang").css({ color: "#ffffff", "font-weight": "bold" }));
            $grid.append($overhangSlider);
            $grid.append($overhangLabel);
            $grid.append($("<div>").text("Peak Height").css({ color: "#ffffff", "font-weight": "bold" }));
            $grid.append($peakHeightSlider);
            $grid.append($peakHeightLabel);
            return;
        }

        texturePaths.forEach(texturePath => {
            $grid.append(buildTextureIcon(texturePath));
        });
    }

    function refreshEditorSelector(wizardRef) {
        if (!wizardRef) return;
        $("#editorSelector").toggleClass("hidden", !canUseEditorFeatures(wizardRef));
        // Editor options are now merged into the spell menu
        refreshSpellSelector(wizardRef);
    }

    function openEditorSelector(wizardRef) {
        if (!canUseEditorFeatures(wizardRef)) return;
        // Editor options are now merged into the spell menu; show main spell menu
        spellMenuMode = "main";
        showMainSpellMenu(wizardRef);
        $("#spellMenu").removeClass("hidden");
    }

    function renderWallSelector(wizardRef) {
        const $grid = $("#spellGrid");
        $grid.empty();
        $grid.css({
            display: "flex",
            "flex-direction": "column",
            gap: "10px",
            color: "#ffffff",
            "min-width": "220px"
        });

        const $back = $("<button>")
            .text("Back")
            .css({
                "align-self": "flex-start",
                padding: "4px 8px",
                "font-size": "12px",
                cursor: "pointer",
                color: "#ffffff",
                background: "rgba(20,20,20,0.95)",
                border: "1px solid #ffd700",
                "border-radius": "4px"
            })
            .on("click", () => {
                spellMenuMode = "main";
                refreshSpellSelector(wizardRef);
            });
        $grid.append($back);

        const wallHeight = getSelectedWallHeight(wizardRef);
        const wallThickness = getSelectedWallThickness(wizardRef);
        const selectedWallTexture = getSelectedWallTexture(wizardRef);

        const $topRow = $("<div>")
            .css({
                display: "flex",
                "align-items": "flex-start",
                "flex-wrap": "wrap",
                gap: "6px"
            });
        $back.detach();
        $topRow.append($back);
        const $textureRow = $("<div>")
            .css({
                display: "flex",
                "flex-wrap": "wrap",
                gap: "6px"
            });
        wallTexturePaths.forEach(texturePath => {
            const icon = $("<div>")
                .addClass("spellIcon")
                .css({
                    "background-image": `url('${texturePath}')`,
                    "background-size": "cover",
                    "background-position": "center center"
                })
                .attr("title", decodeURIComponent((texturePath.split("/").pop() || texturePath)))
                .on("click", () => {
                    wizardRef.selectedWallTexture = texturePath;
                    if (editorMode) {
                        refreshEditorSelector(wizardRef);
                    } else {
                        refreshSpellSelector(wizardRef);
                    }
                });
            if (texturePath === selectedWallTexture) {
                icon.addClass("selected");
            }
            $textureRow.append(icon);
        });
        $topRow.append($textureRow);
        $grid.append($topRow);

        const $heightLabel = $("<div>")
            .text(`Height: ${wallHeight.toFixed(1)}`)
            .css({ color: "#ffffff", "font-size": "13px" });
        const $heightSlider = $("<input>")
            .attr({
                type: "range",
                min: WALL_HEIGHT_MIN,
                max: WALL_HEIGHT_MAX,
                step: WALL_HEIGHT_STEP,
                value: wallHeight
            })
            .css({
                width: "100%",
                "accent-color": "#ffd700",
                cursor: "pointer"
            })
            .on("input change", event => {
                const value = quantizeToStep(event.target.value, WALL_HEIGHT_MIN, WALL_HEIGHT_MAX, WALL_HEIGHT_STEP);
                wizardRef.selectedWallHeight = value;
                $heightLabel.text(`Height: ${value.toFixed(1)}`);
            });

        const $thicknessLabel = $("<div>")
            .text(`Thickness: ${wallThickness.toFixed(3)}`)
            .css({ color: "#ffffff", "font-size": "13px" });
        const $thicknessSlider = $("<input>")
            .attr({
                type: "range",
                min: WALL_THICKNESS_MIN,
                max: WALL_THICKNESS_MAX,
                step: WALL_THICKNESS_STEP,
                value: wallThickness
            })
            .css({
                width: "100%",
                "accent-color": "#ffd700",
                cursor: "pointer"
            })
            .on("input change", event => {
                const value = quantizeToStep(event.target.value, WALL_THICKNESS_MIN, WALL_THICKNESS_MAX, WALL_THICKNESS_STEP);
                wizardRef.selectedWallThickness = value;
                $thicknessLabel.text(`Thickness: ${value.toFixed(3)}`);
            });

        $grid.append($("<div>").text("Wall Height").css({ color: "#ffffff", "font-weight": "bold" }));
        $grid.append($heightSlider);
        $grid.append($heightLabel);
        $grid.append($("<div>").text("Wall Thickness").css({ color: "#ffffff", "font-weight": "bold" }));
        $grid.append($thicknessSlider);
        $grid.append($thicknessLabel);
    }

    function openWallSelector(wizardRef) {
        if (wizardRef && wizardRef.currentSpell !== "wall") {
            setCurrentSpell(wizardRef, "wall");
        }
        spellMenuMode = "wall";
        $("#spellMenu").removeClass("hidden");
        renderWallSelector(wizardRef);
        fetchWallTextures().then(() => {
            if (spellMenuMode === "wall") {
                renderWallSelector(wizardRef);
            }
        });
    }

    function renderFloorEditingSelector(wizardRef) {
        const $grid = $("#spellGrid");
        $grid.empty();
        $grid.css({
            display: "flex",
            "flex-direction": "column",
            gap: "10px",
            color: "#ffffff",
            "min-width": "220px"
        });

        const backButton = $("<div>")
            .addClass("spellIcon")
            .css({
                "display": "flex",
                "align-items": "center",
                "justify-content": "center",
                "font-size": "13px",
                "font-weight": "bold",
                "color": "#ffffff",
                "background": "rgba(20,20,20,0.9)"
            })
            .text("Back")
            .click(() => {
                spellMenuMode = "main";
                refreshSpellSelector(wizardRef);
            });
        const selectedLevel = getSelectedFloorEditLevel(wizardRef);
        setSelectedFloorEditLevel(wizardRef, selectedLevel);

        const $topRow = $("<div>")
            .css({
                display: "flex",
                "align-items": "flex-start",
                "flex-wrap": "wrap",
                gap: "8px"
            });
        $topRow.append(backButton);

        FLOOR_EDIT_TOOL_DEFS.forEach(tool => {
            const icon = $("<div>")
                .addClass("spellIcon")
                .css({
                    "background-image": `url('${tool.icon}')`,
                    "background-size": "cover",
                    "background-position": "center center"
                })
                .attr("data-spell", tool.name)
                .attr("title", tool.title || tool.name)
                .click(() => {
                    setCurrentSpell(wizardRef, tool.name);
                    $("#spellMenu").addClass("hidden");
                });
            if (wizardRef && wizardRef.currentSpell === tool.name) {
                icon.addClass("selected");
            }
            $topRow.append(icon);
        });
        $grid.append($topRow);

        const $levelRow = $("<label>")
            .css({
                display: "flex",
                "align-items": "center",
                gap: "8px",
                color: "#ffffff",
                "font-size": "13px",
                "font-weight": "bold"
            });
        const $levelSelect = $("<select>")
            .attr("title", "Floor level")
            .css({
                flex: "1 1 auto",
                color: "#ffffff",
                background: "rgba(20,20,20,0.95)",
                border: "1px solid #ffd700",
                "border-radius": "4px",
                padding: "4px 6px",
                cursor: "pointer"
            })
            .on("change", event => {
                setSelectedFloorEditLevel(wizardRef, event.target.value, { moveWizard: true });
            });
        for (let level = FLOOR_EDIT_LEVEL_MIN; level <= FLOOR_EDIT_LEVEL_MAX; level++) {
            const label = level > 0 ? `+${level}` : String(level);
            $levelSelect.append(
                $("<option>")
                    .attr("value", level)
                    .text(label)
            );
        }
        $levelSelect.val(String(selectedLevel));
        $levelRow.append($("<span>").text("Level"));
        $levelRow.append($levelSelect);
        $grid.append($levelRow);
    }

    function openFloorEditingSelector(wizardRef) {
        if (wizardRef && !isFloorEditorToolName(wizardRef.currentSpell)) {
            setCurrentSpell(wizardRef, "flooredit");
        }
        spellMenuMode = "flooredit";
        $("#spellMenu").removeClass("hidden");
        renderFloorEditingSelector(wizardRef);
    }

    function getAnimalFrameCSS(typeName) {
        const typeDef = (typeof SpawnAnimal !== "undefined" && Array.isArray(SpawnAnimal.ANIMAL_TYPES))
            ? SpawnAnimal.ANIMAL_TYPES.find(t => t.name === typeName)
            : null;
        const fc = typeDef && typeDef.frameCount;
        if (!fc) return {};
        return {
            "background-size": `${(fc.x || 1) * 100}% ${(fc.y || 1) * 100}%`,
            "background-position": "0 0"
        };
    }

    function getSpawnAnimalSpellIcon(wizardRef) {
        const selectedType = (wizardRef && typeof wizardRef.selectedAnimalType === "string")
            ? wizardRef.selectedAnimalType
            : "squirrel";
        const typeDef = (typeof SpawnAnimal !== "undefined" && Array.isArray(SpawnAnimal.ANIMAL_TYPES))
            ? SpawnAnimal.ANIMAL_TYPES.find(t => t.name === selectedType)
            : null;
        return (typeDef && typeDef.icon) ? typeDef.icon : "/assets/images/animals/squirrel.png";
    }

    function renderAnimalSelector(wizardRef) {
        const $grid = $("#spellGrid");
        $grid.empty();
        $grid.css({
            display: "flex",
            "flex-direction": "column",
            gap: "6px",
            padding: "8px",
            color: "#ffffff",
            "min-width": "220px"
        });

        const $back = $("<button>")
            .text("Back")
            .css({
                "align-self": "flex-start",
                padding: "4px 8px",
                "font-size": "12px",
                cursor: "pointer",
                color: "#ffffff",
                background: "rgba(20,20,20,0.95)",
                border: "1px solid #ffd700",
                "border-radius": "4px"
            })
            .on("click", () => {
                spellMenuMode = "main";
                refreshSpellSelector(wizardRef);
            });
        $grid.append($back);

        const animalTypes = (typeof SpawnAnimal !== "undefined" && Array.isArray(SpawnAnimal.ANIMAL_TYPES))
            ? SpawnAnimal.ANIMAL_TYPES
            : [];
        const selectedType = (wizardRef && typeof wizardRef.selectedAnimalType === "string")
            ? wizardRef.selectedAnimalType
            : "squirrel";

        // Animal type icons row
        const $typeRow = $("<div>")
            .css({
                display: "flex",
                "flex-wrap": "wrap",
                gap: "6px"
            });
        animalTypes.forEach(typeDef => {
            const fc = typeDef.frameCount || {x:1, y:1};
            const icon = $("<div>")
                .addClass("spellIcon")
                .css({
                    "background-image": `url('${typeDef.icon}')`,
                    "background-size": `${(fc.x || 1) * 100}% ${(fc.y || 1) * 100}%`,
                    "background-position": "0 0"
                })
                .attr("title", typeDef.name.charAt(0).toUpperCase() + typeDef.name.slice(1))
                .on("click", () => {
                    wizardRef.selectedAnimalType = typeDef.name;
                    refreshSpellSelector(wizardRef);
                });
            if (typeDef.name === selectedType) {
                icon.addClass("selected");
            }
            $typeRow.append(icon);
        });
        $grid.append($typeRow);

        // Size slider (log scale: 25%–400%, 100% in the middle)
        const currentScale = (wizardRef && Number.isFinite(wizardRef.selectedAnimalSizeScale))
            ? wizardRef.selectedAnimalSizeScale
            : 1;
        const sliderValue = (typeof SpawnAnimal !== "undefined" && typeof SpawnAnimal.scaleToSlider === "function")
            ? SpawnAnimal.scaleToSlider(currentScale)
            : 0.5;

        const $sizeLabel = $("<div>")
            .attr("id", "animalSizeLabel")
            .text(`Size: ${Math.round(currentScale * 100)}%`)
            .css({ color: "#ffffff", "font-size": "13px" });
        const $sizeSlider = $("<input>")
            .attr("id", "animalSizeSlider")
            .attr({
                type: "range",
                min: 0,
                max: 1,
                step: 0.005,
                value: sliderValue
            })
            .css({
                width: "100%",
                "accent-color": "#ffd700",
                cursor: "pointer"
            })
            .on("input change", event => {
                const t = parseFloat(event.target.value);
                const scale = (typeof SpawnAnimal !== "undefined" && typeof SpawnAnimal.sliderToScale === "function")
                    ? SpawnAnimal.sliderToScale(t)
                    : 1;
                wizardRef.selectedAnimalSizeScale = scale;
                syncAnimalSizeControls(wizardRef);
            });

        $grid.append($("<div>").text("Animal Size").css({ color: "#ffffff", "font-weight": "bold" }));
        $grid.append($sizeSlider);
        $grid.append($sizeLabel);
    }

    function renderTriggerAreaMenu(wizardRef) {
        const $grid = $("#spellGrid");
        $grid.empty();
        $grid.css({
            display: "flex",
            "flex-direction": "column",
            gap: "10px",
            color: "#ffffff",
            "min-width": "220px"
        });

        const $back = $("<button>")
            .text("Back")
            .css({
                "align-self": "flex-start",
                padding: "4px 8px",
                "font-size": "12px",
                cursor: "pointer",
                color: "#ffffff",
                background: "rgba(20,20,20,0.95)",
                border: "1px solid #ffd700",
                "border-radius": "4px"
            })
            .on("click", () => {
                spellMenuMode = "main";
                refreshSpellSelector(wizardRef);
            });
        const $row = $("<div>")
            .css({
                display: "flex",
                "align-items": "flex-start",
                gap: "8px"
            })
            .append($back);

        const $helpIcon = $("<button>")
            .attr("type", "button")
            .addClass("spellIcon")
            .attr("title", "Trigger area help")
            .text("?")
            .css({
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                background: "rgba(20,20,20,0.95)",
                color: "#ffd700",
                "font-size": "28px",
                "font-weight": "bold",
                "line-height": "1"
            })
            .on("click", () => openTriggerAreaHelpPanel());

        $row.append($helpIcon);
        $grid.append($row);
    }

    function openAnimalSelector(wizardRef) {
        if (wizardRef && wizardRef.currentSpell !== "spawnanimal") {
            setCurrentSpell(wizardRef, "spawnanimal");
        }
        spellMenuMode = "animal";
        $("#spellMenu").removeClass("hidden");
        renderAnimalSelector(wizardRef);
    }

    function openTriggerAreaMenu(wizardRef) {
        if (wizardRef && wizardRef.currentSpell !== "triggerarea") {
            setCurrentSpell(wizardRef, "triggerarea");
        }
        spellMenuMode = "triggerarea";
        $("#spellMenu").removeClass("hidden");
        renderTriggerAreaMenu(wizardRef);
    }

    function refreshSpellSelector(wizardRef) {
        if (!wizardRef) return;
        wizardRef.spells = buildSpellList(wizardRef);
        const $spellSelector = $("#spellSelector");
        const $selectedSpell = $("#selectedSpell");
        const $spellMenu = $("#spellMenu");
        const $spellGrid = $("#spellGrid");
        const showSpellSelector = shouldShowSpellSelector(wizardRef);
        $spellSelector.toggleClass("hidden", !showSpellSelector);
        if (!showSpellSelector) {
            $selectedSpell.empty().css({
                "background-image": "",
                "background-size": "",
                "background-position": "",
                "position": "",
                "overflow": ""
            });
            $spellMenu.addClass("hidden");
            $spellGrid.empty();
            return;
        }

        $selectedSpell.empty().css({
            "background-image": "",
            "background-size": "",
            "background-position": "",
            "position": "",
            "overflow": ""
        });

        const currentSpell = wizardRef.spells.find(s => s.name === wizardRef.currentSpell);
        if (currentSpell) {
            const selCss = {
                "background-image": `url('${currentSpell.icon}')`,
                "background-size": "",
                "background-position": ""
            };
            if (currentSpell.name === "spawnanimal") {
                const selectedType = (wizardRef && wizardRef.selectedAnimalType) || "squirrel";
                Object.assign(selCss, getAnimalFrameCSS(selectedType));
            }
            $selectedSpell.css(selCss);
            $selectedSpell.toggleClass("inactiveAura", isAuraSpellInactive(wizardRef, currentSpell.name));
        } else if (canUseEditorFeatures(wizardRef) && editorMode && (isEditorToolName(wizardRef.currentSpell) || isEditorSpellName(wizardRef.currentSpell))) {
            const iconUrl = getSelectedEditorIcon(wizardRef);
            $selectedSpell.css({
                "background-image": `url('${iconUrl}')`,
                "background-size": "cover",
                "background-position": "center center",
                "position": "" // Reset position in case it was modified
            });
            $selectedSpell.removeClass("inactiveAura");

            if (wizardRef.currentSpell === "placeobject") {
                const category = normalizeSelectedEditorCategory(wizardRef) || DEFAULT_PLACEABLE_CATEGORY;
                const texturePath = getSelectedPlaceableTextureForCategory(wizardRef, category);
                if (texturePath) {
                    if (typeof globalThis.getResolvedPlaceableMetadata === "function") {
                        // Dynamically load composite layers to display structured HTML if needed
                        globalThis.getResolvedPlaceableMetadata(category, texturePath).then(meta => {
                            if (!meta || !Array.isArray(meta.compositeLayers) || meta.compositeLayers.length < 2) return;
                            
                            // Prevent stale updates if user switched spells before promise resolved
                            if (wizardRef.currentSpell !== "placeobject") return;
                            const currentPath = getSelectedPlaceableTextureForCategory(wizardRef, normalizeSelectedEditorCategory(wizardRef));
                            if (currentPath !== texturePath) return;

                            $selectedSpell.empty().css({
                                "background-image": "none",
                                "position": "relative",
                                "overflow": "hidden"
                            });
                            
                            meta.compositeLayers.forEach(layer => {
                                if (!layer) return;
                                const uRegion = (Array.isArray(layer.uRegion) && layer.uRegion.length >= 2)
                                    ? [Number(layer.uRegion[0]) || 0, Number(layer.uRegion[1]) || 1]
                                    : [0, 1];
                                const u0 = uRegion[0];
                                const u1 = uRegion[1];
                                const fWidth = Math.max(0.0001, u1 - u0);
                                const subLayer = $("<div>").css({
                                    "position": "absolute",
                                    "top": "0", "left": "0", "width": "100%", "height": "100%",
                                    "overflow": "hidden",
                                    "pointer-events": "none"
                                });
                                const innerImg = $("<img>").attr("src", texturePath).css({
                                    "position": "absolute",
                                    "top": "0",
                                    "left": `-${(u0 / fWidth) * 100}%`,
                                    "width": `${100 / fWidth}%`,
                                    "height": "100%",
                                    "pointer-events": "none"
                                });
                                subLayer.append(innerImg);
                                $selectedSpell.append(subLayer);
                            });
                        });
                    }
                }
            }
        } else {
            $selectedSpell.removeClass("inactiveAura");
        }
        if (spellMenuMode === "flooring") {
            renderFlooringSelector(wizardRef);
            return;
        }
        if (spellMenuMode === "tree") {
            renderTreeSelector(wizardRef);
            return;
        }
        if (spellMenuMode === "wall") {
            renderWallSelector(wizardRef);
            return;
        }
        if (spellMenuMode === "flooredit") {
            renderFloorEditingSelector(wizardRef);
            return;
        }
        if (spellMenuMode === "animal") {
            renderAnimalSelector(wizardRef);
            return;
        }
        if (spellMenuMode === "triggerarea") {
            renderTriggerAreaMenu(wizardRef);
            return;
        }
        if (spellMenuMode === "editor-items") {
            renderEditorItemSelector(wizardRef, editorMenuCategory || normalizeSelectedEditorCategory(wizardRef));
            return;
        }
        $spellGrid.css({
            display: "",
            "flex-direction": "",
            gap: ""
        });
        $spellGrid.empty();
        wizardRef.spells.forEach(spell => {
            const iconCss = {
                "background-image": `url('${spell.icon}')`,
                "position": "relative"
            };
            if (spell.name === "spawnanimal") {
                const selectedType = (wizardRef && wizardRef.selectedAnimalType) || "squirrel";
                Object.assign(iconCss, getAnimalFrameCSS(selectedType));
            }
            const spellIcon = $("<div>")
                .addClass("spellIcon")
                .css(iconCss)
                .attr("data-spell", spell.name)
                .click(() => {
                    setCurrentSpell(wizardRef, spell.name);
                    $("#spellMenu").addClass("hidden");
                });

            if (spell.name === "buildroad") {
                spellIcon.on("contextmenu", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openFlooringSelector(wizardRef);
                });
            } else if (spell.name === "wall") {
                spellIcon.on("contextmenu", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openWallSelector(wizardRef);
                });
            } else if (spell.name === "treegrow") {
                spellIcon.on("contextmenu", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openTreeSelector(wizardRef);
                });
            } else if (spell.name === "spawnanimal") {
                spellIcon.on("contextmenu", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openAnimalSelector(wizardRef);
                });
            } else if (spell.name === "triggerarea") {
                spellIcon.on("contextmenu", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    openTriggerAreaMenu(wizardRef);
                });
            }

            if (spell.key) {
                const keyLabel = $("<span>")
                    .addClass("spellKeyBinding")
                    .text(spell.key)
                    .css({
                        "position": "absolute",
                        "top": "4px",
                        "left": "4px",
                        "color": "white",
                        "font-size": "12px",
                        "font-weight": "bold",
                        "pointer-events": "none",
                        "text-shadow": "1px 1px 2px rgba(0, 0, 0, 0.8)",
                        "z-index": "10"
                    });
                spellIcon.append(keyLabel);
            }

            if (spell.name === wizardRef.currentSpell) {
                spellIcon.addClass("selected");
            }
            $spellGrid.append(spellIcon);
        });

        // If editor mode is active, append editor tools and category icons at the bottom
        if (canUseEditorFeatures(wizardRef) && editorMode) {
            // Separator
            $spellGrid.append(
                $("<div>").css({
                    "width": "100%",
                    "height": "1px",
                    "background": "rgba(255,255,255,0.3)",
                    "margin": "4px 0",
                    "grid-column": "1 / -1"
                })
            );

            // Editor tools (wall, road, vanish)
            const editorTools = buildEditorToolList(wizardRef);
            editorTools.forEach(tool => {
                const toolCss = {
                    "background-image": `url('${tool.icon}')`,
                    "background-size": "cover",
                    "background-position": "center center",
                    "position": "relative"
                };
                const toolIcon = $("<div>")
                    .addClass("spellIcon")
                    .css(toolCss)
                    .attr("data-spell", tool.name)
                    .attr("title", tool.name)
                    .click(() => {
                        if (tool.name === "flooredit") {
                            openFloorEditingSelector(wizardRef);
                            return;
                        }
                        setCurrentSpell(wizardRef, tool.name);
                        refreshSpellSelector(wizardRef);
                        $("#spellMenu").addClass("hidden");
                    });
                if (tool.name === "flooredit") {
                    toolIcon.attr("data-opens-submenu", "true");
                }
                if (tool.name === "buildroad") {
                    toolIcon.on("contextmenu", event => {
                        event.preventDefault();
                        event.stopPropagation();
                        openFlooringSelector(wizardRef);
                    });
                } else if (tool.name === "wall") {
                    toolIcon.on("contextmenu", event => {
                        event.preventDefault();
                        event.stopPropagation();
                        openWallSelector(wizardRef);
                    });
                } else if (tool.name === "flooredit") {
                    toolIcon.on("contextmenu", event => {
                        event.preventDefault();
                        event.stopPropagation();
                        openFloorEditingSelector(wizardRef);
                    });
                }
                if (tool.key) {
                    const keyLabel = $("<span>")
                        .addClass("spellKeyBinding")
                        .text(tool.key)
                        .css({
                            "position": "absolute",
                            "top": "4px",
                            "left": "4px",
                            "color": "white",
                            "font-size": "12px",
                            "font-weight": "bold",
                            "pointer-events": "none",
                            "text-shadow": "1px 1px 2px rgba(0, 0, 0, 0.8)",
                            "z-index": "10"
                        });
                    toolIcon.append(keyLabel);
                }
                if (tool.name === wizardRef.currentSpell || (tool.name === "flooredit" && isFloorEditorToolName(wizardRef.currentSpell))) {
                    toolIcon.addClass("selected");
                }
                $spellGrid.append(toolIcon);
            });

            // Editor categories (placeable objects, powerups)
            const selectedEditorCategory = normalizeSelectedEditorCategory(wizardRef);
            EDITOR_CATEGORIES.forEach(category => {
                const selectedTexture = (category === "powerups")
                    ? getPowerupEditorCategoryIcon(wizardRef)
                    : getSelectedPlaceableTextureForCategory(wizardRef, category);
                const catIcon = $("<div>")
                    .addClass("spellIcon")
                    .css({
                        "background-image": `url('${selectedTexture}')`,
                        "background-size": "cover",
                        "background-position": "center center"
                    })
                    .attr("title", category)
                    .click(() => {
                        if (category === "powerups") {
                            wizardRef.selectedEditorCategory = "powerups";
                            setCurrentSpell(wizardRef, "blackdiamond");
                        } else {
                            setSelectedPlaceableCategory(wizardRef, category);
                            wizardRef.selectedEditorCategory = category;
                            refreshSelectedPlaceableMetadata(wizardRef);
                            setCurrentSpell(wizardRef, "placeobject");
                        }
                        refreshSpellSelector(wizardRef);
                        $("#spellMenu").addClass("hidden");
                    })
                    .on("contextmenu", event => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (category === "powerups") {
                            wizardRef.selectedEditorCategory = "powerups";
                            setCurrentSpell(wizardRef, "blackdiamond");
                        } else {
                            setSelectedPlaceableCategory(wizardRef, category);
                            wizardRef.selectedEditorCategory = category;
                            refreshSelectedPlaceableMetadata(wizardRef);
                            setCurrentSpell(wizardRef, "placeobject");
                        }
                        spellMenuMode = "editor-items";
                        editorMenuCategory = category;
                        renderEditorItemSelector(wizardRef, category);
                        if (category !== "powerups") {
                            fetchPlaceableImages({ forceRefresh: true }).then(() => {
                                if (spellMenuMode === "editor-items" && editorMenuCategory === category) {
                                    renderEditorItemSelector(wizardRef, category);
                                }
                            });
                        }
                    });
                if (category !== "powerups") {
                    applyCompositeLayersToThumbnail(catIcon, category, selectedTexture);
                }
                if (selectedEditorCategory === category) {
                    catIcon.addClass("selected");
                }
                $spellGrid.append(catIcon);
            });
        }
    }

    function setCurrentSpell(wizardRef, spellName) {
        if (!wizardRef) return;
        if ((isEditorSpellName(spellName) || isEditorToolName(spellName)) && !canUseEditorFeatures(wizardRef)) {
            if (spellName === "attacksquirrel") {
                console.log("[AttackSquirrelSelection] rejected-editor-access", {
                    spellName,
                    currentSpell: wizardRef.currentSpell
                });
            }
            return;
        }
        const isUnifiedMagicSelection = isAuraUnlocked(wizardRef, spellName);
        if (!isEditorSpellName(spellName) && !isEditorToolName(spellName) && !isUnifiedMagicSelection && !isSpellUnlocked(wizardRef, spellName)) {
            if (spellName === "attacksquirrel") {
                console.log("[AttackSquirrelSelection] rejected-locked", {
                    spellName,
                    currentSpell: wizardRef.currentSpell,
                    unlockedSpells: getUnlockedSpellNames(wizardRef),
                    unlockedMagic: Array.isArray(wizardRef.unlockedMagic) ? wizardRef.unlockedMagic.slice() : []
                });
            }
            return;
        }
        const previousSpell = wizardRef.currentSpell;
        spellMenuMode = "main";
        if (spellName !== "editscript") {
            if (
                typeof globalThis !== "undefined" &&
                globalThis.Scripting &&
                typeof globalThis.Scripting.closeScriptEditorPanel === "function"
            ) {
                globalThis.Scripting.closeScriptEditorPanel();
            }
        }
        if (spellName !== "wall") cancelDragSpell(wizardRef, "wall");
        if (spellName !== "buildroad") cancelDragSpell(wizardRef, "buildroad");
        if (spellName !== "firewall") cancelDragSpell(wizardRef, "firewall");
        if (!isMoveObjectToolName(spellName)) cancelDragSpell(wizardRef, "moveobject");
        if (!isVanishToolName(spellName)) cancelDragSpell(wizardRef, "vanish");
        if (spellName !== "triggerarea") clearTriggerAreaPlacementDraft(wizardRef);
        if (spellName !== "triggerarea") clearTriggerAreaVertexSelection(wizardRef);
        if (spellName !== "floorshape") clearFloorShapePlacementDraft(wizardRef);
        if (spellName !== "floorhole") clearFloorHolePlacementDraft(wizardRef);
        if (spellName !== "flooredit" && !isFloorEditorToolName(spellName)) {
            clearFloorEditorVertexSelection(wizardRef);
        }
        if (previousSpell !== spellName && isAuraSpellName(previousSpell)) {
            const remainingAuras = normalizeActiveAuras(wizardRef).filter(name => name !== previousSpell);
            setActiveAuras(wizardRef, remainingAuras);
        }
        wizardRef.currentSpell = spellName;
        clearTreePlacementPreviewVariant(wizardRef);
        clearTreePlacementPreviewSize(wizardRef);
        if (spellName === "treegrow") {
            getSelectedTreeGrowSize(wizardRef);
        }
        if (!isEditorSpellName(spellName) && !isEditorToolName(spellName)) {
            wizardRef.selectedSpellName = spellName;
        }
        if (spellName === "attacksquirrel") {
            console.log("[AttackSquirrelSelection] selected", {
                previousSpell,
                currentSpell: spellName,
                selectedSpellName: wizardRef.selectedSpellName
            });
        }
        if (previousSpell !== spellName) {
            const setForSpell = getSpellTargetHistorySet(wizardRef, spellName);
            if (setForSpell) {
                wizardRef._spellTargetHistory.set(spellName, new WeakSet());
            }
        }
        wizardRef.spells = buildSpellList(wizardRef);
        if (spellName === "blackdiamond") {
            wizardRef.selectedEditorCategory = "powerups";
        } else if (spellName === "placeobject") {
            wizardRef.selectedEditorCategory = getSelectedPlaceableCategory(wizardRef);
        }
        normalizeSelectedEditorCategory(wizardRef);
        syncAdventureAuraSelectionState(wizardRef);
        refreshSpellSelector(wizardRef);
        refreshAuraSelector(wizardRef);
        if (wizardRef.currentSpell !== "treegrow") {
            stopTreeGrowthChannel(wizardRef, false);
        }
    }

    function initWizardSpells(wizardRef) {
        if (!wizardRef) return;
        getSelectedFlooringTexture(wizardRef);
        getSelectedTreeTextureVariant(wizardRef);
        normalizePlaceableSelections(wizardRef);
        normalizeSelectedEditorCategory(wizardRef);
        getSelectedPowerupFileName(wizardRef);
        getSelectedPowerupPlacementScale(wizardRef);
        getSelectedWallHeight(wizardRef);
        getSelectedWallThickness(wizardRef);
        getSelectedWallTexture(wizardRef);
        getSelectedRoadWidth(wizardRef);
        setSelectedFloorEditLevel(wizardRef, getSelectedFloorEditLevel(wizardRef));
        getSelectedRoofOverhang(wizardRef);
        getSelectedRoofPeakHeight(wizardRef);
        getSelectedRoofTextureRepeat(wizardRef);
        getUnlockedSpellNames(wizardRef);
        getUnlockedAuraNames(wizardRef);
        wizardRef.spells = buildSpellList(wizardRef);
        wizardRef.selectedSpellName = getSelectedSpellName(wizardRef);
        normalizeActiveAuras(wizardRef);
        // Determine if current spell is valid for available mode
        const isValidSpell = wizardRef.currentSpell &&
            (wizardRef.spells.some(s => s.name === wizardRef.currentSpell) ||
             (canUseEditorFeatures(wizardRef) && (isEditorSpellName(wizardRef.currentSpell) ||
             isEditorToolName(wizardRef.currentSpell))));
        if (!isValidSpell) {
            wizardRef.currentSpell = wizardRef.selectedSpellName || "";
        }
        // If current spell is an editor tool (wall/buildroad), start in editor mode
        if (canUseEditorFeatures(wizardRef) && isEditorToolName(wizardRef.currentSpell)) {
            wizardRef.showEditorPanel = true;
        }
        wizardRef.refreshSpellSelector = () => refreshSpellSelector(wizardRef);
        wizardRef.refreshEditorSelector = () => refreshEditorSelector(wizardRef);
        wizardRef.syncSpellAvailability = () => syncWizardUnlockState(wizardRef);
        // Keep startup spell state consistent with manual spell re-selection.
        setCurrentSpell(wizardRef, wizardRef.currentSpell);
        setEditorPanelVisible(wizardRef, canUseEditorFeatures(wizardRef) && wizardRef.showEditorPanel !== false);
        refreshAuraSelector(wizardRef);
        fetchFlooringTextures();
        fetchWallTextures();
        fetchPlaceableImages().then(() => {
            normalizePlaceableSelections(wizardRef);
            refreshSelectedPlaceableMetadata(wizardRef);
            syncWizardUnlockState(wizardRef);
        });
    }

    function showMainSpellMenu(wizardRef) {
        if (!wizardRef) return;
        spellMenuMode = "main";
        wizardRef.spells = buildSpellList(wizardRef);
        refreshSpellSelector(wizardRef);
    }

    function showFlooringMenu(wizardRef) {
        if (!wizardRef) return;
        setCurrentSpell(wizardRef, "buildroad");
        openFlooringSelector(wizardRef);
    }

    function showTreeMenu(wizardRef) {
        if (!wizardRef) return;
        setCurrentSpell(wizardRef, "treegrow");
        openTreeSelector(wizardRef);
    }

    function showWallMenu(wizardRef) {
        if (!wizardRef) return;
        setCurrentSpell(wizardRef, "wall");
        openWallSelector(wizardRef);
    }

    function showFloorEditingMenu(wizardRef) {
        if (!wizardRef) return;
        openFloorEditingSelector(wizardRef);
    }

    function showAnimalMenu(wizardRef) {
        if (!wizardRef) return;
        setCurrentSpell(wizardRef, "spawnanimal");
        openAnimalSelector(wizardRef);
    }

    function showTriggerAreaMenu(wizardRef) {
        if (!wizardRef) return;
        setCurrentSpell(wizardRef, "triggerarea");
        openTriggerAreaMenu(wizardRef);
    }

    function showEditorMenu(wizardRef) {
        if (!wizardRef) return;
        if (!canUseEditorFeatures(wizardRef)) return;
        openEditorSelector(wizardRef);
    }

    function showEditorSubmenuForSelectedCategory(wizardRef) {
        if (!wizardRef) return;
        if (!canUseEditorFeatures(wizardRef)) return;
        const category = normalizeSelectedEditorCategory(wizardRef);
        activateSelectedEditorTool(wizardRef);
        spellMenuMode = "editor-items";
        editorMenuCategory = category;
        $("#spellMenu").removeClass("hidden");
        renderEditorItemSelector(wizardRef, category);
        if (category !== "powerups") {
            fetchPlaceableImages({ forceRefresh: true }).then(() => {
                if (spellMenuMode === "editor-items" && editorMenuCategory === category) {
                    renderEditorItemSelector(wizardRef, category);
                }
            });
        }
    }

    function setEditorPanelVisible(wizardRef, visible) {
        if (!wizardRef) return;
        wizardRef.showEditorPanel = canUseEditorFeatures(wizardRef);
        $("#editorSelector").toggleClass("hidden", !wizardRef.showEditorPanel);
        if (wizardRef.showEditorPanel) {
            setEditorMode(true, wizardRef);
        } else {
            $("#editorMenu").addClass("hidden");
            setEditorMode(false, wizardRef);
        }
    }

    function toggleEditorPanelVisible(wizardRef) {
        if (!wizardRef) return false;
        if (!canUseEditorFeatures(wizardRef)) {
            setEditorPanelVisible(wizardRef, false);
            return false;
        }
        setEditorPanelVisible(wizardRef, true);
        return true;
    }

    function activateSelectedEditorTool(wizardRef) {
        if (!wizardRef) return null;
        if (!canUseEditorFeatures(wizardRef)) return null;
        const category = normalizeSelectedEditorCategory(wizardRef);
        if (category === "powerups") {
            setCurrentSpell(wizardRef, "blackdiamond");
            return "blackdiamond";
        }
        setSelectedPlaceableCategory(wizardRef, category);
        refreshSelectedPlaceableMetadata(wizardRef);
        setCurrentSpell(wizardRef, "placeobject");
        return "placeobject";
    }

    function activateSelectedSpellTool(wizardRef) {
        if (!wizardRef) return null;
        const spellName = getSelectedSpellName(wizardRef);
        if (!spellName) return null;
        setCurrentSpell(wizardRef, spellName);
        return spellName;
    }

    function selectEditorCategory(wizardRef, category) {
        if (!wizardRef) return;
        if (!canUseEditorFeatures(wizardRef)) return;
        setSelectedPlaceableCategory(wizardRef, category);
        wizardRef.selectedEditorCategory = category;
        refreshSelectedPlaceableMetadata(wizardRef);
        setCurrentSpell(wizardRef, "placeobject");
    }

    function showPlaceableMenu(wizardRef) {
        if (!wizardRef) return;
        if (!canUseEditorFeatures(wizardRef)) return;
        activateSelectedEditorTool(wizardRef);
        showEditorMenu(wizardRef);
    }

    function primeSpellAssets() {
        if (globalThis.Fireball && typeof globalThis.Fireball.getFrames === "function") {
            globalThis.Fireball.getFrames();
        }
    }

    return {
        castWizardSpell,
        initWizardSpells,
        getAllMagicNames,
        getMagicIconPath,
        isKnownMagicName,
        grantMagicUnlock,
        revokeMagicUnlock,
        refreshSpellSelector,
        refreshAuraSelector,
        syncWizardUnlockState,
        setCurrentSpell,
        toggleAura,
        isAuraSpellName,
        isAuraActive,
        isPlayerInvisibleToEnemies,
        isEditorMode,
        setEditorMode,
        toggleEditorMode,
        isEditorToolName,
        showMainSpellMenu,
        showFlooringMenu,
        showTreeMenu,
        showWallMenu,
        showFloorEditingMenu,
        showAnimalMenu,
        showTriggerAreaMenu,
        showEditorMenu,
        showEditorSubmenuForSelectedCategory,
        showPlaceableMenu,
        refreshEditorSelector,
        setEditorPanelVisible,
        toggleEditorPanelVisible,
        activateSelectedEditorTool,
        activateSelectedSpellTool,
        selectEditorCategory,
        isEditorSpellName,
        adjustPlaceableRenderOffset,
        adjustPlaceableScale,
        adjustPowerupPlacementScale,
        adjustAnimalSizeScale,
        adjustTreeGrowSize,
        adjustPlaceableRotation,
        resolveTreePlacementSize,
        resolveTreePlacementTextureVariant,
        clearTreePlacementPreviewSize,
        clearTreePlacementPreviewVariant,
        getPowerupPlacementPreviewConfig,
        beginDragSpell,
        updateDragPreview,
        completeDragSpell,
        cancelDragSpell,
        cancelTriggerAreaPlacement,
        cancelFloorShapePlacement,
        cancelFloorHolePlacement,
        insertTriggerAreaVertexOnEdge,
        beginTriggerAreaVertexDrag,
        updateTriggerAreaVertexDrag,
        endTriggerAreaVertexDrag,
        deleteSelectedTriggerAreaVertex,
        getTriggerAreaVertexSelection,
        insertFloorEditorVertexOnEdge,
        beginFloorEditorVertexDrag,
        updateFloorEditorVertexDrag,
        endFloorEditorVertexDrag,
        deleteSelectedFloorEditorVertex,
        getFloorEditorVertexSelection,
        openTriggerAreaHelpPanel,
        closeTriggerAreaHelpPanel,
        isFloorEditorToolName,
        isDragSpellActive,
        primeSpellAssets,
        startMagicInterval,
        stopMagicInterval,
        setHealingAuraHpMultiplier,
        startTreeGrowthChannel,
        stopTreeGrowthChannel,
        updateCharacterObjectCollisions,
        getHoverTargetForCurrentSpell,
        isValidHoverTargetForCurrentSpell,
        getVanishWallPreviewPolygonForHover,
        getVanishDragHighlightState,
        getTriggerAreaPlacementPreview,
        getFloorShapePlacementPreview,
        getFloorShapeWallLoopCandidate,
        getFloorHolePlacementPreview,
        paintFloorPolygonAtWorldPoint,
        getVisibleFloorPolygonTargetAtScreenPoint,
        getDragStartSnapTargetForSpell,
        getPlaceObjectPlacementCandidate,
        getAdjustedWallDragWorldPoint,
        isFloorEditDiagnosticsEnabled,
        setFloorEditDiagnosticsEnabled,
        getFloorEditDiagnosticsLog,
        clearFloorEditDiagnosticsLog,
        recordFloorEditDiagnostic,
        getSelectedFloorEditLevel,
        setSelectedFloorEditLevel
    };
})();

if (typeof globalThis !== "undefined") {
    globalThis.SpellSystem = SpellSystem;
}
