# AGENTS.md

## 1. Project Overview

**Pachinball** (marketed as *Nexus Cascade*) is a browser-based hybrid arcade game that fuses:
- **Pinball mechanics** — flippers, bumpers, slingshots
- **Pachinko physics** — vertical pins, gravity-driven ball paths
- **Slot-machine meta-game** — backbox reels, jackpot states, fever modes
- **Adventure mode** — cinematic "holo-deck" tracks with dynamic obstacles and zone progression

### Technology Stack
- **Engine:** Babylon.js (`@babylonjs/core`)
- **Physics:** Rapier 3D WASM (`@dimforge/rapier3d-compat`)
- **Language:** TypeScript (ES2022, strict mode)
- **Build Tool:** Vite
- **Shaders:** WGSL (WebGPU) with Canvas2D fallback; custom GLSL-style pixel shaders (scanline, lcd-table)
- **Testing:** Playwright (`@playwright/test`)
- **Linting:** ESLint 9 with `typescript-eslint`

### Rendering Pipeline
- **WebGPU-first:** `EngineFactory.CreateAsync` attempts WebGPU; falls back to WebGL automatically.
- **Post-processing:** Bloom (`DefaultRenderingPipeline`), SSAO (`SSAO2RenderingPipeline`), depth of field, scanlines, and filmic tone mapping (Hable/ACES).
- **Shadows:** Blur exponential shadow maps with tuned bias/normal bias.
- **Renderer toggle:** `src/renderers/renderer-selector.ts` lets you force WebGL2 instead of WebGPU. Priority: `?renderer=webgl2|webgpu` URL param → `window.DEBUG_RENDERER` → `localStorage['pachinball-renderer']` → auto (WebGPU-first). Also exposed as a "Renderer" dropdown in the Developer settings panel (changing it reloads the page). The active backend is tagged on `<canvas data-renderer="webgpu|webgl2">` and `window.currentRenderer` for Playwright.
- **Debug overlays (Developer settings):** "Wireframe Mode" sets `scene.forceWireframe`; "Physics Debug Draw" renders Rapier's `world.debugRender()` collider/joint lines via `src/game-elements/physics-debug-renderer.ts`. Both work in either renderer, but WebGL2 is recommended for inspecting them with Playwright/agents since WebGPU canvases aren't readable by current automation tooling.
- **WebGL2 ↔ WebGPU porting notes:** Gameplay, physics, materials, and post-processing are backend-agnostic (Babylon abstracts both). The one backend-specific area is `src/display/display-shader.ts`, which uses WGSL `ShaderMaterial`s for the backbox reels with a Canvas2D fallback — check `engine.getClassName() === 'WebGPUEngine'` (or `engine.isWebGPU`) before taking the WGSL path, as the existing display code does.

---

## 2. Build, Test & Development Commands

```bash
# Start local dev server (http://localhost:5173)
npm run dev

# Type-check + production build (outputs to dist/)
npm run build

# Lint the entire codebase
npm run lint

# Type-check only
npx tsc -b

# Preview the production build locally
npm run preview

# Run Playwright E2E tests
npx playwright test
```

### Continuous Integration

`.github/workflows/ci.yml` gates every pull request and every push to `main`. The blocking
`check` job runs, in order: `npm ci` → `npx tsc -b` → `npm run lint` → `npx vitest run` →
`npx vite build`. **PRs must stay green** — do not merge red. A second, non-blocking
(`continue-on-error`) `e2e` job runs a Playwright smoke against a live dev server.

Notes:
- CI runs `npx vite build`, **not** `npm run build` — the latter chains `build:wasm`
  (Emscripten), which isn't installed on the runner. The C++ WASM bundle is intentionally
  out of CI; the physics-engine flag falls back to Rapier when the bundle is absent.
- Enabling branch protection on `main` (require the `check` job) is recommended so ungated
  direct-to-`main` pushes can't regress the build.

---

## 3. Directory & Module Map

Every major subdirectory exposes a barrel file (`index.ts`). Import through the barrel rather than deep-path imports when possible.

