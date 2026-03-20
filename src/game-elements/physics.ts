import { Vector3 } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'

// Gravity: -Y (down), -Z (roll towards player)
export const GRAVITY = new Vector3(0, -9.81, -5.0)

/** Fixed physics timestep for deterministic simulation */
export const FIXED_TIMESTEP = 1 / 60

/** Maximum dt to prevent physics explosions during lag spikes */
export const MAX_DT = 1 / 30

export class PhysicsSystem {
  private rapier: typeof RAPIER | null = null
  private world: RAPIER.World | null = null
  private eventQueue: RAPIER.EventQueue | null = null

  /** Accumulator for fixed timestep */
  private accumulator = 0

  constructor(preloadedRapier?: typeof RAPIER) {
    // If Rapier was preloaded in parallel with engine creation, use it directly.
    // This avoids redundant WASM fetch/compilation and reduces total init time.
    if (preloadedRapier) {
      this.rapier = preloadedRapier
    }
  }

  async init(): Promise<void> {
    if (this.rapier && this.world) return
    
    // Fallback: load Rapier here if not preloaded (backward compatibility)
    if (!this.rapier) {
      this.rapier = await import('@dimforge/rapier3d-compat')
      await (this.rapier.init as unknown as () => Promise<void>)()
    }

    // Updated: Pass a single object with gravity property
    const gravity = { x: GRAVITY.x, y: GRAVITY.y, z: GRAVITY.z }
    this.world = new this.rapier.World(gravity)

    // OP-1: Solver iterations for flipper stability and consistent hits
    this.world.integrationParameters.numSolverIterations = 8
    this.world.integrationParameters.numAdditionalFrictionIterations = 4

    this.eventQueue = new this.rapier.EventQueue(true)
  }

  getWorld(): RAPIER.World | null {
    return this.world
  }

  getRapier(): typeof RAPIER | null {
    return this.rapier
  }

  getEventQueue(): RAPIER.EventQueue | null {
    return this.eventQueue
  }

  /**
   * Fixed timestep physics step with accumulator.
   * Ensures deterministic physics regardless of frame rate.
   * @param rawDt - Raw delta time in seconds from the engine
   * @param callback - Collision event callback
   * @returns The interpolation alpha for visual smoothing (0-1)
   */
  step(
    rawDt: number,
    callback: (handle1: number, handle2: number, started: boolean) => void
  ): number {
    if (!this.world || !this.eventQueue) return 0

    // DT clamping: prevent physics explosions during lag spikes
    const dt = Math.min(rawDt, MAX_DT)

    this.accumulator += dt

    // Step physics at fixed intervals for determinism
    while (this.accumulator >= FIXED_TIMESTEP) {
      this.world.timestep = FIXED_TIMESTEP
      this.world.step(this.eventQueue)
      this.eventQueue.drainCollisionEvents(callback)
      this.accumulator -= FIXED_TIMESTEP
    }

    // Return interpolation alpha for visual smoothing
    return this.accumulator / FIXED_TIMESTEP
  }

  dispose(): void {
    this.world?.free()
  }
}
