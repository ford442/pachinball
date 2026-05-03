import { MeshBuilder, Vector3, StandardMaterial, Mesh, Scene } from '@babylonjs/core'
import { emissive, INTENSITY, PALETTE } from '../game-elements/visual-language'
import { EffectsConfig } from '../config'

interface RippleRing {
  mesh: Mesh
  material: StandardMaterial
  age: number
  maxAge: number
  initialScale: number
  maxScale: number
}

export class RipplesEffects {
  private scene: Scene
  private rippleRings: RippleRing[] = []

  constructor(scene: Scene) {
    this.scene = scene
  }

  spawnRippleRings(pos: Vector3, intensity: 'light' | 'medium' | 'heavy'): void {
    const ringCount =
      intensity === 'light' ? 1 : intensity === 'medium' ? 2 : EffectsConfig.bumperImpact.rippleRingCount

    for (let i = 0; i < ringCount; i++) {
      const ring = MeshBuilder.CreateTorus(
        `rippleRing_${Date.now()}_${i}`,
        { diameter: 0.5, thickness: 0.05, tessellation: 32 },
        this.scene
      )

      ring.position.copyFrom(pos)
      ring.position.y = 0.1
      ring.rotation.x = Math.PI / 2

      const mat = new StandardMaterial(`rippleMat_${Date.now()}_${i}`, this.scene)
      mat.emissiveColor = emissive(PALETTE.CYAN, INTENSITY.FLASH)
      mat.alpha = 0.8
      ring.material = mat

      this.rippleRings.push({
        mesh: ring,
        material: mat,
        age: i * 0.05,
        maxAge: 0.3 + i * 0.1,
        initialScale: 1,
        maxScale: 3 + i,
      })
    }
  }

  updateRippleRings(dt: number): void {
    for (let i = this.rippleRings.length - 1; i >= 0; i--) {
      const ring = this.rippleRings[i]
      ring.age += dt

      if (ring.age >= ring.maxAge) {
        ring.mesh.dispose()
        ring.material.dispose()
        this.rippleRings.splice(i, 1)
        continue
      }

      const progress = ring.age / ring.maxAge
      const scale = ring.initialScale + (ring.maxScale - ring.initialScale) * progress
      ring.mesh.scaling.setAll(scale)

      ring.material.alpha = 0.8 * (1 - progress)
    }
  }

  clear(): void {
    for (const r of this.rippleRings) {
      r.mesh.dispose()
      r.material.dispose()
    }
    this.rippleRings = []
  }
}
