(function (globalScope) {
    "use strict";

    const DATABASE_NAME = "wizard-of-flatland-saves";
    const DATABASE_VERSION = 1;
    const SAVE_STORE = "saves";
    const SECTION_STORE = "sections";
    const SECTION_PLAYER_INDEX = "byPlayerName";

    function requestPromise(request, context) {
        return new Promise((resolve, reject) => {
            request.addEventListener("success", () => resolve(request.result), { once: true });
            request.addEventListener("error", () => {
                reject(new Error(`Wizard of Flatland ${context} failed: ${request.error ? request.error.message : "unknown IndexedDB error"}`));
            }, { once: true });
        });
    }

    function transactionPromise(transaction, context) {
        return new Promise((resolve, reject) => {
            transaction.addEventListener("complete", () => resolve(), { once: true });
            transaction.addEventListener("abort", () => {
                reject(new Error(`Wizard of Flatland ${context} aborted: ${transaction.error ? transaction.error.message : "unknown IndexedDB error"}`));
            }, { once: true });
            transaction.addEventListener("error", () => {
                reject(new Error(`Wizard of Flatland ${context} failed: ${transaction.error ? transaction.error.message : "unknown IndexedDB error"}`));
            }, { once: true });
        });
    }

    function validatePlayerName(playerName) {
        const name = String(playerName || "").trim();
        if (!name) throw new Error("Wizard of Flatland save storage requires a player name");
        return name;
    }

    function validateSectionRecord(record, playerName) {
        if (!record || typeof record !== "object") throw new Error("Wizard of Flatland section save record is missing");
        if (record.playerName !== playerName) throw new Error(`Wizard of Flatland section save belongs to "${record.playerName}", not "${playerName}"`);
        if (typeof record.sectionKey !== "string" || !record.sectionKey) {
            throw new Error("Wizard of Flatland section save requires a section key");
        }
    }

    function createSaveStore(indexedDb = globalScope.indexedDB) {
        if (!indexedDb || typeof indexedDb.open !== "function") {
            throw new Error("Wizard of Flatland save storage requires IndexedDB");
        }
        let databasePromise = null;

        function open() {
            if (databasePromise) return databasePromise;
            databasePromise = new Promise((resolve, reject) => {
                const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
                request.addEventListener("upgradeneeded", () => {
                    const database = request.result;
                    if (!database.objectStoreNames.contains(SAVE_STORE)) {
                        database.createObjectStore(SAVE_STORE, { keyPath: "playerName" });
                    }
                    if (!database.objectStoreNames.contains(SECTION_STORE)) {
                        const sections = database.createObjectStore(SECTION_STORE, {
                            keyPath: ["playerName", "sectionKey"]
                        });
                        sections.createIndex(SECTION_PLAYER_INDEX, "playerName", { unique: false });
                    }
                });
                request.addEventListener("success", () => {
                    const database = request.result;
                    database.addEventListener("versionchange", () => database.close());
                    resolve(database);
                }, { once: true });
                request.addEventListener("error", () => {
                    databasePromise = null;
                    reject(new Error(`Wizard of Flatland could not open IndexedDB: ${request.error ? request.error.message : "unknown error"}`));
                }, { once: true });
                request.addEventListener("blocked", () => {
                    databasePromise = null;
                    reject(new Error("Wizard of Flatland IndexedDB upgrade is blocked by another open game tab"));
                }, { once: true });
            });
            return databasePromise;
        }

        async function listSaves() {
            const database = await open();
            const transaction = database.transaction(SAVE_STORE, "readonly");
            const records = await requestPromise(transaction.objectStore(SAVE_STORE).getAll(), "save listing");
            await transactionPromise(transaction, "save listing");
            return records.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
        }

        async function getSave(playerName) {
            const name = validatePlayerName(playerName);
            const database = await open();
            const transaction = database.transaction(SAVE_STORE, "readonly");
            const record = await requestPromise(transaction.objectStore(SAVE_STORE).get(name), "save read");
            await transactionPromise(transaction, "save read");
            return record || null;
        }

        async function getSections(playerName) {
            const name = validatePlayerName(playerName);
            const database = await open();
            const transaction = database.transaction(SECTION_STORE, "readonly");
            const index = transaction.objectStore(SECTION_STORE).index(SECTION_PLAYER_INDEX);
            const records = await requestPromise(index.getAll(name), "section save read");
            await transactionPromise(transaction, "section save read");
            for (const record of records) validateSectionRecord(record, name);
            return records;
        }

        async function putSave(saveRecord, sectionRecords) {
            if (!saveRecord || typeof saveRecord !== "object") throw new Error("Wizard of Flatland save record is missing");
            const playerName = validatePlayerName(saveRecord.playerName);
            if (!Array.isArray(sectionRecords)) throw new Error("Wizard of Flatland save requires section records");
            for (const record of sectionRecords) validateSectionRecord(record, playerName);
            const database = await open();
            const transaction = database.transaction([SAVE_STORE, SECTION_STORE], "readwrite");
            transaction.objectStore(SAVE_STORE).put(saveRecord);
            const sectionStore = transaction.objectStore(SECTION_STORE);
            for (const record of sectionRecords) sectionStore.put(record);
            await transactionPromise(transaction, "save write");
            return saveRecord;
        }

        async function deleteSave(playerName) {
            const name = validatePlayerName(playerName);
            const database = await open();
            const transaction = database.transaction([SAVE_STORE, SECTION_STORE], "readwrite");
            transaction.objectStore(SAVE_STORE).delete(name);
            const sectionStore = transaction.objectStore(SECTION_STORE);
            const index = sectionStore.index(SECTION_PLAYER_INDEX);
            const request = index.openKeyCursor(name);
            request.addEventListener("success", () => {
                const cursor = request.result;
                if (!cursor) return;
                sectionStore.delete(cursor.primaryKey);
                cursor.continue();
            });
            await transactionPromise(transaction, "save deletion");
            return true;
        }

        return Object.freeze({
            open,
            listSaves,
            getSave,
            getSections,
            putSave,
            deleteSave
        });
    }

    globalScope.getWizardFlatlandSaveStoreApi = function getWizardFlatlandSaveStoreApi() {
        return Object.freeze({ createSaveStore });
    };
})(typeof window !== "undefined" ? window : globalThis);
