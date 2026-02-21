const placeableMetadataByCategory = new Map();
const placeableMetadataFetchPromises = new Map();

function normalizePlaceableRotationAxis(axis, category = null) {
    const value = (typeof axis === "string") ? axis.trim().toLowerCase() : "";
    if (value === "spatial" || value === "visual" || value === "none") return value;
    const cat = (typeof category === "string") ? category.trim().toLowerCase() : "";
    if (cat === "doors" || cat === "windows") return "spatial";
    return "visual";
}

function derivePlaceableType(category) {
    const cat = (typeof category === "string") ? category.trim().toLowerCase() : "";
    if (!cat) return "placedObject";
    if (cat === "windows") return "window";
    if (cat === "doors") return "door";
    if (cat === "flowers") return "flower";
    return cat;
}

function normalizeTextureBasename(texturePath) {
    if (typeof texturePath !== "string" || texturePath.length === 0) return "";
    const rawName = texturePath.split("/").pop() || "";
    try {
        return decodeURIComponent(rawName);
    } catch (_) {
        return rawName;
    }
}

function normalizeTexturePathForMetadata(texturePath) {
    if (typeof texturePath !== "string" || texturePath.length === 0) return "";
    const raw = texturePath.split("?")[0].split("#")[0];
    if (raw.startsWith("/")) return raw;
    try {
        if (typeof window !== "undefined" && window.location && window.location.origin) {
            return new URL(raw, window.location.origin).pathname || raw;
        }
    } catch (_) {}
    return raw;
}

function normalizeLodTextures(spec, fallbackTexturePath = null) {
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
        typeof fallbackTexturePath === "string" &&
        fallbackTexturePath.length > 0 &&
        !out.some(entry => entry.texturePath === fallbackTexturePath)
    ) {
        out.push({ texturePath: fallbackTexturePath, maxDistance: Infinity });
    }
    return out;
}

async function fetchPlaceableMetadataForCategory(category) {
    const safeCategory = (typeof category === "string" && category.length > 0) ? category : "doors";
    if (placeableMetadataByCategory.has(safeCategory)) {
        return placeableMetadataByCategory.get(safeCategory);
    }
    if (placeableMetadataFetchPromises.has(safeCategory)) {
        return placeableMetadataFetchPromises.get(safeCategory);
    }
    const request = fetch(`/assets/images/${encodeURIComponent(safeCategory)}/items.json`, { cache: "no-cache" })
        .then(async response => {
            if (!response.ok) return null;
            const parsed = await response.json();
            placeableMetadataByCategory.set(safeCategory, parsed);
            return parsed;
        })
        .catch(() => null)
        .finally(() => {
            placeableMetadataFetchPromises.delete(safeCategory);
        });
    placeableMetadataFetchPromises.set(safeCategory, request);
    return request;
}

function valueOr(value, fallback) {
    return Number.isFinite(value) ? Number(value) : fallback;
}

function shouldScaleHitboxWithItem(spec) {
    if (!spec || typeof spec !== "object") return true;
    if (typeof spec.scaleWithItem === "boolean") return spec.scaleWithItem;
    return true;
}

function resolveHitboxScaleContext(spec, item, fallbackBaseWidth = 1, fallbackBaseHeight = 1) {
    const baseWidth = Math.max(
        1e-6,
        Number.isFinite(spec && spec.baseWidth) ? Number(spec.baseWidth) : fallbackBaseWidth
    );
    const baseHeight = Math.max(
        1e-6,
        Number.isFinite(spec && spec.baseHeight) ? Number(spec.baseHeight) : fallbackBaseHeight
    );
    const scaleX = Number.isFinite(item && item.width) ? (item.width / baseWidth) : 1;
    const scaleY = Number.isFinite(item && item.height) ? (item.height / baseHeight) : 1;
    const radiusScale = (Math.abs(scaleX) + Math.abs(scaleY)) * 0.5;
    return {
        scaleX: Number.isFinite(scaleX) ? scaleX : 1,
        scaleY: Number.isFinite(scaleY) ? scaleY : 1,
        radiusScale: Number.isFinite(radiusScale) ? radiusScale : 1
    };
}

function resolveCircleRadius(spec, item, fallbackRadius, scaleContext) {
    if (!spec || typeof spec !== "object") return fallbackRadius;
    const scaleRadius = shouldScaleHitboxWithItem(spec)
        ? valueOr(scaleContext && scaleContext.radiusScale, 1)
        : 1;
    if (Number.isFinite(spec.radius)) return Number(spec.radius) * scaleRadius;
    if (Number.isFinite(spec.radiusFromWidthMultiplier)) return item.width * Number(spec.radiusFromWidthMultiplier);
    if (Number.isFinite(spec.radiusFromHeightMultiplier)) return item.height * Number(spec.radiusFromHeightMultiplier);
    if (Number.isFinite(spec.radiusFromMaxDimensionMultiplier)) return Math.max(item.width, item.height) * Number(spec.radiusFromMaxDimensionMultiplier);
    if (Number.isFinite(spec.radiusFromSizeMultiplier)) {
        const sizeBase = Number.isFinite(item.size) ? item.size : Math.max(item.width, item.height);
        return sizeBase * Number(spec.radiusFromSizeMultiplier);
    }
    return fallbackRadius;
}

function resolveHitboxOffsetY(spec, item, scaleContext) {
    if (!spec || typeof spec !== "object") return 0;
    const scaleY = shouldScaleHitboxWithItem(spec)
        ? valueOr(scaleContext && scaleContext.scaleY, 1)
        : 1;
    let yOffset = valueOr(spec.yOffset, 0) * scaleY;
    if (Number.isFinite(spec.yOffsetFromHeightMultiplier)) yOffset += item.height * Number(spec.yOffsetFromHeightMultiplier);
    if (Number.isFinite(spec.yOffsetFromWidthMultiplier)) yOffset += item.width * Number(spec.yOffsetFromWidthMultiplier);
    if (Number.isFinite(spec.yOffsetFromMaxDimensionMultiplier)) yOffset += Math.max(item.width, item.height) * Number(spec.yOffsetFromMaxDimensionMultiplier);
    return yOffset;
}

function resolveHitboxOffsetX(spec, item, scaleContext) {
    if (!spec || typeof spec !== "object") return 0;
    const scaleX = shouldScaleHitboxWithItem(spec)
        ? valueOr(scaleContext && scaleContext.scaleX, 1)
        : 1;
    let xOffset = valueOr(spec.xOffset, 0) * scaleX;
    if (Number.isFinite(spec.xOffsetFromWidthMultiplier)) xOffset += item.width * Number(spec.xOffsetFromWidthMultiplier);
    if (Number.isFinite(spec.xOffsetFromHeightMultiplier)) xOffset += item.height * Number(spec.xOffsetFromHeightMultiplier);
    if (Number.isFinite(spec.xOffsetFromMaxDimensionMultiplier)) xOffset += Math.max(item.width, item.height) * Number(spec.xOffsetFromMaxDimensionMultiplier);
    return xOffset;
}

function buildCircleHitboxFromSpec(spec, item, fallbackRadius, scaleContext) {
    const xOffset = resolveHitboxOffsetX(spec, item, scaleContext);
    const yOffset = resolveHitboxOffsetY(spec, item, scaleContext);
    const radius = Math.max(0.01, resolveCircleRadius(spec, item, fallbackRadius, scaleContext));
    return new CircleHitbox(item.x + xOffset, item.y + yOffset, radius);
}

function resolvePolygonPointCoordinate(pointSpec, axis, item, scaleContext, scaleWithItem = true) {
    if (!pointSpec || typeof pointSpec !== "object") return 0;
    const keyBase = axis === "x" ? "x" : "y";
    const widthKey = `${keyBase}FromWidthMultiplier`;
    const heightKey = `${keyBase}FromHeightMultiplier`;
    const maxKey = `${keyBase}FromMaxDimensionMultiplier`;
    const offsetKey = `${keyBase}Offset`;
    const axisScale = scaleWithItem
        ? valueOr(scaleContext && (axis === "x" ? scaleContext.scaleX : scaleContext.scaleY), 1)
        : 1;
    let out = 0;
    if (Number.isFinite(pointSpec[keyBase])) out += Number(pointSpec[keyBase]) * axisScale;
    if (Number.isFinite(pointSpec[offsetKey])) out += Number(pointSpec[offsetKey]) * axisScale;
    if (Number.isFinite(pointSpec[widthKey])) out += item.width * Number(pointSpec[widthKey]);
    if (Number.isFinite(pointSpec[heightKey])) out += item.height * Number(pointSpec[heightKey]);
    if (Number.isFinite(pointSpec[maxKey])) out += Math.max(item.width, item.height) * Number(pointSpec[maxKey]);
    return out;
}

function buildPolygonHitboxFromSpec(spec, item, scaleContext) {
    if (!spec || typeof spec !== "object" || !Array.isArray(spec.points)) return null;
    const scaleWithItem = shouldScaleHitboxWithItem(spec);
    const points = spec.points
        .map(point => ({
            x: item.x + resolvePolygonPointCoordinate(point, "x", item, scaleContext, scaleWithItem),
            y: item.y + resolvePolygonPointCoordinate(point, "y", item, scaleContext, scaleWithItem)
        }))
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length < 3) return null;
    return new PolygonHitbox(points);
}

function buildHitboxFromSpec(spec, item, fallbackRadius, scaleContext) {
    const isNoneSpec = (
        spec === "none" ||
        (spec && typeof spec === "object" && typeof spec.type === "string" && spec.type.trim().toLowerCase() === "none")
    );
    if (isNoneSpec) {
        return null;
    }
    if (!spec || typeof spec !== "object") {
        return buildCircleHitboxFromSpec({}, item, fallbackRadius, scaleContext);
    }
    if (spec.type === "polygon") {
        const polygon = buildPolygonHitboxFromSpec(spec, item, scaleContext);
        if (polygon) return polygon;
    }
    return buildCircleHitboxFromSpec(spec, item, fallbackRadius, scaleContext);
}

function rotatePointAroundOrigin(px, py, ox, oy, radians) {
    const dx = px - ox;
    const dy = py - oy;
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return {
        x: ox + dx * c - dy * s,
        y: oy + dx * s + dy * c
    };
}

function rotateHitboxAroundOrigin(hitbox, originX, originY, angleDegrees) {
    if (!hitbox || !Number.isFinite(originX) || !Number.isFinite(originY)) return hitbox;
    const deg = Number(angleDegrees);
    if (!Number.isFinite(deg)) return hitbox;
    const radians = deg * (Math.PI / 180);
    if (Math.abs(radians) < 1e-8) return hitbox;

    if (hitbox instanceof CircleHitbox) {
        const rotatedCenter = rotatePointAroundOrigin(hitbox.x, hitbox.y, originX, originY, radians);
        return new CircleHitbox(rotatedCenter.x, rotatedCenter.y, hitbox.radius);
    }
    if (hitbox instanceof PolygonHitbox && Array.isArray(hitbox.points) && hitbox.points.length >= 3) {
        const rotatedPoints = hitbox.points.map(pt => rotatePointAroundOrigin(pt.x, pt.y, originX, originY, radians));
        return new PolygonHitbox(rotatedPoints);
    }
    return hitbox;
}

function resolvePlacedObjectAnchor(item) {
    if (!item) return { x: 0.5, y: 1 };
    const spriteAnchor = item.pixiSprite && item.pixiSprite.anchor
        ? item.pixiSprite.anchor
        : null;
    const ax = Number.isFinite(item.placeableAnchorX)
        ? Number(item.placeableAnchorX)
        : (spriteAnchor && Number.isFinite(spriteAnchor.x) ? Number(spriteAnchor.x) : 0.5);
    const ay = Number.isFinite(item.placeableAnchorY)
        ? Number(item.placeableAnchorY)
        : (spriteAnchor && Number.isFinite(spriteAnchor.y) ? Number(spriteAnchor.y) : 1);
    return { x: ax, y: ay };
}

function getPlacedObjectAnchorWorldPoint(item) {
    if (!item || !Number.isFinite(item.x) || !Number.isFinite(item.y)) return null;
    const anchor = resolvePlacedObjectAnchor(item);
    const width = Math.max(0.01, Number.isFinite(item.width) ? Number(item.width) : 1);
    const height = Math.max(0.01, Number.isFinite(item.height) ? Number(item.height) : 1);
    return {
        x: item.x + (anchor.x - 0.5) * width,
        y: item.y - (1 - anchor.y) * height
    };
}

function buildWallMountedRectGroundHitbox(item, options = {}) {
    if (!item) return null;
    const width = Math.max(0.01, Number.isFinite(item.width) ? Number(item.width) : 1);
    const anchor = resolvePlacedObjectAnchor(item);
    const anchorWorld = getPlacedObjectAnchorWorldPoint(item) || { x: item.x, y: item.y };
    const rotDeg = Number.isFinite(item.placementRotation) ? Number(item.placementRotation) : 0;
    const theta = rotDeg * (Math.PI / 180);
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    const nx = -uy;
    const ny = ux;
    const centerX = anchorWorld.x - ux * ((Number(anchor.x) - 0.5) * width);
    const centerY = anchorWorld.y - uy * ((Number(anchor.x) - 0.5) * width);
    const baseThickness = Number.isFinite(options.wallThickness)
        ? Number(options.wallThickness)
        : 0.1;
    const thicknessMultiplier = Number.isFinite(options.thicknessMultiplier)
        ? Number(options.thicknessMultiplier)
        : 1;
    const halfWidth = width * 0.5;
    const halfThickness = Math.max(0.005, baseThickness * Math.max(0.1, thicknessMultiplier) * 0.5);
    return new PolygonHitbox([
        { x: centerX - ux * halfWidth + nx * halfThickness, y: centerY - uy * halfWidth + ny * halfThickness },
        { x: centerX + ux * halfWidth + nx * halfThickness, y: centerY + uy * halfWidth + ny * halfThickness },
        { x: centerX + ux * halfWidth - nx * halfThickness, y: centerY + uy * halfWidth - ny * halfThickness },
        { x: centerX - ux * halfWidth - nx * halfThickness, y: centerY - uy * halfWidth - ny * halfThickness }
    ]);
}

function closestPointOnSegment2D(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (!(len2 > 1e-8)) {
        const ddx = px - ax;
        const ddy = py - ay;
        return { x: ax, y: ay, t: 0, dist2: ddx * ddx + ddy * ddy };
    }
    const rawT = ((px - ax) * dx + (py - ay) * dy) / len2;
    const t = Math.max(0, Math.min(1, rawT));
    const x = ax + dx * t;
    const y = ay + dy * t;
    const ddx = px - x;
    const ddy = py - y;
    return { x, y, t, dist2: ddx * ddx + ddy * ddy };
}

