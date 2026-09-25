/**
 * Pin-field descriptor + lattice resolver (#421).
 *
 * A pachinko pin lattice is authored as ONE `PinFieldSpec`. On the C++ owner
 * path it becomes a single `addPinField` handle (native/src/PinField.{h,cpp});
 * on the Rapier path it falls back to one fixed cylinder per pin. Either way
 * the visual instances come from `resolvePinField`, which mirrors the native
 * resolver rule for rule — occupancy mask, keep-outs, seeded dropout — and
 * does its position maths in float32 exactly as `PinField::worldPin` does, so
 * the instances sit on precisely the pins C++ collides with.
 *
 * Pure TS, no engine imports: part of the worker compile graph.
 */

export interface PinFieldVec3 {
  x: number
  y: number
  z: number
}

export interface PinFieldQuat {
  x: number
  y: number
  z: number
  w: number
}

/** World-space XZ keep-out rectangle; inclusive on every edge (`KEEP_OUT_BOXES` semantics). */
export interface PinKeepOut {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface PinFieldSpec {
  /** World centre of pin (row 0, col 0). */
  origin: PinFieldVec3
  rows: number
  cols: number
  spacingX: number
  spacingZ: number
  /** Local +X shift of odd rows (the staggered pachinko lattice). */
  rowOffsetX: number
  /** Every pin is one cylinder along the field's local Y axis. */
  radius: number
  halfHeight: number
  rotation?: PinFieldQuat
  restitution: number
  friction: number
  /** Rapier-packed collision-group word (membership << 16 | filter); all groups when absent. */
  collisionGroups?: number
  keepOuts?: readonly PinKeepOut[]
  /** Bit-packed occupancy, LSB-first, slot index row * cols + col; absent means every slot. */
  occupancy?: Uint8Array
  dropoutSeed?: number
  /** Probability in [0, 1] that the seeded hash removes a slot. */
  dropout?: number
}

export interface PinFieldPin {
  /** Lattice index (row * cols + col) — what C++ reports as the contact sub-index. */
  index: number
  row: number
  col: number
  position: PinFieldVec3
}

const f32 = Math.fround
const IDENTITY: PinFieldQuat = { x: 0, y: 0, z: 0, w: 1 }

/** lowbias32 over (seed ^ golden-ratio-scrambled index); bit-identical to native `pinFieldHash`. */
export function pinFieldHash(seed: number, index: number): number {
  let h = (seed ^ Math.imul(index >>> 0, 0x9e3779b9)) >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

/** Native `pinFieldDropped`: 24-bit fixed-point compare, so both sides agree exactly. */
export function pinFieldDropped(seed: number, dropout: number, index: number): boolean {
  const p = f32(dropout)
  if (!(p > 0)) return false
  const threshold = Math.floor(Math.min(p, 1) * 16777216)
  return pinFieldHash(seed >>> 0, index) >>> 8 < threshold
}

function normalizedF32(q: PinFieldQuat): PinFieldQuat {
  const x = f32(q.x)
  const y = f32(q.y)
  const z = f32(q.z)
  const w = f32(q.w)
  const len = f32(Math.sqrt(f32(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z)) + f32(w * w))))
  if (!(len > 1e-12)) return { ...IDENTITY }
  return { x: f32(x / len), y: f32(y / len), z: f32(z / len), w: f32(w / len) }
}

function crossF32(a: PinFieldVec3, b: PinFieldVec3): PinFieldVec3 {
  return {
    x: f32(f32(a.y * b.z) - f32(a.z * b.y)),
    y: f32(f32(a.z * b.x) - f32(a.x * b.z)),
    z: f32(f32(a.x * b.y) - f32(a.y * b.x)),
  }
}

/** `Quat::rotate` in MathTypes.h, one float32 rounding per operation. */
function rotateF32(q: PinFieldQuat, v: PinFieldVec3): PinFieldVec3 {
  const qv = { x: q.x, y: q.y, z: q.z }
  const uv = crossF32(qv, v)
  const uuv = crossF32(qv, uv)
  const s = f32(2 * q.w)
  return {
    x: f32(f32(v.x + f32(uv.x * s)) + f32(uuv.x * 2)),
    y: f32(f32(v.y + f32(uv.y * s)) + f32(uuv.y * 2)),
    z: f32(f32(v.z + f32(uv.z * s)) + f32(uuv.z * 2)),
  }
}

function maskAllows(mask: Uint8Array | undefined, index: number): boolean {
  if (!mask || mask.length === 0) return true
  const byte = index >> 3
  if (byte >= mask.length) return false
  return ((mask[byte]! >> (index & 7)) & 1) === 1
}

