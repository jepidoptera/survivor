(function (globalScope) {
    "use strict";

    const EPS = 1e-6;
    const WALL_DEPTH_NEAR_METRIC = -128;
    const WALL_DEPTH_FAR_METRIC = 256;
    const WALL_DEPTH_VS = `
precision highp float;
attribute vec3 aWorldPosition;
attribute vec2 aUvs;
attribute vec4 aColor;
attribute float aTextureMix;
uniform vec2 uScreenSize;
uniform vec2 uCameraWorld;
uniform float uViewScale;
uniform float uXyRatio;
uniform vec2 uDepthRange;
varying vec2 vUvs;
varying vec4 vColor;
varying float vTextureMix;
varying float vWorldZ;
void main(void) {
    float camDx = aWorldPosition.x - uCameraWorld.x;
    float camDy = aWorldPosition.y - uCameraWorld.y;
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
    gl_Position = vec4(clip, nd * 2.0 - 1.0, 1.0);
    vUvs = aUvs;
    vColor = aColor;
    vTextureMix = aTextureMix;
    vWorldZ = aWorldPosition.z;
}
`;
    const WALL_DEPTH_FS = `
precision highp float;
varying vec2 vUvs;
varying vec4 vColor;
varying float vTextureMix;
varying float vWorldZ;
uniform sampler2D uSampler;
uniform vec4 uTint;
uniform float uBrightness;
uniform float uAlphaCutoff;
uniform float uClipMinZ;

vec3 adjustSaturation(vec3 color, float saturation) {
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(luma), color, saturation);
}

void main(void) {
    vec4 sampled = texture2D(uSampler, vUvs);
    vec4 tex = mix(vec4(1.0, 1.0, 1.0, 1.0), sampled, clamp(vTextureMix, 0.0, 1.0));
    vec4 outColor = tex * uTint * vColor;
    float b = clamp(uBrightness, -1.0, 1.0);
    if (b >= 0.0) {
        // Punchy profile: faster ramp + stronger saturation boost.
        float t = pow(b, 1.35);
        float saturation = 1.0 + (0.75 * t);
        vec3 color = adjustSaturation(outColor.rgb, saturation);
        float gamma = 1.0 / (1.0 + (1.05 * t));
        color = pow(clamp(color, 0.0, 1.0), vec3(gamma));
        outColor.rgb = mix(color, vec3(1.0, 1.0, 1.0), 0.25 * t);
    } else {
        float t = pow(-b, 1.35);
        float saturation = 1.0 - (0.25 * t);
        vec3 color = adjustSaturation(outColor.rgb, saturation);
        outColor.rgb = color * (1.0 - t);
    }
    if (vWorldZ < uClipMinZ) discard;
    if (outColor.a < uAlphaCutoff) discard;
    gl_FragColor = outColor;
}
`;
    const DEFAULT_WALL_TEXTURE = "/assets/images/walls/stonewall.png";
    const DEFAULT_REPEAT_X = 0.1;
    const DEFAULT_REPEAT_Y = 0.1;

    class WallSectionUnit {
        static _nextId = 1;
        static _allSections = new Map();
        static _placementDebugActive = false;
        static _placementDebugFocusIds = null;
        static _showDirectionalBlockingDebug = false;
        static _showBottomFaceOnlyDebug = false;
        static _depthMeshState = null;
        static _wallTextureConfigCache = null;
        static _wallTextureConfigPromise = null;
        static _depthGeometryCacheGeneration = 0;
        static _depthGeometryRebuildBudgetPerFrame = 8;
        static _depthGeometryRebuildBudgetThisFrame = 8;
        static _mazeFacingDebugTargetFrame = null;
        static _mazeFacingDebugDumped = false;
        static _mazeFacingDebugSeenWallIds = null;

        static setShowDirectionalBlockingDebug(enabled) {
            WallSectionUnit._showDirectionalBlockingDebug = !!enabled;
        }

        static setShowBottomFaceOnlyDebug(enabled) {
            WallSectionUnit._showBottomFaceOnlyDebug = !!enabled;
        }

        static _isDoorDirectionalBlocker(blocker) {
            if (!blocker || typeof blocker !== "object") return false;
            if (typeof blocker.isDoorObject === "function") {
                return !!blocker.isDoorObject();
            }
            const type = (typeof blocker.type === "string") ? blocker.type.trim().toLowerCase() : "";
            const category = (typeof blocker.category === "string") ? blocker.category.trim().toLowerCase() : "";
            return type === "door" || category === "doors";
        }

        static _getDirectionalBlockingDebugColor(blocker) {
            return WallSectionUnit._isDoorDirectionalBlocker(blocker) ? 0x3399ff : 0xff0000;
        }

        static _normalizeWallTextureConfigPath(texturePath) {
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

        static _buildWallTextureConfigMaps(doc) {
            const cfg = { byPath: new Map(), byFile: new Map() };
            const items = (doc && Array.isArray(doc.items)) ? doc.items : [];
            for (let i = 0; i < items.length; i++) {
                const entry = items[i];
                if (!entry || typeof entry !== "object") continue;
                const texturePath = WallSectionUnit._normalizeWallTextureConfigPath(entry.texturePath);
                const fallbackRepeat = Number.isFinite(entry.repeatsPerMapUnit)
                    ? Math.max(0.0001, Number(entry.repeatsPerMapUnit))
                    : null;
                const repeatsPerMapUnitX = Number.isFinite(entry.repeatsPerMapUnitX)
                    ? Math.max(0.0001, Number(entry.repeatsPerMapUnitX))
                    : (fallbackRepeat || DEFAULT_REPEAT_X);
                const repeatsPerMapUnitY = Number.isFinite(entry.repeatsPerMapUnitY)
                    ? Math.max(0.0001, Number(entry.repeatsPerMapUnitY))
                    : (fallbackRepeat || DEFAULT_REPEAT_Y);
                const normalizedEntry = { texturePath, repeatsPerMapUnitX, repeatsPerMapUnitY };
                if (texturePath) cfg.byPath.set(texturePath, normalizedEntry);
                const file = (typeof entry.file === "string" && entry.file.length > 0) ? entry.file : null;
                if (file) cfg.byFile.set(file, normalizedEntry);
            }
            return cfg;
        }

        static _invalidateAllDepthGeometryCaches() {
            // O(1) global invalidation: bump generation instead of walking
            // every section and nulling caches in one frame.
            WallSectionUnit._depthGeometryCacheGeneration++;
        }

        static _ensureWallTextureConfigLoaded() {
            if (WallSectionUnit._wallTextureConfigCache) return Promise.resolve(WallSectionUnit._wallTextureConfigCache);
            if (WallSectionUnit._wallTextureConfigPromise) return WallSectionUnit._wallTextureConfigPromise;
            if (typeof fetch !== "function") {
                WallSectionUnit._wallTextureConfigCache = { byPath: new Map(), byFile: new Map() };
                return Promise.resolve(WallSectionUnit._wallTextureConfigCache);
            }
            const applyAndReturn = (doc) => {
                WallSectionUnit._wallTextureConfigCache = WallSectionUnit._buildWallTextureConfigMaps(doc);
                WallSectionUnit._invalidateAllDepthGeometryCaches();
                return WallSectionUnit._wallTextureConfigCache;
            };
            WallSectionUnit._wallTextureConfigPromise = fetch("/assets/images/walls/items.json", { cache: "no-cache" })
                .then(resp => (resp && resp.ok) ? resp.json() : null)
                .then(doc => applyAndReturn(doc))
                .catch(() => applyAndReturn(null))
                .finally(() => {
                    WallSectionUnit._wallTextureConfigPromise = null;
                });
            return WallSectionUnit._wallTextureConfigPromise;
        }

        static _getWallTextureRepeatConfig(texturePath) {
            if (!WallSectionUnit._wallTextureConfigCache) {
                void WallSectionUnit._ensureWallTextureConfigLoaded();
            }
            const normalized = WallSectionUnit._normalizeWallTextureConfigPath(texturePath || DEFAULT_WALL_TEXTURE);
            const file = normalized.split("/").pop() || "";
            const byPath = WallSectionUnit._wallTextureConfigCache && WallSectionUnit._wallTextureConfigCache.byPath
                ? WallSectionUnit._wallTextureConfigCache.byPath
                : null;
            const byFile = WallSectionUnit._wallTextureConfigCache && WallSectionUnit._wallTextureConfigCache.byFile
                ? WallSectionUnit._wallTextureConfigCache.byFile
                : null;
            const entry = (byPath && byPath.get(normalized)) || (byFile && byFile.get(file)) || null;
            return {
                texturePath: (entry && typeof entry.texturePath === "string" && entry.texturePath.length > 0)
                    ? entry.texturePath
                    : (normalized || DEFAULT_WALL_TEXTURE),
                repeatsPerMapUnitX: (entry && Number.isFinite(entry.repeatsPerMapUnitX))
                    ? Math.max(0.0001, Number(entry.repeatsPerMapUnitX))
                    : DEFAULT_REPEAT_X,
                repeatsPerMapUnitY: (entry && Number.isFinite(entry.repeatsPerMapUnitY))
                    ? Math.max(0.0001, Number(entry.repeatsPerMapUnitY))
                    : DEFAULT_REPEAT_Y
            };
        }

        constructor(startPoint, endPoint, options = {}) {
            this.type = "wallSection";
            this.id = Number.isInteger(options.id) ? Number(options.id) : WallSectionUnit._nextId++;
            if (Number.isInteger(this.id)) {
                WallSectionUnit._nextId = Math.max(WallSectionUnit._nextId, this.id + 1);
            }
            this.map = options.map || null;
            this.isPassable = false;
            this.blocksTile = false;

            this.startPoint = null;
            this.endPoint = null;
            this.height = Number.isFinite(options.height) ? Math.max(0, Number(options.height)) : 1;
            this.thickness = Number.isFinite(options.thickness) ? Math.max(0.001, Number(options.thickness)) : 0.1;
            this.bottomZ = Number.isFinite(options.bottomZ) ? Number(options.bottomZ) : 0;
            this.wallTexturePath = (typeof options.wallTexturePath === "string" && options.wallTexturePath.length > 0)
                ? options.wallTexturePath
                : "/assets/images/walls/stonewall.png";
            this.texturePhaseA = Number.isFinite(options.texturePhaseA) ? Number(options.texturePhaseA) : NaN;
            this.texturePhaseB = Number.isFinite(options.texturePhaseB) ? Number(options.texturePhaseB) : NaN;

            this.direction = 0;
            this.lineAxis = 0;
            this.length = 0;
            this.center = { x: 0, y: 0 };

            // Map nodes this wall sits on, for visibility collection.
            this.nodes = [];
            // Directional traversal links blocked by this wall.
            this.blockedLinks = [];
            this._blockedLinkKeys = new Set();
            this._directionalBlockingDebug = {
                centerlineNodes: [],
                oddNeighborNodes: [],
                blockedConnections: []
            };

            // Connections keyed by section id.
            this.connections = new Map();
            // Attached objects tracked with mount metadata.
            this.attachedObjects = [];

            // Renderable 3d mesh data for renderer handoff.
            this.mesh3d = null;
            this.groundPlaneHitbox = null;
            this._depthDisplayMesh = null;
            this._depthGeometryCache = null;
            this._losIlluminationTMin = null;
            this._losIlluminationTMax = null;
            this._losSnapToStart = false;
            this._losSnapToEnd = false;
            this._mazeVisibilityHeightAnim = {
                value: 0,
                from: 0,
                to: 0,
                startMs: 0,
                lastSeenMs: null
            };

            // PIXI display object — a Graphics that draws the base outline.
            this.pixiSprite = (typeof PIXI !== "undefined" && PIXI.Graphics)
                ? new PIXI.Graphics()
                : null;
            this.skipTransform = true;

            this.setEndpoints(startPoint, endPoint, options.map || null);

            // Register in global section registry.
            WallSectionUnit._allSections.set(this.id, this);

            // Solve joinery at both endpoints now that this section exists.
            // Skipped during bulk-load; the caller will batch this afterwards.
            if (!options.deferSetup) {
                this.handleJoineryOnPlacement();
            }
        }

        static _isMapNode(candidate) {
            return !!(candidate && typeof candidate.xindex === "number" && typeof candidate.yindex === "number");
        }

        static _isNodeMidpoint(candidate) {
            return !!(
                candidate &&
                !WallSectionUnit._isMapNode(candidate) &&
                candidate.nodeA && candidate.nodeB &&
                candidate.k !== undefined
            );
        }

        static _pointsMatch(a, b, eps = EPS) {
            if (!a || !b) return false;
            if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return false;
            return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
        }

        static normalizeEndpoint(endpoint, mapRef = null) {
            if (!endpoint) return null;
            if (WallSectionUnit._isMapNode(endpoint) || WallSectionUnit._isNodeMidpoint(endpoint)) {
                return endpoint;
            }
            if (!Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) return null;

            if (mapRef && typeof mapRef.worldToNodeOrMidpoint === "function") {
                const resolved = mapRef.worldToNodeOrMidpoint(Number(endpoint.x), Number(endpoint.y));
                if (resolved && (WallSectionUnit._isMapNode(resolved) || WallSectionUnit._isNodeMidpoint(resolved))) {
                    return resolved;
                }
            }

            return null;
        }

        static _serializeEndpoint(endpoint) {
            if (!endpoint) return null;
            if (WallSectionUnit._isMapNode(endpoint)) {
                return {
                    kind: "node",
                    xindex: Number(endpoint.xindex),
                    yindex: Number(endpoint.yindex),
                    x: Number(endpoint.x),
                    y: Number(endpoint.y)
                };
            }
            if (WallSectionUnit._isNodeMidpoint(endpoint) && endpoint.nodeA && endpoint.nodeB) {
                const a = endpoint.nodeA;
                const b = endpoint.nodeB;
                if (WallSectionUnit._isMapNode(a) && WallSectionUnit._isMapNode(b)) {
                    return {
                        kind: "midpoint",
                        a: { xindex: Number(a.xindex), yindex: Number(a.yindex) },
                        b: { xindex: Number(b.xindex), yindex: Number(b.yindex) },
                        x: Number(endpoint.x),
                        y: Number(endpoint.y)
                    };
                }
            }
            if (Number.isFinite(endpoint.x) && Number.isFinite(endpoint.y)) {
                return {
                    kind: "point",
                    x: Number(endpoint.x),
                    y: Number(endpoint.y)
                };
            }
            return null;
        }

        static _lookupMapNodeByIndex(mapRef, xindex, yindex) {
            if (!Number.isFinite(xindex) || !Number.isFinite(yindex)) return null;
            const xi = Number(xindex);
            const yi = Number(yindex);
            if (mapRef && typeof mapRef.getNodeByIndex === "function") {
                const resolvedNode = mapRef.getNodeByIndex(xi, yi);
                if (resolvedNode) return resolvedNode;
            }
            if (!mapRef || !mapRef.nodes) return null;
            const col = mapRef.nodes[xi];
            if (!col) return null;
            return col[yi] || null;
        }

        static _resolveSerializedEndpoint(endpointData, mapRef = null) {
            if (!endpointData || typeof endpointData !== "object") return null;
            const kind = (typeof endpointData.kind === "string") ? endpointData.kind : "";

            if (kind === "node") {
                const node = WallSectionUnit._lookupMapNodeByIndex(mapRef, endpointData.xindex, endpointData.yindex);
                if (node) return node;
            }

            if (kind === "midpoint") {
                const aData = endpointData.a;
                const bData = endpointData.b;
                const nodeA = aData ? WallSectionUnit._lookupMapNodeByIndex(mapRef, aData.xindex, aData.yindex) : null;
                const nodeB = bData ? WallSectionUnit._lookupMapNodeByIndex(mapRef, bData.xindex, bData.yindex) : null;
                if (
                    nodeA &&
                    nodeB &&
                    mapRef &&
                    typeof mapRef.getMidpointNode === "function"
                ) {
                    const midpoint = mapRef.getMidpointNode(nodeA, nodeB);
                    if (midpoint) return midpoint;
                }
            }

            if (Number.isFinite(endpointData.x) && Number.isFinite(endpointData.y)) {
                return WallSectionUnit.normalizeEndpoint({ x: Number(endpointData.x), y: Number(endpointData.y) }, mapRef);
            }

            return null;
        }

        static endpointKey(endpoint) {
            if (!endpoint) return "";
            if (WallSectionUnit._isMapNode(endpoint)) {
                return `n:${endpoint.xindex},${endpoint.yindex}`;
            }
            if (WallSectionUnit._isNodeMidpoint(endpoint) && endpoint.nodeA && endpoint.nodeB) {
                const a = endpoint.nodeA;
                const b = endpoint.nodeB;
                if (WallSectionUnit._isMapNode(a) && WallSectionUnit._isMapNode(b)) {
                    const keyA = `n:${a.xindex},${a.yindex}`;
                    const keyB = `n:${b.xindex},${b.yindex}`;
                    return (keyA <= keyB) ? `m:${keyA}|${keyB}` : `m:${keyB}|${keyA}`;
                }
            }
            return `p:${Number(endpoint.x).toFixed(6)},${Number(endpoint.y).toFixed(6)}`;
        }

        static _normalizeDirection(direction) {
            const d = Number.isFinite(direction) ? Math.round(Number(direction)) : 0;
            return ((d % 12) + 12) % 12;
        }

        static _numericEqual(a, b, eps = EPS) {
            const av = Number(a);
            const bv = Number(b);
            if (!Number.isFinite(av) || !Number.isFinite(bv)) return false;
            return Math.abs(av - bv) <= eps;
        }

        static _optionalNumericEqual(a, b, eps = EPS) {
            const af = Number.isFinite(a);
            const bf = Number.isFinite(b);
            if (!af && !bf) return true;
            if (af !== bf) return false;
            return Math.abs(Number(a) - Number(b)) <= eps;
        }

        static _directionBetweenEndpoints(startPoint, endPoint, mapRef = null) {
            if (!startPoint || !endPoint) return null;
            const sx = Number(startPoint.x);
            const sy = Number(startPoint.y);
            const ex = Number(endPoint.x);
            const ey = Number(endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) {
                return null;
            }
            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(sx, ex)
                : (ex - sx);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(sy, ey)
                : (ey - sy);
            if (Math.hypot(dx, dy) <= EPS) return null;
            const dir = (mapRef && typeof mapRef.getHexDirection === "function")
                ? mapRef.getHexDirection(dx, dy)
                : Math.round((180 - (Math.atan2(-dy, dx) * 180 / Math.PI)) / 30);
            if (!Number.isFinite(dir)) return null;
            return WallSectionUnit._normalizeDirection(dir);
        }

        static _resolveSharedAndOuterEndpoints(sectionA, sectionB) {
            if (!sectionA || !sectionB || sectionA === sectionB) return null;
            const a0 = sectionA.startPoint;
            const a1 = sectionA.endPoint;
            const b0 = sectionB.startPoint;
            const b1 = sectionB.endPoint;
            if (!a0 || !a1 || !b0 || !b1) return null;

            let shared = null;
            let outerA = null;
            let outerB = null;

            if (WallSectionUnit._pointsMatch(a0, b0)) {
                shared = a0;
                outerA = a1;
                outerB = b1;
            } else if (WallSectionUnit._pointsMatch(a0, b1)) {
                shared = a0;
                outerA = a1;
                outerB = b0;
            } else if (WallSectionUnit._pointsMatch(a1, b0)) {
                shared = a1;
                outerA = a0;
                outerB = b1;
            } else if (WallSectionUnit._pointsMatch(a1, b1)) {
                shared = a1;
                outerA = a0;
                outerB = b0;
            }

            if (!shared || !outerA || !outerB) return null;
            if (WallSectionUnit._pointsMatch(outerA, outerB)) return null;

            return { shared, outerA, outerB };
        }

        static _hasExternalWallConnectionAtEndpoint(section, endpoint, excludeSections = [], options = {}) {
            if (!section || !endpoint || !(section.connections instanceof Map)) return false;
            const excludeSet = new Set(Array.isArray(excludeSections) ? excludeSections : []);
            const requireNonCollinear = !!(options && options.requireNonCollinear);
            const sectionAxis = ((WallSectionUnit._normalizeDirection(section.direction) % 6) + 6) % 6;
            for (const payload of section.connections.values()) {
                const other = payload && payload.section;
                if (!other || other.gone) continue;
                if (excludeSet.has(other)) continue;
                if (!other.startPoint || !other.endPoint) continue;
                const sharesEndpoint = (
                    WallSectionUnit._pointsMatch(endpoint, other.startPoint) ||
                    WallSectionUnit._pointsMatch(endpoint, other.endPoint)
                );
                if (!sharesEndpoint) continue;
                if (!requireNonCollinear) return true;
                const otherAxis = ((WallSectionUnit._normalizeDirection(other.direction) % 6) + 6) % 6;
                if (otherAxis !== sectionAxis) return true;
            }
            return false;
        }

        static _mergeWouldCollapseConnectedJunction(sectionA, sectionB, mergedStart, mergedEnd) {
            if (!sectionA || !sectionB || !mergedStart || !mergedEnd) return false;
            const keepEndpoint = (point) => (
                WallSectionUnit._pointsMatch(point, mergedStart) ||
                WallSectionUnit._pointsMatch(point, mergedEnd)
            );
            const pair = [sectionA, sectionB];
            const endpointsToCheck = [
                sectionA.startPoint,
                sectionA.endPoint,
                sectionB.startPoint,
                sectionB.endPoint
            ];
            for (let i = 0; i < endpointsToCheck.length; i++) {
                const point = endpointsToCheck[i];
                if (!point || keepEndpoint(point)) continue;
                const owner = i < 2 ? sectionA : sectionB;
                if (WallSectionUnit._hasExternalWallConnectionAtEndpoint(
                    owner,
                    point,
                    pair,
                    { requireNonCollinear: true }
                )) {
                    return true;
                }
            }
            return false;
        }

        static canAutoMergeContinuous(sectionA, sectionB) {
            const debugEnabled = !!(
                globalScope &&
                globalScope.DEBUG_WALL_PLACEMENT &&
                WallSectionUnit._placementDebugActive
            );
            const focusIds = (WallSectionUnit._placementDebugFocusIds instanceof Set)
                ? WallSectionUnit._placementDebugFocusIds
                : null;
            const debugLog = (reason, extra = null) => {
                if (!debugEnabled) return;
                if (reason === "no-shared-endpoint") return;
                const idA = Number.isInteger(sectionA && sectionA.id) ? Number(sectionA.id) : null;
                const idB = Number.isInteger(sectionB && sectionB.id) ? Number(sectionB.id) : null;
                if (
                    focusIds &&
                    !(
                        (idA !== null && focusIds.has(idA)) ||
                        (idB !== null && focusIds.has(idB))
                    )
                ) {
                    return;
                }
                const label = (section) => {
                    if (!section) return "wall<?>";
                    const id = Number.isInteger(section.id) ? section.id : "?";
                    const fmt = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y))
                        ? `(${Number(p.x).toFixed(4)}, ${Number(p.y).toFixed(4)})`
                        : "(?, ?)";
                    return `wall#${id} ${fmt(section.startPoint)} -> ${fmt(section.endPoint)}`;
                };
                console.log("[WALL_PLACE_DEBUG]", "continuous-check", {
                    reason,
                    a: label(sectionA),
                    b: label(sectionB),
                    ...(extra && typeof extra === "object" ? extra : {})
                });
            };
            if (!sectionA || !sectionB || sectionA === sectionB) return false;
            if (sectionA.gone || sectionB.gone || sectionA.vanishing || sectionB.vanishing) {
                debugLog("gone-or-vanishing");
                return false;
            }
            if (
                sectionA._disableChunkSplitOnVanish ||
                sectionB._disableChunkSplitOnVanish ||
                sectionA._vanishAsWholeSection ||
                sectionB._vanishAsWholeSection
            ) {
                debugLog("vanish-flags");
                return false;
            }
            if (sectionA.map !== sectionB.map) {
                debugLog("different-map");
                return false;
            }
            const endpoints = WallSectionUnit._resolveSharedAndOuterEndpoints(sectionA, sectionB);
            if (!endpoints) {
                debugLog("no-shared-endpoint");
                return false;
            }
            const sharedKey = WallSectionUnit.endpointKey(endpoints.shared);
            const blockedA = !!(
                sharedKey &&
                sectionA &&
                sectionA._crossSplitLockedEndpointKeys instanceof Set &&
                sectionA._crossSplitLockedEndpointKeys.has(sharedKey)
            );
            const blockedB = !!(
                sharedKey &&
                sectionB &&
                sectionB._crossSplitLockedEndpointKeys instanceof Set &&
                sectionB._crossSplitLockedEndpointKeys.has(sharedKey)
            );
            if (blockedA || blockedB) {
                const hasActiveCrossing = (
                    WallSectionUnit._hasExternalWallConnectionAtEndpoint(
                        sectionA,
                        endpoints.shared,
                        [sectionA, sectionB],
                        { requireNonCollinear: true }
                    ) ||
                    WallSectionUnit._hasExternalWallConnectionAtEndpoint(
                        sectionB,
                        endpoints.shared,
                        [sectionA, sectionB],
                        { requireNonCollinear: true }
                    )
                );
                if (hasActiveCrossing) {
                    debugLog("cross-split-lock", { sharedKey, blockedA, blockedB, hasActiveCrossing });
                    return false;
                }

                // Split locks are only needed while a crossing wall still exists.
                // If that wall has been removed, clear stale locks so segments can re-merge.
                if (blockedA && sectionA._crossSplitLockedEndpointKeys instanceof Set) {
                    sectionA._crossSplitLockedEndpointKeys.delete(sharedKey);
                }
                if (blockedB && sectionB._crossSplitLockedEndpointKeys instanceof Set) {
                    sectionB._crossSplitLockedEndpointKeys.delete(sharedKey);
                }
                debugLog("cross-split-lock-cleared", { sharedKey, blockedA, blockedB });
            }

            const dirA = WallSectionUnit._normalizeDirection(sectionA.direction);
            const dirB = WallSectionUnit._normalizeDirection(sectionB.direction);
            const axisA = ((dirA % 6) + 6) % 6;
            const axisB = ((dirB % 6) + 6) % 6;
            if (axisA !== axisB) {
                debugLog("axis-mismatch", { axisA, axisB, dirA, dirB });
                return false;
            }

            if (!WallSectionUnit._numericEqual(sectionA.height, sectionB.height, 1e-5)) {
                debugLog("height-mismatch", { a: sectionA.height, b: sectionB.height });
                return false;
            }
            if (!WallSectionUnit._numericEqual(sectionA.thickness, sectionB.thickness, 1e-5)) {
                debugLog("thickness-mismatch", { a: sectionA.thickness, b: sectionB.thickness });
                return false;
            }
            if (!WallSectionUnit._numericEqual(sectionA.bottomZ, sectionB.bottomZ, 1e-5)) {
                debugLog("bottomz-mismatch", { a: sectionA.bottomZ, b: sectionB.bottomZ });
                return false;
            }

            const textureA = WallSectionUnit._normalizeWallTextureConfigPath(sectionA.wallTexturePath || DEFAULT_WALL_TEXTURE);
            const textureB = WallSectionUnit._normalizeWallTextureConfigPath(sectionB.wallTexturePath || DEFAULT_WALL_TEXTURE);
            if (textureA !== textureB) {
                debugLog("texture-mismatch", { textureA, textureB });
                return false;
            }

            debugLog("ok");
            return true;
        }

        static mergeContinuousPair(sectionA, sectionB) {
            if (!WallSectionUnit.canAutoMergeContinuous(sectionA, sectionB)) return null;

            let survivor = sectionA;
            let absorbed = sectionB;
            if (Number.isInteger(sectionB.id) && Number.isInteger(sectionA.id) && Number(sectionB.id) < Number(sectionA.id)) {
                survivor = sectionB;
                absorbed = sectionA;
            }

            const endpointInfo = WallSectionUnit._resolveSharedAndOuterEndpoints(survivor, absorbed);
            if (!endpointInfo) return null;
            const mapRef = survivor.map || absorbed.map || null;
            const targetDirection = WallSectionUnit._normalizeDirection(survivor.direction);
            const targetAxis = ((targetDirection % 6) + 6) % 6;

            let nextStart = endpointInfo.outerA;
            let nextEnd = endpointInfo.outerB;
            const dirForward = WallSectionUnit._directionBetweenEndpoints(endpointInfo.outerA, endpointInfo.outerB, mapRef);
            const dirBackward = WallSectionUnit._directionBetweenEndpoints(endpointInfo.outerB, endpointInfo.outerA, mapRef);
            const dirForwardAxis = Number.isFinite(dirForward) ? (((dirForward % 6) + 6) % 6) : null;
            const dirBackwardAxis = Number.isFinite(dirBackward) ? (((dirBackward % 6) + 6) % 6) : null;
            if (dirForwardAxis === targetAxis) {
                nextStart = endpointInfo.outerA;
                nextEnd = endpointInfo.outerB;
            } else if (dirBackwardAxis === targetAxis) {
                nextStart = endpointInfo.outerB;
                nextEnd = endpointInfo.outerA;
            }

            const absorbedNeighbors = [];
            for (const payload of absorbed.connections.values()) {
                const other = payload && payload.section;
                if (!other || other === absorbed || other.gone) continue;
                if (other === survivor) continue;
                if (!absorbedNeighbors.includes(other)) absorbedNeighbors.push(other);
            }
            const absorbedAttachments = Array.isArray(absorbed.attachedObjects)
                ? absorbed.attachedObjects.slice()
                : [];

            survivor.detachFrom(absorbed);
            absorbed.detachFrom(survivor);

            for (let i = 0; i < absorbedNeighbors.length; i++) {
                const neighbor = absorbedNeighbors[i];
                if (!neighbor) continue;
                if (typeof neighbor.detachFrom === "function") {
                    neighbor.detachFrom(absorbed);
                }
            }
            absorbed.connections.clear();

            survivor.setEndpoints(nextStart, nextEnd, mapRef);

            for (let i = 0; i < absorbedNeighbors.length; i++) {
                const neighbor = absorbedNeighbors[i];
                if (!neighbor || neighbor.gone) continue;
                if (!survivor.sharesEndpointWith(neighbor)) continue;
                survivor.connectTo(neighbor, { merged: true, absorbedSectionId: absorbed.id });
                if (typeof neighbor.connectTo === "function") {
                    neighbor.connectTo(survivor, { merged: true, absorbedSectionId: absorbed.id });
                }
            }

            for (let i = 0; i < absorbedAttachments.length; i++) {
                const entry = absorbedAttachments[i];
                if (!entry || !entry.object) continue;
                survivor.attachObject(entry.object, {
                    direction: Number.isFinite(entry.direction) ? Number(entry.direction) : survivor.direction,
                    offsetAlong: Number.isFinite(entry.offsetAlong) ? Number(entry.offsetAlong) : 0
                });
            }
            absorbed.attachedObjects.length = 0;

            absorbed.gone = true;
            absorbed.vanishing = false;
            absorbed.destroy();

            survivor.addToMapNodes();

            const impacted = [survivor, ...absorbedNeighbors];
            const seen = new Set();
            for (let i = 0; i < impacted.length; i++) {
                const wall = impacted[i];
                if (!wall || wall.gone) continue;
                if (seen.has(wall)) continue;
                seen.add(wall);
                if (typeof wall.handleJoineryOnPlacement === "function") {
                    wall.handleJoineryOnPlacement();
                } else {
                    if (typeof wall.rebuildMesh3d === "function") wall.rebuildMesh3d();
                    if (typeof wall.draw === "function") wall.draw();
                }
            }

            return survivor;
        }

        static _computeCollinearOverlapData(sectionA, sectionB, options = {}) {
            if (!sectionA || !sectionB || sectionA === sectionB) return null;
            if (sectionA.gone || sectionB.gone || sectionA.vanishing || sectionB.vanishing) return null;
            if (sectionA.map !== sectionB.map) return null;

            const dirA = WallSectionUnit._normalizeDirection(sectionA.direction);
            const dirB = WallSectionUnit._normalizeDirection(sectionB.direction);
            const axisA = ((dirA % 6) + 6) % 6;
            const axisB = ((dirB % 6) + 6) % 6;
            if (axisA !== axisB) return null;

            if (!WallSectionUnit._numericEqual(sectionA.height, sectionB.height, 1e-5)) return null;
            if (!WallSectionUnit._numericEqual(sectionA.thickness, sectionB.thickness, 1e-5)) return null;
            if (!WallSectionUnit._numericEqual(sectionA.bottomZ, sectionB.bottomZ, 1e-5)) return null;

            const textureA = WallSectionUnit._normalizeWallTextureConfigPath(sectionA.wallTexturePath || DEFAULT_WALL_TEXTURE);
            const textureB = WallSectionUnit._normalizeWallTextureConfigPath(sectionB.wallTexturePath || DEFAULT_WALL_TEXTURE);
            if (textureA !== textureB) return null;

            const mapRef = sectionA.map || null;
            const sx = Number(sectionA.startPoint && sectionA.startPoint.x);
            const sy = Number(sectionA.startPoint && sectionA.startPoint.y);
            const ex = Number(sectionA.endPoint && sectionA.endPoint.x);
            const ey = Number(sectionA.endPoint && sectionA.endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) {
                return null;
            }

            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(sx, ex)
                : (ex - sx);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(sy, ey)
                : (ey - sy);
            const lenA = Math.hypot(dx, dy);
            if (!(lenA > EPS)) return null;

            const ux = dx / lenA;
            const uy = dy / lenA;
            const vx = -uy;
            const vy = ux;

            const projectPoint = (point) => {
                if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
                const relX = (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(sx, Number(point.x))
                    : (Number(point.x) - sx);
                const relY = (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(sy, Number(point.y))
                    : (Number(point.y) - sy);
                return {
                    along: relX * ux + relY * uy,
                    perp: relX * vx + relY * vy
                };
            };

            const bStart = projectPoint(sectionB.startPoint);
            const bEnd = projectPoint(sectionB.endPoint);
            if (!bStart || !bEnd) return null;

            const collinearEps = Number.isFinite(options.collinearEps)
                ? Math.max(EPS, Number(options.collinearEps))
                : 1e-4;
            if (Math.abs(bStart.perp) > collinearEps || Math.abs(bEnd.perp) > collinearEps) return null;

            const bMin = Math.min(bStart.along, bEnd.along);
            const bMax = Math.max(bStart.along, bEnd.along);
            const overlapMin = Math.max(0, bMin);
            const overlapMax = Math.min(lenA, bMax);
            const overlapEps = Number.isFinite(options.overlapEps)
                ? Math.max(EPS, Number(options.overlapEps))
                : 1e-5;
            if (overlapMax < overlapMin - overlapEps) return null;
            const overlapLength = overlapMax - overlapMin;
            if (!(overlapLength > overlapEps)) return null;

            const endpoints = [
                { point: sectionA.startPoint, along: 0 },
                { point: sectionA.endPoint, along: lenA },
                { point: sectionB.startPoint, along: bStart.along },
                { point: sectionB.endPoint, along: bEnd.along }
            ];

            let minEntry = endpoints[0];
            let maxEntry = endpoints[0];
            for (let i = 1; i < endpoints.length; i++) {
                const entry = endpoints[i];
                if (entry.along < minEntry.along) minEntry = entry;
                if (entry.along > maxEntry.along) maxEntry = entry;
            }

            if (!minEntry || !maxEntry || !minEntry.point || !maxEntry.point) return null;
            if (WallSectionUnit._pointsMatch(minEntry.point, maxEntry.point)) return null;

            let mergedStart = minEntry.point;
            let mergedEnd = maxEntry.point;
            const targetAxis = ((WallSectionUnit._normalizeDirection(sectionA.direction) % 6) + 6) % 6;
            const dirForward = WallSectionUnit._directionBetweenEndpoints(mergedStart, mergedEnd, mapRef);
            const dirBackward = WallSectionUnit._directionBetweenEndpoints(mergedEnd, mergedStart, mapRef);
            const forwardAxis = Number.isFinite(dirForward) ? (((dirForward % 6) + 6) % 6) : null;
            const backwardAxis = Number.isFinite(dirBackward) ? (((dirBackward % 6) + 6) % 6) : null;
            if (forwardAxis === targetAxis) {
                mergedStart = minEntry.point;
                mergedEnd = maxEntry.point;
            } else if (backwardAxis === targetAxis) {
                mergedStart = maxEntry.point;
                mergedEnd = minEntry.point;
            }

            return {
                overlapMin,
                overlapMax,
                overlapLength,
                mergedStart,
                mergedEnd
            };
        }

        static canMergeCollinearOverlap(sectionA, sectionB, options = {}) {
            return !!WallSectionUnit._computeCollinearOverlapData(sectionA, sectionB, options);
        }

        static mergeOverlappingPlacementPair(survivor, absorbed, options = {}) {
            if (!survivor || !absorbed || survivor === absorbed) return null;
            const overlap = WallSectionUnit._computeCollinearOverlapData(survivor, absorbed);
            if (!overlap || !overlap.mergedStart || !overlap.mergedEnd) return null;
            const applyDirectionalBlocking = options.applyDirectionalBlocking !== false;
            const deferVisualUpdate = options.deferVisualUpdate === true;

            survivor.setEndpoints(overlap.mergedStart, overlap.mergedEnd, survivor.map || absorbed.map || null);
            survivor.addToMapNodes({ applyDirectionalBlocking });

            if (!deferVisualUpdate) {
                if (typeof survivor.handleJoineryOnPlacement === "function") {
                    survivor.handleJoineryOnPlacement();
                } else {
                    if (typeof survivor.rebuildMesh3d === "function") survivor.rebuildMesh3d();
                    if (typeof survivor.draw === "function") survivor.draw();
                }
            }

            absorbed.gone = true;
            absorbed.vanishing = false;
            absorbed.destroy();
            return survivor;
        }

        static _collectNearbyWallSections(seedSections = [], options = {}) {
            const seeds = Array.isArray(seedSections)
                ? seedSections.filter(section => !!section && !section.gone && !section.vanishing)
                : [];
            const includeNeighborNodes = options.includeNeighborNodes !== false;
            const fallbackToGlobal = options.fallbackToGlobal !== false;
            const allowedSet = options.allowedSet instanceof Set ? options.allowedSet : null;
            const explicitMapRef = options.map || null;
            const mapRef = explicitMapRef || (seeds.length > 0 ? seeds[0].map || null : null);

            const nodesByKey = new Map();
            const pushNode = (node) => {
                if (!WallSectionUnit._isMapNode(node)) return;
                if (mapRef && node.map && node.map !== mapRef) return;
                const key = `${node.xindex},${node.yindex}`;
                if (nodesByKey.has(key)) return;
                nodesByKey.set(key, node);
            };
            const pushEndpointNodes = (endpoint) => {
                if (!endpoint) return;
                if (WallSectionUnit._isMapNode(endpoint)) {
                    pushNode(endpoint);
                    return;
                }
                if (!WallSectionUnit._isNodeMidpoint(endpoint)) return;
                pushNode(endpoint.nodeA);
                pushNode(endpoint.nodeB);
            };

            for (let i = 0; i < seeds.length; i++) {
                const section = seeds[i];
                const nodes = Array.isArray(section.nodes) ? section.nodes : [];
                for (let n = 0; n < nodes.length; n++) {
                    pushNode(nodes[n]);
                }
                pushEndpointNodes(section.startPoint);
                pushEndpointNodes(section.endPoint);
            }

            if (includeNeighborNodes) {
                const baseNodes = Array.from(nodesByKey.values());
                for (let i = 0; i < baseNodes.length; i++) {
                    const node = baseNodes[i];
                    const neighbors = Array.isArray(node.neighbors) ? node.neighbors : [];
                    for (let n = 0; n < neighbors.length; n++) {
                        pushNode(neighbors[n]);
                    }
                }
            }

            const out = [];
            const seen = new Set();
            const pushSection = (section) => {
                if (!section || section.gone || section.vanishing) return;
                if (mapRef && section.map !== mapRef) return;
                if (allowedSet && !allowedSet.has(section)) return;
                const key = Number.isInteger(section.id) ? `id:${section.id}` : `obj:${String(section)}`;
                if (seen.has(key)) return;
                seen.add(key);
                out.push(section);
            };

            const candidateNodes = Array.from(nodesByKey.values());
            for (let i = 0; i < candidateNodes.length; i++) {
                const node = candidateNodes[i];
                const objects = Array.isArray(node.objects) ? node.objects : [];
                for (let o = 0; o < objects.length; o++) {
                    const obj = objects[o];
                    if (!obj || obj.type !== "wallSection") continue;
                    pushSection(obj);
                }
            }

            if (out.length === 0 && fallbackToGlobal) {
                if (allowedSet) {
                    allowedSet.forEach(pushSection);
                } else {
                    for (const section of WallSectionUnit._allSections.values()) {
                        pushSection(section);
                    }
                }
            }

            return out;
        }

        static _collectEndpointWallSections(section, options = {}) {
            if (!section || section.gone || section.vanishing) return [];
            const mapRef = options.map || section.map || null;
            const fallbackToGlobal = options.fallbackToGlobal !== false;

            const nodesByKey = new Map();
            const pushNode = (node) => {
                if (!WallSectionUnit._isMapNode(node)) return;
                if (mapRef && node.map && node.map !== mapRef) return;
                const key = `${node.xindex},${node.yindex}`;
                if (nodesByKey.has(key)) return;
                nodesByKey.set(key, node);
            };
            const pushEndpoint = (endpoint) => {
                if (!endpoint) return;
                if (WallSectionUnit._isMapNode(endpoint)) {
                    pushNode(endpoint);
                    return;
                }
                if (!WallSectionUnit._isNodeMidpoint(endpoint)) return;
                pushNode(endpoint.nodeA);
                pushNode(endpoint.nodeB);
            };
            pushEndpoint(section.startPoint);
            pushEndpoint(section.endPoint);

            const out = [];
            const seen = new Set();
            const pushSection = (candidate) => {
                if (!candidate || candidate.gone || candidate.vanishing) return;
                if (mapRef && candidate.map !== mapRef) return;
                const key = Number.isInteger(candidate.id) ? `id:${candidate.id}` : `obj:${String(candidate)}`;
                if (seen.has(key)) return;
                seen.add(key);
                out.push(candidate);
            };

            const nodes = Array.from(nodesByKey.values());
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                const objects = Array.isArray(node.objects) ? node.objects : [];
                for (let j = 0; j < objects.length; j++) {
                    const obj = objects[j];
                    if (!obj || obj.type !== "wallSection") continue;
                    pushSection(obj);
                }
            }

            if (out.length === 0 && fallbackToGlobal) {
                for (const candidate of WallSectionUnit._allSections.values()) {
                    pushSection(candidate);
                }
            }

            return out;
        }

        static harmonizeTexturePhaseForSections(seedSections = [], referenceSections = null) {
            const seeds = Array.isArray(seedSections)
                ? seedSections.filter(section => !!section && !section.gone && !section.vanishing)
                : [];
            if (seeds.length === 0) return;

            const seedSet = new Set(seeds);
            const explicitRefs = Array.isArray(referenceSections)
                ? referenceSections.filter(section => !!section && !section.gone && !section.vanishing)
                : null;

            const fallbackRefs = Array.from(WallSectionUnit._allSections.values())
                .filter(section => !!section && !section.gone && !section.vanishing && !seedSet.has(section));

            const chooseDonor = (seed) => {
                const candidates = (explicitRefs && explicitRefs.length > 0) ? explicitRefs : fallbackRefs;
                let donor = null;
                for (let i = 0; i < candidates.length; i++) {
                    const candidate = candidates[i];
                    if (!candidate || candidate === seed) continue;
                    if (!WallSectionUnit.canAutoMergeContinuous(seed, candidate)) continue;
                    if (!donor) {
                        donor = candidate;
                        continue;
                    }
                    const donorId = Number.isInteger(donor.id) ? Number(donor.id) : Number.POSITIVE_INFINITY;
                    const candidateId = Number.isInteger(candidate.id) ? Number(candidate.id) : Number.POSITIVE_INFINITY;
                    if (candidateId < donorId) donor = candidate;
                }
                return donor;
            };

            for (let i = 0; i < seeds.length; i++) {
                const seed = seeds[i];
                const donor = chooseDonor(seed);
                if (!donor) continue;

                seed.texturePhaseA = Number.isFinite(donor.texturePhaseA) ? Number(donor.texturePhaseA) : NaN;
                seed.texturePhaseB = Number.isFinite(donor.texturePhaseB) ? Number(donor.texturePhaseB) : NaN;
                seed._depthGeometryCache = null;
                if (typeof seed.rebuildMesh3d === "function") seed.rebuildMesh3d();
            }
        }

        static autoMergeContinuousSections(seedSections = []) {
            const debugEnabled = !!(
                globalScope &&
                globalScope.DEBUG_WALL_PLACEMENT &&
                WallSectionUnit._placementDebugActive
            );
            const debugLabel = (section) => {
                if (!section) return "wall<?>";
                const id = Number.isInteger(section.id) ? section.id : "?";
                const fmt = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y))
                    ? `(${Number(p.x).toFixed(4)}, ${Number(p.y).toFixed(4)})`
                    : "(?, ?)";
                return `wall#${id} ${fmt(section.startPoint)} -> ${fmt(section.endPoint)}`;
            };
            const debugLog = (kind, payload = {}) => {
                if (!debugEnabled) return;
                console.log("[WALL_PLACE_DEBUG]", `continuous-merge:${kind}`, payload);
            };
            const seeds = Array.isArray(seedSections) ? seedSections.slice() : [];
            const survivors = [];
            const seen = new Set();

            for (let i = 0; i < seeds.length; i++) {
                let section = seeds[i];
                if (!section || section.gone || section.vanishing) continue;
                debugLog("seed-start", { seed: debugLabel(section) });

                let merged = true;
                let guard = 0;
                while (merged && guard < 128) {
                    merged = false;
                    guard += 1;
                    const nearbySections = WallSectionUnit._collectEndpointWallSections(section, {
                        fallbackToGlobal: true,
                        map: section.map || null
                    });
                    for (let j = 0; j < nearbySections.length; j++) {
                        const candidate = nearbySections[j];
                        if (!candidate || candidate === section) continue;
                        if (!WallSectionUnit.canAutoMergeContinuous(section, candidate)) continue;
                        debugLog("attempt", {
                            section: debugLabel(section),
                            candidate: debugLabel(candidate)
                        });
                        const next = WallSectionUnit.mergeContinuousPair(section, candidate);
                        debugLog("result", {
                            section: debugLabel(section),
                            candidate: debugLabel(candidate),
                            success: !!next,
                            mergedInto: next ? debugLabel(next) : null
                        });
                        if (next) {
                            section = next;
                            merged = true;
                            break;
                        }
                    }
                }

                if (!section || section.gone) continue;
                const key = Number.isInteger(section.id) ? `id:${section.id}` : `obj:${i}`;
                if (seen.has(key)) continue;
                seen.add(key);
                survivors.push(section);
                debugLog("seed-end", { survivor: debugLabel(section) });
            }

            return survivors;
        }

        static _directionUnitVector(direction, mapRef = null, anchorPoint = null) {
            const dir = WallSectionUnit._normalizeDirection(direction);

            // Only use neighbor lookup for actual MapNodes (12-slot directional array).
            // Midpoints ({ nodeA, nodeB, k }) have no neighbors array — don't try.
            if (
                mapRef &&
                anchorPoint &&
                WallSectionUnit._isMapNode(anchorPoint) &&
                Array.isArray(anchorPoint.neighbors) &&
                anchorPoint.neighbors[dir] &&
                Number.isFinite(anchorPoint.neighbors[dir].x) &&
                Number.isFinite(anchorPoint.neighbors[dir].y)
            ) {
                const neighbor = anchorPoint.neighbors[dir];
                const dx = (typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(anchorPoint.x, neighbor.x)
                    : (neighbor.x - anchorPoint.x);
                const dy = (typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(anchorPoint.y, neighbor.y)
                    : (neighbor.y - anchorPoint.y);
                const len = Math.hypot(dx, dy);
                if (len > EPS) {
                    return { x: dx / len, y: dy / len };
                }
            }

            // Trig fallback: inverse of map.getHexDirection().
            // angle = (180 - direction * 30) degrees, where map uses atan2(-y, x).
            const theta = (180 - dir * 30) * (Math.PI / 180);
            return {
                x: Math.cos(theta),
                y: -Math.sin(theta)
            };
        }

        static _lineIntersection(p, r, q, s) {
            const cross = (r.x * s.y) - (r.y * s.x);
            if (Math.abs(cross) <= EPS) return null;
            const qpx = q.x - p.x;
            const qpy = q.y - p.y;
            const t = ((qpx * s.y) - (qpy * s.x)) / cross;
            const u = ((qpx * r.y) - (qpy * r.x)) / cross;
            return {
                x: p.x + r.x * t,
                y: p.y + r.y * t,
                t,
                u
            };
        }

        static _clipSegmentToRect(p0, p1, minX, minY, maxX, maxY) {
            if (!p0 || !p1) return null;
            const x0 = Number(p0.x);
            const y0 = Number(p0.y);
            const x1 = Number(p1.x);
            const y1 = Number(p1.y);
            if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
                return null;
            }

            const dx = x1 - x0;
            const dy = y1 - y0;
            let t0 = 0;
            let t1 = 1;

            const clipTest = (p, q) => {
                if (Math.abs(p) <= EPS) {
                    return q >= 0;
                }
                const r = q / p;
                if (p < 0) {
                    if (r > t1) return false;
                    if (r > t0) t0 = r;
                } else {
                    if (r < t0) return false;
                    if (r < t1) t1 = r;
                }
                return true;
            };

            if (!clipTest(-dx, x0 - minX)) return null;
            if (!clipTest(dx, maxX - x0)) return null;
            if (!clipTest(-dy, y0 - minY)) return null;
            if (!clipTest(dy, maxY - y0)) return null;

            if (t1 < t0) return null;
            return {
                tStart: Math.max(0, Math.min(1, t0)),
                tEnd: Math.max(0, Math.min(1, t1))
            };
        }

        static _orientation2D(a, b, c) {
            return ((b.x - a.x) * (c.y - a.y)) - ((b.y - a.y) * (c.x - a.x));
        }

        static _onSegment2D(a, b, c, eps = EPS) {
            return (
                Math.min(a.x, b.x) - eps <= c.x && c.x <= Math.max(a.x, b.x) + eps &&
                Math.min(a.y, b.y) - eps <= c.y && c.y <= Math.max(a.y, b.y) + eps
            );
        }

        static _segmentsIntersect2D(a, b, c, d, eps = EPS) {
            const o1 = WallSectionUnit._orientation2D(a, b, c);
            const o2 = WallSectionUnit._orientation2D(a, b, d);
            const o3 = WallSectionUnit._orientation2D(c, d, a);
            const o4 = WallSectionUnit._orientation2D(c, d, b);

            const s1 = Math.abs(o1) <= eps ? 0 : (o1 > 0 ? 1 : -1);
            const s2 = Math.abs(o2) <= eps ? 0 : (o2 > 0 ? 1 : -1);
            const s3 = Math.abs(o3) <= eps ? 0 : (o3 > 0 ? 1 : -1);
            const s4 = Math.abs(o4) <= eps ? 0 : (o4 > 0 ? 1 : -1);

            if (s1 !== s2 && s3 !== s4) return true;
            if (s1 === 0 && WallSectionUnit._onSegment2D(a, b, c, eps)) return true;
            if (s2 === 0 && WallSectionUnit._onSegment2D(a, b, d, eps)) return true;
            if (s3 === 0 && WallSectionUnit._onSegment2D(c, d, a, eps)) return true;
            if (s4 === 0 && WallSectionUnit._onSegment2D(c, d, b, eps)) return true;
            return false;
        }

        // Fallback for parallel/collinear side lines: intersect a wall side line
        // with the line perpendicular to that side direction through the joint
        // center. This keeps the corner ON the wall face plane.
        static _sideLinePerpendicularCenterHit(origin, dir, centerPoint) {
            if (!origin || !dir || !centerPoint) return null;
            if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y)) return null;
            const dlen = Math.hypot(dir.x, dir.y);
            if (!(dlen > EPS)) return null;
            const unitDir = { x: dir.x / dlen, y: dir.y / dlen };
            const perp = { x: -unitDir.y, y: unitDir.x };
            return WallSectionUnit._lineIntersection(origin, unitDir, centerPoint, perp);
        }

        static _chooseMidpointBridgeNode(mapRef, midpoint, towardEntity = null) {
            if (!WallSectionUnit._isNodeMidpoint(midpoint)) return null;

            if (mapRef && typeof mapRef._chooseMidpointBridgeNode === "function") {
                const chosen = mapRef._chooseMidpointBridgeNode(midpoint, towardEntity);
                if (chosen && WallSectionUnit._isMapNode(chosen)) return chosen;
            }

            const candidates = [midpoint.nodeA, midpoint.nodeB];
            const tx = Number(towardEntity && towardEntity.x);
            const ty = Number(towardEntity && towardEntity.y);

            const shortDx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? (a, b) => mapRef.shortestDeltaX(a, b)
                : (a, b) => (b - a);
            const shortDy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? (a, b) => mapRef.shortestDeltaY(a, b)
                : (a, b) => (b - a);

            let best = null;
            let bestDist = Infinity;
            for (let i = 0; i < candidates.length; i++) {
                const node = candidates[i];
                if (!WallSectionUnit._isMapNode(node)) continue;
                const dist = (Number.isFinite(tx) && Number.isFinite(ty))
                    ? Math.hypot(shortDx(node.x, tx), shortDy(node.y, ty))
                    : i;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = node;
                }
            }
            return best;
        }

        /**
         * After placing new wall sections, scan for crossings with existing
         * walls and split at every shared hex-grid anchor.  Three cases:
         *
         * 1. New wall interior anchor matches an existing wall's **endpoint**
         *    → split the new wall at that anchor.
         * 2. New wall endpoint matches an existing wall's **interior** anchor
         *    → split the existing wall at that anchor.
         * 3. New wall interior anchor matches an existing wall's **interior** anchor
         *    → split **both** walls at that anchor.
         *
         * Because every wall section is a straight-line segment, any two
         * non-collinear sections share at most one grid anchor (two lines
         * intersect at most once).  Collinear overlaps are already resolved
         * by the merge logic above, so each (newSection, existingWall) pair
         * produces at most one crossing here.  A single new section can
         * still cross *multiple different* existing walls, however, so we
         * cascade-split when needed.
         *
         * Uses map-node overlap for spatial narrowing so the cost is
         * proportional to the number of walls near the new placement, not
         * the total wall count.
         *
         * @param {WallSectionUnit[]} placedSections  Sections just created.
         * @param {object}            mapRef          The map they live on.
         * @returns {WallSectionUnit[]}  The (possibly expanded) set of live
         *          sections that should replace `placedSections` in the caller.
         */
        static applyCrossWallSplitsForPlacement(placedSections, mapRef) {
            if (!Array.isArray(placedSections) || placedSections.length === 0 || !mapRef) {
                return placedSections;
            }

            // Helper: shortest-delta aware line-segment intersection.
            // Returns { t, u, x, y } or null.  t is the parameter on seg A,
            // u on seg B; both in [0,1] if the segments actually cross.
            const sdx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? (a, b) => mapRef.shortestDeltaX(a, b) : (a, b) => b - a;
            const sdy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? (a, b) => mapRef.shortestDeltaY(a, b) : (a, b) => b - a;

            const segSegIntersection = (a1, a2, b1, b2) => {
                const d1x = sdx(a1.x, a2.x);
                const d1y = sdy(a1.y, a2.y);
                const d2x = sdx(b1.x, b2.x);
                const d2y = sdy(b1.y, b2.y);
                const d3x = sdx(a1.x, b1.x);
                const d3y = sdy(a1.y, b1.y);
                const denom = d1x * d2y - d1y * d2x;
                if (Math.abs(denom) < 1e-9) return null;  // parallel / collinear
                const t = (d3x * d2y - d3y * d2x) / denom;
                const u = (d3x * d1y - d3y * d1x) / denom;
                if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
                let ix = a1.x + Math.max(0, Math.min(1, t)) * d1x;
                let iy = a1.y + Math.max(0, Math.min(1, t)) * d1y;
                if (typeof mapRef.wrapWorldX === "function") ix = mapRef.wrapWorldX(ix);
                if (typeof mapRef.wrapWorldY === "function") iy = mapRef.wrapWorldY(iy);
                return {
                    t: Math.max(0, Math.min(1, t)),
                    u: Math.max(0, Math.min(1, u)),
                    x: ix, y: iy
                };
            };

            // Helper: point-to-segment closest-point parameter.
            // Returns { t, dist } where t ∈ [0,1] is the clamped parameter
            // on A1→A2 closest to point P.
            const pointSegParam = (p, a1, a2) => {
                const dx = sdx(a1.x, a2.x);
                const dy = sdy(a1.y, a2.y);
                const lenSq = dx * dx + dy * dy;
                if (lenSq < 1e-12) return { t: 0, dist: Math.hypot(sdx(a1.x, p.x), sdy(a1.y, p.y)) };
                const raw = (sdx(a1.x, p.x) * dx + sdy(a1.y, p.y) * dy) / lenSq;
                const t = Math.max(0, Math.min(1, raw));
                let cx = a1.x + t * dx;
                let cy = a1.y + t * dy;
                if (typeof mapRef.wrapWorldX === "function") cx = mapRef.wrapWorldX(cx);
                if (typeof mapRef.wrapWorldY === "function") cy = mapRef.wrapWorldY(cy);
                return { t, dist: Math.hypot(sdx(cx, p.x), sdy(cy, p.y)) };
            };

            // Maximum distance from an intersection/endpoint to the nearest
            // anchor for it to count as a valid split point.  Half the hex
            // diagonal covers the worst-case snap.
            const MAX_SNAP_DIST = 0.55;

            // Endpoint-parameter threshold: anchors with t within this margin
            // of 0 or 1 are treated as endpoints (already exist, nothing to
            // split).
            const ENDPOINT_EPS = 0.02;
            const isInterior = (t) => t > ENDPOINT_EPS && t < (1 - ENDPOINT_EPS);

            // ---- 1. Identify placed-section ids ----------------------------
            const placedIds = new Set();
            for (let i = 0; i < placedSections.length; i++) {
                const s = placedSections[i];
                if (s && Number.isInteger(s.id)) placedIds.add(s.id);
            }

            // ---- 2. Spatial narrowing via node-key overlap -----------------
            //   Collect map-node keys that the new sections sit on (cheap —
            //   their .nodes were populated by addToMapNodes just before this
            //   call).  Include each node's immediate odd-direction neighbors
            //   so that walls one hex step away are also considered.
            const newNodeKeys = new Set();
            for (let i = 0; i < placedSections.length; i++) {
                const sec = placedSections[i];
                if (!sec || sec.gone) continue;
                const nodes = Array.isArray(sec.nodes) ? sec.nodes : [];
                for (let n = 0; n < nodes.length; n++) {
                    const node = nodes[n];
                    if (!node || typeof node.xindex !== "number") continue;
                    newNodeKeys.add(node.xindex + "," + node.yindex);
                    // One-ring neighbors so diagonal crossing walls are found
                    if (Array.isArray(node.neighbors)) {
                        for (let d = 0; d < node.neighbors.length && d < 12; d++) {
                            const nb = node.neighbors[d];
                            if (nb && typeof nb.xindex === "number") {
                                newNodeKeys.add(nb.xindex + "," + nb.yindex);
                            }
                        }
                    }
                }
            }
            if (newNodeKeys.size === 0) return placedSections;

            // Collect candidate existing walls that share a node key.
            const candidateWalls = [];
            for (const [wid, wall] of WallSectionUnit._allSections) {
                if (placedIds.has(wid)) continue;
                if (!wall || wall.gone || wall.vanishing || wall.map !== mapRef) continue;
                const wnodes = Array.isArray(wall.nodes) ? wall.nodes : [];
                let nearby = false;
                for (let n = 0; n < wnodes.length; n++) {
                    const nd = wnodes[n];
                    if (nd && newNodeKeys.has(nd.xindex + "," + nd.yindex)) {
                        nearby = true;
                        break;
                    }
                }
                if (nearby) candidateWalls.push(wall);
            }
            if (candidateWalls.length === 0) return placedSections;

            // ---- 3. Detect crossings via geometric tests -------------------
            //   For each (new, existing) pair we run two tests:
            //     A) Segment–segment intersection  → X‑crossings
            //     B) Existing-endpoint proximity to new segment → T‑junctions
            //        where an existing wall's endpoint lies on the new wall.
            //   (New-endpoint-on-existing is already handled upstream by
            //   startSplitReference / endSplitReference, so we skip it here.)
            //
            //   Each crossing records which wall(s) need an interior split
            //   and the world point + resolved anchor for each.

            const crossings = [];           // { newSec, existWall, anchor, splitNew, splitExisting }
            const seenPair = new Set();     // "newId|existingId"

            for (let i = 0; i < placedSections.length; i++) {
                const ns = placedSections[i];
                if (!ns || ns.gone || !ns.startPoint || !ns.endPoint) continue;
                for (let j = 0; j < candidateWalls.length; j++) {
                    const ew = candidateWalls[j];
                    if (!ew || ew.gone || !ew.startPoint || !ew.endPoint) continue;
                    const pairKey = ns.id + "|" + ew.id;
                    if (seenPair.has(pairKey)) continue;

                    // --- Test A: line-segment intersection ------------------
                    const hit = segSegIntersection(
                        ns.startPoint, ns.endPoint,
                        ew.startPoint, ew.endPoint
                    );
                    if (hit) {
                        seenPair.add(pairKey);
                        const worldPt = { x: hit.x, y: hit.y };
                        const splitNew = isInterior(hit.t);
                        const splitExisting = isInterior(hit.u);
                        // If both are at endpoints they already share a vertex
                        // — joinery handles it, nothing to do.
                        if (!splitNew && !splitExisting) continue;

                        // Resolve to actual hex-grid anchors on each wall.
                        let newAnchor = null;
                        let existAnchor = null;
                        if (splitNew) {
                            const snap = ns.getNearestLineAnchorToWorldPoint(worldPt);
                            if (snap && !snap.isEndpoint && snap.distanceWorld < MAX_SNAP_DIST) {
                                newAnchor = snap.anchor;
                            }
                        }
                        if (splitExisting) {
                            const snap = ew.getNearestLineAnchorToWorldPoint(worldPt);
                            if (snap && !snap.isEndpoint && snap.distanceWorld < MAX_SNAP_DIST) {
                                existAnchor = snap.anchor;
                            }
                        }
                        if (!newAnchor && !existAnchor) continue;
                        crossings.push({
                            newSec: ns,
                            existWall: ew,
                            newAnchor: newAnchor,
                            existAnchor: existAnchor
                        });
                        continue;
                    }

                    // --- Test B: existing wall endpoint near new segment -----
                    const ewEndpoints = [ew.startPoint, ew.endPoint];
                    for (let ep = 0; ep < ewEndpoints.length; ep++) {
                        const ept = ewEndpoints[ep];
                        if (!ept || !Number.isFinite(ept.x) || !Number.isFinite(ept.y)) continue;
                        const proj = pointSegParam(ept, ns.startPoint, ns.endPoint);
                        if (!proj || proj.dist > MAX_SNAP_DIST || !isInterior(proj.t)) continue;
                        // The existing endpoint is close to the interior of
                        // the new segment → split the new segment there.
                        const snap = ns.getNearestLineAnchorToWorldPoint(ept);
                        if (!snap || !snap.anchor || snap.isEndpoint || snap.distanceWorld > MAX_SNAP_DIST) continue;
                        if (!seenPair.has(pairKey)) {
                            seenPair.add(pairKey);
                            crossings.push({
                                newSec: ns,
                                existWall: ew,
                                newAnchor: snap.anchor,
                                existAnchor: null     // existing wall is already at its endpoint
                            });
                        }
                        break;
                    }
                }
            }

            if (crossings.length === 0) return placedSections;

            // ---- 4. Split existing walls at interior crossings -------------
            const allSpawnedFromExisting = [];
            const existingSplitDone = new Set();
            for (let c = 0; c < crossings.length; c++) {
                const cr = crossings[c];
                if (!cr.existAnchor) continue;
                const ew = cr.existWall;
                if (!ew || ew.gone) continue;
                const aKey = WallSectionUnit.endpointKey(cr.existAnchor);
                const doneKey = ew.id + "|" + aKey;
                if (existingSplitDone.has(doneKey)) continue;
                existingSplitDone.add(doneKey);

                const result = ew.splitAtAnchor(cr.existAnchor, {
                    connectSections: placedSections,
                    metadata: { crossWallSplit: true }
                });
                if (result && Array.isArray(result.sections)) {
                    for (let s = 0; s < result.sections.length; s++) {
                        const ns = result.sections[s];
                        if (ns && !ns.gone) {
                            allSpawnedFromExisting.push(ns);
                            ns.addToMapNodes();
                        }
                    }
                }
            }

            // ---- 5. Split new sections at interior crossings ---------------
            //   Group anchors per section id so cascade-splits are handled.
            const newSplitMap = new Map();  // sectionId → [anchor, ...]
            for (let c = 0; c < crossings.length; c++) {
                const cr = crossings[c];
                if (!cr.newAnchor) continue;
                const sid = cr.newSec.id;
                let arr = newSplitMap.get(sid);
                if (!arr) { arr = []; newSplitMap.set(sid, arr); }
                arr.push(cr.newAnchor);
            }

            const resultSections = [];
            for (let i = 0; i < placedSections.length; i++) {
                const section = placedSections[i];
                if (!section || section.gone) continue;
                const splitAnchors = newSplitMap.get(section.id);
                if (!splitAnchors || splitAnchors.length === 0) {
                    resultSections.push(section);
                    continue;
                }
                // Cascade: after each split the original is gone and two
                // halves take its place. Find which half contains the next
                // anchor and split that one.
                let live = [section];
                for (let a = 0; a < splitAnchors.length; a++) {
                    const anchor = splitAnchors[a];
                    const anchorKey = WallSectionUnit.endpointKey(anchor);
                    for (let li = 0; li < live.length; li++) {
                        const seg = live[li];
                        if (!seg || seg.gone) continue;
                        if (
                            WallSectionUnit._pointsMatch(anchor, seg.startPoint) ||
                            WallSectionUnit._pointsMatch(anchor, seg.endPoint)
                        ) continue;
                        const nearest = (typeof seg.getNearestLineAnchorToWorldPoint === "function")
                            ? seg.getNearestLineAnchorToWorldPoint(anchor) : null;
                        if (!nearest || !nearest.anchor) continue;
                        if (WallSectionUnit.endpointKey(nearest.anchor) !== anchorKey) continue;
                        if (nearest.isEndpoint) continue;

                        const connectTo = allSpawnedFromExisting.concat(
                            live.filter(s => s && !s.gone && s !== seg)
                        );
                        const splitResult = seg.splitAtAnchor(anchor, {
                            connectSections: connectTo,
                            metadata: { crossWallSplit: true }
                        });
                        if (splitResult && Array.isArray(splitResult.sections)) {
                            live.splice(li, 1, ...splitResult.sections.filter(s => s && !s.gone));
                            for (let ns = 0; ns < splitResult.sections.length; ns++) {
                                const s = splitResult.sections[ns];
                                if (s && !s.gone) s.addToMapNodes();
                            }
                        }
                        break;
                    }
                }
                for (let li = 0; li < live.length; li++) {
                    if (live[li] && !live[li].gone) resultSections.push(live[li]);
                }
            }

            // ---- 6. Rebuild joinery for every section touched by a split ---
            const affectedSet = new Set();
            const addAffected = (s) => { if (s && !s.gone) affectedSet.add(s); };
            for (let i = 0; i < resultSections.length; i++) addAffected(resultSections[i]);
            for (let i = 0; i < allSpawnedFromExisting.length; i++) addAffected(allSpawnedFromExisting[i]);

            for (const wall of affectedSet) {
                if (wall.gone) continue;
                if (typeof wall.handleJoineryOnPlacement === "function") {
                    wall.handleJoineryOnPlacement();
                }
            }

            return resultSections;
        }

        static planPlacementFromWorldPoints(mapRef, startWorld, endWorld, options = {}) {
            if (!mapRef || !startWorld || !endWorld) return null;
            if (!Number.isFinite(startWorld.x) || !Number.isFinite(startWorld.y)) return null;
            if (!Number.isFinite(endWorld.x) || !Number.isFinite(endWorld.y)) return null;

            const shortDx = (typeof mapRef.shortestDeltaX === "function")
                ? (a, b) => mapRef.shortestDeltaX(a, b) : (a, b) => (b - a);
            const shortDy = (typeof mapRef.shortestDeltaY === "function")
                ? (a, b) => mapRef.shortestDeltaY(a, b) : (a, b) => (b - a);
            const sideTolerance = Number.isFinite(options.sideTolerance)
                ? Math.max(EPS, Number(options.sideTolerance))
                : 1e-5;
            const lineTolerance = Number.isFinite(options.lineTolerance)
                ? Math.max(EPS, Number(options.lineTolerance))
                : 1e-4;
            const startFromExistingWall = !!(options && options.startFromExistingWall);
            const startReferenceWall = (
                options &&
                options.startReferenceWall &&
                typeof options.startReferenceWall === "object"
            ) ? options.startReferenceWall : null;
            const rawStart = (
                options &&
                options.rawStartWorld &&
                Number.isFinite(options.rawStartWorld.x) &&
                Number.isFinite(options.rawStartWorld.y)
            )
                ? { x: Number(options.rawStartWorld.x), y: Number(options.rawStartWorld.y) }
                : { x: Number(startWorld.x), y: Number(startWorld.y) };
            const rawEnd = { x: Number(endWorld.x), y: Number(endWorld.y) };
            const distanceBetween = (a, b) => Math.hypot(shortDx(a.x, b.x), shortDy(a.y, b.y));
            const directionBetween = (a, b) => WallSectionUnit._normalizeDirection(
                (typeof mapRef.getHexDirection === "function")
                    ? mapRef.getHexDirection(shortDx(a.x, b.x), shortDy(a.y, b.y))
                    : 0
            );
            const emptyPlan = {
                start: rawStart,
                end: rawEnd,
                junction: null,
                primaryDirection: null,
                secondaryDirection: null,
                segments: []
            };
            const lineHitForDirections = (startAnchor, startDir, endAnchor, endDir) => {
                if (!startAnchor || !endAnchor || !Number.isFinite(startDir) || !Number.isFinite(endDir)) return null;
                const vecA = WallSectionUnit._directionUnitVector(startDir, mapRef, startAnchor);
                const vecB = WallSectionUnit._directionUnitVector(endDir, mapRef, endAnchor);
                return WallSectionUnit._lineIntersection(
                    { x: startAnchor.x, y: startAnchor.y },
                    vecA,
                    { x: endAnchor.x, y: endAnchor.y },
                    vecB
                );
            };
            const normalizeDirection = (dir) => WallSectionUnit._normalizeDirection(dir);
            const lineVectorFrom = (originAnchor, direction) =>
                WallSectionUnit._directionUnitVector(direction, mapRef, originAnchor);
            const pointLineMetrics = (originAnchor, lineVec, point) => {
                const dx = shortDx(originAnchor.x, point.x);
                const dy = shortDy(originAnchor.y, point.y);
                const along = (lineVec.x * dx) + (lineVec.y * dy);
                const perp = Math.abs((lineVec.x * dy) - (lineVec.y * dx));
                return { along, perp };
            };
            const isForwardOnLine = (originAnchor, lineVec, point, tolerance = lineTolerance) => {
                const metrics = pointLineMetrics(originAnchor, lineVec, point);
                return metrics.along >= -tolerance && metrics.perp <= tolerance;
            };
            const directionDistance = (a, b) => {
                const da = normalizeDirection(a);
                const db = normalizeDirection(b);
                const diff = Math.abs(da - db) % 12;
                return Math.min(diff, 12 - diff);
            };
            const isDirectionallyForward = (originAnchor, lineVec, direction, point, tolerance = lineTolerance) => {
                if (!originAnchor || !point) return false;
                const metrics = pointLineMetrics(originAnchor, lineVec, point);
                if (metrics.along < -tolerance) return false;
                const candidateDir = directionBetween(originAnchor, point);
                if (!Number.isFinite(candidateDir)) return false;
                return directionDistance(candidateDir, direction) <= 1;
            };
            const collectForwardAnchorsOnDirection = (startAnchor, direction, targetForward = null) => {
                const lineVec = lineVectorFrom(startAnchor, direction);
                const anchors = [];
                const seen = new Set();
                const push = (anchor) => {
                    if (!anchor) return false;
                    const key = WallSectionUnit.endpointKey(anchor);
                    if (!key || seen.has(key)) return false;
                    seen.add(key);
                    anchors.push(anchor);
                    return true;
                };
                push(startAnchor);
                const forwardTarget = Number.isFinite(targetForward)
                    ? Math.max(2, Number(targetForward) + 2)
                    : 8;
                const maxSteps = Math.max(12, Math.min(256, Math.ceil((forwardTarget + 3) / 0.5) + 8));
                let current = startAnchor;
                for (let i = 0; i < maxSteps; i++) {
                    const next = anchorNeighborInDirection(current, direction);
                    if (!next) break;
                    if (!push(next)) break;
                    current = next;
                    const metrics = pointLineMetrics(startAnchor, lineVec, next);
                    if (metrics.along >= forwardTarget + 1.5) break;
                }
                return { anchors, lineVec };
            };
            const chooseClosestForwardAnchor = (
                startAnchor,
                direction,
                targetPoint,
                { excludeStart = false } = {}
            ) => {
                const primaryVec = lineVectorFrom(startAnchor, direction);
                const targetForward = pointLineMetrics(startAnchor, primaryVec, targetPoint).along;
                const collection = collectForwardAnchorsOnDirection(startAnchor, direction, targetForward);
                const anchors = collection.anchors;
                const lineVec = collection.lineVec;
                let best = null;
                let bestDist = Infinity;
                let bestAlong = Infinity;
                for (let i = 0; i < anchors.length; i++) {
                    const anchor = anchors[i];
                    if (!anchor) continue;
                    if (excludeStart && WallSectionUnit._pointsMatch(anchor, startAnchor)) continue;
                    if (
                        !isForwardOnLine(startAnchor, lineVec, anchor) &&
                        !isDirectionallyForward(startAnchor, lineVec, direction, anchor)
                    ) continue;
                    const metrics = pointLineMetrics(startAnchor, lineVec, anchor);
                    const dist = distanceBetween(anchor, targetPoint);
                    if (
                        dist < bestDist - 1e-6 ||
                        (Math.abs(dist - bestDist) <= 1e-6 && metrics.along < bestAlong - 1e-6)
                    ) {
                        best = anchor;
                        bestDist = dist;
                        bestAlong = metrics.along;
                    }
                }
                return best;
            };

            const rawDragDistance = distanceBetween(rawStart, rawEnd);
            if (rawDragDistance <= 0.5 + EPS) {
                return emptyPlan;
            }

            const chosenStartDirection = directionBetween(rawStart, rawEnd);
            let chosenEndDirection = null;
            const rawPrimaryVec = WallSectionUnit._directionUnitVector(chosenStartDirection, mapRef, rawStart);
            const rawDx = shortDx(rawStart.x, rawEnd.x);
            const rawDy = shortDy(rawStart.y, rawEnd.y);
            const rawSideCross = (rawPrimaryVec.x * rawDy) - (rawPrimaryVec.y * rawDx);
            if (Math.abs(rawSideCross) > sideTolerance) {
                chosenEndDirection = WallSectionUnit._normalizeDirection(
                    chosenStartDirection + (rawSideCross > 0 ? 1 : 11)
                );
                const rawHit = lineHitForDirections(rawStart, chosenStartDirection, rawEnd, chosenEndDirection);
                if (rawHit && Number.isFinite(rawHit.x) && Number.isFinite(rawHit.y)) {
                    const secondLegRawLength = distanceBetween(rawHit, rawEnd);
                    if (secondLegRawLength < 0.5 - EPS) {
                        chosenEndDirection = null;
                    }
                } else {
                    chosenEndDirection = null;
                }
            }
            const startAnchor = WallSectionUnit.normalizeEndpoint(startWorld, mapRef);
            if (!startAnchor) return emptyPlan;

            const startPrimaryVec = lineVectorFrom(startAnchor, chosenStartDirection);
            const endFromStartMetrics = pointLineMetrics(startAnchor, startPrimaryVec, rawEnd);
            const perpendicularDistance = Math.abs(endFromStartMetrics.perp);

            const finalizeSingleDirection = () => {
                const endAnchor = chooseClosestForwardAnchor(startAnchor, chosenStartDirection, rawEnd);
                const hasMainSegment = !!(
                    endAnchor &&
                    !WallSectionUnit._pointsMatch(startAnchor, endAnchor)
                );
                if (!hasMainSegment) return emptyPlan;
                return {
                    start: startAnchor,
                    end: endAnchor,
                    junction: null,
                    primaryDirection: chosenStartDirection,
                    secondaryDirection: null,
                    segments: [{
                        start: startAnchor,
                        end: endAnchor,
                        direction: chosenStartDirection
                    }]
                };
            };

            if (perpendicularDistance < 0.33 || !Number.isFinite(chosenEndDirection)) {
                return finalizeSingleDirection();
            }

            const secondaryDirection = normalizeDirection(chosenEndDirection);
            const secondaryVec = lineVectorFrom(rawEnd, secondaryDirection);
            const lineIntersection = WallSectionUnit._lineIntersection(
                { x: Number(startAnchor.x), y: Number(startAnchor.y) },
                startPrimaryVec,
                { x: Number(rawEnd.x), y: Number(rawEnd.y) },
                secondaryVec
            );
            if (!lineIntersection || !Number.isFinite(lineIntersection.x) || !Number.isFinite(lineIntersection.y)) {
                return finalizeSingleDirection();
            }

            const junctionAnchor = chooseClosestForwardAnchor(
                startAnchor,
                chosenStartDirection,
                { x: lineIntersection.x, y: lineIntersection.y },
                { excludeStart: true }
            );
            if (!junctionAnchor) return finalizeSingleDirection();

            const secondaryEndAnchor = chooseClosestForwardAnchor(
                junctionAnchor,
                secondaryDirection,
                rawEnd
            );
            if (!secondaryEndAnchor) {
                return {
                    start: startAnchor,
                    end: junctionAnchor,
                    junction: junctionAnchor,
                    primaryDirection: chosenStartDirection,
                    secondaryDirection,
                    segments: [{
                        start: startAnchor,
                        end: junctionAnchor,
                        direction: chosenStartDirection
                    }]
                };
            }

            const segments = [{
                start: startAnchor,
                end: junctionAnchor,
                direction: chosenStartDirection
            }];
            if (!WallSectionUnit._pointsMatch(junctionAnchor, secondaryEndAnchor)) {
                segments.push({
                    start: junctionAnchor,
                    end: secondaryEndAnchor,
                    direction: secondaryDirection
                });
            }
            return {
                start: startAnchor,
                end: secondaryEndAnchor,
                junction: junctionAnchor,
                primaryDirection: chosenStartDirection,
                secondaryDirection,
                segments
            };
        }

        static resolvePlacementSegmentsFromWorldPoints(mapRef, startWorld, endWorld, options = {}) {
            const plan = WallSectionUnit.planPlacementFromWorldPoints(mapRef, startWorld, endWorld, options);
            let segments = [];
            if (plan && Array.isArray(plan.segments)) {
                segments = plan.segments.slice();
            }

            return { plan, segments };
        }

        static createPlacementFromWorldPoints(mapRef, startWorld, endWorld, options = {}) {
            const prevPlacementDebugActive = WallSectionUnit._placementDebugActive;
            const prevPlacementDebugFocusIds = WallSectionUnit._placementDebugFocusIds;
            WallSectionUnit._placementDebugActive = true;
            try {
            const preResolvedSegments = Array.isArray(options.preResolvedSegments)
                ? options.preResolvedSegments
                : null;
            WallSectionUnit._placementDebugFocusIds = null;
            let plan = options.preResolvedPlan || null;
            let sourceSegments = [];
            if (preResolvedSegments && preResolvedSegments.length > 0) {
                sourceSegments = preResolvedSegments;
            } else {
                const resolved = WallSectionUnit.resolvePlacementSegmentsFromWorldPoints(
                    mapRef,
                    startWorld,
                    endWorld,
                    options
                );
                plan = resolved && resolved.plan ? resolved.plan : null;
                sourceSegments = (resolved && Array.isArray(resolved.segments)) ? resolved.segments : [];
            }
            if (sourceSegments.length === 0) {
                return { plan, sections: [] };
            }

            const preexistingSections = Array.from(WallSectionUnit._allSections.values())
                .filter(section => section && !section.gone && section.map === mapRef);
            const preexistingSectionSet = new Set(preexistingSections);
            const placementDebugEnabled = !!(globalScope && globalScope.DEBUG_WALL_PLACEMENT);
            const placementDebugLog = (...args) => {
                if (!placementDebugEnabled) return;
                console.log("[WALL_PLACE_DEBUG]", ...args);
            };
            const formatPoint = (pt) => {
                if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return "(?, ?)";
                return `(${Number(pt.x).toFixed(4)}, ${Number(pt.y).toFixed(4)})`;
            };
            const wallLabel = (wall) => {
                if (!wall) return "wall<?>";
                const id = Number.isInteger(wall.id) ? String(wall.id) : "?";
                return `wall#${id} ${formatPoint(wall.startPoint)} -> ${formatPoint(wall.endPoint)}`;
            };

            const sections = [];
            const mergedIntoExisting = [];
            const overlapTouchedSections = new Set();
            for (let i = 0; i < sourceSegments.length; i++) {
                let seg = sourceSegments[i];
                if (!seg || !seg.start || !seg.end) continue;
                if (WallSectionUnit._pointsMatch(seg.start, seg.end)) continue;
                placementDebugLog("segment:source", {
                    index: i,
                    start: formatPoint(seg.start),
                    end: formatPoint(seg.end)
                });
                if (WallSectionUnit._pointsMatch(seg.start, seg.end)) continue;
                placementDebugLog("segment:resolved", {
                    index: i,
                    start: formatPoint(seg.start),
                    end: formatPoint(seg.end)
                });
                const section = new WallSectionUnit(seg.start, seg.end, {
                    map: mapRef,
                    height: Number.isFinite(options.height) ? Number(options.height) : 1,
                    thickness: Number.isFinite(options.thickness) ? Number(options.thickness) : 0.1,
                    bottomZ: Number.isFinite(options.bottomZ) ? Number(options.bottomZ) : 0,
                    wallTexturePath: (typeof options.wallTexturePath === "string" && options.wallTexturePath.length > 0)
                        ? options.wallTexturePath
                        : DEFAULT_WALL_TEXTURE,
                    texturePhaseA: Number.isFinite(options.texturePhaseA) ? Number(options.texturePhaseA) : NaN,
                    texturePhaseB: Number.isFinite(options.texturePhaseB) ? Number(options.texturePhaseB) : NaN
                });
                const fallbackDirection = (mapRef && typeof mapRef.getHexDirection === "function")
                    ? mapRef.getHexDirection(
                        (typeof mapRef.shortestDeltaX === "function")
                            ? mapRef.shortestDeltaX(seg.start.x, seg.end.x)
                            : (seg.end.x - seg.start.x),
                        (typeof mapRef.shortestDeltaY === "function")
                            ? mapRef.shortestDeltaY(seg.start.y, seg.end.y)
                            : (seg.end.y - seg.start.y)
                    )
                    : 0;
                const sectionDirection = Number.isFinite(seg.direction)
                    ? Number(seg.direction)
                    : fallbackDirection;
                section.direction = WallSectionUnit._normalizeDirection(sectionDirection);
                section.lineAxis = (((section.direction % 6) + 6) % 6);
                section.rebuildMesh3d();

                let activeSection = section;
                let mergedWithExisting = false;
                let overlapMerged = true;
                let overlapGuard = 0;
                while (overlapMerged && overlapGuard < 128 && activeSection && !activeSection.gone) {
                    overlapMerged = false;
                    overlapGuard += 1;

                    let overlapTarget = null;
                    const nearbySections = WallSectionUnit._collectNearbyWallSections([activeSection], {
                        includeNeighborNodes: false,
                        fallbackToGlobal: false,
                        allowedSet: preexistingSectionSet,
                        map: mapRef
                    });
                    const candidatePool = (nearbySections.length > 0) ? nearbySections : preexistingSections;
                    for (let j = 0; j < candidatePool.length; j++) {
                        const candidate = candidatePool[j];
                        if (!candidate || candidate === activeSection) continue;
                        if (candidate.gone || candidate.vanishing) continue;
                        if (candidate.map !== mapRef) continue;
                        const overlapData = WallSectionUnit._computeCollinearOverlapData(candidate, activeSection)
                            || WallSectionUnit._computeCollinearOverlapData(activeSection, candidate);
                        if (!overlapData) continue;
                        placementDebugLog("merge:overlap-candidate", {
                            active: wallLabel(activeSection),
                            candidate: wallLabel(candidate),
                            overlapLength: Number((overlapData.overlapLength || 0).toFixed(6)),
                            mergedStart: formatPoint(overlapData.mergedStart),
                            mergedEnd: formatPoint(overlapData.mergedEnd)
                        });
                        if (!overlapTarget) {
                            overlapTarget = candidate;
                            continue;
                        }
                        const currentId = Number.isInteger(overlapTarget.id) ? Number(overlapTarget.id) : Number.POSITIVE_INFINITY;
                        const candidateId = Number.isInteger(candidate.id) ? Number(candidate.id) : Number.POSITIVE_INFINITY;
                        if (candidateId < currentId) {
                            overlapTarget = candidate;
                        }
                    }

                    if (!overlapTarget) break;

                    const activeId = Number.isInteger(activeSection.id) ? Number(activeSection.id) : Number.POSITIVE_INFINITY;
                    const targetId = Number.isInteger(overlapTarget.id) ? Number(overlapTarget.id) : Number.POSITIVE_INFINITY;
                    const survivor = (targetId <= activeId) ? overlapTarget : activeSection;
                    const absorbed = (survivor === overlapTarget) ? activeSection : overlapTarget;

                    const merged = WallSectionUnit.mergeOverlappingPlacementPair(survivor, absorbed, {
                        applyDirectionalBlocking: false,
                        deferVisualUpdate: true
                    });
                    if (!merged || merged.gone) {
                        placementDebugLog("merge:failed", {
                            survivor: wallLabel(survivor),
                            absorbed: wallLabel(absorbed)
                        });
                        activeSection = null;
                        break;
                    }

                    placementDebugLog("merge:success", {
                        survivor: wallLabel(merged),
                        absorbedId: Number.isInteger(absorbed.id) ? absorbed.id : null
                    });
                    activeSection = merged;
                    overlapTouchedSections.add(merged);
                    overlapMerged = true;
                    mergedWithExisting = mergedWithExisting || (activeSection !== section) || (overlapTarget === section);
                }

                if (!activeSection || activeSection.gone) continue;
                if (mergedWithExisting || activeSection !== section) {
                    if (!mergedIntoExisting.includes(activeSection)) {
                        mergedIntoExisting.push(activeSection);
                    }
                    continue;
                }

                sections.push(activeSection);
            }

            if (overlapTouchedSections.size > 0) {
                overlapTouchedSections.forEach((section) => {
                    if (!section || section.gone || section.vanishing) return;
                    section.addToMapNodes();
                    if (typeof section.handleJoineryOnPlacement === "function") {
                        section.handleJoineryOnPlacement();
                    } else {
                        if (typeof section.rebuildMesh3d === "function") section.rebuildMesh3d();
                        if (typeof section.draw === "function") section.draw();
                    }
                });
            }

            if (options.harmonizeTexturePhase !== false) {
                WallSectionUnit.harmonizeTexturePhaseForSections(sections, preexistingSections);
            }

            const seedsForContinuousMerge = sections.concat(
                mergedIntoExisting.filter(section => !!section && !section.gone && !section.vanishing)
            );
            if (placementDebugEnabled) {
                const focus = new Set();
                for (let i = 0; i < seedsForContinuousMerge.length; i++) {
                    const section = seedsForContinuousMerge[i];
                    if (!section || !Number.isInteger(section.id)) continue;
                    focus.add(Number(section.id));
                }
                WallSectionUnit._placementDebugFocusIds = focus;
            }

            const mergedSections = (options.autoMergeContinuous === false)
                ? seedsForContinuousMerge.slice()
                : WallSectionUnit.autoMergeContinuousSections(seedsForContinuousMerge);

            if (mergedSections.length >= 2) {
                for (let i = 0; i < mergedSections.length - 1; i++) {
                    mergedSections[i].connectTo(mergedSections[i + 1], { placementChain: true });
                    mergedSections[i + 1].connectTo(mergedSections[i], { placementChain: true });
                }
            }

            const startSplitReference = (
                options &&
                options.startSplitReference &&
                typeof options.startSplitReference === "object"
            ) ? options.startSplitReference : null;
            const endSplitReference = (
                options &&
                options.endSplitReference &&
                typeof options.endSplitReference === "object"
            ) ? options.endSplitReference : null;

            if (mergedSections.length > 0) {
                const splitRefs = [];
                if (startSplitReference) splitRefs.push(startSplitReference);
                if (endSplitReference) splitRefs.push(endSplitReference);

                const seenSplitKeys = new Set();
                for (let i = 0; i < splitRefs.length; i++) {
                    const ref = splitRefs[i];
                    if (!ref || !ref.wall || !ref.anchor) continue;
                    if (ref.wall.gone || ref.wall.map !== mapRef) continue;
                    if (typeof ref.wall.splitAtAnchor !== "function") continue;
                    if (mergedSections.includes(ref.wall)) {
                        if (placementDebugEnabled) {
                            placementDebugLog("split-ref:skip-wall-already-in-merged-result", {
                                wallId: Number.isInteger(ref.wall.id) ? Number(ref.wall.id) : null,
                                anchor: formatPoint(ref.anchor)
                            });
                        }
                        continue;
                    }
                    const anchorKey = WallSectionUnit.endpointKey(ref.anchor);

                    const wallKey = Number.isInteger(ref.wall.id) ? `id:${ref.wall.id}` : `obj:${i}`;
                    const splitKey = `${wallKey}|${anchorKey}`;
                    if (!anchorKey || seenSplitKeys.has(splitKey)) continue;
                    seenSplitKeys.add(splitKey);

                    ref.wall.splitAtAnchor(ref.anchor, {
                        connectSections: mergedSections,
                        metadata: { splitForWallPlacement: true }
                    });
                }
            }

            // Cross-wall splitting: scan the newly placed sections for hex-grid
            // anchors shared with existing walls and split at every crossing.
            // (Handles T-junctions and X-junctions automatically.)
            // Ensure each new section is registered on the map nodes it
            // spans so the spatial-narrowing step can find candidate walls.
            if (options.applyCrossSplits !== false) {
                for (let ms = 0; ms < mergedSections.length; ms++) {
                    const sec = mergedSections[ms];
                    if (sec && !sec.gone && typeof sec.addToMapNodes === "function") {
                        sec.addToMapNodes();
                    }
                }
                const crossResult = WallSectionUnit.applyCrossWallSplitsForPlacement(
                    mergedSections, mapRef
                );
                // Replace mergedSections contents in-place so downstream code
                // (addToMapObjects, returnedSections) sees the updated list.
                mergedSections.length = 0;
                for (let ci = 0; ci < crossResult.length; ci++) {
                    mergedSections.push(crossResult[ci]);
                }
            }

            if (options.addToMapObjects === true && mapRef && Array.isArray(mapRef.objects)) {
                const allResultSections = mergedSections.concat(mergedIntoExisting);
                for (let i = 0; i < allResultSections.length; i++) {
                    if (!mapRef.objects.includes(allResultSections[i])) {
                        mapRef.objects.push(allResultSections[i]);
                    }
                }
            }

            const returnedSections = mergedSections.slice();
            for (let i = 0; i < mergedIntoExisting.length; i++) {
                const section = mergedIntoExisting[i];
                if (!section || section.gone) continue;
                if (!returnedSections.includes(section)) {
                    returnedSections.push(section);
                }
            }

            return { plan, sections: returnedSections };
            } finally {
                WallSectionUnit._placementDebugActive = prevPlacementDebugActive;
                WallSectionUnit._placementDebugFocusIds = prevPlacementDebugFocusIds;
            }
        }

        setEndpoints(startPoint, endPoint, mapRef = null) {
            const resolvedMap = mapRef || this.map || null;
            const start = WallSectionUnit.normalizeEndpoint(startPoint, resolvedMap);
            const end = WallSectionUnit.normalizeEndpoint(endPoint, resolvedMap);
            if (!start || !end) {
                throw new Error("WallSectionUnit endpoints must resolve to a hex node or node midpoint.");
            }
            if (WallSectionUnit._pointsMatch(start, end)) {
                throw new Error("WallSectionUnit endpoints cannot be identical.");
            }

            this.map = resolvedMap;
            this.startPoint = start;
            this.endPoint = end;

            const dx = (this.map && typeof this.map.shortestDeltaX === "function")
                ? this.map.shortestDeltaX(start.x, end.x)
                : (end.x - start.x);
            const dy = (this.map && typeof this.map.shortestDeltaY === "function")
                ? this.map.shortestDeltaY(start.y, end.y)
                : (end.y - start.y);
            this.length = Math.hypot(dx, dy);
            this.center = {
                x: (Number(start.x) + Number(end.x)) * 0.5,
                y: (Number(start.y) + Number(end.y)) * 0.5
            };

            const dir = (this.map && typeof this.map.getHexDirection === "function")
                ? this.map.getHexDirection(dx, dy)
                : 0;
            this.direction = Number.isFinite(dir) ? Number(dir) : 0;
            this.lineAxis = (((this.direction % 6) + 6) % 6);

            this.rebuildMesh3d();
            return this;
        }

        getEndpointArray() {
            return [this.startPoint, this.endPoint];
        }

        sharesEndpointWith(otherSection) {
            if (!otherSection || typeof otherSection.getEndpointArray !== "function") return false;
            const [a0, a1] = this.getEndpointArray();
            const [b0, b1] = otherSection.getEndpointArray();
            return (
                WallSectionUnit._pointsMatch(a0, b0) ||
                WallSectionUnit._pointsMatch(a0, b1) ||
                WallSectionUnit._pointsMatch(a1, b0) ||
                WallSectionUnit._pointsMatch(a1, b1)
            );
        }

        connectTo(otherSection, metadata = {}) {
            if (!otherSection || otherSection === this || !Number.isInteger(otherSection.id)) return false;
            if (!this.sharesEndpointWith(otherSection)) return false;
            const payload = {
                section: otherSection,
                attachedAtMs: Date.now(),
                sharedEndpointKey: this._resolveSharedEndpointKey(otherSection),
                metadata: (metadata && typeof metadata === "object") ? { ...metadata } : {}
            };
            this.connections.set(Number(otherSection.id), payload);
            return true;
        }

        detachFrom(otherSectionOrId) {
            const id = Number.isInteger(otherSectionOrId)
                ? Number(otherSectionOrId)
                : (Number.isInteger(otherSectionOrId && otherSectionOrId.id) ? Number(otherSectionOrId.id) : null);
            if (!Number.isInteger(id)) return false;
            return this.connections.delete(id);
        }

        rebuildConnections(candidateSections = []) {
            const prevIds = new Set(this.connections.keys());
            this.connections.clear();
            if (!Array.isArray(candidateSections)) return;
            for (let i = 0; i < candidateSections.length; i++) {
                const candidate = candidateSections[i];
                if (!candidate || candidate === this) continue;
                if (!Number.isInteger(candidate.id)) continue;
                if (!this.sharesEndpointWith(candidate)) continue;
                const wasConnected = prevIds.has(Number(candidate.id));
                this.connectTo(candidate, { rebuilt: true, previouslyConnected: wasConnected });
            }
        }

        _resolveSharedEndpointKey(otherSection) {
            if (!otherSection || typeof otherSection.getEndpointArray !== "function") return null;
            const [a0, a1] = this.getEndpointArray();
            const [b0, b1] = otherSection.getEndpointArray();
            if (WallSectionUnit._pointsMatch(a0, b0) || WallSectionUnit._pointsMatch(a0, b1)) {
                return WallSectionUnit.endpointKey(a0);
            }
            if (WallSectionUnit._pointsMatch(a1, b0) || WallSectionUnit._pointsMatch(a1, b1)) {
                return WallSectionUnit.endpointKey(a1);
            }
            return null;
        }

        attachObject(obj, options = {}) {
            if (!obj) return false;
            const id = Number.isInteger(this.id) ? Number(this.id) : null;
            if (!Number.isInteger(id)) return false;

            const direction = Number.isFinite(options.direction)
                ? Number(options.direction)
                : this.direction;
            const entry = {
                object: obj,
                direction,
                offsetAlong: Number.isFinite(options.offsetAlong) ? Number(options.offsetAlong) : 0,
                attachedAtMs: Date.now()
            };

            const existingIdx = this.attachedObjects.findIndex(item => item && item.object === obj);
            if (existingIdx >= 0) {
                this.attachedObjects[existingIdx] = entry;
            } else {
                this.attachedObjects.push(entry);
            }

            obj.mountedSectionId = id;
            obj.mountedWallLineGroupId = id;
            obj.mountedWallSectionUnitId = id;
            obj.wallSectionDirection = direction;
            if (!Number.isFinite(obj.placementRotation)) {
                const angle = Math.atan2(this.endPoint.y - this.startPoint.y, this.endPoint.x - this.startPoint.x);
                obj.placementRotation = angle;
            }
            return true;
        }

        detachObject(obj) {
            if (!obj) return false;
            const idx = this.attachedObjects.findIndex(item => item && item.object === obj);
            if (idx < 0) return false;
            this.attachedObjects.splice(idx, 1);
            if (obj.mountedSectionId === this.id) obj.mountedSectionId = null;
            if (obj.mountedWallLineGroupId === this.id) obj.mountedWallLineGroupId = null;
            if (obj.mountedWallSectionUnitId === this.id) obj.mountedWallSectionUnitId = null;
            if (obj.wallSectionDirection === this.direction) obj.wallSectionDirection = null;
            return true;
        }

        _buildBasePerimeterCorners() {
            const sx = Number(this.startPoint && this.startPoint.x);
            const sy = Number(this.startPoint && this.startPoint.y);
            const ex = Number(this.endPoint && this.endPoint.x);
            const ey = Number(this.endPoint && this.endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) {
                return null;
            }

            const dx = ex - sx;
            const dy = ey - sy;
            const len = Math.hypot(dx, dy);
            if (!(len > EPS)) return null;

            const nx = -dy / len;
            const ny = dx / len;
            const halfT = Math.max(0.001, Number(this.thickness) || 0.001) * 0.5;

            let al = { x: sx + nx * halfT, y: sy + ny * halfT };
            let ar = { x: sx - nx * halfT, y: sy - ny * halfT };
            let bl = { x: ex + nx * halfT, y: ey + ny * halfT };
            let br = { x: ex - nx * halfT, y: ey - ny * halfT };
            let startCenter = null;
            let endCenter = null;

            // Endpoint joinery corner overrides.
            if (this._joineryCorners) {
                const startKey = WallSectionUnit.endpointKey(this.startPoint);
                const endKey = WallSectionUnit.endpointKey(this.endPoint);

                const startJoin = this._joineryCorners[startKey];
                if (startJoin && startJoin.sharedEnd === "start") {
                    if (startJoin.posN) al = startJoin.posN;
                    if (startJoin.negN) ar = startJoin.negN;
                    if (startJoin.center && Number.isFinite(startJoin.center.x) && Number.isFinite(startJoin.center.y)) {
                        startCenter = { x: Number(startJoin.center.x), y: Number(startJoin.center.y) };
                    }
                }

                const endJoin = this._joineryCorners[endKey];
                if (endJoin && endJoin.sharedEnd === "end") {
                    if (endJoin.posN) bl = endJoin.posN;
                    if (endJoin.negN) br = endJoin.negN;
                    if (endJoin.center && Number.isFinite(endJoin.center.x) && Number.isFinite(endJoin.center.y)) {
                        endCenter = { x: Number(endJoin.center.x), y: Number(endJoin.center.y) };
                    }
                }
            }

            // Build base perimeter in clockwise order.
            // start cap is ordered +N -> (center) -> -N
            // end cap is ordered +N -> (center) -> -N
            const startCap = startCenter ? [al, startCenter, ar] : [al, ar];
            const endCap = endCenter ? [bl, endCenter, br] : [bl, br];
            const perimeter = [
                startCap[0],
                endCap[0],
                ...endCap.slice(1),
                startCap[startCap.length - 1],
                ...startCap.slice(1, startCap.length - 1).reverse()
            ];

            return perimeter.length >= 3 ? perimeter : null;
        }

        _rebuildGroundPlaneHitboxFromBasePerimeter(perimeter = null) {
            const corners = Array.isArray(perimeter) ? perimeter : this._buildBasePerimeterCorners();
            if (!Array.isArray(corners) || corners.length < 3) {
                this.groundPlaneHitbox = null;
                return null;
            }

            if (typeof globalScope.PolygonHitbox === "function") {
                this.groundPlaneHitbox = new globalScope.PolygonHitbox(
                    corners.map(c => ({ x: Number(c.x), y: Number(c.y) }))
                );
            } else {
                this.groundPlaneHitbox = null;
            }
            return this.groundPlaneHitbox;
        }

        generateLosOcclusionSpan(wizardRef, helpers = {}) {
            if (!wizardRef || !Number.isFinite(wizardRef.x) || !Number.isFinite(wizardRef.y)) return [];

            const bins = Number.isFinite(helpers.bins) ? Math.max(1, Math.floor(helpers.bins)) : 0;
            const angleForBin = (typeof helpers.angleForBin === "function") ? helpers.angleForBin : null;
            const forEachBinInShortSpan = (typeof helpers.forEachBinInShortSpan === "function") ? helpers.forEachBinInShortSpan : null;
            const raySegmentDistance = (typeof helpers.raySegmentDistance === "function") ? helpers.raySegmentDistance : null;
            if (!bins || !angleForBin || !forEachBinInShortSpan || !raySegmentDistance) return [];

            const shortestDeltaX = (typeof helpers.shortestDeltaX === "function")
                ? helpers.shortestDeltaX
                : ((fromX, toX) => toX - fromX);
            const shortestDeltaY = (typeof helpers.shortestDeltaY === "function")
                ? helpers.shortestDeltaY
                : ((fromY, toY) => toY - fromY);
            const mazeMode = !!helpers.mazeMode;

            const sx = Number(this.startPoint && this.startPoint.x);
            const sy = Number(this.startPoint && this.startPoint.y);
            const ex = Number(this.endPoint && this.endPoint.x);
            const ey = Number(this.endPoint && this.endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) return [];

            const wx = Number(wizardRef.x);
            const wy = Number(wizardRef.y);
            const startX = wx + shortestDeltaX(wx, sx);
            const startY = wy + shortestDeltaY(wy, sy);
            const endX = wx + shortestDeltaX(wx, ex);
            const endY = wy + shortestDeltaY(wy, ey);
            const dx = endX - startX;
            const dy = endY - startY;
            const len = Math.hypot(dx, dy);
            if (!(len > EPS)) return [];

            const ux = dx / len;
            const uy = dy / len;
            const nx = -uy;
            const ny = ux;
            const halfT = Math.max(0.001, Number(this.thickness) || 0.001) * 0.5;

            const hits = [];

            const pushHitsForSegment = (p1, p2) => {
                if (!p1 || !p2) return;
                const a0 = Math.atan2(p1.y - wy, p1.x - wx);
                const a1 = Math.atan2(p2.y - wy, p2.x - wx);
                forEachBinInShortSpan(a0, a1, bins, binIdx => {
                    if (!Number.isInteger(binIdx) || binIdx < 0 || binIdx >= bins) return;
                    const theta = angleForBin(binIdx);
                    if (!Number.isFinite(theta)) return;
                    const dirX = Math.cos(theta);
                    const dirY = Math.sin(theta);
                    const hitDist = raySegmentDistance(wx, wy, dirX, dirY, p1.x, p1.y, p2.x, p2.y);
                    if (hitDist === null) return;
                    hits.push({ binIdx, hitDist });
                });
            };

            if (mazeMode) {
                const facingFace = this.getPlayerFacingLongSideCornersWorld({
                    player: wizardRef
                });
                const allFaces = this._buildFaceQuadsWorld();
                if (Array.isArray(facingFace) && facingFace.length >= 2) {
                    const toLosSpace = point => {
                        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
                        return {
                            x: wx + shortestDeltaX(wx, Number(point.x)),
                            y: wy + shortestDeltaY(wy, Number(point.y))
                        };
                    };
                    const faceStart = toLosSpace(facingFace[0]);
                    const faceEnd = toLosSpace(facingFace[1]);
                    if (faceStart && faceEnd) {
                        pushHitsForSegment(faceStart, faceEnd);
                    }

                    // In maze mode, wall ends should still occlude LOS.
                    const sameFace = (a, b) => (
                        Array.isArray(a) &&
                        Array.isArray(b) &&
                        a.length >= 4 &&
                        b.length >= 4 &&
                        this._faceCornersMatch(a, b)
                    );
                    const oppositeFace = (
                        allFaces &&
                        sameFace(facingFace, allFaces.longFaceLeft)
                    )
                        ? allFaces.longFaceRight
                        : (
                            allFaces &&
                            sameFace(facingFace, allFaces.longFaceRight)
                        )
                            ? allFaces.longFaceLeft
                            : null;

                    if (Array.isArray(oppositeFace) && oppositeFace.length >= 2) {
                        const capStartA = toLosSpace(facingFace[0]);
                        const capStartB = toLosSpace(oppositeFace[0]);
                        if (
                            capStartA &&
                            capStartB &&
                            Math.hypot(capStartA.x - capStartB.x, capStartA.y - capStartB.y) > EPS
                        ) {
                            pushHitsForSegment(capStartA, capStartB);
                        }

                        const capEndA = toLosSpace(facingFace[1]);
                        const capEndB = toLosSpace(oppositeFace[1]);
                        if (
                            capEndA &&
                            capEndB &&
                            Math.hypot(capEndA.x - capEndB.x, capEndA.y - capEndB.y) > EPS
                        ) {
                            pushHitsForSegment(capEndA, capEndB);
                        }
                    }
                }
                return hits;
            }

            const corners = [
                { x: startX + nx * halfT, y: startY + ny * halfT },
                { x: endX + nx * halfT, y: endY + ny * halfT },
                { x: endX - nx * halfT, y: endY - ny * halfT },
                { x: startX - nx * halfT, y: startY - ny * halfT }
            ];
            for (let i = 0; i < corners.length; i++) {
                const p1 = corners[i];
                const p2 = corners[(i + 1) % corners.length];
                pushHitsForSegment(p1, p2);
            }

            return hits;
        }

        rebuildMesh3d() {
            const sx = Number(this.startPoint && this.startPoint.x);
            const sy = Number(this.startPoint && this.startPoint.y);
            const ex = Number(this.endPoint && this.endPoint.x);
            const ey = Number(this.endPoint && this.endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) {
                this.mesh3d = null;
                this.groundPlaneHitbox = null;
                return null;
            }
            const dx = ex - sx;
            const dy = ey - sy;
            const len = Math.hypot(dx, dy);
            if (!(len > EPS)) {
                this.mesh3d = null;
                this.groundPlaneHitbox = null;
                return null;
            }

            const perimeter = this._buildBasePerimeterCorners();
            if (!Array.isArray(perimeter) || perimeter.length < 3) {
                this.mesh3d = null;
                this.groundPlaneHitbox = null;
                return null;
            }

            this._rebuildGroundPlaneHitboxFromBasePerimeter(perimeter);

            const z0 = Number.isFinite(this.bottomZ) ? Number(this.bottomZ) : 0;
            const z1 = z0 + Math.max(0, Number(this.height) || 0);

            const nPerim = perimeter.length;
            if (nPerim < 3) {
                this.mesh3d = null;
                this.groundPlaneHitbox = null;
                return null;
            }

            const vertices = [];
            for (let i = 0; i < nPerim; i++) {
                vertices.push(perimeter[i].x, perimeter[i].y, z0);
            }
            for (let i = 0; i < nPerim; i++) {
                vertices.push(perimeter[i].x, perimeter[i].y, z1);
            }

            const indices = [];
            // Top face fan.
            const topOffset = nPerim;
            for (let i = 1; i < nPerim - 1; i++) {
                indices.push(topOffset, topOffset + i, topOffset + i + 1);
            }
            // Side faces around full perimeter.
            for (let i = 0; i < nPerim; i++) {
                const j = (i + 1) % nPerim;
                indices.push(i, j, topOffset + j);
                indices.push(i, topOffset + j, topOffset + i);
            }

            this.mesh3d = {
                kind: "wallSectionPrism",
                id: this.id,
                vertices,
                indices,
                center: { ...this.center },
                direction: this.direction,
                lineAxis: this.lineAxis,
                height: this.height,
                thickness: this.thickness,
                startKey: WallSectionUnit.endpointKey(this.startPoint),
                endKey: WallSectionUnit.endpointKey(this.endPoint)
            };
            this._depthGeometryCache = null;
            return this.mesh3d;
        }

        getRenderMesh() {
            if (!this.mesh3d) return this.rebuildMesh3d();
            return this.mesh3d;
        }

        _buildDepthGeometry(options = {}) {
            void WallSectionUnit._ensureWallTextureConfigLoaded();
            const mesh3d = this.getRenderMesh();
            const vertices = mesh3d && Array.isArray(mesh3d.vertices) ? mesh3d.vertices : null;
            const indices = mesh3d && Array.isArray(mesh3d.indices) ? mesh3d.indices : null;
            if (!vertices || !indices || vertices.length < 9 || indices.length < 3 || (vertices.length % 3) !== 0) {
                return null;
            }
            const wallTextureCfg = WallSectionUnit._getWallTextureRepeatConfig(this.wallTexturePath);
            const repeatX = Math.max(0.0001, Number(wallTextureCfg.repeatsPerMapUnitX) || DEFAULT_REPEAT_X);
            const repeatY = Math.max(0.0001, Number(wallTextureCfg.repeatsPerMapUnitY) || DEFAULT_REPEAT_Y);
            const clipToLosVisibleSpan = !!options.clipToLosVisibleSpan;
            const topFaceOnly = !!(options.topFaceOnly) && !clipToLosVisibleSpan && !options.mazeMode;
            const bottomFaceOnly = !!(options.bottomFaceOnly) && !clipToLosVisibleSpan && !options.mazeMode;
            const horizontalFaceOnly = topFaceOnly || bottomFaceOnly;
            const clippedSpanMode = clipToLosVisibleSpan || !!options.mazeMode;
            const mazePrismFaces = clippedSpanMode ? this.getMazeModeClippedPrismFacesWorld(options) : null;
            const mazePrismKey = (clippedSpanMode && Array.isArray(mazePrismFaces) && mazePrismFaces.length > 0)
                ? mazePrismFaces
                    .map(face => Array.isArray(face) && face.length >= 4
                        ? face.map(pt => `${Number(pt.x).toFixed(6)},${Number(pt.y).toFixed(6)},${Number(pt.z).toFixed(6)}`).join(";")
                        : "none")
                    .join("|")
                : "none";

            const sx = Number(this.startPoint && this.startPoint.x);
            const sy = Number(this.startPoint && this.startPoint.y);
            const ex = Number(this.endPoint && this.endPoint.x);
            const ey = Number(this.endPoint && this.endPoint.y);
            const sectionHeight = Number.isFinite(this.height) ? Number(this.height) : 1;
            const sectionThickness = Number.isFinite(this.thickness) ? Number(this.thickness) : 0.1;
            const sectionBottomZ = Number.isFinite(this.bottomZ) ? Number(this.bottomZ) : 0;
            const geometryKey = [
                Number.isFinite(sx) ? sx.toFixed(6) : "nan",
                Number.isFinite(sy) ? sy.toFixed(6) : "nan",
                Number.isFinite(ex) ? ex.toFixed(6) : "nan",
                Number.isFinite(ey) ? ey.toFixed(6) : "nan",
                sectionHeight.toFixed(6),
                sectionThickness.toFixed(6),
                sectionBottomZ.toFixed(6),
                Number(repeatX).toFixed(6),
                Number(repeatY).toFixed(6),
                Number.isFinite(this.texturePhaseA) ? Number(this.texturePhaseA).toFixed(6) : "nan",
                Number.isFinite(this.texturePhaseB) ? Number(this.texturePhaseB).toFixed(6) : "nan",
                wallTextureCfg.texturePath || this.wallTexturePath || DEFAULT_WALL_TEXTURE,
                clippedSpanMode ? (clipToLosVisibleSpan ? "clip" : "maze") : (horizontalFaceOnly ? (topFaceOnly ? "topOnly" : "bottomOnly") : "full"),
                mazePrismKey
            ].join("|");

            const currentGen = WallSectionUnit._depthGeometryCacheGeneration;
            if (this._depthGeometryCache && this._depthGeometryCache.key === geometryKey) {
                if (this._depthGeometryCache.generation === currentGen) {
                    return this._depthGeometryCache.geometry;
                }
                if (WallSectionUnit._depthGeometryRebuildBudgetThisFrame <= 0) {
                    return this._depthGeometryCache.geometry;
                }
            } else if (
                this._depthGeometryCache &&
                this._depthGeometryCache.generation !== currentGen &&
                WallSectionUnit._depthGeometryRebuildBudgetThisFrame <= 0
            ) {
                return this._depthGeometryCache.geometry;
            }
            const dx = (this.map && typeof this.map.shortestDeltaX === "function" && Number.isFinite(ex) && Number.isFinite(sx))
                ? this.map.shortestDeltaX(sx, ex)
                : ((Number.isFinite(ex) && Number.isFinite(sx)) ? (ex - sx) : 1);
            const dy = (this.map && typeof this.map.shortestDeltaY === "function" && Number.isFinite(ey) && Number.isFinite(sy))
                ? this.map.shortestDeltaY(sy, ey)
                : ((Number.isFinite(ey) && Number.isFinite(sy)) ? (ey - sy) : 0);
            const dirLen = Math.hypot(dx, dy) || 1;
            const ux = dx / dirLen;
            const uy = dy / dirLen;
            const vx = -uy;
            const vy = ux;
            const baseX = Number.isFinite(sx) ? sx : 0;
            const baseY = Number.isFinite(sy) ? sy : 0;
            const bottomZ = Number.isFinite(this.bottomZ) ? Number(this.bottomZ) : 0;
            const sectionLength = (Number.isFinite(this.length) && this.length > EPS)
                ? Number(this.length)
                : dirLen;
            const phaseU = Number.isFinite(this.texturePhaseA) ? Number(this.texturePhaseA) : 0;
            const phaseV = Number.isFinite(this.texturePhaseB) ? Number(this.texturePhaseB) : 0;

            if (clippedSpanMode) {
                const mazeFaces = Array.isArray(mazePrismFaces) ? mazePrismFaces : [];
                if (mazeFaces.length === 0) {
                    return null;
                }
                const triOrder = [0, 1, 2, 0, 2, 3];
                const positions = [];
                const uvs = [];
                const colors = [];
                const textureMix = [];
                const outIndices = [];
                const fullFaces = this._buildFaceQuadsWorld();
                const topRef = (fullFaces && Array.isArray(fullFaces.topFace) && fullFaces.topFace.length >= 4)
                    ? fullFaces.topFace
                    : null;
                let topAcrossMin = Infinity;
                let topAcrossMax = -Infinity;
                const topBoundsRef = Array.isArray(topRef) ? topRef : [];
                for (let a = 0; a < topBoundsRef.length; a++) {
                    const p = topBoundsRef[a];
                    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
                    const prx = Number(p.x) - baseX;
                    const pry = Number(p.y) - baseY;
                    const pa = prx * vx + pry * vy;
                    if (pa < topAcrossMin) topAcrossMin = pa;
                    if (pa > topAcrossMax) topAcrossMax = pa;
                }
                if (!Number.isFinite(topAcrossMin) || !Number.isFinite(topAcrossMax) || Math.abs(topAcrossMax - topAcrossMin) < 1e-6) {
                    topAcrossMin = -0.5;
                    topAcrossMax = 0.5;
                }
                const topTextureVMin = 0;
                const topTextureVMax = 0.125;
                const topTextureVSpan = topTextureVMax - topTextureVMin;

                for (let f = 0; f < mazeFaces.length; f++) {
                    const face = mazeFaces[f];
                    const facePts = face.slice(0, 4).map(pt => ({
                        x: Number(pt && pt.x),
                        y: Number(pt && pt.y),
                        z: Number(pt && pt.z)
                    }));
                    const validFace = facePts.every(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y) && Number.isFinite(pt.z));
                    if (!validFace) continue;

                    const zSpan = Math.max(
                        Math.abs(facePts[0].z - facePts[1].z),
                        Math.abs(facePts[1].z - facePts[2].z),
                        Math.abs(facePts[2].z - facePts[3].z),
                        Math.abs(facePts[3].z - facePts[0].z)
                    );
                    const isTopFace = zSpan <= 1e-5;
                    let alongMin = Infinity;
                    let alongMax = -Infinity;
                    for (let p = 0; p < facePts.length; p++) {
                        const pt = facePts[p];
                        const along = pt.x * ux + pt.y * uy;
                        if (along < alongMin) alongMin = along;
                        if (along > alongMax) alongMax = along;
                    }
                    const alongSpan = (Number.isFinite(alongMin) && Number.isFinite(alongMax))
                        ? Math.abs(alongMax - alongMin)
                        : Infinity;
                    const isCapFace = !isTopFace && alongSpan <= 1e-5;

                    for (let i = 0; i < triOrder.length; i++) {
                        const src = facePts[triOrder[i]];
                        const relXWorld = src.x - baseX;
                        const relYWorld = src.y - baseY;
                        const alongWorld = src.x * ux + src.y * uy;
                        const acrossWorld = relXWorld * vx + relYWorld * vy;
                        const heightWorld = src.z - bottomZ;

                        positions.push(src.x, src.y, src.z);
                        if (isTopFace) {
                            const acrossNorm = (acrossWorld - topAcrossMin) / Math.max(1e-6, (topAcrossMax - topAcrossMin));
                            uvs.push(
                                alongWorld * repeatX + phaseU,
                                (1 - acrossNorm) * topTextureVSpan
                            );
                        } else if (isCapFace) {
                            uvs.push(
                                acrossWorld * repeatX + phaseU,
                                (this.height - heightWorld) * repeatY
                            );
                        } else {
                            uvs.push(
                                alongWorld * repeatX + phaseU,
                                (this.height - heightWorld) * repeatY
                            );
                        }
                        const mazeC = isTopFace ? 1.25 : 1;
                        colors.push(mazeC, mazeC, mazeC, 1);
                        textureMix.push(1);
                        outIndices.push(outIndices.length);
                    }
                }

                if (positions.length < 9) {
                    return null;
                }

                let texture = null;
                if (typeof PIXI !== "undefined" && PIXI.Texture) {
                    texture = PIXI.Texture.from(wallTextureCfg.texturePath || this.wallTexturePath || DEFAULT_WALL_TEXTURE);
                    if (texture && texture.baseTexture) {
                        texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
                        texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
                    }
                }
                const mazeGeometry = {
                    positions: new Float32Array(positions),
                    uvs: new Float32Array(uvs),
                    colors: new Float32Array(colors),
                    textureMix: new Float32Array(textureMix),
                    indices: new Uint16Array(outIndices),
                    texture,
                    alphaCutoff: 0.02
                };
                this._depthGeometryCache = { key: geometryKey, geometry: mazeGeometry, generation: currentGen };
                if (WallSectionUnit._depthGeometryRebuildBudgetThisFrame > 0) {
                    WallSectionUnit._depthGeometryRebuildBudgetThisFrame--;
                }
                return mazeGeometry;
            }

            const vertexCount = Math.floor(vertices.length / 3);
            const alongPerVertex = new Float32Array(vertexCount);
            const alongStablePerVertex = new Float32Array(vertexCount);
            const alongWorldPerVertex = new Float32Array(vertexCount);
            const acrossPerVertex = new Float32Array(vertexCount);
            const heightPerVertex = new Float32Array(vertexCount);
            for (let vtx = 0, vertex = 0; vtx < vertices.length; vtx += 3, vertex += 1) {
                const wx = Number(vertices[vtx]) || 0;
                const wy = Number(vertices[vtx + 1]) || 0;
                const wz = Number(vertices[vtx + 2]) || 0;
                const relX = wx - baseX;
                const relY = wy - baseY;
                const along = relX * ux + relY * uy;
                const across = relX * vx + relY * vy;
                alongPerVertex[vertex] = along;
                alongStablePerVertex[vertex] = Math.max(0, Math.min(sectionLength, along));
                alongWorldPerVertex[vertex] = wx * ux + wy * uy;
                acrossPerVertex[vertex] = across;
                heightPerVertex[vertex] = wz - bottomZ;
            }

            // Expand indexed triangles so we can color/tint faces independently.
            const nPerim = Math.floor((vertices.length / 3) * 0.5);
            const topFaceTriCount = Math.max(0, nPerim - 2);
            const topTextureVMin = 0;
            const topTextureVMax = 0.125;
            const topTextureVSpan = topTextureVMax - topTextureVMin;
            let topAcrossMin = Infinity;
            let topAcrossMax = -Infinity;
            for (let i = 0; i < nPerim; i++) {
                const across = Number(acrossPerVertex[i]);
                if (!Number.isFinite(across)) continue;
                if (across < topAcrossMin) topAcrossMin = across;
                if (across > topAcrossMax) topAcrossMax = across;
            }
            if (!Number.isFinite(topAcrossMin) || !Number.isFinite(topAcrossMax) || Math.abs(topAcrossMax - topAcrossMin) < 1e-6) {
                topAcrossMin = -0.5;
                topAcrossMax = 0.5;
            }
            const triCount = Math.floor(indices.length / 3);
            const expandedPositions = new Float32Array(triCount * 3 * 3);
            const expandedUvs = new Float32Array(triCount * 3 * 2);
            const expandedColors = new Float32Array(triCount * 3 * 4);
            const expandedTextureMix = new Float32Array(triCount * 3);
            const expandedIndices = new Uint16Array(triCount * 3);
            const topLighten = 1.25;

            for (let tri = 0; tri < triCount; tri++) {
                const isTopFaceTri = tri < topFaceTriCount;
                if (horizontalFaceOnly && !isTopFaceTri) continue;
                const colorR = isTopFaceTri ? topLighten : 1;
                const colorG = isTopFaceTri ? topLighten : 1;
                const colorB = isTopFaceTri ? topLighten : 1;
                const textureMix = 1;
                let capFace = false;
                if (!isTopFaceTri) {
                    const ia = Number(indices[tri * 3]) || 0;
                    const ib = Number(indices[tri * 3 + 1]) || 0;
                    const ic = Number(indices[tri * 3 + 2]) || 0;
                    const ax = Number(vertices[ia * 3]) || 0;
                    const ay = Number(vertices[ia * 3 + 1]) || 0;
                    const az = Number(vertices[ia * 3 + 2]) || 0;
                    const bx = Number(vertices[ib * 3]) || 0;
                    const by = Number(vertices[ib * 3 + 1]) || 0;
                    const bz = Number(vertices[ib * 3 + 2]) || 0;
                    const cx = Number(vertices[ic * 3]) || 0;
                    const cy = Number(vertices[ic * 3 + 1]) || 0;
                    const cz = Number(vertices[ic * 3 + 2]) || 0;
                    const abx = bx - ax;
                    const aby = by - ay;
                    const abz = bz - az;
                    const acx = cx - ax;
                    const acy = cy - ay;
                    const acz = cz - az;
                    const nx = (aby * acz) - (abz * acy);
                    const ny = (abz * acx) - (abx * acz);
                    const nxyLen = Math.hypot(nx, ny);
                    if (nxyLen > 1e-6) {
                        const invLen = 1 / nxyLen;
                        const nux = nx * invLen;
                        const nuy = ny * invLen;
                        const alignU = Math.abs(nux * ux + nuy * uy);
                        const alignV = Math.abs(nux * vx + nuy * vy);
                        capFace = alignU > alignV;
                    }
                }
                for (let c = 0; c < 3; c++) {
                    const srcVertex = Number(indices[tri * 3 + c]) || 0;
                    const srcPos = srcVertex * 3;
                    const dstVertex = tri * 3 + c;
                    const dstPos = dstVertex * 3;
                    const dstUv = dstVertex * 2;
                    const dstColor = dstVertex * 4;
                    expandedPositions[dstPos] = Number(vertices[srcPos]) || 0;
                    expandedPositions[dstPos + 1] = Number(vertices[srcPos + 1]) || 0;
                    expandedPositions[dstPos + 2] = horizontalFaceOnly ? bottomZ : (Number(vertices[srcPos + 2]) || 0);
                    const along = Number(alongStablePerVertex[srcVertex]) || 0;
                    const alongWorld = Number(alongWorldPerVertex[srcVertex]) || 0;
                    const across = Number(acrossPerVertex[srcVertex]) || 0;
                    const height = Number(heightPerVertex[srcVertex]) || 0;
                    if (isTopFaceTri) {
                        const acrossNorm = (across - topAcrossMin) / Math.max(1e-6, (topAcrossMax - topAcrossMin));
                        expandedUvs[dstUv] = alongWorld * repeatX + phaseU;
                        expandedUvs[dstUv + 1] = (1 - acrossNorm) * topTextureVSpan;
                    } else if (capFace) {
                        expandedUvs[dstUv] = across * repeatX + phaseU;
                        expandedUvs[dstUv + 1] = (this.height - height) * repeatY;
                    } else {
                        expandedUvs[dstUv] = alongWorld * repeatX + phaseU;
                        expandedUvs[dstUv + 1] = (this.height - height) * repeatY;
                    }
                    expandedColors[dstColor] = colorR;
                    expandedColors[dstColor + 1] = colorG;
                    expandedColors[dstColor + 2] = colorB;
                    expandedColors[dstColor + 3] = 1;
                    expandedTextureMix[dstVertex] = textureMix;
                    expandedIndices[dstVertex] = dstVertex;
                }
            }

            let texture = null;
            if (typeof PIXI !== "undefined" && PIXI.Texture) {
                texture = PIXI.Texture.from(wallTextureCfg.texturePath || this.wallTexturePath || DEFAULT_WALL_TEXTURE);
                if (texture && texture.baseTexture) {
                    texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
                    texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
                }
            }
            const geometry = {
                positions: expandedPositions,
                uvs: expandedUvs,
                colors: expandedColors,
                textureMix: expandedTextureMix,
                indices: expandedIndices,
                texture,
                alphaCutoff: 0.02
            };
            this._depthGeometryCache = { key: geometryKey, geometry, generation: currentGen };
            if (WallSectionUnit._depthGeometryRebuildBudgetThisFrame > 0) {
                WallSectionUnit._depthGeometryRebuildBudgetThisFrame--;
            }
            return geometry;
        }

        static _ensureDepthMeshState() {
            if (typeof PIXI === "undefined" || !PIXI.State) return null;
            if (WallSectionUnit._depthMeshState) return WallSectionUnit._depthMeshState;
            const state = new PIXI.State();
            state.depthTest = true;
            state.depthMask = true;
            state.blend = false;
            state.culling = false;
            WallSectionUnit._depthMeshState = state;
            return state;
        }

        _ensureDepthDisplayMesh() {
            if (typeof PIXI === "undefined" || !PIXI.Geometry || !PIXI.Shader || !PIXI.Mesh) return null;
            if (this._depthDisplayMesh && !this._depthDisplayMesh.destroyed) return this._depthDisplayMesh;
            const state = WallSectionUnit._ensureDepthMeshState();
            if (!state) return null;
            const geometry = new PIXI.Geometry()
                .addAttribute("aWorldPosition", new Float32Array(0), 3)
                .addAttribute("aUvs", new Float32Array(0), 2)
                .addAttribute("aColor", new Float32Array(0), 4)
                .addAttribute("aTextureMix", new Float32Array(0), 1)
                .addIndex(new Uint16Array(0));
            const shader = PIXI.Shader.from(WALL_DEPTH_VS, WALL_DEPTH_FS, {
                uScreenSize: new Float32Array([1, 1]),
                uCameraWorld: new Float32Array([0, 0]),
                uViewScale: 1,
                uXyRatio: 1,
                uDepthRange: new Float32Array([0, 1]),
                uTint: new Float32Array([1, 1, 1, 1]),
                uBrightness: 0,
                uAlphaCutoff: 0.02,
                uClipMinZ: -1000000,
                uSampler: PIXI.Texture.WHITE
            });
            const mesh = new PIXI.Mesh(geometry, shader, state, PIXI.DRAW_MODES.TRIANGLES);
            mesh.name = "wallSectionUnitDepthMesh";
            mesh.interactive = false;
            mesh.roundPixels = false;
            mesh.visible = false;
            this._depthDisplayMesh = mesh;
            return mesh;
        }

        getDepthMeshDisplayObject(options = {}) {
            const mesh = this._ensureDepthDisplayMesh();
            if (!mesh || !mesh.geometry || !mesh.shader || !mesh.shader.uniforms) return null;
            const geometry = this._buildDepthGeometry(options);
            if (!geometry) return null;

            if (mesh._wallSectionGeometryRef !== geometry) {
                const pos = mesh.geometry.getBuffer("aWorldPosition");
                const uv = mesh.geometry.getBuffer("aUvs");
                const color = mesh.geometry.getBuffer("aColor");
                const textureMix = mesh.geometry.getBuffer("aTextureMix");
                const idx = mesh.geometry.getIndex();
                if (!pos || !uv || !color || !textureMix || !idx) return null;
                pos.data = geometry.positions;
                uv.data = geometry.uvs;
                color.data = geometry.colors;
                textureMix.data = geometry.textureMix;
                idx.data = geometry.indices;
                pos.update();
                uv.update();
                color.update();
                textureMix.update();
                idx.update();
                mesh._wallSectionGeometryRef = geometry;
            }

            const camera = options.camera || (typeof globalScope.viewport !== "undefined" ? globalScope.viewport : null) || null;
            const appRef = options.app || (typeof globalScope.app !== "undefined" ? globalScope.app : null) || null;
            const viewscale = Number.isFinite(options.viewscale)
                ? Number(options.viewscale)
                : (Number.isFinite(globalScope.viewscale) ? Number(globalScope.viewscale) : 1);
            const xyratio = Number.isFinite(options.xyratio)
                ? Number(options.xyratio)
                : (Number.isFinite(globalScope.xyratio) ? Number(globalScope.xyratio) : 1);
            const tint = Number.isFinite(options.tint) ? Number(options.tint) : 0xFFFFFF;
            const alpha = Number.isFinite(options.alpha) ? Number(options.alpha) : 1;
            const brightnessPercent = Number(options.brightness);
            const nearMetric = WALL_DEPTH_NEAR_METRIC;
            const farMetric = WALL_DEPTH_FAR_METRIC;
            const invSpan = 1 / Math.max(1e-6, farMetric - nearMetric);
            const screenW = (appRef && appRef.screen && Number.isFinite(appRef.screen.width))
                ? Number(appRef.screen.width)
                : 1;
            const screenH = (appRef && appRef.screen && Number.isFinite(appRef.screen.height))
                ? Number(appRef.screen.height)
                : 1;
            const u = mesh.shader.uniforms;
            u.uScreenSize[0] = Math.max(1, screenW);
            u.uScreenSize[1] = Math.max(1, screenH);
            u.uCameraWorld[0] = Number(camera && camera.x) || 0;
            u.uCameraWorld[1] = Number(camera && camera.y) || 0;
            u.uViewScale = viewscale;
            u.uXyRatio = xyratio;
            u.uDepthRange[0] = farMetric;
            u.uDepthRange[1] = invSpan;
            u.uTint[0] = ((tint >> 16) & 255) / 255;
            u.uTint[1] = ((tint >> 8) & 255) / 255;
            u.uTint[2] = (tint & 255) / 255;
            u.uTint[3] = Math.max(0, Math.min(1, alpha));
            u.uBrightness = Number.isFinite(brightnessPercent)
                ? Math.max(-1, Math.min(1, brightnessPercent / 100))
                : 0;
            u.uAlphaCutoff = Number.isFinite(geometry.alphaCutoff) ? Number(geometry.alphaCutoff) : 0.02;
            u.uClipMinZ = this._scriptSinkState ? 0 : -1000000;
            u.uSampler = geometry.texture || (PIXI.Texture ? PIXI.Texture.WHITE : null);
            mesh.visible = true;
            return mesh;
        }

        _getBaseWallProfileWithoutJoinery() {
            const sx = Number(this.startPoint && this.startPoint.x);
            const sy = Number(this.startPoint && this.startPoint.y);
            const ex = Number(this.endPoint && this.endPoint.x);
            const ey = Number(this.endPoint && this.endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) return null;

            const dx = ex - sx;
            const dy = ey - sy;
            const len = Math.hypot(dx, dy);
            if (!(len > EPS)) return null;

            const nx = -dy / len;
            const ny = dx / len;
            const halfT = Math.max(0.001, Number(this.thickness) || 0.001) * 0.5;

            return {
                aLeft: { x: sx + nx * halfT, y: sy + ny * halfT },
                aRight: { x: sx - nx * halfT, y: sy - ny * halfT },
                bLeft: { x: ex + nx * halfT, y: ey + ny * halfT },
                bRight: { x: ex - nx * halfT, y: ey - ny * halfT }
            };
        }

        getWallProfile() {
            const base = this._getBaseWallProfileWithoutJoinery();
            if (!base) return null;

            let aLeft = { ...base.aLeft };
            let aRight = { ...base.aRight };
            let bLeft = { ...base.bLeft };
            let bRight = { ...base.bRight };

            if (this._joineryCorners) {
                const startKey = WallSectionUnit.endpointKey(this.startPoint);
                const endKey = WallSectionUnit.endpointKey(this.endPoint);

                const startJoin = this._joineryCorners[startKey];
                if (startJoin && startJoin.sharedEnd === "start") {
                    if (startJoin.posN) aLeft = startJoin.posN;
                    if (startJoin.negN) aRight = startJoin.negN;
                }

                const endJoin = this._joineryCorners[endKey];
                if (endJoin && endJoin.sharedEnd === "end") {
                    if (endJoin.posN) bLeft = endJoin.posN;
                    if (endJoin.negN) bRight = endJoin.negN;
                }
            }

            return { aLeft, aRight, bLeft, bRight };
        }

        _buildFaceQuadsWorldFromProfile(profile) {
            if (!profile) return null;
            const bottomZ = Number.isFinite(this.bottomZ) ? Number(this.bottomZ) : 0;
            const topZ = bottomZ + Math.max(0, Number(this.height) || 0);
            const toWorld3 = (pt, z) => ({
                x: Number(pt && pt.x),
                y: Number(pt && pt.y),
                z: Number(z)
            });

            const longFaceLeft = [
                toWorld3(profile.aLeft, bottomZ),
                toWorld3(profile.bLeft, bottomZ),
                toWorld3(profile.bLeft, topZ),
                toWorld3(profile.aLeft, topZ)
            ];
            const longFaceRight = [
                toWorld3(profile.aRight, bottomZ),
                toWorld3(profile.bRight, bottomZ),
                toWorld3(profile.bRight, topZ),
                toWorld3(profile.aRight, topZ)
            ];
            const topFace = [
                toWorld3(profile.aLeft, topZ),
                toWorld3(profile.bLeft, topZ),
                toWorld3(profile.bRight, topZ),
                toWorld3(profile.aRight, topZ)
            ];
            return {
                longFaceLeft,
                longFaceRight,
                topFace
            };
        }

        _computeVisibleEndpointJoineryEntry(endpointKey, visibleWallIdSet) {
            if (!endpointKey || !(visibleWallIdSet instanceof Set)) return null;
            if (!Number.isInteger(this.id) || !visibleWallIdSet.has(Number(this.id))) return null;

            const isStart = WallSectionUnit.endpointKey(this.startPoint) === endpointKey;
            const isEnd = WallSectionUnit.endpointKey(this.endPoint) === endpointKey;
            const sharedEndForSelf = isStart ? "start" : (isEnd ? "end" : null);
            if (!sharedEndForSelf) return null;
            const centerPoint = isStart ? this.startPoint : this.endPoint;
            const center = { x: Number(centerPoint && centerPoint.x), y: Number(centerPoint && centerPoint.y) };
            if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
            const endpointPoint = centerPoint;

            const wallById = new Map([[Number(this.id), this]]);
            if (this.connections instanceof Map) {
                for (const payload of this.connections.values()) {
                    const other = payload.section;
                    if (!other || other.type !== "wallSection" || other.gone || other.vanishing) continue;
                    const sharesByMetadata = !!(payload && payload.sharedEndpointKey === endpointKey);
                    const sharesByGeometry = !!(
                        endpointPoint &&
                        (
                            WallSectionUnit._pointsMatch(endpointPoint, other.startPoint) ||
                            WallSectionUnit._pointsMatch(endpointPoint, other.endPoint)
                        )
                    );
                    if (!sharesByMetadata && !sharesByGeometry) continue;
                    if (!Number.isInteger(other.id) || !visibleWallIdSet.has(Number(other.id))) continue;
                    wallById.set(Number(other.id), other);
                }
            }

            const entries = [];
            for (const wall of wallById.values()) {
                const wallStartKey = WallSectionUnit.endpointKey(wall.startPoint);
                const wallEndKey = WallSectionUnit.endpointKey(wall.endPoint);
                const sharedEnd = (wallStartKey === endpointKey) ? "start" : ((wallEndKey === endpointKey) ? "end" : null);
                if (!sharedEnd) continue;
                const sharedPoint = (sharedEnd === "start") ? wall.startPoint : wall.endPoint;
                const farPoint = (sharedEnd === "start") ? wall.endPoint : wall.startPoint;
                const mapRef = wall.map || this.map || null;
                const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(sharedPoint.x, farPoint.x)
                    : (farPoint.x - sharedPoint.x);
                const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(sharedPoint.y, farPoint.y)
                    : (farPoint.y - sharedPoint.y);
                const len = Math.hypot(dx, dy);
                if (!(len > EPS)) continue;
                const ux = dx / len;
                const uy = dy / len;
                const leftN = { x: -uy, y: ux };
                const halfT = Math.max(0.001, Number(wall.thickness) || 0.001) * 0.5;
                entries.push({
                    wall,
                    sharedEnd,
                    awayDir: { x: ux, y: uy },
                    angle: Math.atan2(uy, ux),
                    leftFace: {
                        x: Number(sharedPoint.x) + leftN.x * halfT,
                        y: Number(sharedPoint.y) + leftN.y * halfT
                    },
                    rightFace: {
                        x: Number(sharedPoint.x) - leftN.x * halfT,
                        y: Number(sharedPoint.y) - leftN.y * halfT
                    },
                    leftLabel: (sharedEnd === "start") ? "posN" : "negN",
                    rightLabel: (sharedEnd === "start") ? "negN" : "posN"
                });
            }
            if (entries.length < 2) return null;

            entries.sort((a, b) => {
                const d = b.angle - a.angle;
                if (Math.abs(d) > EPS) return d;
                return (Number(a.wall.id) || 0) - (Number(b.wall.id) || 0);
            });
            const selfIdx = entries.findIndex(entry => entry && entry.wall === this);
            if (selfIdx < 0) return null;

            const ringCorners = new Array(entries.length).fill(null);
            for (let i = 0; i < entries.length; i++) {
                const current = entries[i];
                const next = entries[(i + 1) % entries.length];
                let hit = WallSectionUnit._lineIntersection(
                    current.rightFace,
                    current.awayDir,
                    next.leftFace,
                    next.awayDir
                );
                if (!hit) {
                    const currentHit = WallSectionUnit._sideLinePerpendicularCenterHit(current.rightFace, current.awayDir, center);
                    const nextHit = WallSectionUnit._sideLinePerpendicularCenterHit(next.leftFace, next.awayDir, center);
                    if (currentHit && nextHit) {
                        const sep = Math.hypot(currentHit.x - nextHit.x, currentHit.y - nextHit.y);
                        if (sep <= 1e-4) {
                            hit = {
                                x: (currentHit.x + nextHit.x) * 0.5,
                                y: (currentHit.y + nextHit.y) * 0.5
                            };
                        }
                    }
                }
                if (hit) ringCorners[i] = { x: hit.x, y: hit.y };
            }

            const selfEntry = entries[selfIdx];
            const rightCorner = ringCorners[selfIdx];
            const leftCorner = ringCorners[(selfIdx - 1 + entries.length) % entries.length];
            const out = {
                sharedEnd: selfEntry.sharedEnd,
                center: { x: center.x, y: center.y }
            };
            if (rightCorner) out[selfEntry.rightLabel] = rightCorner;
            if (leftCorner) out[selfEntry.leftLabel] = leftCorner;
            return out;
        }

        getWallProfileWithVisibleNeighborMiter(visibleWallIdSet) {
            if (!(visibleWallIdSet instanceof Set)) return this.getWallProfile();
            if (!Number.isInteger(this.id) || !visibleWallIdSet.has(Number(this.id))) return this.getWallProfile();

            const startKey = WallSectionUnit.endpointKey(this.startPoint) || "start";
            const endKey = WallSectionUnit.endpointKey(this.endPoint) || "end";
            const endpointVisibleIdSig = endpointKey => {
                const ids = [];
                const endpointPoint = this._getEndpointPointByKey(endpointKey);
                if (!endpointPoint) return "";
                if (Number.isInteger(this.id) && visibleWallIdSet.has(Number(this.id))) ids.push(Number(this.id));
                if (this.connections instanceof Map) {
                    for (const payload of this.connections.values()) {
                        const other = payload.section;
                        const sharesByMetadata = !!(payload && payload.sharedEndpointKey === endpointKey);
                        const sharesByGeometry = !!(
                            endpointPoint &&
                            (
                                WallSectionUnit._pointsMatch(endpointPoint, other && other.startPoint) ||
                                WallSectionUnit._pointsMatch(endpointPoint, other && other.endPoint)
                            )
                        );
                        if (!sharesByMetadata && !sharesByGeometry) continue;
                        if (!other || !Number.isInteger(other.id) || !visibleWallIdSet.has(Number(other.id))) continue;
                        ids.push(Number(other.id));
                    }
                }
                ids.sort((a, b) => a - b);
                return ids.join(",");
            };

            const geomSig = [
                Number(this.startPoint && this.startPoint.x).toFixed(6),
                Number(this.startPoint && this.startPoint.y).toFixed(6),
                Number(this.endPoint && this.endPoint.x).toFixed(6),
                Number(this.endPoint && this.endPoint.y).toFixed(6),
                Number(this.thickness || 0).toFixed(6)
            ].join(",");
            const cacheKey = `${geomSig}|${startKey}:${endpointVisibleIdSig(startKey)}|${endKey}:${endpointVisibleIdSig(endKey)}`;
            if (this._visibleNeighborMiterProfileCache && this._visibleNeighborMiterProfileCache.key === cacheKey) {
                return this._visibleNeighborMiterProfileCache.profile;
            }

            const base = this._getBaseWallProfileWithoutJoinery();
            if (!base) return null;
            const profile = {
                aLeft: { ...base.aLeft },
                aRight: { ...base.aRight },
                bLeft: { ...base.bLeft },
                bRight: { ...base.bRight }
            };
            const sx = Number(this.startPoint && this.startPoint.x);
            const sy = Number(this.startPoint && this.startPoint.y);
            const ex = Number(this.endPoint && this.endPoint.x);
            const ey = Number(this.endPoint && this.endPoint.y);
            const dx = ex - sx;
            const dy = ey - sy;
            const len = Math.hypot(dx, dy);
            const ux = (len > EPS) ? (dx / len) : 0;
            const uy = (len > EPS) ? (dy / len) : 0;
            const fullProfile = this.getWallProfile();
            const alongAt = pt => {
                if (!(len > EPS)) return 0;
                const px = Number(pt && pt.x);
                const py = Number(pt && pt.y);
                if (!Number.isFinite(px) || !Number.isFinite(py)) return 0;
                return (px - sx) * ux + (py - sy) * uy;
            };
            const applyEndpointShiftAlong = (endpoint, shift) => {
                if (!(len > EPS) || !Number.isFinite(shift) || Math.abs(shift) <= 1e-6) return;
                const ox = ux * shift;
                const oy = uy * shift;
                if (endpoint === "start") {
                    profile.aLeft = { x: Number(profile.aLeft.x) + ox, y: Number(profile.aLeft.y) + oy };
                    profile.aRight = { x: Number(profile.aRight.x) + ox, y: Number(profile.aRight.y) + oy };
                    return;
                }
                if (endpoint === "end") {
                    profile.bLeft = { x: Number(profile.bLeft.x) + ox, y: Number(profile.bLeft.y) + oy };
                    profile.bRight = { x: Number(profile.bRight.x) + ox, y: Number(profile.bRight.y) + oy };
                }
            };
            const startJoin = this._computeVisibleEndpointJoineryEntry(startKey, visibleWallIdSet);
            if (startJoin && startJoin.sharedEnd === "start") {
                if (startJoin.posN) profile.aLeft = startJoin.posN;
                if (startJoin.negN) profile.aRight = startJoin.negN;
            } else if (fullProfile) {
                const currentAlong = (alongAt(profile.aLeft) + alongAt(profile.aRight)) * 0.5;
                const fullTipAlong = Math.min(alongAt(fullProfile.aLeft), alongAt(fullProfile.aRight));
                applyEndpointShiftAlong("start", fullTipAlong - currentAlong);
            }
            const endJoin = this._computeVisibleEndpointJoineryEntry(endKey, visibleWallIdSet);
            if (endJoin && endJoin.sharedEnd === "end") {
                if (endJoin.posN) profile.bLeft = endJoin.posN;
                if (endJoin.negN) profile.bRight = endJoin.negN;
            } else if (fullProfile) {
                const currentAlong = (alongAt(profile.bLeft) + alongAt(profile.bRight)) * 0.5;
                const fullTipAlong = Math.max(alongAt(fullProfile.bLeft), alongAt(fullProfile.bRight));
                applyEndpointShiftAlong("end", fullTipAlong - currentAlong);
            }

            this._visibleNeighborMiterProfileCache = { key: cacheKey, profile };
            return profile;
        }

        _buildFaceQuadsWorld() {
            return this._buildFaceQuadsWorldFromProfile(this.getWallProfile());
        }

        _buildCoreFaceQuadsWorld() {
            const sx = Number(this.startPoint && this.startPoint.x);
            const sy = Number(this.startPoint && this.startPoint.y);
            const ex = Number(this.endPoint && this.endPoint.x);
            const ey = Number(this.endPoint && this.endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) return null;

            const dx = ex - sx;
            const dy = ey - sy;
            const len = Math.hypot(dx, dy);
            if (!(len > EPS)) return null;

            const nx = -dy / len;
            const ny = dx / len;
            const halfT = Math.max(0.001, Number(this.thickness) || 0.001) * 0.5;

            const profile = {
                aLeft: { x: sx + nx * halfT, y: sy + ny * halfT },
                aRight: { x: sx - nx * halfT, y: sy - ny * halfT },
                bLeft: { x: ex + nx * halfT, y: ey + ny * halfT },
                bRight: { x: ex - nx * halfT, y: ey - ny * halfT }
            };

            const bottomZ = Number.isFinite(this.bottomZ) ? Number(this.bottomZ) : 0;
            const topZ = bottomZ + Math.max(0, Number(this.height) || 0);
            const toWorld3 = (pt, z) => ({
                x: Number(pt && pt.x),
                y: Number(pt && pt.y),
                z: Number(z)
            });

            const longFaceLeft = [
                toWorld3(profile.aLeft, bottomZ),
                toWorld3(profile.bLeft, bottomZ),
                toWorld3(profile.bLeft, topZ),
                toWorld3(profile.aLeft, topZ)
            ];
            const longFaceRight = [
                toWorld3(profile.aRight, bottomZ),
                toWorld3(profile.bRight, bottomZ),
                toWorld3(profile.bRight, topZ),
                toWorld3(profile.aRight, topZ)
            ];
            const topFace = [
                toWorld3(profile.aLeft, topZ),
                toWorld3(profile.bLeft, topZ),
                toWorld3(profile.bRight, topZ),
                toWorld3(profile.aRight, topZ)
            ];

            return {
                longFaceLeft,
                longFaceRight,
                topFace
            };
        }

        _getFaceCenterWorld(faceCorners) {
            if (!Array.isArray(faceCorners) || faceCorners.length === 0) return null;
            let sx = 0;
            let sy = 0;
            let sz = 0;
            let n = 0;
            for (let i = 0; i < faceCorners.length; i++) {
                const c = faceCorners[i];
                if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) continue;
                sx += Number(c.x);
                sy += Number(c.y);
                sz += Number(c.z);
                n++;
            }
            if (n <= 0) return null;
            return { x: sx / n, y: sy / n, z: sz / n };
        }

        _distanceSqToWorldPoint(pointA, pointB) {
            if (!pointA || !pointB) return Infinity;
            const ax = Number(pointA.x);
            const ay = Number(pointA.y);
            const bx = Number(pointB.x);
            const by = Number(pointB.y);
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return Infinity;
            const mapRef = this.map || null;
            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(ax, bx)
                : (bx - ax);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(ay, by)
                : (by - ay);
            if (!Number.isFinite(dx) || !Number.isFinite(dy)) return Infinity;
            return dx * dx + dy * dy;
        }

        _resolvePlayerReferencePoint(options = {}) {
            const fromPlayerPoint = options.playerPoint;
            if (fromPlayerPoint && Number.isFinite(fromPlayerPoint.x) && Number.isFinite(fromPlayerPoint.y)) {
                return { x: Number(fromPlayerPoint.x), y: Number(fromPlayerPoint.y) };
            }
            const fromPlayer = options.player;
            if (fromPlayer && Number.isFinite(fromPlayer.x) && Number.isFinite(fromPlayer.y)) {
                return { x: Number(fromPlayer.x), y: Number(fromPlayer.y) };
            }

            const wizardRef = (typeof globalScope !== "undefined" && globalScope && globalScope.wizard)
                ? globalScope.wizard
                : null;
            if (wizardRef && Number.isFinite(wizardRef.x) && Number.isFinite(wizardRef.y)) {
                return { x: Number(wizardRef.x), y: Number(wizardRef.y) };
            }

            const camera = options.camera || ((typeof globalScope !== "undefined" && globalScope && globalScope.viewport) ? globalScope.viewport : null);
            if (camera && Number.isFinite(camera.x) && Number.isFinite(camera.y)) {
                const width = Number.isFinite(camera.width) ? Number(camera.width) : 0;
                const height = Number.isFinite(camera.height) ? Number(camera.height) : 0;
                return {
                    x: Number(camera.x) + width * 0.5,
                    y: Number(camera.y) + height * 0.5
                };
            }
            return null;
        }

        _resolveCameraReferencePoint(options = {}) {
            const camera = options.camera || ((typeof globalScope !== "undefined" && globalScope && globalScope.viewport) ? globalScope.viewport : null);
            if (camera && Number.isFinite(camera.x) && Number.isFinite(camera.y)) {
                const width = Number.isFinite(camera.width) ? Number(camera.width) : 0;
                const height = Number.isFinite(camera.height) ? Number(camera.height) : 0;
                return {
                    x: Number(camera.x) + width * 0.5,
                    y: Number(camera.y) + height * 0.5
                };
            }
            return null;
        }

        _getSignedAcrossFromCenterline(worldPoint) {
            if (!worldPoint || !this.startPoint || !this.endPoint) return null;
            const sx = Number(this.startPoint.x);
            const sy = Number(this.startPoint.y);
            const ex = Number(this.endPoint.x);
            const ey = Number(this.endPoint.y);
            const px = Number(worldPoint.x);
            const py = Number(worldPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey) || !Number.isFinite(px) || !Number.isFinite(py)) {
                return null;
            }

            const mapRef = this.map || null;
            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(sx, ex)
                : (ex - sx);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(sy, ey)
                : (ey - sy);
            const len = Math.hypot(dx, dy);
            if (!(len > EPS)) return null;

            const ux = dx / len;
            const uy = dy / len;
            const nx = -uy;
            const ny = ux;

            const vx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(sx, px)
                : (px - sx);
            const vy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(sy, py)
                : (py - sy);
            if (!Number.isFinite(vx) || !Number.isFinite(vy)) return null;

            return vx * nx + vy * ny;
        }

        getPlayerFacingLongSideCornersWorld(options = {}) {
            const faces = this._buildFaceQuadsWorld();
            if (!faces) return null;

            const playerPoint = this._resolvePlayerReferencePoint(options);
            if (!playerPoint) return faces.longFaceLeft;

            const signedAcross = this._getSignedAcrossFromCenterline(playerPoint);
            const centerlineEps = Math.max(1e-4, (Number(this.thickness) || 0) * 0.01);
            if (Number.isFinite(signedAcross)) {
                if (signedAcross > centerlineEps) return faces.longFaceLeft;
                if (signedAcross < -centerlineEps) return faces.longFaceRight;

                const dir = WallSectionUnit._normalizeDirection(Number.isFinite(this.direction) ? Number(this.direction) : 0);
                const isVertical = (dir === 3 || dir === 9);
                if (!isVertical) {
                    const screenFacing = this.getScreenFacingSideCornersWorld(options);
                    if (Array.isArray(screenFacing) && screenFacing.length >= 4) {
                        const screenCenter = this._getFaceCenterWorld(screenFacing);
                        const leftCenter = this._getFaceCenterWorld(faces.longFaceLeft);
                        const rightCenter = this._getFaceCenterWorld(faces.longFaceRight);
                        const screenToLeft = this._distanceSqToWorldPoint(screenCenter, leftCenter);
                        const screenToRight = this._distanceSqToWorldPoint(screenCenter, rightCenter);
                        return (screenToLeft <= screenToRight) ? faces.longFaceLeft : faces.longFaceRight;
                    }
                }
            }

            const leftCenter = this._getFaceCenterWorld(faces.longFaceLeft);
            const rightCenter = this._getFaceCenterWorld(faces.longFaceRight);
            const leftDistSq = this._distanceSqToWorldPoint(playerPoint, leftCenter);
            const rightDistSq = this._distanceSqToWorldPoint(playerPoint, rightCenter);

            return (leftDistSq <= rightDistSq) ? faces.longFaceLeft : faces.longFaceRight;
        }

        getScreenFacingSideCornersWorld(options = {}) {
            const faces = this._buildFaceQuadsWorld();
            if (!faces) return null;

            const dir = WallSectionUnit._normalizeDirection(Number.isFinite(this.direction) ? Number(this.direction) : 0);
            const isVertical = (dir === 3 || dir === 9);
            if (isVertical) return faces.topFace;

            const worldToScreenFn = (typeof options.worldToScreenFn === "function")
                ? options.worldToScreenFn
                : ((typeof globalScope.worldToScreen === "function") ? globalScope.worldToScreen : null);
            const vs = Number.isFinite(options.viewscale)
                ? Number(options.viewscale)
                : (Number.isFinite(globalScope.viewscale) ? Number(globalScope.viewscale) : 1);
            const xyr = Number.isFinite(options.xyratio)
                ? Number(options.xyratio)
                : (Number.isFinite(globalScope.xyratio) ? Number(globalScope.xyratio) : 0.66);

            if (typeof worldToScreenFn !== "function") return faces.longFaceLeft;
            const faceDepth = (face) => {
                let sum = 0;
                let n = 0;
                for (let i = 0; i < face.length; i++) {
                    const c = face[i];
                    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) continue;
                    const s = worldToScreenFn({ x: Number(c.x), y: Number(c.y) });
                    if (!s || !Number.isFinite(s.y)) continue;
                    sum += Number(s.y) - Number(c.z) * vs * xyr;
                    n++;
                }
                return n > 0 ? (sum / n) : -Infinity;
            };
            const leftDepth = faceDepth(faces.longFaceLeft);
            const rightDepth = faceDepth(faces.longFaceRight);
            return (leftDepth >= rightDepth) ? faces.longFaceLeft : faces.longFaceRight;
        }

        getScreenFacingLongFaceLabel(options = {}) {
            const faces = this._buildFaceQuadsWorld();
            if (!faces) return null;
            const screenFacing = this.getScreenFacingSideCornersWorld(options);
            const label = this._identifyFaceLabel(screenFacing, faces);
            if (label === "longFaceLeft" || label === "longFaceRight") return label;
            return null;
        }

        _faceCornersMatch(faceA, faceB, eps = 1e-4) {
            if (!Array.isArray(faceA) || !Array.isArray(faceB) || faceA.length !== faceB.length || faceA.length < 3) {
                return false;
            }
            for (let i = 0; i < faceA.length; i++) {
                const a = faceA[i];
                const b = faceB[i];
                if (!a || !b) return false;
                const ax = Number(a.x);
                const ay = Number(a.y);
                const az = Number(a.z);
                const bx = Number(b.x);
                const by = Number(b.y);
                const bz = Number(b.z);
                if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) || !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz)) {
                    return false;
                }
                if (Math.abs(ax - bx) > eps || Math.abs(ay - by) > eps || Math.abs(az - bz) > eps) {
                    return false;
                }
            }
            return true;
        }

        _identifyFaceLabel(face, faces) {
            if (!Array.isArray(face) || !faces) return "unknown";
            if (this._faceCornersMatch(face, faces.longFaceLeft)) return "longFaceLeft";
            if (this._faceCornersMatch(face, faces.longFaceRight)) return "longFaceRight";
            if (this._faceCornersMatch(face, faces.topFace)) return "topFace";
            return "unknown";
        }

        _computeFaceDepthForDebug(face, worldToScreenFn, viewscale, xyratio) {
            if (!Array.isArray(face) || typeof worldToScreenFn !== "function") return null;
            let sum = 0;
            let n = 0;
            const vs = Number.isFinite(viewscale) ? Number(viewscale) : 1;
            const xyr = Number.isFinite(xyratio) ? Number(xyratio) : 0.66;
            for (let i = 0; i < face.length; i++) {
                const c = face[i];
                if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) continue;
                const s = worldToScreenFn({ x: Number(c.x), y: Number(c.y) });
                if (!s || !Number.isFinite(s.y)) continue;
                sum += Number(s.y) - Number(c.z) * vs * xyr;
                n++;
            }
            if (n <= 0) return null;
            return sum / n;
        }

        _isLikelyOnScreenForMazeDebug(options, faces) {
            const worldToScreenFn = (typeof options.worldToScreenFn === "function")
                ? options.worldToScreenFn
                : ((typeof globalScope.worldToScreen === "function") ? globalScope.worldToScreen : null);
            const camera = options.camera || ((typeof globalScope !== "undefined" && globalScope && globalScope.viewport) ? globalScope.viewport : null);
            if (typeof worldToScreenFn !== "function") return true;
            if (!camera || !Number.isFinite(camera.width) || !Number.isFinite(camera.height)) return true;

            const vs = Number.isFinite(options.viewscale)
                ? Number(options.viewscale)
                : (Number.isFinite(globalScope.viewscale) ? Number(globalScope.viewscale) : 1);
            const xyr = Number.isFinite(options.xyratio)
                ? Number(options.xyratio)
                : (Number.isFinite(globalScope.xyratio) ? Number(globalScope.xyratio) : 0.66);
            const screenW = Math.max(1, Number(camera.width) * Math.max(0.0001, vs));
            const screenH = Math.max(1, Number(camera.height) * Math.max(0.0001, vs) * Math.max(0.0001, xyr));
            const margin = 24;

            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            const allFaces = [faces.longFaceLeft, faces.longFaceRight, faces.topFace];
            for (let fi = 0; fi < allFaces.length; fi++) {
                const face = allFaces[fi];
                if (!Array.isArray(face)) continue;
                for (let i = 0; i < face.length; i++) {
                    const c = face[i];
                    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) continue;
                    const s = worldToScreenFn({ x: Number(c.x), y: Number(c.y) });
                    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
                    const sy = Number(s.y) - Number(c.z) * vs * xyr;
                    const sx = Number(s.x);
                    if (sx < minX) minX = sx;
                    if (sx > maxX) maxX = sx;
                    if (sy < minY) minY = sy;
                    if (sy > maxY) maxY = sy;
                }
            }
            if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
                return true;
            }
            const overlapsX = maxX >= -margin && minX <= (screenW + margin);
            const overlapsY = maxY >= -margin && minY <= (screenH + margin);
            return overlapsX && overlapsY;
        }

        _emitMazeFacingDebugDumpOnce(options, faces, playerFacing, screenFacing, visible) {
            if (WallSectionUnit._mazeFacingDebugDumped) return;
            if (!visible) return;
            if (!this._isLikelyOnScreenForMazeDebug(options, faces)) return;
            const frame = Number.isFinite(globalScope && globalScope.frameCount)
                ? Number(globalScope.frameCount)
                : 0;
            if (!Number.isInteger(WallSectionUnit._mazeFacingDebugTargetFrame)) {
                WallSectionUnit._mazeFacingDebugTargetFrame = frame;
                WallSectionUnit._mazeFacingDebugSeenWallIds = new Set();
            }
            if (frame !== WallSectionUnit._mazeFacingDebugTargetFrame) return;
            const seenIds = WallSectionUnit._mazeFacingDebugSeenWallIds;
            if (seenIds && seenIds.has(this.id)) return;
            if (seenIds) seenIds.add(this.id);

            const worldToScreenFn = (typeof options.worldToScreenFn === "function")
                ? options.worldToScreenFn
                : ((typeof globalScope.worldToScreen === "function") ? globalScope.worldToScreen : null);
            const vs = Number.isFinite(options.viewscale)
                ? Number(options.viewscale)
                : (Number.isFinite(globalScope.viewscale) ? Number(globalScope.viewscale) : 1);
            const xyr = Number.isFinite(options.xyratio)
                ? Number(options.xyratio)
                : (Number.isFinite(globalScope.xyratio) ? Number(globalScope.xyratio) : 0.66);

            const playerPoint = this._resolvePlayerReferencePoint(options);
            const camera = options.camera || ((typeof globalScope !== "undefined" && globalScope && globalScope.viewport) ? globalScope.viewport : null);
            const cameraCenter = (camera && Number.isFinite(camera.x) && Number.isFinite(camera.y))
                ? {
                    x: Number(camera.x) + (Number.isFinite(camera.width) ? Number(camera.width) * 0.5 : 0),
                    y: Number(camera.y) + (Number.isFinite(camera.height) ? Number(camera.height) * 0.5 : 0)
                }
                : null;
            const playerAcross = this._getSignedAcrossFromCenterline(playerPoint);
            const cameraAcross = this._getSignedAcrossFromCenterline(cameraCenter);
            const profile = this.getWallProfile();

            const row = {
                frame,
                wallId: this.id,
                direction: this.direction,
                start: this.startPoint ? { x: Number(this.startPoint.x), y: Number(this.startPoint.y) } : null,
                end: this.endPoint ? { x: Number(this.endPoint.x), y: Number(this.endPoint.y) } : null,
                playerPoint: playerPoint ? { x: Number(playerPoint.x), y: Number(playerPoint.y) } : null,
                cameraXY: (camera && Number.isFinite(camera.x) && Number.isFinite(camera.y))
                    ? { x: Number(camera.x), y: Number(camera.y), width: Number(camera.width) || 0, height: Number(camera.height) || 0 }
                    : null,
                cameraCenter,
                signedAcross: {
                    player: Number.isFinite(playerAcross) ? Number(playerAcross) : null,
                    camera: Number.isFinite(cameraAcross) ? Number(cameraAcross) : null
                },
                playerFacing: this._identifyFaceLabel(playerFacing, faces),
                screenFacing: this._identifyFaceLabel(screenFacing, faces),
                visibleByRule: !!visible,
                faceDepths: {
                    left: this._computeFaceDepthForDebug(faces.longFaceLeft, worldToScreenFn, vs, xyr),
                    right: this._computeFaceDepthForDebug(faces.longFaceRight, worldToScreenFn, vs, xyr),
                    top: this._computeFaceDepthForDebug(faces.topFace, worldToScreenFn, vs, xyr)
                },
                wallProfile: profile ? {
                    aLeft: profile.aLeft,
                    aRight: profile.aRight,
                    bLeft: profile.bLeft,
                    bRight: profile.bRight
                } : null
            };

            if (!Array.isArray(globalScope.__mazeFacingDebugRows)) {
                globalScope.__mazeFacingDebugRows = [];
            }
            globalScope.__mazeFacingDebugRows.push(row);

            const rows = globalScope.__mazeFacingDebugRows;
            const haveEnoughRows = rows.length >= 20;
            if (haveEnoughRows) {
                WallSectionUnit._mazeFacingDebugDumped = true;
                console.groupCollapsed(`[MazeFacingDebug] frame=${frame} rows=${rows.length}`);
                console.table(rows.map(r => ({
                    wallId: r.wallId,
                    direction: r.direction,
                    playerFacing: r.playerFacing,
                    screenFacing: r.screenFacing,
                    visibleByRule: r.visibleByRule,
                    playerAcross: r.signedAcross.player,
                    cameraAcross: r.signedAcross.camera,
                    leftDepth: r.faceDepths.left,
                    rightDepth: r.faceDepths.right,
                    topDepth: r.faceDepths.top
                })));
                console.log("mazeFacingDebugRows", rows);
                console.groupEnd();
            }
        }

        isVisibleInMazeModeFacingRule(options = {}) {
            const faces = this._buildFaceQuadsWorld();
            if (!faces) return true;

            const playerFacing = this.getPlayerFacingLongSideCornersWorld(options);
            const screenFacing = this.getScreenFacingSideCornersWorld(options);
            if (!Array.isArray(playerFacing) || !Array.isArray(screenFacing)) {
                this._emitMazeFacingDebugDumpOnce(options, faces, playerFacing, screenFacing, true);
                return true;
            }
            if (this._faceCornersMatch(playerFacing, screenFacing)) {
                this._emitMazeFacingDebugDumpOnce(options, faces, playerFacing, screenFacing, true);
                return true;
            }

            const dir = WallSectionUnit._normalizeDirection(Number.isFinite(this.direction) ? Number(this.direction) : 0);
            const isVertical = (dir === 3 || dir === 9);
            if (!isVertical) {
                this._emitMazeFacingDebugDumpOnce(options, faces, playerFacing, screenFacing, false);
                return false;
            }

            const visible = this._faceCornersMatch(screenFacing, faces.topFace);
            this._emitMazeFacingDebugDumpOnce(options, faces, playerFacing, screenFacing, visible);
            return visible;
        }

        getMazeModeRenderFaceCornersWorld(options = {}) {
            const faces = this._buildFaceQuadsWorld();
            if (!faces) return null;

            const dir = WallSectionUnit._normalizeDirection(Number.isFinite(this.direction) ? Number(this.direction) : 0);
            const isVertical = (dir === 3 || dir === 9);
            if (isVertical) {
                // Vertical wall orientation should expose the top face in maze mode.
                return faces.topFace;
            }

            const playerFacing = this.getPlayerFacingLongSideCornersWorld(options);
            if (!Array.isArray(playerFacing) || playerFacing.length < 4) return null;

            // Maze mode must render only one long side face (never top/caps/miters).
            if (this._faceCornersMatch(playerFacing, faces.longFaceLeft)) return faces.longFaceLeft;
            if (this._faceCornersMatch(playerFacing, faces.longFaceRight)) return faces.longFaceRight;

            const signedAcross = this._getSignedAcrossFromCenterline(this._resolvePlayerReferencePoint(options));
            return (Number.isFinite(signedAcross) && signedAcross < 0)
                ? faces.longFaceRight
                : faces.longFaceLeft;
        }

        resetLosIlluminationTally() {
            this._losIlluminationTMin = null;
            this._losIlluminationTMax = null;
            this._losSnapToStart = false;
            this._losSnapToEnd = false;
        }

        setLosEndpointSnapEligibility(endpointKey, shouldSnap) {
            const enabled = !!shouldSnap;
            if (endpointKey === "a") {
                this._losSnapToStart = enabled;
                return;
            }
            if (endpointKey === "b") {
                this._losSnapToEnd = enabled;
            }
        }

        _resolveMountedWallSectionFromOwner(ownerObject) {
            if (!ownerObject || typeof ownerObject !== "object") return null;
            const allSections = WallSectionUnit._allSections instanceof Map
                ? WallSectionUnit._allSections
                : null;
            if (!allSections) return null;

            const candidateIds = [
                ownerObject.mountedWallSectionUnitId,
                ownerObject.mountedSectionId,
                ownerObject.mountedWallLineGroupId
            ];
            for (let i = 0; i < candidateIds.length; i++) {
                const id = Number(candidateIds[i]);
                if (!Number.isInteger(id)) continue;
                const section = allSections.get(id) || null;
                if (section && section.type === "wallSection") return section;
            }
            return null;
        }

        _isDoorOrWindowObject(candidate) {
            if (!candidate || typeof candidate !== "object") return false;
            const type = (typeof candidate.type === "string") ? candidate.type.trim().toLowerCase() : "";
            const category = (typeof candidate.category === "string") ? candidate.category.trim().toLowerCase() : "";
            return type === "door" || type === "window" || category === "doors" || category === "windows";
        }

        _isCollinearWallForVisibility(otherSection, options = {}) {
            if (!otherSection || otherSection.type !== "wallSection") return false;
            const mapRef = this.map || otherSection.map || null;

            const sx = Number(this.startPoint && this.startPoint.x);
            const sy = Number(this.startPoint && this.startPoint.y);
            const ex = Number(this.endPoint && this.endPoint.x);
            const ey = Number(this.endPoint && this.endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) {
                return false;
            }

            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(sx, ex)
                : (ex - sx);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(sy, ey)
                : (ey - sy);
            const len = Math.hypot(dx, dy);
            if (!(len > EPS)) return false;

            const ux = dx / len;
            const uy = dy / len;
            const vx = -uy;
            const vy = ux;

            const collinearEps = Number.isFinite(options.collinearEps)
                ? Math.max(EPS, Number(options.collinearEps))
                : 1e-4;
            const isPointOnLine = (point) => {
                if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
                const relX = (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(sx, Number(point.x))
                    : (Number(point.x) - sx);
                const relY = (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(sy, Number(point.y))
                    : (Number(point.y) - sy);
                const perp = relX * vx + relY * vy;
                return Math.abs(perp) <= collinearEps;
            };

            return isPointOnLine(otherSection.startPoint) && isPointOnLine(otherSection.endPoint);
        }

        _isSameWallLineForVisibility(otherSection, endpointKey = null) {
            if (!otherSection || otherSection.type !== "wallSection") return false;
            if (otherSection === this) return true;

            const canContinuous = (
                WallSectionUnit.canAutoMergeContinuous(this, otherSection) ||
                WallSectionUnit.canAutoMergeContinuous(otherSection, this)
            );
            if (canContinuous) return true;

            const canOverlap = (
                WallSectionUnit.canMergeCollinearOverlap(this, otherSection) ||
                WallSectionUnit.canMergeCollinearOverlap(otherSection, this)
            );
            if (canOverlap) return true;

            if (this._isCollinearWallForVisibility(otherSection)) return true;

            const endpoint = endpointKey === "a"
                ? this.startPoint
                : (endpointKey === "b" ? this.endPoint : null);
            if (!endpoint) return false;
            if (Number(otherSection.lineAxis) !== Number(this.lineAxis)) return false;
            return (
                WallSectionUnit._pointsMatch(endpoint, otherSection.startPoint) ||
                WallSectionUnit._pointsMatch(endpoint, otherSection.endPoint)
            );
        }

        _getEndpointPointByKey(endpointKey) {
            if (!endpointKey) return null;
            const startKey = WallSectionUnit.endpointKey(this.startPoint);
            if (startKey === endpointKey) return this.startPoint;
            const endKey = WallSectionUnit.endpointKey(this.endPoint);
            if (endKey === endpointKey) return this.endPoint;
            return null;
        }

        _endpointPointMatchesKeyOnSection(section, endpointKey) {
            if (!section || !endpointKey) return null;
            if (WallSectionUnit.endpointKey(section.startPoint) === endpointKey) return section.startPoint;
            if (WallSectionUnit.endpointKey(section.endPoint) === endpointKey) return section.endPoint;
            return null;
        }

        _hasPlayerSideNonCollinearWallAtEndpoint(endpointKey, wizardRef, excludedSection = null) {
            if (!(this.connections instanceof Map) || this.connections.size === 0) return false;
            if (!wizardRef || !Number.isFinite(wizardRef.x) || !Number.isFinite(wizardRef.y)) return false;

            const endpoint = this._getEndpointPointByKey(endpointKey);
            if (!endpoint || !Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) return false;

            const mapRef = this.map || (excludedSection && excludedSection.map) || (wizardRef && wizardRef.map) || null;
            const shortestDeltaX = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? ((fromX, toX) => mapRef.shortestDeltaX(fromX, toX))
                : ((fromX, toX) => toX - fromX);
            const shortestDeltaY = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? ((fromY, toY) => mapRef.shortestDeltaY(fromY, toY))
                : ((fromY, toY) => toY - fromY);

            const sx = Number(this.startPoint && this.startPoint.x);
            const sy = Number(this.startPoint && this.startPoint.y);
            const ex = Number(this.endPoint && this.endPoint.x);
            const ey = Number(this.endPoint && this.endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) {
                return false;
            }
            const lineDx = shortestDeltaX(sx, ex);
            const lineDy = shortestDeltaY(sy, ey);
            const lineLen = Math.hypot(lineDx, lineDy);
            if (!(lineLen > EPS)) return false;
            const ux = lineDx / lineLen;
            const uy = lineDy / lineLen;
            const nx = -uy;
            const ny = ux;

            const playerDx = shortestDeltaX(Number(endpoint.x), Number(wizardRef.x));
            const playerDy = shortestDeltaY(Number(endpoint.y), Number(wizardRef.y));
            const playerSide = playerDx * nx + playerDy * ny;
            if (Math.abs(playerSide) <= 1e-5) return false;

            for (const payload of this.connections.values()) {
                const candidate = payload && payload.section;
                if (!candidate || candidate.type !== "wallSection") continue;
                if (candidate === this || candidate === excludedSection) continue;
                if (candidate.gone || candidate.vanishing) continue;

                const sharesEndpointByMetadata = !!(payload && payload.sharedEndpointKey === endpointKey);
                const sharesEndpointByCoords = !!(
                    WallSectionUnit._pointsMatch(endpoint, candidate.startPoint) ||
                    WallSectionUnit._pointsMatch(endpoint, candidate.endPoint)
                );
                if (!sharesEndpointByMetadata && !sharesEndpointByCoords) continue;
                if (this._isSameWallLineForVisibility(candidate)) continue;

                const candidateEndpoint = this._endpointPointMatchesKeyOnSection(candidate, endpointKey);
                if (!candidateEndpoint) continue;
                const candidateFarPoint = WallSectionUnit._pointsMatch(candidateEndpoint, candidate.startPoint)
                    ? candidate.endPoint
                    : candidate.startPoint;
                if (!candidateFarPoint) continue;

                const candDx = shortestDeltaX(Number(endpoint.x), Number(candidateFarPoint.x));
                const candDy = shortestDeltaY(Number(endpoint.y), Number(candidateFarPoint.y));
                const candidateSide = candDx * nx + candDy * ny;
                if (Math.abs(candidateSide) <= 1e-5) continue;

                if ((playerSide > 0 && candidateSide > 0) || (playerSide < 0 && candidateSide < 0)) {
                    return true;
                }
            }

            return false;
        }

        canShareMazeCollinearVisibilityWith(otherSection, wizardRef = null) {
            if (!otherSection || otherSection.type !== "wallSection") return false;
            if (otherSection === this) return true;
            if (!this._isSameWallLineForVisibility(otherSection)) return false;

            const sharedEndpointKey = this._resolveSharedEndpointKey(otherSection);
            if (!sharedEndpointKey) return true;
            if (!wizardRef || !Number.isFinite(wizardRef.x) || !Number.isFinite(wizardRef.y)) return true;

            return !this._hasPlayerSideNonCollinearWallAtEndpoint(sharedEndpointKey, wizardRef, otherSection);
        }

        isEndpointOwnedBySameWall(endpointKey, ownerSection) {
            if (!ownerSection) return false;

            if (ownerSection.type === "wallSection") {
                return this._isSameWallLineForVisibility(ownerSection, endpointKey);
            }

            if (this._isDoorOrWindowObject(ownerSection)) {
                if (Array.isArray(this.attachedObjects)) {
                    for (let i = 0; i < this.attachedObjects.length; i++) {
                        const entry = this.attachedObjects[i];
                        if (entry && entry.object === ownerSection) return true;
                    }
                }
                const mountedSection = this._resolveMountedWallSectionFromOwner(ownerSection);
                if (mountedSection) {
                    return this._isSameWallLineForVisibility(mountedSection, endpointKey);
                }
            }

            return false;
        }

        accumulateLosIlluminationT(tValue) {
            if (!Number.isFinite(tValue)) return;
            const t = Math.max(0, Math.min(1, Number(tValue)));
            if (!Number.isFinite(this._losIlluminationTMin) || t < this._losIlluminationTMin) {
                this._losIlluminationTMin = t;
            }
            if (!Number.isFinite(this._losIlluminationTMax) || t > this._losIlluminationTMax) {
                this._losIlluminationTMax = t;
            }
        }

        getLosIlluminationRangeT() {
            const tMin = Number(this._losIlluminationTMin);
            const tMax = Number(this._losIlluminationTMax);
            if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) return null;
            return {
                tMin: Math.max(0, Math.min(1, tMin)),
                tMax: Math.max(0, Math.min(1, tMax)),
                snapStart: !!this._losSnapToStart,
                snapEnd: !!this._losSnapToEnd
            };
        }

        _clipFaceCornersByTRange(faceCorners, tMin, tMax) {
            if (!Array.isArray(faceCorners) || faceCorners.length < 4) return null;
            if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) return null;
            const a = Math.max(0, Math.min(1, Number(tMin)));
            const b = Math.max(0, Math.min(1, Number(tMax)));
            const startT = Math.min(a, b);
            const endT = Math.max(a, b);
            if (endT - startT < 1e-6) return null;

            const c0 = faceCorners[0];
            const c1 = faceCorners[1];
            const c2 = faceCorners[2];
            const c3 = faceCorners[3];
            const valid = [c0, c1, c2, c3].every(c => c && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z));
            if (!valid) return null;

            const lerp3 = (p, q, t) => ({
                x: Number(p.x) + (Number(q.x) - Number(p.x)) * t,
                y: Number(p.y) + (Number(q.y) - Number(p.y)) * t,
                z: Number(p.z) + (Number(q.z) - Number(p.z)) * t
            });

            const bottomStart = lerp3(c0, c1, startT);
            const bottomEnd = lerp3(c0, c1, endT);
            const topStart = lerp3(c3, c2, startT);
            const topEnd = lerp3(c3, c2, endT);
            return [bottomStart, bottomEnd, topEnd, topStart];
        }

        _getMazeModeLosClipRangeT() {
            const range = this.getLosIlluminationRangeT();
            if (!range) return null;

            let tMin = Number(range.tMin);
            let tMax = Number(range.tMax);
            if (range.snapStart) tMin = 0;
            if (range.snapEnd) tMax = 1;

            const sectionLength = Number.isFinite(this.length) ? Math.max(0, Number(this.length)) : 0;
            const endpointCompensationDistance = 0.1;
            if (sectionLength > EPS) {
                const tComp = Math.min(0.49, endpointCompensationDistance / sectionLength);
                const nearStartThreshold = tComp * 2;
                const nearEndThreshold = tComp * 2;
                if (!range.snapStart && Number.isFinite(tMin) && tMin <= nearStartThreshold) {
                    tMin -= tComp;
                }
                if (!range.snapEnd && Number.isFinite(tMax) && (1 - tMax) <= nearEndThreshold) {
                    tMax += tComp;
                }
            }

            return { tMin, tMax };
        }

        getMazeModeClippedRenderFaceCornersWorld(options = {}) {
            const face = this.getMazeModeRenderFaceCornersWorld(options);
            if (!Array.isArray(face) || face.length < 4) return null;
            const clipRange = this._getMazeModeLosClipRangeT();
            if (!clipRange) return null;

            return this._clipFaceCornersByTRange(face, clipRange.tMin, clipRange.tMax);
        }

        getMazeModeClippedTopFaceCornersWorld() {
            const faces = this._buildFaceQuadsWorld();
            const topFace = faces && Array.isArray(faces.topFace) ? faces.topFace : null;
            if (!Array.isArray(topFace) || topFace.length < 4) return null;
            const clipRange = this._getMazeModeLosClipRangeT();
            if (!clipRange) return null;
            return this._clipFaceCornersByTRange(topFace, clipRange.tMin, clipRange.tMax);
        }

        getMazeModeClippedPrismFacesWorld(options = {}) {
            const visibleWallIdSet = (options && options.visibleWallIdSet instanceof Set)
                ? options.visibleWallIdSet
                : null;
            const fullFaces = this._buildFaceQuadsWorld();
            const playerFacing = this.getPlayerFacingLongSideCornersWorld(options);
            const screenFacing = this.getScreenFacingSideCornersWorld(options);
            const playerFacingLabel = this._identifyFaceLabel(playerFacing, fullFaces);
            const screenFacingLabel = this._identifyFaceLabel(screenFacing, fullFaces);
            const isKnownFaceLabel = (label) => (
                label === "longFaceLeft" ||
                label === "longFaceRight" ||
                label === "topFace"
            );
            const useBottomOnlyForFacingMismatch = (
                isKnownFaceLabel(playerFacingLabel) &&
                isKnownFaceLabel(screenFacingLabel) &&
                playerFacingLabel !== screenFacingLabel
            );
            const fullHeightTarget = !useBottomOnlyForFacingMismatch;
            const nowMs = Number.isFinite(options && options.nowMs) ? Number(options.nowMs) : performance.now();
            const skipMazeRevealAnimation = !!(options && options.skipMazeRevealAnimation);
            const wallLikelyOnScreen = this._isLikelyOnScreenForMazeDebug(options, fullFaces);
            const profile = visibleWallIdSet
                ? this.getWallProfileWithVisibleNeighborMiter(visibleWallIdSet)
                : this.getWallProfile();
            const faces = this._buildFaceQuadsWorldFromProfile(profile);
            if (!faces) return [];
            const clipRange = this._getMazeModeLosClipRangeT();
            if (!clipRange) return [];

            const left = this._clipFaceCornersByTRange(faces.longFaceLeft, clipRange.tMin, clipRange.tMax);
            const right = this._clipFaceCornersByTRange(faces.longFaceRight, clipRange.tMin, clipRange.tMax);
            const top = this._clipFaceCornersByTRange(faces.topFace, clipRange.tMin, clipRange.tMax);
            const tMinClamped = Math.max(0, Math.min(1, Number(clipRange.tMin)));
            const tMaxClamped = Math.max(0, Math.min(1, Number(clipRange.tMax)));
            const shortenStart = tMinClamped > 1e-4;
            const shortenEnd = tMaxClamped < (1 - 1e-4);
            const startKey = WallSectionUnit.endpointKey(this.startPoint);
            const endKey = WallSectionUnit.endpointKey(this.endPoint);
            const hasVisibleStartJoin = !!(
                visibleWallIdSet instanceof Set &&
                startKey &&
                this._computeVisibleEndpointJoineryEntry(startKey, visibleWallIdSet)
            );
            const hasVisibleEndJoin = !!(
                visibleWallIdSet instanceof Set &&
                endKey &&
                this._computeVisibleEndpointJoineryEntry(endKey, visibleWallIdSet)
            );
            const coreFaces = this._buildCoreFaceQuadsWorld();
            const coreLeft = coreFaces
                ? this._clipFaceCornersByTRange(coreFaces.longFaceLeft, clipRange.tMin, clipRange.tMax)
                : null;
            const coreRight = coreFaces
                ? this._clipFaceCornersByTRange(coreFaces.longFaceRight, clipRange.tMin, clipRange.tMax)
                : null;
            const coreTop = coreFaces
                ? this._clipFaceCornersByTRange(coreFaces.topFace, clipRange.tMin, clipRange.tMax)
                : null;
            if (
                Array.isArray(left) && left.length >= 4 &&
                Array.isArray(right) && right.length >= 4 &&
                Array.isArray(coreLeft) && coreLeft.length >= 4 &&
                Array.isArray(coreRight) && coreRight.length >= 4
            ) {
                if (shortenStart && !hasVisibleStartJoin) {
                    left[0] = coreLeft[0];
                    left[3] = coreLeft[3];
                    right[0] = coreRight[0];
                    right[3] = coreRight[3];
                    if (Array.isArray(top) && top.length >= 4 && Array.isArray(coreTop) && coreTop.length >= 4) {
                        top[0] = coreTop[0];
                        top[3] = coreTop[3];
                    }
                }
                if (shortenEnd && !hasVisibleEndJoin) {
                    left[1] = coreLeft[1];
                    left[2] = coreLeft[2];
                    right[1] = coreRight[1];
                    right[2] = coreRight[2];
                    if (Array.isArray(top) && top.length >= 4 && Array.isArray(coreTop) && coreTop.length >= 4) {
                        top[1] = coreTop[1];
                        top[2] = coreTop[2];
                    }
                }
            }
            const bottom = (
                Array.isArray(left) && left.length >= 4 &&
                Array.isArray(right) && right.length >= 4
            ) ? [left[0], left[1], right[1], right[0]] : null;
            const capStart = (
                Array.isArray(left) && left.length >= 4 &&
                Array.isArray(right) && right.length >= 4
            ) ? [left[0], right[0], right[3], left[3]] : null;
            const capEnd = (
                Array.isArray(left) && left.length >= 4 &&
                Array.isArray(right) && right.length >= 4
            ) ? [left[1], right[1], right[2], left[2]] : null;
            if (!fullHeightTarget) {
                return (Array.isArray(bottom) && bottom.length >= 4) ? [bottom] : [];
            }
            const playerPoint = this._resolvePlayerReferencePoint(options);
            const playerTRaw = this._parameterForWorldPointOnSection(playerPoint);
            const playerT = Number.isFinite(playerTRaw)
                ? Math.max(0, Math.min(1, Number(playerTRaw)))
                : 0.5;
            const animProgress = skipMazeRevealAnimation
                ? this._setMazeModeVisibilityHeightFactorImmediate(1, nowMs, wallLikelyOnScreen)
                : this._getMazeModeVisibilityHeightFactor(fullHeightTarget, nowMs, wallLikelyOnScreen);
            const nearAtStart = playerT <= 0.5;
            const revealSpec = this._buildMazeRevealLineSpec(animProgress, nearAtStart);

            const out = [];
            const pushClippedFace = (face) => {
                const clipped = this._clipFaceByMazeRevealLine(face, revealSpec);
                if (!Array.isArray(clipped) || clipped.length === 0) return;
                for (let i = 0; i < clipped.length; i++) {
                    const c = clipped[i];
                    if (Array.isArray(c) && c.length >= 4) out.push(c);
                }
            };
            pushClippedFace(bottom);
            pushClippedFace(left);
            pushClippedFace(right);
            pushClippedFace(top);
            pushClippedFace(capStart);
            pushClippedFace(capEnd);
            return out;
        }

        isBottomOnlyVisibleInMazeMode(options = {}) {
            const fullFaces = this._buildFaceQuadsWorld();
            if (!fullFaces) return false;
            const playerFacing = this.getPlayerFacingLongSideCornersWorld(options);
            const screenFacing = this.getScreenFacingSideCornersWorld(options);
            const playerFacingLabel = this._identifyFaceLabel(playerFacing, fullFaces);
            const screenFacingLabel = this._identifyFaceLabel(screenFacing, fullFaces);
            const isKnownFaceLabel = (label) => (
                label === "longFaceLeft" ||
                label === "longFaceRight" ||
                label === "topFace"
            );
            return (
                isKnownFaceLabel(playerFacingLabel) &&
                isKnownFaceLabel(screenFacingLabel) &&
                playerFacingLabel !== screenFacingLabel
            );
        }

        _buildMazeRevealLineSpec(progress, nearAtStart) {
            const p = Math.max(0, Math.min(1, Number(progress) || 0));
            const u0 = nearAtStart ? 0 : 1;
            const farU = nearAtStart ? 1 : 0;
            const dirU = nearAtStart ? Math.sin(p * Math.PI * 0.5) : -Math.sin(p * Math.PI * 0.5);
            const dirV = -Math.cos(p * Math.PI * 0.5);
            const signedAt = (u, v) => {
                const relU = Number(u) - u0;
                const relV = Number(v) - 1;
                // n = (-dirV, dirU)
                return (-dirV * relU) + (dirU * relV);
            };
            const nearBottomSigned = signedAt(u0, 0);
            const farTopSigned = signedAt(farU, 1);
            let keepSign = 0;
            if (Math.abs(nearBottomSigned) > 1e-8) {
                keepSign = nearBottomSigned >= 0 ? 1 : -1;
            } else if (Math.abs(farTopSigned) > 1e-8) {
                keepSign = farTopSigned >= 0 ? -1 : 1;
            } else {
                keepSign = 1;
            }
            return { u0, dirU, dirV, keepSign };
        }

        _clipFaceByMazeRevealLine(faceCorners, revealSpec) {
            if (!Array.isArray(faceCorners) || faceCorners.length < 3 || !revealSpec) return [];
            const sectionHeight = Math.max(EPS, Number(this.height) || 0);
            const bottomZ = Number.isFinite(this.bottomZ) ? Number(this.bottomZ) : 0;
            const signedAt = (u, v) => {
                const relU = Number(u) - Number(revealSpec.u0);
                const relV = Number(v) - 1;
                return ((-Number(revealSpec.dirV) * relU) + (Number(revealSpec.dirU) * relV)) * Number(revealSpec.keepSign);
            };
            const toUvVertex = (pt) => {
                if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y) || !Number.isFinite(pt.z)) return null;
                const uRaw = this._parameterForWorldPointOnSection(pt);
                if (!Number.isFinite(uRaw)) return null;
                const u = Math.max(0, Math.min(1, Number(uRaw)));
                const v = Math.max(0, Math.min(1, (Number(pt.z) - bottomZ) / sectionHeight));
                return { x: Number(pt.x), y: Number(pt.y), z: Number(pt.z), u, v };
            };
            let poly = [];
            for (let i = 0; i < faceCorners.length; i++) {
                const v = toUvVertex(faceCorners[i]);
                if (v) poly.push(v);
            }
            if (poly.length < 3) return [];

            const clipAgainstLine = (inputPoly) => {
                const output = [];
                for (let i = 0; i < inputPoly.length; i++) {
                    const a = inputPoly[i];
                    const b = inputPoly[(i + 1) % inputPoly.length];
                    const sa = signedAt(a.u, a.v);
                    const sb = signedAt(b.u, b.v);
                    const insideA = sa >= -1e-8;
                    const insideB = sb >= -1e-8;
                    if (insideA && insideB) {
                        output.push(b);
                        continue;
                    }
                    if (insideA !== insideB) {
                        const denom = sa - sb;
                        const t = Math.abs(denom) > 1e-8 ? (sa / denom) : 0;
                        const clampedT = Math.max(0, Math.min(1, t));
                        const hit = {
                            x: a.x + (b.x - a.x) * clampedT,
                            y: a.y + (b.y - a.y) * clampedT,
                            z: a.z + (b.z - a.z) * clampedT,
                            u: a.u + (b.u - a.u) * clampedT,
                            v: a.v + (b.v - a.v) * clampedT
                        };
                        output.push(hit);
                        if (!insideA && insideB) output.push(b);
                    }
                }
                return output;
            };

            poly = clipAgainstLine(poly);
            if (!Array.isArray(poly) || poly.length < 3) return [];

            const toQuadFace = (a, b, c, d) => ([
                { x: Number(a.x), y: Number(a.y), z: Number(a.z) },
                { x: Number(b.x), y: Number(b.y), z: Number(b.z) },
                { x: Number(c.x), y: Number(c.y), z: Number(c.z) },
                { x: Number(d.x), y: Number(d.y), z: Number(d.z) }
            ]);

            if (poly.length === 3) {
                return [toQuadFace(poly[0], poly[1], poly[2], poly[2])];
            }
            if (poly.length === 4) {
                return [toQuadFace(poly[0], poly[1], poly[2], poly[3])];
            }

            // Fan-triangulate polygons with >4 vertices into degenerate quads.
            const out = [];
            for (let i = 1; i < poly.length - 1; i++) {
                out.push(toQuadFace(poly[0], poly[i], poly[i + 1], poly[i + 1]));
            }
            return out;
        }

        _getMazeModeVisibilityHeightFactor(fullHeightTarget, nowMs, wallLikelyOnScreen = true) {
            const durationMs = 500;
            const reappearGapMs = 120;
            const target = fullHeightTarget ? 1 : 0;
            const tNow = Number.isFinite(nowMs) ? Number(nowMs) : performance.now();
            const state = (this._mazeVisibilityHeightAnim && typeof this._mazeVisibilityHeightAnim === "object")
                ? this._mazeVisibilityHeightAnim
                : (this._mazeVisibilityHeightAnim = {
                    value: 0,
                    from: 0,
                    to: 0,
                    startMs: tNow,
                    lastSeenMs: null
                });
            const evalCurrentValue = () => {
                const from = Number.isFinite(state.from) ? Number(state.from) : 0;
                const to = Number.isFinite(state.to) ? Number(state.to) : from;
                const startMs = Number.isFinite(state.startMs) ? Number(state.startMs) : tNow;
                if (Math.abs(to - from) <= 1e-6) {
                    return to;
                }
                const progress = Math.max(0, Math.min(1, (tNow - startMs) / durationMs));
                const value = from + (to - from) * progress;
                return value;
            };

            if (!wallLikelyOnScreen) {
                state.lastSeenMs = null;
                return Math.max(0, Math.min(1, Number.isFinite(state.value) ? Number(state.value) : target));
            }

            const becameVisible = (
                !Number.isFinite(state.lastSeenMs) ||
                (tNow - Number(state.lastSeenMs)) > reappearGapMs
            );
            if (becameVisible) {
                state.value = 0;
                state.from = 0;
                state.to = 0;
                state.startMs = tNow;
            } else {
                state.value = evalCurrentValue();
            }

            if (!Number.isFinite(state.to) || Math.abs(Number(state.to) - target) > 1e-6) {
                state.from = Number.isFinite(state.value) ? Number(state.value) : 0;
                state.to = target;
                state.startMs = tNow;
            }

            const out = evalCurrentValue();
            state.value = Math.max(0, Math.min(1, Number.isFinite(out) ? Number(out) : target));
            state.lastSeenMs = tNow;
            return state.value;
        }

        _setMazeModeVisibilityHeightFactorImmediate(targetValue, nowMs, wallLikelyOnScreen = true) {
            const tNow = Number.isFinite(nowMs) ? Number(nowMs) : performance.now();
            const target = Math.max(0, Math.min(1, Number(targetValue) || 0));
            const state = (this._mazeVisibilityHeightAnim && typeof this._mazeVisibilityHeightAnim === "object")
                ? this._mazeVisibilityHeightAnim
                : (this._mazeVisibilityHeightAnim = {
                    value: target,
                    from: target,
                    to: target,
                    startMs: tNow,
                    lastSeenMs: wallLikelyOnScreen ? tNow : null
                });
            state.value = target;
            state.from = target;
            state.to = target;
            state.startMs = tNow;
            state.lastSeenMs = wallLikelyOnScreen ? tNow : null;
            return target;
        }

        hasConnectedWallAtEndpoint(endpointKey) {
            const endpoint = endpointKey === "a" ? this.startPoint : this.endPoint;
            if (!endpoint) return false;
            for (const payload of this.connections.values()) {
                const other = payload && payload.section;
                if (!other || !other.startPoint || !other.endPoint) continue;
                if (WallSectionUnit._pointsMatch(endpoint, other.startPoint) || WallSectionUnit._pointsMatch(endpoint, other.endPoint)) {
                    return true;
                }
            }
            return false;
        }

        getAdjacentCollinearWallHeightAtEndpoint(endpointKey) {
            const endpoint = endpointKey === "a" ? this.startPoint : this.endPoint;
            if (!endpoint) return null;
            let maxHeight = -Infinity;
            for (const payload of this.connections.values()) {
                const other = payload && payload.section;
                if (!other || !other.startPoint || !other.endPoint) continue;
                const sharesEndpoint =
                    WallSectionUnit._pointsMatch(endpoint, other.startPoint) ||
                    WallSectionUnit._pointsMatch(endpoint, other.endPoint);
                if (!sharesEndpoint) continue;
                if (Number(other.lineAxis) !== Number(this.lineAxis)) continue;
                const h = Number(other.height);
                if (!Number.isFinite(h)) continue;
                if (h > maxHeight) maxHeight = h;
            }
            return Number.isFinite(maxHeight) ? maxHeight : null;
        }

        /**
         * Draw the base (bottom face) outline of the wall as a
         * horizontal quad with black edge lines, raised slightly
         * above the ground.  Uses the global worldToScreen /
         * viewscale / xyratio that the legacy renderer exposes.
         */
        draw() {
            const g = this.pixiSprite;
            if (!g || typeof g.clear !== "function") return;
            g.clear();

            const sp = this.startPoint;
            const ep = this.endPoint;
            if (!sp || !ep) return;
            const sx = Number(sp.x);
            const sy = Number(sp.y);
            const ex = Number(ep.x);
            const ey = Number(ep.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
                !Number.isFinite(ex) || !Number.isFinite(ey)) return;

            const dx = ex - sx;
            const dy = ey - sy;
            const len = Math.hypot(dx, dy);
            if (len < EPS) return;
            const z = (Number.isFinite(this.bottomZ) ? this.bottomZ : 0) + 0.001;
            const profile = this.getWallProfile();
            const adjacentHeightA = this.getAdjacentCollinearWallHeightAtEndpoint("a");
            const adjacentHeightB = this.getAdjacentCollinearWallHeightAtEndpoint("b");
            const capBaseHeightA = Number.isFinite(adjacentHeightA)
                ? Math.max(0, Math.min(Number(this.height) || 0, Number(adjacentHeightA)))
                : 0;
            const capBaseHeightB = Number.isFinite(adjacentHeightB)
                ? Math.max(0, Math.min(Number(this.height) || 0, Number(adjacentHeightB)))
                : 0;
            const capVisibleEps = 1e-5;
            const renderCapA = capBaseHeightA < ((Number(this.height) || 0) - capVisibleEps);
            const renderCapB = capBaseHeightB < ((Number(this.height) || 0) - capVisibleEps);

            {
                const corners = this._buildBasePerimeterCorners();
                if (!Array.isArray(corners) || corners.length < 3) return;

                // Project to screen
                const toScreen = (typeof globalScope.worldToScreen === "function")
                    ? globalScope.worldToScreen
                    : null;
                const vs = (typeof globalScope.viewscale !== "undefined" && Number.isFinite(globalScope.viewscale))
                    ? globalScope.viewscale : 1;
                const xyr = (typeof globalScope.xyratio !== "undefined" && Number.isFinite(globalScope.xyratio))
                    ? globalScope.xyratio : 0.66;

                if (!toScreen) return;

                const screenPts = corners.map(c => {
                    const s = toScreen(c);
                    return { x: s.x, y: s.y - z * vs * xyr };
                });

                // Fill quad so it's pickable, with slight transparency
                g.beginFill(0x444444, 0.15);
                g.moveTo(screenPts[0].x, screenPts[0].y);
                for (let i = 1; i < screenPts.length; i++) {
                    g.lineTo(screenPts[i].x, screenPts[i].y);
                }
                g.closePath();
                g.endFill();

                // Black outline
                g.lineStyle(1.5, 0x000000, 0.9);
                g.moveTo(screenPts[0].x, screenPts[0].y);
                for (let i = 1; i < screenPts.length; i++) {
                    g.lineTo(screenPts[i].x, screenPts[i].y);
                }
                g.lineTo(screenPts[0].x, screenPts[0].y);
            }

            // Project to screen
            const toScreen = (typeof globalScope.worldToScreen === "function")
                ? globalScope.worldToScreen
                : null;
            const vs = (typeof globalScope.viewscale !== "undefined" && Number.isFinite(globalScope.viewscale))
                ? globalScope.viewscale : 1;
            const xyr = (typeof globalScope.xyratio !== "undefined" && Number.isFinite(globalScope.xyratio))
                ? globalScope.xyratio : 0.66;

            if (!toScreen) return;

            if (!WallSectionUnit._showDirectionalBlockingDebug) return;

            const debugData = this._directionalBlockingDebug;
            if (!debugData) return;

            const centerlineNodes = Array.isArray(debugData.centerlineNodes) ? debugData.centerlineNodes : [];
            const oddNeighborNodes = Array.isArray(debugData.oddNeighborNodes) ? debugData.oddNeighborNodes : [];
            const radiusPx = Math.max(1, Math.max(0.001, this.thickness) * 0.5 * vs);

            if (centerlineNodes.length > 0) {
                g.beginFill(0x000000, 0.65);
                for (let i = 0; i < centerlineNodes.length; i++) {
                    const node = centerlineNodes[i];
                    if (!node) continue;
                    const p = toScreen(node);
                    g.drawCircle(p.x, p.y - z * vs * xyr, radiusPx);
                }
                g.endFill();
            }

            if (oddNeighborNodes.length > 0) {
                g.beginFill(0x888888, 0.5);
                for (let i = 0; i < oddNeighborNodes.length; i++) {
                    const node = oddNeighborNodes[i];
                    if (!node) continue;
                    const p = toScreen(node);
                    g.drawCircle(p.x, p.y - z * vs * xyr, radiusPx);
                }
                g.endFill();
            }

            const blockedLinks = Array.isArray(this.blockedLinks) ? this.blockedLinks : [];
            if (blockedLinks.length > 0) {
                const drawnMarkers = new Map();
                for (let i = 0; i < blockedLinks.length; i++) {
                    const link = blockedLinks[i];
                    const sourceNode = link && link.node;
                    const dir = Number(link && link.direction);
                    if (!sourceNode || !Array.isArray(sourceNode.neighbors) || !Number.isInteger(dir)) continue;
                    const destinationNode = sourceNode.neighbors[dir];
                    if (!destinationNode) continue;
                    const incomingDir = ((dir + 6) % 12 + 12) % 12;
                    const markerKey = `${Number(destinationNode.xindex)},${Number(destinationNode.yindex)}|${incomingDir}`;
                    const color = WallSectionUnit._getDirectionalBlockingDebugColor(link.blocker);
                    const existingColor = drawnMarkers.get(markerKey);
                    if (existingColor === 0x3399ff || existingColor === color) continue;
                    drawnMarkers.set(markerKey, {
                        sourceNode,
                        destinationNode,
                        incomingDir,
                        color
                    });
                }

                for (const marker of drawnMarkers.values()) {
                    if (!marker || !marker.sourceNode || !marker.destinationNode) continue;
                    const sourceWorldX = Number(marker.sourceNode.x) || 0;
                    const sourceWorldY = Number(marker.sourceNode.y) || 0;
                    const destinationWorldX = Number(marker.destinationNode.x) || 0;
                    const destinationWorldY = Number(marker.destinationNode.y) || 0;
                    const dxWorld = sourceWorldX - destinationWorldX;
                    const dyWorld = sourceWorldY - destinationWorldY;
                    const worldLen = Math.hypot(dxWorld, dyWorld);
                    if (!(worldLen > 1e-4)) continue;

                    const ux = dxWorld / worldLen;
                    const uy = dyWorld / worldLen;
                    const px = -uy;
                    const py = ux;
                    const incomingDir = Number.isInteger(marker.incomingDir) ? marker.incomingDir : 0;
                    const halfMarkerWorldLength = (incomingDir % 2 === 1) ? 0.28 : 0.22;
                    const markerCenterWorldX = destinationWorldX + ux * worldLen * 0.56;
                    const markerCenterWorldY = destinationWorldY + uy * worldLen * 0.56;
                    const startScreen = toScreen({
                        x: markerCenterWorldX - px * halfMarkerWorldLength,
                        y: markerCenterWorldY - py * halfMarkerWorldLength
                    });
                    const endScreen = toScreen({
                        x: markerCenterWorldX + px * halfMarkerWorldLength,
                        y: markerCenterWorldY + py * halfMarkerWorldLength
                    });

                    g.lineStyle(3, marker.color, 0.95);
                    g.moveTo(startScreen.x, startScreen.y - z * vs * xyr);
                    g.lineTo(endScreen.x, endScreen.y - z * vs * xyr);
                }
            }
        }

        /**
         * Batch joinery for many walls at once — O(N) instead of O(N²).
         * Builds an endpoint→walls index once, then processes each shared
         * endpoint exactly once using the same geometry logic as
         * handleJoineryOnPlacement().
         *
         * @param {WallSectionUnit[]} walls  The walls to finalise.
         */
        static batchHandleJoinery(walls) {
            if (!walls || walls.length === 0) return;

            // 1. Build endpoint → [{wall, sharedEnd}] index.  O(N)
            const endpointIndex = new Map(); // key → [{wall, sharedEnd, endpoint}]
            for (let w = 0; w < walls.length; w++) {
                const wall = walls[w];
                if (!wall || wall.gone) continue;
                const pairs = [
                    { pt: wall.startPoint, end: "start" },
                    { pt: wall.endPoint,   end: "end"   }
                ];
                for (let p = 0; p < pairs.length; p++) {
                    const key = WallSectionUnit.endpointKey(pairs[p].pt);
                    if (!key) continue;
                    if (!endpointIndex.has(key)) endpointIndex.set(key, []);
                    endpointIndex.get(key).push({
                        wall,
                        sharedEnd: pairs[p].end,
                        endpoint: pairs[p].pt
                    });
                }
            }

            // 2. Process each endpoint with ≥ 2 walls.  Total work across all
            //    endpoints is O(N) since each wall appears at most twice.
            for (const [endpointKey, group] of endpointIndex) {
                const entries = [];
                for (let g = 0; g < group.length; g++) {
                    const { wall, sharedEnd } = group[g];
                    const sp = wall.startPoint;
                    const ep = wall.endPoint;
                    const sharedPoint = (sharedEnd === "start") ? sp : ep;
                    const farPoint   = (sharedEnd === "start") ? ep : sp;
                    const mapRef = wall.map || null;
                    const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                        ? mapRef.shortestDeltaX(sharedPoint.x, farPoint.x)
                        : (farPoint.x - sharedPoint.x);
                    const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                        ? mapRef.shortestDeltaY(sharedPoint.y, farPoint.y)
                        : (farPoint.y - sharedPoint.y);
                    const len = Math.hypot(dx, dy);
                    if (!(len > EPS)) continue;

                    const ux = dx / len;
                    const uy = dy / len;
                    const awayDir = { x: ux, y: uy };
                    const leftN = { x: -awayDir.y, y: awayDir.x };
                    const halfT = Math.max(0.001, Number(wall.thickness) || 0.001) * 0.5;

                    entries.push({
                        wall,
                        sharedEnd,
                        awayDir,
                        angle: Math.atan2(awayDir.y, awayDir.x),
                        leftFace:  { x: sharedPoint.x + leftN.x * halfT, y: sharedPoint.y + leftN.y * halfT },
                        rightFace: { x: sharedPoint.x - leftN.x * halfT, y: sharedPoint.y - leftN.y * halfT },
                        leftLabel:  (sharedEnd === "start") ? "posN" : "negN",
                        rightLabel: (sharedEnd === "start") ? "negN" : "posN"
                    });
                }

                const endpointWallById = new Map();
                for (let i = 0; i < entries.length; i++) {
                    const wall = entries[i].wall;
                    if (wall && Number.isInteger(wall.id)) endpointWallById.set(wall.id, wall);
                }
                const endpointWallIds = new Set(endpointWallById.keys());
                for (const wall of endpointWallById.values()) {
                    if (wall._joineryCorners && wall._joineryCorners[endpointKey]) {
                        delete wall._joineryCorners[endpointKey];
                    }
                    wall._visibleNeighborMiterProfileCache = null;
                    if (!(wall.connections instanceof Map)) continue;
                    for (const [otherIdRaw, payload] of wall.connections.entries()) {
                        if ((payload && payload.sharedEndpointKey) !== endpointKey) continue;
                        if (!endpointWallIds.has(Number(otherIdRaw))) wall.connections.delete(otherIdRaw);
                    }
                }

                if (entries.length < 2) continue;

                const center = { x: Number(group[0].endpoint.x), y: Number(group[0].endpoint.y) };
                if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) continue;

                // Connectivity
                const ewalls = Array.from(endpointWallById.values());
                for (let i = 0; i < ewalls.length; i++) {
                    for (let j = i + 1; j < ewalls.length; j++) {
                        ewalls[i].connectTo(ewalls[j], { joineryEndpoint: endpointKey, rebuiltByJoinery: true });
                        ewalls[j].connectTo(ewalls[i], { joineryEndpoint: endpointKey, rebuiltByJoinery: true });
                    }
                }

                // Sort clockwise
                entries.sort((a, b) => {
                    const d = b.angle - a.angle;
                    if (Math.abs(d) > EPS) return d;
                    return (a.wall.id || 0) - (b.wall.id || 0);
                });

                // Reset + center corners
                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    entry.wall._joineryCorners = entry.wall._joineryCorners || {};
                    entry.wall._joineryCorners[endpointKey] = {
                        sharedEnd: entry.sharedEnd,
                        center: { x: center.x, y: center.y }
                    };
                }

                // Compute ring corners
                const ringCorners = new Array(entries.length).fill(null);
                for (let i = 0; i < entries.length; i++) {
                    const current = entries[i];
                    const next = entries[(i + 1) % entries.length];
                    let hit = WallSectionUnit._lineIntersection(
                        current.rightFace, current.awayDir,
                        next.leftFace, next.awayDir
                    );
                    if (!hit) {
                        const currentHit = WallSectionUnit._sideLinePerpendicularCenterHit(
                            current.rightFace, current.awayDir, center);
                        const nextHit = WallSectionUnit._sideLinePerpendicularCenterHit(
                            next.leftFace, next.awayDir, center);
                        if (currentHit && nextHit) {
                            const sep = Math.hypot(currentHit.x - nextHit.x, currentHit.y - nextHit.y);
                            if (sep <= 1e-4) {
                                hit = { x: (currentHit.x + nextHit.x) * 0.5, y: (currentHit.y + nextHit.y) * 0.5 };
                            }
                        }
                    }
                    if (hit) ringCorners[i] = { x: hit.x, y: hit.y };
                }

                // Assign corners
                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    const rightCorner = ringCorners[i];
                    const leftCorner  = ringCorners[(i - 1 + entries.length) % entries.length];
                    const store = entry.wall._joineryCorners[endpointKey];
                    if (rightCorner) store[entry.rightLabel] = rightCorner;
                    if (leftCorner)  store[entry.leftLabel]  = leftCorner;
                }

                // Commit geometry
                for (let i = 0; i < entries.length; i++) {
                    entries[i].wall.rebuildMesh3d();
                    entries[i].wall.draw();
                }
            }
        }

        /**
         * Recompute endpoint joinery for this section's endpoints.
         *
         * New endpoint-local algorithm (independent of the other wall end):
         * 1) Gather all walls terminating at the endpoint.
         * 2) Build each wall's radial vector from endpoint center outward.
         * 3) Sort walls clockwise by radial angle.
         * 4) For each wall i, intersect its RIGHT face with wall i+1's LEFT face
         *    (wrapping around). This produces exactly N outer intersections for N walls.
         * 5) Give each wall three endpoint corners: right intersection, center,
         *    and left intersection.
         *
         * Parallel/same-direction special case:
         * if right/left face rays do not intersect directly, use intersections of
         * both rays with a perpendicular-through-center line; if those points
         * coincide (or nearly), use that shared point.
         */
        handleJoineryOnPlacement() {
            const endpoints = [this.startPoint, this.endPoint];

            for (let e = 0; e < endpoints.length; e++) {
                const endpoint = endpoints[e];
                const endpointKey = WallSectionUnit.endpointKey(endpoint);
                if (!endpointKey) continue;

                const center = { x: Number(endpoint.x), y: Number(endpoint.y) };
                if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) continue;

                // Build local wall entries at this endpoint.
                const entries = [];
                for (const wall of WallSectionUnit._allSections.values()) {
                    const wallStartKey = WallSectionUnit.endpointKey(wall.startPoint);
                    const wallEndKey = WallSectionUnit.endpointKey(wall.endPoint);
                    let sharedEnd = null;
                    if (wallStartKey === endpointKey) sharedEnd = "start";
                    else if (wallEndKey === endpointKey) sharedEnd = "end";
                    if (!sharedEnd) continue;

                    const sp = wall.startPoint;
                    const ep = wall.endPoint;
                    const sharedPoint = (sharedEnd === "start") ? sp : ep;
                    const farPoint = (sharedEnd === "start") ? ep : sp;
                    const mapRef = wall.map || this.map || null;
                    const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                        ? mapRef.shortestDeltaX(sharedPoint.x, farPoint.x)
                        : (farPoint.x - sharedPoint.x);
                    const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                        ? mapRef.shortestDeltaY(sharedPoint.y, farPoint.y)
                        : (farPoint.y - sharedPoint.y);
                    const len = Math.hypot(dx, dy);
                    if (!(len > EPS)) continue;

                    const ux = dx / len;
                    const uy = dy / len;
                    // Outward from joint center, independent of original drag direction.
                    const awayDir = { x: ux, y: uy };

                    // Left normal for awayDir, right normal is its negative.
                    const leftN = { x: -awayDir.y, y: awayDir.x };
                    const halfT = Math.max(0.001, Number(wall.thickness) || 0.001) * 0.5;

                    const leftFaceOrigin = {
                        x: sharedPoint.x + leftN.x * halfT,
                        y: sharedPoint.y + leftN.y * halfT
                    };
                    const rightFaceOrigin = {
                        x: sharedPoint.x - leftN.x * halfT,
                        y: sharedPoint.y - leftN.y * halfT
                    };

                    entries.push({
                        wall,
                        sharedEnd,
                        awayDir,
                        angle: Math.atan2(awayDir.y, awayDir.x),
                        // Local center-out faces.
                        leftFace: leftFaceOrigin,
                        rightFace: rightFaceOrigin,
                        // Canonical labels expected by rebuildMesh3d at this endpoint.
                        // If sharedEnd is start: left->posN, right->negN.
                        // If sharedEnd is end:   left->negN, right->posN.
                        leftLabel: (sharedEnd === "start") ? "posN" : "negN",
                        rightLabel: (sharedEnd === "start") ? "negN" : "posN"
                    });
                }

                const endpointWallById = new Map();
                for (let i = 0; i < entries.length; i++) {
                    const wall = entries[i] && entries[i].wall;
                    if (!wall || !Number.isInteger(wall.id)) continue;
                    endpointWallById.set(Number(wall.id), wall);
                }
                const endpointWallIds = new Set(endpointWallById.keys());

                for (const wall of endpointWallById.values()) {
                    if (wall._joineryCorners && wall._joineryCorners[endpointKey]) {
                        delete wall._joineryCorners[endpointKey];
                    }
                    wall._visibleNeighborMiterProfileCache = null;
                    if (!(wall.connections instanceof Map)) continue;
                    for (const [otherIdRaw, payload] of wall.connections.entries()) {
                        const otherId = Number(otherIdRaw);
                        const payloadEndpointKey = payload && payload.sharedEndpointKey;
                        if (payloadEndpointKey !== endpointKey) continue;
                        if (!endpointWallIds.has(otherId)) {
                            wall.connections.delete(otherIdRaw);
                        }
                    }
                }

                if (entries.length < 2) continue;

                // Keep runtime connection graph in sync with endpoint topology:
                // every wall sharing this endpoint should be connected to every other.
                // Ensure pairwise bidirectional connectivity at this endpoint.
                const endpointWalls = Array.from(endpointWallById.values());
                for (let i = 0; i < endpointWalls.length; i++) {
                    const aWall = endpointWalls[i];
                    for (let j = i + 1; j < endpointWalls.length; j++) {
                        const bWall = endpointWalls[j];
                        if (!aWall || !bWall || aWall === bWall) continue;
                        aWall.connectTo(bWall, { joineryEndpoint: endpointKey, rebuiltByJoinery: true });
                        bWall.connectTo(aWall, { joineryEndpoint: endpointKey, rebuiltByJoinery: true });
                    }
                }

                // Sort clockwise by radial angle (descending atan2 angle).
                entries.sort((a, b) => {
                    const d = b.angle - a.angle;
                    if (Math.abs(d) > EPS) return d;
                    return (a.wall.id || 0) - (b.wall.id || 0);
                });

                // Reset endpoint corner state and place center corner for each wall.
                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    entry.wall._joineryCorners = entry.wall._joineryCorners || {};
                    entry.wall._joineryCorners[endpointKey] = {
                        sharedEnd: entry.sharedEnd,
                        center: { x: center.x, y: center.y }
                    };
                }

                // For each adjacent pair in clockwise order:
                // current right face intersects next left face.
                const ringCorners = new Array(entries.length).fill(null);
                for (let i = 0; i < entries.length; i++) {
                    const current = entries[i];
                    const next = entries[(i + 1) % entries.length];

                    let hit = WallSectionUnit._lineIntersection(
                        current.rightFace,
                        current.awayDir,
                        next.leftFace,
                        next.awayDir
                    );

                    if (!hit) {
                        // Special-case fallback for parallel face rays: use each
                        // face ray's hit against a perpendicular-through-center line.
                        const currentHit = WallSectionUnit._sideLinePerpendicularCenterHit(
                            current.rightFace,
                            current.awayDir,
                            center
                        );
                        const nextHit = WallSectionUnit._sideLinePerpendicularCenterHit(
                            next.leftFace,
                            next.awayDir,
                            center
                        );

                        if (currentHit && nextHit) {
                            const sep = Math.hypot(currentHit.x - nextHit.x, currentHit.y - nextHit.y);
                            if (sep <= 1e-4) {
                                hit = {
                                    x: (currentHit.x + nextHit.x) * 0.5,
                                    y: (currentHit.y + nextHit.y) * 0.5
                                };
                            }
                        }
                    }

                    if (hit) {
                        ringCorners[i] = { x: hit.x, y: hit.y };
                    }
                }

                // Assign corners:
                // - right corner of wall i is corner between i and i+1
                // - left corner of wall i is corner between i-1 and i
                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    const rightCorner = ringCorners[i];
                    const leftCorner = ringCorners[(i - 1 + entries.length) % entries.length];
                    const store = entry.wall._joineryCorners[endpointKey];

                    if (rightCorner) store[entry.rightLabel] = rightCorner;
                    if (leftCorner) store[entry.leftLabel] = leftCorner;
                }

                // Commit solve to geometry.
                for (let i = 0; i < entries.length; i++) {
                    const wall = entries[i].wall;
                    wall.rebuildMesh3d();
                    wall.draw();
                }
            }
        }

        /**
         * Register this wall section on the map nodes it spans
         * so the renderer's visibility collection picks it up.
         */
        addToMapNodes(options = {}) {
            const timerNow = () => (
                (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                    ? performance.now()
                    : Date.now()
            );
            const addStart = timerNow();
            const applyDirectionalBlocking = options.applyDirectionalBlocking !== false;
            const removeStart = timerNow();
            this.removeFromMapNodes();
            const removeMs = timerNow() - removeStart;
            this.nodes = [];
            const sp = this.startPoint;
            const ep = this.endPoint;
            const nodeKeySet = new Set();
            const registerNode = (node) => {
                if (!WallSectionUnit._isMapNode(node)) return;
                const key = this._nodeKey(node);
                if (!key || nodeKeySet.has(key)) return;
                nodeKeySet.add(key);
                this.nodes.push(node);
                if (typeof node.addObject === "function") {
                    node.addObject(this);
                }
            };

            // Register every map node touched by the wall centerline.
            // This ensures long walls are still discovered by local
            // collision queries near their midpoint.
            const centerlineStart = timerNow();
            const centerlineNodes = this._collectCenterlineMapNodes();
            const centerlineMs = timerNow() - centerlineStart;
            for (let i = 0; i < centerlineNodes.length; i++) {
                registerNode(centerlineNodes[i]);
            }

            // Endpoint anchors as fallback (e.g. midpoint endpoint cases).
            registerNode(sp);
            registerNode(ep);

            // If an endpoint is a midpoint, register on both of its parent nodes.
            if (WallSectionUnit._isNodeMidpoint(sp)) {
                registerNode(sp.nodeA);
                registerNode(sp.nodeB);
            }
            if (WallSectionUnit._isNodeMidpoint(ep)) {
                registerNode(ep.nodeA);
                registerNode(ep.nodeB);
            }

            let directionalMs = 0;
            if (applyDirectionalBlocking) {
                const directionalStart = timerNow();
                this._applyDirectionalBlocking();
                directionalMs = timerNow() - directionalStart;
            }
            this._lastAddToMapNodesStats = {
                ms: Number((timerNow() - addStart).toFixed(2)),
                removeMs: Number(removeMs.toFixed(2)),
                centerlineMs: Number(centerlineMs.toFixed(2)),
                directionalMs: Number(directionalMs.toFixed(2)),
                nodeCount: Array.isArray(this.nodes) ? this.nodes.length : 0,
                centerlineCount: Array.isArray(centerlineNodes) ? centerlineNodes.length : 0
            };
        }

        _nodeKey(node) {
            if (!WallSectionUnit._isMapNode(node)) return "";
            return `${node.xindex},${node.yindex}`;
        }

        _clearDirectionalBlocks() {
            const affectedNodes = [];
            if (Array.isArray(this.blockedLinks)) {
                for (let i = 0; i < this.blockedLinks.length; i++) {
                    const link = this.blockedLinks[i];
                    if (!link || !link.node) continue;
                    const node = link.node;
                    const direction = Number(link.direction);
                    const blockerOwner = (link.blocker && typeof link.blocker === "object")
                        ? link.blocker
                        : this;
                    if (!node.blockedNeighbors || !node.blockedNeighbors.has(direction)) continue;
                    const blockers = node.blockedNeighbors.get(direction);
                    if (!(blockers instanceof Set)) continue;
                    blockers.delete(blockerOwner);
                    if (blockers.size === 0) {
                        node.blockedNeighbors.delete(direction);
                        affectedNodes.push(node);
                    }
                }
            }
            this.blockedLinks = [];
            if (!(this._blockedLinkKeys instanceof Set)) this._blockedLinkKeys = new Set();
            this._blockedLinkKeys.clear();
            // Wall edges removed — update clearance for affected tiles.
            if (affectedNodes.length > 0 &&
                typeof globalThis !== "undefined" && globalThis.map &&
                !globalThis.map._suppressClearanceUpdates &&
                typeof globalThis.map.updateClearanceAround === "function") {
                for (let i = 0; i < affectedNodes.length; i++) {
                    globalThis.map.updateClearanceAround(affectedNodes[i]);
                }
            }
            this._directionalBlockingDebug = {
                centerlineNodes: [],
                oddNeighborNodes: [],
                blockedConnections: []
            };
        }

        _addBlockedLink(node, direction, blocker = this) {
            if (!WallSectionUnit._isMapNode(node)) return false;
            const dir = Number(direction);
            if (!Number.isInteger(dir) || dir < 0 || dir > 11) return false;
            if (!Array.isArray(node.neighbors) || !node.neighbors[dir]) return false;
            if (!blocker || typeof blocker !== "object") return false;

            const blockerId = (Number.isInteger(blocker.id) ? `id:${Number(blocker.id)}` : "")
                || (typeof blocker._doorRuntimeId === "string" ? blocker._doorRuntimeId : "")
                || (typeof blocker.texturePath === "string" ? blocker.texturePath : "")
                || String(blocker.type || "blocker");
            const key = `${this._nodeKey(node)}|${dir}|${blockerId}`;
            if (this._blockedLinkKeys.has(key)) return false;

            if (!(node.blockedNeighbors instanceof Map)) {
                node.blockedNeighbors = new Map();
            }
            if (!node.blockedNeighbors.has(dir)) {
                node.blockedNeighbors.set(dir, new Set());
            }
            node.blockedNeighbors.get(dir).add(blocker);
            this.blockedLinks.push({ node, direction: dir, blocker });
            this._blockedLinkKeys.add(key);
            // Wall edge added — update clearance for large-entity pathfinding.
            if (typeof globalThis !== "undefined" && globalThis.map &&
                !globalThis.map._suppressClearanceUpdates &&
                typeof globalThis.map.updateClearanceAround === "function") {
                globalThis.map.updateClearanceAround(node);
            }
            return true;
        }

        _blockConnectionBetween(nodeA, nodeB, blockedConnectionKeySet, blockedConnectionsOut, blocker = this) {
            if (!WallSectionUnit._isMapNode(nodeA) || !WallSectionUnit._isMapNode(nodeB)) return false;
            if (!Array.isArray(nodeA.neighbors) || !Array.isArray(nodeB.neighbors)) return false;

            const dirA = nodeA.neighbors.indexOf(nodeB);
            const dirB = nodeB.neighbors.indexOf(nodeA);
            if (dirA < 0 && dirB < 0) return false;

            let changed = false;
            if (dirA >= 0) changed = this._addBlockedLink(nodeA, dirA, blocker) || changed;
            if (dirB >= 0) changed = this._addBlockedLink(nodeB, dirB, blocker) || changed;

            if (changed && blockedConnectionKeySet instanceof Set && Array.isArray(blockedConnectionsOut)) {
                const keyA = this._nodeKey(nodeA);
                const keyB = this._nodeKey(nodeB);
                if (keyA && keyB) {
                    const edgeKey = (keyA <= keyB) ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
                    if (!blockedConnectionKeySet.has(edgeKey)) {
                        blockedConnectionKeySet.add(edgeKey);
                        blockedConnectionsOut.push({ a: nodeA, b: nodeB, blocker });
                    }
                }
            }

            return changed;
        }

        _getConnectionWallIntersectionT(nodeA, nodeB) {
            const mapRef = this.map || null;
            const origin = this.startPoint;
            const wallStart = this._toLocalFromOrigin(origin, this.startPoint, mapRef);
            const wallEnd = this._toLocalFromOrigin(origin, this.endPoint, mapRef);
            const segStart = this._toLocalFromOrigin(origin, nodeA, mapRef);
            const segEnd = this._toLocalFromOrigin(origin, nodeB, mapRef);
            if (!wallStart || !wallEnd || !segStart || !segEnd) return null;

            const rx = wallEnd.x - wallStart.x;
            const ry = wallEnd.y - wallStart.y;
            const sx = segEnd.x - segStart.x;
            const sy = segEnd.y - segStart.y;
            const denom = (rx * sy) - (ry * sx);
            if (Math.abs(denom) <= EPS) return null;

            const qpx = segStart.x - wallStart.x;
            const qpy = segStart.y - wallStart.y;
            const t = ((qpx * sy) - (qpy * sx)) / denom;
            const u = ((qpx * ry) - (qpy * rx)) / denom;
            if (u < -EPS || u > 1 + EPS) return null;
            return t;
        }

        _collectMountedDoorTraversalSpans() {
            const out = [];
            const mapRef = this.map || null;
            const sx = Number(this.startPoint && this.startPoint.x);
            const sy = Number(this.startPoint && this.startPoint.y);
            const ex = Number(this.endPoint && this.endPoint.x);
            const ey = Number(this.endPoint && this.endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) {
                return out;
            }

            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(sx, ex)
                : (ex - sx);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(sy, ey)
                : (ey - sy);
            const wallLen = Math.hypot(dx, dy);
            if (!(wallLen > EPS)) return out;
            const ux = dx / wallLen;
            const uy = dy / wallLen;

            const attachments = Array.isArray(this.attachedObjects) ? this.attachedObjects : [];
            for (let i = 0; i < attachments.length; i++) {
                const entry = attachments[i];
                const door = entry && entry.object;
                if (!this._isDoorOrWindowObject(door)) continue;
                const category = (typeof door.category === "string") ? door.category.trim().toLowerCase() : "";
                const type = (typeof door.type === "string") ? door.type.trim().toLowerCase() : "";
                if (category !== "doors" && type !== "door") continue;

                const doorX = Number(door.x);
                const doorY = Number(door.y);
                const doorWidth = Math.max(0.01, Number.isFinite(door.width) ? Number(door.width) : 1);
                const traversalWidth = Math.max(0.01, doorWidth * 0.63);
                const anchorX = Number.isFinite(door.placeableAnchorX) ? Number(door.placeableAnchorX) : 0.5;
                if (!Number.isFinite(doorX) || !Number.isFinite(doorY)) continue;

                const centerX = doorX - ux * ((anchorX - 0.5) * doorWidth);
                const centerY = doorY - uy * ((anchorX - 0.5) * doorWidth);
                const relX = (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(sx, centerX)
                    : (centerX - sx);
                const relY = (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(sy, centerY)
                    : (centerY - sy);
                const centerT = ((relX * ux) + (relY * uy)) / wallLen;
                const halfT = (traversalWidth * 0.5) / wallLen;
                const padT = Math.max(0.0001, 0.05 / wallLen);
                const isOpenDoor = !!(door.isOpen || door._doorLockedOpen || door.isFallenDoorEffect);
                out.push({
                    startT: centerT - halfT - padT,
                    endT: centerT + halfT + padT,
                    blocker: (isOpenDoor || door.falling || (Number.isFinite(door.hp) && Number(door.hp) <= 0)) ? null : door
                });
            }

            return out;
        }

        _resolveDirectionalBlockerForConnection(nodeA, nodeB, doorSpans = null) {
            const intersectionT = this._getConnectionWallIntersectionT(nodeA, nodeB);
            const spans = Array.isArray(doorSpans) ? doorSpans : this._collectMountedDoorTraversalSpans();
            if (Number.isFinite(intersectionT) && spans.length > 0) {
                for (let i = 0; i < spans.length; i++) {
                    const span = spans[i];
                    if (!span) continue;
                    const startT = Math.min(Number(span.startT), Number(span.endT));
                    const endT = Math.max(Number(span.startT), Number(span.endT));
                    if (intersectionT < startT || intersectionT > endT) continue;
                    return span.blocker || null;
                }
            }
            return this;
        }

        rebuildDirectionalBlocking() {
            if (this.gone) {
                this._clearDirectionalBlocks();
                return;
            }
            this._applyDirectionalBlocking();
        }

        _toLocalFromOrigin(origin, point, mapRef) {
            if (!origin || !point) return null;
            const ox = Number(origin.x);
            const oy = Number(origin.y);
            const px = Number(point.x);
            const py = Number(point.y);
            if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(px) || !Number.isFinite(py)) return null;
            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(ox, px) : (px - ox);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(oy, py) : (py - oy);
            return { x: dx, y: dy };
        }

        // Returns true when the connection between nodeA and nodeB crosses either
        // physical face of this wall (the two lines offset ±halfThickness from the
        // centerline in the perpendicular direction).
        _connectionCrossesEitherFace(nodeA, nodeB) {
            const mapRef = this.map || null;
            const origin = this.startPoint;
            const wallStart = this._toLocalFromOrigin(origin, this.startPoint, mapRef);
            const wallEnd   = this._toLocalFromOrigin(origin, this.endPoint,   mapRef);
            const segStart  = this._toLocalFromOrigin(origin, nodeA, mapRef);
            const segEnd    = this._toLocalFromOrigin(origin, nodeB, mapRef);
            if (!wallStart || !wallEnd || !segStart || !segEnd) return false;

            const wx = wallEnd.x - wallStart.x;
            const wy = wallEnd.y - wallStart.y;
            const wallLen = Math.hypot(wx, wy);
            const segLen  = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y);
            if (!(wallLen > EPS) || !(segLen > EPS)) return false;

            // Wall axis unit vector and perpendicular.
            const ux = wx / wallLen;
            const uy = wy / wallLen;
            const px = -uy;   // perp pointing "left" of wall direction
            const py =  ux;

            const halfT = Math.max(EPS, (Number.isFinite(this.thickness) ? Number(this.thickness) : 0.1) * 0.5);

            // Extend endpoints slightly so face lines reach the hex edge at each end.
            const halfHexToEdge = (mapRef && Number.isFinite(mapRef.hexHeight))
                ? (Number(mapRef.hexHeight) * 0.5)
                : 0.5;
            const extend = halfHexToEdge + 0.001;

            const testFace = (sign) => {
                const offX = px * sign * halfT;
                const offY = py * sign * halfT;
                const faceStart = { x: wallStart.x + offX - ux * extend, y: wallStart.y + offY - uy * extend };
                const faceEnd   = { x: wallEnd.x   + offX + ux * extend, y: wallEnd.y   + offY + uy * extend };
                return WallSectionUnit._segmentsIntersect2D(faceStart, faceEnd, segStart, segEnd, EPS);
            };

            return testFace(+1) || testFace(-1);
        }

        _collectCenterlineMapNodes() {
            const orderedAnchors = this._collectOrderedLineAnchors();
            if (!Array.isArray(orderedAnchors) || orderedAnchors.length === 0) return [];

            const out = [];
            const seen = new Set();
            for (let i = 0; i < orderedAnchors.length; i++) {
                const item = orderedAnchors[i] && orderedAnchors[i].anchor;
                if (!WallSectionUnit._isMapNode(item)) continue;
                const key = this._nodeKey(item);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                out.push(item);
            }
            return out;
        }

        _collectDirectionalBlockingTouchedNodes() {
            const orderedAnchors = this._collectOrderedLineAnchors();
            const out = [];
            const seen = new Set();
            const pushNode = (node) => {
                if (!WallSectionUnit._isMapNode(node)) return;
                const key = this._nodeKey(node);
                if (!key || seen.has(key)) return;
                seen.add(key);
                out.push(node);
            };
            const pushAnchorNodes = (anchor) => {
                if (WallSectionUnit._isMapNode(anchor)) {
                    pushNode(anchor);
                    return;
                }
                if (!WallSectionUnit._isNodeMidpoint(anchor)) return;
                pushNode(anchor.nodeA);
                pushNode(anchor.nodeB);
            };

            for (let i = 0; i < orderedAnchors.length; i++) {
                const anchor = orderedAnchors[i] && orderedAnchors[i].anchor;
                if (!anchor) continue;
                pushAnchorNodes(anchor);
            }

            if (out.length === 0) {
                pushAnchorNodes(this.startPoint);
                pushAnchorNodes(this.endPoint);
            }

            return out;
        }

        _isOddAdjacentHexPair(nodeA, nodeB) {
            if (!WallSectionUnit._isMapNode(nodeA) || !WallSectionUnit._isMapNode(nodeB)) return false;
            if (!Array.isArray(nodeA.neighbors) || !Array.isArray(nodeB.neighbors)) return false;
            const dirA = nodeA.neighbors.indexOf(nodeB);
            const dirB = nodeB.neighbors.indexOf(nodeA);
            return dirA >= 0 && dirB >= 0 && (dirA % 2 === 1) && (dirB % 2 === 1);
        }

        _collectOddNeighborsOfNode(node, outMap) {
            if (!WallSectionUnit._isMapNode(node) || !(outMap instanceof Map)) return;
            if (!Array.isArray(node.neighbors)) return;
            for (let d = 0; d < 12; d++) {
                const neighbor = node.neighbors[d];
                if (!WallSectionUnit._isMapNode(neighbor)) continue;
                const key = this._nodeKey(neighbor);
                if (!key || outMap.has(key)) continue;
                outMap.set(key, neighbor);
            }
        }

        _applyDirectionalBlocking() {
            const timerNow = () => (
                (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                    ? performance.now()
                    : Date.now()
            );
            const applyStart = timerNow();
            this._clearDirectionalBlocks();
            const clearMs = timerNow() - applyStart;

            const collectStart = timerNow();
            const centerlineNodes = this._collectCenterlineMapNodes();
            const touchedNodes = this._collectDirectionalBlockingTouchedNodes();
            const collectMs = timerNow() - collectStart;
            if (touchedNodes.length === 0) return;

            const centerlineNodeKeySet = new Set(centerlineNodes.map(node => this._nodeKey(node)));
            const oddNeighborsAll = new Map();
            const blockedConnectionKeys = new Set();
            const blockedConnections = [];
            const doorSpans = this._collectMountedDoorTraversalSpans();
            const blockStart = timerNow();

            // Traverse every odd-adjacent pair among the map nodes touched by the
            // wall centerline (including midpoint support nodes). For each such
            // pair, gather the pair plus their odd neighbours and block any local
            // connection that crosses either physical face of the wall body,
            // including diagonal links between those local nodes. This covers
            // midpoint-to-midpoint walls that collapse to a single interior
            // centerline node after midpoint anchors are filtered out.
            for (let i = 0; i < touchedNodes.length; i++) {
                const nodeA = touchedNodes[i];
                if (!nodeA) continue;
                for (let j = i + 1; j < touchedNodes.length; j++) {
                    const nodeB = touchedNodes[j];
                    if (!nodeB || !this._isOddAdjacentHexPair(nodeA, nodeB)) continue;

                    const localNeighbors = new Map();
                    localNeighbors.set(this._nodeKey(nodeA), nodeA);
                    localNeighbors.set(this._nodeKey(nodeB), nodeB);
                    this._collectOddNeighborsOfNode(nodeA, localNeighbors);
                    this._collectOddNeighborsOfNode(nodeB, localNeighbors);

                    localNeighbors.forEach((neighborNode, keyA) => {
                        if (!neighborNode || !Array.isArray(neighborNode.neighbors)) return;
                        for (let dir = 0; dir < 12; dir++) {
                            const other = neighborNode.neighbors[dir];
                            if (!WallSectionUnit._isMapNode(other)) continue;
                            const keyB = this._nodeKey(other);
                            if (!keyB || !localNeighbors.has(keyB)) continue;
                            if (keyA >= keyB) continue;
                            if (!this._connectionCrossesEitherFace(neighborNode, other)) continue;
                            const blocker = this._resolveDirectionalBlockerForConnection(neighborNode, other, doorSpans);
                            if (!blocker) continue;
                            this._blockConnectionBetween(neighborNode, other, blockedConnectionKeys, blockedConnections, blocker);
                        }
                    });

                    this._collectOddNeighborsOfNode(nodeA, oddNeighborsAll);
                    this._collectOddNeighborsOfNode(nodeB, oddNeighborsAll);
                }
            }
            const blockMs = timerNow() - blockStart;

            const oddNeighborNodes = [];
            oddNeighborsAll.forEach((node, key) => {
                if (!centerlineNodeKeySet.has(key)) {
                    oddNeighborNodes.push(node);
                }
            });

            this._directionalBlockingDebug = {
                centerlineNodes,
                oddNeighborNodes,
                blockedConnections
            };
            this._lastDirectionalBlockingStats = {
                ms: Number((timerNow() - applyStart).toFixed(2)),
                clearMs: Number(clearMs.toFixed(2)),
                collectMs: Number(collectMs.toFixed(2)),
                blockMs: Number(blockMs.toFixed(2)),
                centerlineNodeCount: centerlineNodes.length,
                touchedNodeCount: touchedNodes.length,
                oddNeighborCount: oddNeighborNodes.length,
                blockedConnectionCount: blockedConnections.length,
                blockedLinkCount: Array.isArray(this.blockedLinks) ? this.blockedLinks.length : 0
            };
        }

        removeFromMapNodes() {
            this._clearDirectionalBlocks();
            for (let i = 0; i < this.nodes.length; i++) {
                const node = this.nodes[i];
                if (node && typeof node.removeObject === "function") {
                    node.removeObject(this);
                }
            }
            this.nodes = [];
        }

        _buildVanishChunkSplitPlan(vanishPoint, removeWidthWorld = 1) {
            if (!this.map || !this.startPoint || !this.endPoint) return null;
            if (!vanishPoint || !Number.isFinite(vanishPoint.x) || !Number.isFinite(vanishPoint.y)) return null;

            const mapRef = this.map;
            const sx = Number(this.startPoint.x);
            const sy = Number(this.startPoint.y);
            const ex = Number(this.endPoint.x);
            const ey = Number(this.endPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) return null;

            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(sx, ex) : (ex - sx);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(sy, ey) : (ey - sy);
            const len = Math.hypot(dx, dy);
            if (!(len > EPS)) return null;

            const px = Number(vanishPoint.x);
            const py = Number(vanishPoint.y);
            const vx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(sx, px) : (px - sx);
            const vy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(sy, py) : (py - sy);
            const tCenter = Math.max(0, Math.min(1, (vx * dx + vy * dy) / Math.max(EPS, dx * dx + dy * dy)));

            const halfWidth = Math.max(0.05, Number(removeWidthWorld) * 0.5);
            const tRadius = Math.max(0.0001, halfWidth / len);
            let tStart = Math.max(0, tCenter - tRadius);
            let tEnd = Math.min(1, tCenter + tRadius);
            if ((tEnd - tStart) <= 1e-4) return null;

            const anchors = this._collectOrderedLineAnchors();
            if (!Array.isArray(anchors) || anchors.length < 2) return null;

            let startIdx = -1;
            for (let i = 0; i < anchors.length; i++) {
                if (anchors[i].t <= (tStart + 1e-6)) {
                    startIdx = i;
                } else {
                    break;
                }
            }
            if (startIdx < 0) startIdx = 0;

            let endIdx = anchors.length - 1;
            for (let i = 0; i < anchors.length; i++) {
                if (anchors[i].t >= (tEnd - 1e-6)) {
                    endIdx = i;
                    break;
                }
            }

            if (endIdx <= startIdx) {
                let centerIdx = 0;
                let bestDist = Infinity;
                for (let i = 0; i < anchors.length; i++) {
                    const dist = Math.abs(anchors[i].t - tCenter);
                    if (dist < bestDist) {
                        bestDist = dist;
                        centerIdx = i;
                    }
                }
                startIdx = Math.max(0, centerIdx - 1);
                endIdx = Math.min(anchors.length - 1, centerIdx + 1);
                if (endIdx <= startIdx) return null;
            }

            const cutStartAnchor = anchors[startIdx].anchor;
            const cutEndAnchor = anchors[endIdx].anchor;
            tStart = anchors[startIdx].t;
            tEnd = anchors[endIdx].t;
            if (!cutStartAnchor || !cutEndAnchor) return null;
            if ((tEnd - tStart) <= 1e-6) return null;

            return {
                tStart,
                tEnd,
                cutStartAnchor,
                cutEndAnchor
            };
        }

        getVanishChunkSplitPlan(vanishPoint, options = {}) {
            const removeWidthWorld = Number.isFinite(options && options.removeWidthWorld)
                ? Math.max(0.05, Number(options.removeWidthWorld))
                : 1;
            return this._buildVanishChunkSplitPlan(vanishPoint, removeWidthWorld);
        }

        splitIntoTargetableVanishSegments(rangeOptions = {}, options = {}) {
            if (!this.map || this.gone || !this.startPoint || !this.endPoint) return null;

            const anchors = this._collectOrderedLineAnchors();
            if (!Array.isArray(anchors) || anchors.length < 2) return null;

            let tStartRaw = Number(rangeOptions.tStart);
            let tEndRaw = Number(rangeOptions.tEnd);
            if (!Number.isFinite(tStartRaw) || !Number.isFinite(tEndRaw)) {
                if (rangeOptions && rangeOptions.pointA && rangeOptions.pointB) {
                    const ta = this._parameterForWorldPointOnSection(rangeOptions.pointA);
                    const tb = this._parameterForWorldPointOnSection(rangeOptions.pointB);
                    if (Number.isFinite(ta) && Number.isFinite(tb)) {
                        tStartRaw = Math.min(ta, tb);
                        tEndRaw = Math.max(ta, tb);
                    }
                }
            }
            if (!Number.isFinite(tStartRaw) || !Number.isFinite(tEndRaw)) return null;

            const tStartTarget = Math.max(0, Math.min(1, Math.min(tStartRaw, tEndRaw)));
            const tEndTarget = Math.max(0, Math.min(1, Math.max(tStartRaw, tEndRaw)));
            if ((tEndTarget - tStartTarget) <= 1e-6) return null;

            let startIdx = -1;
            for (let i = 0; i < anchors.length; i++) {
                if (anchors[i].t <= (tStartTarget + 1e-6)) {
                    startIdx = i;
                } else {
                    break;
                }
            }
            if (startIdx < 0) startIdx = 0;

            let endIdx = anchors.length - 1;
            for (let i = 0; i < anchors.length; i++) {
                if (anchors[i].t >= (tEndTarget - 1e-6)) {
                    endIdx = i;
                    break;
                }
            }

            if (endIdx <= startIdx) {
                const fallbackEnd = Math.min(anchors.length - 1, startIdx + 1);
                if (fallbackEnd <= startIdx) return null;
                endIdx = fallbackEnd;
            }

            const targetSegmentLength = Number.isFinite(options.targetSegmentLengthWorld)
                ? Math.max(0.25, Number(options.targetSegmentLengthWorld))
                : 1;

            const mapRef = this.map || null;
            const distanceBetweenAnchors = (a, b) => {
                if (!a || !b) return 0;
                const ax = Number(a.x);
                const ay = Number(a.y);
                const bx = Number(b.x);
                const by = Number(b.y);
                if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
                    return 0;
                }
                const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(ax, bx)
                    : (bx - ax);
                const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(ay, by)
                    : (by - ay);
                return Math.hypot(dx, dy);
            };

            let totalTargetLength = 0;
            for (let i = startIdx; i < endIdx; i++) {
                totalTargetLength += distanceBetweenAnchors(anchors[i].anchor, anchors[i + 1].anchor);
            }

            const atomicIntervalCount = Math.max(1, endIdx - startIdx);
            const desiredTargetCount = Math.max(1, Math.ceil(totalTargetLength / Math.max(0.0001, targetSegmentLength)));
            const targetCount = Math.max(1, Math.min(atomicIntervalCount, desiredTargetCount));

            const targetSpecs = [];
            let previousBoundary = startIdx;
            for (let part = 1; part <= targetCount; part++) {
                let nextBoundary = Math.round(startIdx + ((endIdx - startIdx) * part) / targetCount);
                nextBoundary = Math.max(previousBoundary + 1, Math.min(endIdx, nextBoundary));

                const startAnchor = anchors[previousBoundary] && anchors[previousBoundary].anchor;
                const endAnchor = anchors[nextBoundary] && anchors[nextBoundary].anchor;
                if (startAnchor && endAnchor && !WallSectionUnit._pointsMatch(startAnchor, endAnchor)) {
                    targetSpecs.push({
                        kind: "target",
                        startAnchor,
                        endAnchor,
                        tStart: anchors[previousBoundary].t,
                        tEnd: anchors[nextBoundary].t
                    });
                }
                previousBoundary = nextBoundary;
            }

            if (targetSpecs.length === 0) return null;

            const allSpecs = [];
            const targetStartAnchor = anchors[startIdx] && anchors[startIdx].anchor;
            const targetEndAnchor = anchors[endIdx] && anchors[endIdx].anchor;
            if (
                targetStartAnchor &&
                !WallSectionUnit._pointsMatch(this.startPoint, targetStartAnchor)
            ) {
                allSpecs.push({
                    kind: "preserve",
                    startAnchor: this.startPoint,
                    endAnchor: targetStartAnchor,
                    tStart: 0,
                    tEnd: anchors[startIdx].t
                });
            }
            for (let i = 0; i < targetSpecs.length; i++) {
                allSpecs.push(targetSpecs[i]);
            }
            if (
                targetEndAnchor &&
                !WallSectionUnit._pointsMatch(targetEndAnchor, this.endPoint)
            ) {
                allSpecs.push({
                    kind: "preserve",
                    startAnchor: targetEndAnchor,
                    endAnchor: this.endPoint,
                    tStart: anchors[endIdx].t,
                    tEnd: 1
                });
            }

            const sectionOptions = {
                map: this.map,
                height: Number(this.height),
                thickness: Number(this.thickness),
                bottomZ: Number(this.bottomZ),
                wallTexturePath: this.wallTexturePath,
                texturePhaseA: this.texturePhaseA,
                texturePhaseB: this.texturePhaseB
            };

            const createdSections = [];
            const tryCreateSection = (spec) => {
                if (!spec || !spec.startAnchor || !spec.endAnchor) return null;
                if (WallSectionUnit._pointsMatch(spec.startAnchor, spec.endAnchor)) return null;
                let section = null;
                try {
                    section = new WallSectionUnit(spec.startAnchor, spec.endAnchor, sectionOptions);
                } catch (_err) {
                    section = null;
                }
                if (!section) return null;
                section.rebuildMesh3d();
                section.addToMapNodes();
                if (spec.kind === "target") {
                    section._vanishAsWholeSection = true;
                    section._disableChunkSplitOnVanish = true;
                }
                createdSections.push({
                    section,
                    kind: spec.kind,
                    tStart: Number(spec.tStart),
                    tEnd: Number(spec.tEnd)
                });
                return section;
            };

            for (let i = 0; i < allSpecs.length; i++) {
                tryCreateSection(allSpecs[i]);
            }

            if (createdSections.length === 0) return null;

            const distanceToSection = (section, obj) => {
                if (!section || !obj || !section.startPoint || !section.endPoint) return Infinity;
                const sx = Number(section.startPoint.x);
                const sy = Number(section.startPoint.y);
                const ex = Number(section.endPoint.x);
                const ey = Number(section.endPoint.y);
                const px = Number(obj.x);
                const py = Number(obj.y);
                if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey) || !Number.isFinite(px) || !Number.isFinite(py)) {
                    return Infinity;
                }
                const dx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(sx, ex) : (ex - sx);
                const dy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(sy, ey) : (ey - sy);
                const vx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(sx, px) : (px - sx);
                const vy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(sy, py) : (py - sy);
                const lenSq = dx * dx + dy * dy;
                if (!(lenSq > EPS)) return Infinity;
                const t = Math.max(0, Math.min(1, (vx * dx + vy * dy) / lenSq));
                const cx = sx + dx * t;
                const cy = sy + dy * t;
                const ox = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(cx, px) : (px - cx);
                const oy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(cy, py) : (py - cy);
                return Math.hypot(ox, oy);
            };

            const usedObjects = new Set();
            const attachmentEntries = Array.isArray(this.attachedObjects) ? this.attachedObjects.slice() : [];
            const rangeEps = 1e-4;
            for (let i = 0; i < attachmentEntries.length; i++) {
                const entry = attachmentEntries[i];
                const obj = entry && entry.object;
                if (!obj || usedObjects.has(obj) || obj.gone) continue;
                const t = this._parameterForWorldPointOnSection(obj);
                if (!Number.isFinite(t)) continue;

                let candidates = createdSections.filter(row => (
                    Number.isFinite(row.tStart) &&
                    Number.isFinite(row.tEnd) &&
                    t >= (row.tStart - rangeEps) &&
                    t <= (row.tEnd + rangeEps)
                ));
                if (candidates.length === 0) {
                    candidates = createdSections.slice();
                }

                let bestRow = null;
                let bestDist = Infinity;
                for (let c = 0; c < candidates.length; c++) {
                    const row = candidates[c];
                    if (!row || !row.section) continue;
                    const dist = distanceToSection(row.section, obj);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestRow = row;
                    }
                }

                if (bestRow && bestRow.section && typeof bestRow.section.attachObject === "function") {
                    bestRow.section.attachObject(obj, {
                        direction: Number.isFinite(entry.direction) ? Number(entry.direction) : bestRow.section.direction,
                        offsetAlong: Number.isFinite(entry.offsetAlong) ? Number(entry.offsetAlong) : 0
                    });
                    usedObjects.add(obj);
                }
            }

            const neighbors = [];
            for (const payload of this.connections.values()) {
                const section = payload && payload.section;
                if (!section || section === this || section.gone) continue;
                if (neighbors.includes(section)) continue;
                neighbors.push(section);
            }

            this._removeWallPreserving(Array.from(usedObjects));

            const sectionList = createdSections
                .map(row => row.section)
                .filter(section => !!section && !section.gone);

            for (let i = 0; i < sectionList.length; i++) {
                const section = sectionList[i];
                if (!section) continue;
                for (let j = i + 1; j < sectionList.length; j++) {
                    const other = sectionList[j];
                    if (!other || other === section) continue;
                    if (!section.sharesEndpointWith(other)) continue;
                    section.connectTo(other, { splitFromVanish: true, rangeSplit: true });
                    if (typeof other.connectTo === "function") {
                        other.connectTo(section, { splitFromVanish: true, rangeSplit: true });
                    }
                }
            }

            for (let i = 0; i < sectionList.length; i++) {
                const section = sectionList[i];
                if (!section || section.gone) continue;
                for (let n = 0; n < neighbors.length; n++) {
                    const neighbor = neighbors[n];
                    if (!neighbor || neighbor.gone) continue;
                    if (!section.sharesEndpointWith(neighbor)) continue;
                    section.connectTo(neighbor, { splitFromVanish: true, rangeSplit: true });
                    if (typeof neighbor.connectTo === "function") {
                        neighbor.connectTo(section, { splitFromVanish: true, rangeSplit: true });
                    }
                }
            }

            for (let i = 0; i < sectionList.length; i++) {
                const section = sectionList[i];
                if (!section || section.gone) continue;
                if (typeof section.handleJoineryOnPlacement === "function") {
                    section.handleJoineryOnPlacement();
                } else {
                    if (typeof section.rebuildMesh3d === "function") section.rebuildMesh3d();
                    if (typeof section.draw === "function") section.draw();
                }
            }

            const targetSegments = createdSections
                .filter(row => row && row.kind === "target" && row.section && !row.section.gone)
                .map(row => row.section);

            return {
                allSections: sectionList,
                targetSegments
            };
        }

        getVanishPreviewPolygonForRange(rangeOptions = {}) {
            if (!this.map || this.gone || !this.startPoint || !this.endPoint) return null;

            const anchors = this._collectOrderedLineAnchors();
            if (!Array.isArray(anchors) || anchors.length < 2) return null;

            const tStartRaw = Number(rangeOptions.tStart);
            const tEndRaw = Number(rangeOptions.tEnd);
            if (!Number.isFinite(tStartRaw) || !Number.isFinite(tEndRaw)) return null;

            const tStartTarget = Math.max(0, Math.min(1, Math.min(tStartRaw, tEndRaw)));
            const tEndTarget = Math.max(0, Math.min(1, Math.max(tStartRaw, tEndRaw)));
            if ((tEndTarget - tStartTarget) <= 1e-6) return null;

            let startIdx = -1;
            for (let i = 0; i < anchors.length; i++) {
                if (anchors[i].t <= (tStartTarget + 1e-6)) {
                    startIdx = i;
                } else {
                    break;
                }
            }
            if (startIdx < 0) startIdx = 0;

            let endIdx = anchors.length - 1;
            for (let i = 0; i < anchors.length; i++) {
                if (anchors[i].t >= (tEndTarget - 1e-6)) {
                    endIdx = i;
                    break;
                }
            }

            if (endIdx <= startIdx) {
                const fallbackEnd = Math.min(anchors.length - 1, startIdx + 1);
                if (fallbackEnd <= startIdx) return null;
                endIdx = fallbackEnd;
            }

            const startAnchor = anchors[startIdx] && anchors[startIdx].anchor;
            const endAnchor = anchors[endIdx] && anchors[endIdx].anchor;
            if (!startAnchor || !endAnchor || WallSectionUnit._pointsMatch(startAnchor, endAnchor)) return null;

            const mapRef = this.map || null;
            const ax = Number(startAnchor.x);
            const ay = Number(startAnchor.y);
            const bx = Number(endAnchor.x);
            const by = Number(endAnchor.y);
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;

            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(ax, bx) : (bx - ax);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(ay, by) : (by - ay);
            const len = Math.hypot(dx, dy);
            if (!(len > EPS)) return null;

            const ux = dx / len;
            const uy = dy / len;
            const nx = -uy;
            const ny = ux;
            const halfT = Math.max(0.001, Number(this.thickness) || 0.001) * 0.5;
            const z = (Number.isFinite(this.bottomZ) ? Number(this.bottomZ) : 0) + 0.001;

            const offsetPoint = (px, py, sign) => {
                let x = Number(px) + nx * halfT * sign;
                let y = Number(py) + ny * halfT * sign;
                if (mapRef && typeof mapRef.wrapWorldX === "function") x = mapRef.wrapWorldX(x);
                if (mapRef && typeof mapRef.wrapWorldY === "function") y = mapRef.wrapWorldY(y);
                return { x, y };
            };

            const points = [
                offsetPoint(ax, ay, +1),
                offsetPoint(bx, by, +1),
                offsetPoint(bx, by, -1),
                offsetPoint(ax, ay, -1)
            ];

            return {
                points,
                z
            };
        }

        getVanishTargetSegmentCountForRange(rangeOptions = {}, options = {}) {
            if (!this.map || this.gone || !this.startPoint || !this.endPoint) return 0;

            const anchors = this._collectOrderedLineAnchors();
            if (!Array.isArray(anchors) || anchors.length < 2) return 0;

            const tStartRaw = Number(rangeOptions.tStart);
            const tEndRaw = Number(rangeOptions.tEnd);
            if (!Number.isFinite(tStartRaw) || !Number.isFinite(tEndRaw)) return 0;

            const tStartTarget = Math.max(0, Math.min(1, Math.min(tStartRaw, tEndRaw)));
            const tEndTarget = Math.max(0, Math.min(1, Math.max(tStartRaw, tEndRaw)));
            if ((tEndTarget - tStartTarget) <= 1e-6) return 0;

            let startIdx = -1;
            for (let i = 0; i < anchors.length; i++) {
                if (anchors[i].t <= (tStartTarget + 1e-6)) {
                    startIdx = i;
                } else {
                    break;
                }
            }
            if (startIdx < 0) startIdx = 0;

            let endIdx = anchors.length - 1;
            for (let i = 0; i < anchors.length; i++) {
                if (anchors[i].t >= (tEndTarget - 1e-6)) {
                    endIdx = i;
                    break;
                }
            }

            if (endIdx <= startIdx) {
                const fallbackEnd = Math.min(anchors.length - 1, startIdx + 1);
                if (fallbackEnd <= startIdx) return 0;
                endIdx = fallbackEnd;
            }

            const targetSegmentLength = Number.isFinite(options.targetSegmentLengthWorld)
                ? Math.max(0.25, Number(options.targetSegmentLengthWorld))
                : 1;
            const mapRef = this.map || null;
            const distanceBetweenAnchors = (a, b) => {
                if (!a || !b) return 0;
                const ax = Number(a.x);
                const ay = Number(a.y);
                const bx = Number(b.x);
                const by = Number(b.y);
                if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
                    return 0;
                }
                const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(ax, bx)
                    : (bx - ax);
                const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(ay, by)
                    : (by - ay);
                return Math.hypot(dx, dy);
            };

            let totalTargetLength = 0;
            for (let i = startIdx; i < endIdx; i++) {
                totalTargetLength += distanceBetweenAnchors(anchors[i].anchor, anchors[i + 1].anchor);
            }

            const atomicIntervalCount = Math.max(1, endIdx - startIdx);
            const desiredTargetCount = Math.max(1, Math.ceil(totalTargetLength / Math.max(0.0001, targetSegmentLength)));
            return Math.max(1, Math.min(atomicIntervalCount, desiredTargetCount));
        }

        getVanishPreviewPolygon(vanishPoint, options = {}) {
            const plan = this.getVanishChunkSplitPlan(vanishPoint, options);
            if (!plan || !plan.cutStartAnchor || !plan.cutEndAnchor) return null;

            const mapRef = this.map || null;
            const ax = Number(plan.cutStartAnchor.x);
            const ay = Number(plan.cutStartAnchor.y);
            const bx = Number(plan.cutEndAnchor.x);
            const by = Number(plan.cutEndAnchor.y);
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;

            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(ax, bx) : (bx - ax);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(ay, by) : (by - ay);
            const len = Math.hypot(dx, dy);
            if (!(len > EPS)) return null;

            const ux = dx / len;
            const uy = dy / len;
            const nx = -uy;
            const ny = ux;
            const halfT = Math.max(0.001, Number(this.thickness) || 0.001) * 0.5;
            const z = (Number.isFinite(this.bottomZ) ? Number(this.bottomZ) : 0) + 0.001;

            const offsetPoint = (px, py, sign) => {
                let x = Number(px) + nx * halfT * sign;
                let y = Number(py) + ny * halfT * sign;
                if (mapRef && typeof mapRef.wrapWorldX === "function") x = mapRef.wrapWorldX(x);
                if (mapRef && typeof mapRef.wrapWorldY === "function") y = mapRef.wrapWorldY(y);
                return { x, y };
            };

            const points = [
                offsetPoint(ax, ay, +1),
                offsetPoint(bx, by, +1),
                offsetPoint(bx, by, -1),
                offsetPoint(ax, ay, -1)
            ];

            return {
                plan,
                points,
                z
            };
        }

        _parameterForWorldPointOnSection(worldPoint) {
            if (!worldPoint || !this.startPoint || !this.endPoint) return null;
            const mapRef = this.map || null;
            const sx = Number(this.startPoint.x);
            const sy = Number(this.startPoint.y);
            const ex = Number(this.endPoint.x);
            const ey = Number(this.endPoint.y);
            const px = Number(worldPoint.x);
            const py = Number(worldPoint.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey) || !Number.isFinite(px) || !Number.isFinite(py)) {
                return null;
            }
            const dx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(sx, ex) : (ex - sx);
            const dy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(sy, ey) : (ey - sy);
            const lenSq = dx * dx + dy * dy;
            if (!(lenSq > EPS)) return null;
            const vx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(sx, px) : (px - sx);
            const vy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(sy, py) : (py - sy);
            return (vx * dx + vy * dy) / lenSq;
        }

        _collectOrderedLineAnchors() {
            const mapRef = this.map || null;
            const start = this.startPoint;
            const end = this.endPoint;
            if (!mapRef || !start || !end || typeof mapRef.getHexLine !== "function") return [];

            const tryCollectByCanonicalStepping = () => {
                if (typeof anchorNeighborInDirection !== "function") return null;

                const direction = WallSectionUnit._normalizeDirection(
                    Number.isFinite(this.direction)
                        ? Number(this.direction)
                        : WallSectionUnit._directionBetweenEndpoints(start, end, mapRef)
                );
                const endKey = WallSectionUnit.endpointKey(end);
                if (!endKey) return null;

                const anchors = [];
                const seen = new Set();
                const pushAnchor = (anchor) => {
                    if (!(WallSectionUnit._isMapNode(anchor) || WallSectionUnit._isNodeMidpoint(anchor))) return null;
                    const key = WallSectionUnit.endpointKey(anchor);
                    if (!key || seen.has(key)) return null;
                    const tRaw = this._parameterForWorldPointOnSection(anchor);
                    if (!Number.isFinite(tRaw)) return null;
                    const entry = {
                        anchor,
                        t: Math.max(0, Math.min(1, Number(tRaw))),
                        key,
                        isEndpoint: (key === WallSectionUnit.endpointKey(start)) || (key === endKey)
                    };
                    seen.add(key);
                    anchors.push(entry);
                    return entry;
                };

                let lastEntry = pushAnchor(start);
                if (!lastEntry) return null;
                if (lastEntry.key === endKey) return anchors;

                const estimatedSteps = Number.isFinite(this.length)
                    ? Math.max(16, Math.min(512, Math.ceil(Number(this.length) / 0.25) + 16))
                    : 128;
                let current = start;
                for (let i = 0; i < estimatedSteps; i++) {
                    const next = anchorNeighborInDirection(current, direction);
                    if (!next) return null;
                    const nextEntry = pushAnchor(next);
                    if (!nextEntry) return null;
                    if (nextEntry.t < (lastEntry.t - 1e-6)) return null;
                    current = next;
                    lastEntry = nextEntry;
                    if (nextEntry.key === endKey) {
                        return anchors;
                    }
                }

                return null;
            };

            const steppedAnchors = tryCollectByCanonicalStepping();
            if (Array.isArray(steppedAnchors) && steppedAnchors.length >= 2) {
                return steppedAnchors;
            }

            // Precompute wall centerline for projecting anchor positions on-line.
            // getHexLine returns "bridge nodes" for midpoint endpoints — those nodes
            // are adjacent hex nodes that lie OFF the wall's geometric axis rather than
            // on it. Projecting each anchor's t-value back onto the centerline and
            // re-snapping via worldToNodeOrMidpoint finds the actual on-line grid
            // entity, fixing misaligned selection highlights and post-vanish segment
            // jumping for midpoint-to-midpoint walls.
            const wallSx = Number(start.x);
            const wallSy = Number(start.y);
            const wallDx = (typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(wallSx, Number(end.x)) : (Number(end.x) - wallSx);
            const wallDy = (typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(wallSy, Number(end.y)) : (Number(end.y) - wallSy);
            const wallLen = Math.hypot(wallDx, wallDy);

            const line = mapRef.getHexLine(start, end, 0);
            if (!Array.isArray(line) || line.length === 0) return [];

            const anchors = [];
            const seen = new Set();
            const pushAnchor = (anchor) => {
                if (!anchor) return;
                const tRaw = this._parameterForWorldPointOnSection(anchor);
                if (!Number.isFinite(tRaw)) return;
                const t = Math.max(0, Math.min(1, Number(tRaw)));

                // Project the anchor's t-position onto the wall centerline and re-snap
                // to the nearest grid entity. For node-to-node walls this is a no-op
                // (the entity snaps back to itself). For midpoint-endpoint walls this
                // replaces off-axis bridge nodes with the correct on-line entity.
                let resolvedAnchor = anchor;
                if (wallLen > EPS && typeof mapRef.worldToNodeOrMidpoint === "function") {
                    let projX = wallSx + wallDx * t;
                    let projY = wallSy + wallDy * t;
                    if (typeof mapRef.wrapWorldX === "function") projX = mapRef.wrapWorldX(projX);
                    if (typeof mapRef.wrapWorldY === "function") projY = mapRef.wrapWorldY(projY);
                    const snapped = mapRef.worldToNodeOrMidpoint(projX, projY);
                    if (snapped && (WallSectionUnit._isMapNode(snapped) || WallSectionUnit._isNodeMidpoint(snapped))) {
                        resolvedAnchor = snapped;
                    }
                }

                const key = WallSectionUnit.endpointKey(resolvedAnchor);
                if (!key || seen.has(key)) return;
                seen.add(key);
                anchors.push({
                    anchor: resolvedAnchor,
                    t,
                    key,
                    isEndpoint: WallSectionUnit._pointsMatch(resolvedAnchor, start) || WallSectionUnit._pointsMatch(resolvedAnchor, end)
                });
            };

            pushAnchor(start);
            for (let i = 0; i < line.length; i++) {
                const item = line[i];
                if (WallSectionUnit._isMapNode(item) || WallSectionUnit._isNodeMidpoint(item)) {
                    pushAnchor(item);
                }
                if (i >= (line.length - 1)) continue;

                const a = line[i];
                const b = line[i + 1];
                if (!WallSectionUnit._isMapNode(a) || !WallSectionUnit._isMapNode(b)) continue;

                const dx = (typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(a.x, b.x) : (b.x - a.x);
                const dy = (typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(a.y, b.y) : (b.y - a.y);
                let midX = Number(a.x) + dx * 0.5;
                let midY = Number(a.y) + dy * 0.5;
                if (typeof mapRef.wrapWorldX === "function") midX = mapRef.wrapWorldX(midX);
                if (typeof mapRef.wrapWorldY === "function") midY = mapRef.wrapWorldY(midY);

                const midpoint = (typeof mapRef.worldToNodeOrMidpoint === "function")
                    ? mapRef.worldToNodeOrMidpoint(midX, midY)
                    : null;
                if (midpoint && WallSectionUnit._isNodeMidpoint(midpoint)) {
                    pushAnchor(midpoint);
                }
            }
            pushAnchor(end);

            if (anchors.length === 0) return [];
            anchors.sort((left, right) => {
                const dt = left.t - right.t;
                if (Math.abs(dt) > 1e-7) return dt;
                if (left.isEndpoint && !right.isEndpoint) return -1;
                if (!left.isEndpoint && right.isEndpoint) return 1;
                return left.key.localeCompare(right.key);
            });

            return anchors;
        }

        getWallPositionAtScreenPoint(screenX, screenY, options = {}) {
            if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
            if (!this.startPoint || !this.endPoint) return null;

            const worldToScreenFn = (typeof options.worldToScreenFn === "function")
                ? options.worldToScreenFn
                : ((typeof globalScope.worldToScreen === "function") ? globalScope.worldToScreen : null);
            const vs = Number.isFinite(options.viewscale)
                ? Number(options.viewscale)
                : (Number.isFinite(globalScope.viewscale) ? Number(globalScope.viewscale) : 1);
            const xyr = Number.isFinite(options.xyratio)
                ? Number(options.xyratio)
                : (Number.isFinite(globalScope.xyratio) ? Number(globalScope.xyratio) : 0.66);
            const dir = WallSectionUnit._normalizeDirection(
                Number.isFinite(this.direction) ? Number(this.direction) : 0
            );
            const isVertical = (dir === 3 || dir === 9);

            let t = null;

            if (worldToScreenFn && typeof this.getWallProfile === "function") {
                const profile = this.getWallProfile();
                if (profile) {
                    const wallHeight = Math.max(0, Number(this.height) || 0);
                    const toScreen = (pt, z) => {
                        const s = worldToScreenFn({ x: Number(pt.x), y: Number(pt.y) });
                        return { x: s.x, y: s.y - z * vs * xyr };
                    };

                    const longFaceA = [
                        toScreen(profile.aLeft, 0),
                        toScreen(profile.bLeft, 0),
                        toScreen(profile.bLeft, wallHeight),
                        toScreen(profile.aLeft, wallHeight)
                    ];
                    const longFaceB = [
                        toScreen(profile.aRight, 0),
                        toScreen(profile.bRight, 0),
                        toScreen(profile.bRight, wallHeight),
                        toScreen(profile.aRight, wallHeight)
                    ];
                    const topFace = [
                        toScreen(profile.aLeft, wallHeight),
                        toScreen(profile.bLeft, wallHeight),
                        toScreen(profile.bRight, wallHeight),
                        toScreen(profile.aRight, wallHeight)
                    ];
                    const faceDepth = (poly) => {
                        let sum = 0;
                        for (let i = 0; i < poly.length; i++) sum += Number(poly[i].y) || 0;
                        return sum / Math.max(1, poly.length);
                    };
                    const longAFront = faceDepth(longFaceA) >= faceDepth(longFaceB);
                    const front = longAFront ? longFaceA : longFaceB;

                    if (!isVertical) {
                        const spanStart = Number(front[0].x);
                        const spanEnd = Number(front[1].x);
                        const spanMin = Math.min(spanStart, spanEnd);
                        const spanMax = Math.max(spanStart, spanEnd);
                        const spanSize = spanMax - spanMin;
                        if (spanSize > 1e-6) {
                            t = (Number(screenX) - spanMin) / spanSize;
                            t = Math.max(0, Math.min(1, t));
                            if (spanEnd < spanStart) t = 1 - t;
                        }
                    } else {
                        let topMinY = Infinity;
                        let topMaxY = -Infinity;
                        for (let i = 0; i < topFace.length; i++) {
                            if (topFace[i].y < topMinY) topMinY = topFace[i].y;
                            if (topFace[i].y > topMaxY) topMaxY = topFace[i].y;
                        }
                        const spanSize = topMaxY - topMinY;
                        const startY = (topFace[0].y + topFace[3].y) * 0.5;
                        const endY = (topFace[1].y + topFace[2].y) * 0.5;
                        if (spanSize > 1e-6) {
                            t = (Number(screenY) - topMinY) / spanSize;
                            t = Math.max(0, Math.min(1, t));
                            if (endY < startY) t = 1 - t;
                        }
                    }
                }
            }

            if (!Number.isFinite(t)) {
                const wx = Number(options.worldX);
                const wy = Number(options.worldY);
                if (Number.isFinite(wx) && Number.isFinite(wy) && typeof this._parameterForWorldPointOnSection === "function") {
                    const tRaw = this._parameterForWorldPointOnSection({ x: wx, y: wy });
                    if (Number.isFinite(tRaw)) {
                        t = Math.max(0, Math.min(1, Number(tRaw)));
                    }
                }
            }
            return Number.isFinite(t) ? Number(t) : null;
        }

        getSegmentAtScreenPoint(screenX, screenY, options = {}) {
            if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
            if (!this.startPoint || !this.endPoint) return null;

            const anchors = this._collectOrderedLineAnchors();
            if (!Array.isArray(anchors) || anchors.length < 2) return null;

            const tWall = this.getWallPositionAtScreenPoint(screenX, screenY, options);
            let startIdx = -1;
            let endIdx = -1;
            let tCenter = null;
            if (Number.isFinite(tWall)) {
                let bestSegmentIdx = -1;
                let bestDist = Infinity;
                for (let i = 0; i < anchors.length - 1; i++) {
                    const ta = Number(anchors[i].t);
                    const tb = Number(anchors[i + 1].t);
                    if (!Number.isFinite(ta) || !Number.isFinite(tb)) continue;
                    const mid = (ta + tb) * 0.5;
                    const dist = Math.abs(Number(tWall) - mid);
                    if (dist < bestDist - 1e-6) {
                        bestDist = dist;
                        bestSegmentIdx = i;
                        tCenter = mid;
                    }
                }
                if (bestSegmentIdx >= 0) {
                    startIdx = bestSegmentIdx;
                    endIdx = bestSegmentIdx + 1;
                }
            }
            if (endIdx <= startIdx || !Number.isFinite(tCenter)) return null;

            const startRow = anchors[startIdx];
            const endRow = anchors[endIdx];
            if (!startRow || !endRow || !startRow.anchor || !endRow.anchor) return null;
            if (WallSectionUnit._pointsMatch(startRow.anchor, endRow.anchor)) return null;

            return {
                section: this,
                t: Number(tCenter),
                tStart: Number(startRow.t),
                tEnd: Number(endRow.t),
                startAnchor: startRow.anchor,
                endAnchor: endRow.anchor,
                startIndex: startIdx,
                endIndex: endIdx
            };
        }

        getNearestLineAnchorToWorldPoint(worldPoint) {
            if (!worldPoint || !Number.isFinite(worldPoint.x) || !Number.isFinite(worldPoint.y)) return null;
            const anchors = this._collectOrderedLineAnchors();
            if (!Array.isArray(anchors) || anchors.length === 0) return null;
            const mapRef = this.map || null;
            let best = null;
            let bestDist = Infinity;
            for (let i = 0; i < anchors.length; i++) {
                const row = anchors[i];
                if (!row || !row.anchor) continue;
                const ax = Number(row.anchor.x);
                const ay = Number(row.anchor.y);
                if (!Number.isFinite(ax) || !Number.isFinite(ay)) continue;
                const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(ax, Number(worldPoint.x))
                    : (Number(worldPoint.x) - ax);
                const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(ay, Number(worldPoint.y))
                    : (Number(worldPoint.y) - ay);
                const dist = Math.hypot(dx, dy);
                if (dist < bestDist - 1e-6) {
                    bestDist = dist;
                    best = row;
                }
            }
            if (!best) return null;
            return {
                anchor: best.anchor,
                t: Number(best.t),
                isEndpoint: !!best.isEndpoint,
                distanceWorld: bestDist
            };
        }

        splitAtAnchor(splitAnchor, options = {}) {
            if (this.gone || !this.map || !this.startPoint || !this.endPoint) return null;
            const mapRef = this.map || null;
            const normalized = WallSectionUnit.normalizeEndpoint(splitAnchor, mapRef);
            if (!normalized) return null;
            if (
                WallSectionUnit._pointsMatch(normalized, this.startPoint) ||
                WallSectionUnit._pointsMatch(normalized, this.endPoint)
            ) {
                return null;
            }

            const anchors = this._collectOrderedLineAnchors();
            if (!Array.isArray(anchors) || anchors.length < 3) return null;
            const splitKey = WallSectionUnit.endpointKey(normalized);
            let splitIdx = anchors.findIndex(row => row && row.key === splitKey);
            if (splitIdx < 0) {
                const nearest = this.getNearestLineAnchorToWorldPoint(normalized);
                if (!nearest || !nearest.anchor) return null;
                const nearestKey = WallSectionUnit.endpointKey(nearest.anchor);
                splitIdx = anchors.findIndex(row => row && row.key === nearestKey);
            }
            if (splitIdx <= 0 || splitIdx >= anchors.length - 1) return null;

            const junctionAnchor = anchors[splitIdx].anchor;
            const splitT = Number(anchors[splitIdx].t);
            if (!junctionAnchor || !Number.isFinite(splitT)) return null;

            const sectionOptions = {
                map: this.map,
                height: Number(this.height),
                thickness: Number(this.thickness),
                bottomZ: Number(this.bottomZ),
                wallTexturePath: this.wallTexturePath,
                texturePhaseA: this.texturePhaseA,
                texturePhaseB: this.texturePhaseB
            };

            const tryCreateSection = (startAnchor, endAnchor) => {
                if (!startAnchor || !endAnchor) return null;
                if (WallSectionUnit._pointsMatch(startAnchor, endAnchor)) return null;
                let section = null;
                try {
                    section = new WallSectionUnit(startAnchor, endAnchor, sectionOptions);
                } catch (_err) {
                    section = null;
                }
                if (!section) return null;
                section.rebuildMesh3d();
                section.addToMapNodes();
                return section;
            };

            const leftSection = tryCreateSection(this.startPoint, junctionAnchor);
            const rightSection = tryCreateSection(junctionAnchor, this.endPoint);
            if (!leftSection || !rightSection) {
                if (leftSection && !leftSection.gone) leftSection.removeFromGame();
                if (rightSection && !rightSection.gone) rightSection.removeFromGame();
                return null;
            }

            const createdSections = [leftSection, rightSection];
            const splitMeta = (options && options.metadata && typeof options.metadata === "object")
                ? options.metadata
                : null;
            if (splitMeta && splitMeta.crossWallSplit) {
                const junctionKey = WallSectionUnit.endpointKey(junctionAnchor);
                if (junctionKey) {
                    for (let cs = 0; cs < createdSections.length; cs++) {
                        const section = createdSections[cs];
                        if (!section || section.gone) continue;
                        if (!(section._crossSplitLockedEndpointKeys instanceof Set)) {
                            section._crossSplitLockedEndpointKeys = new Set();
                        }
                        section._crossSplitLockedEndpointKeys.add(junctionKey);
                    }
                }
            }
            const usedObjects = new Set();
            const attachmentEntries = Array.isArray(this.attachedObjects) ? this.attachedObjects.slice() : [];
            const rangeEps = 1e-4;
            const distanceToSection = (section, obj) => {
                if (!section || !obj || !section.startPoint || !section.endPoint) return Infinity;
                const sx = Number(section.startPoint.x);
                const sy = Number(section.startPoint.y);
                const ex = Number(section.endPoint.x);
                const ey = Number(section.endPoint.y);
                const px = Number(obj.x);
                const py = Number(obj.y);
                if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey) || !Number.isFinite(px) || !Number.isFinite(py)) {
                    return Infinity;
                }
                const dx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(sx, ex) : (ex - sx);
                const dy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(sy, ey) : (ey - sy);
                const vx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(sx, px) : (px - sx);
                const vy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(sy, py) : (py - sy);
                const lenSq = dx * dx + dy * dy;
                if (!(lenSq > EPS)) return Infinity;
                const t = Math.max(0, Math.min(1, (vx * dx + vy * dy) / lenSq));
                const cx = sx + dx * t;
                const cy = sy + dy * t;
                const ox = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(cx, px) : (px - cx);
                const oy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(cy, py) : (py - cy);
                return Math.hypot(ox, oy);
            };

            for (let i = 0; i < attachmentEntries.length; i++) {
                const entry = attachmentEntries[i];
                const obj = entry && entry.object;
                if (!obj || usedObjects.has(obj) || obj.gone) continue;
                const t = this._parameterForWorldPointOnSection(obj);
                if (!Number.isFinite(t)) continue;

                let target = null;
                if (t < (splitT - rangeEps)) {
                    target = leftSection;
                } else if (t > (splitT + rangeEps)) {
                    target = rightSection;
                } else {
                    const leftDist = distanceToSection(leftSection, obj);
                    const rightDist = distanceToSection(rightSection, obj);
                    target = (leftDist <= rightDist) ? leftSection : rightSection;
                }
                if (!target || typeof target.attachObject !== "function") continue;
                target.attachObject(obj, {
                    direction: Number.isFinite(entry.direction) ? Number(entry.direction) : target.direction,
                    offsetAlong: Number.isFinite(entry.offsetAlong) ? Number(entry.offsetAlong) : 0
                });
                usedObjects.add(obj);
            }

            const neighbors = [];
            for (const payload of this.connections.values()) {
                const section = payload && payload.section;
                if (!section || section === this || section.gone) continue;
                if (neighbors.includes(section)) continue;
                neighbors.push(section);
            }

            this._removeWallPreserving(Array.from(usedObjects), { skipAutoMerge: true });

            leftSection.connectTo(rightSection, { splitForWallPlacement: true });
            rightSection.connectTo(leftSection, { splitForWallPlacement: true });

            for (let i = 0; i < createdSections.length; i++) {
                const section = createdSections[i];
                if (!section || section.gone) continue;
                for (let n = 0; n < neighbors.length; n++) {
                    const neighbor = neighbors[n];
                    if (!neighbor || neighbor.gone) continue;
                    if (!section.sharesEndpointWith(neighbor)) continue;
                    section.connectTo(neighbor, { splitForWallPlacement: true });
                    if (typeof neighbor.connectTo === "function") {
                        neighbor.connectTo(section, { splitForWallPlacement: true });
                    }
                }
            }

            const connectSections = Array.isArray(options.connectSections) ? options.connectSections : [];
            for (let i = 0; i < connectSections.length; i++) {
                const other = connectSections[i];
                if (!other || other.gone) continue;
                for (let s = 0; s < createdSections.length; s++) {
                    const section = createdSections[s];
                    if (!section || section.gone) continue;
                    if (!section.sharesEndpointWith(other)) continue;
                    section.connectTo(other, { splitForWallPlacement: true });
                    if (typeof other.connectTo === "function") {
                        other.connectTo(section, { splitForWallPlacement: true });
                    }
                }
            }

            for (let i = 0; i < createdSections.length; i++) {
                const section = createdSections[i];
                if (!section || section.gone) continue;
                if (typeof section.handleJoineryOnPlacement === "function") {
                    section.handleJoineryOnPlacement();
                }
            }
            for (let i = 0; i < connectSections.length; i++) {
                const other = connectSections[i];
                if (!other || other.gone) continue;
                if (typeof other.handleJoineryOnPlacement === "function") {
                    other.handleJoineryOnPlacement();
                }
            }

            return {
                junctionAnchor,
                sections: createdSections
            };
        }

        _removeWallPreserving(listToPreserve = [], options = {}) {
            if (this.gone) return;
            const preserveSet = new Set(Array.isArray(listToPreserve) ? listToPreserve : []);
            const skipAutoMerge = !!(options && options.skipAutoMerge);

            const neighbors = [];
            const mountedToRemove = [];
            const mountedSeen = new Set();
            for (const payload of this.connections.values()) {
                const section = payload && payload.section;
                if (!section || section === this) continue;
                if (neighbors.includes(section)) continue;
                neighbors.push(section);
            }

            const pushMounted = (obj) => {
                if (!obj || obj.gone) return;
                if (preserveSet.has(obj)) return;
                if (mountedSeen.has(obj)) return;
                mountedSeen.add(obj);
                mountedToRemove.push(obj);
            };

            for (let i = 0; i < this.attachedObjects.length; i++) {
                const entry = this.attachedObjects[i];
                if (!entry) continue;
                pushMounted(entry.object);
            }

            this.gone = true;
            this.vanishing = false;
            this._vanishWorldPoint = null;

            for (let i = 0; i < mountedToRemove.length; i++) {
                const obj = mountedToRemove[i];
                if (!obj || obj.gone) continue;
                if (typeof obj.remove === "function") {
                    obj.remove();
                } else if (typeof obj.removeFromGame === "function") {
                    obj.removeFromGame();
                } else if (typeof obj.delete === "function") {
                    obj.delete();
                } else {
                    obj.gone = true;
                }
            }
            this.attachedObjects.length = 0;

            for (let i = 0; i < neighbors.length; i++) {
                const neighbor = neighbors[i];
                if (!neighbor) continue;
                if (typeof neighbor.detachFrom === "function") {
                    neighbor.detachFrom(this);
                }
            }
            this.connections.clear();

            this.destroy();

            const mergeCandidates = neighbors.filter(neighbor => !!neighbor && !neighbor.gone);
            const impacted = skipAutoMerge
                ? mergeCandidates
                : WallSectionUnit.autoMergeContinuousSections(mergeCandidates);

            for (let i = 0; i < impacted.length; i++) {
                const neighbor = impacted[i];
                if (!neighbor || neighbor.gone) continue;
                if (typeof neighbor.handleJoineryOnPlacement === "function") {
                    neighbor.handleJoineryOnPlacement();
                } else {
                    if (typeof neighbor.rebuildMesh3d === "function") neighbor.rebuildMesh3d();
                    if (typeof neighbor.draw === "function") neighbor.draw();
                }
            }
        }

        _splitForVanishAroundPoint() {
            const vanishPoint = (this._vanishWorldPoint && Number.isFinite(this._vanishWorldPoint.x) && Number.isFinite(this._vanishWorldPoint.y))
                ? this._vanishWorldPoint
                : this.center;
            const plan = this.getVanishChunkSplitPlan(vanishPoint, { removeWidthWorld: 1 });
            if (!plan) return false;

            const newSections = [];
            const sectionOptions = {
                map: this.map,
                height: Number(this.height),
                thickness: Number(this.thickness),
                bottomZ: Number(this.bottomZ),
                wallTexturePath: this.wallTexturePath,
                texturePhaseA: this.texturePhaseA,
                texturePhaseB: this.texturePhaseB
            };

            const tryCreateSection = (startAnchor, endAnchor) => {
                if (!startAnchor || !endAnchor) return null;
                if (WallSectionUnit._pointsMatch(startAnchor, endAnchor)) return null;
                let section = null;
                try {
                    section = new WallSectionUnit(startAnchor, endAnchor, sectionOptions);
                } catch (_err) {
                    section = null;
                }
                if (!section) return null;
                section.rebuildMesh3d();
                section.addToMapNodes();
                return section;
            };

            const eps = 1e-5;
            if (plan.tStart > eps) {
                const left = tryCreateSection(this.startPoint, plan.cutStartAnchor);
                if (left) newSections.push({ side: "left", section: left });
            }
            if (plan.tEnd < (1 - eps)) {
                const right = tryCreateSection(plan.cutEndAnchor, this.endPoint);
                if (right) newSections.push({ side: "right", section: right });
            }

            if (newSections.length === 0) return false;

            const preservedObjects = [];
            const usedObjects = new Set();
            const attachmentEntries = Array.isArray(this.attachedObjects) ? this.attachedObjects.slice() : [];
            const rangeEps = 1e-4;

            const mapRef = this.map || null;
            const distanceToSection = (section, obj) => {
                if (!section || !obj || !section.startPoint || !section.endPoint) return Infinity;
                const sx = Number(section.startPoint.x);
                const sy = Number(section.startPoint.y);
                const ex = Number(section.endPoint.x);
                const ey = Number(section.endPoint.y);
                const px = Number(obj.x);
                const py = Number(obj.y);
                if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey) || !Number.isFinite(px) || !Number.isFinite(py)) {
                    return Infinity;
                }
                const dx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(sx, ex) : (ex - sx);
                const dy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(sy, ey) : (ey - sy);
                const vx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(sx, px) : (px - sx);
                const vy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(sy, py) : (py - sy);
                const lenSq = dx * dx + dy * dy;
                if (!(lenSq > EPS)) return Infinity;
                const t = Math.max(0, Math.min(1, (vx * dx + vy * dy) / lenSq));
                const cx = sx + dx * t;
                const cy = sy + dy * t;
                const ox = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(cx, px) : (px - cx);
                const oy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(cy, py) : (py - cy);
                return Math.hypot(ox, oy);
            };

            for (let i = 0; i < attachmentEntries.length; i++) {
                const entry = attachmentEntries[i];
                const obj = entry && entry.object;
                if (!obj || usedObjects.has(obj) || obj.gone) continue;
                const t = this._parameterForWorldPointOnSection(obj);
                if (!Number.isFinite(t)) continue;

                let chosenSection = null;
                if (t < (plan.tStart - rangeEps)) {
                    for (let s = 0; s < newSections.length; s++) {
                        if (newSections[s].side === "left") {
                            chosenSection = newSections[s].section;
                            break;
                        }
                    }
                } else if (t > (plan.tEnd + rangeEps)) {
                    for (let s = 0; s < newSections.length; s++) {
                        if (newSections[s].side === "right") {
                            chosenSection = newSections[s].section;
                            break;
                        }
                    }
                }
                if (!chosenSection) continue;

                let bestSection = chosenSection;
                let bestDist = distanceToSection(bestSection, obj);
                for (let s = 0; s < newSections.length; s++) {
                    const candidate = newSections[s].section;
                    if (!candidate) continue;
                    if (newSections[s].side === "left" && t >= (plan.tStart - rangeEps)) continue;
                    if (newSections[s].side === "right" && t <= (plan.tEnd + rangeEps)) continue;
                    const dist = distanceToSection(candidate, obj);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestSection = candidate;
                    }
                }

                if (bestSection && typeof bestSection.attachObject === "function") {
                    bestSection.attachObject(obj, {
                        direction: Number.isFinite(entry.direction) ? Number(entry.direction) : bestSection.direction,
                        offsetAlong: Number.isFinite(entry.offsetAlong) ? Number(entry.offsetAlong) : 0
                    });
                    usedObjects.add(obj);
                    preservedObjects.push(obj);
                }
            }

            const allNewSections = newSections.map(row => row.section).filter(section => section && !section.gone);

            const neighbors = [];
            for (const payload of this.connections.values()) {
                const section = payload && payload.section;
                if (!section || section === this || section.gone) continue;
                if (neighbors.includes(section)) continue;
                neighbors.push(section);
            }

            this._removeWallPreserving(preservedObjects);

            for (let i = 0; i < allNewSections.length; i++) {
                const section = allNewSections[i];
                if (!section || section.gone) continue;
                for (let n = 0; n < neighbors.length; n++) {
                    const neighbor = neighbors[n];
                    if (!neighbor || neighbor.gone) continue;
                    if (!section.sharesEndpointWith(neighbor)) continue;
                    section.connectTo(neighbor, { splitFromVanish: true });
                    if (typeof neighbor.connectTo === "function") {
                        neighbor.connectTo(section, { splitFromVanish: true });
                    }
                }
            }

            for (let i = 0; i < allNewSections.length; i++) {
                const section = allNewSections[i];
                if (!section || section.gone) continue;
                if (typeof section.handleJoineryOnPlacement === "function") {
                    section.handleJoineryOnPlacement();
                } else {
                    if (typeof section.rebuildMesh3d === "function") section.rebuildMesh3d();
                    if (typeof section.draw === "function") section.draw();
                }
            }

            this._vanishWorldPoint = null;

            return true;
        }

        vanishAroundPoint(vanishPoint, options = {}) {
            const removeWidthWorld = Number.isFinite(options.removeWidthWorld)
                ? Math.max(0.05, Number(options.removeWidthWorld))
                : 1;
            const plan = this.getVanishChunkSplitPlan(vanishPoint, { removeWidthWorld });
            if (!plan) return false;

            const sectionOptions = {
                map: this.map,
                height: Number(this.height),
                thickness: Number(this.thickness),
                bottomZ: Number(this.bottomZ),
                wallTexturePath: this.wallTexturePath,
                texturePhaseA: this.texturePhaseA,
                texturePhaseB: this.texturePhaseB
            };

            const tryCreateSection = (startAnchor, endAnchor) => {
                if (!startAnchor || !endAnchor) return null;
                if (WallSectionUnit._pointsMatch(startAnchor, endAnchor)) return null;
                let section = null;
                try {
                    section = new WallSectionUnit(startAnchor, endAnchor, sectionOptions);
                } catch (_err) {
                    section = null;
                }
                if (!section) return null;
                section.rebuildMesh3d();
                section.addToMapNodes();
                return section;
            };

            const eps = 1e-5;
            const leftSection = (plan.tStart > eps)
                ? tryCreateSection(this.startPoint, plan.cutStartAnchor)
                : null;
            const centerSection = tryCreateSection(plan.cutStartAnchor, plan.cutEndAnchor);
            const rightSection = (plan.tEnd < (1 - eps))
                ? tryCreateSection(plan.cutEndAnchor, this.endPoint)
                : null;

            if (!centerSection) {
                if (leftSection && !leftSection.gone) leftSection.removeFromGame();
                if (rightSection && !rightSection.gone) rightSection.removeFromGame();
                return false;
            }

            const createdSections = [leftSection, centerSection, rightSection].filter(section => !!section && !section.gone);
            const preservedObjects = [];
            const usedObjects = new Set();
            const attachmentEntries = Array.isArray(this.attachedObjects) ? this.attachedObjects.slice() : [];
            const rangeEps = 1e-4;

            const mapRef = this.map || null;
            const distanceToSection = (section, obj) => {
                if (!section || !obj || !section.startPoint || !section.endPoint) return Infinity;
                const sx = Number(section.startPoint.x);
                const sy = Number(section.startPoint.y);
                const ex = Number(section.endPoint.x);
                const ey = Number(section.endPoint.y);
                const px = Number(obj.x);
                const py = Number(obj.y);
                if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey) || !Number.isFinite(px) || !Number.isFinite(py)) {
                    return Infinity;
                }
                const dx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(sx, ex) : (ex - sx);
                const dy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(sy, ey) : (ey - sy);
                const vx = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(sx, px) : (px - sx);
                const vy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(sy, py) : (py - sy);
                const lenSq = dx * dx + dy * dy;
                if (!(lenSq > EPS)) return Infinity;
                const t = Math.max(0, Math.min(1, (vx * dx + vy * dy) / lenSq));
                const cx = sx + dx * t;
                const cy = sy + dy * t;
                const ox = (mapRef && typeof mapRef.shortestDeltaX === "function") ? mapRef.shortestDeltaX(cx, px) : (px - cx);
                const oy = (mapRef && typeof mapRef.shortestDeltaY === "function") ? mapRef.shortestDeltaY(cy, py) : (py - cy);
                return Math.hypot(ox, oy);
            };

            for (let i = 0; i < attachmentEntries.length; i++) {
                const entry = attachmentEntries[i];
                const obj = entry && entry.object;
                if (!obj || usedObjects.has(obj) || obj.gone) continue;
                const t = this._parameterForWorldPointOnSection(obj);
                if (!Number.isFinite(t)) continue;

                let chosenSection = centerSection;
                if (t < (plan.tStart - rangeEps) && leftSection) {
                    chosenSection = leftSection;
                } else if (t > (plan.tEnd + rangeEps) && rightSection) {
                    chosenSection = rightSection;
                }

                let bestSection = chosenSection;
                let bestDist = distanceToSection(chosenSection, obj);
                for (let s = 0; s < createdSections.length; s++) {
                    const candidate = createdSections[s];
                    const dist = distanceToSection(candidate, obj);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestSection = candidate;
                    }
                }

                if (bestSection && typeof bestSection.attachObject === "function") {
                    bestSection.attachObject(obj, {
                        direction: Number.isFinite(entry.direction) ? Number(entry.direction) : bestSection.direction,
                        offsetAlong: Number.isFinite(entry.offsetAlong) ? Number(entry.offsetAlong) : 0
                    });
                    usedObjects.add(obj);
                    if (bestSection !== centerSection) {
                        preservedObjects.push(obj);
                    }
                }
            }

            const neighbors = [];
            for (const payload of this.connections.values()) {
                const section = payload && payload.section;
                if (!section || section === this || section.gone) continue;
                if (neighbors.includes(section)) continue;
                neighbors.push(section);
            }

            this._removeWallPreserving([...preservedObjects, ...Array.from(usedObjects)]);

            for (let i = 0; i < createdSections.length; i++) {
                const section = createdSections[i];
                if (!section || section.gone) continue;
                for (let n = 0; n < neighbors.length; n++) {
                    const neighbor = neighbors[n];
                    if (!neighbor || neighbor.gone) continue;
                    if (!section.sharesEndpointWith(neighbor)) continue;
                    section.connectTo(neighbor, { splitFromVanish: true });
                    if (typeof neighbor.connectTo === "function") {
                        neighbor.connectTo(section, { splitFromVanish: true });
                    }
                }
            }

            for (let i = 0; i < createdSections.length; i++) {
                const section = createdSections[i];
                if (!section || section.gone) continue;
                if (typeof section.handleJoineryOnPlacement === "function") {
                    section.handleJoineryOnPlacement();
                } else {
                    if (typeof section.rebuildMesh3d === "function") section.rebuildMesh3d();
                    if (typeof section.draw === "function") section.draw();
                }
            }

            const vanishFrames = Number.isFinite(options.vanishDurationFrames)
                ? Math.max(1, Number(options.vanishDurationFrames))
                : ((Number.isFinite(globalScope.frameRate) ? Number(globalScope.frameRate) : 60) * 0.25);
            const frameRate = Math.max(1, Number.isFinite(globalScope.frameRate) ? Number(globalScope.frameRate) : 60);
            centerSection._disableChunkSplitOnVanish = true;
            centerSection.vanishing = true;
            centerSection.vanishStartTime = Number.isFinite(globalScope.frameCount) ? Number(globalScope.frameCount) : 0;
            centerSection.vanishDuration = vanishFrames;
            centerSection.percentVanished = 0;
            if (centerSection._vanishFinalizeTimeout) {
                clearTimeout(centerSection._vanishFinalizeTimeout);
            }
            const finalizeAfterMs = Math.max(0, (vanishFrames / frameRate) * 1000);
            centerSection._vanishFinalizeTimeout = setTimeout(() => {
                if (!centerSection || centerSection.gone) return;
                centerSection._disableChunkSplitOnVanish = true;
                centerSection.removeFromGame();
                centerSection._disableChunkSplitOnVanish = false;
                centerSection._vanishFinalizeTimeout = null;
            }, finalizeAfterMs);

            return true;
        }

        destroy() {
            this.removeFromMapNodes();
            WallSectionUnit._allSections.delete(this.id);
            if (this._depthDisplayMesh && this._depthDisplayMesh.parent) {
                this._depthDisplayMesh.parent.removeChild(this._depthDisplayMesh);
            }
            if (this._depthDisplayMesh && typeof this._depthDisplayMesh.destroy === "function") {
                this._depthDisplayMesh.destroy({ children: false, texture: false, baseTexture: false });
            }
            this._depthDisplayMesh = null;
            this._depthGeometryCache = null;
            if (this.pixiSprite && typeof this.pixiSprite.destroy === "function") {
                this.pixiSprite.destroy({ children: false, texture: false, baseTexture: false });
            }
            this.pixiSprite = null;
        }

        removeFromGame() {
            if (this.gone) return;
            if (this.vanishing && !this._disableChunkSplitOnVanish) {
                const splitHandled = this._splitForVanishAroundPoint();
                if (splitHandled) return;
            }
            const neighbors = [];
            const mountedToRemove = [];
            const mountedSeen = new Set();
            for (const payload of this.connections.values()) {
                const section = payload && payload.section;
                if (!section || section === this) continue;
                if (neighbors.includes(section)) continue;
                neighbors.push(section);
            }

            const pushMounted = (obj) => {
                if (!obj || obj.gone) return;
                if (mountedSeen.has(obj)) return;
                mountedSeen.add(obj);
                mountedToRemove.push(obj);
            };

            for (let i = 0; i < this.attachedObjects.length; i++) {
                const entry = this.attachedObjects[i];
                if (!entry) continue;
                pushMounted(entry.object);
            }

            this.gone = true;
            this.vanishing = false;

            for (let i = 0; i < mountedToRemove.length; i++) {
                const obj = mountedToRemove[i];
                if (!obj || obj.gone) continue;
                if (typeof obj.remove === "function") {
                    obj.remove();
                } else if (typeof obj.removeFromGame === "function") {
                    obj.removeFromGame();
                } else if (typeof obj.delete === "function") {
                    obj.delete();
                } else {
                    obj.gone = true;
                }
            }
            this.attachedObjects.length = 0;

            for (let i = 0; i < neighbors.length; i++) {
                const neighbor = neighbors[i];
                if (!neighbor) continue;
                if (typeof neighbor.detachFrom === "function") {
                    neighbor.detachFrom(this);
                }
            }
            this.connections.clear();

            this.destroy();

            const mergeCandidates = neighbors.filter(neighbor => !!neighbor && !neighbor.gone);
            const impacted = WallSectionUnit.autoMergeContinuousSections(mergeCandidates);

            for (let i = 0; i < impacted.length; i++) {
                const neighbor = impacted[i];
                if (!neighbor || neighbor.gone) continue;
                if (typeof neighbor.handleJoineryOnPlacement === "function") {
                    neighbor.handleJoineryOnPlacement();
                } else {
                    if (typeof neighbor.rebuildMesh3d === "function") neighbor.rebuildMesh3d();
                    if (typeof neighbor.draw === "function") neighbor.draw();
                }
            }
        }

        remove() {
            this.removeFromGame();
        }

        delete() {
            this.removeFromGame();
        }

        removeFromNodes() {
            this.removeFromMapNodes();
        }

        saveJson() {
            const data = {
                type: "wallSection",
                id: Number.isInteger(this.id) ? Number(this.id) : null,
                height: Number(this.height),
                thickness: Number(this.thickness),
                bottomZ: Number(this.bottomZ),
                wallTexturePath: (typeof this.wallTexturePath === "string" && this.wallTexturePath.length > 0)
                    ? this.wallTexturePath
                    : DEFAULT_WALL_TEXTURE,
                texturePhaseA: Number.isFinite(this.texturePhaseA) ? Number(this.texturePhaseA) : null,
                texturePhaseB: Number.isFinite(this.texturePhaseB) ? Number(this.texturePhaseB) : null,
                direction: Number.isFinite(this.direction) ? Number(this.direction) : null,
                lineAxis: Number.isFinite(this.lineAxis) ? Number(this.lineAxis) : null,
                startPoint: WallSectionUnit._serializeEndpoint(this.startPoint),
                endPoint: WallSectionUnit._serializeEndpoint(this.endPoint)
            };
            if (typeof this.visible === "boolean") {
                data.visible = this.visible;
            }
            if (Number.isFinite(this.brightness)) {
                data.brightness = Number(this.brightness);
            }
            if (Number.isFinite(this.tint)) {
                data.tint = Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(this.tint))));
            } else if (this.pixiSprite && Number.isFinite(this.pixiSprite.tint)) {
                data.tint = Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(this.pixiSprite.tint))));
            }
            if (typeof this.script !== "undefined") {
                try {
                    data.script = JSON.parse(JSON.stringify(this.script));
                } catch (_err) {
                    data.script = this.script;
                }
            }
            if (typeof this.scriptingName === "string" && this.scriptingName.trim().length > 0) {
                data.scriptingName = this.scriptingName.trim();
            }
            return data;
        }

        static loadJson(data, mapRef, options) {
            if (!data || data.type !== "wallSection" || !mapRef) return null;
            const opts = options || {};
            try {
                const startPoint = WallSectionUnit._resolveSerializedEndpoint(data.startPoint, mapRef);
                const endPoint = WallSectionUnit._resolveSerializedEndpoint(data.endPoint, mapRef);
                if (!startPoint || !endPoint) return null;
                const section = new WallSectionUnit(startPoint, endPoint, {
                    id: Number.isInteger(data.id) ? Number(data.id) : undefined,
                    map: mapRef,
                    height: Number.isFinite(data.height) ? Number(data.height) : 1,
                    thickness: Number.isFinite(data.thickness) ? Number(data.thickness) : 0.1,
                    bottomZ: Number.isFinite(data.bottomZ) ? Number(data.bottomZ) : 0,
                    wallTexturePath: (typeof data.wallTexturePath === "string" && data.wallTexturePath.length > 0)
                        ? data.wallTexturePath
                        : DEFAULT_WALL_TEXTURE,
                    texturePhaseA: Number.isFinite(data.texturePhaseA) ? Number(data.texturePhaseA) : NaN,
                    texturePhaseB: Number.isFinite(data.texturePhaseB) ? Number(data.texturePhaseB) : NaN,
                    deferSetup: !!opts.deferSetup
                });
                if (Number.isFinite(data.direction)) {
                    section.direction = WallSectionUnit._normalizeDirection(data.direction);
                }
                if (Number.isFinite(data.lineAxis)) {
                    section.lineAxis = Number(data.lineAxis);
                }
                if (typeof data.visible === "boolean") {
                    section.visible = data.visible;
                }
                if (Number.isFinite(data.brightness)) {
                    section.brightness = Number(data.brightness);
                }
                if (Number.isFinite(data.tint)) {
                    const normalizedTint = Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(data.tint))));
                    section.tint = normalizedTint;
                    if (section.pixiSprite) section.pixiSprite.tint = normalizedTint;
                }
                if (Object.prototype.hasOwnProperty.call(data, "script")) {
                    section.script = data.script;
                }
                if (typeof data.scriptingName === "string") {
                    section.scriptingName = data.scriptingName.trim();
                }
                if (!opts.deferSetup) {
                    section.addToMapNodes();
                    section.rebuildMesh3d();
                }
                return section;
            } catch (e) {
                console.error("Error loading wallSection:", e);
                return null;
            }
        }
    }

    // Per-frame budget counter — reset each frame by the render loop.
    WallSectionUnit._depthGeometryRebuildBudgetThisFrame = WallSectionUnit._depthGeometryRebuildBudgetPerFrame;

    // Eager pre-load avoids first-interaction stalls when async config resolves.
    WallSectionUnit._ensureWallTextureConfigLoaded();

    globalScope.WallSectionUnit = WallSectionUnit;
    globalScope.setWallSectionDirectionalBlockingDebug = function (enabled) {
        WallSectionUnit.setShowDirectionalBlockingDebug(enabled);
    };
    globalScope.setWallSectionBottomFaceOnlyDebug = function (enabled) {
        WallSectionUnit.setShowBottomFaceOnlyDebug(enabled);
    };
    globalScope.debugDumpWallDirectionalBlocking = function (options = {}) {
        const sections = (WallSectionUnit._allSections instanceof Map)
            ? Array.from(WallSectionUnit._allSections.values())
            : [];
        const cam = globalScope.camera || null;
        const viewport = globalScope.viewport || null;
        const cameraX = Number.isFinite(cam && cam.x) ? Number(cam.x) : null;
        const cameraY = Number.isFinite(cam && cam.y) ? Number(cam.y) : null;
        const viewportW = Number.isFinite(viewport && viewport.width) ? Number(viewport.width) : null;
        const viewportH = Number.isFinite(viewport && viewport.height) ? Number(viewport.height) : null;
        const onlyNearCamera = options.onlyNearCamera !== false;
        const marginX = Number.isFinite(options.marginX) ? Number(options.marginX) : Math.max(2, (viewportW || 20) * 0.15);
        const marginY = Number.isFinite(options.marginY) ? Number(options.marginY) : Math.max(2, (viewportH || 20) * 0.15);
        const rows = [];
        let totalBlockedConnections = 0;
        let totalCenterlineNodes = 0;
        let totalOddNeighborNodes = 0;

        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            if (!section || section.gone) continue;
            const center = section.center || null;
            if (
                onlyNearCamera &&
                center &&
                Number.isFinite(center.x) &&
                Number.isFinite(center.y) &&
                Number.isFinite(cameraX) &&
                Number.isFinite(cameraY) &&
                Number.isFinite(viewportW) &&
                Number.isFinite(viewportH)
            ) {
                if (
                    Number(center.x) < (cameraX - marginX) ||
                    Number(center.x) > (cameraX + viewportW + marginX) ||
                    Number(center.y) < (cameraY - marginY) ||
                    Number(center.y) > (cameraY + viewportH + marginY)
                ) {
                    continue;
                }
            }

            const debugData = section._directionalBlockingDebug || null;
            const centerlineNodes = Array.isArray(debugData && debugData.centerlineNodes) ? debugData.centerlineNodes.length : 0;
            const oddNeighborNodes = Array.isArray(debugData && debugData.oddNeighborNodes) ? debugData.oddNeighborNodes.length : 0;
            const blockedConnections = Array.isArray(debugData && debugData.blockedConnections) ? debugData.blockedConnections.length : 0;
            totalCenterlineNodes += centerlineNodes;
            totalOddNeighborNodes += oddNeighborNodes;
            totalBlockedConnections += blockedConnections;
            rows.push({
                id: Number.isInteger(section.id) ? Number(section.id) : "",
                centerX: Number.isFinite(center && center.x) ? Number(center.x).toFixed(2) : "",
                centerY: Number.isFinite(center && center.y) ? Number(center.y).toFixed(2) : "",
                centerlineNodes,
                oddNeighborNodes,
                blockedConnections,
                attachedObjects: Array.isArray(section.attachedObjects) ? section.attachedObjects.length : 0
            });
        }

        console.group(`wall directional blocking (${rows.length} sections)`);
        console.table(rows);
        console.log({
            sections: rows.length,
            totalCenterlineNodes,
            totalOddNeighborNodes,
            totalBlockedConnections,
            debugEnabled: !!WallSectionUnit._showDirectionalBlockingDebug
        });
        console.groupEnd();
        return rows;
    };
    globalScope.resetWallDepthGeometryBudget = function () {
        WallSectionUnit._depthGeometryRebuildBudgetThisFrame = WallSectionUnit._depthGeometryRebuildBudgetPerFrame;
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
