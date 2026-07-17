"use strict";

const STRIDE = 14;
const OUT_STRIDE = 14;
const STATE_MILLING = 1;
const STATE_WAITING = 2;
const STATE_ATTACKING = 3;
const STATE_RETREATING = 5;
const STATE_BLOCKED = 6;
const PHASE_MILLING = 0;
const PHASE_ATTACKING = 1;
const PHASE_RETREATING = 2;
const PHASE_WAITING = 3;
const EPSILON = 0.000001;
const MILLING_WALL_TURN_LOCK_SECONDS = 0.75;

self.postMessage({ type: "ready" });

self.addEventListener("message", (event) => {
    const message = event && event.data ? event.data : null;
    if (!message || message.type !== "step") return;
    try {
        const result = solveStep(message);
        self.postMessage(result, [result.agents.buffer]);
    } catch (error) {
        self.postMessage({
            type: "error",
            requestId: message.requestId,
            message: error && error.message ? error.message : String(error)
        });
    }
});

function finiteNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
    return number;
}

function validatePackedLength(array, stride, label) {
    if (!(array instanceof Float32Array)) throw new Error(`${label} must be a Float32Array`);
    if (array.length % stride !== 0) throw new Error(`${label} length is not divisible by ${stride}`);
}

function solveStep(message) {
    const start = performance.now();
    const agents = message.agents;
    const walls = message.walls;
    validatePackedLength(agents, STRIDE, "agents");
    validatePackedLength(walls, 6, "walls");

    const count = agents.length / STRIDE;
    const next = new Float32Array(count * OUT_STRIDE);
    const dt = Math.min(0.05, Math.max(0.001, finiteNumber(message.dt, "dt")));
    const params = message.params || {};
    const targetX = finiteNumber(params.targetX, "targetX");
    const targetY = finiteNumber(params.targetY, "targetY");
    const targetRadius = Math.max(0.1, finiteNumber(params.targetRadius, "targetRadius"));
    const ringRadius = Math.max(0.5, finiteNumber(params.ringRadius, "ringRadius"));
    const separationStrength = Math.max(0, finiteNumber(params.separationStrength, "separationStrength"));
    const speedScale = Math.max(0, finiteNumber(params.speedScale, "speedScale"));
    const targetMoved = params.targetMoved === true;

    const slotChoices = buildSlotChoices(agents, count, targetX, targetY, ringRadius, walls);
    const attackSlotLimit = Math.max(1, countUsableRingSlots(agents, count, targetX, targetY, ringRadius, walls));
    const maxAttackers = attackSlotLimit;
    const attackSlots = selectDesignatedAttackers(agents, count, maxAttackers, targetX, targetY, ringRadius, targetMoved);
    const ringSlots = selectRingSlots(agents, count, targetX, targetY, ringRadius, walls, attackSlots);
    let pairChecks = 0;
    let wallClamps = 0;
    let wallLeaks = 0;
    let milling = 0;
    let waiting = 0;
    let attacking = 0;
    let retreating = 0;
    let blocked = 0;
    let hits = 0;

    for (let i = 0; i < count; i++) {
        const base = i * STRIDE;
        const outBase = i * OUT_STRIDE;
        const id = agents[base];
        const x = agents[base + 1];
        const y = agents[base + 2];
        const radius = agents[base + 3];
        const speed = agents[base + 4] * speedScale;
        const priority = agents[base + 5];
        const waitTime = agents[base + 6];
        const phase = Math.max(0, Math.floor(agents[base + 7]));
        const phaseTime = Math.max(0, agents[base + 8]);
        const homeAngle = agents[base + 9];
        const storedCooldown = Number.isFinite(agents[base + 10]) ? agents[base + 10] : 0;
        const heading = Number.isFinite(agents[base + 11]) ? agents[base + 11] : homeAngle;
        const millingDirection = agents[base + 12] >= 0 ? 1 : -1;
        const millingWallTurnLock = Math.max(0, Number.isFinite(agents[base + 13]) ? agents[base + 13] : 0);
        let nextMillingDirection = millingDirection;
        let nextMillingWallTurnLock = Math.max(0, millingWallTurnLock - dt);

        let desiredX = 0;
        let desiredY = 0;
        let state = STATE_MILLING;
        let nextPhase = phase;
        let nextPhaseTime = phaseTime + dt;
        const isDesignatedAttacker = attackSlots.has(i);
        const cooldown = isDesignatedAttacker && storedCooldown >= 0
            ? 0
            : (storedCooldown < 0 ? Math.max(0, -storedCooldown - 1) : Math.max(0, storedCooldown));
        const remainingCooldown = Math.max(0, cooldown - dt);
        let nextCooldown = isDesignatedAttacker ? -(remainingCooldown + 1) : remainingCooldown;
        const toTargetX = targetX - x;
        const toTargetY = targetY - y;
        const targetDist = Math.hypot(toTargetX, toTargetY);
        const ownsRingSlot = ringSlots.has(i);
        const slotChoice = ringSlots.get(i)
            || (ownsRingSlot ? slotChoices[i] : chooseMillingSlot(targetX, targetY, ringRadius, homeAngle, radius))
            || chooseMillingSlot(targetX, targetY, ringRadius, homeAngle, radius);
        const slotPoint = slotChoice.point;
        const slotDx = slotPoint.x - x;
        const slotDy = slotPoint.y - y;
        const slotDist = Math.hypot(slotDx, slotDy);
        let movementGoalX = slotPoint.x;
        let movementGoalY = slotPoint.y;
        const touchDistance = targetRadius + radius;
        const touchingTarget = targetDist <= touchDistance;
        const canHoldWaitingSlot = slotDist <= Math.max(radius * 0.08, speed * dt * 0.25);

        if (phase === PHASE_ATTACKING) {
            state = STATE_ATTACKING;
            attacking += 1;
            desiredX += toTargetX;
            desiredY += toTargetY;
            if (touchingTarget || phaseTime > 1.2) {
                nextPhase = PHASE_RETREATING;
                nextPhaseTime = 0;
            }
        } else if (phase === PHASE_RETREATING && ownsRingSlot) {
            state = STATE_RETREATING;
            retreating += 1;
            desiredX += slotDx;
            desiredY += slotDy;
            if (targetDist >= ringRadius) {
                nextPhase = PHASE_WAITING;
                nextPhaseTime = 0;
                const resetCooldown = 0.7 + (id % 5) * 0.08;
                nextCooldown = isDesignatedAttacker ? -(resetCooldown + 1) : resetCooldown;
            }
        } else {
            if (isDesignatedAttacker && remainingCooldown <= 0 && targetDist <= ringRadius + radius * 0.35) {
                nextPhase = PHASE_ATTACKING;
                nextPhaseTime = 0;
                state = STATE_ATTACKING;
                attacking += 1;
                desiredX += toTargetX;
                desiredY += toTargetY;
            } else if (ownsRingSlot && canHoldWaitingSlot) {
                nextPhase = PHASE_WAITING;
                state = STATE_WAITING;
                waiting += 1;
                desiredX = 0;
                desiredY = 0;
                nextPhaseTime = 0;
            } else if (ownsRingSlot) {
                nextPhase = PHASE_RETREATING;
                state = STATE_RETREATING;
                retreating += 1;
                desiredX += slotDx;
                desiredY += slotDy;
            } else {
                nextPhase = PHASE_MILLING;
                const loopRadius = ringRadius + radius * 2.25;
                const clearOrbitRadius = ringRadius + radius * 0.9;
                if (targetDist < clearOrbitRadius) {
                    const escape = computeTargetEscapeVector(x, y, targetX, targetY, homeAngle, clearOrbitRadius);
                    desiredX += escape.x;
                    desiredY += escape.y;
                    movementGoalX = escape.goalX;
                    movementGoalY = escape.goalY;
                } else {
                    const millingVector = computeMillingLoopVector(
                        x,
                        y,
                        targetX,
                        targetY,
                        loopRadius,
                        millingDirection
                    );
                    desiredX += millingVector.x;
                    desiredY += millingVector.y;
                    movementGoalX = x + millingVector.x;
                    movementGoalY = y + millingVector.y;
                }
                state = STATE_MILLING;
                milling += 1;
            }
        }

        if (state !== STATE_WAITING) {
            const goalX = state === STATE_ATTACKING ? targetX : movementGoalX;
            const goalY = state === STATE_ATTACKING ? targetY : movementGoalY;
            const detour = computeWallDetour(x, y, goalX, goalY, radius, walls);
            if (detour) {
                const currentDesiredLen = Math.hypot(desiredX, desiredY);
                const weight = Math.max(radius * 2.8, Math.min(ringRadius, currentDesiredLen || radius * 2));
                desiredX += detour.x * weight;
                desiredY += detour.y * weight;
            }
        }

        if (!ownsRingSlot) {
            const separation = computeSeparation(agents, count, i, x, y, radius, priority, {
                overlapOnly: false
            });
            pairChecks += separation.checks;
            desiredX += separation.x * separationStrength;
            desiredY += separation.y * separationStrength;
        }

        let len = Math.hypot(desiredX, desiredY);
        let vx = 0;
        let vy = 0;
        let nextHeading = heading;
        if (state === STATE_WAITING) {
            nextHeading = rotateTowardAngle(heading, Math.atan2(toTargetY, toTargetX), Math.PI * 2 * dt);
        } else if (state === STATE_ATTACKING) {
            nextHeading = Math.atan2(toTargetY, toTargetX);
            vx = Math.cos(nextHeading) * speed * 1.8;
            vy = Math.sin(nextHeading) * speed * 1.8;
        } else if (state === STATE_RETREATING) {
            const retreatHeading = Math.atan2(desiredY, desiredX);
            nextHeading = Math.atan2(toTargetY, toTargetX);
            if (len > EPSILON) {
                vx = Math.cos(retreatHeading) * speed * 1.45;
                vy = Math.sin(retreatHeading) * speed * 1.45;
            }
        } else if (state !== STATE_ATTACKING && state !== STATE_RETREATING && targetDist < ringRadius) {
            nextHeading = targetDist > EPSILON ? Math.atan2(y - targetY, x - targetX) : 0;
            vx = Math.cos(nextHeading) * speed;
            vy = Math.sin(nextHeading) * speed;
        } else if (len > EPSILON) {
            const phaseSpeed = speed;
            const desiredHeading = Math.atan2(desiredY, desiredX);
            nextHeading = rotateTowardAngle(heading, desiredHeading, Math.PI * 2 * dt);
            const turnDelta = Math.abs(shortestAngleDelta(heading, desiredHeading));
            const turnSpeedScale = Math.max(0.35, Math.cos(Math.min(Math.PI / 2, turnDelta)));
            vx = Math.cos(nextHeading) * phaseSpeed * turnSpeedScale;
            vy = Math.sin(nextHeading) * phaseSpeed * turnSpeedScale;
        }

        let candidateX = x + vx * dt;
        let candidateY = y + vy * dt;
        if (state === STATE_ATTACKING) {
            const contact = clampDartToTargetContact(x, y, candidateX, candidateY, targetX, targetY, touchDistance);
            candidateX = contact.x;
            candidateY = contact.y;
            if (contact.touched) {
                nextPhase = PHASE_RETREATING;
                nextPhaseTime = 0;
                hits += 1;
            }
        } else if (state !== STATE_RETREATING) {
            const outsideRing = clampOutsideTargetRing(x, y, candidateX, candidateY, targetX, targetY, ringRadius);
            candidateX = outsideRing.x;
            candidateY = outsideRing.y;
        }
        const constrained = constrainToWalls(x, y, candidateX, candidateY, radius, walls);
        candidateX = constrained.x;
        candidateY = constrained.y;
        wallClamps += constrained.clamps;
        if (constrained.clamps > 0 && state === STATE_MILLING) {
            if (nextMillingWallTurnLock <= EPSILON) {
                nextMillingDirection = -millingDirection;
                nextMillingWallTurnLock = MILLING_WALL_TURN_LOCK_SECONDS;
            }
            state = STATE_BLOCKED;
            blocked += 1;
        }

        if (violatesWalls(candidateX, candidateY, radius, walls)) {
            wallLeaks += 1;
            throw new Error(`wall invariant violated for agent ${id}`);
        }

        next[outBase] = id;
        next[outBase + 1] = candidateX;
        next[outBase + 2] = candidateY;
        next[outBase + 3] = (candidateX - x) / dt;
        next[outBase + 4] = (candidateY - y) / dt;
        next[outBase + 5] = state;
        next[outBase + 6] = constrained.clamps;
        next[outBase + 7] = nextPhase;
        next[outBase + 8] = nextPhaseTime;
        next[outBase + 9] = nextCooldown;
        next[outBase + 10] = slotChoice.angle;
        next[outBase + 11] = nextHeading;
        next[outBase + 12] = nextMillingDirection;
        next[outBase + 13] = nextMillingWallTurnLock;
    }

    return {
        type: "step_result",
        requestId: message.requestId,
        worldVersion: message.worldVersion,
        agents: next,
        stats: {
            solveMs: performance.now() - start,
            pairChecks,
            wallClamps,
            wallLeaks,
            moving: milling,
            milling,
            waiting,
            darting: attacking,
            striking: 0,
            retreating,
            attacking,
            hits,
            blocked
        }
    };
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

function rotateTowardAngle(from, to, maxRadians) {
    const delta = shortestAngleDelta(from, to);
    if (Math.abs(delta) <= maxRadians) return normalizeAngle(to);
    return normalizeAngle(from + Math.sign(delta) * maxRadians);
}

function getRingSlotPoint(targetX, targetY, ringRadius, angle) {
    return {
        x: targetX + Math.cos(angle) * ringRadius,
        y: targetY + Math.sin(angle) * ringRadius
    };
}

function computeTargetEscapeVector(x, y, targetX, targetY, fallbackAngle, clearRadius) {
    const fromTargetX = x - targetX;
    const fromTargetY = y - targetY;
    const dist = Math.hypot(fromTargetX, fromTargetY);
    const radialX = dist > EPSILON ? fromTargetX / dist : Math.cos(fallbackAngle);
    const radialY = dist > EPSILON ? fromTargetY / dist : Math.sin(fallbackAngle);
    const goalX = targetX + radialX * clearRadius;
    const goalY = targetY + radialY * clearRadius;
    return {
        x: goalX - x,
        y: goalY - y,
        goalX,
        goalY
    };
}

function computeMillingLoopVector(x, y, targetX, targetY, loopRadius, direction) {
    const fromTargetX = x - targetX;
    const fromTargetY = y - targetY;
    let dist = Math.hypot(fromTargetX, fromTargetY);
    let radialX = 1;
    let radialY = 0;
    if (dist > EPSILON) {
        radialX = fromTargetX / dist;
        radialY = fromTargetY / dist;
    } else {
        dist = 0;
    }

    const sign = direction >= 0 ? 1 : -1;
    const tangentX = -radialY * sign;
    const tangentY = radialX * sign;
    const radialError = dist - loopRadius;
    const correction = Math.max(-2.5, Math.min(2.5, radialError));
    return {
        x: tangentX * loopRadius - radialX * correction * 1.8,
        y: tangentY * loopRadius - radialY * correction * 1.8
    };
}

function buildSlotChoices(agents, count, targetX, targetY, ringRadius, walls) {
    const choices = new Array(count);
    for (let i = 0; i < count; i++) {
        const base = i * STRIDE;
        choices[i] = chooseRingSlot(
            targetX,
            targetY,
            ringRadius,
            agents[base + 9],
            agents[base + 3],
            walls
        );
    }
    return choices;
}

function chooseRingSlot(targetX, targetY, ringRadius, homeAngle, radius, walls) {
    const minClearance = radius * 1.35;
    let best = null;
    const sampleOffsets = [
        0,
        1, -1,
        2, -2,
        3, -3,
        4, -4,
        5, -5,
        6, -6,
        7, -7,
        8
    ];
    for (let i = 0; i < sampleOffsets.length; i++) {
        const angle = homeAngle + sampleOffsets[i] * (Math.PI / 12);
        const point = getRingSlotPoint(targetX, targetY, ringRadius, angle);
        const clearance = wallClearance(point.x, point.y, walls);
        const usable = clearance >= minClearance;
        const angleCost = Math.abs(sampleOffsets[i]) * 0.18;
        const clearanceBonus = Math.min(3, clearance) * 0.35;
        const score = (usable ? 10 : 0) + clearanceBonus - angleCost;
        if (!best || score > best.score) {
            best = { point, angle, clearance, usable, score };
        }
    }
    if (!best) {
        const point = getRingSlotPoint(targetX, targetY, ringRadius, homeAngle);
        return { point, angle: homeAngle, clearance: wallClearance(point.x, point.y, walls), usable: false, score: -Infinity };
    }
    if (!best.usable) {
        const constrained = pushPointInsideWalls(best.point.x, best.point.y, minClearance, walls);
        best = {
            ...best,
            point: { x: constrained.x, y: constrained.y },
            clearance: wallClearance(constrained.x, constrained.y, walls)
        };
    }
    return best;
}

function chooseMillingSlot(targetX, targetY, ringRadius, homeAngle, radius) {
    const millingRadius = ringRadius + radius * 2;
    const point = getRingSlotPoint(targetX, targetY, millingRadius, homeAngle);
    return {
        point,
        angle: homeAngle,
        clearance: Infinity,
        usable: true,
        score: 0
    };
}

function wallClearance(x, y, walls) {
    let clearance = Infinity;
    for (let i = 0; i < walls.length; i += 6) {
        const ax = walls[i];
        const ay = walls[i + 1];
        const nx = walls[i + 4];
        const ny = walls[i + 5];
        clearance = Math.min(clearance, (x - ax) * nx + (y - ay) * ny);
    }
    return clearance;
}

function pushPointInsideWalls(x, y, radius, walls) {
    let outX = x;
    let outY = y;
    for (let pass = 0; pass < 4; pass++) {
        let changed = false;
        for (let i = 0; i < walls.length; i += 6) {
            const ax = walls[i];
            const ay = walls[i + 1];
            const nx = walls[i + 4];
            const ny = walls[i + 5];
            const signed = (outX - ax) * nx + (outY - ay) * ny;
            if (signed < radius) {
                const correction = radius - signed;
                outX += nx * correction;
                outY += ny * correction;
                changed = true;
            }
        }
        if (!changed) break;
    }
    return { x: outX, y: outY };
}

function countUsableRingSlots(agents, count, targetX, targetY, ringRadius, walls) {
    let maxRadius = 0;
    for (let i = 0; i < count; i++) {
        maxRadius = Math.max(maxRadius, agents[i * STRIDE + 3]);
    }
    if (maxRadius <= EPSILON) return 0;
    const circumference = Math.max(ringRadius * Math.PI * 2, EPSILON);
    const slotCount = Math.max(1, Math.floor(circumference / (maxRadius * 2)));
    let usable = 0;
    for (let i = 0; i < slotCount; i++) {
        const angle = i / slotCount * Math.PI * 2;
        const point = getRingSlotPoint(targetX, targetY, ringRadius, angle);
        if (wallClearance(point.x, point.y, walls) >= maxRadius * 1.35) usable += 1;
    }
    return usable;
}

function selectRingSlots(agents, count, targetX, targetY, ringRadius, walls, attackSlots) {
    const candidates = [];
    let maxRadius = 0;
    for (let i = 0; i < count; i++) {
        const base = i * STRIDE;
        const phase = Math.max(0, Math.floor(agents[base + 7]));
        const phaseTime = Math.max(0, agents[base + 8]);
        const radius = agents[base + 3];
        const x = agents[base + 1];
        const y = agents[base + 2];

        const targetDist = Math.hypot(targetX - x, targetY - y);
        maxRadius = Math.max(maxRadius, radius);
        const isDesignatedAttacker = attackSlots.has(i);
        const isInsideRetreater = phase === PHASE_RETREATING && targetDist < ringRadius;
        if (!isDesignatedAttacker && !isInsideRetreater) continue;

        const currentAngle = targetDist > EPSILON ? Math.atan2(y - targetY, x - targetX) : agents[base + 9];
        candidates.push({
            index: i,
            phase,
            radius,
            x,
            y,
            targetDist,
            phaseTime,
            currentAngle,
            homeAngle: agents[base + 9],
            isDesignatedAttacker,
            isInsideRetreater,
            isActiveRingAgent: targetDist <= ringRadius * 2.2
                && (phase === PHASE_ATTACKING
                    || phase === PHASE_WAITING
                    || isDesignatedAttacker
                    || (phase === PHASE_RETREATING && (phaseTime <= 2 || targetDist <= ringRadius + radius * 1.2)))
        });
    }

    if (maxRadius <= EPSILON) return new Map();
    const circumference = Math.max(ringRadius * Math.PI * 2, EPSILON);
    const slotCount = Math.max(1, Math.floor(circumference / (maxRadius * 2)));
    const slots = [];
    for (let i = 0; i < slotCount; i++) {
        const angle = i / slotCount * Math.PI * 2;
        const point = getRingSlotPoint(targetX, targetY, ringRadius, angle);
        const clearance = wallClearance(point.x, point.y, walls);
        if (clearance >= maxRadius * 1.35) {
            slots.push({ angle, point, clearance });
        }
    }
    if (slots.length === 0) return new Map();

    candidates.sort((a, b) => {
        const priorityDelta = ringClaimPriority(a.phase, a.isDesignatedAttacker, a.isActiveRingAgent, a.isInsideRetreater)
            - ringClaimPriority(b.phase, b.isDesignatedAttacker, b.isActiveRingAgent, b.isInsideRetreater);
        if (priorityDelta !== 0) return priorityDelta;
        if (a.isActiveRingAgent || b.isActiveRingAgent) {
            const angleDelta = Math.abs(shortestAngleDelta(a.homeAngle, a.currentAngle))
                - Math.abs(shortestAngleDelta(b.homeAngle, b.currentAngle));
            if (Math.abs(angleDelta) > EPSILON) return angleDelta;
        }
        return a.targetDist - b.targetDist;
    });

    const assignedCandidates = candidates.slice(0, slots.length);
    const assignment = minimizeRingSlotMovement(assignedCandidates, slots, ringRadius);
    const selected = new Map();
    for (let i = 0; i < assignedCandidates.length; i++) {
        const candidate = assignedCandidates[i];
        const slot = slots[assignment[i]];
        if (!slot) continue;
        selected.set(candidate.index, {
            point: slot.point,
            angle: slot.angle,
            clearance: slot.clearance,
            usable: true,
            score: -ringSlotMovementCost(candidate, slot, ringRadius)
        });
    }
    return selected;
}

function minimizeRingSlotMovement(candidates, slots, ringRadius) {
    const candidateCount = candidates.length;
    const slotCount = slots.length;
    if (candidateCount === 0) return [];
    const stateCount = 1 << slotCount;
    let costs = new Float64Array(stateCount);
    const parentMasksByLayer = [];
    const parentSlotsByLayer = [];
    costs.fill(Infinity);
    costs[0] = 0;

    for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex++) {
        const nextCosts = new Float64Array(stateCount);
        const nextParents = new Int32Array(stateCount);
        const nextParentSlots = new Int16Array(stateCount);
        nextCosts.fill(Infinity);
        nextParents.fill(-1);
        nextParentSlots.fill(-1);
        for (let mask = 0; mask < stateCount; mask++) {
            if (!Number.isFinite(costs[mask]) || bitCount(mask) !== candidateIndex) continue;
            for (let slotIndex = 0; slotIndex < slotCount; slotIndex++) {
                const slotBit = 1 << slotIndex;
                if ((mask & slotBit) !== 0) continue;
                const nextMask = mask | slotBit;
                const cost = costs[mask] + ringSlotMovementCost(candidates[candidateIndex], slots[slotIndex], ringRadius);
                if (cost < nextCosts[nextMask]) {
                    nextCosts[nextMask] = cost;
                    nextParents[nextMask] = mask;
                    nextParentSlots[nextMask] = slotIndex;
                }
            }
        }
        parentMasksByLayer.push(nextParents);
        parentSlotsByLayer.push(nextParentSlots);
        costs = nextCosts;
    }

    let bestMask = -1;
    let bestCost = Infinity;
    for (let mask = 0; mask < stateCount; mask++) {
        if (bitCount(mask) !== candidateCount) continue;
        if (costs[mask] < bestCost) {
            bestCost = costs[mask];
            bestMask = mask;
        }
    }
    if (bestMask < 0) throw new Error("ring slot assignment failed");

    const assignment = new Array(candidateCount);
    let mask = bestMask;
    for (let candidateIndex = candidateCount - 1; candidateIndex >= 0; candidateIndex--) {
        const slotIndex = parentSlotsByLayer[candidateIndex][mask];
        assignment[candidateIndex] = slotIndex;
        mask = parentMasksByLayer[candidateIndex][mask];
    }
    return assignment;
}

