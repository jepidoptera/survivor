import { BuildingEditorState } from "./BuildingEditorState.js";
import { BuildingRenderer } from "./BuildingRenderer.js";
import { EditTool } from "./tools/EditTool.js";
import { PaintTool } from "./tools/PaintTool.js";
import { PolygonEditTool } from "./tools/PolygonEditTool.js";
import { SelectTool } from "./tools/SelectTool.js";
import { WallTool } from "./tools/WallTool.js";
import { getBuildingFloors, getBuildingWalls, getFloorElevation, getFloorId } from "./BuildingModel.js";

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
const floorElevation = document.querySelector("#floorElevation");
const floorHeight = document.querySelector("#floorHeight");
const floorTexture = document.querySelector("#floorTexture");
const roofTexture = document.querySelector("#roofTexture");
const wallHeight = document.querySelector("#wallHeight");
const wallTexture = document.querySelector("#wallTexture");
const snapToggle = document.querySelector("#snapToggle");
const anchorToggle = document.querySelector("#anchorToggle");
const selectedSummary = document.querySelector("#selectedSummary");
const paintToolButton = document.querySelector('[data-tool="paint"]');

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
window.__buildingEditorDebugState = state;
window.__buildingEditorDepthContext = {
    depth: contextAttributes.depth === true,
    stencil: contextAttributes.stencil === true,
    antialias: contextAttributes.antialias === true
};
const renderer = new BuildingRenderer(app, state);
const tools = {
    edit: new EditTool(state),
    polygon: new PolygonEditTool(state, "add"),
    scissors: new PolygonEditTool(state, "subtract"),
    wall: new WallTool(state),
    paint: new PaintTool(state),
    select: new SelectTool(state)
};

let panning = null;
let touchGesture = null;
let hasCenteredInitialFloor = false;
let activeToolMode = "floor";
let rotatingView = false;
let rotatePointerX = null;
let lastStagePointer = null;
let layerPanelSignature = "";
let texturePaletteSignature = "";

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

async function loadImageFolderTextures(folder) {
    const response = await fetch(`/api/assets/images/${encodeURIComponent(folder)}`, { cache: "no-cache" });
    if (!response.ok) {
        throw new Error(`could not load ${folder} texture list`);
    }
    const payload = await response.json();
    const files = normalizeImagePathList(payload && payload.files, folder);
    if (!files.length) {
        throw new Error(`${folder} texture list is empty`);
    }
    return files;
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
    let textures = [];
    try {
        textures = await loadImageFolderTextures("walls");
    } catch (error) {
        console.warn(error);
        textures = await loadWallTextureManifest();
    }
    MATERIALS.walls = textures;
    PAINT_TEXTURES.walls = textures;
    texturePaletteSignature = "";
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
    return tools[state.tool];
}

function toolIsVisibleInMode(element) {
    const visibleIn = element.dataset.toolVisibleIn;
    if (!visibleIn) return true;
    return visibleIn.split(/\s+/).includes(activeToolMode);
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
    const mode = activeToolMode === "walls" ? "walls" : "floor";
    const textures = PAINT_TEXTURES[mode] || [];
    const selected = state.paintTextureForMode(mode);
    texturePalette.hidden = state.tool !== "paint";
    texturePalette.setAttribute("aria-label", `${mode === "walls" ? "wall" : "floor"} textures`);
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

function syncUi() {
    document.querySelectorAll("[data-tool-mode]").forEach((button) => {
        button.dataset.active = button.dataset.toolMode === activeToolMode ? "true" : "false";
    });
    document.querySelectorAll("[data-tool]").forEach((button) => {
        button.dataset.active = button.dataset.tool === state.tool ? "true" : "false";
    });
    document.querySelectorAll("[data-tool-visible-in]").forEach((element) => {
        element.hidden = !toolIsVisibleInMode(element);
    });
    renderTexturePalette();

    syncSelectOptions(floorTexture, MATERIALS.floors);
    syncSelectOptions(roofTexture, MATERIALS.roofs);
    syncSelectOptions(wallTexture, MATERIALS.walls);

    const selectedFloor = state.selectedFloor();
    const selectedWall = state.selectedWall();
    const floors = getBuildingFloors(state.building);
    const walls = getBuildingWalls(state.building);
    renderLayerPanel(floors);
    if (selectedFloor) {
        floorElevation.value = getFloorElevation(selectedFloor);
        floorHeight.value = Number(selectedFloor.floorHeight);
        floorTexture.value = selectedFloor.floorTexturePath;
        roofTexture.value = selectedFloor.roofTexturePath;
    }
    if (selectedWall) {
        wallHeight.value = selectedWall.height;
        wallTexture.value = selectedWall.wallTexturePath;
        const endpointText = state.selection.wallEndpointKey ? `, ${state.selection.wallEndpointKey}` : "";
        selectedSummary.textContent = `wall ${selectedWall.id}${endpointText}, floor ${selectedWall.floorId}, height ${selectedWall.height}`;
    } else if (selectedFloor && state.selection.ringKind) {
        selectedSummary.textContent = `${getFloorId(selectedFloor)}, ${state.selection.ringKind} vertex ${state.selection.vertexIndex}`;
    } else if (selectedFloor) {
        const floorWallCount = walls.filter((wall) => (wall.fragmentId || wall.floorId) === getFloorId(selectedFloor)).length;
        wallHeight.value = selectedFloor.defaultWallHeight;
        wallTexture.value = selectedFloor.defaultWallTexturePath;
        selectedSummary.textContent = `${getFloorId(selectedFloor)}, elevation ${getFloorElevation(selectedFloor)}, ${floorWallCount} walls`;
    } else {
        selectedSummary.textContent = "nothing selected";
    }
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
            state.editorMode = activeToolMode;
            state.setTool(button.dataset.tool);
        });
    });
});

