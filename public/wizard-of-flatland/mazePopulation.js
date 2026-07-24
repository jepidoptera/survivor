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
            typeof math.seededRandom !== "function" ||
            typeof math.pointSegmentDistance !== "function"
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
            return Math.max(1, constants.MAZE_ROOM_BASE_ENEMY_CAP + ring - constants.MAZE_ROOM_BASE_ENEMY_CAP_RING);
        }

        function getEnemyScaleForMazeSectionKey(sectionKey) {
            validateMazeRoomEnemyBudgetSectionKey(sectionKey);
            const coord = mazeSections.parseMazeSectionKey(sectionKey);
            const ring = mazeSections.getMazeSectionRing(coord.q, coord.r);
            return 1 + Math.floor(ring / constants.ENEMY_SCALE_RING_INTERVAL) * constants.ENEMY_SCALE_INCREMENT;
        }

        function createMazeCoinsForSection(sectionKey, options, existingCoins) {
            if (mazeSections.isMazePyramidRoomSectionKey(sectionKey)) return [];
            const coord = mazeSections.parseMazeSectionKey(sectionKey);
            const count = getMazeCoinCount(sectionKey, options);
            const sectionPolygon = mazeSections.getMazeSectionPolygonForCoord(coord, options);
            const eligibleWalls = getMazeCoinEligibleWallsForSection(sectionKey, sectionPolygon);
            if (eligibleWalls.length === 0) {
                throw new Error(`Wizard of Flatland coin placement found no eligible walls for section ${sectionKey}`);
            }
            const random = math.seededRandom(math.hashString(`${options.seed}|coin-position|${sectionKey}`));
            const coins = [];
            for (let coinIndex = 0; coinIndex < count; coinIndex++) {
                const key = getMazeCoinKey(options, sectionKey, coinIndex);
                const coin = createMazeCoinForSectionSlot(
                    sectionKey,
                    coord,
                    coinIndex,
                    key,
                    eligibleWalls,
                    random,
                    sectionPolygon,
                    existingCoins.concat(coins)
                );
                coins.push(coin);
            }
            return coins;
        }

        function getMazeCoinCount(sectionKey, options) {
            if (typeof sectionKey !== "string" || sectionKey.length === 0) {
                throw new Error("Wizard of Flatland coin count requires a section key");
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
                touching: false
            };
        }

        function getMazeCoinEligibleWallsForSection(sectionKey, sectionPolygon) {
            if (typeof sectionKey !== "string" || sectionKey.length === 0) {
                throw new Error("Wizard of Flatland coin wall lookup requires a section key");
            }
            const walls = [];
            for (let i = 0; i < state.generatedMazeWalls.length; i += constants.WALL_STRIDE) {
                const ax = state.generatedMazeWalls[i + constants.WALL_X1];
                const ay = state.generatedMazeWalls[i + constants.WALL_Y1];
                const bx = state.generatedMazeWalls[i + constants.WALL_X2];
                const by = state.generatedMazeWalls[i + constants.WALL_Y2];
                if (!geometry.isPointInOrNearPolygon(ax, ay, sectionPolygon, constants.MAZE_COIN_SECTION_EDGE_EPSILON)) continue;
                if (!geometry.isPointInOrNearPolygon(bx, by, sectionPolygon, constants.MAZE_COIN_SECTION_EDGE_EPSILON)) continue;
                walls.push({
                    wallIndex: i / constants.WALL_STRIDE,
                    ax,
                    ay,
                    bx,
                    by,
                    length: Math.hypot(bx - ax, by - ay)
                });
            }
            return walls;
        }

        function createMazeCoinForSectionSlot(sectionKey, coord, coinIndex, key, eligibleWalls, random, sectionPolygon, existingCoins) {
            if (typeof random !== "function") throw new Error("Wizard of Flatland coin placement requires a random source");
            const attempts = constants.MAZE_COIN_PLACEMENT_ATTEMPTS_PER_COIN;
            for (let attempt = 0; attempt < attempts; attempt++) {
                const wall = eligibleWalls[Math.floor(random() * eligibleWalls.length)];
                if (!wall || !(wall.length > 0.001)) continue;
                const candidate = createMazeCoinCandidateFromWall(wall, random);
                if (!candidate) continue;
                const validation = validateMazeCoinCandidate(candidate, wall, sectionPolygon, existingCoins);
                if (!validation.ok) continue;
                const trophy = shouldCreateMazeTrophyForCoin(sectionKey, key);
                return {
                    key,
                    sectionKey,
                    q: coord.q,
                    r: coord.r,
                    wallIndex: wall.wallIndex,
                    x: candidate.x,
                    y: candidate.y,
                    homeX: candidate.x,
                    homeY: candidate.y,
                    radius: trophy ? constants.MAZE_TROPHY_RADIUS : constants.MAZE_COIN_RADIUS,
                    kind: trophy ? "trophy" : "coin",
                    value: trophy ? constants.MAZE_TROPHY_VALUE : constants.MAZE_COIN_VALUE,
                    rushing: false,
                    phase: random() * Math.PI * 2
                };
            }
            throw new Error(`Wizard of Flatland coin placement failed for section ${sectionKey} coin ${coinIndex} after ${attempts} attempts`);
        }

        function shouldCreateMazeTrophyForCoin(sectionKey, coinKey) {
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

        function createMazeCoinCandidateFromWall(wall, random) {
            const dx = wall.bx - wall.ax;
            const dy = wall.by - wall.ay;
            const length = Math.hypot(dx, dy);
            if (!(length > constants.MAZE_COIN_WALL_ENDPOINT_MARGIN * 2)) return null;
            const minT = constants.MAZE_COIN_WALL_ENDPOINT_MARGIN / length;
            const maxT = 1 - minT;
            const t = minT + random() * (maxT - minT);
            const baseX = wall.ax + dx * t;
            const baseY = wall.ay + dy * t;
            const normalX = -dy / length;
            const normalY = dx / length;
            const side = random() < 0.5 ? -1 : 1;
            return {
                x: baseX + normalX * side * constants.MAZE_COIN_OWNING_WALL_DISTANCE,
                y: baseY + normalY * side * constants.MAZE_COIN_OWNING_WALL_DISTANCE
            };
        }

        function validateMazeCoinCandidate(candidate, owningWall, sectionPolygon, existingCoins) {
            if (!candidate || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
                throw new Error("Wizard of Flatland coin placement candidate requires finite coordinates");
            }
            const owningDistance = math.pointSegmentDistance(
                candidate.x,
                candidate.y,
                owningWall.ax,
                owningWall.ay,
                owningWall.bx,
                owningWall.by
            );
            if (Math.abs(owningDistance - constants.MAZE_COIN_OWNING_WALL_DISTANCE) > 0.001) {
                return { ok: false, reason: "owning-wall-distance" };
            }
            if (!geometry.isPointInOrNearPolygon(candidate.x, candidate.y, sectionPolygon, constants.MAZE_COIN_SECTION_EDGE_EPSILON)) {
                return { ok: false, reason: "outside-owner-section" };
            }
            for (let i = 0; i < state.walls.length; i += constants.WALL_STRIDE) {
                if (i / constants.WALL_STRIDE === owningWall.wallIndex) continue;
                const distance = math.pointSegmentDistance(
                    candidate.x,
                    candidate.y,
                    state.walls[i + constants.WALL_X1],
                    state.walls[i + constants.WALL_Y1],
                    state.walls[i + constants.WALL_X2],
                    state.walls[i + constants.WALL_Y2]
                );
                if (distance < constants.MAZE_COIN_OTHER_WALL_MIN_DISTANCE) {
                    return { ok: false, reason: "other-wall-clearance" };
                }
            }
            for (const coin of existingCoins) {
                if (Math.hypot(coin.x - candidate.x, coin.y - candidate.y) < constants.MAZE_COIN_OTHER_WALL_MIN_DISTANCE) {
                    return { ok: false, reason: "coin-clearance" };
                }
            }
            return { ok: true };
        }

        return Object.freeze({
            validateMazeRoomEnemyBudgetSectionKey,
            getMazeRoomEnemyCount,
            getMazeRoomMaxEnemyCount,
            getEnemyScaleForMazeSectionKey,
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
