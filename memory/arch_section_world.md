---
name: Architecture: Section World
description: Section module system, bubble/layout, dynamic loading, section asset format, wall splitting
type: project
---

# Section World System

The section world is the open-world streaming layer. The map is divided into hexagonal "sections" (groups of map nodes) that are loaded/unloaded as the player moves. Each section has axial coordinates `{q, r}` and a string key `"q,r"`.

## Module Composition (sectionWorld.js)

`sectionWorld.js` is the composition root — it imports and wires together all sub-modules:

| File | Responsibility |
|------|---------------|
| `sectionWorldApiInstallers.js` | Installs section + traversal APIs onto the world object |
| `sectionWorldSectionRuntime.js` | Sparse node creation, seam segments, section asset activation |
| `sectionWorldLayout.js` | `setActiveCenter` — manages which sections are in the "bubble", draw-order sort |
| `sectionWorldState.js` | `buildSectionRecords` — creates section metadata from config |
| `sectionWorldAssets.js` | Ground texture picking, hex edge geometry, floor boundary math |
| `sectionWorldPersistence.js` | Wall/object persistence signatures, save/load helpers |
| `sectionWorldBlocking.js` | Directional edge blocking (walls block movement edges), clearance dirty |
| `sectionWorldEntitySync.js` | Entity sync (animals, objects) across sections |
| `sectionWorldBubbleSync.js` | Bubble sync helpers |
| `sectionWorldAsyncSync.js` | Async planner for deferred operations |
| `sectionWorldImport.js` | Load section asset bundles from JSON (fetch with cache-bust) |
| `sectionWorldRuntimeRecords.js` | Runtime record APIs |
| `wallSectionSplitting.js` | Split walls that cross section seams at load time |

## Bubble System

The "bubble" = the set of active sections centered on the player's current section. `setActiveCenter(map, nextCenterKey, deps)` activates/deactivates sections. Sections outside the bubble are deactivated (nodes removed). Sections in the bubble get their sparse nodes added to the map.

`getBubbleKeysForCenter` returns the set of section keys that should be active for a given center.

## Section State Shape (map._prototypeSectionState)

```js
{
  sectionsByKey: Map<"q,r", sectionRecord>,
  sectionAssetsByKey: Map<"q,r", sectionAsset>,
  nodesBySectionKey: Map<"q,r", MapNode[]>,
  allNodesByCoordKey: Map<"xindex,yindex", MapNode>,
  allNodes: MapNode[]
}
```

## Section Asset Shape

```js
{
  key: "q,r",
  coord: { q, r },
  walls: [...wallRecord],       // WallSectionUnit JSON records
  objects: [...objectRecord],   // static objects (trees, flowers, etc.)
  animals: [...animalRecord],
  groundTiles: { "x,y": textureId },  // per-tile ground texture override
  tileCoordKeys: ["x,y", ...],  // which offset coords belong to this section
  clearanceByTile: { "x,y": number },  // movement clearance per tile
  floors: [...floorRecord],     // multi-floor fragments
  transitions: [...transitionRecord],
  // dirty flags:
  _prototypeBlockedEdgesDirty,
  _prototypeClearanceDirty,
  _level0RoadSurfaceDirtyPending,
  _prototypeWallsSplitCheckedSig  // signature to avoid redundant splits
}
```

## Sparse Nodes

Sections don't use a dense 2D array of nodes. Instead, each section owns a list of `MapNode` objects keyed by tile coord ("xindex,yindex"). Nodes are created lazily when a section activates.

`node._prototypeSectionKey` = "q,r" string indicating which section owns that node.

## Wall Splitting at Seams

`wallSectionSplitting.js` runs when sections load. Walls that span across a section boundary are detected and split into two records — one owned by each section. A wall is "along seam" if it follows the boundary rather than crossing it; those are left intact. Split pieces get `_splitGroupId` to prevent re-splitting.

## Section Files on Disk

Sections saved as: `public/assets/saves/{slot}/{q},{r}.json`
Plus: `manifest.json`, `triggers.json`

The save bundle (`/api/sectionworld?slot=maps`) stores each section as its own file (one per `q,r` pair).
