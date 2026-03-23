// filesystem.js - Handles saving and loading game state

const lazyRoadStore = {
    recordsByKey: new Map(),
    loadedKeys: new Set()
};
const lazyTreeStore = {
    recordsByKey: new Map(),
    loadedKeys: new Set()
};

function markMinimapStaticDirty() {
    if (typeof globalThis !== "undefined" && typeof globalThis.invalidateMinimap === "function") {
        globalThis.invalidateMinimap();
    }
}

function roadRecordKey(x, y) {
    const qx = Math.round((Number(x) || 0) * 1000) / 1000;
    const qy = Math.round((Number(y) || 0) * 1000) / 1000;
    return `${qx},${qy}`;
}

function toRoadSaveRecord(data) {
    if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return null;
    const record = {
        type: 'road',
        x: Number(data.x),
        y: Number(data.y)
    };
    if (typeof data.visible === 'boolean') {
        record.visible = data.visible;
    }
    if (Number.isFinite(data.brightness)) {
        record.brightness = Number(data.brightness);
    }
    if (Number.isFinite(data.tint)) {
        record.tint = Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(data.tint))));
    } else if (data.pixiSprite && Number.isFinite(data.pixiSprite.tint)) {
        record.tint = Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(data.pixiSprite.tint))));
    }
    if (typeof data.fillTexturePath === 'string' && data.fillTexturePath.length > 0) {
        if (typeof globalThis !== "undefined" && typeof globalThis.normalizeLegacyAssetPath === "function") {
            record.fillTexturePath = globalThis.normalizeLegacyAssetPath(data.fillTexturePath);
        } else {
            record.fillTexturePath = data.fillTexturePath;
        }
    }
    return record;
}

function toTreeSaveRecord(data) {
    if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return null;
    const record = {
        type: 'tree',
        x: Number(data.x),
        y: Number(data.y)
    };
    if (typeof data.visible === 'boolean') {
        record.visible = data.visible;
    }
    if (Number.isFinite(data.brightness)) {
        record.brightness = Number(data.brightness);
    }
    if (Number.isFinite(data.tint)) {
        record.tint = Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(data.tint))));
    } else if (data.pixiSprite && Number.isFinite(data.pixiSprite.tint)) {
        record.tint = Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(data.pixiSprite.tint))));
    }
    if (Number.isFinite(data.hp)) record.hp = Number(data.hp);
    if (Number.isFinite(data.maxHP)) record.maxHP = Number(data.maxHP);
    if (typeof data.isOnFire === 'boolean') record.isOnFire = data.isOnFire;
    if (data.burned) record.burned = true;
    if (data._wasOnFire) record._wasOnFire = true;
    if (data.falling) record.falling = true;
    if (typeof data.fallDirection === 'string') record.fallDirection = data.fallDirection;
    if (Number.isFinite(data.rotation) && data.rotation !== 0) record.rotation = Number(data.rotation);
    if (Number.isInteger(data.textureIndex)) record.textureIndex = data.textureIndex;
    if (Number.isFinite(data.size)) record.size = Number(data.size);
    if (Object.prototype.hasOwnProperty.call(data, "script")) {
        try {
            record.script = JSON.parse(JSON.stringify(data.script));
        } catch (_err) {
            record.script = data.script;
        }
    }
    return record;
}

function resetLazyRoadStore() {
    lazyRoadStore.recordsByKey.clear();
    lazyRoadStore.loadedKeys.clear();
    markMinimapStaticDirty();
}
function resetLazyTreeStore() {
    lazyTreeStore.recordsByKey.clear();
    lazyTreeStore.loadedKeys.clear();
    markMinimapStaticDirty();
}

function registerLazyRoadRecord(data, loaded = false) {
    const record = toRoadSaveRecord(data);
    if (!record) return false;
    const key = roadRecordKey(record.x, record.y);
    if (!lazyRoadStore.recordsByKey.has(key)) {
        lazyRoadStore.recordsByKey.set(key, record);
    }
    if (loaded) {
        lazyRoadStore.loadedKeys.add(key);
    }
    markMinimapStaticDirty();
    return true;
}
function registerLazyTreeRecord(data, loaded = false) {
    const record = toTreeSaveRecord(data);
    if (!record) return false;
    const key = roadRecordKey(record.x, record.y);
    if (!lazyTreeStore.recordsByKey.has(key)) {
        lazyTreeStore.recordsByKey.set(key, record);
    }
    if (loaded) {
        lazyTreeStore.loadedKeys.add(key);
    }
    markMinimapStaticDirty();
    return true;
}

function unregisterLazyRoadRecordAt(x, y) {
    const key = roadRecordKey(x, y);
    lazyRoadStore.recordsByKey.delete(key);
    lazyRoadStore.loadedKeys.delete(key);
    markMinimapStaticDirty();
}

