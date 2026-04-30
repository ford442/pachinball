# Copilot instructions for Pachinball

## Build, test, and lint commands

- `npm run dev` - start the Vite dev server at `http://localhost:5173`
- `npm run build` - type-check and create a production build
- `npm run lint` - run ESLint across the repo
- `npm test` - run Vitest unit tests in `tests/**/*.test.ts`
- `npx vitest run tests/ball-manager.test.ts` - run a single Vitest file
- `npx playwright test` - run Playwright browser specs in `tests/**/*.spec.ts`
- `npx playwright test tests/verify_prism_core.spec.ts` - run the current browser smoke test

Playwright does **not** start the app for you. Start `npm run dev` first and keep it serving `http://localhost:5173`.

## High-level architecture

- `src/main.ts` bootstraps Babylon and preloads Rapier WASM in parallel, then constructs `Game`. It also exposes `window.game` for browser tests.
- `src/game.ts` is the top-level orchestrator. It owns scene setup, cameras, post-processing, and subsystem wiring, but feature logic should live in the focused modules below and be connected back into `Game` with a small API surface.
- The runtime is split by responsibility:
  - `src/game-elements/`: low-level systems such as physics, input, settings, accessibility, feeders, camera control, haptics, sound, maps, and leaderboard/name-entry helpers.
  - `src/game/`: higher-level managers for game state, input shortcuts, table-map switching, cabinet presets, UI, and adventure flow.
  - `src/display/`: the modular backbox display system. It combines WGSL shader layers, Canvas reel fallback, and video/image overlays.
  - `src/objects/`, `src/effects/`, `src/materials/`, `src/adventure/`, and `src/cabinet/`: builders and focused subsystems for scene geometry, effects, materials, adventure tracks, and cabinet layouts.
- `PhysicsSystem` in `src/game-elements/physics.ts` owns the Rapier world, fixed-step stepping, and collision-event draining. Gameplay physics belongs there and in the object/ball modules, not in Babylon's built-in physics.
- `src/config.ts` is a pure configuration module. Keep Babylon imports out of it; use it for gameplay constants, feature flags, API/asset URLs, and backbox media paths.
- Theme changes span multiple systems: `TableMapManager` updates the LCD table shader state, the `MaterialLibrary`, and cabinet theming so map switches stay visually consistent.
- The display/backbox path is layered: video and image media take precedence, while shader/reel rendering is the fallback.

## Key conventions

- Prefer barrel imports from each major module's `index.ts`. If you add a new public module, export it from the barrel as well.
- Keep `src/game.ts` lean. If a feature starts looking like a subsystem, move it into `src/game-elements/`, `src/game/`, `src/display/`, `src/objects/`, `src/effects/`, `src/materials/`, `src/adventure/`, or `src/cabinet/`.
- Use the visual language system in `src/game-elements/visual-language.ts` (`PALETTE`, `SURFACES`, `INTENSITY`, `color()`, `emissive()`, etc.) instead of hardcoded colors or ad-hoc emissive values.
- Import Rapier only from `@dimforge/rapier3d-compat`.
- Many services are managed through `getXxx()` / `resetXxx()` helpers (`getMaterialLibrary`, `getSoundSystem`, `getMapSystem`, etc.). Reuse those scene-scoped singletons instead of creating parallel instances, and reset/dispose them on teardown or hot reload.
- Any new flashes, shake, scanline changes, or other intense effects must respect `detectAccessibility()`, reduced-motion settings, and photosensitive mode.
- Check for WebGPU support before relying on WGSL-only rendering paths; the game is WebGPU-first but must keep its WebGL/canvas fallback working.
- TypeScript is strict and uses `verbatimModuleSyntax`; prefer `import type` for type-only imports and do not leave unused locals or parameters behind.
- Unit tests run in a plain Node Vitest environment and mock Babylon/Rapier at module boundaries. Browser behavior is covered separately with Playwright against the live app.
- Use `import.meta.env.VITE_API_URL` and `import.meta.env.VITE_ASSET_URL` overrides instead of hardcoding new environment-specific endpoints.

## Recommended MCP server

For GitHub Copilot **Cloud agent**, this repository is a good fit for the Playwright MCP server because the app is browser-based and already uses Playwright for smoke coverage. Add this JSON in **GitHub repository settings -> Copilot -> Cloud agent -> MCP configuration**:

```json
{
  "mcpServers": {
    "playwright": {
      "type": "local",
      "command": "npx",
      "args": ["@playwright/mcp@latest"],
      "env": {},
      "tools": ["*"]
    }
  }
}
```
