import {
    addFloor,
    createEmptyBuilding,
    createFloor,
    createPerimeterWallsForFloor,
    createWall,
    createWallMountedObject,
    DEFAULTS,
    duplicateFloor,
    fallbackDeletedVertexEndpointsToPoint,
    findFloor,
    findMountedObject,
    findWall,
    getBuildingMountedObjects,
    getBuildingFloors,
    getBuildingWalls,
    getFloorElevation,
    getFloorId,
    normalizeImportedBuilding,
    replaceFloorShape,
    refreshWallSectionEndpoints,
    serializeBuilding,
    setFloorElevation,
    wallPoints
} from "./BuildingModel.js";
import { distance, distanceToSegment, nearestFloorVertex, nearestWall, pointInPolygon, repairSimplePolygonRing, simplePolygonRingError } from "./BuildingGeometry.js";
import { polygonCentroid } from "./BuildingGeometry.js";
import { validateBuilding } from "./BuildingValidation.js";
import { nearestHexAnchor, snapToHexAnchor } from "./BuildingHexGrid.js";
import {
    applyFloorPolygonEdit,
    findRingEdgeAtPoint,
    findRingVertexAtPoint,
    getFloorRing,
    insertVertexNearSelectedNeighbor,
    insertVertexOnRingEdge,
    ringsForFloor,
    setFloorRing
} from "./BuildingPolygonEditing.js";

const STORAGE_KEY = "survivor-building-editor-current";
const MOUNTED_OBJECT_TOOL_STORAGE_KEY = "survivor-building-editor-mounted-object-tools";
const CORRUPT_SAVE_BACKUP_KEY_PREFIX = `${STORAGE_KEY}-corrupt-backup`;
const STACKED_VERTEX_TOLERANCE = 0.0001;

function closestPointOnSegment(point, a, b) {
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return { x: Number(a.x), y: Number(a.y) };
    const t = Math.max(0, Math.min(1, ((Number(point.x) - Number(a.x)) * dx + (Number(point.y) - Number(a.y)) * dy) / lengthSquared));
    return {
        x: Number(a.x) + t * dx,
        y: Number(a.y) + t * dy
    };
}

function pointIsNearSegmentEndpoint(point, a, b, threshold) {
    return distance(point, a) <= threshold || distance(point, b) <= threshold;
}

function sameXY(a, b, tolerance = STACKED_VERTEX_TOLERANCE) {
    return Math.abs(Number(a && a.x) - Number(b && b.x)) <= tolerance &&
        Math.abs(Number(a && a.y) - Number(b && b.y)) <= tolerance;
}

function previousRingIndex(ring, index) {
    return (Math.floor(Number(index)) - 1 + ring.length) % ring.length;
}

function nextRingIndex(ring, index) {
    return (Math.floor(Number(index)) + 1) % ring.length;
}

function findMatchingDirectedEdgeIndex(ring, startPoint, endPoint) {
    if (!Array.isArray(ring) || ring.length < 3) return -1;
    for (let index = 0; index < ring.length; index++) {
        const next = ring[(index + 1) % ring.length];
        if (sameXY(ring[index], startPoint) && sameXY(next, endPoint)) return index;
    }
    return -1;
}

function findMatchingVertexWithNeighbors(ring, previousPoint, vertexPoint, nextPoint) {
    if (!Array.isArray(ring) || ring.length < 4) return -1;
    for (let index = 0; index < ring.length; index++) {
        if (
            sameXY(ring[index], vertexPoint) &&
            sameXY(ring[previousRingIndex(ring, index)], previousPoint) &&
            sameXY(ring[nextRingIndex(ring, index)], nextPoint)
        ) {
            return index;
        }
    }
    return -1;
}

function cloneEndpoint(endpoint) {
    return JSON.parse(JSON.stringify(endpoint));
}

function pointEndpoint(point) {
    return {
        kind: "point",
        x: Number(point.x),
        y: Number(point.y)
    };
}

function endpointIsFinite(endpoint) {
    return Number.isFinite(Number(endpoint && endpoint.x)) && Number.isFinite(Number(endpoint && endpoint.y));
}

function syncWallLineBoundaryAttachment(wall) {
    const hasEdgeEndpoint = (wall.startPoint && wall.startPoint.kind === "edge") || (wall.endPoint && wall.endPoint.kind === "edge");
    if (!hasEdgeEndpoint) {
        wall.attachment = null;
        return;
    }
    if (!endpointIsFinite(wall.startPoint) || !endpointIsFinite(wall.endPoint)) {
        throw new Error(`cannot update wall ${wall.id} edge attachment without finite endpoints`);
    }
    wall.attachment = {
        kind: "lineBoundaryClip",
        fragmentId: wall.fragmentId || wall.floorId,
        linePoint: { x: Number(wall.startPoint.x), y: Number(wall.startPoint.y) },
        lineVector: {
            x: Number(wall.endPoint.x) - Number(wall.startPoint.x),
            y: Number(wall.endPoint.y) - Number(wall.startPoint.y)
        }
    };
}

function createSelection(kind, fields = {}) {
    const wallIds = Array.isArray(fields.wallIds)
        ? fields.wallIds.map((id) => Number.isFinite(Number(id)) ? Number(id) : String(id))
        : (fields.wallId !== undefined && fields.wallId !== null ? [fields.wallId] : []);
    const wallId = fields.wallId !== undefined && fields.wallId !== null
        ? fields.wallId
        : (wallIds.length === 1 ? wallIds[0] : null);
    const mountedObjectIds = Array.isArray(fields.mountedObjectIds)
        ? fields.mountedObjectIds.map((id) => Number.isFinite(Number(id)) ? Number(id) : String(id))
        : (fields.mountedObjectId !== undefined && fields.mountedObjectId !== null ? [fields.mountedObjectId] : []);
    const mountedObjectId = fields.mountedObjectId !== undefined && fields.mountedObjectId !== null
        ? fields.mountedObjectId
        : (mountedObjectIds.length === 1 ? mountedObjectIds[0] : null);
    const floorId = fields.floorId !== undefined && fields.floorId !== null
        ? String(fields.floorId)
        : (fields.levelId !== undefined && fields.levelId !== null ? String(fields.levelId) : null);
    return {
        kind,
        floorId,
        levelId: floorId,
        wallId,
        wallIds,
        mountedObjectId,
        mountedObjectIds,
        wallEndpointKey: fields.wallEndpointKey || null,
        ringKind: fields.ringKind || null,
        holeIndex: Number.isFinite(Number(fields.holeIndex)) ? Number(fields.holeIndex) : -1,
        vertexIndex: Number.isFinite(Number(fields.vertexIndex)) ? Number(fields.vertexIndex) : -1
    };
}

export class BuildingEditorState extends EventTarget {
    constructor() {
        super();
        this.building = createEmptyBuilding();
        this.tool = "select";
        this.selectedFloorIds = new Set();
        this.layerSelectionMode = "floor";
        this.selection = createSelection("building");
        this.snapToGrid = true;
        this.showSnapAnchors = false;
        this.shiftKeyDown = false;
        this.paintTextures = {
            floor: DEFAULTS.floorTexture,
            roofs: DEFAULTS.roofTexture,
            walls: DEFAULTS.wallTexture
        };
        this.mountedObjectTool = {
            category: "doors",
            assets: {
                doors: null,
                windows: null
            },
            settings: {
                doors: { size: 1, aspectRatio: 0.75 },
                windows: { size: 1, aspectRatio: 1 }
            }
        };
        this.gridSize = DEFAULTS.gridSize;
        this.camera = { x: 0, y: 0, z: 0, zoom: 72, rotation: 0, rotationCenter: { x: 0, y: 0 } };
        this.draft = null;
        this.floorVertexDrag = null;
        this.hoverWorldPoint = null;
        this.renderError = "";
        this.inputs = {
            floorElevation: 0,
            floorHeight: DEFAULTS.wallHeight,
            floorTexture: DEFAULTS.floorTexture,
            roofTexture: DEFAULTS.roofTexture,
            roofOverhang: DEFAULTS.roofOverhang,
            roofPeakHeight: DEFAULTS.roofPeakHeight,
            wallHeight: DEFAULTS.wallHeight,
            wallTexture: DEFAULTS.wallTexture
        };
        this.createStarterFloor();
    }

    createStarterFloor() {
        const floor = createFloor({
            elevation: 0,
            footprint: [
                { x: -2.598, y: -1.5 },
                { x: 2.598, y: -1.5 },
                { x: 2.598, y: 1.5 },
                { x: -2.598, y: 1.5 }
            ],
            defaultWallHeight: 3,
            createPerimeterWalls: true
        });
        addFloor(this.building, floor);
        this.selectFloor(getFloorId(floor));
    }

    emitChange() {
        this.dispatchEvent(new CustomEvent("change"));
    }

    setTool(tool) {
        this.tool = tool;
        this.draft = null;
        this.emitChange();
    }

    clearSelectionForTool() {
        const floors = getBuildingFloors(this.building);
        if (this.layerSelectionMode === "all" || this.selectedFloorIds.size !== 1) {
            this.selection = createSelection("building");
            this.syncInputsFromFloor(floors[0] || null);
            return;
        }
        const selectedFloorId = [...this.selectedFloorIds][0];
        const floor = findFloor(this.building, selectedFloorId);
        if (!floor) {
            this.selection = createSelection("building");
            this.syncInputsFromFloor(floors[0] || null);
            return;
        }
        this.selection = createSelection("level", { floorId: getFloorId(floor) });
        this.syncInputsFromFloor(floor);
    }

