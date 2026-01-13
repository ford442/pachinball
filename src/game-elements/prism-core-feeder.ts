import {
  Mesh,
  MeshBuilder,
  Scene,
  Vector3,
  StandardMaterial,
  Color3,
  PointLight,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import type { GameConfigType } from '../config'

export enum PrismCoreState {
  IDLE,
  LOCKED_1,
  LOCKED_2,
  OVERLOAD, // Multiball Start
}

export class PrismCoreFeeder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private config: GameConfigType['prismCore']

  private position: Vector3
  private outerMesh: Mesh | null = null
  private innerMesh: Mesh | null = null
  private light: PointLight | null = null

  private state: PrismCoreState = PrismCoreState.IDLE
  private caughtBalls: RAPIER.RigidBody[] = []
  private visualRotationSpeed: number = 0.5

  // Callback to communicate with Game
  public onStateChange: ((state: PrismCoreState, ballCount: number) => void) | null = null

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    config: GameConfigType['prismCore']
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.config = config
    this.position = new Vector3(config.prismPosition.x, config.prismPosition.y, config.prismPosition.z)

    this.createVisuals()
    this.createPhysics()
  }

  getPosition(): Vector3 {
      return this.position.clone()
  }

  private createVisuals(): void {
    // 1. Inner "Core" (The holding chamber)
    this.innerMesh = MeshBuilder.CreatePolyhedron("prismCoreInner", {
        type: 1, // Octahedron
        size: 1.0
    }, this.scene)
    this.innerMesh.position.copyFrom(this.position)

    const innerMat = new StandardMaterial("prismInnerMat", this.scene)
    innerMat.emissiveColor = Color3.Green()
    innerMat.diffuseColor = Color3.Black()
    innerMat.alpha = 0.8
    this.innerMesh.material = innerMat

    // 2. Outer "Shell" (Rotating shards)
    this.outerMesh = MeshBuilder.CreateCylinder("prismCoreOuter", {
        diameterTop: 2.5,
        diameterBottom: 1.5,
        height: 2.5,
        tessellation: 6 // Hexagonal
    }, this.scene)
    this.outerMesh.position.copyFrom(this.position)
    this.outerMesh.rotation.z = Math.PI / 4 // Tilt slightly

    const outerMat = new StandardMaterial("prismOuterMat", this.scene)
    outerMat.diffuseColor = Color3.FromHexString("#003300")
    outerMat.alpha = 0.3
    outerMat.wireframe = true
    this.outerMesh.material = outerMat

    // 3. Light Source
    this.light = new PointLight("prismLight", this.position.add(new Vector3(0, 2, 0)), this.scene)
    this.light.diffuse = Color3.Green()
    this.light.intensity = 1.0
    this.light.range = 10
  }

  private createPhysics(): void {
    // We need a static body for the structure, but we want balls to pass through the capture zone freely
    // until they are "caught".
    // We can use a Sensor for the capture zone.

    // Create a Sensor
    const bodyDesc = this.rapier.RigidBodyDesc.fixed()
        .setTranslation(this.position.x, this.position.y, this.position.z)
    const body = this.world.createRigidBody(bodyDesc)

    // Capture Radius sensor
    const colliderDesc = this.rapier.ColliderDesc.cylinder(1.0, this.config.captureRadius)
        .setSensor(true)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS)

    this.world.createCollider(colliderDesc, body)
  }

  update(dt: number, ballBodies: RAPIER.RigidBody[]): void {
    // Update Rotation
    if (this.innerMesh) {
        this.innerMesh.rotation.y += this.visualRotationSpeed * dt
        this.innerMesh.rotation.x += this.visualRotationSpeed * dt * 0.5
    }
    if (this.outerMesh) {
        this.outerMesh.rotation.y -= this.visualRotationSpeed * dt * 0.5
    }

    // Check Capture Logic only if not Overloaded
    if (this.cooldownTimer > 0) {
        this.cooldownTimer -= dt
    }

    if (this.state !== PrismCoreState.OVERLOAD && this.cooldownTimer <= 0) {
        this.checkCapture(ballBodies)
    }
  }

  private checkCapture(ballBodies: RAPIER.RigidBody[]): void {
      for (const body of ballBodies) {
          // Skip balls already caught
          if (this.caughtBalls.includes(body)) continue

          const pos = body.translation()
          const dist = Vector3.Distance(new Vector3(pos.x, pos.y, pos.z), this.position)

          if (dist < this.config.captureRadius) {
              this.captureBall(body)
          }
      }
  }

  private captureBall(body: RAPIER.RigidBody): void {
      // Logic State Machine Transition
      let nextState = this.state

      if (this.state === PrismCoreState.IDLE) {
          nextState = PrismCoreState.LOCKED_1
      } else if (this.state === PrismCoreState.LOCKED_1) {
          nextState = PrismCoreState.LOCKED_2
      } else if (this.state === PrismCoreState.LOCKED_2) {
          nextState = PrismCoreState.OVERLOAD
      } else {
          return // Already overloaded
      }

      // Add to tracked list
      this.caughtBalls.push(body)

      // Physics: Switch to Kinematic and hide inside core
      body.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true)

      // Arrange inside the core based on count
      // Ball 1: Center. Ball 2: Slightly offset. Ball 3: Entering.
      // Actually, we just stack them or rotate them.
      // Let's just put them at center for now.
      body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y, z: this.position.z })

      // Update State
      this.setState(nextState)
  }

  private setState(newState: PrismCoreState): void {
      this.state = newState
      const count = this.caughtBalls.length

      if (this.onStateChange) {
          this.onStateChange(newState, count)
      }

      const innerMat = this.innerMesh?.material as StandardMaterial

      switch (newState) {
          case PrismCoreState.IDLE:
              this.visualRotationSpeed = 0.5
              if (this.light) this.light.diffuse = Color3.Green()
              if (innerMat) innerMat.emissiveColor = Color3.Green()
              break

          case PrismCoreState.LOCKED_1:
              this.visualRotationSpeed = 2.0
              if (this.light) this.light.diffuse = Color3.Yellow()
              if (innerMat) innerMat.emissiveColor = Color3.Yellow()
              break

          case PrismCoreState.LOCKED_2:
              this.visualRotationSpeed = 5.0
              if (this.light) this.light.diffuse = Color3.Red()
              if (innerMat) innerMat.emissiveColor = Color3.Red()
              break

          case PrismCoreState.OVERLOAD:
              this.visualRotationSpeed = 10.0
              if (this.light) this.light.diffuse = Color3.White()
              if (innerMat) innerMat.emissiveColor = Color3.White()

              // Immediate release sequence
              // Delay slightly for effect? No, plan says "Release immediately" for Ball 3.
              // But let's give it a frame or two of "White" flash.
              // We'll call releaseAll() immediately here.
              this.releaseAll()
              break
      }
  }

  private releaseAll(): void {
      // Spread balls in a cone
      // Center direction: Down (-Z) or towards center (-Z, 0, -1).
      // Prism is at Z=12 (Top). Center is Z=0. Direction is (0, 0, -1).

      const baseDir = new Vector3(0, 0, -1)
      const spreadRad = (this.config.ejectSpread * Math.PI) / 180

      this.caughtBalls.forEach((body, index) => {
          body.setBodyType(this.rapier.RigidBodyType.Dynamic, true)

          // Calculate spread angle
          // -Spread/2 to +Spread/2 based on index
          // 3 balls: -Angle, 0, +Angle
          let angle = 0
          if (this.caughtBalls.length > 1) {
              const step = spreadRad / (this.caughtBalls.length - 1)
              angle = -spreadRad / 2 + (step * index)
          }

          // Rotate baseDir by angle around Y axis
          const sin = Math.sin(angle)
          const cos = Math.cos(angle)
          const dir = new Vector3(
              baseDir.x * cos - baseDir.z * sin,
              0,
              baseDir.x * sin + baseDir.z * cos
          )

          const force = dir.scale(this.config.ejectForce)
          body.applyImpulse({ x: force.x, y: force.y, z: force.z }, true)
      })

      // Clear caught list
      this.caughtBalls = []

      // Reset state to IDLE after a short delay or immediately?
      // Logic usually requires us to wait until balls leave capture zone.
      // But we just pushed them hard.
      // Let's reset state to IDLE.
      // Note: If balls stick around, they might re-trigger.
      // Add a cooldown? The Impulse should clear them.
      // For safety, we can add a cooldown timer, but for now strict reset.

      // We set state back to IDLE, but visually we might want a cooldown.
      // Let's reset purely.
      // Actually, if we reset immediately, checkCapture might grab them again in the same frame if they haven't moved.
      // The Physics step happens after this. Impulse is applied.
      // Next frame, they should move.
      // But checkCapture happens in `update`.
      // We should probably add a brief cooldown.

      // Since I don't have a Cooldown state in Enum (I can add one or handle internally),
      // I'll just clear the caughtBalls list and let them fly.
      // To prevent immediate re-capture, I should check distance > radius or velocity.

      // Let's add a "safe" time or check.
      // Simplest: Don't check capture for 1 second.
      // I'll cheat and set state to IDLE but rely on the fact the balls are moving fast.
      // And I can add a small cooldown logic if needed.
      // But `checkCapture` excludes `caughtBalls`. Since I cleared it, they are candidates.
      // I will add a `cooldownTimer` property.

      this.cooldownTimer = 2.0
      this.state = PrismCoreState.IDLE
      // Reset visuals
      this.setState(PrismCoreState.IDLE)
  }

  private cooldownTimer = 0

  public updateCooldown(dt: number) {
      if (this.cooldownTimer > 0) {
          this.cooldownTimer -= dt
      }
  }

  // Override update to include cooldown
  // I need to rename the original update or call it.
  // I'll just merge logic into `update` above.
}