function ringSlotMovementCost(candidate, slot, ringRadius) {
    const angleCost = Math.abs(shortestAngleDelta(candidate.currentAngle, slot.angle)) * ringRadius;
    const distanceCost = Math.hypot(slot.point.x - candidate.x, slot.point.y - candidate.y);
    const previousSlotWeight = candidate.isActiveRingAgent ? 1.4 : 0.18;
    const previousSlotCost = Math.abs(shortestAngleDelta(candidate.homeAngle, slot.angle)) * ringRadius * previousSlotWeight;
    return angleCost * 0.45 + distanceCost * 0.12 + previousSlotCost;
}

function bitCount(value) {
    let count = 0;
    let remaining = value;
    while (remaining) {
        remaining &= remaining - 1;
        count += 1;
    }
    return count;
}

function ringClaimPriority(phase, isDesignatedAttacker, isActiveRingAgent, isInsideRetreater) {
    if (isInsideRetreater) return 0;
    if (!isActiveRingAgent && !isDesignatedAttacker) return 3;
    if (phase === PHASE_ATTACKING || isDesignatedAttacker) return 1;
    if (phase === PHASE_RETREATING) return 2;
    if (phase === PHASE_WAITING) return 3;
    return 3;
}

function selectDesignatedAttackers(agents, count, maxAttackers, targetX, targetY, ringRadius, targetMoved) {
    const candidates = [];
    let activeAttackers = 0;
    const selected = new Set();
    for (let i = 0; i < count; i++) {
        const base = i * STRIDE;
        const id = agents[base];
        const waitTime = agents[base + 6];
        const phase = Math.max(0, Math.floor(agents[base + 7]));
        const cooldown = Number.isFinite(agents[base + 10]) ? agents[base + 10] : 0;
        const x = agents[base + 1];
        const y = agents[base + 2];
        const targetDist = Math.hypot(targetX - x, targetY - y);
        if (!targetMoved && phase === PHASE_ATTACKING) {
            activeAttackers += 1;
            if (selected.size < maxAttackers) selected.add(i);
            continue;
        }
        if (!targetMoved && cooldown < 0) {
            if (selected.size < maxAttackers) selected.add(i);
            continue;
        }
        if (phase === PHASE_RETREATING) continue;
        if (phase === PHASE_WAITING) {
            const stalePenalty = targetDist > ringRadius * 1.8 ? ringRadius * 4 : 0;
            candidates.push({ index: i, score: stalePenalty + targetDist * 0.25 - waitTime, id });
        } else if (targetDist <= ringRadius * 2.4) {
            candidates.push({ index: i, score: targetDist, id });
        }
    }
    candidates.sort((a, b) => a.score - b.score || a.id - b.id);
    const available = Math.max(0, maxAttackers - selected.size);
    let added = 0;
    for (let i = 0; i < candidates.length && added < available; i++) {
        selected.add(candidates[i].index);
        added += 1;
    }
    return selected;
}

