(function (globalScope) {
    "use strict";

    function createSectionWorldAssetHelpers(deps) {
        const {
            hashCoordinatePair,
            hashToUnitFloat,
            offsetToWorld
        } = deps;

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

        function comparePrototypeTileCoordKeys(a, b) {
            const [axRaw, ayRaw] = String(a || "").split(",");
            const [bxRaw, byRaw] = String(b || "").split(",");
            const ax = Number(axRaw) || 0;
            const ay = Number(ayRaw) || 0;
            const bx = Number(bxRaw) || 0;
            const by = Number(byRaw) || 0;
            if (ay !== by) return ay - by;
            return ax - bx;
        }

        function sortPrototypeTileCoordKeys(tileCoordKeys) {
            if (!Array.isArray(tileCoordKeys)) return [];
            return tileCoordKeys.slice().sort(comparePrototypeTileCoordKeys);
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

        function clonePrototypePointList(points) {
            if (!Array.isArray(points)) return [];
            const cloned = [];
            for (let i = 0; i < points.length; i++) {
                const point = points[i];
                if (!point || typeof point !== "object") continue;
                cloned.push({
                    x: Number(point.x) || 0,
                    y: Number(point.y) || 0
                });
            }
            return cloned;
        }

        function clonePrototypePolygonList(polygons) {
            if (!Array.isArray(polygons)) return [];
            const cloned = [];
            for (let i = 0; i < polygons.length; i++) {
                const polygon = clonePrototypePointList(polygons[i]);
                if (polygon.length > 0) cloned.push(polygon);
            }
            return cloned;
        }

        function clonePrototypeFloorRecords(rawRecords, ownerSectionKey) {
            if (!Array.isArray(rawRecords)) return [];
            const sectionKey = (typeof ownerSectionKey === "string") ? ownerSectionKey : "";
            const cloned = [];
            for (let i = 0; i < rawRecords.length; i++) {
                const record = rawRecords[i];
                if (!record || typeof record !== "object") continue;
                const fragmentId = (typeof record.fragmentId === "string" && record.fragmentId.length > 0)
                    ? record.fragmentId
                    : ((typeof record.id === "string" && record.id.length > 0)
                        ? record.id
                        : `section:${sectionKey}:floor:${i}`);
                cloned.push({
                    ...record,
                    fragmentId,
                    surfaceId: (typeof record.surfaceId === "string" && record.surfaceId.length > 0)
                        ? record.surfaceId
                        : fragmentId,
                    ownerSectionKey: (typeof record.ownerSectionKey === "string" && record.ownerSectionKey.length > 0)
                        ? record.ownerSectionKey
                        : sectionKey,
                    level: Number.isFinite(record.level) ? Number(record.level) : 0,
                    nodeBaseZ: Number.isFinite(record.nodeBaseZ) ? Number(record.nodeBaseZ) : 0,
                    outerPolygon: clonePrototypePointList(record.outerPolygon),
                    holes: clonePrototypePolygonList(record.holes),
                    visibilityPolygon: Array.isArray(record.visibilityPolygon) && record.visibilityPolygon.length > 0
                        ? clonePrototypePointList(record.visibilityPolygon)
                        : clonePrototypePointList(record.outerPolygon),
                    visibilityHoles: Array.isArray(record.visibilityHoles)
                        ? clonePrototypePolygonList(record.visibilityHoles)
                        : clonePrototypePolygonList(record.holes),
                    tileCoordKeys: sortPrototypeTileCoordKeys(record.tileCoordKeys)
                });
            }
            return cloned;
        }

        function clonePrototypeFloorTransitions(rawTransitions) {
            if (!Array.isArray(rawTransitions)) return [];
            const cloned = [];
            for (let i = 0; i < rawTransitions.length; i++) {
                const transition = rawTransitions[i];
                if (!transition || typeof transition !== "object") continue;
                cloned.push({
                    ...transition,
                    from: (transition.from && typeof transition.from === "object") ? { ...transition.from } : {},
                    to: (transition.to && typeof transition.to === "object") ? { ...transition.to } : {},
                    metadata: (transition.metadata && typeof transition.metadata === "object") ? { ...transition.metadata } : {}
                });
            }
            return cloned;
        }

        function createPrototypeImplicitGroundFloorFragment(asset) {
            if (!asset || typeof asset !== "object") return null;
            return {
                fragmentId: `section:${asset.key}:ground`,
                surfaceId: "overworld_ground_surface",
                ownerSectionKey: asset.key,
                level: 0,
                nodeBaseZ: 0,
                tileCoordKeys: Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys.slice() : [],
                outerPolygon: [],
                holes: [],
                visibilityPolygon: [],
                visibilityHoles: [],
                _prototypeSynthesizedGround: true
            };
        }

        function applyRawPrototypeSectionAssetToStateAsset(asset, rawAsset, map) {
            if (!asset || !rawAsset || typeof rawAsset !== "object") return false;
            const textureCount = getPrototypeGroundTextureCount(map);
            asset.id = (typeof rawAsset.id === "string" && rawAsset.id.length > 0) ? rawAsset.id : asset.id;
            asset.coord = rawAsset.coord && typeof rawAsset.coord === "object"
                ? { q: Number(rawAsset.coord.q) || 0, r: Number(rawAsset.coord.r) || 0 }
                : asset.coord;
            asset.centerAxial = rawAsset.centerAxial && typeof rawAsset.centerAxial === "object"
                ? { q: Number(rawAsset.centerAxial.q) || 0, r: Number(rawAsset.centerAxial.r) || 0 }
                : asset.centerAxial;
            asset.centerOffset = rawAsset.centerOffset && typeof rawAsset.centerOffset === "object"
                ? { x: Number(rawAsset.centerOffset.x) || 0, y: Number(rawAsset.centerOffset.y) || 0 }
                : asset.centerOffset;
            asset.centerWorld = offsetToWorld(asset.centerOffset);
            asset.neighborKeys = Array.isArray(rawAsset.neighborKeys) ? rawAsset.neighborKeys.slice() : asset.neighborKeys;
            asset.tileCoordKeys = Array.isArray(rawAsset.tileCoordKeys)
                ? sortPrototypeTileCoordKeys(rawAsset.tileCoordKeys)
                : sortPrototypeTileCoordKeys(asset.tileCoordKeys);
            asset.groundTextureId = Number.isFinite(rawAsset.groundTextureId) ? Number(rawAsset.groundTextureId) : asset.groundTextureId;
            asset.groundTiles = normalizePrototypeGroundTiles(rawAsset.groundTiles, asset.tileCoordKeys, textureCount);
            asset.floors = clonePrototypeFloorRecords(rawAsset.floors, asset.key);
            asset.walls = Array.isArray(rawAsset.walls) ? rawAsset.walls.map((wall) => ({ ...wall })) : [];
            asset.blockedEdges = clonePrototypeBlockedEdges(rawAsset.blockedEdges);
            asset.clearanceByTile = clonePrototypeClearanceByTile(rawAsset.clearanceByTile);
            asset.objects = Array.isArray(rawAsset.objects) ? rawAsset.objects.map((obj) => ({ ...obj })) : [];
            asset.animals = Array.isArray(rawAsset.animals) ? rawAsset.animals.map((animal) => ({ ...animal })) : [];
            asset.powerups = Array.isArray(rawAsset.powerups) ? rawAsset.powerups.map((powerup) => ({ ...powerup })) : [];
            asset._prototypeBlockedEdgesDirty = !Array.isArray(rawAsset.blockedEdges)
                || (asset.blockedEdges.length === 0 && asset.walls.length > 0);
            asset._prototypeClearanceDirty = Object.keys(asset.clearanceByTile).length !== asset.tileCoordKeys.length;
            asset._prototypeSectionHydrated = true;
            asset._prototypeNamedObjectRecordIdByName = new Map();
            asset._prototypeNamedObjectConflictRecordIdsByName = new Map();
            return true;
        }

        return {
            applyRawPrototypeSectionAssetToStateAsset,
            clonePrototypeBlockedEdges,
            clonePrototypeClearanceByTile,
            clonePrototypeFloorRecords,
            clonePrototypeFloorTransitions,
            createPrototypeImplicitGroundFloorFragment,
            comparePrototypeTileCoordKeys,
            getPrototypeGroundTextureCount,
            normalizePrototypeGroundTiles,
            pickPrototypeGroundTextureId,
            sortPrototypeTileCoordKeys
        };
    }

    globalScope.__sectionWorldAssets = {
        createSectionWorldAssetHelpers,
        createPrototypeAssetHelpers: createSectionWorldAssetHelpers
    };
    globalScope.__twoSectionPrototypeAssets = globalScope.__sectionWorldAssets;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldAssets;
}
