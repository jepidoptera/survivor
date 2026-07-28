(function () {
    "use strict";

    function createEnemyActivationSystem(deps) {
        const constants = deps && deps.constants;
        const mazeSections = deps && deps.mazeSections;
        if (
            !constants
            || !(constants.ENEMY_WAKE_DISTANCE_METERS > 0)
            || !Number.isInteger(constants.ENEMY_SLEEP_SECTION_DISTANCE)
            || constants.ENEMY_SLEEP_SECTION_DISTANCE < 1
        ) {
            throw new Error("Wizard of Flatland enemy activation requires valid distance constants");
        }
        if (
            !mazeSections
            || typeof mazeSections.worldToMazeSectionCoord !== "function"
            || typeof mazeSections.mazeSectionKey !== "function"
            || typeof mazeSections.parseMazeSectionKey !== "function"
        ) {
            throw new Error("Wizard of Flatland enemy activation requires maze section helpers");
        }

        function getSectionDistance(leftKey, rightKey) {
            const left = mazeSections.parseMazeSectionKey(leftKey);
            const right = mazeSections.parseMazeSectionKey(rightKey);
            const dq = left.q - right.q;
            const dr = left.r - right.r;
            return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
        }

        function updateEnemyActivation(agents, target, options, proceduralMaze) {
            if (!Array.isArray(agents)) {
                throw new Error("Wizard of Flatland enemy activation requires an agent array");
            }
            if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
                throw new Error("Wizard of Flatland enemy activation requires a finite target");
            }
            if (!proceduralMaze) {
                for (const agent of agents) agent.activated = true;
                return;
            }

            const targetCoord = mazeSections.worldToMazeSectionCoord(target.x, target.y, options);
            const targetSectionKey = mazeSections.mazeSectionKey(targetCoord.q, targetCoord.r);
            const wakeDistanceSquared = constants.ENEMY_WAKE_DISTANCE_METERS ** 2;
            const agentSectionKeys = new Map();
            const wakingSectionKeys = new Set();

            for (const agent of agents) {
                if (!agent || !Number.isFinite(agent.x) || !Number.isFinite(agent.y)) {
                    throw new Error("Wizard of Flatland enemy activation requires finite enemy positions");
                }
                const coord = mazeSections.worldToMazeSectionCoord(agent.x, agent.y, options);
                const sectionKey = mazeSections.mazeSectionKey(coord.q, coord.r);
                agentSectionKeys.set(agent, sectionKey);
                const distanceSquared = (agent.x - target.x) ** 2 + (agent.y - target.y) ** 2;
                if (distanceSquared <= wakeDistanceSquared) wakingSectionKeys.add(sectionKey);
            }

            for (const agent of agents) {
                const sectionKey = agentSectionKeys.get(agent);
                if (wakingSectionKeys.has(sectionKey)) {
                    agent.activated = true;
                } else if (
                    agent.activated === true
                    && getSectionDistance(sectionKey, targetSectionKey) >= constants.ENEMY_SLEEP_SECTION_DISTANCE
                ) {
                    agent.activated = false;
                }
            }
        }

        return Object.freeze({
            getSectionDistance,
            updateEnemyActivation
        });
    }

    globalThis.getWizardFlatlandEnemyActivationApi = function getWizardFlatlandEnemyActivationApi() {
        return Object.freeze({ createEnemyActivationSystem });
    };
})();
