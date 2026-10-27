# Free Map Test Mode

## Overview

The Free Map Test Mode is a developer sandbox that allows instant switching between any adventure track layout without following the normal campaign progression. It's designed for rapid iteration on physics, visuals, and track design.

## Activation

### Keyboard Shortcut
Press **Ctrl+Shift+M** to toggle Free Map Test Mode on/off.

### Programmatic Access
```typescript
// From browser console (when game instance is accessible):
game.toggleFreeMapTestMode()

// Or directly:
game.freeMapTestMode?.activate()
game.freeMapTestMode?.deactivate()

// Load a specific track:
game.freeMapTestMode?.loadById('CYBER_CORE')
```

## Controls (while Test Mode is active)

| Key | Action |
|-----|--------|
| **Ctrl+Shift+M** | Toggle test mode on/off |
| **PageDown** | Cycle to next track |
| **PageUp** | Cycle to previous track |
| **Drain** | Auto-advance to the next track and respawn launch-ready |

Standard gameplay controls (flippers, plunger, nudge) remain active during test mode.

## HUD Indicator

When test mode is active, a green HUD overlay appears in the top-right corner showing:
- Current track name
- Layout type (extended / stationary)
- Position in registry (e.g., "3/25")

## Available Layouts

All 25 adventure tracks are available in test mode:

### Extended Maps (scrolling 3D landscape)
- Neon Helix, Quantum Grid, Singularity Well, Glitch Spire, Retro Wave Hills, Chrono Core, Hyper Drift, Orbital Junkyard, Firewall Breach, CPU Core, Cryo Chamber, Bio Hazard Lab, Gravity Forge, Tidal Nexus, Digital Zen Garden, Synthwave Surf, Solar Flare, Prism Pathway, Magnetic Storage, Neural Network, Neon Stronghold, Casino Heist, Tesla Tower, Neon Skyline, Polychrome Void

### Stationary Tables (classic pinball arena)
- Cyber Core, Pachinko Spire

## Architecture

The test mode is built on three modules:

1. **`src/game/map-registry.ts`** — Unified layout registry that combines adventure track metadata with the `TRACK_CATALOG` into a flat list of `MapConfig` entries.

2. **`src/game/level-loader.ts`** — `LevelLoader` class that handles:
   - Looking up map configs
   - Ensuring adventure mode is active
   - Delegating to `AdventureMode.switchToTrack()` (which internally calls `clearTrack()` to dispose physics bodies/meshes)
   - Resetting the ball to plunger position

3. **`src/game/free-map-test-mode.ts`** — `FreeMapTestMode` class that provides:
   - Activation/deactivation lifecycle
   - Keyboard shortcut registration (PageUp/PageDown) plus drain-to-advance flow
   - HUD indicator management
   - Registry cycling logic

## Physics Cleanup

Each track switch calls `AdventureMode.clearTrack()` which:
- Disposes all track meshes and materials
- Removes all rigid bodies from the physics world — the C++ owner's `WasmTableWorld` by default, Rapier in the Rapier modes (checking `getRigidBody(handle)` before removal)
- Clears conveyor zones, gravity wells, damping zones, sensors, and chroma gates
- This prevents body leaks and double-collider bugs during repeated switches

## Notes

- Test mode bypasses campaign unlock gates — all tracks are available immediately.
- The existing adventure campaign flow is not affected; test mode operates independently.
- The `GameInputManager` registers Ctrl+Shift+M as a global shortcut (works in any game state).

# Playwright configs and CI jobs

| Config | Server | Port | Projects | CI job | Specs |
|--------|--------|------|----------|--------|-------|
| `playwright.config.ts` | `npm run dev` | 5173 | desktop `chromium`, `mobile-chrome` (Pixel 7) | `e2e` (blocking) | `verify_prism_core`, `basic-gameplay`, `lifecycle-dispose`, `mobile-touch-smoke` |
| `playwright.degrade.config.ts` | dev server with `public/wasm` removed | 4173 | `chromium` | `e2e`, "Physics degrade" step | `physics-degrade` (covers the `[Bootstrap][physics-degrade]` marker) |
| `playwright.preview.config.ts` | `vite preview` of the built `dist/` | 4174 | `chromium` only | `e2e-preview` (blocking, matrix `wasm: [true, false]`) | `preview-boot`, `preview-sw`, `verify_prism_core`, `basic-gameplay`, `lifecycle-dispose` |

The dev job never runs minified output, so it cannot see problems that only exist in the production bundle (stripped `console.*`, chunking, the `wasm-worker` default under real COOP/COEP). `e2e-preview` covers that:

- `wasm: true` builds the WASM bundle (emsdk, same cache key as `native-physics.yml`) and sets `PREVIEW_EXPECT_ENGINE=wasm-worker`; `wasm: false` deletes `public/wasm` and expects `rapier` (the production fail-closed path).
- `preview-boot` asserts `crossOriginIsolated`, `currentPhysicsEngine` and a `webgl2` canvas (SwiftShader offers no WebGPU adapter).
- Service workers are blocked for every spec except `preview-sw`, which lets Workbox control the page and checks that the reloaded document is still cross-origin isolated.
- `scripts/check-dist-console.mjs` asserts the `Failed to bootstrap game` literal and the absence of `debugger` in the entry chunk.
- Mobile is dev-only: the touch smoke is not about the bundle, so it is not repeated on preview.

Run it locally: `npx vite build && PREVIEW_EXPECT_ENGINE=rapier npx playwright test --config=playwright.preview.config.ts tests/preview-boot.spec.ts tests/preview-sw.spec.ts` (`PREVIEW_EXPECT_ENGINE` defaults from whether `public/wasm/` exists).
