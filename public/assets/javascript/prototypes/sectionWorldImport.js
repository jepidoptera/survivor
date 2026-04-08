(function (globalScope) {
    "use strict";

    function createSectionWorldImportHelpers(deps) {
        const {
            applyRawPrototypeSectionAssetToStateAsset,
            axialToEvenQOffset,
            buildPrototypeSectionAssets,
            buildSectionRecordsFromCoords,
            clonePrototypeBlockedEdges,
            clonePrototypeFloorTransitions,
            clonePrototypeTriggerRecord,
            collectUsedPrototypeObjectRecordIds,
            evenQOffsetToAxial,
            getPrototypeGroundTextureCount,
            getSectionBasisVectors,
            isPrototypeTriggerRecord,
            makeSectionKey,
            normalizePrototypeGroundTiles,
            normalizePrototypeTriggerDefinitions,
            offsetToWorld
        } = deps;

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
            const resolvedRadius = Number.isFinite(assetBundle && assetBundle.radius)
                ? Math.max(3, Math.floor(Number(assetBundle.radius)))
                : fallbackConfig.sectionRadius;
            const basis = getSectionBasisVectors(resolvedRadius);
            const rawSections = Array.isArray(assetBundle && assetBundle.sections)
                ? assetBundle.sections
                : (Array.isArray(assetBundle) ? assetBundle : []);
            const explicitTriggerRecords = Array.isArray(assetBundle && assetBundle.triggers)
                ? assetBundle.triggers
                : [];
            const legacyTriggerRecords = [];
            const rawSectionCoords = Array.isArray(assetBundle && assetBundle.sectionCoords)
                ? assetBundle.sectionCoords
                : [];
            let anchorCenter = assetBundle && assetBundle.anchorCenter && typeof assetBundle.anchorCenter === "object"
                ? {
                    q: Number(assetBundle.anchorCenter.q) || 0,
                    r: Number(assetBundle.anchorCenter.r) || 0
                }
                : null;
            if (!anchorCenter && rawSections.length > 0) {
                const referenceSection = rawSections[0];
                const coord = referenceSection && referenceSection.coord && typeof referenceSection.coord === "object"
                    ? { q: Number(referenceSection.coord.q) || 0, r: Number(referenceSection.coord.r) || 0 }
                    : { q: 0, r: 0 };
                const centerAxial = referenceSection && referenceSection.centerAxial && typeof referenceSection.centerAxial === "object"
                    ? { q: Number(referenceSection.centerAxial.q) || 0, r: Number(referenceSection.centerAxial.r) || 0 }
                    : null;
                if (centerAxial) {
                    anchorCenter = {
                        q: Number(centerAxial.q)
                            - (Number(coord.q) * Number(basis.qAxis.q))
                            - (Number(coord.r) * Number(basis.rAxis.q)),
                        r: Number(centerAxial.r)
                            - (Number(coord.q) * Number(basis.qAxis.r))
                            - (Number(coord.r) * Number(basis.rAxis.r))
                    };
                }
            }
            if (!anchorCenter) {
                anchorCenter = evenQOffsetToAxial(
                    Math.max(0, Math.floor((Number(map && map.width) || 0) * 0.5)),
                    Math.max(0, Math.floor((Number(map && map.height) || 0) * 0.5))
                );
            }

            const baseSectionRecords = rawSectionCoords.length > 0
                ? buildSectionRecordsFromCoords(rawSectionCoords, resolvedRadius, anchorCenter)
                : null;
            const generatedSectionRecords = (
                baseSectionRecords &&
                Array.isArray(baseSectionRecords.orderedSections) &&
                baseSectionRecords.orderedSections.length > 0
            ) ? baseSectionRecords : {
                basis,
                sectionCoords: [],
                sectionsByKey: new Map(),
                orderedSections: [],
                anchorCenter
            };
            const generatedAssets = buildPrototypeSectionAssets(generatedSectionRecords, resolvedRadius);
            const orderedSectionAssets = generatedAssets.orderedSectionAssets;
            const sectionAssetsByKey = generatedAssets.sectionAssetsByKey;
            const orderedSections = generatedSectionRecords.orderedSections;
            const sectionsByKey = generatedSectionRecords.sectionsByKey;

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
                const rawObjects = Array.isArray(rawAsset.objects) ? rawAsset.objects : [];
                const sectionObjects = [];
                for (let objectIndex = 0; objectIndex < rawObjects.length; objectIndex++) {
                    const rawObject = rawObjects[objectIndex];
                    if (isPrototypeTriggerRecord(rawObject)) {
                        const clonedTrigger = clonePrototypeTriggerRecord(rawObject);
                        if (clonedTrigger) {
                            legacyTriggerRecords.push(clonedTrigger);
                        }
                        continue;
                    }
                    sectionObjects.push(rawObject);
                }
                const rawBlockedEdges = Array.isArray(rawAsset.blockedEdges) ? rawAsset.blockedEdges : null;
                const blockedEdges = clonePrototypeBlockedEdges(rawBlockedEdges);
                const blockedEdgesNeedCompute = !Array.isArray(rawBlockedEdges)
                    || (blockedEdges.length === 0 && rawWalls.length > 0);
                let asset = sectionAssetsByKey.get(key) || null;
                if (!asset) {
                    asset = {
                        id: key,
                        key,
                        coord,
                        centerAxial,
                        centerOffset,
                        centerWorld: offsetToWorld(centerOffset),
                        neighborKeys: Array.isArray(rawAsset.neighborKeys) ? rawAsset.neighborKeys.slice() : [],
                        tileCoordKeys: Array.isArray(rawAsset.tileCoordKeys) ? rawAsset.tileCoordKeys.slice() : [],
                        groundTextureId: Number.isFinite(rawAsset.groundTextureId) ? Number(rawAsset.groundTextureId) : 0,
                        groundTiles: normalizePrototypeGroundTiles(rawAsset.groundTiles, rawAsset.tileCoordKeys, textureCount),
                        floors: [],
                        walls: [],
                        blockedEdges: [],
                        clearanceByTile: {},
                        objects: [],
                        animals: [],
                        powerups: []
                    };
                    orderedSectionAssets.push(asset);
                    sectionAssetsByKey.set(asset.key, asset);
                    if (!sectionsByKey.has(asset.key)) {
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
                }
                applyRawPrototypeSectionAssetToStateAsset(asset, {
                    ...rawAsset,
                    key,
                    coord,
                    centerAxial,
                    centerOffset,
                    walls: rawWalls,
                    blockedEdges,
                    objects: sectionObjects,
                    groundTiles: normalizePrototypeGroundTiles(rawAsset.groundTiles, rawAsset.tileCoordKeys, textureCount),
                    animals: dedupePrototypeAnimalRecords(rawAsset.animals)
                }, map);
                asset._prototypeBlockedEdgesDirty = blockedEdgesNeedCompute;
                asset._prototypeClearanceDirty = Object.keys(asset.clearanceByTile).length !== asset.tileCoordKeys.length;
            }

            const nextWallRecordId = normalizePrototypeRecordIds(orderedSectionAssets, "walls");
            let nextObjectRecordId = normalizePrototypeRecordIds(orderedSectionAssets, "objects");
            const nextAnimalRecordId = normalizePrototypeRecordIds(orderedSectionAssets, "animals");
            const nextPowerupRecordId = normalizePrototypeRecordIds(orderedSectionAssets, "powerups");
            const normalizedTriggerDefs = normalizePrototypeTriggerDefinitions(
                legacyTriggerRecords.concat(explicitTriggerRecords),
                { radius: resolvedRadius, anchorCenter, basis },
                collectUsedPrototypeObjectRecordIds(orderedSectionAssets),
                nextObjectRecordId
            );
            nextObjectRecordId = normalizedTriggerDefs.nextRecordId;

            return {
                radius: resolvedRadius,
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
                triggerDefinitions: normalizedTriggerDefs.triggerDefinitions,
                sectionCoords: orderedSections.map((section) => ({ q: section.coord.q, r: section.coord.r })),
                sectionsByKey,
                orderedSections,
                sectionAssetsByKey,
                orderedSectionAssets,
                anchorCenter,
                floorTransitions: clonePrototypeFloorTransitions(assetBundle && assetBundle.transitions),
                manifest: (assetBundle && assetBundle.manifest && typeof assetBundle.manifest === "object")
                    ? assetBundle.manifest
                    : {},
                loadedSectionAssetKeys: new Set(
                    orderedSectionAssets
                        .filter((asset) => !!(asset && asset._prototypeSectionHydrated === true))
                        .map((asset) => asset.key)
                ),
                sectionAssetLoader: null,
                pendingSectionHydrations: new Map()
            };
        }

        return {
            buildSectionStateFromAssetBundle,
            loadPrototypeSectionAssetBundle
        };
    }

    globalScope.__sectionWorldImport = {
        createSectionWorldImportHelpers,
        createPrototypeImportHelpers: createSectionWorldImportHelpers
    };
    globalScope.__twoSectionPrototypeImport = globalScope.__sectionWorldImport;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldImport;
}
