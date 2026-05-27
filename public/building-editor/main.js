import { BuildingEditorState } from "./BuildingEditorState.js";
import { BuildingRenderer } from "./BuildingRenderer.js";
import { PaintTool } from "./tools/PaintTool.js";
import { MountedObjectTool } from "./tools/MountedObjectTool.js";
import { PolygonEditTool } from "./tools/PolygonEditTool.js";
import { SelectTool } from "./tools/SelectTool.js";
import { WallTool } from "./tools/WallTool.js";
import { findFloor, getBuildingMountedObjects, getBuildingFloors, getBuildingWalls, getFloorElevation, getFloorId, wallCenterlinePoints } from "./BuildingModel.js";

const MATERIALS = {
    floors: [
        "/assets/images/flooring/black.png",
        "/assets/images/flooring/cave.jpg",
        "/assets/images/flooring/cobblestones.png",
        "/assets/images/flooring/dirt.jpg",
        "/assets/images/flooring/woodfloor.png"
    ],
    roofs: [
        "/assets/images/roofs/slate.png",
        "/assets/images/roofs/smallshingles.png",
        "/assets/images/roofs/thatch.png"
    ],
    walls: [
        "/assets/images/walls/stonewall.png",
        "/assets/images/walls/woodwall.png"
    ]
};

const PAINT_TEXTURES = {
    floor: [
        "/assets/images/flooring/black.png",
        "/assets/images/flooring/cave.jpg",
        "/assets/images/flooring/woodfloor.png",
        "/assets/images/flooring/cobblestones.png",
        "/assets/images/flooring/dirt.jpg"
    ],
    roofs: [
        "/assets/images/roofs/slate.png",
        "/assets/images/roofs/smallshingles.png",
        "/assets/images/roofs/thatch.png"
    ],
    walls: [
        "/assets/images/walls/stonewall.png",
        "/assets/images/walls/woodwall.png"
    ]
};

const stageHost = document.querySelector("#stageHost");
const statusText = document.querySelector("#statusText");
const jsonText = document.querySelector("#jsonText");
const layerPanel = document.querySelector("#layerPanel");
const texturePalette = document.querySelector("#texturePalette");
const mountTexturePalette = document.querySelector("#mountTexturePalette");
const windowContextMenu = document.querySelector("#windowContextMenu");
const floorElevation = document.querySelector("#floorElevation");
const floorHeight = document.querySelector("#floorHeight");
const roofOverhang = document.querySelector("#roofOverhang");
const roofPeakHeight = document.querySelector("#roofPeakHeight");
const wallHeight = document.querySelector("#wallHeight");
const mountSize = document.querySelector("#mountSize");
const mountSizeValue = document.querySelector("#mountSizeValue");
const mountAspect = document.querySelector("#mountAspect");
const mountAspectValue = document.querySelector("#mountAspectValue");
const mountTextureButton = document.querySelector("#mountTextureButton");
const snapToggle = document.querySelector("#snapToggle");
const anchorToggle = document.querySelector("#anchorToggle");
const selectedSummary = document.querySelector("#selectedSummary");
const paintToolButton = document.querySelector('[data-tool="paint"]');
const wallToolButton = document.querySelector(".wallToolButton");
const wallToolIcon = document.querySelector("#wallToolIcon");
const mountToolButtons = [...document.querySelectorAll("[data-mount-category]")];

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
let loadedBrowserSaveOnStartup = false;
let browserSaveStartupError = null;
if (state.hasBrowserSave()) {
    try {
        state.loadFromBrowser();
        loadedBrowserSaveOnStartup = true;
    } catch (error) {
        console.error(error);
        browserSaveStartupError = error;
    }
}
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
    paint: new PaintTool(state),
    select: new SelectTool(state)
};

let panning = null;
let touchGesture = null;
let hasCenteredInitialFloor = false;
let rotatingView = false;
let rotatePointerX = null;
let lastStagePointer = null;
let layerPanelSignature = "";
let texturePaletteSignature = "";
let wallToolTexturePaletteOpen = false;
let mountTexturePaletteSignature = "";
let mountTexturePaletteOpen = false;
let windowContext = null;

