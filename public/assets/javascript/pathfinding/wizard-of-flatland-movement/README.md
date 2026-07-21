# Wizard of Flatland Movement Bundle

This folder is a copy bundle for porting the Wizard of Flatland NPC movement pattern
back into the main game. Treat it as a staging kit, not the canonical runtime source.

Canonical runtime files remain in:

- `public/wizard-of-flatland/`
- `public/assets/javascript/pathfinding/`
- `public/assets/javascript/wallGeometry.js`

Bundle contents:

- `orcaSolver.js`
  Local ORCA/circle-agent avoidance kernel. This is only one piece of movement.
- `npcMovementSolverWorker.js`
  Higher-level packed NPC movement solver: phase transitions, attack lunges,
  recovery, holding, vacating, milling, path-goal following, wall detours,
  collision/contact projection, and ORCA integration.
- `pathfindingWorker.js`
  A* path worker used by the reference integration.
- `PathfindingSnapshot.js`
  Main-game snapshot builder for pathfinding nodes, edges, and obstacle state.
- `PathfindingService.js`
  Main-game service wrapper for pathfinding worker lifecycle and path requests.
- `wallGeometry.js`
  Geometry dependency used by the movement solver and maze/path node generation.
- `wizardOfFlatlandMainReference.js`
  Browser-side reference integration: packed agent state, worker messaging,
  path request cadence, waypoint assignment, input, projectile collision,
  rendering hooks, and diagnostics.
- `mazeSectionWorker.reference.js`
  Lab fixture generator. Useful for understanding/prototyping node-layer
  construction, but probably not a direct main-game dependency.
- `orcaSolver.test.js`
  ORCA regression tests, adjusted to require this folder's local copy.

Local path adjustments:

- `npcMovementSolverWorker.js` imports `./wallGeometry.js` and `./orcaSolver.js`.
- `PathfindingService.js` defaults to `./pathfindingWorker.js`.
- `wizardOfFlatlandMainReference.js` points its worker constructors at local
  bundle copies.

Porting note:

Do not port `orcaSolver.js` alone and expect the whole behavior. The complete
pattern is the solver worker plus pathfinding worker/service/snapshot flow, with
the main reference file showing how goals, phases, and path waypoints are fed into
the solver.
