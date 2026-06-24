# Building World Unit Integration Plan

## Goal

Make placed buildings first-class world units, parallel to outdoor map sections.

A placed building is not data inside an outdoor section. A placed building is its own section-like save unit with its own identity, savefile, dirty state, structural model, interior contents, NPCs, triggers, and runtime load state. Outdoor sections only contain lightweight references that say, "this section overlaps this building, so loading this section also requires at least the building exterior shell."

This solves two related problems:

- A building can overlap many outdoor sections without duplicating its data into each section.
- Moving inside a building should not shift outdoor section bubbles or impose loading penalties when crossing invisible outdoor section boundaries.

## Core Concepts

### World Units

The streamed world is made of independently saved world units:

```text
section:<sectionKey>
building:<buildingInstanceId>
```

Outdoor sections are still generated and streamed by section bubble. Buildings are discovered through section refs, but once loaded they are their own world unit.

### Building Instance Save

When a building is placed, the game creates a building instance from a copied Building Editor save. The editor save is a template. The placed building owns its copy from that point forward.

Use the existing building save format as the base structural format. The work here is not to invent a separate building-file layout, but to extend the saved building instance with world-instance metadata and building-owned contents such as objects, NPCs, and triggers.

Example additions to the existing building save shape:

```js
{
  schema: "survivor-building-v1",
  id: "building:placed-12",
  name: "the tower instance",
  sourceBuildingSaveName: "the tower",
  transform: { x: 120.5, y: -44.0, rotation: 0 },
  floorFragments: [],
  wallSections: [],
  mountedWallObjects: [],
  footprintPolygons: [],
  movementBlockerPolygons: [],
  touchedSectionKeys: ["0,0", "0,1"],
  objects: [],
  animals: [],
  triggers: [],
  loadState: "unloaded"
}
```

The saved building file is the instance-owned structural copy plus its building-owned world contents. Later edits to the original editor template must not rewrite already placed buildings.

Preview and live runtime data must stay separate:

- Placement previews load from the Building Editor template save by name.
- Live placed-building rendering, collision, support fragments, objects, NPCs, and triggers load from the specific building instance saved to the current game.
- Runtime caches should reflect that split. Template-preview caches may be keyed by save name; live building caches must be keyed by building instance id and content version.

### Outdoor Section Building Refs

Each outdoor section touched by a building stores only a lightweight reference:

```js
{
  buildingRefs: [
    {
      id: "building:placed-12",
      shell: true
    }
  ]
}
```

The section does not own the building contents, structural model, NPCs, or interior objects. It only provides discovery for exterior shell loading.

## Streaming Scope vs Ownership

Keep these two systems separate.

### Streaming Scope

Streaming scope controls what is currently loaded and simulated.

Outdoor scope:

- The section bubble follows the wizard.
- Outdoor sections around the wizard are active.
- Exterior shells for referenced buildings are loaded.

Building scope:

- The active context is one building instance.
- The full building interior is loaded.
- Outdoor section bubble shifting is suspended for indoor movement.
- The building may still keep nearby outdoor shell/context cached for exits, windows, falling, or rendering.

The wizard may switch scope by walking through a passable opening, jumping from a balcony, falling through a hole, teleporting, or by any other support-fragment transition. Doors are not special streaming/scope authorities; they are passable wall geometry. A wall hole and a door opening should resolve through the same support-fragment transition rules.

### Ownership And Dirty Tracking

Ownership controls where data is saved. It must not depend on the current streaming scope.

Use a dirty registry like:

```js
dirtyWorldUnits = {
  sections: Set<sectionKey>,
  buildings: Set<buildingInstanceId>
};
```

If the player modifies a building, leaves it, walks outdoors, and saves later, the building instance must still be written. Dirty units stay dirty until saved.

Mutation ownership examples:

