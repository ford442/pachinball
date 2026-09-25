/**
 * TypeScript type definitions for the Emscripten-compiled Pachinball physics
 * WASM module (native/src → native/build/PhysicsModule.js + .wasm).
 *
 * These types match the Embind bindings declared in native/src/bindings.cpp.
 * They are intentionally narrow — only the surface area actually exposed to JS.
 */

/**
 * Mirrors native `STATIC_HANDLE_OVERFLOW` in PhysicsWorld.h. Every `add*`
 * that creates a static shape returns this instead of a handle once its
 * family hits `STATIC_HANDLE_CAPACITY` (1000), and creates no collider.
 *
 * It is positive, so it can never be mistaken for a static handle, and
 * `setCollisionGroups` ignores it. Callers must treat it as a failure rather
 * than storing it: a stored sentinel would name geometry that does not exist.
 */
export const STATIC_HANDLE_OVERFLOW = 0x7FFFFFFF

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Mirrors native `SNAPSHOT_VERSION` (native/src/Snapshot.h). Recorded in replay metadata. */
export const WASM_SNAPSHOT_VERSION = 1

/**
 * `restoreSnapshot` result — mirrors native `SnapshotStatus` (Snapshot.h), plus
 * `Unsupported` for an engine that cannot snapshot (an old bundle, the worker).
 * Anything but `Ok` leaves the world exactly as it was.
 */
export const WasmSnapshotStatus = {
  Unsupported: -1,
  Ok: 0,
  BadMagic: 1,
  BadVersion: 2,
  Truncated: 3,
  /** The snapshot was taken on a differently built table (static hash / counts). */
  StaticMismatch: 4,
  Corrupt: 5,
} as const
export type WasmSnapshotStatus = (typeof WasmSnapshotStatus)[keyof typeof WasmSnapshotStatus]

/** Mirrors the C++ BodyType enum. */
export const enum BodyType {
  Dynamic   = 0,
  Static    = 1,
  Kinematic = 2,
}

/** Mirrors the C++ Shape enum. */
export const enum Shape {
  Sphere  = 0,
  Capsule = 1,
}

// ---------------------------------------------------------------------------
// Contact event (shared Rapier / WASM record)
// ---------------------------------------------------------------------------

export {
  ContactPhase,
  CONTACT_STRIDE,
  decodeContactBuffer,
  encodeContactBuffer,
  contactStarted,
  toWasmContactEvent,
  type PhysicsContact,
  type WasmContactEvent,
} from './contact-buffer'

// ---------------------------------------------------------------------------
// Raw WASM module interface (Embind class bindings)
// ---------------------------------------------------------------------------

/** The compiled Embind class proxy for PhysicsWorld. */
export interface WasmPhysicsWorldInstance {
  /** Create a rigid body (sphere or capsule shape); returns a stable integer handle. */
  createRigidBody(
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    mass: number, radius: number, restitution: number, linearDamping: number,
    bodyType: number, shape: number, capsuleHalfHeight: number,
    friction: number, angularDamping: number
  ): number

  /** Create a rigid body from a bound RigidBodyDesc value object. */
  createRigidBodyDesc(desc: {
    position: { x: number; y: number; z: number }
    velocity: { x: number; y: number; z: number }
    mass: number
    radius: number
    restitution: number
    linearDamping: number
    type: number
    shape: number
    capsuleHalfHeight: number
    friction: number
    angularDamping: number
  }): number

  /** Remove a body by handle. The handle is no longer valid after this. */
  removeRigidBody(id: number): void

  /** Accumulate a world-space force on a dynamic body. */
  applyForce(id: number, fx: number, fy: number, fz: number): void

  /** Apply an instantaneous world-space impulse. */
  applyImpulse(id: number, ix: number, iy: number, iz: number): void

  /** Directly set the velocity of a body. */
  setVelocity(id: number, vx: number, vy: number, vz: number): void

  /** Directly set the angular velocity of a body. */
  setAngularVelocity(id: number, wx: number, wy: number, wz: number): void

  /** Directly set the position of a body. */
  setBodyPosition(id: number, px: number, py: number, pz: number): void

  /** Directly set the rotation of a body. */
  setBodyRotation(id: number, qx: number, qy: number, qz: number, qw: number): void

