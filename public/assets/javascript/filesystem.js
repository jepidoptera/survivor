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
    let resolvedTexturePath = null;
    if (typeof data.resolveTreeTexturePath === 'function') {
        resolvedTexturePath = data.resolveTreeTexturePath();
    } else if (typeof data.texturePath === 'string' && data.texturePath.length > 0) {
        resolvedTexturePath = data.texturePath;
    } else {
        const spriteTexture = data.pixiSprite && data.pixiSprite.texture;
        const baseTexture = spriteTexture && spriteTexture.baseTexture;
        const resource = baseTexture && baseTexture.resource;
        if (resource && typeof resource.url === 'string' && resource.url.length > 0) {
            resolvedTexturePath = resource.url;
        }
    }
    if (typeof resolvedTexturePath === 'string' && resolvedTexturePath.length > 0) {
        if (typeof globalThis !== 'undefined' && typeof globalThis.normalizeTexturePathForMetadata === 'function') {
            record.texturePath = globalThis.normalizeTexturePathForMetadata(resolvedTexturePath);
        } else if (typeof globalThis !== 'undefined' && typeof globalThis.normalizeLegacyAssetPath === 'function') {
            record.texturePath = globalThis.normalizeLegacyAssetPath(resolvedTexturePath);
        } else {
            record.texturePath = resolvedTexturePath;
        }
    }
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
    if (mapRef && mapRef.floorNodesById instanceof Map) {
        const floorNodes = [];
        const seenNodes = new Set();
        for (const nodes of mapRef.floorNodesById.values()) {
            if (!Array.isArray(nodes)) continue;
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (!node || seenNodes.has(node)) continue;
                seenNodes.add(node);
                floorNodes.push(node);
            }
        }
        if (floorNodes.length > 0) {
            sources.push({ type: "floor", nodes: floorNodes });
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
const ACTIVE_PROTOTYPE_SAVE_SLOT_STORAGE_KEY = "survivor_active_prototype_save_slot_v1";
const PROTOTYPE_INDEXED_DB_NAME = "survivor_prototype_saves";
const PROTOTYPE_INDEXED_DB_VERSION = 3;
const PROTOTYPE_INDEXED_DB_STORE = "slots";
const PROTOTYPE_INDEXED_DB_SECTION_STORE = "slot_sections";
const PROTOTYPE_INDEXED_DB_BUILDING_STORE = "slot_buildings";
const PROTOTYPE_INDEXED_DB_SECTION_SLOT_INDEX = "slotKey";
const PROTOTYPE_INDEXED_DB_BUILDING_SLOT_INDEX = "slotKey";
const PROTOTYPE_SECTION_DIRECTIONS = Object.freeze([
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 }
]);
const RESERVED_LOCAL_SAVE_KEYS = new Set([
    LEGACY_LOCAL_SAVE_KEY,
    ACTIVE_LOCAL_SAVE_SLOT_STORAGE_KEY,
    ACTIVE_PROTOTYPE_SAVE_SLOT_STORAGE_KEY,
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

function canUsePrototypeSaveIndexedDb() {
    return typeof indexedDB !== "undefined";
}

function getActivePrototypeSaveSlotKey() {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(ACTIVE_PROTOTYPE_SAVE_SLOT_STORAGE_KEY);
        const normalized = normalizeLocalSaveSlotKey(raw);
        return normalized.length > 0 ? normalized : null;
    } catch (_err) {
        return null;
    }
}

function setActivePrototypeSaveSlotKey(saveKey) {
    if (typeof localStorage === "undefined") return false;
    const normalized = normalizeLocalSaveSlotKey(saveKey);
    if (!normalized.length) return false;
    try {
        localStorage.setItem(ACTIVE_PROTOTYPE_SAVE_SLOT_STORAGE_KEY, normalized);
        return true;
    } catch (_err) {
        return false;
    }
}

function getPreferredPrototypeSaveSlotKey() {
    const activeKey = getActivePrototypeSaveSlotKey();
    return activeKey || null;
}

function makePrototypeSectionKey(coord) {
    if (!coord || typeof coord !== "object") return "";
    return `${Number(coord.q) || 0},${Number(coord.r) || 0}`;
}

function parsePrototypeSectionKey(sectionKey) {
    const [qRaw, rRaw] = String(sectionKey || "").split(",");
    return {
        q: Number(qRaw) || 0,
        r: Number(rRaw) || 0
    };
}

function getPrototypeSectionCoordDistance(a, b) {
    const aq = Number(a && a.q) || 0;
    const ar = Number(a && a.r) || 0;
    const bq = Number(b && b.q) || 0;
    const br = Number(b && b.r) || 0;
    const dq = aq - bq;
    const dr = ar - br;
    const ds = (-aq - ar) - (-bq - br);
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

function getPrototypeBubbleSectionKeysFromWorld(worldData) {
    const world = (worldData && typeof worldData === "object") ? worldData : null;
    if (!world) return [];
    const explicitKeys = Array.isArray(world.loadedSectionKeys)
        ? world.loadedSectionKeys
        : (Array.isArray(world.activeSectionKeys) ? world.activeSectionKeys : null);
    if (Array.isArray(explicitKeys) && explicitKeys.length > 0) {
        return Array.from(new Set(explicitKeys.filter(key => typeof key === "string" && key.length > 0))).slice(0, 3);
    }
    const activeCenterKey = (typeof world.activeCenterKey === "string" && world.activeCenterKey.length > 0)
        ? world.activeCenterKey
        : "";
    if (!activeCenterKey.length) return [];
    const sectionCoords = Array.isArray(world.sectionCoords)
        ? world.sectionCoords
        : ((Array.isArray(world.sections) ? world.sections.map(section => section && section.coord) : []));
    const availableKeys = new Set();
    for (let i = 0; i < sectionCoords.length; i++) {
        const coord = sectionCoords[i];
        if (!coord || typeof coord !== "object") continue;
        availableKeys.add(makePrototypeSectionKey(coord));
    }
    if (availableKeys.size === 0) {
        availableKeys.add(activeCenterKey);
    }
    const centerCoord = parsePrototypeSectionKey(activeCenterKey);
    return Array.from(availableKeys).sort((a, b) => {
        const distanceA = getPrototypeSectionCoordDistance(parsePrototypeSectionKey(a), centerCoord);
        const distanceB = getPrototypeSectionCoordDistance(parsePrototypeSectionKey(b), centerCoord);
        if (distanceA !== distanceB) return distanceA - distanceB;
        return String(a).localeCompare(String(b));
    }).slice(0, 3);
}

function makePrototypeSectionStoreRecordId(slotKey, sectionKey) {
    return `${slotKey}::${sectionKey}`;
}

function makePrototypeBuildingStoreRecordId(slotKey, buildingId) {
    return `${slotKey}::${buildingId}`;
}

function clonePrototypeSectionRecord(section) {
    return JSON.parse(JSON.stringify(section));
}

function clonePrototypeBuildingRecord(building) {
    return JSON.parse(JSON.stringify(building));
}

function clonePrototypeBuildingSectionRefs(refs, label = "section buildingRefs") {
    if (refs === undefined || refs === null) return [];
    if (!Array.isArray(refs)) {
        throw new Error(`${label} must be an array`);
    }
    const out = [];
    const seen = new Set();
    for (let i = 0; i < refs.length; i++) {
        const ref = refs[i];
        if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
            throw new Error(`${label} ${i} must be an object`);
        }
        const id = String(ref.id === undefined || ref.id === null ? "" : ref.id).trim();
        if (!/^building:[A-Za-z0-9_.:-]+$/.test(id)) {
            throw new Error(`${label} ${i} requires a valid building id`);
        }
        if (seen.has(id)) {
            throw new Error(`${label} contains duplicate building ref ${id}`);
        }
        seen.add(id);
        out.push({ id, shell: ref.shell === false ? false : true });
    }
    return out;
}

function clonePrototypeSectionWorldObjectRecord(obj) {
    return obj && typeof obj === "object" ? JSON.parse(JSON.stringify(obj)) : obj;
}

function normalizeRoadPathSavePoint(raw, label) {
    const x = Number(raw && raw.x);
    const y = Number(raw && raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`${label} requires finite x/y`);
    }
    return { x, y };
}

function getSectionWorldSaveGeometryApi() {
    return (typeof globalThis !== "undefined" && globalThis.__sectionGeometry)
        ? globalThis.__sectionGeometry
        : null;
}

function getPrototypeSectionSavePolygon(mapRef, sectionKey) {
    const state = mapRef && mapRef._prototypeSectionState ? mapRef._prototypeSectionState : null;
    const asset = mapRef && typeof mapRef.getPrototypeSectionAsset === "function"
        ? mapRef.getPrototypeSectionAsset(sectionKey)
        : null;
    const geometry = getSectionWorldSaveGeometryApi();
    if (
        !asset ||
        !asset.centerAxial ||
        !state ||
        !state.basis ||
        !geometry ||
        typeof geometry.getSectionHexagonCorners !== "function"
    ) {
        throw new Error(`Cannot split road path for section ${sectionKey}; section polygon geometry is unavailable.`);
    }
    const polygon = geometry.getSectionHexagonCorners(asset.centerAxial, state.basis);
    if (!Array.isArray(polygon) || polygon.length < 3) {
        throw new Error(`Cannot split road path for section ${sectionKey}; section polygon is invalid.`);
    }
    return polygon.map((point, index) => normalizeRoadPathSavePoint(point, `section ${sectionKey} polygon point ${index}`));
}

function roadPathSaveSegmentIntersectionT(a, b, c, d) {
    const ax = Number(a.x);
    const ay = Number(a.y);
    const bx = Number(b.x);
    const by = Number(b.y);
    const cx = Number(c.x);
    const cy = Number(c.y);
    const dx = Number(d.x);
    const dy = Number(d.y);
    const rx = bx - ax;
    const ry = by - ay;
    const sx = dx - cx;
    const sy = dy - cy;
    const denom = (rx * sy) - (ry * sx);
    if (Math.abs(denom) <= 1e-9) return null;
    const qpx = cx - ax;
    const qpy = cy - ay;
    const t = ((qpx * sy) - (qpy * sx)) / denom;
    const u = ((qpx * ry) - (qpy * rx)) / denom;
    const eps = 1e-9;
    if (t <= eps || t >= 1 - eps || u < -eps || u > 1 + eps) return null;
    return Math.max(0, Math.min(1, t));
}

