# Multi-Floor Schema

This document defines the concrete data model for authored floors, their nodes, explicit transitions between floors, and the visibility rule for hiding upper floors while the player is inside them.

## Goals

- Keep navigation topology separate from world elevation.
- Support multiple walkable surfaces at the same `x,y`.
- Support hills later without changing the floor model.
- Require explicit transitions between floors instead of inferring them from overlap.
- Make rendering/cutaway behavior depend on floor ownership and polygons, not ad hoc z checks.

## Data Layers

This document distinguishes three different representations that should not be conflated:

- authored schema: the source data that designers edit
- runtime map state: the fully materialized floor/node/transition model used by the engine
- save data: persisted runtime state or deltas needed to restore play

Ordinary terrain may be implicit in authored data but still explicit in runtime state.

That means:

- authored data may omit the ordinary terrain floor entirely
- runtime state may synthesize a ground-floor entity for that section
- save data may choose to serialize synthesized runtime floors, or may rely on re-synthesis during load, depending on persistence needs

"Implicit" only applies to authoring unless a save format explicitly says otherwise.

## Core Concepts

### `level`

`level` is a discrete navigation/rendering tier.

- It is an integer.
- It is not the same thing as `z`.
- Floors on a higher `level` may become hidden when the player is inside their visual area.

Examples:

- Cave floor: `level = -1`
- Ground floor: `level = 0`
- Upper floor: `level = 1`
- Roof walkway: `level = 2`

### `baseZ`

`baseZ` is the actual world elevation used for standing position and rendering.

- It is per node, not per level.
- Two nodes may share the same `level` but have different `baseZ`.
- This is what allows hills on `level = 0` later.

For authored floors, a floor may provide a single default `nodeBaseZ` for all nodes it materializes.

- `nodeBaseZ` is a floor-wide default.
- runtime nodes still store concrete per-node `baseZ` values.
- per-node `baseZ` overrides may be added later without changing the floor model.

### `surfaceId`

`surfaceId` is the stable identity of one logical traversable surface.

- It may span multiple sections.
- It is the identity that movement continuity and cutaway should care about.
- Neighboring nodes across a section seam may connect directly when they share the same `surfaceId`.

Examples:

- one continuous overworld terrain surface across many sections
- one cave floor that spans three sections
- one second-story room whose polygon was clipped into multiple section fragments

### `fragmentId`

`fragmentId` is the stable identity of one authored or baked floor fragment.

- It is section-local or asset-local.
- Multiple fragments may belong to the same `surfaceId`.
- Fragment identity is useful for authoring, streaming, save bookkeeping, and polygon ownership.

### `ownerSectionKey`

`ownerSectionKey` is the section that owns a fragment or a node for streaming and persistence purposes.

- It does not determine logical walkability continuity.
- It determines which section asset stores the fragment.
- It may differ between neighboring nodes that still belong to the same logical surface.

### Floor Polygon

A floor is defined by:

- one outer polygon
- zero or more hole polygons

The outer polygon defines the owned footprint of the floor.
The holes cut out areas that are not part of the floor, such as stair openings.

That distinction matters because a new level may:

- reuse the same footprint by default
- be smaller than the level below
- be larger than the level below
- include exposed areas such as balconies or flat roofs

Schema invariants:

- `outerPolygon` must be a simple polygon
- each hole polygon must also be simple
- each hole must lie fully inside the outer polygon
- hole polygons must not overlap each other
- polygon winding should be consistent within the format
- `visibilityPolygon` should default to `outerPolygon` when omitted
- `visibilityHoles` should default to `holes` when omitted

### Floor Area

The authored floor polygon is the walkable area.

Recommended semantics:

- `outerPolygon`: the floor section's authored footprint
- `holes`: openings removed from that footprint, such as stairwells

Default rules:

1. The whole authored floor area is walkable.
2. Existing wall and object blocking mechanics remain responsible for preventing movement through occupied space.
3. A new level may inherit the previous footprint by default, but can still be smaller, larger, or partially cantilevered.

This preserves both workflows:

- enclosed upper stories that reuse the full authored footprint while walls still block traversal
- exposed decks, balconies, and flat roofs where the whole platform is walkable

### Visibility Polygon

Each floor also has a visibility polygon used by rendering/cutaway logic.

- Often it will match the outer polygon minus holes.
- It may diverge later if visual/cutaway behavior differs from the full floor footprint.

## Floor Entity

At runtime, every traversable surface should be represented as a floor entity, including ordinary terrain.

That means the engine may synthesize an implicit ground floor for a section even when the author did not
create one explicitly.

