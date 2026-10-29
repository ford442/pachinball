import { expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { median, medianOfMedians, summarize } from '../../scripts/perf-stats.mjs'

export type PerfTier = 'low' | 'medium' | 'high'
export type PerfState = 'menu' | 'table' | 'table3'

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
  /**
   * Frames of the allocation probe run after each phase's timing sample (`probeAllocations`); 0 skips it.
   * Separate from the timed frames because the sampling heap profiler adds its own overhead.
   */
  allocFrames: number
  /**
   * Optional budget in KB allocated per frame (`PERF_ALLOC_BUDGET_KB`). Unset: report-only, like every
   * other metric here. Set: a phase over budget fails the spec (soft assertion, so all phases still run).
   */
  allocBudgetKbPerFrame: number | null
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

/** Like `int` but `0` is a valid value (disables the probe). */
function intOrZero(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function positiveOrNull(raw: string | undefined): number | null {
  const n = Number.parseFloat(raw ?? '')
  return Number.isFinite(n) && n > 0 ? n : null
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
    states: list<PerfState>(env.PERF_STATES, ['menu', 'table', 'table3'], ['menu', 'table', 'table3']),
    frames: int(env.PERF_FRAMES, 120),
    warmup: int(env.PERF_WARMUP, 30),
    repeats: int(env.PERF_REPEATS, 3),
    viewport: size(env.PERF_VIEWPORT, { width: 640, height: 360 }),
    outDir: env.PERF_OUT_DIR ?? 'test-results/perf',
    allocFrames: intOrZero(env.PERF_ALLOC_FRAMES, 600),
    allocBudgetKbPerFrame: positiveOrNull(env.PERF_ALLOC_BUDGET_KB),
  }
}

/** The slice of Babylon's `Observable` the harness uses to count render-target renders. */
interface Observable {
  add: (callback: () => void) => unknown
  remove: (observer: unknown) => unknown
}

/** The slice of `window.game` the harness touches (all optional: the page may still be booting). */
interface PerfGameHooks {
  ready?: boolean
  qualityTier?: string
  scene?: {
    meshes: unknown[]
    materials: unknown[]
    lights: unknown[]
    textures: Array<{ getClassName?: () => string; onAfterRenderObservable?: Observable }>
    getActiveMeshes: () => { length: number }
    onAfterRenderObservable: Observable
    _activeMeshesFrozen?: boolean
  }
  engine?: {
    _drawCalls?: { current?: number }
    _gl?: WebGLRenderingContext
  }
  /** The key light's shadow generator; from #484 on it is the STATIC one (cabinet), and `dynamicShadowGenerator` joins it. */
  shadowGenerator?: {
    getShadowMap?: () => { renderList?: unknown[]; onAfterRenderObservable?: Observable } | null
  } | null
  /** Balls, flippers, bumpers, moving obstacles. Absent (null) on commits before the split. */
  dynamicShadowGenerator?: {
    getShadowMap?: () => { renderList?: unknown[]; onAfterRenderObservable?: Observable } | null
  } | null
  ballManager?: { spawnExtraBalls: (count: number) => void; getBallBodies: () => unknown[] } | null
  /** Present from the StaticSceneGate commit on; absent (null) on earlier commits. */
  staticSceneGate?: { refreezeCount: number; getStats?: () => { state: string } } | null
  stateManager?: { isPlaying?: () => boolean }
  renderer?: { applyQualityTier: (tier: string) => void }
  performanceMonitor?: { setOnSustainedJank?: (callback: null) => void } | null
  debugHelper?: { initializeDebugInstrumentation: () => void } | null
  sceneInstrumentation?: {
    captureActiveMeshesEvaluationTime: boolean
    captureRenderTargetsRenderTime: boolean
    captureRenderTime: boolean
    activeMeshesEvaluationTimeCounter: { current: number }
    renderTargetsRenderTimeCounter: { current: number }
    renderTimeCounter: { current: number }
  } | null
  physicsController?: { stepFixed: (...args: unknown[]) => unknown } | null
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
  /** Times the key-light shadow map / any MirrorTexture rendered during the measured frames. */
  shadowRenders: number
  /** Renders of the dynamic generator's map; stays 0 before the static / dynamic split. */
  dynamicShadowRenders: number
  mirrorRenders: number
}

export interface SceneCounts {
  meshes: number
  activeMeshes: number
  materials: number
  lights: number
  textures: number
  drawCalls: number
  shadowCasters: number | null
  /** Casters of the dynamic generator; null before the static / dynamic split. */
  dynamicShadowCasters: number | null
  /** Materials whose `isFrozen` is true right now (of `materials`). */
  materialsFrozen: number
  /** Key-light shadow-map renders per frame; multiply by the frame rate for renders/s. */
  shadowRendersPerFrame: number | null
  /** Dynamic generator renders per frame; null before the static / dynamic split. */
  dynamicShadowRendersPerFrame: number | null
  mirrorRendersPerFrame: number | null
  /** `StaticSceneGate.refreezeCount`; null before the gate exists. */
  refreezeCount: number | null
  /** The gate's state when sampling began (`frozen` once the scene is quiet); null before the gate exists. */
  gateState: string | null
  /** Whether Babylon's active-mesh list was frozen when sampling began. */
  activeListFrozen: boolean | null
  /** Rendered frames the gate needed to reach `frozen` before sampling (null: no gate, or it never did). */
  settleFrames: number | null
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
  /** Heap / allocation probe for this phase; null when `PERF_ALLOC_FRAMES=0`. */
  alloc: AllocSample | null
}

/**
 * One allocation probe: `frames` rendered frames bracketed by forced full GCs.
 *
 * - `heapDeltaBytes` — JS heap in use after a forced GC at the end minus after a forced GC at the
 *   start: what the hot path *retained* (a leak shows up here; per-frame garbage does not).
 * - `allocatedBytes` — what the window *allocated*, including objects the GC already collected, from
 *   the V8 sampling heap profiler (`includeObjectsCollectedByMajorGC/MinorGC`); its estimate is unbiased
 *   but sampled, so treat a few KB/frame as noise. This is the zero-allocation number.
 */
export interface AllocSample {
  frames: number
  wallMs: number
  /** Where the heap sizes came from: CDP `Runtime.getHeapUsage` (precise) or `performance.memory` (quantised). */
  heapSource: 'cdp' | 'performance.memory' | 'unavailable'
  heapBeforeBytes: number | null
  heapAfterBytes: number | null
  heapDeltaBytes: number | null
  heapDeltaPerFrameBytes: number | null
  allocatedBytes: number | null
  allocatedPerFrameBytes: number | null
  /** The largest allocating call sites in the window (self bytes, all frames together). */
  topAllocators: AllocSite[]
}

export interface AllocSite {
  site: string
  bytes: number
}

/**
 * Boot the game (WebGL2, debug tooling on so SceneInstrumentation can be created) and settle it.
 *
 * `noopt=1` is essential under SwiftShader: the game runs a Babylon `SceneOptimizer` (target 55 fps)
 * that, below target, switches shadows, post-processes, particles and render targets off and halves
 * the resolution. Software GL runs at 1-3 fps, so within seconds every run would be measuring a
 * scene with no shadow pass and no mirror, and the shadow/mirror/prepass work could not show up.
 * The sustained-jank handler (which drops the quality tier) is silenced for the same reason; the
 * tier under test is applied explicitly below.
 */
export async function bootForPerf(page: Page, tier: PerfTier): Promise<void> {
  await page.goto('/?renderer=webgl2&debug=1&noopt=1')
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 60_000 })
  await page.waitForFunction(() => !!(window as PerfWindow).game?.ready, undefined, { timeout: 90_000 })
  await page.evaluate(() => {
    ;(window as PerfWindow).game?.performanceMonitor?.setOnSustainedJank?.(null)
  })
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
 * Wait (in rendered frames) until the StaticSceneGate reports `frozen`, i.e. the scene has been
 * quiet long enough for the frozen materials and the frozen active-mesh list to be in effect.
 *
 * Why this matters: Start and every ball spawn thaw the gate, and the fog then eases to its in-play
 * values for a few seconds (effects-atmosphere.ts lerps per frame), thawing it again on every frame
 * until it converges. Sampling before that measures the thawed scene, not the steady state a player
 * sits in. Returns the frames waited, or null when there is no gate (earlier commits) or it never
 * settled within `maxFrames`.
 */