function splitRoadPathSavePointsAtSectionPolygon(points, polygon) {
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i];
        const end = points[i + 1];
        if (i === 0) out.push({ x: start.x, y: start.y });
        const cuts = [];
        for (let e = 0; e < polygon.length; e++) {
            const t = roadPathSaveSegmentIntersectionT(start, end, polygon[e], polygon[(e + 1) % polygon.length]);
            if (t === null) continue;
            if (!cuts.some((existing) => Math.abs(existing - t) <= 1e-7)) cuts.push(t);
        }
        cuts.sort((a, b) => a - b);
        for (let c = 0; c < cuts.length; c++) {
            const t = cuts[c];
            out.push({
                x: start.x + ((end.x - start.x) * t),
                y: start.y + ((end.y - start.y) * t)
            });
        }
        out.push({ x: end.x, y: end.y });
    }
    const deduped = [];
    for (let i = 0; i < out.length; i++) {
        const point = out[i];
        const prev = deduped[deduped.length - 1];
        if (!prev || Math.hypot(point.x - prev.x, point.y - prev.y) > 1e-7) {
            deduped.push(point);
        }
    }
    return deduped;
}

function cloneRoadPathSaveRecordForPoints(record, points, sectionKey, pieceIndex) {
    const cloned = clonePrototypeSectionWorldObjectRecord(record);
    cloned.points = points.map((point, index) => normalizeRoadPathSavePoint(point, `road path split ${pieceIndex} point ${index}`));
    delete cloned.pathPoints;
    cloned.x = cloned.points[0].x;
    cloned.y = cloned.points[0].y;
    if (typeof cloned.scriptingName === "string" && cloned.scriptingName.length > 0) {
        cloned.scriptingName = `${cloned.scriptingName}_${sectionKey.replace(/[^A-Za-z0-9_$]/g, "_")}_${pieceIndex}`;
    }
    return cloned;
}

function splitRoadPathSaveRecordBySection(mapRef, record, ownerSectionKey) {
    if (!record || record.type !== "roadPath") return [{ sectionKey: ownerSectionKey, record: clonePrototypeSectionWorldObjectRecord(record) }];
    const rawPoints = Array.isArray(record.points)
        ? record.points
        : (Array.isArray(record.pathPoints) ? record.pathPoints : null);
    if (!rawPoints) {
        throw new Error(`Cannot save road path in section ${ownerSectionKey}; points are missing.`);
    }
    const points = rawPoints.map((point, index) => normalizeRoadPathSavePoint(point, `road path save point ${index}`));
    if (points.length < 2) {
        throw new Error(`Cannot save road path in section ${ownerSectionKey}; at least two points are required.`);
    }
    if (!mapRef || typeof mapRef.getPrototypeSectionKeyForWorldPoint !== "function") {
        throw new Error("Cannot split road path for save; section lookup is unavailable.");
    }
    const candidateKeys = new Set();
    if (typeof ownerSectionKey === "string" && ownerSectionKey.length > 0) candidateKeys.add(ownerSectionKey);
    for (let i = 0; i < points.length; i++) {
        const key = mapRef.getPrototypeSectionKeyForWorldPoint(points[i].x, points[i].y);
        if (typeof key === "string" && key.length > 0) candidateKeys.add(key);
    }
    const state = mapRef && mapRef._prototypeSectionState ? mapRef._prototypeSectionState : null;
    const addSectionKeyForPoint = (point) => {
        const key = mapRef.getPrototypeSectionKeyForWorldPoint(point.x, point.y);
        if (typeof key === "string" && key.length > 0) candidateKeys.add(key);
    };
    for (let i = 0; i < points.length - 1; i++) {
        const mid = {
            x: (points[i].x + points[i + 1].x) * 0.5,
            y: (points[i].y + points[i + 1].y) * 0.5
        };
        addSectionKeyForPoint(points[i]);
        addSectionKeyForPoint(mid);
        addSectionKeyForPoint(points[i + 1]);
        const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
        const sampleStride = Math.max(1, Math.floor(Number(state && state.radius) || 12) * 0.75);
        const steps = Math.max(1, Math.ceil(length / sampleStride));
        for (let step = 1; step < steps; step++) {
            const t = step / steps;
            addSectionKeyForPoint({
                x: points[i].x + ((points[i + 1].x - points[i].x) * t),
                y: points[i].y + ((points[i + 1].y - points[i].y) * t)
            });
        }
    }
    const withNeighbors = Array.from(candidateKeys);
    for (let i = 0; i < withNeighbors.length; i++) {
        const asset = mapRef.getPrototypeSectionAsset(withNeighbors[i]);
        const neighbors = Array.isArray(asset && asset.neighborKeys) ? asset.neighborKeys : [];
        for (let n = 0; n < neighbors.length; n++) {
            if (typeof neighbors[n] === "string" && neighbors[n].length > 0) candidateKeys.add(neighbors[n]);
        }
    }
    let splitPoints = points;
    for (const sectionKey of candidateKeys) {
        splitPoints = splitRoadPathSavePointsAtSectionPolygon(
            splitPoints,
            getPrototypeSectionSavePolygon(mapRef, sectionKey)
        );
    }
    const sequentialPieces = [];
    const pushSpan = (sectionKey, a, b) => {
        if (typeof sectionKey !== "string" || sectionKey.length === 0) {
            throw new Error("Cannot save road path split span without an owning section.");
        }
        const current = sequentialPieces[sequentialPieces.length - 1] || null;
        if (current && current.sectionKey === sectionKey) {
            current.points.push(b);
        } else {
            sequentialPieces.push({ sectionKey, points: [a, b] });
        }
    };
    for (let i = 0; i < splitPoints.length - 1; i++) {
        const a = splitPoints[i];
        const b = splitPoints[i + 1];
        if (Math.hypot(b.x - a.x, b.y - a.y) <= 1e-7) continue;
        const midpoint = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
        const sectionKey = mapRef.getPrototypeSectionKeyForWorldPoint(midpoint.x, midpoint.y);
        pushSpan(sectionKey, a, b);
    }
    const pieces = [];
    for (let pieceIndex = 0; pieceIndex < sequentialPieces.length; pieceIndex++) {
        const piece = sequentialPieces[pieceIndex];
        const sectionPoints = piece.points;
        const deduped = [];
        for (let i = 0; i < sectionPoints.length; i++) {
            const point = sectionPoints[i];
            const prev = deduped[deduped.length - 1];
            if (!prev || Math.hypot(point.x - prev.x, point.y - prev.y) > 1e-7) deduped.push(point);
        }
        if (deduped.length < 2) continue;
        pieces.push({
            sectionKey: piece.sectionKey,
            record: cloneRoadPathSaveRecordForPoints(record, deduped, piece.sectionKey, pieceIndex)
        });
    }
    if (pieces.length === 0) {
        throw new Error(`Cannot save road path in section ${ownerSectionKey}; no section-owned spans were produced.`);
    }
    if (pieces.length > 1) {
        for (let i = 1; i < pieces.length; i++) {
            delete pieces[i].record.id;
        }
    }
    return pieces;
}

function splitPrototypeSectionObjectsForSave(mapRef, sectionKey, objects) {
    const records = Array.isArray(objects) ? objects : [];
    const bySectionKey = new Map();
    const pushRecord = (targetSectionKey, record) => {
        if (typeof targetSectionKey !== "string" || targetSectionKey.length === 0) {
            throw new Error("Cannot save section object without a target section key.");
        }
        if (!bySectionKey.has(targetSectionKey)) bySectionKey.set(targetSectionKey, []);
        bySectionKey.get(targetSectionKey).push(record);
    };
    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (record && record.type === "roadPath") {
            const pieces = splitRoadPathSaveRecordBySection(mapRef, record, sectionKey);
            for (let p = 0; p < pieces.length; p++) {
                pushRecord(pieces[p].sectionKey, pieces[p].record);
            }
        } else {
            pushRecord(sectionKey, clonePrototypeSectionWorldObjectRecord(record));
        }
    }
    return bySectionKey;
}

function buildPrototypeSectionObjectSaveMap(mapRef, sectionKeys) {
    if (!mapRef || typeof mapRef.getPrototypeSectionAsset !== "function") {
        throw new Error("Cannot prepare section objects for save; section asset lookup is unavailable.");
    }
    const keys = Array.isArray(sectionKeys)
        ? sectionKeys.filter((key) => typeof key === "string" && key.length > 0)
        : [];
    const seenKeys = new Set(keys);
    const objectsBySectionKey = new Map();
    for (let i = 0; i < keys.length; i++) {
        const sectionKey = keys[i];
        const asset = mapRef.getPrototypeSectionAsset(sectionKey);
        if (!asset) continue;
        const splitBySection = splitPrototypeSectionObjectsForSave(mapRef, sectionKey, asset.objects);
        for (const [targetSectionKey, objects] of splitBySection.entries()) {
            const targetAsset = mapRef.getPrototypeSectionAsset(targetSectionKey);
            if (!targetAsset) {
                throw new Error(`Cannot save road path split for missing section ${targetSectionKey}.`);
            }
            if (!seenKeys.has(targetSectionKey)) {
                seenKeys.add(targetSectionKey);
                keys.push(targetSectionKey);
            }
            if (!objectsBySectionKey.has(targetSectionKey)) objectsBySectionKey.set(targetSectionKey, []);
            objectsBySectionKey.get(targetSectionKey).push(...objects);
        }
    }
    return { loadedSectionKeys: keys, objectsBySectionKey };
}

function applyRoadPathSectionSplitsToExportedSections(mapRef, sections) {
    if (!Array.isArray(sections) || sections.length === 0) return sections;
    const sectionsByKey = new Map();
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (!section || typeof section !== "object" || typeof section.key !== "string" || section.key.length === 0) continue;
        sectionsByKey.set(section.key, section);
        section._unsplitObjects = Array.isArray(section.objects) ? section.objects : [];
        section.objects = [];
    }
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (!section || typeof section.key !== "string" || section.key.length === 0) continue;
        const splitBySection = splitPrototypeSectionObjectsForSave(mapRef, section.key, section._unsplitObjects || []);
        for (const [targetSectionKey, objects] of splitBySection.entries()) {
            const target = sectionsByKey.get(targetSectionKey);
            if (!target) {
                throw new Error(`Cannot save road path split for unloaded section ${targetSectionKey}.`);
            }
            target.objects.push(...objects);
        }
        delete section._unsplitObjects;
    }
    return sections;
}

