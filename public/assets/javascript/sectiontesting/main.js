import {
    axialToPixel,
    pixelToAxial,
    sectionIdFromCoord
} from "./geometry.js";
import { CompositeMap, WorldGraph } from "./world.js";

const canvas = document.getElementById("sectiontesting-canvas");
const statsEl = document.getElementById("sectiontesting-stats");
const bannerEl = document.getElementById("sectiontesting-banner");
const radiusInput = document.getElementById("section-radius");
const rebuildButton = document.getElementById("rebuild-world");
const randomDestinationButton = document.getElementById("random-destination");
const regenerateButton = document.getElementById("toggle-obstacles");
const wallDrawModeButton = document.getElementById("wall-draw-mode");
const clearWallsButton = document.getElementById("clear-walls");
const showSectionCentersCheckbox = document.getElementById("show-section-centers");
const showGlobalCoordsCheckbox = document.getElementById("show-global-coords");
const showWallBlockersCheckbox = document.getElementById("show-wall-blockers");
const ctx = canvas.getContext("2d");

const appState = {
    radius: 10,
    worldGraph: null,
    compositeMap: null,
    playerCell: null,
    hoveredCell: null,
    destinationCell: null,
    path: [],
    displayedPath: [],
    zoom: 1,
    cellSizeBase: 18,
    camera: { x: 0, y: 0 },
    cameraFollowLerp: 0.18,
    lastStepAt: 0,
    moveDelayMs: 85,
    obstacleSeedSalt: "seed-0",
    interactionMode: "path",
    wallDragStartCell: null,
    wallDragCurrentCell: null
};

const KEY_TO_ADJACENT_DIRECTION = {
    q: 1,
    w: 3,
    e: 5,
    d: 7,
    s: 9,
    a: 11
};

function initializeWorld(radius, options = {}) {
    appState.radius = radius;
    appState.worldGraph = new WorldGraph(radius, { seedSalt: appState.obstacleSeedSalt });
    appState.compositeMap = new CompositeMap(appState.worldGraph, sectionIdFromCoord({ q: 0, r: 0 }));
    appState.playerCell = appState.compositeMap.getCellAt(0, 0) || appState.compositeMap.getRandomOpenCell();
    appState.destinationCell = null;
    appState.hoveredCell = null;
    appState.path = [];
    appState.displayedPath = [];
    appState.camera.x = 0;
    appState.camera.y = 0;
    if (options.keepZoom !== true) {
        appState.zoom = Math.max(0.55, Math.min(2.4, 10 / radius));
    }
    centerCameraOnPlayer();
    updateBanner("Section-testing world rebuilt.");
    syncStats();
}

function centerCameraOnPlayer() {
    if (!appState.playerCell) return;
    const pixel = axialToPixel(appState.playerCell.globalCoord, getCellSize());
    appState.camera.x = pixel.x;
    appState.camera.y = pixel.y;
}

function worldToScreen(globalCoord) {
    const pixel = axialToPixel(globalCoord, getCellSize());
    return {
        x: pixel.x - appState.camera.x + canvas.clientWidth * 0.5,
        y: pixel.y - appState.camera.y + canvas.clientHeight * 0.5
    };
}

function screenToWorld(screenX, screenY) {
    const worldX = screenX + appState.camera.x - canvas.clientWidth * 0.5;
    const worldY = screenY + appState.camera.y - canvas.clientHeight * 0.5;
    return pixelToAxial(worldX, worldY, getCellSize());
}

function getCellSize() {
    return appState.cellSizeBase * appState.zoom;
}

