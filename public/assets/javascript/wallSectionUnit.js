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
            for (const section of WallSectionUnit._allSections.values()) {
                if (!section) continue;
                section._depthGeometryCache = null;
            }
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

            // PIXI display object — a Graphics that draws the base outline.
            this.pixiSprite = (typeof PIXI !== "undefined" && PIXI.Graphics)
                ? new PIXI.Graphics()
                : null;
            this.skipTransform = true;

            this.setEndpoints(startPoint, endPoint, options.map || null);

            // Register in global section registry.
            WallSectionUnit._allSections.set(this.id, this);

            // Solve joinery at both endpoints now that this section exists.
            this.handleJoineryOnPlacement();
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
            if (!WallSectionUnit._optionalNumericEqual(sectionA.texturePhaseA, sectionB.texturePhaseA, 1e-5)) return false;
            if (!WallSectionUnit._optionalNumericEqual(sectionA.texturePhaseB, sectionB.texturePhaseB, 1e-5)) return false;

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

        static _snapToNearestPlacementAnchor(mapRef, point) {
            if (!mapRef || !point) return null;
            const px = Number(point.x);
            const py = Number(point.y);
            if (!Number.isFinite(px) || !Number.isFinite(py)) return null;

            // Always snap to full MapNodes — midpoints are not valid
            // wall segment start/end anchors (except for single-diagonal
            // endpoints, handled in planPlacementFromWorldPoints).
            if (typeof mapRef.worldToNode === "function") {
                return mapRef.worldToNode(px, py);
            }
            return null;
        }

        static planPlacementFromWorldPoints(mapRef, startWorld, endWorld, options = {}) {
            if (!mapRef || !startWorld || !endWorld) return null;
            if (!Number.isFinite(startWorld.x) || !Number.isFinite(startWorld.y)) return null;
            if (!Number.isFinite(endWorld.x) || !Number.isFinite(endWorld.y)) return null;

            const startNode = WallSectionUnit._snapToNearestPlacementAnchor(mapRef, startWorld);
            if (!startNode) return null;

            const shortDx = (typeof mapRef.shortestDeltaX === "function")
                ? (a, b) => mapRef.shortestDeltaX(a, b) : (a, b) => (b - a);
            const shortDy = (typeof mapRef.shortestDeltaY === "function")
                ? (a, b) => mapRef.shortestDeltaY(a, b) : (a, b) => (b - a);

            // ── Midpoint pre-check ────────────────────────────────────────
            // Compute the raw direction from startNode toward the mouse.
            // Walk along that direction and see if the mouse is closer to
            // any midpoint along the way than to the two flanking full
            // nodes. This must happen BEFORE the normal endNode snap
            // because worldToNode can snap midpoint intent to a nearby node.
            const rawDx = shortDx(startNode.x, endWorld.x);
            const rawDy = shortDy(startNode.y, endWorld.y);
            const rawDir = WallSectionUnit._normalizeDirection(
                (typeof mapRef.getHexDirection === "function") ? mapRef.getHexDirection(rawDx, rawDy) : 0
            );

            if (typeof mapRef.worldToNodeOrMidpoint === "function") {
                const rawVec = WallSectionUnit._directionUnitVector(rawDir, mapRef, startNode);
                // Project mouse onto the ray from startNode.
                const projLen = (rawDx * rawVec.x) + (rawDy * rawVec.y);
                if (projLen > EPS) {
                    // Walk along the chosen direction from startNode until we
                    // overshoot the projected distance.
                    let walkNode = startNode;
                    let walkDist = 0;
                    const maxSteps = 200;
                    for (let step = 0; step < maxSteps; step++) {
                        if (!WallSectionUnit._isMapNode(walkNode) ||
                            !Array.isArray(walkNode.neighbors) ||
                            !walkNode.neighbors[rawDir]) break;
                        const nextNode = walkNode.neighbors[rawDir];
                        const segDx = shortDx(walkNode.x, nextNode.x);
                        const segDy = shortDy(walkNode.y, nextNode.y);
                        const segLen = Math.hypot(segDx, segDy);
                        // The midpoint of this segment along the direction.
                        const midWorldX = walkNode.x + segDx * 0.5;
                        const midWorldY = walkNode.y + segDy * 0.5;
                        const midCandidate = mapRef.worldToNodeOrMidpoint(midWorldX, midWorldY);
                        if (midCandidate && WallSectionUnit._isNodeMidpoint(midCandidate)) {
                            const distMouseToMid = Math.hypot(
                                shortDx(endWorld.x, midCandidate.x),
                                shortDy(endWorld.y, midCandidate.y)
                            );
                            // Also measure distance to the two flanking nodes.
                            const distMouseToWalk = Math.hypot(
                                shortDx(endWorld.x, walkNode.x),
                                shortDy(endWorld.y, walkNode.y)
                            );
                            const distMouseToNext = Math.hypot(
                                shortDx(endWorld.x, nextNode.x),
                                shortDy(endWorld.y, nextNode.y)
                            );
                            if (distMouseToMid * 1.4 < distMouseToWalk && distMouseToMid * 1.4 < distMouseToNext) {
                                // Mouse is closest to this midpoint — use it.
                                return {
                                    start: startNode,
                                    end: midCandidate,
                                    junction: null,
                                    primaryDirection: rawDir,
                                    secondaryDirection: null,
                                    segments: [{
                                        start: startNode,
                                        end: midCandidate,
                                        direction: rawDir
                                    }]
                                };
                            }
                        }
                        walkDist += segLen;
                        if (walkDist > projLen + segLen) break; // past the mouse
                        walkNode = nextNode;
                    }
                }
            }
            // ── End midpoint pre-check ────────────────────────────────────

            const endNode = WallSectionUnit._snapToNearestPlacementAnchor(mapRef, endWorld);
            if (!endNode) return null;

            if (WallSectionUnit._pointsMatch(startNode, endNode)) {
                return {
                    start: startNode,
                    end: endNode,
                    junction: null,
                    primaryDirection: null,
                    secondaryDirection: null,
                    segments: []
                };
            }

            const dx = (typeof mapRef.shortestDeltaX === "function")
                ? mapRef.shortestDeltaX(startNode.x, endNode.x)
                : (endNode.x - startNode.x);
            const dy = (typeof mapRef.shortestDeltaY === "function")
                ? mapRef.shortestDeltaY(startNode.y, endNode.y)
                : (endNode.y - startNode.y);

            const primaryDirection = WallSectionUnit._normalizeDirection(
                (typeof mapRef.getHexDirection === "function") ? mapRef.getHexDirection(dx, dy) : 0
            );
            const primaryVec = WallSectionUnit._directionUnitVector(primaryDirection, mapRef, startNode);
            const toTarget = { x: dx, y: dy };
            const sideCross = (primaryVec.x * toTarget.y) - (primaryVec.y * toTarget.x);
            const sideTolerance = Number.isFinite(options.sideTolerance)
                ? Math.max(EPS, Number(options.sideTolerance))
                : 1e-5;

            // Target lies on primary ray: one segment is enough.
            if (Math.abs(sideCross) <= sideTolerance) {
                return {
                    start: startNode,
                    end: endNode,
                    junction: null,
                    primaryDirection,
                    secondaryDirection: null,
                    segments: [
                        {
                            start: startNode,
                            end: endNode,
                            direction: primaryDirection
                        }
                    ]
                };
            }

            // The secondary direction is the primary offset by ±1 toward
            // whichever side the target lies on.
            //   target misses left  (sideCross > 0) => +1
            //   target misses right (sideCross < 0) => +11 (i.e. -1)
            const missesLeft = sideCross > 0;
            const secondaryDirection = WallSectionUnit._normalizeDirection(
                primaryDirection + (missesLeft ? 1 : 11)
            );
            const secondaryVec = WallSectionUnit._directionUnitVector(secondaryDirection, mapRef, endNode);

            const hit = WallSectionUnit._lineIntersection(
                { x: startNode.x, y: startNode.y },
                primaryVec,
                { x: endNode.x, y: endNode.y },
                secondaryVec
            );

            // Snap junction to nearest node or midpoint.
            let junction = null;
            if (hit && Number.isFinite(hit.x) && Number.isFinite(hit.y)) {
                junction = (typeof mapRef.worldToNodeOrMidpoint === "function")
                    ? mapRef.worldToNodeOrMidpoint(hit.x, hit.y)
                    : WallSectionUnit.normalizeEndpoint(hit, mapRef);
                // Collapse if junction coincides with start or end.
                if (junction && (WallSectionUnit._pointsMatch(junction, startNode) || WallSectionUnit._pointsMatch(junction, endNode))) {
                    junction = null;
                }
            }

            if (!junction) {
                // No valid junction — draw two segments using the
                // calculated directions anyway (no fallback to a
                // single arbitrary segment).
                return {
                    start: startNode,
                    end: endNode,
                    junction: null,
                    primaryDirection,
                    secondaryDirection,
                    segments: [
                        {
                            start: startNode,
                            end: endNode,
                            direction: primaryDirection
                        },
                        {
                            start: endNode,
                            end: startNode,
                            direction: secondaryDirection
                        }
                    ]
                };
            }

            return {
                start: startNode,
                end: endNode,
                junction,
                primaryDirection,
                secondaryDirection,
                segments: [
                    {
                        start: startNode,
                        end: junction,
                        direction: primaryDirection
                    },
                    {
                        start: junction,
                        end: endNode,
                        direction: secondaryDirection
                    }
                ]
            };
        }

        static createPlacementFromWorldPoints(mapRef, startWorld, endWorld, options = {}) {
            const plan = WallSectionUnit.planPlacementFromWorldPoints(mapRef, startWorld, endWorld, options);
            if (!plan || !Array.isArray(plan.segments) || plan.segments.length === 0) {
                return { plan, sections: [] };
            }

            const sections = [];
            for (let i = 0; i < plan.segments.length; i++) {
                const seg = plan.segments[i];
                if (!seg || !seg.start || !seg.end) continue;
                if (WallSectionUnit._pointsMatch(seg.start, seg.end)) continue;
                const section = new WallSectionUnit(seg.start, seg.end, {
                    map: mapRef,
                    height: Number.isFinite(options.height) ? Number(options.height) : 1,
                    thickness: Number.isFinite(options.thickness) ? Number(options.thickness) : 0.1,
                    bottomZ: Number.isFinite(options.bottomZ) ? Number(options.bottomZ) : 0
                });
                section.direction = WallSectionUnit._normalizeDirection(seg.direction);
                section.lineAxis = (((section.direction % 6) + 6) % 6);
                section.rebuildMesh3d();
                sections.push(section);
            }

            const mergedSections = WallSectionUnit.autoMergeContinuousSections(sections);

            if (mergedSections.length >= 2) {
                for (let i = 0; i < mergedSections.length - 1; i++) {
                    mergedSections[i].connectTo(mergedSections[i + 1], { placementChain: true });
                    mergedSections[i + 1].connectTo(mergedSections[i], { placementChain: true });
                }
            }

            if (options.addToMapObjects === true && mapRef && Array.isArray(mapRef.objects)) {
                for (let i = 0; i < mergedSections.length; i++) {
                    if (!mapRef.objects.includes(mergedSections[i])) {
                        mapRef.objects.push(mergedSections[i]);
                    }
                }
            }

            return { plan, sections: mergedSections };
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

        _buildDepthGeometry() {
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

            let vertexChecksum = 0;
            let indexChecksum = 0;
            for (let i = 0; i < vertices.length; i++) {
                const v = Number(vertices[i]) || 0;
                vertexChecksum += v * ((i % 7) + 1);
            }
            for (let i = 0; i < indices.length; i++) {
                const idx = Number(indices[i]) || 0;
                indexChecksum += idx * ((i % 5) + 1);
            }
            const geometryKey = [
                String(mesh3d.id || this.id),
                String(vertices.length),
                String(indices.length),
                Number(vertexChecksum).toFixed(4),
                Number(indexChecksum).toFixed(4),
                Number(repeatX).toFixed(6),
                Number(repeatY).toFixed(6),
                wallTextureCfg.texturePath || this.wallTexturePath || DEFAULT_WALL_TEXTURE
            ].join("|");
            if (this._depthGeometryCache && this._depthGeometryCache.key === geometryKey) {
                return this._depthGeometryCache.geometry;
            }

            const sx = Number(this.startPoint && this.startPoint.x);
            const sy = Number(this.startPoint && this.startPoint.y);
            const ex = Number(this.endPoint && this.endPoint.x);
            const ey = Number(this.endPoint && this.endPoint.y);
            const dx = (Number.isFinite(ex) && Number.isFinite(sx)) ? (ex - sx) : 1;
            const dy = (Number.isFinite(ey) && Number.isFinite(sy)) ? (ey - sy) : 0;
            const dirLen = Math.hypot(dx, dy) || 1;
            const ux = dx / dirLen;
            const uy = dy / dirLen;
            const vx = -uy;
            const vy = ux;
            const baseX = Number.isFinite(sx) ? sx : 0;
            const baseY = Number.isFinite(sy) ? sy : 0;
            const bottomZ = Number.isFinite(this.bottomZ) ? Number(this.bottomZ) : 0;

            const vertexCount = Math.floor(vertices.length / 3);
            const alongPerVertex = new Float32Array(vertexCount);
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
                    const along = Number(alongPerVertex[srcVertex]) || 0;
                    const across = Number(acrossPerVertex[srcVertex]) || 0;
                    const height = Number(heightPerVertex[srcVertex]) || 0;
                    if (isTopFaceTri) {
                        const acrossNorm = (across - topAcrossMin) / Math.max(1e-6, (topAcrossMax - topAcrossMin));
                        expandedUvs[dstUv] = along * repeatX;
                        expandedUvs[dstUv + 1] = topTextureVMin + Math.max(0, Math.min(1, acrossNorm)) * topTextureVSpan;
                    } else if (capFace) {
                        expandedUvs[dstUv] = across * repeatX;
                        expandedUvs[dstUv + 1] = height * repeatY;
                    } else {
                        expandedUvs[dstUv] = along * repeatX;
                        expandedUvs[dstUv + 1] = height * repeatY;
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
            this._depthGeometryCache = { key: geometryKey, geometry };
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
            const geometry = this._buildDepthGeometry();
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

        getWallProfile() {
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

            let aLeft = { x: sx + nx * halfT, y: sy + ny * halfT };
            let aRight = { x: sx - nx * halfT, y: sy - ny * halfT };
            let bLeft = { x: ex + nx * halfT, y: ey + ny * halfT };
            let bRight = { x: ex - nx * halfT, y: ey - ny * halfT };

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
                    }
                }
            }
            this.blockedLinks = [];
            if (!(this._blockedLinkKeys instanceof Set)) this._blockedLinkKeys = new Set();
            this._blockedLinkKeys.clear();
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
            return {
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
        }

        static loadJson(data, mapRef) {
            if (!data || data.type !== "wallSection" || !mapRef) return null;
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
                    texturePhaseB: Number.isFinite(data.texturePhaseB) ? Number(data.texturePhaseB) : NaN
                });
                if (Number.isFinite(data.direction)) {
                    section.direction = WallSectionUnit._normalizeDirection(data.direction);
                }
                if (Number.isFinite(data.lineAxis)) {
                    section.lineAxis = Number(data.lineAxis);
                }
                section.addToMapNodes();
                section.rebuildMesh3d();
                return section;
            } catch (e) {
                console.error("Error loading wallSection:", e);
                return null;
            }
        }
    }

    globalScope.WallSectionUnit = WallSectionUnit;
    globalScope.setWallSectionDirectionalBlockingDebug = function (enabled) {
        WallSectionUnit.setShowDirectionalBlockingDebug(enabled);
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
