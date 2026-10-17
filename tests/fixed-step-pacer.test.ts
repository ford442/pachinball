/**
 * #444 — render frames → whole fixed steps. Over the same wall time every
 * display rate takes the same number of steps, a pinned 60 Hz host takes
 * exactly one per frame, and a stall catches up at most MAX_FRAME_DT.
 */
import { describe, expect, it } from 'vitest'
import { FIXED_TIMESTEP, FixedStepPacer, MAX_FRAME_DT } from '../src/core/sim-clock'

function stepsOver(frameMs: number, frames: number): number[] {
  const pacer = new FixedStepPacer()
  return Array.from({ length: frames }, () => pacer.stepsFor(frameMs / 1000))
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('FixedStepPacer (#444)', () => {
  it('a host pinned to 1000 / 60 ms takes exactly one step every frame', () => {
    expect(stepsOver(1000 / 60, 600).every((n) => n === 1)).toBe(true)
  })

  it('one wall second is 60 steps at 30, 60, 120 and 144 Hz', () => {
    for (const hz of [30, 60, 120, 144]) {
      const total = sum(stepsOver(1000 / hz, hz))
      // The boundary frame may land either side of the 60th step.
      expect(total, `${hz} Hz`).toBeGreaterThanOrEqual(59)
      expect(total, `${hz} Hz`).toBeLessThanOrEqual(60)
    }
  })

  it('a 144 Hz display takes zero or one step per frame, 30 Hz takes two', () => {
    expect(new Set(stepsOver(1000 / 144, 288))).toEqual(new Set([0, 1]))
    expect(stepsOver(1000 / 30, 30).every((n) => n === 2)).toBe(true)
  })

  it('a stall catches up at most MAX_FRAME_DT, and bad deltas take no step', () => {
    const pacer = new FixedStepPacer()
    expect(pacer.stepsFor(5)).toBe(Math.round(MAX_FRAME_DT / FIXED_TIMESTEP))
    expect(pacer.stepsFor(-1)).toBe(0)
    expect(pacer.stepsFor(Number.NaN)).toBe(0)
  })

  it('alpha is how far the frame is into the next step', () => {
    const pacer = new FixedStepPacer()
    pacer.stepsFor(FIXED_TIMESTEP * 0.25)
    expect(pacer.alpha()).toBeCloseTo(0.25, 9)
    expect(pacer.stepsFor(FIXED_TIMESTEP)).toBe(1)
    expect(pacer.alpha()).toBeCloseTo(0.25, 9)
  })
})
