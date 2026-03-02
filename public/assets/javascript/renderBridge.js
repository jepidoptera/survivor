(function attachRenderBridge(global) {
    const viewportNodeSampleEpsilon = 1e-4;
    let uiArrowCursorElement = null;
    let uiGameCursorOverlayElement = null;
    let visibilityMaskEnabled = false;
    let visibilityMaskSources = [];

    function isPlacedObjectEntity(item) {
        return !!(
            item &&
            (item.isPlacedObject || item.objectType === "placedObject" || item.type === "placedObject")
        );
    }

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

    function isWallMountedPlaceable(item) {
        if (!item) return false;
        const explicitType = (typeof item.type === "string") ? item.type.trim().toLowerCase() : "";
        const isExplicitWindowDoorType = explicitType === "window" || explicitType === "door";
        const isPlacedOrPreview = isPlacedObjectEntity(item) || item.type === "placedObjectPreview" || isExplicitWindowDoorType;
        if (!isPlacedOrPreview) return false;
        const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
        if (category === "windows" || category === "doors") return true;
        return isExplicitWindowDoorType;
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
        if (!obj || !viewport) return;
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

        viewport.x = Math.round(viewport.x * 1000) / 1000;
        viewport.y = Math.round(viewport.y * 1000) / 1000;
    }

    function forEachWrappedNodeInViewport(xPadding, yPadding, callback, cameraOverride = null) {
        if (!map || typeof callback !== "function") return;
        const camera = cameraOverride || (
            (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
                ? interpolatedViewport
                : viewport
        );
        const cameraWidth = Number.isFinite(camera.width) ? camera.width : viewport.width;
        const cameraHeight = Number.isFinite(camera.height) ? camera.height : viewport.height;
        const xScale = 0.866;
        const xStart = Math.floor(camera.x / xScale) - xPadding;
        const xEnd = Math.ceil((camera.x + cameraWidth) / xScale) + xPadding;
        const yStart = Math.floor(camera.y) - yPadding;
        const yEnd = Math.ceil(camera.y + cameraHeight) + yPadding;
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

    function updatePhantomWall() {
        // Rendering owns wall preview rendering.
    }

    function updatePhantomFirewall() {
        // Rendering owns firewall preview rendering.
    }

    function updatePhantomRoad() {
        // Rendering owns road preview rendering.
    }

    function updateLandLayer() {
        // Ground is rendered by Rendering.
    }

    function resolvePlacedObjectLodTexturePath(item) {
        if (!item || !isPlacedObjectEntity(item)) return null;
        const basePath = (typeof item.texturePath === "string" && item.texturePath.length > 0)
            ? item.texturePath
            : null;
        const lodList = Array.isArray(item.lodTextures) ? item.lodTextures : null;
        if (!lodList || lodList.length === 0) return basePath;
        const itemWidthWorld = Math.max(0.01, Number.isFinite(item.width) ? Number(item.width) : 1);
        const itemHeightWorld = Math.max(0.01, Number.isFinite(item.height) ? Number(item.height) : 1);
        const rotationAxis = (typeof item.rotationAxis === "string") ? item.rotationAxis : "visual";
        const yIsoScale = Math.max(0.0001, Math.abs(Number.isFinite(xyratio) ? xyratio : 0.66));
        const screenWidthPx = itemWidthWorld * viewscale;
        const screenHeightPx = (rotationAxis === "spatial")
            ? (itemHeightWorld * viewscale)
            : (itemHeightWorld * viewscale * yIsoScale);
        const sizeMetric = Math.max(screenWidthPx, screenHeightPx);

        for (let i = 0; i < lodList.length; i++) {
            const entry = lodList[i];
            if (!entry || typeof entry.texturePath !== "string" || entry.texturePath.length === 0) continue;
            const maxSize = Number.isFinite(entry.maxDistance) ? Number(entry.maxDistance) : Infinity;
            if (sizeMetric <= maxSize) return entry.texturePath;
        }
        return basePath || (lodList[lodList.length - 1] && lodList[lodList.length - 1].texturePath) || null;
    }

    function applySpriteTransform(item) {
        if (!item || !item.pixiSprite) return;
        const interpolatedWorld = (typeof item.getInterpolatedPosition === "function")
            ? item.getInterpolatedPosition()
            : null;
        const drawTarget = (
            interpolatedWorld &&
            Number.isFinite(interpolatedWorld.x) &&
            Number.isFinite(interpolatedWorld.y)
        ) ? interpolatedWorld : item;
        const coors = worldToScreen(drawTarget);
        item.pixiSprite.x = coors.x;
        item.pixiSprite.y = coors.y;

        // Resolve sprite sheet frames and pick the correct animation frame
        ensureSpriteFrames(item);
        if (item.spriteFrames && item.pixiSprite) {
            const rowIndex = typeof item.getDirectionRow === "function" ? item.getDirectionRow() : 0;
            const safeRow = Math.max(0, Math.min(rowIndex, (item.spriteRows || 1) - 1));
            const safeCol = Math.max(0, Math.min(item.spriteCol || 0, (item.spriteCols || 1) - 1));
            const rowFrames = item.spriteFrames[safeRow] || item.spriteFrames[0];
            const nextTexture = rowFrames && (rowFrames[safeCol] || rowFrames[0]);
            if (nextTexture) item.pixiSprite.texture = nextTexture;
        }

        const spriteTexture = item.pixiSprite.texture || null;
        const nativeTexW = spriteTexture && Number.isFinite(spriteTexture.width) ? Number(spriteTexture.width) : null;
        const nativeTexH = spriteTexture && Number.isFinite(spriteTexture.height) ? Number(spriteTexture.height) : null;
        const useNativeLodSize = !!(
            typeof debugUseLodNativePixelSize !== "undefined" &&
            debugUseLodNativePixelSize &&
            isPlacedObjectEntity(item) &&
            item.rotationAxis !== "spatial" &&
            Number.isFinite(nativeTexW) &&
            Number.isFinite(nativeTexH)
        );

        if (item && isPlacedObjectEntity(item) && item.rotationAxis !== "spatial" && item.pixiSprite instanceof PIXI.Sprite) {
            const lodTexturePath = resolvePlacedObjectLodTexturePath(item);
            if (typeof lodTexturePath === "string" && lodTexturePath.length > 0 && lodTexturePath !== item._activeLodTexturePath) {
                item.pixiSprite.texture = PIXI.Texture.from(lodTexturePath);
                item._activeLodTexturePath = lodTexturePath;
            }
        }

        if (item.type === "road") {
            item.pixiSprite.width = (item.width || 1) * viewscale * 1.1547;
            item.pixiSprite.height = (item.height || 1) * viewscale * xyratio;
        } else if (useNativeLodSize) {
            item.pixiSprite.width = nativeTexW;
            item.pixiSprite.height = nativeTexH;
        } else {
            item.pixiSprite.width = (item.width || 1) * viewscale;
            item.pixiSprite.height = (item.height || 1) * viewscale;
        }

        const visualRotation = (item && item.rotationAxis === "none")
            ? 0
            : Number.isFinite(item.placementRotation)
                ? item.placementRotation
                : item.rotation;
        item.pixiSprite.rotation = visualRotation ? (visualRotation * (Math.PI / 180)) : 0;
    }

    function updateRoofPreview(roof) {
        if (!roof || !wizard) return;

        const qPressed = keysPressed['q'] || false;
        const rPressed = keysPressed['r'] || false;
        const hotkeysPressed = qPressed && rPressed;

        if (!roof.pixiMesh) {
            roof.createPixiMesh();
            if (roof.pixiMesh && roof.pixiMesh.parent) {
                roof.pixiMesh.parent.removeChild(roof.pixiMesh);
            }
        }

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
        if (!roof.pixiMesh) return;
        roof.pixiMesh.visible = !!roof.placed && !wizardInsideRoof;

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

    function clearGroundChunkCache() {
        // Legacy ground chunk cache removed.
    }

    function invalidateGroundChunks() {
        // Legacy ground chunk cache removed.
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
        return !!hovered.closest("#spellMenu, #selectedSpell, #spellSelector, #auraMenu, #selectedAura, #auraSelector, #activeAuraIcons, #statusBars");
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
            setUiGameCursorOverlayVisible(false);
            setUiArrowCursorVisible(true, hoverClientX, hoverClientY);
            return;
        }
        setUiArrowCursorVisible(false);

        if (!Number.isFinite(mousePos.screenX) || !Number.isFinite(mousePos.screenY) || !wizard) {
            setUiGameCursorOverlayVisible(false);
            return;
        }

        const activeCursor = spellCursor || cursorSprite;
        if (!activeCursor) {
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
            setUiGameCursorOverlayVisible(overMinimap, hoverClientX, hoverClientY, rotation);
            return;
        }

        const wizardScreenCoors = worldToScreen(wizard);
        const dx = wizardScreenCoors.x - mousePos.screenX;
        const dy = wizardScreenCoors.y - mousePos.screenY;
        rotation = Math.atan2(dy, dx) + Math.PI * 1.5;
        activeCursor.rotation = rotation;
        setUiGameCursorOverlayVisible(overMinimap, hoverClientX, hoverClientY, rotation);
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

    function addVisibilityMaskSource(source) {
        if (source) visibilityMaskSources.push(source);
    }

    function clearVisibilityMaskSources() {
        visibilityMaskSources = [];
    }

    global.isPlacedObjectEntity = isPlacedObjectEntity;
    global.normalizeLegacyAssetPath = normalizeLegacyAssetPath;
    global.isWallMountedPlaceable = isWallMountedPlaceable;
    global.worldToScreen = worldToScreen;
    global.getViewportNodeCorners = getViewportNodeCorners;
    global.getWrappedIndexRanges = getWrappedIndexRanges;
    global.screenToWorld = screenToWorld;
    global.centerViewport = centerViewport;
    global.forEachWrappedNodeInViewport = forEachWrappedNodeInViewport;
    global.screenToHex = screenToHex;
    global.ensureSpriteFrames = ensureSpriteFrames;
    global.updatePhantomWall = updatePhantomWall;
    global.updatePhantomFirewall = updatePhantomFirewall;
    global.updatePhantomRoad = updatePhantomRoad;
    global.updateLandLayer = updateLandLayer;
    global.resolvePlacedObjectLodTexturePath = resolvePlacedObjectLodTexturePath;
    global.applySpriteTransform = applySpriteTransform;
    global.updateRoofPreview = updateRoofPreview;
    global.clearGroundChunkCache = clearGroundChunkCache;
    global.invalidateGroundChunks = invalidateGroundChunks;
    global.updateCursor = updateCursor;
    global.distance = distance;
    global.withinRadius = withinRadius;
    global.pointInPolygon = pointInPolygon;
    global.raySegmentDistance = raySegmentDistance;
    global.message = message;
    global.setVisibilityMaskEnabled = setVisibilityMaskEnabled;
    global.setVisibilityMaskSources = setVisibilityMaskSources;
    global.addVisibilityMaskSource = addVisibilityMaskSource;
    global.clearVisibilityMaskSources = clearVisibilityMaskSources;
})(typeof globalThis !== "undefined" ? globalThis : window);
