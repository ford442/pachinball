/**
 * Runtime physics tuning — merges PhysicsConfig defaults with live debug overrides.
 * Used by the physics tuning panel (?tune=1 or Developer settings).
 */

import { PhysicsConfig } from '../config'

export type PhysicsTuningKey =
  | 'ballRestitution'
  | 'ballFriction'
  | 'ballLinearDamping'
  | 'ballAngularDamping'
  | 'bumperRestitution'
  | 'flipperStiffness'
  | 'flipperDamping'
  | 'flipperKickImpulse'
  | 'plungerMinImpulse'
  | 'plungerMaxImpulse'
  | 'plungerChargeExponent'
  | 'nudgeForce'
  | 'nudgeVerticalBoost'
  | 'spinnerTargetSpeed'
  | 'trapHoldDuration'
  | 'trapReleaseBoost'

export interface PhysicsTuningSliderDef {
  key: PhysicsTuningKey
  label: string
  min: number
  max: number
  step: number
  group: 'ball' | 'flipper' | 'launch' | 'obstacles'
}

const BASE_VALUES: Record<PhysicsTuningKey, number> = {
  ballRestitution: PhysicsConfig.ball.restitution,
  ballFriction: PhysicsConfig.ball.friction,
  ballLinearDamping: PhysicsConfig.ball.linearDamping,
  ballAngularDamping: PhysicsConfig.ball.angularDamping,
  bumperRestitution: PhysicsConfig.bumper.restitution,
  flipperStiffness: PhysicsConfig.flipper.stiffness,
  flipperDamping: PhysicsConfig.flipper.damping,
  flipperKickImpulse: PhysicsConfig.flipper.kickImpulseScale,
  plungerMinImpulse: PhysicsConfig.plunger.minImpulse,
  plungerMaxImpulse: PhysicsConfig.plunger.maxImpulse,
  plungerChargeExponent: PhysicsConfig.plunger.chargeCurveExponent,
  nudgeForce: PhysicsConfig.nudge.force,
  nudgeVerticalBoost: PhysicsConfig.nudge.verticalBoost,
  spinnerTargetSpeed: PhysicsConfig.spinner.targetSpeed,
  trapHoldDuration: PhysicsConfig.trap.holdDuration,
  trapReleaseBoost: PhysicsConfig.trap.releaseBoost,
}

const overrides: Partial<Record<PhysicsTuningKey, number>> = {}

export const PHYSICS_TUNING_SLIDERS: PhysicsTuningSliderDef[] = [
  { key: 'ballRestitution', label: 'Ball Restitution', min: 0.5, max: 0.95, step: 0.01, group: 'ball' },
  { key: 'ballFriction', label: 'Ball Friction', min: 0.02, max: 0.3, step: 0.01, group: 'ball' },
  { key: 'ballLinearDamping', label: 'Linear Damping', min: 0.02, max: 0.25, step: 0.01, group: 'ball' },
  { key: 'ballAngularDamping', label: 'Angular Damping', min: 0.05, max: 0.35, step: 0.01, group: 'ball' },
  { key: 'bumperRestitution', label: 'Bumper Restitution', min: 0.7, max: 1.0, step: 0.01, group: 'obstacles' },
  { key: 'flipperStiffness', label: 'Flipper Stiffness', min: 12000, max: 50000, step: 500, group: 'flipper' },
  { key: 'flipperDamping', label: 'Flipper Damping', min: 400, max: 2000, step: 50, group: 'flipper' },
  { key: 'flipperKickImpulse', label: 'Flipper Kick', min: 0, max: 6, step: 0.1, group: 'flipper' },
  { key: 'plungerMinImpulse', label: 'Plunger Min', min: 6, max: 24, step: 0.5, group: 'launch' },
  { key: 'plungerMaxImpulse', label: 'Plunger Max', min: 20, max: 50, step: 0.5, group: 'launch' },
  { key: 'plungerChargeExponent', label: 'Charge Curve', min: 0.8, max: 2.0, step: 0.05, group: 'launch' },
  { key: 'nudgeForce', label: 'Nudge Force', min: 0.2, max: 1.2, step: 0.02, group: 'launch' },
  { key: 'nudgeVerticalBoost', label: 'Nudge Lift', min: 0, max: 0.6, step: 0.02, group: 'launch' },
  { key: 'spinnerTargetSpeed', label: 'Spinner RPM (rad/s)', min: 6, max: 24, step: 0.5, group: 'obstacles' },
  { key: 'trapHoldDuration', label: 'Trap Hold (s)', min: 0.5, max: 3.5, step: 0.1, group: 'obstacles' },
  { key: 'trapReleaseBoost', label: 'Trap Eject', min: 8, max: 28, step: 0.5, group: 'obstacles' },
]

export function getPhysicsTuningValue(key: PhysicsTuningKey): number {
  const override = overrides[key]
  if (override !== undefined) return override
  return BASE_VALUES[key]
}

export function setPhysicsTuningOverride(key: PhysicsTuningKey, value: number | undefined): void {
  if (value === undefined || Number.isNaN(value)) {
    delete overrides[key]
    return
  }
  overrides[key] = value
}

export function resetPhysicsTuningOverrides(): void {
  for (const key of Object.keys(overrides) as PhysicsTuningKey[]) {
    delete overrides[key]
  }
}

export function getPhysicsTuningOverrides(): Readonly<Partial<Record<PhysicsTuningKey, number>>> {
  return overrides
}

export function getPhysicsTuningBaseValue(key: PhysicsTuningKey): number {
  return BASE_VALUES[key]
}

/** Ease-in charge curve — rewards holding to full power without punishing quick taps. */
export function applyPlungerChargeCurve(rawCharge: number): number {
  const exponent = getPhysicsTuningValue('plungerChargeExponent')
  const clamped = Math.min(Math.max(rawCharge, 0), 1)
  return Math.pow(clamped, exponent)
}
