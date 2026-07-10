# Pachinball — Weekly Plan

## Today's focus
**2026-07-10 — USER IDEA: C++ WASM physics engine bring-up (bounded A/B slice)**
Foundation is **healthy** — `npx tsc -b` clean, **464 Vitest passing** (48 files, +25 since last week), `npm run lint` 0 errors / 3 trivial warnings. Not Fix First.

Last week's User Idea **#262 Cyber-Shock Jackpot LANDED** — not through the planned kimi-cli lane but via two direct `codespace` commits (Jul 8). The 10-second phase driver is real: `effects-core.ts:509 updateJackpotSequence(dt)` walks Breach → Error → Meltdown and is ticked every frame (`:1028`); the per-phase shader lives in `display-shader.ts` (`JackpotPhaseState`, `uPhase`/`uCrackProgress`/`uShockwaveRadius`); the per-phase LCD canvas is in `display-lcd-overlay.ts`; cabinet lighting is phase-synced in `effects-cabinet.ts` — all fired off `startJackpotSequence()` / `jackpot:start`. → moved to Done. **Caveat:** the same codespace window also dumped a large *unreviewed* adventure/campaign batch straight to `main` (new `pachinko-hall` track, `track-ambient-effects.ts`, `physics-tuning-panel.ts`, `event-bus-log.ts`, `track-teardown-stats.ts`, campaign persistence, +25 tests). It's green, so not Fix First — but flagged for a consolidation/review pass (Backlog).

That leaves exactly **one** unfinished user-written idea: the **C++ WASM physics bring-up**. Reconciled against code, the scaffold is **mature, not idle**: `native/src/` holds a full C++ physics world (`PhysicsWorld.cpp` 254L, `RigidBody`, `ContactListener`, `bindings.cpp` 142L, `CMakeLists.txt`); `src/wasm/PhysicsModule.ts` is a 241-line API-parity `WasmPhysicsEngine` wrapper with graceful fallback + EventBus contact forwarding; `wasm-types.ts`/`index.ts` are typed; `scripts/build-wasm.sh` exists; and `event-bus.ts` already imports `WasmContactEvent` (the wiring seam). **What's missing is exactly the idea's ask:** build the WASM once, wire a `localStorage` feature-flag A/B path routing the **ball/bumper subset** through `WasmPhysicsEngine` vs Rapier, and add a **parity test harness**. That is a bounded one-day slice of the multi-day idea — the "idle scaffold / Emscripten not found" risk from last week is outdated now that the C++ + TS layers are both substantial.

