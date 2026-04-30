# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server (http://localhost:5173)
npm run build      # TypeScript check + Vite production build
npm run lint       # ESLint on all .ts/.tsx files
npm run preview    # Preview production build locally
npm test           # Run Vitest unit tests
npx playwright test  # Run E2E / visual regression tests
```

To run a single Vitest test file:
```bash
npx vitest run tests/ball-manager.test.ts
```

## Architecture

**Pachinball** is a 3D WebGPU-first pachinko/pinball hybrid built with Babylon.js 7 and Rapier 3D WASM physics.

### Startup flow

`src/main.ts` bootstraps the Babylon engine (WebGPU → WebGL fallback) and preloads the Rapier WASM bundle in parallel, then hands off to `new Game()`. The `window.game` global is set for Playwright tests to hook into.

### Core modules

| Path | Role |
|------|------|
| `src/game.ts` | Monolithic orchestrator (~140 KB). Owns scene, cameras, lights, materials, post-processing, game-state machine (MENU / PLAYING / PAUSED / GAME_OVER), and wires all sub-systems together. |
| `src/game-elements/` | Discrete sub-systems: `physics.ts` (Rapier world), `ball-manager.ts` (spawn/collect/drain), `input.ts` (keyboard/touch/gamepad), `camera-controller.ts`, `sound-system.ts`, `zone-trigger-system.ts`, `leaderboard-system.ts`, `adventure-mode.ts`, `debug-hud.ts`, etc. |
| `src/objects/` | Playfield geometry: bumpers, flippers (joint-based rotation), walls, rails, pachinko pins, decoration. All live under `object-core.ts` as the top-level orchestrator. |
| `src/cabinet/` | Four cabinet presets (classic, neo, vertical, wide) built by `cabinet-builder.ts`. Each defines its own dimensions and styling. |
| `src/display/` | Multi-layer backbox display — reels rendered with WGSL shaders (`display-shader.ts`) or a canvas fallback; `display-core.ts` drives state transitions (IDLE → REACH → FEVER). |
| `src/shaders/` | Standalone WGSL/GLSL effect shaders: CRT scanlines + curvature, LCD table, jackpot overlay, number-scroll animation. |
| `src/materials/` | PBR material library split by domain (ball, metallic, interactive, structural). `material-core.ts` is the entry point. |
| `src/config.ts` | Ball-type definitions (STANDARD / GOLD_PLATED / SOLID_GOLD), spawn weight distribution (75 / 20 / 5 %), point values, fever-mode multipliers, API config. |

### Ball lifecycle

Balls are spawned by `BallManager` according to the weighted distribution in `config.ts`. Collection triggers point callbacks and increments the gold-ball counter. `zone-trigger-system.ts` detects spatial events (bumper hits, drain, special zones) and notifies the game loop.

### Testing approach

Unit tests (`tests/`) run in a Node environment via Vitest. Babylon.js and Rapier are fully mocked — do not import real engine code inside test files. Playwright E2E tests launch the full Vite dev server and access `window.game` for assertions; see `tests/verify_prism_core.spec.ts` for the pattern.

### WebGPU / shader authoring

Shaders in `src/shaders/` use Babylon.js `ShaderMaterial`. `display-shader.ts` targets WebGPU (WGSL); all shaders have a WebGL/canvas fallback path. Check for `engine.isWebGPU` before using WebGPU-only features.
