import { BuildingEditorState } from "./BuildingEditorState.js";
import { BuildingRenderer } from "./BuildingRenderer.js";
import { PaintTool } from "./tools/PaintTool.js";
import { GableTool } from "./tools/GableTool.js";
import { MountedObjectTool } from "./tools/MountedObjectTool.js";
import { PolygonEditTool } from "./tools/PolygonEditTool.js";
import { SelectTool } from "./tools/SelectTool.js";
import { WallTool } from "./tools/WallTool.js";
import { BeamTool } from "./tools/BeamTool.js";
import { ColumnTool } from "./tools/ColumnTool.js";
import { RoofTool } from "./tools/RoofTool.js";
import { StairTool } from "./tools/StairTool.js";
import { DEFAULTS, findFloor, getBuildingBeams, getBuildingColumns, getBuildingMountedObjects, getBuildingFloors, getBuildingWalls, getFloorElevation, getFloorId, getFloorRoof, getFloorStairs, wallCenterlinePoints } from "./BuildingModel.js";
import { pointInPolygon, polygonArea, polygonCentroid } from "./BuildingGeometry.js";
import { buildPlaytestStairFloorBlockers, playtestColumnBlockingSegmentsForFloor } from "./PlaytestRuntime.js";

const PAINT_TEXTURES = {
    floor: [DEFAULTS.floorTexture],
    roofs: [],
    walls: []
};

const stageHost = document.querySelector("#stageHost");
const statusText = document.querySelector("#statusText");
const jsonText = document.querySelector("#jsonText");
const layerPanel = document.querySelector("#layerPanel");
const texturePalette = document.querySelector("#texturePalette");
const mountTexturePalette = document.querySelector("#mountTexturePalette");
const windowContextMenu = document.querySelector("#windowContextMenu");
const layerContextMenu = document.querySelector("#layerContextMenu");
const floorElevation = document.querySelector("#floorElevation");
const polygonElevation = document.querySelector("#polygonElevation");
const polygonFinalize = document.querySelector("#polygonFinalize");
const floorHeight = document.querySelector("#floorHeight");
const roofMode = document.querySelector("#roofMode");
const roofOverhang = document.querySelector("#roofOverhang");
const roofPeakHeight = document.querySelector("#roofPeakHeight");
const roofDomeLevels = document.querySelector("#roofDomeLevels");
const roofDomeLevelsControl = roofDomeLevels ? roofDomeLevels.closest("label") : null;
const gableHeight = document.querySelector("#gableHeight");
const gableHeightValue = document.querySelector("#gableHeightValue");
const gableRoofReturn = document.querySelector("#gableRoofReturn");
const wallHeight = document.querySelector("#wallHeight");
const wallThickness = document.querySelector("#wallThickness");
const wallThicknessValue = document.querySelector("#wallThicknessValue");
const columnThickness = document.querySelector("#columnThickness");
const columnThicknessValue = document.querySelector("#columnThicknessValue");
const columnWidth = document.querySelector("#columnWidth");
const columnWidthValue = document.querySelector("#columnWidthValue");
const columnHeight = document.querySelector("#columnHeight");
const columnSideCount = document.querySelector("#columnSideCount");
const columnSnapPointsPerSection = document.querySelector("#columnSnapPointsPerSection");
const stairWidth = document.querySelector("#stairWidth");
const stairWidthValue = document.querySelector("#stairWidthValue");
const stairStepCount = document.querySelector("#stairStepCount");
const stairRiserDepth = document.querySelector("#stairRiserDepth");
const stairDirectionInputs = [...document.querySelectorAll("[name='stairDirection']")];
const wallInsetEndpoints = document.querySelector("#wallInsetEndpoints");
const wallProtrudeEndpoints = document.querySelector("#wallProtrudeEndpoints");
const mountSize = document.querySelector("#mountSize");
const mountSizeValue = document.querySelector("#mountSizeValue");
const mountAspect = document.querySelector("#mountAspect");
const mountAspectValue = document.querySelector("#mountAspectValue");
const mountSnapPointsPerSection = document.querySelector("#mountSnapPointsPerSection");
const mountTextureButton = document.querySelector("#mountTextureButton");
const snapToggle = document.querySelector("#snapToggle");
const snapDirectionToggle = document.querySelector("#snapDirectionToggle");
const anchorToggle = document.querySelector("#anchorToggle");
const selectedSummary = document.querySelector("#selectedSummary");
const paintToolButton = document.querySelector('[data-tool="paint"]');
const stairTextureButtons = [...document.querySelectorAll("[data-stair-texture-part]")];
const roofToolButton = document.querySelector(".roofToolButton");
const roofToolIcon = document.querySelector("#roofToolIcon");
const structureToolButton = document.querySelector("#structureToolButton");
const structureToolIcon = document.querySelector("#structureToolIcon");
const structureToolMenu = document.querySelector("#structureToolMenu");
const structureToolMenuButtons = [...document.querySelectorAll("[data-structure-tool]")];
const wallToolIcon = document.querySelector("#wallToolIcon");
const beamToolIcon = document.querySelector("#beamToolIcon");
const columnToolIcon = document.querySelector("#columnToolIcon");
const stairToolButton = document.querySelector(".stairToolButton");
const stairToolIcon = document.querySelector("#stairToolIcon");
const mountToolButtons = [...document.querySelectorAll("[data-mount-category]")];
const playtestToggle = document.querySelector("#playtestToggle");
const playtestFpsCounter = document.querySelector("#playtestFpsCounter");
const buildingOpenDialog = document.querySelector("#buildingOpenDialog");
const buildingOpenMessage = document.querySelector("#buildingOpenMessage");
const buildingSaveList = document.querySelector("#buildingSaveList");
const openNewBuildingButton = document.querySelector("#openNewBuilding");
const closeBuildingOpenDialogButton = document.querySelector("#closeBuildingOpenDialog");
const buildingNameDialog = document.querySelector("#buildingNameDialog");
const buildingNameForm = document.querySelector("#buildingNameForm");
const buildingNameInput = document.querySelector("#buildingNameInput");
const buildingNameMessage = document.querySelector("#buildingNameMessage");
const cancelBuildingNameButton = document.querySelector("#cancelBuildingName");

const webglContextAttributes = {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: true,
    preserveDrawingBuffer: false
};
const pixiView = document.createElement("canvas");
const pixiContext = pixiView.getContext("webgl", webglContextAttributes) ||
    pixiView.getContext("experimental-webgl", webglContextAttributes);
if (!pixiContext) {
    throw new Error("building editor renderer requires WebGL");
}
const contextAttributes = typeof pixiContext.getContextAttributes === "function"
    ? pixiContext.getContextAttributes()
    : null;
if (!contextAttributes || contextAttributes.depth !== true) {
    throw new Error("building editor renderer requires a WebGL depth buffer");
}

const app = new PIXI.Application({
    view: pixiView,
    context: pixiContext,
    width: stageHost.clientWidth,
    height: stageHost.clientHeight,
    backgroundColor: 0x101820,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true
});

stageHost.appendChild(app.view);
app.stage.interactive = true;

const state = new BuildingEditorState();
let currentBuildingName = "";
let buildingOpenDialogCanClose = false;
state.playtestWizard = null;
window.__buildingEditorDebugState = state;
window.repairBuildingEditorBrowserSave = (options = {}) => {
    try {
        const result = state.repairBrowserSave(options);
        renderer.render();
        syncUi();
        if (result.repairedRingCount > 0 || result.rebuiltPerimeterFloorCount > 0) {
            setStatus(`repaired ${result.repairedRingCount} floor ring(s), rebuilt ${result.rebuiltPerimeterFloorCount} perimeter wall set(s); original backed up as ${result.backupKey}`);
        } else {
            setStatus("browser-saved building is already valid");
        }
        return result;
    } catch (error) {
        console.error(error);
        setStatus(error.message, true);
        throw error;
    }
};
window.__buildingEditorDepthContext = {
    depth: contextAttributes.depth === true,
    stencil: contextAttributes.stencil === true,
    antialias: contextAttributes.antialias === true
};
const renderer = new BuildingRenderer(app, state);
const tools = {
    polygon: new PolygonEditTool(state, "add"),
    scissors: new PolygonEditTool(state, "subtract"),
    wall: new WallTool(state),
    mountObject: new MountedObjectTool(state),
    gable: new GableTool(state),
    paint: new PaintTool(state),
    select: new SelectTool(state),
    beam: new BeamTool(state),
    column: new ColumnTool(state),
    roof: new RoofTool(state),
    stair: new StairTool(state)
};

let panning = null;
let touchGesture = null;
let hasCenteredInitialFloor = false;
let rotatingView = false;
let rotatePointerX = null;
let lastZTapTime = 0;
let lastStagePointer = null;
let layerPanelSignature = "";
let layerContextFloorId = "";
let texturePaletteSignature = "";
let wallToolTexturePaletteOpen = false;
let columnToolTexturePaletteOpen = false;
let stairTexturePaletteOpen = false;
let stairTexturePalettePart = "tread";
let mountTexturePaletteSignature = "";
let mountTexturePaletteOpen = false;
let windowContext = null;
let layerDrag = null;
let activeStructureTool = "wall";
let structureToolPressTimer = null;
let structureToolLongPressOpened = false;
let playtestAnimationFrame = null;
let playtestLastTimeMs = 0;
let playtestMouseWorld = null;
let playtestRuntime = null;
let playtestPreviousFocus = null;
let playtestFpsAverage = 0;
let playtestFpsLastDisplayMs = 0;
let playtestForwardPressed = false;
let playtestFocusedFloorId = "";

const PLAYTEST_WIZARD_RADIUS = 0.3;
const PLAYTEST_WIZARD_SPEED = 4.5;
const PLAYTEST_WIZARD_ANIMATION_SPEED_MULTIPLIER = 2 / 3;
const PLAYTEST_WIZARD_DIRECTION_ROW_OFFSET = 0;
const PLAYTEST_FPS_DISPLAY_INTERVAL_MS = 250;
const PLAYTEST_COLLISION_EPSILON = 0.000001;
const PLAYTEST_LEVEL_FADE_SECONDS = 0.5;
const PLAYTEST_UPPER_FLOOR_TRANSITION_DISTANCE = 1;

const MOUNTED_OBJECT_ASSETS = {
    doors: [],
    windows: []
};
const MOUNT_ASPECT_LOG_BASE = 2;
const Z_DOUBLE_TAP_MS = 320;
const CAMERA_PITCH_WHEEL_SPEED = 0.004;
const COLUMN_ARROW_ROTATION_STEP_RADIANS = 15 * Math.PI / 180;
const COLUMN_ARROW_FINE_ROTATION_STEP_RADIANS = 3.75 * Math.PI / 180;

function resizeStage() {
    const width = Math.max(320, stageHost.clientWidth);
    const height = Math.max(240, stageHost.clientHeight);
    app.renderer.resize(width, height);
    app.stage.hitArea = new PIXI.Rectangle(0, 0, width, height);
    if (!hasCenteredInitialFloor) {
        state.centerCameraOnSelectedFloor();
        hasCenteredInitialFloor = true;
    }
    renderer.render();
    positionTexturePalette();
    positionMountTexturePalette();
    closeWindowContextMenu();
    closeLayerContextMenu();
    closeStructureToolMenu();
}

function setStatus(message, isError = false) {
    statusText.textContent = message;
    statusText.dataset.error = isError ? "true" : "false";
}

function withErrorBoundary(fn) {
    try {
        fn();
    } catch (error) {
        console.error(error);
        setStatus(error.message, true);
    }
}

async function withAsyncErrorBoundary(fn) {
    try {
        await fn();
    } catch (error) {
        console.error(error);
        setStatus(error.message, true);
    }
}

function requireEditorStairTraversal() {
    const traversal = globalThis.StairTraversal;
    if (!traversal || typeof traversal.createTreadPathFrame !== "function") {
        throw new Error("building editor playtest requires StairTraversal tread path support");
    }
    return traversal;
}

function floorContainsWorldPoint(floor, point) {
    if (!floor || !point || !Array.isArray(floor.outerPolygon) || floor.outerPolygon.length < 3) return false;
    if (!pointInPolygon(point, floor.outerPolygon)) return false;
    const holes = Array.isArray(floor.holes) ? floor.holes : [];
    return !holes.some((hole) => Array.isArray(hole) && hole.length >= 3 && pointInPolygon(point, hole));
}

function findPlaytestFloorAtElevation(elevation, point = null) {
    const targetZ = Number(elevation);
    if (!Number.isFinite(targetZ)) throw new Error("playtest floor lookup requires a finite elevation");
    const floors = getBuildingFloors(state.building)
        .filter((floor) => Math.abs(getFloorElevation(floor) - targetZ) <= 0.000001);
    if (point) {
        const containing = floors.find((floor) => floorContainsWorldPoint(floor, point));
        if (containing) return containing;
    }
    return floors[0] || null;
}

function playtestFloorSupportAt(point, preferredFloorId = "") {
    if (preferredFloorId) {
        const preferred = findFloor(state.building, preferredFloorId);
        if (preferred && floorContainsWorldPoint(preferred, point)) {
            return { floor: preferred, floorId: getFloorId(preferred), z: getFloorElevation(preferred) };
        }
    }
    const containing = getBuildingFloors(state.building)
        .filter((floor) => floorContainsWorldPoint(floor, point))
        .sort((a, b) => getFloorElevation(b) - getFloorElevation(a))[0] || null;
    return containing
        ? { floor: containing, floorId: getFloorId(containing), z: getFloorElevation(containing) }
        : null;
}

function buildPlaytestRuntime() {
    const traversal = requireEditorStairTraversal();
    const stairs = [];
    const floorBlockers = [];
    getBuildingFloors(state.building).forEach((floor) => {
        const floorId = getFloorId(floor);
        getFloorStairs(floor).forEach((stair) => {
            const stairId = `${floorId}:${stair.id}`;
            if (!Array.isArray(stair.treads) || stair.treads.length < 2) {
                throw new Error(`playtest stair ${stairId} requires saved tread geometry`);
            }
            const bottomZ = Number.isFinite(Number(stair.bottomZ)) ? Number(stair.bottomZ) : getFloorElevation(floor);
            const height = Number(stair.height);
            if (!Number.isFinite(height) || height <= 0) {
                throw new Error(`playtest stair ${stairId} requires a positive height`);
            }
            const direction = String(stair.direction || "up").toLowerCase();
            const topZ = direction === "down" ? bottomZ - height : bottomZ + height;
            const lowerZ = Math.min(bottomZ, topZ);
            const higherZ = Math.max(bottomZ, topZ);
            const startPoint = stair.startPoint || (Array.isArray(stair.treads) && stair.treads[0] ? stair.treads[0].center : null);
            const endPoint = stair.endPoint || (Array.isArray(stair.treads) && stair.treads.length > 0 ? stair.treads[stair.treads.length - 1].center : null);
            if (!startPoint || !endPoint) throw new Error(`playtest stair ${stairId} requires endpoint geometry`);
            const lowerPoint = direction === "down" ? endPoint : startPoint;
            const higherPoint = direction === "down" ? startPoint : endPoint;
            const orderedTreads = direction === "down" ? [...stair.treads].reverse() : [...stair.treads];
            const lowerFloor = findPlaytestFloorAtElevation(lowerZ, lowerPoint);
            const higherFloor = findPlaytestFloorAtElevation(higherZ, higherPoint);
            if (!lowerFloor) throw new Error(`playtest stair ${stairId} cannot resolve a lower floor at elevation ${lowerZ}`);
            if (!higherFloor) throw new Error(`playtest stair ${stairId} cannot resolve an upper floor at elevation ${higherZ}`);
            const runtimeStair = {
                id: stairId,
                sourceStair: stair,
                stairKind: "straight",
                lowerPoint,
                higherPoint,
                lowerZ,
                higherZ,
                lowerFloorId: getFloorId(lowerFloor),
                higherFloorId: getFloorId(higherFloor),
                width: Number(stair.width),
                stepCount: Number(stair.stepCount) || 1,
                treads: orderedTreads
            };
            runtimeStair.traversalFrame = traversal.createTreadPathFrame(runtimeStair);
            stairs.push(runtimeStair);
            floorBlockers.push(...buildPlaytestStairFloorBlockers({
                traversal,
                runtimeStair,
                height,
                stairId,
                upperOpeningPolygons: state.stairOpeningPolygonsForValidation(stair, higherFloor)
            }));
        });
    });
    return { stairs, floorBlockers };
}

function spawnPlaytestWizard() {
    const floor = state.selectedFloor() || getBuildingFloors(state.building)[0];
    if (!floor) throw new Error("playtest wizard requires at least one floor");
    const point = polygonCentroid(floor.outerPolygon);
    if (!floorContainsWorldPoint(floor, point)) {
        throw new Error(`playtest wizard cannot spawn outside floor ${getFloorId(floor)}`);
    }
    return {
        active: true,
        x: point.x,
        y: point.y,
        z: getFloorElevation(floor),
        radius: PLAYTEST_WIZARD_RADIUS,
        speed: PLAYTEST_WIZARD_SPEED,
        moving: false,
        movementVector: { x: 0, y: 0 },
        lastDirectionRow: 9,
        animationSpeedMultiplier: PLAYTEST_WIZARD_ANIMATION_SPEED_MULTIPLIER,
        isMovingBackward: false,
        isJumping: false,
        floorId: getFloorId(floor),
        onStair: false,
        stairSupport: null
    };
}

function setPlaytestWizardFacing(wizard, direction) {
    if (!wizard || !direction) return;
    const rawDx = Number(direction.x);
    const rawDy = Number(direction.y);
    if (!(Math.hypot(rawDx, rawDy) > 0.000001)) return;
    const cameraDirection = renderer && typeof renderer.rotateVectorForCamera === "function"
        ? renderer.rotateVectorForCamera({ x: rawDx, y: rawDy })
        : { x: rawDx, y: rawDy };
    const dx = Number(cameraDirection.x);
    const dy = Number(cameraDirection.y);
    if (!(Math.hypot(dx, dy) > 0.000001)) return;
    const facingDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    const directions = [
        { angle: 0, index: 6 },
        { angle: 30, index: 7 },
        { angle: 60, index: 8 },
        { angle: 90, index: 9 },
        { angle: 120, index: 10 },
        { angle: 150, index: 11 },
        { angle: 180, index: 0 },
        { angle: -150, index: 1 },
        { angle: -120, index: 2 },
        { angle: -90, index: 3 },
        { angle: -60, index: 4 },
        { angle: -30, index: 5 }
    ];
    let closest = directions[0];
    let minDiff = Infinity;
    directions.forEach((entry) => {
        let diff = Math.abs(facingDeg - entry.angle);
        if (diff > 180) diff = 360 - diff;
        if (diff < minDiff) {
            minDiff = diff;
            closest = entry;
        }
    });
    wizard.lastDirectionRow = (closest.index + PLAYTEST_WIZARD_DIRECTION_ROW_OFFSET + 12) % 12;
}

function setPlaytestWizardVisualMotion(wizard, previousPoint, deltaSeconds, fallbackDirection = null) {
    if (!wizard) return;
    const previousX = Number(previousPoint && previousPoint.x);
    const previousY = Number(previousPoint && previousPoint.y);
    const currentX = Number(wizard.x);
    const currentY = Number(wizard.y);
    const movedX = currentX - previousX;
    const movedY = currentY - previousY;
    const movedDistance = Math.hypot(movedX, movedY);
    const dt = Math.max(0, Number(deltaSeconds) || 0);
    if (movedDistance > 0.000001 && dt > 0) {
        wizard.moving = true;
        wizard.movementVector = { x: movedX / dt, y: movedY / dt };
        setPlaytestWizardFacing(wizard, { x: movedX, y: movedY });
        return;
    }
    wizard.moving = false;
    wizard.movementVector = { x: 0, y: 0 };
    if (fallbackDirection) setPlaytestWizardFacing(wizard, fallbackDirection);
}

