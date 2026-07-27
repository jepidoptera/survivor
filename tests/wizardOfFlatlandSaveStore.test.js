const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SAVE_STORE_PATH = path.join(__dirname, "../public/wizard-of-flatland/saveStore.js");

class FakeEventTarget {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(listener);
    }

    dispatch(type) {
        for (const listener of this.listeners.get(type) || []) listener();
    }
}

class FakeRequest extends FakeEventTarget {
    succeed(result) {
        this.result = result;
        queueMicrotask(() => this.dispatch("success"));
        return this;
    }
}

function keyText(key) {
    return JSON.stringify(key);
}

class FakeStore {
    constructor(keyPath) {
        this.keyPath = keyPath;
        this.records = new Map();
    }

    createIndex() {}

    resolveKey(record) {
        return Array.isArray(this.keyPath)
            ? this.keyPath.map((field) => record[field])
            : record[this.keyPath];
    }

    put(record) {
        this.records.set(keyText(this.resolveKey(record)), structuredClone(record));
    }

    get(key) {
        return new FakeRequest().succeed(structuredClone(this.records.get(keyText(key))));
    }

    getAll() {
        return new FakeRequest().succeed(Array.from(this.records.values(), structuredClone));
    }

    delete(key) {
        this.records.delete(keyText(key));
    }

    index() {
        const store = this;
        return {
            getAll(playerName) {
                return new FakeRequest().succeed(
                    Array.from(store.records.values())
                        .filter((record) => record.playerName === playerName)
                        .map(structuredClone)
                );
            },
            openKeyCursor(playerName) {
                const request = new FakeRequest();
                const keys = Array.from(store.records.values())
                    .filter((record) => record.playerName === playerName)
                    .map((record) => store.resolveKey(record));
                let index = 0;
                function advance() {
                    const primaryKey = keys[index++];
                    request.result = primaryKey === undefined
                        ? null
                        : { primaryKey, continue: () => queueMicrotask(advance) };
                    request.dispatch("success");
                }
                queueMicrotask(advance);
                return request;
            }
        };
    }
}

class FakeDatabase extends FakeEventTarget {
    constructor() {
        super();
        this.stores = new Map();
        this.objectStoreNames = { contains: (name) => this.stores.has(name) };
    }

    createObjectStore(name, options) {
        const store = new FakeStore(options.keyPath);
        this.stores.set(name, store);
        return store;
    }

    transaction(storeNames) {
        const transaction = new FakeEventTarget();
        transaction.objectStore = (name) => this.stores.get(name);
        setTimeout(() => transaction.dispatch("complete"), 0);
        return transaction;
    }

    close() {}
}

function createFakeIndexedDb() {
    const database = new FakeDatabase();
    return {
        open() {
            const request = new FakeRequest();
            request.result = database;
            queueMicrotask(() => {
                request.dispatch("upgradeneeded");
                request.dispatch("success");
            });
            return request;
        }
    };
}

function loadApi() {
    const context = { Map, Promise, Object, String, indexedDB: createFakeIndexedDb() };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(SAVE_STORE_PATH, "utf8"), context, { filename: SAVE_STORE_PATH });
    return context.getWizardFlatlandSaveStoreApi();
}

test("Wizard of Flatland IndexedDB store replaces one section record independently", async () => {
    const store = loadApi().createSaveStore();
    const save = { playerName: "Ada", savedAt: "2026-01-01", version: 2 };
    const sectionA = { playerName: "Ada", sectionKey: "0,0", version: 1, walls: new Float32Array([1]) };
    const sectionB = { playerName: "Ada", sectionKey: "1,0", version: 1, walls: new Float32Array([2]) };
    await store.putSave(save, [sectionA, sectionB]);
    await store.putSave({ ...save, savedAt: "2026-01-02" }, [
        { ...sectionA, walls: new Float32Array([3]) }
    ]);

    const sections = await store.getSections("Ada");
    assert.equal(sections.length, 2);
    assert.deepEqual(Array.from(sections.find((entry) => entry.sectionKey === "0,0").walls), [3]);
    assert.deepEqual(Array.from(sections.find((entry) => entry.sectionKey === "1,0").walls), [2]);
    assert.equal((await store.getSave("Ada")).savedAt, "2026-01-02");
});

test("Wizard of Flatland IndexedDB deletion removes metadata and every owned section", async () => {
    const store = loadApi().createSaveStore();
    await store.putSave(
        { playerName: "Ada", savedAt: "2026-01-01", version: 2 },
        [{ playerName: "Ada", sectionKey: "0,0", version: 1, walls: new Float32Array([1]) }]
    );
    await store.deleteSave("Ada");
    assert.equal(await store.getSave("Ada"), null);
    assert.deepEqual(await store.getSections("Ada"), []);
});
