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

function collectNodeSourcesForSave(mapRef, options = {}) {
    const includePrototypeNodes = options.includePrototypeNodes !== false;
    const sources = [];
    if (mapRef && Array.isArray(mapRef.nodes)) {
        sources.push({ type: "rect" });
    }
    if (
        includePrototypeNodes &&
        mapRef &&
        typeof mapRef.getAllPrototypeNodes === "function" &&
        typeof mapRef.getLoadedPrototypeNodes === "function"
    ) {
        const prototypeNodes = mapRef.getAllPrototypeNodes();
        if (Array.isArray(prototypeNodes) && prototypeNodes.length > 0) {
            sources.push({ type: "prototype", nodes: prototypeNodes });
        }
    }
    return sources;
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

const LEGACY_LOCAL_SAVE_KEY = "survivor_save";
const ACTIVE_LOCAL_SAVE_SLOT_STORAGE_KEY = "survivor_active_save_slot_v1";
const RESERVED_LOCAL_SAVE_KEYS = new Set([
    LEGACY_LOCAL_SAVE_KEY,
    ACTIVE_LOCAL_SAVE_SLOT_STORAGE_KEY,
    "survivor_game_mode"
]);

function isLikelySaveGameData(saveData) {
    return !!(saveData && typeof saveData === "object" && saveData.wizard && typeof saveData.wizard === "object");
}

function normalizeLocalSaveSlotKey(rawKey, fallback = "") {
    const normalized = String(rawKey === undefined || rawKey === null ? "" : rawKey).trim();
    if (normalized.length > 0) return normalized;
    const fallbackValue = String(fallback === undefined || fallback === null ? "" : fallback).trim();
    return fallbackValue.length > 0 ? fallbackValue : "";
}

function isReservedLocalSaveSlotKey(rawKey) {
    const normalized = normalizeLocalSaveSlotKey(rawKey);
    return normalized.length > 0 && RESERVED_LOCAL_SAVE_KEYS.has(normalized);
}

function normalizeWizardDifficultyValue(rawDifficulty, fallback = 2) {
    const parsed = Number(rawDifficulty);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(3, Math.round(parsed)));
}

function inferWizardDifficultyFromSaveData(saveData) {
    const wizardData = (saveData && saveData.wizard && typeof saveData.wizard === "object") ? saveData.wizard : null;
    if (!wizardData) return null;
    if (Number.isFinite(wizardData.difficulty)) {
        return normalizeWizardDifficultyValue(wizardData.difficulty);
    }
    if (Number.isFinite(wizardData.magicRegenPerSecond)) {
        const inferred = 8 - Number(wizardData.magicRegenPerSecond);
        if (Number.isFinite(inferred) && inferred >= 1 && inferred <= 3) {
            return normalizeWizardDifficultyValue(inferred);
        }
    }
    return null;
}

function formatWizardDifficultyLabel(rawDifficulty) {
    if (!Number.isFinite(rawDifficulty)) return "Unknown";
    const difficulty = normalizeWizardDifficultyValue(rawDifficulty);
    if (difficulty === 1) return "Easy";
    if (difficulty === 2) return "Medium";
    if (difficulty === 3) return "Hard";
    return "Unknown";
}

function getActiveLocalSaveSlotKey() {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(ACTIVE_LOCAL_SAVE_SLOT_STORAGE_KEY);
        const normalized = normalizeLocalSaveSlotKey(raw);
        return normalized.length > 0 ? normalized : null;
    } catch (_err) {
        return null;
    }
}

function setActiveLocalSaveSlotKey(saveKey) {
    if (typeof localStorage === "undefined") return false;
    const normalized = normalizeLocalSaveSlotKey(saveKey);
    if (!normalized.length) return false;
    try {
        localStorage.setItem(ACTIVE_LOCAL_SAVE_SLOT_STORAGE_KEY, normalized);
        return true;
    } catch (_err) {
        return false;
    }
}

