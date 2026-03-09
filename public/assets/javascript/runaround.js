const mapWidth = 400;
const mapHeight = 400;
let frameRate = 60;
let frameCount = 0;
let renderNowMs = 0;
const renderMaxFps = 0; // 0 = uncapped (vsync-limited)
const wizardDirectionRowOffset = 0; // 0 when row 0 faces left. Adjust to align sprite sheet rows.
const wizardMouseTurnZeroDistanceUnits = 1;
const wizardMouseTurnFullDistanceUnits = 3;

let viewport = {width: 0, height: 0, innerWindow: {width: 0, height: 0}, x: 488, y: 494, prevX: 488, prevY: 494}
let renderAlpha = 1;
let viewScale = 1;
let xyratio = 0.66; // Adjust for isometric scaling (height/width ratio)
let projectiles = [];
let animals = [];
let powerups = (typeof globalThis !== "undefined" && Array.isArray(globalThis.powerups)) ? globalThis.powerups : [];
let mousePos = {x: 0, y: 0, clientX: NaN, clientY: NaN};
const ENABLE_POINTER_LOCK = false;
let pointerLockActive = false;
let pointerLockAimWorld = {x: NaN, y: NaN};
let pointerLockSensitivity = 1.0;
let pendingPointerLockEntry = null;
let pointerLockRangeDragInput = null;
var messages = [];
let keysPressed = {}; // Track which keys are currently pressed
let spacebarDownAt = null;
let spellMenuKeyboardIndex = -1;
let auraMenuKeyboardIndex = -1;
let suppressNextCanvasMenuClose = false;

if (typeof globalThis !== "undefined") {
    globalThis.releaseSpacebarCastingState = function releaseSpacebarCastingState() {
        keysPressed[" "] = false;
        spacebarDownAt = null;
    };

    globalThis.armSpacebarTypingGuardForElement = function armSpacebarTypingGuardForElement(targetEl) {
        const el = targetEl;
        if (!el || typeof el.addEventListener !== "function") return;
        el.__suppressHeldSpaceUntilKeyup = true;
        if (el.__spacebarTypingGuardBound) return;
        el.__spacebarTypingGuardBound = true;

        el.addEventListener("keydown", event => {
            if ((event.key === " " || event.code === "Space") && el.__suppressHeldSpaceUntilKeyup) {
                event.preventDefault();
                event.stopPropagation();
            }
        });

        el.addEventListener("keyup", event => {
            if (event.key === " " || event.code === "Space") {
                el.__suppressHeldSpaceUntilKeyup = false;
                event.stopPropagation();
            }
        });
    };

    globalThis.isTextEntryElement = function isTextEntryElement(targetEl) {
        if (!targetEl || typeof targetEl !== "object") return false;
        if (targetEl.isContentEditable) return true;
        const tag = (targetEl.tagName || "").toLowerCase();
        if (tag === "textarea") return true;
        if (tag !== "input") return false;
        const type = String(targetEl.type || "text").toLowerCase();
        const blockedTypes = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);
        return !blockedTypes.has(type);
    };
}

if (typeof document !== "undefined") {
    document.addEventListener("focusin", event => {
        const target = event && event.target;
        if (!(typeof globalThis !== "undefined" && typeof globalThis.isTextEntryElement === "function" && globalThis.isTextEntryElement(target))) {
            return;
        }
        if (typeof globalThis !== "undefined" && typeof globalThis.releaseSpacebarCastingState === "function") {
            globalThis.releaseSpacebarCastingState();
        }
        if (typeof globalThis !== "undefined" && typeof globalThis.armSpacebarTypingGuardForElement === "function") {
            globalThis.armSpacebarTypingGuardForElement(target);
        }
    }, true);
}

let textures = {};
let fireFrames = null;
const runaroundViewportNodeSampleEpsilon = 1e-4;

function applyViewportWrapShift(deltaX, deltaY) {
    if (!map) return;
    const eps = 1e-6;

    if (Math.abs(deltaX) > eps) {
        viewport.x += deltaX;
        if (Number.isFinite(mousePos.worldX)) mousePos.worldX += deltaX;
        if (Number.isFinite(pointerLockAimWorld.x)) pointerLockAimWorld.x += deltaX;
    }
    if (Math.abs(deltaY) > eps) {
        viewport.y += deltaY;
        if (Number.isFinite(mousePos.worldY)) mousePos.worldY += deltaY;
        if (Number.isFinite(pointerLockAimWorld.y)) pointerLockAimWorld.y += deltaY;
    }

    if (Number.isFinite(mousePos.worldX) && typeof map.wrapWorldX === "function") mousePos.worldX = map.wrapWorldX(mousePos.worldX);
    if (Number.isFinite(mousePos.worldY) && typeof map.wrapWorldY === "function") mousePos.worldY = map.wrapWorldY(mousePos.worldY);
    if (Number.isFinite(pointerLockAimWorld.x) && typeof map.wrapWorldX === "function") pointerLockAimWorld.x = map.wrapWorldX(pointerLockAimWorld.x);
    if (Number.isFinite(pointerLockAimWorld.y) && typeof map.wrapWorldY === "function") pointerLockAimWorld.y = map.wrapWorldY(pointerLockAimWorld.y);
}

function worldToNodeCanonical(worldX, worldY) {
    if (!map || !map.nodes) return null;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
    const wrappedX = (map && typeof map.wrapWorldX === "function") ? map.wrapWorldX(worldX) : worldX;
    const wrappedY = (map && typeof map.wrapWorldY === "function") ? map.wrapWorldY(worldY) : worldY;
    const approxX = Math.round(wrappedX / 0.866);
    const clampedX = Math.max(0, Math.min(map.width - 1, approxX));
    const approxY = Math.round(wrappedY - (clampedX % 2 === 0 ? 0.5 : 0));
    const clampedY = Math.max(0, Math.min(map.height - 1, approxY));
    return (map.nodes[clampedX] && map.nodes[clampedX][clampedY]) ? map.nodes[clampedX][clampedY] : null;
}

function getViewportCornerNodes() {
    if (!map) {
        return { startNode: null, endNode: null };
    }
    const sampleMaxX = viewport.x + Math.max(0, viewport.width - runaroundViewportNodeSampleEpsilon);
    const sampleMaxY = viewport.y + Math.max(0, viewport.height - runaroundViewportNodeSampleEpsilon);
    return {
        startNode: worldToNodeCanonical(viewport.x, viewport.y),
        endNode: worldToNodeCanonical(sampleMaxX, sampleMaxY)
    };
}

// Pixi.js setup
const app = new PIXI.Application({
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: 0x000000,
    antialias: true
});

// Game rendering layers
let gameContainer = new PIXI.Container();
let landLayer = new PIXI.Container();
let roadLayer = new PIXI.Container();
let gridLayer = new PIXI.Container();
let neighborDebugLayer = new PIXI.Container();
let opaqueMeshLayer = new PIXI.Container();
let objectLayer = new PIXI.Container();
let roofLayer = new PIXI.Container();
let characterLayer = new PIXI.Container();
let projectileLayer = new PIXI.Container();
let hitboxLayer = new PIXI.Container();
let cursorLayer = new PIXI.Container();

app.stage.addChild(gameContainer);
gameContainer.addChild(landLayer);
gameContainer.addChild(roadLayer);
gameContainer.addChild(gridLayer);
gameContainer.addChild(neighborDebugLayer);
gameContainer.addChild(opaqueMeshLayer);
opaqueMeshLayer.sortableChildren = false;
gameContainer.addChild(objectLayer);
gameContainer.addChild(roofLayer);
gameContainer.addChild(characterLayer);
gameContainer.addChild(projectileLayer);
gameContainer.addChild(hitboxLayer);
// Keep cursor unmasked so it remains visible outside indoor visibility masks.
app.stage.addChild(cursorLayer);

let landTileSprite = null;
let gridGraphics = null;
let hitboxGraphics = null;
let groundPlaneHitboxGraphics = null;
let wizardBoundaryGraphics = null;
let wizardFrames = []; // Array of frame textures for wizard animation
let wizard = null;
let cursorSprite = null; // Cursor sprite that points away from wizard
let spellCursor = null; // Alternate cursor for spacebar mode (line art)
let animalPreviewSprite = null; // Semi-transparent preview for SpawnAnimal spell
let onscreenObjects = new Set(); // Track visible staticObjects each frame
let activeSimObjects = new Set(); // Static objects needing per-tick simulation (on fire, growing, falling)
const roadWidth = 3;

function isWindowLikeObject(obj) {
    if (!obj) return false;
    if (obj.type === "window") return true;
    if (obj.type === "placedObject" && typeof obj.category === "string") {
        return obj.category.trim().toLowerCase() === "windows";
    }
    return false;
}

function formatWindowWallLinkDebugSummary() {
    const objects = Array.from(onscreenObjects || []);
    const walls = objects.filter(obj => obj && obj.type === "wallSection");
    const windows = objects.filter(isWindowLikeObject);
    const onscreenWallGroups = new Set(
        walls
            .map(w => (Number.isInteger(w && w.id) ? w.id : null))
            .filter(v => v !== null)
    );
    const worldWallGroups = new Set();
    if (map && map.nodes && Number.isFinite(map.width) && Number.isFinite(map.height)) {
        const seenWalls = new Set();
        for (let x = 0; x < map.width; x++) {
            const col = map.nodes[x];
            if (!Array.isArray(col)) continue;
            for (let y = 0; y < map.height; y++) {
                const node = col[y];
                if (!node || !Array.isArray(node.objects)) continue;
                node.objects.forEach(obj => {
                    if (!obj || obj.type !== "wallSection") return;
                    if (seenWalls.has(obj)) return;
                    seenWalls.add(obj);
                    if (Number.isInteger(obj.id)) {
                        worldWallGroups.add(obj.id);
                    }
                });
            }
        }
    }

    let linked = 0;
    let missingLinkId = 0;
    let linkMissingOnscreen = 0;
    let linkMissingWorld = 0;
    const sampleProblems = [];

    windows.forEach((w, idx) => {
        const linkId = Number.isInteger(w && w.mountedWallLineGroupId) ? w.mountedWallLineGroupId : null;
        if (linkId === null) {
            missingLinkId += 1;
            if (sampleProblems.length < 3) {
                sampleProblems.push(`#${idx} noLink @(${Number(w.x || 0).toFixed(2)},${Number(w.y || 0).toFixed(2)})`);
            }
            return;
        }
        linked += 1;
        const inOnscreen = onscreenWallGroups.has(linkId);
        const inWorld = worldWallGroups.has(linkId);
        if (!inOnscreen) {
            linkMissingOnscreen += 1;
        }
        if (!inWorld) {
            linkMissingWorld += 1;
        }
        if ((!inOnscreen || !inWorld) && sampleProblems.length < 3) {
            sampleProblems.push(
                `#${idx} link ${linkId} on=${inOnscreen ? "Y" : "N"} world=${inWorld ? "Y" : "N"}`
            );
        }
    });

    const sampleText = sampleProblems.length > 0 ? `\n  ${sampleProblems.join(" | ")}` : "";
    return (
        `\nww windows ${windows.length} walls ${walls.length}` +
        `\n  linked ${linked} noLink ${missingLinkId}` +
        `\n  missOn ${linkMissingOnscreen} missWorld ${linkMissingWorld}` +
        sampleText
    );
}

if (typeof globalThis !== "undefined") {
    globalThis.powerups = powerups;
    globalThis.onscreenObjects = onscreenObjects;
    globalThis.activeSimObjects = activeSimObjects;
    globalThis.getOnscreenObjects = () => Array.from(onscreenObjects || []);
    globalThis.getOnscreenByType = (type) =>
        Array.from(onscreenObjects || []).filter(obj => obj && obj.type === type);
    globalThis.logWindowWallLinkDebug = () => {
        console.log(formatWindowWallLinkDebugSummary());
    };
}