Author floors as explicit map entities.

```js
{
  fragmentId: "section:12,8:houseA_floor1",
  surfaceId: "houseA_floor1_surface",
  ownerSectionKey: "12,8",
  level: 1,
  outerPolygon: [
    { x: 24.0, y: 16.0 },
    { x: 30.0, y: 16.0 },
    { x: 30.0, y: 22.0 },
    { x: 24.0, y: 22.0 }
  ],
  holes: [
    [
      { x: 26.0, y: 18.0 },
      { x: 27.0, y: 18.0 },
      { x: 27.0, y: 19.0 },
      { x: 26.0, y: 19.0 }
    ]
  ],
  visibilityPolygon: [
    { x: 24.0, y: 16.0 },
    { x: 30.0, y: 16.0 },
    { x: 30.0, y: 22.0 },
    { x: 24.0, y: 22.0 }
  ],
  visibilityHoles: [
    [
      { x: 26.0, y: 18.0 },
      { x: 27.0, y: 18.0 },
      { x: 27.0, y: 19.0 },
      { x: 26.0, y: 19.0 }
    ]
  ],
  nodeBaseZ: 3.0
}
```

Notes:

- runtime floor records should usually be thought of as surface fragments, not necessarily whole logical surfaces
- fragments own polygon, visibility, and section ownership metadata
- logical continuity across section borders should be derived from shared `surfaceId`, not shared `ownerSectionKey`
- transitions should be stored as top-level map entities

## Node Model

Once multiple floors can overlap in `x,y`, node identity must include floor ownership.

Recommended node shape:

```js
{
  id: "26,19,houseA_floor1_surface,section:12,8:houseA_floor1",
  xindex: 26,
  yindex: 19,
  x: 22.516,
  y: 19.5,
  surfaceId: "houseA_floor1_surface",
  fragmentId: "section:12,8:houseA_floor1",
  ownerSectionKey: "12,8",
  level: 1,
  baseZ: 3.0,
  traversalLayer: 1
}
```

Notes:

- `surfaceId` is the logical traversable-surface identity.
- `fragmentId` is the local floor-fragment identity.
- `ownerSectionKey` is the streaming/persistence owner.
- `level` is the broad tier used by visibility/render rules.
- `traversalLayer` can stay aligned with `level` for now.
- `baseZ` is the actual standing height.

## Node Membership Rule

For a floor definition, the node set is derived as follows:

1. Consider all base-grid hex nodes whose centers fall inside the floor's `outerPolygon`.
2. Exclude any node whose center falls inside one of the floor's `holes`.
3. Clone or materialize a floor-owned node at the same `x,y` with:
  - logical `surfaceId`
  - local `fragmentId`
  - `ownerSectionKey`
   - floor `level`
   - floor/node `baseZ`

This means the upper-floor nodes reuse the base map's horizontal grid but become distinct traversal nodes.

When a logical floor crosses section borders, the loader may materialize multiple fragments that share the same `surfaceId`.
Planar neighbor links across the seam should connect normally when adjacent nodes share that `surfaceId`.

The authored `outerPolygon` remains available for:

- stacking the next wall ring at the same footprint
- rendering the floor shell
- aligning cutaway/ceiling decisions

## Transitions

Transitions between floors must be explicit.

Do not infer transitions from polygon overlap.

Transitions should be stored as top-level map entities, not nested under a specific floor.
They are traversal edges between floor-owned nodes.

Recommended transition shape:

```js
{
  id: "houseA_stairs_0_to_1",
  type: "stairs",
  from: {
    x: 26,
    y: 19,
    surfaceId: "houseA_ground_surface",
    fragmentId: "section:12,8:houseA_floor0"
  },
  to: {
    x: 26,
    y: 19,
    surfaceId: "houseA_floor1_surface",
    fragmentId: "section:12,8:houseA_floor1"
  },
  bidirectional: true,
  zProfile: "linear",
  movementCost: 1,
  penalty: 0,
  metadata: {}
}
```

Supported transition types should include at least:

- `stairs`
- `ramp`
- `ladder`
- `teleport`
- `drop`

Transitions should connect different logical surfaces.

Crossing a section border on the same logical surface is not a transition. It is an ordinary planar neighbor move.

## Section Borders

Section borders should not split one logical floor into separate traversable surfaces unless the author intended that.

Recommended rule set:

- section ownership is for streaming, saving, and local asset storage
- `surfaceId` is for gameplay continuity and visibility grouping
- `fragmentId` is for per-section polygon ownership