export async function waitForStaticScene(page: Page, maxFrames = 600): Promise<number | null> {
  return page.evaluate(
    (max) =>
      new Promise<number | null>((resolve) => {
        const g = (window as PerfWindow).game
        const gate = g?.staticSceneGate
        const scene = g?.scene
        if (!gate?.getStats || !scene) {
          resolve(null)
          return
        }
        let frames = 0
        const observer = scene.onAfterRenderObservable.add(() => {
          frames++
          const settled = gate.getStats?.().state === 'frozen'
          if (!settled && frames < max) return
          scene.onAfterRenderObservable.remove(observer)
          resolve(settled ? frames : null)
        })
      }),
    maxFrames,
  )
}

/**
 * Bring the table to `total` balls (the game starts with one). Run after `startTable`; the extra
 * balls are real physics bodies that roll for the whole measurement.
 */
export async function addBalls(page: Page, total: number): Promise<void> {
  const count = await page.evaluate((n) => {
    const manager = (window as PerfWindow).game?.ballManager
    const have = manager?.getBallBodies().length ?? 0
    if (manager && have < n) manager.spawnExtraBalls(n - have)
    return manager?.getBallBodies().length ?? 0
  }, total)
  expect(count, `table should hold ${total} balls`).toBe(total)
  await waitForSceneSettle(page)
}

