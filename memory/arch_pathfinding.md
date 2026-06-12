---
name: Architecture: Pathfinding
description: Async Web Worker pathfinding, PathfindingService, PathfindingSnapshot
type: project
---

# Pathfinding System

**Sources:** `public/assets/javascript/pathfinding/PathfindingService.js`, `PathfindingSnapshot.js`, `pathfindingWorker.js`

## Design

Pathfinding runs in a **Web Worker** to avoid blocking the main thread. The main thread sends a snapshot of map state to the worker and requests paths asynchronously.

## PathfindingService

Class that manages the worker lifecycle and pending requests.

```js
class PathfindingService {
  workerUrl  // "assets/javascript/pathfinding/pathfindingWorker.js"
  worker     // Worker instance (lazy init)
  ready      // bool
  latestMapVersion  // int
  nextRequestId     // int
  pending    // Map<requestId, {resolve, reject, mapVersion, startNodeKey, destNodeKey}>
}
```

**Key methods:**
- `isSupported()` — checks `typeof Worker !== "undefined"`
- `ensureWorker()` — creates worker on first use, wires message/error handlers
- `initializeWithMap(map)` — builds snapshot and sends `init_snapshot` to worker
- `updateMapSnapshot(map)` — sends `replace_snapshot` to worker
- `requestPath(map, actor, startNodeKey, destinationNodeKey, options)` — returns Promise

**Worker message types:**
- `init_snapshot` / `replace_snapshot` — send new map state to worker
- `request_path` — request a path; response resolves promise

## PathfindingSnapshot

Serializes map state for the worker:
- `PathfindingSnapshot.buildMapSnapshot(map)` — returns serializable snapshot object
- `PathfindingSnapshot.buildActorProfile(actor)` — extracts pathfinding-relevant actor data (size, clearance needs, etc.)

## Node Keys

Paths are identified by node key strings (typically `"xindex,yindex"`). For multi-floor, keys may include surfaceId/fragmentId.

## Actor Profile

The actor profile includes enough info for the pathfinder to respect clearance and layer constraints without needing the full character object.

## Fallback

If worker unavailable, `requestPath` immediately resolves with `{ ok: false, reason: "worker_unavailable" }`.
