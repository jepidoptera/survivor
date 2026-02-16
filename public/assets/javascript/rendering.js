let lastDebugOverlayUpdateMs = 0;
let debugOverlayDirty = true;
const debugOverlayMinIntervalMs = 1000 / 30;
let debugOverlayPhase = 0;
let lastRenderedMessageHtml = "";
let visibilityMaskGraphics = null;
let visibilityMaskEnabled = false;
let visibilityMaskSources = [];
let activeVisibilityMaskHitboxes = [];
let roofInteriorBlackoutGraphics = null;
let roofInteriorMaskBlend = 0;
let roofInteriorMaskBlendLastMs = 0;
const roofInteriorMaskFadeSeconds = 0.22;
const groundChunkTileSize = 24;
const groundChunkRenderPaddingTiles = 4;
const groundTileOverlapScale = 1.5;
const groundTileFeatherRatio = 0.25;
const groundChunkCacheMaxEntries = 96;
let groundChunkCache = new Map();
let groundChunkLastViewscale = 0;
let spellHoverHighlightSprite = null;
let spellHoverHighlightWallGraphics = null;
let placeObjectPreviewSprite = null;
let placeObjectPreviewTexturePath = "";
let uiArrowCursorElement = null;
let mapBorderGraphics = null;
let losDebugGraphics = null;
let losDebugState = null;
let losGroundMaskGraphics = null;
let losShadowGraphics = null;
let losShadowMaskGraphics = null;
let losDebugFillEnabled = false;
let losGroundMaskEnabled = false;
let losShadowEnabled = true;
let losShadowOpacity = 0.2;
let losShadowBlurEnabled = true;
let losShadowBlurStrength = 12;
let losMaxDarken = 0.5;
const losMinStaticBrightness = 0.2;
const renderingViewportNodeSampleEpsilon = 1e-4;
let losForwardFovDegrees = 200;
let cameraForwardLeadRatio = 0.22;
let cameraFollowSmoothing = 0.025;
let currentLosState = null;
let currentLosVisibleSet = null;
let currentLosVisibleWallGroups = null;
let wallLosGroupState = new Map();
let lastLosWizardX = null;
let lastLosWizardY = null;
let lastLosFacingAngle = null;
let lastLosCandidateCount = -1;
let lastLosCandidateHash = 0;
let lastLosComputeAtMs = 0;
let nextLosObjectId = 1;
let lastRenderFrameMs = 0;

