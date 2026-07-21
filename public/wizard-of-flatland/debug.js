(function () {
    "use strict";

    function createDebugState() {
        return {
            showPathBlockedEdges: false,
            showWallLabels: false,
            showSectionBoundaries: false,
            headingGlitchFrame: 0,
            headingGlitchLogged: false,
            showFpsCounter: false,
            fpsCounterElement: null,
            lastFpsCounterUpdateAt: 0
        };
    }

    function attachDebugGlobals(state, profiler) {
        if (typeof window === "undefined") {
            throw new Error("Wizard of Flatland debug globals require window");
        }
        if (!state || typeof state !== "object") {
            throw new Error("Wizard of Flatland debug globals require state");
        }
        if (!state.debug || typeof state.debug !== "object") {
            throw new Error("Wizard of Flatland debug globals require state.debug");
        }
        window.__wizardOfFlatlandDebug = state;
        window.debug = state.debug;
        if (profiler) window.__wizardOfFlatlandProfiler = profiler;
        return state.debug;
    }

    if (typeof window === "undefined") {
        throw new Error("Wizard of Flatland debug requires window");
    }
    window.WizardOfFlatlandDebug = Object.freeze({
        createDebugState,
        attachDebugGlobals
    });
})();