  /**
   * Change a live body's simulation type (0 Dynamic, 1 Static, 2 Kinematic).
   * Optional: absent on bundles older than #420.
   */
  setBodyType?(id: number, type: number): void

  /** Current body type (0/1/2), or -1 for an unknown id. Optional as above. */
  getBodyType?(id: number): number

  createHinge(
    bodyId: number,
    ax: number, ay: number, az: number,
    nx: number, ny: number, nz: number,
    minAngle: number, maxAngle: number
  ): number
  setHingeMotor(id: number, targetVel: number, maxTorque: number): void
  getHingeAngle(id: number): number
  removeHinge(id: number): void

  /** Add an infinite static plane defined by a normal + d offset. */
  addStaticPlane(nx: number, ny: number, nz: number, distance: number, friction: number): void

  /**
   * Add an oriented static box collider.
   * @returns Negative collider id used in contact events.
   */
  addStaticBox(
    px: number, py: number, pz: number,
    hx: number, hy: number, hz: number,
    qx: number, qy: number, qz: number, qw: number,
    restitution?: number,
    friction?: number
  ): number

  /**
   * Add an oriented static capsule collider (local Y axis).
   * @returns Negative collider id used in contact events.
   */
  addStaticCapsule(
    px: number, py: number, pz: number,
    radius: number, halfHeight: number,
    qx: number, qy: number, qz: number, qw: number,
    restitution?: number,
    friction?: number
  ): number

  /**
   * Add an oriented static cylinder collider (local Y axis), matching
   * Rapier's `ColliderDesc.cylinder(halfHeight, radius)`.
   * @returns Negative collider id used in contact events, or
   * `STATIC_HANDLE_OVERFLOW` (creating nothing) if the family is full.
   */
  addStaticCylinder(
    px: number, py: number, pz: number,
    radius: number, halfHeight: number,
    qx: number, qy: number, qz: number, qw: number,
    restitution?: number,
    friction?: number
  ): number

  /**
   * Add a static sphere collider.
   * @returns Negative collider id used in contact events, or
   * `STATIC_HANDLE_OVERFLOW` (creating nothing) if the family is full.
   */
  addStaticSphere(
    px: number, py: number, pz: number,
    radius: number,
    restitution?: number,
    friction?: number
  ): number

  /**
   * Add an oriented static cone (local Y axis, apex at +halfHeight), matching
   * Rapier's `ColliderDesc.cone(halfHeight, radius)`. Optional: absent on
   * bundles older than #420.
   * @returns Negative collider id used in contact events, or
   * `STATIC_HANDLE_OVERFLOW` (creating nothing) if the family is full.
   */
  addStaticCone?(
    px: number, py: number, pz: number,
    radius: number, halfHeight: number,
    qx: number, qy: number, qz: number, qw: number,
    restitution: number,
    friction: number
  ): number

  /**
   * Add a whole pachinko pin lattice as ONE static collider (#421). The
   * keep-outs (4 floats each: minX, maxX, minZ, maxZ) and the bit-packed
   * occupancy mask are heap byte offsets (allocate with `_malloc`); C++ copies
   * both. Optional: absent on bundles older than #421.
   * @returns Negative field id used in contact events (the pin's lattice index
   * rides in contact slot 11), or `STATIC_HANDLE_OVERFLOW` if the family is full.
   */
  addPinField?(
    px: number, py: number, pz: number,
    rows: number, cols: number,
    spacingX: number, spacingZ: number, rowOffsetX: number,
    radius: number, halfHeight: number,
    qx: number, qy: number, qz: number, qw: number,
    restitution: number, friction: number,
    keepOutPtr: number, keepOutCount: number,
    maskPtr: number, maskBytes: number,
    dropoutSeed: number, dropout: number
  ): number

  /** Pins a field holds after mask / keep-outs / dropout, or -1 for an unknown id. */
  getPinFieldPinCount?(fieldId: number): number

  /**
   * Drop every static collider, sensor volume and kinematic mover. Statics
   * are append-only, so a rebuilt scene must clear before re-adding or it
   * stacks a second copy. Invalidates every negative handle; dynamic bodies
   * and hinges are untouched.
   */
  clearStaticGeometry(): void

