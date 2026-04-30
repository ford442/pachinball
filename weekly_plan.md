# Pachinball — Weekly Plan

## Today's focus
**2026-04-30 — Event Bus Architecture: Replace callback map in `GameStateManager` with a typed pub/sub event bus**
Wire a lightweight, fully-typed `EventBus` that lets `DisplaySystem`, `EffectsSystem`, and audio subscribe to game events rather than receiving direct calls from `game.ts`. This closes the remaining architectural gap left by last week's backbox sync work and removes the scatter of `this.display?.setDisplayState(...)` call sites from `game.ts`.

## Ideas
- [done — 2026-04-30] Backbox display state synchronization — FEVER triggered (combo>=10), REACH/JACKPOT/IDLE/ADVENTURE wired; GameStateManager drives IDLE on MENU/GAME_OVER. Full auto-sync folded into Event Bus task below.
- [done — 2026-04-30] BallManager unit tests — Vitest installed, 10 tests passing (PR #122). Config extraction piece carried to Backlog.
- [in progress — 2026-04-30] Event bus architecture — Replace the callback map in `GameStateManager` and scattered direct calls in `game.ts` with a lightweight typed event bus. Decouples display/effects/audio/scoring from the central game loop before the next feature layer.
- [ ] Playwright smoke tests for backbox display states — verify each `DisplayState` transition (IDLE → FEVER, IDLE → JACKPOT, JACKPOT → IDLE) triggers the correct layer activation via `getDisplayState()` assertion.

## Backlog
- [ ] Config extraction — migrate remaining magic numbers (bumper force, flipper impulse, combo thresholds, scoring values) from `game.ts` into `config.ts`. Partially deferred from BallManager unit tests + config idea.
- [ ] Formal game state machine — `GameStateManager` in `src/game/game-state.ts` has callbacks but no event bus. Effects field commented out as UNUSED. Full subscriber-based wiring is today's task.
- [ ] Audit reports in repo root (PHYSICS_*, LIGHTING_*, MATERIAL_*, INPUT_*, CAMERA_*) — triage which still reflect current code vs. stale. No one has looked at these since March.
- [ ] Unit test coverage gap — Playwright smoke test (`tests/verify_prism_core.spec.ts`) + BallManager Vitest tests exist; display system, effects, and GameStateManager have zero test coverage.

## Done
- 2026-04-30: **Backbox Display System — Game↔Display state sync & FEVER layer** substantially complete. FEVER trigger wired (combo>=10, line 2954 `game.ts`). REACH/JACKPOT/ADVENTURE/IDLE all have call sites. GameStateManager drives IDLE on MENU/GAME_OVER transitions. Full architectural auto-sync promoted to Event Bus task (today).
- 2026-04-30: **BallManager Vitest unit tests** — 10 tests, all passing, Vitest installed (PR #122 merged 2026-04-30). Config extraction deferred to Backlog.
- 2026-04-23: **Debug HUD overlay** marked done (PR #118 merged 2026-04-17). Re-enabled and modernized: snapshot boundary, throttled updates, developer settings toggle. Files: `src/game-elements/debug-hud.ts`, `src/game.ts`, `index.html`.
- 2026-04-17: **Gold Pachinko Balls polish complete.**
  - `src/materials/material-ball.ts` — clear coat and iridescence gated by `QualityTier.HIGH`; LOW tier retains gold read.
  - `src/effects/effects-core.ts` — `startSolidGoldPulse()` (~1.5 s bloom + gold→magenta cabinet lighting + chime + vignette), respecting `reducedMotion`.
  - `src/game.ts` — solid-gold drains trigger `startSolidGoldPulse()`; floating `+points` messages; `startGame()` resets `goldBallStack` / `ballStackVisual`; `sessionGoldBalls` counter/badge.
  - `src/game-elements/ball-stack-visual.ts` — horizontal arc meter with threshold pop-in flash (8+ balls), solid-gold sorting to front.
  - Type-check (`npx tsc -b`) and Playwright smoke test pass.
- 2026-04-17: Moved Gold Pachinko Balls scaffolding into Done after discovering it's substantially built in `src/config.ts`, `src/game-elements/ball-manager.ts`, `src/game-elements/ball-stack-visual.ts`, `src/materials/material-ball.ts`, and `src/game.ts` L1181.
- 2026-03-21 (PR #115/#114): TypeScript error cleanup across adventure-mode, ball-manager, mag-spin-feeder, nano-loom-feeder, prism-core-feeder.
- 2026-03-20 (PR #110): Lighting/shadow/post-processing audit improvements — SSAO2, FXAA, ACES, bloom tune, DoF, atmosphere state system.
- 2026-03-19 (PR #109): Hardware-adaptive quality tiers, advanced PBR (anisotropy/sheen/iridescence/clear-coat), bumper state system.
- 2026-02-25 (PR #106): Adventure track switching + dual-screen display integration.

## Last run
Date: 2026-04-30
Mode: User Idea
Focus: Event Bus Architecture — typed pub/sub replacing `GameStateManager` callback map and scattered `game.ts` display call sites
Outcome: (fill in at end of day)

---

## Feature spec — Gold Pachinko Balls

(Preserved from the original weekly_plan.md; source of today's User Idea.)

### Visual Variants

**Gold-Plated Balls** — lighter, more reflective; high metallic, lower roughness, subtle yellow/warm tone. Common premium variant, standard bonus points.

**Solid Gold Balls** — deeper richer gold; rich yellow-gold albedo, higher metallic saturation, controlled roughness, strong warm reflectivity. Rare jackpot variant, high-value scoring moment.

### Implementation anchors (already in code)
- `src/config.ts` — `BallType` enum + `BALL_TIERS` (spawn rate, bonus points, multiplier).
- `src/materials/material-ball.ts` — PBR variants (verify per quality tier).
- `src/game-elements/ball-manager.ts` — `createBallOfType`, `getMaterialForType`, `collectBall`, `onGoldBallCollected` callback, `goldBallCount`.
- `src/game-elements/ball-stack-visual.ts` — accumulation visual.
- `src/game/game-ui.ts` — gold ball counter HUD element.
- `src/game.ts` L1181 — wires `setOnGoldBallCollected`.
- `src/effects/effects-core.ts` L602 — `startJackpotSequence` currently reused for gold events.

### Remaining integration points to verify/finish
1. ~~PBR quality across tiers~~ — Done: LOW tier still reads as gold; HIGH tier engages iridescence/clear-coat where defined.
2. ~~Cabinet reaction differentiation~~ — Done: `startSolidGoldPulse()` replaces reused jackpot mode for SOLID_GOLD.
3. ~~Stacking feedback~~ — Done: horizontal arc meter with threshold pop-in animation and flash.
4. ~~Scoring integration~~ — Done: bonus points flow through main score path with floating `+points` UI feedback.
5. ~~Game-state reactivity~~ — Done: per-game reset in `startGame()`, plus a persistent session counter/badge.
