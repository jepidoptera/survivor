(function (globalScope) {
    "use strict";

    const EPS = 1e-6;
    const WALL_DEPTH_VS = `
precision mediump float;
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
}
`;
    const WALL_DEPTH_FS = `
precision mediump float;
varying vec2 vUvs;
varying vec4 vColor;
varying float vTextureMix;
uniform sampler2D uSampler;
uniform vec4 uTint;
uniform float uAlphaCutoff;
void main(void) {
    vec4 sampled = texture2D(uSampler, vUvs);
    vec4 tex = mix(vec4(1.0, 1.0, 1.0, 1.0), sampled, clamp(vTextureMix, 0.0, 1.0));
    vec4 outColor = tex * uTint * vColor;
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
        static _showDirectionalBlockingDebug = false;
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
            if (!candidate) return false;
            if (typeof globalScope.NodeMidpoint !== "undefined" && candidate instanceof globalScope.NodeMidpoint) {
                return true;
            }
            return !!(
                !WallSectionUnit._isMapNode(candidate) &&
                candidate.nodeA && candidate.nodeB &&
                Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
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
            if (!mapRef || !mapRef.nodes) return null;
            if (!Number.isFinite(xindex) || !Number.isFinite(yindex)) return null;
            const xi = Number(xindex);
            const yi = Number(yindex);
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

        static canAutoMergeContinuous(sectionA, sectionB) {
            if (!sectionA || !sectionB || sectionA === sectionB) return false;
            if (sectionA.gone || sectionB.gone || sectionA.vanishing || sectionB.vanishing) return false;
            if (
                sectionA._disableChunkSplitOnVanish ||
                sectionB._disableChunkSplitOnVanish ||
                sectionA._vanishAsWholeSection ||
                sectionB._vanishAsWholeSection
            ) {
                return false;
            }
            if (sectionA.map !== sectionB.map) return false;
            const endpoints = WallSectionUnit._resolveSharedAndOuterEndpoints(sectionA, sectionB);
            if (!endpoints) return false;

            const dirA = WallSectionUnit._normalizeDirection(sectionA.direction);
            const dirB = WallSectionUnit._normalizeDirection(sectionB.direction);
            const axisA = ((dirA % 6) + 6) % 6;
            const axisB = ((dirB % 6) + 6) % 6;
            if (axisA !== axisB) return false;

            if (!WallSectionUnit._numericEqual(sectionA.height, sectionB.height, 1e-5)) return false;
            if (!WallSectionUnit._numericEqual(sectionA.thickness, sectionB.thickness, 1e-5)) return false;
            if (!WallSectionUnit._numericEqual(sectionA.bottomZ, sectionB.bottomZ, 1e-5)) return false;

            const textureA = WallSectionUnit._normalizeWallTextureConfigPath(sectionA.wallTexturePath || DEFAULT_WALL_TEXTURE);
            const textureB = WallSectionUnit._normalizeWallTextureConfigPath(sectionB.wallTexturePath || DEFAULT_WALL_TEXTURE);
            if (textureA !== textureB) return false;

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

        static mergeOverlappingPlacementPair(survivor, absorbed) {
            if (!survivor || !absorbed || survivor === absorbed) return null;
            const overlap = WallSectionUnit._computeCollinearOverlapData(survivor, absorbed);
            if (!overlap || !overlap.mergedStart || !overlap.mergedEnd) return null;

            survivor.setEndpoints(overlap.mergedStart, overlap.mergedEnd, survivor.map || absorbed.map || null);
            survivor.addToMapNodes();

            if (typeof survivor.handleJoineryOnPlacement === "function") {
                survivor.handleJoineryOnPlacement();
            } else {
                if (typeof survivor.rebuildMesh3d === "function") survivor.rebuildMesh3d();
                if (typeof survivor.draw === "function") survivor.draw();
            }

            absorbed.gone = true;
            absorbed.vanishing = false;
            absorbed.destroy();
            return survivor;
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
            const seeds = Array.isArray(seedSections) ? seedSections.slice() : [];
            const survivors = [];
            const seen = new Set();

            for (let i = 0; i < seeds.length; i++) {
                let section = seeds[i];
                if (!section || section.gone || section.vanishing) continue;

                let merged = true;
                let guard = 0;
                while (merged && guard < 128) {
                    merged = false;
                    guard += 1;
                    const allSections = Array.from(WallSectionUnit._allSections.values());
                    for (let j = 0; j < allSections.length; j++) {
                        const candidate = allSections[j];
                        if (!candidate || candidate === section) continue;
                        if (!WallSectionUnit.canAutoMergeContinuous(section, candidate)) continue;
                        const next = WallSectionUnit.mergeContinuousPair(section, candidate);
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
            }

            return survivors;
        }

        static _directionUnitVector(direction, mapRef = null, anchorPoint = null) {
            const dir = WallSectionUnit._normalizeDirection(direction);

            // Only use neighbor lookup for actual MapNodes (12-slot directional array).
            // NodeMidpoints have a .neighbors array too, but it's just [nodeA, nodeB]
            // and NOT directional — using it would give garbage vectors.
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

            if (!Array.isArray(midpoint.neighbors) || midpoint.neighbors.length === 0) return null;
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
            for (let i = 0; i < midpoint.neighbors.length; i++) {
                const node = midpoint.neighbors[i];
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
            const midpointBaseDirection = (midpoint) => {
                if (!WallSectionUnit._isNodeMidpoint(midpoint) || !midpoint.nodeA || !midpoint.nodeB) return null;
                if (typeof mapRef._getMidpointDirectionBase === "function") {
                    const byMap = mapRef._getMidpointDirectionBase(midpoint);
                    if (Number.isFinite(byMap)) return normalizeDirection(byMap);
                }
                const dx = shortDx(midpoint.nodeA.x, midpoint.nodeB.x);
                const dy = shortDy(midpoint.nodeA.y, midpoint.nodeB.y);
                const axisDirection = normalizeDirection(
                    (typeof mapRef.getHexDirection === "function")
                        ? mapRef.getHexDirection(dx, dy)
                        : 0
                );
                const axisClass = ((axisDirection % 6) + 6) % 6;
                return (axisClass === 1 || axisClass === 3 || axisClass === 5) ? axisClass : null;
            };
            const midpointSupportsDirection = (midpoint, direction) => {
                if (!WallSectionUnit._isNodeMidpoint(midpoint) || !Number.isFinite(direction)) return false;
                if (typeof mapRef._midpointSupportsDirection === "function") {
                    return !!mapRef._midpointSupportsDirection(midpoint, direction);
                }
                const base = midpointBaseDirection(midpoint);
                if (!Number.isFinite(base)) return false;
                const dir = normalizeDirection(direction);
                return ((dir - base + 12) % 3) === 0;
            };
            const midpointBetweenNodes = (nodeA, nodeB) => {
                if (!WallSectionUnit._isMapNode(nodeA) || !WallSectionUnit._isMapNode(nodeB)) return null;
                if (typeof mapRef.getMidpointNode === "function") {
                    const midpoint = mapRef.getMidpointNode(nodeA, nodeB);
                    if (midpoint && WallSectionUnit._isNodeMidpoint(midpoint)) return midpoint;
                }
                const mx = Number(nodeA.x) + shortDx(nodeA.x, nodeB.x) * 0.5;
                const my = Number(nodeA.y) + shortDy(nodeA.y, nodeB.y) * 0.5;
                const snapped = (typeof mapRef.worldToNodeOrMidpoint === "function")
                    ? mapRef.worldToNodeOrMidpoint(mx, my)
                    : null;
                return (snapped && WallSectionUnit._isNodeMidpoint(snapped)) ? snapped : null;
            };
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
            const buildMidpointDirectionNodeMap = (midpoint) => {
                const out = new Map();
                if (!WallSectionUnit._isNodeMidpoint(midpoint)) return out;
                const surrounding = [];
                const pushNode = (node) => {
                    if (!WallSectionUnit._isMapNode(node)) return;
                    if (surrounding.includes(node)) return;
                    surrounding.push(node);
                };
                pushNode(midpoint.nodeA);
                pushNode(midpoint.nodeB);
                if (Array.isArray(midpoint.neighbors)) {
                    for (let i = 0; i < midpoint.neighbors.length; i++) {
                        pushNode(midpoint.neighbors[i]);
                    }
                }
                for (let i = 0; i < surrounding.length; i++) {
                    const node = surrounding[i];
                    const dir = normalizeDirection(
                        (typeof mapRef.getHexDirection === "function")
                            ? mapRef.getHexDirection(shortDx(midpoint.x, node.x), shortDy(midpoint.y, node.y))
                            : 0
                    );
                    if (!out.has(dir)) out.set(dir, node);
                }
                return out;
            };
            const resolveArbitraryMidpointStart = (midpoint, primaryDirection) => {
                const base = midpointBaseDirection(midpoint);
                if (!Number.isFinite(base)) return midpoint;
                const a = normalizeDirection(base);
                const b = normalizeDirection(base + 3);
                const c = normalizeDirection(base + 6);
                const d = normalizeDirection(base + 9);
                const dir = normalizeDirection(primaryDirection);
                const dirToNode = buildMidpointDirectionNodeMap(midpoint);
                const nodeAt = (direction) => dirToNode.get(normalizeDirection(direction)) || null;
                const midpointBetween = (leftDir, rightDir) => midpointBetweenNodes(
                    nodeAt(leftDir),
                    nodeAt(rightDir)
                );

                if (dir === a || dir === b || dir === c || dir === d) return midpoint;
                if (dir === normalizeDirection(a - 1)) return midpointBetween(a, d) || midpoint;
                if (dir === normalizeDirection(a + 1)) return midpointBetween(a, b) || midpoint;
                if (dir === normalizeDirection(a + 5)) return midpointBetween(b, c) || midpoint;
                if (dir === normalizeDirection(a + 7)) return midpointBetween(c, d) || midpoint;
                if (dir === normalizeDirection(a + 2)) return midpointBetween(b, c) || midpoint;
                if (dir === normalizeDirection(a + 4)) return midpointBetween(a, b) || midpoint;
                if (dir === normalizeDirection(a + 8)) return midpointBetween(d, a) || midpoint;
                if (dir === normalizeDirection(a + 10)) return midpointBetween(c, d) || midpoint;
                return midpoint;
            };
            const nextForwardAnchorOnDirection = (currentAnchor, originAnchor, direction, lineVec) => {
                const currentAlong = pointLineMetrics(originAnchor, lineVec, currentAnchor).along;
                if (WallSectionUnit._isMapNode(currentAnchor)) {
                    const neighbor = Array.isArray(currentAnchor.neighbors)
                        ? currentAnchor.neighbors[normalizeDirection(direction)]
                        : null;
                    if (!WallSectionUnit._isMapNode(neighbor)) return null;
                    const midpoint = midpointBetweenNodes(currentAnchor, neighbor);
                    if (
                        midpoint &&
                        (
                            isForwardOnLine(originAnchor, lineVec, midpoint) ||
                            isDirectionallyForward(originAnchor, lineVec, direction, midpoint)
                        )
                    ) {
                        const midAlong = pointLineMetrics(originAnchor, lineVec, midpoint).along;
                        if (midAlong > currentAlong + lineTolerance) return midpoint;
                    }
                    if (
                        isForwardOnLine(originAnchor, lineVec, neighbor) ||
                        isDirectionallyForward(originAnchor, lineVec, direction, neighbor)
                    ) {
                        const nodeAlong = pointLineMetrics(originAnchor, lineVec, neighbor).along;
                        if (nodeAlong > currentAlong + lineTolerance) return neighbor;
                    }
                    return null;
                }
                if (WallSectionUnit._isNodeMidpoint(currentAnchor)) {
                    const candidates = Array.isArray(currentAnchor.neighbors)
                        ? currentAnchor.neighbors.filter(node => WallSectionUnit._isMapNode(node))
                        : [];
                    let bestNode = null;
                    let bestDirDelta = Infinity;
                    let bestAlong = Infinity;
                    for (let i = 0; i < candidates.length; i++) {
                        const node = candidates[i];
                        const along = pointLineMetrics(originAnchor, lineVec, node).along;
                        if (along <= currentAlong + lineTolerance) continue;
                        const nodeDir = directionBetween(currentAnchor, node);
                        if (!Number.isFinite(nodeDir)) continue;
                        const dirDelta = directionDistance(nodeDir, direction);
                        if (dirDelta > 1) continue;
                        if (
                            dirDelta < bestDirDelta - 1e-6 ||
                            (Math.abs(dirDelta - bestDirDelta) <= 1e-6 && along < bestAlong - 1e-6)
                        ) {
                            bestDirDelta = dirDelta;
                            bestAlong = along;
                            bestNode = node;
                        }
                    }
                    return bestNode;
                }
                return null;
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
                    const next = nextForwardAnchorOnDirection(current, startAnchor, direction, lineVec);
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
                { requireNode = false, excludeStart = false } = {}
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
                    if (requireNode && !WallSectionUnit._isMapNode(anchor)) continue;
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
            let startAnchor = null;
            const bridgePrefixSegments = [];

            if (startFromExistingWall) {
                const strictStartAnchor = WallSectionUnit.normalizeEndpoint(startWorld, mapRef);
                if (!strictStartAnchor) return emptyPlan;

                if (WallSectionUnit._isMapNode(strictStartAnchor)) {
                    startAnchor = strictStartAnchor;
                } else if (
                    WallSectionUnit._isNodeMidpoint(strictStartAnchor) &&
                    midpointSupportsDirection(strictStartAnchor, chosenStartDirection)
                ) {
                    startAnchor = strictStartAnchor;
                } else if (WallSectionUnit._isNodeMidpoint(strictStartAnchor)) {
                    const midpoint = strictStartAnchor;
                    const midpointNeighbors = Array.isArray(midpoint.neighbors)
                        ? midpoint.neighbors.filter(node => WallSectionUnit._isMapNode(node))
                        : [];
                    if (midpointNeighbors.length === 0) return emptyPlan;

                    let bridgeNode = null;
                    if (
                        startReferenceWall &&
                        startReferenceWall.startPoint &&
                        startReferenceWall.endPoint
                    ) {
                        let oppositeEndpoint = null;
                        if (WallSectionUnit._pointsMatch(midpoint, startReferenceWall.startPoint)) {
                            oppositeEndpoint = startReferenceWall.endPoint;
                        } else if (WallSectionUnit._pointsMatch(midpoint, startReferenceWall.endPoint)) {
                            oppositeEndpoint = startReferenceWall.startPoint;
                        }

                        if (oppositeEndpoint && Number.isFinite(oppositeEndpoint.x) && Number.isFinite(oppositeEndpoint.y)) {
                            const lineDx = shortDx(oppositeEndpoint.x, midpoint.x);
                            const lineDy = shortDy(oppositeEndpoint.y, midpoint.y);
                            const lineLen = Math.hypot(lineDx, lineDy);
                            if (lineLen > EPS) {
                                let bestDot = -Infinity;
                                for (let i = 0; i < midpointNeighbors.length; i++) {
                                    const node = midpointNeighbors[i];
                                    const ndx = shortDx(midpoint.x, node.x);
                                    const ndy = shortDy(midpoint.y, node.y);
                                    const dot = lineDx * ndx + lineDy * ndy;
                                    if (dot > bestDot + EPS) {
                                        bestDot = dot;
                                        bridgeNode = node;
                                    }
                                }
                            }
                        }
                    }

                    if (!bridgeNode) {
                        bridgeNode = WallSectionUnit._chooseMidpointBridgeNode(mapRef, midpoint, rawEnd);
                    }
                    if (!bridgeNode || !WallSectionUnit._isMapNode(bridgeNode)) return emptyPlan;

                    const bridgeDirection = directionBetween(midpoint, bridgeNode);
                    if (!Number.isFinite(bridgeDirection)) return emptyPlan;
                    bridgePrefixSegments.push({
                        start: midpoint,
                        end: bridgeNode,
                        direction: bridgeDirection
                    });
                    startAnchor = bridgeNode;
                } else {
                    return emptyPlan;
                }
            } else {
                const nearestStartAnchor = WallSectionUnit.normalizeEndpoint(startWorld, mapRef);
                if (!nearestStartAnchor) return emptyPlan;
                if (WallSectionUnit._isMapNode(nearestStartAnchor)) {
                    startAnchor = nearestStartAnchor;
                } else if (WallSectionUnit._isNodeMidpoint(nearestStartAnchor)) {
                    startAnchor = resolveArbitraryMidpointStart(nearestStartAnchor, chosenStartDirection);
                } else {
                    return emptyPlan;
                }
            }
            if (!startAnchor) return emptyPlan;

            const startPrimaryVec = lineVectorFrom(startAnchor, chosenStartDirection);
            const endFromStartMetrics = pointLineMetrics(startAnchor, startPrimaryVec, rawEnd);
            const perpendicularDistance = Math.abs(endFromStartMetrics.perp);

            const finalizeSingleDirection = () => {
                const endAnchor = chooseClosestForwardAnchor(startAnchor, chosenStartDirection, rawEnd, {
                    requireNode: false,
                    excludeStart: false
                });
                const hasMainSegment = !!(
                    endAnchor &&
                    !WallSectionUnit._pointsMatch(startAnchor, endAnchor)
                );
                if (!hasMainSegment && bridgePrefixSegments.length === 0) return emptyPlan;
                const segments = bridgePrefixSegments.slice();
                if (hasMainSegment) {
                    segments.push({
                        start: startAnchor,
                        end: endAnchor,
                        direction: chosenStartDirection
                    });
                }
                return {
                    start: startAnchor,
                    end: hasMainSegment ? endAnchor : startAnchor,
                    junction: null,
                    primaryDirection: chosenStartDirection,
                    secondaryDirection: null,
                    segments
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

            const junctionNode = chooseClosestForwardAnchor(
                startAnchor,
                chosenStartDirection,
                { x: lineIntersection.x, y: lineIntersection.y },
                { requireNode: true, excludeStart: true }
            );
            if (!junctionNode) return finalizeSingleDirection();

            const secondaryEndAnchor = chooseClosestForwardAnchor(
                junctionNode,
                secondaryDirection,
                rawEnd,
                { requireNode: false, excludeStart: false }
            );
            if (!secondaryEndAnchor) {
                return {
                    start: startAnchor,
                    end: junctionNode,
                    junction: junctionNode,
                    primaryDirection: chosenStartDirection,
                    secondaryDirection,
                    segments: bridgePrefixSegments.concat([
                        {
                            start: startAnchor,
                            end: junctionNode,
                            direction: chosenStartDirection
                        }
                    ])
                };
            }

            const segments = bridgePrefixSegments.concat([
                {
                    start: startAnchor,
                    end: junctionNode,
                    direction: chosenStartDirection
                }
            ]);
            if (!WallSectionUnit._pointsMatch(junctionNode, secondaryEndAnchor)) {
                segments.push({
                    start: junctionNode,
                    end: secondaryEndAnchor,
                    direction: secondaryDirection
                });
            }
            return {
                start: startAnchor,
                end: secondaryEndAnchor,
                junction: junctionNode,
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
            const preResolvedSegments = Array.isArray(options.preResolvedSegments)
                ? options.preResolvedSegments
                : null;
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

            const sections = [];
            const mergedIntoExisting = [];
            for (let i = 0; i < sourceSegments.length; i++) {
                const seg = sourceSegments[i];
                if (!seg || !seg.start || !seg.end) continue;
                if (WallSectionUnit._pointsMatch(seg.start, seg.end)) continue;
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
                    for (let j = 0; j < preexistingSections.length; j++) {
                        const candidate = preexistingSections[j];
                        if (!candidate || candidate === activeSection) continue;
                        if (candidate.gone || candidate.vanishing) continue;
                        if (candidate.map !== mapRef) continue;
                        if (!WallSectionUnit.canMergeCollinearOverlap(candidate, activeSection)) continue;
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

                    const merged = WallSectionUnit.mergeOverlappingPlacementPair(survivor, absorbed);
                    if (!merged || merged.gone) {
                        activeSection = null;
                        break;
                    }

                    activeSection = merged;
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

            if (options.harmonizeTexturePhase !== false) {
                WallSectionUnit.harmonizeTexturePhaseForSections(sections, preexistingSections);
            }

            const seedsForContinuousMerge = sections.concat(
                mergedIntoExisting.filter(section => !!section && !section.gone && !section.vanishing)
            );

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

                    const wallKey = Number.isInteger(ref.wall.id) ? `id:${ref.wall.id}` : `obj:${i}`;
                    const anchorKey = WallSectionUnit.endpointKey(ref.anchor);
                    const splitKey = `${wallKey}|${anchorKey}`;
                    if (!anchorKey || seenSplitKeys.has(splitKey)) continue;
                    seenSplitKeys.add(splitKey);

                    ref.wall.splitAtAnchor(ref.anchor, {
                        connectSections: mergedSections,
                        metadata: { splitForWallPlacement: true }
                    });
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
                clippedSpanMode ? (clipToLosVisibleSpan ? "clip" : "maze") : "full",
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
                const topTextureVMin = 0.25;
                const topTextureVMax = 0.5;
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
                                topTextureVMin + Math.max(0, Math.min(1, acrossNorm)) * topTextureVSpan + phaseV
                            );
                        } else if (isCapFace) {
                            uvs.push(
                                acrossWorld * repeatX + phaseU,
                                heightWorld * repeatY + phaseV
                            );
                        } else {
                            uvs.push(
                                alongWorld * repeatX + phaseU,
                                heightWorld * repeatY + phaseV
                            );
                        }
                        colors.push(1, 1, 1, 1);
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
            const topTextureVMin = 0.25;
            const topTextureVMax = 0.5;
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
                    expandedPositions[dstPos + 2] = Number(vertices[srcPos + 2]) || 0;
                    const along = Number(alongStablePerVertex[srcVertex]) || 0;
                    const alongWorld = Number(alongWorldPerVertex[srcVertex]) || 0;
                    const across = Number(acrossPerVertex[srcVertex]) || 0;
                    const height = Number(heightPerVertex[srcVertex]) || 0;
                    if (isTopFaceTri) {
                        const acrossNorm = (across - topAcrossMin) / Math.max(1e-6, (topAcrossMax - topAcrossMin));
                        expandedUvs[dstUv] = alongWorld * repeatX + phaseU;
                        expandedUvs[dstUv + 1] = topTextureVMin + Math.max(0, Math.min(1, acrossNorm)) * topTextureVSpan + phaseV;
                    } else if (capFace) {
                        expandedUvs[dstUv] = across * repeatX + phaseU;
                        expandedUvs[dstUv + 1] = height * repeatY + phaseV;
                    } else {
                        expandedUvs[dstUv] = alongWorld * repeatX + phaseU;
                        expandedUvs[dstUv + 1] = height * repeatY + phaseV;
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
                uAlphaCutoff: 0.02,
                uSampler: PIXI.Texture.WHITE
            });
            const mesh = new PIXI.Mesh(geometry, shader, state, PIXI.DRAW_MODES.TRIANGLES);
            mesh.name = "wallSectionUnitDepthMesh";
            mesh.interactive = false;
            mesh.roundPixels = true;
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
            const viewportHeight = Number(camera && camera.height) || 30;
            const nearMetric = -Math.max(80, viewportHeight * 0.6);
            const farMetric = Math.max(180, viewportHeight * 2.0 + 80);
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
            u.uAlphaCutoff = Number.isFinite(geometry.alphaCutoff) ? Number(geometry.alphaCutoff) : 0.02;
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

            const wallById = new Map([[Number(this.id), this]]);
            if (this.connections instanceof Map) {
                for (const payload of this.connections.values()) {
                    if (!payload || payload.sharedEndpointKey !== endpointKey) continue;
                    const other = payload.section;
                    if (!other || other.type !== "wallSection" || other.gone || other.vanishing) continue;
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
                if (Number.isInteger(this.id) && visibleWallIdSet.has(Number(this.id))) ids.push(Number(this.id));
                if (this.connections instanceof Map) {
                    for (const payload of this.connections.values()) {
                        if (!payload || payload.sharedEndpointKey !== endpointKey) continue;
                        const other = payload.section;
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

            const cameraPoint = this._resolveCameraReferencePoint(options);
            const centerlineEps = Math.max(1e-4, (Number(this.thickness) || 0) * 0.01);
            const cameraAcross = this._getSignedAcrossFromCenterline(cameraPoint);
            if (Number.isFinite(cameraAcross)) {
                if (cameraAcross > centerlineEps) return faces.longFaceRight;
                if (cameraAcross < -centerlineEps) return faces.longFaceLeft;
            }

            const worldToScreenFn = (typeof options.worldToScreenFn === "function")
                ? options.worldToScreenFn
                : ((typeof globalScope.worldToScreen === "function") ? globalScope.worldToScreen : null);
            const vs = Number.isFinite(options.viewscale)
                ? Number(options.viewscale)
                : (Number.isFinite(globalScope.viewscale) ? Number(globalScope.viewscale) : 1);
            const xyr = Number.isFinite(options.xyratio)
                ? Number(options.xyratio)
                : (Number.isFinite(globalScope.xyratio) ? Number(globalScope.xyratio) : 0.66);

            if (typeof worldToScreenFn === "function") {
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

            if (!cameraPoint) return faces.longFaceLeft;
            const leftCenter = this._getFaceCenterWorld(faces.longFaceLeft);
            const rightCenter = this._getFaceCenterWorld(faces.longFaceRight);
            const leftDistSq = this._distanceSqToWorldPoint(cameraPoint, leftCenter);
            const rightDistSq = this._distanceSqToWorldPoint(cameraPoint, rightCenter);
            return (leftDistSq <= rightDistSq) ? faces.longFaceLeft : faces.longFaceRight;
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
            const out = [];
            if (Array.isArray(left) && left.length >= 4) out.push(left);
            if (Array.isArray(right) && right.length >= 4) out.push(right);
            if (Array.isArray(top) && top.length >= 4) out.push(top);

            if (Array.isArray(left) && left.length >= 4 && Array.isArray(right) && right.length >= 4) {
                const capStart = [left[0], right[0], right[3], left[3]];
                const capEnd = [left[1], right[1], right[2], left[2]];
                out.push(capStart, capEnd);
            }
            return out;
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
            const blockedConnections = Array.isArray(debugData.blockedConnections) ? debugData.blockedConnections : [];
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

            if (blockedConnections.length > 0) {
                g.lineStyle(2, 0xff0000, 0.95);
                for (let i = 0; i < blockedConnections.length; i++) {
                    const edge = blockedConnections[i];
                    if (!edge || !edge.a || !edge.b) continue;
                    const pa = toScreen(edge.a);
                    const pb = toScreen(edge.b);
                    g.moveTo(pa.x, pa.y - z * vs * xyr);
                    g.lineTo(pb.x, pb.y - z * vs * xyr);
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

                if (entries.length < 2) continue;

                // Keep runtime connection graph in sync with endpoint topology:
                // every wall sharing this endpoint should be connected to every other.
                const endpointWallById = new Map();
                for (let i = 0; i < entries.length; i++) {
                    const wall = entries[i] && entries[i].wall;
                    if (!wall || !Number.isInteger(wall.id)) continue;
                    endpointWallById.set(Number(wall.id), wall);
                }
                const endpointWallIds = new Set(endpointWallById.keys());

                // Prune stale connections at this endpoint.
                for (const wall of endpointWallById.values()) {
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
        addToMapNodes() {
            this.removeFromMapNodes();
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
            const centerlineNodes = this._collectCenterlineMapNodes();
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

            this._applyDirectionalBlocking();
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
                    if (!node.blockedNeighbors || !node.blockedNeighbors.has(direction)) continue;
                    const blockers = node.blockedNeighbors.get(direction);
                    if (!(blockers instanceof Set)) continue;
                    blockers.delete(this);
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

        _addBlockedLink(node, direction) {
            if (!WallSectionUnit._isMapNode(node)) return false;
            const dir = Number(direction);
            if (!Number.isInteger(dir) || dir < 0 || dir > 11) return false;
            if (!Array.isArray(node.neighbors) || !node.neighbors[dir]) return false;

            const key = `${this._nodeKey(node)}|${dir}`;
            if (this._blockedLinkKeys.has(key)) return false;

            if (!(node.blockedNeighbors instanceof Map)) {
                node.blockedNeighbors = new Map();
            }
            if (!node.blockedNeighbors.has(dir)) {
                node.blockedNeighbors.set(dir, new Set());
            }
            node.blockedNeighbors.get(dir).add(this);
            this.blockedLinks.push({ node, direction: dir });
            this._blockedLinkKeys.add(key);
            // Wall edge added — update clearance for large-entity pathfinding.
            if (typeof globalThis !== "undefined" && globalThis.map &&
                !globalThis.map._suppressClearanceUpdates &&
                typeof globalThis.map.updateClearanceAround === "function") {
                globalThis.map.updateClearanceAround(node);
            }
            return true;
        }

        _blockConnectionBetween(nodeA, nodeB, blockedConnectionKeySet, blockedConnectionsOut) {
            if (!WallSectionUnit._isMapNode(nodeA) || !WallSectionUnit._isMapNode(nodeB)) return false;
            if (!Array.isArray(nodeA.neighbors) || !Array.isArray(nodeB.neighbors)) return false;

            const dirA = nodeA.neighbors.indexOf(nodeB);
            const dirB = nodeB.neighbors.indexOf(nodeA);
            if (dirA < 0 && dirB < 0) return false;

            let changed = false;
            if (dirA >= 0) changed = this._addBlockedLink(nodeA, dirA) || changed;
            if (dirB >= 0) changed = this._addBlockedLink(nodeB, dirB) || changed;

            if (changed && blockedConnectionKeySet instanceof Set && Array.isArray(blockedConnectionsOut)) {
                const keyA = this._nodeKey(nodeA);
                const keyB = this._nodeKey(nodeB);
                if (keyA && keyB) {
                    const edgeKey = (keyA <= keyB) ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
                    if (!blockedConnectionKeySet.has(edgeKey)) {
                        blockedConnectionKeySet.add(edgeKey);
                        blockedConnectionsOut.push({ a: nodeA, b: nodeB });
                    }
                }
            }

            return changed;
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

        _connectionCrossesWallCenterline(nodeA, nodeB) {
            const mapRef = this.map || null;
            const origin = this.startPoint;
            const wallStart = this._toLocalFromOrigin(origin, this.startPoint, mapRef);
            const wallEnd = this._toLocalFromOrigin(origin, this.endPoint, mapRef);
            const segStart = this._toLocalFromOrigin(origin, nodeA, mapRef);
            const segEnd = this._toLocalFromOrigin(origin, nodeB, mapRef);
            if (!wallStart || !wallEnd || !segStart || !segEnd) return false;

            const wx = wallEnd.x - wallStart.x;
            const wy = wallEnd.y - wallStart.y;
            const wallLen = Math.hypot(wx, wy);
            const segLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y);
            if (!(wallLen > EPS) || !(segLen > EPS)) return false;

            const ux = wx / wallLen;
            const uy = wy / wallLen;
            const halfHexToEdge = (mapRef && Number.isFinite(mapRef.hexHeight))
                ? (Number(mapRef.hexHeight) * 0.5)
                : 0.5;
            const endpointOvershoot = 0.001;
            const extend = Math.max(0, halfHexToEdge) + endpointOvershoot;

            const extendedWallStart = {
                x: wallStart.x - ux * extend,
                y: wallStart.y - uy * extend
            };
            const extendedWallEnd = {
                x: wallEnd.x + ux * extend,
                y: wallEnd.y + uy * extend
            };

            return WallSectionUnit._segmentsIntersect2D(extendedWallStart, extendedWallEnd, segStart, segEnd, EPS);
        }

        _collectCenterlineMapNodes() {
            const mapRef = this.map || null;
            if (!mapRef || typeof mapRef.getHexLine !== "function") return [];
            const line = mapRef.getHexLine(this.startPoint, this.endPoint, 0);
            if (!Array.isArray(line) || line.length === 0) return [];

            const out = [];
            const seen = new Set();
            for (let i = 0; i < line.length; i++) {
                const item = line[i];
                if (!WallSectionUnit._isMapNode(item)) continue;
                const key = this._nodeKey(item);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                out.push(item);
            }
            return out;
        }

        _collectOddNeighborsOfNode(node, outMap) {
            if (!WallSectionUnit._isMapNode(node) || !(outMap instanceof Map)) return;
            if (!Array.isArray(node.neighbors)) return;
            for (let d = 1; d < 12; d += 2) {
                const neighbor = node.neighbors[d];
                if (!WallSectionUnit._isMapNode(neighbor)) continue;
                const key = this._nodeKey(neighbor);
                if (!key || outMap.has(key)) continue;
                outMap.set(key, neighbor);
            }
        }

        _applyDirectionalBlocking() {
            this._clearDirectionalBlocks();

            const centerlineNodes = this._collectCenterlineMapNodes();
            if (centerlineNodes.length === 0) return;

            const centerlineNodeKeySet = new Set(centerlineNodes.map(node => this._nodeKey(node)));
            const oddNeighborsAll = new Map();
            const blockedConnectionKeys = new Set();
            const blockedConnections = [];

            // First pass: block all links touching centerline nodes.
            for (let i = 0; i < centerlineNodes.length; i++) {
                const node = centerlineNodes[i];
                if (!node || !Array.isArray(node.neighbors)) continue;
                for (let dir = 0; dir < 12; dir++) {
                    const neighbor = node.neighbors[dir];
                    if (!WallSectionUnit._isMapNode(neighbor)) continue;
                    this._blockConnectionBetween(node, neighbor, blockedConnectionKeys, blockedConnections);
                }
                this._collectOddNeighborsOfNode(node, oddNeighborsAll);
            }

            // Second pass: sequential odd-neighbor crossing checks.
            for (let i = 0; i < centerlineNodes.length - 1; i++) {
                const nodeA = centerlineNodes[i];
                const nodeB = centerlineNodes[i + 1];
                if (!nodeA || !nodeB) continue;

                const localNeighbors = new Map();
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
                        if (centerlineNodeKeySet.has(keyA) || centerlineNodeKeySet.has(keyB)) continue;
                        if (!this._connectionCrossesWallCenterline(neighborNode, other)) continue;
                        this._blockConnectionBetween(neighborNode, other, blockedConnectionKeys, blockedConnections);
                    }
                });
            }

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

            const line = mapRef.getHexLine(start, end, 0);
            if (!Array.isArray(line) || line.length === 0) return [];

            const anchors = [];
            const seen = new Set();
            const pushAnchor = (anchor) => {
                if (!anchor) return;
                const tRaw = this._parameterForWorldPointOnSection(anchor);
                if (!Number.isFinite(tRaw)) return;
                const t = Math.max(0, Math.min(1, Number(tRaw)));
                const key = WallSectionUnit.endpointKey(anchor);
                if (!key || seen.has(key)) return;
                seen.add(key);
                anchors.push({
                    anchor,
                    t,
                    key,
                    isEndpoint: WallSectionUnit._pointsMatch(anchor, start) || WallSectionUnit._pointsMatch(anchor, end)
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

            this._removeWallPreserving(Array.from(usedObjects));

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

        _removeWallPreserving(listToPreserve = []) {
            if (this.gone) return;
            const preserveSet = new Set(Array.isArray(listToPreserve) ? listToPreserve : []);

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

            for (let i = 0; i < neighbors.length; i++) {
                const neighbor = neighbors[i];
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
            if (typeof this.script !== "undefined") {
                try {
                    data.script = JSON.parse(JSON.stringify(this.script));
                } catch (_err) {
                    data.script = this.script;
                }
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
                if (Object.prototype.hasOwnProperty.call(data, "script")) {
                    section.script = data.script;
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
    globalScope.resetWallDepthGeometryBudget = function () {
        WallSectionUnit._depthGeometryRebuildBudgetThisFrame = WallSectionUnit._depthGeometryRebuildBudgetPerFrame;
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
