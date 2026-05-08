/**
 * Performance Monitor - Lightweight metrics tracking
 * Tracks FPS, frame time, physics step time, and render time
 */

export interface PerformanceMetrics {
  fps: number
  frameTimeMs: number
  physicsStepMs: number
  renderTimeMs: number
  drawCalls: number
  activeBodies: number
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    fps: 0,
    frameTimeMs: 0,
    physicsStepMs: 0,
    renderTimeMs: 0,
    drawCalls: 0,
    activeBodies: 0,
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

  constructor() {
    this.frameStartTime = performance.now()
    this.lastSecondTime = this.frameStartTime
  }

  /**
   * Call at the start of each frame update
   */
  frameStart(): void {
    if (!this.enabled) return
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
    if (!this.enabled) return

    const frameTime = performance.now() - this.frameStartTime
    this.addSample(this.frameTimeSamples, frameTime)
    this.frameCount++

    // Update FPS every second
    const now = performance.now()
    if (now - this.lastSecondTime >= 1000) {
      this.metrics.fps = this.frameCount
      this.frameCount = 0
      this.lastSecondTime = now
      this.updateAverages()

      // Log metrics to console in debug mode
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
  }
}