function buildPrototypeSaveSlotMetadata(saveData, options = {}) {
    const slotData = JSON.parse(JSON.stringify(saveData || {}));
    const world = (slotData.prototypeSectionWorld && typeof slotData.prototypeSectionWorld === "object")
        ? slotData.prototypeSectionWorld
        : null;
    if (!world) {
        return { slotData, sectionRecords: [], buildingRecords: [] };
    }

    const explicitSections = Array.isArray(options.sectionRecords) ? options.sectionRecords : null;
    const rawSections = explicitSections || (Array.isArray(world.sections) ? world.sections : []);
    const explicitBuildings = Array.isArray(options.buildingRecords) ? options.buildingRecords : null;
    const rawBuildings = explicitBuildings || (Array.isArray(world.buildings) ? world.buildings : []);
    const sectionRecords = [];
    const buildingRecords = [];
    const seenKeys = new Set();
    const seenBuildingIds = new Set();
    const sectionCoords = Array.isArray(options.sectionCoords)
        ? options.sectionCoords.map((coord) => ({ q: Number(coord && coord.q) || 0, r: Number(coord && coord.r) || 0 }))
        : (Array.isArray(world.sectionCoords) ? world.sectionCoords.slice() : []);
    for (let i = 0; i < rawSections.length; i++) {
        const section = rawSections[i];
        if (!section || typeof section !== "object") continue;
        const sectionKey = (typeof section.key === "string" && section.key.length > 0)
            ? section.key
            : makePrototypeSectionKey(section.coord);
        if (!sectionKey.length || seenKeys.has(sectionKey)) continue;
        seenKeys.add(sectionKey);
        sectionRecords.push(clonePrototypeSectionRecord({ ...section, key: sectionKey }));
        if (!sectionCoords.some(coord => makePrototypeSectionKey(coord) === sectionKey)) {
            const coord = section.coord && typeof section.coord === "object"
                ? { q: Number(section.coord.q) || 0, r: Number(section.coord.r) || 0 }
                : parsePrototypeSectionKey(sectionKey);
            sectionCoords.push(coord);
        }
    }

    for (let i = 0; i < rawBuildings.length; i++) {
        const building = rawBuildings[i];
        if (!building || typeof building !== "object") continue;
        const buildingId = (typeof building.id === "string" && building.id.length > 0) ? building.id : "";
        if (!buildingId.length || seenBuildingIds.has(buildingId)) continue;
        seenBuildingIds.add(buildingId);
        buildingRecords.push(clonePrototypeBuildingRecord(building));
    }

    slotData.prototypeSectionWorld = {
        ...world,
        version: 3,
        sectionCoords,
        activeCenterKey: (typeof options.activeCenterKey === "string" && options.activeCenterKey.length > 0)
            ? options.activeCenterKey
            : world.activeCenterKey,
        loadedSectionKeys: Array.isArray(options.loadedSectionKeys)
            ? options.loadedSectionKeys.slice()
            : getPrototypeBubbleSectionKeysFromWorld({
                ...world,
                activeCenterKey: (typeof options.activeCenterKey === "string" && options.activeCenterKey.length > 0)
                    ? options.activeCenterKey
                    : world.activeCenterKey,
                sectionCoords
            }),
        sections: [],
        buildings: []
    };
    return { slotData, sectionRecords, buildingRecords };
}

function openPrototypeSaveIndexedDb() {
    return new Promise((resolve, reject) => {
        if (!canUsePrototypeSaveIndexedDb()) {
            reject(new Error("indexeddb-unavailable"));
            return;
        }
        let request = null;
        try {
            request = indexedDB.open(PROTOTYPE_INDEXED_DB_NAME, PROTOTYPE_INDEXED_DB_VERSION);
        } catch (error) {
            reject(error);
            return;
        }
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(PROTOTYPE_INDEXED_DB_STORE)) {
                db.createObjectStore(PROTOTYPE_INDEXED_DB_STORE, { keyPath: "key" });
            }
            if (!db.objectStoreNames.contains(PROTOTYPE_INDEXED_DB_SECTION_STORE)) {
                const sectionStore = db.createObjectStore(PROTOTYPE_INDEXED_DB_SECTION_STORE, { keyPath: "id" });
                sectionStore.createIndex(PROTOTYPE_INDEXED_DB_SECTION_SLOT_INDEX, "slotKey", { unique: false });
            } else {
                const upgradeTxn = request.transaction;
                const sectionStore = upgradeTxn ? upgradeTxn.objectStore(PROTOTYPE_INDEXED_DB_SECTION_STORE) : null;
                if (sectionStore && !sectionStore.indexNames.contains(PROTOTYPE_INDEXED_DB_SECTION_SLOT_INDEX)) {
                    sectionStore.createIndex(PROTOTYPE_INDEXED_DB_SECTION_SLOT_INDEX, "slotKey", { unique: false });
                }
            }
            if (!db.objectStoreNames.contains(PROTOTYPE_INDEXED_DB_BUILDING_STORE)) {
                const buildingStore = db.createObjectStore(PROTOTYPE_INDEXED_DB_BUILDING_STORE, { keyPath: "id" });
                buildingStore.createIndex(PROTOTYPE_INDEXED_DB_BUILDING_SLOT_INDEX, "slotKey", { unique: false });
            } else {
                const upgradeTxn = request.transaction;
                const buildingStore = upgradeTxn ? upgradeTxn.objectStore(PROTOTYPE_INDEXED_DB_BUILDING_STORE) : null;
                if (buildingStore && !buildingStore.indexNames.contains(PROTOTYPE_INDEXED_DB_BUILDING_SLOT_INDEX)) {
                    buildingStore.createIndex(PROTOTYPE_INDEXED_DB_BUILDING_SLOT_INDEX, "slotKey", { unique: false });
                }
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("indexeddb-open-failed"));
    });
}

function withPrototypeSaveStore(mode, work) {
    return openPrototypeSaveIndexedDb().then(db => new Promise((resolve, reject) => {
        let settled = false;
        const finishResolve = (value) => {
            if (settled) return;
            settled = true;
            try {
                db.close();
            } catch (_err) {}
            resolve(value);
        };
        const finishReject = (error) => {
            if (settled) return;
            settled = true;
            try {
                db.close();
            } catch (_err) {}
            reject(error);
        };
        let transaction = null;
        try {
            transaction = db.transaction(PROTOTYPE_INDEXED_DB_STORE, mode);
            const store = transaction.objectStore(PROTOTYPE_INDEXED_DB_STORE);
            transaction.onabort = () => finishReject(transaction.error || new Error("indexeddb-transaction-aborted"));
            transaction.onerror = () => finishReject(transaction.error || new Error("indexeddb-transaction-failed"));
            Promise.resolve(work(store, transaction)).then(finishResolve).catch(finishReject);
        } catch (error) {
            finishReject(error);
        }
    }));
}

function withPrototypeSaveStores(mode, work) {
    return openPrototypeSaveIndexedDb().then(db => new Promise((resolve, reject) => {
        let settled = false;
        const finishResolve = (value) => {
            if (settled) return;
            settled = true;
            try {
                db.close();
            } catch (_err) {}
            resolve(value);
        };
        const finishReject = (error) => {
            if (settled) return;
            settled = true;
            try {
                db.close();
            } catch (_err) {}
            reject(error);
        };
        try {
            const transaction = db.transaction([
                PROTOTYPE_INDEXED_DB_STORE,
                PROTOTYPE_INDEXED_DB_SECTION_STORE,
                PROTOTYPE_INDEXED_DB_BUILDING_STORE
            ], mode);
            const slotStore = transaction.objectStore(PROTOTYPE_INDEXED_DB_STORE);
            const sectionStore = transaction.objectStore(PROTOTYPE_INDEXED_DB_SECTION_STORE);
            const buildingStore = transaction.objectStore(PROTOTYPE_INDEXED_DB_BUILDING_STORE);
            transaction.onabort = () => finishReject(transaction.error || new Error("indexeddb-transaction-aborted"));
            transaction.onerror = () => finishReject(transaction.error || new Error("indexeddb-transaction-failed"));
            Promise.resolve(work({ slotStore, sectionStore, buildingStore, transaction })).then(finishResolve).catch(finishReject);
        } catch (error) {
            finishReject(error);
        }
    }));
}

function readPrototypeSaveRecord(saveKey) {
    const normalizedKey = normalizeLocalSaveSlotKey(saveKey, getPreferredPrototypeSaveSlotKey());
    if (!normalizedKey.length) {
        return Promise.resolve({ ok: false, reason: "missing" });
    }
    return withPrototypeSaveStore("readonly", (store) => new Promise((resolve, reject) => {
        const request = store.get(normalizedKey);
        request.onsuccess = () => {
            const record = request.result;
            if (!record || typeof record !== "object") {
                resolve({ ok: false, reason: "missing", key: normalizedKey });
                return;
            }
            resolve({ ok: true, key: normalizedKey, record });
        };
        request.onerror = () => reject(request.error || new Error("indexeddb-read-failed"));
    })).catch(error => ({ ok: false, reason: "read-failed", key: normalizedKey, error }));
}

function getPrototypeSaveSectionRecords(slotKey, sectionKeys) {
    const normalizedSlotKey = normalizeLocalSaveSlotKey(slotKey);
    const normalizedSectionKeys = Array.isArray(sectionKeys)
        ? sectionKeys
            .map((key) => String(key || "").trim())
            .filter((key, index, array) => key.length > 0 && array.indexOf(key) === index)
        : [];
    if (!normalizedSlotKey.length || normalizedSectionKeys.length === 0) {
        return Promise.resolve([]);
    }
    return withPrototypeSaveStores("readonly", ({ sectionStore }) => Promise.all(
        normalizedSectionKeys.map((sectionKey) => new Promise((resolve, reject) => {
            const request = sectionStore.get(makePrototypeSectionStoreRecordId(normalizedSlotKey, sectionKey));
            request.onsuccess = () => resolve(request.result && request.result.data ? clonePrototypeSectionRecord(request.result.data) : null);
            request.onerror = () => reject(request.error || new Error("indexeddb-section-read-failed"));
        }))
    )).then((records) => records.filter(record => !!record)).catch(() => []);
}

