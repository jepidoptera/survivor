const startupConfig = (typeof globalThis !== "undefined" && globalThis.RUNAROUND_STARTUP_CONFIG && typeof globalThis.RUNAROUND_STARTUP_CONFIG === "object")
    ? globalThis.RUNAROUND_STARTUP_CONFIG
    : {};
const mapWidth = Number.isFinite(startupConfig.mapWidth) ? Math.max(8, Math.floor(startupConfig.mapWidth)) : 400;
const mapHeight = Number.isFinite(startupConfig.mapHeight) ? Math.max(8, Math.floor(startupConfig.mapHeight)) : 400;
let frameRate = 60;
let frameCount = 0;
let renderNowMs = 0;
let simulationTimeScale = 1;
const renderMaxFps = 0; // 0 = uncapped (vsync-limited)
const wizardDirectionRowOffset = 0; // 0 when row 0 faces left. Adjust to align sprite sheet rows.
const wizardMouseTurnZeroDistanceUnits = 1;
const wizardMouseTurnFullDistanceUnits = 3;

let viewport = {width: 0, height: 0, innerWindow: {width: 0, height: 0}, x: 488, y: 494, z: 0, prevX: 488, prevY: 494, prevZ: 0}
let renderAlpha = 1;
let viewScale = 1;
let viewscale = 1;
let xyratio = 0.66; // Adjust for isometric scaling (height/width ratio)
const VIEWPORT_BASE_WIDTH_LANDSCAPE = 31;
const VIEWPORT_BASE_WIDTH_PORTRAIT = 20;
const VIEWPORT_ZOOM_MIN = 0.5;
const VIEWPORT_ZOOM_MAX = 4;
const VIEWPORT_ZOOM_SMOOTHING_PER_SEC = 16;
let viewportZoomFactor = 1;
let viewportZoomTargetFactor = 1;
let viewportZoomAnchorScreenX = NaN;
let viewportZoomAnchorScreenY = NaN;
const CAMERA_RESET_DOUBLE_TAP_MS = 300;
const CAMERA_RESET_DOUBLE_TAP_SECONDS = 0.2;
let lastCameraResetTapAtMs = 0;
let cameraResetTapAwaitingRelease = false;
const SCRIPT_CAMERA_DEFAULT_ZOOM_FACTOR = 1;
let scriptedCameraPanState = {
    active: false,
    focusTarget: null,
    targetOffsetX: 0,
    targetOffsetY: 0,
    startCenterX: NaN,
    startCenterY: NaN,
    startMs: 0,
    durationMs: 0,
    releaseOnSettle: false
};
let scriptedCameraZoomState = {
    active: false,
    startFactor: 1,
    targetFactor: 1,
    startMs: 0,
    durationMs: 0
};
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
let treeGrowVariantChosenThisHold = false;
let spellMenuKeyboardIndex = -1;
let auraMenuKeyboardIndex = -1;
let editorMenuKeyboardIndex = -1;
let suppressNextCanvasMenuClose = false;
let suppressNextTriggerAreaToolClick = false;
let triggerAreaCameraDetachWasActive = false;
const TRIGGER_AREA_EDGE_PAN_SPEED_UNITS_PER_SEC = 10;
const DETACHED_CAMERA_PAN_SPEED_UNITS_PER_SEC = 18;

