(function () {
    "use strict";

    function createControlSystem(deps) {
        const state = deps && deps.state;
        const labels = deps && deps.labels;
        const elements = deps && deps.elements;
        const constants = deps && deps.constants;
        const setLabelText = deps && deps.setLabelText;
        if (!state || typeof state !== "object") throw new Error("Wizard of Flatland controls require state");
        if (!labels || typeof labels !== "object") throw new Error("Wizard of Flatland controls require labels");
        if (!elements || typeof elements !== "object") throw new Error("Wizard of Flatland controls require elements");
        if (!constants || typeof constants !== "object") throw new Error("Wizard of Flatland controls require constants");
        if (typeof setLabelText !== "function") throw new Error("Wizard of Flatland controls require setLabelText");

        const initialSpeedScaleControlValue = elements.speedScaleInput
            ? Number(elements.speedScaleInput.value)
            : NaN;
        let speedScaleControlValue = Number.isFinite(initialSpeedScaleControlValue)
            ? initialSpeedScaleControlValue
            : 0.5;

        function getControlNumber(input, fallback) {
            if (!input) return fallback;
            const value = Number(input.value);
            return Number.isFinite(value) ? value : fallback;
        }

        function updateControlLabels() {
            setLabelText(labels.agentCount, String(getAgentCount()));
            setLabelText(labels.separationStrength, getSeparationStrength().toFixed(1));
            setLabelText(labels.speedScale, getSpeedScale().toFixed(2));
            setLabelText(labels.mazeChunkSize, String(getMazeChunkSize()));
            setLabelText(labels.mazeRoomScale, getMazeRoomScale().toFixed(2));
            setLabelText(labels.mazeTwistiness, getMazeTwistiness().toFixed(2));
        }

        function getSpeedScale() {
            const t = Math.max(0, Math.min(1, getControlNumber(elements.speedScaleInput, speedScaleControlValue)));
            return constants.SPEED_SCALE_MIN * Math.pow(constants.SPEED_SCALE_MAX / constants.SPEED_SCALE_MIN, t);
        }

        function setSpeedScaleValue(value) {
            const scale = Math.max(constants.SPEED_SCALE_MIN, Math.min(constants.SPEED_SCALE_MAX, Number(value)));
            const t = Math.log(scale / constants.SPEED_SCALE_MIN) / Math.log(constants.SPEED_SCALE_MAX / constants.SPEED_SCALE_MIN);
            speedScaleControlValue = Math.max(0, Math.min(1, t));
            if (elements.speedScaleInput) elements.speedScaleInput.value = String(speedScaleControlValue);
        }

        function getAgentCount() {
            return Math.max(0, Math.round(getControlNumber(elements.agentCountInput, constants.DEFAULT_AGENT_COUNT)));
        }

        function getSeparationStrength() {
            return getControlNumber(elements.separationInput, constants.DEFAULT_SEPARATION_STRENGTH);
        }

        function getScenarioValue() {
            return elements.scenarioSelect ? elements.scenarioSelect.value : constants.DEFAULT_SCENARIO;
        }

        function getMazeChunkSize() {
            return Math.max(
                constants.MAZE_CHUNK_MIN_SIZE,
                Math.min(
                    constants.MAZE_CHUNK_MAX_SIZE,
                    Math.round(getControlNumber(elements.mazeChunkSizeInput, constants.DEFAULT_MAZE_CHUNK_SIZE))
                )
            );
        }

        function getMazeSeed() {
            const seed = String(elements.mazeSeedInput ? elements.mazeSeedInput.value : state.mazeSeed).trim();
            return seed.length > 0 ? seed : constants.DEFAULT_MAZE_SEED;
        }

        function getMazeRoomScale() {
            return Math.max(0, Math.min(1, getControlNumber(elements.mazeRoomScaleInput, constants.DEFAULT_MAZE_ROOM_SCALE)));
        }

        function getMazeTwistiness() {
            return Math.max(0, Math.min(1, getControlNumber(elements.mazeTwistinessInput, constants.DEFAULT_MAZE_TWISTINESS)));
        }

        function getMazeOptions() {
            return {
                seed: getMazeSeed(),
                chunkSize: getMazeChunkSize(),
                roomScale: getMazeRoomScale(),
                twistiness: getMazeTwistiness()
            };
        }

        function isProceduralMazeScenario() {
            return getScenarioValue() === "proceduralMaze";
        }

        return Object.freeze({
            updateControlLabels,
            getSpeedScale,
            setSpeedScaleValue,
            getAgentCount,
            getSeparationStrength,
            getScenarioValue,
            getMazeChunkSize,
            getMazeSeed,
            getMazeRoomScale,
            getMazeTwistiness,
            getMazeOptions,
            isProceduralMazeScenario
        });
    }

    window.WizardFlatlandControls = Object.freeze({
        createControlSystem
    });
}());
