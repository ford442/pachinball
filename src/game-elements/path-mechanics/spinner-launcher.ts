import { MeshBuilder, Vector3, Mesh } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { getMaterialLibrary } from '../../materials'
import type { SpinnerLauncherConfig } from './types'
import { PathMechanic } from './base'

export class SpinnerLauncher extends PathMechanic {
  private spinnerMesh: Mesh | null = null
  private spinnerBlades: Mesh[] = []
  private baseMesh: Mesh | null = null
  private physicsBody: RAPIER.RigidBody | null = null
  private position = Vector3.Zero()
  private spinnerRadius = 2
  private launchForce = 25
  private spinSpeed = 5
  private currentRotation = 0
  private launchCooldown = 0
  private hasLaunched = false

  spawn(config: SpinnerLauncherConfig): void {
    if (this.isSpawned) return

    this.position = config.position.clone()
    this.spinnerRadius = config.spinnerRadius
    this.launchForce = config.launchForce
    this.spinSpeed = config.spinSpeed

    this.setMapColors(config.mapBaseColor, config.mapAccentColor)
    this.createVisuals()
    this.createPhysics()

    this.isSpawned = true
    console.log(`[SpinnerLauncher] Spawned at ${this.position}`)
  }

  despawn(): void {
    if (!this.isSpawned) return

    this.spinnerMesh?.dispose()
    this.spinnerBlades.forEach(b => b.dispose())
    this.baseMesh?.dispose()
    if (this.physicsBody) {
      this.world.removeRigidBody(this.physicsBody)
    }

    this.spinnerMesh = null
    this.spinnerBlades = []
    this.baseMesh = null
    this.physicsBody = null
    this.isSpawned = false
  }

  private createVisuals(): void {
    const matLib = getMaterialLibrary(this.scene)
    const baseMat = matLib.getBrushedMetalMaterial()

    // Base platform
    this.baseMesh = MeshBuilder.CreateCylinder('spinnerBase', {
      diameter: this.spinnerRadius * 2 + 1,
      height: 0.5,
      tessellation: 32
    }, this.scene)
    this.baseMesh.position = this.position.add(new Vector3(0, -0.25, 0))
    this.baseMesh.material = baseMat
    this.baseMesh.parent = this.rootNode

    // Spinner hub
    this.spinnerMesh = MeshBuilder.CreateCylinder('spinnerHub', {
      diameter: 1,
      height: 0.8,
      tessellation: 16
    }, this.scene)
    this.spinnerMesh.position = this.position
    this.spinnerMesh.material = this.neonMaterial
    this.spinnerMesh.parent = this.rootNode

    // Spinner blades
    const bladeCount = 4
    for (let i = 0; i < bladeCount; i++) {
      const blade = MeshBuilder.CreateBox(`spinnerBlade${i}`, {
        width: 0.3, height: 0.2, depth: this.spinnerRadius * 1.8
      }, this.scene)

      const angle = (i / bladeCount) * Math.PI * 2
      blade.position = this.position
      blade.rotation.y = angle
      blade.material = this.neonMaterial
      blade.parent = this.rootNode
      this.spinnerBlades.push(blade)
    }
  }

  private createPhysics(): void {
    // Static base
    this.physicsBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(this.position.x, this.position.y, this.position.z)
    )

    // Circular collider for the spinner
    this.world.createCollider(
      this.rapier.ColliderDesc.cylinder(0.1, this.spinnerRadius),
      this.physicsBody
    )
  }

  update(dt: number, ballBodies: RAPIER.RigidBody[]): void {
    if (!this.isSpawned) return

    this.launchCooldown = Math.max(0, this.launchCooldown - dt)

    // Spin animation
    this.currentRotation += dt * this.spinSpeed * (this.hasLaunched ? 8 : 2)

    // Rotate hub
    if (this.spinnerMesh) {
      this.spinnerMesh.rotation.y = this.currentRotation
    }

    // Rotate blades around center
    this.spinnerBlades.forEach((blade, i) => {
      const bladeAngle = (i / this.spinnerBlades.length) * Math.PI * 2 + this.currentRotation
      const offsetX = Math.sin(bladeAngle) * this.spinnerRadius * 0.8
      const offsetZ = Math.cos(bladeAngle) * this.spinnerRadius * 0.8

      blade.position.x = this.position.x + offsetX
      blade.position.z = this.position.z + offsetZ
      blade.rotation.y = -bladeAngle
    })

    // Check for ball contact and launch
    if (this.launchCooldown <= 0) {
      for (const ball of ballBodies) {
        const pos = ball.translation()
        const ballPos = new Vector3(pos.x, pos.y, pos.z)
        const distance = Vector3.Distance(ballPos, this.position)

        if (distance < this.spinnerRadius * 0.8 && pos.y < 1) {
          this.launchBall(ball)
          break
        }
      }
    }
  }

  private launchBall(ball: RAPIER.RigidBody): void {
    this.hasLaunched = true
    this.launchCooldown = 1.5

    // Launch in random direction with upward angle
    const angle = Math.random() * Math.PI * 2
    const launchDir = new Vector3(
      Math.cos(angle),
      0.8, // Upward component
      Math.sin(angle)
    ).normalize()

    const impulse = launchDir.scale(this.launchForce)
    ball.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true)

    // Visual flash
    if (this.spinnerMesh) {
      const originalScale = this.spinnerMesh.scaling.clone()
      this.spinnerMesh.scaling = originalScale.scale(1.5)
      setTimeout(() => {
        if (this.spinnerMesh) {
          this.spinnerMesh.scaling = originalScale
        }
      }, 100)
    }

    // Reset spin speed after launch
    setTimeout(() => {
      this.hasLaunched = false
    }, 1500)
  }

  protected updateVisualColors(): void {
    if (this.spinnerMesh) {
      this.spinnerMesh.material = this.neonMaterial
    }
    this.spinnerBlades.forEach(blade => {
      blade.material = this.neonMaterial
    })
  }
}
