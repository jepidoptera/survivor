class Inventory {
    constructor(initial = {}) {
        this.items = {};
        this.load(initial);
    }

    normalizeKey(name) {
        const key = String(name || "").trim();
        return key.length > 0 ? key : "";
    }

    normalizeQuantity(quantity) {
        const normalized = Math.floor(Number(quantity) || 0);
        return Math.max(0, normalized);
    }

    get(name) {
        const key = this.normalizeKey(name);
        if (!key) return 0;
        return Number.isFinite(this.items[key]) ? this.items[key] : 0;
    }

    set(name, quantity) {
        const key = this.normalizeKey(name);
        if (!key) return 0;
        const nextQuantity = this.normalizeQuantity(quantity);
        if (nextQuantity <= 0) {
            delete this.items[key];
            return 0;
        }
        this.items[key] = nextQuantity;
        return nextQuantity;
    }

    add(name, quantity = 1) {
        const amount = this.normalizeQuantity(quantity);
        if (amount <= 0) return this.get(name);
        return this.set(name, this.get(name) + amount);
    }

    remove(name, quantity = 1) {
        const amount = this.normalizeQuantity(quantity);
        if (amount <= 0) return true;
        const current = this.get(name);
        if (current < amount) return false;
        this.set(name, current - amount);
        return true;
    }

    has(name, quantity = 1) {
        const amount = this.normalizeQuantity(quantity);
        return this.get(name) >= amount;
    }

    clear() {
        this.items = {};
        return this;
    }

    load(data) {
        this.items = {};
        if (!data || typeof data !== "object") return this;
        Object.keys(data).forEach((key) => {
            this.set(key, data[key]);
        });
        return this;
    }

    toJSON() {
        return { ...this.items };
    }
}

if (typeof globalThis !== "undefined") {
    globalThis.Inventory = Inventory;
}
