/**
 * Path Mechanics Library - Dynamic Adventure Mode Interactive Elements
 *
 * Zone-specific mechanics that spawn along the ball's path:
 * - Moving gates / drawbridges
 * - Magnetic fields that pull the ball
 * - Spinning wheels / launch pads
 * - Jump pads and temporary ramps
 * - Color-changing reactive peg clusters
 *
 * All mechanics spawn/despawn based on zone triggers,
 * react to map colors and adventure state, and work
 * with existing Rapier physics.
 */

import {
  Mesh,
  MeshBuilder,
  Scene,
  Vector3,
  PBRMaterial,
  Color3,
  Scalar,
  PointLight,
  TransformNode,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { getMaterialLibrary } from '../materials'
import { color } from './visual-language'

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export interface PathMechanicConfig {
  position: Vector3
  mapBaseColor: string
  mapAccentColor: string
  isActive?: boolean
}

export interface MovingGateConfig extends PathMechanicConfig {
  gateWidth: number
  openHeight: number
  closedHeight: number
  cycleDuration: number
  startOpen?: boolean
}

export interface MagneticFieldConfig extends PathMechanicConfig {
  fieldRadius: number
  pullStrength: number
  liftForce: number
}

export interface SpinnerLauncherConfig extends PathMechanicConfig {
  spinnerRadius: number
  launchForce: number
  spinSpeed: number
}

export interface JumpPadConfig extends PathMechanicConfig {
  launchAngle: number
  launchForce: number
  cooldown: number
}

export interface ReactivePegClusterConfig extends PathMechanicConfig {
  pegCount: number
  clusterRadius: number
  activationScore: number
}

// =============================================================================
// BASE CLASS
// =============================================================================

export abstract class PathMechanic {
  protected scene: Scene
  protected world: RAPIER.World
  protected rapier: typeof RAPIER
  protected rootNode: TransformNode
  protected isSpawned = false
  protected mapBaseColor: string
  protected mapAccentColor: string
  protected neonMaterial: PBRMaterial

  constructor(scene: Scene, world: RAPIER.World, rapier: typeof RAPIER) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.rootNode = new TransformNode('mechanicRoot', scene)
    this.mapBaseColor = '#00d9ff'
    this.mapAccentColor = '#ff00ff'
    const matLib = getMaterialLibrary(scene)
    this.neonMaterial = matLib.getCabinetNeonMaterial(this.mapBaseColor)
  }

  abstract spawn(config: PathMechanicConfig): void
  abstract despawn(): void
  abstract update(dt: number, ballBodies: RAPIER.RigidBody[]): void

  setMapColors(baseColor: string, accentColor: string): void {
    this.mapBaseColor = baseColor
    this.mapAccentColor = accentColor
    const matLib = getMaterialLibrary(this.scene)
    this.neonMaterial = matLib.getCabinetNeonMaterial(baseColor)
    this.updateVisualColors()
  }

  protected abstract updateVisualColors(): void

  get isActive(): boolean {
    return this.isSpawned
  }
}

// =============================================================================
// 1. MOVING GATE / DRAWBRIDGE
// =============================================================================

export enum GateState {
  OPENING,
  OPEN,
  CLOSING,
  CLOSED,
}

export class MovingGate extends PathMechanic {
  private gateMesh: Mesh | null = null
  private gateFrameLeft: Mesh | null = null
  private gateFrameRight: Mesh | null = null
  private physicsBody: RAPIER.RigidBody | null = null
  private position = Vector3.Zero()
  private state = GateState.CLOSED
  private timer = 0
  private openHeight = 4
  private closedHeight = 0.5
  private cycleDuration = 3
  private currentHeight = 0.5
  private gateWidth = 6
  private gateLight: PointLight | null = null

  spawn(config: MovingGateConfig): void {
    if (this.isSpawned) return

    this.position = config.position.clone()
    this.gateWidth = config.gateWidth
    this.openHeight = config.openHeight
    this.closedHeight = config.closedHeight
    this.cycleDuration = config.cycleDuration
    this.currentHeight = config.startOpen ? this.openHeight : this.closedHeight
    this.state = config.startOpen ? GateState.OPEN : GateState.CLOSED

    this.setMapColors(config.mapBaseColor, config.mapAccentColor)
    this.createVisuals()
    this.createPhysics()

    this.isSpawned = true
    console.log(`[MovingGate] Spawned at ${this.position}`)
  }

