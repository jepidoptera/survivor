# Saved Building Integration Plan

## Goal

Move saved Building Editor files into the main game as first-class streamed world assets.

A building exists in global world space. Its footprint is the union of all authored floor polygons projected onto `z = 0`. A building can overlap one or more map sections. When any overlapped section becomes loaded or desired-active, the building must enter the same background load pipeline as sections, walls, objects, floors, and entities.

From outside, a loaded building should render as one depth-tested bitmap/composite: screen pixels plus depth information presented as a single exterior draw. The player can walk in front of it and behind it, and the existing building fade/cutaway behavior should continue to drive visibility. From inside, the current interior floor presentation is already good and should remain the baseline. Later, each floor may also get a one-piece depth-tested screen buffer for faster interior rendering.

## Non-Goals

- Do not preserve the old straight-stair concept.
- Do not add silent rendering, loading, save/load, or cache fallbacks for impossible states.
- Do not functionally replace the existing building fade/cutaway behavior unless the building import requires a narrow adapter.
- Do not begin with per-floor interior compositing. That is an optimization after correctness is established.

## Current State

Building Editor saves live under `public/assets/saves/building-editor` and use `schema: "survivor-building-v1"`. They already contain:

- `floorFragments`
- `wallSections`
- `mountedWallObjects`
- per-floor roofs
- floor elevations via `nodeBaseZ` / `nodeBaseZOffset`
- stair tread geometry

The main game already has:

- polygon floor fragments and floor nodes
- `surfaceId` / `fragmentId` floor identity
- section-owned floor registration and unregistering
- inferred floor-building groups used by cutaway and fade rendering
- depth-tested wall, roof, floor, and billboard render paths
- building cutaway composite render textures
- Building Editor playtest floor snapshots that follow the desired fade pattern
- a shared `StairTraversal` runtime that already supports tread-path stairs

The biggest gap is not raw rendering capability. The gap is ownership and streaming: saved buildings are not yet placed, indexed, loaded, converted, invalidated, and unloaded as first-class world assets.

## Target Building Model

Use a placement manifest separate from section files:

```js
{
  id: "building:house-a",
  buildingSaveName: "the house",
  transform: {
    x: 120.5,
    y: -44.0,
    rotation: 0
  },
  footprintPolygons: [],
  overlappedSectionKeys: [],
  loadState: "unloaded"
}
```

The placement record references the editor save. The imported runtime asset is derived data and can be regenerated.

Persist placed buildings in the section-world save slot, probably as `public/assets/saves/{slot}/buildings.json` or as a `buildings` field in the slot bundle response. Avoid copying a full building save into every section it overlaps.

## Building As Virtual Section

A building should behave like a virtual section for loading and ownership, but it should not need to masquerade as a real axial section.

Use stable virtual keys:

```js
building:<placementId>
```

Runtime floor fragments, walls, mounted objects, roofs, stairs, and caches should carry enough building identity to remove them by building id without geometric guessing.

Example imported floor identity:

```js
{
  fragmentId: "building:house-a:floor-fragment-10",
  surfaceId: "building:house-a:floor-fragment-10",
  ownerSectionKey: "building:house-a",
  buildingId: "building:house-a",
  level: 0,
  nodeBaseZ: 0,
  outerPolygon: [...]
}
```

`ownerSectionKey` can be a virtual key for runtime bookkeeping. Section overlap remains a separate index.

## Section Overlap Index

At map-slot load time:

1. Load building placements.
2. Load or inspect each referenced building save enough to compute its transformed footprint.
3. Compute all section keys overlapped by that footprint.
4. Build:

```js
map._prototypeBuildingState = {
  placementsById: Map,
  buildingIdsBySectionKey: Map,
  loadedBuildingsById: Map,
  desiredBuildingIds: Set,
  pendingLoadsById: Map
}
```

When active or pending-active section keys change, desired buildings are:

```js
union(buildingIdsBySectionKey.get(sectionKey) for each desired sectionKey)
```

If any overlapped section is desired-active, the building is desired-loaded.

## Load Queue Integration

