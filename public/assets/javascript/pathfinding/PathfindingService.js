(function initPathfindingService(globalScope) {
    "use strict";

    class PathfindingService {
        constructor(options = {}) {
            this.workerUrl = options.workerUrl || "assets/javascript/pathfinding/pathfindingWorker.js";
            this.worker = null;
            this.ready = false;
            this.latestMapVersion = 0;
            this.nextRequestId = 1;
            this.pending = new Map();
        }

        isSupported() {
            return typeof Worker !== "undefined";
        }

        ensureWorker() {
            if (this.worker || !this.isSupported()) return this.worker;
            this.worker = new Worker(this.workerUrl);
            this.worker.addEventListener("message", (event) => this._handleMessage(event));
            this.worker.addEventListener("error", (event) => this._handleWorkerError(event));
            return this.worker;
        }

        initializeWithMap(map) {
            if (!map || !globalScope.PathfindingSnapshot) return false;
            const snapshot = globalScope.PathfindingSnapshot.buildMapSnapshot(map);
            if (!snapshot) return false;
            const worker = this.ensureWorker();
            if (!worker) return false;
            this.latestMapVersion = Number(snapshot.version) || 0;
            worker.postMessage({
                type: "init_snapshot",
                snapshot
            });
            return true;
        }

        updateMapSnapshot(map) {
            if (!map || !globalScope.PathfindingSnapshot) return false;
            const snapshot = globalScope.PathfindingSnapshot.buildMapSnapshot(map);
            if (!snapshot) return false;
            const worker = this.ensureWorker();
            if (!worker) return false;
            this.latestMapVersion = Number(snapshot.version) || 0;
            worker.postMessage({
                type: "replace_snapshot",
                snapshot
            });
            return true;
        }

        requestPath(map, actor, startNodeKey, destinationNodeKey, options = {}) {
            const worker = this.ensureWorker();
            if (!worker || !globalScope.PathfindingSnapshot) {
                return Promise.resolve({
                    ok: false,
                    reason: "worker_unavailable"
                });
            }
            const actorProfile = globalScope.PathfindingSnapshot.buildActorProfile(actor);
            const requestId = this.nextRequestId++;
            const mapVersion = Number.isFinite(map && map.pathfindingSnapshotVersion)
                ? Number(map.pathfindingSnapshotVersion)
                : this.latestMapVersion;
            return new Promise((resolve, reject) => {
                this.pending.set(requestId, {
                    resolve,
                    reject,
                    mapVersion,
                    startNodeKey,
                    destinationNodeKey
                });
                worker.postMessage({
                    type: "request_path",
                    requestId,
                    mapVersion,
                    actor: actorProfile,
                    startNodeKey,
                    destinationNodeKey,
                    options: {
                        allowBlockedDestination: options.allowBlockedDestination === true,
                        maxPathLength: Number.isFinite(options.maxPathLength) ? Number(options.maxPathLength) : null,
                        wallAvoidance: Number.isFinite(options.wallAvoidance) ? Number(options.wallAvoidance) : 0,
                        includeBlockedPlan: options.includeBlockedPlan !== false
                    }
                });
            });
        }

        _handleMessage(event) {
            const data = event && event.data ? event.data : null;
            if (!data || typeof data.type !== "string") return;
            if (data.type === "ready") {
                this.ready = true;
                return;
            }
            if (data.type !== "path_result") return;
            const pending = this.pending.get(data.requestId);
            if (!pending) return;
            this.pending.delete(data.requestId);
            // Attach the original start/destination keys so callers can pass the
            // full result object directly to map.resolveWorkerPathResult().
            pending.resolve({
                ...data,
                startNodeKey: pending.startNodeKey,
                destinationNodeKey: pending.destinationNodeKey
            });
        }

        _handleWorkerError(event) {
            const error = event && event.error ? event.error : new Error("Pathfinding worker failed");
            this.pending.forEach(({ reject }) => reject(error));
            this.pending.clear();
        }
    }

    globalScope.PathfindingService = PathfindingService;
    if (!globalScope.pathfindingService) {
        globalScope.pathfindingService = new PathfindingService();
    }
})(typeof window !== "undefined" ? window : globalThis);
