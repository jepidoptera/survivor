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

function isPlaceObjectDebugLoggingEnabled() {
    if (typeof globalThis === "undefined") return false;
    return globalThis.debugPlaceObjectPlacement === true;
}

function logPlaceObjectDebug(eventName, payload = {}) {
    if (!isPlaceObjectDebugLoggingEnabled()) return;
    const consoleRef = (typeof globalThis !== "undefined" && globalThis.console) ? globalThis.console : console;
    if (!consoleRef || typeof consoleRef.log !== "function") return;
    consoleRef.log("[PlaceObject]", eventName, payload);
}

function describePlaceObjectNode(node) {
    if (!node) return null;
    return {
        xindex: Number.isFinite(node.xindex) ? Number(node.xindex) : node.xindex,
        yindex: Number.isFinite(node.yindex) ? Number(node.yindex) : node.yindex,
        x: Number.isFinite(node.x) ? Number(node.x) : node.x,
        y: Number.isFinite(node.y) ? Number(node.y) : node.y,
        traversalLayer: Number.isFinite(node.traversalLayer) ? Number(node.traversalLayer) : node.traversalLayer,
        level: Number.isFinite(node.level) ? Number(node.level) : node.level,
        baseZ: Number.isFinite(node.baseZ) ? Number(node.baseZ) : node.baseZ,
        surfaceId: typeof node.surfaceId === "string" ? node.surfaceId : "",
        fragmentId: typeof node.fragmentId === "string" ? node.fragmentId : "",
        ownerSectionKey: typeof node.ownerSectionKey === "string" ? node.ownerSectionKey : "",
        prototypeSectionKey: typeof node._prototypeSectionKey === "string" ? node._prototypeSectionKey : "",
        sourcePrototypeSectionKey: node.sourceNode && typeof node.sourceNode._prototypeSectionKey === "string"
            ? node.sourceNode._prototypeSectionKey
            : ""
    };
}

function resolveEditorLayerInfo(wizardRef) {
    return resolvePlaceObjectLayerInfo(wizardRef);
}

function resolvePlaceObjectWorldPointOnLayer(wizardRef, fallbackX, fallbackY, options = {}) {
    const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
    const visibleTargetFn = (typeof globalThis !== "undefined" && typeof globalThis.resolveEditorPlacementTarget === "function")
        ? globalThis.resolveEditorPlacementTarget
        : null;
    if (visibleTargetFn && !(options && options.useVisibleFloorTarget === false)) {
        const target = visibleTargetFn(wizardRef, fallbackX, fallbackY, options);
        if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
            return target;
        }
    }
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
    if (!mapRef || typeof mapRef.worldToNode !== "function") {
        logPlaceObjectDebug("resolve-node-abort-no-map", {
            hasMap: !!mapRef,
            hasWorldToNode: !!(mapRef && typeof mapRef.worldToNode === "function"),
            worldX,
            worldY,
            layer
        });
        return null;
    }
    const baseNode = mapRef.worldToNode(worldX, worldY);
    if (!baseNode) {
        logPlaceObjectDebug("resolve-node-abort-no-base-node", {
            worldX,
            worldY,
            layer
        });
        return null;
    }
    const targetLayer = Number.isFinite(layer) ? Math.round(Number(layer)) : 0;
    if (targetLayer === 0) {
        logPlaceObjectDebug("resolve-node-layer-0", {
            worldX,
            worldY,
            targetLayer,
            baseNode: describePlaceObjectNode(baseNode)
        });
        return baseNode;
    }
    if (typeof mapRef.getFloorNodeAtLayer !== "function") {
        logPlaceObjectDebug("resolve-node-abort-no-floor-lookup", {
            worldX,
            worldY,
            targetLayer,
            baseNode: describePlaceObjectNode(baseNode)
        });
        return null;
    }
    const sectionKey = (typeof (options && options.sectionKey) === "string" && options.sectionKey.length > 0)
        ? options.sectionKey
        : (typeof baseNode._prototypeSectionKey === "string"
            ? baseNode._prototypeSectionKey
            : ((typeof mapRef.getPrototypeSectionKeyForWorldPoint === "function")
                ? mapRef.getPrototypeSectionKeyForWorldPoint(worldX, worldY)
                : ""));
    const resolvedNode = mapRef.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, targetLayer, {
        sectionKey,
        surfaceId: typeof (options && options.surfaceId) === "string" ? options.surfaceId : "",
        fragmentId: typeof (options && options.fragmentId) === "string" ? options.fragmentId : "",
        sourceNode: baseNode,
        worldX,
        worldY,
        allowScan: !(options && options.allowScan === false)
    });
    logPlaceObjectDebug("resolve-node-floor-lookup", {
        worldX,
        worldY,
        targetLayer,
        sectionKey,
        allowScan: !(options && options.allowScan === false),
        baseNode: describePlaceObjectNode(baseNode),
        resultNode: describePlaceObjectNode(resolvedNode)
    });
    return resolvedNode;
}