function inKeepOut(keepOuts: readonly PinKeepOut[], p: PinFieldVec3): boolean {
  for (const k of keepOuts) {
    if (p.x >= f32(k.minX) && p.x <= f32(k.maxX) && p.z >= f32(k.minZ) && p.z <= f32(k.maxZ)) return true
  }
  return false
}

/** World centre of lattice slot (row, col), float32-exact with native `PinField::worldPin`. */
export function pinFieldSlotPosition(spec: PinFieldSpec, row: number, col: number): PinFieldVec3 {
  const sx = f32(Math.max(f32(spec.spacingX), f32(1e-4)))
  const sz = f32(Math.max(f32(spec.spacingZ), f32(1e-4)))
  const local = {
    x: f32(f32(col * sx) + ((row & 1) ? f32(spec.rowOffsetX) : 0)),
    y: 0,
    z: f32(row * sz),
  }
  const r = rotateF32(normalizedF32(spec.rotation ?? IDENTITY), local)
  return {
    x: f32(f32(spec.origin.x) + r.x),
    y: f32(f32(spec.origin.y) + r.y),
    z: f32(f32(spec.origin.z) + r.z),
  }
}

/** Every pin the field holds, in lattice order. */
export function resolvePinField(spec: PinFieldSpec): PinFieldPin[] {
  const rows = Math.max(0, Math.trunc(spec.rows))
  const cols = Math.max(0, Math.trunc(spec.cols))
  const keepOuts = spec.keepOuts ?? []
  const seed = (spec.dropoutSeed ?? 0) >>> 0
  const dropout = spec.dropout ?? 0
  const pins: PinFieldPin[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col
      if (!maskAllows(spec.occupancy, index)) continue
      const position = pinFieldSlotPosition(spec, row, col)
      if (inKeepOut(keepOuts, position)) continue
      if (pinFieldDropped(seed, dropout, index)) continue
      pins.push({ index, row, col, position })
    }
  }
  return pins
}

/** Bit-packed occupancy with exactly `slots` set. */
export function pinFieldOccupancy(rows: number, cols: number, slots: Iterable<{ row: number; col: number }>): Uint8Array {
  const mask = new Uint8Array(Math.ceil((rows * cols) / 8))
  for (const { row, col } of slots) {
    if (row < 0 || row >= rows || col < 0 || col >= cols) continue
    const index = row * cols + col
    mask[index >> 3]! |= 1 << (index & 7)
  }
  return mask
}

/**
 * Occupancy mask for explicit XZ pin positions on an unrotated lattice (a
 * Daily Cascade layout), or null when any position is off the lattice — the
 * caller then keeps its per-pin colliders.
 */
export function pinFieldOccupancyForPositions(
  spec: PinFieldSpec,
  positions: readonly { x: number; z: number }[],
  tolerance = 1e-3,
): Uint8Array | null {
  const rot = spec.rotation
  if (rot && (rot.x !== 0 || rot.y !== 0 || rot.z !== 0)) return null
  const slots: { row: number; col: number }[] = []
  for (const p of positions) {
    const row = Math.round((p.z - spec.origin.z) / spec.spacingZ)
    const offset = row & 1 ? spec.rowOffsetX : 0
    const col = Math.round((p.x - spec.origin.x - offset) / spec.spacingX)
    if (row < 0 || row >= spec.rows || col < 0 || col >= spec.cols) return null
    const expectX = spec.origin.x + col * spec.spacingX + offset
    const expectZ = spec.origin.z + row * spec.spacingZ
    if (Math.abs(expectX - p.x) > tolerance || Math.abs(expectZ - p.z) > tolerance) return null
    slots.push({ row, col })
  }
  return pinFieldOccupancy(spec.rows, spec.cols, slots)
}

/** World-space pin AABBs for debug draw — instanced from the descriptor, never read back from C++. */
export function pinFieldPinBounds(spec: PinFieldSpec): { center: PinFieldVec3; halfExtents: PinFieldVec3 }[] {
  const q = normalizedF32(spec.rotation ?? IDENTITY)
  const axis = rotateF32(q, { x: 0, y: 1, z: 0 })
  const extent = (ae: number) => Math.abs(spec.halfHeight * ae) + spec.radius * Math.sqrt(Math.max(0, 1 - ae * ae))
  const halfExtents = { x: extent(axis.x), y: extent(axis.y), z: extent(axis.z) }
  return resolvePinField(spec).map((pin) => ({ center: pin.position, halfExtents }))
}
