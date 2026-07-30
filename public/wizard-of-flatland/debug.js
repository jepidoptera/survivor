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
            solverProfile: null,
            lastSolverProfile: null,
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
        if (profiler) {
            if (typeof profiler.startMainThreadProfile !== "function") {
                throw new Error("Wizard of Flatland profiler is missing startMainThreadProfile");
            }
            window.__wizardOfFlatlandProfiler = profiler;
            window.profileWizardMainThread = profiler.startMainThreadProfile;
            window.stopWizardMainThreadProfile = profiler.stopMainThreadProfile;
            if (typeof profiler.startHitchProfile !== "function" || typeof profiler.stopHitchProfile !== "function") {
                throw new Error("Wizard of Flatland profiler is missing hitch profiling");
            }
            state.debug.profileHitches = profiler.startHitchProfile;
            state.debug.stopHitchProfile = profiler.stopHitchProfile;
            state.debug.getLastHitchProfile = profiler.getLastHitchProfile;
        }
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
