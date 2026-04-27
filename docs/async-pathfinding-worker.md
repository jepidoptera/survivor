# Async Pathfinding Worker

This document sketches a worker-based pathfinding architecture that preserves
door/tree routing and obstacle-breaking behavior.

## Goals

- Move path search off the main thread.
- Preserve gameplay where actors can route through knockable trees and doors.
- Keep the main thread authoritative for world mutation, combat, and animation.
- Keep stale async results from corrupting movement.

## Core Idea

The worker should not receive live JS objects. It should receive compact,
versioned snapshots of:

- navigation nodes
- traversal edges
- directional blockers
- obstacle state
- actor pathfinding traits

The worker returns a plan, not just a raw path. A plan includes the route plus
which obstacles were assumed to be opened or broken along the way.

## Snapshot Schema

### Map Snapshot

```js
{
  version: 17,
  width: 256,
  height: 256,
  wrapX: true,
  wrapY: true,
  nodes: [
    {
      key: "12,44,0",
      xindex: 12,
      yindex: 44,
      traversalLayer: 0,
      x: 10.392,
      y: 44.5,
      blocked: false,
      clearance: 3
    }
  ],
  edges: [
    {
      id: "12,44,0->13,44,0:1",
      fromKey: "12,44,0",
      toKey: "13,44,0",
      directionIndex: 1,
      type: "planar",
      baseCost: 1,
      directionalObstacleIds: ["door:412"]
    }
  ],
  tileObstacleIdsByNodeKey: {
    "12,44,0": ["tree:88"]
  },
  cornerObstacleIdsByEdgeId: {
    "12,44,0->13,44,0:1": ["tree:91"]
  },
  obstacles: [
    {
      id: "tree:88",
      kind: "tree",
      hp: 1,
      size: 4,
      gone: false,
      passableWhenDown: true,
      state: "standing"
    },
    {
      id: "door:412",
      kind: "door",
      hp: 5,
      size: 1,
      gone: false,
      passableWhenDown: true,
      state: "closed"
    }
  ]
}
```

### Actor Profile

```js
{
  actorId: "animal:23",
  kind: "animal",
  size: 6,
  damage: 12,
  clearance: 0,
  canBreakDoors: true,
  canBreakTreesLargerThanSelf: false
}
```

### Path Request

```js
{
  requestId: 91,
  mapVersion: 17,
  actor: { ...actorProfile },
  startNodeKey: "12,44,0",
  destinationNodeKey: "19,41,0",
  options: {
    allowBlockedDestination: false,
    maxPathLength: 22,
    wallAvoidance: 0,
    includeBlockedPlan: true
  }
}
```

### Path Response

```js
{
  requestId: 91,
  mapVersion: 17,
  ok: true,
  pathNodeKeys: ["13,44,0", "14,43,0", "15,42,0"],
  pathEdgeIds: [
    "12,44,0->13,44,0:1",
    "13,44,0->14,43,0:11"
  ],
  plannedInteractions: [
    {
      obstacleId: "door:412",
      action: "break",
      expectedHits: 1,
      addedCost: 2
    }
  ],
  stats: {
    iterations: 281,
    expanded: 155
  }
}
```

## Obstacle Semantics

These should mirror the current rules in `Animal.js` and `Map.js`:

- Closed doors are blocking and knockable.
- Open, locked-open, fallen, or gone doors are non-blocking.
- Standing trees are blocking.
- Fallen trees are passable for actors that are already allowed to traverse
  them in the current rules.
- A traversal may accumulate penalty from:
  - directional blockers
  - tile blockers on the destination node
  - corner blockers on diagonal movement

The worker should operate on obstacle records, not callbacks.

## Authority Split

### Worker owns

- A* search
- obstacle-aware traversal cost
- selecting a route that includes breaking doors/trees when cheaper

### Main thread owns

- applying damage
- opening/falling/destroying doors
- tree state changes
- animation and combat timing
- validating that a returned async plan is still current

## Versioning Rules

- Every map snapshot carries a monotonically increasing `version`.
- Any door/tree/wall state change that affects traversal increments the version.
- Responses with a stale `mapVersion` are discarded.
- Each actor should track its own latest `requestId`; older responses are
  ignored even if the map version still matches.

## Initial Rollout

1. Build and ship the snapshot generator alongside the current sync code.
2. Build a worker service that can ingest snapshots and receive requests.
3. Integrate one AI caller first, preferably Blodia chase pathing.
4. Keep the current sync `findPathAStar()` as a fallback.
5. Once stable, migrate more path callers and add incremental snapshot updates.

## Notes

- `getNodeKey()` already provides a stable compact node identifier.
- Main-thread path step reconstruction can continue to use existing map logic.
- The worker should begin with full snapshot replacement before incremental
  patch updates are added.
