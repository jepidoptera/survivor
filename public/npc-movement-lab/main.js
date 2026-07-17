(function () {
    "use strict";

    const STRIDE = 14;
    const OUT_STRIDE = 14;
    const STATE_MILLING = 1;
    const STATE_WAITING = 2;
    const STATE_ATTACKING = 3;
    const STATE_RETREATING = 5;
    const STATE_BLOCKED = 6;
    const PHASE_MILLING = 0;
    const AGENT_RADIUS = 0.42;
    const TARGET_RADIUS = AGENT_RADIUS;
    const COMBAT_RING_RADIUS = 1.6;
    const TARGET_KEYBOARD_MOVE_SPEED = 5.67;
    const TARGET_KEYBOARD_FAST_MOVE_SPEED = 14.49;
    const TARGET_NPC_PUSH_ITERATIONS = 12;
    const TARGET_NPC_PUSH_SLOP = 0.0005;
    const TARGET_NPC_PUSH_PLAYER_SHARE = 0.38;
    const TARGET_NPC_PUSH_MIN_AXIS = 0.0001;
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
        view: { width: 0, height: 0, dpr: 1, scale: 1, offsetX: 0, offsetY: 0 }
    };
    window.__npcMovementLabDebug = state;

    const worker = new Worker("/npc-movement-lab/solverWorker.js?v=npc-movement-lab-31");
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", (event) => {
        labels.workerStatus.textContent = event.message || "failed";
    });

    function updateControlLabels() {
        labels.agentCount.textContent = agentCountInput.value;
        labels.separationStrength.textContent = Number(separationInput.value).toFixed(1);
        labels.speedScale.textContent = Number(speedScaleInput.value).toFixed(1);
    }

    function addWall(walls, ax, ay, bx, by, nx, ny) {
        const len = Math.hypot(nx, ny);
        if (!(len > 0)) throw new Error("wall normal must be non-zero");
        walls.push({ ax, ay, bx, by, nx: nx / len, ny: ny / len });
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
            millingDirection: (id % 2) === 0 ? 1 : -1,
            millingWallTurnLock: 0,
            solverState: STATE_MILLING,
            wallClamps: 0
        });
    }

    function enforceInitialWallConstraints() {
        for (const agent of state.agents) {
            for (let pass = 0; pass < 4; pass++) {
                for (const wall of state.walls) {
                    const signed = (agent.x - wall.ax) * wall.nx + (agent.y - wall.ay) * wall.ny;
                    if (signed < agent.radius) {
                        const correction = agent.radius - signed;
                        agent.x += wall.nx * correction;
                        agent.y += wall.ny * correction;
                    }
                }
            }
        }
    }

    function constrainTargetToWalls() {
        const targetRadius = TARGET_RADIUS;
        for (let pass = 0; pass < 4; pass++) {
            for (const wall of state.walls) {
                const signed = (state.target.x - wall.ax) * wall.nx + (state.target.y - wall.ay) * wall.ny;
                if (signed < targetRadius) {
                    const correction = targetRadius - signed;
                    state.target.x += wall.nx * correction;
                    state.target.y += wall.ny * correction;
                }
            }
        }
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
        state.target.x = desiredX;
        state.target.y = desiredY;
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
            if (!changed) break;
        }
        assertTargetNpcSeparation();
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
            agent.vx = agent.x - previousAgentX;
            agent.vy = agent.y - previousAgentY;
            return { changed: true };
        }
        return { changed: false };
    }

    function constrainAgentToWalls(agent) {
        for (let pass = 0; pass < 4; pass++) {
            let changed = false;
            for (const wall of state.walls) {
                const signed = (agent.x - wall.ax) * wall.nx + (agent.y - wall.ay) * wall.ny;
                if (signed < agent.radius) {
                    const correction = agent.radius - signed;
                    agent.x += wall.nx * correction;
                    agent.y += wall.ny * correction;
                    changed = true;
                }
            }
            if (!changed) break;
        }
    }

    function assertTargetNpcSeparation() {
        for (const agent of state.agents) {
            const minDistance = TARGET_RADIUS + agent.radius - TARGET_NPC_PUSH_SLOP * 4;
            const distance = Math.hypot(agent.x - state.target.x, agent.y - state.target.y);
            if (distance < minDistance) {
                throw new Error(`NPC movement lab target collision unresolved for agent ${agent.id}`);
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
        }
        return packed;
    }

    function packWalls() {
        const packed = new Float32Array(state.walls.length * 6);
        for (let i = 0; i < state.walls.length; i++) {
            const wall = state.walls[i];
            const base = i * 6;
            packed[base] = wall.ax;
            packed[base + 1] = wall.ay;
            packed[base + 2] = wall.bx;
            packed[base + 3] = wall.by;
            packed[base + 4] = wall.nx;
            packed[base + 5] = wall.ny;
        }
        return packed;
    }

    function requestStep(dt) {
        if (state.waitingForWorker) return;
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
                speedScale: Number(speedScaleInput.value),
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
            agent.waitTime = agent.solverState === STATE_WAITING
                ? agent.waitTime + 1 / 60
                : Math.max(0, agent.waitTime - 0.12);
        }
    }

    function updateStats() {
        const stats = state.stats || {};
        labels.solveMs.textContent = `${Number(stats.solveMs || 0).toFixed(2)} ms`;
        labels.pairChecks.textContent = String(stats.pairChecks || 0);
        labels.movingCount.textContent = String(stats.moving || stats.milling || 0);
        labels.waitingCount.textContent = String(stats.waiting || 0);
        labels.attackingCount.textContent = String(stats.attacking || 0);
        labels.retreatingCount.textContent = String(stats.retreating || 0);
        labels.blockedCount.textContent = String(stats.blocked || 0);
        labels.wallLeaks.textContent = String(stats.wallLeaks || 0);
    }

    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const width = Math.max(1, Math.floor(rect.width * dpr));
        const height = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        state.view.width = width;
        state.view.height = height;
        state.view.dpr = dpr;
        state.view.scale = Math.min(width / 42, height / 29);
        state.view.offsetX = width / 2;
        state.view.offsetY = height / 2;
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
        drawWalls();
        drawTarget();
        drawCombatRing();
        drawAgents();
    }

    function drawWalls() {
        ctx.save();
        ctx.lineWidth = Math.max(2, state.view.scale * 0.08);
        ctx.strokeStyle = "#d9e4ea";
        ctx.lineCap = "round";
        for (const wall of state.walls) {
            const a = worldToScreen(wall.ax, wall.ay);
            const b = worldToScreen(wall.bx, wall.by);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
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
        if (agent.solverState === STATE_ATTACKING) return "#58d27b";
        if (agent.solverState === STATE_RETREATING) return "#ff9f5a";
        if (agent.solverState === STATE_WAITING) return "#ffd166";
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
            if (input === agentCountInput) createScenario();
        });
    }
    window.addEventListener("keydown", (event) => {
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
    });
    window.addEventListener("resize", resizeCanvas);

    updateControlLabels();
    createScenario();
    updateStats();
    requestAnimationFrame(tick);
})();
