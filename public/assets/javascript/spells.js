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
const MOVE_OBJECT_PERF_MAX_EVENTS = 800;

function isMoveObjectPerfEnabled() {
    return !!(typeof globalThis !== "undefined" && globalThis.__moveObjectPerf);
}

function ensureMoveObjectPerfReport() {
    if (typeof globalThis === "undefined") return null;
    if (!globalThis.__moveObjectPerfReport || typeof globalThis.__moveObjectPerfReport !== "object") {
        const nowMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
        globalThis.__moveObjectPerfReport = {
            startedAtMs: nowMs,
            events: [],
            counters: Object.create(null),
            totalsMs: Object.create(null),
            maxMs: Object.create(null),
            last: Object.create(null)
        };
    }
    return globalThis.__moveObjectPerfReport;
}

function recordMoveObjectPerf(name, data = null, elapsedMs = null) {
    if (!isMoveObjectPerfEnabled()) return null;
    const report = ensureMoveObjectPerfReport();
    if (!report || !name) return null;
    const eventName = String(name);
    report.counters[eventName] = (Number(report.counters[eventName]) || 0) + 1;
    const event = {
        t: (typeof performance !== "undefined" && performance && typeof performance.now === "function")
            ? performance.now()
            : Date.now(),
        name: eventName
    };
    if (Number.isFinite(elapsedMs)) {
        const ms = Number(elapsedMs);
        event.ms = ms;
        report.totalsMs[eventName] = (Number(report.totalsMs[eventName]) || 0) + ms;
        report.maxMs[eventName] = Math.max(Number(report.maxMs[eventName]) || 0, ms);
    }
    if (data && typeof data === "object") {
        Object.assign(event, data);
    }
    report.last[eventName] = event;
    if (!Array.isArray(report.events)) report.events = [];
    report.events.push(event);
    if (report.events.length > MOVE_OBJECT_PERF_MAX_EVENTS) {
        report.events.splice(0, report.events.length - MOVE_OBJECT_PERF_MAX_EVENTS);
    }
    return event;
}

function resetMoveObjectPerfReport() {
    if (typeof globalThis === "undefined") return null;
    globalThis.__moveObjectPerfReport = null;
    return ensureMoveObjectPerfReport();
}

function summarizeMoveObjectPerfReport(report = null) {
    const source = report || ensureMoveObjectPerfReport();
    if (!source) return null;
    const counters = source.counters || {};
    const totalsMs = source.totalsMs || {};
    const maxMs = source.maxMs || {};
    const eventNames = Array.from(new Set([
        ...Object.keys(counters),
        ...Object.keys(totalsMs),
        ...Object.keys(maxMs)
    ])).sort();
    const byEvent = eventNames.map(name => {
        const count = Number(counters[name]) || 0;
        const totalMs = Number(totalsMs[name]) || 0;
        const max = Number(maxMs[name]) || 0;
        return {
            name,
            count,
            totalMs,
            avgMs: count > 0 && totalMs > 0 ? totalMs / count : 0,
            maxMs: max
        };
    });
    const slowFrames = Array.isArray(source.events)
        ? source.events
            .filter(event => event && event.name === "rendering.frame" && Number(event.ms) >= 25)
            .slice(-20)
        : [];
    return {
        startedAtMs: source.startedAtMs,
        eventCount: Array.isArray(source.events) ? source.events.length : 0,
        byTotalMs: byEvent.slice().sort((a, b) => b.totalMs - a.totalMs),
        byMaxMs: byEvent.slice().sort((a, b) => b.maxMs - a.maxMs),
        byCount: byEvent.slice().sort((a, b) => b.count - a.count),
        slowFrames,
        last: source.last || {}
    };
}