function getPrototypeSaveBuildingRecords(slotKey) {
    const normalizedSlotKey = normalizeLocalSaveSlotKey(slotKey);
    if (!normalizedSlotKey.length) {
        return Promise.resolve([]);
    }
    return withPrototypeSaveStores("readonly", ({ buildingStore }) => new Promise((resolve, reject) => {
        const index = buildingStore.index(PROTOTYPE_INDEXED_DB_BUILDING_SLOT_INDEX);
        const request = index.getAll(normalizedSlotKey);
        request.onsuccess = () => {
            const records = Array.isArray(request.result) ? request.result : [];
            resolve(records
                .map(record => record && record.data ? clonePrototypeBuildingRecord(record.data) : null)
                .filter(record => !!record));
        };
        request.onerror = () => reject(request.error || new Error("indexeddb-building-read-failed"));
    })).catch(() => []);
}

function listPrototypeSaveSectionStoreKeys(slotKey) {
    const normalizedSlotKey = normalizeLocalSaveSlotKey(slotKey);
    if (!normalizedSlotKey.length) {
        return Promise.resolve([]);
    }
    return withPrototypeSaveStores("readonly", ({ sectionStore }) => new Promise((resolve, reject) => {
        const index = sectionStore.index(PROTOTYPE_INDEXED_DB_SECTION_SLOT_INDEX);
        const request = index.getAllKeys(normalizedSlotKey);
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => reject(request.error || new Error("indexeddb-section-key-list-failed"));
    })).catch(() => []);
}

function listPrototypeSaveBuildingStoreKeys(slotKey) {
    const normalizedSlotKey = normalizeLocalSaveSlotKey(slotKey);
    if (!normalizedSlotKey.length) {
        return Promise.resolve([]);
    }
    return withPrototypeSaveStores("readonly", ({ buildingStore }) => new Promise((resolve, reject) => {
        const index = buildingStore.index(PROTOTYPE_INDEXED_DB_BUILDING_SLOT_INDEX);
        const request = index.getAllKeys(normalizedSlotKey);
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => reject(request.error || new Error("indexeddb-building-key-list-failed"));
    })).catch(() => []);
}

function getPrototypeSaveEntries() {
    return withPrototypeSaveStore("readonly", (store) => new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
            const activeKey = getActivePrototypeSaveSlotKey();
            const records = Array.isArray(request.result) ? request.result : [];
            const entries = records
                .filter(record => record && typeof record === "object" && isLikelySaveGameData(record.data))
                .map(record => {
                    const difficulty = inferWizardDifficultyFromSaveData(record.data);
                    const key = normalizeLocalSaveSlotKey(record.key);
                    return {
                        key,
                        wizardName: normalizeLocalSaveSlotKey(record.data && record.data.wizard ? record.data.wizard.name : "", key) || key,
                        difficulty,
                        difficultyLabel: formatWizardDifficultyLabel(difficulty),
                        timestamp: (typeof record.timestamp === "string" && record.timestamp.trim().length > 0)
                            ? record.timestamp
                            : (typeof record.data.timestamp === "string" && record.data.timestamp.trim().length > 0
                                ? record.data.timestamp
                                : null),
                        isActive: key === activeKey,
                        data: record.data
                    };
                });

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

            resolve(entries);
        };
        request.onerror = () => reject(request.error || new Error("indexeddb-list-failed"));
    })).catch(() => []);
}

