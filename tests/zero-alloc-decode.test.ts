/**
 * Reusable decode records and the batched contact event (#488 §5, zero-allocation hot path).
 *
 * - `decodeContactBuffer(…, out)` / `decodeContactAt` / `decodeTransformSlot(…, out)` write into
 *   caller-owned records and must decode exactly what the allocating forms decode.
 * - `ContactBatchEmitter` delivers one `'wasm:physics:contacts'` emit per drain with a reused
 *   batch object, and builds per-contact payloads only while something subscribes to them.
 */
import { describe, expect, it, vi } from 'vitest'
import { EventBus } from '../src/core/event-bus'
import {
  CONTACT_STRIDE,
  ContactBatchEmitter,
  ContactPhase,
  contactPhaseAt,
  createContactRecord,
  decodeContactAt,
  decodeContactBuffer,
  encodeContactBuffer,
  toWasmContactEvent,
  wasmContactEventAt,
  type PhysicsContact,
  type WasmContactBatch,
  type WasmContactEvent,
} from '../src/wasm/contact-buffer'
import {
  createTransformRecord,
  decodeTransformSlot,
  encodeTransformBuffer,
  type WasmTransform,
} from '../src/wasm/transform-buffer'

function contact(id1: number, id2: number, phase: ContactPhase, extra: Partial<PhysicsContact> = {}): PhysicsContact {
  return {
    bodyId1: id1,
    bodyId2: id2,
    normal: { x: 0, y: 1, z: 0 },
    point: { x: id1 * 0.5, y: 0.25, z: id2 * 0.5 },
    impulse: id1 + id2,
    phase,
    isSensor: false,
    subIndex: 0,
    ...extra,
  }
}

const SAMPLE: PhysicsContact[] = [
  contact(1, 2, ContactPhase.Enter),
  contact(3, -8000, ContactPhase.Stay, { isSensor: true, subIndex: 17 }),
  contact(0, -4001, ContactPhase.Exit),
]

describe('contact decode records', () => {
  it('decodeContactBuffer(…, out) decodes exactly what the allocating form does', () => {
    const packed = encodeContactBuffer(SAMPLE)
    const out: PhysicsContact[] = []
    expect(decodeContactBuffer(packed, SAMPLE.length, CONTACT_STRIDE, out)).toBe(out)
    expect(out).toEqual(decodeContactBuffer(packed, SAMPLE.length))
    expect(out).toEqual(SAMPLE)
  })

  it('reuses the array and its records across calls, growing and shrinking to count', () => {
    const out: PhysicsContact[] = []
    decodeContactBuffer(encodeContactBuffer(SAMPLE), 3, CONTACT_STRIDE, out)
    const [r0, r1, r2] = out
    const normal0 = r0?.normal

    const next = [contact(9, 8, ContactPhase.Stay), contact(7, 6, ContactPhase.Enter)]
    decodeContactBuffer(encodeContactBuffer(next), 2, CONTACT_STRIDE, out)
    expect(out.length).toBe(2)
    expect(out[0]).toBe(r0)
    expect(out[1]).toBe(r1)
    expect(out[0]?.normal).toBe(normal0) // nested vectors overwritten in place
    expect(out).toEqual(next)

    decodeContactBuffer(encodeContactBuffer(SAMPLE), 3, CONTACT_STRIDE, out)
    expect(out[0]).toBe(r0)
    expect(out[1]).toBe(r1)
    expect(out[2]).not.toBe(r2) // dropped at length 2, so a fresh record fills slot 2
    expect(out).toEqual(SAMPLE)
  })

  it('the allocating form still returns fresh records every call', () => {
    const packed = encodeContactBuffer(SAMPLE)
    const a = decodeContactBuffer(packed, 3)
    const b = decodeContactBuffer(packed, 3)
    expect(a).not.toBe(b)
    expect(a[0]).not.toBe(b[0])
    expect(a[0]?.normal).not.toBe(b[0]?.normal)
  })

  it('decodeContactAt overwrites every field of one record', () => {
    const packed = encodeContactBuffer(SAMPLE)
    const record = createContactRecord()
    for (let i = 0; i < SAMPLE.length; i++) {
      expect(decodeContactAt(packed, i, record)).toBe(record)
      expect(record).toEqual(SAMPLE[i])
    }
  })

  it('contactPhaseAt maps unknown phase values to Enter, like the decoder', () => {
    const packed = encodeContactBuffer([contact(1, 2, ContactPhase.Enter)])
    packed[9] = 7
    expect(contactPhaseAt(packed, 0)).toBe(ContactPhase.Enter)
    expect(decodeContactBuffer(packed, 1)[0]?.phase).toBe(ContactPhase.Enter)
    packed[9] = ContactPhase.Exit
    expect(contactPhaseAt(packed, 0)).toBe(ContactPhase.Exit)
  })

  it('wasmContactEventAt builds the same payload toWasmContactEvent always did', () => {
    const packed = encodeContactBuffer(SAMPLE)
    for (let i = 0; i < SAMPLE.length; i++) {
      const decoded = decodeContactBuffer(packed, SAMPLE.length)[i]!
      expect(wasmContactEventAt(packed, i)).toEqual(toWasmContactEvent(decoded))
    }
  })
})

