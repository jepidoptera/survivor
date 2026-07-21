"use strict";

importScripts("/wizard-of-flatland/orcaSolver.js?v=wizard-of-flatland-1");

const STRIDE = 17;
const OUT_STRIDE = 14;
const WALL_STRIDE = 8;
const STATE_MILLING = 1;
const STATE_ATTACKING = 3;
const STATE_BLOCKED = 6;
const STATE_SEEKING = 7;
const STATE_HOLDING = 8;
const STATE_RECOVERING = 9;
const STATE_VACATING = 10;
const PHASE_MILLING = 0;
const PHASE_ATTACKING = 1;
const PHASE_RECOVERING = 2;
const PHASE_HOLDING = 3;
const PHASE_SEEKING = 4;
const PHASE_VACATING = 5;
const EPSILON = 0.000001;
const MILLING_WALL_TURN_LOCK_SECONDS = 0.75;
const RETREAT_MIN_OUTWARD_SPEED_SCALE = 1.15;
const ATTACK_LUNGE_SPEED_MULTIPLIER = 1.8;
const ATTACK_LUNGE_TIMEOUT_PADDING_SECONDS = 0.45;
const ATTACK_SLOT_RUN_SPEED_MULTIPLIER = 1.45;
const ATTACK_SLOT_ARRIVAL_RADIUS_SCALE = 0.22;
const ATTACK_READY_RANGE_RADIUS_SCALE = 1.25;
const VACATE_ATTACK_RING_CLEARANCE_SCALE = 0.65;
const VACATE_ATTACK_RING_RELEASE_SCALE = 1.75;
const RECOVER_ATTACK_RING_RELEASE_SCALE = 1.35;
const MILLING_SEPARATION_ACTIVATION_SCALE = 1.85;
const MILLING_SEPARATION_STRENGTH_SCALE = 1.55;
const MILLING_ROUTE_YIELD_PER_PRESSURE = 0.48;
const MILLING_ROUTE_MIN_YIELD = 0.24;
const SEEKING_SEPARATION_ACTIVATION_SCALE = 1.7;
const SEEKING_PATH_SEPARATION_STRENGTH_FLOOR = 0.85;
const SEEKING_ROUTE_YIELD_PER_PRESSURE = 0.36;
const SEEKING_ROUTE_MIN_YIELD = 0.38;
const MILLING_WALL_ESCAPE_CLEARANCE_SCALE = 1.35;
const MILLING_WALL_ESCAPE_STRENGTH = 4.8;
const MILLING_ORCA_TIME_HORIZON = 0.85;
const MILLING_ORCA_NEIGHBOR_DIST_SCALE = 7.5;
const MILLING_ORCA_MAX_NEIGHBORS = 16;
const CROWD_LOCK_ENTER_RADIUS_SCALE = 3.25;
const CROWD_LOCK_EXIT_RADIUS_SCALE = 4.1;
const CROWD_LOCK_FORWARD_RANGE_SCALE = 4.5;
const CROWD_LOCK_BACK_TOLERANCE_SCALE = 0.35;
const CROWD_LOCK_LANE_PADDING_SCALE = 0.35;
const MILLING_RING_FULL_ENTER_RADIUS_SCALE = 3.25;
const MILLING_RING_FULL_EXIT_RADIUS_SCALE = 4.1;
const MILLING_RING_OCCUPANCY_RADIUS_SCALE = 2.35;
const MILLING_PROPAGATION_FORWARD_RANGE_SCALE = 4.75;
const MILLING_PROPAGATION_LANE_PADDING_SCALE = 0.45;
const ATTACKER_SELECTION_NEARBY_RADIUS_SCALE = 2.8;
const ATTACKER_SELECTION_SPREAD_WEIGHT = 0.72;
const ATTACKER_SELECTION_RING_ERROR_WEIGHT = 0.45;
const ATTACKER_RING_SLIDE_STRENGTH = 1.35;
const ATTACKER_RING_SLIDE_ACTIVATION_SCALE = 2.8;
const ATTACKER_RING_SLIDE_MAX = 2.2;
const ATTACKER_RING_ENTRY_PRESSURE_OUTER_SCALE = 5.5;
const VACATING_LANE_YIELD_FORWARD_RANGE_SCALE = 8.5;
const VACATING_LANE_YIELD_LANE_PADDING_SCALE = 0.65;
const VACATING_LANE_YIELD_ROUTE_SCALE = 0.42;
const VACATING_LANE_YIELD_SIDE_STRENGTH = 3.4;
const VACATING_LANE_YIELD_OUTWARD_STRENGTH = 2.6;
const VACATING_SEPARATION_PUSH_MULTIPLIER = 100;
const WAITING_RING_SLIDE_SPEED_SCALE = 0.65;
const WALL_WORLD_THICKNESS = 0.3;
const WALL_WORLD_HALF_THICKNESS = WALL_WORLD_THICKNESS * 0.5;
const WALL_SLIDE_CLEARANCE_SCALE = 1.55;
const PATH_MODE_DIRECT = 0;
const PATH_MODE_WORKER = 1;

