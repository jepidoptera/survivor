# Worker-Backed Streaming Unit Plan

## Goal

Move correctness-critical, CPU-heavy streaming preparation off the main thread while leaving the current section loading path intact as the baseline. The new system should compile section-like data in a Web Worker, transfer compact results back to the main thread, and apply live runtime changes through the existing small-slice bubble shift queue.

The system should be designed around **streaming units**, not only map sections. A normal map section is one streaming unit. An imported building, polygon road package, or large trigger package can also be a streaming unit.

```text
section:-3,0
building:house-a
road-surface:main-road-17
trigger-region:castle-yard
```

This lets worker compilation support the upcoming building import work without needing a second streaming architecture later.

## Non-Goals

- Do not replace the existing bubble shift path in the first implementation.
- Do not construct renderer objects, `StaticObject`, `WallSectionUnit`, live nodes, global registries, or texture/render-cache state in the worker.
- Do not assume main-thread work can go to zero. Runtime commit must remain budgeted into small chunks.
- Do not add silent fallbacks for missing compiled data, stale cache state, invalid building imports, missing render textures, or failed geometry compilation.
- Do not commit lookahead units into the live scene just because they are precompiled.

## Current Performance Shape

Recent real-world bubble shift data showed:

```text
frame.budgetMs:     2
frame.maxSliceMs:   11.1
frame.shiftFrameMs: 84.7
frame.workMs:       315.2
frame.totalMs:      900
```

Hotspots included:

```text
objects.roadRefresh: 19.3ms
floorObjectIndex:    15.3ms
objects.load:        14.6ms
objects.staticLoad:  13.2ms
objects.unload:      11.4ms
walls.addNodes:       9.6ms
layout.deactivate:    6.6ms
layout.activate:      5.6ms
```

The worker should first target work that is pure data transformation or planning:

- floor object spatial index build
- desired active object/wall/animal/powerup diff planning
- road refresh planning and, later, polygon road geometry compilation
- wall blocked-edge / joinery planning where it can be expressed as data
- building import conversion, validation, footprint overlap, ID remapping, and stair data preparation

Main-thread work will remain for live object creation, renderer mutation, node registration, GPU texture upload, cache invalidation, and activation.

## Core Design

Use a two-stage pipeline:

```text
worker compile:
  input snapshots -> compiled streaming unit plans

main-thread commit:
  compiled plans -> live runtime objects, nodes, render/cache state
```

The worker output is a **plan**, not a runtime object graph.

```ts
type StreamingUnitPlan = {
  unitKey: string;
  kind: "section" | "building" | "road-surface" | "trigger-region";
  ownerKey: string;
  inputVersion: StreamingInputVersion;
  requiredResources: string[];
  floors?: CompiledFloorPacket[];
  walls?: WallRecordPlan[];
  objects?: ObjectRecordPlan[];
  animals?: AnimalRecordPlan[];
  powerups?: PowerupRecordPlan[];
  roofs?: RoofRecordPlan[];
  stairs?: StairRecordPlan[];
  indexes?: TransferableIndexPacket[];
  diagnostics?: StreamingDiagnostic[];
};
```

Transfer large numeric data through transferable `ArrayBuffer`s:

```text
Float32Array.buffer
Uint32Array.buffer
Uint16Array.buffer
Uint8Array.buffer
ImageBitmap, where image decode is useful and safe
```

After transfer, the worker must treat the transferred buffers as detached and unusable.

## Streaming Unit States

Each unit should move through explicit states:

```text
unseen
requested
compiling
compiled
commitQueued
active
retiring
failed
stale
```

State changes should be explicit and inspectable for debug/perf tooling. A unit may be compiled but not committed. A compiled lookahead unit should only become live when it enters the desired active set.

## Lookahead Preloading

The worker should run ahead of the active bubble.

```text
priority 0: active or pending-active units missing a valid compiled plan
priority 1: likely next-center units based on player velocity and heading
priority 2: neighboring-center lookahead ring
priority 3: buildings and other virtual units overlapped by lookahead sections
```

Lookahead should compile streaming units, not whole future bubbles. Bubbles overlap heavily, and virtual units such as buildings may be desired by many possible centers. Unit-level compilation avoids repeating work.

Compiled lookahead plans should be cached with bounded memory and evicted by distance, priority, age, and version staleness.

## Versioning And Staleness

A compiled plan is reusable only when its inputs still match. Version records should include:

```ts
type StreamingInputVersion = {
  sectionAssetVersion?: number | string;
  buildingPlacementVersion?: number | string;
  buildingSaveVersion?: number | string;
  textureManifestVersion?: number | string;
  compilerVersion: number | string;
  rulesVersion: number | string;
};
```

If a compiled plan is stale, discard it explicitly and recompile. Do not silently apply stale data.

Important invalidation sources:

- edited section asset
- captured dirty runtime object or wall
- edited building save
- changed building placement transform
- changed texture/resource manifest
- changed road polygon compiler
- changed movement/blocking rules

## Main-Thread Commit Queue

The existing bubble shift queue remains the commit mechanism. Worker results should feed tasks into that queue:

