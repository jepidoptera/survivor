---
name: Project Overview
description: What Survivor is, tech stack, server setup, git repo, npm scripts
type: project
---

# Survivor — Project Overview

**Why:** "A spin-off from Mokemon Trail." A browser-based top-down action/RPG with a large open world.

## Stack

- **Backend:** Node.js + Express (`server.js`), port 8080 (env `PORT`). EJS templates. `body-parser`, `dotenv`, `lz-string`, `polygon-clipping`, `earcut`.
- **Frontend:** Vanilla JS (ES6 classes, IIFEs), PixiJS (WebGL renderer), jQuery for UI.
- **Tests:** Node built-in test runner (`node --test tests/*.test.js`). Uses `vm` module to load game code in isolation without a browser.

## Entry Points

- `server.js` — Express app, also exports helpers for tests.
- `public/` — All client-side assets served statically.
- Main game view: `sectionworld` (EJS template rendered at `/`).
- `http://localhost:8080/` → renders sectionworld view.

## npm Scripts

```
npm start          → node server.js
npm test           → node --test tests/*.test.js
npm run slice:realmap → node scripts/slice-real-map.js
```

## Git Repo

GitHub: `jepidoptera/The-Most-Badass-Project-Evah` (main branch: `master`, active branch: `development`)

## Recently Modified Files (as of 2026-05-07)

- `public/assets/javascript/Map.js`
- `public/assets/javascript/gameobjects/staticObjects.js`
- `public/assets/javascript/gameobjects/wallSectionUnit.js`
- `public/assets/javascript/rendering/Rendering.js`
- `public/assets/javascript/spells/PlaceObject.js`
- `tests/movement.traversal.test.js`
- `tests/rendering.level0BakeCache.test.js`
