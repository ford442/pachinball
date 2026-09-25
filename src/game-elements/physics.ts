import type * as RAPIER from '@dimforge/rapier3d-compat'
import {
  WASM_PHYSICS,
  getWasmPhysicsRuntimeMode,
  isCrossOriginIsolated,
  type WasmPhysicsRuntimeMode,
} from '../config'
import { WasmPhysicsEngine } from '../wasm'
import type { WasmSimEngine } from '../wasm/wasm-sim-engine'
import { PhysicsWorkerClient } from '../wasm/physics-worker-client'
import { getPreloadedWasmModule } from '../engine/wasm-idle-preload'
import { WASM_PHYSICS_API } from '../wasm/wasm-physics-api'
import { WasmTableWorld } from '../wasm/wasm-table-world'
import type { PhysicsApi, PhysicsWorldSink } from '../core/physics-api'
import { loadRapier } from './rapier-loader'
import type { WasmDebugCollider } from './wasm-debug-geometry'

/** Greppable marker for "table physics booted on Rapier because WASM failed". */
export const PHYSICS_DEGRADE_MARKER = '[Bootstrap][physics-degrade]'

/** Engine that actually served the last init/step — not the localStorage preference. */
export function exposeCurrentPhysicsEngine(mode: WasmPhysicsRuntimeMode): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as { currentPhysicsEngine?: WasmPhysicsRuntimeMode }).currentPhysicsEngine = mode
}

/** Last degrade reason (Playwright / diagnostics); undefined when WASM loaded successfully. */
export function exposePhysicsDegradeReason(reason: string | undefined): void {
  if (typeof window === 'undefined') return
  const w = window as unknown as { physicsDegradeReason?: string }
  if (reason === undefined) {
    delete w.physicsDegradeReason
  } else {
    w.physicsDegradeReason = reason
  }
}

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

/**
 * Owns the physics world for the session.
 *
 * `wasm-owner` / `wasm-worker` (the default) run entirely on the C++ engine:
 * builders author into a `WasmTableWorld` through `WASM_PHYSICS_API`, and no
 * Rapier module, `World` or event queue is created (#412). Rapier is loaded —
 * lazily, via `loadRapier()` — only for the explicit `rapier` override,
 * `wasm-mirror`, or the fail-closed degrade when the C++ bundle is missing.
 */
export class PhysicsSystem {
  private rapier: typeof RAPIER | null = null
  private world: RAPIER.World | null = null
  private eventQueue: RAPIER.EventQueue | null = null
  /** The owner-mode world sink (null on every Rapier path). */
  private tableWorld: WasmTableWorld | null = null
  private stepCount = 0

  /** WASM backend, only active when the feature flag is set and the bundle loads. */
  private wasmEngine: WasmSimEngine | null = null
  private wasmMode: WasmPhysicsRuntimeMode = 'rapier'
  private wasmActive = false

  /** Last-step timing for Debug HUD (milliseconds). */
  private lastWasmStepMs = 0
  private lastRapierStepMs = 0
  private lastMirrorOverheadMs = 0
  /** Static/dynamic collider descriptors for C++ debug draw (owner/worker). */
  private wasmDebugColliders: WasmDebugCollider[] = []

  /** Accumulator for fixed timestep */
  private accumulator = 0

  /**
   * @param preloadedRapier Rapier, when the bootstrap already fetched it for an
   *   explicit Rapier mode. Owner modes pass nothing and never load it.
   */
  constructor(private readonly preloadedRapier?: typeof RAPIER) {}

  async init(): Promise<void> {
    if (this.world || this.tableWorld) return

    this.wasmMode = getWasmPhysicsRuntimeMode()
    if (WASM_PHYSICS.enabled && this.wasmMode !== 'rapier') {
      await this.initWasmEngine()
    }

    if (this.isWasmOwnerMode() && this.wasmEngine) {
      // The C++ engine owns everything: no Rapier module, world or queue.
      this.tableWorld = new WasmTableWorld(this.wasmEngine, GRAVITY)
    } else {
      await this.initRapierWorld()
    }
    exposeCurrentPhysicsEngine(this.getWasmMode())
  }

