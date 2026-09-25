/**
 * WasmPhysicsEngine — TypeScript wrapper around the Emscripten-compiled
 * C++ physics module (native/src → public/wasm/PhysicsModule.js + .wasm).
 *
 * This is the in-process `WasmSimEngine`: `wasm-owner` (production default,
 * `src/config/physics.ts`) and `wasm-mirror` drive it on the main thread, and
 * `physics-worker.ts` drives the same class inside the `wasm-worker` Dedicated
 * Worker. Missing bundle → the engine stays dormant (`isReady === false`) and
 * the physics controller fail-closes to Rapier.
 *
 * File layout
 * ───────────
 *   PhysicsModule.ts             load, world config, table statics, bodies, hinges, step
 *   physics-module-adventure.ts  cylinder / sphere / mesh / mover / sensor / box body / field
 *   contact-buffer.ts            packed contact codec
 *   transform-buffer.ts          packed transform codec
 *
 * Usage
 * ─────
 *   const wasmEngine = new WasmPhysicsEngine()
 *   await wasmEngine.load()          // fetch + compile WASM
 *   wasmEngine.init(eventBus)        // wire EventBus (optional)
 *   const alpha = wasmEngine.step(deltaTime)   // per frame
 *
 * Any mutating method added here must also exist as a worker command
 * (physics-worker-protocol.ts) — tests/wasm-worker-api-parity.test.ts enforces it.
 */

import type { WasmPhysicsModule, WasmPhysicsWorldInstance, WasmContactEvent } from './wasm-types'
import { CONTACT_STRIDE, decodeContactBuffer, toWasmContactEvent } from './contact-buffer'
import {
  TRANSFORM_STRIDE,
  createTransformBufferView,
  decodeTransformSlot,
} from './transform-buffer'
import { getPreloadedWasmModule } from '../engine/wasm-idle-preload'
import * as adventure from './physics-module-adventure'
import {
  WasmVolumeShape,
  type WasmBodyType,
  type WasmBoxBodyDesc,
  type WasmForceFieldDesc,
} from './physics-module-adventure'

export {
  WasmBodyType,
  WasmVolumeShape,
  WasmForceSpace,
  type WasmBoxBodyDesc,
  type WasmForceFieldDesc,
} from './physics-module-adventure'

/**
 * Minimal EventBus surface this engine needs. Deliberately narrower than the
 * real `EventBus` type (`../core/event-bus`) — that file's payload types pull in
 * Babylon-typed `GameState`/`UnlockedReward` fields via `game-elements/types.ts`,
 * which this class must stay decoupled from: it's imported by the Worker-lib
 * `physics-worker.ts` compile graph (see tsconfig.worker.json), which has no DOM
 * lib globals. Any real `EventBus` instance satisfies this shape structurally.
 */
export interface WasmContactEventBus {
  emit(event: 'wasm:physics:contact', payload: WasmContactEvent): void
}

// ---------------------------------------------------------------------------
// Rigid body descriptor
// ---------------------------------------------------------------------------

export interface WasmBodyDesc {
  position?:       { x: number; y: number; z: number }
  velocity?:       { x: number; y: number; z: number }
  mass?:           number  // kg, default 1
  radius?:         number  // metres; sphere radius, or capsule radius, default 0.1
  restitution?:    number  // 0–1, default 0.4
  linearDamping?:  number  // 0–1, default 0.02
  /** Coulomb friction coefficient, default 0.2. Combined per-pair as sqrt(μ_a μ_b). */
  friction?:       number
  /** Angular drag factor for dynamic spheres, default 0.1. */
  angularDamping?: number
  /** 0=Dynamic, 1=Static, 2=Kinematic */
  bodyType?:       WasmBodyType
  /** 'sphere' (default) or 'capsule' — capsule segment runs along local +Y. */
  shape?:          'sphere' | 'capsule'
  /** Half-length of the capsule segment (metres). Ignored for sphere shape. */
  capsuleHalfHeight?: number
}

/** World-anchored revolute hinge (flipper vs static table). */
export interface WasmHingeDesc {
  bodyId: number
  worldAnchor: { x: number; y: number; z: number }
  worldAxis?: { x: number; y: number; z: number }
  minAngle?: number
  maxAngle?: number
}

// ---------------------------------------------------------------------------
// Engine class
// ---------------------------------------------------------------------------

/** Path to the compiled Emscripten ES module (relative to the web root). */
const WASM_MODULE_URL = './wasm/PhysicsModule.js'

