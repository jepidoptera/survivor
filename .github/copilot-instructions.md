# Survivor: AI Agent Guide

## Big picture
- Node/Express server in [server.js](server.js) serves EJS and static assets; the main route is `GET /` → [views/hunt.ejs](views/hunt.ejs).
- Frontend is vanilla JS + Pixi.js + jQuery; no module system—scripts are loaded in order by [views/hunt.ejs](views/hunt.ejs) and rely on globals.
- Game loop + state live in [public/assets/javascript/runaround.js](public/assets/javascript/runaround.js): characters, projectiles, map/viewport, day-night cycle.

## Key files and responsibilities
- [public/assets/javascript/common.js](public/assets/javascript/common.js): `Player` model, save/load via AJAX, `msgBox()` modal system, global state (`player`, `paused`).
- [public/assets/javascript/components.js](public/assets/javascript/components.js): jQuery UI widgets like `mokePortrait()` and `numberInput()`.
- [public/assets/javascript/pixitest.js](public/assets/javascript/pixitest.js): Pixi app setup + sprite sheet loading.
- [public/assets/javascript/runaround.js](public/assets/javascript/runaround.js): core classes (`Character` → `Hunter`/`Animal`), projectiles (`Mokeball`/`Grenade`/`Rock`), `genMap()`, `drawCanvas()`.

## Data flow & integration points
- Client saves: `POST /save` with JSON from `player.uploadJson()`; load: `GET /load/{playerName}/{authtoken}` (see [public/assets/javascript/common.js](public/assets/javascript/common.js)).
- Auth tokens are read from the URL query `?auth=...`; server-side auth helpers are present but not fully wired in [server.js](server.js).
- Pixi sprite sheets are JSON + PNG in [public/assets/spritesheet](public/assets/spritesheet), loaded by `onAssetsLoaded()` in [public/assets/javascript/pixitest.js](public/assets/javascript/pixitest.js).

## Gameplay-specific conventions
- Hex grid pathfinding and movement are frame-based; `travelFrames` controls step timing; camera follows `viewport` in [public/assets/javascript/runaround.js](public/assets/javascript/runaround.js).
- Spells/projectiles are `Projectile` subclasses; add new spells in `Wizard.cast()` and the `wizard.spells` UI list in [public/assets/javascript/runaround.js](public/assets/javascript/runaround.js).
- Globals are intentional (`player`, `hunter`, `animals`, `map`, `projectiles`, `viewport`)—avoid refactoring to modules unless asked.

## Styling and UI patterns
- CSS is in [public/assets/css](public/assets/css); components often use BEM-ish names (e.g., `.numberInput_*`).
- UI is built with jQuery DOM construction and `.append()` patterns (see [public/assets/javascript/components.js](public/assets/javascript/components.js)).

## Developer workflows
- Start server: `npm install` then `npm start` (serves on port from `.env`, default 8080).
- No test runner detected in repo; rely on manual in-browser testing via `/`.

## Known incomplete areas
- Firebase integration and auth token validation are stubbed/commented in [server.js](server.js).
