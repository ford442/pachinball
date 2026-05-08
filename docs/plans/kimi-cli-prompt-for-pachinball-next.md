# Kimi-CLI Prompt: Continue Pachinball Development (2026-05-07)

You are an expert full-stack TypeScript + Babylon.js game developer and AI coding agent. Your goal is to implement the **next items from the project's weekly_plan.md** in the repo https://github.com/ford442/pachinball.

## Project Context (Critical - Read Carefully)
- **Project**: Pachinball — 3D hybrid Pachinko + Pinball game using Babylon.js (WebGPU), Rapier 3D physics, TypeScript, Vite.
- **Current State (as of 2026-05-07)**:
  - Major refactor completed today: Full typed **EventBus** (`src/game/event-bus.ts`) with events like `game:start`, `game:over`, `fever:start`, `jackpot:start`, `adventure:end`, `display:set`, `state:change`.
  - **All tests green**:
    - `tests/event-bus.test.ts` (15 tests, complete)
    - `tests/game-state.test.ts` (full coverage)
    - `tests/display-states.spec.ts` (Playwright e2e for all DisplayState transitions via EventBus — this was the last "Ideas" item)
  - `src/config.ts` already has extensive `GAME_TUNING`, `GameConfig` (physics, table, ball, flipper, combo, scoring, backbox, magSpin, nanoLoom, prismCore, etc.).
  - `src/game.ts` is the central orchestrator. Most magic numbers extracted, but a few remain (see below).
  - Sound is partially abstracted via `getSoundSystem()` and passed to DynamicWorld / AdventureManager. One remaining direct call: `this.effects?.playBeep(440)` on adventure end.
  - Many audit reports in `docs/` (PHYSICS_*, LIGHTING_*, etc.) untouched since March.

## Exact Task List (from weekly_plan.md Backlog — Do in This Order)

### 1. Sound System EventBus Integration (Highest Priority — Do First)
**Goal**: Fully decouple sound from direct calls in `game.ts`. Make SoundSystem reactive via EventBus subscriptions (matching the new architecture used by DisplaySystem, EffectsSystem, GameStateManager).

**Steps**:
1. Locate the sound implementation:
   - Find `getSoundSystem()` definition (likely in `src/game/sound.ts`, `src/effects.ts`, or similar).
   - Find `SoundSystem` class or equivalent.
   - Check how it's currently initialized in `game.ts`.

2. Modify `getSoundSystem(eventBus?: EventBus)` (or add EventBus support):
   - In the function or SoundSystem constructor/init, subscribe to these events:
     - `'game:start'` → play start jingle / music
     - `'game:over'` → play game over sound
     - `'fever:start'` → play fever theme / layer
     - `'jackpot:start'` → play jackpot fanfare
     - `'adventure:end'` → playBeep(440)  (replace the direct call)
     - Bonus: `'display:set'` for state-specific layers if useful
   - Use the existing `playBeep`, `play*` methods — just wire them to events.

3. Update `src/game.ts`:
   - Pass the EventBus when calling `getSoundSystem(this.eventBus)`
   - Remove the direct `this.effects?.playBeep(440)` line in the adventure 'END' case (add a comment: "// Now handled via EventBus 'adventure:end' subscription")
   - Ensure soundSystem is still passed to AdventureManager and DynamicWorld.

4. Verify:
   - Run `npm test` (Vitest + Playwright)
   - Manually test in browser: start game, trigger fever/jackpot/adventure end — confirm sounds still play correctly.
   - No new direct calls to sound from game.ts.

**Reference Code** (use this style):
```ts
// In getSoundSystem
if (eventBus) {
  eventBus.on('game:start', () => soundSystem.playStartJingle());
  eventBus.on('adventure:end', () => soundSystem.playBeep(440));
  // etc.
}
```

### 2. Finish Config Extraction (Small Cleanup)
**Remaining magic numbers in `src/game.ts`** (from code audit):
- `cameraFollowTransitionSpeed = 3.0`
- `fogDensity = 0.015`
- `mirrorSize` (2048 high / 1024 medium)
- `mirrorTexture.level = 0.6`
- `skybox size = 200.0`
- `uMapBlend = 0.5` (LCD post-process)
- `scanlineIntensity = 0.12`
- A few timing values (requestIdleCallback 500ms, etc.)

**Action**:
- Move them into `src/config.ts` (add new sections: `CameraConfig`, `EnvironmentConfig`, `PostProcessConfig`, or expand `GAME_TUNING` / `visuals`).
- Update `game.ts` to read from `config` instead of hardcoding.
- Keep the change minimal and clean.

### 3. Audit Reports Triage (Cleanup)
- Review key files in `docs/`:
  - `PHYSICS_AUDIT_MASTER.md`, `PHYSICS_*` reports
  - `LIGHTING_SHADOW_PP_AUDIT_REPORT.md`
  - `MATERIAL_PBR_AUDIT_REPORT.md`
  - `RENDERING_AUDIT_REPORT.md`
  - Camera and Input audits
- For each: Summarize open recommendations, mark which are implemented/stale, and either implement quick wins or note in a new `docs/AUDIT_TRIAGE_2026-05-07.md`.

## Output Requirements
- Make **atomic, clean commits** (or prepare a single PR-ready branch).
- Update `weekly_plan.md` at the end: Move completed items to "Done (2026-05-07)", add any new notes.
- After finishing, run full test suite and confirm everything still works.
- If you encounter blockers, ask clarifying questions or propose alternatives.

## Working Style
- Be precise and minimal — only change what's needed.
- Follow existing code style (typed EventBus, clean separation).
- Use the existing EventBus type: `import type { EventBus, PachinballEventName } from './event-bus'`
- After changes, provide a short summary of what was done + any follow-up suggestions.

Start now with task #1 (Sound EventBus integration). Go!