  despawn(): void {
    if (!this.isSpawned) return

    this.gateMesh?.dispose()
    this.gateFrameLeft?.dispose()
    this.gateFrameRight?.dispose()
    this.gateLight?.dispose()
    if (this.physicsBody) {
      this.world.removeRigidBody(this.physicsBody)
    }

    this.gateMesh = null
    this.gateFrameLeft = null
    this.gateFrameRight = null
    this.physicsBody = null
    this.gateLight = null
    this.isSpawned = false
  }

  private createVisuals(): void {
    const matLib = getMaterialLibrary(this.scene)
    const frameMat = matLib.getChromeMaterial()

    // Gate frame posts
    this.gateFrameLeft = MeshBuilder.CreateBox('gateFrameL', {
      width: 0.8, height: 5, depth: 0.8
    }, this.scene)
    this.gateFrameLeft.position = this.position.add(new Vector3(-this.gateWidth / 2 - 0.4, 2.5, 0))
    this.gateFrameLeft.material = frameMat
    this.gateFrameLeft.parent = this.rootNode

    this.gateFrameRight = MeshBuilder.CreateBox('gateFrameR', {
      width: 0.8, height: 5, depth: 0.8
    }, this.scene)
    this.gateFrameRight.position = this.position.add(new Vector3(this.gateWidth / 2 + 0.4, 2.5, 0))
    this.gateFrameRight.material = frameMat
    this.gateFrameRight.parent = this.rootNode

    // The moving gate bar
    this.gateMesh = MeshBuilder.CreateBox('gateBar', {
      width: this.gateWidth, height: 0.4, depth: 0.6
    }, this.scene)
    this.gateMesh.position = this.position.add(new Vector3(0, this.currentHeight, 0))
    this.gateMesh.material = this.neonMaterial
    this.gateMesh.parent = this.rootNode

    // Gate status light
    this.gateLight = new PointLight('gateLight', this.position.add(new Vector3(0, 4, 0)), this.scene)
    this.gateLight.intensity = 0.8
    this.gateLight.range = 8
    this.updateLightColor()
  }

  private createPhysics(): void {
    // Kinematic body for moving gate
    this.physicsBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(this.position.x, this.position.y + this.currentHeight, this.position.z)
    )

    // Gate collider
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(this.gateWidth / 2, 0.2, 0.3),
      this.physicsBody
    )
  }

  update(dt: number, _ballBodies: RAPIER.RigidBody[]): void {
    if (!this.isSpawned || !this.physicsBody) return

    this.timer += dt

    // State machine for gate cycle
    switch (this.state) {
      case GateState.CLOSED:
        if (this.timer > this.cycleDuration) {
          this.state = GateState.OPENING
          this.timer = 0
        }
        break

      case GateState.OPENING:
        this.currentHeight = Scalar.Lerp(this.currentHeight, this.openHeight, dt * 2)
        if (Math.abs(this.currentHeight - this.openHeight) < 0.1) {
          this.currentHeight = this.openHeight
          this.state = GateState.OPEN
          this.timer = 0
        }
        this.updateGatePosition()
        break

      case GateState.OPEN:
        if (this.timer > this.cycleDuration * 0.5) {
          this.state = GateState.CLOSING
          this.timer = 0
        }
        break

      case GateState.CLOSING:
        this.currentHeight = Scalar.Lerp(this.currentHeight, this.closedHeight, dt * 3)
        if (Math.abs(this.currentHeight - this.closedHeight) < 0.1) {
          this.currentHeight = this.closedHeight
          this.state = GateState.CLOSED
          this.timer = 0
        }
        this.updateGatePosition()
        break
    }
  }

  private updateGatePosition(): void {
    if (!this.physicsBody || !this.gateMesh) return

    const newPos = { x: this.position.x, y: this.position.y + this.currentHeight, z: this.position.z }
    this.physicsBody.setNextKinematicTranslation(newPos)
    this.gateMesh.position.y = this.position.y + this.currentHeight
  }

  private updateLightColor(): void {
    if (!this.gateLight) return
    const isOpen = this.state === GateState.OPEN || this.state === GateState.OPENING
    this.gateLight.diffuse = isOpen ? Color3.Green() : Color3.FromHexString(this.mapAccentColor)
  }

  protected updateVisualColors(): void {
    if (this.gateMesh) {
      this.gateMesh.material = this.neonMaterial
    }
    this.updateLightColor()
  }
}

