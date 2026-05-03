import { MeshBuilder, Vector3, Mesh, PointLight, Color3 } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { getMaterialLibrary } from '../../materials'
import { color } from '../visual-language'
import type { JumpPadConfig } from './types'
import { PathMechanic } from './base'

export class JumpPad extends PathMechanic {
  private padMesh: Mesh | null = null
  private padBase: Mesh | null = null
  private launchArrow: Mesh | null = null
  private padLight: PointLight | null = null
  private position = Vector3.Zero()
  private launchAngle = Math.PI / 4 // 45 degrees
  private launchForce = 20
  private cooldown = 2
  private currentCooldown = 0
  private isCharging = false
  private chargeLevel = 0

  spawn(config: JumpPadConfig): void {
    if (this.isSpawned) return

    this.position = config.position.clone()
    this.launchAngle = config.launchAngle * (Math.PI / 180) // Convert to radians
    this.launchForce = config.launchForce
    this.cooldown = config.cooldown

    this.setMapColors(config.mapBaseColor, config.mapAccentColor)
    this.createVisuals()

    this.isSpawned = true
    console.log(`[JumpPad] Spawned at ${this.position}`)
  }

  despawn(): void {
    if (!this.isSpawned) return

    this.padMesh?.dispose()
    this.padBase?.dispose()
    this.launchArrow?.dispose()
    this.padLight?.dispose()

    this.padMesh = null
    this.padBase = null
    this.launchArrow = null
    this.padLight = null
    this.isSpawned = false
  }

  private createVisuals(): void {
    const matLib = getMaterialLibrary(this.scene)

    // Base platform
    this.padBase = MeshBuilder.CreateBox('jumpPadBase', {
      width: 3, height: 0.5, depth: 3
    }, this.scene)
    this.padBase.position = this.position.add(new Vector3(0, -0.25, 0))
    this.padBase.material = matLib.getBrushedMetalMaterial()
    this.padBase.parent = this.rootNode

    // Launch pad (angled surface)
    this.padMesh = MeshBuilder.CreateBox('jumpPad', {
      width: 2.5, height: 0.3, depth: 2.5
    }, this.scene)
    this.padMesh.position = this.position.clone()
    this.padMesh.rotation.x = -this.launchAngle
    this.padMesh.material = this.neonMaterial
    this.padMesh.parent = this.rootNode

    // Direction arrow
    this.launchArrow = MeshBuilder.CreateCylinder('jumpArrow', {
      diameterTop: 0,
      diameterBottom: 0.5,
      height: 1.5,
      tessellation: 4
    }, this.scene)
    this.launchArrow.position = this.position.add(new Vector3(0, 1.5, 0))
    this.launchArrow.rotation.x = this.launchAngle
    this.launchArrow.material = this.neonMaterial
    this.launchArrow.parent = this.rootNode

    // Pad light
    this.padLight = new PointLight('jumpPadLight', this.position.add(new Vector3(0, 2, 0)), this.scene)
    this.padLight.intensity = 1
    this.padLight.range = 6
    this.padLight.diffuse = color(this.mapBaseColor)
  }

  update(dt: number, ballBodies: RAPIER.RigidBody[]): void {
    if (!this.isSpawned) return

    this.currentCooldown = Math.max(0, this.currentCooldown - dt)

    // Charge animation when ready
    if (this.currentCooldown <= 0 && !this.isCharging) {
      this.chargeLevel = Math.min(1, this.chargeLevel + dt * 2)
    }

    // Pulse the light based on charge
    if (this.padLight) {
      const pulse = this.currentCooldown > 0 ? 0.3 : (0.5 + this.chargeLevel * 0.5)
      this.padLight.intensity = pulse * 2
    }

    // Scale arrow with charge
    if (this.launchArrow) {
      const scale = 1 + this.chargeLevel * 0.5
      this.launchArrow.scaling = new Vector3(scale, scale, scale)
    }

    // Check for ball contact
    if (this.currentCooldown <= 0) {
      for (const ball of ballBodies) {
        const pos = ball.translation()
        const ballPos = new Vector3(pos.x, pos.y, pos.z)
        const distance = Vector3.Distance(ballPos, this.position)

        if (distance < 1.2 && pos.y < 1 && pos.y > -0.5) {
          this.launchBall(ball)
          break
        }
      }
    }
  }

  private launchBall(ball: RAPIER.RigidBody): void {
    this.currentCooldown = this.cooldown
    this.chargeLevel = 0

    // Calculate launch vector based on pad angle
    const launchDir = new Vector3(
      0,
      Math.sin(this.launchAngle),
      Math.cos(this.launchAngle)
    ).normalize()

    const impulse = launchDir.scale(this.launchForce)
    ball.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true)

    // Visual effects
    if (this.padMesh) {
      // Flash bright
      const originalEmissive = this.neonMaterial.emissiveColor.clone()
      this.neonMaterial.emissiveColor = Color3.White()
      setTimeout(() => {
        this.neonMaterial.emissiveColor = originalEmissive
      }, 150)
    }

    // Particle burst effect would go here
    console.log('[JumpPad] Launched ball!')
  }

  protected updateVisualColors(): void {
    if (this.padMesh) {
      this.padMesh.material = this.neonMaterial
    }
    if (this.launchArrow) {
      this.launchArrow.material = this.neonMaterial
    }
    if (this.padLight) {
      this.padLight.diffuse = color(this.mapBaseColor)
    }
  }
}