function unregisterLazyTreeRecordAt(x, y) {
    const key = roadRecordKey(x, y);
    lazyTreeStore.recordsByKey.delete(key);
    lazyTreeStore.loadedKeys.delete(key);
    markMinimapStaticDirty();
}

function getLazyRoadRecordsForMinimap() {
    return Array.from(lazyRoadStore.recordsByKey.values());
}

function getLazyTreeRecordsForMinimap() {
    return Array.from(lazyTreeStore.recordsByKey.values());
}

function getAllRoadSaveRecords(loadedRoadRecords = []) {
    const out = [];
    const seen = new Set();

    if (Array.isArray(loadedRoadRecords)) {
        loadedRoadRecords.forEach(record => {
            const normalized = toRoadSaveRecord(record);
            if (!normalized) return;
            const key = roadRecordKey(normalized.x, normalized.y);
            if (seen.has(key)) return;
            seen.add(key);
            out.push(normalized);
        });
    }

    lazyRoadStore.recordsByKey.forEach((record, key) => {
        if (seen.has(key)) return;
        seen.add(key);
        out.push(record);
    });

    return out;
}
function getAllTreeSaveRecords(loadedTreeRecords = []) {
    const out = [];
    const seen = new Set();

    if (Array.isArray(loadedTreeRecords)) {
        loadedTreeRecords.forEach(record => {
            const normalized = toTreeSaveRecord(record);
            if (!normalized) return;
            const key = roadRecordKey(normalized.x, normalized.y);
            if (seen.has(key)) return;
            seen.add(key);
            out.push(normalized);
        });
    }

    lazyTreeStore.recordsByKey.forEach((record, key) => {
        if (seen.has(key)) return;
        seen.add(key);
        out.push(record);
    });

    return out;
}

function getLazyTreeHydrationEnvelope(record) {
    const size = Math.max(0.05, Number(record && record.size) || 4);
    const width = size;
    const height = size;
    const topLift = Math.max(0.25, height * 0.2);
    return {
        halfWidth: width * 0.5,
        aboveBase: height + topLift,
        belowBase: 0
    };
}

function hydrateVisibleLazyRoads(options = {}) {
    if (!map || !viewport || lazyRoadStore.recordsByKey.size === 0) return 0;
    const maxPerFrame = Number.isFinite(options.maxPerFrame) ? Math.max(1, Math.floor(options.maxPerFrame)) : 48;
    const paddingWorld = Number.isFinite(options.paddingWorld) ? Math.max(0, options.paddingWorld) : 8;
    const camera = viewport;
    const centerX = camera.x + viewport.width * 0.5;
    const centerY = camera.y + viewport.height * 0.5;
    const maxX = viewport.width * 0.5 + paddingWorld;
    const maxY = viewport.height * 0.5 + paddingWorld;

    let hydrated = 0;
    for (const [key, record] of lazyRoadStore.recordsByKey) {
        if (lazyRoadStore.loadedKeys.has(key)) continue;
        const dx = (map && typeof map.shortestDeltaX === "function")
            ? map.shortestDeltaX(centerX, record.x)
            : (record.x - centerX);
        const dy = (map && typeof map.shortestDeltaY === "function")
            ? map.shortestDeltaY(centerY, record.y)
            : (record.y - centerY);
        if (Math.abs(dx) > maxX || Math.abs(dy) > maxY) continue;
        const created = StaticObject.loadJson(record, map);
        if (created) {
            lazyRoadStore.loadedKeys.add(key);
            hydrated += 1;
            if (hydrated >= maxPerFrame) break;
        }
    }
    return hydrated;
}
function hydrateVisibleLazyTrees(options = {}) {
    if (!map || !viewport || lazyTreeStore.recordsByKey.size === 0) return 0;
    const maxPerFrame = Number.isFinite(options.maxPerFrame) ? Math.max(1, Math.floor(options.maxPerFrame)) : 48;
    const paddingWorld = Number.isFinite(options.paddingWorld) ? Math.max(0, options.paddingWorld) : 8;
    const camera = viewport;
    const centerX = camera.x + viewport.width * 0.5;
    const centerY = camera.y + viewport.height * 0.5;
    const maxX = viewport.width * 0.5 + paddingWorld;
    const maxY = viewport.height * 0.5 + paddingWorld;

    let hydrated = 0;
    for (const [key, record] of lazyTreeStore.recordsByKey) {
        if (lazyTreeStore.loadedKeys.has(key)) continue;
        const envelope = getLazyTreeHydrationEnvelope(record);
        const dx = (map && typeof map.shortestDeltaX === "function")
            ? map.shortestDeltaX(centerX, record.x)
            : (record.x - centerX);
        const dy = (map && typeof map.shortestDeltaY === "function")
            ? map.shortestDeltaY(centerY, record.y)
            : (record.y - centerY);
        const withinX = Math.abs(dx) <= (maxX + envelope.halfWidth);
        const withinY = (dy - envelope.aboveBase) <= maxY && (dy + envelope.belowBase) >= -maxY;
        if (!withinX || !withinY) continue;
        const created = StaticObject.loadJson(record, map);
        if (created) {
            lazyTreeStore.loadedKeys.add(key);
            hydrated += 1;
            if (hydrated >= maxPerFrame) break;
        }
    }
    return hydrated;
}

