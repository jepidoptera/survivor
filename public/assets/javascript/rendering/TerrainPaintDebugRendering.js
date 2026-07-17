(function attachTerrainPaintDebugRendering(global) {
    function normalizePointList(points) {
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

    function outlinesEnabled() {
        return !!(global && global.debugTerrainPolygonDiagnostics === true);
    }

    function repairPathsEnabled() {
        return !!(global && global.debugTerrainPaintRepairPaths === true);
    }

    function storedTerrainMarkersEnabled() {
        return !!(global && global.debugStoredTerrainMarkers === true);
    }

    function isEnabled() {
        return outlinesEnabled() || repairPathsEnabled() || storedTerrainMarkersEnabled();
    }

    function getTerrainOutlineColor(terrainType) {
        switch (terrainType) {
            case "water":
                return 0xffffff;
            case "mud":
                return 0xffa500;
            case "grass":
                return 0x00ff00;
            case "mowedgrass":
                return 0x7fd65a;
            case "desert":
                return 0xffff00;
            default:
                return 0xffffff;
        }
    }

    function getStoredTerrainMarkerColor(terrainType) {
        switch (terrainType) {
            case "water":
                return 0x2f7dff;
            case "desert":
                return 0xffd21f;
            case "mud":
                return 0x8b5a2b;
            case "mowedgrass":
            case "lawn":
                return 0x7cff00;
            case "grass":
                return 0x18a558;
            default:
                return 0xffffff;
        }
    }

    function clear(renderer) {
        if (!renderer || !renderer.terrainPolygonDiagnosticGraphics) return;
        renderer.terrainPolygonDiagnosticGraphics.clear();
        renderer.terrainPolygonDiagnosticGraphics.visible = false;
    }

    function drawRing(renderer, g, points, baseZ, options = {}) {
        const ring = normalizePointList(points);
        if (!renderer || !g || ring.length < 3 || !renderer.camera) return false;
        const screenPoints = [];
        for (let i = 0; i < ring.length; i++) {
            const screen = renderer.camera.worldToScreen(ring[i].x, ring[i].y, baseZ);
            if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return false;
            screenPoints.push(screen);
        }
        const fillAlpha = Number.isFinite(options.fillAlpha) ? Number(options.fillAlpha) : 0;
        const fillColor = Number.isFinite(options.fillColor) ? Number(options.fillColor) : 0;
        const lineColor = Number.isFinite(options.lineColor) ? Number(options.lineColor) : 0xffffff;
        const lineAlpha = Number.isFinite(options.lineAlpha) ? Number(options.lineAlpha) : 1;
        const lineWidth = Number.isFinite(options.lineWidth) ? Math.max(0, Number(options.lineWidth)) : 2;
        if (lineWidth > 0) g.lineStyle(lineWidth, lineColor, lineAlpha);
        if (fillAlpha > 0) g.beginFill(fillColor, fillAlpha);
        g.moveTo(screenPoints[0].x, screenPoints[0].y);
        for (let i = 1; i < screenPoints.length; i++) {
            g.lineTo(screenPoints[i].x, screenPoints[i].y);
        }
        g.closePath();
        if (fillAlpha > 0) g.endFill();
        return true;
    }

    function collectStoredTerrainMarkerNodes(mapRef, ctx, renderer) {
        if (!mapRef) return [];
        const nodes = [];
        const seen = new Set();
        const addNode = (node) => {
            if (!node || node._prototypeVoid === true) return;
            const x = Number(node.x);
            const y = Number(node.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            const key = Number.isFinite(Number(node.xindex)) && Number.isFinite(Number(node.yindex))
                ? `${Math.round(Number(node.xindex))},${Math.round(Number(node.yindex))}`
                : `${x.toFixed(6)},${y.toFixed(6)}`;
            if (seen.has(key)) return;
            seen.add(key);
            nodes.push(node);
        };

        const viewport = ctx && ctx.viewport ? ctx.viewport : null;
        const cam = renderer && renderer.camera ? renderer.camera : null;
        const vpX = Number.isFinite(Number(viewport && viewport.x)) ? Number(viewport.x) : Number(cam && cam.x);
        const vpY = Number.isFinite(Number(viewport && viewport.y)) ? Number(viewport.y) : Number(cam && cam.y);
        const vpW = Number.isFinite(Number(viewport && viewport.width)) ? Number(viewport.width) : 32;
        const vpH = Number.isFinite(Number(viewport && viewport.height)) ? Number(viewport.height) : 24;
        const pad = 2;
        const rawXStart = Number.isFinite(vpX) ? Math.floor(vpX / 0.866) - pad : 0;
        const rawXEnd = Number.isFinite(vpX) ? Math.ceil((vpX + vpW) / 0.866) + pad : (Number(mapRef.width) || 0) - 1;
        const rawYStart = Number.isFinite(vpY) ? Math.floor(vpY) - pad : 0;
        const rawYEnd = Number.isFinite(vpY) ? Math.ceil(vpY + vpH) + pad : (Number(mapRef.height) || 0) - 1;

        if (typeof mapRef.getGroundTerrainNodeByCoord === "function") {
            for (let x = rawXStart; x <= rawXEnd; x++) {
                for (let y = rawYStart; y <= rawYEnd; y++) {
                    addNode(mapRef.getGroundTerrainNodeByCoord(x, y));
                }
            }
        } else if (Array.isArray(mapRef.nodes)) {
            for (let x = rawXStart; x <= rawXEnd; x++) {
                let xi = x;
                if (mapRef.wrapX) {
                    xi = ((xi % mapRef.width) + mapRef.width) % mapRef.width;
                } else if (xi < 0 || xi >= mapRef.nodes.length) {
                    continue;
                }
                const column = mapRef.nodes[xi];
                if (!Array.isArray(column)) continue;
                for (let y = rawYStart; y <= rawYEnd; y++) {
                    let yi = y;
                    if (mapRef.wrapY) {
                        yi = ((yi % mapRef.height) + mapRef.height) % mapRef.height;
                    } else if (yi < 0 || yi >= column.length) {
                        continue;
                    }
                    addNode(column[yi]);
                }
            }
        }

        return nodes;
    }

    function drawStoredTerrainMarkers(renderer, ctx, g, mapRef) {
        if (!storedTerrainMarkersEnabled()) return 0;
        if (!renderer || !renderer.camera || !g || !mapRef) return 0;
        if (typeof mapRef.getGroundTerrainTypeForNode !== "function") {
            throw new Error("stored terrain debug markers require map.getGroundTerrainTypeForNode");
        }
        const nodes = collectStoredTerrainMarkerNodes(mapRef, ctx, renderer);
        const radius = Math.max(2.5, Math.min(6, Number(renderer.camera.viewscale) * 0.11 || 4));
        const appRef = (ctx && ctx.app) || renderer.app || global.app || null;
        const screenW = Number.isFinite(Number(appRef && appRef.renderer && appRef.renderer.width))
            ? Number(appRef.renderer.width)
            : Number.isFinite(Number(appRef && appRef.screen && appRef.screen.width))
                ? Number(appRef.screen.width)
            : Number.isFinite(Number(global.innerWidth)) ? Number(global.innerWidth) : 0;
        const screenH = Number.isFinite(Number(appRef && appRef.renderer && appRef.renderer.height))
            ? Number(appRef.renderer.height)
            : Number.isFinite(Number(appRef && appRef.screen && appRef.screen.height))
                ? Number(appRef.screen.height)
            : Number.isFinite(Number(global.innerHeight)) ? Number(global.innerHeight) : 0;
        let drawn = 0;
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const screen = renderer.camera.worldToScreen(Number(node.x), Number(node.y), 0);
            if (
                !screen ||
                !Number.isFinite(screen.x) ||
                !Number.isFinite(screen.y)
            ) {
                continue;
            }
            if (
                screenW > 0 &&
                screenH > 0 &&
                (
                    screen.x < -radius ||
                    screen.x > screenW + radius ||
                    screen.y < -radius ||
                    screen.y > screenH + radius
                )
            ) {
                continue;
            }
            const terrainType = mapRef.getGroundTerrainTypeForNode(node);
            g.lineStyle(1, 0x000000, 0.75);
            g.beginFill(getStoredTerrainMarkerColor(terrainType), 0.9);
            g.drawCircle(screen.x, screen.y, radius);
            g.endFill();
            drawn += 1;
        }
        return drawn;
    }

    function drawSegment(renderer, g, segment, baseZ, options = {}) {
        if (!renderer || !g || !segment || !segment.a || !segment.b || !renderer.camera) return false;
        const ax = Number(segment.a.x);
        const ay = Number(segment.a.y);
        const bx = Number(segment.b.x);
        const by = Number(segment.b.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
            throw new Error("terrain paint debug segment contains non-finite points");
        }
        const a = renderer.camera.worldToScreen(ax, ay, baseZ);
        const b = renderer.camera.worldToScreen(bx, by, baseZ);
        if (
            !a ||
            !b ||
            !Number.isFinite(a.x) ||
            !Number.isFinite(a.y) ||
            !Number.isFinite(b.x) ||
            !Number.isFinite(b.y)
        ) {
            return false;
        }
        const lineColor = Number.isFinite(options.lineColor) ? Number(options.lineColor) : 0xff4fca;
        const lineAlpha = Number.isFinite(options.lineAlpha) ? Number(options.lineAlpha) : 1;
        const lineWidth = Number.isFinite(options.lineWidth) ? Math.max(0, Number(options.lineWidth)) : 4;
        g.lineStyle(lineWidth, lineColor, lineAlpha);
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        return true;
    }

    function render(renderer, ctx, entries) {
        const drawOutlines = outlinesEnabled();
        const drawRepairPaths = repairPathsEnabled();
        const drawStoredMarkers = storedTerrainMarkersEnabled();
        if (!drawOutlines && !drawRepairPaths && !drawStoredMarkers) {
            clear(renderer);
            return;
        }
        const layer = renderer && renderer.layers && renderer.layers.ui ? renderer.layers.ui : null;
        if (!renderer || !layer || typeof global.PIXI === "undefined") return;
        if (Object.prototype.hasOwnProperty.call(layer, "sortableChildren")) layer.sortableChildren = true;
        if (!renderer.terrainPolygonDiagnosticGraphics) {
            renderer.terrainPolygonDiagnosticGraphics = new global.PIXI.Graphics();
            renderer.terrainPolygonDiagnosticGraphics.name = "renderingTerrainPolygonDiagnosticOverlay";
            renderer.terrainPolygonDiagnosticGraphics.skipTransform = true;
            renderer.terrainPolygonDiagnosticGraphics.interactive = false;
            renderer.terrainPolygonDiagnosticGraphics.visible = false;
            renderer.terrainPolygonDiagnosticGraphics.zIndex = Number.MAX_SAFE_INTEGER;
            layer.addChild(renderer.terrainPolygonDiagnosticGraphics);
        } else if (renderer.terrainPolygonDiagnosticGraphics.parent !== layer) {
            layer.addChild(renderer.terrainPolygonDiagnosticGraphics);
        }
        renderer.terrainPolygonDiagnosticGraphics.zIndex = Number.MAX_SAFE_INTEGER;
        if (Object.prototype.hasOwnProperty.call(layer, "sortDirty")) layer.sortDirty = true;

        const g = renderer.terrainPolygonDiagnosticGraphics;
        g.clear();
        const mapRef = (ctx && ctx.map) || (global && global.map) || null;
        const edit = mapRef && mapRef._terrainPaintDebugLastEdit ? mapRef._terrainPaintDebugLastEdit : null;
        const sourceEntries = Array.isArray(entries) ? entries : [];
        const terrainEntries = sourceEntries.filter(entry => entry && entry.isTerrainPolygon === true);
        if (
            (!drawRepairPaths || !edit) &&
            (!drawOutlines || terrainEntries.length === 0) &&
            !drawStoredMarkers
        ) {
            g.visible = false;
            return;
        }

        let drawn = 0;
        const baseZ = typeof renderer.getLayerBaseZForLevel === "function"
            ? renderer.getLayerBaseZForLevel(0)
            : 0;
        if (drawOutlines) {
            for (let i = 0; i < terrainEntries.length; i++) {
                const entry = terrainEntries[i];
                const entryBaseZ = Number.isFinite(entry.baseZ) ? Number(entry.baseZ) : baseZ;
                const lineColor = getTerrainOutlineColor(entry.terrainType);
                if (drawRing(renderer, g, entry.outer, entryBaseZ, {
                    lineColor,
                    lineAlpha: 0.98,
                    lineWidth: 2
                })) {
                    drawn += 1;
                }
                const holes = Array.isArray(entry.holes) ? entry.holes : [];
                for (let h = 0; h < holes.length; h++) {
                    if (drawRing(renderer, g, holes[h], entryBaseZ, {
                        lineColor,
                        lineAlpha: 0.82,
                        lineWidth: 2
                    })) {
                        drawn += 1;
                    }
                }
            }
        }

        if (drawRepairPaths) {
            const modifiedSegments = Array.isArray(edit && edit.modifiedSegments) ? edit.modifiedSegments : [];
            for (let i = 0; i < modifiedSegments.length; i++) {
                if (drawSegment(renderer, g, modifiedSegments[i], baseZ, {
                    lineColor: 0xff4fca,
                    lineAlpha: 1,
                    lineWidth: 4
                })) {
                    drawn += 1;
                }
            }
        }
        drawn += drawStoredTerrainMarkers(renderer, ctx, g, mapRef);
        g.visible = drawn > 0;
    }

    global.RenderingTerrainPaintDebugRenderer = {
        isEnabled,
        outlinesEnabled,
        repairPathsEnabled,
        storedTerrainMarkersEnabled,
        clear,
        drawRing,
        drawSegment,
        getTerrainOutlineColor,
        getStoredTerrainMarkerColor,
        render
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