That means a floor that crosses a section border should usually be represented as:

- multiple section-owned fragments
- one shared `surfaceId`
- normal planar seam adjacency where neighboring nodes share that `surfaceId`

This implies two important behaviors:

1. Movement:
Adjacent seam nodes on different `ownerSectionKey` values should connect directly if they share the same `surfaceId`.

2. Visibility:
Cutaway/hide decisions should usually apply to all loaded fragments of the same `surfaceId`, not only the fragment directly above the player.

Authoring guidance:

- global floor geometry may be authored as one surface and baked into section-local fragments
- section assets should store the fragments they own
- the bake step should preserve a shared `surfaceId` across all fragments cut from the same logical floor

## Minimal Runtime Map Shape

The map should eventually hold:

```js
{
  floorsById: new Map(),
  floorNodesById: new Map(),
  floorNodeIndex: new Map(),
  transitionsById: new Map()
}
```

Where:

- `floorsById` stores authored floor entities
- `floorNodesById` stores floor-owned node arrays keyed by `floorId`
- `floorNodeIndex` stores per-node lookup keyed by `x,y,floorId`
- `transitionsById` stores explicit floor transitions

In addition, map loading may synthesize default floor entities for ordinary terrain so that runtime systems
do not need to special-case the ground layer.

## Implicit Ground Floor

Ordinary terrain should be treated as one implicit floor per section unless an authored replacement says otherwise.

Recommended semantics:

- Authoring may omit the ordinary ground floor.
- Runtime should still synthesize a section ground floor entity.
- That synthesized floor should usually use `level = 0`.
- Its polygon should cover the ordinary traversable footprint of the section.
- The authored schema should not contain a placeholder ground-floor record just to say that it is implicit.

For a hex section 100 tiles wide, this means the loader can synthesize one section-sized runtime floor such as:

```js
{
  id: "section_12_8_ground",
  level: 0,
  outerPolygon: [...section footprint...],
  holes: [],
  visibilityPolygon: [...section footprint...],
  visibilityHoles: [],
  nodeBaseZ: 0
}
```

The important rule is:

- authoring may treat ordinary terrain as implicit
- runtime should treat it as an ordinary floor entity

In other words:

- authored data omits the ordinary terrain floor
- the loader notices that omission and synthesizes the ground floor
- any persistence of that runtime floor is a save/runtime concern, not part of the authored schema

Two save strategies are reasonable:

- re-synthesize the ground floor on load and only save authored or player-modified floor data
- serialize the fully materialized runtime floor state for simpler restoration

That keeps pathfinding, selection, visibility, and transitions operating on one unified model.

## Visibility Rule

When the player is on level `L`:

1. For each floor with `floor.level > L`
2. Test whether the player position is inside that floor's `visibilityPolygon`
3. Exclude the floor if the player is inside any `visibilityHole`
4. If the player is inside the visible area, hide or fade that floor

This rule should be polygon-driven, not global-per-level.

For enclosed stacked rooms, `visibilityPolygon` will often still want to follow the interior room area,
not necessarily the full outer shell. That is a rendering/cutaway choice, not a navigation requirement.

For exposed floors such as balconies or flat roofs, `visibilityPolygon` may instead match
the full walkable platform.

That means:

- upper floors remain visible when the player is outside their interior footprint
- upper floors disappear when the player is underneath / inside them
- multiple unrelated floors on the same level can be handled independently

This visibility rule is specifically for overhead cutaway behavior.

Floors below the player, such as caves or basements, should not automatically use the same polygon-hide rule in reverse.
Underground reveal should be treated as a separate rendering decision, usually based on the player's current floor,
an entrance transition, or another explicit reveal context.

## Hills Compatibility

This model is compatible with hills.

Hills should remain on `level = 0` and simply vary by `baseZ` from node to node.

That means:

- not every `baseZ` change implies a new floor
- floors are for overlapping traversable surfaces
- `baseZ` is for vertical placement within a surface

## Below-Ground Floors

Floors may also exist below ordinary terrain.

Recommended semantics:

- caves, basements, and tunnels use negative `level` values such as `-1` or `-2`
- they still use normal `floorId`, polygon, node, and transition rules
- movement into them still requires explicit transitions

Example uses:

- cave entrance from terrain `level = 0` to cave `level = -1`
- basement stairs from house ground floor `level = 0` to basement `level = -1`
- deeper dungeon stair from `level = -1` to `level = -2`

`level` should therefore be understood as stack ordering among overlapping traversable surfaces,
not as a synonym for absolute world height.

