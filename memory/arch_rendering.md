---
name: Architecture: Rendering
description: PIXI.js layer stack, custom depth shaders, camera interpolation, baked level-0 surface, LOS shadow system
type: project
---

# Rendering System

**Sources:** `public/assets/javascript/rendering/Rendering.js` (large IIFE), `rendering/Camera.js`, `rendering/Layers.js`, `rendering/RenderRuntime.js`, `rendering/ScenePicker.js`, `rendering/mazeMode.js`

## PIXI Layer Stack (RenderingLayers)

Layers added to root in order (bottom → top):
1. `ground` — hex tile ground textures (sortableChildren=false)
2. `roadsFloor` — road surface tiles
3. `groundObjects` — flat objects on ground
4. `losShadow` — LOS shadow overlay
5. `depthObjects` — 3D depth-sorted objects
6. `characters` — characters/sprites (sortableChildren=true, sorted by zIndex)
7. `objects3d` — 3D objects with depth buffer
8. `entities` — entity sprites
9. `ui` — HUD overlay
10. `scriptMessages` — scripted text messages

## Depth Metric & Shaders

All custom WebGL shaders use this depth metric:
```
depthMetric = camDy + camDz
```
Where `camDy = worldY - cameraY` and `camDz = worldZ - cameraZ`.

Normalized depth: `nd = clamp((farMetric - depthMetric) / span, 0, 1)`
- Near metric: `-128`
- Far metric: `256`

This gives painter's-algorithm depth for walls, roofs, and wizard shield. Sprites use PIXI's zIndex.

## Wall Shader (WallSectionUnit)

Custom vertex+fragment shader in `wallSectionUnit.js`:
- Attributes: `aWorldPosition` (vec3), `aUvs`, `aColor`, `aTextureMix`
- Uniforms: camera, viewscale, xyratio, depth range, brightness, tint, alphaCutoff, clipMinZ
- Fragment: adjustable saturation + brightness curve, clips fragments below `uClipMinZ` (for multi-floor cutaway)

## Roof Shader (Roof)

Custom depth shader supporting world-wrap:
- Attributes: `aVertexPosition` (screen-relative), `aDepthWorld` (world-relative), `aUvs`
- Handles world wrapping via `shortestDelta` in GLSL using `uWrapEnabled`, `uWorldSize`, `uWrapAnchorWorld`

## Floor/Ground Shaders (Rendering.js)

Two shaders:
- `FLOOR_VISUAL_DEPTH_VS` — for level-0 ground texture tiles (position is world XY, uses `uBaseZ`)
- `LOS_SHADOW_DEPTH_VS` — for LOS shadow polygons

## Level-0 Baked Surface

The ground is rendered as baked texture chunks rather than per-tile sprites:
- `FLOOR_LEVEL0_BAKED_SURFACE_ENABLED = true`
- `FLOOR_LEVEL0_FORCE_BAKED_SURFACE = true`
- Chunk size: 1024px texture, 32px/world-unit
- Cache limit: 96 chunks
- Dirty rects tracked for partial rebakes
- Chunk builds throttled: 1 per frame (`FLOOR_LEVEL0_CHUNK_BUILDS_PER_FRAME`)

## Camera (RenderingCamera)

`Camera.js` handles interpolated camera position across frames:
- Interpolates between `prevX/prevY` → `x/y` using `renderAlpha` (0→1 sub-frame alpha)
- Respects world wrapping via `shortestDeltaX`/`shortestDeltaY`
- Falls back to following wizard position if no explicit camera

Key method: `camera.update({ camera, wizard, viewport, viewscale, xyratio, map, renderAlpha })`

## RenderRuntime

`RenderRuntime.js` is the per-frame render driver. Key functions:
- `worldToScreen(item)` — converts world {x,y,z} + renderAlpha interpolation to screen {x,y}
- `worldToNodeCanonical(worldX, worldY)` — world → nearest map node
- `getViewportNodeCorners()` — top-left and bottom-right visible map nodes
- `normalizeLegacyAssetPath(path)` — fixes old `.jpg` paths for flowers/windows → `.png`

## LOS System (los.js)

Line-of-sight computed in 3600 angular bins (1 per 0.1°):
- Shadow uses PIXI Graphics polygons in the `losShadow` layer
- Settings in `LOSVisualSettings`: `shadowEnabled`, `shadowOpacity=0.6`, `shadowColor=0x222222`, `forwardFovDegrees=360`
- Shadow blur: strength 12
- Maze mode: alternate reveal behavior (700ms skip on activation)
- LOS throttled at 33ms intervals

## Screen Projection Formula

```js
screenX = (worldX - cameraX) * viewscale
screenY = ((worldY - cameraY) - (worldZ - cameraZ)) * viewscale * xyratio
```
`xyratio ≈ 0.66` compresses Y for isometric look. Z lifts objects upward on screen.

## Wizard Shield (Wizard.js)

Custom dodecahedron wireframe rendered via raw WebGL (not PIXI):
- Vertex shader: `WIZARD_SHIELD_WIREFRAME_VS` — handles world wrap, depth, screen jitter
- Fragment: solid color `uColor`
- Depth range: near=-128, far=256 (same as floor)
- `uZOffset` uniform for z-fighting avoidance

## Constants in Rendering.js

```js
GROUND_TILE_CACHE_LIMIT = 6000
GROUND_TILE_POOL_LIMIT = 1024
LOS_NEAR_REVEAL_RADIUS = 1.0
WIZARD_HAT_LIFT_UNITS = 0.15
WIZARD_BODY_LOWER_UNITS = 0.25
FLOOR_VISUAL_FILL = 0x746b4d
FLOOR_BELOW_CURRENT_DARKNESS_MULTIPLIER = 0.8
```
