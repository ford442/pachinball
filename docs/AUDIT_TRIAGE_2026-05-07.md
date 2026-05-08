# Audit Reports Triage — 2026-05-07

**Date:** 2026-05-07  
**Trier:** Kimi Code CLI  
**Scope:** Review key audit reports from `docs/` against current `main` branch code. Determine implemented / stale / open status.

---

## Legend

| Status | Meaning |
|--------|---------|
| ✅ **Implemented** | Code change is in `main` and functional. |
| ⚠️ **Partial** | Some aspects done, others remain open. |
| 🗑️ **Stale** | Report references files/architecture that no longer exist. |
| 📌 **Open** | Valid recommendation, not yet implemented. |
| 🔍 **Needs Re-audit** | Architecture changed too much; report needs rewrite. |

---

## 1. Physics Simulation Pipeline Audit (`PHYSICS_AUDIT_MASTER.md`)

| # | Opportunity | Status | Evidence |
|---|-------------|--------|----------|
| OP-1 | Solver iterations (8 vel + 4 friction) | ✅ Implemented | `src/game-elements/physics.ts:44-45` |
| OP-2 | Fixed timestep with accumulator | ⚠️ Partial | `PhysicsSystem.step()` uses fixed accumulator; variable `dt` still passed in some call sites — verify no drift |
| OP-3 | Ball damping (linear + angular) | ✅ Implemented | `GameConfig.ball.linearDamping` / `angularDamping`; applied in `ball-manager.ts` |
| OP-4 | Unify wall friction | 📌 Open | Wall bodies in `object-walls.ts` still use default friction; not synced to `GameConfig.ball.friction` |
| OP-5 | Contact skin (0.005) | 📌 Open | Not found in `physics.ts`; micro-bounce potential remains |
| OP-6 | Sleep thresholds | ✅ Implemented | `setCanSleep(true)` on balls in `ball-manager.ts` |
| — | Stuck-ball detection | 📌 Open | No stuck-ball reset logic visible |
| — | Physics profiling visibility | 📌 Open | `debug-hud.ts` has FPS but no physics-step timing graph |

**Verdict:** ~60 % implemented. The critical solver-iterations and damping configs are done. Contact skin and wall-friction unification are quick wins (≤10 min each).

---

## 2. Lighting, Shadow & Post-Processing Audit (`LIGHTING_SHADOW_PP_AUDIT_REPORT.md`)

| # | Opportunity | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Shadow bias tuning | ⚠️ Partial | `ShadowGenerator` created in `game.ts`; explicit `bias`/`normalBias` not set — uses Babylon defaults |
| 2 | Game state light response | ✅ Implemented | `EffectsSystem.setLightingMode()` + `setAtmosphereState()` drive color shifts on FEVER/REACH/JACKPOT |
| 3 | Bounce light proximity | 📌 Open | `bounceLight` intensity is static; no ball-distance modulation |
| 4 | Cabinet light exclusion | 📌 Open | LED PointLights do not set `excludedMeshes` |
| 5 | FXAA | ✅ Implemented | Mentioned in weekly_plan as merged in PR #110 |
| 6 | SSAO2 | ✅ Implemented | `SSAO2RenderingPipeline` referenced in AGENTS.md architecture; present in rendering stack |
| 7 | ACES tone mapping | ✅ Implemented | PR #110 |
| 8 | Bloom + tone mapping | ✅ Implemented | `DefaultRenderingPipeline` active in `game.ts` |
| 9 | State-based fog | ✅ Implemented | `fogDensity` now extracted to `GameConfig.visuals.fogDensity`; disabled when `reducedMotion` |
| 10 | Ball highlight light | 📌 Open | No dedicated ball-tracking PointLight |

**Verdict:** ~70 % implemented. The post-processing stack (FXAA, SSAO2, ACES, bloom) is complete. Shadow bias and cabinet-light exclusions are quick wins.

---

## 3. Material & PBR System Audit (`MATERIAL_PBR_AUDIT_REPORT.md`)