function resolveMountedWallThickness(item) {
    if (!item || !item.map) return null;
    if (!Number.isFinite(item.placementRotation)) return null;
    const anchor = getPlacedObjectAnchorWorldPoint(item) || { x: item.x, y: item.y };
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return null;
    const mapRef = item.map;

    // Primary path: if we know the mounted wall line-group, use that group directly.
    // This avoids orientation/projection misses (notably on near-vertical screen-facing walls).
    if (Number.isInteger(item.mountedWallLineGroupId) && Array.isArray(mapRef.objects)) {
        const groupWalls = mapRef.objects.filter(obj =>
            obj &&
            obj.type === "wall" &&
            Number.isInteger(obj.lineGroupId) &&
            obj.lineGroupId === item.mountedWallLineGroupId &&
            Number.isFinite(obj.thickness)
        );
        if (groupWalls.length > 0) {
            let bestThickness = null;
            let bestDist = Infinity;
            for (let i = 0; i < groupWalls.length; i++) {
                const wall = groupWalls[i];
                const axRaw = Number(wall.a && wall.a.x);
                const ayRaw = Number(wall.a && wall.a.y);
                const bxRaw = Number(wall.b && wall.b.x);
                const byRaw = Number(wall.b && wall.b.y);
                if (!Number.isFinite(axRaw) || !Number.isFinite(ayRaw) || !Number.isFinite(bxRaw) || !Number.isFinite(byRaw)) continue;
                const ax = anchor.x + (typeof mapRef.shortestDeltaX === "function" ? mapRef.shortestDeltaX(anchor.x, axRaw) : (axRaw - anchor.x));
                const ay = anchor.y + (typeof mapRef.shortestDeltaY === "function" ? mapRef.shortestDeltaY(anchor.y, ayRaw) : (ayRaw - anchor.y));
                const bx = anchor.x + (typeof mapRef.shortestDeltaX === "function" ? mapRef.shortestDeltaX(anchor.x, bxRaw) : (bxRaw - anchor.x));
                const by = anchor.y + (typeof mapRef.shortestDeltaY === "function" ? mapRef.shortestDeltaY(anchor.y, byRaw) : (byRaw - anchor.y));
                const vx = bx - ax;
                const vy = by - ay;
                const len2 = vx * vx + vy * vy;
                let dist = Infinity;
                if (len2 > 1e-8) {
                    const t = Math.max(0, Math.min(1, ((anchor.x - ax) * vx + (anchor.y - ay) * vy) / len2));
                    const px = ax + vx * t;
                    const py = ay + vy * t;
                    dist = Math.hypot(anchor.x - px, anchor.y - py);
                } else {
                    dist = Math.hypot(anchor.x - ax, anchor.y - ay);
                }
                if (dist < bestDist) {
                    bestDist = dist;
                    bestThickness = Math.max(0.001, Number(wall.thickness) || 0.001);
                }
            }
            // Accept this persisted group only if it is plausibly near the mounted object.
            // If it's far away, treat as stale and fall back to geometric rematch below.
            const nearEnough = Number.isFinite(bestDist) && bestDist <= 2.0;
            if (Number.isFinite(bestThickness) && nearEnough) return bestThickness;
        }
    }

    const theta = Number(item.placementRotation) * (Math.PI / 180);
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    const walls = Array.isArray(mapRef.objects)
        ? mapRef.objects
        : [];
    let bestThickness = null;
    let bestScore = Infinity;
    let bestWall = null;
    for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        if (!wall || wall.type !== "wall" || !wall.a || !wall.b) continue;
        const ax = Number(wall.a.x);
        const ay = Number(wall.a.y);
        const bx = Number(wall.b.x);
        const by = Number(wall.b.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
        const wax = anchor.x + (typeof mapRef.shortestDeltaX === "function" ? mapRef.shortestDeltaX(anchor.x, ax) : (ax - anchor.x));
        const way = anchor.y + (typeof mapRef.shortestDeltaY === "function" ? mapRef.shortestDeltaY(anchor.y, ay) : (ay - anchor.y));
        const wbx = anchor.x + (typeof mapRef.shortestDeltaX === "function" ? mapRef.shortestDeltaX(anchor.x, bx) : (bx - anchor.x));
        const wby = anchor.y + (typeof mapRef.shortestDeltaY === "function" ? mapRef.shortestDeltaY(anchor.y, by) : (by - anchor.y));
        const sx = wbx - wax;
        const sy = wby - way;
        const len = Math.hypot(sx, sy);
        if (!(len > 1e-6)) continue;
        const sux = sx / len;
        const suy = sy / len;
        const alignment = Math.abs(sux * ux + suy * uy);
        if (alignment < 0.92) continue;
        const apx = anchor.x - wax;
        const apy = anchor.y - way;
        const along = apx * sux + apy * suy;
        if (along < -0.5 || along > len + 0.5) continue;
        const perp = Math.abs(apx * (-suy) + apy * sux);
        const wallThickness = Math.max(0.001, Number(wall.thickness) || 0.001);
        if (perp > Math.max(0.8, wallThickness * 3)) continue;
        const score = perp + (1 - alignment) * 2;
        if (score < bestScore) {
            bestScore = score;
            bestThickness = wallThickness;
            bestWall = wall;
        }
    }
    // Self-heal stale/missing mounted wall group once geometrically matched.
    if (
        bestWall &&
        Number.isInteger(bestWall.lineGroupId) &&
        item.mountedWallLineGroupId !== bestWall.lineGroupId
    ) {
        const previousSection = Number.isInteger(item.mountedWallLineGroupId)
            ? Number(item.mountedWallLineGroupId)
            : null;
        item.mountedWallLineGroupId = bestWall.lineGroupId;
        item.mountedSectionId = bestWall.lineGroupId;
        if (typeof globalThis !== "undefined" && typeof globalThis.markWallSectionDirty === "function") {
            if (Number.isInteger(previousSection)) globalThis.markWallSectionDirty(previousSection);
            globalThis.markWallSectionDirty(bestWall.lineGroupId);
        }
    }
    return Number.isFinite(bestThickness) ? bestThickness : null;
}

function resolvePlaceableMetadataEntry(doc, texturePath) {
    if (!doc || !Array.isArray(doc.items)) return null;
    const normalizedPath = (typeof texturePath === "string") ? texturePath : "";
    const normalizedBasename = normalizeTextureBasename(normalizedPath);
    for (const item of doc.items) {
        if (!item || typeof item !== "object") continue;
        if (typeof item.texturePath === "string" && item.texturePath === normalizedPath) return item;
        if (typeof item.file === "string" && item.file === normalizedBasename) return item;
        if (typeof item.texturePath === "string" && normalizeTextureBasename(item.texturePath) === normalizedBasename) return item;
    }
    return null;
}

async function getResolvedPlaceableMetadata(category, texturePath) {
    const safeCategory = (typeof category === "string" && category.length > 0) ? category : "doors";
    const doc = await fetchPlaceableMetadataForCategory(safeCategory);
    if (!doc) return null;
    const defaults = (doc.defaults && typeof doc.defaults === "object") ? doc.defaults : {};
    const item = resolvePlaceableMetadataEntry(doc, texturePath) || {};
    const merged = { ...defaults, ...item };
    merged.rotationAxis = normalizePlaceableRotationAxis(merged.rotationAxis, safeCategory);
    return merged;
}

class StaticObject {
    constructor(type, location, width, height, textures, map) {
        this.type = type;
        this.map = map;
        this.width = width;
        this.height = height;
        this.blocksTile = true;
        this.groundRadius = 0.5;
        this.visualRadius = Math.max(width, height) / 2;

        const loc = location || {x: 0, y: 0};
        this.x = loc.x;
        this.y = loc.y;
        this.node = this.map && typeof this.map.worldToNode === "function"
            ? this.map.worldToNode(this.x, this.y)
            : null;
        if (this.node) {
            this.node.addObject(this);
        }
        
        // Create Pixi sprite with random texture variant and persist that variant index.
        const textureCount = Array.isArray(textures) ? textures.length : 0;
        this.textureIndex = textureCount > 0 ? Math.floor(Math.random() * textureCount) : -1;
        const texture = this.textureIndex >= 0 ? textures[this.textureIndex] : PIXI.Texture.WHITE;
        this.pixiSprite = new PIXI.Sprite(texture);
        this.pixiSprite.anchor.set(0.5, 1);
        objectLayer.addChild(this.pixiSprite);

        this.visualHitbox = new CircleHitbox(this.x, this.y, this.visualRadius);
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, this.groundRadius);

        
        // Default properties (can be overridden in subclasses)
        this.hp = 100;
        this.isOnFire = false;
        this.burned = false;
    }


    getNode() {
        if (!this.node && this.map && typeof this.map.worldToNode === "function") {
            this.node = this.map.worldToNode(this.x, this.y);
        }
        return this.node;
    }

    moveNode(node) {
        const oldNode = this.getNode();
        if (oldNode) {
            oldNode.removeObject(this);
        }
        this.node = node;
        if (this.node) {
            this.node.addObject(this);
        }
    }

    removeFromNodes() {
        const node = this.getNode();
        if (node) {
            node.removeObject(this);
        }
    }

    removeFromGame() {
        if (this.gone) return;
        this.gone = true;
        this.vanishing = false;
        if (this._vanishFinalizeTimeout) {
            clearTimeout(this._vanishFinalizeTimeout);
            this._vanishFinalizeTimeout = null;
        }
        if (typeof this.removeFromNodes === "function") {
            this.removeFromNodes();
        }
        if (Array.isArray(this.map && this.map.objects)) {
            const idx = this.map.objects.indexOf(this);
            if (idx >= 0) this.map.objects.splice(idx, 1);
        }
        if (this.pixiSprite && this.pixiSprite.parent) {
            this.pixiSprite.parent.removeChild(this.pixiSprite);
        }
        if (this.pixiSprite && typeof this.pixiSprite.destroy === "function") {
            this.pixiSprite.destroy({ children: true, texture: false, baseTexture: false });
        }
        this.pixiSprite = null;
        if (this.fireSprite && this.fireSprite.parent) {
            this.fireSprite.parent.removeChild(this.fireSprite);
        }
        if (this.fireSprite && typeof this.fireSprite.destroy === "function") {
            this.fireSprite.destroy({ children: true, texture: false, baseTexture: false });
        }
        this.fireSprite = null;
        if (typeof globalThis !== "undefined") {
            if (this.type === "tree" && typeof globalThis.unregisterLazyTreeRecordAt === "function") {
                globalThis.unregisterLazyTreeRecordAt(this.x, this.y);
            } else if (this.type === "road" && typeof globalThis.unregisterLazyRoadRecordAt === "function") {
                globalThis.unregisterLazyRoadRecordAt(this.x, this.y);
            }
        }
    }
    remove() {
        this.removeFromGame();
    }
    
    ignite() {
        this.isOnFire = true;
    }
    
    update() {
        // Initialize max HP on first fire ignition
        if (this.isOnFire && !this.maxHP) {
            this.maxHP = this.hp;
        }
        
        // Gradually turn black as item burns (start at 50% HP)
        if (this.maxHP && this.hp !== undefined) {
            const hpThreshold = this.maxHP * 0.5;
            if (this.hp < hpThreshold) {
                // Tint from white (0xffffff) to black (0x000000) as HP goes from 50% to 0%
                const blackProgress = Math.max(0, (hpThreshold - this.hp) / hpThreshold);
                const brightness = Math.floor(255 * (1 - blackProgress * 0.8));
                const tintValue = (brightness << 16) | (brightness << 8) | brightness;
                this.pixiSprite.tint = tintValue;
            }
        }
        
        // Reduce HP while on fire
        if (this.isOnFire && this.hp > 0) {
            this.hp -= 0.5; // Burn damage over time
        }
        
        // Mark as burned when HP reaches 0
        if (this.hp <= 0 && !this.burned) {
            this.burned = true;
        }
        
        // Fade out fire after destruction
        if (this.fireFadeStart !== undefined) {
            const fadeFrames = 120; // ~4 seconds at 30fps
            const timeSinceFade = frameCount - this.fireFadeStart;
            if (timeSinceFade > fadeFrames) {
                this.fireAlphaMult = 0;
            } else {
                this.fireAlphaMult = Math.max(0, 1 - (timeSinceFade / fadeFrames));
            }
        }
    }

    saveJson() {
        return {
            type: this.type,
            x: this.x,
            y: this.y,
            hp: this.hp,
            isOnFire: this.isOnFire,
            textureIndex: this.textureIndex
        };
    }

    static loadJson(data, map) {
        if (!data || !data.type || !map) return null;

        try {
            const node = map.worldToNode(data.x, data.y);

            if (!node) return null;

            let obj;
            let textures = [];

            // Get textures from map if available
            if (map.scenery && map.scenery[data.type] && map.scenery[data.type].textures) {
                textures = map.scenery[data.type].textures;
            }

            // Create appropriate object type
            switch (data.type) {
                case 'tree':
                    obj = new Tree(node, textures, map);
                    break;
                case 'road':
                    obj = new Road(node, textures, map, {
                        fillTexturePath: (typeof data.fillTexturePath === 'string' && data.fillTexturePath.length > 0)
                            ? data.fillTexturePath
                            : undefined
                    });
                    break;
                case 'firewall':
                    if (typeof FirewallEmitter === 'function') {
                        obj = new FirewallEmitter({ x: data.x, y: data.y }, map);
                    } else {
                        obj = new StaticObject(data.type, node, 0.5, 1.0, textures, map);
                    }
                    break;
                case 'placedObject':
                    obj = new PlacedObject(node, map, {
                        texturePath: (typeof data.texturePath === 'string' && data.texturePath.length > 0)
                            ? data.texturePath
                            : null,
                        category: (typeof data.category === 'string' && data.category.length > 0)
                            ? data.category
                            : null,
                        width: Number.isFinite(data.width) ? Number(data.width) : undefined,
                        height: Number.isFinite(data.height) ? Number(data.height) : undefined,
                        renderDepthOffset: Number.isFinite(data.renderDepthOffset) ? Number(data.renderDepthOffset) : 0,
                        rotationAxis: normalizePlaceableRotationAxis(data.rotationAxis, data.category),
                        placementRotation: Number.isFinite(data.placementRotation) ? Number(data.placementRotation) : 0,
                        placeableAnchorX: Number.isFinite(data.placeableAnchorX) ? Number(data.placeableAnchorX) : undefined,
                        placeableAnchorY: Number.isFinite(data.placeableAnchorY) ? Number(data.placeableAnchorY) : undefined,
                        mountedWallLineGroupId: Number.isInteger(data.mountedWallLineGroupId)
                            ? data.mountedWallLineGroupId
                            : (Number.isInteger(data.mountedSectionId) ? data.mountedSectionId : null),
                        mountedSectionId: Number.isInteger(data.mountedSectionId)
                            ? data.mountedSectionId
                            : null,
                        mountedWallFacingSign: Number.isFinite(data.mountedWallFacingSign)
                            ? Number(data.mountedWallFacingSign)
                            : null,
                        groundPlaneHitboxOverridePoints: Array.isArray(data.groundPlaneHitboxOverridePoints)
                            ? data.groundPlaneHitboxOverridePoints
                            : undefined
                    });
                    break;
                case 'wall':
                    return Wall.loadJson(data, map);
                case 'playground':
                    obj = new Playground(node, textures, map);
                    break;
                default:
                    obj = new StaticObject(data.type, node, 4, 4, textures, map);
            }

            if (obj) {
                obj.x = data.x;
                obj.y = data.y;
                if (data.hp !== undefined) obj.hp = data.hp;
                if (data.isOnFire) obj.ignite();

                // Preserve tree sprite variant across save/load.
                if (
                    data.type === 'tree' &&
                    Number.isInteger(data.textureIndex) &&
                    obj.pixiSprite
                ) {
                    if (typeof obj.setTreeTextureIndex === "function") {
                        obj.setTreeTextureIndex(data.textureIndex, textures);
                    } else {
                        const restoredTexture = textures[data.textureIndex] || PIXI.Texture.from(`/assets/images/trees/tree${data.textureIndex}.png`);
                        if (restoredTexture) {
                            obj.pixiSprite.texture = restoredTexture;
                            obj.textureIndex = data.textureIndex;
                        }
                    }
                }

                if (data.type === 'tree' && obj && typeof obj.applySize === 'function') {
                    if (Number.isFinite(data.size)) {
                        obj.applySize(data.size);
                    } else if (Number.isFinite(data.scale)) {
                        // Backward compatibility: legacy scale used 1 -> default 4-unit tree.
                        obj.applySize(data.scale * 4);
                    } else {
                        obj.applySize(4);
                    }
                }
            }

            return obj;
        } catch (e) {
            console.error("Error loading static object:", e);
            return null;
        }
    }
}

