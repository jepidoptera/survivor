(function () {
    "use strict";

    function createMazePopulationSystem(deps) {
        const constants = deps && deps.constants;
        const math = deps && deps.math;
        const mazeSections = deps && deps.mazeSections;
        if (!constants || typeof constants !== "object") {
            throw new Error("Wizard of Flatland maze population requires constants");
        }
        if (!math || typeof math.hashString !== "function" || typeof math.seededRandom !== "function") {
            throw new Error("Wizard of Flatland maze population requires seeded random helpers");
        }
        if (
            !mazeSections ||
            typeof mazeSections.isMazePyramidRoomSectionKey !== "function" ||
            typeof mazeSections.isMazeInitialSafeSectionKey !== "function" ||
            typeof mazeSections.parseMazeSectionKey !== "function" ||
            typeof mazeSections.getMazeSectionRing !== "function"
        ) {
            throw new Error("Wizard of Flatland maze population requires maze section helpers");
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

        return Object.freeze({
            validateMazeRoomEnemyBudgetSectionKey,
            getMazeRoomEnemyCount,
            getMazeRoomMaxEnemyCount,
            getEnemyScaleForMazeSectionKey
        });
    }

    window.WizardFlatlandMazePopulation = Object.freeze({
        createMazePopulationSystem
    });
}());
