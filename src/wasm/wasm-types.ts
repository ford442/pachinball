/**
 * TypeScript type definitions for the Emscripten-compiled Pachinball physics
 * WASM module (native/src → native/build/PhysicsModule.js + .wasm).
 *
 * The world's method surface is the Emscripten-generated declaration
 * (generated/PhysicsModule.d.ts) plus a short overlay; the constants below
 * mirror sentinels embind cannot express.
 */

import type { PhysicsWorld as GeneratedWorld } from './generated/PhysicsModule'

/**
 * Mirrors native `STATIC_HANDLE_OVERFLOW` in StaticShapes.h. Every `add*`
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
export const WASM_SNAPSHOT_VERSION = 2

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
  Box     = 2,
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
  type WasmContactBatch,
  type WasmContactEvent,
} from './contact-buffer'

// ---------------------------------------------------------------------------
// Raw WASM module interface (Embind class bindings)
// ---------------------------------------------------------------------------

/**
 * Embind's per-handle plumbing on every bound class. Only `delete()` is used
 * (to free the world), so the rest is dropped from the public surface.
 */
type HandlePlumbing = 'isAliasOf' | 'deleteLater' | 'isDeleted' | 'clone'

/**
 * Bindings a shipped bundle may lack (they post-date it): callers reach them
 * through `?.()`. Their signatures still come from the generated declarations.
 */
export type LegacyOptionalBinding =
  | 'setBodyType' | 'getBodyType'
  | 'addStaticCone' | 'addPinField' | 'getPinFieldPinCount' | 'addAxisPullField'
  | 'getNaNQuarantineCount' | 'getNaNQuarantineBodyId'

/**
 * What embind's generated declarations cannot say. Every key here must be a
 * method bound in bindings.cpp with the same arity (wasm-types-conformance.ts
 * checks); only the parameter / return types are refined.
 */
export interface WasmPhysicsWorldOverlay {
  /** Static restitution / friction default on the JS side of older callers. */
  addStaticBox(
    px: number, py: number, pz: number,
    hx: number, hy: number, hz: number,
    qx: number, qy: number, qz: number, qw: number,
    restitution?: number, friction?: number
  ): number
  addStaticCapsule(
    px: number, py: number, pz: number,
    radius: number, halfHeight: number,
    qx: number, qy: number, qz: number, qw: number,
    restitution?: number, friction?: number
  ): number
  addStaticCylinder(
    px: number, py: number, pz: number,
    radius: number, halfHeight: number,
    qx: number, qy: number, qz: number, qw: number,
    restitution?: number, friction?: number
  ): number
  addStaticSphere(
    px: number, py: number, pz: number,
    radius: number,
    restitution?: number, friction?: number
  ): number

  /** The generated `RigidBodyDesc` wants enum value objects; the binding reads plain ints too. */
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

  /** uint64_t: a `bigint` from a `-sWASM_BIGINT` bundle, a number from older ones. */
  getStepCount(): bigint | number

  /** Legacy per-event callback `(id1, id2, nx, ny, nz, px, py, pz, impulse, phase)`; production drains the contact buffer. */
  setContactCallbackJS(
    cb: (
      id1: number, id2: number,
      nx: number, ny: number, nz: number,
      px: number, py: number, pz: number,
      impulse: number,
      phase: number
    ) => void
  ): void

  /** Versioned LE world snapshot (Snapshot.h), a fresh copy. Absent before #422. */
  serializeSnapshot?(): Uint8Array
  /** Returns a `WasmSnapshotStatus` code. Absent before #422. */
  restoreSnapshot?(bytes: Uint8Array): number
  /** FNV-1a 64 of the static table: `bigint`, or 16 hex chars from pre-BIGINT bundles. */
  getStaticContentHash?(): bigint | string
  /** FNV-1a 64 of the stepped world; as above. Absent before #459. */
  getStateHash?(): bigint | string
  /** Contact flushes so far; `bigint` from a `-sWASM_BIGINT` bundle. */
  getContactGeneration?(): bigint | number
}

/**
 * The generated methods by name. `[Symbol.dispose]` sits behind a `@ts-ignore`
 * in the generated file and reads as a string index signature without the
 * esnext.disposable lib; the remap drops it (and every other non-literal key).
 */
type GeneratedMethods = {
  [K in keyof GeneratedWorld as K extends string ? (string extends K ? never : K extends HandlePlumbing ? never : K) : never]: GeneratedWorld[K]
}

/**
 * The compiled Embind `PhysicsWorld`: the declarations `emcc --emit-tsd`
 * generates from bindings.cpp (generated/PhysicsModule.d.ts), with
 * `WasmPhysicsWorldOverlay` refinements and the legacy-optional bindings.
 * A method added in bindings.cpp appears here with no edit.
 */
export type WasmPhysicsWorldInstance =
  Omit<GeneratedMethods, keyof WasmPhysicsWorldOverlay | LegacyOptionalBinding>
  & Partial<Pick<GeneratedMethods, LegacyOptionalBinding>>
  & WasmPhysicsWorldOverlay

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
