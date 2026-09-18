import { describe, expect, it } from 'vitest'
import {
  createSharedSnapshotBuffer,
  DEFAULT_SHARED_CAPACITIES,
  grownCapacities,
  SHARED_LAYOUT_VERSION,
  SHARED_MAX_BYTES,
  SharedHeader,
  SharedSnapshotReader,
  SharedSnapshotWriter,
  sharedByteLength,
} from '../src/wasm/physics-shared-layout'
import { CONTACT_STRIDE, ContactPhase, decodeContactBuffer, encodeContactBuffer } from '../src/wasm/contact-buffer'
import { decodeTransformSlot, encodeTransformBuffer, TRANSFORM_STRIDE } from '../src/wasm/transform-buffer'
import { decodeHingeAngle } from '../src/wasm/physics-worker-protocol'

const caps = { transformSlots: 4, hinges: 2, contacts: 3 }

function transformsFor(px: number) {
  return encodeTransformBuffer([{
    id: 1,
    transform: {
      id: 1,
      position: { x: px, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      active: true,
    },
  }])
}

function contact(bodyId1: number) {
  return encodeContactBuffer([{
    bodyId1,
    bodyId2: -1000,
    normal: { x: 0, y: 1, z: 0 },
    point: { x: 0, y: 0, z: 0 },
    impulse: 1,
    phase: ContactPhase.Enter,
    isSensor: false,
  }])
}

function drainIds(reader: SharedSnapshotReader): number[] {
  const ids: number[] = []
  reader.drainContacts((packed, count) => {
    for (const c of decodeContactBuffer(packed, count)) ids.push(c.bodyId1)
  })
  return ids
}

describe('shared snapshot layout', () => {
  it('sizes the buffer from its capacities, 4-byte aligned', () => {
    const buffer = createSharedSnapshotBuffer(caps)
    expect(buffer.byteLength).toBe(sharedByteLength(caps))
    expect(buffer.byteLength % 4).toBe(0)
  })

  it('reads nothing until the first publish, then each publish exactly once', () => {
    const writer = new SharedSnapshotWriter(createSharedSnapshotBuffer(caps))
    const reader = new SharedSnapshotReader(writer.buffer)
    expect(reader.read()).toBe(false)

    writer.publish(0.5, 7, 1.5, transformsFor(3), [0], () => 0.25)
    expect(reader.read()).toBe(true)
    expect(reader.read()).toBe(false)
    expect(reader.alpha).toBe(0.5)
    expect(reader.stepCount).toBe(7)
    expect(reader.stepMs).toBe(1.5)
    expect(decodeTransformSlot(reader.transforms!, 1)?.position.x).toBe(3)
    expect(decodeHingeAngle(reader.hinges!, 0)).toBe(0.25)
    expect(reader.getPublishCount()).toBe(1)
  })

  it('a reader constructed after a publish still sees it', () => {
    const writer = new SharedSnapshotWriter(createSharedSnapshotBuffer(caps))
    writer.publish(0, 1, 0, transformsFor(9), [], () => 0)
    const reader = new SharedSnapshotReader(writer.buffer)
    expect(reader.read()).toBe(true)
    expect(decodeTransformSlot(reader.transforms!, 1)?.position.x).toBe(9)
  })

  it('keeps the previous snapshot while a publish is in progress (odd SEQ)', () => {
    const writer = new SharedSnapshotWriter(createSharedSnapshotBuffer(caps))
    const reader = new SharedSnapshotReader(writer.buffer)
    writer.publish(0, 1, 0, transformsFor(1), [], () => 0)
    reader.read()
    const kept = reader.transforms

    const i32 = new Int32Array(writer.buffer)
    Atomics.add(i32, SharedHeader.SEQ, 1) // writer "mid-publish"
    new Float32Array(writer.buffer).fill(99, 20, 20 + TRANSFORM_STRIDE * 2)
    expect(reader.read()).toBe(false)
    expect(reader.transforms).toBe(kept)
    expect(decodeTransformSlot(reader.transforms!, 1)?.position.x).toBe(1)
  })

  it('does not overwrite the held snapshot with a torn copy', () => {
    const writer = new SharedSnapshotWriter(createSharedSnapshotBuffer(caps))
    const reader = new SharedSnapshotReader(writer.buffer)
    writer.publish(0, 1, 0, transformsFor(1), [], () => 0)
    reader.read()
    writer.publish(0, 2, 0, transformsFor(2), [], () => 0)
    // Every time the reader samples SEQ, a new publish lands mid-copy.
    const i32 = new Int32Array(writer.buffer)
    const realLoad = Atomics.load
    let calls = 0
    Atomics.load = ((arr: Int32Array, index: number) => {
      const v = realLoad(arr, index)
      if (arr.buffer === i32.buffer && index === SharedHeader.SEQ && calls++ % 2 === 1) return v + 2
      return v
    }) as typeof Atomics.load
    try {
      expect(reader.read()).toBe(false)
    } finally {
      Atomics.load = realLoad
    }
    expect(decodeTransformSlot(reader.transforms!, 1)?.position.x).toBe(1)
    expect(reader.read()).toBe(true)
    expect(decodeTransformSlot(reader.transforms!, 1)?.position.x).toBe(2)
  })

  it('does not allocate staging buffers on a steady-state read', () => {
    const writer = new SharedSnapshotWriter(createSharedSnapshotBuffer(caps))
    const reader = new SharedSnapshotReader(writer.buffer)
    writer.publish(0, 1, 0, transformsFor(1), [], () => 0)
    reader.read()
    writer.publish(0, 2, 0, transformsFor(2), [], () => 0)
    reader.read()
    const backing = new Set([reader.transforms!.buffer])
    for (let i = 3; i < 10; i++) {
      writer.publish(0, i, 0, transformsFor(i), [], () => 0)
      reader.read()
      backing.add(reader.transforms!.buffer)
    }
    // Two buffers ping-pong between staging and store.
    expect(backing.size).toBe(2)
  })

  it('delivers contacts in order across the ring wrap, and refuses what does not fit', () => {
    const writer = new SharedSnapshotWriter(createSharedSnapshotBuffer(caps))
    const reader = new SharedSnapshotReader(writer.buffer)

    expect(writer.contactSpace()).toBe(3)
    expect(writer.pushContacts(contact(1), 1)).toBe(true)
    expect(writer.pushContacts(contact(2), 1)).toBe(true)
    expect(drainIds(reader)).toEqual([1, 2])

    // Head is now at slot 2 of 4: the next three wrap.
    const three = new Float32Array(3 * CONTACT_STRIDE)
    three.set(contact(3), 0)
    three.set(contact(4), CONTACT_STRIDE)
    three.set(contact(5), 2 * CONTACT_STRIDE)
    expect(writer.pushContacts(three, 3)).toBe(true)
    expect(writer.contactSpace()).toBe(0)
    expect(writer.pushContacts(contact(6), 1)).toBe(false)
    expect(drainIds(reader)).toEqual([3, 4, 5])
    expect(drainIds(reader)).toEqual([])
  })

  it('rejects a buffer from another layout version', () => {
    const buffer = createSharedSnapshotBuffer(caps)
    new Int32Array(buffer)[SharedHeader.VERSION] = SHARED_LAYOUT_VERSION + 1
    expect(() => new SharedSnapshotReader(buffer)).toThrow(/layout v/)
    new Int32Array(buffer)[SharedHeader.MAGIC] = 0
    expect(() => new SharedSnapshotReader(buffer)).toThrow(/magic/)
  })

  it('grows geometrically past the need, and gives up past the byte cap', () => {
    expect(grownCapacities(null, { transformSlots: 1, hinges: 0, contacts: 0 })).toEqual(DEFAULT_SHARED_CAPACITIES)
    const grown = grownCapacities(DEFAULT_SHARED_CAPACITIES, { transformSlots: 300, hinges: 2, contacts: 0 })
    expect(grown?.transformSlots).toBe(600)
    expect(grown?.hinges).toBe(DEFAULT_SHARED_CAPACITIES.hinges)
    expect(grownCapacities(null, { transformSlots: SHARED_MAX_BYTES, hinges: 0, contacts: 0 })).toBeNull()
  })
})