function deleteLocalSaveSlot(saveKey) {
    if (typeof localStorage === "undefined") {
        return { ok: false, reason: "local-storage-unavailable" };
    }
    const normalized = normalizeLocalSaveSlotKey(saveKey);
    if (!normalized.length) {
        return { ok: false, reason: "missing-save-key" };
    }
    try {
        localStorage.removeItem(normalized);
        const activeKey = getActiveLocalSaveSlotKey();
        if (activeKey === normalized) {
            localStorage.removeItem(ACTIVE_LOCAL_SAVE_SLOT_STORAGE_KEY);
            const remainingEntries = getSavedGameEntries().filter(entry => entry && entry.key !== normalized);
            if (remainingEntries.length > 0) {
                setActiveLocalSaveSlotKey(remainingEntries[0].key);
            }
        }
        return { ok: true, key: normalized };
    } catch (e) {
        return { ok: false, reason: "delete-failed", error: e };
    }
}

function getPreferredLocalSaveSlotKey() {
    const activeKey = getActiveLocalSaveSlotKey();
    if (activeKey) return activeKey;
    if (typeof localStorage === "undefined") return null;
    try {
        const legacyRaw = localStorage.getItem(LEGACY_LOCAL_SAVE_KEY);
        if (legacyRaw !== null && legacyRaw !== undefined && String(legacyRaw).trim().length > 0) {
            return LEGACY_LOCAL_SAVE_KEY;
        }
    } catch (_err) {
        return null;
    }
    return null;
}

function getSavedGameEntries() {
    if (typeof localStorage === "undefined") return [];
    const entries = [];
    const activeKey = getActiveLocalSaveSlotKey();

    for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        const normalizedKey = normalizeLocalSaveSlotKey(key);
        if (!normalizedKey.length) continue;
        let raw = null;
        try {
            raw = localStorage.getItem(normalizedKey);
        } catch (_err) {
            continue;
        }
        const parsed = parseSavedGameState(raw);
        if (!parsed.ok || !isLikelySaveGameData(parsed.data)) continue;
        const difficulty = inferWizardDifficultyFromSaveData(parsed.data);
        entries.push({
            key: normalizedKey,
            wizardName: normalizeLocalSaveSlotKey(parsed.data.wizard && parsed.data.wizard.name, normalizedKey) || normalizedKey,
            difficulty,
            difficultyLabel: formatWizardDifficultyLabel(difficulty),
            timestamp: (typeof parsed.data.timestamp === "string" && parsed.data.timestamp.trim().length > 0)
                ? parsed.data.timestamp
                : null,
            isActive: normalizedKey === activeKey,
            data: parsed.data
        });
    }

    entries.sort((a, b) => {
        const timeA = a.timestamp ? Date.parse(a.timestamp) : NaN;
        const timeB = b.timestamp ? Date.parse(b.timestamp) : NaN;
        if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
            return timeB - timeA;
        }
        if (Number.isFinite(timeA) && !Number.isFinite(timeB)) return -1;
        if (!Number.isFinite(timeA) && Number.isFinite(timeB)) return 1;
        return a.key.localeCompare(b.key);
    });

    return entries;
}

const LOCAL_SAVE_COMPRESSION_PREFIX = "SVR_LZS1:";

function getLocalSaveCompressionApi() {
    if (typeof globalThis === "undefined") return null;
    const api = globalThis.LZString;
    if (!api || typeof api.compressToUTF16 !== "function" || typeof api.decompressFromUTF16 !== "function") {
        return null;
    }
    return api;
}

function serializeLocalSaveState(saveData) {
    const rawJson = JSON.stringify(saveData);
    const compressionApi = getLocalSaveCompressionApi();
    if (compressionApi) {
        const compressedBody = compressionApi.compressToUTF16(rawJson);
        const compressedPayload = LOCAL_SAVE_COMPRESSION_PREFIX + compressedBody;
        if (compressedPayload.length < rawJson.length) {
            return {
                storageValue: compressedPayload,
                compressed: true,
                rawLength: rawJson.length,
                storedLength: compressedPayload.length
            };
        }
    }
    return {
        storageValue: rawJson,
        compressed: false,
        rawLength: rawJson.length,
        storedLength: rawJson.length
    };
}