const MOUNTED_OBJECT_ASSETS = {
    doors: [],
    windows: []
};
const MOUNT_ASPECT_LOG_BASE = 2;

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

function normalizeImagePathList(values, folder) {
    const prefix = `/assets/images/${folder}/`;
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => String(value || ""))
        .filter((value) => value.startsWith(prefix) && /\.(png|jpe?g|webp|gif)$/i.test(value)))]
        .sort((a, b) => textureName(a).localeCompare(textureName(b)));
}

async function loadWallTextureManifest() {
    const response = await fetch("/assets/images/walls/items.json", { cache: "no-cache" });
    if (!response.ok) {
        throw new Error("could not load wall texture manifest");
    }
    const payload = await response.json();
    const files = normalizeImagePathList((payload.items || []).map((item) => item && item.texturePath), "walls");
    if (!files.length) {
        throw new Error("wall texture manifest is empty");
    }
    return files;
}

async function loadWallTextures() {
    const textures = await loadWallTextureManifest();
    MATERIALS.walls = textures;
    PAINT_TEXTURES.walls = textures;
    texturePaletteSignature = "";
    syncUi();
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
            aspectRatio: firstAsset.width / firstAsset.height
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

function activeTool() {
    return tools[state.tool] || tools.select;
}

function draftConsumesEscape(draft) {
    return draft && (draft.kind === "polygonEdit" || draft.kind === "wall");
}

function activePaintMode() {
    if (state.tool === "wall") return "walls";
    const kind = state.selection && state.selection.kind;
    if (kind === "roof") return "roofs";
    return kind === "wall" || kind === "wallEndpoint" ? "walls" : "floor";
}

function selectionCanUsePaintTool() {
    if (state.tool === "wall") return true;
    const kind = state.selection && state.selection.kind;
    return kind === "floor" || kind === "floorVertex" || kind === "roof" || kind === "wall" || kind === "wallEndpoint";
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

function closeWindowContextMenu() {
    windowContextMenu.hidden = true;
    windowContext = null;
}

function applyTextureToSelection(texturePath) {
    if (state.tool === "wall") {
        state.updateWallToolTexture(texturePath);
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
    if (kind === "roof") {
        state.updateSelectedRoofTexture(texturePath);
        return;
    }
    throw new Error(`cannot paint texture for ${kind || "empty"} selection`);
}

function selectionScopeMatches(element) {
    if (mountedObjectSettingsActive()) return false;
    const exclude = element.dataset.selectionExclude;
    const kind = state.selection && state.selection.kind;
    if (exclude && exclude.split(/\s+/).includes(kind)) return false;
    const scope = element.dataset.selectionScope;
    if (!scope) return true;
    if (state.tool === "wall") {
        return scope.split(/\s+/).includes("wall");
    }
    return scope.split(/\s+/).includes(kind);
}

function toolScopeMatches(element) {
    const include = element.dataset.toolScope;
    const activeScopes = [state.tool];
    if (mountedObjectSettingsActive()) activeScopes.push("mountObject");
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

function sharedWallValue(selectedWalls, readValue, fallback) {
    if (!selectedWalls.length) return fallback;
    const firstValue = readValue(selectedWalls[0]);
    return selectedWalls.every((wall) => readValue(wall) === firstValue) ? firstValue : fallback;
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
    if (!wallToolButton || !wallToolIcon) return;
    const texture = state.wallTool && state.wallTool.texture ? state.wallTool.texture : state.inputs.wallTexture;
    wallToolIcon.style.backgroundImage = texture ? `url("${texture}")` : "";
    wallToolButton.title = texture ? `Place walls: ${textureName(texture)}` : "Place walls";
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
    const button = document.createElement("button");
    button.type = "button";
    button.className = "layerCard";
    button.dataset.selected = selected ? "true" : "false";
    if (selectAll) {
        button.dataset.layerSelectAll = "true";
        button.dataset.allSelected = allSelected ? "true" : "false";
    } else {
        button.dataset.floorId = getFloorId(floor);
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
        button.appendChild(svg);
    } else {
        button.appendChild(createLayerPreview(floor));
    }

    const label = document.createElement("span");
    const name = document.createElement("span");
    name.className = "layerName";
    name.textContent = selectAll ? "whole building" : getFloorId(floor);
    const meta = document.createElement("span");
    meta.className = "layerMeta";
    meta.textContent = selectAll ? "exterior view" : `z ${getFloorElevation(floor)} h ${Number(floor.floorHeight)}`;
    label.appendChild(name);
    label.appendChild(meta);
    button.appendChild(label);
    return button;
}

function createLayerRow(floor, selected) {
    const row = document.createElement("div");
    row.className = "layerRow";
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
    const selected = state.tool === "wall" ? state.wallTool.texture : state.paintTextureForMode(mode);
    if (state.tool !== "wall") wallToolTexturePaletteOpen = false;
    texturePalette.hidden = !((state.tool === "paint" || wallToolTexturePaletteOpen) && selectionCanUsePaintTool());
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
    if (texturePalette.hidden || !paintToolButton) return;
    const buttonRect = paintToolButton.getBoundingClientRect();
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
        if (card) card.dataset.selected = !allSelected && state.isFloorSelected(getFloorId(floor)) ? "true" : "false";
    });
}

function renderLayerPanel(floors) {
    const nextSignature = floors
        .map((floor) => layerGeometrySignature(floor))
        .sort()
        .join("||") || "empty";
    if (nextSignature === layerPanelSignature) {
        updateLayerPanelSelection(floors);
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
    [...floors]
        .sort((a, b) => getFloorElevation(b) - getFloorElevation(a))
        .forEach((floor) => {
            layerPanel.appendChild(createLayerRow(floor, !allSelected && state.isFloorSelected(getFloorId(floor))));
        });
}

function summarizeSelection(selectedFloor, selectedWall, floors, walls) {
    const selection = state.selection || { kind: "building" };
    if (state.tool === "wall") {
        return `wall tool, height ${Number(state.wallTool.height)}`;
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
        return `wall ${selectedWall.id}${endpointText}, level ${selectedWall.floorId}, height ${selectedWall.height}`;
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
        return `${floorId} roof`;
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
    if (wallToolButton) wallToolButton.dataset.active = state.tool === "wall" ? "true" : "false";
    syncWallToolButtonTexture();
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
    renderLayerPanel(floors);
    if (selectedFloor) {
        floorElevation.value = getFloorElevation(selectedFloor);
        floorHeight.value = Number(selectedFloor.floorHeight);
        roofOverhang.value = Number(selectedFloor.roofOverhang);
        roofPeakHeight.value = Number(selectedFloor.roofPeakHeight);
    }
    if (state.tool === "wall") {
        wallHeight.value = Number(state.wallTool.height);
        if (paintToolButton) paintToolButton.title = `Paint texture: ${textureName(state.wallTool.texture)}`;
    } else if (selectedWalls.length > 0) {
        wallHeight.value = sharedWallValue(selectedWalls, (wall) => wall.height, state.inputs.wallHeight);
    } else if (selectedFloor) {
        wallHeight.value = selectedFloor.defaultWallHeight;
    }
    const mountAsset = state.selectedMountedObjectAsset();
    if (mountAsset) {
        mountSize.value = Number(mountAsset.size);
        mountAspect.value = aspectRatioToSliderValue(mountAsset.aspectRatio);
        mountSizeValue.value = Number(mountAsset.size).toFixed(2);
        mountAspectValue.value = Number(mountAsset.aspectRatio).toFixed(2);
        mountTextureButton.title = `Paint texture: ${textureName(mountAsset.texturePath)}`;
    }
    selectedSummary.textContent = summarizeSelection(selectedFloor, selectedWall, floors, walls);
    snapToggle.checked = state.snapToGrid;
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
            wallToolTexturePaletteOpen = false;
            state.setTool(state.tool === button.dataset.tool ? "select" : button.dataset.tool);
        });
    });
});