class Tree extends StaticObject {
    constructor(location, textures, map) {
        super('tree', location, 4, 4, textures, map);
        this.y += (this.x % 12) * 1 / 2**8; // so they don't flicker
        this.baseWidth = 4;
        this.baseHeight = 4;
        this.baseVisualRadius = 1.75;
        this.baseGroundRadius = 0.5;
        this.size = 4;
        this.height = this.baseHeight;
        this.hp = 100;
        this.maxHP = 100;
        this.visualRadius = this.baseVisualRadius;
        this.visualHitbox = new CircleHitbox(this.x, this.y - this.height, this.visualRadius);
        this.groundRadius = this.baseGroundRadius;
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, this.groundRadius);
        this.texturePath = this.resolveTreeTexturePath();
        this._treeMetadata = null;
        this._treeMetadataFetchToken = 0;
        this.applySize(this.size);
        this.applyTreeMetadataFromServer();
    }

    applySize(nextSize) {
        const clamped = Math.max(0.05, Number(nextSize) || 4);
        this.size = clamped;
        this.width = clamped;
        this.height = clamped;
        const radiusScale = clamped / 4;
        this.visualRadius = this.baseVisualRadius * radiusScale;
        this.groundRadius = this.baseGroundRadius * radiusScale;
        this.refreshStandingTreeHitboxes();
    }

    resolveTreeTexturePath() {
        if (typeof this.texturePath === "string" && this.texturePath.length > 0) {
            return normalizeTexturePathForMetadata(this.texturePath);
        }
        if (Number.isInteger(this.textureIndex) && this.textureIndex >= 0) {
            return `/assets/images/trees/tree${this.textureIndex}.png`;
        }
        const spriteTexture = this.pixiSprite && this.pixiSprite.texture;
        const base = spriteTexture && spriteTexture.baseTexture;
        const resource = base && base.resource;
        const url = resource && typeof resource.url === "string" ? resource.url : "";
        return normalizeTexturePathForMetadata(url);
    }

    setTreeTextureIndex(textureIndex, textures = null) {
        const index = Number.isInteger(textureIndex) ? textureIndex : null;
        if (index === null || index < 0) return;
        const texturePool = Array.isArray(textures) ? textures : null;
        const resolvedTexture = texturePool && texturePool[index]
            ? texturePool[index]
            : PIXI.Texture.from(`/assets/images/trees/tree${index}.png`);
        if (this.pixiSprite && resolvedTexture) {
            this.pixiSprite.texture = resolvedTexture;
        }
        this.textureIndex = index;
        this.texturePath = normalizeTexturePathForMetadata(`/assets/images/trees/tree${index}.png`);
        this.applyTreeMetadataFromServer();
    }

    refreshStandingTreeHitboxes() {
        if (this.fallenHitboxCreated) return;

        if (!this._treeMetadata || typeof this._treeMetadata !== "object") {
            if (this.visualHitbox && this.visualHitbox.type === 'circle') {
                this.visualHitbox.x = this.x;
                this.visualHitbox.y = this.y - this.height;
                this.visualHitbox.radius = this.visualRadius;
            } else {
                this.visualHitbox = new CircleHitbox(this.x, this.y - this.height, this.visualRadius);
            }
            if (this.groundPlaneHitbox && this.groundPlaneHitbox.type === 'circle') {
                this.groundPlaneHitbox.x = this.x;
                this.groundPlaneHitbox.y = this.y;
                this.groundPlaneHitbox.radius = this.groundRadius;
            } else {
                this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, this.groundRadius);
            }
            return;
        }

        const meta = this._treeMetadata;
        const baseWidth = Number.isFinite(meta.hitboxBaseWidth)
            ? Number(meta.hitboxBaseWidth)
            : (Number.isFinite(meta.width) ? Number(meta.width) : this.baseWidth);
        const baseHeight = Number.isFinite(meta.hitboxBaseHeight)
            ? Number(meta.hitboxBaseHeight)
            : (Number.isFinite(meta.height) ? Number(meta.height) : this.baseHeight);
        const defaultGroundRadius = this.groundRadius;
        const defaultVisualRadius = this.visualRadius;
        const groundScaleContext = resolveHitboxScaleContext(meta.groundPlaneHitbox, this, baseWidth, baseHeight);
        const visualScaleContext = resolveHitboxScaleContext(meta.visualHitbox, this, baseWidth, baseHeight);
        this.groundPlaneHitbox = buildHitboxFromSpec(meta.groundPlaneHitbox, this, defaultGroundRadius, groundScaleContext);
        this.visualHitbox = buildHitboxFromSpec(meta.visualHitbox, this, defaultVisualRadius, visualScaleContext);
    }

    applyTreeMetadata(metaEntry) {
        if (!metaEntry || typeof metaEntry !== "object") return;
        this._treeMetadata = metaEntry;
        if (metaEntry.anchor && typeof metaEntry.anchor === "object" && this.pixiSprite && this.pixiSprite.anchor) {
            const ax = Number.isFinite(metaEntry.anchor.x) ? Number(metaEntry.anchor.x) : this.pixiSprite.anchor.x;
            const ay = Number.isFinite(metaEntry.anchor.y) ? Number(metaEntry.anchor.y) : this.pixiSprite.anchor.y;
            this.pixiSprite.anchor.set(ax, ay);
        }
        if (typeof metaEntry.blocksTile === "boolean") this.blocksTile = metaEntry.blocksTile;
        this.refreshStandingTreeHitboxes();
    }

    async applyTreeMetadataFromServer() {
        const texturePath = this.resolveTreeTexturePath();
        if (!texturePath) return;
        this.texturePath = texturePath;
        const token = ++this._treeMetadataFetchToken;
        const merged = await getResolvedPlaceableMetadata("trees", texturePath);
        if (token !== this._treeMetadataFetchToken) return;
        if (!merged) return;
        this.applyTreeMetadata(merged);
    }

    // Backward-compatible alias for older callsites.
    applyScale(nextScale) {
        this.applySize(nextScale);
    }
    
    update() {
        // Handle growth animation if tree is growing
        if (this.isGrowing && this.growthStartFrame !== undefined && this.growthFrames !== undefined) {
            const elapsedFrames = frameCount - this.growthStartFrame;
            const progress = Math.min(elapsedFrames / this.growthFrames, 1);
            
            // Ease-out growth curve for natural feel
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            
            // Set width and height based on growth progress
            this.width = (this.growthFullWidth || 4) * easeProgress;
            this.height = (this.growthFullHeight || 4) * easeProgress;
            
            // Mark growth complete and stop tracking
            if (progress >= 1) {
                this.isGrowing = false;
                this.width = this.growthFullWidth || 4;
                this.height = this.growthFullHeight || 4;
            }
            this.refreshStandingTreeHitboxes();
        }
        
        // Call parent update for burning logic
        super.update();
        
        // Start falling when HP reaches 0
        if (this.hp <= 0 || this.burned) {
            if (!this.falling) {
                this.falling = true;
                this.rotation = 0;
                this.pixiSprite.tint = 0x222222; // Ensure fully black
                // Set random fall direction
                this.fallDirection = Math.random() < 0.5 ? 'left' : 'right';
                this.fallStart = frameCount; // Track when fall started
            }
            
            // Gradually fall over with acceleration that tops out at 1.5°/frame
            const absRotation = Math.abs(this.rotation);
            if (absRotation < 90) {
                // Calculate elapsed frames since fall started
                const framesSinceFall = frameCount - this.fallStart;
                // Accelerating ease-in, but capped at 1.5 degrees per frame
                const accelFactor = Math.min(framesSinceFall / 40, 1); // Reach max by frame 40
                const rotationRate = 1.5 * accelFactor; // Scale from 0 to 1.5 deg/frame
                const sign = this.fallDirection === 'right' ? 1 : -1;
                this.rotation += sign * rotationRate;
                
                // Snap to final rotation
                if (Math.abs(this.rotation) > 90) {
                    this.rotation = this.fallDirection === 'right' ? 90 : -90;
                }
            } else {
                this.rotation = this.fallDirection === 'right' ? 90 : -90;
                
                // Once tree is fully fallen, create diamond-shaped hitbox
                if (!this.fallenHitboxCreated) {
                    // Diamond shape: 4 units wide, 2 units high
                    // Centered 2 units to the side of the base node
                    const offsetX = this.fallDirection === 'right' ? 2 : -2;
                    const centerX = this.x + offsetX;
                    const centerY = this.y;
                    let treepoints;

                    if (this.fallDirection === 'right') {
                        this.visualHitbox = new PolygonHitbox([
                            {x: centerX, y: centerY - 1.5},     
                            {x: centerX + 2, y: centerY - 1.2}, 
                            {x: centerX + 2, y: centerY + 1.2}, 
                            {x: centerX, y: centerY + 1.5},     
                            {x: centerX - 2, y: centerY + 0.5}, 
                            {x: centerX - 2, y: centerY - 0.5}
                        ]);
                        this.groundPlaneHitbox = new PolygonHitbox([
                            {x: centerX, y: centerY - 0.75},     
                            {x: centerX + 1.5, y: centerY - 0.6}, 
                            {x: centerX + 1.5, y: centerY + 1.2}, 
                            {x: centerX, y: centerY + 1.5},     
                            {x: centerX - 2, y: centerY + 0.5}, 
                            {x: centerX - 2, y: centerY - 0.5}
                        ]);
                    } else {
                        this.visualHitbox = new PolygonHitbox([
                            {x: centerX, y: centerY - 1.5},     
                            {x: centerX + 2, y: centerY - 0.5}, 
                            {x: centerX + 2, y: centerY + 0.5}, 
                            {x: centerX, y: centerY + 1.5},     
                            {x: centerX - 2, y: centerY + 1.2}, 
                            {x: centerX - 2, y: centerY - 1.2}
                        ]);
                        this.groundPlaneHitbox = new PolygonHitbox([
                            {x: centerX, y: centerY - 0.75},     
                            {x: centerX + 2, y: centerY - 0.5}, 
                            {x: centerX + 2, y: centerY + 0.5}, 
                            {x: centerX, y: centerY + 1.5},     
                            {x: centerX - 1.5, y: centerY + 1.2}, 
                            {x: centerX - 1.5, y: centerY - 0.6}
                        ]);
                    }
                    this.moveNode(this.map.worldToNode(centerX, centerY));                     
                    this.fallenHitboxCreated = true;

                }
                
                if (this.isOnFire) {
                    // Once tree is fully fallen, start fading fire
                    this.isOnFire = false;
                    this.fireFadeStart = frameCount;
                }
            }
        }
    }

    saveJson() {
        const data = super.saveJson();
        data.size = this.size;
        return data;
    }
}


class Playground extends StaticObject {
    constructor(location, textures, map) {
        super('playground', location, 4, 3, textures, map);
        this.hp = 100;
        this.blocksDiamond = true;
        
        // Set custom anchor for playground
        this.pixiSprite.anchor.set(0.5, 1);
        
        // Block additional tiles in a horizontal diamond pattern for pathfinding
        this.blockDiamondTiles();
    }
    
    blockDiamondTiles() {
        const node = this.getNode();
        if (!node) return;
        const baseX = node.xindex;
        const baseY = node.yindex;

        // Block the 4 tiles in a horizontal diamond pattern
        // Diamond: one above, one up-left, one up-right (current tile already has object)
        const diamondTiles = [];
        diamondTiles.push({x: baseX, y: baseY - 1}); // Up
        
        if (baseX % 2 === 0) {
            // Even column: left and right at same y level
            diamondTiles.push(
                {x: baseX - 1, y: baseY},      // Left
                {x: baseX + 1, y: baseY}       // Right
            );
        } else {
            // Odd column: up-left and up-right are offset up
            diamondTiles.push(
                {x: baseX - 1, y: baseY - 1},  // Up-left
                {x: baseX + 1, y: baseY - 1}   // Up-right
            );
        }
        
        for (let tile of diamondTiles) {
            if (this.map.nodes[tile.x] && this.map.nodes[tile.x][tile.y]) {
                this.map.nodes[tile.x][tile.y].blocked = true;
            }
        }
    }
    
    update() {
        // Call parent update for burning logic
        super.update();
        
        // For playgrounds, destroy when HP reaches 0 (fade out fire instead of falling)
        if (this.hp <= 0 && !this.destroyed) {
            this.destroyed = true;
            this.pixiSprite.tint = 0x222222; // Ensure fully black
            if (this.isOnFire) {
                this.isOnFire = false;
                this.fireFadeStart = frameCount;
            }
        }
    }
}

class PlacedObject extends StaticObject {
    constructor(location, map, options = {}) {
        const texturePath = (typeof options.texturePath === 'string' && options.texturePath.length > 0)
            ? options.texturePath
            : '/assets/images/doors/door5.png';
        const hasExplicitWidth = Number.isFinite(options.width);
        const hasExplicitHeight = Number.isFinite(options.height);
        const hasExplicitRenderDepthOffset = Number.isFinite(options.renderDepthOffset);
        const hasExplicitRotationAxis = typeof options.rotationAxis === "string" && options.rotationAxis.length > 0;
        const hasExplicitPlacementRotation = Number.isFinite(options.placementRotation);
        const width = hasExplicitWidth ? Math.max(0.25, Number(options.width)) : 1.0;
        const height = hasExplicitHeight ? Math.max(0.25, Number(options.height)) : 1.0;
        super('placedObject', location, width, height, [PIXI.Texture.from(texturePath)], map);
        this.texturePath = texturePath;
        this.category = (typeof options.category === 'string' && options.category.length > 0) ? options.category : 'doors';
        this.objectType = "placedObject";
        this.isPlacedObject = true;
        this.type = derivePlaceableType(this.category);
        this.renderDepthOffset = Number.isFinite(options.renderDepthOffset) ? Number(options.renderDepthOffset) : 0;
        this.rotationAxis = normalizePlaceableRotationAxis(options.rotationAxis, this.category);
        this.placementRotation = Number.isFinite(options.placementRotation) ? Number(options.placementRotation) : 0;
        if (this.rotationAxis === "none") {
            this.placementRotation = 0;
        }
        this.mountedWallLineGroupId = Number.isInteger(options.mountedWallLineGroupId)
            ? options.mountedWallLineGroupId
            : (Number.isInteger(options.mountedSectionId) ? Number(options.mountedSectionId) : null);
        this.mountedSectionId = Number.isInteger(this.mountedWallLineGroupId)
            ? Number(this.mountedWallLineGroupId)
            : null;
        this.mountedWallFacingSign = Number.isFinite(options.mountedWallFacingSign)
            ? Number(options.mountedWallFacingSign)
            : null;
        this.rotation = this.placementRotation;
        this.blocksTile = false;
        this.isPassable = true;
        this.groundRadius = Math.max(0.12, width * 0.2);
        this.visualRadius = Math.max(width, height) * 0.5;
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, this.groundRadius);
        this.visualHitbox = new CircleHitbox(this.x, this.y - this.height * 0.25, this.visualRadius);
        this.placeableAnchorX = Number.isFinite(options.placeableAnchorX)
            ? Number(options.placeableAnchorX)
            : 0.5;
        const defaultAnchorY = (this.category && this.category.trim().toLowerCase() === "windows") ? 0.5 : 1;
        this.placeableAnchorY = Number.isFinite(options.placeableAnchorY)
            ? Number(options.placeableAnchorY)
            : defaultAnchorY;
        this.groundPlaneHitboxOverridePoints = Array.isArray(options.groundPlaneHitboxOverridePoints)
            ? options.groundPlaneHitboxOverridePoints
                .map(p => ({ x: Number(p && p.x), y: Number(p && p.y) }))
                .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
            : null;
        if (this.pixiSprite) {
            this.pixiSprite.texture = PIXI.Texture.from(this.texturePath);
            this.pixiSprite.anchor.set(this.placeableAnchorX, this.placeableAnchorY);
        }
        this._placedObjectExplicit = {
            width: hasExplicitWidth,
            height: hasExplicitHeight,
            renderDepthOffset: hasExplicitRenderDepthOffset,
            rotationAxis: hasExplicitRotationAxis,
            placementRotation: hasExplicitPlacementRotation
        };
        this.snapToMountedWall();
        this.applyPlaceableMetadataFromServer();
        if (
            Number.isInteger(this.mountedWallLineGroupId) &&
            typeof globalThis !== "undefined" &&
            typeof globalThis.markWallSectionDirty === "function"
        ) {
            globalThis.markWallSectionDirty(this.mountedWallLineGroupId);
        }
    }

    saveJson() {
        const data = super.saveJson();
        data.type = "placedObject";
        data.texturePath = this.texturePath;
        data.category = this.category;
        data.width = this.width;
        data.height = this.height;
        data.renderDepthOffset = Number.isFinite(this.renderDepthOffset) ? this.renderDepthOffset : 0;
        data.rotationAxis = normalizePlaceableRotationAxis(this.rotationAxis, this.category);
        data.placementRotation = Number.isFinite(this.placementRotation) ? this.placementRotation : 0;
        data.placeableAnchorX = Number.isFinite(this.placeableAnchorX) ? this.placeableAnchorX : 0.5;
        data.placeableAnchorY = Number.isFinite(this.placeableAnchorY) ? this.placeableAnchorY : 1;
        if (Number.isInteger(this.mountedWallLineGroupId)) {
            data.mountedWallLineGroupId = this.mountedWallLineGroupId;
            data.mountedSectionId = this.mountedWallLineGroupId;
        }
        if (Number.isFinite(this.mountedWallFacingSign)) {
            data.mountedWallFacingSign = Number(this.mountedWallFacingSign);
        }
        if (Array.isArray(this.groundPlaneHitboxOverridePoints) && this.groundPlaneHitboxOverridePoints.length >= 3) {
            data.groundPlaneHitboxOverridePoints = this.groundPlaneHitboxOverridePoints.map(p => ({ x: p.x, y: p.y }));
        }
        return data;
    }

    removeFromGame() {
        const mountedSection = Number.isInteger(this.mountedWallLineGroupId)
            ? Number(this.mountedWallLineGroupId)
            : null;
        super.removeFromGame();
        if (
            Number.isInteger(mountedSection) &&
            typeof globalThis !== "undefined" &&
            typeof globalThis.markWallSectionDirty === "function"
        ) {
            globalThis.markWallSectionDirty(mountedSection);
        }
    }

    snapToMountedWall() {
        const category = (typeof this.category === "string") ? this.category.trim().toLowerCase() : "";
        if (category !== "windows" && category !== "doors") return false;
        if (this.rotationAxis !== "spatial") return false;
        if (!this.map) return false;

        const seedX = Number.isFinite(this.x) ? Number(this.x) : 0;
        const seedY = Number.isFinite(this.y) ? Number(this.y) : 0;
        const wallClass = (typeof Wall !== "undefined") ? Wall : null;
        if (!wallClass || typeof wallClass.collectAllWalls !== "function") return false;
        const allWalls = wallClass.collectAllWalls(this.map).filter(w => w && w.a && w.b);
        if (!Array.isArray(allWalls) || allWalls.length === 0) return false;

        let groupId = Number.isInteger(this.mountedWallLineGroupId) ? Number(this.mountedWallLineGroupId) : null;
        let walls = [];
        if (Number.isInteger(groupId) && wallClass._sectionsById instanceof Map) {
            const entry = wallClass._sectionsById.get(groupId);
            if (entry && Array.isArray(entry.walls) && entry.walls.length > 0) {
                walls = entry.walls.filter(w => w && w.a && w.b);
            }
        }
        if (walls.length === 0 && Number.isInteger(groupId)) {
            walls = allWalls.filter(w => Number.isInteger(w.lineGroupId) && Number(w.lineGroupId) === groupId);
        }
        if (walls.length === 0) {
            // Fallback: use nearest wall and adopt its line-group id.
            let nearestWall = null;
            let nearestDist2 = Infinity;
            for (let i = 0; i < allWalls.length; i++) {
                const w = allWalls[i];
                const cp = closestPointOnSegment2D(seedX, seedY, Number(w.a.x), Number(w.a.y), Number(w.b.x), Number(w.b.y));
                if (cp.dist2 < nearestDist2) {
                    nearestDist2 = cp.dist2;
                    nearestWall = w;
                }
            }
            if (!nearestWall) return false;
            groupId = Number.isInteger(nearestWall.lineGroupId) ? Number(nearestWall.lineGroupId) : null;
            this.mountedWallLineGroupId = groupId;
            this.mountedSectionId = groupId;
            walls = Number.isInteger(groupId)
                ? allWalls.filter(w => Number.isInteger(w.lineGroupId) && Number(w.lineGroupId) === groupId)
                : [nearestWall];
        }
        if (walls.length === 0) return false;

        let wall = null;
        let bestDist2 = Infinity;
        const shortestDX = (fromX, toX) =>
            (this.map && typeof this.map.shortestDeltaX === "function")
                ? this.map.shortestDeltaX(fromX, toX)
                : (toX - fromX);
        const shortestDY = (fromY, toY) =>
            (this.map && typeof this.map.shortestDeltaY === "function")
                ? this.map.shortestDeltaY(fromY, toY)
                : (toY - fromY);
        for (let i = 0; i < walls.length; i++) {
            const w = walls[i];
            const ax = seedX + shortestDX(seedX, Number(w.a.x));
            const ay = seedY + shortestDY(seedY, Number(w.a.y));
            const bx = seedX + shortestDX(seedX, Number(w.b.x));
            const by = seedY + shortestDY(seedY, Number(w.b.y));
            const cp = closestPointOnSegment2D(seedX, seedY, ax, ay, bx, by);
            if (cp.dist2 < bestDist2) {
                bestDist2 = cp.dist2;
                wall = w;
            }
        }
        if (!wall) return false;

        const axRaw = Number(wall && wall.a && wall.a.x);
        const ayRaw = Number(wall && wall.a && wall.a.y);
        const bxRaw = Number(wall && wall.b && wall.b.x);
        const byRaw = Number(wall && wall.b && wall.b.y);
        if (!Number.isFinite(axRaw) || !Number.isFinite(ayRaw) || !Number.isFinite(bxRaw) || !Number.isFinite(byRaw)) return false;
        const ax = seedX + shortestDX(seedX, axRaw);
        const ay = seedY + shortestDY(seedY, ayRaw);
        const bx = seedX + shortestDX(seedX, bxRaw);
        const by = seedY + shortestDY(seedY, byRaw);
        const sx = bx - ax;
        const sy = by - ay;
        const sLen = Math.hypot(sx, sy);
        if (!(sLen > 1e-6)) return false;
        const tx = sx / sLen;
        const ty = sy / sLen;
        const closestOnCenter = closestPointOnSegment2D(seedX, seedY, ax, ay, bx, by);
        const rotDeg = Math.atan2(ty, tx) * (180 / Math.PI);
        this.placementRotation = rotDeg;
        this.rotation = rotDeg;

        const width = Math.max(0.01, Number.isFinite(this.width) ? Number(this.width) : 1);
        const height = Math.max(0.01, Number.isFinite(this.height) ? Number(this.height) : 1);
        const anchorX = Number.isFinite(this.placeableAnchorX) ? Number(this.placeableAnchorX) : 0.5;
        const anchorY = Number.isFinite(this.placeableAnchorY) ? Number(this.placeableAnchorY) : 1;
        const alongOffset = (anchorX - 0.5) * width;
        const wallHeight = Math.max(0, Number(wall && wall.height) || 0);
        const desiredBaseX = closestOnCenter.x;
        const desiredBaseY = (category === "doors")
            ? closestOnCenter.y
            : (closestOnCenter.y - Math.max(0, (wallHeight - height) * 0.5));
        let snappedX = desiredBaseX + tx * alongOffset;
        let snappedY = desiredBaseY + ty * alongOffset - ((1 - anchorY) * height);
        if (this.map && typeof this.map.wrapWorldX === "function") snappedX = this.map.wrapWorldX(snappedX);
        if (this.map && typeof this.map.wrapWorldY === "function") snappedY = this.map.wrapWorldY(snappedY);
        this.x = snappedX;
        this.y = snappedY;
        return true;
    }

    applyPlaceableMetadata(metaEntry) {
        if (!metaEntry || typeof metaEntry !== 'object') return;
        const explicit = this._placedObjectExplicit || {};
        this.type = derivePlaceableType(this.category);
        if (!explicit.width && Number.isFinite(metaEntry.width)) {
            this.width = Math.max(0.25, Number(metaEntry.width));
        }
        if (!explicit.height && Number.isFinite(metaEntry.height)) {
            this.height = Math.max(0.25, Number(metaEntry.height));
        }
        if (!explicit.renderDepthOffset && Number.isFinite(metaEntry.renderDepthOffset)) {
            this.renderDepthOffset = Number(metaEntry.renderDepthOffset);
        }
        if (!explicit.rotationAxis) {
            this.rotationAxis = normalizePlaceableRotationAxis(metaEntry.rotationAxis, this.category);
        }
        if (!explicit.placementRotation && Number.isFinite(metaEntry.placementRotation)) {
            this.placementRotation = Number(metaEntry.placementRotation);
            this.rotation = this.placementRotation;
        }
        if (this.rotationAxis === "none") {
            this.placementRotation = 0;
            this.rotation = 0;
        }
        if (typeof metaEntry.blocksTile === 'boolean') this.blocksTile = metaEntry.blocksTile;
        if (typeof metaEntry.isPassable === 'boolean') this.isPassable = metaEntry.isPassable;
        this.lodTextures = normalizeLodTextures(metaEntry.lodTextures, this.texturePath);
        const currentAnchor = resolvePlacedObjectAnchor(this);
        if (metaEntry.anchor && typeof metaEntry.anchor === 'object') {
            this.placeableAnchorX = Number.isFinite(metaEntry.anchor.x) ? Number(metaEntry.anchor.x) : currentAnchor.x;
            this.placeableAnchorY = Number.isFinite(metaEntry.anchor.y) ? Number(metaEntry.anchor.y) : currentAnchor.y;
        } else {
            this.placeableAnchorX = currentAnchor.x;
            this.placeableAnchorY = currentAnchor.y;
        }
        if (this.pixiSprite && this.pixiSprite.anchor) {
            this.pixiSprite.anchor.set(this.placeableAnchorX, this.placeableAnchorY);
        }

        const defaultGroundRadius = Math.max(0.12, this.width * 0.2);
        const defaultVisualRadius = Math.max(this.width, this.height) * 0.5;
        const baseWidth = Number.isFinite(metaEntry.hitboxBaseWidth)
            ? Number(metaEntry.hitboxBaseWidth)
            : (Number.isFinite(metaEntry.width) ? Number(metaEntry.width) : 1);
        const baseHeight = Number.isFinite(metaEntry.hitboxBaseHeight)
            ? Number(metaEntry.hitboxBaseHeight)
            : (Number.isFinite(metaEntry.height) ? Number(metaEntry.height) : 1);
        const groundScaleContext = resolveHitboxScaleContext(metaEntry.groundPlaneHitbox, this, baseWidth, baseHeight);
        const visualScaleContext = resolveHitboxScaleContext(metaEntry.visualHitbox, this, baseWidth, baseHeight);
        this.groundPlaneHitbox = buildHitboxFromSpec(metaEntry.groundPlaneHitbox, this, defaultGroundRadius, groundScaleContext);
        this.visualHitbox = buildHitboxFromSpec(metaEntry.visualHitbox, this, defaultVisualRadius, visualScaleContext);
        if (this.rotationAxis === "spatial" && Number.isFinite(this.placementRotation)) {
            const pivot = getPlacedObjectAnchorWorldPoint(this) || { x: this.x, y: this.y };
            this.groundPlaneHitbox = rotateHitboxAroundOrigin(this.groundPlaneHitbox, pivot.x, pivot.y, this.placementRotation);
            this.visualHitbox = rotateHitboxAroundOrigin(this.visualHitbox, pivot.x, pivot.y, this.placementRotation);
        }
        if (Array.isArray(this.groundPlaneHitboxOverridePoints) && this.groundPlaneHitboxOverridePoints.length >= 3) {
            this.groundPlaneHitbox = new PolygonHitbox(
                this.groundPlaneHitboxOverridePoints.map(p => ({ x: p.x, y: p.y }))
            );
        } else {
            const category = (typeof this.category === "string") ? this.category.trim().toLowerCase() : "";
            if (
                this.rotationAxis === "spatial" &&
                (category === "windows" || category === "doors")
            ) {
                const mountedWallThickness = resolveMountedWallThickness(this);
                const thicknessMultiplier = (category === "windows") ? 1.1 : 1.15;
                const fallbackWallHitbox = buildWallMountedRectGroundHitbox(this, {
                    wallThickness: mountedWallThickness,
                    thicknessMultiplier
                });
                if (fallbackWallHitbox) {
                    this.groundPlaneHitbox = fallbackWallHitbox;
                }
            }
        }
        this.snapToMountedWall();
    }

    async applyPlaceableMetadataFromServer() {
        const category = (typeof this.category === 'string' && this.category.length > 0) ? this.category : 'doors';
        const merged = await getResolvedPlaceableMetadata(category, this.texturePath);
        if (!merged) return;
        this.applyPlaceableMetadata(merged);
    }
}

