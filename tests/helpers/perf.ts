import { expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { medianOfMedians, summarize } from '../../scripts/perf-stats.mjs'

export type PerfTier = 'low' | 'medium' | 'high'
export type PerfState = 'menu' | 'table'

export interface PerfConfig {
  enabled: boolean
  label: string
  tiers: PerfTier[]
  states: PerfState[]
  /** Measured frames per repeat/phase. */
  frames: number
  /** Frames discarded before measuring. */
  warmup: number
  repeats: number
  /**
   * Browser viewport. Deliberately small: under SwiftShader the wall-clock frame rate is dominated by
   * software rasterisation (≈0.3 fps at 1280×720), while the main-thread CPU time we measure barely
   * depends on resolution — so a small canvas makes the run ~10× faster without changing the metric.
   */
  viewport: { width: number; height: number }
  outDir: string
}

function list<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T[]): T[] {
  if (!raw) return fallback
  const wanted = raw.split(',').map((s) => s.trim()).filter(Boolean)
  const picked = wanted.filter((w): w is T => (allowed as readonly string[]).includes(w))
  return picked.length > 0 ? picked : fallback
}

function size(raw: string | undefined, fallback: { width: number; height: number }): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(raw ?? '')
  return m ? { width: Number(m[1]), height: Number(m[2]) } : fallback
}

function int(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * The harness is opt-in (`PERF_BASELINE=1`) and report-only: SwiftShader timings are noisy and
 * a full run takes minutes, so it never gates CI. See docs/RENDER_BUDGET.md.
 *
 *   PERF_BASELINE=1 PERF_LABEL=before-A PERF_TIERS=low,medium,high npx playwright test tests/perf-baseline.spec.ts
 */
export function perfConfig(env: NodeJS.ProcessEnv = process.env): PerfConfig {
  return {
    enabled: env.PERF_BASELINE === '1',
    label: (env.PERF_LABEL ?? 'baseline').replace(/[^A-Za-z0-9_.-]/g, '_'),
    tiers: list<PerfTier>(env.PERF_TIERS, ['low', 'medium', 'high'], ['medium']),
    states: list<PerfState>(env.PERF_STATES, ['menu', 'table'], ['menu', 'table']),
    frames: int(env.PERF_FRAMES, 120),
    warmup: int(env.PERF_WARMUP, 30),
    repeats: int(env.PERF_REPEATS, 3),
    viewport: size(env.PERF_VIEWPORT, { width: 640, height: 360 }),
    outDir: env.PERF_OUT_DIR ?? 'test-results/perf',
  }
}

/** The slice of `window.game` the harness touches (all optional: the page may still be booting). */
interface PerfGameHooks {
  ready?: boolean
  qualityTier?: string
  scene?: {
    meshes: unknown[]
    materials: unknown[]
    lights: unknown[]
    textures: unknown[]
    getActiveMeshes: () => { length: number }
  }
  engine?: {
    _drawCalls?: { current?: number }
    _gl?: WebGLRenderingContext
  }
  shadowGenerator?: { getShadowMap?: () => { renderList?: unknown[] } | null } | null
  stateManager?: { isPlaying?: () => boolean }
  renderer?: { applyQualityTier: (tier: string) => void }
  debugHelper?: { initializeDebugInstrumentation: () => void } | null
  sceneInstrumentation?: {
    captureActiveMeshesEvaluationTime: boolean
    captureRenderTargetsRenderTime: boolean
    captureRenderTime: boolean
    activeMeshesEvaluationTimeCounter: { current: number }
    renderTargetsRenderTimeCounter: { current: number }
    renderTimeCounter: { current: number }
  } | null
  physicsController?: { stepPhysics: (...args: unknown[]) => unknown } | null
  physics?: { getWasmMode?: () => string }
  renderFrame: () => void
  startGame: () => Promise<void>
}

type PerfWindow = Window & {
  __perfProgress?: { seen: number; total: number; lastFrameMs: number }
  game?: PerfGameHooks
  currentPhysicsEngine?: string
  currentRenderer?: string
  bootstrapGpuProbe?: { postProcessTier?: string | null }
}

export interface RawSamples {
  frame: number[]
  physics: number[]
  activeMeshesEval: number[]
  rttRender: number[]
  drawPhase: number[]
}

export interface SceneCounts {
  meshes: number
  activeMeshes: number
  materials: number
  lights: number
  textures: number
  drawCalls: number
  shadowCasters: number | null
}

export interface PerfEnv {
  physicsEngine: string
  renderer: string
  qualityTier: string
  postProcessTier: string | null
  gpu: string | null
  userAgent: string
}

export interface RepeatResult {
  frames: number
  frameTimeMs: ReturnType<typeof summarize>
  physicsStepMs: ReturnType<typeof summarize>
  renderTimeMs: ReturnType<typeof summarize>
  activeMeshesEvalMs: ReturnType<typeof summarize>
  rttRenderMs: ReturnType<typeof summarize>
  drawPhaseMs: ReturnType<typeof summarize>
  counts: SceneCounts
  env: PerfEnv
}

/** Boot the game (WebGL2, debug tooling on so SceneInstrumentation can be created) and settle it. */
export async function bootForPerf(page: Page, tier: PerfTier): Promise<void> {
  await page.goto('/?renderer=webgl2&debug=1')
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 60_000 })
  await page.waitForFunction(() => !!(window as PerfWindow).game?.ready, undefined, { timeout: 90_000 })
  await waitForSceneSettle(page)
  await page.evaluate((t) => {
    ;(window as PerfWindow).game?.renderer?.applyQualityTier(t)
  }, tier)
  await waitForSceneSettle(page)
}

