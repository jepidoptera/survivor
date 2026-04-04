// debug.js - central debug and instrumentation state

const debugRenderMaxFps = 0; // keep debug uncapped to avoid hidden global frame caps

let debugMode = false; // Toggle all debug graphics (hitboxes, grid, animal markers)
if (typeof globalThis !== "undefined") {
    globalThis.debugMode = debugMode;
}
let showHexGrid = false; // Toggle hex grid only (Ctrl+G)
let showAnimalClearance = false; // Toggle animal clearance hex overlay
let showTileClearance = false; // Toggle per-tile clearance number overlay (requires hex grid on)
let debugModePrevHexGridState = null;

let perfPanel = null;
let showPerfReadout = false;
let perfStats = {
    lastLoopAt: 0,
    fps: 0,
    loopMs: 0,
    drawMs: 0,
    simMs: 0,
    idleMs: 0,
    simSteps: 0,
    lastUiUpdateAt: 0
};
let gpuAssetStats = {
    gauges: {
        prototypeLoadedNodes: 0,
        prototypeRuntimeWalls: 0,
        prototypeRuntimeObjects: 0,
        prototypeRuntimeRoads: 0,
        prototypeRuntimeTrees: 0,
        prototypeRuntimeRoofs: 0,
        prototypeRuntimeAnimals: 0,
        roadCacheTextures: 0,
        roadCacheLimit: 0,
        roadCacheCreates: 0,
        roadCacheEvictions: 0,
        roadCacheDestroyCalls: 0
    },
    peaks: {
        prototypeLoadedNodes: 0,
        prototypeRuntimeWalls: 0,
        prototypeRuntimeObjects: 0,
        prototypeRuntimeRoads: 0,
        prototypeRuntimeTrees: 0,
        prototypeRuntimeRoofs: 0,
        prototypeRuntimeAnimals: 0,
        roadCacheTextures: 0,
        roadCacheCreates: 0,
        roadCacheEvictions: 0,
        roadCacheDestroyCalls: 0
    },
    updatedAtMs: 0
};

function updateGpuAssetTimestamp() {
    gpuAssetStats.updatedAtMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
        ? performance.now()
        : Date.now();
}

function setGpuAssetGauge(name, value) {
    if (typeof name !== "string" || name.length === 0) return 0;
    const nextValue = Math.max(0, toFinitePerfNumber(value, 0));
    gpuAssetStats.gauges[name] = nextValue;
    gpuAssetStats.peaks[name] = Math.max(toFinitePerfNumber(gpuAssetStats.peaks[name], 0), nextValue);
    updateGpuAssetTimestamp();
    return nextValue;
}

function addGpuAssetGauge(name, delta) {
    if (typeof name !== "string" || name.length === 0) return 0;
    const nextValue = Math.max(0, toFinitePerfNumber(gpuAssetStats.gauges[name], 0) + toFinitePerfNumber(delta, 0));
    gpuAssetStats.gauges[name] = nextValue;
    gpuAssetStats.peaks[name] = Math.max(toFinitePerfNumber(gpuAssetStats.peaks[name], 0), nextValue);
    updateGpuAssetTimestamp();
    return nextValue;
}

function getGpuAssetStatsSnapshot() {
    return {
        gauges: { ...gpuAssetStats.gauges },
        peaks: { ...gpuAssetStats.peaks },
        updatedAtMs: toFinitePerfNumber(gpuAssetStats.updatedAtMs, 0)
    };
}

function formatGpuAssetDebugSummary() {
    const gauges = gpuAssetStats.gauges || {};
    const peaks = gpuAssetStats.peaks || {};
    return (
        `\ngpu rt w ${toFinitePerfNumber(gauges.prototypeRuntimeWalls, 0)}` +
        ` o ${toFinitePerfNumber(gauges.prototypeRuntimeObjects, 0)}` +
        ` r ${toFinitePerfNumber(gauges.prototypeRuntimeRoads, 0)}` +
        ` t ${toFinitePerfNumber(gauges.prototypeRuntimeTrees, 0)}` +
        ` rf ${toFinitePerfNumber(gauges.prototypeRuntimeRoofs, 0)}` +
        ` a ${toFinitePerfNumber(gauges.prototypeRuntimeAnimals, 0)}` +
        ` n ${toFinitePerfNumber(gauges.prototypeLoadedNodes, 0)}` +
        `\ngpu rc ${toFinitePerfNumber(gauges.roadCacheTextures, 0)}/${toFinitePerfNumber(gauges.roadCacheLimit, 0)}` +
        ` c ${toFinitePerfNumber(gauges.roadCacheCreates, 0)}` +
        ` e ${toFinitePerfNumber(gauges.roadCacheEvictions, 0)}` +
        ` d ${toFinitePerfNumber(gauges.roadCacheDestroyCalls, 0)}` +
        ` pk ${toFinitePerfNumber(peaks.roadCacheTextures, 0)}`
    );
}

if (typeof globalThis !== "undefined") {
    globalThis.setGpuAssetGauge = setGpuAssetGauge;
    globalThis.addGpuAssetGauge = addGpuAssetGauge;
    globalThis.getGpuAssetStatsSnapshot = getGpuAssetStatsSnapshot;
    globalThis.formatGpuAssetDebugSummary = formatGpuAssetDebugSummary;
}
let simPerfBreakdown = {
    steps: 0,
    totalMs: 0,
    maxStepMs: 0,
    aimSyncMs: 0,
    facingMs: 0,
    movementMs: 0,
    collisionMs: 0,
    pointerPostMs: 0,
    maxAimSyncMs: 0,
    maxFacingMs: 0,
    maxMovementMs: 0,
    maxCollisionMs: 0,
    maxPointerPostMs: 0
};
const PERF_ACCUM_TOP_SPIKES = 10;

function toFinitePerfNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function createPerfAccumulatorState() {
    return {
        enabled: true,
        startedAtMs: (typeof performance !== "undefined" && performance && typeof performance.now === "function")
            ? performance.now()
            : 0,
        lastSampleAtMs: 0,
        samples: 0,
        sums: {
            fps: 0,
            loopMs: 0,
            cpuMs: 0,
            simMs: 0,
            drawMs: 0,
            idleMs: 0,
            simSteps: 0,
            accMs: 0,
            stepMaxMs: 0,
            drawComposeMs: 0,
            drawCollectMs: 0,
            drawLosMs: 0,
            drawPassWorldMs: 0,
            drawPassLosMs: 0,
            drawPassObjectsMs: 0,
            drawPassPostMs: 0,
            drawComposeMaskMs: 0,
            drawComposeSortMs: 0,
            drawComposePopulateMs: 0,
            drawComposeInvariantMs: 0,
            drawComposeWallSectionsMs: 0,
            drawComposeUnaccountedMs: 0
        },
        max: {
            loopMs: { value: -Infinity, sample: 0, atMs: 0 },
            cpuMs: { value: -Infinity, sample: 0, atMs: 0 },
            simMs: { value: -Infinity, sample: 0, atMs: 0 },
            drawMs: { value: -Infinity, sample: 0, atMs: 0 },
            idleMs: { value: -Infinity, sample: 0, atMs: 0 },
            accMs: { value: -Infinity, sample: 0, atMs: 0 },
            stepMaxMs: { value: -Infinity, sample: 0, atMs: 0 },
            drawComposeMs: { value: -Infinity, sample: 0, atMs: 0 },
            drawCollectMs: { value: -Infinity, sample: 0, atMs: 0 },
            drawLosMs: { value: -Infinity, sample: 0, atMs: 0 },
            drawPassWorldMs: { value: -Infinity, sample: 0, atMs: 0 },
            drawPassLosMs: { value: -Infinity, sample: 0, atMs: 0 },
            drawPassObjectsMs: { value: -Infinity, sample: 0, atMs: 0 },
            drawPassPostMs: { value: -Infinity, sample: 0, atMs: 0 },
            drawComposeMaskMs: { value: -Infinity, sample: 0, atMs: 0 },
            drawComposeSortMs: { value: -Infinity, sample: 0, atMs: 0 },
            drawComposePopulateMs: { value: -Infinity, sample: 0, atMs: 0 },
            drawComposeInvariantMs: { value: -Infinity, sample: 0, atMs: 0 },
            drawComposeWallSectionsMs: { value: -Infinity, sample: 0, atMs: 0 },
            drawComposeUnaccountedMs: { value: -Infinity, sample: 0, atMs: 0 }
        },
        min: {
            fps: { value: Infinity, sample: 0, atMs: 0 }
        },
        topSpikes: {
            loopMs: [],
            drawMs: [],
            simMs: [],
            stepMaxMs: [],
            accMs: []
        }
    };
}