if (typeof globalThis !== "undefined") {
    globalThis.getResolvedPlaceableMetadata = getResolvedPlaceableMetadata;
    globalThis.normalizePlaceableRotationAxis = normalizePlaceableRotationAxis;
}

class Wall {
    static _stoneWallTexture = null;
    static _nextLineGroupId = 1;
    static _sectionHeightEpsilon = 1e-4;
    static _sectionsById = new Map();
    static _suspendGlobalRebuild = false;

    static setBulkRebuildSuspended(nextValue) {
        Wall._suspendGlobalRebuild = !!nextValue;
    }

    constructor(endpointA, endpointB, height, thickness, map, direction) {
        this.type = 'wall';
        this.map = map;
        
        if (endpointB instanceof MapNode && !(endpointA instanceof MapNode)) {
            this.a = endpointB;
            this.b = endpointA;
            this.isDiagonal = true;
        } else if (endpointA instanceof MapNode && !(endpointB instanceof MapNode)) {
            this.a = endpointA;
            this.b = endpointB;
            this.isDiagonal = true;
        } else {
            this.a = endpointA;
            this.b = endpointB;
            this.isDiagonal = false;
        }
        // Position is at the center between endpoints
        this.x = (this.a.x + this.b.x) / 2;
        this.y = (this.a.y + this.b.y) / 2;
        
        this.height = height;
        this.thickness = thickness;
        this.direction = Number.isFinite(direction)
            ? direction
            : (this.map && typeof this.map.getHexDirection === "function"
                ? this.map.getHexDirection(this.a.x - this.b.x, this.a.y - this.b.y)
                : 0);
        this.lineAxis = Wall.normalizeDirectionAxis(this.direction);
        this.lineGroupId = null;
        this.sectionId = null;
        this.texturePhaseA = 0;
        this.texturePhaseB = 1 / 3; // three map units per horizontal texture repeat
        this.joinCorners = null;
        this.blocksTile = false;
        this.pixiSprite = new PIXI.Graphics();
        this.skipTransform = true;
        this.rebuildHitboxesFromJoinState();

        // Arrays to track what this wall affects
        this.nodes = [];           // All nodes this wall sits on
        this.blockedLinks = [];    // All node connections this wall blocks
        
        for (let direction = 0; direction < 12; direction++) {
            this.addBlockedLink(this.a.neighbors[direction], (direction + 6) % 12);
            if (this.b instanceof MapNode) {
                this.addBlockedLink(this.b.neighbors[direction], (direction + 6) % 12);
            }
        }
        
        if (this.isDiagonal) {
            const d1 = (9 + direction) % 12;  // neighbor 9+dir
            const d2 = (1 + direction) % 12;  // neighbor 1+dir
            const d3 = (11 + direction) % 12; // neighbor 11+dir
            const d4 = (3 + direction) % 12;  // neighbor 3+dir
            
            // Block the three cross-diagonal connections
            this.blockCrossConnection(this.a, d1, d2);  // 9+dir ↔ 5+dir
            this.blockCrossConnection(this.a, d3, d4);  // 7+dir ↔ 3+dir
            this.blockCrossConnection(this.a, d2, d3);  // 5+dir ↔ 7+dir
        } else {
            // block one diagonal connection across the wall
            const crossNodeA = this.a.neighbors[(direction + 2) % 12];
            const crossNodeB = this.a.neighbors[(direction + 10) % 12];
            this.addBlockedLink(crossNodeA, (direction + 9) % 12);
            this.addBlockedLink(crossNodeB, (direction + 3) % 12);
        }

        this.findNodesAlongWall(endpointA, endpointB);
        this.addToNodes();
        this.updateConnectedWallJoins();
        if (!Wall._suspendGlobalRebuild) {
            const touchedBefore = Wall.collectSectionIdsFromWalls(this.collectPotentialJoinWalls());
            Wall.recomputeLineGroups(this.map);
            Wall.repairMountedSectionLinks(this.map);
            Wall.markDirtyForTouchedSections([this], touchedBefore);
        }

        objectLayer.addChild(this.pixiSprite);
    }

    static normalizeDirectionAxis(direction) {
        const d = Number(direction) || 0;
        return ((d % 6) + 6) % 6;
    }

    getLineAxis() {
        return Wall.normalizeDirectionAxis(this.direction);
    }

    sharesLineEndpointAndAxis(otherWall) {
        if (!otherWall || otherWall.type !== 'wall') return false;
        if (this.getLineAxis() !== otherWall.getLineAxis()) return false;
        return (
            Wall.pointsMatch(this.a, otherWall.a) ||
            Wall.pointsMatch(this.a, otherWall.b) ||
            Wall.pointsMatch(this.b, otherWall.a) ||
            Wall.pointsMatch(this.b, otherWall.b)
        );
    }

    static heightsMatch(a, b, epsilon = Wall._sectionHeightEpsilon) {
        const ah = Number(a && a.height);
        const bh = Number(b && b.height);
        if (!Number.isFinite(ah) || !Number.isFinite(bh)) return false;
        const eps = Number.isFinite(epsilon) ? Math.max(0, Number(epsilon)) : Wall._sectionHeightEpsilon;
        return Math.abs(ah - bh) <= eps;
    }

    collectConnectedSectionNeighbors() {
        return this.collectPotentialJoinWalls().filter(wall =>
            this.sharesLineEndpointAndAxis(wall) &&
            Wall.heightsMatch(this, wall)
        );
    }

    static rebuildSectionRegistryFromWalls(walls) {
        const registry = new Map();
        if (Array.isArray(walls)) {
            walls.forEach(wall => {
                const id = Number.isInteger(wall && wall.sectionId) ? Number(wall.sectionId) : null;
                if (!Number.isInteger(id)) return;
                if (!registry.has(id)) {
                    registry.set(id, {
                        id,
                        axis: Number.isFinite(wall && wall.lineAxis) ? Number(wall.lineAxis) : Wall.normalizeDirectionAxis(wall && wall.direction),
                        height: Number(wall && wall.height),
                        walls: []
                    });
                }
                const section = registry.get(id);
                section.walls.push(wall);
            });
        }
        Wall._sectionsById = registry;
        return registry;
    }

    static collectSectionIdsFromWalls(walls) {
        const ids = new Set();
        if (!Array.isArray(walls)) return ids;
        walls.forEach(wall => {
            if (!wall) return;
            const id = Number.isInteger(wall.sectionId)
                ? Number(wall.sectionId)
                : (Number.isInteger(wall.lineGroupId) ? Number(wall.lineGroupId) : null);
            if (Number.isInteger(id)) ids.add(id);
        });
        return ids;
    }

    static collectTouchingWalls(seedWalls) {
        const out = new Set();
        const queue = Array.isArray(seedWalls) ? seedWalls.slice() : [];
        while (queue.length > 0) {
            const wall = queue.shift();
            if (!wall || out.has(wall)) continue;
            out.add(wall);
            if (typeof wall.collectPotentialJoinWalls !== "function") continue;
            const neighbors = wall.collectPotentialJoinWalls();
            if (!Array.isArray(neighbors)) continue;
            neighbors.forEach(neighbor => {
                if (!neighbor || out.has(neighbor)) return;
                queue.push(neighbor);
            });
        }
        return Array.from(out);
    }

    static markDirtySectionIds(sectionIds) {
        const ids = Array.from(sectionIds || []).filter(id => Number.isInteger(id));
        if (ids.length === 0) {
            if (typeof globalThis !== "undefined" && typeof globalThis.markAllWallSectionsDirty === "function") {
                globalThis.markAllWallSectionsDirty();
            }
            return;
        }
        if (typeof globalThis !== "undefined" && typeof globalThis.markWallSectionDirty === "function") {
            ids.forEach(id => globalThis.markWallSectionDirty(id));
            return;
        }
        if (typeof globalThis !== "undefined" && typeof globalThis.markAllWallSectionsDirty === "function") {
            globalThis.markAllWallSectionsDirty();
        }
    }

    static markDirtyForTouchedSections(seedWalls, previousSectionIds = null) {
        const touchedWalls = Wall.collectTouchingWalls(seedWalls);
        const ids = Wall.collectSectionIdsFromWalls(touchedWalls);
        if (previousSectionIds && typeof previousSectionIds.forEach === "function") {
            previousSectionIds.forEach(id => {
                if (Number.isInteger(id)) ids.add(id);
            });
        }
        Wall.markDirtySectionIds(ids);
    }

    static collectAllWalls(map) {
        if (!map || !map.nodes) return [];
        const walls = new Set();
        Object.keys(map.nodes).forEach(xKey => {
            const col = map.nodes[xKey];
            if (!col) return;
            Object.keys(col).forEach(yKey => {
                const node = col[yKey];
                if (!node || !Array.isArray(node.objects)) return;
                node.objects.forEach(obj => {
                    if (obj && obj.type === 'wall') {
                        walls.add(obj);
                    }
                });
            });
        });
        return Array.from(walls);
    }

