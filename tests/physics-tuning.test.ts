import { describe, expect, it, beforeEach } from 'vitest'
import {
  applyPlungerChargeCurve,
  getPhysicsTuningBaseValue,
  getPhysicsTuningValue,
  resetPhysicsTuningOverrides,
  setPhysicsTuningOverride,
} from '../src/game-elements/physics-tuning'

describe('physics-tuning runtime overrides', () => {
  beforeEach(() => {
    resetPhysicsTuningOverrides()
  })

  it('returns base PhysicsConfig values by default', () => {
    expect(getPhysicsTuningValue('ballRestitution')).toBe(getPhysicsTuningBaseValue('ballRestitution'))
    expect(getPhysicsTuningValue('flipperStiffness')).toBeGreaterThan(20000)
  })

  it('applies live overrides for tuning panel sliders', () => {
    setPhysicsTuningOverride('nudgeForce', 0.95)
    expect(getPhysicsTuningValue('nudgeForce')).toBe(0.95)
    resetPhysicsTuningOverrides()
    expect(getPhysicsTuningValue('nudgeForce')).toBe(getPhysicsTuningBaseValue('nudgeForce'))
  })

  it('eases plunger charge toward full power', () => {
    const half = applyPlungerChargeCurve(0.5)
    expect(half).toBeLessThan(0.5)
    expect(applyPlungerChargeCurve(1)).toBe(1)
    expect(applyPlungerChargeCurve(0)).toBe(0)
  })
})
