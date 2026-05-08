# Pachinball — Weekly Plan

## Today's focus
**2026-05-07 — Playwright Smoke Tests: Verify every `DisplayState` transition via `window.game`**
Add `tests/display-states.spec.ts` covering every `DisplayState` transition (IDLE → FEVER, IDLE → REACH, IDLE → JACKPOT, IDLE → ADVENTURE, and return paths). Tests drive transitions via `window.game.eventBus.emit()` and assert on `window.game.display.getDisplayState()`. This closes the last open Ideas item and provides a permanent regression harness for the display/event-bus system.

## Ideas
- [done — 2026-04-30] Backbox display state synchronization — FEVER triggered (combo>=10), REACH/JACKPOT/IDLE/ADVENTURE wired; GameStateManager drives IDLE on MENU/GAME_OVER. Full auto-sync folded into Event Bus task below.
- [done — 2026-04-30] BallManager unit tests — Vitest installed, 10 tests passing (PR #122). Config extraction piece carried to Backlog.
- [done — 2026-05-07] Event bus architecture — Replace the callback map in `GameStateManager` and scattered direct calls in `game.ts` with a lightweight typed event bus. Decouples display/effects/audio/scoring from the central game loop before the next feature layer.
- [done — 2026-05-07] Playwright smoke tests for backbox display states — verify each `DisplayState` transition (IDLE → FEVER, IDLE → JACKPOT, JACKPOT → IDLE) triggers the correct layer activation via `getDisplayState()` assertion.

## Backlog
- [ ] Stuck-ball detection — automatic reset when ball is stationary > 5 s (from `PHYSICS_AUDIT_MASTER.md`).
- [ ] Bounce light proximity response — ball-distance modulation for `bounceLight` intensity (from `LIGHTING_SHADOW_PP_AUDIT_REPORT.md`).
- [ ] Cabinet light exclusion lists — exclude non-cabinet meshes from LED PointLights (from `LIGHTING_SHADOW_PP_AUDIT_REPORT.md`).
- [ ] Rendering audit refresh — rewrite `RENDERING_AUDIT_REPORT.md` to reference `src/display/` and `src/materials/` instead of deleted `src/game-elements/display.ts`.
- [ ] Pin collar details + flipper grip texture — low-poly manufacturing detail (from `RENDERING_AUDIT_REPORT.md`).
- [ ] Playwright CI optimization — game init is ~30–40 s per test; consider shared page context or selective runs to reduce suite time from ~6 min to <2 min.

## Done
- 2026-05-07: **Sound System EventBus Integration** complete. `getSoundSystem(eventBus?)` now subscribes to `game:start`, `game:over`, `fever:start`, `jackpot:start`, `adventure:end`, and `display:set`. Added `SoundSystem.playBeep(freq)` for synthesized EventBus-driven beeps. Removed last direct `this.effects?.playBeep(440)` call from `game.ts` adventure END handler. All audio is now reactive via EventBus. `npx tsc -b` clean, `npm run build` passes, 51 Vitest tests green.
- 2026-05-07: **Config Extraction (second pass)** complete. Migrated remaining magic numbers from `game.ts` into `config.ts`: `cameraFollowTransitionSpeed`, `fogDensity`, `mirrorSize` (HIGH/MEDIUM), `mirrorTextureLevel`, `skyboxSize`, `uMapBlend`, `idleCallbackTimeoutMs`, `cosmeticFallbackDelayMs`. Removed unused `scanlineIntensity` class property. `npx tsc -b` clean.
- 2026-05-07: **Audit Reports Triage** complete. Reviewed 6 key audits (`PHYSICS_*`, `LIGHTING_*`, `MATERIAL_*`, `RENDERING_*`, `CAMERA_*`, `INPUT_*`). Created `docs/AUDIT_TRIAGE_2026-05-07.md` with implemented/partial/stale/open categorization, summary table, quick-win list, and re-audit recommendations. Physics ~60 %, Lighting ~70 %, Material ~80 %, Rendering ~50 % (with stale paths), Camera ~55 %, Input ~60 % implemented.
- 2026-05-07: **Event Bus Architecture** complete. `src/game/event-bus.ts` created (typed pub/sub, no deps). `GameStateManager` emits typed lifecycle + display events. `DisplaySystem.subscribeToEvents()` self-manages state. All 10 `setDisplayState` call sites in `game.ts` replaced with `eventBus.emit('display:set', ...)`. Gameplay events (`fever:start/end`, `jackpot:start/end`, `reach:start`, `adventure:start/end`) emitted at correct trigger sites. `npx tsc -b` clean, `npm run build` passes.
- 2026-05-07: **Quick Wins (Audit Triage)** — Implemented 3 items discovered during triage:
  - Wall friction unification: `object-walls.ts` now reads `GameConfig.ball.friction` instead of hardcoded `0.1`.
  - Physics contact skin: `game-elements/physics.ts` sets `integrationParameters.contactSkin = 0.005` (OP-5 from PHYSICS audit).
  - Shadow bias tuning: already existed in `game-renderer.ts` (`bias = 0.0005`, `normalBias = 0.02`).
  - CSS touch-action + non-QWERTY keys: already existed in `style.css` and `input.ts`.
- 2026-05-07: **Playwright Test Stabilization** — Fixed initialization-order bug: `soundSystem` must be created before `setupMapSelector()` (which calls `fetchMusicTracks`). Added comment in `display-states.spec.ts` documenting ~30–40 s per-test init time. Tests now pass in headless Chromium but full suite is slow (~6 min).
- 2026-05-07: **Vitest unit tests for EventBus + GameStateManager** — 41 tests now passing (15 event-bus, 26 game-state). Added alongside existing 10 ball-manager tests = 51 total.
- 2026-05-07: **3D floating score numbers, ball trails, impact flashes** (swarm iterations 6–7). `EffectsSystem.spawnFloatingNumber()` — DynamicTexture billboard, color-coded by value tier, pool of 8. Ball trails (`addBallTrail`, `removeBallTrail`, `updateTrails`) with velocity-proportional emit rate; disabled on LOW tier. `triggerImpactFlash()` pooled radial burst. Wired into game loop and all 7 score sites.
- 2026-05-07: **Decorative 3D geometry** (swarm iteration 8). Bumper neon rings (torus + pulsing animation on HIGH), chrome guide-pin merged mesh (1 draw call), cabinet side panel inlay (DynamicTexture gradient on HIGH / flat emissive on LOW).
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
Outcome: Full success + overrun. Event bus complete in iteration 5 (0 TS errors, build clean). Swarm continued through iterations 6–8: 3D floating score numbers, ball trails/impact flashes, and decorative bumper rings + guide pins + cabinet inlays. All merged. Docs moved to docs/ in a housekeeping commit (78c0a85). One Ideas item remains: Playwright smoke tests.

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
