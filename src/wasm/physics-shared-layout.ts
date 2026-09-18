/**
 * SharedArrayBuffer snapshot layout for `wasm-worker` (#414).
 *
 * The worker is the only writer and the main thread the only reader. Nothing
 * here blocks: the reader never calls `Atomics.wait`, and a read that races a
 * publish keeps the previous snapshot for one more frame instead of spinning.
 *
 *   ┌──────────────────────── header: Int32 words 0..15 ───────────────────────┐
 *   │ MAGIC  VERSION  SEQ  STEP_COUNT  TRANSFORM_FLOATS  HINGE_COUNT           │
 *   │ CONTACT_HEAD  CONTACT_TAIL  TRANSFORM_CAPACITY  HINGE_CAPACITY           │
 *   │ CONTACT_CAPACITY  PUBLISH_COUNT  reserved…                               │
 *   ├──────────────── scalars: Float32 words 16..19 (alpha, stepMs, pad) ──────┤
 *   ├──────────────── transforms: TRANSFORM_CAPACITY floats (stride 16) ───────┤
 *   ├──────────────── hinges: HINGE_CAPACITY × HINGE_ANGLE_STRIDE floats ──────┤
 *   └──────────────── contacts: CONTACT_CAPACITY × CONTACT_STRIDE floats ──────┘
 *
 * Transforms, hinges and the scalars are latest-wins, guarded by a seqlock:
 * the writer makes SEQ odd, writes, then makes it even; the reader copies into
 * its own staging buffers and keeps the copy only if SEQ was even and
 * unchanged across it.
 *
 * Contacts are not latest-wins — a dropped Enter is a missed score — so they
 * travel through a single-producer / single-consumer ring: the worker only
 * advances CONTACT_TAIL, the main thread only advances CONTACT_HEAD. One slot
 * stays empty to tell full from empty.
 *
 * Capacities are fixed per buffer. When a step outgrows one the worker
 * allocates a larger buffer and posts `shared-attach`; see
 * `WorkerSnapshotPublisher` in physics-worker-runtime.ts.
 */

import { CONTACT_STRIDE } from './contact-buffer'
import { TRANSFORM_STRIDE } from './transform-buffer'

/** ASCII "PBSL" (little-endian). */
export const SHARED_LAYOUT_MAGIC = 0x4c534250
/** Bump whenever a header word or region moves. */
export const SHARED_LAYOUT_VERSION = 1

/** Floats per hinge entry: id, angle. Mirrors `HINGE_ANGLE_STRIDE` in the protocol. */
const HINGE_STRIDE = 2

export const SharedHeader = {
  MAGIC: 0,
  VERSION: 1,
  SEQ: 2,
  STEP_COUNT: 3,
  TRANSFORM_FLOATS: 4,
  HINGE_COUNT: 5,
  CONTACT_HEAD: 6,
  CONTACT_TAIL: 7,
  TRANSFORM_CAPACITY: 8,
  HINGE_CAPACITY: 9,
  CONTACT_CAPACITY: 10,
  PUBLISH_COUNT: 11,
} as const

const HEADER_WORDS = 16
const SCALAR_ALPHA = HEADER_WORDS
const SCALAR_STEP_MS = HEADER_WORDS + 1
/** First Float32 word of the transform region. */
const DATA_START = HEADER_WORDS + 4

/** Upper bound on growth; a step past this falls back to `step-result`. */
export const SHARED_MAX_BYTES = 64 * 1024 * 1024

export interface SharedCapacities {
  /** Transform body slots (× TRANSFORM_STRIDE floats). */
  transformSlots: number
  hinges: number
  /** Usable contact records; the ring allocates one more. */
  contacts: number
}

export const DEFAULT_SHARED_CAPACITIES: SharedCapacities = {
  transformSlots: 256,
  hinges: 16,
  contacts: 1024,
}

function regionOffsets(i32: Int32Array) {
  const transformCap = i32[SharedHeader.TRANSFORM_CAPACITY]
  const hingeCap = i32[SharedHeader.HINGE_CAPACITY]
  const hingeStart = DATA_START + transformCap
  const contactStart = hingeStart + hingeCap * HINGE_STRIDE
  return { transformCap, hingeCap, hingeStart, contactStart, ringSlots: i32[SharedHeader.CONTACT_CAPACITY] + 1 }
}

export function sharedByteLength(caps: SharedCapacities): number {
  const words = DATA_START
    + caps.transformSlots * TRANSFORM_STRIDE
    + caps.hinges * HINGE_STRIDE
    + (caps.contacts + 1) * CONTACT_STRIDE
  return words * 4
}

/** True when this realm can construct a SharedArrayBuffer it may share. */
export function canUseSharedMemory(): boolean {
  return typeof SharedArrayBuffer === 'function'
    && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
}

