import { Scene, MeshBuilder, Mesh, TransformNode, Vector3 } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding } from '../game-elements/types'
import { PALETTE, QualityTier } from '../game-elements/visual-language'
import type { EventBus } from '../game/event-bus'
import { ObstacleEventBusIntegration } from '../game-elements/obstacle-eventbus-integration'
import type { ZoneTriggerSystem } from '../game-elements/zone-trigger-system'

export interface SpinnerBumperVisual {
  mesh: Mesh
  body: RAPIER.RigidBody
  id: string
  rotationSpeed: number
  targetRotationSpeed: number
  angularVelocity: number
  totalRotations: number
}

export class SpinnerBumperBuilder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private matLib: ReturnType<typeof getMaterialLibrary>
  private eventBus: ObstacleEventBusIntegration | null = null
  private zoneTriggerSystem: ZoneTriggerSystem | null = null
  private spinnerCounter: number = 0
  private meshes: Mesh[] = []
  private bodies: RAPIER.RigidBody[] = []
  private qualityTier: QualityTier
  private registeredZoneIds: string[] = []

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
   * Set EventBus for emitting spinner events
   */
  setEventBus(eventBus: EventBus | null): void {
    this.eventBus = eventBus ? new ObstacleEventBusIntegration(eventBus) : null
  }

  /**
   * Set ZoneTriggerSystem for registering spinner hitbox regions
   */
  setZoneTriggerSystem(zoneTriggerSystem: ZoneTriggerSystem | null): void {
    this.zoneTriggerSystem = zoneTriggerSystem
  }

  createSpinnerBumper(
    x: number,
    z: number,
    colorHex: string = PALETTE.CYAN,
    scale: number = 1.0
  ): { mesh: Mesh; body: RAPIER.RigidBody; visual: SpinnerBumperVisual; bindings: PhysicsBinding[] } {
    const bindings: PhysicsBinding[] = []

    // Create root for the spinner assembly
    const spinnerRoot = new TransformNode('spinnerRoot', this.scene)
    spinnerRoot.position.set(x, 0.5, z)

    // Main rotating disc
    const spinnerMesh = MeshBuilder.CreateCylinder('spinnerDisc', {
      diameter: 1.2 * scale,
      height: 0.3,
      tessellation: this.qualityTier === QualityTier.LOW ? 12 : 32
    }, this.scene) as Mesh

    spinnerMesh.parent = spinnerRoot
    spinnerMesh.material = this.matLib.getEnhancedBumperBodyMaterial(colorHex)

    // Decorative rim (skip on LOW quality)
    let rimMesh: Mesh | null = null
    if (this.qualityTier !== QualityTier.LOW) {
      rimMesh = MeshBuilder.CreateTorus('spinnerRim', {
        diameter: 1.4 * scale,
        thickness: 0.06 * scale,
        tessellation: this.qualityTier === QualityTier.HIGH ? 32 : 16
      }, this.scene) as Mesh

      rimMesh.parent = spinnerRoot
      rimMesh.material = this.matLib.getEnhancedBumperRingMaterial(colorHex)
    }

    // Rotating paddles/fins (3 evenly spaced) — skip on LOW quality
    const paddleCount = this.qualityTier === QualityTier.LOW ? 2 : 3
    const paddleMat = this.matLib.getEnhancedBumperBodyMaterial(colorHex)

    for (let i = 0; i < paddleCount; i++) {
      const angle = (Math.PI * 2 / paddleCount) * i
      const paddle = MeshBuilder.CreateBox('spinnerPaddle', {
        width: 0.3 * scale,
        depth: 0.5 * scale,
        height: 0.15 * scale
      }, this.scene) as Mesh

      paddle.rotation.z = angle
      paddle.position.x = Math.cos(angle) * 0.4 * scale
      paddle.position.z = Math.sin(angle) * 0.4 * scale
      paddle.parent = spinnerRoot
      paddle.material = paddleMat
      this.meshes.push(paddle)
    }

    // Physics body - disc shape
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.5, z)
    )

    // Main collision disc
    this.world.createCollider(
      this.rapier.ColliderDesc.cylinder(0.15, 0.6 * scale)
        .setRestitution(0.88)
        .setFriction(0.05)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      body
    )

    const spinnerId = `spinner-${this.spinnerCounter++}`

    const visual: SpinnerBumperVisual = {
      mesh: spinnerMesh,
      body,
      id: spinnerId,
      rotationSpeed: 0,
      targetRotationSpeed: 0,
      angularVelocity: 0,
      totalRotations: 0
    }

    bindings.push({ mesh: spinnerRoot as unknown as Mesh, rigidBody: body })

    this.meshes.push(spinnerMesh)
    if (rimMesh) this.meshes.push(rimMesh)
    this.bodies.push(body)

    // Register with ZoneTriggerSystem
    if (this.zoneTriggerSystem) {
      const zoneId = `spinner-zone-${spinnerId}`
      this.zoneTriggerSystem.registerObstacleZone(zoneId, {
        minX: x - 0.7 * scale,
        maxX: x + 0.7 * scale,
        minZ: z - 0.7 * scale,
        maxZ: z + 0.7 * scale,
        minY: 0,
        maxY: 1.0 * scale,
      }, { color: colorHex, type: 'spinner' })
      this.registeredZoneIds.push(zoneId)
    }

    return {
      mesh: spinnerMesh,
      body,
      visual,
      bindings
    }
  }

  /**
   * Update spinner rotation each frame
   */
  updateSpinner(visual: SpinnerBumperVisual, dt: number): void {
    // Smoothly accelerate rotation toward target
    const accelerationRate = 25.0
    visual.rotationSpeed += (visual.targetRotationSpeed - visual.rotationSpeed) * accelerationRate * dt

    // Apply friction/deceleration when not actively spinning
    const decelerationRate = 8.0
    if (visual.targetRotationSpeed === 0) {
      visual.rotationSpeed *= Math.exp(-decelerationRate * dt)
    }

    // Clamp speed
    visual.rotationSpeed = Math.max(-20, Math.min(20, visual.rotationSpeed))

    // Apply rotation to mesh
    if (visual.mesh) {
      visual.mesh.rotation.y += visual.rotationSpeed * dt

      // Track full rotations and emit event when complete
      const prevRotations = visual.totalRotations
      visual.totalRotations += (visual.rotationSpeed * dt) / (Math.PI * 2)
      const completedRotations = Math.floor(visual.totalRotations) - Math.floor(prevRotations)

      if (completedRotations > 0 && this.eventBus) {
        this.eventBus.emitSpinnerFullRotation(visual.id, completedRotations)
      }

      // Emit rotation progress event
      if (this.eventBus && visual.rotationSpeed !== 0) {
        const rotationProgress = (visual.mesh.rotation.y % (Math.PI * 2)) / (Math.PI * 2)
        this.eventBus.emitSpinnerRotation(visual.id, Math.abs(visual.rotationSpeed), rotationProgress)
      }
    }
  }

  /**
   * Trigger spinner when hit by ball
   */
  triggerSpin(visual: SpinnerBumperVisual, impactForce: number, ballPosition?: Vector3): void {
    // Impact force determines spin intensity
    const spinIntensity = Math.min(impactForce / 20, 1.0)
    visual.targetRotationSpeed = 15.0 * spinIntensity * (Math.random() < 0.5 ? 1 : -1)

    // Emit hit event
    if (this.eventBus) {
      const pos = ballPosition ?? visual.mesh.getAbsolutePosition()
      this.eventBus.emitSpinnerHit(visual.id, {
        x: pos.x,
        y: pos.y,
        z: pos.z
      }, impactForce)

      // Award points for spinner hit
      this.eventBus.emitPointsAwarded(100, 'spinner-hit')

      // Play sound and visual effect
      this.eventBus.emitPlaySound('bump-spinner')
      this.eventBus.emitFlashEffect(0.4, '#00ffff', 0.2)
    }
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

    for (const zoneId of this.registeredZoneIds) {
      this.zoneTriggerSystem?.unregisterObstacleZone(zoneId)
    }
    this.registeredZoneIds = []

    this.eventBus = null
    this.zoneTriggerSystem = null
  }
}