    static recomputeLineGroups(map) {
        const walls = Wall.collectAllWalls(map);
        const usedIds = new Set();
        walls.forEach(wall => {
            wall.lineAxis = wall.getLineAxis();
            wall._prevLineGroupId = Number.isInteger(wall.lineGroupId) ? wall.lineGroupId : null;
            wall.lineGroupId = null;
            wall.sectionId = null;
        });

        const existingMaxId = walls.reduce((maxSoFar, wall) => {
            const id = Number.isInteger(wall && wall._prevLineGroupId) ? Number(wall._prevLineGroupId) : 0;
            return Math.max(maxSoFar, id);
        }, 0);
        let nextGeneratedId = Math.max(1, existingMaxId + 1);
        walls.forEach(seed => {
            if (!seed || Number.isInteger(seed.lineGroupId)) return;
            const queue = [seed];
            const componentWalls = [];
            seed.lineGroupId = -1;

            while (queue.length > 0) {
                const wall = queue.shift();
                if (!wall) continue;
                 componentWalls.push(wall);
                const neighbors = wall.collectConnectedSectionNeighbors();
                neighbors.forEach(neighbor => {
                    if (!neighbor || Number.isInteger(neighbor.lineGroupId)) return;
                    neighbor.lineGroupId = -1;
                    queue.push(neighbor);
                });
            }

            const priorIdCounts = new Map();
            componentWalls.forEach(wall => {
                const priorId = Number.isInteger(wall && wall._prevLineGroupId) ? Number(wall._prevLineGroupId) : null;
                if (!Number.isInteger(priorId)) return;
                priorIdCounts.set(priorId, (priorIdCounts.get(priorId) || 0) + 1);
            });
            let chosenId = null;
            const sortedPriorIds = Array.from(priorIdCounts.entries())
                .sort((a, b) => {
                    if (b[1] !== a[1]) return b[1] - a[1];
                    return a[0] - b[0];
                })
                .map(entry => entry[0]);
            for (let i = 0; i < sortedPriorIds.length; i++) {
                const candidate = sortedPriorIds[i];
                if (usedIds.has(candidate)) continue;
                chosenId = candidate;
                break;
            }
            if (!Number.isInteger(chosenId)) {
                while (usedIds.has(nextGeneratedId)) nextGeneratedId += 1;
                chosenId = nextGeneratedId;
                nextGeneratedId += 1;
            }
            usedIds.add(chosenId);
            componentWalls.forEach(wall => {
                wall.lineGroupId = chosenId;
                wall.sectionId = chosenId;
                wall._prevLineGroupId = null;
            });
        });

        Wall.rebuildSectionRegistryFromWalls(walls);
        Wall._nextLineGroupId = Math.max(nextGeneratedId, (usedIds.size > 0 ? (Math.max(...Array.from(usedIds)) + 1) : 1));
    }

    static reconcilePersistedSectionIds(map) {
        const walls = Wall.collectAllWalls(map);
        if (!walls || walls.length === 0) return;

        const hasPersisted = walls.some(wall => Number.isInteger(wall && wall._persistedSectionId));
        if (!hasPersisted) return;

        const groups = new Map();
        walls.forEach(wall => {
            const groupId = Number.isInteger(wall && wall.lineGroupId) ? Number(wall.lineGroupId) : null;
            if (!Number.isInteger(groupId)) return;
            if (!groups.has(groupId)) groups.set(groupId, []);
            groups.get(groupId).push(wall);
        });

        const usedSectionIds = new Set();
        const remapped = new Set();
        groups.forEach((groupWalls) => {
            if (!Array.isArray(groupWalls) || groupWalls.length === 0) return;
            const counts = new Map();
            groupWalls.forEach(wall => {
                const persisted = Number.isInteger(wall && wall._persistedSectionId) ? Number(wall._persistedSectionId) : null;
                if (!Number.isInteger(persisted)) return;
                counts.set(persisted, (counts.get(persisted) || 0) + 1);
            });
            if (counts.size === 0) return;
            const preferred = Array.from(counts.entries())
                .sort((a, b) => {
                    if (b[1] !== a[1]) return b[1] - a[1];
                    return a[0] - b[0];
                })
                .map(entry => entry[0]);
            let chosen = null;
            for (let i = 0; i < preferred.length; i++) {
                if (usedSectionIds.has(preferred[i])) continue;
                chosen = preferred[i];
                break;
            }
            if (!Number.isInteger(chosen)) return;
            usedSectionIds.add(chosen);
            groupWalls.forEach(wall => {
                wall.lineGroupId = chosen;
                wall.sectionId = chosen;
            });
            remapped.add(chosen);
        });

        // Any group that did not map to a persisted id keeps current id, but ensure uniqueness.
        let nextId = Math.max(1, walls.reduce((m, wall) => {
            const id = Number.isInteger(wall && wall.lineGroupId) ? Number(wall.lineGroupId) : 0;
            return Math.max(m, id);
        }, 0) + 1);
        groups.forEach((groupWalls) => {
            if (!Array.isArray(groupWalls) || groupWalls.length === 0) return;
            const first = groupWalls[0];
            const id = Number.isInteger(first && first.lineGroupId) ? Number(first.lineGroupId) : null;
            if (Number.isInteger(id) && !usedSectionIds.has(id)) {
                usedSectionIds.add(id);
                groupWalls.forEach(wall => {
                    wall.lineGroupId = id;
                    wall.sectionId = id;
                });
                return;
            }
            while (usedSectionIds.has(nextId)) nextId += 1;
            const assigned = nextId;
            usedSectionIds.add(assigned);
            nextId += 1;
            groupWalls.forEach(wall => {
                wall.lineGroupId = assigned;
                wall.sectionId = assigned;
            });
        });

        walls.forEach(wall => {
            wall._persistedSectionId = null;
        });
        Wall.rebuildSectionRegistryFromWalls(walls);
        Wall._nextLineGroupId = Math.max(1, (usedSectionIds.size > 0 ? (Math.max(...Array.from(usedSectionIds)) + 1) : 1));
    }

    static repairMountedSectionLinks(map) {
        if (!map || !Array.isArray(map.objects)) return;
        const isWallMounted = (obj) => {
            if (!obj) return false;
            const category = (typeof obj.category === "string") ? obj.category.trim().toLowerCase() : "";
            const type = (typeof obj.type === "string") ? obj.type.trim().toLowerCase() : "";
            return category === "windows" || category === "doors" || type === "window" || type === "door";
        };
        for (let i = 0; i < map.objects.length; i++) {
            const obj = map.objects[i];
            if (!isWallMounted(obj)) continue;
            if (!Number.isFinite(obj && obj.placementRotation)) continue;
            // This resolver self-heals stale line-group ids when it finds a better geometric match.
            resolveMountedWallThickness(obj);
            if (typeof obj.snapToMountedWall === "function") {
                obj.snapToMountedWall();
            }
        }
    }

    static pointsMatch(p1, p2, eps = 1e-6) {
        if (!p1 || !p2) return false;
        if (!Number.isFinite(p1.x) || !Number.isFinite(p1.y) || !Number.isFinite(p2.x) || !Number.isFinite(p2.y)) return false;
        return Math.abs(p1.x - p2.x) <= eps && Math.abs(p1.y - p2.y) <= eps;
    }

    static lineIntersection(p, r, q, s) {
        const cross = r.x * s.y - r.y * s.x;
        if (Math.abs(cross) < 1e-7) return null;
        const qpx = q.x - p.x;
        const qpy = q.y - p.y;
        const t = (qpx * s.y - qpy * s.x) / cross;
        return {
            x: p.x + r.x * t,
            y: p.y + r.y * t
        };
    }

    static distancePointToLine(point, linePoint, lineDir) {
        if (!point || !linePoint || !lineDir) return Infinity;
        const vx = point.x - linePoint.x;
        const vy = point.y - linePoint.y;
        const cross = Math.abs(vx * lineDir.y - vy * lineDir.x);
        const dirLen = Math.hypot(lineDir.x, lineDir.y);
        if (dirLen < 1e-7) return Infinity;
        return cross / dirLen;
    }

    static hasFinitePoint(point) {
        return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
    }

    getTexturePhaseAtEndpoint(endpoint) {
        if (!endpoint) return null;
        if (Wall.pointsMatch(endpoint, this.a)) return this.texturePhaseA;
        if (Wall.pointsMatch(endpoint, this.b)) return this.texturePhaseB;
        return null;
    }

    setTexturePhaseForOrderedEndpoints(fromEndpoint, toEndpoint, phaseFrom, phaseTo) {
        if (Wall.pointsMatch(fromEndpoint, this.a) && Wall.pointsMatch(toEndpoint, this.b)) {
            this.texturePhaseA = phaseFrom;
            this.texturePhaseB = phaseTo;
            return true;
        }
        if (Wall.pointsMatch(fromEndpoint, this.b) && Wall.pointsMatch(toEndpoint, this.a)) {
            this.texturePhaseA = phaseTo;
            this.texturePhaseB = phaseFrom;
            return true;
        }
        return false;
    }

    static getStoneWallTexture() {
        if (!Wall._stoneWallTexture) {
            Wall._stoneWallTexture = PIXI.Texture.from('/assets/images/walls/stonewall.png');
            if (Wall._stoneWallTexture && Wall._stoneWallTexture.baseTexture) {
                Wall._stoneWallTexture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
                Wall._stoneWallTexture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
            }
        }
        return Wall._stoneWallTexture;
    }

