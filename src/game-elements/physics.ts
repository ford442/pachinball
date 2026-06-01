import type * as RAPIER from '@dimforge/rapier3d-compat'

// Gravity: -Y (down), -Z (roll towards player)
export const GRAVITY = { x: 0, y: -9.81, z: -5.0 }

/** Fixed physics timestep for deterministic simulation */
export const FIXED_TIMESTEP = 1 / 60

/** Maximum dt to prevent physics explosions during lag spikes */
export const MAX_DT = 1 / 30

/**
 * Contact force event callback signature.
 * @param handle1 - Collider handle of first body
 * @param handle2 - Collider handle of second body
 * @param maxForceMagnitude - Maximum contact force magnitude during the step
 */
export type ContactForceCallback = (handle1: number, handle2: number, maxForceMagnitude: number) => void

/**
 * Collision groups for Rapier collider filtering.
 * Membership bits (upper 16) define which groups a collider belongs to.
 * Filter bits (lower 16) define which groups a collider can collide with.
 */
export const CollisionGroups = {
  BALL:    0x0001,
  WALL:    0x0002,
  BUMPER:  0x0004,
  SENSOR:  0x0008,
  FLIPPER: 0x0010,
  TARGET:  0x0020,
  SPINNER: 0x0040,
  GATE:    0x0080,
  ADVENTURE: 0x0100,
} as const

export const ADVENTURE_GROUP = CollisionGroups.ADVENTURE

/**
 * Create a Rapier collision group bitmask.
 * @param membership - Which groups this collider belongs to
 * @param filter - Which groups this collider can interact with
 * @returns Combined 32-bit collision group value for Rapier
 */
export function makeCollisionGroups(membership: number, filter: number): number {
  return ((membership & 0xFFFF) << 16) | (filter & 0xFFFF)
}

/** Pre-built collision group values for common object types */
export const COLLISION_GROUP_PRESETS = {
  /** Ball collides with walls, bumpers, sensors, flippers, targets, spinners, gates */
  BALL: makeCollisionGroups(
    CollisionGroups.BALL,
    CollisionGroups.WALL | CollisionGroups.BUMPER | CollisionGroups.SENSOR |
    CollisionGroups.FLIPPER | CollisionGroups.TARGET | CollisionGroups.SPINNER |
    CollisionGroups.GATE | CollisionGroups.ADVENTURE
  ),
  /** Walls only collide with balls */
  WALL: makeCollisionGroups(CollisionGroups.WALL, CollisionGroups.BALL),
  /** Bumpers only collide with balls */
  BUMPER: makeCollisionGroups(CollisionGroups.BUMPER, CollisionGroups.BALL),
  /** Sensors only collide with balls */
  SENSOR: makeCollisionGroups(CollisionGroups.SENSOR, CollisionGroups.BALL),
  /** Flippers only collide with balls */
  FLIPPER: makeCollisionGroups(CollisionGroups.FLIPPER, CollisionGroups.BALL),
  /** Targets only collide with balls */
  TARGET: makeCollisionGroups(CollisionGroups.TARGET, CollisionGroups.BALL),
  /** Spinners only collide with balls */
  SPINNER: makeCollisionGroups(CollisionGroups.SPINNER, CollisionGroups.BALL),
  /** Gates only collide with balls */
  GATE: makeCollisionGroups(CollisionGroups.GATE, CollisionGroups.BALL),
  /** Adventure track bodies only collide with balls */
  ADVENTURE: makeCollisionGroups(ADVENTURE_GROUP, CollisionGroups.BALL),
} as const

export class PhysicsSystem {
  private rapier: typeof RAPIER | null = null
  private world: RAPIER.World | null = null
  private eventQueue: RAPIER.EventQueue | null = null
  private stepCount = 0

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

    // OP-5: Contact skin to reduce micro-bouncing
    // @ts-expect-error contactSkin is available in this Rapier version but not fully typed
    this.world.integrationParameters.contactSkin = 0.005

    this.eventQueue = new this.rapier.EventQueue(true)
  }

  getWorld(): RAPIER.World {
    return this.world!
  }

  getStepCount(): number {
    return this.stepCount
  }

  getRapier(): typeof RAPIER | null {
    return this.rapier
  }

  getEventQueue(): RAPIER.EventQueue | null {
    return this.eventQueue
  }

  /**
   * Get count of active rigid bodies in the world
   */
  getActiveBodyCount(): number {
    if (!this.world) return 0
    let count = 0
    this.world.bodies.forEach(() => count++)
    return count
  }

  /**
   * Fixed timestep physics step with accumulator.
   * Ensures deterministic physics regardless of frame rate.
   * @param rawDt - Raw delta time in seconds from the engine
   * @param callback - Collision event callback
   * @param forceCallback - Optional contact force event callback
   * @returns The interpolation alpha for visual smoothing (0-1)
   */
  step(
    rawDt: number,
    callback: (handle1: number, handle2: number, started: boolean) => void,
    forceCallback?: ContactForceCallback
  ): number {
    if (!this.world || !this.eventQueue) return 0

    // DT clamping: prevent physics explosions during lag spikes
    const dt = Math.min(rawDt, MAX_DT)

    this.accumulator += dt

    // Step physics at fixed intervals for determinism
    while (this.accumulator >= FIXED_TIMESTEP) {
      this.world.timestep = FIXED_TIMESTEP
      this.world.step(this.eventQueue)
      this.stepCount++
      this.eventQueue.drainCollisionEvents(callback)
      // Drain contact force events to prevent queue buildup and enable
      // force-proportional hit effects (stronger hits = bigger response)
      this.eventQueue.drainContactForceEvents((event) => {
        if (forceCallback) {
          forceCallback(event.collider1(), event.collider2(), event.maxForceMagnitude())
        }
      })
      this.accumulator -= FIXED_TIMESTEP
    }

    // Return interpolation alpha for visual smoothing
    return this.accumulator / FIXED_TIMESTEP
  }

  dispose(): void {
    this.world?.free()
  }
}