### Entry Points
- **`src/main.ts`** — Bootstrap. Creates the Babylon engine in parallel with Rapier WASM preloading, then instantiates and initializes `Game`.
- **`src/game.ts`** — Main orchestrator class. Coordinates all subsystems, scene setup, lighting, cameras, and the render loop. **Keep it lean; do not dump feature logic here.**
- **`src/config.ts`** — Pure configuration (no Babylon dependencies). Contains API bases, ball spawn weights, gameplay constants, effects feature flags, and backbox media paths.

### Core Logic Modules

#### `src/game-elements/` — Low-level game systems
| File / Sub-module | Responsibility |
|-------------------|----------------|
| `physics.ts` | Rapier world initialization, fixed timestep, collision event queue. **Also defines `CollisionGroups` and `COLLISION_GROUP_PRESETS` used by both table and adventure. Adventure bodies MUST use `ADVENTURE_GROUP`.** |
| `types.ts` | Shared enums/interfaces: `GameState`, `DisplayState`, `PhysicsBinding`, `InputFrame`, ball types, slot machine types. |
| `ball-manager.ts` | Ball lifecycle: spawning, multiball, resetting, loss detection, gold-ball stack tracking. |
| `ball-animator.ts` | Squash-and-stretch visual effects for balls. |
| `input.ts` | Core keyboard/touch input, input buffering, latency tracking, plunger charge logic. |
| `settings.ts` | LocalStorage-backed settings (shake intensity, scanlines, audio). |
| `accessibility-config.ts` | **Safety-critical.** Detects `prefers-reduced-motion`, photosensitive mode, haptic preferences. |
| `haptics.ts` | Haptic feedback manager (vibration patterns). |
| `gamepad.ts` | Gamepad polling + vibration. |
| `sound-system.ts` | Simple synthesized audio beeps/SFX. |
| `map-system.ts` | Dynamic backend map fetching. |
| `leaderboard-system.ts` | Score submission + leaderboard UI. |
| `name-entry-dialog.ts` | High-score name entry UI. |
| `level-select-screen.ts` | Adventure level select overlay. |
| `zone-registry.ts` | Adventure zone configurations and transition metadata. |
| `zone-trigger-system.ts` | AABB zone entry/exit detection. |
| `dynamic-scenarios.ts` | Scenario definitions for dynamic/fixed mode toggling. |
| `dynamic-world.ts` | Scrolling world generation for dynamic adventure mode. |
| `camera-controller.ts` | Camera modes, soft follow, framing zones. |
| `path-mechanics.ts` | Dynamic adventure interactive elements: gates, magnets, launch pads, jump pads. |
| `ball-stack-visual.ts` | Visual stack of reserve balls (gold-ball tracking). |
| `debug-hud.ts` | Development overlay for runtime state monitoring (FPS, physics, performance tier). |
| `display-config.ts` | Display system configuration: modes, states, blend modes, media playlists. |
| `adventure-state.ts` | Level goals, progression, story system, unlockable rewards, map unlocking. |
| `adventure-mode.ts` | Legacy adventure orchestrator (being phased out in favor of `src/adventure/`). |
| `adventure-mode-builder.ts` | Legacy adventure track builder. |
| `adventure-mode-tracks-a.ts` / `adventure-mode-tracks-b.ts` | Legacy track data files. |
| Various `*-feeder.ts` | Specialized table toys: `mag-spin-feeder`, `nano-loom-feeder`, `prism-core-feeder`, `gauss-cannon-feeder`, `quantum-tunnel-feeder`. |

#### `src/game/` — High-level managers (barrel: `src/game/index.ts`)
| File | Responsibility |
|------|----------------|
| `game-state.ts` | `GameStateManager` — state transitions (MENU → PLAYING → PAUSED → GAME_OVER). |
| `game-input.ts` | `GameInputManager` — wraps `InputHandler` and adds game-level shortcuts (map switch, cabinet cycle, level select, etc.). |
| `game-maps.ts` | `TableMapManager` — LCD table map switching, shader registration. |
| `game-cabinet.ts` | `CabinetManager` — cabinet preset cycling (classic, neo, vertical, wide). |
| `game-ui.ts` | `GameUIManager` — HUD popups, messages, toast notifications. |
| `game-adventure.ts` | `AdventureManager` — orchestrates adventure mode start/stop, zone callbacks, score awards. |