function resetPlaytestFpsCounter() {
    playtestFpsAverage = 0;
    playtestFpsLastDisplayMs = 0;
    if (playtestFpsCounter) {
        playtestFpsCounter.textContent = "0 fps";
        playtestFpsCounter.hidden = true;
    }
}

function updatePlaytestFpsCounter(deltaSeconds, nowMs) {
    if (!playtestFpsCounter) return;
    playtestFpsCounter.hidden = false;
    const dt = Number(deltaSeconds);
    if (!(dt > 0)) return;
    const instantFps = 1 / dt;
    playtestFpsAverage = playtestFpsAverage > 0
        ? playtestFpsAverage * 0.88 + instantFps * 0.12
        : instantFps;
    if (nowMs - playtestFpsLastDisplayMs >= PLAYTEST_FPS_DISPLAY_INTERVAL_MS) {
        playtestFpsLastDisplayMs = nowMs;
        playtestFpsCounter.textContent = `${Math.max(0, Math.round(playtestFpsAverage))} fps`;
    }
}

function playtestStairSupport(runtimeStair, local, pointOverride = null) {
    const traversal = requireEditorStairTraversal();
    const support = traversal.supportFromPathLocal(runtimeStair, runtimeStair.traversalFrame, local);
    if (pointOverride) {
        support.point = { x: Number(pointOverride.x), y: Number(pointOverride.y) };
    }
    return support;
}

function applyPlaytestStairSupport(wizard, support) {
    const previousStairSupport = wizard.stairSupport
        ? {
            stairId: wizard.stairSupport.stairId,
            upDown: wizard.stairSupport.upDown,
            leftRight: wizard.stairSupport.leftRight
        }
        : null;
    wizard.x = support.point.x;
    wizard.y = support.point.y;
    wizard.z = support.baseZ;
    wizard.floorId = support.upDown >= 1 ? support.stair.higherFloorId : support.stair.lowerFloorId;
    wizard.onStair = true;
    wizard.stairSupport = {
        stairId: support.stairId,
        upDown: support.upDown,
        leftRight: support.leftRight
    };
    updatePlaytestStairFloorFocus(support, previousStairSupport);
}

function applyPlaytestFloorSupport(wizard, support, point) {
    wizard.x = point.x;
    wizard.y = point.y;
    wizard.z = support.z;
    wizard.floorId = support.floorId;
    wizard.onStair = false;
    wizard.stairSupport = null;
    focusPlaytestFloorAfterFloorSupport(support.floorId);
}

function connectedStairEndpointForFloor(stair, floorId) {
    if (stair.lowerFloorId === floorId) return "lower";
    if (stair.higherFloorId === floorId) return "higher";
    return "";
}

function playtestFloorMovementBlockedAt(point, floorId) {
    if (!playtestRuntime || !Array.isArray(playtestRuntime.floorBlockers)) return false;
    return playtestRuntime.floorBlockers.some((blocker) => (
        String(blocker.floorId) === String(floorId) &&
        Array.isArray(blocker.polygon) &&
        blocker.polygon.length >= 3 &&
        pointInPolygon(point, blocker.polygon)
    ));
}

function playtestClosestPointOnSegment(point, a, b) {
    const ax = Number(a && a.x);
    const ay = Number(a && a.y);
    const bx = Number(b && b.x);
    const by = Number(b && b.y);
    const px = Number(point && point.x);
    const py = Number(point && point.y);
    if (![ax, ay, bx, by, px, py].every(Number.isFinite)) {
        throw new Error("playtest collision segment requires finite points");
    }
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > PLAYTEST_COLLISION_EPSILON
        ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
        : 0;
    const x = ax + dx * t;
    const y = ay + dy * t;
    const distance = Math.hypot(px - x, py - y);
    return { x, y, t, distance, distanceSquared: distance * distance };
}

function playtestClosestPolygonEdge(point, polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3) return null;
    let best = null;
    for (let index = 0; index < polygon.length; index++) {
        const a = polygon[index];
        const b = polygon[(index + 1) % polygon.length];
        const closest = playtestClosestPointOnSegment(point, a, b);
        if (!best || closest.distanceSquared < best.distanceSquared) {
            best = { ...closest, a, b, index };
        }
    }
    return best;
}

function playtestNormalizeVector(vector) {
    const x = Number(vector && vector.x);
    const y = Number(vector && vector.y);
    const length = Math.hypot(x, y);
    if (!(length > PLAYTEST_COLLISION_EPSILON)) return null;
    return { x: x / length, y: y / length };
}

function playtestNormalFacingMovement(normal, movement) {
    const unit = playtestNormalizeVector(normal);
    if (!unit) return null;
    const dot = unit.x * Number(movement && movement.x) + unit.y * Number(movement && movement.y);
    return dot >= 0 ? unit : { x: -unit.x, y: -unit.y };
}

function playtestCrossedPolygonNormal(from, movement, polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3) return null;
    const fromX = Number(from && from.x);
    const fromY = Number(from && from.y);
    const dx = Number(movement && movement.x);
    const dy = Number(movement && movement.y);
    if (![fromX, fromY, dx, dy].every(Number.isFinite)) {
        throw new Error("playtest polygon crossing requires finite movement");
    }
    if (!(Math.hypot(dx, dy) > PLAYTEST_COLLISION_EPSILON)) return null;
    for (let index = 0; index < polygon.length; index++) {
        const a = polygon[index];
        const b = polygon[(index + 1) % polygon.length];
        const ax = Number(a && a.x);
        const ay = Number(a && a.y);
        const bx = Number(b && b.x);
        const by = Number(b && b.y);
        const ex = bx - ax;
        const ey = by - ay;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((ax - fromX) * ey - (ay - fromY) * ex) / den;
        const u = ((ax - fromX) * dy - (ay - fromY) * dx) / den;
        if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
        const edgeLength = Math.hypot(ex, ey);
        if (!(edgeLength > PLAYTEST_COLLISION_EPSILON)) continue;
        return playtestNormalFacingMovement({ x: -ey / edgeLength, y: ex / edgeLength }, movement);
    }
    return null;
}

function playtestFallbackPolygonNormal(point, polygon, movement) {
    const edge = playtestClosestPolygonEdge(point, polygon);
    if (!edge) return null;
    const dx = Number(edge.b.x) - Number(edge.a.x);
    const dy = Number(edge.b.y) - Number(edge.a.y);
    const length = Math.hypot(dx, dy);
    if (!(length > PLAYTEST_COLLISION_EPSILON)) return null;
    const areaSign = polygonArea(polygon) >= 0 ? 1 : -1;
    const outward = areaSign >= 0
        ? { x: dy / length, y: -dx / length }
        : { x: -dy / length, y: dx / length };
    const awayFromEdge = playtestNormalizeVector({
        x: Number(point.x) - edge.x,
        y: Number(point.y) - edge.y
    });
    return playtestNormalFacingMovement(awayFromEdge || outward, movement);
}

function playtestBlockingPolygonContact(point, floorId, previousPoint, movement) {
    if (!playtestRuntime || !Array.isArray(playtestRuntime.floorBlockers)) return null;
    const blocker = playtestRuntime.floorBlockers.find((entry) => (
        String(entry.floorId) === String(floorId) &&
        Array.isArray(entry.polygon) &&
        entry.polygon.length >= 3 &&
        pointInPolygon(point, entry.polygon)
    ));
    if (!blocker) return null;
    const normal = playtestCrossedPolygonNormal(previousPoint, movement, blocker.polygon) ||
        playtestFallbackPolygonNormal(point, blocker.polygon, movement);
    return normal ? { normal, kind: "stairBlocker", blocker } : null;
}

function playtestFloorBoundaryContact(point, floorId, previousPoint, movement) {
    const floor = findFloor(state.building, floorId);
    if (!floor) throw new Error(`playtest movement references missing level ${floorId}`);
    const outer = Array.isArray(floor.outerPolygon) ? floor.outerPolygon : [];
    if (outer.length < 3) throw new Error(`playtest movement level ${floorId} has no valid outer polygon`);
    let polygon = null;
    if (!pointInPolygon(point, outer)) {
        polygon = outer;
    } else {
        const holes = Array.isArray(floor.holes) ? floor.holes : [];
        polygon = holes.find((hole) => Array.isArray(hole) && hole.length >= 3 && pointInPolygon(point, hole)) || null;
    }
    if (!polygon) return null;
    const normal = playtestCrossedPolygonNormal(previousPoint, movement, polygon) ||
        playtestFallbackPolygonNormal(point, polygon, movement);
    return normal ? { normal, kind: "floorBoundary", polygon } : null;
}

function playtestWallCollisionAt(point, floorId, radius, movement = null) {
    const floor = findFloor(state.building, floorId);
    if (!floor) throw new Error(`playtest wall collision references missing level ${floorId}`);
    const hitRadius = Math.max(0, Number(radius) || 0);
    const blockingSegments = [];
    let best = null;
    getBuildingWalls(state.building).forEach((wall) => {
        if (String(wall && (wall.fragmentId || wall.floorId)) !== String(floorId)) return;
        const points = wallCenterlinePoints(state.building, wall, floor);
        if (!Array.isArray(points) || points.length < 2) return;
        const thickness = Number.isFinite(Number(wall.thickness))
            ? Math.max(0, Number(wall.thickness))
            : DEFAULTS.wallThickness;
        blockingSegments.push({
            kind: "wall",
            wall,
            points: [points[0], points[points.length - 1]],
            threshold: hitRadius + thickness * 0.5
        });
    });
    playtestColumnBlockingSegmentsForFloor(getBuildingColumns(state.building), floorId).forEach((segment) => {
        blockingSegments.push({
            ...segment,
            threshold: hitRadius
        });
    });
    blockingSegments.forEach((segment) => {
        if (!Array.isArray(segment.points) || segment.points.length < 2) {
            throw new Error(`playtest ${segment.kind || "solid"} blocking segment requires two points`);
        }
        const threshold = Math.max(0, Number(segment.threshold) || 0);
        const closest = playtestClosestPointOnSegment(point, segment.points[0], segment.points[1]);
        if (closest.distance >= threshold - PLAYTEST_COLLISION_EPSILON) return;
        if (!best || closest.distanceSquared < best.closest.distanceSquared) {
            best = { ...segment, threshold, closest };
        }
    });
    if (!best) return null;
    const movementVector = movement && Math.hypot(Number(movement.x), Number(movement.y)) > PLAYTEST_COLLISION_EPSILON
        ? movement
        : { x: Number(point.x) - best.closest.x, y: Number(point.y) - best.closest.y };
    let normal = playtestNormalizeVector({ x: best.closest.x - Number(point.x), y: best.closest.y - Number(point.y) });
    if (!normal) {
        normal = playtestNormalizeVector(movementVector);
    }
    if (!normal) {
        const a = best.points[0];
        const b = best.points[1];
        normal = playtestNormalizeVector({
            x: -(Number(b.y) - Number(a.y)),
            y: Number(b.x) - Number(a.x)
        });
    }
    normal = playtestNormalFacingMovement(normal, movementVector);
    return normal ? {
        normal,
        kind: best.kind || "wall",
        wall: best.wall,
        column: best.column,
        floorId: String(floorId),
        distanceSquared: best.closest.distanceSquared
    } : null;
}

function playtestFloorMovementAllowedAt(point, floorId, radius) {
    const floorSupport = playtestFloorSupportAt(point, floorId);
    if (!floorSupport || String(floorSupport.floorId) !== String(floorId)) return false;
    if (playtestFloorMovementBlockedAt(point, floorId)) return false;
    return !playtestWallCollisionAt(point, floorId, radius);
}

function playtestFloorMovementContact(previousPoint, candidate, floorId, radius, movement) {
    return playtestWallCollisionAt(candidate, floorId, radius, movement) ||
        playtestBlockingPolygonContact(candidate, floorId, previousPoint, movement) ||
        playtestFloorBoundaryContact(candidate, floorId, previousPoint, movement);
}

function playtestSlideMovement(movement, contact) {
    const normal = contact && contact.normal ? contact.normal : null;
    const unit = playtestNormalizeVector(normal);
    if (!unit) return { x: 0, y: 0 };
    const dot = Number(movement.x) * unit.x + Number(movement.y) * unit.y;
    if (!(dot > PLAYTEST_COLLISION_EPSILON)) return { x: Number(movement.x), y: Number(movement.y) };
    return {
        x: Number(movement.x) - unit.x * dot,
        y: Number(movement.y) - unit.y * dot
    };
}

function resolvePlaytestFloorMovement(wizard, candidate) {
    const previousPoint = { x: Number(wizard.x), y: Number(wizard.y) };
    const floorId = wizard.floorId;
    const radius = Number.isFinite(Number(wizard.radius)) ? Math.max(0, Number(wizard.radius)) : PLAYTEST_WIZARD_RADIUS;
    if (playtestFloorMovementAllowedAt(candidate, floorId, radius)) return candidate;
    const requested = {
        x: Number(candidate.x) - previousPoint.x,
        y: Number(candidate.y) - previousPoint.y
    };
    if (!(Math.hypot(requested.x, requested.y) > PLAYTEST_COLLISION_EPSILON)) return previousPoint;
    const firstContact = playtestFloorMovementContact(previousPoint, candidate, floorId, radius, requested);
    if (!firstContact) return previousPoint;
    const firstSlide = playtestSlideMovement(requested, firstContact);
    if (!(Math.hypot(firstSlide.x, firstSlide.y) > PLAYTEST_COLLISION_EPSILON)) return previousPoint;
    const firstCandidate = {
        x: previousPoint.x + firstSlide.x,
        y: previousPoint.y + firstSlide.y
    };
    if (playtestFloorMovementAllowedAt(firstCandidate, floorId, radius)) return firstCandidate;
    const secondContact = playtestFloorMovementContact(previousPoint, firstCandidate, floorId, radius, firstSlide);
    if (!secondContact) return previousPoint;
    const secondSlide = playtestSlideMovement(firstSlide, secondContact);
    if (!(Math.hypot(secondSlide.x, secondSlide.y) > PLAYTEST_COLLISION_EPSILON)) return previousPoint;
    const secondCandidate = {
        x: previousPoint.x + secondSlide.x,
        y: previousPoint.y + secondSlide.y
    };
    return playtestFloorMovementAllowedAt(secondCandidate, floorId, radius) ? secondCandidate : previousPoint;
}

function playtestStairSideLimits(traversal, frame, upDown, radius) {
    const left = traversal.pointFromPathLocal(frame, upDown, 0);
    const right = traversal.pointFromPathLocal(frame, upDown, 1);
    const crosslineLength = Math.hypot(Number(right.x) - Number(left.x), Number(right.y) - Number(left.y));
    if (!(crosslineLength > PLAYTEST_COLLISION_EPSILON)) {
        throw new Error(`playtest stair ${frame && frame.stairId ? frame.stairId : "(unknown)"} has a degenerate crossline`);
    }
    const inset = Math.max(0, Number(radius) || 0) / crosslineLength;
    return {
        min: inset,
        max: 1 - inset
    };
}

function playtestClampStairLocalSide(traversal, frame, local, radius) {
    if (!local || !Number.isFinite(Number(local.upDown)) || !Number.isFinite(Number(local.leftRight))) {
        throw new Error("playtest stair side clamp requires finite local coordinates");
    }
    const limits = playtestStairSideLimits(traversal, frame, local.upDown, radius);
    if (limits.min > limits.max + PLAYTEST_COLLISION_EPSILON) {
        throw new Error(`playtest stair ${frame && frame.stairId ? frame.stairId : "(unknown)"} is too narrow for the wizard hitbox`);
    }
    return {
        upDown: Number(local.upDown),
        leftRight: Math.max(limits.min, Math.min(limits.max, Number(local.leftRight)))
    };
}

function playtestStairPointForLocal(traversal, frame, local) {
    if (!local || !Number.isFinite(Number(local.upDown)) || !Number.isFinite(Number(local.leftRight))) {
        throw new Error("playtest stair wall collision requires finite local coordinates");
    }
    if (Number(local.upDown) < 0 || Number(local.upDown) > 1) {
        return traversal.exitPointFromPathLocal(frame, local);
    }
    return traversal.pointFromPathLocal(frame, local.upDown, local.leftRight);
}

function playtestStairWallContact(point, stair, radius, movement = null) {
    if (!stair) throw new Error("playtest stair wall contact requires a stair");
    const floorIds = [...new Set([stair.lowerFloorId, stair.higherFloorId].map((floorId) => String(floorId || "")).filter(Boolean))];
    if (!floorIds.length) throw new Error(`playtest stair ${stair.id || "(unknown)"} has no connected floors`);
    let best = null;
    floorIds.forEach((floorId) => {
        const contact = playtestWallCollisionAt(point, floorId, radius, movement);
        if (!contact) return;
        if (!best || Number(contact.distanceSquared) < Number(best.distanceSquared)) best = contact;
    });
    return best;
}

function playtestStairLocalAllowed(traversal, stair, local, radius) {
    const frame = stair && stair.traversalFrame;
    if (!frame) throw new Error(`playtest stair ${stair && stair.id ? stair.id : "(unknown)"} is missing a traversal frame`);
    const upDown = Number(local && local.upDown);
    if (!Number.isFinite(upDown)) throw new Error("playtest stair allowance requires finite up/down");
    if (upDown >= 0 && upDown <= 1 && !traversal.localInsidePathFrame(frame, local, radius)) return false;
    const point = playtestStairPointForLocal(traversal, frame, local);
    return !playtestStairWallContact(point, stair, radius);
}

function playtestResolveStairWallSlide(traversal, stair, currentLocal, candidateLocal, radius) {
    const frame = stair && stair.traversalFrame;
    if (!frame) throw new Error(`playtest stair ${stair && stair.id ? stair.id : "(unknown)"} is missing a traversal frame`);
    const currentPoint = playtestStairPointForLocal(traversal, frame, currentLocal);
    const candidatePoint = playtestStairPointForLocal(traversal, frame, candidateLocal);
    const movement = {
        x: Number(candidatePoint.x) - Number(currentPoint.x),
        y: Number(candidatePoint.y) - Number(currentPoint.y)
    };
    const contact = playtestStairWallContact(candidatePoint, stair, radius, movement);
    if (!contact) return candidateLocal;
    if (!(Math.hypot(movement.x, movement.y) > PLAYTEST_COLLISION_EPSILON)) return null;
    const slide = playtestSlideMovement(movement, contact);
    if (!(Math.hypot(slide.x, slide.y) > PLAYTEST_COLLISION_EPSILON)) return null;
    const slidePoint = {
        x: Number(currentPoint.x) + slide.x,
        y: Number(currentPoint.y) + slide.y
    };
    const slideLocal = playtestClampStairLocalSide(
        traversal,
        frame,
        traversal.localPointForPathFrame(frame, slidePoint),
        radius
    );
    return playtestStairLocalAllowed(traversal, stair, slideLocal, radius) ? slideLocal : null;
}

function resolvePlaytestStairMovement(traversal, stair, wizard, direction, stepDistance) {
    const frame = stair && stair.traversalFrame;
    if (!frame) throw new Error(`playtest stair ${stair && stair.id ? stair.id : "(unknown)"} is missing a traversal frame`);
    const radius = Number.isFinite(Number(wizard.radius)) ? Math.max(0, Number(wizard.radius)) : PLAYTEST_WIZARD_RADIUS;
    const currentLocal = playtestClampStairLocalSide(traversal, frame, wizard.stairSupport, radius);
    const nextLocal = traversal.movePathLocal(
        frame,
        currentLocal,
        direction,
        1,
        stepDistance
    );
    if (nextLocal.upDown < 0 || nextLocal.upDown > 1) {
        const exitCandidate = playtestClampStairLocalSide(traversal, frame, nextLocal, radius);
        const wallSlide = playtestResolveStairWallSlide(traversal, stair, currentLocal, exitCandidate, radius);
        return wallSlide || currentLocal;
    }
    if (traversal.localInsidePathFrame(frame, nextLocal, radius) && playtestStairLocalAllowed(traversal, stair, nextLocal, radius)) {
        return nextLocal;
    }
    const clampedCandidate = playtestClampStairLocalSide(traversal, frame, nextLocal, radius);
    if (
        traversal.localInsidePathFrame(frame, clampedCandidate, radius) &&
        playtestStairLocalAllowed(traversal, stair, clampedCandidate, radius)
    ) {
        return clampedCandidate;
    }
    const wallSlide = playtestResolveStairWallSlide(traversal, stair, currentLocal, clampedCandidate, radius);
    if (wallSlide) return wallSlide;
    const currentSide = playtestClampStairLocalSide(traversal, frame, currentLocal, radius);
    const tangentCandidate = playtestClampStairLocalSide(traversal, frame, {
        upDown: nextLocal.upDown,
        leftRight: currentSide.leftRight
    }, radius);
    return traversal.localInsidePathFrame(frame, tangentCandidate, radius) &&
        playtestStairLocalAllowed(traversal, stair, tangentCandidate, radius)
        ? tangentCandidate
        : currentSide;
}

