import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { PhysicsBody } from '../../core/physics-api'
import { distance3 } from '../../core/vec3-scalar'
import { getMaterialLibrary } from '../../materials'
import { color } from '../visual-language'
import type { MagneticFieldConfig } from './types'
import { PathMechanic } from './base'

export class MagneticField extends PathMechanic {
  private fieldMesh: Mesh | null = null
  private fieldRing: Mesh | null = null
  private fieldLight: PointLight | null = null
  private position = Vector3.Zero()
  private fieldRadius = 4
  private pullStrength = 15
  private liftForce = 5
  private pulseTime = 0

  spawn(config: MagneticFieldConfig): void {
    if (this.isSpawned) return

    this.position = config.position.clone()
    this.fieldRadius = config.fieldRadius
    this.pullStrength = config.pullStrength
    this.liftForce = config.liftForce

    this.setMapColors(config.mapBaseColor, config.mapAccentColor)
    this.createVisuals()

    this.isSpawned = true
    console.log(`[MagneticField] Spawned at ${this.position.toString()}, radius: ${this.fieldRadius}`)
  }

  despawn(): void {
    if (!this.isSpawned) return

    this.fieldMesh?.dispose()
    this.fieldRing?.dispose()
    this.fieldLight?.dispose()

    this.fieldMesh = null
    this.fieldRing = null
    this.fieldLight = null
    this.isSpawned = false
  }

  private createVisuals(): void {
    const matLib = getMaterialLibrary(this.scene)

    // Central field visualization (transparent cylinder)
    this.fieldMesh = MeshBuilder.CreateCylinder('magField', {
      diameter: this.fieldRadius * 2,
      height: 0.2,
      tessellation: 32
    }, this.scene)
    this.fieldMesh.position = this.position

    const fieldMat = matLib.getGlassTubeMaterial()
    fieldMat.alpha = 0.3
    fieldMat.emissiveColor = color(this.mapBaseColor).scale(0.5)
    this.fieldMesh.material = fieldMat
    this.fieldMesh.parent = this.rootNode

    // Animated ring
    this.fieldRing = MeshBuilder.CreateTorus('magRing', {
      diameter: this.fieldRadius * 1.5,
      thickness: 0.15,
      tessellation: 32
    }, this.scene)
    this.fieldRing.position = this.position.add(new Vector3(0, 0.5, 0))
    this.fieldRing.material = this.neonMaterial
    this.fieldRing.parent = this.rootNode

    // Field light
    this.fieldLight = new PointLight('magLight', this.position.add(new Vector3(0, 2, 0)), this.scene)
    this.fieldLight.intensity = 1.5
    this.fieldLight.range = this.fieldRadius * 2
    this.fieldLight.diffuse = color(this.mapBaseColor)
  }

  update(dt: number, ballBodies: PhysicsBody[]): void {
    if (!this.isSpawned) return

    this.pulseTime += dt * 3

    // Animate field ring
    if (this.fieldRing) {
      this.fieldRing.rotation.y += dt * 2
      this.fieldRing.scaling.copyFromFloats(
        1 + Math.sin(this.pulseTime) * 0.1,
        1,
        1 + Math.sin(this.pulseTime) * 0.1
      )
    }

    // Pulse the light
    if (this.fieldLight) {
      this.fieldLight.intensity = 1.5 + Math.sin(this.pulseTime * 2) * 0.5
    }

    // Apply magnetic force to balls in range
    for (const ball of ballBodies) {
      const pos = ball.translation()
      const distance = distance3(pos, this.position)

      if (distance < this.fieldRadius && pos.y < 3) {
        // Pull direction toward the field centre: (position - ball) normalised in 3D (its length is
        // `distance`; a zero vector stays zero, like Vector3.normalize), then flattened (y ignored).
        const inv = distance === 0 ? 0 : 1 / distance
        const pullDir = {
          x: (this.position.x - pos.x) * inv,
          z: (this.position.z - pos.z) * inv,
        }

        // Distance factor (stronger when closer)
        const strength = this.pullStrength * (1 - distance / this.fieldRadius)

        // Apply impulse
        ball.applyImpulse({
          x: pullDir.x * strength * dt,
          y: this.liftForce * dt, // Slight lift
          z: pullDir.z * strength * dt
        }, true)
      }
    }
  }

  protected updateVisualColors(): void {
    const matLib = getMaterialLibrary(this.scene)
    if (this.fieldMesh) {
      const fieldMat = matLib.getGlassTubeMaterial()
      fieldMat.emissiveColor = color(this.mapBaseColor).scale(0.5)
      this.fieldMesh.material = fieldMat
    }
    if (this.fieldRing) {
      this.fieldRing.material = this.neonMaterial
    }
    if (this.fieldLight) {
      this.fieldLight.diffuse = color(this.mapBaseColor)
    }
  }
}
