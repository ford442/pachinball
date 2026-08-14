import { describe, it, expect } from 'vitest'
import { KEEP_OUT_BOXES } from '../src/game-elements/daily-cascade-layout'

/**
 * Vanilla pachinko grid must leave the plunger corridor empty.
 * Pins in that lane bounced every launch into hologram catchers / feeders.
 */
describe('plunger launch lane keep-out', () => {
  it('defines a launch-lane keep-out covering the plunger corridor', () => {
    const launch = KEEP_OUT_BOXES.find((b) => b.label === 'launchLane')
    expect(launch).toBeDefined()
    expect(launch!.minX).toBeLessThanOrEqual(8.5)
    expect(launch!.maxX).toBeGreaterThanOrEqual(11)
    expect(launch!.minZ).toBeLessThanOrEqual(-9)
    expect(launch!.maxZ).toBeGreaterThanOrEqual(14)
  })

  it('vanilla pin lattice would place samples inside the keep-out (regression probe)', () => {
    // Mirrors object-pachinko.ts default grid params — if this probe ever fails,
    // the field geometry changed and the keep-out filter may need retuning.
    const center = { x: 0, z: 6 }
    const width = 24
    const height = 22
    const rows = 10
    const cols = 13
    const spacingX = width / cols
    const spacingZ = height / rows
    const launch = KEEP_OUT_BOXES.find((b) => b.label === 'launchLane')!

    let wouldHitLane = 0
    for (let r = 0; r < rows; r++) {
      const offsetX = r % 2 === 0 ? 0 : spacingX / 2
      for (let c = 0; c < cols; c++) {
        const x = center.x - width / 2 + c * spacingX + offsetX
        const z = center.z - height / 2 + r * spacingZ
        if (x >= launch.minX && x <= launch.maxX && z >= launch.minZ && z <= launch.maxZ) {
          wouldHitLane++
        }
      }
    }
    // Without the keep-out filter the default grid still collides with the lane.
    expect(wouldHitLane).toBeGreaterThan(0)
  })
})
