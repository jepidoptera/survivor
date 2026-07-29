(function () {
    "use strict";

    function createMazeStreamingSystem(deps) {
        const state = deps && deps.state;
        const worker = deps && deps.worker;
        const constants = deps && deps.constants;
        const wallBuffer = deps && deps.wallBuffer;
        const profiler = deps && deps.profiler;
        const callbacks = deps && deps.callbacks;
        if (!state || typeof state !== "object") {
            throw new Error("Wizard of Flatland maze streaming requires state");
        }
        if (!worker || typeof worker.postMessage !== "function") {
            throw new Error("Wizard of Flatland maze streaming requires a section worker");
        }
        if (
            !constants ||
            !Number.isInteger(constants.MAZE_SECTION_CACHE_LIMIT) ||
            !Number.isInteger(constants.MAZE_SECTION_CACHE_OVERFLOW_LIMIT) ||
            !Number.isFinite(constants.MAZE_SECTION_UNLOAD_HYSTERESIS_MS) ||
            typeof constants.MAZE_WORKER_STATUS_PREFIX !== "string" ||
            !Number.isFinite(constants.TARGET_RADIUS) ||
            !Number.isInteger(constants.WALL_STRIDE)
        ) {
            throw new Error("Wizard of Flatland maze streaming requires constants");
        }
        if (!wallBuffer || typeof wallBuffer.cloneWallBuffer !== "function") {
            throw new Error("Wizard of Flatland maze streaming requires wall buffer helpers");
        }
        if (
            !profiler ||
            typeof profiler.beginLoad !== "function" ||
            typeof profiler.span !== "function" ||
            typeof profiler.mark !== "function"
        ) {
            throw new Error("Wizard of Flatland maze streaming requires profiler hooks");
        }
        if (
            !callbacks ||
            typeof callbacks.isProceduralMazeScenario !== "function" ||
            typeof callbacks.getMazeOptions !== "function" ||
            typeof callbacks.getRequiredMazeSectionKeys !== "function" ||
            typeof callbacks.removeFurthestGeneratedMazeSection !== "function" ||
            typeof callbacks.getPathfindingLayerBounds !== "function" ||
            typeof callbacks.getSavedSectionWallOverrides !== "function" ||
            typeof callbacks.setWorkerStatus !== "function" ||
            typeof callbacks.installGeneratedMazeWorkerResult !== "function"
        ) {
            throw new Error("Wizard of Flatland maze streaming requires lifecycle callbacks");
        }

        function getMazeSignature(options, keys) {
            if (!Array.isArray(state.brokenWallGaps)) {
                throw new Error("Wizard of Flatland maze streaming requires broken wall gap tracking");
            }
            return [
                options.seed,
                options.chunkSize,
                options.roomScale.toFixed(3),
                options.twistiness.toFixed(3),
                keys.join(";"),
                `broken-gaps:${state.brokenWallGaps.length}`
            ].join("|");
        }

        function refreshGeneratedMazeIfNeeded(force = false) {
            if (!callbacks.isProceduralMazeScenario()) return false;
            const options = callbacks.getMazeOptions();
            const requiredKeys = callbacks.getRequiredMazeSectionKeys(options);
            const requiredSet = new Set(requiredKeys);
            const now = performance.now();
            let changed = force;

            if (!(state.generatedMazeChunkKeys instanceof Set)) {
                state.generatedMazeChunkKeys = new Set();
                changed = true;
            }
            if (!(state.generatedMazeSectionLastRequiredAt instanceof Map)) {
                state.generatedMazeSectionLastRequiredAt = new Map();
            }
            for (const key of requiredKeys) {
                state.generatedMazeSectionLastRequiredAt.set(key, now);
                if (state.generatedMazeChunkKeys.has(key)) continue;
                state.generatedMazeChunkKeys.add(key);
                changed = true;
            }
            while (state.generatedMazeChunkKeys.size > constants.MAZE_SECTION_CACHE_LIMIT) {
                const forceEviction = state.generatedMazeChunkKeys.size > constants.MAZE_SECTION_CACHE_OVERFLOW_LIMIT;
                const removed = callbacks.removeFurthestGeneratedMazeSection(options, requiredSet, now, forceEviction);
                if (!removed) break;
                changed = true;
            }

            const keys = Array.from(state.generatedMazeChunkKeys).sort();
            const signature = getMazeSignature(options, keys);
            if (!changed && signature === state.generatedMazeSignature) return false;
            if (!changed && signature === state.generatedMazePendingSignature) return false;

            requestGeneratedMazeRefresh(options, keys, signature);
            return true;
        }

        function requestGeneratedMazeRefresh(options, keys, signature) {
            const bounds = callbacks.getPathfindingLayerBounds();
            const manualWalls = wallBuffer.cloneWallBuffer(state.manualWalls, "manual walls");
            const brokenWallGaps = state.brokenWallGaps.map((gap) => ({ ...gap }));
            const savedSections = callbacks.getSavedSectionWallOverrides(keys);
            if (!Array.isArray(savedSections)) {
                throw new Error("Wizard of Flatland maze streaming requires saved section wall overrides");
            }
            const requestId = state.generatedMazeRequestId++;
            state.generatedMazeActiveRequestId = requestId;
            state.generatedMazePendingSignature = signature;
            state.generatedMazeLoading = true;
            profiler.beginLoad({ requestId, signature, keys });
            callbacks.setWorkerStatus(`${constants.MAZE_WORKER_STATUS_PREFIX} loading`);
            profiler.span("post maze worker request", () => {
                const transfer = [manualWalls.buffer];
                for (const section of savedSections) {
                    if (!section || typeof section.sectionKey !== "string" || !(section.walls instanceof Float32Array)) {
                        throw new Error("Wizard of Flatland maze streaming found an invalid saved section wall override");
                    }
                    transfer.push(section.walls.buffer);
                }
                worker.postMessage({
                    type: "build_maze_sections",
                    requestId,
                    signature,
                    options,
                    keys,
                    manualWalls,
                    savedSections,
                    brokenWallGaps,
                    bounds,
                    targetRadius: constants.TARGET_RADIUS
                }, transfer);
            });
        }

        function handleMazeWorkerMessage(event) {
            const message = event && event.data ? event.data : null;
            if (!message || typeof message.type !== "string") return;
            if (message.type === "ready") return;
            if (message.type === "error") {
                if (Number(message.requestId) !== Number(state.generatedMazeActiveRequestId)) return;
                state.generatedMazeLoading = false;
                callbacks.setWorkerStatus(message.message || "maze error");
                return;
            }
            if (message.type !== "maze_sections_result") return;
            if (Number(message.requestId) !== Number(state.generatedMazeActiveRequestId)) return;
            if (message.signature !== state.generatedMazePendingSignature) return;
            profiler.mark("maze worker result received", {
                generatedWallSegments: message.generatedWalls instanceof Float32Array
                    ? message.generatedWalls.length / constants.WALL_STRIDE
                    : 0,
                nodeCount: message.nodeLayer && message.nodeLayer.nodes instanceof Float32Array
                    ? message.nodeLayer.nodes.length / 4
                    : 0
            });
            callbacks.installGeneratedMazeWorkerResult(message);
        }

        function handleMazeWorkerError(event) {
            state.generatedMazeLoading = false;
            callbacks.setWorkerStatus(event.message || "maze worker failed");
        }

        return Object.freeze({
            getMazeSignature,
            refreshGeneratedMazeIfNeeded,
            requestGeneratedMazeRefresh,
            handleMazeWorkerMessage,
            handleMazeWorkerError
        });
    }

    window.WizardFlatlandMazeStreaming = Object.freeze({
        createMazeStreamingSystem
    });
}());
