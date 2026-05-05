(function attachRenderRuntime(global) {
    const viewportNodeSampleEpsilon = 1e-4;
    const CURSOR_NO_PATH_BLINK_TINT = 0xff3b30;
    const CURSOR_DEFAULT_TINT = 0xffffff;
    let uiArrowCursorElement = null;
    let uiGameCursorOverlayElement = null;
    let visibilityMaskEnabled = false;
    let visibilityMaskSources = [];
    let cursorNoPathBlinkTimeoutId = null;

    function normalizeLegacyAssetPath(path) {
        if (typeof path !== "string" || path.length === 0) return path;
        const raw = path.split("?")[0].split("#")[0];
        let mapped = raw;
        if (/^\/assets\/images\/flowers\/.*\.jpg$/i.test(mapped)) {
            mapped = mapped.replace(/\.jpg$/i, ".png");
        } else if (/^\/assets\/images\/windows\/.*\.jpg$/i.test(mapped)) {
            mapped = mapped.replace(/\.jpg$/i, ".png");
        }
        if (mapped === raw) return path;
        const suffix = path.slice(raw.length);
        return `${mapped}${suffix}`;
    }

    function worldToScreen(item) {
        const camera = viewport;
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
        const worldZ = (item && Number.isFinite(item.prevZ) && Number.isFinite(item.z))
            ? (item.prevZ + (item.z - item.prevZ) * alpha)
            : (item && Number.isFinite(item.z) ? item.z : 0);
        const cameraZ = Number.isFinite(camera && camera.z) ? Number(camera.z) : 0;
        const dx = (map && typeof map.shortestDeltaX === "function")
            ? map.shortestDeltaX(camera.x, worldX)
            : (worldX - camera.x);
        const dyBase = (map && typeof map.shortestDeltaY === "function")
            ? map.shortestDeltaY(camera.y, worldY)
            : (worldY - camera.y);
        const dy = dyBase - (worldZ - cameraZ);
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
        const sampleMaxX = viewport.x + Math.max(0, viewport.width - viewportNodeSampleEpsilon);
        const sampleMaxY = viewport.y + Math.max(0, viewport.height - viewportNodeSampleEpsilon);
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
        const camera = (typeof viewport !== "undefined") ? viewport : null;
        if (!camera) return { x: screenX, y: screenY };
        const vs = (typeof viewscale !== "undefined" && viewscale) ? viewscale : 1;
        const xyr = (typeof xyratio !== "undefined" && xyratio) ? xyratio : 1;
        const mapRef = (typeof map !== "undefined") ? map : null;
        const wizardRef = (typeof wizard !== "undefined") ? wizard : null;
        const triggerAreaDetached = !!(global && global.triggerAreaCameraDetachActive === true);
        let worldX = screenX / vs + camera.x;
        let worldY = screenY / (vs * xyr) + camera.y;
        if (mapRef && typeof mapRef.wrapWorldX === "function" && Number.isFinite(worldX)) {
            worldX = mapRef.wrapWorldX(worldX);
        }
        if (mapRef && typeof mapRef.wrapWorldY === "function" && Number.isFinite(worldY)) {
            worldY = mapRef.wrapWorldY(worldY);
        }
        if (
            !triggerAreaDetached &&
            wizardRef &&
            mapRef &&
            typeof mapRef.shortestDeltaX === "function" &&
            typeof mapRef.shortestDeltaY === "function" &&
            Number.isFinite(wizardRef.x) &&
            Number.isFinite(wizardRef.y) &&
            Number.isFinite(worldX) &&
            Number.isFinite(worldY)
        ) {
            worldX = wizardRef.x + mapRef.shortestDeltaX(wizardRef.x, worldX);
            worldY = wizardRef.y + mapRef.shortestDeltaY(wizardRef.y, worldY);
        }
        return { x: worldX, y: worldY };
    }

    function centerViewport(obj, margin, smoothing = null) {
        if (!obj || !viewport) return;
        if (global && global.triggerAreaCameraDetachActive === true) return;
        if (global && global.scriptedCameraPanState && global.scriptedCameraPanState.active) return;
        const minimapDetachState = (global && global.minimapCameraDetachState && typeof global.minimapCameraDetachState === "object")
            ? global.minimapCameraDetachState
            : null;
        if (minimapDetachState && minimapDetachState.active) {
            const isWizardTarget = !!(minimapDetachState.wizardRef && obj === minimapDetachState.wizardRef);
            if (isWizardTarget) {
                const lastWizardX = Number(minimapDetachState.wizardX);
                const lastWizardY = Number(minimapDetachState.wizardY);
                const movedX = Number.isFinite(lastWizardX)
                    ? ((map && typeof map.shortestDeltaX === "function")
                        ? map.shortestDeltaX(lastWizardX, obj.x)
                        : (obj.x - lastWizardX))
                    : 0;
                const movedY = Number.isFinite(lastWizardY)
                    ? ((map && typeof map.shortestDeltaY === "function")
                        ? map.shortestDeltaY(lastWizardY, obj.y)
                        : (obj.y - lastWizardY))
                    : 0;
                if (Math.abs(movedX) <= 1e-6 && Math.abs(movedY) <= 1e-6) {
                    return;
                }
            }
            global.minimapCameraDetachState = { active: false, wizardRef: null, wizardX: null, wizardY: null };
        }
        const centerX = viewport.x + viewport.width / 2;
        const centerY = viewport.y + viewport.height / 2;
        const objIndexX = obj.x;
        const objIndexY = obj.y;

        const facingAngle = (() => {
            const dir = wizard && wizard.direction ? wizard.direction : (obj.direction || null);
            if (dir && Number.isFinite(dir.x) && Number.isFinite(dir.y)) {
                const mag = Math.hypot(dir.x, dir.y);
                if (mag > 1e-7) return Math.atan2(dir.y, dir.x);
            }
            return 0;
        })();

        const leadRatio = (typeof cameraForwardLeadRatio === "number") ? cameraForwardLeadRatio : 0;
        const leadDistance = Math.min(viewport.width, viewport.height) * leadRatio;
        const leadX = Math.cos(facingAngle) * leadDistance;
        const leadY = Math.sin(facingAngle) * leadDistance;
        const focusX = objIndexX + leadX;
        const focusY = objIndexY + leadY;

        const leftBound = centerX - margin;
        const rightBound = centerX + margin;
        const topBound = centerY - margin;
        const bottomBound = centerY + margin;

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

        const desiredX = viewport.x + targetOffsetX;
        const desiredY = viewport.y + targetOffsetY;
        const defaultSmoothing = (typeof cameraFollowSmoothing === "number") ? cameraFollowSmoothing : 0;
        const requestedSmoothing = Number.isFinite(smoothing) ? smoothing : defaultSmoothing;
        const smoothFactor = Math.max(0, Math.min(1, requestedSmoothing));
        const factor = smoothFactor > 0 ? smoothFactor : 1;
        const deadband = 0.01;
        let nextX = viewport.x + (desiredX - viewport.x) * factor;
        let nextY = viewport.y + (desiredY - viewport.y) * factor;
        if (Math.abs(nextX - viewport.x) < deadband) nextX = viewport.x;
        if (Math.abs(nextY - viewport.y) < deadband) nextY = viewport.y;

        viewport.x = nextX;
        viewport.y = nextY;

        let seamShiftX = 0;
        let seamShiftY = 0;
        if (map && Number.isFinite(obj.x) && Number.isFinite(obj.y)) {
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
            }
        }

        // Keep full-precision camera state to avoid micro-stutter at high present FPS.
    }

    function screenToHex(screenX, screenY) {
        const worldCoors = screenToWorld(screenX, screenY);
        const worldX = worldCoors.x;
        const worldY = worldCoors.y;

        const approxCol = Math.round(worldX);
        const approxRow = Math.round(worldY - (approxCol % 2 === 0 ? 0.5 : 0));

        let best = { x: approxCol, y: approxRow };
        let bestDist = Infinity;
        const maxX = (map && Number.isFinite(map.width)) ? map.width : (typeof mapWidth !== "undefined" ? mapWidth : 0);
        const maxY = (map && Number.isFinite(map.height)) ? map.height : (typeof mapHeight !== "undefined" ? mapHeight : 0);

        for (let cx = approxCol - 1; cx <= approxCol + 1; cx++) {
            for (let cy = approxRow - 1; cy <= approxRow + 1; cy++) {
                if (cx < 0 || cy < 0 || cx >= maxX || cy >= maxY) continue;
                const worldCenter = { x: cx, y: cy + (cx % 2 === 0 ? 0.5 : 0) };
                const screenCenter = worldToScreen(worldCenter);
                const dx = screenCenter.x - screenX;
                const dy = screenCenter.y - screenY;
                const dist = dx * dx + dy * dy;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = { x: cx, y: cy };
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
                if (frameList.length < rows * cols && Array.isArray(texGroup.list)) {
                    const fallbackFrames = texGroup.list.filter(Boolean);
                    if (fallbackFrames.length >= rows * cols) {
                        frameList = fallbackFrames;
                    }
                }
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

    function makeTileKey(x, y) {
        return `${x},${y}`;
    }

    function resolveAnimalTileFromWorld(worldX, worldY, mapRef) {
        if (!mapRef || !mapRef.nodes) return null;
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const wrappedX = (typeof mapRef.wrapWorldX === "function") ? mapRef.wrapWorldX(worldX) : worldX;
        const wrappedY = (typeof mapRef.wrapWorldY === "function") ? mapRef.wrapWorldY(worldY) : worldY;
        const approxX = Math.round(wrappedX / 0.866);
        const clampedX = Math.max(0, Math.min(mapRef.width - 1, approxX));
        const approxY = Math.round(wrappedY - (clampedX % 2 === 0 ? 0.5 : 0));
        const clampedY = Math.max(0, Math.min(mapRef.height - 1, approxY));
        return { x: clampedX, y: clampedY };
    }

    const animalVisibilityState = {
        map: null,
        viewport: null,
        animalsRef: null,
        knownAnimals: new Set(),
        tileToAnimals: new Map(),
        activeAnimals: new Set(),
        inactiveAnimals: new Set(),
        activationTileKeys: new Set(),
        retentionTileKeys: new Set(),
        activeListCache: [],
        inactiveListCache: [],
        cacheDirty: true
    };

    function markAnimalVisibilityCachesDirty() {
        animalVisibilityState.cacheDirty = true;
    }

    function rebuildAnimalVisibilityCachesIfNeeded() {
        if (!animalVisibilityState.cacheDirty) return;
        animalVisibilityState.activeListCache = Array.from(animalVisibilityState.activeAnimals);
        animalVisibilityState.inactiveListCache = Array.from(animalVisibilityState.inactiveAnimals);
        animalVisibilityState.cacheDirty = false;
    }

    function addAnimalToTileIndex(animal, tileKey) {
        if (!animal || typeof tileKey !== "string") return;
        let bucket = animalVisibilityState.tileToAnimals.get(tileKey);
        if (!bucket) {
            bucket = new Set();
            animalVisibilityState.tileToAnimals.set(tileKey, bucket);
        }
        bucket.add(animal);
        animal._visibilityTileKey = tileKey;
    }

    function removeAnimalFromTileIndex(animal, tileKey) {
        if (!animal || typeof tileKey !== "string") return;
        const bucket = animalVisibilityState.tileToAnimals.get(tileKey);
        if (!bucket) return;
        bucket.delete(animal);
        if (bucket.size === 0) {
            animalVisibilityState.tileToAnimals.delete(tileKey);
        }
    }

    function unregisterAnimalFromVisibility(animal) {
        if (!animal) return;
        removeAnimalFromTileIndex(animal, animal._visibilityTileKey);
        animal._visibilityTileKey = null;
        animalVisibilityState.knownAnimals.delete(animal);
        animalVisibilityState.activeAnimals.delete(animal);
        animalVisibilityState.inactiveAnimals.delete(animal);
        markAnimalVisibilityCachesDirty();
    }

    function updateAnimalTileIndex(animal, mapRef) {
        if (!animal || !mapRef) return;
        const tile = resolveAnimalTileFromWorld(animal.x, animal.y, mapRef);
        if (!tile) return;
        const key = makeTileKey(tile.x, tile.y);
        if (animal._visibilityTileKey === key) return;
        removeAnimalFromTileIndex(animal, animal._visibilityTileKey);
        addAnimalToTileIndex(animal, key);
    }

    function ensureAnimalTracked(animal, mapRef) {
        if (!animal || animal.gone) return;
        if (animalVisibilityState.knownAnimals.has(animal)) return;
        animalVisibilityState.knownAnimals.add(animal);
        updateAnimalTileIndex(animal, mapRef);
        // If the animal's tile is already in the activation zone, start it active
        const tileKey = animal._visibilityTileKey;
        if (tileKey && animalVisibilityState.activationTileKeys.has(tileKey)) {
            animalVisibilityState.activeAnimals.add(animal);
        } else {
            animalVisibilityState.inactiveAnimals.add(animal);
        }
        markAnimalVisibilityCachesDirty();
    }

    function syncAnimalActivationForCurrentTile(animal) {
        if (!animal || animal.gone) return;
        const tileKey = animal._visibilityTileKey;
        if (!tileKey) return;

        if (animalVisibilityState.activationTileKeys.has(tileKey)) {
            if (!animalVisibilityState.activeAnimals.has(animal)) {
                animalVisibilityState.activeAnimals.add(animal);
                animalVisibilityState.inactiveAnimals.delete(animal);
                markAnimalVisibilityCachesDirty();
            }
            return;
        }

        if (!animalVisibilityState.retentionTileKeys.has(tileKey) && animalVisibilityState.activeAnimals.has(animal)) {
            animalVisibilityState.activeAnimals.delete(animal);
            animalVisibilityState.inactiveAnimals.add(animal);
            markAnimalVisibilityCachesDirty();
        }
    }

    function buildVisibleTileKeySet(mapRef, viewportRef, paddingTiles = 0) {
        const out = new Set();
        if (!mapRef || !viewportRef) return out;
        const xPadding = Math.max(0, Math.floor(Number(paddingTiles) || 0));
        const yPadding = Math.max(0, Math.floor(Number(paddingTiles) || 0));
        const xScale = 0.866;
        const xStart = Math.floor((Number(viewportRef.x) || 0) / xScale) - xPadding;
        const xEnd = Math.ceil(((Number(viewportRef.x) || 0) + (Number(viewportRef.width) || 0)) / xScale) + xPadding;
        const yStart = Math.floor(Number(viewportRef.y) || 0) - yPadding;
        const yEnd = Math.ceil((Number(viewportRef.y) || 0) + (Number(viewportRef.height) || 0)) + yPadding;
        const xRanges = getWrappedIndexRanges(xStart, xEnd, mapRef.width, mapRef.wrapX);
        const yRanges = getWrappedIndexRanges(yStart, yEnd, mapRef.height, mapRef.wrapY);
        for (let yr = 0; yr < yRanges.length; yr++) {
            const yRange = yRanges[yr];
            for (let xr = 0; xr < xRanges.length; xr++) {
                const xRange = xRanges[xr];
                for (let y = yRange.start; y <= yRange.end; y++) {
                    for (let x = xRange.start; x <= xRange.end; x++) {
                        out.add(makeTileKey(x, y));
                    }
                }
            }
        }
        return out;
    }

    function activateAnimalsOnTiles(tileKeys) {
        if (!tileKeys || tileKeys.size === 0) return;
        tileKeys.forEach(key => {
            const bucket = animalVisibilityState.tileToAnimals.get(key);
            if (!bucket || bucket.size === 0) return;
            bucket.forEach(animal => {
                if (!animal || animal.gone) return;
                if (!animalVisibilityState.activeAnimals.has(animal)) {
                    animalVisibilityState.activeAnimals.add(animal);
                    animalVisibilityState.inactiveAnimals.delete(animal);
                    markAnimalVisibilityCachesDirty();
                }
            });
        });
    }

    function sweepAnimalsOutsideRetention() {
        let changed = false;
        animalVisibilityState.activeAnimals.forEach(animal => {
            if (!animal || animal.gone) {
                animalVisibilityState.activeAnimals.delete(animal);
                animalVisibilityState.inactiveAnimals.delete(animal);
                changed = true;
                return;
            }
            const key = animal._visibilityTileKey;
            if (!key || !animalVisibilityState.retentionTileKeys.has(key)) {
                animalVisibilityState.activeAnimals.delete(animal);
                animalVisibilityState.inactiveAnimals.add(animal);
                changed = true;
            }
        });
        if (changed) markAnimalVisibilityCachesDirty();
    }

    function syncAnimalVisibility({
        animals: animalsInput = null,
        map: mapInput = null,
        viewport: viewportInput = null,
        activationPaddingTiles = 4,
        retentionExtraTiles = 2
    } = {}) {
        const mapRef = mapInput || animalVisibilityState.map || (typeof map !== "undefined" ? map : null);
        const viewportRef = viewportInput || animalVisibilityState.viewport || (typeof viewport !== "undefined" ? viewport : null);
        const animalsRef = Array.isArray(animalsInput)
            ? animalsInput
            : (Array.isArray(animalVisibilityState.animalsRef)
                ? animalVisibilityState.animalsRef
                : (Array.isArray(global.animals) ? global.animals : []));
        if (!mapRef || !viewportRef || !Array.isArray(animalsRef)) {
            return { active: [], inactive: [] };
        }

        animalVisibilityState.map = mapRef;
        animalVisibilityState.viewport = viewportRef;
        animalVisibilityState.animalsRef = animalsRef;

        const seenThisSync = new Set();
        for (let i = 0; i < animalsRef.length; i++) {
            const animal = animalsRef[i];
            if (!animal || animal.gone) continue;
            seenThisSync.add(animal);
            ensureAnimalTracked(animal, mapRef);
            updateAnimalTileIndex(animal, mapRef);
            syncAnimalActivationForCurrentTile(animal);
        }

        animalVisibilityState.knownAnimals.forEach(animal => {
            if (!seenThisSync.has(animal) || !animal || animal.gone) {
                unregisterAnimalFromVisibility(animal);
            }
        });

        const activationSet = buildVisibleTileKeySet(mapRef, viewportRef, activationPaddingTiles);
        const retentionSet = buildVisibleTileKeySet(
            mapRef,
            viewportRef,
            Math.max(activationPaddingTiles, activationPaddingTiles + Math.max(0, Number(retentionExtraTiles) || 0))
        );

        const enteredActivation = new Set();
        activationSet.forEach(key => {
            if (!animalVisibilityState.activationTileKeys.has(key)) {
                enteredActivation.add(key);
            }
        });

        animalVisibilityState.activationTileKeys = activationSet;
        animalVisibilityState.retentionTileKeys = retentionSet;
        activateAnimalsOnTiles(enteredActivation);
        if (animalVisibilityState.activeAnimals.size === 0) {
            activateAnimalsOnTiles(activationSet);
        }
        sweepAnimalsOutsideRetention();

        rebuildAnimalVisibilityCachesIfNeeded();

        return {
            active: animalVisibilityState.activeListCache,
            inactive: animalVisibilityState.inactiveListCache
        };
    }

    function noteAnimalMoved(animal, mapRef = null) {
        if (!animal || animal.gone) return;
        const effectiveMap = mapRef || animalVisibilityState.map || (typeof map !== "undefined" ? map : null);
        if (!effectiveMap) return;
        ensureAnimalTracked(animal, effectiveMap);
        updateAnimalTileIndex(animal, effectiveMap);
        syncAnimalActivationForCurrentTile(animal);
    }

    function getActiveAnimals() {
        rebuildAnimalVisibilityCachesIfNeeded();
        return animalVisibilityState.activeListCache;
    }

    function getInactiveAnimals() {
        rebuildAnimalVisibilityCachesIfNeeded();
        return animalVisibilityState.inactiveListCache;
    }

    const renderRuntimeApi = {
        syncAnimalVisibility,
        noteAnimalMoved,
        getActiveAnimals,
        getInactiveAnimals
    };

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

    function ensureUiGameCursorOverlayElement() {
        if (uiGameCursorOverlayElement || typeof document === "undefined" || !document.body) return uiGameCursorOverlayElement;
        const el = document.createElement("img");
        el.id = "uiGameCursorOverlay";
        el.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='-24 -24 48 48'%3E%3Cg stroke='%2344aaff' stroke-width='2' fill='none' stroke-linejoin='round' stroke-linecap='round'%3E%3Cpath d='M 20 0 L 8.090169943749475 5.877852522924732 L 6.180339887498949 19.02113032590307 L -3.0901699437494736 9.510565162951536 L -16.180339887498945 11.755705045849465 L -10 0.0000000000000012246467991473533 L -16.180339887498953 -11.75570504584946 L -3.0901699437494754 -9.510565162951535 L 6.180339887498945 -19.021130325903073 L 8.090169943749473 -5.877852522924734 Z'/%3E%3C/g%3E%3C/svg%3E";
        el.alt = "";
        el.style.position = "fixed";
        el.style.left = "0px";
        el.style.top = "0px";
        el.style.width = "40px";
        el.style.height = "40px";
        el.style.transform = "translate(-50%, -50%)";
        el.style.transformOrigin = "50% 50%";
        el.style.pointerEvents = "none";
        el.style.zIndex = "200001";
        el.style.display = "none";
        document.body.appendChild(el);
        uiGameCursorOverlayElement = el;
        return uiGameCursorOverlayElement;
    }

    function setUiGameCursorOverlayVisible(visible, clientX = null, clientY = null, rotationRadians = 0) {
        const el = ensureUiGameCursorOverlayElement();
        if (!el) return;
        if (!visible) {
            el.style.display = "none";
            return;
        }
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
        el.style.left = `${clientX}px`;
        el.style.top = `${clientY}px`;
        const deg = Number.isFinite(rotationRadians) ? (rotationRadians * 180 / Math.PI) : 0;
        el.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
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
        return !!hovered.closest("#spellMenu, #selectedSpell, #spellSelector, #inventorySelector, #selectedInventory, #auraMenu, #selectedAura, #auraSelector, #activeAuraIcons, #statusBars, #msgbox, #optionsMenu");
    }

    function isCursorOverMinimapAtClientPoint(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || typeof document === "undefined") return false;
        const minimapWrapperEl = document.getElementById("minimap-wrapper");
        if (!minimapWrapperEl || minimapWrapperEl.style.display === "none") return false;
        const rect = minimapWrapperEl.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }

    function updateCursor() {
        const virtualClient = getVirtualCursorClientPosition();
        const physicalClientX = Number.isFinite(mousePos.clientX) ? mousePos.clientX : NaN;
        const physicalClientY = Number.isFinite(mousePos.clientY) ? mousePos.clientY : NaN;
        const useVirtualPoint = !!pointerLockActive;
        const hoverClientX = useVirtualPoint ? virtualClient.x : (Number.isFinite(physicalClientX) ? physicalClientX : virtualClient.x);
        const hoverClientY = useVirtualPoint ? virtualClient.y : (Number.isFinite(physicalClientY) ? physicalClientY : virtualClient.y);
        const overMenuUi = isCursorOverUiAtClientPoint(hoverClientX, hoverClientY);
        const overMinimap = isCursorOverMinimapAtClientPoint(hoverClientX, hoverClientY);
        if (overMenuUi) {
            if (cursorSprite) cursorSprite.visible = false;
            if (spellCursor) spellCursor.visible = false;
            if (spellCursorGlow) spellCursorGlow.visible = false;
            setUiGameCursorOverlayVisible(false);
            setUiArrowCursorVisible(true, hoverClientX, hoverClientY);
            return;
        }
        setUiArrowCursorVisible(false);

        if (!Number.isFinite(mousePos.screenX) || !Number.isFinite(mousePos.screenY) || !wizard) {
            if (spellCursorGlow) spellCursorGlow.visible = false;
            setUiGameCursorOverlayVisible(false);
            return;
        }

        const activeCursor = spellCursor || cursorSprite;
        if (!activeCursor) {
            if (spellCursorGlow) spellCursorGlow.visible = false;
            setUiGameCursorOverlayVisible(false);
            return;
        }
        if (cursorSprite) cursorSprite.visible = false;
        if (spellCursor) spellCursor.visible = true;

        activeCursor.x = mousePos.screenX;
        activeCursor.y = mousePos.screenY;

        let rotation = 0;

        const placingObject = wizard && wizard.currentSpell === "placeobject";
        if (placingObject) {
            rotation = 0;
            activeCursor.rotation = rotation;
            if (spellCursorGlow) {
                const spaceHeld = !!(typeof keysPressed !== "undefined" && keysPressed[" "]);
                spellCursorGlow.visible = spaceHeld && activeCursor.visible;
                spellCursorGlow.x = activeCursor.x;
                spellCursorGlow.y = activeCursor.y;
                spellCursorGlow.rotation = rotation;
            }
            setUiGameCursorOverlayVisible(overMinimap, hoverClientX, hoverClientY, rotation);
            return;
        }

        const wizardScreenCoors = worldToScreen(wizard);
        const dx = wizardScreenCoors.x - mousePos.screenX;
        const dy = wizardScreenCoors.y - mousePos.screenY;
        rotation = Math.atan2(dy, dx) + Math.PI * 1.5;
        activeCursor.rotation = rotation;

        // Sync glow to cursor position/rotation; show only when spacebar held
        if (spellCursorGlow) {
            const spaceHeld = !!(typeof keysPressed !== "undefined" && keysPressed[" "]);
            spellCursorGlow.visible = spaceHeld && activeCursor.visible;
            spellCursorGlow.x = activeCursor.x;
            spellCursorGlow.y = activeCursor.y;
            spellCursorGlow.rotation = rotation;
        }

        setUiGameCursorOverlayVisible(overMinimap, hoverClientX, hoverClientY, rotation);
    }

    function blinkCursorNoPath(durationMs = 500) {
        const blinkDurationMs = Math.max(1, Math.floor(Number(durationMs) || 500));

        if (cursorNoPathBlinkTimeoutId) {
            clearTimeout(cursorNoPathBlinkTimeoutId);
            cursorNoPathBlinkTimeoutId = null;
        }

        if (cursorSprite && Number.isFinite(cursorSprite.tint)) {
            cursorSprite.tint = CURSOR_NO_PATH_BLINK_TINT;
        }
        if (spellCursor && Number.isFinite(spellCursor.tint)) {
            spellCursor.tint = CURSOR_NO_PATH_BLINK_TINT;
        }

        cursorNoPathBlinkTimeoutId = setTimeout(() => {
            if (cursorSprite && Number.isFinite(cursorSprite.tint)) {
                cursorSprite.tint = CURSOR_DEFAULT_TINT;
            }
            if (spellCursor && Number.isFinite(spellCursor.tint)) {
                spellCursor.tint = CURSOR_DEFAULT_TINT;
            }
            cursorNoPathBlinkTimeoutId = null;
        }, blinkDurationMs);
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

    function message(text) {
        if (!Array.isArray(messages)) return;
        messages.push(text);
        setTimeout(() => {
            messages.shift();
        }, 8000);
    }

    function setVisibilityMaskEnabled(enabled) {
        visibilityMaskEnabled = !!enabled;
        return visibilityMaskEnabled;
    }

    function setVisibilityMaskSources(sources) {
        visibilityMaskSources = Array.isArray(sources) ? sources.slice() : [];
        return visibilityMaskSources.length;
    }

    global.normalizeLegacyAssetPath = normalizeLegacyAssetPath;
    global.worldToScreen = worldToScreen;
    global.getViewportNodeCorners = getViewportNodeCorners;
    global.getWrappedIndexRanges = getWrappedIndexRanges;
    global.screenToWorld = screenToWorld;
    global.centerViewport = centerViewport;
    global.screenToHex = screenToHex;
    global.ensureSpriteFrames = ensureSpriteFrames;
    global.updateCursor = updateCursor;
    global.distance = distance;
    global.withinRadius = withinRadius;
    global.message = message;
    global.blinkCursorNoPath = blinkCursorNoPath;
    global.setVisibilityMaskEnabled = setVisibilityMaskEnabled;
    global.setVisibilityMaskSources = setVisibilityMaskSources;
    global.RenderRuntime = renderRuntimeApi;
})(typeof globalThis !== "undefined" ? globalThis : window);
