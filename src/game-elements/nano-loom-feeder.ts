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

export enum NanoLoomState {
  IDLE,
  LIFT,
  WEAVE,
  EJECT,
}

export class NanoLoomFeeder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private config: GameConfigType['nanoLoom']

  private position: Vector3
  private intakePosition: Vector3

  // Visuals
  // @ts-ignore
  private frameMesh: Mesh | null = null
  // @ts-ignore
  private intakeMesh: Mesh | null = null
  private pins: Mesh[] = []
  private light: PointLight | null = null

  private state: NanoLoomState = NanoLoomState.IDLE
  private timer: number = 0

  private caughtBall: RAPIER.RigidBody | null = null

  // Physics Handles
  private frameBody: RAPIER.RigidBody | null = null

  public onStateChange: ((state: NanoLoomState, position?: Vector3) => void) | null = null

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    config: GameConfigType['nanoLoom']
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.config = config

    this.position = new Vector3(config.loomPosition.x, config.loomPosition.y, config.loomPosition.z)
    this.intakePosition = new Vector3(config.intakePosition.x, config.intakePosition.y, config.intakePosition.z)

    this.createVisuals()
    this.createPhysics()
  }

  private createVisuals(): void {
    // 1. Frame (Transparent Box)
    const frame = MeshBuilder.CreateBox("nanoLoomFrame", {
      width: this.config.width,
      height: this.config.height,
      depth: this.config.depth
    }, this.scene)
    frame.position.copyFrom(this.position)

    const frameMat = new StandardMaterial("nanoLoomFrameMat", this.scene)
    frameMat.diffuseColor = Color3.FromHexString("#003333")
    frameMat.emissiveColor = Color3.FromHexString("#001111")
    frameMat.alpha = 0.3
    frame.material = frameMat
    this.frameMesh = frame

    // 2. Intake Tube
    const intake = MeshBuilder.CreateCylinder("nanoIntake", {
      diameter: 1.2,
      height: 1.0,
      tessellation: 16
    }, this.scene)
    // Rotate to face sideways if needed, but for now vertical cylinder at intake pos
    intake.position.copyFrom(this.intakePosition)

    const intakeMat = new StandardMaterial("nanoIntakeMat", this.scene)
    intakeMat.emissiveColor = Color3.FromHexString("#00ffff")
    intakeMat.alpha = 0.5
    intake.material = intakeMat
    this.intakeMesh = intake

    // 3. Pins (The Hex Grid)
    const pinMat = new StandardMaterial("nanoPinMat", this.scene)
    pinMat.emissiveColor = Color3.FromHexString("#00ff00")

    const startY = this.position.y + (this.config.height / 2) - 1.0 // Start near top
    const startX = this.position.x - (this.config.width / 2) + 0.5

    for (let r = 0; r < this.config.pinRows; r++) {
      for (let c = 0; c < this.config.pinCols; c++) {
        const rowOffset = (r % 2) * (this.config.pinSpacing / 2)
        const x = startX + (c * this.config.pinSpacing) + rowOffset
        const y = startY - (r * this.config.pinSpacing)

        // Skip if out of bounds (rough check)
        if (x > this.position.x + this.config.width/2 - 0.2) continue;

        const pin = MeshBuilder.CreateCylinder(`nanoPin_${r}_${c}`, {
          diameter: 0.15,
          height: this.config.depth, // Full depth
          tessellation: 8
        }, this.scene)

        // Rotate pin to point in Z axis (back to front)
        pin.rotation.x = Math.PI / 2
        pin.position.set(x, y, this.position.z)
        pin.material = pinMat

        this.pins.push(pin)
      }
    }

    // Light
    this.light = new PointLight("nanoLoomLight", this.position, this.scene)
    this.light.diffuse = Color3.FromHexString("#00ff00")
    this.light.intensity = 0.2
    this.light.range = 8
  }

  private createPhysics(): void {
    // 1. Frame / Pins Physics
    // We create a static compound body for the whole loom frame + pins
    const bodyDesc = this.rapier.RigidBodyDesc.fixed()
      .setTranslation(0, 0, 0) // World space

    this.frameBody = this.world.createRigidBody(bodyDesc)

    // Backboard (to keep ball in)
    // Z position is loomPos.z + depth/2
    const backZ = this.position.z + (this.config.depth / 2)
    const frontZ = this.position.z - (this.config.depth / 2)

    // Back Wall
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(this.config.width/2, this.config.height/2, 0.1)
        .setTranslation(this.position.x, this.position.y, backZ),
      this.frameBody
    )
    // Front Glass (Visual only? No, keep it physical so ball doesn't fly out)
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(this.config.width/2, this.config.height/2, 0.1)
        .setTranslation(this.position.x, this.position.y, frontZ),
      this.frameBody
    )

    // Side Walls
    const leftX = this.position.x - (this.config.width / 2)
    const rightX = this.position.x + (this.config.width / 2)

    this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(0.1, this.config.height/2, this.config.depth/2)
            .setTranslation(leftX, this.position.y, this.position.z),
        this.frameBody
    )
    this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(0.1, this.config.height/2, this.config.depth/2)
            .setTranslation(rightX, this.position.y, this.position.z),
        this.frameBody
    )

    // Pins
    // Add cylinders for each pin
    // Note: Rapier cylinders are Y-up. Our visual pins are Z-oriented.
    // We need to rotate the colliders.
    const q = Quaternion.FromEulerAngles(Math.PI / 2, 0, 0)

    const startY = this.position.y + (this.config.height / 2) - 1.0
    const startX = this.position.x - (this.config.width / 2) + 0.5

    for (let r = 0; r < this.config.pinRows; r++) {
        for (let c = 0; c < this.config.pinCols; c++) {
          const rowOffset = (r % 2) * (this.config.pinSpacing / 2)
          const x = startX + (c * this.config.pinSpacing) + rowOffset
          const y = startY - (r * this.config.pinSpacing)

          if (x > this.position.x + this.config.width/2 - 0.2) continue;

          this.world.createCollider(
            this.rapier.ColliderDesc.cylinder(this.config.depth/2, 0.08) // halfHeight, radius
                .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
                .setTranslation(x, y, this.position.z)
                .setRestitution(this.config.pinBounciness),
            this.frameBody
          )
        }
    }
  }

  update(dt: number, ballBodies: RAPIER.RigidBody[]): void {
    if (this.timer > 0) this.timer -= dt

    switch (this.state) {
        case NanoLoomState.IDLE:
            this.checkIntake(ballBodies)
            break

        case NanoLoomState.LIFT:
            if (this.caughtBall) {
                // Lerp ball up to top center of loom
                const topY = this.position.y + (this.config.height / 2) - 0.5
                const targetPos = new Vector3(this.position.x, topY, this.position.z)
                const currentPos = this.caughtBall.translation()

                // Determine progress
                // We want linear speed for lift
                const speed = 10.0 // units per second
                const dy = speed * dt

                let nextY = currentPos.y + dy
                if (nextY >= topY) {
                    nextY = topY
                    // Reached top
                    this.setState(NanoLoomState.WEAVE)
                }

                // Smooth X/Z alignment
                const nextX = Scalar.Lerp(currentPos.x, targetPos.x, dt * 5)
                const nextZ = Scalar.Lerp(currentPos.z, targetPos.z, dt * 5)

                this.caughtBall.setNextKinematicTranslation({ x: nextX, y: nextY, z: nextZ })
            }
            break

        case NanoLoomState.WEAVE:
            // Ball is falling dynamic. Check if it exits bottom.
            if (this.caughtBall) {
                const pos = this.caughtBall.translation()
                const bottomY = this.position.y - (this.config.height / 2)

                if (pos.y < bottomY + 0.5) {
                    this.setState(NanoLoomState.EJECT)
                }
            }
            break

        case NanoLoomState.EJECT:
             // Ejection happens in setState
             // Wait for ball to clear area?
             // Actually, setState(EJECT) triggers the force, then we go to IDLE after a short delay
             if (this.timer <= 0) {
                 this.setState(NanoLoomState.IDLE)
             }
             break
    }
  }

  private checkIntake(ballBodies: RAPIER.RigidBody[]): void {
      const radius = 1.5
      for (const body of ballBodies) {
          const pos = body.translation()
          const dist = Vector3.Distance(
              new Vector3(pos.x, pos.y, pos.z),
              this.intakePosition
          )

          if (dist < radius) {
              this.captureBall(body)
              return
          }
      }
  }

  private captureBall(body: RAPIER.RigidBody): void {
      this.caughtBall = body
      body.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true)
      this.setState(NanoLoomState.LIFT)
  }

  private setState(newState: NanoLoomState): void {
      this.state = newState

      if (this.onStateChange) {
          this.onStateChange(newState, this.position)
      }

      switch (newState) {
          case NanoLoomState.IDLE:
              this.caughtBall = null
              if (this.light) this.light.intensity = 0.2
              break

          case NanoLoomState.LIFT:
              if (this.light) {
                  this.light.diffuse = Color3.FromHexString("#00ffff")
                  this.light.intensity = 1.0
              }
              break

          case NanoLoomState.WEAVE:
              if (this.caughtBall) {
                  this.caughtBall.setBodyType(this.rapier.RigidBodyType.Dynamic, true)
                  // Give it a tiny nudge to ensure it doesn't balance perfectly on a pin
                  this.caughtBall.applyImpulse({ x: (Math.random()-0.5)*0.1, y: 0, z: 0 }, true)
              }
              if (this.light) {
                  this.light.diffuse = Color3.FromHexString("#ff00ff") // Magenta for chaos
              }
              break

          case NanoLoomState.EJECT:
              if (this.caughtBall) {
                  // Push out towards center
                  // Loom is on left (x negative), so push Positive X
                  const force = new Vector3(8.0, 2.0, 0)
                  this.caughtBall.applyImpulse({ x: force.x, y: force.y, z: force.z }, true)
              }
              this.timer = 1.0 // Short cooldown
              break
      }
  }
}
