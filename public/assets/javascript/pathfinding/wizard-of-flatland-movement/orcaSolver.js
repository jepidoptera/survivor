(function (root) {
    "use strict";

    /*
     * Browser/worker usage:
     *   importScripts("./orcaSolver.js");
     *   const velocities = self.NpcMovementOrca.computeAgentVelocities(agents, {
     *       timeStep: dt,
     *       timeHorizon: 1.0,
     *       neighborDist: 3.0,
     *       maxNeighbors: 12
     *   });
     *
     * This module only chooses local avoidance velocities for circle agents. It does
     * not project final positions and does not yet add wall half-plane constraints.
     * TODO: add explicit wall/segment constraints after solverWorker.js decides how
     * to combine ORCA with the existing wall detour and hard contact pass.
     */

    const VERSION = "0.1.0";
    const DEFAULT_TIME_HORIZON = 1.0;
    const DEFAULT_NEIGHBOR_DIST = 3.0;
    const DEFAULT_MAX_NEIGHBORS = 12;
    const DEFAULT_EPSILON = 0.000001;

    function computeAgentVelocities(agents, options) {
        validateAgentList(agents);
        for (let i = 0; i < agents.length; i++) {
            validateAgent(agents[i], "agents[" + i + "]");
        }
        const config = normalizeOptions(options);
        const results = new Array(agents.length);
        for (let i = 0; i < agents.length; i++) {
            results[i] = computeAgentVelocity(agents[i], agents, config);
        }
        return results;
    }

    function computeAgentVelocity(agent, agents, options) {
        validateAgentList(agents);
        validateAgent(agent, "agent");
        const config = normalizeOptions(options);
        const lines = buildAgentConstraints(agent, agents, config);
        const preferred = applyDeterministicAvoidanceBias(clampVector(
            { x: finiteNumber(agent.prefVx, "agent.prefVx"), y: finiteNumber(agent.prefVy, "agent.prefVy") },
            finitePositive(agent.maxSpeed, "agent.maxSpeed")
        ), lines, agent.maxSpeed, config.epsilon);
        const solution = solveVelocityLinearProgram(lines, agent.maxSpeed, preferred, config);
        return {
            vx: solution.x,
            vy: solution.y,
            constraintCount: lines.length,
            neighborCount: solution.neighborCount,
            limited: solution.limited,
            maxConstraintViolation: solution.maxConstraintViolation
        };
    }

    function buildAgentConstraints(agent, agents, options) {
        validateAgentList(agents);
        validateAgent(agent, "agent");
        const config = normalizeOptions(options);
        const neighborDist = finitePositive(
            agent.neighborDist === undefined ? config.neighborDist : agent.neighborDist,
            "agent.neighborDist"
        );
        const maxNeighbors = finitePositiveInteger(
            agent.maxNeighbors === undefined ? config.maxNeighbors : agent.maxNeighbors,
            "agent.maxNeighbors"
        );
        const neighbors = [];
        const neighborDistSq = neighborDist * neighborDist;

        for (let i = 0; i < agents.length; i++) {
            const other = agents[i];
            validateAgent(other, "agents[" + i + "]");
            if (other === agent || sameAgentId(agent, other)) continue;
            let rx = other.x - agent.x;
            let ry = other.y - agent.y;
            let distSq = rx * rx + ry * ry;
            if (distSq <= config.epsilon * config.epsilon) {
                const axis = stablePairUnit(agent.id, other.id);
                const sign = compareIds(agent.id, other.id) <= 0 ? 1 : -1;
                rx = axis.x * sign * config.epsilon;
                ry = axis.y * sign * config.epsilon;
                distSq = rx * rx + ry * ry;
            }
            if (distSq > neighborDistSq) continue;
            neighbors.push({ other, rx, ry, distSq });
        }

        neighbors.sort((a, b) => {
            if (a.distSq !== b.distSq) return a.distSq - b.distSq;
            return compareIds(a.other.id, b.other.id);
        });

        const lines = [];
        const limit = Math.min(maxNeighbors, neighbors.length);
        for (let i = 0; i < limit; i++) {
            lines.push(buildPairConstraint(agent, neighbors[i], config));
        }
        lines.neighborCount = limit;
        return lines;
    }

    function applyDeterministicAvoidanceBias(preferred, lines, maxSpeed, epsilon) {
        let biased = { x: preferred.x, y: preferred.y };
        let applied = false;
        const biasSize = Math.max(epsilon * 16, maxSpeed * 0.02);
        for (let i = 0; i < lines.length; i++) {
            if (signedViolation(lines[i], preferred) <= epsilon) continue;
            // A perfectly symmetric head-on pair can satisfy a half-plane by braking straight ahead.
            // Nudge the optimization target along the ORCA tangent so those ties resolve as sidesteps.
            biased.x += lines[i].direction.x * biasSize;
            biased.y += lines[i].direction.y * biasSize;
            applied = true;
        }
        return applied ? clampVector(biased, maxSpeed) : biased;
    }

    function buildPairConstraint(agent, neighbor, config) {
        const other = neighbor.other;
        const relativePosition = { x: neighbor.rx, y: neighbor.ry };
        const relativeVelocity = {
            x: agent.vx - other.vx,
            y: agent.vy - other.vy
        };
        const combinedRadius = agent.radius + other.radius;
        const combinedRadiusSq = combinedRadius * combinedRadius;
        const distSq = neighbor.distSq;
        const responsibilityShare = clamp(
            agent.responsibility === undefined ? 0.5 : finiteNumber(agent.responsibility, "agent.responsibility"),
            0,
            1
        );

        let direction;
        let u;

        if (distSq > combinedRadiusSq) {
            const invTimeHorizon = 1 / config.timeHorizon;
            const w = {
                x: relativeVelocity.x - invTimeHorizon * relativePosition.x,
                y: relativeVelocity.y - invTimeHorizon * relativePosition.y
            };
            const wLengthSq = absSq(w);
            const dotProduct = dot(w, relativePosition);

            if (dotProduct < 0 && dotProduct * dotProduct > combinedRadiusSq * wLengthSq) {
                const unitW = normalizeOrStable(w, agent.id, other.id, config.epsilon);
                direction = { x: unitW.y, y: -unitW.x };
                const wLength = Math.sqrt(wLengthSq);
                u = scale(unitW, combinedRadius * invTimeHorizon - wLength);
            } else {
                const leg = Math.sqrt(Math.max(0, distSq - combinedRadiusSq));
                if (det(relativePosition, w) > 0) {
                    direction = {
                        x: (relativePosition.x * leg - relativePosition.y * combinedRadius) / distSq,
                        y: (relativePosition.x * combinedRadius + relativePosition.y * leg) / distSq
                    };
                } else {
                    direction = {
                        x: -(relativePosition.x * leg + relativePosition.y * combinedRadius) / distSq,
                        y: (relativePosition.x * combinedRadius - relativePosition.y * leg) / distSq
                    };
                }
                const velocityOnCutoffSide = dot(relativeVelocity, direction);
                u = {
                    x: velocityOnCutoffSide * direction.x - relativeVelocity.x,
                    y: velocityOnCutoffSide * direction.y - relativeVelocity.y
                };
            }
        } else {
            // Already touching/overlapping. Use the simulation dt so the chosen velocity separates promptly,
            // while leaving final contact projection to the lab's hard solver.
            const invTimeStep = 1 / config.timeStep;
            const w = {
                x: relativeVelocity.x - invTimeStep * relativePosition.x,
                y: relativeVelocity.y - invTimeStep * relativePosition.y
            };
            const unitW = normalizeOrStable(w, agent.id, other.id, config.epsilon);
            direction = { x: unitW.y, y: -unitW.x };
            u = scale(unitW, combinedRadius * invTimeStep - length(w));
        }

        const point = {
            x: agent.vx + responsibilityShare * u.x,
            y: agent.vy + responsibilityShare * u.y
        };
        assertFiniteVector(point, "ORCA constraint point");
        assertFiniteVector(direction, "ORCA constraint direction");
        return { point, direction };
    }

    function solveVelocityLinearProgram(lines, maxSpeed, preferredVelocity, options) {
        validateLines(lines);
        const config = normalizeOptions(options);
        const radius = finitePositive(maxSpeed, "maxSpeed");
        assertFiniteVector(preferredVelocity, "preferredVelocity");
        const result = { value: clampVector(preferredVelocity, radius) };
        const failedLine = linearProgram2(lines, radius, result, config.epsilon);
        let limited = failedLine < lines.length;

        if (limited) {
            linearProgram3(lines, failedLine, radius, result, config.epsilon);
        }

        if (!Number.isFinite(result.value.x) || !Number.isFinite(result.value.y)) {
            throw new Error("ORCA linear program produced a non-finite velocity");
        }

        result.value = clampVector(result.value, radius);
        const maxConstraintViolation = measureMaxViolation(lines, result.value);
        if (maxConstraintViolation > config.epsilon) limited = true;
        return {
            x: result.value.x,
            y: result.value.y,
            limited,
            maxConstraintViolation,
            neighborCount: typeof lines.neighborCount === "number" ? lines.neighborCount : lines.length
        };
    }

    function linearProgram1(lines, lineNo, radius, preferredVelocity, result, epsilon) {
        const line = lines[lineNo];
        const dotProduct = dot(line.point, line.direction);
        const discriminant = dotProduct * dotProduct + radius * radius - absSq(line.point);
        if (discriminant < -epsilon) return false;

        const sqrtDiscriminant = Math.sqrt(Math.max(0, discriminant));
        let tLeft = -dotProduct - sqrtDiscriminant;
        let tRight = -dotProduct + sqrtDiscriminant;

        for (let i = 0; i < lineNo; i++) {
            const other = lines[i];
            const denominator = det(line.direction, other.direction);
            const numerator = det(other.direction, subtract(line.point, other.point));

            if (Math.abs(denominator) <= epsilon) {
                if (numerator < -epsilon) return false;
                continue;
            }

            const t = numerator / denominator;
            if (denominator >= 0) {
                tRight = Math.min(tRight, t);
            } else {
                tLeft = Math.max(tLeft, t);
            }
            if (tLeft > tRight + epsilon) return false;
        }

        const tPreferred = dot(line.direction, subtract(preferredVelocity, line.point));
        const t = clamp(tPreferred, tLeft, tRight);
        result.value = add(line.point, scale(line.direction, t));
        return true;
    }

    function linearProgram2(lines, radius, result, epsilon) {
        result.value = clampVector(result.value, radius);
        for (let i = 0; i < lines.length; i++) {
            if (signedViolation(lines[i], result.value) > epsilon) {
                const previous = result.value;
                if (!linearProgram1(lines, i, radius, result.value, result, epsilon)) {
                    result.value = previous;
                    return i;
                }
            }
        }
        return lines.length;
    }

    function linearProgram3(lines, beginLine, radius, result, epsilon) {
        let distance = 0;
        for (let i = beginLine; i < lines.length; i++) {
            if (signedViolation(lines[i], result.value) <= distance + epsilon) continue;

            const projectionLines = [];
            for (let j = 0; j < i; j++) {
                const determinant = det(lines[i].direction, lines[j].direction);
                let point;
                if (Math.abs(determinant) <= epsilon) {
                    if (dot(lines[i].direction, lines[j].direction) > 0) {
                        continue;
                    }
                    point = scale(add(lines[i].point, lines[j].point), 0.5);
                } else {
                    point = add(
                        lines[i].point,
                        scale(
                            lines[i].direction,
                            det(lines[j].direction, subtract(lines[i].point, lines[j].point)) / determinant
                        )
                    );
                }

                projectionLines.push({
                    point,
                    direction: normalizeOrThrow(subtract(lines[j].direction, lines[i].direction), "projection line")
                });
            }

            const previous = result.value;
            const lineNormal = { x: -lines[i].direction.y, y: lines[i].direction.x };
            const projectionResult = { value: lineNormal };
            const failedLine = linearProgram2(projectionLines, radius, projectionResult, epsilon);
            if (failedLine < projectionLines.length) {
                result.value = previous;
            } else {
                result.value = projectionResult.value;
            }
            distance = signedViolation(lines[i], result.value);
        }
    }

    function validateAgentList(agents) {
        if (!Array.isArray(agents)) throw new Error("agents must be an array");
    }

    function validateAgent(agent, label) {
        if (!agent || typeof agent !== "object") throw new Error(label + " must be an object");
        if (agent.id === undefined || agent.id === null) throw new Error(label + ".id is required");
        finiteNumber(agent.x, label + ".x");
        finiteNumber(agent.y, label + ".y");
        finiteNumber(agent.vx, label + ".vx");
        finiteNumber(agent.vy, label + ".vy");
        finiteNumber(agent.prefVx, label + ".prefVx");
        finiteNumber(agent.prefVy, label + ".prefVy");
        finitePositive(agent.radius, label + ".radius");
        finitePositive(agent.maxSpeed, label + ".maxSpeed");
        if (agent.neighborDist !== undefined) finitePositive(agent.neighborDist, label + ".neighborDist");
        if (agent.maxNeighbors !== undefined) finitePositiveInteger(agent.maxNeighbors, label + ".maxNeighbors");
        if (agent.responsibility !== undefined) finiteNumber(agent.responsibility, label + ".responsibility");
    }

    function normalizeOptions(options) {
        const source = options || {};
        if (options !== undefined && (!options || typeof options !== "object")) {
            throw new Error("options must be an object");
        }
        return {
            timeHorizon: finitePositive(
                source.timeHorizon === undefined ? DEFAULT_TIME_HORIZON : source.timeHorizon,
                "options.timeHorizon"
            ),
            timeStep: finitePositive(source.timeStep, "options.timeStep"),
            neighborDist: finitePositive(
                source.neighborDist === undefined ? DEFAULT_NEIGHBOR_DIST : source.neighborDist,
                "options.neighborDist"
            ),
            maxNeighbors: finitePositiveInteger(
                source.maxNeighbors === undefined ? DEFAULT_MAX_NEIGHBORS : source.maxNeighbors,
                "options.maxNeighbors"
            ),
            epsilon: finitePositive(
                source.epsilon === undefined ? DEFAULT_EPSILON : source.epsilon,
                "options.epsilon"
            ),
            sampleFallback: source.sampleFallback === true
        };
    }

    function validateLines(lines) {
        if (!Array.isArray(lines)) throw new Error("lines must be an array");
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line || typeof line !== "object") throw new Error("lines[" + i + "] must be an object");
            assertFiniteVector(line.point, "lines[" + i + "].point");
            assertFiniteVector(line.direction, "lines[" + i + "].direction");
            const len = length(line.direction);
            if (!(len > 0)) throw new Error("lines[" + i + "].direction must be non-zero");
        }
    }

    function signedViolation(line, velocity) {
        return det(line.direction, subtract(line.point, velocity));
    }

    function measureMaxViolation(lines, velocity) {
        let maxViolation = 0;
        for (let i = 0; i < lines.length; i++) {
            maxViolation = Math.max(maxViolation, signedViolation(lines[i], velocity));
        }
        return maxViolation;
    }

    function finiteNumber(value, label) {
        const number = Number(value);
        if (!Number.isFinite(number)) throw new Error(label + " must be finite");
        return number;
    }

    function finitePositive(value, label) {
        const number = finiteNumber(value, label);
        if (!(number > 0)) throw new Error(label + " must be greater than zero");
        return number;
    }

    function finitePositiveInteger(value, label) {
        const number = finitePositive(value, label);
        if (Math.floor(number) !== number) throw new Error(label + " must be an integer");
        return number;
    }

    function assertFiniteVector(vector, label) {
        if (!vector || typeof vector !== "object") throw new Error(label + " must be a vector object");
        finiteNumber(vector.x, label + ".x");
        finiteNumber(vector.y, label + ".y");
    }

    function normalizeOrThrow(vector, label) {
        const len = length(vector);
        if (!(len > 0)) throw new Error(label + " direction must be non-zero");
        return { x: vector.x / len, y: vector.y / len };
    }

    function normalizeOrStable(vector, idA, idB, epsilon) {
        const len = length(vector);
        if (len > epsilon) return { x: vector.x / len, y: vector.y / len };
        const axis = stablePairUnit(idA, idB);
        const sign = compareIds(idA, idB) <= 0 ? -1 : 1;
        return { x: axis.x * sign, y: axis.y * sign };
    }

    function stablePairUnit(idA, idB) {
        const key = String(idA) + "|" + String(idB);
        let hash = 2166136261;
        for (let i = 0; i < key.length; i++) {
            hash ^= key.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        const angle = ((hash >>> 0) / 4294967296) * Math.PI * 2;
        return { x: Math.cos(angle), y: Math.sin(angle) };
    }

    function sameAgentId(a, b) {
        return a.id === b.id;
    }

    function compareIds(a, b) {
        const left = typeof a + ":" + String(a);
        const right = typeof b + ":" + String(b);
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function clampVector(vector, maxLength) {
        const lenSq = absSq(vector);
        if (lenSq <= maxLength * maxLength) return { x: vector.x, y: vector.y };
        const len = Math.sqrt(lenSq);
        if (!(len > 0)) return { x: 0, y: 0 };
        return { x: vector.x / len * maxLength, y: vector.y / len * maxLength };
    }

    function add(a, b) {
        return { x: a.x + b.x, y: a.y + b.y };
    }

    function subtract(a, b) {
        return { x: a.x - b.x, y: a.y - b.y };
    }

    function scale(vector, scalar) {
        return { x: vector.x * scalar, y: vector.y * scalar };
    }

    function dot(a, b) {
        return a.x * b.x + a.y * b.y;
    }

    function det(a, b) {
        return a.x * b.y - a.y * b.x;
    }

    function absSq(vector) {
        return vector.x * vector.x + vector.y * vector.y;
    }

    function length(vector) {
        return Math.hypot(vector.x, vector.y);
    }

    const api = {
        computeAgentVelocities,
        computeAgentVelocity,
        buildAgentConstraints,
        solveVelocityLinearProgram,
        VERSION
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    } else {
        root.NpcMovementOrca = api;
    }
}(typeof globalThis !== "undefined" ? globalThis : self));
