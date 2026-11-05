import { describe, expect, it } from 'vitest'
import { PairDebounce } from '../src/game/physics/pair-debounce'

/** The string-keyed debounce PairDebounce replaced (collision-dispatch before #505 §D). */
class LegacyDebounce {
  private readonly last = new Map<string, number>()
  constructor(private readonly windowMs: number) {}
  hit(a: number, b: number, now: number): boolean {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`
    const last = this.last.get(key)
    if (last !== undefined && now >= last && now - last < this.windowMs) return true
    this.last.set(key, now)
    return false
  }
}

describe('PairDebounce', () => {
  it('swallows a repeat inside the window, in either handle order', () => {
    const d = new PairDebounce(16)
    expect(d.hit(3, 7, 100)).toBe(false)
    expect(d.hit(7, 3, 110)).toBe(true)
    expect(d.hit(3, 7, 116)).toBe(false)
  })

  it('starts a fresh timeline when the clock goes backwards (physics world replaced)', () => {
    const d = new PairDebounce(16)
    d.hit(1, 2, 500)
    expect(d.hit(3, 4, 100)).toBe(false)
    expect(d.size).toBe(1)

    // A stamp from the old timeline would have swallowed this hit; the new one does not.
    const legacy = new LegacyDebounce(16)
    for (const x of [d, legacy]) {
      x.hit(5, 6, 110)
      x.hit(7, 8, 600)
    }
    expect(legacy.hit(5, 6, 115)).toBe(true)
    expect(d.hit(5, 6, 115)).toBe(false)
  })

  it('keeps distinct pairs apart, including Rapier-style non-integer handles', () => {
    const d = new PairDebounce(16)
    const rapierish = 5e-324
    expect(d.hit(rapierish, 2, 0)).toBe(false)
    expect(d.hit(1, 2, 1)).toBe(false)
    expect(d.hit(2, rapierish, 2)).toBe(true)
  })

  it('prunes inert entries so the store stays bounded', () => {
    const d = new PairDebounce(16, 8)
    for (let i = 0; i < 1000; i++) d.hit(i, i + 1, i * 20)
    expect(d.size).toBeLessThanOrEqual(9)
  })

  it('decides every hit exactly as the legacy string-keyed debounce on a monotonic clock', () => {
    const next = new PairDebounce(16, 4)
    const legacy = new LegacyDebounce(16)
    let seed = 12345
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    let now = 0
    for (let i = 0; i < 20000; i++) {
      // 0–2 fixed steps between contacts, like simNowMs (steps × FIXED_TIMESTEP).
      now += Math.floor(rnd() * 3) * (1000 / 60)
      const a = Math.floor(rnd() * 12)
      const b = Math.floor(rnd() * 12)
      expect(next.hit(a, b, now)).toBe(legacy.hit(a, b, now))
    }
  })
})
