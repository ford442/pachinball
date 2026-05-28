import { Scene, MeshBuilder, Mesh, PBRMaterial, TransformNode, Vector3 } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding } from '../game-elements/types'
import { INTENSITY, PALETTE, QualityTier, color, emissive } from '../game-elements/visual-language'
import type { EventBus } from '../game/event-bus'
import { ObstacleEventBusIntegration } from '../game-elements/obstacle-eventbus-integration'
import type { ZoneTriggerSystem } from '../game-elements/zone-trigger-system'

export type GateAnimationType = 'slide' | 'rotate' | 'lift'

export interface MovingGateState {
  mesh: Mesh
  collideMesh: Mesh
  body: RAPIER.RigidBody
  isOpen: boolean
  openTimer: number
  openDuration: number
  animationType: GateAnimationType
  animationProgress: number
  basePosition: Vector3
  baseRotation: Vector3
  openPosition?: Vector3
  openRotation?: Vector3
  slideAxis: 'x' | 'y' | 'z'
  slideDistance: number
  gateColor: string
  hitTime: number
}

export class MovingGateBuilder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private matLib: ReturnType<typeof getMaterialLibrary>
  private eventBus: ObstacleEventBusIntegration | null = null
  private zoneTriggerSystem: ZoneTriggerSystem | null = null
  private meshes: Mesh[] = []
  private bodies: RAPIER.RigidBody[] = []
  private nodes: TransformNode[] = []
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
   * Set EventBus for emitting gate events
   */
  setEventBus(eventBus: EventBus | null): void {
    this.eventBus = eventBus ? new ObstacleEventBusIntegration(eventBus) : null
  }

  /**
   * Set ZoneTriggerSystem for registering gate hitbox regions
   */
  setZoneTriggerSystem(zoneTriggerSystem: ZoneTriggerSystem | null): void {
    this.zoneTriggerSystem = zoneTriggerSystem
  }

  /** Accessibility effectIntensity multiplier (0..1). Clamps hit-flash luminance. */
  setEffectIntensity(value: number): void {
    this.effectIntensity = Math.max(0, Math.min(1, value))
  }

  /**
   * Create a moving gate
   */
  createMovingGate(
    x: number,
    z: number,
    colorHex: string = PALETTE.CYAN,
    scale: number = 1.0,
    animationType: GateAnimationType = 'slide',
    width: number = 2.0,
    height: number = 1.5
  ): { state: MovingGateState; bindings: PhysicsBinding[] } {
    const bindings: PhysicsBinding[] = []

    const gateRoot = new TransformNode('gateRoot', this.scene)
    gateRoot.position.set(x, 0.75 * scale, z)
    this.nodes.push(gateRoot)

    // Main gate mesh (wall/barrier)
    const gateMesh = MeshBuilder.CreateBox('gateMesh', {
      width: width * scale,
      height: height * scale,
      depth: 0.2 * scale
    }, this.scene) as Mesh

    gateMesh.parent = gateRoot
    gateMesh.material = this.matLib.getEnhancedBumperBodyMaterial(colorHex)

    // Collision mesh (updates with animation) — skip visible collision mesh on LOW, use gateMesh directly
    let collideMesh: Mesh
    if (this.qualityTier === QualityTier.LOW) {
      collideMesh = gateMesh
    } else {
      collideMesh = MeshBuilder.CreateBox('gateCollider', {
        width: width * scale,
        height: height * scale,
        depth: 0.2 * scale
      }, this.scene) as Mesh

      collideMesh.parent = gateRoot
      collideMesh.isVisible = false
    }

    // Physics body - gate barrier
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.75 * scale, z)
    )

    // Collider for gate
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(width * scale / 2, height * scale / 2, 0.1 * scale)
        .setRestitution(0.6)
        .setFriction(0.3)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      body
    )

    const basePos = new Vector3(gateRoot.position.x, gateRoot.position.y, gateRoot.position.z)
    const baseRot = new Vector3(gateRoot.rotation.x, gateRoot.rotation.y, gateRoot.rotation.z)

    const state: MovingGateState = {
      mesh: gateMesh,
      collideMesh,
      body,
      isOpen: false,
      openTimer: 0,
      openDuration: 3.0, // Open for 3 seconds
      animationType,
      animationProgress: 0,
      basePosition: basePos,
      baseRotation: baseRot,
      slideAxis: 'y',
      slideDistance: 1.5 * scale,
      gateColor: colorHex,
      hitTime: 0,
    }

    bindings.push({ mesh: gateRoot as unknown as Mesh, rigidBody: body })

    this.meshes.push(gateMesh)
    if (collideMesh !== gateMesh) this.meshes.push(collideMesh)
    this.bodies.push(body)

    // Register with ZoneTriggerSystem
    if (this.zoneTriggerSystem) {
      const zoneId = `gate-zone-${body.handle.toString()}`
      this.zoneTriggerSystem.registerObstacleZone(zoneId, {
        minX: x - (width * scale) / 2,
        maxX: x + (width * scale) / 2,
        minZ: z - 0.15 * scale,
        maxZ: z + 0.15 * scale,
        minY: 0,
        maxY: height * scale,
      }, { color: colorHex, type: 'gate' })
      this.registeredZoneIds.push(zoneId)
    }

    return { state, bindings }
  }

  /**
   * Open the gate with animation
   */
  openGate(state: MovingGateState, duration: number = 0.5): void {
    state.isOpen = true
    state.openTimer = 0
    state.openDuration = 3.0 // Stay open for 3 seconds
    state.hitTime = 0.2

    // Emit events
    if (this.eventBus) {
      const pos = state.mesh.getAbsolutePosition()
      this.eventBus.emitGateTriggered(state.body.handle.toString(), { x: pos.x, y: pos.y, z: pos.z })
      this.eventBus.emitGateOpened(state.body.handle.toString(), state.openDuration)
      this.eventBus.emitGateStateChanged(state.body.handle.toString(), true)
      this.eventBus.emitPointsAwarded(25, 'gate-opened', { x: pos.x, y: pos.y, z: pos.z })
      this.eventBus.emitPlaySound('gate-open')
    }

    // Animate opening
    this.animateGateOpening(state, duration)
  }

  /**
   * Close the gate with animation
   */
  closeGate(state: MovingGateState, duration: number = 0.5): void {
    state.isOpen = false
    state.animationProgress = 0

    // Emit events
    if (this.eventBus) {
      this.eventBus.emitGateClosed(state.body.handle.toString())
      this.eventBus.emitGateStateChanged(state.body.handle.toString(), false)
    }

    // Animate closing
    this.animateGateClosing(state, duration)
  }

  /**
   * Animate gate opening based on type
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private animateGateOpening(state: MovingGateState, _duration?: number): void {
    if (state.animationType === 'slide') {
      // Slide gate up/down based on axis
      let targetX = state.basePosition.x
      let targetY = state.basePosition.y
      let targetZ = state.basePosition.z

      if (state.slideAxis === 'y') {
        targetY += state.slideDistance
      } else if (state.slideAxis === 'x') {
        targetX += state.slideDistance
      } else if (state.slideAxis === 'z') {
        targetZ += state.slideDistance
      }
      state.openPosition = new Vector3(targetX, targetY, targetZ)
    } else if (state.animationType === 'rotate') {
      // Rotate gate open (around Y axis)
      state.openRotation = new Vector3(
        state.baseRotation.x,
        state.baseRotation.y + Math.PI / 2,
        state.baseRotation.z
      )
    } else if (state.animationType === 'lift') {
      // Lift gate up
      state.openPosition = new Vector3(
        state.basePosition.x,
        state.basePosition.y + state.slideDistance,
        state.basePosition.z
      )
    }
  }

  /**
   * Animate gate closing
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private animateGateClosing(state: MovingGateState, _duration?: number): void {
    // Reset to base position/rotation
    const root = state.mesh.parent as TransformNode
    if (root) {
      root.position = state.basePosition
      root.rotation = state.baseRotation
    }
  }

  /**
   * Update gate animation and timing
   */
  updateGate(state: MovingGateState, dt: number): void {
    // Hit-flash decay over the gate panel material
    if (state.hitTime > 0) {
      state.hitTime -= dt
      const mat = state.mesh.material as PBRMaterial | null
      if (mat) {
        if (state.hitTime > 0) {
          const flash = INTENSITY.BURST * (state.hitTime / 0.2) * this.effectIntensity
          mat.emissiveColor = emissive(state.gateColor, INTENSITY.NORMAL).add(color(PALETTE.WHITE).scale(flash))
        } else {
          state.hitTime = 0
          mat.emissiveColor = emissive(state.gateColor, INTENSITY.ACTIVE)
        }
      }
    }

    const root = state.mesh.parent as TransformNode
    if (!root) return

    if (state.isOpen) {
      state.openTimer += dt

      // Animate to open position
      if (state.animationType === 'slide' || state.animationType === 'lift') {
        if (state.openPosition) {
          const progress = Math.min(state.openTimer / 0.5, 1.0) // 0.5s animation
          const currentPos = Vector3.Lerp(state.basePosition, state.openPosition, progress)
          root.position = currentPos
        }
      } else if (state.animationType === 'rotate') {
        if (state.openRotation) {
          const progress = Math.min(state.openTimer / 0.5, 1.0)
          root.rotation.y = state.baseRotation.y + (state.openRotation.y - state.baseRotation.y) * progress
        }
      }

      // Check if time to close
      if (state.openTimer >= state.openDuration) {
        this.closeGate(state, 0.5)
      }
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