function saveGameStateToLocalStorage(saveKey) {
    if (typeof localStorage === "undefined") {
        return { ok: false, reason: "local-storage-unavailable" };
    }
    const saveData = saveGameState();
    if (!saveData) {
        return { ok: false, reason: "save-failed" };
    }
    const wizardName = (wizard && typeof wizard.name === "string") ? wizard.name : "";
    const normalizedKey = normalizeLocalSaveSlotKey(saveKey, wizardName || LEGACY_LOCAL_SAVE_KEY);
    if (!normalizedKey.length) {
        return { ok: false, reason: "missing-save-key" };
    }
    try {
        if (saveData.wizard && typeof saveData.wizard === "object") {
            saveData.wizard.name = normalizeLocalSaveSlotKey(saveData.wizard.name, normalizedKey) || normalizedKey;
            if (Number.isFinite(saveData.wizard.difficulty)) {
                saveData.wizard.difficulty = normalizeWizardDifficultyValue(saveData.wizard.difficulty);
            }
        }
        const serialized = serializeLocalSaveState(saveData);
        localStorage.setItem(normalizedKey, serialized.storageValue);
        setActiveLocalSaveSlotKey(normalizedKey);
        return {
            ok: true,
            key: normalizedKey,
            data: saveData,
            compressed: !!serialized.compressed,
            rawLength: serialized.rawLength,
            storedLength: serialized.storedLength
        };
    } catch (e) {
        const errorName = (e && typeof e.name === "string") ? e.name : "";
        const errorCode = Number(e && e.code);
        const isQuotaExceeded = errorName === "QuotaExceededError" ||
            errorName === "NS_ERROR_DOM_QUOTA_REACHED" ||
            errorCode === 22 ||
            errorCode === 1014;
        return {
            ok: false,
            reason: isQuotaExceeded ? "quota-exceeded" : "write-failed",
            error: e
        };
    }
}

function loadGameStateFromLocalStorageKey(saveKey) {
    const parsed = getSavedGameState(saveKey);
    if (!parsed.ok) return parsed;
    const loaded = loadGameState(parsed.data);
    if (!loaded) {
        return {
            ok: false,
            reason: "load-failed",
            error: (typeof globalThis !== "undefined" && globalThis.lastLoadGameStateError)
                ? globalThis.lastLoadGameStateError
                : null
        };
    }
    setActiveLocalSaveSlotKey(parsed.key);
    if (wizard) {
        wizard.name = normalizeLocalSaveSlotKey(parsed.data && parsed.data.wizard ? parsed.data.wizard.name : "", parsed.key) || parsed.key;
        if (typeof wizard.setDifficulty === "function") {
            const inferredDifficulty = inferWizardDifficultyFromSaveData(parsed.data);
            if (Number.isFinite(inferredDifficulty)) {
                wizard.setDifficulty(inferredDifficulty);
            }
        }
    }
    return { ok: true, key: parsed.key, data: parsed.data };
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

    if (map && typeof map.syncPrototypeWalls === "function") {
        try {
            map.syncPrototypeWalls();
        } catch (e) {
            console.warn("Prototype wall sync before save failed:", e);
        }
    }
    if (map && typeof map.syncPrototypeObjects === "function") {
        try {
            map.syncPrototypeObjects();
        } catch (e) {
            console.warn("Prototype object sync before save failed:", e);
        }
    }

    const loadedRoadRecords = [];
    const loadedTreeRecords = [];
    // Collect all static objects from the map (dedupe by object identity)
    const seenStaticObjects = new Set();
    const nodeSources = collectNodeSourcesForSave(map);
    for (let sourceIndex = 0; sourceIndex < nodeSources.length; sourceIndex++) {
        const source = nodeSources[sourceIndex];
        if (!source) continue;
        if (source.type === "prototype" && Array.isArray(source.nodes)) {
            for (let i = 0; i < source.nodes.length; i++) {
                const node = source.nodes[i];
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
                        if (
                            map &&
                            map._prototypeSectionState &&
                            ((obj.type === "wallSection") || obj._prototypeObjectManaged === true)
                        ) {
                            return;
                        }
                        if (typeof obj.saveJson === "function") {
                            saveData.staticObjects.push(obj.saveJson());
                        }
                    }
                });
            }
            continue;
        }
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
                        if (
                            map &&
                            map._prototypeSectionState &&
                            ((obj.type === "wallSection") || obj._prototypeObjectManaged === true)
                        ) {
                            return;
                        }
                        if (typeof obj.saveJson === "function") {
                            saveData.staticObjects.push(obj.saveJson());
                        }
                    }
                });
            }
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

    if (map && map._prototypeSectionState) {
        const state = map._prototypeSectionState;
        const activeKeys = (typeof map.getPrototypeActiveSectionKeys === "function")
            ? Array.from(map.getPrototypeActiveSectionKeys())
            : [];
        const loadedSectionKeys = activeKeys.filter((key) => typeof key === "string" && key.length > 0);
        const sections = [];

        for (let i = 0; i < loadedSectionKeys.length; i++) {
            const sectionKey = loadedSectionKeys[i];
            const asset = (typeof map.getPrototypeSectionAsset === "function")
                ? map.getPrototypeSectionAsset(sectionKey)
                : null;
            if (!asset) continue;

            const sectionNodes = state.nodesBySectionKey instanceof Map
                ? (state.nodesBySectionKey.get(sectionKey) || [])
                : [];
            const groundTiles = {};
            for (let n = 0; n < sectionNodes.length; n++) {
                const node = sectionNodes[n];
                if (!node) continue;
                groundTiles[`${node.xindex},${node.yindex}`] = Number.isFinite(node.groundTextureId)
                    ? Number(node.groundTextureId)
                    : 0;
            }

            sections.push({
                id: asset.id,
                key: asset.key,
                coord: asset.coord ? { q: Number(asset.coord.q) || 0, r: Number(asset.coord.r) || 0 } : { q: 0, r: 0 },
                centerAxial: asset.centerAxial ? { q: Number(asset.centerAxial.q) || 0, r: Number(asset.centerAxial.r) || 0 } : { q: 0, r: 0 },
                centerOffset: asset.centerOffset ? { x: Number(asset.centerOffset.x) || 0, y: Number(asset.centerOffset.y) || 0 } : { x: 0, y: 0 },
                neighborKeys: Array.isArray(asset.neighborKeys) ? asset.neighborKeys.slice() : [],
                tileCoordKeys: Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys.slice() : [],
                groundTextureId: Number.isFinite(asset.groundTextureId) ? Number(asset.groundTextureId) : 0,
                groundTiles,
                walls: Array.isArray(asset.walls) ? asset.walls.map((wall) => ({ ...wall })) : [],
                objects: Array.isArray(asset.objects) ? asset.objects.map((obj) => ({ ...obj })) : []
            });
        }

        saveData.prototypeSectionWorld = {
            version: 1,
            radius: Number.isFinite(state.radius) ? Number(state.radius) : 0,
            sectionGraphRadius: Number.isFinite(state.sectionGraphRadius) ? Number(state.sectionGraphRadius) : 0,
            anchorCenter: state.anchorCenter ? { q: Number(state.anchorCenter.q) || 0, r: Number(state.anchorCenter.r) || 0 } : { q: 0, r: 0 },
            activeCenterKey: typeof state.activeCenterKey === "string" ? state.activeCenterKey : "",
            loadedSectionKeys,
            sections
        };
    }

    return saveData;
}