/** Resolve a public-root WASM URL. `import(rel)` is relative to this module (`src/wasm/`), not `/`. */
function resolveModuleUrl(moduleUrl: string): string {
  if (/^(https?:|blob:)/i.test(moduleUrl) || moduleUrl.startsWith('/')) return moduleUrl
  // Accessed via globalThis (not the bare `window` identifier) — this class is
  // instantiated both on the main thread (DOM lib) and inside the physics worker
  // (WebWorker lib), so it must stay lib-agnostic.
  const win = (globalThis as Record<string, unknown>).window as
    | { location?: { href?: string } }
    | undefined
  if (!win?.location?.href) return moduleUrl
  try {
    return new URL(moduleUrl, win.location.href).href
  } catch {
    return moduleUrl
  }
}

export class WasmPhysicsEngine {
  /** true once the WASM module has loaded and the world is ready. */
  isReady = false

  private module: WasmPhysicsModule | null = null
  private world:  WasmPhysicsWorldInstance | null = null
  private eventBus: WasmContactEventBus | null = null
  private stepCount_ = 0
  /**
   * False after a step that ran no substeps. Native only flushes the contact
   * buffer when it substeps, so without this a sub-fixed-step frame (any
   * display faster than the fixed rate) would re-deliver the previous step's
   * contacts — double-scoring every Enter.
   */
  private contactsFresh = false
  private unsubscribers: Array<() => void> = []
  private transformView: Float32Array | null = null
  private heapByteLength = 0

  // ---- Loading ----------------------------------------------------------

  /**
   * Asynchronously fetch, compile, and instantiate the WASM module.
   * Safe to call multiple times — subsequent calls are no-ops.
   *
   * @param moduleUrl  Override the default WASM_MODULE_URL (useful for tests).
   * @param preloadedModule  Optional module from idle warm-load cache.
   */
  async load(moduleUrl = WASM_MODULE_URL, preloadedModule?: WasmPhysicsModule): Promise<void> {
    if (this.isReady) return

    try {
      if (preloadedModule) {
        this.module = preloadedModule
      } else {
        const cached = await getPreloadedWasmModule()
        if (cached) {
          this.module = cached
        } else {
          const { default: factory } = await import(/* @vite-ignore */ resolveModuleUrl(moduleUrl)) as {
            default: () => Promise<WasmPhysicsModule>
          }
          this.module = await factory()
        }
      }
      this.world  = new this.module.PhysicsWorld()
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
  init(bus: WasmContactEventBus): void {
    this.eventBus = bus
  }

  // ---- World configuration ---------------------------------------------

  /** Override gravity (default matches Rapier: 0, -9.81, -5). */
  setGravity(x: number, y: number, z: number): void {
    this.world?.setGravity(x, y, z)
  }

  /** Rolling-resistance coefficient applied at contacts after Coulomb friction. */
  setRollingResistance(rr: number): void {
    this.world?.setRollingResistance(rr)
  }

  /**
   * Add a static infinite half-space plane.
   * @param normal  Unit normal (outward-facing).
   * @param d       Signed plane offset from origin along the normal.
   */
  addStaticPlane(normal: { x: number; y: number; z: number }, d: number, friction = 0.2): void {
    this.world?.addStaticPlane(normal.x, normal.y, normal.z, d, friction)
  }

  /**
   * Add an oriented static box collider.
   * @returns Negative collider id, or -1 when the engine is not ready.
   */
  addStaticBox(
    center: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 1 },
    restitution = 0.4,
    friction = 0.2
  ): number {
    if (!this.world) return -1
    return this.world.addStaticBox(
      center.x, center.y, center.z,
      halfExtents.x, halfExtents.y, halfExtents.z,
      rotation.x, rotation.y, rotation.z, rotation.w,
      restitution,
      friction
    )
  }

  /**
   * Add an oriented static capsule collider (local Y axis).
   * @returns Negative collider id, or -1 when the engine is not ready.
   */
  addStaticCapsule(
    center: { x: number; y: number; z: number },
    radius: number,
    halfHeight: number,
    rotation: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 1 },
    restitution = 0.4,
    friction = 0.2
  ): number {
    if (!this.world) return -1
    return this.world.addStaticCapsule(
      center.x, center.y, center.z,
      radius, halfHeight,
      rotation.x, rotation.y, rotation.z, rotation.w,
      restitution,
      friction
    )
  }