  /**
   * Add a kinematic oriented-box mover (piston, platter, gate). Its pose is
   * pushed once per tick via `setNextKinematicTransform`; linear/angular
   * velocity is derived from the pose delta so contacts pick up its motion.
   * @returns Negative handle used in contact events / setCollisionGroups.
   */
  addKinematicMover(
    px: number, py: number, pz: number,
    hx: number, hy: number, hz: number,
    qx: number, qy: number, qz: number, qw: number,
    restitution: number,
    friction: number
  ): number

  /**
   * Add a kinematic mover with an explicit shape tag (0 box, 1 cylinder,
   * 2 sphere). A cylinder mover keeps a rotating platform's round profile
   * instead of approximating it with a faceted box.
   * @returns Negative handle used in contact events / setCollisionGroups.
   */
  addKinematicMoverShaped(
    shape: number,
    px: number, py: number, pz: number,
    hx: number, hy: number, hz: number,
    qx: number, qy: number, qz: number, qw: number,
    restitution: number,
    friction: number
  ): number

  /**
   * Push the pose a mover (negative id) or a kinematic rigid body (id ≥ 0)
   * should reach by the next `step()`.
   */
  setNextKinematicTransform(
    id: number,
    px: number, py: number, pz: number,
    qx: number, qy: number, qz: number, qw: number
  ): void

  /**
   * Add a static OBB trigger volume. Produces Enter/Stay/Exit contact
   * events (via the packed contact buffer, `isSensor` bit set) with zero
   * impulse and no positional correction.
   * @returns Negative handle used in contact events / setCollisionGroups.
   */
  addSensorVolume(
    px: number, py: number, pz: number,
    hx: number, hy: number, hz: number,
    qx: number, qy: number, qz: number, qw: number
  ): number

  /** Sensor volume with an explicit shape tag (0 box, 1 cylinder, 2 sphere). */
  addSensorVolumeShaped(
    shape: number,
    px: number, py: number, pz: number,
    hx: number, hy: number, hz: number,
    qx: number, qy: number, qz: number, qw: number
  ): number

  /**
   * Add an oriented static cylinder collider (local Y axis) — pachinko pins,
   * arc pylons, chroma gates.
   * @returns Negative collider id used in contact events.
   */
  addStaticCylinder(
    px: number, py: number, pz: number,
    radius: number, halfHeight: number,
    qx: number, qy: number, qz: number, qw: number,
    restitution?: number,
    friction?: number
  ): number

  /**
   * Add an immutable static triangle mesh. `verticesPtr` and `indicesPtr` are
   * byte offsets into WASM memory (allocate with `_malloc`); vertices are
   * 3 floats each, indices 3 uint32 per triangle, CCW for the front face.
   * @returns Negative mesh id used in contact events.
   */
  addStaticTriangleMesh(
    verticesPtr: number, vertexCount: number,
    indicesPtr: number, indexCount: number,
    restitution: number, friction: number, doubleSided: boolean
  ): number

  /** Create a dynamic oriented-box body (crate). @returns Stable body handle. */
  createBoxBody(
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    mass: number, hx: number, hy: number, hz: number,
    restitution: number, linearDamping: number,
    bodyType: number, friction: number, angularDamping: number
  ): number

  /**
   * Add an oriented box force region (updraft, conveyor, solar wind).
   * `space` is 0 world / 1 local; `acceleration` selects the mass-independent
   * form (m/s²) over a force in newtons.
   * @returns Negative handle used in setForceField*() / setCollisionGroups.
   */
  addForceField(
    px: number, py: number, pz: number,
    hx: number, hy: number, hz: number,
    qx: number, qy: number, qz: number, qw: number,
    fx: number, fy: number, fz: number,
    space: number, acceleration: boolean
  ): number

  /** Drop all static/kinematic geometry and force fields; negative handles are invalidated. */
  clearStaticGeometry(): void

  setForceFieldEnabled(fieldId: number, enabled: boolean): void
  setForceFieldVector(fieldId: number, fx: number, fy: number, fz: number): void

  /**
   * Set the collision-group membership/filter mask for any handle — a
   * dynamic/kinematic body (id ≥ 0) or a static
   * box/capsule/cylinder/sphere/mover/sensor (id < 0, as returned by the
   * matching add*() call). Mirrors
   * `CollisionGroups` in src/game-elements/physics.ts.
   */
  setCollisionGroups(id: number, membership: number, filter: number): void

  // Position getters
  getPosX(id: number): number
  getPosY(id: number): number
  getPosZ(id: number): number