describe('transform decode record', () => {
  const t = (id: number, x: number, active = true): WasmTransform => ({
    id,
    position: { x, y: x + 1, z: x + 2 },
    rotation: { x: 0, y: 0, z: 0.5, w: 0.75 },
    velocity: { x: -x, y: 0, z: 1 },
    angularVelocity: { x: 0, y: x, z: 0 },
    active,
  })

  it('decodeTransformSlot(…, out) fills and returns the caller record', () => {
    const buf = encodeTransformBuffer([{ id: 1, transform: t(1, 3) }, { id: 2, transform: t(2, 5, false) }])
    const out = createTransformRecord()
    const position = out.position
    expect(decodeTransformSlot(buf, 1, undefined, out)).toBe(out)
    expect(out).toEqual(decodeTransformSlot(buf, 1))
    expect(out).toEqual(t(1, 3))
    expect(decodeTransformSlot(buf, 2, undefined, out)).toBe(out)
    expect(out.position).toBe(position)
    expect(out).toEqual(t(2, 5, false))
  })

  it('a missing or stale slot returns null and leaves the record untouched', () => {
    const buf = encodeTransformBuffer([{ id: 2, transform: t(2, 5) }])
    const out = createTransformRecord()
    decodeTransformSlot(buf, 2, undefined, out)
    const before = structuredClone(out)
    expect(decodeTransformSlot(buf, 1, undefined, out)).toBeNull()
    expect(decodeTransformSlot(buf, 99, undefined, out)).toBeNull()
    expect(out).toEqual(before)
  })
})

describe('ContactBatchEmitter / wasm:physics:contacts', () => {
  it('emits one batch per drain, reusing the batch object, and no per-contact payloads when unsubscribed', () => {
    const bus = new EventBus()
    const emitter = new ContactBatchEmitter()
    const seen: Array<{ batch: WasmContactBatch; count: number; stride: number; ids: number[] }> = []
    bus.on('wasm:physics:contacts', (batch) => {
      const ids: number[] = []
      for (let i = 0; i < batch.count; i++) ids.push(batch.data[i * batch.stride] ?? -1)
      seen.push({ batch, count: batch.count, stride: batch.stride, ids })
    })
    const emit = vi.spyOn(bus, 'emit')

    emitter.emit(bus, encodeContactBuffer(SAMPLE), SAMPLE.length)
    emitter.emit(bus, encodeContactBuffer(SAMPLE.slice(0, 1)), 1)
    emitter.emit(bus, new Float32Array(0), 0) // empty drain: no emit

    expect(seen.map(({ count, stride, ids }) => ({ count, stride, ids }))).toEqual([
      { count: 3, stride: CONTACT_STRIDE, ids: [1, 3, 0] },
      { count: 1, stride: CONTACT_STRIDE, ids: [1] },
    ])
    expect(seen[1]?.batch).toBe(seen[0]?.batch)
    // After the emit the batch no longer exposes (or pins) the buffer.
    expect(seen[0]?.batch.count).toBe(0)
    expect(seen[0]?.batch.data.length).toBe(0)
    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit.mock.calls.every(([event]) => event === 'wasm:physics:contacts')).toBe(true)
  })

  it('never reads past the buffer when count overstates it', () => {
    const bus = new EventBus()
    const counts: number[] = []
    bus.on('wasm:physics:contacts', (b) => counts.push(b.count))
    new ContactBatchEmitter().emit(bus, encodeContactBuffer(SAMPLE), 10)
    expect(counts).toEqual([3])
  })

  it('still delivers per-contact events, in order and before the batch, while subscribed', () => {
    const bus = new EventBus()
    const log: string[] = []
    const kept: WasmContactEvent[] = []
    bus.on('wasm:physics:contact', (e) => {
      kept.push(e)
      log.push(`contact ${e.bodyId1}`)
    })
    bus.on('wasm:physics:contacts', (b) => log.push(`batch ${b.count}`))
    const emitter = new ContactBatchEmitter()
    emitter.emit(bus, encodeContactBuffer(SAMPLE), 3)
    emitter.emit(bus, encodeContactBuffer(SAMPLE), 3)

    expect(log).toEqual(['contact 1', 'contact 3', 'contact 0', 'batch 3', 'contact 1', 'contact 3', 'contact 0', 'batch 3'])
    // Per-contact payloads are fresh, so a subscriber may keep them.
    expect(kept[0]).not.toBe(kept[3])
    expect(kept[0]).toEqual(toWasmContactEvent(SAMPLE[0]!))
    expect(kept[1]).toMatchObject({ started: false, isEntering: false, isSensor: true, subIndex: 17 })
  })

  it('emits both forms on a minimal bus without hasListeners', () => {
    const events: string[] = []
    const bus = {
      emit: (event: string) => {
        events.push(event)
      },
    }
    new ContactBatchEmitter().emit(bus, encodeContactBuffer(SAMPLE.slice(0, 2)), 2)
    expect(events).toEqual(['wasm:physics:contact', 'wasm:physics:contact', 'wasm:physics:contacts'])
  })
})