function computeSeparation(agents, count, selfIndex, x, y, radius, priority, options = {}) {
    let sx = 0;
    let sy = 0;
    let checks = 0;
    const maxRange = radius * 4.5;
    const maxRangeSq = maxRange * maxRange;
    const overlapOnly = options.overlapOnly === true;
    for (let i = 0; i < count; i++) {
        if (i === selfIndex) continue;
        const base = i * STRIDE;
        const ox = agents[base + 1];
        const oy = agents[base + 2];
        const oradius = agents[base + 3];
        const dx = x - ox;
        const dy = y - oy;
        const distSq = dx * dx + dy * dy;
        if (distSq > maxRangeSq) continue;
        checks += 1;
        const dist = Math.max(0.001, Math.sqrt(distSq));
        const desired = radius + oradius;
        const activationDistance = overlapOnly ? desired * 1.02 : desired * 1.35;
        if (dist >= activationDistance) continue;
        const otherPriority = agents[base + 5];
        const priorityWeight = otherPriority > priority ? 1.25 : 0.75;
        const push = (activationDistance - dist) / activationDistance * priorityWeight;
        sx += dx / dist * push;
        sy += dy / dist * push;
    }
    return { x: sx, y: sy, checks };
}

function clampDartToTargetContact(previousX, previousY, x, y, targetX, targetY, touchDistance) {
    const previousDist = Math.hypot(previousX - targetX, previousY - targetY);
    const nextDist = Math.hypot(x - targetX, y - targetY);
    if (nextDist > touchDistance) return { x, y, touched: false };

    if (previousDist > touchDistance) {
        const moveX = x - previousX;
        const moveY = y - previousY;
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 20; i++) {
            const mid = (lo + hi) / 2;
            const px = previousX + moveX * mid;
            const py = previousY + moveY * mid;
            if (Math.hypot(px - targetX, py - targetY) <= touchDistance) {
                hi = mid;
            } else {
                lo = mid;
            }
        }
        return {
            x: previousX + moveX * hi,
            y: previousY + moveY * hi,
            touched: true
        };
    }

    const nx = previousDist > EPSILON ? (previousX - targetX) / previousDist : 1;
    const ny = previousDist > EPSILON ? (previousY - targetY) / previousDist : 0;
    return {
        x: targetX + nx * touchDistance,
        y: targetY + ny * touchDistance,
        touched: true
    };
}

