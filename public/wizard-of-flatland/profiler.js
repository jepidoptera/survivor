(function () {
    "use strict";

    function createWizardOfFlatlandProfiler(deps) {
        const state = deps && deps.state;
        const labels = deps && deps.labels;
        if (!state || typeof state !== "object") throw new Error("Wizard of Flatland profiler requires state");
        if (!labels || typeof labels !== "object") throw new Error("Wizard of Flatland profiler requires labels");

        const maxLoads = 12;
        const maxRows = 12;
        const loadRecords = [];
        const longTasks = [];
        const frameHitches = [];
        const pathingRecords = [];
        let currentLoad = null;
        let lastCompletedLoad = null;
        let pendingFrameAfterLoad = null;

        const api = {
            enabled: true,
            consoleLogging: false,
            loadRecords,
            longTasks,
            frameHitches,
            pathingRecords,
            beginLoad,
            mark,
            span,
            completeLoad,
            noteFrame,
            notePathing,
            noteFirstFrameAfterLoad,
            getCurrentLoad: () => currentLoad,
            getLastCompletedLoad: () => lastCompletedLoad,
            printLastLoad: () => {
                if (lastCompletedLoad) printLoadRecord(lastCompletedLoad);
            }
        };

        if (typeof PerformanceObserver === "function") {
            try {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        const record = {
                            name: entry.name || "longtask",
                            start: entry.startTime,
                            duration: entry.duration
                        };
                        longTasks.push(record);
                        while (longTasks.length > 40) longTasks.shift();
                        if (currentLoad && record.start >= currentLoad.start && record.start <= performance.now()) {
                            currentLoad.longTasks.push(record);
                        }
                    }
                });
                observer.observe({ type: "longtask", buffered: true });
                api.longTaskObserver = observer;
            } catch (_error) {
                api.longTaskObserver = null;
            }
        }

        function beginLoad(meta) {
            if (!api.enabled) return null;
            const now = performance.now();
            currentLoad = {
                requestId: Number(meta && meta.requestId) || 0,
                signature: String(meta && meta.signature || ""),
                keys: Array.isArray(meta && meta.keys) ? meta.keys.slice() : [],
                start: now,
                marks: [{ label: "request", at: now, duration: 0 }],
                spans: [],
                longTasks: [],
                firstFrame: null,
                completed: false,
                totalMs: 0,
                mainThreadMs: 0,
                counts: {}
            };
            updateProfilerPanel();
            return currentLoad;
        }

        function mark(label, extra) {
            if (!api.enabled || !currentLoad) return;
            currentLoad.marks.push({
                label,
                at: performance.now(),
                duration: 0,
                extra: extra || null
            });
        }

        function span(label, fn) {
            if (!api.enabled || !currentLoad) return fn();
            const started = performance.now();
            try {
                return fn();
            } finally {
                const duration = performance.now() - started;
                currentLoad.spans.push({ label, duration, at: started });
            }
        }

        function completeLoad(counts) {
            if (!api.enabled || !currentLoad) return;
            currentLoad.completed = true;
            currentLoad.totalMs = performance.now() - currentLoad.start;
            currentLoad.counts = counts || {};
            currentLoad.spans.sort((a, b) => b.duration - a.duration);
            currentLoad.mainThreadMs = currentLoad.spans.reduce((total, entry) => total + entry.duration, 0);
            loadRecords.push(currentLoad);
            while (loadRecords.length > maxLoads) loadRecords.shift();
            lastCompletedLoad = currentLoad;
            pendingFrameAfterLoad = currentLoad;
            currentLoad = null;
            updateProfilerPanel();
            if (api.consoleLogging) printLoadRecord(lastCompletedLoad);
        }

        function noteFrame(duration, parts) {
            if (!api.enabled || duration < 24) return;
            const record = {
                duration,
                at: performance.now(),
                parts: parts || null,
                pathing: state.debug && state.debug.lastPathingMetrics ? state.debug.lastPathingMetrics : null
            };
            frameHitches.push(record);
            while (frameHitches.length > 40) frameHitches.shift();
        }

        function notePathing(metrics) {
            if (!api.enabled || !metrics) return;
            pathingRecords.push(metrics);
            while (pathingRecords.length > 80) pathingRecords.shift();
        }

        function noteFirstFrameAfterLoad(duration, parts) {
            if (!api.enabled || !pendingFrameAfterLoad) return;
            pendingFrameAfterLoad.firstFrame = { duration, parts: parts || null };
            if (api.consoleLogging && typeof console !== "undefined") {
                console.groupCollapsed(`Wizard of Flatland first frame after section load: ${duration.toFixed(2)} ms`);
                console.table((parts || []).map((entry) => ({
                    span: entry.label,
                    ms: Number(entry.duration.toFixed(3))
                })));
                console.groupEnd();
            }
            pendingFrameAfterLoad = null;
            updateProfilerPanel();
        }

        function updateProfilerPanel() {
            if (!labels.profilerSummary || !labels.profilerRows) return;
            const record = currentLoad || lastCompletedLoad;
            if (!record) {
                labels.profilerSummary.textContent = "waiting for section load";
                labels.profilerRows.textContent = "";
                return;
            }
            const counts = record.counts || {};
            const status = record.completed ? "last" : "loading";
            const firstFrameText = record.firstFrame
                ? `, first frame ${record.firstFrame.duration.toFixed(2)} ms`
                : "";
            const mainThreadMs = record.completed
                ? record.mainThreadMs
                : record.spans.reduce((total, entry) => total + entry.duration, 0);
            labels.profilerSummary.textContent = `${status} request ${record.requestId}: ${mainThreadMs.toFixed(2)} ms main thread, ${record.totalMs.toFixed(2)} ms elapsed${firstFrameText} (${counts.sections || record.keys.length || 0} sections, ${counts.walls || 0} walls, ${counts.nodes || 0} nodes)`;
            const rows = record.spans.map((spanRecord) => ({
                label: spanRecord.label,
                duration: spanRecord.duration
            }));
            if (record.firstFrame && Array.isArray(record.firstFrame.parts)) {
                rows.push({
                    label: "first frame total",
                    duration: record.firstFrame.duration
                });
                for (const part of record.firstFrame.parts.slice(0, 5)) {
                    rows.push({
                        label: `first frame: ${part.label}`,
                        duration: part.duration
                    });
                }
            }
            rows.sort((a, b) => b.duration - a.duration);
            labels.profilerRows.replaceChildren(...rows.slice(0, maxRows).map((spanRecord) => {
                const row = document.createElement("div");
                row.className = "profiler-row";
                const name = document.createElement("strong");
                name.textContent = spanRecord.label;
                const value = document.createElement("span");
                value.textContent = `${spanRecord.duration.toFixed(2)} ms`;
                row.append(name, value);
                return row;
            }));
        }

        function printLoadRecord(record) {
            if (!record || typeof console === "undefined") return;
            const rows = record.spans.map((entry) => ({
                span: entry.label,
                ms: Number(entry.duration.toFixed(3))
            }));
            console.groupCollapsed(
                `Wizard of Flatland section load ${record.requestId}: ${record.mainThreadMs.toFixed(2)} ms main thread`
            );
            console.log({
                requestId: record.requestId,
                mainThreadMs: record.mainThreadMs,
                elapsedMs: record.totalMs,
                sections: record.counts.sections || record.keys.length || 0,
                wallSegments: record.counts.walls || 0,
                nodes: record.counts.nodes || 0,
                blockedEdges: record.counts.blockedEdges || 0,
                firstFrame: record.firstFrame,
                longTasks: record.longTasks
            });
            console.table(rows);
            console.groupEnd();
        }

        return api;
    }

    window.WizardFlatlandProfiler = Object.freeze({
        createWizardOfFlatlandProfiler
    });
}());