  // Velocity getters
  getVelX(id: number): number
  getVelY(id: number): number
  getVelZ(id: number): number

  getAngVelX(id: number): number
  getAngVelY(id: number): number
  getAngVelZ(id: number): number

  // Rotation (quaternion) getters
  getRotX(id: number): number
  getRotY(id: number): number
  getRotZ(id: number): number
  getRotW(id: number): number

  /**
   * Advance the simulation by rawDt seconds.
   * @returns Interpolation alpha (0–1) for visual smoothing.
   */
  step(rawDt: number): number

  /** Total number of substeps taken since world creation. */
  getStepCount(): number

  /** Count of active rigid bodies (excluding removed ones). */
  getActiveBodyCount(): number

  /** Override global gravity. */
  setGravity(gx: number, gy: number, gz: number): void

  setRollingResistance(rr: number): void
  getRollingResistance(): number

  /**
   * Pointer (byte offset into WASM memory) of the packed contact buffer.
   * Layout: 12 floats/contact — id1, id2, nx, ny, nz, px, py, pz, impulse, phase, isSensor,
   * pin-field lattice index (0 for every other collider).
   */
  getContactBufferPtr(): number

  /** Contacts written this step. */
  getContactCount(): number

  /** Contacts discarded this step when the cap was hit. */
  getDroppedContactCount(): number

  /**
   * Static shapes refused because their negative-handle family hit its
   * 1000-entry capacity. Non-zero means geometry is missing from the C++
   * world — the alternative would have been two shapes sharing a handle.
   */
  getDroppedStaticCount(): number

  setMaxContacts(max: number): void
  getMaxContacts(): number

  /**
   * Pointer to packed per-id transform slots (16 floats/slot).
   * Layout: id, px, py, pz, qx, qy, qz, qw, vx, vy, vz, wx, wy, wz, active, pad.
   */
  getTransformBufferPtr(): number
  getTransformStride(): number
  getTransformSlotCount(): number

  /**
   * Optional legacy per-event callback.
   * Signature: (id1, id2, nx, ny, nz, px, py, pz, impulse, phase) => void
   * Production drain uses getContactBufferPtr() instead.
   */
  setContactCallbackJS(
    cb: (
      id1: number, id2: number,
      nx: number, ny: number, nz: number,
      px: number, py: number, pz: number,
      impulse: number,
      phase: number
    ) => void
  ): void

  /**
   * Versioned little-endian world snapshot (native/src/Snapshot.h): bodies,
   * handles, hinges, movers, fields, group masks, kinematic targets and the
   * contact manifold. A fresh copy — safe to keep across steps.
   * Optional: bundles before #422 do not export it.
   */
  serializeSnapshot?(): Uint8Array

  /** Restore a `serializeSnapshot()` blob; returns a `WasmSnapshotStatus` code. */
  restoreSnapshot?(bytes: Uint8Array): number

  /** FNV-1a 64 of the static table, 16 hex chars — equal iff snapshots are interchangeable. */
  getStaticContentHash?(): string

  /** Contact flushes so far (restored with the snapshot). */
  getContactGeneration?(): number

  /** Release the C++ object. Must be called when done to avoid WASM memory leaks. */
  delete(): void
}

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

/** The shape of the compiled Emscripten ES-module default export. */
export interface WasmPhysicsModuleFactory {
  (): Promise<WasmPhysicsModule>
}

/** Emscripten module instance returned by the factory. */
export interface WasmPhysicsModule {
  HEAPF32?: Float32Array
  HEAPU32?: Uint32Array
  wasmMemory?: { buffer: ArrayBuffer }
  /** Emscripten heap allocator — needed to hand triangle soup to the C++ side. */
  _malloc?: (bytes: number) => number
  _free?: (ptr: number) => void
  PhysicsWorld: new () => WasmPhysicsWorldInstance
  BodyType: {
    Dynamic:   { value: 0 }
    Static:    { value: 1 }
    Kinematic: { value: 2 }
  }
  Shape: {
    Sphere:  { value: 0 }
    Capsule: { value: 1 }
    Box:     { value: 2 }
  }
  VolumeShape: {
    Box:      { value: 0 }
    Cylinder: { value: 1 }
    Sphere:   { value: 2 }
  }
  ForceSpace: {
    World: { value: 0 }
    Local: { value: 1 }
  }
}
