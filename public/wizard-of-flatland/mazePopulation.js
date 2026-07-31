(function () {
    "use strict";

    function createMazePopulationSystem(deps) {
        const constants = deps && deps.constants;
        const math = deps && deps.math;
        const mazeSections = deps && deps.mazeSections;
        const geometry = deps && deps.geometry;
        const state = deps && deps.state;
        if (!constants || typeof constants !== "object") {
            throw new Error("Wizard of Flatland maze population requires constants");
        }
        if (
            !math ||
            typeof math.hashString !== "function" ||
            typeof math.seededRandom !== "function"
        ) {
            throw new Error("Wizard of Flatland maze population requires math helpers");
        }
        if (
            !mazeSections ||
            typeof mazeSections.isMazePyramidRoomSectionKey !== "function" ||
            typeof mazeSections.isMazeInitialSafeSectionKey !== "function" ||
            typeof mazeSections.getMazePyramidRoomDistance !== "function" ||
            typeof mazeSections.parseMazeSectionKey !== "function" ||
            typeof mazeSections.getMazeSectionRing !== "function" ||
            typeof mazeSections.mazeSectionCenter !== "function" ||
            typeof mazeSections.getMazeSectionPolygonForCoord !== "function"
        ) {
            throw new Error("Wizard of Flatland maze population requires maze section helpers");
        }
        if (!geometry || typeof geometry.isPointInOrNearPolygon !== "function") {
            throw new Error("Wizard of Flatland maze population requires polygon geometry helpers");
        }
        if (!state || typeof state !== "object") {
            throw new Error("Wizard of Flatland maze population requires state");
        }

        function validateMazeRoomEnemyBudgetSectionKey(sectionKey) {
            if (typeof sectionKey !== "string" || sectionKey.length === 0) {
                throw new Error("Wizard of Flatland enemy spawn budget requires a section key");
            }
        }

        function getMazeRoomEnemyCount(sectionKey, options) {
            if (typeof sectionKey !== "string" || sectionKey.length === 0) {
                throw new Error("Wizard of Flatland enemy count requires a section key");
            }
            if (mazeSections.isMazePyramidRoomSectionKey(sectionKey)) return 0;
            if (mazeSections.isMazeInitialSafeSectionKey(sectionKey)) return 0;
            const maxEnemies = getMazeRoomMaxEnemyCount(sectionKey);
            const random = math.seededRandom(math.hashString(`${options.seed}|enemy-count|${sectionKey}`));
            const roll = random();
            if (roll < constants.MAZE_ROOM_EMPTY_ENEMY_CHANCE) return 0;
            if (roll >= 1 - constants.MAZE_ROOM_MAX_ENEMY_CHANCE) return maxEnemies;
            const nonEmptySpan = 1 - constants.MAZE_ROOM_MAX_ENEMY_CHANCE - constants.MAZE_ROOM_EMPTY_ENEMY_CHANCE;
            if (!(nonEmptySpan > 0)) throw new Error("Wizard of Flatland enemy distribution has no middle span");
            const middleMaxEnemies = maxEnemies - 1;
            if (middleMaxEnemies <= 0) return 1;
            const t = (roll - constants.MAZE_ROOM_EMPTY_ENEMY_CHANCE) / nonEmptySpan;
            return Math.max(
                1,
                Math.min(
                    middleMaxEnemies,
                    Math.ceil(Math.pow(t, constants.MAZE_ROOM_ENEMY_DISTRIBUTION_POWER) * middleMaxEnemies)
                )
            );
        }

        function getMazeRoomMaxEnemyCount(sectionKey) {
            validateMazeRoomEnemyBudgetSectionKey(sectionKey);
            const coord = mazeSections.parseMazeSectionKey(sectionKey);
            const ring = mazeSections.getMazeSectionRing(coord.q, coord.r);
            const earlyCaps = constants.MAZE_ROOM_EARLY_ENEMY_CAPS;
            if (!Array.isArray(earlyCaps) || earlyCaps.length === 0) {
                throw new Error("Wizard of Flatland early enemy caps must be a non-empty array");
            }
            if (earlyCaps.some((cap) => !Number.isInteger(cap) || cap < 0)) {
                throw new Error("Wizard of Flatland early enemy caps must be non-negative integers");
            }
            if (ring < earlyCaps.length) return earlyCaps[ring];
            const finalEarlyRing = earlyCaps.length - 1;
            return earlyCaps[finalEarlyRing] + ring - finalEarlyRing;
        }

        function getEnemyScaleForMazeSectionKey(sectionKey) {
            validateMazeRoomEnemyBudgetSectionKey(sectionKey);
            const coord = mazeSections.parseMazeSectionKey(sectionKey);
            const ring = mazeSections.getMazeSectionRing(coord.q, coord.r);
            return 1 + Math.floor(ring / constants.ENEMY_SCALE_RING_INTERVAL) * constants.ENEMY_SCALE_INCREMENT;
        }

        function getEnemyDamageScaleForMazeSectionKey(sectionKey) {
            validateMazeRoomEnemyBudgetSectionKey(sectionKey);
            const coord = mazeSections.parseMazeSectionKey(sectionKey);
            const ring = mazeSections.getMazeSectionRing(coord.q, coord.r);
            const zone = Math.floor(ring / constants.MAZE_RING_BOUNDARY_INTERVAL);
            return constants.ENEMY_DAMAGE_BASE_SCALE * constants.ENEMY_DAMAGE_ZONE_MULTIPLIER ** zone;
        }

        function createMazeCoinsForSection(sectionKey, options) {
            const coord = mazeSections.parseMazeSectionKey(sectionKey);
            const count = getMazeCoinCount(sectionKey, options);
            const sectionPolygon = mazeSections.getMazeSectionPolygonForCoord(coord, options);
            const spanSelection = getMazeCoinSpanSelectionForSection(sectionKey);
            if (!(spanSelection.totalLength > 0)) {
                throw new Error(`Wizard of Flatland coin placement found no usable spans for section ${sectionKey}`);
            }
            const random = math.seededRandom(math.hashString(`${options.seed}|coin-position|${sectionKey}`));
            const coins = [];
            for (let coinIndex = 0; coinIndex < count; coinIndex++) {
                const key = getMazeCoinKey(options, sectionKey, coinIndex);
                const coin = createMazeCoinForSectionSlot(
                    sectionKey,
                    coord,
                    key,
                    spanSelection,
                    random,
                    sectionPolygon
                );
                coins.push(coin);
            }
            return coins;
        }

        function getMazeCoinCount(sectionKey, options) {
            if (typeof sectionKey !== "string" || sectionKey.length === 0) {
                throw new Error("Wizard of Flatland coin count requires a section key");
            }
            if (mazeSections.isMazePyramidRoomSectionKey(sectionKey)) {
                if (!Number.isInteger(constants.MAZE_PYRAMID_COIN_COUNT) || constants.MAZE_PYRAMID_COIN_COUNT < 0) {
                    throw new Error("Wizard of Flatland pyramid coin count must be a non-negative integer");
                }
                return constants.MAZE_PYRAMID_COIN_COUNT;
            }
            const random = math.seededRandom(math.hashString(`${options.seed}|coin-count|${sectionKey}`));
            const coord = mazeSections.parseMazeSectionKey(sectionKey);
            const ring = mazeSections.getMazeSectionRing(coord.q, coord.r);
            const zone = Math.floor(ring / constants.MAZE_RING_BOUNDARY_INTERVAL);
            const scaledAverage = constants.MAZE_COIN_AVERAGE_COUNT
                * constants.MAZE_COIN_ZONE_MULTIPLIER ** zone;
            const midpoint = (constants.MAZE_COIN_MIN_COUNT + constants.MAZE_COIN_MAX_COUNT) * 0.5;
            const offset = constants.MAZE_COIN_MIN_COUNT
                + Math.floor(random() * (constants.MAZE_COIN_MAX_COUNT - constants.MAZE_COIN_MIN_COUNT + 1))
                - midpoint;
            const lowerAverage = Math.floor(scaledAverage);
            const roundedAverage = lowerAverage
                + (random() < scaledAverage - lowerAverage ? 1 : 0);
            return Math.max(1, roundedAverage + offset);
        }

        function getMazeCoinKey(options, sectionKey, coinIndex) {
            if (!Number.isInteger(coinIndex) || coinIndex < 0) {
                throw new Error("Wizard of Flatland coin key requires a valid coin index");
            }
            return `${options.seed}|${options.chunkSize}|${options.roomScale.toFixed(3)}|${options.twistiness.toFixed(3)}|${sectionKey}|${coinIndex}`;
        }

        function createMazeTalismanForSection(sectionKey, options, homeBaseSectionKey) {
            validateMazeRoomEnemyBudgetSectionKey(sectionKey);
            const coord = mazeSections.parseMazeSectionKey(sectionKey);
            const pyramidDistance = mazeSections.getMazePyramidRoomDistance(coord.q, coord.r);
            if (pyramidDistance === null) return null;
            const center = mazeSections.mazeSectionCenter(coord.q, coord.r, options);
            return {
                key: `talisman|${options.seed}|${options.chunkSize}|${options.roomScale.toFixed(3)}|${options.twistiness.toFixed(3)}|${sectionKey}`,
                sectionKey,
                q: coord.q,
                r: coord.r,
                pyramidDistance,
                x: center.x,
                y: center.y,
                radius: constants.TALISMAN_RADIUS,
                activated: sectionKey === homeBaseSectionKey,
                flashSeconds: 0,
                blockedFlashSeconds: 0,
                gameSavedPromptSeconds: 0,
                touching: false
            };
        }

        function getMazeCoinSpanSelectionForSection(sectionKey) {
            if (typeof sectionKey !== "string" || sectionKey.length === 0) {
                throw new Error("Wizard of Flatland coin span lookup requires a section key");
            }
            const spans = state.generatedMazeCoinSpans;
            const ranges = state.generatedMazeCoinSpanSectionRanges;
            if (!(spans instanceof Float32Array) || spans.length % constants.COIN_SPAN_STRIDE !== 0) {
                throw new Error("Wizard of Flatland coin span lookup requires a packed span buffer");
            }
            if (!Array.isArray(ranges)) {
                throw new Error("Wizard of Flatland coin span lookup requires section ranges");
            }
            const range = ranges.find((candidate) => candidate.sectionKey === sectionKey);
            if (!range) throw new Error(`Wizard of Flatland coin span lookup found no range for section ${sectionKey}`);
            const entries = [];
            let totalLength = 0;
            const endSpanIndex = range.startSpanIndex + range.spanCount;
            for (let spanIndex = range.startSpanIndex; spanIndex < endSpanIndex; spanIndex++) {
                const base = spanIndex * constants.COIN_SPAN_STRIDE;
                const length = Math.hypot(
                    spans[base + constants.COIN_SPAN_X2] - spans[base + constants.COIN_SPAN_X1],
                    spans[base + constants.COIN_SPAN_Y2] - spans[base + constants.COIN_SPAN_Y1]
                );
                if (!(length > 0)) throw new Error(`Wizard of Flatland coin span ${spanIndex} has invalid length`);
                totalLength += length;
                entries.push({ base, cumulativeLength: totalLength });
            }
            return { entries, totalLength };
        }

        function createMazeCoinForSectionSlot(sectionKey, coord, key, spanSelection, random, sectionPolygon) {
            if (typeof random !== "function") throw new Error("Wizard of Flatland coin placement requires a random source");
            if (!spanSelection || !(spanSelection.totalLength > 0) || !Array.isArray(spanSelection.entries)) {
                throw new Error("Wizard of Flatland coin placement requires usable span selection");
            }
            const selectedDistance = random() * spanSelection.totalLength;
            const entry = spanSelection.entries.find((candidate) => selectedDistance < candidate.cumulativeLength)
                || spanSelection.entries[spanSelection.entries.length - 1];
            if (!entry) throw new Error(`Wizard of Flatland coin placement failed to select a span for ${sectionKey}`);
            const spans = state.generatedMazeCoinSpans;
            const base = entry.base;
            const t = random();
            const wallDistance = constants.MAZE_COIN_MIN_WALL_DISTANCE
                + random() * (spans[base + constants.COIN_SPAN_MAX_DISTANCE] - constants.MAZE_COIN_MIN_WALL_DISTANCE);
            const x = spans[base + constants.COIN_SPAN_X1]
                + (spans[base + constants.COIN_SPAN_X2] - spans[base + constants.COIN_SPAN_X1]) * t
                + spans[base + constants.COIN_SPAN_NORMAL_X] * wallDistance;
            const y = spans[base + constants.COIN_SPAN_Y1]
                + (spans[base + constants.COIN_SPAN_Y2] - spans[base + constants.COIN_SPAN_Y1]) * t
                + spans[base + constants.COIN_SPAN_NORMAL_Y] * wallDistance;
            if (!geometry.isPointInOrNearPolygon(x, y, sectionPolygon, constants.MAZE_COIN_SECTION_EDGE_EPSILON)) {
                throw new Error(`Wizard of Flatland coin span placed ${key} outside section ${sectionKey}`);
            }
            const wallIndex = spans[base + constants.COIN_SPAN_WALL_INDEX];
            if (!Number.isInteger(wallIndex) || wallIndex < 0) {
                throw new Error(`Wizard of Flatland coin span for ${key} has invalid wall index`);
            }
            const trophy = shouldCreateMazeTrophyForCoin(sectionKey, key);
            return {
                key,
                sectionKey,
                q: coord.q,
                r: coord.r,
                wallIndex,
                x,
                y,
                homeX: x,
                homeY: y,
                radius: trophy ? constants.MAZE_TROPHY_RADIUS : constants.MAZE_COIN_RADIUS,
                kind: trophy ? "trophy" : "coin",
                value: trophy ? constants.MAZE_TROPHY_VALUE : constants.MAZE_COIN_VALUE,
                rushing: false,
                phase: random() * Math.PI * 2
            };
        }

        function shouldCreateMazeTrophyForCoin(sectionKey, coinKey) {
            if (mazeSections.isMazePyramidRoomSectionKey(sectionKey)) return false;
            const coord = mazeSections.parseMazeSectionKey(sectionKey);
            const roomDistance = mazeSections.getMazeSectionRing(coord.q, coord.r);
            const chance = getMazeTrophyChanceForRoomDistance(roomDistance);
            if (chance <= 0) return false;
            const random = math.seededRandom(math.hashString(`${coinKey}|trophy`));
            return random() < chance;
        }

        function getMazeTrophyChanceForRoomDistance(roomDistance) {
            if (!Number.isInteger(roomDistance) || roomDistance < 0) {
                throw new Error("Wizard of Flatland trophy chance requires a non-negative room distance");
            }
            if (roomDistance <= 4) return 0;
            if (roomDistance <= 6) return 0.01;
            if (roomDistance <= 14) return 0.015;
            return 0.015 + Math.ceil((roomDistance - 14) / 7) * 0.005;
        }

        return Object.freeze({
            validateMazeRoomEnemyBudgetSectionKey,
            getMazeRoomEnemyCount,
            getMazeRoomMaxEnemyCount,
            getEnemyScaleForMazeSectionKey,
            getEnemyDamageScaleForMazeSectionKey,
            createMazeCoinsForSection,
            getMazeCoinCount,
            getMazeCoinKey,
            createMazeTalismanForSection
        });
    }

    window.WizardFlatlandMazePopulation = Object.freeze({
        createMazePopulationSystem
    });
}());
