"use strict";

importScripts("/wizard-of-flatland/wallGeometry.js?v=wizard-of-flatland-1");
importScripts("/wizard-of-flatland/los.js?v=wizard-of-flatland-5");

const computeVisibilityPolygon = self.getWizardFlatlandLosApi().computeVisibilityPolygon;
let walls = null;
let wallRevision = 0;

self.addEventListener("message", (event) => {
    const message = event && event.data ? event.data : null;
    try {
        if (!message || typeof message.type !== "string") {
            throw new Error("Wizard of Flatland LOS worker requires a typed message");
        }
        if (message.type === "set-walls") {
            installWalls(message);
            return;
        }
        if (message.type === "compute") {
            computeLos(message);
            return;
        }
        throw new Error(`Wizard of Flatland LOS worker received unsupported message type ${message.type}`);
    } catch (error) {
        self.postMessage({
            type: "error",
            requestId: Number.isInteger(message && message.requestId) ? message.requestId : 0,
            wallRevision: Number.isInteger(message && message.wallRevision) ? message.wallRevision : wallRevision,
            message: error && error.message ? error.message : String(error)
        });
    }
});

function installWalls(message) {
    if (!(message.walls instanceof Float32Array)) {
        throw new Error("Wizard of Flatland LOS worker requires a transferred wall buffer");
    }
    if (!Number.isInteger(message.wallRevision) || message.wallRevision <= wallRevision) {
        throw new Error("Wizard of Flatland LOS worker requires a strictly increasing wall revision");
    }
    walls = message.walls;
    wallRevision = message.wallRevision;
}

function computeLos(message) {
    if (!(walls instanceof Float32Array)) {
        throw new Error("Wizard of Flatland LOS worker cannot compute before walls are installed");
    }
    if (!Number.isInteger(message.requestId) || message.requestId <= 0) {
        throw new Error("Wizard of Flatland LOS worker requires a positive request id");
    }
    if (message.wallRevision !== wallRevision) {
        throw new Error(
            `Wizard of Flatland LOS worker wall revision mismatch: requested ${message.wallRevision}, installed ${wallRevision}`
        );
    }
    const result = computeVisibilityPolygon({
        ...message.options,
        walls
    });
    self.postMessage({
        type: "result",
        requestId: message.requestId,
        wallRevision,
        originX: message.options.x,
        originY: message.options.y,
        bins: result.bins,
        maxDistance: result.maxDistance,
        points: result.points,
        depths: result.depths,
        hitWallIndices: result.hitWallIndices,
        hitWallTs: result.hitWallTs,
        enemyTargets: result.enemyTargets,
        enemyVisibility: result.enemyVisibility,
        scannedWallCount: result.scannedWallCount,
        candidateWallCount: result.candidateWallCount,
        raySegmentTests: result.raySegmentTests,
        enemyScannedWallCount: result.enemyScannedWallCount,
        enemyCandidateWallCount: result.enemyCandidateWallCount,
        enemySegmentTests: result.enemySegmentTests,
        elapsedMs: result.elapsedMs
    }, [
        result.points.buffer,
        result.depths.buffer,
        result.hitWallIndices.buffer,
        result.hitWallTs.buffer,
        result.enemyTargets.buffer,
        result.enemyVisibility.buffer
    ]);
}
