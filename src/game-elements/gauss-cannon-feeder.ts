import {
  Mesh,
  MeshBuilder,
  Scene,
  Vector3,
  StandardMaterial,
  Color3,
  Scalar,
  PointLight,
  TransformNode,
  Matrix,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import type { GameConfigType } from '../config'

export enum GaussCannonState {
  IDLE,
  LOAD,
  AIM,
  FIRE,
  COOLDOWN,
}

export class GaussCannonFeeder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private config: GameConfigType['gaussCannon']

  private position: Vector3
  private rootNode: TransformNode | null = null
  private barrelMesh: Mesh | null = null
  private light: PointLight | null = null

  private state: GaussCannonState = GaussCannonState.IDLE
  private timer: number = 0

  // Aiming logic
  private currentAngle: number = 0
  private aimDirection: number = 1

  private caughtBall: RAPIER.RigidBody | null = null
  private physicsBody: RAPIER.RigidBody | null = null

  // Callback to allow Game to play sounds/effects
  public onStateChange: ((state: GaussCannonState) => void) | null = null

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    config: GameConfigType['gaussCannon']
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.config = config
    this.position = new Vector3(this.config.gaussPosition.x, this.config.gaussPosition.y, this.config.gaussPosition.z)

    this.createMesh()
    this.createPhysics()
  }

  getPosition(): Vector3 {
      return this.position.clone()
  }

  private createMesh(): void {
    // Root node for the entire structure
    this.rootNode = new TransformNode("gaussRoot", this.scene)
    this.rootNode.position.copyFrom(this.position)

    // 1. Base (Static Turret Mount)
    const base = MeshBuilder.CreateCylinder("gaussBase", {
      diameter: 2.5,
      height: 1.0,
      tessellation: 16
    }, this.scene)
    base.parent = this.rootNode
    base.position.y = 0 // Relative to root

    const baseMat = new StandardMaterial("gaussBaseMat", this.scene)
    baseMat.diffuseColor = Color3.FromHexString("#333333") // Dark Steel
    baseMat.specularColor = Color3.White()
    base.material = baseMat

    // 2. Barrel Assembly (Rotates)
    // Create a pivot node for the barrel
    this.barrelMesh = MeshBuilder.CreateCylinder("gaussBarrel", {
        diameter: 0.8,
        height: 4.0,
        tessellation: 16
    }, this.scene)
    this.barrelMesh.parent = this.rootNode

    // Rotate so it points forward (Z) initially, but we want it to pivot around the back
    // By default cylinder is Y-aligned.
    // Rotate X 90 deg -> Z aligned.
    this.barrelMesh.rotation.x = Math.PI / 2
    this.barrelMesh.position.y = 1.0 // Mounted on top of base

    // We want the pivot to be at the back of the barrel.
    // The cylinder center is (0,0,0). Length 4. Back is -2.
    // So we move it forward by 2 relative to the pivot.
    this.barrelMesh.bakeTransformIntoVertices(
         Matrix.Translation(0, 2.0, 0)
    )

    const barrelMat = new StandardMaterial("gaussBarrelMat", this.scene)
    barrelMat.diffuseColor = Color3.FromHexString("#555555")
    this.barrelMesh.material = barrelMat

    // 3. Coils (Emissive Rings) attached to barrel
    for(let i=0; i<3; i++) {
        const coil = MeshBuilder.CreateTorus(`gaussCoil_${i}`, {
            diameter: 1.2,
            thickness: 0.2,
            tessellation: 16
        }, this.scene)
        coil.parent = this.barrelMesh
        // Position along the barrel length (which is now Y-aligned in local space)
        // Local Y ranges from 0 (pivot) to 4 (muzzle)
        coil.position.y = 1.0 + (i * 1.0)

        const coilMat = new StandardMaterial(`gaussCoilMat_${i}`, this.scene)
        coilMat.emissiveColor = Color3.FromHexString("#000000") // Off initially
        coil.material = coilMat
    }

    // Light
    this.light = new PointLight("gaussLight", new Vector3(0, 4, 0), this.scene)
    this.light.parent = this.barrelMesh
    this.light.diffuse = Color3.FromHexString("#FFA500") // Orange
    this.light.intensity = 0
  }

  private createPhysics(): void {
    // Create a static body for the base
    this.physicsBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(this.position.x, this.position.y, this.position.z)
    )

    // Base Collider
    this.world.createCollider(
      this.rapier.ColliderDesc.cylinder(0.5, 1.25)
        .setTranslation(0, 0, 0),
      this.physicsBody
    )
  }

  update(dt: number, ballBodies: RAPIER.RigidBody[]): void {
    this.timer -= dt

    // State Machine
    switch (this.state) {
      case GaussCannonState.IDLE:
        this.checkProximity(ballBodies)
        this.animateIdle(dt)
        break

      case GaussCannonState.LOAD:
        if (this.caughtBall) {
           this.animateLoad(dt)
        }
        break

      case GaussCannonState.AIM:
        this.animateAim(dt)
        if (this.timer <= 0) {
            this.setState(GaussCannonState.FIRE)
        }
        break

      case GaussCannonState.FIRE:
        // Immediate transition
        break

      case GaussCannonState.COOLDOWN:
        if (this.timer <= 0) {
          this.setState(GaussCannonState.IDLE)
        }
        break
    }

    // Update visual rotation of the barrel
    if (this.barrelMesh) {
         // Convert degrees to radians and adjust for the scene orientation
         // Config angles are 30-60 degrees.
         // 0 degrees = Straight Z?
         // Let's assume 0 is pointing +Z.
         // Rotation is around Y axis.

         const rad = this.currentAngle * (Math.PI / 180)
         // Our barrel is Z aligned when rotation.y = 0 (due to parent node or mesh rotation?)
         // Wait, barrelMesh.rotation.x = PI/2 makes it Z aligned in local space.
         // But we are rotating the mesh around Y (Yaw).

         // Let's map 0 degrees to 'Right' (+X) or 'Up' (+Z)?
         // The cannon is on the left (-X). It should aim towards the center/right.
         // So 0 deg = +X (Right).
         // 30 deg = +X tilted 30 deg towards +Z?
         // Let's stick to standard math: 0 = +X, 90 = +Z.

         // Actually, let's just rotate the mesh around the Y axis.
         this.barrelMesh.rotation.y = -rad + Math.PI/2 // Adjust as needed to align with world
    }
  }

  private animateIdle(dt: number): void {
      // Slow breathing or scanning?
      // Just sweep slowly
      const speed = 0.2
      this.currentAngle += speed * this.aimDirection * dt * 10
      if (this.currentAngle > this.config.maxAngle) {
          this.currentAngle = this.config.maxAngle
          this.aimDirection = -1
      }
      if (this.currentAngle < this.config.minAngle) {
          this.currentAngle = this.config.minAngle
          this.aimDirection = 1
      }
  }

  private animateLoad(dt: number): void {
      if (!this.caughtBall) return

      const currentPos = this.caughtBall.translation()
      // Target: Breech of the cannon
      // Calculate based on current barrel rotation
      // Breech is at the pivot point (root position + y offset)
      const targetPos = this.position.add(new Vector3(0, 1.0, 0))

      const lerpFactor = dt * 5
      const newX = Scalar.Lerp(currentPos.x, targetPos.x, lerpFactor)
      const newY = Scalar.Lerp(currentPos.y, targetPos.y, lerpFactor)
      const newZ = Scalar.Lerp(currentPos.z, targetPos.z, lerpFactor)

      this.caughtBall.setNextKinematicTranslation({ x: newX, y: newY, z: newZ })

      const dist = Vector3.Distance(
        new Vector3(currentPos.x, currentPos.y, currentPos.z),
        targetPos
      )

      if (dist < 0.2) {
        this.setState(GaussCannonState.AIM)
      }
  }

  private animateAim(dt: number): void {
       const speed = this.config.sweepSpeed * 20 // Convert rad/s to deg/frame approx
       this.currentAngle += speed * this.aimDirection * dt

       if (this.currentAngle >= this.config.maxAngle) {
           this.aimDirection = -1
       } else if (this.currentAngle <= this.config.minAngle) {
           this.aimDirection = 1
       }

       // Sync ball to breech
       if (this.caughtBall) {
           const targetPos = this.position.add(new Vector3(0, 1.0, 0))
           this.caughtBall.setNextKinematicTranslation({ x: targetPos.x, y: targetPos.y, z: targetPos.z })
       }
  }

  private checkProximity(ballBodies: RAPIER.RigidBody[]): void {
    const PULL_RADIUS = this.config.intakeRadius || 1.0

    for (const body of ballBodies) {
      const pos = body.translation()
      const dist = Vector3.Distance(
        new Vector3(pos.x, pos.y, pos.z),
        this.position
      )

      if (dist < PULL_RADIUS) {
         // Check height logic if needed
         this.captureBall(body)
         return
      }
    }
  }

  private captureBall(body: RAPIER.RigidBody): void {
    this.caughtBall = body
    body.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true)
    this.setState(GaussCannonState.LOAD)
  }

  private setState(newState: GaussCannonState): void {
    this.state = newState
    this.timer = 0

    if (this.onStateChange) {
      this.onStateChange(newState)
    }

    switch (newState) {
      case GaussCannonState.IDLE:
        this.setCoilColor(Color3.Black())
        if (this.light) this.light.intensity = 0
        break

      case GaussCannonState.LOAD:
        this.setCoilColor(Color3.Blue())
        if (this.light) {
            this.light.diffuse = Color3.Blue()
            this.light.intensity = 0.5
        }
        break

      case GaussCannonState.AIM:
        this.timer = 2.0 // Aim duration
        this.setCoilColor(Color3.FromHexString("#FFA500"))
        if (this.light) {
            this.light.diffuse = Color3.FromHexString("#FFA500")
            this.light.intensity = 1.0
        }
        break

      case GaussCannonState.FIRE:
        this.fireBall()
        this.setState(GaussCannonState.COOLDOWN)
        break

      case GaussCannonState.COOLDOWN:
        this.timer = this.config.cooldown
        this.setCoilColor(Color3.Red())
        if (this.light) {
            this.light.intensity = 0.2
        }
        break
    }
  }

  private setCoilColor(color: Color3): void {
      if (!this.barrelMesh) return

      this.barrelMesh.getChildren().forEach((child) => {
          if (child instanceof Mesh && child.name.includes("gaussCoil")) {
              if (child.material instanceof StandardMaterial) {
                  child.material.emissiveColor = color
              }
          }
      })
  }

  private fireBall(): void {
    if (!this.caughtBall) return

    this.caughtBall.setBodyType(this.rapier.RigidBodyType.Dynamic, true)

    // Calculate direction from angle
    // angle 0 = +X (Right)
    const rad = this.currentAngle * (Math.PI / 180)
    const dirX = Math.cos(rad)
    const dirZ = Math.sin(rad)

    // Muzzle position
    // Barrel length 4.
    // Actually we just need direction vector
    const dir = new Vector3(dirX, 0, dirZ).normalize()

    // We can't teleport dynamic body easily without sleep, but we just switched it.
    // Apply impulse is safer.

    const force = dir.scale(this.config.muzzleVelocity)

    this.caughtBall.applyImpulse({ x: force.x, y: force.y, z: force.z }, true)
    this.caughtBall = null

    // Flash effect
    if (this.light) {
        this.light.intensity = 5.0
        setTimeout(() => { if (this.light) this.light.intensity = 0.2 }, 100)
    }
  }
}