/**
 * Sample per-frame CPU timings by wrapping `game.renderFrame` (the frame scheduler's loop calls it
 * dynamically) and `physicsController.stepFixed` (the scheduler's `physics` phase, #488 §4). The
 * frame is every phase; `game.frameScheduler.getTimings()` has the per-phase split.
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
        const originalStep = pc?.stepFixed
        let physicsMs = 0
        if (pc && originalStep) {
          pc.stepFixed = function (this: unknown, ...args: unknown[]) {
            const t = performance.now()
            try {
              return originalStep.apply(this, args)
            } finally {
              physicsMs += performance.now() - t
            }
          }
        }

        const out: RawSamples = {
          frame: [],
          physics: [],
          activeMeshesEval: [],
          rttRender: [],
          drawPhase: [],
          shadowRenders: 0,
          dynamicShadowRenders: 0,
          mirrorRenders: 0,
        }
        let seen = 0
        // Count renders of the shadow map and the mirror, but only inside the measured frames.
        const shadowMap = g.shadowGenerator?.getShadowMap?.() ?? null
        const observers: Array<[Observable, unknown]> = []
        const watch = (observable: Observable | undefined, onRender: () => void): void => {
          if (observable) observers.push([observable, observable.add(onRender)])
        }
        watch(shadowMap?.onAfterRenderObservable, () => {
          if (seen >= w) out.shadowRenders++
        })
        watch(g.dynamicShadowGenerator?.getShadowMap?.()?.onAfterRenderObservable, () => {
          if (seen >= w) out.dynamicShadowRenders++
        })
        // The game owns no mirror (#484); any MirrorTexture that appears is found by class, so a
        // decorative pass that brings one back shows up here as a non-zero count.
        for (const texture of g.scene?.textures ?? []) {
          if (texture.getClassName?.() !== 'MirrorTexture') continue
          watch(texture.onAfterRenderObservable, () => {
            if (seen >= w) out.mirrorRenders++
          })
        }
        let lastFrameAt = performance.now()
        const progress = { seen: 0, total: w + n, lastFrameMs: 0 }
        ;(window as PerfWindow).__perfProgress = progress
        const restore = (): void => {
          for (const [observable, observer] of observers) observable.remove(observer)
          g.renderFrame = originalRender
          if (pc && originalStep) pc.stepFixed = originalStep
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

/** Resolve after `frames` more frames have rendered (counted on `scene.onAfterRenderObservable`). */
function waitRenderedFrames(page: Page, frames: number): Promise<void> {
  return page.evaluate(
    (n) =>
      new Promise<void>((resolve, reject) => {
        const scene = (window as PerfWindow).game?.scene
        if (!scene) {
          reject(new Error('window.game.scene missing'))
          return
        }
        let seen = 0
        let lastFrameAt = performance.now()
        const guard = window.setInterval(() => {
          if (performance.now() - lastFrameAt < 120_000) return
          window.clearInterval(guard)
          scene.onAfterRenderObservable.remove(observer)
          reject(new Error(`probeAllocations stalled: no frame for 120s after ${seen}/${n} frames`))
        }, 5000)
        const observer = scene.onAfterRenderObservable.add(() => {
          seen++
          lastFrameAt = performance.now()
          if (seen < n) return
          window.clearInterval(guard)
          scene.onAfterRenderObservable.remove(observer)
          resolve()
        })
      }),
    frames,
  )
}

