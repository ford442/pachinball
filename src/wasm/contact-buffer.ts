/**
 * Shared physics contact record used by both Rapier and the WASM engine.
 *
 * Packed WASM layout (12 floats, 48 bytes, 16-byte aligned):
 *   id1, id2, nx, ny, nz, px, py, pz, impulse, phase, isSensor, subIndex
 *
 * `subIndex` is the lattice index (row * cols + col) of the pin a pin-field
 * contact touched (#421); 0 for every other collider.
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
  /** Pin-field contacts: lattice index of the pin touched. 0 (or absent) otherwise. */
  subIndex?: number
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
 * One physics step's contacts as the packed WASM buffer, delivered in a single
 * `'wasm:physics:contacts'` emit instead of one `'wasm:physics:contact'` per pair (#488 §5).
 *
 * `data` holds `count` records of `stride` floats from offset 0, laid out as the module header
 * describes. It is a view into WASM memory or a reused buffer, and the batch object itself is
 * reused by the emitter: both are valid only during the emit. Read with `contactPhaseAt` /
 * `decodeContactAt` (or index `data` directly) and copy anything you keep.
 */
export interface WasmContactBatch {
  readonly data: Float32Array
  readonly count: number
  readonly stride: number
}

/**
 * The slice of the game EventBus the WASM engines emit contacts on. Deliberately narrower than
 * `EventBus` (`../core/event-bus`): that file's payload types pull in Babylon-typed game types,
 * and this one is part of the Worker-lib compile graph (tsconfig.worker.json). Any real
 * `EventBus` satisfies it structurally.
 */
export interface WasmContactEventBus {
  emit(event: 'wasm:physics:contact', payload: WasmContactEvent): void
  emit(event: 'wasm:physics:contacts', payload: WasmContactBatch): void
  /**
   * Whether an event has handlers. Optional so minimal fakes still type-check; without it the
   * emitter assumes both contact events are wanted.
   */
  hasListeners?(event: 'wasm:physics:contact' | 'wasm:physics:contacts'): boolean
}

const EMPTY_CONTACTS = new Float32Array(0)

/**
 * Delivers one step's packed contacts on a bus: the legacy per-contact `'wasm:physics:contact'`
 * events (each a fresh record, as before) only while something still subscribes to them, then
 * one `'wasm:physics:contacts'` emit carrying the packed view, which allocates nothing.
 * Holds the reused batch object; one emitter per engine.
 */
export class ContactBatchEmitter {
  private readonly batch: { data: Float32Array; count: number; stride: number } = {
    data: EMPTY_CONTACTS,
    count: 0,
    stride: CONTACT_STRIDE,
  }

  emit(bus: WasmContactEventBus, data: Float32Array, count: number, stride = CONTACT_STRIDE): void {
    const n = Math.min(Math.max(0, count | 0), Math.floor(data.length / stride))
    if (n === 0) return
    // Per-contact consumers first, so a legacy subscriber sees each contact at the same point
    // in the step it always did.
    if (bus.hasListeners?.('wasm:physics:contact') ?? true) {
      for (let i = 0; i < n; i++) bus.emit('wasm:physics:contact', wasmContactEventAt(data, i, stride))
    }
    if (bus.hasListeners?.('wasm:physics:contacts') ?? true) {
      const batch = this.batch
      batch.data = data
      batch.count = n
      batch.stride = stride
      try {
        bus.emit('wasm:physics:contacts', batch)
      } finally {
        // Do not pin the WASM heap view (or a posted buffer) until the next step.
        batch.data = EMPTY_CONTACTS
        batch.count = 0
      }
    }
  }
}

/**
 * Phase of packed contact `index`. Any value other than Stay/Exit decodes as Enter, exactly as
 * `decodeContactBuffer` always has.
 */
export function contactPhaseAt(data: ArrayLike<number>, index: number, stride = CONTACT_STRIDE): ContactPhase {
  const raw = (data[index * stride + 9] ?? 0) as ContactPhase
  return raw === ContactPhase.Stay || raw === ContactPhase.Exit ? raw : ContactPhase.Enter
}

/** A zeroed record for `decodeContactAt` / `decodeContactBuffer(…, out)` to fill. */
export function createContactRecord(): PhysicsContact {
  return {
    bodyId1: 0,
    bodyId2: 0,
    normal: { x: 0, y: 0, z: 0 },
    point: { x: 0, y: 0, z: 0 },
    impulse: 0,
    phase: ContactPhase.Enter,
    isSensor: false,
    subIndex: 0,
  }
}

/**
 * Decode packed contact `index` into `out` (overwriting every field, the nested vectors in
 * place) and return `out`. Allocates nothing: reuse one record across a per-step loop.
 */
export function decodeContactAt(
  data: ArrayLike<number>,
  index: number,
  out: PhysicsContact,
  stride = CONTACT_STRIDE,
): PhysicsContact {
  const o = index * stride
  out.bodyId1 = data[o] ?? 0
  out.bodyId2 = data[o + 1] ?? 0
  out.normal.x = data[o + 2] ?? 0
  out.normal.y = data[o + 3] ?? 0
  out.normal.z = data[o + 4] ?? 0
  out.point.x = data[o + 5] ?? 0
  out.point.y = data[o + 6] ?? 0
  out.point.z = data[o + 7] ?? 0
  out.impulse = data[o + 8] ?? 0
  out.phase = contactPhaseAt(data, index, stride)
  out.isSensor = (data[o + 10] ?? 0) !== 0
  out.subIndex = data[o + 11] ?? 0
  return out
}

/** A fresh `WasmContactEvent` for packed contact `index` (the legacy per-contact payload). */
export function wasmContactEventAt(data: ArrayLike<number>, index: number, stride = CONTACT_STRIDE): WasmContactEvent {
  const o = index * stride
  const phase = contactPhaseAt(data, index, stride)
  const started = phase === ContactPhase.Enter
  return {
    bodyId1: data[o] ?? 0,
    bodyId2: data[o + 1] ?? 0,
    normal: { x: data[o + 2] ?? 0, y: data[o + 3] ?? 0, z: data[o + 4] ?? 0 },
    point: { x: data[o + 5] ?? 0, y: data[o + 6] ?? 0, z: data[o + 7] ?? 0 },
    impulse: data[o + 8] ?? 0,
    phase,
    isSensor: (data[o + 10] ?? 0) !== 0,
    subIndex: data[o + 11] ?? 0,
    started,
    isEntering: started,
  }
}

/**
 * Decode a packed WASM contact buffer into typed records.
 * `data` is a Float32Array view (or any array-like of floats) covering
 * `count * CONTACT_STRIDE` values.
 *
 * Without `out` every call returns a fresh array of fresh records (safe to keep). With `out`,
 * that array and the records already in it are reused — overwritten in place, new ones created
 * only when `count` exceeds what `out` held, `out.length` set to `count` — so a per-frame caller
 * passing the same array allocates nothing in steady state. The records are then only valid
 * until the next call with that `out`.
 */
export function decodeContactBuffer(
  data: ArrayLike<number>,
  count: number,
  stride = CONTACT_STRIDE,
  out?: PhysicsContact[],
): PhysicsContact[] {
  const n = Math.max(0, count | 0)
  if (!out) {
    const fresh: PhysicsContact[] = []
    for (let i = 0; i < n; i++) fresh.push(decodeContactAt(data, i, createContactRecord(), stride))
    return fresh
  }
  for (let i = 0; i < n; i++) {
    out[i] = decodeContactAt(data, i, out[i] ?? createContactRecord(), stride)
  }
  out.length = n
  return out
}

/** Encode contacts into a packed float buffer (test helper / round-trip). */
export function encodeContactBuffer(contacts: PhysicsContact[]): Float32Array {
  const buf = new Float32Array(contacts.length * CONTACT_STRIDE)
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i]! // i < contacts.length
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
    buf[o + 11] = c.subIndex ?? 0
  }
  return buf
}
