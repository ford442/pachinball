import { Scene, MeshBuilder, Mesh, TransformNode, Color3, StandardMaterial } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding } from '../game-elements/types'
import { PALETTE } from '../game-elements/visual-language'

export interface BallTrapState {
  mesh: Mesh
  body: RAPIER.RigidBody
  trapGate: Mesh
  caughtBall: RAPIER.RigidBody | null
  holdTimer: number
  holdDuration: number
  isOpen: boolean
  trapColor: string
}

export class BallTrapBuilder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private matLib: ReturnType<typeof getMaterialLibrary>

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.matLib = getMaterialLibrary(scene)
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

    // Trap entrance (funnel-like using scaled cylinder)
    const trapEntrance = MeshBuilder.CreateCylinder('trapCone', {
      diameter: 1.2 * scale,
      height: 0.4,
      tessellation: 16
    }, this.scene) as Mesh

    // Taper the cylinder for funnel effect via scaling
    trapEntrance.scaling.y = 0.8

    trapEntrance.parent = trapRoot
    trapEntrance.material = this.matLib.getEnhancedBumperBodyMaterial(colorHex)

    // Trap chamber (visible but won't contain ball, physics handles that)
    const trapChamber = MeshBuilder.CreateSphere('trapChamber', {
      diameter: 0.9 * scale,
      segments: 16
    }, this.scene) as Mesh

    trapChamber.position.y = -0.3 * scale
    trapChamber.parent = trapRoot
    trapChamber.material = this.matLib.getEnhancedBumperBodyMaterial(colorHex)

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

    // Physics body - trap chamber (sensor)
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.5, z)
    )

    // Trap entrance collision (funnel)
    this.world.createCollider(
      this.rapier.ColliderDesc.cone(0.6 * scale, 0.2)
        .setRestitution(0.6)
        .setFriction(0.3)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      body
    )

    // Trap chamber sensor (catches ball)
    this.world.createCollider(
      this.rapier.ColliderDesc.ball(0.45 * scale)
        .setTranslation(0, -0.3 * scale, 0)
        .setSensor(true)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      body
    )

    const state: BallTrapState = {
      mesh: trapEntrance,
      body,
      trapGate,
      caughtBall: null,
      holdTimer: 0,
      holdDuration: 2.0, // Hold for 2 seconds
      isOpen: true,
      trapColor: colorHex
    }

    bindings.push({ mesh: trapRoot as unknown as Mesh, rigidBody: body })

    return { state, bindings }
  }

  /**
   * Update trap state (release timing)
   */
  updateTrap(state: BallTrapState, dt: number): RAPIER.RigidBody | null {
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

      return releasedBall
    }

    return null
  }

  /**
   * Catch a ball in the trap
   */
  catchBall(state: BallTrapState, ball: RAPIER.RigidBody): void {
    if (!state.caughtBall) {
      state.caughtBall = ball
      state.holdTimer = 0
      state.isOpen = false

      // Close the gate visually
      if (state.trapGate) {
        state.trapGate.scaling.y = 1.0
      }

      // Stop ball motion
      ball.setLinvel(new this.rapier.Vector3(0, -0.5, 0), true)
      ball.setAngvel(new this.rapier.Vector3(0, 0, 0), true)
    }
  }

  /**
   * Release ball with boosted velocity
   */
  releaseBallWithBoost(_state: BallTrapState, ball: RAPIER.RigidBody): void {
    const boostForce = 15.0
    const boostVelocity = new this.rapier.Vector3(
      (Math.random() - 0.5) * boostForce,
      boostForce * 0.8,
      (Math.random() - 0.5) * boostForce * 0.5
    )

    ball.setLinvel(boostVelocity, true)
  }
}