texturePalette.addEventListener("click", (event) => {
    const swatch = event.target.closest(".textureSwatch");
    if (!swatch || !texturePalette.contains(swatch)) return;
    withErrorBoundary(() => {
        state.setPaintTexture(activeToolMode === "walls" ? "walls" : "floor", swatch.dataset.texturePath);
    });
});

document.querySelectorAll("[data-tool-mode]").forEach((button) => {
    button.addEventListener("click", () => {
        withErrorBoundary(() => {
            activeToolMode = button.dataset.toolMode;
            state.editorMode = activeToolMode;
            const currentToolButton = document.querySelector(`[data-tool="${state.tool}"]`);
            if (!currentToolButton || !toolIsVisibleInMode(currentToolButton)) {
                state.setTool(activeToolMode === "walls" ? "wall" : "edit");
                return;
            }
            if (activeToolMode === "walls") {
                state.setTool(state.tool === "wall" ? "wall" : "edit");
                return;
            }
            syncUi();
        });
    });
});

document.querySelector("#finishDraft").addEventListener("click", () => {
    withErrorBoundary(() => {
        if (typeof activeTool().finish === "function") activeTool().finish();
    });
});

document.querySelector("#cancelDraft").addEventListener("click", () => {
    withErrorBoundary(() => {
        if (typeof activeTool().cancel === "function") activeTool().cancel();
    });
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
        state.selectFloorLayer(card.dataset.floorId);
    });
});

floorElevation.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedFloorElevation(floorElevation.value));
});

floorHeight.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedFloorHeight(floorHeight.value));
});

floorTexture.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedFloorTexture(floorTexture.value));
});

roofTexture.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedRoofTexture(roofTexture.value));
});

wallHeight.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedWallHeight(wallHeight.value));
});

wallTexture.addEventListener("change", () => {
    withErrorBoundary(() => state.updateSelectedWallTexture(wallTexture.value));
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
        if (original.button === 1 || original.button === 2) {
            panning = {
                screen: { x: event.data.global.x, y: event.data.global.y },
                camera: { ...state.camera }
            };
            return;
        }
        const thresholdPixels = state.tool === "edit" ? 10 : 14;
        const threshold = renderer.screenPixelsToWorldDistance(thresholdPixels);
        activeTool().pointerDown(worldFromEvent(event), threshold, {
            shiftKey: !!((original && original.shiftKey) || state.shiftKeyDown),
            doubleClick: !!(original && Number(original.detail) >= 2)
        });
    });
});

app.stage.on("pointermove", (event) => {
    withErrorBoundary(() => {
        const original = event.data.originalEvent;
        if (original && original.pointerType === "touch") return;
        lastStagePointer = { x: event.data.global.x, y: event.data.global.y };
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
            activeTool().pointerMove(worldFromEvent(event));
        }
    });
});

app.stage.on("pointerup", (event) => {
    if (typeof activeTool().pointerUp === "function") activeTool().pointerUp(worldFromEvent(event));
    panning = null;
});

app.stage.on("pointerupoutside", (event) => {
    if (typeof activeTool().pointerUp === "function") activeTool().pointerUp(worldFromEvent(event));
    panning = null;
});

stageHost.addEventListener("wheel", (event) => {
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
                activeTool().pointerDown(renderer.screenToWorld(touchGesture.startPoint), threshold, {
                    shiftKey: false,
                    doubleClick: false
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
    if (isTextEditingTarget(event.target)) return;
    if (event.key === "Shift") state.shiftKeyDown = true;
    const key = String(event.key || "").toLowerCase();
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
        const tool = activeTool();
        if (tool && typeof tool.cancel === "function" && state.draft) {
            tool.cancel();
            event.preventDefault();
        }
        return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && state.tool === "edit") {
        if (state.selection.wallId && state.deleteSelectedWall()) {
            event.preventDefault();
            return;
        }
        if (state.editorMode === "floor" && state.deleteSelectedFloorVertex()) {
            event.preventDefault();
            return;
        }
    }
    if (key === "a") {
        activeToolMode = "floor";
        state.editorMode = activeToolMode;
        state.setTool("polygon");
        event.preventDefault();
    } else if (key === "s") {
        activeToolMode = "floor";
        state.editorMode = activeToolMode;
        state.setTool("scissors");
        event.preventDefault();
    } else if (key === "e") {
        state.editorMode = activeToolMode;
        state.setTool("edit");
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
syncUi();
loadWallTextures().catch((error) => {
    console.error(error);
    setStatus(error.message, true);
});
