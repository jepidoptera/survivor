---
name: Key Globals & Conventions
description: Global variables used throughout client code, coordinate conventions, depth metric, section key format
type: project
---

# Key Globals & Conventions

## Browser Globals (client code)

These are implicit globals used throughout the game code:

| Global | Type | Description |
|--------|------|-------------|
| `wizard` | Wizard | The player character |
| `map` | Map | The hex grid map |
| `viewport` | Object | Camera viewport `{x, y, z, width, height}` |
| `viewscale` | number | Pixels per world unit |
| `xyratio` | number | Y compression ≈ 0.66 |
| `renderAlpha` | number | Sub-frame interpolation alpha 0→1 |
| `mousePos` | Object | `{screenX, screenY}` current mouse position |
| `textures` | Object | `textures[animalType].list` = PIXI.Texture[] |
| `PIXI` | Object | PixiJS library |
| `presentGameFrame` | Function | Trigger a render frame |
| `performance` | Object | Browser performance API |

## Module Globals (client IIFEs)

Each major module registers itself on `globalThis`:
- `globalThis.WallSectionUnit`
- `globalThis.Roof`
- `globalThis.RenderingCamera`
- `globalThis.RenderingLayers`
- `globalThis.PathfindingService`
- `globalThis.PathfindingSnapshot`
- `globalThis.LOSSystem`
- `globalThis.LOSVisualSettings`
- `globalThis.TriggerAreaSpell`
- `globalThis.Spell`

Section world sub-modules register as `globalThis.__sectionWorldXxx` (two underscores, PascalCase suffix).

## Coordinate Conventions

### World Space
- X axis: horizontal, positive right. Step = 0.866 per grid column.
- Y axis: vertical on screen, positive down. Step = 1.0 per grid row (odd columns shifted +0.5).
- Z axis: height above ground, positive up. Z lifts objects upward on screen.

### Screen Space
- Origin = top-left of viewport.
- `screenX = (worldX - viewportX) * viewscale`
- `screenY = ((worldY - viewportY) - (worldZ - viewportZ)) * viewscale * xyratio`

### Depth Metric (for WebGL depth buffer)
```
depthMetric = camDy + camDz
```
Where `camDy = worldY - cameraY`, `camDz = worldZ - cameraZ`.
Near = -128, Far = 256. Objects with larger Y (further from top of screen) and larger Z (higher) sort deeper.

## Section Key Format

`"q,r"` — comma-separated axial coordinates, integers, no spaces.
Example: `"0,0"`, `"-1,2"`, `"3,-1"`

## Node Coord Key Format

`"xindex,yindex"` — comma-separated even-Q offset indices.
Example: `"42,17"`, `"-3,5"`

## Floor/Layer Z Convention

```
level 0 → baseZ = 0
level 1 → baseZ = 3
level 2 → baseZ = 6
level -1 → baseZ = -3 (or -4 for caves)
```
`Spell.getLayerBaseZForLevel(level)` = `level * 3`

## Object Types (type field)

Common values for object `type` property:
- `"wallSection"` — wall segment
- `"tree"` — tree
- `"road"` — road tile
- `"flower"` — flower/plant
- `"door"` — door
- `"window"` — window
- `"roof"` — roof polygon
- `"triggerArea"` — scripted trigger area
- `"furniture"` — furniture item
- `"sign"` — sign/text object

## Asset Path Normalization

`normalizeLegacyAssetPath(path)` — converts old `.jpg` extensions to `.png` for flowers and windows:
- `/assets/images/flowers/*.jpg` → `.png`
- `/assets/images/windows/*.jpg` → `.png`

## IDs

WallSectionUnit IDs are integers, tracked in `WallSectionUnit._allSections Map<id, unit>` and `WallSectionUnit._nextId`.
Object records need integer `id` field for the persistence system. `normalizePrototypeRecordIds` assigns IDs to any records missing them.