function playtestStairEntryDirectionMatches(previousLocal, candidateLocal, endpoint) {
    if (!previousLocal || !candidateLocal) return false;
    const previousUpDown = Number(previousLocal.upDown);
    const candidateUpDown = Number(candidateLocal.upDown);
    if (!Number.isFinite(previousUpDown) || !Number.isFinite(candidateUpDown)) return false;
    if (endpoint === "lower") return candidateUpDown > previousUpDown + 0.000001;
    if (endpoint === "higher") return candidateUpDown < previousUpDown - 0.000001;
    throw new Error(`unknown playtest stair endpoint: ${endpoint}`);
}

function cloneEditorSelection(selection) {
    if (!selection || typeof selection !== "object") throw new Error("playtest focus snapshot requires an editor selection");
    return JSON.parse(JSON.stringify(selection));
}

function snapshotPlaytestEditorFocus() {
    return {
        selection: cloneEditorSelection(state.selection),
        selectedFloorIds: [...state.selectedFloorIds],
        layerSelectionMode: state.layerSelectionMode
    };
}

function restorePlaytestEditorFocus() {
    if (!playtestPreviousFocus) return;
    const snapshot = playtestPreviousFocus;
    playtestPreviousFocus = null;
    playtestFocusedFloorId = "";
    state.playtestFloorFade = null;
    const floors = getBuildingFloors(state.building);
    const floorIds = new Set(floors.map((floor) => getFloorId(floor)));
    snapshot.selectedFloorIds.forEach((floorId) => {
        if (!floorIds.has(String(floorId))) {
            throw new Error(`cannot restore playtest editor focus: missing level ${floorId}`);
        }
    });
    if (snapshot.selection && snapshot.selection.floorId && !floorIds.has(String(snapshot.selection.floorId))) {
        throw new Error(`cannot restore playtest editor selection: missing level ${snapshot.selection.floorId}`);
    }
    state.selection = cloneEditorSelection(snapshot.selection);
    state.selectedFloorIds = new Set(snapshot.selectedFloorIds.map((floorId) => String(floorId)));
    state.layerSelectionMode = snapshot.layerSelectionMode === "all" ? "all" : "floor";
    const inputFloor = findFloor(state.building, state.selection.floorId)
        || floors.find((floor) => state.selectedFloorIds.has(getFloorId(floor)))
        || floors[0]
        || null;
    state.syncInputsFromFloor(inputFloor);
    if (state.tool === "stair" && inputFloor) state.syncStairToolDirectionWithFloor(inputFloor, { emit: false });
    state.emitChange();
}

function focusPlaytestFloor(floorId, options = {}) {
    floorId = String(floorId || "");
    if (!floorId) throw new Error("playtest wizard focus requires a level id");
    const floor = findFloor(state.building, floorId);
    if (!floor) {
        throw new Error(`playtest wizard focus references missing level ${floorId}`);
    }
    const alreadyFocused = state.renderStyle() === "interior" &&
        !state.playtestFloorFade &&
        state.selectedFloorIds.size === 1 &&
        state.selectedFloorIds.has(floorId);
    const alreadyClear = state.selection &&
        state.selection.kind === "building" &&
        String(state.selection.floorId || "") === floorId;
    playtestFocusedFloorId = floorId;
    if (alreadyFocused && alreadyClear) return false;
    state.playtestFloorFade = null;
    state.selectedFloorIds = new Set([floorId]);
    state.layerSelectionMode = "floor";
    state.selection = { kind: "building", floorId };
    if (options.syncInputs !== false) state.syncInputsFromFloor(floor);
    if (options.emit !== false) state.emitChange();
    return true;
}

function focusPlaytestWizardLevel(wizard) {
    if (!wizard || wizard.active !== true) return false;
    return focusPlaytestFloor(wizard.floorId);
}

function startPlaytestFloorFade(fromFloorId, toFloorId) {
    fromFloorId = String(fromFloorId || "");
    toFloorId = String(toFloorId || "");
    if (!fromFloorId || !toFloorId) throw new Error("playtest floor fade requires level ids");
    if (fromFloorId === toFloorId) return false;
    const fromFloor = findFloor(state.building, fromFloorId);
    const toFloor = findFloor(state.building, toFloorId);
    if (!fromFloor) throw new Error(`playtest floor fade references missing source level ${fromFloorId}`);
    if (!toFloor) throw new Error(`playtest floor fade references missing target level ${toFloorId}`);
    const active = state.playtestFloorFade;
    if (
        active &&
        String(active.fromFloorId || "") === fromFloorId &&
        String(active.toFloorId || "") === toFloorId
    ) {
        return false;
    }
    state.playtestFloorFade = {
        fromFloorId,
        toFloorId,
        elapsedSeconds: 0,
        durationSeconds: PLAYTEST_LEVEL_FADE_SECONDS,
        progress: 0
    };
    state.selectedFloorIds = new Set([fromFloorId, toFloorId]);
    state.layerSelectionMode = "floor";
    state.selection = { kind: "building", floorId: toFloorId };
    state.syncInputsFromFloor(toFloor);
    state.emitChange();
    return true;
}

function updatePlaytestFloorFade(deltaSeconds) {
    const fade = state.playtestFloorFade;
    if (!fade) return false;
    const duration = Number(fade.durationSeconds);
    if (!(duration > 0)) throw new Error("playtest floor fade requires a positive duration");
    fade.elapsedSeconds = Math.max(0, Number(fade.elapsedSeconds) || 0) + Math.max(0, Number(deltaSeconds) || 0);
    fade.progress = Math.max(0, Math.min(1, fade.elapsedSeconds / duration));
    if (fade.progress < 1) return false;
    return focusPlaytestFloor(fade.toFloorId);
}

function playtestStairFocusDirection(support, previousStairSupport) {
    if (!support || !support.stair) throw new Error("playtest stair focus direction requires stair support");
    const currentUpDown = Number(support.upDown);
    if (!Number.isFinite(currentUpDown)) throw new Error(`playtest stair ${support.stair.id} focus requires finite up/down`);
    if (previousStairSupport && String(previousStairSupport.stairId || "") === String(support.stairId || "")) {
        const previousUpDown = Number(previousStairSupport.upDown);
        if (Number.isFinite(previousUpDown)) {
            const delta = currentUpDown - previousUpDown;
            if (delta > PLAYTEST_COLLISION_EPSILON) return "up";
            if (delta < -PLAYTEST_COLLISION_EPSILON) return "down";
        }
    }
    return "";
}

function updatePlaytestStairFloorFocus(support, previousStairSupport = null) {
    if (!support || !support.stair) throw new Error("playtest stair floor focus requires stair support");
    const stair = support.stair;
    const lowerFloorId = String(stair.lowerFloorId || "");
    const higherFloorId = String(stair.higherFloorId || "");
    const baseZ = Number(support.baseZ);
    const higherZ = Number(stair.higherZ);
    if (!lowerFloorId || !higherFloorId) throw new Error(`playtest stair ${stair.id} requires connected floor ids`);
    if (!Number.isFinite(baseZ) || !Number.isFinite(higherZ)) {
        throw new Error(`playtest stair ${stair.id} focus requires finite z values`);
    }
    const activeFade = state.playtestFloorFade;
    if (activeFade) return false;
    const currentFocus = String(playtestFocusedFloorId || (state.selection && state.selection.floorId) || lowerFloorId);
    const direction = playtestStairFocusDirection(support, previousStairSupport);
    const distanceToUpperFloor = higherZ - baseZ;
    const reachedUpperFadeInThreshold =
        distanceToUpperFloor >= -PLAYTEST_COLLISION_EPSILON &&
        distanceToUpperFloor <= PLAYTEST_UPPER_FLOOR_TRANSITION_DISTANCE + PLAYTEST_COLLISION_EPSILON;
    const reachedUpperFadeOutThreshold =
        distanceToUpperFloor >= PLAYTEST_UPPER_FLOOR_TRANSITION_DISTANCE - PLAYTEST_COLLISION_EPSILON;
    if (
        currentFocus === lowerFloorId &&
        reachedUpperFadeInThreshold &&
        (direction === "up" || direction === "")
    ) {
        return startPlaytestFloorFade(lowerFloorId, higherFloorId);
    }
    if (
        currentFocus === higherFloorId &&
        reachedUpperFadeOutThreshold &&
        (direction === "down" || direction === "")
    ) {
        return startPlaytestFloorFade(higherFloorId, lowerFloorId);
    }
    return false;
}

function focusPlaytestFloorAfterFloorSupport(floorId) {
    floorId = String(floorId || "");
    const activeFade = state.playtestFloorFade;
    if (activeFade && String(activeFade.toFloorId || "") === floorId) return false;
    return focusPlaytestFloor(floorId);
}

function updatePlaytestWizard(deltaSeconds) {
    const wizard = state.playtestWizard;
    if (!wizard || wizard.active !== true || !playtestRuntime || !playtestMouseWorld) return;
    const traversal = requireEditorStairTraversal();
    const dx = Number(playtestMouseWorld.x) - Number(wizard.x);
    const dy = Number(playtestMouseWorld.y) - Number(wizard.y);
    const distance = Math.hypot(dx, dy);
    if (!(distance > 0.03)) {
        wizard.moving = false;
        wizard.movementVector = { x: 0, y: 0 };
        return;
    }
    const direction = { x: dx / distance, y: dy / distance };
    if (!playtestForwardPressed) {
        wizard.moving = false;
        wizard.movementVector = { x: 0, y: 0 };
        setPlaytestWizardFacing(wizard, direction);
        return;
    }
    const stepDistance = Math.min(distance, PLAYTEST_WIZARD_SPEED * Math.max(0, Number(deltaSeconds) || 0));
    const previousPoint = { x: Number(wizard.x), y: Number(wizard.y) };

    if (wizard.onStair) {
        const stairId = wizard.stairSupport && wizard.stairSupport.stairId;
        const stair = playtestRuntime.stairs.find((entry) => entry.id === stairId);
        if (!stair) throw new Error(`playtest wizard references missing stair ${stairId}`);
        const nextLocal = resolvePlaytestStairMovement(traversal, stair, wizard, direction, stepDistance);
        const nextPoint = traversal.pointFromPathLocal(
            stair.traversalFrame,
            nextLocal.upDown,
            nextLocal.leftRight
        );
        if (nextLocal.upDown < 0 || nextLocal.upDown > 1) {
            const targetFloorId = nextLocal.upDown < 0 ? stair.lowerFloorId : stair.higherFloorId;
            const exitPoint = traversal.exitPointFromPathLocal(stair.traversalFrame, nextLocal);
            const floorSupport = playtestFloorSupportAt(exitPoint, targetFloorId);
            if (floorSupport && floorSupport.floorId === targetFloorId) {
                applyPlaytestFloorSupport(wizard, floorSupport, exitPoint);
                setPlaytestWizardVisualMotion(wizard, previousPoint, deltaSeconds, direction);
            } else {
                setPlaytestWizardVisualMotion(wizard, previousPoint, deltaSeconds, direction);
            }
            return;
        }
        if (!traversal.localInsidePathFrame(stair.traversalFrame, nextLocal, wizard.radius)) {
            setPlaytestWizardVisualMotion(wizard, previousPoint, deltaSeconds, direction);
            return;
        }
        applyPlaytestStairSupport(wizard, playtestStairSupport(stair, nextLocal, nextPoint));
        setPlaytestWizardVisualMotion(wizard, previousPoint, deltaSeconds, direction);
        return;
    }

    const candidate = {
        x: Number(wizard.x) + direction.x * stepDistance,
        y: Number(wizard.y) + direction.y * stepDistance
    };

    for (const stair of playtestRuntime.stairs) {
        const endpoint = connectedStairEndpointForFloor(stair, wizard.floorId);
        if (!endpoint) continue;
        const previousLocal = traversal.localPointForPathFrame(stair.traversalFrame, wizard);
        const candidateLocal = traversal.localPointForPathFrame(stair.traversalFrame, candidate);
        if (
            traversal.endpointLineCrossed(stair.traversalFrame, wizard, candidate, endpoint) &&
            playtestStairEntryDirectionMatches(previousLocal, candidateLocal, endpoint) &&
            traversal.localInsidePathFrame(stair.traversalFrame, candidateLocal, wizard.radius)
        ) {
            applyPlaytestStairSupport(wizard, playtestStairSupport(stair, candidateLocal, candidate));
            setPlaytestWizardVisualMotion(wizard, previousPoint, deltaSeconds, direction);
            return;
        }
    }

    const resolvedCandidate = resolvePlaytestFloorMovement(wizard, candidate);
    const floorSupport = playtestFloorSupportAt(resolvedCandidate, wizard.floorId);
    if (
        floorSupport &&
        String(floorSupport.floorId) === String(wizard.floorId) &&
        playtestFloorMovementAllowedAt(resolvedCandidate, wizard.floorId, wizard.radius)
    ) {
        applyPlaytestFloorSupport(wizard, floorSupport, resolvedCandidate);
        setPlaytestWizardVisualMotion(wizard, previousPoint, deltaSeconds, direction);
        return;
    }
    setPlaytestWizardVisualMotion(wizard, previousPoint, deltaSeconds, direction);
}

function runPlaytestFrame(nowMs) {
    if (!state.playtestWizard || state.playtestWizard.active !== true) {
        playtestAnimationFrame = null;
        return;
    }
    const last = Number.isFinite(playtestLastTimeMs) && playtestLastTimeMs > 0 ? playtestLastTimeMs : nowMs;
    playtestLastTimeMs = nowMs;
    withErrorBoundary(() => {
        const deltaSeconds = Math.min(0.05, Math.max(0, (nowMs - last) / 1000));
        updatePlaytestFpsCounter(deltaSeconds, nowMs);
        updatePlaytestWizard(deltaSeconds);
        updatePlaytestFloorFade(deltaSeconds);
        centerPlaytestCameraOnWizard();
        renderer.render();
    });
    playtestAnimationFrame = requestAnimationFrame(runPlaytestFrame);
}

function centerPlaytestCameraOnWizard() {
    const wizard = state.playtestWizard;
    if (!wizard || wizard.active !== true) return false;
    if (!renderer || typeof renderer.centerCameraOnWorldPoint !== "function") {
        throw new Error("building editor playtest requires camera centering support");
    }
    renderer.centerCameraOnWorldPoint({ x: wizard.x, y: wizard.y }, wizard.z);
    if (
        lastStagePointer &&
        Number.isFinite(Number(lastStagePointer.x)) &&
        Number.isFinite(Number(lastStagePointer.y))
    ) {
        playtestMouseWorld = renderer.screenToWorld(lastStagePointer, wizard.z);
    } else {
        playtestMouseWorld = { x: Number(wizard.x), y: Number(wizard.y) };
    }
    return true;
}

function setPlaytestMode(enabled) {
    if (enabled) {
        if (!playtestPreviousFocus) playtestPreviousFocus = snapshotPlaytestEditorFocus();
        playtestRuntime = buildPlaytestRuntime();
        state.playtestWizard = spawnPlaytestWizard();
        state.playtestFloorFade = null;
        playtestFocusedFloorId = String(state.playtestWizard.floorId || "");
        playtestMouseWorld = { x: state.playtestWizard.x, y: state.playtestWizard.y };
        playtestForwardPressed = false;
        playtestLastTimeMs = 0;
        playtestFpsAverage = 0;
        playtestFpsLastDisplayMs = 0;
        if (playtestFpsCounter) {
            playtestFpsCounter.textContent = "0 fps";
            playtestFpsCounter.hidden = false;
        }
        focusPlaytestWizardLevel(state.playtestWizard);
        centerPlaytestCameraOnWizard();
        if (!playtestAnimationFrame) playtestAnimationFrame = requestAnimationFrame(runPlaytestFrame);
        setStatus("wizard playtest active");
    } else {
        state.playtestWizard = null;
        state.playtestFloorFade = null;
        playtestFocusedFloorId = "";
        playtestRuntime = null;
        playtestMouseWorld = null;
        playtestForwardPressed = false;
        playtestLastTimeMs = 0;
        resetPlaytestFpsCounter();
        if (playtestAnimationFrame) {
            cancelAnimationFrame(playtestAnimationFrame);
            playtestAnimationFrame = null;
        }
        restorePlaytestEditorFocus();
        setStatus("wizard playtest off");
    }
    syncUi();
    renderer.render();
}

const BUILDING_EDITOR_SAVE_API = "/api/building-editor/buildings";

function normalizeBuildingEditorName(rawName) {
    const name = String(rawName === undefined || rawName === null ? "" : rawName).trim();
    if (!name || name.length > 80) return "";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(name)) return "";
    if (name.endsWith(".json")) return "";
    return name;
}

function requireBuildingEditorName(rawName) {
    const name = normalizeBuildingEditorName(rawName);
    if (!name) {
        throw new Error("building names must use letters, numbers, spaces, underscores, or hyphens, and must not include .json");
    }
    return name;
}

async function readJsonResponse(response, context) {
    let payload = null;
    try {
        payload = await response.json();
    } catch (error) {
        throw new Error(`${context} returned non-JSON response`);
    }
    if (!response.ok || !payload || payload.ok !== true) {
        const reason = payload && payload.reason ? payload.reason : `HTTP ${response.status}`;
        throw new Error(`${context} failed: ${reason}`);
    }
    return payload;
}

function setModalMessage(element, message, isError = false) {
    element.textContent = message || "";
    element.dataset.error = isError ? "true" : "false";
}

function formatBuildingModifiedTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function renderBuildingSaveList(buildings) {
    buildingSaveList.replaceChildren();
    if (!Array.isArray(buildings)) {
        throw new Error("building save list response is missing buildings array");
    }
    if (buildings.length === 0) {
        const empty = document.createElement("div");
        empty.className = "modalMessage";
        empty.textContent = "No saved buildings yet.";
        buildingSaveList.appendChild(empty);
        return;
    }
    buildings.forEach((building) => {
        const name = requireBuildingEditorName(building && building.name);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "buildingSaveButton";
        button.dataset.buildingName = name;

        const nameElement = document.createElement("span");
        nameElement.className = "buildingSaveName";
        nameElement.textContent = name;

        const metaElement = document.createElement("span");
        metaElement.className = "buildingSaveMeta";
        metaElement.textContent = formatBuildingModifiedTime(building.modifiedTime);

        button.append(nameElement, metaElement);
        buildingSaveList.appendChild(button);
    });
}

async function showBuildingOpenDialog({ canClose = true } = {}) {
    buildingOpenDialogCanClose = canClose;
    closeBuildingOpenDialogButton.hidden = !canClose;
    buildingOpenDialog.hidden = false;
    setModalMessage(buildingOpenMessage, "Loading saved buildings...");
    buildingSaveList.replaceChildren();
    const response = await fetch(BUILDING_EDITOR_SAVE_API);
    const payload = await readJsonResponse(response, "building save list");
    renderBuildingSaveList(payload.buildings);
    setModalMessage(buildingOpenMessage, "Choose a saved building or start a new one.");
}

function closeBuildingOpenDialog() {
    if (!buildingOpenDialogCanClose) return;
    buildingOpenDialog.hidden = true;
}