function deletePrototypeSaveSlot(saveKey) {
    const normalizedKey = normalizeLocalSaveSlotKey(saveKey);
    if (!normalizedKey.length) {
        return Promise.resolve({ ok: false, reason: "missing-save-key" });
    }
    return withPrototypeSaveStores("readwrite", ({ slotStore, sectionStore, buildingStore }) => new Promise((resolve, reject) => {
        const deleteBuildings = (done) => {
            const index = buildingStore.index(PROTOTYPE_INDEXED_DB_BUILDING_SLOT_INDEX);
            const buildingKeysRequest = index.getAllKeys(normalizedKey);
            buildingKeysRequest.onsuccess = () => {
                const buildingRecordIds = Array.isArray(buildingKeysRequest.result) ? buildingKeysRequest.result : [];
                for (let i = 0; i < buildingRecordIds.length; i++) {
                    buildingStore.delete(buildingRecordIds[i]);
                }
                done();
            };
            buildingKeysRequest.onerror = () => reject(buildingKeysRequest.error || new Error("indexeddb-building-list-failed"));
        };
        const deleteSections = () => {
            const index = sectionStore.index(PROTOTYPE_INDEXED_DB_SECTION_SLOT_INDEX);
            const sectionKeysRequest = index.getAllKeys(normalizedKey);
            sectionKeysRequest.onsuccess = () => {
                const sectionRecordIds = Array.isArray(sectionKeysRequest.result) ? sectionKeysRequest.result : [];
                for (let i = 0; i < sectionRecordIds.length; i++) {
                    sectionStore.delete(sectionRecordIds[i]);
                }
                deleteBuildings(() => {
                    const request = slotStore.delete(normalizedKey);
                    request.onsuccess = () => {
                        const activeKey = getActivePrototypeSaveSlotKey();
                        if (activeKey === normalizedKey && typeof localStorage !== "undefined") {
                            try {
                                localStorage.removeItem(ACTIVE_PROTOTYPE_SAVE_SLOT_STORAGE_KEY);
                            } catch (_err) {}
                        }
                        resolve({ ok: true, key: normalizedKey });
                    };
                    request.onerror = () => reject(request.error || new Error("indexeddb-delete-failed"));
                });
            };
            sectionKeysRequest.onerror = () => reject(sectionKeysRequest.error || new Error("indexeddb-section-list-failed"));
        };
        deleteSections();
    })).catch(error => ({ ok: false, reason: "delete-failed", error }));
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
        return getLastLoadGameStateFailureResult();
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

async function loadGameStateFromLocalStorageKeyAsync(saveKey) {
    const result = loadGameStateFromLocalStorageKey(saveKey);
    if (!result || !result.ok) return result;
    if (!await finalizeLoadedGameStateAsync()) {
        return getLastLoadGameStateFailureResult();
    }
    return result;
}

function saveGameStateToIndexedDb(saveKey) {
    if (!canUsePrototypeSaveIndexedDb()) {
        return Promise.resolve({ ok: false, reason: "indexeddb-unavailable" });
    }
    const wizardName = (wizard && typeof wizard.name === "string") ? wizard.name : "";
    const normalizedKey = normalizeLocalSaveSlotKey(saveKey, wizardName);
    if (!normalizedKey.length) {
        return Promise.resolve({ ok: false, reason: "missing-save-key" });
    }
    const saveData = saveGameState();
    if (!saveData) {
        return Promise.resolve({ ok: false, reason: "save-failed" });
    }
    if (saveData.wizard && typeof saveData.wizard === "object") {
        saveData.wizard.name = normalizeLocalSaveSlotKey(saveData.wizard.name, normalizedKey) || normalizedKey;
        if (Number.isFinite(saveData.wizard.difficulty)) {
            saveData.wizard.difficulty = normalizeWizardDifficultyValue(saveData.wizard.difficulty);
        }
    }
    const timestamp = (typeof saveData.timestamp === "string" && saveData.timestamp.trim().length > 0)
        ? saveData.timestamp
        : new Date().toISOString();
    const record = {
        key: normalizedKey,
        timestamp,
        route: "sectionworld",
        version: 1,
        data: saveData
    };
    let explicitSectionRecords = null;
    let explicitSectionCoords = null;
    let explicitActiveCenterKey = null;
    let explicitLoadedSectionKeys = null;
    let explicitBuildingRecords = null;
    if (map && map._prototypeSectionState) {
        const state = map._prototypeSectionState;
        explicitSectionCoords = Array.isArray(state.sectionCoords) ? state.sectionCoords.slice() : null;
        explicitActiveCenterKey = (typeof state.activeCenterKey === "string") ? state.activeCenterKey : null;
        const runtimeActiveSectionKeys = (state.activeBubbleSectionKeys instanceof Set && state.activeBubbleSectionKeys.size > 0)
            ? Array.from(state.activeBubbleSectionKeys)
            : (state.activeSectionKeys instanceof Set ? Array.from(state.activeSectionKeys) : []);
        explicitLoadedSectionKeys = getPrototypeBubbleSectionKeysFromWorld({
            activeCenterKey: explicitActiveCenterKey,
            sectionCoords: explicitSectionCoords,
            activeSectionKeys: runtimeActiveSectionKeys
        });
        if (typeof map.exportPrototypeSectionAssets === "function") {
            const hydratedKeys = (typeof map.getPrototypeHydratedSectionKeys === "function")
                ? map.getPrototypeHydratedSectionKeys()
                : [];
            explicitSectionRecords = map.exportPrototypeSectionAssets(hydratedKeys);
        }
        if (typeof map.exportPrototypeBuildingInstances === "function") {
            explicitBuildingRecords = map.exportPrototypeBuildingInstances();
        } else if (typeof map.exportPrototypeBuildingPlacements === "function") {
            explicitBuildingRecords = map.exportPrototypeBuildingPlacements();
        }
    }
    const isFullSectionSnapshot = !!(
        Array.isArray(explicitSectionCoords) &&
        Array.isArray(explicitSectionRecords) &&
        explicitSectionCoords.length > 0 &&
        explicitSectionRecords.length >= explicitSectionCoords.length
    );
    const prototypePayload = buildPrototypeSaveSlotMetadata(saveData, {
        sectionRecords: explicitSectionRecords,
        buildingRecords: explicitBuildingRecords,
        sectionCoords: explicitSectionCoords,
        activeCenterKey: explicitActiveCenterKey,
        loadedSectionKeys: explicitLoadedSectionKeys
    });
    record.data = prototypePayload.slotData;
    record.version = (record.data && record.data.prototypeSectionWorld && record.data.prototypeSectionWorld.version >= 3)
        ? 3
        : ((record.data && record.data.prototypeSectionWorld && record.data.prototypeSectionWorld.version >= 2) ? 2 : 1);
    return withPrototypeSaveStores("readwrite", ({ slotStore, sectionStore, buildingStore }) => new Promise((resolve, reject) => {
        const upsertSlot = () => {
            const request = slotStore.put(record);
            request.onsuccess = () => {
                setActivePrototypeSaveSlotKey(normalizedKey);
                const storedLength = JSON.stringify(record.data).length
                    + prototypePayload.sectionRecords.reduce((sum, section) => sum + JSON.stringify(section).length, 0)
                    + prototypePayload.buildingRecords.reduce((sum, building) => sum + JSON.stringify(building).length, 0);
                resolve({
                    ok: true,
                    key: normalizedKey,
                    data: record.data,
                    storedLength
                });
            };
            request.onerror = () => reject(request.error || new Error("indexeddb-write-failed"));
        };

        const nextSectionIds = new Set();
        for (let i = 0; i < prototypePayload.sectionRecords.length; i++) {
            const section = prototypePayload.sectionRecords[i];
            const sectionKey = String(section && section.key || "").trim();
            if (!sectionKey.length) continue;
            const id = makePrototypeSectionStoreRecordId(normalizedKey, sectionKey);
            nextSectionIds.add(id);
            sectionStore.put({
                id,
                slotKey: normalizedKey,
                sectionKey,
                timestamp,
                data: clonePrototypeSectionRecord(section)
            });
        }

        const nextBuildingIds = new Set();
        for (let i = 0; i < prototypePayload.buildingRecords.length; i++) {
            const building = prototypePayload.buildingRecords[i];
            const buildingId = String(building && building.id || "").trim();
            if (!buildingId.length) continue;
            const id = makePrototypeBuildingStoreRecordId(normalizedKey, buildingId);
            nextBuildingIds.add(id);
            buildingStore.put({
                id,
                slotKey: normalizedKey,
                buildingId,
                timestamp,
                data: clonePrototypeBuildingRecord(building)
            });
        }

        const index = sectionStore.index(PROTOTYPE_INDEXED_DB_SECTION_SLOT_INDEX);
        const staleRequest = index.getAllKeys(normalizedKey);
        staleRequest.onsuccess = () => {
            if (isFullSectionSnapshot) {
                const existingIds = Array.isArray(staleRequest.result) ? staleRequest.result : [];
                for (let i = 0; i < existingIds.length; i++) {
                    const id = existingIds[i];
                    if (nextSectionIds.has(id)) continue;
                    sectionStore.delete(id);
                }
            }
            const buildingIndex = buildingStore.index(PROTOTYPE_INDEXED_DB_BUILDING_SLOT_INDEX);
            const staleBuildingsRequest = buildingIndex.getAllKeys(normalizedKey);
            staleBuildingsRequest.onsuccess = () => {
                const existingBuildingIds = Array.isArray(staleBuildingsRequest.result) ? staleBuildingsRequest.result : [];
                for (let i = 0; i < existingBuildingIds.length; i++) {
                    const id = existingBuildingIds[i];
                    if (nextBuildingIds.has(id)) continue;
                    buildingStore.delete(id);
                }
                upsertSlot();
            };
            staleBuildingsRequest.onerror = () => reject(staleBuildingsRequest.error || new Error("indexeddb-building-list-failed"));
        };
        staleRequest.onerror = () => reject(staleRequest.error || new Error("indexeddb-section-list-failed"));
    })).catch(error => ({ ok: false, reason: "write-failed", error }));
}

function getIndexedDbSavedGameState(saveKey = null) {
    return readPrototypeSaveRecord(saveKey).then(result => {
        if (!result || !result.ok) return result || { ok: false, reason: "missing" };
        const record = result.record;
        if (!record || !isLikelySaveGameData(record.data)) {
            return { ok: false, reason: "invalid-save-structure", key: result.key };
        }
        const world = (record.data.prototypeSectionWorld && typeof record.data.prototypeSectionWorld === "object")
            ? record.data.prototypeSectionWorld
            : null;
        const shouldHydrateSectionsFromStore = !!(
            world &&
            Number(world.version) >= 2 &&
            Array.isArray(world.sectionCoords) &&
            (!Array.isArray(world.sections) || world.sections.length === 0)
        );
        const shouldHydrateBuildingsFromStore = !!(
            world &&
            Number(world.version) >= 3 &&
            (!Array.isArray(world.buildings) || world.buildings.length === 0)
        );
        if (!shouldHydrateSectionsFromStore) {
            if (!shouldHydrateBuildingsFromStore) {
                return {
                    ok: true,
                    key: result.key,
                    data: record.data
                };
            }
            return getPrototypeSaveBuildingRecords(result.key).then((buildings) => {
                const data = JSON.parse(JSON.stringify(record.data));
                if (data.prototypeSectionWorld && typeof data.prototypeSectionWorld === "object") {
                    data.prototypeSectionWorld.buildings = buildings;
                }
                return {
                    ok: true,
                    key: result.key,
                    data,
                    prototypeBuildingStoreBacked: true
                };
            });
        }
        const sectionKeys = getPrototypeBubbleSectionKeysFromWorld(world);
        return Promise.all([
            getPrototypeSaveSectionRecords(result.key, sectionKeys),
            shouldHydrateBuildingsFromStore ? getPrototypeSaveBuildingRecords(result.key) : Promise.resolve(world.buildings || [])
        ]).then(([sections, buildings]) => {
            const data = JSON.parse(JSON.stringify(record.data));
            if (data.prototypeSectionWorld && typeof data.prototypeSectionWorld === "object") {
                data.prototypeSectionWorld.sections = sections;
                data.prototypeSectionWorld.loadedSectionKeys = sectionKeys;
                data.prototypeSectionWorld.buildings = buildings;
            }
            return {
                ok: true,
                key: result.key,
                data,
                prototypeSectionStoreBacked: true,
                prototypeBuildingStoreBacked: shouldHydrateBuildingsFromStore
            };
        });
    });
}

function loadGameStateFromIndexedDbKey(saveKey) {
    return getIndexedDbSavedGameState(saveKey).then(async parsed => {
        if (!parsed || !parsed.ok) return parsed || { ok: false, reason: "missing" };
        if (typeof globalThis !== "undefined" && typeof globalThis.markPrototypeStartupPerf === "function") {
            globalThis.markPrototypeStartupPerf("indexeddb-save-data-ready", {
                key: parsed.key,
                prototypeSectionStoreBacked: !!parsed.prototypeSectionStoreBacked
            });
        }
        const loaded = loadGameState(parsed.data);
        if (!loaded) {
            return getLastLoadGameStateFailureResult();
        }
        if (!await finalizeLoadedGameStateAsync()) {
            return getLastLoadGameStateFailureResult();
        }
        if (
            parsed.prototypeSectionStoreBacked &&
            map &&
            typeof map.setPrototypeSectionAssetLoader === "function"
        ) {
            map.setPrototypeSectionAssetLoader((sectionKeys) => getPrototypeSaveSectionRecords(parsed.key, sectionKeys));
            if (typeof map.prefetchPrototypeSectionAssets === "function") {
                const lookaheadKeys = (typeof map.getPrototypeBubbleSectionKeys === "function" && typeof map.getPrototypeActiveSectionKeys === "function")
                    ? (() => {
                        const activeKeys = Array.from(map.getPrototypeActiveSectionKeys());
                        if (activeKeys.length === 0) return [];
                        const centerKey = activeKeys[0];
                        if (typeof map.getPrototypeLookaheadSectionKeys === "function") {
                            return Array.from(map.getPrototypeLookaheadSectionKeys(centerKey));
                        }
                        return [];
                    })()
                    : [];
                if (lookaheadKeys.length > 0) {
                    map.prefetchPrototypeSectionAssets(lookaheadKeys, { materialize: false });
                }
            }
        }
        setActivePrototypeSaveSlotKey(parsed.key);
        if (wizard) {
            wizard.name = normalizeLocalSaveSlotKey(parsed.data && parsed.data.wizard ? parsed.data.wizard.name : "", parsed.key) || parsed.key;
            if (typeof wizard.setDifficulty === "function") {
                const inferredDifficulty = inferWizardDifficultyFromSaveData(parsed.data);
                if (Number.isFinite(inferredDifficulty)) {
                    wizard.setDifficulty(inferredDifficulty);
                }
            }
            if (typeof wizard.updateStatusBars === "function") {
                wizard.updateStatusBars();
            }
        }
        return { ok: true, key: parsed.key, data: parsed.data };
    });
}

function saveGameState(options = {}) {
    if (!wizard || !map || !animals) {
        console.error("Cannot save: wizard, map, or animals not initialized");
        return null;
    }
    if (!map._prototypeSectionState) {
        console.error("Cannot save: section-world runtime is not initialized");
        return null;
    }
    const includeAllPrototypeSections = options && options.includeAllPrototypeSections === true;

    if (map && typeof map.syncPrototypeWalls === "function") {
        try {
            map.syncPrototypeWalls();
        } catch (e) {
            console.warn("Section-world wall sync before save failed:", e);
        }
    }
    if (map && typeof map.syncPrototypeObjects === "function") {
        try {
            map.syncPrototypeObjects();
        } catch (e) {
            console.warn("Section-world object sync before save failed:", e);
        }
    }
    if (map && typeof map.syncPrototypeAnimals === "function") {
        try {
            map.syncPrototypeAnimals();
        } catch (e) {
            console.warn("Section-world animal sync before save failed:", e);
        }
    }
    if (map && typeof map.syncPrototypePowerups === "function") {
        try {
            map.syncPrototypePowerups();
        } catch (e) {
            console.warn("Section-world powerup sync before save failed:", e);
        }
    }

    const wizardData = wizard.saveJson();
    sanitizeWizardSaveMovementSupport(wizardData);
    const saveData = {
        version: 1,
        timestamp: new Date().toISOString(),
        wizard: wizardData,
        los: {
            mazeMode: getSavedLosMazeModeValue()
        },
        animals: [],
        groundTiles: encodeGroundTiles(map),
        clearanceMap: (typeof map.serializeClearance === "function")
            ? map.serializeClearance()
            : null,
        roof: null,
        powerups: []
    };

    {
        const state = map._prototypeSectionState;
        if (typeof map.syncPrototypeBuildingPlacementRefs === "function") {
            map.syncPrototypeBuildingPlacementRefs();
        }
        const activeKeys = (typeof map.getPrototypeActiveSectionKeys === "function")
            ? Array.from(map.getPrototypeActiveSectionKeys())
            : [];
        const exportedSections = (typeof map.exportPrototypeSectionWorld === "function")
            ? map.exportPrototypeSectionWorld()
            : null;
        const clonePrototypeSection = (section) => JSON.parse(JSON.stringify(section));
        let loadedSectionKeys = includeAllPrototypeSections
            ? ((state.sectionAssetsByKey instanceof Map)
                ? Array.from(state.sectionAssetsByKey.keys())
                : ((Array.isArray(exportedSections) ? exportedSections.map(section => section && section.key) : [])
                    .filter((key) => typeof key === "string" && key.length > 0)))
            : activeKeys.filter((key) => typeof key === "string" && key.length > 0);
        const sections = [];
        let objectSaveMap = null;

        if (includeAllPrototypeSections && Array.isArray(exportedSections) && exportedSections.length > 0) {
            const clonedSections = [];
            for (let i = 0; i < exportedSections.length; i++) {
                const section = exportedSections[i];
                if (!section || typeof section !== "object") continue;
                clonedSections.push(clonePrototypeSection(section));
            }
            applyRoadPathSectionSplitsToExportedSections(map, clonedSections);
            sections.push(...clonedSections);
        } else {
            objectSaveMap = buildPrototypeSectionObjectSaveMap(map, loadedSectionKeys);
            loadedSectionKeys = objectSaveMap.loadedSectionKeys;
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
                    objects: objectSaveMap && objectSaveMap.objectsBySectionKey instanceof Map
                        ? (objectSaveMap.objectsBySectionKey.get(sectionKey) || [])
                        : (Array.isArray(asset.objects) ? asset.objects.map((obj) => ({ ...obj })) : []),
                    animals: Array.isArray(asset.animals) ? asset.animals.map((animal) => ({ ...animal })) : [],
                    powerups: Array.isArray(asset.powerups) ? asset.powerups.map((powerup) => ({ ...powerup })) : [],
                    buildingRefs: clonePrototypeBuildingSectionRefs(asset.buildingRefs, `section ${asset.key} buildingRefs`)
                });
            }
        }

        saveData.prototypeSectionWorld = {
            version: 2,
            radius: Number.isFinite(state.radius) ? Number(state.radius) : 0,
            sectionGraphRadius: Number.isFinite(state.sectionGraphRadius) ? Number(state.sectionGraphRadius) : 0,
            anchorCenter: state.anchorCenter ? { q: Number(state.anchorCenter.q) || 0, r: Number(state.anchorCenter.r) || 0 } : { q: 0, r: 0 },
            activeCenterKey: typeof state.activeCenterKey === "string" ? state.activeCenterKey : "",
            loadedSectionKeys,
            sections,
            triggers: (typeof map.exportPrototypeTriggerDefinitions === "function")
                ? map.exportPrototypeTriggerDefinitions()
                : [],
            buildings: (typeof map.exportPrototypeBuildingInstances === "function")
                ? map.exportPrototypeBuildingInstances()
                : ((typeof map.exportPrototypeBuildingPlacements === "function")
                    ? map.exportPrototypeBuildingPlacements()
                    : [])
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

function logPrototypeLoadDetail(mapInstance, label = "post-sync") {
    if (!mapInstance || typeof console === "undefined" || typeof console.log !== "function") return;
    const sectionState = mapInstance._prototypeSectionState;
    if (!sectionState) return;
    const wallState = mapInstance._prototypeWallState;
    const objectState = mapInstance._prototypeObjectState;
    const animalState = mapInstance._prototypeAnimalState;
    const powerupState = mapInstance._prototypePowerupState;
    const activeSectionKeys = (typeof mapInstance.getPrototypeActiveSectionKeys === "function")
        ? Array.from(mapInstance.getPrototypeActiveSectionKeys())
        : Array.from(sectionState.activeSectionKeys || []);
    const bubbleSectionKeys = (typeof mapInstance.getPrototypeBubbleSectionKeys === "function")
        ? Array.from(mapInstance.getPrototypeBubbleSectionKeys())
        : [];
    const hydratedSectionKeys = (typeof mapInstance.getPrototypeHydratedSectionKeys === "function")
        ? mapInstance.getPrototypeHydratedSectionKeys()
        : Array.from(sectionState.loadedSectionAssetKeys || []);
    const perSection = activeSectionKeys.map((sectionKey) => {
        const asset = (typeof mapInstance.getPrototypeSectionAsset === "function")
            ? mapInstance.getPrototypeSectionAsset(sectionKey)
            : null;
        const nodes = sectionState.nodesBySectionKey instanceof Map
            ? (sectionState.nodesBySectionKey.get(sectionKey) || [])
            : [];
        return {
            key: sectionKey,
            nodes: Array.isArray(nodes) ? nodes.length : 0,
            walls: Array.isArray(asset && asset.walls) ? asset.walls.length : 0,
            blockedEdges: Array.isArray(asset && asset.blockedEdges) ? asset.blockedEdges.length : 0,
            objects: Array.isArray(asset && asset.objects) ? asset.objects.length : 0,
            animals: Array.isArray(asset && asset.animals) ? asset.animals.length : 0,
            powerups: Array.isArray(asset && asset.powerups) ? asset.powerups.length : 0,
            floors: Array.isArray(asset && asset.floors) ? asset.floors.length : 0
        };
    });
    console.log("[PROTOTYPE LOAD DETAIL]", {
        label,
        activeCenterKey: sectionState.activeCenterKey || "",
        activeSectionKeys,
        bubbleSectionKeys,
        hydratedSectionKeys,
        activeSectionCount: activeSectionKeys.length,
        bubbleSectionCount: bubbleSectionKeys.length,
        hydratedSectionCount: hydratedSectionKeys.length,
        loadedNodeCount: Array.isArray(sectionState.loadedNodes) ? sectionState.loadedNodes.length : 0,
        allNodeCount: Array.isArray(sectionState.allNodes) ? sectionState.allNodes.length : 0,
        pendingHydrations: sectionState.pendingSectionHydrations instanceof Map
            ? sectionState.pendingSectionHydrations.size
            : 0,
        perSection,
        wallStats: wallState && wallState.lastSyncStats ? { ...wallState.lastSyncStats } : null,
        objectStats: objectState && objectState.lastSyncStats ? { ...objectState.lastSyncStats } : null,
        animalStats: animalState && animalState.lastSyncStats ? { ...animalState.lastSyncStats } : null,
        powerupStats: powerupState && powerupState.lastSyncStats ? { ...powerupState.lastSyncStats } : null
    });
}

function isPrototypeLegacyStaticRecord(objData) {
    const type = (objData && typeof objData.type === "string") ? objData.type : "";
    return type === "road" || type === "roadPath" || type === "tree" || type === "roof" || type === "wallSection";
}

function getSavedStaticObjectTraversalLayer(objData) {
    if (!objData || typeof objData !== "object") return 0;
    if (Number.isFinite(objData.traversalLayer)) return Math.round(Number(objData.traversalLayer));
    if (Number.isFinite(objData.level)) return Math.round(Number(objData.level));
    return 0;
}

function summarizeOrphanedUpperFloorStaticRecord(objData) {
    return {
        type: typeof (objData && objData.type) === "string" ? objData.type : "",
        fragmentId: typeof (objData && objData.fragmentId) === "string" ? objData.fragmentId : "",
        surfaceId: typeof (objData && objData.surfaceId) === "string" ? objData.surfaceId : "",
        level: getSavedStaticObjectTraversalLayer(objData),
        x: Number.isFinite(objData && objData.x) ? Number(objData.x) : null,
        y: Number.isFinite(objData && objData.y) ? Number(objData.y) : null
    };
}

function isOrphanedUpperFloorStaticRecord(objData, mapInstance) {
    if (!objData || typeof objData !== "object" || objData.type !== "placedObject") return false;
    const layer = getSavedStaticObjectTraversalLayer(objData);
    if (layer <= 0) return false;

    const fragmentId = (typeof objData.fragmentId === "string" && objData.fragmentId.length > 0)
        ? objData.fragmentId
        : "";
    if (!fragmentId) return true;

    if (!mapInstance || typeof mapInstance !== "object") return false;
    if (typeof mapInstance.ensureFloorBuildings === "function") {
        mapInstance.ensureFloorBuildings();
    }
    if (mapInstance.floorBuildingByFragmentId instanceof Map) {
        return !mapInstance.floorBuildingByFragmentId.has(fragmentId);
    }
    return false;
}

function summarizePrototypeSectionAssets(sectionAssets) {
    const summary = {
        sections: 0,
        walls: 0,
        objects: 0,
        roads: 0,
        trees: 0,
        animals: 0,
        powerups: 0
    };
    const sections = Array.isArray(sectionAssets) ? sectionAssets : [];
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (!section || typeof section !== "object") continue;
        summary.sections += 1;
        const walls = Array.isArray(section.walls) ? section.walls : [];
        const objects = Array.isArray(section.objects) ? section.objects : [];
        const animals = Array.isArray(section.animals) ? section.animals : [];
        const powerups = Array.isArray(section.powerups) ? section.powerups : [];
        summary.walls += walls.length;
        summary.objects += objects.length;
        summary.animals += animals.length;
        summary.powerups += powerups.length;
        for (let j = 0; j < objects.length; j++) {
            const obj = objects[j];
            const type = (obj && typeof obj.type === "string") ? obj.type : "";
            if (type === "road") summary.roads += 1;
            if (type === "tree") summary.trees += 1;
        }
    }
    return summary;
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

function getLastLoadGameStateFailureResult(reason = "load-failed") {
    return {
        ok: false,
        reason,
        error: (typeof globalThis !== "undefined" && globalThis.lastLoadGameStateError)
            ? globalThis.lastLoadGameStateError
            : null
    };
}

function collectSectionKeysForPendingWizardMovementSupport() {
    const keys = new Set();
    if (!map) return keys;
    if (typeof map.getPrototypeActiveSectionKeys === "function") {
        const activeKeys = map.getPrototypeActiveSectionKeys();
        if (activeKeys && typeof activeKeys.forEach === "function") {
            activeKeys.forEach((key) => {
                if (typeof key === "string" && key.length > 0) keys.add(key);
            });
        }
    }
    if (typeof map.getPrototypeBubbleSectionKeys === "function") {
        const bubbleKeys = map.getPrototypeBubbleSectionKeys();
        if (bubbleKeys && typeof bubbleKeys.forEach === "function") {
            bubbleKeys.forEach((key) => {
                if (typeof key === "string" && key.length > 0) keys.add(key);
            });
        }
    }
    if (
        wizard &&
        Number.isFinite(wizard.x) &&
        Number.isFinite(wizard.y) &&
        typeof map.getPrototypeSectionKeyForWorldPoint === "function"
    ) {
        const key = map.getPrototypeSectionKeyForWorldPoint(wizard.x, wizard.y);
        if (typeof key === "string" && key.length > 0) keys.add(key);
    }
    return keys;
}

async function finalizeLoadedGameStateAsync() {
    if (!wizard || typeof wizard.hasPendingSavedMovementSupport !== "function" || !wizard.hasPendingSavedMovementSupport()) {
        return true;
    }
    try {
        if (map && typeof map.syncPrototypeBuildingPlacementRefs === "function") {
            map.syncPrototypeBuildingPlacementRefs();
        }
        const sectionKeys = collectSectionKeysForPendingWizardMovementSupport();
        if (map && typeof map.ensurePrototypeBuildingPlacementsForSectionKeys === "function" && sectionKeys.size > 0) {
            await map.ensurePrototypeBuildingPlacementsForSectionKeys(sectionKeys);
        }
        if (map && typeof map.syncPrototypeBuildingGeometryRuntime === "function") {
            map.syncPrototypeBuildingGeometryRuntime();
        }
        wizard.restoreSavedMovementSupport();
        if (map && typeof map.updatePrototypeSectionBubble === "function") {
            map.updatePrototypeSectionBubble(wizard, { force: true });
        }
        return true;
    } catch (e) {
        console.error("Error finalizing loaded wizard movement support:", e);
        if (typeof globalThis !== "undefined") {
            globalThis.lastLoadGameStateError = e;
        }
        return false;
    }
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

function isGeneratedOutdoorGroundWizardFragmentId(fragmentId) {
    return typeof fragmentId === "string" &&
        fragmentId.startsWith("section:") &&
        fragmentId.endsWith(":ground");
}

function sanitizeWizardSaveMovementSupport(wizardData) {
    if (!wizardData || typeof wizardData !== "object") return wizardData;
    const fragmentId = typeof wizardData.fragmentId === "string" ? wizardData.fragmentId : "";
    if (!isGeneratedOutdoorGroundWizardFragmentId(fragmentId)) return wizardData;
    const layer = Number.isFinite(wizardData.currentLayer)
        ? Math.round(Number(wizardData.currentLayer))
        : (Number.isFinite(wizardData.traversalLayer) ? Math.round(Number(wizardData.traversalLayer)) : 0);
    if (layer !== 0) return wizardData;
    delete wizardData.fragmentId;
    delete wizardData.surfaceId;
    return wizardData;
}

function sanitizeWizardLoadMovementSupport(wizardData) {
    if (!wizardData || typeof wizardData !== "object") return wizardData;
    const fragmentId = typeof wizardData.fragmentId === "string" ? wizardData.fragmentId : "";
    if (!isGeneratedOutdoorGroundWizardFragmentId(fragmentId)) return wizardData;
    const layer = Number.isFinite(wizardData.currentLayer)
        ? Math.round(Number(wizardData.currentLayer))
        : (Number.isFinite(wizardData.traversalLayer) ? Math.round(Number(wizardData.traversalLayer)) : 0);
    if (layer !== 0) return wizardData;
    wizardData.fragmentId = "";
    wizardData.surfaceId = "";
    return wizardData;
}

function shouldSkipRoadAndFloorTileObjectLoad() {
    return typeof globalThis !== "undefined" && globalThis.SKIP_ROAD_AND_FLOOR_TILE_OBJECT_LOAD !== false;
}

function isRoadOrFloorTileObjectRecord(record) {
    if (!record || typeof record !== "object") return false;
    const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
    const category = typeof record.category === "string" ? record.category.trim().toLowerCase() : "";
    const objectType = typeof record.objectType === "string" ? record.objectType.trim().toLowerCase() : "";
    return (
        type === "road" ||
        type === "floor" ||
        type === "floortile" ||
        type === "flooring" ||
        type === "tile" ||
        objectType === "road" ||
        objectType === "floor" ||
        objectType === "floortile" ||
        objectType === "flooring" ||
        objectType === "tile" ||
        category === "roads" ||
        category === "floor" ||
        category === "floors" ||
        category === "flooring" ||
        category === "tiles"
    );
}

function loadGameState(saveData) {
    if (!saveData || !saveData.wizard || !map) {
        console.error("Invalid save data");
        return false;
    }

    const _lt0 = performance.now();
    try {
        if (typeof globalThis !== "undefined" && typeof globalThis.markPrototypeStartupPerf === "function") {
            globalThis.markPrototypeStartupPerf("loadGameState-begin");
        }
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
            const wizardData = JSON.parse(JSON.stringify(saveData.wizard));
            sanitizeWizardLoadMovementSupport(wizardData);
            wizard.loadJson(wizardData);
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

        const hasPrototypeSectionWorld = !!(
            saveData.prototypeSectionWorld &&
            typeof saveData.prototypeSectionWorld === "object" &&
            map &&
            typeof map.loadPrototypeSectionWorld === "function"
        );
        let prototypeSectionWorldLoaded = false;
        if (hasPrototypeSectionWorld) {
            prototypeSectionWorldLoaded = map.loadPrototypeSectionWorld(saveData.prototypeSectionWorld) === true;
        }
        const isPrototypeManagedAnimalSaveRecord = (animalData) => {
            if (!prototypeSectionWorldLoaded || !animalData || typeof map.getPrototypeSectionKeyForWorldPoint !== "function") {
                return false;
            }
            const worldX = Number(animalData.x);
            const worldY = Number(animalData.y);
            if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
            const sectionKey = map.getPrototypeSectionKeyForWorldPoint(worldX, worldY);
            return typeof sectionKey === "string" && sectionKey.length > 0;
        };

        // Restore animals
        const _lt2 = performance.now();
        console.log(`[LOAD TIMING] wizard + clear animals: ${(_lt2 - _lt1).toFixed(1)}ms`);
        if (saveData.animals && Array.isArray(saveData.animals)) {
            saveData.animals.forEach(animalData => {
                if (!animalData || animalData.gone || animalData.vanishing) return;
                if (isPrototypeManagedAnimalSaveRecord(animalData)) return;
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
                        const p = Powerup.loadJson(pData, map);
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
            if (Array.isArray(source.nodes)) {
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
        if (hasPrototypeSectionWorld) {
            if (!prototypeSectionWorldLoaded) {
                map.loadPrototypeSectionWorld(saveData.prototypeSectionWorld);
            }
            logPrototypeLoadDetail(map, "post-world-load");
            if (typeof map.syncPrototypeWalls === "function") {
                map.syncPrototypeWalls();
            }
            if (typeof map.syncPrototypeObjects === "function") {
                map.syncPrototypeObjects();
            }
            if (typeof map.syncPrototypeAnimals === "function") {
                map.syncPrototypeAnimals();
            }
            if (typeof map.syncPrototypePowerups === "function") {
                map.syncPrototypePowerups();
            }
            logPrototypeLoadDetail(map, "post-sync");
        }
        if (saveData.staticObjects && Array.isArray(saveData.staticObjects)) {
            const _st0 = performance.now();
            const loadedWallSections = [];
            const loadedRoofs = [];
            const restoredKeys = new Set();
            let skippedOrphanedUpperFloorStaticObjects = 0;
            const orphanedUpperFloorStaticObjectSamples = [];
            saveData.staticObjects.forEach((objData, index) => {
                if (hasPrototypeSectionWorld && isPrototypeLegacyStaticRecord(objData)) {
                    return;
                }
                if (hasPrototypeSectionWorld && isOrphanedUpperFloorStaticRecord(objData, map)) {
                    skippedOrphanedUpperFloorStaticObjects += 1;
                    if (orphanedUpperFloorStaticObjectSamples.length < 5) {
                        orphanedUpperFloorStaticObjectSamples.push(summarizeOrphanedUpperFloorStaticRecord(objData));
                    }
                    return;
                }
                const key = buildRestoreStaticObjectKey(objData, index);
                if (restoredKeys.has(key)) return;
                restoredKeys.add(key);

                if (shouldSkipRoadAndFloorTileObjectLoad() && isRoadOrFloorTileObjectRecord(objData)) {
                    return;
                }

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
            if (skippedOrphanedUpperFloorStaticObjects > 0) {
                console.warn("[static object restore] skipped orphaned upper-floor placed object records", {
                    count: skippedOrphanedUpperFloorStaticObjects,
                    samples: orphanedUpperFloorStaticObjectSamples
                });
            }
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

        if (wizard && typeof wizard.hasPendingSavedMovementSupport === "function" && wizard.hasPendingSavedMovementSupport()) {
            if (typeof wizard.restoreSavedMovementSupport !== "function") {
                throw new Error("saved wizard movement support is pending without a restore method");
            }
            wizard.restoreSavedMovementSupport({ deferIfMissing: true });
        }

        if (saveData.groundTiles) {
            decodeGroundTiles(map, saveData.groundTiles);
        }
        const _lt5 = performance.now();
        console.log(`[LOAD TIMING] restore static objects + ground: ${(_lt5 - _lt4).toFixed(1)}ms`);

        if (!shouldSkipRoadAndFloorTileObjectLoad()) {
            hydrateVisibleLazyRoads({ maxPerFrame: 192, paddingWorld: 12 });
        }
        hydrateVisibleLazyTrees({ maxPerFrame: 256, paddingWorld: 12 });

        // Repair any stale blocking counters from older runtime versions.
        const prototypeNodes = (map && typeof map.getAllPrototypeNodes === "function")
            ? map.getAllPrototypeNodes()
            : null;
        if (Array.isArray(prototypeNodes) && prototypeNodes.length > 0) {
            for (let i = 0; i < prototypeNodes.length; i++) {
                const node = prototypeNodes[i];
                if (!node || typeof node.recountBlockingObjects !== "function") continue;
                node.recountBlockingObjects();
            }
        } else {
            for (let x = 0; x < map.width; x++) {
                for (let y = 0; y < map.height; y++) {
                    const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
                    if (!node) continue;
                    if (typeof node.recountBlockingObjects === "function") {
                        node.recountBlockingObjects();
                    }
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
        if (typeof globalThis !== "undefined" && typeof globalThis.markPrototypeStartupPerf === "function") {
            globalThis.markPrototypeStartupPerf("loadGameState-complete", {
                totalMs: Number((_lt7 - _lt0).toFixed(1))
            });
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

        if (typeof globalThis !== "undefined") {
            const scriptingApi = globalThis.Scripting || null;
            if (scriptingApi && typeof scriptingApi.rebuildNamedObjectRegistry === "function") {
                scriptingApi.rebuildNamedObjectRegistry({ map, wizard });
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
                const usePrototypeTriggerRegistry = !!(map && typeof map.getPrototypeActiveTriggerTraversalEntriesForActor === "function");
                const mapObjects = Array.isArray(map.objects) ? map.objects : [];
                for (let i = 0; i < mapObjects.length; i++) {
                    const obj = mapObjects[i];
                    if (!obj || obj.gone || obj.vanishing) continue;
                    const hitbox = obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox || null;
                    if (!hitbox) continue;
                    if (obj.type === "triggerArea" || obj.isTriggerArea === true) {
                        if (!usePrototypeTriggerRegistry) {
                            triggerAreaEntries.push({ obj, hitbox });
                        }
                        continue;
                    }
                    touchEntries.push({ obj, hitbox, forceTouch: false });
                }
                if (usePrototypeTriggerRegistry) {
                    const activeTriggerEntries = map.getPrototypeActiveTriggerTraversalEntriesForActor(wizard, { force: true });
                    for (let i = 0; i < activeTriggerEntries.length; i++) {
                        const entry = activeTriggerEntries[i];
                        if (!entry || !entry.obj || !entry.hitbox) continue;
                        triggerAreaEntries.push({ obj: entry.obj, hitbox: entry.hitbox });
                    }
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
                const runtimeScriptObjects = (map && typeof map.getGameObjects === "function")
                    ? (map.getGameObjects({ refresh: false }) || [])
                    : [];
                const touchObjects = new Set(touchEntries.map(entry => entry && entry.obj).filter(Boolean));
                for (let i = 0; i < runtimeScriptObjects.length; i++) {
                    const obj = runtimeScriptObjects[i];
                    if (!obj || obj === wizard || obj.gone || obj.vanishing) continue;
                    if (touchObjects.has(obj)) continue;
                    if (obj.map && wizard.map && obj.map !== wizard.map) continue;
                    const hitbox = obj.groundPlaneHitbox || obj.visualHitbox || obj.hitbox || null;
                    if (!hitbox) continue;
                    const hasTouchScript = (
                        typeof scriptingApi.hasEventScriptForTarget === "function" &&
                        (scriptingApi.hasEventScriptForTarget(obj, "playerTouches") || scriptingApi.hasEventScriptForTarget(obj, "playerUntouches"))
                    );
                    if (!hasTouchScript) continue;
                    touchEntries.push({ obj, hitbox, forceTouch: false });
                    touchObjects.add(obj);
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
            if (typeof globalThis.markPrototypeStartupPerf === "function") {
                globalThis.markPrototypeStartupPerf("presentGameFrame-called");
            }
        }

        return true;
    } catch (e) {
        if (typeof globalThis !== "undefined" && typeof globalThis.markPrototypeStartupPerf === "function") {
            globalThis.markPrototypeStartupPerf("loadGameState-failed", {
                reason: String(e && e.message || e || "error")
            });
        }
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
            if (!loaded) {
                resolve(getLastLoadGameStateFailureResult());
                return;
            }
            finalizeLoadedGameStateAsync().then((finalized) => {
                resolve(finalized ? { ok: true } : getLastLoadGameStateFailureResult());
            });
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
    if (typeof map.flushPrototypeBubbleShiftSession === "function") {
        const flushed = map.flushPrototypeBubbleShiftSession({ maxTasks: 200000 });
        if (flushed !== true) {
            return { ok: false, reason: "prototype-shift-flush-failed" };
        }
    }
    if (
        map &&
        map._prototypeSectionState &&
        Array.isArray(map._prototypeSectionState.sectionCoords) &&
        typeof map.hydratePrototypeSectionAssets === "function"
    ) {
        // Protect sections that have active runtime walls from being overwritten by
        // stale server data during hydration.  A section with active runtime walls is
        // locally authoritative: the player has built or loaded walls there and the
        // in-memory asset.walls reflects the current game state.  If we allowed
        // hydratePrototypeSectionAssets to run for such a section it could fetch an
        // older server snapshot and clobber the local walls before they are saved.
        if (map._prototypeWallState && map._prototypeWallState.activeRuntimeWallsByRecordId instanceof Map) {
            for (const runtimeWall of map._prototypeWallState.activeRuntimeWallsByRecordId.values()) {
                if (!runtimeWall || runtimeWall.gone) continue;
                const sectionKey = typeof runtimeWall._prototypeOwnerSectionKey === "string"
                    ? runtimeWall._prototypeOwnerSectionKey : null;
                if (!sectionKey) continue;
                const asset = typeof map.getPrototypeSectionAsset === "function"
                    ? map.getPrototypeSectionAsset(sectionKey) : null;
                if (asset && asset._prototypeSectionHydrated !== true) {
                    asset._prototypeSectionHydrated = true;
                }
            }
        }
        const allSectionKeys = map._prototypeSectionState.sectionCoords
            .map((coord) => `${Number(coord && coord.q) || 0},${Number(coord && coord.r) || 0}`);
        try {
            await map.hydratePrototypeSectionAssets(allSectionKeys, { materialize: false });
        } catch (error) {
            return { ok: false, reason: "prototype-hydration-failed", error };
        }
    }
    if (typeof map.syncPrototypeWalls === "function") {
        map.syncPrototypeWalls();
    }
    if (typeof map.syncPrototypeObjects === "function") {
        map.syncPrototypeObjects();
    }
    if (typeof map.syncPrototypeAnimals === "function") {
        map.syncPrototypeAnimals();
    }
    if (typeof map.syncPrototypePowerups === "function") {
        map.syncPrototypePowerups();
    }
    const activeWizard = (typeof globalThis !== "undefined" && globalThis.wizard && typeof globalThis.wizard.saveJson === "function")
        ? globalThis.wizard
        : ((typeof wizard !== "undefined" && wizard && typeof wizard.saveJson === "function") ? wizard : null);
    const wizardNode = (activeWizard && map && typeof map.worldToNode === "function")
        ? map.worldToNode(activeWizard.x, activeWizard.y)
        : null;
    const wizardData = activeWizard ? activeWizard.saveJson() : null;
    sanitizeWizardSaveMovementSupport(wizardData);

    const exportedSections = applyRoadPathSectionSplitsToExportedSections(map, map.exportPrototypeSectionAssets());
    const payload = {
        manifest: {
            wizard: wizardData,
            los: {
                mazeMode: getSavedLosMazeModeValue()
            },
            activeCenterKey: (wizardNode && typeof wizardNode._prototypeSectionKey === "string" && wizardNode._prototypeSectionKey.length > 0)
                ? wizardNode._prototypeSectionKey
                : ((map && map._prototypeSectionState && typeof map._prototypeSectionState.activeCenterKey === "string")
                    ? map._prototypeSectionState.activeCenterKey
                    : "")
        },
        triggers: (typeof map.exportPrototypeTriggerDefinitions === "function")
            ? map.exportPrototypeTriggerDefinitions()
            : [],
        buildings: (typeof map.exportPrototypeBuildingInstances === "function")
            ? map.exportPrototypeBuildingInstances()
            : ((typeof map.exportPrototypeBuildingPlacements === "function")
                ? map.exportPrototypeBuildingPlacements()
                : []),
        sections: exportedSections
    };
    const sectionSummary = summarizePrototypeSectionAssets(exportedSections);

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
        console.log("[MASTER SAVE SUMMARY]", {
            slot,
            ...sectionSummary
        });
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

const saveSectionWorldToServerSlot = savePrototypeSectionWorldToServerSlot;

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
        if (!loaded) return getLastLoadGameStateFailureResult();
        if (!await finalizeLoadedGameStateAsync()) {
            return getLastLoadGameStateFailureResult();
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: "network-failed", error: e };
    }
}

// Export functions for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        LEGACY_LOCAL_SAVE_KEY,
        ACTIVE_LOCAL_SAVE_SLOT_STORAGE_KEY,
        ACTIVE_PROTOTYPE_SAVE_SLOT_STORAGE_KEY,
        saveGameState,
        loadGameState,
        parseSavedGameState,
        getSavedGameState,
        getIndexedDbSavedGameState,
        sanitizeSavedGameState,
        getSavedGameEntries,
        getPrototypeSaveEntries,
        getActiveLocalSaveSlotKey,
        setActiveLocalSaveSlotKey,
        getActivePrototypeSaveSlotKey,
        setActivePrototypeSaveSlotKey,
        deleteLocalSaveSlot,
        deletePrototypeSaveSlot,
        saveGameStateToLocalStorage,
        saveGameStateToIndexedDb,
        loadGameStateFromLocalStorageKey,
        loadGameStateFromLocalStorageKeyAsync,
        loadGameStateFromIndexedDbKey,
        isReservedLocalSaveSlotKey,
        inferWizardDifficultyFromSaveData,
        formatWizardDifficultyLabel,
        downloadSaveFile,
        importSaveFile,
        pickAndLoadSaveFile,
        finalizeLoadedGameStateAsync,
        saveGameStateToServerFile,
        saveSectionWorldToServerSlot,
        savePrototypeSectionWorldToServerSlot,
        loadGameStateFromServerFile,
        hydrateVisibleLazyRoads,
        hydrateVisibleLazyTrees
    };
}
