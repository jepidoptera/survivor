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
        const defaultMainThreadProfileSeconds = 60;
        let currentLoad = null;
        let lastCompletedLoad = null;
        let pendingFrameAfterLoad = null;
        let mainThreadProfile = null;
        let mainThreadProfileTimer = null;
        let lastMainThreadProfile = null;
        let hitchProfile = null;
        let hitchProfileTimer = null;
        let currentHitchEvent = null;
        let lastHitchProfile = null;
        let pendingFrameProfile = null;

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
            task,
            hitchTask,
            hitchSpan,
            startMainThreadProfile,
            profileFrames: startMainThreadProfile,
            stopMainThreadProfile,
            startHitchProfile,
            stopHitchProfile,
            profileFrame,
            getMainThreadProfile: () => mainThreadProfile,
            getLastMainThreadProfile: () => lastMainThreadProfile,
            getHitchProfile: () => hitchProfile,
            getLastHitchProfile: () => lastHitchProfile,
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
                        if (mainThreadProfile && record.start >= mainThreadProfile.startedAt) {
                            mainThreadProfile.longTasks.push(record);
                        }
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
            if (!api.enabled || (!currentLoad && !currentHitchEvent)) return fn();
            const started = performance.now();
            try {
                return fn();
            } finally {
                const duration = performance.now() - started;
                if (currentLoad) currentLoad.spans.push({ label, duration, at: started });
                recordCurrentHitchSpan(label, duration, started);
            }
        }

        function hitchSpan(label, fn) {
            if (typeof label !== "string" || label.length === 0) {
                throw new Error("Wizard of Flatland hitch profiler span requires a label");
            }
            if (typeof fn !== "function") {
                throw new Error(`Wizard of Flatland hitch profiler span "${label}" requires a function`);
            }
            if (!hitchProfile || !currentHitchEvent) return fn();
            const startedAt = performance.now();
            try {
                return fn();
            } finally {
                recordCurrentHitchSpan(label, performance.now() - startedAt, startedAt);
            }
        }

        function recordCurrentHitchSpan(label, durationMs, startedAt) {
            if (!hitchProfile || !currentHitchEvent) return;
            currentHitchEvent.spans.push({
                section: String(label),
                durationMs,
                startedAt
            });
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

        function noteFrame(duration, parts, timing) {
            if (!api.enabled) return;
            recordMainThreadFrame(duration, parts, timing);
            completePendingFrameProfile(duration, parts, timing);
            if (duration < 24) return;
            const record = {
                duration,
                at: performance.now(),
                parts: parts || null,
                pathing: state.debug && state.debug.lastPathingMetrics ? state.debug.lastPathingMetrics : null
            };
            frameHitches.push(record);
            while (frameHitches.length > 40) frameHitches.shift();
        }

        function profileFrame() {
            if (pendingFrameProfile) {
                throw new Error("Wizard of Flatland frame profiler is already waiting for a frame");
            }
            return new Promise((resolve) => {
                pendingFrameProfile = {
                    requestedAt: performance.now(),
                    resolve
                };
            });
        }

        function completePendingFrameProfile(duration, parts, timing) {
            if (!pendingFrameProfile) return;
            const pending = pendingFrameProfile;
            pendingFrameProfile = null;
            const measuredWorkMs = Math.max(0, Number(duration) || 0);
            const frameIntervalMs = Math.max(
                measuredWorkMs,
                Number(timing && timing.frameIntervalMs) || measuredWorkMs
            );
            const sections = (Array.isArray(parts) ? parts : [])
                .map((part) => ({
                    section: String(part && part.label || ""),
                    durationMs: Math.max(0, Number(part && part.duration) || 0)
                }))
                .sort((left, right) => right.durationMs - left.durationMs);
            if (sections.some((part) => !part.section)) {
                throw new Error("Wizard of Flatland frame profiler received an unlabeled frame part");
            }
            const instrumentedWorkMs = sections.reduce((total, part) => total + part.durationMs, 0);
            const result = {
                requestedAt: pending.requestedAt,
                capturedAt: performance.now(),
                fps: frameIntervalMs > 0 ? 1000 / frameIntervalMs : 0,
                frameIntervalMs,
                measuredWorkMs,
                outsideFrameWorkMs: Math.max(0, frameIntervalMs - measuredWorkMs),
                unaccountedFrameMs: Math.max(0, measuredWorkMs - instrumentedWorkMs),
                sections
            };
            console.groupCollapsed(
                `[Wizard of Flatland frame profiler] ${result.fps.toFixed(1)} FPS, `
                + `${frameIntervalMs.toFixed(3)} ms interval, ${measuredWorkMs.toFixed(3)} ms measured work`
            );
            console.log({
                fps: Number(result.fps.toFixed(2)),
                frameIntervalMs: Number(frameIntervalMs.toFixed(3)),
                measuredWorkMs: Number(measuredWorkMs.toFixed(3)),
                outsideFrameWorkMs: Number(result.outsideFrameWorkMs.toFixed(3)),
                unaccountedFrameMs: Number(result.unaccountedFrameMs.toFixed(3))
            });
            console.table(sections.map((part) => ({
                section: part.section,
                durationMs: Number(part.durationMs.toFixed(3))
            })));
            console.groupEnd();
            pending.resolve(result);
        }

        function startMainThreadProfile(durationSeconds = defaultMainThreadProfileSeconds) {
            const seconds = Number(durationSeconds);
            if (!Number.isFinite(seconds) || seconds <= 0) {
                throw new Error("Wizard of Flatland main-thread profile duration must be a positive number of seconds");
            }
            if (mainThreadProfileTimer !== null) clearTimeout(mainThreadProfileTimer);
            const startedAt = performance.now();
            mainThreadProfile = {
                startedAt,
                requestedDurationMs: seconds * 1000,
                frameCount: 0,
                frameTimeMs: 0,
                maxFrameMs: 0,
                maxFrameIntervalMs: 0,
                sections: new Map(),
                hitches: [],
                longTasks: [],
                externalTasks: new Map(),
                slowExternalTasks: []
            };
            mainThreadProfileTimer = setTimeout(() => {
                mainThreadProfileTimer = null;
                stopMainThreadProfile();
            }, mainThreadProfile.requestedDurationMs);
            console.log(
                `[Wizard of Flatland profiler] Recording main-thread frames for ${seconds.toFixed(1)} seconds.`
            );
            return mainThreadProfile;
        }

        function task(label, fn) {
            if (typeof label !== "string" || label.length === 0) {
                throw new Error("Wizard of Flatland profiler task requires a label");
            }
            if (typeof fn !== "function") {
                throw new Error(`Wizard of Flatland profiler task "${label}" requires a function`);
            }
            if (!mainThreadProfile) return fn();
            const startedAt = performance.now();
            try {
                return fn();
            } finally {
                const duration = performance.now() - startedAt;
                let aggregate = mainThreadProfile.externalTasks.get(label);
                if (!aggregate) {
                    aggregate = { calls: 0, totalMs: 0, maxMs: 0 };
                    mainThreadProfile.externalTasks.set(label, aggregate);
                }
                aggregate.calls += 1;
                aggregate.totalMs += duration;
                aggregate.maxMs = Math.max(aggregate.maxMs, duration);
                if (duration >= 24) {
                    mainThreadProfile.slowExternalTasks.push({
                        task: label,
                        atSeconds: (startedAt - mainThreadProfile.startedAt) / 1000,
                        durationMs: duration
                    });
                }
            }
        }

        function hitchTask(label, fn, details) {
            if (typeof label !== "string" || label.length === 0) {
                throw new Error("Wizard of Flatland hitch profiler task requires a label");
            }
            if (typeof fn !== "function") {
                throw new Error(`Wizard of Flatland hitch profiler task "${label}" requires a function`);
            }
            if (!hitchProfile) return fn();
            const profile = hitchProfile;
            const startedAt = performance.now();
            const parentEvent = currentHitchEvent;
            const eventRecord = {
                task: label,
                startedAt,
                spans: [],
                details: null
            };
            currentHitchEvent = eventRecord;
            try {
                return fn();
            } finally {
                const durationMs = performance.now() - startedAt;
                currentHitchEvent = parentEvent;
                if (profile !== hitchProfile) return;
                eventRecord.durationMs = durationMs;
                eventRecord.atSeconds = (startedAt - profile.startedAt) / 1000;
                eventRecord.uninstrumentedMs = getHitchEventUninstrumentedMs(eventRecord);
                eventRecord.details = typeof details === "function" ? details() : (details || null);
                let taskAggregate = profile.tasks.get(label);
                if (!taskAggregate) {
                    taskAggregate = { calls: 0, totalMs: 0, maxMs: 0, hitchCount: 0 };
                    profile.tasks.set(label, taskAggregate);
                }
                taskAggregate.calls += 1;
                taskAggregate.totalMs += durationMs;
                taskAggregate.maxMs = Math.max(taskAggregate.maxMs, durationMs);
                for (const spanRecord of eventRecord.spans) {
                    const key = `${label} > ${spanRecord.section}`;
                    let spanAggregate = profile.spans.get(key);
                    if (!spanAggregate) {
                        spanAggregate = { calls: 0, totalMs: 0, maxMs: 0 };
                        profile.spans.set(key, spanAggregate);
                    }
                    spanAggregate.calls += 1;
                    spanAggregate.totalMs += spanRecord.durationMs;
                    spanAggregate.maxMs = Math.max(spanAggregate.maxMs, spanRecord.durationMs);
                }
                if (durationMs >= profile.thresholdMs) {
                    taskAggregate.hitchCount += 1;
                    profile.hitches.push(eventRecord);
                    while (profile.hitches.length > profile.maxHitches) profile.hitches.shift();
                }
            }
        }

        function getHitchEventUninstrumentedMs(eventRecord) {
            if (!eventRecord || !Number.isFinite(eventRecord.startedAt) || !Number.isFinite(eventRecord.durationMs)) {
                throw new Error("Wizard of Flatland hitch profiler requires a timed event");
            }
            const eventEnd = eventRecord.startedAt + eventRecord.durationMs;
            const intervals = eventRecord.spans
                .map((spanRecord) => ({
                    start: Math.max(eventRecord.startedAt, spanRecord.startedAt),
                    end: Math.min(eventEnd, spanRecord.startedAt + spanRecord.durationMs)
                }))
                .filter((interval) => interval.end > interval.start)
                .sort((left, right) => left.start - right.start);
            let coveredMs = 0;
            let coveredStart = null;
            let coveredEnd = null;
            for (const interval of intervals) {
                if (coveredStart === null || interval.start > coveredEnd) {
                    if (coveredStart !== null) coveredMs += coveredEnd - coveredStart;
                    coveredStart = interval.start;
                    coveredEnd = interval.end;
                } else {
                    coveredEnd = Math.max(coveredEnd, interval.end);
                }
            }
            if (coveredStart !== null) coveredMs += coveredEnd - coveredStart;
            return Math.max(0, eventRecord.durationMs - coveredMs);
        }

        function startHitchProfile(durationSeconds = 30, thresholdMs = 16) {
            const seconds = Number(durationSeconds);
            const threshold = Number(thresholdMs);
            if (!Number.isFinite(seconds) || seconds <= 0) {
                throw new Error("Wizard of Flatland hitch profile duration must be a positive number of seconds");
            }
            if (!Number.isFinite(threshold) || threshold <= 0) {
                throw new Error("Wizard of Flatland hitch profile threshold must be a positive number of milliseconds");
            }
            if (hitchProfile) {
                throw new Error("Wizard of Flatland hitch profiler is already running");
            }
            hitchProfile = {
                startedAt: performance.now(),
                requestedDurationMs: seconds * 1000,
                thresholdMs: threshold,
                maxHitches: 100,
                tasks: new Map(),
                spans: new Map(),
                hitches: []
            };
            hitchProfileTimer = setTimeout(() => {
                hitchProfileTimer = null;
                stopHitchProfile();
            }, hitchProfile.requestedDurationMs);
            console.log(
                `[Wizard of Flatland hitch profiler] Recording for ${seconds.toFixed(1)} seconds `
                + `with a ${threshold.toFixed(1)} ms threshold.`
            );
            return hitchProfile;
        }

        function stopHitchProfile() {
            if (!hitchProfile) {
                throw new Error("Wizard of Flatland hitch profiler is not currently running");
            }
            if (hitchProfileTimer !== null) {
                clearTimeout(hitchProfileTimer);
                hitchProfileTimer = null;
            }
            const profile = hitchProfile;
            hitchProfile = null;
            currentHitchEvent = null;
            const taskRows = Array.from(profile.tasks, ([taskName, values]) => ({
                task: taskName,
                calls: values.calls,
                totalMs: Number(values.totalMs.toFixed(3)),
                averageMs: Number((values.totalMs / Math.max(1, values.calls)).toFixed(4)),
                maxMs: Number(values.maxMs.toFixed(3)),
                hitches: values.hitchCount
            })).sort((left, right) => right.maxMs - left.maxMs);
            const spanRows = Array.from(profile.spans, ([section, values]) => ({
                section,
                calls: values.calls,
                totalMs: Number(values.totalMs.toFixed(3)),
                averageMs: Number((values.totalMs / Math.max(1, values.calls)).toFixed(4)),
                maxMs: Number(values.maxMs.toFixed(3))
            })).sort((left, right) => right.maxMs - left.maxMs);
            const hitches = profile.hitches
                .slice()
                .sort((left, right) => right.durationMs - left.durationMs)
                .map((eventRecord) => ({
                    task: eventRecord.task,
                    atSeconds: Number(eventRecord.atSeconds.toFixed(3)),
                    durationMs: Number(eventRecord.durationMs.toFixed(3)),
                    uninstrumentedMs: Number(eventRecord.uninstrumentedMs.toFixed(3)),
                    details: eventRecord.details,
                    topSpans: eventRecord.spans
                        .slice()
                        .sort((left, right) => right.durationMs - left.durationMs)
                        .slice(0, 8)
                        .map((spanRecord) => `${spanRecord.section} ${spanRecord.durationMs.toFixed(3)}ms`)
                        .join(", ")
                }));
            lastHitchProfile = {
                elapsedMs: performance.now() - profile.startedAt,
                thresholdMs: profile.thresholdMs,
                taskRows,
                spanRows,
                hitches
            };
            console.groupCollapsed(
                `[Wizard of Flatland hitch profiler] ${hitches.length} hitches over `
                + `${(lastHitchProfile.elapsedMs / 1000).toFixed(1)} seconds`
            );
            console.log("Instrumented tasks");
            console.table(taskRows);
            console.log("Instrumented sections");
            console.table(spanRows);
            console.log("Worst hitches");
            console.table(hitches);
            console.groupEnd();
            return lastHitchProfile;
        }

        function recordMainThreadFrame(duration, parts, timing) {
            if (!mainThreadProfile) return;
            const frameMs = Math.max(0, Number(duration) || 0);
            const frameIntervalMs = Math.max(
                frameMs,
                Number(timing && timing.frameIntervalMs) || frameMs
            );
            mainThreadProfile.frameCount += 1;
            mainThreadProfile.frameTimeMs += frameMs;
            mainThreadProfile.maxFrameMs = Math.max(mainThreadProfile.maxFrameMs, frameMs);
            mainThreadProfile.maxFrameIntervalMs = Math.max(
                mainThreadProfile.maxFrameIntervalMs,
                frameIntervalMs
            );
            let instrumentedMs = 0;
            for (const part of Array.isArray(parts) ? parts : []) {
                const label = String(part && part.label || "");
                const elapsedMs = Math.max(0, Number(part && part.duration) || 0);
                if (!label) throw new Error("Wizard of Flatland main-thread profile received an unlabeled frame part");
                instrumentedMs += elapsedMs;
                let section = mainThreadProfile.sections.get(label);
                if (!section) {
                    section = { calls: 0, totalMs: 0, maxMs: 0 };
                    mainThreadProfile.sections.set(label, section);
                }
                section.calls += 1;
                section.totalMs += elapsedMs;
                section.maxMs = Math.max(section.maxMs, elapsedMs);
            }
            const unaccountedMs = Math.max(0, frameMs - instrumentedMs);
            let unaccounted = mainThreadProfile.sections.get("unaccounted frame overhead");
            if (!unaccounted) {
                unaccounted = { calls: 0, totalMs: 0, maxMs: 0 };
                mainThreadProfile.sections.set("unaccounted frame overhead", unaccounted);
            }
            unaccounted.calls += 1;
            unaccounted.totalMs += unaccountedMs;
            unaccounted.maxMs = Math.max(unaccounted.maxMs, unaccountedMs);

            if (frameIntervalMs >= 24 || frameMs >= 24) {
                const previousHitch = mainThreadProfile.hitches.at(-1);
                const at = performance.now();
                const topParts = (Array.isArray(parts) ? parts : [])
                    .map((part) => ({
                        section: String(part.label),
                        ms: Number((Number(part.duration) || 0).toFixed(3))
                    }))
                    .sort((a, b) => b.ms - a.ms)
                    .slice(0, 4);
                mainThreadProfile.hitches.push({
                    at,
                    sinceProfileStartMs: at - mainThreadProfile.startedAt,
                    sincePreviousHitchMs: previousHitch ? at - previousHitch.at : null,
                    frameIntervalMs,
                    measuredWorkMs: frameMs,
                    outsideFrameWorkMs: Math.max(0, frameIntervalMs - frameMs),
                    topParts
                });
            }
        }

        function stopMainThreadProfile() {
            if (!mainThreadProfile) {
                throw new Error("Wizard of Flatland main-thread profiler is not currently running");
            }
            if (mainThreadProfileTimer !== null) {
                clearTimeout(mainThreadProfileTimer);
                mainThreadProfileTimer = null;
            }
            const completedAt = performance.now();
            const profile = mainThreadProfile;
            mainThreadProfile = null;
            const rows = Array.from(profile.sections, ([section, values]) => ({
                section,
                totalMs: Number(values.totalMs.toFixed(3)),
                shareOfFrameTime: profile.frameTimeMs > 0
                    ? `${(values.totalMs / profile.frameTimeMs * 100).toFixed(2)}%`
                    : "0.00%",
                calls: values.calls,
                averageMs: Number((values.totalMs / Math.max(1, values.calls)).toFixed(4)),
                maxMs: Number(values.maxMs.toFixed(3))
            })).sort((a, b) => b.totalMs - a.totalMs);
            lastMainThreadProfile = {
                startedAt: profile.startedAt,
                completedAt,
                elapsedMs: completedAt - profile.startedAt,
                frameCount: profile.frameCount,
                frameTimeMs: profile.frameTimeMs,
                averageFrameMs: profile.frameTimeMs / Math.max(1, profile.frameCount),
                maxFrameMs: profile.maxFrameMs,
                maxFrameIntervalMs: profile.maxFrameIntervalMs,
                hitches: profile.hitches,
                longTasks: profile.longTasks,
                externalTasks: Array.from(profile.externalTasks, ([taskName, values]) => ({
                    task: taskName,
                    calls: values.calls,
                    totalMs: values.totalMs,
                    averageMs: values.totalMs / Math.max(1, values.calls),
                    maxMs: values.maxMs
                })).sort((a, b) => b.totalMs - a.totalMs),
                slowExternalTasks: profile.slowExternalTasks,
                rows
            };
            console.groupCollapsed(
                `[Wizard of Flatland profiler] ${profile.frameCount} frames over ${((completedAt - profile.startedAt) / 1000).toFixed(1)} seconds`
            );
            console.log({
                frames: profile.frameCount,
                measuredFrameTimeMs: Number(profile.frameTimeMs.toFixed(3)),
                averageFrameMs: Number(lastMainThreadProfile.averageFrameMs.toFixed(3)),
                maxFrameMs: Number(profile.maxFrameMs.toFixed(3)),
                maxFrameIntervalMs: Number(profile.maxFrameIntervalMs.toFixed(3)),
                hitchCount: profile.hitches.length,
                observedLongTasks: profile.longTasks.length
            });
            console.table(rows);
            if (lastMainThreadProfile.externalTasks.length > 0) {
                console.log("[Wizard of Flatland profiler] Work outside animation frames");
                console.table(lastMainThreadProfile.externalTasks.map((entry) => ({
                    task: entry.task,
                    calls: entry.calls,
                    totalMs: Number(entry.totalMs.toFixed(3)),
                    averageMs: Number(entry.averageMs.toFixed(4)),
                    maxMs: Number(entry.maxMs.toFixed(3))
                })));
            }
            if (profile.slowExternalTasks.length > 0) {
                console.log("[Wizard of Flatland profiler] Slow work outside animation frames");
                console.table(profile.slowExternalTasks
                    .slice()
                    .sort((a, b) => b.durationMs - a.durationMs)
                    .slice(0, 20)
                    .map((entry) => ({
                        task: entry.task,
                        atSeconds: Number(entry.atSeconds.toFixed(3)),
                        durationMs: Number(entry.durationMs.toFixed(3))
                    })));
            }
            if (profile.hitches.length > 0) {
                console.log("[Wizard of Flatland profiler] Worst frame hitches");
                console.table(profile.hitches
                    .slice()
                    .sort((a, b) => b.frameIntervalMs - a.frameIntervalMs)
                    .slice(0, 20)
                    .map((hitch) => ({
                        atSeconds: Number((hitch.sinceProfileStartMs / 1000).toFixed(3)),
                        sincePreviousHitchMs: hitch.sincePreviousHitchMs === null
                            ? null
                            : Number(hitch.sincePreviousHitchMs.toFixed(1)),
                        frameIntervalMs: Number(hitch.frameIntervalMs.toFixed(3)),
                        measuredWorkMs: Number(hitch.measuredWorkMs.toFixed(3)),
                        outsideFrameWorkMs: Number(hitch.outsideFrameWorkMs.toFixed(3)),
                        topSections: hitch.topParts
                            .map((part) => `${part.section} ${part.ms}ms`)
                            .join(", ")
                    })));
            }
            if (profile.longTasks.length > 0) {
                console.log("[Wizard of Flatland profiler] Browser long tasks");
                console.table(profile.longTasks.map((task) => ({
                    atSeconds: Number(((task.start - profile.startedAt) / 1000).toFixed(3)),
                    durationMs: Number(task.duration.toFixed(3)),
                    name: task.name
                })));
            }
            console.groupEnd();
            return lastMainThreadProfile;
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

        startMainThreadProfile();
        return api;
    }

    window.WizardFlatlandProfiler = Object.freeze({
        createWizardOfFlatlandProfiler
    });
}());
