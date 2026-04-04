(function (globalScope) {
    "use strict";

    const SECTION_DIRECTIONS = [
        { q: 1, r: 0 },
        { q: 1, r: -1 },
        { q: 0, r: -1 },
        { q: -1, r: 0 },
        { q: -1, r: 1 },
        { q: 0, r: 1 }
    ];
    // Bubble shifts touch many records at once, but only a few object types are
    // expensive enough to justify keeping detached runtimes alive between shifts.
    const PROTOTYPE_PARKED_OBJECT_LIMITS = Object.freeze({
        road: 1536,
        tree: 768
    });
    const PROTOTYPE_SCRIPTING_NAME_PATTERN = /^[A-Za-z_$][\w$]*$/;

    function getPrototypeParkedObjectCacheLimit(type) {
        const key = (typeof type === "string") ? type : "";
        return Number(PROTOTYPE_PARKED_OBJECT_LIMITS[key]) || 0;
    }

    function shouldParkPrototypeRuntimeObject(runtimeObj) {
        if (!runtimeObj || runtimeObj.gone || runtimeObj.vanishing) return false;
        if (runtimeObj._prototypeDirty === true) return false;
        if (runtimeObj.type === "road") return true;
        if (runtimeObj.type !== "tree") return false;
        if (runtimeObj.isOnFire || runtimeObj.falling || runtimeObj.isGrowing) return false;
        return true;
    }

    function canReusePrototypeParkedRuntimeObject(runtimeObj, expectedType, expectedSignature) {
        if (!runtimeObj || runtimeObj._prototypeParked !== true) return false;
        if (runtimeObj.gone || runtimeObj.vanishing) return false;
        if ((typeof expectedType === "string" && expectedType.length > 0) && runtimeObj.type !== expectedType) {
            return false;
        }
        const parkedSignature = (typeof runtimeObj._prototypePersistenceSignature === "string")
            ? runtimeObj._prototypePersistenceSignature
            : "";
        return parkedSignature === ((typeof expectedSignature === "string") ? expectedSignature : "");
    }

    function normalizePrototypeScriptingName(rawName) {
        const trimmed = String(rawName || "").trim();
        return PROTOTYPE_SCRIPTING_NAME_PATTERN.test(trimmed) ? trimmed : "";
    }

    function evenQOffsetToAxial(x, y) {
        return {
            q: x,
            r: y - ((x + (x & 1)) / 2)
        };
    }

    function axialToEvenQOffset(coord) {
        const q = Number(coord.q) || 0;
        const r = Number(coord.r) || 0;
        return {
            x: q,
            y: r + ((q + (q & 1)) / 2)
        };
    }

    function offsetToWorld(offsetCoord) {
        const x = Number(offsetCoord && offsetCoord.x) || 0;
        const y = Number(offsetCoord && offsetCoord.y) || 0;
        return {
            x: x * 0.866,
            y: y + (x % 2 === 0 ? 0.5 : 0)
        };
    }

    function axialDistance(a, b) {
        const dq = Number(a.q) - Number(b.q);
        const dr = Number(a.r) - Number(b.r);
        const ds = (-Number(a.q) - Number(a.r)) - (-Number(b.q) - Number(b.r));
        return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
    }

    function getSectionStride(radius) {
        return Math.max(1, Math.floor(Number(radius) || 1) * 2 - 1);
    }

    function getSectionBasisVectors(radius) {
        const sectionRadius = Math.max(1, Math.floor(Number(radius)) || 1);
        return {
            qAxis: {
                q: getSectionStride(sectionRadius),
                r: -(sectionRadius - 1)
            },
            rAxis: {
                q: sectionRadius - 1,
                r: sectionRadius
            }
        };
    }

    function computeSectionCenterAxial(sectionCoord, basis, anchorCenter) {
        return {
            q: (Number(anchorCenter && anchorCenter.q) || 0)
                + ((Number(sectionCoord && sectionCoord.q) || 0) * (Number(basis && basis.qAxis && basis.qAxis.q) || 0))
                + ((Number(sectionCoord && sectionCoord.r) || 0) * (Number(basis && basis.rAxis && basis.rAxis.q) || 0)),
            r: (Number(anchorCenter && anchorCenter.r) || 0)
                + ((Number(sectionCoord && sectionCoord.q) || 0) * (Number(basis && basis.qAxis && basis.qAxis.r) || 0))
                + ((Number(sectionCoord && sectionCoord.r) || 0) * (Number(basis && basis.rAxis && basis.rAxis.r) || 0))
        };
    }

    function estimateOffsetCoordFromWorld(worldX, worldY) {
        const x = Math.round((Number(worldX) || 0) / 0.866);
        const y = Math.round((Number(worldY) || 0) - (x % 2 === 0 ? 0.5 : 0));
        return { x, y };
    }

    function resolvePrototypeSectionCoordForWorldPosition(state, worldX, worldY) {
        if (!state) return null;
        const basis = state.basis || getSectionBasisVectors(state.radius);
        const anchorCenter = state.anchorCenter || { q: 0, r: 0 };
        const offsetCoord = estimateOffsetCoordFromWorld(worldX, worldY);
        const axial = evenQOffsetToAxial(offsetCoord.x, offsetCoord.y);
        const localQ = Number(axial.q) - Number(anchorCenter.q || 0);
        const localR = Number(axial.r) - Number(anchorCenter.r || 0);
        const qAxis = basis && basis.qAxis ? basis.qAxis : { q: 0, r: 0 };
        const rAxis = basis && basis.rAxis ? basis.rAxis : { q: 0, r: 0 };
        const det = (Number(qAxis.q) * Number(rAxis.r)) - (Number(rAxis.q) * Number(qAxis.r));

        let approxSectionQ = 0;
        let approxSectionR = 0;
        if (Math.abs(det) > 1e-6) {
            approxSectionQ = ((localQ * Number(rAxis.r)) - (localR * Number(rAxis.q))) / det;
            approxSectionR = ((Number(qAxis.q) * localR) - (Number(qAxis.r) * localQ)) / det;
        }

        const baseQ = Math.round(approxSectionQ);
        const baseR = Math.round(approxSectionR);
        let bestCoord = { q: baseQ, r: baseR };
        let bestAxialDistance = Infinity;
        let bestWorldDistance = Infinity;

        for (let dq = -1; dq <= 1; dq++) {
            for (let dr = -1; dr <= 1; dr++) {
                const candidate = { q: baseQ + dq, r: baseR + dr };
                const centerAxial = computeSectionCenterAxial(candidate, basis, anchorCenter);
                const centerOffset = axialToEvenQOffset(centerAxial);
                const centerWorld = offsetToWorld(centerOffset);
                const candidateAxialDistance = axialDistance(axial, centerAxial);
                const candidateWorldDistance = Math.hypot(
                    Number(worldX) - Number(centerWorld.x),
                    Number(worldY) - Number(centerWorld.y)
                );
                if (
                    candidateAxialDistance < bestAxialDistance ||
                    (candidateAxialDistance === bestAxialDistance && candidateWorldDistance < bestWorldDistance)
                ) {
                    bestCoord = candidate;
                    bestAxialDistance = candidateAxialDistance;
                    bestWorldDistance = candidateWorldDistance;
                }
            }
        }

        return bestCoord;
    }

    function makeSectionKey(coord) {
        return `${Number(coord.q) || 0},${Number(coord.r) || 0}`;
    }

    function addSectionCoords(a, b) {
        return {
            q: (Number(a.q) || 0) + (Number(b.q) || 0),
            r: (Number(a.r) || 0) + (Number(b.r) || 0)
        };
    }

    function hashCoordinatePair(x, y, seed) {
        let h = ((Number(x) || 0) * 374761393) + ((Number(y) || 0) * 668265263) + ((Number(seed) || 0) * 1442695041);
        h = (h ^ (h >>> 13)) >>> 0;
        h = Math.imul(h, 1274126177) >>> 0;
        return (h ^ (h >>> 16)) >>> 0;
    }

    function hashToUnitFloat(hash) {
        return (hash >>> 0) / 4294967295;
    }

    function getPrototypeGroundTextureCount(map) {
        if (map && Array.isArray(map.groundTextures) && map.groundTextures.length > 0) {
            return map.groundTextures.length;
        }
        if (map && Array.isArray(map.groundPalette) && map.groundPalette.length > 0) {
            return map.groundPalette.length;
        }
        return 1;
    }

    function pickPrototypeGroundTextureId(x, y, textureCount) {
        const count = Math.max(1, Math.floor(Number(textureCount)) || 1);
        if (count <= 1) return 0;

        const patchHash = hashCoordinatePair(Math.floor((Number(x) || 0) / 5), Math.floor((Number(y) || 0) / 4), 11);
        const bandHash = hashCoordinatePair(Math.floor(((Number(x) || 0) - (Number(y) || 0)) / 6), Math.floor(((Number(x) || 0) + (Number(y) || 0)) / 6), 23);
        const detailHash = hashCoordinatePair(Number(x) || 0, Number(y) || 0, 41);
        const selector = hashToUnitFloat(hashCoordinatePair(Number(x) || 0, Number(y) || 0, 67));

        let chosenHash = patchHash;
        if (selector > 0.72) {
            chosenHash = detailHash;
        } else if (selector > 0.38) {
            chosenHash = bandHash;
        }

        return chosenHash % count;
    }

    function normalizePrototypeGroundTiles(rawGroundTiles, tileCoordKeys, textureCount) {
        const count = Math.max(1, Math.floor(Number(textureCount)) || 1);
        const normalized = {};
        const coords = Array.isArray(tileCoordKeys) ? tileCoordKeys : [];
        const source = (rawGroundTiles && typeof rawGroundTiles === "object") ? rawGroundTiles : null;

        for (let i = 0; i < coords.length; i++) {
            const coordKey = coords[i];
            if (typeof coordKey !== "string" || coordKey.length === 0) continue;
            const [xRaw, yRaw] = coordKey.split(",");
            const fallbackTextureId = pickPrototypeGroundTextureId(Number(xRaw), Number(yRaw), count);
            const rawValue = source ? source[coordKey] : undefined;
            const nextTextureId = Number.isFinite(rawValue)
                ? Math.max(0, Math.min(count - 1, Math.floor(Number(rawValue))))
                : fallbackTextureId;
            normalized[coordKey] = nextTextureId;
        }

        return normalized;
    }

    function clonePrototypeBlockedEdges(rawBlockedEdges) {
        if (!Array.isArray(rawBlockedEdges)) return [];
        const cloned = [];
        for (let i = 0; i < rawBlockedEdges.length; i++) {
            const edge = rawBlockedEdges[i];
            if (!edge || typeof edge !== "object") continue;
            const a = edge.a && typeof edge.a === "object"
                ? { xindex: Number(edge.a.xindex), yindex: Number(edge.a.yindex) }
                : null;
            const b = edge.b && typeof edge.b === "object"
                ? { xindex: Number(edge.b.xindex), yindex: Number(edge.b.yindex) }
                : null;
            const recordId = Number(edge.recordId);
            if (!a || !b || !Number.isInteger(recordId)) continue;
            cloned.push({ recordId, a, b });
        }
        return cloned;
    }

    function clonePrototypeClearanceByTile(rawClearanceByTile) {
        if (!rawClearanceByTile || typeof rawClearanceByTile !== "object") return {};
        const cloned = {};
        const entries = Object.entries(rawClearanceByTile);
        for (let i = 0; i < entries.length; i++) {
            const [coordKey, rawValue] = entries[i];
            if (typeof coordKey !== "string" || coordKey.length === 0) continue;
            if (rawValue === null) {
                cloned[coordKey] = null;
                continue;
            }
            const numeric = Number(rawValue);
            cloned[coordKey] = Number.isFinite(numeric) ? numeric : null;
        }
        return cloned;
    }

    function prototypeHasActiveDirectionalBlockers(blockers) {
        if (!(blockers instanceof Set) || blockers.size === 0) return false;
        for (const blocker of blockers) {
            if (!blocker || blocker.gone) continue;
            const sinkState = (blocker && blocker._scriptSinkState && typeof blocker._scriptSinkState === "object")
                ? blocker._scriptSinkState
                : null;
            if (sinkState && sinkState.nonBlocking !== false) continue;
            return true;
        }
        return false;
    }

    function getPrototypeObjectProfileKey(record) {
        if (!record || typeof record !== "object") return "unknown";
        const type = (typeof record.type === "string" && record.type.trim().length > 0)
            ? record.type.trim().toLowerCase()
            : "";
        const category = (typeof record.category === "string" && record.category.trim().length > 0)
            ? record.category.trim().toLowerCase()
            : "";
        if (type === "tree" || category === "trees") return "tree";
        if (type === "roof") return "roof";
        if (type === "flower" || category === "flowers") return "flower";
        if (type === "door" || category === "doors") return "door";
        if (type === "window" || category === "windows") return "window";
        if (type === "road" || category === "roads") return "road";
        if (type === "triggerarea" || category === "triggerareas") return "trigger";
        return type || category || "unknown";
    }

    function formatPrototypeObjectProfileMap(profileMap) {
        const out = {};
        if (!(profileMap instanceof Map)) return out;
        for (const [key, stats] of profileMap.entries()) {
            if (!stats || typeof stats !== "object") continue;
            out[key] = {
                loaded: Number(stats.loaded) || 0,
                removed: Number(stats.removed) || 0,
                ms: Number((Number(stats.ms) || 0).toFixed(2))
            };
        }
        return out;
    }

    function getPrototypeConfig() {
        const startupConfig = (globalScope.RUNAROUND_STARTUP_CONFIG && typeof globalScope.RUNAROUND_STARTUP_CONFIG === "object")
            ? globalScope.RUNAROUND_STARTUP_CONFIG
            : {};
        return {
            sectionRadius: Number.isFinite(startupConfig.sectionRadius)
                ? Math.max(3, Math.floor(startupConfig.sectionRadius))
                : 10,
            sectionGraphRadius: Number.isFinite(startupConfig.sectionGraphRadius)
                ? Math.max(0, Math.floor(startupConfig.sectionGraphRadius))
                : 2,
            sectionAssetUrl: (typeof startupConfig.prototypeSectionAssetUrl === "string" && startupConfig.prototypeSectionAssetUrl.length > 0)
                ? startupConfig.prototypeSectionAssetUrl
                : "",
            fallbackSectionAssetUrl: (typeof startupConfig.prototypeSectionFallbackAssetUrl === "string" && startupConfig.prototypeSectionFallbackAssetUrl.length > 0)
                ? startupConfig.prototypeSectionFallbackAssetUrl
                : ""
        };
    }

    function getSectionCoordsInRingRange(graphRadius) {
        const coords = [];
        const limit = Math.max(0, Math.floor(Number(graphRadius)) || 0);
        for (let q = -limit; q <= limit; q++) {
            for (let r = -limit; r <= limit; r++) {
                const s = -q - r;
                if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > limit) continue;
                coords.push({ q, r });
            }
        }
        return coords;
    }

    function clearMapForPrototype(map) {
        if (!map || !Array.isArray(map.nodes)) return;

        if (typeof globalScope.animals !== "undefined" && Array.isArray(globalScope.animals)) {
            globalScope.animals.length = 0;
        }
        if (typeof globalScope.powerups !== "undefined" && Array.isArray(globalScope.powerups)) {
            globalScope.powerups.length = 0;
        }
        if (globalScope.WallSectionUnit && globalScope.WallSectionUnit._allSections instanceof Map) {
            globalScope.WallSectionUnit._allSections.clear();
        }

        map.objects = [];
        map.gameObjects = [];
        map._suppressClearanceUpdates = true;

        for (let x = 0; x < map.width; x++) {
            for (let y = 0; y < map.height; y++) {
                const node = map.nodes[x] && map.nodes[x][y];
                if (!node) continue;
                node.objects = [];
                node.visibilityObjects = [];
                node.blockedNeighbors = new Map();
                node.blockedByObjects = 0;
                node.blocked = true;
                node.clearance = 0;
                node.groundTextureId = 0;
                node._prototypeVoid = true;
                node._prototypeSectionKey = null;
                node._prototypeSectionActive = false;
            }
        }
    }

    function buildSectionRecords(config, map) {
        const basis = getSectionBasisVectors(config.sectionRadius);
        const anchorOffset = {
            x: Math.max(0, Math.floor((Number(map && map.width) || 0) * 0.5)),
            y: Math.max(0, Math.floor((Number(map && map.height) || 0) * 0.5))
        };
        const anchorCenter = evenQOffsetToAxial(anchorOffset.x, anchorOffset.y);
        const sectionCoords = getSectionCoordsInRingRange(config.sectionGraphRadius);
        const sectionsByKey = new Map();
        const orderedSections = [];

        for (let i = 0; i < sectionCoords.length; i++) {
            const sectionCoord = sectionCoords[i];
            const centerAxial = {
                q: anchorCenter.q + (sectionCoord.q * basis.qAxis.q) + (sectionCoord.r * basis.rAxis.q),
                r: anchorCenter.r + (sectionCoord.q * basis.qAxis.r) + (sectionCoord.r * basis.rAxis.r)
            };
            const centerOffset = axialToEvenQOffset(centerAxial);
            const section = {
                key: makeSectionKey(sectionCoord),
                coord: { q: sectionCoord.q, r: sectionCoord.r },
                centerAxial,
                centerOffset,
                centerWorld: offsetToWorld(centerOffset)
            };
            orderedSections.push(section);
            sectionsByKey.set(section.key, section);
        }

        return { basis, sectionCoords, sectionsByKey, orderedSections, anchorCenter };
    }

    function buildPrototypeSectionAssets(sectionRecords, radius) {
        const sectionsByKey = sectionRecords && sectionRecords.sectionsByKey instanceof Map
            ? sectionRecords.sectionsByKey
            : new Map();
        const orderedSections = Array.isArray(sectionRecords && sectionRecords.orderedSections)
            ? sectionRecords.orderedSections
            : [];
        const sectionAssetsByKey = new Map();
        const orderedSectionAssets = [];

        for (let i = 0; i < orderedSections.length; i++) {
            const section = orderedSections[i];
            if (!section) continue;
            const neighborKeys = [];
            for (let d = 0; d < SECTION_DIRECTIONS.length; d++) {
                const neighborCoord = addSectionCoords(section.coord, SECTION_DIRECTIONS[d]);
                const neighborKey = makeSectionKey(neighborCoord);
                neighborKeys.push(sectionsByKey.has(neighborKey) ? neighborKey : null);
            }

            const tileCoordKeys = [];
            for (let dq = -(radius - 1); dq <= (radius - 1); dq++) {
                for (let dr = -(radius - 1); dr <= (radius - 1); dr++) {
                    const axial = {
                        q: section.centerAxial.q + dq,
                        r: section.centerAxial.r + dr
                    };
                    if (axialDistance(axial, section.centerAxial) > (radius - 1)) continue;
                    const offset = axialToEvenQOffset(axial);
                    tileCoordKeys.push(`${offset.x},${offset.y}`);
                }
            }

            const asset = {
                id: section.key,
                key: section.key,
                coord: { q: section.coord.q, r: section.coord.r },
                centerAxial: { q: section.centerAxial.q, r: section.centerAxial.r },
                centerOffset: { x: section.centerOffset.x, y: section.centerOffset.y },
                centerWorld: { x: section.centerWorld.x, y: section.centerWorld.y },
                neighborKeys,
                tileCoordKeys,
                groundTextureId: 0,
                groundTiles: {},
                walls: [],
                blockedEdges: [],
                clearanceByTile: {},
                objects: [],
                animals: [],
                powerups: []
            };
            asset._prototypeBlockedEdgesDirty = false;
            asset._prototypeClearanceDirty = true;
            asset._prototypeNamedObjectRecordIdByName = new Map();
            asset._prototypeNamedObjectConflictRecordIdsByName = new Map();
            orderedSectionAssets.push(asset);
            sectionAssetsByKey.set(asset.key, asset);
        }

        return {
            sectionAssetsByKey,
            orderedSectionAssets
        };
    }

    function createPrototypeSectionAsset(state, sectionCoord, map) {
        if (!state || !sectionCoord) return null;
        const coord = {
            q: Number(sectionCoord.q) || 0,
            r: Number(sectionCoord.r) || 0
        };
        const key = makeSectionKey(coord);
        if (state.sectionAssetsByKey instanceof Map && state.sectionAssetsByKey.has(key)) {
            return state.sectionAssetsByKey.get(key) || null;
        }

        const basis = state.basis || getSectionBasisVectors(state.radius);
        const anchorCenter = state.anchorCenter || { q: 0, r: 0 };
        const centerAxial = computeSectionCenterAxial(coord, basis, anchorCenter);
        const centerOffset = axialToEvenQOffset(centerAxial);
        const centerWorld = offsetToWorld(centerOffset);
        const tileCoordKeys = [];
        for (let dq = -(state.radius - 1); dq <= (state.radius - 1); dq++) {
            for (let dr = -(state.radius - 1); dr <= (state.radius - 1); dr++) {
                const axial = {
                    q: centerAxial.q + dq,
                    r: centerAxial.r + dr
                };
                if (axialDistance(axial, centerAxial) > (state.radius - 1)) continue;
                const offset = axialToEvenQOffset(axial);
                tileCoordKeys.push(`${offset.x},${offset.y}`);
            }
        }

        const neighborKeys = SECTION_DIRECTIONS.map((direction) => makeSectionKey(addSectionCoords(coord, direction)));
        const asset = {
            id: key,
            key,
            coord,
            centerAxial,
            centerOffset,
            centerWorld,
            neighborKeys,
            tileCoordKeys,
            groundTextureId: 0,
            groundTiles: normalizePrototypeGroundTiles(null, tileCoordKeys, getPrototypeGroundTextureCount(map)),
            walls: [],
            blockedEdges: [],
            clearanceByTile: {},
            objects: [],
            animals: [],
            powerups: []
        };
        asset._prototypeBlockedEdgesDirty = false;
        asset._prototypeClearanceDirty = true;
        asset._prototypeNamedObjectRecordIdByName = new Map();
        asset._prototypeNamedObjectConflictRecordIdsByName = new Map();
        const section = {
            key,
            coord: { q: coord.q, r: coord.r },
            centerAxial: { q: centerAxial.q, r: centerAxial.r },
            centerOffset: { x: centerOffset.x, y: centerOffset.y },
            centerWorld: { x: centerWorld.x, y: centerWorld.y }
        };

        if (!(state.sectionAssetsByKey instanceof Map)) state.sectionAssetsByKey = new Map();
        if (!(state.sectionsByKey instanceof Map)) state.sectionsByKey = new Map();
        if (!Array.isArray(state.orderedSectionAssets)) state.orderedSectionAssets = [];
        if (!Array.isArray(state.orderedSections)) state.orderedSections = [];
        if (!Array.isArray(state.sectionCoords)) state.sectionCoords = [];

        state.sectionAssetsByKey.set(key, asset);
        state.sectionsByKey.set(key, section);
        state.orderedSectionAssets.push(asset);
        state.orderedSections.push(section);
        state.sectionCoords.push({ q: coord.q, r: coord.r });

        return asset;
    }

    function addSparseNodesForSection(map, prototypeState, asset) {
        const NodeCtor = globalScope.MapNode
            || (map && map.nodes && map.nodes[0] && map.nodes[0][0] && map.nodes[0][0].constructor);
        if (typeof NodeCtor !== "function" || !asset) return [];
        if (!(prototypeState.nodesBySectionKey instanceof Map)) prototypeState.nodesBySectionKey = new Map();
        if (!(prototypeState.allNodesByCoordKey instanceof Map)) prototypeState.allNodesByCoordKey = new Map();
        if (!Array.isArray(prototypeState.allNodes)) prototypeState.allNodes = [];
        if (prototypeState.nodesBySectionKey.has(asset.key)) {
            return prototypeState.nodesBySectionKey.get(asset.key) || [];
        }

        const sectionNodes = [];
        const tileCoordKeys = Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys : [];
        const textureCount = getPrototypeGroundTextureCount(map);
        const groundTiles = (asset.groundTiles && typeof asset.groundTiles === "object")
            ? asset.groundTiles
            : normalizePrototypeGroundTiles(null, tileCoordKeys, textureCount);
        asset.groundTiles = groundTiles;

        for (let i = 0; i < tileCoordKeys.length; i++) {
            const coordKey = tileCoordKeys[i];
            if (typeof coordKey !== "string" || coordKey.length === 0) continue;
            const [xRaw, yRaw] = coordKey.split(",");
            const offset = {
                x: Number(xRaw),
                y: Number(yRaw)
            };
            let node = prototypeState.allNodesByCoordKey.get(coordKey);
            if (!node) {
                node = new NodeCtor(offset.x, offset.y, 1, 1);
                node.xindex = offset.x;
                node.yindex = offset.y;
                node.x = offset.x * 0.866;
                node.y = offset.y + (offset.x % 2 === 0 ? 0.5 : 0);
                node.neighbors = new Array(12).fill(null);
                node.neighborOffsets = getNeighborOffsetsForColumn(offset.x);
                node.blockedNeighbors = new Map();
                node.objects = [];
                node.visibilityObjects = [];
                node.blockedByObjects = 0;
                node.blocked = false;
                node.clearance = Infinity;
                node._prototypeVoid = false;
                prototypeState.allNodes.push(node);
                prototypeState.allNodesByCoordKey.set(coordKey, node);
            }
            node.groundTextureId = Number.isFinite(groundTiles[coordKey])
                ? Number(groundTiles[coordKey])
                : pickPrototypeGroundTextureId(offset.x, offset.y, textureCount);
            node._prototypeSectionKey = asset.key;
            node._prototypeSectionActive = false;
            if (asset.clearanceByTile && Object.prototype.hasOwnProperty.call(asset.clearanceByTile, coordKey)) {
                const rawClearance = asset.clearanceByTile[coordKey];
                node.clearance = Number.isFinite(rawClearance) ? Number(rawClearance) : Infinity;
            }
            sectionNodes.push(node);
        }

        prototypeState.nodesBySectionKey.set(asset.key, sectionNodes);

        for (let i = 0; i < sectionNodes.length; i++) {
            const node = sectionNodes[i];
            const offsets = getNeighborOffsetsForColumn(node.xindex);
            node.neighborOffsets = offsets;
            for (let d = 0; d < offsets.length; d++) {
                const offset = offsets[d];
                const neighborKey = `${node.xindex + offset.x},${node.yindex + offset.y}`;
                const neighbor = prototypeState.allNodesByCoordKey.get(neighborKey) || null;
                node.neighbors[d] = neighbor;
                if (!neighbor || !Array.isArray(neighbor.neighborOffsets)) continue;
                const reverseOffsets = getNeighborOffsetsForColumn(neighbor.xindex);
                neighbor.neighborOffsets = reverseOffsets;
                for (let rd = 0; rd < reverseOffsets.length; rd++) {
                    const reverseOffset = reverseOffsets[rd];
                    if ((neighbor.xindex + reverseOffset.x) === node.xindex && (neighbor.yindex + reverseOffset.y) === node.yindex) {
                        neighbor.neighbors[rd] = node;
                    }
                }
            }
        }

        return sectionNodes;
    }

    function ensurePrototypeSectionExists(map, prototypeState, sectionCoord) {
        if (!prototypeState || !sectionCoord) return null;
        const key = makeSectionKey(sectionCoord);
        const existingSection = prototypeState.sectionsByKey instanceof Map
            ? prototypeState.sectionsByKey.get(key)
            : null;
        if (existingSection) {
            if (prototypeState.useSparseNodes === true) {
                const existingAsset = prototypeState.sectionAssetsByKey.get(key);
                if (existingAsset && !prototypeState.nodesBySectionKey.has(key)) {
                    addSparseNodesForSection(map, prototypeState, existingAsset);
                }
            }
            return existingSection;
        }

        const asset = createPrototypeSectionAsset(prototypeState, sectionCoord, map);
        if (!asset) return null;
        if (prototypeState.useSparseNodes === true) {
            addSparseNodesForSection(map, prototypeState, asset);
        }
        return prototypeState.sectionsByKey.get(key) || null;
    }

    async function loadPrototypeSectionAssetBundle(assetUrl) {
        if (typeof fetch !== "function" || typeof assetUrl !== "string" || assetUrl.length === 0) {
            return null;
        }
        let requestUrl = assetUrl;
        try {
            const hasQuery = requestUrl.includes("?");
            requestUrl += `${hasQuery ? "&" : "?"}_ts=${Date.now()}`;
        } catch (_err) {
            requestUrl = assetUrl;
        }
        const response = await fetch(requestUrl, { cache: "no-store" });
        if (!response) {
            throw new Error(`Failed to load prototype section assets from '${assetUrl}'`);
        }
        if (response.status === 404) {
            return null;
        }
        if (!response.ok) {
            throw new Error(`Failed to load prototype section assets from '${assetUrl}'`);
        }
        return response.json();
    }

    function normalizePrototypeRecordIds(sectionAssets, fieldName) {
        const assets = Array.isArray(sectionAssets) ? sectionAssets : [];
        let nextId = 1;
        for (let i = 0; i < assets.length; i++) {
            const asset = assets[i];
            const records = Array.isArray(asset && asset[fieldName]) ? asset[fieldName] : null;
            if (!records) continue;
            for (let j = 0; j < records.length; j++) {
                const record = records[j];
                const recordId = Number(record && record.id);
                if (Number.isInteger(recordId) && recordId >= nextId) {
                    nextId = recordId + 1;
                }
            }
        }
        for (let i = 0; i < assets.length; i++) {
            const asset = assets[i];
            const records = Array.isArray(asset && asset[fieldName]) ? asset[fieldName] : null;
            if (!records) continue;
            for (let j = 0; j < records.length; j++) {
                const record = records[j];
                if (!record || typeof record !== "object") continue;
                if (Number.isInteger(Number(record.id))) continue;
                record.id = nextId++;
            }
        }
        return nextId;
    }

    function buildSectionStateFromAssetBundle(assetBundle, fallbackConfig, map) {
        const buildPrototypeAnimalPersistenceSignature = (animalOrRecord) => {
            if (!animalOrRecord || typeof animalOrRecord !== "object") return "";
            const data = (typeof animalOrRecord.saveJson === "function")
                ? animalOrRecord.saveJson()
                : animalOrRecord;
            if (!data || typeof data !== "object") return "";
            const normalized = { ...data };
            delete normalized.id;
            return JSON.stringify(normalized);
        };
        const dedupePrototypeAnimalRecords = (records) => {
            if (!Array.isArray(records) || records.length === 0) return [];
            const uniqueRecords = [];
            const seenIds = new Set();
            const seenSignatures = new Set();
            for (let i = 0; i < records.length; i++) {
                const record = records[i];
                if (!record || typeof record !== "object") continue;
                const recordId = Number(record.id);
                const signature = buildPrototypeAnimalPersistenceSignature(record);
                if (Number.isInteger(recordId) && seenIds.has(recordId)) continue;
                if (signature && seenSignatures.has(signature)) continue;
                if (Number.isInteger(recordId)) seenIds.add(recordId);
                if (signature) seenSignatures.add(signature);
                uniqueRecords.push({ ...record });
            }
            return uniqueRecords;
        };
        const textureCount = getPrototypeGroundTextureCount(map);
        const basis = getSectionBasisVectors(
            Number.isFinite(assetBundle && assetBundle.radius)
                ? Math.max(3, Math.floor(Number(assetBundle.radius)))
                : fallbackConfig.sectionRadius
        );
        const rawSections = Array.isArray(assetBundle && assetBundle.sections)
            ? assetBundle.sections
            : (Array.isArray(assetBundle) ? assetBundle : []);
        const orderedSectionAssets = [];
        const sectionAssetsByKey = new Map();
        const orderedSections = [];
        const sectionsByKey = new Map();

        for (let i = 0; i < rawSections.length; i++) {
            const rawAsset = rawSections[i];
            if (!rawAsset || typeof rawAsset !== "object") continue;
            const coord = rawAsset.coord && typeof rawAsset.coord === "object"
                ? { q: Number(rawAsset.coord.q) || 0, r: Number(rawAsset.coord.r) || 0 }
                : { q: 0, r: 0 };
            const centerAxial = rawAsset.centerAxial && typeof rawAsset.centerAxial === "object"
                ? { q: Number(rawAsset.centerAxial.q) || 0, r: Number(rawAsset.centerAxial.r) || 0 }
                : { q: 0, r: 0 };
            const centerOffset = rawAsset.centerOffset && typeof rawAsset.centerOffset === "object"
                ? { x: Number(rawAsset.centerOffset.x) || 0, y: Number(rawAsset.centerOffset.y) || 0 }
                : axialToEvenQOffset(centerAxial);
            const key = (typeof rawAsset.key === "string" && rawAsset.key.length > 0)
                ? rawAsset.key
                : makeSectionKey(coord);
            const rawWalls = Array.isArray(rawAsset.walls) ? rawAsset.walls : [];
            const rawBlockedEdges = Array.isArray(rawAsset.blockedEdges) ? rawAsset.blockedEdges : null;
            const blockedEdges = clonePrototypeBlockedEdges(rawBlockedEdges);
            const blockedEdgesNeedCompute = !Array.isArray(rawBlockedEdges)
                || (blockedEdges.length === 0 && rawWalls.length > 0);
            const tileCoordKeys = Array.isArray(rawAsset.tileCoordKeys) ? rawAsset.tileCoordKeys.slice() : [];
            const clearanceByTile = clonePrototypeClearanceByTile(rawAsset.clearanceByTile);
            const clearanceNeedsCompute = Object.keys(clearanceByTile).length !== tileCoordKeys.length;
            const asset = {
                id: (typeof rawAsset.id === "string" && rawAsset.id.length > 0) ? rawAsset.id : key,
                key,
                coord,
                centerAxial,
                centerOffset,
                centerWorld: offsetToWorld(centerOffset),
                neighborKeys: Array.isArray(rawAsset.neighborKeys) ? rawAsset.neighborKeys.slice() : [],
                tileCoordKeys,
                groundTextureId: Number.isFinite(rawAsset.groundTextureId) ? Number(rawAsset.groundTextureId) : 0,
                groundTiles: normalizePrototypeGroundTiles(rawAsset.groundTiles, rawAsset.tileCoordKeys, textureCount),
                walls: rawWalls.map((wall) => ({ ...wall })),
                blockedEdges,
                clearanceByTile,
                objects: Array.isArray(rawAsset.objects) ? rawAsset.objects.map((obj) => ({ ...obj })) : [],
                animals: dedupePrototypeAnimalRecords(rawAsset.animals),
                powerups: Array.isArray(rawAsset.powerups) ? rawAsset.powerups.map((powerup) => ({ ...powerup })) : []
            };
            asset._prototypeBlockedEdgesDirty = blockedEdgesNeedCompute;
            asset._prototypeClearanceDirty = clearanceNeedsCompute;
            orderedSectionAssets.push(asset);
            sectionAssetsByKey.set(asset.key, asset);

            const section = {
                key: asset.key,
                coord: { q: asset.coord.q, r: asset.coord.r },
                centerAxial: { q: asset.centerAxial.q, r: asset.centerAxial.r },
                centerOffset: { x: asset.centerOffset.x, y: asset.centerOffset.y },
                centerWorld: { x: asset.centerWorld.x, y: asset.centerWorld.y }
            };
            orderedSections.push(section);
            sectionsByKey.set(section.key, section);
        }

        const nextWallRecordId = normalizePrototypeRecordIds(orderedSectionAssets, "walls");
        const nextObjectRecordId = normalizePrototypeRecordIds(orderedSectionAssets, "objects");
        const nextAnimalRecordId = normalizePrototypeRecordIds(orderedSectionAssets, "animals");
        const nextPowerupRecordId = normalizePrototypeRecordIds(orderedSectionAssets, "powerups");

        let anchorCenter = assetBundle && assetBundle.anchorCenter && typeof assetBundle.anchorCenter === "object"
            ? {
                q: Number(assetBundle.anchorCenter.q) || 0,
                r: Number(assetBundle.anchorCenter.r) || 0
            }
            : null;
        if (!anchorCenter && orderedSections.length > 0) {
            const referenceSection = orderedSections[0];
            anchorCenter = {
                q: Number(referenceSection.centerAxial.q)
                    - (Number(referenceSection.coord.q) * Number(basis.qAxis.q))
                    - (Number(referenceSection.coord.r) * Number(basis.rAxis.q)),
                r: Number(referenceSection.centerAxial.r)
                    - (Number(referenceSection.coord.q) * Number(basis.qAxis.r))
                    - (Number(referenceSection.coord.r) * Number(basis.rAxis.r))
            };
        }
        if (!anchorCenter) {
            anchorCenter = evenQOffsetToAxial(
                Math.max(0, Math.floor((Number(map && map.width) || 0) * 0.5)),
                Math.max(0, Math.floor((Number(map && map.height) || 0) * 0.5))
            );
        }

        return {
            radius: Number.isFinite(assetBundle && assetBundle.radius)
                ? Math.max(3, Math.floor(Number(assetBundle.radius)))
                : fallbackConfig.sectionRadius,
            sectionGraphRadius: Number.isFinite(assetBundle && assetBundle.sectionGraphRadius)
                ? Math.max(0, Math.floor(Number(assetBundle.sectionGraphRadius)))
                : fallbackConfig.sectionGraphRadius,
            basis,
            nextRecordIds: {
                walls: nextWallRecordId,
                objects: nextObjectRecordId,
                animals: nextAnimalRecordId,
                powerups: nextPowerupRecordId
            },
            sectionCoords: orderedSections.map((section) => ({ q: section.coord.q, r: section.coord.r })),
            sectionsByKey,
            orderedSections,
            sectionAssetsByKey,
            orderedSectionAssets,
            anchorCenter,
            manifest: (assetBundle && assetBundle.manifest && typeof assetBundle.manifest === "object")
                ? assetBundle.manifest
                : {}
        };
    }

    function getNeighborOffsetsForColumn(x) {
        const isEven = x % 2 === 0;
        if (isEven) {
            return [
                { x: -2, y: 0 },
                { x: -1, y: 0 },
                { x: -1, y: -1 },
                { x: 0, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 0 },
                { x: 2, y: 0 },
                { x: 1, y: 1 },
                { x: 1, y: 2 },
                { x: 0, y: 1 },
                { x: -1, y: 2 },
                { x: -1, y: 1 }
            ];
        }
        return [
            { x: -2, y: 0 },
            { x: -1, y: -1 },
            { x: -1, y: -2 },
            { x: 0, y: -1 },
            { x: 1, y: -2 },
            { x: 1, y: -1 },
            { x: 2, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
            { x: -1, y: 1 },
            { x: -1, y: 0 }
        ];
    }

    function buildSparsePrototypeNodes(map, prototypeState) {
        const NodeCtor = globalScope.MapNode
            || (map && map.nodes && map.nodes[0] && map.nodes[0][0] && map.nodes[0][0].constructor);
        prototypeState.nodesBySectionKey = new Map();
        prototypeState.allNodes = [];
        prototypeState.allNodesByCoordKey = new Map();
        if (typeof NodeCtor !== "function") return;

        const sourceAssets = Array.isArray(prototypeState.orderedSectionAssets)
            ? prototypeState.orderedSectionAssets
            : [];
        const textureCount = getPrototypeGroundTextureCount(map);
        for (let i = 0; i < sourceAssets.length; i++) {
            const asset = sourceAssets[i];
            if (!asset) continue;
            const sectionNodes = [];
            const tileCoordKeys = Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys : [];
            for (let t = 0; t < tileCoordKeys.length; t++) {
                    const coordKey = tileCoordKeys[t];
                    if (typeof coordKey !== "string" || coordKey.length === 0) continue;
                    const [xRaw, yRaw] = coordKey.split(",");
                    const offset = {
                        x: Number(xRaw),
                        y: Number(yRaw)
                    };
                    let node = prototypeState.allNodesByCoordKey.get(coordKey);
                    if (!node) {
                        node = new NodeCtor(offset.x, offset.y, 1, 1);
                        node.xindex = offset.x;
                        node.yindex = offset.y;
                        node.x = offset.x * 0.866;
                        node.y = offset.y + (offset.x % 2 === 0 ? 0.5 : 0);
                        node.neighbors = new Array(12).fill(null);
                        node.neighborOffsets = getNeighborOffsetsForColumn(offset.x);
                        node.blockedNeighbors = new Map();
                        node.objects = [];
                        node.visibilityObjects = [];
                        node.blockedByObjects = 0;
                        node.blocked = false;
                        node.clearance = Infinity;
                        const groundTiles = (asset.groundTiles && typeof asset.groundTiles === "object") ? asset.groundTiles : null;
                        const fallbackTextureId = pickPrototypeGroundTextureId(offset.x, offset.y, textureCount);
                        node.groundTextureId = groundTiles && Number.isFinite(groundTiles[coordKey])
                            ? Number(groundTiles[coordKey])
                            : fallbackTextureId;
                        node._prototypeVoid = false;
                        node._prototypeSectionKey = asset.key;
                        node._prototypeSectionActive = false;
                        if (asset.clearanceByTile && Object.prototype.hasOwnProperty.call(asset.clearanceByTile, coordKey)) {
                            const rawClearance = asset.clearanceByTile[coordKey];
                            node.clearance = Number.isFinite(rawClearance) ? Number(rawClearance) : Infinity;
                        }
                        prototypeState.allNodes.push(node);
                        prototypeState.allNodesByCoordKey.set(coordKey, node);
                    }
                    sectionNodes.push(node);
            }
            prototypeState.nodesBySectionKey.set(asset.key, sectionNodes);
        }

        for (let i = 0; i < prototypeState.allNodes.length; i++) {
            const node = prototypeState.allNodes[i];
            const offsets = getNeighborOffsetsForColumn(node.xindex);
            node.neighborOffsets = offsets;
            for (let d = 0; d < offsets.length; d++) {
                const offset = offsets[d];
                const neighborKey = `${node.xindex + offset.x},${node.yindex + offset.y}`;
                node.neighbors[d] = prototypeState.allNodesByCoordKey.get(neighborKey) || null;
            }
        }
    }

    function assignNodesToSections(map, prototypeState) {
        if (prototypeState.useSparseNodes === true) {
            buildSparsePrototypeNodes(map, prototypeState);
            return;
        }
        prototypeState.nodesBySectionKey = new Map();
        for (let x = 0; x < map.width; x++) {
            for (let y = 0; y < map.height; y++) {
                const node = map.nodes[x] && map.nodes[x][y];
                if (!node) continue;
                const axial = evenQOffsetToAxial(x, y);
                let matchedSection = null;
                for (let i = 0; i < prototypeState.orderedSections.length; i++) {
                    const section = prototypeState.orderedSections[i];
                    if (axialDistance(axial, section.centerAxial) <= (prototypeState.radius - 1)) {
                        matchedSection = section;
                        break;
                    }
                }
                if (!matchedSection) continue;
                node.blocked = false;
                node.clearance = Infinity;
                node._prototypeVoid = false;
                node._prototypeSectionKey = matchedSection.key;
                const asset = prototypeState.sectionAssetsByKey instanceof Map
                    ? prototypeState.sectionAssetsByKey.get(matchedSection.key)
                    : null;
                const coordKey = `${node.xindex},${node.yindex}`;
                if (asset && asset.clearanceByTile && Object.prototype.hasOwnProperty.call(asset.clearanceByTile, coordKey)) {
                    const rawClearance = asset.clearanceByTile[coordKey];
                    node.clearance = Number.isFinite(rawClearance) ? Number(rawClearance) : Infinity;
                }
                if (!prototypeState.nodesBySectionKey.has(matchedSection.key)) {
                    prototypeState.nodesBySectionKey.set(matchedSection.key, []);
                }
                prototypeState.nodesBySectionKey.get(matchedSection.key).push(node);
            }
        }
    }

    function getBubbleKeysForCenter(state, centerKey) {
        if (!state.sectionsByKey.has(centerKey)) return new Set();
        const centerSection = state.sectionsByKey.get(centerKey);
        const keys = new Set([centerKey]);
        for (let i = 0; i < SECTION_DIRECTIONS.length; i++) {
            const neighborCoord = addSectionCoords(centerSection.coord, SECTION_DIRECTIONS[i]);
            const neighborKey = makeSectionKey(neighborCoord);
            keys.add(neighborKey);
        }
        return keys;
    }

    function rebuildPrototypeAssetObjectNameRegistry(asset) {
        if (!asset || !Array.isArray(asset.objects)) return new Map();
        const primary = new Map();
        const conflicts = new Map();
        for (let i = 0; i < asset.objects.length; i++) {
            const record = asset.objects[i];
            const name = normalizePrototypeScriptingName(record && record.scriptingName);
            const recordId = Number(record && record.id);
            if (!name || !Number.isInteger(recordId)) continue;
            if (!primary.has(name)) {
                primary.set(name, recordId);
                continue;
            }
            if (!conflicts.has(name)) {
                conflicts.set(name, [primary.get(name)]);
            }
            conflicts.get(name).push(recordId);
        }
        asset._prototypeNamedObjectRecordIdByName = primary;
        asset._prototypeNamedObjectConflictRecordIdsByName = conflicts;
        return primary;
    }

    function forEachPrototypeAssetNamedRecord(asset, visitor) {
        if (!asset || typeof visitor !== "function") return;
        const recordLists = [asset.objects, asset.animals, asset.powerups];
        for (let listIndex = 0; listIndex < recordLists.length; listIndex++) {
            const records = recordLists[listIndex];
            if (!Array.isArray(records)) continue;
            for (let i = 0; i < records.length; i++) {
                const record = records[i];
                const name = normalizePrototypeScriptingName(record && record.scriptingName);
                const recordId = Number(record && record.id);
                if (!name || !Number.isInteger(recordId)) continue;
                visitor(name, recordId, record);
            }
        }
    }

    function getPrototypeRuntimeTargetSectionKey(map, target) {
        if (!map || !target || typeof target !== "object") return "";
        if (typeof target._prototypeOwnerSectionKey === "string" && target._prototypeOwnerSectionKey.length > 0) {
            return target._prototypeOwnerSectionKey;
        }
        if (
            Number.isFinite(target.x) &&
            Number.isFinite(target.y) &&
            typeof map.getPrototypeSectionKeyForWorldPoint === "function"
        ) {
            return map.getPrototypeSectionKeyForWorldPoint(target.x, target.y) || "";
        }
        return "";
    }

    function forEachPrototypeBubbleRuntimeTarget(map, state, centerSectionKey, visitor, options = {}) {
        if (!map || !state || !centerSectionKey || typeof visitor !== "function") return;
        ensurePrototypeBubbleSectionsExist(map, state, centerSectionKey);
        const bubbleKeys = getBubbleKeysForCenter(state, centerSectionKey);
        const ignoreRuntimeObj = options && options.ignoreRuntimeObj ? options.ignoreRuntimeObj : null;
        const ignoreRecordId = Number.isInteger(options && options.ignoreRecordId)
            ? Number(options.ignoreRecordId)
            : null;
        const seen = new Set();

        const visitCandidate = (target) => {
            if (!target || typeof target !== "object" || target.gone || target.vanishing) return;
            if (target === ignoreRuntimeObj || seen.has(target)) return;
            const sectionKey = getPrototypeRuntimeTargetSectionKey(map, target);
            if (!sectionKey || !bubbleKeys.has(sectionKey)) return;
            const recordId = Number(target._prototypeRecordId);
            if (ignoreRecordId !== null && Number.isInteger(recordId) && recordId === ignoreRecordId) return;
            seen.add(target);
            visitor(target, sectionKey);
        };

        const objectState = map._prototypeObjectState;
        if (objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map) {
            for (const runtimeObj of objectState.activeRuntimeObjectsByRecordId.values()) {
                visitCandidate(runtimeObj);
            }
        }

        const animalState = map._prototypeAnimalState;
        if (animalState && animalState.activeRuntimeAnimalsByRecordId instanceof Map) {
            for (const runtimeAnimal of animalState.activeRuntimeAnimalsByRecordId.values()) {
                visitCandidate(runtimeAnimal);
            }
        }

        const powerupState = map._prototypePowerupState;
        if (powerupState && powerupState.activeRuntimePowerupsByRecordId instanceof Map) {
            for (const runtimePowerup of powerupState.activeRuntimePowerupsByRecordId.values()) {
                visitCandidate(runtimePowerup);
            }
        }

        if (Array.isArray(globalScope.animals)) {
            for (let i = 0; i < globalScope.animals.length; i++) {
                visitCandidate(globalScope.animals[i]);
            }
        }

        if (Array.isArray(globalScope.powerups)) {
            for (let i = 0; i < globalScope.powerups.length; i++) {
                visitCandidate(globalScope.powerups[i]);
            }
        }

        if (state.nodesBySectionKey instanceof Map) {
            bubbleKeys.forEach((sectionKey) => {
                const nodes = state.nodesBySectionKey.get(sectionKey) || [];
                for (let i = 0; i < nodes.length; i++) {
                    const node = nodes[i];
                    if (!node || !Array.isArray(node.objects)) continue;
                    for (let j = 0; j < node.objects.length; j++) {
                        visitCandidate(node.objects[j]);
                    }
                }
            });
        }
    }

    function ensurePrototypeBubbleSectionsExist(map, state, centerSectionKey) {
        if (!map || !state || !centerSectionKey) return;
        if (!state.sectionsByKey.has(centerSectionKey)) {
            const [qRaw, rRaw] = String(centerSectionKey).split(",");
            ensurePrototypeSectionExists(map, state, {
                q: Number(qRaw) || 0,
                r: Number(rRaw) || 0
            });
        }
        const centerSection = state.sectionsByKey.get(centerSectionKey);
        if (!centerSection) return;
        for (let i = 0; i < SECTION_DIRECTIONS.length; i++) {
            ensurePrototypeSectionExists(map, state, addSectionCoords(centerSection.coord, SECTION_DIRECTIONS[i]));
        }
    }

    function collectPrototypeBubbleObjectNames(map, state, centerSectionKey, options = {}) {
        const usedNames = new Set();
        if (!map || !state || !centerSectionKey) return usedNames;
        const ignoreRuntimeObj = options && options.ignoreRuntimeObj ? options.ignoreRuntimeObj : null;
        const ignoreRecordId = Number.isInteger(options && options.ignoreRecordId)
            ? Number(options.ignoreRecordId)
            : null;

        ensurePrototypeBubbleSectionsExist(map, state, centerSectionKey);
        const bubbleKeys = getBubbleKeysForCenter(state, centerSectionKey);

        bubbleKeys.forEach((sectionKey) => {
            const asset = state.sectionAssetsByKey instanceof Map
                ? state.sectionAssetsByKey.get(sectionKey)
                : null;
            if (!asset) return;
            forEachPrototypeAssetNamedRecord(asset, (name, recordId) => {
                if (ignoreRecordId !== null && recordId === ignoreRecordId) return;
                usedNames.add(name);
            });
        });

        forEachPrototypeBubbleRuntimeTarget(map, state, centerSectionKey, (runtimeTarget) => {
            const runtimeName = normalizePrototypeScriptingName(runtimeTarget.scriptingName);
            if (!runtimeName) return;
            usedNames.add(runtimeName);
        }, {
            ignoreRuntimeObj,
            ignoreRecordId
        });

        return usedNames;
    }

    function generatePrototypeBubbleUniqueObjectName(map, state, centerSectionKey, baseName, options = {}) {
        const normalizedBase = normalizePrototypeScriptingName(baseName) || "object";
        const usedNames = collectPrototypeBubbleObjectNames(map, state, centerSectionKey, options);
        let index = 1;
        let candidate = `${normalizedBase}${index}`;
        while (usedNames.has(candidate)) {
            index += 1;
            candidate = `${normalizedBase}${index}`;
        }
        return candidate;
    }

    function resolvePrototypeActiveNamedObject(map, state, name, centerSectionKey = null) {
        const normalizedName = normalizePrototypeScriptingName(name);
        if (!normalizedName || !map || !state) return null;
        const scopeCenterKey = (typeof centerSectionKey === "string" && centerSectionKey.length > 0)
            ? centerSectionKey
            : state.activeCenterKey;
        let resolvedRuntimeObj = null;
        forEachPrototypeBubbleRuntimeTarget(map, state, scopeCenterKey, (candidate) => {
            if (resolvedRuntimeObj) return;
            if (normalizePrototypeScriptingName(candidate.scriptingName) !== normalizedName) return;
            resolvedRuntimeObj = candidate;
        });
        return resolvedRuntimeObj;
    }

    function setActiveCenter(map, nextCenterKey) {
        const state = map && map._prototypeSectionState;
        if (!state) return false;
        const layoutNow = () => (
            (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                ? performance.now()
                : Date.now()
        );
        const layoutStart = layoutNow();
        let ensureSectionsMs = 0;
        let compareMs = 0;
        let deactivateMs = 0;
        let activateMs = 0;
        let rebuildLoadedMs = 0;
        let seamMs = 0;
        let clearanceMs = 0;
        let deactivatedNodeCount = 0;
        let activatedNodeCount = 0;
        if (!state.sectionsByKey.has(nextCenterKey)) {
            const ensureStart = layoutNow();
            const [qRaw, rRaw] = String(nextCenterKey).split(",");
            ensurePrototypeSectionExists(map, state, {
                q: Number(qRaw) || 0,
                r: Number(rRaw) || 0
            });
            ensureSectionsMs += layoutNow() - ensureStart;
        }
        if (!state.sectionsByKey.has(nextCenterKey)) return false;
        const centerSection = state.sectionsByKey.get(nextCenterKey);
        const ensureNeighborsStart = layoutNow();
        for (let i = 0; i < SECTION_DIRECTIONS.length; i++) {
            ensurePrototypeSectionExists(map, state, addSectionCoords(centerSection.coord, SECTION_DIRECTIONS[i]));
        }
        ensureSectionsMs += layoutNow() - ensureNeighborsStart;

        const nextActiveKeys = getBubbleKeysForCenter(state, nextCenterKey);
        const compareStart = layoutNow();
        let changed = state.activeCenterKey !== nextCenterKey || state.activeSectionKeys.size !== nextActiveKeys.size;
        if (!changed) {
            for (const key of nextActiveKeys) {
                if (!state.activeSectionKeys.has(key)) {
                    changed = true;
                    break;
                }
            }
        }
        compareMs += layoutNow() - compareStart;

        state.activeCenterKey = nextCenterKey;
        const previousActiveKeys = state.actualActiveSectionKeys instanceof Set
            ? new Set(state.actualActiveSectionKeys)
            : (state.activeSectionKeys instanceof Set
            ? new Set(state.activeSectionKeys)
            : new Set());
        if (!Array.isArray(state.loadedNodes)) {
            state.loadedNodes = [];
        }
        if (!(state.loadedNodeKeySet instanceof Set)) {
            state.loadedNodeKeySet = new Set();
            for (let i = 0; i < state.loadedNodes.length; i++) {
                const node = state.loadedNodes[i];
                if (!node) continue;
                state.loadedNodeKeySet.add(`${node.xindex},${node.yindex}`);
            }
        }
        const keysToDeactivate = [];
        previousActiveKeys.forEach((key) => {
            if (!nextActiveKeys.has(key)) keysToDeactivate.push(key);
        });
        const keysToActivate = [];
        nextActiveKeys.forEach((key) => {
            if (!previousActiveKeys.has(key)) keysToActivate.push(key);
        });

        const shouldApplyLayoutSynchronously = previousActiveKeys.size === 0;
        if (shouldApplyLayoutSynchronously) {
            const keysToDeactivateSet = new Set(keysToDeactivate);
            const deactivateStart = layoutNow();
            for (let i = 0; i < keysToDeactivate.length; i++) {
                const sectionKey = keysToDeactivate[i];
                const nodes = state.nodesBySectionKey.get(sectionKey) || [];
                for (let n = 0; n < nodes.length; n++) {
                    const node = nodes[n];
                    if (!node) continue;
                    node._prototypeSectionActive = false;
                    node.blocked = true;
                    node.clearance = 0;
                    state.loadedNodesByCoordKey.delete(`${node.xindex},${node.yindex}`);
                    state.loadedNodeKeySet.delete(`${node.xindex},${node.yindex}`);
                    deactivatedNodeCount += 1;
                }
            }
            deactivateMs += layoutNow() - deactivateStart;

            const activateStart = layoutNow();
            for (let i = 0; i < keysToActivate.length; i++) {
                const sectionKey = keysToActivate[i];
                const nodes = state.nodesBySectionKey.get(sectionKey) || [];
                for (let n = 0; n < nodes.length; n++) {
                    const node = nodes[n];
                    if (!node) continue;
                    node._prototypeSectionActive = true;
                    node.blocked = false;
                    const coordKey = `${node.xindex},${node.yindex}`;
                    state.loadedNodesByCoordKey.set(coordKey, node);
                    if (!state.loadedNodeKeySet.has(coordKey)) {
                        state.loadedNodeKeySet.add(coordKey);
                        state.loadedNodes.push(node);
                    }
                    activatedNodeCount += 1;
                }
            }
            activateMs += layoutNow() - activateStart;

            state.activeSectionKeys = nextActiveKeys;
            state.actualActiveSectionKeys = new Set(nextActiveKeys);
            const rebuildLoadedStart = layoutNow();
            if (keysToDeactivateSet.size > 0) {
                state.loadedNodes = state.loadedNodes.filter((node) => (
                    node &&
                    node._prototypeSectionActive === true &&
                    !keysToDeactivateSet.has(node._prototypeSectionKey)
                ));
            } else {
                state.loadedNodes = state.loadedNodes.filter((node) => node && node._prototypeSectionActive === true);
            }
            rebuildLoadedMs += layoutNow() - rebuildLoadedStart;
            const seamStart = layoutNow();
            updatePrototypeSeamSegmentsForSections(state, new Set([...keysToActivate, ...keysToDeactivate]));
            seamMs += layoutNow() - seamStart;
            if (keysToActivate.length > 0 && typeof map.applyPrototypeSectionClearance === "function") {
                const clearanceStart = layoutNow();
                map.applyPrototypeSectionClearance(new Set(keysToActivate));
                clearanceMs += layoutNow() - clearanceStart;
            }
            state.pendingLayoutTransition = null;
            state.lastLayoutStats = {
                ms: Number((layoutNow() - layoutStart).toFixed(2)),
                ensureSectionsMs: Number(ensureSectionsMs.toFixed(2)),
                compareMs: Number(compareMs.toFixed(2)),
                deactivateMs: Number(deactivateMs.toFixed(2)),
                activateMs: Number(activateMs.toFixed(2)),
                rebuildLoadedMs: Number(rebuildLoadedMs.toFixed(2)),
                seamMs: Number(seamMs.toFixed(2)),
                clearanceMs: Number(clearanceMs.toFixed(2)),
                deactivatedNodeCount,
                activatedNodeCount,
                loadedNodeCount: Array.isArray(state.loadedNodes) ? state.loadedNodes.length : 0,
                keysToActivate: keysToActivate.length,
                keysToDeactivate: keysToDeactivate.length
            };
            return changed;
        }

        state.activeSectionKeys = nextActiveKeys;
        state.pendingLayoutTransition = {
            targetActiveKeys: new Set(nextActiveKeys),
            keysToActivate: keysToActivate.slice(),
            keysToDeactivate: keysToDeactivate.slice(),
            changedSectionKeys: new Set([...keysToActivate, ...keysToDeactivate]),
            initialStats: {
                ensureSectionsMs: Number(ensureSectionsMs.toFixed(2)),
                compareMs: Number(compareMs.toFixed(2)),
                deactivateMs: Number(deactivateMs.toFixed(2)),
                activateMs: Number(activateMs.toFixed(2)),
                rebuildLoadedMs: Number(rebuildLoadedMs.toFixed(2)),
                seamMs: Number(seamMs.toFixed(2)),
                clearanceMs: Number(clearanceMs.toFixed(2)),
                deactivatedNodeCount,
                activatedNodeCount
            }
        };
        state.lastLayoutStats = {
            ms: Number((layoutNow() - layoutStart).toFixed(2)),
            ensureSectionsMs: Number(ensureSectionsMs.toFixed(2)),
            compareMs: Number(compareMs.toFixed(2)),
            deactivateMs: Number(deactivateMs.toFixed(2)),
            activateMs: Number(activateMs.toFixed(2)),
            rebuildLoadedMs: Number(rebuildLoadedMs.toFixed(2)),
            seamMs: Number(seamMs.toFixed(2)),
            clearanceMs: Number(clearanceMs.toFixed(2)),
            deactivatedNodeCount,
            activatedNodeCount,
            loadedNodeCount: Array.isArray(state.loadedNodes) ? state.loadedNodes.length : 0,
            keysToActivate: keysToActivate.length,
            keysToDeactivate: keysToDeactivate.length
        };
        return changed;
    }

    function buildPrototypeSeamSegmentEntriesForSections(state, targetSectionKeys = null) {
        const nodesBySectionKey = (state && state.nodesBySectionKey instanceof Map) ? state.nodesBySectionKey : null;
        const targetKeys = targetSectionKeys instanceof Set ? targetSectionKeys : null;
        const segmentsByPairKey = new Map();
        const adjacentDirections = [1, 3, 5, 7, 9, 11];
        if (!nodesBySectionKey) return segmentsByPairKey;
        const sectionKeys = targetKeys ? Array.from(targetKeys) : Array.from(nodesBySectionKey.keys());

        for (let s = 0; s < sectionKeys.length; s++) {
            const sectionKey = sectionKeys[s];
            const sectionNodes = nodesBySectionKey.get(sectionKey) || [];
            for (let i = 0; i < sectionNodes.length; i++) {
                const node = sectionNodes[i];
                if (!node || node._prototypeSectionActive !== true || !Array.isArray(node.neighbors)) continue;
                for (let d = 0; d < adjacentDirections.length; d++) {
                    const directionIndex = adjacentDirections[d];
                    const neighbor = node.neighbors[directionIndex];
                    if (!neighbor || neighbor._prototypeSectionActive !== true) continue;
                    if (!neighbor._prototypeSectionKey || neighbor._prototypeSectionKey === node._prototypeSectionKey) continue;

                    const keyA = `${node.xindex},${node.yindex}`;
                    const keyB = `${neighbor.xindex},${neighbor.yindex}`;
                    const pairKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
                    if (segmentsByPairKey.has(pairKey)) continue;

                    const dx = Number(neighbor.x) - Number(node.x);
                    const dy = Number(neighbor.y) - Number(node.y);
                    const length = Math.hypot(dx, dy);
                    if (!(length > 1e-6)) continue;

                    const mx = (Number(node.x) + Number(neighbor.x)) * 0.5;
                    const my = (Number(node.y) + Number(neighbor.y)) * 0.5;
                    const nx = -dy / length;
                    const ny = dx / length;
                    const halfSegmentLength = 0.32;

                    segmentsByPairKey.set(pairKey, {
                        x1: mx - nx * halfSegmentLength,
                        y1: my - ny * halfSegmentLength,
                        x2: mx + nx * halfSegmentLength,
                        y2: my + ny * halfSegmentLength,
                        _sectionKeyA: node._prototypeSectionKey,
                        _sectionKeyB: neighbor._prototypeSectionKey
                    });
                }
            }
        }
        return segmentsByPairKey;
    }

    function buildPrototypeSeamSegments(state) {
        const segmentsByPairKey = buildPrototypeSeamSegmentEntriesForSections(state);
        return Array.from(segmentsByPairKey.values()).map((segment) => ({
            x1: segment.x1,
            y1: segment.y1,
            x2: segment.x2,
            y2: segment.y2
        }));
    }

    function updatePrototypeSeamSegmentsForSections(state, changedSectionKeys = null) {
        if (!state) return [];
        if (!(state.seamSegmentsByPairKey instanceof Map)) {
            state.seamSegmentsByPairKey = buildPrototypeSeamSegmentEntriesForSections(state);
        }
        const changedKeys = changedSectionKeys instanceof Set ? changedSectionKeys : new Set();
        if (changedKeys.size > 0) {
            for (const [pairKey, segment] of state.seamSegmentsByPairKey.entries()) {
                if (!segment) continue;
                if (changedKeys.has(segment._sectionKeyA) || changedKeys.has(segment._sectionKeyB)) {
                    state.seamSegmentsByPairKey.delete(pairKey);
                }
            }
            const recomputed = buildPrototypeSeamSegmentEntriesForSections(state, changedKeys);
            for (const [pairKey, segment] of recomputed.entries()) {
                state.seamSegmentsByPairKey.set(pairKey, segment);
            }
        }
        state.seamSegments = Array.from(state.seamSegmentsByPairKey.values()).map((segment) => ({
            x1: segment.x1,
            y1: segment.y1,
            x2: segment.x2,
            y2: segment.y2
        }));
        return state.seamSegments;
    }

    function buildPrototypeSummary(state) {
        return {
            radius: state.radius,
            sectionGraphRadius: state.sectionGraphRadius,
            sectionCoords: state.sectionCoords,
            centers: state.orderedSections.map((section) => section.centerAxial),
            centerOffsets: state.orderedSections.map((section) => section.centerOffset),
            sectionAssets: Array.isArray(state.orderedSectionAssets)
                ? state.orderedSectionAssets.map((asset) => ({
                    id: asset.id,
                    key: asset.key,
                    coord: { q: asset.coord.q, r: asset.coord.r },
                    neighborKeys: Array.isArray(asset.neighborKeys) ? asset.neighborKeys.slice() : [],
                    tileCount: Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys.length : 0,
                    wallCount: Array.isArray(asset.walls) ? asset.walls.length : 0
                }))
                : []
        };
    }

    function updatePrototypeGpuDebugStats(map) {
        if (typeof globalThis === "undefined" || typeof globalThis.setGpuAssetGauge !== "function") return;
        const sectionState = map && map._prototypeSectionState;
        const wallState = map && map._prototypeWallState;
        const objectState = map && map._prototypeObjectState;
        const animalState = map && map._prototypeAnimalState;
        const activeObjects = (objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map)
            ? Array.from(objectState.activeRuntimeObjectsByRecordId.values())
            : [];
        let runtimeRoads = 0;
        let runtimeTrees = 0;
        let runtimeRoofs = 0;
        for (let i = 0; i < activeObjects.length; i++) {
            const obj = activeObjects[i];
            if (!obj || obj.gone) continue;
            if (obj.type === "road") {
                runtimeRoads += 1;
            } else if (obj.type === "tree") {
                runtimeTrees += 1;
            } else if (obj.type === "roof") {
                runtimeRoofs += 1;
            }
        }
        globalThis.setGpuAssetGauge(
            "prototypeLoadedNodes",
            sectionState && Array.isArray(sectionState.loadedNodes) ? sectionState.loadedNodes.length : 0
        );
        globalThis.setGpuAssetGauge(
            "prototypeRuntimeWalls",
            wallState && wallState.activeRuntimeWallsByRecordId instanceof Map ? wallState.activeRuntimeWallsByRecordId.size : 0
        );
        globalThis.setGpuAssetGauge(
            "prototypeRuntimeObjects",
            objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map ? objectState.activeRuntimeObjectsByRecordId.size : 0
        );
        globalThis.setGpuAssetGauge("prototypeRuntimeRoads", runtimeRoads);
        globalThis.setGpuAssetGauge("prototypeRuntimeTrees", runtimeTrees);
        globalThis.setGpuAssetGauge("prototypeRuntimeRoofs", runtimeRoofs);
        globalThis.setGpuAssetGauge(
            "prototypeRuntimeAnimals",
            animalState && animalState.activeRuntimeAnimalsByRecordId instanceof Map ? animalState.activeRuntimeAnimalsByRecordId.size : 0
        );
    }

    function createPrototypeState(sectionStateSource, activeCenterKey) {
        return {
            radius: sectionStateSource.radius,
            sectionGraphRadius: sectionStateSource.sectionGraphRadius,
            basis: sectionStateSource.basis || getSectionBasisVectors(sectionStateSource.radius),
            anchorCenter: sectionStateSource.anchorCenter || { q: 0, r: 0 },
            nextRecordIds: (sectionStateSource && sectionStateSource.nextRecordIds && typeof sectionStateSource.nextRecordIds === "object")
                ? { ...sectionStateSource.nextRecordIds }
                : { walls: 1, objects: 1, animals: 1, powerups: 1 },
            sectionCoords: sectionStateSource.sectionCoords,
            sectionsByKey: sectionStateSource.sectionsByKey,
            orderedSections: sectionStateSource.orderedSections,
            sectionAssetsByKey: sectionStateSource.sectionAssetsByKey,
            orderedSectionAssets: sectionStateSource.orderedSectionAssets,
            hysteresisRatio: 0.1,
            useSparseNodes: true,
            activeCenterKey: (typeof activeCenterKey === "string" && activeCenterKey.length > 0)
                ? activeCenterKey
                : makeSectionKey({ q: 0, r: 0 }),
            activeSectionKeys: new Set(),
            actualActiveSectionKeys: new Set(),
            loadedNodes: [],
            loadedNodeKeySet: new Set(),
            loadedNodesByCoordKey: new Map(),
            seamSegmentsByPairKey: new Map(),
            seamSegments: [],
            nodesBySectionKey: new Map(),
            allNodes: [],
            allNodesByCoordKey: new Map()
        };
    }

    function initializePrototypeRuntimeState(map, prototypeState) {
        if (!map) return;
        map._prototypeWallState = {
            nextRecordId: Number.isInteger(prototypeState && prototypeState.nextRecordIds && prototypeState.nextRecordIds.walls)
                ? Number(prototypeState.nextRecordIds.walls)
                : 1,
            activeRuntimeWalls: [],
            activeRuntimeWallsByRecordId: new Map(),
            activeRecordSignature: ""
        };
        map._prototypeBlockedEdgeState = {
            activeEntriesBySectionKey: new Map(),
            blockerTokensByRecordId: new Map()
        };
        map._prototypeObjectState = {
            nextRecordId: Number.isInteger(prototypeState && prototypeState.nextRecordIds && prototypeState.nextRecordIds.objects)
                ? Number(prototypeState.nextRecordIds.objects)
                : 1,
            activeRuntimeObjects: [],
            activeRuntimeObjectsByRecordId: new Map(),
            parkedRuntimeObjectsByRecordId: new Map(),
            dirtyRuntimeObjects: new Set(),
            activeRecordSignature: "",
            captureScanNeeded: true
        };
        map._prototypeAnimalState = {
            nextRecordId: Number.isInteger(prototypeState && prototypeState.nextRecordIds && prototypeState.nextRecordIds.animals)
                ? Number(prototypeState.nextRecordIds.animals)
                : 1,
            activeRuntimeAnimals: [],
            activeRuntimeAnimalsByRecordId: new Map(),
            activeRecordSignature: ""
        };
        map._prototypePowerupState = {
            nextRecordId: Number.isInteger(prototypeState && prototypeState.nextRecordIds && prototypeState.nextRecordIds.powerups)
                ? Number(prototypeState.nextRecordIds.powerups)
                : 1,
            activeRuntimePowerups: [],
            activeRuntimePowerupsByRecordId: new Map(),
            activeRecordSignature: ""
        };
        map._prototypeBubbleShiftSession = null;
    }

    function getPrototypeManifest(sectionStateSource) {
        return (sectionStateSource && sectionStateSource.manifest && typeof sectionStateSource.manifest === "object")
            ? sectionStateSource.manifest
            : {};
    }

    function markPrototypeBlockedEdgesDirty(asset) {
        if (asset && typeof asset === "object") {
            asset._prototypeBlockedEdgesDirty = true;
        }
    }

    function markPrototypeClearanceDirty(asset) {
        if (asset && typeof asset === "object") {
            asset._prototypeClearanceDirty = true;
        }
    }

    function computePrototypeBlockedEdgesForAsset(map, asset) {
        if (!map || !asset || !globalScope.WallSectionUnit || typeof globalScope.WallSectionUnit.loadJson !== "function") {
            return [];
        }
        const wallRecords = Array.isArray(asset.walls) ? asset.walls : [];
        const blockedEdges = [];
        const seenEdgeKeys = new Set();
        const previousSuppress = !!map._suppressClearanceUpdates;
        map._suppressClearanceUpdates = true;
        try {
            for (let i = 0; i < wallRecords.length; i++) {
                const record = wallRecords[i];
                const recordId = Number(record && record.id);
                if (!record || !Number.isInteger(recordId)) continue;
                const runtimeWall = globalScope.WallSectionUnit.loadJson(record, map, { deferSetup: true });
                if (!runtimeWall) continue;
                try {
                    if (typeof runtimeWall._applyDirectionalBlocking === "function") {
                        runtimeWall._applyDirectionalBlocking();
                    }
                    const blockedConnections = runtimeWall._directionalBlockingDebug && Array.isArray(runtimeWall._directionalBlockingDebug.blockedConnections)
                        ? runtimeWall._directionalBlockingDebug.blockedConnections
                        : [];
                    for (let j = 0; j < blockedConnections.length; j++) {
                        const connection = blockedConnections[j];
                        const nodeA = connection && connection.a;
                        const nodeB = connection && connection.b;
                        if (!nodeA || !nodeB) continue;
                        const aKey = `${Number(nodeA.xindex)},${Number(nodeA.yindex)}`;
                        const bKey = `${Number(nodeB.xindex)},${Number(nodeB.yindex)}`;
                        const edgeKey = aKey <= bKey
                            ? `${recordId}|${aKey}|${bKey}`
                            : `${recordId}|${bKey}|${aKey}`;
                        if (seenEdgeKeys.has(edgeKey)) continue;
                        seenEdgeKeys.add(edgeKey);
                        blockedEdges.push({
                            recordId,
                            a: { xindex: Number(nodeA.xindex), yindex: Number(nodeA.yindex) },
                            b: { xindex: Number(nodeB.xindex), yindex: Number(nodeB.yindex) }
                        });
                    }
                } finally {
                    if (typeof runtimeWall.removeFromMapNodes === "function") {
                        runtimeWall.removeFromMapNodes();
                    }
                    if (globalScope.WallSectionUnit._allSections instanceof Map) {
                        globalScope.WallSectionUnit._allSections.delete(runtimeWall.id);
                    }
                    runtimeWall.gone = true;
                    if (typeof runtimeWall.destroy === "function") {
                        runtimeWall.destroy();
                    }
                }
            }
        } finally {
            map._suppressClearanceUpdates = previousSuppress;
        }
        asset.blockedEdges = blockedEdges;
        asset._prototypeBlockedEdgesDirty = false;
        return blockedEdges;
    }

    function ensurePrototypeBlockedEdges(map, sectionKeys = null) {
        const state = map && map._prototypeSectionState;
        if (!state || !Array.isArray(state.orderedSectionAssets)) return 0;
        const targetKeys = sectionKeys instanceof Set ? sectionKeys : null;
        let computedCount = 0;
        for (let i = 0; i < state.orderedSectionAssets.length; i++) {
            const asset = state.orderedSectionAssets[i];
            if (!asset) continue;
            if (targetKeys && !targetKeys.has(asset.key)) continue;
            if (asset._prototypeBlockedEdgesDirty !== true && Array.isArray(asset.blockedEdges)) continue;
            computePrototypeBlockedEdgesForAsset(map, asset);
            computedCount += 1;
        }
        return computedCount;
    }

    function applyPrototypeSectionClearanceToNodes(map, sectionKeys = null) {
        const state = map && map._prototypeSectionState;
        if (!state || !(state.sectionAssetsByKey instanceof Map) || !(state.nodesBySectionKey instanceof Map)) return 0;
        const targetKeys = sectionKeys instanceof Set ? sectionKeys : null;
        let appliedCount = 0;
        for (const [sectionKey, asset] of state.sectionAssetsByKey.entries()) {
            if (targetKeys && !targetKeys.has(sectionKey)) continue;
            const nodes = state.nodesBySectionKey.get(sectionKey) || [];
            const clearanceByTile = (asset && asset.clearanceByTile && typeof asset.clearanceByTile === "object")
                ? asset.clearanceByTile
                : null;
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (!node) continue;
                const coordKey = `${node.xindex},${node.yindex}`;
                const rawClearance = clearanceByTile ? clearanceByTile[coordKey] : null;
                node.clearance = Number.isFinite(rawClearance) ? Number(rawClearance) : Infinity;
                appliedCount += 1;
            }
        }
        return appliedCount;
    }

    function applyPrototypeSectionClearanceChunk(map, sectionKey, startIndex = 0, maxNodes = Infinity) {
        const state = map && map._prototypeSectionState;
        if (!state || !(state.sectionAssetsByKey instanceof Map) || !(state.nodesBySectionKey instanceof Map)) {
            return { appliedCount: 0, nextIndex: startIndex, done: true };
        }
        const asset = state.sectionAssetsByKey.get(sectionKey) || null;
        const nodes = state.nodesBySectionKey.get(sectionKey) || [];
        if (!asset || nodes.length === 0) {
            return { appliedCount: 0, nextIndex: startIndex, done: true };
        }
        const clearanceByTile = (asset.clearanceByTile && typeof asset.clearanceByTile === "object")
            ? asset.clearanceByTile
            : null;
        const safeStart = Math.max(0, Number(startIndex) || 0);
        const limit = Math.max(1, Number(maxNodes) || 1);
        const end = Math.min(nodes.length, safeStart + limit);
        let appliedCount = 0;
        for (let i = safeStart; i < end; i++) {
            const node = nodes[i];
            if (!node) continue;
            const coordKey = `${node.xindex},${node.yindex}`;
            const rawClearance = clearanceByTile ? clearanceByTile[coordKey] : null;
            node.clearance = Number.isFinite(rawClearance) ? Number(rawClearance) : Infinity;
            appliedCount += 1;
        }
        return {
            appliedCount,
            nextIndex: end,
            done: end >= nodes.length
        };
    }

    function computePrototypeSparseClearance(map) {
        const state = map && map._prototypeSectionState;
        if (!state || !Array.isArray(state.allNodes)) return 0;
        const adjDirs = [1, 3, 5, 7, 9, 11];
        const queue = [];
        const nodes = state.allNodes;

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (!node) continue;
            if (typeof node.isBlocked === "function" ? node.isBlocked() : (node.blocked || node.blockedByObjects > 0)) {
                node.clearance = 0;
                queue.push([node, 0]);
            } else {
                node.clearance = Infinity;
            }
        }

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (!node || node.clearance <= 0) continue;
            if (!(node.blockedNeighbors instanceof Map) || node.blockedNeighbors.size === 0) continue;

            let hasAdjacentBlocker = false;
            for (const dir of node.blockedNeighbors.keys()) {
                const blockers = node.blockedNeighbors.get(dir);
                if (dir % 2 === 1 && prototypeHasActiveDirectionalBlockers(blockers)) {
                    hasAdjacentBlocker = true;
                    break;
                }
            }
            if (!hasAdjacentBlocker) {
                let hasAnyDirectionalBlocker = false;
                for (const blockers of node.blockedNeighbors.values()) {
                    if (prototypeHasActiveDirectionalBlockers(blockers)) {
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

        let head = 0;
        while (head < queue.length) {
            const [current, dist] = queue[head++];
            const nextDist = dist + 1;
            for (let i = 0; i < adjDirs.length; i++) {
                const neighbor = current && current.neighbors ? current.neighbors[adjDirs[i]] : null;
                if (!neighbor) continue;
                if (nextDist < neighbor.clearance) {
                    neighbor.clearance = nextDist;
                    queue.push([neighbor, nextDist]);
                }
            }
        }

        return nodes.length;
    }

    function persistPrototypeSparseClearance(map, sectionKeys = null) {
        const state = map && map._prototypeSectionState;
        if (!state || !(state.sectionAssetsByKey instanceof Map) || !(state.nodesBySectionKey instanceof Map)) return 0;
        const targetKeys = sectionKeys instanceof Set ? sectionKeys : null;
        let persistedCount = 0;
        for (const [sectionKey, asset] of state.sectionAssetsByKey.entries()) {
            if (targetKeys && !targetKeys.has(sectionKey)) continue;
            const nodes = state.nodesBySectionKey.get(sectionKey) || [];
            const clearanceByTile = {};
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (!node) continue;
                const coordKey = `${node.xindex},${node.yindex}`;
                clearanceByTile[coordKey] = Number.isFinite(node.clearance) ? Number(node.clearance) : null;
            }
            asset.clearanceByTile = clearanceByTile;
            asset._prototypeClearanceDirty = false;
            persistedCount += 1;
        }
        return persistedCount;
    }

    function rebuildPrototypeSectionClearance(map, sectionKeys = null) {
        const state = map && map._prototypeSectionState;
        if (!state || !Array.isArray(state.orderedSectionAssets)) return 0;
        const targetKeys = sectionKeys instanceof Set ? sectionKeys : null;
        let needsCompute = false;
        for (let i = 0; i < state.orderedSectionAssets.length; i++) {
            const asset = state.orderedSectionAssets[i];
            if (!asset) continue;
            if (targetKeys && !targetKeys.has(asset.key)) continue;
            if (asset._prototypeClearanceDirty === true) {
                needsCompute = true;
                break;
            }
        }
        if (needsCompute) {
            computePrototypeSparseClearance(map);
            persistPrototypeSparseClearance(map);
        } else {
            applyPrototypeSectionClearanceToNodes(map, targetKeys);
        }
        return needsCompute ? 1 : 0;
    }

    function createPrototypeBlockedEdgeToken(recordId, sectionKey) {
        return {
            type: "wallSection",
            category: "walls",
            blocksTile: true,
            isPassable: false,
            gone: false,
            _prototypeSectionBlockedEdge: true,
            _prototypeSectionKey: sectionKey,
            _prototypeRecordId: recordId
        };
    }

    function ensurePrototypeBlockedEdgeState(map) {
        if (!map || !map._prototypeBlockedEdgeState || !(map._prototypeBlockedEdgeState.activeEntriesBySectionKey instanceof Map)) {
            map._prototypeBlockedEdgeState = {
                activeEntriesBySectionKey: new Map(),
                blockerTokensByRecordId: new Map()
            };
        }
        return map._prototypeBlockedEdgeState;
    }

    function getPrototypeBlockedEdgeToken(map, recordId, sectionKey) {
        const blockedEdgeState = ensurePrototypeBlockedEdgeState(map);
        if (!blockedEdgeState.blockerTokensByRecordId.has(recordId)) {
            blockedEdgeState.blockerTokensByRecordId.set(recordId, createPrototypeBlockedEdgeToken(recordId, sectionKey));
        }
        const token = blockedEdgeState.blockerTokensByRecordId.get(recordId);
        if (token) {
            token._prototypeSectionKey = sectionKey;
            token.gone = false;
        }
        return token;
    }

    function removePrototypeBlockedEdgesForSection(map, sectionKey, changedNodesOut = null) {
        const blockedEdgeState = ensurePrototypeBlockedEdgeState(map);
        const activeEntry = blockedEdgeState.activeEntriesBySectionKey.get(sectionKey);
        if (!activeEntry || !Array.isArray(activeEntry.links) || activeEntry.links.length === 0) {
            blockedEdgeState.activeEntriesBySectionKey.delete(sectionKey);
            return 0;
        }
        let removedCount = 0;
        for (let i = 0; i < activeEntry.links.length; i++) {
            const link = activeEntry.links[i];
            const node = link && link.node;
            const direction = Number(link && link.direction);
            const blocker = link && link.blocker;
            if (!node || !Number.isInteger(direction) || !blocker) continue;
            if (!(node.blockedNeighbors instanceof Map) || !node.blockedNeighbors.has(direction)) continue;
            const blockers = node.blockedNeighbors.get(direction);
            if (!(blockers instanceof Set) || !blockers.has(blocker)) continue;
            blockers.delete(blocker);
            if (blockers.size === 0) {
                node.blockedNeighbors.delete(direction);
            }
            removedCount += 1;
            if (changedNodesOut instanceof Set) {
                changedNodesOut.add(node);
            }
        }
        blockedEdgeState.activeEntriesBySectionKey.delete(sectionKey);
        return removedCount;
    }

    function applyPrototypeBlockedEdgesForSection(map, sectionKey, changedNodesOut = null) {
        const asset = map && typeof map.getPrototypeSectionAsset === "function"
            ? map.getPrototypeSectionAsset(sectionKey)
            : null;
        if (!asset || !Array.isArray(asset.blockedEdges) || asset.blockedEdges.length === 0) {
            ensurePrototypeBlockedEdgeState(map).activeEntriesBySectionKey.delete(sectionKey);
            return 0;
        }

        const blockedEdgeState = ensurePrototypeBlockedEdgeState(map);
        const links = [];
        let appliedCount = 0;
        for (let i = 0; i < asset.blockedEdges.length; i++) {
            const edge = asset.blockedEdges[i];
            const recordId = Number(edge && edge.recordId);
            if (!Number.isInteger(recordId)) continue;
            const nodeA = edge && edge.a ? map.getNodeByIndex(edge.a.xindex, edge.a.yindex) : null;
            const nodeB = edge && edge.b ? map.getNodeByIndex(edge.b.xindex, edge.b.yindex) : null;
            if (!nodeA || !nodeB || !Array.isArray(nodeA.neighbors) || !Array.isArray(nodeB.neighbors)) continue;
            const dirA = nodeA.neighbors.indexOf(nodeB);
            const dirB = nodeB.neighbors.indexOf(nodeA);
            if (dirA < 0 && dirB < 0) continue;

            const wallState = map && map._prototypeWallState;
            const runtimeWall = (wallState && wallState.activeRuntimeWallsByRecordId instanceof Map)
                ? wallState.activeRuntimeWallsByRecordId.get(recordId)
                : null;
            const blocker = (runtimeWall && typeof runtimeWall === "object")
                ? runtimeWall
                : getPrototypeBlockedEdgeToken(map, recordId, sectionKey);
            if (dirA >= 0) {
                if (!(nodeA.blockedNeighbors instanceof Map)) nodeA.blockedNeighbors = new Map();
                if (!nodeA.blockedNeighbors.has(dirA)) nodeA.blockedNeighbors.set(dirA, new Set());
                const blockersA = nodeA.blockedNeighbors.get(dirA);
                if (!blockersA.has(blocker)) {
                    blockersA.add(blocker);
                    links.push({ node: nodeA, direction: dirA, blocker });
                    appliedCount += 1;
                    if (changedNodesOut instanceof Set) changedNodesOut.add(nodeA);
                }
            }
            if (dirB >= 0) {
                if (!(nodeB.blockedNeighbors instanceof Map)) nodeB.blockedNeighbors = new Map();
                if (!nodeB.blockedNeighbors.has(dirB)) nodeB.blockedNeighbors.set(dirB, new Set());
                const blockersB = nodeB.blockedNeighbors.get(dirB);
                if (!blockersB.has(blocker)) {
                    blockersB.add(blocker);
                    links.push({ node: nodeB, direction: dirB, blocker });
                    appliedCount += 1;
                    if (changedNodesOut instanceof Set) changedNodesOut.add(nodeB);
                }
            }
        }
        blockedEdgeState.activeEntriesBySectionKey.set(sectionKey, { links });
        return appliedCount;
    }

    function removePrototypeRuntimeWallVisual(runtimeWall) {
        if (!runtimeWall || runtimeWall.gone) return false;
        runtimeWall.gone = true;
        runtimeWall.vanishing = false;
        if (typeof runtimeWall.removeFromMapNodes === "function") {
            runtimeWall.removeFromMapNodes();
        }
        if (runtimeWall.connections instanceof Map) {
            runtimeWall.connections.clear();
        }
        if (Array.isArray(runtimeWall.attachedObjects)) {
            runtimeWall.attachedObjects.length = 0;
        }
        if (globalScope.WallSectionUnit && globalScope.WallSectionUnit._allSections instanceof Map) {
            globalScope.WallSectionUnit._allSections.delete(runtimeWall.id);
        }
        if (typeof runtimeWall.destroy === "function") {
            runtimeWall.destroy();
        }
        return true;
    }

    function markPrototypeObjectCaptureNeeded(map, obj = null) {
        if (!map || !map._prototypeObjectState) return;
        if (map._prototypeSuppressObjectDirtyTracking === true) return;
        if (obj && typeof obj.saveJson === "function" && obj.type !== "wallSection") {
            if (!(map._prototypeObjectState.dirtyRuntimeObjects instanceof Set)) {
                map._prototypeObjectState.dirtyRuntimeObjects = new Set();
            }
            map._prototypeObjectState.dirtyRuntimeObjects.add(obj);
        }
        if (obj && obj._prototypeObjectManaged === true && obj._prototypeRuntimeRecord === true) {
            obj._prototypeDirty = true;
        }
        map._prototypeObjectState.captureScanNeeded = true;
    }

    function installPrototypeObjectDirtyTracking(map) {
        if (!map || map._prototypeObjectDirtyTrackingInstalled === true) return;
        map._prototypeObjectDirtyTrackingInstalled = true;

        const NodeCtor = globalScope.MapNode
            || (map.nodes && map.nodes[0] && map.nodes[0][0] && map.nodes[0][0].constructor);
        if (NodeCtor && NodeCtor.prototype) {
            if (!NodeCtor.prototype._prototypeOriginalAddObject && typeof NodeCtor.prototype.addObject === "function") {
                NodeCtor.prototype._prototypeOriginalAddObject = NodeCtor.prototype.addObject;
                NodeCtor.prototype.addObject = function prototypeTrackedAddObject(obj) {
                    const result = NodeCtor.prototype._prototypeOriginalAddObject.call(this, obj);
                    const mapRef = (obj && obj.map) || globalScope.map || null;
                    if (mapRef && mapRef._prototypeSectionState && this && this._prototypeSectionKey) {
                        markPrototypeObjectCaptureNeeded(mapRef, obj);
                    }
                    return result;
                };
            }
            if (!NodeCtor.prototype._prototypeOriginalRemoveObject && typeof NodeCtor.prototype.removeObject === "function") {
                NodeCtor.prototype._prototypeOriginalRemoveObject = NodeCtor.prototype.removeObject;
                NodeCtor.prototype.removeObject = function prototypeTrackedRemoveObject(obj) {
                    const result = NodeCtor.prototype._prototypeOriginalRemoveObject.call(this, obj);
                    const mapRef = (obj && obj.map) || globalScope.map || null;
                    if (mapRef && mapRef._prototypeSectionState && this && this._prototypeSectionKey) {
                        markPrototypeObjectCaptureNeeded(mapRef, obj);
                    }
                    return result;
                };
            }
        }
    }

    function updateActiveBubbleForActor(map, actor, options = {}) {
        const state = map && map._prototypeSectionState;
        if (!state || !actor) return false;
        const force = options.force === true;
        const actorSectionCoord = resolvePrototypeSectionCoordForWorldPosition(state, actor.x, actor.y);
        if (!actorSectionCoord) return false;
        const actorSectionKey = makeSectionKey(actorSectionCoord);

        if (force || !state.activeSectionKeys.has(actorSectionKey)) {
            return setActiveCenter(map, actorSectionKey);
        }

        const currentSection = state.sectionsByKey.get(state.activeCenterKey);
        if (!currentSection) return setActiveCenter(map, actorSectionKey);
        if (actorSectionKey === state.activeCenterKey) return false;

        ensurePrototypeSectionExists(map, state, actorSectionCoord);
        const targetSection = state.sectionsByKey.get(actorSectionKey);
        if (!targetSection) return false;

        const currentDistance = Math.hypot(
            Number(actor.x) - Number(currentSection.centerWorld.x),
            Number(actor.y) - Number(currentSection.centerWorld.y)
        );
        const targetDistance = Math.hypot(
            Number(actor.x) - Number(targetSection.centerWorld.x),
            Number(actor.y) - Number(targetSection.centerWorld.y)
        );
        const hysteresisDistance = Math.max(
            0.01,
            map.distanceBetweenPoints(
                currentSection.centerWorld.x,
                currentSection.centerWorld.y,
                targetSection.centerWorld.x,
                targetSection.centerWorld.y
            ) * state.hysteresisRatio
        );

        if (targetDistance + hysteresisDistance < currentDistance) {
            return setActiveCenter(map, actorSectionKey);
        }

        return false;
    }

    function attachPrototypeApis(map, prototypeState) {
        map._prototypeSectionState = prototypeState;
        map._twoSectionPrototype = buildPrototypeSummary(prototypeState);
        if (Array.isArray(prototypeState && prototypeState.orderedSectionAssets)) {
            for (let i = 0; i < prototypeState.orderedSectionAssets.length; i++) {
                rebuildPrototypeAssetObjectNameRegistry(prototypeState.orderedSectionAssets[i]);
            }
        }
        installPrototypeObjectDirtyTracking(map);

        map.getPrototypeActiveSectionKeys = function getPrototypeActiveSectionKeys() {
                return this._prototypeSectionState ? new Set(this._prototypeSectionState.activeSectionKeys) : new Set();
        };
        map.getPrototypeBubbleSectionKeys = function getPrototypeBubbleSectionKeys(centerSectionKey = null) {
            const state = this._prototypeSectionState;
            if (!state) return new Set();
            const key = (typeof centerSectionKey === "string" && centerSectionKey.length > 0)
                ? centerSectionKey
                : state.activeCenterKey;
            ensurePrototypeBubbleSectionsExist(this, state, key);
            return getBubbleKeysForCenter(state, key);
        };
        map.getPrototypeSectionAsset = function getPrototypeSectionAsset(sectionKey) {
            const state = this._prototypeSectionState;
            if (!state || !(state.sectionAssetsByKey instanceof Map)) return null;
            return state.sectionAssetsByKey.get(sectionKey) || null;
        };
        map.rebuildPrototypeSectionObjectNameRegistry = function rebuildPrototypeSectionObjectNameRegistry(sectionKey = null) {
            const state = this._prototypeSectionState;
            if (!state || !(state.sectionAssetsByKey instanceof Map)) return new Map();
            if (typeof sectionKey === "string" && sectionKey.length > 0) {
                const asset = state.sectionAssetsByKey.get(sectionKey) || null;
                return rebuildPrototypeAssetObjectNameRegistry(asset);
            }
            const out = new Map();
            for (const [key, asset] of state.sectionAssetsByKey.entries()) {
                out.set(key, rebuildPrototypeAssetObjectNameRegistry(asset));
            }
            return out;
        };
        map.generatePrototypeObjectScriptingName = function generatePrototypeObjectScriptingName(baseName, targetSectionKey, options = {}) {
            const state = this._prototypeSectionState;
            if (!state || typeof targetSectionKey !== "string" || targetSectionKey.length === 0) return "";
            return generatePrototypeBubbleUniqueObjectName(this, state, targetSectionKey, baseName, options);
        };
        map.findPrototypeNamedObjectInBubble = function findPrototypeNamedObjectInBubble(name, centerSectionKey = null) {
            const state = this._prototypeSectionState;
            if (!state) return null;
            return resolvePrototypeActiveNamedObject(this, state, name, centerSectionKey);
        };
        const markPrototypeRuntimeTargetDirty = (target) => {
            if (!target || typeof target !== "object" || target.gone || target._prototypeRuntimeRecord !== true) {
                return false;
            }
            target._prototypeDirty = true;
            if (target._prototypeObjectManaged === true && map._prototypeObjectState) {
                if (!(map._prototypeObjectState.dirtyRuntimeObjects instanceof Set)) {
                    map._prototypeObjectState.dirtyRuntimeObjects = new Set();
                }
                map._prototypeObjectState.dirtyRuntimeObjects.add(target);
                map._prototypeObjectState.captureScanNeeded = true;
            }
            return true;
        };
        map.setPrototypeRuntimeObjectScriptingName = function setPrototypeRuntimeObjectScriptingName(target, rawName, options = {}) {
            if (!target || typeof target !== "object") return false;
            const state = this._prototypeSectionState;
            if (!state) return false;
            const nextName = normalizePrototypeScriptingName(rawName);
            const restoreFromSave = !!(options && options.restoreFromSave === true);
            const targetSectionKey = (typeof options.targetSectionKey === "string" && options.targetSectionKey.length > 0)
                ? options.targetSectionKey
                : (
                    (typeof target._prototypeOwnerSectionKey === "string" && target._prototypeOwnerSectionKey.length > 0)
                        ? target._prototypeOwnerSectionKey
                        : this.getPrototypeSectionKeyForWorldPoint(target.x, target.y)
                );
            if (!targetSectionKey) return false;
            ensurePrototypeBubbleSectionsExist(this, state, targetSectionKey);
            if (!nextName) {
                target.scriptingName = "";
                markPrototypeRuntimeTargetDirty(target);
                return true;
            }
            if (!restoreFromSave) {
                const existing = resolvePrototypeActiveNamedObject(this, state, nextName, targetSectionKey);
                if (existing && existing !== target) return false;
                const usedNames = collectPrototypeBubbleObjectNames(this, state, targetSectionKey, {
                    ignoreRuntimeObj: target,
                    ignoreRecordId: Number.isInteger(target && target._prototypeRecordId)
                        ? Number(target._prototypeRecordId)
                        : null
                });
                if (usedNames.has(nextName)) return false;
            }
            target.scriptingName = nextName;
            markPrototypeRuntimeTargetDirty(target);
            return true;
        };
        map.ensurePrototypeBlockedEdges = function ensurePrototypeBlockedEdgesForMap(sectionKeys = null) {
            return ensurePrototypeBlockedEdges(this, sectionKeys);
        };
        map.applyPrototypeSectionClearance = function applyPrototypeSectionClearanceForMap(sectionKeys = null) {
            return applyPrototypeSectionClearanceToNodes(this, sectionKeys);
        };
        map.rebuildPrototypeSectionClearance = function rebuildPrototypeSectionClearanceForMap(sectionKeys = null) {
            return rebuildPrototypeSectionClearance(this, sectionKeys);
        };
        map.ensurePrototypeSectionClearance = function ensurePrototypeSectionClearanceForMap(sectionKeys = null) {
            return rebuildPrototypeSectionClearance(this, sectionKeys);
        };
        map.exportPrototypeSectionAssets = function exportPrototypeSectionAssets() {
            const state = this._prototypeSectionState;
            if (!state || !Array.isArray(state.orderedSectionAssets)) return [];
            this.rebuildPrototypeSectionObjectNameRegistry();
            ensurePrototypeBlockedEdges(this);
            rebuildPrototypeSectionClearance(this);
            return state.orderedSectionAssets.map((asset) => ({
                id: asset.id,
                key: asset.key,
                coord: { q: asset.coord.q, r: asset.coord.r },
                centerAxial: { q: asset.centerAxial.q, r: asset.centerAxial.r },
                centerOffset: { x: asset.centerOffset.x, y: asset.centerOffset.y },
                neighborKeys: Array.isArray(asset.neighborKeys) ? asset.neighborKeys.slice() : [],
                tileCoordKeys: Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys.slice() : [],
                groundTextureId: Number.isFinite(asset.groundTextureId) ? Number(asset.groundTextureId) : 0,
                groundTiles: (asset.groundTiles && typeof asset.groundTiles === "object") ? { ...asset.groundTiles } : {},
                walls: Array.isArray(asset.walls) ? asset.walls.map((wall) => ({ ...wall })) : [],
                blockedEdges: clonePrototypeBlockedEdges(asset.blockedEdges),
                clearanceByTile: clonePrototypeClearanceByTile(asset.clearanceByTile),
                objects: Array.isArray(asset.objects) ? asset.objects.map((obj) => ({ ...obj })) : [],
                animals: Array.isArray(asset.animals) ? asset.animals.map((animal) => ({ ...animal })) : [],
                powerups: Array.isArray(asset.powerups) ? asset.powerups.map((powerup) => ({ ...powerup })) : []
            }));
        };
        map.loadPrototypeSectionWorld = function loadPrototypeSectionWorld(assetBundle) {
            if (!assetBundle || typeof assetBundle !== "object") return false;
            const config = getPrototypeConfig();
            const sectionStateSource = buildSectionStateFromAssetBundle(assetBundle, config, this);
            const nextState = createPrototypeState(
                sectionStateSource,
                (typeof assetBundle.activeCenterKey === "string" && assetBundle.activeCenterKey.length > 0)
                    ? assetBundle.activeCenterKey
                    : makeSectionKey({ q: 0, r: 0 })
            );
            assignNodesToSections(this, nextState);
            this._prototypeSectionState = nextState;
            this._twoSectionPrototype = buildPrototypeSummary(nextState);
            ensurePrototypeBlockedEdges(this);
            if (typeof setActiveCenter === "function") {
                setActiveCenter(this, nextState.activeCenterKey);
            }
            initializePrototypeRuntimeState(this, nextState);
            if (typeof globalScope.invalidateMinimap === "function") {
                globalScope.invalidateMinimap();
            }
            return true;
        };
        map._baseGetTraversalInfo = (typeof map.getTraversalInfo === "function") ? map.getTraversalInfo.bind(map) : null;
        map._baseFindPathAStar = (typeof map.findPathAStar === "function") ? map.findPathAStar.bind(map) : null;
        map._baseFindPath = (typeof map.findPath === "function") ? map.findPath.bind(map) : null;
        map.getLoadedPrototypeNodes = function getLoadedPrototypeNodes() {
            return (this._prototypeSectionState && Array.isArray(this._prototypeSectionState.loadedNodes))
                ? this._prototypeSectionState.loadedNodes.slice()
                : [];
        };
        map.getLoadedPrototypeNodeKeySet = function getLoadedPrototypeNodeKeySet() {
            return (this._prototypeSectionState && this._prototypeSectionState.loadedNodeKeySet instanceof Set)
                ? this._prototypeSectionState.loadedNodeKeySet
                : new Set();
        };
        map.getNodeByIndex = function getNodeByIndex(xindex, yindex) {
            const state = this._prototypeSectionState;
            if (!state || !(state.allNodesByCoordKey instanceof Map)) return null;
            return state.allNodesByCoordKey.get(`${Number(xindex)},${Number(yindex)}`) || null;
        };
        map.getAllPrototypeNodes = function getAllPrototypeNodes() {
            return (this._prototypeSectionState && Array.isArray(this._prototypeSectionState.allNodes))
                ? this._prototypeSectionState.allNodes.slice()
                : [];
        };
        map.getPrototypeSectionSeamSegments = function getPrototypeSectionSeamSegments() {
            return (this._prototypeSectionState && Array.isArray(this._prototypeSectionState.seamSegments))
                ? this._prototypeSectionState.seamSegments.slice()
                : [];
        };
        map.isPrototypeNodeActive = function isPrototypeNodeActive(node) {
            return !!(node && node._prototypeSectionActive === true);
        };
        map.shouldRenderNode = function shouldRenderNode(node) {
            return !!(node && node._prototypeSectionActive === true);
        };
        map.getMinimapNodeColor = function getMinimapNodeColor(node) {
            if (!node || node._prototypeVoid === true) return "#000000";
            return node._prototypeSectionActive === true ? "#007700" : "#000000";
        };
        map.canOccupyWorldPosition = function canOccupyWorldPosition(worldX, worldY) {
            const node = (typeof this.worldToNode === "function") ? this.worldToNode(worldX, worldY) : null;
            return !!(node && node._prototypeSectionActive === true && node._prototypeVoid !== true && !node.isBlocked());
        };
        map.getNodesInIndexWindow = function getNodesInIndexWindow(xStart, xEnd, yStart, yEnd) {
            const state = this._prototypeSectionState;
            const sparseNodes = (state && state.allNodesByCoordKey instanceof Map) ? state.allNodesByCoordKey : null;
            if (!sparseNodes) return [];
            const out = [];
            const minX = Math.floor(Math.min(Number(xStart), Number(xEnd)));
            const maxX = Math.floor(Math.max(Number(xStart), Number(xEnd)));
            const minY = Math.floor(Math.min(Number(yStart), Number(yEnd)));
            const maxY = Math.floor(Math.max(Number(yStart), Number(yEnd)));
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    const node = sparseNodes.get(`${x},${y}`);
                    if (node) out.push(node);
                }
            }
            return out;
        };
        map.getVisibleNodesInViewport = function getVisibleNodesInViewport(camera, xPadding = 0, yPadding = 0) {
            const state = this._prototypeSectionState;
            const loadedNodes = (state && Array.isArray(state.loadedNodes)) ? state.loadedNodes : [];
            if (loadedNodes.length === 0) return [];
            const cameraRef = camera || globalScope.viewport || {};
            const cameraWidth = Number.isFinite(cameraRef.width) ? cameraRef.width : 0;
            const cameraHeight = Number.isFinite(cameraRef.height) ? cameraRef.height : 0;
            const padXWorld = Math.max(0, Number(xPadding) || 0) * 0.866;
            const padYWorld = Math.max(0, Number(yPadding) || 0);
            const minX = Number(cameraRef.x) - padXWorld;
            const maxX = Number(cameraRef.x) + cameraWidth + padXWorld;
            const minY = Number(cameraRef.y) - padYWorld;
            const maxY = Number(cameraRef.y) + cameraHeight + padYWorld;
            const visible = [];
            for (let i = 0; i < loadedNodes.length; i++) {
                const node = loadedNodes[i];
                if (!node) continue;
                if (node.x < minX || node.x > maxX) continue;
                if (node.y < minY || node.y > maxY) continue;
                visible.push(node);
            }
            return visible;
        };
        map._baseWorldToNode = (typeof map.worldToNode === "function") ? map.worldToNode.bind(map) : null;
        map._baseWorldToNodeOrMidpoint = (typeof map.worldToNodeOrMidpoint === "function") ? map.worldToNodeOrMidpoint.bind(map) : null;
        map.worldToNode = function prototypeWorldToNode(worldX, worldY) {
            const state = this._prototypeSectionState;
            const sparseNodes = (state && state.allNodesByCoordKey instanceof Map) ? state.allNodesByCoordKey : null;
            if (!sparseNodes || sparseNodes.size === 0) {
                if (typeof this._baseWorldToNode !== "function") return null;
                const fallbackNode = this._baseWorldToNode(worldX, worldY);
                return this.isPrototypeNodeActive(fallbackNode) ? fallbackNode : null;
            }

            const approxX = Math.round(Number(worldX) / 0.866);
            const approxY = Math.round(Number(worldY) - (approxX % 2 === 0 ? 0.5 : 0));
            let best = null;
            let bestDist = Infinity;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const node = sparseNodes.get(`${approxX + dx},${approxY + dy}`);
                    if (!node) continue;
                    const dist = Math.hypot(
                        Number(node.x) - Number(worldX),
                        Number(node.y) - Number(worldY)
                    );
                    if (dist < bestDist) {
                        bestDist = dist;
                        best = node;
                    }
                }
            }
            return (best && this.isPrototypeNodeActive(best)) ? best : null;
        };
        map.worldToNodeOrMidpoint = function prototypeWorldToNodeOrMidpoint(worldX, worldY) {
            const node = this.worldToNode(worldX, worldY);
            if (!node) {
                if (typeof this._baseWorldToNodeOrMidpoint === "function") {
                    return this._baseWorldToNodeOrMidpoint(worldX, worldY);
                }
                return null;
            }
            const nodeDist = Math.hypot(Number(node.x) - Number(worldX), Number(node.y) - Number(worldY));
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

                const midpoint = (typeof globalScope.makeMidpoint === "function")
                    ? globalScope.makeMidpoint(node, neighbor)
                    : null;
                if (!midpoint) continue;
                const midDist = Math.hypot(Number(midpoint.x) - Number(worldX), Number(midpoint.y) - Number(worldY));
                if (midDist < bestMidpointDist) {
                    bestMidpointDist = midDist;
                    bestMidpoint = midpoint;
                }
            }

            if (bestMidpoint && bestMidpointDist < nodeDist) {
                return bestMidpoint;
            }
            return node;
        };
        map.getMidpointNode = function getMidpointNode(nodeA, nodeB) {
            if (typeof globalScope.makeMidpoint === "function") {
                return globalScope.makeMidpoint(nodeA, nodeB);
            }
            return null;
        };
        map.getTraversalInfo = function prototypeGetTraversalInfo(currentNode, directionIndex, options = {}) {
            if (!this.isPrototypeNodeActive(currentNode)) {
                return { allowed: false, neighborNode: null, penalty: 0, blockers: [] };
            }
            const neighborNode = currentNode && currentNode.neighbors
                ? currentNode.neighbors[directionIndex]
                : null;
            if (!this.isPrototypeNodeActive(neighborNode)) {
                return { allowed: false, neighborNode: null, penalty: 0, blockers: [] };
            }
            if (typeof this._baseGetTraversalInfo !== "function") {
                return { allowed: false, neighborNode: null, penalty: 0, blockers: [] };
            }
            return this._baseGetTraversalInfo(currentNode, directionIndex, options);
        };
        map.findPathAStar = function prototypeFindPathAStar(startingNode, destinationNode, options = {}) {
            if (!this.isPrototypeNodeActive(startingNode) || !this.isPrototypeNodeActive(destinationNode)) {
                return null;
            }
            if (typeof this._baseFindPathAStar !== "function") return null;
            const loadedCount = (this._prototypeSectionState && Array.isArray(this._prototypeSectionState.loadedNodes))
                ? this._prototypeSectionState.loadedNodes.length
                : 0;
            return this._baseFindPathAStar(startingNode, destinationNode, {
                ...options,
                maxIterations: Number.isFinite(options.maxIterations)
                    ? options.maxIterations
                    : Math.max(200, loadedCount * 8)
            });
        };
        map.findPath = function prototypeFindPath(startingNode, destinationNode, options = {}) {
            if (!this.isPrototypeNodeActive(startingNode) || !this.isPrototypeNodeActive(destinationNode)) {
                return null;
            }
            if (typeof this._baseFindPath !== "function") return null;
            return this._baseFindPath(startingNode, destinationNode, options);
        };
        map.setPrototypeActiveCenterKey = function setPrototypeActiveCenterKey(nextCenterKey) {
            return setActiveCenter(this, nextCenterKey);
        };
        const prototypeNow = () => (
            (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                ? performance.now()
                : Date.now()
        );
        const prependPrototypeTasks = (session, tasks) => {
            if (!session || !Array.isArray(session.queue) || !Array.isArray(tasks) || tasks.length === 0) return;
            session.queue.unshift(...tasks);
        };
        // Bubble shifts are intentionally allowed to span multiple frames so large
        // object loads do not regress back into one blocking spike.
        const createPrototypeAsyncBubbleShiftSession = (startedAtMs, previousCenterKey, layoutMs, options = {}) => ({
            from: previousCenterKey || "",
            to: (map._prototypeSectionState && map._prototypeSectionState.activeCenterKey) || "",
            startedAtMs,
            layoutMs,
            shiftFrameMs: null,
            frameBudgetMs: Math.max(0.25, Number(options.frameBudgetMs) || 2),
            queue: [],
            completed: false,
            workMs: Number(layoutMs) || 0,
            maxFrameSliceMs: 0,
            frameSliceCount: 0,
            wallStats: null,
            wallsChanged: false,
            objectsChanged: false,
            animalsChanged: false,
            powerupsChanged: false
        });
        const finalizePrototypeAsyncBubbleShiftSession = (session) => {
            if (!session || session.completed === true) return session;
            session.completed = true;
            const totalMs = prototypeNow() - session.startedAtMs;
            const wallStats = map._prototypeWallState && map._prototypeWallState.lastSyncStats
                ? map._prototypeWallState.lastSyncStats
                : null;
            const objectStats = map._prototypeObjectState && map._prototypeObjectState.lastSyncStats
                ? map._prototypeObjectState.lastSyncStats
                : null;
            const animalStats = map._prototypeAnimalState && map._prototypeAnimalState.lastSyncStats
                ? map._prototypeAnimalState.lastSyncStats
                : null;
            const powerupStats = map._prototypePowerupState && map._prototypePowerupState.lastSyncStats
                ? map._prototypePowerupState.lastSyncStats
                : null;
            try {
                updatePrototypeGpuDebugStats(map);
                console.log("[prototype bubble shift]", {
                    from: session.from,
                    to: session.to,
                    layoutMs: Number(Number(session.layoutMs || 0).toFixed(2)),
                    layoutDetail: map._prototypeSectionState && map._prototypeSectionState.lastLayoutStats
                        ? { ...map._prototypeSectionState.lastLayoutStats }
                        : null,
                    shiftFrameMs: Number((Number(session.shiftFrameMs) || 0).toFixed(2)),
                    totalMs: Number(totalMs.toFixed(2)),
                    workMs: Number((Number(session.workMs) || 0).toFixed(2)),
                    maxFrameSliceMs: Number((Number(session.maxFrameSliceMs) || 0).toFixed(2)),
                    frameSliceCount: Number(session.frameSliceCount) || 0,
                    loadedNodes: map._prototypeSectionState && Array.isArray(map._prototypeSectionState.loadedNodes)
                        ? map._prototypeSectionState.loadedNodes.length
                        : 0,
                    walls: wallStats ? { ...wallStats, changed: !!session.wallsChanged } : { changed: !!session.wallsChanged },
                    objects: objectStats ? { ...objectStats, changed: !!session.objectsChanged } : { changed: !!session.objectsChanged },
                    animals: animalStats ? { ...animalStats, changed: !!session.animalsChanged } : { changed: !!session.animalsChanged },
                    powerups: powerupStats ? { ...powerupStats, changed: !!session.powerupsChanged } : { changed: !!session.powerupsChanged }
                });
            } catch (_err) {
                // ignore debug logging failures
            }
            map._prototypeBubbleShiftSession = null;
            return session;
        };
        const advancePrototypeAsyncBubbleShiftSession = (session, options = {}) => {
            if (!session || session.completed === true) return session;
            const budgetMs = Math.max(0.25, Number(options.frameBudgetMs) || Number(session.frameBudgetMs) || 2);
            const deadline = prototypeNow() + budgetMs;
            const sliceStart = prototypeNow();
            while (session.queue.length > 0 && prototypeNow() < deadline) {
                const task = session.queue.shift();
                if (typeof task === "function") {
                    const taskStart = prototypeNow();
                    task();
                    session.workMs += prototypeNow() - taskStart;
                }
            }
            const sliceMs = prototypeNow() - sliceStart;
            if (sliceMs > 0) {
                session.frameSliceCount += 1;
                if (sliceMs > session.maxFrameSliceMs) {
                    session.maxFrameSliceMs = sliceMs;
                }
            }
            if (session.queue.length === 0) {
                return finalizePrototypeAsyncBubbleShiftSession(session);
            }
            return session;
        };
        const enqueuePrototypeAsyncLayoutSync = (session) => {
            const state = map && map._prototypeSectionState;
            if (!state || !state.pendingLayoutTransition) return;
            const transition = state.pendingLayoutTransition;
            const stats = {
                ensureSectionsMs: Number(transition.initialStats && transition.initialStats.ensureSectionsMs) || 0,
                compareMs: Number(transition.initialStats && transition.initialStats.compareMs) || 0,
                deactivateMs: 0,
                activateMs: 0,
                rebuildLoadedMs: 0,
                seamMs: 0,
                clearanceMs: 0,
                deactivatedNodeCount: 0,
                activatedNodeCount: 0
            };
            const chunkSize = 700;
            const tasks = [];
            const activateKeys = Array.isArray(transition.keysToActivate) ? transition.keysToActivate.slice() : [];
            const deactivateKeys = Array.isArray(transition.keysToDeactivate) ? transition.keysToDeactivate.slice() : [];
            for (let s = 0; s < activateKeys.length; s++) {
                const sectionKey = activateKeys[s];
                const nodes = state.nodesBySectionKey.get(sectionKey) || [];
                for (let i = 0; i < nodes.length; i += chunkSize) {
                    const startIndex = i;
                    tasks.push(() => {
                        const start = prototypeNow();
                        const end = Math.min(startIndex + chunkSize, nodes.length);
                        for (let n = startIndex; n < end; n++) {
                            const node = nodes[n];
                            if (!node) continue;
                            node._prototypeSectionActive = true;
                            node.blocked = false;
                            const coordKey = `${node.xindex},${node.yindex}`;
                            state.loadedNodesByCoordKey.set(coordKey, node);
                            if (!state.loadedNodeKeySet.has(coordKey)) {
                                state.loadedNodeKeySet.add(coordKey);
                                state.loadedNodes.push(node);
                            }
                            stats.activatedNodeCount += 1;
                        }
                        stats.activateMs += prototypeNow() - start;
                    });
                }
                tasks.push(() => {
                    if (!(state.actualActiveSectionKeys instanceof Set)) {
                        state.actualActiveSectionKeys = new Set();
                    }
                    state.actualActiveSectionKeys.add(sectionKey);
                });
            }
            for (let s = 0; s < deactivateKeys.length; s++) {
                const sectionKey = deactivateKeys[s];
                const nodes = state.nodesBySectionKey.get(sectionKey) || [];
                for (let i = 0; i < nodes.length; i += chunkSize) {
                    const startIndex = i;
                    tasks.push(() => {
                        const start = prototypeNow();
                        const end = Math.min(startIndex + chunkSize, nodes.length);
                        for (let n = startIndex; n < end; n++) {
                            const node = nodes[n];
                            if (!node) continue;
                            node._prototypeSectionActive = false;
                            node.blocked = true;
                            node.clearance = 0;
                            state.loadedNodesByCoordKey.delete(`${node.xindex},${node.yindex}`);
                            state.loadedNodeKeySet.delete(`${node.xindex},${node.yindex}`);
                            stats.deactivatedNodeCount += 1;
                        }
                        stats.deactivateMs += prototypeNow() - start;
                    });
                }
                tasks.push(() => {
                    if (state.actualActiveSectionKeys instanceof Set) {
                        state.actualActiveSectionKeys.delete(sectionKey);
                    }
                });
            }
            tasks.push(() => {
                const start = prototypeNow();
                state.loadedNodes = state.loadedNodes.filter((node) => (
                    node &&
                    node._prototypeSectionActive === true &&
                    state.loadedNodeKeySet.has(`${node.xindex},${node.yindex}`)
                ));
                stats.rebuildLoadedMs += prototypeNow() - start;
            });
            tasks.push(() => {
                const start = prototypeNow();
                updatePrototypeSeamSegmentsForSections(state, transition.changedSectionKeys instanceof Set ? transition.changedSectionKeys : new Set());
                stats.seamMs += prototypeNow() - start;
            });
            if (activateKeys.length > 0 && typeof map.applyPrototypeSectionClearance === "function") {
                const clearanceChunkSize = 1200;
                for (let i = 0; i < activateKeys.length; i++) {
                    const sectionKey = activateKeys[i];
                    const sectionNodes = state.nodesBySectionKey.get(sectionKey) || [];
                    for (let startIndex = 0; startIndex < sectionNodes.length; startIndex += clearanceChunkSize) {
                        const chunkStartIndex = startIndex;
                        tasks.push(() => {
                            const start = prototypeNow();
                            applyPrototypeSectionClearanceChunk(map, sectionKey, chunkStartIndex, clearanceChunkSize);
                            stats.clearanceMs += prototypeNow() - start;
                        });
                    }
                }
            }
            tasks.push(() => {
                state.pendingLayoutTransition = null;
                session.layoutMs = Number((
                    stats.ensureSectionsMs
                    + stats.compareMs
                    + stats.deactivateMs
                    + stats.activateMs
                    + stats.rebuildLoadedMs
                    + stats.seamMs
                    + stats.clearanceMs
                ).toFixed(2));
                state.lastLayoutStats = {
                    ms: session.layoutMs,
                    ensureSectionsMs: Number(stats.ensureSectionsMs.toFixed(2)),
                    compareMs: Number(stats.compareMs.toFixed(2)),
                    deactivateMs: Number(stats.deactivateMs.toFixed(2)),
                    activateMs: Number(stats.activateMs.toFixed(2)),
                    rebuildLoadedMs: Number(stats.rebuildLoadedMs.toFixed(2)),
                    seamMs: Number(stats.seamMs.toFixed(2)),
                    clearanceMs: Number(stats.clearanceMs.toFixed(2)),
                    deactivatedNodeCount: stats.deactivatedNodeCount,
                    activatedNodeCount: stats.activatedNodeCount,
                    loadedNodeCount: Array.isArray(state.loadedNodes) ? state.loadedNodes.length : 0,
                    keysToActivate: activateKeys.length,
                    keysToDeactivate: deactivateKeys.length
                };
            });
            prependPrototypeTasks(session, tasks);
        };
        const enqueuePrototypeAsyncObjectSync = (session) => {
            const objectState = map._prototypeObjectState;
            if (!objectState) return;
            const sync = {
                syncStartMs: prototypeNow(),
                captureMs: 0,
                collectMs: 0,
                stalePruneMs: 0,
                unloadMs: 0,
                loadMs: 0,
                roofLoadMs: 0,
                staticLoadMs: 0,
                roofLoaded: 0,
                staticLoaded: 0,
                roofRemoved: 0,
                staticRemoved: 0,
                parkedStored: 0,
                parkedReused: 0,
                parkedEvicted: 0,
                roadRefreshMs: 0,
                roadRefreshCount: 0,
                treeFinalizeMs: 0,
                invalidateMs: 0,
                loadedCount: 0,
                removedCount: 0,
                capturedAny: false,
                removedAny: false,
                loadedAny: false,
                desiredRecords: [],
                desiredRecordIds: new Set(),
                roadRefreshNodes: new Set(),
                profileByType: new Map(),
                treeDebugEnabled: !!(
                    globalScope.Tree &&
                    typeof globalScope.Tree.beginPrototypeLoadDebugSession === "function" &&
                    typeof globalScope.Tree.endPrototypeLoadDebugSession === "function"
                ),
                treeDebugStarted: false,
                captureDetail: {
                    pruneGoneMs: 0,
                    dirtyListBuildMs: 0,
                    scanDirtyMs: 0,
                    saveJsonMs: 0,
                    signatureMs: 0,
                    upsertMs: 0,
                    dirtyCandidateCount: 0,
                    dirtyProcessedCount: 0,
                    dirtySkippedCount: 0,
                    goneRemovedCount: 0
                }
            };
            const bumpProfile = (profileKey, field, deltaValue = 1, msValue = 0) => {
                const key = (typeof profileKey === "string" && profileKey.length > 0) ? profileKey : "unknown";
                if (!sync.profileByType.has(key)) {
                    sync.profileByType.set(key, { loaded: 0, removed: 0, ms: 0 });
                }
                const stats = sync.profileByType.get(key);
                stats[field] = (Number(stats[field]) || 0) + deltaValue;
                stats.ms = (Number(stats.ms) || 0) + (Number(msValue) || 0);
            };
            prependPrototypeTasks(session, [() => {
                const nextTasks = [];
                if (sync.treeDebugEnabled && sync.treeDebugStarted !== true) {
                    globalScope.Tree.beginPrototypeLoadDebugSession();
                    sync.treeDebugStarted = true;
                }
                if (objectState.captureScanNeeded === true) {
                    const goneStart = prototypeNow();
                    sync.goneRecordIds = [];
                    if (objectState.activeRuntimeObjectsByRecordId instanceof Map) {
                        for (const [recordId, runtimeObj] of objectState.activeRuntimeObjectsByRecordId.entries()) {
                            if (runtimeObj && !runtimeObj.gone && !runtimeObj.vanishing) continue;
                            sync.goneRecordIds.push(recordId);
                        }
                    }
                    sync.captureDetail.pruneGoneMs += prototypeNow() - goneStart;
                    sync.captureMs += prototypeNow() - goneStart;
                    if (objectState.dirtyRuntimeObjects instanceof Set && objectState.dirtyRuntimeObjects.size > 0) {
                        const dirtyListBuildStart = prototypeNow();
                        sync.dirtyObjects = Array.from(objectState.dirtyRuntimeObjects);
                        const dirtyListBuildMs = prototypeNow() - dirtyListBuildStart;
                        sync.captureDetail.dirtyListBuildMs += dirtyListBuildMs;
                        sync.captureMs += dirtyListBuildMs;
                        sync.captureDetail.dirtyCandidateCount = sync.dirtyObjects.length;
                    } else {
                        sync.dirtyObjects = [];
                    }
                    for (let i = 0; i < sync.goneRecordIds.length; i++) {
                        const recordId = sync.goneRecordIds[i];
                        nextTasks.push(() => {
                            const taskStart = prototypeNow();
                            if (removePrototypeObjectRecordById(objectState, Number(recordId))) {
                                sync.capturedAny = true;
                                sync.captureDetail.goneRemovedCount += 1;
                            }
                            const taskMs = prototypeNow() - taskStart;
                            sync.captureDetail.pruneGoneMs += taskMs;
                            sync.captureMs += taskMs;
                        });
                    }
                    for (let i = 0; i < sync.dirtyObjects.length; i++) {
                        const obj = sync.dirtyObjects[i];
                        nextTasks.push(() => {
                            const taskStart = prototypeNow();
                            if (objectState.dirtyRuntimeObjects instanceof Set) {
                                objectState.dirtyRuntimeObjects.delete(obj);
                            }
                            if (!isPrototypeSavableObject(obj)) {
                                sync.captureDetail.scanDirtyMs += prototypeNow() - taskStart;
                                sync.captureMs += prototypeNow() - taskStart;
                                return;
                            }
                            sync.captureDetail.dirtyProcessedCount += 1;
                            if (obj._prototypeRuntimeRecord === true && obj._prototypeDirty !== true) {
                                sync.captureDetail.dirtySkippedCount += 1;
                                const skippedMs = prototypeNow() - taskStart;
                                sync.captureDetail.scanDirtyMs += skippedMs;
                                sync.captureMs += skippedMs;
                                return;
                            }
                            const saveJsonStart = prototypeNow();
                            const currentSignature = buildPrototypeObjectPersistenceSignature(obj);
                            sync.captureDetail.saveJsonMs += prototypeNow() - saveJsonStart;
                            const previousSignature = (typeof obj._prototypePersistenceSignature === "string")
                                ? obj._prototypePersistenceSignature
                                : "";
                            if (!obj._prototypeRuntimeRecord || currentSignature !== previousSignature) {
                                const upsertStart = prototypeNow();
                                if (upsertPrototypeObjectRecord(obj)) {
                                    sync.capturedAny = true;
                                }
                                sync.captureDetail.upsertMs += prototypeNow() - upsertStart;
                            }
                            const taskMs = prototypeNow() - taskStart;
                            sync.captureDetail.scanDirtyMs += taskMs;
                            sync.captureMs += taskMs;
                        });
                    }
                }
                nextTasks.push(() => {
                    objectState.captureScanNeeded = !!(objectState.dirtyRuntimeObjects instanceof Set && objectState.dirtyRuntimeObjects.size > 0);
                    objectState.lastCaptureStats = {
                        pruneGoneMs: Number(sync.captureDetail.pruneGoneMs.toFixed(2)),
                        dirtyListBuildMs: Number(sync.captureDetail.dirtyListBuildMs.toFixed(2)),
                        scanDirtyMs: Number(sync.captureDetail.scanDirtyMs.toFixed(2)),
                        saveJsonMs: Number(sync.captureDetail.saveJsonMs.toFixed(2)),
                        signatureMs: Number(sync.captureDetail.signatureMs.toFixed(2)),
                        upsertMs: Number(sync.captureDetail.upsertMs.toFixed(2)),
                        dirtyCandidateCount: sync.captureDetail.dirtyCandidateCount,
                        dirtyProcessedCount: sync.captureDetail.dirtyProcessedCount,
                        dirtySkippedCount: sync.captureDetail.dirtySkippedCount,
                        goneRemovedCount: sync.captureDetail.goneRemovedCount
                    };
                });
                nextTasks.push(() => {
                    const collectStart = prototypeNow();
                    const activeSectionKeys = map.getPrototypeActiveSectionKeys();
                    sync.activeSectionKeys = activeSectionKeys;
                    const desiredRecords = [];
                    activeSectionKeys.forEach((sectionKey) => {
                        const asset = map.getPrototypeSectionAsset(sectionKey);
                        const records = Array.isArray(asset && asset.objects) ? asset.objects : null;
                        if (!Array.isArray(records)) return;
                        for (let i = 0; i < records.length; i++) {
                            desiredRecords.push({ sectionKey, record: records[i] });
                        }
                    });
                    sync.desiredRecords = desiredRecords;
                    sync.desiredSignature = desiredRecords
                        .map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "")
                        .join("|");
                    sync.collectMs += prototypeNow() - collectStart;

                    if (!sync.capturedAny && sync.desiredSignature === objectState.activeRecordSignature) {
                        if (sync.treeDebugStarted === true && sync.treeDebugEnabled) {
                            globalScope.Tree.endPrototypeLoadDebugSession();
                            sync.treeDebugStarted = false;
                        }
                        objectState.lastSyncStats = {
                            ms: Number((
                                sync.captureMs
                                + sync.collectMs
                                + sync.stalePruneMs
                                + sync.unloadMs
                                + sync.loadMs
                                + sync.invalidateMs
                            ).toFixed(2)),
                            desired: desiredRecords.length,
                            loaded: 0,
                            removed: 0,
                            active: objectState.activeRuntimeObjectsByRecordId instanceof Map ? objectState.activeRuntimeObjectsByRecordId.size : 0,
                            captureMs: Number(sync.captureMs.toFixed(2)),
                            collectMs: Number(sync.collectMs.toFixed(2)),
                            stalePruneMs: 0,
                            unloadMs: 0,
                            loadMs: 0,
                            roofLoadMs: 0,
                            staticLoadMs: 0,
                            roofLoaded: 0,
                            staticLoaded: 0,
                            roofRemoved: 0,
                            staticRemoved: 0,
                            parkedStored: 0,
                            parkedReused: 0,
                            parkedEvicted: 0,
                            parkedActive: objectState.parkedRuntimeObjectsByRecordId instanceof Map
                                ? objectState.parkedRuntimeObjectsByRecordId.size
                                : 0,
                            roadRefreshMs: 0,
                            roadRefreshCount: 0,
                            treeFinalizeMs: 0,
                            treeLoadDebug: null,
                            byType: {},
                            captureDetail: objectState.lastCaptureStats ? { ...objectState.lastCaptureStats } : null,
                            invalidateMs: 0
                        };
                        session.objectsChanged = false;
                        return;
                    }

                    if (!(objectState.activeRuntimeObjectsByRecordId instanceof Map)) {
                        objectState.activeRuntimeObjectsByRecordId = new Map();
                    }
                    const stalePruneStart = prototypeNow();
                    const staleRecordIds = [];
                    for (const [recordId, runtimeObj] of objectState.activeRuntimeObjectsByRecordId.entries()) {
                        if (runtimeObj && !runtimeObj.gone) continue;
                        staleRecordIds.push(recordId);
                    }
                    for (let i = 0; i < staleRecordIds.length; i++) {
                        objectState.activeRuntimeObjectsByRecordId.delete(staleRecordIds[i]);
                    }
                    sync.stalePruneMs += prototypeNow() - stalePruneStart;

                    sync.desiredRecordIds = new Set();
                    for (let i = 0; i < desiredRecords.length; i++) {
                        const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                        if (Number.isInteger(recordId)) {
                            sync.desiredRecordIds.add(recordId);
                        }
                    }
                    sync.removalEntries = [];
                    for (const [recordId, runtimeObj] of objectState.activeRuntimeObjectsByRecordId.entries()) {
                        if (sync.desiredRecordIds.has(recordId)) continue;
                        sync.removalEntries.push({ recordId, runtimeObj });
                    }
                    sync.loadEntries = [];
                    for (let i = 0; i < desiredRecords.length; i++) {
                        const entry = desiredRecords[i];
                        if (entry && entry.record && !Number.isInteger(Number(entry.record.id))) {
                            entry.record.id = objectState.nextRecordId++;
                        }
                        const recordId = Number(entry && entry.record && entry.record.id);
                        if (!Number.isInteger(recordId)) continue;
                        if (objectState.activeRuntimeObjectsByRecordId.has(recordId)) continue;
                        sync.loadEntries.push(entry);
                    }
                    const phaseTasks = [];
                    for (let i = 0; i < sync.removalEntries.length; i++) {
                        const removalEntry = sync.removalEntries[i];
                        phaseTasks.push(() => {
                            const removeStart = prototypeNow();
                            const recordId = Number(removalEntry && removalEntry.recordId);
                            const runtimeObj = removalEntry && removalEntry.runtimeObj;
                            if (!Number.isInteger(recordId)) return;
                            if (!runtimeObj || runtimeObj.gone) {
                                objectState.activeRuntimeObjectsByRecordId.delete(recordId);
                                return;
                            }
                            const runtimeProfileKey = getPrototypeObjectProfileKey(runtimeObj);
                            const previousSuppressClearanceUpdates = !!map._suppressClearanceUpdates;
                            map._suppressClearanceUpdates = true;
                            map._prototypeSuppressObjectDirtyTracking = true;
                            try {
                                if (runtimeObj.type === "roof") {
                                    removePrototypeRoofRuntime(runtimeObj);
                                    sync.roofRemoved += 1;
                                    bumpProfile(runtimeProfileKey, "removed", 1, 0);
                                } else if (
                                    runtimeObj.type === "road" &&
                                    globalScope.Road &&
                                    typeof globalScope.Road.collectRefreshNodesFromNode === "function"
                                ) {
                                    globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, sync.roadRefreshNodes);
                                    if (parkPrototypeRuntimeObject(runtimeObj)) {
                                        objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                                        objectState.parkedRuntimeObjectsByRecordId.set(recordId, runtimeObj);
                                        sync.parkedStored += 1;
                                        bumpProfile(runtimeProfileKey, "removed", 1, 0);
                                        sync.staticRemoved += 1;
                                    } else if (typeof runtimeObj.removeFromGame === "function") {
                                        runtimeObj._deferRoadNeighborRefresh = true;
                                        runtimeObj.removeFromGame();
                                        runtimeObj._deferRoadNeighborRefresh = false;
                                        sync.staticRemoved += 1;
                                        bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                                    } else if (typeof runtimeObj.remove === "function") {
                                        runtimeObj._deferRoadNeighborRefresh = true;
                                        runtimeObj.remove();
                                        runtimeObj._deferRoadNeighborRefresh = false;
                                        sync.staticRemoved += 1;
                                        bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                                    }
                                } else if (parkPrototypeRuntimeObject(runtimeObj)) {
                                    objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                                    objectState.parkedRuntimeObjectsByRecordId.set(recordId, runtimeObj);
                                    sync.parkedStored += 1;
                                    sync.staticRemoved += 1;
                                    bumpProfile(runtimeProfileKey, "removed", 1, 0);
                                } else if (typeof runtimeObj.removeFromGame === "function") {
                                    runtimeObj.removeFromGame();
                                    sync.staticRemoved += 1;
                                    bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                                } else if (typeof runtimeObj.remove === "function") {
                                    runtimeObj.remove();
                                    sync.staticRemoved += 1;
                                    bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                                }
                            } finally {
                                map._prototypeSuppressObjectDirtyTracking = false;
                                map._suppressClearanceUpdates = previousSuppressClearanceUpdates;
                            }
                            objectState.activeRuntimeObjectsByRecordId.delete(recordId);
                            sync.removedAny = true;
                            sync.removedCount += 1;
                            sync.unloadMs += prototypeNow() - removeStart;
                        });
                    }
                    phaseTasks.push(() => {
                        const trimStart = prototypeNow();
                        sync.parkedEvicted += trimPrototypeParkedRuntimeObjectCache(objectState);
                        sync.unloadMs += prototypeNow() - trimStart;
                    });
                    for (let i = 0; i < sync.loadEntries.length; i++) {
                        const entry = sync.loadEntries[i];
                        phaseTasks.push(() => {
                            const loadTaskStart = prototypeNow();
                            let runtimeObj = null;
                            const profileKey = getPrototypeObjectProfileKey(entry && entry.record);
                            const recordId = Number(entry && entry.record && entry.record.id);
                            const expectedSignature = buildPrototypeObjectPersistenceSignature(entry && entry.record);
                            const parkedRuntimeObj = (objectState.parkedRuntimeObjectsByRecordId instanceof Map)
                                ? objectState.parkedRuntimeObjectsByRecordId.get(recordId)
                                : null;
                            if (canReusePrototypeParkedRuntimeObject(parkedRuntimeObj, entry && entry.record && entry.record.type, expectedSignature)) {
                                runtimeObj = restorePrototypeParkedRuntimeObject(parkedRuntimeObj, map);
                                objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                                if (runtimeObj) {
                                    sync.parkedReused += 1;
                                    sync.staticLoaded += 1;
                                    bumpProfile(profileKey, "loaded", 1, 0);
                                    if (runtimeObj.type === "road" && globalScope.Road && typeof globalScope.Road.collectRefreshNodesFromNode === "function") {
                                        globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, sync.roadRefreshNodes);
                                    }
                                }
                            } else if (parkedRuntimeObj) {
                                objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                                if (evictPrototypeParkedRuntimeObject(parkedRuntimeObj)) {
                                    sync.parkedEvicted += 1;
                                }
                            }
                            const previousSuppressClearanceUpdates = !!map._suppressClearanceUpdates;
                            map._suppressClearanceUpdates = true;
                            map._prototypeSuppressObjectDirtyTracking = true;
                            try {
                                if (entry && entry.record && entry.record.type === "roof") {
                                    if (globalScope.Roof && typeof globalScope.Roof.loadJson === "function") {
                                        const roofStart = prototypeNow();
                                        runtimeObj = globalScope.Roof.loadJson(entry.record);
                                        const roofMs = prototypeNow() - roofStart;
                                        sync.roofLoadMs += roofMs;
                                        if (runtimeObj) {
                                            if (!Array.isArray(globalScope.roofs)) globalScope.roofs = [];
                                            globalScope.roofs.push(runtimeObj);
                                            globalScope.roof = runtimeObj;
                                        if (Array.isArray(map.objects) && map.objects.indexOf(runtimeObj) < 0) {
                                            map.objects.push(runtimeObj);
                                        }
                                            sync.roofLoaded += 1;
                                            bumpProfile(profileKey, "loaded", 1, roofMs);
                                        }
                                    }
                                } else if (!runtimeObj && globalScope.StaticObject && typeof globalScope.StaticObject.loadJson === "function") {
                                    const staticStart = prototypeNow();
                                    runtimeObj = globalScope.StaticObject.loadJson(entry.record, map, {
                                        deferRoadTextureRefresh: true,
                                        deferTreePostLoad: true,
                                        suppressAutoScriptingName: true,
                                        trustLoadedScriptingName: true
                                    });
                                    const staticMs = prototypeNow() - staticStart;
                                    sync.staticLoadMs += staticMs;
                                    if (runtimeObj) {
                                        sync.staticLoaded += 1;
                                        bumpProfile(profileKey, "loaded", 1, staticMs);
                                        if (runtimeObj.type === "road" && globalScope.Road && typeof globalScope.Road.collectRefreshNodesFromNode === "function") {
                                            globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, sync.roadRefreshNodes);
                                        }
                                        if (runtimeObj.type === "tree" && typeof runtimeObj.finalizeDeferredLoad === "function") {
                                            const finalizeStart = prototypeNow();
                                            runtimeObj.finalizeDeferredLoad();
                                            sync.treeFinalizeMs += prototypeNow() - finalizeStart;
                                        }
                                    }
                                }
                            } finally {
                                map._prototypeSuppressObjectDirtyTracking = false;
                                map._suppressClearanceUpdates = previousSuppressClearanceUpdates;
                            }
                            if (!runtimeObj) {
                                sync.loadMs += prototypeNow() - loadTaskStart;
                                return;
                            }
                            runtimeObj._prototypeRuntimeRecord = true;
                            runtimeObj._prototypeObjectManaged = true;
                            runtimeObj._prototypeRecordId = recordId;
                            runtimeObj._prototypePersistenceSignature = buildPrototypeObjectPersistenceSignature(entry.record);
                            runtimeObj._prototypeOwnerSectionKey = entry.sectionKey;
                            runtimeObj._prototypeDirty = false;
                            objectState.activeRuntimeObjectsByRecordId.set(recordId, runtimeObj);
                            sync.loadedAny = true;
                            sync.loadedCount += 1;
                            sync.loadMs += prototypeNow() - loadTaskStart;
                        });
                    }
                    phaseTasks.push(() => {
                        if (!(sync.roadRefreshNodes instanceof Set) || sync.roadRefreshNodes.size === 0) return;
                        const nodes = Array.from(sync.roadRefreshNodes);
                        const batchSize = 12;
                        const roadTasks = [];
                        for (let i = 0; i < nodes.length; i += batchSize) {
                            const slice = nodes.slice(i, i + batchSize);
                            roadTasks.push(() => {
                                if (!(globalScope.Road && typeof globalScope.Road.refreshTexturesAroundNodes === "function")) return;
                                const refreshStart = prototypeNow();
                                sync.roadRefreshCount += globalScope.Road.refreshTexturesAroundNodes(new Set(slice));
                                const refreshMs = prototypeNow() - refreshStart;
                                sync.roadRefreshMs += refreshMs;
                                sync.loadMs += refreshMs;
                            });
                        }
                        prependPrototypeTasks(session, roadTasks);
                        sync.roadRefreshNodes.clear();
                    });
                    phaseTasks.push(() => {
                        objectState.activeRuntimeObjects = Array.from(objectState.activeRuntimeObjectsByRecordId.values());
                        objectState.activeRecordSignature = sync.desiredSignature;
                        objectState.captureScanNeeded = !!(objectState.dirtyRuntimeObjects instanceof Set && objectState.dirtyRuntimeObjects.size > 0);
                        let treeLoadDebug = null;
                        if (sync.treeDebugStarted === true && sync.treeDebugEnabled) {
                            treeLoadDebug = globalScope.Tree.endPrototypeLoadDebugSession();
                            sync.treeDebugStarted = false;
                        }
                        if ((sync.capturedAny || sync.removedAny || sync.loadedAny) && typeof globalScope.invalidateMinimap === "function") {
                            const invalidateStart = prototypeNow();
                            globalScope.invalidateMinimap();
                            sync.invalidateMs += prototypeNow() - invalidateStart;
                        }
                        objectState.lastSyncStats = {
                            ms: Number((
                                sync.captureMs
                                + sync.collectMs
                                + sync.stalePruneMs
                                + sync.unloadMs
                                + sync.loadMs
                                + sync.invalidateMs
                            ).toFixed(2)),
                            desired: sync.desiredRecords.length,
                            loaded: sync.loadedCount,
                            removed: sync.removedCount,
                            active: objectState.activeRuntimeObjectsByRecordId.size,
                            captureMs: Number(sync.captureMs.toFixed(2)),
                            collectMs: Number(sync.collectMs.toFixed(2)),
                            stalePruneMs: Number(sync.stalePruneMs.toFixed(2)),
                            unloadMs: Number(sync.unloadMs.toFixed(2)),
                            loadMs: Number(sync.loadMs.toFixed(2)),
                            roofLoadMs: Number(sync.roofLoadMs.toFixed(2)),
                            staticLoadMs: Number(sync.staticLoadMs.toFixed(2)),
                            roofLoaded: sync.roofLoaded,
                            staticLoaded: sync.staticLoaded,
                            roofRemoved: sync.roofRemoved,
                            staticRemoved: sync.staticRemoved,
                            parkedStored: sync.parkedStored,
                            parkedReused: sync.parkedReused,
                            parkedEvicted: sync.parkedEvicted,
                            parkedActive: objectState.parkedRuntimeObjectsByRecordId instanceof Map
                                ? objectState.parkedRuntimeObjectsByRecordId.size
                                : 0,
                            roadRefreshMs: Number(sync.roadRefreshMs.toFixed(2)),
                            roadRefreshCount: sync.roadRefreshCount,
                            treeFinalizeMs: Number(sync.treeFinalizeMs.toFixed(2)),
                            treeLoadDebug: treeLoadDebug ? {
                                treeCount: Number(treeLoadDebug.treeCount) || 0,
                                constructorMs: Number((Number(treeLoadDebug.constructorMs) || 0).toFixed(2)),
                                superMs: Number((Number(treeLoadDebug.superMs) || 0).toFixed(2)),
                                superUnaccountedMs: Number((Number(treeLoadDebug.superUnaccountedMs) || 0).toFixed(2)),
                                constructorApplySizeMs: Number((Number(treeLoadDebug.constructorApplySizeMs) || 0).toFixed(2)),
                                constructorMetadataKickoffMs: Number((Number(treeLoadDebug.constructorMetadataKickoffMs) || 0).toFixed(2)),
                                loadJsonTreeCreateMs: Number((Number(treeLoadDebug.loadJsonTreeCreateMs) || 0).toFixed(2)),
                                textureRestoreMs: Number((Number(treeLoadDebug.textureRestoreMs) || 0).toFixed(2)),
                                sizeRestoreMs: Number((Number(treeLoadDebug.sizeRestoreMs) || 0).toFixed(2)),
                                applySizeMs: Number((Number(treeLoadDebug.applySizeMs) || 0).toFixed(2)),
                                refreshHitboxesMs: Number((Number(treeLoadDebug.refreshHitboxesMs) || 0).toFixed(2)),
                                refreshVisibilityMs: Number((Number(treeLoadDebug.refreshVisibilityMs) || 0).toFixed(2)),
                                finalizeTotalMs: Number((Number(treeLoadDebug.finalizeTotalMs) || 0).toFixed(2)),
                                finalizeVisibilityMs: Number((Number(treeLoadDebug.finalizeVisibilityMs) || 0).toFixed(2)),
                                finalizeMetadataKickoffMs: Number((Number(treeLoadDebug.finalizeMetadataKickoffMs) || 0).toFixed(2)),
                                metadataKickoffMs: Number((Number(treeLoadDebug.metadataKickoffMs) || 0).toFixed(2)),
                                metadataApplyMs: Number((Number(treeLoadDebug.metadataApplyMs) || 0).toFixed(2)),
                                staticCtorNodeResolveMs: Number((Number(treeLoadDebug.staticCtorNodeResolveMs) || 0).toFixed(2)),
                                staticCtorNodeAttachMs: Number((Number(treeLoadDebug.staticCtorNodeAttachMs) || 0).toFixed(2)),
                                staticCtorTexturePickMs: Number((Number(treeLoadDebug.staticCtorTexturePickMs) || 0).toFixed(2)),
                                staticCtorSpriteCreateMs: Number((Number(treeLoadDebug.staticCtorSpriteCreateMs) || 0).toFixed(2)),
                                staticCtorSpriteAttachMs: Number((Number(treeLoadDebug.staticCtorSpriteAttachMs) || 0).toFixed(2)),
                                staticCtorHitboxCreateMs: Number((Number(treeLoadDebug.staticCtorHitboxCreateMs) || 0).toFixed(2)),
                                staticCtorAutoScriptNameMs: Number((Number(treeLoadDebug.staticCtorAutoScriptNameMs) || 0).toFixed(2)),
                                visibilitySamplePointCount: Number(treeLoadDebug.visibilitySamplePointCount) || 0,
                                visibilityRegisteredNodeCount: Number(treeLoadDebug.visibilityRegisteredNodeCount) || 0
                            } : null,
                            byType: formatPrototypeObjectProfileMap(sync.profileByType),
                            captureDetail: objectState.lastCaptureStats ? { ...objectState.lastCaptureStats } : null,
                            invalidateMs: Number(sync.invalidateMs.toFixed(2))
                        };
                        session.objectsChanged = !!(sync.capturedAny || sync.removedAny || sync.loadedAny);
                    });
                    prependPrototypeTasks(session, phaseTasks);
                });
                prependPrototypeTasks(session, nextTasks);
            }]);
        };
        const enqueuePrototypeAsyncWallSync = (session) => {
            const wallState = map._prototypeWallState;
            const blockedEdgeState = map._prototypeBlockedEdgeState;
            if (!wallState || !blockedEdgeState) return;
            prependPrototypeTasks(session, [() => {
                const sync = {
                    syncStartMs: prototypeNow(),
                    captureMs: 0,
                    collectMs: 0,
                    unloadMs: 0,
                    loadJsonMs: 0,
                    addNodesMs: 0,
                    addNodesRemoveMs: 0,
                    addNodesCenterlineMs: 0,
                    addNodesDirectionalMs: 0,
                    blockedEdgeApplyMs: 0,
                    blockedEdgeRemoveMs: 0,
                    blockedEdgeAppliedLinks: 0,
                    blockedEdgeRemovedLinks: 0,
                    precomputedBlockMs: 0,
                    precomputedBlockedConnections: 0,
                    directionalTotalMs: 0,
                    directionalClearMs: 0,
                    directionalCollectMs: 0,
                    directionalBlockMs: 0,
                    directionalBlockedConnections: 0,
                    clearanceMs: 0,
                    clearanceNodeCount: 0,
                    joineryMs: 0,
                    capturedAny: false,
                    removedAny: false,
                    loadedAny: false,
                    removedCount: 0,
                    loadedCount: 0,
                    desiredRecords: [],
                    desiredRecordIds: new Set(),
                    blockedEdgesByRecordId: new Map(),
                    changedClearanceNodes: new Set()
                };
                const nextTasks = [];
                nextTasks.push(() => {
                    const captureStart = prototypeNow();
                    sync.capturedAny = !!map.capturePendingPrototypeWalls();
                    sync.captureMs += prototypeNow() - captureStart;
                });
                nextTasks.push(() => {
                    const collectStart = prototypeNow();
                    const activeSectionKeys = map.getPrototypeActiveSectionKeys();
                    sync.activeSectionKeys = activeSectionKeys;
                    if (typeof map.ensurePrototypeBlockedEdges === "function") {
                        map.ensurePrototypeBlockedEdges(activeSectionKeys);
                    }
                    const desiredRecords = [];
                    const blockedEdgesByRecordId = new Map();
                    activeSectionKeys.forEach((sectionKey) => {
                        const asset = map.getPrototypeSectionAsset(sectionKey);
                        const records = Array.isArray(asset && asset.walls) ? asset.walls : null;
                        if (Array.isArray(records)) {
                            for (let i = 0; i < records.length; i++) {
                                desiredRecords.push({ sectionKey, record: records[i] });
                            }
                        }
                        const blockedEdges = Array.isArray(asset && asset.blockedEdges) ? asset.blockedEdges : null;
                        if (Array.isArray(blockedEdges)) {
                            for (let i = 0; i < blockedEdges.length; i++) {
                                const edge = blockedEdges[i];
                                const recordId = Number(edge && edge.recordId);
                                if (!Number.isInteger(recordId)) continue;
                                if (!blockedEdgesByRecordId.has(recordId)) {
                                    blockedEdgesByRecordId.set(recordId, []);
                                }
                                blockedEdgesByRecordId.get(recordId).push(edge);
                            }
                        }
                    });
                    sync.desiredRecords = desiredRecords;
                    sync.blockedEdgesByRecordId = blockedEdgesByRecordId;
                    sync.desiredSignature = desiredRecords
                        .map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "")
                        .join("|");
                    sync.collectMs += prototypeNow() - collectStart;
                    if (!sync.capturedAny && sync.desiredSignature === wallState.activeRecordSignature) {
                        wallState.lastSyncStats = {
                            ms: Number((sync.captureMs + sync.collectMs).toFixed(2)),
                            desired: desiredRecords.length,
                            loaded: 0,
                            removed: 0,
                            active: wallState.activeRuntimeWallsByRecordId instanceof Map ? wallState.activeRuntimeWallsByRecordId.size : 0,
                            captureMs: Number(sync.captureMs.toFixed(2)),
                            collectMs: Number(sync.collectMs.toFixed(2)),
                            unloadMs: 0,
                            loadJsonMs: 0,
                            addNodesMs: 0,
                            blockedEdgeApplyMs: 0,
                            blockedEdgeRemoveMs: 0,
                            blockedEdgeAppliedLinks: 0,
                            blockedEdgeRemovedLinks: 0,
                            clearanceMs: 0,
                            clearanceNodeCount: 0,
                            addNodesRemoveMs: 0,
                            addNodesCenterlineMs: 0,
                            addNodesDirectionalMs: 0,
                            precomputedBlockMs: 0,
                            precomputedBlockedConnections: 0,
                            directionalTotalMs: 0,
                            directionalClearMs: 0,
                            directionalCollectMs: 0,
                            directionalBlockMs: 0,
                            directionalBlockedConnections: 0,
                            joineryMs: 0
                        };
                        session.wallsChanged = false;
                        return;
                    }
                    if (!(wallState.activeRuntimeWallsByRecordId instanceof Map)) {
                        wallState.activeRuntimeWallsByRecordId = new Map();
                    }
                    const staleRecordIds = [];
                    for (const [recordId, runtimeWall] of wallState.activeRuntimeWallsByRecordId.entries()) {
                        if (runtimeWall && !runtimeWall.gone) continue;
                        staleRecordIds.push(recordId);
                    }
                    for (let i = 0; i < staleRecordIds.length; i++) {
                        wallState.activeRuntimeWallsByRecordId.delete(staleRecordIds[i]);
                    }
                    sync.desiredRecordIds = new Set();
                    for (let i = 0; i < desiredRecords.length; i++) {
                        const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                        if (Number.isInteger(recordId)) {
                            sync.desiredRecordIds.add(recordId);
                        }
                    }
                    sync.removeBlockedSectionKeys = [];
                    const activeBlockedEdgeSectionKeys = new Set(blockedEdgeState.activeEntriesBySectionKey.keys());
                    activeBlockedEdgeSectionKeys.forEach((sectionKey) => {
                        if (activeSectionKeys.has(sectionKey)) return;
                        sync.removeBlockedSectionKeys.push(sectionKey);
                    });
                    sync.removeWallEntries = [];
                    for (const [recordId, runtimeWall] of wallState.activeRuntimeWallsByRecordId.entries()) {
                        if (sync.desiredRecordIds.has(recordId)) continue;
                        sync.removeWallEntries.push({ recordId, runtimeWall });
                    }
                    sync.loadWallEntries = [];
                    for (let i = 0; i < desiredRecords.length; i++) {
                        const entry = desiredRecords[i];
                        const recordId = Number(entry && entry.record && entry.record.id);
                        if (!Number.isInteger(recordId) || wallState.activeRuntimeWallsByRecordId.has(recordId)) continue;
                        sync.loadWallEntries.push(entry);
                    }
                    sync.applyBlockedSectionKeys = [];
                    activeSectionKeys.forEach((sectionKey) => {
                        if (blockedEdgeState.activeEntriesBySectionKey.has(sectionKey)) return;
                        sync.applyBlockedSectionKeys.push(sectionKey);
                    });
                    const phaseTasks = [];
                    for (let i = 0; i < sync.removeBlockedSectionKeys.length; i++) {
                        const sectionKey = sync.removeBlockedSectionKeys[i];
                        phaseTasks.push(() => {
                            const start = prototypeNow();
                            sync.blockedEdgeRemovedLinks += removePrototypeBlockedEdgesForSection(map, sectionKey, sync.changedClearanceNodes);
                            const ms = prototypeNow() - start;
                            sync.blockedEdgeRemoveMs += ms;
                            sync.unloadMs += ms;
                        });
                    }
                    for (let i = 0; i < sync.removeWallEntries.length; i++) {
                        const removalEntry = sync.removeWallEntries[i];
                        phaseTasks.push(() => {
                            const start = prototypeNow();
                            const recordId = Number(removalEntry && removalEntry.recordId);
                            const runtimeWall = removalEntry && removalEntry.runtimeWall;
                            if (!Number.isInteger(recordId)) return;
                            if (!runtimeWall || runtimeWall.gone) {
                                wallState.activeRuntimeWallsByRecordId.delete(recordId);
                                return;
                            }
                            if (runtimeWall._prototypeUsesSectionBlockedEdges === true) {
                                removePrototypeRuntimeWallVisual(runtimeWall);
                            } else if (typeof runtimeWall._removeWallPreserving === "function") {
                                runtimeWall._removeWallPreserving([], { skipAutoMerge: true });
                            } else if (typeof runtimeWall.removeFromGame === "function") {
                                runtimeWall.removeFromGame();
                            } else if (typeof runtimeWall.remove === "function") {
                                runtimeWall.remove();
                            }
                            wallState.activeRuntimeWallsByRecordId.delete(recordId);
                            sync.removedAny = true;
                            sync.removedCount += 1;
                            sync.unloadMs += prototypeNow() - start;
                        });
                    }
                    for (let i = 0; i < sync.loadWallEntries.length; i++) {
                        const entry = sync.loadWallEntries[i];
                        phaseTasks.push(() => {
                            const recordId = Number(entry && entry.record && entry.record.id);
                            if (!Number.isInteger(recordId) || wallState.activeRuntimeWallsByRecordId.has(recordId)) return;
                            const loadStart = prototypeNow();
                            const runtimeWall = globalScope.WallSectionUnit.loadJson(entry.record, map, { deferSetup: true });
                            const loadMs = prototypeNow() - loadStart;
                            sync.loadJsonMs += loadMs;
                            if (!runtimeWall) return;
                            const precomputedEdges = sync.blockedEdgesByRecordId.get(recordId) || null;
                            const usesSectionBlockedEdges = !!(precomputedEdges && precomputedEdges.length > 0);
                            if (typeof runtimeWall.addToMapNodes === "function") {
                                const addNodesStart = prototypeNow();
                                runtimeWall.addToMapNodes({ applyDirectionalBlocking: !usesSectionBlockedEdges });
                                const addNodesMs = prototypeNow() - addNodesStart;
                                sync.addNodesMs += addNodesMs;
                                const addStats = runtimeWall._lastAddToMapNodesStats || null;
                                if (addStats) {
                                    sync.addNodesRemoveMs += Number(addStats.removeMs) || 0;
                                    sync.addNodesCenterlineMs += Number(addStats.centerlineMs) || 0;
                                    sync.addNodesDirectionalMs += Number(addStats.directionalMs) || 0;
                                }
                                const directionalStats = runtimeWall._lastDirectionalBlockingStats || null;
                                if (directionalStats) {
                                    sync.directionalTotalMs += Number(directionalStats.ms) || 0;
                                    sync.directionalClearMs += Number(directionalStats.clearMs) || 0;
                                    sync.directionalCollectMs += Number(directionalStats.collectMs) || 0;
                                    sync.directionalBlockMs += Number(directionalStats.blockMs) || 0;
                                    sync.directionalBlockedConnections += Number(directionalStats.blockedConnectionCount) || 0;
                                }
                            }
                            runtimeWall._prototypeUsesSectionBlockedEdges = usesSectionBlockedEdges;
                            runtimeWall._prototypeRuntimeRecord = true;
                            runtimeWall._prototypeRecordId = recordId;
                            runtimeWall._prototypePersistenceSignature = buildPrototypeWallPersistenceSignature(entry.record);
                            runtimeWall._prototypeOwnerSectionKey = entry.sectionKey;
                            wallState.activeRuntimeWallsByRecordId.set(recordId, runtimeWall);
                            sync.loadedAny = true;
                            sync.loadedCount += 1;
                        });
                    }
                    for (let i = 0; i < sync.applyBlockedSectionKeys.length; i++) {
                        const sectionKey = sync.applyBlockedSectionKeys[i];
                        phaseTasks.push(() => {
                            const start = prototypeNow();
                            const appliedLinks = applyPrototypeBlockedEdgesForSection(map, sectionKey, sync.changedClearanceNodes);
                            const ms = prototypeNow() - start;
                            sync.blockedEdgeApplyMs += ms;
                            sync.blockedEdgeAppliedLinks += appliedLinks;
                        });
                    }
                    phaseTasks.push(() => {
                        wallState.activeRuntimeWalls = Array.from(wallState.activeRuntimeWallsByRecordId.values());
                    });
                    phaseTasks.push(() => {
                        if (
                            wallState.activeRuntimeWalls.length > 0 &&
                            globalScope.WallSectionUnit &&
                            typeof globalScope.WallSectionUnit.batchHandleJoinery === "function"
                        ) {
                            const joineryStart = prototypeNow();
                            globalScope.WallSectionUnit.batchHandleJoinery(wallState.activeRuntimeWalls);
                            sync.joineryMs += prototypeNow() - joineryStart;
                        }
                    });
                    const needsClearanceRefresh = sync.changedClearanceNodes.size > 0 || (
                        map._prototypeSectionState &&
                        Array.isArray(map._prototypeSectionState.orderedSectionAssets) &&
                        map._prototypeSectionState.orderedSectionAssets.some((asset) => asset && asset._prototypeClearanceDirty === true)
                    );
                    if (
                        needsClearanceRefresh &&
                        !map._suppressClearanceUpdates &&
                        typeof map.applyPrototypeSectionClearance === "function"
                    ) {
                        const activeKeysArray = Array.from(activeSectionKeys);
                        const clearanceChunkSize = 1200;
                        sync.clearanceNodeCount = 0;
                        for (let i = 0; i < activeKeysArray.length; i++) {
                            const sectionKey = activeKeysArray[i];
                            const sectionNodes = (map._prototypeSectionState && map._prototypeSectionState.nodesBySectionKey instanceof Map)
                                ? (map._prototypeSectionState.nodesBySectionKey.get(sectionKey) || [])
                                : [];
                            sync.clearanceNodeCount += sectionNodes.length;
                            for (let startIndex = 0; startIndex < sectionNodes.length; startIndex += clearanceChunkSize) {
                                const chunkStartIndex = startIndex;
                                phaseTasks.push(() => {
                                    const start = prototypeNow();
                                    applyPrototypeSectionClearanceChunk(map, sectionKey, chunkStartIndex, clearanceChunkSize);
                                    sync.clearanceMs += prototypeNow() - start;
                                });
                            }
                        }
                    }
                    phaseTasks.push(() => {
                        sync.precomputedBlockMs = sync.blockedEdgeApplyMs;
                        sync.precomputedBlockedConnections = sync.blockedEdgeAppliedLinks;
                        wallState.activeRuntimeWalls = Array.from(wallState.activeRuntimeWallsByRecordId.values());
                        wallState.activeRecordSignature = sync.desiredSignature;
                        if ((sync.capturedAny || sync.removedCount > 0 || sync.loadedCount > 0) && typeof globalScope.invalidateMinimap === "function") {
                            globalScope.invalidateMinimap();
                        }
                        wallState.lastSyncStats = {
                            ms: Number((
                                sync.captureMs
                                + sync.collectMs
                                + sync.unloadMs
                                + sync.loadJsonMs
                                + sync.addNodesMs
                                + sync.blockedEdgeApplyMs
                                + sync.blockedEdgeRemoveMs
                                + sync.clearanceMs
                                + sync.joineryMs
                            ).toFixed(2)),
                            desired: sync.desiredRecords.length,
                            loaded: sync.loadedCount,
                            removed: sync.removedCount,
                            active: wallState.activeRuntimeWallsByRecordId.size,
                            captureMs: Number(sync.captureMs.toFixed(2)),
                            collectMs: Number(sync.collectMs.toFixed(2)),
                            unloadMs: Number(sync.unloadMs.toFixed(2)),
                            loadJsonMs: Number(sync.loadJsonMs.toFixed(2)),
                            addNodesMs: Number(sync.addNodesMs.toFixed(2)),
                            blockedEdgeApplyMs: Number(sync.blockedEdgeApplyMs.toFixed(2)),
                            blockedEdgeRemoveMs: Number(sync.blockedEdgeRemoveMs.toFixed(2)),
                            blockedEdgeAppliedLinks: sync.blockedEdgeAppliedLinks,
                            blockedEdgeRemovedLinks: sync.blockedEdgeRemovedLinks,
                            clearanceMs: Number(sync.clearanceMs.toFixed(2)),
                            clearanceNodeCount: sync.clearanceNodeCount,
                            addNodesRemoveMs: Number(sync.addNodesRemoveMs.toFixed(2)),
                            addNodesCenterlineMs: Number(sync.addNodesCenterlineMs.toFixed(2)),
                            addNodesDirectionalMs: Number(sync.addNodesDirectionalMs.toFixed(2)),
                            precomputedBlockMs: Number(sync.precomputedBlockMs.toFixed(2)),
                            precomputedBlockedConnections: sync.precomputedBlockedConnections,
                            directionalTotalMs: Number(sync.directionalTotalMs.toFixed(2)),
                            directionalClearMs: Number(sync.directionalClearMs.toFixed(2)),
                            directionalCollectMs: Number(sync.directionalCollectMs.toFixed(2)),
                            directionalBlockMs: Number(sync.directionalBlockMs.toFixed(2)),
                            directionalBlockedConnections: sync.directionalBlockedConnections,
                            joineryMs: Number(sync.joineryMs.toFixed(2))
                        };
                        session.wallsChanged = !!(sync.capturedAny || sync.removedCount > 0 || sync.loadedCount > 0);
                    });
                    prependPrototypeTasks(session, phaseTasks);
                });
                prependPrototypeTasks(session, nextTasks);
            }]);
        };
        const enqueuePrototypeAsyncAnimalSync = (session) => {
            const animalState = map._prototypeAnimalState;
            if (!animalState) return;
            prependPrototypeTasks(session, [() => {
                const captureStart = prototypeNow();
                const capturedAny = (typeof map.capturePendingPrototypeAnimals === "function")
                    ? map.capturePendingPrototypeAnimals()
                    : false;
                const captureMs = prototypeNow() - captureStart;
                let activeTaskMs = 0;
                const activeSectionKeys = map.getPrototypeActiveSectionKeys();
                const desiredRecords = [];
                activeSectionKeys.forEach((sectionKey) => {
                    const asset = map.getPrototypeSectionAsset(sectionKey);
                    const records = Array.isArray(asset && asset.animals) ? asset.animals : null;
                    if (!Array.isArray(records)) return;
                    for (let i = 0; i < records.length; i++) {
                        desiredRecords.push({ sectionKey, record: records[i] });
                    }
                });
                const desiredSignature = desiredRecords
                    .map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "")
                    .join("|");
                if (desiredSignature === animalState.activeRecordSignature) {
                    animalState.lastSyncStats = {
                        ms: Number(captureMs.toFixed(2)),
                        desired: desiredRecords.length,
                        loaded: 0,
                        removed: 0,
                        active: animalState.activeRuntimeAnimalsByRecordId instanceof Map ? animalState.activeRuntimeAnimalsByRecordId.size : 0,
                        captureMs: Number(captureMs.toFixed(2))
                    };
                    session.animalsChanged = false;
                    return;
                }
                if (!(animalState.activeRuntimeAnimalsByRecordId instanceof Map)) {
                    animalState.activeRuntimeAnimalsByRecordId = new Map();
                }
                const desiredRecordIds = new Set();
                for (let i = 0; i < desiredRecords.length; i++) {
                    if (desiredRecords[i] && desiredRecords[i].record && !Number.isInteger(Number(desiredRecords[i].record.id))) {
                        desiredRecords[i].record.id = animalState.nextRecordId++;
                    }
                    const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                    if (Number.isInteger(recordId)) desiredRecordIds.add(recordId);
                }
                const removeTasks = [];
                let removedCount = 0;
                let loadedCount = 0;
                let removedAny = false;
                let loadedAny = false;
                for (const [recordId, runtimeAnimal] of animalState.activeRuntimeAnimalsByRecordId.entries()) {
                    if (desiredRecordIds.has(recordId)) continue;
                    removeTasks.push(() => {
                        const taskStart = prototypeNow();
                        if (runtimeAnimal && typeof runtimeAnimal.removeFromGame === "function") {
                            runtimeAnimal.removeFromGame();
                        } else if (runtimeAnimal && typeof runtimeAnimal.remove === "function") {
                            runtimeAnimal.remove();
                        } else if (runtimeAnimal) {
                            runtimeAnimal.gone = true;
                        }
                        animalState.activeRuntimeAnimalsByRecordId.delete(recordId);
                        removedAny = true;
                        removedCount += 1;
                        activeTaskMs += prototypeNow() - taskStart;
                    });
                }
                for (let i = 0; i < desiredRecords.length; i++) {
                    const entry = desiredRecords[i];
                    removeTasks.push(() => {
                        const taskStart = prototypeNow();
                        const recordId = Number(entry && entry.record && entry.record.id);
                        if (!Number.isInteger(recordId) || animalState.activeRuntimeAnimalsByRecordId.has(recordId)) return;
                        if (!globalScope.Animal || typeof globalScope.Animal.loadJson !== "function") return;
                        const runtimeAnimal = globalScope.Animal.loadJson(entry.record, map);
                        if (!runtimeAnimal) return;
                        if (Array.isArray(globalScope.animals) && globalScope.animals.indexOf(runtimeAnimal) < 0) {
                            globalScope.animals.push(runtimeAnimal);
                        }
                        runtimeAnimal._prototypeRuntimeRecord = true;
                        runtimeAnimal._prototypeRecordId = recordId;
                        runtimeAnimal._prototypeOwnerSectionKey = entry.sectionKey;
                        animalState.activeRuntimeAnimalsByRecordId.set(recordId, runtimeAnimal);
                        loadedAny = true;
                        loadedCount += 1;
                        activeTaskMs += prototypeNow() - taskStart;
                    });
                }
                removeTasks.push(() => {
                    animalState.activeRuntimeAnimals = Array.from(animalState.activeRuntimeAnimalsByRecordId.values());
                    animalState.activeRecordSignature = desiredSignature;
                    animalState.lastSyncStats = {
                        ms: Number((captureMs + activeTaskMs).toFixed(2)),
                        desired: desiredRecords.length,
                        loaded: loadedCount,
                        removed: removedCount,
                        active: animalState.activeRuntimeAnimalsByRecordId.size,
                        captureMs: Number(captureMs.toFixed(2))
                    };
                    session.animalsChanged = !!(capturedAny || removedAny || loadedAny);
                });
                prependPrototypeTasks(session, removeTasks);
            }]);
        };
        const enqueuePrototypeAsyncPowerupSync = (session) => {
            const powerupState = map._prototypePowerupState;
            if (!powerupState) return;
            prependPrototypeTasks(session, [() => {
                let activeTaskMs = 0;
                const activeSectionKeys = map.getPrototypeActiveSectionKeys();
                const desiredRecords = [];
                activeSectionKeys.forEach((sectionKey) => {
                    const asset = map.getPrototypeSectionAsset(sectionKey);
                    const records = Array.isArray(asset && asset.powerups) ? asset.powerups : null;
                    if (!Array.isArray(records)) return;
                    for (let i = 0; i < records.length; i++) {
                        desiredRecords.push({ sectionKey, record: records[i] });
                    }
                });
                const desiredSignature = desiredRecords
                    .map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "")
                    .join("|");
                if (desiredSignature === powerupState.activeRecordSignature) {
                    powerupState.lastSyncStats = {
                        ms: 0,
                        desired: desiredRecords.length,
                        loaded: 0,
                        removed: 0,
                        active: powerupState.activeRuntimePowerupsByRecordId instanceof Map ? powerupState.activeRuntimePowerupsByRecordId.size : 0
                    };
                    session.powerupsChanged = false;
                    return;
                }
                if (!(powerupState.activeRuntimePowerupsByRecordId instanceof Map)) {
                    powerupState.activeRuntimePowerupsByRecordId = new Map();
                }
                const desiredRecordIds = new Set();
                for (let i = 0; i < desiredRecords.length; i++) {
                    if (desiredRecords[i] && desiredRecords[i].record && !Number.isInteger(Number(desiredRecords[i].record.id))) {
                        desiredRecords[i].record.id = powerupState.nextRecordId++;
                    }
                    const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                    if (Number.isInteger(recordId)) desiredRecordIds.add(recordId);
                }
                const tasks = [];
                let removedCount = 0;
                let loadedCount = 0;
                let removedAny = false;
                let loadedAny = false;
                for (const [recordId, runtimePowerup] of powerupState.activeRuntimePowerupsByRecordId.entries()) {
                    if (desiredRecordIds.has(recordId)) continue;
                    tasks.push(() => {
                        const taskStart = prototypeNow();
                        if (runtimePowerup) {
                            runtimePowerup.collected = true;
                            runtimePowerup.gone = true;
                            if (runtimePowerup.pixiSprite && runtimePowerup.pixiSprite.parent) {
                                runtimePowerup.pixiSprite.parent.removeChild(runtimePowerup.pixiSprite);
                            }
                            if (Array.isArray(globalScope.powerups)) {
                                const idx = globalScope.powerups.indexOf(runtimePowerup);
                                if (idx >= 0) globalScope.powerups.splice(idx, 1);
                            }
                        }
                        powerupState.activeRuntimePowerupsByRecordId.delete(recordId);
                        removedAny = true;
                        removedCount += 1;
                        activeTaskMs += prototypeNow() - taskStart;
                    });
                }
                for (let i = 0; i < desiredRecords.length; i++) {
                    const entry = desiredRecords[i];
                    tasks.push(() => {
                        const taskStart = prototypeNow();
                        const recordId = Number(entry && entry.record && entry.record.id);
                        if (!Number.isInteger(recordId) || powerupState.activeRuntimePowerupsByRecordId.has(recordId)) return;
                        if (!globalScope.Powerup || typeof globalScope.Powerup.loadJson !== "function") return;
                        const runtimePowerup = globalScope.Powerup.loadJson(entry.record);
                        if (!runtimePowerup) return;
                        if (!Array.isArray(globalScope.powerups)) globalScope.powerups = [];
                        globalScope.powerups.push(runtimePowerup);
                        runtimePowerup._prototypeRuntimeRecord = true;
                        runtimePowerup._prototypeRecordId = recordId;
                        runtimePowerup._prototypeOwnerSectionKey = entry.sectionKey;
                        powerupState.activeRuntimePowerupsByRecordId.set(recordId, runtimePowerup);
                        loadedAny = true;
                        loadedCount += 1;
                        activeTaskMs += prototypeNow() - taskStart;
                    });
                }
                tasks.push(() => {
                    powerupState.activeRuntimePowerups = Array.from(powerupState.activeRuntimePowerupsByRecordId.values());
                    powerupState.activeRecordSignature = desiredSignature;
                    powerupState.lastSyncStats = {
                        ms: Number(activeTaskMs.toFixed(2)),
                        desired: desiredRecords.length,
                        loaded: loadedCount,
                        removed: removedCount,
                        active: powerupState.activeRuntimePowerupsByRecordId.size
                    };
                    session.powerupsChanged = !!(removedAny || loadedAny);
                });
                prependPrototypeTasks(session, tasks);
            }]);
        };
        map.updatePrototypeSectionBubble = function updatePrototypeSectionBubble(actor, options = {}) {
            const totalStart = prototypeNow();
            const previousCenterKey = this._prototypeSectionState && this._prototypeSectionState.activeCenterKey;
            const bubbleChanged = updateActiveBubbleForActor(this, actor, options);
            const layoutMs = prototypeNow() - totalStart;
            if (bubbleChanged) {
                this._prototypeBubbleShiftSession = null;
                const asyncSession = createPrototypeAsyncBubbleShiftSession(totalStart, previousCenterKey, layoutMs, options);
                enqueuePrototypeAsyncPowerupSync(asyncSession);
                enqueuePrototypeAsyncAnimalSync(asyncSession);
                enqueuePrototypeAsyncObjectSync(asyncSession);
                enqueuePrototypeAsyncWallSync(asyncSession);
                enqueuePrototypeAsyncLayoutSync(asyncSession);
                this._prototypeBubbleShiftSession = asyncSession;
            }
            if (this._prototypeBubbleShiftSession) {
                advancePrototypeAsyncBubbleShiftSession(this._prototypeBubbleShiftSession, options);
            }
            const callMs = prototypeNow() - totalStart;
            if (
                bubbleChanged &&
                this._prototypeBubbleShiftSession &&
                !(this._prototypeBubbleShiftSession.shiftFrameMs > 0)
            ) {
                this._prototypeBubbleShiftSession.shiftFrameMs = callMs;
            }
            updatePrototypeGpuDebugStats(this);
            return bubbleChanged;
        };
        initializePrototypeRuntimeState(map, prototypeState);
        const buildPrototypeWallPersistenceSignature = (wallOrRecord) => {
            if (!wallOrRecord || typeof wallOrRecord !== "object") return "";
            const data = (typeof wallOrRecord.saveJson === "function")
                ? wallOrRecord.saveJson()
                : wallOrRecord;
            if (!data || typeof data !== "object") return "";
            return JSON.stringify({
                startPoint: data.startPoint || null,
                endPoint: data.endPoint || null,
                height: Number.isFinite(data.height) ? Number(data.height) : null,
                thickness: Number.isFinite(data.thickness) ? Number(data.thickness) : null,
                bottomZ: Number.isFinite(data.bottomZ) ? Number(data.bottomZ) : null,
                wallTexturePath: (typeof data.wallTexturePath === "string") ? data.wallTexturePath : "",
                texturePhaseA: Number.isFinite(data.texturePhaseA) ? Number(data.texturePhaseA) : null,
                texturePhaseB: Number.isFinite(data.texturePhaseB) ? Number(data.texturePhaseB) : null,
                direction: Number.isFinite(data.direction) ? Number(data.direction) : null,
                lineAxis: Number.isFinite(data.lineAxis) ? Number(data.lineAxis) : null,
                visible: typeof data.visible === "boolean" ? data.visible : null,
                brightness: Number.isFinite(data.brightness) ? Number(data.brightness) : null,
                tint: Number.isFinite(data.tint) ? Number(data.tint) : null,
                script: Object.prototype.hasOwnProperty.call(data, "script") ? data.script : null,
                scriptingName: (typeof data.scriptingName === "string") ? data.scriptingName : ""
            });
        };
        const buildPrototypeObjectPersistenceSignature = (objOrRecord) => {
            if (!objOrRecord || typeof objOrRecord !== "object") return "";
            const data = (typeof objOrRecord.saveJson === "function")
                ? objOrRecord.saveJson()
                : objOrRecord;
            if (!data || typeof data !== "object") return "";
            return JSON.stringify(data);
        };
        const removePrototypeRuntimeObjectFully = (runtimeObj) => {
            if (!runtimeObj || runtimeObj.gone) return false;
            if (typeof runtimeObj.removeFromGame === "function") {
                runtimeObj.removeFromGame();
                return true;
            }
            if (typeof runtimeObj.remove === "function") {
                runtimeObj.remove();
                return true;
            }
            return false;
        };
        const parkPrototypeRuntimeObject = (runtimeObj) => {
            if (!shouldParkPrototypeRuntimeObject(runtimeObj)) return false;
            runtimeObj._prototypeParked = true;
            runtimeObj._prototypeParkedAtMs = prototypeNow();
            if (runtimeObj.type === "road") {
                runtimeObj._deferRoadNeighborRefresh = true;
            }
            if (typeof runtimeObj.removeFromNodes === "function") {
                runtimeObj.removeFromNodes();
            }
            if (runtimeObj.type === "road") {
                runtimeObj._deferRoadNeighborRefresh = false;
            }
            if (Array.isArray(runtimeObj.map && runtimeObj.map.objects)) {
                const idx = runtimeObj.map.objects.indexOf(runtimeObj);
                if (idx >= 0) runtimeObj.map.objects.splice(idx, 1);
            }
            if (runtimeObj.pixiSprite) {
                if (runtimeObj.pixiSprite.parent) {
                    runtimeObj.pixiSprite.parent.removeChild(runtimeObj.pixiSprite);
                }
                runtimeObj.pixiSprite.visible = false;
            }
            if (runtimeObj.fireSprite) {
                if (runtimeObj.fireSprite.parent) {
                    runtimeObj.fireSprite.parent.removeChild(runtimeObj.fireSprite);
                }
                runtimeObj.fireSprite.visible = false;
            }
            if (runtimeObj._healthBarGraphics) {
                runtimeObj._healthBarGraphics.visible = false;
            }
            return true;
        };
        const evictPrototypeParkedRuntimeObject = (runtimeObj) => {
            if (!runtimeObj) return false;
            runtimeObj._prototypeParked = false;
            return removePrototypeRuntimeObjectFully(runtimeObj);
        };
        const trimPrototypeParkedRuntimeObjectCache = (objectState) => {
            if (!objectState || !(objectState.parkedRuntimeObjectsByRecordId instanceof Map)) return 0;
            const countsByType = new Map();
            for (const runtimeObj of objectState.parkedRuntimeObjectsByRecordId.values()) {
                const type = (runtimeObj && typeof runtimeObj.type === "string") ? runtimeObj.type : "";
                countsByType.set(type, (countsByType.get(type) || 0) + 1);
            }
            let evicted = 0;
            for (const [recordId, runtimeObj] of objectState.parkedRuntimeObjectsByRecordId.entries()) {
                const type = (runtimeObj && typeof runtimeObj.type === "string") ? runtimeObj.type : "";
                const limit = getPrototypeParkedObjectCacheLimit(type);
                if (limit <= 0) {
                    objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                    if (evictPrototypeParkedRuntimeObject(runtimeObj)) {
                        evicted += 1;
                    }
                    continue;
                }
                const count = countsByType.get(type) || 0;
                if (count <= limit) continue;
                objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                countsByType.set(type, count - 1);
                if (evictPrototypeParkedRuntimeObject(runtimeObj)) {
                    evicted += 1;
                }
            }
            return evicted;
        };
        const restorePrototypeParkedRuntimeObject = (runtimeObj, mapRef) => {
            if (!runtimeObj || !mapRef) return null;
            runtimeObj._prototypeParked = false;
            runtimeObj._prototypeParkedAtMs = 0;
            runtimeObj.map = mapRef;
            runtimeObj.gone = false;
            runtimeObj.vanishing = false;
            if (runtimeObj.pixiSprite) {
                runtimeObj.pixiSprite.visible = true;
                if (globalScope.objectLayer && runtimeObj.pixiSprite.parent !== globalScope.objectLayer) {
                    globalScope.objectLayer.addChild(runtimeObj.pixiSprite);
                }
            }
            if (runtimeObj.fireSprite && runtimeObj.isOnFire) {
                runtimeObj.fireSprite.visible = true;
                if (globalScope.objectLayer && runtimeObj.fireSprite.parent !== globalScope.objectLayer) {
                    globalScope.objectLayer.addChild(runtimeObj.fireSprite);
                }
            }
            const node = (typeof mapRef.worldToNode === "function")
                ? mapRef.worldToNode(runtimeObj.x, runtimeObj.y)
                : null;
            if (typeof runtimeObj.refreshIndexedNodesFromHitbox === "function") {
                runtimeObj.refreshIndexedNodesFromHitbox();
            } else if (typeof runtimeObj.setIndexedNodes === "function") {
                runtimeObj.setIndexedNodes(node ? [node] : [], node || null);
            } else if (node && typeof node.addObject === "function") {
                node.addObject(runtimeObj);
                runtimeObj.node = node;
            }
            return runtimeObj;
        };
        const removePrototypeRoofRuntime = (runtimeRoof) => {
            if (!runtimeRoof) return;
            runtimeRoof.gone = true;
            if (runtimeRoof.pixiMesh) {
                try {
                    runtimeRoof.pixiMesh.destroy();
                } catch (_err) {
                    // ignore cleanup failures during prototype streaming
                }
            }
            if (runtimeRoof.map && Array.isArray(runtimeRoof.map.objects)) {
                const idx = runtimeRoof.map.objects.indexOf(runtimeRoof);
                if (idx >= 0) runtimeRoof.map.objects.splice(idx, 1);
            }
            if (Array.isArray(globalScope.roofs)) {
                const idx = globalScope.roofs.indexOf(runtimeRoof);
                if (idx >= 0) globalScope.roofs.splice(idx, 1);
                if (globalScope.roof === runtimeRoof) {
                    globalScope.roof = globalScope.roofs[globalScope.roofs.length - 1] || null;
                }
            }
        };
        const removePrototypeRecordById = (wallState, recordId) => {
            const state = map._prototypeSectionState;
            if (!wallState || !state || !(state.sectionAssetsByKey instanceof Map) || !Number.isInteger(recordId)) return false;
            let removed = false;
            for (const asset of state.sectionAssetsByKey.values()) {
                const records = Array.isArray(asset && asset.walls) ? asset.walls : [];
                if (records.length === 0) continue;
                const nextRecords = records.filter((record) => Number(record && record.id) !== recordId);
                if (nextRecords.length === records.length) continue;
                removed = true;
                asset.walls = nextRecords;
                markPrototypeBlockedEdgesDirty(asset);
                markPrototypeClearanceDirty(asset);
            }
            return removed;
        };
        const removePrototypeObjectRecordById = (objectState, recordId) => {
            const state = map._prototypeSectionState;
            if (!objectState || !state || !(state.sectionAssetsByKey instanceof Map) || !Number.isInteger(recordId)) return false;
            let removed = false;
            for (const asset of state.sectionAssetsByKey.values()) {
                const records = Array.isArray(asset && asset.objects) ? asset.objects : [];
                if (records.length === 0) continue;
                const nextRecords = records.filter((record) => Number(record && record.id) !== recordId);
                if (nextRecords.length === records.length) continue;
                removed = true;
                asset.objects = nextRecords;
                rebuildPrototypeAssetObjectNameRegistry(asset);
                markPrototypeClearanceDirty(asset);
            }
            return removed;
        };
        const isPrototypeWizardRuntimeObject = (obj) => {
            if (!obj || typeof obj !== "object") return false;
            if (obj === globalScope.wizard) return true;
            if (globalScope.Wizard && typeof globalScope.Wizard === "function" && obj instanceof globalScope.Wizard) {
                return true;
            }
            return false;
        };
        const isInvalidPrototypeObjectRecord = (record) => {
            if (!record || typeof record !== "object") return false;
            if (record.type === "human") return true;
            const hasViewport = !!(record.viewport && typeof record.viewport === "object");
            const hasWizardFields = (
                Array.isArray(record.spells) ||
                typeof record.currentSpell === "string" ||
                typeof record.gameMode === "string" ||
                typeof record.activeAura === "string" ||
                typeof record.name === "string"
            );
            return hasViewport && hasWizardFields;
        };
        const sanitizePrototypeObjectRecords = () => {
            const state = map._prototypeSectionState;
            if (!state || !(state.sectionAssetsByKey instanceof Map)) return false;
            let removedAny = false;
            for (const asset of state.sectionAssetsByKey.values()) {
                const records = Array.isArray(asset && asset.objects) ? asset.objects : null;
                if (!Array.isArray(records) || records.length === 0) continue;
                const nextRecords = records.filter((record) => !isInvalidPrototypeObjectRecord(record));
                if (nextRecords.length === records.length) continue;
                asset.objects = nextRecords;
                rebuildPrototypeAssetObjectNameRegistry(asset);
                markPrototypeClearanceDirty(asset);
                removedAny = true;
            }
            return removedAny;
        };
        const isPrototypeSavableObject = (obj) => {
            if (!obj || obj.gone || obj.vanishing) return false;
            if (typeof obj.saveJson !== "function") return false;
            if (obj.type === "wallSection") return false;
            if (isPrototypeWizardRuntimeObject(obj)) return false;
            return true;
        };
        const upsertPrototypeObjectRecord = (runtimeObj) => {
            if (!isPrototypeSavableObject(runtimeObj)) return false;
            const ownerSectionKey = map.getPrototypeSectionKeyForWorldPoint(runtimeObj.x, runtimeObj.y);
            if (!ownerSectionKey) return false;
            const asset = map.getPrototypeSectionAsset(ownerSectionKey);
            if (!asset) return false;
            const objectState = map._prototypeObjectState;
            if (!objectState) return false;
            const recordData = runtimeObj.saveJson();
            if (!recordData || typeof recordData !== "object") return false;
            if (isInvalidPrototypeObjectRecord(recordData)) return false;
            const nextSignature = buildPrototypeObjectPersistenceSignature(recordData);

            let recordId = Number(runtimeObj._prototypeRecordId);
            if (!Number.isInteger(recordId)) {
                recordId = objectState.nextRecordId++;
            }
            removePrototypeObjectRecordById(objectState, recordId);
            asset.objects.push({
                ...recordData,
                id: recordId
            });
            rebuildPrototypeAssetObjectNameRegistry(asset);
            markPrototypeClearanceDirty(asset);

            runtimeObj._prototypeObjectManaged = true;
            runtimeObj._prototypeRuntimeRecord = true;
            runtimeObj._prototypeRecordId = recordId;
            runtimeObj._prototypePersistenceSignature = nextSignature;
            runtimeObj._prototypeOwnerSectionKey = ownerSectionKey;
            runtimeObj._prototypeDirty = false;
            if (objectState.dirtyRuntimeObjects instanceof Set) {
                objectState.dirtyRuntimeObjects.delete(runtimeObj);
            }
            if (objectState.activeRuntimeObjectsByRecordId instanceof Map) {
                objectState.activeRuntimeObjectsByRecordId.set(recordId, runtimeObj);
            }
            return true;
        };
        const isPrototypeSavableAnimal = (animal) => {
            if (!animal || animal.gone || animal.vanishing || animal.dead) return false;
            if (typeof animal.saveJson !== "function") return false;
            return true;
        };
        const removePrototypeAnimalRecordById = (animalState, recordId) => {
            const state = map._prototypeSectionState;
            if (!animalState || !state || !(state.sectionAssetsByKey instanceof Map) || !Number.isInteger(recordId)) return false;
            let removed = false;
            for (const asset of state.sectionAssetsByKey.values()) {
                const records = Array.isArray(asset && asset.animals) ? asset.animals : [];
                if (records.length === 0) continue;
                const nextRecords = records.filter((record) => Number(record && record.id) !== recordId);
                if (nextRecords.length === records.length) continue;
                removed = true;
                asset.animals = nextRecords;
            }
            return removed;
        };
        const prunePrototypeAnimalRuntimeRecord = (animalState, runtimeAnimal, recordId) => {
            if (!animalState || !Number.isInteger(recordId)) return false;
            let changed = removePrototypeAnimalRecordById(animalState, recordId);
            if (animalState.activeRuntimeAnimalsByRecordId instanceof Map) {
                animalState.activeRuntimeAnimalsByRecordId.delete(recordId);
            }
            if (Array.isArray(animalState.activeRuntimeAnimals) && runtimeAnimal) {
                const activeIndex = animalState.activeRuntimeAnimals.indexOf(runtimeAnimal);
                if (activeIndex >= 0) {
                    animalState.activeRuntimeAnimals.splice(activeIndex, 1);
                }
            }
            if (runtimeAnimal && typeof runtimeAnimal === "object") {
                runtimeAnimal._prototypeRuntimeRecord = false;
                runtimeAnimal._prototypeRecordId = null;
                runtimeAnimal._prototypeOwnerSectionKey = "";
                runtimeAnimal._prototypeDirty = false;
            }
            return changed;
        };
        const upsertPrototypeAnimalRecord = (runtimeAnimal) => {
            if (!isPrototypeSavableAnimal(runtimeAnimal)) return false;
            const ownerSectionKey = map.getPrototypeSectionKeyForWorldPoint(runtimeAnimal.x, runtimeAnimal.y);
            if (!ownerSectionKey) return false;
            const asset = map.getPrototypeSectionAsset(ownerSectionKey);
            if (!asset) return false;
            const animalState = map._prototypeAnimalState;
            if (!animalState) return false;
            const recordData = runtimeAnimal.saveJson();
            if (!recordData || typeof recordData !== "object") return false;

            let recordId = Number(runtimeAnimal._prototypeRecordId);
            if (!Number.isInteger(recordId)) {
                recordId = animalState.nextRecordId++;
            }
            removePrototypeAnimalRecordById(animalState, recordId);
            asset.animals.push({
                ...recordData,
                id: recordId
            });

            runtimeAnimal._prototypeRuntimeRecord = true;
            runtimeAnimal._prototypeRecordId = recordId;
            runtimeAnimal._prototypeOwnerSectionKey = ownerSectionKey;
            runtimeAnimal._prototypeDirty = false;
            if (animalState.activeRuntimeAnimalsByRecordId instanceof Map) {
                animalState.activeRuntimeAnimalsByRecordId.set(recordId, runtimeAnimal);
            }
            if (Array.isArray(animalState.activeRuntimeAnimals)) {
                if (!animalState.activeRuntimeAnimals.includes(runtimeAnimal)) {
                    animalState.activeRuntimeAnimals.push(runtimeAnimal);
                }
            }
            return true;
        };
        map.getPrototypeSectionKeyForWorldPoint = function getPrototypeSectionKeyForWorldPoint(worldX, worldY) {
            const node = (typeof this.worldToNode === "function") ? this.worldToNode(worldX, worldY) : null;
            return node && typeof node._prototypeSectionKey === "string" ? node._prototypeSectionKey : null;
        };
        map.capturePrototypeWall = function capturePrototypeWall(wall) {
            if (!wall || wall.gone || wall._prototypeWallManaged === true) return false;
            if (typeof wall._collectOrderedLineAnchors !== "function" || typeof wall.saveJson !== "function") return false;
            const anchors = wall._collectOrderedLineAnchors();
            if (!Array.isArray(anchors) || anchors.length < 2) return false;

            const baseRecord = wall.saveJson();
            const segments = [];
            for (let i = 0; i < anchors.length - 1; i++) {
                const startEntry = anchors[i];
                const endEntry = anchors[i + 1];
                if (!startEntry || !endEntry || !startEntry.anchor || !endEntry.anchor) continue;
                const midX = (Number(startEntry.anchor.x) + Number(endEntry.anchor.x)) * 0.5;
                const midY = (Number(startEntry.anchor.y) + Number(endEntry.anchor.y)) * 0.5;
                const ownerSectionKey = this.getPrototypeSectionKeyForWorldPoint(midX, midY);
                if (!ownerSectionKey) continue;
                segments.push({
                    ownerSectionKey,
                    startAnchor: startEntry.anchor,
                    endAnchor: endEntry.anchor
                });
            }
            if (segments.length === 0) return false;

            const grouped = [];
            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];
                const last = grouped[grouped.length - 1];
                if (last && last.ownerSectionKey === segment.ownerSectionKey) {
                    last.endAnchor = segment.endAnchor;
                } else {
                    grouped.push({
                        ownerSectionKey: segment.ownerSectionKey,
                        startAnchor: segment.startAnchor,
                        endAnchor: segment.endAnchor
                    });
                }
            }

            const wallState = this._prototypeWallState;
            if (Number.isInteger(wall._prototypeRecordId)) {
                removePrototypeRecordById(wallState, Number(wall._prototypeRecordId));
            }
            for (let i = 0; i < grouped.length; i++) {
                const fragment = grouped[i];
                const asset = this.getPrototypeSectionAsset(fragment.ownerSectionKey);
                if (!asset) continue;
                const record = {
                    ...baseRecord,
                    id: wallState.nextRecordId++,
                    startPoint: globalScope.WallSectionUnit._serializeEndpoint(fragment.startAnchor),
                    endPoint: globalScope.WallSectionUnit._serializeEndpoint(fragment.endAnchor),
                    _prototypeManagedRecordId: wallState.nextRecordId
                };
                asset.walls.push(record);
                markPrototypeBlockedEdgesDirty(asset);
                markPrototypeClearanceDirty(asset);
            }

            wall._prototypeWallManaged = true;
            if (typeof wall._removeWallPreserving === "function") {
                wall._removeWallPreserving([], { skipAutoMerge: true });
            } else if (typeof wall.removeFromGame === "function") {
                wall.removeFromGame();
            } else if (typeof wall.remove === "function") {
                wall.remove();
            }
            return true;
        };
        map.capturePendingPrototypeWalls = function capturePendingPrototypeWalls() {
            const wallCtor = globalScope.WallSectionUnit;
            const wallState = this._prototypeWallState;
            if (!wallCtor || !(wallCtor._allSections instanceof Map) || !wallState) return false;
            let changed = false;
            if (wallState.activeRuntimeWallsByRecordId instanceof Map) {
                for (const [recordId, runtimeWall] of wallState.activeRuntimeWallsByRecordId.entries()) {
                    if (runtimeWall && !runtimeWall.gone && !runtimeWall.vanishing) continue;
                    if (removePrototypeRecordById(wallState, Number(recordId))) {
                        changed = true;
                    }
                }
            }
            for (const wall of wallCtor._allSections.values()) {
                if (!wall) continue;
                if (wall._prototypeRuntimeRecord === true) {
                    const currentSignature = buildPrototypeWallPersistenceSignature(wall);
                    const previousSignature = (typeof wall._prototypePersistenceSignature === "string")
                        ? wall._prototypePersistenceSignature
                        : "";
                    if (currentSignature && previousSignature && currentSignature !== previousSignature) {
                        if (this.capturePrototypeWall(wall)) {
                            changed = true;
                        }
                    }
                    continue;
                }
                if (this.capturePrototypeWall(wall)) {
                    changed = true;
                }
            }
            return changed;
        };
        map.capturePendingPrototypeObjects = function capturePendingPrototypeObjects() {
            const state = this._prototypeSectionState;
            if (!state || !(state.activeSectionKeys instanceof Set) || !(state.nodesBySectionKey instanceof Map)) return false;
            const objectState = this._prototypeObjectState;
            if (objectState && objectState.captureScanNeeded !== true) {
                return false;
            }
            let changed = false;
            let pruneGoneMs = 0;
            let dirtyListBuildMs = 0;
            let scanDirtyMs = 0;
            let saveJsonMs = 0;
            let signatureMs = 0;
            let upsertMs = 0;
            let dirtyCandidateCount = 0;
            let dirtyProcessedCount = 0;
            let dirtySkippedCount = 0;
            let goneRemovedCount = 0;
            if (objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map) {
                const pruneGoneStart = prototypeNow();
                for (const [recordId, runtimeObj] of objectState.activeRuntimeObjectsByRecordId.entries()) {
                    if (runtimeObj && !runtimeObj.gone && !runtimeObj.vanishing) continue;
                    if (removePrototypeObjectRecordById(objectState, Number(recordId))) {
                        changed = true;
                        goneRemovedCount += 1;
                    }
                }
                pruneGoneMs = prototypeNow() - pruneGoneStart;
            }
            const seen = new Set();
            const scanRuntimeObject = (obj) => {
                if (!isPrototypeSavableObject(obj) || seen.has(obj)) return;
                seen.add(obj);
                dirtyProcessedCount += 1;
                if (objectState && objectState.dirtyRuntimeObjects instanceof Set) {
                    objectState.dirtyRuntimeObjects.delete(obj);
                }
                if (obj._prototypeRuntimeRecord === true && obj._prototypeDirty !== true) {
                    dirtySkippedCount += 1;
                    return;
                }
                const saveJsonStart = prototypeNow();
                const currentSignature = buildPrototypeObjectPersistenceSignature(obj);
                saveJsonMs += prototypeNow() - saveJsonStart;
                const previousSignature = (typeof obj._prototypePersistenceSignature === "string")
                    ? obj._prototypePersistenceSignature
                    : "";
                if (!obj._prototypeRuntimeRecord || currentSignature !== previousSignature) {
                    const upsertStart = prototypeNow();
                    if (upsertPrototypeObjectRecord(obj)) {
                        changed = true;
                    }
                    upsertMs += prototypeNow() - upsertStart;
                }
            };
            if (objectState && objectState.dirtyRuntimeObjects instanceof Set && objectState.dirtyRuntimeObjects.size > 0) {
                const dirtyListBuildStart = prototypeNow();
                const dirtyObjects = Array.from(objectState.dirtyRuntimeObjects);
                dirtyListBuildMs = prototypeNow() - dirtyListBuildStart;
                dirtyCandidateCount = dirtyObjects.length;
                const scanDirtyStart = prototypeNow();
                for (let i = 0; i < dirtyObjects.length; i++) {
                    scanRuntimeObject(dirtyObjects[i]);
                }
                scanDirtyMs = prototypeNow() - scanDirtyStart;
            }
            if (objectState) {
                objectState.captureScanNeeded = false;
                objectState.lastCaptureStats = {
                    pruneGoneMs: Number(pruneGoneMs.toFixed(2)),
                    dirtyListBuildMs: Number(dirtyListBuildMs.toFixed(2)),
                    scanDirtyMs: Number(scanDirtyMs.toFixed(2)),
                    saveJsonMs: Number(saveJsonMs.toFixed(2)),
                    signatureMs: Number(signatureMs.toFixed(2)),
                    upsertMs: Number(upsertMs.toFixed(2)),
                    dirtyCandidateCount,
                    dirtyProcessedCount,
                    dirtySkippedCount,
                    goneRemovedCount
                };
            }
            return changed;
        };
        map.capturePendingPrototypeAnimals = function capturePendingPrototypeAnimals() {
            const animalState = this._prototypeAnimalState;
            if (!animalState || !(animalState.activeRuntimeAnimalsByRecordId instanceof Map)) return false;
            let changed = false;
            const candidateAnimals = [];
            const seenAnimals = new Set();
            const addCandidateAnimal = (runtimeAnimal) => {
                if (!runtimeAnimal || seenAnimals.has(runtimeAnimal)) return;
                if (runtimeAnimal.map && runtimeAnimal.map !== this) return;
                seenAnimals.add(runtimeAnimal);
                candidateAnimals.push(runtimeAnimal);
            };

            for (const runtimeAnimal of animalState.activeRuntimeAnimalsByRecordId.values()) {
                addCandidateAnimal(runtimeAnimal);
            }

            if (Array.isArray(globalScope.animals)) {
                for (let i = 0; i < globalScope.animals.length; i++) {
                    addCandidateAnimal(globalScope.animals[i]);
                }
            }

            for (const [recordId, runtimeAnimal] of Array.from(animalState.activeRuntimeAnimalsByRecordId.entries())) {
                const shouldPrune = (
                    !runtimeAnimal ||
                    runtimeAnimal.gone === true ||
                    runtimeAnimal.vanishing === true ||
                    runtimeAnimal.dead === true ||
                    (runtimeAnimal.map && runtimeAnimal.map !== this) ||
                    (Array.isArray(globalScope.animals) && globalScope.animals.indexOf(runtimeAnimal) < 0)
                );
                if (!shouldPrune) continue;
                if (prunePrototypeAnimalRuntimeRecord(animalState, runtimeAnimal, Number(recordId))) {
                    changed = true;
                }
            }

            for (let i = 0; i < candidateAnimals.length; i++) {
                const runtimeAnimal = candidateAnimals[i];
                if (!isPrototypeSavableAnimal(runtimeAnimal)) continue;
                const currentSectionKey = this.getPrototypeSectionKeyForWorldPoint(runtimeAnimal.x, runtimeAnimal.y);
                const previousSectionKey = (typeof runtimeAnimal._prototypeOwnerSectionKey === "string")
                    ? runtimeAnimal._prototypeOwnerSectionKey
                    : "";
                if (!currentSectionKey) continue;
                if (
                    currentSectionKey !== previousSectionKey ||
                    runtimeAnimal._prototypeRuntimeRecord !== true ||
                    runtimeAnimal._prototypeDirty === true
                ) {
                    if (upsertPrototypeAnimalRecord(runtimeAnimal)) {
                        changed = true;
                    }
                }
            }
            return changed;
        };
        map.syncPrototypeWalls = function syncPrototypeWalls() {
            const syncStart = prototypeNow();
            const wallState = this._prototypeWallState;
            if (!wallState) return false;
            const blockedEdgeState = ensurePrototypeBlockedEdgeState(this);
            const captureStart = prototypeNow();
            const capturedAny = this.capturePendingPrototypeWalls();
            const captureMs = prototypeNow() - captureStart;
            const collectStart = prototypeNow();
            const activeSectionKeys = this.getPrototypeActiveSectionKeys();
            if (typeof this.ensurePrototypeBlockedEdges === "function") {
                this.ensurePrototypeBlockedEdges(activeSectionKeys);
            }
            const desiredRecords = [];
            const blockedEdgesByRecordId = new Map();
            activeSectionKeys.forEach((sectionKey) => {
                const asset = this.getPrototypeSectionAsset(sectionKey);
                const records = Array.isArray(asset && asset.walls) ? asset.walls : null;
                if (!Array.isArray(records)) return;
                for (let i = 0; i < records.length; i++) {
                    desiredRecords.push({ sectionKey, record: records[i] });
                }
                const blockedEdges = Array.isArray(asset && asset.blockedEdges) ? asset.blockedEdges : null;
                if (Array.isArray(blockedEdges)) {
                    for (let i = 0; i < blockedEdges.length; i++) {
                        const edge = blockedEdges[i];
                        const recordId = Number(edge && edge.recordId);
                        if (!Number.isInteger(recordId)) continue;
                        if (!blockedEdgesByRecordId.has(recordId)) {
                            blockedEdgesByRecordId.set(recordId, []);
                        }
                        blockedEdgesByRecordId.get(recordId).push(edge);
                    }
                }
            });
            const desiredSignature = desiredRecords
                .map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "")
                .join("|");
            const collectMs = prototypeNow() - collectStart;

            if (!capturedAny && desiredSignature === wallState.activeRecordSignature) {
                wallState.lastSyncStats = {
                    ms: Number((prototypeNow() - syncStart).toFixed(2)),
                    desired: desiredRecords.length,
                    loaded: 0,
                    removed: 0,
                    active: wallState.activeRuntimeWallsByRecordId instanceof Map ? wallState.activeRuntimeWallsByRecordId.size : 0,
                    captureMs: Number(captureMs.toFixed(2)),
                    collectMs: Number(collectMs.toFixed(2)),
                    unloadMs: 0,
                    loadJsonMs: 0,
                    addNodesMs: 0,
                    blockedEdgeApplyMs: 0,
                    blockedEdgeRemoveMs: 0,
                    blockedEdgeAppliedLinks: 0,
                    blockedEdgeRemovedLinks: 0,
                    joineryMs: 0
                };
                return false;
            }

            if (!(wallState.activeRuntimeWallsByRecordId instanceof Map)) {
                wallState.activeRuntimeWallsByRecordId = new Map();
            }

            const staleRecordIds = [];
            for (const [recordId, runtimeWall] of wallState.activeRuntimeWallsByRecordId.entries()) {
                if (runtimeWall && !runtimeWall.gone) continue;
                staleRecordIds.push(recordId);
            }
            for (let i = 0; i < staleRecordIds.length; i++) {
                wallState.activeRuntimeWallsByRecordId.delete(staleRecordIds[i]);
            }

            const desiredRecordIds = new Set();
            for (let i = 0; i < desiredRecords.length; i++) {
                const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                if (Number.isInteger(recordId)) {
                    desiredRecordIds.add(recordId);
                }
            }

            const removedRuntimeWalls = [];
            const changedClearanceNodes = new Set();
            const unloadStart = prototypeNow();
            let blockedEdgeRemoveMs = 0;
            let blockedEdgeRemovedLinks = 0;
            const activeBlockedEdgeSectionKeys = new Set(blockedEdgeState.activeEntriesBySectionKey.keys());
            activeBlockedEdgeSectionKeys.forEach((sectionKey) => {
                if (activeSectionKeys.has(sectionKey)) return;
                const sectionRemoveStart = prototypeNow();
                blockedEdgeRemovedLinks += removePrototypeBlockedEdgesForSection(this, sectionKey, changedClearanceNodes);
                blockedEdgeRemoveMs += (prototypeNow() - sectionRemoveStart);
            });
            for (const [recordId, runtimeWall] of wallState.activeRuntimeWallsByRecordId.entries()) {
                if (desiredRecordIds.has(recordId)) continue;
                if (!runtimeWall || runtimeWall.gone) {
                    wallState.activeRuntimeWallsByRecordId.delete(recordId);
                    continue;
                }
                removedRuntimeWalls.push(runtimeWall);
                if (runtimeWall._prototypeUsesSectionBlockedEdges === true) {
                    removePrototypeRuntimeWallVisual(runtimeWall);
                } else if (typeof runtimeWall._removeWallPreserving === "function") {
                    runtimeWall._removeWallPreserving([], { skipAutoMerge: true });
                } else if (typeof runtimeWall.removeFromGame === "function") {
                    runtimeWall.removeFromGame();
                } else if (typeof runtimeWall.remove === "function") {
                    runtimeWall.remove();
                }
                wallState.activeRuntimeWallsByRecordId.delete(recordId);
            }
            const unloadMs = prototypeNow() - unloadStart;

            const loadedWalls = [];
            let loadJsonMs = 0;
            let addNodesMs = 0;
            let addNodesRemoveMs = 0;
            let addNodesCenterlineMs = 0;
            let addNodesDirectionalMs = 0;
            let precomputedBlockMs = 0;
            let precomputedBlockedConnections = 0;
            let directionalTotalMs = 0;
            let directionalClearMs = 0;
            let directionalCollectMs = 0;
            let directionalBlockMs = 0;
            let directionalBlockedConnections = 0;
            let blockedEdgeApplyMs = 0;
            let blockedEdgeAppliedLinks = 0;
            let clearanceMs = 0;
            let clearanceNodeCount = 0;
            for (let i = 0; i < desiredRecords.length; i++) {
                const entry = desiredRecords[i];
                const recordId = Number(entry && entry.record && entry.record.id);
                if (!Number.isInteger(recordId)) continue;
                if (wallState.activeRuntimeWallsByRecordId.has(recordId)) continue;

                const loadJsonStart = prototypeNow();
                const runtimeWall = globalScope.WallSectionUnit.loadJson(entry.record, this, { deferSetup: true });
                loadJsonMs += (prototypeNow() - loadJsonStart);
                if (!runtimeWall) continue;
                const precomputedEdges = blockedEdgesByRecordId.get(recordId) || null;
                const usesSectionBlockedEdges = !!(precomputedEdges && precomputedEdges.length > 0);
                if (typeof runtimeWall.addToMapNodes === "function") {
                    const addNodesStart = prototypeNow();
                    runtimeWall.addToMapNodes({ applyDirectionalBlocking: !usesSectionBlockedEdges });
                    addNodesMs += (prototypeNow() - addNodesStart);
                    const addStats = runtimeWall._lastAddToMapNodesStats || null;
                    if (addStats) {
                        addNodesRemoveMs += Number(addStats.removeMs) || 0;
                        addNodesCenterlineMs += Number(addStats.centerlineMs) || 0;
                        addNodesDirectionalMs += Number(addStats.directionalMs) || 0;
                    }
                    const directionalStats = runtimeWall._lastDirectionalBlockingStats || null;
                    if (directionalStats) {
                        directionalTotalMs += Number(directionalStats.ms) || 0;
                        directionalClearMs += Number(directionalStats.clearMs) || 0;
                        directionalCollectMs += Number(directionalStats.collectMs) || 0;
                        directionalBlockMs += Number(directionalStats.blockMs) || 0;
                        directionalBlockedConnections += Number(directionalStats.blockedConnectionCount) || 0;
                    }
                }
                runtimeWall._prototypeUsesSectionBlockedEdges = usesSectionBlockedEdges;
                runtimeWall._prototypeRuntimeRecord = true;
                runtimeWall._prototypeRecordId = recordId;
                runtimeWall._prototypePersistenceSignature = buildPrototypeWallPersistenceSignature(entry.record);
                runtimeWall._prototypeOwnerSectionKey = entry.sectionKey;
                wallState.activeRuntimeWallsByRecordId.set(recordId, runtimeWall);
                loadedWalls.push(runtimeWall);
            }

            activeSectionKeys.forEach((sectionKey) => {
                if (blockedEdgeState.activeEntriesBySectionKey.has(sectionKey)) return;
                const sectionApplyStart = prototypeNow();
                const appliedLinks = applyPrototypeBlockedEdgesForSection(this, sectionKey, changedClearanceNodes);
                blockedEdgeApplyMs += (prototypeNow() - sectionApplyStart);
                blockedEdgeAppliedLinks += appliedLinks;
            });
            precomputedBlockMs = blockedEdgeApplyMs;
            precomputedBlockedConnections = blockedEdgeAppliedLinks;

            wallState.activeRuntimeWalls = Array.from(wallState.activeRuntimeWallsByRecordId.values());
            wallState.activeRecordSignature = desiredSignature;

            let joineryMs = 0;
            if (
                wallState.activeRuntimeWalls.length > 0 &&
                globalScope.WallSectionUnit &&
                typeof globalScope.WallSectionUnit.batchHandleJoinery === "function"
            ) {
                const joineryStart = prototypeNow();
                globalScope.WallSectionUnit.batchHandleJoinery(wallState.activeRuntimeWalls);
                joineryMs = prototypeNow() - joineryStart;
            }

            let needsClearanceRefresh = changedClearanceNodes.size > 0;
            if (!needsClearanceRefresh && this._prototypeSectionState && Array.isArray(this._prototypeSectionState.orderedSectionAssets)) {
                for (let i = 0; i < this._prototypeSectionState.orderedSectionAssets.length; i++) {
                    const asset = this._prototypeSectionState.orderedSectionAssets[i];
                    if (asset && asset._prototypeClearanceDirty === true) {
                        needsClearanceRefresh = true;
                        break;
                    }
                }
            }

            if (
                needsClearanceRefresh &&
                !this._suppressClearanceUpdates &&
                typeof this.applyPrototypeSectionClearance === "function"
            ) {
                const clearanceStart = prototypeNow();
                clearanceNodeCount = changedClearanceNodes.size;
                this.applyPrototypeSectionClearance(activeSectionKeys);
                clearanceMs = prototypeNow() - clearanceStart;
            }

            if ((capturedAny || removedRuntimeWalls.length > 0 || loadedWalls.length > 0) && typeof globalScope.invalidateMinimap === "function") {
                globalScope.invalidateMinimap();
            }
            wallState.lastSyncStats = {
                ms: Number((prototypeNow() - syncStart).toFixed(2)),
                desired: desiredRecords.length,
                loaded: loadedWalls.length,
                removed: removedRuntimeWalls.length,
                active: wallState.activeRuntimeWallsByRecordId.size,
                captureMs: Number(captureMs.toFixed(2)),
                collectMs: Number(collectMs.toFixed(2)),
                unloadMs: Number(unloadMs.toFixed(2)),
                loadJsonMs: Number(loadJsonMs.toFixed(2)),
                addNodesMs: Number(addNodesMs.toFixed(2)),
                blockedEdgeApplyMs: Number(blockedEdgeApplyMs.toFixed(2)),
                blockedEdgeRemoveMs: Number(blockedEdgeRemoveMs.toFixed(2)),
                blockedEdgeAppliedLinks,
                blockedEdgeRemovedLinks,
                clearanceMs: Number(clearanceMs.toFixed(2)),
                clearanceNodeCount,
                addNodesRemoveMs: Number(addNodesRemoveMs.toFixed(2)),
                addNodesCenterlineMs: Number(addNodesCenterlineMs.toFixed(2)),
                addNodesDirectionalMs: Number(addNodesDirectionalMs.toFixed(2)),
                precomputedBlockMs: Number(precomputedBlockMs.toFixed(2)),
                precomputedBlockedConnections,
                directionalTotalMs: Number(directionalTotalMs.toFixed(2)),
                directionalClearMs: Number(directionalClearMs.toFixed(2)),
                directionalCollectMs: Number(directionalCollectMs.toFixed(2)),
                directionalBlockMs: Number(directionalBlockMs.toFixed(2)),
                directionalBlockedConnections,
                joineryMs: Number(joineryMs.toFixed(2))
            };
            return capturedAny || removedRuntimeWalls.length > 0 || loadedWalls.length > 0;
        };
        map.syncPrototypeObjects = function syncPrototypeObjects() {
            const syncStart = prototypeNow();
            const objectState = this._prototypeObjectState;
            if (!objectState) return false;
            const sanitizedInvalidRecords = sanitizePrototypeObjectRecords();
            const previousSuppressClearanceUpdates = !!this._suppressClearanceUpdates;
            this._suppressClearanceUpdates = true;
            this._prototypeSuppressObjectDirtyTracking = true;
            try {
                const captureStart = prototypeNow();
                const capturedAny = this.capturePendingPrototypeObjects();
                const captureMs = prototypeNow() - captureStart;
                const collectStart = prototypeNow();
                const activeSectionKeys = this.getPrototypeActiveSectionKeys();
                const desiredRecords = [];
                activeSectionKeys.forEach((sectionKey) => {
                    const asset = this.getPrototypeSectionAsset(sectionKey);
                    const records = Array.isArray(asset && asset.objects) ? asset.objects : null;
                    if (!Array.isArray(records)) return;
                    for (let i = 0; i < records.length; i++) {
                        desiredRecords.push({ sectionKey, record: records[i] });
                    }
                });
                const desiredSignature = desiredRecords
                    .map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "")
                    .join("|");
                const collectMs = prototypeNow() - collectStart;

                if (!capturedAny && !sanitizedInvalidRecords && desiredSignature === objectState.activeRecordSignature) {
                    objectState.lastSyncStats = {
                        ms: Number((prototypeNow() - syncStart).toFixed(2)),
                        desired: desiredRecords.length,
                        loaded: 0,
                        removed: 0,
                        active: objectState.activeRuntimeObjectsByRecordId instanceof Map ? objectState.activeRuntimeObjectsByRecordId.size : 0,
                        captureMs: Number(captureMs.toFixed(2)),
                        collectMs: Number(collectMs.toFixed(2)),
                        stalePruneMs: 0,
                        unloadMs: 0,
                        loadMs: 0,
                        roofLoadMs: 0,
                        staticLoadMs: 0,
                        roofLoaded: 0,
                        staticLoaded: 0,
                        roofRemoved: 0,
                        staticRemoved: 0,
                        roadRefreshMs: 0,
                        roadRefreshCount: 0,
                        invalidateMs: 0
                    };
                    return false;
                }

                if (!(objectState.activeRuntimeObjectsByRecordId instanceof Map)) {
                    objectState.activeRuntimeObjectsByRecordId = new Map();
                }

                const staleRecordIds = [];
                const stalePruneStart = prototypeNow();
                for (const [recordId, runtimeObj] of objectState.activeRuntimeObjectsByRecordId.entries()) {
                    if (runtimeObj && !runtimeObj.gone) continue;
                    staleRecordIds.push(recordId);
                }
                for (let i = 0; i < staleRecordIds.length; i++) {
                    objectState.activeRuntimeObjectsByRecordId.delete(staleRecordIds[i]);
                }
                const stalePruneMs = prototypeNow() - stalePruneStart;

                const desiredRecordIds = new Set();
                for (let i = 0; i < desiredRecords.length; i++) {
                    const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                    if (Number.isInteger(recordId)) {
                        desiredRecordIds.add(recordId);
                    }
                }

                let removedAny = false;
                let removedCount = 0;
                let roofRemoved = 0;
                let staticRemoved = 0;
                let parkedStored = 0;
                let parkedReused = 0;
                let parkedEvicted = 0;
                let roadRefreshMs = 0;
                let roadRefreshCount = 0;
                const roadRefreshNodes = new Set();
                const profileByType = new Map();
                const bumpProfile = (profileKey, field, deltaValue = 1, msValue = 0) => {
                    const key = (typeof profileKey === "string" && profileKey.length > 0) ? profileKey : "unknown";
                    if (!profileByType.has(key)) {
                        profileByType.set(key, { loaded: 0, removed: 0, ms: 0 });
                    }
                    const stats = profileByType.get(key);
                    stats[field] = (Number(stats[field]) || 0) + deltaValue;
                    stats.ms = (Number(stats.ms) || 0) + (Number(msValue) || 0);
                };
                const unloadStart = prototypeNow();
                for (const [recordId, runtimeObj] of objectState.activeRuntimeObjectsByRecordId.entries()) {
                    if (desiredRecordIds.has(recordId)) continue;
                    if (!runtimeObj || runtimeObj.gone) {
                        objectState.activeRuntimeObjectsByRecordId.delete(recordId);
                        continue;
                    }
                    const runtimeProfileKey = getPrototypeObjectProfileKey(runtimeObj);
                    if (runtimeObj.type === "roof") {
                        removePrototypeRoofRuntime(runtimeObj);
                        roofRemoved += 1;
                        bumpProfile(runtimeProfileKey, "removed", 1, 0);
                    } else if (
                        runtimeObj.type === "road" &&
                        globalScope.Road &&
                        typeof globalScope.Road.collectRefreshNodesFromNode === "function"
                    ) {
                        globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, roadRefreshNodes);
                        if (parkPrototypeRuntimeObject(runtimeObj)) {
                            objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                            objectState.parkedRuntimeObjectsByRecordId.set(recordId, runtimeObj);
                            parkedStored += 1;
                            bumpProfile(runtimeProfileKey, "removed", 1, 0);
                            staticRemoved += 1;
                        } else if (typeof runtimeObj.removeFromGame === "function") {
                            runtimeObj._deferRoadNeighborRefresh = true;
                            const removeStart = prototypeNow();
                            runtimeObj.removeFromGame();
                            runtimeObj._deferRoadNeighborRefresh = false;
                            bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                            staticRemoved += 1;
                        } else if (typeof runtimeObj.remove === "function") {
                            runtimeObj._deferRoadNeighborRefresh = true;
                            const removeStart = prototypeNow();
                            runtimeObj.remove();
                            runtimeObj._deferRoadNeighborRefresh = false;
                            bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                            staticRemoved += 1;
                        }
                    } else if (parkPrototypeRuntimeObject(runtimeObj)) {
                        objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                        objectState.parkedRuntimeObjectsByRecordId.set(recordId, runtimeObj);
                        parkedStored += 1;
                        bumpProfile(runtimeProfileKey, "removed", 1, 0);
                        staticRemoved += 1;
                    } else if (typeof runtimeObj.removeFromGame === "function") {
                        if (runtimeObj.type === "road" && globalScope.Road && typeof globalScope.Road.collectRefreshNodesFromNode === "function") {
                            globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, roadRefreshNodes);
                            runtimeObj._deferRoadNeighborRefresh = true;
                        }
                        const removeStart = prototypeNow();
                        runtimeObj.removeFromGame();
                        if (runtimeObj.type === "road") {
                            runtimeObj._deferRoadNeighborRefresh = false;
                        }
                        bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                        staticRemoved += 1;
                    } else if (typeof runtimeObj.remove === "function") {
                        if (runtimeObj.type === "road" && globalScope.Road && typeof globalScope.Road.collectRefreshNodesFromNode === "function") {
                            globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, roadRefreshNodes);
                            runtimeObj._deferRoadNeighborRefresh = true;
                        }
                        const removeStart = prototypeNow();
                        runtimeObj.remove();
                        if (runtimeObj.type === "road") {
                            runtimeObj._deferRoadNeighborRefresh = false;
                        }
                        bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                        staticRemoved += 1;
                    }
                    objectState.activeRuntimeObjectsByRecordId.delete(recordId);
                    removedAny = true;
                    removedCount += 1;
                }
                parkedEvicted += trimPrototypeParkedRuntimeObjectCache(objectState);
                const unloadMs = prototypeNow() - unloadStart;

                let loadedAny = false;
                let loadedCount = 0;
                let roofLoaded = 0;
                let staticLoaded = 0;
                let roofLoadMs = 0;
                let staticLoadMs = 0;
                let treeFinalizeMs = 0;
                let treeLoadDebug = null;
                const loadStart = prototypeNow();
                const treeDebugEnabled = !!(
                    globalScope.Tree &&
                    typeof globalScope.Tree.beginPrototypeLoadDebugSession === "function" &&
                    typeof globalScope.Tree.endPrototypeLoadDebugSession === "function"
                );
                if (treeDebugEnabled) {
                    globalScope.Tree.beginPrototypeLoadDebugSession();
                }
                const deferredTrees = [];
                for (let i = 0; i < desiredRecords.length; i++) {
                    const entry = desiredRecords[i];
                    if (entry && entry.record && !Number.isInteger(Number(entry.record.id))) {
                        entry.record.id = objectState.nextRecordId++;
                    }
                    const recordId = Number(entry && entry.record && entry.record.id);
                    if (!Number.isInteger(recordId)) continue;
                    if (objectState.activeRuntimeObjectsByRecordId.has(recordId)) continue;
                    let runtimeObj = null;
                    const profileKey = getPrototypeObjectProfileKey(entry && entry.record);
                    const expectedSignature = buildPrototypeObjectPersistenceSignature(entry && entry.record);
                    const parkedRuntimeObj = (objectState.parkedRuntimeObjectsByRecordId instanceof Map)
                        ? objectState.parkedRuntimeObjectsByRecordId.get(recordId)
                        : null;
                    if (canReusePrototypeParkedRuntimeObject(parkedRuntimeObj, entry && entry.record && entry.record.type, expectedSignature)) {
                        runtimeObj = restorePrototypeParkedRuntimeObject(parkedRuntimeObj, this);
                        objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                        if (runtimeObj) {
                            parkedReused += 1;
                            staticLoaded += 1;
                            bumpProfile(profileKey, "loaded", 1, 0);
                            if (runtimeObj.type === "road" && globalScope.Road && typeof globalScope.Road.collectRefreshNodesFromNode === "function") {
                                globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, roadRefreshNodes);
                            }
                        }
                    } else if (parkedRuntimeObj) {
                        objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                        if (evictPrototypeParkedRuntimeObject(parkedRuntimeObj)) {
                            parkedEvicted += 1;
                        }
                    }
                    if (entry && entry.record && entry.record.type === "roof") {
                        if (globalScope.Roof && typeof globalScope.Roof.loadJson === "function") {
                            const roofStart = prototypeNow();
                            runtimeObj = globalScope.Roof.loadJson(entry.record);
                            const roofMs = prototypeNow() - roofStart;
                            roofLoadMs += roofMs;
                            if (runtimeObj) {
                                if (!Array.isArray(globalScope.roofs)) globalScope.roofs = [];
                                globalScope.roofs.push(runtimeObj);
                                globalScope.roof = runtimeObj;
                                if (Array.isArray(this.objects) && this.objects.indexOf(runtimeObj) < 0) {
                                    this.objects.push(runtimeObj);
                                }
                                roofLoaded += 1;
                                bumpProfile(profileKey, "loaded", 1, roofMs);
                            }
                        }
                    } else if (!runtimeObj && globalScope.StaticObject && typeof globalScope.StaticObject.loadJson === "function") {
                        const staticStart = prototypeNow();
                        runtimeObj = globalScope.StaticObject.loadJson(entry.record, this, {
                            deferRoadTextureRefresh: true,
                            deferTreePostLoad: true,
                            suppressAutoScriptingName: true,
                            trustLoadedScriptingName: true
                        });
                        const staticMs = prototypeNow() - staticStart;
                        staticLoadMs += staticMs;
                        if (runtimeObj) {
                            staticLoaded += 1;
                            bumpProfile(profileKey, "loaded", 1, staticMs);
                            if (runtimeObj.type === "road" && globalScope.Road && typeof globalScope.Road.collectRefreshNodesFromNode === "function") {
                                globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, roadRefreshNodes);
                            }
                            if (runtimeObj.type === "tree" && typeof runtimeObj.finalizeDeferredLoad === "function") {
                                deferredTrees.push(runtimeObj);
                            }
                        }
                    }
                    if (!runtimeObj) continue;
                    runtimeObj._prototypeRuntimeRecord = true;
                    runtimeObj._prototypeObjectManaged = true;
                    runtimeObj._prototypeRecordId = recordId;
                    runtimeObj._prototypePersistenceSignature = buildPrototypeObjectPersistenceSignature(entry.record);
                    runtimeObj._prototypeOwnerSectionKey = entry.sectionKey;
                    runtimeObj._prototypeDirty = false;
                    objectState.activeRuntimeObjectsByRecordId.set(recordId, runtimeObj);
                    loadedAny = true;
                    loadedCount += 1;
                }
                if (roadRefreshNodes.size > 0 && globalScope.Road && typeof globalScope.Road.refreshTexturesAroundNodes === "function") {
                    const roadRefreshStart = prototypeNow();
                    roadRefreshCount = globalScope.Road.refreshTexturesAroundNodes(roadRefreshNodes);
                    roadRefreshMs = prototypeNow() - roadRefreshStart;
                }
                if (deferredTrees.length > 0) {
                    const treeFinalizeStart = prototypeNow();
                    for (let i = 0; i < deferredTrees.length; i++) {
                        const tree = deferredTrees[i];
                        if (tree && typeof tree.finalizeDeferredLoad === "function") {
                            tree.finalizeDeferredLoad();
                        }
                    }
                    treeFinalizeMs = prototypeNow() - treeFinalizeStart;
                }
                if (treeDebugEnabled) {
                    treeLoadDebug = globalScope.Tree.endPrototypeLoadDebugSession();
                }
                const loadMs = prototypeNow() - loadStart;

                objectState.activeRuntimeObjects = Array.from(objectState.activeRuntimeObjectsByRecordId.values());
                objectState.activeRecordSignature = desiredSignature;
                objectState.captureScanNeeded = false;

                let invalidateMs = 0;
                if ((capturedAny || removedAny || loadedAny) && typeof globalScope.invalidateMinimap === "function") {
                    const invalidateStart = prototypeNow();
                    globalScope.invalidateMinimap();
                    invalidateMs = prototypeNow() - invalidateStart;
                }
                objectState.lastSyncStats = {
                    ms: Number((prototypeNow() - syncStart).toFixed(2)),
                    desired: desiredRecords.length,
                    loaded: loadedCount,
                    removed: removedCount,
                    active: objectState.activeRuntimeObjectsByRecordId.size,
                    captureMs: Number(captureMs.toFixed(2)),
                    collectMs: Number(collectMs.toFixed(2)),
                    stalePruneMs: Number(stalePruneMs.toFixed(2)),
                    unloadMs: Number(unloadMs.toFixed(2)),
                    loadMs: Number(loadMs.toFixed(2)),
                    roofLoadMs: Number(roofLoadMs.toFixed(2)),
                    staticLoadMs: Number(staticLoadMs.toFixed(2)),
                    roofLoaded,
                    staticLoaded,
                    roofRemoved,
                    staticRemoved,
                    parkedStored,
                    parkedReused,
                    parkedEvicted,
                    parkedActive: objectState.parkedRuntimeObjectsByRecordId instanceof Map
                        ? objectState.parkedRuntimeObjectsByRecordId.size
                        : 0,
                    roadRefreshMs: Number(roadRefreshMs.toFixed(2)),
                    roadRefreshCount,
                    treeFinalizeMs: Number(treeFinalizeMs.toFixed(2)),
                    treeLoadDebug: treeLoadDebug ? {
                        treeCount: Number(treeLoadDebug.treeCount) || 0,
                        constructorMs: Number((Number(treeLoadDebug.constructorMs) || 0).toFixed(2)),
                        superMs: Number((Number(treeLoadDebug.superMs) || 0).toFixed(2)),
                        superUnaccountedMs: Number((Number(treeLoadDebug.superUnaccountedMs) || 0).toFixed(2)),
                        constructorApplySizeMs: Number((Number(treeLoadDebug.constructorApplySizeMs) || 0).toFixed(2)),
                        constructorMetadataKickoffMs: Number((Number(treeLoadDebug.constructorMetadataKickoffMs) || 0).toFixed(2)),
                        loadJsonTreeCreateMs: Number((Number(treeLoadDebug.loadJsonTreeCreateMs) || 0).toFixed(2)),
                        textureRestoreMs: Number((Number(treeLoadDebug.textureRestoreMs) || 0).toFixed(2)),
                        sizeRestoreMs: Number((Number(treeLoadDebug.sizeRestoreMs) || 0).toFixed(2)),
                        applySizeMs: Number((Number(treeLoadDebug.applySizeMs) || 0).toFixed(2)),
                        refreshHitboxesMs: Number((Number(treeLoadDebug.refreshHitboxesMs) || 0).toFixed(2)),
                        refreshVisibilityMs: Number((Number(treeLoadDebug.refreshVisibilityMs) || 0).toFixed(2)),
                        finalizeTotalMs: Number((Number(treeLoadDebug.finalizeTotalMs) || 0).toFixed(2)),
                        finalizeVisibilityMs: Number((Number(treeLoadDebug.finalizeVisibilityMs) || 0).toFixed(2)),
                        finalizeMetadataKickoffMs: Number((Number(treeLoadDebug.finalizeMetadataKickoffMs) || 0).toFixed(2)),
                        metadataKickoffMs: Number((Number(treeLoadDebug.metadataKickoffMs) || 0).toFixed(2)),
                        metadataApplyMs: Number((Number(treeLoadDebug.metadataApplyMs) || 0).toFixed(2)),
                        staticCtorNodeResolveMs: Number((Number(treeLoadDebug.staticCtorNodeResolveMs) || 0).toFixed(2)),
                        staticCtorNodeAttachMs: Number((Number(treeLoadDebug.staticCtorNodeAttachMs) || 0).toFixed(2)),
                        staticCtorTexturePickMs: Number((Number(treeLoadDebug.staticCtorTexturePickMs) || 0).toFixed(2)),
                        staticCtorSpriteCreateMs: Number((Number(treeLoadDebug.staticCtorSpriteCreateMs) || 0).toFixed(2)),
                        staticCtorSpriteAttachMs: Number((Number(treeLoadDebug.staticCtorSpriteAttachMs) || 0).toFixed(2)),
                        staticCtorHitboxCreateMs: Number((Number(treeLoadDebug.staticCtorHitboxCreateMs) || 0).toFixed(2)),
                        staticCtorAutoScriptNameMs: Number((Number(treeLoadDebug.staticCtorAutoScriptNameMs) || 0).toFixed(2)),
                        visibilitySamplePointCount: Number(treeLoadDebug.visibilitySamplePointCount) || 0,
                        visibilityRegisteredNodeCount: Number(treeLoadDebug.visibilityRegisteredNodeCount) || 0
                    } : null,
                    byType: formatPrototypeObjectProfileMap(profileByType),
                    captureDetail: objectState.lastCaptureStats ? { ...objectState.lastCaptureStats } : null,
                    invalidateMs: Number(invalidateMs.toFixed(2))
                };
                return sanitizedInvalidRecords || capturedAny || removedAny || loadedAny;
            } finally {
                this._prototypeSuppressObjectDirtyTracking = false;
                this._suppressClearanceUpdates = previousSuppressClearanceUpdates;
            }
        };
        map.syncPrototypeAnimals = function syncPrototypeAnimals() {
            const syncStart = prototypeNow();
            const animalState = this._prototypeAnimalState;
            if (!animalState) return false;
            const captureStart = prototypeNow();
            const capturedAny = (typeof this.capturePendingPrototypeAnimals === "function")
                ? this.capturePendingPrototypeAnimals()
                : false;
            const captureMs = prototypeNow() - captureStart;
            const activeSectionKeys = this.getPrototypeActiveSectionKeys();
            const desiredRecords = [];
            const desiredRecordIdsSeen = new Set();
            const desiredRecordSignaturesSeen = new Set();
            activeSectionKeys.forEach((sectionKey) => {
                const asset = this.getPrototypeSectionAsset(sectionKey);
                const records = Array.isArray(asset && asset.animals) ? asset.animals : null;
                if (!Array.isArray(records)) return;
                for (let i = 0; i < records.length; i++) {
                    const record = records[i];
                    if (!record || typeof record !== "object") continue;
                    const recordId = Number(record.id);
                    const signature = (() => {
                        const normalized = { ...record };
                        delete normalized.id;
                        return JSON.stringify(normalized);
                    })();
                    if (Number.isInteger(recordId) && desiredRecordIdsSeen.has(recordId)) continue;
                    if (signature && desiredRecordSignaturesSeen.has(signature)) continue;
                    if (Number.isInteger(recordId)) desiredRecordIdsSeen.add(recordId);
                    if (signature) desiredRecordSignaturesSeen.add(signature);
                    desiredRecords.push({ sectionKey, record });
                }
            });
            const desiredSignature = desiredRecords
                .map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "")
                .join("|");
            if (desiredSignature === animalState.activeRecordSignature) {
                animalState.lastSyncStats = {
                    ms: Number((prototypeNow() - syncStart).toFixed(2)),
                    desired: desiredRecords.length,
                    loaded: 0,
                    removed: 0,
                    active: animalState.activeRuntimeAnimalsByRecordId instanceof Map ? animalState.activeRuntimeAnimalsByRecordId.size : 0,
                    captureMs: Number(captureMs.toFixed(2))
                };
                return false;
            }
            if (!(animalState.activeRuntimeAnimalsByRecordId instanceof Map)) {
                animalState.activeRuntimeAnimalsByRecordId = new Map();
            }

            const desiredRecordIds = new Set();
            for (let i = 0; i < desiredRecords.length; i++) {
                if (desiredRecords[i] && desiredRecords[i].record && !Number.isInteger(Number(desiredRecords[i].record.id))) {
                    desiredRecords[i].record.id = animalState.nextRecordId++;
                }
                const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                if (Number.isInteger(recordId)) desiredRecordIds.add(recordId);
            }

            let removedAny = false;
            let removedCount = 0;
            for (const [recordId, runtimeAnimal] of animalState.activeRuntimeAnimalsByRecordId.entries()) {
                if (desiredRecordIds.has(recordId)) continue;
                if (runtimeAnimal && typeof runtimeAnimal.removeFromGame === "function") {
                    runtimeAnimal.removeFromGame();
                } else if (runtimeAnimal && typeof runtimeAnimal.remove === "function") {
                    runtimeAnimal.remove();
                } else if (runtimeAnimal) {
                    runtimeAnimal.gone = true;
                }
                animalState.activeRuntimeAnimalsByRecordId.delete(recordId);
                removedAny = true;
                removedCount += 1;
            }

            let loadedAny = false;
            let loadedCount = 0;
            for (let i = 0; i < desiredRecords.length; i++) {
                const entry = desiredRecords[i];
                const recordId = Number(entry && entry.record && entry.record.id);
                if (!Number.isInteger(recordId) || animalState.activeRuntimeAnimalsByRecordId.has(recordId)) continue;
                if (!globalScope.Animal || typeof globalScope.Animal.loadJson !== "function") continue;
                const runtimeAnimal = globalScope.Animal.loadJson(entry.record, this);
                if (!runtimeAnimal) continue;
                if (Array.isArray(globalScope.animals) && globalScope.animals.indexOf(runtimeAnimal) < 0) {
                    globalScope.animals.push(runtimeAnimal);
                }
                runtimeAnimal._prototypeRuntimeRecord = true;
                runtimeAnimal._prototypeRecordId = recordId;
                runtimeAnimal._prototypeOwnerSectionKey = entry.sectionKey;
                animalState.activeRuntimeAnimalsByRecordId.set(recordId, runtimeAnimal);
                loadedAny = true;
                loadedCount += 1;
            }

            animalState.activeRuntimeAnimals = Array.from(animalState.activeRuntimeAnimalsByRecordId.values());
            animalState.activeRecordSignature = desiredSignature;
            animalState.lastSyncStats = {
                ms: Number((prototypeNow() - syncStart).toFixed(2)),
                desired: desiredRecords.length,
                loaded: loadedCount,
                removed: removedCount,
                active: animalState.activeRuntimeAnimalsByRecordId.size,
                captureMs: Number(captureMs.toFixed(2))
            };
            return capturedAny || removedAny || loadedAny;
        };
        map.syncPrototypePowerups = function syncPrototypePowerups() {
            const syncStart = prototypeNow();
            const powerupState = this._prototypePowerupState;
            if (!powerupState) return false;
            const activeSectionKeys = this.getPrototypeActiveSectionKeys();
            const desiredRecords = [];
            activeSectionKeys.forEach((sectionKey) => {
                const asset = this.getPrototypeSectionAsset(sectionKey);
                const records = Array.isArray(asset && asset.powerups) ? asset.powerups : null;
                if (!Array.isArray(records)) return;
                for (let i = 0; i < records.length; i++) {
                    desiredRecords.push({ sectionKey, record: records[i] });
                }
            });
            const desiredSignature = desiredRecords
                .map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "")
                .join("|");
            if (desiredSignature === powerupState.activeRecordSignature) {
                return false;
            }
            if (!(powerupState.activeRuntimePowerupsByRecordId instanceof Map)) {
                powerupState.activeRuntimePowerupsByRecordId = new Map();
            }

            const desiredRecordIds = new Set();
            for (let i = 0; i < desiredRecords.length; i++) {
                if (desiredRecords[i] && desiredRecords[i].record && !Number.isInteger(Number(desiredRecords[i].record.id))) {
                    desiredRecords[i].record.id = powerupState.nextRecordId++;
                }
                const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                if (Number.isInteger(recordId)) desiredRecordIds.add(recordId);
            }

            let removedAny = false;
            let removedCount = 0;
            for (const [recordId, runtimePowerup] of powerupState.activeRuntimePowerupsByRecordId.entries()) {
                if (desiredRecordIds.has(recordId)) continue;
                if (runtimePowerup) {
                    runtimePowerup.collected = true;
                    runtimePowerup.gone = true;
                    if (runtimePowerup.pixiSprite && runtimePowerup.pixiSprite.parent) {
                        runtimePowerup.pixiSprite.parent.removeChild(runtimePowerup.pixiSprite);
                    }
                    if (Array.isArray(globalScope.powerups)) {
                        const idx = globalScope.powerups.indexOf(runtimePowerup);
                        if (idx >= 0) globalScope.powerups.splice(idx, 1);
                    }
                }
                powerupState.activeRuntimePowerupsByRecordId.delete(recordId);
                removedAny = true;
                removedCount += 1;
            }

            let loadedAny = false;
            let loadedCount = 0;
            for (let i = 0; i < desiredRecords.length; i++) {
                const entry = desiredRecords[i];
                const recordId = Number(entry && entry.record && entry.record.id);
                if (!Number.isInteger(recordId) || powerupState.activeRuntimePowerupsByRecordId.has(recordId)) continue;
                if (!globalScope.Powerup || typeof globalScope.Powerup.loadJson !== "function") continue;
                const runtimePowerup = globalScope.Powerup.loadJson(entry.record);
                if (!runtimePowerup) continue;
                if (!Array.isArray(globalScope.powerups)) globalScope.powerups = [];
                globalScope.powerups.push(runtimePowerup);
                runtimePowerup._prototypeRuntimeRecord = true;
                runtimePowerup._prototypeRecordId = recordId;
                runtimePowerup._prototypeOwnerSectionKey = entry.sectionKey;
                powerupState.activeRuntimePowerupsByRecordId.set(recordId, runtimePowerup);
                loadedAny = true;
                loadedCount += 1;
            }

            powerupState.activeRuntimePowerups = Array.from(powerupState.activeRuntimePowerupsByRecordId.values());
            powerupState.activeRecordSignature = desiredSignature;
            powerupState.lastSyncStats = {
                ms: Number((prototypeNow() - syncStart).toFixed(2)),
                desired: desiredRecords.length,
                loaded: loadedCount,
                removed: removedCount,
                active: powerupState.activeRuntimePowerupsByRecordId.size
            };
            return removedAny || loadedAny;
        };
    }

    async function markPrototypeWorld(map) {
        const config = getPrototypeConfig();
        const textureCount = getPrototypeGroundTextureCount(map);
        let sectionStateSource = null;
        if (config.sectionAssetUrl) {
            let assetBundle = await loadPrototypeSectionAssetBundle(config.sectionAssetUrl);
            if (!assetBundle && config.fallbackSectionAssetUrl) {
                assetBundle = await loadPrototypeSectionAssetBundle(config.fallbackSectionAssetUrl);
            }
            if (assetBundle) {
                sectionStateSource = buildSectionStateFromAssetBundle(assetBundle, config, map);
            }
        } else {
            const sectionRecords = buildSectionRecords(config, map);
            const sectionAssets = buildPrototypeSectionAssets(sectionRecords, config.sectionRadius);
            for (let i = 0; i < sectionAssets.orderedSectionAssets.length; i++) {
                const asset = sectionAssets.orderedSectionAssets[i];
                if (!asset) continue;
                asset.groundTiles = normalizePrototypeGroundTiles(asset.groundTiles, asset.tileCoordKeys, textureCount);
            }
            sectionStateSource = {
                radius: config.sectionRadius,
                sectionGraphRadius: config.sectionGraphRadius,
                basis: sectionRecords.basis,
                sectionCoords: sectionRecords.sectionCoords,
                sectionsByKey: sectionRecords.sectionsByKey,
                orderedSections: sectionRecords.orderedSections,
                sectionAssetsByKey: sectionAssets.sectionAssetsByKey,
                orderedSectionAssets: sectionAssets.orderedSectionAssets,
                anchorCenter: sectionRecords.anchorCenter
            };
        }
        if (!sectionStateSource) {
            const sectionRecords = buildSectionRecords(config, map);
            const sectionAssets = buildPrototypeSectionAssets(sectionRecords, config.sectionRadius);
            for (let i = 0; i < sectionAssets.orderedSectionAssets.length; i++) {
                const asset = sectionAssets.orderedSectionAssets[i];
                if (!asset) continue;
                asset.groundTiles = normalizePrototypeGroundTiles(asset.groundTiles, asset.tileCoordKeys, textureCount);
            }
            sectionStateSource = {
                radius: config.sectionRadius,
                sectionGraphRadius: config.sectionGraphRadius,
                basis: sectionRecords.basis,
                sectionCoords: sectionRecords.sectionCoords,
                sectionsByKey: sectionRecords.sectionsByKey,
                orderedSections: sectionRecords.orderedSections,
                sectionAssetsByKey: sectionAssets.sectionAssetsByKey,
                orderedSectionAssets: sectionAssets.orderedSectionAssets,
                anchorCenter: sectionRecords.anchorCenter
            };
        }
        const manifest = getPrototypeManifest(sectionStateSource);
        const initialCenterKey = (typeof manifest.activeCenterKey === "string" && manifest.activeCenterKey.length > 0)
            ? manifest.activeCenterKey
            : makeSectionKey({ q: 0, r: 0 });
        const prototypeState = createPrototypeState(sectionStateSource, initialCenterKey);

        assignNodesToSections(map, prototypeState);
        attachPrototypeApis(map, prototypeState);
        ensurePrototypeBlockedEdges(map);
        setActiveCenter(map, prototypeState.activeCenterKey);
        map.syncPrototypeWalls();
        map.syncPrototypeObjects();
        if (typeof map.syncPrototypeAnimals === "function") {
            map.syncPrototypeAnimals();
        }
        if (typeof map.syncPrototypePowerups === "function") {
            map.syncPrototypePowerups();
        }

        if (manifest.wizard && typeof manifest.wizard === "object") {
            globalScope.RUNAROUND_PROTOTYPE_WIZARD_STATE = JSON.parse(JSON.stringify(manifest.wizard));
        } else {
            globalScope.RUNAROUND_PROTOTYPE_WIZARD_STATE = null;
        }

        const savedMazeMode = (
            manifest &&
            manifest.los &&
            typeof manifest.los === "object" &&
            typeof manifest.los.mazeMode === "boolean"
        ) ? manifest.los.mazeMode : null;
        if (typeof globalScope.applySavedLosMazeModeValue === "function") {
            globalScope.applySavedLosMazeModeValue(savedMazeMode);
        }

        if (manifest.wizard && Number.isFinite(manifest.wizard.x) && Number.isFinite(manifest.wizard.y)) {
            globalScope.RUNAROUND_PROTOTYPE_SPAWN = {
                x: Number(manifest.wizard.x),
                y: Number(manifest.wizard.y)
            };
        } else {
            const spawn = axialToEvenQOffset(sectionStateSource.anchorCenter);
            globalScope.RUNAROUND_PROTOTYPE_SPAWN = { x: spawn.x, y: spawn.y };
        }
    }

    function finishPrototypeSetup(map) {
        if (!map) return;
        map._suppressClearanceUpdates = false;
        if (typeof map.applyPrototypeSectionClearance === "function") {
            map.applyPrototypeSectionClearance();
        } else if (typeof map.computeClearance === "function") {
            map.computeClearance();
        }
        if (typeof map.rebuildGameObjectRegistry === "function") {
            map.rebuildGameObjectRegistry();
        }
        if (typeof globalScope.invalidateMinimap === "function") {
            globalScope.invalidateMinimap();
        }
    }

    globalScope.buildTwoSectionPrototypeWorld = async function buildTwoSectionPrototypeWorld(map) {
        if (!map) return null;
        clearMapForPrototype(map);
        await markPrototypeWorld(map);
        finishPrototypeSetup(map);
        return map._twoSectionPrototype || null;
    };
    globalScope.__twoSectionPrototypeTestHooks = {
        attachPrototypeApis,
        canReusePrototypeParkedRuntimeObject,
        createPrototypeState,
        getPrototypeParkedObjectCacheLimit,
        initializePrototypeRuntimeState,
        shouldParkPrototypeRuntimeObject
    };
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__twoSectionPrototypeTestHooks;
}
