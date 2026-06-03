import { Scene, Vector3, MeshBuilder, Mesh, Quaternion } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { GameConfig } from '../config'
import { COLLISION_GROUP_PRESETS } from '../game-elements/physics'
import { getMaterialLibrary } from '../materials'

export class RailBuilder {
  private static readonly SEGMENT_OVERLAP = 0.12

  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER

  private matLib: ReturnType<typeof getMaterialLibrary>
  private meshes: Mesh[] = []
  private bodies: RAPIER.RigidBody[] = []

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
     
    _config: typeof GameConfig
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier

    this.matLib = getMaterialLibrary(scene)
  }

  /**
   * Creates strong side rails that run from the upper playfield down to the flippers.
   * These physically block the ball from draining down the left/right gutters.
   */
  createDrainRails(): { meshes: Mesh[] } {
    const meshes: Mesh[] = []
    const railMat = this.matLib.getBrushedMetalMaterial()
    const railHeight = 1.2
    const railThick = 0.4

    // Left rail - curves inward toward the left flipper
    const leftRailPath = [
      new Vector3(-10, railHeight / 2, 20),    // Top wall junction
      new Vector3(-10, railHeight / 2, 10),    // Upper playfield
      new Vector3(-9.5, railHeight / 2, 0),    // Mid playfield
      new Vector3(-8, railHeight / 2, -6),     // Above flipper
      new Vector3(-5.5, railHeight / 2, -9)    // Ends near left flipper
    ]

    const leftRail = MeshBuilder.CreateTube('leftSideRail', {
      path: leftRailPath,
      radius: 0.18,
      sideOrientation: 2
    }, this.scene)
    leftRail.material = railMat
    meshes.push(leftRail)
    this.meshes.push(leftRail)

    // Physics colliders for left rail
    for (let i = 0; i < leftRailPath.length - 1; i++) {
      const start = leftRailPath[i]
      const end = leftRailPath[i + 1]
      const mid = Vector3.Center(start, end)
      const direction = end.subtract(start)
      const length = direction.length()
      const angle = Math.atan2(direction.x, direction.z)

      const railBody = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(mid.x, mid.y, mid.z)
          .setRotation(new this.rapier.Quaternion(0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5)))
      )
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(railThick / 2, railHeight / 2, length / 2 + RailBuilder.SEGMENT_OVERLAP)
          .setRestitution(0.5)
          .setFriction(0.1)
          .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
        railBody
      )
      this.bodies.push(railBody)
    }

    // Right rail - curves inward toward the right flipper
    const rightRailPath = [
      new Vector3(11.5, railHeight / 2, 20),   // Top wall junction
      new Vector3(11.5, railHeight / 2, 10),   // Upper playfield
      new Vector3(11, railHeight / 2, 0),      // Mid playfield
      new Vector3(9.5, railHeight / 2, -6),    // Above flipper
      new Vector3(7, railHeight / 2, -9)       // Ends near right flipper
    ]

    const rightRail = MeshBuilder.CreateTube('rightSideRail', {
      path: rightRailPath,
      radius: 0.18,
      sideOrientation: 2
    }, this.scene)
    rightRail.material = railMat
    meshes.push(rightRail)
    this.meshes.push(rightRail)

    // Physics colliders for right rail
    for (let i = 0; i < rightRailPath.length - 1; i++) {
      const start = rightRailPath[i]
      const end = rightRailPath[i + 1]
      const mid = Vector3.Center(start, end)
      const direction = end.subtract(start)
      const length = direction.length()
      const angle = Math.atan2(direction.x, direction.z)

      const railBody = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(mid.x, mid.y, mid.z)
          .setRotation(new this.rapier.Quaternion(0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5)))
      )
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(railThick / 2, railHeight / 2, length / 2 + RailBuilder.SEGMENT_OVERLAP)
          .setRestitution(0.5)
          .setFriction(0.1)
          .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
        railBody
      )
      this.bodies.push(railBody)
    }

    // Lower guard rails - smooth cylindrical guards above flippers
    const guardMat = this.matLib.getChromeMaterial()

    // Left guard - round tube profile
    const leftGuard = MeshBuilder.CreateCylinder('leftGuard', { diameter: 0.26, height: 3, tessellation: 14 }, this.scene)
    leftGuard.position.set(-4.5, 0.4, -10)
    leftGuard.rotation.x = Math.PI / 2
    leftGuard.rotation.z = -Math.PI / 8
    leftGuard.material = guardMat
    meshes.push(leftGuard)
    this.meshes.push(leftGuard)

    const leftGuardRotation = Quaternion.FromEulerAngles(Math.PI / 2, 0, -Math.PI / 8)
    const lgBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(-4.5, 0.4, -10)
        .setRotation({ x: leftGuardRotation.x, y: leftGuardRotation.y, z: leftGuardRotation.z, w: leftGuardRotation.w })
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cylinder(1.5, 0.13)
        .setRestitution(0.6)
        .setFriction(0.1)
        .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
      lgBody
    )
    this.bodies.push(lgBody)

    // Right guard - round tube profile
    const rightGuard = MeshBuilder.CreateCylinder('rightGuard', { diameter: 0.26, height: 3, tessellation: 14 }, this.scene)
    rightGuard.position.set(6, 0.4, -10)
    rightGuard.rotation.x = Math.PI / 2
    rightGuard.rotation.z = Math.PI / 8
    rightGuard.material = guardMat
    meshes.push(rightGuard)
    this.meshes.push(rightGuard)

    const rightGuardRotation = Quaternion.FromEulerAngles(Math.PI / 2, 0, Math.PI / 8)
    const rgBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(6, 0.4, -10)
        .setRotation({ x: rightGuardRotation.x, y: rightGuardRotation.y, z: rightGuardRotation.z, w: rightGuardRotation.w })
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cylinder(1.5, 0.13)
        .setRestitution(0.6)
        .setFriction(0.1)
        .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
      rgBody
    )
    this.bodies.push(rgBody)

    return { meshes }
  }

  /**
   * Creates gentle ramps and curves in the lower half that funnel the ball toward the flippers.
   * These guides prevent instant side drains and keep the ball in play longer.
   */
  createFlipperRamps(): { meshes: Mesh[] } {
    const meshes: Mesh[] = []
    const rampMat = this.matLib.getBrushedMetalMaterial()

    // ================================================================
    // LEFT FLIPPER FUNNEL - Curved guide from left wall to left flipper
    // ================================================================

    const leftRampPath = [
      new Vector3(-10, 0.4, 0),    // Start near left wall, upper-mid table
      new Vector3(-8.5, 0.35, -2), // Curve inward
      new Vector3(-7, 0.3, -4),    // Mid approach
      new Vector3(-5.5, 0.25, -6), // Near flipper
      new Vector3(-4, 0.2, -7.5)   // End at left flipper
    ]

    const leftRamp = MeshBuilder.CreateTube('leftFlipperRamp', {
      path: leftRampPath,
      radius: 0.15,
      sideOrientation: 2
    }, this.scene)
    leftRamp.material = rampMat
    meshes.push(leftRamp)
    this.meshes.push(leftRamp)

    // Physics collider for left ramp
    for (let i = 0; i < leftRampPath.length - 1; i++) {
      const start = leftRampPath[i]
      const end = leftRampPath[i + 1]
      const mid = Vector3.Center(start, end)
      const direction = end.subtract(start)
      const length = direction.length()
      const angle = Math.atan2(direction.x, direction.z)

      const rampBody = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(mid.x, mid.y + 0.15, mid.z)
          .setRotation(new this.rapier.Quaternion(0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5)))
      )
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(0.2, 0.15, length / 2 + RailBuilder.SEGMENT_OVERLAP)
          .setRestitution(0.4)
          .setFriction(0.1)
          .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
        rampBody
      )
      this.bodies.push(rampBody)
    }

    // ================================================================
    // RIGHT FLIPPER FUNNEL - Curved guide from right wall to right flipper
    // ================================================================

    const rightRampPath = [
      new Vector3(11, 0.4, 0),     // Start near right wall, upper-mid table
      new Vector3(9.5, 0.35, -2),  // Curve inward
      new Vector3(8, 0.3, -4),     // Mid approach
      new Vector3(6.5, 0.25, -6),  // Near flipper
      new Vector3(5, 0.2, -7.5)    // End at right flipper
    ]

    const rightRamp = MeshBuilder.CreateTube('rightFlipperRamp', {
      path: rightRampPath,
      radius: 0.15,
      sideOrientation: 2
    }, this.scene)
    rightRamp.material = rampMat
    meshes.push(rightRamp)
    this.meshes.push(rightRamp)

    // Physics collider for right ramp
    for (let i = 0; i < rightRampPath.length - 1; i++) {
      const start = rightRampPath[i]
      const end = rightRampPath[i + 1]
      const mid = Vector3.Center(start, end)
      const direction = end.subtract(start)
      const length = direction.length()
      const angle = Math.atan2(direction.x, direction.z)

      const rampBody = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(mid.x, mid.y + 0.15, mid.z)
          .setRotation(new this.rapier.Quaternion(0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5)))
      )
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(0.2, 0.15, length / 2 + RailBuilder.SEGMENT_OVERLAP)
          .setRestitution(0.4)
          .setFriction(0.1)
          .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
        rampBody
      )
      this.bodies.push(rampBody)
    }

    // ================================================================
    // CENTER RAMP - Divides the lower playfield and creates interesting bounces
    // ================================================================

    const centerRampPath = [
      new Vector3(-2, 0.2, -3),    // Left side
      new Vector3(0, 0.25, -4),    // Center peak
      new Vector3(2, 0.2, -3)      // Right side
    ]

    const centerRamp = MeshBuilder.CreateTube('centerRamp', {
      path: centerRampPath,
      radius: 0.12,
      sideOrientation: 2
    }, this.scene)
    centerRamp.material = rampMat
    meshes.push(centerRamp)
    this.meshes.push(centerRamp)

    // Physics for center ramp
    const centerRampBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(0, 0.25, -4)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(2.5, 0.1, 0.5)
        .setRestitution(0.4)
        .setFriction(0.1)
        .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
      centerRampBody
    )
    this.bodies.push(centerRampBody)

    // ================================================================
    // UPPER DEFLECTOR RAILS - Prevent straight-down drains from upper playfield
    // ================================================================

    // Left upper deflector
    const leftDeflectorPath = [
      new Vector3(-6, 0.3, 2),
      new Vector3(-4, 0.25, 0),
      new Vector3(-2, 0.2, -2)
    ]

    const leftDeflector = MeshBuilder.CreateTube('leftDeflector', {
      path: leftDeflectorPath,
      radius: 0.12,
      sideOrientation: 2
    }, this.scene)
    leftDeflector.material = rampMat
    meshes.push(leftDeflector)
    this.meshes.push(leftDeflector)

    for (let i = 0; i < leftDeflectorPath.length - 1; i++) {
      const start = leftDeflectorPath[i]
      const end = leftDeflectorPath[i + 1]
      const mid = Vector3.Center(start, end)
      const direction = end.subtract(start)
      const length = direction.length()
      const angle = Math.atan2(direction.x, direction.z)

      const deflectorBody = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(mid.x, mid.y + 0.08, mid.z)
          .setRotation(new this.rapier.Quaternion(0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5)))
      )
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(0.12, 0.08, length / 2 + RailBuilder.SEGMENT_OVERLAP)
          .setRestitution(0.35)
          .setFriction(0.1)
          .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
        deflectorBody
      )
      this.bodies.push(deflectorBody)
    }

    // Right upper deflector
    const rightDeflectorPath = [
      new Vector3(7, 0.3, 2),
      new Vector3(5, 0.25, 0),
      new Vector3(3, 0.2, -2)
    ]

    const rightDeflector = MeshBuilder.CreateTube('rightDeflector', {
      path: rightDeflectorPath,
      radius: 0.12,
      sideOrientation: 2
    }, this.scene)
    rightDeflector.material = rampMat
    meshes.push(rightDeflector)
    this.meshes.push(rightDeflector)

    for (let i = 0; i < rightDeflectorPath.length - 1; i++) {
      const start = rightDeflectorPath[i]
      const end = rightDeflectorPath[i + 1]
      const mid = Vector3.Center(start, end)
      const direction = end.subtract(start)
      const length = direction.length()
      const angle = Math.atan2(direction.x, direction.z)

      const deflectorBody = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(mid.x, mid.y + 0.08, mid.z)
          .setRotation(new this.rapier.Quaternion(0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5)))
      )
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(0.12, 0.08, length / 2 + RailBuilder.SEGMENT_OVERLAP)
          .setRestitution(0.35)
          .setFriction(0.1)
          .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
        deflectorBody
      )
      this.bodies.push(deflectorBody)
    }

    return { meshes }
  }

  dispose(): void {
    for (const body of this.bodies) {
      if (this.world.getRigidBody(body.handle)) {
        this.world.removeRigidBody(body)
      }
    }
    this.bodies = []

    for (const mesh of this.meshes) {
      if (!mesh.isDisposed()) {
        mesh.dispose()
      }
    }
    this.meshes = []
  }
}
