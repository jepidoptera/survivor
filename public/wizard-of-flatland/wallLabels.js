(function () {
    "use strict";

    function createWallLabelSystem(deps) {
        const constants = deps && deps.constants;
        const validateWallBuffer = deps && deps.validateWallBuffer;
        if (!constants || typeof constants !== "object") {
            throw new Error("Wizard of Flatland wall labels require constants");
        }
        if (typeof validateWallBuffer !== "function") {
            throw new Error("Wizard of Flatland wall labels require wall buffer validation");
        }

        function validateWallLabelBuffer(walls, label) {
            validateWallBuffer(walls, label);
            for (let i = 0; i < walls.length; i += constants.WALL_STRIDE) {
                getWallDebugLabel(walls[i + constants.WALL_LABEL_CODE], walls[i + constants.WALL_LABEL_SIDE]);
            }
        }

        function getWallDebugLabel(labelCode, sideCode) {
            const code = Number(labelCode);
            const side = Number(sideCode);
            if (!Number.isInteger(code) || code <= 0) {
                throw new Error(`Wizard of Flatland wall label is missing for code ${labelCode}`);
            }
            if (!Number.isInteger(side)) {
                throw new Error(`Wizard of Flatland wall label side is invalid for code ${code}`);
            }
            const sideText = side >= 0 ? ` s${side}` : "";
            switch (code) {
                case constants.WALL_LABEL_MANUAL_TOOL:
                    return "manual tool | user drawn";
                case constants.WALL_LABEL_ARENA_BOUNDARY:
                    return `arena boundary${sideText} | unmodified`;
                case constants.WALL_LABEL_ROOM_BOUNDARY:
                    return `room boundary${sideText} | unmodified`;
                case constants.WALL_LABEL_ROOM_HALL_GAP:
                    return `room boundary${sideText} | hallway gap split`;
                case constants.WALL_LABEL_ROOM_OUTSIDE_DOOR_GAP:
                    return `room boundary${sideText} | outside-door gap split`;
                case constants.WALL_LABEL_ROOM_POCKET_OVERRIDE:
                    return `room boundary${sideText} | corner pocket reshaped`;
                case constants.WALL_LABEL_ROOM_POCKET_OVERRIDE_HALL_GAP:
                    return `room boundary${sideText} | corner pocket reshaped + hall gap`;
                case constants.WALL_LABEL_ROOM_POCKET_CONNECTOR:
                    return "corner pocket front wall | neighbor incorporated";
                case constants.WALL_LABEL_SQUARE_SIDE_PARALLEL:
                    return `corner pocket back wall${sideText}`;
                case constants.WALL_LABEL_SQUARE_SIDE_PERPENDICULAR:
                    return "corner pocket front wall";
                case constants.WALL_LABEL_SQUARE_SIDE_PERPENDICULAR_FULL:
                    return "corner pocket front wall | section boundary";
                case constants.WALL_LABEL_HALLWAY_SIDE_HALF:
                    return "hallway side | half-length";
                case constants.WALL_LABEL_HALLWAY_SIDE_FULL:
                    return "hallway side | corner pocket extended";
                default:
                    throw new Error(`Wizard of Flatland wall label code is unknown: ${code}`);
            }
        }

        return Object.freeze({
            validateWallLabelBuffer,
            getWallDebugLabel
        });
    }

    window.WizardFlatlandWallLabels = Object.freeze({
        createWallLabelSystem
    });
}());