function showBuildingNameDialog() {
    state.reset({ createStarterFloor: false });
    currentBuildingName = "";
    buildingNameInput.value = "";
    setModalMessage(buildingNameMessage, "This name becomes the save file name.");
    buildingNameDialog.hidden = false;
    buildingOpenDialog.hidden = true;
    requestAnimationFrame(() => buildingNameInput.focus());
}

function closeBuildingNameDialog() {
    buildingNameDialog.hidden = true;
}

async function loadBuildingFromServer(name) {
    const buildingName = requireBuildingEditorName(name);
    const response = await fetch(`${BUILDING_EDITOR_SAVE_API}/${encodeURIComponent(buildingName)}`);
    const payload = await readJsonResponse(response, `building "${buildingName}"`);
    if (!payload.data || typeof payload.data !== "object") {
        throw new Error(`building "${buildingName}" response is missing building data`);
    }
    payload.data.name = buildingName;
    state.import(payload.data);
    currentBuildingName = buildingName;
    buildingOpenDialog.hidden = true;
    setStatus(`opened ${buildingName}`);
}

function createNewBuildingWithName(rawName) {
    const buildingName = requireBuildingEditorName(rawName);
    state.building.name = buildingName;
    currentBuildingName = buildingName;
    closeBuildingNameDialog();
    setStatus(`created new empty building: ${buildingName}`);
}

