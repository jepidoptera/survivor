// filesystem.js - Handles saving and loading game state

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
        animals: animals.map(animal => animal.saveJson()),
        staticObjects: [],
        groundTiles: encodeGroundTiles(map),
        roof: (roof && typeof roof.saveJson === 'function') ? roof.saveJson() : null
    };

    // Collect all static objects from the map (dedupe by object identity)
    const seenStaticObjects = new Set();
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            const node = map.nodes[x] && map.nodes[x][y] ? map.nodes[x][y] : null;
            if (!node || !node.objects || node.objects.length === 0) continue;

            node.objects.forEach(obj => {
                if (obj && !obj.gone && !seenStaticObjects.has(obj)) {
                    seenStaticObjects.add(obj);
                    saveData.staticObjects.push(obj.saveJson());
                }
            });
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
                if (animal.pixiSprite && animal.pixiSprite.parent) {
                    animal.pixiSprite.parent.removeChild(animal.pixiSprite);
                }
            }
        });
        animals.length = 0;

        // Restore animals
        if (saveData.animals && Array.isArray(saveData.animals)) {
            saveData.animals.forEach(animalData => {
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
            if (obj.pixiSprite && obj.pixiSprite.parent) {
                obj.pixiSprite.parent.removeChild(obj.pixiSprite);
            }
        });

        // Restore static objects (dedupe entries in save payload for backward compatibility)
        if (saveData.staticObjects && Array.isArray(saveData.staticObjects)) {
            const restoredKeys = new Set();
            saveData.staticObjects.forEach(objData => {
                const key = JSON.stringify(objData);
                if (restoredKeys.has(key)) return;
                restoredKeys.add(key);

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
        }

        if (saveData.groundTiles) {
            decodeGroundTiles(map, saveData.groundTiles);
        }

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
            if (roof && roof.pixiMesh && roof.pixiMesh.parent) {
                roof.pixiMesh.parent.removeChild(roof.pixiMesh);
            }
            const loadedRoof = Roof.loadJson(saveData.roof);
            if (loadedRoof) {
                roof = loadedRoof;
            }
        }

        // Wizard.loadJson restores viewport (or centers when missing in old saves)
        drawCanvas();

        return true;
    } catch (e) {
        console.error("Error loading game state:", e);
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

async function loadGameStateFromServerFile() {
    try {
        const response = await fetch('/api/savefile', { method: 'GET' });
        const payload = await response.json();
        if (!response.ok || !payload || !payload.ok || !payload.data) {
            return { ok: false, reason: payload && payload.reason ? payload.reason : 'request-failed' };
        }
        const loaded = loadGameState(payload.data);
        return loaded ? { ok: true } : { ok: false, reason: "load-failed" };
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
        loadGameStateFromServerFile
    };
}