**Boundaries:** kimi-cli touches `native/**`, `src/wasm/**`, `scripts/build-wasm*.sh`, the flag seam in `src/game-elements/physics.ts` + a thin router in `src/game/game-physics-controller.ts`, `src/config.ts` (flag default), and a new `tests/wasm-physics-parity.test.ts`. **Do NOT touch** `src/display/**`, `src/shaders/**`, `src/objects/**`, the adventure/campaign files, `ball-manager.ts` spawn logic, or the slot files — those are the decoupled Copilot lane (slot-reel WGSL/canvas parity, issue draft B).

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
- [in progress — 2026-07-10] C++ WASM physics engine bring-up — scaffold reconciled as **mature, not idle**: `native/src/` full C++ physics world + bindings, `src/wasm/PhysicsModule.ts` 241-line API-parity `WasmPhysicsEngine` (fallback + EventBus contact forwarding), `scripts/build-wasm.sh`, `event-bus.ts` seam. Today's bounded slice: build the WASM, wire a `localStorage` feature-flag A/B path against Rapier for the ball/bumper subset, add a parity test harness. (was multi-day → now bounded one-day first slice) [new idea, 2026-06-04]
- [done — 2026-07-02] Slot Machine Mini-Game (#261) — 3-reel slot bonus **merged to `origin/main`** via PR #268/#270 (`slot-machine.ts` / `slot-logic.ts` / `slot-types.ts`, `SLOT_MACHINE_CONFIG`, display-core/sound/effects wired, +28 Vitest). Now pays into a live score after the #266 fix. [user issue, 2026-06-16]
- [largely landed — 2026-07-02] Multi-Layered Backbox Display depth pass (#260) — reconciled against code: Layer-1 physical depth (`display-physical.ts` drums+backdrop), per-layer Z-depth (`display-layer-depth.ts`), and per-state content routing (`StateMediaConfig`/`getStateConfig`, `display-core.ts:302-326`) all exist and are wired. Both originally-named gaps are closed. **Remaining = verification/parallax-tuning only**, folded into today's #262 work. (was full-day → now polish) [user issue, 2026-06-16]
- [done — 2026-07-10] Phased "Cyber-Shock" Jackpot Sequence (#262) — **LANDED** via direct `codespace` commits (Jul 8). 10 s 3-phase (Breach → Error → Meltdown) driver `effects-core.ts:509 updateJackpotSequence(dt)` ticked every frame (`:1028`); per-phase shader `display-shader.ts` (`JackpotPhaseState`/`uPhase`/`uCrackProgress`/`uShockwaveRadius`); per-phase LCD canvas `display-lcd-overlay.ts`; phase-synced cabinet lighting `effects-cabinet.ts`; all off `startJackpotSequence()` / `jackpot:start`. [user issue, 2026-06-16]

## Backlog
- [ ] **Consolidation/review pass on the Jul 8 `codespace` dump (unreviewed direct-to-main).** Two large `codespace` commits (`04b0c9d`, `d1f377b`) landed ~1500+ lines straight to `main` with no PR: new `pachinko-hall` adventure track, `track-ambient-effects.ts`, `physics-tuning-panel.ts`, `event-bus-log.ts`, `track-teardown-stats.ts`, `adventure-campaign-persistence.ts`, plus edits across `config.ts`/`ball-manager.ts`/`game.ts`. Green (464 tests, tsc clean) so not Fix First, but it deserves a read-through for architectural drift, dead code, and whether the new panels/logging should be dev-gated. Good Gemini/review-loop target. [added 2026-07-10]
- [ ] **Phase 2 of #266 — rollover/lane sensor scoring fallback.** #266 Phase 1 (handle-space dispatch) landed; Phase 2 deferred. Add a lightweight lane/rollover sensor scoring layer (small `COLLISION_GROUP_PRESETS.SENSOR` cuboids on the launch lane + drain approach) so every ball scores at least once even when it drains the outer edge untouched. **Deferred off today's Copilot lane** — it touches `game-physics-controller.ts` dispatch, which collides with today's WASM flag seam; revisit once the WASM A/B path lands. Touches `src/objects/**`, `src/config.ts`, `game-physics-controller.ts` dispatch. [updated 2026-07-10]
- [ ] **Feeder audit #269 (repurposed #259) — Config-Only Pass, still open, unstarted.** Externalize feeder tunables to `FEEDER_TUNABLES` in `config.ts`, add per-feeder transition Vitest, document PLAN.md §5 drift in `docs/feeder-audit.md` with a Rationale column; ZERO edits to physics/display/shaders. Issue #269 is filed and detailed; candidate for a future Copilot/kimi lane once #262 lands. Two open questions in the issue still need Noah's answers (feeder table scope; is PLAN.md §5 still ground truth). [updated 2026-07-02]
- [ ] **`.swarm-state.md` reset for WASM run** — still holds the completed #266 fix state. Today's kimi-cli C++ WASM run must overwrite it fresh at its first iteration boundary. [updated 2026-07-10]
- [in progress — 2026-07-10, Copilot lane §B] **WGSL slot-reel shader vs canvas fallback** — slot mini-game (#261) renders reels via `display-reels.ts`; confirm the WebGPU WGSL path vs canvas-texture fallback mirrors `display-shader.ts`. **This is today's decoupled Copilot lane** (issue draft B) — pure `src/display/**`, zero overlap with kimi-cli's `native/**` / `src/wasm/**` / physics work. [updated 2026-07-10]
- [ ] CRT scanline enhancement — temporal flicker already in `src/shaders/scanline.ts` (lines 38–40) and a `clampScanlineIntensity(presetBase, scanlineWeight, accessibilityFactor)` helper exists; remaining gap is per-preset intensity tuning and a UI toggle. Low priority.
- [ ] Verify issue #131 closed (flipper visibility regression from PR #159 — not explicitly confirmed closed; check before next Copilot PR in that area). Note: GitHub issue list currently returns 0 open issues, so likely closed — confirm.
- [ ] Reconcile the Phase 1–4 "playable core loop" Copilot work (#206–#211) against the campaign/adventure systems — both now load tables/levels; confirm there is one canonical level-load path, not two divergent ones (free-map test mode vs adventure track switch).

## Next Sprint Ideas (May 9+)
- [done — 2026-05-21] Input buffering improvements — `queueInput` / `PendingInputFrame` system fully implemented in `src/game-elements/input.ts` (lines 10, 126–206, 331–493).
- [done — 2026-05-21] Mobile touch controls — HTML buttons (index.html L137–162), CSS (style.css L232–546), and event handlers (input.ts L525–670) all live.
- [done — 2026-05-21] Backbox screen border lighting — `BackboxBorderGlow` implemented and tested (PR #138 + PR #147).

## Done
- 2026-07-10: **Phased "Cyber-Shock" Jackpot Sequence (#262) — LANDED** (last week's User Idea). Shipped via two direct `codespace` commits (Jul 8), not the planned kimi-cli lane. The 10 s narrative is fully wired: `effects-core.ts:494 startJackpotSequence()` sets phase 1; `effects-core.ts:509 updateJackpotSequence(dt)` advances Breach (0–?s) → Error → Meltdown (5–10 s) on real dt and is ticked every frame at `:1028` (before cabinet/display consume `jackpotPhase`); `display-shader.ts` renders the per-phase PostProcess (`JackpotPhaseState`, `uPhase`/`uCrackProgress`/`uShockwaveRadius`/`uGlitchIntensity`, escalation logic `:321-329`); `display-lcd-overlay.ts` draws per-phase canvas content (Phase 1 spreading cracks `:314`, Phase 3 exploding JACKPOT + cyan/gold shockwaves + gold rain `:385`); `effects-cabinet.ts` phase-syncs cabinet lighting (`:119/:123/:178`); `game-physics-controller.ts:666-667` reads `effects.jackpotPhase` and feeds `display.update(dt, jackpotPhase)` + drives bumper JACKPOT visuals. Triggered from campaign-loop/lifecycle/adventure/physics call sites via `startJackpotSequence()` + `jackpot:start`. Verified: tsc clean, 464 Vitest passing, lint 0 errors.
- 2026-07-10: **Large adventure/campaign batch landed on `main` via `codespace` (Jul 8), unreviewed.** Commits `04b0c9d` + `d1f377b` (~1500+ lines): new `pachinko-hall` adventure track + `cyber-core` refinements, `track-ambient-effects.ts`, `physics-tuning-panel.ts`, `event-bus-log.ts`, `track-teardown-stats.ts`, `adventure-campaign-persistence.ts`, `performance-monitor` expansion, `physics.ts`/`ball-manager.ts`/`config.ts`/`game.ts` edits, +25 Vitest (464 total, all green). Landed direct to main with no PR → flagged for a consolidation/review pass (Backlog).
- 2026-07-02: **Zero-score collision-dispatch bug (#266) — FIXED and landed on `main`** (last week's Fix First). Collider→parent-body handle conversion now applied uniformly at the event boundary in `game-physics-controller.ts` (`stepPhysics` pre-filter `:518-523`, `processCollision` `:685-695`, `processContactForce` `:798-801`) — `world.getCollider(h)?.parent()?.handle`. All dispatch sets (bumper/flipper/target/trap/gate/spinner + portal/death/adventure sensors) now key on body-handle space consistently. Regression test `tests/collision-handle-space-scoring.test.ts` locks the multi-collider (handle ≠ body-handle) case. Verified: 439 Vitest passing (43 files), `npm run build` clean, browser (Playwright MCP) shows `score=200` / `bumperMatches=2` / `awardScoreCalls=2` on center-bumper contact. **GitHub issue #266 closed 2026-07-02** (state_reason: completed). Combo/bonus-tally systems now fed by a live award rate. Phase 2 (rollover/lane fallback) split to Backlog as the new Copilot lane.
- 2026-07-02: **Slot Machine Mini-Game (#261) — merged to `origin/main`** (via PR #268 + #270). The 3-reel slot bonus that landed on `claude/serene-dirac-8luq11` is now on main; branch↔main divergence reconciled (the "still at Phase-4 #211 era" backlog concern resolved). Now pays into a live score post-#266.
- 2026-07-02: **Multi-Layered Backbox Display depth pass (#260) — reconciled as largely landed.** Code audit found Layer-1 physical depth (`display-physical.ts` — rotating drums + backdrop, wired in `display-core.ts:109/163`, per-state colors via `STATE_COLORS`), per-layer Z-depth constants (`display-layer-depth.ts`), and full per-state media routing (`StateMediaConfig`/`getStateConfig`, `display-core.ts:302-326`, main-media cross-fade `:222-225`) all already present. Both gaps the 2026-06-16 idea named are closed. Remaining verification/parallax-tuning folded into the #262 task.
- 2026-06-25: **Slot Machine Mini-Game (#261) — landed** (last week's User Idea). Built on `claude/serene-dirac-8luq11`: pure-logic engine (`src/display/slot-logic.ts`, `slot-types.ts`), orchestrator (`src/display/slot-machine.ts`) with REACH/FEVER activation + cooldown/chance/score gating, staggered reel-stop reusing `DisplayReelsLayer` spring physics, jackpot→`jackpot:start`+points / wins→`points:awarded` / near-miss→`slot:nearmiss`. `SLOT_MACHINE_CONFIG` + typed slot EventBus events; sound-system + effects (cabinet-light sync) wired; +28 Vitest (`tests/slot-machine-orchestration.test.ts`); PLAN.md tagged `[IMPLEMENTED]`. `.swarm-state.md` reflects completion 2026-06-18T17:50. **Caveats:** NOT yet merged to `origin/main`, no PR open (→ Backlog); verify WGSL-vs-canvas reel render path (→ Backlog).
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
Date: 2026-07-10
Mode: User Idea
Focus: C++ WASM physics engine bring-up (bounded A/B slice) — scaffold reconciled as mature (`native/src/` full C++ world + bindings, `src/wasm/PhysicsModule.ts` 241-line API-parity wrapper, `build-wasm.sh`, `event-bus.ts` seam). Today's slice: build the WASM once, wire a `localStorage` feature-flag A/B path routing the ball/bumper subset through `WasmPhysicsEngine` vs Rapier, add a parity test harness. Chosen as the sole remaining unfinished user-written idea; foundation healthy (not Fix First) after #262 Cyber-Shock jackpot landed via codespace.
Outcome: (fill in at end of day)

---

### Prior run — 2026-07-02
Date: 2026-07-02
Mode: User Idea
Focus: Phased "Cyber-Shock" Jackpot Sequence (#262) — turn the `jackpotOverlay.ts` shader scaffold + built Layer-3 overlay stack into a ~10 s, 3-phase (Breach → Critical → Meltdown) narrative jackpot with escalating glitch/crack/shockwave uniforms, phase-synced escalating audio, and cabinet-lighting sync, off `jackpot:start` / `DisplayState.JACKPOT`. Chosen because #260 (its stated dependency) reconciled as largely landed, unblocking it; picked over the multi-day idle C++ WASM bring-up.
Outcome: Done (verified 2026-07-10). #262 landed — but via two direct `codespace` commits (Jul 8), not the planned kimi-cli lane. Full 10 s phase driver (`updateJackpotSequence`), per-phase display shader + LCD canvas, and phase-synced cabinet lighting all wired off `jackpot:start`. 464 Vitest passing, tsc/lint clean. Same codespace window also dumped a large unreviewed adventure/campaign batch to main (→ Backlog consolidation item).

---

### Prior run — 2026-06-25
Date: 2026-06-25
Mode: Fix First
Focus: Zero-score collision-dispatch bug (#266) — collider vs rigid-body handle-space mismatch in `GamePhysicsController` meant no on-table collision branch ever matched, so `awardScore` never fired and the score stayed 0. Fix = collider→parent-body handle conversion at the event boundary, uniform across `processCollision` + `processContactForce`, instrument-first via debug HUD, lock with a regression test.
Outcome: Done (verified 2026-07-02). Fix landed on `main`: uniform boundary conversion in `game-physics-controller.ts`, regression test `collision-handle-space-scoring.test.ts` added, 439 tests green, build clean, browser-verified (`score=200`). Issue #266 closed. Slot machine #261 merged to main (PR #268/#270) in the same window. Phase 2 rollover/lane fallback deferred to Backlog as the next Copilot lane.

---

### Prior run — 2026-06-18
Date: 2026-06-18
Mode: User Idea
Focus: Slot Machine Mini-Game (#261) — stand up a self-contained 3-reel slot bonus (`src/display/slot-machine.ts`) leaning on existing `display-reels.ts`; config-driven symbols/paylines, variable-speed staggered spins, win detection, audio + cabinet-light sync via EventBus, activation on Reach/Fever.
Outcome: Done (verified 2026-06-25). Slot engine + orchestrator landed on `claude/serene-dirac-8luq11` with +28 Vitest; `.swarm-state.md` shows completion 2026-06-18T17:50. NOT yet merged to main / no PR open (→ Backlog). Surfaced the bigger problem: it pays into a score stuck at 0 because #266 (collision-dispatch handle-space bug) was never fixed → today's Fix First.

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
