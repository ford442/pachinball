/**
 * Recycled materials for the per-ball ribbon trails (#524).
 *
 * A ball's `TrailMesh` needs a material of its own: `updateTrailEffects` lerps its emissive colour
 * with the ball's speed, fades its alpha when the ball is hologram-caught, and the map / reward
 * code recolours it, so two balls cannot share one. But "of its own" does not have to mean "built
 * per spawn": a ball that leaves hands its material back, and the next ball takes it. After the
 * most balls the table has ever held at once, no trail creates a material.
 *
 * The pool lives on the `BallManager` (it disposes it) and is only touched when a ball is added or
 * removed, never per frame.
 */

import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Scene } from '@babylonjs/core/scene'
import { createStandardMaterial } from './material-basic'

export class TrailMaterialPool {
  private readonly scene: Scene
  private readonly free: StandardMaterial[] = []
  private readonly all: StandardMaterial[] = []

  constructor(scene: Scene) {
    this.scene = scene
  }

  /**
   * A trail material, fully opaque, with `emissive` as its colour. The material takes ownership of
   * the `Color3` it is given (`updateTrailEffects` lerps into it in place), so pass a fresh one.
   */
  acquire(emissive: Color3): StandardMaterial {
    const recycled = this.free.pop()
    if (recycled) {
      recycled.emissiveColor = emissive
      recycled.alpha = 1
      return recycled
    }
    const mat = createStandardMaterial(this.scene, `trailMat_${this.all.length}`, { emissive })
    this.all.push(mat)
    return mat
  }

  /** Hand a material back when its trail is disposed. Ignores anything this pool did not make. */
  release(material: StandardMaterial): void {
    if (this.free.includes(material) || !this.all.includes(material)) return
    this.free.push(material)
  }

  /** Materials ever created (free or in use). */
  get size(): number {
    return this.all.length
  }

  dispose(): void {
    for (const mat of this.all) mat.dispose()
    this.all.length = 0
    this.free.length = 0
  }
}