let cachedWalls = null;
let cachedWallsWorldVersion = 0;

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
    const walls = getStepWalls(message);
    validatePackedLength(agents, STRIDE, "agents");

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
    const attackSlots = selectAttackingNpcs(agents, count, targetX, targetY, ringRadius, walls, targetMoved);
    let pairChecks = 0;
    let wallClamps = 0;
    let wallLeaks = 0;
    let milling = 0;
    let seeking = 0;
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
        const baseSpeed = agents[base + 4];
        const speed = baseSpeed * speedScale;
        const attackSpeed = getAttackLungeSpeed(baseSpeed, speedScale);
        const priority = agents[base + 5];
        const waitTime = agents[base + 6];
        const phase = Math.max(0, Math.floor(agents[base + 7]));
        const phaseTime = Math.max(0, agents[base + 8]);
        const homeAngle = agents[base + 9];
        const storedCooldown = Number.isFinite(agents[base + 10]) ? agents[base + 10] : 0;
        const heading = Number.isFinite(agents[base + 11]) ? agents[base + 11] : homeAngle;
        const millingDirection = agents[base + 12] >= 0 ? 1 : -1;
        const millingWallTurnLock = Math.max(0, Number.isFinite(agents[base + 13]) ? agents[base + 13] : 0);
        const pathMode = Math.floor(agents[base + 14]) === PATH_MODE_WORKER ? PATH_MODE_WORKER : PATH_MODE_DIRECT;
        const pathGoalX = Number.isFinite(agents[base + 15]) ? agents[base + 15] : NaN;
        const pathGoalY = Number.isFinite(agents[base + 16]) ? agents[base + 16] : NaN;
        if (pathMode === PATH_MODE_WORKER && (!Number.isFinite(pathGoalX) || !Number.isFinite(pathGoalY))) {
            throw new Error(`pathfinding mode requires finite path goal for agent ${id}`);
        }
        const followingWorkerPath = pathMode === PATH_MODE_WORKER;
        let nextMillingDirection = millingDirection;
        let nextMillingWallTurnLock = Math.max(0, millingWallTurnLock - dt);

        let desiredX = 0;
        let desiredY = 0;
        let state = STATE_SEEKING;
        let nextPhase = phase;
        let nextPhaseTime = phaseTime + dt;
        let outerMillingCanReverseAtWall = false;
        const isDesignatedAttacker = attackSlots.has(i);
        const cooldown = isDesignatedAttacker && storedCooldown >= 0
            ? 0
            : (storedCooldown < 0 ? Math.max(0, -storedCooldown - 1) : Math.max(0, storedCooldown));
        const remainingCooldown = Math.max(0, cooldown - dt);
        let nextCooldown = isDesignatedAttacker ? -(remainingCooldown + 1) : remainingCooldown;
        const toTargetX = targetX - x;
        const toTargetY = targetY - y;
        const targetDist = Math.hypot(toTargetX, toTargetY);
        const ownsRingSlot = isDesignatedAttacker;
        const slotChoice = isDesignatedAttacker
            ? (slotChoices[i] || chooseMillingSlot(targetX, targetY, ringRadius, homeAngle, radius))
            : chooseMillingSlot(targetX, targetY, ringRadius, homeAngle, radius);
        const slotPoint = slotChoice.point;
        const slotDx = slotPoint.x - x;
        const slotDy = slotPoint.y - y;
        const slotDist = Math.hypot(slotDx, slotDy);
        let movementGoalX = slotPoint.x;
        let movementGoalY = slotPoint.y;
        const touchDistance = targetRadius + radius;
        const touchingTarget = targetDist <= touchDistance;
        const attackTimeoutSeconds = getAttackTimeoutSeconds(ringRadius, radius, touchDistance, attackSpeed);
        const canHoldWaitingSlot = slotDist <= Math.max(radius * ATTACK_SLOT_ARRIVAL_RADIUS_SCALE, speed * dt * 0.25);
        const canStartAttackFromHere = targetDist <= ringRadius + radius * ATTACK_READY_RANGE_RADIUS_SCALE;
        const vacateReleaseRadius = ringRadius + radius * VACATE_ATTACK_RING_RELEASE_SCALE;
        const recoverReleaseRadius = ringRadius + radius * RECOVER_ATTACK_RING_RELEASE_SCALE;
        const mustVacateRing = !isDesignatedAttacker && (targetDist < ringRadius || (phase === PHASE_VACATING && targetDist < vacateReleaseRadius));
        const mustRecover = phase === PHASE_RECOVERING && remainingCooldown > 0;
        const seekingGoalX = followingWorkerPath ? pathGoalX : slotPoint.x;
        const seekingGoalY = followingWorkerPath ? pathGoalY : slotPoint.y;
        const ringFullMilling = !isDesignatedAttacker && isTargetRingFullForMilling(
            agents,
            count,
            i,
            x,
            y,
            radius,
            targetX,
            targetY,
            targetDist,
            ringRadius,
            walls,
            phase === PHASE_MILLING
        );
        const millingPressure = !isDesignatedAttacker && isSeekingIntoMillingAgent(
            agents,
            count,
            i,
            x,
            y,
            radius,
            seekingGoalX,
            seekingGoalY,
            targetX,
            targetY
        );

        if (ringFullMilling || millingPressure) {
            nextPhase = PHASE_MILLING;
            state = STATE_MILLING;
            milling += 1;
            const millingIntent = computeTargetRingMillingIntent(
                x,
                y,
                radius,
                targetX,
                targetY,
                ringRadius,
                homeAngle,
                millingDirection
            );
            desiredX += millingIntent.x;
            desiredY += millingIntent.y;
            movementGoalX = millingIntent.goalX;
            movementGoalY = millingIntent.goalY;
            outerMillingCanReverseAtWall = millingIntent.canReverseAtWall;
        } else if (followingWorkerPath) {
            nextPhase = PHASE_SEEKING;
            state = STATE_SEEKING;
            seeking += 1;
            desiredX += pathGoalX - x;
            desiredY += pathGoalY - y;
            movementGoalX = pathGoalX;
            movementGoalY = pathGoalY;
        } else if (phase === PHASE_ATTACKING) {
            state = STATE_ATTACKING;
            attacking += 1;
            desiredX += toTargetX;
            desiredY += toTargetY;
            if (touchingTarget || phaseTime > attackTimeoutSeconds) {
                nextPhase = PHASE_RECOVERING;
                nextPhaseTime = 0;
                const resetCooldown = getAttackRecoveryCooldown(id);
                nextCooldown = isDesignatedAttacker ? -(resetCooldown + 1) : resetCooldown;
            }
        } else if (mustRecover) {
            nextPhase = PHASE_RECOVERING;
            state = STATE_RECOVERING;
            retreating += 1;
            const escape = computeTargetEscapeVector(x, y, targetX, targetY, homeAngle, recoverReleaseRadius);
            desiredX += escape.x;
            desiredY += escape.y;
            movementGoalX = escape.goalX;
            movementGoalY = escape.goalY;
        } else if (mustVacateRing) {
            nextPhase = PHASE_VACATING;
            state = STATE_VACATING;
            retreating += 1;
            const escape = computeTargetEscapeVector(x, y, targetX, targetY, homeAngle, vacateReleaseRadius);
            desiredX += escape.x;
            desiredY += escape.y;
            movementGoalX = escape.goalX;
            movementGoalY = escape.goalY;
        } else if (isDesignatedAttacker && remainingCooldown <= 0 && canStartAttackFromHere) {
            nextPhase = PHASE_ATTACKING;
            nextPhaseTime = 0;
            state = STATE_ATTACKING;
            attacking += 1;
            desiredX += toTargetX;
            desiredY += toTargetY;
        } else {
            if (isDesignatedAttacker && remainingCooldown <= 0 && canHoldWaitingSlot) {
                nextPhase = PHASE_ATTACKING;
                nextPhaseTime = 0;
                state = STATE_ATTACKING;
                attacking += 1;
                desiredX += toTargetX;
                desiredY += toTargetY;
            } else if (isDesignatedAttacker && ownsRingSlot && !canHoldWaitingSlot) {
                nextPhase = PHASE_SEEKING;
                state = STATE_SEEKING;
                seeking += 1;
                desiredX += slotDx;
                desiredY += slotDy;
            } else if (phase === PHASE_HOLDING && isDesignatedAttacker) {
                nextPhase = PHASE_HOLDING;
                state = STATE_HOLDING;
                waiting += 1;
                desiredX = 0;
                desiredY = 0;
                nextPhaseTime = 0;
            } else if (ownsRingSlot && canHoldWaitingSlot) {
                nextPhase = PHASE_HOLDING;
                state = STATE_HOLDING;
                waiting += 1;
                desiredX = 0;
                desiredY = 0;
                nextPhaseTime = 0;
            } else if (ownsRingSlot) {
                nextPhase = PHASE_SEEKING;
                state = STATE_SEEKING;
                seeking += 1;
                desiredX += slotDx;
                desiredY += slotDy;
            } else {
                const crowdLocked = isSeekingBlockedByCloseCrowd(
                    agents,
                    count,
                    i,
                    x,
                    y,
                    radius,
                    targetX,
                    targetY,
                    targetDist,
                    ringRadius,
                    phase === PHASE_MILLING
                );
                if (crowdLocked) {
                    nextPhase = PHASE_MILLING;
                    state = STATE_MILLING;
                    milling += 1;
                    const millingIntent = computeTargetRingMillingIntent(
                        x,
                        y,
                        radius,
                        targetX,
                        targetY,
                        ringRadius,
                        homeAngle,
                        millingDirection
                    );
                    desiredX += millingIntent.x;
                    desiredY += millingIntent.y;
                    movementGoalX = millingIntent.goalX;
                    movementGoalY = millingIntent.goalY;
                    outerMillingCanReverseAtWall = millingIntent.canReverseAtWall;
                } else {
                    nextPhase = PHASE_SEEKING;
                    state = STATE_SEEKING;
                    seeking += 1;
                    desiredX += slotDx;
                    desiredY += slotDy;
                }
            }
        }

        if (!followingWorkerPath && (state === STATE_HOLDING || state === STATE_SEEKING || state === STATE_RECOVERING)) {
            const slide = computeRingSlideVector(
                agents,
                count,
                i,
                x,
                y,
                radius,
                targetX,
                targetY,
                ringRadius,
                attackSlots
            );
            if (slide.pressure > 0) {
                desiredX += slide.x * ATTACKER_RING_SLIDE_STRENGTH;
                desiredY += slide.y * ATTACKER_RING_SLIDE_STRENGTH;
                movementGoalX = x + desiredX;
                movementGoalY = y + desiredY;
            }
        }

        if (
            outerMillingCanReverseAtWall &&
            nextMillingWallTurnLock <= EPSILON &&
            hasWallAheadAlongMillingIntent(x, y, desiredX, desiredY, radius, walls)
        ) {
            nextMillingDirection = -millingDirection;
            nextMillingWallTurnLock = MILLING_WALL_TURN_LOCK_SECONDS;
            const loopRadius = ringRadius + radius * 2.25;
            const reversedMillingVector = computeMillingLoopVector(
                x,
                y,
                targetX,
                targetY,
                loopRadius,
                nextMillingDirection
            );
            desiredX = reversedMillingVector.x;
            desiredY = reversedMillingVector.y;
            movementGoalX = x + reversedMillingVector.x;
            movementGoalY = y + reversedMillingVector.y;
        }

        if (state === STATE_MILLING) {
            const wallEscape = computeWallEscapeVector(x, y, radius, walls);
            if (wallEscape.pressure > 0) {
                if (nextMillingWallTurnLock <= EPSILON) {
                    nextMillingDirection = -millingDirection;
                    nextMillingWallTurnLock = MILLING_WALL_TURN_LOCK_SECONDS;
                }
                const routeYield = Math.max(
                    MILLING_ROUTE_MIN_YIELD,
                    1 - Math.min(1 - MILLING_ROUTE_MIN_YIELD, wallEscape.pressure)
                );
                desiredX = desiredX * routeYield + wallEscape.x * MILLING_WALL_ESCAPE_STRENGTH;
                desiredY = desiredY * routeYield + wallEscape.y * MILLING_WALL_ESCAPE_STRENGTH;
                movementGoalX = x + desiredX;
                movementGoalY = y + desiredY;
            }
        }

        if (state !== STATE_HOLDING && state !== STATE_MILLING) {
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

        if (state !== STATE_ATTACKING && state !== STATE_MILLING) {
            const isSeekingLike = state === STATE_SEEKING || followingWorkerPath;
            const separation = computeSeparation(agents, count, i, x, y, radius, priority, {
                overlapOnly: false,
                activationScale: state === STATE_MILLING
                    ? MILLING_SEPARATION_ACTIVATION_SCALE
                    : (isSeekingLike ? SEEKING_SEPARATION_ACTIVATION_SCALE : undefined)
            });
            pairChecks += separation.checks;
            if (separation.pressure > 0 && (state === STATE_MILLING || (isSeekingLike && !ownsRingSlot))) {
                const minYield = state === STATE_MILLING ? MILLING_ROUTE_MIN_YIELD : SEEKING_ROUTE_MIN_YIELD;
                const yieldPerPressure = state === STATE_MILLING ? MILLING_ROUTE_YIELD_PER_PRESSURE : SEEKING_ROUTE_YIELD_PER_PRESSURE;
                const routeYield = Math.max(
                    minYield,
                    1 - Math.min(1 - minYield, separation.pressure * yieldPerPressure)
                );
                desiredX *= routeYield;
                desiredY *= routeYield;
            }
            const separationBaseStrength = isSeekingLike
                ? (followingWorkerPath ? Math.max(separationStrength, SEEKING_PATH_SEPARATION_STRENGTH_FLOOR) : separationStrength)
                : separationStrength;
            const separationScale = separationBaseStrength * (state === STATE_MILLING ? MILLING_SEPARATION_STRENGTH_SCALE : 1);
            desiredX += separation.x * separationScale;
            desiredY += separation.y * separationScale;
        }
        if (state !== STATE_ATTACKING && state !== STATE_RECOVERING && state !== STATE_VACATING) {
            const vacatingYield = computeVacatingLaneYield(
                agents,
                count,
                i,
                x,
                y,
                radius,
                targetX,
                targetY,
                desiredX,
                desiredY
            );
            if (vacatingYield.pressure > 0) {
                desiredX = desiredX * VACATING_LANE_YIELD_ROUTE_SCALE + vacatingYield.x;
                desiredY = desiredY * VACATING_LANE_YIELD_ROUTE_SCALE + vacatingYield.y;
                movementGoalX = x + desiredX;
                movementGoalY = y + desiredY;
            }
        }

        if (state !== STATE_ATTACKING) {
            const wallSlide = projectVectorAlongNearbyWalls(x, y, radius, desiredX, desiredY, walls);
            desiredX = wallSlide.x;
            desiredY = wallSlide.y;
        }

        let len = Math.hypot(desiredX, desiredY);
        let vx = 0;
        let vy = 0;
        let nextHeading = heading;
        if (state === STATE_MILLING) {
            if (len > EPSILON) {
                const orcaVelocity = computeMillingOrcaVelocity(
                    agents,
                    count,
                    i,
                    desiredX,
                    desiredY,
                    targetX,
                    targetY,
                    ringRadius,
                    baseSpeed,
                    speedScale,
                    dt
                );
                vx = orcaVelocity.vx;
                vy = orcaVelocity.vy;
                const velocityLength = Math.hypot(vx, vy);
                const facingHeading = velocityLength > EPSILON ? Math.atan2(vy, vx) : Math.atan2(desiredY, desiredX);
                nextHeading = rotateTowardAngle(heading, facingHeading, Math.PI * 2 * dt);
            }
        } else if (followingWorkerPath) {
            if (len > EPSILON) {
                nextHeading = rotateTowardAngle(heading, Math.atan2(desiredY, desiredX), Math.PI * 2 * dt);
                const pathSpeed = getAttackSlotRunSpeed(baseSpeed, speedScale);
                vx = Math.cos(nextHeading) * pathSpeed;
                vy = Math.sin(nextHeading) * pathSpeed;
            }
        } else if (state === STATE_HOLDING) {
            nextHeading = rotateTowardAngle(heading, Math.atan2(toTargetY, toTargetX), Math.PI * 2 * dt);
            if (len > EPSILON) {
                const slideHeading = Math.atan2(desiredY, desiredX);
                vx = Math.cos(slideHeading) * speed * WAITING_RING_SLIDE_SPEED_SCALE;
                vy = Math.sin(slideHeading) * speed * WAITING_RING_SLIDE_SPEED_SCALE;
            }
        } else if (state === STATE_ATTACKING) {
            nextHeading = Math.atan2(toTargetY, toTargetX);
            vx = Math.cos(nextHeading) * attackSpeed;
            vy = Math.sin(nextHeading) * attackSpeed;
        } else if (state === STATE_SEEKING || state === STATE_RECOVERING || state === STATE_VACATING) {
            const retreatHeading = Math.atan2(desiredY, desiredX);
            const targetHeading = Math.atan2(toTargetY, toTargetX);
            nextHeading = state === STATE_SEEKING
                ? rotateTowardAngle(heading, targetHeading, Math.PI * 2 * dt)
                : targetHeading;
            if (len > EPSILON) {
                const retreatSpeed = state === STATE_SEEKING
                    ? getAttackSlotRunSpeed(baseSpeed, speedScale)
                    : speed * 1.45;
                vx = Math.cos(retreatHeading) * retreatSpeed;
                vy = Math.sin(retreatHeading) * retreatSpeed;
            }
        } else if (state !== STATE_ATTACKING && state !== STATE_SEEKING && state !== STATE_RECOVERING && state !== STATE_VACATING && targetDist < ringRadius) {
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
        if (state === STATE_RECOVERING || state === STATE_VACATING) {
            const outward = enforceMinimumOutwardVelocity(vx, vy, x, y, targetX, targetY, ringRadius, speed);
            vx = outward.vx;
            vy = outward.vy;
        }
        if (state !== STATE_ATTACKING) {
            const wallSlideVelocity = projectVectorAlongNearbyWalls(x, y, radius, vx, vy, walls);
            vx = wallSlideVelocity.x;
            vy = wallSlideVelocity.y;
        }

        let candidateX = x + vx * dt;
        let candidateY = y + vy * dt;
        if (state === STATE_ATTACKING) {
            const contact = clampDartToTargetContact(x, y, candidateX, candidateY, targetX, targetY, touchDistance);
            candidateX = contact.x;
            candidateY = contact.y;
            if (contact.touched) {
                nextPhase = PHASE_RECOVERING;
                nextPhaseTime = 0;
                const resetCooldown = getAttackRecoveryCooldown(id);
                nextCooldown = isDesignatedAttacker ? -(resetCooldown + 1) : resetCooldown;
                hits += 1;
            }
        } else if (!followingWorkerPath && (state === STATE_HOLDING || state === STATE_SEEKING || state === STATE_RECOVERING || state === STATE_VACATING)) {
            const outsideRing = clampOutsideTargetRing(x, y, candidateX, candidateY, targetX, targetY, ringRadius);
            candidateX = outsideRing.x;
            candidateY = outsideRing.y;
        } else if (state !== STATE_SEEKING && state !== STATE_RECOVERING && state !== STATE_VACATING) {
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
            seeking,
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

function getStepWalls(message) {
    const version = Number.isFinite(Number(message.worldVersion)) ? Number(message.worldVersion) : 0;
    if (message.walls !== undefined) {
        validatePackedLength(message.walls, WALL_STRIDE, "walls");
        cachedWalls = message.walls;
        cachedWallsWorldVersion = version;
        return cachedWalls;
    }
    if (!cachedWalls || cachedWallsWorldVersion !== version) {
        throw new Error(`walls missing for world version ${version}`);
    }
    return cachedWalls;
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

function getAttackLungeSpeed(baseSpeed, speedScale) {
    const scale = Math.sqrt(Math.max(0, speedScale));
    return baseSpeed * scale * ATTACK_LUNGE_SPEED_MULTIPLIER;
}

function getAttackSlotRunSpeed(baseSpeed, speedScale) {
    const scale = Math.sqrt(Math.max(0, speedScale));
    return baseSpeed * scale * ATTACK_SLOT_RUN_SPEED_MULTIPLIER;
}

function getAttackRecoveryCooldown(id) {
    return 0.7 + (id % 5) * 0.08;
}

function getAttackTimeoutSeconds(ringRadius, radius, touchDistance, attackSpeed) {
    const attackRange = Math.max(0, ringRadius + radius * 0.35 - touchDistance);
    const travelSeconds = attackRange / Math.max(EPSILON, attackSpeed);
    return Math.max(1.2, travelSeconds + ATTACK_LUNGE_TIMEOUT_PADDING_SECONDS);
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

function hasWallAheadAlongMillingIntent(x, y, desiredX, desiredY, radius, walls) {
    const desiredLength = Math.hypot(desiredX, desiredY);
    if (desiredLength <= EPSILON) return false;
    const lookAhead = Math.max(radius * 1.5, 0.25);
    const toX = x + desiredX / desiredLength * lookAhead;
    const toY = y + desiredY / desiredLength * lookAhead;
    return !!findEarliestSegmentHit(x, y, toX, toY, radius, walls);
}

function buildSlotChoices(agents, count, targetX, targetY, ringRadius, walls) {
    const choices = new Array(count);
    for (let i = 0; i < count; i++) {
        const base = i * STRIDE;
        const pathMode = Math.floor(agents[base + 14]) === PATH_MODE_WORKER ? PATH_MODE_WORKER : PATH_MODE_DIRECT;
        if (pathMode === PATH_MODE_WORKER) continue;
        const x = agents[base + 1];
        const y = agents[base + 2];
        const homeAngle = agents[base + 9];
        const targetDist = Math.hypot(x - targetX, y - targetY);
        const ringAngle = targetDist > EPSILON ? Math.atan2(y - targetY, x - targetX) : homeAngle;
        choices[i] = chooseRingSlot(
            targetX,
            targetY,
            ringRadius,
            ringAngle,
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

function computeTargetRingMillingIntent(x, y, radius, targetX, targetY, ringRadius, homeAngle, millingDirection) {
    const targetDist = Math.hypot(x - targetX, y - targetY);
    const loopRadius = ringRadius + radius * 2.25;
    const clearOrbitRadius = ringRadius + radius * 0.9;
    if (targetDist < clearOrbitRadius) {
        const escape = computeTargetEscapeVector(x, y, targetX, targetY, homeAngle, clearOrbitRadius);
        return {
            x: escape.x,
            y: escape.y,
            goalX: escape.goalX,
            goalY: escape.goalY,
            canReverseAtWall: false
        };
    }
    const millingVector = computeMillingLoopVector(
        x,
        y,
        targetX,
        targetY,
        loopRadius,
        millingDirection
    );
    return {
        x: millingVector.x,
        y: millingVector.y,
        goalX: x + millingVector.x,
        goalY: y + millingVector.y,
        canReverseAtWall: true
    };
}

function isTargetRingFullForMilling(agents, count, selfIndex, x, y, radius, targetX, targetY, targetDist, ringRadius, walls, wasMilling) {
    if (!(targetDist > EPSILON)) return false;
    const enterRadius = ringRadius + radius * MILLING_RING_FULL_ENTER_RADIUS_SCALE;
    const exitRadius = ringRadius + radius * MILLING_RING_FULL_EXIT_RADIUS_SCALE;
    if (targetDist > (wasMilling ? exitRadius : enterRadius)) return false;

    const usableSlots = countUsableRingSlots(agents, count, targetX, targetY, ringRadius, walls);
    if (usableSlots <= 0) return true;

    let occupiedSlots = 0;
    const occupancyRadius = ringRadius + radius * MILLING_RING_OCCUPANCY_RADIUS_SCALE;
    for (let i = 0; i < count; i++) {
        if (i === selfIndex) continue;
        const base = i * STRIDE;
        const ox = agents[base + 1];
        const oy = agents[base + 2];
        const otherDist = Math.hypot(ox - targetX, oy - targetY);
        if (otherDist <= occupancyRadius) occupiedSlots += 1;
    }

    if (occupiedSlots < usableSlots) return false;
    return !isAgentCloserThanEnoughRingOccupants(agents, count, selfIndex, targetX, targetY, targetDist, usableSlots);
}

function isAgentCloserThanEnoughRingOccupants(agents, count, selfIndex, targetX, targetY, targetDist, usableSlots) {
    let closer = 0;
    for (let i = 0; i < count; i++) {
        if (i === selfIndex) continue;
        const base = i * STRIDE;
        const ox = agents[base + 1];
        const oy = agents[base + 2];
        const otherDist = Math.hypot(ox - targetX, oy - targetY);
        if (otherDist < targetDist) closer += 1;
        if (closer >= usableSlots) return false;
    }
    return true;
}

function isSeekingIntoMillingAgent(agents, count, selfIndex, x, y, radius, goalX, goalY, targetX, targetY) {
    const goalDx = goalX - x;
    const goalDy = goalY - y;
    const goalDist = Math.hypot(goalDx, goalDy);
    if (!(goalDist > EPSILON)) return false;

    const dirX = goalDx / goalDist;
    const dirY = goalDy / goalDist;
    const selfTargetDist = Math.hypot(x - targetX, y - targetY);
    const forwardLimit = Math.min(goalDist + radius, radius * MILLING_PROPAGATION_FORWARD_RANGE_SCALE);
    const backTolerance = radius * CROWD_LOCK_BACK_TOLERANCE_SCALE;

    for (let i = 0; i < count; i++) {
        if (i === selfIndex) continue;
        const base = i * STRIDE;
        const otherPhase = Math.max(0, Math.floor(agents[base + 7]));
        if (otherPhase !== PHASE_MILLING) continue;

        const ox = agents[base + 1];
        const oy = agents[base + 2];
        const otherRadius = agents[base + 3];
        const dx = ox - x;
        const dy = oy - y;
        const projection = dx * dirX + dy * dirY;
        if (projection < -backTolerance || projection > forwardLimit) continue;

        const otherTargetDist = Math.hypot(ox - targetX, oy - targetY);
        if (otherTargetDist > selfTargetDist + radius * 0.75) continue;

        const lateralX = dx - dirX * projection;
        const lateralY = dy - dirY * projection;
        const lateralDistance = Math.hypot(lateralX, lateralY);
        const laneRadius = radius + otherRadius + Math.min(radius, otherRadius) * MILLING_PROPAGATION_LANE_PADDING_SCALE;
        if (lateralDistance <= laneRadius) return true;
    }

    return false;
}

function isSeekingBlockedByCloseCrowd(agents, count, selfIndex, x, y, radius, targetX, targetY, targetDist, ringRadius, wasMilling) {
    if (!(targetDist > EPSILON)) return false;
    const eligibilityRadius = ringRadius + radius * (wasMilling ? CROWD_LOCK_EXIT_RADIUS_SCALE : CROWD_LOCK_ENTER_RADIUS_SCALE);
    if (targetDist > eligibilityRadius) return false;

    const dirX = (targetX - x) / targetDist;
    const dirY = (targetY - y) / targetDist;
    const forwardLimit = radius * CROWD_LOCK_FORWARD_RANGE_SCALE;
    const backTolerance = radius * CROWD_LOCK_BACK_TOLERANCE_SCALE;
    let lanePressure = 0;

    for (let i = 0; i < count; i++) {
        if (i === selfIndex) continue;
        const base = i * STRIDE;
        const ox = agents[base + 1];
        const oy = agents[base + 2];
        const otherRadius = agents[base + 3];
        const dx = ox - x;
        const dy = oy - y;
        const projection = dx * dirX + dy * dirY;
        if (projection < -backTolerance || projection > forwardLimit) continue;

        const lateralX = dx - dirX * projection;
        const lateralY = dy - dirY * projection;
        const lateralDistance = Math.hypot(lateralX, lateralY);
        const laneRadius = radius + otherRadius + Math.min(radius, otherRadius) * CROWD_LOCK_LANE_PADDING_SCALE;
        if (lateralDistance > laneRadius) continue;

        const otherTargetDist = Math.hypot(ox - targetX, oy - targetY);
        if (otherTargetDist > targetDist + radius * 0.75) continue;

        const forwardWeight = 1 - Math.min(1, Math.max(0, projection) / Math.max(forwardLimit, EPSILON));
        const lateralWeight = 1 - Math.min(1, lateralDistance / Math.max(laneRadius, EPSILON));
        lanePressure += Math.max(0.2, forwardWeight * lateralWeight);
        if (lanePressure >= (wasMilling ? 0.35 : 0.65)) return true;
    }

    return false;
}

function wallClearance(x, y, walls) {
    let clearance = Infinity;
    for (let i = 0; i < walls.length; i += WALL_STRIDE) {
        const ax = walls[i];
        const ay = walls[i + 1];
        const bx = walls[i + 2];
        const by = walls[i + 3];
        const distance = pointSegmentDistance(x, y, ax, ay, bx, by);
        clearance = Math.min(clearance, distance);
    }
    return clearance - WALL_WORLD_HALF_THICKNESS;
}

function computeWallEscapeVector(x, y, radius, walls) {
    const activationDistance = radius * MILLING_WALL_ESCAPE_CLEARANCE_SCALE;
    let escapeX = 0;
    let escapeY = 0;
    let pressure = 0;
    for (let i = 0; i < walls.length; i += WALL_STRIDE) {
        const ax = walls[i];
        const ay = walls[i + 1];
        const bx = walls[i + 2];
        const by = walls[i + 3];
        const clearance = pointSegmentDistance(x, y, ax, ay, bx, by) - WALL_WORLD_HALF_THICKNESS;
        if (clearance >= activationDistance) continue;
        const push = (activationDistance - clearance) / activationDistance;
        const normal = segmentRepulsionNormal(x, y, ax, ay, bx, by);
        escapeX += normal.x * push;
        escapeY += normal.y * push;
        pressure += push;
    }
    const length = Math.hypot(escapeX, escapeY);
    if (length <= EPSILON) return { x: 0, y: 0, pressure: 0 };
    return {
        x: escapeX / length * Math.min(1, pressure),
        y: escapeY / length * Math.min(1, pressure),
        pressure
    };
}

function projectVectorAlongNearbyWalls(x, y, radius, vectorX, vectorY, walls) {
    let outX = vectorX;
    let outY = vectorY;
    if (Math.hypot(outX, outY) <= EPSILON) return { x: 0, y: 0 };

    const activationClearance = radius * WALL_SLIDE_CLEARANCE_SCALE;
    for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        for (let i = 0; i < walls.length; i += WALL_STRIDE) {
            const ax = walls[i];
            const ay = walls[i + 1];
            const bx = walls[i + 2];
            const by = walls[i + 3];
            const clearance = pointSegmentDistance(x, y, ax, ay, bx, by) - WALL_WORLD_HALF_THICKNESS;
            if (clearance > activationClearance) continue;
            const normal = segmentRepulsionNormal(x, y, ax, ay, bx, by);
            const intoNormal = outX * normal.x + outY * normal.y;
            if (intoNormal >= 0) continue;
            outX -= normal.x * intoNormal;
            outY -= normal.y * intoNormal;
            changed = true;
        }
        if (!changed) break;
    }

    if (Math.hypot(outX, outY) <= EPSILON) return { x: 0, y: 0 };
    return { x: outX, y: outY };
}

function pushPointInsideWalls(x, y, radius, walls) {
    let outX = x;
    let outY = y;
    for (let pass = 0; pass < 4; pass++) {
        let changed = false;
        for (let i = 0; i < walls.length; i += WALL_STRIDE) {
            const ax = walls[i];
            const ay = walls[i + 1];
            const bx = walls[i + 2];
            const by = walls[i + 3];
            const distance = pointSegmentDistance(outX, outY, ax, ay, bx, by);
            const blockingRadius = radius + WALL_WORLD_HALF_THICKNESS;
            if (distance < blockingRadius) {
                const normal = segmentRepulsionNormal(outX, outY, ax, ay, bx, by);
                const correction = blockingRadius - distance;
                outX += normal.x * correction;
                outY += normal.y * correction;
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

function selectAttackingNpcs(agents, count, targetX, targetY, ringRadius, walls, targetMoved) {
    const maxAttackers = countUsableRingSlots(agents, count, targetX, targetY, ringRadius, walls);
    if (maxAttackers <= 0) return new Set();

    const nearby = collectNearbyAttackCandidates(agents, count, targetX, targetY, ringRadius);
    const selected = new Set();
    const candidates = [];

    for (let n = 0; n < nearby.length; n++) {
        const candidate = nearby[n];
        const base = candidate.index * STRIDE;
        const id = agents[base];
        const waitTime = agents[base + 6];
        const phase = Math.max(0, Math.floor(agents[base + 7]));
        const phaseTime = Math.max(0, agents[base + 8]);
        const cooldown = Number.isFinite(agents[base + 10]) ? agents[base + 10] : 0;
        const remainingCooldown = cooldown < 0 ? Math.max(0, -cooldown - 1) : Math.max(0, cooldown);

        if (phase === PHASE_ATTACKING && !targetMoved && selected.size < maxAttackers) {
            selected.add(candidate.index);
            continue;
        }
        if (phase === PHASE_VACATING && candidate.targetDist < ringRadius + candidate.radius * VACATE_ATTACK_RING_RELEASE_SCALE) {
            continue;
        }
        if (phase === PHASE_RECOVERING && remainingCooldown > 0) {
            continue;
        }

        const crowdClearance = computeCandidateCrowdClearance(candidate, nearby, ringRadius);
        const targetNearness = candidate.targetDist;
        const ringError = Math.abs(candidate.targetDist - ringRadius);
        let score = targetNearness
            + ringError * ATTACKER_SELECTION_RING_ERROR_WEIGHT
            - crowdClearance * ATTACKER_SELECTION_SPREAD_WEIGHT;

        if (phase === PHASE_HOLDING) score -= Math.min(ringRadius * 0.45, Math.min(2, waitTime) * 0.22);
        if (phase === PHASE_SEEKING && candidate.targetDist <= ringRadius + candidate.radius * 2.2) score -= ringRadius * 0.22;
        if (!targetMoved && cooldown < 0) score -= ringRadius * 0.3;
        if (candidate.targetDist < ringRadius) score -= (ringRadius - candidate.targetDist) * 0.4;

        candidates.push({ index: candidate.index, id, score });
    }

    candidates.sort((a, b) => a.score - b.score || a.id - b.id);
    for (let i = 0; i < candidates.length && selected.size < maxAttackers; i++) {
        selected.add(candidates[i].index);
    }
    return selected;
}

function collectNearbyAttackCandidates(agents, count, targetX, targetY, ringRadius) {
    const nearby = [];
    const maxDist = ringRadius * ATTACKER_SELECTION_NEARBY_RADIUS_SCALE;
    for (let i = 0; i < count; i++) {
        const base = i * STRIDE;
        const pathMode = Math.floor(agents[base + 14]) === PATH_MODE_WORKER ? PATH_MODE_WORKER : PATH_MODE_DIRECT;
        if (pathMode === PATH_MODE_WORKER) continue;
        const x = agents[base + 1];
        const y = agents[base + 2];
        const radius = agents[base + 3];
        const targetDist = Math.hypot(targetX - x, targetY - y);
        if (targetDist > maxDist) continue;
        const angle = targetDist > EPSILON ? Math.atan2(y - targetY, x - targetX) : agents[base + 9];
        nearby.push({ index: i, x, y, radius, targetDist, angle });
    }
    return nearby;
}

function computeCandidateCrowdClearance(candidate, nearby, ringRadius) {
    let best = ringRadius * Math.PI;
    for (let i = 0; i < nearby.length; i++) {
        const other = nearby[i];
        if (other.index === candidate.index) continue;
        const angleDistance = Math.abs(shortestAngleDelta(candidate.angle, other.angle)) * ringRadius;
        const radialDistance = Math.abs(candidate.targetDist - other.targetDist);
        const separation = Math.hypot(angleDistance, radialDistance * 0.65);
        if (separation < best) best = separation;
    }
    return Math.min(best, ringRadius * 2.5);
}

function computeRingSlideVector(agents, count, selfIndex, x, y, radius, targetX, targetY, ringRadius, attackSlots) {
    const fromTargetX = x - targetX;
    const fromTargetY = y - targetY;
    const targetDist = Math.hypot(fromTargetX, fromTargetY);
    if (targetDist <= EPSILON) return { x: 0, y: 0, pressure: 0 };

    const radialX = fromTargetX / targetDist;
    const radialY = fromTargetY / targetDist;
    const tangentX = -radialY;
    const tangentY = radialX;
    const selfAngle = Math.atan2(fromTargetY, fromTargetX);
    const selfRingError = Math.abs(targetDist - ringRadius);
    if (selfRingError > radius * ATTACKER_RING_SLIDE_ACTIVATION_SCALE) return { x: 0, y: 0, pressure: 0 };

    let slide = 0;
    let pressure = 0;
    const angularActivation = Math.max(radius * 3.2, ringRadius * 0.45);
    const maxOtherDist = ringRadius + radius * ATTACKER_RING_ENTRY_PRESSURE_OUTER_SCALE;
    for (let i = 0; i < count; i++) {
        if (i === selfIndex) continue;
        const base = i * STRIDE;
        const ox = agents[base + 1];
        const oy = agents[base + 2];
        const otherRadius = agents[base + 3];
        const otherPhase = Math.max(0, Math.floor(agents[base + 7]));
        const sourceIsVacating = otherPhase === PHASE_VACATING;
        if (!sourceIsVacating && (!attackSlots || !attackSlots.has(i))) continue;
        const otherDist = Math.hypot(ox - targetX, oy - targetY);
        if (otherPhase === PHASE_ATTACKING) continue;
        if (!sourceIsVacating && otherDist < ringRadius + otherRadius * ATTACK_SLOT_ARRIVAL_RADIUS_SCALE) continue;
        if (!sourceIsVacating && otherDist <= targetDist) continue;
        if (sourceIsVacating && otherDist >= targetDist) continue;
        if (otherDist > maxOtherDist) continue;

        const otherAngle = otherDist > EPSILON ? Math.atan2(oy - targetY, ox - targetX) : agents[base + 9];
        const angleDelta = shortestAngleDelta(selfAngle, otherAngle);
        const arcDistance = Math.abs(angleDelta) * ringRadius;
        if (arcDistance >= angularActivation) continue;

        const radialGap = Math.abs(otherDist - targetDist);
        const radialWeight = 1 - Math.min(1, radialGap / Math.max(radius * 5, EPSILON));
        const outerRingError = Math.max(0, otherDist - ringRadius);
        const entryPressure = sourceIsVacating
            ? 1.5
            : 1 + Math.max(0, 1 - Math.min(1, outerRingError / Math.max(otherRadius * 3.5, EPSILON)));
        const push = (angularActivation - arcDistance) / angularActivation * radialWeight * entryPressure;
        if (push <= 0) continue;

        slide += (angleDelta >= 0 ? -1 : 1) * push;
        pressure += push;
    }

    if (Math.abs(slide) <= EPSILON) return { x: 0, y: 0, pressure: 0 };
    const clampedSlide = Math.max(-ATTACKER_RING_SLIDE_MAX, Math.min(ATTACKER_RING_SLIDE_MAX, slide));
    const radialCorrection = Math.max(-1, Math.min(1, (ringRadius - targetDist) / Math.max(radius, EPSILON))) * 0.38;
    return {
        x: tangentX * clampedSlide + radialX * radialCorrection,
        y: tangentY * clampedSlide + radialY * radialCorrection,
        pressure
    };
}

function computeVacatingLaneYield(agents, count, selfIndex, x, y, radius, targetX, targetY, desiredX, desiredY) {
    const desiredLength = Math.hypot(desiredX, desiredY);
    if (!(desiredLength > EPSILON)) return { x: 0, y: 0, pressure: 0 };

    const toTargetX = targetX - x;
    const toTargetY = targetY - y;
    const targetDist = Math.hypot(toTargetX, toTargetY);
    if (!(targetDist > EPSILON)) return { x: 0, y: 0, pressure: 0 };

    const inwardAlignment = (desiredX * toTargetX + desiredY * toTargetY) / (desiredLength * targetDist);
    if (inwardAlignment <= 0.15) return { x: 0, y: 0, pressure: 0 };

    const dirX = desiredX / desiredLength;
    const dirY = desiredY / desiredLength;
    const radialX = (x - targetX) / targetDist;
    const radialY = (y - targetY) / targetDist;
    const tangentX = -radialY;
    const tangentY = radialX;
    const selfAngle = Math.atan2(y - targetY, x - targetX);
    const forwardLimit = radius * VACATING_LANE_YIELD_FORWARD_RANGE_SCALE;
    const backTolerance = radius * CROWD_LOCK_BACK_TOLERANCE_SCALE;
    let slide = 0;
    let outward = 0;
    let pressure = 0;

    for (let i = 0; i < count; i++) {
        if (i === selfIndex) continue;
        const base = i * STRIDE;
        const otherPhase = Math.max(0, Math.floor(agents[base + 7]));
        if (otherPhase !== PHASE_VACATING) continue;

        const ox = agents[base + 1];
        const oy = agents[base + 2];
        const otherRadius = agents[base + 3];
        const otherTargetDist = Math.hypot(ox - targetX, oy - targetY);
        if (otherTargetDist > targetDist + radius * 0.5) continue;

        const dx = ox - x;
        const dy = oy - y;
        const projection = dx * dirX + dy * dirY;
        if (projection < -backTolerance || projection > forwardLimit) continue;

        const lateralX = dx - dirX * projection;
        const lateralY = dy - dirY * projection;
        const lateralDistance = Math.hypot(lateralX, lateralY);
        const laneRadius = radius + otherRadius + Math.min(radius, otherRadius) * VACATING_LANE_YIELD_LANE_PADDING_SCALE;
        if (lateralDistance > laneRadius) continue;

        const otherAngle = otherTargetDist > EPSILON ? Math.atan2(oy - targetY, ox - targetX) : selfAngle;
        const angleDelta = shortestAngleDelta(selfAngle, otherAngle);
        const lateralWeight = 1 - Math.min(1, lateralDistance / Math.max(laneRadius, EPSILON));
        const forwardWeight = 1 - Math.min(1, Math.max(0, projection) / Math.max(forwardLimit, EPSILON));
        const push = Math.max(0.2, lateralWeight * forwardWeight);
        const sideSign = Math.abs(angleDelta) > 0.05
            ? (angleDelta >= 0 ? -1 : 1)
            : (selfIndex % 2 === 0 ? 1 : -1);
        slide += sideSign * push;
        outward += push * Math.max(0.35, inwardAlignment);
        pressure += push;
    }

    if (pressure <= EPSILON) return { x: 0, y: 0, pressure: 0 };
    const clampedSlide = Math.max(-1, Math.min(1, slide));
    const clampedOutward = Math.min(1.35, outward);
    return {
        x: tangentX * clampedSlide * VACATING_LANE_YIELD_SIDE_STRENGTH + radialX * clampedOutward * VACATING_LANE_YIELD_OUTWARD_STRENGTH,
        y: tangentY * clampedSlide * VACATING_LANE_YIELD_SIDE_STRENGTH + radialY * clampedOutward * VACATING_LANE_YIELD_OUTWARD_STRENGTH,
        pressure
    };
}

function computeMillingOrcaVelocity(agents, count, selfIndex, desiredX, desiredY, targetX, targetY, ringRadius, baseSpeed, speedScale, dt) {
    const orca = self.NpcMovementOrca;
    if (!orca || typeof orca.computeAgentVelocity !== "function") {
        throw new Error("Wizard of Flatland milling ORCA requires NpcMovementOrca.computeAgentVelocity");
    }
    const preferredLength = Math.hypot(desiredX, desiredY);
    if (!(preferredLength > EPSILON)) return { vx: 0, vy: 0 };

    const selfBase = selfIndex * STRIDE;
    const maxSpeed = Math.max(EPSILON, baseSpeed * speedScale);
    const preferredVx = desiredX / preferredLength * maxSpeed;
    const preferredVy = desiredY / preferredLength * maxSpeed;
    const orcaAgents = new Array(count);
    const selfNeighborDist = Math.max(agents[selfBase + 3] * MILLING_ORCA_NEIGHBOR_DIST_SCALE, 2.5);

    for (let i = 0; i < count; i++) {
        const base = i * STRIDE;
        const isSelf = i === selfIndex;
        const agentMaxSpeed = Math.max(EPSILON, agents[base + 4] * speedScale);
        const preferred = isSelf
            ? { vx: preferredVx, vy: preferredVy }
            : getPackedAgentMillingPreferredVelocity(agents, i, targetX, targetY, ringRadius, speedScale);
        const vx = isSelf || preferred.active ? preferred.vx : 0;
        const vy = isSelf || preferred.active ? preferred.vy : 0;
        orcaAgents[i] = {
            id: agents[base],
            x: agents[base + 1],
            y: agents[base + 2],
            vx,
            vy,
            prefVx: vx,
            prefVy: vy,
            radius: agents[base + 3],
            maxSpeed: agentMaxSpeed,
            neighborDist: selfNeighborDist,
            maxNeighbors: MILLING_ORCA_MAX_NEIGHBORS
        };
    }

    return orca.computeAgentVelocity(orcaAgents[selfIndex], orcaAgents, {
        timeStep: dt,
        timeHorizon: MILLING_ORCA_TIME_HORIZON,
        neighborDist: selfNeighborDist,
        maxNeighbors: MILLING_ORCA_MAX_NEIGHBORS
    });
}

function getPackedAgentMillingPreferredVelocity(agents, index, targetX, targetY, ringRadius, speedScale) {
    const base = index * STRIDE;
    const phase = Math.max(0, Math.floor(agents[base + 7]));
    if (phase !== PHASE_MILLING) return { vx: 0, vy: 0, active: false };

    const x = agents[base + 1];
    const y = agents[base + 2];
    const radius = agents[base + 3];
    const speed = Math.max(EPSILON, agents[base + 4] * speedScale);
    const homeAngle = agents[base + 9];
    const millingDirection = agents[base + 12] >= 0 ? 1 : -1;
    const intent = computeTargetRingMillingIntent(
        x,
        y,
        radius,
        targetX,
        targetY,
        ringRadius,
        homeAngle,
        millingDirection
    );
    const length = Math.hypot(intent.x, intent.y);
    if (!(length > EPSILON)) return { vx: 0, vy: 0, active: false };
    return {
        vx: intent.x / length * speed,
        vy: intent.y / length * speed,
        active: true
    };
}

function buildUsableRingSlots(targetX, targetY, ringRadius, maxRadius, walls) {
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
    return slots;
}

function computeSeparation(agents, count, selfIndex, x, y, radius, priority, options = {}) {
    let sx = 0;
    let sy = 0;
    let checks = 0;
    let pressure = 0;
    const overlapOnly = options.overlapOnly === true;
    const activationScale = Number.isFinite(options.activationScale)
        ? Math.max(1, Number(options.activationScale))
        : (overlapOnly ? 1.02 : 1.35);
    const maxRange = radius * Math.max(4.5, activationScale * 3);
    const maxRangeSq = maxRange * maxRange;
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
        const activationDistance = desired * activationScale;
        if (dist >= activationDistance) continue;
        const otherPriority = agents[base + 5];
        const otherPhase = Math.max(0, Math.floor(agents[base + 7]));
        const priorityWeight = otherPriority > priority ? 1.25 : 0.75;
        const phasePushMultiplier = otherPhase === PHASE_VACATING ? VACATING_SEPARATION_PUSH_MULTIPLIER : 1;
        const push = (activationDistance - dist) / activationDistance * priorityWeight * phasePushMultiplier;
        pressure += push;
        sx += dx / dist * push;
        sy += dy / dist * push;
    }
    return { x: sx, y: sy, checks, pressure };
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

function enforceMinimumOutwardVelocity(vx, vy, x, y, targetX, targetY, ringRadius, speed) {
    const dx = x - targetX;
    const dy = y - targetY;
    const dist = Math.hypot(dx, dy);
    if (!(dist > EPSILON)) return { vx, vy };
    const radialX = dx / dist;
    const radialY = dy / dist;
    const outwardSpeed = vx * radialX + vy * radialY;
    if (dist >= ringRadius) return { vx, vy };
    const minOutwardSpeed = Math.max(speed * RETREAT_MIN_OUTWARD_SPEED_SCALE, (ringRadius - dist) * 6);
    if (outwardSpeed >= minOutwardSpeed) return { vx, vy };
    const correction = minOutwardSpeed - outwardSpeed;
    return {
        vx: vx + radialX * correction,
        vy: vy + radialY * correction
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
    for (let i = 0; i < walls.length; i += WALL_STRIDE) {
        const hit = sweptCircleSegmentHit(
            fromX,
            fromY,
            toX,
            toY,
            walls[i],
            walls[i + 1],
            walls[i + 2],
            walls[i + 3],
            radius + WALL_WORLD_HALF_THICKNESS
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
    for (let i = 0; i < walls.length; i += WALL_STRIDE) {
        const ax = walls[i];
        const ay = walls[i + 1];
        const bx = walls[i + 2];
        const by = walls[i + 3];
        if (pointSegmentDistance(x, y, ax, ay, bx, by) < radius + WALL_WORLD_HALF_THICKNESS - 0.002) return true;
    }
    return false;
}
