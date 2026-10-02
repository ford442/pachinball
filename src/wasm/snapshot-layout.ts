/**
 * Id-bearing fields of a v1 world snapshot (`PhysicsWorld::serialize()`,
 * native/src/Snapshot.cpp), read without restoring it.
 *
 * A restore replaces rigid bodies and hinges "wholesale, public ids
 * included". Whoever mirrors those ids outside C++ — the worker client's id
 * shadow, the worker's published-hinge set, a replay remapping TS links onto
 * the recorded ids — reads them here. Pure: no WASM, no DOM.
 */

import { WASM_SNAPSHOT_VERSION } from './wasm-types'

/** Little-endian u32 words. Mirror `PhysicsWorld::serialize()`. */
const SNAPSHOT_MAGIC = 0x4e534250
const WORD_VERSION = 1
const WORD_HASH_LO = 3
const WORD_HASH_HI = 4
const WORD_STEP_LO = 17
const WORD_STEP_HI = 18
/** Header (17) + step counter (2) + accumulator (1) + world params (10). */
const WORD_HANDLES = 30
/** `SnapshotAccess::kBodyWords`: public id + 28 float + 3 byte + sleep + 2 word columns. */
const BODY_WORDS = 35
/** Per hinge: id, bodyId, active, 3 × Vec3, Quat, min/max angle, motor vel/torque, baumgarte. */
const HINGE_WORDS = 21

export interface SnapshotHinge {
  id: number
  bodyId: number
}

export interface SnapshotIds {
  version: number
  /** 16 hex chars, identical to `engine.getStaticContentHash()` on the same table. */
  staticHash: string
  /** C++ fixed steps taken when the snapshot was serialized. */
  stepCount: number
  /** Public ids of every rigid body, dense order. */
  bodyIds: number[]
  /** `HandleTable::nextId_` — the id the next `createBody` returns after a restore. */
  nextBodyId: number
  /** Active hinges only. */
  hinges: SnapshotHinge[]
  nextHingeId: number
}

function hex32(v: number): string {
  return (v >>> 0).toString(16).padStart(8, '0')
}

/** Parse the id table of a v1 snapshot; null when malformed or not v1. */
export function readSnapshotIds(bytes: Uint8Array): SnapshotIds | null {
  if (bytes.byteLength < (WORD_HANDLES + 2) * 4 || bytes.byteLength % 4 !== 0) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const words = bytes.byteLength / 4
  const word = (i: number) => view.getUint32(i * 4, true)
  const int = (i: number) => view.getInt32(i * 4, true)
  if (word(0) !== SNAPSHOT_MAGIC) return null
  const version = word(WORD_VERSION)
  if (version !== WASM_SNAPSHOT_VERSION) return null

  const slots = word(WORD_HANDLES + 1)
  const bodyCountWord = WORD_HANDLES + 2 + slots * 2
  if (bodyCountWord + 1 > words) return null
  const count = word(bodyCountWord)
  const hingeWord = bodyCountWord + 1 + count * BODY_WORDS
  if (hingeWord + 2 > words) return null
  const bodyIds: number[] = []
  for (let i = 0; i < count; i++) bodyIds.push(int(bodyCountWord + 1 + i))

  const hingeCount = word(hingeWord + 1)
  if (hingeWord + 2 + hingeCount * HINGE_WORDS > words) return null
  const hinges: SnapshotHinge[] = []
  for (let i = 0; i < hingeCount; i++) {
    const base = hingeWord + 2 + i * HINGE_WORDS
    if (word(base + 2) !== 0) hinges.push({ id: int(base), bodyId: int(base + 1) })
  }

  return {
    version,
    staticHash: hex32(word(WORD_HASH_HI)) + hex32(word(WORD_HASH_LO)),
    stepCount: word(WORD_STEP_HI) * 0x1_0000_0000 + word(WORD_STEP_LO),
    bodyIds,
    nextBodyId: int(WORD_HANDLES),
    hinges,
    nextHingeId: int(hingeWord),
  }
}
