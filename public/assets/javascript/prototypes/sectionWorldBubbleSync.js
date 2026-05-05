(function (globalScope) {
    "use strict";

    function createSectionWorldBubbleSyncHelpers(map, deps) {
        const {
            updatePrototypeGpuDebugStats,
            updatePrototypeSeamSegmentsForSections,
            applyPrototypeSectionClearanceChunk,
            sortPrototypeLoadedNodes
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

        const createPrototypeTask = (label, fn) => {
            if (typeof fn !== "function") return fn;
            const task = function prototypeBubbleTask() {
                return fn();
            };
            task._prototypeTaskLabel = (typeof label === "string" && label.length > 0) ? label : "task";
            return task;
        };

        const toBubbleMs = (value) => Number((Number(value) || 0).toFixed(2));

        const hasBubbleValue = (value, minimum = 0.05) => {
            const numericValue = Number(value);
            return Number.isFinite(numericValue) && Math.abs(numericValue) >= minimum;
        };

        const addBubbleHotspot = (hotspots, label, ms, extra = null) => {
            if (!Array.isArray(hotspots) || !hasBubbleValue(ms, 0.5)) return;
            const entry = {
                label,
                ms: toBubbleMs(ms)
            };
            if (extra && typeof extra === "object") {
                Object.keys(extra).forEach((key) => {
                    const value = extra[key];
                    if (value === null || value === undefined || value === "") return;
                    if (typeof value === "number") {
                        if (!Number.isFinite(value)) return;
                        entry[key] = Number.isInteger(value) ? value : toBubbleMs(value);
                        return;
                    }
                    entry[key] = value;
                });
            }
            hotspots.push(entry);
        };

        const sortBubbleHotspots = (hotspots, limit = 8) => {
            if (!Array.isArray(hotspots) || hotspots.length === 0) return [];
            return hotspots
                .slice()
                .sort((left, right) => {
                    const msDelta = Number(right && right.ms) - Number(left && left.ms);
                    if (msDelta !== 0) return msDelta;
                    return String(left && left.label || "").localeCompare(String(right && right.label || ""));
                })
                .slice(0, limit);
        };

        const buildBubbleByTypeList = (byTypeStats) => {
            if (!byTypeStats || typeof byTypeStats !== "object") return [];
            return Object.keys(byTypeStats)
                .map((type) => {
                    const stats = byTypeStats[type] || {};
                    return {
                        type,
                        loaded: Number(stats.loaded) || 0,
                        removed: Number(stats.removed) || 0,
                        ms: toBubbleMs(stats.ms)
                    };
                })
                .filter((entry) => entry.loaded > 0 || entry.removed > 0 || hasBubbleValue(entry.ms))
                .sort((left, right) => {
                    const msDelta = right.ms - left.ms;
                    if (msDelta !== 0) return msDelta;
                    const loadDelta = right.loaded - left.loaded;
                    if (loadDelta !== 0) return loadDelta;
                    return left.type.localeCompare(right.type);
                });
        };

        const buildBubbleLayoutSummary = (layoutStats, fallbackLoadedNodes, hotspots) => {
            const stats = (layoutStats && typeof layoutStats === "object") ? layoutStats : {};
            addBubbleHotspot(hotspots, "layout.activate", stats.activateMs, {
                nodes: Number(stats.activatedNodeCount) || 0
            });
            addBubbleHotspot(hotspots, "layout.deactivate", stats.deactivateMs, {
                nodes: Number(stats.deactivatedNodeCount) || 0
            });
            addBubbleHotspot(hotspots, "layout.rebuildLoaded", stats.rebuildLoadedMs);
            addBubbleHotspot(hotspots, "layout.clearance", stats.clearanceMs);
            addBubbleHotspot(hotspots, "layout.seam", stats.seamMs);
            return {
                ms: toBubbleMs(stats.ms),
                loadedNodes: Number(stats.loadedNodeCount) || Number(fallbackLoadedNodes) || 0,
                activatedNodes: Number(stats.activatedNodeCount) || 0,
                deactivatedNodes: Number(stats.deactivatedNodeCount) || 0,
                keysToActivate: Number(stats.keysToActivate) || 0,
                keysToDeactivate: Number(stats.keysToDeactivate) || 0,
                timings: Object.fromEntries(
                    [
                        ["activate", stats.activateMs],
                        ["deactivate", stats.deactivateMs],
                        ["rebuildLoaded", stats.rebuildLoadedMs],
                        ["clearance", stats.clearanceMs],
                        ["seam", stats.seamMs]
                    ].filter(([, value]) => hasBubbleValue(value)).map(([label, value]) => [label, toBubbleMs(value)])
                )
            };
        };

        const buildBubbleWallSummary = (wallStats, changed, hotspots) => {
            const stats = (wallStats && typeof wallStats === "object") ? wallStats : {};
            addBubbleHotspot(hotspots, "walls.blockedEdgeApply", stats.blockedEdgeApplyMs, {
                links: Number(stats.blockedEdgeAppliedLinks) || 0
            });
            addBubbleHotspot(hotspots, "walls.clearance", stats.clearanceMs, {
                nodes: Number(stats.clearanceNodeCount) || 0
            });
            addBubbleHotspot(hotspots, "walls.loadJson", stats.loadJsonMs, {
                loaded: Number(stats.loaded) || 0
            });
            addBubbleHotspot(hotspots, "walls.joinery", stats.joineryMs);
            addBubbleHotspot(hotspots, "walls.addNodes", stats.addNodesMs);
            const timings = Object.fromEntries(
                [
                    ["blockedEdgeApply", stats.blockedEdgeApplyMs],
                    ["clearance", stats.clearanceMs],
                    ["loadJson", stats.loadJsonMs],
                    ["joinery", stats.joineryMs],
                    ["addNodes", stats.addNodesMs],
                    ["unload", stats.unloadMs],
                    ["capture", stats.captureMs],
                    ["collect", stats.collectMs]
                ].filter(([, value]) => hasBubbleValue(value)).map(([label, value]) => [label, toBubbleMs(value)])
            );
            const summary = {
                changed: !!changed,
                ms: toBubbleMs(stats.ms),
                active: Number(stats.active) || 0,
                desired: Number(stats.desired) || 0,
                loaded: Number(stats.loaded) || 0,
                removed: Number(stats.removed) || 0,
                timings
            };
            if ((Number(stats.blockedEdgeAppliedLinks) || 0) > 0) {
                summary.blockedEdgeLinks = Number(stats.blockedEdgeAppliedLinks) || 0;
            }
            return summary;
        };

        const buildBubblePowerupSummary = (powerupStats, changed, hotspots) => {
            const stats = (powerupStats && typeof powerupStats === "object") ? powerupStats : {};
            addBubbleHotspot(hotspots, "objects.powerups", stats.ms, {
                loaded: Number(stats.loaded) || 0,
                removed: Number(stats.removed) || 0
            });
            return {
                changed: !!changed,
                ms: toBubbleMs(stats.ms),
                active: Number(stats.active) || 0,
                desired: Number(stats.desired) || 0,
                loaded: Number(stats.loaded) || 0,
                removed: Number(stats.removed) || 0
            };
        };

        const buildBubbleObjectSummary = (objectStats, changed, powerups, hotspots) => {
            const stats = (objectStats && typeof objectStats === "object") ? objectStats : {};
            addBubbleHotspot(hotspots, "objects.roadRefresh", stats.roadRefreshMs, {
                count: Number(stats.roadRefreshCount) || 0
            });
            addBubbleHotspot(hotspots, "objects.load", stats.loadMs, {
                loaded: Number(stats.loaded) || 0
            });
            addBubbleHotspot(hotspots, "objects.staticLoad", stats.staticLoadMs, {
                loaded: Number(stats.staticLoaded) || 0
            });
            addBubbleHotspot(hotspots, "objects.treeFinalize", stats.treeFinalizeMs);
            addBubbleHotspot(hotspots, "objects.roofLoad", stats.roofLoadMs, {
                loaded: Number(stats.roofLoaded) || 0
            });
            addBubbleHotspot(hotspots, "objects.unload", stats.unloadMs, {
                removed: Number(stats.removed) || 0
            });
            const timings = Object.fromEntries(
                [
                    ["roadRefresh", stats.roadRefreshMs],
                    ["load", stats.loadMs],
                    ["staticLoad", stats.staticLoadMs],
                    ["treeFinalize", stats.treeFinalizeMs],
                    ["roofLoad", stats.roofLoadMs],
                    ["unload", stats.unloadMs],
                    ["capture", stats.captureMs],
                    ["collect", stats.collectMs],
                    ["invalidate", stats.invalidateMs],
                    ["stalePrune", stats.stalePruneMs]
                ].filter(([, value]) => hasBubbleValue(value)).map(([label, value]) => [label, toBubbleMs(value)])
            );
            const summary = {
                changed: !!changed,
                ms: toBubbleMs(stats.ms),
                active: Number(stats.active) || 0,
                desired: Number(stats.desired) || 0,
                loaded: Number(stats.loaded) || 0,
                removed: Number(stats.removed) || 0,
                timings
            };
            const byType = buildBubbleByTypeList(stats.byType);
            if (byType.length > 0) {
                summary.byType = byType;
            }
            if (
                (Number(stats.parkedStored) || 0) > 0 ||
                (Number(stats.parkedReused) || 0) > 0 ||
                (Number(stats.parkedEvicted) || 0) > 0 ||
                (Number(stats.parkedActive) || 0) > 0
            ) {
                summary.parking = {
                    stored: Number(stats.parkedStored) || 0,
                    reused: Number(stats.parkedReused) || 0,
                    evicted: Number(stats.parkedEvicted) || 0,
                    active: Number(stats.parkedActive) || 0
                };
            }
            if (powerups) {
                summary.powerups = powerups;
            }
            return summary;
        };

        const buildBubbleAnimalSummary = (animalStats, changed, hotspots) => {
            const stats = (animalStats && typeof animalStats === "object") ? animalStats : {};
            addBubbleHotspot(hotspots, "animals.sync", stats.ms, {
                loaded: Number(stats.loaded) || 0,
                removed: Number(stats.removed) || 0
            });
            return {
                changed: !!changed,
                ms: toBubbleMs(stats.ms),
                active: Number(stats.active) || 0,
                desired: Number(stats.desired) || 0,
                loaded: Number(stats.loaded) || 0,
                removed: Number(stats.removed) || 0
            };
        };

        const recordPrototypeTaskExecution = (session, task, taskMs, sliceIndex = 0) => {
            if (!session || !hasBubbleValue(taskMs, 0.1)) return;
            const label = (task && typeof task._prototypeTaskLabel === "string" && task._prototypeTaskLabel.length > 0)
                ? task._prototypeTaskLabel
                : "task";
            const entry = {
                label,
                ms: toBubbleMs(taskMs),
                slice: Math.max(0, Number(sliceIndex) || 0)
            };
            if (!session.maxTaskExecution || entry.ms > Number(session.maxTaskExecution.ms) || 0) {
                session.maxTaskExecution = { ...entry };
            }
            if (!Array.isArray(session.topTaskExecutions)) {
                session.topTaskExecutions = [];
            }
            session.topTaskExecutions.push(entry);
            session.topTaskExecutions.sort((left, right) => {
                const msDelta = Number(right && right.ms) - Number(left && left.ms);
                if (msDelta !== 0) return msDelta;
                return Number(left && left.slice) - Number(right && right.slice);
            });
            if (session.topTaskExecutions.length > 8) {
                session.topTaskExecutions.length = 8;
            }
        };

        const buildBubbleTaskSummary = (session) => ({
            max: session && session.maxTaskExecution ? { ...session.maxTaskExecution } : null,
            top: Array.isArray(session && session.topTaskExecutions)
                ? session.topTaskExecutions.map((entry) => ({ ...entry }))
                : []
        });

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
            maxTaskExecution: null,
            topTaskExecutions: [],
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
                const loadedNodes = map._prototypeSectionState && Array.isArray(map._prototypeSectionState.loadedNodes)
                    ? map._prototypeSectionState.loadedNodes.length
                    : 0;
                const hotspots = [];
                const powerupSummary = buildBubblePowerupSummary(powerupStats, session.powerupsChanged, hotspots);
                console.log("[prototype bubble shift]", {
                    from: session.from,
                    to: session.to,
                    frame: {
                        budgetMs: toBubbleMs(session.frameBudgetMs),
                        shiftFrameMs: toBubbleMs(session.shiftFrameMs),
                        maxSliceMs: toBubbleMs(session.maxFrameSliceMs),
                        sliceCount: Number(session.frameSliceCount) || 0,
                        workMs: toBubbleMs(session.workMs),
                        totalMs: toBubbleMs(totalMs)
                    },
                    tasks: buildBubbleTaskSummary(session),
                    layout: buildBubbleLayoutSummary(
                        map._prototypeSectionState && map._prototypeSectionState.lastLayoutStats
                            ? map._prototypeSectionState.lastLayoutStats
                            : null,
                        loadedNodes,
                        hotspots
                    ),
                    walls: buildBubbleWallSummary(wallStats, session.wallsChanged, hotspots),
                    objects: buildBubbleObjectSummary(objectStats, session.objectsChanged, powerupSummary, hotspots),
                    animals: buildBubbleAnimalSummary(animalStats, session.animalsChanged, hotspots),
                    hotspots: sortBubbleHotspots(hotspots)
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
            const sliceIndex = (Number(session.frameSliceCount) || 0) + 1;
            while (session.queue.length > 0 && prototypeNow() < deadline) {
                const task = session.queue.shift();
                if (typeof task === "function") {
                    const taskStart = prototypeNow();
                    task();
                    const taskMs = prototypeNow() - taskStart;
                    session.workMs += taskMs;
                    recordPrototypeTaskExecution(session, task, taskMs, sliceIndex);
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
                        const taskMs = prototypeNow() - taskStart;
                        session.workMs += taskMs;
                        recordPrototypeTaskExecution(session, task, taskMs, 0);
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
                reactivateOverlapMs: 0,
                reactivateOverlapCount: 0,
                deactivatedNodeCount: 0,
                activatedNodeCount: 0
            };
            const chunkSize = 700;
            const tasks = [];
            const activateKeys = Array.isArray(transition.keysToActivate) ? transition.keysToActivate.slice() : [];
            const deactivateKeys = Array.isArray(transition.keysToDeactivate) ? transition.keysToDeactivate.slice() : [];
            const targetActiveKeys = transition.targetActiveKeys instanceof Set
                ? Array.from(transition.targetActiveKeys)
                : [];
            let materializedNodeSections = 0;
            const unregBatchSize = 500;
            if (deactivateKeys.length > 0 && typeof map.unregisterSectionFloorNodes === "function") {
                for (let i = 0; i < deactivateKeys.length; i++) {
                    const sectionKey = deactivateKeys[i];
                    if (typeof map.prepareFloorSectionUnregisterForSection === "function") {
                        tasks.push(createPrototypeTask("layout.floorUnregisterPlan", () => {
                            const nodeCount = map.prepareFloorSectionUnregisterForSection(sectionKey);
                            if (nodeCount === 0) {
                                map.commitFloorSectionUnregisterForSection(sectionKey);
                                return;
                            }
                            const unregTasks = [];
                            for (let offset = 0; offset < nodeCount; offset += unregBatchSize) {
                                const batchStart = offset;
                                unregTasks.push(createPrototypeTask("layout.floorUnregisterBatch", () => {
                                    map.unregisterFloorSectionNodeBatchForSection(sectionKey, batchStart, unregBatchSize);
                                }));
                            }
                            unregTasks.push(createPrototypeTask("layout.floorUnregisterCommit", () => {
                                map.commitFloorSectionUnregisterForSection(sectionKey);
                            }));
                            prependPrototypeTasks(session, unregTasks);
                        }));
                    } else {
                        tasks.push(createPrototypeTask("layout.floorUnregister", () => {
                            map.unregisterSectionFloorNodes(sectionKey);
                        }));
                    }
                }
            }
            const buildBatchSize = 300;
            const floorNodeBatchSize = 300;
            const floorConnectBatchSize = 350;
            const sparseConnectBatchSize = 500;
            if (targetActiveKeys.length > 0) {
                for (let i = 0; i < targetActiveKeys.length; i++) {
                    const sectionKey = targetActiveKeys[i];
                    if (typeof map.startSparseNodeBuildForSection === "function") {
                        tasks.push(createPrototypeTask("layout.materializePlan", () => {
                            if (!map._prototypeSectionState || map._prototypeSectionState.useSparseNodes !== true) {
                                materializedNodeSections += map.materializePrototypeSectionNodes([sectionKey]);
                                return;
                            }
                            // Skip if already built
                            const state = map._prototypeSectionState;
                            if (state.nodesBySectionKey && state.nodesBySectionKey.has(sectionKey)) return;
                            const asset = map.getPrototypeSectionAsset(sectionKey);
                            if (!asset) {
                                // Fallback: monolithic (section may not be hydrated yet)
                                materializedNodeSections += map.materializePrototypeSectionNodes([sectionKey]);
                                return;
                            }
                            const started = map.startSparseNodeBuildForSection(sectionKey);
                            if (!started) {
                                materializedNodeSections += 1;
                                return;
                            }
                            const tileCount = map.getPrototypeTileKeyCount(sectionKey);
                            const buildTasks = [];
                            for (let offset = 0; offset < tileCount; offset += buildBatchSize) {
                                const batchStart = offset;
                                buildTasks.push(createPrototypeTask("layout.materializeBuildBatch", () => {
                                    map.addSparseNodeBuildBatchForSection(sectionKey, batchStart, buildBatchSize);
                                }));
                            }
                            buildTasks.push(createPrototypeTask("layout.materializeCommit", () => {
                                map.commitSparseNodeBuildForSection(sectionKey);
                                materializedNodeSections += 1;
                            }));
                            buildTasks.push(createPrototypeTask("layout.materializeConnectPlan", () => {
                                const nodeCount = map.getSparseNodeCount(sectionKey);
                                const connectTasks = [];
                                for (let offset = 0; offset < nodeCount; offset += sparseConnectBatchSize) {
                                    const batchStart = offset;
                                    connectTasks.push(createPrototypeTask("layout.materializeConnect", () => {
                                        map.connectSparseNodesForSectionBatch(sectionKey, batchStart, sparseConnectBatchSize);
                                    }));
                                }
                                prependPrototypeTasks(session, connectTasks);
                            }));
                            prependPrototypeTasks(session, buildTasks);
                        }));
                    } else if (typeof map.materializePrototypeSectionNodes === "function") {
                        tasks.push(createPrototypeTask("layout.materializeNodes", () => {
                            materializedNodeSections += map.materializePrototypeSectionNodes([sectionKey]);
                        }));
                    }
                    if (typeof map.prepareFloorSectionFragmentsForSection === "function") {
                        tasks.push(createPrototypeTask("layout.floorPrepare", () => {
                            const prepared = map.prepareFloorSectionFragmentsForSection(sectionKey);
                            if (!prepared) return; // already registered or nothing to do
                            const nodeCount = typeof map.getSectionNodeCount === "function"
                                ? map.getSectionNodeCount(sectionKey) : 0;
                            const batchTasks = [];
                            for (let offset = 0; offset < nodeCount; offset += floorNodeBatchSize) {
                                const batchStart = offset;
                                batchTasks.push(createPrototypeTask("layout.floorBatch", () => {
                                    map.addFloorSectionNodeBatchForSection(sectionKey, batchStart, floorNodeBatchSize);
                                }));
                            }
                            // floorConnectPrepare will read actual node count and inject connect batches
                            batchTasks.push(createPrototypeTask("layout.floorConnectPrepare", () => {
                                const totalNodes = typeof map.prepareFloorSectionConnectionForSection === "function"
                                    ? map.prepareFloorSectionConnectionForSection(sectionKey) : 0;
                                const connectTasks = [];
                                for (let offset = 0; offset < totalNodes; offset += floorConnectBatchSize) {
                                    const batchStart = offset;
                                    connectTasks.push(createPrototypeTask("layout.floorConnect", () => {
                                        map.connectFloorSectionNodeBatchForSection(sectionKey, batchStart, floorConnectBatchSize);
                                    }));
                                }
                                connectTasks.push(createPrototypeTask("layout.floorCommit", () => {
                                    map.commitFloorSectionConnectionForSection(sectionKey);
                                }));
                                prependPrototypeTasks(session, connectTasks);
                            }));
                            prependPrototypeTasks(session, batchTasks);
                        }));
                    } else if (typeof map.registerSectionFloorNodes === "function") {
                        tasks.push(createPrototypeTask("layout.floorRegister", () => {
                            map.registerSectionFloorNodes(sectionKey);
                        }));
                    }
                }
            }
            for (let s = 0; s < activateKeys.length; s++) {
                const sectionKey = activateKeys[s];
                const nodes = state.nodesBySectionKey.get(sectionKey) || [];
                for (let i = 0; i < nodes.length; i += chunkSize) {
                    const startIndex = i;
                    tasks.push(createPrototypeTask("layout.activateChunk", () => {
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
                    }));
                }
                tasks.push(createPrototypeTask("layout.activateSet", () => {
                    if (!(state.actualActiveSectionKeys instanceof Set)) {
                        state.actualActiveSectionKeys = new Set();
                    }
                    state.actualActiveSectionKeys.add(sectionKey);
                }));
            }
            for (let s = 0; s < deactivateKeys.length; s++) {
                const sectionKey = deactivateKeys[s];
                const nodes = state.nodesBySectionKey.get(sectionKey) || [];
                for (let i = 0; i < nodes.length; i += chunkSize) {
                    const startIndex = i;
                    tasks.push(createPrototypeTask("layout.deactivateChunk", () => {
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
                    }));
                }
                tasks.push(createPrototypeTask("layout.deactivateSet", () => {
                    if (state.actualActiveSectionKeys instanceof Set) {
                        state.actualActiveSectionKeys.delete(sectionKey);
                    }
                }));
            }
            // Re-activate nodes from still-active sections that were incorrectly
            // deactivated by departing sections' overlap/padding nodes.
            // When a section loads, addSparseNodesForSection overwrites
            // _prototypeSectionKey for shared boundary nodes. When that section
            // later deactivates, it deactivates those shared nodes even though
            // the original owning section is still active.
            if (deactivateKeys.length > 0) {
                tasks.push(createPrototypeTask("layout.reactivateOverlapPlan", () => {
                    if (!(state.actualActiveSectionKeys instanceof Set)) return;
                    const overlapBatchSize = 500;
                    const overlapTasks = [];
                    for (const sectionKey of state.actualActiveSectionKeys) {
                        const sectionNodes = state.nodesBySectionKey.get(sectionKey) || [];
                        for (let offset = 0; offset < sectionNodes.length; offset += overlapBatchSize) {
                            const batchStart = offset;
                            overlapTasks.push(createPrototypeTask("layout.reactivateOverlapChunk", () => {
                                const t0 = prototypeNow();
                                const nodes = state.nodesBySectionKey.get(sectionKey) || [];
                                const end = Math.min(batchStart + overlapBatchSize, nodes.length);
                                for (let n = batchStart; n < end; n++) {
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
                                    stats.reactivateOverlapCount += 1;
                                }
                                stats.reactivateOverlapMs += prototypeNow() - t0;
                            }));
                        }
                    }
                    prependPrototypeTasks(session, overlapTasks);
                }));
            }
            tasks.push(createPrototypeTask("layout.rebuildLoadedPlan", () => {
                state._rebuildLoadedTemp = [];
                const rebuildBatchSize = 500;
                const activeKeys = Array.from(state.actualActiveSectionKeys instanceof Set ? state.actualActiveSectionKeys : []);
                const rebuildTasks = [];
                for (let ski = 0; ski < activeKeys.length; ski++) {
                    const sk = activeKeys[ski];
                    const sectionNodes = state.nodesBySectionKey.get(sk) || [];
                    for (let offset = 0; offset < sectionNodes.length; offset += rebuildBatchSize) {
                        const batchStart = offset;
                        rebuildTasks.push(createPrototypeTask("layout.rebuildLoadedChunk", () => {
                            const t0 = prototypeNow();
                            const nodes = state.nodesBySectionKey.get(sk) || [];
                            const end = Math.min(batchStart + rebuildBatchSize, nodes.length);
                            for (let n = batchStart; n < end; n++) {
                                const node = nodes[n];
                                if (node && node._prototypeSectionActive === true) {
                                    state._rebuildLoadedTemp.push(node);
                                }
                            }
                            stats.rebuildLoadedMs += prototypeNow() - t0;
                        }));
                    }
                }
                rebuildTasks.push(createPrototypeTask("layout.rebuildLoadedSort", () => {
                    const t0 = prototypeNow();
                    state.loadedNodes = state._rebuildLoadedTemp;
                    state._rebuildLoadedTemp = null;
                    if (typeof sortPrototypeLoadedNodes === "function") {
                        sortPrototypeLoadedNodes(state.loadedNodes);
                    }
                    stats.rebuildLoadedMs += prototypeNow() - t0;
                }));
                prependPrototypeTasks(session, rebuildTasks);
            }));
            tasks.push(createPrototypeTask("layout.seamPlan", () => {
                const changedKeys = transition.changedSectionKeys instanceof Set ? transition.changedSectionKeys : new Set();
                if (!(state.seamSegmentsByPairKey instanceof Map)) {
                    state.seamSegmentsByPairKey = new Map();
                }
                // Remove stale entries for changed sections
                for (const [pairKey, segment] of state.seamSegmentsByPairKey.entries()) {
                    if (!segment) continue;
                    if (changedKeys.has(segment._sectionKeyA) || changedKeys.has(segment._sectionKeyB)) {
                        state.seamSegmentsByPairKey.delete(pairKey);
                    }
                }
                // Inject per-section seam scan tasks
                const seamTasks = [];
                for (const sectionKey of changedKeys) {
                    seamTasks.push(createPrototypeTask("layout.seamScanSection", () => {
                        const t0 = prototypeNow();
                        const adjacentDirections = [1, 3, 5, 7, 9, 11];
                        const sectionNodes = state.nodesBySectionKey.get(sectionKey) || [];
                        for (let i = 0; i < sectionNodes.length; i++) {
                            const node = sectionNodes[i];
                            if (!node || node._prototypeSectionActive !== true || !Array.isArray(node.neighbors)) continue;
                            for (let d = 0; d < adjacentDirections.length; d++) {
                                const neighbor = node.neighbors[adjacentDirections[d]];
                                if (!neighbor || neighbor._prototypeSectionActive !== true) continue;
                                if (!neighbor._prototypeSectionKey || neighbor._prototypeSectionKey === node._prototypeSectionKey) continue;
                                const keyA = `${node.xindex},${node.yindex}`;
                                const keyB = `${neighbor.xindex},${neighbor.yindex}`;
                                const pairKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
                                if (state.seamSegmentsByPairKey.has(pairKey)) continue;
                                const dx = Number(neighbor.x) - Number(node.x);
                                const dy = Number(neighbor.y) - Number(node.y);
                                const length = Math.hypot(dx, dy);
                                if (!(length > 1e-6)) continue;
                                const mx = (Number(node.x) + Number(neighbor.x)) * 0.5;
                                const my = (Number(node.y) + Number(neighbor.y)) * 0.5;
                                const nx = -dy / length;
                                const ny = dx / length;
                                const halfSegmentLength = 0.32;
                                state.seamSegmentsByPairKey.set(pairKey, {
                                    x1: mx - nx * halfSegmentLength, y1: my - ny * halfSegmentLength,
                                    x2: mx + nx * halfSegmentLength, y2: my + ny * halfSegmentLength,
                                    _sectionKeyA: node._prototypeSectionKey,
                                    _sectionKeyB: neighbor._prototypeSectionKey
                                });
                            }
                        }
                        stats.seamMs += prototypeNow() - t0;
                    }));
                }
                seamTasks.push(createPrototypeTask("layout.seamCommit", () => {
                    const t0 = prototypeNow();
                    state.seamSegments = Array.from(state.seamSegmentsByPairKey.values()).map((seg) => ({
                        x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2
                    }));
                    stats.seamMs += prototypeNow() - t0;
                }));
                prependPrototypeTasks(session, seamTasks);
            }));
            if (activateKeys.length > 0 && typeof map.applyPrototypeSectionClearance === "function") {
                const clearanceChunkSize = 1200;
                for (let i = 0; i < activateKeys.length; i++) {
                    const sectionKey = activateKeys[i];
                    const sectionNodes = state.nodesBySectionKey.get(sectionKey) || [];
                    for (let startIndex = 0; startIndex < sectionNodes.length; startIndex += clearanceChunkSize) {
                        const chunkStartIndex = startIndex;
                        tasks.push(createPrototypeTask("layout.clearanceChunk", () => {
                            const start = prototypeNow();
                            applyPrototypeSectionClearanceChunk(map, sectionKey, chunkStartIndex, clearanceChunkSize);
                            stats.clearanceMs += prototypeNow() - start;
                        }));
                    }
                }
            }
            tasks.push(createPrototypeTask("layout.finalize", () => {
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
            }));
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
            const getPendingWallSyncSectionKeys = () => {
                const state = map && map._prototypeSectionState;
                const transition = state && state.pendingLayoutTransition;
                if (!transition) return null;
                const keys = Array.isArray(transition.keysToActivate) ? transition.keysToActivate : [];
                return keys.filter((sectionKey) => typeof sectionKey === "string" && sectionKey.length > 0);
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
                    const wallSectionKeys = getPendingWallSyncSectionKeys();
                    enqueuePrototypeAsyncWallSync(asyncSession, wallSectionKeys ? { onlySectionKeys: wallSectionKeys } : undefined);
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
                const wallSectionKeys = getPendingWallSyncSectionKeys();
                enqueuePrototypeAsyncWallSync(asyncSession, wallSectionKeys ? { onlySectionKeys: wallSectionKeys } : undefined);
                this._prototypeBubbleShiftSession = asyncSession;
                advancePrototypeAsyncBubbleShiftSession(asyncSession, options);
                updatePrototypeGpuDebugStats(this);
                return asyncSession;
            };
        };

        return {
            prototypeNow,
            prependPrototypeTasks,
            createPrototypeTask,
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
