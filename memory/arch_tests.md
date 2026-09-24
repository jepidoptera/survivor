---
name: Architecture: Tests
description: Test runner setup, vm-based game code loading, PIXI stubs, test file index
type: project
---

# Test System

**Runner:** Node built-in test runner (`node --test tests/*.test.js`)
**Command:** `npm test`

## Pattern: Loading Game Code in Tests

Game code is browser JS (not CommonJS). Tests use Node's `vm` module to run it in an isolated sandbox context:

```js
const vm = require("node:vm");
const context = {
  console, Math, Date, JSON, Map, Set, WeakMap, WeakSet,
  Array, Object, Number, String, Boolean, RegExp, Error,
  Infinity, NaN, parseInt, parseFloat, isFinite,
  performance: { now: () => 0 },
  PIXI: createPixiStub(),
  // ... other stubs
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: "Foo.js" });
```

PIXI is stubbed with minimal implementations of `Texture`, `Sprite`, `Rectangle`, `Container`, etc.

## Test Files

| Test File | What It Tests |
|-----------|--------------|
| `movement.traversal.test.js` | Character movement through floors/transitions |
| `rendering.level0BakeCache.test.js` | Level-0 ground bake: nodes expanded once per stable bubble |
| `pathfinding.floorTraversal.test.js` | Pathfinding across floor transitions |
| `persistence.roundtrip.test.js` | Save → load → verify equality for sections |
| `sectionWorld.test.js` | Section world loading/activation |
| `server.sectionworld.test.js` | Server API save/load round-trips |
| `wallSectionSplitting.test.js` | Wall splitting at section seams |
| `wallVisibility.test.js` | Wall cutaway/visibility |
| `placeObject.roof.prototype.test.js` | Roof placement via PlaceObject |
| `roofTextureUvs.test.js` | Roof UV coordinate computation |
| `scripting.doorTraversal.test.js` | Scripted door behavior |
| `wizard.doorBypass.test.js` | Wizard can bypass doors in god mode |
| `staticObject.flowerBurn.test.js` | Flower burns on fire contact |
| `spellTargetZ.test.js` | Spell Z-targeting |
| `character.scheduler.test.js` | Animal external scheduler |
| `debug.perfDefaults.test.js` | Debug performance default values |
| `filesystem.prototype.test.js` | filesystem.js helpers |
| `sectionedMovementDiscovery.test.js` | Movement discovery across sections |

## Rendering Test Trick

`rendering.level0BakeCache.test.js` patches `Rendering.js` source to expose `RenderingImpl` before the singleton closure:

```js
source.replace(
  "    let singleton = null;",
  "    global.__RenderingImpl = RenderingImpl;\n\n    let singleton = null;"
)
```

This allows instantiating multiple `RenderingImpl` instances in tests without the singleton blocking them.

## Key Test Assertions

Tests use `node:assert/strict`. Common patterns:
- `assert.strictEqual(actual, expected)`
- `assert.deepStrictEqual(actual, expected)`
- `assert.ok(condition)`
- `assert.throws(() => {...})`
