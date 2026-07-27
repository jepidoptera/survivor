(function () {
    "use strict";

    function createDebugState() {
        return {
            showHexGrid: false,
            showAgentPath: false,
            showDeathPathDiagnostics: false,
            showPathBlockedEdges: false,
            showWallLabels: false,
            showSectionBoundaries: false,
            coinDiagnosticsEnabled: false,
            coinDiagnostics: [],
            wizardImmortal: false,
            headingGlitchFrame: 0,
            headingGlitchLogged: false,
            lastPathingMetrics: null,
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
        state.debug.toggleWizardImmortality = function toggleWizardImmortality(value) {
            if (value === undefined) {
                state.debug.wizardImmortal = !state.debug.wizardImmortal;
            } else {
                state.debug.wizardImmortal = !!value;
            }
            return state.debug.wizardImmortal;
        };
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