function syncStats() {
    if (!statsEl || !appState.compositeMap || !appState.playerCell) return;
    const loadedIds = appState.compositeMap.getLoadedSectionIds();
    const overlapCount = appState.compositeMap.overlapWarnings.length;
    const wallCount = appState.worldGraph ? appState.worldGraph.getWalls().length : 0;
    const blockedLinkCount = appState.compositeMap ? appState.compositeMap.blockedLinks.length : 0;
    const destinationText = appState.destinationCell
        ? `${appState.destinationCell.globalCoord.q}, ${appState.destinationCell.globalCoord.r}`
        : "none";
    const hoveredText = appState.hoveredCell
        ? `${appState.hoveredCell.globalCoord.q}, ${appState.hoveredCell.globalCoord.r}`
        : "none";

    statsEl.innerHTML = [
        `<p><strong>Loaded sections:</strong> ${loadedIds.length} (${loadedIds.join(", ")})</p>`,
        `<p><strong>Center section:</strong> ${appState.compositeMap.centerSectionId}</p>`,
        `<p><strong>Player:</strong> ${appState.playerCell.sectionId} at ${appState.playerCell.globalCoord.q}, ${appState.playerCell.globalCoord.r}</p>`,
        `<p><strong>Destination:</strong> ${destinationText}</p>`,
        `<p><strong>Hovered:</strong> ${hoveredText}</p>`,
        `<p><strong>Path length:</strong> ${Array.isArray(appState.displayedPath) ? Math.max(0, appState.displayedPath.length - 1) : 0}</p>`,
        `<p><strong>Mode:</strong> ${appState.interactionMode} | <strong>Walls:</strong> ${wallCount} | <strong>Blocked links:</strong> ${blockedLinkCount}</p>`,
        `<p><strong>Radius:</strong> ${appState.radius} | <strong>Stride:</strong> ${appState.radius * 2 - 1}</p>`,
        `<p><strong>Overlap warnings:</strong> ${overlapCount}</p>`
    ].join("");
}

function updateBanner(text) {
    if (!bannerEl) return;
    bannerEl.textContent = text;
}

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw() {
    updateCameraFollow();
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    drawSections();
    drawWalls();
    drawPaths();
    drawCells();
    drawPlayer();
    syncStats();
}

function drawWalls() {
    if (!appState.worldGraph || !appState.compositeMap) return;

    if (showWallBlockersCheckbox.checked) {
        for (let i = 0; i < appState.compositeMap.blockedLinks.length; i++) {
            const link = appState.compositeMap.blockedLinks[i];
            const fromScreen = worldToScreen(link.fromCell.globalCoord);
            const toScreen = worldToScreen(link.toCell.globalCoord);
            ctx.strokeStyle = "rgba(255, 101, 101, 0.55)";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(fromScreen.x, fromScreen.y);
            ctx.lineTo(toScreen.x, toScreen.y);
            ctx.stroke();
        }
    }

    const walls = appState.worldGraph.getWalls();
    for (let i = 0; i < walls.length; i++) {
        drawWallSegment(walls[i], "rgba(255, 224, 138, 0.96)", 3);
    }

    if (appState.interactionMode === "wall" && appState.wallDragStartCell && appState.wallDragCurrentCell) {
        drawWallSegment({
            startGlobalCoord: appState.wallDragStartCell.globalCoord,
            endGlobalCoord: appState.wallDragCurrentCell.globalCoord
        }, "rgba(140, 212, 255, 0.9)", 2, [8, 6]);
    }
}

function drawWallSegment(wall, color, lineWidth, dash = []) {
    const startScreen = worldToScreen(wall.startGlobalCoord);
    const endScreen = worldToScreen(wall.endGlobalCoord);
    ctx.save();
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(startScreen.x, startScreen.y);
    ctx.lineTo(endScreen.x, endScreen.y);
    ctx.stroke();
    ctx.restore();
}