// =============================================================================
// 2. MAGNETIC FIELD
// =============================================================================

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
    console.log(`[MagneticField] Spawned at ${this.position}, radius: ${this.fieldRadius}`)
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

  update(dt: number, ballBodies: RAPIER.RigidBody[]): void {
    if (!this.isSpawned) return

    this.pulseTime += dt * 3

    // Animate field ring
    if (this.fieldRing) {
      this.fieldRing.rotation.y += dt * 2
      this.fieldRing.scaling = new Vector3(
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
      const ballPos = new Vector3(pos.x, pos.y, pos.z)
      const distance = Vector3.Distance(ballPos, this.position)

      if (distance < this.fieldRadius && pos.y < 3) {
        // Calculate pull direction (toward field center)
        const pullDir = this.position.subtract(ballPos).normalize()
        pullDir.y = 0 // Keep horizontal pull

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

// =============================================================================
// 3. SPINNER LAUNCHER
// =============================================================================

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

// =============================================================================
// 4. JUMP PAD
// =============================================================================

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

// =============================================================================
// 5. REACTIVE PEG CLUSTER
// =============================================================================

export enum PegState {
  INACTIVE,
  ACTIVATING,
  ACTIVE,
  DEACTIVATING,
}

export class ReactivePegCluster extends PathMechanic {
  private pegs: Mesh[] = []
  private pegLights: PointLight[] = []
  private pegStates: PegState[] = []
  private pegHits: number[] = []
  private position = Vector3.Zero()
  private clusterRadius = 3
  private pegCount = 8
  // Score awarded when cluster fully activates
  private activationScoreValue = 1000
  private clusterActive = false
  private activationLevel = 0
  private pulseTime = 0

  spawn(config: ReactivePegClusterConfig): void {
    if (this.isSpawned) return

    this.position = config.position.clone()
    this.clusterRadius = config.clusterRadius
    this.pegCount = config.pegCount
    this.activationScoreValue = config.activationScore

    this.setMapColors(config.mapBaseColor, config.mapAccentColor)
    this.createVisuals()

    this.isSpawned = true
    console.log(`[ReactivePegCluster] Spawned ${this.pegCount} pegs at ${this.position}`)
  }

  despawn(): void {
    if (!this.isSpawned) return

    this.pegs.forEach(p => p.dispose())
    this.pegLights.forEach(l => l.dispose())

    this.pegs = []
    this.pegLights = []
    this.pegStates = []
    this.pegHits = []
    this.isSpawned = false
  }

  private createVisuals(): void {
    const matLib = getMaterialLibrary(this.scene)

    for (let i = 0; i < this.pegCount; i++) {
      const angle = (i / this.pegCount) * Math.PI * 2
      const radius = this.clusterRadius * (0.5 + Math.random() * 0.5)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius

      const pegPos = this.position.add(new Vector3(x, 0, z))

      // Peg mesh
      const peg = MeshBuilder.CreateCylinder(`reactivePeg${i}`, {
        diameter: 0.4,
        height: 1.5,
        tessellation: 8
      }, this.scene)
      peg.position = pegPos
      peg.material = matLib.getPinMaterial() // Start inactive
      peg.parent = this.rootNode
      this.pegs.push(peg)

      // Peg light
      const light = new PointLight(`pegLight${i}`, pegPos.add(new Vector3(0, 1, 0)), this.scene)
      light.intensity = 0.2
      light.range = 3
      light.diffuse = Color3.Gray()
      this.pegLights.push(light)

      this.pegStates.push(PegState.INACTIVE)
      this.pegHits.push(0)
    }
  }

  update(dt: number, ballBodies: RAPIER.RigidBody[]): void {
    if (!this.isSpawned) return

    this.pulseTime += dt * 4

    // Check for ball-peg collisions
    for (let i = 0; i < this.pegs.length; i++) {
      const peg = this.pegs[i]
      const pegPos = peg.position

      for (const ball of ballBodies) {
        const pos = ball.translation()
        const ballPos = new Vector3(pos.x, pos.y, pos.z)
        const distance = Vector3.Distance(ballPos, pegPos)

        // Collision detection
        if (distance < 0.6 && Math.abs(pos.y - pegPos.y) < 1) {
          this.hitPeg(i)
        }
      }
    }

    // Update peg visuals based on state
    this.updatePegVisuals(dt)

    // Check for full cluster activation
    const activeCount = this.pegStates.filter(s => s === PegState.ACTIVE).length
    this.activationLevel = activeCount / this.pegCount

    if (this.activationLevel >= 1 && !this.clusterActive) {
      this.activateCluster()
    }
  }

  private hitPeg(index: number): void {
    if (this.pegStates[index] === PegState.INACTIVE) {
      this.pegStates[index] = PegState.ACTIVATING
      this.pegHits[index] = 1
    } else if (this.pegStates[index] === PegState.ACTIVE) {
      this.pegHits[index]++
    }
  }

  private updatePegVisuals(dt: number): void {
    const matLib = getMaterialLibrary(this.scene)

    for (let i = 0; i < this.pegs.length; i++) {
      const state = this.pegStates[i]
      const peg = this.pegs[i]
      const light = this.pegLights[i]

      switch (state) {
        case PegState.INACTIVE:
          // Dim, gray
          light.intensity = 0.2 + Math.sin(this.pulseTime + i) * 0.1
          light.diffuse = Color3.Gray()
          peg.material = matLib.getPinMaterial()
          break

        case PegState.ACTIVATING:
          // Transition to active
          light.intensity = Scalar.Lerp(light.intensity, 2, dt * 5)
          light.diffuse = Color3.Lerp(Color3.Gray(), color(this.mapBaseColor), dt * 3)

          if (light.intensity > 1.8) {
            this.pegStates[i] = PegState.ACTIVE
            peg.material = this.neonMaterial
          }
          break

        case PegState.ACTIVE:
          // Glowing, pulsing
          const pulse = 2 + Math.sin(this.pulseTime * 2 + i) * 0.5
          light.intensity = pulse
          light.diffuse = color(this.mapBaseColor)

          // Scale bump on hit
          const targetScale = 1 + this.pegHits[i] * 0.1
          peg.scaling.y = Scalar.Lerp(peg.scaling.y, targetScale, dt * 10)
          break
      }
    }
  }

  private activateCluster(): void {
    this.clusterActive = true
    console.log(`[ReactivePegCluster] FULL ACTIVATION! +${this.activationScoreValue} bonus points`)

    // All pegs flash bright
    for (let i = 0; i < this.pegs.length; i++) {
      const light = this.pegLights[i]
      light.intensity = 4
      light.diffuse = Color3.White()

      // Reset after flash
      setTimeout(() => {
        if (this.pegLights[i]) {
          light.diffuse = color(this.mapAccentColor)
        }
      }, 300)
    }

    // Reset cluster after delay
    setTimeout(() => {
      this.resetCluster()
    }, 3000)
  }

  private resetCluster(): void {
    this.clusterActive = false
    for (let i = 0; i < this.pegStates.length; i++) {
      this.pegStates[i] = PegState.INACTIVE
      this.pegHits[i] = 0
    }
    console.log('[ReactivePegCluster] Reset')
  }

  getActivationLevel(): number {
    return this.activationLevel
  }

  isFullyActive(): boolean {
    return this.clusterActive
  }

  protected updateVisualColors(): void {
    // Pegs will update on next hit/activation
    for (let i = 0; i < this.pegs.length; i++) {
      if (this.pegStates[i] === PegState.ACTIVE) {
        this.pegs[i].material = this.neonMaterial
      }
    }
  }
}

// =============================================================================
// PATH MECHANICS MANAGER - Orchestrates all mechanics
// =============================================================================

export interface ZoneTrigger {
  minZ: number
  maxZ: number
  mechanicType: 'gate' | 'magnet' | 'spinner' | 'jumppad' | 'pegs'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any
  /** Optional callback when this trigger zone is entered */
  onEnter?: () => void
  /** Optional callback when this trigger zone is exited */
  onExit?: () => void
}

export interface PathMechanicsCallbacks {
  /** Called when ball enters any mechanic zone */
  onZoneEnter?: (zoneId: string, mechanicType: string) => void
  /** Called when ball exits any mechanic zone */
  onZoneExit?: (zoneId: string, mechanicType: string) => void
  /** Called when a mechanic is triggered (e.g., ball hits jumppad) */
  onMechanicTrigger?: (mechanicType: string, position: Vector3) => void
}

export class PathMechanicsManager {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private mechanics: Map<string, PathMechanic> = new Map()
  private zoneTriggers: ZoneTrigger[] = []
  private activeZones: Set<string> = new Set()
  private mapBaseColor = '#00d9ff'
  private mapAccentColor = '#ff00ff'
  private callbacks: PathMechanicsCallbacks = {}

  constructor(scene: Scene, world: RAPIER.World, rapier: typeof RAPIER) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
  }

  setCallbacks(callbacks: PathMechanicsCallbacks): void {
    this.callbacks = callbacks
  }

  setZoneTriggers(triggers: ZoneTrigger[]): void {
    this.zoneTriggers = triggers
  }

  setMapColors(baseColor: string, accentColor: string): void {
    this.mapBaseColor = baseColor
    this.mapAccentColor = accentColor

    // Update all active mechanics
    for (const mechanic of this.mechanics.values()) {
      mechanic.setMapColors(baseColor, accentColor)
    }
  }

  update(dt: number, ballBodies: RAPIER.RigidBody[], ballZ: number): void {
    // Check zone triggers
    for (const trigger of this.zoneTriggers) {
      const zoneId = `${trigger.mechanicType}_${trigger.minZ}_${trigger.maxZ}`
      const isInZone = ballZ >= trigger.minZ && ballZ <= trigger.maxZ

      if (isInZone && !this.activeZones.has(zoneId)) {
        // Entered zone - spawn mechanic
        this.spawnMechanic(zoneId, trigger)
        this.activeZones.add(zoneId)
        
        // Trigger callbacks
        trigger.onEnter?.()
        this.callbacks.onZoneEnter?.(zoneId, trigger.mechanicType)
      } else if (!isInZone && this.activeZones.has(zoneId)) {
        // Left zone - despawn mechanic
        this.despawnMechanic(zoneId)
        this.activeZones.delete(zoneId)
        
        // Trigger callbacks
        trigger.onExit?.()
        this.callbacks.onZoneExit?.(zoneId, trigger.mechanicType)
      }
    }

    // Update all active mechanics
    for (const mechanic of this.mechanics.values()) {
      mechanic.update(dt, ballBodies)
    }
  }

  private spawnMechanic(zoneId: string, trigger: ZoneTrigger): void {
    if (this.mechanics.has(zoneId)) return

    const position = new Vector3(0, 0, (trigger.minZ + trigger.maxZ) / 2)

    let mechanic: PathMechanic | null = null

    switch (trigger.mechanicType) {
      case 'gate':
        mechanic = new MovingGate(this.scene, this.world, this.rapier)
        mechanic.spawn({
          position,
          mapBaseColor: this.mapBaseColor,
          mapAccentColor: this.mapAccentColor,
          gateWidth: 8,
          openHeight: 4,
          closedHeight: 0.5,
          cycleDuration: 4,
          startOpen: false,
          ...trigger.config,
        } as MovingGateConfig)
        break

      case 'magnet':
        mechanic = new MagneticField(this.scene, this.world, this.rapier)
        mechanic.spawn({
          position,
          mapBaseColor: this.mapBaseColor,
          mapAccentColor: this.mapAccentColor,
          fieldRadius: 5,
          pullStrength: 20,
          liftForce: 8,
          ...trigger.config,
        } as MagneticFieldConfig)
        break

      case 'spinner':
        mechanic = new SpinnerLauncher(this.scene, this.world, this.rapier)
        mechanic.spawn({
          position,
          mapBaseColor: this.mapBaseColor,
          mapAccentColor: this.mapAccentColor,
          spinnerRadius: 2.5,
          launchForce: 30,
          spinSpeed: 8,
          ...trigger.config,
        } as SpinnerLauncherConfig)
        break

      case 'jumppad':
        mechanic = new JumpPad(this.scene, this.world, this.rapier)
        mechanic.spawn({
          position,
          mapBaseColor: this.mapBaseColor,
          mapAccentColor: this.mapAccentColor,
          launchAngle: 45,
          launchForce: 25,
          cooldown: 2,
          ...trigger.config,
        } as JumpPadConfig)
        break

      case 'pegs':
        mechanic = new ReactivePegCluster(this.scene, this.world, this.rapier)
        mechanic.spawn({
          position,
          mapBaseColor: this.mapBaseColor,
          mapAccentColor: this.mapAccentColor,
          pegCount: 10,
          clusterRadius: 4,
          activationScore: 2000,
          ...trigger.config,
        } as ReactivePegClusterConfig)
        break
    }

    if (mechanic) {
      this.mechanics.set(zoneId, mechanic)
    }
  }

  private despawnMechanic(zoneId: string): void {
    const mechanic = this.mechanics.get(zoneId)
    if (mechanic) {
      mechanic.despawn()
      this.mechanics.delete(zoneId)
    }
  }

  despawnAll(): void {
    for (const mechanic of this.mechanics.values()) {
      mechanic.despawn()
    }
    this.mechanics.clear()
    this.activeZones.clear()
  }

  getActiveMechanicsCount(): number {
    return this.mechanics.size
  }
}

// Classes are already exported above, no need to re-export