#### `src/display/` — Backbox display system (barrel: `src/display/index.ts`)
Replaces the old monolithic `display.ts`.
- **`display-core.ts`** — Main `DisplaySystem` class.
- **`display-reels.ts`** — Slot-machine reel animation (Canvas2D fallback).
- **`display-shader.ts`** — WGSL shader reel layer (WebGPU path).
- **`display-video.ts`** — HTMLVideoElement layer for attract/jackpot/fever/reach/adventure clips.
- **`display-image.ts`** — Static image display layer for the backbox.
- **`display-types.ts`** — Enums and interfaces (`DisplayState`, `DisplayMode`, CRT presets).

#### `src/effects/` — Visual & audio effects (barrel: `src/effects/index.ts`)
- **`effects-core.ts`** — `EffectsSystem`: bloom spikes, screen shake, jackpot sequences.
- **`effects-particles.ts`** — Shard burst particle systems.
- **`effects-lighting.ts`** — Environment color shifts, light animations.
- **`effects-camera.ts`** — Camera shake, trauma/decay logic.
- **`effects-types.ts`** — Effect types and interfaces (`EffectType`, `ParticleConfig`, `ScreenShakeConfig`).

#### `src/objects/` — Scene object builders (barrel: `src/objects/index.ts`)
- **`object-core.ts`** — `GameObjects` class: ground, table bounds, slingshots, targets.
- **`object-flippers.ts`** — Flipper mesh + rigid body construction.
- **`object-bumpers.ts`** — Bumper geometry, holograms, collision bodies.
- **`object-walls.ts`** — Wall and lane-guide builders.
- **`object-rails.ts`** — Rail and ramp builders.
- **`object-pachinko.ts`** — Pachinko pin field generation.
- **`object-decoration.ts`** — Cabinet trim, LEDs, decorative meshes.
- **`object-types.ts`** — Types and interfaces for game objects (FlipperConfig, BumperConfig, WallConfig, etc.). |

#### `src/materials/` — Unified PBR Material System (barrel: `src/materials/index.ts`)
`MaterialLibrary` is a singleton (created via `getMaterialLibrary(scene)`). It delegates to:
- **`material-core.ts`** — Base class, texture loading, quality-tier detection.
- **`material-ball.ts`** — Chrome, gold-plated, solid-gold ball materials.
- **`material-metallic.ts`** — Chrome, brushed metal, carbon fiber, pin, rail materials.
- **`material-interactive.ts`** — Neon bumpers, flippers, slingshots, energy beams, holograms.
- **`material-structural.ts`** — Cabinet wood, plastic, playfield, LCD table materials.

#### `src/shaders/` — Shader code
- **`numberScroll.ts`** / **`jackpotOverlay.ts`** — WGSL shaders for WebGPU reel rendering.
- **`scanline.ts`** — Custom pixel shader for CRT scanlines.
- **`lcd-table.ts`** — Custom pixel shader for LCD table-surface maps (registers maps like *neon-helix*, *cyber-core*, etc.).
- **`crt-effect.ts`** — Retro CRT monitor effect shader (curvature, chromatic aberration, vignette, phosphor glow).
- **`index.ts`** — Shader barrel file.

#### `src/adventure/` — Adventure mode tracks (barrel: `src/adventure/index.ts`)
- **`adventure-mode.ts`** — Main adventure orchestrator. **Start/end lifecycle MUST disable/enable table physics. Zone state MUST be reset in `end()`.** |
- **`track-builder.ts`** — Generic track construction helpers.
- **`camera-presets.ts`** — Cinematic camera angles.
- **`adventure-types.ts`** — Adventure mode types and interfaces (`AdventureTrackType`, `AdventureCallback`).
- **`tracks/*.ts`** — 25+ individual track builders (e.g., `neon-helix`, `cyber-core`, `quantum-grid`, `glitch-spire`, `prism-pathway`, `tesla-tower`, etc.).

Campaign progression reference: `docs/ADVENTURE_CAMPAIGN.md` (A/B alternation + portal loop).  
Campaign truth is `AdventureTrackProgression` + `AdventureProgressionSupervisor`; treat `AdventureState` as legacy level-select progression.

