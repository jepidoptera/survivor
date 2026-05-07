function resolvePlaceObjectLayerInfo(wizardRef) {
    const layer = (() => {
        const candidates = [
            wizardRef && wizardRef.currentLayer,
            wizardRef && wizardRef.selectedFloorEditLevel,
            wizardRef && wizardRef.traversalLayer
        ];
        for (let i = 0; i < candidates.length; i++) {
            const value = Number(candidates[i]);
            if (Number.isFinite(value)) return Math.round(value);
        }
        return 0;
    })();
    const baseZ = (wizardRef && Number.isFinite(wizardRef.currentLayerBaseZ))
        ? Number(wizardRef.currentLayerBaseZ)
        : layer * 3;
    return { layer, baseZ };
}

function resolveEditorLayerInfo(wizardRef) {
    return resolvePlaceObjectLayerInfo(wizardRef);
}

function resolvePlaceObjectWorldPointOnLayer(wizardRef, fallbackX, fallbackY, options = {}) {
    const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
    const screenX = Number.isFinite(options && options.screenX)
        ? Number(options.screenX)
        : ((typeof globalThis !== "undefined" && globalThis.mousePos && Number.isFinite(globalThis.mousePos.screenX))
            ? Number(globalThis.mousePos.screenX)
            : null);
    const screenY = Number.isFinite(options && options.screenY)
        ? Number(options.screenY)
        : ((typeof globalThis !== "undefined" && globalThis.mousePos && Number.isFinite(globalThis.mousePos.screenY))
            ? Number(globalThis.mousePos.screenY)
            : null);
    const viewportRef = (typeof viewport !== "undefined") ? viewport : null;
    if (
        Number.isFinite(screenX) &&
        Number.isFinite(screenY) &&
        viewportRef &&
        Number.isFinite(viewportRef.x) &&
        Number.isFinite(viewportRef.y)
    ) {
        const vs = (typeof viewscale !== "undefined" && Number.isFinite(viewscale) && viewscale)
            ? Number(viewscale)
            : 1;
        const xyr = (typeof xyratio !== "undefined" && Number.isFinite(xyratio) && xyratio)
            ? Number(xyratio)
            : 1;
        const layerInfo = resolvePlaceObjectLayerInfo(wizardRef);
        const cameraZ = Number.isFinite(viewportRef.z) ? Number(viewportRef.z) : 0;
        let worldX = (screenX / vs) + Number(viewportRef.x);
        let worldY = (screenY / (vs * xyr)) + Number(viewportRef.y) + (layerInfo.baseZ - cameraZ);
        if (mapRef && typeof mapRef.wrapWorldX === "function" && Number.isFinite(worldX)) {
            worldX = mapRef.wrapWorldX(worldX);
        }
        if (mapRef && typeof mapRef.wrapWorldY === "function" && Number.isFinite(worldY)) {
            worldY = mapRef.wrapWorldY(worldY);
        }
        if (
            wizardRef &&
            mapRef &&
            typeof mapRef.shortestDeltaX === "function" &&
            typeof mapRef.shortestDeltaY === "function" &&
            Number.isFinite(wizardRef.x) &&
            Number.isFinite(wizardRef.y) &&
            Number.isFinite(worldX) &&
            Number.isFinite(worldY)
        ) {
            worldX = Number(wizardRef.x) + mapRef.shortestDeltaX(Number(wizardRef.x), worldX);
            worldY = Number(wizardRef.y) + mapRef.shortestDeltaY(Number(wizardRef.y), worldY);
        }
        return { x: worldX, y: worldY, layer: layerInfo.layer, baseZ: layerInfo.baseZ };
    }
    const layerInfo = resolvePlaceObjectLayerInfo(wizardRef);
    return { x: fallbackX, y: fallbackY, layer: layerInfo.layer, baseZ: layerInfo.baseZ };
}

function resolveEditorWorldPointOnLayer(wizardRef, fallbackX, fallbackY, options = {}) {
    return resolvePlaceObjectWorldPointOnLayer(wizardRef, fallbackX, fallbackY, options);
}

