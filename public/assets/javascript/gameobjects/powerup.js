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
    const powerupItemsByTypeKey = new Map();

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

    function normalizePowerupTypeKey(value) {
        if (typeof value !== "string") return "";
        const trimmed = decodeUriSafe(value.trim()).toLowerCase();
        if (!trimmed) return "";
        const basename = trimmed.split("/").pop() || trimmed;
        return basename;
    }

    function toPowerupImagePath(imageFileName) {
        if (typeof imageFileName !== "string" || !imageFileName.trim()) {
            return `${POWERUP_IMAGE_BASE_PATH}/${DEFAULT_IMAGE_FILE.replace(/ /g, "%20")}`;
        }
        const file = imageFileName.trim().split("/").pop() || imageFileName.trim();
        return `${POWERUP_IMAGE_BASE_PATH}/${encodeURIComponent(file).replace(/%2F/g, "/")}`;
    }

    function normalizePowerupLodTextures(spec, fallbackImagePath = null) {
        if (!Array.isArray(spec)) return [];
        const out = [];
        spec.forEach(entry => {
            if (typeof entry === "string" && entry.length > 0) {
                out.push({ texturePath: entry, maxDistance: Infinity });
                return;
            }
            if (!entry || typeof entry !== "object") return;
            const texturePath = (typeof entry.texturePath === "string" && entry.texturePath.length > 0)
                ? entry.texturePath
                : null;
            if (!texturePath) return;
            const maxDistance = Number.isFinite(entry.maxDistance)
                ? Math.max(0, Number(entry.maxDistance))
                : Infinity;
            out.push({ texturePath, maxDistance });
        });
        if (out.length === 0) return [];
        out.sort((a, b) => {
            const da = Number.isFinite(a.maxDistance) ? a.maxDistance : Infinity;
            const db = Number.isFinite(b.maxDistance) ? b.maxDistance : Infinity;
            return da - db;
        });
        if (
            typeof fallbackImagePath === "string" &&
            fallbackImagePath.length > 0 &&
            !out.some(entry => entry.texturePath === fallbackImagePath)
        ) {
            out.push({ texturePath: fallbackImagePath, maxDistance: Infinity });
        }
        return out;
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
        powerupItemsByTypeKey.clear();
        if (!doc || !Array.isArray(doc.items)) return;
        for (let i = 0; i < doc.items.length; i++) {
            const item = doc.items[i];
            if (!item || typeof item !== "object") continue;
            const merged = mergePowerupImageData(doc.defaults, item);
            const fileKey = normalizeImageFileName(item.file || item.imageFileName || item.imagePath || "");
            const typeKeys = [
                fileKey,
                normalizePowerupTypeKey(item.id || ""),
                normalizePowerupTypeKey(item.name || ""),
                normalizePowerupTypeKey(item.imagePath || "")
            ].filter(Boolean);
            if (fileKey) {
                powerupItemsByFileName.set(fileKey, merged);
            }
            for (let j = 0; j < typeKeys.length; j++) {
                const typeKey = typeKeys[j];
                if (!powerupItemsByTypeKey.has(typeKey)) {
                    powerupItemsByTypeKey.set(typeKey, merged);
                }
            }
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

    function getPowerupImageData(powerupType) {
        const typeKey = normalizePowerupTypeKey(powerupType);
        if (typeKey && powerupItemsByTypeKey.has(typeKey)) {
            return powerupItemsByTypeKey.get(typeKey);
        }
        return getPowerupImageDataByFile(powerupType);
    }

    function resolvePowerupFileName(powerupType, imageData = null) {
        if (imageData && typeof imageData.file === "string" && imageData.file.trim().length > 0) {
            return imageData.file.trim();
        }
        if (typeof powerupType === "string" && powerupType.trim().length > 0) {
            const fileName = powerupType.trim().split("/").pop() || powerupType.trim();
            const decoded = decodeUriSafe(fileName);
            if (/\.[A-Za-z0-9]+$/.test(decoded)) {
                return decoded;
            }
            if (decoded.includes("_")) {
                return `${decoded.replace(/_/g, "")}.png`;
            }
            return `${decoded}.png`;
        }
        return DEFAULT_IMAGE_FILE;
    }

    function getScaledPowerupOptions(powerupType, options = {}) {
        const opts = (options && typeof options === "object") ? options : {};
        const imageData = getPowerupImageData(powerupType);
        const sizeScale = Number.isFinite(opts.size) && Number(opts.size) > 0 ? Number(opts.size) : 1;
        const hitboxSpec = (imageData && imageData.groundPlaneHitbox && typeof imageData.groundPlaneHitbox === "object")
            ? imageData.groundPlaneHitbox
            : null;
        const baseWidth = Number.isFinite(imageData && imageData.width) ? Number(imageData.width) : 0.8;
        const baseHeight = Number.isFinite(imageData && imageData.height) ? Number(imageData.height) : 0.8;
        const baseRadius = Number.isFinite(hitboxSpec && hitboxSpec.radius) ? Number(hitboxSpec.radius) : DEFAULT_RADIUS;

        return {
            fileName: resolvePowerupFileName(powerupType, imageData),
            imageData,
            size: sizeScale,
            width: Number.isFinite(opts.width) ? Math.max(0.01, Number(opts.width)) : Math.max(0.01, baseWidth * sizeScale),
            height: Number.isFinite(opts.height) ? Math.max(0.01, Number(opts.height)) : Math.max(0.01, baseHeight * sizeScale),
            radius: Number.isFinite(opts.radius) ? Math.max(0.01, Number(opts.radius)) : Math.max(0.01, baseRadius * sizeScale)
        };
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
            this.z = Number.isFinite(opts.z) ? Number(opts.z) : 0;
            this.vz = Number.isFinite(opts.vz) ? Number(opts.vz) : 0;
            this.gravity = Number.isFinite(opts.gravity) ? Number(opts.gravity) : 10;
            this.size = Number.isFinite(opts.size) && Number(opts.size) > 0 ? Number(opts.size) : 1;
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
            this.lodTextures = [];
            this.gravitateRadius = Number.isFinite(opts.gravitateRadius) ? Math.max(0, Number(opts.gravitateRadius)) : 0;
            this.gravitateSpeed = Number.isFinite(opts.gravitateSpeed) ? Math.max(0, Number(opts.gravitateSpeed)) : 5;
            this.gone = false;
            this.collected = false;
            this.onCollect = (typeof opts.onCollect === "function") ? opts.onCollect : null;
            if (Object.prototype.hasOwnProperty.call(opts, "script")) {
                try {
                    this.script = JSON.parse(JSON.stringify(opts.script));
                } catch (_err) {
                    this.script = opts.script;
                }
            }
            if (typeof opts.scriptingName === "string") {
                this.scriptingName = opts.scriptingName;
            }

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
                vz: Number.isFinite(opts.vz),
                gravity: Number.isFinite(opts.gravity),
                billboardAlpha: Number.isFinite(opts.billboardAlpha),
                billboardTint: Number.isFinite(opts.billboardTint),
                gravitateRadius: Number.isFinite(opts.gravitateRadius),
                gravitateSpeed: Number.isFinite(opts.gravitateSpeed)
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
            if (this._explicitOverrides.vz) {
                this.vz = Number(opts.vz);
            }
            if (this._explicitOverrides.gravity) {
                this.gravity = Number(opts.gravity);
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
            this.lodTextures = normalizePowerupLodTextures(imageData.lodTextures, this.imagePath);
            this._activeLodTexturePath = null;

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

            if (!this._explicitOverrides.gravitateRadius && Number.isFinite(imageData.gravitateRadius)) {
                this.gravitateRadius = Math.max(0, Number(imageData.gravitateRadius));
            }
            if (!this._explicitOverrides.gravitateSpeed && Number.isFinite(imageData.gravitateSpeed)) {
                this.gravitateSpeed = Math.max(0, Number(imageData.gravitateSpeed));
            }

            if (!Object.prototype.hasOwnProperty.call(this, "script") &&
                Object.prototype.hasOwnProperty.call(imageData, "script")) {
                try {
                    this.script = JSON.parse(JSON.stringify(imageData.script));
                } catch (_err) {
                    this.script = imageData.script;
                }
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

        gravitateToward(targetX, targetY, dt) {
            if (this.gone || this.collected) return;
            if (!Number.isFinite(targetX) || !Number.isFinite(targetY) || !Number.isFinite(dt) || dt <= 0) return;
            const dx = targetX - this.x;
            const dy = targetY - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 0.001) return;
            const step = Math.min(this.gravitateSpeed * dt, dist);
            this.x += (dx / dist) * step;
            this.y += (dy / dist) * step;
            this.updateHitbox();
        }

        updateVerticalMotion(dt) {
            if (this.gone || this.collected) return false;
            const delta = Number.isFinite(dt) && dt > 0 ? Number(dt) : 0;
            if (!(delta > 0)) return false;
            const currentZ = Number.isFinite(this.z) ? Number(this.z) : 0;
            const currentVz = Number.isFinite(this.vz) ? Number(this.vz) : 0;
            if (currentZ <= 0 && Math.abs(currentVz) <= 1e-6) {
                this.z = 0;
                this.vz = 0;
                return false;
            }

            const gravity = Number.isFinite(this.gravity) ? Math.max(0, Number(this.gravity)) : 0;
            const nextVz = currentVz - gravity * delta;
            const nextZ = currentZ + nextVz * delta;
            if (nextZ <= 0) {
                this.z = 0;
                this.vz = 0;
                return true;
            }

            this.z = nextZ;
            this.vz = nextVz;
            return true;
        }

        collect(wizard) {
            if (this.gone || this.collected) return false;
            if (Number.isFinite(this.z) && Number(this.z) > 0.01) return false;
            const scriptingApi = (typeof global.Scripting === "object" && global.Scripting)
                ? global.Scripting
                : null;
            let touchScriptAlreadyTriggered = false;
            const touchedMap = (wizard && wizard._scriptTouchedObjectsById instanceof Map)
                ? wizard._scriptTouchedObjectsById
                : null;
            if (touchedMap) {
                for (const touched of touchedMap.values()) {
                    if (touched && touched.obj === this) {
                        touchScriptAlreadyTriggered = true;
                        break;
                    }
                }
            }
            if (!touchScriptAlreadyTriggered &&
                scriptingApi &&
                typeof scriptingApi.fireObjectScriptEvent === "function") {
                scriptingApi.fireObjectScriptEvent(this, "playerTouches", wizard || null, {
                    pickup: true,
                    x: Number(this.x),
                    y: Number(this.y)
                });
            }
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

        saveJson() {
            return {
                type: "powerup",
                file: this.imageFileName,
                x: this.x,
                y: this.y,
                z: this.z,
                vz: this.vz,
                gravity: this.gravity,
                size: this.size,
                imagePath: this.imagePath,
                width: this.width,
                height: this.height,
                radius: this.radius,
                hitboxOffsetX: this.hitboxOffsetX,
                hitboxOffsetY: this.hitboxOffsetY,
                anchorX: this.anchorX,
                anchorY: this.anchorY,
                billboardAlpha: this.billboardAlpha,
                billboardTint: this.billboardTint,
                gravitateRadius: this.gravitateRadius,
                gravitateSpeed: this.gravitateSpeed,
                scriptingName: (typeof this.scriptingName === "string") ? this.scriptingName : "",
                script: Object.prototype.hasOwnProperty.call(this, "script") ? this.script : undefined,
                _scriptDeactivated: this._scriptDeactivated === true ? true : undefined,
                _scriptMessages: Array.isArray(this._scriptMessages)
                    ? this._scriptMessages.map(msg => ({
                        text: String((msg && msg.text) || ""),
                        x: Number.isFinite(msg && msg.x) ? Number(msg.x) : 0,
                        y: Number.isFinite(msg && msg.y) ? Number(msg.y) : 0,
                        color: (typeof (msg && msg.color) === "string" || Number.isFinite(msg && msg.color)) ? msg.color : undefined,
                        fontsize: Number.isFinite(Number(msg && msg.fontsize)) ? Number(msg.fontsize) : undefined
                    })).filter(msg => msg.text.length > 0)
                    : undefined
            };
        }

        static loadJson(data) {
            if (!data || typeof data !== "object") return null;
            const fileName = (typeof data.file === "string" && data.file.trim().length > 0)
                ? data.file.trim()
                : DEFAULT_IMAGE_FILE;
            const powerup = new Powerup(fileName, {
                x: data.x,
                y: data.y,
                z: data.z,
                vz: data.vz,
                gravity: data.gravity,
                size: data.size,
                imagePath: data.imagePath,
                width: data.width,
                height: data.height,
                radius: data.radius,
                hitboxOffsetX: data.hitboxOffsetX,
                hitboxOffsetY: data.hitboxOffsetY,
                anchorX: data.anchorX,
                anchorY: data.anchorY,
                billboardAlpha: data.billboardAlpha,
                billboardTint: data.billboardTint,
                gravitateRadius: data.gravitateRadius,
                gravitateSpeed: data.gravitateSpeed,
                script: data.script,
                scriptingName: data.scriptingName
            });
            if (powerup && Array.isArray(data._scriptMessages)) {
                powerup._scriptMessages = data._scriptMessages
                    .map(msg => ({
                        text: String((msg && msg.text) || ""),
                        x: Number.isFinite(msg && msg.x) ? Number(msg.x) : 0,
                        y: Number.isFinite(msg && msg.y) ? Number(msg.y) : 0,
                        color: (typeof (msg && msg.color) === "string" || Number.isFinite(msg && msg.color)) ? msg.color : undefined,
                        fontsize: Number.isFinite(Number(msg && msg.fontsize)) ? Number(msg.fontsize) : undefined
                    }))
                    .filter(msg => msg.text.length > 0);
                if (powerup._scriptMessages.length > 0 && typeof globalThis !== "undefined") {
                    if (!(globalThis._scriptMessageTargets instanceof Set)) {
                        globalThis._scriptMessageTargets = new Set();
                    }
                    globalThis._scriptMessageTargets.add(powerup);
                }
            }
            if (powerup && data._scriptDeactivated === true) {
                powerup._scriptDeactivated = true;
            }
            return powerup;
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

    /**
     * Fast segment-vs-segment intersection test.
     * Returns true if segment (ax,ay)-(bx,by) crosses segment (cx,cy)-(dx,dy).
     */
    function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
        const rx = bx - ax, ry = by - ay;
        const sx = dx - cx, sy = dy - cy;
        const denom = rx * sy - ry * sx;
        if (Math.abs(denom) < 1e-10) return false;
        const qpx = cx - ax, qpy = cy - ay;
        const t = (qpx * sy - qpy * sx) / denom;
        if (t < 0 || t > 1) return false;
        const u = (qpx * ry - qpy * rx) / denom;
        return u >= 0 && u <= 1;
    }

    /**
     * Returns true if the line segment from (x0,y0) to (x1,y1) is blocked
     * by any wall polygon edge.  Uses AABB pre-rejection per wall for speed.
     */
    function isSegmentBlockedByWalls(x0, y0, x1, y1) {
        const WallCtor = global.WallSectionUnit;
        if (!WallCtor || !(WallCtor._allSections instanceof Map)) return false;

        // AABB of the query segment, with a small margin for wall thickness
        const margin = 0.3;
        const minX = Math.min(x0, x1) - margin;
        const maxX = Math.max(x0, x1) + margin;
        const minY = Math.min(y0, y1) - margin;
        const maxY = Math.max(y0, y1) + margin;

        for (const wall of WallCtor._allSections.values()) {
            if (!wall || wall.gone || wall.vanishing) continue;
            const hitbox = wall.groundPlaneHitbox;
            if (!hitbox || !Array.isArray(hitbox.points) || hitbox.points.length < 2) continue;

            // Quick AABB rejection using the hitbox bounds
            const bounds = hitbox.getBounds();
            if (!bounds) continue;
            if (bounds.x > maxX || bounds.x + bounds.width < minX) continue;
            if (bounds.y > maxY || bounds.y + bounds.height < minY) continue;

            // Test query segment against every edge of this wall polygon
            const pts = hitbox.points;
            for (let i = 0, len = pts.length; i < len; i++) {
                const a = pts[i];
                const b = pts[(i + 1) % len];
                if (segmentsIntersect(x0, y0, x1, y1, a.x, a.y, b.x, b.y)) {
                    return true;
                }
            }
        }
        return false;
    }

    function isDropHitboxBlockedByWalls(hitbox) {
        const WallCtor = global.WallSectionUnit;
        if (!WallCtor || !(WallCtor._allSections instanceof Map) || !hitbox) return false;

        for (const wall of WallCtor._allSections.values()) {
            if (!wall || wall.gone || wall.vanishing) continue;
            const wallHitbox = wall.groundPlaneHitbox || wall.visualHitbox || wall.hitbox || null;
            if (!wallHitbox) continue;
            if (typeof wallHitbox.intersects === "function" && wallHitbox.intersects(hitbox)) {
                return true;
            }
            if (typeof wallHitbox.containsPoint === "function" && wallHitbox.containsPoint(hitbox.x, hitbox.y)) {
                return true;
            }
        }

        return false;
    }

    function isValidDropPosition(mapRef, originX, originY, targetX, targetY, radius, acceptedDrops = []) {
        const sampleHitbox = new CircleHitbox(targetX, targetY, radius);
        if (isDropHitboxBlockedByWalls(sampleHitbox)) return false;

        const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(originX, targetX)
            : (targetX - originX);
        const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(originY, targetY)
            : (targetY - originY);
        const distance = Math.hypot(dx, dy);
        const sampleCount = Math.max(1, Math.ceil(distance / Math.max(radius * 0.75, 0.08)));
        for (let i = 1; i <= sampleCount; i++) {
            const t = i / sampleCount;
            const pathXRaw = originX + dx * t;
            const pathYRaw = originY + dy * t;
            const pathHitbox = new CircleHitbox(
                mapRef && typeof mapRef.wrapWorldX === "function" ? mapRef.wrapWorldX(pathXRaw) : pathXRaw,
                mapRef && typeof mapRef.wrapWorldY === "function" ? mapRef.wrapWorldY(pathYRaw) : pathYRaw,
                radius
            );
            if (isDropHitboxBlockedByWalls(pathHitbox)) {
                return false;
            }
        }

        for (let i = 0; i < acceptedDrops.length; i++) {
            const drop = acceptedDrops[i];
            if (!drop) continue;
            const dropHitbox = new CircleHitbox(drop.x, drop.y, radius);
            if (sampleHitbox.intersects(dropHitbox)) {
                return false;
            }
        }

        return true;
    }

    function findValidDropPosition(mapRef, originX, originY, options = {}) {
        const preferredDistance = Number.isFinite(options.preferredDistance)
            ? Math.max(0, Number(options.preferredDistance))
            : 0;
        const radius = Number.isFinite(options.radius) ? Math.max(0.01, Number(options.radius)) : DEFAULT_RADIUS;
        const acceptedDrops = Array.isArray(options.acceptedDrops) ? options.acceptedDrops : [];
        const baseAngle = Number.isFinite(options.baseAngle) ? Number(options.baseAngle) : 0;

        if (preferredDistance <= 1e-6) {
            if (isValidDropPosition(mapRef, originX, originY, originX, originY, radius, acceptedDrops)) {
                return { x: originX, y: originY };
            }
        }

        for (let ring = 0; ring < 4; ring++) {
            const distance = Math.max(radius * 2.5, preferredDistance - ring * 0.12);
            for (let step = 0; step < 12; step++) {
                const angle = baseAngle + (step * Math.PI / 6);
                const rawX = originX + Math.cos(angle) * distance;
                const rawY = originY + Math.sin(angle) * distance;
                const x = mapRef && typeof mapRef.wrapWorldX === "function" ? mapRef.wrapWorldX(rawX) : rawX;
                const y = mapRef && typeof mapRef.wrapWorldY === "function" ? mapRef.wrapWorldY(rawY) : rawY;
                if (!isValidDropPosition(mapRef, originX, originY, x, y, radius, acceptedDrops)) continue;
                return { x, y };
            }
        }

        return isValidDropPosition(mapRef, originX, originY, originX, originY, radius, acceptedDrops)
            ? { x: originX, y: originY }
            : null;
    }

    function dropPowerupNearSource(source, powerupType, options = {}) {
        if (typeof addPowerup !== "function") return null;
        const opts = (options && typeof options === "object") ? options : {};
        const scaled = getScaledPowerupOptions(powerupType, opts);
        const mapRef = opts.map || (source && source.map) || global.map || null;
        const sourceX = Number.isFinite(opts.originX)
            ? Number(opts.originX)
            : (Number.isFinite(source && source.x) ? Number(source.x) : 0);
        const sourceY = Number.isFinite(opts.originY)
            ? Number(opts.originY)
            : (Number.isFinite(source && source.y) ? Number(source.y) : 0);
        const offsetX = Number.isFinite(opts.offsetX) ? Number(opts.offsetX) : 0;
        const offsetY = Number.isFinite(opts.offsetY) ? Number(opts.offsetY) : 0;
        const originXRaw = sourceX + offsetX;
        const originYRaw = sourceY + offsetY;
        const originX = mapRef && typeof mapRef.wrapWorldX === "function" ? mapRef.wrapWorldX(originXRaw) : originXRaw;
        const originY = mapRef && typeof mapRef.wrapWorldY === "function" ? mapRef.wrapWorldY(originYRaw) : originYRaw;
        const count = Number.isFinite(opts.count) ? Math.max(1, Math.floor(Number(opts.count))) : 1;
        const acceptedDrops = [];
        const dropped = [];
        const sourceRadius = Number.isFinite(source && source.groundRadius)
            ? Number(source.groundRadius)
            : (Number.isFinite(source && source.radius) ? Number(source.radius) : 0);
        const defaultDistance = (count > 1)
            ? Math.max(scaled.radius * 2.5, sourceRadius + scaled.radius + 0.15)
            : 0;
        const preferredDistance = Number.isFinite(opts.preferredDistance)
            ? Math.max(0, Number(opts.preferredDistance))
            : defaultDistance;
        const baseAngle = Number.isFinite(opts.baseAngle) ? Number(opts.baseAngle) : (Math.random() * Math.PI * 2);

        for (let i = 0; i < count; i++) {
            const angle = baseAngle + ((count > 1) ? (i * Math.PI * 2 / count) : 0);
            const position = findValidDropPosition(mapRef, originX, originY, {
                baseAngle: angle,
                preferredDistance,
                radius: scaled.radius,
                acceptedDrops
            });
            if (!position) continue;

            acceptedDrops.push(position);
            const powerup = addPowerup(scaled.fileName, {
                ...opts,
                x: position.x,
                y: position.y,
                map: mapRef,
                size: scaled.size,
                width: scaled.width,
                height: scaled.height,
                radius: scaled.radius
            });
            if (powerup && opts.registerWithMap === true && mapRef && typeof mapRef.registerGameObject === "function") {
                mapRef.registerGameObject(powerup);
            }
            if (powerup) {
                dropped.push(powerup);
            }
        }

        return count === 1 ? (dropped[0] || null) : dropped;
    }

    function updatePowerupsForWizard(wizard, dt) {
        const list = getPowerupArray();
        if (!wizard) return;
        const safeDt = (Number.isFinite(dt) && dt > 0) ? dt : (1 / 60);
        for (let i = list.length - 1; i >= 0; i--) {
            const powerup = list[i];
            if (!powerup || powerup.gone || powerup.collected) {
                list.splice(i, 1);
                continue;
            }
            if (typeof powerup.updateVerticalMotion === "function") {
                powerup.updateVerticalMotion(safeDt);
            }
            powerup.updateHitbox();
            if (powerup.intersectsWizard(wizard)) {
                powerup.collect(wizard);
                list.splice(i, 1);
                continue;
            }
            // Gravitate toward wizard if within gravitateRadius and not blocked by a wall
            if (powerup.gravitateRadius > 0) {
                const dx = wizard.x - powerup.x;
                const dy = wizard.y - powerup.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0 && dist <= powerup.gravitateRadius) {
                    if (!isSegmentBlockedByWalls(powerup.x, powerup.y, wizard.x, wizard.y)) {
                        powerup.gravitateToward(wizard.x, wizard.y, safeDt);
                    }
                }
            }
        }
    }

    global.Powerup = Powerup;
    global.loadPowerupItemsDoc = loadPowerupItemsDoc;
    global.getPowerupImageData = getPowerupImageData;
    global.getPowerupImageDataByFile = getPowerupImageDataByFile;
    global.getScaledPowerupOptions = getScaledPowerupOptions;
    global.addPowerup = addPowerup;
    global.dropPowerupNearSource = dropPowerupNearSource;
    global.updatePowerupsForWizard = updatePowerupsForWizard;

    // Warm shared metadata cache as early as possible.
    void loadPowerupItemsDoc();
    getPowerupArray();
})(typeof globalThis !== "undefined" ? globalThis : window);
