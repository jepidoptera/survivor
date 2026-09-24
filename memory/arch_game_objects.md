---
name: Architecture: Game Objects
description: Wizard, Character, Animal, WallSectionUnit, Roof, Hitbox, staticObjects, placeables
type: project
---

# Game Objects

## Wizard (gameobjects/Wizard.js)

The player character. Key properties:
- `x`, `y`, `z` — world position (z = height above baseZ)
- `prevX`, `prevY`, `prevZ` — previous frame position (for render interpolation)
- `magic` — current magic points
- `currentLayer` / `selectedFloorEditLevel` / `traversalLayer` — which floor level the wizard is on
- `currentLayerBaseZ` — base Z of current floor
- `isGodMode()` — god mode ignores magic costs
- Game modes: `WIZARD_GAME_MODE_GOD`, `WIZARD_GAME_MODE_ADVENTURE`

**Shield effect:** A dodecahedron wireframe rendered via raw WebGL (custom GLSL, not PIXI). Cached as `wizardShieldDodecahedronCache`.

**Inventory:** `wizard.getInventory()` returns Inventory object. `inventory.set(key, qty)`, `inventory.add(key, qty)`.

## Character (gameobjects/Character.js)

Base class for all living entities (Wizard extends it, NpcCharacter extends it).
- Temperature system: `CHARACTER_FREEZE_TEMPERATURE_DEGREES = -20`
- Fire warm rate: `CHARACTER_FIRE_WARM_RATE_DEGREES_PER_SECOND = 10`
- `FrozenDeathBurstEffect` particle system — 60 snow particles on freeze-kill
- Magic points: `ensureMagicPointsInitialized()`

## NpcCharacter (gameobjects/NpcCharacter.js)

Extends Character. Key notes:
- Uses external scheduler (`useExternalScheduler = true`) — no internal `moveTimeout`
- Has fire effect sprite (5×5 spritesheet at `/assets/images/magic/fire.png`)
- PIXI sprite uses sliced spritesheet textures from global `textures[type]` object (NOT raw full-sheet image)
- Default stats: `walkSpeed=1`, `runSpeed=2`, `fleeRadius=-1`, `chaseRadius=-1`, `lungeSpeed=5.0`, `attackCooldown=1.5`, `strikeRange=0.8`
- `radius = size / 2` for hitbox

## WallSectionUnit (gameobjects/wallSectionUnit.js)

Represents a wall segment. Custom WebGL depth shader.
- Static registry: `WallSectionUnit._allSections = new Map<id, WallSectionUnit>()`
- Static counter: `WallSectionUnit._nextId`
- `loadJson(record, map, opts)` — creates from saved record
- `saveJson()` — serializes to record format
- `_applyDirectionalBlocking()` — blocks traversal edges on adjacent map nodes
- Key properties: `startPoint`, `endPoint`, `height`, `thickness`, `bottomZ`, `traversalLayer`, `level`, `wallTexturePath`, `texturePhaseA`, `texturePhaseB`, `direction`, `lineAxis`, `brightness`, `tint`, `script`, `scriptingName`
- `{ deferSetup: true }` option skips applying blocking (used for temp analysis instances)

**Texture path:** default `"/assets/images/walls/stonewall.png"`, repeat 0.1×0.1

## Roof (gameobjects/roof.js)

Polygon-based roof. Custom WebGL depth shader with world-wrap support.
- Default texture: `/assets/images/roofs/smallshingles.png`, repeat 0.125
- Depth range: near=-128, far=256

## Hitbox (gameobjects/hitbox.js)

Abstract base class with:
- `containsPoint(x, y)` — abstract
- `getBounds()` — abstract
- `intersects(otherHitbox)` — abstract

Helper functions:
- `getClosestPointOnSegment(px,py, ax,ay, bx,by)` — returns closest point on segment
- `checkCircleVsPolygon(circle, polygon)` — circle-polygon collision check

Subclasses (inferred from usage): `CircleHitbox`, `PolygonHitbox`

## staticObjects.js

Contains:
- `placeableMetadataByCategory` — Map of category → metadata (lazy loaded)
- `placeableMetadataFetchPromises` — in-flight fetch promises
- Road dirty rect merging/tracking system for level-0 surface rebakes
- `resolvePrototypeSectionAssetForNode(mapRef, node)` — get section asset for a node
- `flushPrototypeLevel0RoadSurfaceDirtyAsset(asset)` — triggers rebake
- `LEVEL0_ROAD_SURFACE_REBAKE_THROTTLE_MS = 1000`

## Placeable Categories

Served by `/api/placeables`:
- `flowers`, `windows`, `doors`, `furniture`, `signs`, `roof` (dir: `roofs`), `walls`

Image dirs: `/assets/images/{category}/`
Metadata files: `/assets/images/{category}/items.json`

## Animal Spritesheet

Spritesheet JSON files at `/assets/spritesheet/{type}.json` (bear, deer, goat, squirrel, yeti).
Global `textures[type]` object has `.list` array of PIXI.Texture frames.
