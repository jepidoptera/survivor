---
name: Architecture: Save System
description: Server-side save API, slots, file layout, section world persistence
type: project
---

# Save System

**Source:** `server.js`

## Two Save Domains

### 1. Player Save File (`/api/savefile`)

Stores a single JSON blob of player/game state.

- `GET /api/savefile?slot={name}` — load save; `?file={name}.json` to load a backup
- `POST /api/savefile?slot={name}` — save; auto-backs up the previous file first

**Slot resolution:**
- Empty/no slot → `public/assets/saves/savefile.json`
- Named slot (alphanumeric+`_-` only) → `public/assets/saves/{slot}.json`
- Backups go to `public/assets/saves/backups/{slot}_{timestamp}.json`

### 2. Section World (`/api/sectionworld`)

Stores the map world: one JSON file per section + manifest + triggers.

- `GET /api/sectionworld?slot={name}` — loads all sections; returns `{ ok, slot, manifest, triggers, sections[] }`
- `POST /api/sectionworld?slot={name}` — saves all sections; body: `{ sections[], manifest, triggers? }`

**Directory layout per slot:**
```
public/assets/saves/{slot}/
  manifest.json
  triggers.json
  {q},{r}.json    ← one file per section, keyed by axial coord
```

**Section file naming:** `buildSectionFileName(section)` → `"${q},${r}.json"` where q and r are truncated ints.

**Validation:** Each section record must have `coord.q` and `coord.r` as finite numbers.

**Active save slots:**
- `maps` — the live game world
- `testing` — test world copy
- (backups in `public/assets/saves/backups/section map/`)

## Parser Limits

```js
defaultJsonBodyLimit = '100mb'
sectionWorldJsonBodyLimit = '200mb'   // sectionworld can be large
```

## Slot Name Security

`normalizeSaveSlotName` strips all non-alphanumeric/`_-` characters and rejects the slot if any were present. This prevents path traversal.

## Other API Endpoints

- `GET /api/flooring` — lists image files in `/assets/images/flooring/`
- `GET /api/placeables` — lists image files for flowers, windows, doors, furniture, signs, roofs, walls

## filesystem.js (Client-side)

`filesystem.js` handles client-side save/load logic (not the server). Contains:
- `lazyRoadStore` / `lazyTreeStore` — lazy-loaded record caches for roads and trees
- `toRoadSaveRecord(data)` / `toTreeSaveRecord(data)` — normalize objects to JSON records
- `roadRecordKey(x, y)` — `"${roundedX},${roundedY}"` key for road deduplication
- `markMinimapStaticDirty()` — triggers minimap invalidation after save changes
- `normalizeLegacyAssetPath` used to fix old `.jpg` → `.png` asset paths
