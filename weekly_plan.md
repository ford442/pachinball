# Pachinball — Weekly Plan

## Today's focus
**2026-04-23 — Backbox Display System: Game↔Display State Sync & FEVER Layer (New Idea mode)**
Wire `GameStateManager` transitions to automatically drive `DisplaySystem.setDisplayState()`, trigger the currently-silent `DisplayState.FEVER` from its correct game event, and verify all 4 display layers (video/image/shader/reels) respond correctly to every state. The scaffold is complete; the binding is the gap.

## Ideas
- [in progress — 2026-04-23] Backbox display state synchronization — `GameStateManager` state transitions don't auto-drive `DisplaySystem`; `DisplayState.FEVER` is configured but never triggered in `game.ts`. Wire the two systems, close the FEVER gap, verify per-state layer overrides end-to-end.
- [ ] Event bus architecture — Replace the callback map in `GameStateManager` and scattered direct calls in `game.ts` with a lightweight typed event bus. Decouples display/effects/audio/scoring from the central game loop before the next feature layer.
- [ ] BallManager unit tests + config extraction — Add Vitest for pure-TS unit tests of BallManager type assignment, scoring bonuses, and drain lifecycle. Simultaneously extract remaining magic numbers from `game.ts` into `config.ts`.

## Backlog
- [ ] Formal game state machine + event bus — `GameStateManager` in `src/game/game-state.ts` exists with callbacks but no event bus. Effects field is commented out as UNUSED. Full subscriber-based wiring deferred.
- [ ] Gameplay tuning/config extraction — migrate remaining magic numbers (bumper force, flipper impulse, scoring thresholds) into `config.ts`.
- [ ] Backbox display system — scaffold complete (~1292 lines, 7 files in `src/display/`); ADVENTURE/IDLE/JACKPOT/REACH manually wired in `game.ts` (8 call sites); FEVER dark; `GameStateManager`↔`DisplaySystem` auto-sync missing. **Active today.**
- [ ] Unit test coverage for BallManager type assignment, scoring, and drain lifecycle. No Vitest installed; only Playwright smoke test (`tests/verify_prism_core.spec.ts`) exists.
- [ ] Audit reports in repo root (PHYSICS_*, LIGHTING_*, MATERIAL_*, INPUT_*, CAMERA_*) — triage which still reflect current code vs. stale.

## Done
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
Date: 2026-04-23
Mode: New Idea
Focus: Backbox Display System — Game↔Display state sync, FEVER layer completion
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
