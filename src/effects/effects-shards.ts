import { MeshBuilder, Vector3, StandardMaterial, Color3, Animation } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import type { ShardParticle } from '../game-elements/types'
import { emissive, INTENSITY, PALETTE } from '../game-elements/visual-language'

export class ShardEffects {
  private scene: Scene
  private shards: ShardParticle[]
  private activeImpactRings = 0
  private maxImpactRings: number

  constructor(scene: Scene, shards: ShardParticle[], maxImpactRings = 5) {
    this.scene = scene
    this.shards = shards
    this.maxImpactRings = maxImpactRings
  }

  spawnShardBurst(pos: Vector3, colorHex?: string): void {
    const burstColor = colorHex || PALETTE.CYAN
    for (let i = 0; i < 8; i++) {
      const m = MeshBuilder.CreateBox('s', { size: 0.15 }, this.scene)
      m.position.copyFrom(pos)

      const mat = new StandardMaterial('sm', this.scene)
      mat.emissiveColor = emissive(burstColor, INTENSITY.FLASH)
      m.material = mat

      const vel = new Vector3(Math.random() - 0.5, Math.random() + 1, Math.random() - 0.5).scale(5)
      const rotVel = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).scale(10)
      const initialScale = 0.8 + Math.random() * 0.4
      m.scaling.setAll(initialScale)

      this.shards.push({
        mesh: m,
        vel,
        rotVel,
        life: 1.0,
        maxLife: 1.0,
        initialScale,
        material: mat,
      })
    }
  }

  updateShards(dt: number): void {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i]
      s.life -= dt

      if (s.life <= 0) {
        s.mesh.dispose()
        this.shards.splice(i, 1)
        continue
      }

      s.mesh.position.addInPlace(s.vel.scale(dt))
      s.vel.y -= 9.8 * dt
      s.vel.scaleInPlace(0.98)

      s.mesh.rotation.addInPlace(s.rotVel.scale(dt))

      const lifeNorm = s.life / s.maxLife
      s.material.alpha = lifeNorm * 0.8
      s.mesh.scaling.setAll(s.initialScale * (0.3 + lifeNorm * 0.7))
    }
  }

  spawnImpactRing(position: Vector3, normal: Vector3, color: string): void {
    if (this.activeImpactRings >= this.maxImpactRings) return

    this.activeImpactRings++

    const ring = MeshBuilder.CreateTorus(
      'impactRing',
      { diameter: 0.5, thickness: 0.05, tessellation: 32 },
      this.scene
    )

    ring.position = position.clone()
    ring.lookAt(position.add(normal))

    const mat = new StandardMaterial('ringMat', this.scene)
    mat.emissiveColor = Color3.FromHexString(color)
    mat.alpha = 0.8
    mat.disableLighting = true
    ring.material = mat

    const scaleAnim = new Animation(
      'ringScale',
      'scaling',
      60,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    )

    const scaleKeys = [
      { frame: 0, value: new Vector3(1, 1, 1) },
      { frame: 20, value: new Vector3(5, 5, 1) },
    ]
    scaleAnim.setKeys(scaleKeys)

    const fadeAnim = new Animation(
      'ringFade',
      'material.alpha',
      60,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    )

    const fadeKeys = [
      { frame: 0, value: 0.8 },
      { frame: 20, value: 0 },
    ]
    fadeAnim.setKeys(fadeKeys)

    ring.animations = [scaleAnim, fadeAnim]

    this.scene.beginAnimation(
      ring,
      0,
      20,
      false,
      1,
      () => {
        ring.dispose()
        mat.dispose()
        this.activeImpactRings--
      }
    )
  }

  getActiveImpactCount(): number {
    return this.activeImpactRings
  }
}