Building sync should plug into the existing prototype async session rather than creating a separate scheduler.

The desired ordering is:

1. Layout/materialize section nodes.
2. Building plan: compute desired building ids from active/pending-active section keys.
3. Building load/unload tasks.
4. Wall sync.
5. Object sync.
6. Animal/powerup sync.
7. Floor object indexes and render-cache invalidation.

Building load tasks:

- fetch editor save if needed
- normalize and validate building payload
- apply placement transform
- compute footprint and overlap
- register floor fragments
- materialize floor nodes
- instantiate or register wall records
- instantiate mounted wall objects
- instantiate roofs
- register stair runtime records
- mark building render caches dirty
- mark exterior composite dirty

Building unload tasks:

- hide/destroy exterior composite
- unregister stair runtime records
- remove mounted objects
- remove roofs
- remove walls and blocked edges
- unregister floor nodes/fragments
- clear building render cache
- remove loaded-building runtime record

Every unload operation should target records by `buildingId` or virtual owner key. Do not find things by scanning approximate positions.

## Import Converter

Add a converter that turns an editor building save plus placement transform into a main-game runtime building asset.

Responsibilities:

- validate `schema === "survivor-building-v1"`
- normalize legacy editor shape through the existing editor model where possible
- transform all points from local building space into global world space
- prefix all IDs with the placement id
- preserve floor `level`, `nodeBaseZ`, `holes`, texture paths, and roof metadata
- convert editor walls into main-game wall records or direct `WallSectionUnit` inputs
- convert mounted wall objects and remap their wall references to prefixed wall ids
- convert roofs with prefixed floor/building references
- compute the footprint union from all floor outer polygons projected to ground
- compute overlapped section keys from the footprint
- build one canonical stair model for every stair

Hard failures:

- missing referenced floor
- missing referenced wall
- invalid floor polygon
- invalid stair treads
- footprint union failure
- missing texture/composite resource when rendering requires it

## Unified Stair Model

Remove the concept of straight stairs from runtime design. There should be one general-purpose stair class/model based on tread paths.

A straight stair is represented by straight tread geometry. It does not need a separate type.

Canonical stair shape:

```js
{
  type: "stairs",
  id: "building:house-a:stair-2",
  lowerFloorId: "building:house-a:floor-fragment-10",
  higherFloorId: "building:house-a:floor-fragment-41",
  lowerZ: 0,
  higherZ: 5,
  treads: [
    { left: { x, y }, right: { x, y }, center: { x, y } },
    { left: { x, y }, right: { x, y }, center: { x, y }, arcDeltaAngle, arcNearDeltaAngle }
  ],
  width: 2.2,
  stepCount: 20,
  footprint: [...]
}
```

`type: "stairs"` should be sufficient once migration is complete. If a transitional discriminator is needed during implementation, use it internally and remove it when the old straight path is gone.

Runtime traversal should use `StairTraversal.createTreadPathFrame` and related path APIs:

- `localPointForPathFrame`
- `localInsidePathFrame`
- `supportFromPathLocal`
- `movePathLocal`
- `pointFromPathLocal`
- `exitPointFromPathLocal`
- `pathPolygonForUpDownRange`
- `endpointLineCrossed`

The old straight-specific runtime helpers should be collapsed into general stair helpers.

## Exterior Rendering

Outside view target:

- Build or update a per-building exterior composite render texture.
- Render all exterior structural pieces into it with depth testing.
- Present the composite as one depth-tested billboard/proxy in the main world render.
- Hide or suppress the original live structural pieces when the exterior composite is valid and active.

The exterior composite key should include:

- building id
- placement transform
- building content version
- loaded texture readiness version
- camera rotation/pitch assumptions
- render scale/resolution assumptions

Because the camera perspective is fixed in normal play, this should be stable most of the time. If camera rotation or pitch becomes variable, either regenerate explicitly or fail loudly if the cache is being used under incompatible camera state.

Required invariant:

```text
If exterior composite presentation is required, missing composite texture is an error.
```

Do not quietly fall back to drawing every wall live in the exterior path. That would hide the performance bug and make rendering mysteries harder to diagnose.