texturePalette.addEventListener("click", (event) => {
    const swatch = event.target.closest(".textureSwatch");
    if (!swatch || !texturePalette.contains(swatch)) return;
    withErrorBoundary(() => {
        const mode = activePaintMode();
        const texturePath = swatch.dataset.texturePath;
        state.setPaintTexture(mode, texturePath);
        applyTextureToSelection(texturePath);
        wallToolTexturePaletteOpen = false;
        if (state.tool !== "wall") {
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
            mountTexturePaletteOpen = false;
            state.setMountedObjectToolCategory(button.dataset.mountCategory);
        });
    });
});

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

document.querySelector("#duplicateFloor").addEventListener("click", () => {
    withErrorBoundary(() => state.duplicateSelectedFloor());
});

document.querySelector("#saveBrowser").addEventListener("click", () => {
    withErrorBoundary(() => {
        state.saveToBrowser();
        setStatus("saved in browser storage");
    });
});

document.querySelector("#loadBrowser").addEventListener("click", () => {
    withErrorBoundary(() => state.loadFromBrowser());
});

document.querySelector("#resetBrowser").addEventListener("click", () => {
    if (!window.confirm("Reset the building editor to the default box and overwrite the browser save?")) return;
    withErrorBoundary(() => {
        state.reset();
        state.saveToBrowser();
        renderer.render();
        syncUi();
        setStatus("reset to default building and saved");
    });
});