if (typeof globalThis !== "undefined") {
    if (typeof globalThis.__recordMoveObjectPerf !== "function") {
        globalThis.__recordMoveObjectPerf = recordMoveObjectPerf;
    }
    globalThis.__resetMoveObjectPerf = resetMoveObjectPerfReport;
    globalThis.__getMoveObjectPerfReport = function getMoveObjectPerfReport() {
        return ensureMoveObjectPerfReport();
    };
    globalThis.__summarizeMoveObjectPerf = function summarizeMoveObjectPerf(report = null) {
        return summarizeMoveObjectPerfReport(report);
    };
}

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
    const EDITOR_CATEGORIES = [...EDITOR_PLACEABLE_CATEGORIES, "powerups", "buildings"];
    const EDITOR_MENU_ICON = "/assets/images/thumbnails/edit.png";
    const BUILDING_EDITOR_ICON = "/assets/images/thumbnails/layers.png";
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
    let buildingEditorSaveList = null;
    let buildingEditorSaveListFetchPromise = null;
    const buildingEditorSavePayloadsByName = new Map();
    const buildingEditorSavePayloadFetchesByName = new Map();
    let editorMenuCategory = DEFAULT_PLACEABLE_CATEGORY;
    const textureAlphaMaskCache = new Map();

    function normalizeFloorEditLevel(level) {
        const n = Number(level);
        if (!Number.isFinite(n)) return FLOOR_EDIT_LEVEL_DEFAULT;
        return Math.max(FLOOR_EDIT_LEVEL_MIN, Math.min(FLOOR_EDIT_LEVEL_MAX, Math.round(n)));
    }

    function normalizeRuntimeFloorLayer(layer, fallback = 0) {
        const n = Number(layer);
        if (!Number.isFinite(n)) return fallback;
        return Math.round(n);
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
        const wizardTarget = wizardRef || ((typeof globalThis !== "undefined") ? globalThis.wizard : null);
        const targetBaseZ = Number.isFinite(options && options.baseZ)
            ? Number(options.baseZ)
            : (wizardTarget && Number.isFinite(wizardTarget.currentLayerBaseZ)
                ? Number(wizardTarget.currentLayerBaseZ)
                : null);
        if (shouldMoveWizard && !Number.isFinite(targetBaseZ)) {
            throw new Error(`selected floor edit level ${normalized} requires baseZ when moving wizard`);
        }
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
        return spellName === "wall" || spellName === "buildroad" || spellName === "flooredit" || isFloorEditorToolName(spellName) || spellName === "moveobject" || spellName === "editorvanish" || spellName === "placeobject" || spellName === "placebuilding" || spellName === "blackdiamond" || spellName === "nodeinspector";
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
        if (wizardRef.currentSpell === "placebuilding") return "buildings";
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
        if (category === "buildings") {
            return BUILDING_EDITOR_ICON;
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

    function normalizeBuildingSaveName(rawName) {
        return String(rawName === undefined || rawName === null ? "" : rawName).trim();
    }

    function fetchBuildingEditorSaves(options = {}) {
        const forceRefresh = !!(options && options.forceRefresh);
        if (forceRefresh) {
            buildingEditorSaveList = null;
        }
        if (!forceRefresh && Array.isArray(buildingEditorSaveList)) {
            return Promise.resolve(buildingEditorSaveList);
        }
        if (!forceRefresh && buildingEditorSaveListFetchPromise) {
            return buildingEditorSaveListFetchPromise;
        }
        buildingEditorSaveListFetchPromise = fetch("/api/building-editor/buildings", { cache: "no-cache" })
            .then(response => response.json())
            .then(payload => {
                if (!payload || payload.ok !== true || !Array.isArray(payload.buildings)) {
                    throw new Error("building editor save list response is invalid");
                }
                buildingEditorSaveList = payload.buildings
                    .filter(item => item && typeof item.name === "string" && item.name.trim().length > 0)
                    .map(item => ({ ...item, name: item.name.trim() }));
                return buildingEditorSaveList;
            })
            .finally(() => {
                buildingEditorSaveListFetchPromise = null;
            });
        return buildingEditorSaveListFetchPromise;
    }

    function fetchBuildingEditorSaveData(saveName) {
        const name = normalizeBuildingSaveName(saveName);
        if (!name) return Promise.reject(new Error("missing building save name"));
        if (buildingEditorSavePayloadsByName.has(name)) {
            return Promise.resolve(buildingEditorSavePayloadsByName.get(name));
        }
        if (buildingEditorSavePayloadFetchesByName.has(name)) {
            return buildingEditorSavePayloadFetchesByName.get(name);
        }
        const promise = fetch(`/api/building-editor/buildings/${encodeURIComponent(name)}`, { cache: "no-cache" })
            .then(response => response.json().then(payload => ({ response, payload })))
            .then(({ response, payload }) => {
                if (!response.ok || !payload || payload.ok !== true || !payload.data) {
                    throw new Error(`failed to load building save ${name}`);
                }
                if (payload.data.schema !== "survivor-building-v1" || !Array.isArray(payload.data.floorFragments)) {
                    throw new Error(`invalid building save ${name}`);
                }
                buildingEditorSavePayloadsByName.set(name, payload.data);
                return payload.data;
            })
            .finally(() => {
                buildingEditorSavePayloadFetchesByName.delete(name);
            });
        buildingEditorSavePayloadFetchesByName.set(name, promise);
        return promise;
    }

    function getSelectedBuildingSaveName(wizardRef) {
        const selected = normalizeBuildingSaveName(wizardRef && wizardRef.selectedBuildingSaveName);
        if (selected) return selected;
        if (Array.isArray(buildingEditorSaveList) && buildingEditorSaveList.length > 0) {
            return buildingEditorSaveList[0].name;
        }
        return "";
    }

    function setSelectedBuildingSaveName(wizardRef, saveName) {
        if (!wizardRef) return "";
        const name = normalizeBuildingSaveName(saveName);
        if (!name) throw new Error("missing building save name");
        wizardRef.selectedBuildingSaveName = name;
        wizardRef.selectedEditorCategory = "buildings";
        return name;
    }

    function getSelectedBuildingRotation(wizardRef) {
        const raw = Number(wizardRef && wizardRef.selectedBuildingRotation);
        return Number.isFinite(raw) ? raw : 0;
    }

    function adjustBuildingPlacementRotation(wizardRef, deltaDegrees) {
        if (!wizardRef || !Number.isFinite(deltaDegrees) || deltaDegrees === 0) return null;
        const current = getSelectedBuildingRotation(wizardRef);
        const stepRadians = PLACEABLE_ROTATION_STEP_DEGREES * Math.PI / 180;
        let next = current + (Number(deltaDegrees) * Math.PI / 180);
        next = ((next % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (next > Math.PI) next -= Math.PI * 2;
        const snapped = Math.round(next / stepRadians) * stepRadians;
        wizardRef.selectedBuildingRotation = snapped;
        wizardRef.selectedEditorCategory = "buildings";
        return snapped;
    }

    function buildBuildingPlacementTransform(wizardRef, worldX, worldY, options = {}) {
        const mapRef = wizardRef && wizardRef.map ? wizardRef.map : (typeof map !== "undefined" ? map : null);
        const layerPoint = typeof resolveEditorWorldPointOnLayer === "function"
            ? resolveEditorWorldPointOnLayer(wizardRef, worldX, worldY, {
                ...options,
                useVisibleFloorTarget: false
            })
            : { x: worldX, y: worldY };
        const xRaw = Number.isFinite(layerPoint && layerPoint.x) ? Number(layerPoint.x) : Number(worldX);
        const yRaw = Number.isFinite(layerPoint && layerPoint.y) ? Number(layerPoint.y) : Number(worldY);
        return {
            x: mapRef && typeof mapRef.wrapWorldX === "function" ? mapRef.wrapWorldX(xRaw) : xRaw,
            y: mapRef && typeof mapRef.wrapWorldY === "function" ? mapRef.wrapWorldY(yRaw) : yRaw,
            rotation: getSelectedBuildingRotation(wizardRef)
        };
    }

    function getBuildingPlacementPreview(wizardRef, options = {}) {
        const forceActive = !!(options && (options.forceActive === true || options.spaceHeld === true));
        if (!wizardRef || wizardRef.currentSpell !== "placebuilding" || (wizardRef.editorPlacementActive !== true && !forceActive)) return null;
        const saveName = getSelectedBuildingSaveName(wizardRef);
        if (!saveName) {
            fetchBuildingEditorSaves().catch(error => console.error("[building placement] failed to list saves", error));
            return null;
        }
        const mouse = (options && options.mouseWorldPos) || (
            typeof mousePos !== "undefined" && mousePos && Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY)
                ? { x: Number(mousePos.worldX), y: Number(mousePos.worldY), screenX: mousePos.screenX, screenY: mousePos.screenY }
                : null
        );
        if (!mouse || !Number.isFinite(mouse.x) || !Number.isFinite(mouse.y)) return null;
        const buildingData = buildingEditorSavePayloadsByName.get(saveName) || null;
        if (!buildingData) {
            fetchBuildingEditorSaveData(saveName).catch(error => console.error("[building placement] failed to load preview", error));
            return { loading: true, buildingSaveName: saveName, footprintPolygons: [] };
        }
        const mapRef = wizardRef.map || (typeof map !== "undefined" ? map : null);
        if (!mapRef || typeof mapRef.computePrototypeBuildingFootprint !== "function") {
            throw new Error("building placement preview requires section-world building APIs");
        }
        const transform = buildBuildingPlacementTransform(wizardRef, mouse.x, mouse.y, {
            screenX: Number.isFinite(mouse.screenX) ? mouse.screenX : undefined,
            screenY: Number.isFinite(mouse.screenY) ? mouse.screenY : undefined
        });
        const placement = {
            id: "building:preview",
            buildingSaveName: saveName,
            transform
        };
        const footprintPolygons = mapRef.computePrototypeBuildingFootprint(buildingData, placement);
        const overlappedSectionKeys = typeof mapRef.computePrototypeBuildingOverlappedSectionKeys === "function"
            ? mapRef.computePrototypeBuildingOverlappedSectionKeys(footprintPolygons)
            : [];
        return {
            loading: false,
            buildingSaveName: saveName,
            transform,
            footprintPolygons,
            overlappedSectionKeys
        };
    }

    function placeSelectedBuilding(wizardRef, worldX, worldY, options = {}) {
        if (!wizardRef || wizardRef.castDelay) return false;
        const mapRef = wizardRef.map || (typeof map !== "undefined" ? map : null);
        if (!mapRef || typeof mapRef.addPrototypeBuildingPlacement !== "function") {
            message("Building placement is unavailable.");
            return false;
        }
        const saveName = getSelectedBuildingSaveName(wizardRef);
        if (!saveName) {
            fetchBuildingEditorSaves({ forceRefresh: true })
                .then((items) => {
                    if (items.length > 0) setSelectedBuildingSaveName(wizardRef, items[0].name);
                })
                .catch(error => console.error("[building placement] failed to refresh saves", error));
            message("Choose a building first.");
            return false;
        }
        const transform = buildBuildingPlacementTransform(wizardRef, worldX, worldY, options);
        wizardRef.castDelay = true;
        wizardRef.casting = true;
        fetchBuildingEditorSaveData(saveName)
            .then((buildingData) => {
                const placement = mapRef.addPrototypeBuildingPlacement({
                    buildingSaveName: saveName,
                    transform
                }, { buildingData });
                if (typeof mapRef.schedulePrototypeRuntimeSync === "function") {
                    mapRef.schedulePrototypeRuntimeSync({ reason: "building-placement" });
                }
                message(`Placed building ${placement.buildingSaveName}.`);
            })
            .catch((error) => {
                console.error("[building placement] failed", error);
                message("Building placement failed.");
            })
            .finally(() => {
                wizardRef.castDelay = false;
                wizardRef.casting = false;
            });
        return true;
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
        if (spellName === "buildroad") return !!wizardRef.roadLayoutMode && getRoadPathDraftPoints(wizardRef).length > 0;
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
            wizardRef.roadPathDraft = null;
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
            const dragState = wizardRef.moveObjectDragState || null;
            finalizeMoveObjectDragSupport(dragState);
            finalizeMovedPrototypeObjectPersistence(dragState);
            restorePrototypeBuildingMoveObjectBakeExclusion(wizardRef.moveObjectDragState);
            wizardRef.moveObjectDragState = null;
            if (dragState) {
                const target = dragState.target || null;
                recordMoveObjectPerf("moveObject.drag.end", {
                    targetType: target && target.type || "",
                    ownerId: target && target._prototypeOwnerId || "",
                    recordId: Number.isInteger(Number(target && target._prototypeRecordId))
                        ? Number(target._prototypeRecordId)
                        : null,
                    hadBakeExclusion: !!dragState.prototypeBuildingInteriorBitmapExclusion
                });
            }
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
        throw new Error(`layer ${normalizedLayer} requires currentLayerBaseZ`);
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

    function getRoadPathPlacementPoint(wizardRef, worldX, worldY, snapTarget = null) {
        if (!wizardRef || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const mapRef = wizardRef.map || null;
        if (snapTarget && snapTarget.point && Number.isFinite(snapTarget.point.x) && Number.isFinite(snapTarget.point.y)) {
            return wrapWorldPointForMap(mapRef, Number(snapTarget.point.x), Number(snapTarget.point.y));
        }
        if (snapTarget && snapTarget.node && Number.isFinite(snapTarget.node.x) && Number.isFinite(snapTarget.node.y)) {
            return wrapWorldPointForMap(mapRef, Number(snapTarget.node.x), Number(snapTarget.node.y));
        }
        const node = mapRef && typeof mapRef.worldToNode === "function"
            ? mapRef.worldToNode(worldX, worldY)
            : null;
        if (node && Number.isFinite(node.x) && Number.isFinite(node.y)) {
            return wrapWorldPointForMap(mapRef, Number(node.x), Number(node.y));
        }
        return wrapWorldPointForMap(mapRef, worldX, worldY);
    }

    function getRoadPathDraftPoints(wizardRef) {
        const draft = wizardRef && wizardRef.roadPathDraft;
        return draft && Array.isArray(draft.points) ? draft.points : [];
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
        if (
            globalThis.Spell &&
            typeof globalThis.Spell.isCharacterWorldZTarget === "function" &&
            globalThis.Spell.isCharacterWorldZTarget(target) &&
            typeof target.getInterpolatedPosition === "function"
        ) {
            const interpolated = target.getInterpolatedPosition();
            if (
                interpolated &&
                Number.isFinite(interpolated.x) &&
                Number.isFinite(interpolated.y)
            ) {
                const mapRef = (wizardRef && wizardRef.map) || (target && target.map) || null;
                let x = Number(interpolated.x);
                let y = Number(interpolated.y);
                if (mapRef && typeof mapRef.wrapWorldX === "function") x = mapRef.wrapWorldX(x);
                if (mapRef && typeof mapRef.wrapWorldY === "function") y = mapRef.wrapWorldY(y);
                return { x, y, z: resolveTargetZ() };
            }
        }
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
        const band = (item.type === "road" || item.type === "roadPath") ? 0 : 1;
        let depth = 0;
        if (Number.isFinite(item.renderZ)) {
            depth = Number(item.renderZ);
        } else if (item.type === "road" || item.type === "roadPath") {
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

    function isMoveObjectPlacedObject(target) {
        return !!(
            target &&
            (
                target.type === "placedObject" ||
                target.objectType === "placedObject" ||
                target.isPlacedObject === true
            )
        );
    }

    function markMovedPrototypeObjectDirty(target, mapRef) {
        if (!target || target._prototypeRuntimeRecord !== true) return;
        target._prototypeDirty = true;
        const objectState = mapRef && mapRef._prototypeObjectState;
        if (!objectState) return;
        if (!(objectState.dirtyRuntimeObjects instanceof Set)) {
            objectState.dirtyRuntimeObjects = new Set();
        }
        objectState.dirtyRuntimeObjects.add(target);
        objectState.captureScanNeeded = true;
    }

    function captureMovedPrototypeObjectImmediately(target, mapRef) {
        if (!target || target._prototypeRuntimeRecord !== true) return;
        if (!mapRef || typeof mapRef.capturePendingPrototypeObjects !== "function") {
            throw new Error("moved prototype object support change requires map.capturePendingPrototypeObjects");
        }
        if (mapRef.capturePendingPrototypeObjects() !== true) {
            throw new Error("moved prototype object support change failed to persist before restoring baked texture");
        }
    }

    function getMoveObjectPersistenceSnapshot(target) {
        if (!target || typeof target !== "object") return null;
        return {
            x: Number.isFinite(target.x) ? Number(target.x) : null,
            y: Number.isFinite(target.y) ? Number(target.y) : null,
            z: Number.isFinite(target.z) ? Number(target.z) : null,
            rotation: Number.isFinite(target.rotation) ? Number(target.rotation) : null,
            placementRotation: Number.isFinite(target.placementRotation) ? Number(target.placementRotation) : null,
            mountedWallLineGroupId: Number.isInteger(Number(target.mountedWallLineGroupId)) ? Number(target.mountedWallLineGroupId) : null,
            mountedSectionId: Number.isInteger(Number(target.mountedSectionId)) ? Number(target.mountedSectionId) : null,
            mountedWallSectionUnitId: Number.isInteger(Number(target.mountedWallSectionUnitId)) ? Number(target.mountedWallSectionUnitId) : null,
            mountedWallFacingSign: Number.isFinite(target.mountedWallFacingSign) ? Number(target.mountedWallFacingSign) : null,
            fragmentId: typeof target.fragmentId === "string" ? target.fragmentId : "",
            surfaceId: typeof target.surfaceId === "string" ? target.surfaceId : "",
            ownerType: typeof target._prototypeOwnerType === "string" ? target._prototypeOwnerType : "",
            ownerId: typeof target._prototypeOwnerId === "string" ? target._prototypeOwnerId : "",
            ownerSectionKey: typeof target._prototypeOwnerSectionKey === "string" ? target._prototypeOwnerSectionKey : ""
        };
    }

    function moveObjectPersistenceSnapshotChanged(previous, current, mapRef = null) {
        if (!previous || !current) return false;
        const numberChanged = (key) => {
            const before = previous[key];
            const after = current[key];
            if (before === null || after === null) return before !== after;
            if (key === "x" && mapRef && typeof mapRef.shortestDeltaX === "function") {
                return Math.abs(mapRef.shortestDeltaX(before, after)) > 0.0001;
            }
            if (key === "y" && mapRef && typeof mapRef.shortestDeltaY === "function") {
                return Math.abs(mapRef.shortestDeltaY(before, after)) > 0.0001;
            }
            return Math.abs(Number(after) - Number(before)) > 0.0001;
        };
        for (const key of ["x", "y", "z", "rotation", "placementRotation", "mountedWallFacingSign"]) {
            if (numberChanged(key)) return true;
        }
        for (const key of ["mountedWallLineGroupId", "mountedSectionId", "mountedWallSectionUnitId"]) {
            if (previous[key] !== current[key]) return true;
        }
        for (const key of ["fragmentId", "surfaceId", "ownerType", "ownerId", "ownerSectionKey"]) {
            if (previous[key] !== current[key]) return true;
        }
        return false;
    }

    function finalizeMovedPrototypeObjectPersistence(dragState) {
        if (!dragState || dragState.prototypePersistenceCaptured === true) return;
        const target = dragState.target || null;
        if (!target || target.gone || target.vanishing || target._prototypeRuntimeRecord !== true) return;
        const mapRef = target.map || dragState.map || null;
        const startSnapshot = dragState.prototypePersistenceStartSnapshot || null;
        const currentSnapshot = getMoveObjectPersistenceSnapshot(target);
        if (!moveObjectPersistenceSnapshotChanged(startSnapshot, currentSnapshot, mapRef)) return;
        markMovedPrototypeObjectDirty(target, mapRef);
    }

    function syncMovedPrototypeOwnerFromSupport(target) {
        if (!target || typeof target !== "object") return;
        const support = target.currentMovementSupport && typeof target.currentMovementSupport === "object"
            ? target.currentMovementSupport
            : null;
        if (!support) return;
        const ownerType = typeof support.ownerType === "string" ? support.ownerType : "";
        const ownerId = typeof support.ownerId === "string" ? support.ownerId : "";
        const sectionKey = typeof support.sectionKey === "string" ? support.sectionKey : "";
        target._prototypeOwnerType = ownerType;
        target._prototypeOwnerId = ownerId;
        target._prototypeOwnerSectionKey = ownerType === "section" ? (ownerId || sectionKey) : "";
        target._prototypeOwnerSignature = ownerType && ownerId ? `${ownerType}:${ownerId}` : "";
    }

    function getMoveObjectSupportLayer(support, fallback = 0) {
        if (support && Number.isFinite(support.layer)) return Math.round(Number(support.layer));
        return Math.round(Number.isFinite(fallback) ? Number(fallback) : 0);
    }

    function getMoveObjectSupportBaseZ(support, fallbackLayer = 0) {
        if (support && Number.isFinite(support.baseZ)) return Number(support.baseZ);
        throw new Error(`moved object support layer ${getMoveObjectSupportLayer(support, fallbackLayer)} requires baseZ`);
    }

    function beginMovedPlacedObjectFloorFall(target, mapRef, result, previousWorldZ) {
        if (!target || !result || !result.nextSupport) return false;
        const nextSupport = result.nextSupport;
        const nextLayer = getMoveObjectSupportLayer(nextSupport, Number(target.currentLayer) || 0);
        const nextBaseZ = getMoveObjectSupportBaseZ(nextSupport, nextLayer);
        const startWorldZ = Number(previousWorldZ);
        const startLocalZ = startWorldZ - nextBaseZ;
        if (!(startLocalZ > 0.0001)) return false;

        target.z = startLocalZ;
        target.prevZ = startLocalZ;
        target.falling = true;
        target._floorFallState = {
            active: true,
            velocityZ: 0,
            gravity: -9,
            fromLayer: getMoveObjectSupportLayer(result.previousSupport, Number(target.currentLayer) || 0),
            fromBaseZ: getMoveObjectSupportBaseZ(result.previousSupport, Number(target.currentLayerBaseZ) || 0),
            targetLayer: nextLayer,
            landingSupport: nextSupport,
            landingBaseZ: nextBaseZ,
            landZ: 0,
            bakeExclusion: null
        };

        if (isPrototypeBuildingMoveObjectTarget(target)) {
            if (!mapRef || typeof mapRef.removePrototypeBuildingObjectFromInteriorBitmap !== "function") {
                throw new Error("placed object floor fall requires map.removePrototypeBuildingObjectFromInteriorBitmap");
            }
            target._floorFallState.bakeExclusion = mapRef.removePrototypeBuildingObjectFromInteriorBitmap(target);
        }
        if (typeof globalThis !== "undefined" && globalThis.activeSimObjects instanceof Set) {
            globalThis.activeSimObjects.add(target);
        }
        return true;
    }

    function validateMovedPlacedObjectSupport(target, mapRef, dragState = null) {
        if (!isMoveObjectPlacedObject(target)) return;
        if (!mapRef || typeof mapRef.validateActorMovementSupport !== "function") return;
        const previousSupport = target.currentMovementSupport && typeof target.currentMovementSupport === "object"
            ? target.currentMovementSupport
            : null;
        if (!previousSupport || previousSupport.type !== "floor") return;
        const previousLayer = getMoveObjectSupportLayer(
            previousSupport,
            Number.isFinite(target.currentLayer) ? Number(target.currentLayer) : 0
        );
        const previousBaseZ = getMoveObjectSupportBaseZ(previousSupport, previousLayer);
        const previousWorldZ = previousBaseZ + (Number.isFinite(target.z) ? Number(target.z) : 0);
        const result = mapRef.validateActorMovementSupport(target, {
            suppressLayerTransition: true,
            markLost: true
        });
        if (!result || result.changed !== true) return;
        syncMovedPrototypeOwnerFromSupport(target);
        const startedFall = beginMovedPlacedObjectFloorFall(target, mapRef, result, previousWorldZ);
        if (typeof target.refreshIndexedNodesFromHitbox === "function") {
            target.refreshIndexedNodesFromHitbox({});
        } else {
            syncMovedObjectNodeState(target, mapRef, dragState);
        }
        markMovedPrototypeObjectDirty(target, mapRef);
        captureMovedPrototypeObjectImmediately(target, mapRef);
        if (dragState) {
            dragState.prototypePersistenceCaptured = true;
        }
        if (dragState && result.nextSupport) {
            dragState.lastMovementSupportChange = {
                previousFragmentId: previousSupport.fragmentId || "",
                nextFragmentId: result.nextSupport.fragmentId || "",
                previousOwner: result.previousOwner || "",
                nextOwner: result.nextOwner || "",
                falling: startedFall
            };
        }
    }

    function finalizeMoveObjectDragSupport(dragState) {
        if (!dragState || dragState.supportFinalized === true) return;
        dragState.supportFinalized = true;
        const target = dragState.target || null;
        const mapRef = target && (target.map || dragState.map) || null;
        validateMovedPlacedObjectSupport(target, mapRef, dragState);
    }

    function isWallMountedMoveSnapCandidate(target) {
        if (!target || target.type !== "placedObject") return false;
        const category = (typeof target.category === "string") ? target.category.trim().toLowerCase() : "";
        return (category === "windows" || category === "doors") && target.rotationAxis === "spatial";
    }

    function isPrototypeBuildingMoveObjectTarget(target) {
        if (!isMoveObjectPlacedObject(target)) return false;
        if (target._prototypeOwnerType === "building") return true;
        const support = target.currentMovementSupport && typeof target.currentMovementSupport === "object"
            ? target.currentMovementSupport
            : null;
        if (support && support.ownerType === "building") return true;
        const fragmentId = typeof target.fragmentId === "string" ? target.fragmentId : "";
        const surfaceId = typeof target.surfaceId === "string" ? target.surfaceId : "";
        return fragmentId.startsWith("building:") || surfaceId.startsWith("building:");
    }

    function beginPrototypeBuildingMoveObjectBakeExclusion(target, mapRef, dragState) {
        if (!isPrototypeBuildingMoveObjectTarget(target)) return;
        if (!mapRef || typeof mapRef.removePrototypeBuildingObjectFromInteriorBitmap !== "function") {
            throw new Error("Cannot move prototype building placed object without map.removePrototypeBuildingObjectFromInteriorBitmap");
        }
        if (!Number.isInteger(Number(target._prototypeRecordId))) {
            if (typeof mapRef.ensurePrototypeObjectRuntimeRecord !== "function") {
                throw new Error("Cannot move fresh prototype building placed object without map.ensurePrototypeObjectRuntimeRecord");
            }
            mapRef.ensurePrototypeObjectRuntimeRecord(target);
        }
        const startMs = isMoveObjectPerfEnabled() ? performance.now() : 0;
        const result = mapRef.removePrototypeBuildingObjectFromInteriorBitmap(target);
        dragState.prototypeBuildingInteriorBitmapExclusionActive = result && result.changed === true;
        dragState.prototypeBuildingInteriorBitmapExclusion = result || null;
        dragState.hadSuppressBuildingRenderCacheDirty = Object.prototype.hasOwnProperty.call(target, "_suppressBuildingRenderCacheDirty");
        dragState.previousSuppressBuildingRenderCacheDirty = target._suppressBuildingRenderCacheDirty;
        target._suppressBuildingRenderCacheDirty = true;
        if (isMoveObjectPerfEnabled()) {
            recordMoveObjectPerf("moveObject.bakeExclusion.begin", {
                targetType: target.type || "",
                ownerId: target._prototypeOwnerId || "",
                recordId: Number.isInteger(Number(target._prototypeRecordId)) ? Number(target._prototypeRecordId) : null,
                changed: !!(result && result.changed)
            }, performance.now() - startMs);
        }
    }

    function restorePrototypeBuildingMoveObjectBakeExclusion(dragState) {
        if (!dragState || !dragState.target) return;
        const target = dragState.target;
        const mapRef = target.map || dragState.map || null;
        if (Object.prototype.hasOwnProperty.call(dragState, "hadSuppressBuildingRenderCacheDirty")) {
            if (dragState.hadSuppressBuildingRenderCacheDirty) {
                target._suppressBuildingRenderCacheDirty = dragState.previousSuppressBuildingRenderCacheDirty;
            } else {
                delete target._suppressBuildingRenderCacheDirty;
            }
        }
        if (!dragState.prototypeBuildingInteriorBitmapExclusionActive) return;
        if (target.gone || target.vanishing) return;
        if (!mapRef || typeof mapRef.restorePrototypeBuildingObjectToInteriorBitmap !== "function") {
            throw new Error("Cannot finish moving prototype building placed object without map.restorePrototypeBuildingObjectToInteriorBitmap");
        }
        const startMs = isMoveObjectPerfEnabled() ? performance.now() : 0;
        const exclusionRef = dragState.prototypeBuildingInteriorBitmapExclusion || target;
        mapRef.restorePrototypeBuildingObjectToInteriorBitmap(exclusionRef);
        target._prototypeInteriorBitmapExcluded = false;
        target._prototypeInteriorBitmapExclusion = null;
        dragState.prototypeBuildingInteriorBitmapExclusionActive = false;
        if (isMoveObjectPerfEnabled()) {
            recordMoveObjectPerf("moveObject.bakeExclusion.restore", {
                targetType: target.type || "",
                ownerId: target._prototypeOwnerId || "",
                recordId: Number.isInteger(Number(target._prototypeRecordId)) ? Number(target._prototypeRecordId) : null
            }, performance.now() - startMs);
        }
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
        if (!isMoveObjectPerfEnabled()) {
            return syncMovedObjectNodeStateImpl(target, mapRef, dragState);
        }
        const startMs = performance.now();
        const beforeNode = dragState && dragState.currentOccupancyNode || null;
        try {
            return syncMovedObjectNodeStateImpl(target, mapRef, dragState);
        } finally {
            recordMoveObjectPerf("moveObject.syncNodeState", {
                targetType: target && target.type || "",
                occupiesNodeObjects: !!(dragState && dragState.occupiesNodeObjects),
                nodeChanged: !!(dragState && dragState.currentOccupancyNode !== beforeNode)
            }, performance.now() - startMs);
        }
    }

    function syncMovedObjectNodeStateImpl(target, mapRef, dragState = null) {
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

    function getMoveObjectDragNumber(target, wizardRef, dragState, key, defaultValue, minValue = 0) {
        const candidates = [
            target && target[key],
            wizardRef && wizardRef[key],
            dragState && dragState[key],
            (typeof globalThis !== "undefined") ? globalThis[key] : undefined
        ];
        for (let i = 0; i < candidates.length; i++) {
            const value = Number(candidates[i]);
            if (Number.isFinite(value)) return Math.max(minValue, value);
        }
        return defaultValue;
    }

    function shouldUseForceMoveObjectDrag(target) {
        if (!target || target.gone || target.vanishing) return false;
        if (target.type === "triggerArea" || target.isTriggerArea === true) return false;
        if (target.type === "prototypeBuildingPlacement") return false;
        if (isWallMountedMoveSnapCandidate(target)) return false;
        return true;
    }

    function shouldUseGodModeMoveObjectDrag(wizardRef) {
        return !!(
            wizardRef &&
            typeof wizardRef.isGodMode === "function" &&
            wizardRef.isGodMode()
        );
    }

    function cloneMoveObjectGroundHitboxAt(target, anchor, candidateX, candidateY, mapRef) {
        const hitbox = target && (target.groundPlaneHitbox || target.visualHitbox || target.hitbox) || null;
        if (!hitbox || !anchor) return null;
        const dx = (typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(anchor.x, candidateX)
            : (candidateX - anchor.x);
        const dy = (typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(anchor.y, candidateY)
            : (candidateY - anchor.y);
        if (hitbox.type === "circle") {
            const center = wrapWorldPointForMap(mapRef, Number(hitbox.x) + dx, Number(hitbox.y) + dy);
            return { type: "circle", x: center.x, y: center.y, radius: Math.max(0, Number(hitbox.radius) || 0) };
        }
        if (Array.isArray(hitbox.points) && hitbox.points.length >= 3) {
            return {
                type: "polygon",
                points: translatePointArray(hitbox.points, dx, dy, mapRef)
            };
        }
        return null;
    }

    function getMoveObjectHitboxBounds(hitbox) {
        if (!hitbox) return null;
        if (typeof hitbox.getBounds === "function") return hitbox.getBounds();
        if (hitbox.type === "circle") {
            const radius = Math.max(0, Number(hitbox.radius) || 0);
            return { x: Number(hitbox.x) - radius, y: Number(hitbox.y) - radius, width: radius * 2, height: radius * 2 };
        }
        if (Array.isArray(hitbox.points) && hitbox.points.length >= 3) {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (let i = 0; i < hitbox.points.length; i++) {
                const x = Number(hitbox.points[i] && hitbox.points[i].x);
                const y = Number(hitbox.points[i] && hitbox.points[i].y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
            if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
                return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
            }
        }
        return null;
    }

    function moveObjectBoundsOverlap(a, b, padding = 0) {
        if (!a || !b) return true;
        return !(
            a.x + a.width + padding < b.x ||
            b.x + b.width + padding < a.x ||
            a.y + a.height + padding < b.y ||
            b.y + b.height + padding < a.y
        );
    }

    function getMoveObjectLayer(target) {
        if (Number.isFinite(target && target.traversalLayer)) return Math.round(Number(target.traversalLayer));
        if (Number.isFinite(target && target.currentLayer)) return Math.round(Number(target.currentLayer));
        if (Number.isFinite(target && target.level)) return Math.round(Number(target.level));
        if (Number.isFinite(target && target.node && target.node.traversalLayer)) return Math.round(Number(target.node.traversalLayer));
        if (Number.isFinite(target && target.node && target.node.level)) return Math.round(Number(target.node.level));
        return 0;
    }

    function doesMoveObjectBlockerApplyToLayer(blocker, targetLayer) {
        if (!blocker) return false;
        const blockerLayer = getMoveObjectLayer(blocker);
        return blockerLayer === targetLayer;
    }

    function doesObjectBlockMoveObjectDrag(obj) {
        if (!obj || obj.gone || obj.vanishing) return false;
        if (!(obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox)) return false;
        if (typeof globalThis !== "undefined" && typeof globalThis.doesObjectBlockPassage === "function") {
            return !!globalThis.doesObjectBlockPassage(obj);
        }
        if (obj.type === "wallSection") return true;
        return obj.isPassable === false || obj.blocksTile === true;
    }

    function collectMoveObjectCollisionBlockers(target, mapRef, fromAnchor, toAnchor) {
        const blockers = [];
        const seen = new Set();
        if (!target || !mapRef || !fromAnchor || !toAnchor) return blockers;
        const targetLayer = getMoveObjectLayer(target);
        const currentHitbox = cloneMoveObjectGroundHitboxAt(target, fromAnchor, fromAnchor.x, fromAnchor.y, mapRef);
        const targetHitbox = cloneMoveObjectGroundHitboxAt(target, fromAnchor, toAnchor.x, toAnchor.y, mapRef);
        const currentBounds = getMoveObjectHitboxBounds(currentHitbox);
        const targetBounds = getMoveObjectHitboxBounds(targetHitbox);
        const minX = Math.min(
            Number(currentBounds && currentBounds.x) || fromAnchor.x,
            Number(targetBounds && targetBounds.x) || toAnchor.x,
            fromAnchor.x,
            toAnchor.x
        ) - 1.5;
        const minY = Math.min(
            Number(currentBounds && currentBounds.y) || fromAnchor.y,
            Number(targetBounds && targetBounds.y) || toAnchor.y,
            fromAnchor.y,
            toAnchor.y
        ) - 1.5;
        const maxX = Math.max(
            Number(currentBounds && (currentBounds.x + currentBounds.width)) || fromAnchor.x,
            Number(targetBounds && (targetBounds.x + targetBounds.width)) || toAnchor.x,
            fromAnchor.x,
            toAnchor.x
        ) + 1.5;
        const maxY = Math.max(
            Number(currentBounds && (currentBounds.y + currentBounds.height)) || fromAnchor.y,
            Number(targetBounds && (targetBounds.y + targetBounds.height)) || toAnchor.y,
            fromAnchor.y,
            toAnchor.y
        ) + 1.5;
        const queryBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        const blockerQueryBounds = { minX, minY, maxX, maxY };

        const addBlocker = (obj) => {
            if (!obj || obj === target || seen.has(obj)) return;
            if (!doesObjectBlockMoveObjectDrag(obj)) return;
            if (!doesMoveObjectBlockerApplyToLayer(obj, targetLayer)) return;
            const hitbox = obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox || null;
            if (!hitbox) return;
            const bounds = getMoveObjectHitboxBounds(hitbox);
            if (!moveObjectBoundsOverlap(queryBounds, bounds, 0.5)) return;
            seen.add(obj);
            blockers.push(obj);
        };

        const addNodeObjects = (node) => {
            if (!node || !Array.isArray(node.objects)) return;
            for (let i = 0; i < node.objects.length; i++) addBlocker(node.objects[i]);
        };

        if (typeof mapRef.worldToNode === "function" && typeof mapRef.getNodesInIndexWindow === "function") {
            const cornerNodes = [
                mapRef.worldToNode(minX, minY),
                mapRef.worldToNode(maxX, minY),
                mapRef.worldToNode(minX, maxY),
                mapRef.worldToNode(maxX, maxY)
            ].filter(Boolean);
            if (cornerNodes.length > 0) {
                const xIndices = cornerNodes.map(node => Number(node.xindex)).filter(Number.isFinite);
                const yIndices = cornerNodes.map(node => Number(node.yindex)).filter(Number.isFinite);
                if (xIndices.length && yIndices.length) {
                    const nodes = mapRef.getNodesInIndexWindow(
                        Math.min(...xIndices) - 1,
                        Math.max(...xIndices) + 1,
                        Math.min(...yIndices) - 1,
                        Math.max(...yIndices) + 1
                    );
                    for (let i = 0; i < nodes.length; i++) addNodeObjects(nodes[i]);
                }
            }
        }

        if (target.node) {
            addNodeObjects(target.node);
            if (Array.isArray(target.node.neighbors)) {
                for (let i = 0; i < target.node.neighbors.length; i++) addNodeObjects(target.node.neighbors[i]);
            }
        }

        const WallCtor = (typeof globalThis !== "undefined") ? globalThis.WallSectionUnit : null;
        if (WallCtor && WallCtor._allSections instanceof Map) {
            for (const wall of WallCtor._allSections.values()) addBlocker(wall);
        }

        if (typeof mapRef.collectPrototypeBuildingMovementBlockersInBounds === "function") {
            const buildingBlockers = mapRef.collectPrototypeBuildingMovementBlockersInBounds(
                blockerQueryBounds,
                targetLayer
            );
            if (!Array.isArray(buildingBlockers)) {
                throw new Error("move object collision expected collectPrototypeBuildingMovementBlockersInBounds to return an array");
            }
            for (let i = 0; i < buildingBlockers.length; i++) addBlocker(buildingBlockers[i]);
        }

        return blockers;
    }

    function resolveMoveObjectCollisionAt(target, anchor, candidateX, candidateY, mapRef, blockers) {
        const probe = cloneMoveObjectGroundHitboxAt(target, anchor, candidateX, candidateY, mapRef);
        if (!probe) return null;
        let totalPushX = 0;
        let totalPushY = 0;
        let maxPushLen = 0;
        for (let i = 0; i < blockers.length; i++) {
            const blocker = blockers[i];
            const hitbox = blocker && (blocker.groundPlaneHitbox || blocker.visualHitbox || blocker.hitbox) || null;
            if (!hitbox) continue;
            let collision = null;
            if (typeof hitbox.intersects === "function") collision = hitbox.intersects(probe);
            if (!collision && typeof probe.intersects === "function") collision = probe.intersects(hitbox);
            if (!collision || collision.pushX === undefined) continue;
            let pushX = Number(collision.pushX) || 0;
            let pushY = Number(collision.pushY) || 0;
            if (Math.hypot(pushX, pushY) <= 1e-9) {
                const bounds = getMoveObjectHitboxBounds(hitbox);
                const centerX = bounds ? bounds.x + bounds.width * 0.5 : Number(blocker.x);
                const centerY = bounds ? bounds.y + bounds.height * 0.5 : Number(blocker.y);
                const dx = candidateX - centerX;
                const dy = candidateY - centerY;
                const len = Math.hypot(dx, dy) || 1;
                pushX = dx / len * 0.05;
                pushY = dy / len * 0.05;
            }
            totalPushX += pushX;
            totalPushY += pushY;
            maxPushLen = Math.max(maxPushLen, Math.hypot(pushX, pushY));
        }
        const pushLen = Math.hypot(totalPushX, totalPushY);
        if (!(pushLen > 0)) return null;
        if (pushLen > maxPushLen && maxPushLen > 0) {
            const scale = maxPushLen / pushLen;
            totalPushX *= scale;
            totalPushY *= scale;
        }
        const resolvedPushLen = Math.hypot(totalPushX, totalPushY);
        if (!(resolvedPushLen > 0)) return null;
        return {
            pushX: totalPushX,
            pushY: totalPushY,
            normalX: totalPushX / resolvedPushLen,
            normalY: totalPushY / resolvedPushLen,
            overlap: resolvedPushLen
        };
    }

    function resolveMoveObjectForceStep(target, fromAnchor, candidateAnchor, mapRef, dragState) {
        const blockers = collectMoveObjectCollisionBlockers(target, mapRef, fromAnchor, candidateAnchor);
        if (!blockers.length) return { x: candidateAnchor.x, y: candidateAnchor.y, collided: false };
        const dx = (typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(fromAnchor.x, candidateAnchor.x)
            : (candidateAnchor.x - fromAnchor.x);
        const dy = (typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(fromAnchor.y, candidateAnchor.y)
            : (candidateAnchor.y - fromAnchor.y);
        const distance = Math.hypot(dx, dy);
        if (!(distance > 1e-8)) {
            const collision = resolveMoveObjectCollisionAt(target, fromAnchor, fromAnchor.x, fromAnchor.y, mapRef, blockers);
            if (!collision) return { x: candidateAnchor.x, y: candidateAnchor.y, collided: false };
            return {
                x: fromAnchor.x + collision.normalX * Math.min(0.08, collision.overlap + 0.005),
                y: fromAnchor.y + collision.normalY * Math.min(0.08, collision.overlap + 0.005),
                collided: true,
                normalX: collision.normalX,
                normalY: collision.normalY
            };
        }
        const stepSize = Math.max(0.04, Math.min(0.18, Number(target.groundRadius) > 0 ? Number(target.groundRadius) * 0.35 : 0.08));
        const steps = Math.min(48, Math.max(1, Math.ceil(distance / stepSize)));
        let lastClearX = fromAnchor.x;
        let lastClearY = fromAnchor.y;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const sample = wrapWorldPointForMap(mapRef, fromAnchor.x + dx * t, fromAnchor.y + dy * t);
            const collision = resolveMoveObjectCollisionAt(target, fromAnchor, sample.x, sample.y, mapRef, blockers);
            if (!collision) {
                lastClearX = sample.x;
                lastClearY = sample.y;
                continue;
            }
            const backoff = Math.max(0.005, Math.min(0.03, collision.overlap + 0.005));
            const resolved = wrapWorldPointForMap(
                mapRef,
                lastClearX + collision.normalX * backoff,
                lastClearY + collision.normalY * backoff
            );
            const velocityX = Number(dragState && dragState.velocityX) || 0;
            const velocityY = Number(dragState && dragState.velocityY) || 0;
            const intoWall = velocityX * collision.normalX + velocityY * collision.normalY;
            if (dragState && intoWall < 0) {
                dragState.velocityX = velocityX - collision.normalX * intoWall;
                dragState.velocityY = velocityY - collision.normalY * intoWall;
            }
            return {
                x: resolved.x,
                y: resolved.y,
                collided: true,
                normalX: collision.normalX,
                normalY: collision.normalY
            };
        }
        return { x: candidateAnchor.x, y: candidateAnchor.y, collided: false };
    }

    function applyMoveObjectForceDragStep(target, desiredX, desiredY, wizardRef, dragState) {
        const mapRef = target && (target.map || wizardRef.map) || null;
        const anchor = getMoveObjectAnchorPoint(target);
        if (!target || !mapRef || !anchor || !Number.isFinite(desiredX) || !Number.isFinite(desiredY)) return false;
        const wrappedDesired = wrapWorldPointForMap(mapRef, desiredX, desiredY);
        const dx = (typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(anchor.x, wrappedDesired.x)
            : (wrappedDesired.x - anchor.x);
        const dy = (typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(anchor.y, wrappedDesired.y)
            : (wrappedDesired.y - anchor.y);
        const distance = Math.hypot(dx, dy);
        const nowMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
            ? performance.now()
            : null;
        const globalFrameRate = (typeof frameRate !== "undefined")
            ? frameRate
            : ((typeof globalThis !== "undefined") ? globalThis.frameRate : 60);
        const fallbackDt = 1 / Math.max(1, Number(globalFrameRate) || 60);
        const previousMs = Number(dragState && dragState.lastForceUpdateMs);
        let dt = Number.isFinite(nowMs) && Number.isFinite(previousMs)
            ? Math.max(0, (nowMs - previousMs) / 1000)
            : fallbackDt;
        // Keep long stalls from becoming one giant impulse that can overwhelm the sweep.
        dt = Math.min(1 / 20, dt);
        if (dragState) dragState.lastForceUpdateMs = Number.isFinite(nowMs) ? nowMs : previousMs;

        let velocityX = Number(dragState && dragState.velocityX) || 0;
        let velocityY = Number(dragState && dragState.velocityY) || 0;
        if (distance > 1e-6) {
            const strength = getMoveObjectDragNumber(target, wizardRef, dragState, "moveObjectForceStrength", 90, 0);
            const falloffDistance = getMoveObjectDragNumber(target, wizardRef, dragState, "moveObjectForceFalloffDistance", 3, 0.001);
            const forceScale = Math.min(1, distance / falloffDistance);
            velocityX += (dx / distance) * strength * forceScale * dt;
            velocityY += (dy / distance) * strength * forceScale * dt;
        }
        const damping = getMoveObjectDragNumber(target, wizardRef, dragState, "moveObjectForceDamping", 5.5, 0);
        const dampingFactor = Math.exp(-damping * dt);
        velocityX *= dampingFactor;
        velocityY *= dampingFactor;
        const maxSpeed = getMoveObjectDragNumber(target, wizardRef, dragState, "moveObjectMaxSpeed", 10, 0.01);
        const speed = Math.hypot(velocityX, velocityY);
        if (speed > maxSpeed) {
            const scale = maxSpeed / speed;
            velocityX *= scale;
            velocityY *= scale;
        }

        if (dragState) {
            dragState.velocityX = velocityX;
            dragState.velocityY = velocityY;
        }
        if (Math.hypot(velocityX, velocityY) < 0.001 && distance < 0.01) return true;

        const candidateAnchor = wrapWorldPointForMap(mapRef, anchor.x + velocityX * dt, anchor.y + velocityY * dt);
        const resolved = resolveMoveObjectForceStep(target, anchor, candidateAnchor, mapRef, dragState);
        if (resolved && resolved.collided && dragState) {
            dragState.lastCollisionNormalX = resolved.normalX;
            dragState.lastCollisionNormalY = resolved.normalY;
        }
        return applyMoveObjectTargetPosition(
            target,
            resolved ? resolved.x : candidateAnchor.x,
            resolved ? resolved.y : candidateAnchor.y,
            dragState
        );
    }

    function applyMoveObjectTargetPosition(target, targetX, targetY, dragState = null) {
        if (!isMoveObjectPerfEnabled()) {
            return applyMoveObjectTargetPositionImpl(target, targetX, targetY, dragState);
        }
        const startMs = performance.now();
        try {
            return applyMoveObjectTargetPositionImpl(target, targetX, targetY, dragState);
        } finally {
            recordMoveObjectPerf("moveObject.applyTargetPosition", {
                targetType: target && target.type || "",
                x: Number.isFinite(target && target.x) ? Number(target.x) : null,
                y: Number.isFinite(target && target.y) ? Number(target.y) : null,
                desiredX: Number.isFinite(targetX) ? Number(targetX) : null,
                desiredY: Number.isFinite(targetY) ? Number(targetY) : null
            }, performance.now() - startMs);
        }
    }

    function applyMoveObjectTargetPositionImpl(target, targetX, targetY, dragState = null) {
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

        if (target.type === "prototypeBuildingPlacement") {
            if (typeof mapRef.updatePrototypeBuildingPlacementTransform !== "function") {
                throw new Error(`cannot move prototype building placement ${target.buildingPlacementId || target.id} without map.updatePrototypeBuildingPlacementTransform`);
            }
            const placementTransform = target.placement && target.placement.transform ? target.placement.transform : {};
            const currentOriginX = Number(placementTransform.x);
            const currentOriginY = Number(placementTransform.y);
            if (!Number.isFinite(currentOriginX) || !Number.isFinite(currentOriginY)) {
                throw new Error(`cannot move prototype building placement ${target.buildingPlacementId || target.id} without a finite placement origin`);
            }
            const movedOrigin = wrapWorldPointForMap(mapRef, currentOriginX + dx, currentOriginY + dy);
            const currentRotation = Number.isFinite(target.placementRotation)
                ? Number(target.placementRotation)
                : (Number.isFinite(target.rotation)
                    ? Number(target.rotation)
                    : Number(target.placement && target.placement.transform && target.placement.transform.rotation) || 0);
            const placement = mapRef.updatePrototypeBuildingPlacementTransform(
                target.buildingPlacementId || target.id,
                {
                    x: movedOrigin.x,
                    y: movedOrigin.y,
                    rotation: currentRotation
                }
            );
            target.placement = placement;
            target.x = wrappedTarget.x;
            target.y = wrappedTarget.y;
            target.rotation = Number(placement.transform.rotation) || 0;
            target.placementRotation = target.rotation;
            target.gone = false;
            return true;
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

        const dragState = {
            target,
            map: mapRef,
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
            currentOccupancyNode: target.node || null,
            velocityX: 0,
            velocityY: 0,
            prototypePersistenceStartSnapshot: getMoveObjectPersistenceSnapshot(target),
            prototypePersistenceCaptured: false,
            lastForceUpdateMs: (
                typeof performance !== "undefined" &&
                performance &&
                typeof performance.now === "function"
            ) ? performance.now() : null
        };
        beginPrototypeBuildingMoveObjectBakeExclusion(target, mapRef, dragState);
        wizardRef.moveObjectDragState = dragState;
        recordMoveObjectPerf("moveObject.drag.begin", {
            targetType: target.type || "",
            ownerId: target._prototypeOwnerId || "",
            recordId: Number.isInteger(Number(target._prototypeRecordId)) ? Number(target._prototypeRecordId) : null,
            x: Number.isFinite(target.x) ? Number(target.x) : null,
            y: Number.isFinite(target.y) ? Number(target.y) : null,
            nodeObjects: !!dragState.occupiesNodeObjects
        });
        return true;
    }

    function updateMoveObjectDrag(wizardRef, worldX, worldY) {
        if (!isMoveObjectPerfEnabled()) {
            return updateMoveObjectDragImpl(wizardRef, worldX, worldY);
        }
        const startMs = performance.now();
        try {
            return updateMoveObjectDragImpl(wizardRef, worldX, worldY);
        } finally {
            const target = wizardRef && wizardRef.moveObjectDragState && wizardRef.moveObjectDragState.target;
            recordMoveObjectPerf("moveObject.drag.update", {
                targetType: target && target.type || "",
                worldX: Number.isFinite(worldX) ? Number(worldX) : null,
                worldY: Number.isFinite(worldY) ? Number(worldY) : null,
                targetX: Number.isFinite(target && target.x) ? Number(target.x) : null,
                targetY: Number.isFinite(target && target.y) ? Number(target.y) : null
            }, performance.now() - startMs);
        }
    }

    function updateMoveObjectDragImpl(wizardRef, worldX, worldY) {
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
        if (shouldUseGodModeMoveObjectDrag(wizardRef)) {
            dragState.velocityX = 0;
            dragState.velocityY = 0;
            return applyMoveObjectTargetPosition(target, desired.x, desired.y, dragState);
        }
        if (shouldUseForceMoveObjectDrag(target)) {
            return applyMoveObjectForceDragStep(target, desired.x, desired.y, wizardRef, dragState);
        }
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

        const worldToScreenFn = (typeof worldToScreen === "function") ? worldToScreen : null;
        const mouseScreen = (
            typeof mousePos !== "undefined" &&
            mousePos &&
            Number.isFinite(mousePos.screenX) &&
            Number.isFinite(mousePos.screenY)
        ) ? { x: mousePos.screenX, y: mousePos.screenY } : (worldToScreenFn ? worldToScreenFn({ x: worldX, y: worldY }) : null);
        if (!mouseScreen || !Number.isFinite(mouseScreen.x) || !Number.isFinite(mouseScreen.y)) return null;
        if (!worldToScreenFn) return null;

        const pickResult = pickObjectViaRenderingColorId((obj) =>
            !!(obj && obj.type === "wallSection" && !obj.gone && !obj.vanishing)
        );
        if (!pickResult || !pickResult.picked || pickResult.picked.type !== "wallSection") return null;

        const placementApi = (typeof globalThis !== "undefined") ? globalThis.PlaceObjectPlacement : null;
        if (!placementApi || typeof placementApi.resolveWallMountedPlacementCandidate !== "function") {
            throw new Error("missing shared wall-mounted place object placement helper");
        }
        return placementApi.resolveWallMountedPlacementCandidate({
            section: pickResult.picked,
            category,
            worldX,
            worldY,
            mouseScreen,
            worldToScreenFn,
            viewscale: (typeof viewscale !== "undefined" && Number.isFinite(viewscale)) ? viewscale : 1,
            xyratio: (typeof xyratio !== "undefined" && Number.isFinite(xyratio)) ? xyratio : 0.66,
            mapRef: wizardRef.map,
            placeableScale: Number.isFinite(wizardRef.selectedPlaceableScale)
                ? Number(wizardRef.selectedPlaceableScale)
                : 1,
            scaleMin: Number.isFinite(wizardRef.selectedPlaceableScaleMin) ? wizardRef.selectedPlaceableScaleMin : 0.2,
            scaleMax: Number.isFinite(wizardRef.selectedPlaceableScaleMax) ? wizardRef.selectedPlaceableScaleMax : 5,
            anchorY: Number.isFinite(wizardRef.selectedPlaceableAnchorY)
                ? Number(wizardRef.selectedPlaceableAnchorY)
                : 1
        });
    }

    function getRoofPlacementCandidate(wizardRef, worldX, worldY) {
        const roofApi = (typeof globalThis !== "undefined" && globalThis.Roof) ? globalThis.Roof : null;
        if (!roofApi || typeof roofApi.getPlacementCandidate !== "function") return null;
        return roofApi.getPlacementCandidate(wizardRef, worldX, worldY, { maxDepth: null });
    }

    function beginDragSpell(wizardRef, spellName, worldX, worldY) {
        if (!wizardRef || wizardRef.castDelay) return false;
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
            const mapRef = wizardRef.map || null;
            if (isDragSpellActive(wizardRef, "buildroad")) {
                ensureDragPreview(wizardRef, "buildroad");
                return true;
            }
            const startPoint = getRoadPathPlacementPoint(wizardRef, worldX, worldY, snapTarget);
            if (!startPoint) return false;
            wizardRef.roadLayoutMode = true;
            wizardRef.roadStartPoint = startPoint;
            wizardRef.roadPathDraft = {
                points: [startPoint],
                width: getSelectedRoadWidth(wizardRef),
                fillTexturePath: getSelectedFlooringTexture(wizardRef)
            };
            ensureDragPreview(wizardRef, "buildroad");
            return true;
        }

        if (spellName === "firewall") {
            if (!keysPressed[" "]) return false;
            wizardRef.firewallLayoutMode = true;
            wizardRef.firewallStartPoint = (snapTarget && snapTarget.point)
                ? { x: snapTarget.point.x, y: snapTarget.point.y }
                : { x: worldX, y: worldY };
            ensureDragPreview(wizardRef, "firewall");
            return true;
        }

        if (isMoveObjectToolName(spellName)) {
            if (!keysPressed[" "]) return false;
            return beginMoveObjectDrag(wizardRef, worldX, worldY);
        }

        if (isVanishToolName(spellName)) {
            if (!keysPressed[" "]) return false;
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
            if (wizardRef.currentSpell === "firewall") cancelDragSpell(wizardRef, "firewall");
            if (isMoveObjectToolName(wizardRef.currentSpell)) cancelDragSpell(wizardRef, wizardRef.currentSpell);
            if (isVanishToolName(wizardRef.currentSpell)) cancelDragSpell(wizardRef, wizardRef.currentSpell);
            if (wizardRef.currentSpell !== "buildroad") return false;
        }
        if (wizardRef.currentSpell === "wall" && wizardRef.wallLayoutMode && wizardRef.wallStartPoint) {
            const adjustedPoint = getAdjustedWallDragWorldPoint(wizardRef, worldX, worldY);
            if (!adjustedPoint) return false;
            return true;
        }
        if (wizardRef.currentSpell === "buildroad" && isDragSpellActive(wizardRef, "buildroad")) {
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
            const mapRef = wizardRef.map || null;
            const snapTarget = getDragStartSnapTargetAt(wizardRef, "buildroad", worldX, worldY);
            const nextPoint = getRoadPathPlacementPoint(wizardRef, worldX, worldY, snapTarget);
            const draft = wizardRef.roadPathDraft;
            const points = getRoadPathDraftPoints(wizardRef);
            if (
                !draft ||
                !nextPoint ||
                points.length < 1 ||
                !Number.isFinite(nextPoint.x) ||
                !Number.isFinite(nextPoint.y)
            ) {
                cancelDragSpell(wizardRef, "buildroad");
                return true;
            }
            const lastPoint = points[points.length - 1];
            const width = Number.isFinite(draft.width) ? Number(draft.width) : getSelectedRoadWidth(wizardRef);
            const selectedFlooring = draft.fillTexturePath || getSelectedFlooringTexture(wizardRef);
            if (pointsMatchWorld(mapRef, lastPoint, nextPoint, 1e-5)) {
                if (points.length >= 2) {
                    if (typeof RoadPath !== "function") {
                        throw new Error("Cannot place path road because RoadPath is unavailable.");
                    }
                    new RoadPath(points, mapRef, {
                        width,
                        fillTexturePath: selectedFlooring
                    });
                    if (!editorMode) {
                        wizardRef.magic -= 5;
                    }
                    cancelDragSpell(wizardRef, "buildroad");
                    cooldown(wizardRef, wizardRef.cooldownTime);
                }
                return true;
            }
            if (typeof RoadPath !== "function") {
                throw new Error("Cannot place path road because RoadPath is unavailable.");
            }
            const proposedPoints = points.concat(nextPoint);
            try {
                RoadPath.computeGeometry(proposedPoints, width);
            } catch (error) {
                const errorMessage = error && error.message ? error.message : "Road path point is not valid.";
                message(`${errorMessage}. Add another point to make the turn gentler.`);
                return true;
            }
            draft.points = proposedPoints;
            wizardRef.roadStartPoint = proposedPoints[0];
            ensureDragPreview(wizardRef, "buildroad");
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
    const _touchScriptObjectsByArray = new WeakMap();

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

        const _t0 = performance.now();
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
        const _t1 = performance.now();

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
        const _t2 = performance.now();

        const runtimeScriptObjects = (wizardRef.map && typeof wizardRef.map.getGameObjects === "function")
            ? (wizardRef.map.getGameObjects({ refresh: false }) || [])
            : [];
        let touchScriptObjects = _touchScriptObjectsByArray.get(runtimeScriptObjects);
        if (!touchScriptObjects) {
            touchScriptObjects = [];
            for (let i = 0; i < runtimeScriptObjects.length; i++) {
                const obj = runtimeScriptObjects[i];
                if (!obj) continue;
                if (obj.type === "triggerArea" || obj.isTriggerArea === true) continue;
                const hitbox = obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox || null;
                if (!hitbox) continue;
                const hasTouchScript = (
                    (typeof globalThis !== "undefined" && globalThis.Scripting && typeof globalThis.Scripting.hasEventScriptForTarget === "function")
                        ? (globalThis.Scripting.hasEventScriptForTarget(obj, "playerTouches") || globalThis.Scripting.hasEventScriptForTarget(obj, "playerUntouches"))
                        : false
                );
                if (!hasTouchScript) continue;
                touchScriptObjects.push(obj);
            }
            _touchScriptObjectsByArray.set(runtimeScriptObjects, touchScriptObjects);
        }
        for (let i = 0; i < touchScriptObjects.length; i++) {
            const obj = touchScriptObjects[i];
            if (!obj || obj === wizardRef || obj.gone || obj.vanishing) continue;
            if (nearbyScriptObjects.has(obj)) continue;
            if (obj.map && wizardRef.map && obj.map !== wizardRef.map) continue;
            const hitbox = obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox || null;
            if (!hitbox) continue;
            const forceTouch = !!(forceTouchedObjects && forceTouchedObjects.has(obj));
            nearbyScriptEntries.push({ obj, hitbox, forceTouch });
            nearbyScriptObjects.add(obj);
        }
        const _t3 = performance.now();

        if (wizardRef.map && typeof wizardRef.map.getPrototypeActiveTriggerTraversalEntriesForActor === "function") {
            const triggerEntries = wizardRef.map.getPrototypeActiveTriggerTraversalEntriesForActor(wizardRef, {
                fromX,
                fromY,
                toX,
                toY
            });
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
        const _t4 = performance.now();

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
        const _t5 = performance.now();

        if (typeof simPerfBreakdown !== "undefined") {
            simPerfBreakdown.spellNearbyMs += _t1 - _t0;
            simPerfBreakdown.spellPowerupsMs += _t2 - _t1;
            simPerfBreakdown.spellRuntimeMs += _t3 - _t2;
            simPerfBreakdown.spellTriggerMs += _t4 - _t3;
            simPerfBreakdown.spellProcessMs += _t5 - _t4;
        }
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
            const baseZ = getFloorEditorBaseZ(wizardRef, fragment, "floor editor vertex selection");
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

    function getFloorEditSectionGeometryApi() {
        const api = (typeof globalThis !== "undefined") ? globalThis.__sectionGeometry : null;
        if (!api || typeof api.resolvePrototypeSectionCoordForWorldPosition !== "function" || typeof api.makeSectionKey !== "function") {
            return null;
        }
        return api;
    }

    function getFloorEditSectionKeyForWorldPoint(mapRef, worldX, worldY) {
        const state = mapRef && mapRef._prototypeSectionState ? mapRef._prototypeSectionState : null;
        if (!state || !(state.sectionAssetsByKey instanceof Map)) return "";
        const sectionGeometryApi = getFloorEditSectionGeometryApi();
        if (!sectionGeometryApi) return "";
        const coord = sectionGeometryApi.resolvePrototypeSectionCoordForWorldPosition(state, worldX, worldY);
        const sectionKey = coord ? sectionGeometryApi.makeSectionKey(coord) : "";
        return sectionKey && state.sectionAssetsByKey.has(sectionKey) ? sectionKey : "";
    }

    function getClosestFloorEditSegmentPoint(point, a, b) {
        const px = Number(point && point.x);
        const py = Number(point && point.y);
        const ax = Number(a && a.x);
        const ay = Number(a && a.y);
        const bx = Number(b && b.x);
        const by = Number(b && b.y);
        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
            return null;
        }
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (!(lenSq > 0)) {
            return { x: ax, y: ay, distanceSq: ((px - ax) * (px - ax)) + ((py - ay) * (py - ay)) };
        }
        const t = Math.max(0, Math.min(1, (((px - ax) * dx) + ((py - ay) * dy)) / lenSq));
        const x = ax + dx * t;
        const y = ay + dy * t;
        return { x, y, distanceSq: ((px - x) * (px - x)) + ((py - y) * (py - y)) };
    }

    function getClosestFloorEditPolygonBoundaryPoint(point, polygon) {
        if (!Array.isArray(polygon) || polygon.length < 2) return null;
        let best = null;
        for (let i = 0; i < polygon.length; i++) {
            const candidate = getClosestFloorEditSegmentPoint(point, polygon[i], polygon[(i + 1) % polygon.length]);
            if (!candidate) continue;
            if (!best || candidate.distanceSq < best.distanceSq) best = candidate;
        }
        return best;
    }

    function getFloorEditSectionBoundaryEpsilon() {
        return 1e-5;
    }

    function isFloorEditPointOnSectionBoundary(asset, state, point, epsilon = getFloorEditSectionBoundaryEpsilon()) {
        if (!asset || !state || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
        const polygon = getFloorEditSectionPolygon(asset, state.basis);
        if (!Array.isArray(polygon) || polygon.length < 3) return false;
        const closest = getClosestFloorEditPolygonBoundaryPoint(point, polygon);
        return !!closest && closest.distanceSq <= epsilon * epsilon;
    }

    function clampFloorEditPointToSection(asset, state, point) {
        const x = Number(point && point.x);
        const y = Number(point && point.y);
        if (!asset || !state || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        const polygon = getFloorEditSectionPolygon(asset, state.basis);
        if (!Array.isArray(polygon) || polygon.length < 3) return null;
        if (pointInOrOnFloorEditPolygon2D(x, y, polygon)) return { x, y };
        const closest = getClosestFloorEditPolygonBoundaryPoint({ x, y }, polygon);
        return closest ? { x: closest.x, y: closest.y } : null;
    }

    function getFloorEditBoundarySectionKeysForPoint(mapRef, point) {
        const state = mapRef && mapRef._prototypeSectionState ? mapRef._prototypeSectionState : null;
        const out = [];
        if (!state || !(state.sectionAssetsByKey instanceof Map) || !point) return out;
        for (const [sectionKey, asset] of state.sectionAssetsByKey.entries()) {
            if (isFloorEditPointOnSectionBoundary(asset, state, point)) out.push(sectionKey);
        }
        return out;
    }

    function getFloorEditSectionAsset(mapRef, sectionKey) {
        const state = mapRef && mapRef._prototypeSectionState ? mapRef._prototypeSectionState : null;
        if (!sectionKey || !state || !(state.sectionAssetsByKey instanceof Map)) return null;
        return state.sectionAssetsByKey.get(sectionKey) || null;
    }

    function getFloorEditorSnapVertexAtScreenPoint(wizardRef, screenX, screenY, options = {}) {
        if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
        const exclude = options && options.exclude ? options.exclude : null;
        const fragments = getEditableFloorEditorFragments(wizardRef);
        let hit = null;
        let bestDistanceSq = TRIGGER_AREA_VERTEX_SELECT_DISTANCE_PX * TRIGGER_AREA_VERTEX_SELECT_DISTANCE_PX;
        for (let i = 0; i < fragments.length; i++) {
            const fragment = fragments[i];
            const baseZ = getFloorEditorBaseZ(wizardRef, fragment, "floor editor snap selection");
            const rings = getFloorEditorRingsForFragment(fragment);
            for (let r = 0; r < rings.length; r++) {
                const ring = rings[r];
                for (let j = 0; j < ring.points.length; j++) {
                    if (
                        exclude &&
                        exclude.fragmentId === fragment.fragmentId &&
                        exclude.ringKind === ring.ringKind &&
                        Number(exclude.holeIndex) === Number(ring.holeIndex) &&
                        Number(exclude.vertexIndex) === j
                    ) {
                        continue;
                    }
                    const screenPoint = floorEditorWorldToScreen(ring.points[j], baseZ);
                    if (!screenPoint || !Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) continue;
                    const dx = Number(screenPoint.x) - Number(screenX);
                    const dy = Number(screenPoint.y) - Number(screenY);
                    const distanceSq = (dx * dx) + (dy * dy);
                    if (distanceSq > bestDistanceSq) continue;
                    bestDistanceSq = distanceSq;
                    hit = {
                        fragmentId: fragment.fragmentId,
                        ringKind: ring.ringKind,
                        holeIndex: ring.holeIndex,
                        vertexIndex: j,
                        distanceSq
                    };
                }
            }
        }
        if (!hit) return null;
        const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
        const fragment = mapRef && mapRef.floorsById instanceof Map
            ? mapRef.floorsById.get(hit.fragmentId)
            : null;
        if (!fragment) return null;
        const ring = getFloorEditorRingFromFragment(fragment, hit.ringKind, hit.holeIndex);
        if (!Array.isArray(ring)) return null;
        const point = ring[hit.vertexIndex];
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
        const snapPoint = { x: Number(point.x), y: Number(point.y) };
        return {
            ...hit,
            x: snapPoint.x,
            y: snapPoint.y,
            fragment,
            surfaceId: typeof fragment.surfaceId === "string" ? fragment.surfaceId : "",
            ownerSectionKey: typeof fragment.ownerSectionKey === "string" ? fragment.ownerSectionKey : "",
            level: Number.isFinite(fragment.level) ? normalizeFloorEditLevel(fragment.level) : 0,
            boundarySectionKeys: getFloorEditBoundarySectionKeysForPoint(mapRef, snapPoint)
        };
    }

    function getFloorEditorSnapVertexWorldPoint(wizardRef, screenX, screenY, options = {}) {
        const snap = getFloorEditorSnapVertexAtScreenPoint(wizardRef, screenX, screenY, options);
        return snap ? { x: snap.x, y: snap.y } : null;
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
            const baseZ = getFloorEditorBaseZ(wizardRef, fragment, "floor editor edge selection");
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

    function getFloorEditorBaseZ(wizardRef, fragment = null, label = "floor editor") {
        if (fragment && Number.isFinite(fragment.nodeBaseZ)) return Number(fragment.nodeBaseZ);
        const targetLevel = fragment && Number.isFinite(fragment.level)
            ? normalizeFloorEditLevel(fragment.level)
            : getSelectedFloorEditLevel(wizardRef);
        const wizardLayer = wizardRef && Number.isFinite(wizardRef.currentLayer)
            ? normalizeFloorEditLevel(wizardRef.currentLayer)
            : null;
        if (
            wizardLayer === targetLevel &&
            wizardRef &&
            Number.isFinite(wizardRef.currentLayerBaseZ)
        ) {
            return Number(wizardRef.currentLayerBaseZ);
        }
        throw new Error(`${label} level ${targetLevel} requires fragment nodeBaseZ or matching wizard currentLayerBaseZ`);
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
        const normalizeTargetLayer = options && options.preserveRuntimeLevels === true
            ? normalizeRuntimeFloorLayer
            : normalizeFloorEditLevel;
        const visibleFragmentIds = options && options.visibleFragmentIds instanceof Set
            ? options.visibleFragmentIds
            : null;
        const maxLevel = Number.isFinite(options && options.maxLevel)
            ? normalizeTargetLayer(options.maxLevel)
            : Infinity;
        const exactLevel = Number.isFinite(options && options.exactLevel)
            ? normalizeTargetLayer(options.exactLevel)
            : null;
        const includeGround = !!(options && options.includeGround === true);
        let best = null;
        for (const fragment of mapRef.floorsById.values()) {
            if (!fragment) continue;
            const fragmentId = typeof fragment.fragmentId === "string" ? fragment.fragmentId : "";
            if (visibleFragmentIds && (!fragmentId || !visibleFragmentIds.has(fragmentId))) continue;
            const level = Number.isFinite(fragment.level) ? normalizeTargetLayer(fragment.level) : 0;
            if (exactLevel !== null && level !== exactLevel) continue;
            if (level === 0 && !includeGround) continue;
            if (level > maxLevel) continue;
            if (fragment._prototypeGroundFloor === true && !(includeGround && level === 0)) continue;
            if (fragment._floorEditEmpty === true) continue;
            if (!Array.isArray(fragment.outerPolygon) || fragment.outerPolygon.length < 3) continue;
            const baseZ = getFloorEditorBaseZ(wizardRef, fragment, "visible floor polygon selection");
            let point = resolveWorldPointOnFloorPlaneFromScreen(wizardRef, screenX, screenY, baseZ);
            let pointInside = !!(point && isPointInsideFloorEditorFragment(point.x, point.y, fragment));
            if (
                !pointInside &&
                visibleFragmentIds &&
                fragment.renderedByBuildingCutaway === true &&
                baseZ !== 0
            ) {
                const bakedProjectionPoint = resolveWorldPointOnFloorPlaneFromScreen(wizardRef, screenX, screenY, 0);
                if (
                    bakedProjectionPoint &&
                    isPointInsideFloorEditorFragment(bakedProjectionPoint.x, bakedProjectionPoint.y, fragment)
                ) {
                    point = bakedProjectionPoint;
                    pointInside = true;
                }
            }
            if (!pointInside) continue;
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

    function getSpellCastScreenPoint(options = {}) {
        const screenX = Number.isFinite(options && options.screenX)
            ? Number(options.screenX)
            : ((typeof globalThis !== "undefined" && globalThis.mousePos && Number.isFinite(globalThis.mousePos.screenX))
                ? Number(globalThis.mousePos.screenX)
                : NaN);
        const screenY = Number.isFinite(options && options.screenY)
            ? Number(options.screenY)
            : ((typeof globalThis !== "undefined" && globalThis.mousePos && Number.isFinite(globalThis.mousePos.screenY))
                ? Number(globalThis.mousePos.screenY)
                : NaN);
        return { screenX, screenY };
    }

    function isVisibleFloorInteriorViewActive(wizardRef, mapRef) {
        const renderingApi = (typeof globalThis !== "undefined") ? globalThis.Rendering : null;
        if (!renderingApi || typeof renderingApi.isBuildingInteriorPresentationActive !== "function") return false;
        return !!renderingApi.isBuildingInteriorPresentationActive({ wizard: wizardRef || null, map: mapRef || null });
    }

    function getVisibleFloorInteriorFragmentIds(wizardRef, mapRef) {
        const renderingApi = (typeof globalThis !== "undefined") ? globalThis.Rendering : null;
        if (!renderingApi || typeof renderingApi.getBuildingInteriorVisibleFloorFragmentIds !== "function") return null;
        const ids = renderingApi.getBuildingInteriorVisibleFloorFragmentIds({ wizard: wizardRef || null, map: mapRef || null });
        if (!(ids instanceof Set) || ids.size === 0) return null;
        return ids;
    }

    function resolveVisibleFloorNodeOnLayer(mapRef, worldX, worldY, layer, floorTarget = null) {
        if (!mapRef || typeof mapRef.worldToNode !== "function") return null;
        const baseNode = mapRef.worldToNode(worldX, worldY);
        if (!baseNode) return null;
        const targetLayer = Number.isFinite(layer) ? Math.round(Number(layer)) : 0;
        if (targetLayer === 0) return baseNode;
        if (typeof mapRef.getFloorNodeAtLayer !== "function") return null;
        const fragment = floorTarget && floorTarget.fragment ? floorTarget.fragment : null;
        const sectionKey = (fragment && typeof fragment.ownerSectionKey === "string" && fragment.ownerSectionKey.length > 0)
            ? fragment.ownerSectionKey
            : (typeof baseNode._prototypeSectionKey === "string"
                ? baseNode._prototypeSectionKey
                : ((typeof mapRef.getPrototypeSectionKeyForWorldPoint === "function")
                    ? mapRef.getPrototypeSectionKeyForWorldPoint(worldX, worldY)
                    : ""));
        return mapRef.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, targetLayer, {
            sectionKey,
            surfaceId: fragment && typeof fragment.surfaceId === "string" ? fragment.surfaceId : "",
            fragmentId: fragment && typeof fragment.fragmentId === "string" ? fragment.fragmentId : "",
            sourceNode: baseNode,
            worldX,
            worldY,
            allowScan: true
        });
    }

    function resolveVisibleFloorTarget(wizardRef, worldX, worldY, options = {}) {
        const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
        const screenPoint = getSpellCastScreenPoint(options);
        let targetPoint = null;
        let targetLayer = 0;
        let targetBaseZ = 0;
        let floorTarget = null;
        const currentLayer = Number.isFinite(wizardRef && wizardRef.currentLayer)
            ? Math.round(Number(wizardRef.currentLayer))
            : (Number.isFinite(wizardRef && wizardRef.traversalLayer)
                ? Math.round(Number(wizardRef.traversalLayer))
                : 0);
        const isUndergroundTarget = currentLayer < 0;

        if (Number.isFinite(screenPoint.screenX) && Number.isFinite(screenPoint.screenY)) {
            const visibleFloorOptions = { includeGround: true };
            if (isUndergroundTarget) {
                visibleFloorOptions.includeGround = false;
                visibleFloorOptions.exactLevel = currentLayer;
            } else if (isVisibleFloorInteriorViewActive(wizardRef, mapRef)) {
                const interiorVisibleFragmentIds = getVisibleFloorInteriorFragmentIds(wizardRef, mapRef);
                if (interiorVisibleFragmentIds) {
                    visibleFloorOptions.visibleFragmentIds = interiorVisibleFragmentIds;
                } else {
                    visibleFloorOptions.maxLevel = Number.isFinite(wizardRef && wizardRef.currentLayer)
                        ? Number(wizardRef.currentLayer)
                        : (Number.isFinite(wizardRef && wizardRef.traversalLayer) ? Number(wizardRef.traversalLayer) : 0);
                }
            }
            floorTarget = getVisibleFloorPolygonTargetAtScreenPoint(wizardRef, screenPoint.screenX, screenPoint.screenY, {
                ...visibleFloorOptions,
                preserveRuntimeLevels: true
            });
            if (floorTarget && floorTarget.point) {
                targetPoint = floorTarget.point;
                targetLayer = Number.isFinite(floorTarget.level) ? Math.round(Number(floorTarget.level)) : 0;
                targetBaseZ = Number.isFinite(Number(floorTarget.fragment && floorTarget.fragment.nodeBaseZ))
                    ? Number(floorTarget.fragment.nodeBaseZ)
                    : (Number.isFinite(floorTarget.baseZ) ? Number(floorTarget.baseZ) : null);
                if (!Number.isFinite(targetBaseZ)) {
                    throw new Error(`floor target layer ${targetLayer} requires baseZ`);
                }
            } else {
                targetLayer = isUndergroundTarget ? currentLayer : 0;
                targetBaseZ = isUndergroundTarget
                    ? (Number.isFinite(wizardRef && wizardRef.currentLayerBaseZ)
                        ? Number(wizardRef.currentLayerBaseZ)
                        : null)
                    : 0;
                if (isUndergroundTarget && !Number.isFinite(targetBaseZ)) {
                    throw new Error(`underground target layer ${targetLayer} requires wizard currentLayerBaseZ`);
                }
                targetPoint = isUndergroundTarget
                    ? resolveWorldPointOnFloorPlaneFromScreen(wizardRef, screenPoint.screenX, screenPoint.screenY, targetBaseZ)
                    : resolveWorldPointOnFloorPlaneFromScreen(wizardRef, screenPoint.screenX, screenPoint.screenY, 0);
            }
        }

        const resolvedX = Number.isFinite(targetPoint && targetPoint.x) ? Number(targetPoint.x) : worldX;
        const resolvedY = Number.isFinite(targetPoint && targetPoint.y) ? Number(targetPoint.y) : worldY;
        const wrappedX = mapRef && typeof mapRef.wrapWorldX === "function" && Number.isFinite(resolvedX)
            ? mapRef.wrapWorldX(resolvedX)
            : resolvedX;
        const wrappedY = mapRef && typeof mapRef.wrapWorldY === "function" && Number.isFinite(resolvedY)
            ? mapRef.wrapWorldY(resolvedY)
            : resolvedY;
        const destinationNode = (isUndergroundTarget && !floorTarget)
            ? null
            : resolveVisibleFloorNodeOnLayer(mapRef, wrappedX, wrappedY, targetLayer, floorTarget);
        if (destinationNode && Number.isFinite(Number(destinationNode.baseZ))) {
            targetBaseZ = Number(destinationNode.baseZ);
        } else if (
            floorTarget &&
            floorTarget.fragment &&
            Number.isFinite(Number(floorTarget.fragment.nodeBaseZ))
        ) {
            targetBaseZ = Number(floorTarget.fragment.nodeBaseZ);
        }

        return {
            x: wrappedX,
            y: wrappedY,
            layer: targetLayer,
            baseZ: targetBaseZ,
            node: destinationNode,
            floorTarget,
            screenX: screenPoint.screenX,
            screenY: screenPoint.screenY
        };
    }

    function resolveTeleportVisualTarget(wizardRef, worldX, worldY, options = {}) {
        return resolveVisibleFloorTarget(wizardRef, worldX, worldY, options);
    }

    function resolveEditorPlacementTarget(wizardRef, worldX, worldY, options = {}) {
        return resolveVisibleFloorTarget(wizardRef, worldX, worldY, options);
    }

    function resolveFloorEditorPaintWorldPoint(wizardRef, worldX, worldY, options = {}) {
        const screenX = Number(options && options.screenX);
        const screenY = Number(options && options.screenY);
        const baseZ = getFloorEditorBaseZ(wizardRef, null, "floor editor paint point");
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
                target.holes[holeIndex] = ring.map(point => ({ ...point }));
            } else {
                target.outerPolygon = ring.map(point => ({ ...point }));
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

    function cloneFloorEditorFragmentRecord(record) {
        if (!record || typeof record !== "object") return null;
        const cloned = { ...record };
        cloned.outerPolygon = cloneFloorEditorRing(record.outerPolygon);
        cloned.holes = Array.isArray(record.holes)
            ? record.holes.map(cloneFloorEditorRing).filter(ring => ring.length >= 3)
            : [];
        cloned.tileCoordKeys = Array.isArray(record.tileCoordKeys) ? record.tileCoordKeys.slice() : [];
        return cloned;
    }

    function isFloorEditorFragmentContainedInOwnerSection(wizardRef, selection) {
        const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
        const state = mapRef && mapRef._prototypeSectionState ? mapRef._prototypeSectionState : null;
        const fragment = selection && (selection.fragment || (
            mapRef && mapRef.floorsById instanceof Map ? mapRef.floorsById.get(selection.fragmentId) : null
        ));
        const ownerSectionKey = fragment && typeof fragment.ownerSectionKey === "string"
            ? fragment.ownerSectionKey
            : "";
        if (!fragment || !ownerSectionKey || !state || !(state.sectionAssetsByKey instanceof Map)) return false;
        const ownerAsset = state.sectionAssetsByKey.get(ownerSectionKey);
        if (!ownerAsset) return false;
        const outerRing = floorEditPointsToClipRing(fragment.outerPolygon);
        if (!outerRing) return false;
        const polygon = [outerRing];
        const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
        for (let h = 0; h < holes.length; h++) {
            const holeRing = floorEditPointsToClipRing(holes[h]);
            if (holeRing) polygon.push(holeRing);
        }
        const fragmentGeometry = [polygon];
        const ownerSectionGeometry = floorEditClipMultiPolygonFromPoints(getFloorEditSectionPolygon(ownerAsset, state.basis));
        if (isFloorEditClipGeometryEmpty(ownerSectionGeometry)) return false;
        const clipApi = getFloorBooleanApi();
        if (!clipApi || typeof clipApi.difference !== "function") return false;
        const outsideOwner = floorEditSafeBoolean("difference", fragmentGeometry, ownerSectionGeometry);
        return isFloorEditClipGeometryEmpty(outsideOwner);
    }

    function rematerializeSelectedFloorEditorFragmentFast(wizardRef, selection) {
        const activeSelection = selection || getFloorEditorVertexSelection(wizardRef);
        if (!wizardRef || !wizardRef.map || !activeSelection) return false;
        if (!isFloorEditorFragmentContainedInOwnerSection(wizardRef, activeSelection)) return false;
        const mapRef = wizardRef.map;
        const fragment = activeSelection.fragment || (
            mapRef.floorsById instanceof Map ? mapRef.floorsById.get(activeSelection.fragmentId) : null
        );
        if (!fragment) return false;
        const assetMatch = findAssetFloorForFloorEditorFragment(mapRef, fragment);
        if (!assetMatch.asset || !assetMatch.floor) return false;
        refreshFloorEditorFloorTileKeys(assetMatch.asset, assetMatch.floor);
        const fragmentRecord = cloneFloorEditorFragmentRecord(assetMatch.floor);
        if (!fragmentRecord || typeof fragmentRecord.fragmentId !== "string" || fragmentRecord.fragmentId.length === 0) return false;
        const sectionKey = typeof fragment.ownerSectionKey === "string" ? fragment.ownerSectionKey : "";
        if (!sectionKey) return false;
        rematerializeFloorEditFragmentChanges(mapRef, new Map([[
            sectionKey,
            {
                removedFragmentIds: [fragmentRecord.fragmentId],
                fragmentRecords: [fragmentRecord]
            }
        ]]));
        activeSelection.dirty = false;
        if (typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
            globalThis.presentGameFrame();
        }
        return true;
    }

    function mergeSelectedFloorEditorFragmentOverlaps(wizardRef, selection) {
        const activeSelection = selection || getFloorEditorVertexSelection(wizardRef);
        if (!wizardRef || !wizardRef.map || !activeSelection) return false;
        if (!isFloorEditorFragmentContainedInOwnerSection(wizardRef, activeSelection)) return false;
        const mapRef = wizardRef.map;
        const fragment = activeSelection.fragment || (
            mapRef.floorsById instanceof Map ? mapRef.floorsById.get(activeSelection.fragmentId) : null
        );
        if (!fragment || typeof fragment.fragmentId !== "string" || fragment.fragmentId.length === 0) return false;
        const assetMatch = findAssetFloorForFloorEditorFragment(mapRef, fragment);
        if (!assetMatch.asset || !assetMatch.floor) return false;
        const level = Number.isFinite(fragment.level) ? normalizeFloorEditLevel(fragment.level) : 0;
        const result = getFloorFragmentEditApi().mergeOverlappingFragment(assetMatch.asset, level, assetMatch.floor.fragmentId, {
            basis: mapRef._prototypeSectionState ? mapRef._prototypeSectionState.basis : null,
            getSectionPolygon: getFloorEditSectionPolygon
        });
        if (!result || !result.changed) return false;
        const sectionKey = typeof fragment.ownerSectionKey === "string" ? fragment.ownerSectionKey : "";
        if (!sectionKey) return false;
        rematerializeFloorEditFragmentChanges(mapRef, new Map([[
            sectionKey,
            {
                removedFragmentIds: result.removedFragmentIds,
                fragmentRecords: result.fragmentRecords
            }
        ]]));
        activeSelection.dirty = false;
        if (result.fragmentRecords && result.fragmentRecords[0] && typeof result.fragmentRecords[0].fragmentId === "string") {
            activeSelection.fragmentId = result.fragmentRecords[0].fragmentId;
        }
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

    function getFloorEditorDistanceSq(mapRef, a, b) {
        const ax = Number(a && a.x);
        const ay = Number(a && a.y);
        const bx = Number(b && b.x);
        const by = Number(b && b.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
            return Infinity;
        }
        const dx = mapRef && typeof mapRef.shortestDeltaX === "function"
            ? mapRef.shortestDeltaX(ax, bx)
            : (bx - ax);
        const dy = mapRef && typeof mapRef.shortestDeltaY === "function"
            ? mapRef.shortestDeltaY(ay, by)
            : (by - ay);
        return (dx * dx) + (dy * dy);
    }

    function resolveFloorEditorSelectedInsertionPoint(wizardRef, selection, screenX, screenY, worldX, worldY) {
        const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
        const fragment = selection && selection.fragment ? selection.fragment : null;
        const baseZ = getFloorEditorBaseZ(wizardRef, fragment, "floor editor insertion point");
        const screenPoint = resolveWorldPointOnFloorPlaneFromScreen(wizardRef, Number(screenX), Number(screenY), baseZ);
        let x = screenPoint && Number.isFinite(screenPoint.x) ? Number(screenPoint.x) : Number(worldX);
        let y = screenPoint && Number.isFinite(screenPoint.y) ? Number(screenPoint.y) : Number(worldY);
        if (mapRef && typeof mapRef.wrapWorldX === "function") x = mapRef.wrapWorldX(x);
        if (mapRef && typeof mapRef.wrapWorldY === "function") y = mapRef.wrapWorldY(y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

        const state = mapRef && mapRef._prototypeSectionState ? mapRef._prototypeSectionState : null;
        const ownerSectionKey = fragment && typeof fragment.ownerSectionKey === "string"
            ? fragment.ownerSectionKey
            : "";
        const ownerAsset = ownerSectionKey && state && state.sectionAssetsByKey instanceof Map
            ? state.sectionAssetsByKey.get(ownerSectionKey)
            : null;
        if (!ownerAsset) return { x, y };
        return clampFloorEditPointToSection(ownerAsset, state, { x, y });
    }

    function insertFloorEditorVertexFromSelectedNeighbor(wizardRef, screenX, screenY, worldX, worldY) {
        if (!isFloorEditorDebugEditEnabled(wizardRef)) return false;
        const selection = getFloorEditorVertexSelection(wizardRef);
        if (!selection) return false;
        const ring = getFloorEditorRingFromFragment(selection.fragment, selection.ringKind, selection.holeIndex);
        if (!Array.isArray(ring) || ring.length < 3) return false;

        const insertPoint = resolveFloorEditorSelectedInsertionPoint(wizardRef, selection, screenX, screenY, worldX, worldY);
        if (!insertPoint || !Number.isFinite(insertPoint.x) || !Number.isFinite(insertPoint.y)) return false;

        const mapRef = wizardRef.map || null;
        const selectedIndex = selection.vertexIndex;
        const prevIndex = (selectedIndex - 1 + ring.length) % ring.length;
        const nextIndex = (selectedIndex + 1) % ring.length;
        const prevDistanceSq = getFloorEditorDistanceSq(mapRef, insertPoint, ring[prevIndex]);
        const nextDistanceSq = getFloorEditorDistanceSq(mapRef, insertPoint, ring[nextIndex]);
        const insertIndex = prevDistanceSq <= nextDistanceSq
            ? selectedIndex
            : Math.min(ring.length, selectedIndex + 1);

        const nextRing = cloneFloorEditorRing(ring);
        nextRing.splice(insertIndex, 0, { x: insertPoint.x, y: insertPoint.y });
        selection.vertexIndex = insertIndex;
        selection.dragging = true;
        const updated = applyFloorEditorRingToFragment(wizardRef, selection, nextRing, { rematerialize: false });
        if (!updated) return false;
        wizardRef._floorEditorVertexSelection = {
            fragmentId: selection.fragmentId,
            ringKind: selection.ringKind,
            holeIndex: selection.holeIndex,
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

    function setFloorEditorFragmentSurfaceId(wizardRef, fragment, surfaceId) {
        if (!wizardRef || !wizardRef.map || !fragment || typeof surfaceId !== "string" || surfaceId.length === 0) return false;
        if (fragment.surfaceId === surfaceId) return true;
        const assetMatch = findAssetFloorForFloorEditorFragment(wizardRef.map, fragment);
        fragment.surfaceId = surfaceId;
        if (assetMatch.floor && assetMatch.floor !== fragment) assetMatch.floor.surfaceId = surfaceId;
        else if (assetMatch.floor) assetMatch.floor.surfaceId = surfaceId;
        return true;
    }

    function updateFloorEditorVertexDrag(wizardRef, worldX, worldY, options = {}) {
        if (!isFloorEditorDebugEditEnabled(wizardRef)) return false;
        const selection = getFloorEditorVertexSelection(wizardRef);
        if (!selection || !selection.dragging) return false;
        const mapRef = wizardRef.map || null;
        const wrappedX = (mapRef && typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(worldX) : worldX;
        const wrappedY = (mapRef && typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(worldY) : worldY;
        if (!Number.isFinite(wrappedX) || !Number.isFinite(wrappedY)) return false;
        const snap = getFloorEditorSnapVertexAtScreenPoint(wizardRef, Number(options && options.screenX), Number(options && options.screenY), {
            exclude: selection
        });
        let nextPoint = snap ? { x: snap.x, y: snap.y } : { x: wrappedX, y: wrappedY };
        const state = mapRef && mapRef._prototypeSectionState ? mapRef._prototypeSectionState : null;
        const ownerSectionKey = selection.fragment && typeof selection.fragment.ownerSectionKey === "string"
            ? selection.fragment.ownerSectionKey
            : "";
        const ownerAsset = ownerSectionKey && state && state.sectionAssetsByKey instanceof Map
            ? state.sectionAssetsByKey.get(ownerSectionKey)
            : null;
        if (ownerAsset) {
            const clamped = clampFloorEditPointToSection(ownerAsset, state, nextPoint);
            if (!clamped) return false;
            nextPoint = clamped;
        }
        if (
            snap &&
            snap.fragment &&
            selection.fragment &&
            snap.surfaceId &&
            snap.fragment.fragmentId !== selection.fragment.fragmentId &&
            ownerAsset &&
            isFloorEditPointOnSectionBoundary(ownerAsset, state, nextPoint)
        ) {
            const snapAsset = getFloorEditSectionAsset(mapRef, snap.ownerSectionKey);
            if (snapAsset && isFloorEditPointOnSectionBoundary(snapAsset, state, nextPoint)) {
                setFloorEditorFragmentSurfaceId(wizardRef, selection.fragment, snap.surfaceId);
                selection.dirty = true;
            }
        }
        const ring = getFloorEditorRingFromFragment(selection.fragment, selection.ringKind, selection.holeIndex);
        if (!Array.isArray(ring) || ring.length < 3) return false;
        const nextRing = ring.map((point, index) => (
            index === selection.vertexIndex
                ? { x: nextPoint.x, y: nextPoint.y }
                : { x: Number(point.x), y: Number(point.y) }
        ));
        return applyFloorEditorRingToFragment(wizardRef, selection, nextRing, { rematerialize: false });
    }

    function removeFloorEditClipGeometryCollinearVertices(geometry) {
        if (!Array.isArray(geometry)) return geometry;
        const result = [];
        for (let pi = 0; pi < geometry.length; pi++) {
            const polygon = geometry[pi];
            if (!Array.isArray(polygon)) { result.push(polygon); continue; }
            const cleanPolygon = [];
            for (let ri = 0; ri < polygon.length; ri++) {
                const ring = polygon[ri];
                if (!Array.isArray(ring) || ring.length < 4) { cleanPolygon.push(ring); continue; }
                const n = ring.length - 1; // unique vertices (ring is closed: first == last)
                if (n < 3) { cleanPolygon.push(ring); continue; }
                const kept = [];
                for (let i = 0; i < n; i++) {
                    const prev = ring[(i + n - 1) % n];
                    const curr = ring[i];
                    const next = ring[(i + 1) % n];
                    const ax = curr[0] - prev[0];
                    const ay = curr[1] - prev[1];
                    const bx = next[0] - curr[0];
                    const by = next[1] - curr[1];
                    if (Math.abs(ax * by - ay * bx) > 1e-9) kept.push(curr);
                }
                if (kept.length < 3) { cleanPolygon.push(ring); continue; }
                kept.push([kept[0][0], kept[0][1]]);
                cleanPolygon.push(kept);
            }
            if (cleanPolygon.length > 0 && Array.isArray(cleanPolygon[0]) && cleanPolygon[0].length >= 4) {
                result.push(cleanPolygon);
            }
        }
        return result;
    }

    function sliceFloorEditorFragmentAtSectionBoundaries(wizardRef, selection) {
        const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
        if (!mapRef) return false;
        const state = mapRef._prototypeSectionState || null;
        if (!state || !(state.sectionAssetsByKey instanceof Map)) return false;
        const fragment = selection && (selection.fragment || (
            mapRef.floorsById instanceof Map ? mapRef.floorsById.get(selection.fragmentId) : null
        ));
        if (!fragment) return false;
        const level = Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0;
        const ownerSectionKey = typeof fragment.ownerSectionKey === "string" ? fragment.ownerSectionKey : "";
        const fragmentTexturePath = (typeof fragment.texturePath === "string" && fragment.texturePath.length > 0)
            ? fragment.texturePath : null;
        const outerRing = floorEditPointsToClipRing(fragment.outerPolygon);
        if (!outerRing) {
            rematerializeSelectedFloorEditorFragment(wizardRef, selection);
            return true;
        }
        const drawnPolygon = [outerRing];
        const fragmentHoles = Array.isArray(fragment.holes) ? fragment.holes : [];
        for (let h = 0; h < fragmentHoles.length; h++) {
            const holeRing = floorEditPointsToClipRing(fragmentHoles[h]);
            if (holeRing) drawnPolygon.push(holeRing);
        }
        const drawnGeometry = [drawnPolygon];
        if (isFloorEditClipGeometryEmpty(drawnGeometry)) {
            rematerializeSelectedFloorEditorFragment(wizardRef, selection);
            return true;
        }
        const changedSectionKeys = new Set();
        for (const [sectionKey, asset] of state.sectionAssetsByKey.entries()) {
            const sectionGeometry = floorEditClipMultiPolygonFromPoints(getFloorEditSectionPolygon(asset, state.basis));
            if (isFloorEditClipGeometryEmpty(sectionGeometry)) continue;
            if (sectionKey === ownerSectionKey) {
                const currentGeometry = getFloorEditAssetAreaGeometry(asset, level, state.basis);
                const clipped = removeFloorEditClipGeometryCollinearVertices(
                    floorEditSafeBoolean("intersection", currentGeometry, sectionGeometry)
                );
                setFloorEditAssetAreaGeometry(asset, level, clipped);
                changedSectionKeys.add(sectionKey);
            } else {
                const overlap = floorEditSafeBoolean("intersection", sectionGeometry, drawnGeometry);
                if (!isFloorEditClipGeometryEmpty(overlap)) {
                    const currentGeometry = getFloorEditAssetAreaGeometry(asset, level, state.basis);
                    const nextGeometry = removeFloorEditClipGeometryCollinearVertices(
                        floorEditSafeBoolean("union", currentGeometry, overlap)
                    );
                    setFloorEditAssetAreaGeometry(asset, level, nextGeometry,
                        fragmentTexturePath ? { texturePath: fragmentTexturePath } : null);
                    changedSectionKeys.add(sectionKey);
                }
            }
        }
        rematerializeFloorEditSections(mapRef, changedSectionKeys);
        selection.dirty = false;
        if (typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
            globalThis.presentGameFrame();
        }
        return true;
    }

    function endFloorEditorVertexDrag(wizardRef) {
        const selection = getFloorEditorVertexSelection(wizardRef);
        if (!selection || !selection.dragging) return false;
        selection.dragging = false;
        if (
            selection.dirty &&
            !mergeSelectedFloorEditorFragmentOverlaps(wizardRef, selection) &&
            !rematerializeSelectedFloorEditorFragmentFast(wizardRef, selection)
        ) {
            sliceFloorEditorFragmentAtSectionBoundaries(wizardRef, selection);
        }
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

    function getFloorStairsTool() {
        return (typeof globalThis !== "undefined" && globalThis.FloorStairs)
            ? globalThis.FloorStairs
            : null;
    }

    function beginFloorStairPlacement(wizardRef, screenX, screenY, options = {}) {
        const tool = getFloorStairsTool();
        if (!tool || typeof tool.beginPlacement !== "function") return false;
        return tool.beginPlacement(wizardRef, screenX, screenY, options);
    }

    function updateFloorStairPlacement(wizardRef, worldX, worldY, options = {}) {
        const tool = getFloorStairsTool();
        if (!tool || typeof tool.updatePlacement !== "function") return false;
        return tool.updatePlacement(wizardRef, worldX, worldY, options);
    }

    function endFloorStairPlacement(wizardRef) {
        const tool = getFloorStairsTool();
        if (!tool || typeof tool.endPlacement !== "function") return false;
        return tool.endPlacement(wizardRef);
    }

    function cancelFloorStairPlacement(wizardRef) {
        const tool = getFloorStairsTool();
        if (!tool || typeof tool.cancelPlacement !== "function") return false;
        return tool.cancelPlacement(wizardRef);
    }

    function getFloorStairPlacementPreview(wizardRef) {
        const tool = getFloorStairsTool();
        if (!tool || typeof tool.getPlacementPreview !== "function") return null;
        return tool.getPlacementPreview(wizardRef);
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
        if (floorShapeWallLoopOverlapsExistingFloor(wizardRef, polygonPoints)) return null;
        return { wallSections: loopSections, polygonPoints };
    }

    function floorEditFragmentToClipGeometry(fragment) {
        if (!fragment || fragment._floorEditEmpty === true) return [];
        const outerRing = floorEditPointsToClipRing(fragment.outerPolygon);
        if (!outerRing) return [];
        const polygon = [outerRing];
        const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
        for (let i = 0; i < holes.length; i++) {
            const holeRing = floorEditPointsToClipRing(holes[i]);
            if (holeRing) polygon.push(holeRing);
        }
        return [polygon];
    }

    function floorEditRingBounds(points) {
        if (!Array.isArray(points) || points.length === 0) return null;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < points.length; i++) {
            const x = Number(points[i] && points[i].x);
            const y = Number(points[i] && points[i].y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
        return { minX, minY, maxX, maxY };
    }

    function floorEditBoundsOverlap(a, b) {
        if (!a || !b) return false;
        return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
    }

    function floorShapeWallLoopOverlapsExistingFloor(wizardRef, polygonPoints) {
        const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
        if (!mapRef || !(mapRef.floorsById instanceof Map) || mapRef.floorsById.size === 0) return false;
        const loopGeometry = floorEditClipMultiPolygonFromPoints(polygonPoints);
        if (isFloorEditClipGeometryEmpty(loopGeometry)) return false;
        const loopBounds = floorEditRingBounds(polygonPoints);
        if (!loopBounds) return false;
        const api = getFloorBooleanApi();
        if (!api || typeof api.intersection !== "function") {
            throw new Error("floor shape wall-loop occupancy check requires polygonClipping.intersection");
        }
        const level = getSelectedFloorEditLevel(wizardRef);
        for (const fragment of mapRef.floorsById.values()) {
            if (!fragment || normalizeFloorEditLevel(fragment.level) !== level) continue;
            const fragmentBounds = floorEditRingBounds(fragment.outerPolygon);
            if (!floorEditBoundsOverlap(loopBounds, fragmentBounds)) continue;
            const fragmentGeometry = floorEditFragmentToClipGeometry(fragment);
            if (isFloorEditClipGeometryEmpty(fragmentGeometry)) continue;
            const overlap = api.intersection(loopGeometry, fragmentGeometry);
            if (!isFloorEditClipGeometryEmpty(overlap)) return true;
        }
        return false;
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

    function filterCoveredFloorEditHolePairs(holes, coveringPolygon) {
        const sourceHoles = Array.isArray(holes) ? holes : [];
        const nextHoles = [];
        let removed = 0;
        for (let i = 0; i < sourceHoles.length; i++) {
            const hole = sourceHoles[i];
            if (floorEditPolygonContainsRing(coveringPolygon, hole)) {
                removed += 1;
                continue;
            }
            if (Array.isArray(hole)) nextHoles.push(hole);
        }
        return { holes: nextHoles, removed };
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
                const filtered = filterCoveredFloorEditHolePairs(fragment.holes, coveringPolygon);
                if (filtered.removed <= 0) continue;
                fragment.holes = filtered.holes;
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
                    const filtered = filterCoveredFloorEditHolePairs(floor.holes, coveringPolygon);
                    if (filtered.removed <= 0) continue;
                    floor.holes = filtered.holes;
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

    function getFloorFragmentEditApi() {
        const api = (typeof globalThis !== "undefined") ? globalThis.FloorFragmentEdit : null;
        if (!api) throw new Error("floor editing requires FloorFragmentEdit");
        return api;
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

    function getFloorEditSectionPolygon(asset, basis) {
        if (!asset || typeof asset !== "object") return [];
        const sectionGeometryApi = (typeof globalThis !== "undefined") ? globalThis.__sectionGeometry : null;
        return sectionGeometryApi.getSectionHexagonCorners(asset.centerAxial, basis);
    }

    function getFloorEditAssetAreaGeometry(asset, level, basis) {
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
            area = floorEditClipMultiPolygonFromPoints(getFloorEditSectionPolygon(asset, basis));
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

    function setFloorEditAssetAreaGeometry(asset, level, geometry, options = null) {
        if (!asset) return { fragments: 0, tiles: 0, voids: 0 };
        const normalizedLevel = normalizeFloorEditLevel(level);
        const existingFloors = Array.isArray(asset.floors) ? asset.floors : [];
        // Inherit texture from the first existing fragment at this level so boolean edits
        // and slices don't silently reset the texture. An explicit options.texturePath
        // overrides this (used when creating fragments in a section with no prior geometry).
        let texturePath = (options && typeof options.texturePath === "string" && options.texturePath.length > 0)
            ? options.texturePath
            : null;
        if (!texturePath) {
            for (let i = 0; i < existingFloors.length; i++) {
                const f = existingFloors[i];
                if (!f || normalizeFloorEditLevel(f.level) !== normalizedLevel) continue;
                if (typeof f.texturePath === "string" && f.texturePath.length > 0) {
                    texturePath = f.texturePath;
                    break;
                }
            }
        }
        // Collect the existing fragments at this level in order so their
        // fragmentId/surfaceId can be reused for the replacement records.
        // Preserving these IDs keeps blocked-edge records (which reference
        // nodes by fragmentId) valid across boolean edits.
        const existingAtLevel = existingFloors.filter(
            f => f && normalizeFloorEditLevel(f.level) === normalizedLevel
        );
        const nextFloors = existingFloors.filter(floor => !floor || normalizeFloorEditLevel(floor.level) !== normalizedLevel);
        const fallbackSurfaceId = `floor_area:${asset.key}:${normalizedLevel}`;
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
                // Reuse the existing fragment's IDs when available so that
                // blocked-edge records (keyed by fragmentId) remain valid.
                const existing = existingAtLevel[i] || null;
                const surfaceId = (existing && existing.surfaceId) ? existing.surfaceId : fallbackSurfaceId;
                const fragmentId = (existing && existing.fragmentId) ? existing.fragmentId : `${fallbackSurfaceId}:${i}`;
                const nodeBaseZ = Number.isFinite(existing && existing.nodeBaseZ)
                    ? Number(existing.nodeBaseZ)
                    : (Number.isFinite(options && options.nodeBaseZ) ? Number(options.nodeBaseZ) : null);
                if (!Number.isFinite(nodeBaseZ)) {
                    throw new Error(`floor edit asset ${asset.key || "(unknown)"} level ${normalizedLevel} requires nodeBaseZ`);
                }
                const record = {
                    fragmentId,
                    surfaceId,
                    ownerSectionKey: asset.key,
                    level: normalizedLevel,
                    nodeBaseZOffset: 0,
                    nodeBaseZ,
                    outerPolygon: outer,
                    holes,
                    tileCoordKeys
                };
                if (texturePath) record.texturePath = texturePath;
                nextFloors.push(record);
                fragments += 1;
            }
        }
        if (fragments === 0 && normalizedLevel === 0) {
            nextFloors.push({
                fragmentId: `${fallbackSurfaceId}:empty`,
                surfaceId: fallbackSurfaceId,
                ownerSectionKey: asset.key,
                level: 0,
                nodeBaseZOffset: 0,
                nodeBaseZ: 0,
                outerPolygon: [],
                holes: [],
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
            const blockedEdgeState = mapRef._prototypeBlockedEdgeState;
            if (blockedEdgeState && blockedEdgeState.activeEntriesBySectionKey instanceof Map) {
                blockedEdgeState.activeEntriesBySectionKey.delete(sectionKey);
            }
            // Re-apply wall blocked edges directly to the freshly-registered floor
            // nodes.  syncPrototypeWalls (called below) may not correctly re-apply
            // blocking when runtime wall objects hold stale references to the old
            // nodes that were just destroyed.  Applying here, immediately after
            // registration, ensures the new nodes pick up the correct blockedNeighbors.
            const blockingModule = (typeof globalThis !== "undefined") && globalThis.__sectionWorldBlocking;
            if (blockingModule && typeof blockingModule.createSectionWorldBlockingHelpers === "function") {
                const { applyPrototypeBlockedEdgesForSection } =
                    blockingModule.createSectionWorldBlockingHelpers(mapRef, {});
                applyPrototypeBlockedEdgesForSection(mapRef, sectionKey);
            }
            refreshManagedWallNodeRegistrationsAfterFloorEdit(mapRef, new Set([sectionKey]));
            count += 1;
        }
        const wallState = mapRef._prototypeWallState;
        if (count > 0 && wallState && typeof wallState === "object") {
            wallState.activeRecordSignature = null;
        }
        if (count > 0 && typeof mapRef.syncPrototypeWalls === "function") {
            mapRef.syncPrototypeWalls();
        }
        return count;
    }

    function rematerializeFloorEditFragmentChanges(mapRef, changesBySectionKey) {
        return getFloorFragmentEditApi().rematerializeFragmentChanges(mapRef, changesBySectionKey, {
            rematerializeSections: rematerializeFloorEditSections,
            refreshManagedWallNodeRegistrations: refreshManagedWallNodeRegistrationsAfterFloorEdit
        });
    }

    function refreshManagedWallNodeRegistrationsAfterFloorEdit(mapRef, sectionKeys) {
        return getFloorFragmentEditApi().refreshManagedWallNodeRegistrations(mapRef, sectionKeys);
    }

    function getFloorShapeDraftCandidateSectionKeys(mapRef, draft) {
        if (!draft || !Array.isArray(draft.boundarySectionKeys)) return [];
        const state = mapRef && mapRef._prototypeSectionState ? mapRef._prototypeSectionState : null;
        if (!state || !(state.sectionAssetsByKey instanceof Map)) return [];
        const out = [];
        for (let i = 0; i < draft.boundarySectionKeys.length; i++) {
            const key = draft.boundarySectionKeys[i];
            if (typeof key === "string" && state.sectionAssetsByKey.has(key) && !out.includes(key)) out.push(key);
        }
        return out;
    }

    function chooseFloorShapeDraftSectionForPoint(mapRef, draft, point) {
        const state = mapRef && mapRef._prototypeSectionState ? mapRef._prototypeSectionState : null;
        if (!state || !(state.sectionAssetsByKey instanceof Map) || !point) return "";
        const candidateKeys = getFloorShapeDraftCandidateSectionKeys(mapRef, draft);
        const keys = candidateKeys.length > 0 ? candidateKeys : Array.from(state.sectionAssetsByKey.keys());
        const containing = [];
        for (let i = 0; i < keys.length; i++) {
            const asset = state.sectionAssetsByKey.get(keys[i]);
            const polygon = getFloorEditSectionPolygon(asset, state.basis);
            if (pointInOrOnFloorEditPolygon2D(point.x, point.y, polygon)) containing.push(keys[i]);
        }
        if (containing.length === 1) return containing[0];
        if (candidateKeys.length > 0 && containing.length > 1) {
            let boundaryCount = 0;
            for (let i = 0; i < containing.length; i++) {
                const asset = state.sectionAssetsByKey.get(containing[i]);
                if (isFloorEditPointOnSectionBoundary(asset, state, point)) boundaryCount += 1;
            }
            if (boundaryCount === containing.length) return "";
        }
        const resolved = getFloorEditSectionKeyForWorldPoint(mapRef, point.x, point.y);
        if (resolved && keys.includes(resolved)) return resolved;
        let bestKey = "";
        let bestDistanceSq = Infinity;
        for (let i = 0; i < keys.length; i++) {
            const asset = state.sectionAssetsByKey.get(keys[i]);
            const closest = getClosestFloorEditPolygonBoundaryPoint(point, getFloorEditSectionPolygon(asset, state.basis));
            if (!closest) continue;
            if (closest.distanceSq < bestDistanceSq) {
                bestDistanceSq = closest.distanceSq;
                bestKey = keys[i];
            }
        }
        return bestKey;
    }

    function resolveFloorShapeDraftPoint(wizardRef, draft, rawPoint, snap = null) {
        const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
        const state = mapRef && mapRef._prototypeSectionState ? mapRef._prototypeSectionState : null;
        if (!draft || !mapRef || !state || !(state.sectionAssetsByKey instanceof Map)) return rawPoint;
        let point = rawPoint;
        if (draft.points.length === 0) {
            const boundarySectionKeys = snap && Array.isArray(snap.boundarySectionKeys)
                ? snap.boundarySectionKeys.slice()
                : getFloorEditBoundarySectionKeysForPoint(mapRef, point);
            if (snap && snap.surfaceId && boundarySectionKeys.length >= 2) {
                draft.preferredSurfaceId = snap.surfaceId;
                draft.boundarySectionKeys = boundarySectionKeys;
            } else {
                draft.boundarySectionKeys = boundarySectionKeys.length >= 2 ? boundarySectionKeys : [];
                draft.sectionKey = getFloorEditSectionKeyForWorldPoint(mapRef, point.x, point.y);
            }
        }
        if (!draft.sectionKey) {
            const chosen = chooseFloorShapeDraftSectionForPoint(mapRef, draft, point);
            if (chosen) draft.sectionKey = chosen;
        }
        if (draft.sectionKey) {
            const asset = state.sectionAssetsByKey.get(draft.sectionKey);
            const clamped = clampFloorEditPointToSection(asset, state, point);
            if (clamped) point = clamped;
        }
        return point;
    }

    function applyFloorBooleanEditToDraftSection(wizardRef, operation) {
        if (!wizardRef || !wizardRef.map || operation !== "add") return false;
        const draft = wizardRef._floorShapePlacementDraft;
        if (!draft || !Array.isArray(draft.points) || draft.points.length < 3) return false;
        const mapRef = wizardRef.map;
        const state = mapRef._prototypeSectionState || null;
        if (!state || !(state.sectionAssetsByKey instanceof Map)) return false;
        const level = getSelectedFloorEditLevel(wizardRef);
        const points = normalizeFloorEditPolygonRing(draft.points);
        if (points.length < 3) return false;
        const sectionKey = draft.sectionKey || chooseFloorShapeDraftSectionForPoint(mapRef, draft, points[0]);
        if (!sectionKey) {
            if (typeof message === "function") message("Floor polygon needs one point inside a section before it can be added.");
            return false;
        }
        const asset = state.sectionAssetsByKey.get(sectionKey);
        if (!asset) return false;
        const drawnGeometry = floorEditClipMultiPolygonFromPoints(points);
        if (isFloorEditClipGeometryEmpty(drawnGeometry)) return false;
        const sectionGeometry = floorEditClipMultiPolygonFromPoints(getFloorEditSectionPolygon(asset, state.basis));
        if (isFloorEditClipGeometryEmpty(sectionGeometry)) return false;
        const editGeometry = floorEditSafeBoolean("intersection", sectionGeometry, drawnGeometry);
        if (isFloorEditClipGeometryEmpty(editGeometry)) return false;
        const result = getFloorFragmentEditApi().applyAssetGeometryDelta(asset, level, editGeometry, operation, {
            basis: state.basis,
            getSectionPolygon: getFloorEditSectionPolygon,
            preferredSurfaceId: typeof draft.preferredSurfaceId === "string" ? draft.preferredSurfaceId : ""
        });
        if (!result.changed) return false;
        if (mapRef._floorEditHiddenTileKeysByLevel instanceof Map) {
            mapRef._floorEditHiddenTileKeysByLevel.delete(level);
        }
        rematerializeFloorEditFragmentChanges(mapRef, new Map([[
            sectionKey,
            {
                removedFragmentIds: result.removedFragmentIds,
                fragmentRecords: result.fragmentRecords
            }
        ]]));
        wizardRef._floorShapePlacementDraft = null;
        if (typeof message === "function") {
            message(`Added floor level ${level > 0 ? `+${level}` : level}: ${result.tiles} tiles across ${result.fragments} fragment${result.fragments === 1 ? "" : "s"}.`);
        }
        recordFloorEditDiagnostic("boolean.apply.section.finish", {
            operation,
            level,
            sectionKey,
            totalFragments: result.fragments,
            totalTiles: result.tiles,
            preferredSurfaceId: typeof draft.preferredSurfaceId === "string" ? draft.preferredSurfaceId : ""
        });
        if (typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
            globalThis.presentGameFrame();
        }
        return true;
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
        const fragmentChangesBySectionKey = new Map();
        let totalFragments = 0;
        let totalTiles = 0;
        for (const [sectionKey, asset] of state.sectionAssetsByKey.entries()) {
            const sectionGeometry = floorEditClipMultiPolygonFromPoints(getFloorEditSectionPolygon(asset, state.basis));
            if (isFloorEditClipGeometryEmpty(sectionGeometry)) continue;
            const editGeometry = floorEditSafeBoolean("intersection", sectionGeometry, drawnGeometry);
            if (isFloorEditClipGeometryEmpty(editGeometry)) continue;
            const result = getFloorFragmentEditApi().applyAssetGeometryDelta(asset, level, editGeometry, operation, {
                basis: state.basis,
                getSectionPolygon: getFloorEditSectionPolygon
            });
            if (!result.changed) continue;
            changedSectionKeys.add(sectionKey);
            fragmentChangesBySectionKey.set(sectionKey, {
                removedFragmentIds: result.removedFragmentIds,
                fragmentRecords: result.fragmentRecords
            });
            totalFragments += result.fragments;
            totalTiles += result.tiles;
        }
        if (mapRef._floorEditHiddenTileKeysByLevel instanceof Map) {
            mapRef._floorEditHiddenTileKeysByLevel.delete(level);
        }
        rematerializeFloorEditFragmentChanges(mapRef, fragmentChangesBySectionKey);
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
        const draft = wizardRef && wizardRef._floorShapePlacementDraft;
        if (draft && draft.sectionKey) return applyFloorBooleanEditToDraftSection(wizardRef, "add");
        if (draft && Array.isArray(draft.boundarySectionKeys) && draft.boundarySectionKeys.length > 0) {
            return applyFloorBooleanEditToDraftSection(wizardRef, "add");
        }
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
                asset.floors.push({ ...floorRecord, outerPolygon: points.map(p => ({ ...p })) });
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
                floor.holes.push(points.map(p => ({ x: Number(p.x), y: Number(p.y) })));
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
                    fragment.holes.push(points.map(p => ({ x: Number(p.x), y: Number(p.y) })));
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
        const snapped = getFloorEditorSnapVertexAtScreenPoint(wizardRef, options.screenX, options.screenY);
        let finalPoint = snapped ? { x: snapped.x, y: snapped.y } : { x: wrappedX, y: wrappedY };
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
        finalPoint = resolveFloorShapeDraftPoint(wizardRef, draft, finalPoint, snapped);
        const finalX = finalPoint.x;
        const finalY = finalPoint.y;

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
            const click = { x: finalX, y: finalY };
            const closeDistancePx = getScreenDistancePxBetweenWorldPoints(start, click);
            if (closeDistancePx <= TRIGGER_AREA_CLOSE_DISTANCE_PX) {
                recordFloorEditDiagnostic("vertex.floorshape.finish.proximity", {
                    level,
                    pointsBeforeFinish: draft.points.length,
                    closeDistancePx,
                    worldX: finalX,
                    worldY: finalY
                });
                finalizeFloorShapePlacement(wizardRef);
                return;
            }
        }

        draft.points.push({ x: finalX, y: finalY });
        recordFloorEditDiagnostic("vertex.floorshape.add", {
            level,
            clickCount,
            pointsAfterAdd: draft.points.length,
            worldX: finalX,
            worldY: finalY
        });
    }

    function placeFloorHoleVertex(wizardRef, worldX, worldY, options = {}) {
        if (!wizardRef || !wizardRef.map) return;
        const mapRef = wizardRef.map;
        const wrappedX = (typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(worldX) : worldX;
        const wrappedY = (typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(worldY) : worldY;
        if (!Number.isFinite(wrappedX) || !Number.isFinite(wrappedY)) return;
        const snapped = getFloorEditorSnapVertexWorldPoint(wizardRef, options.screenX, options.screenY);
        const finalX = snapped ? snapped.x : wrappedX;
        const finalY = snapped ? snapped.y : wrappedY;
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
                worldX: finalX,
                worldY: finalY
            });
            finalizeFloorHolePlacement(wizardRef);
            return;
        }

        if (draft.points.length >= 3) {
            const start = draft.points[0];
            const click = { x: finalX, y: finalY };
            const closeDistancePx = getScreenDistancePxBetweenWorldPoints(start, click);
            if (closeDistancePx <= TRIGGER_AREA_CLOSE_DISTANCE_PX) {
                recordFloorEditDiagnostic("vertex.floorhole.finish.proximity", {
                    level,
                    pointsBeforeFinish: draft.points.length,
                    closeDistancePx,
                    worldX: finalX,
                    worldY: finalY
                });
                finalizeFloorHolePlacement(wizardRef);
                return;
            }
        }

        draft.points.push({ x: finalX, y: finalY });
        recordFloorEditDiagnostic("vertex.floorhole.add", {
            level,
            clickCount,
            pointsAfterAdd: draft.points.length,
            worldX: finalX,
            worldY: finalY
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
        const hasActiveFloorDraft = (
            (wizardRef.currentSpell === "floorshape" &&
                wizardRef._floorShapePlacementDraft &&
                Array.isArray(wizardRef._floorShapePlacementDraft.points) &&
                wizardRef._floorShapePlacementDraft.points.length > 0) ||
            (wizardRef.currentSpell === "floorhole" &&
                wizardRef._floorHolePlacementDraft &&
                Array.isArray(wizardRef._floorHolePlacementDraft.points) &&
                wizardRef._floorHolePlacementDraft.points.length > 0)
        );
        if (Number(castOptions.clickCount) >= 2 && !hasActiveFloorDraft && isFloorEditorDebugEditEnabled(wizardRef) && paintFloorPolygonAtWorldPoint(wizardRef, worldX, worldY)) {
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
            const teleportTarget = resolveVisibleFloorTarget(wizardRef, worldX, worldY, castOptions);
            if (typeof console !== "undefined" && typeof console.log === "function") {
                const floorFragment = teleportTarget && teleportTarget.floorTarget && teleportTarget.floorTarget.fragment
                    ? teleportTarget.floorTarget.fragment
                    : null;
                console.log("[TeleportDebug] resolved-target", {
                    inputWorldX: worldX,
                    inputWorldY: worldY,
                    screenX: teleportTarget && teleportTarget.screenX,
                    screenY: teleportTarget && teleportTarget.screenY,
                    resolvedX: teleportTarget && teleportTarget.x,
                    resolvedY: teleportTarget && teleportTarget.y,
                    layer: teleportTarget && teleportTarget.layer,
                    baseZ: teleportTarget && teleportTarget.baseZ,
                    hasNode: !!(teleportTarget && teleportTarget.node),
                    node: teleportTarget && teleportTarget.node ? {
                        xindex: teleportTarget.node.xindex,
                        yindex: teleportTarget.node.yindex,
                        traversalLayer: teleportTarget.node.traversalLayer,
                        baseZ: teleportTarget.node.baseZ,
                        fragmentId: teleportTarget.node.fragmentId,
                        surfaceId: teleportTarget.node.surfaceId
                    } : null,
                    floorTarget: floorFragment ? {
                        fragmentId: floorFragment.fragmentId,
                        surfaceId: floorFragment.surfaceId,
                        ownerSectionKey: floorFragment.ownerSectionKey,
                        level: floorFragment.level,
                        nodeBaseZ: floorFragment.nodeBaseZ,
                        renderedByBuildingCutaway: floorFragment.renderedByBuildingCutaway === true
                    } : null
                });
            }
            wizardRef.castDelay = true;
            const teleportFloorFragment = teleportTarget && teleportTarget.floorTarget && teleportTarget.floorTarget.fragment
                ? teleportTarget.floorTarget.fragment
                : null;
            projectiles.push(projectile.cast(teleportTarget.x, teleportTarget.y, {
                ...castOptions,
                destinationNode: teleportTarget.node,
                destinationLayer: teleportTarget.layer,
                destinationBaseZ: teleportTarget.baseZ,
                destinationFragmentId: teleportFloorFragment && typeof teleportFloorFragment.fragmentId === "string"
                    ? teleportFloorFragment.fragmentId
                    : "",
                destinationSurfaceId: teleportFloorFragment && typeof teleportFloorFragment.surfaceId === "string"
                    ? teleportFloorFragment.surfaceId
                    : "",
                teleportDebugTarget: teleportTarget
            }));
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

        if (wizardRef.currentSpell === "placebuilding") {
            placeSelectedBuilding(wizardRef, worldX, worldY, options || {});
            return;
        }

        if (wizardRef.currentSpell === "blackdiamond") {
            const mapRef = wizardRef.map || (typeof map !== "undefined" ? map : null);
            const placementTarget = typeof resolveEditorPlacementTarget === "function"
                ? resolveEditorPlacementTarget(wizardRef, worldX, worldY, castOptions)
                : {
                    x: worldX,
                    y: worldY,
                    layer: Number.isFinite(wizardRef.currentLayer) ? Math.round(Number(wizardRef.currentLayer)) : 0,
                    baseZ: Number.isFinite(wizardRef.currentLayerBaseZ) ? Number(wizardRef.currentLayerBaseZ) : 0,
                    node: null,
                    floorTarget: null
                };
            const placeBaseZ = Number.isFinite(placementTarget && placementTarget.baseZ)
                ? Number(placementTarget.baseZ)
                : 0;
            const placeLayer = Number.isFinite(placementTarget && placementTarget.layer)
                ? Math.round(Number(placementTarget.layer))
                : 0;
            const targetX = Number.isFinite(placementTarget && placementTarget.x) ? Number(placementTarget.x) : worldX;
            const targetY = Number.isFinite(placementTarget && placementTarget.y) ? Number(placementTarget.y) : worldY;
            const rawX = mapRef && typeof mapRef.wrapWorldX === "function"
                ? mapRef.wrapWorldX(targetX)
                : targetX;
            const rawY = mapRef && typeof mapRef.wrapWorldY === "function"
                ? mapRef.wrapWorldY(targetY)
                : targetY;
            const placeX = rawX;
            const placeY = rawY;
            const powerupPlacement = getPowerupPlacementPreviewConfig(wizardRef);
            if (Number.isFinite(placeX) && Number.isFinite(placeY) && typeof addPowerup === "function") {
                const placed = addPowerup(powerupPlacement.fileName, {
                    x: placeX,
                    y: placeY,
                    z: 0,
                    map: mapRef,
                    size: powerupPlacement.scale,
                    imagePath: powerupPlacement.imagePath,
                    width: powerupPlacement.width,
                    height: powerupPlacement.height,
                    radius: powerupPlacement.radius
                });
                if (placed) {
                    if (typeof globalThis.applyEditorPlacementSupport === "function") {
                        globalThis.applyEditorPlacementSupport(
                            placed,
                            mapRef,
                            {
                                ...placementTarget,
                                x: placeX,
                                y: placeY,
                                layer: placeLayer,
                                baseZ: placeBaseZ
                            },
                            placementTarget && placementTarget.node ? placementTarget.node : null,
                            { useLocalZ: true, localZ: 0 }
                        );
                    }
                    placed.traversalLayer = placeLayer;
                    placed.currentLayer = placeLayer;
                    placed.currentLayerBaseZ = placeBaseZ;
                    placed._floorBaseZ = placeBaseZ;
                    if (placementTarget && placementTarget.node) {
                        placed.node = placementTarget.node;
                    }
                    if (typeof placementTarget?.node?.surfaceId === "string") {
                        placed.surfaceId = placementTarget.node.surfaceId;
                    }
                    if (typeof placementTarget?.node?.fragmentId === "string") {
                        placed.fragmentId = placementTarget.node.fragmentId;
                    }
                }
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
            // Floor nodes don't have hasBlockingObject(), so guard the call.
            const nearestFreeNode = (candidate, wx, wy) => {
                if (!candidate) return null;
                const isNodeFree = (n) => !n.blocked && (typeof n.hasBlockingObject !== "function" || !n.hasBlockingObject());
                if (isNodeFree(candidate)) return candidate;
                let best = null;
                let bestDist = Infinity;
                for (let d = 0; d < 12; d++) {
                    const nb = candidate.neighbors[d];
                    if (!nb || !isNodeFree(nb)) continue;
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
                mapRef.screenWorldToNode(wizardRef.x, wizardRef.y),
                wizardRef.x, wizardRef.y
            );
            const destinationNode = nearestFreeNode(
                mapRef.screenWorldToNode(wrappedX, wrappedY),
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
                const key = `${node.xindex},${node.yindex},${Number.isFinite(node.traversalLayer) ? Math.round(node.traversalLayer) : 0}`;
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
                    const marker = addPowerup(POWERUP_PLACEMENT_FILE_NAME, {
                        x: node.x,
                        y: node.y,
                        map: mapRef
                    });
                    if (marker) {
                        marker.traversalLayer = Number.isFinite(node.traversalLayer)
                            ? Math.round(Number(node.traversalLayer)) : 0;
                    }
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

    function openBuildingSelector(wizardRef) {
        if (!wizardRef || !canUseEditorFeatures(wizardRef)) return;
        wizardRef.selectedEditorCategory = "buildings";
        setCurrentSpell(wizardRef, "placebuilding");
        spellMenuMode = "editor-items";
        editorMenuCategory = "buildings";
        $("#spellMenu").removeClass("hidden");
        renderEditorItemSelector(wizardRef, "buildings");
        fetchBuildingEditorSaves({ forceRefresh: true }).then(() => {
            if (spellMenuMode === "editor-items" && editorMenuCategory === "buildings") {
                renderEditorItemSelector(wizardRef, "buildings");
            }
        }).catch(error => console.error("[building placement] failed to list saves", error));
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
            const selectedTexture = category === "powerups"
                ? getPowerupEditorCategoryIcon(wizardRef)
                : (category === "buildings" ? BUILDING_EDITOR_ICON : getSelectedPlaceableTextureForCategory(wizardRef, category));
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
                    } else if (category === "buildings") {
                        wizardRef.selectedEditorCategory = "buildings";
                        setCurrentSpell(wizardRef, "placebuilding");
                        fetchBuildingEditorSaves().then(items => {
                            if (!getSelectedBuildingSaveName(wizardRef) && items.length > 0) {
                                setSelectedBuildingSaveName(wizardRef, items[0].name);
                            }
                        }).catch(error => console.error("[building placement] failed to list saves", error));
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
                    if (category === "buildings") {
                        openBuildingSelector(wizardRef);
                        return;
                    }
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
            if (category === "buildings") {
                icon.attr("data-spell", "placebuilding");
                icon.attr("data-opens-submenu", "true");
            }
            if (category !== "powerups" && category !== "buildings") {
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

        if (safeCategory === "buildings") {
            const selectedName = getSelectedBuildingSaveName(wizardRef);
            const renderBuildingItems = (items) => {
                if (!Array.isArray(items) || items.length === 0) {
                    const empty = $("<div>")
                        .css({
                            "color": "#fff",
                            "font-size": "12px",
                            "padding": "8px"
                        })
                        .text("No buildings");
                    $grid.append(empty);
                    return;
                }
                items.forEach(item => {
                    const name = normalizeBuildingSaveName(item && item.name);
                    if (!name) return;
                    const icon = $("<div>")
                        .addClass("spellIcon")
                        .css({
                            "background-image": `url('${BUILDING_EDITOR_ICON}')`,
                            "background-size": "cover",
                            "background-position": "center center",
                            "position": "relative"
                        })
                        .attr("title", name)
                        .click(() => {
                            setSelectedBuildingSaveName(wizardRef, name);
                            setCurrentSpell(wizardRef, "placebuilding");
                            fetchBuildingEditorSaveData(name).catch(error => console.error("[building placement] failed to load save", error));
                            spellMenuMode = "main";
                            refreshSpellSelector(wizardRef);
                            $("#spellMenu").addClass("hidden");
                        });
                    const label = $("<span>")
                        .text(name)
                        .css({
                            "position": "absolute",
                            "left": "3px",
                            "right": "3px",
                            "bottom": "3px",
                            "font-size": "10px",
                            "line-height": "10px",
                            "color": "#fff",
                            "text-align": "center",
                            "text-shadow": "1px 1px 2px #000",
                            "pointer-events": "none",
                            "overflow": "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap"
                        });
                    icon.append(label);
                    if (name === selectedName) {
                        icon.addClass("selected");
                    }
                    $grid.append(icon);
                });
            };
            if (Array.isArray(buildingEditorSaveList)) {
                renderBuildingItems(buildingEditorSaveList);
            } else {
                fetchBuildingEditorSaves().then(renderBuildingItems).catch(error => {
                    console.error("[building placement] failed to list saves", error);
                    renderBuildingItems([]);
                });
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
                const selectedTexture = category === "powerups"
                    ? getPowerupEditorCategoryIcon(wizardRef)
                    : (category === "buildings" ? BUILDING_EDITOR_ICON : getSelectedPlaceableTextureForCategory(wizardRef, category));
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
                        } else if (category === "buildings") {
                            wizardRef.selectedEditorCategory = "buildings";
                            setCurrentSpell(wizardRef, "placebuilding");
                            fetchBuildingEditorSaves().then(items => {
                                if (!getSelectedBuildingSaveName(wizardRef) && items.length > 0) {
                                    setSelectedBuildingSaveName(wizardRef, items[0].name);
                                }
                            }).catch(error => console.error("[building placement] failed to list saves", error));
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
                        if (category === "buildings") {
                            openBuildingSelector(wizardRef);
                            return;
                        }
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
                if (category === "buildings") {
                    catIcon.attr("data-spell", "placebuilding");
                    catIcon.attr("data-opens-submenu", "true");
                }
                if (category !== "powerups" && category !== "buildings") {
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
        } else if (spellName === "placebuilding") {
            wizardRef.selectedEditorCategory = "buildings";
            fetchBuildingEditorSaves().then(items => {
                if (!getSelectedBuildingSaveName(wizardRef) && items.length > 0) {
                    setSelectedBuildingSaveName(wizardRef, items[0].name);
                }
            }).catch(error => console.error("[building placement] failed to list saves", error));
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

    function showBuildingMenu(wizardRef) {
        openBuildingSelector(wizardRef);
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
        if (category === "buildings") {
            fetchBuildingEditorSaves({ forceRefresh: true }).then(() => {
                if (spellMenuMode === "editor-items" && editorMenuCategory === category) {
                    renderEditorItemSelector(wizardRef, category);
                }
            }).catch(error => console.error("[building placement] failed to list saves", error));
        } else if (category !== "powerups") {
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
        if (category === "buildings") {
            setCurrentSpell(wizardRef, "placebuilding");
            return "placebuilding";
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
        if (category === "buildings") {
            wizardRef.selectedEditorCategory = "buildings";
            setCurrentSpell(wizardRef, "placebuilding");
            return;
        }
        if (category === "powerups") {
            wizardRef.selectedEditorCategory = "powerups";
            setCurrentSpell(wizardRef, "blackdiamond");
            return;
        }
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
        showBuildingMenu,
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
        adjustBuildingPlacementRotation,
        resolveTreePlacementSize,
        resolveTreePlacementTextureVariant,
        clearTreePlacementPreviewSize,
        clearTreePlacementPreviewVariant,
        getPowerupPlacementPreviewConfig,
        getBuildingPlacementPreview,
        fetchBuildingEditorSaves,
        fetchBuildingEditorSaveData,
        getSelectedBuildingSaveName,
        setSelectedBuildingSaveName,
        beginDragSpell,
        updateDragPreview,
        completeDragSpell,
        cancelDragSpell,
        cancelTriggerAreaPlacement,
        cancelFloorShapePlacement,
        cancelFloorHolePlacement,
        beginFloorStairPlacement,
        updateFloorStairPlacement,
        endFloorStairPlacement,
        cancelFloorStairPlacement,
        insertTriggerAreaVertexOnEdge,
        beginTriggerAreaVertexDrag,
        updateTriggerAreaVertexDrag,
        endTriggerAreaVertexDrag,
        deleteSelectedTriggerAreaVertex,
        getTriggerAreaVertexSelection,
        insertFloorEditorVertexFromSelectedNeighbor,
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
        getFloorStairPlacementPreview,
        paintFloorPolygonAtWorldPoint,
        getVisibleFloorPolygonTargetAtScreenPoint,
        resolveVisibleFloorTarget,
        resolveEditorPlacementTarget,
        resolveTeleportVisualTarget,
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
    globalThis.resolveVisibleFloorTarget = SpellSystem.resolveVisibleFloorTarget;
    globalThis.resolveEditorPlacementTarget = SpellSystem.resolveEditorPlacementTarget;
}
