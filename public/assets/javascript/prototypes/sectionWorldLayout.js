(function (globalScope) {
    "use strict";

    function comparePrototypeNodesByDrawOrder(nodeA, nodeB) {
        const ay = Number(nodeA && nodeA.yindex) || 0;
        const by = Number(nodeB && nodeB.yindex) || 0;
        if (ay !== by) return ay - by;
        const ax = Number(nodeA && nodeA.xindex) || 0;
        const bx = Number(nodeB && nodeB.xindex) || 0;
        return ax - bx;
    }

    function sortPrototypeLoadedNodes(loadedNodes) {
        if (!Array.isArray(loadedNodes)) return [];
        loadedNodes.sort(comparePrototypeNodesByDrawOrder);
        return loadedNodes;
    }

    function setActiveCenter(map, nextCenterKey, deps) {
        const {
            SECTION_DIRECTIONS,
            addSectionCoords,
            ensurePrototypeSectionExists,
            getBubbleKeysForCenter,
            getPrototypeLookaheadKeysForCenter,
            addSparseNodesForSection,
            refreshSparseNodesForSectionAsset,
            rebuildPrototypeFloorRuntime,
            updatePrototypeSeamSegmentsForSections
        } = deps;
        const state = map && map._prototypeSectionState;
        if (!state) return false;
        const compareSectionKeysByCenter = (a, b) => {
            const sectionA = state.sectionsByKey instanceof Map ? state.sectionsByKey.get(a) : null;
            const sectionB = state.sectionsByKey instanceof Map ? state.sectionsByKey.get(b) : null;
            const centerA = sectionA && sectionA.centerOffset && typeof sectionA.centerOffset === "object"
                ? sectionA.centerOffset
                : { x: 0, y: 0 };
            const centerB = sectionB && sectionB.centerOffset && typeof sectionB.centerOffset === "object"
                ? sectionB.centerOffset
                : { x: 0, y: 0 };
            const ay = Number(centerA.y) || 0;
            const by = Number(centerB.y) || 0;
            if (ay !== by) return ay - by;
            return (Number(centerA.x) || 0) - (Number(centerB.x) || 0);
        };
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
        keysToDeactivate.sort(compareSectionKeysByCenter);
        keysToActivate.sort(compareSectionKeysByCenter);
        let materializedActiveSections = false;
        const targetActiveKeysArray = Array.from(nextActiveKeys);
        for (let i = 0; i < targetActiveKeysArray.length; i++) {
            const sectionKey = targetActiveKeysArray[i];
            const asset = state.sectionAssetsByKey instanceof Map ? state.sectionAssetsByKey.get(sectionKey) : null;
            const hasNodes = state.nodesBySectionKey instanceof Map && state.nodesBySectionKey.has(sectionKey);
            if (!asset || hasNodes || asset._prototypeSectionHydrated !== true || state.useSparseNodes !== true) continue;
            addSparseNodesForSection(map, state, asset);
            refreshSparseNodesForSectionAsset(map, state, asset);
            materializedActiveSections = true;
        }
        if (materializedActiveSections) {
            rebuildPrototypeFloorRuntime(map, state);
        }

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
            sortPrototypeLoadedNodes(state.loadedNodes);
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
            if (typeof map.prefetchPrototypeSectionAssets === "function") {
                const lookaheadKeys = Array.from(getPrototypeLookaheadKeysForCenter(state, nextCenterKey));
                if (lookaheadKeys.length > 0) {
                    map.prefetchPrototypeSectionAssets(lookaheadKeys, { materialize: false });
                }
            }
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
        if (typeof map.prefetchPrototypeSectionAssets === "function") {
            const lookaheadKeys = Array.from(getPrototypeLookaheadKeysForCenter(state, nextCenterKey));
            if (lookaheadKeys.length > 0) {
                map.prefetchPrototypeSectionAssets(lookaheadKeys, { materialize: false });
            }
        }
        return changed;
    }

    function settlePendingPrototypeLayoutTransition(map, deps) {
        const { updatePrototypeSeamSegmentsForSections } = deps;
        const state = map && map._prototypeSectionState;
        const transition = state && state.pendingLayoutTransition;
        if (!state || !transition) return false;

        const layoutNow = () => (
            (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                ? performance.now()
                : Date.now()
        );

        const initialStats = (transition.initialStats && typeof transition.initialStats === "object")
            ? transition.initialStats
            : {};
        let deactivateMs = Number(initialStats.deactivateMs) || 0;
        let activateMs = Number(initialStats.activateMs) || 0;
        let rebuildLoadedMs = Number(initialStats.rebuildLoadedMs) || 0;
        let seamMs = Number(initialStats.seamMs) || 0;
        let clearanceMs = Number(initialStats.clearanceMs) || 0;
        let deactivatedNodeCount = Number(initialStats.deactivatedNodeCount) || 0;
        let activatedNodeCount = Number(initialStats.activatedNodeCount) || 0;
        const keysToActivate = Array.isArray(transition.keysToActivate) ? transition.keysToActivate.slice() : [];
        const keysToDeactivate = Array.isArray(transition.keysToDeactivate) ? transition.keysToDeactivate.slice() : [];

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
        if (!(state.loadedNodesByCoordKey instanceof Map)) {
            state.loadedNodesByCoordKey = new Map();
            for (let i = 0; i < state.loadedNodes.length; i++) {
                const node = state.loadedNodes[i];
                if (!node) continue;
                state.loadedNodesByCoordKey.set(`${node.xindex},${node.yindex}`, node);
            }
        }

        const nextActualKeys = transition.targetActiveKeys instanceof Set
            ? new Set(transition.targetActiveKeys)
            : (state.activeSectionKeys instanceof Set ? new Set(state.activeSectionKeys) : new Set());
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

        state.actualActiveSectionKeys = nextActualKeys;

        // Re-activate nodes from still-active sections that were incorrectly
        // deactivated by departing sections' overlap/padding nodes.
        if (keysToDeactivate.length > 0) {
            for (const sectionKey of nextActualKeys) {
                const nodes = state.nodesBySectionKey.get(sectionKey) || [];
                for (let n = 0; n < nodes.length; n++) {
                    const node = nodes[n];
                    if (!node || node._prototypeSectionActive === true) continue;
                    node._prototypeSectionActive = true;
                    node.blocked = false;
                    const coordKey = `${node.xindex},${node.yindex}`;
                    state.loadedNodesByCoordKey.set(coordKey, node);
                    if (!state.loadedNodeKeySet.has(coordKey)) {
                        state.loadedNodeKeySet.add(coordKey);
                        state.loadedNodes.push(node);
                    }
                }
            }
        }

        const rebuildLoadedStart = layoutNow();
        state.loadedNodes = state.loadedNodes.filter((node) => (
            node &&
            node._prototypeSectionActive === true &&
            !keysToDeactivateSet.has(node._prototypeSectionKey) &&
            state.loadedNodeKeySet.has(`${node.xindex},${node.yindex}`)
        ));
        sortPrototypeLoadedNodes(state.loadedNodes);
        rebuildLoadedMs += layoutNow() - rebuildLoadedStart;

        const changedSectionKeys = transition.changedSectionKeys instanceof Set
            ? transition.changedSectionKeys
            : new Set([...keysToActivate, ...keysToDeactivate]);
        const seamStart = layoutNow();
        updatePrototypeSeamSegmentsForSections(state, changedSectionKeys);
        seamMs += layoutNow() - seamStart;

        if (keysToActivate.length > 0 && typeof map.applyPrototypeSectionClearance === "function") {
            const clearanceStart = layoutNow();
            map.applyPrototypeSectionClearance(new Set(keysToActivate));
            clearanceMs += layoutNow() - clearanceStart;
        }

        state.pendingLayoutTransition = null;
        state.lastLayoutStats = {
            ms: Number((
                (Number(initialStats.ensureSectionsMs) || 0)
                + (Number(initialStats.compareMs) || 0)
                + deactivateMs
                + activateMs
                + rebuildLoadedMs
                + seamMs
                + clearanceMs
            ).toFixed(2)),
            ensureSectionsMs: Number((Number(initialStats.ensureSectionsMs) || 0).toFixed(2)),
            compareMs: Number((Number(initialStats.compareMs) || 0).toFixed(2)),
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
        return true;
    }

    globalScope.__sectionWorldLayout = {
        setActiveCenter,
        settlePendingPrototypeLayoutTransition,
        sortPrototypeLoadedNodes
    };
    globalScope.__twoSectionPrototypeLayout = globalScope.__sectionWorldLayout;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldLayout;
}