    paintTextureForMode(mode) {
        if (mode === "walls") return this.paintTextures.walls;
        if (mode === "roofs") return this.paintTextures.roofs;
        return this.paintTextures.floor;
    }

    setPaintTexture(mode, texture) {
        if (typeof texture !== "string" || texture.length === 0) {
            throw new Error("paint texture path must be a non-empty string");
        }
        if (mode === "walls") this.paintTextures.walls = texture;
        else if (mode === "roofs") this.paintTextures.roofs = texture;
        else this.paintTextures.floor = texture;
        this.emitChange();
    }

    setMountedObjectToolCategory(category) {
        const resolved = String(category || "").trim().toLowerCase();
        if (resolved !== "doors" && resolved !== "windows") {
            throw new Error(`unknown mounted object category: ${category}`);
        }
        const selectedObject = this.selectedMountedObject();
        if (selectedObject && String(selectedObject.category || "").trim().toLowerCase() === resolved) {
            this.copyMountedObjectToTool(selectedObject);
        }
        this.mountedObjectTool.category = resolved;
        this.tool = "mountObject";
        this.draft = null;
        this.clearSelectionForTool();
        this.saveMountedObjectToolSettingsToBrowser();
        this.emitChange();
    }

    copyMountedObjectToTool(object) {
        if (!object) throw new Error("cannot copy missing mounted object to tool");
        const category = String(object.category || "").trim().toLowerCase();
        if (category !== "doors" && category !== "windows") {
            throw new Error(`cannot copy mounted object category to tool: ${category || "missing"}`);
        }
        const width = Number(object.width);
        const height = Number(object.height);
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
            throw new Error("cannot copy door/window tool settings without positive width and height");
        }
        if (typeof object.texturePath !== "string" || object.texturePath.length === 0) {
            throw new Error("cannot copy door/window tool settings without a texture path");
        }
        this.mountedObjectTool.assets[category] = {
            ...object,
            category,
            texturePath: object.texturePath,
            width,
            height,
            baseWidth: width,
            baseHeight: height,
            anchorX: Number.isFinite(Number(object.placeableAnchorX ?? object.anchorX))
                ? Number(object.placeableAnchorX ?? object.anchorX)
                : 0.5,
            anchorY: Number.isFinite(Number(object.placeableAnchorY ?? object.anchorY))
                ? Number(object.placeableAnchorY ?? object.anchorY)
                : (category === "windows" ? 0.5 : 1)
        };
        this.mountedObjectTool.settings[category] = {
            size: height,
            aspectRatio: width / height
        };
    }

    setMountedObjectAsset(category, asset) {
        const resolved = String(category || "").trim().toLowerCase();
        if (resolved !== "doors" && resolved !== "windows") {
            throw new Error(`unknown mounted object category: ${category}`);
        }
        if (!asset || typeof asset.texturePath !== "string" || asset.texturePath.length === 0) {
            throw new Error("mounted object asset requires a texture path");
        }
        const width = Number(asset.width);
        const height = Number(asset.height);
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
            throw new Error("mounted object asset requires positive width and height");
        }
        this.mountedObjectTool.category = resolved;
        this.mountedObjectTool.assets[resolved] = { ...asset, category: resolved, baseWidth: width, baseHeight: height };
        this.mountedObjectTool.settings[resolved] = {
            size: height,
            aspectRatio: width / height
        };
        this.tool = "mountObject";
        this.draft = null;
        this.clearSelectionForTool();
        this.saveMountedObjectToolSettingsToBrowser();
        this.emitChange();
    }

    updateMountedObjectSize(value) {
        const selectedObjects = this.selectedMountedObjects();
        if (this.tool !== "mountObject" && selectedObjects.length > 0) {
            const size = Number(value);
            if (!Number.isFinite(size) || size <= 0) {
                throw new Error("door/window size must be a positive number");
            }
            selectedObjects.forEach((object) => {
                const currentHeight = Number(object.height);
                const currentWidth = Number(object.width);
                const aspectRatio = Number.isFinite(currentWidth) && currentWidth > 0 && Number.isFinite(currentHeight) && currentHeight > 0
                    ? currentWidth / currentHeight
                    : 1;
                object.height = size;
                object.width = size * aspectRatio;
            });
            this.emitChange();
            return;
        }
        const category = this.mountedObjectTool.category || "doors";
        const size = Number(value);
        if (!Number.isFinite(size) || size <= 0) {
            throw new Error("door/window size must be a positive number");
        }
        this.mountedObjectTool.settings[category] = {
            ...(this.mountedObjectTool.settings[category] || {}),
            size
        };
        this.saveMountedObjectToolSettingsToBrowser();
        this.emitChange();
    }

    updateMountedObjectAspectRatio(value) {
        const selectedObjects = this.selectedMountedObjects();
        if (this.tool !== "mountObject" && selectedObjects.length > 0) {
            const aspectRatio = Number(value);
            if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
                throw new Error("door/window aspect ratio must be a positive number");
            }
            selectedObjects.forEach((object) => {
                const height = Number(object.height);
                if (!Number.isFinite(height) || height <= 0) {
                    throw new Error("selected door/window height must be a positive number");
                }
                object.width = height * aspectRatio;
            });
            this.emitChange();
            return;
        }
        const category = this.mountedObjectTool.category || "doors";
        const aspectRatio = Number(value);
        if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
            throw new Error("door/window aspect ratio must be a positive number");
        }
        this.mountedObjectTool.settings[category] = {
            ...(this.mountedObjectTool.settings[category] || {}),
            aspectRatio
        };
        this.saveMountedObjectToolSettingsToBrowser();
        this.emitChange();
    }

    mountedObjectToolSettingsSnapshot() {
        return {
            category: this.mountedObjectTool.category,
            assets: {
                doors: this.mountedObjectTool.assets.doors || null,
                windows: this.mountedObjectTool.assets.windows || null
            },
            settings: {
                doors: this.mountedObjectTool.settings.doors || null,
                windows: this.mountedObjectTool.settings.windows || null
            }
        };
    }

    saveMountedObjectToolSettingsToBrowser() {
        localStorage.setItem(MOUNTED_OBJECT_TOOL_STORAGE_KEY, JSON.stringify(this.mountedObjectToolSettingsSnapshot()));
    }

    loadMountedObjectToolSettingsFromBrowser() {
        const stored = localStorage.getItem(MOUNTED_OBJECT_TOOL_STORAGE_KEY);
        if (!stored) return false;
        const payload = JSON.parse(stored);
        if (!payload || typeof payload !== "object") {
            throw new Error("stored door/window tool settings must be an object");
        }
        ["doors", "windows"].forEach((category) => {
            const asset = payload.assets && payload.assets[category];
            if (asset) {
                const width = Number(asset.width);
                const height = Number(asset.height);
                if (typeof asset.texturePath !== "string" || asset.texturePath.length === 0) {
                    throw new Error(`stored ${category} tool asset is missing a texture path`);
                }
                if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
                    throw new Error(`stored ${category} tool asset requires positive width and height`);
                }
                this.mountedObjectTool.assets[category] = {
                    ...asset,
                    category,
                    width,
                    height,
                    baseWidth: Number.isFinite(Number(asset.baseWidth)) ? Number(asset.baseWidth) : width,
                    baseHeight: Number.isFinite(Number(asset.baseHeight)) ? Number(asset.baseHeight) : height
                };
            }
            const settings = payload.settings && payload.settings[category];
            if (settings) {
                const size = Number(settings.size);
                const aspectRatio = Number(settings.aspectRatio);
                if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
                    throw new Error(`stored ${category} tool settings require positive size and aspect ratio`);
                }
                this.mountedObjectTool.settings[category] = { size, aspectRatio };
            }
        });
        const category = String(payload.category || "").trim().toLowerCase();
        if (category === "doors" || category === "windows") {
            this.mountedObjectTool.category = category;
        }
        this.emitChange();
        return true;
    }

    selectedMountedObjectAsset() {
        const selectedObject = this.selectedMountedObjects()[0] || null;
        if (selectedObject) {
            const width = Number(selectedObject.width);
            const height = Number(selectedObject.height);
            if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
                throw new Error("selected door/window requires positive width and height");
            }
            return {
                ...selectedObject,
                texturePath: selectedObject.texturePath,
                size: height,
                aspectRatio: width / height
            };
        }
        const category = this.mountedObjectTool.category || "doors";
        const asset = this.mountedObjectTool.assets[category] || null;
        if (!asset) return null;
        const settings = this.mountedObjectTool.settings[category] || {};
        const size = Number.isFinite(Number(settings.size)) && Number(settings.size) > 0
            ? Number(settings.size)
            : Number(asset.baseHeight || asset.height);
        const aspectRatio = Number.isFinite(Number(settings.aspectRatio)) && Number(settings.aspectRatio) > 0
            ? Number(settings.aspectRatio)
            : Number(asset.baseWidth || asset.width) / Number(asset.baseHeight || asset.height);
        return {
            ...asset,
            width: size * aspectRatio,
            height: size,
            size,
            aspectRatio
        };
    }

    setRenderError(message) {
        this.renderError = message;
    }

    selectedFloor() {
        return findFloor(this.building, this.selection.floorId) || null;
    }

    selectedWall() {
        const wallIds = this.selectedWallIds();
        return wallIds.length === 1 ? findWall(this.building, wallIds[0]) : null;
    }

    selectedMountedObject() {
        const objectIds = this.selectedMountedObjectIds();
        return objectIds.length === 1 ? findMountedObject(this.building, objectIds[0]) : null;
    }

    selectedMountedObjectIds() {
        const kind = this.selection && this.selection.kind;
        if (kind !== "mountedObject") return [];
        if (Array.isArray(this.selection.mountedObjectIds) && this.selection.mountedObjectIds.length > 0) {
            return this.selection.mountedObjectIds;
        }
        return this.selection.mountedObjectId !== null && this.selection.mountedObjectId !== undefined ? [this.selection.mountedObjectId] : [];
    }

    selectedMountedObjects() {
        return this.selectedMountedObjectIds().map((objectId) => {
            const object = findMountedObject(this.building, objectId);
            if (!object) throw new Error(`selected mounted object is missing from building: ${objectId}`);
            return object;
        });
    }

    selectedWallIds() {
        const kind = this.selection && this.selection.kind;
        if (kind !== "wall" && kind !== "wallEndpoint") return [];
        if (Array.isArray(this.selection.wallIds) && this.selection.wallIds.length > 0) {
            return this.selection.wallIds;
        }
        return this.selection.wallId !== null && this.selection.wallId !== undefined ? [this.selection.wallId] : [];
    }

    selectedWalls() {
        return this.selectedWallIds().map((wallId) => {
            const wall = findWall(this.building, wallId);
            if (!wall) throw new Error(`selected wall is missing from building: ${wallId}`);
            return wall;
        });
    }

    isWallSelected(wall) {
        if (!wall) return false;
        const ids = new Set(this.selectedWallIds().map((id) => String(id)));
        return ids.has(String(wall.id));
    }

    syncInputsFromFloor(floor) {
        if (!floor) return;
        this.inputs.floorElevation = getFloorElevation(floor);
        this.inputs.floorHeight = floor.floorHeight;
        this.inputs.floorTexture = floor.floorTexturePath;
        this.inputs.roofTexture = floor.roofTexturePath;
        this.inputs.roofOverhang = floor.roofOverhang;
        this.inputs.roofPeakHeight = floor.roofPeakHeight;
        this.inputs.wallHeight = floor.defaultWallHeight;
        this.inputs.wallTexture = floor.defaultWallTexturePath;
    }

    buildingCenter() {
        const points = [];
        getBuildingFloors(this.building).forEach((floor) => {
            if (Array.isArray(floor.outerPolygon)) {
                floor.outerPolygon.forEach((point) => {
                    if (Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))) {
                        points.push(point);
                    }
                });
            }
        });
        if (!points.length) return { x: 0, y: 0 };
        const bounds = points.reduce((acc, point) => ({
            minX: Math.min(acc.minX, Number(point.x)),
            maxX: Math.max(acc.maxX, Number(point.x)),
            minY: Math.min(acc.minY, Number(point.y)),
            maxY: Math.max(acc.maxY, Number(point.y))
        }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
        return {
            x: (bounds.minX + bounds.maxX) * 0.5,
            y: (bounds.minY + bounds.maxY) * 0.5
        };
    }

    updateCameraRotationCenter() {
        this.camera.rotationCenter = this.buildingCenter();
        return this.camera.rotationCenter;
    }

    selectFloor(floorId, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) {
            throw new Error(`cannot select missing floor: ${floorId}`);
        }
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("floor", { floorId: selectedFloorId });
        this.syncInputsFromFloor(floor);
        this.emitChange();
    }

    selectAllFloors() {
        this.selectBuilding();
    }

    selectBuilding() {
        const floors = getBuildingFloors(this.building);
        this.selectedFloorIds = new Set(floors.map((floor) => getFloorId(floor)));
        this.layerSelectionMode = "all";
        this.selection = createSelection("building");
        this.syncInputsFromFloor(floors[0] || null);
        this.emitChange();
    }

    selectFloorLayer(floorId) {
        this.selectLevel(floorId);
    }

    selectLevel(floorId, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) {
            throw new Error(`cannot select missing floor layer: ${floorId}`);
        }
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("level", { floorId: selectedFloorId });
        this.syncInputsFromFloor(floor);
        this.emitChange();
    }

    selectRoof(floorId, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) {
            throw new Error(`cannot select roof for missing level: ${floorId}`);
        }
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("roof", { floorId: selectedFloorId });
        this.syncInputsFromFloor(floor);
        this.emitChange();
    }

    isFloorSelected(floorId) {
        return this.selectedFloorIds.has(String(floorId || ""));
    }

    allFloorsSelected() {
        const floors = getBuildingFloors(this.building);
        return this.layerSelectionMode === "all" && floors.length > 0 && this.selectedFloorIds.size === floors.length &&
            floors.every((floor) => this.selectedFloorIds.has(getFloorId(floor)));
    }

    renderStyle() {
        return this.allFloorsSelected() ? "exterior" : "interior";
    }

    visibleFloorIds() {
        return new Set(this.selectedFloorIds);
    }

    selectWall(wallId, options = {}) {
        const wall = findWall(this.building, wallId);
        if (!wall) {
            throw new Error(`cannot select missing wall: ${wallId}`);
        }
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([wall.floorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("wall", { floorId: wall.floorId, wallId: wall.id });
        this.inputs.wallHeight = wall.height;
        this.inputs.wallTexture = wall.wallTexturePath;
        this.emitChange();
    }

    selectMountedObject(objectId, options = {}) {
        const object = findMountedObject(this.building, objectId);
        if (!object) {
            throw new Error(`cannot select missing mounted object: ${objectId}`);
        }
        const wall = findWall(this.building, object.wallId ?? object.mountedWallSectionUnitId);
        if (!wall) {
            throw new Error(`cannot select mounted object ${objectId} without its wall`);
        }
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([wall.floorId]);
            this.layerSelectionMode = "floor";
        }
        const category = String(object.category || "").trim().toLowerCase();
        if (category === "doors" || category === "windows") {
            this.mountedObjectTool.category = category;
        }
        this.selection = createSelection("mountedObject", {
            floorId: wall.floorId,
            wallId: wall.id,
            mountedObjectId: object.id
        });
        this.emitChange();
    }

    updateSelectedMountedObjectAsset(asset) {
        const objects = this.selectedMountedObjects();
        if (!objects.length) throw new Error("cannot update texture without a selected door/window");
        if (!asset || typeof asset.texturePath !== "string" || asset.texturePath.length === 0) {
            throw new Error("mounted object asset requires a texture path");
        }
        objects.forEach((object) => {
            object.texturePath = asset.texturePath;
            object.placeableAnchorX = Number.isFinite(Number(asset.anchorX)) ? Number(asset.anchorX) : object.placeableAnchorX;
            object.placeableAnchorY = Number.isFinite(Number(asset.anchorY)) ? Number(asset.anchorY) : object.placeableAnchorY;
            object.renderDepthOffset = Number.isFinite(Number(asset.renderDepthOffset)) ? Number(asset.renderDepthOffset) : object.renderDepthOffset;
            object.compositeLayers = Array.isArray(asset.compositeLayers) ? asset.compositeLayers : object.compositeLayers;
            object.isOpen = asset.isOpen === true;
            object.isPassable = asset.isPassable !== false;
            object.blocksTile = asset.blocksTile === true;
            object.castsLosShadows = asset.castsLosShadows === true;
        });
        this.emitChange();
    }

    addMountedObjectToSelection(objectId, options = {}) {
        const object = findMountedObject(this.building, objectId);
        if (!object) {
            throw new Error(`cannot add missing mounted object to selection: ${objectId}`);
        }
        const wall = findWall(this.building, object.wallId ?? object.mountedWallSectionUnitId);
        if (!wall) throw new Error(`cannot add mounted object ${objectId} without its wall`);
        const nextObjectIds = [...this.selectedMountedObjectIds()];
        if (!nextObjectIds.some((id) => String(id) === String(object.id))) {
            nextObjectIds.push(object.id);
        }
        const selectedObjects = nextObjectIds.map((id) => {
            const selectedObject = findMountedObject(this.building, id);
            if (!selectedObject) throw new Error(`selected mounted object is missing from building: ${id}`);
            return selectedObject;
        });
        const selectedWalls = selectedObjects.map((selectedObject) => {
            const selectedWall = findWall(this.building, selectedObject.wallId ?? selectedObject.mountedWallSectionUnitId);
            if (!selectedWall) throw new Error(`selected mounted object ${selectedObject.id} is missing its wall`);
            return selectedWall;
        });
        if (!options.preserveView) {
            this.selectedFloorIds = new Set(selectedWalls.map((selectedWall) => selectedWall.floorId));
            this.layerSelectionMode = "floor";
        }
        const selectedWallIds = new Set(selectedWalls.map((selectedWall) => String(selectedWall.id)));
        this.selection = createSelection("mountedObject", {
            floorId: selectedWalls[0].floorId,
            wallId: selectedWallIds.size === 1 ? selectedWalls[0].id : null,
            mountedObjectIds: nextObjectIds
        });
        this.emitChange();
        return true;
    }

    removeMountedObjectFromSelection(objectId, options = {}) {
        const object = findMountedObject(this.building, objectId);
        if (!object) {
            throw new Error(`cannot remove missing mounted object from selection: ${objectId}`);
        }
        const nextObjectIds = this.selectedMountedObjectIds().filter((id) => String(id) !== String(object.id));
        if (nextObjectIds.length === this.selectedMountedObjectIds().length) return false;
        if (nextObjectIds.length === 0) {
            const wall = findWall(this.building, object.wallId ?? object.mountedWallSectionUnitId);
            if (wall) this.selectLevel(wall.floorId, options);
            else this.selectBuilding();
            return true;
        }
        if (nextObjectIds.length === 1) {
            this.selectMountedObject(nextObjectIds[0], options);
            return true;
        }
        const selectedObjects = nextObjectIds.map((id) => {
            const selectedObject = findMountedObject(this.building, id);
            if (!selectedObject) throw new Error(`selected mounted object is missing from building: ${id}`);
            return selectedObject;
        });
        const selectedWalls = selectedObjects.map((selectedObject) => {
            const selectedWall = findWall(this.building, selectedObject.wallId ?? selectedObject.mountedWallSectionUnitId);
            if (!selectedWall) throw new Error(`selected mounted object ${selectedObject.id} is missing its wall`);
            return selectedWall;
        });
        if (!options.preserveView) {
            this.selectedFloorIds = new Set(selectedWalls.map((selectedWall) => selectedWall.floorId));
            this.layerSelectionMode = "floor";
        }
        const selectedWallIds = new Set(selectedWalls.map((selectedWall) => String(selectedWall.id)));
        this.selection = createSelection("mountedObject", {
            floorId: selectedWalls[0].floorId,
            wallId: selectedWallIds.size === 1 ? selectedWalls[0].id : null,
            mountedObjectIds: nextObjectIds
        });
        this.emitChange();
        return true;
    }

    addWallToSelection(wallId, options = {}) {
        const wall = findWall(this.building, wallId);
        if (!wall) {
            throw new Error(`cannot add missing wall to selection: ${wallId}`);
        }
        const nextWallIds = [...this.selectedWallIds()];
        if (!nextWallIds.some((id) => String(id) === String(wall.id))) {
            nextWallIds.push(wall.id);
        }
        const selectedWalls = nextWallIds.map((id) => {
            const selectedWall = findWall(this.building, id);
            if (!selectedWall) throw new Error(`selected wall is missing from building: ${id}`);
            return selectedWall;
        });
        if (!options.preserveView) {
            this.selectedFloorIds = new Set(selectedWalls.map((selectedWall) => selectedWall.floorId));
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("wall", { floorId: selectedWalls[0].floorId, wallIds: nextWallIds });
        this.inputs.wallHeight = wall.height;
        this.inputs.wallTexture = wall.wallTexturePath;
        this.emitChange();
    }

    removeWallFromSelection(wallId, options = {}) {
        const wall = findWall(this.building, wallId);
        if (!wall) {
            throw new Error(`cannot remove missing wall from selection: ${wallId}`);
        }
        const nextWallIds = this.selectedWallIds().filter((id) => String(id) !== String(wall.id));
        if (nextWallIds.length === this.selectedWallIds().length) return false;
        if (nextWallIds.length === 0) {
            this.selectLevel(wall.floorId, options);
            return true;
        }
        if (nextWallIds.length === 1) {
            this.selectWall(nextWallIds[0], options);
            return true;
        }
        const selectedWalls = nextWallIds.map((id) => {
            const selectedWall = findWall(this.building, id);
            if (!selectedWall) throw new Error(`selected wall is missing from building: ${id}`);
            return selectedWall;
        });
        if (!options.preserveView) {
            this.selectedFloorIds = new Set(selectedWalls.map((selectedWall) => selectedWall.floorId));
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("wall", { floorId: selectedWalls[0].floorId, wallIds: nextWallIds });
        this.inputs.wallHeight = selectedWalls[0].height;
        this.inputs.wallTexture = selectedWalls[0].wallTexturePath;
        this.emitChange();
        return true;
    }

    selectWallEndpoint(wallId, endpointKey) {
        if (endpointKey !== "startPoint" && endpointKey !== "endPoint") {
            throw new Error(`unknown wall endpoint: ${endpointKey}`);
        }
        const wall = findWall(this.building, wallId);
        if (!wall) {
            throw new Error(`cannot select endpoint on missing wall: ${wallId}`);
        }
        if (!wall[endpointKey]) {
            throw new Error(`cannot select missing wall endpoint: ${endpointKey}`);
        }
        this.selection = createSelection("wallEndpoint", { floorId: wall.floorId, wallId: wall.id, wallEndpointKey: endpointKey });
        this.inputs.wallHeight = wall.height;
        this.inputs.wallTexture = wall.wallTexturePath;
        this.emitChange();
    }

    selectParentSelection() {
        const selection = this.selection || createSelection("building");
        const preserveView = this.renderStyle() === "exterior";
        switch (selection.kind) {
            case "floorVertex":
                this.selectFloor(selection.floorId, { preserveView });
                return true;
            case "wallEndpoint":
                this.selectWall(selection.wallId, { preserveView });
                return true;
            case "mountedObject":
                if (selection.wallId !== null && selection.wallId !== undefined) {
                    this.selectWall(selection.wallId, { preserveView });
                } else if (selection.floorId) {
                    this.selectLevel(selection.floorId, { preserveView });
                } else {
                    this.selectBuilding();
                }
                return true;
            case "wall":
            case "floor":
            case "roof":
                this.selectLevel(selection.floorId, { preserveView });
                return true;
            case "level":
                this.selectBuilding();
                return true;
            case "building":
                return false;
            default:
                if (selection.floorId) {
                    this.selectLevel(selection.floorId, { preserveView });
                    return true;
                }
                this.selectBuilding();
                return true;
        }
    }

    addWall(points) {
        const floor = this.selectedFloor();
        if (!floor) {
            throw new Error("cannot add wall without a selected floor");
        }
        const wall = createWall({
            floorId: getFloorId(floor),
            points,
            height: this.inputs.wallHeight,
            texture: this.inputs.wallTexture,
            bottomZ: getFloorElevation(floor),
            traversalLayer: floor.level,
            role: "interior"
        });
        this.building.wallSections.push(wall);
        this.selectWall(wall.id);
        return wall;
    }

    addWallBetweenEndpoints(startEndpoint, endEndpoint) {
        const floor = this.selectedFloor();
        if (!floor) {
            throw new Error("cannot add wall without a selected floor");
        }
        const start = { x: Number(startEndpoint.x), y: Number(startEndpoint.y) };
        const end = { x: Number(endEndpoint.x), y: Number(endEndpoint.y) };
        if (!Number.isFinite(start.x) || !Number.isFinite(start.y) || !Number.isFinite(end.x) || !Number.isFinite(end.y)) {
            throw new Error("wall endpoints must have finite coordinates");
        }
        if (distance(start, end) < 0.000001) {
            throw new Error("wall endpoints must not be coincident");
        }
        const floorId = getFloorId(floor);
        const wall = createWall({
            floorId,
            startPoint: cloneEndpoint(startEndpoint),
            endPoint: cloneEndpoint(endEndpoint),
            height: this.inputs.wallHeight,
            texture: this.inputs.wallTexture,
            bottomZ: getFloorElevation(floor),
            traversalLayer: floor.level,
            role: "interior",
            attachment: null
        });
        syncWallLineBoundaryAttachment(wall);
        this.building.wallSections.push(wall);
        refreshWallSectionEndpoints(this.building, floor);
        this.selectWall(wall.id);
        return wall;
    }

    addMountedWallObject(placement, asset) {
        if (!placement || !placement.wall || !placement.floor) {
            throw new Error("cannot place door or window without a wall placement");
        }
        if (!asset || typeof asset.texturePath !== "string" || asset.texturePath.length === 0) {
            throw new Error("cannot place door or window without a selected asset");
        }
        if (!placement.valid) {
            throw new Error(placement.reason || "door or window does not fit on this wall");
        }
        if (!Array.isArray(this.building.mountedWallObjects)) this.building.mountedWallObjects = [];
        const category = String(asset.category || this.mountedObjectTool.category || "").trim().toLowerCase();
        const object = createWallMountedObject({
            floorId: getFloorId(placement.floor),
            wallId: placement.wall.id,
            category,
            texturePath: asset.texturePath,
            wallT: placement.wallT,
            width: asset.width,
            height: asset.height,
            zOffset: placement.zOffset,
            placementRotation: placement.placementRotation,
            mountedWallFacingSign: placement.mountedWallFacingSign,
            placeableAnchorX: asset.anchorX,
            placeableAnchorY: asset.anchorY,
            renderDepthOffset: asset.renderDepthOffset,
            compositeLayers: asset.compositeLayers
        });
        object.x = Number(placement.faceCenter.x);
        object.y = Number(placement.faceCenter.y);
        object.z = getFloorElevation(placement.floor) + Number(placement.zOffset);
        object.isOpen = asset.isOpen === true;
        object.isPassable = asset.isPassable !== false;
        object.blocksTile = asset.blocksTile === true;
        object.castsLosShadows = asset.castsLosShadows === true;
        object.groundPlaneHitboxOverridePoints = Array.isArray(placement.groundPlaneHitboxOverridePoints)
            ? placement.groundPlaneHitboxOverridePoints.map((point) => ({ x: Number(point.x), y: Number(point.y) }))
            : undefined;
        this.building.mountedWallObjects.push(object);
        this.draft = null;
        this.emitChange();
        return object;
    }

    snapWallEndpoint(point, threshold, options = {}) {
        const floor = this.selectedFloor();
        if (!floor) {
            const prepared = this.preparePoint(point);
            return { point: prepared, endpoint: pointEndpoint(prepared), kind: "point" };
        }
        const floorId = getFloorId(floor);
        const ignoredVertexEndpoint = options.ignoreVertexEndpoint || null;
        const matchesIgnoredVertex = (endpoint, ringKind = null, holeIndex = -1, vertexId = null) => (
            ignoredVertexEndpoint &&
            ignoredVertexEndpoint.kind === "vertex" &&
            endpoint &&
            endpoint.kind === "vertex" &&
            endpoint.fragmentId === ignoredVertexEndpoint.fragmentId &&
            endpoint.fragmentId === floorId &&
            endpoint.ring === (ringKind || ignoredVertexEndpoint.ring) &&
            Number(endpoint.holeIndex) === Number(holeIndex ?? ignoredVertexEndpoint.holeIndex) &&
            endpoint.vertexId === (vertexId || ignoredVertexEndpoint.vertexId)
        );
        let best = null;
        const consider = (candidate) => {
            if (!candidate || !Number.isFinite(candidate.distance) || candidate.distance > threshold) return;
            if (
                !best ||
                candidate.priority < best.priority ||
                (candidate.priority === best.priority && candidate.distance < best.distance - 0.000001)
            ) {
                best = candidate;
            }
        };

        ringsForFloor(floor).forEach((ring) => {
            ring.points.forEach((vertex) => {
                if (matchesIgnoredVertex({
                    kind: "vertex",
                    fragmentId: floorId,
                    ring: ring.ringKind,
                    holeIndex: ring.holeIndex,
                    vertexId: vertex.id
                }, ring.ringKind, ring.holeIndex, vertex.id)) return;
                const candidatePoint = { x: Number(vertex.x), y: Number(vertex.y) };
                consider({
                    priority: 0,
                    distance: distance(point, candidatePoint),
                    point: candidatePoint,
                    endpoint: {
                        kind: "vertex",
                        fragmentId: floorId,
                        ring: ring.ringKind,
                        holeIndex: ring.holeIndex,
                        vertexId: vertex.id,
                        x: candidatePoint.x,
                        y: candidatePoint.y
                    },
                    kind: "vertex"
                });
            });
        });

        getBuildingWalls(this.building).forEach((wall) => {
            if ((wall.fragmentId || wall.floorId) !== floorId) return;
            if (Number(options.ignoreWallId) === Number(wall.id)) return;
            const points = wallPoints(this.building, wall);
            if (points.length !== 2) return;
            [
                { endpoint: wall.startPoint, point: points[0] },
                { endpoint: wall.endPoint, point: points[1] }
            ].forEach((entry) => {
                if (matchesIgnoredVertex(entry.endpoint)) return;
                const candidatePoint = { x: Number(entry.point.x), y: Number(entry.point.y) };
                const endpoint = entry.endpoint && entry.endpoint.kind === "vertex"
                    ? cloneEndpoint(entry.endpoint)
                    : pointEndpoint(candidatePoint);
                consider({
                    priority: 1,
                    distance: distance(point, candidatePoint),
                    point: candidatePoint,
                    endpoint,
                    kind: "wallEndpoint"
                });
            });
        });

        ringsForFloor(floor).forEach((ring) => {
            for (let index = 0; index < ring.points.length; index++) {
                const a = ring.points[index];
                const b = ring.points[(index + 1) % ring.points.length];
                const candidatePoint = closestPointOnSegment(point, a, b);
                if (pointIsNearSegmentEndpoint(candidatePoint, a, b, threshold)) continue;
                consider({
                    priority: 2,
                    distance: distanceToSegment(point, a, b),
                    point: candidatePoint,
                    endpoint: {
                        kind: "edge",
                        fragmentId: floorId,
                        ring: ring.ringKind,
                        holeIndex: ring.holeIndex,
                        x: candidatePoint.x,
                        y: candidatePoint.y
                    },
                    kind: "edge"
                });
            }
        });

        if (best) {
            return { point: best.point, endpoint: best.endpoint, kind: best.kind };
        }

        const prepared = this.preparePoint(point);
        return { point: prepared, endpoint: pointEndpoint(prepared), kind: "point" };
    }

    pickWallEndpoint(point, threshold) {
        const selectedWall = this.selectedWall();
        if (!selectedWall) return null;
        let best = null;
        [selectedWall].forEach((wall) => {
            const points = wallPoints(this.building, wall);
            if (points.length !== 2) return;
            [
                { endpointKey: "startPoint", point: points[0] },
                { endpointKey: "endPoint", point: points[1] }
            ].forEach((entry) => {
                const d = distance(point, entry.point);
                if (d <= threshold && (!best || d < best.distance)) {
                    best = { wall, endpointKey: entry.endpointKey, point: entry.point, distance: d };
                }
            });
        });
        return best;
    }

    moveSelectedWallEndpoint(point, threshold, options = {}) {
        const wall = this.selectedWall();
        const endpointKey = this.selection.wallEndpointKey;
        if (!wall || (endpointKey !== "startPoint" && endpointKey !== "endPoint")) return false;
        const detachVertexEndpoint = options.detachVertexEndpoint === true ||
            (wall.role === "perimeter" && wall[endpointKey] && wall[endpointKey].kind === "vertex");
        const previousEndpoint = cloneEndpoint(wall[endpointKey]);
        const nextEndpoint = this.snapWallEndpoint(point, threshold, {
            ignoreWallId: wall.id,
            ignoreVertexEndpoint: detachVertexEndpoint ? previousEndpoint : null
        }).endpoint;
        const previousAttachment = wall.attachment ? JSON.parse(JSON.stringify(wall.attachment)) : null;
        const previousRole = wall.role;
        if (detachVertexEndpoint && wall.role === "perimeter") {
            wall.role = "interior";
            wall.attachment = null;
        }
        wall[endpointKey] = cloneEndpoint(nextEndpoint);
        const points = wallPoints(this.building, wall);
        if (points.length !== 2 || distance(points[0], points[1]) < 0.000001) {
            wall[endpointKey] = previousEndpoint;
            wall.attachment = previousAttachment;
            wall.role = previousRole;
            return false;
        }
        syncWallLineBoundaryAttachment(wall);
        const floor = findFloor(this.building, wall.fragmentId || wall.floorId);
        if (!floor) throw new Error(`selected wall has missing floor: ${wall.floorId}`);
        refreshWallSectionEndpoints(this.building, floor);
        this.emitChange();
        return true;
    }

    reflowFloorsAbove(floor) {
        const floors = [...getBuildingFloors(this.building)].sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
        const startIndex = floors.findIndex((candidate) => getFloorId(candidate) === getFloorId(floor));
        if (startIndex < 0) throw new Error(`cannot reflow stack from missing floor: ${getFloorId(floor)}`);
        const changedFloors = new Set([getFloorId(floor)]);
        for (let index = startIndex + 1; index < floors.length; index++) {
            const previous = floors[index - 1];
            const nextElevation = getFloorElevation(previous) + Number(previous.floorHeight);
            if (!Number.isFinite(nextElevation)) {
                throw new Error(`cannot reflow floor above ${getFloorId(previous)} without finite floor height`);
            }
            if (Math.abs(getFloorElevation(floors[index]) - nextElevation) > 0.000001) {
                setFloorElevation(floors[index], nextElevation);
                changedFloors.add(getFloorId(floors[index]));
            }
        }
        this.building.floorFragments.sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
        getBuildingFloors(this.building).forEach((candidateFloor) => {
            if (changedFloors.has(getFloorId(candidateFloor))) {
                refreshWallSectionEndpoints(this.building, candidateFloor);
            }
        });
    }

    duplicateSelectedFloor() {
        const source = this.selectedFloor();
        if (!source) throw new Error("cannot duplicate floor without a selected floor");
        const sourceElevation = getFloorElevation(source);
        const duplicateHeight = Number(source.floorHeight);
        if (!Number.isFinite(duplicateHeight) || duplicateHeight <= 0) {
            throw new Error("cannot duplicate floor without a positive floor height");
        }
        getBuildingFloors(this.building).forEach((floor) => {
            if (getFloorElevation(floor) > sourceElevation) {
                setFloorElevation(floor, getFloorElevation(floor) + duplicateHeight);
            }
        });
        const floor = duplicateFloor(this.building, getFloorId(source), sourceElevation + Number(source.floorHeight));
        this.building.floorFragments.sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
        getBuildingFloors(this.building).forEach((candidateFloor) => refreshWallSectionEndpoints(this.building, candidateFloor));
        this.selectFloor(getFloorId(floor));
        return floor;
    }

    duplicateSelectedFloorAtElevation(elevation) {
        const source = this.selectedFloor();
        if (!source) throw new Error("cannot duplicate floor without a selected floor");
        const floor = duplicateFloor(this.building, getFloorId(source), Number(elevation));
        this.selectFloor(getFloorId(floor));
        return floor;
    }

    deleteFloor(floorId) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot delete missing floor: ${floorId}`);
        const deletedFloorId = getFloorId(floor);
        const deletedElevation = getFloorElevation(floor);
        this.building.floorFragments = getBuildingFloors(this.building)
            .filter((candidate) => getFloorId(candidate) !== deletedFloorId);
        this.building.wallSections = getBuildingWalls(this.building)
            .filter((wall) => wall.floorId !== deletedFloorId && wall.fragmentId !== deletedFloorId);
        this.building.mountedWallObjects = getBuildingMountedObjects(this.building)
            .filter((object) => object.floorId !== deletedFloorId);
        this.selectedFloorIds.delete(deletedFloorId);

        const remainingFloors = getBuildingFloors(this.building);
        if (!remainingFloors.length) {
            this.selectedFloorIds = new Set();
            this.layerSelectionMode = "floor";
            this.selection = createSelection("building");
            this.draft = null;
            this.floorVertexDrag = null;
            this.emitChange();
            return true;
        }

        const floorBelow = [...remainingFloors]
            .filter((candidate) => getFloorElevation(candidate) < deletedElevation)
            .sort((a, b) => getFloorElevation(b) - getFloorElevation(a))[0] || null;
        if (floorBelow) {
            this.reflowFloorsAbove(floorBelow);
        }

        if (this.layerSelectionMode === "all") {
            this.selectedFloorIds = new Set(getBuildingFloors(this.building).map((candidate) => getFloorId(candidate)));
            const primaryFloor = remainingFloors[0];
            this.selection = createSelection("building");
            this.inputs.floorElevation = getFloorElevation(primaryFloor);
            this.inputs.floorHeight = primaryFloor.floorHeight;
            this.inputs.floorTexture = primaryFloor.floorTexturePath;
            this.inputs.roofTexture = primaryFloor.roofTexturePath;
            this.inputs.roofOverhang = primaryFloor.roofOverhang;
            this.inputs.roofPeakHeight = primaryFloor.roofPeakHeight;
            this.inputs.wallHeight = primaryFloor.defaultWallHeight;
            this.inputs.wallTexture = primaryFloor.defaultWallTexturePath;
            this.draft = null;
            this.floorVertexDrag = null;
            this.emitChange();
            return true;
        }

        const currentFloor = findFloor(this.building, this.selection.floorId);
        if (currentFloor && this.selectedFloorIds.has(getFloorId(currentFloor))) {
            this.draft = null;
            this.floorVertexDrag = null;
            this.emitChange();
            return true;
        }
        this.selectFloor(getFloorId(remainingFloors[0]));
        return true;
    }

    updateSelectedFloorElevation(value) {
        const floor = this.selectedFloor();
        if (!floor) throw new Error("cannot update elevation without a selected floor");
        const elevation = Number(value);
        if (!Number.isFinite(elevation)) {
            throw new Error("floor elevation must be a finite number");
        }
        setFloorElevation(floor, elevation);
        this.building.floorFragments.sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
        refreshWallSectionEndpoints(this.building, floor);
        this.inputs.floorElevation = elevation;
        this.emitChange();
    }

    updateSelectedFloorHeight(value) {
        const floor = this.selectedFloor();
        if (!floor) throw new Error("cannot update floor height without a selected floor");
        const height = Number(value);
        if (!Number.isFinite(height) || height <= 0) {
            throw new Error("floor height must be a positive number");
        }
        const previousHeight = Number(floor.floorHeight);
        floor.floorHeight = height;
        getBuildingWalls(this.building).forEach((wall) => {
            if ((wall.fragmentId || wall.floorId) !== getFloorId(floor)) return;
            if (Math.abs(Number(wall.height) - previousHeight) <= 0.000001) {
                wall.height = height;
            }
        });
        this.reflowFloorsAbove(floor);
        this.inputs.floorHeight = height;
        this.emitChange();
    }

    updateSelectedWallHeight(value) {
        const height = Number(value);
        if (!Number.isFinite(height) || height <= 0) {
            throw new Error("wall height must be a positive number");
        }
        const walls = this.selectedWalls();
        if (walls.length > 0) {
            walls.forEach((wall) => {
                wall.height = height;
            });
        } else {
            const floor = this.selectedFloor();
            if (!floor) throw new Error("cannot update wall defaults without a selected floor");
            floor.defaultWallHeight = height;
        }
        this.inputs.wallHeight = height;
        this.emitChange();
    }

    updateSelectedWallTexture(texture) {
        const walls = this.selectedWalls();
        if (walls.length > 0) {
            walls.forEach((wall) => {
                wall.wallTexturePath = texture;
            });
        } else {
            const floor = this.selectedFloor();
            if (!floor) throw new Error("cannot update wall defaults without a selected floor");
            floor.defaultWallTexturePath = texture;
        }
        this.inputs.wallTexture = texture;
        this.paintTextures.walls = texture;
        this.emitChange();
    }

    updateSelectedFloorTexture(texture) {
        const floor = this.selectedFloor();
        if (!floor) throw new Error("cannot update floor texture without a selected floor");
        floor.floorTexturePath = texture;
        this.inputs.floorTexture = texture;
        this.paintTextures.floor = texture;
        this.emitChange();
    }

    updateSelectedRoofTexture(texture) {
        const floor = this.selectedFloor();
        if (!floor) throw new Error("cannot update roof texture without a selected floor");
        floor.roofTexturePath = texture;
        this.inputs.roofTexture = texture;
        this.paintTextures.roofs = texture;
        this.emitChange();
    }

    updateSelectedRoofOverhang(value) {
        const floor = this.selectedFloor();
        if (!floor) throw new Error("cannot update roof overhang without a selected floor");
        const overhang = Number(value);
        if (!Number.isFinite(overhang)) {
            throw new Error("roof overhang must be a finite number");
        }
        floor.roofOverhang = overhang;
        this.inputs.roofOverhang = overhang;
        this.emitChange();
    }

    updateSelectedRoofPeakHeight(value) {
        const floor = this.selectedFloor();
        if (!floor) throw new Error("cannot update roof peak height without a selected floor");
        const peakHeight = Number(value);
        if (!Number.isFinite(peakHeight) || peakHeight < 0) {
            throw new Error("roof peak height must be zero or greater");
        }
        floor.roofPeakHeight = peakHeight;
        this.inputs.roofPeakHeight = peakHeight;
        this.emitChange();
    }

    paintRoof(floorOrId, texture) {
        const floor = typeof floorOrId === "string" ? findFloor(this.building, floorOrId) : floorOrId;
        if (!floor) throw new Error("cannot paint missing roof");
        floor.roofTexturePath = texture;
        this.inputs.roofTexture = texture;
        this.paintTextures.roofs = texture;
        this.selection = createSelection("roof", { floorId: getFloorId(floor) });
        this.selectedFloorIds = new Set([getFloorId(floor)]);
        this.layerSelectionMode = "floor";
        this.emitChange();
    }

    paintFloor(floorOrId, texture) {
        const floor = typeof floorOrId === "string" ? findFloor(this.building, floorOrId) : floorOrId;
        if (!floor) throw new Error("cannot paint missing floor");
        floor.floorTexturePath = texture;
        this.inputs.floorTexture = texture;
        this.paintTextures.floor = texture;
        this.selection = createSelection("floor", { floorId: getFloorId(floor) });
        this.selectedFloorIds = new Set([getFloorId(floor)]);
        this.layerSelectionMode = "floor";
        this.emitChange();
    }

    paintWall(wallId, texture) {
        const wall = findWall(this.building, wallId);
        if (!wall) throw new Error(`cannot paint missing wall: ${wallId}`);
        wall.wallTexturePath = texture;
        this.inputs.wallTexture = texture;
        this.paintTextures.walls = texture;
        this.selectWall(wall.id);
    }

    moveFootprintVertex(floorId, vertexIndex, point) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot edit missing floor: ${floorId}`);
        if (!floor.outerPolygon[vertexIndex]) {
            throw new Error(`cannot edit missing footprint vertex: ${vertexIndex}`);
        }
        floor.outerPolygon[vertexIndex] = { ...floor.outerPolygon[vertexIndex], ...this.preparePoint(point) };
        refreshWallSectionEndpoints(this.building, floor);
        this.emitChange();
    }

    selectFloorVertex(floorId, ringKind, holeIndex, vertexIndex, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot select vertex on missing floor: ${floorId}`);
        const ring = getFloorRing(floor, ringKind, holeIndex);
        if (!Array.isArray(ring) || !ring[vertexIndex]) {
            throw new Error(`cannot select missing floor vertex: ${vertexIndex}`);
        }
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("floorVertex", { floorId: selectedFloorId, ringKind, holeIndex, vertexIndex });
        this.emitChange();
    }

    clearVertexSelection() {
        const floor = this.selectedFloor();
        if (floor) {
            this.selection = createSelection("floor", { floorId: getFloorId(floor) });
            this.floorVertexDrag = null;
            this.emitChange();
        }
    }

    beginFloorVertexDrag() {
        const floor = this.selectedFloor();
        const selection = this.selection;
        if (!floor || !selection.ringKind || selection.vertexIndex < 0) {
            this.floorVertexDrag = null;
            return null;
        }
        const ring = getFloorRing(floor, selection.ringKind, selection.holeIndex);
        const vertex = Array.isArray(ring) ? ring[selection.vertexIndex] : null;
        if (!vertex) {
            throw new Error("cannot begin drag for missing floor vertex");
        }
        const origin = { x: Number(vertex.x), y: Number(vertex.y) };
        const baseElevation = getFloorElevation(floor);
        const linkedVertices = [];
        getBuildingFloors(this.building)
            .filter((candidateFloor) => getFloorElevation(candidateFloor) > baseElevation)
            .sort((a, b) => getFloorElevation(a) - getFloorElevation(b))
            .forEach((candidateFloor) => {
                const candidateRing = getFloorRing(candidateFloor, selection.ringKind, selection.holeIndex);
                if (!Array.isArray(candidateRing)) return;
                const candidateIndex = candidateRing.findIndex((candidateVertex) => sameXY(candidateVertex, origin));
                if (candidateIndex < 0) return;
                linkedVertices.push({
                    floor: candidateFloor,
                    floorId: getFloorId(candidateFloor),
                    ringKind: selection.ringKind,
                    holeIndex: selection.holeIndex,
                    vertexIndex: candidateIndex,
                    origin: {
                        x: Number(candidateRing[candidateIndex].x),
                        y: Number(candidateRing[candidateIndex].y)
                    }
                });
            });
        this.floorVertexDrag = {
            floorId: getFloorId(floor),
            ringKind: selection.ringKind,
            holeIndex: selection.holeIndex,
            vertexIndex: selection.vertexIndex,
            origin,
            linkedVertices
        };
        return this.floorVertexDrag;
    }

    endFloorVertexDrag() {
        this.floorVertexDrag = null;
    }

    moveSelectedFloorVertex(point) {
        const floor = this.selectedFloor();
        const selection = this.selection;
        if (!floor || !selection.ringKind || selection.vertexIndex < 0) return false;
        const ring = getFloorRing(floor, selection.ringKind, selection.holeIndex);
        if (!Array.isArray(ring) || !ring[selection.vertexIndex]) {
            throw new Error("selected floor vertex is no longer valid");
        }
        const nextRing = ring.map((vertex, index) => (
            index === selection.vertexIndex ? { ...vertex, ...this.preparePoint(point) } : { ...vertex }
        ));
        const movedPoint = nextRing[selection.vertexIndex];
        const activeDrag = this.floorVertexDrag &&
            this.floorVertexDrag.floorId === getFloorId(floor) &&
            this.floorVertexDrag.ringKind === selection.ringKind &&
            Number(this.floorVertexDrag.holeIndex) === Number(selection.holeIndex) &&
            Number(this.floorVertexDrag.vertexIndex) === Number(selection.vertexIndex)
            ? this.floorVertexDrag
            : null;
        const ringUpdates = [{
            floor,
            floorId: getFloorId(floor),
            ringKind: selection.ringKind,
            holeIndex: selection.holeIndex,
            ring: nextRing
        }];
        const changedFloors = new Set([getFloorId(floor)]);
        if (activeDrag) {
            const dx = Number(movedPoint.x) - Number(activeDrag.origin.x);
            const dy = Number(movedPoint.y) - Number(activeDrag.origin.y);
            activeDrag.linkedVertices.forEach((linked) => {
                const linkedRing = getFloorRing(linked.floor, linked.ringKind, linked.holeIndex);
                if (!Array.isArray(linkedRing) || !linkedRing[linked.vertexIndex]) return;
                const linkedNextRing = linkedRing.map((vertex, index) => (
                    index === linked.vertexIndex
                        ? { ...vertex, x: Number(linked.origin.x) + dx, y: Number(linked.origin.y) + dy }
                        : { ...vertex }
                ));
                ringUpdates.push({
                    floor: linked.floor,
                    floorId: linked.floorId,
                    ringKind: linked.ringKind,
                    holeIndex: linked.holeIndex,
                    ring: linkedNextRing
                });
                changedFloors.add(linked.floorId);
            });
        }
        ringUpdates.forEach((update) => {
            const error = simplePolygonRingError(update.ring, `floor ${update.floorId} ${update.ringKind} polygon`);
            if (error) throw new Error(`cannot move floor vertex: ${error}`);
        });
        ringUpdates.forEach((update) => {
            setFloorRing(update.floor, update.ringKind, update.holeIndex, update.ring);
        });
        if (selection.ringKind === "outer") {
            getBuildingFloors(this.building).forEach((candidateFloor) => {
                if (changedFloors.has(getFloorId(candidateFloor))) {
                    refreshWallSectionEndpoints(this.building, candidateFloor);
                }
            });
        }
        this.emitChange();
        return true;
    }

    floorsAbove(floor) {
        const baseElevation = getFloorElevation(floor);
        return getBuildingFloors(this.building)
            .filter((candidateFloor) => getFloorElevation(candidateFloor) > baseElevation)
            .sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
    }

    refreshChangedFloorWalls(changedFloorIds) {
        getBuildingFloors(this.building).forEach((candidateFloor) => {
            const floorId = getFloorId(candidateFloor);
            if (!changedFloorIds.has(floorId)) return;
            createPerimeterWallsForFloor(this.building, candidateFloor);
            refreshWallSectionEndpoints(this.building, candidateFloor);
        });
    }

    propagateInsertedFloorVertex(floor, ringKind, holeIndex, edgeStart, edgeEnd, point) {
        const changedFloorIds = new Set();
        this.floorsAbove(floor).forEach((candidateFloor) => {
            const candidateRing = getFloorRing(candidateFloor, ringKind, holeIndex);
            const edgeIndex = findMatchingDirectedEdgeIndex(candidateRing, edgeStart, edgeEnd);
            if (edgeIndex < 0) return;
            const result = insertVertexOnRingEdge(candidateRing, edgeIndex, point);
            setFloorRing(candidateFloor, ringKind, holeIndex, result.ring);
            changedFloorIds.add(getFloorId(candidateFloor));
        });
        return changedFloorIds;
    }

    propagateDeletedFloorVertex(floor, ringKind, holeIndex, previousPoint, deletedPoint, nextPoint) {
        const changedFloorIds = new Set();
        this.floorsAbove(floor).forEach((candidateFloor) => {
            const candidateRing = getFloorRing(candidateFloor, ringKind, holeIndex);
            const vertexIndex = findMatchingVertexWithNeighbors(candidateRing, previousPoint, deletedPoint, nextPoint);
            if (vertexIndex < 0 || candidateRing.length <= 3) return;
            const candidateDeletedVertex = candidateRing[vertexIndex];
            if (ringKind === "outer" && candidateDeletedVertex && candidateDeletedVertex.id) {
                fallbackDeletedVertexEndpointsToPoint(this.building, getFloorId(candidateFloor), candidateDeletedVertex.id);
            }
            const nextRing = candidateRing
                .filter((_point, index) => index !== vertexIndex)
                .map((point) => ({ ...point, x: Number(point.x), y: Number(point.y) }));
            setFloorRing(candidateFloor, ringKind, holeIndex, nextRing);
            changedFloorIds.add(getFloorId(candidateFloor));
        });
        return changedFloorIds;
    }

    insertFloorVertexOnKnownEdge(floorId, ringKind, holeIndex, insertAfterIndex, point) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot insert vertex on missing floor: ${floorId}`);
        const points = getFloorRing(floor, ringKind, holeIndex);
        if (!Array.isArray(points) || points.length < 3) {
            throw new Error(`cannot insert vertex on missing ${ringKind} ring`);
        }
        const edgeIndex = Math.floor(Number(insertAfterIndex));
        if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= points.length) {
            throw new Error(`cannot insert vertex on missing edge: ${insertAfterIndex}`);
        }
        const preparedPoint = this.preparePoint(point);
        const edgeStart = points[edgeIndex];
        const edgeEnd = points[(edgeIndex + 1) % points.length];
        const result = insertVertexOnRingEdge(points, edgeIndex, preparedPoint);
        setFloorRing(floor, ringKind, holeIndex, result.ring);
        const changedFloorIds = new Set([getFloorId(floor)]);
        this.propagateInsertedFloorVertex(floor, ringKind, holeIndex, edgeStart, edgeEnd, preparedPoint)
            .forEach((changedFloorId) => changedFloorIds.add(changedFloorId));
        if (ringKind === "outer") {
            this.refreshChangedFloorWalls(changedFloorIds);
        }
        this.selection = createSelection("floorVertex", {
            floorId: getFloorId(floor),
            ringKind,
            holeIndex,
            vertexIndex: result.vertexIndex
        });
        this.emitChange();
        return true;
    }

    insertFloorVertexOnEdge(point, threshold) {
        const floor = this.selectedFloor();
        if (!floor) return false;
        const hit = findRingEdgeAtPoint(floor, point, threshold);
        if (!hit) return false;
        return this.insertFloorVertexOnKnownEdge(
            getFloorId(floor),
            hit.ringKind,
            hit.holeIndex,
            hit.insertAfterIndex,
            hit.point
        );
    }

    insertFloorVertexNearSelected(point) {
        const floor = this.selectedFloor();
        const selection = this.selection;
        if (!floor || !selection.ringKind || selection.vertexIndex < 0) return false;
        const ring = getFloorRing(floor, selection.ringKind, selection.holeIndex);
        if (!Array.isArray(ring)) return false;
        const preparedPoint = this.preparePoint(point);
        const selectedIndex = Math.floor(Number(selection.vertexIndex));
        const prevIndex = previousRingIndex(ring, selectedIndex);
        const nextIndex = nextRingIndex(ring, selectedIndex);
        const splitPrevEdge = (
            (Number(preparedPoint.x) - Number(ring[prevIndex].x)) ** 2 +
            (Number(preparedPoint.y) - Number(ring[prevIndex].y)) ** 2
        ) <= (
            (Number(preparedPoint.x) - Number(ring[nextIndex].x)) ** 2 +
            (Number(preparedPoint.y) - Number(ring[nextIndex].y)) ** 2
        );
        const edgeStart = splitPrevEdge ? ring[prevIndex] : ring[selectedIndex];
        const edgeEnd = splitPrevEdge ? ring[selectedIndex] : ring[nextIndex];
        const result = insertVertexNearSelectedNeighbor(ring, selection.vertexIndex, preparedPoint);
        setFloorRing(floor, selection.ringKind, selection.holeIndex, result.ring);
        const changedFloorIds = new Set([getFloorId(floor)]);
        this.propagateInsertedFloorVertex(floor, selection.ringKind, selection.holeIndex, edgeStart, edgeEnd, preparedPoint)
            .forEach((floorId) => changedFloorIds.add(floorId));
        if (selection.ringKind === "outer") {
            this.refreshChangedFloorWalls(changedFloorIds);
        }
        this.selection = createSelection("floorVertex", {
            floorId: getFloorId(floor),
            ringKind: selection.ringKind,
            holeIndex: selection.holeIndex,
            vertexIndex: result.vertexIndex
        });
        this.emitChange();
        return true;
    }

    deleteSelectedFloorVertex() {
        const floor = this.selectedFloor();
        const selection = this.selection;
        if (!floor || !selection.ringKind || selection.vertexIndex < 0) return false;
        const ring = getFloorRing(floor, selection.ringKind, selection.holeIndex);
        if (!Array.isArray(ring) || ring.length <= 3) return false;
        const previousPoint = ring[previousRingIndex(ring, selection.vertexIndex)];
        const deletedVertex = ring[selection.vertexIndex];
        const nextPoint = ring[nextRingIndex(ring, selection.vertexIndex)];
        const nextRing = ring
            .filter((_point, index) => index !== selection.vertexIndex)
            .map((point) => ({ ...point, x: Number(point.x), y: Number(point.y) }));
        if (selection.ringKind === "outer" && deletedVertex && deletedVertex.id) {
            fallbackDeletedVertexEndpointsToPoint(this.building, getFloorId(floor), deletedVertex.id);
        }
        setFloorRing(floor, selection.ringKind, selection.holeIndex, nextRing);
        const changedFloorIds = new Set([getFloorId(floor)]);
        this.propagateDeletedFloorVertex(floor, selection.ringKind, selection.holeIndex, previousPoint, deletedVertex, nextPoint)
            .forEach((floorId) => changedFloorIds.add(floorId));
        if (selection.ringKind === "outer") {
            this.refreshChangedFloorWalls(changedFloorIds);
        }
        this.selection = createSelection("floorVertex", {
            floorId: getFloorId(floor),
            ringKind: selection.ringKind,
            holeIndex: selection.holeIndex,
            vertexIndex: Math.min(selection.vertexIndex, nextRing.length - 1)
        });
        this.emitChange();
        return true;
    }

    applyPolygonDraftToSelectedFloor(points, operation) {
        const floor = this.selectedFloor();
        if (!floor) throw new Error("cannot edit polygon without a selected floor");
        const result = applyFloorPolygonEdit(floor, points, operation);
        replaceFloorShape(this.building, floor, result.footprint, result.holes, { regeneratePerimeterWalls: true });
        this.selection = createSelection("floor", { floorId: getFloorId(floor) });
        this.emitChange();
    }

    preparePoint(point) {
        return this.snapToGrid ? snapToHexAnchor(point) : { x: point.x, y: point.y };
    }

    updateHoverPoint(point) {
        this.hoverWorldPoint = point ? this.preparePoint(point) : null;
        this.emitChange();
    }

    describeHexAt(point) {
        const anchor = nearestHexAnchor(point);
        if (anchor.kind === "node") return `hex ${anchor.xindex},${anchor.yindex}`;
        return `midpoint ${anchor.a.xindex},${anchor.a.yindex} / ${anchor.b.xindex},${anchor.b.yindex}`;
    }

    pickSelectedFloorVertex(point, threshold) {
        const selectedFloor = this.selectedFloor();
        if (!selectedFloor) return null;
        const ringVertex = findRingVertexAtPoint(selectedFloor, point, threshold);
        if (ringVertex) return { type: "floorVertex", floor: selectedFloor, ...ringVertex };
        const vertex = nearestFloorVertex(selectedFloor, point, threshold);
        return vertex ? { type: "floorVertex", ...vertex } : null;
    }

    pick(point, threshold) {
        const vertexHit = this.pickSelectedFloorVertex(point, threshold);
        if (vertexHit) return vertexHit;
        const wallHit = nearestWall(this.building, point, threshold, (_wall, floor) => this.isFloorSelected(getFloorId(floor)));
        if (wallHit) return { type: "wall", ...wallHit };
        const floors = getBuildingFloors(this.building);
        for (let index = floors.length - 1; index >= 0; index--) {
            const floor = floors[index];
            if (!this.isFloorSelected(getFloorId(floor))) continue;
            const inOuter = pointInPolygon(point, floor.outerPolygon);
            const inHole = (floor.holes || []).some((ring) => pointInPolygon(point, ring));
            if (inOuter && !inHole) {
                return { type: "floor", floor };
            }
        }
        return null;
    }

    pickWallAt(point, threshold) {
        return nearestWall(this.building, point, threshold, (_wall, floor) => this.isFloorSelected(getFloorId(floor)));
    }

    pickFloorAt(point) {
        const floors = getBuildingFloors(this.building);
        for (let index = floors.length - 1; index >= 0; index--) {
            const floor = floors[index];
            if (!this.isFloorSelected(getFloorId(floor))) continue;
            const inOuter = pointInPolygon(point, floor.outerPolygon);
            const inHole = (floor.holes || []).some((ring) => pointInPolygon(point, ring));
            if (inOuter && !inHole) return { type: "floor", floor };
        }
        return null;
    }

    deleteSelectedWall() {
        const wall = this.selectedWall();
        if (!wall) return false;
        const floor = findFloor(this.building, wall.floorId);
        if (!floor) throw new Error(`selected wall has missing floor: ${wall.floorId}`);
        this.building.wallSections = getBuildingWalls(this.building).filter((candidate) => Number(candidate.id) !== Number(wall.id));
        this.building.mountedWallObjects = getBuildingMountedObjects(this.building)
            .filter((object) => Number(object.wallId) !== Number(wall.id));
        this.selection = createSelection("level", { floorId: getFloorId(floor) });
        this.emitChange();
        return true;
    }

    deleteSelectedMountedObject() {
        const objects = this.selectedMountedObjects();
        if (!objects.length) return false;
        const objectIds = new Set(objects.map((object) => String(object.id)));
        const walls = objects
            .map((object) => findWall(this.building, object.wallId ?? object.mountedWallSectionUnitId))
            .filter(Boolean);
        this.building.mountedWallObjects = getBuildingMountedObjects(this.building)
            .filter((candidate) => !objectIds.has(String(candidate.id)));
        const wallIds = new Set(walls.map((wall) => String(wall.id)));
        if (walls.length === 1 || wallIds.size === 1) {
            const wall = walls[0];
            this.selection = createSelection("wall", { floorId: wall.floorId, wallId: wall.id });
        } else if (walls.length > 0) {
            this.selection = createSelection("level", { floorId: walls[0].floorId });
        } else {
            this.selection = createSelection("building");
        }
        this.emitChange();
        return true;
    }

    serialize() {
        return serializeBuilding(this.building);
    }

    import(rawJson) {
        const nextBuilding = normalizeImportedBuilding(rawJson);
        const errors = validateBuilding(nextBuilding);
        if (errors.length) {
            throw new Error(`cannot load invalid building: ${errors[0]}`);
        }
        this.building = nextBuilding;
        const firstFloor = getBuildingFloors(this.building)[0] || null;
        this.selectedFloorIds = new Set(getBuildingFloors(this.building).map((floor) => getFloorId(floor)));
        this.layerSelectionMode = "all";
        this.selection = createSelection("building");
        this.syncInputsFromFloor(firstFloor);
        this.draft = null;
        this.updateCameraRotationCenter();
        this.emitChange();
    }

    repairFloorRings(building) {
        let repairedRingCount = 0;
        getBuildingFloors(building).forEach((floor) => {
            const floorId = getFloorId(floor);
            const outerError = simplePolygonRingError(floor.outerPolygon, `floor ${floorId} outerPolygon`);
            if (outerError) {
                floor.outerPolygon = repairSimplePolygonRing(floor.outerPolygon, `floor ${floorId} outerPolygon`);
                repairedRingCount += 1;
            }
            if (Array.isArray(floor.holes)) {
                floor.holes = floor.holes.map((ring, holeIndex) => {
                    const holeError = simplePolygonRingError(ring, `floor ${floorId} hole ${holeIndex}`);
                    if (!holeError) return ring;
                    repairedRingCount += 1;
                    return repairSimplePolygonRing(ring, `floor ${floorId} hole ${holeIndex}`);
                });
            }
            refreshWallSectionEndpoints(building, floor);
        });
        return repairedRingCount;
    }

    repairBrowserSave() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            throw new Error("no browser-saved building was found");
        }
        const building = normalizeImportedBuilding(stored);
        const initialErrors = validateBuilding(building);
        if (initialErrors.length === 0) {
            this.import(stored);
            return { repairedRingCount: 0, backupKey: null };
        }
        const repairedRingCount = this.repairFloorRings(building);
        const errors = validateBuilding(building);
        if (errors.length) {
            throw new Error(`browser save repair failed: ${errors[0]}`);
        }
        const backupKey = `${CORRUPT_SAVE_BACKUP_KEY_PREFIX}-${new Date().toISOString()}`;
        localStorage.setItem(backupKey, stored);
        const repaired = serializeBuilding(building);
        localStorage.setItem(STORAGE_KEY, repaired);
        this.import(repaired);
        return { repairedRingCount, backupKey };
    }

    saveToBrowser() {
        const errors = validateBuilding(this.building);
        if (errors.length) {
            throw new Error(`cannot save invalid building: ${errors[0]}`);
        }
        localStorage.setItem(STORAGE_KEY, this.serialize());
    }

    hasBrowserSave() {
        return localStorage.getItem(STORAGE_KEY) !== null;
    }

    loadFromBrowser() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            throw new Error("no browser-saved building was found");
        }
        this.import(stored);
    }

    reset() {
        this.building = createEmptyBuilding();
        this.createStarterFloor();
        this.tool = "select";
        this.camera.rotation = 0;
        this.centerCameraOnSelectedFloor();
    }

    centerCameraOnSelectedFloor() {
        const floor = this.selectedFloor();
        if (!floor || !Array.isArray(floor.outerPolygon) || floor.outerPolygon.length < 3) {
            this.camera.x = 0;
            this.camera.y = 0;
            this.camera.z = 0;
            this.camera.rotation = 0;
            this.camera.rotationCenter = { x: 0, y: 0 };
            this.emitChange();
            return;
        }
        const center = polygonCentroid(floor.outerPolygon);
        const floorElevation = getFloorElevation(floor);
        const cameraZ = Number.isFinite(Number(this.camera.z)) ? Number(this.camera.z) : 0;
        this.camera.x = center.x;
        this.camera.y = center.y - (floorElevation - cameraZ);
        this.updateCameraRotationCenter();
        this.emitChange();
    }
}