if (typeof globalThis !== "undefined" && typeof globalThis.setLosDebugFillEnabled !== "function") {
    globalThis.setLosDebugFillEnabled = function setLosDebugFillEnabled(enabled) {
        losDebugFillEnabled = !!enabled;
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosGroundMaskEnabled !== "function") {
    globalThis.setLosGroundMaskEnabled = function setLosGroundMaskEnabled(enabled) {
        losGroundMaskEnabled = !!enabled;
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosShadowEnabled !== "function") {
    globalThis.setLosShadowEnabled = function setLosShadowEnabled(enabled) {
        losShadowEnabled = !!enabled;
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosShadowOpacity !== "function") {
    globalThis.setLosShadowOpacity = function setLosShadowOpacity(alpha) {
        const value = Number(alpha);
        if (!Number.isFinite(value)) return;
        losShadowOpacity = Math.max(0, Math.min(1, value));
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosShadowBlurEnabled !== "function") {
    globalThis.setLosShadowBlurEnabled = function setLosShadowBlurEnabled(enabled) {
        losShadowBlurEnabled = !!enabled;
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosShadowBlurStrength !== "function") {
    globalThis.setLosShadowBlurStrength = function setLosShadowBlurStrength(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        losShadowBlurStrength = Math.max(0, n);
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosMaxDarken !== "function") {
    globalThis.setLosMaxDarken = function setLosMaxDarken(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        losMaxDarken = Math.max(0, Math.min(1, n));
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosForwardFovDegrees !== "function") {
    globalThis.setLosForwardFovDegrees = function setLosForwardFovDegrees(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        losForwardFovDegrees = Math.max(0, Math.min(360, n));
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setCameraForwardLeadRatio !== "function") {
    globalThis.setCameraForwardLeadRatio = function setCameraForwardLeadRatio(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        cameraForwardLeadRatio = Math.max(0, Math.min(0.8, n));
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setCameraFollowSmoothing !== "function") {
    globalThis.setCameraFollowSmoothing = function setCameraFollowSmoothing(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        cameraFollowSmoothing = Math.max(0, Math.min(1, n));
    };
}

function isAnimalEntity(item) {
    if (!item) return false;
    if (typeof Animal !== "undefined" && item instanceof Animal) return true;
    return false;
}

function isLosOccluder(item) {
    if (!item || !item.groundPlaneHitbox) return false;
    if (isAnimalEntity(item)) return false;
    if (item.type === "road") return false;
    if (item.type === "firewall") return false;
    return true;
}

function getGroundHitboxCenter(hitbox) {
    if (!hitbox) return null;
    if (hitbox.type === "circle" && Number.isFinite(hitbox.x) && Number.isFinite(hitbox.y)) {
        return { x: hitbox.x, y: hitbox.y };
    }
    if (Array.isArray(hitbox.points) && hitbox.points.length >= 3) {
        const cx = hitbox.points.reduce((sum, pt) => sum + pt.x, 0) / hitbox.points.length;
        const cy = hitbox.points.reduce((sum, pt) => sum + pt.y, 0) / hitbox.points.length;
        return { x: cx, y: cy };
    }
    return null;
}

function isLosPointVisible(worldX, worldY, slack = 0.05) {
    if (!wizard || !currentLosState) return true;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return true;
    const dx = (map && typeof map.shortestDeltaX === "function")
        ? map.shortestDeltaX(wizard.x, worldX)
        : (worldX - wizard.x);
    const dy = (map && typeof map.shortestDeltaY === "function")
        ? map.shortestDeltaY(wizard.y, worldY)
        : (worldY - wizard.y);
    const distanceToPoint = Math.hypot(dx, dy);
    if (!Number.isFinite(distanceToPoint) || distanceToPoint <= 1e-6) return true;

    const bins = Number.isFinite(currentLosState.bins) ? currentLosState.bins : 0;
    const depth = currentLosState.depth;
    if (!bins || !depth || depth.length !== bins) return true;

    let angle = Math.atan2(dy, dx) + Math.PI;
    const twoPi = Math.PI * 2;
    angle = ((angle % twoPi) + twoPi) % twoPi;
    const bin = Math.max(0, Math.min(bins - 1, Math.floor((angle / twoPi) * bins)));
    const nearestDepth = depth[bin];
    if (!Number.isFinite(nearestDepth)) return true;
    return distanceToPoint <= nearestDepth + slack;
}

function isCurrentlyVisibleByLos(item) {
    if (!item || !item.groundPlaneHitbox || !wizard || !currentLosState) return true;
    if (currentLosVisibleSet && currentLosVisibleSet.has(item)) return true;
    if (item.type === "wall" && item.a && item.b) {
        const ax = Number(item.a.x);
        const ay = Number(item.a.y);
        const bx = Number(item.b.x);
        const by = Number(item.b.y);
        if (Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(bx) && Number.isFinite(by)) {
            const sampleTs = [0, 0.25, 0.5, 0.75, 1];
            for (let i = 0; i < sampleTs.length; i++) {
                const t = sampleTs[i];
                const sx = ax + (bx - ax) * t;
                const sy = ay + (by - ay) * t;
                if (isLosPointVisible(sx, sy, 0.08)) return true;
            }
            return false;
        }
    }
    const center = getGroundHitboxCenter(item.groundPlaneHitbox);
    if (!center) return true;
    return isLosPointVisible(center.x, center.y, 0.05);
}

function getLosCoverageRatio(item, slack = 0.05) {
    if (!item || !wizard || !currentLosState) return 1;
    if (!item.groundPlaneHitbox) return 1;

    if (item._losCoverageCacheState === currentLosState && item._losCoverageCacheFrame === frameCount) {
        const cached = Number(item._losCoverageCacheValue);
        if (Number.isFinite(cached)) return Math.max(0, Math.min(1, cached));
    }

    const bins = Number.isFinite(currentLosState.bins) ? Math.max(1, Math.floor(currentLosState.bins)) : 0;
    const depth = currentLosState.depth;
    if (!bins || !depth || depth.length !== bins) return 1;

    const wx = wizard.x;
    const wy = wizard.y;
    const minAngle = Number.isFinite(currentLosState.minAngle) ? currentLosState.minAngle : -Math.PI;
    const twoPi = Math.PI * 2;
    const angleForBin = idx => minAngle + ((idx + 0.5) / bins) * twoPi;

    let possibleBins = 0;
    let litBins = 0;
    const countBin = (binIdx, t) => {
        if (!Number.isFinite(t) || t < 0) return;
        possibleBins += 1;
        const nearestDepth = depth[binIdx];
        if (Number.isFinite(nearestDepth) && t <= nearestDepth + slack) {
            litBins += 1;
        }
    };

    const hitbox = item.groundPlaneHitbox;
    if (hitbox instanceof CircleHitbox) {
        const cxRaw = hitbox.x;
        const cyRaw = hitbox.y;
        const r = hitbox.radius;
        if (Number.isFinite(cxRaw) && Number.isFinite(cyRaw) && Number.isFinite(r) && r > 0) {
            const dx = (map && typeof map.shortestDeltaX === "function")
                ? map.shortestDeltaX(wx, cxRaw)
                : (cxRaw - wx);
            const dy = (map && typeof map.shortestDeltaY === "function")
                ? map.shortestDeltaY(wy, cyRaw)
                : (cyRaw - wy);
            const cx = wx + dx;
            const cy = wy + dy;
            const centerDist = Math.hypot(dx, dy);
            if (centerDist <= r + 1e-6) {
                // Wizard inside object footprint: object can occupy any LOS bin.
                possibleBins = bins;
                litBins = bins;
            } else {
                const centerAngle = Math.atan2(dy, dx);
                const halfSpan = Math.asin(Math.min(1, r / centerDist));
                const a0 = centerAngle - halfSpan;
                const a1 = centerAngle + halfSpan;
                forEachBinInShortSpan(a0, a1, bins, b => {
                    const theta = angleForBin(b);
                    if (!angleInSpan(theta, a0, a1)) return;
                    const dirX = Math.cos(theta);
                    const dirY = Math.sin(theta);
                    const t = rayCircleDistance(wx, wy, dirX, dirY, cx, cy, r);
                    if (t !== null) countBin(b, t);
                });
            }
        }
    } else if (hitbox instanceof PolygonHitbox && Array.isArray(hitbox.points) && hitbox.points.length >= 2) {
        const points = hitbox.points.map(p => ({
            x: wx + ((map && typeof map.shortestDeltaX === "function") ? map.shortestDeltaX(wx, p.x) : (p.x - wx)),
            y: wy + ((map && typeof map.shortestDeltaY === "function") ? map.shortestDeltaY(wy, p.y) : (p.y - wy))
        }));
        const minDistByBin = new Map();
        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            if (!p1 || !p2) continue;
            const a0 = Math.atan2(p1.y - wy, p1.x - wx);
            const a1 = Math.atan2(p2.y - wy, p2.x - wx);
            forEachBinInShortSpan(a0, a1, bins, b => {
                const theta = angleForBin(b);
                const dirX = Math.cos(theta);
                const dirY = Math.sin(theta);
                const t = raySegmentDistance(wx, wy, dirX, dirY, p1.x, p1.y, p2.x, p2.y);
                if (t === null) return;
                const prev = minDistByBin.get(b);
                if (!Number.isFinite(prev) || t < prev) minDistByBin.set(b, t);
            });
        }
        minDistByBin.forEach((t, b) => countBin(b, t));
    } else {
        const center = getGroundHitboxCenter(hitbox);
        if (center) {
            const dx = (map && typeof map.shortestDeltaX === "function")
                ? map.shortestDeltaX(wx, center.x)
                : (center.x - wx);
            const dy = (map && typeof map.shortestDeltaY === "function")
                ? map.shortestDeltaY(wy, center.y)
                : (center.y - wy);
            const t = Math.hypot(dx, dy);
            const angle = Math.atan2(dy, dx);
            const normalized = ((normalizeAngle(angle) - minAngle) / twoPi);
            const bin = Math.max(0, Math.min(bins - 1, Math.floor((((normalized % 1) + 1) % 1) * bins)));
            countBin(bin, t);
        }
    }

    let ratio = possibleBins > 0 ? (litBins / possibleBins) : (isCurrentlyVisibleByLos(item) ? 1 : 0);
    ratio = Math.max(0, Math.min(1, ratio));
    item._losCoverageCacheState = currentLosState;
    item._losCoverageCacheFrame = frameCount;
    item._losCoverageCacheValue = ratio;
    return ratio;
}

function getLosObjectId(item) {
    if (!item) return 0;
    if (!Number.isInteger(item._losObjectId)) {
        item._losObjectId = nextLosObjectId++;
    }
    return item._losObjectId;
}

function computeLosCandidateHash(candidates) {
    let xor = 0;
    let sum = 0;
    for (let i = 0; i < candidates.length; i++) {
        const id = getLosObjectId(candidates[i]) >>> 0;
        xor = (xor ^ id) >>> 0;
        sum = (sum + ((id * 2654435761) >>> 0)) >>> 0;
    }
    return (xor ^ sum) >>> 0;
}

function getWizardFacingAngleRad() {
    if (!wizard) return 0;
    if (Number.isFinite(mousePos.worldX) && Number.isFinite(mousePos.worldY)) {
        const dx = (map && typeof map.shortestDeltaX === "function")
            ? map.shortestDeltaX(wizard.x, mousePos.worldX)
            : (mousePos.worldX - wizard.x);
        const dy = (map && typeof map.shortestDeltaY === "function")
            ? map.shortestDeltaY(wizard.y, mousePos.worldY)
            : (mousePos.worldY - wizard.y);
        if (Math.hypot(dx, dy) > 1e-6) {
            return Math.atan2(dy, dx);
        }
    }

    // Fallback to sprite row facing when aim vector is unavailable.
    if (Number.isInteger(wizard.lastDirectionRow)) {
        const rowAngleDegByDirectionIndex = [180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
        const directionIndex = ((wizard.lastDirectionRow - wizardDirectionRowOffset) % 12 + 12) % 12;
        const deg = rowAngleDegByDirectionIndex[directionIndex];
        if (Number.isFinite(deg)) return deg * (Math.PI / 180);
    }

    return 0;
}

function ensureVisibilityMaskGraphics() {
    if (!visibilityMaskGraphics) {
        visibilityMaskGraphics = new PIXI.Graphics();
        visibilityMaskGraphics.alpha = 0.001;
        app.stage.addChild(visibilityMaskGraphics);
    }
    return visibilityMaskGraphics;
}

function ensureLosGroundMaskGraphics() {
    if (!losGroundMaskGraphics) {
        losGroundMaskGraphics = new PIXI.Graphics();
        losGroundMaskGraphics.visible = false;
        gameContainer.addChild(losGroundMaskGraphics);
    }
    return losGroundMaskGraphics;
}

function ensureLosShadowGraphics() {
    if (!gameContainer) return null;
    if (!losShadowGraphics) {
        losShadowGraphics = new PIXI.Graphics();
        losShadowGraphics.visible = false;
        losShadowGraphics.interactive = false;
        gameContainer.addChild(losShadowGraphics);
    }
    if (losShadowGraphics.mask) {
        losShadowGraphics.mask = null;
    }
    if (losShadowBlurEnabled && losShadowBlurStrength > 0 && typeof PIXI !== "undefined") {
        if (typeof PIXI.BlurFilter === "function") {
            if (!losShadowGraphics._losBlurFilter || !(losShadowGraphics._losBlurFilter instanceof PIXI.BlurFilter)) {
                losShadowGraphics._losBlurFilter = new PIXI.BlurFilter();
            }
            losShadowGraphics._losBlurFilter.blur = losShadowBlurStrength;
            losShadowGraphics.filters = [losShadowGraphics._losBlurFilter];
        } else if (PIXI.filters && typeof PIXI.filters.BlurFilter === "function") {
            if (!losShadowGraphics._losBlurFilter || !(losShadowGraphics._losBlurFilter instanceof PIXI.filters.BlurFilter)) {
                losShadowGraphics._losBlurFilter = new PIXI.filters.BlurFilter();
            }
            losShadowGraphics._losBlurFilter.blur = losShadowBlurStrength;
            losShadowGraphics.filters = [losShadowGraphics._losBlurFilter];
        } else {
            losShadowGraphics.filters = null;
        }
    } else {
        losShadowGraphics.filters = null;
    }
    if (losShadowGraphics && losShadowGraphics.parent === gameContainer) {
        // Keep shadow above ground/roads but below non-ground objects.
        const desiredIndex = (roadLayer && roadLayer.parent === gameContainer)
            ? Math.min(gameContainer.children.length - 1, gameContainer.getChildIndex(roadLayer) + 1)
            : Math.max(0, gameContainer.children.length - 1);
        const currentIndex = gameContainer.getChildIndex(losShadowGraphics);
        if (currentIndex !== desiredIndex) {
            gameContainer.setChildIndex(losShadowGraphics, desiredIndex);
        }
    }
    return losShadowGraphics;
}

function applyLosGroundMask() {
    if (!landLayer) return;
    if (!losGroundMaskEnabled) {
        landLayer.mask = null;
        if (losGroundMaskGraphics) {
            losGroundMaskGraphics.clear();
            losGroundMaskGraphics.visible = false;
        }
        return;
    }
    if (!wizard || !currentLosState || !LOSSystem || typeof LOSSystem.buildPolygonWorldPoints !== "function") {
        landLayer.mask = null;
        if (losGroundMaskGraphics) {
            losGroundMaskGraphics.clear();
            losGroundMaskGraphics.visible = false;
        }
        return;
    }
    const graphics = ensureLosGroundMaskGraphics();
    graphics.clear();
    const farDist = Math.max(viewport.width, viewport.height) * 1.5;
    const worldPoints = LOSSystem.buildPolygonWorldPoints(wizard, currentLosState, farDist);
    if (!Array.isArray(worldPoints) || worldPoints.length < 3) {
        landLayer.mask = null;
        graphics.visible = false;
        return;
    }
    const screenPoints = worldPoints.map(pt => worldToScreen(pt));
    graphics.beginFill(0xffffff, 1);
    graphics.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (let i = 1; i < screenPoints.length; i++) {
        graphics.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    graphics.closePath();
    graphics.endFill();
    graphics.visible = true;
    landLayer.mask = graphics;
}

function applyLosShadow() {
    const graphics = ensureLosShadowGraphics();
    if (!graphics) return;
    graphics.clear();

    if (!losShadowEnabled || losShadowOpacity <= 0) {
        graphics.visible = false;
        return;
    }
    if (!wizard || !currentLosState || !currentLosState.depth || !Number.isFinite(currentLosState.bins)) {
        graphics.visible = false;
        return;
    }

    const bins = Math.max(3, Math.floor(currentLosState.bins));
    const depth = currentLosState.depth;
    if (!depth || depth.length !== bins) {
        graphics.visible = false;
        return;
    }

    const minAngle = Number.isFinite(currentLosState.minAngle) ? currentLosState.minAngle : -Math.PI;
    const twoPi = Math.PI * 2;
    const farDist = Math.max(viewport.width, viewport.height) * 1.5;
    const angleForBin = idx => minAngle + ((idx + 0.5) / bins) * twoPi;
    const wizardScreen = worldToScreen(wizard);
    const losPointToScreen = (theta, distance) => ({
        x: wizardScreen.x + Math.cos(theta) * distance * viewscale,
        y: wizardScreen.y + Math.sin(theta) * distance * viewscale * xyratio
    });
    graphics.visible = true;
    graphics.lineStyle(0);
    graphics.beginFill(0x000000, losShadowOpacity);
    for (let i = 0; i < bins; i++) {
        const j = (i + 1) % bins;
        const d0 = Number.isFinite(depth[i]) ? Math.max(0, depth[i]) : farDist;
        const d1 = Number.isFinite(depth[j]) ? Math.max(0, depth[j]) : farDist;
        if (d0 >= farDist && d1 >= farDist) continue;

        const t0 = angleForBin(i);
        const t1 = angleForBin(j);
        const near0 = losPointToScreen(t0, d0);
        const near1 = losPointToScreen(t1, d1);
        const far1 = losPointToScreen(t1, farDist);
        const far0 = losPointToScreen(t0, farDist);
        graphics.moveTo(near0.x, near0.y);
        graphics.lineTo(near1.x, near1.y);
        graphics.lineTo(far1.x, far1.y);
        graphics.lineTo(far0.x, far0.y);
        graphics.closePath();
    }
    graphics.endFill();
}

function resolveVisibilityHitboxes() {
    const hitboxes = [];
    visibilityMaskSources.forEach(source => {
        const resolved = (typeof source === "function") ? source() : source;
        if (!resolved) return;
        if (Array.isArray(resolved)) {
            resolved.forEach(h => { if (h) hitboxes.push(h); });
        } else {
            hitboxes.push(resolved);
        }
    });
    return hitboxes;
}

function pointInsideVisibilityMask(x, y) {
    if (!activeVisibilityMaskHitboxes || activeVisibilityMaskHitboxes.length === 0) return true;
    return activeVisibilityMaskHitboxes.some(maskHitbox =>
        maskHitbox &&
        typeof maskHitbox.containsPoint === "function" &&
        maskHitbox.containsPoint(x, y)
    );
}

function getRoofInteriorHitbox() {
    if (
        roof &&
        roof.placed &&
        roof.groundPlaneHitbox &&
        typeof roof.groundPlaneHitbox.containsPoint === "function"
    ) {
        return roof.groundPlaneHitbox;
    }
    return null;
}

function projectPolygonPointsToScreen(points) {
    if (!Array.isArray(points) || points.length < 3) return [];
    const anchor = points[0];
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return [];
    const anchorScreen = worldToScreen({ x: anchor.x, y: anchor.y });
    return points.map(pt => {
        if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
            return { x: anchorScreen.x, y: anchorScreen.y };
        }
        const dx = (map && typeof map.shortestDeltaX === "function")
            ? map.shortestDeltaX(anchor.x, pt.x)
            : (pt.x - anchor.x);
        const dy = (map && typeof map.shortestDeltaY === "function")
            ? map.shortestDeltaY(anchor.y, pt.y)
            : (pt.y - anchor.y);
        return {
            x: anchorScreen.x + dx * viewscale,
            y: anchorScreen.y + dy * viewscale * xyratio
        };
    });
}

function buildRoofInteriorScreenPolygon(hitbox, inflatePx = 2) {
    if (!hitbox || !Array.isArray(hitbox.points) || hitbox.points.length < 3) return null;
    const screenPoints = projectPolygonPointsToScreen(hitbox.points);
    if (!screenPoints || screenPoints.length < 3) return null;
    return inflateScreenPolygon(screenPoints, inflatePx);
}

function updateRoofInteriorMaskBlend(wizardInsideRoof) {
    const nowMs = (typeof renderNowMs === "number" && renderNowMs > 0)
        ? renderNowMs
        : performance.now();
    if (!Number.isFinite(roofInteriorMaskBlendLastMs) || roofInteriorMaskBlendLastMs <= 0) {
        roofInteriorMaskBlendLastMs = nowMs;
    }
    const dtSec = Math.max(0, (nowMs - roofInteriorMaskBlendLastMs) / 1000);
    roofInteriorMaskBlendLastMs = nowMs;

    const target = wizardInsideRoof ? 1 : 0;
    if (roofInteriorMaskFadeSeconds <= 0) {
        roofInteriorMaskBlend = target;
        return roofInteriorMaskBlend;
    }

    const maxStep = dtSec / roofInteriorMaskFadeSeconds;
    if (target > roofInteriorMaskBlend) {
        roofInteriorMaskBlend = Math.min(target, roofInteriorMaskBlend + maxStep);
    } else if (target < roofInteriorMaskBlend) {
        roofInteriorMaskBlend = Math.max(target, roofInteriorMaskBlend - maxStep);
    }
    return roofInteriorMaskBlend;
}

function pointInsideMaskHitboxes(x, y, maskHitboxes) {
    if (!Array.isArray(maskHitboxes) || maskHitboxes.length === 0) return false;
    return maskHitboxes.some(maskHitbox =>
        maskHitbox &&
        typeof maskHitbox.containsPoint === "function" &&
        maskHitbox.containsPoint(x, y)
    );
}

function inflateScreenPolygon(points, inflatePx = 0) {
    if (!Array.isArray(points) || points.length < 3 || !Number.isFinite(inflatePx) || inflatePx === 0) {
        return Array.isArray(points) ? points.slice() : [];
    }
    const centroid = points.reduce((acc, pt) => {
        acc.x += pt.x;
        acc.y += pt.y;
        return acc;
    }, { x: 0, y: 0 });
    centroid.x /= points.length;
    centroid.y /= points.length;

    return points.map(pt => {
        const dx = pt.x - centroid.x;
        const dy = pt.y - centroid.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return { x: pt.x, y: pt.y };
        const s = (len + inflatePx) / len;
        return { x: centroid.x + dx * s, y: centroid.y + dy * s };
    });
}

function isGroundHitboxInsideVisibilityMask(hitbox, requireFull = false) {
    if (!hitbox) return false;
    if (!activeVisibilityMaskHitboxes || activeVisibilityMaskHitboxes.length === 0) return true;

    // Circle hitbox: sample center and perimeter points.
    if (hitbox.type === "circle" && Number.isFinite(hitbox.x) && Number.isFinite(hitbox.y) && Number.isFinite(hitbox.radius)) {
        const r = hitbox.radius;
        const samples = [
            { x: hitbox.x, y: hitbox.y },
            { x: hitbox.x + r, y: hitbox.y },
            { x: hitbox.x - r, y: hitbox.y },
            { x: hitbox.x, y: hitbox.y + r },
            { x: hitbox.x, y: hitbox.y - r },
            { x: hitbox.x + r * 0.70710678, y: hitbox.y + r * 0.70710678 },
            { x: hitbox.x - r * 0.70710678, y: hitbox.y + r * 0.70710678 },
            { x: hitbox.x + r * 0.70710678, y: hitbox.y - r * 0.70710678 },
            { x: hitbox.x - r * 0.70710678, y: hitbox.y - r * 0.70710678 }
        ];
        return requireFull
            ? samples.every(pt => pointInsideVisibilityMask(pt.x, pt.y))
            : samples.some(pt => pointInsideVisibilityMask(pt.x, pt.y));
    }

    // Polygon hitbox: vertex and centroid checks.
    if (Array.isArray(hitbox.points) && hitbox.points.length >= 3) {
        const pts = hitbox.points;
        const cx = pts.reduce((sum, pt) => sum + pt.x, 0) / pts.length;
        const cy = pts.reduce((sum, pt) => sum + pt.y, 0) / pts.length;
        if (requireFull) {
            const verticesInside = pts.every(pt => pointInsideVisibilityMask(pt.x, pt.y));
            if (!verticesInside) return false;
            return pointInsideVisibilityMask(cx, cy);
        }
        const verticesInside = pts.some(pt => pointInsideVisibilityMask(pt.x, pt.y));
        if (verticesInside) return true;
        return pointInsideVisibilityMask(cx, cy);
    }

    return false;
}

function isGroundHitboxFullyInsideVisibilityMask(hitbox) {
    return isGroundHitboxInsideVisibilityMask(hitbox, true);
}

function isGroundHitboxVisibleInVisibilityMask(hitbox) {
    return isGroundHitboxInsideVisibilityMask(hitbox, false);
}

// True only when every sampled point is outside the provided mask hitboxes.
function isGroundHitboxFullyOutsideMaskHitboxes(hitbox, maskHitboxes) {
    if (!hitbox) return false;
    if (!Array.isArray(maskHitboxes) || maskHitboxes.length === 0) return true;

    // Circle hitbox: sample center and perimeter points.
    if (hitbox.type === "circle" && Number.isFinite(hitbox.x) && Number.isFinite(hitbox.y) && Number.isFinite(hitbox.radius)) {
        const r = hitbox.radius;
        const samples = [
            { x: hitbox.x, y: hitbox.y },
            { x: hitbox.x + r, y: hitbox.y },
            { x: hitbox.x - r, y: hitbox.y },
            { x: hitbox.x, y: hitbox.y + r },
            { x: hitbox.x, y: hitbox.y - r },
            { x: hitbox.x + r * 0.70710678, y: hitbox.y + r * 0.70710678 },
            { x: hitbox.x - r * 0.70710678, y: hitbox.y + r * 0.70710678 },
            { x: hitbox.x + r * 0.70710678, y: hitbox.y - r * 0.70710678 },
            { x: hitbox.x - r * 0.70710678, y: hitbox.y - r * 0.70710678 }
        ];
        return samples.every(pt => !pointInsideMaskHitboxes(pt.x, pt.y, maskHitboxes));
    }

    // Polygon hitbox: vertex and centroid checks.
    if (Array.isArray(hitbox.points) && hitbox.points.length >= 3) {
        const pts = hitbox.points;
        const cx = pts.reduce((sum, pt) => sum + pt.x, 0) / pts.length;
        const cy = pts.reduce((sum, pt) => sum + pt.y, 0) / pts.length;
        const verticesOutside = pts.every(pt => !pointInsideMaskHitboxes(pt.x, pt.y, maskHitboxes));
        if (!verticesOutside) return false;
        return !pointInsideMaskHitboxes(cx, cy, maskHitboxes);
    }

    return false;
}

// True only when every sampled point is inside the provided mask hitboxes.
function isGroundHitboxFullyInsideMaskHitboxes(hitbox, maskHitboxes) {
    if (!hitbox) return false;
    if (!Array.isArray(maskHitboxes) || maskHitboxes.length === 0) return false;

    // Circle hitbox: sample center and perimeter points.
    if (hitbox.type === "circle" && Number.isFinite(hitbox.x) && Number.isFinite(hitbox.y) && Number.isFinite(hitbox.radius)) {
        const r = hitbox.radius;
        const samples = [
            { x: hitbox.x, y: hitbox.y },
            { x: hitbox.x + r, y: hitbox.y },
            { x: hitbox.x - r, y: hitbox.y },
            { x: hitbox.x, y: hitbox.y + r },
            { x: hitbox.x, y: hitbox.y - r },
            { x: hitbox.x + r * 0.70710678, y: hitbox.y + r * 0.70710678 },
            { x: hitbox.x - r * 0.70710678, y: hitbox.y + r * 0.70710678 },
            { x: hitbox.x + r * 0.70710678, y: hitbox.y - r * 0.70710678 },
            { x: hitbox.x - r * 0.70710678, y: hitbox.y - r * 0.70710678 }
        ];
        return samples.every(pt => pointInsideMaskHitboxes(pt.x, pt.y, maskHitboxes));
    }

    // Polygon hitbox: vertex and centroid checks.
    if (Array.isArray(hitbox.points) && hitbox.points.length >= 3) {
        const pts = hitbox.points;
        const cx = pts.reduce((sum, pt) => sum + pt.x, 0) / pts.length;
        const cy = pts.reduce((sum, pt) => sum + pt.y, 0) / pts.length;
        const verticesInside = pts.every(pt => pointInsideMaskHitboxes(pt.x, pt.y, maskHitboxes));
        if (!verticesInside) return false;
        return pointInsideMaskHitboxes(cx, cy, maskHitboxes);
    }

    return false;
}

function wallIntersectsMaskHitboxes(wall, maskHitboxes) {
    if (!wall || !Array.isArray(maskHitboxes) || maskHitboxes.length === 0) return false;

    // Prefer existing ground hitbox overlap when available.
    if (
        wall.groundPlaneHitbox &&
        !isGroundHitboxFullyOutsideMaskHitboxes(wall.groundPlaneHitbox, maskHitboxes)
    ) {
        return true;
    }

    // Fallback: sample the wall baseline segment in world space.
    if (
        wall.a && wall.b &&
        Number.isFinite(wall.a.x) && Number.isFinite(wall.a.y) &&
        Number.isFinite(wall.b.x) && Number.isFinite(wall.b.y)
    ) {
        const samples = [0, 0.25, 0.5, 0.75, 1];
        for (let i = 0; i < samples.length; i++) {
            const t = samples[i];
            const x = wall.a.x + (wall.b.x - wall.a.x) * t;
            const y = wall.a.y + (wall.b.y - wall.a.y) * t;
            if (pointInsideMaskHitboxes(x, y, maskHitboxes)) return true;
        }
    }

    return false;
}

function drawVisibilityMask() {
    if (!visibilityMaskEnabled || !app || !gameContainer) {
        if (visibilityMaskGraphics) visibilityMaskGraphics.visible = false;
        if (gameContainer) gameContainer.mask = null;
        activeVisibilityMaskHitboxes = [];
        return;
    }

    const graphics = ensureVisibilityMaskGraphics();
    let hitboxes = resolveVisibilityHitboxes();
    const interiorRoofHitbox = getRoofInteriorHitbox();
    if (
        (!hitboxes || hitboxes.length === 0) &&
        interiorRoofHitbox &&
        roofInteriorMaskBlend > 0.001
    ) {
        hitboxes = [interiorRoofHitbox];
    }
    activeVisibilityMaskHitboxes = hitboxes || [];

    if (!hitboxes.length) {
        graphics.visible = false;
        gameContainer.mask = null;
        activeVisibilityMaskHitboxes = [];
        return;
    }

    graphics.clear();
    graphics.alpha = Math.max(0.001, Math.min(1, roofInteriorMaskBlend));
    graphics.beginFill(0xffffff, 1);
    let drewMaskShape = false;
    hitboxes.forEach(hitbox => {
        if (!hitbox) return;
        if (hitbox.type === "circle" && Number.isFinite(hitbox.x) && Number.isFinite(hitbox.y) && Number.isFinite(hitbox.radius)) {
            const center = worldToScreen({ x: hitbox.x, y: hitbox.y });
            graphics.drawEllipse(center.x, center.y, hitbox.radius * viewscale, hitbox.radius * viewscale * xyratio);
            drewMaskShape = true;
            return;
        }
        const points = Array.isArray(hitbox.points) ? hitbox.points : null;
        if (!points || points.length < 3) return;
        const screenPoints = projectPolygonPointsToScreen(points);
        const flatPoints = [];
        screenPoints.forEach(pt => {
            flatPoints.push(pt.x, pt.y);
        });
        graphics.drawPolygon(flatPoints);
        drewMaskShape = true;
    });
    graphics.endFill();
    graphics.visible = drewMaskShape;
    gameContainer.mask = drewMaskShape ? graphics : null;
}

function setVisibilityMaskEnabled(enabled) {
    visibilityMaskEnabled = !!enabled;
    if (!visibilityMaskEnabled) {
        if (visibilityMaskGraphics) visibilityMaskGraphics.visible = false;
        if (gameContainer) gameContainer.mask = null;
    }
}

function setVisibilityMaskSources(sources) {
    visibilityMaskSources = Array.isArray(sources) ? sources.slice() : [];
}

function addVisibilityMaskSource(source) {
    if (source) visibilityMaskSources.push(source);
}

function clearVisibilityMaskSources() {
    visibilityMaskSources = [];
}

function getGroundChunkKey(chunkX, chunkY) {
    return `${chunkX},${chunkY}`;
}

function destroyGroundChunk(chunk) {
    if (!chunk) return;
    if (chunk.sprite && chunk.sprite.parent) {
        chunk.sprite.parent.removeChild(chunk.sprite);
    }
    if (chunk.sprite) {
        chunk.sprite.destroy({ texture: true, baseTexture: false });
    }
    if (chunk.renderTexture) {
        chunk.renderTexture.destroy(true);
    }
}

function clearGroundChunkCache() {
    groundChunkCache.forEach(chunk => destroyGroundChunk(chunk));
    groundChunkCache.clear();
}

function drawSpellHoverTargetHighlight() {
    if (!objectLayer) return;
    if (!spellHoverHighlightSprite) {
        spellHoverHighlightSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        spellHoverHighlightSprite.visible = false;
        spellHoverHighlightSprite.blendMode = PIXI.BLEND_MODES.ADD;
        spellHoverHighlightSprite.interactive = false;
        spellHoverHighlightSprite.renderable = true;
    }
    if (!spellHoverHighlightWallGraphics) {
        spellHoverHighlightWallGraphics = new PIXI.Graphics();
        spellHoverHighlightWallGraphics.visible = false;
        spellHoverHighlightWallGraphics.skipTransform = true;
        spellHoverHighlightWallGraphics.blendMode = PIXI.BLEND_MODES.ADD;
        spellHoverHighlightWallGraphics.interactive = false;
    }

    if (
        !wizard ||
        !SpellSystem ||
        typeof SpellSystem.getHoverTargetForCurrentSpell !== "function" ||
        !Number.isFinite(mousePos.worldX) ||
        !Number.isFinite(mousePos.worldY)
    ) {
        if (spellHoverHighlightSprite) spellHoverHighlightSprite.visible = false;
        if (spellHoverHighlightWallGraphics) {
            spellHoverHighlightWallGraphics.clear();
            spellHoverHighlightWallGraphics.visible = false;
        }
        return;
    }

    const target = SpellSystem.getHoverTargetForCurrentSpell(wizard, mousePos.worldX, mousePos.worldY);
    if (!target || !target.pixiSprite || target.gone || target.vanishing) {
        spellHoverHighlightSprite.visible = false;
        if (spellHoverHighlightWallGraphics) {
            spellHoverHighlightWallGraphics.clear();
            spellHoverHighlightWallGraphics.visible = false;
        }
        return;
    }
    const targetSprite = target.pixiSprite;
    if (!targetSprite.parent) {
        spellHoverHighlightSprite.visible = false;
        if (spellHoverHighlightWallGraphics) {
            spellHoverHighlightWallGraphics.clear();
            spellHoverHighlightWallGraphics.visible = false;
        }
        return;
    }

    const pulse = 0.55 + 0.45 * (Math.sin(frameCount * 0.12) * 0.5 + 0.5);

    if (targetSprite instanceof PIXI.Sprite) {
        if (spellHoverHighlightWallGraphics) {
            spellHoverHighlightWallGraphics.clear();
            spellHoverHighlightWallGraphics.visible = false;
        }
        spellHoverHighlightSprite.texture = targetSprite.texture || PIXI.Texture.WHITE;
        if (targetSprite.anchor && spellHoverHighlightSprite.anchor) {
            spellHoverHighlightSprite.anchor.set(targetSprite.anchor.x, targetSprite.anchor.y);
        }
        spellHoverHighlightSprite.position.set(targetSprite.position.x, targetSprite.position.y);
        spellHoverHighlightSprite.scale.set(targetSprite.scale.x, targetSprite.scale.y);
        spellHoverHighlightSprite.rotation = targetSprite.rotation;
        spellHoverHighlightSprite.skew.set(targetSprite.skew.x, targetSprite.skew.y);
        spellHoverHighlightSprite.pivot.set(targetSprite.pivot.x, targetSprite.pivot.y);
        spellHoverHighlightSprite.tint = 0x66c2ff;
        spellHoverHighlightSprite.alpha = 0.35 * pulse;
        spellHoverHighlightSprite.visible = true;

        const parent = targetSprite.parent;
        if (spellHoverHighlightSprite.parent !== parent) {
            if (spellHoverHighlightSprite.parent) {
                spellHoverHighlightSprite.parent.removeChild(spellHoverHighlightSprite);
            }
            parent.addChild(spellHoverHighlightSprite);
        } else {
            // Keep the glow directly above the target sprite.
            const targetIndex = parent.getChildIndex(targetSprite);
            const glowIndex = parent.getChildIndex(spellHoverHighlightSprite);
            const desiredIndex = Math.min(parent.children.length - 1, targetIndex + 1);
            if (glowIndex !== desiredIndex) {
                parent.setChildIndex(spellHoverHighlightSprite, desiredIndex);
            }
        }
        return;
    }

    spellHoverHighlightSprite.visible = false;

    if (
        target.type === "wall" &&
        typeof Wall !== "undefined" &&
        typeof Wall.drawWall === "function" &&
        spellHoverHighlightWallGraphics
    ) {
        const parent = targetSprite.parent;
        spellHoverHighlightWallGraphics.clear();
        const profile = (typeof target.getWallProfile === "function")
            ? target.getWallProfile()
            : null;
        const renderCapA = (typeof target.hasConnectedWallAtEndpoint === "function")
            ? !target.hasConnectedWallAtEndpoint("a")
            : true;
        const renderCapB = (typeof target.hasConnectedWallAtEndpoint === "function")
            ? !target.hasConnectedWallAtEndpoint("b")
            : true;

        Wall.drawWall(
            spellHoverHighlightWallGraphics,
            target.a,
            target.b,
            target.height,
            target.thickness,
            0x66c2ff,
            0.3 * pulse,
            {
                profile,
                renderCapA,
                renderCapB,
                disableWallTexture: true,
                texturePhaseA: target.texturePhaseA,
                texturePhaseB: target.texturePhaseB
            }
        );
        spellHoverHighlightWallGraphics.visible = true;
        if (spellHoverHighlightWallGraphics.parent !== parent) {
            if (spellHoverHighlightWallGraphics.parent) {
                spellHoverHighlightWallGraphics.parent.removeChild(spellHoverHighlightWallGraphics);
            }
            parent.addChild(spellHoverHighlightWallGraphics);
        } else {
            const targetIndex = parent.getChildIndex(targetSprite);
            const glowIndex = parent.getChildIndex(spellHoverHighlightWallGraphics);
            const desiredIndex = Math.min(parent.children.length - 1, targetIndex + 1);
            if (glowIndex !== desiredIndex) {
                parent.setChildIndex(spellHoverHighlightWallGraphics, desiredIndex);
            }
        }
        return;
    }

    if (spellHoverHighlightWallGraphics) {
        spellHoverHighlightWallGraphics.clear();
        spellHoverHighlightWallGraphics.visible = false;
    }
}

function buildPlaceObjectPreviewRenderItem() {
    if (!objectLayer || !wizard || wizard.currentSpell !== "placeobject") {
        if (placeObjectPreviewSprite) placeObjectPreviewSprite.visible = false;
        return null;
    }
    if (!Number.isFinite(mousePos.worldX) || !Number.isFinite(mousePos.worldY)) {
        if (placeObjectPreviewSprite) placeObjectPreviewSprite.visible = false;
        return null;
    }

    const texturePath = (
        typeof wizard.selectedPlaceableTexturePath === "string" &&
        wizard.selectedPlaceableTexturePath.length > 0
    ) ? wizard.selectedPlaceableTexturePath : "/assets/images/doors/door5.png";

    if (!placeObjectPreviewSprite) {
        placeObjectPreviewSprite = new PIXI.Sprite(PIXI.Texture.from(texturePath));
        placeObjectPreviewSprite.anchor.set(0.5, 0.5);
        placeObjectPreviewSprite.alpha = 0.5;
        placeObjectPreviewSprite.interactive = false;
        placeObjectPreviewSprite.visible = false;
        placeObjectPreviewTexturePath = texturePath;
    } else if (placeObjectPreviewTexturePath !== texturePath) {
        placeObjectPreviewSprite.texture = PIXI.Texture.from(texturePath);
        placeObjectPreviewTexturePath = texturePath;
    }

    const worldX = (map && typeof map.wrapWorldX === "function")
        ? map.wrapWorldX(mousePos.worldX)
        : mousePos.worldX;
    const worldY = (map && typeof map.wrapWorldY === "function")
        ? map.wrapWorldY(mousePos.worldY)
        : mousePos.worldY;
    const placeableScale = (wizard && Number.isFinite(wizard.selectedPlaceableScale))
        ? Number(wizard.selectedPlaceableScale)
        : 1;
    const clampedScale = Math.max(0.2, Math.min(5, placeableScale));
    const yScale = Math.max(0.1, Math.abs(Number.isFinite(xyratio) ? xyratio : 0.66));
    const placementYOffset = (clampedScale * 0.5) / yScale;
    let placedY = worldY + placementYOffset;
    if (map && typeof map.wrapWorldY === "function") {
        placedY = map.wrapWorldY(placedY);
    }
    const renderDepthOffset = (wizard && Number.isFinite(wizard.selectedPlaceableRenderOffset))
        ? Number(wizard.selectedPlaceableRenderOffset)
        : 0;

    placeObjectPreviewSprite.tint = 0xffffff;
    placeObjectPreviewSprite.visible = true;
    return {
        type: "placedObjectPreview",
        x: worldX,
        y: worldY,
        width: clampedScale,
        height: clampedScale,
        renderZ: placedY + renderDepthOffset,
        previewAlpha: 0.5,
        pixiSprite: placeObjectPreviewSprite
    };
}

function ensureSpellCursorShape(mode) {
    if (!spellCursor) return;
    if (mode === "placeobject") {
        const halfW = Math.max(1, viewscale * 0.5);
        const halfH = Math.max(1, viewscale * xyratio * 0.5);
        const shapeKey = `cross:${Math.round(halfW * 1000)}:${Math.round(halfH * 1000)}`;
        if (spellCursor._shapeKey === shapeKey) return;
        spellCursor.clear();
        spellCursor.lineStyle(1, 0x000000, 1);
        spellCursor.moveTo(-halfW, 0);
        spellCursor.lineTo(halfW, 0);
        spellCursor.moveTo(0, -halfH);
        spellCursor.lineTo(0, halfH);
        spellCursor._shapeKey = shapeKey;
        return;
    }

    const shapeKey = "default";
    if (spellCursor._shapeKey === shapeKey) return;
    spellCursor.clear();
    const cursorSize = 20;
    const tenpoints = Array.from(
        { length: 10 }, (_, i) => i * 36
    ).map(angle => ({ x: Math.cos(angle * Math.PI / 180) * cursorSize, y: Math.sin(angle * Math.PI / 180) * cursorSize }));
    const fivepoints = Array.from(
        { length: 5 }, (_, i) => i * 72 + 18
    ).map(angle => ({ x: Math.cos(angle * Math.PI / 180) * cursorSize * 0.5, y: Math.sin(angle * Math.PI / 180) * cursorSize * 0.5 }));
    spellCursor.lineStyle(2, 0x44aaff, 1);
    for (let i = 0; i < 5; i++) {
        spellCursor.moveTo(tenpoints[i * 2].x, tenpoints[i * 2].y);
        spellCursor.lineTo(fivepoints[i].x, fivepoints[i].y);
        spellCursor.lineTo(tenpoints[i * 2 + 1].x, tenpoints[i * 2 + 1].y);
    }
    spellCursor._shapeKey = shapeKey;
}

function invalidateGroundChunks() {
    groundChunkCache.forEach(chunk => {
        chunk.dirty = true;
    });
}

function buildGroundChunk(chunkX, chunkY) {
    if (!map || !map.nodes || !app || !app.renderer) return null;

    const xStart = chunkX * groundChunkTileSize;
    const yStart = chunkY * groundChunkTileSize;
    const xEnd = Math.min(map.width - 1, xStart + groundChunkTileSize - 1);
    const yEnd = Math.min(map.height - 1, yStart + groundChunkTileSize - 1);
    if (xStart > xEnd || yStart > yEnd) return null;

    const renderXStart = Math.max(0, xStart - groundChunkRenderPaddingTiles);
    const renderYStart = Math.max(0, yStart - groundChunkRenderPaddingTiles);
    const renderXEnd = Math.min(map.width - 1, xEnd + groundChunkRenderPaddingTiles);
    const renderYEnd = Math.min(map.height - 1, yEnd + groundChunkRenderPaddingTiles);

    let coreMinWorldX = Infinity;
    let coreMinWorldY = Infinity;
    let coreMaxWorldX = -Infinity;
    let coreMaxWorldY = -Infinity;

    for (let x = xStart; x <= xEnd; x++) {
        for (let y = yStart; y <= yEnd; y++) {
            const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
            if (!node) continue;
            coreMinWorldX = Math.min(coreMinWorldX, node.x - map.hexWidth / 2);
            coreMaxWorldX = Math.max(coreMaxWorldX, node.x + map.hexWidth / 2);
            coreMinWorldY = Math.min(coreMinWorldY, node.y - map.hexHeight / 2);
            coreMaxWorldY = Math.max(coreMaxWorldY, node.y + map.hexHeight / 2);
        }
    }
    if (!Number.isFinite(coreMinWorldX) || !Number.isFinite(coreMinWorldY) || !Number.isFinite(coreMaxWorldX) || !Number.isFinite(coreMaxWorldY)) {
        return null;
    }

    let minWorldX = Infinity;
    let minWorldY = Infinity;
    let maxWorldX = -Infinity;
    let maxWorldY = -Infinity;

    for (let x = renderXStart; x <= renderXEnd; x++) {
        for (let y = renderYStart; y <= renderYEnd; y++) {
            const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
            if (!node) continue;
            minWorldX = Math.min(minWorldX, node.x - map.hexWidth / 2);
            maxWorldX = Math.max(maxWorldX, node.x + map.hexWidth / 2);
            minWorldY = Math.min(minWorldY, node.y - map.hexHeight / 2);
            maxWorldY = Math.max(maxWorldY, node.y + map.hexHeight / 2);
        }
    }
    if (!Number.isFinite(minWorldX) || !Number.isFinite(minWorldY) || !Number.isFinite(maxWorldX) || !Number.isFinite(maxWorldY)) {
        return null;
    }

    const scalePadWorldX = (map.hexWidth * (groundTileOverlapScale - 1)) / 2;
    const scalePadWorldY = (map.hexHeight * (groundTileOverlapScale - 1)) / 2;
    // Preserve enough overlap for top-edge alpha feathering across chunk crop boundaries.
    const featherPadWorldX = map.hexWidth * groundTileOverlapScale * groundTileFeatherRatio;
    const featherPadWorldY = map.hexHeight * groundTileOverlapScale * groundTileFeatherRatio;
    const overlapPadWorldX = scalePadWorldX + featherPadWorldX + 0.02;
    const overlapPadWorldY = scalePadWorldY + featherPadWorldY + 0.02;
    minWorldX -= overlapPadWorldX;
    maxWorldX += overlapPadWorldX;
    minWorldY -= overlapPadWorldY;
    maxWorldY += overlapPadWorldY;

    const pixelWidth = Math.max(2, Math.ceil((maxWorldX - minWorldX) * viewscale) + 2);
    const pixelHeight = Math.max(2, Math.ceil((maxWorldY - minWorldY) * viewscale * xyratio) + 2);

    const renderTexture = PIXI.RenderTexture.create({ width: pixelWidth, height: pixelHeight });
    const chunkContainer = new PIXI.Container();
    const chunkNodes = [];

    for (let x = renderXStart; x <= renderXEnd; x++) {
        for (let y = renderYStart; y <= renderYEnd; y++) {
            const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
            if (!node) continue;
            chunkNodes.push(node);
        }
    }
    chunkNodes.sort((a, b) => {
        if (a.y !== b.y) return a.y - b.y;
        return a.x - b.x;
    });

    chunkNodes.forEach(node => {
        const textureId = Number.isFinite(node.groundTextureId) ? node.groundTextureId : 0;
        const texture = (map.groundTextures && map.groundTextures[textureId]) ? map.groundTextures[textureId] : PIXI.Texture.WHITE;
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5, 0.5);
        sprite.x = (node.x - minWorldX) * viewscale;
        sprite.y = (node.y - minWorldY) * viewscale * xyratio;
        sprite.width = map.hexWidth * viewscale * groundTileOverlapScale;
        sprite.height = map.hexHeight * viewscale * xyratio * groundTileOverlapScale;
        chunkContainer.addChild(sprite);
    });

    app.renderer.render(chunkContainer, renderTexture, true);
    chunkContainer.destroy({ children: true });

    const displayMinWorldX = coreMinWorldX - overlapPadWorldX;
    const displayMaxWorldX = coreMaxWorldX + overlapPadWorldX;
    const displayMinWorldY = coreMinWorldY - overlapPadWorldY;
    const displayMaxWorldY = coreMaxWorldY + overlapPadWorldY;

    let frameX = Math.floor((displayMinWorldX - minWorldX) * viewscale);
    let frameY = Math.floor((displayMinWorldY - minWorldY) * viewscale * xyratio);
    let frameW = Math.ceil((displayMaxWorldX - displayMinWorldX) * viewscale) + 2;
    let frameH = Math.ceil((displayMaxWorldY - displayMinWorldY) * viewscale * xyratio) + 2;

    frameX = Math.max(0, Math.min(frameX, pixelWidth - 1));
    frameY = Math.max(0, Math.min(frameY, pixelHeight - 1));
    frameW = Math.max(1, Math.min(frameW, pixelWidth - frameX));
    frameH = Math.max(1, Math.min(frameH, pixelHeight - frameY));

    const frameTexture = new PIXI.Texture(renderTexture, new PIXI.Rectangle(frameX, frameY, frameW, frameH));
    const sprite = new PIXI.Sprite(frameTexture);
    sprite.roundPixels = false;
    landLayer.addChild(sprite);

    return {
        key: getGroundChunkKey(chunkX, chunkY),
        chunkX,
        chunkY,
        minWorldX: displayMinWorldX,
        minWorldY: displayMinWorldY,
        renderTexture,
        sprite,
        dirty: false
    };
}

function ensureGroundChunk(chunkX, chunkY) {
    const key = getGroundChunkKey(chunkX, chunkY);
    const existing = groundChunkCache.get(key);
    if (existing && !existing.dirty) return existing;

    if (existing) {
        destroyGroundChunk(existing);
        groundChunkCache.delete(key);
    }

    const rebuilt = buildGroundChunk(chunkX, chunkY);
    if (!rebuilt) return null;
    groundChunkCache.set(key, rebuilt);
    return rebuilt;
}

function getDebugRedrawPlan() {
    return { hex: true, ground: true, hit: true, boundary: true };
}

function drawCanvas() {
    if (!wizard) return;
    const perfStartMs = performance.now();
    const drawPerf = {
        lazyMs: 0,
        prepMs: 0,
        collectMs: 0,
        losMs: 0,
        composeMs: 0,
        totalMs: 0,
        hydratedRoads: 0,
        hydratedTrees: 0,
        mapItems: 0,
        onscreen: 0
    };
    const renderCamera = (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
        ? interpolatedViewport
        : viewport;
    const lazyStartMs = performance.now();
    if (typeof hydrateVisibleLazyRoads === "function") {
        drawPerf.hydratedRoads = hydrateVisibleLazyRoads({ maxPerFrame: 48, paddingWorld: 12 }) || 0;
    }
    if (typeof hydrateVisibleLazyTrees === "function") {
        drawPerf.hydratedTrees = hydrateVisibleLazyTrees({ maxPerFrame: 48, paddingWorld: 12 }) || 0;
    }
    drawPerf.lazyMs = performance.now() - lazyStartMs;
    const frameNowMs = (typeof renderNowMs === "number" && Number.isFinite(renderNowMs) && renderNowMs > 0)
        ? renderNowMs
        : performance.now();
    if (!Number.isFinite(lastRenderFrameMs) || lastRenderFrameMs <= 0) {
        lastRenderFrameMs = frameNowMs;
    }
    const frameDtSec = Math.max(0, (frameNowMs - lastRenderFrameMs) / 1000);
    lastRenderFrameMs = frameNowMs;
    const occlusionFadeTimeSec = 0.3;
    const occlusionLerpFactor = (occlusionFadeTimeSec <= 0)
        ? 1
        : (1 - Math.exp(-frameDtSec / occlusionFadeTimeSec));
    const losFadeTimeSec = 0.05;
    const losLerpFactor = (losFadeTimeSec <= 0)
        ? 1
        : (1 - Math.exp(-frameDtSec / losFadeTimeSec));

    const prepStartMs = performance.now();
    const debugRedrawPlan = getDebugRedrawPlan();
    updateRoofPreview(roof);
    // Update land layer position (tiling background)
    updateLandLayer();

    // Keep grid locked to camera movement; redraw every frame when visible.
    drawHexGrid(showHexGrid || debugMode ? true : debugRedrawPlan.hex);
    drawMapBorder();
    drawGroundPlaneHitboxes(debugRedrawPlan.ground);

    // Clear and rebuild render layers
    if (roadLayer) {
        roadLayer.removeChildren();
    }
    objectLayer.removeChildren();

    // Keep phantom wall visible during layout mode
    if (wizard.wallLayoutMode && wizard.wallStartPoint && wizard.phantomWall) {
        updatePhantomWall(wizard.wallStartPoint.x, wizard.wallStartPoint.y, mousePos.worldX, mousePos.worldY);
        objectLayer.addChild(wizard.phantomWall);
    }

    // Keep phantom road visible during layout mode
    if (wizard.roadLayoutMode && wizard.roadStartPoint && wizard.phantomRoad) {
        updatePhantomRoad(wizard.roadStartPoint.x, wizard.roadStartPoint.y, mousePos.worldX, mousePos.worldY);
        if (roadLayer) {
            roadLayer.addChild(wizard.phantomRoad);
        } else {
            objectLayer.addChild(wizard.phantomRoad);
        }
    }
    drawPerf.prepMs = performance.now() - prepStartMs;

    const collectStartMs = performance.now();
    let mapItems = [];
    let roadItems = [];
    const seenMapItems = new Set();
    const seenRoadItems = new Set();
    onscreenObjects.clear();

    if (map && map.nodes) {
        // Keep large trees in the object set before their base tile reaches the viewport.
        // This prevents tall trees from "popping in" at the top/bottom edges.
        const maxExpectedTreeSize = 20;
        const maxTreeWidth = maxExpectedTreeSize;
        const maxTreeHeight = maxExpectedTreeSize;
        const xPadding = Math.ceil(maxTreeWidth / 2) + 2;
        const yPadding = Math.ceil(maxTreeHeight) + 2;

        forEachWrappedNodeInViewport(xPadding, yPadding, (node) => {
            if (!node.objects || node.objects.length === 0) return;
            node.objects.forEach(obj => {
                if (!obj || seenMapItems.has(obj)) return;
                seenMapItems.add(obj);
                if (obj && obj.type === "road") {
                    if (!seenRoadItems.has(obj)) {
                        seenRoadItems.add(obj);
                        roadItems.push(obj);
                    }
                    mapItems.push(obj);
                    if (obj && obj.visualHitbox && !obj.gone && !obj.vanishing) {
                        onscreenObjects.add(obj);
                    }
                } else {
                    mapItems.push(obj);
                    if (obj && (obj.visualHitbox || obj.hitbox) && !obj.gone && !obj.vanishing) {
                        onscreenObjects.add(obj);
                    }
                }
            });
        }, renderCamera);
    }
    animals.forEach(animal => {
        if (animal.onScreen) {
            mapItems.push(animal);
            onscreenObjects.add(animal);
        }
    });
    drawPerf.collectMs = performance.now() - collectStartMs;
    drawPerf.mapItems = mapItems.length;
    drawPerf.onscreen = onscreenObjects.size;

    const activeAuras = (wizard && Array.isArray(wizard.activeAuras))
        ? wizard.activeAuras
        : ((wizard && typeof wizard.activeAura === "string") ? [wizard.activeAura] : []);
    const omnivisionActive = activeAuras.includes("omnivision");
    let losPerfMs = 0;

    if (!omnivisionActive && typeof LOSSystem !== "undefined" && LOSSystem && typeof LOSSystem.computeState === "function") {
        const losBuildStartMs = performance.now();
        const losCandidates = [];
        if (onscreenObjects && onscreenObjects.size > 0) {
            onscreenObjects.forEach(obj => {
                if (!obj || obj === wizard || obj.gone || obj.vanishing) return;
                if (isLosOccluder(obj)) losCandidates.push(obj);
            });
        }
        const losBuildMs = performance.now() - losBuildStartMs;
        const candidateCount = losCandidates.length;
        const candidateHash = computeLosCandidateHash(losCandidates);
        const facingAngle = getWizardFacingAngleRad();
        const movedDx = (map && typeof map.shortestDeltaX === "function" && Number.isFinite(lastLosWizardX))
            ? map.shortestDeltaX(lastLosWizardX, wizard.x)
            : (Number.isFinite(lastLosWizardX) ? (wizard.x - lastLosWizardX) : Infinity);
        const movedDy = (map && typeof map.shortestDeltaY === "function" && Number.isFinite(lastLosWizardY))
            ? map.shortestDeltaY(lastLosWizardY, wizard.y)
            : (Number.isFinite(lastLosWizardY) ? (wizard.y - lastLosWizardY) : Infinity);
        const movedDist = Math.hypot(movedDx, movedDy);
        const facingDelta = Number.isFinite(lastLosFacingAngle)
            ? Math.abs(Math.atan2(Math.sin(facingAngle - lastLosFacingAngle), Math.cos(facingAngle - lastLosFacingAngle)))
            : Infinity;
        const structuralChange = (
            !currentLosState ||
            candidateCount !== lastLosCandidateCount ||
            candidateHash !== lastLosCandidateHash
        );
        const losThrottleMs = 33; // ~30 Hz LOS updates are usually sufficient.
        const timeSinceLastLosMs = Number.isFinite(lastLosComputeAtMs) ? (frameNowMs - lastLosComputeAtMs) : Infinity;
        const shouldRecomputeLos = (
            structuralChange ||
            movedDist > 0.03 ||
            facingDelta > 0.05 ||
            timeSinceLastLosMs >= losThrottleMs
        );
        let losTraceMs = 0;

        if (shouldRecomputeLos) {
            currentLosState = LOSSystem.computeState(wizard, losCandidates, {
                bins: 2500,
                facingAngle,
                fovDegrees: losForwardFovDegrees
            });
            currentLosVisibleSet = new Set(currentLosState.visibleObjects || []);
            currentLosVisibleWallGroups = null;
            losTraceMs = Number.isFinite(currentLosState.elapsedMs) ? currentLosState.elapsedMs : 0;
            lastLosWizardX = wizard.x;
            lastLosWizardY = wizard.y;
            lastLosFacingAngle = facingAngle;
            lastLosCandidateCount = candidateCount;
            lastLosCandidateHash = candidateHash;
            lastLosComputeAtMs = frameNowMs;
        }
        if (typeof globalThis !== "undefined") {
            globalThis.losDebugVisibleObjects = currentLosState.visibleObjects || [];
            globalThis.losDebugLastMs = losBuildMs + losTraceMs;
            globalThis.losDebugBreakdown = {
                buildMs: losBuildMs,
                traceMs: losTraceMs,
                totalMs: losBuildMs + losTraceMs,
                recomputed: shouldRecomputeLos,
                candidates: candidateCount
            };
        }
        losPerfMs = losBuildMs + losTraceMs;
    } else {
        currentLosState = null;
        currentLosVisibleSet = null;
        currentLosVisibleWallGroups = null;
        lastLosWizardX = null;
        lastLosWizardY = null;
        lastLosFacingAngle = null;
        lastLosCandidateCount = -1;
        lastLosCandidateHash = 0;
        lastLosComputeAtMs = 0;
        if (typeof globalThis !== "undefined") {
            globalThis.losDebugVisibleObjects = [];
            globalThis.losDebugLastMs = 0;
            globalThis.losDebugBreakdown = {
                buildMs: 0,
                traceMs: 0,
                totalMs: 0,
                recomputed: false,
                candidates: 0
            };
        }
        losPerfMs = 0;
    }
    drawPerf.losMs = losPerfMs;
    const composeStartMs = performance.now();
    applyLosGroundMask();
    applyLosShadow();

    // Process vanishing roads and update the list before rendering
    roadItems = roadItems.filter(road => {
        if (road.vanishing && road.vanishStartTime !== undefined) {
            const elapsedFrames = frameCount - road.vanishStartTime;
            const progress = Math.min(1, elapsedFrames / road.vanishDuration);

            // Mark for removal when fully vanished
            if (progress >= 1) {
                road.removeFromNodes();
                return false; // Remove from array
            }
        }
        return true; // Keep in array
    });

    // Legacy road mask layer disabled; roads render as regular sprites.

    wizardCoors = worldToScreen(wizard);

    const interiorRoofHitbox = getRoofInteriorHitbox();
    const wizardInsideInteriorRoof = !!(
        interiorRoofHitbox &&
        wizard &&
        interiorRoofHitbox.containsPoint(wizard.x, wizard.y)
    );
    updateRoofInteriorMaskBlend(wizardInsideInteriorRoof);

    const roofRenderDepth = (
        roof &&
        roof.placed &&
        roof.pixiMesh &&
        roof.pixiMesh.visible &&
        Number.isFinite(roof.y)
    )
        ? (roof.y - (Number.isFinite(roof.peakHeight) ? roof.peakHeight : 0))
        : null;
    const roofWallDepthHitbox = (
        roof &&
        roof.placed &&
        (roof.wallDepthHitbox || roof.groundPlaneHitbox)
    ) ? (roof.wallDepthHitbox || roof.groundPlaneHitbox) : null;
    const outsideRoofInteriorHitbox = (
        interiorRoofHitbox &&
        wizard &&
        !interiorRoofHitbox.containsPoint(wizard.x, wizard.y)
    ) ? interiorRoofHitbox : null;

    function getRenderDepth(item) {
        if (!item) return 0;
        if (item.isRoofInteriorBlackout) return 0.0001;
        if (
            item.type === "wall" &&
            Number.isFinite(roofRenderDepth) &&
            roofWallDepthHitbox &&
            wallIntersectsMaskHitboxes(item, [roofWallDepthHitbox])
        ) {
            // Structural walls within the roof footprint should render beneath the roof.
            return roofRenderDepth - 0.0001;
        }
        if (Number.isFinite(item.renderZ)) return item.renderZ;
        if (item.type === "road") return 0;
        const baseDepth = Number.isFinite(item.y) ? item.y : 0;
        const depthOffset = Number.isFinite(item.renderDepthOffset) ? item.renderDepthOffset : 0;
        return baseDepth + depthOffset;
    }

    if (Number.isFinite(roofRenderDepth) && roof && roof.pixiMesh && roof.pixiMesh.visible) {
        mapItems.push({
            type: "roof",
            isRoofRenderItem: true,
            x: roof.x,
            y: roof.y,
            // Order by roof peak so tall objects can render above lower roof slopes.
            renderZ: roofRenderDepth,
            pixiSprite: roof.pixiMesh
        });
    }
    if (outsideRoofInteriorHitbox) {
        if (!roofInteriorBlackoutGraphics) {
            roofInteriorBlackoutGraphics = new PIXI.Graphics();
            roofInteriorBlackoutGraphics.skipTransform = true;
        }
        roofInteriorBlackoutGraphics.clear();
        const screenPoints = buildRoofInteriorScreenPolygon(outsideRoofInteriorHitbox, 2);
        if (screenPoints && screenPoints.length >= 3) {
            roofInteriorBlackoutGraphics.beginFill(0x000000, 1);
            roofInteriorBlackoutGraphics.moveTo(screenPoints[0].x, screenPoints[0].y);
            for (let i = 1; i < screenPoints.length; i++) {
                roofInteriorBlackoutGraphics.lineTo(screenPoints[i].x, screenPoints[i].y);
            }
            roofInteriorBlackoutGraphics.closePath();
            roofInteriorBlackoutGraphics.endFill();
            mapItems.push({
                type: "roofInteriorBlackout",
                isRoofInteriorBlackout: true,
                renderZ: 0.0001,
                pixiSprite: roofInteriorBlackoutGraphics
            });
        }
    } else if (roofInteriorBlackoutGraphics) {
        roofInteriorBlackoutGraphics.clear();
    }

    const placePreviewItem = buildPlaceObjectPreviewRenderItem();
    if (placePreviewItem) {
        mapItems.push(placePreviewItem);
    }

    // Enforce explicit render ordering:
    // roads at fixed base depth, most objects by world y.
    function getRenderBand(item) {
        if (!item) return 2;
        if (item.type === "road") return 0;
        if (item.isRoofInteriorBlackout) return 1;
        return 2;
    }

    mapItems.sort((a, b) => {
        const aBand = getRenderBand(a);
        const bBand = getRenderBand(b);
        if (aBand !== bBand) return aBand - bBand;

        const az = getRenderDepth(a);
        const bz = getRenderDepth(b);
        if (az !== bz) return az - bz;
        const ay = Number.isFinite(a && a.y) ? a.y : 0;
        const by = Number.isFinite(b && b.y) ? b.y : 0;
        if (ay !== by) return ay - by;
        const ax = Number.isFinite(a && a.x) ? a.x : 0;
        const bx = Number.isFinite(b && b.x) ? b.x : 0;
        return ax - bx;
    });

    const interiorMaskHitboxes = interiorRoofHitbox ? [interiorRoofHitbox] : null;
    const insideBlend = Math.max(0, Math.min(1, roofInteriorMaskBlend));
    const blendTransitioning = insideBlend > 0.001 && insideBlend < 0.999;
    const fullyInsideView = insideBlend >= 0.999;
    const fullyOutsideView = insideBlend <= 0.001;
    const visibleWallGroupsByGeometry = new Set();
    if (Array.isArray(mapItems) && mapItems.length > 0) {
        mapItems.forEach(item => {
            if (!item || item.gone || item.vanishing) return;
            if (item.type !== "wall" || !Number.isInteger(item.lineGroupId)) return;
            if (!item.groundPlaneHitbox) return;
            if (isCurrentlyVisibleByLos(item)) {
                visibleWallGroupsByGeometry.add(item.lineGroupId);
            }
        });
    }
    currentLosVisibleWallGroups = visibleWallGroupsByGeometry;

    // Add sorted items to object layer in explicit passes:
    // roads -> interior blackout -> everything else.
    const renderPasses = [0, 1, 2];
    renderPasses.forEach(passBand => {
        mapItems.forEach(item => {
            if (getRenderBand(item) !== passBand) return;
        if (item && item.isRoofInteriorBlackout && item.pixiSprite) {
            objectLayer.addChild(item.pixiSprite);
            return;
        }
        if (item && item.isRoofRenderItem && item.pixiSprite) {
            objectLayer.addChild(item.pixiSprite);
            return;
        }
        // Skip items that have been fully vanished
        if (item.gone) return;
        let interiorFadeAlpha = 1;
        if (interiorMaskHitboxes && item.groundPlaneHitbox) {
            const itemCountsAsInside = (item.type === "wall")
                ? isGroundHitboxFullyInsideMaskHitboxes(item.groundPlaneHitbox, interiorMaskHitboxes)
                : !isGroundHitboxFullyOutsideMaskHitboxes(item.groundPlaneHitbox, interiorMaskHitboxes);

            if (blendTransitioning) {
                interiorFadeAlpha = itemCountsAsInside ? insideBlend : (1 - insideBlend);
                if (interiorFadeAlpha <= 0.001) return;
            } else if (fullyInsideView && !itemCountsAsInside) {
                return;
            } else if (fullyOutsideView && itemCountsAsInside) {
                return;
            }
        }
        
        // Run object simulation updates at most once per simulation frame.
        if (typeof item.update === "function" && item._lastUpdateFrame !== frameCount) {
            item.update();
            item._lastUpdateFrame = frameCount;
        }

        if (item.vanishing && item.vanishStartTime !== undefined && item.vanishDuration !== undefined) {
            const elapsedFrames = frameCount - item.vanishStartTime;
            if (elapsedFrames >= item.vanishDuration) {
                if (item.pixiSprite && item.pixiSprite.parent) {
                    item.pixiSprite.parent.removeChild(item.pixiSprite);
                }
                if (typeof item.removeFromNodes === "function") {
                    item.removeFromNodes();
                } else {
                    const itemNode = map.worldToNode(item.x, item.y);
                    if (itemNode) itemNode.removeObject(item);
                }
                item.gone = true;
                return;
            }
        }

            if (item.pixiSprite) {
                if (item.skipTransform && typeof item.draw === "function") {
                    item.draw();
                } else {
                    applySpriteTransform(item);
                }
            let losBrightness = 1;
            let losAlpha = 1;
            if (!omnivisionActive && item.groundPlaneHitbox) {
                const isAnimal = isAnimalEntity(item);
                const isRoad = item.type === "road";
                const isGroupedWall = item.type === "wall" && Number.isInteger(item.lineGroupId);
                if (isRoad) {
                    // Roads behave like ground: never partially fade by LOS visibility rules.
                    losBrightness = 1;
                } else if (isGroupedWall) {
                    const groupId = item.lineGroupId;
                    let groupState = wallLosGroupState.get(groupId);
                    if (!groupState) {
                        groupState = { everVisible: false, brightnessCurrent: 1.0 };
                        wallLosGroupState.set(groupId, groupState);
                    }
                    const groupCoverage = getLosCoverageRatio(item, 0.08);
                    const groupVisibleNow = groupCoverage > 0.0001;
                    if (groupVisibleNow) {
                        groupState.everVisible = true;
                    }
                    const groupTargetBrightness = Math.max(
                        losMinStaticBrightness,
                        (1 - losMaxDarken) + groupCoverage * losMaxDarken
                    );
                    groupState.brightnessCurrent += (groupTargetBrightness - groupState.brightnessCurrent) * losLerpFactor;
                    groupState.brightnessCurrent = Math.max(0, Math.min(1, groupState.brightnessCurrent));
                    losBrightness = groupState.brightnessCurrent;
                } else {
                    const coverageRatio = getLosCoverageRatio(item, 0.05);
                    const currentlyVisible = isCurrentlyVisibleByLos(item);
                    const losTargetBrightness = isAnimal
                        ? (currentlyVisible ? 1 : 0)
                        : Math.max(losMinStaticBrightness, (1 - losMaxDarken) + coverageRatio * losMaxDarken);
                    if (!Number.isFinite(item._losBrightnessCurrent)) {
                        item._losBrightnessCurrent = 1.0;
                    }
                    const itemLosLerpFactor = isAnimal ? Math.min(1, losLerpFactor * 3) : losLerpFactor;
                    item._losBrightnessCurrent += (losTargetBrightness - item._losBrightnessCurrent) * itemLosLerpFactor;
                    losBrightness = Math.max(0, Math.min(1, item._losBrightnessCurrent));
                }
                if (isAnimal) {
                    losAlpha = losBrightness;
                }
            }
            const combinedBaseAlpha = interiorFadeAlpha * losAlpha;
            const perItemAlpha = Number.isFinite(item.previewAlpha)
                ? Math.max(0, Math.min(1, item.previewAlpha))
                : 1;
            const losTintValue = Math.max(0, Math.min(255, Math.round(255 * losBrightness)));
            const losTint = (losTintValue << 16) | (losTintValue << 8) | losTintValue;
            let burnTintValue = null;
            if (Number.isFinite(item && item.maxHP) && Number.isFinite(item && item.hp) && item.maxHP > 0) {
                const hpThreshold = item.maxHP * 0.5;
                if (item.hp < hpThreshold) {
                    const blackProgress = Math.max(0, (hpThreshold - item.hp) / hpThreshold);
                    const burnBrightness = Math.max(0, Math.min(255, Math.floor(255 * (1 - blackProgress * 0.8))));
                    burnTintValue = burnBrightness;
                }
            }
            if ((item && item.burned) || (Number.isFinite(item && item.hp) && item.hp <= 0)) {
                burnTintValue = 0x22;
            }

            // Combine vanish alpha with occlusion alpha
            if (item.vanishing === true && item.vanishStartTime !== undefined && item.vanishDuration !== undefined) {
                const elapsedFrames = frameCount - item.vanishStartTime;

                if (elapsedFrames < 1) {
                    // First frame: show blue tint
                    item.pixiSprite.tint = 0x0099FF;
                    item.pixiSprite.alpha = combinedBaseAlpha * perItemAlpha;
                } else {
                    // Fade phase: fade from blue to transparent over 1/4 second
                    const fadeElapsed = elapsedFrames - 1;
                    const fadeDuration = 0.25 * frameRate; // 1/4 second
                    const percentVanished = Math.min(1, fadeElapsed / fadeDuration);
                    const vanishAlpha = Math.max(0, 1 - percentVanished);
                    item.pixiSprite.tint = 0x0099FF; // Keep blue tint while fading
                    item.pixiSprite.alpha = combinedBaseAlpha * vanishAlpha * perItemAlpha;
                }
            } else {
                if (Number.isFinite(burnTintValue)) {
                    const combinedTintValue = Math.min(losTintValue, Math.max(0, Math.min(255, Math.round(burnTintValue))));
                    item.pixiSprite.tint = (combinedTintValue << 16) | (combinedTintValue << 8) | combinedTintValue;
                } else {
                    item.pixiSprite.tint = losTint;
                }
                item.pixiSprite.alpha = combinedBaseAlpha * perItemAlpha;
            }
            if (item.pixiSprite.mask === losGroundMaskGraphics) {
                item.pixiSprite.mask = null;
            }
            // item.pixiSprite.anchor.set(0.1, 0.1);
            const targetLayer = (item.type === "road" && roadLayer) ? roadLayer : objectLayer;
            targetLayer.addChild(item.pixiSprite);

            // Render fire if burning or fading out
            if (item.isOnFire || item.fireFadeStart !== undefined) {
                ensureFireFrames();
                if (!fireFrames || fireFrames.length === 0) return;
                if (item.fireFrameIndex === undefined || item.fireFrameIndex === null) {
                    item.fireFrameIndex = 0;
                }
                if (!item.fireSprite) {
                    item.fireSprite = new PIXI.Sprite(fireFrames[0]);
                    item.fireSprite.anchor.set(0.5, 0.5);
                }
                if (fireFrames.length > 0) {
                    const normalized = ((Math.floor(item.fireFrameIndex) % fireFrames.length) + fireFrames.length) % fireFrames.length;
                    item.fireFrameIndex = normalized;
                }
                // Advance fire animation once per simulation frame to avoid
                // speeding up on high render FPS.
                if (item._lastFireAnimFrame !== frameCount && frameCount % 2 === 0) {
                    item.fireFrameIndex = (item.fireFrameIndex + 1) % fireFrames.length;
                }
                item._lastFireAnimFrame = frameCount;
                item.fireSprite.texture = fireFrames[item.fireFrameIndex];
                const fireCoors = worldToScreen(item);
                const itemHeight = (item.height || 1) * viewscale * xyratio;

                // Calculate fire position accounting for tree rotation
                // Tree rotates around its anchor point (bottom center for trees)
                // Fire should stay at the center of the tree but remain upright
                if (item.type === "tree") {
                    const rotRad = (item.rotation ?? 0) * (Math.PI / 180);
                    // Center of tree rotates around anchor point
                    const centerOffsetX = (itemHeight / 2) * Math.sin(rotRad);
                    const centerOffsetY = -(itemHeight / 2) * Math.cos(rotRad);
                    item.fireSprite.x = fireCoors.x + centerOffsetX;
                    item.fireSprite.y = fireCoors.y + centerOffsetY;
                } else {
                    // For animals, position fire lower (closer to ground)
                    item.fireSprite.x = fireCoors.x;
                    item.fireSprite.y = fireCoors.y;
                }

                item.fireSprite.anchor.set(0.5, 1); // Bottom center of fire at position

                // Scale fire size based on HP loss
                if (item.maxHP && item.hp !== undefined) {
                    const hpLossRatio = Math.max(0, (item.maxHP - item.hp) / item.maxHP);
                    let fireScale = 0.5 + hpLossRatio * 1.5; // Scale from 0.5x to 2x

                    // During fade phase, shrink fire proportionally
                    const alphaMult = item.fireAlphaMult !== undefined ? item.fireAlphaMult : 1;
                    fireScale *= alphaMult;

                    const widthScale = Number.isFinite(item.fireWidthScale) ? item.fireWidthScale : 1;
                    const heightScale = Number.isFinite(item.fireHeightScale) ? item.fireHeightScale : 1;
                    item.fireSprite.width = (item.width || 1) * viewscale * fireScale * widthScale;
                    item.fireSprite.height = (item.height || 1) * viewscale * fireScale * heightScale;
                } else {
                    const widthScale = Number.isFinite(item.fireWidthScale) ? item.fireWidthScale : 1;
                    const heightScale = Number.isFinite(item.fireHeightScale) ? item.fireHeightScale : 1;
                    item.fireSprite.width = (item.width || 1) * viewscale * widthScale;
                    item.fireSprite.height = (item.height || 1) * viewscale * heightScale;
                }

                // Apply alpha fade
                const alphaMult = item.fireAlphaMult !== undefined ? item.fireAlphaMult : 1;
                item.fireSprite.alpha = item.pixiSprite.alpha * alphaMult;
                item.fireSprite.rotation = 0; // Fire stays upright
                objectLayer.addChild(item.fireSprite);
            }
        }
        });
    });

    // Keep firewall preview visible above rendered map objects (including roads).
    if (wizard.firewallLayoutMode && wizard.firewallStartPoint && wizard.phantomFirewall) {
        updatePhantomFirewall(
            wizard.firewallStartPoint.x,
            wizard.firewallStartPoint.y,
            mousePos.worldX,
            mousePos.worldY
        );
        objectLayer.addChild(wizard.phantomFirewall);
    }

    drawSpellHoverTargetHighlight();

    wizard.draw();
    drawProjectiles();
    drawHitboxes(true);
    drawWizardBoundaries(true);
    drawLosDebug(true);
    updateCursor();
    drawVisibilityMask();

    const nextMessageHtml = messages.join("<br>");
    if (nextMessageHtml !== lastRenderedMessageHtml) {
        $('#msg').html(nextMessageHtml);
        lastRenderedMessageHtml = nextMessageHtml;
    }
    drawPerf.composeMs = performance.now() - composeStartMs;
    drawPerf.totalMs = performance.now() - perfStartMs;
    if (typeof globalThis !== "undefined") {
        globalThis.drawPerfBreakdown = drawPerf;
    }
}

function worldToScreen(item) {
    const camera = (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
        ? interpolatedViewport
        : viewport;
    const alpha = (typeof renderAlpha === "number") ? Math.max(0, Math.min(1, renderAlpha)) : 1;
    const worldX = (item && Number.isFinite(item.prevX) && Number.isFinite(item.x))
        ? (
            Number.isFinite(alpha) && map && typeof map.shortestDeltaX === "function"
                ? (item.prevX + map.shortestDeltaX(item.prevX, item.x) * alpha)
                : (item.prevX + (item.x - item.prevX) * alpha)
        )
        : item.x;
    const worldY = (item && Number.isFinite(item.prevY) && Number.isFinite(item.y))
        ? (
            Number.isFinite(alpha) && map && typeof map.shortestDeltaY === "function"
                ? (item.prevY + map.shortestDeltaY(item.prevY, item.y) * alpha)
                : (item.prevY + (item.y - item.prevY) * alpha)
        )
        : item.y;
    const dx = (map && typeof map.shortestDeltaX === "function")
        ? map.shortestDeltaX(camera.x, worldX)
        : (worldX - camera.x);
    const dy = (map && typeof map.shortestDeltaY === "function")
        ? map.shortestDeltaY(camera.y, worldY)
        : (worldY - camera.y);
    return {
        x: dx * viewscale,
        y: dy * viewscale * xyratio
    };
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

function getViewportNodeCorners() {
    if (!map) {
        return { topLeftNode: null, bottomRightNode: null };
    }
    const sampleMaxX = viewport.x + Math.max(0, viewport.width - renderingViewportNodeSampleEpsilon);
    const sampleMaxY = viewport.y + Math.max(0, viewport.height - renderingViewportNodeSampleEpsilon);
    return {
        topLeftNode: worldToNodeCanonical(viewport.x, viewport.y),
        bottomRightNode: worldToNodeCanonical(sampleMaxX, sampleMaxY)
    };
}

function getWrappedIndexRanges(start, end, size, wrapEnabled) {
    if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(start) || !Number.isFinite(end)) return [];
    const rawStart = Math.floor(Math.min(start, end));
    const rawEnd = Math.floor(Math.max(start, end));
    if (!wrapEnabled) {
        const clampedStart = Math.max(0, Math.min(size - 1, rawStart));
        const clampedEnd = Math.max(0, Math.min(size - 1, rawEnd));
        if (clampedEnd < clampedStart) return [];
        return [{ start: clampedStart, end: clampedEnd }];
    }
    if ((rawEnd - rawStart + 1) >= size) {
        return [{ start: 0, end: size - 1 }];
    }
    const wrap = (n) => ((n % size) + size) % size;
    const s = wrap(rawStart);
    const e = wrap(rawEnd);
    if (s <= e) return [{ start: s, end: e }];
    return [
        { start: 0, end: e },
        { start: s, end: size - 1 }
    ];
}

function screenToWorld(screenX, screenY) {
    const camera = (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
        ? interpolatedViewport
        : viewport;
    let worldX = screenX / viewscale + camera.x;
    let worldY = screenY / (viewscale * xyratio) + camera.y;
    if (map && typeof map.wrapWorldX === "function" && Number.isFinite(worldX)) {
        worldX = map.wrapWorldX(worldX);
    }
    if (map && typeof map.wrapWorldY === "function" && Number.isFinite(worldY)) {
        worldY = map.wrapWorldY(worldY);
    }
    if (
        wizard &&
        map &&
        typeof map.shortestDeltaX === "function" &&
        typeof map.shortestDeltaY === "function" &&
        Number.isFinite(wizard.x) &&
        Number.isFinite(wizard.y) &&
        Number.isFinite(worldX) &&
        Number.isFinite(worldY)
    ) {
        worldX = wizard.x + map.shortestDeltaX(wizard.x, worldX);
        worldY = wizard.y + map.shortestDeltaY(wizard.y, worldY);
    }
    return { x: worldX, y: worldY };
}

function centerViewport(obj, margin, smoothing = null) {
    // viewport is in array index units
    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;

    // Convert obj world coordinates to index units
    const objIndexX = obj.x;
    const objIndexY = obj.y;
    const leadDistance = Math.min(viewport.width, viewport.height) * cameraForwardLeadRatio;
    const facingAngle = getWizardFacingAngleRad();
    const leadX = Math.cos(facingAngle) * leadDistance;
    const leadY = Math.sin(facingAngle) * leadDistance;
    const focusX = objIndexX + leadX;
    const focusY = objIndexY + leadY;

    // Check if object is outside the margin box
    const leftBound = centerX - margin;
    const rightBound = centerX + margin;
    const topBound = centerY - margin;
    const bottomBound = centerY + margin;

    // Calculate desired viewport adjustment
    let targetOffsetX = 0;
    let targetOffsetY = 0;

    if (focusX < leftBound) {
        targetOffsetX = (focusX - leftBound);
    } else if (focusX > rightBound) {
        targetOffsetX = (focusX - rightBound);
    }

    if (focusY < topBound) {
        targetOffsetY = (focusY - topBound);
    } else if (focusY > bottomBound) {
        targetOffsetY = (focusY - bottomBound);
    }

    // Move camera toward desired position asymptotically.
    const desiredX = viewport.x + targetOffsetX;
    const desiredY = viewport.y + targetOffsetY;
    const requestedSmoothing = Number.isFinite(smoothing) ? smoothing : cameraFollowSmoothing;
    const smoothFactor = Math.max(0, Math.min(1, requestedSmoothing));
    const factor = smoothFactor > 0 ? smoothFactor : 1;
    const deadband = 0.01;
    let nextX = viewport.x + (desiredX - viewport.x) * factor;
    let nextY = viewport.y + (desiredY - viewport.y) * factor;
    if (Math.abs(nextX - viewport.x) < deadband) nextX = viewport.x;
    if (Math.abs(nextY - viewport.y) < deadband) nextY = viewport.y;

    viewport.x = nextX;
    viewport.y = nextY;

    // Keep camera center on the same torus copy as the followed object to avoid
    // accumulating huge viewport coordinates across seam crossings.
    let seamShiftX = 0;
    let seamShiftY = 0;
    if (map && obj && Number.isFinite(obj.x) && Number.isFinite(obj.y)) {
        const currentCenterX = viewport.x + viewport.width * 0.5;
        const currentCenterY = viewport.y + viewport.height * 0.5;
        if (typeof map.shortestDeltaX === "function" && Number.isFinite(currentCenterX)) {
            const nearestCenterX = obj.x + map.shortestDeltaX(obj.x, currentCenterX);
            seamShiftX = (nearestCenterX - viewport.width * 0.5) - viewport.x;
        }
        if (typeof map.shortestDeltaY === "function" && Number.isFinite(currentCenterY)) {
            const nearestCenterY = obj.y + map.shortestDeltaY(obj.y, currentCenterY);
            seamShiftY = (nearestCenterY - viewport.height * 0.5) - viewport.y;
        }
    }
    const seamEps = 1e-6;
    if ((Math.abs(seamShiftX) > seamEps || Math.abs(seamShiftY) > seamEps)) {
        if (typeof applyViewportWrapShift === "function") {
            applyViewportWrapShift(seamShiftX, seamShiftY);
        } else {
            viewport.x += seamShiftX;
            viewport.y += seamShiftY;
            if (typeof previousViewport !== "undefined") {
                previousViewport.x += seamShiftX;
                previousViewport.y += seamShiftY;
            }
            if (typeof interpolatedViewport !== "undefined") {
                interpolatedViewport.x += seamShiftX;
                interpolatedViewport.y += seamShiftY;
            }
        }
    }

    // Keep precision stable to avoid float-noise shaking over time.
    viewport.x = Math.round(viewport.x * 1000) / 1000;
    viewport.y = Math.round(viewport.y * 1000) / 1000;
}

function drawMapBorder() {
    if (!gameContainer || !map) return;
    if (!mapBorderGraphics) {
        mapBorderGraphics = new PIXI.Graphics();
        mapBorderGraphics.interactive = false;
        gameContainer.addChild(mapBorderGraphics);
    }
    mapBorderGraphics.clear();

    const worldWidth = Number.isFinite(map.worldWidth) ? map.worldWidth : map.width;
    const worldHeight = Number.isFinite(map.worldHeight) ? map.worldHeight : map.height;
    if (!(worldWidth > 0) || !(worldHeight > 0)) return;

    const worldToScreenRaw = (x, y) => ({
        x: (x - viewport.x) * viewscale,
        y: (y - viewport.y) * viewscale * xyratio
    });
    const topLeft = worldToScreenRaw(0, 0);
    const topRight = worldToScreenRaw(worldWidth, 0);
    const bottomRight = worldToScreenRaw(worldWidth, worldHeight);
    const bottomLeft = worldToScreenRaw(0, worldHeight);

    const dash = 8;
    const gap = 6;
    const drawDashed = (a, b) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len <= 1e-6) return;
        const ux = dx / len;
        const uy = dy / len;
        let t = 0;
        while (t < len) {
            const start = t;
            const end = Math.min(len, t + dash);
            mapBorderGraphics.moveTo(a.x + ux * start, a.y + uy * start);
            mapBorderGraphics.lineTo(a.x + ux * end, a.y + uy * end);
            t += dash + gap;
        }
    };

    mapBorderGraphics.lineStyle(2, 0xffffff, 0.85);
    drawDashed(topLeft, topRight);
    drawDashed(topRight, bottomRight);
    drawDashed(bottomRight, bottomLeft);
    drawDashed(bottomLeft, topLeft);
}

function updatePhantomWall(ax, ay, bx, by) {
    if (!wizard.phantomWall) return;

    wizard.phantomWall.clear();

    const nodeA = map.worldToNode(ax, ay);
    const nodeB = map.worldToNode(bx, by);
    if (!nodeA || !nodeB) return;

    const wallPath = map.getHexLine(nodeA, nodeB);
    const wallHeight = Number.isFinite(wizard.selectedWallHeight) ? wizard.selectedWallHeight : 3.0;
    const wallThickness = Number.isFinite(wizard.selectedWallThickness) ? wizard.selectedWallThickness : 0.2;
    for (let i = 0; i < wallPath.length - 1; i++) {
        const nodeA = wallPath[i];
        const nodeB = wallPath[i + 1];

        // Use the static NewWall.drawWall method with phantom styling
        Wall.drawWall(wizard.phantomWall, nodeA, nodeB, wallHeight, wallThickness, 0x888888, 0.5);
    }
}

function updatePhantomFirewall(ax, ay, bx, by) {
    if (!wizard || !wizard.phantomFirewall) return;
    wizard.phantomFirewall.clear();

    const start = worldToScreen({ x: ax, y: ay });
    const end = worldToScreen({ x: bx, y: by });
    wizard.phantomFirewall.lineStyle(4, 0xff3333, 0.95);
    wizard.phantomFirewall.moveTo(start.x, start.y);
    wizard.phantomFirewall.lineTo(end.x, end.y);
}

function updatePhantomRoad(ax, ay, bx, by) {
    if (!wizard.phantomRoad) return;

    wizard.phantomRoad.removeChildren();

    const nodeA = map.worldToNode(ax, ay);
    const nodeB = map.worldToNode(bx, by);
    if (!nodeA || !nodeB) return;

    const width = (nodeA === nodeB) ? 1 : roadWidth;
    const roadNodes = map.getHexLine(nodeA, nodeB, width);

    const roadNodeKeys = new Set(
        roadNodes.map(node => `${node.xindex},${node.yindex}`)
    );

    const oddDirections = [1, 3, 5, 7, 9, 11];

    roadNodes.forEach(node => {
        const neighborDirections = oddDirections.filter(direction => {
            const neighbor = node.neighbors[direction];
            if (!neighbor) return false;

            if (roadNodeKeys.has(`${neighbor.xindex},${neighbor.yindex}`)) return true;

            return neighbor.objects && neighbor.objects.some(obj => obj.type === 'road');
        });

        // Get the geometry for this road piece
        const { keptCorners, radius } = Road.getGeometryForNeighbors(neighborDirections);

        // Create a simple graphics display for the phantom
        const sprite = new PIXI.Graphics();
        sprite.beginFill(0x888888, 0.6);

        if (keptCorners.length >= 3) {
            keptCorners.forEach((pt, idx) => {
                const screenPt = worldToScreen({x: node.x + pt.x / radius / 2, y: node.y + pt.y / radius / 2});
                if (idx === 0) {
                    sprite.moveTo(screenPt.x, screenPt.y);
                } else {
                    sprite.lineTo(screenPt.x, screenPt.y);
                }
            });
            sprite.closePath();
        }
        sprite.endFill();

        wizard.phantomRoad.addChild(sprite);
    });
}

function updateRoadMask(roadItems) {
    return;
}

function screenToHex(screenX, screenY) {
    const worldCoors = screenToWorld(screenX, screenY);
    const worldX = worldCoors.x;
    const worldY = worldCoors.y;

    const approxCol = Math.round(worldX);
    const approxRow = Math.round(worldY - (approxCol % 2 === 0 ? 0.5 : 0));

    let best = {x: approxCol, y: approxRow};
    let bestDist = Infinity;

    for (let cx = approxCol - 1; cx <= approxCol + 1; cx++) {
        for (let cy = approxRow - 1; cy <= approxRow + 1; cy++) {
            if (cx < 0 || cy < 0 || cx >= mapWidth || cy >= mapHeight) continue;
            const worldCenter = {x: cx, y: cy + (cx % 2 === 0 ? 0.5 : 0)};
            const screenCenter = worldToScreen(worldCenter);
            const dx = screenCenter.x - screenX;
            const dy = screenCenter.y - screenY;
            const dist = dx * dx + dy * dy;
            if (dist < bestDist) {
                bestDist = dist;
                best = {x: cx, y: cy};
            }
        }
    }

    return best;
}

function buildSpriteFramesFromList(list, rows, cols) {
    if (!list || list.length < rows * cols) return null;
    const frames = [];
    for (let r = 0; r < rows; r++) {
        frames[r] = [];
        for (let c = 0; c < cols; c++) {
            frames[r][c] = list[r * cols + c];
        }
    }
    return frames;
}

function ensureSpriteFrames(item) {
    if (!item || !item.spriteSheet || item.spriteSheetReady) return;

    const sheet = item.spriteSheet;
    const rows = sheet.rows || 1;
    const cols = sheet.cols || 1;
    let frameList = null;

    if (Array.isArray(sheet.frameTextures)) {
        frameList = sheet.frameTextures;
    } else if (Array.isArray(sheet.frameKeys)) {
        const texGroup = textures[item.type];
        if (texGroup && texGroup.byKey) {
            frameList = sheet.frameKeys.map(key => texGroup.byKey[key]).filter(Boolean);
        }
    } else if (Array.isArray(sheet.framePaths)) {
        frameList = sheet.framePaths.map(path => PIXI.Texture.from(path));
    }

    const frames = buildSpriteFramesFromList(frameList, rows, cols);
    if (!frames) return;

    item.spriteRows = rows;
    item.spriteCols = cols;
    item.spriteCol = item.spriteCol || 0;
    item.spriteFrames = frames;
    item.spriteSheetReady = true;

    if (item.pixiSprite && frames[0] && frames[0][0]) {
        item.pixiSprite.texture = frames[0][0];
    }
}

function ensureFireFrames() {
    if (fireFrames) return;
    const baseTexture = PIXI.Texture.from('./assets/images/fire.png').baseTexture;
    if (!baseTexture.valid) {
        baseTexture.once('loaded', () => {
            fireFrames = null;
            ensureFireFrames();
        });
        return;
    }
    const cols = 5;
    const rows = 5;
    const frameWidth = baseTexture.width / cols;
    const frameHeight = baseTexture.height / rows;
    fireFrames = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            fireFrames.push(
                new PIXI.Texture(
                    baseTexture,
                    new PIXI.Rectangle(col * frameWidth, row * frameHeight, frameWidth, frameHeight)
                )
            );
        }
    }
}

function applySpriteTransform(item) {
    const coors = worldToScreen(item);
    ensureSpriteFrames(item);
    if (item.spriteFrames && item.pixiSprite) {
        const rowIndex = typeof item.getDirectionRow === "function" ? item.getDirectionRow() : 0;
        const safeRow = Math.max(0, Math.min(rowIndex, (item.spriteRows || 1) - 1));
        const safeCol = Math.max(0, Math.min(item.spriteCol || 0, (item.spriteCols || 1) - 1));
        const rowFrames = item.spriteFrames[safeRow] || item.spriteFrames[0];
        const nextTexture = rowFrames && (rowFrames[safeCol] || rowFrames[0]);
        if (nextTexture) item.pixiSprite.texture = nextTexture;
    }
    item.pixiSprite.x = coors.x;
    item.pixiSprite.y = coors.y;
    // item.pixiSprite.anchor.set(0, 1);
    item.pixiSprite.width = (item.width || 1) * viewscale;
    // Pavement gets squashed by xyratio for isometric effect, but trees/animals/walls display at full height
    if (item.type === "road") {
        item.pixiSprite.width = (item.width || 1) * viewscale * 1.1547;
        item.pixiSprite.height = (item.height || 1) * viewscale * xyratio;
    } else {
        item.pixiSprite.height = (item.height || 1) * viewscale;
        item.pixiSprite.width = (item.width || 1) * viewscale;
    }
    item.pixiSprite.skew.x = 0;

    // Apply tree taper mesh deformation during fall
    if (item.type === "tree") {
        applyTreeTaperMesh(item, coors);
    }

    if (item.rotation) {
        item.pixiSprite.rotation = item.rotation * (Math.PI / 180);
    } else {
        item.pixiSprite.rotation = 0;
    }

}

function updateLandLayer() {
    if (!map || !landLayer) return;
    const camera = (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
        ? interpolatedViewport
        : viewport;
    if (!Number.isFinite(groundChunkLastViewscale) || Math.abs(groundChunkLastViewscale - viewscale) > 0.001) {
        clearGroundChunkCache();
        groundChunkLastViewscale = viewscale;
    }
    const xScale = 0.866;
    const rawXStart = Math.floor(camera.x / xScale) - groundChunkRenderPaddingTiles;
    const rawXEnd = Math.ceil((camera.x + viewport.width) / xScale) + groundChunkRenderPaddingTiles;
    const rawYStart = Math.floor(camera.y) - groundChunkRenderPaddingTiles;
    const rawYEnd = Math.ceil(camera.y + viewport.height) + groundChunkRenderPaddingTiles;
    const xRanges = getWrappedIndexRanges(rawXStart, rawXEnd, map.width, map.wrapX);
    const yRanges = getWrappedIndexRanges(rawYStart, rawYEnd, map.height, map.wrapY);
    if (xRanges.length === 0 || yRanges.length === 0) return;
    const chunkCountX = Math.ceil(map.width / groundChunkTileSize);
    const chunkCountY = Math.ceil(map.height / groundChunkTileSize);

    groundChunkCache.forEach(chunk => {
        if (chunk && chunk.sprite) chunk.sprite.visible = false;
    });

    const visibleChunkKeys = new Set();
    yRanges.forEach(yRange => {
        for (let y = yRange.start; y <= yRange.end; y++) {
            const chunkY = Math.floor(y / groundChunkTileSize);
            if (!Number.isFinite(chunkY) || chunkY < 0 || chunkY >= chunkCountY) continue;
            xRanges.forEach(xRange => {
                for (let x = xRange.start; x <= xRange.end; x++) {
                    const chunkX = Math.floor(x / groundChunkTileSize);
                    if (!Number.isFinite(chunkX) || chunkX < 0 || chunkX >= chunkCountX) continue;
                    visibleChunkKeys.add(getGroundChunkKey(chunkX, chunkY));
                }
            });
        }
    });

    visibleChunkKeys.forEach(chunkKey => {
        const parts = chunkKey.split(",");
        if (parts.length !== 2) return;
        const chunkX = Number(parts[0]);
        const chunkY = Number(parts[1]);
        if (!Number.isFinite(chunkX) || !Number.isFinite(chunkY)) return;
        const chunk = ensureGroundChunk(chunkX, chunkY);
        if (!chunk || !chunk.sprite) return;
        chunk.lastUsedFrame = frameCount;

        const dx = (map && typeof map.shortestDeltaX === "function")
            ? map.shortestDeltaX(camera.x, chunk.minWorldX)
            : (chunk.minWorldX - camera.x);
        const dy = (map && typeof map.shortestDeltaY === "function")
            ? map.shortestDeltaY(camera.y, chunk.minWorldY)
            : (chunk.minWorldY - camera.y);
        chunk.sprite.visible = true;
        chunk.sprite.x = dx * viewscale;
        chunk.sprite.y = dy * viewscale * xyratio;
    });

    if (groundChunkCache.size > groundChunkCacheMaxEntries) {
        const evictable = [];
        groundChunkCache.forEach((chunk, key) => {
            if (!visibleChunkKeys.has(key)) {
                evictable.push({
                    key,
                    chunk,
                    lastUsedFrame: Number.isFinite(chunk.lastUsedFrame) ? chunk.lastUsedFrame : -Infinity
                });
            }
        });
        evictable.sort((a, b) => a.lastUsedFrame - b.lastUsedFrame);
        for (let i = 0; i < evictable.length && groundChunkCache.size > groundChunkCacheMaxEntries; i++) {
            const entry = evictable[i];
            destroyGroundChunk(entry.chunk);
            groundChunkCache.delete(entry.key);
        }
    }
}

function forEachWrappedNodeInViewport(xPadding, yPadding, callback, cameraOverride = null) {
    if (!map || typeof callback !== "function") return;
    const camera = cameraOverride || (
        (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
            ? interpolatedViewport
            : viewport
    );
    const xScale = 0.866;
    const xStart = Math.floor(camera.x / xScale) - xPadding;
    const xEnd = Math.ceil((camera.x + viewport.width) / xScale) + xPadding;
    const yStart = Math.floor(camera.y) - yPadding;
    const yEnd = Math.ceil(camera.y + viewport.height) + yPadding;
    const xRanges = getWrappedIndexRanges(xStart, xEnd, map.width, map.wrapX);
    const yRanges = getWrappedIndexRanges(yStart, yEnd, map.height, map.wrapY);
    if (xRanges.length === 0 || yRanges.length === 0) return;

    yRanges.forEach(yRange => {
        for (let y = yRange.start; y <= yRange.end; y++) {
            xRanges.forEach(xRange => {
                for (let x = xRange.start; x <= xRange.end; x++) {
                    const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
                    if (node) callback(node);
                }
            });
        }
    });
}

function drawProjectiles() {
    remainingBalls = [];
    projectiles.forEach(ball => {
        if (!ball.visible) return;

        if (!ball.pixiSprite) {
            // Create sprite from actual texture
            const texture = PIXI.Texture.from(ball.image.src);
            ball.pixiSprite = new PIXI.Sprite(texture);
            ball.pixiSprite.anchor.set(0.5, 0.5);
            ball.pixiSprite._lastImageSrc = ball.image.src;
            projectileLayer.addChild(ball.pixiSprite);
        }

        // Handle fireball animation (animates while moving)
        if (ball.explosionFrames && ball.explosionFrames.length > 0) {
            ball.pixiSprite.texture = ball.explosionFrames[Math.floor(ball.explosionFrame) % ball.explosionFrames.length];
        }
        // Handle grenade explosion animation (animates when landed)
        else if (ball.isExploding && ball.explosionFrames) {
            ball.pixiSprite.texture = ball.explosionFrames[ball.explosionFrame];
        }
        // Update texture if image changed (for non-animated transitions)
        else if (ball.pixiSprite._lastImageSrc !== ball.image.src) {
            ball.pixiSprite.texture = PIXI.Texture.from(ball.image.src);
            ball.pixiSprite._lastImageSrc = ball.image.src;
        }

        // If landed, use fixed world position; otherwise follow projectile
        if (ball.landed) {
            const landedScreenCoors = worldToScreen({x: ball.landedWorldX, y: ball.landedWorldY});
            ball.pixiSprite.x = landedScreenCoors.x;
            ball.pixiSprite.y = landedScreenCoors.y;
        } else {
            const ballScreenCoors = worldToScreen(ball);
            ball.pixiSprite.x = ballScreenCoors.x;
            ball.pixiSprite.y = ballScreenCoors.y;
        }
        ball.pixiSprite.width = ball.apparentSize;
        ball.pixiSprite.height = ball.apparentSize;
        ball.pixiSprite.visible = true;

        remainingBalls.push(ball);
    });
    projectiles = remainingBalls;
}

function normalizeAngle(theta) {
    let a = theta;
    const twoPi = Math.PI * 2;
    while (a <= -Math.PI) a += twoPi;
    while (a > Math.PI) a -= twoPi;
    return a;
}

function angleInSpan(theta, a0, a1) {
    const t = normalizeAngle(theta);
    const s0 = normalizeAngle(a0);
    const s1 = normalizeAngle(a1);
    let span = normalizeAngle(s1 - s0);
    if (span < 0) span += Math.PI * 2;
    let rel = normalizeAngle(t - s0);
    if (rel < 0) rel += Math.PI * 2;
    return rel <= span;
}

function angleToBin(theta, bins) {
    const twoPi = Math.PI * 2;
    const norm = normalizeAngle(theta);
    const unit = (norm + Math.PI) / twoPi;
    const idx = Math.floor(unit * bins);
    if (idx < 0) return 0;
    if (idx >= bins) return bins - 1;
    return idx;
}

function forEachBinInShortSpan(a0, a1, bins, callback) {
    const twoPi = Math.PI * 2;
    const start = normalizeAngle(a0);
    const delta = normalizeAngle(a1 - a0); // shortest signed arc in [-pi, pi]
    const direction = delta >= 0 ? 1 : -1;
    const spanBins = Math.max(1, Math.ceil((Math.abs(delta) / twoPi) * bins));
    const startIdx = angleToBin(start, bins);
    let prevIdx = -1;
    for (let i = 0; i <= spanBins; i++) {
        const idx = (startIdx + (direction * i) + bins) % bins;
        if (idx === prevIdx) continue;
        prevIdx = idx;
        callback(idx);
    }
}

function cross2(ax, ay, bx, by) {
    return ax * by - ay * bx;
}

function raySegmentDistance(wx, wy, dirX, dirY, x1, y1, x2, y2) {
    const rx = dirX;
    const ry = dirY;
    const sx = x2 - x1;
    const sy = y2 - y1;
    const qpx = x1 - wx;
    const qpy = y1 - wy;
    const denom = cross2(rx, ry, sx, sy);
    if (Math.abs(denom) < 1e-8) return null;
    const t = cross2(qpx, qpy, sx, sy) / denom;
    const u = cross2(qpx, qpy, rx, ry) / denom;
    if (t >= 0 && u >= 0 && u <= 1) return t;
    return null;
}

function rayCircleDistance(wx, wy, dirX, dirY, cx, cy, r) {
    const ox = wx - cx;
    const oy = wy - cy;
    const b = 2 * (ox * dirX + oy * dirY);
    const c = ox * ox + oy * oy - r * r;
    const disc = b * b - 4 * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const t1 = (-b - s) / 2;
    const t2 = (-b + s) / 2;
    if (t1 >= 0) return t1;
    if (t2 >= 0) return t2;
    return null;
}

function computeLosDebugState(candidates) {
    if (!wizard || !Array.isArray(candidates)) {
        return { bins: 1000, minAngle: -Math.PI, owner: [], depth: [], boundaryBins: [], visibleObjects: [], elapsedMs: 0 };
    }
    const startMs = performance.now();
    const bins = 1000;
    const twoPi = Math.PI * 2;
    const minAngle = -Math.PI;
    const depth = new Float32Array(bins);
    const owner = new Array(bins).fill(null);
    for (let i = 0; i < bins; i++) depth[i] = Infinity;

    const wx = wizard.x;
    const wy = wizard.y;
    const angleForBin = idx => minAngle + ((idx + 0.5) / bins) * twoPi;

    const processHit = (obj, binIdx, hitDist) => {
        if (!Number.isFinite(hitDist) || hitDist < 0) return;
        if (hitDist < depth[binIdx]) {
            depth[binIdx] = hitDist;
            owner[binIdx] = obj;
        }
    };

    for (const obj of candidates) {
        if (!obj || obj.gone || obj.vanishing) continue;
        const hitbox = obj.groundPlaneHitbox;
        if (!hitbox) continue;

        if (hitbox instanceof CircleHitbox) {
            const cx = hitbox.x;
            const cy = hitbox.y;
            const r = hitbox.radius;
            if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || r <= 0) continue;
            const dx = cx - wx;
            const dy = cy - wy;
            const centerDist = Math.hypot(dx, dy);
            if (centerDist <= r + 1e-6) {
                for (let b = 0; b < bins; b++) processHit(obj, b, 0);
                continue;
            }
            const centerAngle = Math.atan2(dy, dx);
            const halfSpan = Math.asin(Math.min(1, r / centerDist));
            const a0 = centerAngle - halfSpan;
            const a1 = centerAngle + halfSpan;
            for (let b = 0; b < bins; b++) {
                const theta = angleForBin(b);
                if (!angleInSpan(theta, a0, a1)) continue;
                const dirX = Math.cos(theta);
                const dirY = Math.sin(theta);
                const t = rayCircleDistance(wx, wy, dirX, dirY, cx, cy, r);
                if (t !== null) processHit(obj, b, t);
            }
            continue;
        }

        if (hitbox instanceof PolygonHitbox && Array.isArray(hitbox.points) && hitbox.points.length >= 2) {
            const points = hitbox.points;
            for (let i = 0; i < points.length; i++) {
                const p1 = points[i];
                const p2 = points[(i + 1) % points.length];
                if (!p1 || !p2) continue;
                for (let b = 0; b < bins; b++) {
                    const theta = angleForBin(b);
                    const dirX = Math.cos(theta);
                    const dirY = Math.sin(theta);
                    const t = raySegmentDistance(wx, wy, dirX, dirY, p1.x, p1.y, p2.x, p2.y);
                    if (t !== null) processHit(obj, b, t);
                }
            }
        }
    }

    const boundaryBins = [];
    for (let i = 0; i < bins; i++) {
        const prev = owner[(i - 1 + bins) % bins];
        if (owner[i] !== prev) boundaryBins.push(i);
    }
    const visibleSet = new Set();
    for (let i = 0; i < bins; i++) {
        if (owner[i]) visibleSet.add(owner[i]);
    }
    return {
        bins,
        minAngle,
        owner,
        depth,
        boundaryBins,
        visibleObjects: Array.from(visibleSet),
        elapsedMs: performance.now() - startMs
    };
}

function drawLosDebug(redraw = true) {
    if (!debugMode || !wizard) {
        if (losDebugGraphics) losDebugGraphics.visible = false;
        losDebugState = null;
        return;
    }
    if (!redraw) return;
    if (!losDebugGraphics) {
        losDebugGraphics = new PIXI.Graphics();
        hitboxLayer.addChild(losDebugGraphics);
    }
    losDebugGraphics.visible = true;
    losDebugGraphics.clear();
    losDebugState = currentLosState;
    if (!losDebugState || !losDebugState.depth || !losDebugState.owner || losDebugState.owner.length < 3) return;
    if (!LOSSystem || typeof LOSSystem.buildPolygonWorldPoints !== "function") return;
    const farDist = Math.max(viewport.width, viewport.height) * 1.5;
    const worldPoints = LOSSystem.buildPolygonWorldPoints(wizard, losDebugState, farDist);
    const screenPoints = worldPoints.map(pt => worldToScreen(pt));
    if (screenPoints.length < 3) return;

    losDebugGraphics.lineStyle(2, 0x000000, 0.9);
    if (losDebugFillEnabled) {
        losDebugGraphics.beginFill(0x000000, 0.12);
    }
    losDebugGraphics.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (let i = 1; i < screenPoints.length; i++) {
        losDebugGraphics.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    losDebugGraphics.closePath();
    if (losDebugFillEnabled) {
        losDebugGraphics.endFill();
    }
}

function drawHexGrid(redraw = true) {
    if (!showHexGrid && !debugMode) {
        if (gridGraphics) gridGraphics.visible = false;
        return;
    }
    if (!redraw) return;

    if (!gridGraphics) {
        gridGraphics = new PIXI.Graphics();
        gridLayer.addChild(gridGraphics);
    }
    gridGraphics.visible = true;
    gridGraphics.clear();

    const hexWidth = map.hexWidth * viewscale;
    const hexHeight = map.hexHeight * viewscale * xyratio;
    const halfW = hexWidth / 2;
    const quarterW = hexWidth / 4;
    const halfH = hexHeight / 2;

    const xPadding = 2;
    const yPadding = 2;
    const xScale = 0.866;
    const rawXStart = Math.floor(viewport.x / xScale) - xPadding;
    const rawXEnd = Math.ceil((viewport.x + viewport.width) / xScale) + xPadding;
    const rawYStart = Math.floor(viewport.y) - yPadding;
    const rawYEnd = Math.ceil(viewport.y + viewport.height) + yPadding;
    const xRanges = getWrappedIndexRanges(rawXStart, rawXEnd, map.width, map.wrapX);
    const yRanges = getWrappedIndexRanges(rawYStart, rawYEnd, map.height, map.wrapY);
    if (xRanges.length === 0 || yRanges.length === 0) return;

    const animalTiles = new Set();
    animals.forEach(animal => {
        if (!animal || animal.gone || animal.dead) return;
        const node = map.worldToNode(animal.x, animal.y);
        if (!node) return;
        animalTiles.add(`${node.xindex},${node.yindex}`);
    });

    yRanges.forEach(yRange => {
        for (let y = yRange.start; y <= yRange.end; y++) {
            xRanges.forEach(xRange => {
                for (let x = xRange.start; x <= xRange.end; x++) {
                    if (!map.nodes[x] || !map.nodes[x][y]) continue;
                    const node = map.nodes[x][y];
                    const screenCoors = worldToScreen(node);
                    const centerX = screenCoors.x;
                    const centerY = screenCoors.y;

                    const isBlocked = node.hasBlockingObject() || !!node.blocked;
                    const hasAnimal = debugMode && animalTiles.has(`${x},${y}`);
                    const color = isBlocked ? 0xff0000 : 0xffffff;
                    const alpha = isBlocked ? 0.5 : 0.35;
                    if (hasAnimal) {
                        gridGraphics.beginFill(0x3399ff, 0.25);
                        gridGraphics.moveTo(centerX - halfW, centerY);
                        gridGraphics.lineTo(centerX - quarterW, centerY - halfH);
                        gridGraphics.lineTo(centerX + quarterW, centerY - halfH);
                        gridGraphics.lineTo(centerX + halfW, centerY);
                        gridGraphics.lineTo(centerX + quarterW, centerY + halfH);
                        gridGraphics.lineTo(centerX - quarterW, centerY + halfH);
                        gridGraphics.closePath();
                        gridGraphics.endFill();
                    }

                    gridGraphics.lineStyle(1, color, alpha);
                    gridGraphics.moveTo(centerX - halfW, centerY);
                    gridGraphics.lineTo(centerX - quarterW, centerY - halfH);
                    gridGraphics.lineTo(centerX + quarterW, centerY - halfH);
                    gridGraphics.lineTo(centerX + halfW, centerY);
                    gridGraphics.lineTo(centerX + quarterW, centerY + halfH);
                    gridGraphics.lineTo(centerX - quarterW, centerY + halfH);
                    gridGraphics.closePath();
                }
            });
        }
    });

    // Draw blocked neighbor connections with red perpendicular lines
    if (showBlockedNeighbors) {
        gridGraphics.lineStyle(4, 0xff0000, 0.4);
        const drawnEdges = new Set();
        yRanges.forEach(yRange => {
            for (let y = yRange.start; y <= yRange.end; y++) {
                xRanges.forEach(xRange => {
                    for (let x = xRange.start; x <= xRange.end; x++) {
                        if (!map.nodes[x] || !map.nodes[x][y]) continue;
                        const node = map.nodes[x][y];

                        if (!node.blockedNeighbors || node.blockedNeighbors.size === 0) continue;

                        // For each blocked neighbor direction
                        node.blockedNeighbors.forEach((blockingSet, direction) => {
                            if (blockingSet.size === 0) return;

                            const neighbor = node.neighbors[direction];
                            if (!neighbor) return;
                            const edgeKey = [
                                `${node.xindex},${node.yindex}`,
                                `${neighbor.xindex},${neighbor.yindex}`
                            ].sort().join("|");
                            if (drawnEdges.has(edgeKey)) return;
                            drawnEdges.add(edgeKey);

                    // Calculate midpoint between the two hexes in world space
                    const midX = (node.x + neighbor.x) / 2;
                    const midY = (node.y + neighbor.y) / 2;

                    // Calculate vector from node to neighbor
                    const dx = neighbor.x - node.x;
                    const dy = neighbor.y - node.y;
                    const len = Math.sqrt(dx * dx + dy * dy);

                    if (len === 0) return;

                    const tangentX = dx / len;
                    const tangentY = dy / len;

                    // Perpendicular vector (rotate 90 degrees)
                    const perpX = -dy / len;
                    const perpY = dx / len;

                    // Line length (in world units)
                    const lineLength = 0.4;
                    const offset = 0.05;
                    const ox = tangentX * offset;
                    const oy = tangentY * offset;

                    // Calculate endpoints of perpendicular line
                    const x1 = midX + ox + perpX * lineLength;
                    const y1 = midY + oy + perpY * lineLength;
                    const x2 = midX + ox - perpX * lineLength;
                    const y2 = midY + oy - perpY * lineLength;

                    // Convert to screen coordinates
                    const screen1 = worldToScreen({x: x1, y: y1});
                    const screen2 = worldToScreen({x: x2, y: y2});

                            // Draw the line
                            gridGraphics.moveTo(screen1.x, screen1.y);
                            gridGraphics.lineTo(screen2.x, screen2.y);
                        });
                    }
                });
            }
        });
    }
}

function drawGroundPlaneHitboxes(redraw = true) {
    if (!debugMode) {
        if (groundPlaneHitboxGraphics) groundPlaneHitboxGraphics.visible = false;
        return;
    }
    if (!redraw) return;

    if (!groundPlaneHitboxGraphics) {
        groundPlaneHitboxGraphics = new PIXI.Graphics();
        hitboxLayer.addChild(groundPlaneHitboxGraphics);
    }
    groundPlaneHitboxGraphics.visible = true;
    groundPlaneHitboxGraphics.clear();

    // Collect all objects with ground plane hitboxes
    const { topLeftNode, bottomRightNode } = getViewportNodeCorners();

    if (!topLeftNode || !bottomRightNode) return;

    const yStart = Math.max(topLeftNode.yindex - 2, 0);
    const yEnd = Math.min(bottomRightNode.yindex + 3, mapHeight - 1);
    const xStart = Math.max(topLeftNode.xindex - 2, 0);
    const xEnd = Math.min(bottomRightNode.xindex + 2, mapWidth - 1);

    const objectsWithGroundHitboxes = new Set();

    // Collect static objects
    for (let y = yStart; y <= yEnd; y++) {
        for (let x = xStart; x <= xEnd; x++) {
            if (!map.nodes[x] || !map.nodes[x][y]) continue;
            const node = map.nodes[x][y];
            if (node.objects && node.objects.length > 0) {
                node.objects.forEach(obj => {
                    if (obj.groundPlaneHitbox) {
                        objectsWithGroundHitboxes.add(obj);
                    }
                });
            }
        }
    }

    // Add wizard
    if (wizard && wizard.groundPlaneHitbox) {
        objectsWithGroundHitboxes.add(wizard);
    }

    // Add animals
    animals.forEach(animal => {
        if (animal && !animal.dead && animal._onScreen && animal.groundPlaneHitbox) {
            objectsWithGroundHitboxes.add(animal);
        }
    });

    // Draw ground plane hitboxes in black
    groundPlaneHitboxGraphics.lineStyle(2, 0x000000, 0.7);

    objectsWithGroundHitboxes.forEach(obj => {
        const hitbox = obj.groundPlaneHitbox;

        if (hitbox instanceof CircleHitbox) {
            // Draw as ellipse for ground plane circles (accounting for xyratio)
            const center = worldToScreen({x: hitbox.x, y: hitbox.y});
            const radiusX = hitbox.radius * viewscale;
            const radiusY = hitbox.radius * viewscale * xyratio;
            groundPlaneHitboxGraphics.drawEllipse(center.x, center.y, radiusX, radiusY);
        } else if (hitbox instanceof PolygonHitbox) {
            // Draw polygon using worldToScreen for vertices
            const screenPoints = hitbox.points.map(v => worldToScreen(v));
            if (screenPoints.length > 0) {
                groundPlaneHitboxGraphics.moveTo(screenPoints[0].x, screenPoints[0].y);
                for (let i = 1; i < screenPoints.length; i++) {
                    groundPlaneHitboxGraphics.lineTo(screenPoints[i].x, screenPoints[i].y);
                }
                groundPlaneHitboxGraphics.closePath();
            }
        }
    });
}

function drawHitboxes(redraw = true) {
    if (!debugMode) {
        if (hitboxGraphics) hitboxGraphics.visible = false;
        return;
    }
    if (!redraw) return;

    if (!hitboxGraphics) {
        hitboxGraphics = new PIXI.Graphics();
        hitboxLayer.addChild(hitboxGraphics);
    }
    hitboxGraphics.visible = true;
    hitboxGraphics.clear();

    // Projectile hitboxes
    projectiles.forEach(ball => {
        if (!ball.visible || !ball.radius) return;
        const ballCoors = worldToScreen(ball);
        const radiusPx = ball.radius * viewscale;
        hitboxGraphics.lineStyle(2, 0xffaa00, 0.9);
        hitboxGraphics.drawCircle(ballCoors.x, ballCoors.y, radiusPx);
    });

    // Animal hitboxes
    animals.forEach(animal => {
        if (!animal || animal.dead || !animal._onScreen) return;
        const animalCoors = worldToScreen(animal);
        const radiusPx = (animal.radius || 0.35) * viewscale;
        hitboxGraphics.lineStyle(2, 0x00ff66, 0.9);
        hitboxGraphics.drawCircle(animalCoors.x, animalCoors.y, radiusPx);
    });

    // Tree hitboxes (match occlusion/catching fire bounds)
    hitboxGraphics.lineStyle(2, 0x33cc33, 0.9);
    const { topLeftNode, bottomRightNode } = getViewportNodeCorners();

    if (topLeftNode && bottomRightNode) {
        const yStart = Math.max(topLeftNode.yindex - 2, 0);
        const yEnd = Math.min(bottomRightNode.yindex + 3, mapHeight - 1);
        const xStart = Math.max(topLeftNode.xindex - 2, 0);
        const xEnd = Math.min(bottomRightNode.xindex + 2, mapWidth - 1);

        // Draw polygon hitboxes for all onscreen objects that have them
        if (onscreenObjects.size > 0) {
            onscreenObjects.forEach((obj) => {
                if (!obj) return;
                const hitbox = obj.visualHitbox || obj.hitbox;
                if (!hitbox) return;

                if (hitbox instanceof PolygonHitbox) {
                    hitboxGraphics.lineStyle(2, 0x33cc33, 0.9);
                    const points = hitbox.points;
                    if (!points || points.length === 0) return;

                    // Convert world coordinates to screen coordinates
                    const screenPoints = points.map(p => (worldToScreen({x: p.x, y: p.y})));

                    // Draw polygon
                    const flatPoints = screenPoints.flatMap(p => [p.x, p.y]);
                    hitboxGraphics.drawPolygon(flatPoints);
                } else if (hitbox instanceof CircleHitbox) {
                    const center = worldToScreen({x: hitbox.x, y: hitbox.y});
                    const radiusPx = hitbox.radius * viewscale;
                    hitboxGraphics.lineStyle(2, 0x33cc33, 0.9);
                    hitboxGraphics.drawCircle(center.x, center.y, radiusPx);
                }
            });
        }
    }

    const drawDebugHitboxShape = (hitbox, color = 0xffffff, alpha = 0.95) => {
        if (!hitbox) return false;
        const isCircle = (
            hitbox.type === "circle" &&
            Number.isFinite(hitbox.x) &&
            Number.isFinite(hitbox.y) &&
            Number.isFinite(hitbox.radius)
        );
        if (isCircle) {
            const center = worldToScreen({x: hitbox.x, y: hitbox.y});
            hitboxGraphics.lineStyle(2, color, alpha);
            hitboxGraphics.drawCircle(center.x, center.y, hitbox.radius * viewscale);
            return true;
        }

        const points = Array.isArray(hitbox.points) ? hitbox.points : null;
        if (points && points.length > 1) {
            const flatPoints = points
                .map(p => worldToScreen({x: p.x, y: p.y}))
                .flatMap(p => [p.x, p.y]);
            hitboxGraphics.lineStyle(2, color, alpha);
            hitboxGraphics.drawPolygon(flatPoints);
            return true;
        }
        return false;
    };

    // Wizard hitboxes: draw explicitly in high-contrast colors so collisions
    // can be debugged even when ground-plane outlines are hard to see.
    if (wizard) {
        drawDebugHitboxShape(wizard.visualHitbox, 0x00ffff, 0.95);
        drawDebugHitboxShape(wizard.groundPlaneHitbox, 0xffffff, 0.95);

        // Always draw a center marker to verify debug layer visibility.
        if (Number.isFinite(wizard.x) && Number.isFinite(wizard.y)) {
            const center = worldToScreen({x: wizard.x, y: wizard.y});
            hitboxGraphics.lineStyle(2, 0xff00ff, 0.95);
            hitboxGraphics.moveTo(center.x - 8, center.y);
            hitboxGraphics.lineTo(center.x + 8, center.y);
            hitboxGraphics.moveTo(center.x, center.y - 8);
            hitboxGraphics.lineTo(center.x, center.y + 8);
        }
    }

    // Firewall emitter hitboxes: useful to diagnose contact/damage behavior.
    if (onscreenObjects && onscreenObjects.size > 0) {
        onscreenObjects.forEach(obj => {
            if (!obj || obj.type !== "firewall") return;
            const fireHitbox = obj.visualHitbox || obj.groundPlaneHitbox || obj.hitbox;
            drawDebugHitboxShape(fireHitbox, 0xff3300, 0.95);
        });
    }
}

function drawWizardBoundaries(redraw = true) {
    if (!debugMode || !wizard) {
        if (wizardBoundaryGraphics) wizardBoundaryGraphics.visible = false;
        return;
    }
    if (!redraw) return;

    if (!wizardBoundaryGraphics) {
        wizardBoundaryGraphics = new PIXI.Graphics();
        hitboxLayer.addChild(wizardBoundaryGraphics);
    }

    wizardBoundaryGraphics.visible = true;
    wizardBoundaryGraphics.clear();

    // Shade tiles the wizard is touching
    const touchingTiles = wizard.getTouchingTiles();
    if (touchingTiles && touchingTiles.size > 0) {
        const hexWidth = map.hexWidth * viewscale;
        const hexHeight = map.hexHeight * viewscale * xyratio;
        const halfW = hexWidth / 2;
        const quarterW = hexWidth / 4;
        const halfH = hexHeight / 2;

        wizardBoundaryGraphics.beginFill(0x000000, 0.25);
        touchingTiles.forEach(tileKey => {
            const [xindex, yindex] = tileKey.split(',').map(Number);
            const node = map.nodes[xindex] && map.nodes[xindex][yindex];
            if (!node) return;
            const screenCoors = worldToScreen(node);
            const centerX = screenCoors.x;
            const centerY = screenCoors.y;
            wizardBoundaryGraphics.moveTo(centerX - halfW, centerY);
            wizardBoundaryGraphics.lineTo(centerX - quarterW, centerY - halfH);
            wizardBoundaryGraphics.lineTo(centerX + quarterW, centerY - halfH);
            wizardBoundaryGraphics.lineTo(centerX + halfW, centerY);
            wizardBoundaryGraphics.lineTo(centerX + quarterW, centerY + halfH);
            wizardBoundaryGraphics.lineTo(centerX - quarterW, centerY + halfH);
            wizardBoundaryGraphics.closePath();
        });
        wizardBoundaryGraphics.endFill();
    }

    // Draw wizard hitbox circle
    // const wizardCoors = worldToScreen(wizard);
    // const wizardRadius = 0.45 * viewscale;
    // wizardBoundaryGraphics.lineStyle(2, 0xffffff, 0.9);
    // wizardBoundaryGraphics.drawCircle(wizardCoors.x, wizardCoors.y, wizardRadius);
}

function ensureUiArrowCursorElement() {
    if (uiArrowCursorElement || typeof document === "undefined" || !document.body) return uiArrowCursorElement;
    const el = document.createElement("img");
    el.id = "uiArrowCursorOverlay";
    el.src = "/assets/images/arrow.png";
    el.alt = "";
    el.style.position = "fixed";
    el.style.left = "0px";
    el.style.top = "0px";
    el.style.width = "40px";
    el.style.height = "50px";
    el.style.transform = "translate(-50%, 0)";
    el.style.transformOrigin = "50% 0%";
    el.style.pointerEvents = "none";
    el.style.zIndex = "200000";
    el.style.display = "none";
    document.body.appendChild(el);
    uiArrowCursorElement = el;
    return uiArrowCursorElement;
}

function setUiArrowCursorVisible(visible, clientX = null, clientY = null) {
    const el = ensureUiArrowCursorElement();
    if (!el) return;
    if (!visible) {
        el.style.display = "none";
        return;
    }
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    el.style.left = `${clientX}px`;
    el.style.top = `${clientY}px`;
    el.style.display = "block";
}

function getVirtualCursorClientPosition() {
    if (!app || !app.view) return { x: NaN, y: NaN };
    const rect = app.view.getBoundingClientRect();
    if (!Number.isFinite(mousePos.screenX) || !Number.isFinite(mousePos.screenY)) {
        return { x: NaN, y: NaN };
    }
    return {
        x: rect.left + mousePos.screenX,
        y: rect.top + mousePos.screenY
    };
}

function isCursorOverUiAtClientPoint(clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || typeof document === "undefined") return false;
    const perfReadoutEl = document.getElementById("perfReadout");
    if (perfReadoutEl && perfReadoutEl.style.display !== "none") {
        const rect = perfReadoutEl.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
            return true;
        }
    }
    const hovered = document.elementFromPoint(clientX, clientY);
    if (!hovered || typeof hovered.closest !== "function") return false;
    return !!hovered.closest("#spellMenu, #selectedSpell, #spellSelector, #auraMenu, #selectedAura, #auraSelector, #activeAuraIcons, #statusBars");
}

function updateCursor() {
    const virtualClient = getVirtualCursorClientPosition();
    const physicalClientX = Number.isFinite(mousePos.clientX) ? mousePos.clientX : NaN;
    const physicalClientY = Number.isFinite(mousePos.clientY) ? mousePos.clientY : NaN;
    const useVirtualPoint = !!pointerLockActive;
    const hoverClientX = useVirtualPoint ? virtualClient.x : (Number.isFinite(physicalClientX) ? physicalClientX : virtualClient.x);
    const hoverClientY = useVirtualPoint ? virtualClient.y : (Number.isFinite(physicalClientY) ? physicalClientY : virtualClient.y);
    const overMenuUi = isCursorOverUiAtClientPoint(hoverClientX, hoverClientY);
    if (overMenuUi) {
        if (cursorSprite) cursorSprite.visible = false;
        if (spellCursor) spellCursor.visible = false;
        setUiArrowCursorVisible(true, hoverClientX, hoverClientY);
        return;
    } else {
        setUiArrowCursorVisible(false);
    }

    if (!Number.isFinite(mousePos.screenX) || !Number.isFinite(mousePos.screenY) || !wizard) {
        return;
    }

    // Toggle cursor visibility based on spacebar state
    const spacePressed = keysPressed[' '] || false;

    if (cursorSprite) {
        cursorSprite.visible = false // !spacePressed;
    }
    if (spellCursor) {
        spellCursor.visible = true // spacePressed;
    }

    // Use whichever cursor is active
    const activeCursor = spellCursor; // spacePressed ? spellCursor : cursorSprite;
    if (!activeCursor) return;

    // Set cursor position to mouse position
    activeCursor.x = mousePos.screenX;
    activeCursor.y = mousePos.screenY;
    const placingObject = wizard && wizard.currentSpell === "placeobject";
    ensureSpellCursorShape(placingObject ? "placeobject" : "default");

    // Calculate wizard position in screen coordinates
    wizardScreenCoors = worldToScreen(wizard);
    const wizardScreenX = wizardScreenCoors.x;
    const wizardScreenY = wizardScreenCoors.y;

    // Calculate vector from mouse to wizard
    const dx = wizardScreenX - mousePos.screenX;
    const dy = wizardScreenY - mousePos.screenY;

    // Calculate rotation angle (atan2 returns angle from -PI to PI)
    // Add PI to point away from wizard, then add PI/2 for visual alignment
    if (placingObject) {
        activeCursor.rotation = 0;
    } else {
        const angle = Math.atan2(dy, dx) + Math.PI * 1.5;
        activeCursor.rotation = angle;
    }

    // Set size for sprite cursor
    if (!spacePressed && cursorSprite) {
        cursorSprite.width = 40;
        cursorSprite.height = 50;
    }
}

function distance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.hypot(dx, dy);
}

function withinRadius(x1, y1, x2, y2, radius) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy <= radius * radius;
}

function pointInPolygon(point, polygon) {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || 1e-7) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function updateRoofPreview(roof) {
    if (!roof) return;

    // Show/hide based on Q+R keys
    const qPressed = keysPressed['q'] || false;
    const rPressed = keysPressed['r'] || false;
    const hotkeysPressed = qPressed && rPressed;

    if (!roof.pixiMesh) {
        roof.createPixiMesh();
        // Render roof through objectLayer depth sorting instead of fixed roof layer order.
        if (roof.pixiMesh.parent) {
            roof.pixiMesh.parent.removeChild(roof.pixiMesh);
        }
    }

    // Place once per key chord press.
    const justPressed = hotkeysPressed && !roof._placementChordWasDown;
    roof._placementChordWasDown = hotkeysPressed;
    if (justPressed) {
        roof.x = wizard.x;
        roof.y = wizard.y;
        roof.placed = true;
        if (typeof roof.updateGroundPlaneHitbox === 'function') {
            roof.updateGroundPlaneHitbox();
        }
    }

    const wizardInsideRoof = !!(
        roof.placed &&
        roof.groundPlaneHitbox &&
        typeof roof.groundPlaneHitbox.containsPoint === 'function' &&
        roof.groundPlaneHitbox.containsPoint(wizard.x, wizard.y)
    );
    roof.pixiMesh.visible = !!roof.placed;

    const targetRoofAlpha = wizardInsideRoof ? 0.0 : 1.0;
    if (!Number.isFinite(roof.currentAlpha)) {
        roof.currentAlpha = targetRoofAlpha;
    }
    const fadeSpeed = 0.15;
    roof.currentAlpha += (targetRoofAlpha - roof.currentAlpha) * fadeSpeed;
    if (Math.abs(targetRoofAlpha - roof.currentAlpha) < 0.01) {
        roof.currentAlpha = targetRoofAlpha;
    }
    roof.pixiMesh.alpha = roof.currentAlpha;

    if (roof.placed) {
        const roofCoords = worldToScreen(roof);
        roof.pixiMesh.x = roofCoords.x;
        roof.pixiMesh.y = roofCoords.y;
        roof.pixiMesh.scale.set(viewscale, viewscale);
    }
}

function message(text) {
    messages.push(text);
    setTimeout(() => {
        messages.shift();
    }, 8000);
}