let perfAccumulator = createPerfAccumulatorState();

function perfAccumulatorUpdateMax(maxEntry, value, sample, atMs) {
    if (!maxEntry || !Number.isFinite(value)) return;
    if (value > maxEntry.value) {
        maxEntry.value = value;
        maxEntry.sample = sample;
        maxEntry.atMs = atMs;
    }
}

function perfAccumulatorUpdateMin(minEntry, value, sample, atMs) {
    if (!minEntry || !Number.isFinite(value)) return;
    if (value < minEntry.value) {
        minEntry.value = value;
        minEntry.sample = sample;
        minEntry.atMs = atMs;
    }
}

function perfAccumulatorPushSpike(list, entry, limit = PERF_ACCUM_TOP_SPIKES) {
    if (!Array.isArray(list) || !entry || !Number.isFinite(entry.value)) return;
    list.push(entry);
    list.sort((a, b) => {
        if (b.value !== a.value) return b.value - a.value;
        return a.sample - b.sample;
    });
    if (list.length > limit) list.length = limit;
}

function recordPerfAccumulatorSample(sample = {}) {
    if (!perfAccumulator || perfAccumulator.enabled === false) return;
    const nowMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
        ? performance.now()
        : 0;
    const s = perfAccumulator;
    s.samples += 1;
    s.lastSampleAtMs = nowMs;
    const sampleIdx = s.samples;

    const fps = toFinitePerfNumber(sample.fps, 0);
    const loopMs = toFinitePerfNumber(sample.loopMs, 0);
    const cpuMs = toFinitePerfNumber(sample.cpuMs, 0);
    const simMs = toFinitePerfNumber(sample.simMs, 0);
    const drawMs = toFinitePerfNumber(sample.drawMs, 0);
    const idleMs = toFinitePerfNumber(sample.idleMs, 0);
    const simSteps = toFinitePerfNumber(sample.simSteps, 0);
    const accMs = toFinitePerfNumber(sample.accMs, 0);
    const stepMaxMs = toFinitePerfNumber(sample.stepMaxMs, 0);
    const drawComposeMs = toFinitePerfNumber(sample.drawComposeMs, 0);
    const drawCollectMs = toFinitePerfNumber(sample.drawCollectMs, 0);
    const drawLosMs = toFinitePerfNumber(sample.drawLosMs, 0);
    const drawPassWorldMs = toFinitePerfNumber(sample.drawPassWorldMs, 0);
    const drawPassLosMs = toFinitePerfNumber(sample.drawPassLosMs, 0);
    const drawPassObjectsMs = toFinitePerfNumber(sample.drawPassObjectsMs, 0);
    const drawPassPostMs = toFinitePerfNumber(sample.drawPassPostMs, 0);
    const drawComposeMaskMs = toFinitePerfNumber(sample.drawComposeMaskMs, 0);
    const drawComposeSortMs = toFinitePerfNumber(sample.drawComposeSortMs, 0);
    const drawComposePopulateMs = toFinitePerfNumber(sample.drawComposePopulateMs, 0);
    const drawComposeInvariantMs = toFinitePerfNumber(sample.drawComposeInvariantMs, 0);
    const drawComposeWallSectionsMs = toFinitePerfNumber(sample.drawComposeWallSectionsMs, 0);
    const drawComposeUnaccountedMs = toFinitePerfNumber(sample.drawComposeUnaccountedMs, 0);

    s.sums.fps += fps;
    s.sums.loopMs += loopMs;
    s.sums.cpuMs += cpuMs;
    s.sums.simMs += simMs;
    s.sums.drawMs += drawMs;
    s.sums.idleMs += idleMs;
    s.sums.simSteps += simSteps;
    s.sums.accMs += accMs;
    s.sums.stepMaxMs += stepMaxMs;
    s.sums.drawComposeMs += drawComposeMs;
    s.sums.drawCollectMs += drawCollectMs;
    s.sums.drawLosMs += drawLosMs;
    s.sums.drawPassWorldMs += drawPassWorldMs;
    s.sums.drawPassLosMs += drawPassLosMs;
    s.sums.drawPassObjectsMs += drawPassObjectsMs;
    s.sums.drawPassPostMs += drawPassPostMs;
    s.sums.drawComposeMaskMs += drawComposeMaskMs;
    s.sums.drawComposeSortMs += drawComposeSortMs;
    s.sums.drawComposePopulateMs += drawComposePopulateMs;
    s.sums.drawComposeInvariantMs += drawComposeInvariantMs;
    s.sums.drawComposeWallSectionsMs += drawComposeWallSectionsMs;
    s.sums.drawComposeUnaccountedMs += drawComposeUnaccountedMs;

    perfAccumulatorUpdateMax(s.max.loopMs, loopMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.cpuMs, cpuMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.simMs, simMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.drawMs, drawMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.idleMs, idleMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.accMs, accMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.stepMaxMs, stepMaxMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.drawComposeMs, drawComposeMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.drawCollectMs, drawCollectMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.drawLosMs, drawLosMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.drawPassWorldMs, drawPassWorldMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.drawPassLosMs, drawPassLosMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.drawPassObjectsMs, drawPassObjectsMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.drawPassPostMs, drawPassPostMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.drawComposeMaskMs, drawComposeMaskMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.drawComposeSortMs, drawComposeSortMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.drawComposePopulateMs, drawComposePopulateMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.drawComposeInvariantMs, drawComposeInvariantMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.drawComposeWallSectionsMs, drawComposeWallSectionsMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMax(s.max.drawComposeUnaccountedMs, drawComposeUnaccountedMs, sampleIdx, nowMs);
    perfAccumulatorUpdateMin(s.min.fps, fps, sampleIdx, nowMs);

    perfAccumulatorPushSpike(s.topSpikes.loopMs, { value: loopMs, sample: sampleIdx, atMs: nowMs });
    perfAccumulatorPushSpike(s.topSpikes.drawMs, { value: drawMs, sample: sampleIdx, atMs: nowMs });
    perfAccumulatorPushSpike(s.topSpikes.simMs, { value: simMs, sample: sampleIdx, atMs: nowMs });
    perfAccumulatorPushSpike(s.topSpikes.stepMaxMs, { value: stepMaxMs, sample: sampleIdx, atMs: nowMs });
    perfAccumulatorPushSpike(s.topSpikes.accMs, { value: accMs, sample: sampleIdx, atMs: nowMs });
}

function cloneTopSpikes(spikes) {
    if (!Array.isArray(spikes)) return [];
    return spikes.map(entry => ({
        value: toFinitePerfNumber(entry && entry.value, 0),
        sample: toFinitePerfNumber(entry && entry.sample, 0),
        atMs: toFinitePerfNumber(entry && entry.atMs, 0)
    }));
}

function cloneExtremeEntry(entry) {
    if (!entry) return null;
    const value = toFinitePerfNumber(entry.value, 0);
    return {
        value,
        sample: toFinitePerfNumber(entry.sample, 0),
        atMs: toFinitePerfNumber(entry.atMs, 0)
    };
}

function getPerfAccumulatorSnapshot() {
    const s = perfAccumulator;
    if (!s) return null;
    const n = Math.max(1, toFinitePerfNumber(s.samples, 0));
    const elapsedMs = Math.max(0, toFinitePerfNumber(s.lastSampleAtMs, 0) - toFinitePerfNumber(s.startedAtMs, 0));
    return {
        enabled: s.enabled !== false,
        samples: toFinitePerfNumber(s.samples, 0),
        elapsedMs,
        averages: {
            fps: s.sums.fps / n,
            loopMs: s.sums.loopMs / n,
            cpuMs: s.sums.cpuMs / n,
            simMs: s.sums.simMs / n,
            drawMs: s.sums.drawMs / n,
            idleMs: s.sums.idleMs / n,
            simSteps: s.sums.simSteps / n,
            accMs: s.sums.accMs / n,
            stepMaxMs: s.sums.stepMaxMs / n,
            drawComposeMs: s.sums.drawComposeMs / n,
            drawCollectMs: s.sums.drawCollectMs / n,
            drawLosMs: s.sums.drawLosMs / n,
            drawPassWorldMs: s.sums.drawPassWorldMs / n,
            drawPassLosMs: s.sums.drawPassLosMs / n,
            drawPassObjectsMs: s.sums.drawPassObjectsMs / n,
            drawPassPostMs: s.sums.drawPassPostMs / n,
            drawComposeMaskMs: s.sums.drawComposeMaskMs / n,
            drawComposeSortMs: s.sums.drawComposeSortMs / n,
            drawComposePopulateMs: s.sums.drawComposePopulateMs / n,
            drawComposeInvariantMs: s.sums.drawComposeInvariantMs / n,
            drawComposeWallSectionsMs: s.sums.drawComposeWallSectionsMs / n,
            drawComposeUnaccountedMs: s.sums.drawComposeUnaccountedMs / n
        },
        worst: {
            max: {
                loopMs: cloneExtremeEntry(s.max.loopMs),
                cpuMs: cloneExtremeEntry(s.max.cpuMs),
                simMs: cloneExtremeEntry(s.max.simMs),
                drawMs: cloneExtremeEntry(s.max.drawMs),
                idleMs: cloneExtremeEntry(s.max.idleMs),
                accMs: cloneExtremeEntry(s.max.accMs),
                stepMaxMs: cloneExtremeEntry(s.max.stepMaxMs),
                drawComposeMs: cloneExtremeEntry(s.max.drawComposeMs),
                drawCollectMs: cloneExtremeEntry(s.max.drawCollectMs),
                drawLosMs: cloneExtremeEntry(s.max.drawLosMs),
                drawPassWorldMs: cloneExtremeEntry(s.max.drawPassWorldMs),
                drawPassLosMs: cloneExtremeEntry(s.max.drawPassLosMs),
                drawPassObjectsMs: cloneExtremeEntry(s.max.drawPassObjectsMs),
                drawPassPostMs: cloneExtremeEntry(s.max.drawPassPostMs),
                drawComposeMaskMs: cloneExtremeEntry(s.max.drawComposeMaskMs),
                drawComposeSortMs: cloneExtremeEntry(s.max.drawComposeSortMs),
                drawComposePopulateMs: cloneExtremeEntry(s.max.drawComposePopulateMs),
                drawComposeInvariantMs: cloneExtremeEntry(s.max.drawComposeInvariantMs),
                drawComposeWallSectionsMs: cloneExtremeEntry(s.max.drawComposeWallSectionsMs),
                drawComposeUnaccountedMs: cloneExtremeEntry(s.max.drawComposeUnaccountedMs)
            },
            min: {
                fps: cloneExtremeEntry(s.min.fps)
            }
        },
        topSpikes: {
            loopMs: cloneTopSpikes(s.topSpikes.loopMs),
            drawMs: cloneTopSpikes(s.topSpikes.drawMs),
            simMs: cloneTopSpikes(s.topSpikes.simMs),
            stepMaxMs: cloneTopSpikes(s.topSpikes.stepMaxMs),
            accMs: cloneTopSpikes(s.topSpikes.accMs)
        }
    };
}

function resetPerfAccumulator() {
    perfAccumulator = createPerfAccumulatorState();
    return getPerfAccumulatorSnapshot();
}

function printPerfAccumulator(options = {}) {
    const resetAfter = !!(options && options.resetAfter);
    const snapshot = getPerfAccumulatorSnapshot();
    if (!snapshot) return null;
    const avg = snapshot.averages;
    const worst = snapshot.worst;
    console.groupCollapsed(
        `[PerfAccumulator] samples=${snapshot.samples} elapsed=${(snapshot.elapsedMs / 1000).toFixed(2)}s`
    );
    console.table([{
        fps_avg: avg.fps.toFixed(2),
        fps_min: worst.min.fps ? Number(worst.min.fps.value).toFixed(2) : "0.00",
        loop_avg_ms: avg.loopMs.toFixed(2),
        loop_max_ms: worst.max.loopMs ? Number(worst.max.loopMs.value).toFixed(2) : "0.00",
        cpu_avg_ms: avg.cpuMs.toFixed(2),
        draw_avg_ms: avg.drawMs.toFixed(2),
        sim_avg_ms: avg.simMs.toFixed(2),
        acc_avg_ms: avg.accMs.toFixed(2),
        acc_max_ms: worst.max.accMs ? Number(worst.max.accMs.value).toFixed(2) : "0.00",
        stepmx_avg_ms: avg.stepMaxMs.toFixed(2),
        stepmx_max_ms: worst.max.stepMaxMs ? Number(worst.max.stepMaxMs.value).toFixed(2) : "0.00",
        pass_world_avg_ms: avg.drawPassWorldMs.toFixed(2),
        pass_los_avg_ms: avg.drawPassLosMs.toFixed(2),
        pass_obj_avg_ms: avg.drawPassObjectsMs.toFixed(2),
        pass_post_avg_ms: avg.drawPassPostMs.toFixed(2),
        cmp_sort_avg_ms: avg.drawComposeSortMs.toFixed(2),
        cmp_pop_avg_ms: avg.drawComposePopulateMs.toFixed(2),
        cmp_inv_avg_ms: avg.drawComposeInvariantMs.toFixed(2),
        cmp_inv_max_ms: worst.max.drawComposeInvariantMs ? Number(worst.max.drawComposeInvariantMs.value).toFixed(2) : "0.00",
        cmp_ws_avg_ms: avg.drawComposeWallSectionsMs.toFixed(2),
        cmp_ws_max_ms: worst.max.drawComposeWallSectionsMs ? Number(worst.max.drawComposeWallSectionsMs.value).toFixed(2) : "0.00",
        cmp_un_avg_ms: avg.drawComposeUnaccountedMs.toFixed(2),
        cmp_un_max_ms: worst.max.drawComposeUnaccountedMs ? Number(worst.max.drawComposeUnaccountedMs.value).toFixed(2) : "0.00"
    }]);
    console.log("Top loop spikes (ms):", snapshot.topSpikes.loopMs);
    console.log("Top draw spikes (ms):", snapshot.topSpikes.drawMs);
    console.log("Top sim spikes (ms):", snapshot.topSpikes.simMs);
    console.log("Top stepmx spikes (ms):", snapshot.topSpikes.stepMaxMs);
    console.log("Top acc spikes (ms):", snapshot.topSpikes.accMs);
    console.log("Full snapshot object:", snapshot);
    console.groupEnd();
    if (resetAfter) resetPerfAccumulator();
    return snapshot;
}

let lastDebugWizardPos = {x: -1, y: -1};
let lastDebugOverlayUpdateMs = 0;
let debugOverlayDirty = true;
const debugOverlayMinIntervalMs = 1000 / 30;
let debugOverlayPhase = 0;

let mapBorderGraphics = null;
let losDebugGraphics = null;
let losDebugState = null;

let losDebugFillEnabled = false;
const losSettings = (typeof LOSVisualSettings !== "undefined" && LOSVisualSettings)
    ? LOSVisualSettings
    : (typeof globalThis !== "undefined"
        ? (globalThis.LOSVisualSettings = globalThis.LOSVisualSettings || {
            shadowEnabled: true,
            groundMaskEnabled: false,
            shadowOpacity: 0.4,
            shadowColor: 0x777777,
            shadowBlurEnabled: true,
            shadowBlurStrength: 12,
            mazeMode: false,
            objectLitTransparencyEnabled: true,
            objectLitAlpha: 0.5,
            objectLitMaskDebugOnly: false,
            objectLitMaskPreview: false,
            maxDarken: 0.5,
            forwardFovDegrees: 200
        })
        : {
            shadowEnabled: true,
            groundMaskEnabled: false,
            shadowOpacity: 0.4,
            shadowColor: 0x777777,
            shadowBlurEnabled: true,
            shadowBlurStrength: 12,
            mazeMode: false,
            objectLitTransparencyEnabled: true,
            objectLitAlpha: 0.5,
            objectLitMaskDebugOnly: false,
            objectLitMaskPreview: false,
            maxDarken: 0.5,
            forwardFovDegrees: 200
        });

let cameraForwardLeadRatio = 0.0;
let cameraFollowSmoothing = 0.0; // 0.025;

const debugUseLodNativePixelSize = false;
const debugViewSettings = {
    // Show only non-visual debug hitboxes by default.
    showVisualHitboxes: false
};

function updatePerfPanelVisibility() {
    if (!perfPanel) return;
    perfPanel.css("display", showPerfReadout ? "block" : "none");
}

function setShowPerfReadout(enabled) {
    showPerfReadout = !!enabled;
    updatePerfPanelVisibility();
}

function toggleShowPerfReadout() {
    setShowPerfReadout(!showPerfReadout);
    return showPerfReadout;
}

function toggleDebugMode() {
    debugMode = !debugMode;
    if (debugMode) {
        debugModePrevHexGridState = showHexGrid;
        showHexGrid = true;
    } else if (debugModePrevHexGridState !== null) {
        showHexGrid = !!debugModePrevHexGridState;
        debugModePrevHexGridState = null;
    }
    if (typeof globalThis !== "undefined") {
        globalThis.debugMode = debugMode;
    }
    return debugMode;
}

function toggleHexGrid() {
    showHexGrid = !showHexGrid;
    return showHexGrid;
}

if (typeof globalThis !== "undefined") {
    const debugView = {
        settings: debugViewSettings,
        toggleDebugMode: () => toggleDebugMode(),
        toggleHexGrid: () => toggleHexGrid(),
        togglePerfReadout: () => toggleShowPerfReadout(),
        toggleVisualHitboxes: () => {
            debugViewSettings.showVisualHitboxes = !debugViewSettings.showVisualHitboxes;
            return debugViewSettings.showVisualHitboxes;
        },
        setVisualHitboxesVisible: visible => {
            debugViewSettings.showVisualHitboxes = !!visible;
            return debugViewSettings.showVisualHitboxes;
        },
        toggleAnimalClearance: () => {
            showAnimalClearance = !showAnimalClearance;
            return showAnimalClearance;
        }
    };
    globalThis.DebugView = debugView;
    globalThis.recordPerfAccumulatorSample = recordPerfAccumulatorSample;
    globalThis.getPerfAccumulatorSnapshot = getPerfAccumulatorSnapshot;
    globalThis.resetPerfAccumulator = resetPerfAccumulator;
    globalThis.printPerfAccumulator = printPerfAccumulator;
}

if (typeof globalThis !== "undefined" && typeof globalThis.setLosDebugFillEnabled !== "function") {
    globalThis.setLosDebugFillEnabled = function setLosDebugFillEnabled(enabled) {
        losDebugFillEnabled = !!enabled;
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosGroundMaskEnabled !== "function") {
    globalThis.setLosGroundMaskEnabled = function setLosGroundMaskEnabled(enabled) {
        losSettings.groundMaskEnabled = !!enabled;
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosShadowEnabled !== "function") {
    globalThis.setLosShadowEnabled = function setLosShadowEnabled(enabled) {
        losSettings.shadowEnabled = !!enabled;
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosShadowOpacity !== "function") {
    globalThis.setLosShadowOpacity = function setLosShadowOpacity(alpha) {
        const value = Number(alpha);
        if (!Number.isFinite(value)) return;
        losSettings.shadowOpacity = Math.max(0, Math.min(1, value));
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosShadowColor !== "function") {
    globalThis.setLosShadowColor = function setLosShadowColor(color) {
        const value = Number(color);
        if (!Number.isFinite(value)) return;
        losSettings.shadowColor = Math.max(0, Math.min(0xffffff, Math.floor(value)));
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosShadowBlurEnabled !== "function") {
    globalThis.setLosShadowBlurEnabled = function setLosShadowBlurEnabled(enabled) {
        losSettings.shadowBlurEnabled = !!enabled;
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosShadowBlurStrength !== "function") {
    globalThis.setLosShadowBlurStrength = function setLosShadowBlurStrength(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        losSettings.shadowBlurStrength = Math.max(0, n);
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosMazeModeEnabled !== "function") {
    globalThis.setLosMazeModeEnabled = function setLosMazeModeEnabled(enabled) {
        losSettings.mazeMode = !!enabled;
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosObjectLitTransparencyEnabled !== "function") {
    globalThis.setLosObjectLitTransparencyEnabled = function setLosObjectLitTransparencyEnabled(enabled) {
        losSettings.objectLitTransparencyEnabled = !!enabled;
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosObjectLitAlpha !== "function") {
    globalThis.setLosObjectLitAlpha = function setLosObjectLitAlpha(alpha) {
        const value = Number(alpha);
        if (!Number.isFinite(value)) return;
        losSettings.objectLitAlpha = Math.max(0, Math.min(1, value));
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosMaxDarken !== "function") {
    globalThis.setLosMaxDarken = function setLosMaxDarken(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        losSettings.maxDarken = Math.max(0, Math.min(1, n));
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setLosForwardFovDegrees !== "function") {
    globalThis.setLosForwardFovDegrees = function setLosForwardFovDegrees(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        losSettings.forwardFovDegrees = Math.max(0, Math.min(360, n));
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setCameraForwardLeadRatio !== "function") {
    globalThis.setCameraForwardLeadRatio = function setCameraForwardLeadRatio(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        cameraForwardLeadRatio = Math.max(0, Math.min(0.8, n));
    };
}
if (typeof globalThis !== "undefined" && typeof globalThis.setCameraFollowSmoothing !== "function") {
    globalThis.setCameraFollowSmoothing = function setCameraFollowSmoothing(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        cameraFollowSmoothing = Math.max(0, Math.min(1, n));
    };
}

function getDebugRedrawPlan() {
    return { hex: true, ground: true, hit: true, boundary: true };
}

function drawMapBorder() {
    if (!gameContainer || !map) return;
    if (!mapBorderGraphics) {
        mapBorderGraphics = new PIXI.Graphics();
        mapBorderGraphics.interactive = false;
        gameContainer.addChild(mapBorderGraphics);
    }
    mapBorderGraphics.clear();

    const worldWidth = Number.isFinite(map.worldWidth) ? map.worldWidth : map.width;
    const worldHeight = Number.isFinite(map.worldHeight) ? map.worldHeight : map.height;
    if (!(worldWidth > 0) || !(worldHeight > 0)) return;

    const camera = viewport;

    const worldToScreenRaw = (x, y) => ({
        x: (x - camera.x) * viewscale,
        y: (y - camera.y) * viewscale * xyratio
    });
    const topLeft = worldToScreenRaw(0, 0);
    const topRight = worldToScreenRaw(worldWidth, 0);
    const bottomRight = worldToScreenRaw(worldWidth, worldHeight);
    const bottomLeft = worldToScreenRaw(0, worldHeight);

    const dash = 2;
    const gap = 7;
    const drawDashed = (a, b) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len <= 1e-6) return;
        const ux = dx / len;
        const uy = dy / len;
        let t = 0;
        while (t < len) {
            const start = t;
            const end = Math.min(len, t + dash);
            mapBorderGraphics.moveTo(a.x + ux * start, a.y + uy * start);
            mapBorderGraphics.lineTo(a.x + ux * end, a.y + uy * end);
            t += dash + gap;
        }
    };

    mapBorderGraphics.lineStyle(2, 0xffffff, 0.85);
    drawDashed(topLeft, topRight);
    drawDashed(topRight, bottomRight);
    drawDashed(bottomRight, bottomLeft);
    drawDashed(bottomLeft, topLeft);
}

function drawLosDebug(redraw = true) {
    if (!debugMode || !wizard) {
        if (losDebugGraphics) losDebugGraphics.visible = false;
        losDebugState = null;
        return;
    }
    if (!redraw) return;
    if (!losDebugGraphics) {
        losDebugGraphics = new PIXI.Graphics();
        hitboxLayer.addChild(losDebugGraphics);
    }
    losDebugGraphics.visible = true;
    losDebugGraphics.clear();
    losDebugState = currentLosState;
    if (!losDebugState || !losDebugState.depth || !losDebugState.owner || losDebugState.owner.length < 3) return;
    if (!LOSSystem || typeof LOSSystem.buildPolygonWorldPoints !== "function") return;
    const farDist = Math.max(viewport.width, viewport.height) * 1.5;
    const worldPoints = LOSSystem.buildPolygonWorldPoints(wizard, losDebugState, farDist);
    const screenPoints = worldPoints.map(pt => worldToScreen(pt));
    if (screenPoints.length < 3) return;

    losDebugGraphics.lineStyle(2, 0x000000, 0.9);
    if (losDebugFillEnabled) {
        losDebugGraphics.beginFill(0x000000, 0.12);
    }
    losDebugGraphics.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (let i = 1; i < screenPoints.length; i++) {
        losDebugGraphics.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    losDebugGraphics.closePath();
    if (losDebugFillEnabled) {
        losDebugGraphics.endFill();
    }
}

function drawHexGrid(redraw = true) {
    if (!showHexGrid && !debugMode) {
        if (gridGraphics) gridGraphics.visible = false;
        return;
    }
    if (!redraw) return;

    if (!gridGraphics) {
        gridGraphics = new PIXI.Graphics();
        gridLayer.addChild(gridGraphics);
    }
    gridGraphics.visible = true;
    gridGraphics.clear();

    const hexWidth = map.hexWidth * viewscale;
    const hexHeight = map.hexHeight * viewscale * xyratio;
    const halfW = hexWidth / 2;
    const quarterW = hexWidth / 4;
    const halfH = hexHeight / 2;

    const xPadding = 2;
    const yPadding = 2;
    const xScale = 0.866;
    const rawXStart = Math.floor(viewport.x / xScale) - xPadding;
    const rawXEnd = Math.ceil((viewport.x + viewport.width) / xScale) + xPadding;
    const rawYStart = Math.floor(viewport.y) - yPadding;
    const rawYEnd = Math.ceil(viewport.y + viewport.height) + yPadding;
    const xRanges = getWrappedIndexRanges(rawXStart, rawXEnd, map.width, map.wrapX);
    const yRanges = getWrappedIndexRanges(rawYStart, rawYEnd, map.height, map.wrapY);
    if (xRanges.length === 0 || yRanges.length === 0) return;

    const animalTiles = new Set();
    animals.forEach(animal => {
        if (!animal || animal.gone || animal.dead) return;
        const node = map.worldToNode(animal.x, animal.y);
        if (!node) return;
        animalTiles.add(`${node.xindex},${node.yindex}`);
    });

    yRanges.forEach(yRange => {
        for (let y = yRange.start; y <= yRange.end; y++) {
            xRanges.forEach(xRange => {
                for (let x = xRange.start; x <= xRange.end; x++) {
                    if (!map.nodes[x] || !map.nodes[x][y]) continue;
                    const node = map.nodes[x][y];
                    const screenCoors = worldToScreen(node);
                    const centerX = screenCoors.x;
                    const centerY = screenCoors.y;

                    const isBlocked = node.hasBlockingObject() || !!node.blocked;
                    const hasAnimal = debugMode && animalTiles.has(`${x},${y}`);
                    const color = isBlocked ? 0xff0000 : 0xffffff;
                    const alpha = isBlocked ? 0.5 : 0.35;
                    if (hasAnimal) {
                        gridGraphics.beginFill(0x3399ff, 0.25);
                        gridGraphics.moveTo(centerX - halfW, centerY);
                        gridGraphics.lineTo(centerX - quarterW, centerY - halfH);
                        gridGraphics.lineTo(centerX + quarterW, centerY - halfH);
                        gridGraphics.lineTo(centerX + halfW, centerY);
                        gridGraphics.lineTo(centerX + quarterW, centerY + halfH);
                        gridGraphics.lineTo(centerX - quarterW, centerY + halfH);
                        gridGraphics.closePath();
                        gridGraphics.endFill();
                    }

                    gridGraphics.lineStyle(1, color, alpha);
                    gridGraphics.moveTo(centerX - halfW, centerY);
                    gridGraphics.lineTo(centerX - quarterW, centerY - halfH);
                    gridGraphics.lineTo(centerX + quarterW, centerY - halfH);
                    gridGraphics.lineTo(centerX + halfW, centerY);
                    gridGraphics.lineTo(centerX + quarterW, centerY + halfH);
                    gridGraphics.lineTo(centerX - quarterW, centerY + halfH);
                    gridGraphics.closePath();
                }
            });
        }
    });

}

function drawGroundPlaneHitboxes(redraw = true) {
    if (!debugMode) {
        if (groundPlaneHitboxGraphics) groundPlaneHitboxGraphics.visible = false;
        return;
    }
    if (!redraw) return;

    if (!groundPlaneHitboxGraphics) {
        groundPlaneHitboxGraphics = new PIXI.Graphics();
        hitboxLayer.addChild(groundPlaneHitboxGraphics);
    }
    groundPlaneHitboxGraphics.visible = true;
    groundPlaneHitboxGraphics.clear();

    const { topLeftNode, bottomRightNode } = getViewportNodeCorners();
    if (!topLeftNode || !bottomRightNode) return;

    const yStart = Math.max(topLeftNode.yindex - 2, 0);
    const yEnd = Math.min(bottomRightNode.yindex + 3, mapHeight - 1);
    const xStart = Math.max(topLeftNode.xindex - 2, 0);
    const xEnd = Math.min(bottomRightNode.xindex + 2, mapWidth - 1);
    const objectsWithGroundHitboxes = new Set();

    for (let y = yStart; y <= yEnd; y++) {
        for (let x = xStart; x <= xEnd; x++) {
            if (!map.nodes[x] || !map.nodes[x][y]) continue;
            const node = map.nodes[x][y];
            if (node.objects && node.objects.length > 0) {
                node.objects.forEach(obj => {
                    if (obj.groundPlaneHitbox) {
                        objectsWithGroundHitboxes.add(obj);
                    }
                });
            }
        }
    }

    if (wizard && wizard.groundPlaneHitbox) {
        objectsWithGroundHitboxes.add(wizard);
    }

    animals.forEach(animal => {
        if (animal && !animal.dead && !animal.gone && !animal.vanishing && animal._onScreen && animal.groundPlaneHitbox) {
            objectsWithGroundHitboxes.add(animal);
        }
    });

    objectsWithGroundHitboxes.forEach(obj => {
        const hitbox = obj.groundPlaneHitbox;
        const isWindow = (
            obj &&
            (obj.isPlacedObject || obj.objectType === "placedObject" || obj.type === "placedObject") &&
            typeof obj.category === "string" &&
            obj.category.trim().toLowerCase() === "windows"
        );
        groundPlaneHitboxGraphics.lineStyle(2, isWindow ? 0xff00aa : 0x000000, 0.8);

        if (hitbox instanceof CircleHitbox) {
            const center = worldToScreen({x: hitbox.x, y: hitbox.y});
            const radiusX = hitbox.radius * viewscale;
            const radiusY = hitbox.radius * viewscale * xyratio;
            groundPlaneHitboxGraphics.drawEllipse(center.x, center.y, radiusX, radiusY);
        } else if (hitbox instanceof PolygonHitbox) {
            const screenPoints = hitbox.points.map(v => worldToScreen(v));
            if (screenPoints.length > 0) {
                groundPlaneHitboxGraphics.moveTo(screenPoints[0].x, screenPoints[0].y);
                for (let i = 1; i < screenPoints.length; i++) {
                    groundPlaneHitboxGraphics.lineTo(screenPoints[i].x, screenPoints[i].y);
                }
                groundPlaneHitboxGraphics.closePath();
            }
        }
    });
}

function drawHitboxes(redraw = true) {
    if (!debugMode) {
        if (hitboxGraphics) hitboxGraphics.visible = false;
        return;
    }
    if (!redraw) return;

    if (!hitboxGraphics) {
        hitboxGraphics = new PIXI.Graphics();
        hitboxLayer.addChild(hitboxGraphics);
    }
    hitboxGraphics.visible = true;
    hitboxGraphics.clear();
    const showVisualHitboxes = !(debugViewSettings && debugViewSettings.showVisualHitboxes === false);

    projectiles.forEach(ball => {
        if (!ball.visible || !ball.radius) return;
        const ballCoors = worldToScreen(ball);
        const radiusPx = ball.radius * viewscale;
        hitboxGraphics.lineStyle(2, 0xffaa00, 0.9);
        hitboxGraphics.drawCircle(ballCoors.x, ballCoors.y, radiusPx);
    });

    animals.forEach(animal => {
        if (!animal || animal.dead || animal.gone || animal.vanishing || !animal._onScreen) return;
        const animalCoors = worldToScreen(animal);
        const radiusPx = (animal.radius || 0.35) * viewscale;
        hitboxGraphics.lineStyle(2, 0x00ff66, 0.9);
        hitboxGraphics.drawCircle(animalCoors.x, animalCoors.y, radiusPx);
    });

    hitboxGraphics.lineStyle(2, 0x33cc33, 0.9);
    const { topLeftNode, bottomRightNode } = getViewportNodeCorners();
    if (topLeftNode && bottomRightNode) {
        if (showVisualHitboxes && onscreenObjects.size > 0) {
            onscreenObjects.forEach((obj) => {
                if (!obj) return;
                const hitbox = obj.visualHitbox || obj.hitbox;
                if (!hitbox) return;

                if (hitbox instanceof PolygonHitbox) {
                    hitboxGraphics.lineStyle(2, 0x33cc33, 0.9);
                    const points = hitbox.points;
                    if (!points || points.length === 0) return;
                    const screenPoints = points.map(p => (worldToScreen({x: p.x, y: p.y})));
                    const flatPoints = screenPoints.flatMap(p => [p.x, p.y]);
                    hitboxGraphics.drawPolygon(flatPoints);
                } else if (hitbox instanceof CircleHitbox) {
                    const center = worldToScreen({x: hitbox.x, y: hitbox.y});
                    const radiusPx = hitbox.radius * viewscale;
                    hitboxGraphics.lineStyle(2, 0x33cc33, 0.9);
                    hitboxGraphics.drawCircle(center.x, center.y, radiusPx);
                }
            });
        }
    }

    const drawDebugHitboxShape = (hitbox, color = 0xffffff, alpha = 0.95) => {
        if (!hitbox) return false;
        const isCircle = (
            hitbox.type === "circle" &&
            Number.isFinite(hitbox.x) &&
            Number.isFinite(hitbox.y) &&
            Number.isFinite(hitbox.radius)
        );
        if (isCircle) {
            const center = worldToScreen({x: hitbox.x, y: hitbox.y});
            hitboxGraphics.lineStyle(2, color, alpha);
            hitboxGraphics.drawCircle(center.x, center.y, hitbox.radius * viewscale);
            return true;
        }

        const points = Array.isArray(hitbox.points) ? hitbox.points : null;
        if (points && points.length > 1) {
            const flatPoints = points
                .map(p => worldToScreen({x: p.x, y: p.y}))
                .flatMap(p => [p.x, p.y]);
            hitboxGraphics.lineStyle(2, color, alpha);
            hitboxGraphics.drawPolygon(flatPoints);
            return true;
        }
        return false;
    };

    if (wizard) {
        if (showVisualHitboxes) {
            drawDebugHitboxShape(wizard.visualHitbox, 0x00ffff, 0.95);
        }
        drawDebugHitboxShape(wizard.groundPlaneHitbox, 0xffffff, 0.95);

        if (Number.isFinite(wizard.x) && Number.isFinite(wizard.y)) {
            const center = worldToScreen({x: wizard.x, y: wizard.y});
            hitboxGraphics.lineStyle(2, 0xff00ff, 0.95);
            hitboxGraphics.moveTo(center.x - 8, center.y);
            hitboxGraphics.lineTo(center.x + 8, center.y);
            hitboxGraphics.moveTo(center.x, center.y - 8);
            hitboxGraphics.lineTo(center.x, center.y + 8);
        }
    }

    if (onscreenObjects && onscreenObjects.size > 0) {
        onscreenObjects.forEach(obj => {
            if (!obj || obj.type !== "firewall") return;
            const fireHitbox = showVisualHitboxes
                ? (obj.visualHitbox || obj.groundPlaneHitbox || obj.hitbox)
                : (obj.groundPlaneHitbox || obj.hitbox);
            drawDebugHitboxShape(fireHitbox, 0xff3300, 0.95);
        });
    }
}

function drawWizardBoundaries(redraw = true) {
    if (!debugMode || !wizard) {
        if (wizardBoundaryGraphics) wizardBoundaryGraphics.visible = false;
        return;
    }
    if (!redraw) return;

    if (!wizardBoundaryGraphics) {
        wizardBoundaryGraphics = new PIXI.Graphics();
        hitboxLayer.addChild(wizardBoundaryGraphics);
    }

    wizardBoundaryGraphics.visible = true;
    wizardBoundaryGraphics.clear();

    const touchingTiles = wizard.getTouchingTiles();
    if (touchingTiles && touchingTiles.size > 0) {
        const hexWidth = map.hexWidth * viewscale;
        const hexHeight = map.hexHeight * viewscale * xyratio;
        const halfW = hexWidth / 2;
        const quarterW = hexWidth / 4;
        const halfH = hexHeight / 2;

        wizardBoundaryGraphics.beginFill(0x000000, 0.25);
        touchingTiles.forEach(tileKey => {
            const [xindex, yindex] = tileKey.split(',').map(Number);
            const node = map.nodes[xindex] && map.nodes[xindex][yindex];
            if (!node) return;
            const screenCoors = worldToScreen(node);
            const centerX = screenCoors.x;
            const centerY = screenCoors.y;
            wizardBoundaryGraphics.moveTo(centerX - halfW, centerY);
            wizardBoundaryGraphics.lineTo(centerX - quarterW, centerY - halfH);
            wizardBoundaryGraphics.lineTo(centerX + quarterW, centerY - halfH);
            wizardBoundaryGraphics.lineTo(centerX + halfW, centerY);
            wizardBoundaryGraphics.lineTo(centerX + quarterW, centerY + halfH);
            wizardBoundaryGraphics.lineTo(centerX - quarterW, centerY + halfH);
            wizardBoundaryGraphics.closePath();
        });
        wizardBoundaryGraphics.endFill();
    }
}

// --- Tile clearance number overlay (shown when hex grid is on) ---
let _tileClearanceContainer = null;
let _tileClearanceTexts = [];

/**
 * Draw the clearance number on every visible tile when the hex grid overlay
 * is active.  Temporary debug aid for maze pathfinding.
 * @param {PIXI.Container} layer  - ground layer to attach to
 * @param {object} cam             - camera with viewscale, xyratio, worldToScreen, x, y
 */
function drawTileClearanceNumbers(layer, cam) {
    if (!showTileClearance || !showHexGrid) {
        if (_tileClearanceContainer) _tileClearanceContainer.visible = false;
        return;
    }
    if (!layer || !cam) return;

    const mapRef = (typeof map !== "undefined") ? map : null;
    if (!mapRef || !mapRef.nodes) return;

    const vs = cam.viewscale;
    const vsy = cam.viewscale * cam.xyratio;
    if (vs <= 0 || vsy <= 0) return;

    // Lazy-create container
    if (!_tileClearanceContainer) {
        _tileClearanceContainer = new PIXI.Container();
        _tileClearanceContainer.name = "tileClearanceOverlay";
        _tileClearanceContainer.interactiveChildren = false;
        _tileClearanceContainer.zIndex = Number.MAX_SAFE_INTEGER;
        layer.addChild(_tileClearanceContainer);
    } else if (_tileClearanceContainer.parent !== layer) {
        layer.addChild(_tileClearanceContainer);
    }
    _tileClearanceContainer.visible = true;

    // Hide all old text sprites
    for (let i = 0; i < _tileClearanceTexts.length; i++) {
        _tileClearanceTexts[i].visible = false;
    }

    // Determine visible tile range from viewport
    const vpRef = (typeof viewport !== "undefined") ? viewport : null;
    const vpX = vpRef ? vpRef.x : cam.x;
    const vpY = vpRef ? vpRef.y : cam.y;
    const vpW = vpRef ? vpRef.width : 24;
    const vpH = vpRef ? vpRef.height : 24;
    const pad = 2;
    const xScale = 0.866;
    const rawXStart = Math.floor(vpX / xScale) - pad;
    const rawXEnd = Math.ceil((vpX + vpW) / xScale) + pad;
    const rawYStart = Math.floor(vpY) - pad;
    const rawYEnd = Math.ceil(vpY + vpH) + pad;

    let textIdx = 0;
    for (let x = rawXStart; x <= rawXEnd; x++) {
        let xi = x;
        if (mapRef.wrapX) {
            xi = ((xi % mapRef.width) + mapRef.width) % mapRef.width;
        } else if (xi < 0 || xi >= mapRef.width) continue;
        for (let y = rawYStart; y <= rawYEnd; y++) {
            let yi = y;
            if (mapRef.wrapY) {
                yi = ((yi % mapRef.height) + mapRef.height) % mapRef.height;
            } else if (yi < 0 || yi >= mapRef.height) continue;
            if (!mapRef.nodes[xi] || !mapRef.nodes[xi][yi]) continue;
            const node = mapRef.nodes[xi][yi];
            const cl = Number.isFinite(node.clearance) ? node.clearance : -1;

            const scr = cam.worldToScreen(node.x, node.y);
            let txt = _tileClearanceTexts[textIdx];
            if (!txt) {
                txt = new PIXI.Text("", {
                    fontFamily: "monospace",
                    fontSize: 11,
                    fill: 0xFFFF00,
                    stroke: 0x000000,
                    strokeThickness: 2,
                    align: "center"
                });
                txt.anchor.set(0.5, 0.5);
                _tileClearanceContainer.addChild(txt);
                _tileClearanceTexts.push(txt);
            }
            txt.text = cl === Infinity ? "\u221E" : String(cl);
            txt.x = scr.x;
            txt.y = scr.y;
            txt.visible = true;
            textIdx++;
        }
    }
}

// --- Animal clearance overlay (red hex tiles + clearance numbers) ---
let _clearanceOverlayContainer = null;
let _clearanceOverlayGfx = null;
let _clearanceOverlayTexts = [];

/**
 * Draw a red-tinted hex + clearance number on every animal's current tile
 * (plus surrounding rings matching its pathfindingClearance).
 * Called from the render pipeline; controlled by showAnimalClearance flag.
 * @param {PIXI.Container} layer  - ground layer to attach overlay to
 * @param {object} cam             - camera with viewscale, xyratio, worldToScreen
 */
function drawAnimalClearanceOverlay(layer, cam) {
    const overlayEnabled = !!showAnimalClearance || !!debugMode;
    if (!overlayEnabled) {
        if (_clearanceOverlayContainer) _clearanceOverlayContainer.visible = false;
        return;
    }
    if (!layer || !cam) return;

    const vs = cam.viewscale;
    const vsy = cam.viewscale * cam.xyratio;
    if (vs <= 0 || vsy <= 0) return;

    const animalList = (typeof animals !== "undefined" && Array.isArray(animals)) ? animals : [];
    const mapRef = (typeof map !== "undefined") ? map : null;

    // Lazy-create container
    if (!_clearanceOverlayContainer) {
        _clearanceOverlayContainer = new PIXI.Container();
        _clearanceOverlayContainer.name = "clearanceOverlay";
        _clearanceOverlayContainer.interactiveChildren = false;
        _clearanceOverlayContainer.zIndex = Number.MAX_SAFE_INTEGER;
        layer.addChild(_clearanceOverlayContainer);
    } else if (_clearanceOverlayContainer.parent !== layer) {
        layer.addChild(_clearanceOverlayContainer);
    }
    _clearanceOverlayContainer.visible = true;

    if (!_clearanceOverlayGfx) {
        _clearanceOverlayGfx = new PIXI.Graphics();
        _clearanceOverlayContainer.addChild(_clearanceOverlayGfx);
    }
    const gfx = _clearanceOverlayGfx;
    gfx.clear();

    // Hex half-dimensions in screen pixels
    const hexPxW = vs / 0.866;
    const halfW = hexPxW / 2;
    const halfH = vsy / 2;
    const quarterW = hexPxW / 4;

    const appRef = (typeof app !== "undefined" && app && app.renderer) ? app : null;
    const screenW = appRef ? Math.max(1, appRef.renderer.width || 1) : Math.max(1, window.innerWidth || 1);
    const screenH = appRef ? Math.max(1, appRef.renderer.height || 1) : Math.max(1, window.innerHeight || 1);
    const seen = new Set();
    const adjDirs = [1, 3, 5, 7, 9, 11]; // adjacent hex neighbour directions

    const drawHex = (node, alpha) => {
        const key = `${node.xindex},${node.yindex}`;
        if (seen.has(key)) return;
        seen.add(key);

        const scr = cam.worldToScreen(node.x, node.y);
        const sx = scr.x;
        const sy = scr.y;
        if (sx < -halfW || sx > (screenW + halfW) || sy < -halfH || sy > (screenH + halfH)) {
            return;
        }

        gfx.beginFill(0x5a0000, alpha);
        gfx.moveTo(sx - halfW, sy);
        gfx.lineTo(sx - quarterW, sy - halfH);
        gfx.lineTo(sx + quarterW, sy - halfH);
        gfx.lineTo(sx + halfW, sy);
        gfx.lineTo(sx + quarterW, sy + halfH);
        gfx.lineTo(sx - quarterW, sy + halfH);
        gfx.closePath();
        gfx.endFill();
    };

    const collectRing = (center, rings) => {
        const result = [center];
        if (rings <= 0) return result;
        const visited = new Set();
        visited.add(`${center.xindex},${center.yindex}`);
        let frontier = [center];
        for (let r = 0; r < rings; r++) {
            const next = [];
            for (let f = 0; f < frontier.length; f++) {
                for (let d = 0; d < adjDirs.length; d++) {
                    const nb = frontier[f].neighbors[adjDirs[d]];
                    if (!nb || nb.xindex < 0 || nb.yindex < 0) continue;
                    const nk = `${nb.xindex},${nb.yindex}`;
                    if (visited.has(nk)) continue;
                    visited.add(nk);
                    next.push(nb);
                    result.push(nb);
                }
            }
            frontier = next;
        }
        return result;
    };

    for (let a = 0; a < animalList.length; a++) {
        const animal = animalList[a];
        if (!animal || animal.gone || animal.dead) continue;
        const node = mapRef ? mapRef.worldToNode(animal.x, animal.y) : null;
        if (!node) continue;

        const req = Number.isFinite(animal.pathfindingClearance)
            ? Math.max(0, Math.ceil(animal.pathfindingClearance))
            : 0;
        const tiles = collectRing(node, req);
        for (let t = 0; t < tiles.length; t++) {
            const tileNode = tiles[t];
            const alpha = 0.42;
            drawHex(tileNode, alpha);
        }
    }
}

// ── Node / midpoint inspector overlay ────────────────────────────────────────
// Draws the origin anchor (closest node or midpoint to the mouse cursor) and
// labels each of its 12 directional neighbours (0–11) using
// anchorNeighborInDirection().  Active while wizard.currentSpell === "nodeinspector".
let _nodeInspectorContainer = null;
let _nodeInspectorGfx = null;
let _nodeInspectorTexts = [];

function _getAnchorWorldPos(anchor) {
    if (!anchor) return null;
    if (Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
        return { x: anchor.x, y: anchor.y };
    }
    if (
        anchor.nodeA && anchor.nodeB &&
        Number.isFinite(anchor.nodeA.x) &&
        Number.isFinite(anchor.nodeB.x)
    ) {
        return {
            x: (anchor.nodeA.x + anchor.nodeB.x) * 0.5,
            y: (anchor.nodeA.y + anchor.nodeB.y) * 0.5
        };
    }
    return null;
}

function drawNodeInspectorOverlay(layer, cam) {
    const wizardRef = (typeof wizard !== "undefined") ? wizard : null;
    const active = !!(debugMode && wizardRef && wizardRef.currentSpell === "nodeinspector");
    if (!active) {
        if (_nodeInspectorContainer) _nodeInspectorContainer.visible = false;
        return;
    }
    if (!layer || !cam) return;

    const mapRef = (typeof map !== "undefined") ? map : null;
    if (!mapRef || typeof mapRef.worldToNodeOrMidpoint !== "function") return;

    const mousePosRef = (typeof mousePos !== "undefined") ? mousePos : null;
    const mx = mousePosRef ? mousePosRef.worldX : undefined;
    const my = mousePosRef ? mousePosRef.worldY : undefined;
    if (!Number.isFinite(mx) || !Number.isFinite(my)) {
        if (_nodeInspectorContainer) _nodeInspectorContainer.visible = false;
        return;
    }

    // Lazy-create container; re-add every frame so it stays on top of other ui children
    if (!_nodeInspectorContainer) {
        _nodeInspectorContainer = new PIXI.Container();
        _nodeInspectorContainer.name = "nodeInspectorOverlay";
        _nodeInspectorContainer.interactiveChildren = false;
    }
    layer.addChild(_nodeInspectorContainer); // moves to top of ui layer each frame
    _nodeInspectorContainer.visible = true;

    if (!_nodeInspectorGfx) {
        _nodeInspectorGfx = new PIXI.Graphics();
        _nodeInspectorContainer.addChild(_nodeInspectorGfx);
    }
    const gfx = _nodeInspectorGfx;
    gfx.clear();

    // Hide all pooled text labels
    for (let i = 0; i < _nodeInspectorTexts.length; i++) {
        _nodeInspectorTexts[i].visible = false;
    }

    const rawAnchor = mapRef.worldToNodeOrMidpoint(mx, my);
    if (!rawAnchor) return;

    // worldToNodeOrMidpoint may return a NodeMidpoint instance (has .nodeA/.nodeB
    // but no .k). anchorNeighborInDirection detects midpoints by anchor.k !== undefined,
    // so convert it to the plain value-type descriptor makeMidpoint understands.
    const anchor = (
        rawAnchor.k === undefined &&
        rawAnchor.nodeA && rawAnchor.nodeB &&
        typeof makeMidpoint === "function"
    ) ? makeMidpoint(rawAnchor.nodeA, rawAnchor.nodeB) || rawAnchor
      : rawAnchor;

    const originPos = _getAnchorWorldPos(anchor);
    if (!originPos) return;

    const originScr = cam.worldToScreen(originPos.x, originPos.y, 0);
    const isMidpoint = (typeof anchor.k === "number");

    // Origin dot — yellow for node, cyan for midpoint
    gfx.lineStyle(0);
    gfx.beginFill(isMidpoint ? 0x00ffff : 0xffff00, 0.9);
    gfx.drawCircle(originScr.x, originScr.y, 7);
    gfx.endFill();

    const spaceHeld = !!(typeof keysPressed !== "undefined" && keysPressed[" "]);
    let textIdx = 0;

    if (spaceHeld) {
        // Space held: show direction numbers 0–11 at each neighbour position
        for (let d = 0; d < 12; d++) {
            const nb = (typeof anchorNeighborInDirection === "function")
                ? anchorNeighborInDirection(anchor, d)
                : null;
            if (!nb) continue;

            const nbPos = _getAnchorWorldPos(nb);
            if (!nbPos) continue;

            const nbScr = cam.worldToScreen(nbPos.x, nbPos.y, 0);

            // Line from origin to neighbour
            gfx.lineStyle(1, 0xffffff, 0.35);
            gfx.moveTo(originScr.x, originScr.y);
            gfx.lineTo(nbScr.x, nbScr.y);

            // Direction number label centered at neighbour position
            let txt = _nodeInspectorTexts[textIdx];
            if (!txt) {
                txt = new PIXI.Text("", {
                    fontFamily: "monospace",
                    fontSize: 13,
                    fontWeight: "bold",
                    fill: 0xffffff,
                    stroke: 0x000000,
                    strokeThickness: 3,
                    align: "center"
                });
                _nodeInspectorContainer.addChild(txt);
                _nodeInspectorTexts.push(txt);
            }
            txt.anchor.set(0.5, 0.5);
            txt.text = String(d);
            txt.x = nbScr.x;
            txt.y = nbScr.y;
            txt.visible = true;
            textIdx++;
        }
    } else {
        // Space not held: show x,y coordinates of the anchor
        let txt = _nodeInspectorTexts[textIdx];
        if (!txt) {
            txt = new PIXI.Text("", {
                fontFamily: "monospace",
                fontSize: 13,
                fontWeight: "bold",
                fill: 0xffffff,
                stroke: 0x000000,
                strokeThickness: 3,
                align: "center"
            });
            _nodeInspectorContainer.addChild(txt);
            _nodeInspectorTexts.push(txt);
        }
        txt.anchor.set(0.5, 1.5);
        txt.text = `${originPos.x.toFixed(2)}, ${originPos.y.toFixed(2)}`;
        txt.x = originScr.x;
        txt.y = originScr.y;
        txt.visible = true;
        textIdx++;
    }
}
