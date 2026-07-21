# Wizard of Flatland Movement Port Notes

`public/assets/javascript/pathfinding/orcaSolver.js` is only the local avoidance kernel.
It computes collision-avoiding circle-agent velocities from current agent positions,
current velocities, preferred velocities, radii, max speeds, and ORCA timing options.

It does not own the full movement pattern:

- A* path requests and waypoint selection live outside ORCA.
- Attack slot selection, lunging, recovery, holding, vacating, and milling phase transitions live in the game solver worker.
- Wall/node-layer construction and wall contact resolution live outside ORCA.
- The browser-side game loop, path worker coordination, input, projectile collision, rendering, and diagnostics live in the game main file.

Files to keep together for a later main-game port:

- `public/assets/javascript/pathfinding/orcaSolver.js`
  Shared local avoidance solver.
- `public/wizard-of-flatland/solverWorker.js`
  Packed NPC movement state machine: seeking, milling, holding, attacking, recovering, vacating, wall detours, contact projection, and ORCA integration.
- `public/assets/javascript/pathfinding/pathfindingWorker.js`
  Existing worker that answers path requests from a snapshot.
- `public/assets/javascript/pathfinding/PathfindingSnapshot.js`
  Existing main-game snapshot builder for map pathfinding.
- `public/assets/javascript/pathfinding/PathfindingService.js`
  Existing main-game service wrapper around the pathfinding worker.
- `public/wizard-of-flatland/main.js`
  Reference integration for request cadence, waypoint assignment, worker messages, path result handling, packed agent state, collision pass, and debug controls.
- `public/wizard-of-flatland/mazeSectionWorker.js`
  Lab-only procedural maze/world fixture generation. Useful as a reference for node-layer construction, but not necessarily a main-game dependency.
- `public/wizard-of-flatland/orcaSolver.test.js`
  ORCA regression tests.

Porting boundary:

Use ORCA as a helper inside a higher-level NPC movement solver, not as the movement solver itself. The reusable unit to port is the combination of `solverWorker.js` plus the existing pathfinding worker/service/snapshot flow, with `main.js` used as the integration map for how path goals and phases are fed into the solver.