- Outdoor terrain/tree/road/free object: owning outdoor section dirty.
- Building structure/interior object/building NPC: owning building dirty.
- Object moved from outdoor into building: remove from section, add to building, mark both dirty.
- Object moved from building to outdoor: remove from building, add to section, mark both dirty.
- Thrown object leaving a balcony: transfer ownership when support changes.

## Support Fragments

Floor fragments are the bridge between movement, streaming transitions, and persistence ownership.

Every actor/object that needs support tracking has an assigned support fragment:

```js
{
  id: "building:placed-12:floor:balcony",
  ownerType: "building",
  ownerId: "building:placed-12",
  z: 6,
  polygon: []
}
```

Outdoor ground is also a support fragment:

```js
{
  id: "section:0,0:ground",
  ownerType: "section",
  ownerId: "0,0",
  z: 0,
  polygon: []
}
```

This lets a building contain many fragments with different textures and roles: living room, balcony, roof walk, stair landing, basement floor, etc. Walking from the living room onto the balcony can change support fragment without leaving the building world unit.

Generated outdoor section-ground fragments are runtime support geometry, not durable wizard save anchors. A wizard standing on ordinary outdoor level-0 ground should save as ground support with no `fragmentId`/`surfaceId`. Older saves that recorded ids like `section:0,0:ground` are normalized during load so they restore as plain ground support instead of failing against a stale generated section footprint.

## Support Validation Rule

When support validation is required:

1. If the object footprint still intersects its assigned support fragment, keep it.
2. Otherwise, starting from the object's current `z`, search downward for the highest support fragment below that intersects the object's footprint.
3. Include outdoor ground level `z = 0` as a support fragment.
4. If a fragment is found, assign it.
5. If the owning world unit changed, transfer persistence ownership and update dirty sets.
6. If no fragment is found, the object falls into the void and is lost.

There is always a valid outdoor world position in normal play because the outdoor world is continuous and section generation can create missing sections. The exception is deliberately unsupported space, such as a cut hole with nothing below; that is a void/pit and should be allowed to kill or remove the falling thing.

## Support Validation Frequency

Do not bounds-check every object and NPC every frame.

Recommended triggers:

- Wizard: check during movement, jumping, falling, and other continuous motion because support changes can switch streaming scope.
- NPCs: normal node/path movement should already know where it is going; validate when displaced outside planned movement, such as knockback, throwing, pushing, scripted teleport, or broken floor underneath.
- Static objects: validate only when placed, moved, picked up, dropped, thrown, or when their support fragment changes/removes.
- Physics objects: validate while airborne or moving; stop once settled.
- Building edits: when a floor fragment is changed or removed, revalidate occupants that were assigned to affected fragments.

## Building Load States

Use explicit load states:

```text
unloaded
shell
interior
```

`shell` includes enough data for outdoor play:

- exterior composite/render proxy
- footprint
- outdoor collision/blockers
- roof/cutaway metadata needed by exterior rendering
- passable wall/opening geometry needed to decide whether movement can cross the shell

`interior` includes:

- full building structural model
- all support fragments
- interior objects
- NPCs
- triggers
- stairs and traversal data
- per-floor rendering/cutaway data

Loading an outdoor section should require shell load for referenced buildings. Entering or actively simulating a building promotes it to interior.

## Runtime Data Flow

### Placement

1. Player selects a Building Editor save.
2. Game loads and validates the editor save.
3. Game creates a new building instance id.
4. Game deep-copies the editor save into the building instance.
5. Game computes transformed footprint, blockers, touched section keys, and shell metadata.
6. Game writes/marks dirty the new building instance.
7. Game adds lightweight building refs to every touched outdoor section and marks those sections dirty.

### Outdoor Streaming

1. Active outdoor section set changes.
2. Gather `buildingRefs` from active/desired sections.
3. Ensure each referenced building shell is loaded.
4. Render shell/exterior; do not hydrate full interior unless required.

### Building Entry

