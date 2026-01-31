# Survivor Codebase Guide

## Project Overview
"Survivor" is a web-based hunting game spin-off from "Mokemon Trail" where players hunt animals and capture creatures on a procedurally-generated trail. The game features a real-time hunting phase with hexagonal tile-based movement, weapons system, and day/night cycles.

**Tech Stack**: Node.js/Express backend, vanilla JavaScript frontend with Pixi.js for sprite rendering and jQuery for DOM manipulation.

## Architecture Overview

### Backend (Node.js/Express)
- **server.js**: Minimal Express server that serves static files and EJS templates
  - Single route: `GET /` renders `hunt.ejs` view
  - Incomplete auth system: `generateToken()` and `validateAuth()` functions exist but not fully integrated
  - Planned features: Firebase integration (commented out), player/auth token management
  - Environment config via `.env` file (PORT, API keys)

### Frontend Structure

#### Core Game Loop (runaround.js - 1218 lines)
Main game state and rendering engine using Pixi.js:
- **Game Objects**: Character hierarchy (`Character` → `Hunter`/`Animal` → `Mokemon`)
  - `Character`: Base class with movement pathfinding, uses grid-based map nodes
  - `Hunter`: Player character with weapon throwing mechanics (3 weapon types: mokeballs, grenades, rocks)
  - `Animal`/`Mokemon`: Enemies with animation frames and AI destination selection
- **Projectiles**: `Projectile` → `Mokeball`/`Grenade`/`Rock` with physics (gravity, bounces, range)
- **Pixi.js Rendering**: 
  - Layered containers (landLayer, objectLayer, characterLayer, projectileLayer)
  - TilingSprite for seamless background tiling
  - Sprite positioning and alpha blending for occlusion
- **Viewport System**: Follows hunter, maintains bounds within map (400x400 hex grid)
- **Map Generation**: `genMap()` creates hexagonal tile map with Pixi textures and pathfinding nodes

#### UI & Components
- **common.js**: Shared utilities
  - `Player` class: Tracks stats (food, money, mokeballs, grenades, posse), loads/saves via AJAX to server
  - `msgBox()`: Modal dialog system with buttons and callbacks
  - Game state: `paused`, `msgBoxActive`, `player` (global singleton)
- **components.js**: jQuery UI helpers
  - `mokePortrait()`: Renders interactive team member cards with health bars
  - `numberInput()`: Reusable number spinner component with hold-to-repeat behavior
- **pixitest.js**: Sprite rendering setup for Pixi.js with sprite sheet loading

#### View Layer (hunt.ejs)
Minimal HTML template that loads scripts in order:
1. jQuery (dependency)
2. Pixi.js (sprite renderer)
3. pixitest.js (app initialization)
4. CSS stylesheets

## Critical Game Mechanics

### Movement & Pathfinding
- **Hexagonal Grid**: Map uses hex tiles (0.866 aspect ratio) with A* pathfinding via `findPath()`
- **Characters move frame-by-frame** within `travelFrames` duration between nodes
- `viewport` object tracks camera position, follows hunter while staying in bounds

### Weapon System
- Hunter has 3 weapons (selected via F/G keys or menu): mokeballs (limited), grenades (limited), rocks (infinite)
- `throw()` method calculates projectile trajectory with physics simulation
- Projectiles bounce twice with friction, each weapon has different throw delay

### Day/Night Cycle
- Game runs 24 in-game hours, each hour = 6.4 seconds real-time (`timeDown()` function)
- At dark (hour 14), hunting phase ends, triggers return to journey view
- Final score: food collected during hunt

### Player Progression
- Stats tracked: food, money, mokeballs, grenades, speed
- Team (posse): Up to 5 creatures with health/conditions system
- Location-specific prey: Each trail location has different animal types with spawn frequency
- Save/load: JSON uploaded to server, auth token retrieved from URL query param

## Developer Workflows

### Start Development Server
```bash
npm install
npm start
```
Server runs on `http://localhost:8080` (or PORT from `.env`), serves from `/public`

### Game Flow
1. Player navigates `/` → renders hunt.ejs
2. `hunt.ejs` loads Pixi.js + game scripts
3. `onAssetsLoaded()` loads sprite sheets (bear.json, deer.json)
4. `$(document).ready()` in runaround.js: loads trail data, initializes map/hunter
5. `drawCanvas()` loop: 30 FPS rendering of hex grid, characters, projectiles

### Adding New Animals/Weapons
- **Animals**: Add sprite sheet to `public/assets/spritesheet/{name}.json`
- **Weapons**: Extend `Projectile` class in runaround.js, add to `hunter.weapons` array
- **Trail Locations**: Modify trail data (loaded in `loadTrail()`)

## Project Conventions

### Naming & Organization
- **Global scope variables**: `player`, `hunter`, `animals`, `map`, `projectiles`, `viewport` (intentional for game loop access)
- **jQuery patterns**: Extensive use of `$()` for DOM queries, `.append()` for building UI
- **Game loop**: 60 FPS for physics/movement, 30 FPS for rendering (can adjust via `frameRate` var)

### State Management
- **Single player instance** (global): all stats modified directly on `player` object
- **No real module system**: all scripts concatenated in hunt.ejs, rely on global scope
- **Save format**: `player.uploadJson()` extracts serializable state, server stores as JSON

### CSS Conventions
- BEM-like naming: `.numberInput`, `.numberInput_text`, `.numberInput_button`
- Hex-specific: `mokeIcon`, `thumbnailContainer`, `msgbutton` (in dialogBoxes.css)
- Responsive: Uses vmin units for viewport-relative sizing

## Integration Points

### Client-Server Communication
- **Save**: `POST /save` with JSON payload
- **Load**: `GET /load/{playerName}/{authtoken}` returns player state
- **Auth**: URL query param `?auth={token}` passed to game, validated by server

### Sprite System
- Pixi.js loads sprite sheets as JSON atlas + PNG
- Textures stored in global `textures` object, passed to Character constructors
- Animation: manually swap `img.texture` based on direction/action

### External Dependencies
- **express.js**: Web framework
- **body-parser**: Middleware for JSON/form parsing
- **pixi.js**: WebGL sprite rendering
- **jquery**: DOM manipulation (referenced as global `$`)
- **dotenv**: Environment variable loading

## Known Incomplete Features
- Firebase integration commented out (planned for persistent cloud saves)
- Auth system (tokens generated but not fully enforced)
- Multiple trail locations (infrastructure exists, may need content)
