---
name: Architecture: Multi-Floor Schema
description: Floor level system, surfaceId, fragmentId, transitions, polygon floors, visibility rules
type: project
---

# Multi-Floor Schema

**Source:** `docs/floor-schema.md` (authoritative design doc)

## Key Concepts

### `level` — Navigation/rendering tier (integer)
- `-2` deeper dungeon, `-1` cave/basement, `0` ground, `1` upper floor, `2` roof walkway
- NOT the same as `z` (world height)

### `baseZ` — Actual world elevation (float)
- Per-node, not per-level. Two nodes same level can have different baseZ.
- Default per-floor via `nodeBaseZ` field.
- `baseZ = level * 3` is the conventional default (3 world units per floor).

### `surfaceId` — Logical traversal continuity
- Spans sections. Nodes on different section files share surfaceId if they're the same walkable surface.
- Used for: pathfinding continuity, visibility cutaway grouping.
- Example: `"overworld_ground_surface"`, `"houseA_floor1_surface"`

### `fragmentId` — Local floor fragment identity
- Section-local or asset-local. Multiple fragments → same surfaceId.
- Used for: authoring, streaming, save bookkeeping, polygon ownership.
- Format: `"section:{q},{r}:{name}"` e.g. `"section:12,8:houseA_floor1"`

### `ownerSectionKey` — Streaming/persistence owner
- Which section's asset file stores this fragment.
- Doesn't determine logical connectivity; that's surfaceId's job.

## Floor Entity Shape

```js
{
  fragmentId: "section:12,8:houseA_floor1",
  surfaceId: "houseA_floor1_surface",
  ownerSectionKey: "12,8",
  level: 1,
  outerPolygon: [{x, y}, ...],
  holes: [[{x, y}, ...]],
  visibilityPolygon: [{x, y}, ...],
  visibilityHoles: [[{x, y}, ...]],
  nodeBaseZ: 3.0
}
```

## Transitions (Explicit, no inferred)

```js
{
  id: "houseA_stairs_0_to_1",
  type: "stairs",   // stairs | ramp | ladder | teleport | drop
  from: { x, y, surfaceId, fragmentId },
  to: { x, y, surfaceId, fragmentId },
  bidirectional: true,
  zProfile: "linear",
  movementCost: 1,
  penalty: 0,
  metadata: {}
}
```

**Rule: Crossing a section border on the same surfaceId is NOT a transition — it's ordinary planar movement.**

## Node Shape (Multi-floor)

```js
{
  id: "26,19,houseA_floor1_surface,section:12,8:houseA_floor1",
  xindex: 26, yindex: 19,
  x: 22.516, y: 19.5,
  surfaceId: "houseA_floor1_surface",
  fragmentId: "section:12,8:houseA_floor1",
  ownerSectionKey: "12,8",
  level: 1,
  baseZ: 3.0,
  traversalLayer: 1
}
```

## Visibility Rule (Overhead Cutaway)

When player is on level L:
1. For each floor with `floor.level > L`
2. Test if player position is inside `visibilityPolygon`
3. Exclude if inside any `visibilityHole`
4. If inside → hide/fade that floor

Polygon-driven, not global. Unrelated floors on same level are handled independently.
Floors BELOW player (caves) are NOT automatically hidden by this rule.

## Runtime Map Collections

```js
map.floorsById         // Map<fragmentId, floorRecord>
map.floorNodesById     // Map<fragmentId, MapNode[]>
map.floorNodeIndex     // Map<"xindex,yindex,surfaceId,fragmentId", MapNode>
map.transitionsById    // Map<id, transition>
```

## Implicit Ground Floor

- Author may OMIT the ground floor from section data.
- Loader SYNTHESIZES it: `fragmentId = "section:{q},{r}:ground"`, `surfaceId = "overworld_ground_surface"`, `level = 0`
- Negative-level floors (caves) must ALWAYS be authored explicitly.

## Section Border Rule

Adjacent seam nodes on different `ownerSectionKey` connect directly IF they share the same `surfaceId`. Section borders are streaming boundaries, not traversal boundaries.

## API: Getting Floor Node at Layer

`mapRef.getFloorNodeAtLayer(xindex, yindex, layer, options)` — resolves the node at a given floor layer.
`mapRef.getPrototypeSectionKeyForWorldPoint(worldX, worldY)` — which section key owns a world point.