  /** Load the C++ engine for the selected mode; on failure fall back to `rapier` with a degrade reason. */
  private async initWasmEngine(): Promise<void> {
    if (this.wasmMode === 'wasm-worker') {
      console.info(`[PhysicsSystem] wasm-worker mode: crossOriginIsolated=${isCrossOriginIsolated()}`)
      const client = new PhysicsWorkerClient()
      await client.load(WASM_PHYSICS.bundleUrl)
      if (client.isReady) {
        console.info(
          `[PhysicsSystem] wasm-worker snapshot transport requested: ${isCrossOriginIsolated() ? 'shared' : 'post-message'}`,
        )
        client.setGravity(GRAVITY.x, GRAVITY.y, GRAVITY.z)
        client.setRollingResistance(WASM_PHYSICS.tunables.rollingResistance)
        this.wasmEngine = client
        this.wasmActive = true
        return
      }
      console.warn('[PhysicsSystem] WASM physics worker failed; falling back to in-process wasm-owner.')
      this.wasmMode = 'wasm-owner'
    }

    const engine = new WasmPhysicsEngine()
    const preloaded = await getPreloadedWasmModule()
    await engine.load(WASM_PHYSICS.bundleUrl, preloaded ?? undefined)
    if (engine.isReady) {
      engine.setGravity(GRAVITY.x, GRAVITY.y, GRAVITY.z)
      engine.setRollingResistance(WASM_PHYSICS.tunables.rollingResistance)
      this.wasmEngine = engine
      this.wasmActive = true
      return
    }
    const reason = `${PHYSICS_DEGRADE_MARKER} WASM physics bundle failed to load; falling back to Rapier.`
    console.warn(reason)
    exposePhysicsDegradeReason(reason)
    this.wasmMode = 'rapier'
  }

  /** Rapier world for `rapier`, `wasm-mirror` and the degrade path. */
  private async initRapierWorld(): Promise<void> {
    this.rapier = this.preloadedRapier ?? (await loadRapier())

    this.world = new this.rapier.World({ x: GRAVITY.x, y: GRAVITY.y, z: GRAVITY.z })

    // OP-1: Solver iterations for flipper stability and consistent hits
    this.world.integrationParameters.numSolverIterations = 8
    this.world.integrationParameters.numAdditionalFrictionIterations = 4

    // OP-5: Contact skin to reduce micro-bouncing
    // @ts-expect-error contactSkin is available in this Rapier version but not fully typed
    this.world.integrationParameters.contactSkin = 0.005

    this.eventQueue = new this.rapier.EventQueue(true)
  }

  /** True once `init()` produced a world to author into. */
  isReady(): boolean {
    return this.tableWorld !== null || this.world !== null
  }

  /** The world builders author into: the C++ owner's table world, else the Rapier world. */
  getWorld(): PhysicsWorldSink {
    const world = this.tableWorld ?? this.world
    if (!world) throw new Error('PhysicsSystem.getWorld() before init()')
    return world
  }

  /** The value namespace builders construct descriptors from (Rapier, or the C++ recorder). */
  getPhysicsApi(): PhysicsApi {
    if (this.tableWorld) return WASM_PHYSICS_API
    if (this.rapier) return this.rapier
    throw new Error('PhysicsSystem.getPhysicsApi() before init()')
  }

  /** The owner-mode world sink, or null on a Rapier path. */
  getWasmTableWorld(): WasmTableWorld | null {
    return this.tableWorld
  }

  /** The Rapier world — null on the owner path, where Rapier is never loaded. */
  getRapierWorld(): RAPIER.World | null {
    return this.world
  }

  getStepCount(): number {
    return this.stepCount
  }

  /** The Rapier namespace — null on the owner path, where Rapier is never loaded. */
  getRapier(): typeof RAPIER | null {
    return this.rapier
  }

  getEventQueue(): RAPIER.EventQueue | null {
    return this.eventQueue
  }

  /** True when the WASM backend is active and ready. */
  isWasmActive(): boolean {
    return this.wasmActive && this.wasmEngine?.isReady === true
  }

  /** Resolved WASM runtime mode (`rapier` when inactive). */
  getWasmMode(): WasmPhysicsRuntimeMode {
    return this.isWasmActive() ? this.wasmMode : 'rapier'
  }

  /** True when WASM owns ball+static simulation (in-process or worker). */
  isWasmOwnerMode(): boolean {
    return this.isWasmActive() && (this.wasmMode === 'wasm-owner' || this.wasmMode === 'wasm-worker')
  }