function drawSections() {
    if (!showSectionCentersCheckbox.checked) return;
    for (const instance of appState.compositeMap.instancesById.values()) {
        const centerScreen = worldToScreen(instance.globalCenter);
        ctx.fillStyle = instance.asset.sectionColor.banner;
        ctx.beginPath();
        ctx.arc(centerScreen.x, centerScreen.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        ctx.font = "12px Georgia";
        ctx.textAlign = "center";
        ctx.fillText(instance.id.replace("section:", ""), centerScreen.x, centerScreen.y - 12);
    }
}

function drawCells() {
    const cellSize = getCellSize();
    const pathKeys = new Set((appState.displayedPath || []).map((cell) => cell.globalKey));
    for (const cell of appState.compositeMap.globalCells.values()) {
        const screen = worldToScreen(cell.globalCoord);
        if (!isOnScreen(screen.x, screen.y, cellSize * 1.5)) continue;

        const sectionInstance = appState.compositeMap.instancesById.get(cell.sectionId);
        const fill = cell.blocked
            ? "rgba(23, 26, 29, 0.96)"
            : sectionInstance.asset.sectionColor.fill;
        const stroke = cell.blocked
            ? "rgba(0, 0, 0, 0.85)"
            : "rgba(255,255,255,0.08)";
        drawHex(screen.x, screen.y, cellSize - 0.8, fill, stroke, 1);

        if (pathKeys.has(cell.globalKey)) {
            drawHex(screen.x, screen.y, cellSize - 4, "rgba(237, 197, 76, 0.52)", "rgba(255, 241, 194, 0.8)", 1);
        }

        if (appState.hoveredCell && appState.hoveredCell.globalKey === cell.globalKey) {
            drawHex(screen.x, screen.y, cellSize - 3, "rgba(116, 196, 255, 0.22)", "rgba(116, 196, 255, 0.95)", 2);
        }
    }
}

function updateCameraFollow() {
    if (!appState.playerCell) return;
    const pixel = axialToPixel(appState.playerCell.globalCoord, getCellSize());
    const lerp = Math.max(0.01, Math.min(1, Number(appState.cameraFollowLerp) || 0.18));
    appState.camera.x += (pixel.x - appState.camera.x) * lerp;
    appState.camera.y += (pixel.y - appState.camera.y) * lerp;
}

function drawPaths() {
    if (!Array.isArray(appState.displayedPath) || appState.displayedPath.length < 2) return;
    ctx.strokeStyle = "rgba(255, 233, 143, 0.95)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < appState.displayedPath.length; i++) {
        const cell = appState.displayedPath[i];
        const screen = worldToScreen(cell.globalCoord);
        if (i === 0) ctx.moveTo(screen.x, screen.y);
        else ctx.lineTo(screen.x, screen.y);
    }
    ctx.stroke();
}

function drawPlayer() {
    if (!appState.playerCell) return;
    const screen = worldToScreen(appState.playerCell.globalCoord);
    ctx.fillStyle = "rgba(120, 241, 181, 0.95)";
    ctx.strokeStyle = "rgba(15, 29, 20, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, Math.max(5, getCellSize() * 0.33), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (showGlobalCoordsCheckbox.checked) {
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = "12px Georgia";
        ctx.textAlign = "left";
        ctx.fillText(
            `${appState.playerCell.globalCoord.q}, ${appState.playerCell.globalCoord.r}`,
            screen.x + 12,
            screen.y - 10
        );
    }
}

function drawHex(centerX, centerY, radius, fillStyle, strokeStyle, lineWidth) {
    const corners = getHexCorners(centerX, centerY, radius);
    ctx.beginPath();
    for (let i = 0; i < corners.length; i++) {
        const corner = corners[i];
        if (i === 0) ctx.moveTo(corner.x, corner.y);
        else ctx.lineTo(corner.x, corner.y);
    }
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
}

function getHexCorners(centerX, centerY, radius) {
    const corners = [];
    for (let i = 0; i < 6; i++) {
        const angle = ((60 * i) - 30) * (Math.PI / 180);
        corners.push({
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle)
        });
    }
    return corners;
}