  /**
   * Add an oriented static cylinder collider (local Y axis), matching
   * Rapier's `ColliderDesc.cylinder(halfHeight, radius)`.
   * @returns Negative collider id, or -1 when the engine is not ready.
   */
  addStaticCylinder(
    center: { x: number; y: number; z: number },
    radius: number,
    halfHeight: number,
    rotation?: { x: number; y: number; z: number; w: number },
    restitution?: number,
    friction?: number
  ): number {
    return adventure.addStaticCylinder(this.world, center, radius, halfHeight, rotation, restitution, friction)
  }

  /**
   * Add an oriented static cone collider (local Y axis, apex at +halfHeight),
   * matching Rapier's `ColliderDesc.cone(halfHeight, radius)` — ball-trap
   * funnels. @returns Negative collider id, or -1 when not ready.
   */
  addStaticCone(
    center: { x: number; y: number; z: number },
    radius: number,
    halfHeight: number,
    rotation?: { x: number; y: number; z: number; w: number },
    restitution?: number,
    friction?: number
  ): number {
    return adventure.addStaticCone(this.world, center, radius, halfHeight, rotation, restitution, friction)
  }

  /** Add a static sphere collider. @returns Negative collider id, or -1. */
  addStaticSphere(
    center: { x: number; y: number; z: number },
    radius: number,
    restitution?: number,
    friction?: number
  ): number {
    return adventure.addStaticSphere(this.world, center, radius, restitution, friction)
  }

  /**
   * Drop every static collider, sensor volume and kinematic mover. Statics
   * are append-only, so a rebuilt scene must clear before re-adding or it
   * stacks a second copy. Invalidates every negative handle; dynamic bodies
   * and hinges are untouched.
   */
  clearStaticGeometry(): void {
    this.world?.clearStaticGeometry()
  }

  /** Add a kinematic oriented-box mover (piston, platter, gate). @returns Negative handle, or -1. */
  addKinematicMover(
    position: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
    rotation?: { x: number; y: number; z: number; w: number },
    restitution?: number,
    friction?: number,
    shape: WasmVolumeShape = WasmVolumeShape.Box
  ): number {
    return adventure.addKinematicMover(this.world, position, halfExtents, rotation, restitution, friction, shape)
  }

