/**
 * WasmPhysicsEngine — TypeScript wrapper around the Emscripten-compiled
 * C++ physics module (native/src → native/build/PhysicsModule.js + .wasm).
 *
 * Design goals
 * ────────────
 * 1. API parity with PhysicsSystem so callers can switch engines without
 *    changing game logic.
 * 2. Graceful fallback — if the WASM bundle is unavailable (dev machine
 *    without a build, or network failure) the engine emits a warning and
 *    stays dormant; callers must check `isReady`.
 * 3. EventBus integration — contact events are forwarded to the bus as
 *    `wasm:physics:contact` so downstream systems can subscribe cleanly.
 *
 * Usage
 * ─────
 *   const wasmEngine = new WasmPhysicsEngine()
 *   await wasmEngine.load()          // fetch + compile WASM
 *   wasmEngine.init(eventBus)        // wire EventBus (optional)
 *
 *   // Per-frame in the render loop:
 *   const alpha = wasmEngine.step(deltaTime)
 *
 * Hybrid mode
 * ───────────
 * WasmPhysicsEngine is designed to work *alongside* Rapier (PhysicsSystem).
 * The recommended pattern for the initial rollout is:
 *   - Keep all existing Rapier bodies in PhysicsSystem.
 *   - Offload new dense simulations (gold-ball swarms, adventure pin fields)
 *     to WasmPhysicsEngine.
 *   - Later, once parity is proven, migrate body creation to the WASM engine.
 */

import type { WasmPhysicsModule, WasmPhysicsWorldInstance, WasmContactEvent } from './wasm-types'
import type { EventBus } from '../game/event-bus'

// ---------------------------------------------------------------------------
// Rigid body descriptor
// ---------------------------------------------------------------------------

export interface WasmBodyDesc {
  position?:       { x: number; y: number; z: number }
  velocity?:       { x: number; y: number; z: number }
  mass?:           number  // kg, default 1
  radius?:         number  // metres, default 0.1
  restitution?:    number  // 0–1, default 0.4
  linearDamping?:  number  // 0–1, default 0.02
  /** 0=Dynamic, 1=Static, 2=Kinematic */
  bodyType?:       0 | 1 | 2
}

// ---------------------------------------------------------------------------
// Engine class
// ---------------------------------------------------------------------------

/** Path to the compiled Emscripten ES module (relative to the web root). */
const WASM_MODULE_URL = './wasm/PhysicsModule.js'

export class WasmPhysicsEngine {
  /** true once the WASM module has loaded and the world is ready. */
  isReady = false

  private module: WasmPhysicsModule | null = null
  private world:  WasmPhysicsWorldInstance | null = null
  private eventBus: EventBus | null = null
  private stepCount_ = 0
  private unsubscribers: Array<() => void> = []

  // ---- Loading ----------------------------------------------------------

  /**
   * Asynchronously fetch, compile, and instantiate the WASM module.
   * Safe to call multiple times — subsequent calls are no-ops.
   *
   * @param moduleUrl  Override the default WASM_MODULE_URL (useful for tests).
   */
  async load(moduleUrl = WASM_MODULE_URL): Promise<void> {
    if (this.isReady) return

    try {
      // Dynamic import of the Emscripten ES module factory
      const { default: factory } = await import(/* @vite-ignore */ moduleUrl) as {
        default: () => Promise<WasmPhysicsModule>
      }
      this.module = await factory()
      this.world  = new this.module.PhysicsWorld()

      // Wire contact events → ContactListener → EventBus (if set)
      this.world.setContactCallbackJS(
        (id1, id2, nx, ny, nz, px, py, pz, impulse, isEntering) => {
          this._handleContact({
            bodyId1: id1, bodyId2: id2,
            normal: { x: nx, y: ny, z: nz },
            point:  { x: px, y: py, z: pz },
            impulse, isEntering,
          })
        }
      )

      this.isReady = true
    } catch (err) {
      console.warn(
        '[WasmPhysicsEngine] WASM module unavailable — engine will stay dormant.',
        err
      )
    }
  }

  /**
   * Wire the EventBus.  Must be called before (or after) load(); order
   * does not matter — the bus reference is checked at each contact event.
   */
  init(bus: EventBus): void {
    this.eventBus = bus
  }

  // ---- World configuration ---------------------------------------------

