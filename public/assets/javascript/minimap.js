// minimap.js — Toggle-able mini-map overlay (Ctrl+M)
// Renders the entire game map onto a small canvas in the lower-right corner.
// Colors: walls=gray, trees=dark green, roads=light brown,
//         animals=brownish red, wizard=white, ground=very dark green.

(function () {
    "use strict";

    // ---- colour palette ----
    const COL_GROUND   = "#0a1f0a";   // very dark green (forest floor)
    const COL_WALL     = "#999999";   // gray
    const COL_TREE     = "#0b3d0b";   // dark green
    const COL_ROAD     = "#c4a46c";   // light brown
    const COL_ANIMAL   = "#8b3a2a";   // brownish red
    const COL_WIZARD   = "#ffffff";   // white dot for player
    const COL_VIEWPORT = "rgba(255,255,255,0.35)"; // viewport rectangle outline

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

    // ---- helpers ----
    function ensureCanvas() {
        if (canvas) return;

        // Wrapper div — holds canvas + resize handle, positioned fixed bottom-right
        wrapper = document.createElement("div");
        wrapper.id = "minimap-wrapper";
        wrapper.style.cssText =
            "position:fixed;bottom:12px;right:12px;z-index:9999;" +
            "border:2px solid rgba(255,255,255,0.5);border-radius:4px;" +
            "background:#000;display:none;line-height:0;";
        document.body.appendChild(wrapper);

        canvas = document.createElement("canvas");
        canvas.id = "minimap";
        canvas.style.cssText =
            "display:block;image-rendering:pixelated;pointer-events:none;";
        wrapper.appendChild(canvas);
        ctx = canvas.getContext("2d");

        // Resize handle — small triangle in the top-left corner (since the
        // minimap is anchored bottom-right, dragging top-left feels natural)
        const handle = document.createElement("div");
        handle.style.cssText =
            "position:absolute;top:0;left:0;width:18px;height:18px;" +
            "cursor:ew-resize;z-index:1;" +
            "background:linear-gradient(135deg,rgba(255,255,255,0.45) 40%,transparent 40%);";
        wrapper.appendChild(handle);

        // --- drag logic ---
        function onPointerDown(e) {
            e.preventDefault();
            e.stopPropagation();
            dragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            dragStartW = canvas.width;
            dragStartH = canvas.height;
            handle.setPointerCapture(e.pointerId);
        }
        function onPointerMove(e) {
            if (!dragging) return;
            e.preventDefault();
            // Top-left handle: moving left/up = bigger, right/down = smaller
            const dx = dragStartX - e.clientX;
            const dy = dragStartY - e.clientY;
            const newW = Math.max(MIN_SIZE, Math.round(dragStartW + dx));
            const newH = Math.max(MIN_SIZE, Math.round(dragStartH + dy));
            applySize(newW, newH);
        }
        function onPointerUp(e) {
            if (!dragging) return;
            dragging = false;
            try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
        }
        handle.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);

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

    // Draw a filled rect that is at least 1×1 pixel.
    function drawDot(target, px, py, nomW, nomH, colour) {
        target.fillStyle = colour;
        const w = Math.max(1, Math.round(nomW));
        const h = Math.max(1, Math.round(nomH));
        target.fillRect(Math.round(px), Math.round(py), w, h);
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

        function drawObjectType(type, x, y) {
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            const px = (x / worldW) * mw;
            const py = (y / worldH) * mh;
            if (type === "wallSection") {
                drawDot(staticCtx, px, py, dotW, dotH, COL_WALL);
            } else if (type === "tree") {
                drawDot(staticCtx, px, py, dotW, dotH, COL_TREE);
            } else if (type === "road") {
                drawDot(staticCtx, px, py, dotW, dotH, COL_ROAD);
            }
        }

        // Clear to ground colour
        staticCtx.fillStyle = COL_GROUND;
        staticCtx.fillRect(0, 0, mw, mh);

        // Walk every node on the map
        for (let xi = 0; xi < map.width; xi++) {
            const col = map.nodes[xi];
            if (!col) continue;
            for (let yi = 0; yi < map.height; yi++) {
                const node = col[yi];
                if (!node || !node.objects || node.objects.length === 0) continue;

                const px = (node.x / worldW) * mw;
                const py = (node.y / worldH) * mh;

                for (let oi = 0; oi < node.objects.length; oi++) {
                    const obj = node.objects[oi];
                    if (!obj) continue;
                    const t = obj.type;
                    if (t === "wallSection") {
                        drawDot(staticCtx, px, py, dotW, dotH, COL_WALL);
                    } else if (t === "tree") {
                        drawDot(staticCtx, px, py, dotW, dotH, COL_TREE);
                    } else if (t === "road") {
                        drawDot(staticCtx, px, py, dotW, dotH, COL_ROAD);
                    }
                }
            }
        }

        // Also render from map.objects so static items not currently attached to
        // node lists still appear on the minimap.
        if (Array.isArray(map.objects)) {
            for (let i = 0; i < map.objects.length; i++) {
                const obj = map.objects[i];
                if (!obj || !obj.type) continue;
                drawObjectType(obj.type, obj.x, obj.y);
            }
        }

        // Include lazy records that may not be hydrated into map nodes yet.
        if (typeof getLazyRoadRecordsForMinimap === "function") {
            const lazyRoads = getLazyRoadRecordsForMinimap();
            for (let i = 0; i < lazyRoads.length; i++) {
                const rec = lazyRoads[i];
                if (!rec) continue;
                drawObjectType("road", rec.x, rec.y);
            }
        }
        if (typeof getLazyTreeRecordsForMinimap === "function") {
            const lazyTrees = getLazyTreeRecordsForMinimap();
            for (let i = 0; i < lazyTrees.length; i++) {
                const rec = lazyTrees[i];
                if (!rec) continue;
                drawObjectType("tree", rec.x, rec.y);
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