export function createSharedSnapshotBuffer(caps: SharedCapacities): SharedArrayBuffer {
  const buffer = new SharedArrayBuffer(sharedByteLength(caps))
  const i32 = new Int32Array(buffer)
  i32[SharedHeader.MAGIC] = SHARED_LAYOUT_MAGIC
  i32[SharedHeader.VERSION] = SHARED_LAYOUT_VERSION
  i32[SharedHeader.TRANSFORM_CAPACITY] = caps.transformSlots * TRANSFORM_STRIDE
  i32[SharedHeader.HINGE_CAPACITY] = caps.hinges
  i32[SharedHeader.CONTACT_CAPACITY] = caps.contacts
  return buffer
}

/**
 * Capacities that fit `need`, doubling past it so a slowly growing body count
 * (ids are never reused) re-attaches O(log n) times. Null past SHARED_MAX_BYTES.
 */
export function grownCapacities(current: SharedCapacities | null, need: SharedCapacities): SharedCapacities | null {
  const base = current ?? DEFAULT_SHARED_CAPACITIES
  const grow = (have: number, want: number) => (want <= have ? have : Math.max(have * 2, want * 2))
  const caps = {
    transformSlots: grow(base.transformSlots, need.transformSlots),
    hinges: grow(base.hinges, need.hinges),
    contacts: grow(base.contacts, need.contacts),
  }
  return sharedByteLength(caps) <= SHARED_MAX_BYTES ? caps : null
}

/** Worker side. Single writer. */
export class SharedSnapshotWriter {
  readonly buffer: SharedArrayBuffer
  readonly capacities: SharedCapacities
  private readonly i32: Int32Array
  private readonly f32: Float32Array

  constructor(buffer: SharedArrayBuffer) {
    this.buffer = buffer
    this.i32 = new Int32Array(buffer)
    this.f32 = new Float32Array(buffer)
    const { transformCap, hingeCap } = regionOffsets(this.i32)
    this.capacities = {
      transformSlots: transformCap / TRANSFORM_STRIDE,
      hinges: hingeCap,
      contacts: this.i32[SharedHeader.CONTACT_CAPACITY],
    }
  }

  fits(transformFloats: number, hingeCount: number): boolean {
    return transformFloats <= this.i32[SharedHeader.TRANSFORM_CAPACITY]
      && hingeCount <= this.i32[SharedHeader.HINGE_CAPACITY]
  }

  /** Free contact records in the ring right now. */
  contactSpace(): number {
    const { ringSlots } = regionOffsets(this.i32)
    const head = Atomics.load(this.i32, SharedHeader.CONTACT_HEAD)
    const tail = Atomics.load(this.i32, SharedHeader.CONTACT_TAIL)
    const used = (tail - head + ringSlots) % ringSlots
    return ringSlots - 1 - used
  }

  /** Append `count` packed contacts. False (and nothing written) when they do not fit. */
  pushContacts(packed: ArrayLike<number>, count: number): boolean {
    if (count <= 0) return true
    if (count > this.contactSpace()) return false
    const { contactStart, ringSlots } = regionOffsets(this.i32)
    let tail = Atomics.load(this.i32, SharedHeader.CONTACT_TAIL)
    for (let r = 0; r < count; r++) {
      const dst = contactStart + tail * CONTACT_STRIDE
      const src = r * CONTACT_STRIDE
      for (let k = 0; k < CONTACT_STRIDE; k++) this.f32[dst + k] = packed[src + k]
      tail = (tail + 1) % ringSlots
    }
    // Publishing the tail last is what makes the records visible.
    Atomics.store(this.i32, SharedHeader.CONTACT_TAIL, tail)
    return true
  }

  /** Caller must check `fits` first. */
  publish(
    alpha: number,
    stepCount: number,
    stepMs: number,
    transforms: Float32Array | null,
    hinges: Iterable<number>,
    hingeAngle: (id: number) => number,
  ): void {
    const { hingeStart } = regionOffsets(this.i32)
    Atomics.add(this.i32, SharedHeader.SEQ, 1)
    const tf = transforms?.length ?? 0
    if (transforms && tf > 0) this.f32.set(transforms, DATA_START)
    this.i32[SharedHeader.TRANSFORM_FLOATS] = tf
    let h = 0
    for (const id of hinges) {
      const o = hingeStart + h * HINGE_STRIDE
      this.f32[o] = id
      this.f32[o + 1] = hingeAngle(id)
      h++
    }
    this.i32[SharedHeader.HINGE_COUNT] = h
    this.f32[SCALAR_ALPHA] = alpha
    this.f32[SCALAR_STEP_MS] = stepMs
    this.i32[SharedHeader.STEP_COUNT] = stepCount
    Atomics.add(this.i32, SharedHeader.SEQ, 1)
    Atomics.add(this.i32, SharedHeader.PUBLISH_COUNT, 1)
  }
}