async function saveCurrentBuildingToServer() {
    const buildingName = requireBuildingEditorName(currentBuildingName);
    state.building.name = buildingName;
    state.assertValidForSave();
    const payload = JSON.parse(state.serialize());
    const response = await fetch(`${BUILDING_EDITOR_SAVE_API}/${encodeURIComponent(buildingName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    await readJsonResponse(response, `save "${buildingName}"`);
    setStatus(`saved ${buildingName}`);
}

function normalizeImagePathList(values, folder) {
    const prefix = `/assets/images/${folder}/`;
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => String(value || ""))
        .filter((value) => value.startsWith(prefix) && /\.(png|jpe?g|webp|gif)$/i.test(value)))];
}

async function loadTextureManifest(folder) {
    const response = await fetch(`/assets/images/${encodeURIComponent(folder)}/items.json`, { cache: "no-cache" });
    if (!response.ok) {
        throw new Error(`could not load ${folder} texture manifest`);
    }
    const payload = await response.json();
    const files = normalizeImagePathList((payload.items || []).map((item) => item && item.texturePath), folder);
    if (!files.length) {
        throw new Error(`${folder} texture manifest is empty`);
    }
    return files;
}

async function loadPaintTextures(folder, mode) {
    const textures = await loadTextureManifest(folder);
    PAINT_TEXTURES[mode] = textures;
    texturePaletteSignature = "";
    syncUi();
}

async function loadWallTextures() {
    await loadPaintTextures("walls", "walls");
}

async function loadRoofTextures() {
    await loadPaintTextures("roofs", "roofs");
}

async function loadFloorTextures() {
    await loadPaintTextures("flooring", "floor");
}

function mergeMountedAssetDefaults(category, defaults, item) {
    const asset = { ...(defaults || {}), ...(item || {}) };
    const anchor = asset.anchor || (defaults && defaults.anchor) || {};
    const width = Number(asset.width);
    const height = Number(asset.height);
    if (typeof asset.texturePath !== "string" || asset.texturePath.length === 0) {
        throw new Error(`${category} asset is missing texturePath`);
    }
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        throw new Error(`${category} asset ${asset.texturePath} requires positive width and height`);
    }
    return {
        category,
        texturePath: asset.texturePath,
        width,
        height,
        renderDepthOffset: Number.isFinite(Number(asset.renderDepthOffset)) ? Number(asset.renderDepthOffset) : 0,
        anchorX: Number.isFinite(Number(anchor.x)) ? Number(anchor.x) : 0.5,
        anchorY: Number.isFinite(Number(anchor.y)) ? Number(anchor.y) : (category === "windows" ? 0.5 : 1),
        isOpen: asset.isOpen === true,
        isPassable: asset.isPassable !== false,
        blocksTile: asset.blocksTile === true,
        castsLosShadows: asset.castsLosShadows === true,
        compositeLayers: Array.isArray(asset.compositeLayers) ? asset.compositeLayers : null
    };
}

async function loadMountedObjectAssets(category) {
    const manifestResponse = await fetch(`/assets/images/${encodeURIComponent(category)}/items.json`, { cache: "no-cache" });
    if (!manifestResponse.ok) {
        throw new Error(`could not load ${category} asset manifest`);
    }
    const payload = await manifestResponse.json();
    const directoryResponse = await fetch("/api/placeables", { cache: "no-cache" });
    if (!directoryResponse.ok) {
        throw new Error(`could not load ${category} image directory`);
    }
    const directoryPayload = await directoryResponse.json();
    const directoryTextures = normalizeImagePathList(
        directoryPayload && directoryPayload.categories && directoryPayload.categories[category],
        category
    );
    const items = Array.isArray(payload.items) ? payload.items : [];
    const texturePaths = new Set(items.map((item) => String(item && item.texturePath || "")));
    const unlistedItems = directoryTextures
        .filter((texturePath) => !texturePaths.has(texturePath))
        .map((texturePath) => ({ texturePath }));
    const assets = [...items, ...unlistedItems]
        .map((item) => mergeMountedAssetDefaults(category, payload.defaults, item))
        .sort((a, b) => textureName(a.texturePath).localeCompare(textureName(b.texturePath)));
    if (!assets.length) throw new Error(`${category} asset manifest and image directory are empty`);
    MOUNTED_OBJECT_ASSETS[category] = assets;
    if (!state.mountedObjectTool.assets[category]) {
        const firstAsset = MOUNTED_OBJECT_ASSETS[category][0];
        state.mountedObjectTool.assets[category] = {
            ...firstAsset,
            baseWidth: firstAsset.width,
            baseHeight: firstAsset.height
        };
        state.mountedObjectTool.settings[category] = {
            size: firstAsset.height,
            aspectRatio: firstAsset.width / firstAsset.height,
            snapPointsPerSection: state.mountedObjectSnapPointsPerSection(category)
        };
    }
    mountTexturePaletteSignature = "";
    syncUi();
}

function worldFromEvent(event) {
    const global = event.data.global;
    return renderer.screenToWorld({ x: global.x, y: global.y });
}

function screenPointFromClient(clientX, clientY) {
    const rect = stageHost.getBoundingClientRect();
    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
}

function midpoint(a, b) {
    return {
        x: (a.x + b.x) * 0.5,
        y: (a.y + b.y) * 0.5
    };
}

function pointDistance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function zoomAtScreenPoint(screenPoint, nextZoom) {
    const worldBefore = renderer.screenToWorld(screenPoint);
    state.camera.zoom = Math.max(24, Math.min(180, nextZoom));
    const worldAfter = renderer.screenToWorld(screenPoint);
    state.camera.x += worldBefore.x - worldAfter.x;
    state.camera.y += worldBefore.y - worldAfter.y;
    renderer.render();
}

function wheelDeltaPixels(event) {
    let scale = 1;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        scale = 16;
    } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        scale = Math.max(1, stageHost.clientHeight);
    }
    return {
        x: event.deltaX * scale,
        y: event.deltaY * scale
    };
}

function rotateViewFromScreenX(screenX) {
    if (Number.isFinite(rotatePointerX)) {
        state.camera.rotation = (Number(state.camera.rotation) || 0) + (Number(screenX) - rotatePointerX) * 0.006;
        renderer.render();
    }
    rotatePointerX = Number(screenX);
}

function rotateCameraPitchFromWheel(deltaY) {
    state.camera.pitch = renderer.clampCameraPitch(
        (Number.isFinite(Number(state.camera.pitch)) ? Number(state.camera.pitch) : renderer.defaultCameraPitch()) +
        Number(deltaY) * CAMERA_PITCH_WHEEL_SPEED
    );
    renderer.render();
}

function resetCameraOrientation() {
    state.camera.rotation = 0;
    state.camera.pitch = renderer.defaultCameraPitch();
    rotatePointerX = null;
    state.updateCameraRotationCenter();
    renderer.render();
    setStatus("view orientation reset");
}

function resetAndCenterBuildingView() {
    state.camera.rotation = 0;
    state.camera.pitch = renderer.defaultCameraPitch();
    rotatePointerX = null;
    state.centerCameraOnBuilding();
    renderer.render();
    setStatus("building centered");
}

function activeTool() {
    return tools[state.tool] || tools.select;
}

function draftConsumesEscape(draft) {
    return draft && (draft.kind === "polygonEdit" || draft.kind === "wall" || draft.kind === "stair");
}

function activePaintMode() {
    if (state.tool === "wall") return "walls";
    if (state.tool === "column") return "walls";
    if (state.tool === "stair") return "floor";
    const kind = state.selection && state.selection.kind;
    if (kind === "gable" || kind === "gableHandle") return "walls";
    if (kind === "roof" || kind === "roofVertex" || kind === "roofPeak" || kind === "roofShedDirection") return "roofs";
    return kind === "wall" || kind === "wallEndpoint" || kind === "column" ? "walls" : "floor";
}

function selectionCanUsePaintTool() {
    if (state.tool === "wall" || state.tool === "column" || state.tool === "stair") return true;
    const kind = state.selection && state.selection.kind;
    return kind === "floor" || kind === "floorVertex" || kind === "roof" || kind === "roofVertex" || kind === "roofPeak" || kind === "roofShedDirection" || kind === "gable" || kind === "gableHandle" || kind === "wall" || kind === "wallEndpoint" || kind === "column" || kind === "stair";
}

function mountedObjectSettingsActive() {
    return state.tool === "mountObject" || (state.selection && state.selection.kind === "mountedObject");
}

function activeMountedObjectCategory() {
    const object = state.selectedMountedObjects()[0] || null;
    const objectCategory = object && String(object.category || "").trim().toLowerCase();
    if (objectCategory === "doors" || objectCategory === "windows") return objectCategory;
    return state.mountedObjectTool.category || "doors";
}

function aspectRatioToSliderValue(aspectRatio) {
    const value = Number(aspectRatio);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.log(value) / Math.log(MOUNT_ASPECT_LOG_BASE);
}

function sliderValueToAspectRatio(sliderValue) {
    const value = Number(sliderValue);
    if (!Number.isFinite(value)) throw new Error("door/window aspect ratio slider must be finite");
    return Math.pow(MOUNT_ASPECT_LOG_BASE, value);
}

function isWindowObject(object) {
    return object && String(object.category || "").trim().toLowerCase() === "windows";
}

function mountedObjectHorizontalPoint(object) {
    const x = Number(object && object.x);
    const y = Number(object && object.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    const placement = renderer.mountedObjectPlacement(object);
    if (placement && placement.faceCenter) return placement.faceCenter;
    throw new Error(`window ${object && object.id} is missing horizontal placement`);
}

function windowSelectionModeFromEvent(event, fallbackMode) {
    if (event && (event.ctrlKey || event.metaKey)) return "remove";
    if (event && event.shiftKey) return "add";
    return fallbackMode || "replace";
}

function windowGroupForContext(group) {
    if (!windowContext || windowContext.type !== "window" || windowContext.objectId === undefined || windowContext.objectId === null) {
        throw new Error("window context menu is missing its source window");
    }
    const source = getBuildingMountedObjects(state.building)
        .find((object) => String(object.id) === String(windowContext.objectId));
    if (!source || !isWindowObject(source)) {
        throw new Error("window context menu source is no longer a window");
    }
    const windows = getBuildingMountedObjects(state.building).filter(isWindowObject);
    if (group === "level") {
        return windows.filter((object) => String(object.floorId) === String(source.floorId));
    }
    if (group === "column") {
        const sourcePoint = mountedObjectHorizontalPoint(source);
        const tolerance = 0.08;
        return windows.filter((object) => {
            const point = mountedObjectHorizontalPoint(object);
            return Math.hypot(point.x - sourcePoint.x, point.y - sourcePoint.y) <= tolerance;
        });
    }
    if (group === "texture") {
        return windows.filter((object) => object.texturePath === source.texturePath);
    }
    if (group === "all") {
        return windows;
    }
    throw new Error(`unknown window selection group: ${group}`);
}

function wallCenterlineForContext(wall) {
    const floor = findFloor(state.building, wall && wall.floorId);
    if (!floor) throw new Error(`wall context menu source is missing its level: ${wall && wall.floorId}`);
    return wallCenterlinePoints(state.building, wall, floor);
}

function sameWallColumn(a, b) {
    const aPoints = wallCenterlineForContext(a);
    const bPoints = wallCenterlineForContext(b);
    if (aPoints.length !== 2 || bPoints.length !== 2) {
        throw new Error("wall column selection requires two-point wall centerlines");
    }
    const tolerance = 0.08;
    const samePoint = (p, q) => Math.hypot(Number(p.x) - Number(q.x), Number(p.y) - Number(q.y)) <= tolerance;
    return (samePoint(aPoints[0], bPoints[0]) && samePoint(aPoints[1], bPoints[1])) ||
        (samePoint(aPoints[0], bPoints[1]) && samePoint(aPoints[1], bPoints[0]));
}

function wallGroupForContext(group) {
    if (!windowContext || windowContext.type !== "wall" || windowContext.wallId === undefined || windowContext.wallId === null) {
        throw new Error("wall context menu is missing its source wall");
    }
    const source = getBuildingWalls(state.building)
        .find((wall) => String(wall.id) === String(windowContext.wallId));
    if (!source) {
        throw new Error("wall context menu source is no longer a wall");
    }
    const walls = getBuildingWalls(state.building);
    if (group === "level") {
        return walls.filter((wall) => String(wall.floorId) === String(source.floorId));
    }
    if (group === "column") {
        return walls.filter((wall) => sameWallColumn(source, wall));
    }
    if (group === "texture") {
        return walls.filter((wall) => wall.wallTexturePath === source.wallTexturePath);
    }
    if (group === "all") {
        return walls;
    }
    throw new Error(`unknown wall selection group: ${group}`);
}

function sameHorizontalPoint(a, b, tolerance = 0.08) {
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) <= tolerance;
}

function columnGroupForContext(group) {
    if (!windowContext || windowContext.type !== "column" || windowContext.columnId === undefined || windowContext.columnId === null) {
        throw new Error("column context menu is missing its source column");
    }
    const source = getBuildingColumns(state.building)
        .find((column) => String(column.id) === String(windowContext.columnId));
    if (!source) {
        throw new Error("column context menu source is no longer a column");
    }
    const columns = getBuildingColumns(state.building);
    if (group === "level") {
        return columns.filter((column) => String(column.floorId) === String(source.floorId));
    }
    if (group === "column") {
        return columns.filter((column) => sameHorizontalPoint(column.position, source.position));
    }
    if (group === "texture") {
        return columns.filter((column) => column.texturePath === source.texturePath);
    }
    if (group === "all") {
        return columns;
    }
    throw new Error(`unknown column selection group: ${group}`);
}

function sameBeamColumn(a, b) {
    const aPoints = state.beamWorldPoints(a);
    const bPoints = state.beamWorldPoints(b);
    if (!aPoints || !bPoints) {
        throw new Error("beam column selection requires resolvable beam endpoints");
    }
    return (sameHorizontalPoint(aPoints.start, bPoints.start) && sameHorizontalPoint(aPoints.end, bPoints.end)) ||
        (sameHorizontalPoint(aPoints.start, bPoints.end) && sameHorizontalPoint(aPoints.end, bPoints.start));
}

function beamGroupForContext(group) {
    if (!windowContext || windowContext.type !== "beam" || windowContext.beamId === undefined || windowContext.beamId === null) {
        throw new Error("beam context menu is missing its source beam");
    }
    const source = getBuildingBeams(state.building)
        .find((beam) => String(beam.id) === String(windowContext.beamId));
    if (!source) {
        throw new Error("beam context menu source is no longer a beam");
    }
    const beams = getBuildingBeams(state.building);
    if (group === "level") {
        return beams.filter((beam) => String(beam.floorId) === String(source.floorId));
    }
    if (group === "column") {
        return beams.filter((beam) => sameBeamColumn(source, beam));
    }
    if (group === "texture") {
        return beams.filter((beam) => beam.texturePath === source.texturePath);
    }
    if (group === "all") {
        return beams;
    }
    throw new Error(`unknown beam selection group: ${group}`);
}

function applyWindowContextSelection(group, mode) {
    if (!windowContext) throw new Error("selection context menu is missing its source");
    const preserveView = state.renderStyle() === "exterior";
    if (windowContext.type === "wall") {
        const wallIds = wallGroupForContext(group).map((wall) => wall.id);
        if (!wallIds.length) return;
        if (mode === "remove") {
            state.removeWallsFromSelection(wallIds, { preserveView });
            return;
        }
        if (mode === "add") {
            state.addWallsToSelection(wallIds, { preserveView });
            return;
        }
        state.selectWalls(wallIds, { preserveView });
        return;
    }
    if (windowContext.type === "column") {
        const columnIds = columnGroupForContext(group).map((column) => column.id);
        if (!columnIds.length) return;
        if (mode === "remove") {
            state.removeColumnsFromSelection(columnIds, { preserveView });
            return;
        }
        if (mode === "add") {
            state.addColumnsToSelection(columnIds, { preserveView });
            return;
        }
        state.selectColumns(columnIds, { preserveView });
        return;
    }
    if (windowContext.type === "beam") {
        const beamIds = beamGroupForContext(group).map((beam) => beam.id);
        if (!beamIds.length) return;
        if (mode === "remove") {
            state.removeBeamsFromSelection(beamIds, { preserveView });
            return;
        }
        if (mode === "add") {
            state.addBeamsToSelection(beamIds, { preserveView });
            return;
        }
        state.selectBeams(beamIds, { preserveView });
        return;
    }
    const objectIds = windowGroupForContext(group).map((object) => object.id);
    if (!objectIds.length) return;
    if (mode === "remove") {
        state.removeMountedObjectsFromSelection(objectIds, { preserveView });
        return;
    }
    if (mode === "add") {
        state.addMountedObjectsToSelection(objectIds, { preserveView });
        return;
    }
    state.selectMountedObjects(objectIds, { preserveView });
}

function showWindowContextMenu(screenPoint, sourceObject, mode) {
    closeLayerContextMenu();
    closeStructureToolMenu();
    windowContext = {
        type: "window",
        objectId: sourceObject.id,
        mode
    };
    const left = Math.max(8, Math.min(Number(screenPoint.x), window.innerWidth - 170));
    const top = Math.max(8, Math.min(Number(screenPoint.y), window.innerHeight - 170));
    windowContextMenu.style.left = `${left}px`;
    windowContextMenu.style.top = `${top}px`;
    windowContextMenu.hidden = false;
}

function showWallContextMenu(screenPoint, sourceWall, mode) {
    closeLayerContextMenu();
    closeStructureToolMenu();
    windowContext = {
        type: "wall",
        wallId: sourceWall.id,
        mode
    };
    const left = Math.max(8, Math.min(Number(screenPoint.x), window.innerWidth - 170));
    const top = Math.max(8, Math.min(Number(screenPoint.y), window.innerHeight - 170));
    windowContextMenu.style.left = `${left}px`;
    windowContextMenu.style.top = `${top}px`;
    windowContextMenu.hidden = false;
}

function showColumnContextMenu(screenPoint, sourceColumn, mode) {
    closeLayerContextMenu();
    closeStructureToolMenu();
    windowContext = {
        type: "column",
        columnId: sourceColumn.id,
        mode
    };
    const left = Math.max(8, Math.min(Number(screenPoint.x), window.innerWidth - 170));
    const top = Math.max(8, Math.min(Number(screenPoint.y), window.innerHeight - 170));
    windowContextMenu.style.left = `${left}px`;
    windowContextMenu.style.top = `${top}px`;
    windowContextMenu.hidden = false;
}

function showBeamContextMenu(screenPoint, sourceBeam, mode) {
    closeLayerContextMenu();
    closeStructureToolMenu();
    windowContext = {
        type: "beam",
        beamId: sourceBeam.id,
        mode
    };
    const left = Math.max(8, Math.min(Number(screenPoint.x), window.innerWidth - 170));
    const top = Math.max(8, Math.min(Number(screenPoint.y), window.innerHeight - 170));
    windowContextMenu.style.left = `${left}px`;
    windowContextMenu.style.top = `${top}px`;
    windowContextMenu.hidden = false;
}

function closeWindowContextMenu() {
    windowContextMenu.hidden = true;
    windowContext = null;
}

function openLayerContextMenu(floorId, clientX, clientY) {
    if (!findFloor(state.building, floorId)) {
        throw new Error(`cannot open layer menu for missing floor: ${floorId}`);
    }
    closeWindowContextMenu();
    closeStructureToolMenu();
    layerContextFloorId = String(floorId);
    layerContextMenu.hidden = false;
    const rect = layerContextMenu.getBoundingClientRect();
    const left = Math.max(8, Math.min(Number(clientX), window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(Number(clientY), window.innerHeight - rect.height - 8));
    layerContextMenu.style.left = `${left}px`;
    layerContextMenu.style.top = `${top}px`;
}

function closeLayerContextMenu() {
    layerContextMenu.hidden = true;
    layerContextFloorId = "";
}

function normalizeStructureTool(tool) {
    const value = String(tool || "").trim();
    if (value === "wall" || value === "column" || value === "beam") return value;
    throw new Error(`unknown structure tool: ${tool}`);
}

function structureToolLabel(tool) {
    const value = normalizeStructureTool(tool);
    if (value === "column") return "columns";
    if (value === "beam") return "beams";
    return "walls";
}

function cancelStructureToolPressTimer() {
    if (structureToolPressTimer) {
        clearTimeout(structureToolPressTimer);
        structureToolPressTimer = null;
    }
}

function closeStructureToolMenu() {
    cancelStructureToolPressTimer();
    if (structureToolMenu) structureToolMenu.hidden = true;
    if (structureToolButton) structureToolButton.setAttribute("aria-expanded", "false");
}

function positionStructureToolMenu() {
    if (!structureToolMenu || !structureToolButton || structureToolMenu.hidden) return;
    const buttonRect = structureToolButton.getBoundingClientRect();
    const menuRect = structureToolMenu.getBoundingClientRect();
    const left = Math.max(8, Math.min(buttonRect.right + 8, window.innerWidth - menuRect.width - 8));
    const top = Math.max(8, Math.min(
        buttonRect.top + (buttonRect.height - menuRect.height) * 0.5,
        window.innerHeight - menuRect.height - 8
    ));
    structureToolMenu.style.left = `${left}px`;
    structureToolMenu.style.top = `${top}px`;
}

function openStructureToolMenu() {
    if (!structureToolMenu) return;
    closeWindowContextMenu();
    closeLayerContextMenu();
    wallToolTexturePaletteOpen = false;
    columnToolTexturePaletteOpen = false;
    stairTexturePaletteOpen = false;
    mountTexturePaletteOpen = false;
    structureToolMenu.hidden = false;
    if (structureToolButton) structureToolButton.setAttribute("aria-expanded", "true");
    positionStructureToolMenu();
    syncStructureToolButton();
}

function selectStructureTool(tool, options = {}) {
    const nextTool = normalizeStructureTool(tool);
    activeStructureTool = nextTool;
    closeStructureToolMenu();
    wallToolTexturePaletteOpen = false;
    columnToolTexturePaletteOpen = false;
    stairTexturePaletteOpen = false;
    mountTexturePaletteOpen = false;
    if (options.toggle === true && state.tool === nextTool) {
        state.setTool("select");
        return;
    }
    state.setTool(nextTool);
}

function syncStructureToolButton() {
    if (state.tool === "wall" || state.tool === "column" || state.tool === "beam") {
        activeStructureTool = state.tool;
    }
    structureToolMenuButtons.forEach((button) => {
        button.dataset.active = button.dataset.structureTool === activeStructureTool ? "true" : "false";
    });
    if (!structureToolButton || !structureToolIcon) return;
    const sourceIcon = activeStructureTool === "column"
        ? columnToolIcon
        : (activeStructureTool === "beam" ? beamToolIcon : wallToolIcon);
    structureToolIcon.replaceChildren();
    if (sourceIcon) {
        const clone = sourceIcon.cloneNode(true);
        clone.removeAttribute("id");
        structureToolIcon.appendChild(clone);
    }
    const title = `Place ${structureToolLabel(activeStructureTool)}`;
    structureToolButton.title = title;
    structureToolButton.setAttribute("aria-label", title);
    structureToolButton.dataset.active = (state.tool === "wall" || state.tool === "column" || state.tool === "beam") ? "true" : "false";
}

function applyTextureToSelection(texturePath) {
    if (state.tool === "wall") {
        state.updateWallToolTexture(texturePath);
        return;
    }
    if (state.tool === "column") {
        state.updateColumnToolTexture(texturePath);
        return;
    }
    if (state.tool === "stair") {
        state.updateStairToolTexture(texturePath, stairTexturePalettePart);
        return;
    }
    if (state.tool === "roof") {
        state.updateRoofToolTexture(texturePath);
        return;
    }
    const kind = state.selection && state.selection.kind;
    if (kind === "wall" || kind === "wallEndpoint") {
        state.updateSelectedWallTexture(texturePath);
        return;
    }
    if (kind === "floor" || kind === "floorVertex") {
        state.updateSelectedFloorTexture(texturePath);
        return;
    }
    if (kind === "gable" || kind === "gableHandle") {
        state.updateSelectedGableWallTexture(texturePath);
        return;
    }
    if (kind === "roof") {
        state.updateSelectedRoofTexture(texturePath);
        return;
    }
    if (kind === "column") {
        state.updateSelectedColumnTexture(texturePath);
        return;
    }
    if (kind === "stair") {
        state.updateSelectedStairTexture(texturePath, stairTexturePalettePart);
        return;
    }
    throw new Error(`cannot paint texture for ${kind || "empty"} selection`);
}

function selectionScopeMatches(element) {
    if (mountedObjectSettingsActive()) return false;
    if (state.tool === "polygon" || state.tool === "scissors") return false;
    const exclude = element.dataset.selectionExclude;
    const kind = state.selection && state.selection.kind;
    if (exclude && exclude.split(/\s+/).includes(kind)) return false;
    const scope = element.dataset.selectionScope;
    if (!scope) return true;
    if (state.tool === "wall") {
        return scope.split(/\s+/).includes("wall");
    }
    if (state.tool === "column") {
        return scope.split(/\s+/).includes("column");
    }
    if (state.tool === "stair") {
        return scope.split(/\s+/).includes("stair");
    }
    if (state.tool === "roof") {
        return scope.split(/\s+/).includes("roof");
    }
    return scope.split(/\s+/).includes(kind);
}

function activeRoofMode(selectedRoofEntries) {
    if (state.tool === "roof") return state.inputs.roofMode || DEFAULTS.roofMode;
    if (!Array.isArray(selectedRoofEntries) || selectedRoofEntries.length === 0) return "";
    return sharedSelectionValue(selectedRoofEntries, ({ roof }) => roof.mode || DEFAULTS.roofMode) || "";
}

function toolScopeMatches(element) {
    const include = element.dataset.toolScope;
    const activeScopes = [state.tool];
    if (mountedObjectSettingsActive()) activeScopes.push("mountObject");
    if (state.selection && state.selection.kind === "column") activeScopes.push("column");
    if (state.selection && state.selection.kind === "stair") activeScopes.push("stair");
    if (include && !include.split(/\s+/).some((scope) => activeScopes.includes(scope))) return false;
    const exclude = element.dataset.toolExclude;
    if (exclude && exclude.split(/\s+/).some((scope) => activeScopes.includes(scope))) return false;
    const selectionExclude = element.dataset.selectionExclude;
    const kind = state.selection && state.selection.kind;
    if (selectionExclude && selectionExclude.split(/\s+/).includes(kind)) return false;
    return true;
}

function selectedWallsFrom(walls) {
    return state.selectedWallIds().map((wallId) => {
        const wall = walls.find((candidate) => String(candidate.id) === String(wallId));
        if (!wall) throw new Error(`selected wall is missing from editor wall list: ${wallId}`);
        return wall;
    });
}

function sharedSelectionValue(items, readValue) {
    if (!items.length) return null;
    const firstValue = readValue(items[0]);
    return items.every((item) => readValue(item) === firstValue) ? firstValue : null;
}

function syncRangeAndValueInput(rangeInput, valueInput, sharedValue, fallbackValue, format = (value) => String(value)) {
    const rangeValue = sharedValue !== null && sharedValue !== undefined ? sharedValue : fallbackValue;
    if (rangeInput && rangeValue !== null && rangeValue !== undefined && Number.isFinite(Number(rangeValue))) {
        rangeInput.value = Number(rangeValue);
    }
    if (!valueInput) return;
    valueInput.value = sharedValue !== null && sharedValue !== undefined && Number.isFinite(Number(sharedValue))
        ? format(Number(sharedValue))
        : "";
}

function syncNumberInput(input, sharedValue, format = (value) => String(value)) {
    if (!input) return;
    input.value = sharedValue !== null && sharedValue !== undefined && Number.isFinite(Number(sharedValue))
        ? format(Number(sharedValue))
        : "";
}

function columnDepthValue(column) {
    return Number(column.depth ?? Number(column.size) * 2);
}

function columnWidthValueFor(column) {
    return Number(column.width ?? Number(column.size) * 2);
}

function stairRiserDepthValueFor(stair) {
    const explicit = Number(stair && stair.riserDepth);
    if (Number.isFinite(explicit)) return explicit;
    const height = Number(stair && stair.height);
    const stepCount = Math.max(1, Math.round(Number(stair && stair.stepCount) || 1));
    if (!Number.isFinite(height) || height <= 0) return NaN;
    return Math.min(height, height / (stepCount + 1) + 0.25);
}

function columnExplicitHeightValue(column) {
    const mode = String(column.heightMode || (column.wallId !== null && column.wallId !== undefined ? "wall" : "fixed")).trim().toLowerCase();
    return mode === "wall" ? null : Number(column.height);
}

function mountedObjectAspectRatioValue(object) {
    const width = Number(object.width);
    const height = Number(object.height);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        throw new Error("selected door/window requires positive width and height");
    }
    return width / height;
}

function syncMountedToolButtonTextures() {
    mountToolButtons.forEach((button) => {
        const category = button.dataset.mountCategory;
        const asset = state.mountedObjectTool.assets[category];
        if (!asset || !asset.texturePath) return;
        const img = button.querySelector("img");
        if (!img) return;
        img.src = asset.texturePath;
        img.alt = "";
        button.title = category === "windows"
            ? `Place windows: ${textureName(asset.texturePath)}`
            : `Place doors: ${textureName(asset.texturePath)}`;
    });
}

function syncWallToolButtonTexture() {
    if (!wallToolIcon) return;
    const texture = state.wallTool && state.wallTool.texture ? state.wallTool.texture : state.inputs.wallTexture;
    wallToolIcon.style.backgroundImage = texture ? `url("${texture}")` : "";
    const wallButton = structureToolMenuButtons.find((button) => button.dataset.structureTool === "wall");
    if (wallButton) wallButton.title = texture ? `Place walls: ${textureName(texture)}` : "Place walls";
}

function syncBeamToolButtonTexture() {
    if (!beamToolIcon) return;
    const texture = state.wallTool && state.wallTool.texture ? state.wallTool.texture : state.inputs.wallTexture;
    beamToolIcon.style.setProperty("--beam-tool-texture", texture ? `url("${texture}")` : "none");
    const beamButton = structureToolMenuButtons.find((button) => button.dataset.structureTool === "beam");
    if (beamButton) beamButton.title = texture ? `Place beams: ${textureName(texture)}` : "Place beams";
}

function syncColumnToolButtonTexture() {
    if (!columnToolIcon) return;
    const texture = state.columnTool && state.columnTool.texture ? state.columnTool.texture : state.inputs.columnTexture;
    columnToolIcon.style.setProperty("--column-tool-texture", texture ? `url("${texture}")` : "none");
    const columnButton = structureToolMenuButtons.find((button) => button.dataset.structureTool === "column");
    if (columnButton) columnButton.title = texture ? `Place columns: ${textureName(texture)}` : "Place columns";
}

function syncStairToolButtonTexture() {
    if (!stairToolIcon) return;
    const texture = state.stairTool && (state.stairTool.treadTexture || state.stairTool.texture) ? (state.stairTool.treadTexture || state.stairTool.texture) : state.inputs.stairTexture;
    stairToolIcon.style.setProperty("--stair-tool-texture", texture ? `url("${texture}")` : "none");
    if (stairToolButton) stairToolButton.title = texture ? `Place stairs: ${textureName(texture)}` : "Place stairs";
}

function syncRoofToolButtonTexture() {
    if (!roofToolButton || !roofToolIcon) return;
    const texture = state.paintTextureForMode("roofs") || state.inputs.roofTexture;
    roofToolIcon.style.setProperty("--roof-tool-texture", texture ? `url("${texture}")` : "");
    roofToolButton.title = texture ? `Place roofs: ${textureName(texture)}` : "Place roofs";
    roofToolButton.disabled = false;
}

function syncSelectOptions(select, values) {
    const current = select.value;
    select.innerHTML = "";
    values.forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value.split("/").pop();
        select.appendChild(option);
    });
    if (values.includes(current)) {
        select.value = current;
    }
}

function polygonBounds(rings) {
    const points = rings.flat();
    if (!points.length) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    return points.reduce((acc, point) => ({
        minX: Math.min(acc.minX, Number(point.x)),
        minY: Math.min(acc.minY, Number(point.y)),
        maxX: Math.max(acc.maxX, Number(point.x)),
        maxY: Math.max(acc.maxY, Number(point.y))
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function scaledPreviewPoints(points, bounds) {
    const width = Math.max(0.0001, bounds.maxX - bounds.minX);
    const height = Math.max(0.0001, bounds.maxY - bounds.minY);
    const scale = Math.min(76 / width, 30 / height);
    const offsetX = (92 - width * scale) * 0.5;
    const offsetY = (42 - height * scale) * 0.5;
    return points.map((point) => {
        const x = offsetX + (Number(point.x) - bounds.minX) * scale;
        const y = offsetY + (bounds.maxY - Number(point.y)) * scale;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
}

function createLayerPreview(floor) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "layerPreview");
    svg.setAttribute("viewBox", "0 0 92 42");
    svg.setAttribute("aria-hidden", "true");
    const rings = [floor.outerPolygon || [], ...(Array.isArray(floor.holes) ? floor.holes : [])].filter((ring) => ring.length >= 3);
    const bounds = polygonBounds(rings);
    rings.forEach((ring, index) => {
        const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        polygon.setAttribute("points", scaledPreviewPoints(ring, bounds));
        polygon.setAttribute("fill", index === 0 ? "#4d8b8f" : "#101820");
        polygon.setAttribute("fill-opacity", index === 0 ? "0.64" : "1");
        polygon.setAttribute("stroke", index === 0 ? "#9fe4d5" : "#ff9c85");
        polygon.setAttribute("stroke-width", index === 0 ? "2" : "1.5");
        svg.appendChild(polygon);
    });
    return svg;
}

function createLayerCard({ floor = null, selectAll = false, selected = false, allSelected = false }) {
    const card = document.createElement("div");
    card.className = "layerCard";
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.dataset.selected = selected ? "true" : "false";
    if (selectAll) {
        card.dataset.layerSelectAll = "true";
        card.dataset.allSelected = allSelected ? "true" : "false";
    } else {
        card.dataset.floorId = getFloorId(floor);
    }

    if (selectAll) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "layerPreview");
        svg.setAttribute("viewBox", "0 0 92 42");
        svg.setAttribute("aria-hidden", "true");
        [[10, 10, 72, 22], [16, 7, 60, 28], [22, 4, 48, 34]].forEach(([x, y, w, h], index) => {
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("x", String(x));
            rect.setAttribute("y", String(y));
            rect.setAttribute("width", String(w));
            rect.setAttribute("height", String(h));
            rect.setAttribute("fill", index === 0 ? "#4d8b8f" : "none");
            rect.setAttribute("fill-opacity", "0.28");
            rect.setAttribute("stroke", "#9fe4d5");
            rect.setAttribute("stroke-width", "1.5");
            svg.appendChild(rect);
        });
        card.appendChild(svg);
    } else {
        card.appendChild(createLayerPreview(floor));
    }

    const label = document.createElement("span");
    const name = document.createElement("span");
    name.className = "layerName";
    name.textContent = selectAll ? "whole building" : (floor.name || getFloorId(floor));
    if (!selectAll) name.dataset.renameFloorId = getFloorId(floor);
    const meta = document.createElement("span");
    meta.className = "layerMeta";
    meta.textContent = selectAll ? "exterior view" : `z ${getFloorElevation(floor)} h ${Number(floor.floorHeight)}`;
    label.appendChild(name);
    label.appendChild(meta);
    card.appendChild(label);
    return card;
}

function createLayerRow(floor, selected) {
    const row = document.createElement("div");
    row.className = "layerRow";
    row.draggable = true;
    row.dataset.floorRowId = getFloorId(floor);
    row.appendChild(createLayerCard({ floor, selected }));
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "layerDeleteButton";
    deleteButton.dataset.deleteFloorId = getFloorId(floor);
    deleteButton.title = `Delete ${getFloorId(floor)}`;
    deleteButton.setAttribute("aria-label", `Delete ${getFloorId(floor)}`);
    deleteButton.textContent = "×";
    row.appendChild(deleteButton);
    return row;
}

function textureName(path) {
    return String(path || "").split("/").pop() || String(path || "");
}

function renderTexturePalette() {
    const mode = activePaintMode();
    const textures = PAINT_TEXTURES[mode] || [];
    const selectedColumn = state.selectedColumn();
    const selectedStairTexture = state.selection && state.selection.kind === "stair"
        ? sharedSelectionValue(state.selectedStairs(), (stair) => stairTexturePalettePart === "riser"
            ? (stair.riserTexturePath || stair.texturePath)
            : (stair.treadTexturePath || stair.texturePath))
        : null;
    const selected = state.tool === "wall"
        ? state.wallTool.texture
        : (state.tool === "column"
            ? state.columnTool.texture
            : (state.tool === "stair"
                ? (stairTexturePalettePart === "riser"
                    ? state.stairTool.riserTexture
                    : (state.stairTool.treadTexture || state.stairTool.texture))
                : (selectedStairTexture && mode === "floor"
                    ? selectedStairTexture
                    : (selectedColumn && mode === "walls" ? selectedColumn.texturePath : state.paintTextureForMode(mode)))));
    if (state.tool !== "wall") wallToolTexturePaletteOpen = false;
    if (state.tool !== "column") columnToolTexturePaletteOpen = false;
    if (state.tool !== "stair" && (!state.selection || state.selection.kind !== "stair")) stairTexturePaletteOpen = false;
    texturePalette.hidden = !((state.tool === "paint" || wallToolTexturePaletteOpen || columnToolTexturePaletteOpen || stairTexturePaletteOpen) && selectionCanUsePaintTool());
    texturePalette.setAttribute("aria-label", `${mode === "walls" ? "wall" : (mode === "roofs" ? "roof" : "floor")} textures`);
    texturePalette.style.setProperty("--texture-column-count", String(Math.max(1, textures.length)));
    positionTexturePalette();
    const signature = `${mode}:${textures.join("|")}`;
    if (signature === texturePaletteSignature) {
        texturePalette.querySelectorAll(".textureSwatch").forEach((button) => {
            button.dataset.selected = button.dataset.texturePath === selected ? "true" : "false";
        });
        return;
    }
    texturePaletteSignature = signature;
    texturePalette.innerHTML = "";
    textures.forEach((texturePath) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "textureSwatch";
        button.dataset.texturePath = texturePath;
        button.dataset.selected = texturePath === selected ? "true" : "false";
        button.title = textureName(texturePath);
        const img = document.createElement("img");
        img.src = texturePath;
        img.alt = "";
        button.appendChild(img);
        texturePalette.appendChild(button);
    });
}

function positionTexturePalette() {
    const anchor = stairTexturePaletteOpen
        ? stairTextureButtons.find((button) => button.dataset.stairTexturePart === stairTexturePalettePart)
        : paintToolButton;
    if (texturePalette.hidden || !anchor) return;
    const buttonRect = anchor.getBoundingClientRect();
    const left = Math.min(buttonRect.right + 8, window.innerWidth - 48);
    const top = Math.max(8, Math.min(buttonRect.top, window.innerHeight - 64));
    texturePalette.style.left = `${left}px`;
    texturePalette.style.top = `${top}px`;
    texturePalette.style.maxWidth = `calc(100vw - ${left + 8}px)`;
    texturePalette.style.maxHeight = `calc(100vh - ${top + 8}px)`;
}

function renderMountTexturePalette() {
    const category = activeMountedObjectCategory();
    const assets = MOUNTED_OBJECT_ASSETS[category] || [];
    const selectedObject = state.selectedMountedObject();
    const selected = selectedObject || state.mountedObjectTool.assets[category];
    if (!mountedObjectSettingsActive()) mountTexturePaletteOpen = false;
    mountTexturePalette.hidden = !mountedObjectSettingsActive() || !mountTexturePaletteOpen;
    mountTexturePalette.setAttribute("aria-label", `${category} textures`);
    mountTexturePalette.style.setProperty("--texture-column-count", String(Math.max(1, Math.min(4, assets.length))));
    positionMountTexturePalette();
    const signature = `${category}:${assets.map((asset) => asset.texturePath).join("|")}`;
    if (signature === mountTexturePaletteSignature) {
        mountTexturePalette.querySelectorAll(".textureSwatch").forEach((button) => {
            button.dataset.selected = selected && button.dataset.texturePath === selected.texturePath ? "true" : "false";
        });
        return;
    }
    mountTexturePaletteSignature = signature;
    mountTexturePalette.innerHTML = "";
    assets.forEach((asset) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "textureSwatch";
        button.dataset.texturePath = asset.texturePath;
        button.dataset.selected = selected && selected.texturePath === asset.texturePath ? "true" : "false";
        button.title = textureName(asset.texturePath);
        const img = document.createElement("img");
        img.src = asset.texturePath;
        img.alt = "";
        button.appendChild(img);
        mountTexturePalette.appendChild(button);
    });
}

function positionMountTexturePalette() {
    if (mountTexturePalette.hidden || !mountTextureButton) return;
    const buttonRect = mountTextureButton.getBoundingClientRect();
    const left = Math.min(buttonRect.right + 8, window.innerWidth - 48);
    const top = Math.max(8, Math.min(buttonRect.top, window.innerHeight - 64));
    mountTexturePalette.style.left = `${left}px`;
    mountTexturePalette.style.top = `${top}px`;
    mountTexturePalette.style.maxWidth = `calc(100vw - ${left + 8}px)`;
    mountTexturePalette.style.maxHeight = `calc(100vh - ${top + 8}px)`;
}

function layerGeometrySignature(floor) {
    const rings = [floor.outerPolygon || [], ...(Array.isArray(floor.holes) ? floor.holes : [])];
    return [
        getFloorId(floor),
        floor.name || "",
        getFloorElevation(floor),
        Number(floor.floorHeight),
        ...rings.map((ring) => ring.map((point) => `${point.id || ""}:${Number(point.x).toFixed(4)},${Number(point.y).toFixed(4)}`).join("|"))
    ].join(";");
}

function updateLayerPanelSelection(floors) {
    const allSelected = state.allFloorsSelected();
    const allCard = layerPanel.querySelector("[data-layer-select-all]");
    if (allCard) {
        allCard.dataset.selected = allSelected ? "true" : "false";
        allCard.dataset.allSelected = allSelected ? "true" : "false";
    }
    floors.forEach((floor) => {
        const card = layerPanel.querySelector(`[data-floor-id="${CSS.escape(getFloorId(floor))}"]`);
        if (card) card.dataset.selected = state.isLayerFloorHighlighted(getFloorId(floor)) ? "true" : "false";
    });
}

function layerPanelFloors(floors) {
    return [...floors].reverse();
}

function renderLayerPanel(floors) {
    const panelFloors = layerPanelFloors(floors);
    const nextSignature = panelFloors
        .map((floor) => layerGeometrySignature(floor))
        .join("||") || "empty";
    if (nextSignature === layerPanelSignature) {
        updateLayerPanelSelection(panelFloors);
        return;
    }
    layerPanelSignature = nextSignature;
    layerPanel.innerHTML = "";
    const allSelected = state.allFloorsSelected();
    layerPanel.appendChild(createLayerCard({
        selectAll: true,
        selected: allSelected,
        allSelected
    }));
    panelFloors.forEach((floor) => {
        layerPanel.appendChild(createLayerRow(floor, state.isLayerFloorHighlighted(getFloorId(floor))));
    });
}

function beginLayerRename(nameElement, floorId) {
    const floor = findFloor(state.building, floorId);
    if (!floor) throw new Error(`cannot rename missing floor: ${floorId}`);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "layerNameInput";
    input.value = floor.name || getFloorId(floor);
    input.setAttribute("aria-label", "Floor name");
    let finished = false;
    const finish = (commit) => {
        if (finished) return;
        finished = true;
        if (commit) {
            state.renameFloor(floorId, input.value);
        } else {
            renderLayerPanel(getBuildingFloors(state.building));
        }
    };
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
        } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
        }
    });
    input.addEventListener("blur", () => finish(true));
    nameElement.replaceWith(input);
    input.focus();
    input.select();
}

function clearLayerDragMarkers() {
    layerPanel.querySelectorAll(".layerRow[data-drop-position]").forEach((row) => {
        delete row.dataset.dropPosition;
    });
}

function layerDropTargetFromEvent(event) {
    const row = event.target.closest(".layerRow");
    if (!row || !layerPanel.contains(row) || !row.dataset.floorRowId) return null;
    const rect = row.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height * 0.5 ? "before" : "after";
    return { row, floorId: row.dataset.floorRowId, position };
}

function modelDropPositionFromPanelPosition(position) {
    return position === "before" ? "after" : "before";
}

function summarizeSelection(selectedFloor, selectedWall, floors, walls) {
    const selection = state.selection || { kind: "building" };
    if (state.tool === "polygon" || state.tool === "scissors") {
        const draft = state.activePolygonDraft();
        const action = state.tool === "polygon" ? "add polygon" : "cut polygon";
        if (draft && draft.completed === true) return `${action}, ${draft.points.length} editable vertices`;
        if (draft && Array.isArray(draft.points) && draft.points.length > 0) return `${action}, ${draft.points.length} point${draft.points.length === 1 ? "" : "s"}`;
        return `${action}, elevation ${Number(state.polygonToolElevation)}`;
    }
    if (state.tool === "wall") {
        return `wall tool, height ${Number(state.wallTool.height)}, thickness ${Number(state.wallTool.thickness)}`;
    }
    if (state.tool === "mountObject") {
        return `${state.mountedObjectTool.category === "windows" ? "window" : "door"} tool`;
    }
    if (selection.kind === "mountedObject") {
        const objects = state.selectedMountedObjects();
        if (!objects.length) return "missing door/window";
        if (objects.length > 1) return `${objects.length} objects selected`;
        const object = objects[0];
        const category = object.category === "windows" ? "window" : "door";
        if (object.mountKind === "gable") return `${category} ${object.id}, gable ${object.gableId}`;
        return `${category} ${object.id}, wall ${selection.wallId}`;
    }
    if (selection.kind === "building") {
        return `building, ${floors.length} level${floors.length === 1 ? "" : "s"}`;
    }
    const selectedWalls = selectedWallsFrom(walls);
    if (selectedWalls.length > 1) {
        const floorIds = new Set(selectedWalls.map((wall) => wall.floorId));
        return `${selectedWalls.length} walls selected, ${floorIds.size} level${floorIds.size === 1 ? "" : "s"}`;
    }
    if (selectedWall) {
        const endpointText = selection.kind === "wallEndpoint" && selection.wallEndpointKey ? `, ${selection.wallEndpointKey}` : "";
        return `wall ${selectedWall.id}${endpointText}, level ${selectedWall.floorId}, height ${selectedWall.height}, thickness ${selectedWall.thickness}`;
    }
    if (selection.kind === "column") {
        const columns = state.selectedColumns();
        if (columns.length > 1) {
            const floorIds = new Set(columns.map((column) => column.floorId));
            return `${columns.length} columns selected, ${floorIds.size} level${floorIds.size === 1 ? "" : "s"}`;
        }
        const column = columns[0];
        if (!column) throw new Error(`selected column is missing from editor column list: ${selection.columnId}`);
        return `column ${column.id}, level ${column.floorId}, height ${column.height}, depth ${Number(column.depth ?? Number(column.size) * 2).toFixed(3)}, width ${Number(column.width ?? Number(column.size) * 2).toFixed(3)}, sides ${column.sideCount}`;
    }
    if (selection.kind === "beam") {
        const beams = state.selectedBeams();
        if (beams.length > 1) {
            const floorIds = new Set(beams.map((beam) => beam.floorId));
            return `${beams.length} beams selected, ${floorIds.size} level${floorIds.size === 1 ? "" : "s"}`;
        }
        const beam = beams[0];
        if (!beam) throw new Error(`selected beam is missing from editor beam list: ${selection.beamId}`);
        return `beam ${beam.id}, level ${beam.floorId}, height ${beam.height}, thickness ${beam.thickness}`;
    }
    if (selection.kind === "stair") {
        const stairs = state.selectedStairs();
        const stair = stairs[0];
        if (!stair) throw new Error(`selected stair is missing from editor stair list: ${selection.stairId}`);
        return `stair ${stair.id}, level ${stair.floorId}, ${stair.stepCount} steps, ${stair.direction}`;
    }
    if (!selectedFloor) return "nothing selected";
    const floorId = getFloorId(selectedFloor);
    const floorWallCount = walls.filter((wall) => (wall.fragmentId || wall.floorId) === floorId).length;
    if (selection.kind === "floorVertex") {
        return `${floorId} floor, ${selection.ringKind} vertex ${selection.vertexIndex}`;
    }
    if (selection.kind === "floor") {
        return `${floorId} floor, ${floorWallCount} walls`;
    }
    if (selection.kind === "roof") {
        const roofEntries = state.selectedRoofEntries();
        if (roofEntries.length > 1) return `${roofEntries.length} roofs selected`;
        const entry = roofEntries[0] || null;
        const roof = entry ? entry.roof : null;
        const roofFloorId = entry ? getFloorId(entry.floor) : floorId;
        const offsetText = roof && Number.isFinite(Number(roof.elevationOffset)) && Math.abs(Number(roof.elevationOffset)) > 0.000001
            ? `, offset ${Number(roof.elevationOffset).toFixed(2)}`
            : "";
        const modeText = roof && roof.mode ? ` ${roof.mode}` : "";
        const idText = selection.roofId ? ` ${selection.roofId}` : "";
        return `${roofFloorId}${modeText} roof${idText}${offsetText}`;
    }
    if (selection.kind === "roofVertex") {
        const idText = selection.roofId ? ` ${selection.roofId}` : "";
        return `${floorId} roof${idText}, contact vertex ${selection.vertexIndex}`;
    }
    if (selection.kind === "roofPeak") {
        const idText = selection.roofId ? ` ${selection.roofId}` : "";
        return `${floorId} roof${idText}, peak`;
    }
    if (selection.kind === "roofShedDirection") {
        const idText = selection.roofId ? ` ${selection.roofId}` : "";
        return `${floorId} roof${idText}, slope direction`;
    }
    if (selection.kind === "gable" || selection.kind === "gableHandle") {
        const handleText = selection.kind === "gableHandle" && selection.gableHandle ? `, ${selection.gableHandle}` : "";
        const idText = selection.roofId ? ` ${selection.roofId}` : "";
        return `${floorId} roof${idText}, gable ${selection.gableId}${handleText}`;
    }
    if (selection.kind === "level") {
        return `${floorId} level, elevation ${getFloorElevation(selectedFloor)}, ${floorWallCount} walls`;
    }
    return `${floorId}, elevation ${getFloorElevation(selectedFloor)}, ${floorWallCount} walls`;
}

function syncUi() {
    if (state.tool === "paint" && !selectionCanUsePaintTool()) {
        state.setTool("select");
        return;
    }
    document.querySelectorAll("[data-tool]").forEach((button) => {
        button.dataset.active = button.dataset.tool === state.tool ? "true" : "false";
    });
    mountToolButtons.forEach((button) => {
        button.dataset.active = state.tool === "mountObject" && button.dataset.mountCategory === state.mountedObjectTool.category ? "true" : "false";
    });
    if (roofToolButton) {
        roofToolButton.dataset.active = state.tool === "roof" ? "true" : "false";
    }
    if (playtestToggle) playtestToggle.dataset.active = state.playtestWizard && state.playtestWizard.active === true ? "true" : "false";
    syncRoofToolButtonTexture();
    syncWallToolButtonTexture();
    syncBeamToolButtonTexture();
    syncColumnToolButtonTexture();
    syncStructureToolButton();
    syncStairToolButtonTexture();
    syncMountedToolButtonTextures();
    document.querySelectorAll("[data-selection-scope], [data-selection-exclude]").forEach((element) => {
        element.hidden = !selectionScopeMatches(element);
    });
    document.querySelectorAll("[data-tool-scope], [data-tool-exclude]").forEach((element) => {
        element.hidden = !toolScopeMatches(element);
    });
    renderTexturePalette();
    renderMountTexturePalette();

    const selectedFloor = state.selectedFloor();
    const selectedWall = state.selectedWall();
    const floors = getBuildingFloors(state.building);
    const walls = getBuildingWalls(state.building);
    const selectedWalls = selectedWallsFrom(walls);
    const selectionKind = state.selection && state.selection.kind;
    const selectedRoofEntries = (() => {
        if (selectionKind === "roof" || selectionKind === "roofVertex" || selectionKind === "roofPeak" || selectionKind === "roofShedDirection" || selectionKind === "gable" || selectionKind === "gableHandle") {
            return state.selectedRoofEntries();
        }
        if (!selectedFloor) return [];
        const roof = getFloorRoof(selectedFloor);
        return roof ? [{ floor: selectedFloor, roof }] : [];
    })();
    const showVertexEndpointControls = state.selectedWallsCanToggleVertexInset();
    if (wallInsetEndpoints) wallInsetEndpoints.hidden = wallInsetEndpoints.hidden || !showVertexEndpointControls;
    if (wallProtrudeEndpoints) wallProtrudeEndpoints.hidden = wallProtrudeEndpoints.hidden || !showVertexEndpointControls;
    if (roofDomeLevelsControl) roofDomeLevelsControl.hidden = roofDomeLevelsControl.hidden || activeRoofMode(selectedRoofEntries) !== "dome";
    if (polygonElevation) polygonElevation.value = Number(state.polygonToolElevation);
    if (polygonFinalize) polygonFinalize.disabled = !state.canFinalizePolygonDraft();
    renderLayerPanel(floors);
    if (selectedFloor) {
        const roof = selectionKind === "gable" || selectionKind === "gableHandle"
            ? selectedRoofEntries[0] && selectedRoofEntries[0].roof
            : getFloorRoof(selectedFloor);
        floorElevation.value = getFloorElevation(selectedFloor);
        floorHeight.value = Number(selectedFloor.floorHeight);
        const selectedGable = state.selectedGable();
        if (roof && selectedGable) {
            const maxHeight = Math.max(0, Number(roof.peakHeight));
            const value = Math.max(0, Math.min(maxHeight, Number(selectedGable.height)));
            gableHeight.max = String(maxHeight);
            gableHeightValue.max = String(maxHeight);
            gableHeight.value = String(value);
            gableHeightValue.value = Number(value).toFixed(2);
            gableRoofReturn.checked = selectedGable.roofReturn !== false;
        }
    }
    if (state.tool === "roof") {
        roofMode.value = state.inputs.roofMode || DEFAULTS.roofMode;
        syncNumberInput(roofOverhang, Number(state.inputs.roofOverhang));
        syncNumberInput(roofPeakHeight, Number(state.inputs.roofPeakHeight));
        if (roofDomeLevels) {
            syncNumberInput(roofDomeLevels, Number(state.inputs.roofDomeLevels ?? DEFAULTS.roofDomeLevels));
        }
    } else if (selectedRoofEntries.length > 0) {
        const sharedMode = sharedSelectionValue(selectedRoofEntries, ({ roof }) => roof.mode || "peak");
        roofMode.value = sharedMode || "";
        syncNumberInput(roofOverhang, sharedSelectionValue(selectedRoofEntries, ({ roof }) => Number(roof.overhang)));
        syncNumberInput(roofPeakHeight, sharedSelectionValue(selectedRoofEntries, ({ roof }) => Number(roof.peakHeight)));
        if (roofDomeLevels) {
            syncNumberInput(roofDomeLevels, sharedSelectionValue(selectedRoofEntries, ({ roof }) => Number(roof.domeLevels ?? DEFAULTS.roofDomeLevels)));
        }
    }
    if (state.tool === "wall") {
        wallHeight.value = Number(state.wallTool.height);
        wallThickness.value = Number(state.wallTool.thickness);
        wallThicknessValue.value = Number(state.wallTool.thickness).toFixed(3);
        if (paintToolButton) paintToolButton.title = `Paint texture: ${textureName(state.wallTool.texture)}`;
    } else if (state.tool === "column") {
        const toolThickness = Number(state.columnTool.thickness);
        columnThickness.value = toolThickness;
        columnThicknessValue.value = toolThickness.toFixed(3);
        columnWidth.value = Number(state.columnTool.width);
        columnWidthValue.value = Number(state.columnTool.width).toFixed(3);
        if (columnHeight) {
            columnHeight.value = state.columnTool.heightMode === "fixed" && Number.isFinite(Number(state.columnTool.height))
                ? Number(state.columnTool.height)
                : "";
        }
        columnSideCount.value = Number(state.columnTool.sideCount);
        if (columnSnapPointsPerSection) columnSnapPointsPerSection.value = Number(state.columnTool.snapPointsPerSection);
        if (paintToolButton) paintToolButton.title = `Paint texture: ${textureName(state.columnTool.texture)}`;
    } else if (state.tool === "stair" && (!state.selection || state.selection.kind !== "stair")) {
        stairWidth.value = Number(state.stairTool.width);
        stairWidthValue.value = Number(state.stairTool.width).toFixed(2);
        const selectedFloorForStairs = state.selectedFloor();
        const stairDirectionAvailability = state.stairDirectionAvailability(selectedFloorForStairs);
        if (stairStepCount) {
            let stepCount = state.stairTool.stepCount;
            if (!stepCount && selectedFloorForStairs && stairDirectionAvailability[state.stairTool.direction]) {
                try {
                    stepCount = state.defaultStairStepCountForFloor(selectedFloorForStairs, state.stairTool.direction);
                } catch (_error) {
                    stepCount = "";
                }
            }
            stairStepCount.value = stepCount || "";
        }
        if (stairRiserDepth) {
            let maxDepth = null;
            let riserDepthValue = state.stairTool.riserDepth;
            if (selectedFloorForStairs && stairDirectionAvailability[state.stairTool.direction]) {
                try {
                    const height = Math.abs(state.stairHeightDifferenceForFloor(selectedFloorForStairs, state.stairTool.direction));
                    maxDepth = height;
                    if (riserDepthValue === null || riserDepthValue === undefined || riserDepthValue === "") {
                        const stepCount = state.stairTool.stepCount || state.defaultStairStepCountForFloor(selectedFloorForStairs, state.stairTool.direction);
                        riserDepthValue = state.defaultStairRiserDepthForFloor(selectedFloorForStairs, state.stairTool.direction, stepCount);
                    }
                } catch (_error) {
                    riserDepthValue = "";
                }
            }
            if (Number.isFinite(Number(maxDepth))) {
                stairRiserDepth.max = String(maxDepth);
            } else {
                stairRiserDepth.removeAttribute("max");
            }
            syncNumberInput(stairRiserDepth, riserDepthValue, (value) => value.toFixed(2));
        }
        stairDirectionInputs.forEach((input) => {
            const available = stairDirectionAvailability[input.value] === true;
            input.disabled = !available;
            const label = input.closest("label");
            if (label) {
                label.classList.toggle("toolRadioDisabled", !available);
                label.title = available ? "" : `No floor ${input.value === "up" ? "above" : "below"} the selected floor`;
            }
            input.checked = input.value === state.stairTool.direction;
        });
        stairTextureButtons.forEach((button) => {
            const part = button.dataset.stairTexturePart === "riser" ? "riser" : "tread";
            const texture = part === "riser"
                ? state.stairTool.riserTexture
                : (state.stairTool.treadTexture || state.stairTool.texture);
            button.title = `${part === "riser" ? "Riser" : "Tread"} texture: ${textureName(texture)}`;
        });
    } else if (selectedWalls.length > 0) {
        syncNumberInput(wallHeight, sharedSelectionValue(selectedWalls, (wall) => Number(wall.height)));
        syncRangeAndValueInput(
            wallThickness,
            wallThicknessValue,
            sharedSelectionValue(selectedWalls, (wall) => Number(wall.thickness)),
            Number(selectedWalls[0].thickness),
            (value) => value.toFixed(3)
        );
    } else if (selectedFloor) {
        wallHeight.value = selectedFloor.defaultWallHeight;
    }
    const selectedColumns = state.selectedColumns();
    if (state.tool !== "column" && selectedColumns.length > 0) {
        syncRangeAndValueInput(
            columnThickness,
            columnThicknessValue,
            sharedSelectionValue(selectedColumns, columnDepthValue),
            columnDepthValue(selectedColumns[0]),
            (value) => value.toFixed(3)
        );
        syncRangeAndValueInput(
            columnWidth,
            columnWidthValue,
            sharedSelectionValue(selectedColumns, columnWidthValueFor),
            columnWidthValueFor(selectedColumns[0]),
            (value) => value.toFixed(3)
        );
        syncNumberInput(columnHeight, sharedSelectionValue(selectedColumns, columnExplicitHeightValue), (value) => String(value));
        syncNumberInput(columnSideCount, sharedSelectionValue(selectedColumns, (column) => Number(column.sideCount)));
        if (columnSnapPointsPerSection) columnSnapPointsPerSection.value = Number(state.columnTool.snapPointsPerSection);
        const sharedTexture = sharedSelectionValue(selectedColumns, (column) => column.texturePath);
        if (paintToolButton) paintToolButton.title = sharedTexture
            ? `Paint texture: ${textureName(sharedTexture)}`
            : "Paint texture: mixed";
    }
    const selectedStairs = state.selectedStairs();
    if (selectedStairs.length > 0) {
        syncRangeAndValueInput(
            stairWidth,
            stairWidthValue,
            sharedSelectionValue(selectedStairs, (stair) => Number(stair.width)),
            Number(selectedStairs[0].width),
            (value) => value.toFixed(2)
        );
        if (stairStepCount) {
            syncNumberInput(stairStepCount, sharedSelectionValue(selectedStairs, (stair) => Number(stair.stepCount)), (value) => String(Math.round(value)));
        }
        if (stairRiserDepth) {
            const sharedHeight = sharedSelectionValue(selectedStairs, (stair) => Number(stair.height));
            if (Number.isFinite(Number(sharedHeight))) {
                stairRiserDepth.max = String(sharedHeight);
            } else {
                stairRiserDepth.removeAttribute("max");
            }
            syncNumberInput(stairRiserDepth, sharedSelectionValue(selectedStairs, stairRiserDepthValueFor), (value) => value.toFixed(2));
        }
        stairTextureButtons.forEach((button) => {
            const part = button.dataset.stairTexturePart === "riser" ? "riser" : "tread";
            const sharedTexture = sharedSelectionValue(selectedStairs, (stair) => part === "riser"
                ? (stair.riserTexturePath || stair.texturePath)
                : (stair.treadTexturePath || stair.texturePath));
            button.title = sharedTexture
                ? `${part === "riser" ? "Riser" : "Tread"} texture: ${textureName(sharedTexture)}`
                : `${part === "riser" ? "Riser" : "Tread"} texture: mixed`;
        });
    }
    const mountedCategory = activeMountedObjectCategory();
    const selectedMountedObjects = state.tool !== "mountObject" ? state.selectedMountedObjects() : [];
    if (selectedMountedObjects.length > 0) {
        const sharedSize = sharedSelectionValue(selectedMountedObjects, (object) => Number(object.height));
        const sharedAspect = sharedSelectionValue(selectedMountedObjects, mountedObjectAspectRatioValue);
        const sizeForSlider = sharedSize !== null && sharedSize !== undefined ? sharedSize : Number(selectedMountedObjects[0].height);
        const aspectForSlider = sharedAspect !== null && sharedAspect !== undefined ? sharedAspect : mountedObjectAspectRatioValue(selectedMountedObjects[0]);
        mountSize.value = Number(sizeForSlider);
        mountAspect.value = aspectRatioToSliderValue(aspectForSlider);
        syncNumberInput(mountSizeValue, sharedSize, (value) => value.toFixed(2));
        syncNumberInput(mountAspectValue, sharedAspect, (value) => value.toFixed(2));
        const sharedTexture = sharedSelectionValue(selectedMountedObjects, (object) => object.texturePath);
        if (mountSnapPointsPerSection) mountSnapPointsPerSection.value = Number(state.mountedObjectSnapPointsPerSection(mountedCategory));
        mountTextureButton.title = sharedTexture
            ? `Paint texture: ${textureName(sharedTexture)}`
            : "Paint texture: mixed";
    } else {
        const mountAsset = state.selectedMountedObjectAsset();
        if (mountAsset) {
            mountSize.value = Number(mountAsset.size);
            mountAspect.value = aspectRatioToSliderValue(mountAsset.aspectRatio);
            mountSizeValue.value = Number(mountAsset.size).toFixed(2);
            mountAspectValue.value = Number(mountAsset.aspectRatio).toFixed(2);
            if (mountSnapPointsPerSection) mountSnapPointsPerSection.value = Number(mountAsset.snapPointsPerSection || 1);
            mountTextureButton.title = `Paint texture: ${textureName(mountAsset.texturePath)}`;
        }
    }
    selectedSummary.textContent = summarizeSelection(selectedFloor, selectedWall, floors, walls);
    snapToggle.checked = state.snapToGrid;
    snapDirectionToggle.checked = state.snapDirection;
    anchorToggle.checked = state.showSnapAnchors;
    jsonText.value = state.serialize();

    if (state.renderError) {
        setStatus(state.renderError, true);
    } else {
        const visibleCount = floors.filter((floor) => state.isFloorSelected(getFloorId(floor))).length;
        setStatus(`ready: ${state.renderStyle()}, ${visibleCount}/${floors.length} layer(s) visible`);
    }
}

state.addEventListener("change", () => {
    if (state.playtestWizard && state.playtestWizard.active === true) {
        playtestRuntime = buildPlaytestRuntime();
    }
    renderer.render();
    syncUi();
});

document.querySelectorAll("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
        withErrorBoundary(() => {
            if (button.dataset.tool === "paint" && state.tool === "wall") {
                wallToolTexturePaletteOpen = !wallToolTexturePaletteOpen;
                renderTexturePalette();
                return;
            }
            if (button.dataset.tool === "paint" && state.tool === "column") {
                columnToolTexturePaletteOpen = !columnToolTexturePaletteOpen;
                renderTexturePalette();
                return;
            }
            wallToolTexturePaletteOpen = false;
            columnToolTexturePaletteOpen = false;
            stairTexturePaletteOpen = false;
            closeStructureToolMenu();
            state.setTool(state.tool === button.dataset.tool ? "select" : button.dataset.tool);
        });
    });
});

stairTextureButtons.forEach((button) => {
    button.addEventListener("click", () => {
        withErrorBoundary(() => {
            const nextPart = button.dataset.stairTexturePart === "riser" ? "riser" : "tread";
            const switchingPart = stairTexturePalettePart !== nextPart;
            stairTexturePalettePart = nextPart;
            stairTexturePaletteOpen = switchingPart || !stairTexturePaletteOpen;
            wallToolTexturePaletteOpen = false;
            columnToolTexturePaletteOpen = false;
            renderTexturePalette();
        });
    });
});

if (roofToolButton) {
    roofToolButton.addEventListener("click", () => {
        withErrorBoundary(() => {
            wallToolTexturePaletteOpen = false;
            columnToolTexturePaletteOpen = false;
            stairTexturePaletteOpen = false;
            mountTexturePaletteOpen = false;
            closeStructureToolMenu();
            state.setTool(state.tool === "roof" ? "select" : "roof");
        });
    });
}

if (structureToolButton) {
    structureToolButton.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        structureToolLongPressOpened = false;
        cancelStructureToolPressTimer();
        structureToolPressTimer = setTimeout(() => {
            structureToolLongPressOpened = true;
            withErrorBoundary(() => openStructureToolMenu());
        }, 360);
    });
    structureToolButton.addEventListener("pointerup", () => {
        cancelStructureToolPressTimer();
    });
    structureToolButton.addEventListener("pointerleave", () => {
        cancelStructureToolPressTimer();
    });
    structureToolButton.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        withErrorBoundary(() => openStructureToolMenu());
    });
    structureToolButton.addEventListener("click", () => {
        withErrorBoundary(() => {
            if (structureToolLongPressOpened) {
                structureToolLongPressOpened = false;
                return;
            }
            selectStructureTool(activeStructureTool, { toggle: true });
        });
    });
}

structureToolMenuButtons.forEach((button) => {
    button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
    });
    button.addEventListener("click", () => {
        withErrorBoundary(() => selectStructureTool(button.dataset.structureTool));
    });
});

if (structureToolMenu) {
    structureToolMenu.addEventListener("contextmenu", (event) => {
        event.preventDefault();
    });
}

texturePalette.addEventListener("click", (event) => {
    const swatch = event.target.closest(".textureSwatch");
    if (!swatch || !texturePalette.contains(swatch)) return;
    withErrorBoundary(() => {
        const mode = activePaintMode();
        const texturePath = swatch.dataset.texturePath;
        state.setPaintTexture(mode, texturePath);
        applyTextureToSelection(texturePath);
        wallToolTexturePaletteOpen = false;
        columnToolTexturePaletteOpen = false;
        stairTexturePaletteOpen = false;
        if (state.tool !== "wall" && state.tool !== "column" && state.tool !== "stair" && state.tool !== "select") {
            state.setTool("select");
        }
    });
});

mountToolButtons.forEach((button) => {
    button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
    });
    button.addEventListener("click", () => {
        withErrorBoundary(() => {
            wallToolTexturePaletteOpen = false;
            columnToolTexturePaletteOpen = false;
            stairTexturePaletteOpen = false;
            mountTexturePaletteOpen = false;
            closeStructureToolMenu();
            state.setMountedObjectToolCategory(button.dataset.mountCategory);
        });
    });
});

if (playtestToggle) {
    playtestToggle.addEventListener("click", () => {
        withErrorBoundary(() => {
            setPlaytestMode(!(state.playtestWizard && state.playtestWizard.active === true));
        });
    });
}

mountTextureButton.addEventListener("click", () => {
    withErrorBoundary(() => {
        if (!mountedObjectSettingsActive()) {
            state.setMountedObjectToolCategory(state.mountedObjectTool.category || "doors");
        }
        mountTexturePaletteOpen = !mountTexturePaletteOpen;
        renderMountTexturePalette();
    });
});

mountTexturePalette.addEventListener("click", (event) => {
    const swatch = event.target.closest(".textureSwatch");
    if (!swatch || !mountTexturePalette.contains(swatch)) return;
    withErrorBoundary(() => {
        const category = activeMountedObjectCategory();
        const asset = (MOUNTED_OBJECT_ASSETS[category] || []).find((candidate) => candidate.texturePath === swatch.dataset.texturePath);
        if (!asset) throw new Error(`missing ${category} asset: ${swatch.dataset.texturePath}`);
        mountTexturePaletteOpen = false;
        if (state.selection && state.selection.kind === "mountedObject") {
            state.updateSelectedMountedObjectAsset(asset);
        } else {
            state.setMountedObjectAsset(category, asset);
        }
    });
});

windowContextMenu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-window-select]");
    if (!button || !windowContextMenu.contains(button)) return;
    withErrorBoundary(() => {
        applyWindowContextSelection(button.dataset.windowSelect, windowSelectionModeFromEvent(event, windowContext && windowContext.mode));
        closeWindowContextMenu();
    });
});

windowContextMenu.addEventListener("contextmenu", (event) => {
    event.preventDefault();
});

document.addEventListener("pointerdown", (event) => {
    if (windowContextMenu.hidden || windowContextMenu.contains(event.target)) return;
    closeWindowContextMenu();
}, true);

document.addEventListener("pointerdown", (event) => {
    if (!structureToolMenu || structureToolMenu.hidden) return;
    if (structureToolMenu.contains(event.target) || (structureToolButton && structureToolButton.contains(event.target))) return;
    closeStructureToolMenu();
}, true);

mountSize.addEventListener("input", () => {
    withErrorBoundary(() => state.updateMountedObjectSize(mountSize.value));
});

mountSizeValue.addEventListener("change", () => {
    withErrorBoundary(() => state.updateMountedObjectSize(mountSizeValue.value));
});

mountAspect.addEventListener("input", () => {
    withErrorBoundary(() => state.updateMountedObjectAspectRatio(sliderValueToAspectRatio(mountAspect.value)));
});

mountAspectValue.addEventListener("change", () => {
    withErrorBoundary(() => state.updateMountedObjectAspectRatio(mountAspectValue.value));
});

if (mountSnapPointsPerSection) {
    mountSnapPointsPerSection.addEventListener("change", () => {
        withErrorBoundary(() => state.updateMountedObjectSnapPointsPerSection(mountSnapPointsPerSection.value));
    });
}

document.querySelector("#saveBuilding").addEventListener("click", () => {
    withAsyncErrorBoundary(() => saveCurrentBuildingToServer());
});

document.querySelector("#openBuilding").addEventListener("click", () => {
    withAsyncErrorBoundary(() => showBuildingOpenDialog({ canClose: true }));
});

document.querySelector("#newBuilding").addEventListener("click", () => {
    withErrorBoundary(() => showBuildingNameDialog());
});

buildingSaveList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-building-name]");
    if (!button || !buildingSaveList.contains(button)) return;
    withAsyncErrorBoundary(() => loadBuildingFromServer(button.dataset.buildingName));
});

openNewBuildingButton.addEventListener("click", () => {
    withErrorBoundary(() => showBuildingNameDialog());
});

closeBuildingOpenDialogButton.addEventListener("click", () => {
    closeBuildingOpenDialog();
});

buildingNameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    withErrorBoundary(() => createNewBuildingWithName(buildingNameInput.value));
});

cancelBuildingNameButton.addEventListener("click", () => {
    closeBuildingNameDialog();
    if (!currentBuildingName) {
        showBuildingOpenDialog({ canClose: false }).catch((error) => {
            console.error(error);
            setStatus(error.message, true);
        });
    }
});

layerPanel.addEventListener("click", (event) => {
    const renameTarget = event.target.closest("[data-rename-floor-id]");
    if (renameTarget && layerPanel.contains(renameTarget)) {
        const floorId = renameTarget.dataset.renameFloorId;
        if (state.isLayerFloorHighlighted(floorId)) {
            withErrorBoundary(() => beginLayerRename(renameTarget, floorId));
            return;
        }
        // Not yet selected — fall through to card selection below
    }
    const deleteButton = event.target.closest("[data-delete-floor-id]");
    if (deleteButton && layerPanel.contains(deleteButton)) {
        withErrorBoundary(() => state.deleteFloor(deleteButton.dataset.deleteFloorId));
        return;
    }
    const card = event.target.closest(".layerCard");
    if (!card || !layerPanel.contains(card)) return;
    withErrorBoundary(() => {
        if (state.tool !== "select") state.setTool("select");
        if (card.dataset.layerSelectAll === "true") {
            state.selectAllFloors();
            return;
        }
        state.selectFloor(card.dataset.floorId);
    });
});

layerPanel.addEventListener("contextmenu", (event) => {
    const row = event.target.closest(".layerRow");
    if (!row || !layerPanel.contains(row) || !row.dataset.floorRowId) return;
    event.preventDefault();
    withErrorBoundary(() => openLayerContextMenu(row.dataset.floorRowId, event.clientX, event.clientY));
});

layerContextMenu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-layer-duplicate-position]");
    if (!button || !layerContextMenu.contains(button)) return;
    withErrorBoundary(() => {
        if (!layerContextFloorId) throw new Error("layer context menu is missing its source level");
        state.duplicateFloorAdjacent(layerContextFloorId, button.dataset.layerDuplicatePosition);
        closeLayerContextMenu();
    });
});

layerContextMenu.addEventListener("contextmenu", (event) => {
    event.preventDefault();
});

document.addEventListener("pointerdown", (event) => {
    if (layerContextMenu.hidden || layerContextMenu.contains(event.target)) return;
    closeLayerContextMenu();
}, true);

layerPanel.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".layerCard");
    if (!card || !layerPanel.contains(card)) return;
    event.preventDefault();
    withErrorBoundary(() => {
        if (state.tool !== "select") state.setTool("select");
        if (card.dataset.layerSelectAll === "true") {
            state.selectAllFloors();
        } else {
            state.selectFloor(card.dataset.floorId);
        }
    });
});

layerPanel.addEventListener("dragstart", (event) => {
    const row = event.target.closest(".layerRow");
    if (!row || !layerPanel.contains(row) || !row.dataset.floorRowId) return;
    layerDrag = { floorId: row.dataset.floorRowId };
    row.dataset.dragging = "true";
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.dataset.floorRowId);
});

layerPanel.addEventListener("dragover", (event) => {
    if (!layerDrag) return;
    const target = layerDropTargetFromEvent(event);
    if (!target || target.floorId === layerDrag.floorId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearLayerDragMarkers();
    target.row.dataset.dropPosition = target.position;
});

layerPanel.addEventListener("dragleave", (event) => {
    if (!layerDrag || layerPanel.contains(event.relatedTarget)) return;
    clearLayerDragMarkers();
});

layerPanel.addEventListener("drop", (event) => {
    if (!layerDrag) return;
    const target = layerDropTargetFromEvent(event);
    if (!target || target.floorId === layerDrag.floorId) return;
    event.preventDefault();
    withErrorBoundary(() => {
        state.moveFloorInLayerPanel(layerDrag.floorId, target.floorId, modelDropPositionFromPanelPosition(target.position));
    });
    layerDrag = null;
    clearLayerDragMarkers();
});

layerPanel.addEventListener("dragend", () => {
    layerPanel.querySelectorAll(".layerRow[data-dragging]").forEach((row) => {
        delete row.dataset.dragging;
    });
    clearLayerDragMarkers();
    layerDrag = null;
});

floorElevation.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedFloorElevation(floorElevation.value));
});

polygonElevation.addEventListener("change", () => {
    withErrorBoundary(() => state.updatePolygonToolElevation(polygonElevation.value));
});

polygonFinalize.addEventListener("click", () => {
    withErrorBoundary(() => activeTool().finish());
});

floorHeight.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedFloorHeight(floorHeight.value));
});

roofMode.addEventListener("change", () => {
    withErrorBoundary(() => {
        if (state.tool === "roof") state.updateRoofToolMode(roofMode.value);
        else state.updateSelectedRoofMode(roofMode.value);
    });
});

roofOverhang.addEventListener("change", () => {
    withErrorBoundary(() => {
        if (state.tool === "roof") state.updateRoofToolOverhang(roofOverhang.value);
        else state.updateSelectedRoofOverhang(roofOverhang.value);
    });
});

roofPeakHeight.addEventListener("change", () => {
    withErrorBoundary(() => {
        if (state.tool === "roof") state.updateRoofToolPeakHeight(roofPeakHeight.value);
        else state.updateSelectedRoofPeakHeight(roofPeakHeight.value);
    });
});

if (roofDomeLevels) {
    roofDomeLevels.addEventListener("change", () => {
        withErrorBoundary(() => {
            if (state.tool === "roof") state.updateRoofToolDomeLevels(roofDomeLevels.value);
            else state.updateSelectedRoofDomeLevels(roofDomeLevels.value);
        });
    });
}

gableHeight.addEventListener("input", () => {
    withErrorBoundary(() => state.updateSelectedGableHeight(gableHeight.value));
});

gableHeightValue.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedGableHeight(gableHeightValue.value));
});

gableRoofReturn.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedGableRoofReturn(gableRoofReturn.checked));
});

wallHeight.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedWallHeight(wallHeight.value));
});

wallThickness.addEventListener("input", () => {
    withErrorBoundary(() => state.updateSelectedWallThickness(wallThickness.value));
});

wallThicknessValue.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedWallThickness(wallThicknessValue.value));
});

columnThickness.addEventListener("input", () => {
    withErrorBoundary(() => state.updateSelectedColumnThickness(columnThickness.value));
});

columnThicknessValue.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedColumnThickness(columnThicknessValue.value));
});

columnWidth.addEventListener("input", () => {
    withErrorBoundary(() => state.updateSelectedColumnWidth(columnWidth.value));
});

columnWidthValue.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedColumnWidth(columnWidthValue.value));
});

stairWidth.addEventListener("input", () => {
    withErrorBoundary(() => {
        if (state.selection && state.selection.kind === "stair") {
            state.updateSelectedStairWidth(stairWidth.value);
        } else {
            state.updateStairToolWidth(stairWidth.value);
        }
    });
});

stairWidthValue.addEventListener("change", () => {
    withErrorBoundary(() => {
        if (state.selection && state.selection.kind === "stair") {
            state.updateSelectedStairWidth(stairWidthValue.value);
        } else {
            state.updateStairToolWidth(stairWidthValue.value);
        }
    });
});

if (stairStepCount) {
    stairStepCount.addEventListener("change", () => {
        withErrorBoundary(() => {
            if (state.selection && state.selection.kind === "stair") {
                state.updateSelectedStairStepCount(stairStepCount.value);
            } else {
                state.updateStairToolStepCount(stairStepCount.value);
            }
        });
    });
}

if (stairRiserDepth) {
    stairRiserDepth.addEventListener("change", () => {
        withErrorBoundary(() => {
            if (state.selection && state.selection.kind === "stair") {
                state.updateSelectedStairRiserDepth(stairRiserDepth.value);
            } else {
                state.updateStairToolRiserDepth(stairRiserDepth.value);
            }
        });
    });
}

stairDirectionInputs.forEach((input) => {
    input.addEventListener("change", () => {
        if (!input.checked) return;
        withErrorBoundary(() => state.updateStairToolDirection(input.value));
    });
});

if (columnHeight) {
    columnHeight.addEventListener("change", () => {
        withErrorBoundary(() => state.updateSelectedColumnHeight(columnHeight.value));
    });
}

columnSideCount.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedColumnSideCount(columnSideCount.value));
});

if (columnSnapPointsPerSection) {
    columnSnapPointsPerSection.addEventListener("change", () => {
        withErrorBoundary(() => state.updateColumnToolSnapPointsPerSection(columnSnapPointsPerSection.value));
    });
}

wallInsetEndpoints.addEventListener("click", () => {
    withErrorBoundary(() => state.updateSelectedWallVertexInset(true));
});

wallProtrudeEndpoints.addEventListener("click", () => {
    withErrorBoundary(() => state.updateSelectedWallVertexInset(false));
});

snapToggle.addEventListener("change", () => {
    state.setSnapToGrid(snapToggle.checked);
});

snapDirectionToggle.addEventListener("change", () => {
    state.snapDirection = snapDirectionToggle.checked;
    state.emitChange();
});

anchorToggle.addEventListener("change", () => {
    state.showSnapAnchors = anchorToggle.checked;
    state.emitChange();
});

stageHost.addEventListener("contextmenu", (event) => event.preventDefault());

stageHost.addEventListener("pointermove", (event) => {
    if (!rotatingView || event.pointerType === "touch") return;
    const point = screenPointFromClient(event.clientX, event.clientY);
    lastStagePointer = point;
    rotateViewFromScreenX(point.x);
    event.preventDefault();
}, { passive: false });

app.stage.on("pointerdown", (event) => {
    withErrorBoundary(() => {
        stageHost.focus({ preventScroll: true });
        const original = event.data.originalEvent;
        if (original && original.pointerType === "touch") return;
        if (rotatingView) return;
        const screenPoint = { x: event.data.global.x, y: event.data.global.y };
        renderer.setScreenPickerDebugPoint(screenPoint);
        if (state.playtestWizard && state.playtestWizard.active === true) {
            playtestMouseWorld = renderer.screenToWorld(screenPoint, state.playtestWizard.z);
            panning = null;
            return;
        }
        if (original.button === 2) {
            const hit = renderer.pickAtScreen(screenPoint, { includeSurfaces: false });
            const menuPoint = {
                x: Number.isFinite(Number(original.clientX)) ? Number(original.clientX) : screenPoint.x,
                y: Number.isFinite(Number(original.clientY)) ? Number(original.clientY) : screenPoint.y
            };
            if (hit && hit.type === "mountedObject" && isWindowObject(hit.object)) {
                showWindowContextMenu(
                    menuPoint,
                    hit.object,
                    windowSelectionModeFromEvent(original, "replace")
                );
                panning = null;
                return;
            }
            if (hit && hit.type === "wall") {
                showWallContextMenu(
                    menuPoint,
                    hit.wall,
                    windowSelectionModeFromEvent(original, "replace")
                );
                panning = null;
                return;
            }
            if (hit && hit.type === "column") {
                showColumnContextMenu(
                    menuPoint,
                    hit.column,
                    windowSelectionModeFromEvent(original, "replace")
                );
                panning = null;
                return;
            }
            if (hit && hit.type === "beam") {
                showBeamContextMenu(
                    menuPoint,
                    hit.beam,
                    windowSelectionModeFromEvent(original, "replace")
                );
                panning = null;
                return;
            }
            closeWindowContextMenu();
            panning = {
                screen: { x: event.data.global.x, y: event.data.global.y },
                camera: { ...state.camera }
            };
            return;
        }
        closeWindowContextMenu();
        if (original.button === 1) {
            panning = {
                screen: { x: event.data.global.x, y: event.data.global.y },
                camera: { ...state.camera }
            };
            return;
        }
        const thresholdPixels = state.tool === "select" ? 10 : 14;
        const threshold = renderer.screenPixelsToWorldDistance(thresholdPixels);
        activeTool().pointerDown(worldFromEvent(event), threshold, {
            shiftKey: !!((original && original.shiftKey) || state.shiftKeyDown),
            controlKey: !!(original && (original.ctrlKey || original.metaKey)),
            doubleClick: !!(original && Number(original.detail) >= 2),
            timeStamp: original && Number.isFinite(Number(original.timeStamp)) ? Number(original.timeStamp) : undefined,
            thresholdPixels,
            screenPoint,
            renderer
        });
    });
});

app.stage.on("pointermove", (event) => {
    withErrorBoundary(() => {
        const original = event.data.originalEvent;
        if (original && original.pointerType === "touch") return;
        lastStagePointer = { x: event.data.global.x, y: event.data.global.y };
        renderer.setScreenPickerDebugPoint(lastStagePointer);
        if (rotatingView) {
            return;
        }
        if (panning) {
            const delta = renderer.screenDeltaToWorldDelta({
                x: event.data.global.x - panning.screen.x,
                y: event.data.global.y - panning.screen.y
            });
            state.camera.x = panning.camera.x - delta.x;
            state.camera.y = panning.camera.y - delta.y;
            renderer.render();
            return;
        }
        state.updateHoverPoint(worldFromEvent(event));
        if (state.playtestWizard && state.playtestWizard.active === true) {
            playtestMouseWorld = renderer.screenToWorld(lastStagePointer, state.playtestWizard.z);
            renderer.render();
            return;
        }
        if (typeof activeTool().pointerMove === "function") {
            const thresholdPixels = state.tool === "select" ? 10 : 14;
            activeTool().pointerMove(worldFromEvent(event), renderer.screenPixelsToWorldDistance(thresholdPixels), {
                thresholdPixels,
                screenPoint: lastStagePointer,
                renderer
            });
        }
    });
});

app.stage.on("pointerup", (event) => {
    const screenPoint = { x: event.data.global.x, y: event.data.global.y };
    if (state.playtestWizard && state.playtestWizard.active === true) {
        playtestMouseWorld = renderer.screenToWorld(screenPoint, state.playtestWizard.z);
        panning = null;
        return;
    }
    const thresholdPixels = state.tool === "select" ? 10 : 14;
    if (typeof activeTool().pointerUp === "function") activeTool().pointerUp(worldFromEvent(event), renderer.screenPixelsToWorldDistance(thresholdPixels), {
        thresholdPixels,
        screenPoint,
        renderer
    });
    panning = null;
});

app.stage.on("pointerupoutside", (event) => {
    const screenPoint = { x: event.data.global.x, y: event.data.global.y };
    if (state.playtestWizard && state.playtestWizard.active === true) {
        playtestMouseWorld = renderer.screenToWorld(screenPoint, state.playtestWizard.z);
        panning = null;
        return;
    }
    const thresholdPixels = state.tool === "select" ? 10 : 14;
    if (typeof activeTool().pointerUp === "function") activeTool().pointerUp(worldFromEvent(event), renderer.screenPixelsToWorldDistance(thresholdPixels), {
        thresholdPixels,
        screenPoint,
        renderer
    });
    panning = null;
});

stageHost.addEventListener("wheel", (event) => {
    closeWindowContextMenu();
    event.preventDefault();
    const delta = wheelDeltaPixels(event);
    if (rotatingView) {
        rotateCameraPitchFromWheel(delta.y);
        return;
    }
    if (event.ctrlKey) {
        const factor = Math.exp(-delta.y * 0.01);
        zoomAtScreenPoint(screenPointFromClient(event.clientX, event.clientY), state.camera.zoom * factor);
        return;
    }
    const worldDelta = renderer.screenDeltaToWorldDelta(delta);
    state.camera.x += worldDelta.x;
    state.camera.y += worldDelta.y;
    renderer.render();
}, { passive: false });

stageHost.addEventListener("touchstart", (event) => {
    stageHost.focus({ preventScroll: true });
    if (event.touches.length === 1) {
        event.preventDefault();
        const point = screenPointFromClient(event.touches[0].clientX, event.touches[0].clientY);
        touchGesture = {
            mode: "pending-pan",
            startPoint: point,
            lastPoint: point,
            camera: { ...state.camera },
            consumed: false
        };
        return;
    }
    if (event.touches.length === 2) {
        event.preventDefault();
        const a = screenPointFromClient(event.touches[0].clientX, event.touches[0].clientY);
        const b = screenPointFromClient(event.touches[1].clientX, event.touches[1].clientY);
        touchGesture = {
            mode: "pinch",
            startDistance: Math.max(1, pointDistance(a, b)),
            startZoom: state.camera.zoom,
            center: midpoint(a, b),
            consumed: true
        };
    }
}, { passive: false });

stageHost.addEventListener("touchmove", (event) => {
    if (!touchGesture) return;
    if (event.touches.length === 1 && (touchGesture.mode === "pending-pan" || touchGesture.mode === "pan")) {
        const point = screenPointFromClient(event.touches[0].clientX, event.touches[0].clientY);
        const totalDx = point.x - touchGesture.startPoint.x;
        const totalDy = point.y - touchGesture.startPoint.y;
        if (touchGesture.mode === "pending-pan" && Math.hypot(totalDx, totalDy) < 6) {
            return;
        }
        event.preventDefault();
        touchGesture.mode = "pan";
        touchGesture.consumed = true;
        const worldDelta = renderer.screenDeltaToWorldDelta({ x: totalDx, y: totalDy });
        state.camera.x = touchGesture.camera.x - worldDelta.x;
        state.camera.y = touchGesture.camera.y - worldDelta.y;
        renderer.render();
        return;
    }
    if (event.touches.length === 2 && touchGesture.mode === "pinch") {
        event.preventDefault();
        const a = screenPointFromClient(event.touches[0].clientX, event.touches[0].clientY);
        const b = screenPointFromClient(event.touches[1].clientX, event.touches[1].clientY);
        const center = midpoint(a, b);
        const factor = pointDistance(a, b) / touchGesture.startDistance;
        zoomAtScreenPoint(center, touchGesture.startZoom * factor);
    }
}, { passive: false });

stageHost.addEventListener("touchend", (event) => {
    if (!touchGesture) return;
    if (event.touches.length === 0) {
        if (touchGesture.mode === "pending-pan" && !touchGesture.consumed) {
            const threshold = renderer.screenPixelsToWorldDistance(14);
            withErrorBoundary(() => {
                renderer.setScreenPickerDebugPoint(touchGesture.startPoint);
                activeTool().pointerDown(renderer.screenToWorld(touchGesture.startPoint), threshold, {
                    shiftKey: false,
                    controlKey: false,
                    doubleClick: false,
                    thresholdPixels: 14,
                    screenPoint: touchGesture.startPoint,
                    renderer
                });
            });
        }
        touchGesture = null;
        return;
    }
    if (event.touches.length === 1) {
        const point = screenPointFromClient(event.touches[0].clientX, event.touches[0].clientY);
        touchGesture = {
            mode: "pending-pan",
            startPoint: point,
            lastPoint: point,
            camera: { ...state.camera },
            consumed: false
        };
    }
}, { passive: false });

stageHost.addEventListener("touchcancel", () => {
    touchGesture = null;
}, { passive: false });

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.playtestWizard && state.playtestWizard.active === true) {
        setPlaytestMode(false);
        event.preventDefault();
        return;
    }
    if (event.key === "Escape" && !windowContextMenu.hidden) {
        closeWindowContextMenu();
        event.preventDefault();
        return;
    }
    if (event.key === "Escape" && !layerContextMenu.hidden) {
        closeLayerContextMenu();
        event.preventDefault();
        return;
    }
    if (event.key === "Escape" && structureToolMenu && !structureToolMenu.hidden) {
        closeStructureToolMenu();
        event.preventDefault();
        return;
    }
    if (event.key === "Escape") {
        const tool = activeTool();
        if (tool && typeof tool.cancel === "function" && draftConsumesEscape(state.draft)) {
            tool.cancel();
            event.preventDefault();
            return;
        }
        if (state.tool !== "select") {
            state.setTool("select");
            event.preventDefault();
            return;
        }
    }
    if (isTextEditingTarget(event.target)) return;
    if (event.key === "Shift") state.shiftKeyDown = true;
    const key = String(event.key || "").toLowerCase();
    if (state.playtestWizard && state.playtestWizard.active === true && key === "w") {
        playtestForwardPressed = true;
        event.preventDefault();
        return;
    }
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && state.tool === "stair") {
        const tool = activeTool();
        if (tool && typeof tool.rotatePreview === "function") {
            tool.rotatePreview(event.key === "ArrowLeft" ? -Math.PI / 36 : Math.PI / 36);
            event.preventDefault();
            return;
        }
    }
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && state.selectedColumnIds().length > 0) {
        withErrorBoundary(() => {
            const step = event.shiftKey ? COLUMN_ARROW_FINE_ROTATION_STEP_RADIANS : COLUMN_ARROW_ROTATION_STEP_RADIANS;
            state.rotateSelectedColumns(event.key === "ArrowLeft"
                ? -step
                : step);
        });
        event.preventDefault();
        return;
    }
    if ((event.ctrlKey || event.metaKey) && key === "d") {
        withErrorBoundary(() => {
            const enabled = renderer.toggleScreenPickerDebug();
            renderer.render();
            setStatus(enabled ? "screen picker debug on" : "screen picker debug off");
        });
        event.preventDefault();
        return;
    }
    if (key === "z") {
        if (!event.repeat) {
            const now = performance.now();
            if (now - lastZTapTime <= Z_DOUBLE_TAP_MS) {
                resetAndCenterBuildingView();
                rotatingView = false;
                lastZTapTime = 0;
                event.preventDefault();
                return;
            }
            lastZTapTime = now;
        }
        if (!rotatingView) {
            rotatingView = true;
            rotatePointerX = lastStagePointer ? lastStagePointer.x : null;
            state.updateCameraRotationCenter();
            panning = null;
            const tool = activeTool();
            if (tool && typeof tool.pointerUp === "function") tool.pointerUp();
        }
        event.preventDefault();
        return;
    }
    if (event.key === "Escape") {
        if (state.selectParentSelection()) {
            event.preventDefault();
        }
        return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && (state.tool === "polygon" || state.tool === "scissors")) {
        if (state.deleteSelectedPolygonDraftVertex()) {
            event.preventDefault();
        }
        return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && state.tool === "select") {
        if (state.deleteSelectedMountedObject()) {
            event.preventDefault();
            return;
        }
        if (state.deleteSelectedWall()) {
            event.preventDefault();
            return;
        }
        if (state.deleteSelectedGable()) {
            event.preventDefault();
            return;
        }
        if (state.deleteSelectedRoof()) {
            event.preventDefault();
            return;
        }
        if (state.deleteSelectedRoofVertex()) {
            event.preventDefault();
            return;
        }
        if (state.deleteSelectedFloorVertex()) {
            event.preventDefault();
            return;
        }
        if (state.deleteSelectedColumn()) {
            event.preventDefault();
            return;
        }
        if (state.deleteSelectedBeam()) {
            event.preventDefault();
            return;
        }
        if (state.deleteSelectedStair()) {
            event.preventDefault();
            return;
        }
    }
    if (key === "a") {
        state.setTool("polygon");
        event.preventDefault();
    } else if (key === "s") {
        state.setTool("scissors");
        event.preventDefault();
    } else if (key === "w") {
        state.setTool("wall");
        event.preventDefault();
    } else if (key === "p") {
        if (selectionCanUsePaintTool()) state.setTool("paint");
        event.preventDefault();
    } else if (key === "v") {
        state.setTool("select");
        event.preventDefault();
    }
}, true);

document.addEventListener("keyup", (event) => {
    if (event.key === "Shift") state.shiftKeyDown = false;
    if (String(event.key || "").toLowerCase() === "w") {
        playtestForwardPressed = false;
    }
    if (String(event.key || "").toLowerCase() === "z") {
        rotatingView = false;
        rotatePointerX = null;
    }
}, true);

window.addEventListener("blur", () => {
    state.shiftKeyDown = false;
    rotatingView = false;
    rotatePointerX = null;
    lastZTapTime = 0;
    playtestForwardPressed = false;
});

function isTextEditingTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    const tagName = target.tagName.toLowerCase();
    return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

new ResizeObserver(resizeStage).observe(stageHost);
resizeStage();
renderer.render();
try {
    state.loadWallToolSettingsFromBrowser();
    state.loadColumnToolSettingsFromBrowser();
    state.loadStairToolSettingsFromBrowser();
} catch (error) {
    console.error(error);
    setStatus(error.message, true);
}
syncUi();
showBuildingOpenDialog({ canClose: false }).catch((error) => {
    console.error(error);
    setStatus(error.message, true);
    setModalMessage(buildingOpenMessage, error.message, true);
});
loadWallTextures().catch((error) => {
    console.error(error);
    setStatus(error.message, true);
});
loadRoofTextures().catch((error) => {
    console.error(error);
    setStatus(error.message, true);
});
loadFloorTextures().catch((error) => {
    console.error(error);
    setStatus(error.message, true);
});
Promise.all([
    loadMountedObjectAssets("doors"),
    loadMountedObjectAssets("windows")
]).then(() => {
    state.loadMountedObjectToolSettingsFromBrowser();
    syncUi();
}).catch((error) => {
    console.error(error);
    setStatus(error.message, true);
});
