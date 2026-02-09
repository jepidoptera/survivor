function drawCanvas() {
    if (!wizard) return;
    // Update land layer position (tiling background)
    updateLandLayer();

    drawHexGrid();
    drawGroundPlaneHitboxes();

    // Clear and rebuild object layer with sorted items
    objectLayer.removeChildren();

    // Keep phantom wall visible during layout mode
    if (wizard.wallLayoutMode && wizard.wallStartPoint && wizard.phantomWall) {
        updatePhantomWall(wizard.wallStartPoint.x, wizard.wallStartPoint.y, mousePos.worldX, mousePos.worldY);
        objectLayer.addChild(wizard.phantomWall);
    }

    // Keep phantom road visible during layout mode
    if (wizard.roadLayoutMode && wizard.roadStartPoint && wizard.phantomRoad) {
        updatePhantomRoad(wizard.roadStartPoint.x, wizard.roadStartPoint.y, mousePos.worldX, mousePos.worldY);
        objectLayer.addChild(wizard.phantomRoad);
    }

    let mapItems = [];
    let roadItems = [];
    onscreenObjects.clear();

    const topLeftNode = map.worldToNode(viewport.x, viewport.y);
    const bottomRightNode = map.worldToNode(viewport.x + viewport.width, viewport.y + viewport.height);

    if (topLeftNode && bottomRightNode) {
        const xStart = Math.max(-1, topLeftNode.xindex - 2);
        const xEnd = Math.min(mapWidth - 1, bottomRightNode.xindex + 2);
        const yStart = Math.max(-1, topLeftNode.yindex - 2);
        const yEnd = Math.min(mapHeight - 1, bottomRightNode.yindex + 4 / xyratio);

        const startColA = Math.floor(xStart / 2) * 2 - 1;
        const startColB = startColA - 1;

        for (let y = yStart; y <= yEnd; y++) {
            for (let x = startColA; x <= xEnd + 2; x += 2) {
                if (map.nodes[x] && map.nodes[x][y] && map.nodes[x][y].objects && map.nodes[x][y].objects.length > 0) {
                    map.nodes[x][y].objects.forEach(obj => {
                        if (obj && obj.type === "road") {
                            roadItems.push(obj);
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
                }
            }
            for (let x = startColB; x <= xEnd + 2; x += 2) {
                if (map.nodes[x] && map.nodes[x][y] && map.nodes[x][y].objects && map.nodes[x][y].objects.length > 0) {
                    map.nodes[x][y].objects.forEach(obj => {
                        if (obj && obj.type === "road") {
                            roadItems.push(obj);
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
                }
            }
        }
    }
    animals.forEach(animal => {
        if (animal.onScreen) {
            mapItems.push(animal);
            onscreenObjects.add(animal);
        }
    });

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

    updateRoadMask(roadItems);

    wizardCoors = worldToScreen(wizard);

    // Add sorted items to object layer
    mapItems.forEach(item => {
        // Skip items that have been fully vanished
        if (item.gone) return;

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
            // Update sprite alpha for occlusion
            itemCoors = worldToScreen(item);
            let itemLeft = itemCoors.x - ((item.width || 1) * viewscale) / 2;
            let itemRight = itemCoors.x + ((item.width || 1) * viewscale) / 2;
            // Trees, animals, and walls don't get squashed by xyratio - use full height for bounds
            const itemHeightInPixels = (item.height || 1) * viewscale;
            let itemTop = itemCoors.y - itemHeightInPixels;
            let itemBottom = itemCoors.y;

            // Use trapezoid bounds for falling trees when available
            if (item.type === "tree" && item.taperBounds) {
                itemLeft = item.taperBounds.left;
                itemRight = item.taperBounds.right;
                itemTop = item.taperBounds.top;
                itemBottom = item.taperBounds.bottom;
            }

            const itemPixelWidth = Math.max(1, itemRight - itemLeft);
            const itemPixelHeight = Math.max(1, itemBottom - itemTop);
            const wizardPixelWidth = (wizard.width || 1) * viewscale;
            const wizardPixelHeight = (wizard.height || 1) * viewscale;

            const wizardLeft = wizardCoors.x - wizardPixelWidth / 2;
            const wizardRight = wizardCoors.x + wizardPixelWidth / 2;
            const wizardTop = wizardCoors.y - wizardPixelHeight / 2;
            const wizardBottom = wizardCoors.y + wizardPixelHeight / 2;

            const overlapX = Math.max(0, Math.min(itemRight, wizardRight) - Math.max(itemLeft, wizardLeft));
            const overlapY = Math.max(0, Math.min(itemBottom, wizardBottom) - Math.max(itemTop, wizardTop));
            const overlapArea = overlapX * overlapY;
            const wizardArea = Math.max(1, wizardPixelWidth * wizardPixelHeight);
            const overlapRatio = Math.max(0, Math.min(overlapArea / wizardArea, 1));

            let fadeRatio = overlapRatio;
            let shouldFade = itemCoors.y > wizardCoors.y && itemCoors.y - itemPixelHeight < wizardCoors.y && overlapRatio > 0;

            // Roads should never fade when the wizard overlaps them
            if (item.type === "road") {
                shouldFade = false;
                fadeRatio = 0;
            }

            // Softer approach fade for fallen trees using trapezoid bounds
            if (item.type === "tree" && item.taperBounds) {
                const xOverlapRatio = Math.max(0, Math.min(overlapX / wizardPixelWidth, 1));
                const fadeRange = wizardPixelHeight * 0.1; // Very tight approach range
                let verticalProximity = 0;

                // Calculate distance from wizard top to item bottom
                const distToBottom = wizardTop - itemBottom;

                // Only fade when wizard is below or within the tree's vertical bounds
                if (distToBottom > 0 && distToBottom < fadeRange) {
                    // Approaching from below - fade increases as distance decreases
                    verticalProximity = 1 - (distToBottom / fadeRange);
                } else if (wizardTop >= itemTop && wizardTop <= itemBottom) {
                    // wizard is within the vertical bounds of the tree - maintain full fade
                    verticalProximity = 1;
                }

                // Combine horizontal overlap with vertical proximity
                fadeRatio = Math.max(fadeRatio, xOverlapRatio * verticalProximity);

                // Fade if there's any horizontal overlap and vertical proximity
                if (xOverlapRatio > 0 && verticalProximity > 0) {
                    shouldFade = true;
                }
            }

            // Smoothstep for less sudden transitions
            const smoothFade = fadeRatio * fadeRatio * (3 - 2 * fadeRatio);

            let occlusionAlpha = 1;
            if (shouldFade) {
                occlusionAlpha = 1 - 0.5 * smoothFade;
            }

            // Combine vanish alpha with occlusion alpha
            if (item.vanishing === true && item.vanishStartTime !== undefined && item.vanishDuration !== undefined) {
                const elapsedFrames = frameCount - item.vanishStartTime;

                if (elapsedFrames < 1) {
                    // First frame: show blue tint
                    item.pixiSprite.tint = 0x0099FF;
                    item.pixiSprite.alpha = occlusionAlpha;
                } else {
                    // Fade phase: fade from blue to transparent over 1/4 second
                    const fadeElapsed = elapsedFrames - 1;
                    const fadeDuration = 0.25 * frameRate; // 1/4 second
                    this.percentVanished = Math.min(1, fadeElapsed / fadeDuration);
                    const vanishAlpha = Math.max(0, 1 - this.percentVanished);
                    item.pixiSprite.tint = 0x0099FF; // Keep blue tint while fading
                    item.pixiSprite.alpha = occlusionAlpha * vanishAlpha;
                }
            } else {
                item.pixiSprite.alpha = occlusionAlpha;
            }
            // item.pixiSprite.anchor.set(0.1, 0.1);
            objectLayer.addChild(item.pixiSprite);

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
                if (frameCount % 2 === 0) {
                    item.fireFrameIndex = (item.fireFrameIndex + 1) % fireFrames.length;
                }
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

                    item.fireSprite.width = (item.width || 1) * viewscale * fireScale;
                    item.fireSprite.height = (item.height || 1) * viewscale * fireScale;
                } else {
                    item.fireSprite.width = (item.width || 1) * viewscale;
                    item.fireSprite.height = (item.height || 1) * viewscale;
                }

                // Apply alpha fade
                const alphaMult = item.fireAlphaMult !== undefined ? item.fireAlphaMult : 1;
                item.fireSprite.alpha = item.pixiSprite.alpha * alphaMult;
                item.fireSprite.rotation = 0; // Fire stays upright
                objectLayer.addChild(item.fireSprite);
            }
        }
    });

    wizard.draw();
    wizard.updateStatusBars();
    drawProjectiles();
    drawHitboxes();
    drawWizardBoundaries();
    updateRoofPreview(roof);
    updateCursor();

    $('#msg').html(messages.join("<br>"));
}

function worldToScreen(item) {
    return {
        x: (item.x - viewport.x) * viewscale,
        y: (item.y - viewport.y) * viewscale * xyratio
    };
}

function screenToWorld(screenX, screenY) {
    return {
        x: screenX / viewscale + viewport.x,
        y: screenY / (viewscale * xyratio) + viewport.y
    };
}

function centerViewport(obj, margin) {
    // viewport is in array index units
    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;

    // Convert obj world coordinates to index units
    const objIndexX = obj.x;
    const objIndexY = obj.y;

    // Check if object is outside the margin box
    const leftBound = centerX - margin;
    const rightBound = centerX + margin;
    const topBound = centerY - margin;
    const bottomBound = centerY + margin;

    // Smooth interpolation factor (lower = smoother but slower to respond)
    const smoothFactor = 0.15;

    // Calculate desired viewport adjustment
    let targetOffsetX = 0;
    let targetOffsetY = 0;

    if (objIndexX < leftBound) {
        targetOffsetX = (objIndexX - leftBound);
    } else if (objIndexX > rightBound) {
        targetOffsetX = (objIndexX - rightBound);
    }

    if (objIndexY < topBound) {
        targetOffsetY = (objIndexY - topBound);
    } else if (objIndexY > bottomBound) {
        targetOffsetY = (objIndexY - bottomBound);
    }

    // Smoothly interpolate viewport position
    viewport.x += targetOffsetX * smoothFactor;
    viewport.y += targetOffsetY * smoothFactor;

    // Clamp viewport to map bounds
    viewport.x = Math.max(0, Math.min(viewport.x, mapWidth - viewport.width));
    viewport.y = Math.max(0, Math.min(viewport.y, mapHeight - viewport.height));
}

function updatePhantomWall(ax, ay, bx, by) {
    if (!wizard.phantomWall) return;

    wizard.phantomWall.clear();

    const nodeA = map.worldToNode(ax, ay);
    const nodeB = map.worldToNode(bx, by);
    if (!nodeA || !nodeB) return;

    const wallPath = map.getHexLine(nodeA, nodeB);
    for (let i = 0; i < wallPath.length - 1; i++) {
        const nodeA = wallPath[i];
        const nodeB = wallPath[i + 1];

        // Use the static NewWall.drawWall method with phantom styling
        Wall.drawWall(wizard.phantomWall, nodeA, nodeB, 2.0, 0.2, 0x888888, 0.5);
    }
}

function updatePhantomRoad(ax, ay, bx, by) {
    if (!wizard.phantomRoad) return;

    wizard.phantomRoad.removeChildren();

    const nodeA = map.worldToNode(ax, ay);
    const nodeB = map.worldToNode(bx, by);
    if (!nodeA || !nodeB) return;

    const width = (nodeA === nodeB) ? 1 : 3;
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
    if (!roadMaskGraphics || !roadTileSprite) return;

    const texture = roadTileSprite.texture;
    if (!texture || !texture.baseTexture || !texture.baseTexture.valid) return;

    roadMaskGraphics.clear();

    // Align tiling to world space
    const tileScaleX = (roadRepeatWorldUnits * viewscale) / texture.baseTexture.width;
    const tileScaleY = (roadRepeatWorldUnits * viewscale * xyratio) / texture.baseTexture.height;
    roadTileSprite.tileScale.set(tileScaleX, tileScaleY);
    roadTileSprite.tileTransform.rotation = roadTextureRotation;
    roadTileSprite.tilePosition.set(-viewport.x * viewscale, -viewport.y * viewscale * xyratio);

    if (!roadItems || roadItems.length === 0) return;

    const roadNodeKeys = new Set(
        roadItems.map(item => `${item.node.xindex},${item.node.yindex}`)
    );

    const oddDirections = [1, 3, 5, 7, 9, 11];
    const pixelsPerWorldUnit = (128 * 2) / 1.1547;

    // First draw the solid core
    roadMaskGraphics.beginFill(0xffffff, 1);
    roadMaskGraphics.lineStyle(0);

    roadItems.forEach(item => {
        const node = item.node;
        if (!node) return;

        const neighborDirections = oddDirections.filter(direction => {
            const neighbor = node.neighbors[direction];
            if (!neighbor) return false;
            if (roadNodeKeys.has(`${neighbor.xindex},${neighbor.yindex}`)) return true;
            return neighbor.objects && neighbor.objects.some(obj => obj.type === 'road');
        });

        const { keptCorners } = Road.getGeometryForNeighbors(neighborDirections);
        if (!keptCorners || keptCorners.length < 3) return;

        keptCorners.forEach((pt, idx) => {
            const worldX = node.x + (pt.x / pixelsPerWorldUnit);
            const worldY = node.y + (pt.y / pixelsPerWorldUnit);
            const screen = worldToScreen({x: worldX, y: worldY});
            if (idx === 0) {
                roadMaskGraphics.moveTo(screen.x, screen.y);
            } else {
                roadMaskGraphics.lineTo(screen.x, screen.y);
            }
        });
        roadMaskGraphics.closePath();
    });

    roadMaskGraphics.endFill();
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
    if (item.type === "road") {
        item.pixiSprite.x = Math.round(coors.x);
        item.pixiSprite.y = Math.round(coors.y);
    } else {
        item.pixiSprite.x = coors.x;
        item.pixiSprite.y = coors.y;
    }
    // item.pixiSprite.anchor.set(0, 1);
    item.pixiSprite.width = (item.width || 1) * viewscale;
    // Pavement gets squashed by xyratio for isometric effect, but trees/animals/walls display at full height
    if (item.type === "road") {
        item.pixiSprite.height = (item.height || 1) * viewscale * xyratio;
    } else {
        item.pixiSprite.height = (item.height || 1) * viewscale;
    }
    item.pixiSprite.width = (item.width || 1) * viewscale;
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
    if (!landTileSprite || !Array.isArray(landTileSprite)) return;

    // Update positions of the 4 background tiles to stay centered on viewport
    // Calculate which tile should appear at each position
    const bgWidth = app.screen.width;
    const bgHeight = app.screen.height;

    // Calculate offset in pixels from viewport
    const offsetX = -(viewport.x * viewscale) % bgWidth;
    const offsetY = -(viewport.y * viewscale * xyratio) % bgHeight;

    // Position the 4 tiles in a 2x2 grid
    for (let ty = 0; ty < 2; ty++) {
        for (let tx = 0; tx < 2; tx++) {
            const spriteIndex = ty * 2 + tx;
            const sprite = landTileSprite[spriteIndex];
            sprite.x = offsetX + tx * bgWidth;
            sprite.y = offsetY + ty * bgHeight;
        }
    }
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

function drawHexGrid() {
    if (!showHexGrid && !debugMode) {
        if (gridGraphics) gridGraphics.visible = false;
        return;
    }

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

    startNode = map.worldToNode(viewport.x, viewport.y);
    endNode = map.worldToNode(viewport.x + viewport.width, viewport.y + viewport.height);

    const yStart = Math.max(Math.floor(startNode.yindex) - 2, 0);
    const yEnd = Math.min(Math.ceil(endNode.yindex) + 2, mapHeight - 1);
    const xStart = Math.max(Math.floor(startNode.xindex) - 2, 0);
    const xEnd = Math.min(Math.ceil(endNode.xindex) + 2, mapWidth - 1);

    const animalTiles = new Set();
    animals.forEach(animal => {
        if (!animal || animal.gone || animal.dead) return;
        animalTiles.add(`${animal.x},${animal.y}`);
    });

    for (let y = yStart; y <= yEnd; y++) {
        for (let x = xStart; x <= xEnd; x++) {
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
    }

    // Draw blocked neighbor connections with red perpendicular lines
    if (showBlockedNeighbors) {
        gridGraphics.lineStyle(4, 0xff0000, 0.4);
        for (let y = yStart; y <= yEnd; y++) {
            for (let x = xStart; x <= xEnd; x++) {
                if (!map.nodes[x] || !map.nodes[x][y]) continue;
                const node = map.nodes[x][y];

                if (!node.blockedNeighbors || node.blockedNeighbors.size === 0) continue;

                // For each blocked neighbor direction
                node.blockedNeighbors.forEach((blockingSet, direction) => {
                    if (blockingSet.size === 0) return;

                    const neighbor = node.neighbors[direction];
                    if (!neighbor) return;

                    // Calculate midpoint between the two hexes in world space
                    const midX = (node.x + neighbor.x) / 2;
                    const midY = (node.y + neighbor.y) / 2;

                    // Calculate vector from node to neighbor
                    const dx = neighbor.x - node.x;
                    const dy = neighbor.y - node.y;
                    const len = Math.sqrt(dx * dx + dy * dy);

                    if (len === 0) return;

                    // Perpendicular vector (rotate 90 degrees)
                    const perpX = -dy / len;
                    const perpY = dx / len;

                    // Line length (in world units)
                    const lineLength = 0.4;

                    // Calculate endpoints of perpendicular line
                    const x1 = midX + perpX * lineLength;
                    const y1 = midY + perpY * lineLength;
                    const x2 = midX - perpX * lineLength;
                    const y2 = midY - perpY * lineLength;

                    // Convert to screen coordinates
                    const screen1 = worldToScreen({x: x1, y: y1});
                    const screen2 = worldToScreen({x: x2, y: y2});

                    // Draw the line
                    gridGraphics.moveTo(screen1.x, screen1.y);
                    gridGraphics.lineTo(screen2.x, screen2.y);
                });
            }
        }
    }
}

function drawGroundPlaneHitboxes() {
    if (!debugMode) {
        if (groundPlaneHitboxGraphics) groundPlaneHitboxGraphics.visible = false;
        return;
    }

    if (!groundPlaneHitboxGraphics) {
        groundPlaneHitboxGraphics = new PIXI.Graphics();
        hitboxLayer.addChild(groundPlaneHitboxGraphics);
    }
    groundPlaneHitboxGraphics.visible = true;
    groundPlaneHitboxGraphics.clear();

    // Collect all objects with ground plane hitboxes
    const topLeftNode = map.worldToNode(viewport.x, viewport.y);
    const bottomRightNode = map.worldToNode(viewport.x + viewport.width, viewport.y + viewport.height);

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

function drawHitboxes() {
    if (!debugMode) {
        if (hitboxGraphics) hitboxGraphics.visible = false;
        return;
    }

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
    const topLeftNode = map.worldToNode(viewport.x, viewport.y);
    const bottomRightNode = map.worldToNode(viewport.x + viewport.width, viewport.y + viewport.height);

    if (topLeftNode && bottomRightNode) {
        const yStart = Math.max(topLeftNode.yindex - 2, 0);
        const yEnd = Math.min(bottomRightNode.yindex + 3, mapHeight - 1);
        const xStart = Math.max(topLeftNode.xindex - 2, 0);
        const xEnd = Math.min(bottomRightNode.xindex + 2, mapWidth - 1);

        // Draw polygon hitboxes for all onscreen objects that have them
        if (onscreenObjects.size > 0) {
            onscreenObjects.entries().forEach(([key, obj]) => {
                if (!obj) {
                    console.log('Undefined object in onscreenObjects set:', key);
                    return;
                }
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
}

function drawWizardBoundaries() {
    if (!debugMode || !wizard) {
        if (wizardBoundaryGraphics) wizardBoundaryGraphics.visible = false;
        return;
    }

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

function updateCursor() {
    if (!mousePos.screenX || !mousePos.screenY || !wizard) return;

    // Toggle cursor visibility based on spacebar state
    const spacePressed = keysPressed[' '] || false;

    if (cursorSprite) {
        cursorSprite.visible = !spacePressed;
    }
    if (spellCursor) {
        spellCursor.visible = spacePressed;
    }

    // Use whichever cursor is active
    const activeCursor = spacePressed ? spellCursor : cursorSprite;
    if (!activeCursor) return;

    // Set cursor position to mouse position
    activeCursor.x = mousePos.screenX;
    activeCursor.y = mousePos.screenY;

    // Calculate wizard position in screen coordinates
    wizardScreenCoors = worldToScreen(wizard);
    const wizardScreenX = wizardScreenCoors.x;
    const wizardScreenY = wizardScreenCoors.y;

    // Calculate vector from mouse to wizard
    const dx = wizardScreenX - mousePos.screenX;
    const dy = wizardScreenY - mousePos.screenY;

    // Calculate rotation angle (atan2 returns angle from -PI to PI)
    // Add PI to point away from wizard, then add PI/2 for visual alignment
    const angle = Math.atan2(dy, dx) + Math.PI * 1.5;
    activeCursor.rotation = angle;

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
    const showRoof = qPressed && rPressed;

    if (!roof.pixiMesh) {
        roof.createPixiMesh();
        roofLayer.addChild(roof.pixiMesh);
    }

    roof.pixiMesh.visible = showRoof;

    if (showRoof) {
        // Position mesh at wizard's screen location
        const wizardCoords = worldToScreen(wizard);
        roof.pixiMesh.x = wizardCoords.x;
        roof.pixiMesh.y = wizardCoords.y;
    }
}

function message(text) {
    messages.push(text);
    setTimeout(() => {
        messages.shift();
    }, 8000);
}
