const placeableMetadataByCategory = new Map();
const placeableMetadataFetchPromises = new Map();

function normalizePlaceableRotationAxis(axis, category = null) {
    const value = (typeof axis === "string") ? axis.trim().toLowerCase() : "";
    if (value === "spatial" || value === "visual" || value === "none" || value === "ground") return value;
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

function normalizeDoorEventScript(value) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "";
}

function cloneCompositeLayers(layers) {
    if (!Array.isArray(layers)) return null;
    const out = layers
        .map(layer => ({
            name: String((layer && layer.name) || ""),
            uRegion: (Array.isArray(layer && layer.uRegion) && layer.uRegion.length >= 2)
                ? [Number(layer.uRegion[0]) || 0, Number(layer.uRegion[1]) || 1]
                : [0, 1]
        }))
        .filter(layer => Array.isArray(layer.uRegion) && layer.uRegion.length >= 2);
    return out.length > 0 ? out : null;
}

function resolveDoorCompositeLayersForState(layers, options = {}) {
    const normalized = cloneCompositeLayers(layers);
    if (!normalized || normalized.length === 0) return null;
    const leafOnly = !!(options && options.leafOnly);
    if (!leafOnly) return normalized;
    if (normalized.length >= 2) {
        return [normalized[1]];
    }
    return [normalized[0]];
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
    const remapLegacyPath = (value) => {
        if (typeof value !== "string" || value.length === 0) return value;
        if (/^\/assets\/images\/flowers\/.*\.jpg$/i.test(value)) {
            return value.replace(/\.jpg$/i, ".png");
        }
        if (/^\/assets\/images\/windows\/.*\.jpg$/i.test(value)) {
            return value.replace(/\.jpg$/i, ".png");
        }
        return value;
    };
    if (raw.startsWith("/")) return remapLegacyPath(raw);
    try {
        if (typeof window !== "undefined" && window.location && window.location.origin) {
            const resolved = new URL(raw, window.location.origin).pathname || raw;
            return remapLegacyPath(resolved);
        }
    } catch (_) {}
    return remapLegacyPath(raw);
}

function resolveCastsLosShadows(value, fallback = true) {
    if (typeof value === "boolean") return value;
    return !!fallback;
}

