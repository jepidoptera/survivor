# Floor Object Rendering Plan

## Goal

Objects have one canonical floor membership. When a floor fragment is active, every object on that floor is drawn and targetable through a single routing model:

```js
const floorObjects = map.getObjectsForFloorMembership(activeFloor);
const cache = overlayCacheFor(activeFloor);
const cachedObjects = cache?.coveredObjectSet ?? new Set();

drawOverlayToScreen(cache.screenTexture);
drawOverlayToPicker(cache.pickerTexture);

for (const obj of floorObjects) {
  if (!cachedObjects.has(obj)) {
    drawLiveToScreen(obj);
    drawLiveToPicker(obj);
  }
}
```

The overlay cache owns two synchronized products built from the same object list:

- `screenTexture`: the visible overlay texture.
- `pickerTexture`: the pixel-accurate picker representation.

Picker output for cached objects must be pixel-by-pixel identical to the cached screen object. A rough hitbox proxy is not acceptable for this path.

## Core Invariants

- Each placed/static object has exactly one canonical floor membership:
  `ownerType | ownerId | floorId | level`.
- The canonical floor-object registry is the authority for “what is on this floor.”
- Node membership is for movement, blocking, and spatial lookup, not object ownership.
- Persistence records are for save/load, not object ownership.
- Building manifests and render caches are derived data, not object ownership.
- An overlay cache may suppress live screen/picker rendering only for objects it explicitly contains at their current render signature.
- If an object is on the active floor and is not covered by the current overlay cache, it must render live to both screen and picker.
- Save/sync must not change whether the existing runtime object is drawable or targetable.
- Removal must unregister the object, update persistence/manifest state, invalidate overlay/picker caches, and remove live picker/render entries immediately.

## Canonical Registry

Add a map-owned floor object index keyed by canonical floor membership:

```js
ownerType | ownerId | floorId | level
```

Example:

```js
building | building:placed-4 | floor-fragment-34 | 1
```

Required API:

```js
map.registerFloorObject(obj);
map.unregisterFloorObject(obj);
map.getObjectsForFloorMembership(membership);
map.getObjectsForFloorFragment(fragmentOrMembership);
```

Registration requires a valid canonical membership. Missing membership is a correctness error, not a fallback case.

## Placement

When `PlaceObject` creates an object:

1. Stamp canonical `_floorMembership`.
2. Register the object with `map.registerFloorObject(obj)`.
3. Attach it to nodes for movement/spatial queries.
4. Attach it to persistence/building manifests for save/load and overlay rebuilds.
5. Invalidate the overlay cache for that floor.

Placement should not create separate “render layer” state. The render layer is derived from canonical membership.

## Save And Sync

Save/sync should upsert persistence for the existing runtime object. It must preserve:

- object identity
- `_floorMembership`
- canonical floor registry membership
- targetability
- drawable status

After save, this must still hold:

```js
map.getObjectsForFloorMembership(object._floorMembership).includes(object)
```

Save may update `_prototypeRecordId` and persistence signatures. It must not cause the object to be treated as represented by an overlay cache unless that cache was rebuilt from the updated object list and signatures.

## Overlay Cache

Overlay cache build consumes the canonical floor object list:

```js
const floorObjects = map.getObjectsForFloorMembership(floorMembership);
```

It produces:

- screen texture
- picker texture
- `coveredObjectSet`
- per-object render/picker signatures

The covered list and textures are built together and are therefore in sync.

An object is covered by the overlay only if:

- it was included in this cache build
- its current render signature matches the cached signature
- its current picker signature matches the cached signature

If a cache is stale for an object, it must not suppress live rendering for that object.

## Screen Rendering

For an active floor:

1. Draw the overlay screen texture if current.
2. For each canonical floor object:
   - if covered by current overlay cache, skip live screen rendering
   - otherwise render live to screen

The ideal steady state is that all eligible floor objects are in the overlay cache, so live screen rendering for those objects drops to zero.

## Picker Rendering

Picker rendering mirrors screen routing:

1. Draw the overlay picker texture if current.
2. For each canonical floor object:
   - if covered by current overlay cache, skip live picker rendering
   - otherwise render live to picker

Cached picker output must be pixel-identical to cached screen output for the object. Do not replace cached picker output with hitbox-only proxies.

## Powerups

Powerups should be baked into overlay screen and picker textures so they are visible during stair/entry transitions before live rendering takes over.

If powerups gain animation or effects later:

- bake the static/base visual into the overlay
- render animated/additive effects live when needed
- mark animated state changes as cache-invalidating or live-overlay additions

## Removal

Removal must keep the existing working invalidation behavior intact:

1. Unregister from canonical floor registry.
2. Remove from nodes/spatial indexes.
3. Remove or tombstone persistence records.
4. Remove from building manifests.
5. Invalidate overlay screen and picker caches for the floor.
6. Remove live render and picker representations immediately.

## Tests

Add tests for:

- Placing upstairs furniture registers it in the canonical floor list.
- Saving does not remove it from the canonical floor list.
- Leaving/re-entering does not remove it from the canonical floor list.
- Overlay build consumes canonical floor objects.
- Overlay cache records covered objects and render/picker signatures.
- Crystal balls, chairs, rugs, and powerups are included in overlay screen and picker products.
- Cached objects are not live-rendered to screen.
- Cached objects are still targetable through the overlay picker texture.
- Objects missing from cache render live to screen and picker.
- Stale cache signatures do not suppress live rendering.
- Removing an object unregisters it and invalidates overlay and picker caches.

## Migration Notes

Demote or remove these as ownership/render authorities:

- transient render-layer fields
- discovery from whichever node/list happens to contain the object
- blanket `ownerType === "building"` live suppression
- bitmap readiness as proof that active-floor objects are represented
- building render cache membership as object existence

The final rule should be simple:

> The canonical floor registry answers what is on the floor. The current overlay cache answers which of those objects already have synchronized screen and picker representations. Everything else renders live to both screen and picker.
