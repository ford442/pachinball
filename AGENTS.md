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
| `physics.ts` | Rapier world initialization, fixed timestep, collision event queue. |
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
- **`object-types.ts`** — Types and interfaces for game objects (FlipperConfig, BumperConfig, WallConfig, etc.).

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
- **`adventure-mode.ts`** — Main adventure orchestrator.
- **`track-builder.ts`** — Generic track construction helpers.
- **`camera-presets.ts`** — Cinematic camera angles.
- **`adventure-types.ts`** — Adventure mode types and interfaces (`AdventureTrackType`, `AdventureCallback`).
- **`tracks/*.ts`** — 25+ individual track builders (e.g., `neon-helix`, `cyber-core`, `quantum-grid`, `glitch-spire`, `prism-pathway`, `tesla-tower`, etc.).

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

### 4.6 Quality Tiering
`detectQualityTier(engine)` returns a `QualityTier` (`LOW`, `MEDIUM`, `HIGH`, `ULTRA`).
- Used by `MaterialLibrary` to choose texture resolution / compression.
- Used by `game.ts` to toggle post-processing features (SSAO, DoF, bloom scale).

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
4. Run E2E tests with `npx playwright test`.
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