/** Seqlock retries before a read gives up for this frame. */
const READ_ATTEMPTS = 4

/** Main-thread side. Single reader; allocates only when a region grows. */
export class SharedSnapshotReader {
  readonly buffer: SharedArrayBuffer
  private readonly i32: Int32Array
  private readonly f32: Float32Array
  private lastSeq = 0

  /** Latest consistent snapshot. Views are replaced, never mutated, by `read()`. */
  transforms: Float32Array | null = null
  hinges: Float32Array | null = null
  alpha = 0
  stepCount = 0
  stepMs = 0

  private transformStore = new Float32Array(0)
  private transformStaging = new Float32Array(0)
  private hingeStore = new Float32Array(0)
  private hingeStaging = new Float32Array(0)

  constructor(buffer: SharedArrayBuffer) {
    const i32 = new Int32Array(buffer)
    if (i32[SharedHeader.MAGIC] !== SHARED_LAYOUT_MAGIC) {
      throw new Error('shared physics buffer: bad magic')
    }
    if (i32[SharedHeader.VERSION] !== SHARED_LAYOUT_VERSION) {
      throw new Error(`shared physics buffer: layout v${i32[SharedHeader.VERSION]}, expected v${SHARED_LAYOUT_VERSION}`)
    }
    this.buffer = buffer
    this.i32 = i32
    this.f32 = new Float32Array(buffer)
    // SEQ 0 means nothing published; a snapshot written before this reader
    // existed (a publish racing `shared-attach`) is still picked up.
  }

  /** Copy the latest snapshot if one was published since the last read. */
  read(): boolean {
    const { transformCap, hingeCap, hingeStart } = regionOffsets(this.i32)
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
      const s1 = Atomics.load(this.i32, SharedHeader.SEQ)
      if (s1 === this.lastSeq) return false
      if ((s1 & 1) !== 0) continue

      // Lengths are read inside the window too, so clamp: a torn value must
      // not index past the region before the SEQ check rejects it.
      const tf = Math.min(Math.max(this.i32[SharedHeader.TRANSFORM_FLOATS], 0), transformCap)
      const hc = Math.min(Math.max(this.i32[SharedHeader.HINGE_COUNT], 0), hingeCap)
      if (this.transformStaging.length < tf) this.transformStaging = new Float32Array(transformCap)
      if (this.hingeStaging.length < hc * HINGE_STRIDE) this.hingeStaging = new Float32Array(hingeCap * HINGE_STRIDE)
      this.transformStaging.set(this.f32.subarray(DATA_START, DATA_START + tf))
      this.hingeStaging.set(this.f32.subarray(hingeStart, hingeStart + hc * HINGE_STRIDE))
      const alpha = this.f32[SCALAR_ALPHA]
      const stepMs = this.f32[SCALAR_STEP_MS]
      const stepCount = this.i32[SharedHeader.STEP_COUNT]

      if (Atomics.load(this.i32, SharedHeader.SEQ) !== s1) continue

      this.lastSeq = s1
      ;[this.transformStore, this.transformStaging] = [this.transformStaging, this.transformStore]
      ;[this.hingeStore, this.hingeStaging] = [this.hingeStaging, this.hingeStore]
      this.transforms = tf > 0 ? this.transformStore.subarray(0, tf) : null
      this.hinges = hc > 0 ? this.hingeStore.subarray(0, hc * HINGE_STRIDE) : null
      this.alpha = alpha
      this.stepMs = stepMs
      this.stepCount = stepCount
      return true
    }
    return false
  }

  /**
   * Hand every queued contact to `sink` as contiguous packed chunks (at most
   * two when the ring wraps), then release them. Returns the record count.
   */
  drainContacts(sink: (packed: Float32Array, count: number) => void): number {
    const { contactStart, ringSlots } = regionOffsets(this.i32)
    const head = Atomics.load(this.i32, SharedHeader.CONTACT_HEAD)
    const tail = Atomics.load(this.i32, SharedHeader.CONTACT_TAIL)
    if (head === tail) return 0
    const chunk = (from: number, to: number) => {
      if (to <= from) return
      sink(
        this.f32.subarray(contactStart + from * CONTACT_STRIDE, contactStart + to * CONTACT_STRIDE),
        to - from,
      )
    }
    if (tail > head) {
      chunk(head, tail)
    } else {
      chunk(head, ringSlots)
      chunk(0, tail)
    }
    Atomics.store(this.i32, SharedHeader.CONTACT_HEAD, tail)
    return (tail - head + ringSlots) % ringSlots
  }

  getPublishCount(): number {
    return Atomics.load(this.i32, SharedHeader.PUBLISH_COUNT)
  }
}
