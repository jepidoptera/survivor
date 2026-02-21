// debug.js - central debug and instrumentation state

const debugRenderMaxFps = 0; // keep debug uncapped to avoid hidden global frame caps

let debugMode = false; // Toggle all debug graphics (hitboxes, grid, animal markers)
let showHexGrid = false; // Toggle hex grid only (g key)
let showBlockedNeighbors = false; // Toggle blocked-neighbor edge overlays

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
            objectLitTransparencyEnabled: true,
            objectLitAlpha: 0.5,
            objectLitMaskDebugOnly: false,
            objectLitMaskPreview: false,
            maxDarken: 0.5,
            forwardFovDegrees: 200
        });

let cameraForwardLeadRatio = 0.0;
let cameraFollowSmoothing = 0.025;

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

    const worldToScreenRaw = (x, y) => ({
        x: (x - viewport.x) * viewscale,
        y: (y - viewport.y) * viewscale * xyratio
    });
    const topLeft = worldToScreenRaw(0, 0);
    const topRight = worldToScreenRaw(worldWidth, 0);
    const bottomRight = worldToScreenRaw(worldWidth, worldHeight);
    const bottomLeft = worldToScreenRaw(0, worldHeight);

    const dash = 8;
    const gap = 6;
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

    if (showBlockedNeighbors) {
        gridGraphics.lineStyle(4, 0xff0000, 0.4);
        const drawnEdges = new Set();
        yRanges.forEach(yRange => {
            for (let y = yRange.start; y <= yRange.end; y++) {
                xRanges.forEach(xRange => {
                    for (let x = xRange.start; x <= xRange.end; x++) {
                        if (!map.nodes[x] || !map.nodes[x][y]) continue;
                        const node = map.nodes[x][y];

                        if (!node.blockedNeighbors || node.blockedNeighbors.size === 0) continue;

                        node.blockedNeighbors.forEach((blockingSet, direction) => {
                            if (blockingSet.size === 0) return;

                            const neighbor = node.neighbors[direction];
                            if (!neighbor) return;
                            const edgeKey = [
                                `${node.xindex},${node.yindex}`,
                                `${neighbor.xindex},${neighbor.yindex}`
                            ].sort().join("|");
                            if (drawnEdges.has(edgeKey)) return;
                            drawnEdges.add(edgeKey);

                            const midX = (node.x + neighbor.x) / 2;
                            const midY = (node.y + neighbor.y) / 2;
                            const dx = neighbor.x - node.x;
                            const dy = neighbor.y - node.y;
                            const len = Math.sqrt(dx * dx + dy * dy);

                            if (len === 0) return;

                            const tangentX = dx / len;
                            const tangentY = dy / len;
                            const perpX = -dy / len;
                            const perpY = dx / len;
                            const lineLength = 0.4;
                            const offset = 0.05;
                            const ox = tangentX * offset;
                            const oy = tangentY * offset;
                            const x1 = midX + ox + perpX * lineLength;
                            const y1 = midY + oy + perpY * lineLength;
                            const x2 = midX + ox - perpX * lineLength;
                            const y2 = midY + oy - perpY * lineLength;
                            const screen1 = worldToScreen({x: x1, y: y1});
                            const screen2 = worldToScreen({x: x2, y: y2});

                            gridGraphics.moveTo(screen1.x, screen1.y);
                            gridGraphics.lineTo(screen2.x, screen2.y);
                        });
                    }
                });
            }
        });
    }
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