function updateAnimalPreview() {
    if (!animalPreviewSprite) return;
    const showPreview = !!(
        wizard &&
        wizard.currentSpell === "spawnanimal" &&
        keysPressed[" "] &&
        Number.isFinite(mousePos.screenX) &&
        Number.isFinite(mousePos.screenY)
    );
    if (!showPreview) {
        animalPreviewSprite.visible = false;
        return;
    }

    // Resolve the selected animal type and its texture
    const selectedType = (wizard.selectedAnimalType) || "squirrel";
    const texGroup = (typeof textures !== "undefined" && textures[selectedType]) ? textures[selectedType] : null;
    const frameTex = (texGroup && Array.isArray(texGroup.list) && texGroup.list.length > 0)
        ? (texGroup.list.find(Boolean) || texGroup.list[0])
        : null;
    if (!frameTex) {
        // Fallback: load from PNG path
        const typeDef = (typeof SpawnAnimal !== "undefined" && Array.isArray(SpawnAnimal.ANIMAL_TYPES))
            ? SpawnAnimal.ANIMAL_TYPES.find(t => t.name === selectedType)
            : null;
        if (typeDef && typeDef.icon) {
            animalPreviewSprite.texture = PIXI.Texture.from(typeDef.icon);
        } else {
            animalPreviewSprite.visible = false;
            return;
        }
    } else {
        animalPreviewSprite.texture = frameTex;
    }

    // Size: use average default size for that animal type, scaled by selected size scale
    const sizeScale = (wizard && Number.isFinite(wizard.selectedAnimalSizeScale))
        ? wizard.selectedAnimalSizeScale
        : 1;
    // Typical default sizes and width/height ratios per type
    const animalMetrics = {
        squirrel: { size: 0.5, wRatio: 1.0, hRatio: 1.0 },
        goat:     { size: 0.85, wRatio: 1.2, hRatio: 1.0 },
        deer:     { size: 1.0, wRatio: 1.0, hRatio: 1.0 },
        bear:     { size: 1.45, wRatio: 1.4, hRatio: 1.0 },
        yeti:     { size: 1.75, wRatio: 1.2, hRatio: 1.0 }
    };
    const metrics = animalMetrics[selectedType] || { size: 1, wRatio: 1, hRatio: 1 };
    const previewSize = metrics.size * sizeScale;

    animalPreviewSprite.width = previewSize * metrics.wRatio * viewscale;
    animalPreviewSprite.height = previewSize * metrics.hRatio * viewscale;
    animalPreviewSprite.x = mousePos.screenX;
    animalPreviewSprite.y = mousePos.screenY;
    animalPreviewSprite.visible = true;
}

let renderingUnavailableWarningShown = false;
function presentGameFrame(renderAnimalsOverride = null) {
    if (typeof hydrateVisibleLazyRoads === "function") {
        hydrateVisibleLazyRoads({ maxPerFrame: 64, paddingWorld: 12 });
    }
    if (typeof hydrateVisibleLazyTrees === "function") {
        hydrateVisibleLazyTrees({ maxPerFrame: 64, paddingWorld: 12 });
    }
    if (
        typeof globalThis !== "undefined" &&
        globalThis.Rendering &&
        typeof globalThis.Rendering.renderFrame === "function"
    ) {
        const renderingApi = globalThis.Rendering;
        const runtimeApi = (typeof globalThis !== "undefined" && globalThis.RenderRuntime)
            ? globalThis.RenderRuntime
            : null;
        const renderAnimals = Array.isArray(renderAnimalsOverride)
            ? renderAnimalsOverride
            : ((runtimeApi && typeof runtimeApi.getActiveAnimals === "function")
                ? runtimeApi.getActiveAnimals()
                : animals);
        const roofList = (typeof globalThis !== "undefined" && Array.isArray(globalThis.roofs))
            ? globalThis.roofs
            : [];
        const rendered = renderingApi.renderFrame({
            app,
            gameContainer,
            map,
            animals: renderAnimals,
            animalsPreFilteredVisible: !!(runtimeApi && typeof runtimeApi.getActiveAnimals === "function"),
            powerups,
            projectiles,
            wizard,
            roofs: roofList,
            camera: viewport,
            viewport,
            viewscale,
            xyratio,
            wizardFrames,
            renderNowMs,
            frameRate,
            renderAlpha
        });
        if (rendered) {
            if (typeof updateCursor === "function") {
                updateCursor();
            }
            return true;
        }
    }
    if (!renderingUnavailableWarningShown) {
        console.warn("Rendering frame present failed; frame skipped.");
        renderingUnavailableWarningShown = true;
    }
    return false;
}
if (typeof globalThis !== "undefined") {
    globalThis.presentGameFrame = presentGameFrame;
}

// Load sprite sheets before starting game
PIXI.Loader.shared
    .add('/assets/spritesheet/bear.json')
    .add('/assets/spritesheet/deer.json')
    .add('/assets/spritesheet/squirrel.json')
    .add('/assets/spritesheet/goat.json')
    .add('/assets/spritesheet/yeti.json')
    .add('/assets/images/runningman.png')
    .add('/assets/images/magic/hi%20fi%20fireball.png')
    .add('/assets/images/arrow.png')
    .load(onAssetsLoaded);

function onAssetsLoaded() {
    // create an array to store the textures
    let spriteNames = ["walk_left", "walk_right", "attack_left", "attack_right"];
    let animalNames = ["bear", "deer", "squirrel", "goat", "yeti"]
    animalNames.forEach(animal => {
        let sheet = PIXI.Loader.shared.resources[`/assets/spritesheet/${animal}.json`].spritesheet;
        textures[animal] = {list: [], byKey: {}};
        for (let i = 0; i < spriteNames.length; i++) {
            const texture = sheet.textures[`${animal}_${spriteNames[i]}.png`];
            if (texture) {
                textures[animal].list.push(texture);
                textures[animal].byKey[spriteNames[i]] = texture;
            }
        }    
        if (textures[animal].list.length === 0) {
            const allSheetTextures = Object.values(sheet.textures || {}).filter(Boolean);
            if (allSheetTextures.length > 0) {
                textures[animal].list = allSheetTextures;
            }
        }
    })
    
    // Load wizard sprite sheet (12 rows x 9 columns)
    // Extract frames from the sheet: all rows, columns 0-8
    const wizardSheet = PIXI.Texture.from('/assets/images/runningman.png');
    const baseTexture = wizardSheet.baseTexture;
    const cols = 9;
    const rows = 12;
    const frameWidth = baseTexture.width / cols;
    const frameHeight = baseTexture.height / rows;
    
    // Create textures for each frame (row-major: row 0..11, col 0..8)
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const frameRect = new PIXI.Rectangle(
                col * frameWidth,
                row * frameHeight,
                frameWidth,
                frameHeight
            );
            const frameTexture = new PIXI.Texture(baseTexture, frameRect);
            wizardFrames.push(frameTexture);
        }
    }
    
    // Initialize cursor sprite
    const cursorTexture = PIXI.Texture.from('/assets/images/arrow.png');
    cursorTexture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR; // Enable antialiasing
    cursorSprite = new PIXI.Sprite(cursorTexture);
    cursorSprite.anchor.set(0.5, 0);
    cursorSprite.visible = false; // Hidden until first cursor update
    cursorLayer.addChild(cursorSprite);
    
    // Initialize spacebar cursor (line art)
    spellCursor = new PIXI.Graphics();
    cursorLayer.addChild(spellCursor);
    spellCursor.visible = false; // Hidden by default
    
    // Draw your custom cursor design here
    const cursorSize = 20;
    tenpoints = Array.from(
        { length: 10 }, (_, i) => i * 36
    ).map(angle => ({x: Math.cos(angle * Math.PI / 180) * cursorSize, y: Math.sin(angle * Math.PI / 180) * cursorSize}));
    fivepoints = Array.from(
        { length: 5 }, (_, i) => i * 72 + 18
    ).map(angle => ({x: Math.cos(angle * Math.PI / 180) * cursorSize * 0.5, y: Math.sin(angle * Math.PI / 180) * cursorSize * 0.5}));
    
    spellCursor.lineStyle(2, 0x44aaff, 1);
    for (let i = 0; i < 5; i++) {
        spellCursor.moveTo(tenpoints[i*2].x, tenpoints[i*2].y);
        spellCursor.lineTo(fivepoints[i].x, fivepoints[i].y);
        spellCursor.lineTo(tenpoints[i*2+1].x, tenpoints[i*2+1].y);
    }

    // Initialize animal preview sprite (hidden by default)
    animalPreviewSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
    animalPreviewSprite.anchor.set(0.5, 0.5);
    animalPreviewSprite.visible = false;
    animalPreviewSprite.alpha = 0.45;
    cursorLayer.addChild(animalPreviewSprite);

    if (typeof SpellSystem !== "undefined" && typeof SpellSystem.primeSpellAssets === "function") {
        SpellSystem.primeSpellAssets();
    }
    
    console.log("Pixi assets loaded successfully");
}

function initRoadLayer() {
    // Legacy road layer disabled: roads render as regular sprites.
}

// Character, Wizard, Animal and animal subclasses moved to gameobjects/ folder

