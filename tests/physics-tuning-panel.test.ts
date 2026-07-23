import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isPhysicsTuningEnabled,
  isPhysicsTuningQueryEnabled,
} from '../src/game-elements/physics-tuning-panel'

describe('physics tuning panel gating', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('requires debug context for ?tune in production builds', () => {
    vi.stubGlobal('window', { location: { search: '?tune=1' } })
    vi.stubEnv('DEV', false)
    expect(isPhysicsTuningQueryEnabled()).toBe(false)

    vi.stubGlobal('window', { location: { search: '?tune=1&debug' } })
    expect(isPhysicsTuningQueryEnabled()).toBe(true)
  })

  it('enables tuning from developer settings without a query param', () => {
    expect(isPhysicsTuningEnabled(true, false)).toBe(true)
    expect(isPhysicsTuningEnabled(false, false)).toBe(false)
  })
})