function normalizeLodTextures(spec, fallbackTexturePath = null) {
    if (!Array.isArray(spec)) return [];
    const out = [];
    spec.forEach(entry => {
        if (typeof entry === "string" && entry.length > 0) {
            out.push({ texturePath: normalizeTexturePathForMetadata(entry), maxDistance: Infinity });
            return;
        }
        if (!entry || typeof entry !== "object") return;
        const texturePath = (typeof entry.texturePath === "string" && entry.texturePath.length > 0)
            ? normalizeTexturePathForMetadata(entry.texturePath)
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
    const categoryDirByKey = {
        signs: 'signs',
        roof: 'roofs',
        walls: 'walls'
    };
    const dirName = categoryDirByKey[safeCategory] || safeCategory;
    const request = fetch(`/assets/images/${encodeURIComponent(dirName)}/items.json`, { cache: "no-cache" })
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

function collectWallSectionUnitsFromMap(mapRef) {
    if (!mapRef) return [];
    const out = [];
    const seen = new Set();
    const pushIfValid = (section) => {
        if (!section || section.gone || section.type !== "wallSection") return;
        if (seen.has(section)) return;
        const a = section.startPoint;
        const b = section.endPoint;
        if (!a || !b) return;
        if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return;
        seen.add(section);
        out.push(section);
    };

    if (Array.isArray(mapRef.objects)) {
        for (let i = 0; i < mapRef.objects.length; i++) {
            pushIfValid(mapRef.objects[i]);
        }
    }

    if (mapRef.nodes) {
        Object.keys(mapRef.nodes).forEach(xKey => {
            const col = mapRef.nodes[xKey];
            if (!col) return;
            Object.keys(col).forEach(yKey => {
                const node = col[yKey];
                if (!node || !Array.isArray(node.objects)) return;
                for (let i = 0; i < node.objects.length; i++) {
                    pushIfValid(node.objects[i]);
                }
            });
        });
    }

    return out;
}

function collectMountableWallSegments(mapRef) {
    const out = [];
    if (!mapRef) return out;

    const wallSections = collectWallSectionUnitsFromMap(mapRef);
    for (let i = 0; i < wallSections.length; i++) {
        const section = wallSections[i];
        const a = section.startPoint;
        const b = section.endPoint;
        out.push({
            type: "wallSection",
            source: section,
            groupId: Number.isInteger(section.id) ? Number(section.id) : null,
            ax: Number(a.x),
            ay: Number(a.y),
            bx: Number(b.x),
            by: Number(b.y),
            height: Math.max(0, Number(section.height) || 0),
            thickness: Math.max(0.001, Number(section.thickness) || 0.001)
        });
    }

    return out.filter(seg =>
        Number.isFinite(seg.ax) &&
        Number.isFinite(seg.ay) &&
        Number.isFinite(seg.bx) &&
        Number.isFinite(seg.by)
    );
}

function buildSegmentFaceProfile(segment, seedX, seedY, mapRef) {
    if (!segment || !mapRef) return null;
    const shortestDX = (fromX, toX) =>
        (typeof mapRef.shortestDeltaX === "function")
            ? mapRef.shortestDeltaX(fromX, toX)
            : (toX - fromX);
    const shortestDY = (fromY, toY) =>
        (typeof mapRef.shortestDeltaY === "function")
            ? mapRef.shortestDeltaY(fromY, toY)
            : (toY - fromY);

    if (segment.source && typeof segment.source.getWallProfile === "function") {
        const p = segment.source.getWallProfile();
        if (p && p.aLeft && p.bLeft && p.aRight && p.bRight) {
            const toSeed = (raw) => ({
                x: seedX + shortestDX(seedX, Number(raw.x)),
                y: seedY + shortestDY(seedY, Number(raw.y))
            });
            return {
                aLeft: toSeed(p.aLeft),
                bLeft: toSeed(p.bLeft),
                aRight: toSeed(p.aRight),
                bRight: toSeed(p.bRight)
            };
        }
    }

    const ax = seedX + shortestDX(seedX, Number(segment.ax));
    const ay = seedY + shortestDY(seedY, Number(segment.ay));
    const bx = seedX + shortestDX(seedX, Number(segment.bx));
    const by = seedY + shortestDY(seedY, Number(segment.by));
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (!(len > 1e-6)) return null;
    const nx = -dy / len;
    const ny = dx / len;
    const halfT = Math.max(0.0005, Number(segment.thickness) * 0.5);
    return {
        aLeft: { x: ax + nx * halfT, y: ay + ny * halfT },
        bLeft: { x: bx + nx * halfT, y: by + ny * halfT },
        aRight: { x: ax - nx * halfT, y: ay - ny * halfT },
        bRight: { x: bx - nx * halfT, y: by - ny * halfT }
    };
}

function collectMountableWallSegmentsForMountedId(mapRef, mountedId) {
    const out = [];
    if (!mapRef || !Number.isInteger(mountedId)) return out;

    const wallSectionClass = (typeof WallSectionUnit !== "undefined") ? WallSectionUnit : null;
    const section = (wallSectionClass && wallSectionClass._allSections instanceof Map)
        ? wallSectionClass._allSections.get(Number(mountedId))
        : null;
    if (
        section &&
        !section.gone &&
        section.startPoint &&
        section.endPoint &&
        Number.isFinite(section.startPoint.x) &&
        Number.isFinite(section.startPoint.y) &&
        Number.isFinite(section.endPoint.x) &&
        Number.isFinite(section.endPoint.y)
    ) {
        out.push({
            type: "wallSection",
            source: section,
            groupId: Number.isInteger(section.id) ? Number(section.id) : Number(mountedId),
            ax: Number(section.startPoint.x),
            ay: Number(section.startPoint.y),
            bx: Number(section.endPoint.x),
            by: Number(section.endPoint.y),
            height: Math.max(0, Number(section.height) || 0),
            thickness: Math.max(0.001, Number(section.thickness) || 0.001)
        });
    }

    if (out.length === 0 && Array.isArray(mapRef.objects)) {
        for (let i = 0; i < mapRef.objects.length; i++) {
            const obj = mapRef.objects[i];
            if (!obj || obj.gone) continue;
            if (obj.type === "wallSection" && Number.isInteger(obj.id) && Number(obj.id) === Number(mountedId)) {
                out.push({
                    type: "wallSection",
                    source: obj,
                    groupId: Number(obj.id),
                    ax: Number(obj.startPoint && obj.startPoint.x),
                    ay: Number(obj.startPoint && obj.startPoint.y),
                    bx: Number(obj.endPoint && obj.endPoint.x),
                    by: Number(obj.endPoint && obj.endPoint.y),
                    height: Math.max(0, Number(obj.height) || 0),
                    thickness: Math.max(0.001, Number(obj.thickness) || 0.001)
                });
            }
        }
    }

    return out.filter(seg =>
        Number.isFinite(seg.ax) &&
        Number.isFinite(seg.ay) &&
        Number.isFinite(seg.bx) &&
        Number.isFinite(seg.by)
    );
}

function resolveMountedWallThickness(item) {
    if (!item || !item.map) return null;
    if (!Number.isFinite(item.placementRotation)) return null;
    const anchor = getPlacedObjectAnchorWorldPoint(item) || { x: item.x, y: item.y };
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return null;
    const mapRef = item.map;
    const mountedId = Number.isInteger(item.mountedWallLineGroupId)
        ? Number(item.mountedWallLineGroupId)
        : (Number.isInteger(item.mountedSectionId) ? Number(item.mountedSectionId) : null);
    const wallSegments = Number.isInteger(mountedId)
        ? collectMountableWallSegmentsForMountedId(mapRef, mountedId)
        : [];

    // Primary path: if we know the mounted id, use that segment/group directly.
    if (Number.isInteger(mountedId)) {
        const groupWalls = wallSegments.filter(seg => Number.isInteger(seg.groupId) && Number(seg.groupId) === mountedId);
        if (groupWalls.length > 0) {
            let bestThickness = null;
            let bestDist = Infinity;
            for (let i = 0; i < groupWalls.length; i++) {
                const wall = groupWalls[i];
                const axRaw = Number(wall.ax);
                const ayRaw = Number(wall.ay);
                const bxRaw = Number(wall.bx);
                const byRaw = Number(wall.by);
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
                    bestThickness = Math.max(0.001, Number(wall.thickness));
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
    const walls = (wallSegments.length > 0)
        ? wallSegments
        : collectMountableWallSegments(mapRef);
    let bestThickness = null;
    let bestScore = Infinity;
    let bestWall = null;
    for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        if (!wall) continue;
        const ax = Number(wall.ax);
        const ay = Number(wall.ay);
        const bx = Number(wall.bx);
        const by = Number(wall.by);
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
        Number.isInteger(bestWall.groupId) &&
        item.mountedWallLineGroupId !== bestWall.groupId
    ) {
        const previousSection = Number.isInteger(item.mountedWallLineGroupId)
            ? Number(item.mountedWallLineGroupId)
            : null;
        item.mountedWallLineGroupId = bestWall.groupId;
        item.mountedSectionId = bestWall.groupId;
        if (typeof globalThis !== "undefined" && typeof globalThis.markWallSectionDirty === "function") {
            if (Number.isInteger(previousSection)) globalThis.markWallSectionDirty(previousSection);
            globalThis.markWallSectionDirty(bestWall.groupId);
        }
    }
    return Number.isFinite(bestThickness) ? bestThickness : null;
}

function getMountedWallFaceCentersForObject(item) {
    const mountedId = Number.isInteger(item && item.mountedWallLineGroupId)
        ? Number(item.mountedWallLineGroupId)
        : (Number.isInteger(item && item.mountedSectionId) ? Number(item.mountedSectionId) : null);
    if (!Number.isInteger(mountedId)) return null;
    const worldX = Number(item && item.x);
    const worldY = Number(item && item.y);
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;

    const mapRef = item && item.map ? item.map : null;
    const allSegments = collectMountableWallSegmentsForMountedId(mapRef, mountedId);
    const walls = allSegments.filter(seg => Number.isInteger(seg.groupId) && Number(seg.groupId) === mountedId);
    if (!Array.isArray(walls) || walls.length === 0) return null;

    let best = null;
    for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        if (!wall) continue;
        const profile = buildSegmentFaceProfile(wall, worldX, worldY, mapRef);
        if (!profile || !profile.aLeft || !profile.bLeft || !profile.aRight || !profile.bRight) continue;
        const left = closestPointOnSegment2D(
            worldX, worldY,
            Number(profile.aLeft.x), Number(profile.aLeft.y),
            Number(profile.bLeft.x), Number(profile.bLeft.y)
        );
        const right = closestPointOnSegment2D(
            worldX, worldY,
            Number(profile.aRight.x), Number(profile.aRight.y),
            Number(profile.bRight.x), Number(profile.bRight.y)
        );
        const score = Math.min(left.dist2, right.dist2);
        if (!best || score < best.score) {
            best = { left, right, score };
        }
    }
    if (!best) return null;

    const facingSign = Number.isFinite(item && item.mountedWallFacingSign)
        ? Number(item.mountedWallFacingSign)
        : 1;
    const frontRaw = (facingSign >= 0) ? best.left : best.right;
    const backRaw = (facingSign >= 0) ? best.right : best.left;
    let nx = frontRaw.x - backRaw.x;
    let ny = frontRaw.y - backRaw.y;
    const nLen = Math.hypot(nx, ny);
    if (!(nLen > 1e-6)) return null;
    nx /= nLen;
    ny /= nLen;
    const eps = 0.01;
    return {
        front: { x: frontRaw.x + nx * eps, y: frontRaw.y + ny * eps },
        back: { x: backRaw.x - nx * eps, y: backRaw.y - ny * eps }
    };
}

function chooseMountedWallFaceCenterForViewer(faceCenters, viewerPoint, mapRef = null) {
    if (!faceCenters || !faceCenters.front || !faceCenters.back || !viewerPoint) return null;
    const frontX = Number(faceCenters.front.x);
    const frontY = Number(faceCenters.front.y);
    const backX = Number(faceCenters.back.x);
    const backY = Number(faceCenters.back.y);
    const viewerX = Number(viewerPoint.x);
    const viewerY = Number(viewerPoint.y);
    if (!Number.isFinite(frontX) || !Number.isFinite(frontY) || !Number.isFinite(backX) || !Number.isFinite(backY) || !Number.isFinite(viewerX) || !Number.isFinite(viewerY)) {
        return null;
    }

    const dxFB = (mapRef && typeof mapRef.shortestDeltaX === "function")
        ? mapRef.shortestDeltaX(backX, frontX)
        : (frontX - backX);
    const dyFB = (mapRef && typeof mapRef.shortestDeltaY === "function")
        ? mapRef.shortestDeltaY(backY, frontY)
        : (frontY - backY);
    const nLen = Math.hypot(dxFB, dyFB);
    if (!(nLen > 1e-6)) return null;
    const nx = dxFB / nLen;
    const ny = dyFB / nLen;

    const midX = backX + dxFB * 0.5;
    const midY = backY + dyFB * 0.5;
    const dxMV = (mapRef && typeof mapRef.shortestDeltaX === "function")
        ? mapRef.shortestDeltaX(midX, viewerX)
        : (viewerX - midX);
    const dyMV = (mapRef && typeof mapRef.shortestDeltaY === "function")
        ? mapRef.shortestDeltaY(midY, viewerY)
        : (viewerY - midY);
    const signed = dxMV * nx + dyMV * ny;
    const eps = 1e-5;
    if (signed > eps) return "front";
    if (signed < -eps) return "back";

    const dxVF = (mapRef && typeof mapRef.shortestDeltaX === "function")
        ? mapRef.shortestDeltaX(viewerX, frontX)
        : (frontX - viewerX);
    const dyVF = (mapRef && typeof mapRef.shortestDeltaY === "function")
        ? mapRef.shortestDeltaY(viewerY, frontY)
        : (frontY - viewerY);
    const dxVB = (mapRef && typeof mapRef.shortestDeltaX === "function")
        ? mapRef.shortestDeltaX(viewerX, backX)
        : (backX - viewerX);
    const dyVB = (mapRef && typeof mapRef.shortestDeltaY === "function")
        ? mapRef.shortestDeltaY(viewerY, backY)
        : (backY - viewerY);
    const distFront = dxVF * dxVF + dyVF * dyVF;
    const distBack = dxVB * dxVB + dyVB * dyVB;
    return distFront <= distBack ? "front" : "back";
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
    static _depthBillboardState = null;
    static _groundBillboardState = null;
    static _depthBillboardVs = `
precision mediump float;
attribute vec3 aWorldPosition;
attribute vec2 aUvs;
uniform vec2 uScreenSize;
uniform vec2 uScreenJitter;
uniform vec2 uCameraWorld;
uniform float uViewScale;
uniform float uXyRatio;
uniform vec2 uDepthRange;
uniform vec2 uWorldSize;
uniform vec2 uWrapEnabled;
uniform vec2 uWrapAnchorWorld;
uniform float uZOffset;
varying vec2 vUvs;
varying float vWorldZ;
void main(void) {
    float anchorDx = uWrapAnchorWorld.x - uCameraWorld.x;
    float anchorDy = uWrapAnchorWorld.y - uCameraWorld.y;
    if (uWrapEnabled.x > 0.5 && uWorldSize.x > 0.0) {
        anchorDx = mod(anchorDx + 0.5 * uWorldSize.x, uWorldSize.x);
        if (anchorDx < 0.0) anchorDx += uWorldSize.x;
        anchorDx -= 0.5 * uWorldSize.x;
    }
    if (uWrapEnabled.y > 0.5 && uWorldSize.y > 0.0) {
        anchorDy = mod(anchorDy + 0.5 * uWorldSize.y, uWorldSize.y);
        if (anchorDy < 0.0) anchorDy += uWorldSize.y;
        anchorDy -= 0.5 * uWorldSize.y;
    }
    float localDx = aWorldPosition.x - uWrapAnchorWorld.x;
    float localDy = aWorldPosition.y - uWrapAnchorWorld.y;
    float camDx = anchorDx + localDx;
    float camDy = anchorDy + localDy;
    float camDz = aWorldPosition.z;
    float sx = max(1.0, uScreenSize.x);
    float sy = max(1.0, uScreenSize.y);
    float screenX = camDx * uViewScale;
    float screenY = (camDy - camDz) * uViewScale * uXyRatio;
    float depthMetric = camDy + camDz;
    float farMetric = uDepthRange.x;
    float invSpan = max(1e-6, uDepthRange.y);
    float nd = clamp((farMetric - depthMetric) * invSpan, 0.0, 1.0);
    vec2 clip = vec2(
        (screenX / sx) * 2.0 - 1.0,
        1.0 - (screenY / sy) * 2.0
    );
    clip += vec2(
        (uScreenJitter.x / sx) * 2.0,
        -(uScreenJitter.y / sy) * 2.0
    );
    gl_Position = vec4(clip, nd * 2.0 - 1.0 + (uZOffset * 0.001), 1.0);
    vUvs = aUvs;
    vWorldZ = aWorldPosition.z;
}
`;
    static _depthBillboardFs = `
precision mediump float;
varying vec2 vUvs;
varying float vWorldZ;
uniform float uZOffset;
uniform sampler2D uSampler;
uniform vec4 uTint;
uniform float uAlphaCutoff;
uniform float uClipMinZ;
void main(void) {
    vec4 tex = texture2D(uSampler, vUvs) * uTint;
    if (vWorldZ < uClipMinZ) discard;
    if (tex.a < uAlphaCutoff) discard;
    gl_FragColor = tex;
}
`;

    static ensureDepthBillboardState(pixiRef) {
        if (!pixiRef) return null;
        if (StaticObject._depthBillboardState) return StaticObject._depthBillboardState;
        const state = new pixiRef.State();
        state.depthTest = true;
        state.depthMask = true;
        state.blend = false;
        state.culling = false;
        StaticObject._depthBillboardState = state;
        return state;
    }

    static ensureGroundBillboardState(pixiRef) {
        if (!pixiRef) return null;
        if (StaticObject._groundBillboardState) return StaticObject._groundBillboardState;
        const state = new pixiRef.State();
        state.depthTest = false;
        state.depthMask = false;
        state.blend = true;
        state.culling = false;
        StaticObject._groundBillboardState = state;
        return state;
    }

    constructor(type, location, width, height, textures, map) {
        this.type = type;
        this.map = map;
        this.width = width;
        this.height = height;
        this.blocksTile = true;
        this.castsLosShadows = true;
        this.flammable = true;
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

        this.animatedFrameCountX = 1;
        this.animatedFrameCountY = 1;
        this.animatedFps = 0;
        this._animatedFrames = null;
        this._animatedFrameIndex = 0;
        this._animatedFrameProgress = 0;
        this._animatedLastFrameCount = null;
        this._animatedFrameSignature = "";

        this.visualHitbox = new CircleHitbox(this.x, this.y, this.visualRadius);
        this.groundPlaneHitbox = new CircleHitbox(this.x, this.y, this.groundRadius);

        
        // Default properties (can be overridden in subclasses)
        this.hp = 100;
        this.isOnFire = false;
        this.burned = false;
    }

    configureSpriteAnimation(metaEntry = null) {
        const meta = (metaEntry && typeof metaEntry === "object") ? metaEntry : {};
        const frameCountObj = (meta.framecount && typeof meta.framecount === "object")
            ? meta.framecount
            : ((meta.frameCount && typeof meta.frameCount === "object") ? meta.frameCount : null);
        const frameCountX = Number.isFinite(meta.framecount_x)
            ? Number(meta.framecount_x)
            : (Number.isFinite(meta.frameCountX)
                ? Number(meta.frameCountX)
                : (Number.isFinite(frameCountObj && frameCountObj.x) ? Number(frameCountObj.x) : 1));
        const frameCountY = Number.isFinite(meta.framecount_y)
            ? Number(meta.framecount_y)
            : (Number.isFinite(meta.frameCountY)
                ? Number(meta.frameCountY)
                : (Number.isFinite(frameCountObj && frameCountObj.y) ? Number(frameCountObj.y) : 1));
        const animatedFps = Number.isFinite(meta.animated_fps)
            ? Number(meta.animated_fps)
            : (Number.isFinite(meta.animatedFps) ? Number(meta.animatedFps) : 0);

        this.animatedFrameCountX = Math.max(1, Math.floor(frameCountX) || 1);
        this.animatedFrameCountY = Math.max(1, Math.floor(frameCountY) || 1);
        this.animatedFps = Math.max(0, Number(animatedFps) || 0);
        this._animatedFrameProgress = 0;
        this._animatedLastFrameCount = null;

        const animationEnabled = this.animatedFps > 0 && (this.animatedFrameCountX > 1 || this.animatedFrameCountY > 1);
        if (!animationEnabled) {
            this._animatedFrames = null;
            this._animatedFrameIndex = 0;
            this._animatedFrameSignature = "";
            const sprite = this.pixiSprite;
            const canWriteSpriteTexture = !!(
                sprite &&
                !sprite.destroyed &&
                sprite.transform &&
                sprite.scale
            );
            if (canWriteSpriteTexture) {
                try {
                    if (typeof this.texturePath === "string" && this.texturePath.length > 0) {
                        sprite.texture = PIXI.Texture.from(this.texturePath);
                    } else if (sprite.texture && sprite.texture.baseTexture) {
                        sprite.texture = new PIXI.Texture(sprite.texture.baseTexture);
                    }
                } catch (_err) {
                    // Async metadata may resolve after sprite teardown; ignore safely.
                }
            }
            return;
        }

        this.rebuildAnimatedSpriteFrames(true);
    }

    rebuildAnimatedSpriteFrames(forceRebuild = false) {
        if (!this.pixiSprite || !this.pixiSprite.texture) return null;
        const fx = Math.max(1, Math.floor(this.animatedFrameCountX) || 1);
        const fy = Math.max(1, Math.floor(this.animatedFrameCountY) || 1);
        if (fx <= 1 && fy <= 1) {
            this._animatedFrames = null;
            this._animatedFrameIndex = 0;
            return null;
        }
        const baseTexture = this.pixiSprite.texture.baseTexture;
        if (!baseTexture) return null;
        const baseW = Number(baseTexture.realWidth || baseTexture.width || 0);
        const baseH = Number(baseTexture.realHeight || baseTexture.height || 0);
        if (!(baseW > 0) || !(baseH > 0)) return null;

        const signature = [
            String(baseTexture.resource && baseTexture.resource.url ? baseTexture.resource.url : ""),
            baseW,
            baseH,
            fx,
            fy
        ].join("|");
        if (!forceRebuild && this._animatedFrames && this._animatedFrames.length > 0 && this._animatedFrameSignature === signature) {
            return this._animatedFrames;
        }

        const frameW = baseW / fx;
        const frameH = baseH / fy;
        if (!(frameW > 0) || !(frameH > 0)) return null;
        const frames = [];
        for (let row = 0; row < fy; row++) {
            for (let col = 0; col < fx; col++) {
                const rect = new PIXI.Rectangle(col * frameW, row * frameH, frameW, frameH);
                frames.push(new PIXI.Texture(baseTexture, rect));
            }
        }
        if (frames.length === 0) return null;

        this._animatedFrames = frames;
        this._animatedFrameSignature = signature;
        this._animatedFrameIndex = ((this._animatedFrameIndex % frames.length) + frames.length) % frames.length;
        this.pixiSprite.texture = frames[this._animatedFrameIndex];
        return this._animatedFrames;
    }

    updateSpriteAnimation() {
        const fps = Math.max(0, Number(this.animatedFps) || 0);
        if (!(fps > 0)) return;
        if (Math.max(1, this.animatedFrameCountX || 1) <= 1 && Math.max(1, this.animatedFrameCountY || 1) <= 1) return;
        const frames = this.rebuildAnimatedSpriteFrames();
        if (!Array.isArray(frames) || frames.length <= 1 || !this.pixiSprite) return;

        const currentFrameCount = Number.isFinite(frameCount) ? Number(frameCount) : 0;
        if (!Number.isFinite(this._animatedLastFrameCount)) {
            this._animatedLastFrameCount = currentFrameCount;
            this.pixiSprite.texture = frames[this._animatedFrameIndex];
            return;
        }
        const deltaFrames = Math.max(0, currentFrameCount - this._animatedLastFrameCount);
        this._animatedLastFrameCount = currentFrameCount;
        if (deltaFrames <= 0) {
            this.pixiSprite.texture = frames[this._animatedFrameIndex];
            return;
        }
        const simFps = Math.max(1, Number(frameRate) || 30);
        this._animatedFrameProgress += deltaFrames * (fps / simFps);
        const frameAdvance = Math.floor(this._animatedFrameProgress);
        if (frameAdvance > 0) {
            this._animatedFrameProgress -= frameAdvance;
            this._animatedFrameIndex = (this._animatedFrameIndex + frameAdvance) % frames.length;
        }
        this.pixiSprite.texture = frames[this._animatedFrameIndex];
    }

    ensureDepthBillboardMesh(pixiRef = null, alphaCutoff = 0.08, options = {}) {
        const pixi = pixiRef || ((typeof PIXI !== "undefined") ? PIXI : null);
        if (!pixi) return null;
        const category = (typeof this.category === "string") ? this.category.trim().toLowerCase() : "";
        const hasMountedWallTarget = !!(
            Number.isInteger(this.mountedWallSectionUnitId) ||
            Number.isInteger(this.mountedWallLineGroupId) ||
            Number.isInteger(this.mountedSectionId)
        );
        const forceSinglePlane = !!(options && options.forceSinglePlane);
        const isGroundRotation = (this.rotationAxis === "ground");
        const useDualWallPlanes = !!(
            !forceSinglePlane &&
            this &&
            this.rotationAxis === "spatial" &&
            hasMountedWallTarget &&
            (category === "windows" || category === "doors" || this.type === "window" || this.type === "door")
        );
        const desiredMode = useDualWallPlanes ? "dual" : (isGroundRotation ? "ground" : "single");
        if (this._depthBillboardMesh && !this._depthBillboardMesh.destroyed && this._depthBillboardMeshMode === desiredMode) {
            return this._depthBillboardMesh;
        }
        if (this._depthBillboardMesh && typeof this._depthBillboardMesh.destroy === "function") {
            if (this._depthBillboardMesh.parent) this._depthBillboardMesh.parent.removeChild(this._depthBillboardMesh);
            this._depthBillboardMesh.destroy({ children: false, texture: false, baseTexture: false });
            this._depthBillboardMesh = null;
            this._depthBillboardWorldPositions = null;
            this._depthBillboardLastSignature = "";
        }
        const state = isGroundRotation
            ? StaticObject.ensureGroundBillboardState(pixi)
            : StaticObject.ensureDepthBillboardState(pixi);
        if (!state) return null;
        const positionsVertexCount = useDualWallPlanes ? 24 : 12;
        const uvs = useDualWallPlanes
            ? new Float32Array([
                0, 1, 1, 1, 1, 0, 0, 0,
                1, 1, 0, 1, 0, 0, 1, 0
            ])
            : new Float32Array([
                0, 1,
                1, 1,
                1, 0,
                0, 0
            ]);
        const indices = useDualWallPlanes
            ? new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
            : new Uint16Array([0, 1, 2, 0, 2, 3]);
        const geometry = new pixi.Geometry()
            .addAttribute("aWorldPosition", new Float32Array(positionsVertexCount), 3)
            .addAttribute("aUvs", uvs, 2)
            .addIndex(indices);
        const shader = pixi.Shader.from(StaticObject._depthBillboardVs, StaticObject._depthBillboardFs, {
            uScreenSize: new Float32Array([1, 1]),
            uScreenJitter: new Float32Array([0, 0]),
            uCameraWorld: new Float32Array([0, 0]),
            uViewScale: 1,
            uXyRatio: 1,
            uDepthRange: new Float32Array([0, 1]),
            uWorldSize: new Float32Array([0, 0]),
            uWrapEnabled: new Float32Array([0, 0]),
            uWrapAnchorWorld: new Float32Array([0, 0]),
            uTint: new Float32Array([1, 1, 1, 1]),
            uAlphaCutoff: Number.isFinite(alphaCutoff) ? Number(alphaCutoff) : 0.08,
            uClipMinZ: -1000000,
            uZOffset: 0.0,
            uSampler: pixi.Texture.WHITE
        });
        const mesh = new pixi.Mesh(geometry, shader, state, pixi.DRAW_MODES.TRIANGLES);
        mesh.name = `${String(this.type || "staticObject")}DepthBillboard`;
        mesh.interactive = false;
        mesh.roundPixels = true;
        mesh.visible = false;
        this._depthBillboardWorldPositions = geometry.getBuffer("aWorldPosition").data;
        this._depthBillboardLastSignature = "";
        this._depthBillboardLastUvSignature = "";
        this._depthBillboardMeshMode = desiredMode;
        this._depthBillboardMesh = mesh;
        return mesh;
    }

    static _setCompositeLayerUvs(mesh, texture, uRegion, useDualWallPlanes = false) {
        if (!mesh || !mesh.geometry || !texture || !texture.baseTexture) return false;
        const uvBuffer = mesh.geometry.getBuffer("aUvs");
        if (!uvBuffer) return false;

        const baseW = Number(texture.baseTexture.realWidth || texture.baseTexture.width || 0);
        const baseH = Number(texture.baseTexture.realHeight || texture.baseTexture.height || 0);
        if (!(baseW > 0) || !(baseH > 0)) return false;

        const frame = texture.frame || new PIXI.Rectangle(0, 0, baseW, baseH);
        
        let localU0 = 0, localU1 = 1;
        if (Array.isArray(uRegion) && uRegion.length >= 2) {
            localU0 = Number(uRegion[0]) || 0;
            localU1 = Number(uRegion[1]) || 1;
        }

        const uFw = frame.width;
        let u0 = (frame.x + localU0 * uFw) / baseW;
        let u1 = (frame.x + localU1 * uFw) / baseW;

        const v0 = Number(frame.y) / baseH;
        const v1 = (Number(frame.y) + Number(frame.height)) / baseH;

        if (useDualWallPlanes) {
            uvBuffer.data = new Float32Array([
                u0, v1, u1, v1, u1, v0, u0, v0,
                u1, v1, u0, v1, u0, v0, u1, v0
            ]);
        } else {
            uvBuffer.data = new Float32Array([
                u0, v1, u1, v1, u1, v0, u0, v0
            ]);
        }
        uvBuffer.update();
        return true;
    }

    _ensureCompositeUnderlayMesh(useDualWallPlanes, forceSinglePlane, alphaCutoff = 0.08) {
        const pixi = typeof PIXI !== "undefined" ? PIXI : null;
        if (!pixi) return null;
        
        const mode = useDualWallPlanes ? "dual" : "single";
        if (this._compositeUnderlayMesh && !this._compositeUnderlayMesh.destroyed && this._compositeUnderlayMeshMode === mode) {
            return this._compositeUnderlayMesh;
        }

        if (this._compositeUnderlayMesh && typeof this._compositeUnderlayMesh.destroy === "function") {
            if (this._compositeUnderlayMesh.parent) this._compositeUnderlayMesh.parent.removeChild(this._compositeUnderlayMesh);
            this._compositeUnderlayMesh.destroy({ children: false, texture: false });
            this._compositeUnderlayMesh = null;
        }

        const state = StaticObject.ensureDepthBillboardState(pixi);
        if (!state) return null;

        const positionsVertexCount = useDualWallPlanes ? 24 : 12;
        const uvs = useDualWallPlanes
            ? new Float32Array([0,1, 1,1, 1,0, 0,0, 1,1, 0,1, 0,0, 1,0])
            : new Float32Array([0,1, 1,1, 1,0, 0,0]);
            
        const indices = useDualWallPlanes
            ? new Uint16Array([0,1,2, 0,2,3, 4,5,6, 4,6,7])
            : new Uint16Array([0,1,2, 0,2,3]);

        this._compositeUnderlayPositions = new Float32Array(positionsVertexCount);

        const geometry = new pixi.Geometry()
            .addAttribute("aWorldPosition", this._compositeUnderlayPositions, 3)
            .addAttribute("aUvs", uvs, 2)
            .addIndex(indices);

        const shader = pixi.Shader.from(StaticObject._depthBillboardVs, StaticObject._depthBillboardFs, {
            uScreenSize: new Float32Array([1, 1]),
            uScreenJitter: new Float32Array([0, 0]),
            uCameraWorld: new Float32Array([0, 0]),
            uViewScale: 1,
            uXyRatio: 1,
            uDepthRange: new Float32Array([0, 1]),
            uWorldSize: new Float32Array([0, 0]),
            uWrapEnabled: new Float32Array([0, 0]),
            uWrapAnchorWorld: new Float32Array([0, 0]),
            uTint: new Float32Array([1, 1, 1, 1]),
            uAlphaCutoff: Number.isFinite(alphaCutoff) ? Number(alphaCutoff) : 0.08,
            uClipMinZ: -1000000,
            uZOffset: 0.0,
            uSampler: pixi.Texture.WHITE
        });

        const mesh = new pixi.Mesh(geometry, shader, state, pixi.DRAW_MODES.TRIANGLES);
        mesh.visible = false;
        
        if (this.map && this.map.game && this.map.game.layers && this.map.game.layers.depthLayer) {
            this.map.game.layers.depthLayer.addChildAt(mesh, 0);
        }
        
        this._compositeUnderlayMeshMode = mode;
        this._compositeUnderlayMesh = mesh;
        return mesh;
    }

    updateDepthBillboardUvsForTexture(mesh, texture, useDualWallPlanes = false) {
        if (!mesh || !mesh.geometry || !texture || !texture.baseTexture) return false;
        const uvBuffer = mesh.geometry.getBuffer("aUvs");
        if (!uvBuffer) return false;
        const baseTexture = texture.baseTexture;
        const baseW = Number(baseTexture.realWidth || baseTexture.width || 0);
        const baseH = Number(baseTexture.realHeight || baseTexture.height || 0);
        if (!(baseW > 0) || !(baseH > 0)) return false;
        const frame = texture.frame || new PIXI.Rectangle(0, 0, baseW, baseH);
        const u0 = Number(frame.x) / baseW;
        const v0 = Number(frame.y) / baseH;
        const u1 = (Number(frame.x) + Number(frame.width)) / baseW;
        const v1 = (Number(frame.y) + Number(frame.height)) / baseH;
        const mode = useDualWallPlanes ? "dual" : "single";
        const uvSignature = `${mode}|${u0.toFixed(6)}|${v0.toFixed(6)}|${u1.toFixed(6)}|${v1.toFixed(6)}`;
        if (this._depthBillboardLastUvSignature === uvSignature) return true;

        if (useDualWallPlanes) {
            uvBuffer.data = new Float32Array([
                u0, v1,
                u1, v1,
                u1, v0,
                u0, v0,
                u1, v1,
                u0, v1,
                u0, v0,
                u1, v0
            ]);
        } else {
            uvBuffer.data = new Float32Array([
                u0, v1,
                u1, v1,
                u1, v0,
                u0, v0
            ]);
        }
        uvBuffer.update();
        this._depthBillboardLastUvSignature = uvSignature;
        return true;
    }

    updateDepthBillboardMesh(ctx = null, camera = null, options = {}) {
        const hideDepthMesh = () => {
            if (this._depthBillboardMesh) this._depthBillboardMesh.visible = false;
        };
        const sprite = this.pixiSprite;
        const category = (typeof this.category === "string") ? this.category.trim().toLowerCase() : "";
        const hasMountedWallTarget = !!(
            Number.isInteger(this.mountedWallSectionUnitId) ||
            Number.isInteger(this.mountedWallLineGroupId) ||
            Number.isInteger(this.mountedSectionId)
        );
        const wantsDualWallPlanes = !!(
            this &&
            this.rotationAxis === "spatial" &&
            hasMountedWallTarget &&
            (category === "windows" || category === "doors" || this.type === "window" || this.type === "door")
        );
        const mazeMode = !!(options && options.mazeMode);
        let faceCenters = null;
        let useDualWallPlanes = wantsDualWallPlanes;
        let mazeKeepSide = null;
        if (useDualWallPlanes) {
            const explicitFaceCenters = (
                this &&
                this.depthBillboardFaceCenters &&
                this.depthBillboardFaceCenters.front &&
                this.depthBillboardFaceCenters.back
            ) ? this.depthBillboardFaceCenters : null;
            if (
                explicitFaceCenters &&
                Number.isFinite(explicitFaceCenters.front.x) &&
                Number.isFinite(explicitFaceCenters.front.y) &&
                Number.isFinite(explicitFaceCenters.back.x) &&
                Number.isFinite(explicitFaceCenters.back.y)
            ) {
                faceCenters = {
                    front: {
                        x: Number(explicitFaceCenters.front.x),
                        y: Number(explicitFaceCenters.front.y)
                    },
                    back: {
                        x: Number(explicitFaceCenters.back.x),
                        y: Number(explicitFaceCenters.back.y)
                    }
                };
            } else {
                faceCenters = getMountedWallFaceCentersForObject(this);
            }
            if (!faceCenters) {
                useDualWallPlanes = false;
            } else {
                const forcedSide = (options && typeof options.forceMountedWallSide === "string")
                    ? options.forceMountedWallSide.trim().toLowerCase()
                    : "";
                if ((forcedSide === "front" || forcedSide === "back") && faceCenters[forcedSide]) {
                    mazeKeepSide = forcedSide;
                } else if (forcedSide === "center") {
                    mazeKeepSide = "center";
                }
                if (mazeMode) {
                    const playerRef = (options && options.player && Number.isFinite(options.player.x) && Number.isFinite(options.player.y))
                        ? { x: Number(options.player.x), y: Number(options.player.y) }
                        : ((typeof globalThis !== "undefined" && globalThis.wizard && Number.isFinite(globalThis.wizard.x) && Number.isFinite(globalThis.wizard.y))
                            ? { x: Number(globalThis.wizard.x), y: Number(globalThis.wizard.y) }
                            : null);
                    const selectedSide = chooseMountedWallFaceCenterForViewer(faceCenters, playerRef, this.map || (ctx && ctx.map) || null);
                    if (!mazeKeepSide && selectedSide && faceCenters[selectedSide]) {
                        mazeKeepSide = selectedSide;
                    }
                }
            }
        }
        const fallbackTexture = (typeof this.texturePath === "string" && this.texturePath.length > 0)
            ? PIXI.Texture.from(this.texturePath)
            : null;
        if (!sprite && !fallbackTexture) {
            hideDepthMesh();
            return null;
        }
        if (!useDualWallPlanes && (!sprite || !sprite.texture)) {
            hideDepthMesh();
            return null;
        }
        const cam = camera || null;
        if (!cam) {
            hideDepthMesh();
            return null;
        }
        const mesh = this.ensureDepthBillboardMesh(null, options.alphaCutoff, {
            forceSinglePlane: !useDualWallPlanes
        });
        if (!mesh || !mesh.shader || !mesh.shader.uniforms) {
            hideDepthMesh();
            return null;
        }
        const sourceTexture = (sprite && sprite.texture) ? sprite.texture : (fallbackTexture || PIXI.Texture.WHITE);
        if (sourceTexture) {
            StaticObject.prototype.updateDepthBillboardUvsForTexture.call(this, mesh, sourceTexture, useDualWallPlanes);
        }
        const viewScale = Math.max(1e-6, Math.abs(Number(cam.viewscale) || 1));
        const xyRatio = Math.max(1e-6, Math.abs(Number(cam.xyratio) || 1));
        const worldX = Number.isFinite(this.x) ? Number(this.x) : 0;
        const worldY = Number.isFinite(this.y) ? Number(this.y) : 0;
        const worldZ = Number.isFinite(this.z) ? Number(this.z) : 0;
        const doorHitShakeOffset = (
            !this.isOpen &&
            !this._doorLockedOpen &&
            !this.isFallenDoorEffect &&
            Array.isArray(this.compositeLayers) &&
            this.compositeLayers.length >= 2 &&
            typeof this.getDoorHitShakeScreenOffset === "function"
        ) ? this.getDoorHitShakeScreenOffset() : null;
        const shakeDx = (doorHitShakeOffset && Number.isFinite(doorHitShakeOffset.x)) ? Number(doorHitShakeOffset.x) : 0;
        const shakeDy = (doorHitShakeOffset && Number.isFinite(doorHitShakeOffset.y)) ? Number(doorHitShakeOffset.y) : 0;
        const hasDoorHitShake = Math.abs(shakeDx) > 1e-3 || Math.abs(shakeDy) > 1e-3;

        let signature = "";
        if (useDualWallPlanes) {
            const width = Math.max(0.01, Number.isFinite(this.width) ? Number(this.width) : 1);
            const height = Math.max(0.01, Number.isFinite(this.height) ? Number(this.height) : 1);
            const verticalWorldHeight = height / Math.max(0.0001, xyRatio);
            const anchorX = Number.isFinite(this.placeableAnchorX) ? Number(this.placeableAnchorX) : 0.5;
            const anchorY = Number.isFinite(this.placeableAnchorY) ? Number(this.placeableAnchorY) : 1;
            const angleDeg = Number.isFinite(this.placementRotation) ? Number(this.placementRotation) : 0;
            const theta = angleDeg * (Math.PI / 180);
            const axisX = Math.cos(theta);
            const axisY = Math.sin(theta);
            const halfWidth = width * 0.5;
            const alongOffset = (anchorX - 0.5) * width;
            const zBottom = worldZ - ((1 - anchorY) * verticalWorldHeight);
            const zTop = zBottom + verticalWorldHeight;
            const centerWithAnchor = (cx, cy) => ({
                x: cx - axisX * alongOffset,
                y: cy - axisY * alongOffset
            });
            const frontBase = centerWithAnchor(Number(faceCenters.front.x), Number(faceCenters.front.y));
            const backBase = centerWithAnchor(Number(faceCenters.back.x), Number(faceCenters.back.y));
            let frontBL = { x: frontBase.x - axisX * halfWidth, y: frontBase.y - axisY * halfWidth, z: zBottom };
            let frontBR = { x: frontBase.x + axisX * halfWidth, y: frontBase.y + axisY * halfWidth, z: zBottom };
            let frontTR = { x: frontBR.x, y: frontBR.y, z: zTop };
            let frontTL = { x: frontBL.x, y: frontBL.y, z: zTop };
            let backBL = { x: backBase.x - axisX * halfWidth, y: backBase.y - axisY * halfWidth, z: zBottom };
            let backBR = { x: backBase.x + axisX * halfWidth, y: backBase.y + axisY * halfWidth, z: zBottom };
            let backTR = { x: backBR.x, y: backBR.y, z: zTop };
            let backTL = { x: backBL.x, y: backBL.y, z: zTop };

            if (mazeKeepSide === "center") {
                const centerBL = { x: (frontBL.x + backBL.x) * 0.5, y: (frontBL.y + backBL.y) * 0.5, z: zBottom };
                const centerBR = { x: (frontBR.x + backBR.x) * 0.5, y: (frontBR.y + backBR.y) * 0.5, z: zBottom };
                const centerTR = { x: (frontTR.x + backTR.x) * 0.5, y: (frontTR.y + backTR.y) * 0.5, z: zTop };
                const centerTL = { x: (frontTL.x + backTL.x) * 0.5, y: (frontTL.y + backTL.y) * 0.5, z: zTop };
                frontBL = { ...centerBL };
                frontBR = { ...centerBR };
                frontTR = { ...centerTR };
                frontTL = { ...centerTL };
                backBL = { ...centerBL };
                backBR = { ...centerBR };
                backTR = { ...centerTR };
                backTL = { ...centerTL };
            } else if (mazeKeepSide === "front") {
                backBL = { ...frontBL };
                backBR = { ...frontBR };
                backTR = { ...frontTR };
                backTL = { ...frontTL };
            } else if (mazeKeepSide === "back") {
                frontBL = { ...backBL };
                frontBR = { ...backBR };
                frontTR = { ...backTR };
                frontTL = { ...backTL };
            }
            signature = [
                frontBL.x, frontBL.y, frontBR.x, frontBR.y,
                backBL.x, backBL.y, backBR.x, backBR.y,
                zBottom, zTop, width, verticalWorldHeight, angleDeg,
                mazeKeepSide || "both"
            ].map(v => Number(v).toFixed(4)).join("|");
            if (signature !== this._depthBillboardLastSignature && this._depthBillboardWorldPositions) {
                const positions = this._depthBillboardWorldPositions;
                positions[0] = frontBL.x; positions[1] = frontBL.y; positions[2] = frontBL.z;
                positions[3] = frontBR.x; positions[4] = frontBR.y; positions[5] = frontBR.z;
                positions[6] = frontTR.x; positions[7] = frontTR.y; positions[8] = frontTR.z;
                positions[9] = frontTL.x; positions[10] = frontTL.y; positions[11] = frontTL.z;
                positions[12] = backBL.x; positions[13] = backBL.y; positions[14] = backBL.z;
                positions[15] = backBR.x; positions[16] = backBR.y; positions[17] = backBR.z;
                positions[18] = backTR.x; positions[19] = backTR.y; positions[20] = backTR.z;
                positions[21] = backTL.x; positions[22] = backTL.y; positions[23] = backTL.z;
                mesh.geometry.getBuffer("aWorldPosition").update();
                this._depthBillboardLastSignature = signature;
            }
        } else {
            const anchorX = (sprite.anchor && Number.isFinite(sprite.anchor.x)) ? Number(sprite.anchor.x) : 0.5;
            const anchorY = (sprite.anchor && Number.isFinite(sprite.anchor.y)) ? Number(sprite.anchor.y) : 1;
            const worldWidth = Math.max(0.01, Math.abs(Number(sprite.width) || 0) / viewScale);
            const worldHeightZ = Math.max(0.01, Math.abs(Number(sprite.height) || 0) / (viewScale * xyRatio));
            const bottomZ = worldZ - (1 - anchorY) * worldHeightZ;
            const topZ = worldZ + anchorY * worldHeightZ;
            const isSpatialDoorOrWindow = !!(
                this.rotationAxis === "spatial" &&
                (category === "windows" || category === "doors" || this.type === "window" || this.type === "door")
            );
            if (isSpatialDoorOrWindow) {
                const angleDeg = Number.isFinite(this.placementRotation) ? Number(this.placementRotation) : 0;
                const theta = angleDeg * (Math.PI / 180);
                const axisX = Math.cos(theta);
                const axisY = Math.sin(theta);
                const halfWidth = worldWidth * 0.5;
                const alongOffset = (anchorX - 0.5) * worldWidth;
                const baseCenterX = worldX - axisX * alongOffset;
                const baseCenterY = worldY - axisY * alongOffset;
                const bl = { x: baseCenterX - axisX * halfWidth, y: baseCenterY - axisY * halfWidth, z: bottomZ };
                const br = { x: baseCenterX + axisX * halfWidth, y: baseCenterY + axisY * halfWidth, z: bottomZ };
                const tr = { x: br.x, y: br.y, z: topZ };
                const tl = { x: bl.x, y: bl.y, z: topZ };
                signature = [
                    bl.x, bl.y, br.x, br.y, bottomZ, topZ, worldWidth, worldHeightZ, angleDeg
                ].map(v => Number(v).toFixed(4)).join("|");
                if (signature !== this._depthBillboardLastSignature && this._depthBillboardWorldPositions) {
                    const positions = this._depthBillboardWorldPositions;
                    positions[0] = bl.x; positions[1] = bl.y; positions[2] = bl.z;
                    positions[3] = br.x; positions[4] = br.y; positions[5] = br.z;
                    positions[6] = tr.x; positions[7] = tr.y; positions[8] = tr.z;
                    positions[9] = tl.x; positions[10] = tl.y; positions[11] = tl.z;
                    mesh.geometry.getBuffer("aWorldPosition").update();
                    this._depthBillboardLastSignature = signature;
                }
            } else if (this.rotationAxis === "ground") {
                // Ground plane quad: sprite lies flat on the XY ground plane at constant Z.
                // Rotation spins the quad around the Z axis at the object's world position.
                const worldDepthY = Math.max(0.01, Math.abs(Number(sprite.height) || 0) / viewScale);
                const angleDeg = Number.isFinite(this.placementRotation) ? Number(this.placementRotation) : 0;
                const theta = angleDeg * (Math.PI / 180);
                const cosT = Math.cos(theta);
                const sinT = Math.sin(theta);
                // Offsets from anchor in the unrotated ground plane
                const leftOff = -anchorX * worldWidth;
                const rightOff = (1 - anchorX) * worldWidth;
                const nearOff = (1 - anchorY) * worldDepthY;
                const farOff = -anchorY * worldDepthY;
                // Four corners rotated around (worldX, worldY)
                // BL (u=0, v=1): near-left
                const blDx = leftOff * cosT - nearOff * sinT;
                const blDy = leftOff * sinT + nearOff * cosT;
                // BR (u=1, v=1): near-right
                const brDx = rightOff * cosT - nearOff * sinT;
                const brDy = rightOff * sinT + nearOff * cosT;
                // TR (u=1, v=0): far-right
                const trDx = rightOff * cosT - farOff * sinT;
                const trDy = rightOff * sinT + farOff * cosT;
                // TL (u=0, v=0): far-left
                const tlDx = leftOff * cosT - farOff * sinT;
                const tlDy = leftOff * sinT + farOff * cosT;
                signature = [
                    worldX, worldY, worldZ, worldWidth, worldDepthY, angleDeg
                ].map(v => Number(v).toFixed(4)).join("|");
                if (signature !== this._depthBillboardLastSignature && this._depthBillboardWorldPositions) {
                    const positions = this._depthBillboardWorldPositions;
                    positions[0] = worldX + blDx; positions[1] = worldY + blDy; positions[2] = worldZ;
                    positions[3] = worldX + brDx; positions[4] = worldY + brDy; positions[5] = worldZ;
                    positions[6] = worldX + trDx; positions[7] = worldY + trDy; positions[8] = worldZ;
                    positions[9] = worldX + tlDx; positions[10] = worldY + tlDy; positions[11] = worldZ;
                    mesh.geometry.getBuffer("aWorldPosition").update();
                    this._depthBillboardLastSignature = signature;
                }
            } else {
                const leftX = worldX - anchorX * worldWidth;
                const rightX = worldX + (1 - anchorX) * worldWidth;
                signature = [
                    leftX, rightX, worldY, bottomZ, topZ, worldWidth, worldHeightZ
                ].map(v => v.toFixed(4)).join("|");
                if (signature !== this._depthBillboardLastSignature && this._depthBillboardWorldPositions) {
                    const positions = this._depthBillboardWorldPositions;
                    positions[0] = leftX;  positions[1] = worldY; positions[2] = bottomZ;
                    positions[3] = rightX; positions[4] = worldY; positions[5] = bottomZ;
                    positions[6] = rightX; positions[7] = worldY; positions[8] = topZ;
                    positions[9] = leftX;  positions[10] = worldY; positions[11] = topZ;
                    mesh.geometry.getBuffer("aWorldPosition").update();
                    this._depthBillboardLastSignature = signature;
                }
            }
        }

        const uniforms = mesh.shader.uniforms;
        const viewportHeight = Number(ctx && ctx.viewport && ctx.viewport.height) || 30;
        const nearMetric = -Math.max(80, viewportHeight * 0.6);
        const farMetric = Math.max(180, viewportHeight * 2.0 + 80);
        const depthSpanInv = 1 / Math.max(1e-6, farMetric - nearMetric);
        const screenW = (ctx && ctx.app && ctx.app.screen && Number.isFinite(ctx.app.screen.width))
            ? Number(ctx.app.screen.width)
            : 1;
        const screenH = (ctx && ctx.app && ctx.app.screen && Number.isFinite(ctx.app.screen.height))
            ? Number(ctx.app.screen.height)
            : 1;
        const tint = Number.isFinite(sprite && sprite.tint) ? Number(sprite.tint) : 0xFFFFFF;
        uniforms.uScreenSize[0] = Math.max(1, screenW);
        uniforms.uScreenSize[1] = Math.max(1, screenH);
        uniforms.uScreenJitter[0] = hasDoorHitShake ? shakeDx : 0;
        uniforms.uScreenJitter[1] = hasDoorHitShake ? shakeDy : 0;
        uniforms.uCameraWorld[0] = Number(cam.x) || 0;
        uniforms.uCameraWorld[1] = Number(cam.y) || 0;
        const mapRef = this.map || (ctx && ctx.map) || null;
        uniforms.uWorldSize[0] = (mapRef && Number.isFinite(mapRef.worldWidth) && mapRef.worldWidth > 0)
            ? Number(mapRef.worldWidth)
            : 0;
        uniforms.uWorldSize[1] = (mapRef && Number.isFinite(mapRef.worldHeight) && mapRef.worldHeight > 0)
            ? Number(mapRef.worldHeight)
            : 0;
        uniforms.uWrapEnabled[0] = (mapRef && mapRef.wrapX !== false) ? 1 : 0;
        uniforms.uWrapEnabled[1] = (mapRef && mapRef.wrapY !== false) ? 1 : 0;
        uniforms.uWrapAnchorWorld[0] = worldX;
        uniforms.uWrapAnchorWorld[1] = worldY;
        uniforms.uViewScale = Number(cam.viewscale) || 1;
        uniforms.uXyRatio = Number(cam.xyratio) || 1;
        uniforms.uDepthRange[0] = farMetric;
        uniforms.uDepthRange[1] = depthSpanInv;
        uniforms.uTint[0] = ((tint >> 16) & 255) / 255;
        uniforms.uTint[1] = ((tint >> 8) & 255) / 255;
        uniforms.uTint[2] = (tint & 255) / 255;
        uniforms.uTint[3] = Number.isFinite(sprite && sprite.alpha) ? Number(sprite.alpha) : 1;
        uniforms.uAlphaCutoff = Number.isFinite(options.alphaCutoff) ? Number(options.alphaCutoff) : 0.08;
        uniforms.uClipMinZ = this._scriptSinkState ? 0 : -1000000;
        uniforms.uSampler = sourceTexture || PIXI.Texture.WHITE;
        uniforms.uZOffset = 0.0;
        this._compositeUnderlayShouldRender = false;

        // --- Composite layers ---
        if (Array.isArray(this.compositeLayers) && this.compositeLayers.length >= 1) {
            const archLayer = this.compositeLayers[0];
            const doorLayer = this.compositeLayers.length >= 2 ? this.compositeLayers[1] : null;

            if (this.isOpen) {
                // If open, just show arch on the main mesh (no underlay needed)
                StaticObject._setCompositeLayerUvs(mesh, sourceTexture, archLayer.uRegion, useDualWallPlanes);
                if (this._compositeUnderlayMesh) this._compositeUnderlayMesh.visible = false;
            } else if (doorLayer) {
                // If closed, draw arch on underlay, and door on main mesh
                StaticObject._setCompositeLayerUvs(mesh, sourceTexture, doorLayer.uRegion, useDualWallPlanes);
                
                // Keep the door leaf decisively in front of the frame to avoid z-fighting,
                // especially while the leaf is screen-jittering from hit shake.
                mesh.shader.uniforms.uZOffset = hasDoorHitShake ? -6.0 : -3.0;

                const underlayMesh = this._ensureCompositeUnderlayMesh(useDualWallPlanes, false, options.alphaCutoff);
                if (underlayMesh && underlayMesh.shader && underlayMesh.shader.uniforms) {
                    if (this._depthBillboardWorldPositions && this._compositeUnderlayPositions) {
                        const src = this._depthBillboardWorldPositions;
                        const dst = this._compositeUnderlayPositions;
                        if (src.length === dst.length) {
                            for (let i = 0; i < src.length; i++) dst[i] = src[i];
                            underlayMesh.geometry.getBuffer("aWorldPosition").update();
                        }
                    }
                    StaticObject._setCompositeLayerUvs(underlayMesh, sourceTexture, archLayer.uRegion, useDualWallPlanes);
                    const uU = underlayMesh.shader.uniforms;
                    uU.uScreenSize[0] = uniforms.uScreenSize[0];
                    uU.uScreenSize[1] = uniforms.uScreenSize[1];
                    uU.uScreenJitter[0] = 0;
                    uU.uScreenJitter[1] = 0;
                    uU.uCameraWorld[0] = uniforms.uCameraWorld[0];
                    uU.uCameraWorld[1] = uniforms.uCameraWorld[1];
                    uU.uWrapEnabled[0] = uniforms.uWrapEnabled[0];
                    uU.uWrapEnabled[1] = uniforms.uWrapEnabled[1];
                    uU.uWrapAnchorWorld[0] = uniforms.uWrapAnchorWorld[0];
                    uU.uWrapAnchorWorld[1] = uniforms.uWrapAnchorWorld[1];
                    uU.uViewScale = uniforms.uViewScale;
                    uU.uXyRatio = uniforms.uXyRatio;
                    uU.uDepthRange[0] = uniforms.uDepthRange[0];
                    uU.uDepthRange[1] = uniforms.uDepthRange[1];
                    uU.uTint[0] = uniforms.uTint[0];
                    uU.uTint[1] = uniforms.uTint[1];
                    uU.uTint[2] = uniforms.uTint[2];
                    uU.uTint[3] = uniforms.uTint[3];
                    uU.uAlphaCutoff = uniforms.uAlphaCutoff;
                    uU.uClipMinZ = uniforms.uClipMinZ;
                    uU.uSampler = uniforms.uSampler;
                    uU.uZOffset = 1.5;
                    underlayMesh.visible = true;
                    this._compositeUnderlayShouldRender = true;
                }
            } else {
                StaticObject._setCompositeLayerUvs(mesh, sourceTexture, archLayer.uRegion, useDualWallPlanes);
                if (this._compositeUnderlayMesh) this._compositeUnderlayMesh.visible = false;
            }
        } else {
            if (this._compositeUnderlayMesh) this._compositeUnderlayMesh.visible = false;
        }

        mesh.visible = true;
        return mesh;
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
        if (this._depthBillboardMesh && this._depthBillboardMesh.parent) {
            this._depthBillboardMesh.parent.removeChild(this._depthBillboardMesh);
        }
        if (this._depthBillboardMesh && typeof this._depthBillboardMesh.destroy === "function") {
            this._depthBillboardMesh.destroy({ children: false, texture: false, baseTexture: false });
        }
        this._depthBillboardMesh = null;
        this._depthBillboardWorldPositions = null;
        this._depthBillboardLastSignature = "";
        this._depthBillboardMeshMode = "";
        if (typeof globalThis !== "undefined") {
            if (this.type === "tree" && typeof globalThis.unregisterLazyTreeRecordAt === "function") {
                globalThis.unregisterLazyTreeRecordAt(this.x, this.y);
            } else if (this.type === "road" && typeof globalThis.unregisterLazyRoadRecordAt === "function") {
                globalThis.unregisterLazyRoadRecordAt(this.x, this.y);
            }
            if (globalThis.activeSimObjects instanceof Set) {
                globalThis.activeSimObjects.delete(this);
            }
        }
    }
    remove() {
        this.removeFromGame();
    }
    
    ignite() {
        if (this.flammable === false) {
            this.isOnFire = false;
            return;
        }
        this.isOnFire = true;
        // Register for simulation ticking
        if (typeof globalThis !== "undefined" && globalThis.activeSimObjects instanceof Set) {
            globalThis.activeSimObjects.add(this);
        }
    }
    
    static FIRE_TEXTURE_PATH = "/assets/images/magic/fire.png";
    static FIRE_FRAME_COUNT_X = 5;
    static FIRE_FRAME_COUNT_Y = 5;
    static FIRE_FPS = 12;
    static _fireFramesCache = null;

    static getFireFrames() {
        if (StaticObject._fireFramesCache && StaticObject._fireFramesCache.length > 0) {
            return StaticObject._fireFramesCache;
        }
        const baseTex = PIXI.Texture.from(StaticObject.FIRE_TEXTURE_PATH).baseTexture;
        if (!baseTex || !baseTex.valid) return null;
        const cols = StaticObject.FIRE_FRAME_COUNT_X;
        const rows = StaticObject.FIRE_FRAME_COUNT_Y;
        const fw = baseTex.width / cols;
        const fh = baseTex.height / rows;
        const frames = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                frames.push(new PIXI.Texture(baseTex, new PIXI.Rectangle(c * fw, r * fh, fw, fh)));
            }
        }
        StaticObject._fireFramesCache = frames;
        return frames;
    }

    _ensureFireSprite() {
        if (this.fireSprite) return this.fireSprite;
        const frames = StaticObject.getFireFrames();
        if (!frames || frames.length === 0) return null;
        this._fireFrameIndex = Math.floor(Math.random() * frames.length);
        this._fireFrameProgress = 0;
        this._fireLastFrameCount = null;
        const sprite = new PIXI.Sprite(frames[this._fireFrameIndex]);
        sprite.anchor.set(0.5, 1);
        sprite.blendMode = PIXI.BLEND_MODES.ADD;
        this.fireSprite = sprite;
        // Add to objectLayer so it's part of the scene
        if (typeof objectLayer !== "undefined" && objectLayer) {
            objectLayer.addChild(sprite);
        }
        return sprite;
    }

    _updateFireAnimation() {
        if (!this.fireSprite) return;
        const frames = StaticObject.getFireFrames();
        if (!frames || frames.length <= 1) return;

        const currentFC = Number.isFinite(frameCount) ? Number(frameCount) : 0;
        if (!Number.isFinite(this._fireLastFrameCount)) {
            this._fireLastFrameCount = currentFC;
            this.fireSprite.texture = frames[this._fireFrameIndex % frames.length];
            return;
        }
        const delta = Math.max(0, currentFC - this._fireLastFrameCount);
        this._fireLastFrameCount = currentFC;
        if (delta <= 0) return;

        const simFps = Math.max(1, Number(frameRate) || 30);
        this._fireFrameProgress += delta * (StaticObject.FIRE_FPS / simFps);
        const advance = Math.floor(this._fireFrameProgress);
        if (advance > 0) {
            this._fireFrameProgress -= advance;
            this._fireFrameIndex = (this._fireFrameIndex + advance) % frames.length;
        }
        this.fireSprite.texture = frames[this._fireFrameIndex % frames.length];
    }

    _removeFireSprite() {
        if (!this.fireSprite) return;
        if (this.fireSprite.parent) {
            this.fireSprite.parent.removeChild(this.fireSprite);
        }
        if (typeof this.fireSprite.destroy === "function") {
            this.fireSprite.destroy({ children: true, texture: false, baseTexture: false });
        }
        this.fireSprite = null;
    }

    update() {
        this.updateSpriteAnimation();

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
                if (this.pixiSprite) this.pixiSprite.tint = tintValue;
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

        // Manage animated fire sprite overlay
        if (this.isOnFire || (this.fireFadeStart !== undefined)) {
            this._ensureFireSprite();
            this._updateFireAnimation();
            // Scale fire alpha: full when on fire, fading after tree falls
            const alphaMult = Number.isFinite(this.fireAlphaMult) ? this.fireAlphaMult : 1;
            if (this.fireSprite) {
                this.fireSprite.alpha = alphaMult;
                // Scale fire size based on HP: starts small, grows as HP drops
                if (this.maxHP && this.maxHP > 0) {
                    const hpRatio = Math.max(0, Math.min(1, this.hp / this.maxHP));
                    // Fire scale: 0.3 at full HP, 1.0 at 0 HP
                    this.fireScale = 0.3 + 0.7 * (1 - hpRatio);
                } else {
                    this.fireScale = 1;
                }
            }
        } else {
            if (this.fireSprite) {
                this._removeFireSprite();
            }
        }
        
        // Fade out fire after destruction
        if (this.fireFadeStart !== undefined) {
            const fadeFrames = 120; // ~4 seconds at 30fps
            const timeSinceFade = frameCount - this.fireFadeStart;
            if (timeSinceFade > fadeFrames) {
                this.fireAlphaMult = 0;
                this._removeFireSprite();
                // Fire fade complete — no more simulation needed
                delete this.fireFadeStart;
            } else {
                this.fireAlphaMult = Math.max(0, 1 - (timeSinceFade / fadeFrames));
            }
        }
    }

    saveJson() {
        const data = {
            type: this.type,
            x: this.x,
            y: this.y,
            hp: this.hp,
            isOnFire: this.isOnFire,
            textureIndex: this.textureIndex
        };
        if (typeof this.castsLosShadows === "boolean") {
            data.castsLosShadows = this.castsLosShadows;
        }
        if (typeof this.script !== "undefined") {
            try {
                data.script = JSON.parse(JSON.stringify(this.script));
            } catch (_err) {
                data.script = this.script;
            }
        }
        return data;
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
                        mountedWallSectionUnitId: Number.isInteger(data.mountedWallSectionUnitId)
                            ? Number(data.mountedWallSectionUnitId)
                            : null,
                        mountedWallFacingSign: Number.isFinite(data.mountedWallFacingSign)
                            ? Number(data.mountedWallFacingSign)
                            : null,
                        groundPlaneHitboxOverridePoints: Array.isArray(data.groundPlaneHitboxOverridePoints)
                            ? data.groundPlaneHitboxOverridePoints
                            : undefined,
                        isOpen: !!data.isOpen,
                        isFallenDoorEffect: !!data.isFallenDoorEffect,
                        doorLockedOpen: !!data.doorLockedOpen,
                        doorFallAngle: Number.isFinite(data.doorFallAngle) ? Number(data.doorFallAngle) : undefined,
                        doorFallNormalSign: Number.isFinite(data.doorFallNormalSign) ? Number(data.doorFallNormalSign) : undefined,
                        playerEnters: normalizeDoorEventScript(data.playerEnters),
                        playerExits: normalizeDoorEventScript(data.playerExits),
                        castsLosShadows: (typeof data.castsLosShadows === "boolean")
                            ? data.castsLosShadows
                            : undefined
                    });
                    break;
                case 'wall':
                    // Legacy wall type - no longer supported, skip
                    return null;
                case 'playground':
                    obj = new Playground(node, textures, map);
                    break;
                case 'triggerArea':
                    if (typeof TriggerArea === 'function') {
                        obj = new TriggerArea({ x: data.x, y: data.y }, map, {
                            points: Array.isArray(data.points) ? data.points : [],
                            playerEnters: normalizeDoorEventScript(data.playerEnters),
                            playerExits: normalizeDoorEventScript(data.playerExits)
                        });
                    }
                    break;
                default:
                    obj = new StaticObject(data.type, node, 4, 4, textures, map);
            }

            if (obj && typeof data.castsLosShadows === "boolean") {
                obj.castsLosShadows = data.castsLosShadows;
            }

            if (obj) {
                obj.x = data.x;
                obj.y = data.y;
                if (data.hp !== undefined) obj.hp = data.hp;
                if (data.falling) {
                    obj.falling = true;
                    obj.fallStart = typeof frameCount !== "undefined" ? frameCount : 0;
                }
                if (data.isOnFire) obj.ignite();
                // Also register for growing/falling state restored from save
                if (obj.isGrowing || obj.falling) {
                    if (typeof globalThis !== "undefined" && globalThis.activeSimObjects instanceof Set) {
                        globalThis.activeSimObjects.add(obj);
                    }
                }
                if (Object.prototype.hasOwnProperty.call(data, "script")) {
                    obj.script = data.script;
                }

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
        if (this.gone) return;
        if (!metaEntry || typeof metaEntry !== "object") return;
        this._treeMetadata = metaEntry;
        this.configureSpriteAnimation(metaEntry);
        if (metaEntry.anchor && typeof metaEntry.anchor === "object" && this.pixiSprite && this.pixiSprite.anchor) {
            const ax = Number.isFinite(metaEntry.anchor.x) ? Number(metaEntry.anchor.x) : this.pixiSprite.anchor.x;
            const ay = Number.isFinite(metaEntry.anchor.y) ? Number(metaEntry.anchor.y) : this.pixiSprite.anchor.y;
            this.pixiSprite.anchor.set(ax, ay);
        }
        if (typeof metaEntry.blocksTile === "boolean") this.blocksTile = metaEntry.blocksTile;
        if (typeof metaEntry.castsLosShadows === "boolean") {
            this.castsLosShadows = resolveCastsLosShadows(metaEntry.castsLosShadows, this.castsLosShadows);
        }
        this.refreshStandingTreeHitboxes();
    }

    async applyTreeMetadataFromServer() {
        const texturePath = this.resolveTreeTexturePath();
        if (!texturePath) return;
        this.texturePath = texturePath;
        const token = ++this._treeMetadataFetchToken;
        const merged = await getResolvedPlaceableMetadata("trees", texturePath);
        if (token !== this._treeMetadataFetchToken) return;
        if (this.gone) return;
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

    updateDepthBillboardMesh(ctx = null, camera = null, options = {}) {
        const isFalling = !!(
            this &&
            this.falling &&
            Number.isFinite(this.rotation) &&
            Math.abs(Number(this.rotation)) > 1e-4
        );
        if (!isFalling) {
            return super.updateDepthBillboardMesh(ctx, camera, options);
        }

        const sprite = this.pixiSprite;
        const fallbackTexture = (typeof this.texturePath === "string" && this.texturePath.length > 0)
            ? PIXI.Texture.from(this.texturePath)
            : null;
        const sourceTexture = (sprite && sprite.texture) ? sprite.texture : (fallbackTexture || null);
        if (!sourceTexture) {
            if (this._depthBillboardMesh) this._depthBillboardMesh.visible = false;
            return null;
        }
        if (!camera) {
            if (this._depthBillboardMesh) this._depthBillboardMesh.visible = false;
            return null;
        }

        const mesh = this.ensureDepthBillboardMesh(null, options.alphaCutoff, {
            forceSinglePlane: true
        });
        if (!mesh || !mesh.shader || !mesh.shader.uniforms || !this._depthBillboardWorldPositions) {
            if (this._depthBillboardMesh) this._depthBillboardMesh.visible = false;
            return null;
        }
        this.updateDepthBillboardUvsForTexture(mesh, sourceTexture, false);
        
        if (Array.isArray(this.compositeLayers) && this.compositeLayers[0]) {
            StaticObject._setCompositeLayerUvs(mesh, sourceTexture, this.compositeLayers[0].uRegion, false);
        }

        const worldX = Number.isFinite(this.x) ? Number(this.x) : 0;
        const worldY = Number.isFinite(this.y) ? Number(this.y) : 0;
        const worldZ = Number.isFinite(this.z) ? Number(this.z) : 0;
        const viewScale = Math.max(1e-6, Math.abs(Number(camera.viewscale) || 1));
        const xyRatio = Math.max(1e-6, Math.abs(Number(camera.xyratio) || 1));
        const anchorX = (sprite && sprite.anchor && Number.isFinite(sprite.anchor.x)) ? Number(sprite.anchor.x) : 0.5;
        const anchorY = (sprite && sprite.anchor && Number.isFinite(sprite.anchor.y)) ? Number(sprite.anchor.y) : 1;
        const worldWidth = Math.max(0.01, Math.abs(Number(sprite && sprite.width) || 0) / viewScale);
        const worldHeightZ = Math.max(0.01, Math.abs(Number(sprite && sprite.height) || 0) / (viewScale * xyRatio));

        const absRotation = Math.min(90, Math.max(0, Math.abs(Number(this.rotation) || 0)));
        const fallSign = (typeof this.fallDirection === "string")
            ? (this.fallDirection === "right" ? 1 : -1)
            : ((Number(this.rotation) || 0) >= 0 ? 1 : -1);
        const fallRadians = (absRotation * Math.PI / 180) * fallSign;
        const cosR = Math.cos(fallRadians);
        const sinR = Math.sin(fallRadians);

        let topWidth = worldWidth;
        let deformedHeight = worldHeightZ;
        if (absRotation >= 75) {
            const lateProgress = Math.min((absRotation - 75) / 15, 1);
            topWidth = worldWidth * (1 - lateProgress * 0.5);
            deformedHeight = worldHeightZ * (1 + lateProgress * 0.1);
        }

        const baseCenterX = worldX + (0.5 - anchorX) * worldWidth;
        const baseY = worldY;
        const baseBottomZ = worldZ - (1 - anchorY) * worldHeightZ;
        // Rotate in screen-equivalent metric space so fall keeps visual aspect ratio
        // under anisotropic projection (X vs Z uses xyratio on screen).
        const safeXyRatio = Math.max(1e-6, xyRatio);
        const rotateXZ = (x, z) => {
            const zMetric = z * safeXyRatio;
            const rx = (x * cosR) - (zMetric * sinR);
            const rzMetric = (x * sinR) + (zMetric * cosR);
            return {
                x: rx,
                z: rzMetric / safeXyRatio
            };
        };

        const localBL = rotateXZ(-worldWidth * 0.5, 0);
        const localBR = rotateXZ(worldWidth * 0.5, 0);
        // In world space, positive Z is upward. Keep the crown above the base at rest
        // so the billboard does not invert right before full fall.
        const localTR = rotateXZ(topWidth * 0.5, deformedHeight);
        const localTL = rotateXZ(-topWidth * 0.5, deformedHeight);

        const bl = { x: baseCenterX + localBL.x, y: baseY, z: baseBottomZ + localBL.z };
        const br = { x: baseCenterX + localBR.x, y: baseY, z: baseBottomZ + localBR.z };
        const tr = { x: baseCenterX + localTR.x, y: baseY, z: baseBottomZ + localTR.z };
        const tl = { x: baseCenterX + localTL.x, y: baseY, z: baseBottomZ + localTL.z };

        const signature = [
            bl.x, bl.z, br.x, br.z, tr.x, tr.z, tl.x, tl.z,
            worldY, absRotation, topWidth, deformedHeight, fallSign
        ].map(v => Number(v).toFixed(4)).join("|");
        if (signature !== this._depthBillboardLastSignature) {
            const positions = this._depthBillboardWorldPositions;
            positions[0] = bl.x; positions[1] = bl.y; positions[2] = bl.z;
            positions[3] = br.x; positions[4] = br.y; positions[5] = br.z;
            positions[6] = tr.x; positions[7] = tr.y; positions[8] = tr.z;
            positions[9] = tl.x; positions[10] = tl.y; positions[11] = tl.z;
            const worldBuffer = mesh.geometry.getBuffer("aWorldPosition");
            if (worldBuffer) worldBuffer.update();
            this._depthBillboardLastSignature = signature;
        }

        const uniforms = mesh.shader.uniforms;
        const viewportHeight = Number(ctx && ctx.viewport && ctx.viewport.height) || 30;
        const nearMetric = -Math.max(80, viewportHeight * 0.6);
        const farMetric = Math.max(180, viewportHeight * 2.0 + 80);
        const depthSpanInv = 1 / Math.max(1e-6, farMetric - nearMetric);
        const screenW = (ctx && ctx.app && ctx.app.screen && Number.isFinite(ctx.app.screen.width))
            ? Number(ctx.app.screen.width)
            : 1;
        const screenH = (ctx && ctx.app && ctx.app.screen && Number.isFinite(ctx.app.screen.height))
            ? Number(ctx.app.screen.height)
            : 1;
        const tint = Number.isFinite(sprite && sprite.tint) ? Number(sprite.tint) : 0xFFFFFF;
        uniforms.uScreenSize[0] = Math.max(1, screenW);
        uniforms.uScreenSize[1] = Math.max(1, screenH);
        uniforms.uScreenJitter[0] = 0;
        uniforms.uScreenJitter[1] = 0;
        uniforms.uCameraWorld[0] = Number(camera.x) || 0;
        uniforms.uCameraWorld[1] = Number(camera.y) || 0;
        const mapRef = this.map || (ctx && ctx.map) || null;
        uniforms.uWorldSize[0] = (mapRef && Number.isFinite(mapRef.worldWidth) && mapRef.worldWidth > 0)
            ? Number(mapRef.worldWidth)
            : 0;
        uniforms.uWorldSize[1] = (mapRef && Number.isFinite(mapRef.worldHeight) && mapRef.worldHeight > 0)
            ? Number(mapRef.worldHeight)
            : 0;
        uniforms.uWrapEnabled[0] = (mapRef && mapRef.wrapX !== false) ? 1 : 0;
        uniforms.uWrapEnabled[1] = (mapRef && mapRef.wrapY !== false) ? 1 : 0;
        uniforms.uWrapAnchorWorld[0] = worldX;
        uniforms.uWrapAnchorWorld[1] = worldY;
        uniforms.uViewScale = Number(camera.viewscale) || 1;
        uniforms.uXyRatio = Number(camera.xyratio) || 1;
        uniforms.uDepthRange[0] = farMetric;
        uniforms.uDepthRange[1] = depthSpanInv;
        uniforms.uTint[0] = ((tint >> 16) & 255) / 255;
        uniforms.uTint[1] = ((tint >> 8) & 255) / 255;
        uniforms.uTint[2] = (tint & 255) / 255;
        uniforms.uTint[3] = Number.isFinite(sprite && sprite.alpha) ? Number(sprite.alpha) : 1;
        uniforms.uAlphaCutoff = Number.isFinite(options.alphaCutoff) ? Number(options.alphaCutoff) : 0.08;
        uniforms.uClipMinZ = this._scriptSinkState ? 0 : -1000000;
        uniforms.uSampler = sourceTexture || PIXI.Texture.WHITE;
        mesh.visible = true;
        return mesh;
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
            ? normalizeTexturePathForMetadata(options.texturePath)
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
        
        this.isOpen = !!options.isOpen;
        this.isFallenDoorEffect = !!options.isFallenDoorEffect;
        this.doorFallAngle = Number.isFinite(options.doorFallAngle)
            ? Math.max(0, Math.min(90, Number(options.doorFallAngle)))
            : 0;
        this._doorFallNormalSign = Number.isFinite(options.doorFallNormalSign)
            ? (Number(options.doorFallNormalSign) >= 0 ? 1 : -1)
            : 1;
        this._doorLockedOpen = !!options.doorLockedOpen;
        this._doorHitShakeStartedAt = 0;
        this._doorHitShakeEndsAt = 0;
        this._doorHitShakeMaxJitterPx = 7;
        this._doorHitShakeSeed = Math.random() * Math.PI * 2;

        this.mountedWallLineGroupId = Number.isInteger(options.mountedWallLineGroupId)
            ? options.mountedWallLineGroupId
            : (Number.isInteger(options.mountedSectionId) ? Number(options.mountedSectionId) : null);
        this.mountedSectionId = Number.isInteger(this.mountedWallLineGroupId)
            ? Number(this.mountedWallLineGroupId)
            : null;
        this.mountedWallSectionUnitId = Number.isInteger(options.mountedWallSectionUnitId)
            ? Number(options.mountedWallSectionUnitId)
            : null;
        this.mountedWallFacingSign = Number.isFinite(options.mountedWallFacingSign)
            ? Number(options.mountedWallFacingSign)
            : null;
        this.rotation = this.placementRotation;
        this.blocksTile = false;
        this.isPassable = true;
        this.castsLosShadows = resolveCastsLosShadows(options.castsLosShadows, this.castsLosShadows);
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
        this.playerEnters = normalizeDoorEventScript(options.playerEnters);
        this.playerExits = normalizeDoorEventScript(options.playerExits);
        if (this.pixiSprite) {
            this.pixiSprite.texture = PIXI.Texture.from(this.texturePath);
            this.pixiSprite.anchor.set(this.placeableAnchorX, this.placeableAnchorY);
        }
        this._placedObjectExplicit = {
            width: hasExplicitWidth,
            height: hasExplicitHeight,
            renderDepthOffset: hasExplicitRenderDepthOffset,
            rotationAxis: hasExplicitRotationAxis,
            placementRotation: hasExplicitPlacementRotation,
            castsLosShadows: (typeof options.castsLosShadows === "boolean")
        };
        this.compositeLayers = resolveDoorCompositeLayersForState(options.compositeLayers, {
            leafOnly: this.isFallenDoorEffect
        });
        if (!this.compositeLayers && this.isDoorObject()) {
            this.compositeLayers = resolveDoorCompositeLayersForState([
                { name: "arch", uRegion: [0, 0.5] },
                { name: "door", uRegion: [0.5, 1] }
            ], {
                leafOnly: this.isFallenDoorEffect
            });
        }
        if (this.isFallenDoorEffect) {
            this.updateFallenDoorVisibilityHitbox();
        }
        this.snapToMountedWall();
        if (
            Number.isInteger(this.mountedWallSectionUnitId) &&
            typeof WallSectionUnit !== "undefined" &&
            WallSectionUnit &&
            WallSectionUnit._allSections instanceof Map
        ) {
            const section = WallSectionUnit._allSections.get(Number(this.mountedWallSectionUnitId));
            if (section && typeof section.attachObject === "function") {
                section.attachObject(this, { direction: this.placementRotation });
            }
        }
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
        if (this.isOpen) data.isOpen = true;
        if (this.isFallenDoorEffect) data.isFallenDoorEffect = true;
        if (this._doorLockedOpen) data.doorLockedOpen = true;
        if (this.falling) data.falling = true;
        if (Number.isFinite(this.doorFallAngle)) {
            data.doorFallAngle = Math.max(0, Math.min(90, Number(this.doorFallAngle)));
        }
        if (Number.isFinite(this._doorFallNormalSign)) {
            data.doorFallNormalSign = Number(this._doorFallNormalSign) >= 0 ? 1 : -1;
        }
        data.placeableAnchorX = Number.isFinite(this.placeableAnchorX) ? this.placeableAnchorX : 0.5;
        data.placeableAnchorY = Number.isFinite(this.placeableAnchorY) ? this.placeableAnchorY : 1;
        if (typeof this.castsLosShadows === "boolean") {
            data.castsLosShadows = this.castsLosShadows;
        }
        if (Number.isInteger(this.mountedWallLineGroupId)) {
            data.mountedWallLineGroupId = this.mountedWallLineGroupId;
            data.mountedSectionId = this.mountedWallLineGroupId;
        }
        if (Number.isInteger(this.mountedWallSectionUnitId)) {
            data.mountedWallSectionUnitId = Number(this.mountedWallSectionUnitId);
        }
        if (Number.isFinite(this.mountedWallFacingSign)) {
            data.mountedWallFacingSign = Number(this.mountedWallFacingSign);
        }
        if (Array.isArray(this.groundPlaneHitboxOverridePoints) && this.groundPlaneHitboxOverridePoints.length >= 3) {
            data.groundPlaneHitboxOverridePoints = this.groundPlaneHitboxOverridePoints.map(p => ({ x: p.x, y: p.y }));
        }
        if (typeof this.playerEnters === "string" && this.playerEnters.trim().length > 0) {
            data.playerEnters = this.playerEnters.trim();
        }
        if (typeof this.playerExits === "string" && this.playerExits.trim().length > 0) {
            data.playerExits = this.playerExits.trim();
        }
        return data;
    }

    removeFromGame() {
        const mountedSection = Number.isInteger(this.mountedWallLineGroupId)
            ? Number(this.mountedWallLineGroupId)
            : null;
        const mountedWallSectionUnitId = Number.isInteger(this.mountedWallSectionUnitId)
            ? Number(this.mountedWallSectionUnitId)
            : null;
        if (
            Number.isInteger(mountedWallSectionUnitId) &&
            typeof WallSectionUnit !== "undefined" &&
            WallSectionUnit &&
            WallSectionUnit._allSections instanceof Map
        ) {
            const section = WallSectionUnit._allSections.get(mountedWallSectionUnitId);
            if (section && typeof section.detachObject === "function") {
                section.detachObject(this);
            }
        }
        this.mountedWallLineGroupId = null;
        this.mountedSectionId = null;
        this.mountedWallSectionUnitId = null;
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
        const hasExplicitMountedTarget = !!(
            Number.isInteger(this.mountedWallLineGroupId) ||
            Number.isInteger(this.mountedSectionId) ||
            Number.isInteger(this.mountedWallSectionUnitId)
        );
        if (category === "doors" && !hasExplicitMountedTarget) {
            // Allow free-placed doors: only snap doors when they were explicitly mounted.
            this.mountedWallLineGroupId = null;
            this.mountedSectionId = null;
            this.mountedWallSectionUnitId = null;
            return false;
        }
        const previousMountedId = Number.isInteger(this.mountedWallLineGroupId)
            ? Number(this.mountedWallLineGroupId)
            : null;
        const previousWallSectionUnitId = Number.isInteger(this.mountedWallSectionUnitId)
            ? Number(this.mountedWallSectionUnitId)
            : null;

        const seedX = Number.isFinite(this.x) ? Number(this.x) : 0;
        const seedY = Number.isFinite(this.y) ? Number(this.y) : 0;
        const allWalls = collectMountableWallSegments(this.map);
        if (!Array.isArray(allWalls) || allWalls.length === 0) return false;

        let groupId = Number.isInteger(this.mountedWallLineGroupId)
            ? Number(this.mountedWallLineGroupId)
            : (Number.isInteger(this.mountedSectionId) ? Number(this.mountedSectionId) : null);
        let walls = [];
        if (walls.length === 0 && Number.isInteger(groupId)) {
            walls = allWalls.filter(w => Number.isInteger(w.groupId) && Number(w.groupId) === groupId);
        }
        if (walls.length === 0) {
            // Fallback: use nearest wall segment and adopt its mounted id.
            let nearestWall = null;
            let nearestDist2 = Infinity;
            for (let i = 0; i < allWalls.length; i++) {
                const w = allWalls[i];
                const cp = closestPointOnSegment2D(seedX, seedY, Number(w.ax), Number(w.ay), Number(w.bx), Number(w.by));
                if (cp.dist2 < nearestDist2) {
                    nearestDist2 = cp.dist2;
                    nearestWall = w;
                }
            }
            if (!nearestWall) return false;
            groupId = Number.isInteger(nearestWall.groupId) ? Number(nearestWall.groupId) : null;
            this.mountedWallLineGroupId = groupId;
            this.mountedSectionId = groupId;
            walls = Number.isInteger(groupId)
                ? allWalls.filter(w => Number.isInteger(w.groupId) && Number(w.groupId) === groupId)
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
            const ax = seedX + shortestDX(seedX, Number(w.ax));
            const ay = seedY + shortestDY(seedY, Number(w.ay));
            const bx = seedX + shortestDX(seedX, Number(w.bx));
            const by = seedY + shortestDY(seedY, Number(w.by));
            const cp = closestPointOnSegment2D(seedX, seedY, ax, ay, bx, by);
            if (cp.dist2 < bestDist2) {
                bestDist2 = cp.dist2;
                wall = w;
            }
        }
        if (!wall) return false;

        const axRaw = Number(wall && wall.ax);
        const ayRaw = Number(wall && wall.ay);
        const bxRaw = Number(wall && wall.bx);
        const byRaw = Number(wall && wall.by);
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
        const nextWallSectionUnitId = (wall && wall.type === "wallSection" && Number.isInteger(wall.groupId))
            ? Number(wall.groupId)
            : null;
        if (
            Number.isInteger(previousWallSectionUnitId) &&
            previousWallSectionUnitId !== nextWallSectionUnitId &&
            typeof WallSectionUnit !== "undefined" &&
            WallSectionUnit &&
            WallSectionUnit._allSections instanceof Map
        ) {
            const prevSection = WallSectionUnit._allSections.get(previousWallSectionUnitId);
            if (prevSection && typeof prevSection.detachObject === "function") {
                prevSection.detachObject(this);
            }
        }
        if (wall && wall.type === "wallSection") {
            this.mountedWallSectionUnitId = Number.isInteger(wall.groupId) ? Number(wall.groupId) : null;
        } else {
            this.mountedWallSectionUnitId = null;
        }
        if (category === "windows") {
            const wallThickness = Math.max(0.001, Number(wall && wall.thickness) || 0.001);
            const wallHalfT = wallThickness * 0.5;
            const nx = -ty;
            const ny = tx;
            const faceSign = Number.isFinite(this.mountedWallFacingSign)
                ? (Number(this.mountedWallFacingSign) >= 0 ? 1 : -1)
                : 1;
            let faceStartX = ax + nx * wallHalfT * faceSign;
            let faceStartY = ay + ny * wallHalfT * faceSign;
            let faceEndX = bx + nx * wallHalfT * faceSign;
            let faceEndY = by + ny * wallHalfT * faceSign;
            const profile = buildSegmentFaceProfile(wall, seedX, seedY, this.map);
            if (profile) {
                const faceA = faceSign >= 0 ? profile.aLeft : profile.aRight;
                const faceB = faceSign >= 0 ? profile.bLeft : profile.bRight;
                if (faceA && faceB && Number.isFinite(faceA.x) && Number.isFinite(faceA.y) && Number.isFinite(faceB.x) && Number.isFinite(faceB.y)) {
                    faceStartX = Number(faceA.x);
                    faceStartY = Number(faceA.y);
                    faceEndX = Number(faceB.x);
                    faceEndY = Number(faceB.y);
                }
            }
            const faceDx = faceEndX - faceStartX;
            const faceDy = faceEndY - faceStartY;
            let faceT = null;
            if (Math.abs(faceDx) > 1e-6) {
                const rawT = (seedX - faceStartX) / faceDx;
                if (rawT >= -1e-6 && rawT <= 1 + 1e-6) {
                    faceT = Math.max(0, Math.min(1, rawT));
                }
            } else if (Math.abs(seedX - faceStartX) <= 1e-4) {
                faceT = Math.max(0, Math.min(1, closestOnCenter.t));
            }
            if (Number.isFinite(faceT)) {
                let snappedX = seedX + nx * 0.001 * faceSign;
                let snappedY = (faceStartY + faceDy * faceT) + ny * 0.001 * faceSign;
                if (this.map && typeof this.map.wrapWorldX === "function") snappedX = this.map.wrapWorldX(snappedX);
                if (this.map && typeof this.map.wrapWorldY === "function") snappedY = this.map.wrapWorldY(snappedY);
                this.x = snappedX;
                this.y = snappedY;
                if (Number.isInteger(nextWallSectionUnitId)) {
                    // For WallSectionUnit mounts, center the window anchor point vertically on the wall.
                    this.z = wallHeight * 0.5;
                }
                this.mountedWallFacingSign = faceSign;
                if (
                    Number.isInteger(nextWallSectionUnitId) &&
                    typeof WallSectionUnit !== "undefined" &&
                    WallSectionUnit &&
                    WallSectionUnit._allSections instanceof Map
                ) {
                    const section = WallSectionUnit._allSections.get(nextWallSectionUnitId);
                    if (section && typeof section.attachObject === "function") {
                        section.attachObject(this, { direction: this.placementRotation });
                    }
                }
                if (
                    typeof globalThis !== "undefined" &&
                    typeof globalThis.markWallSectionDirty === "function"
                ) {
                    if (Number.isInteger(previousMountedId) && previousMountedId !== groupId) {
                        globalThis.markWallSectionDirty(previousMountedId);
                    }
                    if (Number.isInteger(groupId)) globalThis.markWallSectionDirty(groupId);
                }
                return true;
            }
        }
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
        if (
            Number.isInteger(nextWallSectionUnitId) &&
            typeof WallSectionUnit !== "undefined" &&
            WallSectionUnit &&
            WallSectionUnit._allSections instanceof Map
        ) {
            const section = WallSectionUnit._allSections.get(nextWallSectionUnitId);
            if (section && typeof section.attachObject === "function") {
                section.attachObject(this, { direction: this.placementRotation });
            }
        }
        if (
            typeof globalThis !== "undefined" &&
            typeof globalThis.markWallSectionDirty === "function"
        ) {
            if (Number.isInteger(previousMountedId) && previousMountedId !== groupId) {
                globalThis.markWallSectionDirty(previousMountedId);
            }
            if (Number.isInteger(groupId)) globalThis.markWallSectionDirty(groupId);
        }
        return true;
    }

    applyPlaceableMetadata(metaEntry) {
        if (!metaEntry || typeof metaEntry !== 'object') return;
        const explicit = this._placedObjectExplicit || {};
        this.configureSpriteAnimation(metaEntry);
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
        if (!explicit.castsLosShadows && typeof metaEntry.castsLosShadows === "boolean") {
            this.castsLosShadows = resolveCastsLosShadows(metaEntry.castsLosShadows, this.castsLosShadows);
        }
        if (this._doorLockedOpen || this.isFallenDoorEffect || this.isOpen) {
            this.blocksTile = false;
            this.isPassable = true;
            this.castsLosShadows = false;
            this.notifyMountedWallStateChanged();
        }
        this.lodTextures = normalizeLodTextures(metaEntry.lodTextures, this.texturePath);
        
        this.compositeLayers = resolveDoorCompositeLayersForState(metaEntry.compositeLayers, {
            leafOnly: this.isFallenDoorEffect
        });

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
        if ((this.rotationAxis === "spatial" || this.rotationAxis === "ground") && Number.isFinite(this.placementRotation)) {
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
            const hasMountedWallTarget = !!(
                Number.isInteger(this.mountedWallLineGroupId) ||
                Number.isInteger(this.mountedSectionId) ||
                Number.isInteger(this.mountedWallSectionUnitId)
            );
            if (
                this.rotationAxis === "spatial" &&
                (category === "windows" || (category === "doors" && hasMountedWallTarget))
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

    isDoorObject() {
        return (this.category === "doors" || this.type === "door");
    }

    notifyMountedWallStateChanged() {
        const mountedSectionId = Number.isInteger(this.mountedWallSectionUnitId)
            ? Number(this.mountedWallSectionUnitId)
            : null;
        if (
            Number.isInteger(mountedSectionId) &&
            typeof WallSectionUnit !== "undefined" &&
            WallSectionUnit &&
            WallSectionUnit._allSections instanceof Map
        ) {
            const section = WallSectionUnit._allSections.get(mountedSectionId);
            if (section && typeof section.rebuildDirectionalBlocking === "function") {
                section.rebuildDirectionalBlocking();
            }
        }
        if (
            Number.isInteger(this.mountedWallLineGroupId) &&
            typeof globalThis !== "undefined" &&
            typeof globalThis.markWallSectionDirty === "function"
        ) {
            globalThis.markWallSectionDirty(this.mountedWallLineGroupId);
        }
    }

    getDoorTraversalNormal() {
        const angleDeg = Number.isFinite(this.placementRotation)
            ? Number(this.placementRotation)
            : (Number.isFinite(this.rotation) ? Number(this.rotation) : 0);
        const radians = angleDeg * (Math.PI / 180);
        const tx = Math.cos(radians);
        const ty = Math.sin(radians);
        const nx = -ty;
        const ny = tx;
        const mag = Math.hypot(nx, ny);
        if (!(mag > 1e-6)) return { x: 0, y: 1 };
        return { x: nx / mag, y: ny / mag };
    }

    setDoorFallAwayFromPoint(worldX, worldY) {
        if (!this.isDoorObject()) return false;
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
        const normal = this.getDoorTraversalNormal();
        const center = getPlacedObjectAnchorWorldPoint(this) || { x: this.x, y: this.y };
        const dx = (this.map && typeof this.map.shortestDeltaX === "function")
            ? this.map.shortestDeltaX(center.x, worldX)
            : (worldX - center.x);
        const dy = (this.map && typeof this.map.shortestDeltaY === "function")
            ? this.map.shortestDeltaY(center.y, worldY)
            : (worldY - center.y);
        const dot = dx * normal.x + dy * normal.y;
        this._doorFallNormalSign = dot >= 0 ? -1 : 1;
        return true;
    }

    setDoorFallTowardPoint(worldX, worldY) {
        if (!this.isDoorObject()) return false;
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
        const normal = this.getDoorTraversalNormal();
        const center = getPlacedObjectAnchorWorldPoint(this) || { x: this.x, y: this.y };
        const dx = (this.map && typeof this.map.shortestDeltaX === "function")
            ? this.map.shortestDeltaX(center.x, worldX)
            : (worldX - center.x);
        const dy = (this.map && typeof this.map.shortestDeltaY === "function")
            ? this.map.shortestDeltaY(center.y, worldY)
            : (worldY - center.y);
        const dot = dx * normal.x + dy * normal.y;
        this._doorFallNormalSign = dot >= 0 ? 1 : -1;
        return true;
    }

    triggerDoorHitShake(durationMs = 100, maxJitterPx = 7) {
        if (!this.isDoorObject() || this.isOpen || this._doorLockedOpen || this.isFallenDoorEffect) {
            return false;
        }
        const now = Date.now();
        this._doorHitShakeStartedAt = now;
        this._doorHitShakeEndsAt = now + Math.max(1, Number.isFinite(durationMs) ? Number(durationMs) : 100);
        this._doorHitShakeMaxJitterPx = Math.max(0, Number.isFinite(maxJitterPx) ? Number(maxJitterPx) : 7);
        this._doorHitShakeSeed = Math.random() * Math.PI * 2;
        return true;
    }

    getDoorHitShakeScreenOffset(now = Date.now()) {
        if (!this.isDoorObject() || this.isOpen || this._doorLockedOpen || this.isFallenDoorEffect) {
            return { x: 0, y: 0 };
        }
        const start = Number(this._doorHitShakeStartedAt) || 0;
        const end = Number(this._doorHitShakeEndsAt) || 0;
        if (!(end > start) || now >= end) {
            return { x: 0, y: 0 };
        }
        const duration = Math.max(1, end - start);
        const elapsed = Math.max(0, now - start);
        const progress = Math.max(0, Math.min(1, elapsed / duration));
        const falloff = 1 - progress;
        const maxJitterPx = Math.max(0, Number(this._doorHitShakeMaxJitterPx) || 0);
        if (!(maxJitterPx > 0)) {
            return { x: 0, y: 0 };
        }
        const step = Math.floor(elapsed / 16.6667);
        const seed = Number.isFinite(this._doorHitShakeSeed) ? Number(this._doorHitShakeSeed) : 0;
        return {
            x: Math.sin(seed + step * 11.173) * maxJitterPx * falloff,
            y: Math.cos(seed * 1.913 + step * 15.977) * maxJitterPx * falloff
        };
    }

    getDoorHitShakeWorldOffset(camera = null, now = Date.now()) {
        const screenOffset = this.getDoorHitShakeScreenOffset(now);
        if (!camera) return { x: 0, y: 0 };
        const viewScale = Math.max(1e-6, Math.abs(Number(camera.viewscale) || 1));
        const xyRatio = Math.max(1e-6, Math.abs(Number(camera.xyratio) || 1));
        return {
            x: screenOffset.x / viewScale,
            y: screenOffset.y / (viewScale * xyRatio)
        };
    }

    updateFallenDoorVisibilityHitbox() {
        if (!this.isFallenDoorEffect) return;
        const xyRatio = Math.max(
            1e-6,
            Math.abs(
                (typeof globalThis !== "undefined" && Number.isFinite(globalThis.xyratio))
                    ? Number(globalThis.xyratio)
                    : 0.66
            )
        );
        const width = Math.max(0.01, Number.isFinite(this.width) ? Number(this.width) : 1);
        const worldHeightZ = Math.max(0.01, Number.isFinite(this.height) ? (Number(this.height) / xyRatio) : (1 / xyRatio));
        const anchorX = Number.isFinite(this.placeableAnchorX) ? Number(this.placeableAnchorX) : 0.5;
        const angleDeg = Number.isFinite(this.placementRotation) ? Number(this.placementRotation) : 0;
        const theta = angleDeg * (Math.PI / 180);
        const axisX = Math.cos(theta);
        const axisY = Math.sin(theta);
        const normalX = -axisY;
        const normalY = axisX;
        const halfWidth = width * 0.5;
        const alongOffset = (anchorX - 0.5) * width;
        const faceCenters = (
            this.depthBillboardFaceCenters &&
            this.depthBillboardFaceCenters.front &&
            this.depthBillboardFaceCenters.back &&
            Number.isFinite(this.depthBillboardFaceCenters.front.x) &&
            Number.isFinite(this.depthBillboardFaceCenters.front.y) &&
            Number.isFinite(this.depthBillboardFaceCenters.back.x) &&
            Number.isFinite(this.depthBillboardFaceCenters.back.y)
        ) ? this.depthBillboardFaceCenters : null;
        const fallAngle = Math.max(0, Math.min(90, Number.isFinite(this.doorFallAngle) ? Number(this.doorFallAngle) : 0));
        const fallRadians = fallAngle * (Math.PI / 180);
        const fallSign = Number.isFinite(this._doorFallNormalSign) && this._doorFallNormalSign < 0 ? -1 : 1;
        const mountedWallThickness = resolveMountedWallThickness(this);
        const hingeOutwardOffset = Math.max(
            0.02,
            Number.isFinite(mountedWallThickness)
                ? (Math.max(0.001, Number(mountedWallThickness)) * 0.5 + 0.02)
                : 0.08
        );
        const hingeFace = (fallSign >= 0)
            ? (faceCenters && faceCenters.front ? faceCenters.front : null)
            : (faceCenters && faceCenters.back ? faceCenters.back : null);
        const hingeCenterX = hingeFace
            ? (Number(hingeFace.x) - axisX * alongOffset + normalX * fallSign * hingeOutwardOffset)
            : ((Number.isFinite(this.x) ? Number(this.x) : 0) - axisX * alongOffset);
        const hingeCenterY = hingeFace
            ? (Number(hingeFace.y) - axisY * alongOffset + normalY * fallSign * hingeOutwardOffset)
            : ((Number.isFinite(this.y) ? Number(this.y) : 0) - axisY * alongOffset);
        const footprintDepth = Math.max(0.08, Math.abs(Math.sin(fallRadians) * worldHeightZ));
        const depthOffset = footprintDepth * fallSign;
        const bl = { x: hingeCenterX - axisX * halfWidth, y: hingeCenterY - axisY * halfWidth };
        const br = { x: hingeCenterX + axisX * halfWidth, y: hingeCenterY + axisY * halfWidth };
        const tr = { x: br.x + normalX * depthOffset, y: br.y + normalY * depthOffset };
        const tl = { x: bl.x + normalX * depthOffset, y: bl.y + normalY * depthOffset };
        const points = [bl, br, tr, tl];
        this.groundPlaneHitbox = new PolygonHitbox(points.map(p => ({ x: p.x, y: p.y })));
        this.visualHitbox = new PolygonHitbox(points.map(p => ({ x: p.x, y: p.y })));
        const fallbackSamplePoint = {
            x: (bl.x + br.x + tr.x + tl.x) * 0.25,
            y: (bl.y + br.y + tr.y + tl.y) * 0.25
        };
        const initialSamplePoint = (
            this._doorInitialVisibilitySamplePoint &&
            Number.isFinite(this._doorInitialVisibilitySamplePoint.x) &&
            Number.isFinite(this._doorInitialVisibilitySamplePoint.y)
        ) ? this._doorInitialVisibilitySamplePoint : null;
        this._losVisibilitySamplePoint = (
            initialSamplePoint && fallAngle < 15
        ) ? {
            x: Number(initialSamplePoint.x),
            y: Number(initialSamplePoint.y)
        } : fallbackSamplePoint;
    }

    updateFallenDoorDepthBillboardMesh(ctx = null, camera = null, options = {}) {
        if (this._compositeUnderlayMesh) this._compositeUnderlayMesh.visible = false;
        this._compositeUnderlayShouldRender = false;
        const sprite = this.pixiSprite;
        const fallbackTexture = (typeof this.texturePath === "string" && this.texturePath.length > 0)
            ? PIXI.Texture.from(this.texturePath)
            : null;
        const sourceTexture = (sprite && sprite.texture) ? sprite.texture : (fallbackTexture || null);
        if (!sourceTexture) {
            if (this._depthBillboardMesh) this._depthBillboardMesh.visible = false;
            return null;
        }
        if (!camera) {
            if (this._depthBillboardMesh) this._depthBillboardMesh.visible = false;
            return null;
        }

        const mesh = this.ensureDepthBillboardMesh(null, options.alphaCutoff, {
            forceSinglePlane: true
        });
        if (!mesh || !mesh.shader || !mesh.shader.uniforms || !this._depthBillboardWorldPositions) {
            if (this._depthBillboardMesh) this._depthBillboardMesh.visible = false;
            return null;
        }

        const leafLayer = Array.isArray(this.compositeLayers) && this.compositeLayers[0]
            ? this.compositeLayers[0]
            : null;
        if (leafLayer) {
            StaticObject._setCompositeLayerUvs(mesh, sourceTexture, leafLayer.uRegion, false);
        } else {
            this.updateDepthBillboardUvsForTexture(mesh, sourceTexture, false);
        }

        const worldX = Number.isFinite(this.x) ? Number(this.x) : 0;
        const worldY = Number.isFinite(this.y) ? Number(this.y) : 0;
        const viewScale = Math.max(1e-6, Math.abs(Number(camera.viewscale) || 1));
        const xyRatio = Math.max(1e-6, Math.abs(Number(camera.xyratio) || 1));
        const worldWidth = Math.max(0.01, Number.isFinite(this.width)
            ? Number(this.width)
            : (Math.abs(Number(sprite && sprite.width) || 0) / viewScale));
        const worldHeightZ = Math.max(0.01, Number.isFinite(this.height)
            ? (Number(this.height) / xyRatio)
            : (Math.abs(Number(sprite && sprite.height) || 0) / (viewScale * xyRatio)));
        const anchorX = Number.isFinite(this.placeableAnchorX) ? Number(this.placeableAnchorX) : 0.5;
        const angleDeg = Number.isFinite(this.placementRotation) ? Number(this.placementRotation) : 0;
        const theta = angleDeg * (Math.PI / 180);
        const axisX = Math.cos(theta);
        const axisY = Math.sin(theta);
        const normalX = -axisY;
        const normalY = axisX;
        const halfWidth = worldWidth * 0.5;
        const alongOffset = (anchorX - 0.5) * worldWidth;
        const faceCenters = (
            this.depthBillboardFaceCenters &&
            this.depthBillboardFaceCenters.front &&
            this.depthBillboardFaceCenters.back &&
            Number.isFinite(this.depthBillboardFaceCenters.front.x) &&
            Number.isFinite(this.depthBillboardFaceCenters.front.y) &&
            Number.isFinite(this.depthBillboardFaceCenters.back.x) &&
            Number.isFinite(this.depthBillboardFaceCenters.back.y)
        ) ? this.depthBillboardFaceCenters : null;
        const hingeZ = 0.001;
        const fallAngle = Math.max(0, Math.min(90, Number.isFinite(this.doorFallAngle) ? Number(this.doorFallAngle) : 0));
        const fallRadians = fallAngle * (Math.PI / 180);
        const fallSign = Number.isFinite(this._doorFallNormalSign) && this._doorFallNormalSign < 0 ? -1 : 1;
        const mountedWallThickness = resolveMountedWallThickness(this);
        const hingeOutwardOffset = Math.max(
            0.02,
            Number.isFinite(mountedWallThickness)
                ? (Math.max(0.001, Number(mountedWallThickness)) * 0.5 + 0.02)
                : 0.08
        );
        const hingeFace = (fallSign >= 0)
            ? (faceCenters && faceCenters.front ? faceCenters.front : null)
            : (faceCenters && faceCenters.back ? faceCenters.back : null);
        const hingeCenterX = hingeFace
            ? (Number(hingeFace.x) - axisX * alongOffset + normalX * fallSign * hingeOutwardOffset)
            : (worldX - axisX * alongOffset);
        const hingeCenterY = hingeFace
            ? (Number(hingeFace.y) - axisY * alongOffset + normalY * fallSign * hingeOutwardOffset)
            : (worldY - axisY * alongOffset);
        const topOffset = Math.sin(fallRadians) * worldHeightZ * fallSign;
        const topZ = Math.max(hingeZ, hingeZ + Math.cos(fallRadians) * worldHeightZ);

        const bl = { x: hingeCenterX - axisX * halfWidth, y: hingeCenterY - axisY * halfWidth, z: hingeZ };
        const br = { x: hingeCenterX + axisX * halfWidth, y: hingeCenterY + axisY * halfWidth, z: hingeZ };
        const tr = { x: br.x + normalX * topOffset, y: br.y + normalY * topOffset, z: topZ };
        const tl = { x: bl.x + normalX * topOffset, y: bl.y + normalY * topOffset, z: topZ };

        const signature = [
            bl.x, bl.y, bl.z,
            br.x, br.y, br.z,
            tr.x, tr.y, tr.z,
            tl.x, tl.y, tl.z,
            fallAngle, fallSign, worldWidth, worldHeightZ, angleDeg
        ].map(v => Number(v).toFixed(4)).join("|");
        if (signature !== this._depthBillboardLastSignature) {
            const positions = this._depthBillboardWorldPositions;
            positions[0] = bl.x; positions[1] = bl.y; positions[2] = bl.z;
            positions[3] = br.x; positions[4] = br.y; positions[5] = br.z;
            positions[6] = tr.x; positions[7] = tr.y; positions[8] = tr.z;
            positions[9] = tl.x; positions[10] = tl.y; positions[11] = tl.z;
            const worldBuffer = mesh.geometry.getBuffer("aWorldPosition");
            if (worldBuffer) worldBuffer.update();
            this._depthBillboardLastSignature = signature;
        }

        const uniforms = mesh.shader.uniforms;
        const viewportHeight = Number(ctx && ctx.viewport && ctx.viewport.height) || 30;
        const nearMetric = -Math.max(80, viewportHeight * 0.6);
        const farMetric = Math.max(180, viewportHeight * 2.0 + 80);
        const depthSpanInv = 1 / Math.max(1e-6, farMetric - nearMetric);
        const screenW = (ctx && ctx.app && ctx.app.screen && Number.isFinite(ctx.app.screen.width))
            ? Number(ctx.app.screen.width)
            : 1;
        const screenH = (ctx && ctx.app && ctx.app.screen && Number.isFinite(ctx.app.screen.height))
            ? Number(ctx.app.screen.height)
            : 1;
        const tint = Number.isFinite(sprite && sprite.tint) ? Number(sprite.tint) : 0xFFFFFF;
        uniforms.uScreenSize[0] = Math.max(1, screenW);
        uniforms.uScreenSize[1] = Math.max(1, screenH);
        uniforms.uCameraWorld[0] = Number(camera.x) || 0;
        uniforms.uCameraWorld[1] = Number(camera.y) || 0;
        const mapRef = this.map || (ctx && ctx.map) || null;
        uniforms.uWorldSize[0] = (mapRef && Number.isFinite(mapRef.worldWidth) && mapRef.worldWidth > 0)
            ? Number(mapRef.worldWidth)
            : 0;
        uniforms.uWorldSize[1] = (mapRef && Number.isFinite(mapRef.worldHeight) && mapRef.worldHeight > 0)
            ? Number(mapRef.worldHeight)
            : 0;
        uniforms.uWrapEnabled[0] = (mapRef && mapRef.wrapX !== false) ? 1 : 0;
        uniforms.uWrapEnabled[1] = (mapRef && mapRef.wrapY !== false) ? 1 : 0;
        uniforms.uWrapAnchorWorld[0] = worldX;
        uniforms.uWrapAnchorWorld[1] = worldY;
        uniforms.uViewScale = Number(camera.viewscale) || 1;
        uniforms.uXyRatio = Number(camera.xyratio) || 1;
        uniforms.uDepthRange[0] = farMetric;
        uniforms.uDepthRange[1] = depthSpanInv;
        uniforms.uTint[0] = ((tint >> 16) & 255) / 255;
        uniforms.uTint[1] = ((tint >> 8) & 255) / 255;
        uniforms.uTint[2] = (tint & 255) / 255;
        uniforms.uTint[3] = Number.isFinite(sprite && sprite.alpha) ? Number(sprite.alpha) : 1;
        uniforms.uAlphaCutoff = Number.isFinite(options.alphaCutoff) ? Number(options.alphaCutoff) : 0.08;
        uniforms.uClipMinZ = this._scriptSinkState ? 0 : -1000000;
        uniforms.uSampler = sourceTexture || PIXI.Texture.WHITE;
        uniforms.uZOffset = 0.0;
        mesh.visible = true;
        return mesh;
    }

    updateDepthBillboardMesh(ctx = null, camera = null, options = {}) {
        if (this.isFallenDoorEffect) {
            return this.updateFallenDoorDepthBillboardMesh(ctx, camera, options);
        }
        return super.updateDepthBillboardMesh(ctx, camera, options);
    }

    update() {
        super.update();

        if ((this.isOpen || this._doorLockedOpen || this.isFallenDoorEffect) && this.pixiSprite) {
            this.pixiSprite.tint = 0xFFFFFF;
        }

        // 1. If it's a closed door and gets destroyed, stay alive as an open door and spawn a falling dummy.
        if (this.hp <= 0 && !this.isOpen && this.isDoorObject() && !this.isFallenDoorEffect) {
            this.hp = 1; // It can't be destroyed again once open
            this.isOpen = true; // Shows only the arch now
            this._doorLockedOpen = true;
            this.blocksTile = false;
            this.isPassable = true;
            this.castsLosShadows = false;
            if (this.pixiSprite) this.pixiSprite.tint = 0xFFFFFF;
            this.notifyMountedWallStateChanged();

            const opts = Object.assign({}, this._placedObjectExplicit || {});
            opts.texturePath = this.texturePath;
            opts.category = this.category;
            opts.width = this.width;
            opts.height = this.height;
            opts.placementRotation = this.placementRotation;
            opts.rotationAxis = this.rotationAxis;
            opts.renderDepthOffset = this.renderDepthOffset;
            opts.isFallenDoorEffect = true;
            opts.placeableAnchorX = this.placeableAnchorX;
            opts.placeableAnchorY = this.placeableAnchorY;
            opts.compositeLayers = this.compositeLayers;
            opts.doorFallNormalSign = Number.isFinite(this._doorFallNormalSign) ? this._doorFallNormalSign : 1;
            opts.doorFallAngle = 0;
            // Spawn unmounted so it survives wall destruction!
            opts.mountedWallLineGroupId = null;
            opts.mountedSectionId = null;
            opts.mountedWallSectionUnitId = null;

            const dummy = new PlacedObject({ x: this.x, y: this.y }, this.map, opts);
            dummy.depthBillboardFaceCenters = getMountedWallFaceCentersForObject(this);
            if (dummy.depthBillboardFaceCenters) {
                const viewerPoint = (
                    typeof globalThis !== "undefined" &&
                    globalThis.wizard &&
                    Number.isFinite(globalThis.wizard.x) &&
                    Number.isFinite(globalThis.wizard.y)
                ) ? {
                    x: Number(globalThis.wizard.x),
                    y: Number(globalThis.wizard.y)
                } : {
                    x: Number.isFinite(this.x) ? Number(this.x) : 0,
                    y: Number.isFinite(this.y) ? Number(this.y) : 0
                };
                const initialSide = chooseMountedWallFaceCenterForViewer(dummy.depthBillboardFaceCenters, viewerPoint, this.map || null);
                const initialFace = (
                    initialSide === "back" && dummy.depthBillboardFaceCenters.back
                ) ? dummy.depthBillboardFaceCenters.back : dummy.depthBillboardFaceCenters.front;
                if (initialFace && Number.isFinite(initialFace.x) && Number.isFinite(initialFace.y)) {
                    dummy._doorInitialVisibilitySamplePoint = {
                        x: Number(initialFace.x),
                        y: Number(initialFace.y)
                    };
                    dummy._losVisibilitySamplePoint = {
                        x: Number(initialFace.x),
                        y: Number(initialFace.y)
                    };
                }
            }
            dummy.z = this.z;
            dummy.rotation = this.placementRotation;
            dummy.hp = 0;
            dummy.falling = true;
            dummy.fallStart = typeof frameCount !== "undefined" ? frameCount : 0;
            dummy.doorFallAngle = 0;
            dummy.blocksTile = false;
            dummy.isPassable = true;
            dummy.castsLosShadows = false;
            if (typeof this.visible === "boolean") dummy.visible = this.visible;
            if (Number.isFinite(this.brightness)) dummy.brightness = Number(this.brightness);
            if (dummy.pixiSprite) dummy.pixiSprite.tint = 0xFFFFFF;
            // Unlink scripts
            dummy._scriptSinkState = null;
            dummy.playerEnters = "";
            dummy.playerExits = "";
            
            // Drop dummy to same tile
            if (typeof dummy.moveNode === "function") {
                dummy.moveNode(this.getNode());
            } else {
                this.map.addObject(dummy);
            }
            if (typeof globalThis !== "undefined" && globalThis.activeSimObjects instanceof Set) {
                globalThis.activeSimObjects.add(dummy);
            }
        }

        // 2. If it's the falling dummy, handle animation.
        if (this.isFallenDoorEffect && this.falling) {
            const currentFrame = typeof frameCount !== "undefined" ? frameCount : 0;
            const start = this.fallStart || currentFrame;
            const elapsed = currentFrame - start;
            
            // Accelerating fall logic
            const accelFactor = Math.min(elapsed / 30, 1);
            const rotationRate = 3.5 * accelFactor;
            
            this.doorFallAngle = Math.max(0, Math.min(90, (Number(this.doorFallAngle) || 0) + rotationRate));
            if (this.doorFallAngle >= 90) {
                this.doorFallAngle = 90;
                this.falling = false;
            }
        }
        if (this.isFallenDoorEffect) {
            this.updateFallenDoorVisibilityHitbox();
        }
    }
}


if (typeof globalThis !== "undefined") {
    globalThis.getResolvedPlaceableMetadata = getResolvedPlaceableMetadata;
    globalThis.normalizePlaceableRotationAxis = normalizePlaceableRotationAxis;
}

class TriggerArea extends StaticObject {
    constructor(location, map, options = {}) {
        const seed = location || { x: 0, y: 0 };
        super('triggerArea', seed, 1, 1, [PIXI.Texture.WHITE], map);
        this.objectType = "triggerArea";
        this.isTriggerArea = true;
        this.rotationAxis = "ground";
        this.blocksTile = false;
        this.isPassable = true;
        this.castsLosShadows = false;
        this.flammable = false;
        this.pixiSprite.alpha = 0;
        this.pixiSprite.visible = false;
        this.pixiSprite.renderable = false;
        this.pixiSprite.anchor.set(0.5, 0.5);
        this.playerEnters = normalizeDoorEventScript(options.playerEnters);
        this.playerExits = normalizeDoorEventScript(options.playerExits);
        this.polygonPoints = [];
        this._triggerAreaIndexedNodes = [];
        this.setPolygonPoints(Array.isArray(options.points) ? options.points : []);
        if (this.map && Array.isArray(this.map.objects) && !this.map.objects.includes(this)) {
            this.map.objects.push(this);
        }
    }

    _reindexTriggerAreaNodes(points) {
        const mapRef = this.map || null;
        const oldNodes = Array.isArray(this._triggerAreaIndexedNodes) ? this._triggerAreaIndexedNodes : [];
        for (let i = 0; i < oldNodes.length; i++) {
            const node = oldNodes[i];
            if (node && typeof node.removeObject === "function") {
                node.removeObject(this);
            }
        }
        this._triggerAreaIndexedNodes = [];

        if (!mapRef || typeof mapRef.worldToNode !== "function" || !Array.isArray(points) || points.length < 3) {
            return;
        }

        const samplePoints = [];
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            if (!a || !b) continue;
            samplePoints.push({ x: Number(a.x), y: Number(a.y) });
            const dx = Number(b.x) - Number(a.x);
            const dy = Number(b.y) - Number(a.y);
            const edgeLen = Math.hypot(dx, dy);
            if (!(edgeLen > 0)) continue;
            const spacing = 1.0;
            const steps = Math.min(1024, Math.floor(edgeLen / spacing));
            for (let s = 1; s < steps; s++) {
                const t = s / steps;
                samplePoints.push({
                    x: Number(a.x) + dx * t,
                    y: Number(a.y) + dy * t
                });
            }
        }
        samplePoints.push({ x: Number(this.x), y: Number(this.y) });

        const nodes = [];
        const nodeKeys = new Set();
        for (let i = 0; i < samplePoints.length; i++) {
            const pt = samplePoints[i];
            if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
            const node = mapRef.worldToNode(pt.x, pt.y);
            if (!node) continue;
            const key = `${Number(node.xindex)}:${Number(node.yindex)}`;
            if (nodeKeys.has(key)) continue;
            nodeKeys.add(key);
            nodes.push(node);
        }

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (node && typeof node.addObject === "function") {
                node.addObject(this);
            }
        }
        this._triggerAreaIndexedNodes = nodes;
        this.node = (typeof mapRef.worldToNode === "function")
            ? mapRef.worldToNode(this.x, this.y)
            : (nodes[0] || null);
    }

    setPolygonPoints(rawPoints) {
        const points = Array.isArray(rawPoints)
            ? rawPoints
                .map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) }))
                .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
            : [];
        if (points.length < 3) return false;

        this.polygonPoints = points;
        this.groundPlaneHitbox = new PolygonHitbox(points.map((p) => ({ x: p.x, y: p.y })));
        this.visualHitbox = this.groundPlaneHitbox;

        const bounds = this.groundPlaneHitbox.getBounds();
        const minX = Number(bounds.x) || 0;
        const minY = Number(bounds.y) || 0;
        const width = Math.max(1e-4, Number(bounds.width) || 0);
        const height = Math.max(1e-4, Number(bounds.height) || 0);
        this.width = width;
        this.height = height;
        this.x = minX + width * 0.5;
        this.y = minY + height * 0.5;
        this.groundRadius = Math.max(width, height) * 0.5;
        this.visualRadius = this.groundRadius;
        this._reindexTriggerAreaNodes(points);
        return true;
    }

    removeFromNodes() {
        const indexedNodes = Array.isArray(this._triggerAreaIndexedNodes) ? this._triggerAreaIndexedNodes : [];
        if (indexedNodes.length === 0) {
            super.removeFromNodes();
            return;
        }
        for (let i = 0; i < indexedNodes.length; i++) {
            const node = indexedNodes[i];
            if (node && typeof node.removeObject === "function") {
                node.removeObject(this);
            }
        }
        this._triggerAreaIndexedNodes = [];
        this.node = null;
    }

    saveJson() {
        const data = super.saveJson();
        data.type = "triggerArea";
        data.points = Array.isArray(this.polygonPoints)
            ? this.polygonPoints.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
            : [];
        if (typeof this.playerEnters === "string" && this.playerEnters.trim().length > 0) {
            data.playerEnters = this.playerEnters.trim();
        }
        if (typeof this.playerExits === "string" && this.playerExits.trim().length > 0) {
            data.playerExits = this.playerExits.trim();
        }
        data.isPassable = true;
        data.castsLosShadows = false;
        return data;
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
    globalThis.TriggerArea = TriggerArea;
    globalThis.Road = Road;
    globalThis.getMountedWallFaceCentersForObject = getMountedWallFaceCentersForObject;
}