jQuery(() => {
    if (typeof sanitizeSavedGameState === 'function') {
        sanitizeSavedGameState();
    }

    const startupLoadDirectiveStorageKey = "survivor_startup_load_directive_v1";

    function queueStartupLoadDirective(directive) {
        if (typeof sessionStorage === "undefined") return false;
        if (!directive || typeof directive !== "object") return false;
        try {
            sessionStorage.setItem(startupLoadDirectiveStorageKey, JSON.stringify(directive));
            return true;
        } catch (e) {
            console.warn("Failed to queue startup load directive:", e);
            return false;
        }
    }

    function consumeStartupLoadDirective() {
        if (typeof sessionStorage === "undefined") return null;
        let raw = null;
        try {
            raw = sessionStorage.getItem(startupLoadDirectiveStorageKey);
            sessionStorage.removeItem(startupLoadDirectiveStorageKey);
        } catch (e) {
            console.warn("Failed to read startup load directive:", e);
            return null;
        }
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === "object") ? parsed : null;
        } catch (_ignored) {
            return null;
        }
    }

    function reloadWithStartupLoadDirective(directive) {
        const queued = queueStartupLoadDirective(directive);
        if (!queued) return false;
        if (typeof window !== "undefined" && window.location && typeof window.location.reload === "function") {
            window.location.reload();
            return true;
        }
        return false;
    }

    if (typeof globalThis !== "undefined") {
        globalThis.reloadAndLoadSaveFromServerFile = (fileName = "") => {
            const trimmed = (typeof fileName === "string") ? fileName.trim() : "";
            const directive = { source: "server" };
            if (trimmed.length > 0) directive.fileName = trimmed;
            return reloadWithStartupLoadDirective(directive);
        };
    }

    // Append Pixi canvas to display
    $("#display").append(app.view);
    perfPanel = $("<div id='perfReadout'></div>").css({
        position: "fixed",
        top: "8px",
        right: "8px",
        "z-index": 99999,
        width: "72ch",
        "box-sizing": "border-box",
        padding: "6px 8px",
        "font-family": "monospace",
        "font-size": "11px",
        color: "#d8f6ff",
        background: "rgba(0,0,0,0.55)",
        border: "1px solid rgba(180,220,235,0.45)",
        "border-radius": "4px",
        "pointer-events": "none",
        "white-space": "pre"
    });
    if (typeof updatePerfPanelVisibility === "function") {
        updatePerfPanelVisibility();
    } else {
        perfPanel.css("display", showPerfReadout ? "block" : "none");
    }
    $("body").append(perfPanel);

    if (app.view && app.view.style) {
        app.view.style.cursor = "url('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), default";
    }

    function updateMouseClientPosition(event) {
        mousePos.clientX = event.clientX;
        mousePos.clientY = event.clientY;
    }

    function syncMouseScreenFromClientPosition(event) {
        if (pointerLockActive) return;
        if (!app || !app.view) return;
        if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
        const rect = app.view.getBoundingClientRect();
        mousePos.screenX = event.clientX - rect.left;
        mousePos.screenY = event.clientY - rect.top;
        if (Number.isFinite(mousePos.screenX) && Number.isFinite(mousePos.screenY)) {
            const worldCoors = screenToWorld(mousePos.screenX, mousePos.screenY);
            const normalized = normalizeAimWorldPointForWizard(worldCoors.x, worldCoors.y);
            mousePos.worldX = normalized.x;
            mousePos.worldY = normalized.y;
            const dest = screenToHex(mousePos.screenX, mousePos.screenY);
            mousePos.x = dest.x;
            mousePos.y = dest.y;
        }
        if (typeof updateCursor === "function") {
            updateCursor();
        }
    }

    document.addEventListener("mousemove", event => {
        updateMouseClientPosition(event);
    });

    document.addEventListener("pointermove", event => {
        updateMouseClientPosition(event);
        syncMouseScreenFromClientPosition(event);
    });

    app.view.addEventListener("pointermove", event => {
        updateMouseClientPosition(event);
        syncMouseScreenFromClientPosition(event);
    });

    function isPointerLockedOnCanvas() {
        return document.pointerLockElement === app.view;
    }

    function syncMouseWorldFromScreenWithViewport() {
        if (!Number.isFinite(mousePos.screenX) || !Number.isFinite(mousePos.screenY)) return;
        const world = screenToWorld(mousePos.screenX, mousePos.screenY);
        const normalized = normalizeAimWorldPointForWizard(world.x, world.y);
        mousePos.worldX = normalized.x;
        mousePos.worldY = normalized.y;
    }

    function normalizeAimWorldPointForWizard(worldX, worldY) {
        let outX = worldX;
        let outY = worldY;
        if (map && typeof map.wrapWorldX === "function" && Number.isFinite(outX)) {
            outX = map.wrapWorldX(outX);
        }
        if (map && typeof map.wrapWorldY === "function" && Number.isFinite(outY)) {
            outY = map.wrapWorldY(outY);
        }
        if (
            wizard &&
            map &&
            typeof map.shortestDeltaX === "function" &&
            typeof map.shortestDeltaY === "function" &&
            Number.isFinite(wizard.x) &&
            Number.isFinite(wizard.y) &&
            Number.isFinite(outX) &&
            Number.isFinite(outY)
        ) {
            outX = wizard.x + map.shortestDeltaX(wizard.x, outX);
            outY = wizard.y + map.shortestDeltaY(wizard.y, outY);
        }
        return { x: outX, y: outY };
    }

    function getWizardAimVectorTo(worldX, worldY) {
        const normalized = normalizeAimWorldPointForWizard(worldX, worldY);
        return {
            x: normalized.x - wizard.x,
            y: normalized.y - wizard.y,
            worldX: normalized.x,
            worldY: normalized.y
        };
    }

    function syncMouseScreenFromWorldWithViewport() {
        if (!Number.isFinite(pointerLockAimWorld.x) || !Number.isFinite(pointerLockAimWorld.y)) return;
        const camera = viewport;
        const dx = (map && typeof map.shortestDeltaX === "function")
            ? map.shortestDeltaX(camera.x, pointerLockAimWorld.x)
            : (pointerLockAimWorld.x - camera.x);
        const dy = (map && typeof map.shortestDeltaY === "function")
            ? map.shortestDeltaY(camera.y, pointerLockAimWorld.y)
            : (pointerLockAimWorld.y - camera.y);
        mousePos.screenX = dx * viewscale;
        mousePos.screenY = dy * viewscale * xyratio;
    }

    function clampVirtualCursorToCanvas(paddingPx = 1) {
        if (!app || !app.screen) return false;
        const width = Number.isFinite(app.screen.width) ? app.screen.width : 0;
        const height = Number.isFinite(app.screen.height) ? app.screen.height : 0;
        if (width <= 0 || height <= 0) return false;
        const pad = Math.max(0, Number.isFinite(paddingPx) ? paddingPx : 0);
        const minX = pad;
        const minY = pad;
        const maxX = Math.max(minX, width - pad);
        const maxY = Math.max(minY, height - pad);
        if (!Number.isFinite(mousePos.screenX)) mousePos.screenX = width * 0.5;
        if (!Number.isFinite(mousePos.screenY)) mousePos.screenY = height * 0.5;
        const clampedX = Math.max(minX, Math.min(maxX, mousePos.screenX));
        const clampedY = Math.max(minY, Math.min(maxY, mousePos.screenY));
        const changed = (clampedX !== mousePos.screenX) || (clampedY !== mousePos.screenY);
        mousePos.screenX = clampedX;
        mousePos.screenY = clampedY;
        return changed;
    }

    function ensurePointerLockAimInitialized() {
        if (Number.isFinite(pointerLockAimWorld.x) && Number.isFinite(pointerLockAimWorld.y)) return;
        if (Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY)) {
            const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
            pointerLockAimWorld.x = normalized.x;
            pointerLockAimWorld.y = normalized.y;
            return;
        }
        if (Number.isFinite(mousePos.screenX) && Number.isFinite(mousePos.screenY)) {
            const world = screenToWorld(mousePos.screenX, mousePos.screenY);
            const normalized = normalizeAimWorldPointForWizard(world.x, world.y);
            pointerLockAimWorld.x = normalized.x;
            pointerLockAimWorld.y = normalized.y;
            return;
        }
        if (wizard && Number.isFinite(wizard.x) && Number.isFinite(wizard.y)) {
            pointerLockAimWorld.x = wizard.x;
            pointerLockAimWorld.y = wizard.y;
            syncMouseScreenFromWorldWithViewport();
        }
    }

    function requestGameplayPointerLock(event = null) {
        if (!ENABLE_POINTER_LOCK) return;
        if (!app.view || typeof app.view.requestPointerLock !== "function") return;
        const rect = app.view.getBoundingClientRect();
        const fallbackX = Number.isFinite(mousePos.screenX) ? mousePos.screenX : app.screen.width * 0.5;
        const fallbackY = Number.isFinite(mousePos.screenY) ? mousePos.screenY : app.screen.height * 0.5;
        const screenX = (
            event &&
            Number.isFinite(event.clientX) &&
            Number.isFinite(rect.left)
        ) ? (event.clientX - rect.left) : fallbackX;
        const screenY = (
            event &&
            Number.isFinite(event.clientY) &&
            Number.isFinite(rect.top)
        ) ? (event.clientY - rect.top) : fallbackY;
        mousePos.screenX = screenX;
        mousePos.screenY = screenY;
        clampVirtualCursorToCanvas(1);
        syncMouseWorldFromScreenWithViewport();
        pendingPointerLockEntry = {
            screenX: mousePos.screenX,
            screenY: mousePos.screenY,
            worldX: mousePos.worldX,
            worldY: mousePos.worldY
        };
        app.view.requestPointerLock();
    }

    function exitGameplayPointerLock() {
        if (document.pointerLockElement !== app.view) return;
        if (typeof document.exitPointerLock === "function") {
            document.exitPointerLock();
        }
    }

    if (typeof globalThis !== "undefined" && typeof globalThis.setPointerLockSensitivity !== "function") {
        globalThis.setPointerLockSensitivity = function setPointerLockSensitivity(value) {
            const n = Number(value);
            if (!Number.isFinite(n)) return;
            pointerLockSensitivity = Math.max(0.05, Math.min(3, n));
        };
    }

    function getVirtualCursorClientPoint() {
        if (!app || !app.view) return { x: NaN, y: NaN };
        if (!Number.isFinite(mousePos.screenX) || !Number.isFinite(mousePos.screenY)) return { x: NaN, y: NaN };
        const rect = app.view.getBoundingClientRect();
        return {
            x: rect.left + mousePos.screenX,
            y: rect.top + mousePos.screenY
        };
    }

    function getVirtualCursorHoveredElement() {
        const pt = getVirtualCursorClientPoint();
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y) || typeof document === "undefined") return null;
        return document.elementFromPoint(pt.x, pt.y);
    }

    function isVirtualCursorOverMenuArea() {
        const hovered = getVirtualCursorHoveredElement();
        if (!hovered || typeof hovered.closest !== "function") return false;
        return !!hovered.closest("#spellMenu, #selectedSpell, #spellSelector, #auraMenu, #selectedAura, #auraSelector, #activeAuraIcons, #editorMenu, #selectedEditor, #editorSelector");
    }

    function updateRangeInputFromClientX(rangeInput, clientX, emitChange = false) {
        if (!(rangeInput instanceof HTMLInputElement) || rangeInput.type !== "range") return false;
        if (!Number.isFinite(clientX)) return false;
        const rect = rangeInput.getBoundingClientRect();
        if (!rect || rect.width <= 0) return false;
        const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const min = Number(rangeInput.min);
        const max = Number(rangeInput.max);
        const step = Number(rangeInput.step);
        if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return false;
        let next = min + frac * (max - min);
        if (Number.isFinite(step) && step > 0) {
            next = Math.round((next - min) / step) * step + min;
        }
        next = Math.max(min, Math.min(max, next));
        rangeInput.value = String(next);
        rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
        if (emitChange) {
            rangeInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return true;
    }

    document.addEventListener("pointerlockchange", () => {
        pointerLockActive = isPointerLockedOnCanvas();
        if (pointerLockActive) {
            if (
                pendingPointerLockEntry &&
                Number.isFinite(pendingPointerLockEntry.screenX) &&
                Number.isFinite(pendingPointerLockEntry.screenY)
            ) {
                mousePos.screenX = pendingPointerLockEntry.screenX;
                mousePos.screenY = pendingPointerLockEntry.screenY;
                if (Number.isFinite(pendingPointerLockEntry.worldX) && Number.isFinite(pendingPointerLockEntry.worldY)) {
                    const normalized = normalizeAimWorldPointForWizard(pendingPointerLockEntry.worldX, pendingPointerLockEntry.worldY);
                    pointerLockAimWorld.x = normalized.x;
                    pointerLockAimWorld.y = normalized.y;
                } else {
                    syncMouseWorldFromScreenWithViewport();
                    const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
                    pointerLockAimWorld.x = normalized.x;
                    pointerLockAimWorld.y = normalized.y;
                }
            } else {
                ensurePointerLockAimInitialized();
                mousePos.worldX = pointerLockAimWorld.x;
                mousePos.worldY = pointerLockAimWorld.y;
                syncMouseScreenFromWorldWithViewport();
            }
            clampVirtualCursorToCanvas(1);
            syncMouseWorldFromScreenWithViewport();
            const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
            pointerLockAimWorld.x = normalized.x;
            pointerLockAimWorld.y = normalized.y;
            updateCursor();
        }
        pendingPointerLockEntry = null;
    });
    
    // Handle window resize
    window.addEventListener('resize', sizeView);

    function sizeView() {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        
        if (window.innerWidth > window.innerHeight) {
            viewport.width = 31;
        }
        else {
            viewport.width = 20;
        }

        viewport.height = Math.ceil(viewport.width * (app.screen.height / app.screen.width) / xyratio);

        centerViewport(wizard, 0);

        viewscale = app.screen.width / viewport.width;

        if (typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
            globalThis.presentGameFrame();
        }

    }

    function getSpellMenuIconElements() {
        const grid = document.getElementById("spellGrid");
        if (!grid) return [];
        return Array.from(grid.querySelectorAll(".spellIcon, button"));
    }

    function getAuraMenuIconElements() {
        const grid = document.getElementById("auraGrid");
        if (!grid) return [];
        return Array.from(grid.querySelectorAll(".auraIcon, button"));
    }

    function clearSpellMenuKeyboardFocus() {
        getSpellMenuIconElements().forEach(icon => icon.classList.remove("keyboard-nav-focus"));
        spellMenuKeyboardIndex = -1;
    }

    function clearAuraMenuKeyboardFocus() {
        getAuraMenuIconElements().forEach(icon => icon.classList.remove("keyboard-nav-focus"));
        auraMenuKeyboardIndex = -1;
    }

    function setSpellMenuKeyboardFocus(index) {
        const icons = getSpellMenuIconElements();
        if (!icons.length) {
            spellMenuKeyboardIndex = -1;
            return false;
        }
        const clamped = Math.max(0, Math.min(icons.length - 1, index));
        icons.forEach(icon => icon.classList.remove("keyboard-nav-focus"));
        icons[clamped].classList.add("keyboard-nav-focus");
        spellMenuKeyboardIndex = clamped;
        return true;
    }

    function initSpellMenuKeyboardFocus() {
        const icons = getSpellMenuIconElements();
        if (!icons.length) {
            spellMenuKeyboardIndex = -1;
            return false;
        }
        const selectedIndex = icons.findIndex(icon => icon.classList.contains("selected"));
        return setSpellMenuKeyboardFocus(selectedIndex >= 0 ? selectedIndex : 0);
    }

    function moveSpellMenuKeyboardFocus(dx, dy) {
        const icons = getSpellMenuIconElements();
        if (!icons.length) return false;
        if (!Number.isInteger(spellMenuKeyboardIndex) || spellMenuKeyboardIndex < 0 || spellMenuKeyboardIndex >= icons.length) {
            initSpellMenuKeyboardFocus();
        }
        const grid = document.getElementById("spellGrid");
        const computed = grid ? window.getComputedStyle(grid) : null;
        const cols = (() => {
            if (!computed) return 4;
            const template = computed.gridTemplateColumns || "";
            if (!template || template === "none") return 4;
            const count = template.split(" ").filter(token => token && token !== "/").length;
            return Math.max(1, count);
        })();
        const current = Math.max(0, spellMenuKeyboardIndex);
        const row = Math.floor(current / cols);
        const col = current % cols;
        const nextRow = Math.max(0, row + dy);
        const nextCol = Math.max(0, Math.min(cols - 1, col + dx));
        let next = nextRow * cols + nextCol;
        if (next >= icons.length) next = icons.length - 1;
        return setSpellMenuKeyboardFocus(next);
    }

    function setAuraMenuKeyboardFocus(index) {
        const icons = getAuraMenuIconElements();
        if (!icons.length) {
            auraMenuKeyboardIndex = -1;
            return false;
        }
        const clamped = Math.max(0, Math.min(icons.length - 1, index));
        icons.forEach(icon => icon.classList.remove("keyboard-nav-focus"));
        icons[clamped].classList.add("keyboard-nav-focus");
        auraMenuKeyboardIndex = clamped;
        return true;
    }

    function initAuraMenuKeyboardFocus() {
        const icons = getAuraMenuIconElements();
        if (!icons.length) {
            auraMenuKeyboardIndex = -1;
            return false;
        }
        const selectedIndex = icons.findIndex(icon => icon.classList.contains("selected"));
        return setAuraMenuKeyboardFocus(selectedIndex >= 0 ? selectedIndex : 0);
    }

    function moveAuraMenuKeyboardFocus(dx, dy) {
        const icons = getAuraMenuIconElements();
        if (!icons.length) return false;
        if (!Number.isInteger(auraMenuKeyboardIndex) || auraMenuKeyboardIndex < 0 || auraMenuKeyboardIndex >= icons.length) {
            initAuraMenuKeyboardFocus();
        }
        const grid = document.getElementById("auraGrid");
        const computed = grid ? window.getComputedStyle(grid) : null;
        const cols = (() => {
            if (!computed) return 3;
            const template = computed.gridTemplateColumns || "";
            if (!template || template === "none") return 3;
            const count = template.split(" ").filter(token => token && token !== "/").length;
            return Math.max(1, count);
        })();
        const current = Math.max(0, auraMenuKeyboardIndex);
        const row = Math.floor(current / cols);
        const col = current % cols;
        const nextRow = Math.max(0, row + dy);
        const nextCol = Math.max(0, Math.min(cols - 1, col + dx));
        let next = nextRow * cols + nextCol;
        if (next >= icons.length) next = icons.length - 1;
        return setAuraMenuKeyboardFocus(next);
    }

    function activateSelectedAuraFromMenu() {
        const icons = getAuraMenuIconElements();
        if (!icons.length) return { activated: false, shouldCloseMenu: false };
        let target = icons.find(icon => icon.classList.contains("keyboard-nav-focus"));
        if (!target) {
            target = icons.find(icon => icon.classList.contains("selected"));
        }
        if (!target) {
            target = icons[0];
        }
        if (!target) return { activated: false, shouldCloseMenu: false };
        target.click();
        return { activated: true, shouldCloseMenu: false };
    }

    function activateSelectedSpellFromMenu() {
        const icons = getSpellMenuIconElements();
        if (!icons.length) return { activated: false, shouldCloseMenu: false };
        let target = icons.find(icon => icon.classList.contains("keyboard-nav-focus"));
        if (!target) {
            target = icons.find(icon => icon.classList.contains("selected"));
        }
        if (!target) {
            target = icons[0];
        }
        if (!target) return { activated: false, shouldCloseMenu: false };
        const targetLabel = (target.textContent || "").trim().toLowerCase();
        const isBackAction = targetLabel === "back";
        target.click();
        return { activated: true, shouldCloseMenu: !isBackAction };
    }

    function getFocusedSpellNameFromMenu() {
        const icons = getSpellMenuIconElements();
        if (!icons.length) return null;
        let target = icons.find(icon => icon.classList.contains("keyboard-nav-focus"));
        if (!target) {
            target = icons.find(icon => icon.classList.contains("selected"));
        }
        if (!target) {
            target = icons[0];
        }
        if (!target || !target.dataset) return null;
        return target.dataset.spell || null;
    }

    function openFocusedSpellSubmenu() {
        if (!wizard || typeof SpellSystem === "undefined") return false;
        const spellName = getFocusedSpellNameFromMenu();
        if (!spellName) return false;
        if (spellName === "buildroad" && typeof SpellSystem.showFlooringMenu === "function") {
            SpellSystem.showFlooringMenu(wizard);
            initSpellMenuKeyboardFocus();
            return true;
        }
        if (spellName === "wall" && typeof SpellSystem.showWallMenu === "function") {
            SpellSystem.showWallMenu(wizard);
            initSpellMenuKeyboardFocus();
            return true;
        }
        if (spellName === "treegrow" && typeof SpellSystem.showTreeMenu === "function") {
            SpellSystem.showTreeMenu(wizard);
            initSpellMenuKeyboardFocus();
            return true;
        }
        if (spellName === "placeobject" && typeof SpellSystem.showPlaceableMenu === "function") {
            SpellSystem.showPlaceableMenu(wizard);
            initSpellMenuKeyboardFocus();
            return true;
        }
        if (spellName === "spawnanimal" && typeof SpellSystem.showAnimalMenu === "function") {
            SpellSystem.showAnimalMenu(wizard);
            initSpellMenuKeyboardFocus();
            return true;
        }
        return false;
    }

    function isEditorPlacementSpellActive() {
        if (!wizard) return false;
        if (typeof SpellSystem !== "undefined" && typeof SpellSystem.isEditorSpellName === "function") {
            return SpellSystem.isEditorSpellName(wizard.currentSpell);
        }
        return wizard.currentSpell === "placeobject" || wizard.currentSpell === "blackdiamond";
    }

    function isEditorPlacementKeyHeld() {
        return !!keysPressed["e"];
    }

    function updateEditorPlacementActiveState(active) {
        if (!wizard) return;
        wizard.editorPlacementActive = !!active && isEditorPlacementSpellActive();
    }

    console.log("Generating map...");
    initRoadLayer();
    map = new GameMap(mapHeight, mapWidth, { skipClearance: true }, () => {
        frameRate = 30;
        const simStepMs = 1000 / frameRate;
        const animalAiOnscreenHz = 10;
        const animalAiOffscreenHz = 1.5;
        const animalAiMaxStepsPerSim = 10;
        const inactiveMovementDecimation = 6;
        let simAccumulatorMs = 0;
        let lastFrameMs = performance.now();
        let lastPresentedMs = 0;
        let nextPresentAtMs = 0;
        const maxSimStepsPerFrame = 5;
        let inactiveMovementCursor = 0;
        let animalAiCursorOn = 0;
        let animalAiCursorOff = 0;
        let animalVisibilitySnapshot = { active: animals, inactive: [] };

        function refreshAnimalVisibilitySnapshot() {
            const runtimeApi = (typeof globalThis !== "undefined" && globalThis.RenderRuntime)
                ? globalThis.RenderRuntime
                : null;
            if (runtimeApi && typeof runtimeApi.syncAnimalVisibility === "function") {
                const synced = runtimeApi.syncAnimalVisibility({
                    animals,
                    map,
                    viewport,
                    activationPaddingTiles: 4,
                    retentionExtraTiles: 2
                });
                const active = Array.isArray(synced && synced.active) ? synced.active : animals;
                const inactive = Array.isArray(synced && synced.inactive) ? synced.inactive : [];
                animalVisibilitySnapshot = { active, inactive };
                return animalVisibilitySnapshot;
            }
            animalVisibilitySnapshot = { active: animals, inactive: [] };
            return animalVisibilitySnapshot;
        }

        function advanceAnimalsSimulation() {
            if (!Array.isArray(animals) || animals.length === 0) return;
            const runtimeApi = (typeof globalThis !== "undefined" && globalThis.RenderRuntime)
                ? globalThis.RenderRuntime
                : null;
            const visibility = animalVisibilitySnapshot || { active: animals, inactive: [] };

            const activeAnimals = Array.isArray(visibility.active) ? visibility.active : animals;
            const inactiveAnimals = Array.isArray(visibility.inactive) ? visibility.inactive : [];
            const dueOnscreen = [];
            const dueOffscreen = [];

            for (let i = 0; i < activeAnimals.length; i++) {
                const animal = activeAnimals[i];
                if (!animal || animal.gone || animal.dead) continue;
                animal.prevX = animal.x;
                animal.prevY = animal.y;
                animal.prevZ = animal.z;
                animal.tickMovementOnly(frameRate, 1);
                if (runtimeApi && typeof runtimeApi.noteAnimalMoved === "function") {
                    runtimeApi.noteAnimalMoved(animal, map);
                }
                const aiIntervalMs = 1000 / animalAiOnscreenHz;
                if (!Number.isFinite(animal._aiAccumulatorMs)) {
                    animal._aiAccumulatorMs = Math.random() * aiIntervalMs;
                } else {
                    animal._aiAccumulatorMs = Math.min(animal._aiAccumulatorMs + simStepMs, aiIntervalMs * 3);
                }
                if (animal._aiAccumulatorMs >= aiIntervalMs) {
                    dueOnscreen.push(animal);
                }
            }

            if (inactiveAnimals.length > 0) {
                const perStepInactiveMoves = Math.max(1, Math.ceil(inactiveAnimals.length / inactiveMovementDecimation));
                for (let moved = 0; moved < perStepInactiveMoves; moved++) {
                    const idx = inactiveMovementCursor % inactiveAnimals.length;
                    inactiveMovementCursor++;
                    const animal = inactiveAnimals[idx];
                    if (!animal || animal.gone || animal.dead) continue;
                    animal.prevX = animal.x;
                    animal.prevY = animal.y;
                    animal.prevZ = animal.z;
                    animal.tickMovementOnly(frameRate, inactiveMovementDecimation);
                    if (runtimeApi && typeof runtimeApi.noteAnimalMoved === "function") {
                        runtimeApi.noteAnimalMoved(animal, map);
                    }
                    const aiIntervalMs = 1000 / animalAiOffscreenHz;
                    const simChunkMs = simStepMs * inactiveMovementDecimation;
                    if (!Number.isFinite(animal._aiAccumulatorMs)) {
                        animal._aiAccumulatorMs = Math.random() * aiIntervalMs;
                    } else {
                        animal._aiAccumulatorMs = Math.min(animal._aiAccumulatorMs + simChunkMs, aiIntervalMs * 3);
                    }
                    if (animal._aiAccumulatorMs >= aiIntervalMs) {
                        dueOffscreen.push(animal);
                    }
                }
            }

            let aiBudget = animalAiMaxStepsPerSim;
            if (dueOnscreen.length > 0) {
                const startCursor = animalAiCursorOn % dueOnscreen.length;
                let cursor = startCursor;
                while (aiBudget > 0 && dueOnscreen.length > 0) {
                    const animal = dueOnscreen[cursor];
                    const aiIntervalMs = 1000 / animalAiOnscreenHz;
                    animal.tickBehaviorOnly();
                    animal._aiAccumulatorMs = Math.max(0, Number(animal._aiAccumulatorMs || 0) - aiIntervalMs);
                    aiBudget--;
                    cursor = (cursor + 1) % dueOnscreen.length;
                    if (cursor === startCursor) break;
                }
                animalAiCursorOn = cursor;
            }

            if (aiBudget > 0 && dueOffscreen.length > 0) {
                const startCursor = animalAiCursorOff % dueOffscreen.length;
                let cursor = startCursor;
                while (aiBudget > 0 && dueOffscreen.length > 0) {
                    const animal = dueOffscreen[cursor];
                    const aiIntervalMs = 1000 / animalAiOffscreenHz;
                    animal.tickBehaviorOnly();
                    animal._aiAccumulatorMs = Math.max(0, Number(animal._aiAccumulatorMs || 0) - aiIntervalMs);
                    aiBudget--;
                    cursor = (cursor + 1) % dueOffscreen.length;
                    if (cursor === startCursor) break;
                }
                animalAiCursorOff = cursor;
            }
        }
        
        // Draw immediately on first frame
        refreshAnimalVisibilitySnapshot();
        presentGameFrame(animalVisibilitySnapshot.active);
        
        function runSimulationStep() {
            if (!wizard) return;
            const stepStartMs = performance.now();
            let aimSyncMs = 0;
            let facingMs = 0;
            let movementMs = 0;
            let collisionMs = 0;
            let pointerPostMs = 0;
            // Keep aim stable through camera drift:
            // pointer lock stores world aim directly, unlocked mode maps screen->world.
            const aimSyncStartMs = performance.now();
            if (pointerLockActive) {
                ensurePointerLockAimInitialized();
                const cursorOverMenu = isVirtualCursorOverMenuArea();
                if (cursorOverMenu) {
                    // Over menu UI, keep screen-space cursor pinned and derive world aim from it.
                    syncMouseWorldFromScreenWithViewport();
                    const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
                    pointerLockAimWorld.x = normalized.x;
                    pointerLockAimWorld.y = normalized.y;
                } else {
                    mousePos.worldX = pointerLockAimWorld.x;
                    mousePos.worldY = pointerLockAimWorld.y;
                    syncMouseScreenFromWorldWithViewport();
                    if (clampVirtualCursorToCanvas(1)) {
                        syncMouseWorldFromScreenWithViewport();
                        const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
                        pointerLockAimWorld.x = normalized.x;
                        pointerLockAimWorld.y = normalized.y;
                    }
                }
            } else if (Number.isFinite(mousePos.screenX) && Number.isFinite(mousePos.screenY)) {
                syncMouseWorldFromScreenWithViewport();
            }
            aimSyncMs = performance.now() - aimSyncStartMs;

            // Always face the mouse when a valid aim vector exists,
            // even when the wizard is not moving.
            const facingStartMs = performance.now();
            if (Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY)) {
                const aim = getWizardAimVectorTo(mousePos.worldX, mousePos.worldY);
                const faceX = aim.x;
                const faceY = aim.y;
                if (Math.hypot(faceX, faceY) > 1e-6) {
                    const turnStrength = wizard.getTurnStrengthFromAimVector(faceX, faceY);
                    wizard.turnToward(faceX, faceY, turnStrength);
                }
            }
            facingMs = performance.now() - facingStartMs;
            
            // Calculate desired movement direction from input
            let moveVector = null;
            let moveOptions = {};
            const forwardAim = getWizardAimVectorTo(mousePos.worldX, mousePos.worldY);
            const forwardVector = {
                x: forwardAim.x,
                y: forwardAim.y
            };
            const forwardTurnStrength = wizard.getTurnStrengthFromAimVector(forwardVector.x, forwardVector.y);
            const movingForward = !!keysPressed['w'];
            const movingBackward = !!keysPressed['s'];
            if (wizard.isJumping) {
                moveVector = wizard.movementVector;
                moveOptions = {
                    speedMultiplier: wizard.jumpLockedMovingBackward ? wizard.backwardSpeedMultiplier : 1,
                    animateBackward: wizard.jumpLockedMovingBackward,
                    lockMovementVector: true
                };
            } else if (movingForward && !movingBackward) {
                moveVector = forwardVector;
                moveOptions = {
                    speedMultiplier: 1,
                    animateBackward: false,
                    facingVector: forwardVector,
                    facingTurnStrength: forwardTurnStrength
                };
                wizard.path = [];
                wizard.nextNode = null;
            } else if (movingBackward && !movingForward) {
                moveVector = {
                    x: -forwardVector.x,
                    y: -forwardVector.y
                };
                moveOptions = {
                    speedMultiplier: wizard.backwardSpeedMultiplier,
                    animateBackward: true,
                    facingVector: forwardVector,
                    facingTurnStrength: forwardTurnStrength
                };
                wizard.path = [];
                wizard.nextNode = null;
            }
            
            // Process movement every frame (with or without input)
            const movementStartMs = performance.now();
            const wizardStartX = wizard.x;
            const wizardStartY = wizard.y;
            wizard.prevJumpHeight = Number.isFinite(wizard.jumpHeight) ? wizard.jumpHeight : 0;
            wizard.moveDirection(moveVector, moveOptions);
            wizard.updateJump(1 / frameRate);
            movementMs = performance.now() - movementStartMs;
            const collisionStartMs = performance.now();
            if (typeof SpellSystem !== "undefined" && typeof SpellSystem.updateCharacterObjectCollisions === "function") {
                SpellSystem.updateCharacterObjectCollisions(wizard);
            }
            if (typeof updatePowerupsForWizard === "function") {
                updatePowerupsForWizard(wizard);
            }
            advanceAnimalsSimulation();
            // Tick static objects that need simulation (burning, growing, falling)
            for (const obj of activeSimObjects) {
                if (!obj || obj.gone) {
                    activeSimObjects.delete(obj);
                    continue;
                }
                if (typeof obj.update === "function") {
                    obj.update();
                }
                // Deregister when no longer needs ticking
                if (!obj.isOnFire && !obj.isGrowing && !obj.falling && obj.fireFadeStart === undefined) {
                    activeSimObjects.delete(obj);
                }
            }
            collisionMs = performance.now() - collisionStartMs;
            const pointerPostStartMs = performance.now();
            if (
                pointerLockActive &&
                Number.isFinite(pointerLockAimWorld.x) &&
                Number.isFinite(pointerLockAimWorld.y) &&
                !isVirtualCursorOverMenuArea()
            ) {
                // Keep lock-mode aim anchored relative to the wizard's movement.
                const wizardDeltaX = wizard.x - wizardStartX;
                const wizardDeltaY = wizard.y - wizardStartY;
                pointerLockAimWorld.x += wizardDeltaX;
                pointerLockAimWorld.y += wizardDeltaY;
                const normalized = normalizeAimWorldPointForWizard(pointerLockAimWorld.x, pointerLockAimWorld.y);
                pointerLockAimWorld.x = normalized.x;
                pointerLockAimWorld.y = normalized.y;
                mousePos.worldX = normalized.x;
                mousePos.worldY = normalized.y;
            }
            if (pointerLockActive) {
                if (isVirtualCursorOverMenuArea()) {
                    syncMouseWorldFromScreenWithViewport();
                    const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
                    pointerLockAimWorld.x = normalized.x;
                    pointerLockAimWorld.y = normalized.y;
                } else {
                    syncMouseScreenFromWorldWithViewport();
                    if (clampVirtualCursorToCanvas(1)) {
                        syncMouseWorldFromScreenWithViewport();
                        const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
                        pointerLockAimWorld.x = normalized.x;
                        pointerLockAimWorld.y = normalized.y;
                    }
                }
            }
            pointerPostMs = performance.now() - pointerPostStartMs;
            const stepTotalMs = performance.now() - stepStartMs;
            simPerfBreakdown.steps += 1;
            simPerfBreakdown.totalMs += stepTotalMs;
            simPerfBreakdown.maxStepMs = Math.max(simPerfBreakdown.maxStepMs, stepTotalMs);
            simPerfBreakdown.aimSyncMs += aimSyncMs;
            simPerfBreakdown.facingMs += facingMs;
            simPerfBreakdown.movementMs += movementMs;
            simPerfBreakdown.collisionMs += collisionMs;
            simPerfBreakdown.pointerPostMs += pointerPostMs;
            simPerfBreakdown.maxAimSyncMs = Math.max(simPerfBreakdown.maxAimSyncMs, aimSyncMs);
            simPerfBreakdown.maxFacingMs = Math.max(simPerfBreakdown.maxFacingMs, facingMs);
            simPerfBreakdown.maxMovementMs = Math.max(simPerfBreakdown.maxMovementMs, movementMs);
            simPerfBreakdown.maxCollisionMs = Math.max(simPerfBreakdown.maxCollisionMs, collisionMs);
            simPerfBreakdown.maxPointerPostMs = Math.max(simPerfBreakdown.maxPointerPostMs, pointerPostMs);
            frameCount ++;
        }

        function renderFrame(nowMs) {
            const frameDeltaMs = Math.min(250, Math.max(0, nowMs - lastFrameMs));
            lastFrameMs = nowMs;
            const simStartMs = performance.now();
            refreshAnimalVisibilitySnapshot();

            if (paused) {
                perfStats.simSteps = 0;
                perfStats.simMs = 0;
                renderAlpha = 1;
            } else {
                simAccumulatorMs += frameDeltaMs;
                let simSteps = 0;

                while (simAccumulatorMs >= simStepMs && simSteps < maxSimStepsPerFrame) {
                    if (wizard) {
                        wizard.prevX = wizard.x;
                        wizard.prevY = wizard.y;
                        wizard.prevZ = wizard.z;
                    }
                    viewport.prevX = viewport.x;
                    viewport.prevY = viewport.y;
                    runSimulationStep();
                    simAccumulatorMs -= simStepMs;
                    simSteps++;
                }

                if (simSteps === maxSimStepsPerFrame && simAccumulatorMs >= simStepMs) {
                    simAccumulatorMs = simStepMs; // prevent runaway catch-up stutter
                }

                perfStats.simSteps = simSteps;
                if (typeof globalThis !== "undefined") {
                    globalThis.simPerfBreakdown = {
                        steps: simPerfBreakdown.steps,
                        totalMs: simPerfBreakdown.totalMs,
                        maxStepMs: simPerfBreakdown.maxStepMs,
                        aimSyncMs: simPerfBreakdown.aimSyncMs,
                        facingMs: simPerfBreakdown.facingMs,
                        movementMs: simPerfBreakdown.movementMs,
                        collisionMs: simPerfBreakdown.collisionMs,
                        pointerPostMs: simPerfBreakdown.pointerPostMs,
                        maxAimSyncMs: simPerfBreakdown.maxAimSyncMs,
                        maxFacingMs: simPerfBreakdown.maxFacingMs,
                        maxMovementMs: simPerfBreakdown.maxMovementMs,
                        maxCollisionMs: simPerfBreakdown.maxCollisionMs,
                        maxPointerPostMs: simPerfBreakdown.maxPointerPostMs,
                        accumulatorMs: simAccumulatorMs
                    };
                }
                simPerfBreakdown.steps = 0;
                simPerfBreakdown.totalMs = 0;
                simPerfBreakdown.maxStepMs = 0;
                simPerfBreakdown.aimSyncMs = 0;
                simPerfBreakdown.facingMs = 0;
                simPerfBreakdown.movementMs = 0;
                simPerfBreakdown.collisionMs = 0;
                simPerfBreakdown.pointerPostMs = 0;
                simPerfBreakdown.maxAimSyncMs = 0;
                simPerfBreakdown.maxFacingMs = 0;
                simPerfBreakdown.maxMovementMs = 0;
                simPerfBreakdown.maxCollisionMs = 0;
                simPerfBreakdown.maxPointerPostMs = 0;
                renderAlpha = Math.max(0, Math.min(1, simAccumulatorMs / simStepMs));
                perfStats.simMs = performance.now() - simStartMs;
            }
            if (paused) {
                perfStats.simMs = 0;
            }

            // Use a scheduled present clock so frame pacing does not alias between 60/120.
            const debugRenderCapActive = !!debugMode;
            const effectiveRenderMaxFps = debugRenderCapActive ? debugRenderMaxFps : renderMaxFps;
            const renderIntervalMs = effectiveRenderMaxFps > 0 ? (1000 / effectiveRenderMaxFps) : 0;

            if (renderIntervalMs > 0) {
                if (nextPresentAtMs === 0) {
                    nextPresentAtMs = nowMs;
                }

                if ((nowMs + 0.25) < nextPresentAtMs) {
                    requestAnimationFrame(renderFrame);
                    return;
                }

                const latenessMs = nowMs - nextPresentAtMs;
                if (latenessMs > renderIntervalMs * 4) {
                    nextPresentAtMs = nowMs;
                } else {
                    nextPresentAtMs += renderIntervalMs;
                }
            } else {
                nextPresentAtMs = nowMs;
            }

            const presentedDeltaMs = lastPresentedMs > 0
                ? (nowMs - lastPresentedMs)
                : (renderIntervalMs > 0 ? renderIntervalMs : 0);
            lastPresentedMs = nowMs;
            perfStats.loopMs = presentedDeltaMs;
            perfStats.fps = presentedDeltaMs > 0 ? 1000 / presentedDeltaMs : 0;
            const drawStart = performance.now();
            renderNowMs = nowMs;
            if (pointerLockActive) {
                if (!isVirtualCursorOverMenuArea()) {
                    // Reproject lock-mode aim every render frame using the interpolated camera
                    // to keep cursor motion smooth while the viewport drifts.
                    syncMouseScreenFromWorldWithViewport();
                    clampVirtualCursorToCanvas(1);
                }
            }
            updateAnimalPreview();
            presentGameFrame(animalVisibilitySnapshot.active);
            perfStats.drawMs = performance.now() - drawStart;
            perfStats.idleMs = Math.max(0, perfStats.loopMs - perfStats.simMs - perfStats.drawMs);
            if (typeof recordPerfAccumulatorSample === "function") {
                const drawBreakdownForAccum = (typeof globalThis !== "undefined" && globalThis.drawPerfBreakdown)
                    ? globalThis.drawPerfBreakdown
                    : null;
                const simBreakdownForAccum = (typeof globalThis !== "undefined" && globalThis.simPerfBreakdown)
                    ? globalThis.simPerfBreakdown
                    : null;
                recordPerfAccumulatorSample({
                    fps: perfStats.fps,
                    loopMs: perfStats.loopMs,
                    cpuMs: perfStats.simMs + perfStats.drawMs,
                    simMs: perfStats.simMs,
                    drawMs: perfStats.drawMs,
                    idleMs: perfStats.idleMs,
                    simSteps: perfStats.simSteps,
                    accMs: simBreakdownForAccum ? Number(simBreakdownForAccum.accumulatorMs || 0) : 0,
                    stepMaxMs: simBreakdownForAccum ? Number(simBreakdownForAccum.maxStepMs || 0) : 0,
                    drawComposeMs: drawBreakdownForAccum ? Number(drawBreakdownForAccum.composeMs || 0) : 0,
                    drawCollectMs: drawBreakdownForAccum ? Number(drawBreakdownForAccum.collectMs || 0) : 0,
                    drawLosMs: drawBreakdownForAccum ? Number(drawBreakdownForAccum.losMs || 0) : 0,
                    drawPassWorldMs: drawBreakdownForAccum ? Number(drawBreakdownForAccum.passWorldMs || 0) : 0,
                    drawPassLosMs: drawBreakdownForAccum ? Number(drawBreakdownForAccum.passLosMs || 0) : 0,
                    drawPassObjectsMs: drawBreakdownForAccum ? Number(drawBreakdownForAccum.passObjectsMs || 0) : 0,
                    drawPassPostMs: drawBreakdownForAccum ? Number(drawBreakdownForAccum.passPostMs || 0) : 0,
                    drawComposeMaskMs: drawBreakdownForAccum ? Number(drawBreakdownForAccum.composeMaskMs || 0) : 0,
                    drawComposeSortMs: drawBreakdownForAccum ? Number(drawBreakdownForAccum.composeSortMs || 0) : 0,
                    drawComposePopulateMs: drawBreakdownForAccum ? Number(drawBreakdownForAccum.composePopulateMs || 0) : 0,
                    drawComposeInvariantMs: drawBreakdownForAccum ? Number(drawBreakdownForAccum.composeInvariantMs || 0) : 0,
                    drawComposeWallSectionsMs: drawBreakdownForAccum ? Number(drawBreakdownForAccum.composeWallSectionsMs || 0) : 0,
                    drawComposeUnaccountedMs: drawBreakdownForAccum ? Number(drawBreakdownForAccum.composeUnaccountedMs || 0) : 0
                });
            }
            const panelNow = performance.now();
            if (showPerfReadout && perfPanel && panelNow - perfStats.lastUiUpdateAt > 200) {
                const losBreakdown = (typeof globalThis !== "undefined" && globalThis.losDebugBreakdown)
                    ? globalThis.losDebugBreakdown
                    : null;
                const losTotalMs = (losBreakdown && Number.isFinite(losBreakdown.totalMs))
                    ? losBreakdown.totalMs
                    : ((typeof globalThis !== "undefined" && Number.isFinite(globalThis.losDebugLastMs)) ? globalThis.losDebugLastMs : 0);
                const losRecomputed = !!(losBreakdown && losBreakdown.recomputed);
                const losSummary =
                    `\nlos ${losTotalMs.toFixed(2)} ms${losRecomputed ? "" : " (cached)"}`;
                const drawBreakdown = (typeof globalThis !== "undefined" && globalThis.drawPerfBreakdown)
                    ? globalThis.drawPerfBreakdown
                    : null;
                const cpuMs = perfStats.simMs + perfStats.drawMs;
                const drawBuckets = drawBreakdown
                    ? (
                        `\ndrawb lz ${Number(drawBreakdown.lazyMs || 0).toFixed(2)}` +
                        ` pr ${Number(drawBreakdown.prepMs || 0).toFixed(2)}` +
                        ` co ${Number(drawBreakdown.collectMs || 0).toFixed(2)}` +
                        ` lo ${Number(drawBreakdown.losMs || 0).toFixed(2)}` +
                        ` cp ${Number(drawBreakdown.composeMs || 0).toFixed(2)}`
                    )
                    : "";
                const drawPasses = drawBreakdown
                    ? (
                        `\ndrawp w ${Number(drawBreakdown.passWorldMs || 0).toFixed(2)}` +
                        ` l ${Number(drawBreakdown.passLosMs || 0).toFixed(2)}` +
                        ` o ${Number(drawBreakdown.passObjectsMs || 0).toFixed(2)}` +
                        ` p ${Number(drawBreakdown.passPostMs || 0).toFixed(2)}`
                    )
                    : "";
                const drawCounts = drawBreakdown
                    ? (
                        `\nobjs ${Number(drawBreakdown.mapItems || 0)}` +
                        ` on ${Number(drawBreakdown.onscreen || 0)}` +
                        ` hyd r${Number(drawBreakdown.hydratedRoads || 0)}` +
                        ` t${Number(drawBreakdown.hydratedTrees || 0)}`
                    )
                    : "";
                const drawComposeBuckets = drawBreakdown
                    ? (
                        `\ndrawc mk ${Number(drawBreakdown.composeMaskMs || 0).toFixed(2)}` +
                        ` so ${Number(drawBreakdown.composeSortMs || 0).toFixed(2)}` +
                        ` po ${Number(drawBreakdown.composePopulateMs || 0).toFixed(2)}` +
                        ` iv ${Number(drawBreakdown.composeInvariantMs || 0).toFixed(2)}` +
                        ` ws ${Number(drawBreakdown.composeWallSectionsMs || 0).toFixed(2)}` +
                        ` g ${Number(drawBreakdown.composeWallSectionsGroups || 0)}` +
                        ` r ${Number(drawBreakdown.composeWallSectionsRebuilt || 0)}` +
                        ` un ${Number(drawBreakdown.composeUnaccountedMs || 0).toFixed(2)}` +
                        `${Number(drawBreakdown.composeInvariantSkipped || 0) > 0 ? " (skip)" : ""}`
                    )
                    : "";
                const wwDebug = debugMode ? formatWindowWallLinkDebugSummary() : "";
                perfPanel.text(
                    `FPS ${perfStats.fps.toFixed(1)}\n` +
                    `cpu ${cpuMs.toFixed(1)} ms\n` +
                    `simms ${perfStats.simMs.toFixed(1)} ms\n` +
                    `draw ${perfStats.drawMs.toFixed(1)} ms\n` +
                    `idle ${perfStats.idleMs.toFixed(1)} ms\n` +
                    `sim ${perfStats.simSteps}\n` +
                    drawBuckets +
                    drawPasses +
                    drawComposeBuckets +
                    drawCounts +
                    losSummary +
                    wwDebug
                );
                perfStats.lastUiUpdateAt = panelNow;
            }
            requestAnimationFrame(renderFrame);
        }

        requestAnimationFrame(renderFrame);
    });

    wizard = new Wizard({x: mapWidth/2, y: mapHeight/2}, map);
    sizeView();
    centerViewport(wizard, 0, 0);
    
    // Roof instances are now created on placement.
    if (typeof globalThis !== "undefined" && !Array.isArray(globalThis.roofs)) {
        globalThis.roofs = [];
    }
    if (typeof setVisibilityMaskSources === "function") {
        setVisibilityMaskSources([]);
    }
    if (typeof setVisibilityMaskEnabled === "function") {
        setVisibilityMaskEnabled(false);
    }
    SpellSystem.startMagicInterval(wizard);
    
    // Initialize status bar updates
    setInterval(() => {
        if (wizard) wizard.updateStatusBars();
    }, 100);
    SpellSystem.initWizardSpells(wizard);

    function tryAutoLoadLocalSaveOnStartup() {
        if (typeof getSavedGameState !== "function" || typeof loadGameState !== "function") {
            return false;
        }
        const parsedSave = getSavedGameState();
        if (!parsedSave.ok) {
            if (parsedSave.reason && parsedSave.reason !== "missing") {
                console.warn("Skipping startup auto-load due to invalid local save:", parsedSave.reason, parsedSave.error || "");
            }
            return false;
        }
        const loaded = loadGameState(parsedSave.data);
        if (loaded) {
            message("Loaded local save");
            console.log("Auto-loaded game from localStorage at startup");
            return true;
        }
        console.warn("Startup auto-load found local save but load failed");
        return false;
    }

    async function tryAutoLoadServerMainSaveOnStartup() {
        if (typeof loadGameStateFromServerFile !== "function") {
            return false;
        }
        const result = await loadGameStateFromServerFile();
        if (result && result.ok) {
            message("Loaded /assets/saves/savefile.json");
            console.log("Auto-loaded game from server savefile.json at startup");
            return true;
        }
        const reason = (result && result.reason) ? String(result.reason) : "unknown";
        console.warn(`Startup server auto-load failed for /assets/saves/savefile.json (${reason})`, result);
        return false;
    }

    async function tryLoadFromStartupDirective() {
        const directive = consumeStartupLoadDirective();
        if (!directive || typeof directive.source !== "string") return false;

        const source = directive.source.trim().toLowerCase();
        if (source === "local") {
            tryAutoLoadLocalSaveOnStartup();
            return true;
        }

        if (source === "server") {
            if (typeof loadGameStateFromServerFile !== "function") {
                message("Server file load is unavailable");
                return true;
            }
            const fileName = (typeof directive.fileName === "string") ? directive.fileName.trim() : "";
            const result = await loadGameStateFromServerFile(fileName ? { fileName } : {});
            const loadedPath = fileName.length > 0
                ? `/assets/saves/backups/${fileName}`
                : "/assets/saves/savefile.json";
            if (result && result.ok) {
                message(`Loaded ${loadedPath}`);
                console.log(`Startup loaded game from ${loadedPath}`);
            } else {
                const reason = (result && result.reason) ? String(result.reason) : "unknown";
                message(`Failed to load ${loadedPath} (${reason})`);
                console.error(`Startup load failed for ${loadedPath}:`, result);
                if (result && result.error) {
                    console.error("Startup load error detail:", result.error);
                }
            }
            return true;
        }

        return false;
    }

    void tryLoadFromStartupDirective().then(async handled => {
        if (!handled) {
            const loadedLocal = tryAutoLoadLocalSaveOnStartup();
            if (loadedLocal) return;

            // If no local save exists yet, boot from the default server save file.
            if (typeof getSavedGameState === "function") {
                const parsedSave = getSavedGameState();
                if (parsedSave && parsedSave.reason === "missing") {
                    await tryAutoLoadServerMainSaveOnStartup();
                }
            }
        }

        // Safety net: if no save was loaded (or load failed to restore
        // clearance), ensure the clearance map is populated so
        // pathfinding works on the randomly-generated map.
        if (map && typeof map.computeClearance === "function") {
            let needsCompute = false;
            outer:
            for (let x = 0; x < Math.min(map.width, 4); x++) {
                for (let y = 0; y < Math.min(map.height, 4); y++) {
                    const node = map.nodes[x] && map.nodes[x][y];
                    if (node && node.clearance === Infinity && !node.isBlocked()) {
                        // Still at the default Infinity from the constructor —
                        // clearance was never computed or restored.
                        needsCompute = true;
                        break outer;
                    }
                }
            }
            if (needsCompute) {
                console.log("No clearance data after startup; running full computeClearance()…");
                map.computeClearance();
            }
        }
    });

    function closeHudMenus(options = {}) {
        const closeSpell = options.spell !== false;
        const closeAura = options.aura !== false;
        const closeEditor = options.editor !== false;
        if (closeSpell) {
            $("#spellMenu").addClass("hidden");
            clearSpellMenuKeyboardFocus();
        }
        if (closeAura) {
            $("#auraMenu").addClass("hidden");
            clearAuraMenuKeyboardFocus();
        }
        if (closeEditor) {
            $("#editorMenu").addClass("hidden");
        }
    }

    $("#selectedSpell").click(() => {
        const wasHidden = $("#spellMenu").hasClass('hidden');
        if (wasHidden) {
            closeHudMenus({ spell: false, aura: true, editor: true });
        }
        if ($("#spellMenu").hasClass('hidden') && typeof SpellSystem !== "undefined" && typeof SpellSystem.showMainSpellMenu === "function") {
            SpellSystem.showMainSpellMenu(wizard);
        }
        $("#spellMenu").toggleClass('hidden');
        const nowHidden = $("#spellMenu").hasClass('hidden');
        if (nowHidden) {
            clearSpellMenuKeyboardFocus();
        } else if (wasHidden) {
            initSpellMenuKeyboardFocus();
        }
    });

    $("#selectedAura").click(() => {
        const wasHidden = $("#auraMenu").hasClass("hidden");
        if (wasHidden) {
            closeHudMenus({ spell: true, aura: false, editor: true });
        }
        $("#auraMenu").toggleClass("hidden");
        if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.refreshAuraSelector === "function") {
            SpellSystem.refreshAuraSelector(wizard);
        }
        const nowHidden = $("#auraMenu").hasClass("hidden");
        if (nowHidden) {
            clearAuraMenuKeyboardFocus();
        } else if (wasHidden) {
            initAuraMenuKeyboardFocus();
        }
    });

    $("#selectedEditor").click(() => {
        if (!wizard || $("#editorSelector").hasClass("hidden")) return;
        const wasHidden = $("#editorMenu").hasClass("hidden");
        if (wasHidden) {
            closeHudMenus({ spell: true, aura: true, editor: false });
            if (typeof SpellSystem !== "undefined" && typeof SpellSystem.showEditorMenu === "function") {
                SpellSystem.showEditorMenu(wizard);
            } else {
                $("#editorMenu").removeClass("hidden");
            }
        } else {
            $("#editorMenu").addClass("hidden");
        }
    });

    $("#selectedEditor").on("contextmenu", event => {
        if (
            wizard &&
            !$("#editorSelector").hasClass("hidden") &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.showEditorSubmenuForSelectedCategory === "function"
        ) {
            event.preventDefault();
            closeHudMenus({ spell: true, aura: true, editor: false });
            SpellSystem.showEditorSubmenuForSelectedCategory(wizard);
        }
    });

    $("#selectedSpell").on("contextmenu", event => {
        if (
            wizard &&
            wizard.currentSpell === "wall" &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.showWallMenu === "function"
        ) {
            event.preventDefault();
            closeHudMenus({ spell: false, aura: true, editor: true });
            SpellSystem.showWallMenu(wizard);
            return;
        }
        if (
            wizard &&
            wizard.currentSpell === "buildroad" &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.showFlooringMenu === "function"
        ) {
            event.preventDefault();
            closeHudMenus({ spell: false, aura: true, editor: true });
            SpellSystem.showFlooringMenu(wizard);
            return;
        }
        if (
            wizard &&
            wizard.currentSpell === "treegrow" &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.showTreeMenu === "function"
        ) {
            event.preventDefault();
            closeHudMenus({ spell: false, aura: true, editor: true });
            SpellSystem.showTreeMenu(wizard);
            return;
        }
        if (
            wizard &&
            wizard.currentSpell === "spawnanimal" &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.showAnimalMenu === "function"
        ) {
            event.preventDefault();
            closeHudMenus({ spell: false, aura: true, editor: true });
            SpellSystem.showAnimalMenu(wizard);
            return;
        }
    });

    app.view.addEventListener("click", () => {
        if (suppressNextCanvasMenuClose) {
            suppressNextCanvasMenuClose = false;
            return;
        }
        closeHudMenus();
    });

    app.view.addEventListener("mousemove", event => {
        updateMouseClientPosition(event);
        if (pointerLockActive) {
            ensurePointerLockAimInitialized();
            const dx = (Number(event.movementX) || 0) * pointerLockSensitivity;
            const dy = (Number(event.movementY) || 0) * pointerLockSensitivity;
            const draggingRangeSlider = !!(pointerLockRangeDragInput && ((event.buttons & 1) === 1));
            if (draggingRangeSlider || isVirtualCursorOverMenuArea()) {
                // Keep menu interaction stable in screen space while locked.
                if (!Number.isFinite(mousePos.screenX)) mousePos.screenX = app.screen.width * 0.5;
                if (!Number.isFinite(mousePos.screenY)) mousePos.screenY = app.screen.height * 0.5;
                mousePos.screenX += dx;
                mousePos.screenY += dy;
                clampVirtualCursorToCanvas(1);
                if (draggingRangeSlider) {
                    const virtualPt = getVirtualCursorClientPoint();
                    updateRangeInputFromClientX(pointerLockRangeDragInput, virtualPt.x, false);
                }
                syncMouseWorldFromScreenWithViewport();
                const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
                pointerLockAimWorld.x = normalized.x;
                pointerLockAimWorld.y = normalized.y;
            } else {
                pointerLockAimWorld.x += dx / viewscale;
                pointerLockAimWorld.y += dy / (viewscale * xyratio);
                const normalized = normalizeAimWorldPointForWizard(pointerLockAimWorld.x, pointerLockAimWorld.y);
                pointerLockAimWorld.x = normalized.x;
                pointerLockAimWorld.y = normalized.y;
                mousePos.worldX = normalized.x;
                mousePos.worldY = normalized.y;
                syncMouseScreenFromWorldWithViewport();
                if (clampVirtualCursorToCanvas(1)) {
                    syncMouseWorldFromScreenWithViewport();
                    const normalized = normalizeAimWorldPointForWizard(mousePos.worldX, mousePos.worldY);
                    pointerLockAimWorld.x = normalized.x;
                    pointerLockAimWorld.y = normalized.y;
                }
            }
        } else {
            let rect = app.view.getBoundingClientRect();
            const screenX = event.clientX - rect.left;
            const screenY = event.clientY - rect.top;
            // Store screen coordinates for cursor
            mousePos.screenX = screenX;
            mousePos.screenY = screenY;
            // Store exact world coordinates for pixel-accurate aiming
            const worldCoors = screenToWorld(screenX, screenY);
            const normalized = normalizeAimWorldPointForWizard(worldCoors.x, worldCoors.y);
            mousePos.worldX = normalized.x;
            mousePos.worldY = normalized.y;
        }

        // Also store hex tile for movement
        if (Number.isFinite(mousePos.screenX) && Number.isFinite(mousePos.screenY)) {
            const dest = screenToHex(mousePos.screenX, mousePos.screenY);
            mousePos.x = dest.x;
            mousePos.y = dest.y;
        }

        // Update cursor immediately (don't wait for render loop)
        updateCursor();

        if (
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.updateDragPreview === "function"
        ) {
            SpellSystem.updateDragPreview(wizard, mousePos.worldX, mousePos.worldY);
        }
    })

    app.view.addEventListener("wheel", event => {
        if (
            !wizard ||
            (wizard.currentSpell !== "placeobject" && wizard.currentSpell !== "blackdiamond") ||
            typeof SpellSystem === "undefined" ||
            (
                (wizard.currentSpell === "placeobject" && typeof SpellSystem.adjustPlaceableScale !== "function") ||
                (wizard.currentSpell === "blackdiamond" && typeof SpellSystem.adjustPowerupPlacementScale !== "function")
            )
        ) {
            return;
        }
        const overMenu = pointerLockActive
            ? isVirtualCursorOverMenuArea()
            : !!(event.target && typeof event.target.closest === "function" && event.target.closest("#spellMenu, #selectedSpell, #spellSelector, #auraMenu, #selectedAura, #auraSelector, #activeAuraIcons, #editorMenu, #selectedEditor, #editorSelector, #statusBars"));
        if (overMenu) return;

        event.preventDefault();
        let deltaPixels = Number(event.deltaY) || 0;
        if (!Number.isFinite(deltaPixels) || deltaPixels === 0) return;
        if (event.deltaMode === 1) {
            // Convert line-based wheel deltas to pixel-ish units.
            deltaPixels *= 16;
        } else if (event.deltaMode === 2) {
            // Convert page-based deltas.
            deltaPixels *= Math.max(200, window.innerHeight || 800);
        }
        // Continuous scaling from wheel input: negative scroll grows, positive shrinks.
        const unclampedDelta = -deltaPixels * 0.0015;
        const delta = Math.max(-0.05, Math.min(0.05, unclampedDelta));
        if (Math.abs(delta) < 0.0005) return;

        if (wizard.currentSpell === "placeobject") {
            SpellSystem.adjustPlaceableScale(wizard, delta);
        } else if (wizard.currentSpell === "blackdiamond") {
            SpellSystem.adjustPowerupPlacementScale(wizard, delta);
        }
    }, { passive: false });

    app.view.addEventListener("mousedown", event => {
        if (pointerLockActive) {
            const hovered = getVirtualCursorHoveredElement();
            const virtualPt = getVirtualCursorClientPoint();
            const selectedSpellEl = hovered && typeof hovered.closest === "function"
                ? hovered.closest("#selectedSpell")
                : null;
            const selectedAuraEl = hovered && typeof hovered.closest === "function"
                ? hovered.closest("#selectedAura, #activeAuraIcons")
                : null;
            const selectedEditorEl = hovered && typeof hovered.closest === "function"
                ? hovered.closest("#selectedEditor")
                : null;
            const menuInteractiveEl = hovered && typeof hovered.closest === "function"
                ? hovered.closest("#spellMenu .spellIcon, #spellMenu button, #spellMenu input, #spellMenu label, #auraMenu .auraIcon, #auraMenu button, #auraMenu input, #auraMenu label, #editorMenu .spellIcon, #editorMenu button, #editorMenu input, #editorMenu label")
                : null;
            const forwardTarget = menuInteractiveEl || selectedSpellEl || selectedAuraEl || selectedEditorEl;
            const isRightClick = (event.button === 2);
            if (forwardTarget) {
                event.preventDefault();
                event.stopPropagation();
                const syntheticMouseInit = {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    button: event.button,
                    buttons: event.buttons,
                    clientX: Number.isFinite(virtualPt.x) ? virtualPt.x : 0,
                    clientY: Number.isFinite(virtualPt.y) ? virtualPt.y : 0,
                    screenX: Number.isFinite(virtualPt.x) ? virtualPt.x : 0,
                    screenY: Number.isFinite(virtualPt.y) ? virtualPt.y : 0
                };
                if (isRightClick) {
                    suppressNextCanvasMenuClose = true;
                    forwardTarget.dispatchEvent(new MouseEvent("contextmenu", {
                        ...syntheticMouseInit,
                        button: 2
                    }));
                } else {
                    suppressNextCanvasMenuClose = true;
                    const isRangeInput = forwardTarget instanceof HTMLInputElement && forwardTarget.type === "range";
                    if (isRangeInput) {
                        updateRangeInputFromClientX(forwardTarget, virtualPt.x, false);
                        pointerLockRangeDragInput = forwardTarget;
                        forwardTarget.dispatchEvent(new MouseEvent("mousedown", syntheticMouseInit));
                        return;
                    }
                    forwardTarget.dispatchEvent(new MouseEvent("mousedown", syntheticMouseInit));
                    forwardTarget.dispatchEvent(new MouseEvent("mouseup", syntheticMouseInit));
                    forwardTarget.dispatchEvent(new MouseEvent("click", syntheticMouseInit));
                }
                return;
            }
        }
        if (!pointerLockActive) {
            requestGameplayPointerLock(event);
        }
        if (
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.beginDragSpell === "function" &&
            (
                wizard.currentSpell === "wall" ||
                wizard.currentSpell === "buildroad" ||
                wizard.currentSpell === "firewall" ||
                wizard.currentSpell === "vanish"
            )
        ) {
            event.preventDefault();
            const worldCoors = (Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY))
                ? {x: mousePos.worldX, y: mousePos.worldY}
                : (() => {
                    const rect = app.view.getBoundingClientRect();
                    const screenX = event.clientX - rect.left;
                    const screenY = event.clientY - rect.top;
                    return screenToWorld(screenX, screenY);
                })();
            SpellSystem.beginDragSpell(wizard, wizard.currentSpell, worldCoors.x, worldCoors.y);
            return;
        }
    });

    app.view.addEventListener("mouseup", event => {
        if (pointerLockActive && pointerLockRangeDragInput) {
            event.preventDefault();
            event.stopPropagation();
            const virtualPt = getVirtualCursorClientPoint();
            updateRangeInputFromClientX(pointerLockRangeDragInput, virtualPt.x, true);
            pointerLockRangeDragInput.dispatchEvent(new MouseEvent("mouseup", {
                bubbles: true,
                cancelable: true,
                view: window,
                button: event.button
            }));
            pointerLockRangeDragInput = null;
            return;
        }
        if (
            !wizard ||
            typeof SpellSystem === "undefined" ||
            typeof SpellSystem.completeDragSpell !== "function" ||
            typeof SpellSystem.isDragSpellActive !== "function" ||
            !SpellSystem.isDragSpellActive(wizard, wizard.currentSpell)
        ) return;

        event.preventDefault();
        const worldCoors = (Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY))
            ? {x: mousePos.worldX, y: mousePos.worldY}
            : (() => {
                const rect = app.view.getBoundingClientRect();
                const screenX = event.clientX - rect.left;
                const screenY = event.clientY - rect.top;
                return screenToWorld(screenX, screenY);
            })();
        SpellSystem.completeDragSpell(wizard, wizard.currentSpell, worldCoors.x, worldCoors.y);
    });

    app.view.addEventListener("click", event => {
        const castWithSpace = !!keysPressed[" "];
        const castWithEditorKey = isEditorPlacementSpellActive() && isEditorPlacementKeyHeld();
        if (!castWithSpace && !castWithEditorKey) return;

        if (castWithSpace && wizard.currentSpell === "treegrow") {
            event.preventDefault();
            return;
        }
        event.preventDefault();
        const worldCoors = (pointerLockActive && Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY))
            ? {x: mousePos.worldX, y: mousePos.worldY}
            : (() => {
                const rect = app.view.getBoundingClientRect();
                const screenX = event.clientX - rect.left;
                const screenY = event.clientY - rect.top;
                return screenToWorld(screenX, screenY);
            })();
        const aim = getWizardAimVectorTo(worldCoors.x, worldCoors.y);
        // Stop wizard movement by setting destination to current node
        wizard.destination = null;
        wizard.path = [];
        wizard.travelFrames = 0;
        // Turn and cast at exact click coordinates.
        wizard.turnToward(aim.x, aim.y);
        if (
            wizard.currentSpell === "wall" ||
            wizard.currentSpell === "buildroad" ||
            wizard.currentSpell === "firewall" ||
            wizard.currentSpell === "vanish"
        ) return;
        SpellSystem.castWizardSpell(wizard, aim.worldX, aim.worldY);
        // Prevent keyup quick-cast from firing a duplicate cast.
        spacebarDownAt = null;
    })
     
    $("#msg").contextmenu(event => event.preventDefault())
    $(document).keydown(event => {
        const keyLower = event.key.toLowerCase();
        const spellMenuVisible = !$("#spellMenu").hasClass("hidden");
        const auraMenuVisible = !$("#auraMenu").hasClass("hidden");
        const editorMenuVisible = !$("#editorMenu").hasClass("hidden");

        if (event.ctrlKey && keyLower === "f") {
            event.preventDefault();
            if (typeof toggleShowPerfReadout === "function") {
                toggleShowPerfReadout();
            } else {
                showPerfReadout = !showPerfReadout;
                if (perfPanel) {
                    perfPanel.css("display", showPerfReadout ? "block" : "none");
                }
            }
            return;
        }

        if (event.ctrlKey && keyLower === "m") {
            event.preventDefault();
            if (typeof toggleMinimap === "function") {
                toggleMinimap();
            }
            return;
        }

        if (event.ctrlKey && keyLower === "e") {
            event.preventDefault();
            if (
                wizard &&
                typeof SpellSystem !== "undefined" &&
                typeof SpellSystem.toggleEditorPanelVisible === "function"
            ) {
                SpellSystem.toggleEditorPanelVisible(wizard);
            } else {
                const nextVisible = $("#editorSelector").hasClass("hidden");
                $("#editorSelector").toggleClass("hidden", !nextVisible);
                if (!nextVisible) {
                    $("#editorMenu").addClass("hidden");
                }
                if (wizard) {
                    wizard.showEditorPanel = nextVisible;
                }
            }
            return;
        }

        if (event.key === "Tab") {
            event.preventDefault();
            if (editorMenuVisible) {
                $("#editorMenu").addClass("hidden");
                return;
            }
            if (event.shiftKey) {
                if (spellMenuVisible) {
                    $("#spellMenu").addClass("hidden");
                    clearSpellMenuKeyboardFocus();
                    if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.refreshAuraSelector === "function") {
                        SpellSystem.refreshAuraSelector(wizard);
                    }
                    $("#auraMenu").removeClass("hidden");
                    initAuraMenuKeyboardFocus();
                } else if (auraMenuVisible) {
                    $("#auraMenu").addClass("hidden");
                    clearAuraMenuKeyboardFocus();
                } else {
                    if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.refreshAuraSelector === "function") {
                        SpellSystem.refreshAuraSelector(wizard);
                    }
                    $("#auraMenu").removeClass("hidden");
                    initAuraMenuKeyboardFocus();
                }
            } else if (auraMenuVisible) {
                $("#auraMenu").addClass("hidden");
                clearAuraMenuKeyboardFocus();
                if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.showMainSpellMenu === "function") {
                    SpellSystem.showMainSpellMenu(wizard);
                }
                $("#spellMenu").removeClass("hidden");
                initSpellMenuKeyboardFocus();
            } else if (spellMenuVisible) {
                $("#spellMenu").addClass("hidden");
                $("#auraMenu").addClass("hidden");
                $("#editorMenu").addClass("hidden");
                clearSpellMenuKeyboardFocus();
                clearAuraMenuKeyboardFocus();
            } else if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.showMainSpellMenu === "function") {
                SpellSystem.showMainSpellMenu(wizard);
                $("#spellMenu").removeClass("hidden");
                initSpellMenuKeyboardFocus();
            }
            return;
        }

        if (event.key === "Escape" && (spellMenuVisible || auraMenuVisible || editorMenuVisible)) {
            event.preventDefault();
            $("#spellMenu").addClass("hidden");
            $("#auraMenu").addClass("hidden");
            $("#editorMenu").addClass("hidden");
            clearSpellMenuKeyboardFocus();
            clearAuraMenuKeyboardFocus();
            return;
        }

        if (spellMenuVisible && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            if (event.key === "ArrowLeft") moveSpellMenuKeyboardFocus(-1, 0);
            if (event.key === "ArrowRight") moveSpellMenuKeyboardFocus(1, 0);
            if (event.key === "ArrowUp") moveSpellMenuKeyboardFocus(0, -1);
            if (event.key === "ArrowDown") moveSpellMenuKeyboardFocus(0, 1);
            return;
        }

        if (auraMenuVisible && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            if (event.key === "ArrowLeft") moveAuraMenuKeyboardFocus(-1, 0);
            if (event.key === "ArrowRight") moveAuraMenuKeyboardFocus(1, 0);
            if (event.key === "ArrowUp") moveAuraMenuKeyboardFocus(0, -1);
            if (event.key === "ArrowDown") moveAuraMenuKeyboardFocus(0, 1);
            return;
        }

        if (spellMenuVisible && (
            event.key === "Shift" ||
            event.key === "Control" ||
            event.key === "Alt" ||
            event.key === "Meta" ||
            event.key === "ContextMenu"
        )) {
            event.preventDefault();
            openFocusedSpellSubmenu();
            return;
        }

        if (spellMenuVisible && (event.key === "Enter" || event.key === " " || event.code === "Space")) {
            event.preventDefault();
            spacebarDownAt = null;
            const activation = activateSelectedSpellFromMenu();
            if (activation.activated && activation.shouldCloseMenu) {
                $("#spellMenu").addClass("hidden");
                clearSpellMenuKeyboardFocus();
            } else if (activation.activated) {
                initSpellMenuKeyboardFocus();
            }
            return;
        }

        if (auraMenuVisible && (event.key === "Enter" || event.key === " " || event.code === "Space")) {
            event.preventDefault();
            spacebarDownAt = null;
            const activation = activateSelectedAuraFromMenu();
            if (activation.activated) {
                initAuraMenuKeyboardFocus();
            }
            return;
        }

        // Track key state
        keysPressed[keyLower] = true;
        if (keyLower === "e" && !event.ctrlKey) {
            if (
                wizard &&
                !event.repeat &&
                typeof SpellSystem !== "undefined" &&
                typeof SpellSystem.activateSelectedEditorTool === "function"
            ) {
                SpellSystem.activateSelectedEditorTool(wizard);
            }
            updateEditorPlacementActiveState(true);
        }

        // Combo binding: F+W selects Firewall spell.
        if (
            wizard &&
            keysPressed['f'] &&
            keysPressed['w'] &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.setCurrentSpell === "function"
        ) {
            SpellSystem.setCurrentSpell(wizard, "firewall");
            updateEditorPlacementActiveState(isEditorPlacementKeyHeld());
            return;
        }

        if (
            wizard &&
            keysPressed['e'] &&
            keysPressed['t'] &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.setCurrentSpell === "function"
        ) {
            SpellSystem.setCurrentSpell(wizard, "editscript");
            updateEditorPlacementActiveState(isEditorPlacementKeyHeld());
            return;
        }

        const isPlusKey = (event.key === "+") || (event.code === "NumpadAdd") || (event.code === "Equal" && event.shiftKey);
        const isMinusKey = (event.key === "-") || (event.code === "NumpadSubtract");
        const isPlaceRotateLeft = event.key === "ArrowLeft";
        const isPlaceRotateRight = event.key === "ArrowRight";
        if (
            wizard &&
            wizard.currentSpell === "placeobject" &&
            (isPlaceRotateLeft || isPlaceRotateRight) &&
            !spellMenuVisible &&
            !auraMenuVisible &&
            !editorMenuVisible &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.adjustPlaceableRotation === "function"
        ) {
            event.preventDefault();
            if (!event.repeat) {
                const delta = isPlaceRotateRight ? 5 : -5;
                SpellSystem.adjustPlaceableRotation(wizard, delta);
            }
            return;
        }

        if (
            wizard &&
            wizard.currentSpell === "placeobject" &&
            (isPlusKey || isMinusKey) &&
            !editorMenuVisible &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.adjustPlaceableRenderOffset === "function"
        ) {
            event.preventDefault();
            if (!event.repeat) {
                const delta = isPlusKey ? 0.1 : -0.1;
                SpellSystem.adjustPlaceableRenderOffset(wizard, delta);
            }
            return;
        }

        if (event.key === " " || event.code === "Space") {
            event.preventDefault();
            if (!event.repeat) {
                spacebarDownAt = Date.now();
                if (
                    wizard &&
                    wizard.currentSpell === "treegrow" &&
                    mousePos.worldX !== undefined &&
                    mousePos.worldY !== undefined
                ) {
                    const aim = getWizardAimVectorTo(mousePos.worldX, mousePos.worldY);
                    wizard.turnToward(aim.x, aim.y);
                    SpellSystem.castWizardSpell(wizard, aim.worldX, aim.worldY);
                }
                // SpawnAnimal: space alone just activates preview mode; click to cast
                if (wizard && wizard.currentSpell === "spawnanimal") {
                    // no-op: preview shown in render loop, cast on click
                }
            }
        } else if ((event.key === "a" || event.key === "A") && !event.repeat) {
            if (wizard && typeof wizard.startJump === "function") {
                wizard.startJump();
            }
        } else if ((event.key === "o" || event.key === "O") && !event.repeat) {
            event.preventDefault();
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.toggleAura === "function") {
                SpellSystem.toggleAura(wizard, "omnivision");
            }
            return;
        } else if ((event.key === "p" || event.key === "P") && !event.repeat) {
            event.preventDefault();
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.toggleAura === "function") {
                SpellSystem.toggleAura(wizard, "speed");
            }
            return;
        } else if ((event.key === "h" || event.key === "H") && !event.repeat) {
            event.preventDefault();
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.toggleAura === "function") {
                SpellSystem.toggleAura(wizard, "healing");
            }
            return;
        } else if (Object.keys(spellKeyBindings).includes(event.key.toUpperCase())) {
            SpellSystem.setCurrentSpell(wizard, spellKeyBindings[event.key.toUpperCase()]);
            updateEditorPlacementActiveState(isEditorPlacementKeyHeld());
        }
        
        // Toggle debug graphics with ctrl+d
        if ((event.key === 'd' || event.key === 'D') && event.ctrlKey) {
            event.preventDefault();
            if (typeof toggleDebugMode === "function") {
                toggleDebugMode();
            } else {
                debugMode = !debugMode;
                if (typeof globalThis !== "undefined") {
                    globalThis.debugMode = debugMode;
                }
            }
            if (typeof globalThis !== "undefined") {
                globalThis.renderingShowPickerScreen = !!debugMode;
            }
            console.log('Debug mode:', debugMode ? 'ON' : 'OFF');
            if (debugMode) {
                console.log(formatWindowWallLinkDebugSummary());
            }
        }
        // One-shot wall/window render-order dump with plain D key.
        if (!event.ctrlKey && (event.key === 'd' || event.key === 'D') && !event.repeat) {
            if (typeof globalThis !== "undefined") {
                globalThis.windowWallDebugDumpRequested = true;
            }
            console.log("Requested one-shot wall/window render debug dump on next frame.");
        }

        // Toggle hex grid only with 'g' key
        if (event.key === 'g' || event.key === 'G') {
            event.preventDefault();
            if (typeof toggleHexGrid === "function") {
                toggleHexGrid();
            } else {
                showHexGrid = !showHexGrid;
            }
            console.log('Hex grid:', showHexGrid ? 'ON' : 'OFF');
        }

        // Save game to fixed server path with Ctrl+Shift+S
        if ((event.key === 's' || event.key === 'S') && event.ctrlKey && event.shiftKey) {
            event.preventDefault();
            if (typeof saveGameStateToServerFile === 'function') {
                saveGameStateToServerFile().then(result => {
                    if (result && result.ok) {
                        message('Saved to /assets/saves/savefile.json');
                    } else {
                        message('Failed to save file');
                        console.error('Failed to save file:', result);
                    }
                });
            } else {
                message('Server file save is unavailable');
            }
            return;
        }

        // Load game from fixed server path with Ctrl+Shift+L
        if ((event.key === 'l' || event.key === 'L') && event.ctrlKey && event.shiftKey) {
            event.preventDefault();
            if (reloadWithStartupLoadDirective({ source: "server" })) {
                message('Reloading and loading /assets/saves/savefile.json...');
            } else {
                message('Failed to queue reload for server save load');
            }
            return;
        }

        // Save game with Ctrl+S
        if ((event.key === 's' || event.key === 'S') && event.ctrlKey) {
            event.preventDefault();
            const saveData = saveGameState();
            if (saveData) {
                localStorage.setItem('survivor_save', JSON.stringify(saveData));
                message('Game saved!');
                console.log('Game saved to localStorage');
            }
        }

        // Load game with Ctrl+L
        if ((event.key === 'l' || event.key === 'L') && event.ctrlKey) {
            event.preventDefault();
            if (reloadWithStartupLoadDirective({ source: "local" })) {
                message('Reloading and loading local save...');
            } else {
                message('Failed to queue reload for local save load');
            }
            return;
        }
    })
    
    $(document).keyup(event => {
        // Track key state
        keysPressed[event.key.toLowerCase()] = false;
        if (event.key.toLowerCase() === "e") {
            updateEditorPlacementActiveState(false);
        }
        if (event.key === " " || event.code === "Space") {
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.cancelDragSpell === "function") {
                SpellSystem.cancelDragSpell(wizard, "wall");
                SpellSystem.cancelDragSpell(wizard, "buildroad");
                SpellSystem.cancelDragSpell(wizard, "firewall");
                SpellSystem.cancelDragSpell(wizard, "vanish");
            }
            SpellSystem.stopTreeGrowthChannel(wizard);
            if (wizard.currentSpell === "treegrow") {
                spacebarDownAt = null;
                event.preventDefault();
                return;
            }
            if (isEditorPlacementSpellActive()) {
                spacebarDownAt = null;
                event.preventDefault();
                return;
            }
            // SpawnAnimal: space-only never casts; must click while holding space
            if (wizard.currentSpell === "spawnanimal") {
                spacebarDownAt = null;
                if (animalPreviewSprite) animalPreviewSprite.visible = false;
                event.preventDefault();
                return;
            }
            if (
                wizard.currentSpell === "wall" ||
                wizard.currentSpell === "buildroad" ||
                wizard.currentSpell === "firewall" ||
                wizard.currentSpell === "vanish"
            ) return;
            event.preventDefault();
            const now = Date.now();
            const downAt = spacebarDownAt;
            spacebarDownAt = null;

            if (downAt && (now - downAt) <= 250) {
                // Quick tap: cast immediately
                if (wizard && mousePos.worldX !== undefined && mousePos.worldY !== undefined) {
                    const aim = getWizardAimVectorTo(mousePos.worldX, mousePos.worldY);
                    wizard.turnToward(aim.x, aim.y);
                    SpellSystem.castWizardSpell(wizard, aim.worldX, aim.worldY);
                }
            }
        }
    })

})