function resolveEditorNodeOnLayer(mapRef, worldX, worldY, layer = 0, options = {}) {
    if (!mapRef || typeof mapRef.worldToNode !== "function") return null;
    const baseNode = mapRef.worldToNode(worldX, worldY);
    if (!baseNode) return null;
    const targetLayer = Number.isFinite(layer) ? Math.round(Number(layer)) : 0;
    if (targetLayer === 0) return baseNode;
    if (typeof mapRef.getFloorNodeAtLayer !== "function") return null;
    const sectionKey = (typeof (options && options.sectionKey) === "string" && options.sectionKey.length > 0)
        ? options.sectionKey
        : (typeof baseNode._prototypeSectionKey === "string"
            ? baseNode._prototypeSectionKey
            : ((typeof mapRef.getPrototypeSectionKeyForWorldPoint === "function")
                ? mapRef.getPrototypeSectionKeyForWorldPoint(worldX, worldY)
                : ""));
    return mapRef.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, targetLayer, {
        sectionKey,
        allowScan: !(options && options.allowScan === false)
    });
}

if (typeof globalThis !== "undefined") {
    globalThis.resolveEditorLayerInfo = resolveEditorLayerInfo;
    globalThis.resolveEditorWorldPointOnLayer = resolveEditorWorldPointOnLayer;
    globalThis.resolveEditorNodeOnLayer = resolveEditorNodeOnLayer;
    globalThis.resolvePlaceObjectLayerInfo = resolvePlaceObjectLayerInfo;
    globalThis.resolvePlaceObjectWorldPointOnLayer = resolvePlaceObjectWorldPointOnLayer;
}

class PlaceObject extends globalThis.Spell {
    constructor(x, y) {
        super(x, y);
        this.image = document.createElement('img');
        this.gravity = 0;
        this.speed = 0;
        this.range = 20;
        this.bounces = 0;
        this.apparentSize = 0;
        this.delayTime = 0;
        this.magicCost = 0;
        this.radius = 0;
    }