function getEditorPlacementFloorFragment(mapRef, placementTarget) {
    const floorSupportApi = (typeof globalThis !== "undefined") ? globalThis.FloorSupport : null;
    if (floorSupportApi && typeof floorSupportApi.getPlacementTargetFragment === "function") {
        return floorSupportApi.getPlacementTargetFragment(mapRef, placementTarget);
    }
    const floorTarget = placementTarget && placementTarget.floorTarget && typeof placementTarget.floorTarget === "object"
        ? placementTarget.floorTarget
        : null;
    if (floorTarget && floorTarget.fragment && typeof floorTarget.fragment === "object") {
        return floorTarget.fragment;
    }
    const fragmentId = typeof placementTarget?.fragmentId === "string" && placementTarget.fragmentId.length > 0
        ? placementTarget.fragmentId
        : (floorTarget && floorTarget.fragment && typeof floorTarget.fragment.fragmentId === "string"
            ? floorTarget.fragment.fragmentId
            : "");
    if (fragmentId && mapRef && mapRef.floorsById instanceof Map) {
        return mapRef.floorsById.get(fragmentId) || null;
    }
    return null;
}

function isPrototypeBuildingPlacementFloorFragment(fragment) {
    const floorSupportApi = (typeof globalThis !== "undefined") ? globalThis.FloorSupport : null;
    if (floorSupportApi && typeof floorSupportApi.isPrototypeBuildingPlacementFloorFragment === "function") {
        return floorSupportApi.isPrototypeBuildingPlacementFloorFragment(fragment);
    }
    if (!fragment || typeof fragment !== "object") return false;
    const ownerType = typeof fragment.ownerType === "string" ? fragment.ownerType : "";
    const ownerId = typeof fragment.ownerId === "string" ? fragment.ownerId : "";
    return ownerType === "building" && ownerId.length > 0 && fragment.renderedByBuildingCutaway === true;
}

function shouldAddPlacedObjectToFloorBuildingManifest(mapRef, placedObject, placementTarget) {
    if (!mapRef || !placedObject || typeof placedObject !== "object") return false;
    const fragment = getEditorPlacementFloorFragment(mapRef, placementTarget) || (() => {
        const fragmentId = typeof placedObject.fragmentId === "string" && placedObject.fragmentId.length > 0
            ? placedObject.fragmentId
            : (typeof placedObject.node?.fragmentId === "string" ? placedObject.node.fragmentId : "");
        return fragmentId && mapRef.floorsById instanceof Map ? mapRef.floorsById.get(fragmentId) || null : null;
    })();
    return !isPrototypeBuildingPlacementFloorFragment(fragment);
}

function invalidatePlacedObjectPrototypeBuildingInteriorBitmap(mapRef, placedObject) {
    if (!mapRef || !placedObject || typeof placedObject !== "object") return false;
    const membership = placedObject._floorMembership && typeof placedObject._floorMembership === "object"
        ? placedObject._floorMembership
        : (placedObject.floorMembership && typeof placedObject.floorMembership === "object" ? placedObject.floorMembership : null);
    if (
        !membership ||
        membership.ownerType !== "building" ||
        typeof membership.ownerId !== "string" ||
        membership.ownerId.length === 0 ||
        typeof membership.floorId !== "string" ||
        membership.floorId.length === 0
    ) {
        return false;
    }
    if (typeof mapRef.invalidatePrototypeBuildingInteriorBitmap !== "function") {
        if (mapRef._prototypeBuildingState) {
            throw new Error(`placed object on ${membership.ownerId} floor ${membership.floorId} cannot invalidate missing prototype interior bitmap cache API`);
        }
        return false;
    }
    mapRef.invalidatePrototypeBuildingInteriorBitmap({
        placementId: membership.ownerId,
        floorId: membership.floorId
    });
    return true;
}