function clampOutsideTargetRing(previousX, previousY, x, y, targetX, targetY, ringRadius) {
    const previousDist = Math.hypot(previousX - targetX, previousY - targetY);
    const nextDx = x - targetX;
    const nextDy = y - targetY;
    const nextDist = Math.hypot(nextDx, nextDy);
    if (ringRadius <= EPSILON || nextDist >= ringRadius || previousDist < ringRadius) return { x, y };
    if (nextDist <= EPSILON) return { x: targetX + ringRadius, y: targetY };
    const scale = ringRadius / nextDist;
    return {
        x: targetX + nextDx * scale,
        y: targetY + nextDy * scale
    };
}

function computeWallDetour(x, y, goalX, goalY, radius, walls) {
    const hit = findEarliestSegmentHit(x, y, goalX, goalY, radius, walls);
    if (!hit || hit.t >= 0.98) return null;

    const wallDx = hit.bx - hit.ax;
    const wallDy = hit.by - hit.ay;
    const wallLength = Math.hypot(wallDx, wallDy);
    if (wallLength <= EPSILON) return null;

    const tx = wallDx / wallLength;
    const ty = wallDy / wallLength;
    const aScore = Math.hypot(goalX - hit.ax, goalY - hit.ay) + Math.hypot(x - hit.ax, y - hit.ay) * 0.25;
    const bScore = Math.hypot(goalX - hit.bx, goalY - hit.by) + Math.hypot(x - hit.bx, y - hit.by) * 0.25;
    const sign = bScore < aScore ? 1 : -1;
    return { x: tx * sign, y: ty * sign };
}