    quantizeToStep(value, min, max, step) {
        const raw = Number(value);
        const clamped = Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : min));
        const snapped = Math.round((clamped - min) / step) * step + min;
        const precision = Math.max(0, (String(step).split(".")[1] || "").length);
        return Number(snapped.toFixed(precision));
    }

    cast(targetX, targetY, options = {}) {
        const selectedCategory = (
            wizard &&
            typeof wizard.selectedPlaceableCategory === "string" &&
            wizard.selectedPlaceableCategory.length > 0
        ) ? wizard.selectedPlaceableCategory : "doors";
        const selectedCategoryKey = selectedCategory.trim().toLowerCase();
        const layerPoint = resolvePlaceObjectWorldPointOnLayer(wizard, targetX, targetY, options);
        const placementTargetX = Number.isFinite(layerPoint.x) ? Number(layerPoint.x) : targetX;
        const placementTargetY = Number.isFinite(layerPoint.y) ? Number(layerPoint.y) : targetY;

        const wrappedX = (wizard.map && typeof wizard.map.wrapWorldX === "function")
            ? wizard.map.wrapWorldX(placementTargetX)
            : placementTargetX;
        const wrappedY = (wizard.map && typeof wizard.map.wrapWorldY === "function")
            ? wizard.map.wrapWorldY(placementTargetY)
            : placementTargetY;
        if (!Number.isFinite(wrappedX) || !Number.isFinite(wrappedY)) {
            message("Cannot place object there!");
            return this;
        }

        if (selectedCategoryKey === "roof") {
            const normalizeRoofTexturePath = (texturePath) => {
                if (typeof texturePath !== "string" || texturePath.length === 0) return "/assets/images/roofs/smallshingles.png";
                const base = texturePath.split("?")[0].split("#")[0];
                if (base === "/assets/images/thumbnails/roof.png") return "/assets/images/roofs/smallshingles.png";
                if (base.startsWith("/assets/images/roof/")) {
                    return texturePath.replace("/assets/images/roof/", "/assets/images/roofs/");
                }
                return texturePath;
            };
            const roofCtor = (typeof Roof === "function")
                ? Roof
                : ((typeof globalThis !== "undefined" && typeof globalThis.Roof === "function") ? globalThis.Roof : null);
            if (!roofCtor || typeof roofCtor.getPlacementCandidate !== "function") {
                message("Roof placement is unavailable.");
                return this;
            }
            const candidate = roofCtor.getPlacementCandidate(wizard, wrappedX, wrappedY, { maxDepth: null });
            if (!candidate || !Array.isArray(candidate.wallSections) || candidate.wallSections.length < 3) {
                message("No valid closed wall loop for roof placement.");
                return this;
            }
            const targetRoof = new roofCtor(0, 0, 0);
            targetRoof.map = wizard.map || null;
            targetRoof.gone = false;
            targetRoof.vanishing = false;
            targetRoof.textureName = normalizeRoofTexturePath(
                wizard && typeof wizard.selectedPlaceableTexturePath === "string"
                    ? wizard.selectedPlaceableTexturePath
                    : "/assets/images/roofs/smallshingles.png"
            );
            const roofOverhang = this.quantizeToStep(
                wizard && Number.isFinite(wizard.selectedRoofOverhang) ? wizard.selectedRoofOverhang : 0.25,
                0,
                1,
                0.0625
            );
            const roofPeakHeight = this.quantizeToStep(
                wizard && Number.isFinite(wizard.selectedRoofPeakHeight) ? wizard.selectedRoofPeakHeight : 2,
                0,
                10,
                0.25
            );
            const roofTextureRepeat = this.quantizeToStep(
                wizard && Number.isFinite(wizard.selectedRoofTextureRepeat) ? wizard.selectedRoofTextureRepeat : 0.125,
                0.0625,
                1,
                0.03125
            );
            if (wizard) {
                wizard.selectedRoofOverhang = roofOverhang;
                wizard.selectedRoofPeakHeight = roofPeakHeight;
                wizard.selectedRoofTextureRepeat = roofTextureRepeat;
            }
            targetRoof.textureRepeat = roofTextureRepeat;
            const applied = (typeof roofCtor.applyWallLoopCandidateToRoof === "function")
                ? roofCtor.applyWallLoopCandidateToRoof(targetRoof, candidate, wizard.map, {
                    peakOffsetZ: roofPeakHeight,
                    overhang: roofOverhang
                })
                : false;
            if (!applied) {
                message("Failed to build roof mesh from wall loop.");
                return this;
            }
            if (wizard.map && Array.isArray(wizard.map.objects)) {
                wizard.map.objects.push(targetRoof);
            }
            if (
                typeof globalThis !== "undefined" &&
                globalThis.Scripting &&
                typeof globalThis.Scripting.ensureObjectScriptingName === "function"
            ) {
                globalThis.Scripting.ensureObjectScriptingName(targetRoof, { map: wizard.map || null });
            }
            if (typeof globalThis !== "undefined") {
                if (!Array.isArray(globalThis.roofs)) {
                    globalThis.roofs = [];
                }
                if (!globalThis.roofs.includes(targetRoof)) {
                    globalThis.roofs.push(targetRoof);
                }
            }
            if (typeof globalThis !== "undefined") {
                // Keep legacy singleton for old code paths; newest roof wins.
                globalThis.roof = targetRoof;
            }
            if (
                typeof globalThis !== "undefined" &&
                globalThis.Scripting &&
                typeof globalThis.Scripting.runObjectInitScript === "function"
            ) {
                globalThis.Scripting.runObjectInitScript(
                    targetRoof,
                    (typeof wizard !== "undefined") ? wizard : null,
                    { reason: "objectCreated" }
                );
            }
            if (
                wizard &&
                wizard.map &&
                wizard.map._prototypeObjectState
            ) {
                if (!(wizard.map._prototypeObjectState.dirtyRuntimeObjects instanceof Set)) {
                    wizard.map._prototypeObjectState.dirtyRuntimeObjects = new Set();
                }
                wizard.map._prototypeObjectState.dirtyRuntimeObjects.add(targetRoof);
                targetRoof._prototypeDirty = true;
                wizard.map._prototypeObjectState.captureScanNeeded = true;
            }
            this.visible = false;
            this.detachPixiSprite();
            return this;
        }

        if (typeof PlacedObject !== "function") {
            message("Object placement is unavailable.");
            return this;
        }

        const selectedTexturePath = (
            wizard &&
            typeof wizard.selectedPlaceableTexturePath === "string" &&
            wizard.selectedPlaceableTexturePath.length > 0
        ) ? wizard.selectedPlaceableTexturePath : "/assets/images/doors/door5.png";
        const renderDepthOffset = (wizard && Number.isFinite(wizard.selectedPlaceableRenderOffset))
            ? Number(wizard.selectedPlaceableRenderOffset)
            : 0;
        const placeableScale = (wizard && Number.isFinite(wizard.selectedPlaceableScale))
            ? Number(wizard.selectedPlaceableScale)
            : 1;
        const scaleMin = (wizard && Number.isFinite(wizard.selectedPlaceableScaleMin)) ? wizard.selectedPlaceableScaleMin : 0.2;
        const scaleMax = (wizard && Number.isFinite(wizard.selectedPlaceableScaleMax)) ? wizard.selectedPlaceableScaleMax : 5;
        const clampedScale = Math.max(scaleMin, Math.min(scaleMax, placeableScale));
        const selectedSizing = (
            wizard &&
            wizard.selectedPlaceableSizingByTexture &&
            typeof wizard.selectedPlaceableSizingByTexture === "object"
        ) ? wizard.selectedPlaceableSizingByTexture[selectedTexturePath] : null;
        const scaledDimensions = (
            typeof globalThis !== "undefined" &&
            typeof globalThis.resolvePlaceableScaledDimensions === "function"
        ) ? globalThis.resolvePlaceableScaledDimensions(selectedSizing, clampedScale) : {
            width: clampedScale,
            height: clampedScale
        };
        const selectedAnchorX = (wizard && Number.isFinite(wizard.selectedPlaceableAnchorX))
            ? Number(wizard.selectedPlaceableAnchorX)
            : 0.5;
        const selectedAnchorY = (wizard && Number.isFinite(wizard.selectedPlaceableAnchorY))
            ? Number(wizard.selectedPlaceableAnchorY)
            : 1;
        const placementRotation = (wizard && Number.isFinite(wizard.selectedPlaceableRotation))
            ? Number(wizard.selectedPlaceableRotation)
            : 0;
        const rotationAxisRaw = wizard ? wizard.selectedPlaceableRotationAxis : null;
        const rotationAxisNormalized = (typeof rotationAxisRaw === "string")
            ? rotationAxisRaw.trim().toLowerCase()
            : "";
        const rotationAxis = (rotationAxisNormalized === "spatial" || rotationAxisNormalized === "visual" || rotationAxisNormalized === "none" || rotationAxisNormalized === "ground")
            ? rotationAxisNormalized
            : ((selectedCategory === "doors" || selectedCategory === "windows") ? "spatial" : "visual");
        const effectivePlacementRotation = (rotationAxis === "none") ? 0 : placementRotation;
        const placementLayer = Number.isFinite(layerPoint.layer) ? Number(layerPoint.layer) : 0;
        const placementLayerBaseZ = Number.isFinite(layerPoint.baseZ) ? Number(layerPoint.baseZ) : placementLayer * 3;
        const isWallMountedPlacement = selectedCategory === "windows" || selectedCategory === "doors";
        const wallSnapPlacement = isWallMountedPlacement
            ? (
                (typeof SpellSystem !== "undefined" &&
                    SpellSystem &&
                    typeof SpellSystem.getPlaceObjectPlacementCandidate === "function")
                    ? SpellSystem.getPlaceObjectPlacementCandidate(wizard, wrappedX, wrappedY)
                    : null
            )
            : null;
        const useWallSnapPlacement = !!(
            isWallMountedPlacement &&
            wallSnapPlacement &&
            wallSnapPlacement.targetWall
        );
        const effectiveAnchorY = (
            useWallSnapPlacement &&
            selectedCategoryKey === "windows"
        ) ? 0.5 : selectedAnchorY;
        const effectiveAnchorX = useWallSnapPlacement ? 0.5 : selectedAnchorX;
        const rawYScale = Number(
            (typeof globalThis !== "undefined" && Number.isFinite(globalThis.xyratio))
                ? globalThis.xyratio
                : 0.66
        );
        const yScale = Math.max(0.1, Math.abs(rawYScale));
        const placementYOffset = (rotationAxis === "spatial" || rotationAxis === "ground")
            ? 0
            : (((selectedAnchorY - 0.5) * scaledDimensions.height) / yScale);
        const spatialAnchorPlacementYOffset = (
            rotationAxis === "spatial" &&
            !useWallSnapPlacement &&
            (selectedCategoryKey === "doors" || selectedCategoryKey === "windows")
        )
            ? (((selectedAnchorY - 0.5) * scaledDimensions.height) / yScale)
            : 0;
        const placedX = (
            useWallSnapPlacement &&
            Number.isFinite(wallSnapPlacement.snappedX)
        ) ? Number(wallSnapPlacement.snappedX) : wrappedX;
        let placedY = (
            useWallSnapPlacement &&
            Number.isFinite(wallSnapPlacement.snappedY)
        ) ? Number(wallSnapPlacement.snappedY) : (wrappedY + placementYOffset + spatialAnchorPlacementYOffset);
        if (wizard.map && typeof wizard.map.wrapWorldY === "function") {
            placedY = wizard.map.wrapWorldY(placedY);
        }
        if (
            wizard.map &&
            typeof wizard.map.worldToNode === "function" &&
            !wizard.map.worldToNode(wrappedX, placedY) &&
            wizard.map.worldToNode(wrappedX, wrappedY)
        ) {
            placedY = wrappedY;
        }

        const resolvedPlacementRotation = (
            useWallSnapPlacement &&
            Number.isFinite(wallSnapPlacement.snappedRotationDeg)
        ) ? Number(wallSnapPlacement.snappedRotationDeg) : effectivePlacementRotation;

        const placedObject = new PlacedObject({ x: placedX, y: placedY }, wizard.map, {
            texturePath: selectedTexturePath,
            category: selectedCategory,
            renderDepthOffset,
            width: scaledDimensions.width,
            height: scaledDimensions.height,
            traversalLayer: placementLayer,
            level: placementLayer,
            placeableAnchorX: effectiveAnchorX,
            placeableAnchorY: effectiveAnchorY,
            rotationAxis: useWallSnapPlacement ? "spatial" : rotationAxis,
            placementRotation: resolvedPlacementRotation,
            mountedSectionId: (
                useWallSnapPlacement &&
                Number.isInteger(wallSnapPlacement.mountedSectionId)
            ) ? Number(wallSnapPlacement.mountedSectionId) : null,
            mountedWallSectionUnitId: (
                useWallSnapPlacement &&
                Number.isInteger(wallSnapPlacement.mountedWallSectionUnitId)
            ) ? Number(wallSnapPlacement.mountedWallSectionUnitId) : null,
            mountedWallFacingSign: (
                useWallSnapPlacement &&
                Number.isFinite(wallSnapPlacement.mountedWallFacingSign)
            ) ? Number(wallSnapPlacement.mountedWallFacingSign) : null,
            groundPlaneHitboxOverridePoints: useWallSnapPlacement ? wallSnapPlacement.wallGroundHitboxPoints : undefined
        });
        if (
            useWallSnapPlacement &&
            Number.isFinite(wallSnapPlacement.snappedZ) &&
            placedObject
        ) {
            placedObject.z = Number(wallSnapPlacement.snappedZ);
        }
        if (placedObject) {
            placedObject.traversalLayer = placementLayer;
            placedObject.level = placementLayer;
            placedObject._renderTraversalLayer = placementLayer;
            placedObject._renderLayerBaseZ = placementLayerBaseZ;
        }
        if (
            placedObject &&
            typeof globalThis !== "undefined" &&
            globalThis.Scripting &&
            typeof globalThis.Scripting.ensureObjectScriptingName === "function"
        ) {
            const targetSectionKey = (
                wizard &&
                wizard.map &&
                typeof wizard.map.getPrototypeSectionKeyForWorldPoint === "function"
            ) ? wizard.map.getPrototypeSectionKeyForWorldPoint(placedObject.x, placedObject.y) : "";
            globalThis.Scripting.ensureObjectScriptingName(placedObject, {
                map: wizard ? wizard.map : null,
                target: placedObject,
                targetSectionKey
            });
        }
        if (
            typeof globalThis !== "undefined" &&
            globalThis.Scripting &&
            typeof globalThis.Scripting.runObjectInitScript === "function"
        ) {
            globalThis.Scripting.runObjectInitScript(
                placedObject,
                (typeof wizard !== "undefined") ? wizard : null,
                { reason: "objectCreated" }
            );
        }
        if (
            placedObject &&
            wizard &&
            wizard.map &&
            wizard.map._prototypeObjectState
        ) {
            if (!(wizard.map._prototypeObjectState.dirtyRuntimeObjects instanceof Set)) {
                wizard.map._prototypeObjectState.dirtyRuntimeObjects = new Set();
            }
            wizard.map._prototypeObjectState.dirtyRuntimeObjects.add(placedObject);
            wizard.map._prototypeObjectState.captureScanNeeded = true;
        }

        this.visible = false;
        this.detachPixiSprite();

        return this;
    }
}


globalThis.PlaceObject = PlaceObject;