#### `src/cabinet/` — Cabinet presets (barrel: `src/cabinet/index.ts`)
- **`cabinet-builder.ts`** — Factory / orchestrator.
- **`cabinet-classic.ts`** / **`cabinet-neo.ts`** / **`cabinet-vertical.ts`** / **`cabinet-wide.ts`** — Individual preset geometries.
- **`cabinet-types.ts`** — Shared type definitions (`CabinetType`, `CabinetPreset`).

---

## 4. Architecture Principles

### 4.1 Strict Modularity — No Monolith Creep
`game.ts` is intentionally the orchestrator, **not** the dumping ground. When adding a feature:
1. Identify the correct module (display, effects, objects, materials, adventure, etc.).
2. Implement the feature there.
3. Expose a clean public API (class or function).
4. Wire it into `game.ts` with a minimal call.

**Bad:** Adding 50 lines of bumper logic directly into `game.ts`.  
**Good:** Extending `object-bumpers.ts` or `effects-particles.ts`, then calling it from `game.ts`.

### 4.2 Physics — Rapier Only
- Import Rapier **exclusively** from `@dimforge/rapier3d-compat`.
- `PhysicsSystem` initializes the WASM asynchronously and runs a **fixed timestep** with an accumulator (`FIXED_TIMESTEP = 1/60`).
- Collision events are drained from `RAPIER.EventQueue` inside `PhysicsSystem.step()`.
- **Never** use Babylon's built-in collision or physics engine for gameplay logic.

### 4.3 Display System — Hybrid WebGPU / Canvas2D
- **Primary path:** WebGPU WGSL shaders (`display-shader.ts`) for slot reels and jackpot overlays.
- **Fallback path:** Standard Canvas2D textures (`display-reels.ts`) when WebGPU is unavailable.
- Backbox media hierarchy: **Video** > **Image** > **Procedural reels**.
- State-specific media paths (attract, jackpot, fever, reach, adventure) are configured in `src/config.ts` under `GameConfig.backbox`.

### 4.4 Config Purity
`src/config.ts` must **not** import Babylon.js. It contains:
- Numeric gameplay constants (gravity, flipper strength, ball radius).
- Color strings / feature flags (`EffectsConfig`).
- API/asset base URLs (`API_BASE`, `ASSET_BASE`).
- Helper `apiFetch<T>()` with exponential backoff retry logic.

### 4.5 Accessibility & Safety (CRITICAL)
`detectAccessibility()` reads system preferences and impacts:
- **Reduced motion** → disables camera shake, SSAO, depth of field, fog.
- **Photosensitive mode** → removes all flashing / strobe effects.
- **Haptics** → scales or disables vibration.

When adding any screen flash, shake, or rapid strobe, **always** gate it behind these flags.

- **Adventure camera transitions:** `applyCameraPresetTransition()` respects `reducedMotion` for instant cuts vs eased transitions. Accessibility config is set via `setAccessibilityConfig()` during init and pause. If adding new settings-change paths, always propagate to `AdventureMode`.

### 4.6 Quality Tiering
`detectQualityTier(engine)` returns a `QualityTier` (`LOW`, `MEDIUM`, `HIGH`, `ULTRA`).
- Used by `MaterialLibrary` to choose texture resolution / compression.
- Used by `game.ts` to toggle post-processing features (SSAO, DoF, bloom scale).

### 4.7 Adventure Mode Lifecycle (CRITICAL)

When the campaign loop (STATIONARY_TABLE ↔ EXTENDED_MAP) is involved, the following rules are **mandatory**:

1. **Table physics MUST be disabled when adventure mode starts.**
   - `gameObjects.setTableBodiesEnabled(false)` before `adventureMode.start()`
   - `gameObjects.setTableBodiesEnabled(true)` after `adventureMode.end()`
   - Visual mesh hiding via `setEnabled(false)` is NOT sufficient

2. **Call `rebuildHandleCaches()` after every mode/track transition.**
   - After `adventureMode.end()`
   - After `adventureMode.switchToTrack()`
   - After returning from pause if physics bodies changed

