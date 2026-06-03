import { Scene, MeshBuilder, Mesh, PBRMaterial, TransformNode, Color3, StandardMaterial, Vector3 } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { COLLISION_GROUP_PRESETS } from '../game-elements/physics'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding } from '../game-elements/types'
import { INTENSITY, PALETTE, QualityTier, color, emissive } from '../game-elements/visual-language'
import type { EventBus } from '../game/event-bus'
import { ObstacleEventBusIntegration } from '../game-elements/obstacle-eventbus-integration'
import type { ZoneTriggerSystem } from '../game-elements/zone-trigger-system'

export interface BallTrapState {
  mesh: Mesh
  body: RAPIER.RigidBody
  id: string
  trapGate: Mesh
  caughtBall: RAPIER.RigidBody | null
  holdTimer: number
  holdDuration: number
  isOpen: boolean
  trapColor: string
  hitTime: number
}

export class BallTrapBuilder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private matLib: ReturnType<typeof getMaterialLibrary>
  private eventBus: ObstacleEventBusIntegration | null = null
  private zoneTriggerSystem: ZoneTriggerSystem | null = null
  private trapCounter: number = 0
  private meshes: Mesh[] = []
  private bodies: RAPIER.RigidBody[] = []
  private nodes: TransformNode[] = []
  private materials: StandardMaterial[] = []
  private qualityTier: QualityTier
  private registeredZoneIds: string[] = []
  private effectIntensity = 1.0

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    qualityTier: QualityTier = QualityTier.MEDIUM,
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.matLib = getMaterialLibrary(scene)
    this.qualityTier = qualityTier
  }

  /**
   * Set EventBus for emitting trap events
   */
  setEventBus(eventBus: EventBus | null): void {
    this.eventBus = eventBus ? new ObstacleEventBusIntegration(eventBus) : null
  }

  /**
   * Set ZoneTriggerSystem for registering trap hitbox regions
   */
  setZoneTriggerSystem(zoneTriggerSystem: ZoneTriggerSystem | null): void {
    this.zoneTriggerSystem = zoneTriggerSystem
  }

  /** Accessibility effectIntensity multiplier (0..1). Clamps hit-flash luminance. */
  setEffectIntensity(value: number): void {
    this.effectIntensity = Math.max(0, Math.min(1, value))
  }

  createBallTrap(
    x: number,
    z: number,
    colorHex: string = PALETTE.CYAN,
    scale: number = 1.0
  ): { state: BallTrapState; bindings: PhysicsBinding[] } {
    const bindings: PhysicsBinding[] = []

    const trapRoot = new TransformNode('ballTrapRoot', this.scene)
    trapRoot.position.set(x, 0.5, z)
    this.nodes.push(trapRoot)

    // Trap entrance (funnel-like using scaled cylinder)
    const trapEntrance = MeshBuilder.CreateCylinder('trapCone', {
      diameter: 1.2 * scale,
      height: 0.4,
      tessellation: this.qualityTier === QualityTier.LOW ? 8 : 16
    }, this.scene) as Mesh

    // Taper the cylinder for funnel effect via scaling
    trapEntrance.scaling.y = 0.8

    trapEntrance.parent = trapRoot
    trapEntrance.material = this.matLib.getEnhancedBumperBodyMaterial(colorHex)

    // Trap chamber (visible but won't contain ball, physics handles that) — skip on LOW
    let trapChamber: Mesh | null = null
    if (this.qualityTier !== QualityTier.LOW) {
      trapChamber = MeshBuilder.CreateSphere('trapChamber', {
        diameter: 0.9 * scale,
        segments: this.qualityTier === QualityTier.HIGH ? 16 : 8
      }, this.scene) as Mesh

      trapChamber.position.y = -0.3 * scale
      trapChamber.parent = trapRoot
      trapChamber.material = this.matLib.getEnhancedBumperBodyMaterial(colorHex)
    }

    // Gate that opens to release ball
    const gateWidth = 0.5 * scale
    const gateHeight = 0.8 * scale
    const trapGate = MeshBuilder.CreateBox('trapGate', {
      width: gateWidth,
      height: gateHeight,
      depth: 0.05
    }, this.scene) as Mesh

    trapGate.position.z = 0.5 * scale
    trapGate.parent = trapRoot

    const gateMat = new StandardMaterial('trapGateMat', this.scene)
    gateMat.emissiveColor = Color3.FromHexString(colorHex)
    gateMat.alpha = 0.6
    trapGate.material = gateMat
    this.materials.push(gateMat)

    // Physics body - trap chamber (sensor)
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.5, z)
    )

    // Trap entrance collision (funnel)
    this.world.createCollider(
      this.rapier.ColliderDesc.cone(0.6 * scale, 0.2)
        .setRestitution(0.6)
        .setFriction(0.3)
        .setCollisionGroups(COLLISION_GROUP_PRESETS.TARGET)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      body
    )

    // Trap chamber sensor (catches ball)
    this.world.createCollider(
      this.rapier.ColliderDesc.ball(0.45 * scale)
        .setTranslation(0, -0.3 * scale, 0)
        .setSensor(true)
        .setCollisionGroups(COLLISION_GROUP_PRESETS.SENSOR)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      body
    )

    const trapId = `trap-${this.trapCounter++}`

    const state: BallTrapState = {
      mesh: trapEntrance,
      body,
      id: trapId,
      trapGate,
      caughtBall: null,
      holdTimer: 0,
      holdDuration: 2.0, // Hold for 2 seconds
      isOpen: true,
      trapColor: colorHex,
      hitTime: 0,
    }

    bindings.push({ mesh: trapRoot as unknown as Mesh, rigidBody: body })

    this.meshes.push(trapEntrance, trapGate)
    if (trapChamber) this.meshes.push(trapChamber)
    this.bodies.push(body)

    // Register with ZoneTriggerSystem
    if (this.zoneTriggerSystem) {
      const zoneId = `trap-zone-${trapId}`
      this.zoneTriggerSystem.registerObstacleZone(zoneId, {
        minX: x - 0.65 * scale,
        maxX: x + 0.65 * scale,
        minZ: z - 0.65 * scale,
        maxZ: z + 0.65 * scale,
        minY: 0,
        maxY: 1.0 * scale,
      }, { color: colorHex, type: 'trap' })
      this.registeredZoneIds.push(zoneId)
    }

    return { state, bindings }
  }

  /**
   * Update trap state (release timing)
   */
  updateTrap(state: BallTrapState, dt: number): RAPIER.RigidBody | null {
    // Hit-flash decay over the trap entrance material
    if (state.hitTime > 0) {
      state.hitTime -= dt
      const mat = state.mesh.material as PBRMaterial | null
      if (mat) {
        if (state.hitTime > 0) {
          const flash = INTENSITY.BURST * (state.hitTime / 0.2) * this.effectIntensity
          mat.emissiveColor = emissive(state.trapColor, INTENSITY.NORMAL).add(color(PALETTE.WHITE).scale(flash))
        } else {
          state.hitTime = 0
          mat.emissiveColor = emissive(state.trapColor, INTENSITY.ACTIVE)
        }
      }
    }

    if (!state.caughtBall) {
      state.holdTimer = 0
      return null
    }

    // Increment hold timer
    state.holdTimer += dt

    // Check if time to release
    if (state.holdTimer >= state.holdDuration) {
      const releasedBall = state.caughtBall
      state.caughtBall = null
      state.holdTimer = 0
      state.isOpen = true

      // Visually open the gate
      if (state.trapGate) {
        state.trapGate.scaling.y = 0.1
      }

      // Emit release event (after hold duration expires)
      if (this.eventBus) {
        const pos = state.mesh.getAbsolutePosition()
        this.eventBus.emitTrapBallReleased(state.id, 'ball-released', {
          x: 0, y: 0, z: 0
        })
        this.eventBus.emitPointsAwarded(100, 'ball-released-timeout', { x: pos.x, y: pos.y, z: pos.z })
        this.eventBus.emitPlaySound('trap-release-timeout')
      }

      return releasedBall
    }

    return null
  }

  /**
   * Catch a ball in the trap
   */
  catchBall(state: BallTrapState, ball: RAPIER.RigidBody, ballPosition?: Vector3): void {
    if (!state.caughtBall) {
      state.caughtBall = ball
      state.holdTimer = 0
      state.isOpen = false
      state.hitTime = 0.2

      // Close the gate visually
      if (state.trapGate) {
        state.trapGate.scaling.y = 1.0
      }

      // Stop ball motion
      ball.setLinvel(new this.rapier.Vector3(0, -0.5, 0), true)
      ball.setAngvel(new this.rapier.Vector3(0, 0, 0), true)

      // Emit EventBus events
      if (this.eventBus) {
        const pos = ballPosition ?? state.mesh.getAbsolutePosition()
        this.eventBus.emitTrapBallCaptured(state.id, 'ball-caught', {
          x: pos.x,
          y: pos.y,
          z: pos.z
        })
        this.eventBus.emitPointsAwarded(50, 'ball-trapped')
        this.eventBus.emitPlaySound('trap-catch')
        this.eventBus.emitFlashEffect(0.3, '#ff00ff', 0.2)
      }
    }
  }

  /**
   * Release ball with boosted velocity
   */
  releaseBallWithBoost(state: BallTrapState, ball: RAPIER.RigidBody): void {
    state.hitTime = 0.2
    const boostForce = 15.0
    const boostVelocity = new this.rapier.Vector3(
      (Math.random() - 0.5) * boostForce,
      boostForce * 0.8,
      (Math.random() - 0.5) * boostForce * 0.5
    )

    ball.setLinvel(boostVelocity, true)

    // Emit EventBus events
    if (this.eventBus) {
      this.eventBus.emitTrapBallReleased(state.id, 'ball-released', {
        x: boostVelocity.x,
        y: boostVelocity.y,
        z: boostVelocity.z
      })
      this.eventBus.emitPointsAwarded(100, 'ball-released')
      this.eventBus.emitPlaySound('trap-release')
      this.eventBus.emitFlashEffect(0.4, '#ffff00', 0.3)
      this.eventBus.emitBloomEffect(0.5, 0.5)
    }
  }

  /**
   * Return all Rapier rigid bodies created by this builder.
   */
  getBodies(): RAPIER.RigidBody[] {
    return this.bodies
  }

  /**
   * Clean up all meshes and physics bodies created by this builder
   */
  dispose(): void {
    for (const mesh of this.meshes) {
      if (!mesh.isDisposed()) {
        mesh.dispose()
      }
    }
    this.meshes = []

    for (const body of this.bodies) {
      this.world.removeRigidBody(body)
    }
    this.bodies = []

    for (const mat of this.materials) {
      mat.dispose()
    }
    this.materials = []

    for (const node of this.nodes) {
      if (!node.isDisposed()) {
        node.dispose(true) // doNotRecurse — children already disposed above
      }
    }
    this.nodes = []

    for (const zoneId of this.registeredZoneIds) {
      this.zoneTriggerSystem?.unregisterObstacleZone(zoneId)
    }
    this.registeredZoneIds = []

    this.eventBus = null
    this.zoneTriggerSystem = null
  }
}
