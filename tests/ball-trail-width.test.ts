/**
 * Trail ribbon width follows ball speed (#505 §C).
 *
 * `TrailMesh` exposes its ribbon width as `diameter`; the old code wrote a non-existent
 * `width` through an `as unknown as` cast, so trails never widened. These tests read
 * `diameter` (and fail on the old tree, where it stays at its constructor value).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/audio/sound-system', () => ({ getSoundSystem: () => ({ playSample: vi.fn() }) }))
vi.mock('../src/adventure/campaign-rewards-manager', () => ({ getCampaignRewardsManager: () => null }))

import { trailWidthMultiplier, updateTrailEffects } from '../src/game-elements/ball-manager-spawn'
import type { BallManagerHost } from '../src/game-elements/ball-manager-context'

interface FakeTrail {
  diameter: number
}
interface FakeMaterial {
  alpha: number
  emissiveColor: { r: number; g: number; b: number }
}

function makeHost(speed: number, baseWidth: number, isFading = false) {
  const mesh: FakeTrail = { diameter: baseWidth }
  const material: FakeMaterial = { alpha: 1, emissiveColor: { r: 0.5, g: 0.5, b: 0.5 } }
  const body = { linvel: () => ({ x: speed, y: 0, z: 0 }) }
  const ballTrails = new Map([[body, { mesh, material, baseWidth, isFading }]])
  const host = { ballTrails } as unknown as BallManagerHost
  return { host, mesh, material }
}

describe('updateTrailEffects', () => {
  it('writes the TrailMesh diameter, widening with speed', () => {
    const { host, mesh } = makeHost(15, 0.3)
    updateTrailEffects(host)
    expect(mesh.diameter).toBeCloseTo(0.3 * 1.5)
  })

  it('caps the multiplier at 2× and keeps 1× at rest', () => {
    expect(trailWidthMultiplier(0)).toBe(1)
    expect(trailWidthMultiplier(300)).toBe(2)

    const fast = makeHost(300, 0.4)
    updateTrailEffects(fast.host)
    expect(fast.mesh.diameter).toBeCloseTo(0.8)
  })

  it('tints in place without replacing the colour object', () => {
    // (The Babylon test mock parses every hex string as cyan, so only the write is checked.)
    const { host, material } = makeHost(40, 0.3)
    const colour = material.emissiveColor
    updateTrailEffects(host)
    expect(material.emissiveColor).toBe(colour)
    expect(colour).not.toEqual({ r: 0.5, g: 0.5, b: 0.5 })
  })

  it('fades a caught ball toward black and leaves its width alone', () => {
    const { host, mesh, material } = makeHost(40, 0.3, true)
    updateTrailEffects(host)
    expect(mesh.diameter).toBe(0.3)
    expect(material.alpha).toBeCloseTo(0.95)
    expect(material.emissiveColor.r).toBeCloseTo(0.45)
  })
})