1. Wizard movement crosses passable geometry and support changes to a building-owned fragment.
2. Promote that building to `interior`.
3. Switch wizard streaming scope to `building:<id>`.
4. Suspend outdoor bubble shifting caused by indoor movement.

### Building Exit

1. Wizard support validation finds an outdoor support fragment, or another non-building owner.
2. Transfer wizard scope to outdoor.
3. Resume section bubble streaming from the wizard's world position.
4. Keep dirty building state dirty until save.

## Import Converter

The converter turns a building instance's `buildingData` plus placement transform into runtime records.

Responsibilities:

- Validate `schema === "survivor-building-v1"`.
- Normalize legacy editor shape through existing editor model helpers where possible.
- Transform all local building points into global world space.
- Prefix runtime ids with the building instance id.
- Preserve floor `level`, `nodeBaseZ`, holes, texture paths, roof metadata, and material data.
- Convert floors into support fragments owned by the building instance.
- Convert walls into runtime wall/blocker/render records.
- Convert mounted wall objects and remap wall references to prefixed wall ids.
- Convert roofs with prefixed floor/building references.
- Build stair traversal records from tread-path data.
- Compute footprint and touched outdoor section keys.
- Treat doors and wall holes as passable geometry, not separate transition records.

Hard failures:

- Missing referenced floor.
- Missing referenced wall.
- Invalid floor polygon.
- Invalid support fragment.
- Invalid stair treads.
- Footprint/touched-section computation failure.
- Missing texture/composite resource when rendering requires it.

Per project convention, avoid silent fallback behavior on correctness-critical rendering, loading, cache, build, save, and geometry paths.

## Rendering

### Exterior Shell

From outside, a loaded building shell should render as a depth-tested exterior composite/proxy when available.

The exterior composite key should include:

- building instance id
- building content version
- placement transform
- loaded texture readiness version
- camera rotation/pitch assumptions
- render scale/resolution assumptions

If exterior composite presentation is required, a missing or incompatible composite texture is an error. Do not quietly fall back to drawing every structural piece live in the exterior path.

### Interior

The game already has per-floor prototype building interior bitmaps/composites through the `interiorBitmapsByKey` cache and `requestPrototypeBuildingInteriorBitmap` path. The building-world-unit work should preserve that path and retarget its ownership/cache keys from placement/save-name assumptions toward building instance ids.

Invalidate only the affected floor when possible:

- object on that floor created/destroyed
- object render shape/texture changes
- wall/opening/floor/roof on that floor changes
- mounted object on that floor changes

Required adaptation:

- Interior bitmap keys must include the building instance id and source floor id.
- Interior bitmap signatures must include building instance content version, not just template save data.
- A modified building instance must invalidate its own affected floor composites even after the wizard leaves the building.
- Missing or failed interior bitmap generation should remain a hard diagnostic, not a silent live-render fallback.

### Fade And Cutaway

Keep the existing building fade/cutaway behavior as the functional model.

For screen-space replacement fades:

1. Capture the outgoing layer/scene into a render texture.
2. Hide or suppress the outgoing live layer.
3. Render the incoming live scene normally.
4. Fade the captured snapshot with normal blending.

Do not render two partial-alpha copies of the same scene over each other.

For map-space/camera-following fades, fading geometry should remain live in world space so it stays stationary relative to the map.

## Implementation Milestones

### 1. Save Format And Registry

- [x] Extend the existing building save format with placed-instance metadata and placeholder building-owned objects/NPCs/triggers arrays.
- [x] Add building-instance save/load integration parallel to section files for IndexedDB saves (`slot_buildings`).
- [x] Add dirty world-unit registry for sections and buildings.
- [x] Treat section-world as the canonical current game save model; current saves no longer write legacy top-level `staticObjects`.
- [x] Keep top-level `animals`/`powerups` empty for section-world saves; current runtime entities persist through section/building owner records.
- [x] Add compatibility migration from old top-level `prototypeSectionWorld.buildings` placement records.
- [x] Normalize generated outdoor ground wizard support on save/load so `section:*:ground` does not survive as a durable wizard floor anchor.
- [ ] Clear dirty world-unit entries after successful selective saves.
- [x] Add a true server/export building-file backend parallel to the IndexedDB building store.