function constrainToWalls(previousX, previousY, x, y, radius, walls) {
    let currentX = previousX;
    let currentY = previousY;
    let remainingX = x - previousX;
    let remainingY = y - previousY;
    let clamps = 0;

    for (let iteration = 0; iteration < 4; iteration++) {
        if (Math.hypot(remainingX, remainingY) <= EPSILON) break;
        const intendedX = currentX + remainingX;
        const intendedY = currentY + remainingY;
        const hit = findEarliestSegmentHit(currentX, currentY, intendedX, intendedY, radius, walls);
        if (!hit) {
            currentX = intendedX;
            currentY = intendedY;
            remainingX = 0;
            remainingY = 0;
            break;
        }

        clamps += 1;
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
    return { x: currentX, y: currentY, clamps };
}

function findEarliestSegmentHit(fromX, fromY, toX, toY, radius, walls) {
    let best = null;
    for (let i = 0; i < walls.length; i += 6) {
        const hit = sweptCircleSegmentHit(
            fromX,
            fromY,
            toX,
            toY,
            walls[i],
            walls[i + 1],
            walls[i + 2],
            walls[i + 3],
            radius
        );
        if (hit && (!best || hit.t < best.t)) {
            best = {
                ...hit,
                ax: walls[i],
                ay: walls[i + 1],
                bx: walls[i + 2],
                by: walls[i + 3]
            };
        }
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
    if (hi <= EPSILON) hi = 1;
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
    for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        if (!best || candidate.distance < best.distance) best = candidate;
    }
    return best;
}

function segmentIntersectionParameters(ax, ay, bx, by, cx, cy, dx, dy) {
    const rx = bx - ax;
    const ry = by - ay;
    const sx = dx - cx;
    const sy = dy - cy;
    const denominator = cross2d(rx, ry, sx, sy);
    if (Math.abs(denominator) <= EPSILON) return null;
    const qpx = cx - ax;
    const qpy = cy - ay;
    const t = cross2d(qpx, qpy, sx, sy) / denominator;
    const u = cross2d(qpx, qpy, rx, ry) / denominator;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { t, u };
}

function pointProjectionParameter(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= EPSILON) return 0;
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
    if (length > EPSILON) return { x: nx / length, y: ny / length };
    const wallDx = bx - ax;
    const wallDy = by - ay;
    const wallLength = Math.hypot(wallDx, wallDy);
    if (wallLength <= EPSILON) return { x: 1, y: 0 };
    return { x: -wallDy / wallLength, y: wallDx / wallLength };
}

function cross2d(ax, ay, bx, by) {
    return ax * by - ay * bx;
}

function violatesWalls(x, y, radius, walls) {
    for (let i = 0; i < walls.length; i += 6) {
        const ax = walls[i];
        const ay = walls[i + 1];
        const bx = walls[i + 2];
        const by = walls[i + 3];
        if (pointSegmentDistance(x, y, ax, ay, bx, by) < radius - 0.002) return true;
    }
    return false;
}
