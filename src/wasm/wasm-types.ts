/**
 * TypeScript type definitions for the Emscripten-compiled Pachinball physics
 * WASM module (native/src → native/build/PhysicsModule.js + .wasm).
 *
 * These types match the Embind bindings declared in native/src/bindings.cpp.
 * They are intentionally narrow — only the surface area actually exposed to JS.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Mirrors the C++ BodyType enum. */
export const enum BodyType {
  Dynamic   = 0,
  Static    = 1,
  Kinematic = 2,
}

// ---------------------------------------------------------------------------
// Contact event
// ---------------------------------------------------------------------------

/**
 * A contact event fired for each collision pair each physics step.
 * bodyId2 === -1 means the second body is a static plane.
 */
export interface WasmContactEvent {
  bodyId1: number
  bodyId2: number
  /** Contact normal, pointing from body2 to body1. */
  normal: { x: number; y: number; z: number }
  /** World-space contact point. */
  point: { x: number; y: number; z: number }
  /** Impulse magnitude applied at the contact. */
  impulse: number
  /** true = contact began, false = contact ended (currently always true for entering). */
  isEntering: boolean
}

// ---------------------------------------------------------------------------
// Raw WASM module interface (Embind class bindings)
// ---------------------------------------------------------------------------

/** The compiled Embind class proxy for PhysicsWorld. */
export interface WasmPhysicsWorldInstance {
  /** Create a dynamic sphere body; returns a stable integer handle. */
  createRigidBody(
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    mass: number, radius: number, restitution: number, linearDamping: number,
    bodyType: number
  ): number

  /** Remove a body by handle. The handle is no longer valid after this. */
  removeRigidBody(id: number): void

  /** Accumulate a world-space force on a dynamic body. */
  applyForce(id: number, fx: number, fy: number, fz: number): void

  /** Apply an instantaneous world-space impulse. */
  applyImpulse(id: number, ix: number, iy: number, iz: number): void

  /** Directly set the velocity of a body. */
  setVelocity(id: number, vx: number, vy: number, vz: number): void

  /** Directly set the position of a body. */
  setBodyPosition(id: number, px: number, py: number, pz: number): void

  /** Directly set the rotation of a body. */
  setBodyRotation(id: number, qx: number, qy: number, qz: number, qw: number): void

  /** Add an infinite static plane defined by a normal + d offset. */
  addStaticPlane(nx: number, ny: number, nz: number, distance: number): void

  // Position getters
  getPosX(id: number): number
  getPosY(id: number): number
  getPosZ(id: number): number

  // Velocity getters
  getVelX(id: number): number
  getVelY(id: number): number
  getVelZ(id: number): number

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

  /**
   * Register a JS function to receive contact events.
   * Signature: (id1, id2, nx, ny, nz, px, py, pz, impulse, isEntering) => void
   */
  setContactCallbackJS(
    cb: (
      id1: number, id2: number,
      nx: number, ny: number, nz: number,
      px: number, py: number, pz: number,
      impulse: number,
      isEntering: boolean
    ) => void
  ): void

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
  PhysicsWorld: new () => WasmPhysicsWorldInstance
  BodyType: {
    Dynamic:   { value: 0 }
    Static:    { value: 1 }
    Kinematic: { value: 2 }
  }
}