    getWallProfile() {
        const ax = Number(this.a && this.a.x);
        const ay = Number(this.a && this.a.y);
        const bx = Number(this.b && this.b.x);
        const by = Number(this.b && this.b.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;

        const wallThickness = Math.max(0.001, Number(this.thickness) || 0.001);
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return null;

        const nx = -dy / len;
        const ny = dx / len;
        const halfThickness = wallThickness / 2;
        const defaultALeft = { x: ax + nx * halfThickness, y: ay + ny * halfThickness };
        const defaultARight = { x: ax - nx * halfThickness, y: ay - ny * halfThickness };
        const defaultBLeft = { x: bx + nx * halfThickness, y: by + ny * halfThickness };
        const defaultBRight = { x: bx - nx * halfThickness, y: by - ny * halfThickness };

        const aLeft = this.joinCorners && this.joinCorners.aLeft ? this.joinCorners.aLeft : defaultALeft;
        const aRight = this.joinCorners && this.joinCorners.aRight ? this.joinCorners.aRight : defaultARight;
        const bLeft = this.joinCorners && this.joinCorners.bLeft ? this.joinCorners.bLeft : defaultBLeft;
        const bRight = this.joinCorners && this.joinCorners.bRight ? this.joinCorners.bRight : defaultBRight;

        return { aLeft, aRight, bLeft, bRight };
    }

    generateLosOcclusionSpan(wizardRef, options = {}) {
        if (!wizardRef || !Number.isFinite(wizardRef.x) || !Number.isFinite(wizardRef.y)) return [];
        const hitbox = this.groundPlaneHitbox;
        if (!(hitbox instanceof PolygonHitbox) || !Array.isArray(hitbox.points) || hitbox.points.length < 2) {
            return [];
        }

        const bins = Number.isFinite(options.bins) ? Math.max(1, Math.floor(options.bins)) : 0;
        const angleForBin = (typeof options.angleForBin === "function") ? options.angleForBin : null;
        const forEachBinInShortSpan = (typeof options.forEachBinInShortSpan === "function") ? options.forEachBinInShortSpan : null;
        const raySegmentDistance = (typeof options.raySegmentDistance === "function") ? options.raySegmentDistance : null;
        if (!bins || !angleForBin || !forEachBinInShortSpan || !raySegmentDistance) return [];

        const shortestDX = (typeof options.shortestDeltaX === "function")
            ? options.shortestDeltaX
            : ((fromX, toX) => {
                const mapRef = wizardRef.map || this.map || null;
                if (mapRef && typeof mapRef.shortestDeltaX === "function") {
                    return mapRef.shortestDeltaX(fromX, toX);
                }
                return toX - fromX;
            });
        const shortestDY = (typeof options.shortestDeltaY === "function")
            ? options.shortestDeltaY
            : ((fromY, toY) => {
                const mapRef = wizardRef.map || this.map || null;
                if (mapRef && typeof mapRef.shortestDeltaY === "function") {
                    return mapRef.shortestDeltaY(fromY, toY);
                }
                return toY - fromY;
            });

        const wx = wizardRef.x;
        const wy = wizardRef.y;
        const localPoints = hitbox.points
            .map(p => ({
                x: wx + shortestDX(wx, p.x),
                y: wy + shortestDY(wy, p.y)
            }))
            .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (localPoints.length < 2) return [];

        const bestByBin = new Float32Array(bins);
        const touched = new Uint8Array(bins);
        for (let i = 0; i < bins; i++) bestByBin[i] = Infinity;

        for (let i = 0; i < localPoints.length; i++) {
            const p1 = localPoints[i];
            const p2 = localPoints[(i + 1) % localPoints.length];
            if (!p1 || !p2) continue;
            const a0 = Math.atan2(p1.y - wy, p1.x - wx);
            const a1 = Math.atan2(p2.y - wy, p2.x - wx);
            forEachBinInShortSpan(a0, a1, bins, b => {
                const theta = angleForBin(b);
                const dirX = Math.cos(theta);
                const dirY = Math.sin(theta);
                const t = raySegmentDistance(wx, wy, dirX, dirY, p1.x, p1.y, p2.x, p2.y);
                if (!Number.isFinite(t) || t < 0) return;
                if (t < bestByBin[b]) {
                    bestByBin[b] = t;
                    touched[b] = 1;
                }
            });
        }

        const hits = [];
        for (let i = 0; i < bins; i++) {
            if (!touched[i] || !Number.isFinite(bestByBin[i])) continue;
            hits.push({ binIdx: i, hitDist: bestByBin[i] });
        }
        return hits;
    }

    getEndpointLineData(endpointKey) {
        const endpoint = endpointKey === 'a' ? this.a : this.b;
        const other = endpointKey === 'a' ? this.b : this.a;
        if (!endpoint || !other) return null;
        const ex = Number(endpoint.x);
        const ey = Number(endpoint.y);
        const ox = Number(other.x);
        const oy = Number(other.y);
        if (!Number.isFinite(ex) || !Number.isFinite(ey) || !Number.isFinite(ox) || !Number.isFinite(oy)) return null;

        const tx = ox - ex;
        const ty = oy - ey;
        const tLen = Math.hypot(tx, ty);
        if (tLen < 1e-7) return null;
        const dir = { x: tx / tLen, y: ty / tLen };
        const normal = { x: -dir.y, y: dir.x };
        const half = Math.max(0.001, Number(this.thickness) || 0.001) / 2;
        const plusPoint = { x: ex + normal.x * half, y: ey + normal.y * half };
        const minusPoint = { x: ex - normal.x * half, y: ey - normal.y * half };
        const leftPoint = endpointKey === 'a' ? plusPoint : minusPoint;
        const rightPoint = endpointKey === 'a' ? minusPoint : plusPoint;

        return {
            endpoint: { x: ex, y: ey },
            dir,
            segmentLength: tLen,
            leftPoint,
            rightPoint
        };
    }

    computeJoinedEndpointCorners(endpointKey) {
        const lineData = this.getEndpointLineData(endpointKey);
        if (!lineData) return null;
        const endpoint = lineData.endpoint;
        const otherEndpoint = endpointKey === 'a' ? this.b : this.a;
        const ox = Number(otherEndpoint && otherEndpoint.x);
        const oy = Number(otherEndpoint && otherEndpoint.y);
        const candidates = this.collectPotentialJoinWalls().filter(wall => this.sharesEndpointWith(wall, endpoint));
        if (!candidates.length) return null;

        const defaultLeft = lineData.leftPoint;
        const defaultRight = lineData.rightPoint;
        const wallThickness = Math.max(0.001, Number(this.thickness) || 0.001);
        const maxMiterDistance = Math.max(wallThickness * 24, lineData.segmentLength * 2);
        const maxAlong = Math.max(
            wallThickness * 24,
            lineData.segmentLength + wallThickness * 2
        );

        const isEndpointLocalPoint = point => {
            if (!point) return false;
            const along = (point.x - endpoint.x) * lineData.dir.x + (point.y - endpoint.y) * lineData.dir.y;
            if (along < -wallThickness * 2 || along > maxAlong) return false;
            if (!Number.isFinite(ox) || !Number.isFinite(oy)) return true;
            const distToEndpoint = Math.hypot(point.x - endpoint.x, point.y - endpoint.y);
            const distToOther = Math.hypot(point.x - ox, point.y - oy);
            return distToEndpoint <= distToOther + wallThickness * 2;
        };

        const orderPlanesByReference = (baseLineData, referencePoint) => {
            if (!Wall.hasFinitePoint(referencePoint)) {
                return {
                    insidePoint: baseLineData.leftPoint,
                    outsidePoint: baseLineData.rightPoint,
                    insideIsLeft: true
                };
            }
            const leftDist = Wall.distancePointToLine(referencePoint, baseLineData.leftPoint, baseLineData.dir);
            const rightDist = Wall.distancePointToLine(referencePoint, baseLineData.rightPoint, baseLineData.dir);
            const insideIsLeft = leftDist <= rightDist;
            return {
                insidePoint: insideIsLeft ? baseLineData.leftPoint : baseLineData.rightPoint,
                outsidePoint: insideIsLeft ? baseLineData.rightPoint : baseLineData.leftPoint,
                insideIsLeft
            };
        };

        let bestLeft = null;
        let bestRight = null;
        let bestLeftDist = Infinity;
        let bestRightDist = Infinity;

        for (const neighbor of candidates) {
            if (!neighbor) continue;
            const neighborEndpointKey = Wall.pointsMatch(endpoint, neighbor.a) ? 'a' : (Wall.pointsMatch(endpoint, neighbor.b) ? 'b' : null);
            if (!neighborEndpointKey) continue;
            const neighborLineData = neighbor.getEndpointLineData(neighborEndpointKey);
            if (!neighborLineData) continue;
            const neighborOtherEndpoint = neighborEndpointKey === 'a' ? neighbor.b : neighbor.a;
            if (!Wall.hasFinitePoint(neighborOtherEndpoint) || !Wall.hasFinitePoint(otherEndpoint)) continue;

            const thisOrder = orderPlanesByReference(lineData, neighborOtherEndpoint);
            const neighborOrder = orderPlanesByReference(neighborLineData, otherEndpoint);
            const thisHeight = Number(this.height);
            const neighborHeight = Number(neighbor.height);
            const hasHeightMismatch = Number.isFinite(thisHeight) && Number.isFinite(neighborHeight) && !Wall.heightsMatch(this, neighbor);
            const thisIsTaller = hasHeightMismatch && thisHeight > neighborHeight;

            let leftCandidate = null;
            let rightCandidate = null;
            if (hasHeightMismatch) {
                // Height mismatch joins are clipped against one side-line of the opposite wall:
                // - Taller wall extends to the farther (outside) side-line of the shorter wall.
                // - Shorter wall stops at the nearer (inside) side-line of the taller wall.
                const neighborCutLine = thisIsTaller ? neighborOrder.outsidePoint : neighborOrder.insidePoint;
                leftCandidate = Wall.lineIntersection(
                    lineData.leftPoint, lineData.dir,
                    neighborCutLine, neighborLineData.dir
                );
                rightCandidate = Wall.lineIntersection(
                    lineData.rightPoint, lineData.dir,
                    neighborCutLine, neighborLineData.dir
                );
            } else {
                // Equal-height join: inside-to-inside and outside-to-outside miter.
                const insideHit = Wall.lineIntersection(
                    thisOrder.insidePoint, lineData.dir,
                    neighborOrder.insidePoint, neighborLineData.dir
                );
                const outsideHit = Wall.lineIntersection(
                    thisOrder.outsidePoint, lineData.dir,
                    neighborOrder.outsidePoint, neighborLineData.dir
                );
                const mapInsideToLeft = thisOrder.insideIsLeft;
                leftCandidate = mapInsideToLeft ? insideHit : outsideHit;
                rightCandidate = mapInsideToLeft ? outsideHit : insideHit;
            }

            if (leftCandidate && isEndpointLocalPoint(leftCandidate)) {
                const d = Math.hypot(leftCandidate.x - endpoint.x, leftCandidate.y - endpoint.y);
                if (d <= maxMiterDistance && d < bestLeftDist) {
                    bestLeftDist = d;
                    bestLeft = leftCandidate;
                }
            }
            if (rightCandidate && isEndpointLocalPoint(rightCandidate)) {
                const d = Math.hypot(rightCandidate.x - endpoint.x, rightCandidate.y - endpoint.y);
                if (d <= maxMiterDistance && d < bestRightDist) {
                    bestRightDist = d;
                    bestRight = rightCandidate;
                }
            }
        }

        let left = bestLeft || defaultLeft;
        let right = bestRight || defaultRight;

        // Keep wall volume valid even with pathological join geometry.
        if (Math.hypot(left.x - right.x, left.y - right.y) < wallThickness * 0.15) {
            left = defaultLeft;
            right = defaultRight;
        }
        return { left, right };
    }

    shouldPreserveEndpointJunction(endpointKey) {
        const endpoint = endpointKey === 'a' ? this.a : this.b;
        if (!endpoint) return false;
        const neighbors = this.collectPotentialJoinWalls().filter(wall => this.sharesEndpointWith(wall, endpoint));
        if (neighbors.length < 2) return false;
        if (!this.joinCorners) return false;
        if (endpointKey === 'a') {
            return Wall.hasFinitePoint(this.joinCorners.aLeft) && Wall.hasFinitePoint(this.joinCorners.aRight);
        }
        return Wall.hasFinitePoint(this.joinCorners.bLeft) && Wall.hasFinitePoint(this.joinCorners.bRight);
    }

    sharesEndpointWith(otherWall, endpoint) {
        if (!otherWall || !endpoint) return false;
        return (
            Wall.pointsMatch(endpoint, otherWall.a) ||
            Wall.pointsMatch(endpoint, otherWall.b)
        );
    }

    collectPotentialJoinWalls() {
        if (!this.map) return [];
        const candidates = new Set();
        const nodesToCheck = new Set();
        const endpoints = [this.a, this.b];

        endpoints.forEach(endpoint => {
            if (!endpoint || !Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) return;
            const node = this.map.worldToNode(endpoint.x, endpoint.y);
            if (!node) return;
            nodesToCheck.add(node);
            if (Array.isArray(node.neighbors)) {
                node.neighbors.forEach(neighbor => {
                    if (neighbor) nodesToCheck.add(neighbor);
                });
            }
        });

        this.nodes.forEach(node => {
            if (node) nodesToCheck.add(node);
        });

        nodesToCheck.forEach(node => {
            if (!node || !Array.isArray(node.objects)) return;
            node.objects.forEach(obj => {
                if (!obj || obj === this || obj.type !== 'wall') return;
                if (
                    this.sharesEndpointWith(obj, this.a) ||
                    this.sharesEndpointWith(obj, this.b)
                ) {
                    candidates.add(obj);
                }
            });
        });

        return Array.from(candidates);
    }

    hasConnectedWallAtEndpoint(endpointKey) {
        const endpoint = endpointKey === "a" ? this.a : this.b;
        if (!endpoint) return false;
        return this.collectPotentialJoinWalls().some(wall => this.sharesEndpointWith(wall, endpoint));
    }

    getAdjacentCollinearWallHeightAtEndpoint(endpointKey) {
        const endpoint = endpointKey === "a" ? this.a : this.b;
        if (!endpoint) return null;
        const neighbors = this.collectPotentialJoinWalls().filter(wall =>
            this.sharesEndpointWith(wall, endpoint) &&
            this.sharesLineEndpointAndAxis(wall)
        );
        if (!neighbors.length) return null;
        let maxHeight = -Infinity;
        for (let i = 0; i < neighbors.length; i++) {
            const h = Number(neighbors[i] && neighbors[i].height);
            if (!Number.isFinite(h)) continue;
            maxHeight = Math.max(maxHeight, h);
        }
        return Number.isFinite(maxHeight) ? maxHeight : null;
    }

    collectWallsSharingDeletedEndpoints() {
        if (!this.map) return [];
        const walls = new Set();
        const endpoints = [this.a, this.b];
        const nodesToCheck = new Set();

        endpoints.forEach(endpoint => {
            if (!endpoint || !Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) return;
            const node = this.map.worldToNode(endpoint.x, endpoint.y);
            if (!node) return;
            nodesToCheck.add(node);
            if (Array.isArray(node.neighbors)) {
                node.neighbors.forEach(neighbor => {
                    if (neighbor) nodesToCheck.add(neighbor);
                });
            }
        });

        nodesToCheck.forEach(node => {
            if (!node || !Array.isArray(node.objects)) return;
            node.objects.forEach(obj => {
                if (!obj || obj === this || obj.type !== 'wall') return;
                if (
                    this.sharesEndpointWith(obj, this.a) ||
                    this.sharesEndpointWith(obj, this.b)
                ) {
                    walls.add(obj);
                }
            });
        });

        return Array.from(walls);
    }

    rebuildHitboxesFromJoinState() {
        const profile = this.getWallProfile();
        if (!profile) {
            this.visualHitbox = null;
            this.groundPlaneHitbox = null;
            return;
        }

        const wallHeight = Math.max(0.001, Number(this.height) || 0.001);
        const { aLeft, aRight, bLeft, bRight } = profile;
        this.groundPlaneHitbox = new PolygonHitbox([aLeft, aRight, bRight, bLeft]);
        this.visualHitbox = new PolygonHitbox([
            { x: aLeft.x, y: aLeft.y },
            { x: aLeft.x, y: aLeft.y - wallHeight },
            { x: bLeft.x, y: bLeft.y - wallHeight },
            { x: bLeft.x, y: bLeft.y },
            { x: bRight.x, y: bRight.y },
            { x: bRight.x, y: bRight.y - wallHeight },
            { x: aRight.x, y: aRight.y - wallHeight },
            { x: aRight.x, y: aRight.y }
        ]);
    }

    recomputeJoins(options = {}) {
        const preserveMultiJunction = !!(options && options.preserveMultiJunction);
        const keepA = preserveMultiJunction && this.shouldPreserveEndpointJunction('a');
        const keepB = preserveMultiJunction && this.shouldPreserveEndpointJunction('b');

        const aJoin = keepA
            ? { left: this.joinCorners.aLeft, right: this.joinCorners.aRight }
            : this.computeJoinedEndpointCorners('a');
        const bJoin = keepB
            ? { left: this.joinCorners.bLeft, right: this.joinCorners.bRight }
            : this.computeJoinedEndpointCorners('b');

        this.joinCorners = {
            aLeft: aJoin ? aJoin.left : null,
            aRight: aJoin ? aJoin.right : null,
            bLeft: bJoin ? bJoin.left : null,
            bRight: bJoin ? bJoin.right : null
        };
        this.rebuildHitboxesFromJoinState();
    }

    updateConnectedWallJoins() {
        const neighbors = this.collectPotentialJoinWalls();
        this.recomputeJoins();
        neighbors.forEach(wall => {
            if (wall && typeof wall.recomputeJoins === 'function') {
                wall.recomputeJoins({ preserveMultiJunction: true });
            }
        });
    }
    
    findNodesAlongWall(endpointA, endpointB) {
        // Find all nodes between the two endpoints
        // Only add actual MapNodes (check if they have xindex property)
        if (this.isMapNode(endpointA)) {
            this.nodes.push(endpointA);
        }
        if (this.isMapNode(endpointB) && endpointB !== endpointA) {
            this.nodes.push(endpointB);
        }
    }
    
    isMapNode(obj) {
        // MapNodes have xindex and yindex properties
        return obj && typeof obj.xindex === 'number' && typeof obj.yindex === 'number';
    }
    
    addToNodes() {
        // Add this wall to all nodes it sits on
        for (const node of this.nodes) {
            if (node) {
                node.addObject(this);
            }
        }
    }
    
    removeFromNodes() {
        // Remove this wall from all nodes it sits on
        for (const node of this.nodes) {
            if (node) {
                node.removeObject(this);
            }
        }
        
        // Clear all blocked links
        for (const link of this.blockedLinks) {
            const {node, direction} = link;
            if (node.blockedNeighbors && node.blockedNeighbors.has(direction)) {
                const blockSet = node.blockedNeighbors.get(direction);
                blockSet.delete(this);
                if (blockSet.size === 0) {
                    node.blockedNeighbors.delete(direction);
                }
            }
        }
        this.blockedLinks = [];

        // Recompute only walls that shared an endpoint with this deleted wall.
        // Their joins now resolve against the reduced local wall set.
        const adjacentWalls = this.collectWallsSharingDeletedEndpoints();
        const touchedBefore = Wall.collectSectionIdsFromWalls([this, ...adjacentWalls]);
        adjacentWalls.forEach(wall => {
            if (wall && typeof wall.recomputeJoins === 'function') {
                wall.recomputeJoins();
            }
        });
        Wall.recomputeLineGroups(this.map);
        Wall.repairMountedSectionLinks(this.map);
        Wall.markDirtyForTouchedSections(adjacentWalls, touchedBefore);
    }

    removeFromGame() {
        if (this.gone) return;
        this.gone = true;
        this.vanishing = false;
        if (this._vanishFinalizeTimeout) {
            clearTimeout(this._vanishFinalizeTimeout);
            this._vanishFinalizeTimeout = null;
        }
        this.removeFromNodes();
        if (Array.isArray(this.map && this.map.objects)) {
            const idx = this.map.objects.indexOf(this);
            if (idx >= 0) this.map.objects.splice(idx, 1);
        }
    }
    remove() {
        this.removeFromGame();
    }
    
    addBlockedLink(node, direction) {
        if (!node.blockedNeighbors) {
            node.blockedNeighbors = new Map();
        }
        if (!node.blockedNeighbors.has(direction)) {
            node.blockedNeighbors.set(direction, new Set());
        }
        node.blockedNeighbors.get(direction).add(this);
        
        // Track this blocked link for cleanup later
        this.blockedLinks.push({node, direction});
    }
    
    blockCrossConnection(node, dirA, dirB) {
        // Block the connection between node.neighbors[dirA] and node.neighbors[dirB]
        const neighborA = node.neighbors[dirA];
        const neighborB = node.neighbors[dirB];
        
        if (!neighborA || !neighborB) return;
        
        // Find the directions between the two neighbors
        const dirAtoB = neighborA.neighbors.indexOf(neighborB);
        const dirBtoA = neighborB.neighbors.indexOf(neighborA);
        
        if (dirAtoB !== -1) {
            this.addBlockedLink(neighborA, dirAtoB);
        }
        if (dirBtoA !== -1) {
            this.addBlockedLink(neighborB, dirBtoA);
        }
    }
    
    draw() {
        // Clear previous frame's drawing
        this.pixiSprite.clear();
        // Use the static method to draw this wall
        const profile = this.getWallProfile();
        const wallHeight = Math.max(0.001, Number(this.height) || 0.001);
        const adjacentHeightA = this.getAdjacentCollinearWallHeightAtEndpoint("a");
        const adjacentHeightB = this.getAdjacentCollinearWallHeightAtEndpoint("b");
        const capBaseHeightA = Number.isFinite(adjacentHeightA)
            ? Math.max(0, Math.min(wallHeight, Number(adjacentHeightA)))
            : 0;
        const capBaseHeightB = Number.isFinite(adjacentHeightB)
            ? Math.max(0, Math.min(wallHeight, Number(adjacentHeightB)))
            : 0;
        const capVisibleEps = 1e-5;
        const renderCapA = capBaseHeightA < (wallHeight - capVisibleEps);
        const renderCapB = capBaseHeightB < (wallHeight - capVisibleEps);
        Wall.drawWall(
            this.pixiSprite,
            this.a,
            this.b,
            this.height,
            this.thickness,
            0x555555,
            1.0,
            {
                profile,
                texturePhaseA: this.texturePhaseA,
                texturePhaseB: this.texturePhaseB,
                renderCapA,
                renderCapB,
                capBaseHeightA,
                capBaseHeightB
            }
        );
    }

    static buildPlacementPath(map, startPoint, endPoint, options = {}) {
        if (!map || !startPoint || !endPoint) return [];
        const startAnchor = (typeof map.worldToNodeOrMidpoint === "function")
            ? map.worldToNodeOrMidpoint(startPoint.x, startPoint.y)
            : map.worldToNode(startPoint.x, startPoint.y);
        const endAnchor = (typeof map.worldToNodeOrMidpoint === "function")
            ? map.worldToNodeOrMidpoint(endPoint.x, endPoint.y)
            : map.worldToNode(endPoint.x, endPoint.y);
        if (!startAnchor || !endAnchor) return [];
        const centerPath = map.getHexLine(startAnchor, endAnchor);
        if (!Array.isArray(centerPath) || centerPath.length === 0) return [];

        const path = [];
        const pushUnique = (pointLike) => {
            if (!pointLike || !Number.isFinite(pointLike.x) || !Number.isFinite(pointLike.y)) return;
            const last = path[path.length - 1];
            if (last && Wall.pointsMatch(last, pointLike)) return;
            path.push(pointLike);
        };
        pushUnique(startAnchor);
        for (let i = 0; i < centerPath.length; i++) {
            pushUnique(centerPath[i]);
        }
        pushUnique(endAnchor);
        return path;
    }

    static planWallLineSegments(wallPath, map, options = {}) {
        const routeIn = Array.isArray(wallPath) ? wallPath.slice() : [];
        const skipExisting = options.skipExisting !== false;
        const startReferenceWall = options.startReferenceWall || null;
        const isMapNode = (obj) => obj && typeof obj.xindex === 'number' && typeof obj.yindex === 'number';
        const isMidpointAnchor = (obj) => !!(
            obj &&
            !isMapNode(obj) &&
            Number.isFinite(obj.x) &&
            Number.isFinite(obj.y) &&
            obj.nodeA &&
            obj.nodeB
        );
        const nearlyEqual = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
        const pointsMatch = (p1, p2) => nearlyEqual(p1.x, p2.x) && nearlyEqual(p1.y, p2.y);
        const nodeKey = (node) => `n:${node.xindex},${node.yindex}`;
        const midpointKeyFromNodes = (nodeA, nodeB) => {
            if (!isMapNode(nodeA) || !isMapNode(nodeB)) return null;
            const keyA = nodeKey(nodeA);
            const keyB = nodeKey(nodeB);
            return (keyA <= keyB) ? `m:${keyA}|${keyB}` : `m:${keyB}|${keyA}`;
        };
        const canonicalEndpointKey = (endpoint) => {
            if (!endpoint || !Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) return null;
            if (isMapNode(endpoint)) return nodeKey(endpoint);
            if (endpoint.nodeA && endpoint.nodeB) {
                const midKey = midpointKeyFromNodes(endpoint.nodeA, endpoint.nodeB);
                if (midKey) return midKey;
            }
            if (map && typeof map.worldToNodeOrMidpoint === "function") {
                const resolved = map.worldToNodeOrMidpoint(endpoint.x, endpoint.y);
                if (isMapNode(resolved)) return nodeKey(resolved);
                if (resolved && resolved.nodeA && resolved.nodeB) {
                    const midKey = midpointKeyFromNodes(resolved.nodeA, resolved.nodeB);
                    if (midKey) return midKey;
                }
            }
            return `p:${Number(endpoint.x).toFixed(6)},${Number(endpoint.y).toFixed(6)}`;
        };
        const canonicalSegmentKey = (endpointA, endpointB) => {
            const keyA = canonicalEndpointKey(endpointA);
            const keyB = canonicalEndpointKey(endpointB);
            if (!keyA || !keyB) return null;
            return (keyA <= keyB) ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
        };
        const wallExistsBetween = (endpointA, endpointB) => {
            const desiredSegmentKey = canonicalSegmentKey(endpointA, endpointB);
            const nodesToCheck = [];
            const seenNodeKeys = new Set();
            const pushNode = (node) => {
                if (!isMapNode(node)) return;
                const k = nodeKey(node);
                if (seenNodeKeys.has(k)) return;
                seenNodeKeys.add(k);
                nodesToCheck.push(node);
            };
            const pushEndpointNode = (endpoint) => {
                if (!endpoint || !Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) return;
                if (isMapNode(endpoint)) {
                    pushNode(endpoint);
                    return;
                }
                if (map && typeof map.worldToNode === "function") {
                    pushNode(map.worldToNode(endpoint.x, endpoint.y));
                }
            };
            pushEndpointNode(endpointA);
            pushEndpointNode(endpointB);
            for (const node of nodesToCheck) {
                const nodeObjects = node.objects || [];
                for (const obj of nodeObjects) {
                    if (!obj || obj.type !== 'wall' || !obj.a || !obj.b) continue;
                    if (desiredSegmentKey) {
                        const existingSegmentKey = canonicalSegmentKey(obj.a, obj.b);
                        if (existingSegmentKey && existingSegmentKey === desiredSegmentKey) return true;
                    }
                    const forwardMatch = pointsMatch(obj.a, endpointA) && pointsMatch(obj.b, endpointB);
                    const reverseMatch = pointsMatch(obj.a, endpointB) && pointsMatch(obj.b, endpointA);
                    if (forwardMatch || reverseMatch) return true;
                }
            }
            return false;
        };
        const getWallsSharingEndpoint = endpoint => {
            if (!endpoint || !Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) return [];
            const node = map.worldToNode(endpoint.x, endpoint.y);
            if (!node || !Array.isArray(node.objects)) return [];
            return node.objects.filter(obj =>
                obj &&
                obj.type === 'wall' &&
                (Wall.pointsMatch(obj.a, endpoint) || Wall.pointsMatch(obj.b, endpoint))
            );
        };

        let route = routeIn;
        if (route.length > 1) {
            const startWalls = getWallsSharingEndpoint(route[0]);
            const endWalls = getWallsSharingEndpoint(route[route.length - 1]);
            if (!startWalls.length && endWalls.length) {
                route = route.slice().reverse();
            }
        }

        const segments = [];
        for (let i = 0; i < route.length - 1; i++) {
            let endpointA = route[i];
            let endpointB = route[i + 1];
            if (!endpointA || !endpointB) continue;

            const endpointAIsNode = isMapNode(endpointA);
            const endpointBIsNode = isMapNode(endpointB);
            const directionAtoB = (endpointAIsNode && endpointBIsNode && endpointA.neighbors)
                ? endpointA.neighbors.indexOf(endpointB)
                : -1;
            const directionBtoA = (endpointAIsNode && endpointBIsNode && endpointB.neighbors)
                ? endpointB.neighbors.indexOf(endpointA)
                : -1;
            const dx = map && typeof map.shortestDeltaX === "function"
                ? map.shortestDeltaX(endpointA.x, endpointB.x)
                : (endpointB.x - endpointA.x);
            const dy = map && typeof map.shortestDeltaY === "function"
                ? map.shortestDeltaY(endpointA.y, endpointB.y)
                : (endpointB.y - endpointA.y);
            let wallDirection = (map && typeof map.getHexDirection === "function")
                ? map.getHexDirection(dx, dy)
                : 0;

            if (directionAtoB >= 0 && directionBtoA >= 0) {
                if (directionBtoA < directionAtoB) {
                    wallDirection = directionBtoA;
                    const endpointC = endpointA;
                    endpointA = endpointB;
                    endpointB = endpointC;
                } else {
                    wallDirection = directionAtoB;
                }
            }

            const shouldSplitLongDiagonal = (directionAtoB >= 0 && directionBtoA >= 0 && (directionAtoB % 2 === 0));
            if (shouldSplitLongDiagonal) {
                const midpoint = {
                    x: (endpointA.x + endpointB.x) / 2,
                    y: (endpointA.y + endpointB.y) / 2
                };
                if (!skipExisting || !wallExistsBetween(endpointA, midpoint)) {
                    segments.push({ from: endpointA, to: midpoint, direction: wallDirection });
                }
                if (!skipExisting || !wallExistsBetween(midpoint, endpointB)) {
                    segments.push({ from: midpoint, to: endpointB, direction: wallDirection + 6 });
                }
            } else if (!skipExisting || !wallExistsBetween(endpointA, endpointB)) {
                segments.push({ from: endpointA, to: endpointB, direction: wallDirection });
            }
        }

        // Midpoint terminal anchors are only allowed when collinear with previous wall axis.
        const terminal = route.length > 0 ? route[route.length - 1] : null;
        if (isMidpointAnchor(terminal) && segments.length > 0) {
            const lastSegment = segments[segments.length - 1];
            const lastEndsAtTerminal = !!(lastSegment && pointsMatch(lastSegment.to, terminal));
            if (lastEndsAtTerminal) {
                let requiredAxis = null;
                if (segments.length > 1) {
                    requiredAxis = Wall.normalizeDirectionAxis(segments[segments.length - 2].direction);
                } else if (startReferenceWall && Number.isFinite(startReferenceWall.direction)) {
                    requiredAxis = Wall.normalizeDirectionAxis(startReferenceWall.direction);
                }
                const lastAxis = Number.isFinite(lastSegment.direction)
                    ? Wall.normalizeDirectionAxis(lastSegment.direction)
                    : null;
                const allowTerminalMidpoint = (requiredAxis !== null && lastAxis !== null && requiredAxis === lastAxis);
                if (!allowTerminalMidpoint) {
                    segments.pop();
                }
            }
        }

        return { route, segments, getWallsSharingEndpoint };
    }
    
    static createWallLine(wallPath, height, thickness, map, options = {}) {
        // Create a chain of walls along a path, handling long diagonals
        const walls = [];
        const plan = Wall.planWallLineSegments(wallPath, map, {
            skipExisting: true,
            startReferenceWall: options.startReferenceWall || null
        });
        const plannedSegments = (plan && Array.isArray(plan.segments)) ? plan.segments : [];
        const getWallsSharingEndpoint = (plan && typeof plan.getWallsSharingEndpoint === "function")
            ? plan.getWallsSharingEndpoint
            : (() => []);
        const newSegments = [];
        for (let i = 0; i < plannedSegments.length; i++) {
            const seg = plannedSegments[i];
            if (!seg || !seg.from || !seg.to) continue;
            const wall = new Wall(seg.from, seg.to, height, thickness, map, seg.direction);
            walls.push(wall);
            newSegments.push({ wall, from: seg.from, to: seg.to });
        }

        // Keep horizontal wall texture phase continuous across newly placed segments.
        if (newSegments.length > 0) {
            const startEndpoint = newSegments[0].from;
            const startAttachedWalls = getWallsSharingEndpoint(startEndpoint).filter(w => !newSegments.some(s => s.wall === w));
            let phaseCursor = 0;
            if (startAttachedWalls.length > 0) {
                const inherited = startAttachedWalls[0].getTexturePhaseAtEndpoint(startEndpoint);
                if (Number.isFinite(inherited)) phaseCursor = inherited;
            }
            for (const segment of newSegments) {
                const segmentLength = Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
                const phaseStep = segmentLength / 3; // three map units per repeat
                const nextPhase = phaseCursor + phaseStep;
                segment.wall.setTexturePhaseForOrderedEndpoints(
                    segment.from,
                    segment.to,
                    phaseCursor,
                    nextPhase
                );
                phaseCursor = nextPhase;
            }
        }
        
        return walls;
    }

    static drawWall(graphics, endpointA, endpointB, height, thickness, color, alpha, options = {}) {
        if (!graphics || !endpointA || !endpointB) return;
        const ax = Number(endpointA.x);
        const ay = Number(endpointA.y);
        const bx = Number(endpointB.x);
        const by = Number(endpointB.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return;

        const wallHeight = Math.max(0.001, Number(height) || 0.001);
        const wallThickness = Math.max(0.001, Number(thickness) || 0.001);
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return;

        const halfThickness = wallThickness / 2;
        const nx = -dy / len;
        const ny = dx / len;

        let aLeft = { x: ax + nx * halfThickness, y: ay + ny * halfThickness };
        let aRight = { x: ax - nx * halfThickness, y: ay - ny * halfThickness };
        let bLeft = { x: bx + nx * halfThickness, y: by + ny * halfThickness };
        let bRight = { x: bx - nx * halfThickness, y: by - ny * halfThickness };
        if (options && options.profile) {
            const p = options.profile;
            if (p.aLeft) aLeft = p.aLeft;
            if (p.aRight) aRight = p.aRight;
            if (p.bLeft) bLeft = p.bLeft;
            if (p.bRight) bRight = p.bRight;
        }

        const toScreen = (pt, z = 0) => {
            const screen = worldToScreen(pt);
            return { x: screen.x, y: screen.y - z * viewscale * xyratio };
        };

        const gAL = toScreen(aLeft, 0);
        const gAR = toScreen(aRight, 0);
        const gBL = toScreen(bLeft, 0);
        const gBR = toScreen(bRight, 0);
        const tAL = toScreen(aLeft, wallHeight);
        const tAR = toScreen(aRight, wallHeight);
        const tBL = toScreen(bLeft, wallHeight);
        const tBR = toScreen(bRight, wallHeight);
        const capBaseA = Number.isFinite(options.capBaseHeightA)
            ? Math.max(0, Math.min(wallHeight, Number(options.capBaseHeightA)))
            : 0;
        const capBaseB = Number.isFinite(options.capBaseHeightB)
            ? Math.max(0, Math.min(wallHeight, Number(options.capBaseHeightB)))
            : 0;
        const mAL = toScreen(aLeft, capBaseA);
        const mAR = toScreen(aRight, capBaseA);
        const mBL = toScreen(bLeft, capBaseB);
        const mBR = toScreen(bRight, capBaseB);

        const shadeColor = (hex, factor) => {
            const f = Math.max(0, factor);
            const r = Math.min(255, Math.max(0, Math.round(((hex >> 16) & 0xff) * f)));
            const g = Math.min(255, Math.max(0, Math.round(((hex >> 8) & 0xff) * f)));
            const b = Math.min(255, Math.max(0, Math.round((hex & 0xff) * f)));
            return (r << 16) | (g << 8) | b;
        };

        const faceDepth = pts => pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
        const longFaceA = [gAL, gBL, tBL, tAL];
        const longFaceB = [gAR, gBR, tBR, tAR];
        const capFaceA = [mAR, mAL, tAL, tAR];
        const capFaceB = [mBL, mBR, tBR, tBL];
        const topFace = [tAL, tBL, tBR, tAR];
        const renderCapA = options.renderCapA !== false;
        const renderCapB = options.renderCapB !== false;

        const longAFront = faceDepth(longFaceA) >= faceDepth(longFaceB);
        const capAFront = faceDepth(capFaceA) >= faceDepth(capFaceB);
        const stoneTexture = options.disableWallTexture ? null : Wall.getStoneWallTexture();
        const zUnitPx = Math.max(1, viewscale * xyratio);
        const phaseA = Number.isFinite(options.texturePhaseA) ? options.texturePhaseA : 0;
        const phaseB = Number.isFinite(options.texturePhaseB) ? options.texturePhaseB : (phaseA + len / 3);
        const shadeColorFactor = 1.2;

        const faces = [
            longAFront
                ? {
                    pts: longFaceA,
                    color: shadeColor(color, 1.18 * shadeColorFactor),
                    textured: true
                }
                : {
                    pts: longFaceB,
                    color: shadeColor(color, 1.18 * shadeColorFactor),
                    textured: true
                },
        ];
        const frontCapIsA = capAFront;
        if (frontCapIsA && renderCapA) {
            faces.push({
                pts: capFaceA,
                color: shadeColor(color, 1.08 * shadeColorFactor),
                textured: true
            });
        }
        if (!frontCapIsA && renderCapB) {
            faces.push({
                pts: capFaceB,
                color: shadeColor(color, 1.08 * shadeColorFactor),
                textured: true
            });
        }

        faces.sort((aFace, bFace) => faceDepth(aFace.pts) - faceDepth(bFace.pts));
        graphics.lineStyle(0);
        for (const face of faces) {
            const pts = face.pts;
            const shouldTexture = !!stoneTexture && face.textured;
            if (shouldTexture) {
                const bottomA = pts[0];
                const bottomB = pts[1];
                const topA = pts[3];
                const u = {
                    x: bottomB.x - bottomA.x,
                    y: bottomB.y - bottomA.y
                };
                const v = {
                    x: topA.x - bottomA.x,
                    y: topA.y - bottomA.y
                };
                const uLen = Math.max(1e-6, Math.hypot(u.x, u.y));
                const vLen = Math.max(1e-6, Math.hypot(v.x, v.y));
                const uDir = { x: u.x / uLen, y: u.y / uLen };
                const vDir = { x: v.x / vLen, y: v.y / vLen };
                const texW = Math.max(1, stoneTexture.width || (stoneTexture.baseTexture && stoneTexture.baseTexture.width) || 256);
                const texH = Math.max(1, stoneTexture.height || (stoneTexture.baseTexture && stoneTexture.baseTexture.height) || 256);
                const repeatsAcrossFace = Math.max(1e-6, Math.abs(phaseB - phaseA));
                const uRepeatPx = Math.max(1, uLen / repeatsAcrossFace);
                const vRepeatPx = zUnitPx * 3; // three map height units per vertical repeat
                const phaseShiftPx = phaseA * uRepeatPx;
                const matrix = new PIXI.Matrix(
                    uDir.x * (uRepeatPx / texW),
                    uDir.y * (uRepeatPx / texW),
                    vDir.x * (vRepeatPx / texH),
                    vDir.y * (vRepeatPx / texH),
                    bottomA.x - uDir.x * phaseShiftPx,
                    bottomA.y - uDir.y * phaseShiftPx
                );
                graphics.beginTextureFill({
                    texture: stoneTexture,
                    color: face.color,
                    alpha,
                    matrix
                });
            } else {
                graphics.beginFill(face.color, alpha);
            }
            graphics.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                graphics.lineTo(pts[i].x, pts[i].y);
            }
            graphics.closePath();
            graphics.endFill();
        }

        // Draw the top cap last to ensure the prism appears closed.
        const topCenter = topFace.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        topCenter.x /= topFace.length;
        topCenter.y /= topFace.length;
        const orderedTop = topFace
            .slice()
            .sort((p1, p2) => Math.atan2(p1.y - topCenter.y, p1.x - topCenter.x) - Math.atan2(p2.y - topCenter.y, p2.x - topCenter.x));

        graphics.lineStyle(0);
        graphics.beginFill(shadeColor(color, 1.2), alpha);
        graphics.moveTo(orderedTop[0].x, orderedTop[0].y);
        for (let i = 1; i < orderedTop.length; i++) {
            graphics.lineTo(orderedTop[i].x, orderedTop[i].y);
        }
        graphics.closePath();
        graphics.endFill();
    }

    saveJson() {
        return {
            type: 'wall',
            aX: this.a.x,
            aY: this.a.y,
            bX: this.b.x,
            bY: this.b.y,
            height: this.height,
            thickness: this.thickness,
            texturePhaseA: this.texturePhaseA,
            texturePhaseB: this.texturePhaseB,
            sectionId: Number.isInteger(this.sectionId)
                ? this.sectionId
                : (Number.isInteger(this.lineGroupId) ? this.lineGroupId : null)
        };
    }

    static loadJson(data, map) {
        if (!data || data.type !== 'wall' || !map) return null;

        try {
            let nodeA = map.worldToNode(data.aX, data.aY);
            let nodeB = map.worldToNode(data.bX, data.bY);
            if (Math.abs(nodeA.x - data.aX) > 0.1 || Math.abs(nodeA.y - data.aY) > 0.1) {
                nodeA = {x: data.aX, y: data.aY}; // Use raw coordinates if no close node found
            }
            if (Math.abs(nodeB.x - data.bX) > 0.1 || Math.abs(nodeB.y - data.bY) > 0.1) {
                nodeB = {x: data.bX, y: data.bY}; // Use raw coordinates if no close node found
            }
            if (!nodeA || !nodeB) return null;
            let direction = map.getHexDirection(nodeA.x - nodeB.x, nodeA.y - nodeB.y) % 6;
            const wall = new Wall(nodeA, nodeB, data.height || 1, data.thickness || 0.1, map, direction);
            if (Number.isFinite(data.texturePhaseA)) wall.texturePhaseA = data.texturePhaseA;
            if (Number.isFinite(data.texturePhaseB)) wall.texturePhaseB = data.texturePhaseB;
            const persistedSectionId = Number.isInteger(data.sectionId)
                ? Number(data.sectionId)
                : (Number.isInteger(data.lineGroupId) ? Number(data.lineGroupId) : null);
            if (Number.isInteger(persistedSectionId)) {
                wall._persistedSectionId = persistedSectionId;
            }
            return wall;
        } catch (e) {
            console.error("Error loading wall:", e);
            return null;
        }
    }

    ignite() {
        // these walls are non-flammable, so do nothing
    }
}

class Road extends StaticObject {
    static _geometryCache = new Map();
    static _textureCache = new Map();
    static _textureCacheVersion = 5;
    static _oddDirections = [1, 3, 5, 7, 9, 11];
    static _gravelTexture = null;
    static _fillTextureCache = new Map();
    static _defaultFillTexturePath = '/assets/images/flooring/dirt.jpg';
    static _repeatWorldUnits = 10;
    static _pixelsPerWorldUnit = (128 * 2) / 1.1547;
    static _edgeFadePx = 64;
    static _phaseQuantPx = 8;
    static _maxTextureCacheEntries = 384;
    static _textureScaleByName = {
        "cobblestones.png": { x: 0.5, y: 0.5, squashByXyRatio: true }
    };

