import { describe, expect, it } from 'vitest'
import { distance3, distanceSquared3 } from '../src/core/vec3-scalar'

describe('vec3-scalar', () => {
  it('matches Babylon Vector3.Distance / DistanceSquared bit for bit (same operation order)', () => {
    const a = { x: 0.1, y: -2.3, z: 7.77 }
    const b = { x: 3.3, y: 0.25, z: -1.5 }
    const x = a.x - b.x
    const y = a.y - b.y
    const z = a.z - b.z
    expect(distanceSquared3(a, b)).toBe(x * x + y * y + z * z)
    expect(distance3(a, b)).toBe(Math.sqrt(x * x + y * y + z * z))
    expect(distance3(b, a)).toBe(distance3(a, b))
    expect(distance3(a, a)).toBe(0)
  })
})