## Recommended First Implementation Slice

Do not start by making all map nodes multi-owned at once.

Start with one authored vertical slice:

1. One `level = 0` floor entity
2. One `level = 1` floor entity
3. One stair opening hole in the upper floor
4. One explicit stair transition between a node on floor 0 and a node on floor 1
5. One visibility polygon test that hides the upper floor when the player is inside it

This gives a complete end-to-end test case before generalized authoring.

## Suggested In-Repo Authoring Format

For early implementation, keep the authored schema plain JSON-compatible.

```js
{
  floors: [
    {
      id: "houseA_floor0",
      level: 0,
      nodeBaseZ: 0,
      outerPolygon: [...],
      holes: [],
      visibilityPolygon: [...],
      visibilityHoles: []
    },
    {
      id: "houseA_floor1",
      level: 1,
      nodeBaseZ: 3,
      outerPolygon: [...],
      holes: [...],
      visibilityPolygon: [...],
      visibilityHoles: [...]
    }
  ],
  transitions: [
    {
      id: "houseA_stairs_0_to_1",
      type: "stairs",
      from: { x: 26, y: 19, floorId: "houseA_floor0" },
      to: { x: 26, y: 19, floorId: "houseA_floor1" },
      bidirectional: true,
      zProfile: "linear"
    }
  ]
}
```

Note:

- a section's ordinary terrain floor may be omitted from authored data and synthesized during load
- negative-level floors should still be authored explicitly

The absence of an authored ground-floor record is itself the signal that the loader should provide the ordinary terrain floor.

## Worked Cave Example

This example shows authored data that omits the ordinary terrain floor, one authored cave floor below it, and one explicit entrance transition.

```js
{
  floors: [
    {
      id: "section_12_8_cave_a",
      level: -1,
      nodeBaseZ: -4,
      outerPolygon: [
        { x: 40.0, y: 44.0 },
        { x: 52.0, y: 44.0 },
        { x: 54.0, y: 51.0 },
        { x: 48.0, y: 57.0 },
        { x: 39.0, y: 54.0 }
      ],
      holes: [],
      visibilityPolygon: [
        { x: 40.0, y: 44.0 },
        { x: 52.0, y: 44.0 },
        { x: 54.0, y: 51.0 },
        { x: 48.0, y: 57.0 },
        { x: 39.0, y: 54.0 }
      ],
      visibilityHoles: []
    }
  ],
  transitions: [
    {
      id: "section_12_8_cave_entrance_a",
      type: "stairs",
      from: { x: 46, y: 47, floorId: "section_12_8_ground" },
      to: { x: 46, y: 47, floorId: "section_12_8_cave_a" },
      bidirectional: true,
      zProfile: "linear",
      movementCost: 1,
      penalty: 0,
      metadata: {
        entranceKind: "cave-mouth"
      }
    }
  ]
}
```

Interpretation:

- the ordinary terrain floor is not authored here; the loader synthesizes it for the section at runtime
- the player can stand on ordinary terrain at `level = 0`
- the cave is a separate overlapping traversable surface at `level = -1`
- movement between them only happens through the explicit transition
- cave reveal is a separate rendering choice from overhead floor cutaway

## Footprint Inheritance

To make stacked construction easy by default, a newly created upper floor may optionally inherit
its initial `outerPolygon` from the floor or wall loop below.

That inheritance should only be a starting point, not a rule.

The author must still be free to:

- keep the same footprint
- shrink the next level inward
- extend part of the next level outward
- add an exposed balcony or roof deck

In other words, default footprint reuse is desirable, but geometric independence between levels is required.

## Floor Builder Tool Semantics

When the flooring/road tool is dragged over ordinary terrain, it should keep the current behavior
and paint node-based road/floor tiles.

When it is targeted onto a valid enclosed wall loop, it should switch modes and generate a floor section:

1. Find a simple closed wall loop from the hovered wall section.
2. Use the wall loop's outer edge to build `outerPolygon`.
3. Treat that authored area as the walkable floor area.
4. Let existing wall collision/blocking handle the fact that enclosed walls are not traversable.
5. Create one polygon floor section object instead of per-node `Road` tiles.

This gives you a stable shell for vertical stacking while keeping the default authoring path simple.

## Implementation Order

1. Add floor schema support to map data loading.
2. Materialize floor-owned nodes from authored polygons.
3. Register explicit inter-floor transitions as traversal edges.
4. Route pathfinding across those transitions.
5. Add level-aware visibility hiding in rendering.
6. Build one authored test structure before expanding tooling.