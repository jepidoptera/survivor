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
    const AGENT_RADIUS = 0.42;
    const TARGET_RADIUS = AGENT_RADIUS;
    const COMBAT_RING_RADIUS = 1.6;
    const TARGET_KEYBOARD_MOVE_SPEED = 5.67;
    const TARGET_KEYBOARD_FAST_MOVE_SPEED = 14.49;
    const SPEED_SCALE_MIN = 0.05;
    const SPEED_SCALE_MAX = 0.8;
    const SPEED_SCALE_DEFAULT = 0.2;
    const TARGET_NPC_PUSH_ITERATIONS = 96;
    const TARGET_NPC_PUSH_SLOP = 0.0005;
    const TARGET_NPC_PUSH_PLAYER_SHARE = 0.38;
    const NPC_NPC_PUSH_SHARE = 0.5;
    const TARGET_NPC_PUSH_MIN_AXIS = 0.0001;
    const HEX_GRID_ROW_STEP = 1;
    const HEX_GRID_COL_STEP = 0.866;
    const HEX_GRID_WIDTH = 1 / HEX_GRID_COL_STEP;
    const HEX_GRID_HEIGHT = 1;
    const HEX_GRID_PADDING = 2;
    const PATH_NODE_LAYER_PADDING = 4;
    const PATH_NODE_WALL_THICKNESS = 0.1;
    const PATH_NODE_WALL_FACE_EXTEND = 0.501;
    const WALL_KIND_BOUNDARY = 0;
    const WALL_KIND_SEGMENT = 1;
    const PATH_MODE_DIRECT = 0;
    const PATH_MODE_WORKER = 1;
    const PATH_REQUEST_INTERVAL_SECONDS = 0.22;
    const PATH_WAYPOINT_REACHED_DISTANCE = 0.55;
    const HEADING_GLITCH_TURN_THRESHOLD = Math.PI / 5;
    const HEADING_GLITCH_RETURN_THRESHOLD = Math.PI / 10;
    const TARGET_MOVEMENT_KEYS = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
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

    const labels = {
        agentCount: document.getElementById("agentCountValue"),
        separationStrength: document.getElementById("separationStrengthValue"),
        speedScale: document.getElementById("speedScaleValue"),
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
        walls: [],
        target: { x: 0, y: 0 },
        lastSentTarget: { x: 0, y: 0 },
        targetFlashTime: 0,
        targetPushes: 0,
        pressedMovementKeys: Object.create(null),
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
        view: { width: 0, height: 0, dpr: 1, scale: 1, offsetX: 0, offsetY: 0 },
        hexGridLayer: {
            canvas: document.createElement("canvas"),
            ctx: null,
            width: 0,
            height: 0,
            scale: 0,
            offsetX: 0,
            offsetY: 0,
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
            renderedVersion: -1,
            renderedShowPathBlockedEdges: false,
            dirty: true
        }
    };
    state.hexGridLayer.ctx = state.hexGridLayer.canvas.getContext("2d");
    state.nodeLayer.ctx = state.nodeLayer.canvas.getContext("2d");
    window.__npcMovementLabDebug = state;
    window.debug = state.debug;

    const worker = new Worker("/npc-movement-lab/solverWorker.js?v=npc-movement-lab-66");
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", (event) => {
        labels.workerStatus.textContent = event.message || "failed";
    });

    const pathfindingWorker = new Worker("/assets/javascript/pathfinding/pathfindingWorker.js?v=npc-movement-lab-1");
    pathfindingWorker.addEventListener("message", handlePathfindingWorkerMessage);
    pathfindingWorker.addEventListener("error", (event) => {
        labels.workerStatus.textContent = event.message || "pathfinding failed";
    });

    function updateControlLabels() {
        labels.agentCount.textContent = agentCountInput.value;
        labels.separationStrength.textContent = Number(separationInput.value).toFixed(1);
        labels.speedScale.textContent = getSpeedScale().toFixed(2);
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

    function addWall(walls, ax, ay, bx, by, nx, ny, kind = WALL_KIND_BOUNDARY) {
        const len = Math.hypot(nx, ny);
        if (!(len > 0)) throw new Error("wall normal must be non-zero");
        walls.push({ ax, ay, bx, by, nx: nx / len, ny: ny / len, kind });
    }

    function addSegmentWall(ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (!(len > 0.001)) return false;
        addWall(state.walls, ax, ay, bx, by, -dy / len, dx / len, WALL_KIND_SEGMENT);
        state.worldVersion += 1;
        rebuildPathfindingNodeLayer();
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
        state.walls = [];
        const count = Number(agentCountInput.value);
        const scenario = scenarioSelect.value;
        if (scenario === "openArena") {
            state.target = { x: 0, y: 0 };
            addRoomWalls(-18, -12, 18, 12);
            spawnRing(count, 10, 3.5);
        } else if (scenario === "crowdedArena") {
            state.target = { x: 0, y: 0 };
            addRoomWalls(-10, -7.5, 10, 7.5);
            spawnCluster(count, -4.2, 0, 4.4, 10);
        } else {
            state.target = { x: 0, y: 0 };
            addRoomWalls(-8, -6, 8, 6);
            addRoomWalls(-18, -12, 18, 12);
            spawnCluster(count, 0, 0.8, 4.8, 5);
        }
        state.lastSentTarget = { x: state.target.x, y: state.target.y };
        rebuildPathfindingNodeLayer();
        enforceInitialWallConstraints();
    }

    function respawnAgentsForCurrentScenario() {
        state.agents = [];
        const count = Number(agentCountInput.value);
        const scenario = scenarioSelect.value;
        if (scenario === "openArena") {
            spawnRing(count, 10, 3.5);
        } else if (scenario === "crowdedArena") {
            spawnCluster(count, -4.2, 0, 4.4, 10);
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
        let dirX = 0;
        let dirY = 0;
        for (const key of Object.keys(TARGET_MOVEMENT_KEYS)) {
            if (!state.pressedMovementKeys[key]) continue;
            const delta = TARGET_MOVEMENT_KEYS[key];
            dirX += delta[0];
            dirY += delta[1];
        }
        if (dirX === 0 && dirY === 0) return;
        const magnitude = Math.hypot(dirX, dirY);
        if (!(magnitude > 0)) throw new Error("NPC movement lab keyboard direction must be non-zero");
        const speed = state.fastMovementHeld ? TARGET_KEYBOARD_FAST_MOVE_SPEED : TARGET_KEYBOARD_MOVE_SPEED;
        moveTargetWithNpcPush(
            state.target.x + (dirX / magnitude) * speed * dt,
            state.target.y + (dirY / magnitude) * speed * dt
        );
    }

    function moveTargetWithNpcPush(desiredX, desiredY) {
        if (!Number.isFinite(desiredX) || !Number.isFinite(desiredY)) {
            throw new Error("NPC movement lab target move requires finite coordinates");
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

        const leftPushX = -nx * correction * NPC_NPC_PUSH_SHARE;
        const leftPushY = -ny * correction * NPC_NPC_PUSH_SHARE;
        const rightPushX = nx * correction * (1 - NPC_NPC_PUSH_SHARE);
        const rightPushY = ny * correction * (1 - NPC_NPC_PUSH_SHARE);

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
                throw new Error(`NPC movement lab target collision unresolved for agent ${agent.id}`);
            }
        }
        for (let i = 0; i < state.agents.length; i++) {
            const left = state.agents[i];
            for (let j = i + 1; j < state.agents.length; j++) {
                const right = state.agents[j];
                const minDistance = left.radius + right.radius - TARGET_NPC_PUSH_SLOP * 4;
                const distance = Math.hypot(right.x - left.x, right.y - left.y);
                if (distance < minDistance) {
                    throw new Error(`NPC movement lab NPC collision unresolved for agents ${left.id} and ${right.id}`);
                }
            }
        }
    }

    function assertActorWallSeparation(label, actor, radius) {
        for (const wall of state.walls) {
            if (wall.kind === WALL_KIND_SEGMENT) {
                const distance = pointSegmentDistance(actor.x, actor.y, wall.ax, wall.ay, wall.bx, wall.by);
                if (distance < radius - TARGET_NPC_PUSH_SLOP * 4) {
                    throw new Error(`NPC movement lab ${label} segment wall collision unresolved`);
                }
                continue;
            }
            const signed = (actor.x - wall.ax) * wall.nx + (actor.y - wall.ay) * wall.ny;
            if (signed < radius - TARGET_NPC_PUSH_SLOP * 4) {
                throw new Error(`NPC movement lab ${label} wall collision unresolved`);
            }
        }
    }

    function packAgents() {
        const packed = new Float32Array(state.agents.length * STRIDE);
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
            packed[base + 14] = agent.pathMode === PATH_MODE_WORKER ? PATH_MODE_WORKER : PATH_MODE_DIRECT;
            packed[base + 15] = Number.isFinite(agent.pathGoalX) ? agent.pathGoalX : agent.x;
            packed[base + 16] = Number.isFinite(agent.pathGoalY) ? agent.pathGoalY : agent.y;
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
        updateAgentPathing(dt);
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
        console.groupCollapsed(`NPC movement lab heading glitch: agent ${agent.id}`);
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
        if (!best) throw new Error("NPC movement lab pathfinding requires at least one node");
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
        if (!best) throw new Error("NPC movement lab pathfinding requires at least one passable node");
        return best.node;
    }

    function advanceAgentPathCursor(agent) {
        while (agent.pathCursor < agent.pathNodeKeys.length) {
            const key = agent.pathNodeKeys[agent.pathCursor];
            const node = state.nodeLayer.nodeByKey.get(key);
            if (!node) throw new Error(`NPC movement lab path contains unknown node ${key}`);
            const distance = Math.hypot(node.x - agent.x, node.y - agent.y);
            if (distance > PATH_WAYPOINT_REACHED_DISTANCE) return;
            agent.pathCursor += 1;
        }
    }

    function getAgentPathWaypoint(agent) {
        if (agent.pathCursor >= agent.pathNodeKeys.length) return null;
        const key = agent.pathNodeKeys[agent.pathCursor];
        const node = state.nodeLayer.nodeByKey.get(key);
        if (!node) throw new Error(`NPC movement lab path waypoint missing for ${key}`);
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
            throw new Error("NPC movement lab pathfinding worker returned a malformed path");
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
        if (
            resized ||
            Math.abs(state.view.scale - previousScale) > 0.001 ||
            Math.abs(state.view.offsetX - previousOffsetX) > 0.001 ||
            Math.abs(state.view.offsetY - previousOffsetY) > 0.001
        ) {
            state.hexGridLayer.dirty = true;
            state.nodeLayer.dirty = true;
        }
    }

    function worldToScreen(x, y) {
        return {
            x: state.view.offsetX + x * state.view.scale,
            y: state.view.offsetY + y * state.view.scale
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
        drawCombatRing();
        drawAgentPaths();
        drawAgents();
    }

    function drawHexGridLayer() {
        const layer = state.hexGridLayer;
        if (!layer.ctx) throw new Error("NPC movement lab hex grid layer requires a 2D context");
        if (
            layer.dirty ||
            layer.width !== state.view.width ||
            layer.height !== state.view.height ||
            Math.abs(layer.scale - state.view.scale) > 0.001 ||
            Math.abs(layer.offsetX - state.view.offsetX) > 0.001 ||
            Math.abs(layer.offsetY - state.view.offsetY) > 0.001
        ) {
            rebuildHexGridLayer();
        }
        ctx.drawImage(layer.canvas, 0, 0);
    }

    function rebuildHexGridLayer() {
        const layer = state.hexGridLayer;
        if (!layer.ctx) throw new Error("NPC movement lab hex grid layer requires a 2D context");
        if (!(state.view.width > 0 && state.view.height > 0 && state.view.scale > 0)) {
            throw new Error("NPC movement lab hex grid requires a valid viewport");
        }

        layer.width = state.view.width;
        layer.height = state.view.height;
        layer.scale = state.view.scale;
        layer.offsetX = state.view.offsetX;
        layer.offsetY = state.view.offsetY;
        layer.canvas.width = layer.width;
        layer.canvas.height = layer.height;

        const gridCtx = layer.ctx;
        gridCtx.clearRect(0, 0, layer.width, layer.height);
        gridCtx.save();
        gridCtx.lineWidth = Math.max(1, layer.scale * 0.018);
        gridCtx.strokeStyle = "rgba(236,244,248,0.13)";

        const worldMinX = (0 - layer.offsetX) / layer.scale;
        const worldMaxX = (layer.width - layer.offsetX) / layer.scale;
        const worldMinY = (0 - layer.offsetY) / layer.scale;
        const worldMaxY = (layer.height - layer.offsetY) / layer.scale;
        const colStart = Math.floor(worldMinX / HEX_GRID_COL_STEP) - HEX_GRID_PADDING;
        const colEnd = Math.ceil(worldMaxX / HEX_GRID_COL_STEP) + HEX_GRID_PADDING;
        const rowStart = Math.floor(worldMinY / HEX_GRID_ROW_STEP) - HEX_GRID_PADDING;
        const rowEnd = Math.ceil(worldMaxY / HEX_GRID_ROW_STEP) + HEX_GRID_PADDING;
        const halfW = HEX_GRID_WIDTH * layer.scale * 0.5;
        const quarterW = HEX_GRID_WIDTH * layer.scale * 0.25;
        const halfH = HEX_GRID_HEIGHT * layer.scale * 0.5;

        for (let col = colStart; col <= colEnd; col++) {
            const centerX = layer.offsetX + col * HEX_GRID_COL_STEP * layer.scale;
            for (let row = rowStart; row <= rowEnd; row++) {
                const centerY = layer.offsetY + (row + (isEvenGridColumn(col) ? 0.5 : 0)) * layer.scale;
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
            throw new Error("NPC movement lab pathfinding node layer requires WallGeometry.connectionCrossesWallFaces");
        }
        return api;
    }

    function getPathfindingLayerBounds() {
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
            throw new Error("NPC movement lab pathfinding node layer requires finite wall bounds");
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
            throw new Error("NPC movement lab pathfinding passability requires a finite node");
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
                throw new Error("NPC movement lab pathfinding passability requires finite wall normals");
            }
            const signed = (node.x - wall.ax) * nx + (node.y - wall.ay) * ny;
            if (signed < TARGET_RADIUS) return false;
        }
        return true;
    }

    function addDirectionalBlock(node, direction, blocker) {
        if (!node || !Number.isInteger(direction) || direction < 0 || direction > 11) {
            throw new Error("NPC movement lab pathfinding block requires a valid node direction");
        }
        if (!node.neighbors[direction]) {
            throw new Error("NPC movement lab pathfinding block requires an existing neighbor connection");
        }
        if (!node.blockedNeighbors.has(direction)) node.blockedNeighbors.set(direction, new Set());
        node.blockedNeighbors.get(direction).add(blocker);
    }

    function drawPathfindingNodeLayer() {
        const layer = state.nodeLayer;
        if (!layer.ctx) throw new Error("NPC movement lab pathfinding node layer requires a 2D context");
        if (
            layer.dirty ||
            layer.width !== state.view.width ||
            layer.height !== state.view.height ||
            Math.abs(layer.scale - state.view.scale) > 0.001 ||
            Math.abs(layer.offsetX - state.view.offsetX) > 0.001 ||
            Math.abs(layer.offsetY - state.view.offsetY) > 0.001 ||
            layer.renderedVersion !== layer.version ||
            layer.renderedShowPathBlockedEdges !== state.debug.showPathBlockedEdges
        ) {
            rebuildPathfindingNodeRenderLayer();
        }
        ctx.drawImage(layer.canvas, 0, 0);
    }

    function rebuildPathfindingNodeRenderLayer() {
        const layer = state.nodeLayer;
        if (!layer.ctx) throw new Error("NPC movement lab pathfinding node layer requires a 2D context");
        if (!(state.view.width > 0 && state.view.height > 0 && state.view.scale > 0)) {
            throw new Error("NPC movement lab pathfinding node layer requires a valid viewport");
        }

        layer.width = state.view.width;
        layer.height = state.view.height;
        layer.scale = state.view.scale;
        layer.offsetX = state.view.offsetX;
        layer.offsetY = state.view.offsetY;
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
        ctx.save();
        ctx.strokeStyle = flash > 0 ? "#ff4d4d" : "#58d27b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(point.x, point.y, TARGET_RADIUS * state.view.scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = flash > 0
            ? `rgba(255,77,77,${0.25 + flash * 0.45})`
            : "rgba(88,210,123,0.28)";
        ctx.beginPath();
        ctx.arc(point.x, point.y, TARGET_RADIUS * state.view.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
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
        if (agent.pathMode === PATH_MODE_WORKER) return "#b48cff";
        if (agent.solverState === STATE_ATTACKING) return "#58d27b";
        if (agent.solverState === STATE_SEEKING) return "#b48cff";
        if (agent.solverState === STATE_RECOVERING) return "#ff9f5a";
        if (agent.solverState === STATE_VACATING) return "#ff6fb1";
        if (agent.solverState === STATE_HOLDING) return "#ffd166";
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
            x: (screenX - state.view.offsetX) / state.view.scale,
            y: (screenY - state.view.offsetY) / state.view.scale
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
        console.groupCollapsed(`NPC movement lab agent ${agent.id} pathfinding`);
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
        if (!best) throw new Error("NPC movement lab wall tool could not resolve nearest hex node");
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
        updateTargetKeyboardMovement(dt);
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
    window.addEventListener("keydown", (event) => {
        if (event.key === "b" || event.key === "B") {
            state.wallTool.active = true;
            return;
        }
        if (event.key === "Shift") {
            state.fastMovementHeld = true;
            return;
        }
        if (!TARGET_MOVEMENT_KEYS[event.key]) return;
        event.preventDefault();
        state.fastMovementHeld = event.shiftKey;
        state.pressedMovementKeys[event.key] = true;
    });
    window.addEventListener("keyup", (event) => {
        if (event.key === "b" || event.key === "B") {
            state.wallTool.active = false;
            cancelWallBuildDrag();
            return;
        }
        if (event.key === "Shift") {
            state.fastMovementHeld = false;
            return;
        }
        if (!TARGET_MOVEMENT_KEYS[event.key]) return;
        event.preventDefault();
        delete state.pressedMovementKeys[event.key];
    });
    window.addEventListener("blur", () => {
        state.pressedMovementKeys = Object.create(null);
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