/**
 * The cosmetic scene (strip lights, decor) is built in an idle callback and the cabinet glTF
 * loads asynchronously, so wait until the mesh count stops changing.
 */
export async function waitForSceneSettle(page: Page, stableMs = 2000, maxMs = 30_000): Promise<void> {
  const start = Date.now()
  let last = -1
  let stableSince = Date.now()
  while (Date.now() - start < maxMs) {
    const count = await page.evaluate(() => (window as PerfWindow).game?.scene?.meshes.length ?? 0)
    if (count !== last) {
      last = count
      stableSince = Date.now()
    } else if (Date.now() - stableSince >= stableMs) {
      return
    }
    await page.waitForTimeout(500)
  }
}

export async function startTable(page: Page): Promise<void> {
  const ok = await page.evaluate(async () => {
    const g = (window as PerfWindow).game
    await g?.startGame()
    return g?.stateManager?.isPlaying?.() === true
  })
  expect(ok, 'startGame() should put the game in PLAYING').toBe(true)
  await waitForSceneSettle(page)
}

/**
 * Sample per-frame CPU timings by wrapping `game.renderFrame` (the engine loop calls it
 * dynamically) and `physicsController.stepPhysics` (called from the scene's onBeforeRender, so
 * it is inside `scene.render()` — render time is frame minus physics).
 */
export async function sampleFrames(page: Page, warmup: number, frames: number, tag = ''): Promise<RawSamples> {
  // PERF_VERBOSE=1 logs frame progress every 10 s — the way to spot a frame-rate collapse mid-run.
  const timer =
    process.env.PERF_VERBOSE === '1'
      ? setInterval(() => {
          page
            .evaluate(() => (window as PerfWindow).__perfProgress)
            .then((p) => console.log(`[perf:progress] ${tag} ${p ? `${p.seen}/${p.total} (last ${p.lastFrameMs.toFixed(1)}ms)` : 'n/a'}`))
            .catch(() => undefined)
        }, 10_000)
      : null
  try {
    return await sampleFramesInPage(page, warmup, frames)
  } finally {
    if (timer) clearInterval(timer)
  }
}

function sampleFramesInPage(page: Page, warmup: number, frames: number): Promise<RawSamples> {
  return page.evaluate(
    ({ warmup: w, frames: n }) =>
      new Promise<RawSamples>((resolve, reject) => {
        const g = (window as PerfWindow).game
        if (!g) {
          reject(new Error('window.game missing'))
          return
        }
        g.debugHelper?.initializeDebugInstrumentation()
        const inst = g.sceneInstrumentation ?? null
        if (inst) {
          inst.captureActiveMeshesEvaluationTime = true
          inst.captureRenderTargetsRenderTime = true
          inst.captureRenderTime = true
        }

        const originalRender = g.renderFrame
        const pc = g.physicsController ?? null
        const originalStep = pc?.stepPhysics
        let physicsMs = 0
        if (pc && originalStep) {
          pc.stepPhysics = function (this: unknown, ...args: unknown[]) {
            const t = performance.now()
            try {
              return originalStep.apply(this, args)
            } finally {
              physicsMs += performance.now() - t
            }
          }
        }

        const out: RawSamples = { frame: [], physics: [], activeMeshesEval: [], rttRender: [], drawPhase: [] }
        let seen = 0
        let lastFrameAt = performance.now()
        const progress = { seen: 0, total: w + n, lastFrameMs: 0 }
        ;(window as PerfWindow).__perfProgress = progress
        const restore = (): void => {
          g.renderFrame = originalRender
          if (pc && originalStep) pc.stepPhysics = originalStep
        }
        // Fail on a stalled render loop (no frame for 2 minutes), not on a total-time budget:
        // SwiftShader frame times vary by an order of magnitude between machines.
        const guard = window.setInterval(() => {
          if (performance.now() - lastFrameAt < 120_000) return
          window.clearInterval(guard)
          restore()
          reject(new Error(`sampleFrames stalled: no frame for 120s after ${seen}/${w + n} frames`))
        }, 5000)

        g.renderFrame = function (this: PerfGameHooks) {
          physicsMs = 0
          const t0 = performance.now()
          originalRender.call(g)
          const frameMs = performance.now() - t0
          seen++
          lastFrameAt = performance.now()
          progress.seen = seen
          progress.lastFrameMs = frameMs
          if (seen > w) {
            out.frame.push(frameMs)
            out.physics.push(physicsMs)
            out.activeMeshesEval.push(inst?.activeMeshesEvaluationTimeCounter.current ?? Number.NaN)
            out.rttRender.push(inst?.renderTargetsRenderTimeCounter.current ?? Number.NaN)
            out.drawPhase.push(inst?.renderTimeCounter.current ?? Number.NaN)
          }
          if (seen >= w + n) {
            window.clearInterval(guard)
            restore()
            resolve(out)
          }
        }
      }),
    { warmup, frames },
  )
}