if (typeof globalThis !== "undefined") {
    globalThis.getSimulationTimeScale = function getSimulationTimeScale() {
        const scale = Number(simulationTimeScale);
        return Number.isFinite(scale) ? Math.max(0, Math.min(6, scale)) : 1;
    };
    globalThis.setSimulationTimeScale = function setSimulationTimeScale(nextScale) {
        const raw = Number(nextScale);
        if (!Number.isFinite(raw)) return false;
        const normalized = Math.max(0, Math.min(6, raw));
        simulationTimeScale = normalized;
        return true;
    };
    globalThis.stopSimulationTime = function stopSimulationTime() {
        simulationTimeScale = 0;
        return true;
    };
    globalThis.restoreSimulationTime = function restoreSimulationTime() {
        simulationTimeScale = 1;
        return true;
    };
    globalThis.triggerAreaCameraDetachActive = false;
    globalThis.releaseSpacebarCastingState = function releaseSpacebarCastingState() {
        keysPressed[" "] = false;
        spacebarDownAt = null;
        treeGrowVariantChosenThisHold = false;
        if (typeof SpellSystem !== "undefined" && SpellSystem && typeof SpellSystem.clearTreePlacementPreviewSize === "function") {
            SpellSystem.clearTreePlacementPreviewSize(wizard);
        }
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

function isTriggerAreaCameraDetachActive() {
    return !!(
        wizard &&
        typeof wizard.currentSpell === "string" &&
        wizard.currentSpell === "triggerarea" &&
        wizard._triggerAreaPlacementDraft &&
        Array.isArray(wizard._triggerAreaPlacementDraft.points) &&
        wizard._triggerAreaPlacementDraft.points.length > 0
    );
}

function isMinimapCameraDetached() {
    return !!(
        typeof globalThis !== "undefined" &&
        globalThis.minimapCameraDetachState &&
        globalThis.minimapCameraDetachState.active
    );
}

function getMinimapCameraDetachState() {
    return (
        typeof globalThis !== "undefined" &&
        globalThis.minimapCameraDetachState &&
        typeof globalThis.minimapCameraDetachState === "object"
    )
        ? globalThis.minimapCameraDetachState
        : null;
}

function isKeyboardCameraPanModifierHeld() {
    return !!keysPressed["z"];
}

function ensureKeyboardDetachedCameraState() {
    if (typeof globalThis === "undefined") return null;
    const existingState = getMinimapCameraDetachState();
    const nextState = existingState && existingState.active
        ? existingState
        : {};
    nextState.active = true;
    nextState.source = "keyboard";
    nextState.wizardRef = wizard || null;
    nextState.wizardX = wizard && Number.isFinite(wizard.x) ? Number(wizard.x) : null;
    nextState.wizardY = wizard && Number.isFinite(wizard.y) ? Number(wizard.y) : null;
    globalThis.minimapCameraDetachState = nextState;
    return nextState;
}

function canPanDetachedCameraWithArrowKeys() {
    const detachState = getMinimapCameraDetachState();
    const keyboardModifierHeld = isKeyboardCameraPanModifierHeld();
    if (!detachState || !detachState.active) {
        if (!keyboardModifierHeld) return false;
    } else if (detachState.source === "keyboard" && !keyboardModifierHeld) {
        return false;
    }
    if (!!keysPressed[" "]) return false;
    if ($("#editorMenu").is(":visible")) return false;
    if ($("#spellMenu").is(":visible")) return false;
    if ($("#auraMenu").is(":visible")) return false;
    return true;
}

function updateDetachedCameraArrowPan(deltaSeconds) {
    if (!canPanDetachedCameraWithArrowKeys()) return false;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return false;

    if (!isMinimapCameraDetached() && isKeyboardCameraPanModifierHeld()) {
        ensureKeyboardDetachedCameraState();
    }

    let dirX = 0;
    let dirY = 0;
    if (keysPressed["arrowleft"]) dirX -= 1;
    if (keysPressed["arrowright"]) dirX += 1;
    if (keysPressed["arrowup"]) dirY -= 1;
    if (keysPressed["arrowdown"]) dirY += 1;
    if (dirX === 0 && dirY === 0) return false;

    const magnitude = Math.hypot(dirX, dirY) || 1;
    const moveDist = DETACHED_CAMERA_PAN_SPEED_UNITS_PER_SEC * deltaSeconds;
    const shiftX = (dirX / magnitude) * moveDist;
    const shiftY = (dirY / magnitude) * moveDist;
    if (typeof applyViewportWrapShift === "function") {
        applyViewportWrapShift(shiftX, shiftY);
    } else {
        viewport.x += shiftX;
        viewport.y += shiftY;
    }
    return true;
}

function setTriggerAreaCameraDetachFlag(active) {
    if (typeof globalThis !== "undefined") {
        globalThis.triggerAreaCameraDetachActive = !!active;
    }
}

function updateTriggerAreaEdgePan(deltaSeconds) {
    if (!isTriggerAreaCameraDetachActive()) return false;
    if (!app || !app.screen) return false;
    if (!Number.isFinite(mousePos.screenX) || !Number.isFinite(mousePos.screenY)) return false;
    const screenW = Math.max(1, Number(app.screen.width) || window.innerWidth || 1);
    const screenH = Math.max(1, Number(app.screen.height) || window.innerHeight || 1);
    const edgePx = 1;

    let dirX = 0;
    let dirY = 0;
    if (mousePos.screenX <= edgePx) dirX = -1;
    else if (mousePos.screenX >= (screenW - 1 - edgePx)) dirX = 1;
    if (mousePos.screenY <= edgePx) dirY = -1;
    else if (mousePos.screenY >= (screenH - 1 - edgePx)) dirY = 1;
    if (dirX === 0 && dirY === 0) return false;

    const dt = Math.max(0, Number(deltaSeconds) || 0);
    if (dt <= 0) return false;
    const moveDist = TRIGGER_AREA_EDGE_PAN_SPEED_UNITS_PER_SEC * dt;
    const shiftX = dirX * moveDist;
    const shiftY = dirY * moveDist;
    if (typeof applyViewportWrapShift === "function") {
        applyViewportWrapShift(shiftX, shiftY);
    } else {
        viewport.x += shiftX;
        viewport.y += shiftY;
    }
    return true;
}

// Pixi.js setup
const app = new PIXI.Application({
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: 0x000000,
    antialias: true
});
if (app && app.view && typeof app.view.addEventListener === "function") {
    app.view.addEventListener("webglcontextlost", (event) => {
        if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
        }
        const state = map && map._prototypeSectionState;
        const wallState = map && map._prototypeWallState;
        const objectState = map && map._prototypeObjectState;
        const animalState = map && map._prototypeAnimalState;
        const powerupState = map && map._prototypePowerupState;
        console.error("[WEBGL CONTEXT LOST]", {
            loadedNodes: state && Array.isArray(state.loadedNodes) ? state.loadedNodes.length : 0,
            activeSectionKeys: state && state.activeSectionKeys instanceof Set ? Array.from(state.activeSectionKeys) : [],
            pendingHydrations: state && state.pendingSectionHydrations instanceof Map ? state.pendingSectionHydrations.size : 0,
            pendingBubbleSession: !!(map && map._prototypeBubbleShiftSession),
            runtimeWalls: wallState && wallState.activeRuntimeWallsByRecordId instanceof Map ? wallState.activeRuntimeWallsByRecordId.size : 0,
            runtimeObjects: objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map ? objectState.activeRuntimeObjectsByRecordId.size : 0,
            runtimeAnimals: animalState && animalState.activeRuntimeAnimalsByRecordId instanceof Map ? animalState.activeRuntimeAnimalsByRecordId.size : 0,
            runtimePowerups: powerupState && powerupState.activeRuntimePowerupsByRecordId instanceof Map ? powerupState.activeRuntimePowerupsByRecordId.size : 0,
            wallSyncStats: wallState && wallState.lastSyncStats ? { ...wallState.lastSyncStats } : null,
            objectSyncStats: objectState && objectState.lastSyncStats ? { ...objectState.lastSyncStats } : null,
            animalSyncStats: animalState && animalState.lastSyncStats ? { ...animalState.lastSyncStats } : null,
            powerupSyncStats: powerupState && powerupState.lastSyncStats ? { ...powerupState.lastSyncStats } : null,
            layerChildren: {
                land: landLayer && landLayer.children ? landLayer.children.length : 0,
                roads: roadLayer && roadLayer.children ? roadLayer.children.length : 0,
                objects: objectLayer && objectLayer.children ? objectLayer.children.length : 0,
                roofs: roofLayer && roofLayer.children ? roofLayer.children.length : 0,
                characters: characterLayer && characterLayer.children ? characterLayer.children.length : 0,
                projectiles: projectileLayer && projectileLayer.children ? projectileLayer.children.length : 0
            }
        });
    }, false);
    app.view.addEventListener("webglcontextrestored", () => {
        console.warn("[WEBGL CONTEXT RESTORED]");
    }, false);
}

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
gameContainer.name = "gameContainer";
landLayer.name = "landLayer";
roadLayer.name = "roadLayer";
gridLayer.name = "gridLayer";
neighborDebugLayer.name = "neighborDebugLayer";
opaqueMeshLayer.name = "opaqueMeshLayer";
objectLayer.name = "objectLayer";
roofLayer.name = "roofLayer";
characterLayer.name = "characterLayer";
projectileLayer.name = "projectileLayer";
hitboxLayer.name = "hitboxLayer";
cursorLayer.name = "cursorLayer";
if (typeof globalThis !== "undefined") {
    globalThis.gameContainer = gameContainer;
    globalThis.landLayer = landLayer;
    globalThis.roadLayer = roadLayer;
    globalThis.gridLayer = gridLayer;
    globalThis.neighborDebugLayer = neighborDebugLayer;
    globalThis.opaqueMeshLayer = opaqueMeshLayer;
    globalThis.objectLayer = objectLayer;
    globalThis.roofLayer = roofLayer;
    globalThis.characterLayer = characterLayer;
    globalThis.projectileLayer = projectileLayer;
    globalThis.hitboxLayer = hitboxLayer;
    globalThis.cursorLayer = cursorLayer;
}

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
/** @type {Wizard|null} */
let wizard = null;
let cursorSprite = null; // Cursor sprite that points away from wizard
let spellCursor = null; // Alternate cursor for spacebar mode (line art)
let spellCursorGlow = null; // Glow effect shown when spacebar is held
let animalPreviewSprite = null; // Semi-transparent preview for SpawnAnimal spell
let treeGrowPreviewSprite = null; // Semi-transparent preview for TreeGrow spell
const ANIMAL_PREVIEW_METADATA_CATEGORY = "animals";
const animalPreviewMetricsByType = new Map();
const animalPreviewMetricsFetchByType = new Map();
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
    globalThis.animals = animals;
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

function updateTreeGrowPreview() {
    if (!treeGrowPreviewSprite) return;
    const showPreview = !!(
        wizard &&
        wizard.currentSpell === "treegrow" &&
        keysPressed[" "] &&
        Number.isFinite(mousePos.worldX) &&
        Number.isFinite(mousePos.worldY)
    );
    if (!showPreview) {
        treeGrowPreviewSprite.visible = false;
        return;
    }

    // Snap mouse world position to the nearest hex node (same as cast)
    const snapNode = wizard.map && typeof wizard.map.worldToNode === "function"
        ? wizard.map.worldToNode(mousePos.worldX, mousePos.worldY)
        : null;
    if (!snapNode) {
        treeGrowPreviewSprite.visible = false;
        return;
    }

    // Convert snapped node world position to canvas pixel coordinates
    const mapRef = wizard.map;
    const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
        ? mapRef.shortestDeltaX(viewport.x, snapNode.x)
        : (snapNode.x - viewport.x);
    const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
        ? mapRef.shortestDeltaY(viewport.y, snapNode.y)
        : (snapNode.y - viewport.y);
    const snapScreenX = dx * viewscale;
    const snapScreenY = dy * viewscale * xyratio;

    // Pick texture based on selected variant
    const variantIndex = (
        typeof SpellSystem !== "undefined" &&
        typeof SpellSystem.resolveTreePlacementTextureVariant === "function"
    )
        ? SpellSystem.resolveTreePlacementTextureVariant(wizard)
        : (Number.isInteger(wizard.selectedTreeTextureVariant) ? wizard.selectedTreeTextureVariant : 0);
    const tex = PIXI.Texture.from(`/assets/images/trees/tree${variantIndex}.png`);
    if (tex && treeGrowPreviewSprite.texture !== tex) {
        treeGrowPreviewSprite.texture = tex;
    }

    const placementSize = (
        typeof SpellSystem !== "undefined" &&
        SpellSystem &&
        typeof SpellSystem.resolveTreePlacementSize === "function"
    )
        ? SpellSystem.resolveTreePlacementSize(wizard)
        : (Number.isFinite(wizard.treeGrowPlacementSize) ? wizard.treeGrowPlacementSize : 4);
    treeGrowPreviewSprite.width = placementSize * viewscale;
    treeGrowPreviewSprite.height = placementSize * viewscale;
    treeGrowPreviewSprite.x = snapScreenX;
    treeGrowPreviewSprite.y = snapScreenY;
    treeGrowPreviewSprite.visible = true;
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

    // Size and anchor are driven by animals/items.json when available.
    const sizeScale = (wizard && Number.isFinite(wizard.selectedAnimalSizeScale))
        ? wizard.selectedAnimalSizeScale
        : 1;
    const metrics = getAnimalPreviewMetrics(selectedType);
    queueAnimalPreviewMetricsLoad(selectedType);
    const naturalSize = (typeof SpawnAnimal !== "undefined" && typeof SpawnAnimal.getPendingPlacementNaturalSize === "function")
        ? SpawnAnimal.getPendingPlacementNaturalSize(wizard)
        : (
            (typeof SpawnAnimal !== "undefined" && typeof SpawnAnimal.getRepresentativeNaturalSize === "function")
                ? SpawnAnimal.getRepresentativeNaturalSize(selectedType)
                : 1
        );
    const previewSize = resolveAnimalPreviewSize(selectedType, metrics, naturalSize, sizeScale);

    animalPreviewSprite.anchor.set(metrics.anchorX, metrics.anchorY);
    animalPreviewSprite.width = previewSize.width * viewscale;
    animalPreviewSprite.height = previewSize.height * viewscale;
    animalPreviewSprite.x = mousePos.screenX;
    animalPreviewSprite.y = mousePos.screenY;
    animalPreviewSprite.visible = true;
}

function resolveAnimalPreviewSize(typeName, metrics, naturalSize, sizeScale) {
    const resolvedNaturalSize = Number.isFinite(naturalSize) && naturalSize > 0 ? Number(naturalSize) : 1;
    const resolvedScale = Number.isFinite(sizeScale) && sizeScale > 0 ? Number(sizeScale) : 1;
    const metaWidth = Number.isFinite(metrics && metrics.baseWidth) ? Number(metrics.baseWidth) : 1;
    const metaHeight = Number.isFinite(metrics && metrics.baseHeight) ? Number(metrics.baseHeight) : 1;

    if (metaWidth > 0 && metaHeight > 0) {
        return {
            width: Math.max(0.01, resolvedNaturalSize * resolvedScale * (metaWidth / metaHeight)),
            height: Math.max(0.01, resolvedNaturalSize * resolvedScale)
        };
    }

    const representativeNaturalSize = (
        typeof SpawnAnimal !== "undefined" &&
        typeof SpawnAnimal.getRepresentativeNaturalSize === "function"
    )
        ? SpawnAnimal.getRepresentativeNaturalSize(typeName)
        : 1;
    const sizeRatio = representativeNaturalSize > 0 ? (resolvedNaturalSize / representativeNaturalSize) : 1;
    return {
        width: Math.max(0.01, metaWidth * sizeRatio * resolvedScale),
        height: Math.max(0.01, metaHeight * sizeRatio * resolvedScale)
    };
}

function getAnimalPreviewFallbackMetrics(typeName) {
    switch ((typeName || "").toLowerCase()) {
        case "squirrel": return { baseWidth: 0.5, baseHeight: 0.5, anchorX: 0.5, anchorY: 1 };
        case "goat": return { baseWidth: 0.99, baseHeight: 0.825, anchorX: 0.5, anchorY: 1 };
        case "deer": return { baseWidth: 1, baseHeight: 1, anchorX: 0.5, anchorY: 1 };
        case "bear": return { baseWidth: 2.03, baseHeight: 1.45, anchorX: 0.5, anchorY: 1 };
        case "eagleman": return { baseWidth: 2.03, baseHeight: 1.45, anchorX: 0.5, anchorY: 0.8 };
        case "fragglegod": return { baseWidth: 2.03, baseHeight: 1.45, anchorX: 0.5, anchorY: 1 };
        case "yeti": return { baseWidth: 2.1, baseHeight: 1.75, anchorX: 0.5, anchorY: 1 };
        case "blodia": return { baseWidth: 1.3125, baseHeight: 2.8, anchorX: 0.5, anchorY: 1 };
        default: return { baseWidth: 1, baseHeight: 1, anchorX: 0.5, anchorY: 1 };
    }
}

function getAnimalPreviewTexturePath(typeName) {
    const typeDef = (typeof SpawnAnimal !== "undefined" && Array.isArray(SpawnAnimal.ANIMAL_TYPES))
        ? SpawnAnimal.ANIMAL_TYPES.find(t => t.name === typeName)
        : null;
    return (typeDef && typeof typeDef.icon === "string" && typeDef.icon.length > 0)
        ? typeDef.icon
        : `/assets/images/animals/${encodeURIComponent(typeName || "squirrel")}.png`;
}

function getAnimalPreviewMetrics(typeName) {
    const key = (typeName || "squirrel").toLowerCase();
    if (animalPreviewMetricsByType.has(key)) return animalPreviewMetricsByType.get(key);
    return getAnimalPreviewFallbackMetrics(key);
}

function queueAnimalPreviewMetricsLoad(typeName) {
    const key = (typeName || "squirrel").toLowerCase();
    if (animalPreviewMetricsByType.has(key) || animalPreviewMetricsFetchByType.has(key)) return;
    if (!(typeof globalThis !== "undefined" && typeof globalThis.getResolvedPlaceableMetadata === "function")) return;
    const texturePath = getAnimalPreviewTexturePath(key);
    const fallback = getAnimalPreviewFallbackMetrics(key);
    const request = globalThis.getResolvedPlaceableMetadata(ANIMAL_PREVIEW_METADATA_CATEGORY, texturePath)
        .then(meta => {
            if (!meta || typeof meta !== "object") return fallback;
            const width = Number.isFinite(meta.width) ? Number(meta.width) : fallback.baseWidth;
            const height = Number.isFinite(meta.height) ? Number(meta.height) : fallback.baseHeight;
            const anchorObj = (meta.anchor && typeof meta.anchor === "object") ? meta.anchor : null;
            const anchorX = Number.isFinite(anchorObj && anchorObj.x) ? Number(anchorObj.x) : fallback.anchorX;
            const anchorY = Number.isFinite(anchorObj && anchorObj.y) ? Number(anchorObj.y) : fallback.anchorY;
            return {
                baseWidth: Math.max(0.01, width),
                baseHeight: Math.max(0.01, height),
                anchorX: Math.max(0, Math.min(1, anchorX)),
                anchorY: Math.max(0, Math.min(1, anchorY))
            };
        })
        .catch(() => fallback)
        .then(metrics => {
            animalPreviewMetricsByType.set(key, metrics);
            return metrics;
        })
        .finally(() => {
            animalPreviewMetricsFetchByType.delete(key);
        });
    animalPreviewMetricsFetchByType.set(key, request);
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
    .add('/assets/images/animals/eagleman/eagleman_down.png')
    .add('/assets/images/animals/eagleman/eagleman_down_attack.png')
    .add('/assets/images/animals/eagleman/eagleman_left.png')
    .add('/assets/images/animals/eagleman/eagleman_left_attack.png')
    .add('/assets/images/animals/eagleman/eagleman_right.png')
    .add('/assets/images/animals/eagleman/eagleman_right_attack.png')
    .add('/assets/images/animals/eagleman/eagleman_up.png')
    .add('/assets/images/animals/eagleman/eagleman_up_attack.png')
    .add('/assets/images/animals/fragglegod.png')
    .add('/assets/images/animals/blodia.png')
    .add('/assets/images/runningman.png')
    .add('/assets/images/magic/hi%20fi%20fireball.png')
    .add('/assets/images/magic/iceball.png')
    .add('/assets/images/magic/lightning.png')
    .add('/assets/images/arrow.png')
    .load(onAssetsLoaded);

function onAssetsLoaded() {
    // create an array to store the textures
    let spriteNames = ["walk_left", "walk_right", "attack_left", "attack_right"];
    function buildGridTextureGroup(resourcePath, cols, rows, frameKeys = null) {
        const resource = PIXI.Loader.shared.resources[resourcePath];
        const baseTexture = resource && resource.texture;
        if (!baseTexture) return null;

        const bt = baseTexture.baseTexture;
        const frameWidth = Math.floor(baseTexture.width / cols);
        const frameHeight = Math.floor(baseTexture.height / rows);
        if (!bt || frameWidth <= 0 || frameHeight <= 0) return null;

        const list = [];
        const byKey = {};
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x = col * frameWidth;
                const y = row * frameHeight;
                const width = (col === cols - 1) ? (baseTexture.width - x) : frameWidth;
                const height = (row === rows - 1) ? (baseTexture.height - y) : frameHeight;
                const texture = new PIXI.Texture(bt, new PIXI.Rectangle(x, y, width, height));
                list.push(texture);
                const keyIndex = row * cols + col;
                const key = Array.isArray(frameKeys) ? frameKeys[keyIndex] : null;
                if (key) {
                    byKey[key] = texture;
                }
            }
        }

        return { list, byKey };
    }

    function buildTextureGroupFromPaths(textureEntries) {
        if (!Array.isArray(textureEntries) || textureEntries.length === 0) return null;
        const list = [];
        const byKey = {};
        textureEntries.forEach(entry => {
            if (!entry || typeof entry.path !== 'string' || entry.path.length === 0) return;
            const texture = PIXI.Texture.from(entry.path);
            if (!texture) return;
            list.push(texture);
            if (typeof entry.key === 'string' && entry.key.length > 0) {
                byKey[entry.key] = texture;
            }
        });
        if (list.length === 0) return null;
        return { list, byKey };
    }

    const fragglegodTextures = buildGridTextureGroup(
        '/assets/images/animals/fragglegod.png',
        2,
        2,
        ["walk_left", "attack_left", "walk_right", "attack_right"]
    );
    if (fragglegodTextures) {
        textures['fragglegod'] = fragglegodTextures;
    }

    const blodiaBaseTexture = PIXI.Loader.shared.resources['/assets/images/animals/blodia.png'] &&
        PIXI.Loader.shared.resources['/assets/images/animals/blodia.png'].texture;
    if (blodiaBaseTexture) {
        const bw = blodiaBaseTexture.width;
        const bh = blodiaBaseTexture.height;
        const halfW = Math.floor(bw / 2);
        const bt = blodiaBaseTexture.baseTexture;
        const walkTex   = new PIXI.Texture(bt, new PIXI.Rectangle(0,      0, halfW, bh));
        const attackTex = new PIXI.Texture(bt, new PIXI.Rectangle(halfW,  0, bw - halfW, bh));
        textures['blodia'] = {
            list: [walkTex, attackTex],
            byKey: {
                walk_left:    walkTex,
                walk_right:   walkTex,
                attack_left:  attackTex,
                attack_right: attackTex
            }
        };
    }

    const eaglemanTextures = buildTextureGroupFromPaths([
        { key: 'down', path: '/assets/images/animals/eagleman/eagleman_down.png' },
        { key: 'down_attack', path: '/assets/images/animals/eagleman/eagleman_down_attack.png' },
        { key: 'left', path: '/assets/images/animals/eagleman/eagleman_left.png' },
        { key: 'left_attack', path: '/assets/images/animals/eagleman/eagleman_left_attack.png' },
        { key: 'right', path: '/assets/images/animals/eagleman/eagleman_right.png' },
        { key: 'right_attack', path: '/assets/images/animals/eagleman/eagleman_right_attack.png' },
        { key: 'up', path: '/assets/images/animals/eagleman/eagleman_up.png' },
        { key: 'up_attack', path: '/assets/images/animals/eagleman/eagleman_up_attack.png' }
    ]);
    if (eaglemanTextures) {
        textures['eagleman'] = eaglemanTextures;
    }

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
    cursorSprite.name = "cursorSprite";
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

    // Initialize spacebar glow behind the spell cursor
    spellCursorGlow = new PIXI.Graphics();
    cursorLayer.addChildAt(spellCursorGlow, cursorLayer.getChildIndex(spellCursor));
    spellCursorGlow.visible = false;
    spellCursorGlow.lineStyle(8, 0x44aaff, 0.5);
    for (let i = 0; i < 5; i++) {
        spellCursorGlow.moveTo(tenpoints[i*2].x, tenpoints[i*2].y);
        spellCursorGlow.lineTo(fivepoints[i].x, fivepoints[i].y);
        spellCursorGlow.lineTo(tenpoints[i*2+1].x, tenpoints[i*2+1].y);
    }
    spellCursorGlow.filters = [new PIXI.filters.BlurFilter(4)];

    // Initialize animal preview sprite (hidden by default)
    animalPreviewSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
    animalPreviewSprite.name = "animalPreviewSprite";
    animalPreviewSprite.anchor.set(0.5, 1);
    animalPreviewSprite.visible = false;
    animalPreviewSprite.alpha = 0.45;
    cursorLayer.addChild(animalPreviewSprite);

    // Initialize tree grow preview sprite (hidden by default)
    treeGrowPreviewSprite = new PIXI.Sprite(PIXI.Texture.from('/assets/images/trees/tree0.png'));
    treeGrowPreviewSprite.name = "treeGrowPreviewSprite";
    treeGrowPreviewSprite.anchor.set(0.5, 1);
    treeGrowPreviewSprite.visible = false;
    treeGrowPreviewSprite.alpha = 0.5;
    cursorLayer.addChild(treeGrowPreviewSprite);

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
    let lastSaveReloadDirective = null;

    function isPrototypeIndexedDbRoute() {
        return !!(
            startupConfig &&
            startupConfig.prototypeBuilder &&
            startupConfig.prototypeSaveBackend === "indexeddb"
        );
    }

    function shouldBootstrapPrototypeApisWithoutWorldLoad() {
        return isPrototypeIndexedDbRoute();
    }

    function normalizeSaveReloadDirective(directive) {
        if (!directive || typeof directive !== "object") return null;
        const source = String(directive.source || "").trim().toLowerCase();
        if (source !== "local" && source !== "server" && source !== "prototype-indexeddb") return null;
        const normalized = { source };
        if (source === "server" && typeof directive.fileName === "string" && directive.fileName.trim().length > 0) {
            normalized.fileName = directive.fileName.trim();
        }
        if (source === "prototype-indexeddb" && typeof directive.key === "string" && directive.key.trim().length > 0) {
            normalized.key = directive.key.trim();
        }
        return normalized;
    }

    function setLastSaveReloadDirective(directive) {
        const normalized = normalizeSaveReloadDirective(directive);
        if (!normalized) return false;
        lastSaveReloadDirective = normalized;
        if (typeof globalThis !== "undefined") {
            globalThis.lastSaveReloadDirective = { ...normalized };
        }
        return true;
    }

    function getLastSaveReloadDirective() {
        if (lastSaveReloadDirective) {
            return { ...lastSaveReloadDirective };
        }
        if (typeof getSavedGameState === "function") {
            const parsed = getSavedGameState();
            if (parsed && parsed.ok) {
                return { source: "local" };
            }
        }
        if (isPrototypeIndexedDbRoute() && typeof getActivePrototypeSaveSlotKey === "function") {
            const key = getActivePrototypeSaveSlotKey();
            if (typeof key === "string" && key.length > 0) {
                return { source: "prototype-indexeddb", key };
            }
        }
        return null;
    }

    function queueStartupLoadDirective(directive) {
        if (typeof sessionStorage === "undefined") return false;
        const normalized = normalizeSaveReloadDirective(directive);
        if (!normalized) return false;
        try {
            sessionStorage.setItem(startupLoadDirectiveStorageKey, JSON.stringify(normalized));
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

    function reloadLastSaveFromCheckpoint() {
        const directive = getLastSaveReloadDirective();
        if (!directive) return false;
        return reloadWithStartupLoadDirective(directive);
    }

    function formatStartupDifficultyLabel(difficulty) {
        if (typeof formatWizardDifficultyLabel === "function") {
            return formatWizardDifficultyLabel(difficulty);
        }
        const normalized = Math.max(1, Math.min(3, Math.round(Number(difficulty) || 2)));
        return normalized === 1 ? "Easy" : (normalized === 2 ? "Medium" : "Hard");
    }

    function formatStartupSaveTimestamp(timestamp) {
        if (typeof timestamp !== "string" || !timestamp.trim().length) return "—";
        const parsed = new Date(timestamp);
        if (Number.isNaN(parsed.getTime())) return timestamp;
        return parsed.toLocaleString();
    }

    function startupEvenQOffsetToAxial(x, y) {
        const q = Number(x) || 0;
        const offsetY = Number(y) || 0;
        return {
            q,
            r: offsetY - ((q + (q & 1)) / 2)
        };
    }

    function startupAxialToEvenQOffset(coord) {
        const q = Number(coord && coord.q) || 0;
        const r = Number(coord && coord.r) || 0;
        return {
            x: q,
            y: r + ((q + (q & 1)) / 2)
        };
    }

    function startupOffsetToWorld(offsetCoord) {
        const x = Number(offsetCoord && offsetCoord.x) || 0;
        const y = Number(offsetCoord && offsetCoord.y) || 0;
        return {
            x: x * 0.866,
            y: y + (x % 2 === 0 ? 0.5 : 0)
        };
    }

    function startupAxialDistance(a, b) {
        const aq = Number(a && a.q) || 0;
        const ar = Number(a && a.r) || 0;
        const bq = Number(b && b.q) || 0;
        const br = Number(b && b.r) || 0;
        const as = -aq - ar;
        const bs = -bq - br;
        return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as - bs));
    }

    function createPrototypeStartupBackgroundBundle() {
        const sectionRadius = 36;
        const anchorOffset = {
            x: Math.max(0, Math.floor((Number(map && map.width) || 0) * 0.5)),
            y: Math.max(0, Math.floor((Number(map && map.height) || 0) * 0.5))
        };
        const anchorCenter = startupEvenQOffsetToAxial(anchorOffset.x, anchorOffset.y);
        const centerWorld = startupOffsetToWorld(anchorOffset);
        const candidateTiles = [];
        for (let dq = -(sectionRadius - 1); dq <= (sectionRadius - 1); dq++) {
            for (let dr = -(sectionRadius - 1); dr <= (sectionRadius - 1); dr++) {
                const axial = {
                    q: anchorCenter.q + dq,
                    r: anchorCenter.r + dr
                };
                const distance = startupAxialDistance(axial, anchorCenter);
                if (distance > (sectionRadius - 1)) continue;
                if (distance <= 5) continue;
                candidateTiles.push(axial);
            }
        }

        const shuffledTiles = candidateTiles
            .map((axial) => ({ axial, sortKey: Math.random() }))
            .sort((a, b) => a.sortKey - b.sortKey)
            .map((entry) => entry.axial);
        const selectedTiles = [];
        for (let i = 0; i < shuffledTiles.length && selectedTiles.length < 156; i++) {
            const candidate = shuffledTiles[i];
            const tooClose = selectedTiles.some((chosen) => startupAxialDistance(candidate, chosen) <= 3);
            if (tooClose) continue;
            selectedTiles.push(candidate);
        }
        const objects = selectedTiles.map((axial) => {
            const offset = startupAxialToEvenQOffset(axial);
            const world = startupOffsetToWorld(offset);
            return {
                type: "tree",
                x: Number(world.x.toFixed(3)),
                y: Number(world.y.toFixed(3)),
                hp: 100,
                isOnFire: false,
                textureIndex: Math.floor(Math.random() * 5),
                size: Number((3.25 + (Math.random() * 1.5)).toFixed(2))
            };
        });

        const wizardState = (wizard && typeof wizard.saveJson === "function")
            ? wizard.saveJson()
            : {};
        wizardState.x = Number(centerWorld.x.toFixed(3));
        wizardState.y = Number(centerWorld.y.toFixed(3));

        return {
            radius: sectionRadius,
            sectionGraphRadius: 0,
            activeCenterKey: "0,0",
            anchorCenter,
            sectionCoords: [{ q: 0, r: 0 }],
            manifest: {
                activeCenterKey: "0,0",
                wizard: wizardState,
                los: {
                    mazeMode: false
                }
            },
            sections: [{
                key: "0,0",
                coord: { q: 0, r: 0 },
                centerAxial: anchorCenter,
                centerOffset: anchorOffset,
                objects,
                walls: [],
                animals: [],
                powerups: []
            }]
        };
    }

    async function ensurePrototypeStartupWorldBackground() {
        if (!isPrototypeIndexedDbRoute()) return false;
        if (!map || !wizard) return false;
        try {
            if (typeof map.loadPrototypeSectionWorld !== "function") return false;
            const bundle = createPrototypeStartupBackgroundBundle();
            if (!bundle || map.loadPrototypeSectionWorld(bundle) !== true) {
                return false;
            }
            if (typeof map.syncPrototypeWalls === "function") {
                map.syncPrototypeWalls();
            }
            if (typeof map.syncPrototypeObjects === "function") {
                map.syncPrototypeObjects();
            }
            if (typeof map.syncPrototypeAnimals === "function") {
                map.syncPrototypeAnimals();
            }
            if (typeof map.syncPrototypePowerups === "function") {
                map.syncPrototypePowerups();
            }
            const prototypeWizardState = (
                typeof globalThis !== "undefined" &&
                bundle.manifest &&
                bundle.manifest.wizard &&
                typeof bundle.manifest.wizard === "object"
            ) ? bundle.manifest.wizard : null;
            if (prototypeWizardState && typeof wizard.loadJson === "function") {
                wizard.loadJson(prototypeWizardState);
            }
            if (map && typeof map.updatePrototypeSectionBubble === "function") {
                map.updatePrototypeSectionBubble(wizard, { force: true });
            }
            if (typeof centerViewport === "function") {
                centerViewport(wizard, 0, 0);
            }
            if (typeof wizard.updateStatusBars === "function") {
                wizard.updateStatusBars();
            }
            if (typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
                globalThis.presentGameFrame();
            }
            return true;
        } catch (error) {
            console.error("Startup world background load failed:", error);
            return false;
        }
    }

    function hideStartupHudElements() {
        if (typeof document === "undefined") return () => {};
        const selectors = ["#statusBars", "#auraSelector", "#spellSelector", "#inventorySelector"];
        const previousStates = selectors.map((selector) => {
            const el = document.querySelector(selector);
            return {
                el,
                previousDisplay: el ? el.style.display : ""
            };
        });
        previousStates.forEach(({ el }) => {
            if (el) {
                el.style.display = "none";
            }
        });
        return () => {
            previousStates.forEach(({ el, previousDisplay }) => {
                if (!el) return;
                el.style.display = previousDisplay;
            });
        };
    }

    function buildStartupMenuContent() {
        return $("<div>")
            .addClass("startupDialogIntro startupModeDialogIntro");
    }

    function prototypePerfNow() {
        return (typeof performance !== "undefined" && performance && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
    }

    function getPrototypeStartupPerfSession() {
        if (typeof globalThis === "undefined") return null;
        const session = globalThis.__prototypeStartupPerfSession;
        return (session && typeof session === "object") ? session : null;
    }

    function markPrototypeStartupPerf(label, extra = null) {
        const session = getPrototypeStartupPerfSession();
        if (!session || typeof label !== "string" || !label.length) return null;
        const now = prototypePerfNow();
        const mark = {
            label,
            at: now,
            sinceStartMs: Number((now - session.startedAt).toFixed(1))
        };
        if (extra && typeof extra === "object") {
            mark.extra = { ...extra };
        }
        session.marks.push(mark);
        if (label === "loadGameState-complete" || label === "prototype-sync-complete" || label === "template-applied") {
            session.readyForFrameObservation = true;
        }
        const suffix = mark.extra ? ` ${JSON.stringify(mark.extra)}` : "";
        console.log(`[STARTUP PERF] ${label}: ${mark.sinceStartMs.toFixed(1)}ms${suffix}`);
        return mark;
    }

    function beginPrototypeStartupPerf(kind, extra = null) {
        if (typeof globalThis === "undefined") return null;
        const startedAt = prototypePerfNow();
        const session = {
            kind: String(kind || "startup"),
            startedAt,
            marks: [],
            firstVisibleLogged: false,
            firstWorldLogged: false,
            settledLogged: false,
            lastObservedCounts: null,
            readyForFrameObservation: false
        };
        globalThis.__prototypeStartupPerfSession = session;
        markPrototypeStartupPerf("start", extra || { kind: session.kind });
        return session;
    }

    function finishPrototypeStartupPerf(label = "finish", extra = null) {
        const session = getPrototypeStartupPerfSession();
        if (!session) return null;
        const mark = markPrototypeStartupPerf(label, extra);
        if (typeof globalThis !== "undefined") {
            globalThis.__prototypeStartupPerfLastSession = session;
            globalThis.__prototypeStartupPerfSession = null;
        }
        return mark;
    }

    function observePrototypeStartupPerfFrame() {
        const session = getPrototypeStartupPerfSession();
        if (!session || !map) return;
        if (session.readyForFrameObservation !== true) return;
        const state = map._prototypeSectionState;
        const loadedNodeCount = (state && Array.isArray(state.loadedNodes)) ? state.loadedNodes.length : 0;
        const wallState = map._prototypeWallState;
        const objectState = map._prototypeObjectState;
        const animalState = map._prototypeAnimalState;
        const powerupState = map._prototypePowerupState;
        const wallCount = (wallState && wallState.activeRuntimeWallsByRecordId instanceof Map)
            ? wallState.activeRuntimeWallsByRecordId.size
            : 0;
        const objectCount = (objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map)
            ? objectState.activeRuntimeObjectsByRecordId.size
            : 0;
        const animalCount = (animalState && animalState.activeRuntimeAnimalsByRecordId instanceof Map)
            ? animalState.activeRuntimeAnimalsByRecordId.size
            : 0;
        const powerupCount = (powerupState && powerupState.activeRuntimePowerupsByRecordId instanceof Map)
            ? powerupState.activeRuntimePowerupsByRecordId.size
            : 0;
        const pendingHydrations = (state && state.pendingSectionHydrations instanceof Map)
            ? state.pendingSectionHydrations.size
            : 0;
        const pendingBubbleSession = map._prototypeBubbleShiftSession ? 1 : 0;
        const snapshot = {
            loadedNodeCount,
            wallCount,
            objectCount,
            animalCount,
            powerupCount,
            pendingHydrations,
            pendingBubbleSession
        };

        if (!session.firstVisibleLogged && loadedNodeCount > 0) {
            session.firstVisibleLogged = true;
            markPrototypeStartupPerf("first-visible-nodes", snapshot);
        }
        if (!session.firstWorldLogged && (wallCount > 0 || objectCount > 0 || animalCount > 0 || powerupCount > 0)) {
            session.firstWorldLogged = true;
            markPrototypeStartupPerf("first-runtime-world", snapshot);
        }
        if (
            !session.settledLogged &&
            loadedNodeCount > 0 &&
            pendingHydrations === 0 &&
            pendingBubbleSession === 0 &&
            session.lastObservedCounts &&
            session.lastObservedCounts.loadedNodeCount === loadedNodeCount &&
            session.lastObservedCounts.wallCount === wallCount &&
            session.lastObservedCounts.objectCount === objectCount &&
            session.lastObservedCounts.animalCount === animalCount &&
            session.lastObservedCounts.powerupCount === powerupCount
        ) {
            session.settledLogged = true;
            markPrototypeStartupPerf("settled-frame", snapshot);
            finishPrototypeStartupPerf("startup-perf-finished", snapshot);
            return;
        }
        session.lastObservedCounts = snapshot;
    }

    if (typeof globalThis !== "undefined") {
        globalThis.beginPrototypeStartupPerf = beginPrototypeStartupPerf;
        globalThis.markPrototypeStartupPerf = markPrototypeStartupPerf;
        globalThis.finishPrototypeStartupPerf = finishPrototypeStartupPerf;
    }

    function ensurePrototypeLoadingOverlay() {
        if (typeof document === "undefined") return null;
        let overlay = document.getElementById("prototypeLoadingOverlay");
        if (overlay) return overlay;

        overlay = document.createElement("div");
        overlay.id = "prototypeLoadingOverlay";
        overlay.className = "hidden";
        overlay.innerHTML = [
            '<div class="prototypeLoadingCard">',
            '<div class="prototypeLoadingLabel">Loading</div>',
            '<div class="prototypeLoadingOrbit">',
            '<div class="prototypeLoadingOrbitRing"></div>',
            '<div class="prototypeLoadingComet">',
            '<div class="prototypeLoadingCometTail"></div>',
            '<div class="prototypeLoadingStar"></div>',
            '</div>',
            '</div>',
            '</div>'
        ].join("");
        document.body.appendChild(overlay);
        return overlay;
    }

    function showPrototypeLoadingOverlay(label = "Loading") {
        if (!isPrototypeIndexedDbRoute()) return;
        const overlay = ensurePrototypeLoadingOverlay();
        if (!overlay) return;
        const labelNode = overlay.querySelector(".prototypeLoadingLabel");
        if (labelNode) {
            labelNode.textContent = String(label || "Loading");
        }
        overlay.classList.remove("hidden", "is-fading");
        markPrototypeStartupPerf("overlay-shown", { label: String(label || "Loading") });
    }

    function hidePrototypeLoadingOverlay() {
        if (typeof document === "undefined") return;
        const overlay = document.getElementById("prototypeLoadingOverlay");
        if (!overlay) return;
        markPrototypeStartupPerf("overlay-hide-requested");
        overlay.classList.add("is-fading");
        window.setTimeout(() => {
            overlay.classList.add("hidden");
            overlay.classList.remove("is-fading");
            markPrototypeStartupPerf("overlay-hidden");
        }, 180);
    }

    function waitForPrototypeStartupWorkToSettle(timeoutMs = 20000) {
        if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
            return Promise.resolve();
        }
        const deadline = prototypePerfNow() + Math.max(0, Number(timeoutMs) || 0);
        return new Promise((resolve) => {
            const tick = () => {
                const state = map && map._prototypeSectionState;
                const pendingHydrations = (state && state.pendingSectionHydrations instanceof Map)
                    ? state.pendingSectionHydrations.size
                    : 0;
                const pendingBubbleSession = map && map._prototypeBubbleShiftSession ? 1 : 0;
                if ((pendingHydrations + pendingBubbleSession) === 0) {
                    resolve();
                    return;
                }
                if (prototypePerfNow() >= deadline) {
                    markPrototypeStartupPerf("startup-settle-timeout", {
                        pendingHydrations,
                        pendingBubbleSession
                    });
                    resolve();
                    return;
                }
                window.requestAnimationFrame(tick);
            };
            window.requestAnimationFrame(tick);
        });
    }

    function showOpeningModeDialog() {
        return showScrollDialog({
            title: "Wizard 4000",
            dialogClass: "startupScrollDialog startupModeScrollDialog",
            bodyClass: "startupDialogBody",
            buttonRowClass: "startupModeButtonRow",
            content: buildStartupMenuContent(),
            buttons: [
                { text: "New Game", value: { action: "new" }, unpause: false, className: "startupModeButton" },
                { text: "Load Game", value: { action: "load" }, unpause: false, className: "startupModeButton" }
            ]
        });
    }

    function showNewGameDialog(initialState = {}) {
        const initialName = (typeof initialState.name === "string" && initialState.name.trim().length > 0)
            ? initialState.name.trim()
            : "";
        const initialDifficulty = Math.max(1, Math.min(3, Math.round(Number(initialState.difficulty) || 2)));
        return new Promise(resolve => {
            let resolved = false;
            let $nameInput = null;
            let $validation = null;
            const finish = (result) => {
                if (resolved) return;
                resolved = true;
                resolve(result);
            };
            showScrollDialog({
                title: "New Game",
                dialogClass: "startupScrollDialog",
                bodyClass: "startupDialogBody",
                content: () => {
                    const $body = $("<div>").addClass("startupForm");
                    $validation = $("<div>")
                        .addClass("startupValidation hidden")
                        .text("Please enter a save name.");
                    $nameInput = $("<input>")
                        .attr({ type: "text", maxlength: 40, autocomplete: "off", spellcheck: "false" })
                        .addClass("startupTextInput")
                        .val(initialName)
                        .on("input", () => {
                            if ($validation) {
                                $validation.addClass("hidden");
                            }
                        })
                        .on("keydown", event => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                $(".scrollDialogButtons .startupPrimaryButton").first().trigger("click");
                            }
                        });

                    const difficultyOptions = [
                        { value: 1, label: "Easy" },
                        { value: 2, label: "Medium" },
                        { value: 3, label: "Hard" }
                    ];

                    $body
                        .append($("<label>").addClass("startupFieldLabel").text("Name"))
                        .append($nameInput)
                        .append($validation)
                        .append($("<div>").addClass("startupFieldLabel").text("Difficulty"))
                        .append(
                            $("<div>")
                                .addClass("startupDifficultyOptions")
                                .append(
                                    difficultyOptions.map(option => (
                                        $("<label>")
                                            .addClass("startupDifficultyOption")
                                            .append(
                                                $("<input>")
                                                    .attr({ type: "radio", name: "startupDifficulty", value: String(option.value) })
                                                    .prop("checked", option.value === initialDifficulty)
                                            )
                                            .append($("<span>").text(option.label))
                                    ))
                                )
                        )
                        .append(
                            $("<div>")
                                .addClass("startupHint")
                                .text("Easy restores magic fastest, hard restores it slowest.")
                        );
                    return $body;
                },
                buttons: [
                    {
                        text: "Back",
                        value: { action: "back" },
                        unpause: false,
                        onClick: () => {
                            const result = { action: "back" };
                            finish(result);
                            return result;
                        }
                    },
                    {
                        text: "Start",
                        className: "startupPrimaryButton",
                        unpause: false,
                        onClick: () => {
                            const name = $nameInput ? String($nameInput.val() || "").trim() : "";
                            const checkedDifficulty = Number($("input[name='startupDifficulty']:checked").val() || initialDifficulty);
                            if (!name.length) {
                                if ($validation) {
                                    $validation.removeClass("hidden").text("Please enter a save name.");
                                }
                                if ($nameInput) {
                                    $nameInput.trigger("focus");
                                    $nameInput.select();
                                }
                                return false;
                            }
                            if (typeof isReservedLocalSaveSlotKey === "function" && isReservedLocalSaveSlotKey(name)) {
                                if ($validation) {
                                    $validation.removeClass("hidden").text("That save name is reserved. Pick another one.");
                                }
                                if ($nameInput) {
                                    $nameInput.trigger("focus");
                                    $nameInput.select();
                                }
                                return false;
                            }
                            const existingSave = (typeof getSavedGameState === "function")
                                ? getSavedGameState(name)
                                : { ok: false };
                            if (existingSave && existingSave.ok) {
                                const shouldOverwrite = typeof window !== "undefined" && typeof window.confirm === "function"
                                    ? window.confirm(`A save named '${name}' already exists. Overwrite it?`)
                                    : true;
                                if (!shouldOverwrite) {
                                    return false;
                                }
                                if ($validation) {
                                    $validation.addClass("hidden");
                                }
                            }
                            const result = {
                                action: "start",
                                name,
                                difficulty: Math.max(1, Math.min(3, Math.round(checkedDifficulty || 2)))
                            };
                            finish(result);
                            return result;
                        },
                        type: "button"
                    }
                ],
                onShow: () => {
                    if ($nameInput) {
                        $nameInput.trigger("focus");
                        $nameInput.select();
                    }
                }
            }).then(result => {
                if (!resolved) {
                    finish(result && result.action ? result : { action: "back" });
                }
            });
        });
    }

    async function showLoadGameDialog() {
        const loadSaveEntries = async () => {
            if (isPrototypeIndexedDbRoute() && typeof getPrototypeSaveEntries === "function") {
                return await getPrototypeSaveEntries();
            }
            return (typeof getSavedGameEntries === "function") ? getSavedGameEntries() : [];
        };

        return new Promise(resolve => {
            let saveEntries = [];
            let resolved = false;
            let $body = null;
            let $table = null;
            let $validation = null;
            let $tableMount = null;
            let $emptyState = null;
            let $confirmBackdrop = null;
            let $confirmMessage = null;
            let $confirmNoButton = null;
            let pendingDeleteEntry = null;
            let selectedKey = saveEntries.length > 0 ? saveEntries[0].key : "";
            const finish = (result) => {
                if (resolved) return;
                resolved = true;
                resolve(result);
            };

            const closeDeleteConfirm = () => {
                pendingDeleteEntry = null;
                if ($confirmBackdrop) {
                    $confirmBackdrop.addClass("hidden");
                }
            };

            const openDeleteConfirm = (entry) => {
                pendingDeleteEntry = entry || null;
                if (!$confirmBackdrop || !$confirmMessage || !pendingDeleteEntry) return;
                $confirmMessage.text(`Delete this save file? This cannot be undone.\n\n${pendingDeleteEntry.key}`);
                $confirmBackdrop.removeClass("hidden");
                if ($confirmNoButton && $confirmNoButton.length) {
                    setTimeout(() => $confirmNoButton.trigger("focus"), 0);
                }
            };

            const refreshSaveTable = async () => {
                if (!$tableMount) return;
                saveEntries = await loadSaveEntries();
                if (!saveEntries.some(entry => entry.key === selectedKey)) {
                    selectedKey = saveEntries.length > 0 ? saveEntries[0].key : "";
                }

                if ($confirmBackdrop && $confirmBackdrop.parent().length) {
                    $confirmBackdrop.detach();
                }
                $tableMount.empty();
                if ($confirmBackdrop) {
                    $tableMount.append($confirmBackdrop);
                }
                if ($emptyState) {
                    $emptyState.toggleClass("hidden", saveEntries.length > 0);
                }
                if (!saveEntries.length) {
                    return;
                }

                $table = $("<table>").addClass("startupSaveTable");
                const $thead = $("<thead>").append(
                    $("<tr>")
                        .append($("<th>").text(""))
                        .append($("<th>").text("Save"))
                        .append($("<th>").text("Difficulty"))
                        .append($("<th>").text("Last Saved"))
                        .append($("<th>").addClass("startupSaveActionHeader").text(""))
                );
                const $tbody = $("<tbody>");

                saveEntries.forEach((entry, index) => {
                    const inputId = `startup-save-${index}`;
                    const isSelected = entry.key === selectedKey || (index === 0 && !selectedKey);
                    const $row = $("<tr>")
                        .toggleClass("isSelected", isSelected)
                        .data("saveKey", entry.key)
                        .click(() => {
                            selectedKey = entry.key;
                            $table.find("tbody tr").removeClass("isSelected");
                            $row.addClass("isSelected");
                            $(`#${inputId}`).prop("checked", true);
                        });
                    const $radio = $("<input>")
                        .attr({ type: "radio", name: "startupSaveKey", id: inputId })
                        .val(entry.key)
                        .prop("checked", isSelected)
                        .on("change", () => {
                            selectedKey = entry.key;
                            $table.find("tbody tr").removeClass("isSelected");
                            $row.addClass("isSelected");
                        });
                    const $deleteButton = $("<button>")
                        .addClass("startupSaveDeleteButton")
                        .attr({
                            type: "button",
                            title: `Delete ${entry.key}`,
                            "aria-label": `Delete ${entry.key}`
                        })
                        .text("🗑")
                        .click(event => {
                            event.preventDefault();
                            event.stopPropagation();
                            openDeleteConfirm(entry);
                        });
                    $row
                        .append($("<td>").append($radio))
                        .append($("<td>").text(entry.key))
                        .append($("<td>").text(formatStartupDifficultyLabel(entry.difficulty)))
                        .append($("<td>").text(formatStartupSaveTimestamp(entry.timestamp)))
                        .append($("<td>").addClass("startupSaveActionCell").append($deleteButton));
                    $tbody.append($row);
                });

                $table.append($thead, $tbody);
                if ($confirmBackdrop && $confirmBackdrop.parent().length) {
                    $confirmBackdrop.before($table);
                } else {
                    $tableMount.append($table);
                }
            };

            showScrollDialog({
                title: "Load Game",
                dialogClass: "startupScrollDialog",
                bodyClass: "startupDialogBody startupLoadDialogBody",
                content: () => {
                    $body = $("<div>").addClass("startupLoadPanel");
                    $validation = $("<div>").addClass("startupValidation hidden");
                    $emptyState = $("<p>")
                        .addClass("startupDialogLead")
                        .text(isPrototypeIndexedDbRoute()
                            ? "No saved games were found in IndexedDB."
                            : "No saved games were found in local storage.")
                        .toggleClass("hidden", saveEntries.length > 0);
                    $tableMount = $("<div>").addClass("startupSaveTableMount");
                    $confirmMessage = $("<p>").addClass("startupDeleteConfirmMessage");
                    $confirmNoButton = $("<button>")
                        .addClass("scrollMessageButton")
                        .attr("type", "button")
                        .text("no")
                        .click(event => {
                            event.preventDefault();
                            closeDeleteConfirm();
                        });
                    const $confirmYesButton = $("<button>")
                        .addClass("scrollMessageButton startupDeleteConfirmYes")
                        .attr("type", "button")
                        .text("yes")
                        .click(async event => {
                            event.preventDefault();
                            if (!pendingDeleteEntry) {
                                closeDeleteConfirm();
                                return;
                            }
                            const deletedKey = pendingDeleteEntry.key;
                            const deleteResult = isPrototypeIndexedDbRoute()
                                ? ((typeof deletePrototypeSaveSlot === "function")
                                    ? await deletePrototypeSaveSlot(deletedKey)
                                    : { ok: false, reason: "delete-unavailable" })
                                : ((typeof deleteLocalSaveSlot === "function")
                                    ? deleteLocalSaveSlot(deletedKey)
                                    : { ok: false, reason: "delete-unavailable" });
                            closeDeleteConfirm();
                            if (!deleteResult || !deleteResult.ok) {
                                if ($validation) {
                                    $validation.removeClass("hidden").text("Failed to delete the selected save.");
                                }
                                return;
                            }
                            if ($validation) {
                                $validation.removeClass("hidden").text(`Deleted '${deletedKey}'.`);
                            }
                            await refreshSaveTable();
                        });
                    $confirmBackdrop = $("<div>")
                        .addClass("startupDeleteConfirmBackdrop hidden")
                        .append(
                            $("<div>")
                                .addClass("startupDeleteConfirmPopup")
                                .append($("<h3>").addClass("startupDeleteConfirmTitle").text("Delete Save"))
                                .append($confirmMessage)
                                .append(
                                    $("<div>")
                                        .addClass("startupDeleteConfirmButtons")
                                        .append($confirmNoButton, $confirmYesButton)
                                )
                        );

                    $body
                        .append(
                            $("<p>")
                                .addClass("startupDialogLead")
                                .text("Choose a previously saved game to continue.")
                        )
                        .append($emptyState)
                        .append($tableMount)
                        .append($validation);
                    void refreshSaveTable();
                    return $body;
                },
                buttons: [
                    {
                        text: "Back",
                        value: { action: "back" },
                        unpause: false,
                        onClick: () => {
                            const result = { action: "back" };
                            finish(result);
                            return result;
                        }
                    },
                    {
                        text: "Load",
                        className: "startupPrimaryButton",
                        unpause: false,
                        onClick: () => {
                            if (!saveEntries.length) {
                                const result = { action: "back" };
                                finish(result);
                                return result;
                            }
                            if (pendingDeleteEntry) {
                                return false;
                            }
                            const chosenKey = String(selectedKey || $("input[name='startupSaveKey']:checked").val() || "").trim();
                            if (!chosenKey.length) {
                                if ($validation) {
                                    $validation.removeClass("hidden").text("Please select a save to load.");
                                }
                                return false;
                            }
                            const result = { action: "load", key: chosenKey };
                            finish(result);
                            return result;
                        }
                    }
                ]
            }).then(result => {
                if (!resolved) {
                    finish(result && result.action ? result : { action: "back" });
                }
            });
        });
    }

    async function startNewGameFromServerTemplate(config) {
        if (typeof loadGameStateFromServerFile !== "function") {
            return { ok: false, reason: "server-load-unavailable" };
        }
        const loadResult = await loadGameStateFromServerFile();
        if (!loadResult || !loadResult.ok) {
            return loadResult || { ok: false, reason: "server-load-failed" };
        }
        const nextName = String(config && config.name ? config.name : "").trim();
        const nextDifficulty = Math.max(1, Math.min(3, Math.round(Number(config && config.difficulty) || 2)));
        wizard.name = nextName || wizard.name;
        if (typeof wizard.setDifficulty === "function") {
            wizard.setDifficulty(nextDifficulty);
        } else {
            wizard.difficulty = nextDifficulty;
            wizard.magicRegenPerSecond = Math.max(0, 8 - nextDifficulty);
        }
        if (typeof wizard.updateStatusBars === "function") {
            wizard.updateStatusBars();
        }
        const scriptingApi = (typeof globalThis !== "undefined" && globalThis.Scripting && typeof globalThis.Scripting === "object")
            ? globalThis.Scripting
            : null;
        if (scriptingApi && typeof scriptingApi.fireObjectScriptEvent === "function") {
            const initTargets = (map && typeof map.getGameObjects === "function")
                ? map.getGameObjects({ refresh: true })
                : [];
            let bootstrapCount = 0;
            for (let i = 0; i < initTargets.length; i++) {
                const obj = initTargets[i];
                if (!obj || obj.gone) continue;
                const scriptTag = obj.script;
                if (!scriptTag || typeof scriptTag !== "object") continue;

                const hasNewGameScript = typeof scriptTag.newGame === "string" && scriptTag.newGame.trim().length > 0;
                if (hasNewGameScript) {
                    scriptingApi.fireObjectScriptEvent(obj, "newGame", wizard, { reason: "newGame" });
                    bootstrapCount += 1;
                }
            }
            if (bootstrapCount > 0) {
                console.log(`[NEW GAME] Ran startup scripts for ${bootstrapCount} object(s).`);
            }
        }
        const saveResult = (typeof saveGameStateToLocalStorage === "function")
            ? saveGameStateToLocalStorage(wizard.name)
            : { ok: false, reason: "local-save-unavailable" };
        if (saveResult && saveResult.ok) {
            setLastSaveReloadDirective({ source: "local" });
            return { ok: true, key: saveResult.key };
        }
        const shouldFallbackToServerSave = !!(
            !saveResult ||
            saveResult.reason === "quota-exceeded" ||
            saveResult.reason === "local-storage-unavailable" ||
            saveResult.reason === "write-failed"
        );
        if (shouldFallbackToServerSave && typeof saveGameStateToServerFile === "function") {
            const serverSaveResult = await saveGameStateToServerFile();
            if (serverSaveResult && serverSaveResult.ok) {
                setLastSaveReloadDirective({ source: "server" });
                console.warn("New game could not be cached locally; using server save instead.", saveResult && saveResult.error ? saveResult.error : saveResult);
                return {
                    ok: true,
                    key: null,
                    saveSource: "server",
                    warning: saveResult && saveResult.reason ? saveResult.reason : "local-save-failed"
                };
            }
        }
        return saveResult || { ok: false, reason: "local-save-failed" };
    }

    async function startNewPrototypeGame(config) {
        const nextName = String(config && config.name ? config.name : "").trim();
        const nextDifficulty = Math.max(1, Math.min(3, Math.round(Number(config && config.difficulty) || 2)));
        if (!nextName.length) {
            return { ok: false, reason: "missing-save-key" };
        }
        if (!map || typeof map.loadPrototypeSectionWorld !== "function") {
            return { ok: false, reason: "prototype-load-unavailable" };
        }

        const templateUrl = (typeof startupConfig.prototypeSectionAssetUrl === "string" && startupConfig.prototypeSectionAssetUrl.trim().length > 0)
            ? startupConfig.prototypeSectionAssetUrl.trim()
            : ((typeof startupConfig.prototypeSectionFallbackAssetUrl === "string" && startupConfig.prototypeSectionFallbackAssetUrl.trim().length > 0)
                ? startupConfig.prototypeSectionFallbackAssetUrl.trim()
                : "");
        if (!templateUrl.length || typeof fetch !== "function") {
            return { ok: false, reason: "prototype-template-unavailable" };
        }

        beginPrototypeStartupPerf("new-prototype-game", { key: nextName });
        showPrototypeLoadingOverlay("Loading");
        try {
            const getPrototypeBubbleKeys = (centerKey, availableKeys) => {
                const normalizedCenterKey = (typeof centerKey === "string" && centerKey.length > 0) ? centerKey : "0,0";
                const [qRaw, rRaw] = normalizedCenterKey.split(",");
                const q = Number(qRaw) || 0;
                const r = Number(rRaw) || 0;
                const neighborOffsets = [
                    [0, 0],
                    [1, 0],
                    [1, -1],
                    [0, -1],
                    [-1, 0],
                    [-1, 1],
                    [0, 1]
                ];
                const bubbleKeys = [];
                for (let i = 0; i < neighborOffsets.length; i++) {
                    const offset = neighborOffsets[i];
                    const key = `${q + offset[0]},${r + offset[1]}`;
                    if (availableKeys instanceof Set && !availableKeys.has(key)) continue;
                    if (bubbleKeys.indexOf(key) >= 0) continue;
                    bubbleKeys.push(key);
                }
                return bubbleKeys;
            };
            const hasQuery = templateUrl.includes("?");
            const response = await fetch(`${templateUrl}${hasQuery ? "&" : "?"}_ts=${Date.now()}`, { cache: "no-store" });
            if (!response || !response.ok) {
                return { ok: false, reason: "prototype-template-load-failed" };
            }
            markPrototypeStartupPerf("template-fetch-complete", { status: Number(response.status) || 0 });
            const bundle = await response.json();
            markPrototypeStartupPerf("template-json-ready");
            const manifest = (bundle && bundle.manifest && typeof bundle.manifest === "object")
                ? bundle.manifest
                : null;
            if (!bundle || typeof bundle !== "object") {
                return { ok: false, reason: "prototype-template-invalid" };
            }
            const fullSections = Array.isArray(bundle.sections) ? bundle.sections : [];
            const sectionCoords = fullSections
                .map((section) => section && section.coord && typeof section.coord === "object"
                    ? { q: Number(section.coord.q) || 0, r: Number(section.coord.r) || 0 }
                    : null)
                .filter((coord) => !!coord);
            const templateActiveCenterKey = (manifest && typeof manifest.activeCenterKey === "string" && manifest.activeCenterKey.length > 0)
                ? manifest.activeCenterKey
                : ((typeof bundle.activeCenterKey === "string" && bundle.activeCenterKey.length > 0)
                    ? bundle.activeCenterKey
                    : "0,0");
            const sectionRecordsByKey = new Map();
            for (let i = 0; i < fullSections.length; i++) {
                const section = fullSections[i];
                const key = (section && typeof section.key === "string" && section.key.length > 0)
                    ? section.key
                    : (section && section.coord ? `${Number(section.coord.q) || 0},${Number(section.coord.r) || 0}` : "");
                if (!key.length) continue;
                sectionRecordsByKey.set(key, section);
            }
            const initialBubbleKeys = getPrototypeBubbleKeys(templateActiveCenterKey, new Set(sectionRecordsByKey.keys()));
            const initialBundle = {
                ...bundle,
                activeCenterKey: templateActiveCenterKey,
                sectionCoords,
                sections: initialBubbleKeys
                    .map((key) => sectionRecordsByKey.get(key))
                    .filter((section) => !!section)
            };
            if (map.loadPrototypeSectionWorld(initialBundle) !== true) {
                return { ok: false, reason: "prototype-template-apply-failed" };
            }
            if (typeof map.setPrototypeSectionAssetLoader === "function") {
                map.setPrototypeSectionAssetLoader((sectionKeys) => {
                    const normalizedKeys = Array.isArray(sectionKeys) ? sectionKeys : [];
                    return normalizedKeys
                        .map((key) => sectionRecordsByKey.get(String(key || "")))
                        .filter((section) => !!section);
                });
                if (typeof map.prefetchPrototypeSectionAssets === "function" && typeof map.getPrototypeLookaheadSectionKeys === "function") {
                    const lookaheadKeys = Array.from(map.getPrototypeLookaheadSectionKeys(templateActiveCenterKey));
                    if (lookaheadKeys.length > 0) {
                        map.prefetchPrototypeSectionAssets(lookaheadKeys, { materialize: false });
                    }
                }
            }
            markPrototypeStartupPerf("template-applied");
            if (typeof map.syncPrototypeWalls === "function") {
                map.syncPrototypeWalls();
            }
            if (typeof map.syncPrototypeObjects === "function") {
                map.syncPrototypeObjects();
            }
            if (typeof map.syncPrototypeAnimals === "function") {
                map.syncPrototypeAnimals();
            }
            if (typeof map.syncPrototypePowerups === "function") {
                map.syncPrototypePowerups();
            }
            markPrototypeStartupPerf("prototype-sync-complete");
            if (manifest && manifest.wizard && typeof manifest.wizard === "object" && typeof wizard.loadJson === "function") {
                wizard.loadJson(manifest.wizard);
            }
            const savedMazeMode = (
                manifest &&
                manifest.los &&
                typeof manifest.los === "object" &&
                typeof manifest.los.mazeMode === "boolean"
            ) ? manifest.los.mazeMode : null;
            if (typeof applySavedLosMazeModeValue === "function") {
                applySavedLosMazeModeValue(savedMazeMode);
            }
            if (map && typeof map.updatePrototypeSectionBubble === "function") {
                map.updatePrototypeSectionBubble(wizard, { force: true });
            }
            if (typeof centerViewport === "function") {
                centerViewport(wizard, 0, 0);
            }
            markPrototypeStartupPerf("viewport-centered");
            wizard.name = nextName;
            if (typeof wizard.setDifficulty === "function") {
                wizard.setDifficulty(nextDifficulty);
            } else {
                wizard.difficulty = nextDifficulty;
                wizard.magicRegenPerSecond = Math.max(0, 8 - nextDifficulty);
            }
            if (typeof wizard.updateStatusBars === "function") {
                wizard.updateStatusBars();
            }
            if (typeof setActivePrototypeSaveSlotKey === "function") {
                setActivePrototypeSaveSlotKey(nextName);
            }
            setLastSaveReloadDirective({ source: "prototype-indexeddb", key: nextName });
            message(`Started new prototype game '${nextName}'`);
            markPrototypeStartupPerf("start-new-complete", { key: nextName });
            return { ok: true, key: nextName };
        } catch (error) {
            markPrototypeStartupPerf("start-new-failed", { reason: String(error && error.message || error || "error") });
            finishPrototypeStartupPerf("startup-perf-failed", {
                reason: String(error && error.message || error || "error")
            });
            return { ok: false, reason: "prototype-template-load-failed", error };
        } finally {
            hidePrototypeLoadingOverlay();
        }
    }

    function loadNamedLocalSave(saveKey) {
        if (typeof loadGameStateFromLocalStorageKey !== "function") {
            return { ok: false, reason: "local-load-unavailable" };
        }
        const result = loadGameStateFromLocalStorageKey(saveKey);
        if (result && result.ok) {
            setLastSaveReloadDirective({ source: "local" });
            if (wizard && typeof wizard.updateStatusBars === "function") {
                wizard.updateStatusBars();
            }
        }
        return result;
    }

    async function loadNamedPrototypeSave(saveKey) {
        if (typeof loadGameStateFromIndexedDbKey !== "function") {
            return { ok: false, reason: "indexeddb-load-unavailable" };
        }
        beginPrototypeStartupPerf("load-prototype-save", { key: saveKey });
        showPrototypeLoadingOverlay("Loading");
        try {
            markPrototypeStartupPerf("indexeddb-load-begin", { key: saveKey });
            const result = await loadGameStateFromIndexedDbKey(saveKey);
            markPrototypeStartupPerf("indexeddb-load-finished", {
                key: saveKey,
                ok: !!(result && result.ok),
                reason: result && result.reason ? String(result.reason) : ""
            });
            if (result && result.ok) {
                setLastSaveReloadDirective({ source: "prototype-indexeddb", key: saveKey });
            } else {
                finishPrototypeStartupPerf("startup-perf-failed", {
                    key: saveKey,
                    reason: result && result.reason ? String(result.reason) : "load-failed"
                });
            }
            return result;
        } finally {
            hidePrototypeLoadingOverlay();
        }
    }

    async function runOpeningGameDialogFlow() {
        let cachedNewGameState = {
            name: wizard && typeof wizard.name === "string" ? wizard.name : "",
            difficulty: 2
        };
        const restoreHud = hideStartupHudElements();
        try {
            while (true) {
                const modeChoice = await showOpeningModeDialog();
                if (modeChoice && modeChoice.action === "new") {
                    const newGameChoice = await showNewGameDialog(cachedNewGameState);
                    if (!newGameChoice || newGameChoice.action === "back") {
                        continue;
                    }
                    cachedNewGameState = {
                        name: newGameChoice.name,
                        difficulty: newGameChoice.difficulty
                    };
                    const startResult = isPrototypeIndexedDbRoute()
                        ? await startNewPrototypeGame(newGameChoice)
                        : await startNewGameFromServerTemplate(newGameChoice);
                    if (startResult && startResult.ok) {
                        clearDialogs();
                        return true;
                    }
                    const reason = (startResult && startResult.reason) ? String(startResult.reason) : "unknown error";
                    await showScrollMessage(`Unable to start a new game (${reason}).`, "ok", "New Game Failed");
                    continue;
                }

                if (!modeChoice || modeChoice.action !== "load") {
                    continue;
                }

                const loadChoice = await showLoadGameDialog();
                if (!loadChoice || loadChoice.action === "back") {
                    continue;
                }
                const loadResult = isPrototypeIndexedDbRoute()
                    ? await loadNamedPrototypeSave(loadChoice.key)
                    : loadNamedLocalSave(loadChoice.key);
                if (loadResult && loadResult.ok) {
                    clearDialogs();
                    return true;
                }
                await showScrollMessage(`Unable to load '${loadChoice.key}'.`, "ok", "Load Failed");
            }
        } finally {
            restoreHud();
        }
    }

    function ensureStartupClearanceReady() {
        if (map && typeof map.applyPrototypeSectionClearance === "function") {
            map.applyPrototypeSectionClearance();
            return;
        }
        if (map && typeof map.computeClearance === "function") {
            let needsCompute = false;
            outer:
            for (let x = 0; x < Math.min(map.width, 4); x++) {
                for (let y = 0; y < Math.min(map.height, 4); y++) {
                    const node = map.nodes[x] && map.nodes[x][y];
                    if (node && node.clearance === Infinity && !node.isBlocked()) {
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
    }

    function tryActivateWizardGameModeByChord(keyLower, event) {
        if (!wizard || typeof wizard.setGameMode !== "function") return false;
        if (event && (event.ctrlKey || event.altKey || event.metaKey)) return false;

        const pressedA = !!keysPressed["a"];
        const pressedD = !!keysPressed["d"];
        const pressedV = !!keysPressed["v"];
        const pressedG = !!keysPressed["g"];
        const pressedO = !!keysPressed["o"];

        const wantsAdventure = (keyLower === "a" || keyLower === "d" || keyLower === "v") && pressedA && pressedD && pressedV;
        const wantsGod = (keyLower === "g" || keyLower === "o" || keyLower === "d") && pressedG && pressedO && pressedD;
        if (!wantsAdventure && !wantsGod) return false;

        const nextMode = wantsAdventure ? "adventure" : "god";
        if (typeof event?.preventDefault === "function") {
            event.preventDefault();
        }
        wizard.setGameMode(nextMode);
        if (typeof message === "function") {
            message(
                nextMode === "adventure"
                    ? "Adventure mode activated. Dying reloads your last save."
                    : "God mode activated. You cannot die."
            );
        }
        if (typeof wizard.updateStatusBars === "function") {
            wizard.updateStatusBars();
        }
        return true;
    }

    if (typeof globalThis !== "undefined") {
        globalThis.reloadAndLoadSaveFromServerFile = (fileName = "") => {
            const trimmed = (typeof fileName === "string") ? fileName.trim() : "";
            const directive = { source: "server" };
            if (trimmed.length > 0) directive.fileName = trimmed;
            return reloadWithStartupLoadDirective(directive);
        };
        globalThis.reloadLastSaveFromCheckpoint = reloadLastSaveFromCheckpoint;
        globalThis.setLastSaveReloadDirective = setLastSaveReloadDirective;
        globalThis.getLastSaveReloadDirective = getLastSaveReloadDirective;
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

    function recordFloorEditDiagnosticFromRunaround(eventName, payload = null, options = null) {
        if (
            typeof globalThis !== "undefined" &&
            typeof globalThis.__recordFloorEditDiagnostic === "function"
        ) {
            globalThis.__recordFloorEditDiagnostic(eventName, payload, options);
        }
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

    function getMouseProjectionPlaneZ() {
        return 0;
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

    if (typeof globalThis !== "undefined" && typeof globalThis.exitGameplayPointerLock !== "function") {
        globalThis.exitGameplayPointerLock = exitGameplayPointerLock;
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
        return !!hovered.closest("#spellMenu, #selectedSpell, #spellSelector, #inventorySelector, #selectedInventory, #auraMenu, #selectedAura, #auraSelector, #activeAuraIcons, #editorMenu, #selectedEditor, #editorSelector");
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

    function getBaseViewportWidth() {
        return (window.innerWidth > window.innerHeight)
            ? VIEWPORT_BASE_WIDTH_LANDSCAPE
            : VIEWPORT_BASE_WIDTH_PORTRAIT;
    }

    function getViewportHeightForWidth(width) {
        const safeWidth = Math.max(0.01, Number(width) || getBaseViewportWidth());
        const aspectRatio = Math.max(1e-6, (Number(app.screen.height) || window.innerHeight || 1) / Math.max(1, Number(app.screen.width) || window.innerWidth || 1));
        return safeWidth * aspectRatio / xyratio;
    }

    function getViewportScreenCenter() {
        return {
            x: (Number(app.screen.width) || window.innerWidth || 0) * 0.5,
            y: (Number(app.screen.height) || window.innerHeight || 0) * 0.5
        };
    }

    function getViewportWorldCenter() {
        const CameraCtor = (typeof globalThis !== "undefined") ? globalThis.RenderingCamera : null;
        if (CameraCtor && typeof CameraCtor.getViewportWorldCenter === "function") {
            return CameraCtor.getViewportWorldCenter(viewport);
        }
        return {
            x: (Number(viewport.x) || 0) + (Number(viewport.width) || 0) * 0.5,
            y: (Number(viewport.y) || 0) + (Number(viewport.height) || 0) * 0.5
        };
    }

    function alignWorldPointToReference(referenceX, referenceY, worldX, worldY) {
        const CameraCtor = (typeof globalThis !== "undefined") ? globalThis.RenderingCamera : null;
        if (CameraCtor && typeof CameraCtor.alignWorldPointToReference === "function") {
            return CameraCtor.alignWorldPointToReference(map, referenceX, referenceY, worldX, worldY);
        }
        return { x: Number(worldX), y: Number(worldY) };
    }

    function getContinuousWrappedWorldX(referenceX, worldX) {
        const CameraCtor = (typeof globalThis !== "undefined") ? globalThis.RenderingCamera : null;
        if (CameraCtor && typeof CameraCtor.getContinuousWrappedValue === "function") {
            return CameraCtor.getContinuousWrappedValue(map, referenceX, worldX, "x");
        }
        return Number(worldX);
    }

    function getContinuousWrappedWorldY(referenceY, worldY) {
        const CameraCtor = (typeof globalThis !== "undefined") ? globalThis.RenderingCamera : null;
        if (CameraCtor && typeof CameraCtor.getContinuousWrappedValue === "function") {
            return CameraCtor.getContinuousWrappedValue(map, referenceY, worldY, "y");
        }
        return Number(worldY);
    }

    function setViewportCenterWorld(worldX, worldY) {
        if (!viewport || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
        let nextX = worldX - (Number(viewport.width) || 0) * 0.5;
        let nextY = worldY - (Number(viewport.height) || 0) * 0.5;
        nextX = getContinuousWrappedWorldX(viewport.x, nextX);
        nextY = getContinuousWrappedWorldY(viewport.y, nextY);
        viewport.x = nextX;
        viewport.y = nextY;
        viewport.prevX = nextX;
        viewport.prevY = nextY;
        return true;
    }

    function refreshCameraInputState() {
        if (pointerLockActive) {
            syncMouseScreenFromWorldWithViewport();
        }
        syncMouseWorldFromScreenWithViewport();
        if (Number.isFinite(mousePos.screenX) && Number.isFinite(mousePos.screenY)) {
            const dest = screenToHex(mousePos.screenX, mousePos.screenY);
            mousePos.x = dest.x;
            mousePos.y = dest.y;
        }
        updateCursor();

        if (
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.updateDragPreview === "function"
        ) {
            SpellSystem.updateDragPreview(wizard, mousePos.worldX, mousePos.worldY);
        }
        if (
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.updateTriggerAreaVertexDrag === "function"
        ) {
            SpellSystem.updateTriggerAreaVertexDrag(wizard, mousePos.worldX, mousePos.worldY);
        }
        if (
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.updateFloorEditorVertexDrag === "function"
        ) {
            SpellSystem.updateFloorEditorVertexDrag(wizard, mousePos.worldX, mousePos.worldY);
        }
    }

    function getScriptCameraFocusObject(focusTarget = null) {
        if (
            focusTarget &&
            typeof focusTarget === "object" &&
            !focusTarget.gone &&
            Number.isFinite(focusTarget.x) &&
            Number.isFinite(focusTarget.y)
        ) {
            return focusTarget;
        }
        if (wizard && Number.isFinite(wizard.x) && Number.isFinite(wizard.y)) {
            return wizard;
        }
        return null;
    }

    function getScriptCameraDesiredCenter(focusTarget = null, offsetX = 0, offsetY = 0, referenceCenter = null) {
        const focusObject = getScriptCameraFocusObject(focusTarget);
        if (!focusObject) return null;
        const desiredX = Number(focusObject.x) + (Number.isFinite(offsetX) ? Number(offsetX) : 0);
        const desiredY = Number(focusObject.y) + (Number.isFinite(offsetY) ? Number(offsetY) : 0);
        const fallbackCenter = getViewportWorldCenter();
        const refX = referenceCenter && Number.isFinite(referenceCenter.x)
            ? Number(referenceCenter.x)
            : fallbackCenter.x;
        const refY = referenceCenter && Number.isFinite(referenceCenter.y)
            ? Number(referenceCenter.y)
            : fallbackCenter.y;
        return alignWorldPointToReference(refX, refY, desiredX, desiredY);
    }

    function clearMinimapCameraDetachState() {
        if (typeof globalThis === "undefined") return;
        globalThis.minimapCameraDetachState = {
            active: false,
            source: null,
            wizardRef: null,
            wizardX: null,
            wizardY: null
        };
    }

    function updateScriptedCameraPan(nowMs = performance.now()) {
        if (!scriptedCameraPanState.active) return false;

        const startCenter = {
            x: Number.isFinite(scriptedCameraPanState.startCenterX)
                ? Number(scriptedCameraPanState.startCenterX)
                : getViewportWorldCenter().x,
            y: Number.isFinite(scriptedCameraPanState.startCenterY)
                ? Number(scriptedCameraPanState.startCenterY)
                : getViewportWorldCenter().y
        };
        const durationMs = Math.max(0, Number(scriptedCameraPanState.durationMs) || 0);
        const elapsedMs = Math.max(0, nowMs - (Number(scriptedCameraPanState.startMs) || 0));
        const progress = durationMs > 0 ? Math.max(0, Math.min(1, elapsedMs / durationMs)) : 1;
        const referenceCenter = progress < 1 ? startCenter : getViewportWorldCenter();
        const desiredCenter = getScriptCameraDesiredCenter(
            scriptedCameraPanState.focusTarget,
            scriptedCameraPanState.targetOffsetX,
            scriptedCameraPanState.targetOffsetY,
            referenceCenter
        );
        if (!desiredCenter) {
            scriptedCameraPanState.active = false;
            scriptedCameraPanState.focusTarget = null;
            return false;
        }

        let nextCenterX = desiredCenter.x;
        let nextCenterY = desiredCenter.y;
        if (progress < 1) {
            const deltaX = (map && typeof map.shortestDeltaX === "function")
                ? map.shortestDeltaX(startCenter.x, desiredCenter.x)
                : (desiredCenter.x - startCenter.x);
            const deltaY = (map && typeof map.shortestDeltaY === "function")
                ? map.shortestDeltaY(startCenter.y, desiredCenter.y)
                : (desiredCenter.y - startCenter.y);
            nextCenterX = startCenter.x + deltaX * progress;
            nextCenterY = startCenter.y + deltaY * progress;
        }

        const didMove = setViewportCenterWorld(nextCenterX, nextCenterY);
        if (didMove) {
            refreshCameraInputState();
        }

        if (progress >= 1 && scriptedCameraPanState.releaseOnSettle) {
            scriptedCameraPanState.active = false;
            scriptedCameraPanState.focusTarget = null;
            scriptedCameraPanState.targetOffsetX = 0;
            scriptedCameraPanState.targetOffsetY = 0;
        }

        return didMove;
    }

    function updateScriptedCameraZoom(nowMs = performance.now()) {
        if (!scriptedCameraZoomState.active) return false;
        const durationMs = Math.max(0, Number(scriptedCameraZoomState.durationMs) || 0);
        const elapsedMs = Math.max(0, nowMs - (Number(scriptedCameraZoomState.startMs) || 0));
        const progress = durationMs > 0 ? Math.max(0, Math.min(1, elapsedMs / durationMs)) : 1;
        const startFactor = Math.max(VIEWPORT_ZOOM_MIN, Math.min(VIEWPORT_ZOOM_MAX, Number(scriptedCameraZoomState.startFactor) || viewportZoomFactor || 1));
        const targetFactor = Math.max(VIEWPORT_ZOOM_MIN, Math.min(VIEWPORT_ZOOM_MAX, Number(scriptedCameraZoomState.targetFactor) || startFactor));
        const nextFactor = startFactor + (targetFactor - startFactor) * progress;
        const anchor = getViewportScreenCenter();

        viewportZoomTargetFactor = nextFactor;
        applyViewportZoomFactor(nextFactor, {
            anchorScreenX: anchor.x,
            anchorScreenY: anchor.y,
            updateInputState: true,
            refreshPresentation: false,
            keepPrevInterpolated: false
        });

        if (progress >= 1) {
            scriptedCameraZoomState.active = false;
            viewportZoomTargetFactor = targetFactor;
        }

        return true;
    }

    function startScriptedCameraPan(options = {}) {
        const center = getViewportWorldCenter();
        scriptedCameraPanState.active = true;
        scriptedCameraPanState.focusTarget = (options && typeof options === "object" && options.target) || null;
        scriptedCameraPanState.targetOffsetX = Number.isFinite(options && options.x) ? Number(options.x) : 0;
        scriptedCameraPanState.targetOffsetY = Number.isFinite(options && options.y) ? Number(options.y) : 0;
        scriptedCameraPanState.startCenterX = center.x;
        scriptedCameraPanState.startCenterY = center.y;
        scriptedCameraPanState.startMs = performance.now();
        scriptedCameraPanState.durationMs = Math.max(0, (Number(options && options.seconds) || 0) * 1000);
        scriptedCameraPanState.releaseOnSettle = !!(options && options.releaseOnSettle);
        clearMinimapCameraDetachState();
        updateScriptedCameraPan(scriptedCameraPanState.startMs);
        return true;
    }

    function startScriptedCameraZoom(targetFactor, seconds = 0) {
        const nextTarget = Math.max(VIEWPORT_ZOOM_MIN, Math.min(VIEWPORT_ZOOM_MAX, Number(targetFactor)));
        const nextSeconds = Number(seconds);
        if (!Number.isFinite(nextTarget) || !Number.isFinite(nextSeconds)) return false;
        scriptedCameraZoomState.active = true;
        scriptedCameraZoomState.startFactor = Math.max(VIEWPORT_ZOOM_MIN, Math.min(VIEWPORT_ZOOM_MAX, Number(viewportZoomFactor) || 1));
        scriptedCameraZoomState.targetFactor = nextTarget;
        scriptedCameraZoomState.startMs = performance.now();
        scriptedCameraZoomState.durationMs = Math.max(0, nextSeconds * 1000);
        updateScriptedCameraZoom(scriptedCameraZoomState.startMs);
        return true;
    }

    function resetScriptedCamera(seconds = 0) {
        const nextSeconds = Number(seconds);
        if (!Number.isFinite(nextSeconds)) return false;
        const panStarted = startScriptedCameraPan({
            x: 0,
            y: 0,
            seconds: nextSeconds,
            releaseOnSettle: true
        });
        const zoomStarted = startScriptedCameraZoom(SCRIPT_CAMERA_DEFAULT_ZOOM_FACTOR, nextSeconds);
        return !!(panStarted || zoomStarted);
    }

    if (typeof globalThis !== "undefined") {
        globalThis.scriptedCameraPanState = scriptedCameraPanState;
        globalThis.scriptedCameraZoomState = scriptedCameraZoomState;
        globalThis.scriptCameraPanTo = function scriptCameraPanTo(options = {}) {
            return startScriptedCameraPan(options);
        };
        globalThis.scriptCameraZoomTo = function scriptCameraZoomTo(targetFactor, seconds = 0) {
            return startScriptedCameraZoom(targetFactor, seconds);
        };
        globalThis.scriptCameraReset = function scriptCameraReset(seconds = 0) {
            return resetScriptedCamera(seconds);
        };
    }

    function applyViewportZoomFactor(nextZoomFactor, options = {}) {
        const updateInputState = options.updateInputState !== false;
        const refreshPresentation = options.refreshPresentation !== false;
        const keepPrevInterpolated = options.keepPrevInterpolated !== false;
        const clampedZoom = Math.max(VIEWPORT_ZOOM_MIN, Math.min(VIEWPORT_ZOOM_MAX, Number(nextZoomFactor) || 1));
        const oldViewScale = (typeof viewscale !== "undefined" && Number.isFinite(viewscale) && viewscale > 1e-6)
            ? Number(viewscale)
            : ((Number(app.screen.width) || 1) / Math.max(0.01, Number(viewport.width) || getBaseViewportWidth()));
        const oldViewportX = Number.isFinite(viewport.x) ? Number(viewport.x) : 0;
        const oldViewportY = Number.isFinite(viewport.y) ? Number(viewport.y) : 0;
        const oldViewportPrevX = Number.isFinite(viewport.prevX) ? Number(viewport.prevX) : oldViewportX;
        const oldViewportPrevY = Number.isFinite(viewport.prevY) ? Number(viewport.prevY) : oldViewportY;
        const defaultAnchorX = (Number(app.screen.width) || window.innerWidth || 0) * 0.5;
        const defaultAnchorY = (Number(app.screen.height) || window.innerHeight || 0) * 0.5;
        const anchorScreenX = Number.isFinite(options.anchorScreenX) ? Number(options.anchorScreenX) : defaultAnchorX;
        const anchorScreenY = Number.isFinite(options.anchorScreenY) ? Number(options.anchorScreenY) : defaultAnchorY;
        const anchorWorldX = oldViewportX + anchorScreenX / oldViewScale;
        const anchorWorldY = oldViewportY + anchorScreenY / (oldViewScale * xyratio);
        const anchorPrevWorldX = oldViewportPrevX + anchorScreenX / oldViewScale;
        const anchorPrevWorldY = oldViewportPrevY + anchorScreenY / (oldViewScale * xyratio);

        viewportZoomFactor = clampedZoom;
        viewport.width = getBaseViewportWidth() / viewportZoomFactor;
        viewport.height = getViewportHeightForWidth(viewport.width);
        viewscale = (Number(app.screen.width) || 1) / Math.max(0.01, viewport.width);
        viewScale = viewscale;
        viewport.x = anchorWorldX - anchorScreenX / viewscale;
        viewport.y = anchorWorldY - anchorScreenY / (viewscale * xyratio);
        if (keepPrevInterpolated) {
            viewport.prevX = anchorPrevWorldX - anchorScreenX / viewscale;
            viewport.prevY = anchorPrevWorldY - anchorScreenY / (viewscale * xyratio);
        } else {
            viewport.prevX = viewport.x;
            viewport.prevY = viewport.y;
        }

        if (Number.isFinite(viewport.x)) {
            viewport.x = getContinuousWrappedWorldX(oldViewportX, viewport.x);
        }
        if (Number.isFinite(viewport.prevX)) {
            viewport.prevX = getContinuousWrappedWorldX(oldViewportPrevX, viewport.prevX);
        }
        if (Number.isFinite(viewport.y)) {
            viewport.y = getContinuousWrappedWorldY(oldViewportY, viewport.y);
        }
        if (Number.isFinite(viewport.prevY)) {
            viewport.prevY = getContinuousWrappedWorldY(oldViewportPrevY, viewport.prevY);
        }

        if (typeof globalThis !== "undefined") {
            globalThis.viewscale = viewscale;
            globalThis.viewScale = viewscale;
            globalThis.viewportZoomFactor = viewportZoomFactor;
        }

        if (updateInputState) {
            refreshCameraInputState();
        }

        if (refreshPresentation && typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
            globalThis.presentGameFrame();
        }
    }

    function zoomViewportByWheelDelta(deltaPixels, options = {}) {
        if (!Number.isFinite(deltaPixels) || deltaPixels === 0) return false;
        const zoomMultiplier = Math.exp(-deltaPixels * 0.0015);
        if (!Number.isFinite(zoomMultiplier) || zoomMultiplier <= 0) return false;
        const previousTarget = viewportZoomTargetFactor;
        viewportZoomTargetFactor = Math.max(VIEWPORT_ZOOM_MIN, Math.min(VIEWPORT_ZOOM_MAX, previousTarget * zoomMultiplier));
        viewportZoomAnchorScreenX = Number.isFinite(options.anchorScreenX)
            ? Number(options.anchorScreenX)
            : ((Number(app.screen.width) || window.innerWidth || 0) * 0.5);
        viewportZoomAnchorScreenY = Number.isFinite(options.anchorScreenY)
            ? Number(options.anchorScreenY)
            : ((Number(app.screen.height) || window.innerHeight || 0) * 0.5);
        return Math.abs(viewportZoomTargetFactor - previousTarget) > 1e-6;
    }

    function updateSmoothViewportZoom(frameDeltaMs) {
        const targetZoom = Math.max(VIEWPORT_ZOOM_MIN, Math.min(VIEWPORT_ZOOM_MAX, Number(viewportZoomTargetFactor) || viewportZoomFactor || 1));
        const currentZoom = Math.max(VIEWPORT_ZOOM_MIN, Math.min(VIEWPORT_ZOOM_MAX, Number(viewportZoomFactor) || 1));
        const deltaZoom = targetZoom - currentZoom;
        if (Math.abs(deltaZoom) <= 1e-5) {
            if (Math.abs(targetZoom - currentZoom) > 0) {
                applyViewportZoomFactor(targetZoom, {
                    anchorScreenX: viewportZoomAnchorScreenX,
                    anchorScreenY: viewportZoomAnchorScreenY,
                    updateInputState: true,
                    refreshPresentation: false,
                    keepPrevInterpolated: false
                });
            }
            viewportZoomFactor = targetZoom;
            return false;
        }
        const dt = Math.max(0, Number(frameDeltaMs) || 0);
        const blend = 1 - Math.exp(-(dt / 1000) * VIEWPORT_ZOOM_SMOOTHING_PER_SEC);
        const nextZoom = (blend > 0)
            ? (currentZoom + deltaZoom * blend)
            : targetZoom;
        const snappedZoom = Math.abs(targetZoom - nextZoom) <= 0.0005 ? targetZoom : nextZoom;
        applyViewportZoomFactor(snappedZoom, {
            anchorScreenX: viewportZoomAnchorScreenX,
            anchorScreenY: viewportZoomAnchorScreenY,
            updateInputState: true,
            refreshPresentation: false,
            keepPrevInterpolated: false
        });
        viewportZoomFactor = snappedZoom;
        return true;
    }

    function sizeView() {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        viewportZoomTargetFactor = Math.max(VIEWPORT_ZOOM_MIN, Math.min(VIEWPORT_ZOOM_MAX, Number(viewportZoomTargetFactor) || viewportZoomFactor || 1));

        applyViewportZoomFactor(viewportZoomFactor, {
            anchorScreenX: (Number(app.screen.width) || window.innerWidth || 0) * 0.5,
            anchorScreenY: (Number(app.screen.height) || window.innerHeight || 0) * 0.5,
            keepPrevInterpolated: false
        });

        if (!isMinimapCameraDetached() && !isTriggerAreaCameraDetachActive()) {
            centerViewport(wizard, 0);
            viewport.prevX = viewport.x;
            viewport.prevY = viewport.y;
        }

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

    function getEditorMenuIconElements() {
        const grid = document.getElementById("editorGrid");
        if (!grid) return [];
        return Array.from(grid.querySelectorAll(".spellIcon, .editorToolIcon, button"));
    }

    function clearEditorMenuKeyboardFocus() {
        getEditorMenuIconElements().forEach(icon => icon.classList.remove("keyboard-nav-focus"));
        editorMenuKeyboardIndex = -1;
    }

    function setEditorMenuKeyboardFocus(index) {
        const icons = getEditorMenuIconElements();
        if (!icons.length) {
            editorMenuKeyboardIndex = -1;
            return false;
        }
        const clamped = Math.max(0, Math.min(icons.length - 1, index));
        icons.forEach(icon => icon.classList.remove("keyboard-nav-focus"));
        icons[clamped].classList.add("keyboard-nav-focus");
        editorMenuKeyboardIndex = clamped;
        return true;
    }

    function initEditorMenuKeyboardFocus() {
        const icons = getEditorMenuIconElements();
        if (!icons.length) {
            editorMenuKeyboardIndex = -1;
            return false;
        }
        const selectedIndex = icons.findIndex(icon => icon.classList.contains("selected"));
        return setEditorMenuKeyboardFocus(selectedIndex >= 0 ? selectedIndex : 0);
    }

    function moveEditorMenuKeyboardFocus(dx, dy) {
        const icons = getEditorMenuIconElements();
        if (!icons.length) return false;
        if (!Number.isInteger(editorMenuKeyboardIndex) || editorMenuKeyboardIndex < 0 || editorMenuKeyboardIndex >= icons.length) {
            initEditorMenuKeyboardFocus();
        }
        const grid = document.getElementById("editorGrid");
        const computed = grid ? window.getComputedStyle(grid) : null;
        const cols = (() => {
            if (!computed) return 4;
            const template = computed.gridTemplateColumns || "";
            if (!template || template === "none") return 4;
            const count = template.split(" ").filter(token => token && token !== "/").length;
            return Math.max(1, count);
        })();
        const current = Math.max(0, editorMenuKeyboardIndex);
        const row = Math.floor(current / cols);
        const col = current % cols;
        const nextRow = Math.max(0, row + dy);
        const nextCol = Math.max(0, Math.min(cols - 1, col + dx));
        let next = nextRow * cols + nextCol;
        if (next >= icons.length) next = icons.length - 1;
        return setEditorMenuKeyboardFocus(next);
    }

    function activateSelectedEditorToolFromMenu() {
        const icons = getEditorMenuIconElements();
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
        const opensSubmenu = !!(target.dataset && target.dataset.opensSubmenu === "true");
        target.click();
        return { activated: true, shouldCloseMenu: !isBackAction && !opensSubmenu };
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
        if (spellName === "flooredit" && typeof SpellSystem.showFloorEditingMenu === "function") {
            SpellSystem.showFloorEditingMenu(wizard);
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
        if (spellName === "triggerarea" && typeof SpellSystem.showTriggerAreaMenu === "function") {
            SpellSystem.showTriggerAreaMenu(wizard);
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
        if (!!keysPressed["e"]) return true;
        // In editor mode, space also works as the editor activation key
        const inEditorMode = (typeof SpellSystem !== "undefined" && typeof SpellSystem.isEditorMode === "function" && SpellSystem.isEditorMode());
        if (inEditorMode && !!keysPressed[" "]) return true;
        return false;
    }

    function updateEditorPlacementActiveState(active) {
        if (!wizard) return;
        wizard.editorPlacementActive = !!active && isEditorPlacementSpellActive();
    }

    console.log("Generating map...");
    initRoadLayer();
    let resolveMapReady = null;
    const mapReadyPromise = new Promise((resolve) => {
        resolveMapReady = resolve;
    });
    map = new GameMap(mapHeight, mapWidth, {
        skipClearance: true,
        skipScenery: !!startupConfig.prototypeBuilder,
        skipAnimals: !!startupConfig.prototypeBuilder,
        wrapX: startupConfig.wrapX !== false,
        wrapY: startupConfig.wrapY !== false
    }, async () => {
        if (shouldBootstrapPrototypeApisWithoutWorldLoad()) {
            const bootstrapFn = (typeof globalThis !== "undefined")
                ? (globalThis.bootstrapSectionWorldApis || globalThis.bootstrapTwoSectionPrototypeApis)
                : null;
            if (typeof bootstrapFn === "function") {
                try {
                    bootstrapFn(map);
                } catch (error) {
                    console.error("Prototype API bootstrap failed:", error);
                }
            }
        } else if (typeof startupConfig.prototypeBuilder === "string" && startupConfig.prototypeBuilder.length > 0) {
            const builderFn = (typeof globalThis !== "undefined")
                ? globalThis[startupConfig.prototypeBuilder]
                : null;
            if (typeof builderFn === "function") {
                try {
                    await builderFn(map);
                } catch (error) {
                    console.error(`Startup prototype builder '${startupConfig.prototypeBuilder}' failed:`, error);
                }
            }
        }
        const simStepMs = 1000 / frameRate;
        const animalAiOnscreenHz = 10;
        const animalAiOffscreenHz = 1.5;
        const animalAiMaxStepsPerSim = 10;
        const inactiveMovementDecimation = 6;
        let simAccumulatorMs = 0;
        let nonWizardSimStepAccumulator = 0;
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

            const prioritizeAttackers = (list) => {
                if (!Array.isArray(list) || list.length < 2) return;
                list.sort((a, b) => {
                    const aEngaged = !!(a && a.attackState && a.attackState !== "idle");
                    const bEngaged = !!(b && b.attackState && b.attackState !== "idle");
                    return Number(bEngaged) - Number(aEngaged);
                });
            };
            prioritizeAttackers(dueOnscreen);
            prioritizeAttackers(dueOffscreen);

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

        // Returns true if (x, y) is on solid floor at the given layer number.
        // Solid means: inside an outer polygon AND not inside any hole polygon of a
        // registered floor fragment at that layer. Ground (layer 0) is treated as
        // unconditionally solid when no floor fragments are registered at that level.
        function isPositionSupportedAtLayer(x, y, layer, mapRef) {
            if (!(mapRef && mapRef.floorsById instanceof Map)) return true;
            let hasFragmentsAtLayer = false;
            for (const fragment of mapRef.floorsById.values()) {
                if (!fragment) continue;
                const fragLevel = Number.isFinite(fragment.level) ? Math.round(fragment.level) : 0;
                if (fragLevel !== layer) continue;
                if (!Array.isArray(fragment.outerPolygon) || fragment.outerPolygon.length < 3) continue;
                hasFragmentsAtLayer = true;
                if (!pointInPolygon2D(x, y, fragment.outerPolygon)) continue;
                // Point is inside the fragment's outer area. Check whether it's also
                // inside one of the cut-out holes (which means it's NOT supported).
                const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
                let inHole = false;
                for (const hole of holes) {
                    if (Array.isArray(hole) && hole.length >= 3 && pointInPolygon2D(x, y, hole)) {
                        inHole = true;
                        break;
                    }
                }
                if (!inHole) return true;
            }
            // No registered fragments at this layer → ground (layer 0) is always solid.
            if (!hasFragmentsAtLayer && layer === 0) return true;
            return false;
        }

        function getLowestRegisteredFloorLayer(mapRef) {
            if (!(mapRef && mapRef.floorsById instanceof Map) || mapRef.floorsById.size <= 0) return 0;
            let minLayer = 0;
            for (const fragment of mapRef.floorsById.values()) {
                if (!fragment) continue;
                const layer = Number.isFinite(fragment.level) ? Math.round(fragment.level) : 0;
                if (layer < minLayer) minLayer = layer;
            }
            return minLayer;
        }

        function getLayerBaseZ(layer) {
            return Math.round(Number.isFinite(layer) ? Number(layer) : 0) * 3;
        }

        // Gravity in world-units/sec² for the floor-fall animation.
        const FLOOR_FALL_GRAVITY = -9;
        // Negative z threshold at which the fall "lands" (sprite has slid off screen).
        const FLOOR_FALL_LAND_Z = -2.0;

        // Begin a fall animation. Any finite targetLayer means land there;
        // null means there is no floor below and the fall is lethal.
        function startWizardFall(wizardRef, targetLayer) {
            if (!wizardRef || (wizardRef._floorFallState && wizardRef._floorFallState.active)) return;
            const fromLayer = Number.isFinite(wizardRef.currentLayer) ? Math.round(wizardRef.currentLayer) : 0;
            const fromBaseZ = Number.isFinite(wizardRef.currentLayerBaseZ)
                ? Number(wizardRef.currentLayerBaseZ)
                : getLayerBaseZ(fromLayer);
            const targetBaseZ = Number.isFinite(targetLayer) ? getLayerBaseZ(targetLayer) : null;
            wizardRef._floorFallState = {
                active: true,
                velocityZ: 0,
                targetLayer,
                fromLayer,
                fromBaseZ,
                landZ: Number.isFinite(targetBaseZ)
                    ? Math.min(FLOOR_FALL_LAND_Z, targetBaseZ - fromBaseZ)
                    : FLOOR_FALL_LAND_Z
            };
            // Clear any movement path so the wizard doesn't teleport mid-fall.
            wizardRef.path = [];
            wizardRef.nextNode = null;
            wizardRef.isJumping = false;
            wizardRef.jumpHeight = 0;
            wizardRef.z = 0;
        }

        // Advance fall physics. Must be called every sim frame while a fall is active.
        function updateWizardFall(wizardRef, dtSec) {
            if (!wizardRef || !wizardRef._floorFallState || !wizardRef._floorFallState.active) return;
            const state = wizardRef._floorFallState;
            const dt = Math.max(0, Number(dtSec) || 0);
            state.velocityZ += FLOOR_FALL_GRAVITY * dt;
            wizardRef.z = (Number.isFinite(wizardRef.z) ? wizardRef.z : 0) + state.velocityZ * dt;

            const landZ = Number.isFinite(state.landZ) ? Number(state.landZ) : FLOOR_FALL_LAND_Z;
            if (wizardRef.z > landZ) return; // still falling

            // ── Landing ──────────────────────────────────────────────────────────
            wizardRef._floorFallState = null;
            wizardRef.z = 0;

            if (Number.isFinite(state.targetLayer)) {
                const toLayer = Math.round(Number(state.targetLayer));
                const toBaseZ = getLayerBaseZ(toLayer);
                const previousLayer = Number.isFinite(wizardRef.currentLayer) ? Number(wizardRef.currentLayer) : null;
                const previousBaseZ = Number.isFinite(wizardRef.currentLayerBaseZ) ? Number(wizardRef.currentLayerBaseZ) : null;
                wizardRef.selectedFloorEditLevel = toLayer;
                console.log("[wizard.layer.set]", {
                    source: "updateWizardFall",
                    reason: "fall-landing",
                    previousLayer,
                    nextLayer: toLayer,
                    previousBaseZ,
                    nextBaseZ: toBaseZ,
                    targetLayer: Number(state.targetLayer)
                });
                // Sync floor edit level directly, without calling presentGameFrame,
                // since we are mid-sim-step and the viewport hasn't been updated yet.
                if (typeof globalThis !== "undefined") globalThis.selectedFloorEditLevel = toLayer;
                wizardRef._pendingLayerTransition = {
                    active: true,
                    fromLevel: Number.isFinite(state.fromLayer) ? Math.round(state.fromLayer) : 0,
                    toLevel: toLayer,
                    fromBaseZ: Number.isFinite(state.fromBaseZ) ? Number(state.fromBaseZ) : getLayerBaseZ(state.fromLayer),
                    toBaseZ,
                    startedAtMs: Number.isFinite(renderNowMs) ? Number(renderNowMs) : Date.now(),
                    durationMs: 320
                };
                if (typeof message === "function") {
                    message("You land on the floor below.");
                }
            } else {
                // Fell off the world. Only lethal in adventure mode.
                const isAdventure = (typeof wizardRef.isAdventureMode === "function") && wizardRef.isAdventureMode();
                if (isAdventure && Number.isFinite(wizardRef.hp) && wizardRef.hp > 0) {
                    wizardRef.hp = 0;
                    if (typeof wizardRef.updateStatusBars === "function") wizardRef.updateStatusBars();
                    if (typeof message === "function") {
                        message("You fell to your death!");
                    }
                }
            }
        }

        // Called every frame after movement. Detects whether the wizard stepped into
        // a hole and starts the fall animation if not already falling.
        function checkWizardFloorFall(wizardRef, mapRef) {
            if (!wizardRef || wizardRef.dead) return;
            // Already in a fall — nothing to do here; updateWizardFall handles it.
            if (wizardRef._floorFallState && wizardRef._floorFallState.active) return;
            // The layer editor and its sub-tools suppress auto-fall so the
            // wizard can freely inspect and edit different layers.
            const spellName = typeof wizardRef.currentSpell === "string"
                ? wizardRef.currentSpell
                : "";
            if (
                spellName === "flooredit" ||
                spellName === "floorshape" ||
                spellName === "floorhole" ||
                spellName === "floorstair"
            ) {
                return;
            }
            // Don't trigger while the wizard is mid-jump (airborne intentionally).
            if (wizardRef.isJumping) return;
            if (!(mapRef && mapRef.floorsById instanceof Map && mapRef.floorsById.size > 0)) return;

            const wx = wizardRef.x;
            const wy = wizardRef.y;
            const layer = Number.isFinite(wizardRef.currentLayer) ? Math.round(wizardRef.currentLayer) : 0;

            if (isPositionSupportedAtLayer(wx, wy, layer, mapRef)) return;

            // Underground layers should behave as enclosed spaces: outside the level
            // polygons is blocked, not a lethal bottomless fall.
            if (layer < 0) {
                const prevX = Number.isFinite(wizardRef.prevX) ? Number(wizardRef.prevX) : wx;
                const prevY = Number.isFinite(wizardRef.prevY) ? Number(wizardRef.prevY) : wy;
                if (isPositionSupportedAtLayer(prevX, prevY, layer, mapRef)) {
                    wizardRef.x = prevX;
                    wizardRef.y = prevY;
                }
                wizardRef.path = [];
                wizardRef.nextNode = null;
                wizardRef.z = 0;
                return;
            }

            // Walk downward through layers to find where the wizard will land.
            // null = no floor below → death.
            let targetLayer = null;
            const lowestLayer = getLowestRegisteredFloorLayer(mapRef);
            let checkLayer = layer;
            while (checkLayer > lowestLayer) {
                checkLayer -= 1;
                if (isPositionSupportedAtLayer(wx, wy, checkLayer, mapRef)) {
                    targetLayer = checkLayer;
                    break;
                }
            }

            startWizardFall(wizardRef, targetLayer);
        }

        function advanceNonWizardSimulationStep() {
            if (!wizard) return;
            if (typeof updatePowerupsForWizard === "function") {
                updatePowerupsForWizard(wizard, 1 / frameRate);
            }
            advanceAnimalsSimulation();
            for (const obj of activeSimObjects) {
                if (!obj || obj.gone) {
                    activeSimObjects.delete(obj);
                    continue;
                }
                if (typeof obj.update === "function") {
                    obj.update();
                }
                if (
                    !obj.isOnFire &&
                    !obj.isGrowing &&
                    !obj.falling &&
                    obj.fireFadeStart === undefined &&
                    !(Array.isArray(obj._flowerBurnFragments) && obj._flowerBurnFragments.length > 0)
                ) {
                    activeSimObjects.delete(obj);
                }
            }
            frameCount++;
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
                    lockMovementVector: true,
                    allowUnsupportedPosition: true
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
            const triggerAreaCameraDetachActive = isTriggerAreaCameraDetachActive();
            setTriggerAreaCameraDetachFlag(triggerAreaCameraDetachActive);
            if (!triggerAreaCameraDetachActive && triggerAreaCameraDetachWasActive) {
                centerViewport(wizard, 0);
            }
            triggerAreaCameraDetachWasActive = triggerAreaCameraDetachActive;
            if (triggerAreaCameraDetachActive) {
                updateTriggerAreaEdgePan(1 / frameRate);
            } else {
                updateDetachedCameraArrowPan(1 / frameRate);
            }

            const movementStartMs = performance.now();
            const wizardStartX = wizard.x;
            const wizardStartY = wizard.y;
            const wizardLayer = Number.isFinite(wizard.currentLayer) ? Math.round(wizard.currentLayer) : 0;
            const wizardLayerBaseZ = Number.isFinite(wizard.currentLayerBaseZ)
                ? Number(wizard.currentLayerBaseZ)
                : getLayerBaseZ(wizardLayer);
            wizard.prevJumpHeight = Number.isFinite(wizard.jumpHeight) ? wizard.jumpHeight : 0;
            const isFalling = !!(wizard._floorFallState && wizard._floorFallState.active);
            if (!isFalling) {
                wizard.moveDirection(moveVector, moveOptions);
                wizard.updateJump(1 / frameRate);
                checkWizardFloorFall(wizard, map);
            } else {
                // Keep applying horizontal momentum during the fall — don't steer or brake,
                // just carry whatever velocity the wizard had when they stepped off the edge.
                wizard.moveDirection(wizard.movementVector, {
                    lockMovementVector: true,
                    allowUnsupportedPosition: true
                });
            }
            updateWizardFall(wizard, 1 / frameRate);
            if (typeof wizard.regenerateHealth === "function") {
                wizard.regenerateHealth(1 / frameRate);
            }
            // Re-read layer state after updateWizardFall so the landing frame
            // gets the correct cameraFollowZ (-3 for level -1) instead of the
            // pre-landing value that was captured before the fall settled.
            const isNowFalling = !!(wizard._floorFallState && wizard._floorFallState.active);
            const postFallLayerBaseZ = Number.isFinite(wizard.currentLayerBaseZ)
                ? Number(wizard.currentLayerBaseZ)
                : wizardLayerBaseZ;
            const cameraFollowZ = isNowFalling
                ? (postFallLayerBaseZ + (Number.isFinite(wizard.z) ? Number(wizard.z) : 0))
                : postFallLayerBaseZ;
            viewport.prevZ = Number.isFinite(viewport.z) ? Number(viewport.z) : 0;
            viewport.z = cameraFollowZ;
            if (map && typeof map.updatePrototypeSectionBubble === "function") {
                map.updatePrototypeSectionBubble(wizard);
            }
            movementMs = performance.now() - movementStartMs;
            const collisionStartMs = performance.now();
            if (typeof SpellSystem !== "undefined" && typeof SpellSystem.updateCharacterObjectCollisions === "function") {
                SpellSystem.updateCharacterObjectCollisions(wizard);
            }
            const currentSimulationTimeScale = (
                typeof globalThis !== "undefined" &&
                typeof globalThis.getSimulationTimeScale === "function"
            ) ? globalThis.getSimulationTimeScale() : simulationTimeScale;
            nonWizardSimStepAccumulator += Math.max(0, Number(currentSimulationTimeScale) || 0);
            const maxNonWizardStepsPerWizardStep = 6;
            let nonWizardSteps = 0;
            while (nonWizardSimStepAccumulator >= 1 && nonWizardSteps < maxNonWizardStepsPerWizardStep) {
                advanceNonWizardSimulationStep();
                nonWizardSimStepAccumulator -= 1;
                nonWizardSteps++;
            }
            if (nonWizardSteps === maxNonWizardStepsPerWizardStep && nonWizardSimStepAccumulator >= 1) {
                nonWizardSimStepAccumulator = Math.min(nonWizardSimStepAccumulator, 1);
            }
            if (wizard && typeof wizard.updateAdventureDeathState === "function") {
                wizard.updateAdventureDeathState();
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

            // Keep render present uncapped; rely on browser vsync cadence only.
            nextPresentAtMs = nowMs;

            const presentedDeltaMs = lastPresentedMs > 0
                ? (nowMs - lastPresentedMs)
                : 0;
            lastPresentedMs = nowMs;
            perfStats.loopMs = presentedDeltaMs;
            perfStats.fps = presentedDeltaMs > 0 ? 1000 / presentedDeltaMs : 0;
            const drawStart = performance.now();
            renderNowMs = nowMs;
            updateSmoothViewportZoom(frameDeltaMs);
            updateScriptedCameraZoom(nowMs);
            updateScriptedCameraPan(nowMs);
            if (pointerLockActive) {
                if (!isVirtualCursorOverMenuArea()) {
                    // Reproject lock-mode aim every render frame using the interpolated camera
                    // to keep cursor motion smooth while the viewport drifts.
                    syncMouseScreenFromWorldWithViewport();
                    clampVirtualCursorToCanvas(1);
                }
            }
            updateAnimalPreview();
            updateTreeGrowPreview();
            presentGameFrame(animalVisibilitySnapshot.active);
            perfStats.drawMs = performance.now() - drawStart;
            perfStats.idleMs = Math.max(0, perfStats.loopMs - perfStats.simMs - perfStats.drawMs);
            const perfInstrumentationActive = typeof isPerfInstrumentationEnabled === "function"
                ? isPerfInstrumentationEnabled()
                : false;
            if (perfInstrumentationActive && typeof recordPerfAccumulatorSample === "function") {
                const drawBreakdownForAccum = (typeof globalThis !== "undefined" && globalThis.drawPerfBreakdown)
                    ? globalThis.drawPerfBreakdown
                    : null;
                const simBreakdownForAccum = (typeof globalThis !== "undefined" && globalThis.simPerfBreakdown)
                    ? globalThis.simPerfBreakdown
                    : null;
                const extraDrawMetricsForAccum = drawBreakdownForAccum ? {
                    visibleNodes: Number(drawBreakdownForAccum.visibleNodes || 0),
                    visibleNodesWrapped: Number(drawBreakdownForAccum.visibleNodesWrapped || 0),
                    visibleNodesFallback: Number(drawBreakdownForAccum.visibleNodesFallback || 0),
                    visibleNodeFilterSkipped: Number(drawBreakdownForAccum.visibleNodeFilterSkipped || 0),
                    visibleNodeFallbackUsed: Number(drawBreakdownForAccum.visibleNodeFallbackUsed || 0),
                    visibleObjectNodeRefs: Number(drawBreakdownForAccum.visibleObjectNodeRefs || 0),
                    visibleObjectVisibilityRefs: Number(drawBreakdownForAccum.visibleObjectVisibilityRefs || 0),
                    visibleObjectDuplicateRefsSkipped: Number(drawBreakdownForAccum.visibleObjectDuplicateRefsSkipped || 0),
                    visibleAnimalsAdded: Number(drawBreakdownForAccum.visibleAnimalsAdded || 0),
                    visibleAnimalsSkippedOffscreen: Number(drawBreakdownForAccum.visibleAnimalsSkippedOffscreen || 0),
                    onscreenCacheObjects: Number(drawBreakdownForAccum.onscreenCacheObjects || 0),
                    onscreenCacheRoofs: Number(drawBreakdownForAccum.onscreenCacheRoofs || 0),
                    losCandidates: Number(drawBreakdownForAccum.losCandidates || 0),
                    losBuildMs: Number(drawBreakdownForAccum.losBuildMs || 0),
                    losTraceMs: Number(drawBreakdownForAccum.losTraceMs || 0),
                    losTotalMs: Number(drawBreakdownForAccum.losTotalMs || 0),
                    losRecomputed: Number(drawBreakdownForAccum.losRecomputed || 0),
                    losVisibleObjects: Number(drawBreakdownForAccum.losVisibleObjects || 0),
                    wallLosMs: Number(drawBreakdownForAccum.wallLosMs || 0),
                    wallLosResetSections: Number(drawBreakdownForAccum.wallLosResetSections || 0),
                    wallLosIlluminatedBins: Number(drawBreakdownForAccum.wallLosIlluminatedBins || 0),
                    wallLosRangedSections: Number(drawBreakdownForAccum.wallLosRangedSections || 0),
                    wallLosEndpointLookups: Number(drawBreakdownForAccum.wallLosEndpointLookups || 0),
                    wallLosEndpointOwnersResolved: Number(drawBreakdownForAccum.wallLosEndpointOwnersResolved || 0),
                    mazeModeMaskWorldPoints: Number(drawBreakdownForAccum.mazeModeMaskWorldPoints || 0),
                    mazeModeMaskActive: Number(drawBreakdownForAccum.mazeModeMaskActive || 0),
                    roadsVisible: Number(drawBreakdownForAccum.roadsVisible || 0),
                    roadsCached: Number(drawBreakdownForAccum.roadsCached || 0),
                    roadsCreated: Number(drawBreakdownForAccum.roadsCreated || 0),
                    roadsAttached: Number(drawBreakdownForAccum.roadsAttached || 0),
                    roadsTextureRefreshes: Number(drawBreakdownForAccum.roadsTextureRefreshes || 0),
                    roadsTextureAssignments: Number(drawBreakdownForAccum.roadsTextureAssignments || 0),
                    roadsHidden: Number(drawBreakdownForAccum.roadsHidden || 0),
                    roadsDestroyed: Number(drawBreakdownForAccum.roadsDestroyed || 0),
                    roadsEvicted: Number(drawBreakdownForAccum.roadsEvicted || 0),
                    roadsMs: Number(drawBreakdownForAccum.roadsMs || 0),
                    depthCandidates: Number(drawBreakdownForAccum.depthCandidates || 0),
                    depthMissingMountedSection: Number(drawBreakdownForAccum.depthMissingMountedSection || 0),
                    depthHiddenByScript: Number(drawBreakdownForAccum.depthHiddenByScript || 0),
                    depthDoorBottomOutlineOnly: Number(drawBreakdownForAccum.depthDoorBottomOutlineOnly || 0),
                    groundObjectSpritesRendered: Number(drawBreakdownForAccum.groundObjectSpritesRendered || 0),
                    objects3dLosBuildMs: Number(drawBreakdownForAccum.objects3dLosBuildMs || 0),
                    objects3dLosVisibleSetSize: Number(drawBreakdownForAccum.objects3dLosVisibleSetSize || 0),
                    objects3dLosVisibleWalls: Number(drawBreakdownForAccum.objects3dLosVisibleWalls || 0),
                    objects3dFilterMs: Number(drawBreakdownForAccum.objects3dFilterMs || 0),
                    objects3dTransformMs: Number(drawBreakdownForAccum.objects3dTransformMs || 0),
                    objects3dDepthMs: Number(drawBreakdownForAccum.objects3dDepthMs || 0),
                    objects3dGroundMs: Number(drawBreakdownForAccum.objects3dGroundMs || 0),
                    objects3dDisplayMs: Number(drawBreakdownForAccum.objects3dDisplayMs || 0),
                    objects3dAnimalLosHidden: Number(drawBreakdownForAccum.objects3dAnimalLosHidden || 0),
                    objects3dMazeHidden: Number(drawBreakdownForAccum.objects3dMazeHidden || 0),
                    objects3dMazeHiddenWalls: Number(drawBreakdownForAccum.objects3dMazeHiddenWalls || 0),
                    objects3dMapItems: Number(drawBreakdownForAccum.objects3dMapItems || 0),
                    objects3dRoofItems: Number(drawBreakdownForAccum.objects3dRoofItems || 0),
                    objects3dRenderItems: Number(drawBreakdownForAccum.objects3dRenderItems || 0),
                    objects3dDepthRendered: Number(drawBreakdownForAccum.objects3dDepthRendered || 0),
                    objects3dGroundRendered: Number(drawBreakdownForAccum.objects3dGroundRendered || 0),
                    objects3dDisplayObjects: Number(drawBreakdownForAccum.objects3dDisplayObjects || 0),
                    objects3dVisibleAnimals: Number(drawBreakdownForAccum.objects3dVisibleAnimals || 0),
                    objects3dVisibleTrees: Number(drawBreakdownForAccum.objects3dVisibleTrees || 0)
                } : null;
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
                    drawComposeUnaccountedMs: drawBreakdownForAccum ? Number(drawBreakdownForAccum.composeUnaccountedMs || 0) : 0,
                    ...(extraDrawMetricsForAccum || {})
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
                const drawWorldBuckets = drawBreakdown
                    ? (
                        `\ndraww g ${Number(drawBreakdown.passWorldGroundMs || 0).toFixed(2)}` +
                        ` r ${Number(drawBreakdown.passWorldRoadsMs || 0).toFixed(2)}` +
                        ` h ${Number(drawBreakdown.passWorldHexMs || 0).toFixed(2)}` +
                        ` s ${Number(drawBreakdown.passWorldSeamsMs || 0).toFixed(2)}` +
                        ` c ${Number(drawBreakdown.passWorldClearanceMs || 0).toFixed(2)}` +
                        ` n ${Number(drawBreakdown.passWorldTileNumbersMs || 0).toFixed(2)}` +
                        ` b ${Number(drawBreakdown.passWorldBorderMs || 0).toFixed(2)}`
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
                const drawVisibility = drawBreakdown
                    ? (
                        `\nvis n ${Number(drawBreakdown.visibleNodes || 0)}` +
                        ` w ${Number(drawBreakdown.visibleNodesWrapped || 0)}` +
                        ` f ${Number(drawBreakdown.visibleNodesFallback || 0)}` +
                        ` rf ${Number(drawBreakdown.visibleNodeFilterSkipped || 0)}` +
                        ` dup ${Number(drawBreakdown.visibleObjectDuplicateRefsSkipped || 0)}`
                    )
                    : "";
                const drawRefs = drawBreakdown
                    ? (
                        `\nrefs o ${Number(drawBreakdown.visibleObjectNodeRefs || 0)}` +
                        ` v ${Number(drawBreakdown.visibleObjectVisibilityRefs || 0)}` +
                        ` an ${Number(drawBreakdown.visibleAnimalsAdded || 0)}` +
                        ` ao ${Number(drawBreakdown.visibleAnimalsSkippedOffscreen || 0)}` +
                        ` rc ${Number(drawBreakdown.onscreenCacheRoofs || 0)}`
                    )
                    : "";
                const drawLosBuckets = drawBreakdown
                    ? (
                        `\nlosb c ${Number(drawBreakdown.losCandidates || 0)}` +
                        ` v ${Number(drawBreakdown.losVisibleObjects || 0)}` +
                        ` b ${Number(drawBreakdown.losBuildMs || 0).toFixed(2)}` +
                        ` t ${Number(drawBreakdown.losTraceMs || 0).toFixed(2)}` +
                        ` wl ${Number(drawBreakdown.wallLosMs || 0).toFixed(2)}` +
                        ` r ${Number(drawBreakdown.losRecomputed || 0)}`
                    )
                    : "";
                const drawWallLos = drawBreakdown
                    ? (
                        `\nlosw rs ${Number(drawBreakdown.wallLosResetSections || 0)}` +
                        ` ib ${Number(drawBreakdown.wallLosIlluminatedBins || 0)}` +
                        ` rg ${Number(drawBreakdown.wallLosRangedSections || 0)}` +
                        ` el ${Number(drawBreakdown.wallLosEndpointLookups || 0)}` +
                        ` eo ${Number(drawBreakdown.wallLosEndpointOwnersResolved || 0)}`
                    )
                    : "";
                const drawMazeBuckets = drawBreakdown
                    ? (
                        `\nmaze m ${Number(drawBreakdown.mazeModeMaskActive || 0)}` +
                        ` pts ${Number(drawBreakdown.mazeModeMaskWorldPoints || 0)}` +
                        ` vw ${Number(drawBreakdown.objects3dLosVisibleWalls || 0)}` +
                        ` vs ${Number(drawBreakdown.objects3dLosVisibleSetSize || 0)}`
                    )
                    : "";
                const drawRoadBuckets = drawBreakdown
                    ? (
                        `\nroad v ${Number(drawBreakdown.roadsVisible || 0)}` +
                        ` c ${Number(drawBreakdown.roadsCached || 0)}` +
                        ` n ${Number(drawBreakdown.roadsCreated || 0)}` +
                        ` a ${Number(drawBreakdown.roadsAttached || 0)}` +
                        ` ms ${Number(drawBreakdown.roadsMs || 0).toFixed(2)}`
                    )
                    : "";
                const drawRoadTexture = drawBreakdown
                    ? (
                        `\nroadt r ${Number(drawBreakdown.roadsTextureRefreshes || 0)}` +
                        ` ta ${Number(drawBreakdown.roadsTextureAssignments || 0)}` +
                        ` h ${Number(drawBreakdown.roadsHidden || 0)}` +
                        ` d ${Number(drawBreakdown.roadsDestroyed || 0)}` +
                        ` e ${Number(drawBreakdown.roadsEvicted || 0)}`
                    )
                    : "";
                const drawObjectBuckets = drawBreakdown
                    ? (
                        `\nobj3 i ${Number(drawBreakdown.objects3dRenderItems || 0)}` +
                        ` rf ${Number(drawBreakdown.objects3dRoofItems || 0)}` +
                        ` db ${Number(drawBreakdown.objects3dDepthRendered || 0)}` +
                        ` go ${Number(drawBreakdown.objects3dGroundRendered || 0)}` +
                        ` ds ${Number(drawBreakdown.objects3dDisplayObjects || 0)}`
                    )
                    : "";
                const drawObjectTimings = drawBreakdown
                    ? (
                        `\nobjt ls ${Number(drawBreakdown.objects3dLosBuildMs || 0).toFixed(2)}` +
                        ` fl ${Number(drawBreakdown.objects3dFilterMs || 0).toFixed(2)}` +
                        ` tf ${Number(drawBreakdown.objects3dTransformMs || 0).toFixed(2)}` +
                        ` db ${Number(drawBreakdown.objects3dDepthMs || 0).toFixed(2)}` +
                        ` go ${Number(drawBreakdown.objects3dGroundMs || 0).toFixed(2)}` +
                        ` di ${Number(drawBreakdown.objects3dDisplayMs || 0).toFixed(2)}`
                    )
                    : "";
                const drawObjectHidden = drawBreakdown
                    ? (
                        `\nobjh an ${Number(drawBreakdown.objects3dAnimalLosHidden || 0)}` +
                        ` mz ${Number(drawBreakdown.objects3dMazeHidden || 0)}` +
                        ` mw ${Number(drawBreakdown.objects3dMazeHiddenWalls || 0)}` +
                        ` mm ${Number(drawBreakdown.depthMissingMountedSection || 0)}` +
                        ` dh ${Number(drawBreakdown.depthHiddenByScript || 0)}`
                    )
                    : "";
                const renderingLiveStats = (typeof globalThis !== "undefined" && globalThis.renderingLiveStats)
                    ? globalThis.renderingLiveStats
                    : null;
                const drawCacheCounts = drawBreakdown
                    ? (
                        `\ncache g ${Number(drawBreakdown.groundCached || 0)}` +
                        ` gv ${Number(drawBreakdown.groundVisible || 0)}` +
                        ` gp ${Number(drawBreakdown.groundPool || 0)}` +
                        ` r ${Number(drawBreakdown.roadCached || 0)}` +
                        ` d ${Number(drawBreakdown.depthMeshes || 0)}` +
                        ` o ${Number(drawBreakdown.objectDisplays || 0)}`
                    )
                    : (renderingLiveStats
                        ? (
                            `\ncache g ${Number(renderingLiveStats.groundCached || 0)}` +
                            ` gv ${Number(renderingLiveStats.groundVisible || 0)}` +
                            ` gp ${Number(renderingLiveStats.groundPool || 0)}` +
                            ` r ${Number(renderingLiveStats.roadCached || 0)}` +
                            ` d ${Number(renderingLiveStats.depthMeshes || 0)}` +
                            ` o ${Number(renderingLiveStats.objectDisplays || 0)}`
                        )
                        : "");
                const drawLayerCounts = drawBreakdown
                    ? (
                        `\nlayer g ${Number(drawBreakdown.groundLayerChildren || 0)}` +
                        ` r ${Number(drawBreakdown.roadsLayerChildren || 0)}` +
                        ` o ${Number(drawBreakdown.objectsLayerChildren || 0)}`
                    )
                    : (renderingLiveStats
                        ? (
                            `\nlayer g ${Number(renderingLiveStats.groundLayerChildren || 0)}` +
                            ` r ${Number(renderingLiveStats.roadsLayerChildren || 0)}` +
                            ` o ${Number(renderingLiveStats.objectsLayerChildren || 0)}`
                        )
                        : "");
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
                const perfReadoutText = (
                    `FPS ${perfStats.fps.toFixed(1)}\n` +
                    `cpu ${cpuMs.toFixed(1)} ms\n` +
                    `simms ${perfStats.simMs.toFixed(1)} ms\n` +
                    `draw ${perfStats.drawMs.toFixed(1)} ms\n` +
                    `idle ${perfStats.idleMs.toFixed(1)} ms\n` +
                    `sim ${perfStats.simSteps}\n` +
                    drawBuckets +
                    drawPasses +
                    drawWorldBuckets +
                    drawComposeBuckets +
                    drawCounts +
                    drawVisibility +
                    drawRefs +
                    drawLosBuckets +
                    drawWallLos +
                    drawMazeBuckets +
                    drawRoadBuckets +
                    drawRoadTexture +
                    drawObjectBuckets +
                    drawObjectTimings +
                    drawObjectHidden +
                    drawCacheCounts +
                    drawLayerCounts +
                    losSummary +
                    wwDebug
                );
                const perfReadoutSummaryText = [
                    `FPS ${perfStats.fps.toFixed(1)}`,
                    `cpu ${cpuMs.toFixed(1)} ms`,
                    `draw ${perfStats.drawMs.toFixed(1)} ms`,
                    `idle ${perfStats.idleMs.toFixed(1)} ms`
                ].join("\n");
                const showPerfDetails = !!(
                    (typeof showPerfReadoutDetails !== "undefined" && showPerfReadoutDetails) ||
                    (typeof globalThis !== "undefined" && globalThis.showPerfReadoutDetails)
                );
                const perfReadoutVisibleText = showPerfDetails
                    ? perfReadoutText
                    : perfReadoutSummaryText;
                perfPanel.text(perfReadoutVisibleText);
                perfStats.lastUiUpdateAt = panelNow;
            }
            requestAnimationFrame(renderFrame);
            observePrototypeStartupPerfFrame();
        }

        requestAnimationFrame(renderFrame);
        if (typeof resolveMapReady === "function") {
            resolveMapReady();
            resolveMapReady = null;
        }
    });

    void (async () => {
    await mapReadyPromise;

    const startupSpawn = (typeof globalThis !== "undefined" && globalThis.RUNAROUND_PROTOTYPE_SPAWN && typeof globalThis.RUNAROUND_PROTOTYPE_SPAWN === "object")
        ? globalThis.RUNAROUND_PROTOTYPE_SPAWN
        : null;
    const prototypeWizardState = (typeof globalThis !== "undefined" && globalThis.RUNAROUND_PROTOTYPE_WIZARD_STATE && typeof globalThis.RUNAROUND_PROTOTYPE_WIZARD_STATE === "object")
        ? globalThis.RUNAROUND_PROTOTYPE_WIZARD_STATE
        : null;
    const initialWizardX = prototypeWizardState && Number.isFinite(prototypeWizardState.x)
        ? Number(prototypeWizardState.x)
        : (startupSpawn && Number.isFinite(startupSpawn.x) ? Number(startupSpawn.x) : (mapWidth / 2));
    const initialWizardY = prototypeWizardState && Number.isFinite(prototypeWizardState.y)
        ? Number(prototypeWizardState.y)
        : (startupSpawn && Number.isFinite(startupSpawn.y) ? Number(startupSpawn.y) : (mapHeight / 2));
    wizard = new Wizard({
        x: initialWizardX,
        y: initialWizardY
    }, map);
    if (typeof globalThis !== "undefined") {
        globalThis.wizard = wizard;
    }
    if (prototypeWizardState && typeof wizard.loadJson === "function") {
        wizard.loadJson(prototypeWizardState);
    }
    if (map && typeof map.updatePrototypeSectionBubble === "function") {
        map.updatePrototypeSectionBubble(wizard, { force: true });
    }
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
    wizard.updateStatusBars();
    
    // Initialize status bar updates
    setInterval(() => {
        if (wizard) wizard.updateStatusBars();
    }, 100);
    SpellSystem.initWizardSpells(wizard);
    if (prototypeWizardState && typeof wizard.loadJson === "function") {
        wizard.loadJson(prototypeWizardState);
        if (map && typeof map.updatePrototypeSectionBubble === "function") {
            map.updatePrototypeSectionBubble(wizard, { force: true });
        }
        centerViewport(wizard, 0, 0);
        wizard.updateStatusBars();
    }
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
            setLastSaveReloadDirective({ source: "local" });
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
            setLastSaveReloadDirective({ source: "server" });
            message("Loaded /assets/saves/savefile.json");
            console.log("Auto-loaded game from server savefile.json at startup");
            return true;
        }
        const reason = (result && result.reason) ? String(result.reason) : "unknown";
        console.warn(`Startup server auto-load failed for /assets/saves/savefile.json (${reason})`, result);
        return false;
    }

    async function tryAutoLoadPrototypeSaveOnStartup() {
        if (typeof startupConfig.prototypeSectionAssetUrl === "string" && startupConfig.prototypeSectionAssetUrl.length > 0) {
            return false;
        }
        const localSlot = (typeof startupConfig.prototypeAutoLoadLocalSlot === "string")
            ? startupConfig.prototypeAutoLoadLocalSlot.trim()
            : "";
        const serverSlot = (typeof startupConfig.prototypeAutoLoadServerSlot === "string")
            ? startupConfig.prototypeAutoLoadServerSlot.trim()
            : "";

        if (localSlot.length > 0 && typeof loadGameStateFromLocalStorageKey === "function") {
            const localResult = loadGameStateFromLocalStorageKey(localSlot);
            if (localResult && localResult.ok) {
                setLastSaveReloadDirective({ source: "local", key: localSlot });
                message(`Loaded prototype local save '${localSlot}'`);
                console.log(`Auto-loaded prototype local save '${localSlot}' at startup`);
                return true;
            }
            if (localResult && localResult.reason && localResult.reason !== "missing") {
                console.warn(`Prototype local auto-load failed for '${localSlot}'`, localResult);
            }
        }

        if (serverSlot.length > 0 && typeof loadGameStateFromServerFile === "function") {
            const serverResult = await loadGameStateFromServerFile({ slot: serverSlot });
            if (serverResult && serverResult.ok) {
                setLastSaveReloadDirective({ source: "server", slot: serverSlot });
                message(`Loaded prototype server save '${serverSlot}'`);
                console.log(`Auto-loaded prototype server save '${serverSlot}' at startup`);
                return true;
            }
            if (serverResult && serverResult.reason && serverResult.reason !== "missing") {
                console.warn(`Prototype server auto-load failed for '${serverSlot}'`, serverResult);
            }
        }

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

        if (source === "prototype-indexeddb") {
            const key = (typeof directive.key === "string") ? directive.key.trim() : "";
            if (!key.length || typeof loadGameStateFromIndexedDbKey !== "function") {
                message("Prototype IndexedDB load is unavailable");
                return true;
            }
            beginPrototypeStartupPerf("autoload-prototype-save", { key });
            const result = await loadGameStateFromIndexedDbKey(key);
            if (result && result.ok) {
                setLastSaveReloadDirective({ source: "prototype-indexeddb", key });
                message(`Loaded prototype save '${key}'`);
                console.log(`Startup loaded prototype IndexedDB save '${key}'`);
            } else {
                finishPrototypeStartupPerf("startup-perf-failed", {
                    key,
                    reason: result && result.reason ? String(result.reason) : "load-failed"
                });
                const reason = (result && result.reason) ? String(result.reason) : "unknown";
                message(`Failed to load prototype save '${key}' (${reason})`);
                console.error(`Startup prototype IndexedDB load failed for '${key}':`, result);
            }
            return true;
        }

        if (source === "server") {
            if (typeof loadGameStateFromServerFile !== "function") {
                message("Server file load is unavailable");
                return true;
            }
            const fileName = (typeof directive.fileName === "string") ? directive.fileName.trim() : "";
            const slot = (typeof directive.slot === "string") ? directive.slot.trim() : "";
            const loadOptions = {};
            if (fileName.length > 0) loadOptions.fileName = fileName;
            if (slot.length > 0) loadOptions.slot = slot;
            const result = await loadGameStateFromServerFile(loadOptions);
            const loadedPath = fileName.length > 0
                ? `/assets/saves/backups/${fileName}`
                : (slot.length > 0 ? `/assets/saves/${slot}.json` : "/assets/saves/savefile.json");
            if (result && result.ok) {
                setLastSaveReloadDirective(fileName.length > 0
                    ? { source: "server", fileName }
                    : (slot.length > 0 ? { source: "server", slot } : { source: "server" }));
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

    void (async () => {
        const handledDirective = await tryLoadFromStartupDirective();
        const handledPrototypeAutoLoad = !handledDirective
            ? await tryAutoLoadPrototypeSaveOnStartup()
            : false;
        if (!handledDirective && !handledPrototypeAutoLoad && startupConfig.skipStartupDialogs !== true) {
            await ensurePrototypeStartupWorldBackground();
            await runOpeningGameDialogFlow();
        }
        if (startupConfig.skipStartupDialogs === true && !handledDirective && !handledPrototypeAutoLoad) {
            message("Loaded two-section prototype world");
        }
        ensureStartupClearanceReady();
        if (typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
            globalThis.presentGameFrame();
        }
    })();
    })();

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
        if (!wizard || $("#spellSelector").hasClass("hidden")) return;
        const wasHidden = $("#spellMenu").hasClass('hidden');
        if (wasHidden) {
            closeHudMenus({ spell: false, aura: true, editor: true });
        }
        if (
            wasHidden &&
            (wizard.currentSpell === "flooredit" || wizard.currentSpell === "floorshape" || wizard.currentSpell === "floorhole" || wizard.currentSpell === "floorstair") &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.showFloorEditingMenu === "function"
        ) {
            SpellSystem.showFloorEditingMenu(wizard);
            $("#spellMenu").removeClass("hidden");
            initSpellMenuKeyboardFocus();
            return;
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

    $("#selectedInventory").click(() => {
        closeHudMenus({ spell: true, aura: true, editor: true });
        if (typeof showInventoryDialog === "function") {
            showInventoryDialog(wizard || null);
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
            (wizard.currentSpell === "placeobject" || wizard.currentSpell === "blackdiamond") &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.showEditorSubmenuForSelectedCategory === "function"
        ) {
            event.preventDefault();
            closeHudMenus({ spell: false, aura: true, editor: true });
            SpellSystem.showEditorSubmenuForSelectedCategory(wizard);
            return;
        }
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
            (wizard.currentSpell === "flooredit" || wizard.currentSpell === "floorshape" || wizard.currentSpell === "floorhole" || wizard.currentSpell === "floorstair") &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.showFloorEditingMenu === "function"
        ) {
            event.preventDefault();
            closeHudMenus({ spell: false, aura: true, editor: true });
            SpellSystem.showFloorEditingMenu(wizard);
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
        if (
            wizard &&
            wizard.currentSpell === "triggerarea" &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.showTriggerAreaMenu === "function"
        ) {
            event.preventDefault();
            closeHudMenus({ spell: false, aura: true, editor: true });
            SpellSystem.showTriggerAreaMenu(wizard);
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
        if (
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.updateTriggerAreaVertexDrag === "function"
        ) {
            SpellSystem.updateTriggerAreaVertexDrag(wizard, mousePos.worldX, mousePos.worldY);
        }
        if (
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.updateFloorEditorVertexDrag === "function"
        ) {
            SpellSystem.updateFloorEditorVertexDrag(wizard, mousePos.worldX, mousePos.worldY);
        }
    })

    app.view.addEventListener("wheel", event => {
        const overMenu = pointerLockActive
            ? isVirtualCursorOverMenuArea()
            : !!(event.target && typeof event.target.closest === "function" && event.target.closest("#spellMenu, #selectedSpell, #spellSelector, #inventorySelector, #selectedInventory, #auraMenu, #selectedAura, #auraSelector, #activeAuraIcons, #editorMenu, #selectedEditor, #editorSelector, #statusBars"));
        if (overMenu) return;

        const zoomModifierHeld = !!keysPressed["z"];

        let deltaPixels = Number(event.deltaY) || 0;
        if (!Number.isFinite(deltaPixels) || deltaPixels === 0) return;
        if (event.deltaMode === 1) {
            // Convert line-based wheel deltas to pixel-ish units.
            deltaPixels *= 16;
        } else if (event.deltaMode === 2) {
            // Convert page-based deltas.
            deltaPixels *= Math.max(200, window.innerHeight || 800);
        }

        const canAdjustSpellScale = !!(
            wizard &&
            typeof SpellSystem !== "undefined" &&
            (
                (wizard.currentSpell === "placeobject" && typeof SpellSystem.adjustPlaceableScale === "function") ||
                (wizard.currentSpell === "blackdiamond" && typeof SpellSystem.adjustPowerupPlacementScale === "function") ||
                (wizard.currentSpell === "spawnanimal" && typeof SpellSystem.adjustAnimalSizeScale === "function") ||
                (wizard.currentSpell === "treegrow" && typeof SpellSystem.adjustTreeGrowSize === "function")
            )
        );

        if (!zoomModifierHeld) {
            if (!canAdjustSpellScale) return;
            event.preventDefault();
            const unclampedDelta = -deltaPixels * 0.0015;
            const delta = Math.max(-0.05, Math.min(0.05, unclampedDelta));
            if (Math.abs(delta) < 0.0005) return;

            if (wizard.currentSpell === "placeobject") {
                SpellSystem.adjustPlaceableScale(wizard, delta);
            } else if (wizard.currentSpell === "blackdiamond") {
                SpellSystem.adjustPowerupPlacementScale(wizard, delta);
            } else if (wizard.currentSpell === "spawnanimal") {
                SpellSystem.adjustAnimalSizeScale(wizard, delta);
            } else if (wizard.currentSpell === "treegrow") {
                SpellSystem.adjustTreeGrowSize(wizard, delta);
            }
            return;
        }

        event.preventDefault();

        zoomViewportByWheelDelta(deltaPixels, {
            anchorScreenX: Number.isFinite(mousePos.screenX) ? mousePos.screenX : ((Number(app.screen.width) || window.innerWidth || 0) * 0.5),
            anchorScreenY: Number.isFinite(mousePos.screenY) ? mousePos.screenY : ((Number(app.screen.height) || window.innerHeight || 0) * 0.5)
        });
    }, { passive: false });

    app.view.addEventListener("mousedown", event => {
        if (pointerLockActive) {
            const hovered = getVirtualCursorHoveredElement();
            const virtualPt = getVirtualCursorClientPoint();
            const selectedSpellEl = hovered && typeof hovered.closest === "function"
                ? hovered.closest("#selectedSpell")
                : null;
            const selectedInventoryEl = hovered && typeof hovered.closest === "function"
                ? hovered.closest("#selectedInventory")
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
            const forwardTarget = menuInteractiveEl || selectedSpellEl || selectedInventoryEl || selectedAuraEl || selectedEditorEl;
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
            event.button === 0 &&
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.beginTriggerAreaVertexDrag === "function"
        ) {
            const rect = app.view.getBoundingClientRect();
            const screenX = Number.isFinite(mousePos.screenX) ? mousePos.screenX : (event.clientX - rect.left);
            const screenY = Number.isFinite(mousePos.screenY) ? mousePos.screenY : (event.clientY - rect.top);
            const worldCoors = (Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY))
                ? { x: mousePos.worldX, y: mousePos.worldY }
                : screenToWorld(screenX, screenY);
            if (
                event.shiftKey &&
                typeof SpellSystem.insertTriggerAreaVertexOnEdge === "function" &&
                SpellSystem.insertTriggerAreaVertexOnEdge(wizard, screenX, screenY, worldCoors.x, worldCoors.y)
            ) {
                event.preventDefault();
                suppressNextTriggerAreaToolClick = true;
                return;
            }
            if (
                event.shiftKey &&
                typeof SpellSystem.insertFloorEditorVertexOnEdge === "function" &&
                SpellSystem.insertFloorEditorVertexOnEdge(wizard, screenX, screenY)
            ) {
                event.preventDefault();
                suppressNextTriggerAreaToolClick = true;
                return;
            }
            if (SpellSystem.beginTriggerAreaVertexDrag(wizard, screenX, screenY)) {
                event.preventDefault();
                suppressNextTriggerAreaToolClick = true;
                return;
            }
            if (
                typeof SpellSystem.beginFloorEditorVertexDrag === "function" &&
                SpellSystem.beginFloorEditorVertexDrag(wizard, screenX, screenY)
            ) {
                event.preventDefault();
                suppressNextTriggerAreaToolClick = true;
                return;
            }
        }
        if (
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.beginDragSpell === "function" &&
            (
                wizard.currentSpell === "wall" ||
                wizard.currentSpell === "buildroad" ||
                wizard.currentSpell === "firewall" ||
                wizard.currentSpell === "moveobject" ||
                wizard.currentSpell === "vanish" ||
                wizard.currentSpell === "editorvanish"
            )
        ) {
            event.preventDefault();
            const rect = app.view.getBoundingClientRect();
            const dragScreenX = Number.isFinite(mousePos.screenX) ? mousePos.screenX : (event.clientX - rect.left);
            const dragScreenY = Number.isFinite(mousePos.screenY) ? mousePos.screenY : (event.clientY - rect.top);
            if (
                wizard.currentSpell === "buildroad" &&
                typeof SpellSystem.getVisibleFloorPolygonTargetAtScreenPoint === "function" &&
                SpellSystem.getVisibleFloorPolygonTargetAtScreenPoint(wizard, dragScreenX, dragScreenY)
            ) {
                suppressNextTriggerAreaToolClick = true;
                return;
            }
            const worldCoors = (Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY))
                ? {x: mousePos.worldX, y: mousePos.worldY}
                : screenToWorld(dragScreenX, dragScreenY);
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
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.endTriggerAreaVertexDrag === "function" &&
            SpellSystem.endTriggerAreaVertexDrag(wizard)
        ) {
            event.preventDefault();
            suppressNextTriggerAreaToolClick = true;
            return;
        }
        if (
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.endFloorEditorVertexDrag === "function" &&
            SpellSystem.endFloorEditorVertexDrag(wizard)
        ) {
            event.preventDefault();
            suppressNextTriggerAreaToolClick = true;
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
        if (suppressNextTriggerAreaToolClick) {
            suppressNextTriggerAreaToolClick = false;
            event.preventDefault();
            return;
        }
        const castWithSpace = !!keysPressed[" "];
        const castWithEditorKey = isEditorPlacementSpellActive() && isEditorPlacementKeyHeld();
        if (!castWithSpace && !castWithEditorKey) return;

        event.preventDefault();
        let castScreenX = null;
        let castScreenY = null;
        const worldCoors = (pointerLockActive && Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY))
            ? {x: mousePos.worldX, y: mousePos.worldY}
            : (() => {
                const rect = app.view.getBoundingClientRect();
                castScreenX = event.clientX - rect.left;
                castScreenY = event.clientY - rect.top;
                return screenToWorld(castScreenX, castScreenY);
            })();
        const aim = getWizardAimVectorTo(worldCoors.x, worldCoors.y);
        // Stop wizard movement by setting destination to current node
        wizard.destination = null;
        wizard.path = [];
        wizard.travelFrames = 0;
        const isTriggerAreaCast = (wizard.currentSpell === "triggerarea");
        const castWorldX = isTriggerAreaCast ? worldCoors.x : aim.worldX;
        const castWorldY = isTriggerAreaCast ? worldCoors.y : aim.worldY;
        // Turn and cast at exact click coordinates.
        if (!isTriggerAreaCast) {
            wizard.turnToward(aim.x, aim.y);
        }
        if (
            wizard.currentSpell === "wall" ||
            wizard.currentSpell === "buildroad" ||
            wizard.currentSpell === "firewall" ||
            wizard.currentSpell === "vanish" ||
            wizard.currentSpell === "editorvanish"
        ) return;
        if (
            typeof SpellSystem.isAuraSpellName === "function" &&
            SpellSystem.isAuraSpellName(wizard.currentSpell)
        ) {
            spacebarDownAt = null;
            return;
        }
        SpellSystem.castWizardSpell(wizard, castWorldX, castWorldY, {
            clickCount: Number.isFinite(event.detail) ? Number(event.detail) : 1,
            screenX: castScreenX,
            screenY: castScreenY
        });
        // Prevent keyup quick-cast from firing a duplicate cast.
        spacebarDownAt = null;
    })

    app.view.addEventListener("dblclick", event => {
        if (
            !wizard ||
            typeof SpellSystem === "undefined" ||
            typeof SpellSystem.paintFloorPolygonAtWorldPoint !== "function"
        ) return;
        let paintScreenX = null;
        let paintScreenY = null;
        const worldCoors = (pointerLockActive && Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY))
            ? {x: mousePos.worldX, y: mousePos.worldY}
            : (() => {
                const rect = app.view.getBoundingClientRect();
                paintScreenX = event.clientX - rect.left;
                paintScreenY = event.clientY - rect.top;
                return screenToWorld(paintScreenX, paintScreenY);
            })();
        if (SpellSystem.paintFloorPolygonAtWorldPoint(wizard, worldCoors.x, worldCoors.y, {
            screenX: paintScreenX,
            screenY: paintScreenY
        })) {
            event.preventDefault();
            event.stopPropagation();
        }
    });
     
    $("#msg").contextmenu(event => event.preventDefault())
    let jumpKeyPressHistory = [];
    $(document).keydown(event => {
        const keyLower = event.key.toLowerCase();
        const spellMenuVisible = !$("#spellMenu").hasClass("hidden");
        const auraMenuVisible = !$("#auraMenu").hasClass("hidden");
        const auraSelectorVisible = !$("#auraSelector").hasClass("hidden");
        const editorMenuVisible = !$("#editorMenu").hasClass("hidden");
        const isTextEntryTarget = !!(
            typeof globalThis !== "undefined" &&
            typeof globalThis.isTextEntryElement === "function" &&
            globalThis.isTextEntryElement(event.target)
        );

        if (isTextEntryTarget) {
            return;
        }

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

        if (event.ctrlKey && keyLower === "p") {
            event.preventDefault();
            if (typeof paused !== "undefined" && paused) {
                if (typeof unpause === "function") {
                    unpause();
                } else {
                    paused = false;
                }
            } else if (typeof pause === "function") {
                pause();
            } else {
                paused = true;
            }
            return;
        }

        if (event.key === "Tab") {
            event.preventDefault();
            const inEditorMode = (typeof SpellSystem !== "undefined" && typeof SpellSystem.isEditorMode === "function" && SpellSystem.isEditorMode());
            if (editorMenuVisible) {
                $("#editorMenu").addClass("hidden");
                clearEditorMenuKeyboardFocus();
                return;
            }
            if (inEditorMode) {
                // In editor mode, Tab opens spell menu (which includes editor options)
                if (
                    wizard &&
                    !$("#spellSelector").hasClass("hidden") &&
                    typeof SpellSystem !== "undefined" &&
                    typeof SpellSystem.showMainSpellMenu === "function"
                ) {
                    SpellSystem.showMainSpellMenu(wizard);
                    $("#spellMenu").removeClass("hidden");
                    initSpellMenuKeyboardFocus();
                }
                return;
            }
            if (event.shiftKey && auraSelectorVisible) {
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
            } else if (auraMenuVisible && auraSelectorVisible) {
                $("#auraMenu").addClass("hidden");
                clearAuraMenuKeyboardFocus();
                if (
                    wizard &&
                    !$("#spellSelector").hasClass("hidden") &&
                    typeof SpellSystem !== "undefined" &&
                    typeof SpellSystem.showMainSpellMenu === "function"
                ) {
                    SpellSystem.showMainSpellMenu(wizard);
                    $("#spellMenu").removeClass("hidden");
                    initSpellMenuKeyboardFocus();
                }
            } else if (spellMenuVisible) {
                $("#spellMenu").addClass("hidden");
                $("#auraMenu").addClass("hidden");
                $("#editorMenu").addClass("hidden");
                clearSpellMenuKeyboardFocus();
                clearAuraMenuKeyboardFocus();
            } else if (
                wizard &&
                !$("#spellSelector").hasClass("hidden") &&
                typeof SpellSystem !== "undefined" &&
                typeof SpellSystem.showMainSpellMenu === "function"
            ) {
                SpellSystem.showMainSpellMenu(wizard);
                $("#spellMenu").removeClass("hidden");
                initSpellMenuKeyboardFocus();
            }
            return;
        }

        if (
            event.key === "Escape" &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.closeTriggerAreaHelpPanel === "function"
        ) {
            const panel = document.getElementById("triggerAreaHelpPanel");
            if (panel && panel.style.display !== "none") {
                event.preventDefault();
                SpellSystem.closeTriggerAreaHelpPanel();
                return;
            }
        }

        if (
            event.key === "Escape" &&
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.cancelTriggerAreaPlacement === "function" &&
            SpellSystem.cancelTriggerAreaPlacement(wizard)
        ) {
            event.preventDefault();
            return;
        }

        if (
            event.key === "Escape" &&
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.cancelFloorShapePlacement === "function" &&
            SpellSystem.cancelFloorShapePlacement(wizard)
        ) {
            event.preventDefault();
            return;
        }

        if (
            event.key === "Escape" &&
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.cancelFloorHolePlacement === "function" &&
            SpellSystem.cancelFloorHolePlacement(wizard)
        ) {
            event.preventDefault();
            return;
        }

        if (event.key === "Escape" && (spellMenuVisible || auraMenuVisible || editorMenuVisible)) {
            event.preventDefault();
            $("#spellMenu").addClass("hidden");
            $("#auraMenu").addClass("hidden");
            $("#editorMenu").addClass("hidden");
            clearSpellMenuKeyboardFocus();
            clearAuraMenuKeyboardFocus();
            clearEditorMenuKeyboardFocus();
            return;
        }

        if (
            (event.key === "Delete" || event.key === "Backspace") &&
            !(typeof globalThis !== "undefined" && typeof globalThis.isTextEntryElement === "function" && globalThis.isTextEntryElement(event.target)) &&
            wizard &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.getTriggerAreaVertexSelection === "function" &&
            SpellSystem.getTriggerAreaVertexSelection(wizard)
        ) {
            event.preventDefault();
            if (typeof SpellSystem.deleteSelectedTriggerAreaVertex === "function") {
                SpellSystem.deleteSelectedTriggerAreaVertex(wizard);
            }
            return;
        }

        if (
            (event.key === "Delete" || event.key === "Backspace") &&
            !(typeof globalThis !== "undefined" && typeof globalThis.isTextEntryElement === "function" && globalThis.isTextEntryElement(event.target)) &&
            wizard &&
            typeof SpellSystem !== "undefined" &&
            (
                wizard.currentSpell === "flooredit" ||
                (typeof SpellSystem.isFloorEditorToolName === "function" && SpellSystem.isFloorEditorToolName(wizard.currentSpell))
            ) &&
            typeof SpellSystem.getFloorEditorVertexSelection === "function" &&
            SpellSystem.getFloorEditorVertexSelection(wizard)
        ) {
            event.preventDefault();
            if (typeof SpellSystem.deleteSelectedFloorEditorVertex === "function") {
                SpellSystem.deleteSelectedFloorEditorVertex(wizard);
            }
            return;
        }

        if (editorMenuVisible && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            if (event.key === "ArrowLeft") moveEditorMenuKeyboardFocus(-1, 0);
            if (event.key === "ArrowRight") moveEditorMenuKeyboardFocus(1, 0);
            if (event.key === "ArrowUp") moveEditorMenuKeyboardFocus(0, -1);
            if (event.key === "ArrowDown") moveEditorMenuKeyboardFocus(0, 1);
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

        if (
            (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") &&
            canPanDetachedCameraWithArrowKeys()
        ) {
            event.preventDefault();
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

        if (editorMenuVisible && (event.key === "Enter" || event.key === " " || event.code === "Space")) {
            event.preventDefault();
            spacebarDownAt = null;
            const activation = activateSelectedEditorToolFromMenu();
            if (activation.activated && activation.shouldCloseMenu) {
                $("#editorMenu").addClass("hidden");
                clearEditorMenuKeyboardFocus();
            } else if (activation.activated) {
                initEditorMenuKeyboardFocus();
            }
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

        if (
            keyLower === " " &&
            !treeGrowVariantChosenThisHold &&
            wizard &&
            wizard.currentSpell === "treegrow" &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.resolveTreePlacementTextureVariant === "function"
        ) {
            treeGrowVariantChosenThisHold = true;
            SpellSystem.resolveTreePlacementTextureVariant(wizard, { forceNew: true });
            if (typeof SpellSystem.resolveTreePlacementSize === "function") {
                SpellSystem.resolveTreePlacementSize(wizard, { forceNew: true });
            }
        }

        if (
            keyLower === "z" &&
            !event.repeat &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey &&
            !cameraResetTapAwaitingRelease &&
            !isTextEntryTarget
        ) {
            const nowMs = Date.now();
            if ((nowMs - lastCameraResetTapAtMs) <= CAMERA_RESET_DOUBLE_TAP_MS) {
                if (typeof globalThis !== "undefined" && typeof globalThis.scriptCameraReset === "function") {
                    event.preventDefault();
                    globalThis.scriptCameraReset(CAMERA_RESET_DOUBLE_TAP_SECONDS);
                }
                lastCameraResetTapAtMs = 0;
            } else {
                lastCameraResetTapAtMs = nowMs;
            }
            cameraResetTapAwaitingRelease = true;
        }

        if (!event.repeat && tryActivateWizardGameModeByChord(keyLower, event)) {
            return;
        }
        if (
            wizard &&
            event.shiftKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.repeat &&
            event.code === "KeyV"
        ) {
            const inEditorMode = (typeof SpellSystem !== "undefined" && typeof SpellSystem.isEditorMode === "function" && SpellSystem.isEditorMode());
            if (inEditorMode && typeof SpellSystem !== "undefined" && typeof SpellSystem.setCurrentSpell === "function") {
                event.preventDefault();
                SpellSystem.setCurrentSpell(wizard, "editorvanish");
                updateEditorPlacementActiveState(isEditorPlacementKeyHeld());
                return;
            }
        }
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
        // Only trigger when W is the newly pressed key (f already held), so that
        // pressing F while walking (w held) still selects fireball, not firewall.
        if (
            wizard &&
            keysPressed['f'] &&
            keysPressed['w'] &&
            keyLower === 'w' &&
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
            !canPanDetachedCameraWithArrowKeys() &&
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
                const inEditorMode = (typeof SpellSystem !== "undefined" && typeof SpellSystem.isEditorMode === "function" && SpellSystem.isEditorMode());
                if (inEditorMode) {
                    // In editor mode, space acts like holding E — activates placement of the current tool without switching it
                    updateEditorPlacementActiveState(true);
                } else if (
                    wizard &&
                    typeof SpellSystem !== "undefined" &&
                    typeof SpellSystem.isEditorSpellName === "function" &&
                    typeof SpellSystem.activateSelectedSpellTool === "function" &&
                    SpellSystem.isEditorSpellName(wizard.currentSpell)
                ) {
                    SpellSystem.activateSelectedSpellTool(wizard);
                    updateEditorPlacementActiveState(isEditorPlacementKeyHeld());
                }
                if (
                    wizard &&
                    typeof SpellSystem !== "undefined" &&
                    typeof SpellSystem.isAuraSpellName === "function" &&
                    typeof SpellSystem.toggleAura === "function" &&
                    SpellSystem.isAuraSpellName(wizard.currentSpell)
                ) {
                    SpellSystem.toggleAura(wizard, wizard.currentSpell);
                    spacebarDownAt = null;
                    return;
                }
                spacebarDownAt = Date.now();
                // SpawnAnimal: space alone just activates preview mode; click to cast
                if (wizard && wizard.currentSpell === "spawnanimal") {
                    // no-op: preview shown in render loop, cast on click
                }
            }
        } else if ((event.key === "a" || event.key === "A") && !event.repeat) {
            const now = Date.now();
            jumpKeyPressHistory.push(now);
            // Keep only presses within the last 0.5 seconds
            while (jumpKeyPressHistory.length > 0 && now - jumpKeyPressHistory[0] > 500) {
                jumpKeyPressHistory.shift();
            }
            if (
                jumpKeyPressHistory.length >= 3 &&
                wizard &&
                wizard.jumpCount === 2 &&
                wizard.isJumping &&
                typeof wizard.startTripleJump === "function"
            ) {
                jumpKeyPressHistory = [];
                wizard.startTripleJump();
            } else if (wizard && typeof wizard.startJump === "function") {
                wizard.startJump();
            }
        } else if ((event.key === "o" || event.key === "O") && !event.repeat) {
            event.preventDefault();
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.toggleAura === "function") {
                if (typeof wizard.isAdventureMode === "function" && wizard.isAdventureMode() && typeof SpellSystem.setCurrentSpell === "function") {
                    SpellSystem.setCurrentSpell(wizard, "omnivision");
                }
                SpellSystem.toggleAura(wizard, "omnivision");
            }
            return;
        } else if ((event.key === "p" || event.key === "P") && !event.repeat) {
            event.preventDefault();
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.toggleAura === "function") {
                if (typeof wizard.isAdventureMode === "function" && wizard.isAdventureMode() && typeof SpellSystem.setCurrentSpell === "function") {
                    SpellSystem.setCurrentSpell(wizard, "speed");
                }
                SpellSystem.toggleAura(wizard, "speed");
            }
            return;
        } else if ((event.key === "h" || event.key === "H") && !event.repeat) {
            event.preventDefault();
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.toggleAura === "function") {
                if (typeof wizard.isAdventureMode === "function" && wizard.isAdventureMode() && typeof SpellSystem.setCurrentSpell === "function") {
                    SpellSystem.setCurrentSpell(wizard, "healing");
                }
                SpellSystem.toggleAura(wizard, "healing");
            }
            return;
        } else if ((event.key === "u" || event.key === "U") && !event.repeat) {
            event.preventDefault();
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.toggleAura === "function") {
                if (typeof wizard.isAdventureMode === "function" && wizard.isAdventureMode() && typeof SpellSystem.setCurrentSpell === "function") {
                    SpellSystem.setCurrentSpell(wizard, "invisibility");
                }
                SpellSystem.toggleAura(wizard, "invisibility");
            }
            return;
        } else if (
            wizard &&
            (event.key === "d" || event.key === "D") &&
            !event.ctrlKey && !event.shiftKey && !event.repeat
        ) {
            const inEditorMode = (typeof SpellSystem !== "undefined" && typeof SpellSystem.isEditorMode === "function" && SpellSystem.isEditorMode());
            if (inEditorMode && typeof SpellSystem.selectEditorCategory === "function") {
                event.preventDefault();
                SpellSystem.selectEditorCategory(wizard, "doors");
                updateEditorPlacementActiveState(isEditorPlacementKeyHeld());
                return;
            }
        } else if (
            wizard &&
            (event.key === "W" || event.code === "KeyW") &&
            event.shiftKey && !event.ctrlKey && !event.repeat
        ) {
            const inEditorMode = (typeof SpellSystem !== "undefined" && typeof SpellSystem.isEditorMode === "function" && SpellSystem.isEditorMode());
            if (inEditorMode && typeof SpellSystem.selectEditorCategory === "function") {
                event.preventDefault();
                SpellSystem.selectEditorCategory(wizard, "windows");
                updateEditorPlacementActiveState(isEditorPlacementKeyHeld());
                return;
            }
        }

        if (
            wizard &&
            !event.ctrlKey && !event.altKey && !event.metaKey && !event.repeat &&
            typeof wizard.isGodMode === "function" && wizard.isGodMode() &&
            wizard.currentSpell === "flooredit" &&
            typeof SpellSystem !== "undefined" &&
            typeof SpellSystem.setSelectedFloorEditLevel === "function"
        ) {
            const digit = event.code.startsWith("Digit") ? parseInt(event.code.slice(5), 10)
                : event.code.startsWith("Numpad") && !isNaN(parseInt(event.code.slice(6), 10)) ? parseInt(event.code.slice(6), 10)
                : NaN;
            if (Number.isFinite(digit)) {
                event.preventDefault();
                const level = event.shiftKey ? -digit : digit;
                SpellSystem.setSelectedFloorEditLevel(wizard, level, { moveWizard: true });
                return;
            }
        }

        const hasNonShiftHotkeyModifier = !!(event.ctrlKey || event.altKey || event.metaKey);

        if (
            !hasNonShiftHotkeyModifier &&
            Object.keys(spellKeyBindings).includes(event.key.toUpperCase())
        ) {
            const inEditorMode = (typeof SpellSystem !== "undefined" && typeof SpellSystem.isEditorMode === "function" && SpellSystem.isEditorMode());
            const spellHotkey = event.key.toUpperCase();
            const shouldUseEditorVanish = (
                spellHotkey === "V" &&
                wizard &&
                typeof SpellSystem !== "undefined" &&
                typeof SpellSystem.setCurrentSpell === "function" &&
                (
                    (typeof wizard.isGodMode === "function" && wizard.isGodMode()) ||
                    inEditorMode
                )
            );
            const shouldUseLayerTool = (
                spellHotkey === "L" &&
                wizard &&
                typeof SpellSystem !== "undefined" &&
                typeof SpellSystem.setCurrentSpell === "function" &&
                typeof wizard.isGodMode === "function" && wizard.isGodMode()
            );
            if (inEditorMode && typeof editorKeyBindings !== "undefined" && Object.keys(editorKeyBindings).includes(event.key.toUpperCase())) {
                // In editor mode, prefer editor key bindings for shared keys
                SpellSystem.setCurrentSpell(wizard, editorKeyBindings[event.key.toUpperCase()]);
            } else if (shouldUseLayerTool) {
                SpellSystem.setCurrentSpell(wizard, "flooredit");
            } else if (shouldUseEditorVanish) {
                SpellSystem.setCurrentSpell(wizard, "editorvanish");
            } else {
                // Spell hotkeys always work (allows switching from editor to combat spell)
                SpellSystem.setCurrentSpell(wizard, spellKeyBindings[event.key.toUpperCase()]);
            }
            updateEditorPlacementActiveState(isEditorPlacementKeyHeld());
        } else if (
            !hasNonShiftHotkeyModifier &&
            typeof editorKeyBindings !== "undefined" &&
            Object.keys(editorKeyBindings).includes(event.key.toUpperCase())
        ) {
            const inEditorMode = (typeof SpellSystem !== "undefined" && typeof SpellSystem.isEditorMode === "function" && SpellSystem.isEditorMode());
            if (inEditorMode) {
                SpellSystem.setCurrentSpell(wizard, editorKeyBindings[event.key.toUpperCase()]);
                updateEditorPlacementActiveState(isEditorPlacementKeyHeld());
            }
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

        // Toggle hex grid only with Ctrl+G
        if ((event.key === 'g' || event.key === 'G') && event.ctrlKey) {
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
            const isPrototypeSectionMode = !!(map && map._prototypeSectionState);
            if (isPrototypeSectionMode) {
                if (typeof savePrototypeSectionWorldToServerSlot === "function") {
                    savePrototypeSectionWorldToServerSlot("maps").then(result => {
                        if (result && result.ok) {
                            message(`Saved ${result.count} section file(s) to maps/`);
                            console.log('Prototype section-world save to maps complete:', result);
                        } else {
                            message('Prototype section save failed');
                            console.error('Prototype section save to maps failed:', result);
                        }
                    }).catch(err => {
                        message('Prototype section save failed');
                        console.error('Prototype section save to maps failed:', err);
                    });
                } else {
                    message('Prototype section save is unavailable');
                }
                return;
            }
            if (typeof saveGameStateToServerFile === 'function') {
                saveGameStateToServerFile().then(result => {
                    if (result && result.ok) {
                        setLastSaveReloadDirective({ source: "server" });
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
            const isPrototypeSectionMode = !!(map && map._prototypeSectionState);
            if (isPrototypeSectionMode && isPrototypeIndexedDbRoute()) {
                const prototypeKey = (typeof getActivePrototypeSaveSlotKey === "function")
                    ? getActivePrototypeSaveSlotKey()
                    : "";
                if (!prototypeKey || !prototypeKey.length) {
                    message("Start a new game or load a save first");
                    return;
                }
                if (typeof saveGameStateToIndexedDb === "function") {
                    saveGameStateToIndexedDb(prototypeKey).then(result => {
                        if (result && result.ok) {
                            setLastSaveReloadDirective({ source: "prototype-indexeddb", key: prototypeKey });
                            message(`Saved prototype game to ${prototypeKey}`);
                            console.log('Prototype IndexedDB save complete:', result);
                        } else {
                            message('Prototype save failed');
                            console.error('Prototype IndexedDB save failed:', result);
                        }
                    }).catch(err => {
                        message('Prototype save failed');
                        console.error('Prototype IndexedDB save failed:', err);
                    });
                } else {
                    message('Prototype save is unavailable');
                }
                return;
            }
            if (isPrototypeSectionMode) {
                if (typeof savePrototypeSectionWorldToServerSlot === "function") {
                    savePrototypeSectionWorldToServerSlot("testing").then(result => {
                        if (result && result.ok) {
                            message(`Saved ${result.count} section file(s) to testing/`);
                            console.log('Prototype section-world save complete:', result);
                        } else {
                            message('Prototype section save failed');
                            console.error('Prototype section save failed:', result);
                        }
                    }).catch(err => {
                        message('Prototype section save failed');
                        console.error('Prototype section save failed:', err);
                    });
                } else {
                    message('Prototype section save is unavailable');
                }
                return;
            }
            if (typeof saveGameStateToLocalStorage === "function") {
                const result = saveGameStateToLocalStorage();
                if (result && result.ok) {
                    setLastSaveReloadDirective({ source: 'local' });
                    message(`Game saved to ${result.key}`);
                    console.log(`Game saved to localStorage key '${result.key}'`);
                } else {
                    message('Save failed');
                    console.error('Game save failed:', result);
                }
            }
        }

        // Load game with Ctrl+L
        if ((event.key === 'l' || event.key === 'L') && event.ctrlKey) {
            event.preventDefault();
            if (isPrototypeIndexedDbRoute()) {
                const prototypeKey = (typeof getActivePrototypeSaveSlotKey === "function")
                    ? getActivePrototypeSaveSlotKey()
                    : "";
                if (prototypeKey && reloadWithStartupLoadDirective({ source: "prototype-indexeddb", key: prototypeKey })) {
                    message(`Reloading and loading prototype save '${prototypeKey}'...`);
                } else {
                    message('No active prototype save selected');
                }
                return;
            }
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
        const keyLower = event.key.toLowerCase();
        keysPressed[keyLower] = false;
        if (keyLower === "z") {
            cameraResetTapAwaitingRelease = false;
        }
        if (
            (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") &&
            canPanDetachedCameraWithArrowKeys()
        ) {
            event.preventDefault();
        }
        if (event.key.toLowerCase() === "e") {
            updateEditorPlacementActiveState(false);
        }
        if (event.key === " " || event.code === "Space") {
            treeGrowVariantChosenThisHold = false;
            const inEditorMode = (typeof SpellSystem !== "undefined" && typeof SpellSystem.isEditorMode === "function" && SpellSystem.isEditorMode());
            if (inEditorMode) {
                updateEditorPlacementActiveState(false);
            }
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.clearTreePlacementPreviewVariant === "function") {
                SpellSystem.clearTreePlacementPreviewVariant(wizard);
            }
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.clearTreePlacementPreviewSize === "function") {
                SpellSystem.clearTreePlacementPreviewSize(wizard);
            }
            if (wizard && typeof SpellSystem !== "undefined" && typeof SpellSystem.cancelDragSpell === "function") {
                SpellSystem.cancelDragSpell(wizard, "wall");
                SpellSystem.cancelDragSpell(wizard, "buildroad");
                SpellSystem.cancelDragSpell(wizard, "firewall");
                SpellSystem.cancelDragSpell(wizard, "moveobject");
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
                wizard.currentSpell === "moveobject" ||
                wizard.currentSpell === "vanish" ||
                wizard.currentSpell === "editorvanish"
            ) return;
            event.preventDefault();
            spacebarDownAt = null;
        }
    })

})