function isOnScreen(x, y, margin = 0) {
    return (
        x >= -margin &&
        x <= canvas.clientWidth + margin &&
        y >= -margin &&
        y <= canvas.clientHeight + margin
    );
}

function setDestination(cell) {
    if (!cell || cell.blocked || !appState.playerCell) return;
    appState.destinationCell = cell;
    appState.path = appState.compositeMap.findPath(appState.playerCell, cell) || [];
    appState.displayedPath = Array.isArray(appState.path) ? appState.path.slice() : [];
    if (!appState.path.length) {
        updateBanner(`No loaded path from ${appState.playerCell.sectionId} to ${cell.sectionId}.`);
    } else {
        updateBanner(
            `Pathing from ${appState.playerCell.sectionId} to ${cell.sectionId} across ${Math.max(0, appState.path.length - 1)} steps.`
        );
    }
}

function setInteractionMode(mode) {
    appState.interactionMode = mode === "wall" ? "wall" : "path";
    appState.wallDragStartCell = null;
    appState.wallDragCurrentCell = null;
    wallDrawModeButton.classList.toggle("active", appState.interactionMode === "wall");
}

function rebuildDirectionalBlocking() {
    if (!appState.compositeMap) return;
    appState.compositeMap.applyWallDirectionalBlocking();
    if (appState.destinationCell && appState.playerCell) {
        appState.path = appState.compositeMap.findPath(appState.playerCell, appState.destinationCell) || [];
        appState.displayedPath = Array.isArray(appState.path) ? appState.path.slice() : [];
    }
}

function placeDraggedWall(startCell, endCell) {
    if (!startCell || !endCell) return;
    const wall = appState.worldGraph.addWall(startCell, endCell);
    if (!wall) {
        updateBanner("Wall placement needs two different tiles.");
        return;
    }
    rebuildDirectionalBlocking();
    updateBanner(
        `Wall ${wall.id} placed from ${startCell.globalCoord.q}, ${startCell.globalCoord.r} to ${endCell.globalCoord.q}, ${endCell.globalCoord.r}.`
    );
}

function recenterOnPlayer() {
    if (!appState.playerCell || !appState.compositeMap) return;
    if (appState.playerCell.sectionId === appState.compositeMap.centerSectionId) return;
    const currentDestinationKey = appState.destinationCell ? appState.destinationCell.globalKey : null;
    appState.compositeMap.loadBubble(appState.playerCell.sectionId);
    appState.playerCell = appState.compositeMap.getCellByGlobalKey(appState.playerCell.globalKey) || appState.playerCell;
    appState.destinationCell = currentDestinationKey ? appState.compositeMap.getCellByGlobalKey(currentDestinationKey) : null;
    if (appState.destinationCell && appState.playerCell) {
        appState.path = appState.compositeMap.findPath(appState.playerCell, appState.destinationCell) || [];
    } else {
        appState.path = [];
        appState.displayedPath = [];
    }
    updateBanner(`Recentered active bubble on ${appState.compositeMap.centerSectionId}.`);
}

function advancePlayer(now) {
    if (!Array.isArray(appState.path) || appState.path.length <= 1) return;
    if (now - appState.lastStepAt < appState.moveDelayMs) return;
    appState.lastStepAt = now;
    appState.path.shift();
    appState.playerCell = appState.path[0] || appState.playerCell;
    if (appState.playerCell && appState.playerCell.sectionId !== appState.compositeMap.centerSectionId) {
        recenterOnPlayer();
    }
    if (appState.path.length <= 1) {
        appState.destinationCell = null;
        updateBanner(`Arrived in ${appState.playerCell.sectionId}.`);
    }
}

