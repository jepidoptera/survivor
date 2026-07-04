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

    function isEnabled() {
        return !!(global && global.debugTerrainPolygonDiagnostics === true);
    }

    function getTerrainOutlineColor(terrainType) {
        switch (terrainType) {
            case "water":
                return 0xffffff;
            case "mud":
                return 0xffa500;
            case "grass":
                return 0x00ff00;
            case "desert":
                return 0xffff00;
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
        if (!isEnabled()) {
            clear(renderer);
            return;
        }
        const layer = renderer && renderer.layers && renderer.layers.ui ? renderer.layers.ui : null;
        if (!renderer || !layer || typeof global.PIXI === "undefined") return;
        if (!renderer.terrainPolygonDiagnosticGraphics) {
            renderer.terrainPolygonDiagnosticGraphics = new global.PIXI.Graphics();
            renderer.terrainPolygonDiagnosticGraphics.name = "renderingTerrainPolygonDiagnosticOverlay";
            renderer.terrainPolygonDiagnosticGraphics.skipTransform = true;
            renderer.terrainPolygonDiagnosticGraphics.interactive = false;
            renderer.terrainPolygonDiagnosticGraphics.visible = false;
            layer.addChild(renderer.terrainPolygonDiagnosticGraphics);
        } else if (renderer.terrainPolygonDiagnosticGraphics.parent !== layer) {
            layer.addChild(renderer.terrainPolygonDiagnosticGraphics);
        }

        const g = renderer.terrainPolygonDiagnosticGraphics;
        g.clear();
        const mapRef = (ctx && ctx.map) || (global && global.map) || null;
        const edit = mapRef && mapRef._terrainPaintDebugLastEdit ? mapRef._terrainPaintDebugLastEdit : null;
        const sourceEntries = Array.isArray(entries) ? entries : [];
        const terrainEntries = sourceEntries.filter(entry => entry && entry.isTerrainPolygon === true);
        if (!edit && terrainEntries.length === 0) {
            g.visible = false;
            return;
        }

        let drawn = 0;
        const baseZ = typeof renderer.getLayerBaseZForLevel === "function"
            ? renderer.getLayerBaseZForLevel(0)
            : 0;
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

        const rawReplacementSegments = Array.isArray(edit && edit.rawReplacementSegments)
            ? edit.rawReplacementSegments
            : [];
        for (let i = 0; i < rawReplacementSegments.length; i++) {
            if (drawSegment(renderer, g, rawReplacementSegments[i], baseZ, {
                lineColor: 0xffea3a,
                lineAlpha: 0.95,
                lineWidth: 7
            })) {
                drawn += 1;
            }
        }

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
        g.visible = drawn > 0;
    }

    global.RenderingTerrainPaintDebugRenderer = {
        isEnabled,
        clear,
        drawRing,
        drawSegment,
        getTerrainOutlineColor,
        render
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
