(function () {
    "use strict";

    const STRIDE = 17;
    const OUT_STRIDE = 14;
    const WALL_STRIDE = 7;
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
    const PATH_NODE_WALL_THICKNESS = 0.1;
    const PATH_NODE_WALL_FACE_EXTEND = 0.501;
    const MAZE_CHUNK_MIN_SIZE = 28;
    const MAZE_CHUNK_MAX_SIZE = 72;
    const MAZE_SECTION_CACHE_LIMIT = 10;
    const MAZE_SECTION_NEARBY_LOAD_COUNT = 2;
    const MAZE_WORKER_STATUS_PREFIX = "maze";
    const MAZE_LOOKAHEAD_DISTANCE = 20;
    const MAZE_LOOKAHEAD_REFRESH_INTERVAL_MS = 1000;
    const MAZE_ROOM_EDGE_INSET_TILES = 2;
    const MAZE_HALLWAY_GAP_WIDTH = 3.4;
    const MAZE_OUTSIDE_DOOR_MIN_WIDTH = 1;
    const MAZE_OUTSIDE_DOOR_MAX_WIDTH = 3;
    const MAZE_SECTION_DIRECTIONS = [
        { q: 1, r: 0 },
        { q: 0, r: 1 },
        { q: -1, r: 1 },
        { q: -1, r: 0 },
        { q: 0, r: -1 },
        { q: 1, r: -1 }
    ];
    const WALL_KIND_BOUNDARY = 0;
    const WALL_KIND_SEGMENT = 1;
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
        wallLeaks: document.getElementById("wallLeaks")
    };

    const state = {
        running: true,
        requestId: 1,
        waitingForWorker: false,
        pathfindingRequestId: 1,
        pathfindingSnapshotVersion: 0,
        worldVersion: 1,
        lastTime: performance.now(),
        agents: [],
        fireballs: [],
        fireballExplosions: [],
        walls: [],
        manualWalls: [],
        generatedMazeWalls: [],
        generatedMazeChunkKeys: new Set(),
        generatedMazeSignature: "",
        generatedMazeRequestId: 1,
        generatedMazeActiveRequestId: 0,
        generatedMazePendingSignature: "",
        generatedMazeLoading: false,
        generatedMazeLookaheadKeys: [],
        generatedMazeLookaheadNextRefreshAt: 0,
        target: { x: 0, y: 0, heading: -Math.PI / 2 },
        lastSentTarget: { x: 0, y: 0 },
        targetFlashTime: 0,
        targetPushes: 0,
        projectedCursor: {
            angleOffset: 0,
            distance: TARGET_PROJECTED_CURSOR_DISTANCE
        },
        pressedMovementKeys: Object.create(null),
        spaceHeld: false,
        fastMovementHeld: false,
        stats: null,
        debug: {
            showPathBlockedEdges: false,
            headingGlitchFrame: 0,
            headingGlitchLogged: false
        },
        wallTool: {
            active: false,
            dragging: false,
            pointerId: null,
            startNode: null,
            hoverNode: null
        },
        view: { width: 0, height: 0, dpr: 1, scale: 1, offsetX: 0, offsetY: 0, centerX: 0, centerY: 0 },
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
            nodes: [],
            nodeByKey: new Map(),
            blockedEdges: [],
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
    window.__wizardOfFlatlandDebug = state;
    window.debug = state.debug;

    const worker = new Worker("./npcMovementSolverWorker.js");
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", (event) => {
        labels.workerStatus.textContent = event.message || "failed";
    });

    const pathfindingWorker = new Worker("./pathfindingWorker.js");
    pathfindingWorker.addEventListener("message", handlePathfindingWorkerMessage);
    pathfindingWorker.addEventListener("error", (event) => {
        labels.workerStatus.textContent = event.message || "pathfinding failed";
    });

    const mazeWorker = new Worker("./mazeSectionWorker.reference.js");
    mazeWorker.addEventListener("message", handleMazeWorkerMessage);
    mazeWorker.addEventListener("error", (event) => {
        state.generatedMazeLoading = false;
        labels.workerStatus.textContent = event.message || "maze worker failed";
    });

    function updateControlLabels() {
        labels.agentCount.textContent = agentCountInput.value;
        labels.separationStrength.textContent = Number(separationInput.value).toFixed(1);
        labels.speedScale.textContent = getSpeedScale().toFixed(2);
        labels.mazeChunkSize.textContent = String(getMazeChunkSize());
        labels.mazeRoomScale.textContent = Number(mazeRoomScaleInput.value).toFixed(2);
        labels.mazeTwistiness.textContent = Number(mazeTwistinessInput.value).toFixed(2);
    }

    function getSpeedScale() {
        const t = Math.max(0, Math.min(1, Number(speedScaleInput.value)));
        return SPEED_SCALE_MIN * Math.pow(SPEED_SCALE_MAX / SPEED_SCALE_MIN, t);
    }

    function setSpeedScaleValue(value) {
        const scale = Math.max(SPEED_SCALE_MIN, Math.min(SPEED_SCALE_MAX, Number(value)));
        const t = Math.log(scale / SPEED_SCALE_MIN) / Math.log(SPEED_SCALE_MAX / SPEED_SCALE_MIN);
        speedScaleInput.value = String(Math.max(0, Math.min(1, t)));
    }

    function getMazeChunkSize() {
        return Math.max(
            MAZE_CHUNK_MIN_SIZE,
            Math.min(MAZE_CHUNK_MAX_SIZE, Math.round(Number(mazeChunkSizeInput.value) || 44))
        );
    }

    function getMazeSeed() {
        const seed = String(mazeSeedInput.value || "").trim();
        return seed.length > 0 ? seed : "hex-maze-1";
    }

    function getMazeOptions() {
        return {
            seed: getMazeSeed(),
            chunkSize: getMazeChunkSize(),
            roomScale: Math.max(0, Math.min(1, Number(mazeRoomScaleInput.value) || 0)),
            twistiness: Math.max(0, Math.min(1, Number(mazeTwistinessInput.value) || 0))
        };
    }

    function isProceduralMazeScenario() {
        return scenarioSelect.value === "proceduralMaze";
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

    function createSegmentWall(ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (!(len > 0.001)) return null;
        return {
            ax,
            ay,
            bx,
            by,
            nx: -dy / len,
            ny: dx / len,
            kind: WALL_KIND_SEGMENT
        };
    }

    function appendSegmentWall(walls, ax, ay, bx, by) {
        const wall = createSegmentWall(ax, ay, bx, by);
        if (!wall) return false;
        walls.push(wall);
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
        const keys = [currentKey, ...neighbors.slice(0, MAZE_SECTION_NEARBY_LOAD_COUNT).map((entry) => entry.key)];
        const lookaheadKeys = getMazeLookaheadSectionKeys(options);
        for (const key of lookaheadKeys) {
            if (keys.length >= MAZE_SECTION_CACHE_LIMIT) break;
            if (!keys.includes(key)) keys.push(key);
        }
        return keys;
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
        const rect = getProjectedMazeViewportRect(options);
        if (!rect) return [];
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

    function getProjectedMazeViewportRect(_options) {
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
        const manualWalls = state.manualWalls.map(cloneWallRecord);
        const requestId = state.generatedMazeRequestId++;
        state.generatedMazeActiveRequestId = requestId;
        state.generatedMazePendingSignature = signature;
        state.generatedMazeLoading = true;
        state.worldVersion += 1;
        clearAgentPathRequestsForMapRebuild();
        labels.workerStatus.textContent = `${MAZE_WORKER_STATUS_PREFIX} loading`;
        mazeWorker.postMessage({
            type: "build_maze_sections",
            requestId,
            signature,
            options,
            keys,
            manualWalls,
            bounds,
            targetRadius: TARGET_RADIUS
        });
    }

    function handleMazeWorkerMessage(event) {
        const message = event && event.data ? event.data : null;
        if (!message || typeof message.type !== "string") return;
        if (message.type === "ready") return;
        if (message.type === "error") {
            if (Number(message.requestId) !== Number(state.generatedMazeActiveRequestId)) return;
            state.generatedMazeLoading = false;
            labels.workerStatus.textContent = message.message || "maze error";
            return;
        }
        if (message.type !== "maze_sections_result") return;
        if (Number(message.requestId) !== Number(state.generatedMazeActiveRequestId)) return;
        if (message.signature !== state.generatedMazePendingSignature) return;
        installGeneratedMazeWorkerResult(message);
    }

    function installGeneratedMazeWorkerResult(message) {
        if (!message || typeof message.signature !== "string" || !message.nodeLayer) {
            throw new Error("Wizard of Flatland maze worker result is malformed");
        }
        const generatedWalls = unpackMazeWorkerWalls(message.generatedWalls, "generated maze walls");
        const allWalls = unpackMazeWorkerWalls(message.allWalls, "maze pathfinding walls");
        const manualOffset = generatedWalls.length;
        if (allWalls.length !== generatedWalls.length + state.manualWalls.length) {
            throw new Error("Wizard of Flatland maze worker wall count does not match active manual walls");
        }
        for (let i = 0; i < state.manualWalls.length; i++) {
            const expected = state.manualWalls[i];
            const actual = allWalls[manualOffset + i];
            if (!wallsMatch(expected, actual)) {
                throw new Error("Wizard of Flatland maze worker result is stale for manual walls");
            }
        }

        state.generatedMazeWalls = generatedWalls;
        state.walls = allWalls;
        state.generatedMazeSignature = message.signature;
        state.generatedMazePendingSignature = "";
        state.generatedMazeLoading = false;
        state.generatedMazeActiveRequestId = 0;
        state.worldVersion += 1;
        installPathfindingNodeLayerFromWorker(message.nodeLayer);
        separateActorsFromWallsAfterMazeInstall();
        resolveTargetNpcContacts();
        labels.workerStatus.textContent = "ready";
    }

    function separateActorsFromWallsAfterMazeInstall() {
        constrainActorToWalls(state.target, TARGET_RADIUS, 32);
        assertActorWallSeparation("target after maze section install", state.target, TARGET_RADIUS);
        for (const agent of state.agents) {
            constrainActorToWalls(agent, agent.radius, 32);
            assertActorWallSeparation(`agent ${agent.id} after maze section install`, agent, agent.radius);
        }
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
            agent.pathCursor = 0;
            agent.pathGoalX = agent.x;
            agent.pathGoalY = agent.y;
        }
    }

    function unpackMazeWorkerWalls(packed, label) {
        if (!(packed instanceof Float32Array)) throw new Error(`Wizard of Flatland ${label} must be packed`);
        if (packed.length % WALL_STRIDE !== 0) throw new Error(`Wizard of Flatland ${label} has an invalid packed length`);
        const walls = [];
        for (let i = 0; i < packed.length; i += WALL_STRIDE) {
            walls.push({
                ax: packed[i],
                ay: packed[i + 1],
                bx: packed[i + 2],
                by: packed[i + 3],
                nx: packed[i + 4],
                ny: packed[i + 5],
                kind: Math.round(packed[i + 6]) === WALL_KIND_SEGMENT ? WALL_KIND_SEGMENT : WALL_KIND_BOUNDARY
            });
        }
        return walls;
    }

    function wallsMatch(left, right) {
        if (!left || !right) return false;
        return Math.abs(Number(left.ax) - Number(right.ax)) < 0.0001 &&
            Math.abs(Number(left.ay) - Number(right.ay)) < 0.0001 &&
            Math.abs(Number(left.bx) - Number(right.bx)) < 0.0001 &&
            Math.abs(Number(left.by) - Number(right.by)) < 0.0001 &&
            Math.abs(Number(left.nx) - Number(right.nx)) < 0.0001 &&
            Math.abs(Number(left.ny) - Number(right.ny)) < 0.0001 &&
            (left.kind === WALL_KIND_SEGMENT ? WALL_KIND_SEGMENT : WALL_KIND_BOUNDARY) ===
                (right.kind === WALL_KIND_SEGMENT ? WALL_KIND_SEGMENT : WALL_KIND_BOUNDARY);
    }

    function installPathfindingNodeLayerFromWorker(workerLayer) {
        const packedNodes = workerLayer.nodes;
        const packedBlockedEdges = workerLayer.blockedEdges;
        if (!(packedNodes instanceof Float32Array) || packedNodes.length % 4 !== 0) {
            throw new Error("Wizard of Flatland maze worker nodes are malformed");
        }
        if (!(packedBlockedEdges instanceof Int32Array) || packedBlockedEdges.length % 3 !== 0) {
            throw new Error("Wizard of Flatland maze worker blocked edges are malformed");
        }

        const nodes = [];
        const nodeByKey = new Map();
        for (let i = 0; i < packedNodes.length; i += 4) {
            const xindex = Math.round(packedNodes[i]);
            const yindex = Math.round(packedNodes[i + 1]);
            const node = createPathfindingNode(xindex, yindex);
            node.blocked = packedNodes[i + 2] === 1;
            nodes.push(node);
            nodeByKey.set(node.key, node);
        }
        for (const node of nodes) {
            const offsets = getPathfindingNeighborOffsets(node.xindex);
            for (let dir = 0; dir < 12; dir++) {
                const offset = offsets[dir];
                node.neighbors[dir] = nodeByKey.get(pathfindingNodeKey(node.xindex + offset.x, node.yindex + offset.y)) || null;
            }
        }

        const blockedEdges = [];
        for (let i = 0; i < packedBlockedEdges.length; i += 3) {
            const a = nodes[packedBlockedEdges[i]];
            const b = nodes[packedBlockedEdges[i + 1]];
            const wall = state.walls[packedBlockedEdges[i + 2]];
            if (!a || !b || !wall) throw new Error("Wizard of Flatland maze worker blocked edge references are invalid");
            const aDir = a.neighbors.indexOf(b);
            const bDir = b.neighbors.indexOf(a);
            if (aDir < 0 || bDir < 0) throw new Error("Wizard of Flatland maze worker blocked edge is not between neighbors");
            addDirectionalBlock(a, aDir, wall);
            addDirectionalBlock(b, bDir, wall);
            blockedEdges.push({ a, b, wallIndex: packedBlockedEdges[i + 2] });
        }

        state.nodeLayer.pathCenterX = Number(workerLayer.pathCenterX);
        state.nodeLayer.pathCenterY = Number(workerLayer.pathCenterY);
        if (!Number.isFinite(state.nodeLayer.pathCenterX) || !Number.isFinite(state.nodeLayer.pathCenterY)) {
            throw new Error("Wizard of Flatland maze worker path center is invalid");
        }
        state.nodeLayer.nodes = nodes;
        state.nodeLayer.nodeByKey = nodeByKey;
        state.nodeLayer.blockedEdges = blockedEdges;
        state.nodeLayer.version += 1;
        state.nodeLayer.dirty = true;
        publishPathfindingSnapshot();
    }

    function cloneWallRecord(wall) {
        if (!wall || typeof wall !== "object") throw new Error("Wizard of Flatland wall clone requires a wall record");
        return {
            ax: Number(wall.ax),
            ay: Number(wall.ay),
            bx: Number(wall.bx),
            by: Number(wall.by),
            nx: Number(wall.nx),
            ny: Number(wall.ny),
            kind: wall.kind === WALL_KIND_SEGMENT ? WALL_KIND_SEGMENT : WALL_KIND_BOUNDARY
        };
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
        return true;
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

    function appendMazeSectionWalls(walls, q, r, options) {
        const key = mazeSectionKey(q, r);
        const center = mazeSectionCenter(q, r, options);
        const sectionRadius = getMazeSectionRadius(options);
        const roomRadius = Math.max(5, sectionRadius - MAZE_ROOM_EDGE_INSET_TILES / Math.cos(Math.PI / 6));
        const room = {
            q,
            r,
            key,
            center,
            radius: roomRadius,
            corners: getHexCornersWorld(center.x, center.y, roomRadius)
        };
        const outgoingSides = getMazeSectionOutgoingSides(q, r, options);
        const incomingSides = getMazeSectionIncomingSides(q, r, options);
        const hallConnections = getMazeSectionHallConnections(q, r, outgoingSides, incomingSides, options);
        const outsideDoor = getMazeSectionOutsideDoor(q, r, options, new Set(hallConnections.keys()));

        appendMazeRoomWalls(walls, room, hallConnections, outsideDoor);
        for (const [side, connection] of hallConnections.entries()) {
            if (!connection) throw new Error(`Wizard of Flatland maze hallway ${key}:${side} is missing connection data`);
            appendMazeHalfHallwayToNeighbor(walls, room, side, connection, options);
        }
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

    function getMazeSectionOutgoingSides(q, r, options) {
        const sides = [];
        for (let side = 0; side < 6; side++) {
            if (isMazeSharedHallOpen(q, r, side, options)) sides.push(side);
        }
        return sides;
    }

    function getMazeSectionIncomingSides(q, r, options) {
        return [];
    }

    function getMazeSectionHallConnections(q, r, outgoingSides, incomingSides, options) {
        const connections = new Map();
        for (const side of outgoingSides) {
            connections.set(side, getMazeSharedHallConnection(q, r, side, options, true));
        }
        for (const side of incomingSides) {
            connections.set(side, getMazeSharedHallConnection(q, r, side, options, true));
        }
        return connections;
    }

    function getMazeSharedHallConnection(q, r, side, options, requireOpen = false) {
        const dir = MAZE_SECTION_DIRECTIONS[side];
        if (!dir) throw new Error("Wizard of Flatland maze hallway side is invalid");
        const neighborQ = q + dir.q;
        const neighborR = r + dir.r;
        const thisKey = mazeSectionKey(q, r);
        const neighborKey = mazeSectionKey(neighborQ, neighborR);
        const ordered = thisKey < neighborKey
            ? `${thisKey}|${neighborKey}`
            : `${neighborKey}|${thisKey}`;
        const random = seededRandom(hashString(`${options.seed}|hall-edge|${ordered}`));
        const edgeT = 0.28 + random() * 0.44;
        const open = isMazeSharedHallOpen(q, r, side, options);
        if (requireOpen && !open) {
            throw new Error(`Wizard of Flatland maze hallway edge ${ordered} is not open`);
        }
        return {
            side,
            edgeKey: ordered,
            open,
            t: thisKey < neighborKey ? edgeT : 1 - edgeT,
            width: MAZE_HALLWAY_GAP_WIDTH
        };
    }

    function isMazeSharedHallOpen(q, r, side, options) {
        const dir = MAZE_SECTION_DIRECTIONS[side];
        if (!dir) throw new Error("Wizard of Flatland maze hallway side is invalid");
        const thisKey = mazeSectionKey(q, r);
        const neighborKey = mazeSectionKey(q + dir.q, r + dir.r);
        const ordered = thisKey < neighborKey
            ? `${thisKey}|${neighborKey}`
            : `${neighborKey}|${thisKey}`;
        const random = seededRandom(hashString(`${options.seed}|hall-open|${ordered}`));
        return random() < 1 / 3;
    }

    function getMazeSectionOutsideDoor(q, r, options, hallSides) {
        const random = seededRandom(hashString(`${options.seed}|outside-door|${q},${r}`));
        const sideOptions = [0, 1, 2, 3, 4, 5]
            .filter((side) => !hallSides.has(side) && canMazeSectionOwnOutsideDoorSide(q, r, side));
        if (sideOptions.length === 0) return null;
        const side = sideOptions[Math.floor(random() * sideOptions.length)];
        return {
            side,
            t: 0.24 + random() * 0.52,
            width: MAZE_OUTSIDE_DOOR_MIN_WIDTH + random() * (MAZE_OUTSIDE_DOOR_MAX_WIDTH - MAZE_OUTSIDE_DOOR_MIN_WIDTH)
        };
    }

    function canMazeSectionOwnOutsideDoorSide(q, r, side) {
        const dir = MAZE_SECTION_DIRECTIONS[side];
        if (!dir) throw new Error("Wizard of Flatland maze outside door side is invalid");
        const thisKey = mazeSectionKey(q, r);
        const neighborKey = mazeSectionKey(q + dir.q, r + dir.r);
        return thisKey < neighborKey;
    }

    function appendMazeRoomWalls(walls, room, hallConnections, outsideDoor) {
        for (let side = 0; side < 6; side++) {
            const a = room.corners[side];
            const b = room.corners[(side + 1) % 6];
            const connection = hallConnections.get(side);
            if (connection) {
                appendWallWithGap(walls, a, b, connection.t, connection.width);
                continue;
            }
            if (outsideDoor && outsideDoor.side === side) {
                appendWallWithGap(walls, a, b, outsideDoor.t, outsideDoor.width);
                appendOutsideDoorPosts(walls, a, b, outsideDoor.t, outsideDoor.width, side);
                continue;
            }
            appendSegmentWall(walls, a.x, a.y, b.x, b.y);
        }
    }

    function appendWallWithGap(walls, a, b, gapT, gapWidth) {
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (!(length > gapWidth + 0.5)) return;
        const halfT = Math.max(0.02, gapWidth / length * 0.5);
        const leftT = Math.max(0, gapT - halfT);
        const rightT = Math.min(1, gapT + halfT);
        if (leftT > 0.04) appendSegmentWall(walls, a.x, a.y, a.x + (b.x - a.x) * leftT, a.y + (b.y - a.y) * leftT);
        if (rightT < 0.96) appendSegmentWall(walls, a.x + (b.x - a.x) * rightT, a.y + (b.y - a.y) * rightT, b.x, b.y);
    }

    function appendOutsideDoorPosts(walls, a, b, gapT, gapWidth, side) {
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (!(length > gapWidth + 0.5)) return;
        const halfT = Math.max(0.02, gapWidth / length * 0.5);
        const leftT = Math.max(0, gapT - halfT);
        const rightT = Math.min(1, gapT + halfT);
        const normal = mazeSectionSideNormal(side);
        const postLength = (0.7 + gapWidth * 0.65) / 3;
        const halfPostLength = postLength * 0.5;
        const left = { x: a.x + (b.x - a.x) * leftT, y: a.y + (b.y - a.y) * leftT };
        const right = { x: a.x + (b.x - a.x) * rightT, y: a.y + (b.y - a.y) * rightT };
        appendSegmentWall(
            walls,
            left.x - normal.x * halfPostLength,
            left.y - normal.y * halfPostLength,
            left.x + normal.x * halfPostLength,
            left.y + normal.y * halfPostLength
        );
        appendSegmentWall(
            walls,
            right.x - normal.x * halfPostLength,
            right.y - normal.y * halfPostLength,
            right.x + normal.x * halfPostLength,
            right.y + normal.y * halfPostLength
        );
    }

    function appendMazeHalfHallwayToNeighbor(walls, room, side, connection, options) {
        const dir = MAZE_SECTION_DIRECTIONS[side];
        const neighborCenter = mazeSectionCenter(room.q + dir.q, room.r + dir.r, options);
        const dx = neighborCenter.x - room.center.x;
        const dy = neighborCenter.y - room.center.y;
        const length = Math.hypot(dx, dy);
        if (!(length > 0.001)) throw new Error("Wizard of Flatland maze hallway requires separated section centers");
        const neighborRoomRadius = Math.max(
            5,
            getMazeSectionRadius(options) - MAZE_ROOM_EDGE_INSET_TILES / Math.cos(Math.PI / 6)
        );
        const startGap = getWallGapEndpoints(
            room.corners[side],
            room.corners[(side + 1) % 6],
            connection.t,
            connection.width
        );
        const neighborSide = (side + 3) % 6;
        const neighborCorners = getHexCornersWorld(neighborCenter.x, neighborCenter.y, neighborRoomRadius);
        const neighborConnection = getMazeSharedHallConnection(room.q + dir.q, room.r + dir.r, neighborSide, options, true);
        if (neighborConnection.edgeKey !== connection.edgeKey || Math.abs(neighborConnection.width - connection.width) > 0.000001) {
            throw new Error("Wizard of Flatland maze reciprocal hallway connection mismatch");
        }
        const neighborGap = getWallGapEndpoints(
            neighborCorners[neighborSide],
            neighborCorners[(neighborSide + 1) % 6],
            neighborConnection.t,
            neighborConnection.width
        );

        appendHalfHallwaySideWall(walls, startGap.left, neighborGap.right);
        appendHalfHallwaySideWall(walls, startGap.right, neighborGap.left);
    }

    function appendHalfHallwaySideWall(walls, start, end) {
        const middle = {
            x: (start.x + end.x) * 0.5,
            y: (start.y + end.y) * 0.5
        };
        if (Math.hypot(middle.x - start.x, middle.y - start.y) <= 0.5) return;
        appendSegmentWall(walls, start.x, start.y, middle.x, middle.y);
    }

    function getWallGapEndpoints(a, b, gapT, gapWidth) {
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (!(length > gapWidth + 0.5)) {
            throw new Error("Wizard of Flatland maze hallway gap requires a wall segment longer than the gap");
        }
        const halfT = Math.max(0.02, gapWidth / length * 0.5);
        return {
            left: pointOnHexSide(a, b, Math.max(0, gapT - halfT)),
            right: pointOnHexSide(a, b, Math.min(1, gapT + halfT))
        };
    }

    function pointOnHexSide(a, b, t) {
        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t
        };
    }

    function mazeSectionSideNormal(side) {
        const angle = side * Math.PI / 3;
        return {
            x: Math.cos(angle),
            y: Math.sin(angle)
        };
    }

    function addWall(walls, ax, ay, bx, by, nx, ny, kind = WALL_KIND_BOUNDARY) {
        const len = Math.hypot(nx, ny);
        if (!(len > 0)) throw new Error("wall normal must be non-zero");
        walls.push({ ax, ay, bx, by, nx: nx / len, ny: ny / len, kind });
    }

    function addSegmentWall(ax, ay, bx, by) {
        const wall = createSegmentWall(ax, ay, bx, by);
        if (!wall) return false;
        if (isProceduralMazeScenario()) {
            state.manualWalls.push(wall);
            state.walls = state.generatedMazeWalls.concat(state.manualWalls);
            state.generatedMazeSignature = "";
            refreshGeneratedMazeIfNeeded(true);
        } else {
            state.walls.push(wall);
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
        state.walls = [];
        state.manualWalls = [];
        state.generatedMazeWalls = [];
        state.generatedMazeChunkKeys = new Set();
        state.generatedMazeSignature = "";
        state.generatedMazePendingSignature = "";
        state.generatedMazeLoading = false;
        invalidateMazeLookaheadCache();
        clearPathfindingNodeLayer();
        const count = Number(agentCountInput.value);
        const scenario = scenarioSelect.value;
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
        if (!isProceduralMazeScenario()) {
            rebuildPathfindingNodeLayer();
            enforceInitialWallConstraints();
        }
    }

    function clearPathfindingNodeLayer() {
        state.nodeLayer.nodes = [];
        state.nodeLayer.nodeByKey = new Map();
        state.nodeLayer.blockedEdges = [];
        state.nodeLayer.pathCenterX = NaN;
        state.nodeLayer.pathCenterY = NaN;
        state.nodeLayer.version += 1;
        state.nodeLayer.dirty = true;
    }

    function respawnAgentsForCurrentScenario() {
        state.agents = [];
        const count = Number(agentCountInput.value);
        const scenario = scenarioSelect.value;
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
        addWall(state.walls, minX, minY, maxX, minY, 0, 1);
        addWall(state.walls, maxX, minY, maxX, maxY, -1, 0);
        addWall(state.walls, maxX, maxY, minX, maxY, 0, -1);
        addWall(state.walls, minX, maxY, minX, minY, 1, 0);
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
        for (let i = 0; i < count; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = centerX + (col / Math.max(1, cols - 1) - 0.5) * width + (Math.random() - 0.5) * 0.25;
            const y = centerY + (row / Math.max(1, Math.ceil(count / cols) - 1) - 0.5) * height + (Math.random() - 0.5) * 0.25;
            addAgent(x, y, i);
        }
    }

    function addAgent(x, y, id) {
        state.agents.push({
            id,
            x,
            y,
            vx: 0,
            vy: 0,
            radius: AGENT_RADIUS,
            speed: 3.8 + Math.random() * 0.6,
            priority: Math.random(),
            waitTime: Math.random() * 1.5,
            phase: PHASE_MILLING,
            phaseTime: 0,
            homeAngle: Math.atan2(y - state.target.y, x - state.target.x),
            cooldown: Math.random() * 0.8,
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
            pathCursor: 0,
            pathGoalX: x,
            pathGoalY: y
        });
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
        if (!Number.isFinite(dt) || dt <= 0) return;
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
        if (signedForward === 0 && signedSideways === 0) return;

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
        moveTargetWithNpcPush(
            state.target.x + (dirX / magnitude) * speed * dt,
            state.target.y + (dirY / magnitude) * speed * dt
        );
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

    function updateTargetHeadingFromProjectedCursor(dt) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        const cursor = state.projectedCursor;
        if (!cursor || typeof cursor !== "object") throw new Error("Wizard of Flatland projected cursor state is missing");
        if (!Number.isFinite(cursor.angleOffset)) throw new Error("Wizard of Flatland projected cursor turn requires a finite bend");
        if (!isTargetMovementInputActive() && !isProjectedCursorInputActive()) return;
        const bendRatio = getProjectedCursorBendRatio(cursor.angleOffset);
        if (bendRatio === 0) return;
        const trace = getCurrentProjectedCursorTrace();
        const effectiveDistance = getProjectedCursorTraceDistance(trace);
        const turnRadius = getProjectedCursorTurnRadius(effectiveDistance, bendRatio);
        const turnRate = TARGET_KEYBOARD_MOVE_SPEED / turnRadius;
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
        for (const wall of state.walls) {
            const hit = wall.kind === WALL_KIND_SEGMENT
                ? sweptCircleSegmentHit(fromX, fromY, toX, toY, wall.ax, wall.ay, wall.bx, wall.by, FIREBALL_DAMAGE_RADIUS)
                : sweptCircleBoundaryWallHit(fromX, fromY, toX, toY, wall, FIREBALL_DAMAGE_RADIUS);
            if (!hit || (best && hit.t >= best.t)) continue;
            best = {
                t: hit.t,
                x: fromX + (toX - fromX) * hit.t,
                y: fromY + (toY - fromY) * hit.t
            };
        }
        return best;
    }

    function sweptCircleBoundaryWallHit(fromX, fromY, toX, toY, wall, radius) {
        if (!wall || !Number.isFinite(wall.ax) || !Number.isFinite(wall.ay) || !Number.isFinite(wall.nx) || !Number.isFinite(wall.ny) || !Number.isFinite(radius)) {
            throw new Error("Wizard of Flatland fireball boundary hit test requires finite wall data");
        }
        const startSigned = (fromX - wall.ax) * wall.nx + (fromY - wall.ay) * wall.ny;
        const endSigned = (toX - wall.ax) * wall.nx + (toY - wall.ay) * wall.ny;
        if (startSigned <= radius) return { t: 0 };
        if (endSigned > radius) return null;
        const delta = startSigned - endSigned;
        if (!(delta > 0.000001)) return null;
        return { t: Math.max(0, Math.min(1, (startSigned - radius) / delta)) };
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

    function constrainActorToWalls(actor, radius, maxPasses = 4) {
        for (let pass = 0; pass < maxPasses; pass++) {
            let changed = false;
            for (const wall of state.walls) {
                if (wall.kind === WALL_KIND_SEGMENT) {
                    const distance = pointSegmentDistance(actor.x, actor.y, wall.ax, wall.ay, wall.bx, wall.by);
                    if (distance >= radius) continue;
                    const normal = segmentRepulsionNormal(actor.x, actor.y, wall.ax, wall.ay, wall.bx, wall.by);
                    const correction = radius - distance + TARGET_NPC_PUSH_SLOP;
                    actor.x += normal.x * correction;
                    actor.y += normal.y * correction;
                    changed = true;
                    continue;
                }

                const signed = (actor.x - wall.ax) * wall.nx + (actor.y - wall.ay) * wall.ny;
                if (signed < radius) {
                    const correction = radius - signed;
                    actor.x += wall.nx * correction;
                    actor.y += wall.ny * correction;
                    changed = true;
                }
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
        for (let wallIndex = 0; wallIndex < state.walls.length; wallIndex++) {
            const wall = state.walls[wallIndex];
            if (wall.kind === WALL_KIND_SEGMENT) {
                const distance = pointSegmentDistance(actor.x, actor.y, wall.ax, wall.ay, wall.bx, wall.by);
                if (distance < radius - TARGET_NPC_PUSH_SLOP * 4) {
                    throw new Error(formatWallSeparationError(label, actor, radius, wall, wallIndex, distance, "segment"));
                }
                continue;
            }
            const signed = (actor.x - wall.ax) * wall.nx + (actor.y - wall.ay) * wall.ny;
            if (signed < radius - TARGET_NPC_PUSH_SLOP * 4) {
                throw new Error(formatWallSeparationError(label, actor, radius, wall, wallIndex, signed, "boundary"));
            }
        }
    }

    function formatWallSeparationError(label, actor, radius, wall, wallIndex, distance, kind) {
        return [
            `Wizard of Flatland ${label} ${kind} wall collision unresolved`,
            `actor=(${actor.x.toFixed(3)},${actor.y.toFixed(3)})`,
            `radius=${radius.toFixed(3)}`,
            `distance=${distance.toFixed(4)}`,
            `wallIndex=${wallIndex}`,
            `wall=(${wall.ax.toFixed(3)},${wall.ay.toFixed(3)})->(${wall.bx.toFixed(3)},${wall.by.toFixed(3)})`
        ].join(" ");
    }

    function packAgents() {
        const packed = new Float32Array(state.agents.length * STRIDE);
        const forceDirectPathing = isProceduralMazeScenario() && state.generatedMazeLoading;
        for (let i = 0; i < state.agents.length; i++) {
            const agent = state.agents[i];
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
            packed[base + 14] = !forceDirectPathing && agent.pathMode === PATH_MODE_WORKER ? PATH_MODE_WORKER : PATH_MODE_DIRECT;
            packed[base + 15] = !forceDirectPathing && Number.isFinite(agent.pathGoalX) ? agent.pathGoalX : state.target.x;
            packed[base + 16] = !forceDirectPathing && Number.isFinite(agent.pathGoalY) ? agent.pathGoalY : state.target.y;
        }
        return packed;
    }

    function packWalls() {
        const packed = new Float32Array(state.walls.length * WALL_STRIDE);
        for (let i = 0; i < state.walls.length; i++) {
            const wall = state.walls[i];
            const base = i * WALL_STRIDE;
            packed[base] = wall.ax;
            packed[base + 1] = wall.ay;
            packed[base + 2] = wall.bx;
            packed[base + 3] = wall.by;
            packed[base + 4] = wall.nx;
            packed[base + 5] = wall.ny;
            packed[base + 6] = wall.kind === WALL_KIND_SEGMENT ? WALL_KIND_SEGMENT : WALL_KIND_BOUNDARY;
        }
        return packed;
    }

    function requestStep(dt) {
        if (state.waitingForWorker) return;
        if (isProceduralMazeScenario() && state.nodeLayer.nodes.length === 0) {
            labels.workerStatus.textContent = state.generatedMazeLoading ? "maze loading" : "maze missing";
            return;
        }
        if (!(isProceduralMazeScenario() && state.generatedMazeLoading)) updateAgentPathing(dt);
        state.waitingForWorker = true;
        const targetMoved = Math.hypot(
            state.target.x - state.lastSentTarget.x,
            state.target.y - state.lastSentTarget.y
        ) > 0.001;
        state.lastSentTarget = { x: state.target.x, y: state.target.y };
        const agents = packAgents();
        const walls = packWalls();
        worker.postMessage({
            type: "step",
            requestId: state.requestId++,
            worldVersion: state.worldVersion,
            dt,
            agents,
            walls,
            params: {
                targetX: state.target.x,
                targetY: state.target.y,
                targetRadius: TARGET_RADIUS,
                ringRadius: COMBAT_RING_RADIUS,
                separationStrength: Number(separationInput.value),
                speedScale: getSpeedScale(),
                targetMoved
            }
        }, [agents.buffer, walls.buffer]);
    }

    function handleWorkerMessage(event) {
        const message = event && event.data ? event.data : null;
        if (!message) return;
        if (message.type === "ready") {
            labels.workerStatus.textContent = "ready";
            return;
        }
        if (message.type === "error") {
            state.waitingForWorker = false;
            labels.workerStatus.textContent = message.message || "solver error";
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
        labels.workerStatus.textContent = "ready";
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
        labels.solveMs.textContent = `${Number(stats.solveMs || 0).toFixed(2)} ms`;
        labels.pairChecks.textContent = String(stats.pairChecks || 0);
        labels.movingCount.textContent = String(stats.moving || stats.milling || 0);
        labels.seekingCount.textContent = String(stats.seeking || 0);
        labels.waitingCount.textContent = String(stats.waiting || 0);
        labels.attackingCount.textContent = String(stats.attacking || 0);
        labels.retreatingCount.textContent = String(stats.retreating || 0);
        labels.blockedCount.textContent = String(stats.blocked || 0);
        labels.wallLeaks.textContent = String(stats.wallLeaks || 0);
    }

    function updateAgentPathing(_dt) {
        const now = performance.now();
        const goalNode = nearestPassablePathfindingNode(state.target.x, state.target.y);
        for (const agent of state.agents) {
            const hasLos = hasDirectLineOfSight(agent.x, agent.y, state.target.x, state.target.y, agent.radius);
            if (hasLos) {
                agent.pathMode = PATH_MODE_DIRECT;
                agent.pathGoalX = state.target.x;
                agent.pathGoalY = state.target.y;
                agent.pathNodeKeys = [];
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

            const rawStartNode = nearestPathfindingNode(agent.x, agent.y);
            const startNode = isPathfindingNodePassable(rawStartNode)
                ? rawStartNode
                : nearestPassablePathfindingNode(agent.x, agent.y);
            const shouldRequest =
                !agent.pathRequestPending &&
                (
                    agent.pathNodeKeys.length === 0 ||
                    agent.pathRequestedWorldVersion !== state.worldVersion ||
                    agent.pathRequestedGoalKey !== goalNode.key ||
                    agent.pathRequestedRawStartKey !== rawStartNode.key ||
                    agent.pathRequestedStartKey !== startNode.key ||
                    now - agent.pathRequestedAt >= PATH_REQUEST_INTERVAL_SECONDS * 1000
                );
            if (shouldRequest) requestAgentPath(agent, rawStartNode, startNode, goalNode, now);
        }
    }

    function hasDirectLineOfSight(fromX, fromY, toX, toY, radius) {
        const wallGeometry = getWallGeometryApi();
        for (const wall of state.walls) {
            if (wallGeometry.connectionCrossesWallFaces(
                { x: fromX, y: fromY },
                { x: toX, y: toY },
                { x: wall.ax, y: wall.ay },
                { x: wall.bx, y: wall.by },
                {
                    thickness: Math.max(PATH_NODE_WALL_THICKNESS, radius * 0.35),
                    extend: PATH_NODE_WALL_FACE_EXTEND
                }
            )) {
                return false;
            }
        }
        return true;
    }

    function nearestPathfindingNode(worldX, worldY) {
        let best = null;
        for (const node of state.nodeLayer.nodes) {
            const dx = node.x - worldX;
            const dy = node.y - worldY;
            const distSq = dx * dx + dy * dy;
            if (!best || distSq < best.distSq) best = { node, distSq };
        }
        if (!best) throw new Error("Wizard of Flatland pathfinding requires at least one node");
        return best.node;
    }

    function nearestPassablePathfindingNode(worldX, worldY) {
        let best = null;
        for (const node of state.nodeLayer.nodes) {
            if (!isPathfindingNodePassable(node)) continue;
            const dx = node.x - worldX;
            const dy = node.y - worldY;
            const distSq = dx * dx + dy * dy;
            if (!best || distSq < best.distSq) best = { node, distSq };
        }
        if (!best) throw new Error("Wizard of Flatland pathfinding requires at least one passable node");
        return best.node;
    }

    function advanceAgentPathCursor(agent) {
        while (agent.pathCursor < agent.pathNodeKeys.length) {
            const key = agent.pathNodeKeys[agent.pathCursor];
            const node = state.nodeLayer.nodeByKey.get(key);
            if (!node) throw new Error(`Wizard of Flatland path contains unknown node ${key}`);
            const distance = Math.hypot(node.x - agent.x, node.y - agent.y);
            if (distance > PATH_WAYPOINT_REACHED_DISTANCE) return;
            agent.pathCursor += 1;
        }
    }

    function getAgentPathWaypoint(agent) {
        if (agent.pathCursor >= agent.pathNodeKeys.length) return null;
        const key = agent.pathNodeKeys[agent.pathCursor];
        const node = state.nodeLayer.nodeByKey.get(key);
        if (!node) throw new Error(`Wizard of Flatland path waypoint missing for ${key}`);
        return node;
    }

    function requestAgentPath(agent, rawStartNode, startNode, goalNode, now) {
        const requestId = state.pathfindingRequestId++;
        agent.pathRequestPending = true;
        agent.pathRequestId = requestId;
        agent.pathRequestedAt = now;
        agent.pathRequestedWorldVersion = state.worldVersion;
        agent.pathRequestedRawStartKey = rawStartNode.key;
        agent.pathRequestedStartKey = startNode.key;
        agent.pathRequestedGoalKey = goalNode.key;
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
            startNodeKey: startNode.key,
            destinationNodeKey: goalNode.key,
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
        if (isProceduralMazeScenario() && state.generatedMazeLoading) return;
        const agent = state.agents.find((candidate) => candidate.pathRequestId === message.requestId);
        if (!agent) return;
        agent.pathRequestPending = false;
        if (Number(message.mapVersion) !== Number(state.pathfindingSnapshotVersion)) return;
        if (!message.ok) {
            agent.pathNodeKeys = [];
            agent.pathCursor = 0;
            agent.pathGoalX = agent.x;
            agent.pathGoalY = agent.y;
            return;
        }
        if (!Array.isArray(message.pathNodeKeys)) {
            throw new Error("Wizard of Flatland pathfinding worker returned a malformed path");
        }
        const pathNodeKeys = message.pathNodeKeys.slice();
        if (agent.pathRequestedStartKey && agent.pathRequestedStartKey !== agent.pathRequestedRawStartKey) {
            if (pathNodeKeys[0] !== agent.pathRequestedStartKey) {
                pathNodeKeys.unshift(agent.pathRequestedStartKey);
            }
        }
        agent.pathNodeKeys = pathNodeKeys;
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
        state.view.scale = Math.min(width / 42, height / 29);
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

    function draw() {
        resizeCanvas();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawHexGridLayer();
        drawPathfindingNodeLayer();
        drawWalls();
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
        for (let w = 0; w < state.walls.length; w++) {
            const wall = state.walls[w];
            const wallMinX = Math.min(wall.ax, wall.bx) - HEX_GRID_WIDTH;
            const wallMaxX = Math.max(wall.ax, wall.bx) + HEX_GRID_WIDTH;
            const wallMinY = Math.min(wall.ay, wall.by) - HEX_GRID_HEIGHT;
            const wallMaxY = Math.max(wall.ay, wall.by) + HEX_GRID_HEIGHT;
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
                        { x: wall.ax, y: wall.ay },
                        { x: wall.bx, y: wall.by },
                        {
                            thickness: PATH_NODE_WALL_THICKNESS,
                            extend: PATH_NODE_WALL_FACE_EXTEND
                        }
                    )) {
                        continue;
                    }
                    blockedKeys.add(edgeKey);
                    addDirectionalBlock(node, dir, wall);
                    const reverseDir = neighbor.neighbors.indexOf(node);
                    if (reverseDir >= 0) addDirectionalBlock(neighbor, reverseDir, wall);
                    blockedEdges.push({ a: node, b: neighbor, wallIndex: w });
                }
            }
        }
        for (const node of nodes) {
            node.blocked = !isPathfindingNodeTerrainPassable(node);
        }

        state.nodeLayer.nodes = nodes;
        state.nodeLayer.nodeByKey = nodeByKey;
        state.nodeLayer.blockedEdges = blockedEdges;
        state.nodeLayer.version += 1;
        state.nodeLayer.dirty = true;
        publishPathfindingSnapshot();
    }

    function publishPathfindingSnapshot() {
        state.pathfindingSnapshotVersion = state.worldVersion;
        pathfindingWorker.postMessage({
            type: "replace_snapshot",
            snapshot: buildPathfindingWorkerSnapshot()
        });
    }

    function buildPathfindingWorkerSnapshot() {
        const nodes = state.nodeLayer.nodes.map((node) => ({
            key: node.key,
            x: node.x,
            y: node.y,
            blocked: node.blocked === true,
            clearance: null
        }));
        const edges = [];
        const emitted = new Set();
        for (const node of state.nodeLayer.nodes) {
            for (let dir = 0; dir < node.neighbors.length; dir++) {
                const neighbor = node.neighbors[dir];
                if (!neighbor) continue;
                if (node.blockedNeighbors.has(dir)) continue;
                const id = `${node.key}->${neighbor.key}`;
                if (emitted.has(id)) continue;
                emitted.add(id);
                edges.push({
                    id,
                    fromKey: node.key,
                    toKey: neighbor.key,
                    terrainBlocked: false,
                    directionalObstacleIds: []
                });
            }
        }
        return {
            version: state.pathfindingSnapshotVersion,
            nodes,
            edges,
            obstacles: [],
            tileObstacleIdsByNodeKey: {}
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
        for (const wall of state.walls) {
            minX = Math.min(minX, wall.ax, wall.bx);
            minY = Math.min(minY, wall.ay, wall.by);
            maxX = Math.max(maxX, wall.ax, wall.bx);
            maxY = Math.max(maxY, wall.ay, wall.by);
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

    function isPathfindingNodePassable(node) {
        return !!node && node.blocked !== true && hasUnblockedPathfindingNeighbor(node);
    }

    function hasUnblockedPathfindingNeighbor(node) {
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
        for (const wall of state.walls) {
            const kind = wall.kind === WALL_KIND_SEGMENT ? WALL_KIND_SEGMENT : WALL_KIND_BOUNDARY;
            if (kind === WALL_KIND_SEGMENT) {
                const distance = pointSegmentDistance(node.x, node.y, wall.ax, wall.ay, wall.bx, wall.by);
                if (distance < TARGET_RADIUS) return false;
                continue;
            }
            const nx = Number(wall.nx);
            const ny = Number(wall.ny);
            if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
                throw new Error("Wizard of Flatland pathfinding passability requires finite wall normals");
            }
            const signed = (node.x - wall.ax) * nx + (node.y - wall.ay) * ny;
            if (signed < TARGET_RADIUS) return false;
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
            for (const edge of layer.blockedEdges) {
                const a = worldToScreen(edge.a.x, edge.a.y);
                const b = worldToScreen(edge.b.x, edge.b.y);
                nodeCtx.beginPath();
                nodeCtx.moveTo(a.x, a.y);
                nodeCtx.lineTo(b.x, b.y);
                nodeCtx.stroke();
            }
        }

        const nodeRadius = Math.max(1.2, Math.min(3, layer.scale * 0.045));
        nodeCtx.fillStyle = "rgba(104,183,255,0.32)";
        for (const node of layer.nodes) {
            const point = worldToScreen(node.x, node.y);
            if (point.x < -nodeRadius || point.x > layer.width + nodeRadius || point.y < -nodeRadius || point.y > layer.height + nodeRadius) {
                continue;
            }
            nodeCtx.beginPath();
            nodeCtx.arc(point.x, point.y, nodeRadius, 0, Math.PI * 2);
            nodeCtx.fill();
        }

        nodeCtx.restore();
        layer.dirty = false;
    }

    function drawWalls() {
        ctx.save();
        ctx.lineCap = "round";
        for (const wall of state.walls) {
            const a = worldToScreen(wall.ax, wall.ay);
            const b = worldToScreen(wall.bx, wall.by);
            ctx.lineWidth = wall.kind === WALL_KIND_SEGMENT
                ? Math.max(3, state.view.scale * 0.1)
                : Math.max(2, state.view.scale * 0.08);
            ctx.strokeStyle = wall.kind === WALL_KIND_SEGMENT ? "#f4c95d" : "#d9e4ea";
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawWallBuildPreview() {
        const tool = state.wallTool;
        if (!tool.dragging || !tool.startNode || !tool.hoverNode) return;
        const a = worldToScreen(tool.startNode.x, tool.startNode.y);
        const b = worldToScreen(tool.hoverNode.x, tool.hoverNode.y);
        const sameNode = tool.startNode.key === tool.hoverNode.key;
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(3, state.view.scale * 0.11);
        ctx.strokeStyle = sameNode ? "rgba(255,107,107,0.82)" : "rgba(244,201,93,0.9)";
        ctx.setLineDash(sameNode ? [6, 6] : [10, 7]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = sameNode ? "rgba(255,107,107,0.95)" : "rgba(244,201,93,0.95)";
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
        ctx.strokeStyle = flash > 0 ? "#ff4d4d" : "#58d27b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = flash > 0
            ? `rgba(255,77,77,${0.25 + flash * 0.45})`
            : "rgba(88,210,123,0.28)";
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
        drawTargetHat(point.x, point.y + state.view.scale * 0.2, radius);
        drawProjectedTargetCursor(state.target.x, state.target.y, state.target.heading);
        ctx.restore();
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
            for (const wall of state.walls) {
                const hit = segmentIntersectionParameters(previous.x, previous.y, current.x, current.y, wall.ax, wall.ay, wall.bx, wall.by);
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
        const pathNodes = agent.pathNodeKeys.map((key, index) => {
            const node = state.nodeLayer.nodeByKey.get(key);
            return {
                index,
                key,
                current: index === agent.pathCursor,
                exists: !!node,
                x: node ? node.x : null,
                y: node ? node.y : null,
                blocked: node ? node.blocked === true : null,
                passable: node ? isPathfindingNodePassable(node) : null,
                distanceFromAgent: node ? Math.hypot(node.x - agent.x, node.y - agent.y) : null
            };
        });
        const wallClearances = state.walls.map((wall, index) => ({
            index,
            kind: wall.kind === WALL_KIND_SEGMENT ? "segment" : "boundary",
            clearance: wall.kind === WALL_KIND_SEGMENT
                ? pointSegmentDistance(agent.x, agent.y, wall.ax, wall.ay, wall.bx, wall.by)
                : (agent.x - wall.ax) * wall.nx + (agent.y - wall.ay) * wall.ny
        })).sort((a, b) => a.clearance - b.clearance).slice(0, 5);
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
            waypoint: waypoint ? { key: waypoint.key, x: waypoint.x, y: waypoint.y, blocked: waypoint.blocked === true } : null,
            currentNode: {
                key: currentNode.key,
                x: currentNode.x,
                y: currentNode.y,
                blocked: currentNode.blocked === true,
                passable: isPathfindingNodePassable(currentNode)
            },
            targetNearestNode: {
                key: targetNearestNode.key,
                x: targetNearestNode.x,
                y: targetNearestNode.y,
                blocked: targetNearestNode.blocked === true,
                passable: isPathfindingNodePassable(targetNearestNode)
            },
            targetPassableNode: {
                key: targetPassableNode.key,
                x: targetPassableNode.x,
                y: targetPassableNode.y,
                blocked: targetPassableNode.blocked === true,
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
        for (const wall of state.walls) {
            if (wall.kind !== WALL_KIND_SEGMENT) continue;
            const hit = sweptCircleSegmentHit(fromX, fromY, toX, toY, wall.ax, wall.ay, wall.bx, wall.by, radius);
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
        const dt = Math.min(0.05, Math.max(0.001, (now - state.lastTime) / 1000));
        state.lastTime = now;
        state.targetFlashTime = Math.max(0, state.targetFlashTime - dt);
        updateProjectedCursorKeyboardControls(dt);
        updateTargetHeadingFromProjectedCursor(dt);
        updateTargetKeyboardMovement(dt);
        refreshGeneratedMazeIfNeeded(false);
        refreshMazePathBoundsIfNeeded();
        updateFireballs(dt);
        if (state.running) requestStep(dt);
        draw();
        requestAnimationFrame(tick);
    }

    playButton.addEventListener("click", () => {
        state.running = !state.running;
        playButton.textContent = state.running ? "Pause" : "Play";
    });
    stepButton.addEventListener("click", () => requestStep(1 / 60));
    resetButton.addEventListener("click", createScenario);
    scenarioSelect.addEventListener("change", createScenario);
    for (const input of [agentCountInput, separationInput, speedScaleInput]) {
        input.addEventListener("input", () => {
            updateControlLabels();
            if (input === agentCountInput) respawnAgentsForCurrentScenario();
        });
    }
    for (const input of [mazeSeedInput, mazeChunkSizeInput, mazeRoomScaleInput, mazeTwistinessInput]) {
        input.addEventListener("input", () => {
            updateControlLabels();
            if (!isProceduralMazeScenario()) return;
            state.generatedMazeSignature = "";
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