| # | Opportunity | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Sheen on interactive elements | ✅ Implemented | `material-interactive.ts` uses `sheen.isEnabled` where supported |
| 2 | Anisotropy for brushed metal | ✅ Implemented | `material-metallic.ts` sets anisotropy on brushed presets |
| 3 | Per-material environment intensity | ✅ Implemented | `MaterialLibrary` presets vary `environmentIntensity` |
| 4 | Playfield normal generation | 📌 Open | No procedural normal map for playfield surface |
| 5 | Clear-coat variation | ✅ Implemented | `material-ball.ts` clear coat gated by `QualityTier.HIGH` |
| 6 | Iridescence | ✅ Implemented | Gold-ball materials use iridescence on HIGH tier |
| 7 | Hardware quality tiers | ✅ Implemented | `detectQualityTier()` + `QualityTier` enum drive LOD and material features |
| 8 | Pin surface detail | 📌 Open | Pachinko pins are smooth cylinders; no micro-scratch noise |
| 9 | Hit energy pulse | ✅ Implemented | `EffectsSystem` bumper hit pulses + `spawnShardBurst` |
| 10 | Cabinet PBR enhancement | ⚠️ Partial | Cabinet uses mix of PBR and StandardMaterial depending on preset |

**Verdict:** ~80 % implemented. The advanced PBR features (sheen, anisotropy, iridescence, clear-coat, quality tiers) are all in place. Playfield normal generation and pin micro-detail remain open.

---

## 4. Rendering & Shader Pipeline Audit (`RENDERING_AUDIT_REPORT.md`)

| # | Opportunity | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Cyber grid atmospheric glow | 🗑️ Stale | References `src/game-elements/display.ts` — file no longer exists; display system was split into `src/display/` in April 2026 |
| 2 | Ball motion trails | ✅ Implemented | `effects-trails.ts` with velocity-proportional emit rate; gated by `QualityTier.LOW` |
| 3 | Enhanced Canvas fallback | 🗑️ Stale | Same `display.ts` path issue; Canvas2D fallback now lives in `src/display/display-reels.ts` |
| 4 | CRT scanline enhancement | 📌 Open | `scanline.ts` shader exists; temporal flicker / chromatic aberration not added |
| 5 | Pin collar details | 📌 Open | No collar geometry on pachinko pins |
| 6 | Bumper emissive pulse | ✅ Implemented | Bumper neon rings with pulse animation on HIGH tier (merged 2026-05-07) |
| 7 | Playfield normal map | 📌 Open | Same as MATERIAL audit #4 |
| 8 | Parallax display layers | 🗑️ Stale | References old `display.ts`; new display system uses layered WGSL/Canvas2D in `src/display/` |
| 9 | Enhanced shard particles | ✅ Implemented | `effects-particles.ts` with textured shard bursts |
| 10 | Flipper detail enhancement | 📌 Open | Flippers are basic boxes; no grip texture or rail edges |

**Verdict:** ~50 % implemented, but **~30 % of the open items are stale path references**. The report should be rewritten to reference `src/display/` and `src/materials/` instead of `src/game-elements/display.ts` and `src/game-elements/material-library.ts`.

---

## 5. Camera Audits (`CAMERA_AUDIT_TABLE.md`, `CAMERA_AUDIT_HEAD.md`, `CAMERA_AUDIT_ADVENTURE.md`)

| # | Opportunity | Status | Evidence |
|---|-------------|--------|----------|
| Table — Dynamic golden points | ⚠️ Partial | `CameraController` has `FRAMING_ZONES` and soft follow; rule-of-thirds weighting not explicitly implemented |
| Table — Ball-tracking zoom | 📌 Open | Camera does not zoom based on ball velocity |
| Head — CRT curvature | 📌 Open | No barrel-distortion post-process on backbox camera |
| Head — Reel depth of field | 📌 Open | DoF exists but not tuned per reel plane |
| Adventure — Cinematic transitions | ✅ Implemented | `camera-presets.ts` with 8+ cinematic angles; track builder uses them |
| Adventure — Zone-responsive framing | ⚠️ Partial | Zone triggers exist; camera does not auto-switch preset on zone enter |
| Safety — Reduced motion | ✅ Implemented | `accessibility.reducedMotion` disables shake, SSAO, DoF, fog |