if (typeof globalThis !== "undefined") {
    globalThis.hydrateVisibleLazyRoads = hydrateVisibleLazyRoads;
    globalThis.hydrateVisibleLazyTrees = hydrateVisibleLazyTrees;
    globalThis.unregisterLazyRoadRecordAt = unregisterLazyRoadRecordAt;
    globalThis.unregisterLazyTreeRecordAt = unregisterLazyTreeRecordAt;
    globalThis.getLazyRoadRecordsForMinimap = getLazyRoadRecordsForMinimap;
    globalThis.getLazyTreeRecordsForMinimap = getLazyTreeRecordsForMinimap;
}

function encodeGroundTiles(mapRef) {
    if (!mapRef || !mapRef.nodes) return null;
    let out = "";
    for (let y = 0; y < mapRef.height; y++) {
        for (let x = 0; x < mapRef.width; x++) {
            const node = mapRef.nodes[x] && mapRef.nodes[x][y] ? mapRef.nodes[x][y] : null;
            const textureId = node && Number.isFinite(node.groundTextureId) ? node.groundTextureId : 0;
            out += Math.max(0, Math.min(35, textureId)).toString(36);
        }
    }
    return {
        encoding: "base36-char-grid",
        width: mapRef.width,
        height: mapRef.height,
        data: out
    };
}

function decodeGroundTiles(mapRef, encoded) {
    if (!mapRef || !encoded || encoded.encoding !== "base36-char-grid" || typeof encoded.data !== "string") {
        return false;
    }
    if (encoded.width !== mapRef.width || encoded.height !== mapRef.height) {
        return false;
    }
    const expectedLen = mapRef.width * mapRef.height;
    if (encoded.data.length < expectedLen) return false;

    let i = 0;
    for (let y = 0; y < mapRef.height; y++) {
        for (let x = 0; x < mapRef.width; x++) {
            const node = mapRef.nodes[x] && mapRef.nodes[x][y] ? mapRef.nodes[x][y] : null;
            if (!node) {
                i += 1;
                continue;
            }
            const v = parseInt(encoded.data[i], 36);
            node.groundTextureId = Number.isFinite(v) ? v : 0;
            i += 1;
        }
    }
    return true;
}

function getSavedLosMazeModeValue() {
    if (typeof globalThis === "undefined") return null;
    const settings = globalThis.LOSVisualSettings;
    if (!settings || typeof settings !== "object") return null;
    if (typeof settings.mazeMode !== "boolean") return null;
    return settings.mazeMode;
}

function applySavedLosMazeModeValue(value) {
    if (typeof value !== "boolean") return;

    if (typeof globalThis !== "undefined" && typeof globalThis.setLosMazeModeEnabled === "function") {
        globalThis.setLosMazeModeEnabled(value);
        return;
    }

    if (typeof globalThis !== "undefined") {
        const settings = globalThis.LOSVisualSettings;
        if (settings && typeof settings === "object") {
            settings.mazeMode = value;
        }
    }
}

