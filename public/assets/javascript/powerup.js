(function attachPowerups(global) {
    "use strict";

    const POWERUP_ITEMS_URL = "/assets/images/powerups/items.json";
    const POWERUP_IMAGE_BASE_PATH = "/assets/images/powerups";
    const DEFAULT_IMAGE_FILE = "black diamond.png";
    const DEFAULT_RADIUS = 0.35;
    const DEFAULT_ANCHOR_X = 0.5;
    const DEFAULT_ANCHOR_Y = 1;

    let powerupItemsDocCache = null;
    let powerupItemsDocPromise = null;
    const powerupItemsByFileName = new Map();

    function decodeUriSafe(value) {
        if (typeof value !== "string") return "";
        try {
            return decodeURIComponent(value);
        } catch (_) {
            return value;
        }
    }

    function normalizeImageFileName(fileName) {
        if (typeof fileName !== "string") return "";
        const trimmed = fileName.trim();
        if (!trimmed) return "";
        const basename = trimmed.split("/").pop() || trimmed;
        return decodeUriSafe(basename).toLowerCase();
    }

    function toPowerupImagePath(imageFileName) {
        if (typeof imageFileName !== "string" || !imageFileName.trim()) {
            return `${POWERUP_IMAGE_BASE_PATH}/${DEFAULT_IMAGE_FILE.replace(/ /g, "%20")}`;
        }
        const file = imageFileName.trim().split("/").pop() || imageFileName.trim();
        return `${POWERUP_IMAGE_BASE_PATH}/${encodeURIComponent(file).replace(/%2F/g, "/")}`;
    }

    function mergePowerupImageData(defaults, item) {
        const base = (defaults && typeof defaults === "object") ? defaults : {};
        const row = (item && typeof item === "object") ? item : {};
        const merged = { ...base, ...row };
        merged.anchor = {
            ...(base.anchor && typeof base.anchor === "object" ? base.anchor : {}),
            ...(row.anchor && typeof row.anchor === "object" ? row.anchor : {})
        };
        merged.groundPlaneHitbox = {
            ...(base.groundPlaneHitbox && typeof base.groundPlaneHitbox === "object" ? base.groundPlaneHitbox : {}),
            ...(row.groundPlaneHitbox && typeof row.groundPlaneHitbox === "object" ? row.groundPlaneHitbox : {})
        };
        merged.billboard = {
            ...(base.billboard && typeof base.billboard === "object" ? base.billboard : {}),
            ...(row.billboard && typeof row.billboard === "object" ? row.billboard : {})
        };
        merged.effects = {
            ...(base.effects && typeof base.effects === "object" ? base.effects : {}),
            ...(row.effects && typeof row.effects === "object" ? row.effects : {})
        };
        return merged;
    }

    function buildPowerupItemsIndex(doc) {
        powerupItemsByFileName.clear();
        if (!doc || !Array.isArray(doc.items)) return;
        for (let i = 0; i < doc.items.length; i++) {
            const item = doc.items[i];
            if (!item || typeof item !== "object") continue;
            const key = normalizeImageFileName(item.file || item.imageFileName || item.imagePath || "");
            if (!key) continue;
            powerupItemsByFileName.set(key, mergePowerupImageData(doc.defaults, item));
        }
    }

    async function loadPowerupItemsDoc() {
        if (powerupItemsDocCache) return powerupItemsDocCache;
        if (powerupItemsDocPromise) return powerupItemsDocPromise;

        powerupItemsDocPromise = fetch(POWERUP_ITEMS_URL, { cache: "no-cache" })
            .then(async (response) => {
                if (!response.ok) return null;
                const parsed = await response.json();
                powerupItemsDocCache = (parsed && typeof parsed === "object") ? parsed : null;
                buildPowerupItemsIndex(powerupItemsDocCache);
                return powerupItemsDocCache;
            })
            .catch(() => null)
            .finally(() => {
                powerupItemsDocPromise = null;
            });

        return powerupItemsDocPromise;
    }

    function getPowerupImageDataByFile(imageFileName) {
        const key = normalizeImageFileName(imageFileName);
        if (!key) return null;
        if (powerupItemsByFileName.has(key)) {
            return powerupItemsByFileName.get(key);
        }
        return null;
    }

    class Powerup {
        constructor(imageFileName, options = {}) {
            const opts = (options && typeof options === "object") ? options : {};
            const requestedFileName = (typeof imageFileName === "string" && imageFileName.trim().length > 0)
                ? imageFileName.trim()
                : (typeof opts.file === "string" && opts.file.trim().length > 0 ? opts.file.trim() : DEFAULT_IMAGE_FILE);

            this.type = "powerup";
            this.map = opts.map || global.map || null;
            this.x = Number.isFinite(opts.x) ? Number(opts.x) : 0;
            this.y = Number.isFinite(opts.y) ? Number(opts.y) : 0;
            this.z = 0;
            this.width = Number.isFinite(opts.width) ? Math.max(0.01, Number(opts.width)) : 0.8;
            this.height = Number.isFinite(opts.height) ? Math.max(0.01, Number(opts.height)) : 0.8;
            this.imageFileName = requestedFileName;
            this.imagePath = toPowerupImagePath(requestedFileName);
            this.radius = Number.isFinite(opts.radius)
                ? Math.max(0.01, Number(opts.radius))
                : DEFAULT_RADIUS;
            this.hitboxOffsetX = 0;
            this.hitboxOffsetY = 0;
            this.anchorX = DEFAULT_ANCHOR_X;
            this.anchorY = DEFAULT_ANCHOR_Y;
            this.billboardAlpha = 1;
            this.billboardTint = 0xffffff;
            this.gone = false;
            this.collected = false;
            this.onCollect = (typeof opts.onCollect === "function") ? opts.onCollect : null;

            this._explicitOverrides = {
                width: Number.isFinite(opts.width),
                height: Number.isFinite(opts.height),
                z: Number.isFinite(opts.z),
                imagePath: (typeof opts.imagePath === "string" && opts.imagePath.trim().length > 0),
                radius: Number.isFinite(opts.radius),
                anchorX: Number.isFinite(opts.anchorX) || Number.isFinite(opts.anchor?.x),
                anchorY: Number.isFinite(opts.anchorY) || Number.isFinite(opts.anchor?.y),
                hitboxOffsetX: Number.isFinite(opts.hitboxOffsetX),
                hitboxOffsetY: Number.isFinite(opts.hitboxOffsetY),
                billboardAlpha: Number.isFinite(opts.billboardAlpha),
                billboardTint: Number.isFinite(opts.billboardTint)
            };

            if (this._explicitOverrides.z) {
                this.z = Number(opts.z);
            }
            if (this._explicitOverrides.imagePath) {
                this.imagePath = opts.imagePath.trim();
            }
            if (this._explicitOverrides.anchorX) {
                this.anchorX = Number.isFinite(opts.anchorX) ? Number(opts.anchorX) : Number(opts.anchor.x);
            }
            if (this._explicitOverrides.anchorY) {
                this.anchorY = Number.isFinite(opts.anchorY) ? Number(opts.anchorY) : Number(opts.anchor.y);
            }
            if (this._explicitOverrides.hitboxOffsetX) {
                this.hitboxOffsetX = Number(opts.hitboxOffsetX);
            }
            if (this._explicitOverrides.hitboxOffsetY) {
                this.hitboxOffsetY = Number(opts.hitboxOffsetY);
            }
            if (this._explicitOverrides.billboardAlpha) {
                this.billboardAlpha = Number(opts.billboardAlpha);
            }
            if (this._explicitOverrides.billboardTint) {
                this.billboardTint = Number(opts.billboardTint);
            }

            this.applyImageData(getPowerupImageDataByFile(this.imageFileName));

            this.groundPlaneHitbox = new CircleHitbox(
                this.x + this.hitboxOffsetX,
                this.y + this.hitboxOffsetY,
                this.radius
            );
            this.pixiSprite = null;
            this._renderingDisplayObject = null;
            this.animatedFrameCountX = 1;
            this.animatedFrameCountY = 1;
            this.animatedFps = 0;
            this._animatedFrames = null;
            this._animatedFrameIndex = 0;
            this._animatedFrameProgress = 0;
            this._animatedLastFrameCount = null;
            this._animatedFrameSignature = "";

            const staticProto = (typeof global.StaticObject === "function" && global.StaticObject.prototype)
                ? global.StaticObject.prototype
                : null;
            if (staticProto && typeof staticProto.rebuildAnimatedSpriteFrames === "function") {
                this.rebuildAnimatedSpriteFrames = staticProto.rebuildAnimatedSpriteFrames;
            }
            if (staticProto && typeof staticProto.updateSpriteAnimation === "function") {
                this.updateSpriteAnimation = staticProto.updateSpriteAnimation;
            }
            if (staticProto && typeof staticProto.configureSpriteAnimation === "function") {
                this.configureSpriteAnimation = staticProto.configureSpriteAnimation;
            }

            // Async metadata hydration from shared powerup items.json.
            // Subclasses inherit this automatically.
            this.hydrateImageData();
        }

        static async primeImageData() {
            return loadPowerupItemsDoc();
        }

        static getImageData(imageFileName) {
            return getPowerupImageDataByFile(imageFileName);
        }

        applyImageData(imageData) {
            if (!imageData || typeof imageData !== "object") return;

            if (!this._explicitOverrides.width && Number.isFinite(imageData.width)) {
                this.width = Math.max(0.01, Number(imageData.width));
            }
            if (!this._explicitOverrides.height && Number.isFinite(imageData.height)) {
                this.height = Math.max(0.01, Number(imageData.height));
            }
            if (!this._explicitOverrides.z && Number.isFinite(imageData.z)) {
                this.z = Number(imageData.z);
            }
            if (!this._explicitOverrides.imagePath) {
                if (typeof imageData.imagePath === "string" && imageData.imagePath.length > 0) {
                    this.imagePath = imageData.imagePath;
                } else {
                    this.imagePath = toPowerupImagePath(this.imageFileName);
                }
            }

            const hitboxSpec = (imageData.groundPlaneHitbox && typeof imageData.groundPlaneHitbox === "object")
                ? imageData.groundPlaneHitbox
                : null;
            if (!this._explicitOverrides.radius) {
                if (hitboxSpec && Number.isFinite(hitboxSpec.radius)) {
                    this.radius = Math.max(0.01, Number(hitboxSpec.radius));
                }
            }
            if (!this._explicitOverrides.hitboxOffsetX && hitboxSpec && Number.isFinite(hitboxSpec.xOffset)) {
                this.hitboxOffsetX = Number(hitboxSpec.xOffset);
            }
            if (!this._explicitOverrides.hitboxOffsetY && hitboxSpec && Number.isFinite(hitboxSpec.yOffset)) {
                this.hitboxOffsetY = Number(hitboxSpec.yOffset);
            }

            const anchor = (imageData.anchor && typeof imageData.anchor === "object") ? imageData.anchor : null;
            if (!this._explicitOverrides.anchorX && anchor && Number.isFinite(anchor.x)) {
                this.anchorX = Number(anchor.x);
            }
            if (!this._explicitOverrides.anchorY && anchor && Number.isFinite(anchor.y)) {
                this.anchorY = Number(anchor.y);
            }

            const billboard = (imageData.billboard && typeof imageData.billboard === "object")
                ? imageData.billboard
                : null;
            if (!this._explicitOverrides.billboardAlpha && billboard && Number.isFinite(billboard.alpha)) {
                this.billboardAlpha = Math.max(0, Math.min(1, Number(billboard.alpha)));
            }
            if (!this._explicitOverrides.billboardTint && billboard && Number.isFinite(billboard.tint)) {
                this.billboardTint = Math.max(0, Math.min(0xffffff, Math.floor(Number(billboard.tint))));
            }

            if (typeof this.configureSpriteAnimation === "function") {
                this.configureSpriteAnimation(imageData);
            }

            this.updateHitbox();
            if (this.pixiSprite) {
                if (!this._animatedFrames || this._animatedFrames.length === 0) {
                    this.pixiSprite.texture = PIXI.Texture.from(this.imagePath);
                }
                this.pixiSprite.anchor.set(this.anchorX, this.anchorY);
                this.pixiSprite.alpha = this.billboardAlpha;
                this.pixiSprite.tint = this.billboardTint;
            }
        }

        async hydrateImageData() {
            await loadPowerupItemsDoc();
            const imageData = getPowerupImageDataByFile(this.imageFileName);
            this.applyImageData(imageData);
        }

        updateHitbox() {
            if (!this.groundPlaneHitbox) {
                this.groundPlaneHitbox = new CircleHitbox(
                    this.x + this.hitboxOffsetX,
                    this.y + this.hitboxOffsetY,
                    this.radius
                );
                return;
            }
            this.groundPlaneHitbox.x = this.x + this.hitboxOffsetX;
            this.groundPlaneHitbox.y = this.y + this.hitboxOffsetY;
            this.groundPlaneHitbox.radius = this.radius;
        }

        ensureSprite() {
            if (this.pixiSprite) return this.pixiSprite;
            if (typeof PIXI === "undefined" || !PIXI.Sprite || !PIXI.Texture) return null;
            const sprite = new PIXI.Sprite(PIXI.Texture.from(this.imagePath));
            sprite.name = "powerupSprite";
            sprite.anchor.set(this.anchorX, this.anchorY);
            sprite.alpha = this.billboardAlpha;
            sprite.tint = this.billboardTint;
            sprite.visible = false;
            this.pixiSprite = sprite;
            return sprite;
        }

        ensureDepthBillboardMesh(pixiRef = null, alphaCutoff = 0.08) {
            const staticProto = (typeof global.StaticObject === "function" && global.StaticObject.prototype)
                ? global.StaticObject.prototype
                : null;
            if (!staticProto || typeof staticProto.ensureDepthBillboardMesh !== "function") {
                return null;
            }
            return staticProto.ensureDepthBillboardMesh.call(this, pixiRef, alphaCutoff);
        }

        updateDepthBillboardMesh(ctx = null, camera = null, options = {}) {
            const staticProto = (typeof global.StaticObject === "function" && global.StaticObject.prototype)
                ? global.StaticObject.prototype
                : null;
            if (!staticProto || typeof staticProto.updateDepthBillboardMesh !== "function") {
                return null;
            }
            this.ensureSprite();
            return staticProto.updateDepthBillboardMesh.call(this, ctx, camera, options);
        }

        intersectsWizard(wizard) {
            if (!wizard || this.gone || this.collected) return false;
            const wizardHitbox = wizard.groundPlaneHitbox || wizard.visualHitbox || null;
            if (!wizardHitbox || !this.groundPlaneHitbox || typeof this.groundPlaneHitbox.intersects !== "function") {
                return false;
            }
            return !!this.groundPlaneHitbox.intersects(wizardHitbox);
        }

        collect(wizard) {
            if (this.gone || this.collected) return false;
            this.collected = true;
            this.gone = true;
            if (this.pixiSprite) {
                this.pixiSprite.visible = false;
                if (this.pixiSprite.parent) {
                    this.pixiSprite.parent.removeChild(this.pixiSprite);
                }
            }
            // Intentionally left blank for custom effect behavior.
            if (this.onCollect) {
                try {
                    this.onCollect(wizard, this);
                } catch (err) {
                    console.error("Powerup onCollect callback failed", err);
                }
            }
            return true;
        }
    }

    function getPowerupArray() {
        if (!Array.isArray(global.powerups)) {
            global.powerups = [];
        }
        return global.powerups;
    }

    function addPowerup(powerupOrOptions, options = null) {
        const list = getPowerupArray();
        let powerup = null;
        if (powerupOrOptions instanceof Powerup) {
            powerup = powerupOrOptions;
        } else if (typeof powerupOrOptions === "string") {
            const opts = (options && typeof options === "object") ? options : {};
            powerup = new Powerup(powerupOrOptions, opts);
        } else if (powerupOrOptions && typeof powerupOrOptions === "object") {
            const fileName = (typeof powerupOrOptions.file === "string" && powerupOrOptions.file.length > 0)
                ? powerupOrOptions.file
                : DEFAULT_IMAGE_FILE;
            powerup = new Powerup(fileName, powerupOrOptions);
        } else {
            powerup = new Powerup(DEFAULT_IMAGE_FILE, {});
        }
        list.push(powerup);
        return powerup;
    }

    function updatePowerupsForWizard(wizard) {
        const list = getPowerupArray();
        if (!wizard) return;
        for (let i = list.length - 1; i >= 0; i--) {
            const powerup = list[i];
            if (!powerup || powerup.gone || powerup.collected) {
                list.splice(i, 1);
                continue;
            }
            powerup.updateHitbox();
            if (powerup.intersectsWizard(wizard)) {
                powerup.collect(wizard);
                list.splice(i, 1);
            }
        }
    }

    global.Powerup = Powerup;
    global.loadPowerupItemsDoc = loadPowerupItemsDoc;
    global.getPowerupImageDataByFile = getPowerupImageDataByFile;
    global.addPowerup = addPowerup;
    global.updatePowerupsForWizard = updatePowerupsForWizard;

    // Warm shared metadata cache as early as possible.
    void loadPowerupItemsDoc();
    getPowerupArray();
})(typeof globalThis !== "undefined" ? globalThis : window);
