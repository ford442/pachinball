# Feeder Audit (#259 — Config-Only Pass)

**Date:** 2026-06-26  
**Scope:** Align all five table feeders with `FEEDER_TUNABLES` in `src/config.ts`; document PLAN.md vs code; pin transition behavior with Vitest.  
**Out of scope:** Base-class refactor, display/shaders, physics dispatch.

## Table placement (answers open question)

All **five feeders are instantiated on the default table** in `src/game.ts` (`MagSpinFeeder`, `NanoLoomFeeder`, `PrismCoreFeeder`, `GaussCannonFeeder`, `QuantumTunnelFeeder`). They are **not** adventure-track-only. Render checks apply to the main playfield cabinet.

## PLAN.md authority

`docs/PLAN.md` §5–§31 describes design intent. **Code values in `FEEDER_TUNABLES` are ground truth for gameplay.** Where they differ, the Rationale column explains why — do not blindly revert code to match the doc.

## Stuck-ball working definition (per feeder)

| Feeder | Max time in catch/charge before release | Min release speed check |
|--------|----------------------------------------|-------------------------|
| mag-spin | 3 s in CATCH+SPIN (spinDuration 1.2 s + catch lerp) | releaseForce ≥ 25 impulse |
| gauss-cannon | 3 s in LOAD+AIM (aimDuration 2.0 s) | muzzleVelocity ≥ 30 |
| nano-loom | 3 s in LIFT (height 6 / liftSpeed 10 ≈ 0.6 s nominal) | ejectImpulse.x ≥ 8 |
| prism-core | N/A (instant overload on 3rd capture) | ejectForce ≥ 20 |
| quantum-tunnel | 3 s in CAPTURE+TRANSPORT (0.5+0.5 s nominal) | ejectImpulse ≥ 25 |

Vitest transition tests assert full catch→release cycles complete within tuned frame budgets.

## Coupled tunable groups

| Feeder | Coupled parameters | Notes |
|--------|-------------------|-------|
| mag-spin | `releaseForce` + `releaseTarget` + `releaseAngleVariance` | Force tuned to reach center bumpers from upper-right well |
| mag-spin | `catchRadius` + `feederPosition` | Well geometry (3.5 diameter) fits wall gap at x≈9.25 |
| gauss-cannon | `muzzleVelocity` + `minAngle`/`maxAngle` | Sweep arc must cover center field from lower-left |
| nano-loom | `liftSpeed` + `height` + `ejectImpulse` | Lift time ≈ height/liftSpeed; eject clears left wall |
| prism-core | `ejectForce` + `ejectSpread` | Multiball cone toward center (-Z) |
| quantum-tunnel | `transportDelay` + `ejectImpulse` + positions | Left output must reach center targets |

---

## 1. Mag-Spin (`FEEDER_TUNABLES['mag-spin']`)

**PLAN.md:** §5 — upper-right magnetic well.  
**States:** IDLE → CATCH → SPIN → RELEASE → COOLDOWN → IDLE

| Tunable | PLAN.md §5 | Code (`FEEDER_TUNABLES`) | Rationale |
|---------|------------|--------------------------|-----------|
| feederPosition | Upper right (unspecified coords) | `{ x: 9.25, y: 0.5, z: 12 }` | Fits between pachinko field (x≈7) and wall (x≈11.5) for 3.5-unit well |
| catchRadius | 1.5 | 1.5 | Matches spec |
| spinDuration | 1.2 s (text says 1.5 s in state machine) | 1.2 | Matches §5 C spec; 1.2 s chosen for snappier loop |
| cooldown | 3.0 s | 3.0 | Matches spec |
| releaseForce | 25.0 | 25.0 | Matches spec |
| releaseAngleVariance | 0.25 rad | 0.25 | Matches spec |
| releaseTarget | (implied center) | `{ x: 0, y: 0, z: 5 }` | Explicit aim point at lower bumpers |
| catchLerpSpeed | — | 6 | Catch convergence rate (was inline) |
| catchArrivalDistance | — | 0.15 | Distance threshold CATCH→SPIN |
| holdYOffset | — | 0.5 | Ball hold height in well |
| maxCaptureHeightY | — | 2.0 | Ignore aerial balls (hologram lane) |
| spinAngularSpeed | — | 32 | Visual spin rate during charge |
| releaseUpwardBias | — | 0.08 | Small lift on release to clear well rim |
| animation.ringSpeedSpin / Idle / Default | — | 24 / 1 / 4 | Ring spin targets per state (was inline in updateVisuals) |
| animation.ringLerpSpin / Default | — | 2.5 / 0.5 | Ring speed convergence rates |
| animation.shakeDecay | — | 0.88 | Per-frame release shake decay |
| animation.idlePulseFrequency | — | 1.8 | IDLE sin pulse rate |
| animation.releaseShakeInitial | — | 0.6 | Shake amplitude on release |
| physicsExtras.releaseSpinVarianceXZ | — | 8 | Release angular velocity X/Z spread |
| physicsExtras.releaseSpinBaseY | — | 12 | Release angular velocity Y impulse |
| physicsExtras.spinAxisMultiplierY/Z | — | 1.3 / 0.7 | Ball spin quaternion axis multipliers |

