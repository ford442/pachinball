/**
 * Shared physics contact record used by both Rapier and the WASM engine.
 *
 * Packed WASM layout (12 floats, 48 bytes, 16-byte aligned):
 *   id1, id2, nx, ny, nz, px, py, pz, impulse, phase, isSensor, _pad
 */

export enum ContactPhase {
  Enter = 0,
  Stay = 1,
  Exit = 2,
}

/** Floats per packed contact. */
export const CONTACT_STRIDE = 12

/**
 * One contact pair for a single physics step.
 * Rapier begin/end maps to Enter/Exit (`started` ≡ phase === Enter).
 * WASM also emits Stay (peak impulse, one event per pair per step).
 */
export interface PhysicsContact {
  bodyId1: number
  bodyId2: number
  /** Contact normal, pointing from body2 to body1. */
  normal: { x: number; y: number; z: number }
  /** World-space contact point. */
  point: { x: number; y: number; z: number }
  /** Peak impulse magnitude applied at the contact this step. */
  impulse: number
  phase: ContactPhase
  /** True for a sensor-volume overlap: zero impulse, no positional correction. */
  isSensor: boolean
}

/** WASM EventBus payload — same record plus the Rapier-shaped `started` flag. */
export interface WasmContactEvent extends PhysicsContact {
  /** true iff phase === Enter. Matches Rapier's drainCollisionEvents `started`. */
  started: boolean
  /** @deprecated Prefer `started` / `phase`. true iff phase === Enter. */
  isEntering: boolean
}

export function contactStarted(contact: PhysicsContact): boolean {
  return contact.phase === ContactPhase.Enter
}

export function toWasmContactEvent(contact: PhysicsContact): WasmContactEvent {
  const started = contact.phase === ContactPhase.Enter
  return { ...contact, started, isEntering: started }
}

/**
 * Decode a packed WASM contact buffer into typed records.
 * `data` is a Float32Array view (or any array-like of floats) covering
 * `count * CONTACT_STRIDE` values.
 */
export function decodeContactBuffer(
  data: ArrayLike<number>,
  count: number,
  stride = CONTACT_STRIDE,
): PhysicsContact[] {
  const out: PhysicsContact[] = []
  const n = Math.max(0, count | 0)
  for (let i = 0; i < n; i++) {
    const o = i * stride
    const phaseRaw = data[o + 9] ?? 0
    const phase = (phaseRaw === ContactPhase.Stay || phaseRaw === ContactPhase.Exit)
      ? phaseRaw
      : ContactPhase.Enter
    out.push({
      bodyId1: data[o] ?? 0,
      bodyId2: data[o + 1] ?? 0,
      normal: { x: data[o + 2] ?? 0, y: data[o + 3] ?? 0, z: data[o + 4] ?? 0 },
      point:  { x: data[o + 5] ?? 0, y: data[o + 6] ?? 0, z: data[o + 7] ?? 0 },
      impulse: data[o + 8] ?? 0,
      phase,
      isSensor: (data[o + 10] ?? 0) !== 0,
    })
  }
  return out
}

/** Encode contacts into a packed float buffer (test helper / round-trip). */
export function encodeContactBuffer(contacts: PhysicsContact[]): Float32Array {
  const buf = new Float32Array(contacts.length * CONTACT_STRIDE)
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i]
    const o = i * CONTACT_STRIDE
    buf[o] = c.bodyId1
    buf[o + 1] = c.bodyId2
    buf[o + 2] = c.normal.x
    buf[o + 3] = c.normal.y
    buf[o + 4] = c.normal.z
    buf[o + 5] = c.point.x
    buf[o + 6] = c.point.y
    buf[o + 7] = c.point.z
    buf[o + 8] = c.impulse
    buf[o + 9] = c.phase
    buf[o + 10] = c.isSensor ? 1 : 0
    buf[o + 11] = 0
  }
  return buf
}