function saveGameState() {
    if (!wizard || !map || !animals) {
        console.error("Cannot save: wizard, map, or animals not initialized");
        return null;
    }

    const roofList = (typeof globalThis !== "undefined" && Array.isArray(globalThis.roofs))
        ? globalThis.roofs
        : [];

    const saveData = {
        version: 1,
        timestamp: new Date().toISOString(),
        wizard: wizard.saveJson(),
        los: {
            mazeMode: getSavedLosMazeModeValue()
        },
        animals: animals
            .filter(animal => animal && !animal.gone && !animal.vanishing)
            .map(animal => animal.saveJson()),
        staticObjects: [],
        groundTiles: encodeGroundTiles(map),
        clearanceMap: (typeof map.serializeClearance === "function")
            ? map.serializeClearance()
            : null,
        roof: null,
        powerups: (typeof globalThis !== "undefined" && Array.isArray(globalThis.powerups))
            ? globalThis.powerups
                .filter(p => p && !p.gone && !p.collected && typeof p.saveJson === "function")
                .map(p => p.saveJson())
            : []
    };

    const loadedRoadRecords = [];
    const loadedTreeRecords = [];
    // Collect all static objects from the map (dedupe by object identity)
    const seenStaticObjects = new Set();
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
            if (!node || !node.objects || node.objects.length === 0) continue;

            node.objects.forEach(obj => {
                if (obj && !obj.gone && !obj.vanishing && !seenStaticObjects.has(obj)) {
                    seenStaticObjects.add(obj);
                    if (obj.type === 'road') {
                        const roadRecord = toRoadSaveRecord(obj);
                        if (roadRecord) loadedRoadRecords.push(roadRecord);
                        return;
                    }
                    if (obj.type === 'tree') {
                        const treeRecord = toTreeSaveRecord(obj);
                        if (treeRecord) loadedTreeRecords.push(treeRecord);
                        return;
                    }
                    if (typeof obj.saveJson === "function") {
                        saveData.staticObjects.push(obj.saveJson());
                    }
                }
            });
        }
    }
    saveData.staticObjects.push(...getAllRoadSaveRecords(loadedRoadRecords));
    saveData.staticObjects.push(...getAllTreeSaveRecords(loadedTreeRecords));
    const seenRoofs = new Set();
    for (let i = 0; i < roofList.length; i++) {
        const roofObj = roofList[i];
        if (!roofObj || roofObj.gone || roofObj.vanishing || seenRoofs.has(roofObj)) continue;
        seenRoofs.add(roofObj);
        if (typeof roofObj.saveJson === "function") {
            saveData.staticObjects.push(roofObj.saveJson());
        }
    }

    return saveData;
}

function parseSavedGameState(rawSaveData) {
    if (rawSaveData === null || rawSaveData === undefined) {
        return { ok: false, reason: "missing" };
    }

    const raw = String(rawSaveData).trim();
    if (!raw) {
        return { ok: false, reason: "empty" };
    }

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
            return { ok: false, reason: "not-object" };
        }
        return { ok: true, data: parsed };
    } catch (e) {
        return { ok: false, reason: "invalid-json", error: e };
    }
}

function buildRestoreStaticObjectKey(objData, index = -1) {
    if (!objData || typeof objData !== "object") return `__invalid__|${index}`;
    const type = (typeof objData.type === "string" && objData.type.length > 0)
        ? objData.type
        : "unknown";
    const x = Number.isFinite(objData.x) ? Number(objData.x).toFixed(3) : "";
    const y = Number.isFinite(objData.y) ? Number(objData.y).toFixed(3) : "";

    if (type === "road") {
        const fill = (typeof objData.fillTexturePath === "string") ? objData.fillTexturePath : "";
        return `road|${x}|${y}|${fill}`;
    }

    if (type === "tree") {
        const size = Number.isFinite(objData.size) ? Number(objData.size).toFixed(3) : "";
        const tex = Number.isInteger(objData.textureIndex) ? String(objData.textureIndex) : "";
        const hp = Number.isFinite(objData.hp) ? Number(objData.hp).toFixed(2) : "";
        const fire = (typeof objData.isOnFire === "boolean") ? String(objData.isOnFire) : "";
        return `tree|${x}|${y}|${size}|${tex}|${hp}|${fire}`;
    }

    if (type === "wallSection") {
        const id = Number.isInteger(objData.id) ? String(objData.id) : "";
        const h = Number.isFinite(objData.height) ? Number(objData.height).toFixed(3) : "";
        const t = Number.isFinite(objData.thickness) ? Number(objData.thickness).toFixed(3) : "";
        const bz = Number.isFinite(objData.bottomZ) ? Number(objData.bottomZ).toFixed(3) : "";
        const pa = Number.isFinite(objData.texturePhaseA) ? Number(objData.texturePhaseA).toFixed(4) : "";
        const pb = Number.isFinite(objData.texturePhaseB) ? Number(objData.texturePhaseB).toFixed(4) : "";
        const sp = objData.startPoint || null;
        const ep = objData.endPoint || null;
        const spx = Number.isFinite(sp && sp.x) ? Number(sp.x).toFixed(3) : "";
        const spy = Number.isFinite(sp && sp.y) ? Number(sp.y).toFixed(3) : "";
        const epx = Number.isFinite(ep && ep.x) ? Number(ep.x).toFixed(3) : "";
        const epy = Number.isFinite(ep && ep.y) ? Number(ep.y).toFixed(3) : "";
        return `wallSection|${id}|${spx}|${spy}|${epx}|${epy}|${h}|${t}|${bz}|${pa}|${pb}`;
    }

    if (type === "roof") {
        const z = Number.isFinite(objData.z) ? Number(objData.z).toFixed(3) : "";
        const vertCount = Array.isArray(objData.vertices) ? objData.vertices.length : 0;
        const triCount = Array.isArray(objData.triangles) ? objData.triangles.length : 0;
        return `roof|${x}|${y}|${z}|${vertCount}|${triCount}`;
    }

    // Safety fallback for less common object shapes.
    return `${type}|${x}|${y}|${index}`;
}