function bindEvents() {
    window.addEventListener("resize", resizeCanvas);

    canvas.addEventListener("mousemove", (event) => {
        const rect = canvas.getBoundingClientRect();
        const axial = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
        appState.hoveredCell = appState.compositeMap.getCellAt(axial.q, axial.r);
        if (appState.interactionMode === "wall" && appState.wallDragStartCell) {
            appState.wallDragCurrentCell = appState.hoveredCell;
        }
    });

    canvas.addEventListener("mouseleave", () => {
        appState.hoveredCell = null;
        appState.wallDragCurrentCell = null;
    });

    canvas.addEventListener("mousedown", (event) => {
        const rect = canvas.getBoundingClientRect();
        const axial = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
        const cell = appState.compositeMap.getCellAt(axial.q, axial.r);
        if (!cell) return;
        if (appState.interactionMode === "wall") {
            appState.wallDragStartCell = cell;
            appState.wallDragCurrentCell = cell;
            return;
        }
        setDestination(cell);
    });

    canvas.addEventListener("mouseup", (event) => {
        if (appState.interactionMode !== "wall") return;
        const rect = canvas.getBoundingClientRect();
        const axial = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
        const endCell = appState.compositeMap.getCellAt(axial.q, axial.r);
        const startCell = appState.wallDragStartCell;
        appState.wallDragStartCell = null;
        appState.wallDragCurrentCell = null;
        if (startCell && endCell) {
            placeDraggedWall(startCell, endCell);
        }
    });

    canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        const delta = Math.sign(event.deltaY);
        appState.zoom = Math.max(0.35, Math.min(3.2, appState.zoom * (delta > 0 ? 0.92 : 1.08)));
    }, { passive: false });

    rebuildButton.addEventListener("click", () => {
        const nextRadius = sanitizeRadiusInput();
        initializeWorld(nextRadius);
    });

    randomDestinationButton.addEventListener("click", () => {
        const randomCell = appState.compositeMap.getRandomOpenCell();
        if (randomCell) setDestination(randomCell);
    });

    regenerateButton.addEventListener("click", () => {
        appState.obstacleSeedSalt = `seed-${Date.now()}`;
        initializeWorld(sanitizeRadiusInput(), { keepZoom: true });
    });

    wallDrawModeButton.addEventListener("click", () => {
        setInteractionMode(appState.interactionMode === "wall" ? "path" : "wall");
        updateBanner(
            appState.interactionMode === "wall"
                ? "Wall draw mode enabled. Drag from one tile to another."
                : "Path mode enabled."
        );
    });

    clearWallsButton.addEventListener("click", () => {
        appState.worldGraph.clearWalls();
        rebuildDirectionalBlocking();
        updateBanner("Cleared all sandbox walls.");
    });

    document.addEventListener("keydown", (event) => {
        const key = String(event.key || "").toLowerCase();
        if (key === "r") {
            recenterOnPlayer();
            return;
        }
        if (!(key in KEY_TO_ADJACENT_DIRECTION)) return;
        event.preventDefault();
        const directionIndex = KEY_TO_ADJACENT_DIRECTION[key];
        const current = appState.playerCell;
        if (!current) return;
        const next = appState.compositeMap.getNeighbors(current).find((entry) => entry.directionIndex === directionIndex);
        if (!next || !next.cell || next.cell.blocked) return;
        appState.path = [];
        appState.displayedPath = [];
        appState.destinationCell = null;
        appState.playerCell = next.cell;
        if (appState.playerCell.sectionId !== appState.compositeMap.centerSectionId) {
            recenterOnPlayer();
        }
        updateBanner(`Stepped into ${appState.playerCell.sectionId}.`);
    });
}

function sanitizeRadiusInput() {
    const raw = Math.floor(Number(radiusInput.value) || 10);
    const normalized = Math.max(3, Math.min(20, raw));
    radiusInput.value = String(normalized);
    return normalized;
}

function frame(now) {
    advancePlayer(now);
    draw();
    requestAnimationFrame(frame);
}

function boot() {
    resizeCanvas();
    initializeWorld(sanitizeRadiusInput());
    setInteractionMode("path");
    bindEvents();
    requestAnimationFrame(frame);
}

boot();