## Interior Rendering

Initial integration should keep current live interior rendering.

Later optimization:

```js
regenerateBuildingFloorComposite(buildingId, floorId, reason)
```

Each interior floor can have its own depth-tested screen buffer. It should include architectural/static floor content for that floor, while dynamic actors, projectiles, previews, and UI remain live.

Invalidate a floor composite when:

- an object on that floor is created
- an object on that floor is destroyed
- an object on that floor changes render shape or texture
- a wall/opening/floor/roof on that floor changes
- a mounted object on that floor changes

Do not invalidate every floor unless the mutation genuinely crosses floors.

## Fade And Cutaway Behavior

Keep the existing building fade/cutaway behavior as the functional model.

The important rule for screen-space replacement fades remains:

1. Capture the outgoing layer/scene into a render texture.
2. Hide or suppress the outgoing live layer.
3. Render the incoming live scene normally.
4. Fade the captured snapshot with normal blending.

Do not render two partial-alpha copies of the same scene over each other.

For map-space/camera-following fades, fading geometry should remain live in world space so it stays stationary relative to the map.

## Milestones

### 1. Unify Stairs

- Replace main-game straight-stair runtime paths with one tread-path stair runtime.
- Migrate any old straight stair definitions by generating two straight tread lines.
- Update movement support, endpoint crossing, rendering, and tests to use path stairs.
- Keep failure messages specific for invalid stairs.

### 2. Building Placement Manifest

- Add save/load support for placed building records.
- Add a section-overlap index.
- Add tests for a building that overlaps one section and multiple sections.

### 3. Building Import Converter

- Convert one saved editor building into transformed runtime floors, walls, mounted objects, roofs, and stairs.
- Prefix all ids.
- Register/unregister by building id.
- Verify no cross-building id collision.

### 4. Async Building Streaming

- Add building desired-set planning to the section-world async queue.
- Load a building when any overlapped section becomes desired-active.
- Unload when no overlapped section remains desired-active.
- Verify load/unload ordering with walls, objects, and floor nodes.

### 5. Live Render Integration

- Render imported buildings using existing live wall/roof/floor/interior paths.
- Confirm current fade/cutaway behavior works for imported buildings.
- Keep this milestone correctness-first, even if exterior draw call count is still high.

### 6. Exterior Composite

- Add per-building exterior depth-tested render texture.
- Present it as one world depth billboard/proxy.
- Suppress original exterior live structure while the composite is active.
- Add hard diagnostics for missing/incompatible composites.

### 7. Interior Floor Composites

- Add `regenerateBuildingFloorComposite(buildingId, floorId, reason)`.
- Invalidate narrowly on floor-local mutations.
- Keep dynamic actors and interactions live.

## Test Plan

Stairs:

- straight-looking stair represented as tread path
- curved/turning stair represented as tread path
- endpoint crossing lower-to-stair and stair-to-higher
- failed stair with missing treads throws
- actor cannot enter stair from the wrong side/opening

Building import:

- imported floors get prefixed fragment ids and surface ids
- mounted object wall references remap to prefixed wall ids
- footprint covers the union of floor polygons
- invalid building save fails loudly

Streaming:

- one-section building loads with its section
- multi-section building loads when any overlapped section loads
- multi-section building remains loaded while at least one overlapped section is active
- building unload removes all building-owned runtime records

Rendering:

- imported building participates in existing cutaway/fade
- exterior composite suppresses original exterior pieces
- missing exterior composite texture fails loudly
- camera-incompatible exterior composite fails loudly

Persistence:

- placed building manifest round-trips through `/api/sectionworld`
- building placement transform survives save/load
- no building data is duplicated into every overlapped section file

## Open Decisions

- Whether placed building manifests live in `buildings.json` or inside `manifest.json`.
- Whether `ownerSectionKey` should accept virtual building keys directly or whether floor fragments should gain a separate `ownerBuildingId`.
- Whether exterior composites should be prebuilt during building load or lazily built on first visible exterior frame.
- How much editor renderer code should be shared with main-game building rendering versus copied into a runtime-specific builder.
