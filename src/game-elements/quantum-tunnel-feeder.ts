import {
  Mesh,
  MeshBuilder,
  Scene,
  Vector3,
  StandardMaterial,
  Color3
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import type { GameConfigType } from '../config'

export enum QuantumTunnelState {
  IDLE = 0,
  CAPTURE = 1,
  TRANSPORT = 2,
  EJECT = 3,
  COOLDOWN = 4
}

export type QuantumTunnelCallback = (state: QuantumTunnelState) => void

export class QuantumTunnelFeeder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private config: GameConfigType['quantumTunnel']

  private inputMesh: Mesh
  private outputMesh: Mesh
  private inputSensor: RAPIER.RigidBody | null = null

  private state: QuantumTunnelState = QuantumTunnelState.IDLE
  private stateTimer: number = 0
  private capturedBall: RAPIER.RigidBody | null = null

  public onStateChange: QuantumTunnelCallback | null = null

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    config: GameConfigType['quantumTunnel']
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.config = config

    // Create Visuals
    const inputPos = new Vector3(config.inputPosition.x, config.inputPosition.y, config.inputPosition.z)
    const outputPos = new Vector3(config.outputPosition.x, config.outputPosition.y, config.outputPosition.z)

    // Input Portal (Right Wall)
    this.inputMesh = this.createPortalMesh("tunnelInput", inputPos, new Color3(0.1, 0, 0.2), -Math.PI / 2) // Face Left (-X)

    // Output Portal (Left Wall)
    this.outputMesh = this.createPortalMesh("tunnelOutput", outputPos, new Color3(0.1, 0.1, 0.1), Math.PI / 2) // Face Right (+X)

    // Physics Sensor (Input Only)
    this.createSensor(inputPos)
  }

  private createPortalMesh(name: string, pos: Vector3, color: Color3, rotY: number): Mesh {
    // Outer Ring
    const ring = MeshBuilder.CreateTorus(name + "_ring", { diameter: 2.5, thickness: 0.2, tessellation: 32 }, this.scene)
    ring.position.copyFrom(pos)
    ring.rotation.y = rotY

    const ringMat = new StandardMaterial(name + "_ringMat", this.scene)
    ringMat.emissiveColor = color
    ringMat.diffuseColor = Color3.Black()
    ring.material = ringMat

    // Inner Event Horizon (Disc)
    const disc = MeshBuilder.CreateDisc(name + "_disc", { radius: 1.1, tessellation: 32 }, this.scene)
    disc.parent = ring
    disc.rotation.y = 0 // Relative to parent

    const discMat = new StandardMaterial(name + "_discMat", this.scene)
    discMat.emissiveColor = color.scale(0.5)
    discMat.diffuseColor = Color3.Black()
    discMat.alpha = 0.8
    disc.material = discMat

    return ring
  }

  private createSensor(pos: Vector3): void {
    const sensorBodyDesc = this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
    this.inputSensor = this.world.createRigidBody(sensorBodyDesc)

    const colliderDesc = this.rapier.ColliderDesc.ball(this.config.inputRadius)
      .setSensor(true)
      .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS)

    this.world.createCollider(colliderDesc, this.inputSensor)
  }

  public update(dt: number, ballBodies: RAPIER.RigidBody[]): void {
    this.stateTimer += dt

    // Portal Animation (Spinning visuals)
    this.inputMesh.rotation.z += dt * 1.0
    this.outputMesh.rotation.z -= dt * 1.0

    switch (this.state) {
      case QuantumTunnelState.IDLE:
        this.updateIdle(ballBodies)
        break
      case QuantumTunnelState.CAPTURE:
        this.updateCapture(dt)
        break
      case QuantumTunnelState.TRANSPORT:
        this.updateTransport(dt)
        break
      case QuantumTunnelState.EJECT:
        this.updateEject() // Instant transition usually
        break
      case QuantumTunnelState.COOLDOWN:
        this.updateCooldown()
        break
    }
  }

  private updateIdle(ballBodies: RAPIER.RigidBody[]): void {
    if (!this.inputSensor) return

    const sensorHandle = this.inputSensor.collider(0)

    for (const ball of ballBodies) {
      const ballHandle = ball.collider(0)
      if (this.world.intersectionPair(sensorHandle, ballHandle)) {
        this.capturedBall = ball
        this.transitionTo(QuantumTunnelState.CAPTURE)
        return
      }
    }

    // Pulse Input Visual
    const pulse = 0.5 + Math.sin(performance.now() * 0.002) * 0.2
    this.setPortalEmissive(this.inputMesh, new Color3(0.5, 0, 1.0).scale(pulse))
  }

  private updateCapture(dt: number): void {
    if (!this.capturedBall) {
        this.transitionTo(QuantumTunnelState.IDLE)
        return
    }

    // Move ball to center of input portal
    // Lerp translation?
    // Shrink check happens in Game loop via visual sync?
    // No, we need to handle scale if possible, but Rapier balls don't scale.
    // We can only move it.
    // We rely on Game loop syncing mesh to physics.
    // We can't easily scale the mesh from here without a reference to the mesh.
    // BUT, we can just teleport it away and hide it?

    // For now, let's just hold it in place (Kinematic) and transition.
    if (this.stateTimer < 0.5) {
        // Pull towards center
        const target = this.config.inputPosition
        const current = this.capturedBall.translation()
        const next = Vector3.Lerp(
            new Vector3(current.x, current.y, current.z),
            new Vector3(target.x, target.y, target.z),
            dt * 10
        )
        this.capturedBall.setNextKinematicTranslation(next)
    } else {
        this.transitionTo(QuantumTunnelState.TRANSPORT)
    }
  }

  private updateTransport(_dt: number): void {
    void _dt;
    // Hide ball effectively (move far away or scale 0)
    // Since we don't have mesh access here easily (unless we ask Game),
    // we'll just teleport it to a holding cell (e.g. far below)
    if (this.capturedBall) {
        this.capturedBall.setNextKinematicTranslation({ x: 0, y: -100, z: 0 })
    }

    // Charge Output Portal
    const charge = Math.min(this.stateTimer / this.config.transportDelay, 1.0)
    const color = Color3.Lerp(new Color3(0.1, 0.1, 0.1), new Color3(0, 1.0, 1.0), charge)
    this.setPortalEmissive(this.outputMesh, color)

    if (this.stateTimer >= this.config.transportDelay) {
        this.transitionTo(QuantumTunnelState.EJECT)
    }
  }

  private updateEject(_dt: number = 0): void {
    void _dt;
    if (!this.capturedBall) {
        this.transitionTo(QuantumTunnelState.IDLE)
        return
    }

    const outPos = this.config.outputPosition

    // 1. Move to Output
    this.capturedBall.setTranslation({ x: outPos.x, y: outPos.y, z: outPos.z }, true)

    // 2. Restore Physics
    this.capturedBall.setBodyType(this.rapier.RigidBodyType.Dynamic, true)

    // 3. Apply Impulse (Towards Center)
    // Center is roughly 0,0,0. Left Wall is -11.5. Impulse +X.
    // Let's aim slightly randomly?
    // Impulse 25.0
    const impulse = new Vector3(this.config.ejectImpulse, 0, 0)

    // Add some variance z?
    impulse.z += (Math.random() - 0.5) * 5.0

    this.capturedBall.applyImpulse(impulse, true)

    // 4. Release ref
    this.capturedBall = null

    // 5. Flash Output
    this.setPortalEmissive(this.outputMesh, new Color3(1, 1, 1))

    this.transitionTo(QuantumTunnelState.COOLDOWN)
  }

  private updateCooldown(): void {
    // Fade output
    const fade = 1.0 - Math.min(this.stateTimer / 1.0, 1.0)
    this.setPortalEmissive(this.outputMesh, new Color3(0, 1.0, 1.0).scale(fade))

    if (this.stateTimer >= this.config.cooldown) {
        this.setPortalEmissive(this.outputMesh, new Color3(0.1, 0.1, 0.1)) // Off
        this.transitionTo(QuantumTunnelState.IDLE)
    }
  }

  private transitionTo(newState: QuantumTunnelState): void {
    this.state = newState
    this.stateTimer = 0
    if (this.onStateChange) this.onStateChange(newState)

    // State Entry Logic
    if (newState === QuantumTunnelState.CAPTURE && this.capturedBall) {
        this.capturedBall.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true)
    }
  }

  private setPortalEmissive(portal: Mesh, color: Color3): void {
      // Assuming structure: portal (Torus) -> children[0] (Disc)
      const ringMat = portal.material as StandardMaterial
      if (ringMat) ringMat.emissiveColor = color

      const disc = portal.getChildren()[0] as Mesh
      if (disc) {
          const discMat = disc.material as StandardMaterial
          if (discMat) discMat.emissiveColor = color.scale(0.8)
      }
  }

  public getPosition(): Vector3 {
      return this.inputMesh.position
  }
}
