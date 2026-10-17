import { test } from '@playwright/test'
import {
  bootForPerf,
  buildRunFile,
  collectCounts,
  collectEnv,
  perfConfig,
  sampleFrames,
  startTable,
  toRepeatResult,
  writeRunFile,
  type PerfState,
  type PerfTier,
  type RepeatResult,
} from './helpers/perf'

/**
 * Render-perf baseline (docs/RENDER_BUDGET.md). Opt-in and report-only:
 *
 *   PERF_BASELINE=1 PERF_LABEL=before PERF_TIERS=low,medium,high npx playwright test tests/perf-baseline.spec.ts --project=chromium
 *   node scripts/perf-compare.mjs before after
 *
 * Repeats are interleaved across tiers (rep → tier → state) so slow drift on the machine
 * hits every tier equally; the headline number per metric is the median of per-repeat medians.
 * `renderTimeMs` = frame time minus the physics step, because slices A/B only touch rendering.
 * Never compare runs recorded with different `env.physicsEngine` (CI has no public/wasm, so
 * physics falls back to main-thread Rapier and dominates frame time).
 */
const cfg = perfConfig()

test.describe('perf baseline (opt-in)', () => {
  test.skip(!cfg.enabled, 'set PERF_BASELINE=1 to run the render-perf baseline')

  test('collect per-tier, per-state CPU frame timings', async ({ browser }, testInfo) => {
    const perFrameBudgetMs = 6000
    const phases = cfg.states.length
    test.setTimeout(
      cfg.repeats * cfg.tiers.length * (120_000 + phases * (cfg.warmup + cfg.frames) * perFrameBudgetMs),
    )

    const use = testInfo.project.use
    const results = new Map<string, RepeatResult[]>()
    const keyOf = (tier: PerfTier, state: PerfState) => `${tier}/${state}`

    for (let rep = 0; rep < cfg.repeats; rep++) {
      for (const tier of cfg.tiers) {
        const context = await browser.newContext({
          baseURL: use.baseURL,
          viewport: cfg.viewport,
          userAgent: use.userAgent,
          deviceScaleFactor: use.deviceScaleFactor,
        })
        const page = await context.newPage()
        try {
          await bootForPerf(page, tier)
          // `menu` must be sampled before `table`: startGame() leaves the menu for good.
          for (const state of cfg.states) {
            if (state === 'table') await startTable(page)
            const raw = await sampleFrames(page, cfg.warmup, cfg.frames, `rep${rep} ${tier}/${state}`)
            const [counts, env] = await Promise.all([collectCounts(page), collectEnv(page)])
            const list = results.get(keyOf(tier, state)) ?? []
            list.push(toRepeatResult(raw, counts, env))
            results.set(keyOf(tier, state), list)
          }
        } finally {
          await context.close()
        }
      }
    }

    const summary: string[] = []
    for (const tier of cfg.tiers) {
      for (const state of cfg.states) {
        const repeats = results.get(keyOf(tier, state))
        if (!repeats || repeats.length === 0) continue
        const run = buildRunFile(cfg, tier, state, repeats)
        const file = writeRunFile(cfg, run)
        await testInfo.attach(`${tier}-${state}.json`, { path: file, contentType: 'application/json' })
        summary.push(
          `${tier}/${state}: render ${run.aggregate.renderTimeMs.median.toFixed(2)}ms ` +
            `(MAD ${run.aggregate.renderTimeMs.mad.toFixed(2)}), frame ${run.aggregate.frameTimeMs.median.toFixed(2)}ms, ` +
            `draws ${run.aggregate.counts.drawCalls}, active ${run.aggregate.counts.activeMeshes}/${run.aggregate.counts.meshes} ` +
            `[${run.env.physicsEngine}, ${run.env.qualityTier}]`,
        )
      }
    }
    console.log(`[perf:${cfg.label}]\n${summary.join('\n')}`)
  })
})