interface SamplingHeapProfileNode {
  selfSize: number
  callFrame: { functionName: string; url: string; lineNumber: number }
  children: SamplingHeapProfileNode[]
}

/** Total sampled bytes, plus the `top` call sites (function @ file:line) by self size. */
function summarizeProfile(root: SamplingHeapProfileNode, top: number): { total: number; sites: AllocSite[] } {
  let total = 0
  const bySite = new Map<string, number>()
  const stack = [root]
  for (let node = stack.pop(); node; node = stack.pop()) {
    total += node.selfSize
    if (node.selfSize > 0) {
      const f = node.callFrame
      const file = f.url.replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')
      const site = `${f.functionName || '(anonymous)'} @ ${file || '(native)'}:${f.lineNumber + 1}`
      bySite.set(site, (bySite.get(site) ?? 0) + node.selfSize)
    }
    for (const child of node.children) stack.push(child)
  }
  const sites = [...bySite.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([site, bytes]) => ({ site, bytes }))
  return { total, sites }
}

/**
 * Heap-delta + allocation probe over `frames` rendered frames (Chromium only: it needs CDP).
 * GC is forced through `HeapProfiler.collectGarbage` before and after, heap sizes come from
 * `Runtime.getHeapUsage` (falling back to the quantised `performance.memory.usedJSHeapSize`), and
 * allocations from the sampling heap profiler. `performance.measureUserAgentSpecificMemory` is not
 * used: it needs cross-origin isolation, which the dev server does not set, and it resolves lazily.
 */
export async function probeAllocations(page: Page, frames: number): Promise<AllocSample> {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('HeapProfiler.enable')
    const heapUsed = async (): Promise<{ bytes: number | null; source: AllocSample['heapSource'] }> => {
      try {
        const usage = await cdp.send('Runtime.getHeapUsage')
        return { bytes: usage.usedSize, source: 'cdp' }
      } catch {
        const bytes = await page.evaluate(
          () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
        )
        return { bytes, source: bytes === null ? 'unavailable' : 'performance.memory' }
      }
    }

    await cdp.send('HeapProfiler.collectGarbage')
    const before = await heapUsed()
    let sampling = false
    try {
      await cdp.send('HeapProfiler.startSampling', {
        samplingInterval: 4096,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      })
      sampling = true
    } catch {
      sampling = false
    }
    const t0 = Date.now()
    let profile: { profile: { head: SamplingHeapProfileNode } } | null = null
    try {
      await waitRenderedFrames(page, frames)
    } finally {
      // Always stop the profiler, even when the frame wait failed.
      if (sampling) profile = await cdp.send('HeapProfiler.stopSampling').catch(() => null)
    }
    const wallMs = Date.now() - t0
    await cdp.send('HeapProfiler.collectGarbage')
    const after = await heapUsed()

    const summary = profile ? summarizeProfile(profile.profile.head, 15) : null
    const allocatedBytes = summary ? summary.total : null
    const heapDeltaBytes = before.bytes !== null && after.bytes !== null ? after.bytes - before.bytes : null
    return {
      frames,
      wallMs,
      heapSource: after.source,
      heapBeforeBytes: before.bytes,
      heapAfterBytes: after.bytes,
      heapDeltaBytes,
      heapDeltaPerFrameBytes: heapDeltaBytes === null ? null : heapDeltaBytes / frames,
      allocatedBytes,
      allocatedPerFrameBytes: allocatedBytes === null ? null : allocatedBytes / frames,
      topAllocators: summary?.sites ?? [],
    }
  } finally {
    await cdp.detach().catch(() => undefined)
  }
}

