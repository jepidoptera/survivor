(function (globalScope) {
    "use strict";

    const SECTION_DIRECTIONS = [
        { q: 1, r: 0 },
        { q: 1, r: -1 },
        { q: 0, r: -1 },
        { q: -1, r: 0 },
        { q: -1, r: 1 },
        { q: 0, r: 1 }
    ];

    function evenQOffsetToAxial(x, y) {
        return {
            q: x,
            r: y - ((x + (x & 1)) / 2)
        };
    }

    function axialToEvenQOffset(coord) {
        const q = Number(coord.q) || 0;
        const r = Number(coord.r) || 0;
        return {
            x: q,
            y: r + ((q + (q & 1)) / 2)
        };
    }

    function offsetToWorld(offsetCoord) {
        const x = Number(offsetCoord && offsetCoord.x) || 0;
        const y = Number(offsetCoord && offsetCoord.y) || 0;
        return {
            x: x * 0.866,
            y: y + (x % 2 === 0 ? 0.5 : 0)
        };
    }

    function axialDistance(a, b) {
        const dq = Number(a.q) - Number(b.q);
        const dr = Number(a.r) - Number(b.r);
        const ds = (-Number(a.q) - Number(a.r)) - (-Number(b.q) - Number(b.r));
        return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
    }

    function getSectionStride(radius) {
        return Math.max(1, Math.floor(Number(radius) || 1) * 2 - 1);
    }

    function getSectionBasisVectors(radius) {
        const sectionRadius = Math.max(1, Math.floor(Number(radius)) || 1);
        return {
            qAxis: {
                q: getSectionStride(sectionRadius),
                r: -(sectionRadius - 1)
            },
            rAxis: {
                q: sectionRadius - 1,
                r: sectionRadius
            }
        };
    }

    function computeSectionCenterAxial(sectionCoord, basis, anchorCenter) {
        return {
            q: (Number(anchorCenter && anchorCenter.q) || 0)
                + ((Number(sectionCoord && sectionCoord.q) || 0) * (Number(basis && basis.qAxis && basis.qAxis.q) || 0))
                + ((Number(sectionCoord && sectionCoord.r) || 0) * (Number(basis && basis.rAxis && basis.rAxis.q) || 0)),
            r: (Number(anchorCenter && anchorCenter.r) || 0)
                + ((Number(sectionCoord && sectionCoord.q) || 0) * (Number(basis && basis.qAxis && basis.qAxis.r) || 0))
                + ((Number(sectionCoord && sectionCoord.r) || 0) * (Number(basis && basis.rAxis && basis.rAxis.r) || 0))
        };
    }

    function estimateOffsetCoordFromWorld(worldX, worldY) {
        const x = Math.round((Number(worldX) || 0) / 0.866);
        const y = Math.round((Number(worldY) || 0) - (x % 2 === 0 ? 0.5 : 0));
        return { x, y };
    }

    function makeSectionKey(coord) {
        return `${Number(coord.q) || 0},${Number(coord.r) || 0}`;
    }

    function parseSectionKey(sectionKey) {
        const [qRaw, rRaw] = String(sectionKey || "").split(",");
        return {
            q: Number(qRaw) || 0,
            r: Number(rRaw) || 0
        };
    }

    function addSectionCoords(a, b) {
        return {
            q: (Number(a.q) || 0) + (Number(b.q) || 0),
            r: (Number(a.r) || 0) + (Number(b.r) || 0)
        };
    }

    function getBubbleKeysForCenter(state, centerKey) {
        if (!state || !(state.sectionsByKey instanceof Map) || !state.sectionsByKey.has(centerKey)) {
            return new Set();
        }
        const centerSection = state.sectionsByKey.get(centerKey);
        const keys = new Set([centerKey]);
        for (let i = 0; i < SECTION_DIRECTIONS.length; i++) {
            const neighborCoord = addSectionCoords(centerSection.coord, SECTION_DIRECTIONS[i]);
            keys.add(makeSectionKey(neighborCoord));
        }
        return keys;
    }

    function resolvePrototypeSectionCoordForWorldPosition(state, worldX, worldY) {
        if (!state) return null;
        const basis = state.basis || getSectionBasisVectors(state.radius);
        const anchorCenter = state.anchorCenter || { q: 0, r: 0 };
        const offsetCoord = estimateOffsetCoordFromWorld(worldX, worldY);
        const axial = evenQOffsetToAxial(offsetCoord.x, offsetCoord.y);
        const localQ = Number(axial.q) - Number(anchorCenter.q || 0);
        const localR = Number(axial.r) - Number(anchorCenter.r || 0);
        const qAxis = basis && basis.qAxis ? basis.qAxis : { q: 0, r: 0 };
        const rAxis = basis && basis.rAxis ? basis.rAxis : { q: 0, r: 0 };
        const det = (Number(qAxis.q) * Number(rAxis.r)) - (Number(rAxis.q) * Number(qAxis.r));

        let approxSectionQ = 0;
        let approxSectionR = 0;
        if (Math.abs(det) > 1e-6) {
            approxSectionQ = ((localQ * Number(rAxis.r)) - (localR * Number(rAxis.q))) / det;
            approxSectionR = ((Number(qAxis.q) * localR) - (Number(qAxis.r) * localQ)) / det;
        }

        const baseQ = Math.round(approxSectionQ);
        const baseR = Math.round(approxSectionR);
        let bestCoord = { q: baseQ, r: baseR };
        let bestAxialDistance = Infinity;
        let bestWorldDistance = Infinity;

        for (let dq = -1; dq <= 1; dq++) {
            for (let dr = -1; dr <= 1; dr++) {
                const candidate = { q: baseQ + dq, r: baseR + dr };
                const centerAxial = computeSectionCenterAxial(candidate, basis, anchorCenter);
                const centerOffset = axialToEvenQOffset(centerAxial);
                const centerWorld = offsetToWorld(centerOffset);
                const candidateAxialDistance = axialDistance(axial, centerAxial);
                const candidateWorldDistance = Math.hypot(
                    Number(worldX) - Number(centerWorld.x),
                    Number(worldY) - Number(centerWorld.y)
                );
                if (
                    candidateAxialDistance < bestAxialDistance ||
                    (candidateAxialDistance === bestAxialDistance && candidateWorldDistance < bestWorldDistance)
                ) {
                    bestCoord = candidate;
                    bestAxialDistance = candidateAxialDistance;
                    bestWorldDistance = candidateWorldDistance;
                }
            }
        }

        return bestCoord;
    }

    const api = {
        SECTION_DIRECTIONS,
        evenQOffsetToAxial,
        axialToEvenQOffset,
        offsetToWorld,
        axialDistance,
        getSectionStride,
        getSectionBasisVectors,
        computeSectionCenterAxial,
        estimateOffsetCoordFromWorld,
        resolvePrototypeSectionCoordForWorldPosition,
        makeSectionKey,
        parseSectionKey,
        addSectionCoords,
        getBubbleKeysForCenter
    };

    globalScope.__sectionGeometry = api;
    globalScope.__twoSectionPrototypeSectionGeometry = api;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionGeometry;
}
