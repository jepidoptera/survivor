(function () {
    "use strict";

    const STRIDE = 17;
    const OUT_STRIDE = 14;
    const WALL_STRIDE = 8;
    const WALL_X1 = 0;
    const WALL_Y1 = 1;
    const WALL_X2 = 2;
    const WALL_Y2 = 3;
    const WALL_LABEL_CODE = 4;
    const WALL_LABEL_SIDE = 5;
    const WALL_LABEL_MANUAL_TOOL = 1;
    const WALL_LABEL_ARENA_BOUNDARY = 2;
    const WALL_LABEL_ROOM_BOUNDARY = 10;
    const WALL_LABEL_ROOM_HALL_GAP = 11;
    const WALL_LABEL_ROOM_OUTSIDE_DOOR_GAP = 12;
    const WALL_LABEL_ROOM_POCKET_OVERRIDE = 13;
    const WALL_LABEL_ROOM_POCKET_OVERRIDE_HALL_GAP = 14;
    const WALL_LABEL_ROOM_POCKET_CONNECTOR = 15;
    const WALL_LABEL_SQUARE_SIDE_PARALLEL = 20;
    const WALL_LABEL_SQUARE_SIDE_PERPENDICULAR = 21;
    const WALL_LABEL_SQUARE_SIDE_PERPENDICULAR_FULL = 22;
    const WALL_LABEL_HALLWAY_SIDE_HALF = 30;
    const WALL_LABEL_HALLWAY_SIDE_FULL = 31;
    const PATH_SNAPSHOT_NODE_STRIDE = 8;
    const PATH_SNAPSHOT_EDGE_STRIDE = 4;
    const STATE_MILLING = 1;
    const STATE_ATTACKING = 3;
    const STATE_BLOCKED = 6;
    const STATE_SEEKING = 7;
    const STATE_HOLDING = 8;
    const STATE_RECOVERING = 9;
    const STATE_VACATING = 10;
    const PHASE_MILLING = 0;
    const PHASE_VACATING = 5;
    const AGENT_RADIUS = 0.42;
    const TARGET_RADIUS = AGENT_RADIUS;
    const COMBAT_RING_RADIUS = 1.6;
    const TARGET_KEYBOARD_MOVE_SPEED = 5.67;
    const TARGET_KEYBOARD_FAST_MOVE_SPEED = 14.49;
    const TARGET_KEYBOARD_SIDEWAYS_SPEED_MULTIPLIER = 2 / 3;
    const TARGET_KEYBOARD_FORWARD_DIAGONAL_SPEED_MULTIPLIER = 5 / 6;
    const TARGET_KEYBOARD_BACKWARD_SPEED_MULTIPLIER = 1 / 2;
    const TARGET_KEYBOARD_BACKWARD_DIAGONAL_SPEED_MULTIPLIER = 7 / 12;
    const TARGET_PROJECTED_CURSOR_DISTANCE = 5;
    const TARGET_IDLE_PROJECTED_CURSOR_DISTANCE = 2;
    const TARGET_IDLE_FACE_CURSOR_SECONDS = 1;
    const TARGET_IDLE_CURSOR_DISTANCE_SECONDS = 1;
    const TARGET_TURN_SPEED_MULTIPLIER = 1.3;
    const TARGET_PROJECTED_CURSOR_MIN_DISTANCE = 1;
    const TARGET_PROJECTED_CURSOR_MAX_DISTANCE = 10;
    const TARGET_PROJECTED_CURSOR_MIN_TURN_RADIUS = 0.5;
    const TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET = Math.PI / 2;
    const TARGET_PROJECTED_CURSOR_ANGLE_SPEED = TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET;
    const TARGET_PROJECTED_CURSOR_RETURN_ANGLE_SPEED_MULTIPLIER = 2.5;
    const TARGET_PROJECTED_CURSOR_OUTWARD_ANGLE_SPEED_MIN_MULTIPLIER = 0.2;
    const TARGET_PROJECTED_CURSOR_DISTANCE_SPEED = TARGET_PROJECTED_CURSOR_DISTANCE;
    const FIREBALL_SPEED = 13;
    const FIREBALL_MAX_AGE_SECONDS = 1.8;
    const FIREBALL_HITBOX_LENGTH = 1.1;
    const FIREBALL_HITBOX_WIDTH = 0.62;
    const FIREBALL_DAMAGE_RADIUS = FIREBALL_HITBOX_WIDTH * 0.5;
    const FIREBALL_EXPLOSION_DAMAGE_RADIUS = FIREBALL_DAMAGE_RADIUS * 3;
    const FIREBALL_EXPLOSION_VISUAL_SECONDS = 0.16;
    const SPEED_SCALE_MIN = 0.05;
    const SPEED_SCALE_MAX = 0.8;
    const SPEED_SCALE_DEFAULT = 0.2;
    const TARGET_NPC_PUSH_ITERATIONS = 96;
    const TARGET_NPC_PUSH_SLOP = 0.0005;
    const TARGET_NPC_PUSH_PLAYER_SHARE = 0.69;
    const NPC_NPC_PUSH_SHARE = 0.5;
    const VACATING_CONTACT_PUSH_FORCE = 10;
    const TARGET_NPC_PUSH_MIN_AXIS = 0.0001;
    const HEX_GRID_ROW_STEP = 1;
    const HEX_GRID_COL_STEP = 0.866;
    const HEX_GRID_WIDTH = 1 / HEX_GRID_COL_STEP;
    const HEX_GRID_HEIGHT = 1;
    const HEX_GRID_PADDING = 2;
    const PATH_NODE_LAYER_PADDING = 4;
    const WALL_WORLD_THICKNESS = 0.3;
    const WALL_WORLD_HALF_THICKNESS = WALL_WORLD_THICKNESS * 0.5;
    const PATH_NODE_WALL_THICKNESS = WALL_WORLD_THICKNESS;
    const PATH_NODE_WALL_FACE_EXTEND = 0.501;
    const PATH_NODE_X = 0;
    const PATH_NODE_Y = 1;
    const PATH_NODE_BLOCKED = 2;
    const PATH_NODE_CLEARANCE = 3;
    const PATH_NODE_XINDEX = 4;
    const PATH_NODE_YINDEX = 5;
    const PATH_NODE_HAS_UNBLOCKED_NEIGHBOR = 6;
    const PATH_EDGE_FROM = 0;
    const PATH_EDGE_TO = 1;
    const PATH_EDGE_DIRECTION = 2;
    const MAZE_CHUNK_MIN_SIZE = 28;
    const MAZE_CHUNK_MAX_SIZE = 72;
    const MAZE_SECTION_CACHE_LIMIT = 15;
    const MAZE_SECTION_NEARBY_LOAD_COUNT = 2;
    const MAZE_WORKER_STATUS_PREFIX = "maze";
    const MAZE_LOOKAHEAD_DISTANCE = 20;
    const MAZE_LOOKAHEAD_REFRESH_INTERVAL_MS = 1000;
    const MAZE_ROOM_EMPTY_ENEMY_CHANCE = 2 / 3;
    const MAZE_ROOM_MAX_ENEMY_CHANCE = 1 / 100;
    const MAZE_ROOM_MAX_ENEMIES = 100;
    const MAZE_ROOM_ENEMY_DISTRIBUTION_POWER = 3.25;
    const MAZE_ROOM_ENEMY_SAFE_RADIUS_SCALE = 0.56;
    const MAZE_SECTION_DIRECTIONS = [
        { q: 1, r: 0 },
        { q: 0, r: 1 },
        { q: -1, r: 1 },
        { q: -1, r: 0 },
        { q: 0, r: -1 },
        { q: 1, r: -1 }
    ];
    const PATH_MODE_DIRECT = 0;
    const PATH_MODE_WORKER = 1;
    const PATH_REQUEST_INTERVAL_SECONDS = 0.22;
    const PATH_WAYPOINT_REACHED_DISTANCE = 0.55;
    const HEADING_GLITCH_TURN_THRESHOLD = Math.PI / 5;
    const HEADING_GLITCH_RETURN_THRESHOLD = Math.PI / 10;
    const TARGET_CURSOR_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
    const TARGET_FORWARD_KEYS = {
        KeyW: 1,
        KeyS: -1
    };
    const TARGET_SIDEWAYS_KEYS = {
        KeyA: -1,
        KeyD: 1
    };
    const DEFAULT_SCENARIO = "proceduralMaze";
    const DEFAULT_AGENT_COUNT = 0;
    const DEFAULT_SEPARATION_STRENGTH = 7;
    const DEFAULT_MAZE_SEED = "hex-maze-1";
    const DEFAULT_MAZE_CHUNK_SIZE = 44;
    const DEFAULT_MAZE_ROOM_SCALE = 0.56;
    const DEFAULT_MAZE_TWISTINESS = 0.62;
    const WIZARD_POSITION_STORAGE_KEY = "wizardOfFlatland.savedWizardPosition.v1";
    const VIEW_ZOOM_MIN = 0.45;
    const VIEW_ZOOM_MAX = 3.2;
    const VIEW_ZOOM_WHEEL_STEP = 0.0015;

    const canvas = document.getElementById("solverCanvas");
    const ctx = canvas.getContext("2d");
    const playButton = document.getElementById("playButton");
    const stepButton = document.getElementById("stepButton");
    const resetButton = document.getElementById("resetButton");
    const scenarioSelect = document.getElementById("scenarioSelect");
    const agentCountInput = document.getElementById("agentCount");
    const separationInput = document.getElementById("separationStrength");
    const speedScaleInput = document.getElementById("speedScale");
    const mazeSeedInput = document.getElementById("mazeSeed");
    const mazeChunkSizeInput = document.getElementById("mazeChunkSize");
    const mazeRoomScaleInput = document.getElementById("mazeRoomScale");
    const mazeTwistinessInput = document.getElementById("mazeTwistiness");
    let speedScaleControlValue = speedScaleInput ? Number(speedScaleInput.value) : 0.5;

    const labels = {
        agentCount: document.getElementById("agentCountValue"),
        separationStrength: document.getElementById("separationStrengthValue"),
        speedScale: document.getElementById("speedScaleValue"),
        mazeChunkSize: document.getElementById("mazeChunkSizeValue"),
        mazeRoomScale: document.getElementById("mazeRoomScaleValue"),
        mazeTwistiness: document.getElementById("mazeTwistinessValue"),
        workerStatus: document.getElementById("workerStatus"),
        solveMs: document.getElementById("solveMs"),
        pairChecks: document.getElementById("pairChecks"),
        movingCount: document.getElementById("movingCount"),
        seekingCount: document.getElementById("seekingCount"),
        waitingCount: document.getElementById("waitingCount"),
        attackingCount: document.getElementById("attackingCount"),
        retreatingCount: document.getElementById("retreatingCount"),
        blockedCount: document.getElementById("blockedCount"),
        wallLeaks: document.getElementById("wallLeaks"),
        profilerSummary: document.getElementById("profilerSummary"),
        profilerRows: document.getElementById("profilerRows")
    };

    const state = {
        running: true,
        requestId: 1,
        waitingForWorker: false,
        solverWallVersion: 0,
        pathfindingRequestId: 1,
        pathfindingSnapshotVersion: 0,
        worldVersion: 1,
        lastTime: performance.now(),
        agents: [],
        fireballs: [],
        fireballExplosions: [],
        walls: createEmptyWallBuffer(),
        manualWalls: createEmptyWallBuffer(),
        generatedMazeWalls: createEmptyWallBuffer(),
        generatedMazeChunkKeys: new Set(),
        generatedMazeInstalledChunkKeys: new Set(),
        generatedMazeSignature: "",
        generatedMazeRequestId: 1,
        generatedMazeActiveRequestId: 0,
        generatedMazePendingSignature: "",
        generatedMazeLoading: false,
        generatedMazeLookaheadKeys: [],
        generatedMazeLookaheadNextRefreshAt: 0,
        generatedMazePopulatedSectionKeys: new Set(),
        target: { x: 0, y: 0, heading: -Math.PI / 2 },
        targetTravelVector: { x: 0, y: 0 },
        lastSentTarget: { x: 0, y: 0 },
        targetFlashTime: 0,
        targetPushes: 0,
        projectedCursor: {
            angleOffset: 0,
            distance: TARGET_PROJECTED_CURSOR_DISTANCE
        },
        pressedMovementKeys: Object.create(null),
        spaceHeld: false,
        zoomHeld: false,
        fastMovementHeld: false,
        stats: null,
        debug: createWizardOfFlatlandDebugState(),
        wallTool: {
            active: false,
            dragging: false,
            pointerId: null,
            startNode: null,
            hoverNode: null
        },
        view: { width: 0, height: 0, dpr: 1, scale: 1, baseScale: 1, zoom: 1, offsetX: 0, offsetY: 0, centerX: 0, centerY: 0 },
        hexGridLayer: {
            canvas: document.createElement("canvas"),
            ctx: null,
            width: 0,
            height: 0,
            scale: 0,
            offsetX: 0,
            offsetY: 0,
            centerX: NaN,
            centerY: NaN,
            dirty: true
        },
        nodeLayer: {
            nodes: new Float32Array(0),
            snapshotNodes: new Float32Array(0),
            edges: new Int32Array(0),
            blockedEdges: new Int32Array(0),
            indexByKey: new Map(),
            nodeStride: PATH_SNAPSHOT_NODE_STRIDE,
            edgeStride: PATH_SNAPSHOT_EDGE_STRIDE,
            version: 0,
            canvas: document.createElement("canvas"),
            ctx: null,
            width: 0,
            height: 0,
            scale: 0,
            offsetX: 0,
            offsetY: 0,
            centerX: NaN,
            centerY: NaN,
            renderedVersion: -1,
            renderedShowPathBlockedEdges: false,
            pathCenterX: NaN,
            pathCenterY: NaN,
            dirty: true
        }
    };
    state.hexGridLayer.ctx = state.hexGridLayer.canvas.getContext("2d");
    state.nodeLayer.ctx = state.nodeLayer.canvas.getContext("2d");
    const profiler = createWizardOfFlatlandProfiler();
    attachWizardOfFlatlandDebugGlobals(state, profiler);

    const worker = new Worker("/wizard-of-flatland/solverWorker.js?v=wizard-of-flatland-80");
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", (event) => {
        setLabelText(labels.workerStatus, event.message || "failed");
    });

    const pathfindingWorker = new Worker("/wizard-of-flatland/pathfindingWorker.js?v=wizard-of-flatland-1");
    pathfindingWorker.addEventListener("message", handlePathfindingWorkerMessage);
    pathfindingWorker.addEventListener("error", (event) => {
        setLabelText(labels.workerStatus, event.message || "pathfinding failed");
    });

    const mazeWorker = new Worker("/wizard-of-flatland/mazeSectionWorker.js?v=wizard-of-flatland-26");
    mazeWorker.addEventListener("message", handleMazeWorkerMessage);
    mazeWorker.addEventListener("error", (event) => {
        state.generatedMazeLoading = false;
        setLabelText(labels.workerStatus, event.message || "maze worker failed");
    });

    function setLabelText(label, text) {
        if (label) label.textContent = text;
    }

    function getControlNumber(input, fallback) {
        if (!input) return fallback;
        const value = Number(input.value);
        return Number.isFinite(value) ? value : fallback;
    }

    function getWizardOfFlatlandDebugApi() {
        if (typeof window === "undefined" || !window.WizardOfFlatlandDebug) {
            throw new Error("Wizard of Flatland requires /wizard-of-flatland/debug.js");
        }
        return window.WizardOfFlatlandDebug;
    }

    function createWizardOfFlatlandDebugState() {
        const api = getWizardOfFlatlandDebugApi();
        if (typeof api.createDebugState !== "function") {
            throw new Error("Wizard of Flatland debug.js requires createDebugState");
        }
        return api.createDebugState();
    }

    function attachWizardOfFlatlandDebugGlobals(stateRef, profilerRef) {
        const api = getWizardOfFlatlandDebugApi();
        if (typeof api.attachDebugGlobals !== "function") {
            throw new Error("Wizard of Flatland debug.js requires attachDebugGlobals");
        }
        return api.attachDebugGlobals(stateRef, profilerRef);
    }

    function createWizardOfFlatlandProfiler() {
        const maxLoads = 12;
        const maxRows = 12;
        const loadRecords = [];
        const longTasks = [];
        const frameHitches = [];
        let currentLoad = null;
        let lastCompletedLoad = null;
        let pendingFrameAfterLoad = null;

        const api = {
            enabled: true,
            consoleLogging: false,
            loadRecords,
            longTasks,
            frameHitches,
            beginLoad,
            mark,
            span,
            completeLoad,
            noteFrame,
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
            const record = { duration, at: performance.now(), parts: parts || null };
            frameHitches.push(record);
            while (frameHitches.length > 40) frameHitches.shift();
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

    function updateControlLabels() {
        setLabelText(labels.agentCount, String(getAgentCount()));
        setLabelText(labels.separationStrength, getSeparationStrength().toFixed(1));
        setLabelText(labels.speedScale, getSpeedScale().toFixed(2));
        setLabelText(labels.mazeChunkSize, String(getMazeChunkSize()));
        setLabelText(labels.mazeRoomScale, getMazeRoomScale().toFixed(2));
        setLabelText(labels.mazeTwistiness, getMazeTwistiness().toFixed(2));
    }

    function getSpeedScale() {
        const t = Math.max(0, Math.min(1, getControlNumber(speedScaleInput, speedScaleControlValue)));
        return SPEED_SCALE_MIN * Math.pow(SPEED_SCALE_MAX / SPEED_SCALE_MIN, t);
    }

    function setSpeedScaleValue(value) {
        const scale = Math.max(SPEED_SCALE_MIN, Math.min(SPEED_SCALE_MAX, Number(value)));
        const t = Math.log(scale / SPEED_SCALE_MIN) / Math.log(SPEED_SCALE_MAX / SPEED_SCALE_MIN);
        speedScaleControlValue = Math.max(0, Math.min(1, t));
        if (speedScaleInput) speedScaleInput.value = String(speedScaleControlValue);
    }

    function getAgentCount() {
        return Math.max(0, Math.round(getControlNumber(agentCountInput, DEFAULT_AGENT_COUNT)));
    }

    function getSeparationStrength() {
        return getControlNumber(separationInput, DEFAULT_SEPARATION_STRENGTH);
    }

    function getScenarioValue() {
        return scenarioSelect ? scenarioSelect.value : DEFAULT_SCENARIO;
    }

    function getMazeChunkSize() {
        return Math.max(
            MAZE_CHUNK_MIN_SIZE,
            Math.min(MAZE_CHUNK_MAX_SIZE, Math.round(getControlNumber(mazeChunkSizeInput, DEFAULT_MAZE_CHUNK_SIZE)))
        );
    }

    function getMazeSeed() {
        const seed = String(mazeSeedInput ? mazeSeedInput.value : DEFAULT_MAZE_SEED).trim();
        return seed.length > 0 ? seed : DEFAULT_MAZE_SEED;
    }

    function getMazeRoomScale() {
        return Math.max(0, Math.min(1, getControlNumber(mazeRoomScaleInput, DEFAULT_MAZE_ROOM_SCALE)));
    }

    function getMazeTwistiness() {
        return Math.max(0, Math.min(1, getControlNumber(mazeTwistinessInput, DEFAULT_MAZE_TWISTINESS)));
    }

    function getMazeOptions() {
        return {
            seed: getMazeSeed(),
            chunkSize: getMazeChunkSize(),
            roomScale: getMazeRoomScale(),
            twistiness: getMazeTwistiness()
        };
    }

    function isProceduralMazeScenario() {
        return getScenarioValue() === "proceduralMaze";
    }

    function hashString(value) {
        const text = String(value || "");
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    function seededRandom(seed) {
        let stateValue = seed >>> 0;
        return function nextRandom() {
            stateValue = (Math.imul(stateValue, 1664525) + 1013904223) >>> 0;
            return stateValue / 4294967296;
        };
    }

    function isUsableWallSegment(ax, ay, bx, by) {
        if (Math.hypot(bx - ax, by - ay) <= 0.001) return null;
        return true;
    }

    function getMazeSectionRadius(options) {
        return Math.max(8, Number(options.chunkSize) * 0.5);
    }

    function mazeSectionKey(q, r) {
        return `${q},${r}`;
    }

    function parseMazeSectionKey(key) {
        const parts = String(key).split(",");
        return {
            q: Number(parts[0]),
            r: Number(parts[1])
        };
    }

    function mazeSectionCenter(q, r, options) {
        const radius = getMazeSectionRadius(options);
        return {
            x: Math.sqrt(3) * radius * (q + r * 0.5),
            y: 1.5 * radius * r
        };
    }

    function worldToMazeSectionCoord(x, y, options) {
        const radius = getMazeSectionRadius(options);
        const qFloat = (Math.sqrt(3) / 3 * x - y / 3) / radius;
        const rFloat = (2 / 3 * y) / radius;
        return roundAxial(qFloat, rFloat);
    }

    function roundAxial(qFloat, rFloat) {
        let q = Math.round(qFloat);
        let r = Math.round(rFloat);
        let s = Math.round(-qFloat - rFloat);
        const qDiff = Math.abs(q - qFloat);
        const rDiff = Math.abs(r - rFloat);
        const sDiff = Math.abs(s + qFloat + rFloat);
        if (qDiff > rDiff && qDiff > sDiff) q = -r - s;
        else if (rDiff > sDiff) r = -q - s;
        return { q, r };
    }

    function getMazeStartPoint() {
        return mazeSectionCenter(0, 0, getMazeOptions());
    }

    function getRequiredMazeSectionKeys(options) {
        const current = worldToMazeSectionCoord(state.target.x, state.target.y, options);
        const currentKey = mazeSectionKey(current.q, current.r);
        const keys = [currentKey];
        const viewportKeys = computeMazeViewportSectionKeys(options);
        for (const key of viewportKeys) {
            if (!keys.includes(key)) keys.push(key);
        }
        const neighbors = [];
        for (let i = 0; i < MAZE_SECTION_DIRECTIONS.length; i++) {
            const dir = MAZE_SECTION_DIRECTIONS[i];
            const q = current.q + dir.q;
            const r = current.r + dir.r;
            const center = mazeSectionCenter(q, r, options);
            neighbors.push({
                key: mazeSectionKey(q, r),
                distance: Math.hypot(center.x - state.target.x, center.y - state.target.y)
            });
        }
        neighbors.sort((a, b) => a.distance - b.distance);
        for (const entry of neighbors.slice(0, MAZE_SECTION_NEARBY_LOAD_COUNT)) {
            if (!keys.includes(entry.key)) keys.push(entry.key);
        }
        const lookaheadKeys = getMazeLookaheadSectionKeys(options);
        for (const key of lookaheadKeys) {
            if (keys.length >= MAZE_SECTION_CACHE_LIMIT) break;
            if (!keys.includes(key)) keys.push(key);
        }
        return keys;
    }

    function computeMazeViewportSectionKeys(options) {
        const rect = getCurrentMazeViewportRect();
        if (!rect) return [];
        return computeMazeSectionKeysIntersectingRect(options, rect);
    }

    function getMazeLookaheadSectionKeys(options) {
        const now = performance.now();
        if (Array.isArray(state.generatedMazeLookaheadKeys) && now < state.generatedMazeLookaheadNextRefreshAt) {
            return state.generatedMazeLookaheadKeys;
        }
        const keys = computeMazeLookaheadSectionKeys(options);
        state.generatedMazeLookaheadKeys = keys;
        state.generatedMazeLookaheadNextRefreshAt = now + MAZE_LOOKAHEAD_REFRESH_INTERVAL_MS;
        return keys;
    }

    function computeMazeLookaheadSectionKeys(options) {
        const rect = getProjectedMazeViewportRect();
        if (!rect) return [];
        return computeMazeSectionKeysIntersectingRect(options, rect);
    }

    function computeMazeSectionKeysIntersectingRect(options, rect) {
        const center = {
            x: (rect.minX + rect.maxX) * 0.5,
            y: (rect.minY + rect.maxY) * 0.5
        };
        const centerCoord = worldToMazeSectionCoord(center.x, center.y, options);
        const sectionRadius = getMazeSectionRadius(options);
        const halfDiagonal = Math.hypot(rect.maxX - rect.minX, rect.maxY - rect.minY) * 0.5;
        const searchRadius = Math.max(1, Math.ceil((halfDiagonal + sectionRadius) / sectionRadius) + 1);
        const hits = [];
        for (let dq = -searchRadius; dq <= searchRadius; dq++) {
            for (let dr = -searchRadius; dr <= searchRadius; dr++) {
                const q = centerCoord.q + dq;
                const r = centerCoord.r + dr;
                const sectionCenter = mazeSectionCenter(q, r, options);
                const polygon = getHexCornersWorld(sectionCenter.x, sectionCenter.y, sectionRadius);
                if (!polygonIntersectsAxisAlignedRect(polygon, rect)) continue;
                hits.push({
                    key: mazeSectionKey(q, r),
                    distance: Math.hypot(sectionCenter.x - state.target.x, sectionCenter.y - state.target.y)
                });
            }
        }
        hits.sort((a, b) => a.distance - b.distance);
        return hits.map((entry) => entry.key);
    }

    function getCurrentMazeViewportRect() {
        const view = state.view;
        if (!view || !(view.width > 0 && view.height > 0 && view.scale > 0)) return null;
        const halfWidth = view.width / view.scale * 0.5;
        const halfHeight = view.height / view.scale * 0.5;
        return {
            minX: state.target.x - halfWidth,
            minY: state.target.y - halfHeight,
            maxX: state.target.x + halfWidth,
            maxY: state.target.y + halfHeight
        };
    }

    function getProjectedMazeViewportRect() {
        const view = state.view;
        if (!view || !(view.width > 0 && view.height > 0 && view.scale > 0)) return null;
        const dx = Math.cos(state.target.heading) * MAZE_LOOKAHEAD_DISTANCE;
        const dy = Math.sin(state.target.heading) * MAZE_LOOKAHEAD_DISTANCE;
        const halfWidth = view.width / view.scale * 0.5;
        const halfHeight = view.height / view.scale * 0.5;
        return {
            minX: state.target.x + dx - halfWidth,
            minY: state.target.y + dy - halfHeight,
            maxX: state.target.x + dx + halfWidth,
            maxY: state.target.y + dy + halfHeight
        };
    }

    function invalidateMazeLookaheadCache() {
        state.generatedMazeLookaheadKeys = [];
        state.generatedMazeLookaheadNextRefreshAt = 0;
    }

    function polygonIntersectsAxisAlignedRect(polygon, rect) {
        if (!Array.isArray(polygon) || polygon.length < 3) {
            throw new Error("Wizard of Flatland maze lookahead requires a section polygon");
        }
        if (!rect || !Number.isFinite(rect.minX) || !Number.isFinite(rect.minY) || !Number.isFinite(rect.maxX) || !Number.isFinite(rect.maxY)) {
            throw new Error("Wizard of Flatland maze lookahead requires a finite viewport rectangle");
        }
        for (const point of polygon) {
            if (point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY) return true;
        }
        const corners = [
            { x: rect.minX, y: rect.minY },
            { x: rect.maxX, y: rect.minY },
            { x: rect.maxX, y: rect.maxY },
            { x: rect.minX, y: rect.maxY }
        ];
        for (const corner of corners) {
            if (pointInPolygon(corner.x, corner.y, polygon)) return true;
        }
        const edges = [
            [corners[0], corners[1]],
            [corners[1], corners[2]],
            [corners[2], corners[3]],
            [corners[3], corners[0]]
        ];
        for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i];
            const b = polygon[(i + 1) % polygon.length];
            for (const edge of edges) {
                if (segmentIntersectionParameters(a.x, a.y, b.x, b.y, edge[0].x, edge[0].y, edge[1].x, edge[1].y)) {
                    return true;
                }
            }
        }
        return false;
    }

    function getMazeSignature(options, keys) {
        return [
            options.seed,
            options.chunkSize,
            options.roomScale.toFixed(3),
            options.twistiness.toFixed(3),
            keys.join(";")
        ].join("|");
    }

    function refreshGeneratedMazeIfNeeded(force = false) {
        if (!isProceduralMazeScenario()) return false;
        const options = getMazeOptions();
        const requiredKeys = getRequiredMazeSectionKeys(options);
        const requiredSet = new Set(requiredKeys);
        let changed = force;

        if (!(state.generatedMazeChunkKeys instanceof Set)) {
            state.generatedMazeChunkKeys = new Set();
            changed = true;
        }
        for (const key of requiredKeys) {
            if (state.generatedMazeChunkKeys.has(key)) continue;
            state.generatedMazeChunkKeys.add(key);
            changed = true;
        }
        while (state.generatedMazeChunkKeys.size > MAZE_SECTION_CACHE_LIMIT) {
            const removed = removeFurthestGeneratedMazeSection(options, requiredSet);
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
        if (!mazeWorker || typeof mazeWorker.postMessage !== "function") {
            throw new Error("Wizard of Flatland procedural maze requires a section worker");
        }
        const bounds = getPathfindingLayerBounds();
        const manualWalls = cloneWallBuffer(state.manualWalls, "manual walls");
        const requestId = state.generatedMazeRequestId++;
        state.generatedMazeActiveRequestId = requestId;
        state.generatedMazePendingSignature = signature;
        state.generatedMazeLoading = true;
        profiler.beginLoad({ requestId, signature, keys });
        setLabelText(labels.workerStatus, `${MAZE_WORKER_STATUS_PREFIX} loading`);
        profiler.span("post maze worker request", () => {
            mazeWorker.postMessage({
                type: "build_maze_sections",
                requestId,
                signature,
                options,
                keys,
                manualWalls,
                bounds,
                targetRadius: TARGET_RADIUS
            }, [manualWalls.buffer]);
        });
    }

    function handleMazeWorkerMessage(event) {
        const message = event && event.data ? event.data : null;
        if (!message || typeof message.type !== "string") return;
        if (message.type === "ready") return;
        if (message.type === "error") {
            if (Number(message.requestId) !== Number(state.generatedMazeActiveRequestId)) return;
            state.generatedMazeLoading = false;
            setLabelText(labels.workerStatus, message.message || "maze error");
            return;
        }
        if (message.type !== "maze_sections_result") return;
        if (Number(message.requestId) !== Number(state.generatedMazeActiveRequestId)) return;
        if (message.signature !== state.generatedMazePendingSignature) return;
        profiler.mark("maze worker result received", {
            generatedWallSegments: message.generatedWalls instanceof Float32Array ? message.generatedWalls.length / WALL_STRIDE : 0,
            nodeCount: message.nodeLayer && message.nodeLayer.nodes instanceof Float32Array ? message.nodeLayer.nodes.length / 4 : 0
        });
        installGeneratedMazeWorkerResult(message);
    }

    function installGeneratedMazeWorkerResult(message) {
        if (!message || typeof message.signature !== "string" || !message.nodeLayer) {
            throw new Error("Wizard of Flatland maze worker result is malformed");
        }
        profiler.span("validate wall buffers", () => {
            validateWallBuffer(message.generatedWalls, "generated maze walls");
            validateWallBuffer(message.allWalls, "maze pathfinding walls");
            validateWallLabelBuffer(message.generatedWalls, "generated maze wall labels");
            validateWallLabelBuffer(message.allWalls, "maze pathfinding wall labels");
        });
        const generatedWalls = message.generatedWalls;
        const allWalls = message.allWalls;
        const manualOffset = generatedWalls.length;
        if (allWalls.length !== generatedWalls.length + state.manualWalls.length) {
            throw new Error("Wizard of Flatland maze worker wall count does not match active manual walls");
        }
        profiler.span("validate manual wall echo", () => {
            for (let i = 0; i < state.manualWalls.length; i++) {
                if (Math.abs(state.manualWalls[i] - allWalls[manualOffset + i]) > 0.0001) {
                    throw new Error("Wizard of Flatland maze worker result is stale for manual walls");
                }
            }
        });

        profiler.span("install wall buffers and section keys", () => {
            state.generatedMazeWalls = generatedWalls;
            state.walls = allWalls;
            state.generatedMazeSignature = message.signature;
            state.generatedMazePendingSignature = "";
            state.generatedMazeLoading = false;
            state.generatedMazeActiveRequestId = 0;
            state.generatedMazeInstalledChunkKeys = new Set(state.generatedMazeChunkKeys);
            state.worldVersion += 1;
        });
        profiler.span("populate maze rooms", () => populateGeneratedMazeRooms(getMazeOptions()));
        profiler.span("install pathfinding node layer", () => {
            installPathfindingNodeLayerFromWorker(message.nodeLayer);
        });
        profiler.span("constrain target to walls", () => constrainTargetToWalls());
        profiler.span("constrain or freeze agents", () => {
            for (const agent of state.agents) {
                if (isAgentInInstalledMazeSection(agent)) {
                    constrainAgentToWalls(agent);
                } else {
                    freezeAgentForUnloadedSection(agent);
                }
            }
        });
        profiler.span("resolve target npc contacts", () => resolveTargetNpcContacts());
        setLabelText(labels.workerStatus, "ready");
        profiler.completeLoad({
            sections: state.generatedMazeInstalledChunkKeys.size,
            walls: getWallCount(state.walls),
            generatedWalls: getWallCount(state.generatedMazeWalls),
            manualWalls: getWallCount(state.manualWalls),
            nodes: getPathfindingNodeCount(),
            blockedEdges: getPathfindingBlockedEdgeCount()
        });
    }

    function clearAgentPathRequestsForMapRebuild() {
        for (const agent of state.agents) {
            agent.pathMode = PATH_MODE_DIRECT;
            agent.pathRequestPending = false;
            agent.pathRequestId = 0;
            agent.pathRequestedWorldVersion = 0;
            agent.pathRequestedRawStartKey = "";
            agent.pathRequestedStartKey = "";
            agent.pathRequestedGoalKey = "";
            agent.pathNodeKeys = [];
            agent.pathWaypoints = [];
            agent.pathCursor = 0;
            agent.pathGoalX = agent.x;
            agent.pathGoalY = agent.y;
        }
    }

    function installPathfindingNodeLayerFromWorker(workerLayer) {
        const packedNodes = workerLayer.nodes;
        const snapshotNodes = workerLayer.snapshotNodes;
        const packedEdges = workerLayer.edges;
        const packedBlockedEdges = workerLayer.blockedEdges;
        if (!(packedNodes instanceof Float32Array) || packedNodes.length % PATH_SNAPSHOT_NODE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland maze worker nodes are malformed");
        }
        if (!(snapshotNodes instanceof Float32Array) || snapshotNodes.length !== packedNodes.length) {
            throw new Error("Wizard of Flatland maze worker snapshot nodes are malformed");
        }
        if (!(packedEdges instanceof Int32Array) || packedEdges.length % PATH_SNAPSHOT_EDGE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland maze worker path edges are malformed");
        }
        if (!(packedBlockedEdges instanceof Int32Array) || packedBlockedEdges.length % PATH_SNAPSHOT_EDGE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland maze worker blocked edges are malformed");
        }

        state.nodeLayer.pathCenterX = Number(workerLayer.pathCenterX);
        state.nodeLayer.pathCenterY = Number(workerLayer.pathCenterY);
        if (!Number.isFinite(state.nodeLayer.pathCenterX) || !Number.isFinite(state.nodeLayer.pathCenterY)) {
            throw new Error("Wizard of Flatland maze worker path center is invalid");
        }
        state.nodeLayer.nodes = packedNodes;
        state.nodeLayer.snapshotNodes = snapshotNodes;
        state.nodeLayer.edges = packedEdges;
        state.nodeLayer.blockedEdges = packedBlockedEdges;
        state.nodeLayer.indexByKey = buildPathfindingNodeIndexByKey(packedNodes);
        state.nodeLayer.nodeStride = PATH_SNAPSHOT_NODE_STRIDE;
        state.nodeLayer.edgeStride = PATH_SNAPSHOT_EDGE_STRIDE;
        state.nodeLayer.version += 1;
        state.nodeLayer.dirty = true;
        profiler.span("publish pathfinding snapshot", () => publishPathfindingSnapshot());
    }

    function buildPathfindingNodeIndexByKey(packedNodes) {
        if (!(packedNodes instanceof Float32Array) || packedNodes.length % PATH_SNAPSHOT_NODE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland path node key index requires packed nodes");
        }
        const indexByKey = new Map();
        const count = packedNodes.length / PATH_SNAPSHOT_NODE_STRIDE;
        for (let pathIndex = 0; pathIndex < count; pathIndex++) {
            const base = pathIndex * PATH_SNAPSHOT_NODE_STRIDE;
            if (!Number.isFinite(packedNodes[base + PATH_NODE_XINDEX]) || !Number.isFinite(packedNodes[base + PATH_NODE_YINDEX])) {
                throw new Error(`Wizard of Flatland path node key index found invalid node coordinates at index ${pathIndex}`);
            }
            const xindex = Math.round(packedNodes[base + PATH_NODE_XINDEX]);
            const yindex = Math.round(packedNodes[base + PATH_NODE_YINDEX]);
            const key = pathfindingNodeKey(xindex, yindex);
            if (indexByKey.has(key)) {
                throw new Error(`Wizard of Flatland path node key index found duplicate node key ${key}`);
            }
            indexByKey.set(key, pathIndex);
        }
        return indexByKey;
    }

    function createEmptyWallBuffer() {
        return new Float32Array(0);
    }

    function getWallCount(walls) {
        validateWallBuffer(walls, "walls");
        return walls.length / WALL_STRIDE;
    }

    function validateWallBuffer(walls, label) {
        if (!(walls instanceof Float32Array)) throw new Error(`Wizard of Flatland ${label} must be a wall buffer`);
        if (walls.length % WALL_STRIDE !== 0) throw new Error(`Wizard of Flatland ${label} has an invalid wall stride`);
    }

    function appendWallSegment(walls, ax, ay, bx, by, labelCode, sideCode = -1) {
        validateWallSegment(ax, ay, bx, by);
        validateWallLabelCode(labelCode, sideCode);
        const next = new Float32Array(walls.length + WALL_STRIDE);
        next.set(walls);
        writeWallSegment(next, walls.length, ax, ay, bx, by, labelCode, sideCode);
        return next;
    }

    function concatWallBuffers(left, right) {
        validateWallBuffer(left, "left wall buffer");
        validateWallBuffer(right, "right wall buffer");
        const out = new Float32Array(left.length + right.length);
        out.set(left);
        out.set(right, left.length);
        return out;
    }

    function cloneWallBuffer(walls, label = "wall buffer") {
        validateWallBuffer(walls, label);
        return walls.slice();
    }

    function writeWallSegment(walls, base, ax, ay, bx, by, labelCode, sideCode) {
        walls[base + WALL_X1] = ax;
        walls[base + WALL_Y1] = ay;
        walls[base + WALL_X2] = bx;
        walls[base + WALL_Y2] = by;
        walls[base + WALL_LABEL_CODE] = labelCode;
        walls[base + WALL_LABEL_SIDE] = sideCode;
        walls[base + 6] = 0;
        walls[base + 7] = 0;
    }

    function validateWallLabelCode(labelCode, sideCode) {
        if (!Number.isInteger(labelCode) || labelCode <= 0) {
            throw new Error("Wizard of Flatland wall segment requires a label code");
        }
        if (!Number.isInteger(sideCode)) {
            throw new Error("Wizard of Flatland wall segment requires a side code");
        }
    }

    function validateWallSegment(ax, ay, bx, by) {
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
            throw new Error("Wizard of Flatland wall segment requires finite coordinates");
        }
        if (Math.hypot(bx - ax, by - ay) <= 0.001) {
            throw new Error("Wizard of Flatland wall segment requires separated endpoints");
        }
    }

    function removeFurthestGeneratedMazeSection(options, protectedKeys) {
        let furthest = null;
        for (const key of state.generatedMazeChunkKeys) {
            if (protectedKeys.has(key)) continue;
            const coord = parseMazeSectionKey(key);
            const center = mazeSectionCenter(coord.q, coord.r, options);
            const distance = Math.hypot(center.x - state.target.x, center.y - state.target.y);
            if (!furthest || distance > furthest.distance) furthest = { key, distance };
        }
        if (!furthest) return false;
        state.generatedMazeChunkKeys.delete(furthest.key);
        removeAutoSpawnedAgentsInMazeSection(furthest.key);
        state.generatedMazePopulatedSectionKeys.delete(furthest.key);
        freezeAgentsInMazeSection(furthest.key, options);
        return true;
    }

    function removeAutoSpawnedAgentsInMazeSection(sectionKey) {
        if (typeof sectionKey !== "string" || sectionKey.length === 0) {
            throw new Error("Wizard of Flatland auto enemy cleanup requires a section key");
        }
        state.agents = state.agents.filter((agent) => agent.autoSpawnSectionKey !== sectionKey);
    }

    function resetGeneratedMazeEnemyPopulation() {
        state.agents = state.agents.filter((agent) => typeof agent.autoSpawnSectionKey !== "string");
        state.generatedMazePopulatedSectionKeys = new Set();
    }

    function freezeAgentsInMazeSection(sectionKey, options) {
        for (const agent of state.agents) {
            if (getActorMazeSectionKey(agent, options) !== sectionKey) continue;
            freezeAgentForUnloadedSection(agent);
        }
    }

    function freezeAgentForUnloadedSection(agent) {
        agent.vx = 0;
        agent.vy = 0;
        agent.wallClamps = 0;
        agent.pathMode = PATH_MODE_DIRECT;
        agent.pathRequestPending = false;
        agent.pathRequestId = 0;
        agent.pathNodeKeys = [];
        agent.pathWaypoints = [];
        agent.pathCursor = 0;
        agent.pathGoalX = agent.x;
        agent.pathGoalY = agent.y;
    }

    function getActorMazeSectionKey(actor, options = getMazeOptions()) {
        const coord = worldToMazeSectionCoord(actor.x, actor.y, options);
        return mazeSectionKey(coord.q, coord.r);
    }

    function isAgentInInstalledMazeSection(agent) {
        if (!isProceduralMazeScenario()) return true;
        if (!(state.generatedMazeInstalledChunkKeys instanceof Set)) {
            throw new Error("Wizard of Flatland procedural maze requires installed section tracking");
        }
        const sectionKey = getActorMazeSectionKey(agent);
        return state.generatedMazeInstalledChunkKeys.has(sectionKey) && state.generatedMazeChunkKeys.has(sectionKey);
    }

    function refreshMazePathBoundsIfNeeded() {
        if (!isProceduralMazeScenario()) return false;
        if (state.generatedMazeLoading) return false;
        const radius = getMazeSectionRadius(getMazeOptions());
        const dx = state.target.x - state.nodeLayer.pathCenterX;
        const dy = state.target.y - state.nodeLayer.pathCenterY;
        if (Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) < radius * 0.35) return false;
        const options = getMazeOptions();
        const keys = Array.from(state.generatedMazeChunkKeys).sort();
        if (keys.length === 0) {
            refreshGeneratedMazeIfNeeded(true);
            return true;
        }
        requestGeneratedMazeRefresh(options, keys, getMazeSignature(options, keys));
        return true;
    }

    function getHexCornersWorld(cx, cy, radius) {
        const corners = [];
        for (let i = 0; i < 6; i++) {
            const angle = (-30 + i * 60) * Math.PI / 180;
            corners.push({
                x: cx + Math.cos(angle) * radius,
                y: cy + Math.sin(angle) * radius
            });
        }
        return corners;
    }

    function addSegmentWall(ax, ay, bx, by) {
        if (!isUsableWallSegment(ax, ay, bx, by)) return false;
        if (isProceduralMazeScenario()) {
            state.manualWalls = appendWallSegment(state.manualWalls, ax, ay, bx, by, WALL_LABEL_MANUAL_TOOL);
            state.walls = concatWallBuffers(state.generatedMazeWalls, state.manualWalls);
            state.generatedMazeSignature = "";
            refreshGeneratedMazeIfNeeded(true);
        } else {
            state.walls = appendWallSegment(state.walls, ax, ay, bx, by, WALL_LABEL_MANUAL_TOOL);
            state.worldVersion += 1;
            rebuildPathfindingNodeLayer();
        }
        constrainTargetToWalls();
        for (const agent of state.agents) {
            constrainAgentToWalls(agent);
        }
        resolveTargetNpcContacts();
        return true;
    }

    function createScenario() {
        state.worldVersion += 1;
        state.agents = [];
        state.fireballs = [];
        state.fireballExplosions = [];
        state.walls = createEmptyWallBuffer();
        state.manualWalls = createEmptyWallBuffer();
        state.generatedMazeWalls = createEmptyWallBuffer();
        state.generatedMazeChunkKeys = new Set();
        state.generatedMazeInstalledChunkKeys = new Set();
        state.generatedMazeSignature = "";
        state.generatedMazePendingSignature = "";
        state.generatedMazeLoading = false;
        state.generatedMazePopulatedSectionKeys = new Set();
        invalidateMazeLookaheadCache();
        clearPathfindingNodeLayer();
        const count = getAgentCount();
        const scenario = getScenarioValue();
        if (scenario === "openArena") {
            state.target = { x: 0, y: 0, heading: -Math.PI / 2 };
            addRoomWalls(-18, -12, 18, 12);
            spawnRing(count, 10, 3.5);
        } else if (scenario === "crowdedArena") {
            state.target = { x: 0, y: 0, heading: -Math.PI / 2 };
            addRoomWalls(-10, -7.5, 10, 7.5);
            spawnCluster(count, -4.2, 0, 4.4, 10);
        } else if (scenario === "proceduralMaze") {
            const start = getMazeStartPoint();
            state.target = { x: start.x, y: start.y, heading: -Math.PI / 2 };
            refreshGeneratedMazeIfNeeded(true);
            spawnCluster(count, state.target.x + 5.5, state.target.y + 1.5, 7.5, 7.5);
        } else {
            state.target = { x: 0, y: 0, heading: -Math.PI / 2 };
            addRoomWalls(-8, -6, 8, 6);
            addRoomWalls(-18, -12, 18, 12);
            spawnCluster(count, 0, 0.8, 4.8, 5);
        }
        state.lastSentTarget = { x: state.target.x, y: state.target.y };
        clearTargetTravelVector();
        if (!isProceduralMazeScenario()) {
            rebuildPathfindingNodeLayer();
            enforceInitialWallConstraints();
        }
    }

    function getWizardPositionStorage() {
        if (typeof window === "undefined" || !window.localStorage) {
            throw new Error("Wizard of Flatland position save requires window.localStorage");
        }
        return window.localStorage;
    }

    function getWizardPositionSnapshot() {
        validateWizardPositionTarget(state.target, "current wizard position");
        return {
            version: 1,
            savedAt: new Date().toISOString(),
            scenario: getScenarioValue(),
            maze: getMazeOptions(),
            x: state.target.x,
            y: state.target.y,
            heading: state.target.heading
        };
    }

    function validateWizardPositionTarget(target, label) {
        if (!target || typeof target !== "object") {
            throw new Error(`Wizard of Flatland ${label} is missing`);
        }
        for (const field of ["x", "y", "heading"]) {
            if (!Number.isFinite(target[field])) {
                throw new Error(`Wizard of Flatland ${label} requires finite ${field}`);
            }
        }
    }

    function parseWizardPositionSnapshot(text) {
        if (typeof text !== "string" || text.length === 0) {
            throw new Error("Wizard of Flatland saved wizard position is missing");
        }
        let snapshot = null;
        try {
            snapshot = JSON.parse(text);
        } catch (error) {
            throw new Error(`Wizard of Flatland saved wizard position is invalid JSON: ${error.message}`);
        }
        if (!snapshot || typeof snapshot !== "object") {
            throw new Error("Wizard of Flatland saved wizard position must be an object");
        }
        if (snapshot.version !== 1) {
            throw new Error(`Wizard of Flatland saved wizard position version is unsupported: ${snapshot.version}`);
        }
        validateWizardPositionTarget(snapshot, "saved wizard position");
        return snapshot;
    }

    function applyWizardPositionSnapshot(snapshot) {
        validateWizardPositionTarget(snapshot, "saved wizard position");
        state.target = {
            x: snapshot.x,
            y: snapshot.y,
            heading: normalizeAngle(snapshot.heading)
        };
        state.worldVersion += 1;
        state.lastSentTarget = { x: state.target.x, y: state.target.y };
        clearTargetTravelVector();
        state.targetFlashTime = 0.18;
        state.pressedMovementKeys = Object.create(null);
        state.spaceHeld = false;
        state.zoomHeld = false;
        state.fastMovementHeld = false;
        clearAgentPathRequestsForMapRebuild();
        invalidateMazeLookaheadCache();
        state.hexGridLayer.dirty = true;
        state.nodeLayer.dirty = true;

        if (isProceduralMazeScenario()) {
            state.generatedMazeSignature = "";
            refreshGeneratedMazeIfNeeded(true);
        } else {
            constrainTargetToWalls();
            resolveTargetNpcContacts();
            rebuildPathfindingNodeLayer();
        }
        return getWizardPositionSnapshot();
    }

    function saveWizardPositionToConsoleSlot() {
        const snapshot = getWizardPositionSnapshot();
        getWizardPositionStorage().setItem(WIZARD_POSITION_STORAGE_KEY, JSON.stringify(snapshot));
        console.log("Wizard of Flatland position saved", snapshot);
        return snapshot;
    }

    function loadWizardPositionFromConsoleSlot() {
        const snapshot = parseWizardPositionSnapshot(getWizardPositionStorage().getItem(WIZARD_POSITION_STORAGE_KEY));
        const applied = applyWizardPositionSnapshot(snapshot);
        console.log("Wizard of Flatland position loaded", applied);
        return applied;
    }

    function showSavedWizardPositionFromConsoleSlot() {
        const snapshot = parseWizardPositionSnapshot(getWizardPositionStorage().getItem(WIZARD_POSITION_STORAGE_KEY));
        console.log("Wizard of Flatland saved position", snapshot);
        return snapshot;
    }

    function clearSavedWizardPositionFromConsoleSlot() {
        getWizardPositionStorage().removeItem(WIZARD_POSITION_STORAGE_KEY);
        console.log("Wizard of Flatland saved position cleared");
        return true;
    }

    window.wizardPosition = Object.freeze({
        save: saveWizardPositionToConsoleSlot,
        load: loadWizardPositionFromConsoleSlot,
        show: showSavedWizardPositionFromConsoleSlot,
        clear: clearSavedWizardPositionFromConsoleSlot,
        key: WIZARD_POSITION_STORAGE_KEY
    });

    function spawnEnemiesAtNearestSectionCenterFromConsole(count = 1) {
        const spawnCount = Number(count);
        if (!Number.isInteger(spawnCount) || spawnCount < 1) {
            throw new Error("Wizard of Flatland enemy spawn count must be a positive integer");
        }
        const options = getMazeOptions();
        const coord = worldToMazeSectionCoord(state.target.x, state.target.y, options);
        const sectionKey = mazeSectionKey(coord.q, coord.r);
        if (
            isProceduralMazeScenario() &&
            (!(state.generatedMazeInstalledChunkKeys instanceof Set) || !state.generatedMazeInstalledChunkKeys.has(sectionKey))
        ) {
            throw new Error(`Wizard of Flatland cannot spawn enemies in unloaded map section ${sectionKey}`);
        }
        const center = mazeSectionCenter(coord.q, coord.r, options);
        const firstId = getNextAgentId();
        for (let i = 0; i < spawnCount; i++) {
            addAgent(center.x, center.y, firstId + i);
        }
        enforceInitialWallConstraints();
        clearAgentPathRequestsForMapRebuild();
        const result = {
            spawned: spawnCount,
            section: { key: sectionKey, q: coord.q, r: coord.r },
            center: { x: center.x, y: center.y },
            firstId,
            totalAgents: state.agents.length
        };
        console.log("Wizard of Flatland enemies spawned", result);
        return result;
    }

    window.spawnEnemiesAtNearestSectionCenter = spawnEnemiesAtNearestSectionCenterFromConsole;

    function populateGeneratedMazeRooms(options) {
        if (!isProceduralMazeScenario()) return;
        if (!(state.generatedMazeInstalledChunkKeys instanceof Set)) {
            throw new Error("Wizard of Flatland enemy population requires installed section tracking");
        }
        if (!(state.generatedMazePopulatedSectionKeys instanceof Set)) {
            throw new Error("Wizard of Flatland enemy population requires populated section tracking");
        }
        const keys = Array.from(state.generatedMazeInstalledChunkKeys).sort();
        for (const sectionKey of keys) {
            if (state.generatedMazePopulatedSectionKeys.has(sectionKey)) continue;
            populateGeneratedMazeRoom(sectionKey, options);
            state.generatedMazePopulatedSectionKeys.add(sectionKey);
        }
    }

    function populateGeneratedMazeRoom(sectionKey, options) {
        const coord = parseMazeSectionKey(sectionKey);
        const count = getMazeRoomEnemyCount(sectionKey, options);
        if (count <= 0) return;
        const center = mazeSectionCenter(coord.q, coord.r, options);
        const roomRadius = getMazeRoomSpawnRadius(options);
        const random = seededRandom(hashString(`${options.seed}|enemy-position|${sectionKey}`));
        const firstId = getNextAgentId();
        for (let i = 0; i < count; i++) {
            const point = getMazeRoomEnemySpawnPoint(center, roomRadius, i, count, random);
            addAgent(point.x, point.y, firstId + i, random, { autoSpawnSectionKey: sectionKey });
        }
    }

    function getMazeRoomEnemyCount(sectionKey, options) {
        if (typeof sectionKey !== "string" || sectionKey.length === 0) {
            throw new Error("Wizard of Flatland enemy count requires a section key");
        }
        const random = seededRandom(hashString(`${options.seed}|enemy-count|${sectionKey}`));
        const roll = random();
        if (roll < MAZE_ROOM_EMPTY_ENEMY_CHANCE) return 0;
        if (roll >= 1 - MAZE_ROOM_MAX_ENEMY_CHANCE) return MAZE_ROOM_MAX_ENEMIES;
        const nonEmptySpan = 1 - MAZE_ROOM_MAX_ENEMY_CHANCE - MAZE_ROOM_EMPTY_ENEMY_CHANCE;
        if (!(nonEmptySpan > 0)) throw new Error("Wizard of Flatland enemy distribution has no middle span");
        const t = (roll - MAZE_ROOM_EMPTY_ENEMY_CHANCE) / nonEmptySpan;
        return Math.max(
            1,
            Math.min(
                MAZE_ROOM_MAX_ENEMIES - 1,
                Math.ceil(Math.pow(t, MAZE_ROOM_ENEMY_DISTRIBUTION_POWER) * (MAZE_ROOM_MAX_ENEMIES - 1))
            )
        );
    }

    function getMazeRoomSpawnRadius(options) {
        return Math.max(2, getMazeSectionRadius(options) * MAZE_ROOM_ENEMY_SAFE_RADIUS_SCALE);
    }

    function getMazeRoomEnemySpawnPoint(center, radius, index, count, random) {
        if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
            throw new Error("Wizard of Flatland enemy spawn requires a finite room center");
        }
        if (!Number.isFinite(radius) || radius <= 0) {
            throw new Error("Wizard of Flatland enemy spawn requires a positive room radius");
        }
        if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || count < 1 || index >= count) {
            throw new Error("Wizard of Flatland enemy spawn requires a valid spawn index");
        }
        if (typeof random !== "function") {
            throw new Error("Wizard of Flatland enemy spawn requires a random source");
        }
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const packedRadius = radius * Math.sqrt((index + 0.5) / count);
        const countRoot = Math.sqrt(count);
        const jitterRadius = radius / Math.max(12, countRoot * 8);
        const angle = index * goldenAngle + (random() - 0.5) * 0.1 / Math.max(1, countRoot);
        const distance = Math.max(0, Math.min(radius, packedRadius + (random() - 0.5) * jitterRadius));
        return {
            x: center.x + Math.cos(angle) * distance,
            y: center.y + Math.sin(angle) * distance
        };
    }

    function clearPathfindingNodeLayer() {
        state.nodeLayer.nodes = new Float32Array(0);
        state.nodeLayer.snapshotNodes = new Float32Array(0);
        state.nodeLayer.edges = new Int32Array(0);
        state.nodeLayer.blockedEdges = new Int32Array(0);
        state.nodeLayer.indexByKey = new Map();
        state.nodeLayer.pathCenterX = NaN;
        state.nodeLayer.pathCenterY = NaN;
        state.nodeLayer.version += 1;
        state.nodeLayer.dirty = true;
    }

    function respawnAgentsForCurrentScenario() {
        state.agents = [];
        const count = getAgentCount();
        const scenario = getScenarioValue();
        if (scenario === "openArena") {
            spawnRing(count, 10, 3.5);
        } else if (scenario === "crowdedArena") {
            spawnCluster(count, -4.2, 0, 4.4, 10);
        } else if (scenario === "proceduralMaze") {
            spawnCluster(count, state.target.x + 5.5, state.target.y + 1.5, 7.5, 7.5);
            enforceInitialWallConstraints();
        } else {
            spawnCluster(count, 0, 0.8, 4.8, 5);
        }
        enforceInitialWallConstraints();
    }

    function addRoomWalls(minX, minY, maxX, maxY) {
        state.walls = appendWallSegment(state.walls, minX, minY, maxX, minY, WALL_LABEL_ARENA_BOUNDARY, 0);
        state.walls = appendWallSegment(state.walls, maxX, minY, maxX, maxY, WALL_LABEL_ARENA_BOUNDARY, 1);
        state.walls = appendWallSegment(state.walls, maxX, maxY, minX, maxY, WALL_LABEL_ARENA_BOUNDARY, 2);
        state.walls = appendWallSegment(state.walls, minX, maxY, minX, minY, WALL_LABEL_ARENA_BOUNDARY, 3);
    }

    function spawnRing(count, radius, jitter) {
        for (let i = 0; i < count; i++) {
            const angle = i / count * Math.PI * 2;
            const r = radius + (Math.random() - 0.5) * jitter;
            addAgent(Math.cos(angle) * r, Math.sin(angle) * r, i);
        }
    }

    function spawnCluster(count, centerX, centerY, width, height) {
        const cols = Math.ceil(Math.sqrt(count * width / height));
        const firstId = getNextAgentId();
        for (let i = 0; i < count; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = centerX + (col / Math.max(1, cols - 1) - 0.5) * width + (Math.random() - 0.5) * 0.25;
            const y = centerY + (row / Math.max(1, Math.ceil(count / cols) - 1) - 0.5) * height + (Math.random() - 0.5) * 0.25;
            addAgent(x, y, firstId + i);
        }
    }

    function getNextAgentId() {
        let maxId = -1;
        for (const agent of state.agents) {
            const id = Number(agent && agent.id);
            if (Number.isFinite(id)) maxId = Math.max(maxId, Math.floor(id));
        }
        return maxId + 1;
    }

    function addAgent(x, y, id, random = Math.random, metadata = null) {
        if (typeof random !== "function") {
            throw new Error("Wizard of Flatland agent creation requires a random source");
        }
        const agent = {
            id,
            x,
            y,
            vx: 0,
            vy: 0,
            radius: AGENT_RADIUS,
            speed: 3.8 + random() * 0.6,
            priority: random(),
            waitTime: random() * 1.5,
            phase: PHASE_MILLING,
            phaseTime: 0,
            homeAngle: Math.atan2(y - state.target.y, x - state.target.x),
            cooldown: random() * 0.8,
            slotAngle: Math.atan2(y - state.target.y, x - state.target.x),
            heading: Math.atan2(state.target.y - y, state.target.x - x),
            headingHistory: [],
            millingDirection: (id % 2) === 0 ? 1 : -1,
            millingWallTurnLock: 0,
            solverState: STATE_MILLING,
            wallClamps: 0,
            pathMode: PATH_MODE_DIRECT,
            pathRequestPending: false,
            pathRequestId: 0,
            pathRequestedAt: 0,
            pathRequestedWorldVersion: 0,
            pathRequestedRawStartKey: "",
            pathRequestedStartKey: "",
            pathRequestedGoalKey: "",
            pathNodeKeys: [],
            pathWaypoints: [],
            pathCursor: 0,
            pathGoalX: x,
            pathGoalY: y
        };
        if (metadata && typeof metadata === "object") {
            if (metadata.autoSpawnSectionKey !== undefined) {
                if (typeof metadata.autoSpawnSectionKey !== "string" || metadata.autoSpawnSectionKey.length === 0) {
                    throw new Error("Wizard of Flatland auto-spawned enemy requires a section key");
                }
                agent.autoSpawnSectionKey = metadata.autoSpawnSectionKey;
            }
        }
        state.agents.push(agent);
    }

    function enforceInitialWallConstraints() {
        for (const agent of state.agents) {
            constrainAgentToWalls(agent);
        }
    }

    function constrainTargetToWalls() {
        constrainActorToWalls(state.target, TARGET_RADIUS);
    }

    function updateTargetKeyboardMovement(dt) {
        if (!Number.isFinite(dt) || dt <= 0) {
            clearTargetTravelVector();
            return;
        }
        let forward = 0;
        let sideways = 0;
        let movementSpeedMultiplier = 1;
        for (const key of Object.keys(TARGET_FORWARD_KEYS)) {
            if (state.pressedMovementKeys[key]) forward += TARGET_FORWARD_KEYS[key];
        }
        for (const key of Object.keys(TARGET_SIDEWAYS_KEYS)) {
            if (state.pressedMovementKeys[key]) sideways += TARGET_SIDEWAYS_KEYS[key];
        }

        const signedForward = Math.max(-1, Math.min(1, forward));
        const signedSideways = Math.max(-1, Math.min(1, sideways));
        if (signedForward === 0 && signedSideways === 0) {
            clearTargetTravelVector();
            return;
        }

        if (signedForward > 0 && signedSideways !== 0) {
            movementSpeedMultiplier = TARGET_KEYBOARD_FORWARD_DIAGONAL_SPEED_MULTIPLIER;
        } else if (signedForward < 0 && signedSideways !== 0) {
            movementSpeedMultiplier = TARGET_KEYBOARD_BACKWARD_DIAGONAL_SPEED_MULTIPLIER;
        } else if (signedForward < 0) {
            movementSpeedMultiplier = TARGET_KEYBOARD_BACKWARD_SPEED_MULTIPLIER;
        } else if (signedSideways !== 0) {
            movementSpeedMultiplier = TARGET_KEYBOARD_SIDEWAYS_SPEED_MULTIPLIER;
        }

        const forwardX = Math.cos(state.target.heading);
        const forwardY = Math.sin(state.target.heading);
        const sideX = -forwardY;
        const sideY = forwardX;
        const dirX = forwardX * signedForward + sideX * signedSideways;
        const dirY = forwardY * signedForward + sideY * signedSideways;
        const magnitude = Math.hypot(dirX, dirY);
        if (!(magnitude > 0)) throw new Error("Wizard of Flatland keyboard direction must be non-zero");
        const speed = (state.fastMovementHeld ? TARGET_KEYBOARD_FAST_MOVE_SPEED : TARGET_KEYBOARD_MOVE_SPEED) * movementSpeedMultiplier;
        const startX = state.target.x;
        const startY = state.target.y;
        moveTargetWithNpcPush(
            state.target.x + (dirX / magnitude) * speed * dt,
            state.target.y + (dirY / magnitude) * speed * dt
        );
        state.targetTravelVector.x = state.target.x - startX;
        state.targetTravelVector.y = state.target.y - startY;
    }

    function clearTargetTravelVector() {
        state.targetTravelVector.x = 0;
        state.targetTravelVector.y = 0;
    }

    function updateProjectedCursorKeyboardControls(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");

        let bend = 0;
        if (state.pressedMovementKeys.ArrowLeft) bend -= 1;
        if (state.pressedMovementKeys.ArrowRight) bend += 1;
        if (bend !== 0) {
            const signedBend = Math.max(-1, Math.min(1, bend));
            const currentSign = Math.sign(cursor.angleOffset);
            const movingTowardStraight = currentSign !== 0 && currentSign !== Math.sign(signedBend);
            const bendProgress = Math.min(1, Math.abs(cursor.angleOffset) / TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET);
            const speedMultiplier = movingTowardStraight
                ? TARGET_PROJECTED_CURSOR_RETURN_ANGLE_SPEED_MULTIPLIER
                : Math.max(
                    TARGET_PROJECTED_CURSOR_OUTWARD_ANGLE_SPEED_MIN_MULTIPLIER,
                    1 - bendProgress
                );
            const distanceSpeedMultiplier = TARGET_PROJECTED_CURSOR_DISTANCE / Math.max(TARGET_PROJECTED_CURSOR_MIN_DISTANCE, cursor.distance);
            cursor.angleOffset = Math.max(
                -TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET,
                Math.min(
                    TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET,
                    cursor.angleOffset + signedBend * TARGET_PROJECTED_CURSOR_ANGLE_SPEED * speedMultiplier * distanceSpeedMultiplier * dt
                )
            );
        }

        let extend = 0;
        if (state.pressedMovementKeys.ArrowUp) extend += 1;
        if (state.pressedMovementKeys.ArrowDown) extend -= 1;
        if (extend !== 0) {
            cursor.distance = Math.max(
                TARGET_PROJECTED_CURSOR_MIN_DISTANCE,
                Math.min(
                    TARGET_PROJECTED_CURSOR_MAX_DISTANCE,
                    cursor.distance + Math.max(-1, Math.min(1, extend)) * TARGET_PROJECTED_CURSOR_DISTANCE_SPEED * dt
                )
            );
        }
    }

    function updateIdleTargetFacingAndCursor(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        if (isTargetMovementInputActive()) return;
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        if (!Number.isFinite(cursor.distance)) throw new Error("Wizard of Flatland idle cursor requires a finite distance");

        const cursorPoint = getCurrentProjectedCursorWorldPoint();
        const dx = cursorPoint.x - state.target.x;
        const dy = cursorPoint.y - state.target.y;
        const cursorDistance = Math.hypot(dx, dy);
        if (cursorDistance > 0.000001) {
            const targetHeading = Math.atan2(dy, dx);
            const delta = shortestAngleDelta(state.target.heading, targetHeading);
            const maxTurn = TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET / TARGET_IDLE_FACE_CURSOR_SECONDS * TARGET_TURN_SPEED_MULTIPLIER * dt;
            const appliedTurn = Math.max(-maxTurn, Math.min(maxTurn, delta));
            state.target.heading = normalizeAngle(state.target.heading + appliedTurn);

            let nextCursorDistance = cursorDistance;
            if (!isProjectedCursorInputActive()) {
                const maxDistanceDelta = Math.abs(TARGET_PROJECTED_CURSOR_DISTANCE - TARGET_IDLE_PROJECTED_CURSOR_DISTANCE) /
                    TARGET_IDLE_CURSOR_DISTANCE_SECONDS * dt;
                nextCursorDistance = moveToward(cursorDistance, TARGET_IDLE_PROJECTED_CURSOR_DISTANCE, maxDistanceDelta);
            }
            updateProjectedCursorFromFixedWorldPoint({
                x: state.target.x + (dx / cursorDistance) * nextCursorDistance,
                y: state.target.y + (dy / cursorDistance) * nextCursorDistance
            });
        }
    }

    function updateMovingTargetCursorStraightening(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        if (!isTargetMovementInputActive() || isProjectedCursorInputActive()) return;
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        if (!Number.isFinite(cursor.angleOffset)) throw new Error("Wizard of Flatland moving cursor straightening requires a finite bend");
        cursor.angleOffset = moveToward(
            cursor.angleOffset,
            0,
            TARGET_PROJECTED_CURSOR_ANGLE_SPEED * TARGET_PROJECTED_CURSOR_RETURN_ANGLE_SPEED_MULTIPLIER * dt
        );
    }

    function updateTargetHeadingFromProjectedCursor(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        if (!Number.isFinite(cursor.angleOffset)) throw new Error("Wizard of Flatland projected cursor turn requires a finite bend");
        if (!isTargetMovementInputActive()) return;
        const bendRatio = getProjectedCursorBendRatio(cursor.angleOffset);
        if (bendRatio === 0) return;
        const trace = getCurrentProjectedCursorTrace();
        const effectiveDistance = getProjectedCursorTraceDistance(trace);
        const turnRadius = getProjectedCursorTurnRadius(effectiveDistance, bendRatio);
        const turnRate = TARGET_KEYBOARD_MOVE_SPEED / turnRadius * TARGET_TURN_SPEED_MULTIPLIER;
        state.target.heading = normalizeAngle(state.target.heading + Math.sign(bendRatio) * turnRate * dt);
    }

    function isTargetMovementInputActive() {
        for (const key of Object.keys(TARGET_FORWARD_KEYS)) {
            if (state.pressedMovementKeys[key]) return true;
        }
        for (const key of Object.keys(TARGET_SIDEWAYS_KEYS)) {
            if (state.pressedMovementKeys[key]) return true;
        }
        return false;
    }

    function isProjectedCursorInputActive() {
        for (const key of TARGET_CURSOR_KEYS) {
            if (state.pressedMovementKeys[key]) return true;
        }
        return false;
    }

    function moveToward(value, target, maxDelta) {
        const current = Number(value);
        const goal = Number(target);
        const delta = Number(maxDelta);
        if (!Number.isFinite(current) || !Number.isFinite(goal) || !Number.isFinite(delta)) {
            throw new Error("Wizard of Flatland moveToward requires finite values");
        }
        if (Math.abs(goal - current) <= delta) return goal;
        return current + Math.sign(goal - current) * delta;
    }

    function shootFireball() {
        const cursorPoint = getCurrentProjectedCursorWorldPoint();
        const dx = cursorPoint.x - state.target.x;
        const dy = cursorPoint.y - state.target.y;
        const length = Math.hypot(dx, dy);
        if (!(length > 0.000001)) return;
        const dirX = dx / length;
        const dirY = dy / length;
        state.fireballs.push({
            x: state.target.x + dirX * (TARGET_RADIUS + FIREBALL_HITBOX_LENGTH * 0.35),
            y: state.target.y + dirY * (TARGET_RADIUS + FIREBALL_HITBOX_LENGTH * 0.35),
            dirX,
            dirY,
            age: 0
        });
    }

    function updateFireballs(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const survivors = [];
        for (const fireball of state.fireballs) {
            fireball.age += dt;
            const previousX = fireball.x;
            const previousY = fireball.y;
            const nextX = fireball.x + fireball.dirX * FIREBALL_SPEED * dt;
            const nextY = fireball.y + fireball.dirY * FIREBALL_SPEED * dt;
            const wallHit = findEarliestFireballWallHit(previousX, previousY, nextX, nextY);
            if (wallHit) {
                fireball.x = wallHit.x;
                fireball.y = wallHit.y;
                detonateFireball(fireball);
                continue;
            }
            fireball.x = nextX;
            fireball.y = nextY;
            const hitbox = getFireballHitboxPolygon(fireball);
            if (findAgentIntersectingPolygon(hitbox)) {
                detonateFireball(fireball);
                continue;
            }
            if (fireball.age < FIREBALL_MAX_AGE_SECONDS) survivors.push(fireball);
        }
        state.fireballs = survivors;
        updateFireballExplosions(dt);
    }

    function findEarliestFireballWallHit(fromX, fromY, toX, toY) {
        if (!Number.isFinite(fromX) || !Number.isFinite(fromY) || !Number.isFinite(toX) || !Number.isFinite(toY)) {
            throw new Error("Wizard of Flatland fireball wall hit test requires finite movement");
        }
        let best = null;
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            const hit = sweptCircleSegmentHit(
                fromX,
                fromY,
                toX,
                toY,
                state.walls[i + WALL_X1],
                state.walls[i + WALL_Y1],
                state.walls[i + WALL_X2],
                state.walls[i + WALL_Y2],
                FIREBALL_DAMAGE_RADIUS + WALL_WORLD_HALF_THICKNESS
            );
            if (!hit || (best && hit.t >= best.t)) continue;
            best = {
                t: hit.t,
                x: fromX + (toX - fromX) * hit.t,
                y: fromY + (toY - fromY) * hit.t
            };
        }
        return best;
    }

    function findAgentIntersectingPolygon(polygon) {
        if (!Array.isArray(polygon) || polygon.length < 3) {
            throw new Error("Wizard of Flatland fireball hit test requires a polygon");
        }
        return state.agents.find((agent) => polygonIntersectsCircle(polygon, agent.x, agent.y, agent.radius)) || null;
    }

    function detonateFireball(fireball) {
        if (!fireball || !Number.isFinite(fireball.x) || !Number.isFinite(fireball.y)) {
            throw new Error("Wizard of Flatland fireball explosion requires a finite fireball");
        }
        destroyAgentsIntersectingCircle(fireball.x, fireball.y, FIREBALL_EXPLOSION_DAMAGE_RADIUS);
        state.fireballExplosions.push({
            x: fireball.x,
            y: fireball.y,
            radius: FIREBALL_EXPLOSION_DAMAGE_RADIUS,
            age: 0
        });
    }

    function updateFireballExplosions(dt) {
        state.fireballExplosions = state.fireballExplosions.filter((explosion) => {
            explosion.age += dt;
            return explosion.age < FIREBALL_EXPLOSION_VISUAL_SECONDS;
        });
    }

    function destroyAgentsIntersectingCircle(circleX, circleY, radius) {
        if (!Number.isFinite(circleX) || !Number.isFinite(circleY) || !Number.isFinite(radius)) {
            throw new Error("Wizard of Flatland fireball explosion requires a finite damage circle");
        }
        state.agents = state.agents.filter((agent) => {
            const distance = Math.hypot(agent.x - circleX, agent.y - circleY);
            return distance > radius + agent.radius;
        });
    }

    function getFireballHitboxPolygon(fireball) {
        if (!fireball || !Number.isFinite(fireball.x) || !Number.isFinite(fireball.y) || !Number.isFinite(fireball.dirX) || !Number.isFinite(fireball.dirY)) {
            throw new Error("Wizard of Flatland fireball hitbox requires a finite fireball");
        }
        const halfLength = FIREBALL_HITBOX_LENGTH * 0.5;
        const halfWidth = FIREBALL_HITBOX_WIDTH * 0.5;
        const sideX = -fireball.dirY;
        const sideY = fireball.dirX;
        return [
            {
                x: fireball.x + fireball.dirX * halfLength,
                y: fireball.y + fireball.dirY * halfLength
            },
            {
                x: fireball.x + sideX * halfWidth,
                y: fireball.y + sideY * halfWidth
            },
            {
                x: fireball.x - fireball.dirX * halfLength,
                y: fireball.y - fireball.dirY * halfLength
            },
            {
                x: fireball.x - sideX * halfWidth,
                y: fireball.y - sideY * halfWidth
            }
        ];
    }

    function polygonIntersectsCircle(polygon, circleX, circleY, radius) {
        if (!Number.isFinite(circleX) || !Number.isFinite(circleY) || !Number.isFinite(radius)) {
            throw new Error("Wizard of Flatland polygon-circle hit test requires finite circle data");
        }
        if (pointInPolygon(circleX, circleY, polygon)) return true;
        for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i];
            const b = polygon[(i + 1) % polygon.length];
            if (pointSegmentDistance(circleX, circleY, a.x, a.y, b.x, b.y) <= radius) return true;
        }
        return false;
    }

    function pointInPolygon(x, y, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i];
            const b = polygon[j];
            if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
                throw new Error("Wizard of Flatland polygon hit test requires finite polygon points");
            }
            const intersects = ((a.y > y) !== (b.y > y)) &&
                x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x;
            if (intersects) inside = !inside;
        }
        return inside;
    }

    function moveTargetWithNpcPush(desiredX, desiredY) {
        if (!Number.isFinite(desiredX) || !Number.isFinite(desiredY)) {
            throw new Error("Wizard of Flatland target move requires finite coordinates");
        }
        const constrainedMove = constrainMovementToSegmentWalls(
            state.target.x,
            state.target.y,
            desiredX,
            desiredY,
            TARGET_RADIUS
        );
        state.target.x = constrainedMove.x;
        state.target.y = constrainedMove.y;
        constrainTargetToWalls();
        resolveTargetNpcContacts();
    }

    function resolveTargetNpcContacts() {
        let pushes = 0;
        for (let pass = 0; pass < TARGET_NPC_PUSH_ITERATIONS; pass++) {
            let changed = false;
            for (const agent of state.agents) {
                const result = resolveTargetAgentOverlap(agent);
                if (!result.changed) continue;
                pushes += 1;
                changed = true;
            }
            for (let i = 0; i < state.agents.length; i++) {
                for (let j = i + 1; j < state.agents.length; j++) {
                    const result = resolveAgentAgentOverlap(state.agents[i], state.agents[j]);
                    if (!result.changed) continue;
                    pushes += 1;
                    changed = true;
                }
            }
            if (!changed) break;
        }
        assertContactInvariants();
        state.targetPushes = pushes;
    }

    function resolveTargetAgentOverlap(agent) {
        const combinedRadius = TARGET_RADIUS + agent.radius;
        let dx = agent.x - state.target.x;
        let dy = agent.y - state.target.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= combinedRadius - TARGET_NPC_PUSH_SLOP) return { changed: false };

        if (!(dist > TARGET_NPC_PUSH_MIN_AXIS)) {
            const angle = Number.isFinite(agent.homeAngle) ? agent.homeAngle : agent.id;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            dist = 1;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        const correction = combinedRadius - dist + TARGET_NPC_PUSH_SLOP;
        const targetShare = TARGET_NPC_PUSH_PLAYER_SHARE;
        const agentShare = 1 - targetShare;
        const previousAgentX = agent.x;
        const previousAgentY = agent.y;
        const previousTargetX = state.target.x;
        const previousTargetY = state.target.y;

        agent.x += nx * correction * agentShare;
        agent.y += ny * correction * agentShare;
        constrainAgentToWalls(agent);

        const blockedAgentPushX = (previousAgentX + nx * correction * agentShare) - agent.x;
        const blockedAgentPushY = (previousAgentY + ny * correction * agentShare) - agent.y;
        state.target.x -= nx * correction * targetShare + blockedAgentPushX;
        state.target.y -= ny * correction * targetShare + blockedAgentPushY;
        constrainTargetToWalls();

        if (agent.x !== previousAgentX || agent.y !== previousAgentY || state.target.x !== previousTargetX || state.target.y !== previousTargetY) {
            accumulateContactVelocity(agent, previousAgentX, previousAgentY);
            return { changed: true };
        }
        return { changed: false };
    }

    function resolveAgentAgentOverlap(left, right) {
        const combinedRadius = left.radius + right.radius;
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= combinedRadius - TARGET_NPC_PUSH_SLOP) return { changed: false };

        if (!(dist > TARGET_NPC_PUSH_MIN_AXIS)) {
            const angle = ((left.id * 928371 + right.id * 689287) % 360) / 360 * Math.PI * 2;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            dist = 1;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        const correction = combinedRadius - dist + TARGET_NPC_PUSH_SLOP;
        const previousLeftX = left.x;
        const previousLeftY = left.y;
        const previousRightX = right.x;
        const previousRightY = right.y;

        const pushShare = getAgentAgentPushShare(left, right);
        const leftPushX = -nx * correction * pushShare.left;
        const leftPushY = -ny * correction * pushShare.left;
        const rightPushX = nx * correction * pushShare.right;
        const rightPushY = ny * correction * pushShare.right;

        const leftApplied = moveAgentWithWallConstraint(left, leftPushX, leftPushY);
        const rightApplied = moveAgentWithWallConstraint(right, rightPushX - leftApplied.blockedX, rightPushY - leftApplied.blockedY);
        if (rightApplied.blockedX !== 0 || rightApplied.blockedY !== 0) {
            moveAgentWithWallConstraint(left, -rightApplied.blockedX, -rightApplied.blockedY);
        }

        if (left.x !== previousLeftX || left.y !== previousLeftY || right.x !== previousRightX || right.y !== previousRightY) {
            accumulateContactVelocity(left, previousLeftX, previousLeftY);
            accumulateContactVelocity(right, previousRightX, previousRightY);
            return { changed: true };
        }
        return { changed: false };
    }

    function getAgentAgentPushShare(left, right) {
        const leftForce = getAgentContactPushForce(left);
        const rightForce = getAgentContactPushForce(right);
        const total = leftForce + rightForce;
        if (!(total > 0)) {
            return { left: NPC_NPC_PUSH_SHARE, right: 1 - NPC_NPC_PUSH_SHARE };
        }
        return {
            left: rightForce / total,
            right: leftForce / total
        };
    }

    function getAgentContactPushForce(agent) {
        return agent && (agent.solverState === STATE_VACATING || agent.phase === PHASE_VACATING)
            ? VACATING_CONTACT_PUSH_FORCE
            : 1;
    }

    function moveAgentWithWallConstraint(agent, dx, dy) {
        const intendedX = agent.x + dx;
        const intendedY = agent.y + dy;
        agent.x = intendedX;
        agent.y = intendedY;
        constrainAgentToWalls(agent);
        return {
            blockedX: intendedX - agent.x,
            blockedY: intendedY - agent.y
        };
    }

    function accumulateContactVelocity(agent, previousX, previousY) {
        agent.vx += agent.x - previousX;
        agent.vy += agent.y - previousY;
    }

    function constrainAgentToWalls(agent) {
        constrainActorToWalls(agent, agent.radius);
    }

    function constrainActorToWalls(actor, radius) {
        for (let pass = 0; pass < 4; pass++) {
            let changed = false;
            for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
                const ax = state.walls[i + WALL_X1];
                const ay = state.walls[i + WALL_Y1];
                const bx = state.walls[i + WALL_X2];
                const by = state.walls[i + WALL_Y2];
                const distance = pointSegmentDistance(actor.x, actor.y, ax, ay, bx, by);
                const blockingRadius = radius + WALL_WORLD_HALF_THICKNESS;
                if (distance >= blockingRadius) continue;
                const normal = segmentRepulsionNormal(actor.x, actor.y, ax, ay, bx, by);
                const correction = blockingRadius - distance + TARGET_NPC_PUSH_SLOP;
                actor.x += normal.x * correction;
                actor.y += normal.y * correction;
                changed = true;
            }
            if (!changed) break;
        }
    }

    function assertContactInvariants() {
        assertActorWallSeparation("target", state.target, TARGET_RADIUS);
        for (const agent of state.agents) {
            assertActorWallSeparation(`agent ${agent.id}`, agent, agent.radius);
            const minDistance = TARGET_RADIUS + agent.radius - TARGET_NPC_PUSH_SLOP * 4;
            const distance = Math.hypot(agent.x - state.target.x, agent.y - state.target.y);
            if (distance < minDistance) {
                throw new Error(`Wizard of Flatland target collision unresolved for agent ${agent.id}`);
            }
        }
        for (let i = 0; i < state.agents.length; i++) {
            const left = state.agents[i];
            for (let j = i + 1; j < state.agents.length; j++) {
                const right = state.agents[j];
                const minDistance = left.radius + right.radius - TARGET_NPC_PUSH_SLOP * 4;
                const distance = Math.hypot(right.x - left.x, right.y - left.y);
                if (distance < minDistance) {
                    throw new Error(`Wizard of Flatland NPC collision unresolved for agents ${left.id} and ${right.id}`);
                }
            }
        }
    }

    function assertActorWallSeparation(label, actor, radius) {
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            const distance = pointSegmentDistance(
                actor.x,
                actor.y,
                state.walls[i + WALL_X1],
                state.walls[i + WALL_Y1],
                state.walls[i + WALL_X2],
                state.walls[i + WALL_Y2]
            );
            if (distance < radius + WALL_WORLD_HALF_THICKNESS - TARGET_NPC_PUSH_SLOP * 4) {
                throw new Error(`Wizard of Flatland ${label} segment wall collision unresolved`);
            }
        }
    }

    function packAgents() {
        const activeAgents = [];
        for (const agent of state.agents) {
            if (!isAgentInInstalledMazeSection(agent)) {
                freezeAgentForUnloadedSection(agent);
                continue;
            }
            activeAgents.push(agent);
        }
        const packed = new Float32Array(activeAgents.length * STRIDE);
        for (let i = 0; i < activeAgents.length; i++) {
            const agent = activeAgents[i];
            const base = i * STRIDE;
            packed[base] = agent.id;
            packed[base + 1] = agent.x;
            packed[base + 2] = agent.y;
            packed[base + 3] = agent.radius;
            packed[base + 4] = agent.speed;
            packed[base + 5] = agent.priority;
            packed[base + 6] = agent.waitTime;
            packed[base + 7] = agent.phase;
            packed[base + 8] = agent.phaseTime;
            packed[base + 9] = agent.homeAngle;
            packed[base + 10] = agent.cooldown;
            packed[base + 11] = agent.heading;
            packed[base + 12] = agent.millingDirection;
            packed[base + 13] = agent.millingWallTurnLock || 0;
            packed[base + 14] = agent.pathMode === PATH_MODE_WORKER ? PATH_MODE_WORKER : PATH_MODE_DIRECT;
            packed[base + 15] = Number.isFinite(agent.pathGoalX) ? agent.pathGoalX : state.target.x;
            packed[base + 16] = Number.isFinite(agent.pathGoalY) ? agent.pathGoalY : state.target.y;
        }
        return packed;
    }

    function requestStep(dt) {
        if (state.waitingForWorker) return;
        if (isProceduralMazeScenario() && getPathfindingNodeCount() === 0) {
            setLabelText(labels.workerStatus, state.generatedMazeLoading ? "maze loading" : "maze missing");
            return;
        }
        updateAgentPathing(dt);
        state.waitingForWorker = true;
        const targetMoved = Math.hypot(
            state.target.x - state.lastSentTarget.x,
            state.target.y - state.lastSentTarget.y
        ) > 0.001;
        state.lastSentTarget = { x: state.target.x, y: state.target.y };
        const agents = packAgents();
        const includeWalls = state.solverWallVersion !== state.worldVersion;
        const walls = includeWalls ? cloneWallBuffer(state.walls, "solver walls") : null;
        const message = {
            type: "step",
            requestId: state.requestId++,
            worldVersion: state.worldVersion,
            dt,
            agents,
            params: {
                targetX: state.target.x,
                targetY: state.target.y,
                targetRadius: TARGET_RADIUS,
                ringRadius: COMBAT_RING_RADIUS,
                separationStrength: getSeparationStrength(),
                speedScale: getSpeedScale(),
                targetMoved
            }
        };
        const transfer = [agents.buffer];
        if (includeWalls) {
            message.walls = walls;
            transfer.push(walls.buffer);
            state.solverWallVersion = state.worldVersion;
        }
        worker.postMessage(message, transfer);
    }

    function handleWorkerMessage(event) {
        const message = event && event.data ? event.data : null;
        if (!message) return;
        if (message.type === "ready") {
            setLabelText(labels.workerStatus, "ready");
            return;
        }
        if (message.type === "error") {
            state.waitingForWorker = false;
            state.solverWallVersion = 0;
            setLabelText(labels.workerStatus, message.message || "solver error");
            return;
        }
        if (message.type !== "step_result") return;
        state.waitingForWorker = false;
        applySolverResult(message.agents);
        resolveTargetNpcContacts();
        state.stats = message.stats || null;
        if ((state.stats.hits || 0) > 0) {
            state.targetFlashTime = 0.18;
        }
        setLabelText(labels.workerStatus, "ready");
        updateStats();
    }

    function applySolverResult(packed) {
        if (!(packed instanceof Float32Array)) return;
        state.debug.headingGlitchFrame += 1;
        const byId = new Map(state.agents.map((agent) => [agent.id, agent]));
        for (let i = 0; i < packed.length; i += OUT_STRIDE) {
            const agent = byId.get(packed[i]);
            if (!agent) continue;
            agent.vx = packed[i + 3];
            agent.vy = packed[i + 4];
            agent.x = packed[i + 1];
            agent.y = packed[i + 2];
            agent.solverState = packed[i + 5];
            agent.wallClamps = packed[i + 6];
            agent.phase = packed[i + 7];
            agent.phaseTime = packed[i + 8];
            agent.cooldown = packed[i + 9];
            agent.slotAngle = packed[i + 10];
            agent.heading = packed[i + 11];
            agent.millingDirection = packed[i + 12] >= 0 ? 1 : -1;
            agent.millingWallTurnLock = Math.max(0, packed[i + 13] || 0);
            agent.waitTime = agent.solverState === STATE_HOLDING
                ? agent.waitTime + 1 / 60
                : Math.max(0, agent.waitTime - 0.12);
            recordAgentHeadingForGlitchDetection(agent);
        }
    }

    function recordAgentHeadingForGlitchDetection(agent) {
        if (!Number.isFinite(agent.heading)) return;
        if (!Array.isArray(agent.headingHistory)) agent.headingHistory = [];
        agent.headingHistory.push({
            frame: state.debug.headingGlitchFrame,
            heading: normalizeAngle(agent.heading),
            solverState: agent.solverState,
            phase: agent.phase,
            phaseTime: agent.phaseTime,
            pathMode: agent.pathMode,
            pathCursor: agent.pathCursor,
            pathGoalX: agent.pathGoalX,
            pathGoalY: agent.pathGoalY,
            x: agent.x,
            y: agent.y,
            vx: agent.vx,
            vy: agent.vy,
            wallClamps: agent.wallClamps,
            millingDirection: agent.millingDirection,
            millingWallTurnLock: agent.millingWallTurnLock
        });
        if (agent.headingHistory.length > 4) agent.headingHistory.shift();
        if (!state.debug.headingGlitchLogged && isAgentHeadingGlitch(agent.headingHistory)) {
            state.debug.headingGlitchLogged = true;
            logAgentHeadingGlitch(agent);
        }
    }

    function isAgentHeadingGlitch(history) {
        if (!Array.isArray(history) || history.length < 4) return false;
        const a = history[0];
        const b = history[1];
        const c = history[2];
        const d = history[3];
        if (b.frame !== a.frame + 1 || c.frame !== b.frame + 1 || d.frame !== c.frame + 1) return false;
        const turnA = Math.abs(shortestAngleDelta(a.heading, b.heading));
        const turnB = Math.abs(shortestAngleDelta(b.heading, c.heading));
        const turnC = Math.abs(shortestAngleDelta(c.heading, d.heading));
        const returned = Math.abs(shortestAngleDelta(a.heading, d.heading));
        return turnA >= HEADING_GLITCH_TURN_THRESHOLD &&
            turnB >= HEADING_GLITCH_TURN_THRESHOLD &&
            turnC >= HEADING_GLITCH_TURN_THRESHOLD &&
            returned <= HEADING_GLITCH_RETURN_THRESHOLD;
    }

    function normalizeAngle(angle) {
        let out = angle;
        while (out <= -Math.PI) out += Math.PI * 2;
        while (out > Math.PI) out -= Math.PI * 2;
        return out;
    }

    function shortestAngleDelta(from, to) {
        return normalizeAngle(to - from);
    }

    function logAgentHeadingGlitch(agent) {
        const history = agent.headingHistory.map((entry) => ({
            frame: entry.frame,
            heading: entry.heading,
            headingDegrees: Math.round(entry.heading * 180 / Math.PI),
            solverState: getSolverStateName(entry.solverState),
            phase: getPhaseName(entry.phase),
            phaseTime: entry.phaseTime,
            pathMode: entry.pathMode === PATH_MODE_WORKER ? "worker" : "direct",
            pathCursor: entry.pathCursor,
            pathGoalX: entry.pathGoalX,
            pathGoalY: entry.pathGoalY,
            x: entry.x,
            y: entry.y,
            vx: entry.vx,
            vy: entry.vy,
            speed: Math.hypot(entry.vx, entry.vy),
            wallClamps: entry.wallClamps,
            millingDirection: entry.millingDirection,
            millingWallTurnLock: entry.millingWallTurnLock
        }));
        const dump = {
            reason: "heading returned to its starting direction after three consecutive turning frames",
            id: agent.id,
            frame: state.debug.headingGlitchFrame,
            history,
            current: {
                position: { x: agent.x, y: agent.y },
                velocity: { x: agent.vx, y: agent.vy, speed: Math.hypot(agent.vx, agent.vy) },
                heading: agent.heading,
                solverState: getSolverStateName(agent.solverState),
                phase: getPhaseName(agent.phase),
                phaseTime: agent.phaseTime,
                waitTime: agent.waitTime,
                cooldown: agent.cooldown,
                wallClamps: agent.wallClamps,
                pathMode: agent.pathMode === PATH_MODE_WORKER ? "worker" : "direct",
                pathCursor: agent.pathCursor,
                pathLength: agent.pathNodeKeys.length,
                pathGoal: { x: agent.pathGoalX, y: agent.pathGoalY },
                pathRequestPending: agent.pathRequestPending,
                pathRequestedWorldVersion: agent.pathRequestedWorldVersion,
                pathRequestedStartKey: agent.pathRequestedStartKey,
                pathRequestedGoalKey: agent.pathRequestedGoalKey
            },
            target: { x: state.target.x, y: state.target.y },
            stats: state.stats
        };
        console.groupCollapsed(`Wizard of Flatland heading glitch: agent ${agent.id}`);
        console.log(dump);
        console.table(history);
        console.groupEnd();
    }

    function getSolverStateName(value) {
        switch (value) {
            case STATE_MILLING: return "milling";
            case STATE_ATTACKING: return "attacking";
            case STATE_BLOCKED: return "blocked";
            case STATE_SEEKING: return "seeking";
            case STATE_HOLDING: return "holding";
            case STATE_RECOVERING: return "recovering";
            case STATE_VACATING: return "vacating";
            default: return `unknown:${value}`;
        }
    }

    function getPhaseName(value) {
        switch (value) {
            case PHASE_MILLING: return "milling";
            case 1: return "attacking";
            case 2: return "recovering";
            case 3: return "holding";
            case 4: return "seeking";
            case 5: return "vacating";
            default: return `unknown:${value}`;
        }
    }

    function updateStats() {
        const stats = state.stats || {};
        setLabelText(labels.solveMs, `${Number(stats.solveMs || 0).toFixed(2)} ms`);
        setLabelText(labels.pairChecks, String(stats.pairChecks || 0));
        setLabelText(labels.movingCount, String(stats.moving || stats.milling || 0));
        setLabelText(labels.seekingCount, String(stats.seeking || 0));
        setLabelText(labels.waitingCount, String(stats.waiting || 0));
        setLabelText(labels.attackingCount, String(stats.attacking || 0));
        setLabelText(labels.retreatingCount, String(stats.retreating || 0));
        setLabelText(labels.blockedCount, String(stats.blocked || 0));
        setLabelText(labels.wallLeaks, String(stats.wallLeaks || 0));
    }

    function updateAgentPathing(_dt) {
        const now = performance.now();
        const goalNodeIndex = nearestPassablePathfindingNode(state.target.x, state.target.y);
        const goalNodeKey = getPathfindingNodeKey(goalNodeIndex);
        for (const agent of state.agents) {
            if (!isAgentInInstalledMazeSection(agent)) {
                freezeAgentForUnloadedSection(agent);
                continue;
            }
            const hasLos = hasDirectLineOfSight(agent.x, agent.y, state.target.x, state.target.y, agent.radius);
            if (hasLos) {
                agent.pathMode = PATH_MODE_DIRECT;
                agent.pathGoalX = state.target.x;
                agent.pathGoalY = state.target.y;
                agent.pathNodeKeys = [];
                agent.pathWaypoints = [];
                agent.pathCursor = 0;
                continue;
            }

            agent.pathMode = PATH_MODE_WORKER;
            advanceAgentPathCursor(agent);
            const waypoint = getAgentPathWaypoint(agent);
            if (waypoint) {
                agent.pathGoalX = waypoint.x;
                agent.pathGoalY = waypoint.y;
            }

            const rawStartNodeIndex = nearestPathfindingNode(agent.x, agent.y);
            const startNodeIndex = isPathfindingNodePassable(rawStartNodeIndex)
                ? rawStartNodeIndex
                : nearestPassablePathfindingNode(agent.x, agent.y);
            const rawStartNodeKey = getPathfindingNodeKey(rawStartNodeIndex);
            const startNodeKey = getPathfindingNodeKey(startNodeIndex);
            const shouldRequest =
                !agent.pathRequestPending &&
                (
                    agent.pathNodeKeys.length === 0 ||
                    agent.pathRequestedGoalKey !== goalNodeKey ||
                    agent.pathRequestedRawStartKey !== rawStartNodeKey ||
                    agent.pathRequestedStartKey !== startNodeKey ||
                    now - agent.pathRequestedAt >= PATH_REQUEST_INTERVAL_SECONDS * 1000
                );
            if (shouldRequest) requestAgentPath(agent, rawStartNodeIndex, startNodeIndex, goalNodeIndex, now);
        }
    }

    function hasDirectLineOfSight(fromX, fromY, toX, toY, radius) {
        const wallGeometry = getWallGeometryApi();
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            if (wallGeometry.connectionCrossesWallFaces(
                { x: fromX, y: fromY },
                { x: toX, y: toY },
                { x: state.walls[i + WALL_X1], y: state.walls[i + WALL_Y1] },
                { x: state.walls[i + WALL_X2], y: state.walls[i + WALL_Y2] },
                {
                    thickness: WALL_WORLD_THICKNESS,
                    extend: PATH_NODE_WALL_FACE_EXTEND
                }
            )) {
                return false;
            }
        }
        return true;
    }

    function nearestPathfindingNode(worldX, worldY) {
        let bestIndex = -1;
        let bestDistSq = Infinity;
        const count = getPathfindingNodeCount();
        for (let pathIndex = 0; pathIndex < count; pathIndex++) {
            const dx = getPathfindingNodeX(pathIndex) - worldX;
            const dy = getPathfindingNodeY(pathIndex) - worldY;
            const distSq = dx * dx + dy * dy;
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                bestIndex = pathIndex;
            }
        }
        if (bestIndex < 0) throw new Error("Wizard of Flatland pathfinding requires at least one node");
        return bestIndex;
    }

    function nearestPassablePathfindingNode(worldX, worldY) {
        let bestIndex = -1;
        let bestDistSq = Infinity;
        const count = getPathfindingNodeCount();
        for (let pathIndex = 0; pathIndex < count; pathIndex++) {
            if (!isPathfindingNodePassable(pathIndex)) continue;
            const dx = getPathfindingNodeX(pathIndex) - worldX;
            const dy = getPathfindingNodeY(pathIndex) - worldY;
            const distSq = dx * dx + dy * dy;
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                bestIndex = pathIndex;
            }
        }
        if (bestIndex < 0) throw new Error("Wizard of Flatland pathfinding requires at least one passable node");
        return bestIndex;
    }

    function advanceAgentPathCursor(agent) {
        while (agent.pathCursor < agent.pathNodeKeys.length) {
            const waypoint = getAgentPathWaypoint(agent);
            if (!waypoint) return;
            const distance = Math.hypot(waypoint.x - agent.x, waypoint.y - agent.y);
            if (distance > PATH_WAYPOINT_REACHED_DISTANCE) return;
            agent.pathCursor += 1;
        }
    }

    function getAgentPathWaypoint(agent) {
        if (agent.pathCursor >= agent.pathNodeKeys.length) return null;
        const pathKey = agent.pathNodeKeys[agent.pathCursor];
        if (typeof pathKey !== "string" || pathKey.length === 0) {
            throw new Error(`Wizard of Flatland path contains malformed node key at cursor ${agent.pathCursor}`);
        }
        const currentPathIndex = getPathfindingNodeIndexForKey(pathKey);
        const storedWaypoint = getStoredAgentPathWaypoint(agent, agent.pathCursor, pathKey);
        if (Number.isInteger(currentPathIndex)) {
            return {
                pathIndex: currentPathIndex,
                x: getPathfindingNodeX(currentPathIndex),
                y: getPathfindingNodeY(currentPathIndex),
                key: pathKey,
                blocked: isPathfindingNodeBlocked(currentPathIndex),
                stale: false
            };
        }
        if (!storedWaypoint) {
            throw new Error(`Wizard of Flatland path waypoint ${pathKey} is missing from current and stored path data`);
        }
        return {
            pathIndex: null,
            x: storedWaypoint.x,
            y: storedWaypoint.y,
            key: pathKey,
            blocked: null,
            stale: true
        };
    }

    function getStoredAgentPathWaypoint(agent, cursor, expectedKey) {
        const waypoints = Array.isArray(agent.pathWaypoints) ? agent.pathWaypoints : [];
        const waypoint = waypoints[cursor];
        if (!waypoint || typeof waypoint !== "object") return null;
        if (waypoint.key !== expectedKey) {
            throw new Error(`Wizard of Flatland path waypoint key mismatch: expected ${expectedKey}, got ${waypoint.key}`);
        }
        if (!Number.isFinite(waypoint.x) || !Number.isFinite(waypoint.y)) {
            throw new Error(`Wizard of Flatland path waypoint ${expectedKey} has invalid coordinates`);
        }
        return waypoint;
    }

    function getPathfindingNodeCount() {
        return state.nodeLayer.nodes.length / PATH_SNAPSHOT_NODE_STRIDE;
    }

    function getPathfindingEdgeCount() {
        return state.nodeLayer.edges.length / PATH_SNAPSHOT_EDGE_STRIDE;
    }

    function getPathfindingBlockedEdgeCount() {
        return state.nodeLayer.blockedEdges.length / PATH_SNAPSHOT_EDGE_STRIDE;
    }

    function isValidPathfindingNodeIndex(pathIndex) {
        return Number.isInteger(pathIndex) && pathIndex >= 0 && pathIndex < getPathfindingNodeCount();
    }

    function getPathfindingNodeBase(pathIndex) {
        if (!isValidPathfindingNodeIndex(pathIndex)) {
            throw new Error(`Wizard of Flatland path node index is invalid: ${pathIndex}`);
        }
        return pathIndex * PATH_SNAPSHOT_NODE_STRIDE;
    }

    function getPathfindingNodeX(pathIndex) {
        return state.nodeLayer.nodes[getPathfindingNodeBase(pathIndex) + PATH_NODE_X];
    }

    function getPathfindingNodeY(pathIndex) {
        return state.nodeLayer.nodes[getPathfindingNodeBase(pathIndex) + PATH_NODE_Y];
    }

    function isPathfindingNodeBlocked(pathIndex) {
        return state.nodeLayer.nodes[getPathfindingNodeBase(pathIndex) + PATH_NODE_BLOCKED] === 1;
    }

    function getPathfindingNodeXIndex(pathIndex) {
        return Math.round(state.nodeLayer.nodes[getPathfindingNodeBase(pathIndex) + PATH_NODE_XINDEX]);
    }

    function getPathfindingNodeYIndex(pathIndex) {
        return Math.round(state.nodeLayer.nodes[getPathfindingNodeBase(pathIndex) + PATH_NODE_YINDEX]);
    }

    function getPathfindingNodeKey(pathIndex) {
        return pathfindingNodeKey(getPathfindingNodeXIndex(pathIndex), getPathfindingNodeYIndex(pathIndex));
    }

    function getPathfindingNodeIndexForKey(pathKey) {
        if (typeof pathKey !== "string" || pathKey.length === 0) {
            throw new Error("Wizard of Flatland path node lookup requires a node key");
        }
        if (!(state.nodeLayer.indexByKey instanceof Map)) {
            throw new Error("Wizard of Flatland path node lookup requires a node key index");
        }
        return state.nodeLayer.indexByKey.has(pathKey) ? state.nodeLayer.indexByKey.get(pathKey) : null;
    }

    function appendAgentPathWaypoint(pathNodeKeys, pathWaypoints, pathIndex, prepend = false) {
        if (!Array.isArray(pathNodeKeys) || !Array.isArray(pathWaypoints)) {
            throw new Error("Wizard of Flatland path waypoint append requires path arrays");
        }
        if (!isValidPathfindingNodeIndex(pathIndex)) {
            throw new Error(`Wizard of Flatland path waypoint append received invalid node index ${pathIndex}`);
        }
        const waypoint = {
            key: getPathfindingNodeKey(pathIndex),
            x: getPathfindingNodeX(pathIndex),
            y: getPathfindingNodeY(pathIndex)
        };
        if (prepend) {
            pathNodeKeys.unshift(waypoint.key);
            pathWaypoints.unshift(waypoint);
            return;
        }
        pathNodeKeys.push(waypoint.key);
        pathWaypoints.push(waypoint);
    }

    function requestAgentPath(agent, rawStartNodeIndex, startNodeIndex, goalNodeIndex, now) {
        const requestId = state.pathfindingRequestId++;
        const rawStartNodeKey = getPathfindingNodeKey(rawStartNodeIndex);
        const startNodeKey = getPathfindingNodeKey(startNodeIndex);
        const goalNodeKey = getPathfindingNodeKey(goalNodeIndex);
        agent.pathRequestPending = true;
        agent.pathRequestId = requestId;
        agent.pathRequestedAt = now;
        agent.pathRequestedWorldVersion = state.pathfindingSnapshotVersion;
        agent.pathRequestedRawStartKey = rawStartNodeKey;
        agent.pathRequestedStartKey = startNodeKey;
        agent.pathRequestedGoalKey = goalNodeKey;
        pathfindingWorker.postMessage({
            type: "request_path",
            requestId,
            mapVersion: state.pathfindingSnapshotVersion,
            actor: {
                size: 1,
                damage: 1,
                canBreakDoors: false,
                canBreakTreesLargerThanSelf: false
            },
            startNodeIndex,
            destinationNodeIndex: goalNodeIndex,
            options: {
                allowBlockedDestination: false,
                maxPathLength: null,
                wallAvoidance: 0.4,
                includeBlockedPlan: false
            }
        });
    }

    function handlePathfindingWorkerMessage(event) {
        const message = event && event.data ? event.data : null;
        if (!message || typeof message.type !== "string") return;
        if (message.type === "ready") return;
        if (message.type !== "path_result") return;
        const agent = state.agents.find((candidate) => candidate.pathRequestId === message.requestId);
        if (!agent) return;
        agent.pathRequestPending = false;
        if (Number(message.mapVersion) !== Number(state.pathfindingSnapshotVersion)) return;
        if (!message.ok) {
            agent.pathNodeKeys = [];
            agent.pathWaypoints = [];
            agent.pathCursor = 0;
            agent.pathGoalX = agent.x;
            agent.pathGoalY = agent.y;
            return;
        }
        if (!(message.pathNodeIndices instanceof Int32Array) && !Array.isArray(message.pathNodeIndices)) {
            throw new Error("Wizard of Flatland pathfinding worker returned a malformed path");
        }
        const pathNodeKeys = [];
        const pathWaypoints = [];
        for (const pathIndex of message.pathNodeIndices) {
            if (!isValidPathfindingNodeIndex(pathIndex)) {
                throw new Error(`Wizard of Flatland pathfinding worker returned unknown node index ${pathIndex}`);
            }
            appendAgentPathWaypoint(pathNodeKeys, pathWaypoints, pathIndex);
        }
        if (agent.pathRequestedStartKey !== agent.pathRequestedRawStartKey) {
            const requestedStartIndex = getPathfindingNodeIndexForKey(agent.pathRequestedStartKey);
            if (Number.isInteger(requestedStartIndex) && pathNodeKeys[0] !== agent.pathRequestedStartKey) {
                appendAgentPathWaypoint(pathNodeKeys, pathWaypoints, requestedStartIndex, true);
            }
        }
        agent.pathNodeKeys = pathNodeKeys;
        agent.pathWaypoints = pathWaypoints;
        agent.pathCursor = 0;
        advanceAgentPathCursor(agent);
        const waypoint = getAgentPathWaypoint(agent);
        if (waypoint) {
            agent.pathGoalX = waypoint.x;
            agent.pathGoalY = waypoint.y;
        }
    }

    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const width = Math.max(1, Math.floor(rect.width * dpr));
        const height = Math.max(1, Math.floor(rect.height * dpr));
        const previousScale = state.view.scale;
        const previousOffsetX = state.view.offsetX;
        const previousOffsetY = state.view.offsetY;
        const previousCenterX = state.view.centerX;
        const previousCenterY = state.view.centerY;
        let resized = false;
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            resized = true;
        }
        state.view.width = width;
        state.view.height = height;
        state.view.dpr = dpr;
        state.view.baseScale = Math.min(width / 42, height / 29);
        state.view.scale = state.view.baseScale * state.view.zoom;
        state.view.offsetX = width / 2;
        state.view.offsetY = height / 2;
        state.view.centerX = Number.isFinite(state.target.x) ? state.target.x : 0;
        state.view.centerY = Number.isFinite(state.target.y) ? state.target.y : 0;
        if (
            resized ||
            Math.abs(state.view.scale - previousScale) > 0.001 ||
            Math.abs(state.view.offsetX - previousOffsetX) > 0.001 ||
            Math.abs(state.view.offsetY - previousOffsetY) > 0.001 ||
            Math.abs(state.view.centerX - previousCenterX) > 0.001 ||
            Math.abs(state.view.centerY - previousCenterY) > 0.001
        ) {
            state.hexGridLayer.dirty = true;
            state.nodeLayer.dirty = true;
            if (
                isProceduralMazeScenario() &&
                (
                    resized ||
                    Math.abs(state.view.scale - previousScale) > 0.001 ||
                    Math.abs(state.view.offsetX - previousOffsetX) > 0.001 ||
                    Math.abs(state.view.offsetY - previousOffsetY) > 0.001
                )
            ) {
                invalidateMazeLookaheadCache();
            }
        }
    }

    function worldToScreen(x, y) {
        return {
            x: state.view.offsetX + (x - state.view.centerX) * state.view.scale,
            y: state.view.offsetY + (y - state.view.centerY) * state.view.scale
        };
    }

    function handleZoomWheel(event) {
        if (!state.zoomHeld) return false;
        if (!event || !Number.isFinite(event.deltaY)) return false;
        resizeCanvas();
        const previousZoom = state.view.zoom;
        const multiplier = Math.exp(-event.deltaY * VIEW_ZOOM_WHEEL_STEP);
        const nextZoom = Math.max(VIEW_ZOOM_MIN, Math.min(VIEW_ZOOM_MAX, previousZoom * multiplier));
        if (Math.abs(nextZoom - previousZoom) <= 0.0001) {
            event.preventDefault();
            return true;
        }
        state.view.zoom = nextZoom;
        state.view.scale = state.view.baseScale * state.view.zoom;
        state.hexGridLayer.dirty = true;
        state.nodeLayer.dirty = true;
        if (isProceduralMazeScenario()) {
            invalidateMazeLookaheadCache();
            state.nodeLayer.pathCenterX = NaN;
            state.nodeLayer.pathCenterY = NaN;
        }
        event.preventDefault();
        return true;
    }

    function ensureDebugFpsCounterElement() {
        if (state.debug.fpsCounterElement) return state.debug.fpsCounterElement;
        const element = document.createElement("div");
        element.className = "debug-fps-counter hidden";
        element.setAttribute("aria-live", "off");
        document.body.appendChild(element);
        state.debug.fpsCounterElement = element;
        return element;
    }

    function setDebugFpsCounterVisible(visible) {
        state.debug.showFpsCounter = !!visible;
        const element = ensureDebugFpsCounterElement();
        element.classList.toggle("hidden", !state.debug.showFpsCounter);
        if (state.debug.showFpsCounter) {
            state.debug.lastFpsCounterUpdateAt = 0;
        }
        return state.debug.showFpsCounter;
    }

    function toggleDebugFpsCounter() {
        return setDebugFpsCounterVisible(!state.debug.showFpsCounter);
    }

    function updateDebugFpsCounter(now, dt, renderMs) {
        if (!state.debug.showFpsCounter) return;
        if (now - state.debug.lastFpsCounterUpdateAt < 100) return;
        const element = ensureDebugFpsCounterElement();
        const fps = dt > 0 ? 1 / dt : 0;
        element.textContent = `FPS ${fps.toFixed(1)}  Render ${renderMs.toFixed(2)} ms`;
        state.debug.lastFpsCounterUpdateAt = now;
    }

    function draw() {
        resizeCanvas();
        ctx.fillStyle = "#777777";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawPathfindingNodeLayer();
        drawWalls();
        drawSectionBoundaries();
        drawWallLabels();
        drawWallBuildPreview();
        drawTarget();
        drawAgentPaths();
        drawFireballs();
        drawFireballExplosions();
        drawAgents();
    }

    function drawHexGridLayer() {
        const layer = state.hexGridLayer;
        if (!layer.ctx) throw new Error("Wizard of Flatland hex grid layer requires a 2D context");
        if (
            layer.dirty ||
            layer.width !== state.view.width ||
            layer.height !== state.view.height ||
            Math.abs(layer.scale - state.view.scale) > 0.001 ||
            Math.abs(layer.offsetX - state.view.offsetX) > 0.001 ||
            Math.abs(layer.offsetY - state.view.offsetY) > 0.001 ||
            Math.abs(layer.centerX - state.view.centerX) > 0.001 ||
            Math.abs(layer.centerY - state.view.centerY) > 0.001
        ) {
            rebuildHexGridLayer();
        }
        ctx.drawImage(layer.canvas, 0, 0);
    }

    function rebuildHexGridLayer() {
        const layer = state.hexGridLayer;
        if (!layer.ctx) throw new Error("Wizard of Flatland hex grid layer requires a 2D context");
        if (!(state.view.width > 0 && state.view.height > 0 && state.view.scale > 0)) {
            throw new Error("Wizard of Flatland hex grid requires a valid viewport");
        }

        layer.width = state.view.width;
        layer.height = state.view.height;
        layer.scale = state.view.scale;
        layer.offsetX = state.view.offsetX;
        layer.offsetY = state.view.offsetY;
        layer.centerX = state.view.centerX;
        layer.centerY = state.view.centerY;
        layer.canvas.width = layer.width;
        layer.canvas.height = layer.height;

        const gridCtx = layer.ctx;
        gridCtx.clearRect(0, 0, layer.width, layer.height);
        gridCtx.save();
        gridCtx.lineWidth = Math.max(1, layer.scale * 0.018);
        gridCtx.strokeStyle = "rgba(236,244,248,0.13)";

        const worldMinX = layer.centerX + (0 - layer.offsetX) / layer.scale;
        const worldMaxX = layer.centerX + (layer.width - layer.offsetX) / layer.scale;
        const worldMinY = layer.centerY + (0 - layer.offsetY) / layer.scale;
        const worldMaxY = layer.centerY + (layer.height - layer.offsetY) / layer.scale;
        const colStart = Math.floor(worldMinX / HEX_GRID_COL_STEP) - HEX_GRID_PADDING;
        const colEnd = Math.ceil(worldMaxX / HEX_GRID_COL_STEP) + HEX_GRID_PADDING;
        const rowStart = Math.floor(worldMinY / HEX_GRID_ROW_STEP) - HEX_GRID_PADDING;
        const rowEnd = Math.ceil(worldMaxY / HEX_GRID_ROW_STEP) + HEX_GRID_PADDING;
        const halfW = HEX_GRID_WIDTH * layer.scale * 0.5;
        const quarterW = HEX_GRID_WIDTH * layer.scale * 0.25;
        const halfH = HEX_GRID_HEIGHT * layer.scale * 0.5;

        for (let col = colStart; col <= colEnd; col++) {
            const centerX = layer.offsetX + (col * HEX_GRID_COL_STEP - layer.centerX) * layer.scale;
            for (let row = rowStart; row <= rowEnd; row++) {
                const centerY = layer.offsetY + (row + (isEvenGridColumn(col) ? 0.5 : 0) - layer.centerY) * layer.scale;
                gridCtx.beginPath();
                gridCtx.moveTo(centerX - halfW, centerY);
                gridCtx.lineTo(centerX - quarterW, centerY - halfH);
                gridCtx.lineTo(centerX + quarterW, centerY - halfH);
                gridCtx.lineTo(centerX + halfW, centerY);
                gridCtx.lineTo(centerX + quarterW, centerY + halfH);
                gridCtx.lineTo(centerX - quarterW, centerY + halfH);
                gridCtx.closePath();
                gridCtx.stroke();
            }
        }

        gridCtx.restore();
        layer.dirty = false;
    }

    function isEvenGridColumn(col) {
        return Math.abs(col % 2) === 0;
    }

    function rebuildPathfindingNodeLayer() {
        const wallGeometry = getWallGeometryApi();
        const bounds = getPathfindingLayerBounds();
        state.nodeLayer.pathCenterX = state.target.x;
        state.nodeLayer.pathCenterY = state.target.y;
        const colStart = Math.floor(bounds.minX / HEX_GRID_COL_STEP) - PATH_NODE_LAYER_PADDING;
        const colEnd = Math.ceil(bounds.maxX / HEX_GRID_COL_STEP) + PATH_NODE_LAYER_PADDING;
        const rowStart = Math.floor(bounds.minY) - PATH_NODE_LAYER_PADDING;
        const rowEnd = Math.ceil(bounds.maxY) + PATH_NODE_LAYER_PADDING;
        const nodes = [];
        const nodeByKey = new Map();

        for (let col = colStart; col <= colEnd; col++) {
            for (let row = rowStart; row <= rowEnd; row++) {
                const node = createPathfindingNode(col, row);
                nodes.push(node);
                nodeByKey.set(node.key, node);
            }
        }

        for (const node of nodes) {
            const offsets = getPathfindingNeighborOffsets(node.xindex);
            for (let dir = 0; dir < 12; dir++) {
                const offset = offsets[dir];
                const neighbor = nodeByKey.get(pathfindingNodeKey(node.xindex + offset.x, node.yindex + offset.y));
                node.neighbors[dir] = neighbor || null;
            }
        }

        const blockedEdges = [];
        const blockedKeys = new Set();
        for (let w = 0; w < state.walls.length; w += WALL_STRIDE) {
            const ax = state.walls[w + WALL_X1];
            const ay = state.walls[w + WALL_Y1];
            const bx = state.walls[w + WALL_X2];
            const by = state.walls[w + WALL_Y2];
            const wallMinX = Math.min(ax, bx) - HEX_GRID_WIDTH;
            const wallMaxX = Math.max(ax, bx) + HEX_GRID_WIDTH;
            const wallMinY = Math.min(ay, by) - HEX_GRID_HEIGHT;
            const wallMaxY = Math.max(ay, by) + HEX_GRID_HEIGHT;
            for (const node of nodes) {
                if (node.x < wallMinX || node.x > wallMaxX || node.y < wallMinY || node.y > wallMaxY) continue;
                for (let dir = 0; dir < 12; dir++) {
                    const neighbor = node.neighbors[dir];
                    if (!neighbor) continue;
                    const edgeKey = pathfindingEdgeKey(node, neighbor);
                    if (blockedKeys.has(edgeKey)) continue;
                    if (!wallGeometry.connectionCrossesWallFaces(
                        node,
                        neighbor,
                        { x: ax, y: ay },
                        { x: bx, y: by },
                        {
                            thickness: PATH_NODE_WALL_THICKNESS,
                            extend: PATH_NODE_WALL_FACE_EXTEND
                        }
                    )) {
                        continue;
                    }
                    blockedKeys.add(edgeKey);
                    addDirectionalBlock(node, dir, w / WALL_STRIDE);
                    const reverseDir = neighbor.neighbors.indexOf(node);
                    if (reverseDir >= 0) addDirectionalBlock(neighbor, reverseDir, w / WALL_STRIDE);
                    blockedEdges.push({ a: node, b: neighbor, wallIndex: w / WALL_STRIDE });
                }
            }
        }
        for (const node of nodes) {
            node.blocked = !isPathfindingNodeTerrainPassable(node);
        }
        for (let i = 0; i < nodes.length; i++) {
            nodes[i].pathIndex = i;
        }
        const packedNodes = packPathfindingNodeObjects(nodes);
        const packedEdges = packPathfindingEdgeObjects(nodes);
        state.nodeLayer.nodes = packedNodes;
        state.nodeLayer.snapshotNodes = packedNodes.slice();
        state.nodeLayer.edges = packedEdges;
        state.nodeLayer.blockedEdges = packBlockedPathfindingEdgeObjects(blockedEdges);
        state.nodeLayer.indexByKey = buildPathfindingNodeIndexByKey(packedNodes);
        state.nodeLayer.nodeStride = PATH_SNAPSHOT_NODE_STRIDE;
        state.nodeLayer.edgeStride = PATH_SNAPSHOT_EDGE_STRIDE;
        state.nodeLayer.version += 1;
        state.nodeLayer.dirty = true;
        publishPathfindingSnapshot();
    }

    function packPathfindingNodeObjects(nodes) {
        const packed = new Float32Array(nodes.length * PATH_SNAPSHOT_NODE_STRIDE);
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const base = i * PATH_SNAPSHOT_NODE_STRIDE;
            packed[base + PATH_NODE_X] = node.x;
            packed[base + PATH_NODE_Y] = node.y;
            packed[base + PATH_NODE_BLOCKED] = node.blocked === true ? 1 : 0;
            packed[base + PATH_NODE_CLEARANCE] = Infinity;
            packed[base + PATH_NODE_XINDEX] = node.xindex;
            packed[base + PATH_NODE_YINDEX] = node.yindex;
            packed[base + PATH_NODE_HAS_UNBLOCKED_NEIGHBOR] = hasUnblockedPathfindingObjectNeighbor(node) ? 1 : 0;
            packed[base + 7] = 0;
        }
        return packed;
    }

    function packPathfindingEdgeObjects(nodes) {
        let edgeCount = 0;
        for (const node of nodes) {
            for (let dir = 0; dir < node.neighbors.length; dir++) {
                if (node.neighbors[dir] && !node.blockedNeighbors.has(dir)) edgeCount += 1;
            }
        }
        const packed = new Int32Array(edgeCount * PATH_SNAPSHOT_EDGE_STRIDE);
        let offset = 0;
        for (const node of nodes) {
            for (let dir = 0; dir < node.neighbors.length; dir++) {
                const neighbor = node.neighbors[dir];
                if (!neighbor || node.blockedNeighbors.has(dir)) continue;
                packed[offset + PATH_EDGE_FROM] = node.pathIndex;
                packed[offset + PATH_EDGE_TO] = neighbor.pathIndex;
                packed[offset + PATH_EDGE_DIRECTION] = dir;
                packed[offset + 3] = 0;
                offset += PATH_SNAPSHOT_EDGE_STRIDE;
            }
        }
        return packed;
    }

    function packBlockedPathfindingEdgeObjects(blockedEdges) {
        const packed = new Int32Array(blockedEdges.length * PATH_SNAPSHOT_EDGE_STRIDE);
        for (let i = 0; i < blockedEdges.length; i++) {
            const edge = blockedEdges[i];
            const base = i * PATH_SNAPSHOT_EDGE_STRIDE;
            packed[base + PATH_EDGE_FROM] = edge.a.pathIndex;
            packed[base + PATH_EDGE_TO] = edge.b.pathIndex;
            packed[base + 2] = edge.wallIndex;
            packed[base + 3] = 0;
        }
        return packed;
    }

    function publishPathfindingSnapshot() {
        state.pathfindingSnapshotVersion = state.worldVersion;
        const snapshot = profiler.span("build packed path snapshot", () => buildPathfindingWorkerSnapshot());
        profiler.span("transfer packed path snapshot", () => {
            pathfindingWorker.postMessage({
                type: "replace_snapshot",
                snapshot
            }, [snapshot.nodes.buffer, snapshot.edges.buffer]);
        });
    }

    function buildPathfindingWorkerSnapshot() {
        const nodes = state.nodeLayer.snapshotNodes;
        const edges = state.nodeLayer.edges;
        if (!(nodes instanceof Float32Array) || nodes.length % PATH_SNAPSHOT_NODE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland packed path snapshot requires packed nodes");
        }
        if (!(edges instanceof Int32Array) || edges.length % PATH_SNAPSHOT_EDGE_STRIDE !== 0) {
            throw new Error("Wizard of Flatland packed path snapshot requires packed edges");
        }
        return {
            format: "wizard-flatland-packed-v1",
            version: state.pathfindingSnapshotVersion,
            nodeStride: PATH_SNAPSHOT_NODE_STRIDE,
            edgeStride: PATH_SNAPSHOT_EDGE_STRIDE,
            nodes,
            edges
        };
    }

    function getWallGeometryApi() {
        const api = window.WallGeometry;
        if (!api || typeof api.connectionCrossesWallFaces !== "function") {
            throw new Error("Wizard of Flatland pathfinding node layer requires WallGeometry.connectionCrossesWallFaces");
        }
        return api;
    }

    function getPathfindingLayerBounds() {
        if (isProceduralMazeScenario()) {
            const halfWidth = state.view && state.view.scale > 0
                ? state.view.width / state.view.scale * 0.5
                : 28;
            const halfHeight = state.view && state.view.scale > 0
                ? state.view.height / state.view.scale * 0.5
                : 20;
            const padding = getMazeChunkSize() * 0.65;
            return {
                minX: state.target.x - halfWidth - padding,
                minY: state.target.y - halfHeight - padding,
                maxX: state.target.x + halfWidth + padding,
                maxY: state.target.y + halfHeight + padding
            };
        }
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            minX = Math.min(minX, state.walls[i + WALL_X1], state.walls[i + WALL_X2]);
            minY = Math.min(minY, state.walls[i + WALL_Y1], state.walls[i + WALL_Y2]);
            maxX = Math.max(maxX, state.walls[i + WALL_X1], state.walls[i + WALL_X2]);
            maxY = Math.max(maxY, state.walls[i + WALL_Y1], state.walls[i + WALL_Y2]);
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
            throw new Error("Wizard of Flatland pathfinding node layer requires finite wall bounds");
        }
        return { minX, minY, maxX, maxY };
    }

    function createPathfindingNode(xindex, yindex) {
        return {
            x: xindex * HEX_GRID_COL_STEP,
            y: yindex + (isEvenGridColumn(xindex) ? 0.5 : 0),
            xindex,
            yindex,
            key: pathfindingNodeKey(xindex, yindex),
            pathIndex: -1,
            neighbors: new Array(12).fill(null),
            blockedNeighbors: new Map()
        };
    }

    function getPathfindingNeighborOffsets(xindex) {
        if (isEvenGridColumn(xindex)) {
            return [
                { x: -2, y: 0 },
                { x: -1, y: 0 },
                { x: -1, y: -1 },
                { x: 0, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 0 },
                { x: 2, y: 0 },
                { x: 1, y: 1 },
                { x: 1, y: 2 },
                { x: 0, y: 1 },
                { x: -1, y: 2 },
                { x: -1, y: 1 }
            ];
        }
        return [
            { x: -2, y: 0 },
            { x: -1, y: -1 },
            { x: -1, y: -2 },
            { x: 0, y: -1 },
            { x: 1, y: -2 },
            { x: 1, y: -1 },
            { x: 2, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
            { x: -1, y: 1 },
            { x: -1, y: 0 }
        ];
    }

    function pathfindingNodeKey(xindex, yindex) {
        return `${xindex},${yindex}`;
    }

    function pathfindingEdgeKey(a, b) {
        return a.key <= b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
    }

    function isPathfindingNodePassable(pathIndex) {
        return isValidPathfindingNodeIndex(pathIndex) &&
            !isPathfindingNodeBlocked(pathIndex) &&
            state.nodeLayer.nodes[getPathfindingNodeBase(pathIndex) + PATH_NODE_HAS_UNBLOCKED_NEIGHBOR] === 1;
    }

    function hasUnblockedPathfindingObjectNeighbor(node) {
        if (!node || !Array.isArray(node.neighbors)) return false;
        for (let dir = 0; dir < node.neighbors.length; dir++) {
            const neighbor = node.neighbors[dir];
            if (!neighbor || neighbor.blocked === true) continue;
            if (node.blockedNeighbors && node.blockedNeighbors.has(dir)) continue;
            return true;
        }
        return false;
    }

    function isPathfindingNodeTerrainPassable(node) {
        if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
            throw new Error("Wizard of Flatland pathfinding passability requires a finite node");
        }
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            const distance = pointSegmentDistance(
                node.x,
                node.y,
                state.walls[i + WALL_X1],
                state.walls[i + WALL_Y1],
                state.walls[i + WALL_X2],
                state.walls[i + WALL_Y2]
            );
            if (distance < TARGET_RADIUS + WALL_WORLD_HALF_THICKNESS) return false;
        }
        return true;
    }

    function addDirectionalBlock(node, direction, blocker) {
        if (!node || !Number.isInteger(direction) || direction < 0 || direction > 11) {
            throw new Error("Wizard of Flatland pathfinding block requires a valid node direction");
        }
        if (!node.neighbors[direction]) {
            throw new Error("Wizard of Flatland pathfinding block requires an existing neighbor connection");
        }
        if (!node.blockedNeighbors.has(direction)) node.blockedNeighbors.set(direction, new Set());
        node.blockedNeighbors.get(direction).add(blocker);
    }

    function drawPathfindingNodeLayer() {
        const layer = state.nodeLayer;
        if (!layer.ctx) throw new Error("Wizard of Flatland pathfinding node layer requires a 2D context");
        if (
            layer.dirty ||
            layer.width !== state.view.width ||
            layer.height !== state.view.height ||
            Math.abs(layer.scale - state.view.scale) > 0.001 ||
            Math.abs(layer.offsetX - state.view.offsetX) > 0.001 ||
            Math.abs(layer.offsetY - state.view.offsetY) > 0.001 ||
            Math.abs(layer.centerX - state.view.centerX) > 0.001 ||
            Math.abs(layer.centerY - state.view.centerY) > 0.001 ||
            layer.renderedVersion !== layer.version ||
            layer.renderedShowPathBlockedEdges !== state.debug.showPathBlockedEdges
        ) {
            rebuildPathfindingNodeRenderLayer();
        }
        ctx.drawImage(layer.canvas, 0, 0);
    }

    function rebuildPathfindingNodeRenderLayer() {
        const layer = state.nodeLayer;
        if (!layer.ctx) throw new Error("Wizard of Flatland pathfinding node layer requires a 2D context");
        if (!(state.view.width > 0 && state.view.height > 0 && state.view.scale > 0)) {
            throw new Error("Wizard of Flatland pathfinding node layer requires a valid viewport");
        }

        layer.width = state.view.width;
        layer.height = state.view.height;
        layer.scale = state.view.scale;
        layer.offsetX = state.view.offsetX;
        layer.offsetY = state.view.offsetY;
        layer.centerX = state.view.centerX;
        layer.centerY = state.view.centerY;
        layer.renderedVersion = layer.version;
        layer.renderedShowPathBlockedEdges = state.debug.showPathBlockedEdges;
        layer.canvas.width = layer.width;
        layer.canvas.height = layer.height;

        const nodeCtx = layer.ctx;
        nodeCtx.clearRect(0, 0, layer.width, layer.height);
        nodeCtx.save();

        if (state.debug.showPathBlockedEdges) {
            nodeCtx.strokeStyle = "rgba(255,107,107,0.78)";
            nodeCtx.lineWidth = Math.max(1.5, layer.scale * 0.035);
            nodeCtx.lineCap = "round";
            for (let i = 0; i < layer.blockedEdges.length; i += PATH_SNAPSHOT_EDGE_STRIDE) {
                const fromIndex = layer.blockedEdges[i + PATH_EDGE_FROM];
                const toIndex = layer.blockedEdges[i + PATH_EDGE_TO];
                if (!isValidPathfindingNodeIndex(fromIndex) || !isValidPathfindingNodeIndex(toIndex)) continue;
                const a = worldToScreen(getPathfindingNodeX(fromIndex), getPathfindingNodeY(fromIndex));
                const b = worldToScreen(getPathfindingNodeX(toIndex), getPathfindingNodeY(toIndex));
                nodeCtx.beginPath();
                nodeCtx.moveTo(a.x, a.y);
                nodeCtx.lineTo(b.x, b.y);
                nodeCtx.stroke();
            }
        }

        nodeCtx.restore();
        layer.dirty = false;
    }

    function drawWalls() {
        ctx.save();
        ctx.lineCap = "round";
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            const a = worldToScreen(state.walls[i + WALL_X1], state.walls[i + WALL_Y1]);
            const b = worldToScreen(state.walls[i + WALL_X2], state.walls[i + WALL_Y2]);
            ctx.lineWidth = state.view.scale * WALL_WORLD_THICKNESS;
            ctx.strokeStyle = "#000000";
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawSectionBoundaries() {
        if (!state.debug.showSectionBoundaries) return;
        if (!isProceduralMazeScenario()) return;
        const sectionKeys = getDebugSectionBoundaryKeys();
        if (sectionKeys.length === 0) return;
        const options = getMazeOptions();
        const radius = getMazeSectionRadius(options);

        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
        ctx.lineWidth = Math.max(1.25, state.view.scale * 0.035);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.setLineDash([Math.max(2, state.view.scale * 0.11), Math.max(3, state.view.scale * 0.15)]);
        for (const key of sectionKeys) {
            const coord = parseMazeSectionKey(key);
            const center = mazeSectionCenter(coord.q, coord.r, options);
            const corners = getHexCornersWorld(center.x, center.y, radius);
            drawSectionBoundaryPolygon(corners);
        }
        ctx.setLineDash([]);
        ctx.restore();
    }

    function getDebugSectionBoundaryKeys() {
        if (state.generatedMazeInstalledChunkKeys instanceof Set && state.generatedMazeInstalledChunkKeys.size > 0) {
            return Array.from(state.generatedMazeInstalledChunkKeys).sort();
        }
        if (state.generatedMazeChunkKeys instanceof Set) return Array.from(state.generatedMazeChunkKeys).sort();
        throw new Error("Wizard of Flatland section boundary debug requires section key tracking");
    }

    function drawSectionBoundaryPolygon(corners) {
        if (!Array.isArray(corners) || corners.length < 3) {
            throw new Error("Wizard of Flatland section boundary debug requires polygon corners");
        }
        const screenCorners = corners.map((corner) => worldToScreen(corner.x, corner.y));
        if (!polygonMayBeVisible(screenCorners)) return;
        ctx.beginPath();
        ctx.moveTo(screenCorners[0].x, screenCorners[0].y);
        for (let i = 1; i < screenCorners.length; i++) {
            ctx.lineTo(screenCorners[i].x, screenCorners[i].y);
        }
        ctx.closePath();
        ctx.stroke();
    }

    function polygonMayBeVisible(points) {
        const padding = 80;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const point of points) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
            throw new Error("Wizard of Flatland section boundary debug requires finite screen points");
        }
        return maxX >= -padding && minX <= state.view.width + padding && maxY >= -padding && minY <= state.view.height + padding;
    }

    function drawWallLabels() {
        if (!state.debug.showWallLabels) return;
        validateWallLabelBuffer(state.walls, "rendered walls");
        ctx.save();
        ctx.font = `${Math.max(15, Math.min(21, state.view.scale * 0.33))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            const ax = state.walls[i + WALL_X1];
            const ay = state.walls[i + WALL_Y1];
            const bx = state.walls[i + WALL_X2];
            const by = state.walls[i + WALL_Y2];
            const a = worldToScreen(ax, ay);
            const b = worldToScreen(bx, by);
            if (!segmentMayBeVisible(a, b)) continue;

            const label = getWallDebugLabel(state.walls[i + WALL_LABEL_CODE], state.walls[i + WALL_LABEL_SIDE]);
            const midX = (a.x + b.x) * 0.5;
            const midY = (a.y + b.y) * 0.5;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const length = Math.hypot(dx, dy);
            if (!(length > 0.001)) {
                throw new Error("Wizard of Flatland wall label render requires separated screen endpoints");
            }
            const offset = Math.max(15, state.view.scale * (WALL_WORLD_THICKNESS + 0.2));
            const labelX = midX - dy / length * offset;
            const labelY = midY + dx / length * offset;
            let angle = Math.atan2(dy, dx);
            if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
            const metrics = ctx.measureText(label);
            const paddingX = 4;
            const boxWidth = metrics.width + paddingX * 2;
            const boxHeight = Math.max(13, Number.parseFloat(ctx.font) + 5);
            ctx.save();
            ctx.translate(labelX, labelY);
            ctx.rotate(angle);
            ctx.fillStyle = "rgba(12, 14, 16, 0.74)";
            ctx.fillRect(-boxWidth * 0.5, -boxHeight * 0.5, boxWidth, boxHeight);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
            ctx.lineWidth = 1;
            ctx.strokeRect(-boxWidth * 0.5, -boxHeight * 0.5, boxWidth, boxHeight);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(label, 0, 0);
            ctx.restore();
        }
        ctx.restore();
    }

    function segmentMayBeVisible(a, b) {
        const padding = 80;
        const minX = Math.min(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxX = Math.max(a.x, b.x);
        const maxY = Math.max(a.y, b.y);
        return maxX >= -padding && minX <= state.view.width + padding && maxY >= -padding && minY <= state.view.height + padding;
    }

    function validateWallLabelBuffer(walls, label) {
        validateWallBuffer(walls, label);
        for (let i = 0; i < walls.length; i += WALL_STRIDE) {
            getWallDebugLabel(walls[i + WALL_LABEL_CODE], walls[i + WALL_LABEL_SIDE]);
        }
    }

    function getWallDebugLabel(labelCode, sideCode) {
        const code = Number(labelCode);
        const side = Number(sideCode);
        if (!Number.isInteger(code) || code <= 0) {
            throw new Error(`Wizard of Flatland wall label is missing for code ${labelCode}`);
        }
        if (!Number.isInteger(side)) {
            throw new Error(`Wizard of Flatland wall label side is invalid for code ${code}`);
        }
        const sideText = side >= 0 ? ` s${side}` : "";
        switch (code) {
            case WALL_LABEL_MANUAL_TOOL:
                return "manual tool | user drawn";
            case WALL_LABEL_ARENA_BOUNDARY:
                return `arena boundary${sideText} | unmodified`;
            case WALL_LABEL_ROOM_BOUNDARY:
                return `room boundary${sideText} | unmodified`;
            case WALL_LABEL_ROOM_HALL_GAP:
                return `room boundary${sideText} | hallway gap split`;
            case WALL_LABEL_ROOM_OUTSIDE_DOOR_GAP:
                return `room boundary${sideText} | outside-door gap split`;
            case WALL_LABEL_ROOM_POCKET_OVERRIDE:
                return `room boundary${sideText} | corner pocket reshaped`;
            case WALL_LABEL_ROOM_POCKET_OVERRIDE_HALL_GAP:
                return `room boundary${sideText} | corner pocket reshaped + hall gap`;
            case WALL_LABEL_ROOM_POCKET_CONNECTOR:
                return "corner pocket front wall | neighbor incorporated";
            case WALL_LABEL_SQUARE_SIDE_PARALLEL:
                return `corner pocket back wall${sideText}`;
            case WALL_LABEL_SQUARE_SIDE_PERPENDICULAR:
                return "corner pocket front wall";
            case WALL_LABEL_SQUARE_SIDE_PERPENDICULAR_FULL:
                return "corner pocket front wall | section boundary";
            case WALL_LABEL_HALLWAY_SIDE_HALF:
                return "hallway side | half-length";
            case WALL_LABEL_HALLWAY_SIDE_FULL:
                return "hallway side | corner pocket extended";
            default:
                throw new Error(`Wizard of Flatland wall label code is unknown: ${code}`);
        }
    }

    function drawWallBuildPreview() {
        const tool = state.wallTool;
        if (!tool.dragging || !tool.startNode || !tool.hoverNode) return;
        const a = worldToScreen(tool.startNode.x, tool.startNode.y);
        const b = worldToScreen(tool.hoverNode.x, tool.hoverNode.y);
        const sameNode = tool.startNode.key === tool.hoverNode.key;
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineWidth = state.view.scale * WALL_WORLD_THICKNESS;
        ctx.strokeStyle = sameNode ? "rgba(255,107,107,0.82)" : "rgba(0,0,0,0.9)";
        ctx.setLineDash(sameNode ? [6, 6] : [10, 7]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = sameNode ? "rgba(255,107,107,0.95)" : "rgba(0,0,0,0.95)";
        for (const point of [a, b]) {
            ctx.beginPath();
            ctx.arc(point.x, point.y, Math.max(4, state.view.scale * 0.09), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawTarget() {
        const point = worldToScreen(state.target.x, state.target.y);
        const flash = Math.max(0, Math.min(1, state.targetFlashTime / 0.18));
        const radius = TARGET_RADIUS * state.view.scale;
        ctx.save();
        ctx.strokeStyle = flash > 0 ? "#ff4d4d" : "#1f7a3a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = flash > 0
            ? `rgba(255,77,77,${0.25 + flash * 0.45})`
            : "rgba(31,122,58,0.42)";
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
        drawTargetTravelChevrons(point.x, point.y, radius);
        drawTargetHat(point.x, point.y + state.view.scale * 0.2, radius);
        drawProjectedTargetCursor(state.target.x, state.target.y, state.target.heading);
        ctx.restore();
    }

    function drawTargetTravelChevrons(x, y, radius) {
        const travel = state.targetTravelVector;
        const dx = Number(travel && travel.x) || 0;
        const dy = Number(travel && travel.y) || 0;
        if (Math.hypot(dx, dy) <= 0.0001) return;

        const angle = Math.atan2(dy, dx);
        const chevronWidth = radius * (2 / 3);
        const chevronHeight = chevronWidth * 2 * Math.tan(Math.PI / 3);
        const gap = chevronWidth * 0.48;
        const strokeWidth = Math.max(2, radius * 0.14);
        const forwardOffset = radius + chevronWidth * 0.5 + Math.max(3, radius * 0.18);

        ctx.save();
        ctx.translate(x + Math.cos(angle) * forwardOffset, y + Math.sin(angle) * forwardOffset);
        ctx.rotate(angle);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(0,0,0,0.56)";
        ctx.lineWidth = strokeWidth + Math.max(1, radius * 0.05);
        drawTargetTravelChevronPair(chevronWidth, chevronHeight, gap);
        ctx.strokeStyle = "rgba(255,255,255,0.96)";
        ctx.lineWidth = strokeWidth;
        drawTargetTravelChevronPair(chevronWidth, chevronHeight, gap);
        ctx.restore();
    }

    function drawTargetTravelChevronPair(chevronWidth, chevronHeight, gap) {
        const pointX = chevronWidth * 0.5;
        const leftX = -chevronWidth * 0.5;
        const halfHeight = chevronHeight * 0.5;
        ctx.beginPath();
        for (let i = 0; i < 2; i++) {
            const offsetX = i * gap;
            ctx.moveTo(leftX + offsetX, -halfHeight);
            ctx.lineTo(pointX + offsetX, 0);
            ctx.lineTo(leftX + offsetX, halfHeight);
        }
        ctx.stroke();
    }

    function drawTargetHat(x, y, radius) {
        const hatRadius = radius * 3 * 0.7;
        const brimY = y - hatRadius * 0.55;
        const brimWidth = hatRadius * 1.15;
        const brimHeight = hatRadius * 0.36;
        const bandWidth = brimWidth * 0.82;
        const bandHeight = brimHeight * 0.54;
        const pointBaseY = brimY - brimHeight * 0.1;
        const pointHeight = hatRadius * 0.95;
        const pointWidth = hatRadius * 0.62;

        ctx.save();
        ctx.fillStyle = "#000099";
        ctx.beginPath();
        ctx.ellipse(x, brimY, brimWidth * 0.5, brimHeight * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffd700";
        ctx.beginPath();
        ctx.ellipse(x, brimY, bandWidth * 0.5, bandHeight * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#000099";
        ctx.beginPath();
        ctx.ellipse(x, brimY, pointWidth * 0.5, bandHeight * 0.35, 0, 0, Math.PI * 2);
        ctx.rect(x - pointWidth * 0.5, brimY - bandHeight * 0.55, pointWidth, bandHeight * 0.7);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(x, pointBaseY - pointHeight);
        ctx.lineTo(x - pointWidth * 0.5, pointBaseY);
        ctx.lineTo(x + pointWidth * 0.5, pointBaseY);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function drawProjectedTargetCursor(targetX, targetY, heading) {
        if (!Number.isFinite(heading)) throw new Error("Wizard of Flatland projected cursor requires a finite heading");
        const trace = getCurrentProjectedCursorTrace();
        const projectedWorld = trace.point;
        const cursorHeading = getCurrentProjectedCursorHeading();
        drawProjectedCursorGuide(trace.points);
        const projected = worldToScreen(projectedWorld.x, projectedWorld.y);
        const cursorSize = 30;
        const tenpoints = Array.from(
            { length: 10 },
            (_, i) => rotatePoint(Math.cos(i * 36 * Math.PI / 180) * cursorSize, Math.sin(i * 36 * Math.PI / 180) * cursorSize, cursorHeading)
        );
        const fivepoints = Array.from(
            { length: 5 },
            (_, i) => rotatePoint(Math.cos((i * 72 + 18) * Math.PI / 180) * cursorSize * 0.5, Math.sin((i * 72 + 18) * Math.PI / 180) * cursorSize * 0.5, cursorHeading)
        );

        ctx.strokeStyle = "#44aaff";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            ctx.moveTo(projected.x + tenpoints[i * 2].x, projected.y + tenpoints[i * 2].y);
            ctx.lineTo(projected.x + fivepoints[i].x, projected.y + fivepoints[i].y);
            ctx.lineTo(projected.x + tenpoints[i * 2 + 1].x, projected.y + tenpoints[i * 2 + 1].y);
        }
        ctx.stroke();
        ctx.fillStyle = "#44aaff";
        ctx.fillRect(projected.x - 0.5, projected.y - 0.5, 1, 1);
    }

    function getCurrentProjectedCursorHeading() {
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        if (!Number.isFinite(state.target.heading) || !Number.isFinite(cursor.angleOffset)) {
            throw new Error("Wizard of Flatland projected cursor heading requires finite angles");
        }
        return normalizeAngle(state.target.heading + getProjectedCursorCurveHeadingDelta(cursor.distance, cursor.angleOffset));
    }

    function getCurrentProjectedCursorWorldPoint() {
        return getCurrentProjectedCursorTrace().point;
    }

    function getCurrentProjectedCursorTrace() {
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        return getWallClampedProjectedCursorCurveTrace(
            state.target.x,
            state.target.y,
            state.target.heading,
            cursor.angleOffset,
            cursor.distance
        );
    }

    function updateProjectedCursorFromFixedWorldPoint(point) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            throw new Error("Wizard of Flatland fixed cursor point requires finite coordinates");
        }
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        const dx = point.x - state.target.x;
        const dy = point.y - state.target.y;
        const chord = Math.hypot(dx, dy);
        if (!(chord > 0.000001)) {
            cursor.angleOffset = 0;
            cursor.distance = TARGET_PROJECTED_CURSOR_MIN_DISTANCE;
            return;
        }

        const forwardX = Math.cos(state.target.heading);
        const forwardY = Math.sin(state.target.heading);
        const localForward = dx * forwardX + dy * forwardY;
        const localSide = dx * -forwardY + dy * forwardX;
        const rawHeadingDelta = 2 * Math.atan2(localSide, localForward);
        const bendRatio = Math.max(-1, Math.min(1, rawHeadingDelta));
        cursor.angleOffset = bendRatio * TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET;
        if (Math.abs(bendRatio) <= 0.000001) {
            cursor.distance = Math.max(
                TARGET_PROJECTED_CURSOR_MIN_DISTANCE,
                Math.min(TARGET_PROJECTED_CURSOR_MAX_DISTANCE, chord)
            );
            return;
        }

        const halfDelta = Math.abs(bendRatio) * 0.5;
        const denominator = 2 * Math.sin(halfDelta);
        if (!(denominator > 0.000001)) {
            throw new Error("Wizard of Flatland fixed cursor projection produced an invalid arc");
        }
        const arcDistance = (chord / denominator) * Math.abs(bendRatio);
        cursor.distance = Math.max(
            TARGET_PROJECTED_CURSOR_MIN_DISTANCE,
            Math.min(TARGET_PROJECTED_CURSOR_MAX_DISTANCE, arcDistance)
        );
    }

    function getProjectedCursorTraceDistance(trace) {
        if (!trace || !Array.isArray(trace.points) || trace.points.length < 2) {
            throw new Error("Wizard of Flatland projected cursor trace requires at least two points");
        }
        let distance = 0;
        for (let i = 1; i < trace.points.length; i++) {
            const previous = trace.points[i - 1];
            const current = trace.points[i];
            if (
                !previous ||
                !current ||
                !Number.isFinite(previous.x) ||
                !Number.isFinite(previous.y) ||
                !Number.isFinite(current.x) ||
                !Number.isFinite(current.y)
            ) {
                throw new Error("Wizard of Flatland projected cursor trace contains invalid points");
            }
            distance += Math.hypot(current.x - previous.x, current.y - previous.y);
        }
        return distance;
    }

    function drawProjectedCursorGuide(points) {
        if (!Array.isArray(points) || points.length < 2) throw new Error("Wizard of Flatland projected cursor guide requires curve points");
        ctx.save();
        ctx.strokeStyle = "rgba(68,170,255,0.72)";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.setLineDash([6, 24]);
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const point = worldToScreen(points[i].x, points[i].y);
            if (i === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
        ctx.restore();
    }

    function getWallClampedProjectedCursorCurveTrace(targetX, targetY, heading, angleOffset, distance) {
        const points = getProjectedCursorCurvePoints(targetX, targetY, heading, angleOffset, distance);
        const trace = [points[0]];
        for (let i = 1; i < points.length; i++) {
            const previous = points[i - 1];
            const current = points[i];
            for (let w = 0; w < state.walls.length; w += WALL_STRIDE) {
                const hit = segmentIntersectionParameters(
                    previous.x,
                    previous.y,
                    current.x,
                    current.y,
                    state.walls[w + WALL_X1],
                    state.walls[w + WALL_Y1],
                    state.walls[w + WALL_X2],
                    state.walls[w + WALL_Y2]
                );
                if (!hit || hit.t <= 0.000001) continue;
                const point = {
                    x: previous.x + (current.x - previous.x) * hit.t,
                    y: previous.y + (current.y - previous.y) * hit.t
                };
                trace.push(point);
                return { point, points: trace };
            }
            trace.push(current);
        }
        return { point: points[points.length - 1], points: trace };
    }

    function getProjectedCursorCurvePoints(targetX, targetY, heading, angleOffset, distance) {
        if (!Number.isFinite(targetX) || !Number.isFinite(targetY) || !Number.isFinite(heading) || !Number.isFinite(angleOffset) || !Number.isFinite(distance)) {
            throw new Error("Wizard of Flatland projected cursor curve requires finite inputs");
        }
        const bendRatio = getProjectedCursorBendRatio(angleOffset);
        const headingDelta = getProjectedCursorCurveHeadingDelta(distance, angleOffset);
        const sampleCount = 32;
        const forwardX = Math.cos(heading);
        const forwardY = Math.sin(heading);
        const sideX = -forwardY;
        const sideY = forwardX;
        const points = [];
        for (let i = 0; i <= sampleCount; i++) {
            const t = i / sampleCount;
            let localForward;
            let localSide;
            if (Math.abs(bendRatio) <= 0.000001 || Math.abs(headingDelta) <= 0.000001) {
                localForward = distance * t;
                localSide = 0;
            } else {
                const theta = headingDelta * t;
                const radius = distance / headingDelta;
                localForward = radius * Math.sin(theta);
                localSide = radius * (1 - Math.cos(theta));
            }
            points.push({
                x: targetX + forwardX * localForward + sideX * localSide,
                y: targetY + forwardY * localForward + sideY * localSide
            });
        }
        return points;
    }

    function getProjectedCursorBendRatio(angleOffset) {
        if (!Number.isFinite(angleOffset)) throw new Error("Wizard of Flatland projected cursor bend requires a finite angle");
        return Math.max(-1, Math.min(1, angleOffset / TARGET_PROJECTED_CURSOR_MAX_ANGLE_OFFSET));
    }

    function getProjectedCursorTurnRadius(distance, bendRatio) {
        if (!Number.isFinite(distance) || !Number.isFinite(bendRatio)) {
            throw new Error("Wizard of Flatland projected cursor turn radius requires finite values");
        }
        const normalizedBend = Math.min(1, Math.max(0, Math.abs(bendRatio)));
        if (normalizedBend <= 0.000001) return Infinity;
        return Math.max(TARGET_PROJECTED_CURSOR_MIN_TURN_RADIUS, Math.max(0, distance) / normalizedBend);
    }

    function getProjectedCursorCurveHeadingDelta(distance, angleOffset) {
        const bendRatio = getProjectedCursorBendRatio(angleOffset);
        if (Math.abs(bendRatio) <= 0.000001) return 0;
        const turnRadius = getProjectedCursorTurnRadius(distance, bendRatio);
        if (!Number.isFinite(turnRadius)) return 0;
        return Math.sign(bendRatio) * Math.max(0, distance) / turnRadius;
    }

    function rotatePoint(x, y, angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
            x: x * cos - y * sin,
            y: x * sin + y * cos
        };
    }

    function drawCombatRing() {
        const point = worldToScreen(state.target.x, state.target.y);
        ctx.save();
        ctx.strokeStyle = "rgba(104,183,255,0.35)";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.arc(point.x, point.y, COMBAT_RING_RADIUS * state.view.scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    function drawAgentSlot(agent) {
        if (agent.solverState === STATE_MILLING || agent.solverState === STATE_BLOCKED) return;
        if (!Number.isFinite(agent.slotAngle)) return;
        const slot = worldToScreen(
            state.target.x + Math.cos(agent.slotAngle) * COMBAT_RING_RADIUS,
            state.target.y + Math.sin(agent.slotAngle) * COMBAT_RING_RADIUS
        );
        ctx.save();
        ctx.fillStyle = "rgba(104,183,255,0.22)";
        ctx.beginPath();
        ctx.arc(slot.x, slot.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawAgentPaths() {
        ctx.save();
        ctx.strokeStyle = "rgba(180,140,255,0.5)";
        ctx.lineWidth = Math.max(1, state.view.scale * 0.025);
        ctx.setLineDash([5, 5]);
        for (const agent of state.agents) {
            if (agent.pathMode !== PATH_MODE_WORKER) continue;
            if (!Number.isFinite(agent.pathGoalX) || !Number.isFinite(agent.pathGoalY)) continue;
            const a = worldToScreen(agent.x, agent.y);
            const b = worldToScreen(agent.pathGoalX, agent.pathGoalY);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawFireballs() {
        ctx.save();
        for (const fireball of state.fireballs) {
            const polygon = getFireballHitboxPolygon(fireball);
            ctx.fillStyle = "rgba(255,115,36,0.62)";
            ctx.strokeStyle = "#ffd166";
            ctx.lineWidth = Math.max(1.5, state.view.scale * 0.045);
            ctx.beginPath();
            for (let i = 0; i < polygon.length; i++) {
                const point = worldToScreen(polygon[i].x, polygon[i].y);
                if (i === 0) ctx.moveTo(point.x, point.y);
                else ctx.lineTo(point.x, point.y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            const center = worldToScreen(fireball.x, fireball.y);
            ctx.fillStyle = "rgba(255,230,122,0.85)";
            ctx.beginPath();
            ctx.arc(center.x, center.y, Math.max(3, state.view.scale * 0.12), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawFireballExplosions() {
        ctx.save();
        for (const explosion of state.fireballExplosions) {
            if (!Number.isFinite(explosion.x) || !Number.isFinite(explosion.y) || !Number.isFinite(explosion.radius) || !Number.isFinite(explosion.age)) {
                throw new Error("Wizard of Flatland fireball explosion render requires finite explosion data");
            }
            const center = worldToScreen(explosion.x, explosion.y);
            const t = Math.max(0, Math.min(1, explosion.age / FIREBALL_EXPLOSION_VISUAL_SECONDS));
            const radius = explosion.radius * state.view.scale * (0.72 + t * 0.28);
            ctx.fillStyle = `rgba(255,115,36,${0.28 * (1 - t)})`;
            ctx.strokeStyle = `rgba(255,209,102,${0.95 * (1 - t)})`;
            ctx.lineWidth = Math.max(2, state.view.scale * 0.06);
            ctx.beginPath();
            ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawAgents() {
        ctx.save();
        for (const agent of state.agents) {
            drawAgentSlot(agent);
        }
        for (const agent of state.agents) {
            const point = worldToScreen(agent.x, agent.y);
        const radius = agent.radius * state.view.scale;
            drawAgentTriangle(point.x, point.y, radius, getAgentFacingAngle(agent), agent);
        }
        ctx.restore();
    }

    function getAgentFacingAngle(agent) {
        return Number.isFinite(agent.heading)
            ? agent.heading
            : Math.atan2(state.target.y - agent.y, state.target.x - agent.x);
    }

    function getAgentStateColor(agent) {
        if (agent.wallClamps > 0 || agent.solverState === STATE_BLOCKED) return "#ff6b6b";
        if (agent.solverState === STATE_MILLING) return "#6fa8d8";
        if (agent.solverState === STATE_ATTACKING) return "#58d27b";
        if (agent.solverState === STATE_SEEKING) return "#b48cff";
        if (agent.solverState === STATE_RECOVERING) return "#ff9f5a";
        if (agent.solverState === STATE_VACATING) return "#ff6fb1";
        if (agent.solverState === STATE_HOLDING) return "#ffd166";
        if (agent.pathMode === PATH_MODE_WORKER) return "#b48cff";
        return "#6fa8d8";
    }

    function drawAgentTriangle(x, y, radius, angle, agent) {
        const wallClamped = agent.wallClamps > 0 || agent.solverState === STATE_BLOCKED;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const baseAngleOffset = Math.PI / 6;
        const tipX = x + cos * radius;
        const tipY = y + sin * radius;
        const leftX = x + Math.cos(angle + Math.PI - baseAngleOffset) * radius;
        const leftY = y + Math.sin(angle + Math.PI - baseAngleOffset) * radius;
        const rightX = x + Math.cos(angle + Math.PI + baseAngleOffset) * radius;
        const rightY = y + Math.sin(angle + Math.PI + baseAngleOffset) * radius;

        ctx.fillStyle = getAgentStateColor(agent);
        ctx.strokeStyle = wallClamped ? "#ff6b6b" : "rgba(236,244,248,0.72)";
        ctx.lineWidth = wallClamped ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(leftX, leftY);
        ctx.lineTo(rightX, rightY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (wallClamped) {
            ctx.fillStyle = "rgba(255,107,107,0.35)";
            ctx.beginPath();
            ctx.arc(x, y, Math.max(2, radius * 0.35), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function screenToWorld(screenX, screenY) {
        return {
            x: state.view.centerX + (screenX - state.view.offsetX) / state.view.scale,
            y: state.view.centerY + (screenY - state.view.offsetY) / state.view.scale
        };
    }

    function canvasEventToWorld(event) {
        resizeCanvas();
        const rect = canvas.getBoundingClientRect();
        const screenX = (event.clientX - rect.left) * state.view.dpr;
        const screenY = (event.clientY - rect.top) * state.view.dpr;
        return screenToWorld(screenX, screenY);
    }

    function inspectAgentAtPointer(event) {
        const world = canvasEventToWorld(event);
        const agent = findAgentAtWorldPoint(world.x, world.y);
        if (!agent) return false;
        logAgentPathfindingState(agent);
        event.preventDefault();
        return true;
    }

    function findAgentAtWorldPoint(worldX, worldY) {
        let best = null;
        for (const agent of state.agents) {
            const distance = Math.hypot(agent.x - worldX, agent.y - worldY);
            const pickRadius = Math.max(agent.radius * 1.35, 0.55);
            if (distance > pickRadius) continue;
            if (!best || distance < best.distance) best = { agent, distance };
        }
        return best ? best.agent : null;
    }

    function logAgentPathfindingState(agent) {
        const currentNode = nearestPathfindingNode(agent.x, agent.y);
        const targetNearestNode = nearestPathfindingNode(state.target.x, state.target.y);
        const targetPassableNode = nearestPassablePathfindingNode(state.target.x, state.target.y);
        const waypoint = getAgentPathWaypoint(agent);
        const pathNodes = agent.pathNodeKeys.map((pathKey, index) => {
            const currentPathIndex = typeof pathKey === "string" ? getPathfindingNodeIndexForKey(pathKey) : null;
            const exists = Number.isInteger(currentPathIndex);
            const stored = getStoredAgentPathWaypoint(agent, index, pathKey);
            const x = exists ? getPathfindingNodeX(currentPathIndex) : (stored ? stored.x : null);
            const y = exists ? getPathfindingNodeY(currentPathIndex) : (stored ? stored.y : null);
            return {
                index,
                pathIndex: exists ? currentPathIndex : null,
                key: pathKey,
                current: index === agent.pathCursor,
                exists,
                x,
                y,
                blocked: exists ? isPathfindingNodeBlocked(currentPathIndex) : null,
                passable: exists ? isPathfindingNodePassable(currentPathIndex) : null,
                stale: !exists,
                distanceFromAgent: Number.isFinite(x) && Number.isFinite(y) ? Math.hypot(x - agent.x, y - agent.y) : null
            };
        });
        const wallClearances = [];
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            wallClearances.push({
                index: i / WALL_STRIDE,
                kind: "segment",
                clearance: pointSegmentDistance(
                    agent.x,
                    agent.y,
                    state.walls[i + WALL_X1],
                    state.walls[i + WALL_Y1],
                    state.walls[i + WALL_X2],
                    state.walls[i + WALL_Y2]
                ) - WALL_WORLD_HALF_THICKNESS
            });
        }
        wallClearances.sort((a, b) => a.clearance - b.clearance);
        wallClearances.length = Math.min(wallClearances.length, 5);
        const dump = {
            id: agent.id,
            position: { x: agent.x, y: agent.y },
            velocity: { x: agent.vx, y: agent.vy, speed: Math.hypot(agent.vx, agent.vy) },
            radius: agent.radius,
            solverState: agent.solverState,
            pathMode: agent.pathMode === PATH_MODE_WORKER ? "worker" : "direct",
            pathRequestPending: agent.pathRequestPending,
            pathRequestId: agent.pathRequestId,
            pathRequestedAt: agent.pathRequestedAt,
            pathRequestedWorldVersion: agent.pathRequestedWorldVersion,
            pathRequestedRawStartKey: agent.pathRequestedRawStartKey,
            pathRequestedStartKey: agent.pathRequestedStartKey,
            pathRequestedGoalKey: agent.pathRequestedGoalKey,
            pathCursor: agent.pathCursor,
            pathLength: agent.pathNodeKeys.length,
            pathGoal: { x: agent.pathGoalX, y: agent.pathGoalY },
            waypoint: waypoint ? { index: waypoint.pathIndex, key: waypoint.key, x: waypoint.x, y: waypoint.y, blocked: waypoint.blocked === true } : null,
            currentNode: {
                index: currentNode,
                key: getPathfindingNodeKey(currentNode),
                x: getPathfindingNodeX(currentNode),
                y: getPathfindingNodeY(currentNode),
                blocked: isPathfindingNodeBlocked(currentNode),
                passable: isPathfindingNodePassable(currentNode)
            },
            targetNearestNode: {
                index: targetNearestNode,
                key: getPathfindingNodeKey(targetNearestNode),
                x: getPathfindingNodeX(targetNearestNode),
                y: getPathfindingNodeY(targetNearestNode),
                blocked: isPathfindingNodeBlocked(targetNearestNode),
                passable: isPathfindingNodePassable(targetNearestNode)
            },
            targetPassableNode: {
                index: targetPassableNode,
                key: getPathfindingNodeKey(targetPassableNode),
                x: getPathfindingNodeX(targetPassableNode),
                y: getPathfindingNodeY(targetPassableNode),
                blocked: isPathfindingNodeBlocked(targetPassableNode),
                passable: isPathfindingNodePassable(targetPassableNode)
            },
            lineOfSightToTarget: hasDirectLineOfSight(agent.x, agent.y, state.target.x, state.target.y, agent.radius),
            wallClamps: agent.wallClamps,
            nearestWallClearances: wallClearances,
            pathNodes
        };
        console.groupCollapsed(`Wizard of Flatland agent ${agent.id} pathfinding`);
        console.log(dump);
        console.table(pathNodes);
        console.groupEnd();
    }

    function nearestHexNode(worldX, worldY) {
        const approxCol = Math.round(worldX / HEX_GRID_COL_STEP);
        const approxRow = Math.round(worldY);
        let best = null;
        for (let col = approxCol - 2; col <= approxCol + 2; col++) {
            for (let row = approxRow - 2; row <= approxRow + 2; row++) {
                const node = {
                    x: col * HEX_GRID_COL_STEP,
                    y: row + (isEvenGridColumn(col) ? 0.5 : 0),
                    xindex: col,
                    yindex: row,
                    key: pathfindingNodeKey(col, row)
                };
                const distSq = (node.x - worldX) * (node.x - worldX) + (node.y - worldY) * (node.y - worldY);
                if (!best || distSq < best.distSq) best = { ...node, distSq };
            }
        }
        if (!best) throw new Error("Wizard of Flatland wall tool could not resolve nearest hex node");
        return best;
    }

    function beginWallBuildDrag(event) {
        if (!state.wallTool.active) return false;
        const world = canvasEventToWorld(event);
        const node = nearestHexNode(world.x, world.y);
        state.wallTool.dragging = true;
        state.wallTool.pointerId = event.pointerId;
        state.wallTool.startNode = node;
        state.wallTool.hoverNode = node;
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
        return true;
    }

    function updateWallBuildDrag(event) {
        if (!state.wallTool.dragging || state.wallTool.pointerId !== event.pointerId) return false;
        const world = canvasEventToWorld(event);
        state.wallTool.hoverNode = nearestHexNode(world.x, world.y);
        event.preventDefault();
        return true;
    }

    function finishWallBuildDrag(event) {
        if (!state.wallTool.dragging || state.wallTool.pointerId !== event.pointerId) return false;
        updateWallBuildDrag(event);
        const start = state.wallTool.startNode;
        const end = state.wallTool.hoverNode;
        if (start && end && start.key !== end.key) {
            addSegmentWall(start.x, start.y, end.x, end.y);
        }
        cancelWallBuildDrag();
        event.preventDefault();
        return true;
    }

    function cancelWallBuildDrag() {
        if (state.wallTool.pointerId !== null) {
            try {
                if (canvas.hasPointerCapture(state.wallTool.pointerId)) {
                    canvas.releasePointerCapture(state.wallTool.pointerId);
                }
            } catch (_error) {
                // Pointer capture may already be gone after browser-level cancellation.
            }
        }
        state.wallTool.dragging = false;
        state.wallTool.pointerId = null;
        state.wallTool.startNode = null;
        state.wallTool.hoverNode = null;
    }

    function constrainMovementToSegmentWalls(previousX, previousY, x, y, radius) {
        let currentX = previousX;
        let currentY = previousY;
        let remainingX = x - previousX;
        let remainingY = y - previousY;

        for (let iteration = 0; iteration < 4; iteration++) {
            if (Math.hypot(remainingX, remainingY) <= 0.000001) break;
            const intendedX = currentX + remainingX;
            const intendedY = currentY + remainingY;
            const hit = findEarliestSegmentWallHit(currentX, currentY, intendedX, intendedY, radius);
            if (!hit) {
                currentX = intendedX;
                currentY = intendedY;
                break;
            }

            const safeT = Math.max(0, hit.t - 0.0005);
            currentX += remainingX * safeT;
            currentY += remainingY * safeT;

            const leftoverScale = Math.max(0, 1 - safeT);
            let slideX = remainingX * leftoverScale;
            let slideY = remainingY * leftoverScale;
            const intoNormal = slideX * hit.nx + slideY * hit.ny;
            if (intoNormal < 0) {
                slideX -= hit.nx * intoNormal;
                slideY -= hit.ny * intoNormal;
            }
            remainingX = slideX;
            remainingY = slideY;
        }

        return { x: currentX, y: currentY };
    }

    function findEarliestSegmentWallHit(fromX, fromY, toX, toY, radius) {
        let best = null;
        for (let i = 0; i < state.walls.length; i += WALL_STRIDE) {
            const hit = sweptCircleSegmentHit(
                fromX,
                fromY,
                toX,
                toY,
                state.walls[i + WALL_X1],
                state.walls[i + WALL_Y1],
                state.walls[i + WALL_X2],
                state.walls[i + WALL_Y2],
                radius + WALL_WORLD_HALF_THICKNESS
            );
            if (hit && (!best || hit.t < best.t)) best = hit;
        }
        return best;
    }

    function sweptCircleSegmentHit(fromX, fromY, toX, toY, ax, ay, bx, by, radius) {
        const startDistance = pointSegmentDistance(fromX, fromY, ax, ay, bx, by);
        if (startDistance < radius - 0.0005) {
            const normal = segmentRepulsionNormal(fromX, fromY, ax, ay, bx, by);
            return { t: 0, nx: normal.x, ny: normal.y };
        }

        const closest = closestMovementWallDistance(fromX, fromY, toX, toY, ax, ay, bx, by);
        if (!closest || closest.distance > radius) return null;

        let lo = 0;
        let hi = Math.max(0, Math.min(1, closest.t));
        if (hi <= 0.000001) hi = 1;
        for (let i = 0; i < 24; i++) {
            const mid = (lo + hi) / 2;
            const px = fromX + (toX - fromX) * mid;
            const py = fromY + (toY - fromY) * mid;
            if (pointSegmentDistance(px, py, ax, ay, bx, by) <= radius) {
                hi = mid;
            } else {
                lo = mid;
            }
        }
        const hitX = fromX + (toX - fromX) * hi;
        const hitY = fromY + (toY - fromY) * hi;
        const normal = segmentRepulsionNormal(hitX, hitY, ax, ay, bx, by);
        return { t: hi, nx: normal.x, ny: normal.y };
    }

    function closestMovementWallDistance(fromX, fromY, toX, toY, ax, ay, bx, by) {
        const candidates = [];
        const intersection = segmentIntersectionParameters(fromX, fromY, toX, toY, ax, ay, bx, by);
        if (intersection) candidates.push({ t: intersection.t, distance: 0 });
        candidates.push({ t: 0, distance: pointSegmentDistance(fromX, fromY, ax, ay, bx, by) });
        candidates.push({ t: 1, distance: pointSegmentDistance(toX, toY, ax, ay, bx, by) });

        const aProjection = pointProjectionParameter(ax, ay, fromX, fromY, toX, toY);
        if (aProjection >= 0 && aProjection <= 1) {
            const px = fromX + (toX - fromX) * aProjection;
            const py = fromY + (toY - fromY) * aProjection;
            candidates.push({ t: aProjection, distance: Math.hypot(px - ax, py - ay) });
        }

        const bProjection = pointProjectionParameter(bx, by, fromX, fromY, toX, toY);
        if (bProjection >= 0 && bProjection <= 1) {
            const px = fromX + (toX - fromX) * bProjection;
            const py = fromY + (toY - fromY) * bProjection;
            candidates.push({ t: bProjection, distance: Math.hypot(px - bx, py - by) });
        }

        let best = null;
        for (const candidate of candidates) {
            if (!best || candidate.distance < best.distance) best = candidate;
        }
        return best;
    }

    function segmentIntersectionParameters(ax, ay, bx, by, cx, cy, dx, dy) {
        const rx = bx - ax;
        const ry = by - ay;
        const sx = dx - cx;
        const sy = dy - cy;
        const denominator = rx * sy - ry * sx;
        if (Math.abs(denominator) <= 0.000001) return null;
        const qpx = cx - ax;
        const qpy = cy - ay;
        const t = (qpx * sy - qpy * sx) / denominator;
        const u = (qpx * ry - qpy * rx) / denominator;
        if (t < 0 || t > 1 || u < 0 || u > 1) return null;
        return { t, u };
    }

    function pointProjectionParameter(px, py, ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq <= 0.000001) return 0;
        return ((px - ax) * dx + (py - ay) * dy) / lengthSq;
    }

    function pointSegmentDistance(px, py, ax, ay, bx, by) {
        const t = Math.max(0, Math.min(1, pointProjectionParameter(px, py, ax, ay, bx, by)));
        const closestX = ax + (bx - ax) * t;
        const closestY = ay + (by - ay) * t;
        return Math.hypot(px - closestX, py - closestY);
    }

    function segmentRepulsionNormal(px, py, ax, ay, bx, by) {
        const t = Math.max(0, Math.min(1, pointProjectionParameter(px, py, ax, ay, bx, by)));
        const closestX = ax + (bx - ax) * t;
        const closestY = ay + (by - ay) * t;
        let nx = px - closestX;
        let ny = py - closestY;
        const length = Math.hypot(nx, ny);
        if (length > 0.000001) return { x: nx / length, y: ny / length };
        const wallDx = bx - ax;
        const wallDy = by - ay;
        const wallLength = Math.hypot(wallDx, wallDy);
        if (wallLength <= 0.000001) return { x: 1, y: 0 };
        return { x: -wallDy / wallLength, y: wallDx / wallLength };
    }

    function tick(now) {
        const frameStarted = performance.now();
        const frameParts = [];
        function framePart(label, fn) {
            const started = performance.now();
            try {
                return fn();
            } finally {
                frameParts.push({
                    label,
                    duration: performance.now() - started
                });
            }
        }
        const dt = Math.min(0.05, Math.max(0.001, (now - state.lastTime) / 1000));
        state.lastTime = now;
        state.targetFlashTime = Math.max(0, state.targetFlashTime - dt);
        framePart("projected cursor input", () => updateProjectedCursorKeyboardControls(dt));
        framePart("moving cursor straightening", () => updateMovingTargetCursorStraightening(dt));
        framePart("idle target facing", () => updateIdleTargetFacingAndCursor(dt));
        framePart("target heading", () => updateTargetHeadingFromProjectedCursor(dt));
        framePart("target movement", () => updateTargetKeyboardMovement(dt));
        framePart("refresh maze sections", () => refreshGeneratedMazeIfNeeded(false));
        framePart("refresh path bounds", () => refreshMazePathBoundsIfNeeded());
        framePart("fireballs", () => updateFireballs(dt));
        if (state.running) framePart("request solver step", () => requestStep(dt));
        framePart("draw", () => draw());
        const drawPart = frameParts.find((part) => part.label === "draw");
        updateDebugFpsCounter(now, dt, drawPart ? drawPart.duration : 0);
        const frameDuration = performance.now() - frameStarted;
        frameParts.sort((a, b) => b.duration - a.duration);
        profiler.noteFrame(frameDuration, frameParts);
        profiler.noteFirstFrameAfterLoad(frameDuration, frameParts);
        requestAnimationFrame(tick);
    }

    if (playButton) {
        playButton.addEventListener("click", () => {
            state.running = !state.running;
            playButton.textContent = state.running ? "Pause" : "Play";
        });
    }
    if (stepButton) stepButton.addEventListener("click", () => requestStep(1 / 60));
    if (resetButton) resetButton.addEventListener("click", createScenario);
    if (scenarioSelect) scenarioSelect.addEventListener("change", createScenario);
    for (const input of [agentCountInput, separationInput, speedScaleInput]) {
        if (!input) continue;
        input.addEventListener("input", () => {
            updateControlLabels();
            if (input === agentCountInput) respawnAgentsForCurrentScenario();
        });
    }
    for (const input of [mazeSeedInput, mazeChunkSizeInput, mazeRoomScaleInput, mazeTwistinessInput]) {
        if (!input) continue;
        input.addEventListener("input", () => {
            updateControlLabels();
            if (!isProceduralMazeScenario()) return;
            state.generatedMazeSignature = "";
            resetGeneratedMazeEnemyPopulation();
            invalidateMazeLookaheadCache();
            refreshGeneratedMazeIfNeeded(true);
        });
    }
    canvas.addEventListener("pointerdown", (event) => {
        if (beginWallBuildDrag(event)) return;
        inspectAgentAtPointer(event);
    });
    canvas.addEventListener("pointermove", (event) => {
        updateWallBuildDrag(event);
    });
    canvas.addEventListener("pointerup", (event) => {
        finishWallBuildDrag(event);
    });
    canvas.addEventListener("pointercancel", (event) => {
        if (state.wallTool.pointerId === event.pointerId) cancelWallBuildDrag();
    });
    canvas.addEventListener("wheel", (event) => {
        handleZoomWheel(event);
    }, { passive: false });

    function isEditableEventTarget(target) {
        if (!target || typeof target !== "object") return false;
        const tagName = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
        return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable === true;
    }

    function getTargetKeyboardControlKey(event) {
        if (!event) return null;
        if (TARGET_CURSOR_KEYS.has(event.key)) return event.key;
        if (TARGET_SIDEWAYS_KEYS[event.code] || TARGET_FORWARD_KEYS[event.code]) return event.code;
        const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
        if (key === "a") return "KeyA";
        if (key === "d") return "KeyD";
        if (key === "w") return "KeyW";
        if (key === "s") return "KeyS";
        return null;
    }
    window.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key && event.key.toLowerCase() === "f") {
            event.preventDefault();
            if (!event.repeat) toggleDebugFpsCounter();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key && event.key.toLowerCase() === "s") {
            event.preventDefault();
            saveWizardPositionToConsoleSlot();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key && event.key.toLowerCase() === "l") {
            event.preventDefault();
            loadWizardPositionFromConsoleSlot();
            return;
        }
        if (event.code === "Space" || event.key === " ") {
            event.preventDefault();
            if (!state.spaceHeld) shootFireball();
            state.spaceHeld = true;
            return;
        }
        if (event.key === "b" || event.key === "B") {
            state.wallTool.active = true;
            return;
        }
        if ((event.key === "z" || event.key === "Z") && !isEditableEventTarget(event.target)) {
            state.zoomHeld = true;
            return;
        }
        if (event.key === "Shift") {
            state.fastMovementHeld = true;
            return;
        }
        const movementKey = getTargetKeyboardControlKey(event);
        if (!movementKey) return;
        event.preventDefault();
        state.fastMovementHeld = event.shiftKey;
        state.pressedMovementKeys[movementKey] = true;
    });
    window.addEventListener("keyup", (event) => {
        if (event.code === "Space" || event.key === " ") {
            event.preventDefault();
            state.spaceHeld = false;
            return;
        }
        if (event.key === "b" || event.key === "B") {
            state.wallTool.active = false;
            cancelWallBuildDrag();
            return;
        }
        if (event.key === "z" || event.key === "Z") {
            state.zoomHeld = false;
            return;
        }
        if (event.key === "Shift") {
            state.fastMovementHeld = false;
            return;
        }
        const movementKey = getTargetKeyboardControlKey(event);
        if (!movementKey) return;
        event.preventDefault();
        delete state.pressedMovementKeys[movementKey];
    });
    window.addEventListener("blur", () => {
        state.pressedMovementKeys = Object.create(null);
        state.spaceHeld = false;
        state.zoomHeld = false;
        state.fastMovementHeld = false;
        state.wallTool.active = false;
        cancelWallBuildDrag();
    });
    window.addEventListener("resize", resizeCanvas);

    setSpeedScaleValue(SPEED_SCALE_DEFAULT);
    updateControlLabels();
    createScenario();
    updateStats();
    requestAnimationFrame(tick);
})();
