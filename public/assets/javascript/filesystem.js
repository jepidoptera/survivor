// filesystem.js - Handles saving and loading game state

const lazyRoadStore = {
    recordsByKey: new Map(),
    loadedKeys: new Set()
};
const lazyTreeStore = {
    recordsByKey: new Map(),
    loadedKeys: new Set()
};

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
    if (typeof data.fillTexturePath === 'string' && data.fillTexturePath.length > 0) {
        record.fillTexturePath = data.fillTexturePath;
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
    if (Number.isFinite(data.hp)) record.hp = Number(data.hp);
    if (typeof data.isOnFire === 'boolean') record.isOnFire = data.isOnFire;
    if (Number.isInteger(data.textureIndex)) record.textureIndex = data.textureIndex;
    if (Number.isFinite(data.size)) record.size = Number(data.size);
    return record;
}

function resetLazyRoadStore() {
    lazyRoadStore.recordsByKey.clear();
    lazyRoadStore.loadedKeys.clear();
}
function resetLazyTreeStore() {
    lazyTreeStore.recordsByKey.clear();
    lazyTreeStore.loadedKeys.clear();
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
    return true;
}

function unregisterLazyRoadRecordAt(x, y) {
    const key = roadRecordKey(x, y);
    lazyRoadStore.recordsByKey.delete(key);
    lazyRoadStore.loadedKeys.delete(key);
}

