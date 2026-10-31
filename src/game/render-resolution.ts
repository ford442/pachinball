/**
 * Runtime half of the resolution policy (#488 §3; the pure half is `src/engine/resolution-policy.ts`).
 *
 * - Applies `resolveRenderScale()` (DPR × platform cap × quality-tier cap) as the hardware scaling
 *   level, again whenever the tier or the DPR changes.
 * - Watches the DPR with a `(resolution: Xdppx)` media query that is re-armed on every change (a
 *   query only matches the DPR it was made for, so a single listener fires once and then never).
 * - Drives dynamic resolution from one frame-time sample per frame, as a frame-scheduler system
 *   in the `idle` phase: GPU frame time from `timestamp-query` where the device has it, else the
 *   frame interval.
 *
 * It owns the hardware scaling level; the scene optimizer no longer touches it
 * (`safe-scene-optimizer-options.ts`). A lazy chunk (`GameRenderer.setupResolution`): until it
 * lands, the boot-time scale from `applyHardwareScaling()` (no tier cap yet) holds.
 */

import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { DynamicResolutionController } from '../engine/dynamic-resolution'
import {
  hardwareScalingLevelFor,
  isDynamicResolutionEnabled,
  resolveRenderScale,
  type RenderScaleTier,
} from '../engine/resolution-policy'
import { isMobileUserAgent } from '../engine/engine-options'
import { resolveGpuCapabilities } from '../engine/gpu-capabilities'
import type { FrameSystem } from '../core/frame-scheduler'

/** GPU time a frame may take: the rest of a 60 Hz frame is the CPU's. */
export const GPU_BUDGET_MS = 14
/** Frame interval that still counts as on budget (the scene optimizer's 55 fps target). */
export const INTERVAL_BUDGET_MS = 1000 / 55

export interface RenderResolutionHost {
  readonly engine: Engine | WebGPUEngine
  readonly signal: AbortSignal
  /** Current quality tier (`QualityTier` values). */
  readonly qualityTier: RenderScaleTier
}

export interface RenderResolutionInfo {
  /** Backbuffer pixels per CSS pixel right now. */
  scale: number
  /** The policy's ceiling for this display and tier. */
  maxScale: number
  minScale: number
  dynamic: boolean
  /** Where frame times come from. */
  source: 'gpu-timer' | 'frame-interval' | 'off'
  devicePixelRatio: number
  /** Scale changes made by dynamic resolution so far. */
  changes: number
}

type GpuTimerEngine = { getGPUFrameTimeCounter?: () => { current: number } | undefined }

export class RenderResolution {
  private readonly host: RenderResolutionHost
  private readonly dynamic: boolean
  private controller: DynamicResolutionController | null = null
  private instrumentation: EngineInstrumentation | null = null
  private source: RenderResolutionInfo['source'] = 'off'
  private maxScale = 1
  private scale = 1
  private changes = 0
  private dprQuery: MediaQueryList | null = null
  private disposed = false

  constructor(host: RenderResolutionHost) {
    this.host = host
    this.dynamic = isDynamicResolutionEnabled(location.search, navigator.webdriver === true)
  }

  /** Apply the policy now and start watching the DPR. */
  start(): void {
    if (this.dynamic) this.startFrameTimeSource()
    this.apply(true)
    this.watchDpr()
  }

  /** The tier changed (settings, auto-drop): the ceiling follows it. */
  onQualityTierChanged(): void {
    this.apply(false)
  }

  /** One frame-time sample per frame (frame-scheduler `idle` phase). */
  readonly frameSystem: FrameSystem = {
    phase: 'idle',
    name: 'dynamic-resolution',
    update: () => this.sample(),
  }

  getInfo(): RenderResolutionInfo {
    const range = this.controller?.range ?? { min: this.maxScale, max: this.maxScale }
    return {
      scale: this.scale,
      maxScale: this.maxScale,
      minScale: range.min,
      dynamic: this.controller !== null,
      source: this.source,
      devicePixelRatio: window.devicePixelRatio || 1,
      changes: this.changes,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.dprQuery = null
    if (this.instrumentation) {
      this.instrumentation.captureGPUFrameTime = false
      this.instrumentation.dispose()
      this.instrumentation = null
    }
    this.controller = null
  }

  private apply(resetToMax: boolean): void {
    if (this.disposed) return
    this.maxScale = resolveRenderScale({
      devicePixelRatio: window.devicePixelRatio || 1,
      mobile: isMobileUserAgent(navigator.userAgent),
      quality: this.host.qualityTier,
      search: location.search,
    })
    if (this.dynamic) {
      if (!this.controller) {
        const gpu = this.source === 'gpu-timer'
        this.controller = new DynamicResolutionController({
          budgetMs: gpu ? GPU_BUDGET_MS : INTERVAL_BUDGET_MS,
          maxScale: this.maxScale,
          // The interval includes the vsync wait, so "under" means "hit the refresh", not "idle GPU".
          underRatio: gpu ? 0.8 : 0.95,
        })
      }
      this.setScale(this.controller.setMaxScale(this.maxScale, resetToMax))
    } else {
      this.setScale(this.maxScale)
    }
  }

  private setScale(scale: number): void {
    this.scale = scale
    const level = hardwareScalingLevelFor(scale)
    const engine = this.host.engine
    // setHardwareScalingLevel resizes; skip it when nothing moves.
    if (Math.abs(engine.getHardwareScalingLevel() - level) < 1e-6) return
    engine.setHardwareScalingLevel(level)
  }

  /**
   * `(resolution: Xdppx)` only matches the DPR it names, so each change re-arms a query for the new
   * DPR (a browser zoom or a window dragged to another monitor).
   */
  private watchDpr(): void {
    if (this.disposed || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    this.dprQuery = query
    query.addEventListener(
      'change',
      () => {
        if (this.disposed || this.dprQuery !== query) return
        console.log(`[GameRenderer] DPR changed: ${window.devicePixelRatio}`)
        this.apply(true)
        this.host.engine.resize()
        this.watchDpr()
      },
      { once: true, signal: this.host.signal },
    )
  }

  private startFrameTimeSource(): void {
    const engine = this.host.engine
    const gpuTimer =
      resolveGpuCapabilities(engine).gpuTimer && typeof (engine as unknown as GpuTimerEngine).getGPUFrameTimeCounter === 'function'
    if (gpuTimer) {
      this.instrumentation = new EngineInstrumentation(engine)
      this.instrumentation.captureGPUFrameTime = true
      this.source = 'gpu-timer'
    } else {
      this.source = 'frame-interval'
    }
  }

  private sample(): void {
    const controller = this.controller
    if (!controller || this.disposed) return
    let ms: number
    if (this.source === 'gpu-timer') {
      // Nanoseconds; 0 until the first query resolves.
      ms = (this.instrumentation?.gpuFrameTimeCounter.current ?? 0) * 1e-6
    } else {
      ms = this.host.engine.getDeltaTime()
    }
    const next = controller.sample(ms)
    if (next === null) return
    this.changes++
    console.log(`[GameRenderer] Dynamic resolution: ${this.scale.toFixed(3)}x → ${next.toFixed(3)}x (${ms.toFixed(1)} ms, ${this.source})`)
    this.setScale(next)
  }
}