function parseSavedGameState(rawSaveData) {
    if (rawSaveData === null || rawSaveData === undefined) {
        return { ok: false, reason: "missing" };
    }

    const raw = String(rawSaveData);
    if (!raw.trim()) {
        return { ok: false, reason: "empty" };
    }

    if (raw.startsWith(LOCAL_SAVE_COMPRESSION_PREFIX)) {
        try {
            const compressionApi = getLocalSaveCompressionApi();
            if (!compressionApi) {
                return { ok: false, reason: "compression-library-unavailable" };
            }
            const decoded = compressionApi.decompressFromUTF16(raw.slice(LOCAL_SAVE_COMPRESSION_PREFIX.length));
            if (typeof decoded !== "string" || !decoded.length) {
                return { ok: false, reason: "invalid-compressed-save" };
            }
            const parsed = JSON.parse(decoded);
            if (!parsed || typeof parsed !== "object") {
                return { ok: false, reason: "not-object" };
            }
            return { ok: true, data: parsed, compressed: true };
        } catch (e) {
            return { ok: false, reason: "invalid-compressed-save", error: e };
        }
    }

    try {
        const parsed = JSON.parse(raw.trim());
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

function getSavedGameState(saveKey = null) {
    const resolvedKey = normalizeLocalSaveSlotKey(saveKey, getPreferredLocalSaveSlotKey());
    if (!resolvedKey.length || typeof localStorage === "undefined") {
        return { ok: false, reason: "missing" };
    }
    let raw = null;
    try {
        raw = localStorage.getItem(resolvedKey);
    } catch (e) {
        return { ok: false, reason: "read-failed", error: e, key: resolvedKey };
    }
    const parsed = parseSavedGameState(raw);
    if (!parsed.ok) {
        return { ...parsed, key: resolvedKey };
    }
    if (!isLikelySaveGameData(parsed.data)) {
        return { ok: false, reason: "invalid-save-structure", key: resolvedKey };
    }
    return { ...parsed, key: resolvedKey };
}

function sanitizeSavedGameState(saveKey = null) {
    const resolvedKey = normalizeLocalSaveSlotKey(saveKey, getPreferredLocalSaveSlotKey());
    const parsed = getSavedGameState(resolvedKey);
    if (parsed.ok || parsed.reason === "missing") return parsed;

    if (resolvedKey.length > 0 && typeof localStorage !== "undefined") {
        console.warn(`Removing invalid local save '${resolvedKey}' from localStorage:`, parsed.reason);
        localStorage.removeItem(resolvedKey);
    }
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
        const clearNodeSources = collectNodeSourcesForSave(map);
        for (let sourceIndex = 0; sourceIndex < clearNodeSources.length; sourceIndex++) {
            const source = clearNodeSources[sourceIndex];
            if (!source) continue;
            if (source.type === "prototype" && Array.isArray(source.nodes)) {
                for (let i = 0; i < source.nodes.length; i++) {
                    const node = source.nodes[i];
                    if (!node || !node.objects || node.objects.length === 0) continue;
                    node.objects.forEach(obj => {
                        if (obj && !obj.gone) existingStaticObjects.add(obj);
                    });
                }
                continue;
            }
            for (let x = 0; x < map.width; x++) {
                for (let y = 0; y < map.height; y++) {
                    const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
                    if (!node || !node.objects || node.objects.length === 0) continue;

                    node.objects.forEach(obj => {
                        if (obj && !obj.gone) existingStaticObjects.add(obj);
                    });
                }
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
        if (
            saveData.prototypeSectionWorld &&
            typeof saveData.prototypeSectionWorld === "object" &&
            map &&
            typeof map.loadPrototypeSectionWorld === "function"
        ) {
            map.loadPrototypeSectionWorld(saveData.prototypeSectionWorld);
            if (typeof map.syncPrototypeWalls === "function") {
                map.syncPrototypeWalls();
            }
            if (typeof map.syncPrototypeObjects === "function") {
                map.syncPrototypeObjects();
            }
        }
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
        if (wizard) {
            wizard._triggerAreaTraversalStateById = new Map();
            wizard._scriptTouchedObjectsById = new Map();
            wizard._scriptPrevX = Number(wizard.x);
            wizard._scriptPrevY = Number(wizard.y);
            const scriptingApi = (typeof globalThis !== "undefined") ? globalThis.Scripting : null;
            if (scriptingApi && typeof scriptingApi.processTriggerAreaTraversalEvents === "function") {
                const triggerAreaEntries = [];
                const touchEntries = [];
                const mapObjects = Array.isArray(map.objects) ? map.objects : [];
                for (let i = 0; i < mapObjects.length; i++) {
                    const obj = mapObjects[i];
                    if (!obj || obj.gone || obj.vanishing) continue;
                    const hitbox = obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox || null;
                    if (!hitbox) continue;
                    if (obj.type === "triggerArea" || obj.isTriggerArea === true) {
                        triggerAreaEntries.push({ obj, hitbox });
                    }
                    touchEntries.push({ obj, hitbox, forceTouch: false });
                }
                const mapPowerups = (typeof globalThis !== "undefined" && Array.isArray(globalThis.powerups))
                    ? globalThis.powerups
                    : [];
                for (let i = 0; i < mapPowerups.length; i++) {
                    const obj = mapPowerups[i];
                    if (!obj || obj.gone || obj.vanishing || obj.collected) continue;
                    if (obj.map && wizard.map && obj.map !== wizard.map) continue;
                    const hitbox = obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox || null;
                    if (!hitbox) continue;
                    touchEntries.push({ obj, hitbox, forceTouch: false });
                }
                scriptingApi.processTriggerAreaTraversalEvents(
                    wizard,
                    wizard.x,
                    wizard.y,
                    wizard.x,
                    wizard.y,
                    triggerAreaEntries,
                    0,
                    { treatInitialOverlapAsEnter: true }
                );
                if (typeof scriptingApi.processObjectTouchEvents === "function") {
                    scriptingApi.processObjectTouchEvents(
                        wizard,
                        touchEntries,
                        Number(wizard.groundRadius) || 0,
                        { suppressTouchEvents: true }
                    );
                }
            }
        }

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

async function saveGameStateToServerFile(options = {}) {
    const saveData = saveGameState();
    if (!saveData) return { ok: false, reason: "save-failed" };

    try {
        const qs = new URLSearchParams();
        if (options && typeof options.slot === "string" && options.slot.trim().length > 0) {
            qs.set("slot", options.slot.trim());
        }
        const url = qs.toString().length > 0 ? `/api/savefile?${qs.toString()}` : '/api/savefile';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(saveData)
        });
        const payload = await response.json();
        if (!response.ok || !payload || !payload.ok) {
            return { ok: false, reason: payload && payload.reason ? payload.reason : 'request-failed' };
        }
        return {
            ok: true,
            path: payload.path || null,
            slot: payload.slot || null
        };
    } catch (e) {
        return { ok: false, reason: "network-failed", error: e };
    }
}

async function savePrototypeSectionWorldToServerSlot(slotName) {
    if (!map || typeof map.exportPrototypeSectionAssets !== "function") {
        return { ok: false, reason: "prototype-save-unavailable" };
    }
    const slot = String(slotName === undefined || slotName === null ? "" : slotName).trim();
    if (!slot) {
        return { ok: false, reason: "missing-slot" };
    }
    if (typeof map.syncPrototypeWalls === "function") {
        map.syncPrototypeWalls();
    }
    if (typeof map.syncPrototypeObjects === "function") {
        map.syncPrototypeObjects();
    }
    const activeWizard = (typeof globalThis !== "undefined" && globalThis.wizard && typeof globalThis.wizard.saveJson === "function")
        ? globalThis.wizard
        : ((typeof wizard !== "undefined" && wizard && typeof wizard.saveJson === "function") ? wizard : null);
    const wizardNode = (activeWizard && map && typeof map.worldToNode === "function")
        ? map.worldToNode(activeWizard.x, activeWizard.y)
        : null;

    const payload = {
        manifest: {
            wizard: activeWizard
                ? activeWizard.saveJson()
                : null,
            activeCenterKey: (wizardNode && typeof wizardNode._prototypeSectionKey === "string" && wizardNode._prototypeSectionKey.length > 0)
                ? wizardNode._prototypeSectionKey
                : ((map && map._prototypeSectionState && typeof map._prototypeSectionState.activeCenterKey === "string")
                    ? map._prototypeSectionState.activeCenterKey
                    : "")
        },
        sections: map.exportPrototypeSectionAssets()
    };

    try {
        const qs = new URLSearchParams();
        qs.set("slot", slot);
        const response = await fetch(`/api/sectionworld?${qs.toString()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok || !result || !result.ok) {
            return { ok: false, reason: result && result.reason ? result.reason : 'request-failed' };
        }
        return {
            ok: true,
            slot,
            count: Number.isFinite(result.count) ? Number(result.count) : payload.sections.length,
            path: result.path || null
        };
    } catch (e) {
        return { ok: false, reason: "network-failed", error: e };
    }
}

async function loadGameStateFromServerFile(options = {}) {
    try {
        const qs = new URLSearchParams();
        if (options && typeof options.slot === "string" && options.slot.trim().length > 0) {
            qs.set("slot", options.slot.trim());
        }
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
        LEGACY_LOCAL_SAVE_KEY,
        ACTIVE_LOCAL_SAVE_SLOT_STORAGE_KEY,
        saveGameState,
        loadGameState,
        parseSavedGameState,
        getSavedGameState,
        sanitizeSavedGameState,
        getSavedGameEntries,
        getActiveLocalSaveSlotKey,
        setActiveLocalSaveSlotKey,
        deleteLocalSaveSlot,
        saveGameStateToLocalStorage,
        loadGameStateFromLocalStorageKey,
        isReservedLocalSaveSlotKey,
        inferWizardDifficultyFromSaveData,
        formatWizardDifficultyLabel,
        downloadSaveFile,
        importSaveFile,
        pickAndLoadSaveFile,
        saveGameStateToServerFile,
        savePrototypeSectionWorldToServerSlot,
        loadGameStateFromServerFile,
        hydrateVisibleLazyRoads,
        hydrateVisibleLazyTrees
    };
}