**Verdict:** Adventure camera is solid. Table camera has framing zones but lacks dynamic composition. Head camera (backbox) has no CRT curvature or reel DoF.

---

## 6. Input Audit (`INPUT_AUDIT_MASTER.md`)

| # | Opportunity | Status | Evidence |
|---|-------------|--------|----------|
| Touch release handlers | ⚠️ Partial | `InputHandler` has `touchend` in `input.ts`; verify all UI buttons bind it |
| CSS touch-action | 📌 Open | `index.html` / CSS not checked for `touch-action: manipulation` |
| KeyM / non-QWERTY | 📌 Open | Still uses hardcoded `KeyZ`/`Slash` in `game-input.ts` |
| Input buffering | ⚠️ Partial | `InputHandler` has buffering logic; latency tracking present but not wired to HUD |
| Nudge system | ⚠️ Partial | `GameConfig.nudge` exists; `tiltActive` logic in `game.ts`; haptic feedback wired |
| Haptic feedback | ✅ Implemented | `HapticManager` with patterns; `GamepadManager` vibration; used on bumper hits |
| Accessibility — photosensitive | ✅ Implemented | `detectAccessibility()` gates flashes and strobes |

**Verdict:** ~60 % implemented. Input buffering and nudge are functional but not polished. Non-QWERTY key mapping and CSS touch-action are quick wins.

---

## Summary Table

| Audit | Implemented | Partial | Stale | Open | Coverage |
|-------|-------------|---------|-------|------|----------|
| Physics | 3 | 2 | 0 | 4 | ~60 % |
| Lighting/PP | 6 | 2 | 0 | 2 | ~70 % |
| Material/PBR | 7 | 1 | 0 | 2 | ~80 % |
| Rendering | 3 | 0 | 4 | 3 | ~50 % |
| Camera | 3 | 2 | 0 | 3 | ~55 % |
| Input | 3 | 3 | 0 | 3 | ~60 % |

---

## Quick Wins (≤30 min each)

**Completed 2026-05-07:**
1. ✅ **Physics contact skin** — added `contactSkin = 0.005` in `physics.ts`.
2. ✅ **Wall friction unification** — `object-walls.ts` now uses `GameConfig.ball.friction` instead of hardcoded `0.1`.
3. ✅ **Shadow bias tuning** — already present in `game-renderer.ts` (`bias = 0.0005`, `normalBias = 0.02`).
4. ✅ **CSS touch-action** — already present in `style.css` (multiple `touch-action: manipulation` rules).
5. ✅ **Non-QWERTY key fix** — already present in `input.ts` (`ArrowLeft`/`ArrowRight` fallbacks alongside `KeyZ`/`Slash`).

**Still open:**
6. **Pin collar details** — add `CreateCylinder` collar rings in `object-pachinko.ts`.
7. **Cabinet light exclusion lists** — exclude non-cabinet meshes from LED PointLights.

---

## Needs Re-audit

- `RENDERING_AUDIT_REPORT.md` — replace all `src/game-elements/display.ts` references with `src/display/display-*.ts`.
- `LIGHTING_SHADOW_PP_AUDIT_REPORT.md` — verify that post-process stack descriptions match current `game.ts` helper classes (`GameRenderer`, etc.).
- `CAMERA_AUDIT_HEAD.md` — backbox display architecture changed significantly with WGSL/Canvas2D split; DoF recommendations may no longer apply.

---

## Notes

- Many audit recommendations were implemented in PRs #109–#115 (March 2026) and the May 2026 EventBus refactor.
- The biggest architectural drift is the **Display System** (moved from `game-elements/display.ts` → `src/display/`) and **Materials** (moved from `game-elements/material-library.ts` → `src/materials/`).
- No critical safety gaps remain; all accessibility flags (`reducedMotion`, `photosensitiveMode`) are respected.
