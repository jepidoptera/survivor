---
name: Architecture: Map & Hex System
description: Hexagonal grid geometry, world coordinate system, MapNode structure, section geometry math
type: project
---

# Map & Hex Grid System

**Source:** `public/assets/javascript/Map.js`, `public/assets/javascript/map/sectionGeometry.js`

## Coordinate Systems

Three coordinate systems in use simultaneously:

1. **Even-Q offset** (`{x, y}` integers) — the base map grid indices. `xindex`/`yindex` on nodes. `x` is column (q), `y` is row.
2. **World coordinates** (`{x, y}` floats) — `hexWidth = 0.866 (√3/2)`, `hexHeight = 1.0`. Conversion: `world.x = xindex * 0.866`, `world.y = yindex + (xindex % 2 === 0 ? 0.5 : 0)`.
3. **Axial coordinates** (`{q, r}`) — used for section layout. Converts to/from even-Q offset via `evenQOffsetToAxial`/`axialToEvenQOffset`.

**Key hex geometry constants:**
- Column step: `0.866` (√3/2)
- Row step: `1.0`
- Odd columns are shifted down by `0.5`

## Helper Functions (sectionGeometry.js)

```js
evenQOffsetToAxial(x, y)     // offset → axial
axialToEvenQOffset(coord)    // axial → offset
offsetToWorld(offsetCoord)   // offset → world {x, y}
estimateOffsetCoordFromWorld(worldX, worldY)  // world → nearest offset
makeSectionKey(coord)        // axial coord → "q,r" string
axialDistance(a, b)          // hex distance in axial
getSectionBasisVectors(radius)  // q/r axis vectors for section tiling
computeSectionCenterAxial(sectionCoord, basis, anchorCenter)
```

## SECTION_DIRECTIONS (6 axial directions)
```js
[{q:1,r:0}, {q:1,r:-1}, {q:0,r:-1}, {q:-1,r:0}, {q:-1,r:1}, {q:0,r:1}]
```

## Map.js Contents

`Map.js` is large (>25k tokens). It contains:
- 2D polygon math: `pointInPolygon2D`, `segmentsIntersect2D`, `polygonsOverlap2D`, `distanceToSegment2D`
- Ground texture blending: `buildBlendedGroundTextureFromBase` — creates hex-masked, feathered canvas textures
- Map class/functions (full map, nodes array, world-to-node lookup, wrapping logic `wrapWorldX`/`wrapWorldY`, `shortestDeltaX`/`shortestDeltaY`)
- Node neighbor tables

## MapNode Shape

```js
{
  xindex, yindex,      // grid indices
  x, y,                // world coordinates
  neighbors,           // array indexed by direction (12 directions: 0-11)
  clearance,           // Infinity = open; finite = blocked
  groundTextureId,     // int index into map.groundTextures
  _prototypeSectionKey, // "q,r" string — which section owns this node
  surfaceId,           // logical traversal surface (multi-floor)
  fragmentId,          // floor fragment id (multi-floor)
  baseZ,               // actual standing height
  traversalLayer,      // integer tier (0=ground, 1=upper, -1=cave)
  level,               // same as traversalLayer for now
}
```

## Pathfinding Node Key Format
Node keys used by pathfinding: `"xindex,yindex"` (or extended with surfaceId/fragmentId for multi-floor).

## World Wrapping
Map may optionally wrap. `map.shortestDeltaX(from, to)` and `map.shortestDeltaY(from, to)` return the shortest signed delta respecting wrap. Always use these instead of raw subtraction when wrapping might be on.