**Render paths:** Babylon `StandardMaterial` + `PointLight` — WebGPU and WebGL2 both use the same mesh path; no WGSL-only feeder visuals.

---

## 2. Nano-Loom (`FEEDER_TUNABLES['nano-loom']`)

**PLAN.md:** §12 — left-wall vertical pegboard.  
**States:** IDLE → LIFT → WEAVE → EJECT → IDLE (no COOLDOWN enum; EJECT timer gates re-entry)

| Tunable | PLAN.md §12 | Code | Rationale |
|---------|-------------|------|-----------|
| loomPosition | `{ x: -13, y: 4, z: 2 }` | same | Matches spec |
| intakePosition | `{ x: -12, y: 0.5, z: 2 }` | same | Matches spec |
| width / height / depth | 2 / 6 / 1 | same | Matches spec |
| pinRows / pinCols / pinSpacing | 8 / 4 / 0.6 | same | Matches spec |
| pinBounciness | 0.8 | 0.8 | Matches spec |
| liftDuration | 1.5 s | 1.5 | Documented; lift uses speed-based motion (see liftSpeed) |
| intakeRadius | — | 1.5 | Was hardcoded; vacuum catch zone |
| liftSpeed | — | 10.0 | Units/s vertical lift (faster than 1.5 s doc — prevents stuck LIFT) |
| liftAlignLerpSpeed | — | 5 | Horizontal alignment during lift |
| weaveNudgeImpulse | — | 0.1 | Breaks pin balance when entering WEAVE |
| ejectImpulse | — | `{ x: 8, y: 2, z: 0 }` | Push toward center (+X) from left wall |
| ejectCooldown | — | 1.0 s | Short gate before IDLE (PLAN has no cooldown state) |
| animation.liftTopYOffset | — | 0.5 | Top-of-loom hold offset during LIFT |
| animation.pinActivationRowRadius | — | 2 | Pin glow proximity rows |
| animation.pinActivationScaleBoost | — | 0.5 | Pin scale pulse amplitude |
| animation.weaveExitMarginY | — | 0.5 | Bottom exit threshold margin |

**Render paths:** Canvas-compatible `StandardMaterial` on frame, intake, pins.

---

## 3. Prism-Core (`FEEDER_TUNABLES['prism-core']`)

**PLAN.md:** §13 — top-center ball lock / multiball.  
**States:** IDLE → LOCKED_1 → LOCKED_2 → OVERLOAD (release) → IDLE

| Tunable | PLAN.md §13 | Code | Rationale |
|---------|-------------|------|-----------|
| prismPosition | `{ x: 0, y: 0.5, z: 12 }` | same | Matches spec |
| captureRadius | 1.2 | 1.2 | Matches spec |
| ejectForce | 20.0 | 20.0 | Matches spec |
| ejectSpread | 45° | 45 | Matches spec |
| lockCapacity | 3 (implicit) | 3 | Explicit for tests/config |
| postReleaseCooldown | — | 2.0 s | Prevents instant re-capture after multiball (was inline) |
| animation.rotationSpeedIdle/Locked1/Locked2/Overload | — | 0.5 / 2 / 5 / 15 | Inner core spin targets per lock state |
| animation.rotationLerpRate | — | 2 | Rotation speed convergence |
| animation.outerRotationRatio | — | 0.5 | Outer shell counter-rotation factor |
| animation.bloomDecay | — | 0.9 | Energy bloom fade per frame |

**Render paths:** Procedural polyhedron + wireframe cylinder; both renderers supported. Custom refraction shader noted in PLAN — **not implemented** (follow-up if needed).

---

## 4. Gauss-Cannon (`FEEDER_TUNABLES['gauss-cannon']`)

**PLAN.md:** §26 — lower-left railgun recovery.  
**States:** IDLE → LOAD → AIM → FIRE → COOLDOWN → IDLE

