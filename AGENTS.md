# AGENTS.md

## Project Context
**Pachinball** is a browser-based hybrid arcade game combining **Pinball mechanics** (flippers, bumpers) with **Pachinko physics** (vertical pins, balls) and a **Slot Machine** meta-game.

**Tech Stack:**
* **Engine:** Babylon.js (`@babylonjs/core`)
* **Physics:** Rapier (`@dimforge/rapier3d-compat`)
* **Language:** TypeScript
* **Build:** Vite
* **Shaders:** WGSL (WebGPU) with Canvas fallback.

## Key Directives & Architecture

### 1. Modularity (Strict Enforcement)
The project has been refactored to prevent `game.ts` from becoming a monolith. You **MUST** place logic in `src/game-elements/` according to its responsibility:

* **`game-objects.ts`:** Static or interactive elements (Flippers, Bumpers, Walls, Pins).
* **`ball-manager.ts`:** Ball lifecycle (Spawning, Multiball, Resetting, Catching). *Do not put ball physics config here; keep that in physics init.*
* **`display.ts`:** The "Backbox" logic (Slot machine reels, Score display, LED matrix).
* **`effects.ts`:** Particle systems (shards), Bloom, and Audio triggers.
* **`physics.ts`:** The Rapier world initialization and global stepping loop.
* **`adventure-mode.ts`:** The specific logic for the "Holo-deck" adventure sub-game.

### 2. Physics (Rapier + Babylon)
* **Asynchronous Init:** Rapier is initialized asynchronously (`@dimforge/rapier3d-compat`). Ensure initialization is complete before creating bodies.
* **Coupling:** We sync visual meshes (Babylon) with rigid bodies (Rapier).
* **Collision Handling:** Use the event handlers set up in `physics.ts`. Do not use Babylon's built-in collision engine; strictly use Rapier.

### 3. The Display System (Hybrid)
The "Backbox" display uses a hybrid approach:
* **WebGPU (WGSL):** Used for the slot machine reels (`shaders/numberScroll.ts`, `shaders/jackpotOverlay.ts`) when available.
* **Fallback:** Uses standard Canvas2D textures if WebGPU is absent.
* **Action:** When editing display logic, check `display.ts` first. If editing visual style, check the WGSL shaders in `src/shaders/`.

### 4. Game State
* States are defined in `src/game-elements/types.ts` (e.g., `GameState.IDLE`, `GameState.PLAYING`).
* The Slot Machine has its own state (`DisplayState.IDLE`, `DisplayState.REACH`, `DisplayState.FEVER`).

## Directory Map
* **`src/`**: Entry point (`main.ts`, `game.ts`).
* **`src/game-elements/`**: Core logic modules.
* **`src/shaders/`**: WGSL shader code for the display.
* **`public/`**: Assets (Textures, Sounds, Models).
* **`concept/`**: Design reference images.

## Available Tools & Commands

### Development
* **Start Server:** `npm run dev` (Vite)
* **Lint:** `npm run lint` (ESLint)
* **Type Check:** `tsc -b`

### Deployment
* **Script:** `python3 deploy.py`
* **Process:** Builds the project (`npm run build`) and uploads the `dist/` folder via SFTP.

## Common Pitfalls
1.  **Monolith Creep:** Do not add 50 lines of bumper logic to `game.ts`. Add it to `game-objects.ts` and call it from `game.ts`.
2.  **Physics Imports:** Ensure you import from `@dimforge/rapier3d-compat`, not the native rapier package.
3.  **Asset Loading:** Babylon.js loads assets asynchronously. Ensure meshes are loaded before attempting to attach physics bodies.
