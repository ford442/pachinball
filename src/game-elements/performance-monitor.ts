/**
 * Performance Monitor - Lightweight metrics tracking
 * Tracks FPS, frame time, physics step time, and render time.
 * Emits a one-shot sustained-jank callback when avg frame time stays >22ms for 2s.
 */

export interface PerformanceMetrics {
  fps: number
  frameTimeMs: number
  physicsStepMs: number
  renderTimeMs: number
  drawCalls: number
  activeBodies: number
  lastTrackSwitchMs: number | null
  lastTrackSwitchId: string | null
  peakFrameAfterSwitchMs: number | null
  activeParticles: number
  goldBallsInPlay: number
  rendererBackend: string
  suggestedFallback: boolean
}

const JANK_FRAME_MS = 22
const JANK_SUSTAINED_SECONDS = 2

export class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    fps: 0,
    frameTimeMs: 0,
    physicsStepMs: 0,
    renderTimeMs: 0,
    drawCalls: 0,
    activeBodies: 0,
    lastTrackSwitchMs: null,
    lastTrackSwitchId: null,
    peakFrameAfterSwitchMs: null,
    activeParticles: 0,
    goldBallsInPlay: 0,
    rendererBackend: 'unknown',
    suggestedFallback: false,
  }

  // Frame timing
  private frameStartTime = 0
  private frameCount = 0
  private lastSecondTime = 0
  private physicsStartTime = 0

  // Buffers for averaging (circular)
  private frameTimeSamples: number[] = []
  private physicsTimeSamples: number[] = []
  private maxSamples = 60 // ~1 second at 60 FPS

  private enabled = false
  private trackSwitchStartedAt: number | null = null
  private trackSwitchPeakMs = 0
  private trackSwitchSampleFrames = 0
  private readonly trackSwitchSampleWindow = 90

  /** Consecutive seconds with avg frameTime > JANK_FRAME_MS. */
  private slowSecondCount = 0
  private jankCallbackFired = false
  private onSustainedJank: (() => void) | null = null

  constructor() {
    this.frameStartTime = performance.now()
    this.lastSecondTime = this.frameStartTime
  }

  /**
   * Register a one-shot callback for sustained jank (frame time >22ms for 2s).
   * Used to auto-drop quality tier once per session.
   */
  setOnSustainedJank(callback: (() => void) | null): void {
    this.onSustainedJank = callback
  }

  /**
   * Call at the start of each frame update
   */
  frameStart(): void {
    this.frameStartTime = performance.now()
  }

  /**
   * Call at the start of physics step
   */
  physicsStart(): void {
    if (!this.enabled) return
    this.physicsStartTime = performance.now()
  }

  /**
   * Call at the end of physics step
   */
  physicsEnd(): void {
    if (!this.enabled) return
    const physicsTime = performance.now() - this.physicsStartTime
    this.addSample(this.physicsTimeSamples, physicsTime)
  }

  /**
   * Call at the end of frame (after render)
   */
  frameEnd(): void {
    const frameTime = performance.now() - this.frameStartTime
    this.trackSwitchProfiling(frameTime)

    // Always sample frame times so jank auto-drop works outside debug mode
    this.addSample(this.frameTimeSamples, frameTime)
    this.frameCount++

    const now = performance.now()
    if (now - this.lastSecondTime >= 1000) {
      this.metrics.fps = this.frameCount
      this.frameCount = 0
      this.lastSecondTime = now
      this.updateAverages()
      this.checkSustainedJank()

      if (this.enabled && window.localStorage.getItem('debug:perf-log') === 'true') {
        console.log(
          `[PERF] FPS: ${this.metrics.fps.toFixed(1)} | Frame: ${this.metrics.frameTimeMs.toFixed(2)}ms | Physics: ${this.metrics.physicsStepMs.toFixed(2)}ms | Render: ${this.metrics.renderTimeMs.toFixed(2)}ms`
        )
      }
    }
  }

  /**
   * Update draw calls and active bodies from engine/physics
   */
  updateEngineMetrics(drawCalls: number, activeBodies: number): void {
    if (!this.enabled) return
    this.metrics.drawCalls = drawCalls
    this.metrics.activeBodies = activeBodies
  }

  setRendererBackend(backend: string): void {
    this.metrics.rendererBackend = backend
  }

  setParticleCount(count: number): void {
    this.metrics.activeParticles = count
  }

  setGoldBallCount(count: number): void {
    this.metrics.goldBallsInPlay = count
  }

  markTrackSwitch(trackId: string): void {
    this.trackSwitchStartedAt = performance.now()
    this.trackSwitchPeakMs = 0
    this.trackSwitchSampleFrames = 0
    this.metrics.lastTrackSwitchId = trackId
    this.metrics.lastTrackSwitchMs = null
    this.metrics.peakFrameAfterSwitchMs = null
  }

  /**
   * Enable/disable performance monitoring
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (enabled) {
      console.log('[PerfMonitor] Enabled. Press T to cycle CRT, ` for debug HUD, localStorage debug:perf-log=true for console logs')
    }
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Get current metrics
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics }
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.frameTimeSamples = []
    this.physicsTimeSamples = []
    this.frameCount = 0
    this.frameStartTime = performance.now()
    this.lastSecondTime = this.frameStartTime
    this.slowSecondCount = 0
  }

  private addSample(buffer: number[], value: number): void {
    buffer.push(value)
    if (buffer.length > this.maxSamples) {
      buffer.shift()
    }
  }

  private updateAverages(): void {
    if (this.frameTimeSamples.length > 0) {
      this.metrics.frameTimeMs =
        this.frameTimeSamples.reduce((a, b) => a + b, 0) / this.frameTimeSamples.length
    }
    if (this.physicsTimeSamples.length > 0) {
      this.metrics.physicsStepMs =
        this.physicsTimeSamples.reduce((a, b) => a + b, 0) / this.physicsTimeSamples.length
    }
    // Render time = frame time - physics time (approximation)
    this.metrics.renderTimeMs = Math.max(0, this.metrics.frameTimeMs - this.metrics.physicsStepMs)
    this.metrics.suggestedFallback =
      this.metrics.fps > 0 &&
      this.metrics.fps < 40 &&
      (this.metrics.peakFrameAfterSwitchMs ?? 0) > 22
  }

  private checkSustainedJank(): void {
    if (this.jankCallbackFired || !this.onSustainedJank) return

    if (this.metrics.frameTimeMs > JANK_FRAME_MS) {
      this.slowSecondCount++
      if (this.slowSecondCount >= JANK_SUSTAINED_SECONDS) {
        this.jankCallbackFired = true
        this.metrics.suggestedFallback = true
        try {
          this.onSustainedJank()
        } catch (err) {
          console.warn('[PerfMonitor] Sustained jank callback failed:', err)
        }
      }
    } else {
      this.slowSecondCount = 0
    }
  }

  private trackSwitchProfiling(frameTime: number): void {
    if (this.trackSwitchStartedAt === null) return

    this.trackSwitchPeakMs = Math.max(this.trackSwitchPeakMs, frameTime)
    this.trackSwitchSampleFrames++

    if (this.trackSwitchSampleFrames >= this.trackSwitchSampleWindow) {
      this.metrics.lastTrackSwitchMs = performance.now() - this.trackSwitchStartedAt
      this.metrics.peakFrameAfterSwitchMs = this.trackSwitchPeakMs
      this.trackSwitchStartedAt = null
      this.trackSwitchSampleFrames = 0

      if (this.enabled && window.localStorage.getItem('debug:perf-log') === 'true') {
        console.log(
          `[PERF] Track switch ${this.metrics.lastTrackSwitchId ?? 'unknown'}: ${this.metrics.lastTrackSwitchMs.toFixed(1)}ms, peak frame ${this.metrics.peakFrameAfterSwitchMs.toFixed(1)}ms`,
        )
      }
    }
  }
}
