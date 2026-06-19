# Pachinball — Weekly Plan

## Today's focus
**2026-06-18 — User Idea: Slot Machine Mini-Game (#261)**
Foundation is healthy — last week's Fix First (#241 flipper/plunger actuation) **landed**: `soundSystem.playSample('flipper')` now sits *inside* the `if (joint)` guard in `game-input-actions.ts` (lines 99–103, 139–143), the plunger uses a guarded direct `applyImpulse`, PR #263's in-browser session confirms flippers + plunger respond, and `npm test` is at 378 passing with a clean build. Not Fix First. Noah filed four detailed PLAN.md-driven enhancement issues on 2026-06-16 (#259–#262) — his current in-context headspace, the "Cyber-Shock" pachinko-authentic thrust. Of those, **#259 Mag-Spin Feeder is already built** (all 5 feeders exist with complete state machines), **#260 Multi-Layered Display is mostly built** (display-image/reels/shader/video/overlay/border-glow all live), and **#262 Jackpot Sequence is partial** (`src/shaders/jackpotOverlay.ts` exists). **#261 Slot Machine Mini-Game is the genuinely greenfield piece** and can build on the existing `src/display/display-reels.ts` reel-render infra. Today: stand up a self-contained 3-reel slot mini-game (`src/display/slot-machine.ts`) — config-driven symbols/paylines, variable-speed spins with staggered stops, win detection, audio + cabinet-light sync via EventBus, activation on Reach/Fever. **Do not touch** the feeder system (`*-feeder.ts`), the physics controller, the cabinet-builder presets, the campaign reward modules, or `zone-trigger-system.ts` (that's the decoupled Copilot lane — see issue draft B).

## Ideas
- [done — 2026-04-30] Backbox display state synchronization — FEVER triggered (combo>=10), REACH/JACKPOT/IDLE/ADVENTURE wired; GameStateManager drives IDLE on MENU/GAME_OVER. Full auto-sync folded into Event Bus task below.
- [done — 2026-04-30] BallManager unit tests — Vitest installed, 10 tests passing (PR #122). Config extraction piece carried to Backlog.
- [done — 2026-05-07] Event bus architecture — Replace the callback map in `GameStateManager` and scattered direct calls in `game.ts` with a lightweight typed event bus. Decouples display/effects/audio/scoring from the central game loop before the next feature layer.
- [done — 2026-05-07] Playwright smoke tests for backbox display states — verify each `DisplayState` transition (IDLE → FEVER, IDLE → JACKPOT, JACKPOT → IDLE) triggers the correct layer activation via `getDisplayState()` assertion.
- [done — 2026-05-28] Multi-layer parallax breathing + reel spring refinement — all 4 display layers have `updateParallax()` with staggered phases (π/2, π/4, 3π/4, π); `display-core.ts` wired all four. Spring refined: stiffness=90, damping=4.0, named constants extracted.
- [done — 2026-05-29] Adventure-mode obstacle lifecycle audit — completed in commit `c287a31` (+16 tests): fixed trap timeout release scoring, `gate:triggered` emission, goal-tracker wiring, `clearObstacleZones()`, supervisor `dispose()` alias. Two orchestrator gaps surfaced and promoted to today's Fix First focus (track-switch rebuild) + Backlog (cinematic/UI reset on switch).
- [done — 2026-05-29] Hologram fresnel rim + FEVER pulse — landed via PR #192 (view-dependent fresnel rim glow on backbox border + gold balls during FEVER).
- [done — 2026-06-04] Adventure track-switch teardown + rebuild wiring — `onTrackAdvanced` now wired in `game-systems-init.ts:259` → `slotAdventure.switchToTrack()` → `adventureMode.switchToTrack()` + `physicsController.rebuildHandleCaches()`, with `onTrackStart` cinematic + `adventureUIStateManager.reset()` both fired on switch (the two carried Backlog follow-ups). Portal jumps now rebuild the playfield.
- [done — 2026-06-18] Campaign reward surfacing — landed via PR #251 (`campaign-reward-notifier.ts` + `celebration-sequencer.ts`). Unlock notification + celebration sequence wired through backbox display + cabinet lighting on track-completion reward grants.
- [ ] C++ WASM physics engine bring-up — the Emscripten scaffold (PR #167) is idle; wire a `localStorage` feature-flag A/B path against Rapier for the ball/bumper subset, with a parity test harness. (multi-day) [new idea, 2026-06-04]
- [in progress — 2026-06-18] Slot Machine Mini-Game (#261) — 3-reel slot bonus on the backbox, variable-speed spins, win detection (Triple 7 jackpot, Diamond Rush 5×, near-miss), audio + cabinet light sync, activation on Reach/Fever. Greenfield; leans on existing `display-reels.ts`. (full-day → multi-day) [user issue, 2026-06-16] — **today's focus**
- [ ] Multi-Layered Backbox Display depth pass (#260) — display layer stack is mostly built (image/reels/shader/video/overlay/border-glow); remaining gap is true Layer-1 physical/background depth + per-state (Idle/Reach/Fever) content routing. (full-day) [user issue, 2026-06-16]
- [ ] Phased "Cyber-Shock" Jackpot Sequence (#262) — `jackpotOverlay.ts` shader scaffold exists; build the 10 s 3-phase (Breach/Critical/Meltdown) narrative with glitch/crack/shockwave uniforms, escalating audio + cabinet sync. Depends on #260 Layer-3 overlay. (multi-day) [user issue, 2026-06-16]

## Backlog
- [ ] **Zero-score bug — collider/body handle-space mismatch (issue #266)** — UPGRADED from "scoring-zone coverage." Root cause found via code investigation: `drainCollisionEvents` yields **collider** handles (`physics.ts:168`) but `GamePhysicsController` compares them against **rigid-body** handle sets (`bumperHandleSet` etc., built from `RigidBody.handle` at `:257`) and calls `world.getRigidBody()` on them (`:444`). Bumpers have 2 colliders/body so the index spaces diverge → no collision-dispatch branch matches → `handleBumperCollision`→`awardScore` never fires → score stays 0. Drain still works (position-based in BallManager), matching PR #263. Fix: resolve collider→parent body handle at the event boundary in `processCollision` + `processContactForce`. Filed as **#266** (the decoupled Copilot lane, supersedes dispatch §B draft). Note: the Gemini/Grok/Kimi analyses correctly said "instrument first, both-zero = pipeline bug" but mis-guessed the mechanism as ActiveEvents/sensor config (those are fine). [added 2026-06-18]
- [ ] **Close/repurpose stale issue #259 (Mag-Spin Feeder)** — the issue claims "no feeder mechanics yet," but all 5 feeders already exist with complete state machines (`mag-spin-feeder.ts` 346 LOC + gauss-cannon/nano-loom/prism-core/quantum-tunnel). Either close #259 or repurpose it as a PLAN.md §5 alignment/polish audit (verify catchRadius/spinDuration/releaseForce match spec, no stuck balls, both renderers). [added 2026-06-18]
- [ ] **`.swarm-state.md` is now stale** — the file currently holds the OLD 2026-05-21 display-polish swarm state, not the feedback-layer state. The previously-flagged over-reports (`src/game/live-hud-overlay.ts`, `src/game/sound-manager.ts`) remain **absent** → confirmed never landed; treat as dropped. Today's kimi-cli run will overwrite this file fresh. [updated 2026-06-18]
- [ ] **WGSL slot-reel shader vs canvas fallback** — slot mini-game (#261) should render reels via WGSL on WebGPU with a canvas-texture fallback, mirroring `display-shader.ts`. Track if kimi-cli stubs the shader path. [added 2026-06-18]
- [ ] CRT scanline enhancement — temporal flicker already in `src/shaders/scanline.ts` (lines 38–40) and a `clampScanlineIntensity(presetBase, scanlineWeight, accessibilityFactor)` helper exists; remaining gap is per-preset intensity tuning and a UI toggle. Low priority.
- [ ] Verify issue #131 closed (flipper visibility regression from PR #159 — not explicitly confirmed closed; check before next Copilot PR in that area). Note: GitHub issue list currently returns 0 open issues, so likely closed — confirm.
- [ ] Reconcile the Phase 1–4 "playable core loop" Copilot work (#206–#211) against the campaign/adventure systems — both now load tables/levels; confirm there is one canonical level-load path, not two divergent ones (free-map test mode vs adventure track switch).

## Next Sprint Ideas (May 9+)
- [done — 2026-05-21] Input buffering improvements — `queueInput` / `PendingInputFrame` system fully implemented in `src/game-elements/input.ts` (lines 10, 126–206, 331–493).
- [done — 2026-05-21] Mobile touch controls — HTML buttons (index.html L137–162), CSS (style.css L232–546), and event handlers (input.ts L525–670) all live.
- [done — 2026-05-21] Backbox screen border lighting — `BackboxBorderGlow` implemented and tested (PR #138 + PR #147).

## Done
- 2026-06-18: **Flipper + plunger actuation fix (#241) — verified landed** (last week's Fix First). `soundSystem.playSample('flipper')` + haptics now sit *inside* the `if (joint)` guard in `game-input-actions.ts` (L99–103 left, L139–143 right); plunger uses a guarded direct `applyImpulse` on `ballManager.getBallBody()`. PR #263's in-browser session confirms flippers + plunger respond with correct physics; `npm test` 378 passing, `npm run build` clean, lint 0 errors. Foundation restored.
- 2026-06-18: **Campaign reward surfacing — landed** (PR #251, merged 2026-06-11). `campaign-reward-notifier.ts` + `celebration-sequencer.ts` shipped: track-completion reward grants now fire an unlock notification + celebration sequence through the backbox display + cabinet lighting (replacing the prior silent skin/theme application). Tests added for LOW-tier + campaign-complete celebration paths.
- 2026-06-18: **Feedback-layer branch merged to main** (PR #249, 2026-06-11) — combo/ball-save/bonus-tally modules from `claude/serene-dirac-gx60b7` are now on `main`. Backlog merge item resolved.
- 2026-06-18: **Copilot issue sweep #243–#248 landed** — gold-ball swarm spawn with quick-collect bonus (#243), fever multipliers on gold scoring (#244), Playwright keyboard-path flipper/plunger regression (#245), Rapier interpolation alpha for dynamic body meshes (#246), debug-HUD campaign-loop fields (#247), `portal:open` guard against failed `activateExitPortal()` (#248). #242 WebGL2 fallback confirmed working via PR #263.
- 2026-06-11: **Core-loop scoring & feedback cohesion pass** (last run's New Idea) — landed on `claude/serene-dirac-gx60b7` (commit `2377a61`). Three pillars shipped as pure-logic modules + Vitest: `combo-multiplier-system.ts` (rolling 2.5 s window, +1× per 2 hits, cap 5×, resets on idle/drain), `ball-save-system.ts` (7 s post-launch grace, one-time respawn at plunger), `bonus-tally-system.ts` (end-of-ball sweep: chain + gold-collect + 250-pt peak-combo bonus). Config `feedback` block + new EventBus event types added; wired through `game-physics-controller.ts`, `ball-manager.ts`, `game.ts`. Per `.swarm-state.md`: `tsc -b` + lint clean, 321 Vitest passing, Vite build OK. **Caveats:** (1) NOT yet merged to `origin/main` — see Backlog merge item. (2) `.swarm-state.md` additionally claims a Live HUD Overlay + Sound Manager refactor landed 2026-06-05 — those files are **absent** and that work did NOT land (see Backlog).
- 2026-06-04: **Adventure track-switch teardown + rebuild wiring** (last week's Fix First) — landed. `onTrackAdvanced` callback wired in `game-systems-init.ts:259` drives `slotAdventure.switchToTrack(nextTrackId)` → `adventureMode.switchToTrack()` + `physicsController.rebuildHandleCaches()`. `switchToTrack` (`game-slot-adventure.ts:205`) also fires `adventureCinematicTriggers.onTrackStart()` and `adventureUIStateManager.reset()` (the two carried Backlog follow-ups) plus re-inits goal tracker + supervisor timer. Portal jumps now physically rebuild the playfield. Also confirmed: PR #193 merged (input-handler test fix), `origin/main` is current (stale-main backlog item resolved), GitHub shows 0 open issues / 0 open PRs.
- 2026-05-29: **Adventure-mode obstacle lifecycle audit** — landed via commit `c287a31` ("Fix all 5 obstacle lifecycle audit bugs + add 16 targeted tests") and `20ba192` (hit-flash emissive bursts). Verified in code: `trap:ball:released` + `points:awarded` on timeout release (`object-ball-traps.ts`), `gate:triggered` emission (`object-moving-gates.ts`), goal-tracker wiring (`adventure-goal-tracker.ts:38-39`), `ZoneTriggerSystem.clearObstacleZones()` (`zone-trigger-system.ts:458`), supervisor `dispose()` alias. Full scoring-wiring matrix verified (spinner/trap/launcher/gate all → `points:awarded` → `GamePhysicsController`). Audit notes in `.swarm-state.md`. Two orchestrator gaps surfaced → today's Fix First + Backlog.
- 2026-05-29: **Hologram fresnel rim + FEVER pulse** — PR #192 merged. View-dependent fresnel rim glow on the backbox border and on gold balls during FEVER state.
- 2026-05-28: **Multi-layer parallax breathing + reel spring refinement** — all 4 display layers (`display-reels`, `display-image`, `display-video`, `display-shader`) have `updateParallax(time)` with staggered phase offsets (π/2, π/4, 3π/4, π) and independent periods (3.5 s, 2.0 s, 3.0 s, 4.5 s). `display-core.ts` calls all four each frame. Spring refined: stiffness 90, damping 4.0, snap thresholds named as constants.
- 2026-05-21: **Input buffering** — `queueInput` / `PendingInputFrame` frame-aligned input queue implemented in `input.ts` lines 10–493. Covers keyboard, gamepad, and touch with consistent frame-boundary processing.
- 2026-05-21: **Mobile touch controls** — Full on-screen flipper/plunger/nudge button set in `index.html` (L137–162), styled in `style.css` (L232–546), event-wired in `input.ts` (L525–670). Safe-area insets + `touch-action: manipulation` for low-latency response.
- 2026-05-21: **Backbox screen border lighting** — `BackboxBorderGlow` (`src/display/display-border-glow.ts`, 157 lines) with DisplayState-reactive emissive animation. Unit tests added (PR #147). BackboxBorderGlow merged via PR #138.
- 2026-05-08: **Advanced Ball Physics: Spin Mechanics & Surface Behavior** — Comprehensive ball physics system with spin transfer, surface-specific behaviors, and gold ball differentiation. Implemented `applySpinTransfer()` method applying "English" (side spin) from angled collisions. Added surface-specific configs (bumper/flipper/wall/playfield/rail) with unique restitution/friction pairs. Enhanced collision handlers for bumper and flipper interactions with spin transfer. Gold balls now have differentiated mass (1.08–1.15×), damping, and restitution. Rapier `CoefficientCombineRule.Max` for better restitution handling. All 51 Vitest tests passing.
- 2026-05-08: **Advanced Flipper Mechanics: Hold-Time Response & Collision Handling** — Dynamic flipper strength based on button hold duration (ramp up over 0.3s). Reduced active angle from π/6 to π/8 (30° to 22.5°) for snappier feel. Added flipper-ball collision detection with impact feedback and spin transfer. Hold-time multipliers: stiffness × (1.0 + holdFactor × 0.3), damping × (0.9 + holdFactor × 0.1). Enhanced collision response with better haptic/audio feedback. All 51 Vitest tests passing.
- 2026-05-08: **Physics Optimizations: Flipper Snap & Ball Differentiation** — Core physics tuning for improved gameplay feel. Snappier flipper active angle (π/8 vs π/6). Increased bumper restitution from 0.85 to 0.92 for more "pop". Differentiated ball physics: gold-plated +8% mass/-8% damping/+2% restitution/-5% friction; solid gold +15% mass. Added `kickVariationFactor` for future impulse-based improvements. Bumper restitution now uses config value. All 51 Vitest tests passing.
- 2026-05-08: **Reactive Cabinet Lighting (Bonus Feature)** — Premium RGB LED-style effects for immersive gameplay. Created `CabinetLighting` system with 5 pooled PointLights (4 edge + 1 under-cabinet). Color-coded state responses: IDLE→deep blue, FEVER→gold/orange, JACKPOT→bright cyan, REACH→magenta, ADVENTURE→purple+cyan. Smooth color transitions (3 transitions/sec), pulsing animation (sine wave), and event-driven bursts on fever/jackpot/adventure. EventBus integration for reactive feedback. QualityTier support. Performant (5 lights total). All 51 Vitest tests passing.
- 2026-05-08: **Adventure Track Polish (Priority 3)** — Cinematic camera transitions with easing. Created `camera-easing.ts` with 6+ easing functions (linear, easeInOutCubic, easeOutCubic, easeOutQuad, easeInOutElastic, easeOutBack). Added camera transition state tracking (`cameraTransitionTime`, `cameraTransitionDuration = 0.8s`). Enhanced camera smoothing in `updateCamera()` to apply easing during track entry—starts at 50% smoothing, ramps to 100% over 0.8s via easeOutCubic. Reset transition timer on track entry (`start()`) and zone switches (`switchZone()`). Fine-tuned `trackingSmoothing` in camera presets (5.5–8.0) for better responsiveness. All 51 Vitest tests passing.
- 2026-05-08: **Performance Profiling (Priority 2)** — Lightweight real-time performance monitoring. Created `PerformanceMonitor` class tracking FPS, frame time, physics step time, render time, draw calls, and active bodies. Integrated into game loop with `frameStart()`, `physicsStart()`, `physicsEnd()`, `frameEnd()` calls. Added keyboard shortcut (P) to toggle performance monitoring. When enabled, metrics display in debug HUD (` key to show). Optional console logging via `localStorage.setItem('debug:perf-log', 'true')`. Added `getActiveBodyCount()` to `PhysicsSystem`. Metrics buffered over ~1 second for smooth averaging. All 51 Vitest tests passing.
- 2026-05-08: **Modern Screen Enhancement (Priority 1)** — Modern LCD/OLED aesthetic for backbox display. Added `MODERN_LCD` preset with soft grid lines, gentle bloom, minimal vignette, and zero chromatic aberration. Enhanced CRT shader with improved bloom algorithm for bright elements and modern color grading (saturation boost, warm tone, contrast via S-curve). Enabled modern LCD effect by default. Added keyboard shortcut (T) to cycle between presets (MODERN_LCD → RETRO → STORY → OFF). Created `setCRTEffectParams()` method in `DisplaySystem`. All 51 Vitest tests passing.
- 2026-05-07: **Sound System EventBus Integration** complete. `getSoundSystem(eventBus?)` now subscribes to `game:start`, `game:over`, `fever:start`, `jackpot:start`, `adventure:end`, and `display:set`. Added `SoundSystem.playBeep(freq)` for synthesized EventBus-driven beeps. Removed last direct `this.effects?.playBeep(440)` call from `game.ts` adventure END handler. All audio is now reactive via EventBus. `npx tsc -b` clean, `npm run build` passes, 51 Vitest tests green.
- 2026-05-07: **Config Extraction (second pass)** complete. Migrated remaining magic numbers from `game.ts` into `config.ts`: `cameraFollowTransitionSpeed`, `fogDensity`, `mirrorSize` (HIGH/MEDIUM), `mirrorTextureLevel`, `skyboxSize`, `uMapBlend`, `idleCallbackTimeoutMs`, `cosmeticFallbackDelayMs`. Removed unused `scanlineIntensity` class property. `npx tsc -b` clean.
- 2026-05-07: **Audit Reports Triage** complete. Reviewed 6 key audits (`PHYSICS_*`, `LIGHTING_*`, `MATERIAL_*`, `RENDERING_*`, `CAMERA_*`, `INPUT_*`). Created `docs/AUDIT_TRIAGE_2026-05-07.md` with implemented/partial/stale/open categorization, summary table, quick-win list, and re-audit recommendations. Physics ~60 %, Lighting ~70 %, Material ~80 %, Rendering ~50 % (with stale paths), Camera ~55 %, Input ~60 % implemented.
- 2026-05-07: **Event Bus Architecture** complete. `src/game/event-bus.ts` created (typed pub/sub, no deps). `GameStateManager` emits typed lifecycle + display events. `DisplaySystem.subscribeToEvents()` self-manages state. All 10 `setDisplayState` call sites in `game.ts` replaced with `eventBus.emit('display:set', ...)`. Gameplay events (`fever:start/end`, `jackpot:start/end`, `reach:start`, `adventure:start/end`) emitted at correct trigger sites. `npx tsc -b` clean, `npm run build` passes.
- 2026-05-08: **Phase 2 Sprint** — Lighting & material polish:
  - **Bounce light proximity response** — Already implemented in `effects-core.ts` (lines 378–384). Dynamic intensity modulation based on ball distance to `bounceLight` with smooth lerp. No code change needed.
  - **Cabinet light exclusion lists** — Added `updateCabinetLightExclusions()` to `GameCabinetBuilder`. Excludes `lcdGround`, `flipperGlow`, and ball meshes from cabinet neon `PointLight`s. Called from `game.ts` after `buildCriticalScene()`.
  - **Glass refraction enhancement** — Added `subSurface.isRefractionEnabled` + `refractionIntensity = 0.8` to `getSmokedGlassMaterial()` in `material-interactive.ts`, gated by `QualityTier.HIGH`.
  - **Playfield normal map** — Already implemented in `getPlayfieldMaterial()` (`material-structural.ts`). Procedural `createGridNormalTexture()` is applied when quality tier is not LOW, with `bumpTexture.level = 0.3`. Additional `createGridRoughnessTexture()` on HIGH tier. No code change needed.
- 2026-05-08: **May 8 Sprint** — Closed remaining high-priority backlog items:
  - **Stuck-ball detection** — Already fully implemented in `BallManager.updateStuckDetection()` (velocity threshold 0.1, timeout 5.0 s, out-of-bounds detection). Wired into `game-physics-controller.ts`. No code change needed; verified existing logic.
  - **Rendering audit refresh** — Rewrote `docs/RENDERING_AUDIT_REPORT.md` to reference current file structure (`src/display/`, `src/materials/`, `src/effects/`, `src/objects/`). Added "Status as of May 2026" section marking implemented features (trails, particles, bumper pulse, anisotropy, fog, clear-coat). Removed all references to deleted `src/game-elements/display.ts` and `src/game-elements/material-library.ts`.
  - **Pin collar + flipper grip** — Already implemented. Pachinko pins have base bevel torus rings (`object-pachinko.ts` lines 85–91). Flippers have side bevels, pivot caps, and pivot ring details (`object-flippers.ts` lines 82–146).
- 2026-05-07: **Quick Wins (Audit Triage)** — Implemented 3 items discovered during triage:
  - Wall friction unification: `object-walls.ts` now reads `GameConfig.ball.friction` instead of hardcoded `0.1`.
  - Physics contact skin: `game-elements/physics.ts` sets `integrationParameters.contactSkin = 0.005` (OP-5 from PHYSICS audit).
  - Shadow bias tuning: already existed in `game-renderer.ts` (`bias = 0.0005`, `normalBias = 0.02`).
  - CSS touch-action + non-QWERTY keys: already existed in `style.css` and `input.ts`.
- 2026-05-08: **Phase 1 Sprint** — Playwright optimization + visual polish:
  - **Playwright CI optimization** — Restructured `display-states.spec.ts` to use single shared browser context (`beforeAll` + `test.describe.configure({ mode: 'serial' })`). Game initializes once, all 10 state-transition tests run sequentially in the same page. Suite time reduced from ~6 min to **~1.7 min** (3.5× faster).
  - **Bumper burst effects** — Already fully implemented. Bumper hits trigger: `spawnEnhancedBumperImpact`, `spawnBumperSpark`, `spawnImpactRing`, `triggerImpactFlash`, `spawnFloatingNumber`, `playBeep`, camera shake, haptic feedback, and lighting mode change. No code change needed.
  - **Cabinet beveled edges** — Already fully implemented. `GameCabinetBuilder.createEnhancedCabinet()` creates chrome trim strips, LED accent strips, apron trim, and side panel inlays (DynamicTexture gradient on `QualityTier.HIGH`, flat emissive on lower tiers). No code change needed.
- 2026-05-07: **Playwright Test Stabilization** — Fixed initialization-order bug: `soundSystem` must be created before `setupMapSelector()` (which calls `fetchMusicTracks`). Tests now pass in headless Chromium.
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
Date: 2026-06-18
Mode: User Idea
Focus: Slot Machine Mini-Game (#261) — stand up a self-contained 3-reel slot bonus (`src/display/slot-machine.ts`) leaning on existing `display-reels.ts`; config-driven symbols/paylines, variable-speed staggered spins, win detection, audio + cabinet-light sync via EventBus, activation on Reach/Fever.
Outcome: (fill in at end of day)

---

### Prior run — 2026-06-11
Date: 2026-06-11
Mode: Fix First
Focus: Restore flipper + plunger physics actuation (issue #241) — sound/haptic calls sat outside the `if (joint)` guard in `game-input-actions.ts`, so controls fired audio but never drove the Rapier motor/impulse.
Outcome: Done (verified 2026-06-18). `playSample`/haptics moved inside the `if (joint)` guard; plunger uses guarded direct `applyImpulse`. PR #263 in-browser session confirms flippers + plunger respond; 378 tests pass, build clean. Also this week: feedback-layer branch merged (PR #249), campaign reward surfacing landed (PR #251), Copilot sweep #243–#248 landed. Noah filed 4 PLAN.md feature issues (#259–#262).

---

### Prior run — 2026-06-04
Date: 2026-06-04
Mode: New Idea
Focus: Core-loop scoring & feedback cohesion pass (combo/multiplier escalation + ball-save grace window + end-of-ball bonus tally on top of the now-playable Phase 1–4 loop)
Outcome: Done (verified 2026-06-11). All three pillars landed as pure-logic modules + Vitest on `claude/serene-dirac-gx60b7` (commit `2377a61`); tsc/lint clean, 321 tests green. Not yet merged to main. Separately surfaced: issue #241 (controls dead despite audio) + 6 more Copilot-ready issues filed 2026-06-09 → #241 promoted to 2026-06-11 Fix First. Also discovered `.swarm-state.md` over-reports two systems (Live HUD, Sound Manager) whose files don't exist.

---

### Prior run — 2026-05-29
Date: 2026-05-29
Mode: Fix First
Focus: Wire the adventure track-switch teardown + rebuild path (orchestrator gap surfaced by the obstacle-lifecycle audit)
Outcome: Done (verified 2026-06-04). `onTrackAdvanced` wired → `slotAdventure.switchToTrack()` tears down + rebuilds geometry, fires track-start cinematic, resets goal UI, re-inits supervisor timer. Both carried Backlog follow-ups (cinematic `onTrackStart` + UI `reset()` on switch) folded in. Separately during the week: Copilot landed Phase 1–4 "playable core loop" (#206–#211 — physics collisions, kinematic plunger, level/map loading + table switching + free-map test mode, drain/reset loop); Kimi Swarm Campaign Loop Audit (2026-06-01) added to docs + CLAUDE.md; PR #193 merged; main caught up.

---

### Prior run — 2026-05-28
Date: 2026-05-28
Mode: User Idea
Focus: Adventure-mode obstacle lifecycle audit
Outcome: Done. Audit completed and landed (commit `c287a31`, +16 tests; `20ba192` hit-flash). All five obstacle scoring/EventBus bugs fixed; scoring-wiring matrix verified end-to-end. Surfaced two orchestrator gaps the audit's file scope couldn't touch: (1) track-switch never rebuilds geometry (`onTrackAdvanced` unwired) → promoted to 2026-05-29 Fix First; (2) cinematic `onTrackStart` + UI `reset()` not called on switch → Backlog. Separately, fresnel rim idea shipped (PR #192); 8 `input-handler` test failures still open (fix in flight on draft PR #193).

---

### Prior run — 2026-05-21
Date: 2026-05-21
Mode: New Idea
Focus: Multi-layer parallax breathing (all display layers, staggered phase) + reel spring refinement
Outcome: Done. All 4 display layers have `updateParallax()` with staggered phase offsets; `display-core.ts` wired all four. Spring constants refined (stiffness=90, damping=4.0, named). Meanwhile six Copilot campaign PRs landed (#183–#188): AlternatingA/B progression, AdventureProgressionSupervisor wired, HUD countdown, portal collision de-dup, portal/obstacle e2e tests.

---

### Prior run — 2026-05-14
Mode: Fix First
Focus: Restore build (missing node_modules) + adventure-mode integration audit
Outcome: Build restored. Major monolith reduction shipped (PR #158 — `buildSceneStaged` → `GameSystemsInitializer`; `game.ts` −505/+0 lines). Physics tunables migrated to `PhysicsConfig` (PR #158). `FlipperPhysics` constants extracted. Visual Language System applied to effects + materials (PRs #155/#156). Flipper visibility regression diagnosed and fixed (PR #159 — mesh visibility and color correction). Adventure-mode audit remains open (in Backlog + promoted to Ideas for future kimi-cli run). All 51+ Vitest tests passing. Issue #131 not explicitly confirmed closed — verify.

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