    static _getTextureScale(texturePath) {
        const rawPath = (typeof texturePath === 'string') ? texturePath : '';
        const filename = rawPath.split('/').pop().toLowerCase();
        const rule = Road._textureScaleByName[filename];
        if (!rule) return { x: 1, y: 1 };

        const sx = Number.isFinite(rule.x) ? rule.x : 1;
        let sy = Number.isFinite(rule.y) ? rule.y : 1;
        if (rule.squashByXyRatio) {
            const yRatio = (typeof globalThis !== 'undefined' && Number.isFinite(globalThis.xyratio))
                ? globalThis.xyratio
                : 0.66;
            sy *= yRatio;
        }
        return { x: sx, y: sy };
    }

    static _getGravelTexture() {
        if (!Road._gravelTexture) {
            Road._gravelTexture = PIXI.Texture.from('/assets/images/gravel.jpeg');
            if (Road._gravelTexture && Road._gravelTexture.baseTexture) {
                Road._gravelTexture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
                Road._gravelTexture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
            }
        }
        return Road._gravelTexture;
    }

    static _getFillTexture(texturePath = Road._defaultFillTexturePath) {
        const resolvedPath = (typeof texturePath === 'string' && texturePath.length > 0)
            ? texturePath
            : Road._defaultFillTexturePath;
        if (!Road._fillTextureCache.has(resolvedPath)) {
            const tex = PIXI.Texture.from(resolvedPath);
            if (tex && tex.baseTexture) {
                tex.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
                tex.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
            }
            Road._fillTextureCache.set(resolvedPath, tex);
        }
        return Road._fillTextureCache.get(resolvedPath);
    }