```text
commit floors batch
commit sparse nodes batch
commit walls batch
commit blocked edges batch
commit objects batch
commit animals/powerups batch
commit roof records batch
commit stairs batch
commit indexes
mark render caches dirty
validate required resources
activate unit
```

The commit queue should keep its 1-2ms frame budget target. Any single commit task that can exceed the budget should be split further.

Worker compilation improves smoothness by reducing how much work enters the commit queue and by making the remaining work predictable.

## Building Imports As Virtual Units

Imported buildings should plug into this system as virtual streaming units:

```text
unitKey: building:<placementId>
ownerKey: building:<placementId>
```

The worker can handle:

- validate `schema === "survivor-building-v1"`
- normalize legacy editor shape
- apply placement transform
- prefix and remap all IDs
- compute transformed floor polygons
- compute footprint polygons
- compute overlapped section keys
- convert wall, mounted-object, roof, floor, and stair records into runtime-ready plans
- precompute stair traversal data
- build building-local spatial indexes

The main thread must handle:

- register floor fragments and nodes
- create live walls
- create mounted objects
- create roofs
- register stairs
- update or require exterior composite render textures
- mutate render caches and global runtime registries

Building activation must be atomic. A building should not partially affect movement or rendering before required runtime pieces are ready.

Required hard failures include:

```text
missing building placement
missing referenced floor
missing referenced wall
invalid floor polygon
invalid compiled stair treads
missing remapped mounted wall id
missing building composite render texture
stale compiled building plan
```

## Polygon Roads

If roads move from node-based objects to polygon-based paths, they become strong worker compile candidates.

Road input:

```ts
type RoadPath = {
  id: string;
  points: Float32Array;
  width: number;
  material: string;
};
```

Worker output:

```ts
type CompiledRoadPacket = {
  vertices: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  bounds: Float32Array;
  collisionPolygons: Float32Array;
  polygonOffsets: Uint32Array;
};
```

The worker can compile offsets, joins, caps, intersections, triangulation, bounds, and spatial lookup. The main thread still owns mesh upload, renderer object creation, and final collision/runtime registration.

This should eventually replace much of `objects.roadRefresh` with worker-side geometry compilation and small main-thread apply batches.

## Correctness Rules

- Worker plans are advisory until validated on the main thread.
- Activation must be explicit and atomic.
- Missing required compiled data is an error, not a reason to draw approximate visuals.
- Missing required render/cache resources are errors on paths that require them.
- Stale compiled plans must be rejected.
- A failed unit must expose a specific diagnostic with unit key, compiler phase, input version, and reason.
- Runtime dirty capture must happen before snapshotting inputs for worker compilation.

## Debug And Perf Instrumentation

Extend bubble shift logs to include worker state:

```text
worker:
  requested
  compiled
  reusedCompiled
  staleDiscarded
  failed
  compileMs
  transferMs
  waitMs
  bytesTransferred

commit:
  workerPlannedUnits
  committedUnits
  commitMs
  maxCommitTaskMs
```

Keep existing hotspot summaries for main-thread work. The goal is to see both:

- how much work moved off the main thread
- whether the remaining main-thread commit slices stay within budget

## Migration Plan

### Phase 1: Worker Planner Skeleton

- Add a worker module for streaming unit planning.
- Add a main-thread `StreamingUnitManager`.
- Support request/cancel/receive lifecycle.
- Compile no-op plans first to prove messaging, versioning, and diagnostics.
- Keep the existing bubble shift path as the only commit path.

### Phase 2: Floor Object Index

- Move floor object index scan/sort planning into the worker.
- Transfer row/index buffers back to the main thread.
- Commit by swapping a validated index object.
- Compare output against the current main-thread build in a debug mode.

### Phase 3: Diff Planning

- Move desired record collection and active-vs-desired diff planning for objects/walls/animals/powerups into the worker where safe.
- Main thread still performs load/unload tasks through existing runtime APIs.
- Add debug comparison against legacy planner results.

### Phase 4: Lookahead Cache

- Predict next likely section centers.
- Resolve lookahead streaming units.
- Compile and cache plans before they are desired-active.
- Reuse valid compiled plans during actual bubble shifts.

### Phase 5: Building Virtual Units

- Add building placement/index snapshots as worker inputs.
- Compile building import plans in the worker.
- Commit building runtime pieces in the main-thread queue.
- Enforce atomic activation and hard diagnostics.

### Phase 6: Polygon Road Compilation

- Introduce polygon road authoring/runtime packets.
- Compile road geometry in the worker.
- Replace node-heavy road refresh with compiled road apply tasks.

## Open Questions

- What is the first stable version source for section assets: content hash, incrementing edit version, or save timestamp?
- Should worker plans use plain records first, then typed arrays only for large indexes/geometry?
- How much lookahead memory is acceptable on low-end machines?
- Should compiled unit cache survive slot reloads, or remain session-only at first?
- Which building exterior composite work can be prepared before activation, and which must wait for live renderer state?
- How should runtime dirty captures cancel or invalidate in-flight worker jobs?

## Recommended First Step

Start with a worker-backed `floorObjectIndex` plan because it is data-oriented, already chunked in the existing bubble sync code, and has clear output equivalence. Build the streaming unit manager and versioning around that narrow use case, then expand into diff planning and lookahead caching.