  /**
   * Push the pose a kinematic mover (negative id) or a kinematic rigid body
   * (id ≥ 0, see `setBodyType`) should reach by the next `step()`. Its
   * velocity for that step is the pose delta over the fixed tick.
   */
  setNextKinematicTransform(
    id: number,
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number }
  ): void {
    adventure.setNextKinematicTransform(this.world, id, position, rotation)
  }

  /**
   * Add a static sensor volume (Enter/Stay/Exit contact events, zero impulse,
   * no positional correction). @returns Negative handle, or -1.
   */
  addSensorVolume(
    center: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
    rotation?: { x: number; y: number; z: number; w: number },
    shape: WasmVolumeShape = WasmVolumeShape.Box
  ): number {
    return adventure.addSensorVolume(this.world, center, halfExtents, rotation, shape)
  }

  /**
   * Add an immutable static triangle mesh — adventure ramps, walls, floors.
   * @param vertices 3 floats per vertex, world space.
   * @param indices  3 indices per triangle, CCW when seen from the front face.
   * @returns Negative mesh id, or -1 when the engine is not ready.
   */
  addStaticTriangleMesh(
    vertices: Float32Array,
    indices: Uint32Array,
    restitution?: number,
    friction?: number,
    doubleSided?: boolean
  ): number {
    return adventure.addStaticTriangleMesh(
      this.world, this.module, vertices, indices, restitution, friction, doubleSided,
    )
  }

  /** Create a dynamic oriented-box body (a crate). @returns Body handle, or -1. */
  createBoxBody(desc: WasmBoxBodyDesc): number {
    return adventure.createBoxBody(this.world, desc)
  }

  /** Add an oriented box force region (updraft, conveyor, solar wind). @returns Negative handle, or -1. */
  addForceField(desc: WasmForceFieldDesc): number {
    return adventure.addForceField(this.world, desc)
  }

  /** Toggle a force field without removing it (gates a conveyor on and off). */
  setForceFieldEnabled(fieldId: number, enabled: boolean): void {
    this.world?.setForceFieldEnabled?.(fieldId, enabled)
  }

  /** Retarget a force field's vector, keeping its region and mode. */
  setForceFieldVector(fieldId: number, fx: number, fy: number, fz: number): void {
    this.world?.setForceFieldVector?.(fieldId, fx, fy, fz)
  }

  /**
   * Set the collision-group membership/filter mask for any handle — a
   * dynamic/kinematic body, or a static box/capsule/cylinder/sphere/mover/
   * sensor (as
   * returned by its add*() call). Mirrors `CollisionGroups` in
   * src/game-elements/physics.ts.
   */
  setCollisionGroups(id: number, membership: number, filter: number): void {
    this.world?.setCollisionGroups(id, membership, filter)
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
      desc.bodyType      ?? 0,
      desc.shape === 'capsule' ? 1 : 0,
      desc.capsuleHalfHeight ?? 0.5,
      desc.friction          ?? 0.2,
      desc.angularDamping    ?? 0.1
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

  /** Directly set the angular velocity of a body. */
  setAngularVelocity(id: number, wx: number, wy: number, wz: number): void {
    this.world?.setAngularVelocity(id, wx, wy, wz)
  }

  /** Directly set the position of a body (used for Rapier↔WASM sync). */
  setBodyPosition(id: number, px: number, py: number, pz: number): void {
    this.world?.setBodyPosition(id, px, py, pz)
  }

  /** Directly set the rotation of a body (used for Rapier↔WASM sync). */
  setBodyRotation(id: number, qx: number, qy: number, qz: number, qw: number): void {
    this.world?.setBodyRotation(id, qx, qy, qz, qw)
  }

  /**
   * Change a live body's simulation type — a toy capturing a ball (#420).
   * → Kinematic: infinite mass, no gravity, velocity zeroed; it then moves
   * only by `setNextKinematicTransform`. → Dynamic: mass restored, the last
   * kinematic velocity kept.
   */
  setBodyType(id: number, type: WasmBodyType): void {
    this.world?.setBodyType?.(id, type)
  }

  /** Current body type (debug / tests), or -1 for an unknown id or an older bundle. */
  getBodyType(id: number): number {
    return this.world?.getBodyType?.(id) ?? -1
  }

  // ---- Hinges --------------------------------------------------------------

  createHinge(desc: WasmHingeDesc): number {
    if (!this.world?.createHinge) return -1
    const a = desc.worldAnchor
    const n = desc.worldAxis ?? { x: 0, y: 1, z: 0 }
    return this.world.createHinge(
      desc.bodyId,
      a.x, a.y, a.z,
      n.x, n.y, n.z,
      desc.minAngle ?? -Math.PI,
      desc.maxAngle ?? Math.PI
    )
  }

  setHingeMotor(id: number, targetVel: number, maxTorque: number): void {
    this.world?.setHingeMotor?.(id, targetVel, maxTorque)
  }

  getHingeAngle(id: number): number {
    return this.world?.getHingeAngle?.(id) ?? 0
  }

  removeHinge(id: number): void {
    this.world?.removeHinge?.(id)
  }

  // ---- Transform queries -----------------------------------------------

  getPosition(id: number): { x: number; y: number; z: number } {
    const fromBuffer = this.readTransformFromBuffer(id)
    if (fromBuffer) return fromBuffer.position
    if (!this.world) return { x: 0, y: 0, z: 0 }
    return {
      x: this.world.getPosX(id),
      y: this.world.getPosY(id),
      z: this.world.getPosZ(id),
    }
  }

  getVelocity(id: number): { x: number; y: number; z: number } {
    const fromBuffer = this.readTransformFromBuffer(id)
    if (fromBuffer) return fromBuffer.velocity
    if (!this.world) return { x: 0, y: 0, z: 0 }
    return {
      x: this.world.getVelX(id),
      y: this.world.getVelY(id),
      z: this.world.getVelZ(id),
    }
  }

  getAngularVelocity(id: number): { x: number; y: number; z: number } {
    const fromBuffer = this.readTransformFromBuffer(id)
    if (fromBuffer) return fromBuffer.angularVelocity
    if (!this.world) return { x: 0, y: 0, z: 0 }
    return {
      x: this.world.getAngVelX(id),
      y: this.world.getAngVelY(id),
      z: this.world.getAngVelZ(id),
    }
  }

  getRotation(id: number): { x: number; y: number; z: number; w: number } {
    const fromBuffer = this.readTransformFromBuffer(id)
    if (fromBuffer) return fromBuffer.rotation
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
    const stepCount = this.world.getStepCount()
    this.contactsFresh = stepCount !== this.stepCount_
    this.stepCount_ = stepCount
    this.transformView = null
    this.drainContactBuffer()
    return alpha
  }

  getDroppedContactCount(): number {
    return this.world?.getDroppedContactCount() ?? 0
  }

  setMaxContacts(max: number): void {
    this.world?.setMaxContacts(max)
  }

  getStepCount(): number { return this.stepCount_ }

  getActiveBodyCount(): number {
    return this.world?.getActiveBodyCount() ?? 0
  }

  hasTransformSnapshot(): boolean {
    return this.isReady
  }

  getLastWorkerStepMs(): number {
    return 0
  }

  /**
   * Live HEAP view of the packed transforms. Valid until the next step or heap
   * growth — the worker copies it straight into the shared snapshot buffer.
   */
  getTransformHeapView(): Float32Array | null {
    return this.refreshTransformView()
  }

  /** Live HEAP view of this step's packed contacts; same lifetime as above. */
  getContactHeapView(): { view: Float32Array; count: number } | null {
    if (!this.world || !this.module || !this.contactsFresh) return null
    const count = this.world.getContactCount()
    if (count <= 0) return null
    const heap = this.getHeapF32()
    const ptr = this.world.getContactBufferPtr()
    if (!heap || ptr === 0) return null
    const start = ptr >> 2
    const end = start + count * CONTACT_STRIDE
    if (end > heap.length) return null
    return { view: heap.subarray(start, end), count }
  }

  /** Detached copy of the packed transform HEAP (worker → main transfer). */
  copyTransformBuffer(): ArrayBuffer {
    const view = this.refreshTransformView()
    if (!view || view.length === 0) return new ArrayBuffer(0)
    const copy = new Float32Array(view.length)
    copy.set(view)
    return copy.buffer
  }

  /** Detached copy of the packed contact HEAP. */
  copyContactBuffer(): { buffer: ArrayBuffer; count: number } {
    if (!this.world || !this.module || !this.contactsFresh) return { buffer: new ArrayBuffer(0), count: 0 }
    const count = this.world.getContactCount()
    if (count <= 0) return { buffer: new ArrayBuffer(0), count: 0 }
    const heap = this.getHeapF32()
    if (!heap) return { buffer: new ArrayBuffer(0), count: 0 }
    const ptr = this.world.getContactBufferPtr()
    if (ptr === 0) return { buffer: new ArrayBuffer(0), count: 0 }
    const start = ptr >> 2
    const end = start + count * CONTACT_STRIDE
    if (end > heap.length) return { buffer: new ArrayBuffer(0), count: 0 }
    const copy = new Float32Array(count * CONTACT_STRIDE)
    copy.set(heap.subarray(start, end))
    return { buffer: copy.buffer, count }
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
    this.transformView = null
    this.heapByteLength = 0
    this.stepCount_ = 0
    this.contactsFresh = false
  }

  // ---- Internal --------------------------------------------------------

  private readTransformFromBuffer(id: number) {
    const view = this.refreshTransformView()
    if (!view) return null
    return decodeTransformSlot(view, id, TRANSFORM_STRIDE)
  }

  private refreshTransformView(): Float32Array | null {
    if (!this.world || !this.module) return null
    const heap = this.getHeapF32()
    if (!heap) return null

    const buffer = this.module.wasmMemory?.buffer ?? heap.buffer
    if (buffer.byteLength !== this.heapByteLength) {
      this.heapByteLength = buffer.byteLength
      this.transformView = null
    }

    if (!this.transformView) {
      const ptr = this.world.getTransformBufferPtr?.()
      if (ptr === undefined || ptr === 0) return null
      const slotCount = this.world.getTransformSlotCount?.() ?? 0
      if (slotCount <= 0) return null
      const stride = this.world.getTransformStride?.() ?? TRANSFORM_STRIDE
      const heapFresh = this.getHeapF32()
      if (!heapFresh) return null
      this.transformView = createTransformBufferView(heapFresh, ptr, slotCount, stride)
    }

    return this.transformView
  }

  private drainContactBuffer(): void {
    if (!this.world || !this.module || !this.contactsFresh) return
    const count = this.world.getContactCount()
    if (count <= 0) return

    const heap = this.getHeapF32()
    if (!heap) return

    const ptr = this.world.getContactBufferPtr()
    if (ptr === 0) return

    const start = ptr >> 2
    const end = start + count * CONTACT_STRIDE
    if (end > heap.length) return

    const view = heap.subarray(start, end)
    const contacts = decodeContactBuffer(view, count)
    for (const contact of contacts) {
      this._handleContact(toWasmContactEvent(contact))
    }
  }

  private getHeapF32(): Float32Array | null {
    return adventure.heapF32(this.module)
  }

  private _handleContact(evt: WasmContactEvent): void {
    if (!this.eventBus) return
    this.eventBus.emit('wasm:physics:contact', evt)
  }
}