3. **Never cast `scene.activeCamera` to `ArcRotateCamera`.**
   - Table camera is `FreeCamera` (extends `TargetCamera`)
   - Adventure camera is `ArcRotateCamera`
   - Use base `Camera` type for cross-mode references
   - AdventureCinematicSystem MUST be wired to `followCamera`, not `tableCam`

4. **Input MUST be mode-gated.**
   - Flippers/plunger inputs must NOT fire during adventure mode
   - Check `adventureMode?.isActive()` in `GamePhysicsController.stepPhysics()`
   - Nudge can remain mode-agnostic
   - `C` key (camera follow toggle) must NOT override adventure camera

5. **Zone state must be fully reset on adventure end.**
   - `end()` MUST set `currentZone = null` and `previousZone = null`
   - Failure causes stale transition detection on re-entry

6. **Portal sensor handles must be unregistered on ALL deactivation paths.**
   - `deactivateExitPortal()` MUST emit `PORTAL_DEACTIVATED` event
   - Handler in `game-systems-init.ts` MUST call `unregisterPortalSensor()`
   - This covers `switchToTrack()` and `activateExitPortal()` replacement paths

7. **Collision groups MUST separate table and adventure bodies.**
   - Adventure bodies use `ADVENTURE_GROUP` membership
   - Adventure bodies only filter `CollisionGroups.BALL`
   - Table bodies are unchanged (existing `COLLISION_GROUP_PRESETS`)
   - This prevents collision even if table bodies are accidentally left enabled

---

## 5. Code Style & Conventions

### Visual Language System
The project uses a unified cyber/neon design system defined in `src/game-elements/visual-language.ts` and documented in `src/game-elements/VISUAL_LANGUAGE.md`.

**Always use these instead of hardcoding hex colors or random intensity values:**
```typescript
import { PALETTE, SURFACES, INTENSITY, STATE_COLORS, color, emissive, pulse } from './visual-language'

// Good
mat.emissiveColor = emissive(PALETTE.CYAN, INTENSITY.HIGH)

// Bad
mat.emissiveColor = Color3.FromHexString('#00aaff') // inconsistent
```

### TypeScript Strictness
- `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`.
- Clean up unused imports and variables before finishing.
- Use `verbatimModuleSyntax: true` — prefer `import type` when only importing types.

### Barrel Files
Major modules export an `index.ts`. When consuming a sibling module, prefer the barrel import:
```typescript
// Good
import { PhysicsSystem, BallManager } from './game-elements'

// Acceptable for deep internal files
import { FlipperBuilder } from './objects/object-flippers'
```

### Singleton Management Pattern
Several systems use `getXxx()` / `resetXxx()` singleton helpers (e.g., `getMaterialLibrary(scene)`, `resetMaterialLibrary()`). This ensures:
- One instance per scene lifecycle
- Clean disposal on hot-reload / restart

---

## 6. Testing Strategy

- **Framework:** Playwright (`playwright.config.ts`) + Vitest (`vitest`)
- **Base URL:** `http://localhost:5173`
- **Browser:** Desktop Chrome (single project)
- **Test location:** `tests/`
- **E2E test:** `tests/verify_prism_core.spec.ts` — smoke test that boots the game, clicks **Start Game**, waits for scene init, and takes a verification screenshot.
- **Unit tests:** `tests/ball-manager.test.ts` — BallManager logic tests (Vitest).

**Workflow for adding tests:**
1. Ensure `npm run dev` is running.
2. Write `.spec.ts` files in `tests/` for Playwright E2E tests.
3. Write `.test.ts` files in `tests/` for Vitest unit tests.
4. Run E2E tests with `npx playwright test`
5. Run unit tests with `npm test` (alias for `vitest run`).

---

## 7. Deployment

**Command:** `python3 deploy.py`

**What it does:**
1. Assumes `dist/` already exists (run `npm run build` first if missing).
2. Uses `paramiko` to open an SFTP connection.
3. Recursively uploads `dist/` to the remote server path.

**Important:** `deploy.py` contains hardcoded credentials. Do not modify or expose its contents unnecessarily.

---

## 8. Security Considerations

