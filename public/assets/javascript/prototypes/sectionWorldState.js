(function (globalScope) {
    "use strict";

    function createSectionWorldStateHelpers(deps) {
        const {
            SECTION_DIRECTIONS,
            addSectionCoords,
            axialDistance,
            axialToEvenQOffset,
            clonePrototypeFloorTransitions,
            computeSectionCenterAxial,
            evenQOffsetToAxial,
            getSectionBasisVectors,
            getSectionCoordsInRingRange,
            makeSectionKey,
            normalizePrototypeGroundTiles,
            getPrototypeGroundTextureCount,
            offsetToWorld
        } = deps;

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

        function buildSectionRecordsFromCoords(sectionCoords, radius, anchorCenter) {
            const normalizedCoords = Array.isArray(sectionCoords) ? sectionCoords : [];
            const basis = getSectionBasisVectors(radius);
            const sectionsByKey = new Map();
            const orderedSections = [];
            const orderedCoords = [];
            const seenKeys = new Set();
            const resolvedAnchorCenter = (anchorCenter && typeof anchorCenter === "object")
                ? { q: Number(anchorCenter.q) || 0, r: Number(anchorCenter.r) || 0 }
                : { q: 0, r: 0 };

            for (let i = 0; i < normalizedCoords.length; i++) {
                const rawCoord = normalizedCoords[i];
                if (!rawCoord || typeof rawCoord !== "object") continue;
                const coord = {
                    q: Number(rawCoord.q) || 0,
                    r: Number(rawCoord.r) || 0
                };
                const key = makeSectionKey(coord);
                if (seenKeys.has(key)) continue;
                seenKeys.add(key);
                orderedCoords.push(coord);
                const centerAxial = computeSectionCenterAxial(coord, basis, resolvedAnchorCenter);
                const centerOffset = axialToEvenQOffset(centerAxial);
                const section = {
                    key,
                    coord,
                    centerAxial,
                    centerOffset,
                    centerWorld: offsetToWorld(centerOffset)
                };
                orderedSections.push(section);
                sectionsByKey.set(section.key, section);
            }

            return {
                basis,
                sectionCoords: orderedCoords,
                sectionsByKey,
                orderedSections,
                anchorCenter: resolvedAnchorCenter
            };
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
                    floors: [],
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
                asset._prototypeSectionHydrated = false;
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
                floors: [],
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
            asset._prototypeSectionHydrated = false;
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
                        wallCount: Array.isArray(asset.walls) ? asset.walls.length : 0,
                        floorCount: Array.isArray(asset.floors) ? asset.floors.length : 0
                    }))
                    : [],
                floorTransitionCount: Array.isArray(state.floorTransitions) ? state.floorTransitions.length : 0
            };
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
                floorTransitions: Array.isArray(sectionStateSource.floorTransitions)
                    ? sectionStateSource.floorTransitions.map((transition) => ({
                        ...transition,
                        from: (transition.from && typeof transition.from === "object") ? { ...transition.from } : {},
                        to: (transition.to && typeof transition.to === "object") ? { ...transition.to } : {},
                        metadata: (transition.metadata && typeof transition.metadata === "object") ? { ...transition.metadata } : {}
                    }))
                    : [],
                triggerDefinitions: Array.isArray(sectionStateSource.triggerDefinitions)
                    ? sectionStateSource.triggerDefinitions.map((record) => ({
                        ...record,
                        bounds: (record.bounds && typeof record.bounds === "object") ? { ...record.bounds } : null,
                        points: Array.isArray(record.points)
                            ? record.points.map((point) => ({
                                x: Number(point && point.x) || 0,
                                y: Number(point && point.y) || 0
                            }))
                            : [],
                        coverageSectionKeys: Array.isArray(record.coverageSectionKeys)
                            ? record.coverageSectionKeys.slice()
                            : []
                    }))
                    : [],
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
                allNodesByCoordKey: new Map(),
                loadedSectionAssetKeys: sectionStateSource.loadedSectionAssetKeys instanceof Set
                    ? new Set(sectionStateSource.loadedSectionAssetKeys)
                    : new Set(),
                sectionAssetLoader: typeof sectionStateSource.sectionAssetLoader === "function"
                    ? sectionStateSource.sectionAssetLoader
                    : null,
                pendingSectionHydrations: sectionStateSource.pendingSectionHydrations instanceof Map
                    ? new Map(sectionStateSource.pendingSectionHydrations)
                    : new Map()
            };
        }

        function getPrototypeManifest(sectionStateSource) {
            return (sectionStateSource && sectionStateSource.manifest && typeof sectionStateSource.manifest === "object")
                ? sectionStateSource.manifest
                : {};
        }

        return {
            buildPrototypeSectionAssets,
            buildPrototypeSummary,
            buildSectionRecords,
            buildSectionRecordsFromCoords,
            createPrototypeSectionAsset,
            createPrototypeState,
            getPrototypeManifest
        };
    }

    globalScope.__sectionWorldState = {
        createSectionWorldStateHelpers,
        createPrototypeStateHelpers: createSectionWorldStateHelpers
    };
    globalScope.__twoSectionPrototypeState = globalScope.__sectionWorldState;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldState;
}
