import { Quaternion, type Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Scene } from '@babylonjs/core/scene'
import { color, INTENSITY, PALETTE } from '../game-elements/visual-language'
import { EffectsConfig } from '../config'
import { TransientField } from './transient-field'

/** Rings alive at once (a heavy impact spawns `rippleRingCount`). A spawn that would not fit is skipped. */
const RIPPLE_CAPACITY = 96

const RIPPLE_ALPHA = 0.8
/** The rings lie flat on the table, a little above it. */
const RIPPLE_Y = 0.1

interface RippleRing {
  x: number
  z: number
  age: number
  maxAge: number
  initialScale: number
  maxScale: number
}

/**
 * Bumper ripple rings: one torus drawn as thin instances on the shared transient material
 * (`TransientField`), so an impact creates neither a mesh nor a material (#524).
 */
export class RipplesEffects {
  private readonly field: TransientField
  private rippleRings: RippleRing[] = []
  /** `rotation.x = π/2`, composed once. */
  private readonly flat = Quaternion.RotationYawPitchRoll(0, Math.PI / 2, 0)
  private readonly tintR: number
  private readonly tintG: number
  private readonly tintB: number

  constructor(scene: Scene) {
    this.field = new TransientField(
      scene,
      () => MeshBuilder.CreateTorus('rippleRingField', { diameter: 0.5, thickness: 0.05, tessellation: 32 }, scene),
      RIPPLE_CAPACITY,
    )
    // The same colour as the emissive material this replaced; the field clamps it to 0..1.
    const tint = color(PALETTE.CYAN).scale(INTENSITY.FLASH)
    this.tintR = tint.r
    this.tintG = tint.g
    this.tintB = tint.b
  }

  spawnRippleRings(pos: Vector3, intensity: 'light' | 'medium' | 'heavy'): void {
    const ringCount =
      intensity === 'light' ? 1 : intensity === 'medium' ? 2 : EffectsConfig.bumperImpact.rippleRingCount

    for (let i = 0; i < ringCount; i++) {
      if (this.rippleRings.length >= RIPPLE_CAPACITY) return
      this.rippleRings.push({
        x: pos.x,
        z: pos.z,
        age: i * 0.05,
        maxAge: 0.3 + i * 0.1,
        initialScale: 1,
        maxScale: 3 + i,
      })
    }
  }

  updateRippleRings(dt: number): void {
    // Nothing alive and nothing shown: the field is already hidden.
    if (this.rippleRings.length === 0) return

    const field = this.field
    const q = this.flat
    field.begin()
    for (let i = this.rippleRings.length - 1; i >= 0; i--) {
      const ring = this.rippleRings[i]!
      ring.age += dt

      if (ring.age >= ring.maxAge) {
        this.rippleRings.splice(i, 1)
        continue
      }

      const progress = ring.age / ring.maxAge
      const scale = ring.initialScale + (ring.maxScale - ring.initialScale) * progress
      field.push(
        ring.x, RIPPLE_Y, ring.z,
        q.x, q.y, q.z, q.w,
        scale, scale, scale,
        this.tintR, this.tintG, this.tintB, RIPPLE_ALPHA * (1 - progress),
      )
    }
    field.end()
  }

  clear(): void {
    this.rippleRings = []
    this.field.begin()
    this.field.end()
  }

  dispose(): void {
    this.rippleRings = []
    this.field.dispose()
  }
}