| File | Sensitivity | Guidance |
|------|-------------|----------|
| `deploy.py` | **High** | Contains hardcoded SFTP password. Avoid logging or sharing. |
| `.env.production` | **High** | Blocked from read access by security policy. Do not paste contents into chat. |
| `src/config.ts` | Medium | Exposes prod API base (`storage.noahcohn.com`) and asset paths. Safe to reference, not to abuse. |

When making changes that touch authentication, API keys, or asset URLs, use `import.meta.env.VITE_API_URL` / `VITE_ASSET_URL` overrides rather than hardcoding new secrets.

---

## 9. Common Pitfalls

1. **Monolith Creep in `game.ts`**  
   Do not add large blocks of object creation or physics logic to `game.ts`. Use `src/objects/`, `src/game-elements/`, or `src/effects/` instead.

2. **Wrong Rapier Import**  
   Always import from `@dimforge/rapier3d-compat`. The native `@dimforge/rapier3d` package will break in the browser.

3. **Asset Loading Race Conditions**  
   Babylon loads meshes/textures asynchronously. Ensure assets are fully loaded before attaching Rapier rigid bodies.

4. **Hardcoding Colors / Intensities**  
   Use the Visual Language System (`PALETTE`, `INTENSITY`, `emissive()`). Hardcoded hex values create visual inconsistency.

5. **Ignoring Accessibility Flags**  
   Camera shake, flashing lights, and fog must respect `accessibility.reducedMotion` and `accessibility.photosensitiveMode`. Check these flags before enabling any intense visual effect.

6. **Forgetting Barrel Exports**  
   If you create a new public class/module, add it to the relevant `index.ts` so other parts of the codebase can import it cleanly.

7. **Disposing Physics World Improperly**  
   `PhysicsSystem.dispose()` calls `world.free()`. Make sure this happens on teardown to avoid WASM memory leaks.

8. **Forgetting to Disable Table Physics on Adventure Entry**  
   `setEnabled(false)` on meshes does NOT affect Rapier bodies. Always pair visual hiding with physics body disablement. Use `setTableBodiesEnabled(false)` or equivalent.

9. **Assuming `scene.activeCamera` is Always `ArcRotateCamera`**  
   The table uses `FreeCamera`. Never cast `activeCamera` to `ArcRotateCamera` without type guard. Use base `Camera` type for mode-agnostic code.

10. **Stale Portal Handles in `portalSensorHandleSet`**  
    Every path that deactivates a portal must unregister its handle. The PORTAL_ENTERED handler covers the happy path, but `switchToTrack()` and `activateExitPortal()` replacement also call `deactivateExitPortal()` — use the `PORTAL_DEACTIVATED` event pattern.

---

## Cursor Cloud specific instructions

This is a frontend-only Vite + TypeScript app — there is no backend service to run for local development. Dependencies (`npm install` + the Playwright Chromium browser) are refreshed automatically by the cloud update script.

Standard commands are in section 2 (`npm run dev`, `npm run build`, `npm run lint`, `npm test`, `npx playwright test`). Non-obvious caveats:

- **Dev server:** `npm run dev` serves on `http://localhost:5173`. Run it in a long-lived terminal (e.g. tmux) before Playwright E2E specs — `playwright.config.ts` has **no** `webServer` block, so it will not auto-start the dev server; tests will fail/hang against `localhost:5173` if nothing is serving.
- **Tests:** `npm test` (Vitest, Node env, Babylon/Rapier mocked) needs no server. `*.spec.ts` files are Playwright E2E and DO need the dev server running.
- **Renderer for automation:** WebGPU canvases can't be read by Playwright/computer-use tooling. Append `?renderer=webgl2` to the URL (e.g. `http://localhost:5173/?renderer=webgl2`) when driving the game from automation or capturing screenshots.
- **`npm run build` and WASM:** `build` runs `tsc -b && vite build && npm run build:wasm`. The `build:wasm` step compiles an *optional* C++ physics engine (`native/`) via Emscripten and **gracefully skips with exit 0 when `emcc` is not installed** — so `npm run build` succeeds in this environment without Emscripten. Gameplay physics uses Rapier WASM (bundled via npm), independent of that optional C++ module.