export async function collectCounts(page: Page): Promise<SceneCounts> {
  return page.evaluate(() => {
    const g = (window as PerfWindow).game
    const scene = g?.scene
    const casters = g?.shadowGenerator?.getShadowMap?.()?.renderList
    return {
      meshes: scene?.meshes.length ?? 0,
      activeMeshes: scene?.getActiveMeshes().length ?? 0,
      materials: scene?.materials.length ?? 0,
      lights: scene?.lights.length ?? 0,
      textures: scene?.textures.length ?? 0,
      drawCalls: g?.engine?._drawCalls?.current ?? 0,
      shadowCasters: casters ? casters.length : null,
    }
  })
}

export async function collectEnv(page: Page): Promise<PerfEnv> {
  return page.evaluate(() => {
    const w = window as PerfWindow
    const g = w.game
    let gpu: string | null = null
    try {
      const gl = g?.engine?._gl
      const ext = gl?.getExtension('WEBGL_debug_renderer_info')
      if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
    } catch {
      gpu = null
    }
    return {
      physicsEngine: w.currentPhysicsEngine ?? g?.physics?.getWasmMode?.() ?? 'unknown',
      renderer: w.currentRenderer ?? 'unknown',
      qualityTier: g?.qualityTier ?? 'unknown',
      postProcessTier: w.bootstrapGpuProbe?.postProcessTier ?? null,
      gpu,
      userAgent: navigator.userAgent,
    }
  })
}

export function toRepeatResult(raw: RawSamples, counts: SceneCounts, env: PerfEnv): RepeatResult {
  const render = raw.frame.map((f, i) => f - (raw.physics[i] ?? 0))
  return {
    frames: raw.frame.length,
    frameTimeMs: summarize(raw.frame),
    physicsStepMs: summarize(raw.physics),
    renderTimeMs: summarize(render),
    activeMeshesEvalMs: summarize(raw.activeMeshesEval),
    rttRenderMs: summarize(raw.rttRender),
    drawPhaseMs: summarize(raw.drawPhase),
    counts,
    env,
  }
}

export interface RunFile {
  schema: 1
  label: string
  tier: PerfTier
  state: PerfState
  config: { frames: number; warmup: number; repeats: number }
  repeats: RepeatResult[]
  aggregate: {
    renderTimeMs: ReturnType<typeof medianOfMedians>
    frameTimeMs: ReturnType<typeof medianOfMedians>
    physicsStepMs: ReturnType<typeof medianOfMedians>
    activeMeshesEvalMs: ReturnType<typeof medianOfMedians>
    rttRenderMs: ReturnType<typeof medianOfMedians>
    drawPhaseMs: ReturnType<typeof medianOfMedians>
    counts: SceneCounts
  }
  env: PerfEnv
}

export function buildRunFile(
  cfg: PerfConfig,
  tier: PerfTier,
  state: PerfState,
  repeats: RepeatResult[],
): RunFile {
  const last = repeats[repeats.length - 1]
  const agg = (pick: (r: RepeatResult) => ReturnType<typeof summarize>) => medianOfMedians(repeats.map(pick))
  return {
    schema: 1,
    label: cfg.label,
    tier,
    state,
    config: { frames: cfg.frames, warmup: cfg.warmup, repeats: cfg.repeats },
    repeats,
    aggregate: {
      renderTimeMs: agg((r) => r.renderTimeMs),
      frameTimeMs: agg((r) => r.frameTimeMs),
      physicsStepMs: agg((r) => r.physicsStepMs),
      activeMeshesEvalMs: agg((r) => r.activeMeshesEvalMs),
      rttRenderMs: agg((r) => r.rttRenderMs),
      drawPhaseMs: agg((r) => r.drawPhaseMs),
      counts: last.counts,
    },
    env: last.env,
  }
}

export function writeRunFile(cfg: PerfConfig, run: RunFile): string {
  mkdirSync(cfg.outDir, { recursive: true })
  const file = join(cfg.outDir, `${run.label}-${run.tier}-${run.state}.json`)
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`)
  return file
}
