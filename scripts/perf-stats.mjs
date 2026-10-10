/**
 * Pure statistics + comparison helpers for the render-perf baseline harness
 * (tests/perf-baseline.spec.ts writes the JSON, scripts/perf-compare.mjs reads it).
 *
 * Kept dependency-free and side-effect-free so Vitest can import it directly
 * (tests/perf-stats.test.ts) and the CLI can reuse it.
 */

/** @param {number[]} values */
export function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Median absolute deviation — a robust spread estimate for noisy SwiftShader timings. */
export function mad(values) {
  if (values.length === 0) return 0
  const m = median(values)
  return median(values.map((v) => Math.abs(v - m)))
}

/** Nearest-rank percentile, p in [0, 100]. */
export function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

/**
 * @param {number[]} values
 * @returns {{ n: number, median: number, mad: number, p95: number, mean: number, min: number, max: number }}
 */
export function summarize(values) {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return { n: 0, median: 0, mad: 0, p95: 0, mean: 0, min: 0, max: 0 }
  const sum = finite.reduce((a, b) => a + b, 0)
  return {
    n: finite.length,
    median: median(finite),
    mad: mad(finite),
    p95: percentile(finite, 95),
    mean: sum / finite.length,
    min: Math.min(...finite),
    max: Math.max(...finite),
  }
}

/**
 * "Median of medians": the headline number for a metric across repeated runs.
 * Each repeat contributes its own median; the aggregate is the median of those,
 * and the spread is the MAD of the per-repeat medians.
 *
 * @param {Array<{ median: number }>} summaries
 */
export function medianOfMedians(summaries) {
  const medians = summaries.map((s) => s.median)
  return { n: medians.length, median: median(medians), mad: mad(medians) }
}

/** Signed percent change from `before` to `after`; negative = faster/smaller. */
export function pctDelta(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return Number.NaN
  if (before === 0) return after === 0 ? 0 : Number.NaN
  return ((after - before) / before) * 100
}

/**
 * Metrics shown by the comparison table: [label, accessor over a run's `aggregate`].
 * Accessors tolerate older/partial JSON (return undefined → row skipped).
 */
export const COMPARE_METRICS = [
  ['renderTimeMs (median)', (a) => a.renderTimeMs?.median],
  ['frameTimeMs (median)', (a) => a.frameTimeMs?.median],
  ['physicsStepMs (median)', (a) => a.physicsStepMs?.median],
  ['activeMeshesEvalMs (median)', (a) => a.activeMeshesEvalMs?.median],
  ['rttRenderMs (median)', (a) => a.rttRenderMs?.median],
  ['drawPhaseMs (median)', (a) => a.drawPhaseMs?.median],
  ['drawCalls', (a) => a.counts?.drawCalls],
  ['activeMeshes', (a) => a.counts?.activeMeshes],
  ['meshes', (a) => a.counts?.meshes],
  ['materials', (a) => a.counts?.materials],
]

/**
 * Compare two sets of runs keyed by `${tier}/${state}`.
 *
 * @param {Array<{ tier: string, state: string, aggregate: Record<string, any>, env?: Record<string, any> }>} before
 * @param {Array<{ tier: string, state: string, aggregate: Record<string, any>, env?: Record<string, any> }>} after
 * @returns {{ rows: Array<{ key: string, metric: string, before: number, after: number, deltaPct: number }>, warnings: string[] }}
 */
export function compareRuns(before, after) {
  const warnings = []
  const rows = []
  const index = (runs) => new Map(runs.map((r) => [`${r.tier}/${r.state}`, r]))
  const a = index(before)
  const b = index(after)
  for (const [key, runA] of a) {
    const runB = b.get(key)
    if (!runB) {
      warnings.push(`only in "before": ${key}`)
      continue
    }
    const engineA = runA.env?.physicsEngine
    const engineB = runB.env?.physicsEngine
    if (engineA && engineB && engineA !== engineB) {
      warnings.push(
        `${key}: physics engine differs (${engineA} vs ${engineB}) — renderTimeMs is only comparable within one engine`,
      )
    }
    for (const [metric, get] of COMPARE_METRICS) {
      const vA = get(runA.aggregate ?? {})
      const vB = get(runB.aggregate ?? {})
      if (typeof vA !== 'number' || typeof vB !== 'number') continue
      rows.push({ key, metric, before: vA, after: vB, deltaPct: pctDelta(vA, vB) })
    }
  }
  for (const key of b.keys()) {
    if (!a.has(key)) warnings.push(`only in "after": ${key}`)
  }
  return { rows, warnings }
}

function fmt(n) {
  if (!Number.isFinite(n)) return 'n/a'
  return Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2)
}

/** Render comparison rows as a GitHub-flavoured markdown table (paste into docs/RENDER_BUDGET.md). */
export function formatMarkdown(rows) {
  const lines = ['| tier/state | metric | before | after | Δ% |', '|---|---|---:|---:|---:|']
  for (const r of rows) {
    const d = Number.isFinite(r.deltaPct) ? `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct.toFixed(1)}%` : 'n/a'
    lines.push(`| ${r.key} | ${r.metric} | ${fmt(r.before)} | ${fmt(r.after)} | ${d} |`)
  }
  return lines.join('\n')
}