function applyEditorPlacementSupport(entity, mapRef, placementTarget, placementNode = null, options = {}) {
    if (!entity || !placementTarget || typeof placementTarget !== "object") return null;
    const opts = (options && typeof options === "object") ? options : {};
    const stampPrototypeBuildingOwner = (support) => {
        if (
            !support ||
            support.ownerType !== "building" ||
            typeof support.ownerId !== "string" ||
            support.ownerId.length === 0
        ) {
            return;
        }
        entity._prototypeOwnerType = "building";
        entity._prototypeOwnerId = support.ownerId;
        entity._prototypeOwnerSectionKey = "";
        entity._prototypeOwnerSignature = `building:${support.ownerId}`;
    };
    const stampFloorMembership = (support) => {
        const floorSupportApi = (typeof globalThis !== "undefined") ? globalThis.FloorSupport : null;
        const membership = support && support.floorMembership
            ? support.floorMembership
            : (floorSupportApi && typeof floorSupportApi.createFloorMembership === "function"
                ? floorSupportApi.createFloorMembership({
                    layer,
                    fragment,
                    fragmentId,
                    surfaceId,
                    ownerType: support && support.ownerType,
                    ownerId: support && support.ownerId,
                    sectionKey: support && support.sectionKey
                })
                : null);
        if (membership && floorSupportApi && typeof floorSupportApi.stampEntityFloorMembership === "function") {
            floorSupportApi.stampEntityFloorMembership(entity, membership);
        } else if (membership) {
            entity._floorMembership = { ...membership };
        }
        return membership;
    };
    const layer = Number.isFinite(placementTarget.layer) ? Math.round(Number(placementTarget.layer)) : 0;
    const baseZ = Number.isFinite(placementTarget.baseZ) ? Number(placementTarget.baseZ) : layer * 3;
    const floorTarget = placementTarget.floorTarget && typeof placementTarget.floorTarget === "object"
        ? placementTarget.floorTarget
        : null;
    const fragment = getEditorPlacementFloorFragment(mapRef, placementTarget);
    const node = placementNode || placementTarget.node || null;
    const fragmentId = typeof (fragment && fragment.fragmentId) === "string"
        ? fragment.fragmentId
        : (typeof node?.fragmentId === "string" ? node.fragmentId : "");
    const surfaceId = typeof (fragment && fragment.surfaceId) === "string"
        ? fragment.surfaceId
        : (typeof node?.surfaceId === "string" ? node.surfaceId : "");
    const hasFloorSupport = !!(fragment || floorTarget || layer !== 0);
    if (mapRef && typeof mapRef.setActorCurrentMovementSupport === "function") {
        const floorSupportApi = (typeof globalThis !== "undefined") ? globalThis.FloorSupport : null;
        const support = hasFloorSupport && floorSupportApi && typeof floorSupportApi.createFloorSupport === "function"
            ? floorSupportApi.createFloorSupport({ layer, baseZ, fragment, fragmentId, surfaceId, node })
            : (hasFloorSupport ? {
                type: "floor",
                layer,
                baseZ,
                fragment,
                fragmentId,
                surfaceId,
                node
            } : {
                type: "ground",
                layer: 0,
                baseZ: 0,
                node
            });
        const appliedSupport = mapRef.setActorCurrentMovementSupport(entity, support, {
            suppressLayerTransition: true
        });
        stampFloorMembership(appliedSupport || support);
        stampPrototypeBuildingOwner(appliedSupport);
        if (opts.useLocalZ === true) {
            entity.z = Number.isFinite(opts.localZ) ? Number(opts.localZ) : 0;
        }
        return appliedSupport;
    }
    if (node) entity.node = node;
    entity.currentLayer = layer;
    entity.traversalLayer = layer;
    entity.currentLayerBaseZ = baseZ;
    if (surfaceId) entity.surfaceId = surfaceId;
    if (fragmentId) entity.fragmentId = fragmentId;
    if (hasFloorSupport) {
        entity.currentMovementSupport = {
            type: "floor",
            layer,
            baseZ,
            fragmentId,
            surfaceId,
            ownerType: typeof fragment?.ownerType === "string" ? fragment.ownerType : "",
            ownerId: typeof fragment?.ownerId === "string" ? fragment.ownerId : "",
            sectionKey: typeof fragment?.ownerSectionKey === "string" ? fragment.ownerSectionKey : "",
            nodeId: node && typeof node.id === "string" ? node.id : ""
        };
        stampFloorMembership(entity.currentMovementSupport);
        if (opts.useLocalZ === true) {
            entity.z = Number.isFinite(opts.localZ) ? Number(opts.localZ) : 0;
        } else if (!Number.isFinite(entity.z)) {
            entity.z = baseZ;
        }
        stampPrototypeBuildingOwner(entity.currentMovementSupport);
    } else {
        entity.currentMovementSupport = { type: "ground", layer: 0, baseZ: 0 };
        if (!Number.isFinite(entity.z) || opts.useLocalZ === true) entity.z = Number.isFinite(opts.localZ) ? Number(opts.localZ) : 0;
    }
    return entity.currentMovementSupport;
}

