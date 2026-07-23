(function () {
    "use strict";

    function createMazeSectionSystem(deps) {
        const constants = deps && deps.constants;
        const math = deps && deps.math;
        if (!constants || typeof constants !== "object") throw new Error("Wizard of Flatland maze sections require constants");
        if (!math || typeof math.getHexCornersWorld !== "function") {
            throw new Error("Wizard of Flatland maze sections require hex corner geometry");
        }

        function getMazeSectionRadius(options) {
            return Math.max(8, Number(options.chunkSize) * 0.5);
        }

        function mazeSectionKey(q, r) {
            return `${q},${r}`;
        }

        function isMazeInitialSafeSectionKey(sectionKey) {
            validateMazeSectionKey(sectionKey, "initial safe section check");
            const coord = parseMazeSectionKey(sectionKey);
            return getMazeSectionRing(coord.q, coord.r) <= 1;
        }

        function isMazePyramidRoomSectionKey(sectionKey) {
            validateMazeSectionKey(sectionKey, "pyramid room check");
            const coord = parseMazeSectionKey(sectionKey);
            return isMazePyramidRoomSectionCoord(coord.q, coord.r);
        }

        function isMazePyramidRoomSectionCoord(q, r) {
            return getMazePyramidRoomDistance(q, r) !== null;
        }

        function getMazePyramidRoomDistance(q, r) {
            if (!Number.isInteger(q) || !Number.isInteger(r)) {
                throw new Error("Wizard of Flatland pyramid room check requires integer section coordinates");
            }
            if (q === 0 && r === 0) return 0;
            for (const dir of constants.MAZE_SECTION_DIRECTIONS) {
                if (!dir) throw new Error("Wizard of Flatland pyramid direction is invalid");
                const distance = dir.q !== 0 ? q / dir.q : r / dir.r;
                if (!Number.isInteger(distance) || distance < constants.PYRAMID_FIRST_ROOM_DISTANCE) continue;
                if (q !== dir.q * distance || r !== dir.r * distance) continue;
                if ((distance - constants.PYRAMID_FIRST_ROOM_DISTANCE) % constants.PYRAMID_ROOM_DISTANCE_STEP !== 0) continue;
                return distance;
            }
            return null;
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

        function getMazeSectionRing(q, r) {
            if (!Number.isInteger(q) || !Number.isInteger(r)) {
                throw new Error("Wizard of Flatland section ring requires integer coordinates");
            }
            return Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
        }

        function getMazeSectionPolygonForCoord(coord, options) {
            if (!coord || !Number.isFinite(coord.q) || !Number.isFinite(coord.r)) {
                throw new Error("Wizard of Flatland section polygon requires a section coordinate");
            }
            const center = mazeSectionCenter(coord.q, coord.r, options);
            return math.getHexCornersWorld(center.x, center.y, getMazeSectionRadius(options));
        }

        function validateMazeSectionKey(sectionKey, context) {
            if (typeof sectionKey !== "string" || sectionKey.length === 0) {
                throw new Error(`Wizard of Flatland ${context} requires a section key`);
            }
        }

        return Object.freeze({
            getMazeSectionRadius,
            mazeSectionKey,
            isMazeInitialSafeSectionKey,
            isMazePyramidRoomSectionKey,
            isMazePyramidRoomSectionCoord,
            getMazePyramidRoomDistance,
            parseMazeSectionKey,
            mazeSectionCenter,
            worldToMazeSectionCoord,
            roundAxial,
            getMazeSectionRing,
            getMazeSectionPolygonForCoord
        });
    }

    window.WizardFlatlandMazeSections = Object.freeze({
        createMazeSectionSystem
    });
}());