function getSavedGameState() {
    const raw = localStorage.getItem("survivor_save");
    return parseSavedGameState(raw);
}

function sanitizeSavedGameState() {
    const parsed = getSavedGameState();
    if (parsed.ok || parsed.reason === "missing") return parsed;

    console.warn("Removing invalid survivor_save from localStorage:", parsed.reason);
    localStorage.removeItem("survivor_save");
    return parsed;
}

function loadGameState(saveData) {
    if (!saveData || !saveData.wizard || !map) {
        console.error("Invalid save data");
        return false;
    }

    const _lt0 = performance.now();
    try {
        if (typeof globalThis !== "undefined") {
            globalThis.lastLoadGameStateError = null;
        }

        // Suppress per-tile incremental clearance updates while bulk-loading
        // objects — we will restore the entire clearance map at the end.
        if (map) map._suppressClearanceUpdates = true;
        const destroyDisplayObject = (displayObj) => {
            if (!displayObj) return;
            if (displayObj.parent && typeof displayObj.parent.removeChild === "function") {
                displayObj.parent.removeChild(displayObj);
            }
            if (typeof displayObj.destroy === "function") {
                try {
                    const isSprite = (typeof PIXI !== "undefined") && (displayObj instanceof PIXI.Sprite);
                    if (isSprite) {
                        displayObj.destroy({ children: true, texture: false, baseTexture: false });
                    } else {
                        displayObj.destroy({ children: true });
                    }
                } catch (e) {
                    try {
                        displayObj.destroy();
                    } catch (_ignored) {}
                }
            }
        };
        resetLazyRoadStore();
        resetLazyTreeStore();
        // Clear active projectiles and timers from previous runtime state
        if (Array.isArray(projectiles)) {
            projectiles.forEach(projectile => {
                if (!projectile) return;
                if (projectile.castInterval) clearInterval(projectile.castInterval);
                if (projectile.explodeInterval) clearInterval(projectile.explodeInterval);
                if (projectile.vanishTimeout) clearTimeout(projectile.vanishTimeout);
                if (projectile.pixiSprite && projectile.pixiSprite.parent) {
                    projectile.pixiSprite.parent.removeChild(projectile.pixiSprite);
                }
                destroyDisplayObject(projectile.pixiSprite);
            });
            projectiles.length = 0;
        }

        // Load wizard state
        const _lt1 = performance.now();
        console.log(`[LOAD TIMING] cleanup: ${(_lt1 - _lt0).toFixed(1)}ms`);
        if (wizard) {
            wizard.loadJson(saveData.wizard);
        }

        const mazeModeFromSave = (
            saveData.los && typeof saveData.los === "object" && typeof saveData.los.mazeMode === "boolean"
        )
            ? saveData.los.mazeMode
            : (typeof saveData.mazeMode === "boolean" ? saveData.mazeMode : null);
        applySavedLosMazeModeValue(mazeModeFromSave);

        // Clear existing animals and fully stop their timers before load.
        animals.forEach(animal => {
            if (!animal) return;
            if (typeof animal.delete === "function") {
                animal.delete();
            } else {
                animal.gone = true;
                destroyDisplayObject(animal.pixiSprite);
                destroyDisplayObject(animal.fireSprite);
            }
        });
        animals.length = 0;

        // Clear existing powerups before restoring from save.
        if (typeof globalThis !== "undefined" && Array.isArray(globalThis.powerups)) {
            globalThis.powerups.forEach(p => {
                if (!p) return;
                if (p.pixiSprite) {
                    if (p.pixiSprite.parent) p.pixiSprite.parent.removeChild(p.pixiSprite);
                    destroyDisplayObject(p.pixiSprite);
                }
                p.gone = true;
            });
            globalThis.powerups.length = 0;
        }

        // Restore animals
        const _lt2 = performance.now();
        console.log(`[LOAD TIMING] wizard + clear animals: ${(_lt2 - _lt1).toFixed(1)}ms`);
        if (saveData.animals && Array.isArray(saveData.animals)) {
            saveData.animals.forEach(animalData => {
                if (!animalData || animalData.gone || animalData.vanishing) return;
                const animal = Animal.loadJson(animalData, map);
                if (animal) {
                    animals.push(animal);
                }
            });
        }

        // Clear existing static objects (dedupe references shared across nodes)
        const _lt3 = performance.now();
        console.log(`[LOAD TIMING] restore animals: ${(_lt3 - _lt2).toFixed(1)}ms`);

        // Restore placed powerups
        if (saveData.powerups && Array.isArray(saveData.powerups)) {
            if (typeof globalThis !== "undefined") {
                if (!Array.isArray(globalThis.powerups)) globalThis.powerups = [];
                saveData.powerups.forEach(pData => {
                    if (!pData || typeof pData !== "object") return;
                    if (typeof Powerup !== "undefined" && typeof Powerup.loadJson === "function") {
                        const p = Powerup.loadJson(pData);
                        if (p) globalThis.powerups.push(p);
                    }
                });
            }
        }

        const existingStaticObjects = new Set();
        for (let x = 0; x < map.width; x++) {
            for (let y = 0; y < map.height; y++) {
                const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
                if (!node || !node.objects || node.objects.length === 0) continue;

                node.objects.forEach(obj => {
                    if (obj && !obj.gone) existingStaticObjects.add(obj);
                });
            }
        }
        existingStaticObjects.forEach(obj => {
            obj.gone = true;
            if (typeof obj.removeFromMapNodes === "function") {
                obj.removeFromMapNodes();
            } else if (typeof obj.removeFromNodes === "function") {
                obj.removeFromNodes();
            }
            if (obj && obj.map && Array.isArray(obj.map.objects)) {
                const idx = obj.map.objects.indexOf(obj);
                if (idx >= 0) obj.map.objects.splice(idx, 1);
            }
            if (obj && obj.type === "wallSection" && typeof obj.destroy === "function") {
                obj.destroy();
            }
            destroyDisplayObject(obj.pixiSprite);
            destroyDisplayObject(obj.fireSprite);
        });

        // Clear existing runtime roofs (roofs are not node-registered).
        const existingRoofs = (typeof globalThis !== "undefined" && Array.isArray(globalThis.roofs))
            ? globalThis.roofs.slice()
            : [];
        existingRoofs.forEach(roofObj => {
            if (!roofObj) return;
            roofObj.gone = true;
            destroyDisplayObject(roofObj.pixiMesh);
            if (roofObj.map && Array.isArray(roofObj.map.objects)) {
                const idx = roofObj.map.objects.indexOf(roofObj);
                if (idx >= 0) roofObj.map.objects.splice(idx, 1);
            }
        });
        if (typeof globalThis !== "undefined") {
            if (!Array.isArray(globalThis.roofs)) {
                globalThis.roofs = [];
            } else {
                globalThis.roofs.length = 0;
            }
            globalThis.roof = null;
        }

        // Drop road-generated runtime caches now that old instances are gone.
        if (typeof Road !== "undefined") {
            if (typeof Road.clearRuntimeCaches === "function") {
                Road.clearRuntimeCaches({ destroyTextures: true });
            } else {
                if (Road._textureCache && typeof Road._textureCache.clear === "function") {
                    Road._textureCache.clear();
                }
                if (Road._geometryCache && typeof Road._geometryCache.clear === "function") {
                    Road._geometryCache.clear();
                }
            }
        }

        // Restore static objects (dedupe entries in save payload for backward compatibility)
        const _lt4 = performance.now();
        console.log(`[LOAD TIMING] clear static objects: ${(_lt4 - _lt3).toFixed(1)}ms`);
        if (saveData.staticObjects && Array.isArray(saveData.staticObjects)) {
            const _st0 = performance.now();
            const loadedWallSections = [];
            const loadedRoofs = [];
            const restoredKeys = new Set();
            saveData.staticObjects.forEach((objData, index) => {
                const key = buildRestoreStaticObjectKey(objData, index);
                if (restoredKeys.has(key)) return;
                restoredKeys.add(key);

                if (objData && objData.type === 'road') {
                    registerLazyRoadRecord(objData, false);
                    return;
                }
                if (objData && objData.type === 'tree') {
                    registerLazyTreeRecord(objData, false);
                    return;
                }

                let obj = null;
                if (
                    objData.type === 'wallSection' &&
                    typeof WallSectionUnit !== 'undefined' &&
                    WallSectionUnit &&
                    typeof WallSectionUnit.loadJson === 'function'
                ) {
                    obj = WallSectionUnit.loadJson(objData, map, { deferSetup: true });
                    if (obj && !obj.gone) {
                        loadedWallSections.push(obj);
                    }
                } else if (
                    objData.type === 'roof' &&
                    typeof Roof !== 'undefined' &&
                    Roof &&
                    typeof Roof.loadJson === 'function'
                ) {
                    obj = Roof.loadJson(objData);
                    if (obj && !obj.gone) {
                        obj.map = map;
                        if (Array.isArray(map.objects)) {
                            map.objects.push(obj);
                        }
                        loadedRoofs.push(obj);
                    }
                } else if (objData.type !== 'wall') {
                    obj = StaticObject.loadJson(objData, map);
                }
                if (obj) {
                    // Objects handle their own node registration
                }
            });
            const _st1 = performance.now();
            console.log(`[LOAD TIMING]   forEach restore loop: ${(_st1 - _st0).toFixed(1)}ms`);

            // Batch wall setup: addToMapNodes in a single O(N) pass,
            // then batch joinery (O(N) via endpoint index) + rebuildMesh3d.
            if (loadedWallSections.length > 0) {
                for (let i = 0; i < loadedWallSections.length; i++) {
                    const section = loadedWallSections[i];
                    if (!section || section.gone) continue;
                    section.addToMapNodes();
                }
                const _wt0 = performance.now();
                console.log(`[LOAD TIMING]   wall batch addToMapNodes (${loadedWallSections.length}): ${(_wt0 - _st1).toFixed(1)}ms`);

                // Batch joinery: builds endpoint→walls index once, processes
                // each shared endpoint exactly once. O(N) total.
                if (typeof WallSectionUnit.batchHandleJoinery === "function") {
                    WallSectionUnit.batchHandleJoinery(loadedWallSections);
                } else {
                    // Fallback: plain rebuildMesh3d without joinery
                    for (let i = 0; i < loadedWallSections.length; i++) {
                        if (loadedWallSections[i] && !loadedWallSections[i].gone) {
                            loadedWallSections[i].rebuildMesh3d();
                        }
                    }
                }
                console.log(`[LOAD TIMING]   wall batch joinery+mesh (${loadedWallSections.length}): ${(performance.now() - _wt0).toFixed(1)}ms`);
            }

            if (loadedRoofs.length > 0) {
                if (typeof globalThis !== "undefined") {
                    if (!Array.isArray(globalThis.roofs)) globalThis.roofs = [];
                    for (let i = 0; i < loadedRoofs.length; i++) {
                        globalThis.roofs.push(loadedRoofs[i]);
                    }
                    globalThis.roof = loadedRoofs[loadedRoofs.length - 1] || null;
                }
            }
        }

        if (saveData.groundTiles) {
            decodeGroundTiles(map, saveData.groundTiles);
        }
        const _lt5 = performance.now();
        console.log(`[LOAD TIMING] restore static objects + ground: ${(_lt5 - _lt4).toFixed(1)}ms`);

        hydrateVisibleLazyRoads({ maxPerFrame: 192, paddingWorld: 12 });
        hydrateVisibleLazyTrees({ maxPerFrame: 256, paddingWorld: 12 });

        // Repair any stale blocking counters from older runtime versions.
        for (let x = 0; x < map.width; x++) {
            for (let y = 0; y < map.height; y++) {
                const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
                if (!node) continue;
                if (typeof node.recountBlockingObjects === "function") {
                    node.recountBlockingObjects();
                }
            }
        }

        // Restore clearance from saved data (fast) or recompute from scratch.
        map._suppressClearanceUpdates = false;
        const _lt6 = performance.now();
        console.log(`[LOAD TIMING] recount blocking: ${(_lt6 - _lt5).toFixed(1)}ms`);
        if (saveData.clearanceMap &&
            typeof map.deserializeClearance === "function" &&
            map.deserializeClearance(saveData.clearanceMap)) {
            // Clearance restored from cache — no BFS needed.
            console.log("Clearance map restored from save data.");
        } else {
            // No cached clearance (old save) — full recompute.
            console.log("No cached clearance map; running full recompute…");
            if (typeof map.computeClearance === "function") {
                map.computeClearance();
            }
        }
        const _lt7 = performance.now();
        console.log(`[LOAD TIMING] clearance restore/compute: ${(_lt7 - _lt6).toFixed(1)}ms`);
        console.log(`[LOAD TIMING] TOTAL loadGameState: ${(_lt7 - _lt0).toFixed(1)}ms`);

        // Run __init scripts for all loaded objects that have them.
        if (typeof globalThis !== "undefined" && globalThis.Scripting &&
            typeof globalThis.Scripting.runObjectInitScript === "function") {
            const initTargets = (typeof map.getGameObjects === "function")
                ? map.getGameObjects({ refresh: true })
                : [];
            let initCount = 0;
            for (let i = 0; i < initTargets.length; i++) {
                const obj = initTargets[i];
                if (!obj || obj.gone) continue;
                const scriptTag = obj.script;
                if (!scriptTag || typeof scriptTag !== "object") continue;
                if (typeof scriptTag.__init !== "string" || !scriptTag.__init.trim().length) continue;
                globalThis.Scripting.runObjectInitScript(obj, wizard, { reason: "saveLoaded" });
                initCount++;
            }
            if (initCount > 0) {
                console.log(`[LOAD] Ran __init scripts for ${initCount} object(s).`);
            }
        }

        // Backward compatibility: restore legacy singleton roof when no roofs were loaded.
        const hasLoadedRoofs = (typeof globalThis !== "undefined" && Array.isArray(globalThis.roofs) && globalThis.roofs.length > 0);
        if (!hasLoadedRoofs && saveData.roof && typeof Roof !== 'undefined' && typeof Roof.loadJson === 'function') {
            const loadedRoof = Roof.loadJson(saveData.roof);
            if (loadedRoof) {
                loadedRoof.map = map;
                if (Array.isArray(map.objects)) {
                    map.objects.push(loadedRoof);
                }
                if (typeof globalThis !== "undefined") {
                    if (!Array.isArray(globalThis.roofs)) globalThis.roofs = [];
                    globalThis.roofs.length = 0;
                    globalThis.roofs.push(loadedRoof);
                    globalThis.roof = loadedRoof;
                }
            }
        }

        // Wizard.loadJson restores viewport (or centers when missing in old saves)
        if (typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
            globalThis.presentGameFrame();
        }

        return true;
    } catch (e) {
        console.error("Error loading game state:", e);
        // Ensure the suppression flag is always cleared even on error.
        if (map) map._suppressClearanceUpdates = false;
        if (typeof globalThis !== "undefined") {
            globalThis.lastLoadGameStateError = e;
        }
        return false;
    }
}

