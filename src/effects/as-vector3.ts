import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Vec3Like } from '../core/vec3-scalar'

/**
 * A gameplay position as the `Vector3` an effect needs. Gameplay code (scoring, contact handlers)
 * hands effects plain `{x, y, z}` records so it runs without Babylon (#528); a `Vector3` passes
 * through as is, anything else is copied into a new one (the call sites used to allocate it).
 */
export function asVector3(v: Vec3Like): Vector3 {
  return v instanceof Vector3 ? v : new Vector3(v.x, v.y, v.z)
}