document.querySelector("#importJson").addEventListener("click", () => {
    withErrorBoundary(() => state.import(jsonText.value));
});

layerPanel.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-floor-id]");
    if (deleteButton && layerPanel.contains(deleteButton)) {
        withErrorBoundary(() => state.deleteFloor(deleteButton.dataset.deleteFloorId));
        return;
    }
    const card = event.target.closest(".layerCard");
    if (!card || !layerPanel.contains(card)) return;
    withErrorBoundary(() => {
        if (card.dataset.layerSelectAll === "true") {
            state.selectAllFloors();
            return;
        }
        state.selectFloor(card.dataset.floorId);
    });
});

floorElevation.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedFloorElevation(floorElevation.value));
});

floorHeight.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedFloorHeight(floorHeight.value));
});

roofOverhang.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedRoofOverhang(roofOverhang.value));
});

roofPeakHeight.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedRoofPeakHeight(roofPeakHeight.value));
});

wallHeight.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedWallHeight(wallHeight.value));
});

snapToggle.addEventListener("change", () => {
    state.snapToGrid = snapToggle.checked;
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
    if (event.key === "Escape" && !windowContextMenu.hidden) {
        closeWindowContextMenu();
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
    if ((event.key === "Delete" || event.key === "Backspace") && state.tool === "select") {
        if (state.deleteSelectedMountedObject()) {
            event.preventDefault();
            return;
        }
        if (state.selectedWall() && state.deleteSelectedWall()) {
            event.preventDefault();
            return;
        }
        if (state.deleteSelectedFloorVertex()) {
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
    if (String(event.key || "").toLowerCase() === "z") {
        rotatingView = false;
        rotatePointerX = null;
    }
}, true);

window.addEventListener("blur", () => {
    state.shiftKeyDown = false;
    rotatingView = false;
    rotatePointerX = null;
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
} catch (error) {
    console.error(error);
    setStatus(error.message, true);
}
syncUi();
if (loadedBrowserSaveOnStartup) {
    setStatus("loaded browser-saved building");
} else if (browserSaveStartupError) {
    setStatus(`could not load browser-saved building: ${browserSaveStartupError.message}`, true);
}
loadWallTextures().catch((error) => {
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