function unregisterLazyTreeRecordAt(x, y) {
    const key = roadRecordKey(x, y);
    lazyTreeStore.recordsByKey.delete(key);
    lazyTreeStore.loadedKeys.delete(key);
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

function hydrateVisibleLazyRoads(options = {}) {
    if (!map || !viewport || lazyRoadStore.recordsByKey.size === 0) return 0;
    const maxPerFrame = Number.isFinite(options.maxPerFrame) ? Math.max(1, Math.floor(options.maxPerFrame)) : 48;
    const paddingWorld = Number.isFinite(options.paddingWorld) ? Math.max(0, options.paddingWorld) : 8;
    const camera = (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
        ? interpolatedViewport
        : viewport;
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
    const camera = (typeof interpolatedViewport !== "undefined" && interpolatedViewport)
        ? interpolatedViewport
        : viewport;
    const centerX = camera.x + viewport.width * 0.5;
    const centerY = camera.y + viewport.height * 0.5;
    const maxX = viewport.width * 0.5 + paddingWorld;
    const maxY = viewport.height * 0.5 + paddingWorld;

    let hydrated = 0;
    for (const [key, record] of lazyTreeStore.recordsByKey) {
        if (lazyTreeStore.loadedKeys.has(key)) continue;
        const dx = (map && typeof map.shortestDeltaX === "function")
            ? map.shortestDeltaX(centerX, record.x)
            : (record.x - centerX);
        const dy = (map && typeof map.shortestDeltaY === "function")
            ? map.shortestDeltaY(centerY, record.y)
            : (record.y - centerY);
        if (Math.abs(dx) > maxX || Math.abs(dy) > maxY) continue;
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
    if (typeof invalidateGroundChunks === "function") {
        invalidateGroundChunks();
    }
    return true;
}

function saveGameState() {
    if (!wizard || !map || !animals) {
        console.error("Cannot save: wizard, map, or animals not initialized");
        return null;
    }

    const saveData = {
        version: 1,
        timestamp: new Date().toISOString(),
        wizard: wizard.saveJson(),
        animals: animals
            .filter(animal => animal && !animal.gone && !animal.vanishing)
            .map(animal => animal.saveJson()),
        staticObjects: [],
        groundTiles: encodeGroundTiles(map),
        roof: (roof && typeof roof.saveJson === 'function') ? roof.saveJson() : null
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
                    saveData.staticObjects.push(obj.saveJson());
                }
            });
        }
    }
    saveData.staticObjects.push(...getAllRoadSaveRecords(loadedRoadRecords));
    saveData.staticObjects.push(...getAllTreeSaveRecords(loadedTreeRecords));

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

    if (type === "wall") {
        const ax = Number.isFinite(objData.aX) ? Number(objData.aX).toFixed(3) : "";
        const ay = Number.isFinite(objData.aY) ? Number(objData.aY).toFixed(3) : "";
        const bx = Number.isFinite(objData.bX) ? Number(objData.bX).toFixed(3) : "";
        const by = Number.isFinite(objData.bY) ? Number(objData.bY).toFixed(3) : "";
        const h = Number.isFinite(objData.height) ? Number(objData.height).toFixed(3) : "";
        const t = Number.isFinite(objData.thickness) ? Number(objData.thickness).toFixed(3) : "";
        const pa = Number.isFinite(objData.texturePhaseA) ? Number(objData.texturePhaseA).toFixed(4) : "";
        const pb = Number.isFinite(objData.texturePhaseB) ? Number(objData.texturePhaseB).toFixed(4) : "";
        const sid = Number.isInteger(objData.sectionId) ? String(objData.sectionId) : "";
        return `wall|${ax}|${ay}|${bx}|${by}|${h}|${t}|${pa}|${pb}|${sid}`;
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

    try {
        if (typeof globalThis !== "undefined") {
            globalThis.lastLoadGameStateError = null;
        }
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
        if (wizard) {
            wizard.loadJson(saveData.wizard);
        }

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

        // Restore animals
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
            if (typeof obj.removeFromNodes === "function") {
                obj.removeFromNodes();
            }
            destroyDisplayObject(obj.pixiSprite);
            destroyDisplayObject(obj.fireSprite);
        });

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
        if (saveData.staticObjects && Array.isArray(saveData.staticObjects)) {
            const restoredKeys = new Set();
            const canSuspendWallRebuild = (
                typeof Wall !== "undefined" &&
                Wall &&
                typeof Wall.setBulkRebuildSuspended === "function"
            );
            if (canSuspendWallRebuild) {
                Wall.setBulkRebuildSuspended(true);
            }
            try {
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
                    if (objData.type === 'wall') {
                        obj = Wall.loadJson(objData, map);
                    } else {
                        obj = StaticObject.loadJson(objData, map);
                    }
                    if (obj) {
                        // Objects handle their own node registration
                    }
                });
            } finally {
                if (canSuspendWallRebuild) {
                    Wall.setBulkRebuildSuspended(false);
                }
            }
        }

        if (typeof Wall !== "undefined" && Wall) {
            if (typeof Wall.recomputeLineGroups === "function") {
                Wall.recomputeLineGroups(map);
            }
            if (typeof Wall.reconcilePersistedSectionIds === "function") {
                Wall.reconcilePersistedSectionIds(map);
            }
            if (typeof Wall.repairMountedSectionLinks === "function") {
                Wall.repairMountedSectionLinks(map);
            }
            if (typeof globalThis !== "undefined" && typeof globalThis.markAllWallSectionsDirty === "function") {
                globalThis.markAllWallSectionsDirty();
            }
            if (typeof globalThis !== "undefined" && typeof globalThis.queueWallSectionRebuildPass === "function") {
                globalThis.queueWallSectionRebuildPass(12);
            }
        }

        if (saveData.groundTiles) {
            decodeGroundTiles(map, saveData.groundTiles);
        }

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

        // Restore roof state from save (fallback to existing roof if missing).
        if (saveData.roof && typeof Roof !== 'undefined' && typeof Roof.loadJson === 'function') {
            destroyDisplayObject(roof && roof.pixiMesh ? roof.pixiMesh : null);
            const loadedRoof = Roof.loadJson(saveData.roof);
            if (loadedRoof) {
                roof = loadedRoof;
            }
        }

        // Wizard.loadJson restores viewport (or centers when missing in old saves)
        if (typeof clearGroundChunkCache === "function") {
            clearGroundChunkCache();
        }
        if (typeof invalidateGroundChunks === "function") {
            invalidateGroundChunks();
        }
        drawCanvas();

        return true;
    } catch (e) {
        console.error("Error loading game state:", e);
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