    static _pointInPolygon(px, py, points) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x;
            const yi = points[i].y;
            const xj = points[j].x;
            const yj = points[j].y;
            const intersect = ((yi > py) !== (yj > py)) &&
                (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-7) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    static _getNeighborMask(neighborDirections) {
        if (!Array.isArray(neighborDirections) || neighborDirections.length === 0) return 0;
        let mask = 0;
        Road._oddDirections.forEach((dir, idx) => {
            if (neighborDirections.includes(dir)) mask |= (1 << idx);
        });
        return mask;
    }

    static _buildGeometryForMask(mask) {
        const radius = 128;
        const corners = [];
        for (let i = 0; i < 6; i++) {
            const angle = (i * Math.PI / 3) + Math.PI;  // Start at left (180°)
            const x = radius * Math.cos(angle);
            const y = radius * Math.sin(angle);
            corners.push({x, y});
        }

        const bounds = {
            x: corners[0].x,
            y: corners[1].y,
            width: corners[3].x - corners[0].x,
            height: corners[4].y - corners[1].y
        };

        const neighbors = Road._oddDirections.filter((_, idx) => (mask & (1 << idx)) !== 0);

        const skipCorners = new Set();
        for (let i = 0; i < Road._oddDirections.length; i++) {
            const a = Road._oddDirections[i];
            const b = Road._oddDirections[(i + 5) % 6];
            if (neighbors.includes(a) || neighbors.includes(b)) {
                continue; // Don't skip if either neighbor is road
            }
            const c = Road._oddDirections[(i + 1) % 6];
            const d = Road._oddDirections[(i + 4) % 6];
            if (neighbors.includes(c) || neighbors.includes(d)) {
                skipCorners.add(i); // Skip this corner it's one away from another road
            }
        }
        for (let i = 0; i < 6; i++) {
            if (!skipCorners.has(i) && skipCorners.has((i + 5) % 6) && skipCorners.has((i + 1) % 6)) {
                corners[i].x = 0; // Move skipped corners to center to create a straight edge
                corners[i].y = 0;
            }
        }

        const keptCorners = [];
        const keptCornerIndices = [];
        for (let i = 0; i < corners.length; i++) {
            if (skipCorners.has(i)) continue;
            keptCorners.push(corners[i]);
            keptCornerIndices.push(i);
        }

        return { keptCorners, keptCornerIndices, radius, bounds, mask };
    }

    static getGeometryForNeighbors(neighborDirections) {
        const mask = Road._getNeighborMask(neighborDirections);
        if (!Road._geometryCache.has(mask)) {
            Road._geometryCache.set(mask, Road._buildGeometryForMask(mask));
        }
        return Road._geometryCache.get(mask);
    }

    static _buildTextureForMask(mask, phaseX, phaseY, fillTexturePath = Road._defaultFillTexturePath) {
        const geometry = Road._geometryCache.has(mask)
            ? Road._geometryCache.get(mask)
            : Road._buildGeometryForMask(mask);
        if (!Road._geometryCache.has(mask)) {
            Road._geometryCache.set(mask, geometry);
        }

        const { keptCorners, keptCornerIndices } = geometry;
        const size = 256;
        const canvasWidth = size;
        const canvasHeight = Math.round(size * 0.866);
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        const repeatPx = Road._repeatWorldUnits * Road._pixelsPerWorldUnit;
        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return PIXI.Texture.WHITE;

        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        ctx.save();
        ctx.beginPath();
        keptCorners.forEach((pt, idx) => {
            const x = centerX + pt.x;
            const y = centerY + pt.y;
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.clip();

        const fillTexture = Road._getFillTexture(fillTexturePath);
        const baseTexture = fillTexture && fillTexture.baseTexture ? fillTexture.baseTexture : null;
        const source = baseTexture && baseTexture.valid && baseTexture.resource
            ? baseTexture.resource.source
            : null;
        let drewSource = false;

        if (source && source.width > 0 && source.height > 0) {
            try {
                const texScale = Road._getTextureScale(fillTexturePath);
                const tileW = Math.max(1, repeatPx * texScale.x);
                const tileH = Math.max(1, repeatPx * texScale.y);
                // Keep world-phase offsets unscaled so neighboring road tiles
                // sample the same global texture field without seam drift.
                const startX = centerX - phaseX;
                const startY = centerY - phaseY;
                for (let x = startX - tileW; x < canvasWidth + tileW; x += tileW) {
                    for (let y = startY - tileH; y < canvasHeight + tileH; y += tileH) {
                        ctx.drawImage(source, x, y, tileW, tileH);
                    }
                }
                drewSource = true;
            } catch (e) {
                drewSource = false;
            }
        }
        if (!drewSource) {
            ctx.fillStyle = '#8d7558';
            ctx.fill();
        }
        ctx.restore();

        // Fade inward on polygon edges that do NOT border another road.
        // Keep polygon boundaries unchanged by only reducing alpha inside the edge.
        const fadePx = Road._edgeFadePx;
        const neighborBits = [];
        for (let i = 0; i < 6; i++) {
            neighborBits.push((mask & (1 << i)) !== 0);
        }

        const fadeEdges = [];
        for (let i = 0; i < keptCorners.length; i++) {
            const j = (i + 1) % keptCorners.length;
            const aIdx = keptCornerIndices[i];
            const bIdx = keptCornerIndices[j];
            const step = (bIdx - aIdx + 6) % 6;

            // Edge is between original adjacent corners.
            // Treat it as bordered if that side has a road neighbor.
            const bordersRoad = (step === 1) && neighborBits[aIdx];
            if (bordersRoad) continue;

            const p0 = { x: centerX + keptCorners[i].x, y: centerY + keptCorners[i].y };
            const p1 = { x: centerX + keptCorners[j].x, y: centerY + keptCorners[j].y };
            fadeEdges.push({ ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y });
        }

        if (fadeEdges.length > 0) {
            // Fast path: approximate distance fade using clipped gradient strips
            // instead of per-pixel CPU processing.
            const polygonPoints = keptCorners.map(pt => ({ x: centerX + pt.x, y: centerY + pt.y }));
            ctx.save();
            ctx.beginPath();
            keptCorners.forEach((pt, idx) => {
                const x = centerX + pt.x;
                const y = centerY + pt.y;
                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.closePath();
            ctx.clip();

            for (let i = 0; i < fadeEdges.length; i++) {
                const edge = fadeEdges[i];
                const p0 = { x: edge.ax, y: edge.ay };
                const p1 = { x: edge.bx, y: edge.by };
                const mx = (p0.x + p1.x) * 0.5;
                const my = (p0.y + p1.y) * 0.5;

                const ex = p1.x - p0.x;
                const ey = p1.y - p0.y;
                const edgeLen = Math.hypot(ex, ey) || 1;
                const tx = ex / edgeLen;
                const ty = ey / edgeLen;
                let nx = -ey / edgeLen;
                let ny = ex / edgeLen;
                // Choose the normal that points inward using multiple probes.
                const centroid = polygonPoints.reduce((acc, pt) => {
                    acc.x += pt.x;
                    acc.y += pt.y;
                    return acc;
                }, { x: 0, y: 0 });
                centroid.x /= polygonPoints.length;
                centroid.y /= polygonPoints.length;
                const probeDistances = [2, Math.max(4, fadePx * 0.2), Math.max(6, fadePx * 0.45)];
                const scoreNormal = (sx, sy) => {
                    let score = 0;
                    for (let k = 0; k < probeDistances.length; k++) {
                        const d = probeDistances[k];
                        if (Road._pointInPolygon(mx + sx * d, my + sy * d, polygonPoints)) {
                            score += 1;
                        }
                    }
                    return score;
                };
                const scoreA = scoreNormal(nx, ny);
                const scoreB = scoreNormal(-nx, -ny);
                if (scoreB > scoreA) {
                    nx = -nx;
                    ny = -ny;
                } else if (scoreA === scoreB) {
                    // Tie-break toward polygon centroid.
                    const toCenterX = centroid.x - mx;
                    const toCenterY = centroid.y - my;
                    if ((toCenterX * nx + toCenterY * ny) < 0) {
                        nx = -nx;
                        ny = -ny;
                    }
                }

                // Extend strip along tangent so fade width tracks interior shape
                // better near corners.
                const ext = fadePx * 1.5;
                const a0 = { x: p0.x - tx * ext, y: p0.y - ty * ext };
                const a1 = { x: p1.x + tx * ext, y: p1.y + ty * ext };
                const b0 = { x: a0.x + nx * fadePx, y: a0.y + ny * fadePx };
                const b1 = { x: a1.x + nx * fadePx, y: a1.y + ny * fadePx };

                ctx.save();
                ctx.globalCompositeOperation = 'destination-out';
                const grad = ctx.createLinearGradient(mx, my, mx + nx * fadePx, my + ny * fadePx);
                grad.addColorStop(0, 'rgba(0,0,0,1)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.moveTo(a0.x, a0.y);
                ctx.lineTo(a1.x, a1.y);
                ctx.lineTo(b1.x, b1.y);
                ctx.lineTo(b0.x, b0.y);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
            ctx.restore();
        }

        return PIXI.Texture.from(canvas);
    }

    static _getTextureForMaskAndPhase(mask, phaseX, phaseY, fillTexturePath = Road._defaultFillTexturePath) {
        const q = Math.max(1, Road._phaseQuantPx);
        const qx = Math.round(phaseX / q) * q;
        const qy = Math.round(phaseY / q) * q;
        const textureKey = (typeof fillTexturePath === 'string' && fillTexturePath.length > 0)
            ? fillTexturePath
            : Road._defaultFillTexturePath;
        const key = `${Road._textureCacheVersion}:${Road._edgeFadePx}:${q}:${textureKey}:${mask}:${qx}:${qy}`;
        if (!Road._textureCache.has(key) && Road._textureCache.size >= Road._maxTextureCacheEntries) {
            const firstKey = Road._textureCache.keys().next().value;
            if (firstKey !== undefined) {
                Road._textureCache.delete(firstKey);
            }
        }
        if (!Road._textureCache.has(key)) {
            Road._textureCache.set(key, Road._buildTextureForMask(mask, qx, qy, textureKey));
        }
        return Road._textureCache.get(key);
    }

    static clearRuntimeCaches(options = {}) {
        const destroyTextures = !!(options && options.destroyTextures);
        if (Road._textureCache && typeof Road._textureCache.forEach === 'function') {
            if (destroyTextures) {
                Road._textureCache.forEach(tex => {
                    if (tex && typeof tex.destroy === 'function') tex.destroy(true);
                });
            }
            Road._textureCache.clear();
        }
        if (Road._geometryCache && typeof Road._geometryCache.clear === 'function') {
            Road._geometryCache.clear();
        }
    }
    constructor(location, textures, map, options = {}) {
        // Create initial textures array (will be populated by updateTexture)
        const dynamicTextures = [PIXI.Texture.WHITE];
        
        super('road', location, 1, 1, dynamicTextures, map);
        this.blocksTile = false; // Pavement doesn't block movement
        this.isPassable = true; // Can be walked on
        this.visualRadius = 0.5;
        this.groundRadius = 0.5;
        this.pixiSprite.anchor.set(0.5, 0.5); // Center the sprite on the node
        this.pixiSprite.visible = true;
        this.visualHitbox = null;
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, this.groundRadius);
        this.width = 1;
        this.height = 1;
        this.renderZ = 0;
        this.fillTexturePath = (options && typeof options.fillTexturePath === 'string' && options.fillTexturePath.length > 0)
            ? options.fillTexturePath
            : Road._defaultFillTexturePath;
        // super() registers the object before road-specific flags are set.
        // Recount so this road is not treated as blocking.
        if (this.node && typeof this.node.recountBlockingObjects === 'function') {
            this.node.recountBlockingObjects();
        }
        
        // Generate the initial texture
        this.updateTexture();
        // Adjacent roads also need to update
        [1, 3, 5, 7, 9, 11].forEach(direction => {
            const neighbor = this.node.neighbors[direction];
            if (neighbor && neighbor.objects) {
                neighbor.objects.forEach(obj => {
                    if (obj.type === 'road' && typeof obj.updateTexture === 'function') {
                        obj.updateTexture();
                    }
                });
            }
        });
        if (location instanceof MapNode) {
            this.node = location;
        }
    }

    // Roads are intentionally non-flammable.
    ignite() {
        this.isOnFire = false;
        this.fireDuration = 0;
        if (this.fireSprite && this.fireSprite.parent) {
            this.fireSprite.parent.removeChild(this.fireSprite);
            this.fireSprite = null;
        }
    }

    removeFromNodes() {
        super.removeFromNodes();

        const node = this.getNode();
        const neighborNodes = node ? [1, 3, 5, 7, 9, 11]
            .map(direction => node.neighbors[direction])
            .filter(Boolean)
            : [];

        neighborNodes.forEach(neighbor => {
            if (neighbor && neighbor.objects) {
                neighbor.objects.forEach(obj => {
                    if (obj.type === 'road' && typeof obj.updateTexture === 'function') {
                        obj.updateTexture();
                    }
                });
            }
        });
    }
    
    updateTexture(neighborDirectionsOverride = null) {
        const neighbors = Array.isArray(neighborDirectionsOverride)
            ? neighborDirectionsOverride
            : Road._oddDirections.filter(direction => {
                const neighbor = this.node.neighbors[direction];
                return neighbor && neighbor.objects && neighbor.objects.some(obj => obj.type === 'road');
            });

        const mask = Road._getNeighborMask(neighbors);
        const { keptCorners, radius } = Road.getGeometryForNeighbors(neighbors);
        const repeat = Road._repeatWorldUnits;
        const offsetWorldX = ((this.x % repeat) + repeat) % repeat;
        const offsetWorldY = ((this.y % repeat) + repeat) % repeat;
        const repeatPx = repeat * Road._pixelsPerWorldUnit;
        const phaseX = (offsetWorldX / repeat) * repeatPx;
        const phaseY = (offsetWorldY / repeat) * repeatPx;
        const texture = Road._getTextureForMaskAndPhase(mask, phaseX, phaseY, this.fillTexturePath);
        if (texture) this.pixiSprite.texture = texture;

        const fillTexture = Road._getFillTexture(this.fillTexturePath);
        if (fillTexture && fillTexture.baseTexture && !fillTexture.baseTexture.valid) {
            fillTexture.baseTexture.once('loaded', () => {
                Road.clearRuntimeCaches();
                this.updateTexture(neighborDirectionsOverride);
            });
        }
        
        const hitboxCorners = keptCorners.map(pt => ({x: this.x + pt.x / radius / 2, y: this.y + pt.y / radius / 2}));
        this.visualHitbox = new PolygonHitbox(hitboxCorners);
        this.groundPlaneHitbox = new PolygonHitbox(hitboxCorners);
    }

    saveJson() {
        const data = super.saveJson();
        data.fillTexturePath = this.fillTexturePath || Road._defaultFillTexturePath;
        return data;
    }
}

// Ensure map generation can resolve these constructors across script files.
if (typeof globalThis !== "undefined") {
    globalThis.StaticObject = StaticObject;
    globalThis.Tree = Tree;
    globalThis.Playground = Playground;
    globalThis.Wall = Wall;
    globalThis.Road = Road;
}
