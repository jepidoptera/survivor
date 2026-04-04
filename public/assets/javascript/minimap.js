// minimap.js — Toggle-able mini-map overlay (Ctrl+M)
// Renders the entire game map onto a small canvas in the lower-right corner.
// Colors: walls=gray, trees=bright green, roads=light brown,
//         animals=brownish red, wizard=white, ground=green.

(function () {
    "use strict";

    // ---- colour palette ----
    const COL_GROUND   = "#007700";   // grass
    const COL_WALL     = "#999999";   // gray
    const COL_TREE     = "#00aa00";   // bright green
    const COL_ROAD     = "#c4a46c";   // light brown
    const COL_ANIMAL   = "#8b3a2a";   // brownish red
    const COL_WIZARD   = "#ffffff";   // white dot for player
    const COL_VIEWPORT = "rgba(255,255,255,0.35)"; // viewport rectangle outline
    const PROTOTYPE_MINIMAP_WINDOW_SIZE = 256;

    let visible = false;
    let canvas  = null;
    let ctx     = null;
    let rafId   = null;
    let wrapper = null;   // container div that holds canvas + resize handle

    // Off-screen buffer for the static layer (trees, walls, roads).
    // Rebuilt only when dirty (toggle, resize, or explicit invalidation).
    let staticCanvas = null;
    let staticCtx    = null;
    let staticDirty  = true;
    let lastMapRef   = null;

    // User-chosen size (null = use default 1/6 of screen)
    let userWidth  = null;
    let userHeight = null;
    const MIN_SIZE = 60;

    // Resize-drag state
    let dragging    = false;
    let dragStartX  = 0;
    let dragStartY  = 0;
    let dragStartW  = 0;
    let dragStartH  = 0;
    const HANDLE_SIZE = 18;

    function isInResizeHandle(clientX, clientY) {
        if (!wrapper || wrapper.style.display === "none") return false;
        const rect = wrapper.getBoundingClientRect();
        return (
            clientX >= rect.left &&
            clientX <= rect.left + HANDLE_SIZE &&
            clientY >= rect.top &&
            clientY <= rect.top + HANDLE_SIZE
        );
    }

    function centerViewportOnWorldPoint(worldX, worldY) {
        if (typeof viewport === "undefined" || !viewport || typeof map === "undefined" || !map) return;
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return;

        let focusX = worldX;
        let focusY = worldY;
        const currentCenterX = Number(viewport.x) + Number(viewport.width) * 0.5;
        const currentCenterY = Number(viewport.y) + Number(viewport.height) * 0.5;
        if (typeof map.shortestDeltaX === "function" && Number.isFinite(currentCenterX)) {
            focusX = currentCenterX + map.shortestDeltaX(currentCenterX, worldX);
        }
        if (typeof map.shortestDeltaY === "function" && Number.isFinite(currentCenterY)) {
            focusY = currentCenterY + map.shortestDeltaY(currentCenterY, worldY);
        }

        viewport.x = focusX - viewport.width * 0.5;
        viewport.y = focusY - viewport.height * 0.5;
        viewport.prevX = viewport.x;
        viewport.prevY = viewport.y;

        if (typeof globalThis !== "undefined") {
            globalThis.minimapCameraDetachState = {
                active: true,
                wizardRef: (typeof wizard !== "undefined" && wizard) ? wizard : null,
                wizardX: (typeof wizard !== "undefined" && wizard) ? Number(wizard.x) : null,
                wizardY: (typeof wizard !== "undefined" && wizard) ? Number(wizard.y) : null
            };
            if (typeof globalThis.presentGameFrame === "function") {
                globalThis.presentGameFrame();
            }
        }
    }

    function handleMinimapClick(event) {
        if (!canvas || typeof map === "undefined" || !map || typeof viewport === "undefined" || !viewport) return;
        if (dragging) return;
        if (isInResizeHandle(event.clientX, event.clientY)) return;

        const rect = canvas.getBoundingClientRect();
        const localX = event.clientX - rect.left;
        const localY = event.clientY - rect.top;
        if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return;

        event.preventDefault();
        event.stopPropagation();

        let worldX;
        let worldY;
        if (typeof map.getLoadedPrototypeNodes === "function" && typeof wizard !== "undefined" && wizard) {
            const halfWindow = PROTOTYPE_MINIMAP_WINDOW_SIZE * 0.5;
            worldX = Number(wizard.x) - halfWindow + (localX / rect.width) * PROTOTYPE_MINIMAP_WINDOW_SIZE;
            worldY = Number(wizard.y) - halfWindow + (localY / rect.height) * PROTOTYPE_MINIMAP_WINDOW_SIZE;
        } else {
            const worldW = Number(map.worldWidth);
            const worldH = Number(map.worldHeight);
            if (!(worldW > 0) || !(worldH > 0)) return;
            worldX = (localX / rect.width) * worldW;
            worldY = (localY / rect.height) * worldH;
        }
        centerViewportOnWorldPoint(worldX, worldY);
    }

    // ---- helpers ----
    function ensureCanvas() {
        if (canvas) return;

        // Wrapper div — holds canvas + resize handle, positioned fixed bottom-right
        wrapper = document.createElement("div");
        wrapper.id = "minimap-wrapper";
        wrapper.style.cssText =
            "position:fixed;bottom:12px;right:12px;z-index:9999;" +
            "border:2px solid rgba(255,255,255,0.5);border-radius:4px;" +
            "background:#000;display:none;line-height:0;pointer-events:auto;";
        document.body.appendChild(wrapper);

        canvas = document.createElement("canvas");
        canvas.id = "minimap";
        canvas.style.cssText =
            "display:block;image-rendering:pixelated;pointer-events:auto;";
        wrapper.appendChild(canvas);
        ctx = canvas.getContext("2d");
        canvas.addEventListener("click", handleMinimapClick);

        // Resize handle — small triangle in the top-left corner (since the
        // minimap is anchored bottom-right, dragging top-left feels natural)
        const handle = document.createElement("div");
        handle.style.cssText =
            "position:absolute;top:0;left:0;width:18px;height:18px;" +
            "cursor:none;z-index:1;pointer-events:none;" +
            "background:linear-gradient(135deg,rgba(255,255,255,0.45) 40%,transparent 40%);";
        wrapper.appendChild(handle);

        // --- drag logic ---
        function onGlobalPointerDown(e) {
            if (e.button !== 0) return;
            if (!isInResizeHandle(e.clientX, e.clientY)) return;
            e.preventDefault();
            e.stopPropagation();
            dragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            dragStartW = canvas.width;
            dragStartH = canvas.height;
        }

        function onGlobalPointerMove(e) {
            if (!dragging) return;
            // Top-left handle: moving left/up = bigger, right/down = smaller
            const dx = dragStartX - e.clientX;
            const dy = dragStartY - e.clientY;
            const newW = Math.max(MIN_SIZE, Math.round(dragStartW + dx));
            const newH = Math.max(MIN_SIZE, Math.round(dragStartH + dy));
            applySize(newW, newH);
        }

        function onGlobalPointerUp() {
            if (!dragging) return;
            dragging = false;
        }

        window.addEventListener("pointerdown", onGlobalPointerDown, true);
        window.addEventListener("pointermove", onGlobalPointerMove);
        window.addEventListener("pointerup", onGlobalPointerUp);

        staticCanvas = document.createElement("canvas");
        staticCtx = staticCanvas.getContext("2d");
    }

    function applySize(w, h) {
        w = Math.max(MIN_SIZE, w);
        h = Math.max(MIN_SIZE, h);
        if (canvas.width === w && canvas.height === h) return;
        userWidth  = w;
        userHeight = h;
        canvas.width  = w;
        canvas.height = h;
        staticCanvas.width  = w;
        staticCanvas.height = h;
        wrapper.style.width  = w + "px";
        wrapper.style.height = h + "px";
        staticDirty = true;
    }

    function sizeCanvas() {
        if (userWidth !== null && userHeight !== null) {
            applySize(userWidth, userHeight);
            return;
        }
        // Default: 1/6 of main screen
        const w = Math.round(window.innerWidth  / 6);
        const h = Math.round(window.innerHeight / 6);
        applySize(w, h);
    }

    // Align to pixel edges and cover the full projected bounds so resize-driven
    // rounding never leaves background seams between adjacent cells.
    function drawDot(target, px, py, nomW, nomH, colour) {
        target.fillStyle = colour;
        const startX = Math.floor(px);
        const startY = Math.floor(py);
        const endX = Math.ceil(px + Math.max(1, nomW));
        const endY = Math.ceil(py + Math.max(1, nomH));
        const w = Math.max(1, endX - startX);
        const h = Math.max(1, endY - startY);
        target.fillRect(startX, startY, w, h);
    }

    function drawWallSegment(target, mapRef, mw, mh, ax, ay, bx, by, lineWidth) {
        if (
            !Number.isFinite(ax) ||
            !Number.isFinite(ay) ||
            !Number.isFinite(bx) ||
            !Number.isFinite(by)
        ) {
            return;
        }

        const worldW = Number(mapRef && mapRef.worldWidth);
        const worldH = Number(mapRef && mapRef.worldHeight);
        if (!(worldW > 0) || !(worldH > 0)) return;

        let endX = bx;
        let endY = by;
        if (mapRef && typeof mapRef.shortestDeltaX === "function") {
            endX = ax + mapRef.shortestDeltaX(ax, bx);
        }
        if (mapRef && typeof mapRef.shortestDeltaY === "function") {
            endY = ay + mapRef.shortestDeltaY(ay, by);
        }

        const startPx = (ax / worldW) * mw;
        const startPy = (ay / worldH) * mh;
        const endPx = (endX / worldW) * mw;
        const endPy = (endY / worldH) * mh;

        target.strokeStyle = COL_WALL;
        target.lineWidth = Math.max(1, lineWidth);
        target.lineCap = "round";
        target.beginPath();
        target.moveTo(startPx, startPy);
        target.lineTo(endPx, endPy);
        target.stroke();
    }

    function drawObjectTypeOnMinimap(target, mapRef, mw, mh, dotW, dotH, type, x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const worldW = Number(mapRef && mapRef.worldWidth);
        const worldH = Number(mapRef && mapRef.worldHeight);
        if (!(worldW > 0) || !(worldH > 0)) return;
        const px = (x / worldW) * mw;
        const py = (y / worldH) * mh;
        if (type === "tree") {
            drawDot(target, px, py, dotW, dotH, COL_TREE);
        } else if (type === "road") {
            drawDot(target, px, py, dotW, dotH, COL_ROAD);
        }
    }

    function drawWallSectionOnMinimap(target, mapRef, mw, mh, lineWidth, drawnWallSections, obj) {
        if (!obj || obj.type !== "wallSection" || obj.gone) return;
        if (drawnWallSections.has(obj)) return;
        const start = obj.startPoint;
        const end = obj.endPoint;
        if (!start || !end) return;
        drawWallSegment(
            target,
            mapRef,
            mw,
            mh,
            Number(start.x),
            Number(start.y),
            Number(end.x),
            Number(end.y),
            lineWidth
        );
        drawnWallSections.add(obj);
    }

    function getPrototypeMinimapWindow() {
        const wizardRef = (typeof wizard !== "undefined" && wizard) ? wizard : null;
        const centerX = wizardRef ? Number(wizardRef.x) : 0;
        const centerY = wizardRef ? Number(wizardRef.y) : 0;
        const size = PROTOTYPE_MINIMAP_WINDOW_SIZE;
        const halfSize = size * 0.5;
        return {
            centerX,
            centerY,
            minX: centerX - halfSize,
            maxX: centerX + halfSize,
            minY: centerY - halfSize,
            maxY: centerY + halfSize,
            width: size,
            height: size
        };
    }

    function projectPrototypePoint(windowRect, mw, mh, worldX, worldY) {
        return {
            x: ((Number(worldX) - windowRect.minX) / windowRect.width) * mw,
            y: ((Number(worldY) - windowRect.minY) / windowRect.height) * mh
        };
    }

    function isPointInsidePrototypeWindow(windowRect, worldX, worldY, padding = 0) {
        return (
            Number(worldX) >= (windowRect.minX - padding) &&
            Number(worldX) <= (windowRect.maxX + padding) &&
            Number(worldY) >= (windowRect.minY - padding) &&
            Number(worldY) <= (windowRect.maxY + padding)
        );
    }

    function clipLineSegmentToPrototypeWindow(windowRect, ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        let t0 = 0;
        let t1 = 1;

        const clip = (p, q) => {
            if (Math.abs(p) <= 1e-9) {
                return q >= 0;
            }
            const r = q / p;
            if (p < 0) {
                if (r > t1) return false;
                if (r > t0) t0 = r;
                return true;
            }
            if (r < t0) return false;
            if (r < t1) t1 = r;
            return true;
        };

        if (
            !clip(-dx, ax - windowRect.minX) ||
            !clip(dx, windowRect.maxX - ax) ||
            !clip(-dy, ay - windowRect.minY) ||
            !clip(dy, windowRect.maxY - ay)
        ) {
            return null;
        }

        return {
            ax: ax + (dx * t0),
            ay: ay + (dy * t0),
            bx: ax + (dx * t1),
            by: ay + (dy * t1)
        };
    }

    function collectPrototypeMinimapWallSections(mapRef, loadedNodes) {
        const walls = [];
        const seenWalls = new Set();

        const addWall = (wall) => {
            if (!wall || wall.type !== "wallSection" || wall.gone || seenWalls.has(wall)) return;
            if (!wall.startPoint || !wall.endPoint) return;
            seenWalls.add(wall);
            walls.push(wall);
        };

        if (mapRef && typeof mapRef.getGameObjects === "function") {
            const gameObjects = mapRef.getGameObjects();
            if (Array.isArray(gameObjects)) {
                for (let i = 0; i < gameObjects.length; i++) {
                    addWall(gameObjects[i]);
                }
            }
        }

        if (mapRef && Array.isArray(mapRef.gameObjects)) {
            for (let i = 0; i < mapRef.gameObjects.length; i++) {
                addWall(mapRef.gameObjects[i]);
            }
        }

        if (
            typeof globalThis !== "undefined" &&
            globalThis.WallSectionUnit &&
            globalThis.WallSectionUnit._allSections instanceof Map
        ) {
            for (const wall of globalThis.WallSectionUnit._allSections.values()) {
                addWall(wall);
            }
        }

        if (walls.length === 0 && Array.isArray(loadedNodes)) {
            for (let i = 0; i < loadedNodes.length; i++) {
                const node = loadedNodes[i];
                if (!node || !Array.isArray(node.objects)) continue;
                for (let j = 0; j < node.objects.length; j++) {
                    addWall(node.objects[j]);
                }
            }
        }

        return walls;
    }

    function drawPrototypeWallSegment(target, windowRect, mw, mh, lineWidth, ax, ay, bx, by) {
        if (
            !Number.isFinite(ax) ||
            !Number.isFinite(ay) ||
            !Number.isFinite(bx) ||
            !Number.isFinite(by)
        ) {
            return;
        }
        const clipped = clipLineSegmentToPrototypeWindow(windowRect, ax, ay, bx, by);
        if (!clipped) return;

        const startPx = projectPrototypePoint(windowRect, mw, mh, clipped.ax, clipped.ay);
        const endPx = projectPrototypePoint(windowRect, mw, mh, clipped.bx, clipped.by);
        target.strokeStyle = COL_WALL;
        target.lineWidth = Math.max(1, lineWidth);
        target.lineCap = "round";
        target.beginPath();
        target.moveTo(startPx.x, startPx.y);
        target.lineTo(endPx.x, endPx.y);
        target.stroke();
    }

    function drawPrototypeMinimap(target) {
        if (typeof map === "undefined" || !map || typeof map.getLoadedPrototypeNodes !== "function") return;

        const mw = target.canvas.width;
        const mh = target.canvas.height;
        const loadedNodes = map.getLoadedPrototypeNodes();
        const windowRect = getPrototypeMinimapWindow();
        const wallSections = collectPrototypeMinimapWallSections(map, loadedNodes);
        const tileScale = mw / PROTOTYPE_MINIMAP_WINDOW_SIZE;
        const dotW = Math.max(1, tileScale * 0.95);
        const dotH = Math.max(1, tileScale * 0.95);
        const lineWidth = Math.max(1, tileScale * 0.9);

        target.fillStyle = "#000000";
        target.fillRect(0, 0, mw, mh);

        for (let i = 0; i < loadedNodes.length; i++) {
            const node = loadedNodes[i];
            if (!node || !isPointInsidePrototypeWindow(windowRect, node.x, node.y, 1.5)) continue;
            const point = projectPrototypePoint(windowRect, mw, mh, node.x, node.y);
            const nodeColor = (typeof map.getMinimapNodeColor === "function")
                ? map.getMinimapNodeColor(node)
                : COL_GROUND;
            if (typeof nodeColor === "string" && nodeColor.length > 0) {
                drawDot(target, point.x, point.y, dotW, dotH, nodeColor);
            }
            if (!node.objects || node.objects.length === 0) continue;
            for (let oi = 0; oi < node.objects.length; oi++) {
                const obj = node.objects[oi];
                if (!obj) continue;
                if (obj.type !== "wallSection" && Number.isFinite(obj.x) && Number.isFinite(obj.y) && isPointInsidePrototypeWindow(windowRect, obj.x, obj.y, 2)) {
                    const objPoint = projectPrototypePoint(windowRect, mw, mh, obj.x, obj.y);
                    if (obj.type === "tree") {
                        drawDot(target, objPoint.x, objPoint.y, dotW, dotH, COL_TREE);
                    } else if (obj.type === "road") {
                        drawDot(target, objPoint.x, objPoint.y, dotW, dotH, COL_ROAD);
                    }
                }
            }
        }

        for (let i = 0; i < wallSections.length; i++) {
            const wall = wallSections[i];
            drawPrototypeWallSegment(
                target,
                windowRect,
                mw,
                mh,
                lineWidth,
                Number(wall.startPoint.x),
                Number(wall.startPoint.y),
                Number(wall.endPoint.x),
                Number(wall.endPoint.y)
            );
        }

        if (typeof animals !== "undefined" && Array.isArray(animals)) {
            for (let i = 0; i < animals.length; i++) {
                const a = animals[i];
                if (!a || a.hp <= 0 || !isPointInsidePrototypeWindow(windowRect, a.x, a.y, 2)) continue;
                const point = projectPrototypePoint(windowRect, mw, mh, a.x, a.y);
                drawDot(target, point.x, point.y, Math.max(dotW, 2), Math.max(dotH, 2), COL_ANIMAL);
            }
        }

        if (typeof wizard !== "undefined" && wizard) {
            const point = projectPrototypePoint(windowRect, mw, mh, wizard.x, wizard.y);
            const size = Math.max(3, tileScale * 2);
            drawDot(target, point.x - size / 2, point.y - size / 2, size, size, COL_WIZARD);
        }

        if (typeof viewport !== "undefined" && viewport && viewport.width > 0) {
            const topLeft = projectPrototypePoint(windowRect, mw, mh, viewport.x, viewport.y);
            const vpW = (Number(viewport.width) / windowRect.width) * mw;
            const vpH = (Number(viewport.height) / windowRect.height) * mh;
            target.strokeStyle = COL_VIEWPORT;
            target.lineWidth = 1;
            target.strokeRect(topLeft.x, topLeft.y, vpW, vpH);
        }
    }

    // ---- build the static layer (entire map, all nodes) ----
    function rebuildStatic() {
        if (typeof map === "undefined" || !map || !map.nodes) return;

        const mw = staticCanvas.width;
        const mh = staticCanvas.height;
        const worldW = map.worldWidth;
        const worldH = map.worldHeight;
        if (!Number.isFinite(worldW) || !Number.isFinite(worldH) || worldW <= 0 || worldH <= 0) return;
        const dotW = Math.max(1, mw / map.width);
        const dotH = Math.max(1, mh / map.height);
        const wallLineWidth = Math.max(1, Math.min(dotW, dotH));
        const drawnWallSections = new Set();

        // Clear to black so unloaded / inactive sections are obvious.
        staticCtx.fillStyle = "#000000";
        staticCtx.fillRect(0, 0, mw, mh);

        const prototypeMap = typeof map.getLoadedPrototypeNodes === "function";

        if (prototypeMap) {
            const prototypeNodes = (typeof map.getAllPrototypeNodes === "function")
                ? map.getAllPrototypeNodes()
                : [];
            for (let i = 0; i < prototypeNodes.length; i++) {
                const node = prototypeNodes[i];
                if (!node || node._prototypeVoid === true) continue;
                const px = (node.x / worldW) * mw;
                const py = (node.y / worldH) * mh;
                drawDot(staticCtx, px, py, dotW, dotH, "#010101");
            }
        } else {
            // Walk every node on the map
            for (let xi = 0; xi < map.width; xi++) {
                const col = map.nodes[xi];
                if (!col) continue;
                for (let yi = 0; yi < map.height; yi++) {
                    const node = col[yi];
                    if (!node) continue;
                const px = (node.x / worldW) * mw;
                const py = (node.y / worldH) * mh;
                const nodeColor = (typeof map.getMinimapNodeColor === "function")
                    ? map.getMinimapNodeColor(node)
                    : COL_GROUND;
                if (typeof nodeColor === "string" && nodeColor.length > 0) {
                    drawDot(staticCtx, px, py, dotW, dotH, nodeColor);
                }
                const nodeIsActive = (typeof map.isPrototypeNodeActive === "function")
                    ? map.isPrototypeNodeActive(node)
                    : true;
                if (!node || !nodeIsActive || !node.objects || node.objects.length === 0) continue;

                for (let oi = 0; oi < node.objects.length; oi++) {
                    const obj = node.objects[oi];
                    if (!obj) continue;
                    const t = obj.type;
                    if (t === "wallSection") {
                        drawWallSectionOnMinimap(staticCtx, map, mw, mh, wallLineWidth, drawnWallSections, obj);
                    } else if (t === "tree") {
                        drawDot(staticCtx, px, py, dotW, dotH, COL_TREE);
                    } else if (t === "road") {
                        drawDot(staticCtx, px, py, dotW, dotH, COL_ROAD);
                    }
                }
            }
            }
        }

        // Also render from map.objects so static items not currently attached to
        // node lists still appear on the minimap.
        if (!prototypeMap && Array.isArray(map.objects)) {
            for (let i = 0; i < map.objects.length; i++) {
                const obj = map.objects[i];
                if (!obj || !obj.type) continue;
                if (
                    typeof map.worldToNode === "function" &&
                    typeof map.isPrototypeNodeActive === "function"
                ) {
                    const ownerNode = map.worldToNode(obj.x, obj.y);
                    if (ownerNode && !map.isPrototypeNodeActive(ownerNode)) continue;
                }
                if (obj.type === "wallSection") {
                    drawWallSectionOnMinimap(staticCtx, map, mw, mh, wallLineWidth, drawnWallSections, obj);
                    continue;
                }
                drawObjectTypeOnMinimap(staticCtx, map, mw, mh, dotW, dotH, obj.type, obj.x, obj.y);
            }
        }

        // Include lazy records that may not be hydrated into map nodes yet.
        if (!prototypeMap && typeof getLazyRoadRecordsForMinimap === "function") {
            const lazyRoads = getLazyRoadRecordsForMinimap();
            for (let i = 0; i < lazyRoads.length; i++) {
                const rec = lazyRoads[i];
                if (!rec) continue;
                drawObjectTypeOnMinimap(staticCtx, map, mw, mh, dotW, dotH, "road", rec.x, rec.y);
            }
        }
        if (!prototypeMap && typeof getLazyTreeRecordsForMinimap === "function") {
            const lazyTrees = getLazyTreeRecordsForMinimap();
            for (let i = 0; i < lazyTrees.length; i++) {
                const rec = lazyTrees[i];
                if (!rec) continue;
                drawObjectTypeOnMinimap(staticCtx, map, mw, mh, dotW, dotH, "tree", rec.x, rec.y);
            }
        }

        staticDirty = false;
    }

    // ---- main paint (called every frame while visible) ----
    function paint() {
        if (!visible || !canvas || typeof map === "undefined" || !map || !map.nodes) return;

        if (map !== lastMapRef) {
            lastMapRef = map;
            staticDirty = true;
        }

        ensureCanvas();
        sizeCanvas();

        if (typeof map.getLoadedPrototypeNodes === "function") {
            drawPrototypeMinimap(ctx);
            return;
        }

        // Rebuild static layer if needed (first open, resize, or manual invalidation)
        if (staticDirty) rebuildStatic();

        const mw = canvas.width;
        const mh = canvas.height;
        const worldW = map.worldWidth;
        const worldH = map.worldHeight;
        const dotW = Math.max(1, mw / map.width);
        const dotH = Math.max(1, mh / map.height);

        // Blit the cached static layer
        ctx.drawImage(staticCanvas, 0, 0);

        if (typeof map.getLoadedPrototypeNodes === "function") {
            const loadedNodes = map.getLoadedPrototypeNodes();
            const drawnWallSections = new Set();
            for (let i = 0; i < loadedNodes.length; i++) {
                const node = loadedNodes[i];
                if (!node) continue;
                const px = (node.x / worldW) * mw;
                const py = (node.y / worldH) * mh;
                const nodeColor = (typeof map.getMinimapNodeColor === "function")
                    ? map.getMinimapNodeColor(node)
                    : COL_GROUND;
                if (typeof nodeColor === "string" && nodeColor.length > 0) {
                    drawDot(ctx, px, py, dotW, dotH, nodeColor);
                }
                if (!node.objects || node.objects.length === 0) continue;
                for (let oi = 0; oi < node.objects.length; oi++) {
                    const obj = node.objects[oi];
                    if (!obj) continue;
                    if (obj.type === "wallSection") {
                        drawWallSectionOnMinimap(ctx, map, mw, mh, Math.max(1, Math.min(dotW, dotH)), drawnWallSections, obj);
                    } else {
                        drawObjectTypeOnMinimap(ctx, map, mw, mh, dotW, dotH, obj.type, obj.x, obj.y);
                    }
                }
            }
        }

        // -- dynamic: animals --
        if (typeof animals !== "undefined" && Array.isArray(animals)) {
            for (let i = 0; i < animals.length; i++) {
                const a = animals[i];
                if (!a || a.hp <= 0) continue;
                const px = (a.x / worldW) * mw;
                const py = (a.y / worldH) * mh;
                drawDot(ctx, px, py, Math.max(dotW, 2), Math.max(dotH, 2), COL_ANIMAL);
            }
        }

        // -- dynamic: wizard (player) --
        if (typeof wizard !== "undefined" && wizard) {
            const px = (wizard.x / worldW) * mw;
            const py = (wizard.y / worldH) * mh;
            const size = Math.max(3, dotW * 2);
            drawDot(ctx, px - size / 2, py - size / 2, size, size, COL_WIZARD);
        }

        // -- dynamic: viewport rectangle --
        if (typeof viewport !== "undefined" && viewport && viewport.width > 0) {
            const tlx = (viewport.x / worldW) * mw;
            const tly = (viewport.y / worldH) * mh;
            const vpW = (viewport.width  / worldW) * mw;
            const vpH = (viewport.height / worldH) * mh;
            ctx.strokeStyle = COL_VIEWPORT;
            ctx.lineWidth = 1;
            ctx.strokeRect(tlx, tly, vpW, vpH);
        }
    }

    // ---- animation loop ----
    function loop() {
        if (!visible) { rafId = null; return; }
        paint();
        rafId = requestAnimationFrame(loop);
    }

    function start() {
        if (rafId !== null) return;
        loop();
    }

    function stop() {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    // ---- public toggle ----
    function toggle() {
        visible = !visible;
        ensureCanvas();
        wrapper.style.display = visible ? "block" : "none";
        if (visible) {
            sizeCanvas();
            staticDirty = true;
            start();
        } else {
            stop();
        }
    }

    // Respond to window resize (only reset to default if user hasn't manually resized)
    window.addEventListener("resize", function () {
        if (!visible) return;
        if (userWidth === null) { sizeCanvas(); }
        staticDirty = true;
    });

    // Expose toggle globally so runaround.js key handler can call it
    window.toggleMinimap = toggle;

    // Allow other code to force a static‐layer rebuild (e.g. after placing a wall/road)
    window.invalidateMinimap = function () { staticDirty = true; };
})();
