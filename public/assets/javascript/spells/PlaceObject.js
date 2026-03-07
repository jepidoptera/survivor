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

    cast(targetX, targetY) {
        const selectedCategory = (
            wizard &&
            typeof wizard.selectedPlaceableCategory === "string" &&
            wizard.selectedPlaceableCategory.length > 0
        ) ? wizard.selectedPlaceableCategory : "doors";
        const selectedCategoryKey = selectedCategory.trim().toLowerCase();

        const wrappedX = (wizard.map && typeof wizard.map.wrapWorldX === "function")
            ? wizard.map.wrapWorldX(targetX)
            : targetX;
        const wrappedY = (wizard.map && typeof wizard.map.wrapWorldY === "function")
            ? wizard.map.wrapWorldY(targetY)
            : targetY;
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
            const candidate = roofCtor.getPlacementCandidate(wizard, wrappedX, wrappedY, { maxDepth: 12 });
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
            if (wizard) {
                wizard.selectedRoofOverhang = roofOverhang;
                wizard.selectedRoofPeakHeight = roofPeakHeight;
            }
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
        const clampedScale = Math.max(0.2, Math.min(5, placeableScale));
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
        const effectiveAnchorX = useWallSnapPlacement ? 0.5 : selectedAnchorX;
        const rawYScale = Number(
            (typeof globalThis !== "undefined" && Number.isFinite(globalThis.xyratio))
                ? globalThis.xyratio
                : 0.66
        );
        const yScale = Math.max(0.1, Math.abs(rawYScale));
        const placementYOffset = (rotationAxis === "spatial" || rotationAxis === "ground")
            ? 0
            : (((selectedAnchorY - 0.5) * clampedScale) / yScale);
        const spatialAnchorPlacementYOffset = (
            rotationAxis === "spatial" &&
            !useWallSnapPlacement &&
            (selectedCategoryKey === "doors" || selectedCategoryKey === "windows")
        )
            ? (((selectedAnchorY - 0.5) * clampedScale) / yScale)
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
            width: clampedScale,
            height: clampedScale,
            placeableAnchorX: effectiveAnchorX,
            placeableAnchorY: selectedAnchorY,
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

        this.visible = false;
        this.detachPixiSprite();

        return this;
    }
}


globalThis.PlaceObject = PlaceObject;
