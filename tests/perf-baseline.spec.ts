import { expect, test } from '@playwright/test'
import {
  addBalls,
  bootForPerf,
  buildRunFile,
  collectCounts,
  collectEnv,
  perfConfig,
  probeAllocations,
  sampleFrames,
  startTable,
  toRepeatResult,
  waitForStaticScene,
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
 *
 * After each phase's timing sample, `probeAllocations` renders `PERF_ALLOC_FRAMES` (600) more frames
 * between two forced GCs and records the retained heap delta and the bytes allocated per frame
 * (#488 §5, zero-allocation hot path). `PERF_ALLOC_BUDGET_KB` turns the per-frame figure into a
 * (soft) gate; without it the probe is report-only like the timings.
 */
const cfg = perfConfig()

function formatKb(bytes: number | null | undefined): string {
  return typeof bytes === 'number' ? (bytes / 1024).toFixed(2) : 'n/a'
}

test.describe('perf baseline (opt-in)', () => {
  test.skip(!cfg.enabled, 'set PERF_BASELINE=1 to run the render-perf baseline')

  test('collect per-tier, per-state CPU frame timings', async ({ browser }, testInfo) => {
    const perFrameBudgetMs = 6000
    const phases = cfg.states.length
    test.setTimeout(
      cfg.repeats * cfg.tiers.length * (120_000 + phases * (cfg.warmup + cfg.frames + cfg.allocFrames) * perFrameBudgetMs),
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
          // `menu` must be sampled before `table`, and `table` before `table3`: startGame() leaves
          // the menu for good and the extra balls stay on the table.
          let started = false
          for (const state of cfg.states) {
            if (state !== 'menu' && !started) {
              await startTable(page)
              started = true
            }
            if (state === 'table3') await addBalls(page, 3)
            const settleFrames = await waitForStaticScene(page)
            const raw = await sampleFrames(page, cfg.warmup, cfg.frames, `rep${rep} ${tier}/${state}`)
            const [counts, env] = await Promise.all([collectCounts(page), collectEnv(page)])
            const alloc = cfg.allocFrames > 0 ? await probeAllocations(page, cfg.allocFrames) : null
            if (alloc && cfg.allocBudgetKbPerFrame !== null && alloc.allocatedPerFrameBytes !== null) {
              expect
                .soft(alloc.allocatedPerFrameBytes / 1024, `rep${rep} ${tier}/${state}: KB allocated per frame`)
                .toBeLessThanOrEqual(cfg.allocBudgetKbPerFrame)
            }
            const list = results.get(keyOf(tier, state)) ?? []
            list.push(toRepeatResult(raw, counts, env, settleFrames, alloc))
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
            `draws ${run.aggregate.counts.drawCalls}, active ${run.aggregate.counts.activeMeshes}/${run.aggregate.counts.meshes}, ` +
            `frozen mats ${run.aggregate.counts.materialsFrozen}/${run.aggregate.counts.materials}, ` +
            `shadow renders/frame ${run.aggregate.counts.shadowRendersPerFrame?.toFixed(2) ?? 'n/a'}, ` +
            `refreezes ${run.aggregate.counts.refreezeCount ?? 'n/a'}, gate ${run.aggregate.counts.gateState ?? 'n/a'} ` +
            `(list frozen ${run.aggregate.counts.activeListFrozen ?? 'n/a'}, settled in ${run.aggregate.counts.settleFrames ?? 'n/a'} frames) ` +
            `alloc ${formatKb(run.aggregate.alloc?.allocatedPerFrameBytes)} KB/frame, ` +
            `heap Δ ${formatKb(run.aggregate.alloc?.heapDeltaPerFrameBytes)} KB/frame ` +
            `over ${run.aggregate.alloc?.frames ?? 0} frames (${run.aggregate.alloc?.heapSource ?? 'off'}) ` +
            `[${run.env.physicsEngine}, ${run.env.qualityTier}]`,
        )
      }
    }
    console.log(`[perf:${cfg.label}]\n${summary.join('\n')}`)
  })
})