function downloadSaveFile(filenamePrefix = "survivor-save") {
    if (typeof window === "undefined" || typeof document === "undefined") {
        return false;
    }

    const saveData = saveGameState();
    if (!saveData) return false;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${filenamePrefix}-${timestamp}.json`;
    const payload = JSON.stringify(saveData, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    return true;
}

function importSaveFile(file) {
    return new Promise((resolve) => {
        if (!file) {
            resolve({ ok: false, reason: "no-file" });
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const parsed = parseSavedGameState(reader.result);
            if (!parsed.ok) {
                resolve(parsed);
                return;
            }

            const loaded = loadGameState(parsed.data);
            resolve(loaded ? { ok: true } : { ok: false, reason: "load-failed" });
        };
        reader.onerror = () => resolve({ ok: false, reason: "read-failed", error: reader.error });
        reader.readAsText(file);
    });
}

function pickAndLoadSaveFile() {
    return new Promise((resolve) => {
        if (typeof document === "undefined") {
            resolve({ ok: false, reason: "no-document" });
            return;
        }

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json,.json";
        input.style.display = "none";
        document.body.appendChild(input);

        input.addEventListener("change", () => {
            const file = input.files && input.files[0] ? input.files[0] : null;
            importSaveFile(file).then(result => {
                document.body.removeChild(input);
                resolve(result);
            });
        }, { once: true });

        input.click();
    });
}

async function saveGameStateToServerFile() {
    const saveData = saveGameState();
    if (!saveData) return { ok: false, reason: "save-failed" };

    try {
        const response = await fetch('/api/savefile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(saveData)
        });
        const payload = await response.json();
        if (!response.ok || !payload || !payload.ok) {
            return { ok: false, reason: payload && payload.reason ? payload.reason : 'request-failed' };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: "network-failed", error: e };
    }
}

async function loadGameStateFromServerFile(options = {}) {
    try {
        const qs = new URLSearchParams();
        if (options && typeof options.fileName === "string" && options.fileName.trim().length > 0) {
            qs.set("file", options.fileName.trim());
        }
        const url = qs.toString().length > 0 ? `/api/savefile?${qs.toString()}` : '/api/savefile';
        const response = await fetch(url, { method: 'GET' });
        const payload = await response.json();
        if (!response.ok || !payload || !payload.ok || !payload.data) {
            return { ok: false, reason: payload && payload.reason ? payload.reason : 'request-failed' };
        }
        const loaded = loadGameState(payload.data);
        if (loaded) return { ok: true };
        return {
            ok: false,
            reason: "load-failed",
            error: (typeof globalThis !== "undefined" && globalThis.lastLoadGameStateError)
                ? globalThis.lastLoadGameStateError
                : null
        };
    } catch (e) {
        return { ok: false, reason: "network-failed", error: e };
    }
}

// Export functions for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        saveGameState,
        loadGameState,
        parseSavedGameState,
        getSavedGameState,
        sanitizeSavedGameState,
        downloadSaveFile,
        importSaveFile,
        pickAndLoadSaveFile,
        saveGameStateToServerFile,
        loadGameStateFromServerFile,
        hydrateVisibleLazyRoads,
        hydrateVisibleLazyTrees
    };
}
