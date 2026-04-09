import { Scene, Vector3, MeshBuilder, Mesh, TransformNode } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { GameConfig } from '../config'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding } from '../game-elements/types'

export class FlipperBuilder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER

  private matLib: ReturnType<typeof getMaterialLibrary>

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: typeof GameConfig
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier

    this.matLib = getMaterialLibrary(scene)
  }

  createFlippers(): {
    flippers: Map<string, { mesh: TransformNode; body: RAPIER.RigidBody; joint: RAPIER.ImpulseJoint }>
    bindings: PhysicsBinding[]
    meshes: Mesh[]
    leftJoint: RAPIER.ImpulseJoint
    rightJoint: RAPIER.ImpulseJoint
  } {
    const flippers = new Map<string, { mesh: TransformNode; body: RAPIER.RigidBody; joint: RAPIER.ImpulseJoint }>()
    const bindings: PhysicsBinding[] = []
    const meshes: Mesh[] = []
    let leftJoint: RAPIER.ImpulseJoint | null = null
    let rightJoint: RAPIER.ImpulseJoint | null = null

    const flipperMat = this.matLib.getEnhancedFlipperMaterial()
    const pivotMat = this.matLib.getFlipperPivotMaterial()

    const make = (pos: Vector3, isRight: boolean): RAPIER.RevoluteImpulseJoint => {
      const flipperLength = 3.5
      const flipperWidth = 0.5
      const flipperHeight = 0.6

      // Create parent node for the flipper assembly
      const flipperRoot = new TransformNode('flipperRoot', this.scene)
      flipperRoot.position.copyFrom(pos)

      // ================================================================
      // FLIPPER BLADE - Main paddle with curved end
      // ================================================================

      // Main blade body - tapered box for angled top surface
      const bladeMesh = MeshBuilder.CreateBox('flipperBlade', {
        width: flipperLength - 0.4,
        depth: flipperWidth,
        height: flipperHeight
      }, this.scene) as Mesh

      // Offset blade so pivot is at the base
      bladeMesh.position.x = isRight ? (flipperLength - 0.4) / 2 : -(flipperLength - 0.4) / 2
      bladeMesh.position.y = 0
      bladeMesh.rotation.x = 0.15 // Slight upward angle for better ball contact
      bladeMesh.parent = flipperRoot
      bladeMesh.material = flipperMat

      // Rounded flipper tip (curved end) - smooth sphere collision
      const tipMesh = MeshBuilder.CreateSphere('flipperTip', {
        diameter: flipperWidth * 1.2,
        segments: 16
      }, this.scene) as Mesh
      tipMesh.position.x = isRight ? flipperLength - 0.3 : -(flipperLength - 0.3)
      tipMesh.position.y = 0.05
      tipMesh.position.z = 0
      tipMesh.parent = flipperRoot
      tipMesh.material = flipperMat

      // Side bevels - angled edges for visual detail
      const bevelLeft = MeshBuilder.CreateBox('flipperBevelL', {
        width: flipperLength - 0.6,
        depth: 0.1,
        height: flipperHeight - 0.1
      }, this.scene) as Mesh
      bevelLeft.position.x = bladeMesh.position.x
      bevelLeft.position.z = flipperWidth / 2
      bevelLeft.position.y = 0.05
      bevelLeft.rotation.x = 0.15
      bevelLeft.parent = flipperRoot
      bevelLeft.material = flipperMat

      const bevelRight = MeshBuilder.CreateBox('flipperBevelR', {
        width: flipperLength - 0.6,
        depth: 0.1,
        height: flipperHeight - 0.1
      }, this.scene) as Mesh
      bevelRight.position.x = bladeMesh.position.x
      bevelRight.position.z = -flipperWidth / 2
      bevelRight.position.y = 0.05
      bevelRight.rotation.x = 0.15
      bevelRight.parent = flipperRoot
      bevelRight.material = flipperMat

      // ================================================================
      // PIVOT ASSEMBLY - Detailed pivot visualization
      // ================================================================

      // Main pivot cylinder
      const pivotCyl = MeshBuilder.CreateCylinder('flipperPivot', {
        diameter: 0.8,
        height: 0.9,
        tessellation: 16
      }, this.scene) as Mesh
      pivotCyl.rotation.x = Math.PI / 2
      pivotCyl.position.x = isRight ? 1.5 : -1.5
      pivotCyl.position.y = -0.1
      pivotCyl.parent = flipperRoot
      pivotCyl.material = pivotMat

      // Pivot cap (top)
      const pivotCap = MeshBuilder.CreateCylinder('flipperPivotCap', {
        diameter: 0.6,
        height: 0.15,
        tessellation: 16
      }, this.scene) as Mesh
      pivotCap.rotation.x = Math.PI / 2
      pivotCap.position.x = isRight ? 1.5 : -1.5
      pivotCap.position.y = -0.1
      pivotCap.position.z = 0.4
      pivotCap.parent = flipperRoot
      pivotCap.material = pivotMat

      // Pivot ring detail
      const pivotRing = MeshBuilder.CreateTorus('flipperPivotRing', {
        diameter: 0.9,
        thickness: 0.08,
        tessellation: 16
      }, this.scene) as Mesh
      pivotRing.position.x = isRight ? 1.5 : -1.5
      pivotRing.position.y = -0.1
      pivotRing.position.z = 0
      pivotRing.parent = flipperRoot
      pivotRing.material = pivotMat

      // ================================================================
      // PHYSICS BODY - Simplified collider matching visual shape
      // ================================================================

      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)
          .setLinearDamping(0.5)
          .setAngularDamping(2)
          .setCcdEnabled(true)
      )

      // Main blade collider (box)
      const colliderOffset = isRight ? (flipperLength - 0.4) / 2 : -(flipperLength - 0.4) / 2
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid((flipperLength - 0.4) / 2, 0.3, 0.25)
          .setTranslation(colliderOffset, 0, 0),
        body
      )

      // Rounded tip collider (ball)
      const tipOffset = isRight ? flipperLength - 0.3 : -(flipperLength - 0.3)
      this.world.createCollider(
        this.rapier.ColliderDesc.ball(0.3)
          .setTranslation(tipOffset, 0.05, 0)
          .setRestitution(0.3),
        body
      )

      // Register binding with root mesh
      bindings.push({ mesh: flipperRoot as unknown as Mesh, rigidBody: body })
      meshes.push(bladeMesh, tipMesh, bevelLeft, bevelRight)
      meshes.push(pivotCyl, pivotCap, pivotRing)

      // ================================================================
      // PIVOT JOINT - Revolute joint with limits
      // ================================================================

      const anchor = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
      )

      const pX = isRight ? 1.5 : -1.5
      const jParams = this.rapier.JointData.revolute(
        new this.rapier.Vector3(pX, 0, 0),
        new this.rapier.Vector3(pX, 0, 0),
        new this.rapier.Vector3(0, 1, 0)
      )
      jParams.limitsEnabled = true
      jParams.limits = isRight ? [-Math.PI / 4, Math.PI / 6] : [-Math.PI / 6, Math.PI / 4]

      const joint = this.world.createImpulseJoint(jParams, anchor, body, true) as RAPIER.RevoluteImpulseJoint

      joint.configureMotorPosition(
        isRight ? -Math.PI / 4 : Math.PI / 4,
        GameConfig.table.flipperStrength,
        GameConfig.flipper.damping
      )

      return joint
    }

    leftJoint = make(new Vector3(-4, -0.5, -7), false)
    rightJoint = make(new Vector3(4, -0.5, -7), true)

    return {
      flippers,
      bindings,
      meshes,
      leftJoint,
      rightJoint
    }
  }
}
