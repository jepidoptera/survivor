function pointInPolygon2D(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x;
        const yi = points[i].y;
        const xj = points[j].x;
        const yj = points[j].y;
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-7) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function recordMoveObjectPerfEvent(name, data = null, elapsedMs = null) {
    if (
        typeof globalThis === "undefined" ||
        !globalThis.__moveObjectPerf ||
        typeof globalThis.__recordMoveObjectPerf !== "function"
    ) {
        return;
    }
    globalThis.__recordMoveObjectPerf(name, data, elapsedMs);
}

function getPolygonBounds2D(points) {
    if (!Array.isArray(points) || points.length < 3) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < points.length; i++) {
        const x = Number(points[i] && points[i].x);
        const y = Number(points[i] && points[i].y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
    return { minX, minY, maxX, maxY };
}

function polygonBoundsOverlap2D(a, b) {
    if (!a || !b) return false;
    return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
}

function pointOnSegment2D(px, py, ax, ay, bx, by, eps = 1e-7) {
    const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
    if (Math.abs(cross) > eps) return false;
    const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
    if (dot < -eps) return false;
    const len2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
    return dot <= len2 + eps;
}

function getPointSegmentDistanceSq2D(px, py, ax, ay, bx, by) {
    const closest = getClosestPointOnSegment2D(px, py, ax, ay, bx, by);
    const dx = px - closest.x;
    const dy = py - closest.y;
    return dx * dx + dy * dy;
}

function getClosestPointOnSegment2D(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    if (!(lenSq > 1e-12)) {
        return { x: ax, y: ay, t: 0 };
    }
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    return { x: cx, y: cy, t };
}

function getPointPolygonBoundaryDistanceSq2D(px, py, points) {
    if (!Array.isArray(points) || points.length < 3) return Infinity;
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const ax = Number(a && a.x);
        const ay = Number(a && a.y);
        const bx = Number(b && b.x);
        const by = Number(b && b.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
        best = Math.min(best, getPointSegmentDistanceSq2D(px, py, ax, ay, bx, by));
    }
    return best;
}

function getClosestPointOnPolygonBoundary2D(px, py, points, label = "polygon boundary") {
    if (!Array.isArray(points) || points.length < 3) {
        throw new Error(`${label} requires at least three points`);
    }
    let best = null;
    let bestDistSq = Infinity;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const ax = Number(a && a.x);
        const ay = Number(a && a.y);
        const bx = Number(b && b.x);
        const by = Number(b && b.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
            throw new Error(`${label} contains a non-finite point`);
        }
        const abx = bx - ax;
        const aby = by - ay;
        const lenSq = abx * abx + aby * aby;
        const t = lenSq > 1e-12
            ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq))
            : 0;
        const x = ax + abx * t;
        const y = ay + aby * t;
        const dx = px - x;
        const dy = py - y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
            bestDistSq = distSq;
            best = { x, y, distSq };
        }
    }
    if (!best || !Number.isFinite(best.distSq)) {
        throw new Error(`${label} could not resolve a closest boundary point`);
    }
    return best;
}

function normalizeTerrainCollisionRing2D(points, label) {
    if (!Array.isArray(points) || points.length < 3) {
        throw new Error(`${label} requires at least three points`);
    }
    const out = [];
    for (let i = 0; i < points.length; i++) {
        const x = Number(points[i] && points[i].x);
        const y = Number(points[i] && points[i].y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error(`${label} contains a non-finite point`);
        }
        out.push({ x, y });
    }
    return out;
}

function resolveCircleTerrainPolygonCollision2D(polygon, hitbox, label = "terrain polygon") {
    if (!polygon || typeof polygon !== "object") {
        throw new Error(`${label} collision requires a polygon`);
    }
    const cx = Number(hitbox && hitbox.x);
    const cy = Number(hitbox && hitbox.y);
    const radius = Number(hitbox && hitbox.radius);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(radius) || radius < 0) {
        throw new Error(`${label} collision requires a finite circle hitbox`);
    }
    const outer = normalizeTerrainCollisionRing2D(polygon.points, `${label}.points`);
    const holes = Array.isArray(polygon.holes)
        ? polygon.holes.map((hole, index) => normalizeTerrainCollisionRing2D(hole, `${label}.holes[${index}]`))
        : [];
    const bounds = getPolygonBounds2D(outer);
    if (!bounds) {
        throw new Error(`${label} collision could not resolve polygon bounds`);
    }
    if (
        cx + radius < bounds.minX ||
        cx - radius > bounds.maxX ||
        cy + radius < bounds.minY ||
        cy - radius > bounds.maxY
    ) {
        return null;
    }

    const insideOuter = pointInPolygon2D(cx, cy, outer);
    let containingHole = null;
    for (let i = 0; i < holes.length; i++) {
        if (pointInPolygon2D(cx, cy, holes[i])) {
            containingHole = holes[i];
            break;
        }
    }

    const pushFromClosest = (closest, directionSign, requiredDistance) => {
        const dist = Math.sqrt(Math.max(0, closest.distSq));
        let dx = cx - closest.x;
        let dy = cy - closest.y;
        if (!(dist > 1e-9)) {
            const fallbackX = cx - ((bounds.minX + bounds.maxX) * 0.5);
            const fallbackY = cy - ((bounds.minY + bounds.maxY) * 0.5);
            const fallbackLen = Math.hypot(fallbackX, fallbackY);
            if (fallbackLen > 1e-9) {
                dx = fallbackX / fallbackLen;
                dy = fallbackY / fallbackLen;
            } else {
                dx = 1;
                dy = 0;
            }
        } else {
            dx /= dist;
            dy /= dist;
        }
        const distance = Math.max(0, Number(requiredDistance) || 0);
        return {
            pushX: dx * directionSign * distance,
            pushY: dy * directionSign * distance,
            overlap: distance
        };
    };

    if (!insideOuter) {
        const closestOuter = getClosestPointOnPolygonBoundary2D(cx, cy, outer, `${label}.points`);
        const dist = Math.sqrt(Math.max(0, closestOuter.distSq));
        if (dist >= radius) return null;
        return pushFromClosest(closestOuter, 1, radius - dist);
    }

    if (containingHole) {
        const closestHole = getClosestPointOnPolygonBoundary2D(cx, cy, containingHole, `${label}.hole`);
        const dist = Math.sqrt(Math.max(0, closestHole.distSq));
        if (dist >= radius) return null;
        return pushFromClosest(closestHole, 1, radius - dist);
    }

    let closestBoundary = getClosestPointOnPolygonBoundary2D(cx, cy, outer, `${label}.points`);
    for (let i = 0; i < holes.length; i++) {
        const closestHole = getClosestPointOnPolygonBoundary2D(cx, cy, holes[i], `${label}.holes[${i}]`);
        if (closestHole.distSq < closestBoundary.distSq) {
            closestBoundary = closestHole;
        }
    }
    const dist = Math.sqrt(Math.max(0, closestBoundary.distSq));
    return pushFromClosest(closestBoundary, -1, dist + radius);
}

function segmentsIntersect2D(a, b, c, d) {
    if (!a || !b || !c || !d) return false;
    const ax = Number(a.x), ay = Number(a.y);
    const bx = Number(b.x), by = Number(b.y);
    const cx = Number(c.x), cy = Number(c.y);
    const dx = Number(d.x), dy = Number(d.y);
    if (![ax, ay, bx, by, cx, cy, dx, dy].every(Number.isFinite)) return false;
    const orient = (px, py, qx, qy, rx, ry) => {
        const v = (qy - py) * (rx - qx) - (qx - px) * (ry - qy);
        if (Math.abs(v) <= 1e-7) return 0;
        return v > 0 ? 1 : 2;
    };
    const o1 = orient(ax, ay, bx, by, cx, cy);
    const o2 = orient(ax, ay, bx, by, dx, dy);
    const o3 = orient(cx, cy, dx, dy, ax, ay);
    const o4 = orient(cx, cy, dx, dy, bx, by);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && pointOnSegment2D(cx, cy, ax, ay, bx, by)) return true;
    if (o2 === 0 && pointOnSegment2D(dx, dy, ax, ay, bx, by)) return true;
    if (o3 === 0 && pointOnSegment2D(ax, ay, cx, cy, dx, dy)) return true;
    if (o4 === 0 && pointOnSegment2D(bx, by, cx, cy, dx, dy)) return true;
    return false;
}

function polygonsOverlap2D(aPoints, bPoints) {
    const a = Array.isArray(aPoints) ? aPoints : [];
    const b = Array.isArray(bPoints) ? bPoints : [];
    if (a.length < 3 || b.length < 3) return false;
    if (!polygonBoundsOverlap2D(getPolygonBounds2D(a), getPolygonBounds2D(b))) return false;
    for (let i = 0; i < a.length; i++) {
        if (pointInPolygon2D(Number(a[i].x), Number(a[i].y), b)) return true;
    }
    for (let i = 0; i < b.length; i++) {
        if (pointInPolygon2D(Number(b[i].x), Number(b[i].y), a)) return true;
    }
    for (let i = 0; i < a.length; i++) {
        const a0 = a[i];
        const a1 = a[(i + 1) % a.length];
        for (let j = 0; j < b.length; j++) {
            if (segmentsIntersect2D(a0, a1, b[j], b[(j + 1) % b.length])) return true;
        }
    }
    return false;
}

function getPolygonClippingApi2D() {
    return (typeof globalThis !== "undefined" && globalThis.polygonClipping)
        ? globalThis.polygonClipping
        : null;
}

function polygonToClipRing2D(points) {
    if (!Array.isArray(points) || points.length < 3) return null;
    const ring = [];
    for (let i = 0; i < points.length; i++) {
        const x = Number(points[i] && points[i].x);
        const y = Number(points[i] && points[i].y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        ring.push([x, y]);
    }
    if (ring.length < 3) return null;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!last || Math.abs(first[0] - last[0]) > 1e-9 || Math.abs(first[1] - last[1]) > 1e-9) {
        ring.push([first[0], first[1]]);
    }
    return ring;
}

function floorFragmentToClipGeometry2D(fragment, getPolygonFn) {
    const outer = typeof getPolygonFn === "function"
        ? getPolygonFn(fragment)
        : (fragment && fragment.outerPolygon);
    const outerRing = polygonToClipRing2D(outer);
    if (!outerRing) return [];
    const polygon = [outerRing];
    const holes = Array.isArray(fragment && fragment.holes) ? fragment.holes : [];
    for (let i = 0; i < holes.length; i++) {
        const ring = polygonToClipRing2D(holes[i]);
        if (ring) polygon.push(ring);
    }
    return [polygon];
}

function clipGeometryIsEmpty2D(geometry) {
    if (!Array.isArray(geometry) || geometry.length === 0) return true;
    for (let i = 0; i < geometry.length; i++) {
        const polygon = geometry[i];
        if (Array.isArray(polygon) && Array.isArray(polygon[0]) && polygon[0].length >= 4) return false;
    }
    return true;
}

function clipRingToPolygonPoints2D(ring, label = "clip ring") {
    if (!Array.isArray(ring) || ring.length < 4) {
        throw new Error(`${label} requires a closed ring`);
    }
    const points = [];
    const limit = ring.length > 1 &&
        Math.abs(Number(ring[0][0]) - Number(ring[ring.length - 1][0])) <= 1e-9 &&
        Math.abs(Number(ring[0][1]) - Number(ring[ring.length - 1][1])) <= 1e-9
        ? ring.length - 1
        : ring.length;
    for (let i = 0; i < limit; i++) {
        const x = Number(ring[i] && ring[i][0]);
        const y = Number(ring[i] && ring[i][1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error(`${label} contains a non-finite point`);
        }
        points.push({ x, y });
    }
    if (points.length < 3) throw new Error(`${label} produced fewer than three points`);
    return points;
}

function distanceToSegment2D(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const abLen2 = abx * abx + aby * aby;
    if (abLen2 <= 1e-7) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2));
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    return Math.hypot(px - cx, py - cy);
}

function buildBlendedGroundTextureFromBase(baseTexture, options = {}) {
    const source = baseTexture && baseTexture.baseTexture && baseTexture.baseTexture.resource
        ? baseTexture.baseTexture.resource.source
        : null;
    if (!source) return null;

    const outSize = options.outSize || 200;
    const scale = options.scale || 1.1;
    const featherRatio = Number.isFinite(options.featherRatio) ? options.featherRatio : 0.25;
    const featherPx = Math.max(1, featherRatio * outSize);
    const minFeatherAlpha = Number.isFinite(options.minFeatherAlpha) ? options.minFeatherAlpha : 0.0;

    const canvas = document.createElement("canvas");
    canvas.width = outSize;
    canvas.height = outSize;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    const drawSize = outSize * scale;
    const drawOffset = (outSize - drawSize) / 2;
    ctx.clearRect(0, 0, outSize, outSize);
    ctx.drawImage(source, drawOffset, drawOffset, drawSize, drawSize);

    const imageData = ctx.getImageData(0, 0, outSize, outSize);
    const data = imageData.data;

    // Hex matching existing forest tile orientation (flat top/bottom, points on left/right).
    const hex = [
        { x: 0, y: outSize * 0.5 },
        { x: outSize * 0.25, y: 0 },
        { x: outSize * 0.75, y: 0 },
        { x: outSize, y: outSize * 0.5 },
        { x: outSize * 0.75, y: outSize },
        { x: outSize * 0.25, y: outSize }
    ];

    // Feather only the top-facing edges for top-down painter's-order blending.
    // Edge indices in this hex:
    // 0: left-mid -> top-left
    // 1: top-left -> top-right
    // 2: top-right -> right-mid
    // 3: right-mid -> bottom-right
    // 4: bottom-right -> bottom-left
    // 5: bottom-left -> left-mid
    const featherEdgeIndices = [0, 1, 2];

    for (let y = 0; y < outSize; y++) {
        for (let x = 0; x < outSize; x++) {
            const idx = (y * outSize + x) * 4;
            if (!pointInPolygon2D(x + 0.5, y + 0.5, hex)) {
                data[idx + 3] = 0;
                continue;
            }

            let minDist = Infinity;
            for (const i of featherEdgeIndices) {
                const a = hex[i];
                const b = hex[(i + 1) % hex.length];
                const d = distanceToSegment2D(x + 0.5, y + 0.5, a.x, a.y, b.x, b.y);
                if (d < minDist) minDist = d;
            }
            const edgeFactor = Math.max(0, Math.min(1, minDist / featherPx));
            const alphaFactor = minFeatherAlpha + (1 - minFeatherAlpha) * edgeFactor;
            data[idx + 3] = Math.round(255 * alphaFactor);
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return PIXI.Texture.from(canvas);
}

function createRuntimeGroundTexture(texturePath, onReady) {
    const base = PIXI.Texture.from(texturePath);
    const apply = () => {
        const blended = buildBlendedGroundTextureFromBase(base, {
            outSize: 200,
            scale: 1.0,
            featherRatio: 0.25,
            minFeatherAlpha: 0.0
        });
        if (blended && typeof onReady === "function") {
            onReady(blended);
        }
    };
    if (base.baseTexture && base.baseTexture.valid) {
        apply();
    } else if (base.baseTexture) {
        base.baseTexture.once("loaded", apply);
    }
    return base;
}

const FOREST_GROUND_BASE_COUNT = 13;
const FOREST_GROUND_TEXTURE_COUNT = 52;
// IDs 0-51 are legacy grass/forest variants already present in saved section assets.
const GROUND_TERRAIN_DEFS = [
    {
        name: "grass",
        label: "Grass",
        idStart: 0,
        baseCount: FOREST_GROUND_BASE_COUNT,
        textureNames: Array.from({ length: FOREST_GROUND_TEXTURE_COUNT }, (_unused, index) => `forest${index}`),
        icon: "/assets/images/land tiles/forest0.png",
        polygonMaterial: "/assets/images/terrain/materials/grass.png",
        polygonMaterialScale: 10
    },
    {
        name: "desert",
        label: "Desert",
        idStart: FOREST_GROUND_TEXTURE_COUNT,
        baseCount: 1,
        textureNames: ["desert", "desert0", "desert1", "desert2"],
        icon: "/assets/images/land tiles/desert0.png",
        polygonMaterial: "/assets/images/terrain/materials/sand.png",
        polygonMaterialScale: 1
    },
    {
        name: "water",
        label: "Water",
        idStart: FOREST_GROUND_TEXTURE_COUNT + 1,
        baseCount: 1,
        textureNames: ["water1", "water2", "water3"],
        icon: "/assets/images/land tiles/water1.png",
        polygonMaterial: "/assets/images/terrain/materials/water.png",
        polygonMaterialScale: 4
    },
    {
        name: "mud",
        label: "Mud",
        idStart: FOREST_GROUND_TEXTURE_COUNT + 2,
        baseCount: 1,
        textureNames: ["mud"],
        texturePaths: ["/assets/images/terrain/materials/dirt.png"],
        icon: "/assets/images/terrain/materials/dirt.png",
        polygonMaterial: "/assets/images/terrain/materials/dirt.png",
        polygonMaterialScale: 20
    }
];

function cloneGroundTerrainDefForUi(def) {
    return {
        name: def.name,
        label: def.label,
        idStart: def.idStart,
        baseCount: def.baseCount,
        icon: def.icon,
        polygonMaterial: def.polygonMaterial,
        polygonMaterialScale: def.polygonMaterialScale
    };
}

function getGroundTerrainDefsWithOffsets() {
    let textureOffset = 0;
    return GROUND_TERRAIN_DEFS.map((def) => {
        const next = { ...def, textureOffset };
        textureOffset += def.textureNames.length;
        return next;
    });
}

const GROUND_TERRAIN_DEFS_WITH_OFFSETS = getGroundTerrainDefsWithOffsets();
const GROUND_TERRAIN_ID_COUNT = GROUND_TERRAIN_DEFS_WITH_OFFSETS.reduce((maxId, def) => (
    Math.max(maxId, def.idStart + def.baseCount)
), 0);
const GROUND_TERRAIN_TEXTURE_NAMES = GROUND_TERRAIN_DEFS_WITH_OFFSETS.flatMap(def => def.textureNames);
const GROUND_TERRAIN_TEXTURE_PATHS = GROUND_TERRAIN_DEFS_WITH_OFFSETS.flatMap(def => {
    if (Array.isArray(def.texturePaths) && def.texturePaths.length === def.textureNames.length) {
        return def.texturePaths;
    }
    return def.textureNames.map(name => `/assets/images/land tiles/${name}.png`);
});

function getGroundTerrainDefForTextureId(textureId) {
    const id = Number.isFinite(textureId) ? Math.floor(Number(textureId)) : NaN;
    if (!Number.isFinite(id)) {
        throw new Error("ground terrain id must be finite");
    }
    if (id >= 0 && id < FOREST_GROUND_TEXTURE_COUNT) {
        return GROUND_TERRAIN_DEFS_WITH_OFFSETS[0];
    }
    for (let i = 0; i < GROUND_TERRAIN_DEFS_WITH_OFFSETS.length; i++) {
        const def = GROUND_TERRAIN_DEFS_WITH_OFFSETS[i];
        if (id >= def.idStart && id < def.idStart + def.baseCount) {
            return def;
        }
    }
    throw new Error(`unknown ground terrain id ${id}`);
}

function resolveGroundTerrainTextureIndexForNode(node) {
    if (!node) {
        throw new Error("ground terrain texture resolution requires a node");
    }
    const rawId = Number(node.groundTextureId);
    const textureId = Number.isFinite(rawId) ? Math.floor(rawId) : 0;
    const x = Number.isFinite(node.xindex) ? Math.floor(node.xindex) : 0;
    const y = Number.isFinite(node.yindex) ? Math.floor(node.yindex) : 0;

    if (textureId >= 0 && textureId < FOREST_GROUND_TEXTURE_COUNT) {
        const baseId = Math.max(0, Math.min(FOREST_GROUND_BASE_COUNT - 1, textureId));
        const seed = ((x * 73856093) ^ (y * 19349663) ^ (baseId * 83492791)) >>> 0;
        const variant = seed % 4;
        const variantTextureIndex = baseId + (variant * FOREST_GROUND_BASE_COUNT);
        return (variantTextureIndex * 17) % FOREST_GROUND_TEXTURE_COUNT;
    }

    const def = getGroundTerrainDefForTextureId(textureId);
    const localBaseId = textureId - def.idStart;
    const variantCount = Math.max(1, Math.floor(def.textureNames.length / Math.max(1, def.baseCount)));
    const seed = ((x * 73856093) ^ (y * 19349663) ^ (textureId * 83492791)) >>> 0;
    const variant = seed % variantCount;
    return def.textureOffset + localBaseId + (variant * def.baseCount);
}

function isNonBlockingSunkObject(obj) {
    const sinkState = (obj && typeof obj === "object" && obj._scriptSinkState && typeof obj._scriptSinkState === "object")
        ? obj._scriptSinkState
        : null;
    return !!(
        sinkState &&
        sinkState.nonBlocking !== false
    );
}

function doesObjectBlockTile(obj) {
    return !!(obj && !obj.gone && obj.blocksTile !== false && !isNonBlockingSunkObject(obj));
}

function doesObjectBlockPassage(obj) {
    return !!(obj && !obj.gone && obj.isPassable === false && !isNonBlockingSunkObject(obj));
}

function hasActiveDirectionalBlockers(blockers) {
    if (!(blockers instanceof Set) || blockers.size === 0) return false;
    for (const blocker of blockers) {
        if (!blocker || blocker.gone) continue;
        if (isNonBlockingSunkObject(blocker)) continue;
        return true;
    }
    return false;
}

if (typeof globalThis !== "undefined") {
    globalThis.isNonBlockingSunkObject = isNonBlockingSunkObject;
    globalThis.doesObjectBlockTile = doesObjectBlockTile;
    globalThis.doesObjectBlockPassage = doesObjectBlockPassage;
    globalThis.hasActiveDirectionalBlockers = hasActiveDirectionalBlockers;
}

class MinPriorityQueue {
    constructor() {
        this.items = [];
    }

    push(value, priority) {
        this.items.push({ value, priority });
        this.bubbleUp(this.items.length - 1);
    }

    pop() {
        if (this.items.length === 0) return null;
        const top = this.items[0];
        const last = this.items.pop();
        if (this.items.length > 0 && last) {
            this.items[0] = last;
            this.sinkDown(0);
        }
        return top;
    }

    isEmpty() {
        return this.items.length === 0;
    }

    bubbleUp(index) {
        let currentIndex = index;
        while (currentIndex > 0) {
            const parentIndex = Math.floor((currentIndex - 1) / 2);
            if (this.items[parentIndex].priority <= this.items[currentIndex].priority) break;
            [this.items[parentIndex], this.items[currentIndex]] = [this.items[currentIndex], this.items[parentIndex]];
            currentIndex = parentIndex;
        }
    }

    sinkDown(index) {
        let currentIndex = index;
        const length = this.items.length;
        while (true) {
            const leftIndex = currentIndex * 2 + 1;
            const rightIndex = currentIndex * 2 + 2;
            let smallest = currentIndex;

            if (leftIndex < length && this.items[leftIndex].priority < this.items[smallest].priority) {
                smallest = leftIndex;
            }
            if (rightIndex < length && this.items[rightIndex].priority < this.items[smallest].priority) {
                smallest = rightIndex;
            }
            if (smallest === currentIndex) break;
            [this.items[currentIndex], this.items[smallest]] = [this.items[smallest], this.items[currentIndex]];
            currentIndex = smallest;
        }
    }
}

function markFloorNodeRenderObjectCacheDirty(node, obj) {
    if (!node || typeof node.fragmentId !== "string" || node.fragmentId.length === 0) return;
    if (!obj) return;
    const animalCtor = typeof globalThis !== "undefined" ? globalThis.Animal : null;
    if (animalCtor && obj instanceof animalCtor) return;
    if (typeof globalThis !== "undefined" && obj === globalThis.wizard) return;
    if (obj.type === "powerup") return;
    const mapRef = (obj && obj.map) || (typeof globalThis !== "undefined" ? globalThis.map : null) || null;
    if (mapRef && typeof mapRef.markFloorObjectNodeCacheDirty === "function") {
        mapRef.markFloorObjectNodeCacheDirty();
    }
}

class MapNode {
    constructor(x, y, mapWidth, mapHeight) {
        this.x = x * 0.866;
        this.y = y + (x % 2 === 0 ? 0.5 : 0);
        this.xindex = x;
        this.yindex = y;
        this.traversalLayer = 0;
        this.baseZ = 0;
        this.portalEdges = [];
        this.id = `${x},${y},0`;
        
        // Initialize neighbors array with length 12
        // Indices correspond to hunter sprite rows, starting with left and going counterclockwise:
        // 0: left, 1: up-left, 2: up, 3: up-right, 4: right, 5: down-right
        // 6: down, 7: down-left, 8-11: double-distance variants
        this.neighbors = new Array(12).fill(null);
        this.neighborOffsets = new Array(12).fill(null);
        
        // Track which walls are blocking each neighbor direction
        // Map<direction, Set<wallObjects>>
        this.blockedNeighbors = new Map();

        // Multiple static objects can occupy the same tile
        this.objects = [];
        this.visibilityObjects = [];
        this.blockedByObjects = 0;
        this.blocked = false;
        this.clearance = Infinity; // min hex-ring distance to nearest obstacle (0 = blocked)
        this.groundTextureId = 0;
        
        // Define direction offsets based on even/odd column
        // All indices follow counterclockwise from left
        const isEven = x % 2 === 0;
        let offsets;
        
        if (isEven) {
            offsets = [
                {x: -2, y: 0},   // 0: far left
                {x: -1, y: 0},   // 1: up-left
                {x: -1, y: -1},  // 2: far up-left
                {x: 0, y: -1},    // 3: up
                {x: 1, y: -1},   // 4: far up-right
                {x: 1, y: 0},    // 5: up-right
                {x: 2, y: 0},    // 6: far right
                {x: 1, y: 1},    // 7: down-right
                {x: 1, y: 2},    // 8: far down-right
                {x: 0, y: 1},    // 9: down
                {x: -1, y: 2},   // 10: far down left
                {x: -1, y: 1},   // 11: down-left
            ];
        } else {
            offsets = [
                {x: -2, y: 0},   // 0: far left
                {x: -1, y: -1},  // 1: up-left
                {x: -1, y: -2},  // 2: far up-left
                {x: 0, y: -1},   // 3: up
                {x: 1, y: -2},   // 4: far up-right
                {x: 1, y: -1},   // 5: up-right
                {x: 2, y: 0},    // 6: far right
                {x: 1, y: 0},    // 7: down-right
                {x: 1, y: 1},    // 8: far down-right
                {x: 0, y: 1},    // 9: down
                {x: -1, y: 1},   // 10: far down left
                {x: -1, y: 0},   // 11: down-left
            ];
        }
        
        // Store neighbor offsets. Active map tiles keep full offsets so torus
        // stitching can reconnect edges later in setNeighbors.
        for (let i = 0; i < offsets.length; i++) {
            const offset = offsets[i];
            const nx = x + offset.x;
            const ny = y + offset.y;

            const isActiveTile = x >= 0 && x < mapWidth && y >= 0 && y < mapHeight;
            if (isActiveTile) {
                this.neighborOffsets[i] = offset;
            } else if (nx >= -1 && nx < mapWidth && ny >= -1 && ny < mapHeight) {
                this.neighborOffsets[i] = offset;
            }
        }
    }
    
    setNeighbors(nodes, mapRef = null) {
        // Populate the neighbors array after all nodes are created
        for (let i = 0; i < this.neighborOffsets.length; i++) {
            if (this.neighborOffsets[i]) {
                const offset = this.neighborOffsets[i];
                let nx = this.xindex + offset.x;
                let ny = this.yindex + offset.y;

                if (mapRef && this.xindex >= 0 && this.yindex >= 0) {
                    if (mapRef.wrapX) {
                        nx = mapRef.wrapIndexX(nx);
                    }
                    if (mapRef.wrapY) {
                        ny = mapRef.wrapIndexY(ny);
                    }
                }

                this.neighbors[i] = (nodes[nx] && nodes[nx][ny]) ? nodes[nx][ny] : null;
            }
        }
    }

    addObject(obj) {
        if (!this.objects) this.objects = [];
        const mapRef = (obj && obj.map) || (typeof globalThis !== "undefined" ? globalThis.map : null) || null;
        const wasBlocked = !!(this.blocked || this.blockedByObjects > 0);
        this.objects.push(obj);
        markFloorNodeRenderObjectCacheDirty(this, obj);
        if (doesObjectBlockTile(obj)) {
            this.blockedByObjects = Math.max(0, Number(this.blockedByObjects) || 0) + 1;
        }
        const isBlockedNow = !!(this.blocked || this.blockedByObjects > 0);
        if (!wasBlocked && isBlockedNow) {
            // Tile just became blocked — propagate clearance update
            // (skipped when bulk-loading a save with cached clearance).
            if (typeof globalThis !== "undefined" && globalThis.map &&
                !globalThis.map._suppressClearanceUpdates &&
                typeof globalThis.map.updateClearanceAround === "function") {
                globalThis.map.updateClearanceAround(this);
            }
        }
        const animalCtor = typeof globalThis !== "undefined" ? globalThis.Animal : null;
        const shouldDirtyBuildingCache = !!(
            obj &&
            obj !== (typeof globalThis !== "undefined" ? globalThis.wizard : null) &&
            obj.type !== "powerup" &&
            !(animalCtor && obj instanceof animalCtor) &&
            obj._suppressBuildingRenderCacheDirty !== true
        );
        recordMoveObjectPerfEvent("mapNode.addObject", {
            objectType: obj && obj.type || "",
            suppressedBuildingDirty: !!(obj && obj._suppressBuildingRenderCacheDirty === true),
            dirtyBuildingCache: shouldDirtyBuildingCache,
            nodeId: this.id || ""
        });
        if (shouldDirtyBuildingCache && mapRef && typeof mapRef.markBuildingRenderCacheDirty === "function") {
            mapRef.markBuildingRenderCacheDirty();
        }
        if (
            typeof globalThis !== "undefined" &&
            typeof globalThis.invalidateMinimap === "function" &&
            !(mapRef && mapRef._suppressClearanceUpdates)
        ) {
            globalThis.invalidateMinimap();
        }
    }

    addVisibilityObject(obj) {
        if (!obj) return;
        if (!this.visibilityObjects) this.visibilityObjects = [];
        if (this.visibilityObjects.includes(obj)) return;
        this.visibilityObjects.push(obj);
        markFloorNodeRenderObjectCacheDirty(this, obj);
    }

    removeObject(obj) {
        if (!this.objects) return;
        const wasBlocked = !!(this.blocked || this.blockedByObjects > 0);
        const idx = this.objects.indexOf(obj);
        if (idx === -1) return;
        const removed = this.objects[idx];
        this.objects.splice(idx, 1);
        const mapRef = (removed && removed.map) || (typeof globalThis !== "undefined" ? globalThis.map : null) || null;
        markFloorNodeRenderObjectCacheDirty(this, removed);
        if (doesObjectBlockTile(removed)) {
            this.blockedByObjects = Math.max(0, (Number(this.blockedByObjects) || 0) - 1);
        }
        const isBlockedNow = !!(this.blocked || this.blockedByObjects > 0);
        if (wasBlocked && !isBlockedNow) {
            // Tile just became passable — recompute clearance in neighbourhood
            // (skipped when bulk-loading a save with cached clearance).
            if (typeof globalThis !== "undefined" && globalThis.map &&
                !globalThis.map._suppressClearanceUpdates &&
                typeof globalThis.map.updateClearanceAround === "function") {
                globalThis.map.updateClearanceAround(this);
            }
        }
        const animalCtor = typeof globalThis !== "undefined" ? globalThis.Animal : null;
        const shouldDirtyBuildingCache = !!(
            removed &&
            removed !== (typeof globalThis !== "undefined" ? globalThis.wizard : null) &&
            removed.type !== "powerup" &&
            !(animalCtor && removed instanceof animalCtor) &&
            removed._suppressBuildingRenderCacheDirty !== true
        );
        recordMoveObjectPerfEvent("mapNode.removeObject", {
            objectType: removed && removed.type || "",
            suppressedBuildingDirty: !!(removed && removed._suppressBuildingRenderCacheDirty === true),
            dirtyBuildingCache: shouldDirtyBuildingCache,
            nodeId: this.id || ""
        });
        if (shouldDirtyBuildingCache && mapRef && typeof mapRef.markBuildingRenderCacheDirty === "function") {
            mapRef.markBuildingRenderCacheDirty();
        }
        if (
            typeof globalThis !== "undefined" &&
            typeof globalThis.invalidateMinimap === "function" &&
            !(mapRef && mapRef._suppressClearanceUpdates)
        ) {
            globalThis.invalidateMinimap();
        }
    }

    removeVisibilityObject(obj) {
        if (!this.visibilityObjects) return;
        const idx = this.visibilityObjects.indexOf(obj);
        if (idx !== -1) {
            this.visibilityObjects.splice(idx, 1);
            markFloorNodeRenderObjectCacheDirty(this, obj);
        }
    }

    recountBlockingObjects() {
        if (!this.objects || this.objects.length === 0) {
            this.blockedByObjects = 0;
            return;
        }
        let count = 0;
        for (let i = 0; i < this.objects.length; i++) {
            const obj = this.objects[i];
            if (doesObjectBlockTile(obj)) count += 1;
        }
        this.blockedByObjects = count;
    }

    hasObjects() {
        return !!(this.objects && this.objects.length > 0);
    }

    hasBlockingObject() {
        if (this.blockedByObjects <= 0) return false;
        if (!this.objects || this.objects.length === 0) return false;
        for (let i = 0; i < this.objects.length; i++) {
            if (doesObjectBlockTile(this.objects[i])) return true;
        }
        return false;
    }

    /**
     * Returns true when this tile is impassable (blocked flag or blocking object).
     */
    isBlocked() {
        return this.blocked || this.hasBlockingObject();
    }
}

// ─── Hex anchor navigation (nodes + midpoints unified) ────────────────────
//
// A midpoint is a pure value-type: { nodeA, nodeB, k } where
//   nodeA.neighbors[k] === nodeB  and  k ∈ [0, 5].
// Canonical form: the node whose neighbor slot index (k) is in 0–5 is nodeA.
// No caching needed — identity is the unordered (nodeA, nodeB) pair.
//
// Direction numbering follows MapNode convention (0=far-left, 1=up-left, …).
// Odd directions are immediate (1 hex step); even are diagonal (2 hex steps).
// Both nodes and midpoints have neighbors at all 12 directions.

function makeMidpoint(nodeX, nodeY) {
    if (!nodeX || !nodeY) return null;
    for (let d = 0; d < 6; d++) {
        if (nodeX.neighbors[d] === nodeY) return { nodeA: nodeX, nodeB: nodeY, k: d,
            x: (nodeX.x + nodeY.x) * 0.5, y: (nodeX.y + nodeY.y) * 0.5 };
        if (nodeY.neighbors[d] === nodeX) return { nodeA: nodeY, nodeB: nodeX, k: d,
            x: (nodeX.x + nodeY.x) * 0.5, y: (nodeX.y + nodeY.y) * 0.5 };
    }
    return null; // nodes are not adjacent
}

// Returns the next anchor (node or midpoint) from midpoint (nodeA, nodeB, k)
// when stepping in direction d (0–11).
//
// Derivation: for k=3, the full table (verified against geometric layout) is:
//   d=3 -> nodeB,  d=9 -> nodeA  (axis endpoints)
//   all others -> a midpoint one step away, via one of the bounding nodes.
// The general formula uses offset o = (d - k + 12) % 12 and two pivot
// directions fwd=(k+4)%12 and bck=(k+10)%12.
function midpointNeighborInDirection(nodeA, nodeB, k, d) {
    const norm = v => ((v % 12) + 12) % 12;
    const o   = norm(d - k);
    const fwd = norm(k + 4);
    const bck = norm(k + 10);
    switch (o) {
        case 0:  return nodeB;
        case 1:  return makeMidpoint(nodeB, nodeB.neighbors[norm(k + 2)]);
        case 2:  return makeMidpoint(nodeB, nodeB.neighbors[fwd]);
        case 3:  return nodeB.neighbors[fwd];
        case 4:  return makeMidpoint(nodeA, nodeB.neighbors[fwd]);
        case 5:  return makeMidpoint(nodeA, nodeA.neighbors[fwd]);
        case 6:  return nodeA;
        case 7:  return makeMidpoint(nodeA, nodeA.neighbors[norm(k + 8)]);
        case 8:  return makeMidpoint(nodeA, nodeA.neighbors[bck]);
        case 9:  return nodeA.neighbors[bck];
        case 10: return makeMidpoint(nodeB, nodeA.neighbors[bck]);
        case 11: return makeMidpoint(nodeB, nodeB.neighbors[bck]);
        default: return null;
    }
}

// Returns the next anchor from a plain node when stepping in direction d.
//   Odd  d → midpoint between node and its immediate neighbor[d]
//   Even d → midpoint between the two immediate neighbors flanking direction d
//            i.e. between neighbors[d-1] and neighbors[d+1]
function nodeNeighborInDirection(node, d) {
    const dir = ((d % 12) + 12) % 12;
    if (dir % 2 === 1) {
        // Odd: land on the midpoint shared with the immediate neighbor.
        const nb = node.neighbors[dir];
        if (!nb) return null;
        return makeMidpoint(node, nb);
    } else {
        // Even: diagonal step — land on midpoint between the two flanking nodes.
        const L = node.neighbors[(dir + 11) % 12];
        const R = node.neighbors[(dir +  1) % 12];
        if (!L || !R) return null;
        return makeMidpoint(L, R);
    }
}

// Uniform entry point — works identically for nodes and midpoints.
// anchor is either a MapNode or a midpoint descriptor { nodeA, nodeB, k }.
function anchorNeighborInDirection(anchor, dir) {
    if (!anchor) return null;
    if (anchor.k !== undefined) {
        return midpointNeighborInDirection(anchor.nodeA, anchor.nodeB, anchor.k, dir);
    }
    return nodeNeighborInDirection(anchor, dir);
}

// Bump this whenever the clearance BFS algorithm changes so that
// save files with stale cached clearance are automatically recomputed.
const CLEARANCE_VERSION = 3;

const _floorNodeCtorWorkMap = new WeakMap();
function _tryMakeFloorNodeFromCtor(SourceCtor, x, y) {
    try {
        return new SourceCtor(x, y, 1, 1);
    } catch (_err) {
        return null;
    }
}

class GameMap {
    constructor(width, height, options, callback) {
        const _t0 = performance.now();
        const opts = options || {};
        this.width = width;
        this.height = height;
        this.wrapX = opts.wrapX !== false;
        this.wrapY = opts.wrapY !== false;
        if ((this.wrapX || this.wrapY) && ((this.width % 2 !== 0) || (this.height % 2 !== 0)) && typeof console !== "undefined") {
            console.warn("Torus wrap works best with even map dimensions; current size is", this.width, "x", this.height);
        }
        this.scenery = {};
        this.animalImages = {};
        this.nodes = [];
        // Legacy static-object list used by existing save/load/editor paths.
        this.objects = [];
        // Canonical cross-system runtime registry (walls, placed objects, animals, powerups, etc).
        this.gameObjects = [];
        this.resetFloorRuntimeState();
        this.hexHeight = 1;
        this.hexWidth = 1 / 0.866;
        this.worldWidth = this.width * 0.866;
        this.worldHeight = this.height;
        this.pathfindingSnapshotVersion = 1;
        this.groundTerrainDefs = GROUND_TERRAIN_DEFS_WITH_OFFSETS.map(cloneGroundTerrainDefForUi);
        this.terrainPolygons = [];
        this._groundBridgeBarrierCacheVersion = 1;
        this._groundBridgeBlockingEdgeCache = new WeakMap();
        this.groundPalette = GROUND_TERRAIN_TEXTURE_NAMES.slice();
        this.groundTexturePaths = GROUND_TERRAIN_TEXTURE_PATHS.slice();
        this.groundTextures = this.groundPalette.map(() => PIXI.Texture.WHITE);
        this.groundPalette.forEach((name, idx) => {
            const path = this.groundTexturePaths[idx];
            if (typeof path !== "string" || path.length === 0) {
                throw new Error(`missing ground terrain texture path at palette index ${idx}`);
            }
            this.groundTextures[idx] = createRuntimeGroundTexture(path, (processed) => {
                this.groundTextures[idx] = processed;
            });
        });

        const scenery = (opts.skipScenery === true) ? [] : [
            {type: "tree", frequency: 4},
            {type: "playground", frequency: 0}
        ];
        const animal_types = (opts.skipAnimals === true) ? [] : [
            {type: "squirrel", frequency: 180, isMokemon: false},
            {type: "deer", frequency: 75, isMokemon: false},
            {type: "bear", frequency: 14, isMokemon: false},
        ];
        const terrain = {type: "forest"};
        scenery.forEach((item, i) => {
            this.scenery[item.type] = [];
            try {
                this.scenery[item.type] = {type: item.type, textures: [], frequency: item.frequency};
                // For playground (single image), load just one texture
                if (item.type === "playground") {
                    this.scenery[item.type].textures[0] = PIXI.Texture.from(`/assets/images/${item.type}.png`);
                    for (let n = 1; n < 5; n++) {
                        this.scenery[item.type].textures[n] = this.scenery[item.type].textures[0]; // Reuse single texture
                    }
                } else {
                    // For trees, rocks, etc., load 5 variants
                    for (let n = 0; n < 5; n++) {
                        if (item.type === "tree") {
                            this.scenery[item.type].textures[n] = PIXI.Texture.from(`/assets/images/trees/tree${n}.png`);
                        } else {
                            this.scenery[item.type].textures[n] = PIXI.Texture.from(`/assets/images/${item.type.replace(' ', '')}${n}.png`);
                        }
                    }
                }
            }
            catch{
                this.scenery[item.type] = undefined;
            }

        })
        animal_types.forEach((animal, i) => {
            if (animal.frequency > 0 && !animal.isMokemon) {
                this.animalImages[animal.type] = PIXI.Texture.from(`./assets/images/animals/${animal.type}.png`);
            } else if (animal.frequency > 0 && animal.isMokemon) {
                this.animalImages[animal.type] = PIXI.Texture.from(`./assets/images/mokemon/${animal.type}.png`);
            }
        })

        // Ground is rendered per-tile by the active rendering pipeline using node.groundTextureId.
        landTileSprite = null;

        console.log("generating nodes...");
        const _t1 = performance.now();
        console.log(`[MAP TIMING] setup/textures: ${(_t1 - _t0).toFixed(1)}ms`);

        let index = 0;
        for (let x = -1; x < this.width; x++) {
            this.nodes[x] = [];
            for (let y = -1; y < this.height; y++) {
                this.nodes[x][y] = new MapNode(x, y, this.width, this.height);
                this.nodes[x][y].index = index;
                if (x >= 0 && y >= 0) {
                    this.nodes[x][y].groundTextureId = Math.floor(Math.random() * FOREST_GROUND_BASE_COUNT);
                }
                
                // Randomly spawn scenery on this node
                Object.keys(this.scenery).forEach(index => {
                    let item = this.scenery[index];
                        if (!this.nodes[Math.max(x-1, -1)][y].hasObjects()
                        && !this.nodes[x][Math.max(y-1,-1)].hasObjects()
                        && !this.nodes[Math.max(x-1, -1)][Math.max(x-1, -1)].hasObjects()
                        && !this.nodes[x][y].blocked
                    && Math.random() * 100 < item.frequency) {
                        let staticObject;
                        let width = 4;
                        let height = 4;
                        
                        const node = this.nodes[x][y];
                        if (item.type === "tree") {
                            staticObject = new Tree(node, item.textures, this);
                        }
                        else if (item.type === "rock") {
                            width = .25 + Math.random() * .5;
                            height = .25 + Math.random() * .5;
                            staticObject = new StaticObject(item.type, node, width, height, item.textures, this);
                        }
                        else if (item.type === "cactus") {
                            width = 1;
                            height = 2;
                            staticObject = new StaticObject(item.type, node, width, height, item.textures, this);
                        }
                        else if (item.type === "playground") {
                            staticObject = new Playground(node, item.textures, this);
                        }
                        else if (item.type === "road") {
                            staticObject = new Road(node, item.textures, this);
                        }
                        else {
                            staticObject = new StaticObject(item.type, node, width, height, item.textures, this);
                        }
                    }
                })
            }
        }
        
        // Now that all nodes are created, populate their neighbor references
        const _t2 = performance.now();
        console.log(`[MAP TIMING] node creation + scenery: ${(_t2 - _t1).toFixed(1)}ms`);
        for (let x = -1; x < this.width; x++) {
            for (let y = -1; y < this.height; y++) {
                this.nodes[x][y].setNeighbors(this.nodes, this);
            }
        }
        const _t3 = performance.now();
        console.log(`[MAP TIMING] setNeighbors: ${(_t3 - _t2).toFixed(1)}ms`);
        animal_types.forEach((animal, i) => {
            console.log("generating animals:", animal.type);
            for (let n = 0; n < animal.frequency; n++) {
                const x = Math.floor(Math.random() * this.width);
                const y = Math.floor(Math.random() * this.height);
                const node = this.nodes[x][y];
                let animalInstance;
                
                // Create the appropriate animal subclass
                switch(animal.type) {
                    case 'deer':
                        animalInstance = new Deer(node, this);
                        break;
                    case 'bear':
                        animalInstance = new Bear(node, this);
                        break;
                    case 'eagleman':
                        animalInstance = new Eagleman(node, this);
                        break;
                    case 'squirrel':
                        animalInstance = new Squirrel(node, this);
                        break;
                    case 'scorpion':
                        animalInstance = new Scorpion(node, this);
                        break;
                    case 'armadillo':
                        animalInstance = new Armadillo(node, this);
                        break;
                    case 'coyote':
                        animalInstance = new Coyote(node, this);
                        break;
                    case 'goat':
                        animalInstance = new Goat(node, this);
                        break;
                    case 'porcupine':
                        animalInstance = new Porcupine(node, this);
                        break;
                    case 'yeti':
                        animalInstance = new Yeti(node, this);
                        break;
                    default:
                        animalInstance = new Animal(animal.type, node, this);
                }
                
                animals.push(animalInstance);
            }
        })
        
        // Compute initial clearance values after all scenery is placed,
        // unless the caller signals a save-file load will supply them.
        if (!opts.skipClearance) {
            const _t4 = performance.now();
            this.computeClearance();
            console.log(`[MAP TIMING] computeClearance: ${(performance.now() - _t4).toFixed(1)}ms`);
        } else {
            console.log(`[MAP TIMING] computeClearance: SKIPPED`);
        }
        const _tEnd = performance.now();
        console.log(`[MAP TIMING] TOTAL constructor: ${(_tEnd - _t0).toFixed(1)}ms`);

        if (callback) setTimeout(() => callback(this), 100 );
    }

    registerGameObject(obj) {
        if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return false;
        if (!Array.isArray(this.gameObjects)) this.gameObjects = [];
        if (!this.gameObjects.includes(obj)) {
            this.gameObjects.push(obj);
            this._gameObjectRegistryVersion = (Number(this._gameObjectRegistryVersion) || 0) + 1;
            this.markBuildingRenderCacheDirty();
            return true;
        }
        return false;
    }

    unregisterGameObject(obj) {
        if (!obj || !Array.isArray(this.gameObjects)) return false;
        const idx = this.gameObjects.indexOf(obj);
        if (idx < 0) return false;
        this.gameObjects.splice(idx, 1);
        this._gameObjectRegistryVersion = (Number(this._gameObjectRegistryVersion) || 0) + 1;
        this.markBuildingRenderCacheDirty();
        return true;
    }

    rebuildGameObjectRegistry() {
        if (!Array.isArray(this.gameObjects)) this.gameObjects = [];
        this.gameObjects.length = 0;
        const seen = new Set();
        const addObject = (obj) => {
            if (!obj || obj.gone || (typeof obj !== "object" && typeof obj !== "function")) return;
            if (obj.map && obj.map !== this) return;
            if (seen.has(obj)) return;
            seen.add(obj);
            this.gameObjects.push(obj);
        };

        if (Array.isArray(this.objects)) {
            for (let i = 0; i < this.objects.length; i++) {
                addObject(this.objects[i]);
            }
        }

        // Objects attached to map nodes (static objects, walls, placed objects, etc).
        for (let x = 0; x < this.width; x++) {
            const column = this.nodes[x];
            if (!Array.isArray(column)) continue;
            for (let y = 0; y < this.height; y++) {
                const node = column[y];
                if (!node || !Array.isArray(node.objects)) continue;
                for (let i = 0; i < node.objects.length; i++) {
                    addObject(node.objects[i]);
                }
            }
        }

        if (typeof this.getAllPrototypeNodes === "function") {
            const prototypeNodes = this.getAllPrototypeNodes();
            if (Array.isArray(prototypeNodes)) {
                for (let i = 0; i < prototypeNodes.length; i++) {
                    const node = prototypeNodes[i];
                    if (!node || !Array.isArray(node.objects)) continue;
                    for (let j = 0; j < node.objects.length; j++) {
                        addObject(node.objects[j]);
                    }
                }
            }
        }

        // Upper-floor runtime objects are attached to floor nodes, not the
        // base grid. They must be part of the canonical object registry for
        // scripting, targeting, debug lookup, and render-side object scans.
        if (this.floorNodesById instanceof Map) {
            for (const floorNodes of this.floorNodesById.values()) {
                if (!Array.isArray(floorNodes)) continue;
                for (let i = 0; i < floorNodes.length; i++) {
                    const node = floorNodes[i];
                    if (!node || !Array.isArray(node.objects)) continue;
                    for (let j = 0; j < node.objects.length; j++) {
                        addObject(node.objects[j]);
                    }
                }
            }
        }

        // Wall sections are authoritative in their own map.
        const wallCtor = (typeof globalThis !== "undefined" && globalThis.WallSectionUnit)
            ? globalThis.WallSectionUnit
            : null;
        if (wallCtor && wallCtor._allSections instanceof Map) {
            for (const section of wallCtor._allSections.values()) {
                addObject(section);
            }
        }

        // Dynamic characters/pickups. Prefer globalThis refs, with loose-global
        // fallback for runtime setups that don't mirror arrays onto globalThis.
        const animalsCandidates = [
            (typeof globalThis !== "undefined" && Array.isArray(globalThis.animals)) ? globalThis.animals : null,
            (typeof animals !== "undefined" && Array.isArray(animals)) ? animals : null
        ];
        for (let i = 0; i < animalsCandidates.length; i++) {
            const animalsList = animalsCandidates[i];
            if (!Array.isArray(animalsList)) continue;
            for (let j = 0; j < animalsList.length; j++) {
                addObject(animalsList[j]);
            }
        }

        const powerupsCandidates = [
            (typeof globalThis !== "undefined" && Array.isArray(globalThis.powerups)) ? globalThis.powerups : null,
            (typeof powerups !== "undefined" && Array.isArray(powerups)) ? powerups : null
        ];
        for (let i = 0; i < powerupsCandidates.length; i++) {
            const powerupsList = powerupsCandidates[i];

            if (!Array.isArray(powerupsList)) continue;
            for (let j = 0; j < powerupsList.length; j++) {
                addObject(powerupsList[j]);
            }
        }

        const wizardRef = (typeof globalThis !== "undefined" && globalThis.wizard)
            ? globalThis.wizard
            : null;
        if (wizardRef) {
            addObject(wizardRef);
        }

        this._gameObjectRegistryFloorObjectVersion = Number(this._floorObjectNodeCacheVersion) || 0;
        this._gameObjectRegistryVersion = (Number(this._gameObjectRegistryVersion) || 0) + 1;
        return this.gameObjects;
    }

    getGameObjects(options = null) {
        const opts = (options && typeof options === "object") ? options : {};
        if (!Array.isArray(this.gameObjects)) this.gameObjects = [];
        const floorObjectVersion = Number(this._floorObjectNodeCacheVersion) || 0;
        const registryFloorObjectVersion = Number(this._gameObjectRegistryFloorObjectVersion) || 0;
        if (
            opts.refresh === true ||
            this.gameObjects.length === 0 ||
            registryFloorObjectVersion !== floorObjectVersion
        ) {
            this.rebuildGameObjectRegistry();
        }
        return this.gameObjects;
    }

    resetFloorRuntimeState() {
        this.floorsById = new Map();
        this.floorFragmentsByLayer = new Map();
        this._floorFragmentLayerIndexDirty = false;
        this._floorFragmentLayerIndexSize = 0;
        this.floorObjectsByMembershipKey = new Map();
        this.floorObjectMembershipsByKey = new Map();
        this._floorObjectMembershipKeyByObject = new WeakMap();
        this.floorFragmentsBySurfaceId = new Map();
        this.floorFragmentsBySectionKey = new Map();
        this.floorNodesById = new Map();
        this.floorNodeIndex = new Map();
        this.floorNodeLayerIndex = new Map();
        this.buildingsById = new Map();
        this.floorBuildingByFragmentId = new Map();
        this._floorBuildingsDirty = true;
        this._floorBuildingVersion = 0;
        this._buildingRenderCacheVersion = 0;
        this.transitionsById = new Map();
        this.stairsById = new Map();
        this.markFloorObjectNodeCacheDirty();
    }

    normalizeFloorObjectMembership(membership, options = {}) {
        const opts = options && typeof options === "object" ? options : {};
        const required = opts.required !== false;
        const sourceLabel = typeof opts.sourceLabel === "string" && opts.sourceLabel.length > 0
            ? opts.sourceLabel
            : "floor object";
        const candidate = membership && typeof membership === "object" ? membership : null;
        const ownerType = typeof (candidate && candidate.ownerType) === "string" ? candidate.ownerType : "";
        const ownerId = typeof (candidate && candidate.ownerId) === "string" ? candidate.ownerId : "";
        const floorId = typeof (candidate && candidate.floorId) === "string" ? candidate.floorId : "";
        if (ownerType && ownerId && floorId) {
            return {
                ownerType,
                ownerId,
                floorId
            };
        }
        if (required) {
            throw new Error(`${sourceLabel} requires canonical floor membership with ownerType, ownerId, and floorId`);
        }
        return null;
    }

    getFloorObjectMembershipKey(membership, options = {}) {
        const normalized = this.normalizeFloorObjectMembership(membership, options);
        if (!normalized) return "";
        return `${normalized.ownerType}|${normalized.ownerId}|${normalized.floorId}`;
    }

    getFloorObjectMembershipForObject(obj, options = {}) {
        const opts = options && typeof options === "object" ? options : {};
        const floorSupportApi = (typeof globalThis !== "undefined") ? globalThis.FloorSupport : null;
        let membership = floorSupportApi && typeof floorSupportApi.getEntityFloorMembership === "function"
            ? floorSupportApi.getEntityFloorMembership(obj, { map: this })
            : null;
        if (!membership && obj && typeof obj === "object") {
            membership = obj._floorMembership && typeof obj._floorMembership === "object"
                ? obj._floorMembership
                : (obj.floorMembership && typeof obj.floorMembership === "object" ? obj.floorMembership : null);
        }
        return this.normalizeFloorObjectMembership(membership, {
            required: opts.required !== false,
            sourceLabel: opts.sourceLabel || "floor object registration"
        });
    }

    registerFloorObject(obj) {
        if (!obj || typeof obj !== "object") {
            throw new Error("floor object registration requires an object");
        }
        const membership = this.getFloorObjectMembershipForObject(obj, { required: true });
        const key = this.getFloorObjectMembershipKey(membership);
        if (!key) {
            throw new Error("floor object registration produced an empty membership key");
        }
        if (!(this.floorObjectsByMembershipKey instanceof Map)) this.floorObjectsByMembershipKey = new Map();
        if (!(this.floorObjectMembershipsByKey instanceof Map)) this.floorObjectMembershipsByKey = new Map();
        if (!(this._floorObjectMembershipKeyByObject instanceof WeakMap)) this._floorObjectMembershipKeyByObject = new WeakMap();
        const previousKey = this._floorObjectMembershipKeyByObject.get(obj) || "";
        if (previousKey && previousKey !== key) {
            const previousSet = this.floorObjectsByMembershipKey.get(previousKey);
            if (previousSet instanceof Set) {
                previousSet.delete(obj);
                if (previousSet.size === 0) {
                    this.floorObjectsByMembershipKey.delete(previousKey);
                    this.floorObjectMembershipsByKey.delete(previousKey);
                }
            }
        }
        let set = this.floorObjectsByMembershipKey.get(key);
        if (!(set instanceof Set)) {
            set = new Set();
            this.floorObjectsByMembershipKey.set(key, set);
        }
        const hadObject = set.has(obj);
        set.add(obj);
        this.floorObjectMembershipsByKey.set(key, membership);
        this._floorObjectMembershipKeyByObject.set(obj, key);
        obj._floorMembership = { ...membership };
        if (!hadObject || previousKey !== key) {
            this.markFloorObjectNodeCacheDirty();
            if (typeof this.markBuildingRenderCacheDirty === "function") this.markBuildingRenderCacheDirty();
        }
        return membership;
    }

    unregisterFloorObject(obj) {
        if (!obj || typeof obj !== "object") return false;
        const key = this._floorObjectMembershipKeyByObject instanceof WeakMap
            ? (this._floorObjectMembershipKeyByObject.get(obj) || "")
            : "";
        const fallbackKey = key || this.getFloorObjectMembershipKey(
            this.getFloorObjectMembershipForObject(obj, { required: false }),
            { required: false }
        );
        if (!fallbackKey || !(this.floorObjectsByMembershipKey instanceof Map)) return false;
        const set = this.floorObjectsByMembershipKey.get(fallbackKey);
        if (!(set instanceof Set) || !set.delete(obj)) return false;
        if (this._floorObjectMembershipKeyByObject instanceof WeakMap) {
            this._floorObjectMembershipKeyByObject.delete(obj);
        }
        if (set.size === 0) {
            this.floorObjectsByMembershipKey.delete(fallbackKey);
            if (this.floorObjectMembershipsByKey instanceof Map) this.floorObjectMembershipsByKey.delete(fallbackKey);
        }
        this.markFloorObjectNodeCacheDirty();
        if (typeof this.markBuildingRenderCacheDirty === "function") this.markBuildingRenderCacheDirty();
        return true;
    }

    getObjectsForFloorMembership(membership) {
        const key = this.getFloorObjectMembershipKey(membership, { required: false });
        if (!key || !(this.floorObjectsByMembershipKey instanceof Map)) return [];
        const set = this.floorObjectsByMembershipKey.get(key);
        if (!(set instanceof Set) || set.size === 0) return [];
        const out = [];
        for (const obj of set.values()) {
            if (!obj || obj.gone || obj.vanishing) continue;
            out.push(obj);
        }
        return out;
    }

    getObjectsForFloorFragment(fragmentOrMembership) {
        if (!fragmentOrMembership || typeof fragmentOrMembership !== "object") return [];
        if (fragmentOrMembership.ownerType && fragmentOrMembership.ownerId && fragmentOrMembership.floorId) {
            return this.getObjectsForFloorMembership(fragmentOrMembership);
        }
        const floorSupportApi = (typeof globalThis !== "undefined") ? globalThis.FloorSupport : null;
        const owner = floorSupportApi && typeof floorSupportApi.getFragmentOwner === "function"
            ? floorSupportApi.getFragmentOwner(fragmentOrMembership)
            : null;
        const floorId = floorSupportApi && typeof floorSupportApi.getSourceFloorIdFromFragment === "function"
            ? floorSupportApi.getSourceFloorIdFromFragment(fragmentOrMembership)
            : (typeof fragmentOrMembership.fragmentId === "string" ? fragmentOrMembership.fragmentId : "");
        const membership = {
            ownerType: owner && owner.type ? owner.type : (typeof fragmentOrMembership.ownerType === "string" ? fragmentOrMembership.ownerType : ""),
            ownerId: owner && owner.id ? owner.id : (typeof fragmentOrMembership.ownerId === "string" ? fragmentOrMembership.ownerId : ""),
            floorId
        };
        return this.getObjectsForFloorMembership(membership);
    }

    markFloorFragmentLayerIndexDirty() {
        this._floorFragmentLayerIndexDirty = true;
    }

    rebuildFloorFragmentLayerIndex() {
        const byLayer = new Map();
        if (this.floorsById instanceof Map) {
            for (const fragment of this.floorsById.values()) {
                if (!fragment) continue;
                const layer = Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0;
                if (!byLayer.has(layer)) byLayer.set(layer, []);
                byLayer.get(layer).push(fragment);
            }
        }
        this.floorFragmentsByLayer = byLayer;
        this._floorFragmentLayerIndexDirty = false;
        this._floorFragmentLayerIndexSize = this.floorsById instanceof Map ? this.floorsById.size : 0;
        return byLayer;
    }

    getFloorFragmentsForLayer(layer = 0) {
        const targetLayer = Number.isFinite(layer) ? Math.round(Number(layer)) : 0;
        const registrySize = this.floorsById instanceof Map ? this.floorsById.size : 0;
        if (
            !(this.floorFragmentsByLayer instanceof Map) ||
            this._floorFragmentLayerIndexDirty === true ||
            this._floorFragmentLayerIndexSize !== registrySize
        ) {
            this.rebuildFloorFragmentLayerIndex();
        }
        const fragments = this.floorFragmentsByLayer instanceof Map
            ? this.floorFragmentsByLayer.get(targetLayer)
            : null;
        return Array.isArray(fragments) ? fragments : [];
    }

    markFloorObjectNodeCacheDirty() {
        this._floorObjectNodeCacheVersion = (Number(this._floorObjectNodeCacheVersion) || 0) + 1;
        this._floorObjectNodeSpatialIndexReadyVersion = -1;
        return this._floorObjectNodeCacheVersion;
    }

    floorObjectNodeHasIndexedRenderEntries(node) {
        if (!node) return false;
        const hasRelevantEntry = (list) => {
            if (!Array.isArray(list) || list.length === 0) return false;
            for (let i = 0; i < list.length; i++) {
                const obj = list[i];
                if (!obj || obj.gone || obj.vanishing || obj._prototypeParked === true) continue;
                if (obj.type === "road") continue;
                return true;
            }
            return false;
        };
        return hasRelevantEntry(node.objects) || hasRelevantEntry(node.visibilityObjects);
    }

    beginFloorObjectNodeSpatialIndexBuild() {
        const source = this.floorNodesById instanceof Map
            ? Array.from(this.floorNodesById.values())
            : [];
        return {
            map: this,
            version: Number(this._floorObjectNodeCacheVersion) || 0,
            mapSize: this.floorNodesById instanceof Map ? this.floorNodesById.size : 0,
            source,
            bySectionY: new Map(),
            allByY: new Map(),
            rows: [],
            totalNodes: 0,
            scanMs: 0,
            sortMs: 0,
            committed: false
        };
    }

    _addFloorObjectNodeSpatialIndexRow(rowsByY, yKey) {
        if (!(rowsByY instanceof Map)) return null;
        let row = rowsByY.get(yKey);
        if (!Array.isArray(row)) {
            row = [];
            rowsByY.set(yKey, row);
        }
        return row;
    }

    _addFloorObjectNodeToSpatialIndexJob(job, node) {
        if (!job || !node || !this.floorObjectNodeHasIndexedRenderEntries(node)) return;
        const yKey = Number.isFinite(node.yindex) ? Math.round(Number(node.yindex)) : null;
        if (!Number.isFinite(yKey)) return;
        const sectionKey = typeof node.ownerSectionKey === "string" && node.ownerSectionKey.length > 0
            ? node.ownerSectionKey
            : (typeof node._prototypeSectionKey === "string" ? node._prototypeSectionKey : "");
        let sectionRows = job.bySectionY.get(sectionKey);
        if (!(sectionRows instanceof Map)) {
            sectionRows = new Map();
            job.bySectionY.set(sectionKey, sectionRows);
        }
        this._addFloorObjectNodeSpatialIndexRow(sectionRows, yKey).push(node);
        this._addFloorObjectNodeSpatialIndexRow(job.allByY, yKey).push(node);
        job.totalNodes += 1;
    }

    scanFloorObjectNodeSpatialIndexBuildRange(job, startIndex, endIndex) {
        if (!job || job.map !== this || !Array.isArray(job.source)) return 0;
        const scanStartMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
        const start = Math.max(0, Math.floor(Number(startIndex) || 0));
        const end = Math.min(job.source.length, Math.max(start, Math.floor(Number(endIndex) || 0)));
        let scanned = 0;
        for (let i = start; i < end; i++) {
            const nodeArr = job.source[i];
            if (!Array.isArray(nodeArr)) continue;
            for (let j = 0; j < nodeArr.length; j++) {
                this._addFloorObjectNodeToSpatialIndexJob(job, nodeArr[j]);
                scanned += 1;
            }
        }
        const scanEndMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
        job.scanMs += scanEndMs - scanStartMs;
        return scanned;
    }

    prepareFloorObjectNodeSpatialIndexSortRows(job) {
        if (!job || job.map !== this) return 0;
        const rows = [];
        for (const sectionRows of job.bySectionY.values()) {
            if (!(sectionRows instanceof Map)) continue;
            for (const row of sectionRows.values()) {
                if (Array.isArray(row) && row.length > 1) rows.push(row);
            }
        }
        for (const row of job.allByY.values()) {
            if (Array.isArray(row) && row.length > 1) rows.push(row);
        }
        job.rows = rows;
        return rows.length;
    }

    sortFloorObjectNodeSpatialIndexRows(job, startIndex, endIndex) {
        if (!job || job.map !== this || !Array.isArray(job.rows)) return 0;
        const sortStartMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
        const start = Math.max(0, Math.floor(Number(startIndex) || 0));
        const end = Math.min(job.rows.length, Math.max(start, Math.floor(Number(endIndex) || 0)));
        for (let i = start; i < end; i++) {
            const row = job.rows[i];
            if (!Array.isArray(row) || row.length < 2) continue;
            row.sort((left, right) => {
                const xDelta = (Number(left && left.xindex) || 0) - (Number(right && right.xindex) || 0);
                if (xDelta !== 0) return xDelta;
                return String(left && left.id || "").localeCompare(String(right && right.id || ""));
            });
        }
        const sortEndMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
        job.sortMs += sortEndMs - sortStartMs;
        return end - start;
    }

    commitFloorObjectNodeSpatialIndexBuild(job) {
        if (!job || job.map !== this) return null;
        const index = {
            version: Number(job.version) || 0,
            mapSize: Number(job.mapSize) || 0,
            bySectionY: job.bySectionY instanceof Map ? job.bySectionY : new Map(),
            allByY: job.allByY instanceof Map ? job.allByY : new Map(),
            totalNodes: Number(job.totalNodes) || 0,
            rowsBuilt: Array.isArray(job.rows) ? job.rows.length : 0,
            scanMs: Number(job.scanMs) || 0,
            sortMs: Number(job.sortMs) || 0
        };
        this._floorObjectNodeSpatialIndex = index;
        this._floorObjectNodeSpatialIndexReadyVersion = index.version;
        job.committed = true;
        return index;
    }

    rebuildFloorObjectNodeSpatialIndex() {
        const job = this.beginFloorObjectNodeSpatialIndexBuild();
        this.scanFloorObjectNodeSpatialIndexBuildRange(job, 0, job.source.length);
        this.prepareFloorObjectNodeSpatialIndexSortRows(job);
        this.sortFloorObjectNodeSpatialIndexRows(job, 0, job.rows.length);
        return this.commitFloorObjectNodeSpatialIndexBuild(job);
    }

    getFloorObjectNodeSpatialIndex() {
        return this._floorObjectNodeSpatialIndex || null;
    }

    isFloorObjectNodeSpatialIndexCurrent() {
        const index = this.getFloorObjectNodeSpatialIndex();
        return !!(
            index &&
            index.version === (Number(this._floorObjectNodeCacheVersion) || 0) &&
            index.mapSize === (this.floorNodesById instanceof Map ? this.floorNodesById.size : 0)
        );
    }

    ensureFloorObjectNodeSpatialIndex() {
        if (this.isFloorObjectNodeSpatialIndexCurrent()) return this.getFloorObjectNodeSpatialIndex();
        return this.rebuildFloorObjectNodeSpatialIndex();
    }

    getFloorNodeKey(nodeOrX, y = null, surfaceId = "", fragmentId = "") {
        if (nodeOrX && typeof nodeOrX === "object") {
            const x = Number(nodeOrX.xindex);
            const nodeY = Number(nodeOrX.yindex);
            const resolvedSurfaceId = (typeof nodeOrX.surfaceId === "string") ? nodeOrX.surfaceId : "";
            const resolvedFragmentId = (typeof nodeOrX.fragmentId === "string") ? nodeOrX.fragmentId : "";
            return `${x},${nodeY},${resolvedSurfaceId},${resolvedFragmentId}`;
        }
        const resolvedSurfaceId = (typeof surfaceId === "string") ? surfaceId : "";
        const resolvedFragmentId = (typeof fragmentId === "string") ? fragmentId : "";
        return `${Number(nodeOrX)},${Number(y)},${resolvedSurfaceId},${resolvedFragmentId}`;
    }

    getFloorLayerNodeKey(nodeOrX, y = null, traversalLayer = 0) {
        if (nodeOrX && typeof nodeOrX === "object") {
            const layer = Number.isFinite(nodeOrX.traversalLayer)
                ? Math.round(Number(nodeOrX.traversalLayer))
                : (Number.isFinite(nodeOrX.level) ? Math.round(Number(nodeOrX.level)) : 0);
            return `${Number(nodeOrX.xindex)},${Number(nodeOrX.yindex)},${layer}`;
        }
        const layer = Number.isFinite(traversalLayer) ? Math.round(Number(traversalLayer)) : 0;
        return `${Number(nodeOrX)},${Number(y)},${layer}`;
    }

    _indexFloorNodeByLayer(node) {
        if (!node) return;
        if (!(this.floorNodeLayerIndex instanceof Map)) this.floorNodeLayerIndex = new Map();
        const key = this.getFloorLayerNodeKey(node);
        if (!this.floorNodeLayerIndex.has(key)) this.floorNodeLayerIndex.set(key, []);
        const nodes = this.floorNodeLayerIndex.get(key);
        if (!nodes.includes(node)) nodes.push(node);
    }

    _unindexFloorNodeByLayer(node) {
        if (!node || !(this.floorNodeLayerIndex instanceof Map)) return;
        const key = this.getFloorLayerNodeKey(node);
        const nodes = this.floorNodeLayerIndex.get(key);
        if (!Array.isArray(nodes)) return;
        const index = nodes.indexOf(node);
        if (index >= 0) nodes.splice(index, 1);
        if (nodes.length === 0) this.floorNodeLayerIndex.delete(key);
    }

    _ensureFloorNodeLayerIndex() {
        if (this.floorNodeLayerIndex instanceof Map) return;
        this.floorNodeLayerIndex = new Map();
        if (!(this.floorNodesById instanceof Map)) return;
        for (const nodes of this.floorNodesById.values()) {
            if (!Array.isArray(nodes)) continue;
            for (let i = 0; i < nodes.length; i++) {
                this._indexFloorNodeByLayer(nodes[i]);
            }
        }
    }

    registerFloorFragment(fragment) {
        if (!fragment || typeof fragment !== "object") return null;
        if (!(this.floorsById instanceof Map)) this.resetFloorRuntimeState();

        const fragmentId = (typeof fragment.fragmentId === "string" && fragment.fragmentId.length > 0)
            ? fragment.fragmentId
            : ((typeof fragment.id === "string" && fragment.id.length > 0) ? fragment.id : "");
        if (!fragmentId) return null;

        const level = Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0;
        if (!Number.isFinite(fragment.nodeBaseZ)) {
            throw new Error(`floor fragment ${fragmentId} requires finite nodeBaseZ`);
        }
        const nodeBaseZ = Number(fragment.nodeBaseZ);
        const nodeBaseZOffset = Number.isFinite(fragment.nodeBaseZOffset) ? Number(fragment.nodeBaseZOffset) : 0;

        const normalized = {
            ...fragment,
            fragmentId,
            surfaceId: (typeof fragment.surfaceId === "string" && fragment.surfaceId.length > 0)
                ? fragment.surfaceId
                : fragmentId,
            ownerSectionKey: (typeof fragment.ownerSectionKey === "string") ? fragment.ownerSectionKey : "",
            ownerType: (typeof fragment.ownerType === "string" && fragment.ownerType.length > 0)
                ? fragment.ownerType
                : ((typeof fragment.ownerSectionKey === "string" && fragment.ownerSectionKey.startsWith("building:"))
                    ? "building"
                    : ((typeof fragment.ownerSectionKey === "string" && fragment.ownerSectionKey.length > 0) ? "section" : "")),
            ownerId: (typeof fragment.ownerId === "string" && fragment.ownerId.length > 0)
                ? fragment.ownerId
                : ((typeof fragment.ownerSectionKey === "string") ? fragment.ownerSectionKey : ""),
            level,
            nodeBaseZOffset,
            nodeBaseZ,
            outerPolygon: Array.isArray(fragment.outerPolygon) ? fragment.outerPolygon.slice() : [],
            holes: Array.isArray(fragment.holes) ? fragment.holes.slice() : []
        };

        this.floorsById.set(fragmentId, normalized);
        this.markFloorFragmentLayerIndexDirty();
        if (!(this.floorNodesById instanceof Map)) this.floorNodesById = new Map();
        if (!this.floorNodesById.has(fragmentId)) this.floorNodesById.set(fragmentId, []);

        if (!(this.floorFragmentsBySurfaceId instanceof Map)) this.floorFragmentsBySurfaceId = new Map();
        if (!this.floorFragmentsBySurfaceId.has(normalized.surfaceId)) {
            this.floorFragmentsBySurfaceId.set(normalized.surfaceId, new Set());
        }
        this.floorFragmentsBySurfaceId.get(normalized.surfaceId).add(fragmentId);

        const ownerSectionKey = normalized.ownerSectionKey;
        if (ownerSectionKey.length > 0) {
            if (!(this.floorFragmentsBySectionKey instanceof Map)) this.floorFragmentsBySectionKey = new Map();
            if (!this.floorFragmentsBySectionKey.has(ownerSectionKey)) {
                this.floorFragmentsBySectionKey.set(ownerSectionKey, new Set());
            }
            this.floorFragmentsBySectionKey.get(ownerSectionKey).add(fragmentId);
        }

        this.markFloorBuildingsDirty();
        return normalized;
    }

    markFloorBuildingsDirty() {
        this._floorBuildingsDirty = true;
        this.markBuildingRenderCacheDirty();
    }

    markBuildingRenderCacheDirty() {
        if (
            typeof globalThis !== "undefined" &&
            globalThis.__moveObjectPerf &&
            typeof globalThis.__recordMoveObjectPerf === "function"
        ) {
            let stack = "";
            try {
                stack = (new Error()).stack || "";
            } catch (_err) {
                stack = "";
            }
            const stackLines = stack
                .split("\n")
                .slice(2, 7)
                .map(line => line.trim())
                .filter(Boolean);
            globalThis.__recordMoveObjectPerf("map.markBuildingRenderCacheDirty", {
                previousVersion: Number(this._buildingRenderCacheVersion) || 0,
                stack: stackLines
            });
        }
        this._buildingRenderCacheVersion = (Number(this._buildingRenderCacheVersion) || 0) + 1;
    }

    rebuildFloorBuildingStaticObjectIndex(building) {
        if (!building) return null;
        const byFragment = new Map();
        const entries = Array.isArray(building.staticObjects) ? building.staticObjects : [];
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!entry || !entry.item) continue;
            const refs = Array.isArray(entry.refs) ? entry.refs : [];
            let added = false;
            for (let r = 0; r < refs.length; r++) {
                const fragmentId = refs[r] && typeof refs[r].fragmentId === "string" ? refs[r].fragmentId : "";
                if (!fragmentId) continue;
                if (!byFragment.has(fragmentId)) byFragment.set(fragmentId, []);
                byFragment.get(fragmentId).push(entry);
                added = true;
            }
            if (!added && typeof entry.item.fragmentId === "string" && entry.item.fragmentId.length > 0) {
                if (!byFragment.has(entry.item.fragmentId)) byFragment.set(entry.item.fragmentId, []);
                byFragment.get(entry.item.fragmentId).push(entry);
            }
        }
        building.staticObjectsByFragment = byFragment;
        return byFragment;
    }

    getFloorBuildingStaticObjectsForFragment(building, fragmentId) {
        if (!building || typeof fragmentId !== "string" || fragmentId.length === 0) return [];
        if (!(building.staticObjectsByFragment instanceof Map)) {
            this.rebuildFloorBuildingStaticObjectIndex(building);
        }
        const entries = building.staticObjectsByFragment instanceof Map
            ? building.staticObjectsByFragment.get(fragmentId)
            : null;
        return Array.isArray(entries) ? entries : [];
    }

    pruneFloorBuildingManifest(building) {
        if (!building) return false;
        if (!Array.isArray(building.staticObjects)) {
            building.staticObjects = [];
            building._staticObjectManifestSet = new Set();
            building.staticObjectsByFragment = new Map();
            return false;
        }
        const next = [];
        const manifestSet = new Set();
        let changed = false;
        for (let i = 0; i < building.staticObjects.length; i++) {
            const entry = building.staticObjects[i];
            const item = entry && entry.item;
            if (!item || item.gone || item.vanishing || manifestSet.has(item)) {
                changed = true;
                continue;
            }
            next.push(entry);
            manifestSet.add(item);
        }
        if (changed) {
            building.staticObjects = next;
            this.markBuildingRenderCacheDirty();
        }
        building._staticObjectManifestSet = manifestSet;
        this.rebuildFloorBuildingStaticObjectIndex(building);
        return changed;
    }

    addObjectToFloorBuildingManifest(obj, options = {}) {
        if (!obj || typeof obj !== "object") return false;
        const fragmentId = typeof options.fragmentId === "string" && options.fragmentId.length > 0
            ? options.fragmentId
            : (typeof obj.fragmentId === "string" && obj.fragmentId.length > 0
                ? obj.fragmentId
                : (typeof obj.node?.fragmentId === "string" ? obj.node.fragmentId : ""));
        if (!fragmentId) return false;

        const targetLevel = Number.isFinite(options.level)
            ? Math.round(Number(options.level))
            : (Number.isFinite(obj.traversalLayer)
                ? Math.round(Number(obj.traversalLayer))
                : (Number.isFinite(obj.level) ? Math.round(Number(obj.level)) : 0));
        const buildings = this.ensureFloorBuildings();
        const buildingId = this.floorBuildingByFragmentId instanceof Map
            ? this.floorBuildingByFragmentId.get(fragmentId)
            : "";
        const building = buildingId && buildings instanceof Map ? buildings.get(buildingId) : null;
        if (!building) {
            if (targetLevel > 0) {
                throw new Error(`Unable to attach object to floor building manifest for upper-floor fragment: ${fragmentId}`);
            }
            return false;
        }

        this.pruneFloorBuildingManifest(building);
        if (building._staticObjectManifestSet.has(obj)) return true;

        const surfaceId = typeof options.surfaceId === "string" && options.surfaceId.length > 0
            ? options.surfaceId
            : (typeof obj.surfaceId === "string" && obj.surfaceId.length > 0
                ? obj.surfaceId
                : (typeof obj.node?.surfaceId === "string" ? obj.node.surfaceId : ""));
        const entry = {
            item: obj,
            level: targetLevel,
            refs: [{ surfaceId, fragmentId }]
        };

        building._staticObjectManifestSet.add(obj);
        if (!Array.isArray(building.staticObjects)) building.staticObjects = [];
        building.staticObjects.push(entry);
        this.rebuildFloorBuildingStaticObjectIndex(building);
        obj._floorBuildingManifestId = building.buildingId || buildingId;
        obj._floorBuildingManifestFragmentId = fragmentId;
        this.markBuildingRenderCacheDirty();
        return true;
    }

    removeObjectFromFloorBuildingManifest(obj) {
        if (!obj || typeof obj !== "object") return false;
        const buildings = this.ensureFloorBuildings();
        if (!(buildings instanceof Map) || buildings.size === 0) return false;
        const candidateIds = new Set();
        if (typeof obj._floorBuildingManifestId === "string" && obj._floorBuildingManifestId.length > 0) {
            candidateIds.add(obj._floorBuildingManifestId);
        }
        const fragmentId = typeof obj._floorBuildingManifestFragmentId === "string" && obj._floorBuildingManifestFragmentId.length > 0
            ? obj._floorBuildingManifestFragmentId
            : (typeof obj.fragmentId === "string" && obj.fragmentId.length > 0
                ? obj.fragmentId
                : (typeof obj.node?.fragmentId === "string" ? obj.node.fragmentId : ""));
        if (fragmentId && this.floorBuildingByFragmentId instanceof Map) {
            const buildingId = this.floorBuildingByFragmentId.get(fragmentId);
            if (buildingId) candidateIds.add(buildingId);
        }
        if (candidateIds.size === 0) {
            for (const buildingId of buildings.keys()) candidateIds.add(buildingId);
        }

        let removed = false;
        for (const buildingId of candidateIds) {
            const building = buildings.get(buildingId);
            if (!building || !Array.isArray(building.staticObjects)) continue;
            const before = building.staticObjects.length;
            building.staticObjects = building.staticObjects.filter(entry => entry && entry.item !== obj);
            if (!(building._staticObjectManifestSet instanceof Set)) building._staticObjectManifestSet = new Set();
            building._staticObjectManifestSet.delete(obj);
            this.pruneFloorBuildingManifest(building);
            if (building.staticObjects.length !== before) removed = true;
        }
        if (removed) {
            delete obj._floorBuildingManifestId;
            delete obj._floorBuildingManifestFragmentId;
            this.markBuildingRenderCacheDirty();
        }
        return removed;
    }

    getFloorFragmentOverlapPolygon(fragment) {
        if (!fragment) return [];
        return Array.isArray(fragment.outerPolygon) ? fragment.outerPolygon : [];
    }

    doFloorFragmentsOverlapXY(fragmentA, fragmentB) {
        if (!fragmentA || !fragmentB || fragmentA === fragmentB) return false;
        const levelA = Number.isFinite(fragmentA.level) ? Math.round(Number(fragmentA.level)) : 0;
        const levelB = Number.isFinite(fragmentB.level) ? Math.round(Number(fragmentB.level)) : 0;
        if (levelA === levelB) return false;
        const polygonA = this.getFloorFragmentOverlapPolygon(fragmentA);
        const polygonB = this.getFloorFragmentOverlapPolygon(fragmentB);
        return polygonsOverlap2D(polygonA, polygonB);
    }

    buildFloorBuildingFragmentGraph(fragmentIds) {
        const graph = new Map();
        const ids = Array.isArray(fragmentIds) ? fragmentIds : [];
        const fragments = ids
            .map(id => this.floorsById instanceof Map ? this.floorsById.get(id) : null)
            .filter(fragment => fragment && typeof fragment.fragmentId === "string");
        for (let i = 0; i < fragments.length; i++) {
            graph.set(fragments[i].fragmentId, {
                fragmentId: fragments[i].fragmentId,
                above: new Set(),
                below: new Set()
            });
        }

        const api = getPolygonClippingApi2D();
        if (!api || typeof api.intersection !== "function" || typeof api.difference !== "function") {
            for (let i = 0; i < fragments.length; i++) {
                const source = fragments[i];
                const sourceLevel = Number.isFinite(source.level) ? Math.round(Number(source.level)) : 0;
                let nearestLevel = Infinity;
                const direct = [];
                for (let j = 0; j < fragments.length; j++) {
                    const candidate = fragments[j];
                    if (!candidate || candidate === source) continue;
                    const candidateLevel = Number.isFinite(candidate.level) ? Math.round(Number(candidate.level)) : 0;
                    if (candidateLevel <= sourceLevel || candidateLevel > nearestLevel) continue;
                    if (!this.doFloorFragmentsOverlapXY(source, candidate)) continue;
                    if (candidateLevel < nearestLevel) {
                        nearestLevel = candidateLevel;
                        direct.length = 0;
                    }
                    direct.push(candidate.fragmentId);
                }
                const node = graph.get(source.fragmentId);
                for (let j = 0; node && j < direct.length; j++) {
                    node.above.add(direct[j]);
                    const aboveNode = graph.get(direct[j]);
                    if (aboveNode) aboveNode.below.add(source.fragmentId);
                }
            }
            return graph;
        }

        const sortedSources = fragments.slice().sort((a, b) => {
            const levelDelta = (Number(a.level) || 0) - (Number(b.level) || 0);
            if (levelDelta !== 0) return levelDelta;
            return String(a.fragmentId || "").localeCompare(String(b.fragmentId || ""));
        });
        for (let i = 0; i < sortedSources.length; i++) {
            const source = sortedSources[i];
            const sourceLevel = Number.isFinite(source.level) ? Math.round(Number(source.level)) : 0;
            let remaining = floorFragmentToClipGeometry2D(source, this.getFloorFragmentOverlapPolygon.bind(this));
            if (clipGeometryIsEmpty2D(remaining)) continue;
            const higher = fragments
                .filter(candidate => candidate && candidate !== source && (Number.isFinite(candidate.level) ? Math.round(Number(candidate.level)) : 0) > sourceLevel)
                .sort((a, b) => {
                    const levelDelta = (Number(a.level) || 0) - (Number(b.level) || 0);
                    if (levelDelta !== 0) return levelDelta;
                    return String(a.fragmentId || "").localeCompare(String(b.fragmentId || ""));
                });
            const node = graph.get(source.fragmentId);
            for (let j = 0; node && j < higher.length; j++) {
                const candidate = higher[j];
                const candidateGeometry = floorFragmentToClipGeometry2D(candidate, this.getFloorFragmentOverlapPolygon.bind(this));
                if (clipGeometryIsEmpty2D(candidateGeometry)) continue;
                let intersection = [];
                try {
                    intersection = api.intersection(remaining, candidateGeometry);
                } catch (_err) {
                    intersection = [];
                }
                if (clipGeometryIsEmpty2D(intersection)) continue;
                node.above.add(candidate.fragmentId);
                const aboveNode = graph.get(candidate.fragmentId);
                if (aboveNode) aboveNode.below.add(source.fragmentId);
                try {
                    remaining = api.difference(remaining, candidateGeometry);
                } catch (_err) {
                    remaining = [];
                }
                if (clipGeometryIsEmpty2D(remaining)) break;
            }
        }
        return graph;
    }

    rebuildFloorBuildings() {
        if (!(this.floorsById instanceof Map)) {
            this.buildingsById = new Map();
            this.floorBuildingByFragmentId = new Map();
            this._floorBuildingsDirty = false;
            return this.buildingsById;
        }

        const previousStaticObjectEntries = [];
        if (this.buildingsById instanceof Map) {
            for (const building of this.buildingsById.values()) {
                const entries = Array.isArray(building && building.staticObjects) ? building.staticObjects : [];
                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    if (entry && entry.item) previousStaticObjectEntries.push(entry);
                }
            }
        }

        const fragments = Array.from(this.floorsById.values())
            .filter(fragment => (
                fragment &&
                fragment.renderedByBuildingCutaway !== true &&
                Number.isFinite(fragment.level) &&
                Math.round(Number(fragment.level)) > 0 &&
                Array.isArray(this.getFloorFragmentOverlapPolygon(fragment)) &&
                this.getFloorFragmentOverlapPolygon(fragment).length >= 3
            ));
        const adjacency = new Map();
        for (let i = 0; i < fragments.length; i++) {
            const id = fragments[i].fragmentId;
            if (typeof id === "string" && id.length > 0) adjacency.set(id, new Set());
        }
        for (let i = 0; i < fragments.length; i++) {
            const a = fragments[i];
            const aId = a.fragmentId;
            for (let j = i + 1; j < fragments.length; j++) {
                const b = fragments[j];
                const bId = b.fragmentId;
                if (!this.doFloorFragmentsOverlapXY(a, b)) continue;
                adjacency.get(aId).add(bId);
                adjacency.get(bId).add(aId);
            }
        }

        const buildingsById = new Map();
        const floorBuildingByFragmentId = new Map();
        const visited = new Set();
        let nextIndex = 1;
        const sortedFragments = fragments.slice().sort((a, b) => {
            const levelDelta = (Number(a.level) || 0) - (Number(b.level) || 0);
            if (levelDelta !== 0) return levelDelta;
            return String(a.fragmentId || "").localeCompare(String(b.fragmentId || ""));
        });
        for (let i = 0; i < sortedFragments.length; i++) {
            const start = sortedFragments[i];
            const startId = start.fragmentId;
            if (!startId || visited.has(startId)) continue;
            const stack = [startId];
            const fragmentIds = [];
            const surfaceIds = new Set();
            const levels = new Set();
            let minLevel = Infinity;
            let maxLevel = -Infinity;
            while (stack.length > 0) {
                const id = stack.pop();
                if (!id || visited.has(id)) continue;
                visited.add(id);
                const fragment = this.floorsById.get(id);
                if (!fragment) continue;
                fragmentIds.push(id);
                if (typeof fragment.surfaceId === "string" && fragment.surfaceId.length > 0) surfaceIds.add(fragment.surfaceId);
                const level = Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0;
                levels.add(level);
                minLevel = Math.min(minLevel, level);
                maxLevel = Math.max(maxLevel, level);
                const neighbors = adjacency.get(id);
                if (!(neighbors instanceof Set)) continue;
                for (const nextId of neighbors) {
                    if (!visited.has(nextId)) stack.push(nextId);
                }
            }
            if (fragmentIds.length === 0) continue;
            fragmentIds.sort();
            const fragmentGraph = this.buildFloorBuildingFragmentGraph(fragmentIds);
            const buildingId = `building:${nextIndex++}:${fragmentIds[0]}`;
            const building = {
                buildingId,
                fragmentIds: new Set(fragmentIds),
                fragmentGraph,
                surfaceIds,
                levels,
                minLevel: Number.isFinite(minLevel) ? minLevel : 0,
                maxLevel: Number.isFinite(maxLevel) ? maxLevel : 0
            };
            const holeVisibleFragments = new Map();
            const holeApi = getPolygonClippingApi2D();
            if (holeApi && typeof holeApi.intersection === "function") {
                for (let j = 0; j < fragmentIds.length; j++) {
                    const fragId = fragmentIds[j];
                    const frag = this.floorsById.get(fragId);
                    if (!frag || !Array.isArray(frag.holes) || frag.holes.length === 0) continue;
                    const graphNode = fragmentGraph.get(fragId);
                    if (!graphNode || graphNode.below.size === 0) continue;
                    const visibleBelow = new Set();
                    for (let h = 0; h < frag.holes.length; h++) {
                        const holeRing = polygonToClipRing2D(frag.holes[h]);
                        if (!holeRing) continue;
                        const holeGeom = [[holeRing]];
                        for (const belowId of graphNode.below) {
                            if (visibleBelow.has(belowId)) continue;
                            const belowFrag = this.floorsById.get(belowId);
                            if (!belowFrag) continue;
                            const belowGeom = floorFragmentToClipGeometry2D(belowFrag, null);
                            if (clipGeometryIsEmpty2D(belowGeom)) continue;
                            let result = [];
                            try {
                                result = holeApi.intersection(holeGeom, belowGeom);
                            } catch (_e) {
                                result = [];
                            }
                            if (!clipGeometryIsEmpty2D(result)) visibleBelow.add(belowId);
                        }
                    }
                    if (visibleBelow.size > 0) holeVisibleFragments.set(fragId, visibleBelow);
                }
            }
            building.holeVisibleFragments = holeVisibleFragments;
            buildingsById.set(buildingId, building);
            for (let j = 0; j < fragmentIds.length; j++) {
                const fragmentId = fragmentIds[j];
                const fragment = this.floorsById.get(fragmentId);
                if (fragment) fragment.buildingId = buildingId;
                floorBuildingByFragmentId.set(fragmentId, buildingId);
            }
        }

        for (const fragment of this.floorsById.values()) {
            if (!fragment) continue;
            if (!floorBuildingByFragmentId.has(fragment.fragmentId)) {
                delete fragment.buildingId;
            }
        }

        if (previousStaticObjectEntries.length > 0) {
            const addRefForBuilding = (refsByBuildingId, ref) => {
                if (!ref || typeof ref !== "object") return;
                const fragmentId = typeof ref.fragmentId === "string" && ref.fragmentId.length > 0
                    ? ref.fragmentId
                    : "";
                if (!fragmentId) return;
                const buildingId = floorBuildingByFragmentId.get(fragmentId);
                if (!buildingId || !buildingsById.has(buildingId)) return;
                if (!refsByBuildingId.has(buildingId)) refsByBuildingId.set(buildingId, []);
                refsByBuildingId.get(buildingId).push({
                    surfaceId: typeof ref.surfaceId === "string" ? ref.surfaceId : "",
                    fragmentId
                });
            };

            for (let i = 0; i < previousStaticObjectEntries.length; i++) {
                const entry = previousStaticObjectEntries[i];
                const item = entry && entry.item;
                if (!item || item.gone || item.vanishing) continue;
                const refsByBuildingId = new Map();
                const refs = Array.isArray(entry.refs) ? entry.refs : [];
                for (let r = 0; r < refs.length; r++) addRefForBuilding(refsByBuildingId, refs[r]);
                if (refsByBuildingId.size === 0) {
                    addRefForBuilding(refsByBuildingId, {
                        surfaceId: typeof item.surfaceId === "string" ? item.surfaceId : "",
                        fragmentId: typeof item.fragmentId === "string" ? item.fragmentId : ""
                    });
                }
                for (const [buildingId, buildingRefs] of refsByBuildingId.entries()) {
                    const building = buildingsById.get(buildingId);
                    if (!building || !Array.isArray(buildingRefs) || buildingRefs.length === 0) continue;
                    if (!(building._staticObjectManifestSet instanceof Set)) {
                        building._staticObjectManifestSet = new Set();
                    }
                    if (building._staticObjectManifestSet.has(item)) continue;
                    if (!Array.isArray(building.staticObjects)) building.staticObjects = [];
                    const preservedEntry = {
                        item,
                        level: Number.isFinite(entry.level)
                            ? Math.round(Number(entry.level))
                            : (Number.isFinite(item.traversalLayer)
                                ? Math.round(Number(item.traversalLayer))
                                : (Number.isFinite(item.level) ? Math.round(Number(item.level)) : 0)),
                        refs: buildingRefs
                    };
                    building.staticObjects.push(preservedEntry);
                    building._staticObjectManifestSet.add(item);
                    item._floorBuildingManifestId = building.buildingId || buildingId;
                    item._floorBuildingManifestFragmentId = buildingRefs[0].fragmentId;
                }
            }

            for (const building of buildingsById.values()) {
                if (Array.isArray(building.staticObjects) && building.staticObjects.length > 0) {
                    this.pruneFloorBuildingManifest(building);
                }
            }
        }

        this.buildingsById = buildingsById;
        this.floorBuildingByFragmentId = floorBuildingByFragmentId;
        this._floorBuildingsDirty = false;
        this._floorBuildingVersion = (Number(this._floorBuildingVersion) || 0) + 1;
        this.markBuildingRenderCacheDirty();
        return buildingsById;
    }

    ensureFloorBuildings() {
        const hasBuildableFragments = () => {
            if (!(this.floorsById instanceof Map)) return false;
            for (const fragment of this.floorsById.values()) {
                if (
                    fragment &&
                    fragment.renderedByBuildingCutaway !== true &&
                    Number.isFinite(fragment.level) &&
                    Math.round(Number(fragment.level)) > 0 &&
                    Array.isArray(this.getFloorFragmentOverlapPolygon(fragment)) &&
                    this.getFloorFragmentOverlapPolygon(fragment).length >= 3
                ) {
                    return true;
                }
            }
            return false;
        };
        if (
            this._floorBuildingsDirty !== true &&
            this.buildingsById instanceof Map &&
            this.floorBuildingByFragmentId instanceof Map &&
            (this.buildingsById.size > 0 || !hasBuildableFragments())
        ) {
            return this.buildingsById;
        }
        return this.rebuildFloorBuildings();
    }

    registerFloorNode(node, fragment = null) {
        if (!node || typeof node !== "object") return null;
        if (!(this.floorNodesById instanceof Map)) this.resetFloorRuntimeState();
        const fragmentId = (fragment && typeof fragment.fragmentId === "string" && fragment.fragmentId.length > 0)
            ? fragment.fragmentId
            : ((typeof node.fragmentId === "string" && node.fragmentId.length > 0) ? node.fragmentId : "");
        if (!fragmentId) return null;
        const surfaceId = (fragment && typeof fragment.surfaceId === "string" && fragment.surfaceId.length > 0)
            ? fragment.surfaceId
            : ((typeof node.surfaceId === "string") ? node.surfaceId : "");
        node.fragmentId = fragmentId;
        node.surfaceId = surfaceId;
        node.id = this.getFloorNodeKey(node);

        if (!this.floorNodesById.has(fragmentId)) this.floorNodesById.set(fragmentId, []);
        this.floorNodesById.get(fragmentId).push(node);

        if (!(this.floorNodeIndex instanceof Map)) this.floorNodeIndex = new Map();
        this.floorNodeIndex.set(node.id, node);
        this._indexFloorNodeByLayer(node);
        this.markFloorObjectNodeCacheDirty();
        return node;
    }

    createFloorNodeFromSource(sourceNode, fragment, options = {}) {
        if (!sourceNode || !fragment) return null;
        let floorNode = null;
        const SourceCtor = (typeof sourceNode.constructor === "function" && sourceNode.constructor !== Object)
            ? sourceNode.constructor : null;
        if (SourceCtor) {
            let ctorWorks = _floorNodeCtorWorkMap.get(SourceCtor);
            if (ctorWorks === undefined) {
                const probe = _tryMakeFloorNodeFromCtor(SourceCtor, 0, 0);
                ctorWorks = (probe !== null && typeof probe === "object");
                _floorNodeCtorWorkMap.set(SourceCtor, ctorWorks);
            }
            if (ctorWorks) floorNode = new SourceCtor(sourceNode.xindex, sourceNode.yindex, 1, 1);
        }
        if (!floorNode || typeof floorNode !== "object") {
            floorNode = {};
        }

        floorNode.xindex = Number(sourceNode.xindex);
        floorNode.yindex = Number(sourceNode.yindex);
        floorNode.x = Number(sourceNode.x);
        floorNode.y = Number(sourceNode.y);
        if (sourceNode && Object.prototype.hasOwnProperty.call(sourceNode, "_prototypeSectionKey")) {
            floorNode._prototypeSectionKey = sourceNode._prototypeSectionKey;
        }
        if (sourceNode && Object.prototype.hasOwnProperty.call(sourceNode, "_prototypeSectionActive")) {
            floorNode._prototypeSectionActive = sourceNode._prototypeSectionActive;
        }
        if (sourceNode && Object.prototype.hasOwnProperty.call(sourceNode, "_prototypeVoid")) {
            floorNode._prototypeVoid = sourceNode._prototypeVoid;
        }
        floorNode.surfaceId = (typeof fragment.surfaceId === "string") ? fragment.surfaceId : "";
        floorNode.fragmentId = (typeof fragment.fragmentId === "string") ? fragment.fragmentId : "";
        floorNode.ownerSectionKey = (typeof fragment.ownerSectionKey === "string") ? fragment.ownerSectionKey : "";
        floorNode._prototypeOwnerType = typeof fragment.ownerType === "string" ? fragment.ownerType : "";
        floorNode._prototypeOwnerId = typeof fragment.ownerId === "string" ? fragment.ownerId : "";
        if (fragment.ownerType === "building") {
            floorNode._prototypeBuildingFloorNode = true;
        }
        floorNode.level = Number.isFinite(fragment.level) ? Number(fragment.level) : 0;
        floorNode.traversalLayer = Number.isFinite(options.traversalLayer)
            ? Number(options.traversalLayer)
            : floorNode.level;
        floorNode.baseZ = Number.isFinite(options.baseZ)
            ? Number(options.baseZ)
            : (Number.isFinite(fragment.nodeBaseZ) ? Number(fragment.nodeBaseZ) : this.getNodeBaseZ(sourceNode));
        floorNode.portalEdges = Array.isArray(sourceNode.portalEdges) ? sourceNode.portalEdges.slice() : [];
        floorNode.neighbors = new Array(12).fill(null);
        floorNode.neighborOffsets = Array.isArray(sourceNode.neighborOffsets)
            ? sourceNode.neighborOffsets.slice()
            : new Array(12).fill(null);
        floorNode.blockedNeighbors = new Map();
        floorNode.objects = [];
        floorNode.visibilityObjects = [];
        floorNode.blockedByObjects = 0;
        floorNode.blocked = false;
        // Non-ground floor nodes must not inherit ground-level clearance — it reflects
        // surface obstacles that are irrelevant underground (and missing underground walls).
        // Ground floor nodes (level === 0) inherit normally since they share the surface plane.
        const floorLevel = Number.isFinite(floorNode.level) ? floorNode.level : 0;
        floorNode.clearance = (floorLevel === 0 && Number.isFinite(sourceNode.clearance))
            ? Number(sourceNode.clearance)
            : Infinity;
        return this.registerFloorNode(floorNode, fragment);
    }

    registerFloorTransition(transition) {
        if (!transition || typeof transition !== "object") return null;
        if (!(this.transitionsById instanceof Map)) this.resetFloorRuntimeState();
        const transitionId = (typeof transition.id === "string" && transition.id.length > 0)
            ? transition.id
            : "";
        if (!transitionId) return null;
        const normalized = {
            ...transition,
            id: transitionId,
            type: (typeof transition.type === "string" && transition.type.length > 0)
                ? transition.type
                : "portal",
            bidirectional: transition.bidirectional !== false,
            zProfile: (typeof transition.zProfile === "string" && transition.zProfile.length > 0)
                ? transition.zProfile
                : "linear",
            movementCost: Number.isFinite(transition.movementCost) ? Number(transition.movementCost) : 1,
            penalty: Number.isFinite(transition.penalty) ? Number(transition.penalty) : 0,
            metadata: (transition.metadata && typeof transition.metadata === "object") ? { ...transition.metadata } : {}
        };
        this.transitionsById.set(transitionId, normalized);
        return normalized;
    }

    normalizeStairPathPoint(point, label, stairId) {
        const x = Number(point && point.x);
        const y = Number(point && point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error(`stair ${stairId} has invalid ${label}`);
        }
        return { x, y };
    }

    normalizeStairPathTreads(treads, stairId) {
        if (!Array.isArray(treads) || treads.length < 2) {
            throw new Error(`stair ${stairId} requires at least two saved treads`);
        }
        return treads.map((tread, index) => {
            const left = this.normalizeStairPathPoint(tread && tread.left, `tread ${index} left`, stairId);
            const right = this.normalizeStairPathPoint(tread && tread.right, `tread ${index} right`, stairId);
            const width = Math.hypot(right.x - left.x, right.y - left.y);
            if (!(width > 1e-6)) throw new Error(`stair ${stairId} tread ${index} has coincident endpoints`);
            const out = {
                left,
                right,
                center: {
                    x: (left.x + right.x) * 0.5,
                    y: (left.y + right.y) * 0.5
                }
            };
            if (Object.prototype.hasOwnProperty.call(tread || {}, "arcDeltaAngle")) {
                const value = Number(tread.arcDeltaAngle);
                if (!Number.isFinite(value)) throw new Error(`stair ${stairId} tread ${index} arcDeltaAngle must be finite`);
                out.arcDeltaAngle = value;
            }
            if (Object.prototype.hasOwnProperty.call(tread || {}, "arcNearDeltaAngle")) {
                const value = Number(tread.arcNearDeltaAngle);
                if (!Number.isFinite(value)) throw new Error(`stair ${stairId} tread ${index} arcNearDeltaAngle must be finite`);
                out.arcNearDeltaAngle = value;
            }
            return out;
        });
    }

    registerStairRuntimeRecord(stair) {
        if (!stair || typeof stair !== "object") return null;
        if (!(this.stairsById instanceof Map)) this.stairsById = new Map();
        const stairId = typeof stair.id === "string" && stair.id.length > 0 ? stair.id : "";
        if (!stairId) throw new Error("stair runtime record missing id");
        const lowerZ = Number(stair.lowerZ);
        const higherZ = Number(stair.higherZ);
        if (!Number.isFinite(lowerZ) || !Number.isFinite(higherZ) || !(higherZ > lowerZ)) {
            throw new Error(`stair ${stairId} requires finite lowerZ and higherZ`);
        }
        const lowerPoint = this.normalizeStairPathPoint(stair.lowerPoint, "lowerPoint", stairId);
        const higherPoint = this.normalizeStairPathPoint(stair.higherPoint, "higherPoint", stairId);
        const treads = this.normalizeStairPathTreads(stair.treads, stairId);
        const lowerLevel = Number.isFinite(Number(stair.lowerLevel)) ? Math.round(Number(stair.lowerLevel)) : 0;
        const higherLevel = Number.isFinite(Number(stair.higherLevel)) ? Math.round(Number(stair.higherLevel)) : lowerLevel + 1;
        const lowerFragmentId = typeof stair.lowerFragmentId === "string" ? stair.lowerFragmentId : "";
        const higherFragmentId = typeof stair.higherFragmentId === "string" ? stair.higherFragmentId : "";
        const lowerFragment = lowerFragmentId && this.floorsById instanceof Map ? this.floorsById.get(lowerFragmentId) : null;
        const higherFragment = higherFragmentId && this.floorsById instanceof Map ? this.floorsById.get(higherFragmentId) : null;
        if (lowerFragmentId && !lowerFragment) throw new Error(`stair ${stairId} references missing lower floor ${lowerFragmentId}`);
        if (higherFragmentId && !higherFragment) throw new Error(`stair ${stairId} references missing higher floor ${higherFragmentId}`);
        const stepCount = Number.isFinite(Number(stair.stepCount))
            ? Math.max(1, Math.round(Number(stair.stepCount)))
            : Math.max(1, treads.length - 1);
        const riserDepth = Number(stair.riserDepth);
        if (!Number.isFinite(riserDepth) || riserDepth < 0) {
            throw new Error(`stair ${stairId} requires a non-negative riserDepth`);
        }
        const width = Number.isFinite(Number(stair.width))
            ? Math.max(0.05, Number(stair.width))
            : Math.max(0.05, Math.hypot(treads[0].right.x - treads[0].left.x, treads[0].right.y - treads[0].left.y));
        const runtimeStair = {
            ...stair,
            id: stairId,
            type: "stairs",
            stairKind: "treadPath",
            lowerFragmentId,
            higherFragmentId,
            lowerSurfaceId: typeof stair.lowerSurfaceId === "string" && stair.lowerSurfaceId.length > 0
                ? stair.lowerSurfaceId
                : (lowerFragment && typeof lowerFragment.surfaceId === "string" ? lowerFragment.surfaceId : ""),
            higherSurfaceId: typeof stair.higherSurfaceId === "string" && stair.higherSurfaceId.length > 0
                ? stair.higherSurfaceId
                : (higherFragment && typeof higherFragment.surfaceId === "string" ? higherFragment.surfaceId : ""),
            lowerLevel,
            higherLevel,
            lowerZ,
            higherZ,
            lowerPoint,
            higherPoint,
            width,
            stepCount,
            riserDepth,
            treads,
            texturePath: typeof stair.texturePath === "string" ? stair.texturePath : ""
        };
        runtimeStair.traversalFrame = this.createStairTraversalFrame(runtimeStair);
        this.stairsById.set(stairId, runtimeStair);
        return runtimeStair;
    }

    requireStairTraversal() {
        const traversal = (typeof globalThis !== "undefined" && globalThis.StairTraversal)
            ? globalThis.StairTraversal
            : null;
        if (!traversal || typeof traversal.createTreadPathFrame !== "function") {
            throw new Error("stair traversal requires StairTraversal runtime");
        }
        return traversal;
    }

    createStairTraversalFrame(stair) {
        const traversal = this.requireStairTraversal();
        return traversal.createTreadPathFrame(stair);
    }

    getStairTraversalFrame(stair) {
        if (!stair) return null;
        if (!stair.traversalFrame) {
            stair.traversalFrame = this.createStairTraversalFrame(stair);
        }
        return stair.traversalFrame;
    }

    isPointSupportedByFloorFragment(fragment, x, y) {
        if (!fragment || fragment._floorEditEmpty === true) return false;
        if (!Array.isArray(fragment.outerPolygon) || fragment.outerPolygon.length < 3) return false;
        if (!pointInPolygon2D(Number(x), Number(y), fragment.outerPolygon)) return false;
        const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
        for (let i = 0; i < holes.length; i++) {
            if (Array.isArray(holes[i]) && holes[i].length >= 3 && pointInPolygon2D(Number(x), Number(y), holes[i])) {
                return false;
            }
        }
        return true;
    }

    isCircleSupportedByFloorFragment(fragment, x, y, radius = 0) {
        const cx = Number(x);
        const cy = Number(y);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return false;
        if (!this.isPointSupportedByFloorFragment(fragment, cx, cy)) return false;
        const resolvedRadius = Math.max(0, Number(radius) || 0);
        if (!(resolvedRadius > 0)) return true;
        const radiusSq = resolvedRadius * resolvedRadius;
        if (getPointPolygonBoundaryDistanceSq2D(cx, cy, fragment.outerPolygon) < radiusSq - 1e-9) {
            return false;
        }
        const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
        for (let i = 0; i < holes.length; i++) {
            const hole = holes[i];
            if (!Array.isArray(hole) || hole.length < 3) continue;
            if (pointInPolygon2D(cx, cy, hole)) return false;
            if (getPointPolygonBoundaryDistanceSq2D(cx, cy, hole) < radiusSq - 1e-9) return false;
        }
        return true;
    }

    isActorFootprintSupportedAtWorldPosition(x, y, layer = 0, actor = null, options = {}) {
        const perfEnabled = typeof globalThis !== "undefined" &&
            globalThis.movementPerfBreakdownState &&
            globalThis.movementPerfBreakdownState.enabled === true &&
            typeof globalThis.recordMovementPerfSection === "function";
        const perfStartMs = perfEnabled ? performance.now() : 0;
        try {
            const targetLayer = Number.isFinite(layer) ? Math.round(Number(layer)) : 0;
            const radius = this.getActorMovementSupportRadius(actor, options);
            const currentSupport = actor && actor.currentMovementSupport && typeof actor.currentMovementSupport === "object"
                ? actor.currentMovementSupport
                : null;
            const cachedFragment = currentSupport &&
                currentSupport.type === "floor" &&
                currentSupport.fragmentId &&
                this.floorsById instanceof Map
                ? this.floorsById.get(currentSupport.fragmentId) || null
                : null;
            if (cachedFragment) {
                const cachedFragmentId = typeof cachedFragment.fragmentId === "string"
                    ? cachedFragment.fragmentId
                    : (typeof cachedFragment.id === "string" ? cachedFragment.id : "");
                const cachedLayer = Number.isFinite(cachedFragment.level) ? Math.round(Number(cachedFragment.level)) : 0;
                if (
                    cachedLayer === targetLayer &&
                    (!cachedFragmentId || !(this.floorsById instanceof Map) || this.floorsById.get(cachedFragmentId) === cachedFragment) &&
                    this.isCircleSupportedByFloorFragment(cachedFragment, x, y, radius)
                ) {
                    return true;
                }
            }
            let hasFragmentsAtLayer = false;
            const fragments = typeof this.getFloorFragmentsForLayer === "function"
                ? this.getFloorFragmentsForLayer(targetLayer)
                : (this.floorsById instanceof Map ? Array.from(this.floorsById.values()) : []);
            for (let i = 0; i < fragments.length; i++) {
                const fragment = fragments[i];
                if (!fragment) continue;
                const fragmentLayer = Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0;
                if (fragmentLayer !== targetLayer) continue;
                if (!Array.isArray(fragment.outerPolygon) || fragment.outerPolygon.length < 3) continue;
                hasFragmentsAtLayer = true;
                if (this.isCircleSupportedByFloorFragment(fragment, x, y, radius)) return true;
            }
            return !hasFragmentsAtLayer && targetLayer === 0;
        } finally {
            if (perfEnabled) globalThis.recordMovementPerfSection("map.isActorFootprintSupported", performance.now() - perfStartMs);
        }
    }

    getFloorSupportAtWorldPosition(x, y, layer = 0, options = {}) {
        const perfEnabled = typeof globalThis !== "undefined" &&
            globalThis.movementPerfBreakdownState &&
            globalThis.movementPerfBreakdownState.enabled === true &&
            typeof globalThis.recordMovementPerfSection === "function";
        const perfStartMs = perfEnabled ? performance.now() : 0;
        try {
            const targetLayer = Number.isFinite(layer) ? Math.round(Number(layer)) : 0;
            const supportCache = options &&
                options._movementSupportCache &&
                options._movementSupportCache.floorSupportByKey instanceof Map
                ? options._movementSupportCache.floorSupportByKey
                : null;
            const supportCacheKey = supportCache
                ? `${targetLayer}:${Number(x)}:${Number(y)}`
                : "";
            if (supportCache && supportCache.has(supportCacheKey)) {
                return supportCache.get(supportCacheKey);
            }
            const cacheSupportResult = (value) => {
                if (supportCache) supportCache.set(supportCacheKey, value);
                return value;
            };
            const baseNode = typeof this.worldToNode === "function" ? this.worldToNode(x, y) : null;
            let best = null;
            let bestArea = Infinity;
            const fragments = typeof this.getFloorFragmentsForLayer === "function"
                ? this.getFloorFragmentsForLayer(targetLayer)
                : (this.floorsById instanceof Map ? Array.from(this.floorsById.values()) : []);
            for (let i = 0; i < fragments.length; i++) {
                const fragment = fragments[i];
                if (!fragment) continue;
                const fragmentLayer = Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0;
                if (fragmentLayer !== targetLayer) continue;
                if (!this.isPointSupportedByFloorFragment(fragment, x, y)) continue;
                const area = Math.abs(this.getPolygonSignedArea2D(fragment.outerPolygon));
                if (!best || area < bestArea) {
                    best = fragment;
                    bestArea = area;
                }
            }
            if (!best && targetLayer !== 0) return cacheSupportResult(null);
            if (!best && targetLayer === 0 && this.floorsById instanceof Map) {
                const groundFragments = typeof this.getFloorFragmentsForLayer === "function"
                    ? this.getFloorFragmentsForLayer(0)
                    : Array.from(this.floorsById.values());
                let hasGroundFragments = false;
                for (const fragment of groundFragments) {
                    if (!fragment) continue;
                    const fragmentLayer = Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0;
                    if (fragmentLayer === 0 && Array.isArray(fragment.outerPolygon) && fragment.outerPolygon.length >= 3) {
                        hasGroundFragments = true;
                        break;
                    }
                }
                if (hasGroundFragments) return cacheSupportResult(null);
            }
            if (!best && !baseNode) return cacheSupportResult(null);
            let node = baseNode;
            if (best && targetLayer !== 0 && baseNode && typeof this.getFloorNodeAtLayer === "function") {
                node = this.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, targetLayer, {
                    fragmentId: best.fragmentId,
                    surfaceId: best.surfaceId,
                    sectionKey: best.ownerSectionKey || "",
                    worldX: x,
                    worldY: y,
                    allowScan: true
                }) || null;
            }
            if (best && targetLayer === 0 && baseNode && typeof this.getFloorNodeAtLayer === "function") {
                node = this.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, targetLayer, {
                    fragmentId: best.fragmentId,
                    surfaceId: best.surfaceId,
                    sectionKey: best.ownerSectionKey || "",
                    worldX: x,
                    worldY: y,
                    allowScan: true
                }) || baseNode;
            }
            const baseZ = best && Number.isFinite(best.nodeBaseZ)
                ? Number(best.nodeBaseZ)
                : this.getNodeBaseZ(node);
            return cacheSupportResult({
                type: "floor",
                layer: targetLayer,
                baseZ,
                fragment: best,
                fragmentId: best && typeof best.fragmentId === "string" ? best.fragmentId : "",
                surfaceId: best && typeof best.surfaceId === "string" ? best.surfaceId : "",
                ownerType: best && typeof best.ownerType === "string" ? best.ownerType : "",
                ownerId: best && typeof best.ownerId === "string" ? best.ownerId : "",
                sectionKey: best && typeof best.ownerSectionKey === "string" ? best.ownerSectionKey : "",
                node
            });
        } finally {
            if (perfEnabled) globalThis.recordMovementPerfSection("map.getFloorSupport", performance.now() - perfStartMs);
        }
    }

    getPolygonSignedArea2D(points) {
        if (!Array.isArray(points) || points.length < 3) return 0;
        let sum = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            const ax = Number(a && a.x);
            const ay = Number(a && a.y);
            const bx = Number(b && b.x);
            const by = Number(b && b.y);
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
            sum += ax * by - bx * ay;
        }
        return sum * 0.5;
    }

    actorFootprintOverlapsPolygon(polygon, x, y, actor = null, options = {}) {
        if (!Array.isArray(polygon) || polygon.length < 3) return false;
        const cx = Number(x);
        const cy = Number(y);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return false;
        const radius = this.getActorMovementSupportRadius(actor, options);
        if (pointInPolygon2D(cx, cy, polygon)) return true;
        if (radius > 0 && getPointPolygonBoundaryDistanceSq2D(cx, cy, polygon) <= (radius * radius) + 1e-9) return true;
        return false;
    }

    getStairLowClearanceUpDownRanges(stair) {
        if (!stair) return [];
        const stepCount = Number.isFinite(Number(stair.stepCount))
            ? Math.max(1, Math.round(Number(stair.stepCount)))
            : 1;
        const lowerZ = Number(stair.lowerZ);
        const higherZ = Number(stair.higherZ);
        const height = higherZ - lowerZ;
        if (!Number.isFinite(height) || !(height > 0)) {
            throw new Error(`stair ${stair.id || "(unknown)"} lower movement blocker requires positive height`);
        }
        const riserDepth = Number(stair.riserDepth);
        if (!Number.isFinite(riserDepth) || riserDepth < 0) {
            throw new Error(`stair ${stair.id || "(unknown)"} lower movement blocker requires non-negative riserDepth`);
        }
        const ranges = [];
        let activeRange = null;
        for (let index = 0; index < stepCount; index++) {
            const treadHeight = height * (index / stepCount);
            const blocked = treadHeight - riserDepth < 2 - 0.000001;
            if (!blocked) {
                if (activeRange) {
                    ranges.push(activeRange);
                    activeRange = null;
                }
                continue;
            }
            const min = index / stepCount;
            const max = (index + 1) / stepCount;
            if (activeRange) {
                activeRange.max = max;
            } else {
                activeRange = { min, max };
            }
        }
        if (activeRange) ranges.push(activeRange);
        return ranges;
    }

    getStairUpperCutoutPolygons(stair) {
        if (!stair || !(this.floorsById instanceof Map)) return [];
        const higherFragmentId = typeof stair.higherFragmentId === "string" ? stair.higherFragmentId : "";
        let fragment = higherFragmentId ? this.floorsById.get(higherFragmentId) : null;
        if (!fragment && typeof stair.higherSurfaceId === "string" && stair.higherSurfaceId.length > 0) {
            const higherLayer = Number.isFinite(Number(stair.higherLevel)) ? Math.round(Number(stair.higherLevel)) : null;
            const higherZ = Number(stair.higherZ);
            for (const candidate of this.floorsById.values()) {
                if (!candidate || candidate.surfaceId !== stair.higherSurfaceId) continue;
                if (higherLayer !== null && Math.round(Number(candidate.level) || 0) !== higherLayer) continue;
                const candidateZ = Number.isFinite(Number(candidate.nodeBaseZ))
                    ? Number(candidate.nodeBaseZ)
                    : Number(candidate.baseZ);
                if (Number.isFinite(higherZ) && Number.isFinite(candidateZ) && Math.abs(candidateZ - higherZ) > 0.000001) continue;
                fragment = candidate;
                break;
            }
        }
        if (!fragment) throw new Error(`stair ${stair.id || "(unknown)"} references missing higher floor ${higherFragmentId}`);
        const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
        const traversal = this.requireStairTraversal();
        const frame = this.getStairTraversalFrame(stair);
        const footprint = traversal.pathPolygonForUpDownRange(frame, 0, 1);
        if (!Array.isArray(footprint) || footprint.length < 3) {
            throw new Error(`stair ${stair.id || "(unknown)"} upper movement blocker requires a footprint polygon`);
        }
        const stepCount = Number.isFinite(Number(stair.stepCount))
            ? Math.max(1, Math.round(Number(stair.stepCount)))
            : 1;
        const topStep = traversal.pathPolygonForUpDownRange(frame, 1 - (1 / stepCount), 1);
        if (!Array.isArray(topStep) || topStep.length < 3) {
            throw new Error(`stair ${stair.id || "(unknown)"} upper movement blocker requires a top-step polygon`);
        }
        if (holes.length === 0) {
            const lowerZ = Number(stair.lowerZ);
            const higherZ = Number(stair.higherZ);
            const height = higherZ - lowerZ;
            if (!Number.isFinite(height) || !(height > 0)) {
                throw new Error(`stair ${stair.id || "(unknown)"} implicit upper movement blocker requires positive height`);
            }
            const thresholdZ = higherZ - 2;
            const implicit = [];
            for (let index = 0; index < stepCount; index++) {
                if (index === stepCount - 1) continue;
                const stepZ = lowerZ + height * ((index + 1) / (stepCount + 1));
                if (stepZ < thresholdZ - 0.000001 || stepZ > higherZ + 0.000001) continue;
                const polygon = traversal.pathPolygonForUpDownRange(frame, index / stepCount, (index + 1) / stepCount);
                if (!Array.isArray(polygon) || polygon.length < 3) {
                    throw new Error(`stair ${stair.id || "(unknown)"} implicit upper movement blocker step ${index} requires a polygon`);
                }
                implicit.push(polygon);
            }
            return implicit;
        }
        const clipper = getPolygonClippingApi2D();
        if (!clipper || typeof clipper.difference !== "function") {
            throw new Error(`stair ${stair.id || "(unknown)"} upper movement blocker requires polygon-clipping`);
        }
        const topStepRing = polygonToClipRing2D(topStep);
        if (!topStepRing) throw new Error(`stair ${stair.id || "(unknown)"} upper movement blocker has invalid top-step polygon`);
        const blockers = [];
        holes.forEach((hole, holeIndex) => {
            if (!Array.isArray(hole) || hole.length < 3 || !polygonsOverlap2D(hole, footprint)) return;
            const holeRing = polygonToClipRing2D(hole);
            if (!holeRing) throw new Error(`stair ${stair.id || "(unknown)"} upper movement blocker has invalid hole ${holeIndex}`);
            const clipped = clipper.difference([[holeRing]], [[topStepRing]]);
            if (!Array.isArray(clipped)) {
                throw new Error(`stair ${stair.id || "(unknown)"} upper movement blocker clipping failed`);
            }
            clipped.forEach((polygon, polygonIndex) => {
                if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) {
                    throw new Error(`stair ${stair.id || "(unknown)"} upper movement blocker produced malformed polygon ${polygonIndex}`);
                }
                if (polygon.length > 1) {
                    throw new Error(`stair ${stair.id || "(unknown)"} upper movement blocker cannot contain holes after top-step exclusion`);
                }
                blockers.push(clipRingToPolygonPoints2D(
                    polygon[0],
                    `stair ${stair.id || "(unknown)"} upper movement blocker ${holeIndex}:${polygonIndex}`
                ));
            });
        });
        return blockers;
    }

    createStairMovementBlocker(stair, polygon, layer = 0, baseZ = null, endpoint = "", index = 0) {
        if (!stair) return null;
        const PolygonHitboxCtor = typeof PolygonHitbox === "function"
            ? PolygonHitbox
            : (typeof globalThis !== "undefined" && typeof globalThis.PolygonHitbox === "function"
                ? globalThis.PolygonHitbox
                : null);
        if (typeof PolygonHitboxCtor !== "function") {
            throw new Error("stair footprint movement blocking requires PolygonHitbox");
        }
        if (!Array.isArray(polygon) || polygon.length < 3) {
            throw new Error(`stair ${stair.id || "(unknown)"} footprint blocker requires a polygon`);
        }
        const bounds = getPolygonBounds2D(polygon);
        if (!bounds) throw new Error(`stair ${stair.id || "(unknown)"} footprint blocker has invalid bounds`);
        const traversalLayer = Number.isFinite(Number(layer)) ? Math.round(Number(layer)) : 0;
        if (!Number.isFinite(Number(baseZ))) {
            throw new Error(`stair ${stair.id || "(unknown)"} footprint blocker requires finite baseZ`);
        }
        const bottomZ = Number(baseZ);
        if (!(stair._movementFootprintBlockersByLayer instanceof Map)) {
            stair._movementFootprintBlockersByLayer = new Map();
        }
        const key = `${traversalLayer}:${bottomZ}:${endpoint}:${index}`;
        const cached = stair._movementFootprintBlockersByLayer.get(key);
        const polygonSignature = polygon.map(point => `${Number(point && point.x).toFixed(6)},${Number(point && point.y).toFixed(6)}`).join(";");
        if (cached && cached._movementPolygonSignature === polygonSignature) return cached;
        const blocker = {
            type: "stairFootprintMovementBlocker",
            id: `${stair.id || "stair"}:footprint:${key}`,
            stairId: stair.id,
            stairKind: stair.stairKind || "treadPath",
            endpoint,
            traversalLayer,
            level: traversalLayer,
            bottomZ,
            height: Math.max(0.01, Math.abs(Number(stair.higherZ) - Number(stair.lowerZ)) || 3),
            isPassable: false,
            gone: false,
            groundPlaneHitbox: new PolygonHitboxCtor(polygon),
            _stairFootprintMovementBlocker: true,
            _stairEndpoint: endpoint,
            _stairRecord: stair,
            _movementBounds: bounds,
            _movementPolygon: polygon,
            _movementPolygonSignature: polygonSignature
        };
        stair._movementFootprintBlockersByLayer.set(key, blocker);
        return blocker;
    }

    getStairFootprintMovementBlockers(stair, floorSupport) {
        if (!stair || !floorSupport) return [];
        const endpoint = this.getStairEndpointForFloorSupport(floorSupport, stair);
        if (!endpoint) return [];
        const layer = Number.isFinite(Number(floorSupport.layer)) ? Math.round(Number(floorSupport.layer)) : 0;
        if (!Number.isFinite(Number(floorSupport.baseZ))) {
            throw new Error(`stair ${stair.id || "(unknown)"} footprint blockers require finite floor support baseZ`);
        }
        const baseZ = Number(floorSupport.baseZ);
        const fragment = floorSupport.fragment && typeof floorSupport.fragment === "object"
            ? floorSupport.fragment
            : (
                floorSupport.fragmentId && this.floorsById instanceof Map
                    ? this.floorsById.get(floorSupport.fragmentId) || null
                    : null
            );
        const polygonSignature = (polygon) => Array.isArray(polygon)
            ? polygon.map(point => `${Number(point && point.x).toFixed(4)},${Number(point && point.y).toFixed(4)}`).join(";")
            : "";
        const holeSignature = fragment && Array.isArray(fragment.holes)
            ? fragment.holes.map(polygonSignature).join("|")
            : "";
        const cacheKey = `${layer}:${baseZ}:${endpoint}`;
        const cacheSignature = [
            Number(stair.lowerLevel),
            Number(stair.higherLevel),
            Number(stair.lowerZ),
            Number(stair.higherZ),
            Number(stair.stepCount),
            Number(stair.riserDepth),
            String(stair.lowerFragmentId || ""),
            String(stair.higherFragmentId || ""),
            String(stair.lowerSurfaceId || ""),
            String(stair.higherSurfaceId || ""),
            String(floorSupport.fragmentId || ""),
            String(floorSupport.surfaceId || ""),
            holeSignature
        ].join(":");
        if (!(stair._movementFootprintBlockerGroups instanceof Map)) {
            stair._movementFootprintBlockerGroups = new Map();
        }
        const cachedGroup = stair._movementFootprintBlockerGroups.get(cacheKey);
        if (cachedGroup && cachedGroup.signature === cacheSignature && Array.isArray(cachedGroup.blockers)) {
            return cachedGroup.blockers;
        }
        const traversal = this.requireStairTraversal();
        const frame = this.getStairTraversalFrame(stair);
        const polygons = [];
        if (endpoint === "lower") {
            const ranges = this.getStairLowClearanceUpDownRanges(stair);
            for (let index = 0; index < ranges.length; index++) {
                const range = ranges[index];
                const polygon = traversal.pathPolygonForUpDownRange(frame, range.min, range.max);
                polygons.push({ polygon, endpoint, index });
            }
        } else if (endpoint === "higher") {
            const cutouts = this.getStairUpperCutoutPolygons(stair);
            for (let index = 0; index < cutouts.length; index++) {
                polygons.push({ polygon: cutouts[index], endpoint, index });
            }
        } else {
            throw new Error(`unknown stair endpoint: ${endpoint}`);
        }
        const blockers = polygons
            .map(entry => this.createStairMovementBlocker(stair, entry.polygon, layer, baseZ, entry.endpoint, entry.index))
            .filter(Boolean);
        stair._movementFootprintBlockerGroups.set(cacheKey, {
            signature: cacheSignature,
            blockers
        });
        return blockers;
    }

    collectStairFootprintMovementBlockersInBounds(bounds, actor = null, options = {}) {
        const perfEnabled = typeof globalThis !== "undefined" &&
            globalThis.movementPerfBreakdownState &&
            globalThis.movementPerfBreakdownState.enabled === true &&
            typeof globalThis.recordMovementPerfSection === "function";
        const perfStartMs = perfEnabled ? performance.now() : 0;
        try {
            if (!(this.stairsById instanceof Map) || this.stairsById.size === 0) return [];
            const queryBounds = bounds && Number.isFinite(Number(bounds.minX)) && Number.isFinite(Number(bounds.minY)) &&
                Number.isFinite(Number(bounds.maxX)) && Number.isFinite(Number(bounds.maxY))
                ? {
                    minX: Number(bounds.minX),
                    minY: Number(bounds.minY),
                    maxX: Number(bounds.maxX),
                    maxY: Number(bounds.maxY)
                }
                : null;
            if (!queryBounds) throw new Error("stair footprint movement blocker query requires finite bounds");
            const layer = this.getActorTraversalLayer(actor, options);
            const movementSupportCache = options &&
                options._movementSupportCache &&
                options._movementSupportCache.actor === actor
                ? options._movementSupportCache
                : null;
            const currentFloorSupport = (
                movementSupportCache &&
                movementSupportCache.currentFloorSupport &&
                movementSupportCache.currentFloorSupportLayer === layer
            )
                ? movementSupportCache.currentFloorSupport
                : this.getFloorSupportAtWorldPosition(
                    Number(actor && actor.x),
                    Number(actor && actor.y),
                    layer,
                    options
                );
            if (!currentFloorSupport) return [];
            const blockers = [];
            for (const stair of this.stairsById.values()) {
                if (!stair) continue;
                if (!this.getStairEndpointForFloorSupport(currentFloorSupport, stair)) continue;
                const stairBlockers = this.getStairFootprintMovementBlockers(stair, currentFloorSupport);
                for (let i = 0; i < stairBlockers.length; i++) {
                    const blocker = stairBlockers[i];
                    if (!blocker) continue;
                    if (this.actorCanIgnoreStairFootprintMovementBlocker(blocker, actor, options)) continue;
                    if (!polygonBoundsOverlap2D(queryBounds, blocker._movementBounds)) continue;
                    blockers.push(blocker);
                }
            }
            return blockers;
        } finally {
            if (perfEnabled) globalThis.recordMovementPerfSection("map.collectStairFootprintBlockers", performance.now() - perfStartMs);
        }
    }

    getStairTreadAtWorldPosition(x, y) {
        if (!(this.stairsById instanceof Map) || this.stairsById.size === 0) return null;
        const traversal = this.requireStairTraversal();
        let best = null;
        let bestDistance = Infinity;
        for (const stair of this.stairsById.values()) {
            if (!stair) continue;
            const frame = this.getStairTraversalFrame(stair);
            const local = traversal.localPointForPathFrame(frame, { x, y });
            if (!traversal.localInsidePathFrame(frame, local, 0)) continue;
            const distance = Number.isFinite(local.projectionError) ? Number(local.projectionError) : 0;
            if (!best || distance < bestDistance) {
                best = traversal.supportFromPathLocal(stair, frame, local);
                bestDistance = distance;
            }
        }
        return best;
    }

    getActorStairSupportAtWorldPosition(x, y, actor = null, options = {}) {
        if (!(this.stairsById instanceof Map) || this.stairsById.size === 0) return null;
        const traversal = this.requireStairTraversal();
        const actorLayer = this.getActorTraversalLayer(actor, options);
        let best = null;
        let bestDistance = Infinity;
        for (const stair of this.stairsById.values()) {
            if (!stair) continue;
            const lowerLayer = Number.isFinite(stair.lowerLevel) ? Math.round(Number(stair.lowerLevel)) : 0;
            const higherLayer = Number.isFinite(stair.higherLevel) ? Math.round(Number(stair.higherLevel)) : lowerLayer + 1;
            if (actorLayer !== lowerLayer && actorLayer !== higherLayer) continue;
            const frame = this.getStairTraversalFrame(stair);
            const local = traversal.localPointForPathFrame(frame, { x, y });
            if (!traversal.localInsidePathFrame(frame, local, 0)) continue;
            const distance = Number.isFinite(local.projectionError) ? Number(local.projectionError) : 0;
            if (!best || distance < bestDistance) {
                const support = traversal.supportFromPathLocal(stair, frame, this.clampStairLocalSide(frame, local, actor, options));
                best = support;
                bestDistance = distance;
            }
        }
        return best;
    }

    getStairTreadSupport(stair, treadIndex) {
        if (!stair) return null;
        const resolvedIndex = Math.round(Number(treadIndex));
        const stepCount = Number.isFinite(Number(stair.stepCount)) ? Math.max(1, Math.round(Number(stair.stepCount))) : 1;
        if (!Number.isInteger(resolvedIndex) || resolvedIndex < 0 || resolvedIndex >= stepCount) {
            throw new Error(`stair runtime record ${stair.id || "(unknown)"} has invalid tread index ${resolvedIndex}`);
        }
        const traversal = this.requireStairTraversal();
        const frame = this.getStairTraversalFrame(stair);
        const upDown = (resolvedIndex + 0.5) / stepCount;
        const point = traversal.pointFromPathLocal(frame, upDown, 0.5);
        const local = traversal.localPointForPathFrame(frame, point);
        return traversal.supportFromPathLocal(stair, frame, {
            ...local,
            upDown,
            leftRight: 0.5
        });
    }

    getActorStairSupportFromState(actor) {
        const state = actor && actor.currentMovementSupport && typeof actor.currentMovementSupport === "object" && actor.currentMovementSupport.type === "stair"
            ? actor.currentMovementSupport
            : null;
        if (!state) return null;
        const stairId = typeof state.stairId === "string" ? state.stairId : "";
        if (!stairId) throw new Error("actor stair support is missing stairId");
        if (!(this.stairsById instanceof Map)) throw new Error("actor stair support exists without stair runtime records");
        const stair = this.stairsById.get(stairId);
        if (!stair) throw new Error(`actor stair support references missing stair ${stairId}`);
        if (Number.isFinite(state.upDown) && Number.isFinite(state.leftRight)) {
            const traversal = this.requireStairTraversal();
            const frame = this.getStairTraversalFrame(stair);
            const upDown = Math.max(0, Math.min(1, Number(state.upDown)));
            const leftRight = Math.max(0, Math.min(1, Number(state.leftRight)));
            return traversal.supportFromPathLocal(stair, frame, {
                upDown,
                leftRight,
                projectionError: 0
            });
        }
        return this.getStairTreadSupport(stair, state.treadIndex);
    }

    getActorTraversalLayer(actor = null, options = {}) {
        const candidates = [
            options && options.traversalLayer,
            options && options.currentLayer,
            actor && actor.currentLayer,
            actor && actor.traversalLayer,
            actor && actor.level,
            actor && actor.node && actor.node.traversalLayer,
            actor && actor.node && actor.node.level
        ];
        for (let i = 0; i < candidates.length; i++) {
            const value = Number(candidates[i]);
            if (Number.isFinite(value)) return Math.round(value);
        }
        return 0;
    }

    actorUsesLocalMovementZ(actor) {
        if (!actor || typeof actor !== "object") return false;
        if (actor.type === "wizard") return true;
        if (actor.constructor && actor.constructor.name === "Wizard") return true;
        if (
            actor.isPlacedObject === true &&
            !Number.isInteger(actor.mountedWallLineGroupId) &&
            !Number.isInteger(actor.mountedSectionId) &&
            !Number.isInteger(actor.mountedWallSectionUnitId) &&
            !(typeof actor.isWindowObject === "function" && actor.isWindowObject())
        ) {
            return true;
        }
        return typeof actor.drawHat === "function" && typeof actor.drawShield === "function";
    }

    actorAppearsOnFloorSupport(actor, floorSupport) {
        if (!floorSupport || floorSupport.type !== "floor") return false;
        const actorZ = Number(actor && actor.z);
        if (!Number.isFinite(actorZ)) return true;
        const tolerance = 0.0001;
        if (this.actorUsesLocalMovementZ(actor)) {
            return Math.abs(actorZ) <= tolerance;
        }
        const floorBaseZ = Number(floorSupport.baseZ);
        return Number.isFinite(floorBaseZ) && Math.abs(actorZ - floorBaseZ) <= tolerance;
    }

    getActorMovementSupportRadius(actor = null, options = {}) {
        if (Number.isFinite(options && options.supportRadius)) return Math.max(0, Number(options.supportRadius));
        if (actor && typeof actor.getVectorMovementCollisionRadius === "function") {
            const radius = actor.getVectorMovementCollisionRadius(options);
            if (Number.isFinite(radius)) return Math.max(0, Number(radius));
        }
        if (actor && Number.isFinite(actor.groundRadius)) return Math.max(0, Number(actor.groundRadius));
        return 0;
    }

    getActorKnownFloorSupport(actor = null, layer = null, options = {}) {
        if (!actor || typeof actor !== "object") return null;
        const currentSupport = actor.currentMovementSupport && typeof actor.currentMovementSupport === "object"
            ? actor.currentMovementSupport
            : null;
        if (currentSupport && currentSupport.type === "stair") return null;
        const targetLayer = Number.isFinite(layer)
            ? Math.round(Number(layer))
            : this.getActorTraversalLayer(actor, options);
        if (
            currentSupport &&
            currentSupport.type === "floor" &&
            currentSupport.layer === targetLayer &&
            currentSupport.fragmentId &&
            this.floorsById instanceof Map
        ) {
            const fragment = this.floorsById.get(currentSupport.fragmentId) || null;
            if (fragment) {
                return {
                    type: "floor",
                    layer: currentSupport.layer,
                    baseZ: currentSupport.baseZ,
                    fragment,
                    fragmentId: currentSupport.fragmentId,
                    surfaceId: currentSupport.surfaceId || (typeof fragment.surfaceId === "string" ? fragment.surfaceId : ""),
                    ownerType: typeof currentSupport.ownerType === "string" ? currentSupport.ownerType : (typeof fragment.ownerType === "string" ? fragment.ownerType : ""),
                    ownerId: typeof currentSupport.ownerId === "string" ? currentSupport.ownerId : (typeof fragment.ownerId === "string" ? fragment.ownerId : ""),
                    sectionKey: typeof currentSupport.sectionKey === "string" ? currentSupport.sectionKey : (typeof fragment.ownerSectionKey === "string" ? fragment.ownerSectionKey : ""),
                    node: actor.node && typeof actor.node === "object" ? actor.node : null
                };
            }
        }
        const actorFragmentId = typeof actor.fragmentId === "string" ? actor.fragmentId : "";
        const fragment = actorFragmentId && this.floorsById instanceof Map
            ? this.floorsById.get(actorFragmentId) || null
            : null;
        if (!fragment) return null;
        const fragmentId = typeof fragment.fragmentId === "string" ? fragment.fragmentId : "";
        if (fragmentId && this.floorsById instanceof Map && this.floorsById.get(fragmentId) !== fragment) return null;
        const fragmentLayer = Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0;
        if (fragmentLayer !== targetLayer) return null;
        const node = actor.node && typeof actor.node === "object"
            ? actor.node
            : null;
        const nodeFragmentId = node && typeof node.fragmentId === "string" ? node.fragmentId : "";
        const nodeSurfaceId = node && typeof node.surfaceId === "string" ? node.surfaceId : "";
        const surfaceId = typeof fragment.surfaceId === "string" && fragment.surfaceId.length > 0
            ? fragment.surfaceId
            : (typeof actor.surfaceId === "string" ? actor.surfaceId : nodeSurfaceId);
        const ownerType = typeof fragment.ownerType === "string" ? fragment.ownerType : "";
        const ownerId = typeof fragment.ownerId === "string" ? fragment.ownerId : "";
        const baseZ = Number.isFinite(fragment.nodeBaseZ)
            ? Number(fragment.nodeBaseZ)
            : (Number.isFinite(actor.currentLayerBaseZ) ? Number(actor.currentLayerBaseZ) : null);
        if (!Number.isFinite(baseZ)) {
            throw new Error(`actor floor support for fragment ${fragmentId || "(unknown)"} requires nodeBaseZ or actor currentLayerBaseZ`);
        }
        return {
            type: "floor",
            layer: targetLayer,
            baseZ,
            fragment,
            fragmentId,
            surfaceId,
            ownerType,
            ownerId,
            sectionKey: typeof fragment.ownerSectionKey === "string" ? fragment.ownerSectionKey : "",
            node: node && (
                (fragmentId && nodeFragmentId === fragmentId) ||
                (!fragmentId && surfaceId && nodeSurfaceId === surfaceId)
            ) ? node : null
        };
    }

    getActorSupportWorldZ(actor = null, support = null, options = {}) {
        const optionWorldZ = Number(options && options.worldZ);
        if (Number.isFinite(optionWorldZ)) return optionWorldZ;
        const actorZ = Number(actor && actor.z);
        if (this.actorUsesLocalMovementZ(actor)) {
            const baseZ = Number.isFinite(actor && actor.currentLayerBaseZ)
                ? Number(actor.currentLayerBaseZ)
                : (support && Number.isFinite(support.baseZ) ? Number(support.baseZ) : null);
            if (!Number.isFinite(baseZ)) {
                throw new Error(`actor ${actor && (actor.id || actor.name || actor.type) || "(unknown)"} support world Z requires currentLayerBaseZ or support baseZ`);
            }
            return baseZ + (Number.isFinite(actorZ) ? actorZ : 0);
        }
        if (Number.isFinite(actorZ)) return actorZ;
        if (support && Number.isFinite(support.baseZ)) return Number(support.baseZ);
        throw new Error(`actor ${actor && (actor.id || actor.name || actor.type) || "(unknown)"} support world Z requires worldZ, actor z, or support baseZ`);
    }

    getActorSupportOwnerKey(support) {
        if (!support || typeof support !== "object") return "";
        const ownerType = typeof support.ownerType === "string" ? support.ownerType : "";
        const ownerId = typeof support.ownerId === "string" ? support.ownerId : "";
        if (!ownerType && !ownerId && support.type === "ground") return "section:";
        return `${ownerType}:${ownerId}`;
    }

    buildFloorSupportForFragmentAtWorldPosition(fragment, x, y, options = {}) {
        if (!fragment || typeof fragment !== "object") return null;
        const targetLayer = Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0;
        const baseNode = typeof this.worldToNode === "function" ? this.worldToNode(x, y) : null;
        let node = baseNode;
        if (baseNode && typeof this.getFloorNodeAtLayer === "function") {
            node = this.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, targetLayer, {
                fragmentId: fragment.fragmentId,
                surfaceId: fragment.surfaceId,
                sectionKey: fragment.ownerSectionKey || "",
                worldX: x,
                worldY: y,
                allowScan: options.allowScan !== false
            }) || (targetLayer === 0 ? baseNode : null);
        }
        const baseZ = Number.isFinite(fragment.nodeBaseZ)
            ? Number(fragment.nodeBaseZ)
            : (node ? this.getNodeBaseZ(node) : null);
        if (!Number.isFinite(baseZ)) {
            throw new Error(`floor support for fragment ${fragment.fragmentId || "(unknown)"} requires nodeBaseZ or floor node baseZ`);
        }
        return {
            type: "floor",
            layer: targetLayer,
            baseZ,
            fragment,
            fragmentId: typeof fragment.fragmentId === "string" ? fragment.fragmentId : "",
            surfaceId: typeof fragment.surfaceId === "string" ? fragment.surfaceId : "",
            ownerType: typeof fragment.ownerType === "string" ? fragment.ownerType : "",
            ownerId: typeof fragment.ownerId === "string" ? fragment.ownerId : "",
            sectionKey: typeof fragment.ownerSectionKey === "string" ? fragment.ownerSectionKey : "",
            node
        };
    }

    findActorMovementSupportBelow(actor, x, y, options = {}) {
        const worldX = Number(x);
        const worldY = Number(y);
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const currentSupport = actor && actor.currentMovementSupport && typeof actor.currentMovementSupport === "object"
            ? actor.currentMovementSupport
            : null;
        const maxZ = this.getActorSupportWorldZ(actor, currentSupport, options);
        const radius = this.getActorMovementSupportRadius(actor, options);
        let bestFragment = null;
        let bestBaseZ = -Infinity;
        let bestArea = Infinity;
        const fragments = this.floorsById instanceof Map ? Array.from(this.floorsById.values()) : [];
        for (let i = 0; i < fragments.length; i++) {
            const fragment = fragments[i];
            if (!fragment || !Array.isArray(fragment.outerPolygon) || fragment.outerPolygon.length < 3) continue;
            if (!Number.isFinite(fragment.nodeBaseZ)) {
                throw new Error(`floor fragment ${fragment.fragmentId || fragment.id || "(unknown)"} requires finite nodeBaseZ`);
            }
            const baseZ = Number(fragment.nodeBaseZ);
            if (Number.isFinite(maxZ) && baseZ > maxZ + 1e-6) continue;
            if (!this.isCircleSupportedByFloorFragment(fragment, worldX, worldY, radius)) continue;
            const area = Math.abs(this.getPolygonSignedArea2D(fragment.outerPolygon));
            if (baseZ > bestBaseZ + 1e-6 || (Math.abs(baseZ - bestBaseZ) <= 1e-6 && area < bestArea)) {
                bestFragment = fragment;
                bestBaseZ = baseZ;
                bestArea = area;
            }
        }
        if (bestFragment) {
            return this.buildFloorSupportForFragmentAtWorldPosition(bestFragment, worldX, worldY, options);
        }
        if (options.allowOutdoorGround === false) return null;
        const hasGroundFragments = fragments.some((fragment) => (
            fragment &&
            Number.isFinite(fragment.level) &&
            Math.round(Number(fragment.level)) === 0 &&
            Array.isArray(fragment.outerPolygon) &&
            fragment.outerPolygon.length >= 3
        ));
        if (hasGroundFragments) return null;
        const groundNode = typeof this.worldToNode === "function" ? this.worldToNode(worldX, worldY) : null;
        if (!groundNode) return null;
        return {
            type: "ground",
            layer: 0,
            baseZ: 0,
            node: groundNode,
            ownerType: "section",
            ownerId: typeof groundNode._prototypeSectionKey === "string" ? groundNode._prototypeSectionKey : "",
            sectionKey: typeof groundNode._prototypeSectionKey === "string" ? groundNode._prototypeSectionKey : ""
        };
    }

    validateActorMovementSupport(actor, options = {}) {
        if (!actor || typeof actor !== "object") {
            throw new Error("support validation requires an actor or object");
        }
        const optionWorldX = Number(options.worldX);
        const optionWorldY = Number(options.worldY);
        const worldX = Number.isFinite(optionWorldX) ? optionWorldX : Number(actor.x);
        const worldY = Number.isFinite(optionWorldY) ? optionWorldY : Number(actor.y);
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
            throw new Error("support validation requires a finite world position");
        }
        const previousSupport = actor.currentMovementSupport && typeof actor.currentMovementSupport === "object"
            ? actor.currentMovementSupport
            : null;
        let currentStillValid = false;
        if (previousSupport && previousSupport.type === "floor") {
            const fragmentId = typeof previousSupport.fragmentId === "string" ? previousSupport.fragmentId : "";
            const fragment = fragmentId && this.floorsById instanceof Map
                ? this.floorsById.get(fragmentId) || null
                : null;
            if (fragmentId && !fragment) {
                throw new Error(`support validation references missing floor fragment ${fragmentId}`);
            }
            currentStillValid = !!(
                fragment &&
                this.isCircleSupportedByFloorFragment(
                    fragment,
                    worldX,
                    worldY,
                    this.getActorMovementSupportRadius(actor, options)
                )
            );
        } else if (previousSupport && previousSupport.type === "ground") {
            currentStillValid = this.isActorFootprintSupportedAtWorldPosition(worldX, worldY, 0, actor, options);
        }
        if (currentStillValid) {
            return {
                changed: false,
                ownerChanged: false,
                lost: false,
                previousSupport,
                nextSupport: previousSupport
            };
        }
        const nextSupport = this.findActorMovementSupportBelow(actor, worldX, worldY, options);
        if (!nextSupport) {
            if (options.markLost === true) {
                actor.gone = true;
                actor.lostToVoid = true;
            }
            return {
                changed: false,
                ownerChanged: false,
                lost: true,
                previousSupport,
                nextSupport: null
            };
        }
        const apply = options.apply !== false;
        const appliedSupport = apply
            ? this.setActorCurrentMovementSupport(actor, nextSupport, options)
            : nextSupport;
        const previousOwner = this.getActorSupportOwnerKey(previousSupport);
        const nextOwner = this.getActorSupportOwnerKey(appliedSupport);
        return {
            changed: true,
            ownerChanged: previousOwner !== nextOwner,
            lost: false,
            previousSupport,
            nextSupport: appliedSupport,
            previousOwner,
            nextOwner
        };
    }

    setActorCurrentMovementSupport(actor, support, options = {}) {
        if (!actor || !support || typeof support !== "object") return null;
        const previousLayer = Number.isFinite(actor.currentLayer)
            ? Math.round(Number(actor.currentLayer))
            : (Number.isFinite(actor.traversalLayer) ? Math.round(Number(actor.traversalLayer)) : 0);
        if (!Number.isFinite(actor.currentLayerBaseZ)) {
            throw new Error(`actor ${actor.id || actor.name || actor.type || "(unknown)"} movement support requires currentLayerBaseZ`);
        }
        const previousBaseZ = Number(actor.currentLayerBaseZ);
        const supportType = support.type === "stair"
            ? "stair"
            : (support.type === "floor" ? "floor" : "ground");
        let nextLayer = previousLayer;
        let nextBaseZ = previousBaseZ;
        let normalized = null;

        if (supportType === "stair") {
            nextLayer = this.getActiveLayerForStairSupport(support);
            nextBaseZ = this.getActiveBaseZForStairSupport(support);
            const stair = support.stair && typeof support.stair === "object" ? support.stair : null;
            const lowerZ = Number(stair && stair.lowerZ);
            const higherZ = Number(stair && stair.higherZ);
            const upDown = Number.isFinite(Number(support.upDown))
                ? Math.max(0, Math.min(1, Number(support.upDown)))
                : null;
            const localZ = Number(support.baseZ) - Number(nextBaseZ);
            const supportStairKind = typeof support.stairKind === "string"
                ? support.stairKind
                : (typeof (stair && stair.stairKind) === "string" ? stair.stairKind : "");
            const rampBaseZ = Number.isFinite(lowerZ) && Number.isFinite(higherZ) && upDown !== null
                ? lowerZ + (higherZ - lowerZ) * upDown
                : Number(support.baseZ);
            const rampLocalZ = Number(rampBaseZ) - Number(nextBaseZ);
            const continuousBaseZ = supportStairKind === "treadPath"
                ? Number(support.baseZ)
                : rampBaseZ;
            const continuousLocalZ = Number(continuousBaseZ) - Number(nextBaseZ);
            actor._stairSupport = {
                stairId: support.stairId,
                treadIndex: support.treadIndex,
                upDown: support.upDown,
                leftRight: support.leftRight,
                baseZ: support.baseZ,
                localZ,
                rampBaseZ,
                rampLocalZ,
                continuousBaseZ,
                continuousLocalZ
            };
            actor._activeFloorFragment = null;
            actor.z = this.actorUsesLocalMovementZ(actor) ? localZ : support.baseZ;
            normalized = {
                type: "stair",
                layer: nextLayer,
                baseZ: nextBaseZ,
                stairId: support.stairId || "",
                treadIndex: Number.isFinite(support.treadIndex) ? Math.round(Number(support.treadIndex)) : null,
                upDown: Number.isFinite(support.upDown) ? Number(support.upDown) : null,
                leftRight: Number.isFinite(support.leftRight) ? Number(support.leftRight) : null,
                localZ,
                rampBaseZ,
                rampLocalZ,
                continuousBaseZ,
                continuousLocalZ
            };
        } else if (supportType === "floor") {
            nextLayer = Number.isFinite(support.layer) ? Math.round(Number(support.layer)) : 0;
            if (!Number.isFinite(support.baseZ)) {
                throw new Error(`actor ${actor.id || actor.name || actor.type || "(unknown)"} floor support requires finite baseZ`);
            }
            nextBaseZ = Number(support.baseZ);
            const floorSupportApi = (typeof globalThis !== "undefined") ? globalThis.FloorSupport : null;
            const fragment = floorSupportApi && typeof floorSupportApi.getFragmentFromSupport === "function"
                ? floorSupportApi.getFragmentFromSupport(this, support)
                : (support.fragment && typeof support.fragment === "object"
                    ? support.fragment
                    : (support.fragmentId && this.floorsById instanceof Map ? this.floorsById.get(support.fragmentId) || null : null));
            const owner = floorSupportApi && typeof floorSupportApi.getSupportOwner === "function"
                ? floorSupportApi.getSupportOwner({ ...support, fragment }, this)
                : null;
            actor._stairSupport = null;
            actor._activeFloorFragment = fragment || null;
            actor.z = this.actorUsesLocalMovementZ(actor) ? 0 : nextBaseZ;
            normalized = {
                type: "floor",
                layer: nextLayer,
                baseZ: nextBaseZ,
                fragmentId: typeof support.fragmentId === "string" ? support.fragmentId : (fragment && fragment.fragmentId) || "",
                surfaceId: typeof support.surfaceId === "string" ? support.surfaceId : (fragment && fragment.surfaceId) || "",
                ownerType: owner ? owner.type : (typeof support.ownerType === "string" ? support.ownerType : (fragment && typeof fragment.ownerType === "string" ? fragment.ownerType : "")),
                ownerId: owner ? owner.id : (typeof support.ownerId === "string" ? support.ownerId : (fragment && typeof fragment.ownerId === "string" ? fragment.ownerId : "")),
                sectionKey: typeof (fragment && fragment.ownerSectionKey) === "string" ? fragment.ownerSectionKey : "",
                nodeId: support.node && typeof support.node.id === "string" ? support.node.id : ""
            };
            const floorSupportApiForMembership = (typeof globalThis !== "undefined") ? globalThis.FloorSupport : null;
            const floorMembership = floorSupportApiForMembership && typeof floorSupportApiForMembership.createFloorMembership === "function"
                ? floorSupportApiForMembership.createFloorMembership({
                    fragment,
                    ownerType: normalized.ownerType,
                    ownerId: normalized.ownerId,
                    sectionKey: normalized.sectionKey,
                    fragmentId: normalized.fragmentId,
                    surfaceId: normalized.surfaceId,
                    layer: nextLayer
                })
                : null;
            if (floorMembership) {
                normalized.floorMembership = floorMembership;
                actor._floorMembership = { ...floorMembership };
            }
        } else {
            nextLayer = 0;
            nextBaseZ = 0;
            actor._stairSupport = null;
            actor._activeFloorFragment = null;
            actor.z = this.actorUsesLocalMovementZ(actor) ? 0 : nextBaseZ;
            normalized = { type: "ground", layer: 0, baseZ: 0 };
        }

        actor.currentMovementSupport = normalized;
        actor.currentLayer = nextLayer;
        actor.traversalLayer = nextLayer;
        if (!Number.isFinite(nextBaseZ)) {
            throw new Error(`actor ${actor.id || actor.name || actor.type || "(unknown)"} movement support resolved non-finite baseZ`);
        }
        actor.currentLayerBaseZ = Number(nextBaseZ);
        if (this.actorUsesLocalMovementZ(actor) && Number.isFinite(actor.prevZ)) {
            const previousWorldZ = previousBaseZ + Number(actor.prevZ);
            actor.prevZ = previousWorldZ - actor.currentLayerBaseZ;
        }
        if (support.node) actor.node = support.node;
        if (normalized.surfaceId) actor.surfaceId = normalized.surfaceId;
        else if (supportType === "ground") actor.surfaceId = "";
        if (normalized.fragmentId) actor.fragmentId = normalized.fragmentId;
        else if (supportType === "ground") actor.fragmentId = "";

        if (
            this._floorObjectMembershipKeyByObject instanceof WeakMap &&
            this._floorObjectMembershipKeyByObject.has(actor)
        ) {
            if (supportType === "floor") {
                this.registerFloorObject(actor);
            } else {
                this.unregisterFloorObject(actor);
            }
        }

        if (options.suppressLayerTransition !== true) {
            const isGlobalWizard = typeof globalThis !== "undefined" && actor === globalThis.wizard;
            if (previousLayer !== nextLayer && isGlobalWizard) {
                actor._pendingLayerTransition = {
                    active: true,
                    fromLevel: previousLayer,
                    toLevel: nextLayer,
                    fromBaseZ: previousBaseZ,
                    toBaseZ: actor.currentLayerBaseZ,
                    startedAtMs: (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                        ? performance.now()
                        : Date.now(),
                    durationMs: 500
                };
            }
        }
        actor._previousLayerBaseZForTransition = actor.currentLayerBaseZ;
        if (
            options.suppressWorldScopeUpdate !== true &&
            typeof this.updatePrototypeWorldScopeForMovementSupport === "function"
        ) {
            this.updatePrototypeWorldScopeForMovementSupport(actor, normalized, options);
        }
        return normalized;
    }

    actorFootprintOverlapsStairFloorBlocker(stair, floorSupport, x, y, actor = null, options = {}) {
        if (!stair || !floorSupport) return false;
        const blockers = this.getStairFootprintMovementBlockers(stair, floorSupport);
        for (let i = 0; i < blockers.length; i++) {
            if (this.actorFootprintOverlapsPolygon(blockers[i]._movementPolygon, x, y, actor, options)) return true;
        }
        return false;
    }

    actorCanIgnoreStairFootprintMovementBlocker(blocker, actor = null, options = {}) {
        if (!blocker || blocker._stairFootprintMovementBlocker !== true) return false;
        const stair = blocker._stairRecord || null;
        if (!stair || !actor) return false;
        const candidateX = Number(options && options.candidateX);
        const candidateY = Number(options && options.candidateY);
        if (!Number.isFinite(candidateX) || !Number.isFinite(candidateY)) return false;
        if (blocker._stairEndpoint === "higher") {
            return this.actorApproachesStairEndpointMouth(stair, actor, candidateX, candidateY, "higher", options) === true;
        }
        if (blocker._stairEndpoint === "lower") {
            return this.actorMovesAwayFromStairEndpointMouth(stair, actor, candidateX, candidateY, "lower", options) === true;
        }
        return false;
    }

    getActorStairFastPathBuildingBlockerCollision(fromX, fromY, requestedX, requestedY, support, actor = null, options = {}) {
        if (typeof this.collectPrototypeBuildingMovementBlockersInBounds !== "function") return null;
        const startX = Number(fromX);
        const startY = Number(fromY);
        const targetX = Number(requestedX);
        const targetY = Number(requestedY);
        if (!Number.isFinite(startX) || !Number.isFinite(startY) || !Number.isFinite(targetX) || !Number.isFinite(targetY)) {
            throw new Error("stair fast-path blocker validation requires finite movement coordinates");
        }
        const supportPoint = support &&
            support.point &&
            Number.isFinite(Number(support.point.x)) &&
            Number.isFinite(Number(support.point.y))
            ? { x: Number(support.point.x), y: Number(support.point.y) }
            : { x: targetX, y: targetY };
        const radius = this.getActorMovementSupportRadius(actor, options);
        const queryPadding = Math.max(0.01, radius + 0.05);
        const queryBounds = {
            minX: Math.min(startX, targetX, supportPoint.x) - queryPadding,
            minY: Math.min(startY, targetY, supportPoint.y) - queryPadding,
            maxX: Math.max(startX, targetX, supportPoint.x) + queryPadding,
            maxY: Math.max(startY, targetY, supportPoint.y) + queryPadding
        };
        const layer = support && support.type === "stair"
            ? this.getActiveLayerForStairSupport(support)
            : (Number.isFinite(support && support.layer)
                ? Math.round(Number(support.layer))
                : this.getActorTraversalLayer(actor, options));
        const blockers = this.collectPrototypeBuildingMovementBlockersInBounds(queryBounds, layer, options);
        if (!Array.isArray(blockers) || blockers.length === 0) return null;

        const hitbox = { type: "circle", x: targetX, y: targetY, radius };
        const collisionInfoAt = (x, y) => {
            hitbox.x = x;
            hitbox.y = y;
            let strongest = null;
            for (let i = 0; i < blockers.length; i++) {
                const blocker = blockers[i];
                if (
                    !blocker ||
                    blocker.gone ||
                    !blocker.groundPlaneHitbox ||
                    typeof blocker.groundPlaneHitbox.intersects !== "function"
                ) {
                    continue;
                }
                const collision = blocker.groundPlaneHitbox.intersects(hitbox);
                if (!collision) continue;
                const pushX = Number(collision.pushX);
                const pushY = Number(collision.pushY);
                const depth = Number.isFinite(pushX) && Number.isFinite(pushY)
                    ? Math.hypot(pushX, pushY)
                    : 0;
                if (!strongest || depth > strongest.depth) {
                    strongest = { blocker, pushX, pushY, depth };
                }
            }
            return strongest;
        };
        const segmentCollision = (ax, ay, bx, by) => {
            const dx = bx - ax;
            const dy = by - ay;
            const distance = Math.hypot(dx, dy);
            const movementNormalTolerance = Math.max(1e-6, distance * 1e-6);
            const sampleCollision = (x, y) => {
                const sampleCollision = collisionInfoAt(x, y);
                if (!sampleCollision) return null;
                const pushX = Number(sampleCollision.pushX);
                const pushY = Number(sampleCollision.pushY);
                const depth = Number(sampleCollision.depth);
                if (!(depth > 1e-9) || !Number.isFinite(pushX) || !Number.isFinite(pushY)) {
                    return {
                        blocker: sampleCollision.blocker,
                        normalX: 0,
                        normalY: 0,
                        pushX: Number.isFinite(pushX) ? pushX : 0,
                        pushY: Number.isFinite(pushY) ? pushY : 0,
                        depth: Number.isFinite(depth) ? depth : 0,
                        hasNormal: false
                    };
                }
                const normalX = pushX / depth;
                const normalY = pushY / depth;
                const movementIntoNormal = dx * normalX + dy * normalY;
                if (movementIntoNormal >= -movementNormalTolerance) return null;
                return {
                    blocker: sampleCollision.blocker,
                    normalX,
                    normalY,
                    pushX,
                    pushY,
                    depth,
                    hasNormal: true
                };
            };
            if (!(distance > 1e-6)) return sampleCollision(bx, by);
            const stepSize = Math.max(0.03, Math.min(0.12, radius > 0 ? radius * 0.25 : 0.05));
            const steps = Math.min(32, Math.max(1, Math.ceil(distance / stepSize)));
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const collision = sampleCollision(ax + dx * t, ay + dy * t);
                if (collision) return collision;
            }
            return null;
        };
        const supportPointCollision = options && options.requireClearStairSupportPoint === true
            ? collisionInfoAt(supportPoint.x, supportPoint.y)
            : null;
        if (supportPointCollision) {
            const pushX = Number(supportPointCollision.pushX);
            const pushY = Number(supportPointCollision.pushY);
            const depth = Number(supportPointCollision.depth);
            if (depth > 1e-9 && Number.isFinite(pushX) && Number.isFinite(pushY)) {
                return {
                    blocker: supportPointCollision.blocker,
                    normalX: pushX / depth,
                    normalY: pushY / depth,
                    pushX,
                    pushY,
                    depth,
                    hasNormal: true,
                    supportPointOverlap: true
                };
            }
            return {
                blocker: supportPointCollision.blocker,
                normalX: 0,
                normalY: 0,
                pushX: Number.isFinite(pushX) ? pushX : 0,
                pushY: Number.isFinite(pushY) ? pushY : 0,
                depth: Number.isFinite(depth) ? depth : 0,
                hasNormal: false,
                supportPointOverlap: true
            };
        }

        return segmentCollision(startX, startY, targetX, targetY) ||
            segmentCollision(startX, startY, supportPoint.x, supportPoint.y);
    }

    actorStairFastPathClearsBuildingBlockers(fromX, fromY, requestedX, requestedY, support, actor = null, options = {}) {
        return !this.getActorStairFastPathBuildingBlockerCollision(
            fromX,
            fromY,
            requestedX,
            requestedY,
            support,
            actor,
            options
        );
    }

    getActorStairEndpointEntrySupport(stair, x, y, actor = null, options = {}) {
        if (!stair) return null;
        const traversal = this.requireStairTraversal();
        const frame = this.getStairTraversalFrame(stair);
        const endpoint = options && options.endpoint;
        if (endpoint !== "lower" && endpoint !== "higher") {
            throw new Error(`unknown stair endpoint: ${endpoint}`);
        }
        const localOptions = this.stairEndpointMouthProjectionOptions(stair, endpoint);
        const local = traversal.localPointForPathFrame(frame, { x, y }, localOptions);
        const clamped = this.clampStairLocalSide(frame, {
            ...local,
            upDown: endpoint === "lower" ? 0 : 1,
            projectionError: 0
        }, actor, options);
        return traversal.supportFromPathLocal(stair, frame, clamped);
    }

    slideStairEndpointEntrySupportPastBuildingBlocker(stair, endpoint, entrySupport, collision, actor = null, options = {}) {
        if (!stair || !entrySupport || !collision || collision.supportPointOverlap !== true) return null;
        if (endpoint !== "lower" && endpoint !== "higher") throw new Error(`unknown stair endpoint: ${endpoint}`);
        const point = entrySupport.point &&
            Number.isFinite(Number(entrySupport.point.x)) &&
            Number.isFinite(Number(entrySupport.point.y))
            ? { x: Number(entrySupport.point.x), y: Number(entrySupport.point.y) }
            : null;
        if (!point) return null;
        const pushX = Number(collision.pushX);
        const pushY = Number(collision.pushY);
        const depth = Number(collision.depth);
        if (!(depth > 1e-9) || !Number.isFinite(pushX) || !Number.isFinite(pushY)) return null;
        const traversal = this.requireStairTraversal();
        const frame = this.getStairTraversalFrame(stair);
        const nudge = Math.max(0.002, this.getActorMovementSupportRadius(actor, options) * 0.02);
        const adjustedPoint = {
            x: point.x + pushX + (pushX / depth) * nudge,
            y: point.y + pushY + (pushY / depth) * nudge
        };
        const localOptions = this.stairEndpointMouthProjectionOptions(stair, endpoint);
        const adjustedLocal = traversal.localPointForPathFrame(frame, adjustedPoint, localOptions);
        const clamped = this.clampStairLocalSide(frame, {
            ...adjustedLocal,
            upDown: endpoint === "lower" ? 0 : 1,
            projectionError: 0
        }, actor, options);
        const adjustedSupport = traversal.supportFromPathLocal(stair, frame, clamped);
        const remainingCollision = this.getActorStairFastPathBuildingBlockerCollision(
            Number(actor && actor.x),
            Number(actor && actor.y),
            adjustedSupport.point.x,
            adjustedSupport.point.y,
            adjustedSupport,
            actor,
            {
                ...options,
                requireClearStairSupportPoint: true
            }
        );
        return remainingCollision ? null : adjustedSupport;
    }

    getActorStairTopStepSideEntrySupport(stair, x, y, actor = null, options = {}) {
        if (!stair || !actor) return null;
        const traversal = this.requireStairTraversal();
        const frame = this.getStairTraversalFrame(stair);
        const range = this.getStairEndpointStepRange(stair, "higher");
        const localOptions = this.stairEndpointMouthProjectionOptions(stair, "higher");
        const previousLocal = traversal.localPointForPathFrame(frame, { x: actor.x, y: actor.y }, localOptions);
        const nextLocal = traversal.localPointForPathFrame(frame, { x, y }, localOptions);
        const previousUpDown = Number(previousLocal && previousLocal.upDown);
        const nextUpDown = Number(nextLocal && nextLocal.upDown);
        const nextLeftRight = Number(nextLocal && nextLocal.leftRight);
        if (!Number.isFinite(previousUpDown) || !Number.isFinite(nextUpDown) || !Number.isFinite(nextLeftRight)) return null;
        if (!(nextUpDown < previousUpDown - 0.000001)) return null;
        if (nextUpDown < range.min - 0.000001 || nextUpDown > range.max + 0.000001) return null;
        if (nextLeftRight < -0.000001 || nextLeftRight > 1.000001) return null;
        const clamped = this.clampStairLocalSide(frame, {
            ...nextLocal,
            upDown: Math.max(range.min, Math.min(range.max, nextUpDown)),
            projectionError: 0
        }, actor, options);
        return traversal.supportFromPathLocal(stair, frame, clamped);
    }

    stairEndpointProjectionOptions(stair, endpoint) {
        if (endpoint !== "lower" && endpoint !== "higher") return {};
        return endpoint === "lower"
            ? { upDownHint: 0 }
            : { upDownHint: 1 };
    }

    stairEndpointMouthProjectionOptions(stair, endpoint) {
        return this.requireStairTraversal().endpointMouthProjectionOptions(stair, endpoint);
    }

    getStairEndpointStepRange(stair, endpoint) {
        if (!stair || !endpoint) return null;
        const stepCount = Number.isFinite(Number(stair.stepCount))
            ? Math.max(1, Math.round(Number(stair.stepCount)))
            : 1;
        const stepSize = 1 / stepCount;
        if (endpoint === "lower") {
            return { min: 0, max: stepSize };
        }
        if (endpoint === "higher") {
            return { min: 1 - stepSize, max: 1 };
        }
        throw new Error(`unknown stair endpoint: ${endpoint}`);
    }

    getStairSideLimits(frame, upDown, actor = null, options = {}) {
        const traversal = this.requireStairTraversal();
        const left = traversal.pointFromPathLocal(frame, upDown, 0);
        const right = traversal.pointFromPathLocal(frame, upDown, 1);
        const crosslineLength = Math.hypot(Number(right.x) - Number(left.x), Number(right.y) - Number(left.y));
        if (!(crosslineLength > 1e-6)) {
            throw new Error(`stair ${frame && frame.stairId ? frame.stairId : "(unknown)"} has a degenerate movement crossline`);
        }
        const radius = this.getActorMovementSupportRadius(actor, options);
        const inset = Math.max(0, Number(radius) || 0) / crosslineLength;
        return {
            min: inset,
            max: 1 - inset
        };
    }

    clampStairLocalSide(frame, local, actor = null, options = {}) {
        if (!frame || !local || !Number.isFinite(Number(local.upDown)) || !Number.isFinite(Number(local.leftRight))) {
            throw new Error("stair side clamp requires finite local coordinates");
        }
        const limits = this.getStairSideLimits(frame, local.upDown, actor, options);
        if (limits.min > limits.max + 1e-6) {
            throw new Error(`stair ${frame && frame.stairId ? frame.stairId : "(unknown)"} is too narrow for actor movement`);
        }
        return {
            ...local,
            upDown: Number(local.upDown),
            leftRight: Math.max(limits.min, Math.min(limits.max, Number(local.leftRight))),
            projectionError: 0
        };
    }

    getActiveLayerForStairSupport(support) {
        if (!support || support.type !== "stair" || !support.stair) return null;
        const stair = support.stair;
        if (!Number.isFinite(stair.higherLevel) || !Number.isFinite(stair.lowerLevel)) {
            throw new Error(`stair runtime record ${stair.id || "(unknown)"} is missing endpoint levels`);
        }
        return Number(support.upDown) >= 1
            ? Math.round(Number(stair.higherLevel) || 0)
            : Math.round(Number(stair.lowerLevel) || 0);
    }

    getActiveBaseZForStairSupport(support) {
        if (!support || support.type !== "stair" || !support.stair) return null;
        const stair = support.stair;
        const activeLayer = this.getActiveLayerForStairSupport(support);
        return activeLayer === Math.round(Number(stair.higherLevel) || 0)
            ? Number(stair.higherZ)
            : Number(stair.lowerZ);
    }

    resolveActorMovementSupportAtWorldPosition(x, y, actor = null, options = {}) {
        const layer = this.getActorTraversalLayer(actor, options);
        return this.getFloorSupportAtWorldPosition(x, y, layer, options);
    }

    getActorFloorSupportForStairEntry(actor = null, worldX, worldY, layer = 0, options = {}) {
        const actorX = Number(actor && actor.x);
        const actorY = Number(actor && actor.y);
        let support = this.getFloorSupportAtWorldPosition(actorX, actorY, layer, options);
        if (support) return support;
        const radius = this.getActorMovementSupportRadius(actor, options);
        if (!(radius > 0) || !Number.isFinite(actorX) || !Number.isFinite(actorY) || !Number.isFinite(worldX) || !Number.isFinite(worldY)) {
            return null;
        }
        const dx = typeof this.shortestDeltaX === "function"
            ? this.shortestDeltaX(actorX, worldX)
            : (Number(worldX) - actorX);
        const dy = typeof this.shortestDeltaY === "function"
            ? this.shortestDeltaY(actorY, worldY)
            : (Number(worldY) - actorY);
        const distance = Math.hypot(dx, dy);
        if (!(distance > 1e-6)) return null;
        const sampleDistance = Math.min(radius, distance);
        const sampleX = actorX - (dx / distance) * sampleDistance;
        const sampleY = actorY - (dy / distance) * sampleDistance;
        support = this.getFloorSupportAtWorldPosition(sampleX, sampleY, layer, options);
        return support || null;
    }

    isFloorSupportConnectedToStair(floorSupport, stair) {
        if (!floorSupport || !stair) return false;
        return this.getStairEndpointForFloorSupport(floorSupport, stair) !== null;
    }

    getStairEndpointForFloorSupport(floorSupport, stair) {
        if (!floorSupport || !stair) return null;
        const floorFragmentId = typeof floorSupport.fragmentId === "string" ? floorSupport.fragmentId : "";
        const floorSurfaceId = typeof floorSupport.surfaceId === "string" ? floorSupport.surfaceId : "";
        const floorLayer = Number.isFinite(floorSupport.layer) ? Math.round(Number(floorSupport.layer)) : 0;
        const floorBaseZ = Number.isFinite(floorSupport.baseZ) ? Number(floorSupport.baseZ) : NaN;
        const lowerLayer = Number.isFinite(stair.lowerLevel) ? Math.round(Number(stair.lowerLevel)) : 0;
        const higherLayer = Number.isFinite(stair.higherLevel) ? Math.round(Number(stair.higherLevel)) : 0;
        const lowerBaseZ = Number(stair.lowerZ);
        const higherBaseZ = Number(stair.higherZ);
        const matchesLowerSurface = floorSurfaceId.length > 0 &&
            typeof stair.lowerSurfaceId === "string" &&
            stair.lowerSurfaceId.length > 0 &&
            floorSurfaceId === stair.lowerSurfaceId;
        const matchesHigherSurface = floorSurfaceId.length > 0 &&
            typeof stair.higherSurfaceId === "string" &&
            stair.higherSurfaceId.length > 0 &&
            floorSurfaceId === stair.higherSurfaceId;
        if (
            floorLayer === lowerLayer &&
            Number.isFinite(floorBaseZ) &&
            Number.isFinite(lowerBaseZ) &&
            Math.abs(floorBaseZ - lowerBaseZ) <= 1e-6 &&
            (floorFragmentId === stair.lowerFragmentId || matchesLowerSurface)
        ) {
            return "lower";
        }
        if (
            floorLayer === higherLayer &&
            Number.isFinite(floorBaseZ) &&
            Number.isFinite(higherBaseZ) &&
            Math.abs(floorBaseZ - higherBaseZ) <= 1e-6 &&
            (floorFragmentId === stair.higherFragmentId || matchesHigherSurface)
        ) {
            return "higher";
        }
        return null;
    }

    areActorMovementSupportsAdjacent(currentSupport, nextSupport) {
        if (!currentSupport || !nextSupport) return false;
        if (currentSupport.type === "floor" && nextSupport.type === "floor") {
            return currentSupport.layer === nextSupport.layer;
        }
        if (currentSupport.type === "stair" && nextSupport.type === "stair") {
            if (currentSupport.stairId !== nextSupport.stairId) return false;
            return true;
        }
        const stairSupport = currentSupport.type === "stair" ? currentSupport : nextSupport;
        const floorSupport = currentSupport.type === "floor" ? currentSupport : nextSupport;
        const stair = stairSupport && stairSupport.stair;
        if (!stair || !floorSupport) return false;
        const endpoint = this.getStairEndpointForFloorSupport(floorSupport, stair);
        if (Number(stairSupport.upDown) <= 1e-6 && endpoint === "lower") return true;
        if (Number(stairSupport.upDown) >= 1 - 1e-6 && endpoint === "higher") return true;
        return false;
    }

    didActorCrossStairEndpoint(stair, actor, worldX, worldY, endpoint) {
        if (!actor || !stair) return false;
        const traversal = this.requireStairTraversal();
        const frame = this.getStairTraversalFrame(stair);
        return traversal.endpointLineCrossed(frame, { x: actor.x, y: actor.y }, { x: worldX, y: worldY }, endpoint);
    }

    actorMovesIntoStairEndpoint(stair, actor, worldX, worldY, endpoint, options = {}) {
        if (!actor || !stair || !endpoint) return false;
        const traversal = this.requireStairTraversal();
        const frame = this.getStairTraversalFrame(stair);
        const entry = traversal.pathEndpointEntryState(frame, { x: actor.x, y: actor.y }, { x: worldX, y: worldY }, endpoint, {
            actorRadius: this.getActorMovementSupportRadius(actor, options),
            stair
        });
        return entry.enters === true;
    }

    actorApproachesStairEndpointMouth(stair, actor, worldX, worldY, endpoint, options = {}) {
        if (!actor || !stair || !endpoint) return false;
        const traversal = this.requireStairTraversal();
        const frame = this.getStairTraversalFrame(stair);
        const entry = traversal.pathEndpointEntryState(frame, { x: actor.x, y: actor.y }, { x: worldX, y: worldY }, endpoint, {
            actorRadius: this.getActorMovementSupportRadius(actor, options),
            stair
        });
        if (
            endpoint === "higher" &&
            entry.directionMatches === true &&
            entry.crossesEndpointWidth === true &&
            Number(entry.previousLocal && entry.previousLocal.upDown) >= 1 - 0.000001
        ) {
            return true;
        }
        return entry.enters !== true &&
            entry.directionMatches === true &&
            entry.footprintReachedEndpoint === true &&
            entry.crossesEndpointWidth === true;
    }

    actorMovesAwayFromStairEndpointMouth(stair, actor, worldX, worldY, endpoint, options = {}) {
        if (!actor || !stair || !endpoint) return false;
        const traversal = this.requireStairTraversal();
        const frame = this.getStairTraversalFrame(stair);
        const localOptions = this.stairEndpointMouthProjectionOptions(stair, endpoint);
        const previousLocal = traversal.localPointForPathFrame(frame, { x: actor.x, y: actor.y }, localOptions);
        const nextLocal = traversal.localPointForPathFrame(frame, { x: worldX, y: worldY }, localOptions);
        const previousUpDown = Number(previousLocal && previousLocal.upDown);
        const nextUpDown = Number(nextLocal && nextLocal.upDown);
        const nextLeftRight = Number(nextLocal && nextLocal.leftRight);
        if (!Number.isFinite(previousUpDown) || !Number.isFinite(nextUpDown) || !Number.isFinite(nextLeftRight)) return false;
        const radius = this.getActorMovementSupportRadius(actor, options);
        const mouthTolerance = Math.max(0.02, radius / Math.max(0.001, Number(frame.pathLength) || 0) + 0.000001);
        const movingAway = endpoint === "lower"
            ? nextUpDown < previousUpDown - 0.000001
            : endpoint === "higher"
                ? nextUpDown > previousUpDown + 0.000001
                : null;
        if (movingAway === null) throw new Error(`unknown stair endpoint: ${endpoint}`);
        if (!movingAway) return false;
        const nearEndpoint = endpoint === "lower"
            ? previousUpDown <= mouthTolerance
            : previousUpDown >= 1 - mouthTolerance;
        return nearEndpoint &&
            nextLeftRight >= -0.000001 &&
            nextLeftRight <= 1.000001;
    }

    resolveActorStairLocalMovement(currentStairSupport, worldX, worldY, actor = null, options = {}) {
        if (!currentStairSupport || !currentStairSupport.stair) {
            throw new Error("stair-local movement requires active stair support");
        }
        const stair = currentStairSupport.stair;
        const traversal = this.requireStairTraversal();
        const frame = this.getStairTraversalFrame(stair);
        const currentLocal = this.clampStairLocalSide(frame, currentStairSupport, actor, options);
        const dx = this.shortestDeltaX(Number(actor && actor.x), Number(worldX));
        const dy = this.shortestDeltaY(Number(actor && actor.y), Number(worldY));
        const distance = Math.hypot(dx, dy);
        let nextLocal = currentLocal;
        if (distance > 1e-9) {
            nextLocal = traversal.movePathLocal(frame, currentLocal, { x: dx / distance, y: dy / distance }, 1, distance);
            nextLocal = this.clampStairLocalSide(frame, nextLocal, actor, options);
        }
        if (nextLocal.upDown < 0 || nextLocal.upDown > 1) {
            const endpoint = nextLocal.upDown < 0 ? "lower" : "higher";
            const nextLayer = nextLocal.upDown < 0
                ? Math.round(Number(stair.lowerLevel) || 0)
                : Math.round(Number(stair.higherLevel) || 0);
            const exitPoint = traversal.exitPointFromPathLocal(frame, nextLocal);
            const floorSupport = this.getFloorSupportAtWorldPosition(exitPoint.x, exitPoint.y, nextLayer, options);
            if (floorSupport && this.getStairEndpointForFloorSupport(floorSupport, stair) === endpoint) {
                const nextSupport = {
                    ...floorSupport,
                    point: exitPoint
                };
                const buildingBlockerCollision = this.getActorStairFastPathBuildingBlockerCollision(
                    Number(actor && actor.x),
                    Number(actor && actor.y),
                    worldX,
                    worldY,
                    nextSupport,
                    actor,
                    options
                );
                if (buildingBlockerCollision) {
                    return {
                        handled: true,
                        allowed: false,
                        support: null,
                        currentSupport: currentStairSupport,
                        blockedByBuildingMovement: true,
                        buildingBlockerCollision
                    };
                }
                return {
                    handled: true,
                    allowed: true,
                    support: nextSupport,
                    currentSupport: currentStairSupport
                };
            }
            return { handled: true, allowed: false, support: null, currentSupport: currentStairSupport };
        }
        const nextSupport = traversal.supportFromPathLocal(stair, frame, nextLocal);
        const buildingBlockerCollision = this.getActorStairFastPathBuildingBlockerCollision(
            Number(actor && actor.x),
            Number(actor && actor.y),
            worldX,
            worldY,
            nextSupport,
            actor,
            options
        );
        if (buildingBlockerCollision) {
            return {
                handled: true,
                allowed: false,
                support: null,
                currentSupport: currentStairSupport,
                blockedByBuildingMovement: true,
                buildingBlockerCollision
            };
        }
        return {
            handled: true,
            allowed: true,
            support: nextSupport,
            currentSupport: currentStairSupport
        };
    }

    resolveActorStairMovementOccupancy(worldX, worldY, actor = null, options = {}) {
        const perfEnabled = typeof globalThis !== "undefined" &&
            globalThis.movementPerfBreakdownState &&
            globalThis.movementPerfBreakdownState.enabled === true &&
            typeof globalThis.recordMovementPerfSection === "function";
        const perfStartMs = perfEnabled ? performance.now() : 0;
        try {
            if (!(this.stairsById instanceof Map) || this.stairsById.size === 0) {
                return { handled: false, allowed: false, support: null };
            }
            const occupancyCache = options &&
                options._movementSupportCache &&
                options._movementSupportCache.stairOccupancyByKey instanceof Map
                ? options._movementSupportCache.stairOccupancyByKey
                : null;
            const currentLayerForCache = this.getActorTraversalLayer(actor, options);
            const currentSupportForCache = actor && actor.currentMovementSupport && typeof actor.currentMovementSupport === "object"
                ? actor.currentMovementSupport
                : null;
            const stairStateForCache = currentSupportForCache && currentSupportForCache.type === "stair"
                ? `${currentSupportForCache.stairId || ""}:${Number(currentSupportForCache.upDown)}:${Number(currentSupportForCache.leftRight)}`
                : "";
            const occupancyCacheKey = occupancyCache
                ? `${currentLayerForCache}:${Number(actor && actor.x)}:${Number(actor && actor.y)}:${Number(worldX)}:${Number(worldY)}:${stairStateForCache}`
                : "";
            if (occupancyCache && occupancyCache.has(occupancyCacheKey)) {
                return occupancyCache.get(occupancyCacheKey);
            }
            const cacheOccupancyResult = (value) => {
                if (occupancyCache) occupancyCache.set(occupancyCacheKey, value);
                return value;
            };
            const currentStairSupport = this.getActorStairSupportFromState(actor);
            const currentLayer = currentLayerForCache;
            const movementSupportCache = options &&
                options._movementSupportCache &&
                options._movementSupportCache.actor === actor
                ? options._movementSupportCache
                : null;
            const currentFloorSupport = currentStairSupport
                ? null
                : (
                    movementSupportCache &&
                    movementSupportCache.currentFloorSupport &&
                    movementSupportCache.currentFloorSupportLayer === currentLayer
                )
                    ? movementSupportCache.currentFloorSupport
                    : this.getActorFloorSupportForStairEntry(actor, worldX, worldY, currentLayer, options);
            const floorStairFootprintMovementResult = () => {
                const floorSupport = {
                    ...currentFloorSupport,
                    point: { x: Number(worldX), y: Number(worldY) }
                };
                const buildingBlockerCollision = this.getActorStairFastPathBuildingBlockerCollision(
                    Number(actor && actor.x),
                    Number(actor && actor.y),
                    worldX,
                    worldY,
                    floorSupport,
                    actor,
                    {
                        ...options,
                        requireClearStairSupportPoint: true
                    }
                );
                if (buildingBlockerCollision) {
                    return {
                        handled: true,
                        allowed: false,
                        support: null,
                        currentSupport: currentFloorSupport,
                        blockedByBuildingMovement: true,
                        buildingBlockerCollision
                    };
                }
                return {
                    handled: true,
                    allowed: true,
                    support: floorSupport,
                    currentSupport: currentFloorSupport
                };
            };
            if (currentStairSupport) {
                return cacheOccupancyResult(this.resolveActorStairLocalMovement(currentStairSupport, worldX, worldY, actor, options));
            }

            if (currentFloorSupport) {
                for (const stair of this.stairsById.values()) {
                    if (!stair) continue;
                    const endpoint = this.getStairEndpointForFloorSupport(currentFloorSupport, stair);
                    if (!endpoint) continue;
                    if (this.actorMovesIntoStairEndpoint(stair, actor, worldX, worldY, endpoint, options)) {
                        const entrySupport = this.getActorStairEndpointEntrySupport(stair, worldX, worldY, actor, {
                            ...options,
                            endpoint
                        });
                        if (entrySupport) {
                            const buildingBlockerCollision = this.getActorStairFastPathBuildingBlockerCollision(
                                Number(actor && actor.x),
                                Number(actor && actor.y),
                                worldX,
                                worldY,
                                entrySupport,
                                actor,
                                {
                                    ...options,
                                    requireClearStairSupportPoint: true
                                }
                            );
                            if (buildingBlockerCollision) {
                                const adjustedEntrySupport = this.slideStairEndpointEntrySupportPastBuildingBlocker(
                                    stair,
                                    endpoint,
                                    entrySupport,
                                    buildingBlockerCollision,
                                    actor,
                                    options
                                );
                                if (adjustedEntrySupport) {
                                    return cacheOccupancyResult({
                                        handled: true,
                                        allowed: true,
                                        support: adjustedEntrySupport,
                                        currentSupport: currentFloorSupport,
                                        slidByBuildingMovement: true,
                                        buildingBlockerCollision
                                    });
                                }
                                return cacheOccupancyResult({
                                    handled: true,
                                    allowed: false,
                                    support: null,
                                    currentSupport: currentFloorSupport,
                                    blockedByBuildingMovement: true,
                                    buildingBlockerCollision
                                });
                            }
                            return cacheOccupancyResult({ handled: true, allowed: true, support: entrySupport, currentSupport: currentFloorSupport });
                        }
                    }
                    if (endpoint === "higher") {
                        const topStepSideEntrySupport = this.getActorStairTopStepSideEntrySupport(stair, worldX, worldY, actor, options);
                        if (topStepSideEntrySupport) {
                            const buildingBlockerCollision = this.getActorStairFastPathBuildingBlockerCollision(
                                Number(actor && actor.x),
                                Number(actor && actor.y),
                                worldX,
                                worldY,
                                topStepSideEntrySupport,
                                actor,
                                {
                                    ...options,
                                    requireClearStairSupportPoint: true
                                }
                            );
                            if (buildingBlockerCollision) {
                                const adjustedEntrySupport = this.slideStairEndpointEntrySupportPastBuildingBlocker(
                                    stair,
                                    "higher",
                                    topStepSideEntrySupport,
                                    buildingBlockerCollision,
                                    actor,
                                    options
                                );
                                if (adjustedEntrySupport) {
                                    return cacheOccupancyResult({
                                        handled: true,
                                        allowed: true,
                                        support: adjustedEntrySupport,
                                        currentSupport: currentFloorSupport,
                                        slidByBuildingMovement: true,
                                        buildingBlockerCollision
                                    });
                                }
                                return cacheOccupancyResult({
                                    handled: true,
                                    allowed: false,
                                    support: null,
                                    currentSupport: currentFloorSupport,
                                    blockedByBuildingMovement: true,
                                    buildingBlockerCollision
                                });
                            }
                            return cacheOccupancyResult({ handled: true, allowed: true, support: topStepSideEntrySupport, currentSupport: currentFloorSupport });
                        }
                    }
                    if (
                        endpoint === "higher" &&
                        this.actorFootprintOverlapsStairFloorBlocker(stair, currentFloorSupport, worldX, worldY, actor, options) &&
                        !this.actorApproachesStairEndpointMouth(stair, actor, worldX, worldY, endpoint, options)
                    ) {
                        return cacheOccupancyResult({ handled: true, allowed: false, support: null, currentSupport: currentFloorSupport, slideAlongStairFootprint: true });
                    }
                    if (
                        endpoint === "higher" &&
                        this.actorApproachesStairEndpointMouth(stair, actor, worldX, worldY, endpoint, options) &&
                        !this.getFloorSupportAtWorldPosition(worldX, worldY, currentLayer, options)
                    ) {
                        const entrySupport = this.getActorStairEndpointEntrySupport(stair, worldX, worldY, actor, {
                            ...options,
                            endpoint
                        });
                        if (entrySupport) {
                            const buildingBlockerCollision = this.getActorStairFastPathBuildingBlockerCollision(
                                Number(actor && actor.x),
                                Number(actor && actor.y),
                                worldX,
                                worldY,
                                entrySupport,
                                actor,
                                {
                                    ...options,
                                    requireClearStairSupportPoint: true
                                }
                            );
                            if (buildingBlockerCollision) {
                                const adjustedEntrySupport = this.slideStairEndpointEntrySupportPastBuildingBlocker(
                                    stair,
                                    endpoint,
                                    entrySupport,
                                    buildingBlockerCollision,
                                    actor,
                                    options
                                );
                                if (adjustedEntrySupport) {
                                    return cacheOccupancyResult({
                                        handled: true,
                                        allowed: true,
                                        support: adjustedEntrySupport,
                                        currentSupport: currentFloorSupport,
                                        slidByBuildingMovement: true,
                                        buildingBlockerCollision
                                    });
                                }
                                return cacheOccupancyResult({
                                    handled: true,
                                    allowed: false,
                                    support: null,
                                    currentSupport: currentFloorSupport,
                                    blockedByBuildingMovement: true,
                                    buildingBlockerCollision
                                });
                            }
                            return cacheOccupancyResult({ handled: true, allowed: true, support: entrySupport, currentSupport: currentFloorSupport });
                        }
                    }
                }
            }

            if (!this.actorUsesLocalMovementZ(actor) && !this.actorAppearsOnFloorSupport(actor, currentFloorSupport)) {
                const reacquiredStairSupport = this.getActorStairSupportAtWorldPosition(
                    Number(actor && actor.x),
                    Number(actor && actor.y),
                    actor,
                    options
                );
                if (reacquiredStairSupport) {
                    return cacheOccupancyResult(this.resolveActorStairLocalMovement(reacquiredStairSupport, worldX, worldY, actor, options));
                }
            }

            if (currentFloorSupport) {
                for (const stair of this.stairsById.values()) {
                    if (!stair) continue;
                    const endpoint = this.getStairEndpointForFloorSupport(currentFloorSupport, stair);
                    if (!endpoint) continue;
                    if (!this.actorFootprintOverlapsStairFloorBlocker(stair, currentFloorSupport, worldX, worldY, actor, options)) continue;
                    if (this.actorMovesAwayFromStairEndpointMouth(stair, actor, worldX, worldY, endpoint, options)) {
                        return cacheOccupancyResult(floorStairFootprintMovementResult());
                    }
                    if (this.actorApproachesStairEndpointMouth(stair, actor, worldX, worldY, endpoint, options)) {
                        return cacheOccupancyResult(floorStairFootprintMovementResult());
                    }
                    return cacheOccupancyResult({ handled: true, allowed: false, support: null, currentSupport: currentFloorSupport, slideAlongStairFootprint: true });
                }
            }

            if (currentFloorSupport) {
                for (const stair of this.stairsById.values()) {
                    if (!stair) continue;
                    const endpoint = this.getStairEndpointForFloorSupport(currentFloorSupport, stair);
                    if (!endpoint) continue;
                    if (!this.didActorCrossStairEndpoint(stair, actor, worldX, worldY, endpoint)) continue;
                    if (this.actorFootprintOverlapsStairFloorBlocker(stair, currentFloorSupport, worldX, worldY, actor, options)) {
                        return cacheOccupancyResult({ handled: true, allowed: false, support: null, currentSupport: currentFloorSupport, slideAlongStairFootprint: true });
                    }
                }
            }

            return cacheOccupancyResult({ handled: false, allowed: false, support: null, currentSupport: currentFloorSupport });
        } finally {
            if (perfEnabled) globalThis.recordMovementPerfSection("map.resolveActorStairMovementOccupancy", performance.now() - perfStartMs);
        }
    }

    applyActorResolvedMovementSupport(actor, worldX, worldY, options = {}) {
        if (!actor) return null;
        let support = actor._pendingVectorMovementSupport || null;
        let resolvedPositionSupport = null;
        actor._pendingVectorMovementSupport = null;
        if (!support) {
            const movementSupportCache = options &&
                options._movementSupportCache &&
                options._movementSupportCache.actor === actor
                ? options._movementSupportCache
                : null;
            const lastChecked = movementSupportCache && movementSupportCache.lastCheckedOccupancy;
            const occupancy = (
                lastChecked &&
                Number(lastChecked.x) === Number(worldX) &&
                Number(lastChecked.y) === Number(worldY)
            )
                ? lastChecked.result
                : this.resolveActorStairMovementOccupancy(worldX, worldY, actor, options);
            if (occupancy && occupancy.handled === true && occupancy.allowed === true) {
                support = occupancy.support || null;
            }
            if (
                !support &&
                occupancy &&
                occupancy.handled === false &&
                occupancy.currentSupport &&
                occupancy.currentSupport.type === "floor" &&
                occupancy.currentSupport.fragment &&
                typeof this.isPointSupportedByFloorFragment === "function" &&
                this.isPointSupportedByFloorFragment(occupancy.currentSupport.fragment, worldX, worldY)
            ) {
                resolvedPositionSupport = this.resolveActorMovementSupportAtWorldPosition(worldX, worldY, actor, options);
                support = resolvedPositionSupport || occupancy.currentSupport;
            }
        }
        if (!support) {
            support = resolvedPositionSupport || this.resolveActorMovementSupportAtWorldPosition(worldX, worldY, actor, options);
        }
        if (!support) return null;
        this.setActorCurrentMovementSupport(actor, support, options);
        return support;
    }

    getFloorNodeBySurface(surfaceId, x, y) {
        if (!(this.floorFragmentsBySurfaceId instanceof Map) || !(this.floorNodeIndex instanceof Map)) return null;
        if (typeof surfaceId !== "string" || surfaceId.length === 0) return null;
        const fragmentIds = this.floorFragmentsBySurfaceId.get(surfaceId);
        if (!(fragmentIds instanceof Set) || fragmentIds.size === 0) return null;
        for (const fragmentId of fragmentIds) {
            const nodeKey = this.getFloorNodeKey(x, y, surfaceId, fragmentId);
            const floorNode = this.floorNodeIndex.get(nodeKey) || null;
            if (floorNode) return floorNode;
        }
        return null;
    }

    getFloorNodeAtLayer(x, y, layer = 0, options = {}) {
        const targetLayer = Number.isFinite(layer) ? Math.round(Number(layer)) : 0;
        const xi = Number(x);
        const yi = Number(y);
        if (!Number.isFinite(xi) || !Number.isFinite(yi)) return null;
        if (targetLayer === 0) {
            const baseNode = this.getNode(xi, yi, 0);
            if (baseNode) return baseNode;
        }
        this._ensureFloorNodeLayerIndex();
        if (!(this.floorNodesById instanceof Map)) return null;
        const sectionKey = (options && typeof options.sectionKey === "string") ? options.sectionKey : "";
        const surfaceId = (options && typeof options.surfaceId === "string") ? options.surfaceId : "";
        const fragmentId = (options && typeof options.fragmentId === "string") ? options.fragmentId : "";
        const allowScan = !options || options.allowScan !== false;
        const explicitGroundNode = options && options.groundNode &&
            Number(options.groundNode.xindex) === xi &&
            Number(options.groundNode.yindex) === yi
            ? options.groundNode
            : null;

        if (surfaceId || fragmentId) {
            const directFragmentIds = fragmentId
                ? [fragmentId]
                : (this.floorFragmentsBySurfaceId instanceof Map && this.floorFragmentsBySurfaceId.get(surfaceId) instanceof Set
                    ? Array.from(this.floorFragmentsBySurfaceId.get(surfaceId))
                    : []);
            for (let i = 0; i < directFragmentIds.length; i++) {
                const directFragmentId = directFragmentIds[i];
                const directSurfaceId = surfaceId || (
                    this.floorsById instanceof Map && this.floorsById.get(directFragmentId)
                        ? this.floorsById.get(directFragmentId).surfaceId
                        : ""
                );
                if (!directSurfaceId) continue;
                const directNode = this.floorNodeIndex instanceof Map
                    ? this.floorNodeIndex.get(this.getFloorNodeKey(xi, yi, directSurfaceId, directFragmentId))
                    : null;
                if (directNode) return directNode;
            }
        }

        const layerCandidates = this.floorNodeLayerIndex instanceof Map
            ? (this.floorNodeLayerIndex.get(this.getFloorLayerNodeKey(xi, yi, targetLayer)) || [])
            : [];
        if (layerCandidates.length > 0) {
            let fallback = null;
            for (let i = 0; i < layerCandidates.length; i++) {
                const candidate = layerCandidates[i];
                if (!candidate) continue;
                if (surfaceId && candidate.surfaceId !== surfaceId) continue;
                if (fragmentId && candidate.fragmentId !== fragmentId) continue;
                if (sectionKey && (
                    candidate.ownerSectionKey === sectionKey ||
                    candidate._prototypeSectionKey === sectionKey ||
                    (typeof this.getNodeSectionKey === "function" && this.getNodeSectionKey(candidate) === sectionKey)
                )) {
                    return candidate;
                }
                if (!fallback) fallback = candidate;
            }
            if (fallback) return fallback;
        }

        if (!allowScan) return null;

        let fallback = null;
        for (const nodes of this.floorNodesById.values()) {
            if (!Array.isArray(nodes)) continue;
            for (let i = 0; i < nodes.length; i++) {
                const candidate = nodes[i];
                if (!candidate) continue;
                if (Number(candidate.xindex) !== xi || Number(candidate.yindex) !== yi) continue;
                const candidateLayer = Number.isFinite(candidate.traversalLayer)
                    ? Math.round(Number(candidate.traversalLayer))
                    : (Number.isFinite(candidate.level) ? Math.round(Number(candidate.level)) : 0);
                if (candidateLayer !== targetLayer) continue;
                if (sectionKey && (
                    candidate.ownerSectionKey === sectionKey ||
                    candidate._prototypeSectionKey === sectionKey ||
                    (typeof this.getNodeSectionKey === "function" && this.getNodeSectionKey(candidate) === sectionKey)
                )) {
                    return candidate;
                }
                if (!fallback) fallback = candidate;
            }
        }
        if (!fallback && fragmentId && this.floorsById instanceof Map) {
            const fragment = this.floorsById.get(fragmentId) || null;
            const fragmentLayer = Number.isFinite(fragment && fragment.level)
                ? Math.round(Number(fragment.level))
                : 0;
            if (fragment && fragmentLayer === targetLayer) {
                const groundNode = explicitGroundNode || this.getGroundNodeForCoord(xi, yi);
                const supportX = Number.isFinite(options && options.worldX)
                    ? Number(options.worldX)
                    : (Number.isFinite(groundNode && groundNode.x) ? Number(groundNode.x) : NaN);
                const supportY = Number.isFinite(options && options.worldY)
                    ? Number(options.worldY)
                    : (Number.isFinite(groundNode && groundNode.y) ? Number(groundNode.y) : NaN);
                if (
                    groundNode &&
                    Number.isFinite(supportX) &&
                    Number.isFinite(supportY) &&
                    this.isPointSupportedByFloorFragment(fragment, supportX, supportY)
                ) {
                    if (!Number.isFinite(fragment.nodeBaseZ)) {
                        throw new Error(`floor fragment ${fragment.fragmentId || fragment.id || "(unknown)"} requires finite nodeBaseZ`);
                    }
                    const created = this.createFloorNodeFromSource(groundNode, fragment, {
                        baseZ: Number(fragment.nodeBaseZ),
                        traversalLayer: targetLayer
                    });
                    if (created) {
                        this._connectFloorNodesIncremental([created], new Set([created.id]));
                        return created;
                    }
                }
            }
        }
        return fallback;
    }

    connectFloorNodeNeighbors() {
        if (!(this.floorNodesById instanceof Map)) return 0;
        let connectionCount = 0;
        const wrapIndex = (value, size) => {
            if (!Number.isFinite(value) || !Number.isFinite(size) || size <= 0) return value;
            let wrapped = Number(value) % Number(size);
            if (wrapped < 0) wrapped += Number(size);
            return wrapped;
        };

        for (const floorNodes of this.floorNodesById.values()) {
            if (!Array.isArray(floorNodes) || floorNodes.length === 0) continue;
            for (let i = 0; i < floorNodes.length; i++) {
                const floorNode = floorNodes[i];
                if (!floorNode || !Array.isArray(floorNode.neighborOffsets) || !Array.isArray(floorNode.neighbors)) continue;
                for (let directionIndex = 0; directionIndex < floorNode.neighborOffsets.length; directionIndex++) {
                    const offset = floorNode.neighborOffsets[directionIndex];
                    if (!offset) continue;

                    let neighborX = Number(floorNode.xindex) + Number(offset.x);
                    let neighborY = Number(floorNode.yindex) + Number(offset.y);

                    if (this.wrapX === true && Number.isFinite(this.width) && this.width > 0) {
                        neighborX = wrapIndex(neighborX, this.width);
                    }
                    if (this.wrapY === true && Number.isFinite(this.height) && this.height > 0) {
                        neighborY = wrapIndex(neighborY, this.height);
                    }

                    const neighborNode = this.getFloorNodeBySurface(
                        floorNode.surfaceId,
                        neighborX,
                        neighborY
                    );
                    if (!neighborNode) continue;
                    floorNode.neighbors[directionIndex] = neighborNode;
                    connectionCount += 1;
                }
            }
        }

        return connectionCount;
    }

    _connectFloorNodesIncremental(newFloorNodes, newNodeIdSet) {
        if (!Array.isArray(newFloorNodes) || newFloorNodes.length === 0) return;
        const wrapX = this.wrapX === true && Number.isFinite(this.width) && this.width > 0;
        const wrapY = this.wrapY === true && Number.isFinite(this.height) && this.height > 0;
        const mapWidth = wrapX ? this.width : 0;
        const mapHeight = wrapY ? this.height : 0;
        const nodeIndex = this.floorNodeIndex;
        for (let i = 0; i < newFloorNodes.length; i++) {
            const floorNode = newFloorNodes[i];
            if (!floorNode || !Array.isArray(floorNode.neighborOffsets) || !Array.isArray(floorNode.neighbors)) continue;
            const surfaceId = floorNode.surfaceId;
            const fragmentId = floorNode.fragmentId;
            const nx0 = floorNode.xindex;
            const ny0 = floorNode.yindex;
            for (let d = 0; d < floorNode.neighborOffsets.length; d++) {
                const offset = floorNode.neighborOffsets[d];
                if (!offset) continue;
                let nx = nx0 + offset.x;
                let ny = ny0 + offset.y;
                if (wrapX) { nx = nx % mapWidth; if (nx < 0) nx += mapWidth; }
                if (wrapY) { ny = ny % mapHeight; if (ny < 0) ny += mapHeight; }
                // Fast path: try same fragment first (common case)
                let neighborNode = nodeIndex.get(`${nx},${ny},${surfaceId},${fragmentId}`) || null;
                // Slow path: scan other fragments on same surface
                if (!neighborNode) neighborNode = this.getFloorNodeBySurface(surfaceId, nx, ny);
                if (!neighborNode) continue;
                floorNode.neighbors[d] = neighborNode;
                // Skip back-link if neighbor is also new (its own forward pass will link back to us)
                if (newNodeIdSet && newNodeIdSet.has(neighborNode.id)) continue;
                if (Array.isArray(neighborNode.neighborOffsets) && Array.isArray(neighborNode.neighbors)) {
                    for (let rd = 0; rd < neighborNode.neighborOffsets.length; rd++) {
                        const reverseOffset = neighborNode.neighborOffsets[rd];
                        if (!reverseOffset) continue;
                        if (
                            (neighborNode.xindex + reverseOffset.x) === nx0 &&
                            (neighborNode.yindex + reverseOffset.y) === ny0
                        ) {
                            neighborNode.neighbors[rd] = floorNode;
                            break;
                        }
                    }
                }
            }
        }
    }

    // Prepare fragment registration for a section without creating any floor nodes.
    // Returns the array of registered fragments (including synthesized ground), or null if already registered.
    prepareFloorSectionFragments(sectionKey, sectionState, options = {}) {
        if (typeof sectionKey !== "string" || sectionKey.length === 0) return null;
        if (!sectionState || !(sectionState.sectionAssetsByKey instanceof Map)) return null;
        if (this.floorFragmentsBySectionKey instanceof Map && this.floorFragmentsBySectionKey.has(sectionKey)) return null;
        const asset = sectionState.sectionAssetsByKey.get(sectionKey);
        if (!asset) return null;
        const synthesizeGroundFragment = (typeof options.synthesizeGroundFragment === "function")
            ? options.synthesizeGroundFragment : null;
        const authoredFragments = Array.isArray(asset.floors) ? asset.floors.slice() : [];
        const hasGroundFragment = authoredFragments.some((f) => Number(f && f.level) === 0);
        if (!hasGroundFragment && synthesizeGroundFragment) {
            const synthesized = synthesizeGroundFragment(asset);
            if (synthesized) authoredFragments.unshift(synthesized);
        }
        const registeredFragments = [];
        for (let i = 0; i < authoredFragments.length; i++) {
            const registeredFragment = this.registerFloorFragment(authoredFragments[i]);
            if (!registeredFragment) continue;
            registeredFragments.push(registeredFragment);
        }
        // Store pending batch state under a staging key
        if (!(this._pendingFloorSectionNodes instanceof Map)) this._pendingFloorSectionNodes = new Map();
        this._pendingFloorSectionNodes.set(sectionKey, { fragments: registeredFragments, nodes: [] });
        return registeredFragments;
    }

    // Add a batch of nodes (sourceNodes[start..start+count]) for a section that was prepared via prepareFloorSectionFragments.
    // Returns the number of floor nodes created in this batch.
    addFloorSectionNodeBatch(sectionKey, sectionState, sourceNodes, start, count, doesNodeBelongToFragment) {
        if (!(this._pendingFloorSectionNodes instanceof Map)) return 0;
        const pending = this._pendingFloorSectionNodes.get(sectionKey);
        if (!pending) return 0;
        const { fragments, nodes: pendingNodes } = pending;
        const end = Math.min(start + count, sourceNodes.length);
        const checkBelongs = (typeof doesNodeBelongToFragment === "function") ? doesNodeBelongToFragment : null;
        let created = 0;
        for (let n = start; n < end; n++) {
            const sourceNode = sourceNodes[n];
            for (let fi = 0; fi < fragments.length; fi++) {
                const registeredFragment = fragments[fi];
                // Skip level-0 floor nodes — getFloorNodeAtLayer(x, y, 0) returns getNode() directly,
                // so level-0 floor nodes are never looked up via the floor node index.
                if (Number(registeredFragment.level) === 0) continue;
                if (checkBelongs && !checkBelongs(sourceNode, registeredFragment)) continue;
                const floorNode = this.createFloorNodeFromSource(sourceNode, registeredFragment, {
                    baseZ: Number.isFinite(registeredFragment.nodeBaseZ) ? Number(registeredFragment.nodeBaseZ) : 0,
                    traversalLayer: Number.isFinite(registeredFragment.level) ? Number(registeredFragment.level) : 0
                });
                if (!floorNode) continue;
                if (this._isFloorNodeAtFragmentBoundary(sourceNode, registeredFragment)) {
                    floorNode.clearance = -1;
                }
                pendingNodes.push(floorNode);
                created += 1;
            }
        }
        return created;
    }

    // Finalize: connect all pending nodes for the section and clear staging state.
    // Returns total floor node count for the section.
    // Step 1 of chunked connection: build the newNodeIdSet and store it. Returns node count.
    prepareFloorSectionConnection(sectionKey) {
        if (!(this._pendingFloorSectionNodes instanceof Map)) return 0;
        const pending = this._pendingFloorSectionNodes.get(sectionKey);
        if (!pending) return 0;
        const { nodes } = pending;
        const newNodeIdSet = new Set();
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i] && nodes[i].id) newNodeIdSet.add(nodes[i].id);
        }
        pending.newNodeIdSet = newNodeIdSet;
        return nodes.length;
    }

    // Step 2: connect nodes[start..start+count] using the pre-built newNodeIdSet.
    connectFloorSectionNodeBatch(sectionKey, start, count) {
        if (!(this._pendingFloorSectionNodes instanceof Map)) return 0;
        const pending = this._pendingFloorSectionNodes.get(sectionKey);
        if (!pending) return 0;
        const { nodes, newNodeIdSet } = pending;
        const end = Math.min(start + count, nodes.length);
        const batch = nodes.slice(start, end);
        this._connectFloorNodesIncremental(batch, newNodeIdSet);
        return batch.length;
    }

    // Step 3: clean up pending state after all connection batches are done.
    commitFloorSectionConnection(sectionKey) {
        if (!(this._pendingFloorSectionNodes instanceof Map)) return;
        this._pendingFloorSectionNodes.delete(sectionKey);
    }

    // Monolithic finalize (used by initial load and registerFloorSection fallback).
    finalizeFloorSectionNodes(sectionKey) {
        if (!(this._pendingFloorSectionNodes instanceof Map)) return 0;
        const pending = this._pendingFloorSectionNodes.get(sectionKey);
        if (!pending) return 0;
        const { nodes } = pending;
        const newNodeIdSet = new Set();
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i] && nodes[i].id) newNodeIdSet.add(nodes[i].id);
        }
        this._connectFloorNodesIncremental(nodes, newNodeIdSet);
        this._pendingFloorSectionNodes.delete(sectionKey);
        return nodes.length;
    }

    removeObjectsForDeletedFloorFragments(fragmentIds) {
        const ids = fragmentIds instanceof Set
            ? fragmentIds
            : new Set(Array.isArray(fragmentIds) ? fragmentIds.filter(id => typeof id === "string" && id.length > 0) : []);
        if (ids.size === 0) return { runtimeObjects: 0, savedRecords: 0 };

        const runtimeObjects = new Set();
        const addRuntimeObject = (obj) => {
            if (!obj || obj.gone) return;
            const fragmentId = typeof obj.fragmentId === "string" && obj.fragmentId.length > 0
                ? obj.fragmentId
                : (typeof obj.node?.fragmentId === "string" ? obj.node.fragmentId : "");
            const manifestFragmentId = typeof obj._floorBuildingManifestFragmentId === "string"
                ? obj._floorBuildingManifestFragmentId
                : "";
            if ((fragmentId && ids.has(fragmentId)) || (manifestFragmentId && ids.has(manifestFragmentId))) {
                runtimeObjects.add(obj);
            }
        };

        if (this.floorNodesById instanceof Map) {
            ids.forEach((fragmentId) => {
                const nodes = this.floorNodesById.get(fragmentId) || [];
                if (!Array.isArray(nodes)) return;
                for (let i = 0; i < nodes.length; i++) {
                    const node = nodes[i];
                    if (!node) continue;
                    const objects = Array.isArray(node.objects) ? node.objects : [];
                    for (let j = 0; j < objects.length; j++) addRuntimeObject(objects[j]);
                    const visibilityObjects = Array.isArray(node.visibilityObjects) ? node.visibilityObjects : [];
                    for (let j = 0; j < visibilityObjects.length; j++) addRuntimeObject(visibilityObjects[j]);
                }
            });
        }
        if (Array.isArray(this.objects)) {
            for (let i = 0; i < this.objects.length; i++) addRuntimeObject(this.objects[i]);
        }
        const objectState = this._prototypeObjectState || null;
        if (objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map) {
            for (const runtimeObj of objectState.activeRuntimeObjectsByRecordId.values()) addRuntimeObject(runtimeObj);
        }

        runtimeObjects.forEach((obj) => {
            if (!obj || obj.gone) return;
            if (typeof obj.removeFromGame === "function") {
                obj.removeFromGame();
            } else if (typeof obj.remove === "function") {
                obj.remove();
            } else if (typeof obj.delete === "function") {
                obj.delete();
            } else {
                obj.gone = true;
            }
        });

        let savedRecords = 0;
        const sectionState = this._prototypeSectionState || null;
        if (sectionState && sectionState.sectionAssetsByKey instanceof Map) {
            for (const asset of sectionState.sectionAssetsByKey.values()) {
                const records = Array.isArray(asset && asset.objects) ? asset.objects : null;
                if (!records || records.length === 0) continue;
                const nextRecords = records.filter((record) => {
                    const fragmentId = typeof record?.fragmentId === "string" ? record.fragmentId : "";
                    if (!fragmentId || !ids.has(fragmentId)) return true;
                    savedRecords += 1;
                    return false;
                });
                if (nextRecords.length === records.length) continue;
                asset.objects = nextRecords;
                asset._prototypeNamedObjectRecordIdByName = null;
                asset._prototypeNamedObjectConflictRecordIdsByName = null;
                asset._prototypeClearanceDirty = true;
            }
        }

        if (objectState && savedRecords > 0) {
            objectState.captureScanNeeded = true;
        }
        if ((runtimeObjects.size > 0 || savedRecords > 0) && typeof this.markBuildingRenderCacheDirty === "function") {
            this.markBuildingRenderCacheDirty();
        }
        return { runtimeObjects: runtimeObjects.size, savedRecords };
    }

    unregisterFloorFragments(fragmentIds, options = {}) {
        const ids = fragmentIds instanceof Set
            ? Array.from(fragmentIds)
            : (Array.isArray(fragmentIds) ? fragmentIds.slice() : []);
        if (ids.length === 0) return 0;
        if (options && options.removeAttachedObjects === true) {
            this.removeObjectsForDeletedFloorFragments(ids);
        }
        let removedCount = 0;
        for (let idIndex = 0; idIndex < ids.length; idIndex++) {
            const fragmentId = ids[idIndex];
            if (typeof fragmentId !== "string" || fragmentId.length === 0) continue;
            const floorNodes = (this.floorNodesById instanceof Map)
                ? (this.floorNodesById.get(fragmentId) || []) : [];
            for (let i = 0; i < floorNodes.length; i++) {
                const floorNode = floorNodes[i];
                if (!floorNode) continue;
                this._unindexFloorNodeByLayer(floorNode);
                if (this.floorNodeIndex instanceof Map) {
                    this.floorNodeIndex.delete(floorNode.id);
                }
                if (Array.isArray(floorNode.neighbors)) {
                    for (let d = 0; d < floorNode.neighbors.length; d++) {
                        const neighbor = floorNode.neighbors[d];
                        if (!neighbor || !Array.isArray(neighbor.neighbors)) continue;
                        for (let rd = 0; rd < neighbor.neighbors.length; rd++) {
                            if (neighbor.neighbors[rd] === floorNode) {
                                neighbor.neighbors[rd] = null;
                            }
                        }
                    }
                }
                removedCount += 1;
            }
            if (this.floorsById instanceof Map) {
                const frag = this.floorsById.get(fragmentId);
                if (frag && this.floorFragmentsBySurfaceId instanceof Map) {
                    const surfaceSet = this.floorFragmentsBySurfaceId.get(frag.surfaceId);
                    if (surfaceSet instanceof Set) {
                        surfaceSet.delete(fragmentId);
                        if (surfaceSet.size === 0) this.floorFragmentsBySurfaceId.delete(frag.surfaceId);
                    }
                }
                if (frag && this.floorFragmentsBySectionKey instanceof Map) {
                    const sectionSet = this.floorFragmentsBySectionKey.get(frag.ownerSectionKey);
                    if (sectionSet instanceof Set) {
                        sectionSet.delete(fragmentId);
                        if (sectionSet.size === 0) this.floorFragmentsBySectionKey.delete(frag.ownerSectionKey);
                    }
                }
                this.floorsById.delete(fragmentId);
                this.markFloorFragmentLayerIndexDirty();
            }
            if (this.floorNodesById instanceof Map) this.floorNodesById.delete(fragmentId);
        }
        if (removedCount > 0 || ids.length > 0) {
            this.markFloorObjectNodeCacheDirty();
            this.markFloorBuildingsDirty();
        }
        return removedCount;
    }

    registerFloorFragmentsForSection(sectionKey, sectionState, fragmentRecords, options = {}) {
        if (typeof sectionKey !== "string" || sectionKey.length === 0) return { fragmentCount: 0, nodeCount: 0 };
        if (!sectionState || !(sectionState.sectionAssetsByKey instanceof Map)) return { fragmentCount: 0, nodeCount: 0 };
        if (!Array.isArray(fragmentRecords) || fragmentRecords.length === 0) return { fragmentCount: 0, nodeCount: 0 };
        const sectionNodes = (sectionState.nodesBySectionKey instanceof Map)
            ? (sectionState.nodesBySectionKey.get(sectionKey) || []) : [];
        const nodesByCoordKey = (sectionState.allNodesByCoordKey instanceof Map)
            ? sectionState.allNodesByCoordKey : null;
        const doesNodeBelongToFragment = (typeof options.doesNodeBelongToFragment === "function")
            ? options.doesNodeBelongToFragment : null;
        const newNodes = [];
        let fragmentCount = 0;
        let nodeCount = 0;

        const getSourceNode = (tileKey) => {
            if (nodesByCoordKey && nodesByCoordKey.has(tileKey)) return nodesByCoordKey.get(tileKey);
            const [xRaw, yRaw] = String(tileKey || "").split(",");
            const x = Number(xRaw);
            const y = Number(yRaw);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            if (typeof this.getNodeByIndex === "function") return this.getNodeByIndex(x, y);
            for (let i = 0; i < sectionNodes.length; i++) {
                const node = sectionNodes[i];
                if (node && Number(node.xindex) === x && Number(node.yindex) === y) return node;
            }
            return null;
        };

        for (let i = 0; i < fragmentRecords.length; i++) {
            const registeredFragment = this.registerFloorFragment(fragmentRecords[i]);
            if (!registeredFragment) continue;
            fragmentCount += 1;
            const materializedNodeKeys = [];
            const tileCoordKeys = Array.isArray(registeredFragment.tileCoordKeys)
                ? registeredFragment.tileCoordKeys : [];
            if (tileCoordKeys.length > 0) {
                for (let t = 0; t < tileCoordKeys.length; t++) {
                    const sourceNode = getSourceNode(tileCoordKeys[t]);
                    if (!sourceNode) continue;
                    const floorNode = this.createFloorNodeFromSource(sourceNode, registeredFragment, {
                        baseZ: Number.isFinite(registeredFragment.nodeBaseZ) ? Number(registeredFragment.nodeBaseZ) : 0,
                        traversalLayer: Number.isFinite(registeredFragment.level) ? Number(registeredFragment.level) : 0
                    });
                    if (!floorNode) continue;
                    newNodes.push(floorNode);
                    nodeCount += 1;
                    materializedNodeKeys.push(`${floorNode.xindex},${floorNode.yindex}`);
                }
            } else if (doesNodeBelongToFragment) {
                for (let n = 0; n < sectionNodes.length; n++) {
                    const sourceNode = sectionNodes[n];
                    if (!doesNodeBelongToFragment(sourceNode, registeredFragment)) continue;
                    const floorNode = this.createFloorNodeFromSource(sourceNode, registeredFragment, {
                        baseZ: Number.isFinite(registeredFragment.nodeBaseZ) ? Number(registeredFragment.nodeBaseZ) : 0,
                        traversalLayer: Number.isFinite(registeredFragment.level) ? Number(registeredFragment.level) : 0
                    });
                    if (!floorNode) continue;
                    newNodes.push(floorNode);
                    nodeCount += 1;
                    materializedNodeKeys.push(`${floorNode.xindex},${floorNode.yindex}`);
                }
            }
            registeredFragment.materializedNodeKeys = materializedNodeKeys;
        }

        const newNodeIdSet = new Set();
        for (let i = 0; i < newNodes.length; i++) {
            if (newNodes[i] && newNodes[i].id) newNodeIdSet.add(newNodes[i].id);
        }
        this._connectFloorNodesIncremental(newNodes, newNodeIdSet);
        if (fragmentCount > 0 || nodeCount > 0) this.markFloorBuildingsDirty();
        return { fragmentCount, nodeCount };
    }

    // Collect all floor nodes for a section into staging for chunked removal. Returns node count.
    prepareFloorSectionUnregister(sectionKey) {
        if (!(this.floorFragmentsBySectionKey instanceof Map)) return 0;
        const fragmentIds = this.floorFragmentsBySectionKey.get(sectionKey);
        if (!fragmentIds || fragmentIds.size === 0) return 0;
        const allNodes = [];
        for (const fragmentId of fragmentIds) {
            const nodes = (this.floorNodesById instanceof Map) ? (this.floorNodesById.get(fragmentId) || []) : [];
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i]) allNodes.push(nodes[i]);
            }
        }
        if (!(this._pendingFloorSectionUnregister instanceof Map)) this._pendingFloorSectionUnregister = new Map();
        this._pendingFloorSectionUnregister.set(sectionKey, { nodes: allNodes, fragmentIds });
        return allNodes.length;
    }

    // Remove nodes[start..start+count] from floorNodeIndex and null their back-refs in neighbors.
    unregisterFloorSectionNodeBatch(sectionKey, start, count) {
        if (!(this._pendingFloorSectionUnregister instanceof Map)) return 0;
        const pending = this._pendingFloorSectionUnregister.get(sectionKey);
        if (!pending) return 0;
        const { nodes } = pending;
        const end = Math.min(start + count, nodes.length);
        for (let i = start; i < end; i++) {
            const node = nodes[i];
            if (!node) continue;
            this._unindexFloorNodeByLayer(node);
            if (this.floorNodeIndex instanceof Map) this.floorNodeIndex.delete(node.id);
            if (!Array.isArray(node.neighbors)) continue;
            for (let d = 0; d < node.neighbors.length; d++) {
                const neighbor = node.neighbors[d];
                if (!neighbor || !Array.isArray(neighbor.neighbors)) continue;
                for (let rd = 0; rd < neighbor.neighbors.length; rd++) {
                    if (neighbor.neighbors[rd] === node) { neighbor.neighbors[rd] = null; }
                }
            }
        }
        return end - start;
    }

    // Finalize removal: clean up floorsById/floorNodesById/floorFragmentsBySurfaceId/floorFragmentsBySectionKey.
    commitFloorSectionUnregister(sectionKey) {
        if (!(this._pendingFloorSectionUnregister instanceof Map)) return 0;
        const pending = this._pendingFloorSectionUnregister.get(sectionKey);
        if (!pending) return 0;
        const { nodes, fragmentIds } = pending;
        this._pendingFloorSectionUnregister.delete(sectionKey);
        for (const fragmentId of fragmentIds) {
            if (this.floorsById instanceof Map) {
                const frag = this.floorsById.get(fragmentId);
                if (frag && this.floorFragmentsBySurfaceId instanceof Map) {
                    const surfaceSet = this.floorFragmentsBySurfaceId.get(frag.surfaceId);
                    if (surfaceSet instanceof Set) {
                        surfaceSet.delete(fragmentId);
                        if (surfaceSet.size === 0) this.floorFragmentsBySurfaceId.delete(frag.surfaceId);
                    }
                }
                this.floorsById.delete(fragmentId);
            }
            if (this.floorNodesById instanceof Map) this.floorNodesById.delete(fragmentId);
        }
        if (this.floorFragmentsBySectionKey instanceof Map) this.floorFragmentsBySectionKey.delete(sectionKey);
        this.markFloorObjectNodeCacheDirty();
        this.markFloorBuildingsDirty();
        return nodes.length;
    }

    // Monolithic version kept for initial load (setActiveCenter) and fallback.
    registerFloorSection(sectionKey, sectionState, options = {}) {
        if (typeof sectionKey !== "string" || sectionKey.length === 0) return 0;
        if (!sectionState || !(sectionState.sectionAssetsByKey instanceof Map)) return 0;
        if (this.floorFragmentsBySectionKey instanceof Map && this.floorFragmentsBySectionKey.has(sectionKey)) return 0;
        const asset = sectionState.sectionAssetsByKey.get(sectionKey);
        if (!asset) return 0;
        const sectionNodes = (sectionState.nodesBySectionKey instanceof Map)
            ? (sectionState.nodesBySectionKey.get(sectionKey) || [])
            : [];
        const doesNodeBelongToFragment = (typeof options.doesNodeBelongToFragment === "function")
            ? options.doesNodeBelongToFragment : null;
        const fragments = this.prepareFloorSectionFragments(sectionKey, sectionState, options);
        if (!fragments) return 0;
        this.addFloorSectionNodeBatch(sectionKey, sectionState, sectionNodes, 0, sectionNodes.length, doesNodeBelongToFragment);
        return this.finalizeFloorSectionNodes(sectionKey);
    }

    unregisterFloorSection(sectionKey) {
        if (!(this.floorFragmentsBySectionKey instanceof Map)) return 0;
        const fragmentIds = this.floorFragmentsBySectionKey.get(sectionKey);
        if (!fragmentIds || fragmentIds.size === 0) {
            this.floorFragmentsBySectionKey.delete(sectionKey);
            return 0;
        }
        let removedCount = 0;
        for (const fragmentId of fragmentIds) {
            const floorNodes = (this.floorNodesById instanceof Map)
                ? (this.floorNodesById.get(fragmentId) || []) : [];
            for (let i = 0; i < floorNodes.length; i++) {
                const floorNode = floorNodes[i];
                if (!floorNode) continue;
                this._unindexFloorNodeByLayer(floorNode);
                if (this.floorNodeIndex instanceof Map) {
                    this.floorNodeIndex.delete(floorNode.id);
                }
                if (Array.isArray(floorNode.neighbors)) {
                    for (let d = 0; d < floorNode.neighbors.length; d++) {
                        const neighbor = floorNode.neighbors[d];
                        if (!neighbor || !Array.isArray(neighbor.neighbors)) continue;
                        for (let rd = 0; rd < neighbor.neighbors.length; rd++) {
                            if (neighbor.neighbors[rd] === floorNode) {
                                neighbor.neighbors[rd] = null;
                            }
                        }
                    }
                }
                removedCount += 1;
            }
            if (this.floorsById instanceof Map) {
                const frag = this.floorsById.get(fragmentId);
                if (frag && this.floorFragmentsBySurfaceId instanceof Map) {
                    const surfaceSet = this.floorFragmentsBySurfaceId.get(frag.surfaceId);
                    if (surfaceSet instanceof Set) {
                        surfaceSet.delete(fragmentId);
                        if (surfaceSet.size === 0) this.floorFragmentsBySurfaceId.delete(frag.surfaceId);
                    }
                }
                this.floorsById.delete(fragmentId);
            }
            if (this.floorNodesById instanceof Map) this.floorNodesById.delete(fragmentId);
        }
        this.floorFragmentsBySectionKey.delete(sectionKey);
        this.markFloorObjectNodeCacheDirty();
        this.markFloorBuildingsDirty();
        return removedCount;
    }

    resolveFloorTransitionEndpoint(endpoint) {
        if (!endpoint || typeof endpoint !== "object") return null;
        const x = Number(endpoint.x);
        const y = Number(endpoint.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

        const fragmentId = (typeof endpoint.fragmentId === "string" && endpoint.fragmentId.length > 0)
            ? endpoint.fragmentId
            : ((typeof endpoint.floorId === "string" && endpoint.floorId.length > 0) ? endpoint.floorId : "");
        if (fragmentId && this.floorNodeIndex instanceof Map && this.floorsById instanceof Map) {
            const fragment = this.floorsById.get(fragmentId) || null;
            const surfaceId = fragment && typeof fragment.surfaceId === "string"
                ? fragment.surfaceId
                : ((typeof endpoint.surfaceId === "string" && endpoint.surfaceId.length > 0) ? endpoint.surfaceId : "");
            const directNode = this.floorNodeIndex.get(this.getFloorNodeKey(x, y, surfaceId, fragmentId)) || null;
            if (directNode) return directNode;
        }

        const surfaceId = (typeof endpoint.surfaceId === "string" && endpoint.surfaceId.length > 0)
            ? endpoint.surfaceId
            : ((fragmentId && this.floorsById instanceof Map && this.floorsById.get(fragmentId))
                ? this.floorsById.get(fragmentId).surfaceId
                : "");
        if (surfaceId) {
            return this.getFloorNodeBySurface(surfaceId, x, y);
        }

        return null;
    }

    connectFloorTransitions() {
        if (!(this.transitionsById instanceof Map)) return 0;
        let connectionCount = 0;
        for (const transition of this.transitionsById.values()) {
            if (!transition) continue;
            const fromNode = this.resolveFloorTransitionEndpoint(transition.from);
            const toNode = this.resolveFloorTransitionEndpoint(transition.to);
            if (!fromNode || !toNode) continue;

            const attachEdge = (sourceNode, targetNode) => {
                if (!sourceNode || !targetNode) return false;
                if (!Array.isArray(sourceNode.portalEdges)) sourceNode.portalEdges = [];
                const edgeId = `${transition.id}:${targetNode.id || this.getNodeKey(targetNode)}`;
                const existingEdge = sourceNode.portalEdges.find((edge) => {
                    if (!edge || edge.toNode !== targetNode) return false;
                    return edge.metadata && edge.metadata.transitionId === transition.id;
                });
                if (existingEdge) return false;
                sourceNode.portalEdges.push({
                    fromNode: sourceNode,
                    toNode: targetNode,
                    type: transition.type || "portal",
                    movementCost: Number.isFinite(transition.movementCost) ? Number(transition.movementCost) : 1,
                    penalty: Number.isFinite(transition.penalty) ? Number(transition.penalty) : 0,
                    zProfile: (typeof transition.zProfile === "string" && transition.zProfile.length > 0)
                        ? transition.zProfile
                        : "linear",
                    metadata: {
                        ...(transition.metadata && typeof transition.metadata === "object" ? transition.metadata : {}),
                        kind: transition.type || "portal",
                        transitionId: transition.id,
                        edgeId
                    }
                });
                return true;
            };

            if (attachEdge(fromNode, toNode)) connectionCount += 1;
            if (transition.bidirectional !== false && attachEdge(toNode, fromNode)) connectionCount += 1;
        }
        return connectionCount;
    }

    // Hex node spacing is 1.0 world units → inradius = 0.5.
    // A node whose center is within 0.5 units of the polygon boundary has a hex cell
    // that extends outside the polygon, so it should not be a valid pathfinding destination.
    _isFloorNodeAtFragmentBoundary(sourceNode, fragment) {
        const HEX_INRADIUS_SQ = 0.25; // 0.5²
        const poly = Array.isArray(fragment.outerPolygon) ? fragment.outerPolygon : null;
        if (!poly || poly.length < 3) return false;
        if (getPointPolygonBoundaryDistanceSq2D(sourceNode.x, sourceNode.y, poly) < HEX_INRADIUS_SQ) return true;
        const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
        for (let i = 0; i < holes.length; i++) {
            if (Array.isArray(holes[i]) && holes[i].length >= 3 &&
                getPointPolygonBoundaryDistanceSq2D(sourceNode.x, sourceNode.y, holes[i]) < HEX_INRADIUS_SQ) {
                return true;
            }
        }
        return false;
    }

    rebuildFloorRuntimeFromSectionState(sectionState, options = {}) {
        this.resetFloorRuntimeState();
        if (
            !sectionState ||
            !(sectionState.sectionAssetsByKey instanceof Map) ||
            !(sectionState.nodesBySectionKey instanceof Map)
        ) {
            return { fragmentCount: 0, nodeCount: 0, transitionCount: 0 };
        }

        const synthesizeGroundFragment = (typeof options.synthesizeGroundFragment === "function")
            ? options.synthesizeGroundFragment
            : null;
        const doesNodeBelongToFragment = (typeof options.doesNodeBelongToFragment === "function")
            ? options.doesNodeBelongToFragment
            : (() => true);
        const transitions = Array.isArray(options.transitions)
            ? options.transitions
            : (Array.isArray(sectionState.floorTransitions) ? sectionState.floorTransitions : []);

        let fragmentCount = 0;
        let nodeCount = 0;

        for (const [sectionKey, sectionNodes] of sectionState.nodesBySectionKey.entries()) {
            const asset = sectionState.sectionAssetsByKey.get(sectionKey) || null;
            if (!asset) continue;

            const authoredFragments = Array.isArray(asset.floors) ? asset.floors.slice() : [];
            const hasGroundFragment = authoredFragments.some((fragment) => Number(fragment && fragment.level) === 0);
            if (!hasGroundFragment && synthesizeGroundFragment) {
                const synthesizedGround = synthesizeGroundFragment(asset);
                if (synthesizedGround) authoredFragments.unshift(synthesizedGround);
            }

            for (let i = 0; i < authoredFragments.length; i++) {
                const registeredFragment = this.registerFloorFragment(authoredFragments[i]);
                if (!registeredFragment) continue;
                fragmentCount += 1;

                const materializedNodeKeys = [];
                for (let n = 0; n < sectionNodes.length; n++) {
                    const sourceNode = sectionNodes[n];
                    if (!doesNodeBelongToFragment(sourceNode, registeredFragment)) continue;
                    const floorNode = this.createFloorNodeFromSource(sourceNode, registeredFragment, {
                        baseZ: Number.isFinite(registeredFragment.nodeBaseZ) ? Number(registeredFragment.nodeBaseZ) : 0,
                        traversalLayer: Number.isFinite(registeredFragment.level) ? Number(registeredFragment.level) : 0
                    });
                    if (!floorNode) continue;
                    if (this._isFloorNodeAtFragmentBoundary(sourceNode, registeredFragment)) {
                        floorNode.clearance = -1;
                    }
                    nodeCount += 1;
                    materializedNodeKeys.push(`${floorNode.xindex},${floorNode.yindex}`);
                }

                registeredFragment.materializedNodeKeys = materializedNodeKeys;
            }
        }

        let transitionCount = 0;
        for (let i = 0; i < transitions.length; i++) {
            if (this.registerFloorTransition(transitions[i])) transitionCount += 1;
        }

        this.connectFloorNodeNeighbors();
        this.connectFloorTransitions();

        const stats = { fragmentCount, nodeCount, transitionCount };
        sectionState.floorRuntimeStats = stats;
        return stats;
    }

    getNodeKey(nodeOrX, y = null, traversalLayer = 0) {
        if (nodeOrX && typeof nodeOrX === "object") {
            const x = Number(nodeOrX.xindex);
            const nodeY = Number(nodeOrX.yindex);
            const layer = Number.isFinite(nodeOrX.traversalLayer)
                ? Number(nodeOrX.traversalLayer)
                : 0;
            return `${x},${nodeY},${layer}`;
        }
        return `${Number(nodeOrX)},${Number(y)},${Number.isFinite(traversalLayer) ? Number(traversalLayer) : 0}`;
    }

    getNode(x, y, traversalLayer = 0) {
        const resolvedLayer = Number.isFinite(traversalLayer) ? Number(traversalLayer) : 0;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        if (resolvedLayer !== 0) {
            if (typeof this.getFloorNodeAtLayer === "function") {
                return this.getFloorNodeAtLayer(x, y, resolvedLayer, { allowScan: false }) || null;
            }
            return null;
        }
        const tx = this.wrapX ? this.wrapIndexX(Math.round(x)) : Math.round(x);
        const ty = this.wrapY ? this.wrapIndexY(Math.round(y)) : Math.round(y);
        return (this.nodes[tx] && this.nodes[tx][ty]) ? this.nodes[tx][ty] : null;
    }

    getNodeSectionKey(node) {
        if (!node || typeof node !== "object") return "";
        const candidates = [
            node._prototypeSectionKey,
            node.ownerSectionKey,
            node._prototypeOwnerSectionKey,
            node.sectionKey
        ];
        for (let i = 0; i < candidates.length; i++) {
            if (typeof candidates[i] === "string" && candidates[i].length > 0) {
                return candidates[i];
            }
        }
        return "";
    }

    getGroundNodeForCoord(xindex, yindex) {
        const x = Number(xindex);
        const y = Number(yindex);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return this.getNode(x, y, 0);
    }

    getGroundNodeForNode(node) {
        if (!node || typeof node !== "object") return null;
        return this.getGroundNodeForCoord(node.xindex, node.yindex);
    }

    resolveNodeAtLayer(node, layer = 0, options = {}) {
        if (!node || typeof node !== "object") return null;
        const targetLayer = Number.isFinite(Number(layer)) ? Math.round(Number(layer)) : 0;
        const xindex = Number(node.xindex);
        const yindex = Number(node.yindex);
        if (!Number.isFinite(xindex) || !Number.isFinite(yindex)) return null;
        if (targetLayer === 0) {
            return this.getGroundNodeForCoord(xindex, yindex);
        }
        if (typeof this.getFloorNodeAtLayer !== "function") return null;
        const sectionKey = options && typeof options.sectionKey === "string"
            ? options.sectionKey
            : this.getNodeSectionKey(node);
        const surfaceId = options && typeof options.surfaceId === "string" ? options.surfaceId : "";
        const fragmentId = options && typeof options.fragmentId === "string" ? options.fragmentId : "";
        return this.getFloorNodeAtLayer(xindex, yindex, targetLayer, {
            sectionKey,
            surfaceId,
            fragmentId,
            allowScan: options && Object.prototype.hasOwnProperty.call(options, "allowScan")
                ? options.allowScan
                : false
        }) || null;
    }

    getNodeBaseZ(node) {
        if (!node) return 0;
        return Number.isFinite(node.baseZ) ? Number(node.baseZ) : 0;
    }

    // Resolve a node key (from a pathfinding worker result) back to a live node.
    // Floor node keys use the composite format "xindex,yindex,surfaceId,fragmentId"
    // and are looked up via floorNodeIndex.  Standard grid keys use the
    // "xindex,yindex,traversalLayer" format and are looked up via getNode().
    resolveNodeByKey(key) {
        if (typeof key !== "string" || key.length === 0) return null;
        // Floor node: composite id stored directly in floorNodeIndex
        if (this.floorNodeIndex instanceof Map && this.floorNodeIndex.has(key)) {
            return this.floorNodeIndex.get(key);
        }
        // Grid node: "x,y,layer"
        const parts = key.split(",");
        if (parts.length >= 2) {
            const x = parseInt(parts[0], 10);
            const y = parseInt(parts[1], 10);
            const layer = parts.length >= 3 ? parseInt(parts[2], 10) : 0;
            if (Number.isFinite(x) && Number.isFinite(y)) {
                return this.getNode(x, y, layer);
            }
        }
        return null;
    }

    findLiveTraversalEdgeForWorkerEdge(fromNode, toNode, workerEdgeId = "") {
        if (!fromNode || !toNode) return null;
        const outgoingEdges = this.getOutgoingEdges(fromNode, {
            includeBlocked: true,
            traversalOptions: {
                destinationNode: toNode,
                allowBlockedDestination: true,
                requiredClearance: 0,
                clearanceReferenceNode: toNode
            }
        });
        if (!Array.isArray(outgoingEdges) || outgoingEdges.length === 0) return null;
        const exact = outgoingEdges.find(edge => edge && edge.id === workerEdgeId && edge.toNode === toNode);
        if (exact) return exact;
        const transitionMatch = (typeof workerEdgeId === "string" && workerEdgeId.includes("->portal:"))
            ? outgoingEdges.find(edge => (
                edge &&
                edge.toNode === toNode &&
                edge.metadata &&
                typeof edge.metadata.transitionId === "string" &&
                workerEdgeId.endsWith(`:${edge.metadata.transitionId}`)
            ))
            : null;
        if (transitionMatch) return transitionMatch;
        return outgoingEdges.find(edge => edge && edge.toNode === toNode) || null;
    }

    // Convert a pathfinding worker path result into live traversal path items
    // (same format as findPathAStar).  Returns null when reconciliation fails
    // (e.g. map version changed between request and response).
    resolveWorkerPathResult(result, options = {}) {
        if (!result || result.ok !== true) return null;
        if (!Array.isArray(result.pathNodeKeys) || result.pathNodeKeys.length === 0) {
            return this.finalizeTraversalPath(null, [], options);
        }
        const path = [];
        for (let i = 0; i < result.pathNodeKeys.length; i++) {
            const toNode = this.resolveNodeByKey(result.pathNodeKeys[i]);
            if (!toNode) return null; // node no longer live — stale result
            const fromNode = i === 0
                ? this.resolveNodeByKey(result.startNodeKey || "")
                : this.resolveNodeByKey(result.pathNodeKeys[i - 1]);
            if (fromNode && options.returnPathSteps === true) {
                const workerEdgeId = Array.isArray(result.pathEdgeIds) ? (result.pathEdgeIds[i - 1] || "") : "";
                const edge = this.findLiveTraversalEdgeForWorkerEdge(fromNode, toNode, workerEdgeId) ||
                    this.createTraversalEdge(fromNode, toNode, {
                        type: "async",
                        allowed: true,
                        penalty: 0,
                        blockers: [],
                        movementCost: 1
                    });
                path.push(this.createPathStep(edge, options));
            } else {
                path.push(toNode);
            }
        }
        if (Array.isArray(result.plannedInteractions) && result.plannedInteractions.length > 0) {
            path.blockers = result.plannedInteractions;
        }
        return this.finalizeTraversalPath(null, path, options);
    }

    createTraversalEdge(fromNode, toNode, options = {}) {
        if (!fromNode || !toNode) return null;
        const type = (typeof options.type === "string" && options.type)
            ? options.type
            : "planar";
        const directionIndex = Number.isInteger(options.directionIndex)
            ? Number(options.directionIndex)
            : null;
        const fromKey = this.getNodeKey(fromNode);
        const toKey = this.getNodeKey(toNode);
        return {
            id: `${fromKey}->${toKey}:${directionIndex === null ? "x" : directionIndex}`,
            type,
            directionIndex,
            fromNode,
            toNode,
            allowed: options.allowed !== false,
            penalty: Number.isFinite(options.penalty) ? Number(options.penalty) : 0,
            blockers: Array.isArray(options.blockers) ? options.blockers.slice() : [],
            movementCost: Number.isFinite(options.movementCost) ? Number(options.movementCost) : 1,
            zProfile: (typeof options.zProfile === "string" && options.zProfile) ? options.zProfile : "linear",
            metadata: (options.metadata && typeof options.metadata === "object") ? { ...options.metadata } : {}
        };
    }

    sampleTraversalEdgePosition(edge, progress = 1) {
        if (!edge || !edge.fromNode || !edge.toNode) return null;
        const t = Number.isFinite(progress) ? Math.max(0, Math.min(1, Number(progress))) : 1;
        const stairId = edge.metadata && typeof edge.metadata.stairId === "string" ? edge.metadata.stairId : "";
        if (stairId) {
            return this.sampleStairPathPosition(stairId, edge.fromNode, t);
        }
        const fromNode = edge.fromNode;
        const toNode = edge.toNode;
        const x = fromNode.x + this.shortestDeltaX(fromNode.x, toNode.x) * t;
        const y = fromNode.y + this.shortestDeltaY(fromNode.y, toNode.y) * t;
        const fromZ = this.getNodeBaseZ(fromNode);
        const toZ = this.getNodeBaseZ(toNode);
        const z = fromZ + (toZ - fromZ) * t;
        return { x, y, z };
    }

    sampleStairPathPosition(stairId, fromNode, progress = 1) {
        if (!(this.stairsById instanceof Map)) {
            throw new Error(`missing stair runtime map for ${stairId}`);
        }
        const stair = this.stairsById.get(stairId);
        if (!stair) {
            throw new Error(`missing stair runtime record ${stairId}`);
        }
        const t = Number.isFinite(progress) ? Math.max(0, Math.min(1, Number(progress))) : 1;
        const fromId = fromNode ? (fromNode.id || this.getNodeKey(fromNode)) : "";
        const lowerToHigher = !stair.lowerNodeId || fromId === stair.lowerNodeId;
        const s = lowerToHigher ? t : (1 - t);
        const traversal = this.requireStairTraversal();
        const frame = this.getStairTraversalFrame(stair);
        const point = traversal.pointFromPathLocal(frame, s, 0.5);
        return {
            x: point.x,
            y: point.y,
            z: stair.lowerZ + (stair.higherZ - stair.lowerZ) * s
        };
    }

    createPathStep(edge, options = {}) {
        if (!edge || !edge.fromNode || !edge.toNode) return null;
        return {
            edge,
            fromNode: edge.fromNode,
            toNode: edge.toNode,
            type: edge.type || "planar",
            directionIndex: Number.isInteger(edge.directionIndex) ? Number(edge.directionIndex) : null,
            penalty: Number.isFinite(edge.penalty) ? Number(edge.penalty) : 0,
            blockers: Array.isArray(edge.blockers) ? edge.blockers.slice() : [],
            metadata: (options.metadata && typeof options.metadata === "object")
                ? { ...options.metadata }
                : ((edge.metadata && typeof edge.metadata === "object") ? { ...edge.metadata } : {}),
            getWorldPositionAt: (progress = 1) => this.sampleTraversalEdgePosition(edge, progress)
        };
    }

    createTraversalPathItem(edge, options = {}) {
        if (!edge || !edge.toNode) return null;
        if (options.returnPathSteps === true) {
            return this.createPathStep(edge);
        }
        return edge.toNode;
    }

    getObjectPortalEdges(node) {
        if (!node || !Array.isArray(node.objects) || node.objects.length === 0) return [];
        const edges = [];
        const seen = new Set();
        for (let i = 0; i < node.objects.length; i++) {
            const obj = node.objects[i];
            if (!obj || obj.gone || typeof obj.getTraversalPortalEdges !== "function") continue;
            const portalEdges = obj.getTraversalPortalEdges(node, this);
            if (!Array.isArray(portalEdges) || portalEdges.length === 0) continue;
            for (let j = 0; j < portalEdges.length; j++) {
                const portalEdge = portalEdges[j];
                if (!portalEdge || !portalEdge.toNode) continue;
                const edge = this.createTraversalEdge(
                    portalEdge.fromNode || node,
                    portalEdge.toNode,
                    {
                        type: (typeof portalEdge.type === "string" && portalEdge.type) ? portalEdge.type : "portal",
                        directionIndex: Number.isInteger(portalEdge.directionIndex) ? Number(portalEdge.directionIndex) : null,
                        allowed: portalEdge.allowed !== false,
                        penalty: Number.isFinite(portalEdge.penalty) ? Number(portalEdge.penalty) : 0,
                        blockers: Array.isArray(portalEdge.blockers) ? portalEdge.blockers : [],
                        movementCost: Number.isFinite(portalEdge.movementCost) ? Number(portalEdge.movementCost) : 1,
                        zProfile: (typeof portalEdge.zProfile === "string" && portalEdge.zProfile) ? portalEdge.zProfile : "linear",
                        metadata: (portalEdge.metadata && typeof portalEdge.metadata === "object") ? portalEdge.metadata : {}
                    }
                );
                if (!edge || seen.has(edge.id)) continue;
                seen.add(edge.id);
                edges.push(edge);
            }
        }
        return edges;
    }

    finalizeTraversalPath(startingNode, path, options = {}) {
        if (!Array.isArray(path)) return path;
        if (options.returnPathSteps !== true) return path;

        const steps = [];
        const blockers = Array.isArray(path.blockers) ? path.blockers.slice() : null;
        let fromNode = startingNode || null;

        for (let i = 0; i < path.length; i++) {
            const pathItem = path[i];
            if (!pathItem) continue;
            if (pathItem.toNode) {
                steps.push(pathItem);
                fromNode = pathItem.toNode || fromNode;
                continue;
            }

            const toNode = pathItem;
            if (!fromNode || !toNode) {
                fromNode = toNode || fromNode;
                continue;
            }

            let step = null;
            const outgoingEdges = this.getOutgoingEdges(fromNode, {
                includeBlocked: true,
                traversalOptions: {
                    destinationNode: toNode,
                    allowBlockedDestination: true,
                    requiredClearance: 0,
                    clearanceReferenceNode: toNode
                }
            });
            const matchingEdge = outgoingEdges.find((edge) => edge && edge.toNode === toNode) || null;
            if (matchingEdge) {
                step = this.createPathStep(matchingEdge);
            }

            if (!step) {
                const directionIndex = Array.isArray(fromNode.neighbors)
                    ? fromNode.neighbors.indexOf(toNode)
                    : -1;
                step = {
                    fromNode,
                    toNode,
                    type: "planar",
                    directionIndex: directionIndex >= 0 ? directionIndex : null,
                    penalty: 0,
                    blockers: [],
                    metadata: {},
                    getWorldPositionAt: (progress = 1) => this.sampleTraversalEdgePosition({ fromNode, toNode }, progress)
                };
            }

            steps.push(step);
            fromNode = toNode;
        }

        if (blockers) {
            steps.blockers = blockers;
        }
        return steps;
    }

    forEachOutgoingTraversal(node, options = {}, visitor) {
        if (!node || typeof visitor !== "function") return;
        if (this.getOutgoingEdges !== GameMap.prototype.getOutgoingEdges) {
            const customEdges = this.getOutgoingEdges(node, options);
            if (!Array.isArray(customEdges)) return;
            for (let i = 0; i < customEdges.length; i++) {
                visitor(customEdges[i]);
            }
            return;
        }
        const includeBlocked = options.includeBlocked === true;
        const traversalOptions = (options.traversalOptions && typeof options.traversalOptions === "object")
            ? options.traversalOptions
            : options;

        if (Array.isArray(node.neighbors)) {
            for (let directionIndex = 0; directionIndex < node.neighbors.length; directionIndex++) {
                const neighborNode = node.neighbors[directionIndex];
                if (!neighborNode) continue;
                const traversal = this.getTraversalInfo(node, directionIndex, traversalOptions);
                if (!includeBlocked && !traversal.allowed) continue;
                visitor({
                    type: "planar",
                    directionIndex,
                    fromNode: node,
                    toNode: neighborNode,
                    allowed: traversal.allowed,
                    penalty: traversal.penalty,
                    blockers: traversal.blockers,
                    movementCost: 1,
                    zProfile: "linear",
                    metadata: { kind: "planar" }
                });
            }
        }

        const objectPortalEdges = this.getObjectPortalEdges(node);
        for (let i = 0; i < objectPortalEdges.length; i++) {
            visitor(objectPortalEdges[i]);
        }

        if (Array.isArray(node.portalEdges)) {
            for (let i = 0; i < node.portalEdges.length; i++) {
                const portalEdge = node.portalEdges[i];
                if (!portalEdge || !portalEdge.toNode) continue;
                visitor(this.createTraversalEdge(
                    portalEdge.fromNode || node,
                    portalEdge.toNode,
                    {
                        type: (typeof portalEdge.type === "string" && portalEdge.type) ? portalEdge.type : "portal",
                        directionIndex: Number.isInteger(portalEdge.directionIndex) ? Number(portalEdge.directionIndex) : null,
                        allowed: portalEdge.allowed !== false,
                        penalty: Number.isFinite(portalEdge.penalty) ? Number(portalEdge.penalty) : 0,
                        blockers: Array.isArray(portalEdge.blockers) ? portalEdge.blockers : [],
                        movementCost: Number.isFinite(portalEdge.movementCost) ? Number(portalEdge.movementCost) : 1,
                        zProfile: (typeof portalEdge.zProfile === "string" && portalEdge.zProfile) ? portalEdge.zProfile : "linear",
                        metadata: (portalEdge.metadata && typeof portalEdge.metadata === "object") ? portalEdge.metadata : {}
                    }
                ));
            }
        }
    }

    getOutgoingEdges(node, options = {}) {
        if (!node) return [];
        const edges = [];
        this.forEachOutgoingTraversal(node, options, (traversal) => {
            if (!traversal) return;
            if (traversal.id) {
                edges.push(traversal);
                return;
            }
            edges.push(this.createTraversalEdge(traversal.fromNode, traversal.toNode, traversal));
        });
        return edges.filter(edge => !!edge);
    }

    // ── Clearance map ────────────────────────────────────────────────
    // Each node stores `clearance`: the minimum number of hex-ring steps
    // to the nearest blocked tile.  0 = blocked, 1 = adjacent to blocked,
    // Infinity = no obstacle within BFS horizon.
    //
    // Large animals require `node.clearance >= requiredClearanceRings` to
    // pathfind through a tile.

    /**
     * Encode every node's clearance value into a compact base-36 char-grid
     * string (one character per tile, row-major order).  Values 0–35 map
     * to '0'–'z'; Infinity is stored as 'z' (cap at 35).
     * Returns a compact object for easy JSON storage,
     * or null if the map isn't ready.
     */
    serializeClearance() {
        if (!this.nodes) return null;
        let out = "";
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const node = this.nodes[x] && this.nodes[x][y] ? this.nodes[x][y] : null;
                const raw  = node ? node.clearance : 0;
                const v    = Number.isFinite(raw) ? Math.max(0, Math.min(35, raw)) : 35;
                out += v.toString(36);
            }
        }
        return {
            encoding: "base36-char-grid",
            version:  CLEARANCE_VERSION,
            width:    this.width,
            height:   this.height,
            data:     out
        };
    }

    /**
     * Restore clearance values from a previously serialised char-grid.
     * Returns true on success, false if the data doesn't match.
     */
    deserializeClearance(encoded) {
        if (!this.nodes || !encoded ||
            encoded.encoding !== "base36-char-grid" ||
            typeof encoded.data !== "string") {
            return false;
        }
        // Reject stale clearance from an older algorithm version.
        if (!encoded.version || encoded.version < CLEARANCE_VERSION) {
            return false;
        }
        if (encoded.width !== this.width || encoded.height !== this.height) {
            return false;
        }
        const expectedLen = this.width * this.height;
        if (encoded.data.length < expectedLen) return false;

        let i = 0;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const node = this.nodes[x] && this.nodes[x][y] ? this.nodes[x][y] : null;
                if (!node) { i++; continue; }
                const v = parseInt(encoded.data[i], 36);
                node.clearance = Number.isFinite(v) ? v : 0;
                // 35 was the cap sentinel — treat it as "far from obstacles"
                // but NOT Infinity, so the saved value round-trips cleanly.
                i++;
            }
        }
        return true;
    }

    /**
     * Full BFS clearance recompute — called once after map generation and
     * optionally after bulk edits.
     */
    computeClearance() {
        // Adjacent-only direction indices (odd indices in the 12-neighbor scheme).
        const adjDirs = [1, 3, 5, 7, 9, 11];

        // Seed queue with all blocked tiles at clearance 0,
        // and tiles with wall-blocked edges at clearance 1
        // (the tile itself is passable but a large entity shouldn't
        // path through it because a wall runs along its edge).
        const queue = []; // entries: [node, clearance]
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const node = this.nodes[x][y];
                if (this.isNodeBlockedForTraversalClearance(node)) {
                    node.clearance = 0;
                    queue.push([node, 0]);
                } else {
                    node.clearance = Infinity;
                }
            }
        }

        // Second pass: seed wall-adjacent tiles.
        // Tiles with wall edges are treated as near-obstacles for clearance
        // purposes — large entities must not overlap them.
        // Tiles whose blocked neighbors are ALL diagonal (even-index, i.e.
        // far moves) seed at clearance 1 instead of 0, because the wall is
        // farther away than a direct adjacency.
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const node = this.nodes[x][y];
                if (node.clearance <= 0) continue; // already seeded
                if (node.blockedNeighbors && node.blockedNeighbors.size > 0) {
                    let hasAdjacentBlocker = false;
                    for (const dir of node.blockedNeighbors.keys()) {
                        const blockers = node.blockedNeighbors.get(dir);
                        if (dir % 2 === 1 && hasActiveDirectionalBlockers(blockers)) {
                            hasAdjacentBlocker = true;
                            break;
                        }
                    }
                    if (!hasAdjacentBlocker) {
                        let hasAnyDirectionalBlocker = false;
                        for (const blockers of node.blockedNeighbors.values()) {
                            if (hasActiveDirectionalBlockers(blockers)) {
                                hasAnyDirectionalBlocker = true;
                                break;
                            }
                        }
                        if (!hasAnyDirectionalBlocker) continue;
                    }
                    const seed = hasAdjacentBlocker ? 0 : 1;
                    if (seed < node.clearance) {
                        node.clearance = seed;
                        queue.push([node, seed]);
                    }
                }
            }
        }

        let head = 0;
        while (head < queue.length) {
            const [current, dist] = queue[head++];
            const nextDist = dist + 1;
            for (let i = 0; i < adjDirs.length; i++) {
                const neighbor = current.neighbors[adjDirs[i]];
                if (!neighbor) continue;
                if (neighbor.xindex < 0 || neighbor.yindex < 0) continue;
                if (nextDist < neighbor.clearance) {
                    neighbor.clearance = nextDist;
                    queue.push([neighbor, nextDist]);
                }
            }
        }
    }

    /**
     * Incremental clearance update around a single tile — call after a
     * tile's blocked status changes (add/remove object, flip `blocked`).
     * Re-runs BFS outward from a neighbourhood large enough to cover the
     * maximum clearance ring any animal might need.
     *
     * @param {MapNode} centerNode  The node whose status changed.
     * @param {number}  [radius=8]  How many rings outward to recompute.
     */
    updateClearanceAround(centerNode, radius) {
        if (!centerNode) return;
        const r = Number.isFinite(radius) ? Math.max(1, radius) : 8;
        const adjDirs = [1, 3, 5, 7, 9, 11];

        // 1. Collect all nodes within `r` rings of centerNode via BFS.
        const region = new Set();
        const bfs = [[centerNode, 0]];
        region.add(centerNode);
        let head = 0;
        while (head < bfs.length) {
            const [cur, d] = bfs[head++];
            if (d >= r) continue;
            for (let i = 0; i < adjDirs.length; i++) {
                const nb = cur.neighbors[adjDirs[i]];
                if (!nb || nb.xindex < 0 || nb.yindex < 0) continue;
                if (region.has(nb)) continue;
                region.add(nb);
                bfs.push([nb, d + 1]);
            }
        }

        // 2. Reset clearance for all nodes in region, seed blocked ones.
        const seedQueue = [];
        for (const node of region) {
            if (this.isNodeBlockedForTraversalClearance(node)) {
                node.clearance = 0;
                seedQueue.push([node, 0]);
            } else {
                node.clearance = Infinity;
            }
        }

        // Seed wall-adjacent tiles in the region.
        // Diagonal-only blockers seed at 1 instead of 0.
        for (const node of region) {
            if (node.clearance <= 0) continue;
            if (node.blockedNeighbors && node.blockedNeighbors.size > 0) {
                let hasAdjacentBlocker = false;
                for (const dir of node.blockedNeighbors.keys()) {
                    const blockers = node.blockedNeighbors.get(dir);
                    if (dir % 2 === 1 && hasActiveDirectionalBlockers(blockers)) {
                        hasAdjacentBlocker = true;
                        break;
                    }
                }
                if (!hasAdjacentBlocker) {
                    let hasAnyDirectionalBlocker = false;
                    for (const blockers of node.blockedNeighbors.values()) {
                        if (hasActiveDirectionalBlockers(blockers)) {
                            hasAnyDirectionalBlocker = true;
                            break;
                        }
                    }
                    if (!hasAnyDirectionalBlocker) continue;
                }
                const seed = hasAdjacentBlocker ? 0 : 1;
                if (seed < node.clearance) {
                    node.clearance = seed;
                    seedQueue.push([node, seed]);
                }
            }
        }

        // Also seed from nodes just outside the region (their clearance is
        // assumed correct and propagates inward).
        for (const node of region) {
            for (let i = 0; i < adjDirs.length; i++) {
                const nb = node.neighbors[adjDirs[i]];
                if (!nb || nb.xindex < 0 || nb.yindex < 0) continue;
                if (region.has(nb)) continue;
                // nb is outside region — its clearance is still valid.
                if (Number.isFinite(nb.clearance)) {
                    seedQueue.push([nb, nb.clearance]);
                }
            }
        }

        // 3. BFS propagation within the region only.
        head = 0;
        while (head < seedQueue.length) {
            const [cur, dist] = seedQueue[head++];
            const nextDist = dist + 1;
            for (let i = 0; i < adjDirs.length; i++) {
                const nb = cur.neighbors[adjDirs[i]];
                if (!nb || !region.has(nb)) continue;
                if (nextDist < nb.clearance) {
                    nb.clearance = nextDist;
                    seedQueue.push([nb, nextDist]);
                }
            }
        }
    }

    markPathfindingSnapshotDirty() {
        this.pathfindingSnapshotVersion = (Number(this.pathfindingSnapshotVersion) || 0) + 1;
        const globalScope = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null);
        const service = globalScope && globalScope.pathfindingService;
        if (service && typeof service.updateMapSnapshot === "function") {
            service.updateMapSnapshot(this);
        }
    }

    isGroundTerrainTraversalNode(node) {
        if (!node || typeof node !== "object") return false;
        if (typeof node.fragmentId === "string" && node.fragmentId.length > 0) return false;
        if (typeof node.surfaceId === "string" && node.surfaceId.length > 0) return false;
        const layer = Number.isFinite(node.traversalLayer) ? Math.round(Number(node.traversalLayer)) : 0;
        return layer === 0;
    }

    isGroundTerrainTypeImpassableForTraversal(typeName) {
        return typeName === "water";
    }

    collectGroundTerrainCollisionPolygons(bounds = null, options = {}) {
        const queryBounds = bounds && typeof bounds === "object" ? bounds : null;
        if (queryBounds) {
            for (const key of ["minX", "minY", "maxX", "maxY"]) {
                if (!Number.isFinite(Number(queryBounds[key]))) {
                    throw new Error("terrain collision bounds must be finite");
                }
            }
        }
        const out = [];
        const seenPolygons = new Set();
        const canTraverseTerrain = options && typeof options.canTraverseTerrain === "function"
            ? options.canTraverseTerrain
            : null;
        const addPolygons = (polygons, sourceKey = "") => {
            if (!Array.isArray(polygons)) return;
            for (let i = 0; i < polygons.length; i++) {
                const polygon = polygons[i];
                if (!polygon || typeof polygon !== "object") continue;
                if (seenPolygons.has(polygon)) continue;
                seenPolygons.add(polygon);
                const terrainType = typeof polygon.type === "string" ? polygon.type : "";
                if (!terrainType) {
                    throw new Error(`terrain collision polygon ${sourceKey || "map"}[${i}] is missing terrain type`);
                }
                if (canTraverseTerrain) {
                    const result = canTraverseTerrain(terrainType, null, {
                        map: this,
                        terrainType,
                        polygon
                    });
                    if (result === true) continue;
                    if (result !== false && !this.isGroundTerrainTypeImpassableForTraversal(terrainType)) continue;
                } else if (!this.isGroundTerrainTypeImpassableForTraversal(terrainType)) {
                    continue;
                }
                const polygonBounds = getPolygonBounds2D(polygon.points);
                if (!polygonBounds) {
                    throw new Error(`terrain collision polygon ${sourceKey || "map"}[${i}] has invalid bounds`);
                }
                if (queryBounds && !polygonBoundsOverlap2D(queryBounds, polygonBounds)) continue;
                out.push({ polygon, sourceKey, index: i, bounds: polygonBounds, terrainType });
            }
        };

        addPolygons(this.terrainPolygons, "map.terrainPolygons");

        const state = this._prototypeSectionState || null;
        if (state && state.sectionAssetsByKey instanceof Map) {
            const keys = state.loadedSectionAssetKeys instanceof Set && state.loadedSectionAssetKeys.size > 0
                ? Array.from(state.loadedSectionAssetKeys)
                : Array.from(state.sectionAssetsByKey.keys());
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const asset = state.sectionAssetsByKey.get(key) || null;
                if (!asset) {
                    throw new Error(`terrain collision could not resolve loaded section asset ${key}`);
                }
                addPolygons(asset.terrainPolygons, `section ${key}.terrainPolygons`);
            }
        }

        return out;
    }

    resolveGroundTerrainHitboxCollision(hitbox, options = {}) {
        if (options && options.ignoreTerrainPassability === true) return null;
        const traversalLayer = Number.isFinite(options && options.traversalLayer)
            ? Math.round(Number(options.traversalLayer))
            : 0;
        if (traversalLayer !== 0) return null;
        const x = Number(hitbox && hitbox.x);
        const y = Number(hitbox && hitbox.y);
        const radius = Number(hitbox && hitbox.radius);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) {
            throw new Error("terrain hitbox collision requires a finite circle hitbox");
        }
        const bounds = {
            minX: x - radius,
            minY: y - radius,
            maxX: x + radius,
            maxY: y + radius
        };
        const candidates = Array.isArray(options && options.terrainCollisionPolygons)
            ? options.terrainCollisionPolygons
            : this.collectGroundTerrainCollisionPolygons(bounds, options);
        let totalPushX = 0;
        let totalPushY = 0;
        let maxPushLen = 0;
        const collisions = [];
        for (let i = 0; i < candidates.length; i++) {
            const entry = candidates[i];
            const polygon = entry && entry.polygon ? entry.polygon : entry;
            const terrainType = typeof (entry && entry.terrainType) === "string"
                ? entry.terrainType
                : (typeof (polygon && polygon.type) === "string" ? polygon.type : "");
            const sourceKey = typeof (entry && entry.sourceKey) === "string" ? entry.sourceKey : "terrain";
            const index = Number.isInteger(entry && entry.index) ? entry.index : i;
            const collision = resolveCircleTerrainPolygonCollision2D(
                polygon,
                hitbox,
                `${sourceKey}[${index}]`
            );
            if (!collision) continue;
            const pushX = Number(collision.pushX);
            const pushY = Number(collision.pushY);
            if (!Number.isFinite(pushX) || !Number.isFinite(pushY)) {
                throw new Error(`terrain collision for ${sourceKey}[${index}] produced non-finite push`);
            }
            const pushLen = Math.hypot(pushX, pushY);
            if (!(pushLen > 0)) continue;
            totalPushX += pushX;
            totalPushY += pushY;
            maxPushLen = Math.max(maxPushLen, pushLen);
            collisions.push({ terrainType, sourceKey, index, pushX, pushY, overlap: pushLen });
        }
        if (collisions.length === 0) return null;
        return {
            pushX: totalPushX,
            pushY: totalPushY,
            maxPushLen,
            terrainType: collisions[0].terrainType,
            sourceKey: collisions[0].sourceKey,
            collisions
        };
    }

    isNodeTerrainImpassableForTraversal(node, options = {}) {
        if (!this.isGroundTerrainTraversalNode(node)) return false;
        if (options && options.ignoreTerrainPassability === true) return false;
        const typeName = this.getGroundTerrainTypeForNode(node);
        const canTraverseTerrain = options && typeof options.canTraverseTerrain === "function"
            ? options.canTraverseTerrain
            : null;
        if (canTraverseTerrain) {
            const result = canTraverseTerrain(typeName, node, {
                map: this,
                node,
                terrainType: typeName
            });
            if (result === true) return false;
            if (result === false) return true;
        }
        return this.isGroundTerrainTypeImpassableForTraversal(typeName);
    }

    getFarTraversalCornerDirectionPair(directionIndex) {
        switch (directionIndex) {
            case 0: return [11, 1];
            case 2: return [1, 3];
            case 4: return [3, 5];
            case 6: return [5, 7];
            case 8: return [7, 9];
            case 10: return [9, 11];
            default: return null;
        }
    }

    isTraversalMoveTerrainBlocked(currentNode, directionIndex, neighborNode = null, options = {}) {
        const toNode = neighborNode || (
            currentNode && Array.isArray(currentNode.neighbors)
                ? currentNode.neighbors[directionIndex]
                : null
        );
        if (this.isNodeTerrainImpassableForTraversal(toNode, options)) return true;
        const cornerPair = this.getFarTraversalCornerDirectionPair(directionIndex);
        if (!cornerPair || !currentNode || !Array.isArray(currentNode.neighbors)) return false;
        const blockerNode1 = currentNode.neighbors[cornerPair[0]];
        const blockerNode2 = currentNode.neighbors[cornerPair[1]];
        return this.isNodeTerrainImpassableForTraversal(blockerNode1, options) ||
            this.isNodeTerrainImpassableForTraversal(blockerNode2, options);
    }

    isNodeBlockedForTraversalClearance(node) {
        return !!(node && (node.isBlocked() || this.isNodeTerrainImpassableForTraversal(node)));
    }

    _isObjectBlockingForTraversal(obj, canTraverseObject = null, context = null) {
        if (!doesObjectBlockTile(obj)) return false;
        if (typeof canTraverseObject === "function" && canTraverseObject(obj, context) === true) return false;
        return true;
    }

    _resolveDirectionalTraversalBlocker(blocker, nodeA = null, nodeB = null) {
        if (!blocker || blocker.gone) return null;
        if (
            typeof blocker._resolveDirectionalBlockerForConnection === "function" &&
            nodeA && nodeB
        ) {
            const resolved = blocker._resolveDirectionalBlockerForConnection(nodeA, nodeB);
            return resolved || null;
        }
        return blocker;
    }

    _collectLikelyPathBlockers(centerNode, destinationNode, requiredClearance = 0, options = {}) {
        if (!centerNode || !destinationNode) return [];
        const canTraverseObject = (typeof options.canTraverseObject === "function")
            ? options.canTraverseObject
            : null;
        const currentNode = options.currentNode || centerNode;
        const neighborNode = options.neighborNode || centerNode;
        const directionIndex = Number.isInteger(options.directionIndex) ? options.directionIndex : null;
        const referenceNode = options.referenceNode || centerNode;
        const blockers = [];
        const blockersSeen = new Set();

        const pushIfBlocking = (obj, context = null) => {
            if (!obj || blockersSeen.has(obj)) return;
            if (!this._isObjectBlockingForTraversal(obj, canTraverseObject, context)) return;
            blockersSeen.add(obj);
            blockers.push(obj);
        };

        if (currentNode && directionIndex !== null) {
            const directionalBlockers = currentNode.blockedNeighbors
                ? currentNode.blockedNeighbors.get(directionIndex)
                : null;
            if (directionalBlockers instanceof Set) {
                directionalBlockers.forEach(blocker => {
                    if (!blocker || blocker.gone || isNonBlockingSunkObject(blocker)) return;
                    const resolvedBlocker = this._resolveDirectionalTraversalBlocker(blocker, currentNode, neighborNode);
                    if (!resolvedBlocker || resolvedBlocker.gone || isNonBlockingSunkObject(resolvedBlocker)) return;
                    pushIfBlocking(resolvedBlocker, {
                        currentNode,
                        centerNode,
                        neighborNode,
                        referenceNode,
                        destinationNode,
                        directionIndex,
                        kind: "directional"
                    });
                });
            }
        }

        const ringRadius = Math.max(0, Number.isFinite(requiredClearance) ? Math.floor(requiredClearance) + 1 : 1);
        const scanNodes = new Set();
        scanNodes.add(centerNode);
        let bfsFrontier = [centerNode];
        for (let r = 0; r < ringRadius; r++) {
            const next = [];
            for (let fi = 0; fi < bfsFrontier.length; fi++) {
                const fn = bfsFrontier[fi];
                for (let ni = 0; ni < fn.neighbors.length; ni++) {
                    const nb = fn.neighbors[ni];
                    if (!nb || scanNodes.has(nb)) continue;
                    scanNodes.add(nb);
                    next.push(nb);
                }
            }
            bfsFrontier = next;
        }

        const referenceDistSq = this.shortestDeltaX(referenceNode.x, destinationNode.x) ** 2
            + this.shortestDeltaY(referenceNode.y, destinationNode.y) ** 2;
        scanNodes.forEach(sn => {
            if (!Array.isArray(sn.objects)) return;
            for (let oi = 0; oi < sn.objects.length; oi++) {
                const obj = sn.objects[oi];
                if (!this._isObjectBlockingForTraversal(obj, canTraverseObject, {
                    currentNode,
                    centerNode,
                    referenceNode,
                    destinationNode,
                    directionIndex,
                    kind: "scan"
                })) continue;
                const objDistSq = this.shortestDeltaX(obj.x, destinationNode.x) ** 2
                    + this.shortestDeltaY(obj.y, destinationNode.y) ** 2;
                if (objDistSq < referenceDistSq) {
                    pushIfBlocking(obj, {
                        currentNode,
                        centerNode,
                        referenceNode,
                        destinationNode,
                        directionIndex,
                        kind: "scan"
                    });
                }
            }
        });

        return blockers;
    }

    getTraversalInfo(currentNode, directionIndex, options = {}) {
        const neighborNode = currentNode && currentNode.neighbors
            ? currentNode.neighbors[directionIndex]
            : null;
        if (!neighborNode) return { allowed: false, neighborNode: null, penalty: 0, blockers: [] };

        const destinationNode = options.destinationNode || null;
        const allowBlockedDestination = options.allowBlockedDestination === true;
        const requiredClearance = Number.isFinite(options.requiredClearance)
            ? Math.max(0, Math.floor(options.requiredClearance))
            : 0;
        const knockableTraversalCost = (typeof options.knockableTraversalCost === "function")
            ? options.knockableTraversalCost
            : null;
        const canTraverseObject = (typeof options.canTraverseObject === "function")
            ? options.canTraverseObject
            : null;
        const collectBlockers = options.collectBlockers !== false;
        const clearanceReferenceNode = options.clearanceReferenceNode || destinationNode || currentNode;
        const blockerPairs = [
            [11, 1],
            null,
            [1, 3],
            null,
            [3, 5],
            null,
            [5, 7],
            null,
            [7, 9],
            null,
            [9, 11],
            null
        ];

        const isBlockingObjectForPath = (obj, context = null) => this._isObjectBlockingForTraversal(obj, canTraverseObject, context);
        const getActiveDirectionalBlockers = (blockers, context = null) => {
            if (!(blockers instanceof Set) || blockers.size === 0) return [];
            const active = [];
            for (const blocker of blockers) {
                if (!blocker || blocker.gone) continue;
                const resolvedBlocker = this._resolveDirectionalTraversalBlocker(
                    blocker,
                    context && context.currentNode,
                    context && context.neighborNode
                );
                if (!resolvedBlocker || resolvedBlocker.gone) continue;
                if (isNonBlockingSunkObject(resolvedBlocker)) continue;
                if (typeof canTraverseObject === "function" && canTraverseObject(resolvedBlocker, context) === true) continue;
                active.push(resolvedBlocker);
            }
            return active;
        };
        const hasActiveDirectionalBlocker = (blockers, context = null) => {
            if (!(blockers instanceof Set) || blockers.size === 0) return false;
            for (const blocker of blockers) {
                if (!blocker || blocker.gone) continue;
                const resolvedBlocker = this._resolveDirectionalTraversalBlocker(
                    blocker,
                    context && context.currentNode,
                    context && context.neighborNode
                );
                if (!resolvedBlocker || resolvedBlocker.gone) continue;
                if (isNonBlockingSunkObject(resolvedBlocker)) continue;
                if (typeof canTraverseObject === "function" && canTraverseObject(resolvedBlocker, context) === true) continue;
                return true;
            }
            return false;
        };
        const getActiveTileBlockingObjects = (node, context = null) => {
            if (!node || !Array.isArray(node.objects) || node.objects.length === 0) return [];
            const blockers = [];
            for (let i = 0; i < node.objects.length; i++) {
                const obj = node.objects[i];
                if (isBlockingObjectForPath(obj, context || { node, kind: "tile" })) {
                    blockers.push(obj);
                }
            }
            return blockers;
        };
        const hasActiveTileBlockingObject = (node, context = null) => {
            if (!node || !Array.isArray(node.objects) || node.objects.length === 0) return false;
            for (let i = 0; i < node.objects.length; i++) {
                const obj = node.objects[i];
                if (isBlockingObjectForPath(obj, context || { node, kind: "tile" })) {
                    return true;
                }
            }
            return false;
        };
        const resolveKnockableTraversal = (blockers, kind) => {
            if (!Array.isArray(blockers) || blockers.length === 0) {
                return { allowed: true, penalty: 0, blockers: [] };
            }
            if (typeof knockableTraversalCost !== "function") {
                return { allowed: false, penalty: 0, blockers: [] };
            }
            let penalty = 0;
            const usedBlockers = collectBlockers ? [] : null;
            for (let i = 0; i < blockers.length; i++) {
                const blocker = blockers[i];
                const extraCost = knockableTraversalCost(blocker, {
                    currentNode,
                    neighborNode,
                    destinationNode,
                    directionIndex,
                    kind
                });
                if (!Number.isFinite(extraCost) || extraCost < 0) {
                    return { allowed: false, penalty: 0, blockers: [] };
                }
                penalty += Number(extraCost);
                if (usedBlockers) usedBlockers.push(blocker);
            }
            return { allowed: true, penalty, blockers: usedBlockers || [] };
        };

        let penalty = 0;
        const blockersUsed = collectBlockers ? [] : null;
        const neighborTerrainBlocked = this.isTraversalMoveTerrainBlocked(
            currentNode,
            directionIndex,
            neighborNode,
            options
        );
        const directionalContext = {
            currentNode,
            neighborNode,
            destinationNode,
            directionIndex,
            kind: "directional"
        };

        if (knockableTraversalCost) {
            const directionalBlockers = getActiveDirectionalBlockers(
                currentNode.blockedNeighbors ? currentNode.blockedNeighbors.get(directionIndex) : null,
                directionalContext
            );
            if (directionalBlockers.length > 0) {
                const traversal = resolveKnockableTraversal(directionalBlockers, "directional");
                if (!traversal.allowed) {
                    return { allowed: false, neighborNode, penalty: 0, blockers: [] };
                }
                penalty += traversal.penalty;
                if (blockersUsed) blockersUsed.push(...traversal.blockers);
            }
        } else if (hasActiveDirectionalBlocker(
            currentNode.blockedNeighbors ? currentNode.blockedNeighbors.get(directionIndex) : null,
            directionalContext
        )) {
            return { allowed: false, neighborNode, penalty: 0, blockers: [] };
        }

        if (neighborTerrainBlocked) {
            return { allowed: false, neighborNode, penalty: 0, blockers: [] };
        }

        if (!(allowBlockedDestination && destinationNode && neighborNode === destinationNode)) {
            const tileContext = {
                currentNode,
                neighborNode,
                destinationNode,
                directionIndex,
                kind: "tile"
            };
            if (knockableTraversalCost) {
                const tileBlockers = getActiveTileBlockingObjects(neighborNode, tileContext);
                if (neighborNode.blocked || tileBlockers.length > 0) {
                    if (tileBlockers.length === 0) {
                        return { allowed: false, neighborNode, penalty: 0, blockers: [] };
                    }
                    const traversal = resolveKnockableTraversal(tileBlockers, "tile");
                    if (!traversal.allowed) {
                        return { allowed: false, neighborNode, penalty: 0, blockers: [] };
                    }
                    penalty += traversal.penalty;
                    if (blockersUsed) blockersUsed.push(...traversal.blockers);
                }
            } else if (neighborNode.blocked || hasActiveTileBlockingObject(neighborNode, tileContext)) {
                if (neighborNode.blocked && !hasActiveTileBlockingObject(neighborNode, tileContext)) {
                    return { allowed: false, neighborNode, penalty: 0, blockers: [] };
                }
                return { allowed: false, neighborNode, penalty: 0, blockers: [] };
            }
        }

        const cornerPair = blockerPairs[directionIndex];
        if (cornerPair) {
            const [blocker1, blocker2] = cornerPair;
            const blockerNode1 = currentNode.neighbors[blocker1];
            const blockerNode2 = currentNode.neighbors[blocker2];
            if (knockableTraversalCost) {
                const cornerBlockers = [];
                if (blockerNode1) {
                    cornerBlockers.push(...getActiveTileBlockingObjects(blockerNode1, {
                        currentNode,
                        neighborNode,
                        destinationNode,
                        directionIndex: blocker1,
                        kind: "corner"
                    }));
                }
                if (blockerNode2) {
                    cornerBlockers.push(...getActiveTileBlockingObjects(blockerNode2, {
                        currentNode,
                        neighborNode,
                        destinationNode,
                        directionIndex: blocker2,
                        kind: "corner"
                    }));
                }
                if (cornerBlockers.length > 0) {
                    const traversal = resolveKnockableTraversal(cornerBlockers, "corner");
                    if (!traversal.allowed) {
                        return { allowed: false, neighborNode, penalty: 0, blockers: [] };
                    }
                    penalty += traversal.penalty;
                    if (blockersUsed) blockersUsed.push(...traversal.blockers);
                }
            } else if (
                (blockerNode1 && hasActiveTileBlockingObject(blockerNode1, {
                    currentNode,
                    neighborNode,
                    destinationNode,
                    directionIndex: blocker1,
                    kind: "corner"
                })) ||
                (blockerNode2 && hasActiveTileBlockingObject(blockerNode2, {
                    currentNode,
                    neighborNode,
                    destinationNode,
                    directionIndex: blocker2,
                    kind: "corner"
                }))
            ) {
                return { allowed: false, neighborNode, penalty: 0, blockers: [] };
            }
        }

        if (
            requiredClearance > 0 &&
            !(destinationNode && neighborNode === destinationNode)
        ) {
            if (!Number.isFinite(neighborNode.clearance) || neighborNode.clearance < requiredClearance) {
                if (!knockableTraversalCost) {
                    return { allowed: false, neighborNode, penalty: 0, blockers: [] };
                }
                const clearanceBlockers = this._collectLikelyPathBlockers(
                    neighborNode,
                    clearanceReferenceNode,
                    requiredClearance,
                    {
                        currentNode,
                        centerNode: neighborNode,
                        neighborNode,
                        referenceNode: neighborNode,
                        directionIndex,
                        canTraverseObject
                    }
                );
                if (clearanceBlockers.length === 0) {
                    return { allowed: false, neighborNode, penalty: 0, blockers: [] };
                }
                const traversal = resolveKnockableTraversal(clearanceBlockers, "clearance");
                if (!traversal.allowed) {
                    return { allowed: false, neighborNode, penalty: 0, blockers: [] };
                }
                penalty += traversal.penalty;
                if (blockersUsed) blockersUsed.push(...traversal.blockers);
            }
        }

        return { allowed: true, neighborNode, penalty, blockers: blockersUsed || [] };
    }

    findPath(startingNode, destinationNode, options) {
        const opts = options || {};
        const allowBlockedDestination = opts.allowBlockedDestination === true;
        const collectBlockers = opts.collectBlockers !== false;
        const canTraverseObject = (typeof opts.canTraverseObject === "function")
            ? opts.canTraverseObject
            : null;
        const canTraverseTerrain = (typeof opts.canTraverseTerrain === "function")
            ? opts.canTraverseTerrain
            : null;
        const debugOwner = opts.debugOwner || null;
        // Clearance: number of hex rings that must be obstacle-free around
        // each tile on the path.  0 = legacy point-entity behaviour.
        const requiredClearance = Number.isFinite(opts.clearance)
            ? Math.max(0, Math.floor(opts.clearance))
            : 0;
        // Allow only brief random detours before re-attempting a direct beeline.
        const maxRandomDetours = Number.isFinite(opts.maxRandomDetours)
            ? Math.max(0, Math.floor(opts.maxRandomDetours))
            : 0; // unused — kept for API compatibility
        const keyFor = (node) => this.getNodeKey(node);
        const outgoingTraversalOptions = {
            destinationNode,
            allowBlockedDestination,
            requiredClearance,
            canTraverseObject,
            canTraverseTerrain,
            clearanceReferenceNode: destinationNode,
            collectBlockers
        };

        // Even indices are far (diagonal) moves, odd indices are adjacent moves
        // Blocker pairs for far moves: the two adjacent directions that flank the far direction
        const blockerPairs = [
            [11, 1], // 0: far left (between down-left and up-left)
            null,    // 1: up-left (adjacent)
            [1, 3],  // 2: far up-left (between up-left and up)
            null,    // 3: up (adjacent)
            [3, 5],  // 4: far up-right (between up and up-right)
            null,    // 5: up-right (adjacent)
            [5, 7],  // 6: far right (between up-right and down-right)
            null,    // 7: down-right (adjacent)
            [7, 9],  // 8: far down-right (between down-right and down)
            null,    // 9: down (adjacent)
            [9, 11], // 10: far down-left (between down and down-left)
            null     // 11: down-left (adjacent)
        ];
        const distFactors = [0.577, 1, 0.577, 1, 0.577, 1, 0.577, 1, 0.577, 1, 0.577, 1];

        const isBlockingObjectForPath = (obj, context = null) => this._isObjectBlockingForTraversal(obj, canTraverseObject, context);
        const hasBlockingObjectForPath = (node, context = null) => {
            if (!node || node.blockedByObjects <= 0 || !Array.isArray(node.objects) || node.objects.length === 0) return false;
            for (let i = 0; i < node.objects.length; i++) {
                if (isBlockingObjectForPath(node.objects[i], context)) return true;
            }
            return false;
        };
        const hasDirectionalBlockersForPath = (blockers, context = null) => {
            if (!(blockers instanceof Set) || blockers.size === 0) return false;
            for (const blocker of blockers) {
                if (!blocker || blocker.gone) continue;
                const resolvedBlocker = this._resolveDirectionalTraversalBlocker(
                    blocker,
                    context && context.currentNode,
                    context && context.neighborNode
                );
                if (!resolvedBlocker || resolvedBlocker.gone) continue;
                if (isNonBlockingSunkObject(resolvedBlocker)) continue;
                if (typeof canTraverseObject === "function" && canTraverseObject(resolvedBlocker, context) === true) continue;
                return true;
            }
            return false;
        };

        /**
         * Returns true when the move from currentNode in direction n is
         * passable, respecting walls, blocked tiles, far-move anti-corner-cut,
         * and the clearance requirement for large entities.
         *
         * If the animal is already in a tile that doesn't meet its clearance
         * requirement (e.g. spawned/loaded too close to a wall), moves that
         * improve clearance are allowed so it can escape.
         */
        const canMoveDirection = (currentNode, n) => {
            const neighborNode = currentNode.neighbors[n];
            if (!neighborNode) return false;

            // Wall blocking
            const blockingWalls = currentNode.blockedNeighbors ? currentNode.blockedNeighbors.get(n) : null;
            if (hasDirectionalBlockersForPath(blockingWalls, {
                currentNode,
                neighborNode,
                directionIndex: n,
                destinationNode,
                kind: "directional"
            })) return false;

            // Tile blocking — allow if this is the destination and caller opts in
            if (this.isTraversalMoveTerrainBlocked(currentNode, n, neighborNode, opts)) {
                return false;
            }

            if (hasBlockingObjectForPath(neighborNode, { currentNode, neighborNode, directionIndex: n, destinationNode, kind: "tile" }) || neighborNode.blocked) {
                if (allowBlockedDestination && neighborNode === destinationNode) {
                    // fall through — let canMoveDirection return true for the destination
                } else {
                    return false;
                }
            }

            // Anti-corner-cut for far moves
            if (blockerPairs[n]) {
                const [b1, b2] = blockerPairs[n];
                const bn1 = currentNode.neighbors[b1];
                const bn2 = currentNode.neighbors[b2];
                if (
                    (bn1 && hasBlockingObjectForPath(bn1, { currentNode, neighborNode, directionIndex: b1, destinationNode, kind: "corner" })) ||
                    (bn2 && hasBlockingObjectForPath(bn2, { currentNode, neighborNode, directionIndex: b2, destinationNode, kind: "corner" }))
                ) return false;
            }

            // Clearance check for large entities
            if (requiredClearance > 0) {
                const curCl = Number.isFinite(currentNode.clearance) ? currentNode.clearance : 0;
                const nbCl = Number.isFinite(neighborNode.clearance) ? neighborNode.clearance : 0;
                if (nbCl < requiredClearance) {
                    // Normally blocked, but allow if we're already in a bad
                    // spot and this move improves (or at least doesn't worsen)
                    // our clearance — lets the animal escape to open ground.
                    if (curCl >= requiredClearance || nbCl <= curCl) {
                        return false;
                    }
                }
            }

            return true;
        };

        const path = [];
        if (collectBlockers) {
            path.blockers = []; // blocking objects found when the ideal direction is impassable
        }
        const blockersSeen = new Set();
        let currentNode = startingNode;
        const visited = new Set();
        const maxSteps = Math.max(200, (this.width + this.height));
        if (currentNode) {
            visited.add(keyFor(currentNode));
        }

        while (currentNode && path.length < maxSteps) {
            let bestValidDistance = Infinity;
            let bestValidEdge = null;
            let idealEdge = null;
            let idealDist = Infinity;
            let idealDirectionPassable = false;
            const validEdges = [];
            this.forEachOutgoingTraversal(currentNode, {
                traversalOptions: outgoingTraversalOptions,
                includeBlocked: true
            }, (edge) => {
                const neighborNode = edge && edge.toNode;
                if (!neighborNode) return;

                const directionIndex = Number.isInteger(edge.directionIndex) ? Number(edge.directionIndex) : null;
                const distFactor = directionIndex === null ? 1 : distFactors[directionIndex];
                const xdist = this.shortestDeltaX(currentNode.x, destinationNode.x)
                            - this.shortestDeltaX(currentNode.x, neighborNode.x) * distFactor;
                const ydist = this.shortestDeltaY(currentNode.y, destinationNode.y)
                            - this.shortestDeltaY(currentNode.y, neighborNode.y) * distFactor;
                const dist = xdist ** 2 + ydist ** 2;

                // Track the best direction regardless of passability or visited state
                if (dist < idealDist) {
                    idealDist = dist;
                    idealEdge = edge;
                    idealDirectionPassable = edge.allowed !== false;
                }

                if (edge.allowed === false) return;

                // Reached destination?
                if (neighborNode === destinationNode) {
                    path.push(this.createTraversalPathItem(edge, opts));
                    bestValidEdge = "__found_destination__";
                    return;
                }

                const nKey = keyFor(neighborNode);
                if (visited.has(nKey)) return;

                validEdges.push(edge);
                if (dist < bestValidDistance) {
                    bestValidDistance = dist;
                    bestValidEdge = edge;
                }
            });
            if (bestValidEdge === "__found_destination__") {
                return this.finalizeTraversalPath(startingNode, path, opts);
            }

            // The ideal direction toward the destination is physically blocked (fails
            // canMoveDirection — not merely visited). Collect the culprit objects,
            // take one random bounce step so the animal keeps moving, then return.
            if (idealEdge && !idealDirectionPassable) {
                if (collectBlockers) {
                    const likelyBlockers = this._collectLikelyPathBlockers(currentNode, destinationNode, requiredClearance, {
                        currentNode,
                        neighborNode: idealEdge.toNode || null,
                        directionIndex: Number.isInteger(idealEdge.directionIndex) ? Number(idealEdge.directionIndex) : null,
                        referenceNode: currentNode,
                        canTraverseObject
                    });
                    for (let i = 0; i < likelyBlockers.length; i++) {
                        const blocker = likelyBlockers[i];
                        if (blockersSeen.has(blocker)) continue;
                        blockersSeen.add(blocker);
                        path.blockers.push(blocker);
                    }
                }

                // Find a bounce step. Try valid (clearance-respecting) directions first;
                // fall back to any unblocked direction so the animal never fully freezes.
                let bounceEdges = validEdges.length > 0 ? validEdges : null;
                if (!bounceEdges) {
                    // Clearance-ignoring fallback: any neighbor that isn't hard-blocked
                    bounceEdges = [];
                    this.forEachOutgoingTraversal(currentNode, {
                        traversalOptions: {
                            ...outgoingTraversalOptions,
                            requiredClearance: 0
                        },
                        includeBlocked: false
                    }, (edge) => {
                        if (!edge || !edge.toNode || visited.has(keyFor(edge.toNode))) return;
                        bounceEdges.push(edge);
                    });
                }
                if (bounceEdges.length > 0) {
                    const bounceEdge = bounceEdges[Math.floor(Math.random() * bounceEdges.length)];
                    path.push(this.createTraversalPathItem(bounceEdge, opts));
                }
                return this.finalizeTraversalPath(startingNode, path, opts);
            }

            // Ideal direction is passable — take the greedy step.
            // If no valid (clearance-respecting) direction exists, fall back to any
            // unblocked direction so the animal can escape a tight spot.
            if (validEdges.length === 0) {
                this.forEachOutgoingTraversal(currentNode, {
                    traversalOptions: {
                        ...outgoingTraversalOptions,
                        requiredClearance: 0
                    },
                    includeBlocked: false
                }, (edge) => {
                    const nb = edge && edge.toNode;
                    if (!nb) return;
                    const nKey = keyFor(nb);
                    if (visited.has(nKey)) return;
                    validEdges.push(edge);
                    const directionIndex = Number.isInteger(edge.directionIndex) ? Number(edge.directionIndex) : null;
                    const distFactor = directionIndex === null ? 1 : distFactors[directionIndex];
                    const xdist = this.shortestDeltaX(currentNode.x, destinationNode.x)
                                - this.shortestDeltaX(currentNode.x, nb.x) * distFactor;
                    const ydist = this.shortestDeltaY(currentNode.y, destinationNode.y)
                                - this.shortestDeltaY(currentNode.y, nb.y) * distFactor;
                    const dist = xdist ** 2 + ydist ** 2;
                    if (dist < bestValidDistance) {
                        bestValidDistance = dist;
                        bestValidEdge = edge;
                    }
                });
                if (validEdges.length === 0) return this.finalizeTraversalPath(startingNode, path, opts); // truly surrounded, give up
            }

            const chosenNeighbor = bestValidEdge ? bestValidEdge.toNode : null;
            if (!chosenNeighbor) return this.finalizeTraversalPath(startingNode, path, opts);

            const chosenKey = keyFor(chosenNeighbor);
            if (visited.has(chosenKey)) return this.finalizeTraversalPath(startingNode, path, opts);

            path.push(this.createTraversalPathItem(bestValidEdge, opts));
            visited.add(chosenKey);
            currentNode = chosenNeighbor;
        }

        return this.finalizeTraversalPath(startingNode, path, opts);
    }

    findPathAStar(startingNode, destinationNode, options = {}) {
        if (!startingNode || !destinationNode) return null;
        if (startingNode === destinationNode) return this.finalizeTraversalPath(startingNode, [], options);

        // Keep traversal rules aligned with legacy findPath().
        // Even indices are far moves, odd indices are adjacent moves.
        const allowBlockedDestination = options.allowBlockedDestination === true;
        // Clearance requirement: number of hex-ring steps that must be
        // obstacle-free around every tile on the path.  0 = point-entity
        // (default / legacy behaviour).
        const requiredClearance = Number.isFinite(options.clearance)
            ? Math.max(0, Math.floor(options.clearance))
            : 0;

        // wallAvoidance: when > 0, tiles near walls cost more to traverse.
        // The penalty added per step is  wallAvoidance / (1 + clearance),
        // so tiles with clearance 0 pay the full weight, tiles far from
        // walls pay almost nothing.  Typical value: 2–5.
        const wallAvoidance = Number.isFinite(options.wallAvoidance)
            ? Math.max(0, options.wallAvoidance)
            : 0;
        const maxPathLength = Number.isFinite(options.maxPathLength)
            ? Math.max(0, Number(options.maxPathLength))
            : Infinity;
        const knockableTraversalCost = (typeof options.knockableTraversalCost === "function")
            ? options.knockableTraversalCost
            : null;
        const canTraverseObject = (typeof options.canTraverseObject === "function")
            ? options.canTraverseObject
            : null;
        const canTraverseTerrain = (typeof options.canTraverseTerrain === "function")
            ? options.canTraverseTerrain
            : null;
        const collectBlockers = options.collectBlockers !== false;

        if (Number.isFinite(maxPathLength)) {
            const startHeuristic = Math.hypot(
                this.shortestDeltaX(startingNode.x, destinationNode.x),
                this.shortestDeltaY(startingNode.y, destinationNode.y)
            );
            if (startHeuristic > maxPathLength) {
                return null;
            }
        }

        // Floor nodes share grid coordinates with their source nodes, so use
        // the floor node's unique composite id (xindex,yindex,surfaceId,fragmentId)
        // as its key; regular grid nodes fall back to the standard key.
        const keyFor = (node) => (
            node && typeof node.id === "string" && node.id.length > 0 && typeof node.fragmentId === "string"
                ? node.id
                : this.getNodeKey(node)
        );
        const isBlockingObjectForPath = (obj, context = null) => this._isObjectBlockingForTraversal(obj, canTraverseObject, context);
        const getActiveDirectionalBlockers = (blockers, context = null) => {
            if (!(blockers instanceof Set) || blockers.size === 0) return [];
            const active = [];
            for (const blocker of blockers) {
                if (!blocker || blocker.gone) continue;
                const resolvedBlocker = this._resolveDirectionalTraversalBlocker(
                    blocker,
                    context && context.currentNode,
                    context && context.neighborNode
                );
                if (!resolvedBlocker || resolvedBlocker.gone) continue;
                if (isNonBlockingSunkObject(resolvedBlocker)) continue;
                if (typeof canTraverseObject === "function" && canTraverseObject(resolvedBlocker, context) === true) continue;
                active.push(resolvedBlocker);
            }
            return active;
        };
        const getActiveTileBlockingObjects = (node) => {
            if (!node || !Array.isArray(node.objects) || node.objects.length === 0) return [];
            const blockers = [];
            for (let i = 0; i < node.objects.length; i++) {
                const obj = node.objects[i];
                if (isBlockingObjectForPath(obj, { node, kind: "tile" })) blockers.push(obj);
            }
            return blockers;
        };
        if (this.isNodeTerrainImpassableForTraversal(destinationNode, options)) {
            return null;
        }

        if (!allowBlockedDestination) {
            const destinationTileBlockers = getActiveTileBlockingObjects(destinationNode);
            if (destinationNode.blocked || destinationTileBlockers.length > 0) {
                return null;
            }
        }
        // If we need clearance, the destination must also satisfy it (unless caller opts out).
        if (
            !allowBlockedDestination &&
            requiredClearance > 0 &&
            destinationNode.clearance < requiredClearance
        ) {
            return null;
        }

        const resolveKnockableTraversal = (blockers, currentNode, neighborNode, directionIndex, kind) => {
            if (!Array.isArray(blockers) || blockers.length === 0) {
                return { allowed: true, penalty: 0, blockers: [] };
            }
            if (typeof knockableTraversalCost !== "function") {
                return { allowed: false, penalty: 0, blockers: [] };
            }
            let penalty = 0;
            const usedBlockers = [];
            for (let i = 0; i < blockers.length; i++) {
                const blocker = blockers[i];
                const extraCost = knockableTraversalCost(blocker, {
                    currentNode,
                    neighborNode,
                    destinationNode,
                    directionIndex,
                    kind
                });
                if (!Number.isFinite(extraCost) || extraCost < 0) {
                    return { allowed: false, penalty: 0, blockers: [] };
                }
                penalty += Number(extraCost);
                usedBlockers.push(blocker);
            }
            return { allowed: true, penalty, blockers: usedBlockers };
        };
        const stepDistance = (fromNode, toNode) => {
            const dx = this.shortestDeltaX(fromNode.x, toNode.x);
            const dy = this.shortestDeltaY(fromNode.y, toNode.y);
            return Math.hypot(dx, dy);
        };
        const movementCost = (fromNode, toNode) => {
            const dist = stepDistance(fromNode, toNode);
            // Penalise tiles close to walls so the path hugs open space.
            // The penalty is proportional to step distance so that far moves
            // (which cover more ground per step) aren't artificially cheap
            // due to fewer penalty applications.
            if (wallAvoidance > 0) {
                const cl = Number.isFinite(toNode.clearance) ? toNode.clearance : 0;
                return dist * (1 + wallAvoidance / (1 + cl));
            }
            return dist;
        };
        const heuristic = (node) => {
            const dx = this.shortestDeltaX(node.x, destinationNode.x);
            const dy = this.shortestDeltaY(node.y, destinationNode.y);
            return Math.hypot(dx, dy);
        };
        const outgoingTraversalOptions = {
            destinationNode,
            allowBlockedDestination,
            requiredClearance,
            knockableTraversalCost,
            canTraverseObject,
            canTraverseTerrain,
            clearanceReferenceNode: destinationNode,
            collectBlockers
        };

        const reconstructPath = (cameFrom, cameFromEdge, currentKey, blockersByKey) => {
            const result = [];
            let walkKey = currentKey;
            while (cameFrom.has(walkKey)) {
                const edge = cameFromEdge.get(walkKey) || null;
                if (edge) {
                    result.unshift(this.createTraversalPathItem(edge, options));
                } else {
                    const node = openOrClosedNodes.get(walkKey);
                    if (node) result.unshift(node);
                }
                walkKey = cameFrom.get(walkKey);
            }
            const blockers = blockersByKey ? blockersByKey.get(currentKey) : null;
            if (blockers instanceof Set && blockers.size > 0) {
                result.blockers = Array.from(blockers);
            }
            return result;
        };

        const openSet = new Set();
        const openQueue = new MinPriorityQueue();
        const cameFrom = new Map();
        const cameFromEdge = new Map();
        const gScore = new Map();
        const distanceScore = new Map();
        const fScore = new Map();
        const openOrClosedNodes = new Map();
        const blockersByKey = collectBlockers ? new Map() : null;

        const startKey = keyFor(startingNode);
        const goalKey = keyFor(destinationNode);
        openSet.add(startKey);
        gScore.set(startKey, 0);
        distanceScore.set(startKey, 0);
        const startF = heuristic(startingNode);
        fScore.set(startKey, startF);
        openQueue.push(startKey, startF);
        openOrClosedNodes.set(startKey, startingNode);
        openOrClosedNodes.set(goalKey, destinationNode);
        if (blockersByKey) {
            blockersByKey.set(startKey, new Set());
        }

        const maxIterations = Number.isFinite(options.maxIterations)
            ? Math.max(1, Math.floor(options.maxIterations))
            : Math.max(1000, this.width * this.height * 2);

        let iterations = 0;
        while (!openQueue.isEmpty() && openSet.size > 0 && iterations < maxIterations) {
            iterations += 1;

            let currentEntry = null;
            while (!openQueue.isEmpty()) {
                const candidate = openQueue.pop();
                if (!candidate) break;
                if (!openSet.has(candidate.value)) continue;
                const liveScore = fScore.has(candidate.value) ? fScore.get(candidate.value) : Infinity;
                if (candidate.priority > liveScore) continue;
                currentEntry = candidate;
                break;
            }
            if (!currentEntry) break;

            const currentKey = currentEntry.value;

            const currentNode = openOrClosedNodes.get(currentKey);
            if (!currentNode) {
                openSet.delete(currentKey);
                continue;
            }

            if (currentKey === goalKey) {
                return this.finalizeTraversalPath(startingNode, reconstructPath(cameFrom, cameFromEdge, currentKey, blockersByKey), options);
            }

            openSet.delete(currentKey);

            this.forEachOutgoingTraversal(currentNode, {
                traversalOptions: outgoingTraversalOptions,
                includeBlocked: false
            }, (traversal) => {
                const neighborNode = traversal && traversal.toNode;
                if (!neighborNode) return;

                const neighborKey = keyFor(neighborNode);
                openOrClosedNodes.set(neighborKey, neighborNode);

                const currentG = gScore.has(currentKey) ? gScore.get(currentKey) : Infinity;
                const currentDistance = distanceScore.has(currentKey) ? distanceScore.get(currentKey) : Infinity;
                const tentativeDistance = currentDistance + stepDistance(currentNode, neighborNode);
                if (tentativeDistance > maxPathLength) return;
                const tentativeG = currentG + movementCost(currentNode, neighborNode) + traversal.penalty;
                const existingG = gScore.has(neighborKey) ? gScore.get(neighborKey) : Infinity;
                if (tentativeG >= existingG) return;

                cameFrom.set(neighborKey, currentKey);
                cameFromEdge.set(neighborKey, traversal);
                gScore.set(neighborKey, tentativeG);
                distanceScore.set(neighborKey, tentativeDistance);
                const neighborF = tentativeG + heuristic(neighborNode);
                fScore.set(neighborKey, neighborF);
                if (blockersByKey) {
                    const nextBlockers = new Set(blockersByKey.get(currentKey) || []);
                    for (let i = 0; i < traversal.blockers.length; i++) {
                        nextBlockers.add(traversal.blockers[i]);
                    }
                    blockersByKey.set(neighborKey, nextBlockers);
                }
                openSet.add(neighborKey);
                openQueue.push(neighborKey, neighborF);
            });
        }

        return null;
    }

    findRetreatPath(startingNode, threatNodeOrPoint, options = {}) {
        if (!startingNode || !threatNodeOrPoint) return null;

        const maxPathLength = Number.isFinite(options.maxPathLength)
            ? Math.max(0, Number(options.maxPathLength))
            : NaN;
        if (!Number.isFinite(maxPathLength)) return null;
        if (maxPathLength <= 0) return this.finalizeTraversalPath(startingNode, [], options);

        const requiredClearance = Number.isFinite(options.clearance)
            ? Math.max(0, Math.floor(options.clearance))
            : 0;
        const threatPoint = (
            Number.isFinite(options.threatX) && Number.isFinite(options.threatY)
        )
            ? { x: Number(options.threatX), y: Number(options.threatY) }
            : (
                Number.isFinite(threatNodeOrPoint.x) && Number.isFinite(threatNodeOrPoint.y)
                    ? { x: Number(threatNodeOrPoint.x), y: Number(threatNodeOrPoint.y) }
                    : null
            );
        if (!threatPoint) return null;

        const knockableTraversalCost = (typeof options.knockableTraversalCost === "function")
            ? options.knockableTraversalCost
            : null;
        const canTraverseObject = (typeof options.canTraverseObject === "function")
            ? options.canTraverseObject
            : null;
        const canTraverseTerrain = (typeof options.canTraverseTerrain === "function")
            ? options.canTraverseTerrain
            : null;
        const collectBlockers = options.collectBlockers !== false;
        const stepDistance = (fromNode, toNode) => {
            const dx = this.shortestDeltaX(fromNode.x, toNode.x);
            const dy = this.shortestDeltaY(fromNode.y, toNode.y);
            return Math.hypot(dx, dy);
        };
        const threatDistance = (node) => {
            const dx = this.shortestDeltaX(threatPoint.x, node.x);
            const dy = this.shortestDeltaY(threatPoint.y, node.y);
            return Math.hypot(dx, dy);
        };

        const path = [];
        if (collectBlockers) {
            path.blockers = [];
        }
        const blockersSeen = collectBlockers ? new Set() : null;
        const keyFor = (node) => this.getNodeKey(node);
        const outgoingTraversalOptions = {
            requiredClearance,
            knockableTraversalCost,
            canTraverseObject,
            canTraverseTerrain,
            clearanceReferenceNode: startingNode,
            collectBlockers
        };
        const visited = new Set([keyFor(startingNode)]);
        let currentNode = startingNode;
        let totalDistance = 0;
        let previousNode = null;
        let currentThreatDistance = threatDistance(currentNode);
        const epsilon = 1e-6;

        while (totalDistance < (maxPathLength - epsilon)) {
            let bestMove = null;

            this.forEachOutgoingTraversal(currentNode, {
                traversalOptions: outgoingTraversalOptions,
                includeBlocked: false
            }, (traversal) => {
                const neighborNode = traversal && traversal.toNode;
                if (!neighborNode) return;
                const step = stepDistance(currentNode, neighborNode);
                if ((totalDistance + step) > (maxPathLength + epsilon)) return;

                const neighborKey = keyFor(neighborNode);
                const reverse = !!(previousNode && neighborNode === previousNode);
                const revisited = visited.has(neighborKey);
                const neighborThreatDistance = threatDistance(neighborNode);
                const retreatGain = neighborThreatDistance - currentThreatDistance;
                const clearanceScore = Number.isFinite(neighborNode.clearance) ? neighborNode.clearance : 0;
                const moveScore = {
                    traversal,
                    neighborNode,
                    neighborKey,
                    step,
                    retreatGain,
                    threatDistance: neighborThreatDistance,
                    clearanceScore,
                    reverse,
                    revisited
                };

                if (
                    !bestMove ||
                    moveScore.retreatGain > bestMove.retreatGain + epsilon ||
                    (
                        Math.abs(moveScore.retreatGain - bestMove.retreatGain) <= epsilon &&
                        (
                            moveScore.threatDistance > bestMove.threatDistance + epsilon ||
                            (
                                Math.abs(moveScore.threatDistance - bestMove.threatDistance) <= epsilon &&
                                (
                                    moveScore.clearanceScore > bestMove.clearanceScore ||
                                    (
                                        moveScore.clearanceScore === bestMove.clearanceScore &&
                                        (
                                            Number(moveScore.reverse) < Number(bestMove.reverse) ||
                                            (
                                                moveScore.reverse === bestMove.reverse &&
                                                (
                                                    Number(moveScore.revisited) < Number(bestMove.revisited) ||
                                                    (
                                                        moveScore.revisited === bestMove.revisited &&
                                                        moveScore.step < bestMove.step - epsilon
                                                    )
                                                )
                                            )
                                        )
                                    )
                                )
                            )
                        )
                    )
                ) {
                    bestMove = moveScore;
                }
            });

            if (!bestMove) break;

            path.push(this.createTraversalPathItem(bestMove.traversal, options));
            if (collectBlockers) {
                for (let i = 0; i < bestMove.traversal.blockers.length; i++) {
                    const blocker = bestMove.traversal.blockers[i];
                    if (blockersSeen.has(blocker)) continue;
                    blockersSeen.add(blocker);
                    path.blockers.push(blocker);
                }
            }
            totalDistance += bestMove.step;
            previousNode = currentNode;
            currentNode = bestMove.neighborNode;
            currentThreatDistance = bestMove.threatDistance;
            visited.add(bestMove.neighborKey);
        }

        return this.finalizeTraversalPath(startingNode, path, options);
    }

    findRetreatPathAStar(startingNode, threatNodeOrPoint, options = {}) {
        if (!startingNode || !threatNodeOrPoint) return null;

        const requiredClearance = Number.isFinite(options.clearance)
            ? Math.max(0, Math.floor(options.clearance))
            : 0;
        const wallAvoidance = Number.isFinite(options.wallAvoidance)
            ? Math.max(0, options.wallAvoidance)
            : 0;
        const maxPathLength = Number.isFinite(options.maxPathLength)
            ? Math.max(0, Number(options.maxPathLength))
            : NaN;
        const knockableTraversalCost = (typeof options.knockableTraversalCost === "function")
            ? options.knockableTraversalCost
            : null;
        const canTraverseObject = (typeof options.canTraverseObject === "function")
            ? options.canTraverseObject
            : null;
        const canTraverseTerrain = (typeof options.canTraverseTerrain === "function")
            ? options.canTraverseTerrain
            : null;
        const collectBlockers = options.collectBlockers !== false;
        const threatPoint = (
            Number.isFinite(options.threatX) && Number.isFinite(options.threatY)
        )
            ? { x: Number(options.threatX), y: Number(options.threatY) }
            : (
                Number.isFinite(threatNodeOrPoint.x) && Number.isFinite(threatNodeOrPoint.y)
                    ? { x: Number(threatNodeOrPoint.x), y: Number(threatNodeOrPoint.y) }
                    : null
            );

        if (!threatPoint || !Number.isFinite(maxPathLength)) return null;
        if (maxPathLength <= 0) return this.finalizeTraversalPath(startingNode, [], options);

        const keyFor = (node) => this.getNodeKey(node);
        const isBlockingObjectForPath = (obj, context = null) => this._isObjectBlockingForTraversal(obj, canTraverseObject, context);
        const getActiveDirectionalBlockers = (blockers, context = null) => {
            if (!(blockers instanceof Set) || blockers.size === 0) return [];
            const active = [];
            for (const blocker of blockers) {
                if (!blocker || blocker.gone) continue;
                const resolvedBlocker = this._resolveDirectionalTraversalBlocker(
                    blocker,
                    context && context.currentNode,
                    context && context.neighborNode
                );
                if (!resolvedBlocker || resolvedBlocker.gone) continue;
                if (isNonBlockingSunkObject(resolvedBlocker)) continue;
                if (typeof canTraverseObject === "function" && canTraverseObject(resolvedBlocker, context) === true) continue;
                active.push(resolvedBlocker);
            }
            return active;
        };
        const getActiveTileBlockingObjects = (node) => {
            if (!node || !Array.isArray(node.objects) || node.objects.length === 0) return [];
            const blockers = [];
            for (let i = 0; i < node.objects.length; i++) {
                const obj = node.objects[i];
                if (isBlockingObjectForPath(obj, { node, kind: "tile" })) blockers.push(obj);
            }
            return blockers;
        };
        const resolveKnockableTraversal = (blockers, currentNode, neighborNode, directionIndex, kind) => {
            if (!Array.isArray(blockers) || blockers.length === 0) {
                return { allowed: true, penalty: 0, blockers: [] };
            }
            if (typeof knockableTraversalCost !== "function") {
                return { allowed: false, penalty: 0, blockers: [] };
            }
            let penalty = 0;
            const usedBlockers = [];
            for (let i = 0; i < blockers.length; i++) {
                const blocker = blockers[i];
                const extraCost = knockableTraversalCost(blocker, {
                    currentNode,
                    neighborNode,
                    directionIndex,
                    kind,
                    threatPoint
                });
                if (!Number.isFinite(extraCost) || extraCost < 0) {
                    return { allowed: false, penalty: 0, blockers: [] };
                }
                penalty += Number(extraCost);
                usedBlockers.push(blocker);
            }
            return { allowed: true, penalty, blockers: usedBlockers };
        };
        const stepDistance = (fromNode, toNode) => {
            const dx = this.shortestDeltaX(fromNode.x, toNode.x);
            const dy = this.shortestDeltaY(fromNode.y, toNode.y);
            return Math.hypot(dx, dy);
        };
        const movementCost = (fromNode, toNode) => {
            const dist = stepDistance(fromNode, toNode);
            if (wallAvoidance > 0) {
                const cl = Number.isFinite(toNode.clearance) ? toNode.clearance : 0;
                return dist * (1 + wallAvoidance / (1 + cl));
            }
            return dist;
        };
        const threatDistance = (node) => {
            const dx = this.shortestDeltaX(threatPoint.x, node.x);
            const dy = this.shortestDeltaY(threatPoint.y, node.y);
            return Math.hypot(dx, dy);
        };
        const outgoingTraversalOptions = {
            requiredClearance,
            knockableTraversalCost,
            canTraverseObject,
            canTraverseTerrain,
            clearanceReferenceNode: startingNode,
            collectBlockers
        };
        const reconstructPath = (cameFrom, cameFromEdge, currentKey, nodesByKey, blockersByKey) => {
            const result = [];
            let walkKey = currentKey;
            while (cameFrom.has(walkKey)) {
                const edge = cameFromEdge.get(walkKey) || null;
                if (edge) {
                    result.unshift(this.createTraversalPathItem(edge, options));
                } else {
                    const node = nodesByKey.get(walkKey);
                    if (node) result.unshift(node);
                }
                walkKey = cameFrom.get(walkKey);
            }
            const blockers = blockersByKey ? blockersByKey.get(currentKey) : null;
            if (blockers instanceof Set && blockers.size > 0) {
                result.blockers = Array.from(blockers);
            }
            return result;
        };

        const openSet = new Set();
        const openQueue = new MinPriorityQueue();
        const cameFrom = new Map();
        const cameFromEdge = new Map();
        const gScore = new Map();
        const distanceScore = new Map();
        const bestPossibleScore = new Map();
        const nodesByKey = new Map();
        const blockersByKey = collectBlockers ? new Map() : null;
        const epsilon = 1e-6;

        const startKey = keyFor(startingNode);
        const startThreatDistance = threatDistance(startingNode);
        openSet.add(startKey);
        gScore.set(startKey, 0);
        distanceScore.set(startKey, 0);
        const startBestPossible = startThreatDistance + maxPathLength;
        bestPossibleScore.set(startKey, startBestPossible);
        openQueue.push(startKey, -startBestPossible);
        nodesByKey.set(startKey, startingNode);
        if (blockersByKey) {
            blockersByKey.set(startKey, new Set());
        }

        let bestKey = startKey;
        let bestThreatDistance = startThreatDistance;
        let bestTravelDistance = 0;
        let bestTraversalCost = 0;

        const maxIterations = Number.isFinite(options.maxIterations)
            ? Math.max(1, Math.floor(options.maxIterations))
            : Math.max(1000, Math.ceil(maxPathLength * 64));

        let iterations = 0;
        while (!openQueue.isEmpty() && openSet.size > 0 && iterations < maxIterations) {
            iterations += 1;

            let currentKey = null;
            let currentBestPossible = -Infinity;
            while (!openQueue.isEmpty()) {
                const candidate = openQueue.pop();
                if (!candidate) break;
                const candidateKey = candidate.value;
                if (!openSet.has(candidateKey)) continue;
                const liveUpperBound = bestPossibleScore.has(candidateKey) ? bestPossibleScore.get(candidateKey) : -Infinity;
                if ((-candidate.priority) + epsilon < liveUpperBound) continue;
                currentKey = candidateKey;
                currentBestPossible = liveUpperBound;
                break;
            }
            if (!currentKey) break;
            if (currentBestPossible < bestThreatDistance - epsilon) break;

            openSet.delete(currentKey);

            const currentNode = nodesByKey.get(currentKey);
            if (!currentNode) continue;

            const currentThreatDistance = threatDistance(currentNode);
            const currentTravelDistance = distanceScore.has(currentKey) ? distanceScore.get(currentKey) : Infinity;
            const currentTraversalCost = gScore.has(currentKey) ? gScore.get(currentKey) : Infinity;
            if (
                currentThreatDistance > bestThreatDistance + epsilon ||
                (
                    Math.abs(currentThreatDistance - bestThreatDistance) <= epsilon &&
                    (
                        currentTravelDistance < bestTravelDistance - epsilon ||
                        (
                            Math.abs(currentTravelDistance - bestTravelDistance) <= epsilon &&
                            currentTraversalCost < bestTraversalCost - epsilon
                        )
                    )
                )
            ) {
                bestKey = currentKey;
                bestThreatDistance = currentThreatDistance;
                bestTravelDistance = currentTravelDistance;
                bestTraversalCost = currentTraversalCost;
            }

            this.forEachOutgoingTraversal(currentNode, {
                traversalOptions: outgoingTraversalOptions,
                includeBlocked: false
            }, (traversal) => {
                const neighborNode = traversal && traversal.toNode;
                if (!neighborNode) return;

                const neighborKey = keyFor(neighborNode);
                nodesByKey.set(neighborKey, neighborNode);

                const tentativeDistance = currentTravelDistance + stepDistance(currentNode, neighborNode);
                if (tentativeDistance > maxPathLength + epsilon) return;

                const tentativeG = currentTraversalCost + movementCost(currentNode, neighborNode) + traversal.penalty;
                const existingDistance = distanceScore.has(neighborKey) ? distanceScore.get(neighborKey) : Infinity;
                const existingG = gScore.has(neighborKey) ? gScore.get(neighborKey) : Infinity;
                if (tentativeDistance > existingDistance + epsilon) return;
                if (
                    Math.abs(tentativeDistance - existingDistance) <= epsilon &&
                    tentativeG >= existingG - epsilon
                ) {
                    return;
                }

                cameFrom.set(neighborKey, currentKey);
                cameFromEdge.set(neighborKey, traversal);
                distanceScore.set(neighborKey, tentativeDistance);
                gScore.set(neighborKey, tentativeG);
                const neighborThreatDistance = threatDistance(neighborNode);
                bestPossibleScore.set(
                    neighborKey,
                    neighborThreatDistance + Math.max(0, maxPathLength - tentativeDistance)
                );
                openQueue.push(neighborKey, -bestPossibleScore.get(neighborKey));
                if (blockersByKey) {
                    const nextBlockers = new Set(blockersByKey.get(currentKey) || []);
                    for (let i = 0; i < traversal.blockers.length; i++) {
                        nextBlockers.add(traversal.blockers[i]);
                    }
                    blockersByKey.set(neighborKey, nextBlockers);
                }
                openSet.add(neighborKey);

                if (
                    neighborThreatDistance > bestThreatDistance + epsilon ||
                    (
                        Math.abs(neighborThreatDistance - bestThreatDistance) <= epsilon &&
                        (
                            tentativeDistance < bestTravelDistance - epsilon ||
                            (
                                Math.abs(tentativeDistance - bestTravelDistance) <= epsilon &&
                                tentativeG < bestTraversalCost - epsilon
                            )
                        )
                    )
                ) {
                    bestKey = neighborKey;
                    bestThreatDistance = neighborThreatDistance;
                    bestTravelDistance = tentativeDistance;
                    bestTraversalCost = tentativeG;
                }
            });
        }

        return this.finalizeTraversalPath(startingNode, reconstructPath(cameFrom, cameFromEdge, bestKey, nodesByKey, blockersByKey), options);
    }
    
    // Convert world coordinates to the nearest MapNode
    worldToNode(worldX, worldY) {
        const wrappedWorldX = this.wrapWorldX(worldX);
        const wrappedWorldY = this.wrapWorldY(worldY);

        // Reverse the world coordinate calculation to get approximate indices
        const approxX = this.wrapIndexX(Math.round(wrappedWorldX / 0.866));
        const approxY = this.wrapIndexY(Math.round(wrappedWorldY - (approxX % 2 === 0 ? 0.5 : 0)));
        
        // Search nearby nodes to find the closest one
        let best = null;
        let bestDist = Infinity;
        
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                let nx = approxX + dx;
                let ny = approxY + dy;
                if (this.wrapX) nx = this.wrapIndexX(nx);
                if (this.wrapY) ny = this.wrapIndexY(ny);
                if (nx < -1 || nx >= this.width || ny < -1 || ny >= this.height) continue;
                if (!this.nodes[nx] || !this.nodes[nx][ny]) continue;
                
                const node = this.nodes[nx][ny];
                const dist = Math.hypot(
                    this.shortestDeltaX(node.x, wrappedWorldX),
                    this.shortestDeltaY(node.y, wrappedWorldY)
                );
                if (dist < bestDist) {
                    bestDist = dist;
                    best = node;
                }
            }
        }
        
        return best;
    }

    // Like worldToNode but layer-aware for oblique-projection inputs.
    //
    // screenToWorld() always projects onto the ground plane (z = 0), so the
    // worldY it returns is offset by -baseZ relative to any upper floor.
    // This method corrects for that: for each registered floor fragment it
    // adds fragment.baseZ to the incoming worldY before the polygon test, then
    // returns the closest node in the first (topmost-level) fragment that
    // contains the projected point.  Falls back to worldToNode when no
    // fragment matches (i.e. the click is on the ground).
    //
    // Use this anywhere you want to map a raw screen click to the correct
    // floor node regardless of which floor the player is targeting.
    screenWorldToNode(worldX, worldY) {
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const wx = typeof this.wrapWorldX === "function" ? this.wrapWorldX(worldX) : worldX;
        const wy = typeof this.wrapWorldY === "function" ? this.wrapWorldY(worldY) : worldY;
        if (this.floorsById instanceof Map && this.floorsById.size > 0) {
            const sorted = Array.from(this.floorsById.values())
                .filter(f => f && Array.isArray(f.outerPolygon) && f.outerPolygon.length >= 3 && f._floorEditEmpty !== true)
                .sort((a, b) => (Number(b.level) || 0) - (Number(a.level) || 0));
            for (let fi = 0; fi < sorted.length; fi++) {
                const fragment = sorted[fi];
                const baseZ = Number.isFinite(fragment.nodeBaseZ) ? Number(fragment.nodeBaseZ)
                    : (Number.isFinite(fragment.baseZ) ? Number(fragment.baseZ) : 0);
                const projY = wy + baseZ;
                if (!pointInPolygon2D(wx, projY, fragment.outerPolygon)) continue;
                const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
                let inHole = false;
                for (let hi = 0; hi < holes.length; hi++) {
                    if (Array.isArray(holes[hi]) && holes[hi].length >= 3 && pointInPolygon2D(wx, projY, holes[hi])) {
                        inHole = true;
                        break;
                    }
                }
                if (inHole) continue;
                const nodes = this.floorNodesById instanceof Map
                    ? (this.floorNodesById.get(fragment.fragmentId) || [])
                    : [];
                let best = null;
                let bestDist = Infinity;
                for (let ni = 0; ni < nodes.length; ni++) {
                    const n = nodes[ni];
                    if (!n) continue;
                    const dx = n.x - wx;
                    const dy = n.y - projY;
                    const dist = dx * dx + dy * dy;
                    if (dist < bestDist) { bestDist = dist; best = n; }
                }
                if (best) return best;
            }
        }
        return this.worldToNode(wx, wy);
    }

    worldToNodeOrMidpoint(worldX, worldY) {
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        const wrappedWorldX = this.wrapWorldX(worldX);
        const wrappedWorldY = this.wrapWorldY(worldY);
        const node = this.worldToNode(wrappedWorldX, wrappedWorldY);
        if (!node) return null;

        const nodeDist = Math.hypot(
            this.shortestDeltaX(node.x, wrappedWorldX),
            this.shortestDeltaY(node.y, wrappedWorldY)
        );

        const midpointDirections = [1, 3, 5, 7, 9, 11];
        let bestMidpoint = null;
        let bestMidpointDist = Infinity;
        const seenPairs = new Set();
        for (let i = 0; i < midpointDirections.length; i++) {
            const dir = midpointDirections[i];
            const neighbor = node.neighbors[dir];
            if (!neighbor || typeof neighbor.xindex !== "number" || typeof neighbor.yindex !== "number") continue;
            const ax = Math.min(node.xindex, neighbor.xindex);
            const ay = Math.min(node.yindex, neighbor.yindex);
            const bx = Math.max(node.xindex, neighbor.xindex);
            const by = Math.max(node.yindex, neighbor.yindex);
            const pairKey = `${ax},${ay}|${bx},${by}`;
            if (seenPairs.has(pairKey)) continue;
            seenPairs.add(pairKey);

            const midpoint = makeMidpoint(node, neighbor);
            if (!midpoint) continue;
            const midDist = Math.hypot(
                this.shortestDeltaX(midpoint.x, wrappedWorldX),
                this.shortestDeltaY(midpoint.y, wrappedWorldY)
            );
            if (midDist < bestMidpointDist) {
                bestMidpointDist = midDist;
                bestMidpoint = midpoint;
            }
        }

        if (bestMidpoint && bestMidpointDist < nodeDist) {
            return bestMidpoint;
        }
        return node;
    }

    _isNodeMidpoint(entity) {
        return !!(entity && entity.nodeA && entity.nodeB && entity.k !== undefined);
    }

    _resolveHexLineEndpoint(entity) {
        if (!entity) return null;
        if (entity instanceof MapNode) return entity;
        if (this._isNodeMidpoint(entity)) return entity;
        if (Number.isFinite(entity.x) && Number.isFinite(entity.y)) {
            return this.worldToNodeOrMidpoint(entity.x, entity.y);
        }
        return null;
    }

    _hexEntitiesMatch(a, b, eps = 1e-6) {
        if (!a || !b) return false;
        return (
            Math.abs(this.shortestDeltaX(a.x, b.x)) <= eps &&
            Math.abs(this.shortestDeltaY(a.y, b.y)) <= eps
        );
    }

    _chooseMidpointBridgeNode(midpoint, towardEntity) {
        if (!this._isNodeMidpoint(midpoint)) return null;
        const candidates = [midpoint.nodeA, midpoint.nodeB];
        const tx = Number(towardEntity && towardEntity.x);
        const ty = Number(towardEntity && towardEntity.y);
        let bestNode = null;
        let bestDist = Infinity;
        for (let i = 0; i < candidates.length; i++) {
            const node = candidates[i];
            if (!node || typeof node.xindex !== "number") continue;
            const dist = Number.isFinite(tx) && Number.isFinite(ty)
                ? Math.hypot(this.shortestDeltaX(node.x, tx), this.shortestDeltaY(node.y, ty))
                : i;
            if (dist < bestDist) {
                bestDist = dist;
                bestNode = node;
            }
        }
        return bestNode;
    }

    _normalizeHexDirection(direction) {
        return ((Math.round(Number(direction)) % 12) + 12) % 12;
    }

    _getAdjacentHexDirections() {
        return [1, 3, 5, 7, 9, 11];
    }

    _findAdjacentDirectionBetween(nodeA, nodeB) {
        if (!nodeA || !nodeB || !Array.isArray(nodeA.neighbors)) return null;
        const dirs = this._getAdjacentHexDirections();
        for (let i = 0; i < dirs.length; i++) {
            const dir = dirs[i];
            if (nodeA.neighbors[dir] === nodeB) return dir;
        }
        return null;
    }

    _isAdjacentHexNeighbor(nodeA, nodeB) {
        return Number.isFinite(this._findAdjacentDirectionBetween(nodeA, nodeB));
    }

    _getSingleHexLineNodesAdjacent(nodeA, nodeB) {
        if (!nodeA || !nodeB) return [];
        let current = this.worldToNode(nodeA.x, nodeA.y);
        const target = this.worldToNode(nodeB.x, nodeB.y);
        if (!current || !target) return [];
        if (current === target) return [current];

        const path = [current];
        const dirs = this._getAdjacentHexDirections();
        const maxSteps = Math.max(16, (this.width + this.height) * 4);

        for (let step = 0; step < maxSteps; step++) {
            if (current === target) break;
            let bestNext = null;
            let bestDist = Infinity;
            const prev = path.length > 1 ? path[path.length - 2] : null;

            for (let i = 0; i < dirs.length; i++) {
                const dir = dirs[i];
                const candidate = current.neighbors[dir];
                if (!candidate) continue;
                if (prev && candidate === prev) continue;
                const dist = Math.hypot(
                    this.shortestDeltaX(candidate.x, target.x),
                    this.shortestDeltaY(candidate.y, target.y)
                );
                if (dist < bestDist) {
                    bestDist = dist;
                    bestNext = candidate;
                }
            }

            if (!bestNext && prev) {
                // Dead-end fallback: allow one backtrack if no forward-adjacent step exists.
                bestNext = prev;
            }
            if (!bestNext) break;

            path.push(bestNext);
            if (bestNext === target) break;
            current = bestNext;
        }

        return path;
    }

    _getMidpointDirectionBase(midpoint) {
        if (!this._isNodeMidpoint(midpoint) || !midpoint.nodeA || !midpoint.nodeB) return null;
        const dx = this.shortestDeltaX(midpoint.nodeA.x, midpoint.nodeB.x);
        const dy = this.shortestDeltaY(midpoint.nodeA.y, midpoint.nodeB.y);
        const axisDirection = this._normalizeHexDirection(this.getHexDirection(dx, dy));
        const axisClass = ((axisDirection % 6) + 6) % 6;
        if (axisClass !== 1 && axisClass !== 3 && axisClass !== 5) return null;
        return axisClass;
    }

    _midpointSupportsDirection(midpoint, direction) {
        const base = this._getMidpointDirectionBase(midpoint);
        if (!Number.isFinite(base)) return false;
        const dir = this._normalizeHexDirection(direction);
        return ((dir - base + 12) % 3) === 0;
    }

    getHexDirection(x, y) {
        if (x === 0 && y === 0) return 0;
        const angle = Math.atan2(-y, x) * (180 / Math.PI);
        let direction = Math.round((180 - angle) / 30);
        if (direction < 0) direction += 12;
        return direction % 12;
    }

    getHexLine(nodeA, nodeB, width = 0) {
        const start = this._resolveHexLineEndpoint(nodeA);
        const end = this._resolveHexLineEndpoint(nodeB);
        if (!start || !end) return [];
        if (this._hexEntitiesMatch(start, end)) return [start];

        // Get the center line first
        if (width == 0 || this._isNodeMidpoint(start) || this._isNodeMidpoint(end)) {
            return this._getSingleHexLine(start, end);
        }

        const nodeStart = start;
        const nodeEnd = end;
        const centerLine = this._getSingleHexLineNodesAdjacent(nodeStart, nodeEnd);
        if (!Array.isArray(centerLine) || centerLine.length === 0) {
            return this._getSingleHexLine(nodeStart, nodeEnd);
        }

        const startNodes = new Set(centerLine);
        let allNodes = new Set(startNodes);
        if (width <= 1) {
            return Array.from(allNodes);
        }

        if (width == 2) {
            const adjacentDirs = this._getAdjacentHexDirections();
            const sideNodes = [];
            let sideTurn = 1; // pick a consistent side of travel.
            if (centerLine.length >= 2) {
                const firstDir = this._findAdjacentDirectionBetween(centerLine[0], centerLine[1]);
                const secondDir = (centerLine.length >= 3)
                    ? this._findAdjacentDirectionBetween(centerLine[1], centerLine[2])
                    : null;
                if (Number.isFinite(firstDir) && Number.isFinite(secondDir)) {
                    const i0 = adjacentDirs.indexOf(firstDir);
                    const i1 = adjacentDirs.indexOf(secondDir);
                    if (i0 >= 0 && i1 >= 0) {
                        const delta = (i1 - i0 + adjacentDirs.length) % adjacentDirs.length;
                        if (delta === 1) sideTurn = -1;
                        else if (delta === adjacentDirs.length - 1) sideTurn = 1;
                    }
                }
            }

            for (let i = 0; i < centerLine.length; i++) {
                const current = centerLine[i];
                const next = centerLine[i + 1] || null;
                const prev = centerLine[i - 1] || null;
                const travelDir = this._findAdjacentDirectionBetween(current, next)
                    || (prev ? this._findAdjacentDirectionBetween(prev, current) : null);
                if (!Number.isFinite(travelDir)) continue;
                const dirIdx = adjacentDirs.indexOf(travelDir);
                if (dirIdx < 0) continue;
                const sideDir = adjacentDirs[(dirIdx + sideTurn + adjacentDirs.length) % adjacentDirs.length];
                const sideNode = current.neighbors[sideDir];
                if (sideNode) sideNodes.push(sideNode);
            }

            let prevSideNode = null;
            for (let i = 0; i < sideNodes.length; i++) {
                const sideNode = sideNodes[i];
                if (!sideNode) continue;
                allNodes.add(sideNode);
                if (prevSideNode && !this._isAdjacentHexNeighbor(prevSideNode, sideNode)) {
                    const bridge = this._getSingleHexLineNodesAdjacent(prevSideNode, sideNode);
                    for (let b = 0; b < bridge.length; b++) {
                        const bridgeNode = bridge[b];
                        if (bridgeNode) allNodes.add(bridgeNode);
                    }
                }
                prevSideNode = sideNode;
            }

            return Array.from(allNodes);
        }

        let sideLineStarts = [];
        if (width == 3) {
            sideLineStarts.push(1);
            sideLineStarts.push(3);
            sideLineStarts.push(5);
            sideLineStarts.push(7);
            sideLineStarts.push(9);
            sideLineStarts.push(11);
        }
        for (let node of startNodes) {
            if (!node || !Array.isArray(node.neighbors)) continue;
            for (let sideStart of sideLineStarts) {
                const sideNode = node.neighbors[sideStart];
                if (sideNode) allNodes.add(sideNode);
            }
        }
        // sideLineStarts.forEach(sideStart => {
        //     // allNodes.add(nodeA.neighbors[(direction + sideStart) % 12])
        //     // allNodes.add(nodeB.neighbors[(direction +sideStart) % 12])
        //     if (sideStart) {
        //         const sideLine = this._getSingleHexLine(
        //             nodeA.neighbors[(direction + sideStart) % 12], 
        //             nodeB.neighbors[(direction + sideStart) % 12]
        //         );
        //         sideLine.forEach(n => allNodes.add(n));
        //     }
        // })
        
        return Array.from(allNodes);
    }
    
    _getSingleHexLine(nodeA, nodeB) {
        if (!nodeA || !nodeB) return [];
        const start = this._resolveHexLineEndpoint(nodeA);
        const end = this._resolveHexLineEndpoint(nodeB);
        if (!start || !end) return [];
        if (this._hexEntitiesMatch(start, end)) return [start];

        const path = [];
        let startNode = start;
        let endNode = end;

        if (this._isNodeMidpoint(start)) {
            path.push(start);
            startNode = this._chooseMidpointBridgeNode(start, end);
        }
        if (this._isNodeMidpoint(end)) {
            endNode = this._chooseMidpointBridgeNode(end, start);
        }
        if (!startNode || !endNode) return path;

        const corePath = this._getSingleHexLineNodes(startNode, endNode);
        for (let i = 0; i < corePath.length; i++) {
            if (!path.length || !this._hexEntitiesMatch(path[path.length - 1], corePath[i])) {
                path.push(corePath[i]);
            }
        }

        if (this._isNodeMidpoint(end)) {
            if (!path.length || !this._hexEntitiesMatch(path[path.length - 1], end)) {
                path.push(end);
            }
        }

        return path;
    }

    _getSingleHexLineNodes(nodeA, nodeB) {
        if (!nodeA || !nodeB) return [];
        let current = this.worldToNode(nodeA.x, nodeA.y);
        const target = this.worldToNode(nodeB.x, nodeB.y);
        if (!current || !target) return [];
        if (current === target) return [current];
        const path = [current];
        const maxSteps = (mapWidth + mapHeight) * 2;

        for (let step = 0; step < maxSteps; step++) {
            if (current === target) break;
            let nextDirection = this.getHexDirection(
                this.shortestDeltaX(current.x, target.x),
                this.shortestDeltaY(current.y, target.y)
            );
            const next = current.neighbors[nextDirection % 12];
            if (!next) break;
            path.push(next);
            
            if (next === target) break;
            current = next;
        }

        return path;
    }

    /**
     * Returns true when there is an unobstructed hex path (adjacent steps only)
     * between nodeA and nodeB.  Checks every intermediate node for blockage and
     * every connection for wall blockage via blockedNeighbors.
     *
     * This is intentionally a greedy walk so it is O(steps) with no allocations.
     *
     * @param {MapNode} nodeA  Starting node.
     * @param {MapNode} nodeB  Destination node.
     * @returns {boolean}  True if LOS is clear.
     */
    hasLineOfSight(nodeA, nodeB) {
        if (!nodeA || !nodeB) return true;
        if (nodeA === nodeB) return true;

        // Adjacent direction indices (odd = one-step hex neighbours).
        const adjDirs = [1, 3, 5, 7, 9, 11];
        const maxSteps = Math.max(16, (this.width + this.height) * 2);

        let current = nodeA;
        for (let step = 0; step < maxSteps; step++) {
            if (current === nodeB) return true;

            // Greedy step: choose the adjacent neighbour that minimises distance to nodeB.
            let bestNext = null;
            let bestDir  = -1;
            let bestDist = Infinity;
            for (let i = 0; i < adjDirs.length; i++) {
                const dir       = adjDirs[i];
                const candidate = current.neighbors[dir];
                if (!candidate) continue;
                const dist = Math.hypot(
                    this.shortestDeltaX(candidate.x, nodeB.x),
                    this.shortestDeltaY(candidate.y, nodeB.y)
                );
                if (dist < bestDist) {
                    bestDist = dist;
                    bestNext = candidate;
                    bestDir  = dir;
                }
            }

            if (!bestNext) return false; // no reachable neighbour

            // Wall blocking on this edge.
            const blockingWalls = current.blockedNeighbors
                ? current.blockedNeighbors.get(bestDir)
                : null;
            if (hasActiveDirectionalBlockers(blockingWalls)) return false;

            // Blocking object / terrain on the next tile (skip endpoints).
            if (bestNext !== nodeB && bestNext.isBlocked()) return false;

            current = bestNext;
        }

        return current === nodeB;
    }

    getGroundTerrainNodeByCoord(x, y) {
        const tx = this.wrapX ? this.wrapIndexX(x) : x;
        const ty = this.wrapY ? this.wrapIndexY(y) : y;
        const state = this._prototypeSectionState || null;
        const coordKey = `${Math.round(Number(tx))},${Math.round(Number(ty))}`;
        const sparseNode = state && state.allNodesByCoordKey instanceof Map
            ? (state.allNodesByCoordKey.get(coordKey) || null)
            : null;
        if (sparseNode) return sparseNode;
        return this.nodes[tx] && this.nodes[tx][ty] ? this.nodes[tx][ty] : null;
    }

    getGroundTextureId(x, y) {
        const node = this.getGroundTerrainNodeByCoord(x, y);
        if (!node) return 0;
        return Number.isFinite(node.groundTextureId) ? node.groundTextureId : 0;
    }

    getGroundTerrainIdCount() {
        return GROUND_TERRAIN_ID_COUNT;
    }

    getGroundTerrainDefs() {
        return GROUND_TERRAIN_DEFS_WITH_OFFSETS.map(cloneGroundTerrainDefForUi);
    }

    getGroundTerrainDef(textureId) {
        return cloneGroundTerrainDefForUi(getGroundTerrainDefForTextureId(textureId));
    }

    getGroundTerrainTextureIdForType(typeName, x = 0, y = 0) {
        const name = (typeof typeName === "string" && typeName.length > 0) ? typeName : "grass";
        const def = GROUND_TERRAIN_DEFS_WITH_OFFSETS.find(entry => entry.name === name);
        if (!def) {
            throw new Error(`unknown ground terrain type "${name}"`);
        }
        if (def.name === "grass") {
            return Math.abs(((Math.floor(Number(x) || 0) * 73856093) ^ (Math.floor(Number(y) || 0) * 19349663))) % FOREST_GROUND_BASE_COUNT;
        }
        return def.idStart;
    }

    getGroundPolygonMaterialPathForType(typeName) {
        const name = (typeof typeName === "string" && typeName.length > 0) ? typeName : "grass";
        const def = GROUND_TERRAIN_DEFS_WITH_OFFSETS.find(entry => entry.name === name);
        if (!def) {
            throw new Error(`unknown ground terrain type "${name}"`);
        }
        if (typeof def.polygonMaterial !== "string" || def.polygonMaterial.length === 0) {
            throw new Error(`missing polygon material for ground terrain type "${name}"`);
        }
        return def.polygonMaterial;
    }

    getGroundPolygonMaterialScaleForType(typeName) {
        const name = (typeof typeName === "string" && typeName.length > 0) ? typeName : "grass";
        const def = GROUND_TERRAIN_DEFS_WITH_OFFSETS.find(entry => entry.name === name);
        if (!def) {
            throw new Error(`unknown ground terrain type "${name}"`);
        }
        const scale = Number(def.polygonMaterialScale);
        if (!Number.isFinite(scale) || !(scale > 0)) {
            throw new Error(`invalid polygon material scale for ground terrain type "${name}"`);
        }
        return scale;
    }

    getGroundTextureForNode(node) {
        const textureIndex = resolveGroundTerrainTextureIndexForNode(node);
        const texture = Array.isArray(this.groundTextures) ? this.groundTextures[textureIndex] : null;
        if (!texture) {
            throw new Error(`missing ground terrain texture at palette index ${textureIndex}`);
        }
        return texture;
    }

    getGroundTerrainTypeForNode(node) {
        return getGroundTerrainDefForTextureId(Number.isFinite(node && node.groundTextureId) ? Math.floor(Number(node.groundTextureId)) : 0).name;
    }

    getGroundTerrainHexCorners(node) {
        const x = Number(node && node.x);
        const y = Number(node && node.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error("terrain polygon generation requires finite node coordinates");
        }
        const w = Number.isFinite(this.hexWidth) ? Number(this.hexWidth) : (1 / 0.866);
        const h = Number.isFinite(this.hexHeight) ? Number(this.hexHeight) : 1;
        return [
            { x: x - w * 0.5, y },
            { x: x - w * 0.25, y: y - h * 0.5 },
            { x: x + w * 0.25, y: y - h * 0.5 },
            { x: x + w * 0.5, y },
            { x: x + w * 0.25, y: y + h * 0.5 },
            { x: x - w * 0.25, y: y + h * 0.5 }
        ];
    }

    getGroundTerrainNodeKey(node) {
        return `${Math.floor(Number(node && node.xindex) || 0)},${Math.floor(Number(node && node.yindex) || 0)}`;
    }

    getGroundTerrainPointKey(point) {
        const q = 1000000;
        return `${Math.round(Number(point && point.x) * q)},${Math.round(Number(point && point.y) * q)}`;
    }

    simplifyGroundTerrainPolygonPoints(points) {
        if (!Array.isArray(points)) return [];
        const out = [];
        for (let i = 0; i < points.length; i++) {
            const x = Number(points[i] && points[i].x);
            const y = Number(points[i] && points[i].y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                throw new Error("terrain polygon contains a non-finite point");
            }
            const prev = out[out.length - 1];
            if (prev && Math.abs(prev.x - x) < 1e-7 && Math.abs(prev.y - y) < 1e-7) continue;
            out.push({ x, y });
        }
        if (out.length > 1) {
            const first = out[0];
            const last = out[out.length - 1];
            if (Math.abs(first.x - last.x) < 1e-7 && Math.abs(first.y - last.y) < 1e-7) out.pop();
        }
        let changed = true;
        while (changed && out.length > 3) {
            changed = false;
            for (let i = 0; i < out.length; i++) {
                const prev = out[(i + out.length - 1) % out.length];
                const cur = out[i];
                const next = out[(i + 1) % out.length];
                const ax = cur.x - prev.x;
                const ay = cur.y - prev.y;
                const bx = next.x - cur.x;
                const by = next.y - cur.y;
                if (Math.abs(ax * by - ay * bx) < 1e-7) {
                    out.splice(i, 1);
                    changed = true;
                    break;
                }
            }
        }
        return out;
    }

    getGroundTerrainNodeAtCoord(xindex, yindex) {
        if (typeof this.getGroundTerrainNodeByCoord === "function") {
            return this.getGroundTerrainNodeByCoord(xindex, yindex) || null;
        }
        if (typeof this.getGroundNodeForCoord === "function") {
            return this.getGroundNodeForCoord(xindex, yindex) || null;
        }
        if (typeof this.getNode === "function") {
            return this.getNode(xindex, yindex, 0) || null;
        }
        return null;
    }

    getGroundTerrainNeighborSlotKey(node, direction) {
        if (!node) return "";
        const neighbor = node.neighbors && node.neighbors[direction];
        if (neighbor) return this.getGroundTerrainNodeKey(neighbor);
        const offset = node.neighborOffsets && node.neighborOffsets[direction];
        if (offset && Number.isFinite(offset.x) && Number.isFinite(offset.y)) {
            const xindex = Number(node.xindex) + Number(offset.x);
            const yindex = Number(node.yindex) + Number(offset.y);
            const resolved = this.getGroundTerrainNodeAtCoord(xindex, yindex);
            if (resolved) return this.getGroundTerrainNodeKey(resolved);
            return `${Math.floor(xindex)},${Math.floor(yindex)}`;
        }
        return `missing:${this.getGroundTerrainNodeKey(node)}:${direction}`;
    }

    buildGroundTerrainVertexSlotMap(group) {
        const nodes = Array.isArray(group && group.nodes) ? group.nodes : [];
        const dirs = [1, 3, 5, 7, 9, 11];
        const out = new Map();
        for (let n = 0; n < nodes.length; n++) {
            const node = nodes[n];
            if (!node) continue;
            const nodeKey = this.getGroundTerrainNodeKey(node);
            const corners = this.getGroundTerrainHexCorners(node);
            for (let c = 0; c < corners.length; c++) {
                const pointKey = this.getGroundTerrainPointKey(corners[c]);
                let slots = out.get(pointKey);
                if (!slots) {
                    slots = new Set();
                    out.set(pointKey, slots);
                }
                slots.add(nodeKey);
                slots.add(this.getGroundTerrainNeighborSlotKey(node, dirs[(c + 5) % 6]));
                slots.add(this.getGroundTerrainNeighborSlotKey(node, dirs[c]));
            }
        }
        return out;
    }

    smoothGroundTerrainPolygonPoints(points, group, options = {}) {
        const simplified = this.simplifyGroundTerrainPolygonPoints(points);
        if (simplified.length < 3) return simplified;
        const nodeKeys = group && group.nodeKeys instanceof Set ? group.nodeKeys : new Set();
        const vertexSlotsByPointKey = this.buildGroundTerrainVertexSlotMap(group);
        const nodesByKey = new Map();
        const groupNodes = Array.isArray(group && group.nodes) ? group.nodes : [];
        for (let n = 0; n < groupNodes.length; n++) {
            const node = groupNodes[n];
            if (!node) continue;
            nodesByKey.set(this.getGroundTerrainNodeKey(node), node);
        }
        const pointRecords = simplified.map(point => {
            const slots = this.getGroundTerrainPointSlots(point, vertexSlotsByPointKey);
            if (!(slots instanceof Set)) {
                throw new Error("terrain polygon smoothing could not resolve touching hex slots for boundary vertex");
            }
            if (slots.size !== 3) {
                throw new Error(`terrain polygon smoothing expected 3 touching hex slots, found ${slots.size}`);
            }
            const stats = this.getGroundTerrainBoundaryKeepNonGroupCount(
                group && group.type ? group.type : "grass",
                slots,
                nodesByKey,
                options
            );
            return {
                point,
                nonGroupCount: stats.nonGroupCount,
                keepNonGroupCount: stats.keepNonGroupCount,
                forcedNonGroupCount: 3 - stats.keepNonGroupCount,
                priorityAdjusted: stats.higherPriorityNeighbor,
                baseKeep: stats.nonGroupCount === stats.keepNonGroupCount
            };
        });
        const forcedPointsByRunStart = new Map();
        const getPointRecordSlots = (record) => {
            if (!record) return null;
            const pointKey = this.getGroundTerrainPointKey(record.point);
            const slots = vertexSlotsByPointKey.get(pointKey);
            if (!(slots instanceof Set)) {
                throw new Error("terrain polygon smoothing could not resolve skipped vertex slots");
            }
            return slots;
        };
        const resolveTerrainSlotCenter = (slotKey) => {
            const existingNode = nodesByKey.get(slotKey);
            if (existingNode) {
                const x = Number(existingNode.x);
                const y = Number(existingNode.y);
                return (Number.isFinite(x) && Number.isFinite(y)) ? { x, y } : null;
            }
            const match = /^(-?\d+),(-?\d+)$/.exec(String(slotKey || ""));
            if (!match) return null;
            const xindex = Number(match[1]);
            const yindex = Number(match[2]);
            const resolvedNode = this.getGroundTerrainNodeAtCoord(xindex, yindex);
            if (resolvedNode) {
                nodesByKey.set(slotKey, resolvedNode);
                const x = Number(resolvedNode.x);
                const y = Number(resolvedNode.y);
                return (Number.isFinite(x) && Number.isFinite(y)) ? { x, y } : null;
            }
            return {
                x: xindex * 0.866,
                y: yindex + (xindex % 2 === 0 ? 0.5 : 0)
            };
        };
        const groupType = group && group.type ? group.type : "grass";
        const slotMatchesSkippedRunCenterSide = (slotKey, record) => {
            const slotType = this.getGroundTerrainTypeForSlotKey(slotKey, nodesByKey);
            const slotIsGroup = slotType === groupType;
            const useGroupSide = Number(record && record.forcedNonGroupCount) >= 2;
            return useGroupSide ? slotIsGroup : !slotIsGroup;
        };
        const getSkippedRunHexCenter = (runStart, runLength) => {
            const count = pointRecords.length;
            const slotCounts = new Map();
            let xSum = 0;
            let ySum = 0;
            for (let r = 0; r < runLength; r++) {
                const record = pointRecords[(runStart + r) % count];
                const point = record && record.point;
                xSum += Number(point && point.x);
                ySum += Number(point && point.y);
                const slots = getPointRecordSlots(record);
                for (const slotKey of slots) {
                    if (!slotMatchesSkippedRunCenterSide(slotKey, record)) continue;
                    if (!resolveTerrainSlotCenter(slotKey)) continue;
                    slotCounts.set(slotKey, (slotCounts.get(slotKey) || 0) + 1);
                }
            }
            if (slotCounts.size === 0) {
                throw new Error("terrain polygon smoothing could not resolve a forced hex center for skipped vertices");
            }
            const centroid = { x: xSum / runLength, y: ySum / runLength };
            let bestKey = "";
            let bestCount = -1;
            let bestDistance = Infinity;
            for (const [slotKey, slotCount] of slotCounts.entries()) {
                const center = resolveTerrainSlotCenter(slotKey);
                if (!center) continue;
                const distance = Math.hypot(center.x - centroid.x, center.y - centroid.y);
                if (
                    slotCount > bestCount ||
                    (slotCount === bestCount && distance < bestDistance)
                ) {
                    bestKey = slotKey;
                    bestCount = slotCount;
                    bestDistance = distance;
                }
            }
            if (!bestKey) {
                throw new Error("terrain polygon smoothing resolved skipped-run hex candidates without finite centers");
            }
            const center = resolveTerrainSlotCenter(bestKey);
            if (!center) {
                throw new Error("terrain polygon smoothing resolved a skipped-run hex center without finite coordinates");
            }
            return center;
        };
        const isForcedCandidate = (record) => !!(
            record &&
            record.baseKeep === false &&
            record.nonGroupCount === record.forcedNonGroupCount
        );
        const addForcedRunPoint = (runStart, runLength) => {
            if (runLength < 3) return;
            const count = pointRecords.length;
            if (runLength === 3) {
                forcedPointsByRunStart.set(runStart, getSkippedRunHexCenter(runStart, 3));
                return;
            }
            if (runLength === 4) {
                for (let windowStart = 0; windowStart <= 1; windowStart++) {
                    let xSum = 0;
                    let ySum = 0;
                    for (let r = 0; r < 3; r++) {
                        const point = pointRecords[(runStart + windowStart + r) % count].point;
                        xSum += Number(point.x);
                        ySum += Number(point.y);
                    }
                    forcedPointsByRunStart.set((runStart + windowStart) % count, {
                        x: xSum / 3,
                        y: ySum / 3
                    });
                }
                return;
            }
            let xSum = 0;
            let ySum = 0;
            for (let r = 0; r < runLength; r++) {
                const point = pointRecords[(runStart + r) % count].point;
                xSum += Number(point.x);
                ySum += Number(point.y);
            }
            forcedPointsByRunStart.set(runStart, {
                x: xSum / runLength,
                y: ySum / runLength
            });
        };
        if (pointRecords.length >= 3) {
            const count = pointRecords.length;
            const startIndex = pointRecords.findIndex(record => !isForcedCandidate(record));
            if (startIndex >= 0) {
                let runStart = -1;
                let runLength = 0;
                for (let step = 1; step <= count; step++) {
                    const index = (startIndex + step) % count;
                    if (isForcedCandidate(pointRecords[index])) {
                        if (runStart < 0) runStart = index;
                        runLength += 1;
                    } else if (runStart >= 0) {
                        addForcedRunPoint(runStart, runLength);
                        runStart = -1;
                        runLength = 0;
                    }
                }
            }
        }
        const kept = [];
        for (let p = 0; p < pointRecords.length; p++) {
            if (forcedPointsByRunStart.has(p)) kept.push(forcedPointsByRunStart.get(p));
            if (pointRecords[p].baseKeep) kept.push(pointRecords[p].point);
        }
        const out = this.simplifyGroundTerrainPolygonPoints(kept);
        if (out.length < 3 && pointRecords.some(record => record && record.priorityAdjusted === true)) {
            return simplified;
        }
        if (out.length < 3) {
            throw new Error(`terrain polygon smoothing produced fewer than three vertices for ${group && group.type ? group.type : "unknown"} terrain`);
        }
        return out;
    }

    normalizeGroundTerrainPolygons(polygons) {
        if (!Array.isArray(polygons)) return [];
        return polygons.map((polygon, index) => {
            const type = polygon && typeof polygon.type === "string" && polygon.type.length > 0
                ? polygon.type
                : "";
            if (!type) {
                throw new Error(`terrain polygon ${index} is missing a terrain type`);
            }
            this.getGroundTerrainTextureIdForType(type);
            const points = this.simplifyGroundTerrainPolygonPoints(polygon.points);
            if (points.length < 3) {
                throw new Error(`terrain polygon ${index} for ${type} has fewer than three points`);
            }
            const holes = Array.isArray(polygon.holes)
                ? polygon.holes.map((hole, holeIndex) => {
                    const holePoints = this.simplifyGroundTerrainPolygonPoints(hole);
                    if (holePoints.length < 3) {
                        throw new Error(`terrain polygon ${index} for ${type} has a hole ${holeIndex} with fewer than three points`);
                    }
                    return holePoints;
                })
                : [];
            return holes.length > 0 ? { type, points, holes } : { type, points };
        });
    }

    getGroundTerrainPolygonTypeAtPoint(x, y, polygons) {
        const normalizedPolygons = this.normalizeGroundTerrainPolygons(polygons);
        let terrainType = "grass";
        for (let p = 0; p < normalizedPolygons.length; p++) {
            const polygon = normalizedPolygons[p];
            if (!pointInPolygon2D(x, y, polygon.points)) continue;
            const holes = Array.isArray(polygon.holes) ? polygon.holes : [];
            let insideHole = false;
            for (let h = 0; h < holes.length; h++) {
                if (pointInPolygon2D(x, y, holes[h])) {
                    insideHole = true;
                    break;
                }
            }
            if (!insideHole) terrainType = polygon.type;
        }
        return terrainType;
    }

    groundTerrainPolygonToClipGeometry(polygon) {
        if (!polygon || typeof polygon.type !== "string" || polygon.type.length === 0) {
            throw new Error("terrain polygon clipping requires a terrain type");
        }
        this.getGroundTerrainTextureIdForType(polygon.type);
        const outerRing = polygonToClipRing2D(polygon.points);
        if (!outerRing) {
            throw new Error(`terrain polygon clipping requires at least three points for ${polygon.type}`);
        }
        const rings = [outerRing];
        const holes = Array.isArray(polygon.holes) ? polygon.holes : [];
        for (let h = 0; h < holes.length; h++) {
            const holeRing = polygonToClipRing2D(holes[h]);
            if (!holeRing) {
                throw new Error(`terrain polygon clipping requires at least three points for ${polygon.type} hole ${h}`);
            }
            rings.push(holeRing);
        }
        return [rings];
    }

    groundTerrainClipGeometryToPolygons(type, geometry) {
        this.getGroundTerrainTextureIdForType(type);
        if (clipGeometryIsEmpty2D(geometry)) return [];
        const out = [];
        for (let p = 0; p < geometry.length; p++) {
            const polygon = geometry[p];
            if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) {
                throw new Error(`terrain polygon clipping produced malformed geometry for ${type}`);
            }
            const points = this.simplifyGroundTerrainPolygonPoints(
                clipRingToPolygonPoints2D(polygon[0], `terrain ${type} clipped ring`)
            );
            if (points.length < 3) {
                throw new Error(`terrain polygon clipping produced fewer than three points for ${type}`);
            }
            const holes = [];
            for (let h = 1; h < polygon.length; h++) {
                const holePoints = this.simplifyGroundTerrainPolygonPoints(
                    clipRingToPolygonPoints2D(polygon[h], `terrain ${type} clipped hole`)
                );
                if (holePoints.length < 3) {
                    throw new Error(`terrain polygon clipping produced a hole with fewer than three points for ${type}`);
                }
                holes.push(holePoints);
            }
            out.push(holes.length > 0 ? { type, points, holes } : { type, points });
        }
        return out;
    }

    getGroundTerrainHexClipGeometry(node) {
        const ring = polygonToClipRing2D(this.getGroundTerrainHexCorners(node));
        if (!ring) {
            throw new Error("terrain local patch requires a valid edited hex");
        }
        return [[ring]];
    }

    unionGroundTerrainClipGeometries(geometries, label = "terrain local patch") {
        const api = getPolygonClippingApi2D();
        if (!api || typeof api.union !== "function") {
            throw new Error(`${label} requires polygon clipping union`);
        }
        const source = Array.isArray(geometries)
            ? geometries.filter(geometry => !clipGeometryIsEmpty2D(geometry))
            : [];
        if (source.length === 0) return [];
        if (source.length === 1) return source[0];
        try {
            return api.union(...source);
        } catch (err) {
            throw new Error(`${label} union failed: ${err && err.message ? err.message : err}`);
        }
    }

    applyGroundTerrainLocalHexOperand(geometry, hexGeometry, include, label = "terrain local patch") {
        const api = getPolygonClippingApi2D();
        if (!api || typeof api.union !== "function" || typeof api.difference !== "function") {
            throw new Error(`${label} requires polygon clipping union and difference`);
        }
        if (include) {
            if (clipGeometryIsEmpty2D(geometry)) return hexGeometry;
            try {
                return api.union(geometry, hexGeometry);
            } catch (err) {
                throw new Error(`${label} union operand failed: ${err && err.message ? err.message : err}`);
            }
        }
        if (clipGeometryIsEmpty2D(geometry)) return [];
        try {
            return api.difference(geometry, hexGeometry);
        } catch (err) {
            throw new Error(`${label} difference operand failed: ${err && err.message ? err.message : err}`);
        }
    }

    groundTerrainRingsTouch(pointsA, pointsB) {
        const a = Array.isArray(pointsA) ? pointsA : [];
        const b = Array.isArray(pointsB) ? pointsB : [];
        if (a.length < 3 || b.length < 3) return false;
        if (!polygonBoundsOverlap2D(getPolygonBounds2D(a), getPolygonBounds2D(b))) return false;
        for (let i = 0; i < a.length; i++) {
            const a0 = a[i];
            const a1 = a[(i + 1) % a.length];
            for (let j = 0; j < b.length; j++) {
                if (segmentsIntersect2D(a0, a1, b[j], b[(j + 1) % b.length])) return true;
            }
        }
        return false;
    }

    groundTerrainPolygonTouchesHex(polygon, hexPoints, hexGeometry) {
        const api = getPolygonClippingApi2D();
        if (!api || typeof api.intersection !== "function") {
            throw new Error("terrain local patch participation requires polygon clipping intersection");
        }
        const geometry = this.groundTerrainPolygonToClipGeometry(polygon);
        try {
            if (!clipGeometryIsEmpty2D(api.intersection(geometry, hexGeometry))) return true;
        } catch (err) {
            throw new Error(`terrain local patch participation failed for ${polygon.type}: ${err && err.message ? err.message : err}`);
        }
        if (this.groundTerrainRingsTouch(polygon.points, hexPoints)) return true;
        const holes = Array.isArray(polygon.holes) ? polygon.holes : [];
        for (let h = 0; h < holes.length; h++) {
            if (this.groundTerrainRingsTouch(holes[h], hexPoints)) return true;
        }
        return false;
    }

    groundTerrainPolygonTouchesAnyPatchHex(polygon, nodes) {
        const patchNodes = Array.isArray(nodes) ? nodes : [];
        for (let i = 0; i < patchNodes.length; i++) {
            const node = patchNodes[i];
            if (!node || node._prototypeVoid === true) continue;
            if (this.groundTerrainPolygonTouchesHex(
                polygon,
                this.getGroundTerrainHexCorners(node),
                this.getGroundTerrainHexClipGeometry(node)
            )) {
                return true;
            }
        }
        return false;
    }

    buildGroundTerrainLocalSmoothingGroup(type, affectedNodes, vertexSlotsByPointKey) {
        const nodeKeys = new Set();
        const nodes = [];
        const addNode = (candidate) => {
            if (!candidate || candidate._prototypeVoid === true) return;
            if (this.getGroundTerrainTypeForNode(candidate) !== type) return;
            const key = this.getGroundTerrainNodeKey(candidate);
            if (nodeKeys.has(key)) return;
            nodeKeys.add(key);
            nodes.push(candidate);
        };
        const sourceNodes = Array.isArray(affectedNodes) ? affectedNodes : [];
        for (let i = 0; i < sourceNodes.length; i++) {
            addNode(sourceNodes[i]);
        }
        if (vertexSlotsByPointKey instanceof Map) {
            for (const slots of vertexSlotsByPointKey.values()) {
                if (!(slots instanceof Set)) continue;
                for (const slotKey of slots) {
                    const match = /^(-?\d+),(-?\d+)$/.exec(String(slotKey || ""));
                    if (!match) continue;
                    addNode(this.getGroundTerrainNodeAtCoord(Number(match[1]), Number(match[2])));
                }
            }
        }
        return { type, nodes, nodeKeys };
    }

    getGroundTerrainEditPriority(typeName) {
        const type = typeof typeName === "string" ? typeName.trim().toLowerCase() : "";
        if (type === "water") return 0;
        if (type === "mud") return 1;
        if (type === "grass") return 2;
        if (type === "desert" || type === "sand") return 3;
        throw new Error(`unknown terrain edit priority for "${typeName}"`);
    }

    getGroundTerrainTypeForSlotKey(slotKey, nodesByKey = null) {
        const key = String(slotKey || "");
        if (nodesByKey instanceof Map && nodesByKey.has(key)) {
            return this.getGroundTerrainTypeForNode(nodesByKey.get(key));
        }
        const match = /^(-?\d+),(-?\d+)$/.exec(key);
        if (match) {
            const node = this.getGroundTerrainNodeAtCoord(Number(match[1]), Number(match[2]));
            if (node) {
                if (nodesByKey instanceof Map) nodesByKey.set(key, node);
                return this.getGroundTerrainTypeForNode(node);
            }
            return "grass";
        }
        if (key.startsWith("missing:")) return "grass";
        throw new Error(`terrain smoothing could not resolve slot terrain for "${key}"`);
    }

    getGroundTerrainBoundarySlotStats(type, slots, nodesByKey = null) {
        if (!(slots instanceof Set)) {
            throw new Error("terrain smoothing boundary stats require vertex slots");
        }
        const groupType = typeof type === "string" && type.length > 0 ? type : "grass";
        const groupPriority = this.getGroundTerrainEditPriority(groupType);
        let groupCount = 0;
        let higherPriorityNeighbor = false;
        const terrainTypes = new Set();
        for (const slotKey of slots) {
            const slotType = this.getGroundTerrainTypeForSlotKey(slotKey, nodesByKey);
            terrainTypes.add(slotType);
            if (slotType === groupType) {
                groupCount += 1;
                continue;
            }
            if (this.getGroundTerrainEditPriority(slotType) > groupPriority) {
                higherPriorityNeighbor = true;
            }
        }
        return {
            groupCount,
            nonGroupCount: 3 - groupCount,
            higherPriorityNeighbor,
            distinctTerrainTypeCount: terrainTypes.size
        };
    }

    getGroundTerrainBoundaryKeepNonGroupCount(type, slots, nodesByKey = null, options = {}) {
        const stats = this.getGroundTerrainBoundarySlotStats(type, slots, nodesByKey);
        const normalKeepNonGroupCount = options && options.isHole === true ? 1 : 2;
        if (stats.distinctTerrainTypeCount >= 3 && stats.groupCount === 1) {
            return {
                ...stats,
                keepNonGroupCount: 2
            };
        }
        return {
            ...stats,
            keepNonGroupCount: stats.higherPriorityNeighbor &&
                !(options && options.isHole === true)
                ? 3 - normalKeepNonGroupCount
                : normalKeepNonGroupCount
        };
    }

    smoothGroundTerrainLocalPatchRingPoints(points, group, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes, options = {}) {
        const simplified = this.simplifyGroundTerrainPolygonPoints(points);
        if (simplified.length < 3) return simplified;
        const nodeKeys = group && group.nodeKeys instanceof Set ? group.nodeKeys : new Set();
        const localVertexSlotsByPointKey = this.buildGroundTerrainVertexSlotMap(group);
        const nodesByKey = new Map();
        const groupNodes = Array.isArray(group && group.nodes) ? group.nodes : [];
        for (let n = 0; n < groupNodes.length; n++) {
            const groupNode = groupNodes[n];
            if (!groupNode) continue;
            nodesByKey.set(this.getGroundTerrainNodeKey(groupNode), groupNode);
        }
        const pointRecords = simplified.map(point => {
            const affected = this.groundTerrainPointTouchesNodeKeys(
                point,
                affectedNodeKeys,
                vertexSlotsByPointKey,
                affectedNodes
            );
            if (!affected) {
                return { point, affected: false, nonGroupCount: null, baseKeep: true };
            }
            const slots = this.getGroundTerrainReplacementPointSlots(
                point,
                localVertexSlotsByPointKey,
                groupNodes
            );
            if (!(slots instanceof Set) || slots.size !== 3) {
                const onAffectedBoundary = this.groundTerrainPointTouchesAnyHexBoundary(point, affectedNodes);
                return {
                    point,
                    affected: true,
                    nonGroupCount: null,
                    keepNonGroupCount: null,
                    forcedNonGroupCount: null,
                    priorityAdjusted: false,
                    baseKeep: onAffectedBoundary,
                    needsAnchorCheck: !onAffectedBoundary
                };
            }
            const stats = this.getGroundTerrainBoundaryKeepNonGroupCount(
                group && group.type ? group.type : "grass",
                slots,
                nodesByKey,
                options
            );
            return {
                point,
                affected: true,
                nonGroupCount: stats.nonGroupCount,
                keepNonGroupCount: stats.keepNonGroupCount,
                forcedNonGroupCount: 3 - stats.keepNonGroupCount,
                priorityAdjusted: stats.higherPriorityNeighbor,
                baseKeep: stats.nonGroupCount === stats.keepNonGroupCount
            };
        });
        for (let i = 0; i < pointRecords.length; i++) {
            const record = pointRecords[i];
            if (!record || record.needsAnchorCheck !== true) continue;
            const prev = pointRecords[(i + pointRecords.length - 1) % pointRecords.length];
            const next = pointRecords[(i + 1) % pointRecords.length];
            record.baseKeep = !!(
                (prev && prev.affected === false) ||
                (next && next.affected === false)
            );
        }
        const forcedPointsByRunStart = new Map();
        const getPointRecordSlots = (record) => {
            if (!record) return null;
            const slots = this.getGroundTerrainReplacementPointSlots(
                record.point,
                localVertexSlotsByPointKey,
                groupNodes
            );
            if (!(slots instanceof Set)) {
                throw new Error("terrain local patch smoothing could not resolve skipped vertex slots");
            }
            return slots;
        };
        const resolveTerrainSlotCenter = (slotKey) => {
            const existingNode = nodesByKey.get(slotKey);
            if (existingNode) {
                const x = Number(existingNode.x);
                const y = Number(existingNode.y);
                return (Number.isFinite(x) && Number.isFinite(y)) ? { x, y } : null;
            }
            const match = /^(-?\d+),(-?\d+)$/.exec(String(slotKey || ""));
            if (!match) return null;
            const xindex = Number(match[1]);
            const yindex = Number(match[2]);
            const resolvedNode = this.getGroundTerrainNodeAtCoord(xindex, yindex);
            if (resolvedNode) {
                nodesByKey.set(slotKey, resolvedNode);
                const x = Number(resolvedNode.x);
                const y = Number(resolvedNode.y);
                return (Number.isFinite(x) && Number.isFinite(y)) ? { x, y } : null;
            }
            return {
                x: xindex * 0.866,
                y: yindex + (xindex % 2 === 0 ? 0.5 : 0)
            };
        };
        const groupType = group && group.type ? group.type : "grass";
        const slotMatchesSkippedRunCenterSide = (slotKey, record) => {
            const slotType = this.getGroundTerrainTypeForSlotKey(slotKey, nodesByKey);
            const slotIsGroup = slotType === groupType;
            const useGroupSide = Number(record && record.forcedNonGroupCount) >= 2;
            return useGroupSide ? slotIsGroup : !slotIsGroup;
        };
        const getSkippedRunHexCenter = (runStart, runLength) => {
            const count = pointRecords.length;
            const slotCounts = new Map();
            let xSum = 0;
            let ySum = 0;
            for (let r = 0; r < runLength; r++) {
                const record = pointRecords[(runStart + r) % count];
                const point = record && record.point;
                xSum += Number(point && point.x);
                ySum += Number(point && point.y);
                const slots = getPointRecordSlots(record);
                for (const slotKey of slots) {
                    if (!slotMatchesSkippedRunCenterSide(slotKey, record)) continue;
                    if (!resolveTerrainSlotCenter(slotKey)) continue;
                    slotCounts.set(slotKey, (slotCounts.get(slotKey) || 0) + 1);
                }
            }
            if (slotCounts.size === 0) {
                throw new Error("terrain local patch smoothing could not resolve a forced hex center for skipped vertices");
            }
            const centroid = { x: xSum / runLength, y: ySum / runLength };
            let bestKey = "";
            let bestCount = -1;
            let bestDistance = Infinity;
            for (const [slotKey, slotCount] of slotCounts.entries()) {
                const center = resolveTerrainSlotCenter(slotKey);
                if (!center) continue;
                const distance = Math.hypot(center.x - centroid.x, center.y - centroid.y);
                if (
                    slotCount > bestCount ||
                    (slotCount === bestCount && distance < bestDistance)
                ) {
                    bestKey = slotKey;
                    bestCount = slotCount;
                    bestDistance = distance;
                }
            }
            if (!bestKey) {
                throw new Error("terrain local patch smoothing resolved skipped-run hex candidates without finite centers");
            }
            const center = resolveTerrainSlotCenter(bestKey);
            if (!center) {
                throw new Error("terrain local patch smoothing resolved a skipped-run hex center without finite coordinates");
            }
            return center;
        };
        const isForcedCandidate = (record) => !!(
            record &&
            record.affected === true &&
            record.baseKeep === false &&
            record.nonGroupCount === record.forcedNonGroupCount
        );
        const addForcedRunPoint = (runStart, runLength) => {
            if (runLength < 3) return;
            const count = pointRecords.length;
            if (runLength === 3) {
                forcedPointsByRunStart.set(runStart, getSkippedRunHexCenter(runStart, 3));
                return;
            }
            if (runLength === 4) {
                for (let windowStart = 0; windowStart <= 1; windowStart++) {
                    let xSum = 0;
                    let ySum = 0;
                    for (let r = 0; r < 3; r++) {
                        const point = pointRecords[(runStart + windowStart + r) % count].point;
                        xSum += Number(point.x);
                        ySum += Number(point.y);
                    }
                    forcedPointsByRunStart.set((runStart + windowStart) % count, {
                        x: xSum / 3,
                        y: ySum / 3
                    });
                }
                return;
            }
            let xSum = 0;
            let ySum = 0;
            for (let r = 0; r < runLength; r++) {
                const point = pointRecords[(runStart + r) % count].point;
                xSum += Number(point.x);
                ySum += Number(point.y);
            }
            forcedPointsByRunStart.set(runStart, {
                x: xSum / runLength,
                y: ySum / runLength
            });
        };
        if (pointRecords.length >= 3) {
            const count = pointRecords.length;
            const startIndex = pointRecords.findIndex(record => !isForcedCandidate(record));
            if (startIndex >= 0) {
                let runStart = -1;
                let runLength = 0;
                for (let step = 1; step <= count; step++) {
                    const index = (startIndex + step) % count;
                    if (isForcedCandidate(pointRecords[index])) {
                        if (runStart < 0) runStart = index;
                        runLength += 1;
                    } else if (runStart >= 0) {
                        addForcedRunPoint(runStart, runLength);
                        runStart = -1;
                        runLength = 0;
                    }
                }
            }
        }
        const kept = [];
        for (let p = 0; p < pointRecords.length; p++) {
            if (forcedPointsByRunStart.has(p)) kept.push(forcedPointsByRunStart.get(p));
            if (pointRecords[p].baseKeep) kept.push(pointRecords[p].point);
        }
        const out = this.simplifyGroundTerrainPolygonPoints(kept);
        if (out.length < 3 && pointRecords.some(record => record && record.priorityAdjusted === true)) {
            return simplified;
        }
        if (out.length < 3) {
            throw new Error(`terrain local patch smoothing produced fewer than three vertices for ${group && group.type ? group.type : "unknown"} terrain`);
        }
        return out;
    }

    groundTerrainClipGeometryToLocalPatchPolygons(type, geometry, group, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes) {
        this.getGroundTerrainTextureIdForType(type);
        if (clipGeometryIsEmpty2D(geometry)) return [];
        const out = [];
        for (let p = 0; p < geometry.length; p++) {
            const polygon = geometry[p];
            if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) {
                throw new Error(`terrain local patch produced malformed geometry for ${type}`);
            }
            const points = this.smoothGroundTerrainLocalPatchRingPoints(
                clipRingToPolygonPoints2D(polygon[0], `terrain ${type} local patch ring`),
                group,
                affectedNodeKeys,
                vertexSlotsByPointKey,
                affectedNodes,
                { isHole: false }
            );
            const holes = [];
            for (let h = 1; h < polygon.length; h++) {
                holes.push(this.smoothGroundTerrainLocalPatchRingPoints(
                    clipRingToPolygonPoints2D(polygon[h], `terrain ${type} local patch hole`),
                    group,
                    affectedNodeKeys,
                    vertexSlotsByPointKey,
                    affectedNodes,
                    { isHole: true }
                ));
            }
            out.push(holes.length > 0 ? { type, points, holes } : { type, points });
        }
        return out;
    }

    collectGroundTerrainLocalPatchNodes(node, options = {}) {
        if (!node) return [];
        const sectionKey = options && typeof options.sectionKey === "string" ? options.sectionKey : "";
        const dirs = [1, 3, 5, 7, 9, 11];
        const nodesByKey = new Map();
        const addNode = (candidate) => {
            if (!candidate || candidate._prototypeVoid === true) return;
            if (sectionKey) {
                const candidateSectionKey = typeof candidate._prototypeSectionKey === "string" && candidate._prototypeSectionKey.length > 0
                    ? candidate._prototypeSectionKey
                    : (typeof candidate.ownerSectionKey === "string" ? candidate.ownerSectionKey : "");
                if (candidateSectionKey !== sectionKey) return;
            }
            nodesByKey.set(this.getGroundTerrainNodeKey(candidate), candidate);
        };
        addNode(node);
        for (let d = 0; d < dirs.length; d++) {
            const direction = dirs[d];
            const neighbor = node.neighbors && node.neighbors[direction]
                ? node.neighbors[direction]
                : null;
            if (neighbor) {
                addNode(neighbor);
                continue;
            }
            const offset = node.neighborOffsets && node.neighborOffsets[direction];
            if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) continue;
            addNode(this.getGroundTerrainNodeAtCoord(
                Number(node.xindex) + Number(offset.x),
                Number(node.yindex) + Number(offset.y)
            ));
        }
        return Array.from(nodesByKey.values());
    }

    collectGroundTerrainExpandedLocalAffectedNodes(patchNodes, options = {}) {
        const sourceNodes = Array.isArray(patchNodes) ? patchNodes : [];
        const sectionKey = options && typeof options.sectionKey === "string" ? options.sectionKey : "";
        const dirs = [1, 3, 5, 7, 9, 11];
        const nodesByKey = new Map();
        const addNode = (candidate) => {
            if (!candidate || candidate._prototypeVoid === true) return;
            if (sectionKey) {
                const candidateSectionKey = typeof candidate._prototypeSectionKey === "string" && candidate._prototypeSectionKey.length > 0
                    ? candidate._prototypeSectionKey
                    : (typeof candidate.ownerSectionKey === "string" ? candidate.ownerSectionKey : "");
                if (candidateSectionKey !== sectionKey) return;
            }
            nodesByKey.set(this.getGroundTerrainNodeKey(candidate), candidate);
        };
        const resolveNeighbor = (node, direction) => {
            const neighbor = node && node.neighbors && node.neighbors[direction]
                ? node.neighbors[direction]
                : null;
            if (neighbor) return neighbor;
            const offset = node && node.neighborOffsets && node.neighborOffsets[direction]
                ? node.neighborOffsets[direction]
                : null;
            if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return null;
            return this.getGroundTerrainNodeAtCoord(
                Number(node.xindex) + Number(offset.x),
                Number(node.yindex) + Number(offset.y)
            );
        };
        for (let i = 0; i < sourceNodes.length; i++) {
            const node = sourceNodes[i];
            addNode(node);
            for (let d = 0; d < dirs.length; d++) {
                addNode(resolveNeighbor(node, dirs[d]));
            }
        }
        return Array.from(nodesByKey.values());
    }

    buildGroundTerrainHexPatchGeometry(nodes) {
        const api = getPolygonClippingApi2D();
        if (!api || typeof api.union !== "function") {
            throw new Error("terrain patch geometry requires polygon clipping union");
        }
        const geometries = [];
        const sourceNodes = Array.isArray(nodes) ? nodes : [];
        for (let i = 0; i < sourceNodes.length; i++) {
            const node = sourceNodes[i];
            if (!node || node._prototypeVoid === true) continue;
            const ring = polygonToClipRing2D(this.getGroundTerrainHexCorners(node));
            if (!ring) {
                throw new Error("terrain patch geometry could not build a hex ring");
            }
            geometries.push([[ring]]);
        }
        if (geometries.length === 0) {
            throw new Error("terrain patch geometry requires at least one node");
        }
        try {
            return api.union(...geometries);
        } catch (err) {
            throw new Error(`terrain patch geometry union failed: ${err && err.message ? err.message : err}`);
        }
    }

    getGroundTerrainHexPatchBounds(nodes) {
        const sourceNodes = Array.isArray(nodes) ? nodes : [];
        const points = [];
        for (let i = 0; i < sourceNodes.length; i++) {
            const node = sourceNodes[i];
            if (!node || node._prototypeVoid === true) continue;
            points.push(...this.getGroundTerrainHexCorners(node));
        }
        const bounds = getPolygonBounds2D(points);
        if (!bounds) {
            throw new Error("terrain patch bounds require at least one finite hex");
        }
        return bounds;
    }

    mergeGroundTerrainPolygonsByType(polygons) {
        const api = getPolygonClippingApi2D();
        if (!api || typeof api.union !== "function") {
            throw new Error("terrain polygon merge requires polygon clipping union");
        }
        const normalizedPolygons = this.normalizeGroundTerrainPolygons(polygons);
        const geometriesByType = new Map();
        for (let p = 0; p < normalizedPolygons.length; p++) {
            const polygon = normalizedPolygons[p];
            const geometry = this.groundTerrainPolygonToClipGeometry(polygon);
            if (!geometriesByType.has(polygon.type)) geometriesByType.set(polygon.type, []);
            geometriesByType.get(polygon.type).push(geometry);
        }
        const out = [];
        for (const [type, geometries] of geometriesByType.entries()) {
            if (geometries.length === 0) continue;
            let merged = null;
            try {
                merged = geometries.length === 1 ? geometries[0] : api.union(...geometries);
            } catch (err) {
                throw new Error(`terrain polygon merge failed for ${type}: ${err && err.message ? err.message : err}`);
            }
            out.push(...this.groundTerrainClipGeometryToPolygons(type, merged));
        }
        return out;
    }

    getGroundTerrainVertexRepairEpsilon() {
        return 1e-3;
    }

    getGroundTerrainRepairPointKey(point) {
        const q = Math.round(1 / this.getGroundTerrainVertexRepairEpsilon());
        return `${Math.round(Number(point && point.x) * q)},${Math.round(Number(point && point.y) * q)}`;
    }

    groundTerrainPointTouchesHexBoundary(point, node, eps = this.getGroundTerrainVertexRepairEpsilon()) {
        const x = Number(point && point.x);
        const y = Number(point && point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !node) return false;
        const corners = this.getGroundTerrainHexCorners(node);
        const epsSq = eps * eps;
        for (let i = 0; i < corners.length; i++) {
            const a = corners[i];
            const b = corners[(i + 1) % corners.length];
            if (getPointSegmentDistanceSq2D(x, y, a.x, a.y, b.x, b.y) <= epsSq) return true;
        }
        return false;
    }

    groundTerrainPointTouchesAnyHexBoundary(point, nodes, eps = this.getGroundTerrainVertexRepairEpsilon()) {
        const sourceNodes = Array.isArray(nodes) ? nodes : [];
        for (let i = 0; i < sourceNodes.length; i++) {
            if (this.groundTerrainPointTouchesHexBoundary(point, sourceNodes[i], eps)) return true;
        }
        return false;
    }

    getGroundTerrainPointSlots(point, vertexSlotsByPointKey) {
        if (!(vertexSlotsByPointKey instanceof Map)) {
            throw new Error("terrain vertex repair requires a vertex slot map");
        }
        return vertexSlotsByPointKey.get(this.getGroundTerrainPointKey(point)) || null;
    }

    getGroundTerrainReplacementPointSlots(point, vertexSlotsByPointKey, affectedNodes = null) {
        const exact = this.getGroundTerrainPointSlots(point, vertexSlotsByPointKey);
        if (exact instanceof Set) return exact;
        const x = Number(point && point.x);
        const y = Number(point && point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const eps = this.getGroundTerrainVertexRepairEpsilon();
        const epsSq = eps * eps;
        const nodes = Array.isArray(affectedNodes) ? affectedNodes : [];
        let best = null;
        let bestDistanceSq = Infinity;
        for (let n = 0; n < nodes.length; n++) {
            const corners = this.getGroundTerrainHexCorners(nodes[n]);
            for (let c = 0; c < corners.length; c++) {
                const corner = corners[c];
                const dx = Number(corner.x) - x;
                const dy = Number(corner.y) - y;
                const distanceSq = dx * dx + dy * dy;
                if (distanceSq > epsSq || distanceSq >= bestDistanceSq) continue;
                const slots = vertexSlotsByPointKey.get(this.getGroundTerrainPointKey(corner));
                if (!(slots instanceof Set)) continue;
                best = slots;
                bestDistanceSq = distanceSq;
            }
        }
        return best;
    }

    getGroundTerrainNeighborNodeForDirection(node, direction) {
        const neighbor = node && node.neighbors && node.neighbors[direction]
            ? node.neighbors[direction]
            : null;
        if (neighbor) return neighbor;
        const offset = node && node.neighborOffsets && node.neighborOffsets[direction]
            ? node.neighborOffsets[direction]
            : null;
        if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return null;
        return this.getGroundTerrainNodeAtCoord(
            Number(node.xindex) + Number(offset.x),
            Number(node.yindex) + Number(offset.y)
        );
    }

    groundTerrainPointTouchesHex(point, node, eps = this.getGroundTerrainVertexRepairEpsilon()) {
        const x = Number(point && point.x);
        const y = Number(point && point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !node) return false;
        const corners = this.getGroundTerrainHexCorners(node);
        if (pointInPolygon2D(x, y, corners)) return true;
        const epsSq = eps * eps;
        for (let i = 0; i < corners.length; i++) {
            const a = corners[i];
            const b = corners[(i + 1) % corners.length];
            if (getPointSegmentDistanceSq2D(x, y, a.x, a.y, b.x, b.y) <= epsSq) return true;
        }
        return false;
    }

    groundTerrainPointTouchesNodeKeys(point, nodeKeys, vertexSlotsByPointKey, affectedNodes = null) {
        if (!(nodeKeys instanceof Set)) {
            throw new Error("terrain vertex repair requires affected node keys");
        }
        const slots = this.getGroundTerrainPointSlots(point, vertexSlotsByPointKey);
        if (slots instanceof Set) {
            for (const slotKey of slots) {
                if (nodeKeys.has(slotKey)) return true;
            }
        }
        const nodes = Array.isArray(affectedNodes) ? affectedNodes : [];
        for (let i = 0; i < nodes.length; i++) {
            if (this.groundTerrainPointTouchesHex(point, nodes[i])) return true;
        }
        return false;
    }

    findGroundTerrainRingPointIndex(points, targetPoint) {
        const ring = Array.isArray(points) ? points : [];
        const targetKey = this.getGroundTerrainPointKey(targetPoint);
        for (let i = 0; i < ring.length; i++) {
            if (this.getGroundTerrainPointKey(ring[i]) === targetKey) return i;
        }
        const tx = Number(targetPoint && targetPoint.x);
        const ty = Number(targetPoint && targetPoint.y);
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return -1;
        const eps = this.getGroundTerrainVertexRepairEpsilon();
        const epsSq = eps * eps;
        let bestIndex = -1;
        let bestDistanceSq = Infinity;
        for (let i = 0; i < ring.length; i++) {
            const px = Number(ring[i] && ring[i].x);
            const py = Number(ring[i] && ring[i].y);
            if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
            const dx = px - tx;
            const dy = py - ty;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq <= epsSq && distanceSq < bestDistanceSq) {
                bestIndex = i;
                bestDistanceSq = distanceSq;
            }
        }
        return bestIndex;
    }

    getGroundTerrainAffectedVertexRuns(points, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes = null) {
        const ring = this.simplifyGroundTerrainPolygonPoints(points);
        if (ring.length < 3) return [];
        const affected = ring.map((point) => (
            this.groundTerrainPointTouchesNodeKeys(point, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes)
        ));
        const runs = [];
        const firstUnaffected = affected.findIndex((value) => !value);
        if (firstUnaffected < 0) {
            return [{ all: true, start: 0, end: ring.length - 1 }];
        }
        let runStart = -1;
        let runEnd = -1;
        for (let step = 1; step <= ring.length; step++) {
            const index = (firstUnaffected + step) % ring.length;
            if (affected[index]) {
                if (runStart < 0) runStart = index;
                runEnd = index;
            } else if (runStart >= 0) {
                runs.push({ all: false, start: runStart, end: runEnd });
                runStart = -1;
                runEnd = -1;
            }
        }
        return runs;
    }

    getGroundTerrainRingPath(points, startIndex, endIndex, step) {
        const ring = this.simplifyGroundTerrainPolygonPoints(points);
        if (ring.length < 3) return [];
        const direction = step < 0 ? -1 : 1;
        const out = [];
        let index = startIndex;
        for (let guard = 0; guard <= ring.length; guard++) {
            out.push(ring[index]);
            if (index === endIndex) return out;
            index = (index + direction + ring.length) % ring.length;
        }
        throw new Error("terrain ring path could not reach its endpoint");
    }

    dedupeGroundTerrainPathPoints(points) {
        if (!Array.isArray(points)) return [];
        const out = [];
        for (let i = 0; i < points.length; i++) {
            const x = Number(points[i] && points[i].x);
            const y = Number(points[i] && points[i].y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                throw new Error("terrain replacement path contains a non-finite point");
            }
            const prev = out[out.length - 1];
            if (prev && Math.abs(prev.x - x) < 1e-7 && Math.abs(prev.y - y) < 1e-7) continue;
            out.push({ x, y });
        }
        return out;
    }

    simplifyGroundTerrainPathPoints(points) {
        const out = this.dedupeGroundTerrainPathPoints(points);
        let changed = true;
        while (changed && out.length > 2) {
            changed = false;
            for (let i = 1; i < out.length - 1; i++) {
                const prev = out[i - 1];
                const cur = out[i];
                const next = out[i + 1];
                const ax = cur.x - prev.x;
                const ay = cur.y - prev.y;
                const bx = next.x - cur.x;
                const by = next.y - cur.y;
                if (Math.abs(ax * by - ay * bx) < 1e-7) {
                    out.splice(i, 1);
                    changed = true;
                    break;
                }
            }
        }
        return out;
    }

    getGroundTerrainPathLength(points) {
        const path = Array.isArray(points) ? points : [];
        let length = 0;
        for (let i = 1; i < path.length; i++) {
            const ax = Number(path[i - 1] && path[i - 1].x);
            const ay = Number(path[i - 1] && path[i - 1].y);
            const bx = Number(path[i] && path[i].x);
            const by = Number(path[i] && path[i].y);
            if (![ax, ay, bx, by].every(Number.isFinite)) {
                throw new Error("terrain replacement path length requires finite points");
            }
            length += Math.hypot(bx - ax, by - ay);
        }
        return length;
    }

    groundTerrainPathTouchesAffectedNodes(points, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes = null) {
        const path = Array.isArray(points) ? points : [];
        for (let i = 0; i < path.length; i++) {
            if (this.groundTerrainPointTouchesNodeKeys(path[i], affectedNodeKeys, vertexSlotsByPointKey, affectedNodes)) return true;
        }
        return false;
    }

    groundTerrainSegmentTouchesHex(a, b, node) {
        if (!a || !b || !node) return false;
        const ax = Number(a.x);
        const ay = Number(a.y);
        const bx = Number(b.x);
        const by = Number(b.y);
        if (![ax, ay, bx, by].every(Number.isFinite)) return false;
        if (this.groundTerrainPointTouchesHex(a, node) || this.groundTerrainPointTouchesHex(b, node)) return true;
        const corners = this.getGroundTerrainHexCorners(node);
        const mid = { x: (ax + bx) * 0.5, y: (ay + by) * 0.5 };
        if (pointInPolygon2D(mid.x, mid.y, corners)) return true;
        for (let i = 0; i < corners.length; i++) {
            if (segmentsIntersect2D(a, b, corners[i], corners[(i + 1) % corners.length])) return true;
        }
        return false;
    }

    groundTerrainPathTouchesAffectedArea(points, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes = null) {
        if (this.groundTerrainPathTouchesAffectedNodes(points, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes)) {
            return true;
        }
        const path = Array.isArray(points) ? points : [];
        const nodes = Array.isArray(affectedNodes) ? affectedNodes : [];
        for (let i = 1; i < path.length; i++) {
            for (let n = 0; n < nodes.length; n++) {
                if (this.groundTerrainSegmentTouchesHex(path[i - 1], path[i], nodes[n])) return true;
            }
        }
        return false;
    }

    buildGroundTerrainLocalBoundaryGraph(type, affectedNodes) {
        this.getGroundTerrainTextureIdForType(type);
        const dirs = [1, 3, 5, 7, 9, 11];
        const nodes = Array.isArray(affectedNodes) ? affectedNodes : [];
        const vertices = new Map();
        const edges = new Map();
        const addVertex = (point) => {
            const key = this.getGroundTerrainRepairPointKey(point);
            if (!vertices.has(key)) {
                vertices.set(key, {
                    key,
                    point: { x: Number(point.x), y: Number(point.y) },
                    neighbors: new Map()
                });
            }
            return vertices.get(key);
        };
        const addEdge = (a, b) => {
            const av = addVertex(a);
            const bv = addVertex(b);
            if (av.key === bv.key) return;
            const edgeKey = av.key < bv.key ? `${av.key}:${bv.key}` : `${bv.key}:${av.key}`;
            if (edges.has(edgeKey)) return;
            const length = Math.hypot(bv.point.x - av.point.x, bv.point.y - av.point.y);
            if (!(length > 1e-9)) {
                throw new Error(`terrain local boundary graph produced a zero-length edge for ${type}`);
            }
            edges.set(edgeKey, {
                key: edgeKey,
                aKey: av.key,
                bKey: bv.key,
                a: av.point,
                b: bv.point,
                length
            });
            av.neighbors.set(bv.key, length);
            bv.neighbors.set(av.key, length);
        };
        for (let n = 0; n < nodes.length; n++) {
            const node = nodes[n];
            if (!node || node._prototypeVoid === true) continue;
            const corners = this.getGroundTerrainHexCorners(node);
            const nodeIsType = this.getGroundTerrainTypeForNode(node) === type;
            for (let c = 0; c < 6; c++) {
                const neighbor = this.getGroundTerrainNeighborNodeForDirection(node, dirs[c]);
                const neighborIsType = !!(
                    neighbor &&
                    neighbor._prototypeVoid !== true &&
                    this.getGroundTerrainTypeForNode(neighbor) === type
                );
                if (nodeIsType === neighborIsType) continue;
                addEdge(corners[c], corners[(c + 1) % 6]);
            }
        }
        return { type, vertices, edges };
    }

    getGroundTerrainBoundaryGraphPointCandidates(graph, anchor, reference, affectedNodes) {
        if (!graph || !(graph.vertices instanceof Map)) {
            throw new Error("terrain local boundary graph candidates require a graph");
        }
        const ax = Number(anchor && anchor.x);
        const ay = Number(anchor && anchor.y);
        const rx = Number(reference && reference.x);
        const ry = Number(reference && reference.y);
        if (![ax, ay, rx, ry].every(Number.isFinite)) {
            throw new Error("terrain local boundary graph candidates require finite anchor points");
        }
        const candidates = [];
        const nodes = Array.isArray(affectedNodes) ? affectedNodes : [];
        for (const vertex of graph.vertices.values()) {
            const point = vertex.point;
            const anchorDistance = Math.hypot(point.x - ax, point.y - ay);
            const referenceDistance = Math.hypot(point.x - rx, point.y - ry);
            let touchesAffected = false;
            for (let n = 0; n < nodes.length; n++) {
                if (this.groundTerrainSegmentTouchesHex(anchor, point, nodes[n])) {
                    touchesAffected = true;
                    break;
                }
            }
            candidates.push({
                key: vertex.key,
                point,
                anchorDistance,
                referenceDistance,
                score: (referenceDistance * 3) + anchorDistance + (touchesAffected ? 0 : 100)
            });
        }
        candidates.sort((a, b) => a.score - b.score);
        return candidates.slice(0, 12);
    }

    getGroundTerrainBoundaryGraphComponentEdgeCount(graph, startKey) {
        if (!graph || !(graph.vertices instanceof Map)) {
            throw new Error("terrain local boundary graph component count requires a graph");
        }
        if (!graph.vertices.has(startKey)) return 0;
        const visited = new Set();
        const stack = [startKey];
        while (stack.length > 0) {
            const key = stack.pop();
            if (!key || visited.has(key)) continue;
            visited.add(key);
            const vertex = graph.vertices.get(key);
            if (!vertex || !(vertex.neighbors instanceof Map)) continue;
            for (const neighborKey of vertex.neighbors.keys()) {
                if (!visited.has(neighborKey)) stack.push(neighborKey);
            }
        }
        let edgeRefs = 0;
        for (const key of visited) {
            const vertex = graph.vertices.get(key);
            if (!vertex || !(vertex.neighbors instanceof Map)) continue;
            for (const neighborKey of vertex.neighbors.keys()) {
                if (visited.has(neighborKey)) edgeRefs += 1;
            }
        }
        return edgeRefs / 2;
    }

    getGroundTerrainBoundaryGraphSimplePaths(graph, startKey, endKey, maxPaths = 128) {
        if (!graph || !(graph.vertices instanceof Map)) {
            throw new Error("terrain local boundary graph path enumeration requires a graph");
        }
        if (!graph.vertices.has(startKey) || !graph.vertices.has(endKey)) return [];
        const paths = [];
        const stack = [{
            key: startKey,
            path: [startKey],
            visited: new Set([startKey])
        }];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current || !current.key) continue;
            if (current.key === endKey) {
                paths.push(current.path);
                if (paths.length > maxPaths) {
                    throw new Error("terrain local boundary graph produced too many possible border paths");
                }
                continue;
            }
            if (current.path.length > graph.vertices.size) continue;
            const vertex = graph.vertices.get(current.key);
            if (!vertex || !(vertex.neighbors instanceof Map)) continue;
            for (const neighborKey of vertex.neighbors.keys()) {
                if (current.visited.has(neighborKey)) continue;
                const nextVisited = new Set(current.visited);
                nextVisited.add(neighborKey);
                stack.push({
                    key: neighborKey,
                    path: current.path.concat(neighborKey),
                    visited: nextVisited
                });
            }
        }
        return paths.map(pathKeys => pathKeys.map(pathKey => graph.vertices.get(pathKey).point));
    }

    getGroundTerrainReplacementIndexForAnchoredPath(replacementPolygons, type, beforeAnchor, afterAnchor, path, options = {}) {
        const replacements = Array.isArray(replacementPolygons) ? replacementPolygons : [];
        const wantHole = options && options.isHole === true;
        for (let p = 0; p < replacements.length; p++) {
            const replacement = replacements[p];
            if (!replacement || replacement.type !== type) continue;
            const rings = wantHole
                ? (Array.isArray(replacement.holes) ? replacement.holes : [])
                : [replacement.points];
            for (let r = 0; r < rings.length; r++) {
                const ring = this.simplifyGroundTerrainPolygonPoints(rings[r]);
                if (
                    this.findGroundTerrainRingPointIndex(ring, beforeAnchor) >= 0 &&
                    this.findGroundTerrainRingPointIndex(ring, afterAnchor) >= 0
                ) {
                    return p;
                }
            }
        }
        let bestIndex = -1;
        let bestDistanceSq = Infinity;
        const pathPoints = Array.isArray(path) ? path : [];
        for (let p = 0; p < replacements.length; p++) {
            const replacement = replacements[p];
            if (!replacement || replacement.type !== type) continue;
            const rings = [replacement.points];
            if (Array.isArray(replacement.holes)) rings.push(...replacement.holes);
            for (let r = 0; r < rings.length; r++) {
                const ring = this.simplifyGroundTerrainPolygonPoints(rings[r]);
                if (ring.length < 3) continue;
                for (let i = 1; i < pathPoints.length - 1; i++) {
                    const x = Number(pathPoints[i] && pathPoints[i].x);
                    const y = Number(pathPoints[i] && pathPoints[i].y);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                    const distanceSq = getPointPolygonBoundaryDistanceSq2D(x, y, ring);
                    if (distanceSq < bestDistanceSq) {
                        bestDistanceSq = distanceSq;
                        bestIndex = p;
                    }
                }
            }
        }
        return bestIndex;
    }

    getGroundTerrainPathReplacementHoleOverlapCount(path, replacementPolygons, type) {
        const points = Array.isArray(path) ? path : [];
        if (points.length < 2) return 0;
        const replacements = Array.isArray(replacementPolygons) ? replacementPolygons : [];
        const holeRings = [];
        for (let p = 0; p < replacements.length; p++) {
            const replacement = replacements[p];
            if (!replacement || replacement.type !== type || !Array.isArray(replacement.holes)) continue;
            for (let h = 0; h < replacement.holes.length; h++) {
                const ring = this.simplifyGroundTerrainPolygonPoints(replacement.holes[h]);
                if (ring.length >= 3) holeRings.push(ring);
            }
        }
        if (holeRings.length === 0) return 0;
        const epsSq = this.getGroundTerrainVertexRepairEpsilon() * this.getGroundTerrainVertexRepairEpsilon();
        let count = 0;
        for (let i = 1; i < points.length; i++) {
            const ax = Number(points[i - 1] && points[i - 1].x);
            const ay = Number(points[i - 1] && points[i - 1].y);
            const bx = Number(points[i] && points[i].x);
            const by = Number(points[i] && points[i].y);
            if (![ax, ay, bx, by].every(Number.isFinite)) {
                throw new Error(`terrain local replacement path for ${type} contains a non-finite hole-overlap segment`);
            }
            const midpoint = { x: (ax + bx) * 0.5, y: (ay + by) * 0.5 };
            for (let h = 0; h < holeRings.length; h++) {
                if (getPointPolygonBoundaryDistanceSq2D(midpoint.x, midpoint.y, holeRings[h]) <= epsSq) {
                    count += 1;
                    break;
                }
            }
        }
        return count;
    }

    getGroundTerrainBoundaryGraphReplacementPathForRun(points, run, replacementPolygons, type, vertexSlotsByPointKey, affectedNodes = null, options = {}) {
        const ring = this.simplifyGroundTerrainPolygonPoints(points);
        if (!run || run.all === true) return null;
        const beforeIndex = (run.start + ring.length - 1) % ring.length;
        const afterIndex = (run.end + 1) % ring.length;
        const beforeAnchor = ring[beforeIndex];
        const afterAnchor = ring[afterIndex];
        const graph = this.buildGroundTerrainLocalBoundaryGraph(type, affectedNodes);
        if (!graph || !(graph.edges instanceof Map) || graph.edges.size === 0) {
            throw new Error(`terrain local boundary graph has no replacement edges for ${type}`);
        }
        const startCandidates = this.getGroundTerrainBoundaryGraphPointCandidates(
            graph,
            beforeAnchor,
            ring[run.start],
            affectedNodes
        );
        const endCandidates = this.getGroundTerrainBoundaryGraphPointCandidates(
            graph,
            afterAnchor,
            ring[run.end],
            affectedNodes
        );
        let best = null;
        for (let s = 0; s < startCandidates.length; s++) {
            for (let e = 0; e < endCandidates.length; e++) {
                const graphPaths = this.getGroundTerrainBoundaryGraphSimplePaths(
                    graph,
                    startCandidates[s].key,
                    endCandidates[e].key
                );
                if (graphPaths.length === 0) continue;
                const componentEdgeCount = this.getGroundTerrainBoundaryGraphComponentEdgeCount(
                    graph,
                    startCandidates[s].key
                );
                for (let p = 0; p < graphPaths.length; p++) {
                    const graphPath = graphPaths[p];
                    const rawPath = this.dedupeGroundTerrainPathPoints([
                        beforeAnchor,
                        ...graphPath,
                        afterAnchor
                    ]);
                    if (!this.groundTerrainPathTouchesAffectedArea(rawPath, new Set(), vertexSlotsByPointKey, affectedNodes)) continue;
                    const pathEdgeCount = Math.max(0, graphPath.length - 1);
                    const missingComponentEdges = Math.max(0, componentEdgeCount - pathEdgeCount);
                    const graphLength = this.getGroundTerrainPathLength(graphPath);
                    const attachmentLength = startCandidates[s].anchorDistance + endCandidates[e].anchorDistance;
                    const endpointDistance = startCandidates[s].referenceDistance + endCandidates[e].referenceDistance;
                    const holeBoundaryOverlap = options && options.isHole === true
                        ? 0
                        : this.getGroundTerrainPathReplacementHoleOverlapCount(graphPath, replacementPolygons, type);
                    const score = (holeBoundaryOverlap * 1000000000) +
                        (missingComponentEdges * 1000) +
                        attachmentLength +
                        endpointDistance +
                        (graphLength * 0.001);
                    if (!best || score < best.score) {
                        best = { rawPath, score };
                    }
                }
            }
        }
        if (!best) {
            throw new Error(`terrain local boundary graph could not bridge replacement anchors for ${type}`);
        }
        const smoothingGroup = this.buildGroundTerrainLocalSmoothingGroup(
            type,
            affectedNodes,
            vertexSlotsByPointKey
        );
        const path = this.smoothGroundTerrainReplacementPathPoints(
            best.rawPath,
            smoothingGroup,
            vertexSlotsByPointKey,
            affectedNodes,
            {
                ...options,
                isHole: options && options.isHole === true
            }
        );
        return {
            replacementIndex: this.getGroundTerrainReplacementIndexForAnchoredPath(
                replacementPolygons,
                type,
                beforeAnchor,
                afterAnchor,
                best.rawPath,
                options
            ),
            rawPath: best.rawPath,
            path
        };
    }

    smoothGroundTerrainReplacementPathPoints(points, group, vertexSlotsByPointKey, affectedNodes, options = {}) {
        const path = this.dedupeGroundTerrainPathPoints(points);
        if (path.length < 2) {
            throw new Error(`terrain local replacement path for ${group && group.type ? group.type : "unknown"} has fewer than two points`);
        }
        const nodeKeys = group && group.nodeKeys instanceof Set ? group.nodeKeys : new Set();
        const nodesByKey = new Map();
        const groupNodes = Array.isArray(group && group.nodes) ? group.nodes : [];
        for (let n = 0; n < groupNodes.length; n++) {
            const node = groupNodes[n];
            if (!node) continue;
            nodesByKey.set(this.getGroundTerrainNodeKey(node), node);
        }
        const pointRecords = path.map((point, index) => {
            if (index === 0 || index === path.length - 1) {
                return {
                    point,
                    baseKeep: true,
                    endpoint: true,
                    nonGroupCount: null,
                    keepNonGroupCount: null,
                    forcedNonGroupCount: null,
                    priorityAdjusted: false
                };
            }
            const slots = this.getGroundTerrainReplacementPointSlots(point, vertexSlotsByPointKey, affectedNodes);
            if (!(slots instanceof Set)) {
                throw new Error(`terrain local replacement path contained a non-hex vertex for ${group && group.type ? group.type : "unknown"} terrain`);
            }
            if (slots.size !== 3) {
                throw new Error(`terrain local replacement path expected 3 touching hex slots, found ${slots.size}`);
            }
            const stats = this.getGroundTerrainBoundaryKeepNonGroupCount(
                group && group.type ? group.type : "grass",
                slots,
                nodesByKey,
                options
            );
            return {
                point,
                baseKeep: stats.nonGroupCount === stats.keepNonGroupCount,
                endpoint: false,
                nonGroupCount: stats.nonGroupCount,
                keepNonGroupCount: stats.keepNonGroupCount,
                forcedNonGroupCount: 3 - stats.keepNonGroupCount,
                priorityAdjusted: stats.higherPriorityNeighbor
            };
        });
        const getPointRecordSlots = (record) => {
            const slots = this.getGroundTerrainReplacementPointSlots(
                record && record.point,
                vertexSlotsByPointKey,
                affectedNodes
            );
            if (!(slots instanceof Set)) {
                throw new Error("terrain local replacement path could not resolve skipped vertex slots");
            }
            return slots;
        };
        const resolveTerrainSlotCenter = (slotKey) => {
            const existingNode = nodesByKey.get(slotKey);
            if (existingNode) {
                const x = Number(existingNode.x);
                const y = Number(existingNode.y);
                return (Number.isFinite(x) && Number.isFinite(y)) ? { x, y } : null;
            }
            const match = /^(-?\d+),(-?\d+)$/.exec(String(slotKey || ""));
            if (!match) return null;
            const xindex = Number(match[1]);
            const yindex = Number(match[2]);
            const resolvedNode = this.getGroundTerrainNodeAtCoord(xindex, yindex);
            if (resolvedNode) {
                nodesByKey.set(slotKey, resolvedNode);
                const x = Number(resolvedNode.x);
                const y = Number(resolvedNode.y);
                return (Number.isFinite(x) && Number.isFinite(y)) ? { x, y } : null;
            }
            return {
                x: xindex * 0.866,
                y: yindex + (xindex % 2 === 0 ? 0.5 : 0)
            };
        };
        const groupType = group && group.type ? group.type : "grass";
        const slotMatchesSkippedRunCenterSide = (slotKey, record) => {
            const slotType = this.getGroundTerrainTypeForSlotKey(slotKey, nodesByKey);
            const slotIsGroup = slotType === groupType;
            const useGroupSide = Number(record && record.forcedNonGroupCount) >= 2;
            return useGroupSide ? slotIsGroup : !slotIsGroup;
        };
        const getSkippedRunHexCenter = (runStart, runLength) => {
            const slotCounts = new Map();
            let xSum = 0;
            let ySum = 0;
            for (let r = 0; r < runLength; r++) {
                const record = pointRecords[runStart + r];
                const point = record && record.point;
                xSum += Number(point && point.x);
                ySum += Number(point && point.y);
                const slots = getPointRecordSlots(record);
                for (const slotKey of slots) {
                    if (!slotMatchesSkippedRunCenterSide(slotKey, record)) continue;
                    if (!resolveTerrainSlotCenter(slotKey)) continue;
                    slotCounts.set(slotKey, (slotCounts.get(slotKey) || 0) + 1);
                }
            }
            if (slotCounts.size === 0) {
                throw new Error("terrain local replacement path could not resolve a forced hex center for skipped vertices");
            }
            const centroid = { x: xSum / runLength, y: ySum / runLength };
            let bestKey = "";
            let bestCount = -1;
            let bestDistance = Infinity;
            for (const [slotKey, slotCount] of slotCounts.entries()) {
                const center = resolveTerrainSlotCenter(slotKey);
                if (!center) continue;
                const distance = Math.hypot(center.x - centroid.x, center.y - centroid.y);
                if (
                    slotCount > bestCount ||
                    (slotCount === bestCount && distance < bestDistance)
                ) {
                    bestKey = slotKey;
                    bestCount = slotCount;
                    bestDistance = distance;
                }
            }
            if (!bestKey) {
                throw new Error("terrain local replacement path resolved skipped-run candidates without finite centers");
            }
            const center = resolveTerrainSlotCenter(bestKey);
            if (!center) {
                throw new Error("terrain local replacement path resolved a skipped-run hex center without finite coordinates");
            }
            return center;
        };
        const forcedPointsByRunStart = new Map();
        const addForcedRunPoint = (runStart, runLength) => {
            if (runLength < 3) return;
            if (runLength === 3) {
                forcedPointsByRunStart.set(runStart, getSkippedRunHexCenter(runStart, 3));
                return;
            }
            if (runLength === 4) {
                for (let windowStart = 0; windowStart <= 1; windowStart++) {
                    let xSum = 0;
                    let ySum = 0;
                    for (let r = 0; r < 3; r++) {
                        const point = pointRecords[runStart + windowStart + r].point;
                        xSum += Number(point.x);
                        ySum += Number(point.y);
                    }
                    forcedPointsByRunStart.set(runStart + windowStart, {
                        x: xSum / 3,
                        y: ySum / 3
                    });
                }
                return;
            }
            let xSum = 0;
            let ySum = 0;
            for (let r = 0; r < runLength; r++) {
                const point = pointRecords[runStart + r].point;
                xSum += Number(point.x);
                ySum += Number(point.y);
            }
            forcedPointsByRunStart.set(runStart, {
                x: xSum / runLength,
                y: ySum / runLength
            });
        };
        const isForcedCandidate = (record) => !!(
            record &&
            record.endpoint !== true &&
            record.baseKeep === false &&
            record.nonGroupCount === record.forcedNonGroupCount
        );
        let runStart = -1;
        let runLength = 0;
        for (let i = 1; i < pointRecords.length - 1; i++) {
            if (isForcedCandidate(pointRecords[i])) {
                if (runStart < 0) runStart = i;
                runLength += 1;
            } else if (runStart >= 0) {
                addForcedRunPoint(runStart, runLength);
                runStart = -1;
                runLength = 0;
            }
        }
        if (runStart >= 0) addForcedRunPoint(runStart, runLength);
        const kept = [];
        for (let p = 0; p < pointRecords.length; p++) {
            if (forcedPointsByRunStart.has(p)) kept.push(forcedPointsByRunStart.get(p));
            if (pointRecords[p].baseKeep) kept.push(pointRecords[p].point);
        }
        const out = this.dedupeGroundTerrainPathPoints(kept);
        if (out.length < 2) {
            throw new Error(`terrain local replacement path smoothing produced fewer than two vertices for ${group && group.type ? group.type : "unknown"} terrain`);
        }
        return out;
    }

    getGroundTerrainReplacementPathForRun(points, run, replacementPolygons, type, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes = null, options = {}) {
        return this.getGroundTerrainBoundaryGraphReplacementPathForRun(
            points,
            run,
            replacementPolygons,
            type,
            vertexSlotsByPointKey,
            affectedNodes,
            options
        );
    }

    spliceGroundTerrainAffectedRuns(points, runs, replacementPolygons, type, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes = null, options = {}) {
        const ring = this.simplifyGroundTerrainPolygonPoints(points);
        const sourceRuns = Array.isArray(runs) ? runs : [];
        if (ring.length < 3 || sourceRuns.length === 0) return null;
        if (sourceRuns.some(run => run && run.all === true)) return null;
        const affected = new Array(ring.length).fill(false);
        const runByStart = new Map();
        for (let r = 0; r < sourceRuns.length; r++) {
            const run = sourceRuns[r];
            if (!run || run.all === true) continue;
            runByStart.set(run.start, run);
            let index = run.start;
            for (let guard = 0; guard < ring.length; guard++) {
                affected[index] = true;
                if (index === run.end) break;
                index = (index + 1) % ring.length;
            }
        }
        const firstUnaffected = affected.findIndex(value => !value);
        if (firstUnaffected < 0) return null;
        const replacementsByRunStart = new Map();
        const usedReplacementIndexes = new Set();
        const rawReplacementSegments = [];
        const replacementSegments = [];
        for (let r = 0; r < sourceRuns.length; r++) {
            const run = sourceRuns[r];
            if (!run || run.all === true) continue;
            const replacement = this.getGroundTerrainReplacementPathForRun(
                ring,
                run,
                replacementPolygons,
                type,
                affectedNodeKeys,
                vertexSlotsByPointKey,
                affectedNodes,
                options
            );
            replacementsByRunStart.set(run.start, replacement.path);
            if (Number.isInteger(replacement.replacementIndex) && replacement.replacementIndex >= 0) {
                usedReplacementIndexes.add(replacement.replacementIndex);
            }
            rawReplacementSegments.push(...this.collectGroundTerrainDebugPathSegments(
                replacement.rawPath,
                type
            ));
            replacementSegments.push(...this.collectGroundTerrainDebugPathSegments(
                replacement.path,
                type
            ));
        }
        const ordered = [];
        for (let i = 0; i < ring.length; i++) {
            const originalIndex = (firstUnaffected + i) % ring.length;
            ordered.push({
                originalIndex,
                point: ring[originalIndex],
                affected: affected[originalIndex]
            });
        }
        const out = [];
        for (let i = 0; i < ordered.length;) {
            const record = ordered[i];
            if (!record.affected) {
                out.push(record.point);
                i += 1;
                continue;
            }
            const run = runByStart.get(record.originalIndex);
            if (!run) {
                throw new Error(`terrain polygon repair could not resolve an affected run start for ${type}`);
            }
            const path = replacementsByRunStart.get(run.start);
            if (!Array.isArray(path) || path.length < 2) {
                throw new Error(`terrain polygon repair resolved an empty replacement path for ${type}`);
            }
            for (let p = 1; p < path.length; p++) {
                out.push(path[p]);
            }
            let endOffset = i;
            while (endOffset < ordered.length && ordered[endOffset].originalIndex !== run.end) {
                endOffset += 1;
            }
            if (endOffset >= ordered.length) {
                throw new Error(`terrain polygon repair could not locate an affected run end for ${type}`);
            }
            i = endOffset + 2;
        }
        const spliced = this.simplifyGroundTerrainPolygonPoints(out);
        if (spliced.length < 3) {
            throw new Error(`terrain polygon repair produced fewer than three points for ${type}`);
        }
        return { points: spliced, usedReplacementIndexes, rawReplacementSegments, replacementSegments };
    }

    getGroundTerrainRepairRingSignature(points) {
        const ring = this.simplifyGroundTerrainPolygonPoints(points);
        if (ring.length < 3) return "";
        const segments = [];
        for (let i = 0; i < ring.length; i++) {
            const a = this.getGroundTerrainRepairPointKey(ring[i]);
            const b = this.getGroundTerrainRepairPointKey(ring[(i + 1) % ring.length]);
            segments.push(a < b ? `${a}:${b}` : `${b}:${a}`);
        }
        segments.sort();
        return segments.join("|");
    }

    getGroundTerrainRawRingSegmentSignature(points) {
        const ring = this.simplifyGroundTerrainPolygonPoints(points);
        if (ring.length < 3) return "";
        const segments = [];
        for (let i = 0; i < ring.length; i++) {
            const a = this.getGroundTerrainRepairPointKey(ring[i]);
            const b = this.getGroundTerrainRepairPointKey(ring[(i + 1) % ring.length]);
            segments.push(a < b ? `${a}:${b}` : `${b}:${a}`);
        }
        segments.sort();
        return segments.join("|");
    }

    getGroundTerrainGeneratedPolygonSignature(polygon) {
        if (!polygon || typeof polygon.type !== "string" || polygon.type.length === 0) return "";
        const outerSignature = this.getGroundTerrainRepairRingSignature(polygon.points);
        if (!outerSignature) return "";
        const holeSignatures = (Array.isArray(polygon.holes) ? polygon.holes : [])
            .map(hole => this.getGroundTerrainRepairRingSignature(hole))
            .filter(Boolean)
            .sort();
        return `${polygon.type}:${outerSignature}:${holeSignatures.join("#")}`;
    }

    markGroundTerrainPolygonsGenerated(polygons) {
        if (!(this._groundTerrainGeneratedPolygonSignatures instanceof Set)) {
            this._groundTerrainGeneratedPolygonSignatures = new Set();
        }
        const source = Array.isArray(polygons) ? polygons : [];
        for (let i = 0; i < source.length; i++) {
            const signature = this.getGroundTerrainGeneratedPolygonSignature(source[i]);
            if (signature) this._groundTerrainGeneratedPolygonSignatures.add(signature);
        }
        return polygons;
    }

    groundTerrainPolygonHasGeneratedSignature(polygon) {
        if (!(this._groundTerrainGeneratedPolygonSignatures instanceof Set)) return false;
        const signature = this.getGroundTerrainGeneratedPolygonSignature(polygon);
        return !!signature && this._groundTerrainGeneratedPolygonSignatures.has(signature);
    }

    groundTerrainPolygonMatchesCurrentTileGeometry(polygon) {
        if (!polygon || typeof polygon.type !== "string" || polygon.type.length === 0) return false;
        const type = polygon.type;
        const signature = this.getGroundTerrainGeneratedPolygonSignature(polygon);
        if (!signature) return false;
        const sourceNodes = this.collectGroundTerrainPolygonRepairSourceNodes();
        const seedNodes = [];
        for (let i = 0; i < sourceNodes.length; i++) {
            const node = sourceNodes[i];
            if (!node || node._prototypeVoid === true) continue;
            if (this.getGroundTerrainTypeForNode(node) !== type) continue;
            if (!this.terrainPolygonContainsPoint(polygon, node.x, node.y)) continue;
            seedNodes.push(node);
        }
        if (seedNodes.length === 0) return false;
        const componentNodes = this.collectGroundTerrainConnectedComponentNodesForType(type, seedNodes);
        if (componentNodes.length === 0) return false;
        const generatedPolygons = this.buildGroundTerrainPolygonsFromNodes(componentNodes);
        for (let i = 0; i < generatedPolygons.length; i++) {
            if (this.getGroundTerrainGeneratedPolygonSignature(generatedPolygons[i]) === signature) {
                return true;
            }
        }
        const state = this._prototypeSectionState || null;
        if (state && state.sectionAssetsByKey instanceof Map) {
            const api = getPolygonClippingApi2D();
            if (!api || typeof api.intersection !== "function") {
                throw new Error("terrain generated section polygon match requires polygon clipping intersection");
            }
            for (let i = 0; i < generatedPolygons.length; i++) {
                const generated = generatedPolygons[i];
                const generatedGeometry = this.groundTerrainPolygonToClipGeometry(generated);
                for (const [key, asset] of state.sectionAssetsByKey.entries()) {
                    if (!asset) continue;
                    const clipGeometry = this.getGroundTerrainSectionClipGeometry(key, asset);
                    let clipped = [];
                    try {
                        clipped = api.intersection(generatedGeometry, clipGeometry);
                    } catch (err) {
                        throw new Error(`terrain generated section polygon match failed for ${key}: ${err && err.message ? err.message : err}`);
                    }
                    const splitPolygons = this.groundTerrainClipGeometryToPolygons(type, clipped);
                    for (let p = 0; p < splitPolygons.length; p++) {
                        if (this.getGroundTerrainGeneratedPolygonSignature(splitPolygons[p]) === signature) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    markMatchingCurrentTileTerrainPolygonsGenerated(polygons) {
        const source = Array.isArray(polygons) ? polygons : [];
        const matched = [];
        for (let i = 0; i < source.length; i++) {
            const polygon = source[i];
            if (this.groundTerrainPolygonHasGeneratedSignature(polygon)) continue;
            if (this.groundTerrainPolygonMatchesCurrentTileGeometry(polygon)) {
                matched.push(polygon);
            }
        }
        if (matched.length > 0) this.markGroundTerrainPolygonsGenerated(matched);
        return matched.length;
    }

    snapGroundTerrainPointToAffectedHexCorner(point, affectedNodes) {
        const x = Number(point && point.x);
        const y = Number(point && point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error("terrain replacement ring contains a non-finite point");
        }
        const nodes = Array.isArray(affectedNodes) ? affectedNodes : [];
        const epsSq = this.getGroundTerrainVertexRepairEpsilon() * this.getGroundTerrainVertexRepairEpsilon();
        let best = null;
        let bestDistanceSq = Infinity;
        for (let n = 0; n < nodes.length; n++) {
            const corners = this.getGroundTerrainHexCorners(nodes[n]);
            for (let c = 0; c < corners.length; c++) {
                const corner = corners[c];
                const dx = Number(corner.x) - x;
                const dy = Number(corner.y) - y;
                const distanceSq = dx * dx + dy * dy;
                if (distanceSq > epsSq || distanceSq >= bestDistanceSq) continue;
                best = corner;
                bestDistanceSq = distanceSq;
            }
        }
        return best ? { x: Number(best.x), y: Number(best.y) } : { x, y };
    }

    snapGroundTerrainRingToAffectedHexCorners(points, affectedNodes) {
        const source = Array.isArray(points) ? points : [];
        return this.simplifyGroundTerrainPolygonPoints(source.map(point => (
            this.snapGroundTerrainPointToAffectedHexCorner(point, affectedNodes)
        )));
    }

    repairGroundTerrainReplacementRing(type, points, replacementPolygons, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes = null, options = {}) {
        const rawRing = this.snapGroundTerrainRingToAffectedHexCorners(points, affectedNodes);
        if (rawRing.length < 3) {
            throw new Error(`terrain replacement ring for ${type} has fewer than three points`);
        }
        const affectedRuns = this.getGroundTerrainAffectedVertexRuns(
            rawRing,
            affectedNodeKeys,
            vertexSlotsByPointKey,
            affectedNodes
        );
        if (affectedRuns.length === 0) {
            return { points: rawRing, rawReplacementSegments: [], replacementSegments: [] };
        }
        if (affectedRuns.some(run => run && run.all === true)) {
            const smoothingGroup = this.buildGroundTerrainLocalSmoothingGroup(
                type,
                affectedNodes,
                vertexSlotsByPointKey
            );
            const smoothedRing = this.smoothGroundTerrainLocalPatchRingPoints(
                rawRing,
                smoothingGroup,
                affectedNodeKeys,
                vertexSlotsByPointKey,
                affectedNodes,
                {
                    ...options,
                    isHole: options && options.isHole === true
                }
            );
            return {
                points: smoothedRing,
                rawReplacementSegments: this.collectGroundTerrainDebugRingSegments(rawRing, type),
                replacementSegments: this.collectGroundTerrainDebugRingSegments(smoothedRing, type)
            };
        }
        const repaired = this.spliceGroundTerrainAffectedRuns(
            rawRing,
            affectedRuns,
            replacementPolygons,
            type,
            affectedNodeKeys,
            vertexSlotsByPointKey,
            affectedNodes,
            {
                ...options,
                isHole: options && options.isHole === true
            }
        );
        if (!repaired || !Array.isArray(repaired.points)) {
            throw new Error(`terrain polygon repair could not splice replacement ring for ${type}`);
        }
        return repaired;
    }

    repairGroundTerrainReplacementPolygon(replacement, replacementPolygons, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes = null, options = {}) {
        if (!replacement || typeof replacement.type !== "string" || replacement.type.length === 0) {
            throw new Error("terrain replacement polygon repair requires a terrain type");
        }
        const rawReplacementSegments = [];
        const replacementSegments = [];
        const repairedOuter = this.repairGroundTerrainReplacementRing(
            replacement.type,
            replacement.points,
            replacementPolygons,
            affectedNodeKeys,
            vertexSlotsByPointKey,
            affectedNodes,
            {
                ...options,
                isHole: false
            }
        );
        rawReplacementSegments.push(...(Array.isArray(repairedOuter.rawReplacementSegments) ? repairedOuter.rawReplacementSegments : []));
        replacementSegments.push(...(Array.isArray(repairedOuter.replacementSegments) ? repairedOuter.replacementSegments : []));
        const holes = [];
        const sourceHoles = Array.isArray(replacement.holes) ? replacement.holes : [];
        for (let h = 0; h < sourceHoles.length; h++) {
            const repairedHole = this.repairGroundTerrainReplacementRing(
                replacement.type,
                sourceHoles[h],
                replacementPolygons,
                affectedNodeKeys,
                vertexSlotsByPointKey,
                affectedNodes,
                {
                    ...options,
                    isHole: true
                }
            );
            holes.push(repairedHole.points);
            rawReplacementSegments.push(...(Array.isArray(repairedHole.rawReplacementSegments) ? repairedHole.rawReplacementSegments : []));
            replacementSegments.push(...(Array.isArray(repairedHole.replacementSegments) ? repairedHole.replacementSegments : []));
        }
        return {
            polygon: holes.length > 0
                ? { type: replacement.type, points: repairedOuter.points, holes }
                : { type: replacement.type, points: repairedOuter.points },
            rawReplacementSegments,
            replacementSegments
        };
    }

    collectGroundTerrainReplacementHolesForUsedIndexes(type, replacementPolygons, usedReplacementIndexes, existingHoles, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes = null, options = {}) {
        if (!(usedReplacementIndexes instanceof Set) || usedReplacementIndexes.size === 0) {
            return { holes: [], rawReplacementSegments: [], replacementSegments: [] };
        }
        const seenHoleSignatures = new Set();
        const currentHoles = Array.isArray(existingHoles) ? existingHoles : [];
        for (let h = 0; h < currentHoles.length; h++) {
            const signature = this.getGroundTerrainRepairRingSignature(currentHoles[h]);
            if (signature) seenHoleSignatures.add(signature);
        }
        const out = [];
        const rawReplacementSegments = [];
        const replacementSegments = [];
        const replacements = Array.isArray(replacementPolygons) ? replacementPolygons : [];
        for (const index of usedReplacementIndexes) {
            const replacement = replacements[index];
            if (!replacement || replacement.type !== type || !Array.isArray(replacement.holes)) continue;
            for (let h = 0; h < replacement.holes.length; h++) {
                const rawHole = this.snapGroundTerrainRingToAffectedHexCorners(replacement.holes[h], affectedNodes);
                const affectedRuns = this.getGroundTerrainAffectedVertexRuns(rawHole, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes);
                if (affectedRuns.length === 0) continue;
                const repairedHole = this.repairGroundTerrainReplacementRing(
                    type,
                    rawHole,
                    replacementPolygons,
                    affectedNodeKeys,
                    vertexSlotsByPointKey,
                    affectedNodes,
                    {
                        ...options,
                        isHole: true
                    }
                );
                const smoothedHole = repairedHole.points;
                const signature = this.getGroundTerrainRepairRingSignature(smoothedHole);
                if (!signature || seenHoleSignatures.has(signature)) continue;
                seenHoleSignatures.add(signature);
                out.push(smoothedHole);
                rawReplacementSegments.push(...(Array.isArray(repairedHole.rawReplacementSegments) ? repairedHole.rawReplacementSegments : []));
                replacementSegments.push(...(Array.isArray(repairedHole.replacementSegments) ? repairedHole.replacementSegments : []));
            }
        }
        return { holes: out, rawReplacementSegments, replacementSegments };
    }

    getGroundTerrainAffectedReplacementPolygonsForType(type, replacementPolygons, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes = null, options = {}) {
        const out = [];
        const used = new Set();
        const rawReplacementSegments = [];
        const replacementSegments = [];
        const replacements = Array.isArray(replacementPolygons) ? replacementPolygons : [];
        for (let i = 0; i < replacements.length; i++) {
            const replacement = replacements[i];
            if (!replacement || replacement.type !== type) continue;
            const outerRuns = this.getGroundTerrainAffectedVertexRuns(
                replacement.points,
                affectedNodeKeys,
                vertexSlotsByPointKey,
                affectedNodes,
                options
            );
            const hasAffectedHole = Array.isArray(replacement.holes) && replacement.holes.some((hole) => (
                this.getGroundTerrainAffectedVertexRuns(hole, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes).length > 0
            ));
            const touchesAffectedPatch = outerRuns.length === 0 && !hasAffectedHole
                ? this.groundTerrainPolygonTouchesAnyPatchHex(replacement, affectedNodes)
                : false;
            if (outerRuns.length === 0 && !hasAffectedHole && !touchesAffectedPatch) continue;
            const repaired = this.repairGroundTerrainReplacementPolygon(
                replacement,
                replacements,
                affectedNodeKeys,
                vertexSlotsByPointKey,
                affectedNodes,
                options
            );
            out.push(repaired.polygon);
            rawReplacementSegments.push(...(Array.isArray(repaired.rawReplacementSegments) ? repaired.rawReplacementSegments : []));
            replacementSegments.push(...(Array.isArray(repaired.replacementSegments) ? repaired.replacementSegments : []));
            used.add(i);
        }
        return { polygons: out, usedReplacementIndexes: used, rawReplacementSegments, replacementSegments };
    }

    groundTerrainReplacementChangesAffectedHoleTopology(polygon, replacementPolygons, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes = null) {
        const existingHoles = Array.isArray(polygon && polygon.holes) ? polygon.holes : [];
        const existingHoleCount = existingHoles.length;
        const affectedExistingHole = existingHoles.some((hole) => (
            this.getGroundTerrainAffectedVertexRuns(hole, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes).length > 0
        ));
        const replacements = Array.isArray(replacementPolygons) ? replacementPolygons : [];
        let affectedReplacementCount = 0;
        for (let i = 0; i < replacements.length; i++) {
            const replacement = replacements[i];
            if (!replacement || replacement.type !== polygon.type) continue;
            const replacementOuterRuns = this.getGroundTerrainAffectedVertexRuns(
                replacement.points,
                affectedNodeKeys,
                vertexSlotsByPointKey,
                affectedNodes
            );
            const replacementHasAffectedHole = Array.isArray(replacement.holes) && replacement.holes.some((hole) => (
                this.getGroundTerrainAffectedVertexRuns(hole, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes).length > 0
            ));
            const replacementTouchesAffectedPatch = replacementOuterRuns.length === 0 && !replacementHasAffectedHole
                ? this.groundTerrainPolygonTouchesAnyPatchHex(replacement, affectedNodes)
                : false;
            if (replacementOuterRuns.length > 0 || replacementHasAffectedHole || replacementTouchesAffectedPatch) {
                affectedReplacementCount += 1;
            }
            const replacementHoles = Array.isArray(replacement.holes) ? replacement.holes : [];
            if (replacementHoles.length > existingHoleCount) {
                const hasAffectedNewHole = replacementHoles.some((hole) => (
                    this.getGroundTerrainAffectedVertexRuns(hole, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes).length > 0
                ));
                if (hasAffectedNewHole) return true;
            }
            if (replacementHoles.length < existingHoleCount && affectedExistingHole) return true;
        }
        if (affectedReplacementCount !== 1) return true;
        return false;
    }

    repairGroundTerrainPolygonVertices(polygon, replacementPolygons, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes = null, options = {}) {
        const outerRuns = this.getGroundTerrainAffectedVertexRuns(
            polygon.points,
            affectedNodeKeys,
            vertexSlotsByPointKey,
            affectedNodes
        );
        const holes = Array.isArray(polygon.holes) ? polygon.holes : [];
        const holeRuns = holes.map((hole) => (
            this.getGroundTerrainAffectedVertexRuns(hole, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes)
        ));
        const hasAffectedHole = holeRuns.some(runs => runs.length > 0);
        if (this.groundTerrainReplacementChangesAffectedHoleTopology(
            polygon,
            replacementPolygons,
            affectedNodeKeys,
            vertexSlotsByPointKey,
            affectedNodes
        )) {
            return this.getGroundTerrainAffectedReplacementPolygonsForType(
                polygon.type,
                replacementPolygons,
                affectedNodeKeys,
                vertexSlotsByPointKey,
                affectedNodes,
                options
            );
        }
        if (outerRuns.some(run => run && run.all === true) || holeRuns.some(runs => runs.some(run => run && run.all === true))) {
            return this.getGroundTerrainAffectedReplacementPolygonsForType(
                polygon.type,
                replacementPolygons,
                affectedNodeKeys,
                vertexSlotsByPointKey,
                affectedNodes,
                options
            );
        }
        if (outerRuns.length === 0 && !hasAffectedHole) {
            const affectedReplacement = this.getGroundTerrainAffectedReplacementPolygonsForType(
                polygon.type,
                replacementPolygons,
                affectedNodeKeys,
                vertexSlotsByPointKey,
                affectedNodes,
                options
            );
            if (affectedReplacement.polygons.length > 0) return affectedReplacement;
            return { polygons: [polygon], usedReplacementIndexes: new Set() };
        }
        const usedReplacementIndexes = new Set();
        const rawReplacementSegments = [];
        const replacementSegments = [];
        let points = this.simplifyGroundTerrainPolygonPoints(polygon.points);
        if (outerRuns.length > 0) {
            const repairedOuter = this.spliceGroundTerrainAffectedRuns(
                points,
                outerRuns,
                replacementPolygons,
                polygon.type,
                affectedNodeKeys,
                vertexSlotsByPointKey,
                affectedNodes,
                {
                    ...options,
                    isHole: false
                }
            );
            if (!repairedOuter) {
                return this.getGroundTerrainAffectedReplacementPolygonsForType(
                    polygon.type,
                    replacementPolygons,
                    affectedNodeKeys,
                    vertexSlotsByPointKey,
                    affectedNodes,
                    options
                );
            }
            points = repairedOuter.points;
            for (const index of repairedOuter.usedReplacementIndexes) usedReplacementIndexes.add(index);
            rawReplacementSegments.push(...(Array.isArray(repairedOuter.rawReplacementSegments) ? repairedOuter.rawReplacementSegments : []));
            replacementSegments.push(...(Array.isArray(repairedOuter.replacementSegments) ? repairedOuter.replacementSegments : []));
        }
        const nextHoles = [];
        for (let h = 0; h < holes.length; h++) {
            const runs = holeRuns[h];
            if (!Array.isArray(runs) || runs.length === 0) {
                nextHoles.push(holes[h]);
                continue;
            }
            const repairedHole = this.spliceGroundTerrainAffectedRuns(
                holes[h],
                runs,
                replacementPolygons,
                polygon.type,
                affectedNodeKeys,
                vertexSlotsByPointKey,
                affectedNodes,
                {
                    ...options,
                    isHole: true
                }
            );
            if (!repairedHole) {
                return this.getGroundTerrainAffectedReplacementPolygonsForType(
                    polygon.type,
                    replacementPolygons,
                    affectedNodeKeys,
                    vertexSlotsByPointKey,
                    affectedNodes,
                    options
                );
            }
            nextHoles.push(repairedHole.points);
            for (const index of repairedHole.usedReplacementIndexes) usedReplacementIndexes.add(index);
            rawReplacementSegments.push(...(Array.isArray(repairedHole.rawReplacementSegments) ? repairedHole.rawReplacementSegments : []));
            replacementSegments.push(...(Array.isArray(repairedHole.replacementSegments) ? repairedHole.replacementSegments : []));
        }
        const replacementHoles = this.collectGroundTerrainReplacementHolesForUsedIndexes(
            polygon.type,
            replacementPolygons,
            usedReplacementIndexes,
            nextHoles,
            affectedNodeKeys,
            vertexSlotsByPointKey,
            affectedNodes,
            options
        );
        nextHoles.push(...replacementHoles.holes);
        rawReplacementSegments.push(...replacementHoles.rawReplacementSegments);
        replacementSegments.push(...replacementHoles.replacementSegments);
        const repairedPolygon = nextHoles.length > 0
            ? { type: polygon.type, points, holes: nextHoles }
            : { type: polygon.type, points };
        return {
            polygons: [repairedPolygon],
            usedReplacementIndexes,
            rawReplacementSegments,
            replacementSegments
        };
    }

    groundTerrainRingBoundaryContainsPoint(points, point, eps = this.getGroundTerrainVertexRepairEpsilon()) {
        const ring = this.simplifyGroundTerrainPolygonPoints(points);
        if (ring.length < 2) return false;
        const x = Number(point && point.x);
        const y = Number(point && point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        const epsSq = eps * eps;
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i];
            const b = ring[(i + 1) % ring.length];
            if (getPointSegmentDistanceSq2D(x, y, a.x, a.y, b.x, b.y) <= epsSq) return true;
        }
        return false;
    }

    groundTerrainRingContainsOrTouchesPoint(points, point) {
        const ring = this.simplifyGroundTerrainPolygonPoints(points);
        const x = Number(point && point.x);
        const y = Number(point && point.y);
        if (ring.length < 3 || !Number.isFinite(x) || !Number.isFinite(y)) return false;
        return pointInPolygon2D(x, y, ring) || this.groundTerrainRingBoundaryContainsPoint(ring, { x, y });
    }

    groundTerrainRingContainsOrTouchesRing(container, contained) {
        const source = this.simplifyGroundTerrainPolygonPoints(contained);
        if (source.length < 3) return false;
        for (let i = 0; i < source.length; i++) {
            if (!this.groundTerrainRingContainsOrTouchesPoint(container, source[i])) return false;
        }
        return true;
    }

    canonicalizeGroundTerrainNestedPolygonBoundaries(polygons) {
        const source = Array.isArray(polygons) ? polygons : [];
        if (source.length < 2) return source;
        const out = source.map(polygon => {
            const points = this.simplifyGroundTerrainPolygonPoints(polygon && polygon.points);
            if (!polygon || typeof polygon.type !== "string" || polygon.type.length === 0 || points.length < 3) {
                return polygon;
            }
            const holes = Array.isArray(polygon.holes)
                ? polygon.holes.map(hole => this.simplifyGroundTerrainPolygonPoints(hole))
                : [];
            return holes.length > 0
                ? { type: polygon.type, points, holes }
                : { type: polygon.type, points };
        });
        for (let p = 0; p < out.length; p++) {
            const polygon = out[p];
            const holes = Array.isArray(polygon && polygon.holes) ? polygon.holes : [];
            if (!polygon || holes.length === 0) continue;
            const nextHoles = [];
            for (let h = 0; h < holes.length; h++) {
                const hole = holes[h];
                const matches = [];
                for (let c = 0; c < out.length; c++) {
                    if (c === p) continue;
                    const candidate = out[c];
                    if (!candidate || candidate.type === polygon.type) continue;
                    if (!this.groundTerrainRingContainsOrTouchesRing(hole, candidate.points)) continue;
                    matches.push(candidate);
                }
                if (matches.length > 1) {
                    throw new Error(`terrain local patch found multiple inner polygons for ${polygon.type} hole`);
                }
                nextHoles.push(matches.length === 1
                    ? matches[0].points.map(point => ({ x: Number(point.x), y: Number(point.y) }))
                    : hole);
            }
            out[p] = { type: polygon.type, points: polygon.points, holes: nextHoles };
        }
        return out;
    }

    collectGroundTerrainPolygonRepairSourceNodes(options = {}) {
        const sectionKey = options && typeof options.sectionKey === "string" ? options.sectionKey : "";
        if (sectionKey) {
            const state = this._prototypeSectionState || null;
            const sectionNodes = state && state.nodesBySectionKey instanceof Map
                ? (state.nodesBySectionKey.get(sectionKey) || null)
                : null;
            if (Array.isArray(sectionNodes)) return sectionNodes.filter(node => node && node._prototypeVoid !== true);
            throw new Error(`terrain polygon repair requires loaded nodes for section ${sectionKey}`);
        }
        if (!Array.isArray(this.nodes)) {
            throw new Error("terrain polygon repair requires map nodes");
        }
        const out = [];
        for (let x = 0; x < this.nodes.length; x++) {
            const column = this.nodes[x];
            if (!Array.isArray(column)) continue;
            for (let y = 0; y < column.length; y++) {
                const node = column[y];
                if (node && node._prototypeVoid !== true) out.push(node);
            }
        }
        return out;
    }

    terrainPolygonContainsPoint(polygon, x, y) {
        if (!polygon || !Array.isArray(polygon.points) || polygon.points.length < 3) return false;
        if (!pointInPolygon2D(x, y, polygon.points)) return false;
        const holes = Array.isArray(polygon.holes) ? polygon.holes : [];
        for (let h = 0; h < holes.length; h++) {
            if (pointInPolygon2D(x, y, holes[h])) return false;
        }
        return true;
    }

    isGroundTerrainWaterAtPoint(x, y) {
        const px = Number(x);
        const py = Number(y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) {
            throw new Error("water terrain point query requires a finite point");
        }
        const candidates = this.collectGroundTerrainCollisionPolygons({
            minX: px,
            minY: py,
            maxX: px,
            maxY: py
        });
        for (let i = 0; i < candidates.length; i++) {
            const entry = candidates[i];
            const polygon = entry && entry.polygon ? entry.polygon : null;
            if (!polygon || entry.terrainType !== "water") continue;
            if (this.terrainPolygonContainsPoint(polygon, px, py)) return true;
        }
        return false;
    }

    getGroundTerrainWaterShoreDistanceSqForRing(px, py, points, sampleDistance = 0.0001) {
        if (!Array.isArray(points) || points.length < 3) return Infinity;
        const probeDistance = Number.isFinite(Number(sampleDistance))
            ? Math.max(1e-7, Math.abs(Number(sampleDistance)))
            : 0.0001;
        let best = Infinity;
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            const ax = Number(a && a.x);
            const ay = Number(a && a.y);
            const bx = Number(b && b.x);
            const by = Number(b && b.y);
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
            const dx = bx - ax;
            const dy = by - ay;
            const len = Math.hypot(dx, dy);
            if (!(len > 1e-12)) continue;
            const closest = getClosestPointOnSegment2D(px, py, ax, ay, bx, by);
            const nx = -dy / len;
            const ny = dx / len;
            const sideAIsWater = this.isGroundTerrainWaterAtPoint(
                closest.x + (nx * probeDistance),
                closest.y + (ny * probeDistance)
            );
            const sideBIsWater = this.isGroundTerrainWaterAtPoint(
                closest.x - (nx * probeDistance),
                closest.y - (ny * probeDistance)
            );
            if (sideAIsWater && sideBIsWater) continue;
            const distSq = getPointSegmentDistanceSq2D(px, py, ax, ay, bx, by);
            if (distSq < best) best = distSq;
        }
        return best;
    }

    getGroundTerrainWaterShoreDistanceSqForPolygon(px, py, polygon, options = {}) {
        if (!polygon || !Array.isArray(polygon.points) || polygon.points.length < 3) return Infinity;
        const sampleDistance = Number.isFinite(Number(options && options.sampleDistance))
            ? Number(options.sampleDistance)
            : 0.0001;
        let best = this.getGroundTerrainWaterShoreDistanceSqForRing(px, py, polygon.points, sampleDistance);
        const holes = Array.isArray(polygon.holes) ? polygon.holes : [];
        for (let h = 0; h < holes.length; h++) {
            best = Math.min(best, this.getGroundTerrainWaterShoreDistanceSqForRing(px, py, holes[h], sampleDistance));
        }
        return best;
    }

    getGroundBridgeRoadPolygon(road) {
        if (!road || road.gone || road.vanishing) return null;
        const type = typeof road.type === "string" ? road.type : "";
        if (type !== "road" && type !== "roadPath") return null;
        const layer = Number.isFinite(road.traversalLayer)
            ? Math.round(Number(road.traversalLayer))
            : (Number.isFinite(road.level) ? Math.round(Number(road.level)) : 0);
        if (layer !== 0) return null;
        const sourcePoints = Array.isArray(road.outlinePolygon)
            ? road.outlinePolygon
            : (road.groundPlaneHitbox && Array.isArray(road.groundPlaneHitbox.points)
                ? road.groundPlaneHitbox.points
                : (road.visualHitbox && Array.isArray(road.visualHitbox.points) ? road.visualHitbox.points : null));
        if (!Array.isArray(sourcePoints) || sourcePoints.length < 3) return null;
        const points = [];
        for (let i = 0; i < sourcePoints.length; i++) {
            const x = Number(sourcePoints[i] && sourcePoints[i].x);
            const y = Number(sourcePoints[i] && sourcePoints[i].y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            points.push({ x, y });
        }
        return points;
    }

    getGroundBridgeRoadBounds(road) {
        const polygon = this.getGroundBridgeRoadPolygon(road);
        return polygon ? getPolygonBounds2D(polygon) : null;
    }

    invalidateGroundBridgeBarrierCache() {
        this._groundBridgeBarrierCacheVersion = (Number(this._groundBridgeBarrierCacheVersion) || 0) + 1;
        this._groundBridgeBlockingEdgeCache = new WeakMap();
    }

    getGroundBridgePolygonSignature(polygon) {
        const points = Array.isArray(polygon) ? polygon : [];
        return points.map(point => {
            const x = Number(point && point.x);
            const y = Number(point && point.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return "bad";
            return `${Math.round(x * 10000)}:${Math.round(y * 10000)}`;
        }).join("|");
    }

    getGroundBridgeBlockingEdgeSegmentsForRoad(road, polygon = null, options = {}) {
        const roadRef = road && typeof road === "object" ? road : null;
        const bridgePolygon = Array.isArray(polygon) ? polygon : this.getGroundBridgeRoadPolygon(roadRef);
        if (!bridgePolygon || bridgePolygon.length < 3) return [];
        const minDepth = Number.isFinite(Number(options && options.minSubmergedDepth))
            ? Math.max(0, Number(options.minSubmergedDepth))
            : 0.25;
        const sampleDistance = Number.isFinite(Number(options && options.sampleDistance))
            ? Math.max(1e-5, Math.abs(Number(options.sampleDistance)))
            : 0.02;
        const maxSegmentLength = Number.isFinite(Number(options && options.maxSegmentLength))
            ? Math.max(0.05, Math.abs(Number(options.maxSegmentLength)))
            : 0.25;
        const version = Number(this._groundBridgeBarrierCacheVersion) || 0;
        const polygonSignature = this.getGroundBridgePolygonSignature(bridgePolygon);
        const cacheKey = `${version}:${minDepth}:${sampleDistance}:${maxSegmentLength}:${polygonSignature}`;
        if (roadRef) {
            if (!(this._groundBridgeBlockingEdgeCache instanceof WeakMap)) {
                this._groundBridgeBlockingEdgeCache = new WeakMap();
            }
            const cached = this._groundBridgeBlockingEdgeCache.get(roadRef);
            if (cached && cached.key === cacheKey && Array.isArray(cached.segments)) {
                return cached.segments;
            }
        }
        const segments = this.getGroundBridgeBlockingEdgeSegmentsForPolygon(bridgePolygon, {
            minSubmergedDepth: minDepth,
            sampleDistance,
            maxSegmentLength
        });
        if (roadRef) {
            this._groundBridgeBlockingEdgeCache.set(roadRef, { key: cacheKey, segments });
        }
        return segments;
    }

    collectGroundBridgeRoadsInBounds(bounds = null) {
        const queryBounds = bounds && typeof bounds === "object" ? bounds : null;
        if (queryBounds) {
            for (const key of ["minX", "minY", "maxX", "maxY"]) {
                if (!Number.isFinite(Number(queryBounds[key]))) {
                    throw new Error("bridge road bounds must be finite");
                }
            }
        }
        const out = [];
        const seen = new Set();
        const addRoad = (road) => {
            if (!road || seen.has(road)) return;
            const polygon = this.getGroundBridgeRoadPolygon(road);
            if (!polygon) return;
            const roadBounds = getPolygonBounds2D(polygon);
            if (!roadBounds) return;
            if (queryBounds && !polygonBoundsOverlap2D(queryBounds, roadBounds)) return;
            seen.add(road);
            out.push({ road, polygon, bounds: roadBounds });
        };
        const objectState = this._prototypeObjectState || null;
        if (objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map) {
            for (const road of objectState.activeRuntimeObjectsByRecordId.values()) addRoad(road);
        }
        if (Array.isArray(objectState && objectState.activeRuntimeObjects)) {
            for (let i = 0; i < objectState.activeRuntimeObjects.length; i++) addRoad(objectState.activeRuntimeObjects[i]);
        }
        if (Array.isArray(this.objects)) {
            for (let i = 0; i < this.objects.length; i++) addRoad(this.objects[i]);
        }
        if (out.length === 0 && Array.isArray(this.nodes)) {
            for (let x = 0; x < this.nodes.length; x++) {
                const column = this.nodes[x];
                if (!Array.isArray(column)) continue;
                for (let y = 0; y < column.length; y++) {
                    const node = column[y];
                    const objects = Array.isArray(node && node.objects) ? node.objects : [];
                    for (let i = 0; i < objects.length; i++) addRoad(objects[i]);
                }
            }
        }
        return out;
    }

    collectGroundBridgeRoadsAtPoint(x, y, roads = null) {
        const px = Number(x);
        const py = Number(y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) {
            throw new Error("bridge road point query requires a finite point");
        }
        const candidates = Array.isArray(roads)
            ? roads
            : this.collectGroundBridgeRoadsInBounds({ minX: px, minY: py, maxX: px, maxY: py });
        const out = [];
        for (let i = 0; i < candidates.length; i++) {
            const entry = candidates[i];
            const road = entry && entry.road ? entry.road : entry;
            const polygon = entry && Array.isArray(entry.polygon)
                ? entry.polygon
                : this.getGroundBridgeRoadPolygon(road);
            if (!polygon || polygon.length < 3) continue;
            if (pointInPolygon2D(px, py, polygon)) out.push({ road, polygon });
        }
        return out;
    }

    getGroundBridgeRoadAtPoint(x, y, roads = null) {
        const matches = this.collectGroundBridgeRoadsAtPoint(x, y, roads);
        for (let i = 0; i < matches.length; i++) {
            if (this.isGroundTerrainWaterAtPoint(x, y)) return matches[i];
        }
        return null;
    }

    getGroundBridgeSubmergedDepthAtPoint(x, y) {
        const immersion = this.getGroundTerrainWaterImmersionAtPoint(x, y);
        return immersion && immersion.inWater === true && Number.isFinite(Number(immersion.submergedDepth))
            ? Math.max(0, Number(immersion.submergedDepth))
            : 0;
    }

    getActorBridgeMovementState(actor = null, x = null, y = null, options = {}) {
        const px = Number.isFinite(Number(x)) ? Number(x) : Number(actor && actor.x);
        const py = Number.isFinite(Number(y)) ? Number(y) : Number(actor && actor.y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
        const layer = Number.isFinite(actor && actor.currentLayer)
            ? Math.round(Number(actor.currentLayer))
            : (Number.isFinite(actor && actor.traversalLayer) ? Math.round(Number(actor.traversalLayer)) : 0);
        if (layer !== 0) return null;
        const bridge = this.getGroundBridgeRoadAtPoint(px, py, options && options.bridgeRoads);
        if (!bridge) return null;
        const submergedDepth = this.getGroundBridgeSubmergedDepthAtPoint(px, py);
        const previous = actor && actor._bridgeMovementState && actor._bridgeMovementState.onBridge === true
            ? actor._bridgeMovementState
            : null;
        const allowExistingBridgePosition = options && options.allowExistingBridgePosition === true;
        const climbDepth = Number.isFinite(Number(options && options.maxClimbSubmergedDepth))
            ? Math.max(0, Number(options.maxClimbSubmergedDepth))
            : 0.25;
        if (!previous && !allowExistingBridgePosition && submergedDepth > climbDepth) return null;
        return {
            onBridge: true,
            road: bridge.road,
            roadType: typeof (bridge.road && bridge.road.type) === "string" ? bridge.road.type : "",
            submergedDepth,
            maxClimbSubmergedDepth: climbDepth
        };
    }

    applyActorBridgeMovementState(actor, x = null, y = null, options = {}) {
        if (!actor || typeof actor !== "object") return null;
        const state = this.getActorBridgeMovementState(actor, x, y, options);
        actor._bridgeMovementState = state;
        return state;
    }

    isActorOnGroundBridge(actor = null, x = null, y = null) {
        if (!actor || !actor._bridgeMovementState || actor._bridgeMovementState.onBridge !== true) return false;
        const px = Number.isFinite(Number(x)) ? Number(x) : Number(actor.x);
        const py = Number.isFinite(Number(y)) ? Number(y) : Number(actor.y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
        const bridge = this.getGroundBridgeRoadAtPoint(px, py);
        return !!bridge;
    }

    getGroundBridgeBlockingEdgeSegmentsForPolygon(polygon, options = {}) {
        if (!Array.isArray(polygon) || polygon.length < 3) return [];
        const minDepth = Number.isFinite(Number(options && options.minSubmergedDepth))
            ? Math.max(0, Number(options.minSubmergedDepth))
            : 0.25;
        const sampleDistance = Number.isFinite(Number(options && options.sampleDistance))
            ? Math.max(1e-5, Math.abs(Number(options.sampleDistance)))
            : 0.02;
        const maxSegmentLength = Number.isFinite(Number(options && options.maxSegmentLength))
            ? Math.max(0.05, Math.abs(Number(options.maxSegmentLength)))
            : 0.25;
        const out = [];
        for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i];
            const b = polygon[(i + 1) % polygon.length];
            const ax = Number(a && a.x);
            const ay = Number(a && a.y);
            const bx = Number(b && b.x);
            const by = Number(b && b.y);
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
            const dx = bx - ax;
            const dy = by - ay;
            const len = Math.hypot(dx, dy);
            if (!(len > 1e-9)) continue;
            const nx = -dy / len;
            const ny = dx / len;
            const steps = Math.max(1, Math.ceil(len / maxSegmentLength));
            for (let s = 0; s < steps; s++) {
                const t0 = s / steps;
                const t1 = (s + 1) / steps;
                const tm = (t0 + t1) * 0.5;
                const mx = ax + dx * tm;
                const my = ay + dy * tm;
                const sideAX = mx + nx * sampleDistance;
                const sideAY = my + ny * sampleDistance;
                const sideBX = mx - nx * sampleDistance;
                const sideBY = my - ny * sampleDistance;
                const sideAInsideRoad = pointInPolygon2D(sideAX, sideAY, polygon);
                const sideBInsideRoad = pointInPolygon2D(sideBX, sideBY, polygon);
                if (sideAInsideRoad === sideBInsideRoad) continue;
                const outsideX = sideAInsideRoad ? sideBX : sideAX;
                const outsideY = sideAInsideRoad ? sideBY : sideAY;
                const immersion = this.getGroundTerrainWaterImmersionAtPoint(outsideX, outsideY);
                const submergedDepth = immersion && immersion.inWater === true && Number.isFinite(Number(immersion.submergedDepth))
                    ? Math.max(0, Number(immersion.submergedDepth))
                    : 0;
                if (submergedDepth + 1e-9 < minDepth) continue;
                const insideNormalX = sideAInsideRoad ? nx : -nx;
                const insideNormalY = sideAInsideRoad ? ny : -ny;
                out.push({
                    ax: ax + dx * t0,
                    ay: ay + dy * t0,
                    bx: ax + dx * t1,
                    by: ay + dy * t1,
                    insideNormalX,
                    insideNormalY,
                    submergedDepth
                });
            }
        }
        return out;
    }

    getGroundBridgeBarrierPushForSegments(hitbox, segments, mode = "swimming") {
        const cx = Number(hitbox && hitbox.x);
        const cy = Number(hitbox && hitbox.y);
        const radius = Number(hitbox && hitbox.radius);
        if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(radius) || radius < 0) {
            throw new Error("bridge boundary collision requires a finite circle hitbox");
        }
        const source = Array.isArray(segments) ? segments : [];
        let best = null;
        for (let i = 0; i < source.length; i++) {
            const segment = source[i];
            const ax = Number(segment && segment.ax);
            const ay = Number(segment && segment.ay);
            const bx = Number(segment && segment.bx);
            const by = Number(segment && segment.by);
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
            const closest = getClosestPointOnSegment2D(cx, cy, ax, ay, bx, by);
            const closestDx = cx - closest.x;
            const closestDy = cy - closest.y;
            const closestDistSq = (closestDx * closestDx) + (closestDy * closestDy);
            if (closestDistSq > (radius * radius) + 1e-9) continue;
            const insideNormalX = Number(segment.insideNormalX);
            const insideNormalY = Number(segment.insideNormalY);
            const normalLen = Math.hypot(insideNormalX, insideNormalY);
            if (!(normalLen > 1e-9)) continue;
            const nx = mode === "onBridge" ? insideNormalX / normalLen : -insideNormalX / normalLen;
            const ny = mode === "onBridge" ? insideNormalY / normalLen : -insideNormalY / normalLen;
            const signedDistance = ((cx - closest.x) * nx) + ((cy - closest.y) * ny);
            const pushDistance = radius - signedDistance;
            if (!(pushDistance > 1e-6)) continue;
            const score = pushDistance;
            if (!best || score > best.score) {
                best = {
                    score,
                    pushX: nx * pushDistance,
                    pushY: ny * pushDistance,
                    submergedDepth: Number.isFinite(Number(segment.submergedDepth)) ? Number(segment.submergedDepth) : 0
                };
            }
        }
        return best ? {
            pushX: best.pushX,
            pushY: best.pushY,
            submergedDepth: best.submergedDepth
        } : null;
    }

    resolveGroundBridgeHitboxCollision(hitbox, options = {}) {
        const cx = Number(hitbox && hitbox.x);
        const cy = Number(hitbox && hitbox.y);
        const radius = Number(hitbox && hitbox.radius);
        if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(radius) || radius < 0) {
            throw new Error("bridge collision requires a finite circle hitbox");
        }
        const actor = options && options.actor ? options.actor : null;
        const actorOnBridge = !!(actor && actor._bridgeMovementState && actor._bridgeMovementState.onBridge === true);
        const roads = Array.isArray(options && options.bridgeRoads)
            ? options.bridgeRoads
            : this.collectGroundBridgeRoadsInBounds({
                minX: cx - radius,
                minY: cy - radius,
                maxX: cx + radius,
                maxY: cy + radius
            });
        if (roads.length === 0) return null;
        const climbDepth = Number.isFinite(Number(options && options.maxClimbSubmergedDepth))
            ? Math.max(0, Number(options.maxClimbSubmergedDepth))
            : 0.25;
        if (actorOnBridge) {
            if (actor && actor.isJumping === true) return null;
            const stateRoad = actor._bridgeMovementState.road || null;
            for (let i = 0; i < roads.length; i++) {
                const entry = roads[i];
                const road = entry && entry.road ? entry.road : entry;
                if (stateRoad && road !== stateRoad) continue;
                const polygon = entry && Array.isArray(entry.polygon)
                    ? entry.polygon
                    : this.getGroundBridgeRoadPolygon(road);
                const segments = this.getGroundBridgeBlockingEdgeSegmentsForRoad(road, polygon, {
                    minSubmergedDepth: climbDepth
                });
                const push = this.getGroundBridgeBarrierPushForSegments(hitbox, segments, "onBridge");
                if (push) return { ...push, bridge: road, bridgeMode: "onBridge" };
            }
            return null;
        }

        const immersion = this.getGroundTerrainWaterImmersionAtPoint(cx, cy);
        if (!immersion || immersion.inWater !== true) return null;
        const submergedDepth = Number.isFinite(Number(immersion.submergedDepth))
            ? Math.max(0, Number(immersion.submergedDepth))
            : 0;
        if (submergedDepth <= climbDepth) return null;

        for (let i = 0; i < roads.length; i++) {
            const entry = roads[i];
            const road = entry && entry.road ? entry.road : entry;
            const polygon = entry && Array.isArray(entry.polygon)
                ? entry.polygon
                : this.getGroundBridgeRoadPolygon(road);
            if (!polygon || polygon.length < 3) continue;
            const segments = this.getGroundBridgeBlockingEdgeSegmentsForRoad(road, polygon, {
                minSubmergedDepth: climbDepth
            });
            const collision = this.getGroundBridgeBarrierPushForSegments(hitbox, segments, "swimming");
            if (collision) return { ...collision, bridge: road, bridgeMode: "swimming" };
        }
        return null;
    }

    getGroundBridgeBarrierMovementMode(actor = null, x = null, y = null, options = {}) {
        const px = Number.isFinite(Number(x)) ? Number(x) : Number(actor && actor.x);
        const py = Number.isFinite(Number(y)) ? Number(y) : Number(actor && actor.y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) {
            throw new Error("bridge barrier movement mode requires a finite point");
        }
        const layer = Number.isFinite(actor && actor.currentLayer)
            ? Math.round(Number(actor.currentLayer))
            : (Number.isFinite(actor && actor.traversalLayer) ? Math.round(Number(actor.traversalLayer)) : 0);
        if (layer !== 0) return null;
        const climbDepth = Number.isFinite(Number(options && options.maxClimbSubmergedDepth))
            ? Math.max(0, Number(options.maxClimbSubmergedDepth))
            : 0.25;
        if (actor && actor._bridgeMovementState && actor._bridgeMovementState.onBridge === true) {
            return actor.isJumping === true ? null : "onBridge";
        }
        if (actor && actor.isJumping !== true && this.getGroundBridgeRoadAtPoint(px, py, options && options.bridgeRoads)) {
            return "onBridge";
        }
        const immersion = this.getGroundTerrainWaterImmersionAtPoint(px, py);
        if (!immersion || immersion.inWater !== true) return null;
        const submergedDepth = Number.isFinite(Number(immersion.submergedDepth))
            ? Math.max(0, Number(immersion.submergedDepth))
            : 0;
        return submergedDepth > climbDepth ? "swimming" : null;
    }

    getGroundBridgeMovementBarrierSegments(actor = null, fromX = null, fromY = null, toX = null, toY = null, radius = 0, options = {}) {
        const startX = Number(fromX);
        const startY = Number(fromY);
        const endX = Number(toX);
        const endY = Number(toY);
        const resolvedRadius = Math.max(0, Number(radius) || 0);
        if (!Number.isFinite(startX) || !Number.isFinite(startY) || !Number.isFinite(endX) || !Number.isFinite(endY)) {
            throw new Error("bridge barrier segment query requires finite movement points");
        }
        const bridgeMode = this.getGroundBridgeBarrierMovementMode(actor, startX, startY, options);
        if (!bridgeMode) return [];
        const climbDepth = Number.isFinite(Number(options && options.maxClimbSubmergedDepth))
            ? Math.max(0, Number(options.maxClimbSubmergedDepth))
            : 0.25;
        const roads = Array.isArray(options && options.bridgeRoads)
            ? options.bridgeRoads
            : this.collectGroundBridgeRoadsInBounds({
                minX: Math.min(startX, endX) - resolvedRadius,
                minY: Math.min(startY, endY) - resolvedRadius,
                maxX: Math.max(startX, endX) + resolvedRadius,
                maxY: Math.max(startY, endY) + resolvedRadius
            });
        if (roads.length === 0) return [];
        const actorBridgeRoad = bridgeMode === "onBridge" && actor && actor._bridgeMovementState
            ? actor._bridgeMovementState.road || null
            : null;
        const out = [];
        for (let i = 0; i < roads.length; i++) {
            const entry = roads[i];
            const road = entry && entry.road ? entry.road : entry;
            if (actorBridgeRoad && road !== actorBridgeRoad) continue;
            const polygon = entry && Array.isArray(entry.polygon)
                ? entry.polygon
                : this.getGroundBridgeRoadPolygon(road);
            if (!polygon || polygon.length < 3) continue;
            const segments = this.getGroundBridgeBlockingEdgeSegmentsForRoad(road, polygon, {
                minSubmergedDepth: climbDepth
            });
            for (let j = 0; j < segments.length; j++) {
                out.push({
                    ...segments[j],
                    bridge: road,
                    bridgeMode
                });
            }
        }
        return out;
    }

    resolveGroundBridgeMovementSegmentCollision(fromX, fromY, toX, toY, radius = 0, options = {}) {
        const startX = Number(fromX);
        const startY = Number(fromY);
        const endX = Number(toX);
        const endY = Number(toY);
        const resolvedRadius = Math.max(0, Number(radius) || 0);
        if (!Number.isFinite(startX) || !Number.isFinite(startY) || !Number.isFinite(endX) || !Number.isFinite(endY)) {
            throw new Error("bridge barrier movement collision requires finite movement points");
        }
        const moveX = endX - startX;
        const moveY = endY - startY;
        const moveLen = Math.hypot(moveX, moveY);
        if (!(moveLen > 1e-9)) return null;
        const actor = options && options.actor ? options.actor : null;
        const segments = Array.isArray(options && options.bridgeBarrierSegments)
            ? options.bridgeBarrierSegments
            : this.getGroundBridgeMovementBarrierSegments(actor, startX, startY, endX, endY, resolvedRadius, options);
        if (segments.length === 0) return null;
        let best = null;
        const eps = 1e-7;
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            const ax = Number(segment && segment.ax);
            const ay = Number(segment && segment.ay);
            const bx = Number(segment && segment.bx);
            const by = Number(segment && segment.by);
            const insideNormalX = Number(segment && segment.insideNormalX);
            const insideNormalY = Number(segment && segment.insideNormalY);
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by) ||
                !Number.isFinite(insideNormalX) || !Number.isFinite(insideNormalY)) {
                continue;
            }
            const edgeX = bx - ax;
            const edgeY = by - ay;
            const denom = moveX * edgeY - moveY * edgeX;
            if (Math.abs(denom) <= eps) continue;
            const relX = ax - startX;
            const relY = ay - startY;
            const t = (relX * edgeY - relY * edgeX) / denom;
            const u = (relX * moveY - relY * moveX) / denom;
            if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) continue;

            const fromSide = (startX - ax) * insideNormalX + (startY - ay) * insideNormalY;
            const toSide = (endX - ax) * insideNormalX + (endY - ay) * insideNormalY;
            const mode = segment.bridgeMode === "onBridge" ? "onBridge" : "swimming";
            const crossesBlockedSide = mode === "onBridge"
                ? fromSide >= -eps && toSide < -eps
                : fromSide <= eps && toSide > eps;
            if (!crossesBlockedSide) continue;
            if (best && t >= best.t) continue;
            const normalX = mode === "onBridge" ? insideNormalX : -insideNormalX;
            const normalY = mode === "onBridge" ? insideNormalY : -insideNormalY;
            const normalLen = Math.hypot(normalX, normalY);
            if (!(normalLen > 1e-9)) continue;
            const backoff = Math.max(0.005, Math.min(0.03, Math.max(resolvedRadius, 0.1) * 0.15));
            const safeT = Math.max(0, Math.min(1, t - backoff / moveLen));
            best = {
                t,
                x: startX + moveX * safeT,
                y: startY + moveY * safeT,
                normalX: normalX / normalLen,
                normalY: normalY / normalLen,
                bridge: segment.bridge || null,
                bridgeMode: mode
            };
        }
        if (!best) return null;
        return {
            x: best.x,
            y: best.y,
            pushX: best.normalX * Math.max(0.05, Math.min(0.15, resolvedRadius || 0.05)),
            pushY: best.normalY * Math.max(0.05, Math.min(0.15, resolvedRadius || 0.05)),
            normalX: best.normalX,
            normalY: best.normalY,
            hasNormal: true,
            bridge: best.bridge,
            bridgeMode: best.bridgeMode
        };
    }

    getGroundTerrainWaterImmersionAtPoint(x, y, options = {}) {
        const px = Number(x);
        const py = Number(y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) {
            throw new Error("water immersion query requires a finite point");
        }
        const rawTraversalLayer = Number(options && options.traversalLayer);
        const traversalLayer = Number.isFinite(rawTraversalLayer)
            ? Math.round(rawTraversalLayer)
            : 0;
        const defaultSlope = Number.isFinite(Number(options && options.slope))
            ? Math.max(0, Number(options.slope))
            : (2 / 3);
        const defaultMaxDepth = Number.isFinite(Number(options && options.maxDepth))
            ? Math.max(0, Number(options.maxDepth))
            : (2 / 3);
        if (traversalLayer !== 0) {
            return { inWater: false, distanceToShore: 0, submergedDepth: 0, slope: defaultSlope, maxDepth: defaultMaxDepth };
        }
        const candidates = this.collectGroundTerrainCollisionPolygons({
            minX: px,
            minY: py,
            maxX: px,
            maxY: py
        });
        let bestDistanceSq = Infinity;
        let bestPolygon = null;
        for (let i = 0; i < candidates.length; i++) {
            const entry = candidates[i];
            const polygon = entry && entry.polygon ? entry.polygon : null;
            if (!polygon || entry.terrainType !== "water") continue;
            if (!this.terrainPolygonContainsPoint(polygon, px, py)) continue;
            const distanceSq = this.getGroundTerrainWaterShoreDistanceSqForPolygon(px, py, polygon);
            if (distanceSq < bestDistanceSq) {
                bestDistanceSq = distanceSq;
                bestPolygon = polygon;
            }
        }
        if (!bestPolygon) {
            return { inWater: false, distanceToShore: 0, submergedDepth: 0, slope: defaultSlope, maxDepth: defaultMaxDepth };
        }
        if (!Number.isFinite(bestDistanceSq)) bestDistanceSq = 0;
        const distanceToShore = Math.sqrt(Math.max(0, bestDistanceSq));
        const polygonSlope = Number.isFinite(Number(bestPolygon.depthSlope))
            ? Number(bestPolygon.depthSlope)
            : (Number.isFinite(Number(bestPolygon.waterDepthSlope)) ? Number(bestPolygon.waterDepthSlope) : defaultSlope);
        const polygonMaxDepth = Number.isFinite(Number(bestPolygon.maxDepth))
            ? Number(bestPolygon.maxDepth)
            : (Number.isFinite(Number(bestPolygon.waterMaxDepth)) ? Number(bestPolygon.waterMaxDepth) : defaultMaxDepth);
        const slope = Math.max(0, polygonSlope);
        const maxDepth = Math.max(0, polygonMaxDepth);
        return {
            inWater: true,
            distanceToShore,
            submergedDepth: Math.min(maxDepth, distanceToShore * slope),
            slope,
            maxDepth,
            polygon: bestPolygon
        };
    }

    collectGroundTerrainSectionContinuitySourceNodes(sectionKey) {
        const key = typeof sectionKey === "string" ? sectionKey : "";
        if (!key) {
            throw new Error("terrain section continuity source collection requires a section key");
        }
        const state = this._prototypeSectionState || null;
        const sectionNodes = state && state.nodesBySectionKey instanceof Map
            ? (state.nodesBySectionKey.get(key) || null)
            : null;
        if (!Array.isArray(sectionNodes)) {
            throw new Error(`terrain section continuity requires loaded nodes for section ${key}`);
        }
        const dirs = [1, 3, 5, 7, 9, 11];
        const nodesByKey = new Map();
        const addNode = (candidate) => {
            if (!candidate || candidate._prototypeVoid === true) return;
            nodesByKey.set(this.getGroundTerrainNodeKey(candidate), candidate);
        };
        const resolveNeighbor = (node, direction) => {
            const direct = node && node.neighbors && node.neighbors[direction] ? node.neighbors[direction] : null;
            if (direct) return direct;
            const offset = node && node.neighborOffsets && node.neighborOffsets[direction] ? node.neighborOffsets[direction] : null;
            if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return null;
            return this.getGroundTerrainNodeAtCoord(
                Number(node.xindex) + Number(offset.x),
                Number(node.yindex) + Number(offset.y)
            );
        };
        for (let i = 0; i < sectionNodes.length; i++) {
            const node = sectionNodes[i];
            addNode(node);
            for (let d = 0; d < dirs.length; d++) {
                addNode(resolveNeighbor(node, dirs[d]));
            }
        }
        return Array.from(nodesByKey.values());
    }

    collectGroundTerrainSectionRebuildKeys(sectionKey) {
        const key = typeof sectionKey === "string" ? sectionKey : "";
        if (!key) return [];
        const state = this._prototypeSectionState || null;
        const sectionNodes = state && state.nodesBySectionKey instanceof Map
            ? (state.nodesBySectionKey.get(key) || null)
            : null;
        if (!Array.isArray(sectionNodes)) {
            throw new Error(`terrain section rebuild requires loaded nodes for section ${key}`);
        }
        const dirs = [1, 3, 5, 7, 9, 11];
        const keys = new Set([key]);
        const addNeighborKey = (neighbor) => {
            const neighborKey = typeof (neighbor && neighbor._prototypeSectionKey) === "string"
                ? neighbor._prototypeSectionKey
                : "";
            if (neighborKey) keys.add(neighborKey);
        };
        const resolveNeighbor = (node, direction) => {
            const direct = node && node.neighbors && node.neighbors[direction] ? node.neighbors[direction] : null;
            if (direct) return direct;
            const offset = node && node.neighborOffsets && node.neighborOffsets[direction] ? node.neighborOffsets[direction] : null;
            if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return null;
            return this.getGroundTerrainNodeAtCoord(
                Number(node.xindex) + Number(offset.x),
                Number(node.yindex) + Number(offset.y)
            );
        };
        for (let i = 0; i < sectionNodes.length; i++) {
            const node = sectionNodes[i];
            for (let d = 0; d < dirs.length; d++) {
                addNeighborKey(resolveNeighbor(node, dirs[d]));
            }
        }
        return Array.from(keys);
    }

    buildGroundTerrainPolygonsForSection(sectionKey) {
        const key = typeof sectionKey === "string" ? sectionKey : "";
        if (!key) {
            throw new Error("terrain section polygon rebuild requires a section key");
        }
        const sourceNodes = this.collectGroundTerrainSectionContinuitySourceNodes(key);
        return this.buildGroundTerrainPolygonsFromNodes(sourceNodes, { requiredSectionKey: key });
    }

    syncGroundTerrainTilesForSectionAsset(asset, sectionKey) {
        const key = typeof sectionKey === "string" && sectionKey.length > 0
            ? sectionKey
            : (typeof (asset && asset.key) === "string" ? asset.key : "");
        if (!asset || typeof asset !== "object") {
            throw new Error(`terrain section tile sync requires a section asset for ${key || "(unknown)"}`);
        }
        if (!key) {
            throw new Error("terrain section tile sync requires a section key");
        }
        const state = this._prototypeSectionState || null;
        const sectionNodes = state && state.nodesBySectionKey instanceof Map
            ? (state.nodesBySectionKey.get(key) || null)
            : null;
        if (!Array.isArray(sectionNodes)) {
            throw new Error(`terrain section tile sync requires loaded nodes for section ${key}`);
        }
        const tileCoordKeys = Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys : [];
        const tileKeySet = new Set(tileCoordKeys);
        const nextGroundTiles = asset.groundTiles && typeof asset.groundTiles === "object"
            ? { ...asset.groundTiles }
            : {};
        let synced = 0;
        for (let i = 0; i < sectionNodes.length; i++) {
            const node = sectionNodes[i];
            if (!node || node._prototypeVoid === true) continue;
            const x = Number(node.xindex);
            const y = Number(node.yindex);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                throw new Error(`section ${key} terrain node ${i} is missing tile coordinates`);
            }
            const coordKey = `${Math.round(x)},${Math.round(y)}`;
            if (tileKeySet.size > 0 && !tileKeySet.has(coordKey)) {
                throw new Error(`section ${key} terrain node ${coordKey} is missing from tileCoordKeys`);
            }
            const textureId = Math.floor(Number(node.groundTextureId));
            if (!Number.isFinite(textureId) || textureId < 0) {
                throw new Error(`section ${key} groundTiles.${coordKey} must be a finite non-negative terrain texture id`);
            }
            getGroundTerrainDefForTextureId(textureId);
            nextGroundTiles[coordKey] = textureId;
            synced += 1;
        }
        for (let i = 0; i < tileCoordKeys.length; i++) {
            const coordKey = tileCoordKeys[i];
            if (typeof coordKey !== "string" || coordKey.length === 0) continue;
            if (!Object.prototype.hasOwnProperty.call(nextGroundTiles, coordKey)) {
                throw new Error(`section ${key} terrain edit could not sync groundTiles.${coordKey}`);
            }
        }
        if (synced === 0 && tileCoordKeys.length > 0) {
            throw new Error(`section ${key} terrain edit could not sync any ground tiles`);
        }
        asset.groundTiles = nextGroundTiles;
        return synced;
    }

    syncGroundTerrainEditedTileForSectionAsset(asset, sectionKey, node) {
        const key = typeof sectionKey === "string" && sectionKey.length > 0
            ? sectionKey
            : (typeof (asset && asset.key) === "string" ? asset.key : "");
        if (!asset || typeof asset !== "object") {
            throw new Error(`terrain section tile edit requires a section asset for ${key || "(unknown)"}`);
        }
        if (!key) {
            throw new Error("terrain section tile edit requires a section key");
        }
        const x = Number(node && node.xindex);
        const y = Number(node && node.yindex);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error(`section ${key} terrain edit node is missing tile coordinates`);
        }
        const coordKey = `${Math.round(x)},${Math.round(y)}`;
        const tileCoordKeys = Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys : [];
        if (tileCoordKeys.length > 0 && !tileCoordKeys.includes(coordKey)) {
            throw new Error(`section ${key} terrain edit node ${coordKey} is missing from tileCoordKeys`);
        }
        const textureId = Math.floor(Number(node.groundTextureId));
        if (!Number.isFinite(textureId) || textureId < 0) {
            throw new Error(`section ${key} groundTiles.${coordKey} must be a finite non-negative terrain texture id`);
        }
        getGroundTerrainDefForTextureId(textureId);
        asset.groundTiles = asset.groundTiles && typeof asset.groundTiles === "object"
            ? { ...asset.groundTiles, [coordKey]: textureId }
            : { [coordKey]: textureId };
        return true;
    }

    collectGroundTerrainPatchPolygonSources(options = {}) {
        const sectionKey = options && typeof options.sectionKey === "string" ? options.sectionKey : "";
        const asset = options && options.asset ? options.asset : null;
        const state = this._prototypeSectionState || null;
        if (sectionKey || asset) {
            const out = [];
            if (state && state.sectionAssetsByKey instanceof Map) {
                for (const [key, sectionAsset] of state.sectionAssetsByKey.entries()) {
                    if (!sectionAsset) continue;
                    out.push({
                        kind: "section",
                        key,
                        asset: sectionAsset,
                        polygons: Array.isArray(sectionAsset.terrainPolygons) ? sectionAsset.terrainPolygons : []
                    });
                }
            } else if (asset) {
                out.push({
                    kind: "section",
                    key: sectionKey || (typeof asset.key === "string" ? asset.key : ""),
                    asset,
                    polygons: Array.isArray(asset.terrainPolygons) ? asset.terrainPolygons : []
                });
            }
            if (out.length === 0) {
                throw new Error(`terrain local patch could not resolve section polygon sources for ${sectionKey || "(unknown)"}`);
            }
            return out;
        }
        return [{
            kind: "map",
            key: "",
            asset: null,
            polygons: Array.isArray(this.terrainPolygons) ? this.terrainPolygons : []
        }];
    }

    getGroundTerrainSectionClipGeometry(sectionKey, asset) {
        const key = typeof sectionKey === "string" ? sectionKey : "";
        const explicitPolygon = Array.isArray(asset && asset.sectionPolygon) ? asset.sectionPolygon : null;
        if (explicitPolygon && explicitPolygon.length >= 3) {
            const ring = polygonToClipRing2D(explicitPolygon);
            if (ring) return [[ring]];
        }
        const state = this._prototypeSectionState || null;
        const section = (
            state &&
            state.sectionsByKey instanceof Map &&
            key
        ) ? (state.sectionsByKey.get(key) || null) : null;
        const centerAxial = (
            asset &&
            asset.centerAxial &&
            Number.isFinite(Number(asset.centerAxial.q)) &&
            Number.isFinite(Number(asset.centerAxial.r))
        ) ? asset.centerAxial : (
            section &&
            section.centerAxial &&
            Number.isFinite(Number(section.centerAxial.q)) &&
            Number.isFinite(Number(section.centerAxial.r))
        ) ? section.centerAxial : null;
        const geometryApi = (typeof globalThis !== "undefined" && globalThis.__sectionGeometry)
            ? globalThis.__sectionGeometry
            : null;
        const polygon = (
            geometryApi &&
            typeof geometryApi.getSectionHexagonCorners === "function" &&
            centerAxial &&
            state &&
            state.basis
        ) ? geometryApi.getSectionHexagonCorners(centerAxial, state.basis) : null;
        const ring = polygonToClipRing2D(polygon);
        if (ring) return [[ring]];
        throw new Error(`terrain local patch cannot split section ${key || "(unknown)"} without section polygon geometry`);
    }

    getGroundTerrainDebugPointKey(point) {
        const x = Number(point && point.x);
        const y = Number(point && point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error("terrain paint debug segment requires finite points");
        }
        const scale = 1000000;
        const ix = Math.round(x * scale);
        const iy = Math.round(y * scale);
        return `${Object.is(ix, -0) ? 0 : ix},${Object.is(iy, -0) ? 0 : iy}`;
    }

    getGroundTerrainDebugSegmentKey(a, b) {
        const ak = this.getGroundTerrainDebugPointKey(a);
        const bk = this.getGroundTerrainDebugPointKey(b);
        return ak < bk ? `${ak}:${bk}` : `${bk}:${ak}`;
    }

    cloneGroundTerrainDebugPoint(point) {
        const x = Number(point && point.x);
        const y = Number(point && point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error("terrain paint debug segment requires finite points");
        }
        return { x, y };
    }

    collectGroundTerrainDebugRingSegments(points, type = "") {
        const ring = this.simplifyGroundTerrainPolygonPoints(points);
        if (ring.length < 3) return [];
        const out = [];
        for (let i = 0; i < ring.length; i++) {
            const a = this.cloneGroundTerrainDebugPoint(ring[i]);
            const b = this.cloneGroundTerrainDebugPoint(ring[(i + 1) % ring.length]);
            if (Math.hypot(b.x - a.x, b.y - a.y) <= 1e-9) continue;
            out.push({
                a,
                b,
                key: this.getGroundTerrainDebugSegmentKey(a, b),
                type
            });
        }
        return out;
    }

    collectGroundTerrainDebugPathSegments(points, type = "") {
        const path = this.dedupeGroundTerrainPathPoints(points);
        if (path.length < 2) return [];
        const out = [];
        for (let i = 1; i < path.length; i++) {
            const a = this.cloneGroundTerrainDebugPoint(path[i - 1]);
            const b = this.cloneGroundTerrainDebugPoint(path[i]);
            if (Math.hypot(b.x - a.x, b.y - a.y) <= 1e-9) continue;
            out.push({
                a,
                b,
                key: this.getGroundTerrainDebugSegmentKey(a, b),
                type
            });
        }
        return out;
    }

    collectGroundTerrainDebugPolygonSegments(polygons) {
        const source = Array.isArray(polygons) ? polygons : [];
        const out = [];
        for (let p = 0; p < source.length; p++) {
            const polygon = source[p];
            if (!polygon) continue;
            const type = typeof polygon.type === "string" ? polygon.type : "";
            out.push(...this.collectGroundTerrainDebugRingSegments(polygon.points, type));
            const holes = Array.isArray(polygon.holes) ? polygon.holes : [];
            for (let h = 0; h < holes.length; h++) {
                out.push(...this.collectGroundTerrainDebugRingSegments(holes[h], type));
            }
        }
        return out;
    }

    groundTerrainDebugSegmentOverlapsBounds(segment, bounds) {
        if (!bounds) return true;
        const pad = 0.001;
        const minX = Math.min(Number(segment.a.x), Number(segment.b.x));
        const maxX = Math.max(Number(segment.a.x), Number(segment.b.x));
        const minY = Math.min(Number(segment.a.y), Number(segment.b.y));
        const maxY = Math.max(Number(segment.a.y), Number(segment.b.y));
        if (
            !Number.isFinite(minX) ||
            !Number.isFinite(maxX) ||
            !Number.isFinite(minY) ||
            !Number.isFinite(maxY)
        ) {
            throw new Error("terrain paint debug segment bounds require finite points");
        }
        return !(
            maxX < Number(bounds.minX) - pad ||
            minX > Number(bounds.maxX) + pad ||
            maxY < Number(bounds.minY) - pad ||
            minY > Number(bounds.maxY) + pad
        );
    }

    collectGroundTerrainModifiedDebugSegments(beforePolygons, afterPolygons, bounds = null) {
        const beforeKeys = new Set(this.collectGroundTerrainDebugPolygonSegments(beforePolygons).map(segment => segment.key));
        const afterSegments = this.collectGroundTerrainDebugPolygonSegments(afterPolygons);
        const out = [];
        const seen = new Set();
        for (let i = 0; i < afterSegments.length; i++) {
            const segment = afterSegments[i];
            if (beforeKeys.has(segment.key)) continue;
            if (!this.groundTerrainDebugSegmentOverlapsBounds(segment, bounds)) continue;
            if (seen.has(segment.key)) continue;
            seen.add(segment.key);
            out.push({
                a: segment.a,
                b: segment.b,
                type: segment.type
            });
        }
        return out;
    }

    recordGroundTerrainPaintDebugEdit(node, terrainType, options = {}) {
        if (!node) return;
        const sectionKeys = Array.isArray(options && options.sectionKeys)
            ? options.sectionKeys.filter(key => typeof key === "string" && key.length > 0)
            : [];
        const modifiedSegments = Array.isArray(options && options.modifiedSegments)
            ? options.modifiedSegments.map(segment => ({
                a: this.cloneGroundTerrainDebugPoint(segment && segment.a),
                b: this.cloneGroundTerrainDebugPoint(segment && segment.b),
                type: typeof (segment && segment.type) === "string" ? segment.type : ""
            }))
            : [];
        const rawReplacementSegments = Array.isArray(options && options.rawReplacementSegments)
            ? options.rawReplacementSegments.map(segment => ({
                a: this.cloneGroundTerrainDebugPoint(segment && segment.a),
                b: this.cloneGroundTerrainDebugPoint(segment && segment.b),
                type: typeof (segment && segment.type) === "string" ? segment.type : ""
            }))
            : [];
        this._terrainPaintDebugLastEdit = {
            sequence: (Number(this._terrainPaintDebugEditSequence) || 0) + 1,
            terrainType: typeof terrainType === "string" ? terrainType : "",
            nodeKey: this.getGroundTerrainNodeKey(node),
            editedHex: this.getGroundTerrainHexCorners(node).map(point => ({
                x: Number(point.x),
                y: Number(point.y)
            })),
            sectionKeys,
            rawReplacementSegments,
            modifiedSegments
        };
        this._terrainPaintDebugEditSequence = this._terrainPaintDebugLastEdit.sequence;
    }

    replaceGroundTerrainPolygonPatch(node, terrainType, options = {}) {
        if (!node) {
            throw new Error("terrain patch replacement requires an edited node");
        }
        const nextType = (typeof terrainType === "string" && terrainType.length > 0) ? terrainType : "grass";
        this.getGroundTerrainTextureIdForType(nextType, node.xindex, node.yindex);
        const asset = options && options.asset ? options.asset : null;
        const currentType = this.getGroundTerrainTypeForNode(node);
        if (currentType === nextType) {
            return false;
        }
        const sectionKey = options && typeof options.sectionKey === "string" ? options.sectionKey : "";
        const patchNodes = this.collectGroundTerrainLocalPatchNodes(node);
        const editedNodeKey = this.getGroundTerrainNodeKey(node);
        if (!patchNodes.some((patchNode) => this.getGroundTerrainNodeKey(patchNode) === editedNodeKey)) {
            throw new Error("terrain patch replacement could not include the edited node");
        }
        const previousTextureId = Number.isFinite(node.groundTextureId) ? Number(node.groundTextureId) : 0;
        const sources = this.collectGroundTerrainPatchPolygonSources(options);
        const centerHexPoints = this.getGroundTerrainHexCorners(node);
        const centerHexGeometry = this.getGroundTerrainHexClipGeometry(node);
        // Terrain paint is intentionally a seven-hex local span edit. Do not change
        // this back to full-polygon regeneration or a wider derived tile rebuild
        // without asking; authored vertices outside this bubble must survive paint.
        const affectedNodes = patchNodes;
        const affectedNodeKeys = new Set(affectedNodes.map(affectedNode => this.getGroundTerrainNodeKey(affectedNode)));
        const vertexSlotsByPointKey = this.buildGroundTerrainVertexSlotMap({ nodes: affectedNodes });
        const patchBounds = this.getGroundTerrainHexPatchBounds(affectedNodes);
        const patchNodesByType = new Map();
        for (let i = 0; i < patchNodes.length; i++) {
            const patchNode = patchNodes[i];
            if (!patchNode) continue;
            const patchType = this.getGroundTerrainTypeForNode(patchNode);
            if (!patchNodesByType.has(patchType)) patchNodesByType.set(patchType, []);
            patchNodesByType.get(patchType).push(patchNode);
        }
        const polygonTouchesTerrainPatchType = (polygon, type) => {
            const typedNodes = patchNodesByType.get(type) || [];
            for (let i = 0; i < typedNodes.length; i++) {
                const typedNode = typedNodes[i];
                if (this.groundTerrainPolygonTouchesHex(
                    polygon,
                    this.getGroundTerrainHexCorners(typedNode),
                    this.getGroundTerrainHexClipGeometry(typedNode)
                )) {
                    return true;
                }
            }
            return false;
        };
        const records = [];
        for (let s = 0; s < sources.length; s++) {
            const source = sources[s];
            const normalized = this.normalizeGroundTerrainPolygons(source.polygons);
            for (let p = 0; p < normalized.length; p++) {
                const polygon = normalized[p];
                const centerParticipating = this.groundTerrainPolygonTouchesHex(
                    polygon,
                    centerHexPoints,
                    centerHexGeometry
                );
                const sameTerrainPatchParticipating = !centerParticipating && (
                    polygon.type === nextType ||
                    polygon.type === currentType
                ) && polygonTouchesTerrainPatchType(polygon, polygon.type);
                const localBoundaryParticipating = !centerParticipating &&
                    typeof polygon.type === "string" &&
                    polygon.type !== "grass" &&
                    this.groundTerrainPolygonTouchesAnyPatchHex(polygon, patchNodes) &&
                    polygonTouchesTerrainPatchType(polygon, polygon.type);
                records.push({
                    source,
                    sourceIndex: p,
                    polygon,
                    participating: centerParticipating || sameTerrainPatchParticipating || localBoundaryParticipating
                });
            }
        }
        const participatingRecords = records.filter(record => record.participating);
        const participatingKeySet = new Set(participatingRecords.map(record => `${record.source.key}:${record.sourceIndex}`));
        const typeSet = new Set(participatingRecords.map(record => record.polygon.type));
        const debugBeforePolygons = participatingRecords.map(record => record.polygon);
        if (nextType !== "grass") typeSet.add(nextType);
        this.markMatchingCurrentTileTerrainPolygonsGenerated(debugBeforePolygons);
        this.setGroundTerrainType(node.xindex, node.yindex, nextType);
        const resultPolygonsByType = new Map();
        try {
            for (const type of typeSet) {
                if (type === "grass") continue;
                const typeRecords = participatingRecords.filter(record => record.polygon.type === type);
                const typeRecordsAreGenerated = typeRecords.length > 0 && typeRecords.every(record => (
                    this.groundTerrainPolygonHasGeneratedSignature(record.polygon)
                ));
                if (typeRecordsAreGenerated) {
                    resultPolygonsByType.set(type, []);
                    continue;
                }
                const sourceGeometries = [];
                for (let i = 0; i < typeRecords.length; i++) {
                    sourceGeometries.push(this.groundTerrainPolygonToClipGeometry(typeRecords[i].polygon));
                }
                let geometry = this.unionGroundTerrainClipGeometries(
                    sourceGeometries,
                    `terrain local patch ${type}`
                );
                const operandNodes = typeRecords.length > 0 ? patchNodes : [node];
                for (let i = 0; i < operandNodes.length; i++) {
                    const operandNode = operandNodes[i];
                    if (!operandNode) continue;
                    const operandType = this.getGroundTerrainTypeForNode(operandNode);
                    const include = operandType === type;
                    geometry = this.applyGroundTerrainLocalHexOperand(
                        geometry,
                        this.getGroundTerrainHexClipGeometry(operandNode),
                        include,
                        `terrain local patch ${type}`
                    );
                }
                resultPolygonsByType.set(type, this.groundTerrainClipGeometryToPolygons(type, geometry));
            }
        } catch (err) {
            node.groundTextureId = previousTextureId;
            throw err;
        }
        const patchedPolygonsByType = new Map();
        const generatedPatchedTypes = new Set();
        const debugRawReplacementSegments = [];
        const debugReplacementSegments = [];
        for (const type of typeSet) {
            if (type === "grass") continue;
            const replacements = resultPolygonsByType.get(type) || [];
            const typeRecords = participatingRecords.filter(record => record.polygon.type === type);
            if (typeRecords.length === 0) {
                this.markGroundTerrainPolygonsGenerated(replacements);
                generatedPatchedTypes.add(type);
                patchedPolygonsByType.set(type, replacements);
                continue;
            }
            const polygons = [];
            const usedReplacementIndexes = new Set();
            const repairOptions = {};
            const typeRecordsAreGenerated = typeRecords.every(record => (
                this.groundTerrainPolygonHasGeneratedSignature(record.polygon)
            ));
            if (typeRecordsAreGenerated) {
                const seedNodes = patchNodes.filter(patchNode => (
                    patchNode &&
                    patchNode._prototypeVoid !== true &&
                    this.getGroundTerrainTypeForNode(patchNode) === type
                ));
                const componentNodes = this.collectGroundTerrainConnectedComponentNodesForType(type, seedNodes);
                const rebuiltPolygons = componentNodes.length > 0
                    ? this.buildGroundTerrainPolygonsFromNodes(componentNodes)
                    : [];
                patchedPolygonsByType.set(type, rebuiltPolygons);
                generatedPatchedTypes.add(type);
                debugRawReplacementSegments.push(...this.collectGroundTerrainDebugPolygonSegments(rebuiltPolygons));
                continue;
            }
            if (typeRecords.length > 1) {
                const repairedReplacements = this.getGroundTerrainAffectedReplacementPolygonsForType(
                    type,
                    replacements,
                    affectedNodeKeys,
                    vertexSlotsByPointKey,
                    affectedNodes,
                    repairOptions
                );
                patchedPolygonsByType.set(
                    type,
                    Array.isArray(repairedReplacements && repairedReplacements.polygons)
                        ? repairedReplacements.polygons
                        : []
                );
                debugRawReplacementSegments.push(...(
                    Array.isArray(repairedReplacements && repairedReplacements.rawReplacementSegments)
                        ? repairedReplacements.rawReplacementSegments
                        : []
                ));
                debugReplacementSegments.push(...(
                    Array.isArray(repairedReplacements && repairedReplacements.replacementSegments)
                        ? repairedReplacements.replacementSegments
                        : []
                ));
                continue;
            }
            for (let i = 0; i < typeRecords.length; i++) {
                const repaired = this.repairGroundTerrainPolygonVertices(
                    typeRecords[i].polygon,
                    replacements,
                    affectedNodeKeys,
                    vertexSlotsByPointKey,
                    affectedNodes,
                    repairOptions
                );
                const repairUsedIndexes = repaired && repaired.usedReplacementIndexes instanceof Set
                    ? Array.from(repaired.usedReplacementIndexes)
                    : [];
                const alreadyRepresented = repairUsedIndexes.length > 0 && repairUsedIndexes.every(index => (
                    usedReplacementIndexes.has(index)
                ));
                if (!alreadyRepresented) {
                    polygons.push(...(Array.isArray(repaired && repaired.polygons) ? repaired.polygons : []));
                }
                for (const index of repairUsedIndexes) usedReplacementIndexes.add(index);
                debugRawReplacementSegments.push(...(
                    Array.isArray(repaired && repaired.rawReplacementSegments)
                        ? repaired.rawReplacementSegments
                        : []
                ));
                debugReplacementSegments.push(...(
                    Array.isArray(repaired && repaired.replacementSegments)
                        ? repaired.replacementSegments
                        : []
                ));
            }
            for (let i = 0; i < replacements.length; i++) {
                if (usedReplacementIndexes.has(i)) continue;
                const replacement = replacements[i];
                const outerRuns = this.getGroundTerrainAffectedVertexRuns(
                    replacement.points,
                    affectedNodeKeys,
                    vertexSlotsByPointKey,
                    affectedNodes
                );
                const hasAffectedHole = Array.isArray(replacement.holes) && replacement.holes.some((hole) => (
                    this.getGroundTerrainAffectedVertexRuns(hole, affectedNodeKeys, vertexSlotsByPointKey, affectedNodes).length > 0
                ));
                if (outerRuns.length === 0 && !hasAffectedHole) continue;
                polygons.push(replacement);
            }
            patchedPolygonsByType.set(type, polygons);
        }
        const patchedPolygonsForCanonicalization = [];
        for (const [, polygons] of patchedPolygonsByType.entries()) {
            if (Array.isArray(polygons)) patchedPolygonsForCanonicalization.push(...polygons);
        }
        const patchedPolygonsForCanonicalizationCount = patchedPolygonsForCanonicalization.length;
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            if (!record || record.participating) continue;
            if (!this.groundTerrainPolygonTouchesAnyPatchHex(record.polygon, patchNodes)) continue;
            patchedPolygonsForCanonicalization.push(record.polygon);
        }
        const canonicalPatchedPolygons = this.canonicalizeGroundTerrainNestedPolygonBoundaries(
            patchedPolygonsForCanonicalization
        ).slice(0, patchedPolygonsForCanonicalizationCount);
        const canonicalPatchedPolygonsByType = new Map();
        for (let i = 0; i < canonicalPatchedPolygons.length; i++) {
            const polygon = canonicalPatchedPolygons[i];
            if (!polygon || typeof polygon.type !== "string" || polygon.type.length === 0) continue;
            if (!canonicalPatchedPolygonsByType.has(polygon.type)) {
                canonicalPatchedPolygonsByType.set(polygon.type, []);
            }
            canonicalPatchedPolygonsByType.get(polygon.type).push(polygon);
        }
        for (const type of patchedPolygonsByType.keys()) {
            patchedPolygonsByType.set(type, canonicalPatchedPolygonsByType.get(type) || []);
        }
        if (sectionKey || asset) {
            const sourceByKey = new Map(sources.map(source => [source.key, source]));
            const touchedSectionKeys = new Set(participatingRecords.map(record => record.source.key).filter(Boolean));
            if (sectionKey) touchedSectionKeys.add(sectionKey);
            if (asset && typeof asset.key === "string" && asset.key.length > 0) touchedSectionKeys.add(asset.key);
            const nextPolygonsBySourceKey = new Map();
            for (let s = 0; s < sources.length; s++) {
                const source = sources[s];
                const normalized = this.normalizeGroundTerrainPolygons(source.polygons);
                nextPolygonsBySourceKey.set(source.key, normalized.filter((polygon, index) => (
                    !participatingKeySet.has(`${source.key}:${index}`)
                )));
            }
            const api = getPolygonClippingApi2D();
            if (!api || typeof api.intersection !== "function") {
                throw new Error("terrain local patch section split requires polygon clipping intersection");
            }
            const debugAfterPolygons = [];
            for (const [, polygons] of patchedPolygonsByType.entries()) {
                for (let p = 0; p < polygons.length; p++) {
                    const polygonGeometry = this.groundTerrainPolygonToClipGeometry(polygons[p]);
                    for (const key of touchedSectionKeys) {
                        const source = sourceByKey.get(key);
                        if (!source || !source.asset) continue;
                        const clipGeometry = this.getGroundTerrainSectionClipGeometry(key, source.asset);
                        let clipped = [];
                        try {
                            clipped = api.intersection(polygonGeometry, clipGeometry);
                        } catch (err) {
                            throw new Error(`terrain local patch section split failed for ${key}: ${err && err.message ? err.message : err}`);
                        }
                        const splitPolygons = this.groundTerrainClipGeometryToPolygons(polygons[p].type, clipped);
                        const target = nextPolygonsBySourceKey.get(key);
                        if (!target) {
                            throw new Error(`terrain local patch could not resolve output list for section ${key}`);
                        }
                        target.push(...splitPolygons);
                        if (generatedPatchedTypes.has(polygons[p].type)) {
                            this.markGroundTerrainPolygonsGenerated(splitPolygons);
                        }
                        debugAfterPolygons.push(...splitPolygons);
                    }
                }
            }
            for (const key of touchedSectionKeys) {
                const source = sourceByKey.get(key);
                if (!source || !source.asset) continue;
                source.asset.terrainPolygons = this.normalizeGroundTerrainPolygons(nextPolygonsBySourceKey.get(key) || []);
                source.asset._level0GroundSurfaceVersion = (Number(source.asset._level0GroundSurfaceVersion) || 0) + 1;
            }
            const editedSource = sourceByKey.get(sectionKey) || null;
            const editedAsset = asset || (editedSource && editedSource.asset ? editedSource.asset : null);
            this.syncGroundTerrainEditedTileForSectionAsset(editedAsset, sectionKey, node);
            const modifiedSegments = debugReplacementSegments.length > 0
                ? debugReplacementSegments
                : this.collectGroundTerrainModifiedDebugSegments(
                    debugBeforePolygons,
                    debugAfterPolygons,
                    patchBounds
                );
            this.recordGroundTerrainPaintDebugEdit(node, nextType, {
                sectionKeys: Array.from(touchedSectionKeys),
                rawReplacementSegments: debugRawReplacementSegments,
                modifiedSegments
            });
            this.invalidateGroundBridgeBarrierCache();
        } else {
            const nextPolygons = records
                .filter(record => !record.participating)
                .map(record => record.polygon);
            const debugAfterPolygons = [];
            for (const [, polygons] of patchedPolygonsByType.entries()) {
                nextPolygons.push(...polygons);
                debugAfterPolygons.push(...polygons);
            }
            this.terrainPolygons = this.normalizeGroundTerrainPolygons(nextPolygons);
            this._level0GroundSurfaceVersion = (Number(this._level0GroundSurfaceVersion) || 0) + 1;
            const modifiedSegments = debugReplacementSegments.length > 0
                ? debugReplacementSegments
                : this.collectGroundTerrainModifiedDebugSegments(
                    debugBeforePolygons,
                    debugAfterPolygons,
                    patchBounds
                );
            this.recordGroundTerrainPaintDebugEdit(node, nextType, {
                rawReplacementSegments: debugRawReplacementSegments,
                modifiedSegments
            });
            this.invalidateGroundBridgeBarrierCache();
        }
        return true;
    }

    collectGroundTerrainPolygonGroups(nodes, options = {}) {
        const sourceNodes = Array.isArray(nodes) ? nodes : [];
        const includeGrass = options && options.includeGrass === true;
        const seedRecordsByKey = new Map();
        for (let i = 0; i < sourceNodes.length; i++) {
            const node = sourceNodes[i];
            if (!node || node._prototypeVoid === true) continue;
            const type = this.getGroundTerrainTypeForNode(node);
            if (!includeGrass && type === "grass") continue;
            const key = this.getGroundTerrainNodeKey(node);
            if (seedRecordsByKey.has(key)) continue;
            seedRecordsByKey.set(key, { key, node, type });
        }
        const dirs = [1, 3, 5, 7, 9, 11];
        const groups = [];
        const visited = new Set();
        for (const record of seedRecordsByKey.values()) {
            if (visited.has(record.key)) continue;
            visited.add(record.key);
            const group = {
                type: record.type,
                nodes: [],
                nodeKeys: new Set()
            };
            const queue = [record];
            for (let q = 0; q < queue.length; q++) {
                const current = queue[q];
                group.nodes.push(current.node);
                group.nodeKeys.add(current.key);
                for (let d = 0; d < dirs.length; d++) {
                    const neighbor = current.node.neighbors && current.node.neighbors[dirs[d]];
                    if (!neighbor || neighbor._prototypeVoid === true) continue;
                    const neighborKey = this.getGroundTerrainNodeKey(neighbor);
                    if (visited.has(neighborKey)) continue;
                    if (!seedRecordsByKey.has(neighborKey)) continue;
                    const neighborType = this.getGroundTerrainTypeForNode(neighbor);
                    if (neighborType !== group.type) continue;
                    visited.add(neighborKey);
                    queue.push({ key: neighborKey, node: neighbor, type: neighborType });
                }
            }
            groups.push(group);
        }
        return groups;
    }

    collectGroundTerrainConnectedComponentNodesForType(type, seedNodes, options = {}) {
        this.getGroundTerrainTextureIdForType(type);
        const sourceSeeds = Array.isArray(seedNodes) ? seedNodes : [];
        const sectionKey = options && typeof options.sectionKey === "string" ? options.sectionKey : "";
        const dirs = [1, 3, 5, 7, 9, 11];
        const nodes = [];
        const visited = new Set();
        const queue = [];
        const enqueue = (candidate) => {
            if (!candidate || candidate._prototypeVoid === true) return;
            if (this.getGroundTerrainTypeForNode(candidate) !== type) return;
            if (sectionKey) {
                const candidateSectionKey = typeof candidate._prototypeSectionKey === "string" && candidate._prototypeSectionKey.length > 0
                    ? candidate._prototypeSectionKey
                    : (typeof candidate.ownerSectionKey === "string" ? candidate.ownerSectionKey : "");
                if (candidateSectionKey !== sectionKey) return;
            }
            const key = this.getGroundTerrainNodeKey(candidate);
            if (visited.has(key)) return;
            visited.add(key);
            queue.push(candidate);
        };
        for (let i = 0; i < sourceSeeds.length; i++) enqueue(sourceSeeds[i]);
        for (let q = 0; q < queue.length; q++) {
            const node = queue[q];
            nodes.push(node);
            for (let d = 0; d < dirs.length; d++) {
                enqueue(this.getGroundTerrainNeighborNodeForDirection(node, dirs[d]));
            }
        }
        return nodes;
    }

    buildGroundTerrainPolygonsFromNodes(nodes, options = {}) {
        const api = getPolygonClippingApi2D();
        if (!api || typeof api.union !== "function") {
            throw new Error("terrain polygon generation requires polygon clipping union");
        }
        const groups = this.collectGroundTerrainPolygonGroups(nodes, options);
        const records = [];
        for (let g = 0; g < groups.length; g++) {
            const group = groups[g];
            const requiredSectionKey = typeof (options && options.requiredSectionKey) === "string"
                ? options.requiredSectionKey
                : "";
            if (requiredSectionKey) {
                const hasRequiredSectionNode = Array.isArray(group.nodes) && group.nodes.some(node => (
                    node && node._prototypeSectionKey === requiredSectionKey
                ));
                if (!hasRequiredSectionNode) continue;
            }
            const geometries = [];
            for (let n = 0; n < group.nodes.length; n++) {
                const ring = polygonToClipRing2D(this.getGroundTerrainHexCorners(group.nodes[n]));
                if (ring) geometries.push([[ring]]);
            }
            if (geometries.length === 0) continue;
            let unionGeometry = null;
            try {
                unionGeometry = api.union(...geometries);
            } catch (err) {
                throw new Error(`terrain polygon union failed for ${group.type}: ${err && err.message ? err.message : err}`);
            }
            if (!Array.isArray(unionGeometry)) continue;
            for (let p = 0; p < unionGeometry.length; p++) {
                const polygon = unionGeometry[p];
                if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) continue;
                const points = this.smoothGroundTerrainPolygonPoints(
                    clipRingToPolygonPoints2D(polygon[0], "terrain polygon ring"),
                    group,
                    { isHole: false }
                );
                if (points.length < 3) {
                    throw new Error(`terrain polygon for ${group.type} produced fewer than three points`);
                }
                const rawHoles = [];
                for (let h = 1; h < polygon.length; h++) {
                    rawHoles.push(clipRingToPolygonPoints2D(polygon[h], "terrain polygon hole ring"));
                }
                records.push({
                    type: group.type,
                    group,
                    rawPoints: clipRingToPolygonPoints2D(polygon[0], "terrain polygon ring"),
                    points,
                    rawHoles
                });
            }
        }
        const recordsByRawOuterSignature = new Map();
        for (let i = 0; i < records.length; i++) {
            const signature = this.getGroundTerrainRawRingSegmentSignature(records[i].rawPoints);
            if (!signature) continue;
            let matchingRecords = recordsByRawOuterSignature.get(signature);
            if (!matchingRecords) {
                matchingRecords = [];
                recordsByRawOuterSignature.set(signature, matchingRecords);
            }
            matchingRecords.push(records[i]);
        }
        const out = [];
        for (let r = 0; r < records.length; r++) {
            const record = records[r];
            const holes = [];
            for (let h = 0; h < record.rawHoles.length; h++) {
                const rawHole = record.rawHoles[h];
                const signature = this.getGroundTerrainRawRingSegmentSignature(rawHole);
                const matchingRecords = (recordsByRawOuterSignature.get(signature) || [])
                    .filter(candidate => candidate !== record && candidate.type !== record.type);
                if (matchingRecords.length > 1) {
                    throw new Error(`terrain polygon for ${record.type} found multiple matching inner boundaries for a hole`);
                }
                const holePoints = matchingRecords.length === 1
                    ? matchingRecords[0].points
                    : this.smoothGroundTerrainPolygonPoints(
                        rawHole,
                        record.group,
                        { isHole: true }
                    );
                if (holePoints.length < 3) {
                    throw new Error(`terrain polygon for ${record.type} produced a hole with fewer than three points`);
                }
                holes.push(holePoints);
            }
            out.push(holes.length > 0
                ? { type: record.type, points: record.points, holes }
                : { type: record.type, points: record.points });
        }
        return this.markGroundTerrainPolygonsGenerated(out);
    }

    rebuildGroundTerrainPolygonsForSection(sectionKey) {
        const asset = typeof this.getPrototypeSectionAsset === "function"
            ? this.getPrototypeSectionAsset(sectionKey)
            : null;
        if (!asset) return [];
        const polygons = this.buildGroundTerrainPolygonsForSection(sectionKey);
        asset.terrainPolygons = polygons;
        asset._level0GroundSurfaceVersion = (Number(asset._level0GroundSurfaceVersion) || 0) + 1;
        this.invalidateGroundBridgeBarrierCache();
        return polygons;
    }

    rebuildGroundTerrainPolygons() {
        if (!Array.isArray(this.nodes)) {
            throw new Error("terrain polygon rebuild requires map nodes");
        }
        const nodes = [];
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const node = this.nodes[x] && this.nodes[x][y] ? this.nodes[x][y] : null;
                if (node) nodes.push(node);
            }
        }
        const polygons = this.buildGroundTerrainPolygonsFromNodes(nodes);
        this.terrainPolygons = polygons;
        this._level0GroundSurfaceVersion = (Number(this._level0GroundSurfaceVersion) || 0) + 1;
        this.invalidateGroundBridgeBarrierCache();
        return polygons;
    }

    applyGroundTerrainPolygonsToNodes(nodes, polygons) {
        const sourceNodes = Array.isArray(nodes) ? nodes : [];
        const normalizedPolygons = this.normalizeGroundTerrainPolygons(polygons);
        const grassByCoord = new Map();
        for (let i = 0; i < sourceNodes.length; i++) {
            const node = sourceNodes[i];
            if (!node) continue;
            const grassId = this.getGroundTerrainTextureIdForType("grass", node.xindex, node.yindex);
            node.groundTextureId = grassId;
            grassByCoord.set(`${node.xindex},${node.yindex}`, node);
        }
        for (let p = 0; p < normalizedPolygons.length; p++) {
            const polygon = normalizedPolygons[p];
            const textureId = this.getGroundTerrainTextureIdForType(polygon.type);
            const holes = Array.isArray(polygon.holes) ? polygon.holes : [];
            for (const node of grassByCoord.values()) {
                if (!node) continue;
                const nodeX = Number(node.x);
                const nodeY = Number(node.y);
                if (!pointInPolygon2D(nodeX, nodeY, polygon.points)) continue;
                let insideHole = false;
                for (let h = 0; h < holes.length; h++) {
                    if (pointInPolygon2D(nodeX, nodeY, holes[h])) {
                        insideHole = true;
                        break;
                    }
                }
                if (!insideHole) {
                    node.groundTextureId = textureId;
                }
            }
        }
        return normalizedPolygons;
    }

    getGroundTextureForTextureId(textureId, x = 0, y = 0) {
        const textureIndex = resolveGroundTerrainTextureIndexForNode({
            groundTextureId: textureId,
            xindex: x,
            yindex: y
        });
        const texture = Array.isArray(this.groundTextures) ? this.groundTextures[textureIndex] : null;
        if (!texture) {
            throw new Error(`missing ground terrain texture at palette index ${textureIndex}`);
        }
        return texture;
    }

    getGroundTexturePathForTextureId(textureId, x = 0, y = 0) {
        const textureIndex = resolveGroundTerrainTextureIndexForNode({
            groundTextureId: textureId,
            xindex: x,
            yindex: y
        });
        const textureName = Array.isArray(this.groundPalette) ? this.groundPalette[textureIndex] : "";
        if (typeof textureName !== "string" || textureName.length === 0) {
            throw new Error(`missing ground terrain texture name at palette index ${textureIndex}`);
        }
        const texturePath = Array.isArray(this.groundTexturePaths) ? this.groundTexturePaths[textureIndex] : "";
        if (typeof texturePath !== "string" || texturePath.length === 0) {
            throw new Error(`missing ground terrain texture path at palette index ${textureIndex}`);
        }
        return texturePath;
    }

    getGroundTexturePathForNode(node) {
        if (!node) {
            throw new Error("ground terrain texture path resolution requires a node");
        }
        return this.getGroundTexturePathForTextureId(
            Number.isFinite(node.groundTextureId) ? Math.floor(Number(node.groundTextureId)) : 0,
            node.xindex,
            node.yindex
        );
    }

    setGroundTextureId(x, y, textureId) {
        const node = this.getGroundTerrainNodeByCoord(x, y);
        if (!node) return false;
        const rawId = Number(textureId);
        if (!Number.isFinite(rawId)) {
            throw new Error("ground terrain id must be finite");
        }
        const nextId = Math.floor(rawId);
        getGroundTerrainDefForTextureId(nextId);
        if (node.groundTextureId === nextId) return false;
        const wasTraversalBlocked = this.isNodeTerrainImpassableForTraversal(node);
        node.groundTextureId = nextId;
        const isTraversalBlocked = this.isNodeTerrainImpassableForTraversal(node);
        if (wasTraversalBlocked !== isTraversalBlocked) {
            if (!this._suppressClearanceUpdates && typeof this.updateClearanceAround === "function") {
                this.updateClearanceAround(node);
            }
            this.markPathfindingSnapshotDirty();
        }
        return true;
    }

    setGroundTerrainType(x, y, typeName) {
        const node = this.getGroundTerrainNodeByCoord(x, y);
        if (!node) return false;
        const nextId = this.getGroundTerrainTextureIdForType(typeName, node.xindex, node.yindex);
        return this.setGroundTextureId(node.xindex, node.yindex, nextId);
    }

    normalizeIndex(value, size) {
        const n = Number.isFinite(value) ? Math.floor(value) : 0;
        if (!Number.isFinite(size) || size <= 0) return n;
        const wrapped = ((n % size) + size) % size;
        return wrapped;
    }

    wrapIndexX(value) {
        return this.normalizeIndex(value, this.width);
    }

    wrapIndexY(value) {
        return this.normalizeIndex(value, this.height);
    }

    wrapWorldX(worldX) {
        if (!this.wrapX || !Number.isFinite(worldX) || this.worldWidth <= 0) return worldX;
        return ((worldX % this.worldWidth) + this.worldWidth) % this.worldWidth;
    }

    wrapWorldY(worldY) {
        if (!this.wrapY || !Number.isFinite(worldY) || this.worldHeight <= 0) return worldY;
        return ((worldY % this.worldHeight) + this.worldHeight) % this.worldHeight;
    }

    shortestDeltaX(fromX, toX) {
        let delta = (toX - fromX);
        if (!this.wrapX || !Number.isFinite(delta) || this.worldWidth <= 0) return delta;
        delta = ((delta + this.worldWidth * 0.5) % this.worldWidth + this.worldWidth) % this.worldWidth - this.worldWidth * 0.5;
        return delta;
    }

    shortestDeltaY(fromY, toY) {
        let delta = (toY - fromY);
        if (!this.wrapY || !Number.isFinite(delta) || this.worldHeight <= 0) return delta;
        delta = ((delta + this.worldHeight * 0.5) % this.worldHeight + this.worldHeight) % this.worldHeight - this.worldHeight * 0.5;
        return delta;
    }

    distanceBetweenPoints(ax, ay, bx, by) {
        const dx = this.shortestDeltaX(ax, bx);
        const dy = this.shortestDeltaY(ay, by);
        return Math.hypot(dx, dy);
    }

    pointWithinRadius(ax, ay, bx, by, radius) {
        if (!Number.isFinite(radius) || radius < 0) return false;
        const dx = this.shortestDeltaX(ax, bx);
        const dy = this.shortestDeltaY(ay, by);
        return (dx * dx + dy * dy) <= (radius * radius);
    }

    wrapWorldPoint(point) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return point;
        return {
            x: this.wrapWorldX(point.x),
            y: this.wrapWorldY(point.y)
        };
    }
}
