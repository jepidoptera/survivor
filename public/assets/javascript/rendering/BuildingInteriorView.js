(function attachRenderingBuildingInteriorView(global) {
    const BUILDING_INTERIOR_FOREGROUND_Z = 2147483650;
    const BUILDING_INTERIOR_WIZARD_SHADOW_Z = BUILDING_INTERIOR_FOREGROUND_Z - 1;
    const BUILDING_INTERIOR_WIZARD_HAT_Z = BUILDING_INTERIOR_FOREGROUND_Z + 1;

    class RenderingBuildingInteriorView {
        constructor(renderer) {
            if (!renderer) {
                throw new Error("RenderingBuildingInteriorView requires a renderer instance.");
            }
            this.renderer = renderer;
        }

        getPresentationUiState() {
            const r = this.renderer;
            if (r.buildingInteriorPresentationUiState) return r.buildingInteriorPresentationUiState;
            if (typeof global.PIXI === "undefined" || !global.PIXI.State) return null;
            const state = new global.PIXI.State();
            state.depthTest = false;
            state.depthMask = false;
            state.blend = true;
            state.culling = false;
            r.buildingInteriorPresentationUiState = state;
            return state;
        }

        isPresentationActive(ctx = null) {
            const r = this.renderer;
            const state = (ctx && ctx._renderingLayerCutawayState) || r.getLayerCutawayState(ctx);
            const triggers = Array.isArray(state && state.triggers) ? state.triggers : [];
            for (let i = 0; i < triggers.length; i++) {
                if (triggers[i] && triggers[i].activeInteriorRegion) return true;
            }
            return false;
        }

        promoteDisplayObject(displayObj, ctx = null, zIndex = BUILDING_INTERIOR_FOREGROUND_Z) {
            const r = this.renderer;
            if (!displayObj || !this.isPresentationActive(ctx)) return false;
            const ui = r.layers && r.layers.ui ? r.layers.ui : null;
            if (!ui) return false;
            ui.sortableChildren = true;
            if (displayObj.parent !== ui) ui.addChild(displayObj);
            displayObj.zIndex = zIndex;
            const uiState = this.getPresentationUiState();
            if (uiState && Object.prototype.hasOwnProperty.call(displayObj, "state")) {
                displayObj.state = uiState;
            }
            displayObj.visible = true;
            if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                displayObj.renderable = true;
            }
            if (Object.prototype.hasOwnProperty.call(ui, "sortDirty")) ui.sortDirty = true;
            return true;
        }

        promoteForeground(ctx = null) {
            const r = this.renderer;
            if (!this.isPresentationActive(ctx)) return 0;
            const candidates = [];
            const seen = new Set();
            const addCandidate = (obj, zIndex = BUILDING_INTERIOR_FOREGROUND_Z) => {
                if (!obj || seen.has(obj)) return;
                seen.add(obj);
                candidates.push({ obj, zIndex });
            };
            addCandidate(r.wallPlacementPreviewGraphics);
            addCandidate(r.roadPlacementPreviewContainer);
            addCandidate(r.firewallPlacementPreviewGraphics);
            addCandidate(r.triggerAreaPlacementPreviewGraphics);
            addCandidate(r.floorEditorPolygonOverlayGraphics);
            addCandidate(r.placeObjectPreviewDisplayObject);
            addCandidate(r.powerupPlacementPreviewDisplayObject);
            const wizardRef = (ctx && ctx.wizard) || global.wizard || null;
            const shadowProxy = r.wizardShadowProxy || null;
            addCandidate(shadowProxy && shadowProxy._renderingDepthMesh, BUILDING_INTERIOR_WIZARD_SHADOW_Z);
            addCandidate(shadowProxy && shadowProxy.pixiSprite, BUILDING_INTERIOR_WIZARD_SHADOW_Z);
            addCandidate(wizardRef && wizardRef._renderingDepthMesh);
            addCandidate(wizardRef && wizardRef.pixiSprite);
            addCandidate(wizardRef && wizardRef.hatGraphics, BUILDING_INTERIOR_WIZARD_HAT_Z);
            if (r.activeProjectileDisplayObjects instanceof Set) {
                for (const obj of r.activeProjectileDisplayObjects) addCandidate(obj);
            }
            if (r.activePowerupDisplayObjects instanceof Set) {
                for (const obj of r.activePowerupDisplayObjects) addCandidate(obj);
            }
            const picker = r.scenePicker || null;
            if (picker) {
                addCandidate(picker.highlightSprite);
                addCandidate(picker.highlightMesh);
                addCandidate(picker.highlightGraphics);
                addCandidate(picker.pickerGroundHitboxGraphics);
                addCandidate(picker.pickPreviewSprite);
            }
            let promoted = 0;
            for (let i = 0; i < candidates.length; i++) {
                const candidate = candidates[i];
                const obj = candidate && candidate.obj;
                if (!obj || obj.visible === false || obj.renderable === false) continue;
                if (this.promoteDisplayObject(obj, ctx, candidate.zIndex)) promoted += 1;
            }
            const underlays = [
                r.placeObjectPreviewItem && r.placeObjectPreviewItem._compositeUnderlayMesh,
                r.powerupPlacementPreviewItem && r.powerupPlacementPreviewItem._compositeUnderlayMesh
            ];
            for (let i = 0; i < underlays.length; i++) {
                const obj = underlays[i];
                if (!obj || obj.visible === false || obj.renderable === false) continue;
                if (this.promoteDisplayObject(obj, ctx)) promoted += 1;
            }
            r.setFrameMetric("buildingInteriorPresentationForegroundPromoted", promoted);
            return promoted;
        }

        renderActiveOverlay(ctx, cutawayState, container, renderItems = []) {
            const r = this.renderer;
            const triggers = Array.isArray(cutawayState && cutawayState.triggers) ? cutawayState.triggers : [];
            const overlay = r.ensureBuildingInteriorOverlayContainer(container);
            const activeFloorKeys = new Set();
            if (!overlay || triggers.length === 0) {
                r.hideInactiveBuildingInteriorOverlayMeshes(activeFloorKeys);
                r.hideBuildingInteriorOverlayTexture();
                r.setFrameMetric("objects3dBuildingInteriorPromoted", 0);
                return 0;
            }
            let rendered = 0;
            for (let i = 0; i < triggers.length; i++) {
                const trigger = triggers[i];
                const activeRegion = trigger && trigger.activeInteriorRegion;
                const regions = r.getBuildingInteriorOverlayRegionsForTrigger(trigger);
                if (!activeRegion || regions.length === 0) continue;
                for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
                    const region = regions[regionIndex];
                    if (!region) continue;
                    rendered += r.renderBuildingInteriorOverlayFloor(ctx, region, trigger, overlay, activeFloorKeys);
                }
            }
            r.hideInactiveBuildingInteriorOverlayMeshes(activeFloorKeys);
            r.presentBuildingInteriorOverlayTexture(
                ctx,
                overlay,
                container,
                activeFloorKeys.size > 0
            );
            r.setFrameMetric("objects3dBuildingInteriorPromoted", rendered);
            return rendered;
        }
    }

    global.RenderingBuildingInteriorView = RenderingBuildingInteriorView;
})(typeof globalThis !== "undefined" ? globalThis : window);
