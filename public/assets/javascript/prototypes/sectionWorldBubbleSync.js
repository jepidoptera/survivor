(function (globalScope) {
    "use strict";

    function createSectionWorldBubbleSyncHelpers(map, deps) {
        const {
            updatePrototypeGpuDebugStats,
            updatePrototypeSeamSegmentsForSections,
            applyPrototypeSectionClearanceChunk
        } = deps;

        const prototypeNow = () => (
            (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                ? performance.now()
                : Date.now()
        );

        const prependPrototypeTasks = (session, tasks) => {
            if (!session || !Array.isArray(session.queue) || !Array.isArray(tasks) || tasks.length === 0) return;
            session.queue.unshift(...tasks);
        };

        const createPrototypeAsyncBubbleShiftSession = (startedAtMs, previousCenterKey, layoutMs, options = {}) => ({
            from: previousCenterKey || "",
            to: (map._prototypeSectionState && map._prototypeSectionState.activeCenterKey) || "",
            startedAtMs,
            layoutMs,
            sessionId: `${Math.round(startedAtMs)}:${Math.random().toString(36).slice(2, 7)}`,
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
            updatePrototypeGpuDebugStats(map);
            try {
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

        const attachFlushPrototypeBubbleShiftSession = () => {
            map.flushPrototypeBubbleShiftSession = function flushPrototypeBubbleShiftSession(options = {}) {
                let session = this._prototypeBubbleShiftSession;
                if (!session || session.completed === true) return true;
                const maxTasks = Math.max(1, Math.floor(Number(options.maxTasks) || 200000));
                let tasksRun = 0;
                while (session && session.completed !== true && tasksRun < maxTasks) {
                    if (!Array.isArray(session.queue) || session.queue.length === 0) {
                        finalizePrototypeAsyncBubbleShiftSession(session);
                        session = this._prototypeBubbleShiftSession;
                        break;
                    }
                    const task = session.queue.shift();
                    if (typeof task === "function") {
                        const taskStart = prototypeNow();
                        task();
                        session.workMs += prototypeNow() - taskStart;
                    }
                    tasksRun += 1;
                }
                if (session && session.completed !== true && Array.isArray(session.queue) && session.queue.length === 0) {
                    finalizePrototypeAsyncBubbleShiftSession(session);
                }
                return !this._prototypeBubbleShiftSession || this._prototypeBubbleShiftSession.completed === true;
            };
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

        const attachBubbleShiftControlApis = (controlDeps) => {
            const {
                updateActiveBubbleForActor,
                enqueuePrototypeAsyncWallSync,
                enqueuePrototypeAsyncObjectSync,
                enqueuePrototypeAsyncAnimalSync,
                enqueuePrototypeAsyncPowerupSync
            } = controlDeps;
            const prunePrototypeAnimalsForTargetBubble = () => {
                const state = map && map._prototypeSectionState;
                const animalState = map && map._prototypeAnimalState;
                if (
                    !state ||
                    !state.pendingLayoutTransition ||
                    !(animalState && animalState.activeRuntimeAnimalsByRecordId instanceof Map)
                ) {
                    return 0;
                }
                const targetActiveKeys = state.pendingLayoutTransition.targetActiveKeys instanceof Set
                    ? state.pendingLayoutTransition.targetActiveKeys
                    : (state.activeSectionKeys instanceof Set ? state.activeSectionKeys : null);
                if (!(targetActiveKeys instanceof Set) || targetActiveKeys.size === 0) return 0;

                const removedRuntimeAnimals = [];
                for (const [recordId, runtimeAnimal] of animalState.activeRuntimeAnimalsByRecordId.entries()) {
                    if (!runtimeAnimal) {
                        animalState.activeRuntimeAnimalsByRecordId.delete(recordId);
                        continue;
                    }
                    const ownerSectionKey = (typeof runtimeAnimal._prototypeOwnerSectionKey === "string" && runtimeAnimal._prototypeOwnerSectionKey.length > 0)
                        ? runtimeAnimal._prototypeOwnerSectionKey
                        : (typeof map.getPrototypeSectionKeyForWorldPoint === "function"
                            ? map.getPrototypeSectionKeyForWorldPoint(runtimeAnimal.x, runtimeAnimal.y)
                            : "");
                    if (ownerSectionKey && targetActiveKeys.has(ownerSectionKey)) continue;

                    if (typeof runtimeAnimal.removeFromGame === "function") {
                        runtimeAnimal.removeFromGame();
                    } else if (typeof runtimeAnimal.remove === "function") {
                        runtimeAnimal.remove();
                    } else {
                        runtimeAnimal.gone = true;
                    }
                    animalState.activeRuntimeAnimalsByRecordId.delete(recordId);
                    removedRuntimeAnimals.push(runtimeAnimal);
                }

                if (removedRuntimeAnimals.length === 0) return 0;
                animalState.activeRuntimeAnimals = Array.from(animalState.activeRuntimeAnimalsByRecordId.values());
                animalState.activeRecordSignature = "";
                return removedRuntimeAnimals.length;
            };
            map.updatePrototypeSectionBubble = function updatePrototypeSectionBubble(actor, options = {}) {
                const totalStart = prototypeNow();
                const previousCenterKey = this._prototypeSectionState && this._prototypeSectionState.activeCenterKey;
                const bubbleChanged = updateActiveBubbleForActor(this, actor, options);
                const layoutMs = prototypeNow() - totalStart;
                if (bubbleChanged) {
                    prunePrototypeAnimalsForTargetBubble();
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
            map.schedulePrototypeRuntimeSync = function schedulePrototypeRuntimeSync(options = {}) {
                const startedAtMs = prototypeNow();
                const previousCenterKey = this._prototypeSectionState && this._prototypeSectionState.activeCenterKey;
                prunePrototypeAnimalsForTargetBubble();
                const asyncSession = createPrototypeAsyncBubbleShiftSession(startedAtMs, previousCenterKey, 0, options);
                enqueuePrototypeAsyncPowerupSync(asyncSession);
                enqueuePrototypeAsyncAnimalSync(asyncSession);
                enqueuePrototypeAsyncObjectSync(asyncSession);
                enqueuePrototypeAsyncWallSync(asyncSession);
                this._prototypeBubbleShiftSession = asyncSession;
                advancePrototypeAsyncBubbleShiftSession(asyncSession, options);
                updatePrototypeGpuDebugStats(this);
                return asyncSession;
            };
        };

        return {
            prototypeNow,
            prependPrototypeTasks,
            createPrototypeAsyncBubbleShiftSession,
            finalizePrototypeAsyncBubbleShiftSession,
            advancePrototypeAsyncBubbleShiftSession,
            attachFlushPrototypeBubbleShiftSession,
            enqueuePrototypeAsyncLayoutSync,
            attachBubbleShiftControlApis
        };
    }

    globalScope.__sectionWorldBubbleSync = {
        createSectionWorldBubbleSyncHelpers,
        createPrototypeBubbleSyncHelpers: createSectionWorldBubbleSyncHelpers
    };
    globalScope.__twoSectionPrototypeBubbleSync = globalScope.__sectionWorldBubbleSync;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldBubbleSync;
}
