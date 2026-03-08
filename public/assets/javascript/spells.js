let spellKeyBindings = {
    "F": "fireball",
    "B": "wall",
    "D": "blackdiamond",
    "M": "maze",
    "V": "vanish",
    "T": "treegrow",
    "ET": "editscript",
    "J": "teleport",
    "R": "buildroad",
    "FW": "firewall",
    "A": "spawnanimal"
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
        { name: "maze", icon: "/assets/images/thumbnails/maze.png" },
        { name: "wall", icon: "/assets/images/thumbnails/wall.png" },
        { name: "vanish", icon: "/assets/images/thumbnails/vanish.png" },
        { name: "teleport", icon: "/assets/images/thumbnails/vanish.png" },
        { name: "treegrow", icon: "/assets/images/thumbnails/tree.png" },
        { name: "buildroad", icon: "/assets/images/thumbnails/road.png" },
        { name: "editscript", icon: "/assets/images/thumbnails/edit.png" },
        { name: "firewall", icon: "/assets/images/thumbnails/firewall.png" },
        { name: "spawnanimal", icon: "/assets/images/animals/squirrel.png" }
    ];
    const AURA_DEFS = [
        { name: "omnivision", icon: "/assets/images/thumbnails/eye.png", key: "O", magicPerSecond: 2 },
        { name: "speed", icon: "/assets/images/thumbnails/speed.png", key: "P", magicPerSecond: 2 },
        { name: "healing", icon: "/assets/images/thumbnails/cross.png", key: "H", magicPerSecond: 2 }
    ];

    const MAGIC_TICK_MS = 50;
    let healingAuraHpMultiplier = 10;
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
    const VANISH_WALL_TARGET_SEGMENT_LENGTH_WORLD = 1;
    const VANISH_BURST_SHOT_INTERVAL_MS = 45;
    const VANISH_MAGIC_COST_PER_CAST = 5;
    const PLACEABLE_ROTATION_STEP_DEGREES = 5;
    const POWERUP_PLACEMENT_FILE_NAME = "black diamond.png";
    const POWERUP_PLACEMENT_IMAGE_PATH = "/assets/images/powerups/black%20diamond.png";
    const POWERUP_PLACEMENT_DEFAULT_WIDTH = 0.8;
    const POWERUP_PLACEMENT_DEFAULT_HEIGHT = 0.8;
    const POWERUP_PLACEMENT_DEFAULT_RADIUS = 0.35;
    const POWERUP_PLACEMENT_SCALE_MIN = 0.2;
    const POWERUP_PLACEMENT_SCALE_MAX = 5;
    const POWERUP_PLACEMENT_SCALE_DEFAULT = 1;

    const SPELL_CLASS_BY_NAME = {
        fireball: "Fireball",
        vanish: "Vanish",
        editscript: "EditScript"
    };

    let magicIntervalId = null;
    let lastMagicTickMs = 0;
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
    const SCRIPT_EDITOR_PANEL_ID = "scriptEditorPanel";
    const SCRIPT_EDITOR_TEXTAREA_ID = "scriptEditorTextarea";
    const SCRIPT_EDITOR_TARGET_LABEL_ID = "scriptEditorTargetLabel";
    const SCRIPT_EDITOR_HELP_PANEL_ID = "scriptEditorHelpPanel";
    const SCRIPT_INIT_KEY = "__init";
    const SCRIPT_EDITOR_DEFAULT_TEMPLATE = [
        "playerExits {",
        "    mazeMode=true",
        "}",
        "",
        "playerEnters {",
        "    mazeMode=false",
        "}"
    ].join("\n");
    let scriptEditorTargetObject = null;

    function getScriptEditorHelpMarkup() {
        return [
            "<div style='font-weight:bold;font-size:16px;margin-bottom:8px;'>Script Help</div>",
            "<div style='margin-bottom:10px;'>Write scripts in block format. Scripts are saved as JSON internally.</div>",
            "<div style='font-weight:bold;margin-top:8px;'>Event Blocks</div>",
            "<pre style='white-space:pre-wrap;margin:6px 0 10px 0;'>playerExits {\n    mazeMode=true\n}\n\nplayerEnters {\n    mazeMode=false\n}\n\nplayerTouches {\n    healPlayer(5)\n}\n\nplayerUntouches {\n    drainMagic(10)\n}</pre>",
            "<div style='font-weight:bold;margin-top:8px;'>Statement Syntax</div>",
            "<ul style='margin:6px 0 10px 20px;padding:0;'>",
            "  <li>Assignments: <code>mazeMode=true</code></li>",
            "  <li>Object assignments: <code>this.tint=\"#ff8800\"</code>, <code>this.size=2</code>, <code>this.onfire=true</code></li>",
            "  <li>Commands: <code>transport(120, 88)</code>, <code>healPlayer(25)</code>, <code>hurtPlayer(10)</code>, <code>gainMagic(20)</code>, <code>drainMagic(15)</code>, <code>addSpell(\"fireball\")</code>, <code>this.delete()</code>, <code>spawnCreature(type=\"squirrel\", size=1, location={\"x\":0,\"y\":0})</code></li>",
            "  <li>Semicolons are optional; newline also ends a statement.</li>",
            "  <li>Top-level statements outside any event block run on script save and on fresh object creation (not on load).</li>",
            "</ul>",
            "<div style='font-weight:bold;margin-top:8px;'>Built-in Events</div>",
            "<ul style='margin:6px 0 10px 20px;padding:0;'>",
            "  <li><code>playerEnters</code>: fires when player crosses the door one way.</li>",
            "  <li><code>playerExits</code>: fires when player crosses the opposite way.</li>",
            "  <li><code>playerTouches</code>: fires once per contact (must leave and touch again to retrigger).</li>",
            "  <li><code>playerUntouches</code>: fires when contact is broken after moving away from an object.</li>",
            "</ul>",
            "<div style='font-weight:bold;margin-top:8px;'>Built-in Commands</div>",
            "<ul style='margin:6px 0 0 20px;padding:0;'>",
            "  <li><code>mazeMode=true/false</code> (assignment)</li>",
            "  <li><code>transport(x, y)</code></li>",
            "  <li><code>healPlayer(hp)</code></li>",
            "  <li><code>hurtPlayer(hp)</code></li>",
            "  <li><code>gainMagic(amount)</code></li>",
            "  <li><code>drainMagic(amount)</code></li>",
            "  <li><code>addSpell(name)</code></li>",
            "  <li><code>this.delete()</code></li>",
            "  <li><code>spawnCreature(type, size, location)</code> where <code>location</code> is relative to the scripted object</li>",
            "  <li><code>this.tint=#RRGGBB</code>, <code>this.size=number</code>, <code>this.onfire=true/false</code></li>",
            "</ul>"
        ].join("");
    }

    function getScriptEditorHelpPanel() {
        let $panel = $(`#${SCRIPT_EDITOR_HELP_PANEL_ID}`);
        if ($panel.length) return $panel;

        $panel = $("<div>")
            .attr("id", SCRIPT_EDITOR_HELP_PANEL_ID)
            .css({
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "min(760px, 84vw)",
                height: "min(560px, 74vh)",
                display: "none",
                "z-index": 200200,
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
            .html(getScriptEditorHelpMarkup())
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
            .on("click", () => closeScriptEditorHelpPanel());

        $actions.append($close);
        $panel.append($content, $actions);
        $(document.body).append($panel);
        return $panel;
    }

    function openScriptEditorHelpPanel() {
        getScriptEditorHelpPanel().show();
    }

    function closeScriptEditorHelpPanel() {
        $(`#${SCRIPT_EDITOR_HELP_PANEL_ID}`).hide();
    }

    function getScriptEditorPanel() {
        let $panel = $(`#${SCRIPT_EDITOR_PANEL_ID}`);
        if ($panel.length) return $panel;

        $panel = $("<div>")
            .attr("id", SCRIPT_EDITOR_PANEL_ID)
            .css({
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "min(820px, 85vw)",
                height: "min(540px, 72vh)",
                display: "none",
                "z-index": 200100,
                background: "rgba(15,15,15,0.96)",
                border: "1px solid #ffd700",
                "border-radius": "8px",
                padding: "12px",
                "box-sizing": "border-box",
                color: "#fff"
            })
            .on("mousedown click keydown keyup", event => {
                event.stopPropagation();
            });

        const $title = $("<div>")
            .text("Object Script Editor")
            .css({ "font-weight": "bold", "font-size": "16px" });

        const $help = $("<button>")
            .attr("type", "button")
            .text("?")
            .css({
                width: "24px",
                height: "24px",
                padding: "0",
                color: "#111",
                background: "#ffd700",
                border: "1px solid #caa700",
                "border-radius": "50%",
                cursor: "pointer",
                "font-weight": "bold",
                "line-height": "1"
            })
            .on("click", () => openScriptEditorHelpPanel());

        const $header = $("<div>")
            .css({
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                "margin-bottom": "6px"
            })
            .append($title, $help);

        const $target = $("<div>")
            .attr("id", SCRIPT_EDITOR_TARGET_LABEL_ID)
            .text("No target selected")
            .css({ "font-size": "12px", color: "#ddd", "margin-bottom": "8px" });

        const $textarea = $("<textarea>")
            .attr("id", SCRIPT_EDITOR_TEXTAREA_ID)
            .attr("placeholder", SCRIPT_EDITOR_DEFAULT_TEMPLATE)
            .css({
                width: "100%",
                height: "calc(100% - 90px)",
                "box-sizing": "border-box",
                resize: "none",
                border: "1px solid #666",
                "border-radius": "6px",
                background: "#0b0b0b",
                color: "#fff",
                padding: "10px",
                "font-family": "monospace",
                "font-size": "13px"
            });

        const $actions = $("<div>")
            .css({
                display: "flex",
                "justify-content": "flex-end",
                gap: "8px",
                "margin-top": "10px"
            });

        const $cancel = $("<button>")
            .text("Cancel")
            .css({
                padding: "6px 12px",
                color: "#fff",
                background: "#444",
                border: "1px solid #777",
                "border-radius": "4px",
                cursor: "pointer"
            })
            .on("click", () => closeScriptEditorPanel());

        const $save = $("<button>")
            .text("Save")
            .css({
                padding: "6px 12px",
                color: "#111",
                background: "#ffd700",
                border: "1px solid #caa700",
                "border-radius": "4px",
                cursor: "pointer",
                "font-weight": "bold"
            })
            .on("click", () => saveScriptEditorPanel());

        $actions.append($cancel, $save);
        $panel.append($header, $target, $textarea, $actions);
        $(document.body).append($panel);
        return $panel;
    }

    function closeScriptEditorPanel() {
        scriptEditorTargetObject = null;
        closeScriptEditorHelpPanel();
        $(`#${SCRIPT_EDITOR_PANEL_ID}`).hide();
    }

    function parseScriptEditorMixedFormat(rawText) {
        const text = String(rawText || "");
        let index = 0;
        const len = text.length;
        const out = {};
        const initStatements = [];
        let parsedAny = false;

        const isIdentStart = (ch) => /[A-Za-z_$]/.test(ch);
        const isIdentPart = (ch) => /[A-Za-z0-9_$]/.test(ch);

        const skipWhitespace = () => {
            while (index < len && /\s/.test(text[index])) {
                index += 1;
            }
        };

        while (index < len) {
            skipWhitespace();
            if (index >= len) break;

            const statementStart = index;

            if (isIdentStart(text[index])) {
                const identStart = index;
                index += 1;
                while (index < len && isIdentPart(text[index])) {
                    index += 1;
                }
                const ident = text.slice(identStart, index).trim();
                let lookahead = index;
                while (lookahead < len && /\s/.test(text[lookahead])) {
                    lookahead += 1;
                }
                if (ident && text[lookahead] === "{") {
                    index = lookahead + 1;
                    const bodyStart = index;
                    let depth = 1;
                    let inQuote = null;
                    let escapeNext = false;
                    while (index < len) {
                        const ch = text[index];
                        if (escapeNext) {
                            escapeNext = false;
                            index += 1;
                            continue;
                        }
                        if (ch === "\\") {
                            if (inQuote) {
                                escapeNext = true;
                            }
                            index += 1;
                            continue;
                        }
                        if (inQuote) {
                            if (ch === inQuote) inQuote = null;
                            index += 1;
                            continue;
                        }
                        if (ch === '"' || ch === "'") {
                            inQuote = ch;
                            index += 1;
                            continue;
                        }
                        if (ch === "{") depth += 1;
                        else if (ch === "}") {
                            depth -= 1;
                            if (depth === 0) break;
                        }
                        index += 1;
                    }
                    if (depth !== 0 || index >= len) return null;
                    const body = text.slice(bodyStart, index).trim();
                    out[ident] = body;
                    parsedAny = true;
                    index += 1;
                    continue;
                }
                index = statementStart;
            }

            let inQuote = null;
            let escapeNext = false;
            let depthParen = 0;
            let depthBrace = 0;
            let depthBracket = 0;
            while (index < len) {
                const ch = text[index];
                if (escapeNext) {
                    escapeNext = false;
                    index += 1;
                    continue;
                }
                if (ch === "\\") {
                    if (inQuote) escapeNext = true;
                    index += 1;
                    continue;
                }
                if (inQuote) {
                    if (ch === inQuote) inQuote = null;
                    index += 1;
                    continue;
                }
                if (ch === '"' || ch === "'") {
                    inQuote = ch;
                    index += 1;
                    continue;
                }
                if (ch === "(") depthParen += 1;
                else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
                else if (ch === "{") depthBrace += 1;
                else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);
                else if (ch === "[") depthBracket += 1;
                else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);

                const atTopLevel = depthParen === 0 && depthBrace === 0 && depthBracket === 0;
                if (atTopLevel && (ch === ";" || ch === "\n" || ch === "\r")) {
                    break;
                }
                index += 1;
            }

            const statement = text.slice(statementStart, index).trim();
            if (statement.length > 0) {
                initStatements.push(statement);
            }
            while (index < len && (text[index] === ";" || text[index] === "\n" || text[index] === "\r")) {
                index += 1;
            }
        }

        if (initStatements.length > 0) {
            out[SCRIPT_INIT_KEY] = initStatements.join(";\n");
            parsedAny = true;
        }

        return parsedAny ? out : null;
    }

    function parseScriptEditorInput(rawText) {
        const text = String(rawText || "").trim();
        if (text.length === 0) {
            return { ok: true, value: {} };
        }

        const parsedScript = parseScriptEditorMixedFormat(text);
        if (parsedScript && typeof parsedScript === "object") {
            return { ok: true, value: parsedScript };
        }

        return {
            ok: false,
            error: new Error("Invalid script format")
        };
    }

    function formatObjectScriptForEditor(target) {
        if (!target) return "";
        const source = target.script;
        if (source === undefined || source === null) return "";

        const formatScriptObjectAsBlocks = (scriptObj) => {
            if (!scriptObj || typeof scriptObj !== "object" || Array.isArray(scriptObj)) return null;
            const eventNames = Object.keys(scriptObj).filter(eventName => eventName !== SCRIPT_INIT_KEY);
            const sections = [];

            const rawInit = scriptObj[SCRIPT_INIT_KEY];
            const initParts = String(rawInit === undefined || rawInit === null ? "" : rawInit)
                .split(/\r?\n/)
                .flatMap(line => line.split(";"))
                .map(part => part.trim())
                .filter(Boolean);
            if (initParts.length > 0) {
                sections.push(initParts.map(part => `${part};`).join("\n"));
            }

            eventNames.forEach(eventName => {
                const rawBody = scriptObj[eventName];
                const parts = String(rawBody === undefined || rawBody === null ? "" : rawBody)
                    .split(/\r?\n/)
                    .flatMap(line => line.split(";"))
                    .map(part => part.trim())
                    .filter(Boolean);
                const body = parts.length > 0
                    ? `\n${parts.map(part => `    ${part};`).join("\n")}\n`
                    : "\n";
                sections.push(`${eventName} {${body}}`);
            });
            return sections.join("\n\n");
        };

        if (typeof source === "string") {
            const text = source.trim();
            if (!text.length) return "";
            const blockParsed = parseScriptEditorMixedFormat(text);
            if (blockParsed) {
                const formattedBlocks = formatScriptObjectAsBlocks(blockParsed);
                return formattedBlocks !== null ? formattedBlocks : text;
            }
            try {
                const parsed = (text.startsWith("{") || text.startsWith("["))
                    ? JSON.parse(text)
                    : JSON.parse(`{${text}}`);
                const formattedBlocks = formatScriptObjectAsBlocks(parsed);
                return formattedBlocks !== null ? formattedBlocks : text;
            } catch (_err) {
                return source;
            }
        }

        if (source && typeof source === "object" && !Array.isArray(source)) {
            const formattedBlocks = formatScriptObjectAsBlocks(source);
            if (formattedBlocks !== null) return formattedBlocks;
        }

        try {
            return JSON.stringify(source, null, 2);
        } catch (_err) {
            return String(source);
        }
    }

    function describeScriptTarget(target) {
        if (!target) return "Unknown object";
        const parts = [];
        if (typeof target.type === "string" && target.type.length > 0) {
            parts.push(target.type);
        }
        if (typeof target.category === "string" && target.category.length > 0) {
            parts.push(`(${target.category})`);
        }
        if (Number.isFinite(target.x) && Number.isFinite(target.y)) {
            parts.push(`@ ${Number(target.x).toFixed(2)}, ${Number(target.y).toFixed(2)}`);
        }
        return parts.join(" ");
    }

    function openScriptEditorForTarget(target) {
        if (!target || target.gone) return false;
        const $panel = getScriptEditorPanel();
        if (typeof globalThis !== "undefined" && typeof globalThis.releaseSpacebarCastingState === "function") {
            globalThis.releaseSpacebarCastingState();
        } else if (typeof keysPressed !== "undefined" && keysPressed) {
            keysPressed[" "] = false;
        }
        const textareaEl = $(`#${SCRIPT_EDITOR_TEXTAREA_ID}`).get(0);
        if (typeof globalThis !== "undefined" && typeof globalThis.armSpacebarTypingGuardForElement === "function") {
            globalThis.armSpacebarTypingGuardForElement(textareaEl);
        }
        scriptEditorTargetObject = target;
        $(`#${SCRIPT_EDITOR_TARGET_LABEL_ID}`).text(describeScriptTarget(target));
        $(`#${SCRIPT_EDITOR_TEXTAREA_ID}`).val(formatObjectScriptForEditor(target));
        $panel.show();
        setTimeout(() => {
            $(`#${SCRIPT_EDITOR_TEXTAREA_ID}`).trigger("focus");
        }, 0);
        return true;
    }

    function saveScriptEditorPanel() {
        if (!scriptEditorTargetObject) {
            closeScriptEditorPanel();
            return;
        }
        const text = $(`#${SCRIPT_EDITOR_TEXTAREA_ID}`).val();
        const parsed = parseScriptEditorInput(text);
        if (!parsed.ok) {
            message("Script is not valid. Use statements and/or event blocks.");
            return;
        }
        scriptEditorTargetObject.script = parsed.value;
        if (
            typeof globalThis !== "undefined" &&
            globalThis.Scripting &&
            typeof globalThis.Scripting.runObjectInitScript === "function"
        ) {
            globalThis.Scripting.runObjectInitScript(
                scriptEditorTargetObject,
                (typeof wizard !== "undefined") ? wizard : null,
                { reason: "scriptSaved" }
            );
        }
        message("Object script saved.");
        closeScriptEditorPanel();
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

    function normalizeActiveAuras(wizardRef) {
        if (!wizardRef) return [];
        const source = Array.isArray(wizardRef.activeAuras)
            ? wizardRef.activeAuras
            : (typeof wizardRef.activeAura === "string" ? [wizardRef.activeAura] : []);
        const unique = [];
        source.forEach(name => {
            if (typeof name !== "string") return;
            const def = getAuraDefinition(name);
            if (!def) return;
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

    function setActiveAuras(wizardRef, auraNames) {
        if (!wizardRef) return false;
        const previous = normalizeActiveAuras(wizardRef);
        const requested = Array.isArray(auraNames) ? auraNames : [];
        const next = [];
        requested.forEach(name => {
            const def = getAuraDefinition(name);
            if (!def) return;
            if (!next.includes(def.name)) next.push(def.name);
        });
        if (previous.length === next.length && previous.every((name, index) => name === next[index])) {
            return false;
        }
        wizardRef.activeAuras = next;
        wizardRef.activeAura = next.length > 0 ? next[0] : null; // backward compatibility
        refreshAuraSelector(wizardRef);
        return true;
    }

    function toggleAura(wizardRef, auraName) {
        if (!wizardRef) return false;
        const aura = getAuraDefinition(auraName);
        if (!aura) return false;
        const active = normalizeActiveAuras(wizardRef).slice();
        const idx = active.indexOf(aura.name);
        if (idx >= 0) {
            active.splice(idx, 1);
        } else {
            active.push(aura.name);
        }
        return setActiveAuras(wizardRef, active);
    }

    function getActiveAuraMagicDrainPerSecond(wizardRef) {
        const active = normalizeActiveAuras(wizardRef);
        if (!active.length) return 0;
        let total = 0;
        active.forEach(name => {
            const aura = getAuraDefinition(name);
            if (aura && Number.isFinite(aura.magicPerSecond)) {
                total += Math.max(0, aura.magicPerSecond);
            }
        });
        return total;
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
        if (wizardRef.selectedTreeTextureVariant === RANDOM_TREE_VARIANT) {
            return RANDOM_TREE_VARIANT;
        }
        const count = getTreeVariantCount(wizardRef);
        if (
            Number.isInteger(wizardRef.selectedTreeTextureVariant) &&
            wizardRef.selectedTreeTextureVariant >= 0 &&
            wizardRef.selectedTreeTextureVariant < count
        ) {
            return wizardRef.selectedTreeTextureVariant;
        }
        wizardRef.selectedTreeTextureVariant = RANDOM_TREE_VARIANT;
        return wizardRef.selectedTreeTextureVariant;
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

        // Apply baseSize / minSize / maxSize from item metadata
        const metaBaseSize = (meta && Number.isFinite(meta.baseSize) && meta.baseSize > 0) ? Number(meta.baseSize) : null;
        const metaMinSize = (meta && Number.isFinite(meta.minSize) && meta.minSize > 0) ? Number(meta.minSize) : null;
        const metaMaxSize = (meta && Number.isFinite(meta.maxSize) && meta.maxSize > 0) ? Number(meta.maxSize) : null;
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

    function getPowerupPlacementBaseData() {
        let imageData = null;
        if (typeof getPowerupImageDataByFile === "function") {
            imageData = getPowerupImageDataByFile(POWERUP_PLACEMENT_FILE_NAME);
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
        return {
            fileName: POWERUP_PLACEMENT_FILE_NAME,
            imagePath,
            width,
            height,
            radius
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

    function getPowerupPlacementPreviewConfig(wizardRef) {
        const base = getPowerupPlacementBaseData();
        const scale = getSelectedPowerupPlacementScale(wizardRef);
        return {
            fileName: base.fileName,
            imagePath: base.imagePath,
            width: Math.max(0.01, base.width * scale),
            height: Math.max(0.01, base.height * scale),
            radius: Math.max(0.01, base.radius * scale),
            scale
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

    function isEditorSpellName(spellName) {
        return spellName === "placeobject" || spellName === "blackdiamond";
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

    function startTreeGrowthChannel(wizardRef, targetTree, growthPerSecond = 1, magicPerSecond = 15, maxSize = 20) {
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
        if (!wizardRef || paused) return;
        const now = performance.now();
        if (!lastMagicTickMs) {
            lastMagicTickMs = now;
            return;
        }
        const dtSec = Math.max(0, (now - lastMagicTickMs) / 1000);
        lastMagicTickMs = now;

        const healingAuraActive = isAuraActive(wizardRef, "healing");
        const hpRegenMultiplier = healingAuraActive ? getHealingAuraHpMultiplier() : 1;
        wizardRef.healRateMultiplier = hpRegenMultiplier;
        const auraDrainPerSecond = getActiveAuraMagicDrainPerSecond(wizardRef);
        const auraActive = auraDrainPerSecond > 0;
        const magicRegenPerSecond = Number.isFinite(wizardRef.magicRegenPerSecond)
            ? Math.max(0, wizardRef.magicRegenPerSecond)
            : 0;
        if (wizardRef.magic < wizardRef.maxMagic) {
            wizardRef.magic = Math.min(wizardRef.maxMagic, wizardRef.magic + magicRegenPerSecond * dtSec);
        }
        if (auraActive) {
            const auraCost = auraDrainPerSecond * dtSec;
            if (wizardRef.magic < auraCost) {
                setActiveAuras(wizardRef, []);
            } else {
                wizardRef.magic = Math.max(0, wizardRef.magic - auraCost);
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
        if (wizardRef.magic < magicCost) {
            stopTreeGrowthChannel(wizardRef, false);
            return;
        }

        wizardRef.magic = Math.max(0, wizardRef.magic - magicCost);
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
        if (spellName === "vanish") return !!wizardRef.vanishDragMode;
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
        if (spellName === "vanish") {
            wizardRef.vanishDragMode = false;
            resetVanishDragTargetingState(wizardRef);
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

    function hasSpellAlreadyTargetedObject(wizardRef, spellName, obj) {
        if (!wizardRef || !spellName || !obj) return false;
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
        if (!wizardRef || !spellName || !obj) return;
        const setForSpell = getSpellTargetHistorySet(wizardRef, spellName);
        if (setForSpell) {
            setForSpell.add(obj);
        }
    }

    function getTargetAimPoint(wizardRef, target) {
        if (!target || target.gone) return null;
        if (Number.isFinite(target.x) && Number.isFinite(target.y)) {
            return { x: Number(target.x), y: Number(target.y) };
        }
        if (
            target.type === "wallSection" &&
            target.startPoint && target.endPoint &&
            Number.isFinite(target.startPoint.x) && Number.isFinite(target.startPoint.y) &&
            Number.isFinite(target.endPoint.x) && Number.isFinite(target.endPoint.y)
        ) {
            const mapRef = (wizardRef && wizardRef.map) || null;
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
            return { x, y };
        }
        return null;
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
        if (wizardRef.currentSpell !== "vanish") return false;
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
        markObjectAsTargetedBySpell(wizardRef, "vanish", candidate);
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

    function castQueuedVanishBurst(wizardRef, queuedTargets = []) {
        if (!wizardRef || !Array.isArray(queuedTargets) || queuedTargets.length === 0) return false;

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
                const projectile = new globalThis.Vanish();
                const requiredMagic = Math.max(15, Number.isFinite(projectile.magicCost) ? Number(projectile.magicCost) : 0);
                if (wizard.magic < requiredMagic) {
                    finishBurst();
                    return;
                }

                const aim = getTargetAimPoint(wizardRef, target);
                if (aim && Number.isFinite(aim.x) && Number.isFinite(aim.y)) {
                    projectile.forcedTarget = target;
                    markObjectAsTargetedBySpell(wizardRef, "vanish", target);
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
        const verticalOffset = (1 - selectedAnchorY) * windowWorldHeight;
        let snappedX = desiredBaseX;
        let snappedY = isDoorPlacement
            ? (desiredBaseY - verticalOffset)
            : desiredBaseY;
        const snappedZ = (category === "windows") ? (wallHeight * 0.5) : 0;
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
        return roofApi.getPlacementCandidate(wizardRef, worldX, worldY, { maxDepth: 12 });
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

        if (spellName === "vanish") {
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
            if (wizardRef.currentSpell === "vanish") cancelDragSpell(wizardRef, "vanish");
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
        if (wizardRef.currentSpell === "vanish" && wizardRef.vanishDragMode) {
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
                const result = WallSectionUnit.createPlacementFromWorldPoints(
                    wizardRef.map, placementStartPoint, placementEndPoint, {
                        thickness,
                        height,
                        bottomZ: 0,
                        wallTexturePath,
                        ...placementOptions
                    }
                );
                if (result && Array.isArray(result.sections)) {
                    for (let i = 0; i < result.sections.length; i++) {
                        result.sections[i].addToMapNodes();
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
            roadNodes.forEach(node => {
                const hasRoad = node.objects && node.objects.some(obj => obj.type === "road");
                if (!hasRoad) {
                    new Road({x: node.x, y: node.y}, [], wizardRef.map, {
                        fillTexturePath: getSelectedFlooringTexture(wizardRef)
                    });
                }
            });
            wizardRef.magic -= 5;
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

        if (spellName === "vanish") {
            if (!isDragSpellActive(wizardRef, "vanish")) return false;
            if (Number.isFinite(worldX) && Number.isFinite(worldY)) {
                queueVanishDragTargetAtPoint(wizardRef, worldX, worldY);
            }
            const burstTargets = buildVanishBurstTargetsFromQueuedState(wizardRef);
            cancelDragSpell(wizardRef, "vanish");
            if (burstTargets.length === 0) return true;
            castQueuedVanishBurst(wizardRef, burstTargets);
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

        return nearbyObjects;
    }

    function updateCharacterObjectCollisions(wizardRef) {
        if (!wizardRef || !wizardRef.map) return;
        const activeFirewalls = Number(
            (typeof globalThis !== "undefined" && globalThis.activeFirewallEmitterCount)
                ? globalThis.activeFirewallEmitterCount
                : 0
        );
        if (activeFirewalls <= 0) return;
        if (wizardRef.gone || wizardRef.dead) return;
        const target = wizardRef;
        const targetHitbox = target.visualHitbox || target.groundPlaneHitbox || target.hitbox;
        if (!targetHitbox) return;
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

    function getObjectTargetAt(wizardRef, worldX, worldY) {
        const activeSpell = wizardRef ? wizardRef.currentSpell : null;
        const canTargetObject = (obj) => !!(
            obj &&
            !obj.gone &&
            !obj.vanishing &&
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

    function castWizardSpell(wizardRef, worldX, worldY) {
        if (!wizardRef || wizardRef.castDelay) return;

        if (wizardRef.currentSpell === "vanish" && isDragSpellActive(wizardRef, "vanish")) {
            completeDragSpell(wizardRef, "vanish", worldX, worldY);
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
            const mapRef = wizardRef.map || (typeof map !== "undefined" ? map : null);
            if (
                !mapRef ||
                typeof mapRef.worldToNode !== "function" ||
                typeof mapRef.findPathAStar !== "function"
            ) {
                message("Pathfinding is unavailable.");
                return;
            }

            const wrappedX = typeof mapRef.wrapWorldX === "function" ? mapRef.wrapWorldX(worldX) : worldX;
            const wrappedY = typeof mapRef.wrapWorldY === "function" ? mapRef.wrapWorldY(worldY) : worldY;
            const startNode = mapRef.worldToNode(wizardRef.x, wizardRef.y);
            const destinationNode = mapRef.worldToNode(wrappedX, wrappedY);

            if (!startNode || !destinationNode) {
                message("Cannot find a path there.");
                return;
            }

            const directDx = (typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(startNode.x, destinationNode.x)
                : (destinationNode.x - startNode.x);
            const directDy = (typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(startNode.y, destinationNode.y)
                : (destinationNode.y - startNode.y);
            const directDistance = Math.hypot(directDx, directDy);
            const maxIterations = Math.max(
                800,
                Math.min(12000, Math.floor((directDistance + 8) * 180))
            );

            const astarPath = mapRef.findPathAStar(startNode, destinationNode, {
                maxIterations
            });

            if (!Array.isArray(astarPath)) {
                message("No path found.");
                return;
            }

            const nodesAlongPath = [startNode, ...astarPath];
            const seenNodes = new Set();
            for (let i = 0; i < nodesAlongPath.length; i++) {
                const node = nodesAlongPath[i];
                if (!node) continue;
                const key = `${node.xindex},${node.yindex}`;
                if (seenNodes.has(key)) continue;
                seenNodes.add(key);
                if (typeof addPowerup === "function") {
                    addPowerup("black diamond.png", {
                        x: node.x,
                        y: node.y,
                        map: mapRef
                    });
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

        let clickTarget = getObjectTargetAt(wizardRef, worldX, worldY);
        if (wizardRef.currentSpell === "editscript") {
            if (!keysPressed[" "]) return;
            if (!clickTarget) {
                message("Hold space and click an object to edit its script.");
                return;
            }
            openScriptEditorForTarget(clickTarget);
            return;
        }
        if (wizardRef.currentSpell === "treegrow") clickTarget = null;
        if (
            wizardRef.currentSpell === "treegrow" &&
            keysPressed[" "] &&
            (
                wizardRef.treeGrowHoldLocked ||
                (
                    wizardRef.treeGrowthChannel &&
                    wizardRef.treeGrowthChannel.targetTree &&
                    !wizardRef.treeGrowthChannel.targetTree.gone
                )
            )
        ) {
            return;
        }
        let projectile = null;

        if (wizardRef.currentSpell === "grenades") {
            if (!wizardRef.inventory.includes("grenades") || wizardRef.inventory.grenades <= 0) return;
            wizardRef.inventory.grenades--;
            projectile = new globalThis.Grenade();
        } else if (wizardRef.currentSpell === "rocks") {
            projectile = new globalThis.Rock();
        } else if (wizardRef.currentSpell === "fireball") {
            projectile = new globalThis.Fireball();
        } else if (wizardRef.currentSpell === "vanish") {
            projectile = new globalThis.Vanish();
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
        if (clickTarget) {
            projectile.forcedTarget = clickTarget;
            markObjectAsTargetedBySpell(wizardRef, wizardRef.currentSpell, clickTarget);
        }
        const delayTime = projectile.delayTime || wizardRef.cooldownTime;
        wizardRef.castDelay = true;
        projectiles.push(projectile.cast(worldX, worldY));
        wizardRef.casting = true;
        setTimeout(() => {
            wizardRef.castDelay = false;
            wizardRef.casting = false;
        }, 1000 * delayTime);
    }

    function buildSpellList(wizardRef) {
        return SPELL_DEFS.map(spell => {
            const key = spell.name === "firewall"
                ? "F+W"
                : spell.name === "editscript"
                    ? "E+T"
                    : Object.keys(spellKeyBindings).find(k => spellKeyBindings[k] === spell.name);
            if (spell.name === "wall") {
                return {...spell, key, icon: getWallSpellIcon(wizardRef)};
            }
            if (spell.name === "buildroad") {
                return {...spell, key, icon: getRoadSpellIcon(wizardRef)};
            }
            if (spell.name === "treegrow") {
                return {...spell, key, icon: getTreeSpellIcon(wizardRef)};
            }
            if (spell.name === "spawnanimal") {
                return {...spell, key, icon: getSpawnAnimalSpellIcon(wizardRef)};
            }
            return {...spell, key};
        });
    }

    function refreshAuraSelector(wizardRef) {
        const $selectedAura = $("#selectedAura");
        if ($selectedAura.length) {
            $selectedAura.css("background-image", `url('${AURA_MENU_ICON}')`);
        }

        const activeAuraNames = getActiveAuraNames(wizardRef);
        const $activeAuraIcons = $("#activeAuraIcons");
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

        const $grid = $("#auraGrid");
        if (!$grid.length) return;
        $grid.empty();

        AURA_DEFS.forEach(aura => {
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
                    $("#editorMenu").addClass("hidden");
                })
                .on("contextmenu", event => {
                    event.preventDefault();
                    event.stopPropagation();
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
            if (selectedEditorCategory === category) {
                icon.addClass("selected");
            }
            $grid.append(icon);
        });
    }

    function renderEditorItemSelector(wizardRef, category) {
        const safeCategory = EDITOR_CATEGORIES.includes(category) ? category : DEFAULT_PLACEABLE_CATEGORY;
        editorMenuCategory = safeCategory;
        const $grid = $("#editorGrid");
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
                editorMenuMode = "categories";
                renderEditorCategorySelector(wizardRef);
            });
        $grid.append(backButton);

        if (safeCategory === "powerups") {
            const preview = getPowerupPlacementPreviewConfig(wizardRef);
            const texturePath = (preview && typeof preview.imagePath === "string" && preview.imagePath.length > 0)
                ? preview.imagePath
                : POWERUP_PLACEMENT_IMAGE_PATH;
            const icon = $("<div>")
                .addClass("spellIcon")
                .css({
                    "background-image": `url('${texturePath}')`,
                    "background-size": "cover",
                    "background-position": "center center"
                })
                .attr("title", "blackdiamond")
                .click(() => {
                    wizardRef.selectedEditorCategory = "powerups";
                    setCurrentSpell(wizardRef, "blackdiamond");
                    refreshEditorSelector(wizardRef);
                    $("#editorMenu").addClass("hidden");
                });
            $grid.append(icon);
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
                    "background-position": "center center"
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
                    refreshEditorSelector(wizardRef);
                    $("#editorMenu").addClass("hidden");
                });
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

            const $overhangLabel = $("<div>")
                .text(`Overhang: ${roofOverhang.toFixed(4)} map units`)
                .css({ color: "#ffffff", "font-size": "13px" });
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
        const $selectedEditor = $("#selectedEditor");
        if ($selectedEditor.length) {
            $selectedEditor.css("background-image", `url('${getSelectedEditorIcon(wizardRef)}')`);
        }
        if (editorMenuMode === "items") {
            renderEditorItemSelector(wizardRef, editorMenuCategory || normalizeSelectedEditorCategory(wizardRef));
            return;
        }
        renderEditorCategorySelector(wizardRef);
    }

    function openEditorSelector(wizardRef) {
        editorMenuMode = "categories";
        $("#editorMenu").removeClass("hidden");
        editorMenuCategory = normalizeSelectedEditorCategory(wizardRef);
        renderEditorCategorySelector(wizardRef);
        fetchPlaceableImages({ forceRefresh: true }).then(() => {
            if (editorMenuMode === "items") {
                renderEditorItemSelector(wizardRef, editorMenuCategory || normalizeSelectedEditorCategory(wizardRef));
            } else if (editorMenuMode === "categories") {
                renderEditorCategorySelector(wizardRef);
            }
        });
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
                    renderWallSelector(wizardRef);
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
        spellMenuMode = "wall";
        $("#spellMenu").removeClass("hidden");
        renderWallSelector(wizardRef);
        fetchWallTextures().then(() => {
            if (spellMenuMode === "wall") {
                renderWallSelector(wizardRef);
            }
        });
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
                    renderAnimalSelector(wizardRef);
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
            .text(`Size: ${Math.round(currentScale * 100)}%`)
            .css({ color: "#ffffff", "font-size": "13px" });
        const $sizeSlider = $("<input>")
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
                $sizeLabel.text(`Size: ${Math.round(scale * 100)}%`);
            });

        $grid.append($("<div>").text("Animal Size").css({ color: "#ffffff", "font-weight": "bold" }));
        $grid.append($sizeSlider);
        $grid.append($sizeLabel);
    }

    function openAnimalSelector(wizardRef) {
        spellMenuMode = "animal";
        $("#spellMenu").removeClass("hidden");
        renderAnimalSelector(wizardRef);
    }

    function refreshSpellSelector(wizardRef) {
        if (!wizardRef) return;
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
        if (spellMenuMode === "animal") {
            renderAnimalSelector(wizardRef);
            return;
        }
        $("#spellGrid").css({
            display: "",
            "flex-direction": "",
            gap: ""
        });
        wizardRef.spells = buildSpellList(wizardRef);
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
            $("#selectedSpell").css(selCss);
        }

        $("#spellGrid").empty();
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
            $("#spellGrid").append(spellIcon);
        });
    }

    function setCurrentSpell(wizardRef, spellName) {
        if (!wizardRef) return;
        const previousSpell = wizardRef.currentSpell;
        spellMenuMode = "main";
        if (spellName !== "editscript") {
            closeScriptEditorPanel();
        }
        if (spellName !== "wall") cancelDragSpell(wizardRef, "wall");
        if (spellName !== "buildroad") cancelDragSpell(wizardRef, "buildroad");
        if (spellName !== "firewall") cancelDragSpell(wizardRef, "firewall");
        if (spellName !== "vanish") cancelDragSpell(wizardRef, "vanish");
        wizardRef.currentSpell = spellName;
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
        refreshSpellSelector(wizardRef);
        refreshEditorSelector(wizardRef);
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
        getSelectedPowerupPlacementScale(wizardRef);
        getSelectedWallHeight(wizardRef);
        getSelectedWallThickness(wizardRef);
        getSelectedWallTexture(wizardRef);
        getSelectedRoadWidth(wizardRef);
        getSelectedRoofOverhang(wizardRef);
        getSelectedRoofPeakHeight(wizardRef);
        wizardRef.spells = buildSpellList(wizardRef);
        normalizeActiveAuras(wizardRef);
        if (
            !wizardRef.currentSpell ||
            (!wizardRef.spells.some(s => s.name === wizardRef.currentSpell) && !isEditorSpellName(wizardRef.currentSpell))
        ) {
            wizardRef.currentSpell = "wall";
        }
        wizardRef.refreshSpellSelector = () => refreshSpellSelector(wizardRef);
        wizardRef.refreshEditorSelector = () => refreshEditorSelector(wizardRef);
        // Keep startup spell state consistent with manual spell re-selection.
        setCurrentSpell(wizardRef, wizardRef.currentSpell);
        setEditorPanelVisible(wizardRef, wizardRef.showEditorPanel !== false);
        refreshAuraSelector(wizardRef);
        fetchFlooringTextures();
        fetchWallTextures();
        fetchPlaceableImages().then(() => {
            normalizePlaceableSelections(wizardRef);
            refreshSelectedPlaceableMetadata(wizardRef);
            wizardRef.spells = buildSpellList(wizardRef);
            refreshSpellSelector(wizardRef);
            refreshEditorSelector(wizardRef);
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

    function showAnimalMenu(wizardRef) {
        if (!wizardRef) return;
        setCurrentSpell(wizardRef, "spawnanimal");
        openAnimalSelector(wizardRef);
    }

    function showEditorMenu(wizardRef) {
        if (!wizardRef) return;
        openEditorSelector(wizardRef);
    }

    function showEditorSubmenuForSelectedCategory(wizardRef) {
        if (!wizardRef) return;
        const category = normalizeSelectedEditorCategory(wizardRef);
        editorMenuMode = "items";
        editorMenuCategory = category;
        $("#editorMenu").removeClass("hidden");
        renderEditorItemSelector(wizardRef, category);
        if (category !== "powerups") {
            fetchPlaceableImages({ forceRefresh: true }).then(() => {
                if (editorMenuMode === "items" && editorMenuCategory === category) {
                    renderEditorItemSelector(wizardRef, category);
                }
            });
        }
    }

    function setEditorPanelVisible(wizardRef, visible) {
        if (!wizardRef) return;
        wizardRef.showEditorPanel = !!visible;
        if (wizardRef.showEditorPanel) {
            $("#editorSelector").removeClass("hidden");
            refreshEditorSelector(wizardRef);
        } else {
            $("#editorSelector").addClass("hidden");
            $("#editorMenu").addClass("hidden");
        }
    }

    function toggleEditorPanelVisible(wizardRef) {
        if (!wizardRef) return false;
        const next = !(wizardRef.showEditorPanel !== false);
        setEditorPanelVisible(wizardRef, next);
        return next;
    }

    function activateSelectedEditorTool(wizardRef) {
        if (!wizardRef) return null;
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

    function showPlaceableMenu(wizardRef) {
        if (!wizardRef) return;
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
        refreshSpellSelector,
        refreshAuraSelector,
        setCurrentSpell,
        toggleAura,
        isAuraActive,
        showMainSpellMenu,
        showFlooringMenu,
        showTreeMenu,
        showWallMenu,
        showAnimalMenu,
        showEditorMenu,
        showEditorSubmenuForSelectedCategory,
        showPlaceableMenu,
        refreshEditorSelector,
        setEditorPanelVisible,
        toggleEditorPanelVisible,
        activateSelectedEditorTool,
        isEditorSpellName,
        adjustPlaceableRenderOffset,
        adjustPlaceableScale,
        adjustPowerupPlacementScale,
        adjustPlaceableRotation,
        getPowerupPlacementPreviewConfig,
        beginDragSpell,
        updateDragPreview,
        completeDragSpell,
        cancelDragSpell,
        isDragSpellActive,
        primeSpellAssets,
        startMagicInterval,
        stopMagicInterval,
        setHealingAuraHpMultiplier,
        startTreeGrowthChannel,
        stopTreeGrowthChannel,
        updateCharacterObjectCollisions
        ,
        getHoverTargetForCurrentSpell,
        isValidHoverTargetForCurrentSpell,
        getVanishWallPreviewPolygonForHover,
        getVanishDragHighlightState,
        getDragStartSnapTargetForSpell,
        getPlaceObjectPlacementCandidate,
        getAdjustedWallDragWorldPoint
    };
})();