if (typeof globalThis !== "undefined") {
    globalThis.applyEditorPlacementSupport = applyEditorPlacementSupport;
    globalThis.describePlaceObjectNode = describePlaceObjectNode;
    globalThis.getEditorPlacementFloorFragment = getEditorPlacementFloorFragment;
    globalThis.invalidatePlacedObjectPrototypeBuildingInteriorBitmap = invalidatePlacedObjectPrototypeBuildingInteriorBitmap;
    globalThis.isPrototypeBuildingPlacementFloorFragment = isPrototypeBuildingPlacementFloorFragment;
    globalThis.logPlaceObjectDebug = logPlaceObjectDebug;
    globalThis.resolveEditorLayerInfo = resolveEditorLayerInfo;
    globalThis.resolveEditorWorldPointOnLayer = resolveEditorWorldPointOnLayer;
    globalThis.shouldAddPlacedObjectToFloorBuildingManifest = shouldAddPlacedObjectToFloorBuildingManifest;
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
        logPlaceObjectDebug("cast-start", {
            selectedCategory,
            selectedCategoryKey,
            targetX,
            targetY,
            options: {
                screenX: Number.isFinite(options && options.screenX) ? Number(options.screenX) : null,
                screenY: Number.isFinite(options && options.screenY) ? Number(options.screenY) : null
            },
            wizard: wizard ? {
                x: Number.isFinite(wizard.x) ? Number(wizard.x) : wizard.x,
                y: Number.isFinite(wizard.y) ? Number(wizard.y) : wizard.y,
                currentLayer: Number.isFinite(wizard.currentLayer) ? Number(wizard.currentLayer) : wizard.currentLayer,
                selectedFloorEditLevel: Number.isFinite(wizard.selectedFloorEditLevel) ? Number(wizard.selectedFloorEditLevel) : wizard.selectedFloorEditLevel,
                traversalLayer: Number.isFinite(wizard.traversalLayer) ? Number(wizard.traversalLayer) : wizard.traversalLayer,
                currentLayerBaseZ: Number.isFinite(wizard.currentLayerBaseZ) ? Number(wizard.currentLayerBaseZ) : wizard.currentLayerBaseZ
            } : null,
            layerPoint
        });

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
            if (wizard.map && typeof wizard.map.markBuildingRenderCacheDirty === "function") {
                wizard.map.markBuildingRenderCacheDirty();
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
        const placementNode = (
            wizard &&
            wizard.map &&
            typeof resolveEditorNodeOnLayer === "function"
        ) ? resolveEditorNodeOnLayer(wizard.map, placedX, placedY, placementLayer, {
            allowScan: true,
            sectionKey: typeof layerPoint.sectionKey === "string"
                ? layerPoint.sectionKey
                : (typeof layerPoint.floorTarget?.fragment?.ownerSectionKey === "string" ? layerPoint.floorTarget.fragment.ownerSectionKey : ""),
            fragmentId: typeof layerPoint.fragmentId === "string"
                ? layerPoint.fragmentId
                : (typeof layerPoint.floorTarget?.fragment?.fragmentId === "string" ? layerPoint.floorTarget.fragment.fragmentId : ""),
            surfaceId: typeof layerPoint.surfaceId === "string"
                ? layerPoint.surfaceId
                : (typeof layerPoint.floorTarget?.fragment?.surfaceId === "string" ? layerPoint.floorTarget.fragment.surfaceId : "")
        }) : null;
        logPlaceObjectDebug("placement-target", {
            selectedCategory,
            selectedTexturePath,
            wrappedX,
            wrappedY,
            placedX,
            placedY,
            placementLayer,
            placementLayerBaseZ,
            rotationAxis,
            useWallSnapPlacement,
            wallSnapPlacement: wallSnapPlacement ? {
                hasTargetWall: !!wallSnapPlacement.targetWall,
                snappedX: Number.isFinite(wallSnapPlacement.snappedX) ? Number(wallSnapPlacement.snappedX) : wallSnapPlacement.snappedX,
                snappedY: Number.isFinite(wallSnapPlacement.snappedY) ? Number(wallSnapPlacement.snappedY) : wallSnapPlacement.snappedY,
                snappedZ: Number.isFinite(wallSnapPlacement.snappedZ) ? Number(wallSnapPlacement.snappedZ) : wallSnapPlacement.snappedZ,
                mountedSectionId: Number.isInteger(wallSnapPlacement.mountedSectionId) ? Number(wallSnapPlacement.mountedSectionId) : null,
                mountedWallSectionUnitId: Number.isInteger(wallSnapPlacement.mountedWallSectionUnitId) ? Number(wallSnapPlacement.mountedWallSectionUnitId) : null
            } : null,
            placementNode: describePlaceObjectNode(placementNode)
        });

        const resolvedPlacementRotation = (
            useWallSnapPlacement &&
            Number.isFinite(wallSnapPlacement.snappedRotationDeg)
        ) ? Number(wallSnapPlacement.snappedRotationDeg) : effectivePlacementRotation;

        const placementLocation = {
            x: placedX,
            y: placedY,
            surfaceId: typeof placementNode?.surfaceId === "string" ? placementNode.surfaceId : "",
            fragmentId: typeof placementNode?.fragmentId === "string" ? placementNode.fragmentId : ""
        };
        const placedObject = new PlacedObject(placementLocation, wizard.map, {
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
        if (placedObject && isPlaceObjectDebugLoggingEnabled()) {
            const debugNow = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                ? performance.now()
                : Date.now();
            placedObject._placeObjectDebugId = `placed-${Math.round(debugNow)}-${Math.floor(Math.random() * 100000)}`;
            placedObject._placeObjectDebugTraceUntilMs = debugNow + 5000;
        }
        if (placedObject) {
            if (typeof applyEditorPlacementSupport === "function") {
                applyEditorPlacementSupport(placedObject, wizard.map || null, layerPoint, placementNode, {
                    useLocalZ: !useWallSnapPlacement,
                    localZ: 0
                });
            }
            if (
                useWallSnapPlacement &&
                Number.isFinite(wallSnapPlacement.snappedZ)
            ) {
                placedObject.z = Number(wallSnapPlacement.snappedZ);
            }
            placedObject.traversalLayer = placementLayer;
            placedObject.level = placementLayer;
            placedObject._renderLayerBaseZ = placementLayerBaseZ;
            if (placementNode) {
                placedObject.node = placementNode;
                placedObject.surfaceId = typeof placementNode.surfaceId === "string" ? placementNode.surfaceId : "";
                placedObject.fragmentId = typeof placementNode.fragmentId === "string" ? placementNode.fragmentId : "";
            }
            if (
                placedObject._floorMembership &&
                wizard.map &&
                typeof wizard.map.registerFloorObject === "function"
            ) {
                wizard.map.registerFloorObject(placedObject);
            }
            invalidatePlacedObjectPrototypeBuildingInteriorBitmap(wizard.map || null, placedObject);
        }
        logPlaceObjectDebug("object-created", {
            created: !!placedObject,
            category: selectedCategory,
            texturePath: selectedTexturePath,
            object: placedObject ? {
                x: Number.isFinite(placedObject.x) ? Number(placedObject.x) : placedObject.x,
                y: Number.isFinite(placedObject.y) ? Number(placedObject.y) : placedObject.y,
                z: Number.isFinite(placedObject.z) ? Number(placedObject.z) : placedObject.z,
                traversalLayer: Number.isFinite(placedObject.traversalLayer) ? Number(placedObject.traversalLayer) : placedObject.traversalLayer,
                level: Number.isFinite(placedObject.level) ? Number(placedObject.level) : placedObject.level,
                renderLayerBaseZ: Number.isFinite(placedObject._renderLayerBaseZ) ? Number(placedObject._renderLayerBaseZ) : placedObject._renderLayerBaseZ,
                surfaceId: typeof placedObject.surfaceId === "string" ? placedObject.surfaceId : "",
                fragmentId: typeof placedObject.fragmentId === "string" ? placedObject.fragmentId : "",
                gone: !!placedObject.gone,
                node: describePlaceObjectNode(placedObject.node)
            } : null,
            mapObjectsLength: wizard && wizard.map && Array.isArray(wizard.map.objects) ? wizard.map.objects.length : null,
            prototypeDirty: !!(placedObject && placedObject._prototypeDirty),
            captureScanNeeded: !!(wizard && wizard.map && wizard.map._prototypeObjectState && wizard.map._prototypeObjectState.captureScanNeeded)
        });
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
        if (
            placedObject &&
            wizard &&
            wizard.map &&
            typeof wizard.map.addObjectToFloorBuildingManifest === "function" &&
            shouldAddPlacedObjectToFloorBuildingManifest(wizard.map, placedObject, layerPoint)
        ) {
            wizard.map.addObjectToFloorBuildingManifest(placedObject, {
                fragmentId: placedObject.fragmentId,
                surfaceId: placedObject.surfaceId,
                level: placementLayer
            });
        }
        if (placedObject && wizard && wizard.map && typeof wizard.map.markBuildingRenderCacheDirty === "function") {
            wizard.map.markBuildingRenderCacheDirty();
        }
        logPlaceObjectDebug("cast-finish", {
            created: !!placedObject,
            category: selectedCategory,
            texturePath: selectedTexturePath,
            node: placedObject ? describePlaceObjectNode(placedObject.node) : null,
            traversalLayer: placedObject && Number.isFinite(placedObject.traversalLayer) ? Number(placedObject.traversalLayer) : (placedObject ? placedObject.traversalLayer : null),
            level: placedObject && Number.isFinite(placedObject.level) ? Number(placedObject.level) : (placedObject ? placedObject.level : null),
            surfaceId: placedObject && typeof placedObject.surfaceId === "string" ? placedObject.surfaceId : "",
            fragmentId: placedObject && typeof placedObject.fragmentId === "string" ? placedObject.fragmentId : "",
            prototypeDirty: !!(placedObject && placedObject._prototypeDirty),
            captureScanNeeded: !!(wizard && wizard.map && wizard.map._prototypeObjectState && wizard.map._prototypeObjectState.captureScanNeeded),
            dirtyRuntimeObjectsSize: (
                wizard &&
                wizard.map &&
                wizard.map._prototypeObjectState &&
                wizard.map._prototypeObjectState.dirtyRuntimeObjects instanceof Set
            ) ? wizard.map._prototypeObjectState.dirtyRuntimeObjects.size : null
        });

        this.visible = false;
        this.detachPixiSprite();

        return this;
    }
}


globalThis.PlaceObject = PlaceObject;
