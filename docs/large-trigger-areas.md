# Large Trigger Areas

## Problem

Trigger areas currently behave like ordinary section-owned runtime objects.

That creates two failure cases for very large trigger areas:

- The player can still be inside a trigger after its owner section leaves the active bubble.
- The player can enter a trigger before the trigger's owner section has even loaded.

In the current architecture, trigger traversal depends on loaded runtime objects. That is fine for small, local triggers, but it breaks down once a trigger footprint becomes larger than the section or bubble model that owns it.

## Current Runtime Coupling

Today, trigger traversal is tied to materialized runtime objects:

- Movement gathers nearby script entries and appends loaded trigger runtime objects.
- Trigger enter and exit processing runs against those loaded entries.
- Prototype object sync only materializes runtime objects from active section records.
- Trigger persistence routes the saved object back into a single owner section.

That means trigger gameplay authority currently lives in the runtime object, not in persistent trigger definition data.

## Architectural Direction

Split trigger areas into two layers:

1. Trigger definition layer
2. Trigger runtime object layer

The trigger definition layer should be the gameplay authority.
The trigger runtime object layer should be optional and used for editing, selection, and rendering.

This change makes trigger traversal independent from section hydration.

## Recommended Model

### 1. Global Trigger Definition Registry

Maintain a lightweight trigger registry that exists independently of loaded runtime objects.

Each trigger definition should include:

- stable trigger id
- owner section key
- coverage section keys
- polygon points
- coarse bounds
- scripting name
- trigger scripts such as `playerEnters` and `playerExits`

Suggested shape:

```js
{
  id: 123,
  ownerSectionKey: "q10,r-2",
  coverageSectionKeys: ["q10,r-2", "q11,r-2", "q11,r-1"],
  scriptingName: "outerMazeGate",
  points: [{ x, y }, ...],
  bounds: { minX, minY, maxX, maxY },
  playerEnters: "...",
  playerExits: "...",
  objectType: "triggerArea"
}
```

### 2. Runtime Trigger Objects Become Optional

A full `TriggerArea` runtime object should only exist when needed for:

- editor interaction
- outline rendering
- selection and manipulation
- any script path that truly requires a full object instance

Trigger traversal should not depend on these objects being present.

### 3. Owner Section Is Not Coverage Authority

Keep `ownerSectionKey` as the canonical persistence home for the trigger.

Do not use it as the source of truth for whether the trigger is reachable by gameplay.

Use `coverageSectionKeys` for coarse spatial discovery.

## Coverage Index

Each trigger should be indexed under every section its polygon footprint intersects.

Minimum viable approach:

- compute polygon bounds
- sample polygon vertices
- sample polygon edges or bounding box coverage
- collect all intersected section keys
- allow over-inclusion if needed

False positives are acceptable because exact polygon hit testing still happens later.
False negatives are the real problem.

## Traversal Pipeline

Trigger enter and exit detection should work from the definition registry, not from loaded section objects.

Recommended flow:

1. Movement computes the player's path for the frame.
2. Determine which section keys the path crosses or touches.
3. Query the trigger registry for trigger ids indexed under those section keys.
4. Use each trigger definition's polygon for exact hit testing.
5. Fire enter or exit events using the trigger's stable id.

This allows trigger detection even when:

- the owner section is unloaded
- the owner section has not been hydrated yet
- the trigger is larger than the active bubble

## Script Execution Policy

There are two useful classes of trigger scripts.

### Metadata-safe scripts

These can run directly from trigger definition data without loading the owner section.

Examples:

- toggle maze mode
- set quest state
- show a message
- teleport the player
- prefetch nearby sections

### Hydration-dependent scripts

These need more than just trigger definition data.

Examples:

- manipulating nearby named local objects
- relying on a fully materialized `this`
- mutating objects in an unloaded section

For these, there are two valid approaches:

1. Hydrate the needed section before firing the script.
2. Materialize a temporary trigger runtime shell just for script execution.

Recommended first step:

- detect overlap from trigger definitions
- create a temporary script target only if needed
- avoid forcing full section load unless the script actually depends on local object graph

## Recommended State Additions

Suggested prototype state:

- `map._prototypeTriggerState.triggerDefsById`
- `map._prototypeTriggerState.triggerIdsBySectionKey`
- `map._prototypeTriggerState.lastBuildVersion`

Suggested map APIs:

- `map.rebuildPrototypeTriggerRegistry(sectionKeys = null)`
- `map.getPrototypeTriggerDefById(id)`
- `map.getPrototypeTriggerDefsForSectionKeys(sectionKeys)`
- `map.materializePrototypeTriggerRuntime(defOrId, options = {})`
- `map.invalidatePrototypeTriggerRegistryForSection(sectionKey)`

## Persistence Rules

The saved trigger record should keep a stable id.

Recommended responsibilities:

- `ownerSectionKey` remains the canonical persistence home
- `coverageSectionKeys` are derived from the full polygon footprint
- trigger save or movement invalidates and rebuilds the coverage index

Avoid making the owner section jump around automatically every time the polygon crosses a boundary.
Persistence home and gameplay footprint are separate concerns.

## Editor and Rendering Behavior

Rendering does not need to change ownership of gameplay authority.

The editor can continue to work with `TriggerArea` runtime objects for:

- preview outlines
- vertex editing
- dragging
- detached camera work while placing or editing

If a selected trigger leaves the active bubble, the editor can either:

- keep an ephemeral editor object alive, or
- edit the trigger definition directly and materialize a runtime shell only when needed

That is a tooling problem, not a gameplay-authority problem.

## Incremental Implementation Plan

1. Add stable trigger ids to saved trigger records.
2. Add a prototype trigger registry beside the current runtime object sync system.
3. Compute `coverageSectionKeys` from trigger polygon footprints.
4. Change trigger traversal to query the trigger registry instead of loaded runtime objects.
5. Allow traversal to use definition-backed hitboxes.
6. Materialize temporary runtime targets only when script execution requires one.
7. Improve editor behavior for off-bubble selected triggers.

This sequence fixes gameplay first and tooling second.

## Tests To Add First

1. Enter before owner load.

   A trigger owned by a distant section covers the player's current section.
   Expected: `playerEnters` fires even though the owner section runtime object was never materialized.

2. Exit after owner unload.

   The player enters the trigger, the bubble shifts, the owner section unloads, and the player exits later.
   Expected: `playerExits` fires exactly once.

3. Coverage index correctness.

   A multi-section trigger is returned when querying any covered section key.

4. No duplicate firing.

   A trigger spanning many sections still fires one enter and one exit during a continuous crossing.

5. Script target continuity.

   If trigger enter uses `this`, it still works when the owner section is not currently materialized.

## Pragmatic Shortcut

If a smaller first implementation is needed, make this trigger-definition registry only for trigger areas.

Do not generalize immediately to all objects.

That keeps the first change focused:

- no broad global object-system redesign
- no behavior changes for doors, animals, or powerups
- only trigger traversal becomes definition-driven

## Guiding Principle

A large trigger area is closer to world navigation metadata than to an ordinary loaded placed object.

Treat the trigger definition as the durable gameplay authority.
Treat the runtime object as an optional interface for editing, rendering, and script execution support.