export async function collectCounts(page: Page): Promise<SceneCounts> {
  return page.evaluate(() => {
    const g = (window as PerfWindow).game
    const scene = g?.scene
    const casters = g?.shadowGenerator?.getShadowMap?.()?.renderList
    const dynamicCasters = g?.dynamicShadowGenerator?.getShadowMap?.()?.renderList
    return {
      meshes: scene?.meshes.length ?? 0,
      activeMeshes: scene?.getActiveMeshes().length ?? 0,
      materials: scene?.materials.length ?? 0,
      lights: scene?.lights.length ?? 0,
      textures: scene?.textures.length ?? 0,
      drawCalls: g?.engine?._drawCalls?.current ?? 0,
      shadowCasters: casters ? casters.length : null,
      dynamicShadowCasters: dynamicCasters ? dynamicCasters.length : null,
      materialsFrozen: scene ? (scene.materials as Array<{ isFrozen?: boolean }>).filter((m) => m.isFrozen).length : 0,
      // Filled in from the sampled frames by toRepeatResult.
      shadowRendersPerFrame: null,
      dynamicShadowRendersPerFrame: null,
      mirrorRendersPerFrame: null,
      refreezeCount: g?.staticSceneGate ? g.staticSceneGate.refreezeCount : null,
      gateState: g?.staticSceneGate?.getStats?.().state ?? null,
      activeListFrozen: scene && g?.staticSceneGate ? scene._activeMeshesFrozen === true : null,
      settleFrames: null,
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

export function toRepeatResult(
  raw: RawSamples,
  counts: SceneCounts,
  env: PerfEnv,
  settleFrames: number | null = null,
  alloc: AllocSample | null = null,
): RepeatResult {
  const render = raw.frame.map((f, i) => f - (raw.physics[i] ?? 0))
  return {
    frames: raw.frame.length,
    frameTimeMs: summarize(raw.frame),
    physicsStepMs: summarize(raw.physics),
    renderTimeMs: summarize(render),
    activeMeshesEvalMs: summarize(raw.activeMeshesEval),
    rttRenderMs: summarize(raw.rttRender),
    drawPhaseMs: summarize(raw.drawPhase),
    counts: {
      ...counts,
      settleFrames,
      shadowRendersPerFrame: raw.frame.length > 0 ? raw.shadowRenders / raw.frame.length : null,
      dynamicShadowRendersPerFrame:
        raw.frame.length > 0 && counts.dynamicShadowCasters !== null ? raw.dynamicShadowRenders / raw.frame.length : null,
      mirrorRendersPerFrame: raw.frame.length > 0 ? raw.mirrorRenders / raw.frame.length : null,
    },
    env,
    alloc,
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
    /** Median over repeats of each probe figure; null when no repeat ran the probe. */
    alloc: AllocAggregate | null
  }
  env: PerfEnv
}

export interface AllocAggregate {
  frames: number
  heapDeltaPerFrameBytes: number | null
  allocatedPerFrameBytes: number | null
  heapSource: AllocSample['heapSource']
}

function medianOrNull(values: Array<number | null>): number | null {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v))
  return finite.length > 0 ? median(finite) : null
}

export function aggregateAlloc(repeats: RepeatResult[]): AllocAggregate | null {
  const samples = repeats.map((r) => r.alloc).filter((a): a is AllocSample => a !== null && a !== undefined)
  const last = samples[samples.length - 1]
  if (!last) return null
  return {
    frames: last.frames,
    heapDeltaPerFrameBytes: medianOrNull(samples.map((a) => a.heapDeltaPerFrameBytes)),
    allocatedPerFrameBytes: medianOrNull(samples.map((a) => a.allocatedPerFrameBytes)),
    heapSource: last.heapSource,
  }
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
      alloc: aggregateAlloc(repeats),
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
