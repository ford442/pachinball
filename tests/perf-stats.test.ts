import { describe, expect, it } from 'vitest'
import {
  compareRuns,
  formatMarkdown,
  mad,
  median,
  medianOfMedians,
  pctDelta,
  percentile,
  summarize,
} from '../scripts/perf-stats.mjs'

describe('perf-stats', () => {
  it('median handles odd, even and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBe(0)
  })

  it('mad is robust to a single outlier', () => {
    expect(mad([10, 10, 10, 10, 1000])).toBe(0)
    expect(mad([1, 2, 3, 4, 5])).toBe(1)
  })

  it('percentile uses nearest-rank', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(values, 95)).toBe(95)
    expect(percentile(values, 100)).toBe(100)
    expect(percentile([], 95)).toBe(0)
  })

  it('summarize drops non-finite samples', () => {
    const s = summarize([1, 2, 3, Number.NaN, Number.POSITIVE_INFINITY])
    expect(s.n).toBe(3)
    expect(s.median).toBe(2)
    expect(s.min).toBe(1)
    expect(s.max).toBe(3)
    expect(summarize([]).n).toBe(0)
  })

  it('medianOfMedians aggregates per-repeat medians', () => {
    const agg = medianOfMedians([{ median: 5 }, { median: 7 }, { median: 100 }])
    expect(agg.median).toBe(7)
    expect(agg.n).toBe(3)
  })

  it('pctDelta is signed and guards zero baselines', () => {
    expect(pctDelta(10, 7)).toBeCloseTo(-30)
    expect(pctDelta(10, 12)).toBeCloseTo(20)
    expect(pctDelta(0, 0)).toBe(0)
    expect(pctDelta(0, 5)).toBeNaN()
  })

  it('compareRuns pairs by tier/state and warns on engine mismatch and unmatched keys', () => {
    const run = (tier: string, state: string, render: number, engine: string, draw = 100) => ({
      tier,
      state,
      env: { physicsEngine: engine },
      aggregate: { renderTimeMs: { median: render }, counts: { drawCalls: draw } },
    })
    const { rows, warnings } = compareRuns(
      [run('medium', 'table', 10, 'rapier'), run('low', 'menu', 4, 'rapier')],
      [run('medium', 'table', 7, 'wasm-owner', 40), run('high', 'menu', 5, 'rapier')],
    )
    const render = rows.find((r) => r.key === 'medium/table' && r.metric.startsWith('renderTimeMs'))
    expect(render?.deltaPct).toBeCloseTo(-30)
    const draw = rows.find((r) => r.key === 'medium/table' && r.metric === 'drawCalls')
    expect(draw?.deltaPct).toBeCloseTo(-60)
    expect(warnings.some((w) => w.includes('physics engine differs'))).toBe(true)
    expect(warnings).toContain('only in "before": low/menu')
    expect(warnings).toContain('only in "after": high/menu')
  })

  it('formatMarkdown renders a signed delta column', () => {
    const md = formatMarkdown([{ key: 'medium/table', metric: 'renderTimeMs (median)', before: 10, after: 7, deltaPct: -30 }])
    expect(md).toContain('| medium/table | renderTimeMs (median) | 10.00 | 7.00 | -30.0% |')
  })
})