| Tunable | PLAN.md §26 | Code | Rationale |
|---------|-------------|------|-----------|
| gaussPosition | `{ x: -12, y: 0.5, z: -8 }` | same | Matches spec |
| intakeRadius | 1.0 | 1.0 | Matches spec |
| muzzleVelocity | 30.0 | 30.0 | Matches spec |
| minAngle / maxAngle | 30° / 60° | 30 / 60 | Matches spec |
| sweepSpeed | 1.0 rad/s | 1.0 | Matches spec |
| cooldown | (unspecified) | 2.0 | Post-fire ignore window |
| aimDuration | 2.0 s | 2.0 | Matches §26 B (was inline in setState) |
| loadLerpSpeed | — | 5 | Breech loading lerp |
| loadArrivalDistance | — | 0.2 | LOAD→AIM threshold |
| breechYOffset | — | 1.0 | Ball hold height on mount |
| idleSweepRate | — | 2.0 | IDLE visual sweep (was 0.2×10 inline) |
| aimSweepMultiplier | — | 20 | Converts sweepSpeed to deg/frame during AIM |
| animation.coilPulseRate | — | 10 | AIM coil stretch oscillation rate |
| animation.recoilSpringStrength / recoilDamping | — | 20 / 0.7 | Barrel recoil spring physics |
| animation.fireRecoilImpulse | — | 0.5 | Initial recoil velocity on fire |
| animation.vibrationDecay | — | 0.95 | Per-frame charge/fire vibration decay |
| animation.idleSweepScale | — | 10 | IDLE sweep rate multiplier |

**Render paths:** TransformNode + emissive coils; renderer-agnostic.

---

## 5. Quantum-Tunnel (`FEEDER_TUNABLES['quantum-tunnel']`)

**PLAN.md:** §31 — right-wall input, left-wall output bypass.  
**States:** IDLE → CAPTURE → TRANSPORT → EJECT → COOLDOWN → IDLE

| Tunable | PLAN.md §31 | Code | Rationale |
|---------|-------------|------|-----------|
| inputPosition | `{ x: 11.5, y: 0.5, z: 0 }` | same | Matches spec |
| outputPosition | `{ x: -11.5, y: 0.5, z: 0 }` | same | Matches spec |
| inputRadius | (unspecified) | 1.2 | Sensor ball radius |
| ejectImpulse | 25.0 | 25.0 | Matches spec |
| transportDelay | 0.5 s | 0.5 | Matches spec |
| cooldown | 2.0 s | 2.0 | Matches spec |
| capturePullDuration | — | 0.5 s | CAPTURE pull phase (was inline) |
| capturePullLerpSpeed | — | 10 | Pull lerp toward input center |
| ejectImpulseVarianceZ | — | 5.0 | Lateral spread on eject |
| ejectRecoilDistance | — | 0.5 | Output portal visual recoil |
| transportHideY | — | -100 | Off-table hold during transport |
| cooldownFadeDuration | — | 1.0 s | Output portal fade rate |
| portalSpinIdle/Capture/Transport/Eject | — | 1 / 5 / 8 / 10 | Visual spin tiers (was class constants) |
| animation.portalSpinLerpRate | — | 5.0 | Spin acceleration lerp |
| animation.outputSpinRatio | — | 0.8 | Output portal counter-spin factor |
| animation.portalStretchAmplitude | — | 0.3 | TRANSPORT portal distortion peak |
| animation.ejectRecoilDecay | — | 0.8 | Output portal recoil decay per frame |
| animation.idlePulseRate | — | 0.002 | IDLE emissive sin rate (performance.now scale) |

**Render paths:** Torus + disc materials. PLAN mentions swirling UV shader — **not implemented** (file follow-up for display/shaders branch).

---

## Test coverage

| File | Feeder | Assertions |
|------|--------|------------|
| `tests/mag-spin-feeder.test.ts` | mag-spin | catch→spin→release→cooldown, release direction, cooldown gating |
| `tests/gauss-cannon-feeder.test.ts` | gauss-cannon | load→aim→fire→cooldown, +X impulse, cooldown gating |
| `tests/nano-loom-feeder.test.ts` | nano-loom | lift→weave→eject→idle, +X eject |
| `tests/prism-core-feeder.test.ts` | prism-core | 3-ball lock chain, -Z eject, post-release cooldown |
| `tests/quantum-tunnel-feeder.test.ts` | quantum-tunnel | capture→transport→eject→cooldown, +X eject |
| `tests/feeder-golden-fixtures.test.ts` | all five | Golden FSM replay with fixed Math.random — parity gate for config extraction |
| `tests/feeder-golden-fixtures.test.ts` | invariants | All five entries present; finite positive core scalars |

## Is PLAN.md §5 still ground truth?

**No.** `FEEDER_TUNABLES` (including `animation` / `physicsExtras` nested blocks) is ground truth for gameplay feel. PLAN.md §5–§31 documents design intent; drift is intentional where code values were tuned for playability.

## Config entry point

```typescript
import { FEEDER_TUNABLES, GameConfig } from './config'

// Canonical namespace:
FEEDER_TUNABLES['mag-spin'].catchRadius

// Backward-compatible aliases (same object references):
GameConfig.magSpin.catchRadius
```