  getLastWasmStepMs(): number { return this.lastWasmStepMs }
  getLastRapierStepMs(): number { return this.lastRapierStepMs }
  getLastMirrorOverheadMs(): number { return this.lastMirrorOverheadMs }

  setMirrorOverheadMs(ms: number): void {
    this.lastMirrorOverheadMs = ms
  }

  setWasmDebugColliders(colliders: WasmDebugCollider[]): void {
    this.wasmDebugColliders = colliders
  }

  getWasmDebugColliders(): readonly WasmDebugCollider[] {
    return this.wasmDebugColliders
  }

  /** Access the WASM engine (for sync/registration by the controller). */
  getWasmEngine(): WasmSimEngine | null {
    return this.wasmEngine
  }

  /**
   * Get count of active rigid bodies in the world
   */
  getActiveBodyCount(): number {
    if (this.tableWorld) return this.tableWorld.allBodies().length
    if (!this.world) return 0
    let count = 0
    this.world.bodies.forEach(() => count++)
    return count
  }

  /** Count all colliders attached to rigid bodies in the world. */
  getColliderCount(): number {
    if (this.tableWorld) {
      return this.tableWorld.allBodies().reduce((n, body) => n + body.numColliders(), 0)
    }
    if (!this.world) return 0
    let count = 0
    this.world.bodies.forEach((body) => {
      count += body.numColliders()
    })
    return count
  }

  /**
   * Rough WASM memory estimate for the Rapier world (bodies + colliders).
   * Useful for spotting leaks across adventure track switches.
   */
  getEstimatedMemoryKb(): number {
    if (!this.world && !this.tableWorld) return 0
    const bodies = this.getActiveBodyCount()
    const colliders = this.getColliderCount()
    // Empirical averages for Rapier 3D WASM allocations in this project (a rough
    // proxy for the C++ world's footprint on the owner path).
    return Math.round(bodies * 0.45 + colliders * 0.18)
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
    const mode = this.getWasmMode()
    exposeCurrentPhysicsEngine(mode)

    if (mode === 'wasm-mirror' && this.wasmEngine?.isReady) {
      const t0 = performance.now()
      const alpha = this.wasmEngine.step(rawDt)
      this.lastWasmStepMs = performance.now() - t0
      this.lastRapierStepMs = 0
      this.lastMirrorOverheadMs = 0
      return alpha
    }

    if ((mode === 'wasm-owner' || mode === 'wasm-worker') && this.wasmEngine?.isReady) {
      const wasmT0 = performance.now()
      const alpha = this.wasmEngine.step(rawDt)
      this.lastWasmStepMs = mode === 'wasm-worker'
        ? this.wasmEngine.getLastWorkerStepMs()
        : performance.now() - wasmT0
      this.lastMirrorOverheadMs = 0
      // No Rapier exists on the owner path; the C++ step is the whole simulation.
      this.lastRapierStepMs = 0
      return alpha
    }

    this.lastWasmStepMs = 0
    this.lastRapierStepMs = 0
    this.lastMirrorOverheadMs = 0
    return this.stepRapier(rawDt, callback, forceCallback)
  }

  private stepRapier(
    rawDt: number,
    callback: (handle1: number, handle2: number, started: boolean) => void,
    forceCallback?: ContactForceCallback
  ): number {
    if (!this.world || !this.eventQueue) return 0

    const dt = Math.min(rawDt, MAX_DT)
    this.accumulator += dt

    while (this.accumulator >= FIXED_TIMESTEP) {
      this.world.timestep = FIXED_TIMESTEP
      this.world.step(this.eventQueue)
      this.stepCount++
      this.eventQueue.drainCollisionEvents(callback)
      this.eventQueue.drainContactForceEvents((event) => {
        if (forceCallback) {
          forceCallback(event.collider1(), event.collider2(), event.maxForceMagnitude())
        }
      })
      this.accumulator -= FIXED_TIMESTEP
    }

    return this.accumulator / FIXED_TIMESTEP
  }

  dispose(): void {
    this.tableWorld?.dispose()
    this.tableWorld = null
    this.wasmEngine?.dispose()
    this.wasmEngine = null
    this.wasmActive = false
    this.wasmMode = 'rapier'
    this.world?.free()
    this.world = null
  }
}