### 2. Section Refs

- [x] Change outdoor sections so they store only lightweight `buildingRefs`.
- [x] Build an index from section key to building ids.
- [x] Ensure saving an outdoor section never duplicates full building data.

### 3. Building Placement

- [x] On placement, deep-copy the editor save into a new building instance.
- [x] Compute touched outdoor sections.
- [x] Add refs to touched sections.
- [x] Mark building and touched sections dirty.

### 4. Shell Loading

- [x] Active outdoor section set gathers building refs from section assets, with the placement index as a derived fallback.
- [x] Load building shells through explicit `shell` load state and migrate old placements on shell load.
- [x] Keep shell rendering/collision available whenever any touched active section requires it.
- [ ] Unload shell data independently from full interiors when no active section requires it.
- [ ] Split shell data hydration from full structural/interior hydration more aggressively.

### 5. Interior Scope

- [x] Add current world scope:

```js
{ type: "sectionWorld" }
{ type: "building", id: "building:placed-12" }
```

- [x] Add explicit `interior` load-state promotion hooks.
- [x] Promote building scope to interior on entry/support change.
- [x] Suspend outdoor bubble shifting while the wizard remains building-supported.
- [x] Resume outdoor scope when support changes to outdoor ground or another section-owned fragment.
- [x] Reduce outdoor streaming bubble to an unordered four-section active set.
- [x] Apply a 10-meter hysteresis threshold only to loaded-section set changes; exact floor/support section resolution still switches immediately.
- [x] Add a prototype bubble settle phase before marking shifts complete.

Bubble settle phase handoff:

- Current evidence: the async bubble queue can finish smoothly, but the first post-completion frame can still hitch. A captured bad frame showed `drawMs`/`presentMs` around `52ms`, with `draw.collectCutawayMs` around `14.6ms` and `present.pumpMs` around `32ms`, while the completed bubble profile itself looked modest.
- Working theory: the queue is being marked complete too early. During the active shift, render protections hold expensive cutaway work; when `session.completed` flips, normal rendering resumes immediately and pays cutaway recomputation plus PIXI/browser present catch-up in one unprotected frame.
- Newer four-section bubble evidence: shifts represent active-bubble coverage changes rather than exact outdoor section-boundary crossings. A later expensive capture showed the main spike in `objects.roadSurfaceDirty` (`~41ms`) during bubble pump/settle, with cutaway held and `collectCutawayMs: 0`; this came from road-surface dirty flushes recursively calling `presentGameFrame()` while the bubble pump was still running.
- Minimal implementation: introduce a session phase such as `work -> settle -> complete`. When the queue drains, keep `_prototypeBubbleShiftSession` alive in `settle` for one or two render frames, keep the existing safe cutaway hold active, let present/display-tree changes settle, then mark complete.
- Stronger implementation if needed: make post-shift cutaway refresh queue-owned, e.g. a `render.cutawayRefresh`/settle task that slices the building/floor cutaway scan under the bubble budget and swaps from held state to refreshed state before completing.
- Safety constraints: do not hold stale cutaway state when the wizard is entering/inside a building, in a doorway transition, or on an upper/interior layer. Those cases need current cutaway/support state more than hitch smoothing.

### 6. Support Fragment Ownership

- [x] Give every relevant floor/support fragment an owner world unit.
- [x] Add shared `FloorSupport` helpers for fragment/support/entity owner resolution.
- [x] Add event-driven support validation.
- [x] Route editor placement for objects, powerups, and NPCs through visible floor/support targeting so building interiors can receive placed entities.
- [x] Transfer object ownership when support owner changes.
- [x] Transfer NPC ownership when support owner changes.
- [x] Transfer powerup ownership when support owner changes.
- [ ] Implement void fall/loss when no support is found below.

