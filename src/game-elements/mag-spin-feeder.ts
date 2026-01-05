import {
  Mesh,
  MeshBuilder,
  Scene,
  Vector3,
  StandardMaterial,
  Color3,
  Scalar,
  PointLight,
  Quaternion,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import type { GameConfigType } from '../config'

export enum MagSpinState {
  IDLE,
  CATCH,
  SPIN,
  RELEASE,
  COOLDOWN,
}

export class MagSpinFeeder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private config: GameConfigType['magSpin']

  private position: Vector3
  // @ts-ignore
  private mesh: Mesh | null = null
  private ringMesh: Mesh | null = null
  private light: PointLight | null = null

  private state: MagSpinState = MagSpinState.IDLE
  private timer: number = 0

  private caughtBall: RAPIER.RigidBody | null = null
  private physicsBody: RAPIER.RigidBody | null = null

  // Callback to allow Game to play sounds/effects
  public onStateChange: ((state: MagSpinState) => void) | null = null

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    config: GameConfigType['magSpin']
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.config = config
    // Convert plain object config position to Vector3
    this.position = new Vector3(this.config.feederPosition.x, this.config.feederPosition.y, this.config.feederPosition.z)

    this.createMesh()
    this.createPhysics()
  }

  getPosition(): Vector3 {
      return this.position.clone()
  }

  private createMesh(): void {
    // 1. Create a Tube-like Visual
    // Using Cylinder with no caps for the walls
    const well = MeshBuilder.CreateCylinder("magSpinWell", {
      diameter: 3.5,
      height: 1.0,
      tessellation: 32,
      cap: Mesh.NO_CAP // Remove caps so it's hollow
    }, this.scene)
    well.position.copyFrom(this.position)

    // We need double-sided material so we see the inside.
    const wellMat = new StandardMaterial("magSpinMat", this.scene)
    wellMat.diffuseColor = Color3.Black()
    wellMat.emissiveColor = Color3.FromHexString("#001133")
    wellMat.backFaceCulling = false // Visible from inside
    well.material = wellMat

    this.mesh = well

    // Floor
    const floor = MeshBuilder.CreateCylinder("magSpinFloor", {
      diameter: 3.5,
      height: 0.1,
      tessellation: 32
    }, this.scene)
    floor.position.copyFrom(this.position)
    floor.position.y -= 0.45 // Bottom
    floor.material = wellMat

    // Spinning Ring (Visual Top)
    const ring = MeshBuilder.CreateTorus("magSpinRing", {
      diameter: 3.5,
      thickness: 0.2,
      tessellation: 32
    }, this.scene)
    ring.position.copyFrom(this.position)
    ring.position.y += 0.5

    const ringMat = new StandardMaterial("magSpinRingMat", this.scene)
    ringMat.emissiveColor = Color3.FromHexString("#00ffff")
    ring.material = ringMat

    this.ringMesh = ring

    // Light
    this.light = new PointLight("magSpinLight", this.position.add(new Vector3(0, 2, 0)), this.scene)
    this.light.diffuse = Color3.FromHexString("#00ffff")
    this.light.intensity = 0.5
    this.light.range = 10
  }

  private createPhysics(): void {
    // Create a static body for the feeder
    this.physicsBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(this.position.x, this.position.y, this.position.z)
    )

    // 1. Floor Collider
    // Visual radius is 1.75. Floor collider matches.
    this.world.createCollider(
      this.rapier.ColliderDesc.cylinder(0.1, 1.75) // HalfHeight, Radius
        .setTranslation(0, -0.4, 0),
      this.physicsBody
    )

    // 2. Wall Colliders
    // 8 Boxes arranged in a circle
    // Visual diameter: 3.5 -> Radius 1.75
    // Wall Thickness: 0.4
    // Goal: Inner face of the box should align with Visual Radius (1.75)
    // Box Center Radius = Visual Radius + (Thickness / 2) = 1.75 + 0.2 = 1.95

    const wallCount = 8
    const radius = 1.95 // Adjusted radius so inner wall is at 1.75
    const wallHeight = 1.0
    const wallThickness = 0.4
    // Calculate width to close the gaps
    // Circumference at this radius = 2 * PI * 1.95 approx 12.25
    // Width per segment = 12.25 / 8 approx 1.53
    const wallWidth = (2 * Math.PI * radius) / wallCount

    for (let i = 0; i < wallCount; i++) {
      const angle = (i / wallCount) * Math.PI * 2
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius

      const q = Quaternion.FromEulerAngles(0, -angle, 0)

      this.world.createCollider(
        // Add 0.1 overlap to prevent leaks
        this.rapier.ColliderDesc.cuboid(wallThickness / 2, wallHeight / 2, wallWidth / 2 + 0.1)
          .setTranslation(x, 0, z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
        this.physicsBody
      )
    }
  }

  update(dt: number, ballBodies: RAPIER.RigidBody[]): void {
    this.timer -= dt

    // Update Visuals
    if (this.ringMesh) {
      if (this.state === MagSpinState.SPIN) {
        this.ringMesh.rotation.y += dt * 20
      } else {
        this.ringMesh.rotation.y += dt * 1
      }
    }

    // State Machine
    switch (this.state) {
      case MagSpinState.IDLE:
        this.checkProximity(ballBodies)
        break

      case MagSpinState.CATCH:
        if (this.caughtBall) {
          const currentPos = this.caughtBall.translation()
          const targetPos = this.position.add(new Vector3(0, 0.5, 0))

          const lerpFactor = dt * 5
          const newX = Scalar.Lerp(currentPos.x, targetPos.x, lerpFactor)
          const newZ = Scalar.Lerp(currentPos.z, targetPos.z, lerpFactor)

          this.caughtBall.setNextKinematicTranslation({ x: newX, y: currentPos.y, z: newZ })

          const dist = Vector3.Distance(
            new Vector3(currentPos.x, 0, currentPos.z),
            new Vector3(targetPos.x, 0, targetPos.z)
          )
          if (dist < 0.2) {
            this.setState(MagSpinState.SPIN)
          }
        }
        break

      case MagSpinState.SPIN:
        if (this.timer <= 0) {
          this.setState(MagSpinState.RELEASE)
        }
        break

      case MagSpinState.RELEASE:
        this.setState(MagSpinState.COOLDOWN)
        break

      case MagSpinState.COOLDOWN:
        if (this.timer <= 0) {
          this.setState(MagSpinState.IDLE)
        }
        break
    }
  }

  private checkProximity(ballBodies: RAPIER.RigidBody[]): void {
    // INCREASED CATCH RADIUS to ensure capture before wall collision
    const PULL_RADIUS = this.config.catchRadius || 2.5

    for (const body of ballBodies) {
      const pos = body.translation()
      const dist = Vector3.Distance(
        new Vector3(pos.x, pos.y, pos.z),
        this.position
      )

      if (dist < PULL_RADIUS) {
        // Only capture if roughly at the same height (in the well)
        // Ball is at ~0.5. Feeder is at y=0 to 1.
        if (pos.y < 2.0) {
            this.captureBall(body)
            return
        }
      }
    }
  }

  private captureBall(body: RAPIER.RigidBody): void {
    this.caughtBall = body
    body.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true)
    this.setState(MagSpinState.CATCH)
  }

  private setState(newState: MagSpinState): void {
    this.state = newState
    this.timer = 0

    if (this.onStateChange) {
      this.onStateChange(newState)
    }

    switch (newState) {
      case MagSpinState.IDLE:
        if (this.ringMesh && this.ringMesh.material) {
           (this.ringMesh.material as StandardMaterial).emissiveColor = Color3.FromHexString("#00ffff")
        }
        if (this.light) {
          this.light.diffuse = Color3.FromHexString("#00ffff")
          this.light.intensity = 0.5
        }
        break

      case MagSpinState.CATCH:
        if (this.ringMesh && this.ringMesh.material) {
           (this.ringMesh.material as StandardMaterial).emissiveColor = Color3.FromHexString("#aa00ff")
        }
        if (this.light) {
          this.light.diffuse = Color3.FromHexString("#aa00ff")
          this.light.intensity = 1.0
        }
        break

      case MagSpinState.SPIN:
        this.timer = this.config.spinDuration
        if (this.ringMesh && this.ringMesh.material) {
           (this.ringMesh.material as StandardMaterial).emissiveColor = Color3.FromHexString("#ff00aa")
        }
        if (this.light) {
          this.light.diffuse = Color3.FromHexString("#ff00aa")
          this.light.intensity = 2.0
        }
        break

      case MagSpinState.RELEASE:
        this.releaseBall()
        break

      case MagSpinState.COOLDOWN:
        this.timer = this.config.cooldown
        if (this.ringMesh && this.ringMesh.material) {
           (this.ringMesh.material as StandardMaterial).emissiveColor = Color3.Gray()
        }
        if (this.light) {
          this.light.intensity = 0.2
        }
        break
    }
  }

  private releaseBall(): void {
    if (!this.caughtBall) return

    this.caughtBall.setBodyType(this.rapier.RigidBodyType.Dynamic, true)

    const currentPos = this.caughtBall.translation()
    // Target: Center of playfield (0, 0, 5)
    // The feeder is at x~9, z~12. Center is x=0, z=5.
    // Direction is (-9, 0, -7).
    const targetDir = new Vector3(0 - currentPos.x, 0, 5 - currentPos.z).normalize()

    const angleVariance = (Math.random() - 0.5) * this.config.releaseAngleVariance
    const cos = Math.cos(angleVariance)
    const sin = Math.sin(angleVariance)
    const newX = targetDir.x * cos - targetDir.z * sin
    const newZ = targetDir.x * sin + targetDir.z * cos

    const finalDir = new Vector3(newX, 0, newZ)
    const force = finalDir.scale(this.config.releaseForce)

    this.caughtBall.applyImpulse({ x: force.x, y: force.y, z: force.z }, true)
    this.caughtBall = null
  }
}