  /** Override gravity (default matches Rapier: 0, -9.81, -5). */
  setGravity(x: number, y: number, z: number): void {
    this.world?.setGravity(x, y, z)
  }

  /**
   * Add a static infinite half-space plane.
   * @param normal  Unit normal (outward-facing).
   * @param d       Signed plane offset from origin along the normal.
   */
  addStaticPlane(normal: { x: number; y: number; z: number }, d: number): void {
    this.world?.addStaticPlane(normal.x, normal.y, normal.z, d)
  }

  // ---- Body management -------------------------------------------------

  /**
   * Create a dynamic sphere rigid body.
   * @returns Stable integer handle, or -1 if the engine is not ready.
   */
  createBody(desc: WasmBodyDesc = {}): number {
    if (!this.world) return -1
    const p = desc.position      ?? { x: 0, y: 0, z: 0 }
    const v = desc.velocity      ?? { x: 0, y: 0, z: 0 }
    return this.world.createRigidBody(
      p.x, p.y, p.z,
      v.x, v.y, v.z,
      desc.mass          ?? 1,
      desc.radius        ?? 0.1,
      desc.restitution   ?? 0.4,
      desc.linearDamping ?? 0.02,
      desc.bodyType      ?? 0
    )
  }

  /** Remove a body by handle. */
  removeBody(id: number): void {
    this.world?.removeRigidBody(id)
  }

  /** Apply a world-space force (accumulates until next step). */
  applyForce(id: number, fx: number, fy: number, fz: number): void {
    this.world?.applyForce(id, fx, fy, fz)
  }

  /** Apply an instantaneous world-space impulse. */
  applyImpulse(id: number, ix: number, iy: number, iz: number): void {
    this.world?.applyImpulse(id, ix, iy, iz)
  }

  /** Directly set the velocity of a body. */
  setVelocity(id: number, vx: number, vy: number, vz: number): void {
    this.world?.setVelocity(id, vx, vy, vz)
  }

  /** Directly set the position of a body (used for Rapier↔WASM sync). */
  setBodyPosition(id: number, px: number, py: number, pz: number): void {
    this.world?.setBodyPosition(id, px, py, pz)
  }

  /** Directly set the rotation of a body (used for Rapier↔WASM sync). */
  setBodyRotation(id: number, qx: number, qy: number, qz: number, qw: number): void {
    this.world?.setBodyRotation(id, qx, qy, qz, qw)
  }

  // ---- Transform queries -----------------------------------------------

  getPosition(id: number): { x: number; y: number; z: number } {
    if (!this.world) return { x: 0, y: 0, z: 0 }
    return {
      x: this.world.getPosX(id),
      y: this.world.getPosY(id),
      z: this.world.getPosZ(id),
    }
  }

  getVelocity(id: number): { x: number; y: number; z: number } {
    if (!this.world) return { x: 0, y: 0, z: 0 }
    return {
      x: this.world.getVelX(id),
      y: this.world.getVelY(id),
      z: this.world.getVelZ(id),
    }
  }

  getRotation(id: number): { x: number; y: number; z: number; w: number } {
    if (!this.world) return { x: 0, y: 0, z: 0, w: 1 }
    return {
      x: this.world.getRotX(id),
      y: this.world.getRotY(id),
      z: this.world.getRotZ(id),
      w: this.world.getRotW(id),
    }
  }

  // ---- Simulation step -------------------------------------------------

  /**
   * Advance the simulation by `rawDt` seconds (fixed-step accumulator).
   * @returns Interpolation alpha (0–1) for visual smoothing.
   */
  step(rawDt: number): number {
    if (!this.world) return 0
    const alpha = this.world.step(rawDt)
    this.stepCount_ = this.world.getStepCount()
    return alpha
  }

  getStepCount(): number { return this.stepCount_ }

  getActiveBodyCount(): number {
    return this.world?.getActiveBodyCount() ?? 0
  }

  // ---- Teardown --------------------------------------------------------

  dispose(): void {
    for (const unsub of this.unsubscribers) unsub()
    this.unsubscribers = []
    this.world?.delete()
    this.world    = null
    this.module   = null
    this.isReady  = false
    this.eventBus = null
  }

  // ---- Internal --------------------------------------------------------

  private _handleContact(evt: WasmContactEvent): void {
    if (!this.eventBus) return
    this.eventBus.emit('wasm:physics:contact', evt)
  }
}