Event-driven support validation notes:

- `GameMap.validateActorMovementSupport(actor, options)` keeps a still-valid current support, otherwise searches downward from the actor's current world `z` for the highest floor/support fragment under the footprint.
- The validation result reports `ownerChanged`, `previousSupport`, `nextSupport`, and `lost` so persistence transfer can stay explicit in the next ownership slice.
- `markLost: true` marks unsupported actors/objects as void-lost (`gone`/`lostToVoid`) when no lower support exists.

### 7. Object And NPC Persistence

- [x] Store placeholder building-owned objects/NPCs/triggers arrays in the building instance save.
- [x] Persist runtime building-owned objects into building instance arrays.
- [x] Persist runtime building-owned NPCs into building instance arrays.
- [x] Persist runtime building-owned powerups into building instance arrays.
- [ ] Persist runtime building-owned triggers into those arrays.
- [x] Keep section-owned objects in section files.
- [x] Keep section-owned NPCs in section files.
- [x] Keep section-owned powerups in section files.
- [x] Mark both old and new object owners dirty on transfer.
- [x] Mark both old and new NPC owners dirty on transfer.
- [x] Mark both old and new powerup owners dirty on transfer.
- [ ] Validate thrown/pushed/teleported actors and objects.

### 8. Rendering And Cache Hardening

- [ ] Add or adapt exterior shell composite.
- [x] Preserve and retarget the existing per-floor interior bitmap/composite path for building instances.
- [x] Add hard diagnostics for missing render/cache invariants in touched shell/interior bitmap paths.
- [x] Include building instance id/content version in building bitmap cache signatures.
- [ ] Add narrow invalidation by building/floor/content version for all building-owned runtime edits.

## Test Plan

Persistence:

- Place a building and verify a building instance save is created.
- Verify touched section files contain only refs.
- Modify building interior, leave building, save outdoors, reload, and verify interior changes persist.
- Place objects, NPCs, and powerups on upper building floors, save outside, reload, and verify they remain building-owned.
- Save a section-world game and verify it has no legacy top-level `staticObjects` payload.
- Load an old wizard save containing `fragmentId: "section:*:ground"` and verify the wizard restores to plain ground support without a recovery warning.
- Verify old top-level building placement saves migrate or load compatibly as imports only.

Streaming:

- A one-section building shell loads with its section.
- A multi-section building shell loads when any touched section is active.
- Moving inside a multi-section building does not shift outdoor section bubble.
- Leaving from a balcony/roof resumes outdoor section streaming.
- Bubble completion does not produce a first-post-shift frame hitch from cutaway recompute or present catch-up.

Support:

- Living room to balcony changes support fragment but not building world unit.
- Jump from balcony finds outdoor ground at `z = 0` and transfers to section world.
- Fall through a hole finds lower floor if present.
- Fall through a bottomless hole removes/kills the actor/object.
- Deleting a floor fragment revalidates affected occupants.

Ownership:

- Move object outdoor -> building marks both units dirty.
- Throw object building -> outdoor marks both units dirty.
- Runtime object capture now compares persistence owner signatures as well as save JSON, so support-owner changes are saved even when object geometry is unchanged.
- NPC displaced out of building transfers ownership when support changes.
- Powerup placed or moved into a building transfers ownership to the building instance.
- Quiet static objects do not perform continuous per-frame support checks.

Rendering:

- Exterior shell renders from outdoor sections.
- Full interior renders after entry.
- Missing required exterior composite fails loudly.
- Fade/cutaway does not overlap two partial-alpha copies of the same scene.

## Open Decisions

- Whether building interiors should ever be subdivided for extremely large buildings, and what threshold would justify it.
- How much exterior shell data can be loaded without hydrating full `buildingData`.
