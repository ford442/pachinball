/**
 * Allocation-free vector math on plain `{x, y, z}` records (#488 §5, zero-allocation hot path).
 *
 * Per-frame `update(dt, balls)` loops compare a ball's `translation()` (a plain PhysicsVector)
 * with a Babylon `Vector3`. `Vector3.Distance` only accepts Vector3s, which used to mean a
 * `new Vector3(pos.x, pos.y, pos.z)` per ball per frame. These take any `{x, y, z}` and compute
 * the same floating-point result (`Math.sqrt` of the summed squared deltas, in x, y, z order,
 * exactly as Babylon's `Vector3.DistanceSquared`), so thresholds behave identically.
 *
 * No Babylon import: this is kernel code (see `event-bus.ts`).
 */

export interface Vec3Like {
  readonly x: number
  readonly y: number
  readonly z: number
}

export function distanceSquared3(a: Vec3Like, b: Vec3Like): number {
  const x = a.x - b.x
  const y = a.y - b.y
  const z = a.z - b.z
  return x * x + y * y + z * z
}

export function distance3(a: Vec3Like, b: Vec3Like): number {
  return Math.sqrt(distanceSquared3(a, b))
}
