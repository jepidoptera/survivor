---
name: Architecture: Spells & Scripting
description: Spell base class, magic cost system, all spell types, scripting runtime, TriggerArea
type: project
---

# Spells & Scripting

## Spell Base Class (spells/Spell.js)

All spells extend `Spell`. Key static methods:
- `Spell.ignoresMagicCosts(wizardRef)` — true in god mode
- `Spell.canAffordMagicCost(cost, wizardRef)` — check magic points
- `Spell.spendMagicCost(cost, wizardRef)` — deduct magic, returns false if insufficient
- `Spell.indicateInsufficientMagic()` — flashes the magic bar UI
- `Spell.isGroundLayerTarget(target)` — true for roads, triggerAreas, ground-rotation objects
- `Spell.getLayerBaseZForLevel(level)` — `level * 3` world units
- `Spell.getTargetWorldBaseZ(target)` — resolves Z from wall.bottomZ, floor, etc.
- `Spell.supportsObjectTargeting = false` (override to `true` for object-targeted spells)

Magic cost is NOT deducted in god mode. Check `Spell.canAffordMagicCost` before casting.

## Spell Types

| File | Purpose |
|------|---------|
| `Arrow.js` | Projectile arrow |
| `Fireball.js` | Fire projectile |
| `Iceball.js` | Ice/freeze projectile |
| `Lightning.js` | Lightning bolt |
| `Grenade.js` | Grenade with splash |
| `Rock.js` | Rock projectile |
| `Spikes.js` | Ground spike placement |
| `Teleport.js` | Player teleportation |
| `editor/TreeGrow.js` | Grow/place trees |
| `editor/BuildRoad.js` | Paint road tiles |
| `editor/PlaceObject.js` | Place/edit world objects (editor tool) |
| `Telekinesis.js` | Move existing objects |
| `Vanish.js` | Delete/remove objects |
| `editor/SpawnAnimal.js` | Spawn animals |
| `AttackSquirrel.js` | Attack spell variant |
| `editor/TriggerArea.js` | Place/edit trigger areas |
| `editor/NodeInspector.js` | Debug: inspect map nodes |
| `editor/EditScript.js` | Open script editor on object |
| `scripting.js` | Scripting runtime (not a spell) |

## PlaceObject.js (Editor Spell)

The primary world-editing tool. Key functions:
- `resolvePlaceObjectLayerInfo(wizardRef)` — resolves `{layer, baseZ}` from wizard's current layer state
- `resolvePlaceObjectWorldPointOnLayer(wizardRef, fallbackX, fallbackY, options)` — converts screen mouse pos to world coords at current layer Z
- `resolveEditorNodeOnLayer(mapRef, worldX, worldY, layer, options)` — get map node at target layer (calls `mapRef.getFloorNodeAtLayer`)
- Respects world wrapping via `mapRef.wrapWorldX/Y` and `mapRef.shortestDeltaX/Y`

## TriggerArea

`TriggerAreaSpell` extends `Spell`, `supportsObjectTargeting = true`.
`isValidObjectTarget` checks `target.type === "triggerArea" || target.isTriggerArea === true`.

TriggerAreas fire scripting events when the player enters/exits/touches.

## Scripting Runtime (spells/scripting.js)

IIFE that attaches to `global`. Event-driven scripting system:

**Event names:** `playerEnters`, `playerExits`, `playerTouches`/`playerTouch`, `playerUntouches`/`playerLeaves`
**Init key:** `__init` — runs once when object is loaded.

**Script editor:** DOM panel with id `scriptEditorPanel`, textarea `scriptEditorTextarea`, autocomplete `scriptEditorCompletionPanel`.
Default template shows `playerExits { mazeMode=true }` / `playerEnters { mazeMode=false }`.

**Command registry examples:**
- `wizard.inventory.set("spellCredits", 3)` — set inventory quantity
- `wizard.inventory.add("gold", 10)` — add to inventory

**Named objects:** `namedObjectsByName = Map<string, object>`. Used for script-to-object lookups.

**Assignment handlers:** `assignmentHandlersByPath` — handles `mazeMode=true` style assignment commands.

**Script brightness filter key:** `__scriptBrightnessFilter` — property key on objects that have a script-driven brightness.
