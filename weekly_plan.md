# Pachinball — Weekly Plan

## Today's focus
**2026-04-17 — Finish & polish Gold Pachinko Balls integration (User Idea mode). ✅ DONE**
Polished and closed all remaining integration gaps: quality-tier-aware PBR materials, distinct solid-gold cabinet pulse, horizontal arc stack visual with threshold feedback, visible scoring popups, and per-game/session gold-ball state management.

## Ideas
- [x] Gold Pachinko Balls feature — Gold-Plated (common, ~20%, +1000/×2) and Solid Gold (rare, ~5%, +5000/×5) variants with PBR material differentiation, stacking/counting visual, scoring integration, and cabinet reaction effects. Spec below in "Feature spec — Gold Pachinko Balls".
- [x] Dedicated `onSolidGoldCollected` cabinet reaction distinct from `startJackpotSequence()` (per-event pulse vs. mode).
- [x] Quality-tier-aware material variants: verify iridescence/clear-coat only engage on HIGH tier, gold still reads as gold on LOW.

## Backlog
- [ ] Formal game state machine + event bus (carried from PLAN.md / GPT architectural notes — IDLE/PLAYING/MODE/GAME_OVER transitions, event-driven subscribers for display/effects/audio).
- [ ] Gameplay tuning/config extraction — migrate remaining magic numbers (bumper force, flipper impulse, scoring thresholds) into `config.ts`.
- [ ] Backbox display system — layered video/image/shader/reels with per-state overrides (per PROJECT CONTEXT active focus).
- [ ] Debug HUD overlay — state, physics step, active balls, scores, multipliers, mode timers.
- [ ] Unit test coverage for BallManager type assignment, scoring, and drain lifecycle.
- [ ] Numerous audit reports in repo root (PHYSICS_*, LIGHTING_*, MATERIAL_*, INPUT_*, CAMERA_*) — triage which still reflect current code vs. stale.

## Done
- 2026-04-17: **Gold Pachinko Balls polish complete.**
  - `src/materials/material-ball.ts` — clear coat and iridescence now gated by `QualityTier.HIGH`; LOW tier retains strong albedo/metallic so gold still reads as gold.
  - `src/effects/effects-core.ts` — added `startSolidGoldPulse()` (~1.5 s bloom + gold→magenta cabinet lighting + chime + vignette), respecting `reducedMotion`.
  - `src/game.ts` — solid-gold drains now trigger `startSolidGoldPulse()` instead of the full 10-second jackpot sequence; added floating `+points` messages; `startGame()` resets `goldBallStack` and `ballStackVisual`; added `sessionGoldBalls` counter/badge.
  - `src/game-elements/ball-stack-visual.ts` — redesigned as a horizontal arc meter with threshold pop-in flash near jackpot (8+ balls) and solid-gold sorting to the front.
  - Type-check (`npx tsc -b`) and Playwright smoke test both pass.
- 2026-04-17: Moved Gold Pachinko Balls scaffolding into the Done-adjacent "in progress" slot after discovering it's substantially built in `src/config.ts` (BallType/BALL_TIERS), `src/game-elements/ball-manager.ts` (spawn/collect/callback, L42–L806), `src/game-elements/ball-stack-visual.ts`, `src/materials/material-ball.ts`, and `src/game.ts` (L1181 onGoldBallCollected wiring). Polish/verify phase, not build phase.
- 2026-03-21 (PR #115/#114): TypeScript error cleanup across adventure-mode, ball-manager, mag-spin-feeder, nano-loom-feeder, prism-core-feeder.
- 2026-03-20 (PR #110): Lighting/shadow/post-processing audit improvements — SSAO2, FXAA, ACES, bloom tune, DoF, atmosphere state system.
- 2026-03-19 (PR #109): Hardware-adaptive quality tiers, advanced PBR (anisotropy/sheen/iridescence/clear-coat), bumper state system.
- 2026-02-25 (PR #106): Adventure track switching + dual-screen display integration.

## Last run
Date: 2026-04-17
Mode: User Idea
Focus: Finish & polish Gold Pachinko Balls integration
Outcome: Complete. All 5 integration points verified/closed. Type-check clean. Playwright smoke test passing.

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
