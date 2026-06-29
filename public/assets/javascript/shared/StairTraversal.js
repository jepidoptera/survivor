(function installStairTraversal(globalScope) {
    "use strict";

    const EPSILON = 0.000001;

    function finiteNumber(value, label) {
        const number = Number(value);
        if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
        return number;
    }

    function finitePoint(point, label) {
        if (!point || typeof point !== "object") throw new Error(`${label} must be a point`);
        return {
            x: finiteNumber(point.x, `${label}.x`),
            y: finiteNumber(point.y, `${label}.y`)
        };
    }

    function clamp01(value) {
        return Math.max(0, Math.min(1, Number(value)));
    }

    function pointDistance(a, b) {
        return Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y));
    }

    function interpolatePoint(a, b, t) {
        return {
            x: Number(a.x) + (Number(b.x) - Number(a.x)) * t,
            y: Number(a.y) + (Number(b.y) - Number(a.y)) * t
        };
    }

    function samePoint2d(a, b, epsilon = EPSILON) {
        return pointDistance(a, b) <= epsilon;
    }

    function cross2d(a, b, c) {
        return (Number(b.x) - Number(a.x)) * (Number(c.y) - Number(a.y)) -
            (Number(b.y) - Number(a.y)) * (Number(c.x) - Number(a.x));
    }

    function lineIntersectionPoint(a, b, c, d) {
        const dx1 = Number(b.x) - Number(a.x);
        const dy1 = Number(b.y) - Number(a.y);
        const dx2 = Number(d.x) - Number(c.x);
        const dy2 = Number(d.y) - Number(c.y);
        const denominator = dx1 * dy2 - dy1 * dx2;
        if (Math.abs(denominator) <= EPSILON) return null;
        const cx = Number(c.x) - Number(a.x);
        const cy = Number(c.y) - Number(a.y);
        const t = (cx * dy2 - cy * dx2) / denominator;
        return {
            x: Number(a.x) + dx1 * t,
            y: Number(a.y) + dy1 * t
        };
    }

    function pointOnSegment(point, a, b, epsilon = EPSILON) {
        if (Math.abs(cross2d(a, b, point)) > epsilon) return false;
        return Number(point.x) >= Math.min(Number(a.x), Number(b.x)) - epsilon &&
            Number(point.x) <= Math.max(Number(a.x), Number(b.x)) + epsilon &&
            Number(point.y) >= Math.min(Number(a.y), Number(b.y)) - epsilon &&
            Number(point.y) <= Math.max(Number(a.y), Number(b.y)) + epsilon;
    }

    function segmentsIntersect(a, b, c, d, epsilon = EPSILON) {
        const abC = cross2d(a, b, c);
        const abD = cross2d(a, b, d);
        const cdA = cross2d(c, d, a);
        const cdB = cross2d(c, d, b);
        if (
            ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
            ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))
        ) {
            return true;
        }
        return pointOnSegment(c, a, b, epsilon) ||
            pointOnSegment(d, a, b, epsilon) ||
            pointOnSegment(a, c, d, epsilon) ||
            pointOnSegment(b, c, d, epsilon);
    }

    function arcPoint(center, radius, startAngle, deltaAngle, t) {
        const angle = Number(startAngle) + Number(deltaAngle) * t;
        return {
            x: Number(center.x) + Math.cos(angle) * Number(radius),
            y: Number(center.y) + Math.sin(angle) * Number(radius)
        };
    }

    function normalizeArcDelta(startAngle, endAngle) {
        let delta = Number(endAngle) - Number(startAngle);
        while (delta <= -Math.PI) delta += Math.PI * 2;
        while (delta > Math.PI) delta -= Math.PI * 2;
        return delta;
    }

    function stairArcDelta(startAngle, endAngle, tread, key, fallback = null) {
        if (tread && Object.prototype.hasOwnProperty.call(tread, key)) {
            return finiteNumber(tread[key], key);
        }
        const delta = normalizeArcDelta(startAngle, endAngle);
        if (fallback !== null && Math.sign(delta || fallback) !== Math.sign(fallback)) {
            return delta + Math.PI * 2 * Math.sign(fallback);
        }
        return delta;
    }

    function treadHasStoredArcDelta(tread, key = "arcDeltaAngle") {
        if (!tread || !Object.prototype.hasOwnProperty.call(tread, key)) return false;
        return Math.abs(finiteNumber(tread[key], key)) > EPSILON;
    }

    function normalizedTread(tread, label) {
        if (!tread || typeof tread !== "object") throw new Error(`${label} must be a tread`);
        const left = finitePoint(tread.left, `${label}.left`);
        const right = finitePoint(tread.right, `${label}.right`);
        const width = pointDistance(left, right);
        if (!(width > EPSILON)) throw new Error(`${label} requires non-coincident endpoints`);
        const normalized = {
            left,
            right,
            center: {
                x: (left.x + right.x) * 0.5,
                y: (left.y + right.y) * 0.5
            },
            angle: Math.atan2(right.y - left.y, right.x - left.x),
            width
        };
        if (Object.prototype.hasOwnProperty.call(tread, "arcDeltaAngle")) {
            normalized.arcDeltaAngle = finiteNumber(tread.arcDeltaAngle, `${label}.arcDeltaAngle`);
        }
        if (Object.prototype.hasOwnProperty.call(tread, "arcNearDeltaAngle")) {
            normalized.arcNearDeltaAngle = finiteNumber(tread.arcNearDeltaAngle, `${label}.arcNearDeltaAngle`);
        }
        return normalized;
    }

    function pointFromLocal(frame, upDown, leftRight) {
        const u = Number(upDown);
        const v = Number(leftRight);
        return {
            x: frame.lowerPoint.x + frame.run.x * u + frame.cross.x * v,
            y: frame.lowerPoint.y + frame.run.y * u + frame.cross.y * v
        };
    }

    function createStraightFrame(stair, options = {}) {
        if (!stair || typeof stair !== "object") throw new Error("straight stair traversal requires a stair record");
        const stairId = typeof stair.id === "string" && stair.id.length > 0
            ? stair.id
            : (typeof stair.transitionId === "string" && stair.transitionId.length > 0 ? stair.transitionId : "(unknown)");
        const lowerPoint = finitePoint(stair.lowerPoint || stair.startPoint, `stair ${stairId} lowerPoint`);
        const higherPoint = finitePoint(stair.higherPoint || stair.endPoint, `stair ${stairId} higherPoint`);
        const shortestDeltaX = typeof options.shortestDeltaX === "function"
            ? options.shortestDeltaX
            : ((fromX, toX) => Number(toX) - Number(fromX));
        const shortestDeltaY = typeof options.shortestDeltaY === "function"
            ? options.shortestDeltaY
            : ((fromY, toY) => Number(toY) - Number(fromY));
        const dx = finiteNumber(shortestDeltaX(lowerPoint.x, higherPoint.x), `stair ${stairId} run dx`);
        const dy = finiteNumber(shortestDeltaY(lowerPoint.y, higherPoint.y), `stair ${stairId} run dy`);
        const length = Math.hypot(dx, dy);
        if (!(length > EPSILON)) throw new Error(`stair ${stairId} traversal requires non-coincident endpoint lines`);
        const width = finiteNumber(stair.width, `stair ${stairId} width`);
        if (!(width > EPSILON)) throw new Error(`stair ${stairId} traversal requires a positive width`);
        const lowerZ = finiteNumber(stair.lowerZ !== undefined ? stair.lowerZ : stair.bottomZ, `stair ${stairId} lowerZ`);
        const higherZ = finiteNumber(stair.higherZ !== undefined ? stair.higherZ : lowerZ + stair.height, `stair ${stairId} higherZ`);
        const verticalSpan = higherZ - lowerZ;
        const surfaceLength = Math.hypot(length, verticalSpan);
        if (!(surfaceLength > EPSILON)) throw new Error(`stair ${stairId} traversal requires non-zero surface length`);
        return {
            kind: "straight",
            stairId,
            lowerPoint,
            higherPoint,
            lowerZ,
            higherZ,
            width,
            halfWidth: width * 0.5,
            length,
            verticalSpan,
            surfaceLength,
            along: { x: dx / length, y: dy / length },
            cross: { x: -dy / length, y: dx / length },
            run: { x: dx, y: dy }
        };
    }

    function connectedTreadEndpoint(a, b) {
        const endpoints = [
            { aPoint: a.left, bPoint: b.left, aOther: a.right, bOther: b.right },
            { aPoint: a.left, bPoint: b.right, aOther: a.right, bOther: b.left },
            { aPoint: a.right, bPoint: b.left, aOther: a.left, bOther: b.right },
            { aPoint: a.right, bPoint: b.right, aOther: a.left, bOther: b.left }
        ];
        return endpoints.find((entry) => samePoint2d(entry.aPoint, entry.bPoint)) || null;
    }

    function chooseParallelPairing(a, b) {
        const sameSideScore = pointDistance(a.left, b.left) + pointDistance(a.right, b.right);
        const crossedScore = pointDistance(a.left, b.right) + pointDistance(a.right, b.left);
        if (crossedScore < sameSideScore) {
            return {
                sideAStart: a.left,
                sideAEnd: b.right,
                sideBStart: a.right,
                sideBEnd: b.left
            };
        }
        return {
            sideAStart: a.left,
            sideAEnd: b.left,
            sideBStart: a.right,
            sideBEnd: b.right
        };
    }

    function createTreadSection(previous, next, index, label) {
        const connected = connectedTreadEndpoint(previous, next);
        if (connected && treadHasStoredArcDelta(next, "arcDeltaAngle")) {
            const center = { x: Number(connected.aPoint.x), y: Number(connected.aPoint.y) };
            const radius = pointDistance(center, connected.aOther);
            const startAngle = Math.atan2(connected.aOther.y - center.y, connected.aOther.x - center.x);
            const endAngle = Math.atan2(connected.bOther.y - center.y, connected.bOther.x - center.x);
            const deltaAngle = stairArcDelta(startAngle, endAngle, next, "arcDeltaAngle");
            return {
                index,
                pointA: () => ({ ...center }),
                pointB: (t) => arcPoint(center, radius, startAngle, deltaAngle, t)
            };
        }
        const directionCross = Math.sin(next.angle - previous.angle);
        if (Math.abs(directionCross) <= EPSILON) {
            const paired = chooseParallelPairing(previous, next);
            return {
                index,
                pointA: (t) => interpolatePoint(paired.sideAStart, paired.sideAEnd, t),
                pointB: (t) => interpolatePoint(paired.sideBStart, paired.sideBEnd, t)
            };
        }
        if (connected) {
            const center = { x: Number(connected.aPoint.x), y: Number(connected.aPoint.y) };
            const radius = pointDistance(center, connected.aOther);
            const startAngle = Math.atan2(connected.aOther.y - center.y, connected.aOther.x - center.x);
            const endAngle = Math.atan2(connected.bOther.y - center.y, connected.bOther.x - center.x);
            const deltaAngle = stairArcDelta(startAngle, endAngle, next, "arcDeltaAngle");
            return {
                index,
                pointA: () => ({ ...center }),
                pointB: (t) => arcPoint(center, radius, startAngle, deltaAngle, t)
            };
        }
        const crossing = lineIntersectionPoint(previous.left, previous.right, next.left, next.right);
        if (!crossing) throw new Error(`${label} treads are neither parallel, connected, nor intersecting`);
        const sortedPrevious = [previous.left, previous.right]
            .map((point) => ({ point, distance: pointDistance(crossing, point) }))
            .sort((a, b) => a.distance - b.distance);
        const sortedNext = [next.left, next.right]
            .map((point) => ({ point, distance: pointDistance(crossing, point) }))
            .sort((a, b) => a.distance - b.distance);
        const nearRadius = (sortedPrevious[0].distance + sortedNext[0].distance) * 0.5;
        const farRadius = (sortedPrevious[1].distance + sortedNext[1].distance) * 0.5;
        const farStartAngle = Math.atan2(sortedPrevious[1].point.y - crossing.y, sortedPrevious[1].point.x - crossing.x);
        const farEndAngle = Math.atan2(sortedNext[1].point.y - crossing.y, sortedNext[1].point.x - crossing.x);
        const farDeltaAngle = stairArcDelta(farStartAngle, farEndAngle, next, "arcDeltaAngle");
        const nearStartAngle = Math.atan2(sortedPrevious[0].point.y - crossing.y, sortedPrevious[0].point.x - crossing.x);
        const nearEndAngle = Math.atan2(sortedNext[0].point.y - crossing.y, sortedNext[0].point.x - crossing.x);
        const nearDeltaAngle = stairArcDelta(nearStartAngle, nearEndAngle, next, "arcNearDeltaAngle", farDeltaAngle);
        return {
            index,
            pointA: (t) => arcPoint(crossing, nearRadius, nearStartAngle, nearDeltaAngle, t),
            pointB: (t) => arcPoint(crossing, farRadius, farStartAngle, farDeltaAngle, t)
        };
    }

    function sectionCrossline(section, t) {
        const resolvedT = clamp01(t);
        const a = section.pointA(resolvedT);
        const b = section.pointB(resolvedT);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        return { a, b, dx, dy, length };
    }

    function flipSectionLeftRight(section) {
        if (!section || typeof section.pointA !== "function" || typeof section.pointB !== "function") {
            throw new Error("stair section orientation requires path boundary functions");
        }
        const pointA = section.pointA;
        const pointB = section.pointB;
        section.pointA = pointB;
        section.pointB = pointA;
        section.leftRightFlipped = section.leftRightFlipped !== true;
    }

    function alignTreadPathSectionOrientations(sections, treads, stairId) {
        if (!Array.isArray(sections) || sections.length === 0) return;
        if (!Array.isArray(treads) || treads.length < 2) {
            throw new Error(`stair ${stairId} tread path orientation requires saved treads`);
        }
        const firstStart = sectionCrossline(sections[0], 0);
        const firstSame = pointDistance(firstStart.a, treads[0].left) + pointDistance(firstStart.b, treads[0].right);
        const firstSwapped = pointDistance(firstStart.a, treads[0].right) + pointDistance(firstStart.b, treads[0].left);
        if (firstSwapped + EPSILON < firstSame) flipSectionLeftRight(sections[0]);

        for (let i = 1; i < sections.length; i++) {
            const previousEnd = sectionCrossline(sections[i - 1], 1);
            const currentStart = sectionCrossline(sections[i], 0);
            const same = pointDistance(previousEnd.a, currentStart.a) + pointDistance(previousEnd.b, currentStart.b);
            const swapped = pointDistance(previousEnd.a, currentStart.b) + pointDistance(previousEnd.b, currentStart.a);
            if (swapped + EPSILON < same) flipSectionLeftRight(sections[i]);
        }
    }

    function estimateSectionLength(section) {
        let length = 0;
        let previous = null;
        for (let i = 0; i <= 32; i++) {
            const crossline = sectionCrossline(section, i / 32);
            const center = {
                x: (crossline.a.x + crossline.b.x) * 0.5,
                y: (crossline.a.y + crossline.b.y) * 0.5
            };
            if (previous) length += pointDistance(previous, center);
            previous = center;
        }
        return Math.max(EPSILON, length);
    }

    function createTreadPathFrame(stair, options = {}) {
        if (!stair || typeof stair !== "object") throw new Error("tread path traversal requires a stair record");
        const stairId = typeof stair.id === "string" && stair.id.length > 0
            ? stair.id
            : (typeof stair.transitionId === "string" && stair.transitionId.length > 0 ? stair.transitionId : "(unknown)");
        const sourceTreads = Array.isArray(options.treads) ? options.treads : stair.treads;
        if (!Array.isArray(sourceTreads) || sourceTreads.length < 2) {
            throw new Error(`stair ${stairId} tread path traversal requires at least two treads`);
        }
        const treads = sourceTreads.map((tread, index) => normalizedTread(tread, `stair ${stairId} tread ${index}`));
        const lowerZ = finiteNumber(stair.lowerZ !== undefined ? stair.lowerZ : stair.bottomZ, `stair ${stairId} lowerZ`);
        const higherZ = finiteNumber(stair.higherZ !== undefined ? stair.higherZ : lowerZ + stair.height, `stair ${stairId} higherZ`);
        const sections = [];
        for (let i = 1; i < treads.length; i++) {
            const section = createTreadSection(treads[i - 1], treads[i], i - 1, `stair ${stairId} section ${i - 1}`);
            section.length = estimateSectionLength(section);
            sections.push(section);
        }
        alignTreadPathSectionOrientations(sections, treads, stairId);
        const pathLength = sections.reduce((sum, section) => sum + section.length, 0);
        const verticalSpan = higherZ - lowerZ;
        const surfaceLength = Math.hypot(pathLength, verticalSpan);
        if (!(surfaceLength > EPSILON)) throw new Error(`stair ${stairId} tread path traversal requires non-zero surface length`);
        let cursor = 0;
        sections.forEach((section) => {
            section.startU = cursor / pathLength;
            cursor += section.length;
            section.endU = cursor / pathLength;
        });
        return {
            kind: "treadPath",
            stairId,
            treads,
            sections,
            lowerZ,
            higherZ,
            pathLength,
            verticalSpan,
            surfaceLength,
            lowerPoint: treads[0].center,
            higherPoint: treads[treads.length - 1].center
        };
    }

    function localPointForStraightFrame(frame, point, options = {}) {
        if (!frame || frame.kind !== "straight") throw new Error("straight stair local point requires a straight frame");
        const candidate = finitePoint(point, `stair ${frame.stairId} sample point`);
        const shortestDeltaX = typeof options.shortestDeltaX === "function"
            ? options.shortestDeltaX
            : ((fromX, toX) => Number(toX) - Number(fromX));
        const shortestDeltaY = typeof options.shortestDeltaY === "function"
            ? options.shortestDeltaY
            : ((fromY, toY) => Number(toY) - Number(fromY));
        const relX = finiteNumber(shortestDeltaX(frame.lowerPoint.x, candidate.x), `stair ${frame.stairId} sample dx`);
        const relY = finiteNumber(shortestDeltaY(frame.lowerPoint.y, candidate.y), `stair ${frame.stairId} sample dy`);
        const alongDistance = relX * frame.along.x + relY * frame.along.y;
        const sideDistance = relX * frame.cross.x + relY * frame.cross.y;
        const upDown = alongDistance / frame.length;
        const leftRight = (sideDistance / frame.width) + 0.5;
        return {
            upDown,
            leftRight,
            alongDistance,
            sideDistance,
            baseZ: frame.lowerZ + (frame.higherZ - frame.lowerZ) * clamp01(upDown),
            point: candidate
        };
    }

    function localInsideStraightFrame(frame, local, actorRadius = 0, epsilon = EPSILON) {
        if (!local || !Number.isFinite(local.upDown) || !Number.isFinite(local.sideDistance)) return false;
        const radius = Math.max(0, Number(actorRadius) || 0);
        return local.upDown >= -epsilon &&
            local.upDown <= 1 + epsilon &&
            Math.abs(local.sideDistance) <= frame.halfWidth - radius + epsilon;
    }

    function sectionForUpDown(frame, upDown) {
        if (!frame || frame.kind !== "treadPath") throw new Error("tread path section lookup requires a tread path frame");
        const u = clamp01(upDown);
        return frame.sections.find((section) => u >= section.startU - EPSILON && u <= section.endU + EPSILON)
            || frame.sections[frame.sections.length - 1];
    }

    function pointFromPathLocal(frame, upDown, leftRight) {
        const section = sectionForUpDown(frame, upDown);
        const span = Math.max(EPSILON, section.endU - section.startU);
        const sectionT = clamp01((clamp01(upDown) - section.startU) / span);
        const crossline = sectionCrossline(section, sectionT);
        const s = Number(leftRight);
        return {
            x: crossline.a.x + crossline.dx * s,
            y: crossline.a.y + crossline.dy * s
        };
    }

    function localPointForPathFrame(frame, point, options = {}) {
        if (!frame || frame.kind !== "treadPath") throw new Error("tread path local point requires a tread path frame");
        const candidate = finitePoint(point, `stair ${frame.stairId} sample point`);
        let best = null;
        const upDownHint = Number(options && options.upDownHint);
        const hasUpDownHint = Number.isFinite(upDownHint);
        const minUpDown = Number(options && options.minUpDown);
        const maxUpDown = Number(options && options.maxUpDown);
        const hasMinUpDown = Number.isFinite(minUpDown);
        const hasMaxUpDown = Number.isFinite(maxUpDown);
        const hintErrorTolerance = Math.max(EPSILON, Number(options && options.hintErrorTolerance) || 0.001);
        const evaluate = (section, rawT) => {
            const sectionT = clamp01(rawT);
            const crossline = sectionCrossline(section, sectionT);
            const lengthSquared = crossline.dx * crossline.dx + crossline.dy * crossline.dy;
            const leftRight = lengthSquared > EPSILON * EPSILON
                ? ((candidate.x - crossline.a.x) * crossline.dx + (candidate.y - crossline.a.y) * crossline.dy) / lengthSquared
                : 0;
            const clampedLeftRight = clamp01(leftRight);
            const projected = {
                x: crossline.a.x + crossline.dx * clampedLeftRight,
                y: crossline.a.y + crossline.dy * clampedLeftRight
            };
            const error = pointDistance(candidate, projected);
            const upDown = section.startU + (section.endU - section.startU) * sectionT;
            return { section, sectionT, leftRight, crossline, error, upDown };
        };
        const preferResult = (candidateResult, currentBest) => {
            if (!candidateResult) return false;
            if (hasMinUpDown && candidateResult.upDown < minUpDown - EPSILON) return false;
            if (hasMaxUpDown && candidateResult.upDown > maxUpDown + EPSILON) return false;
            if (!currentBest) return true;
            if (hasUpDownHint && Math.abs(candidateResult.error - currentBest.error) <= hintErrorTolerance) {
                return Math.abs(candidateResult.upDown - upDownHint) + EPSILON < Math.abs(currentBest.upDown - upDownHint);
            }
            return candidateResult.error < currentBest.error;
        };
        frame.sections.forEach((section) => {
            let sampleT = 0;
            let sampleError = Infinity;
            let sampleBest = null;
            for (let i = 0; i <= 24; i++) {
                const result = evaluate(section, i / 24);
                if (preferResult(result, sampleBest)) {
                    sampleT = result.sectionT;
                    sampleError = result.error;
                    sampleBest = result;
                }
            }
            if (!sampleBest) return;
            let low = Math.max(0, sampleT - 1 / 24);
            let high = Math.min(1, sampleT + 1 / 24);
            for (let i = 0; i < 18; i++) {
                const left = low + (high - low) / 3;
                const right = high - (high - low) / 3;
                if (evaluate(section, left).error <= evaluate(section, right).error) {
                    high = right;
                } else {
                    low = left;
                }
            }
            const result = evaluate(section, (low + high) * 0.5);
            if (preferResult(result, best)) {
                best = result;
            } else if (preferResult(sampleBest, best)) {
                best = sampleBest;
            }
        });
        if (!best) throw new Error(`stair ${frame.stairId} has no tread path sections`);
        let upDown = best.section.startU + (best.section.endU - best.section.startU) * best.sectionT;
        const clampedLeftRight = clamp01(best.leftRight);
        const endpointExtensionTolerance = 0.001;
        if (best.section === frame.sections[0] && best.sectionT <= endpointExtensionTolerance) {
            const endpointPoint = pointFromPathLocal(frame, 0, clampedLeftRight);
            const tangent = pathTangentAt(frame, 0, clampedLeftRight);
            const signed = ((candidate.x - endpointPoint.x) * tangent.x) + ((candidate.y - endpointPoint.y) * tangent.y);
            if (signed < 0) upDown = signed / frame.pathLength;
        } else if (best.section === frame.sections[frame.sections.length - 1] && best.sectionT >= 1 - endpointExtensionTolerance) {
            const endpointPoint = pointFromPathLocal(frame, 1, clampedLeftRight);
            const tangent = pathTangentAt(frame, 1, clampedLeftRight);
            const signed = ((candidate.x - endpointPoint.x) * tangent.x) + ((candidate.y - endpointPoint.y) * tangent.y);
            if (signed > 0) upDown = 1 + (signed / frame.pathLength);
        }
        const pointOnPath = {
            x: best.crossline.a.x + best.crossline.dx * best.leftRight,
            y: best.crossline.a.y + best.crossline.dy * best.leftRight
        };
        return {
            upDown,
            leftRight: best.leftRight,
            sectionIndex: best.section.index,
            sectionT: best.sectionT,
            crosslineLength: best.crossline.length,
            projectionError: best.error,
            baseZ: frame.lowerZ + (frame.higherZ - frame.lowerZ) * clamp01(upDown),
            point: pointOnPath
        };
    }

    function localInsidePathFrame(frame, local, actorRadius = 0, epsilon = EPSILON) {
        if (
            !local ||
            !Number.isFinite(local.upDown) ||
            !Number.isFinite(local.leftRight) ||
            !Number.isFinite(local.projectionError)
        ) return false;
        const section = sectionForUpDown(frame, local.upDown);
        const span = Math.max(EPSILON, section.endU - section.startU);
        const sectionT = clamp01((clamp01(local.upDown) - section.startU) / span);
        const crossline = sectionCrossline(section, sectionT);
        const radius = Math.max(0, Number(actorRadius) || 0);
        const inset = crossline.length > EPSILON ? radius / crossline.length : Infinity;
        const projectionTolerance = Math.max(epsilon, 0.001);
        return local.upDown >= -epsilon &&
            local.upDown <= 1 + epsilon &&
            local.projectionError <= projectionTolerance &&
            local.leftRight >= inset - epsilon &&
            local.leftRight <= 1 - inset + epsilon;
    }

    function localFootprintOverlapsPathFrame(frame, local, actorRadius = 0, epsilon = EPSILON) {
        if (
            !local ||
            !Number.isFinite(local.upDown) ||
            !Number.isFinite(local.leftRight) ||
            !Number.isFinite(local.projectionError)
        ) return false;
        const section = sectionForUpDown(frame, local.upDown);
        const span = Math.max(EPSILON, section.endU - section.startU);
        const sectionT = clamp01((clamp01(local.upDown) - section.startU) / span);
        const crossline = sectionCrossline(section, sectionT);
        const radius = Math.max(0, Number(actorRadius) || 0);
        const sideExpansion = crossline.length > EPSILON ? radius / crossline.length : 0;
        const projectionTolerance = Math.max(epsilon, 0.001);
        return local.upDown >= -epsilon &&
            local.upDown <= 1 + epsilon &&
            local.projectionError <= projectionTolerance &&
            local.leftRight >= -sideExpansion - epsilon &&
            local.leftRight <= 1 + sideExpansion + epsilon;
    }

    function endpointCrossed(previousLocal, nextLocal, endpoint) {
        if (!previousLocal || !nextLocal) return false;
        if (endpoint === "lower") {
            return (previousLocal.upDown <= 0 && nextLocal.upDown >= 0) ||
                (previousLocal.upDown >= 0 && nextLocal.upDown <= 0);
        }
        if (endpoint === "higher") {
            return (previousLocal.upDown >= 1 && nextLocal.upDown <= 1) ||
                (previousLocal.upDown <= 1 && nextLocal.upDown >= 1);
        }
        throw new Error(`unknown stair endpoint: ${endpoint}`);
    }

    function supportFromStraightLocal(stair, frame, local) {
        if (!stair || !frame || !local) throw new Error("stair support requires stair, frame, and local point");
        const upDown = clamp01(local.upDown);
        const leftRight = Math.max(0, Math.min(1, Number(local.leftRight)));
        const stepCount = Number.isFinite(stair.stepCount) ? Math.max(1, Math.round(Number(stair.stepCount))) : 1;
        const treadIndex = Math.max(0, Math.min(stepCount - 1, Math.floor(upDown * stepCount)));
        const baseZ = frame.lowerZ + (frame.higherZ - frame.lowerZ) * ((treadIndex + 1) / (stepCount + 1));
        const point = pointFromLocal(frame, upDown, leftRight - 0.5);
        return {
            type: "stair",
            stair,
            stairId: stair.id,
            stairKind: "straight",
            treadIndex,
            upDown,
            leftRight,
            baseZ,
            point,
            local
        };
    }

    function treadPathSteppedBaseZ(lowerZ, higherZ, stepCount, treadIndex) {
        const low = finiteNumber(lowerZ, "tread path lowerZ");
        const high = finiteNumber(higherZ, "tread path higherZ");
        const count = Number.isFinite(Number(stepCount)) ? Math.max(1, Math.round(Number(stepCount))) : 1;
        const index = Number.isFinite(Number(treadIndex)) ? Math.round(Number(treadIndex)) : 0;
        if (index < 0 || index >= count) {
            throw new Error(`tread path stair has invalid tread index ${index}`);
        }
        return low + (high - low) * ((index + 1) / count);
    }

    function supportFromPathLocal(stair, frame, local) {
        if (!stair || !frame || !local) throw new Error("tread path stair support requires stair, frame, and local point");
        const upDown = clamp01(local.upDown);
        const leftRight = Math.max(0, Math.min(1, Number(local.leftRight)));
        const stepCount = Number.isFinite(stair.stepCount) ? Math.max(1, Math.round(Number(stair.stepCount))) : 1;
        const treadIndex = Math.max(0, Math.min(stepCount - 1, Math.floor(upDown * stepCount)));
        const baseZ = treadPathSteppedBaseZ(frame.lowerZ, frame.higherZ, stepCount, treadIndex);
        const point = pointFromPathLocal(frame, upDown, leftRight);
        return {
            type: "stair",
            stair,
            stairId: stair.id,
            stairKind: "treadPath",
            treadIndex,
            upDown,
            leftRight,
            baseZ,
            point,
            local
        };
    }

    function moveStraightLocal(frame, currentLocal, movementVector, deltaSeconds, speed = 1) {
        if (!frame || frame.kind !== "straight") throw new Error("straight stair movement requires a straight frame");
        const x = Number(movementVector && movementVector.x) || 0;
        const y = Number(movementVector && movementVector.y) || 0;
        const dt = Math.max(0, Number(deltaSeconds) || 0);
        const scalar = Math.max(0, Number(speed) || 0) * dt;
        const surfaceLength = finiteNumber(frame.surfaceLength, `stair ${frame.stairId} surfaceLength`);
        if (!(surfaceLength > EPSILON)) throw new Error(`stair ${frame.stairId} movement requires positive surface length`);
        const along = (x * frame.along.x + y * frame.along.y) * scalar;
        const side = (x * frame.cross.x + y * frame.cross.y) * scalar;
        return {
            upDown: Number(currentLocal.upDown) + along / surfaceLength,
            leftRight: Number(currentLocal.leftRight) + side / frame.width
        };
    }

    function pathTangentAt(frame, upDown, leftRight) {
        const delta = 0.001;
        const low = Math.max(0, Number(upDown) - delta);
        const high = Math.min(1, Number(upDown) + delta);
        const a = pointFromPathLocal(frame, low, leftRight);
        const b = pointFromPathLocal(frame, high, leftRight);
        const length = pointDistance(a, b);
        if (!(length > EPSILON)) return { x: 0, y: 0, length: 0 };
        return { x: (b.x - a.x) / length, y: (b.y - a.y) / length, length };
    }

    function exitPointFromPathLocal(frame, local) {
        if (!frame || frame.kind !== "treadPath") throw new Error("tread path exit point requires a tread path frame");
        if (!local || !Number.isFinite(Number(local.upDown)) || !Number.isFinite(Number(local.leftRight))) {
            throw new Error(`stair ${frame.stairId} exit point requires finite stair-local coordinates`);
        }
        const upDown = Number(local.upDown);
        const leftRight = clamp01(local.leftRight);
        if (upDown >= 0 && upDown <= 1) return pointFromPathLocal(frame, upDown, leftRight);
        const endpointUpDown = upDown < 0 ? 0 : 1;
        const overflowDistance = Math.abs(upDown < 0 ? upDown : upDown - 1) * frame.pathLength;
        const endpointPoint = pointFromPathLocal(frame, endpointUpDown, leftRight);
        const tangent = pathTangentAt(frame, endpointUpDown, leftRight);
        if (!(tangent.length > EPSILON)) {
            throw new Error(`stair ${frame.stairId} exit point requires a non-degenerate path tangent`);
        }
        const sign = upDown < 0 ? -1 : 1;
        return {
            x: endpointPoint.x + tangent.x * overflowDistance * sign,
            y: endpointPoint.y + tangent.y * overflowDistance * sign
        };
    }

    function movePathLocal(frame, currentLocal, movementVector, deltaSeconds, speed = 1) {
        if (!frame || frame.kind !== "treadPath") throw new Error("tread path movement requires a tread path frame");
        const x = Number(movementVector && movementVector.x) || 0;
        const y = Number(movementVector && movementVector.y) || 0;
        const dt = Math.max(0, Number(deltaSeconds) || 0);
        const scalar = Math.max(0, Number(speed) || 0) * dt;
        const section = sectionForUpDown(frame, currentLocal.upDown);
        const span = Math.max(EPSILON, section.endU - section.startU);
        const sectionT = clamp01((clamp01(currentLocal.upDown) - section.startU) / span);
        const crossline = sectionCrossline(section, sectionT);
        const sideUnit = crossline.length > EPSILON
            ? { x: crossline.dx / crossline.length, y: crossline.dy / crossline.length }
            : { x: 0, y: 0 };
        const tangent = pathTangentAt(frame, currentLocal.upDown, currentLocal.leftRight);
        const surfaceLength = finiteNumber(frame.surfaceLength, `stair ${frame.stairId} surfaceLength`);
        if (!(surfaceLength > EPSILON)) throw new Error(`stair ${frame.stairId} movement requires positive surface length`);
        const along = (x * tangent.x + y * tangent.y) * scalar;
        const side = (x * sideUnit.x + y * sideUnit.y) * scalar;
        return {
            upDown: Number(currentLocal.upDown) + along / surfaceLength,
            leftRight: Number(currentLocal.leftRight) + (crossline.length > EPSILON ? side / crossline.length : 0),
            projectionError: 0
        };
    }

    function pathPolygonForUpDownRange(frame, startUpDown, endUpDown, sampleCount = 24) {
        if (!frame || frame.kind !== "treadPath") throw new Error("tread path polygon requires a tread path frame");
        const start = clamp01(startUpDown);
        const end = clamp01(endUpDown);
        if (Math.abs(end - start) <= EPSILON) return [];
        const low = Math.min(start, end);
        const high = Math.max(start, end);
        const count = Math.max(2, Math.round(Number(sampleCount) || 24));
        const sideA = [];
        const sideB = [];
        for (let i = 0; i <= count; i++) {
            const u = low + (high - low) * (i / count);
            sideA.push(pointFromPathLocal(frame, u, 0));
            sideB.push(pointFromPathLocal(frame, u, 1));
        }
        return [...sideA, ...sideB.reverse()];
    }

    function endpointLineForPathFrame(frame, endpoint) {
        if (!frame || frame.kind !== "treadPath") throw new Error("tread path endpoint line requires a tread path frame");
        const upDown = endpoint === "lower" ? 0 : (endpoint === "higher" ? 1 : null);
        if (upDown === null) throw new Error(`unknown stair endpoint: ${endpoint}`);
        return {
            a: pointFromPathLocal(frame, upDown, 0),
            b: pointFromPathLocal(frame, upDown, 1)
        };
    }

    function endpointLineCrossed(frame, previousPoint, nextPoint, endpoint) {
        const previous = finitePoint(previousPoint, `stair ${frame && frame.stairId ? frame.stairId : "(unknown)"} previous point`);
        const next = finitePoint(nextPoint, `stair ${frame && frame.stairId ? frame.stairId : "(unknown)"} next point`);
        const line = endpointLineForPathFrame(frame, endpoint);
        return segmentsIntersect(previous, next, line.a, line.b);
    }

    function endpointMouthProjectionOptions(stair, endpoint) {
        if (endpoint !== "lower" && endpoint !== "higher") throw new Error(`unknown stair endpoint: ${endpoint}`);
        const stepCount = Number.isFinite(Number(stair && stair.stepCount))
            ? Math.max(1, Math.round(Number(stair.stepCount)))
            : 1;
        const mouthRange = Math.max(0.05, 1 / stepCount);
        return endpoint === "lower"
            ? { upDownHint: 0, maxUpDown: mouthRange }
            : { upDownHint: 1, minUpDown: 1 - mouthRange };
    }

    function pathEndpointEntryState(frame, previousPoint, nextPoint, endpoint, options = {}) {
        if (!frame || frame.kind !== "treadPath") throw new Error("tread path endpoint entry requires a tread path frame");
        if (endpoint !== "lower" && endpoint !== "higher") throw new Error(`unknown stair endpoint: ${endpoint}`);
        const projectionOptions = endpointMouthProjectionOptions(options && options.stair, endpoint);
        const previousLocal = localPointForPathFrame(frame, previousPoint, projectionOptions);
        const nextLocal = localPointForPathFrame(frame, nextPoint, projectionOptions);
        const previousUpDown = Number(previousLocal.upDown);
        const nextUpDown = Number(nextLocal.upDown);
        if (!Number.isFinite(previousUpDown) || !Number.isFinite(nextUpDown)) {
            return { enters: false, previousLocal, nextLocal, directionMatches: false, crossedEndpoint: false, footprintReachedEndpoint: false };
        }
        const directionMatches = endpoint === "lower"
            ? nextUpDown > previousUpDown + EPSILON
            : nextUpDown < previousUpDown - EPSILON;
        const crossedEndpoint = endpointLineCrossed(frame, previousPoint, nextPoint, endpoint);
        const radius = Math.max(0, Number(options && options.actorRadius) || 0);
        const frontEdgeTolerance = radius / Math.max(0.001, Number(frame.pathLength) || 0);
        const footprintReachedEndpoint = endpoint === "lower"
            ? previousUpDown <= EPSILON && nextUpDown >= -frontEdgeTolerance - EPSILON
            : previousUpDown >= 1 - EPSILON && nextUpDown <= 1 + frontEdgeTolerance + EPSILON;
        const crossesEndpointWidth = Number.isFinite(nextLocal.leftRight) &&
            nextLocal.leftRight >= -EPSILON &&
            nextLocal.leftRight <= 1 + EPSILON;
        return {
            enters: directionMatches && crossedEndpoint && crossesEndpointWidth,
            previousLocal,
            nextLocal,
            directionMatches,
            crossedEndpoint,
            footprintReachedEndpoint,
            crossesEndpointWidth
        };
    }

    const api = {
        EPSILON,
        createStraightFrame,
        createTreadPathFrame,
        localPointForStraightFrame,
        localPointForPathFrame,
        localInsideStraightFrame,
        localInsidePathFrame,
        localFootprintOverlapsPathFrame,
        endpointCrossed,
        supportFromStraightLocal,
        supportFromPathLocal,
        treadPathSteppedBaseZ,
        moveStraightLocal,
        movePathLocal,
        pointFromLocal,
        pointFromPathLocal,
        exitPointFromPathLocal,
        pathPolygonForUpDownRange,
        endpointLineForPathFrame,
        endpointLineCrossed,
        endpointMouthProjectionOptions,
        pathEndpointEntryState
    };

    globalScope.StairTraversal = api;
    if (typeof module !== "undefined" && module && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
