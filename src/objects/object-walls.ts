import { createStandardMaterial } from '../materials/material-basic'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Scene } from '@babylonjs/core/scene'
import type { PhysicsApi, PhysicsBody, PhysicsWorldSink } from '../core/physics-api'
import { GameConfig, PhysicsConfig } from '../config'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding, BumperVisual } from '../game-elements/types'
import { COLLISION_GROUP_PRESETS } from '../game-elements/physics'
import { authorCornerWedge, authorSlingshot, authorWall, cornerWedgeSpecs, SLINGSHOT_SPECS, tableWallSpecs } from '../table/table-colliders'

export class WallBuilder {
  private scene: Scene
  private world: PhysicsWorldSink
  private rapier: PhysicsApi

  private matLib: ReturnType<typeof getMaterialLibrary>
  private meshes: Mesh[] = []
  private bodies: PhysicsBody[] = []

  constructor(
    scene: Scene,
    world: PhysicsWorldSink,
    rapier: PhysicsApi,
     
    _config: typeof GameConfig
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier

    this.matLib = getMaterialLibrary(scene)
  }

  createGround(): { binding: PhysicsBinding | null; meshes: Mesh[] } {
    const groundMat = this.matLib.getPlayfieldMaterial()
    const meshes: Mesh[] = []

    const ground = MeshBuilder.CreateGround('ground', { width: GameConfig.table.width, height: GameConfig.table.height }, this.scene) as Mesh
    ground.position.set(0, -1, 5)
    ground.material = groundMat

    const groundBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(0, -1, 5)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(GameConfig.table.width / 2, 0.1, GameConfig.table.height / 2)
        .setRestitution(PhysicsConfig.surfaces.playfield.restitution)
        .setFriction(PhysicsConfig.surfaces.playfield.friction)
        .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
      groundBody
    )

    const binding: PhysicsBinding = { mesh: ground, rigidBody: groundBody }

    // Flipper zone visibility enhancement (disabled in reduced motion mode)
    if (!GameConfig.camera.reducedMotion) {
      const flipperGlow = MeshBuilder.CreateGround('flipperGlow', { width: 10, height: 6 }, this.scene)
      flipperGlow.position.set(0, -0.95, -7)
      const glowMat = createStandardMaterial(this.scene, 'flipperGlowMat')
      glowMat.diffuseColor = Color3.Black()
      glowMat.emissiveColor = Color3.FromHexString('#001133')
      glowMat.alpha = 0.3
      flipperGlow.material = glowMat
      meshes.push(flipperGlow)
    }

    meshes.push(ground)
    this.meshes.push(...meshes)
    this.bodies.push(groundBody)
    return { binding, meshes }
  }

  createWalls(): { bindings: PhysicsBinding[]; meshes: Mesh[] } {
    const bindings: PhysicsBinding[] = []
    const meshes: Mesh[] = []

    // Use MaterialLibrary for smoked glass walls
    const wallMat = this.matLib.getSmokedGlassMaterial()
    const wallH = GameConfig.table.wallHeight

    // 1–3. Outer walls, plunger base, shortened lane guide (`tableWallSpecs`)
    for (const { pos, size } of tableWallSpecs()) {
      this.createWall(new Vector3(pos.x, pos.y, pos.z), new Vector3(size.x, size.y, size.z), wallMat, bindings, meshes)
    }

    // 4. Create Corner Wedges
    this.createCornerWedges(wallH, bindings, meshes)

    return { bindings, meshes }
  }

  private createCornerWedges(height: number, bindings: PhysicsBinding[], meshes: Mesh[]): void {
    const wedgeMat = this.matLib.getBrushedMetalMaterial()

    for (const spec of cornerWedgeSpecs(height)) {
      const wedge = MeshBuilder.CreateBox(spec.name, {
        width: spec.diagWidth,
        height: spec.height,
        depth: spec.thickness
      }, this.scene)

      wedge.position.set(spec.x, 1, spec.z)
      wedge.rotation.y = spec.rotationY
      wedge.material = wedgeMat

      const body = authorCornerWedge(this.world, this.rapier, spec)

      bindings.push({ mesh: wedge, rigidBody: body })
      meshes.push(wedge)
      this.meshes.push(wedge)
      this.bodies.push(body)
    }
  }

  private createWall(
    pos: Vector3,
    size: Vector3,
    mat: import('@babylonjs/core/Materials/standardMaterial').StandardMaterial | import('@babylonjs/core/Materials/PBR/pbrMaterial').PBRMaterial,
    bindings: PhysicsBinding[],
    meshes: Mesh[]
  ): void {
    const w = MeshBuilder.CreateBox('w', { width: size.x, height: size.y * 2, depth: size.z }, this.scene)
    w.position.copyFrom(pos)
    w.material = mat

    const b = authorWall(this.world, this.rapier, pos, size)

    bindings.push({ mesh: w, rigidBody: b })
    meshes.push(w)
    this.meshes.push(w)
    this.bodies.push(b)
  }

  createSlingshots(): {
    bindings: PhysicsBinding[]
    bumperBodies: PhysicsBody[]
    bumperVisuals: BumperVisual[]
    meshes: Mesh[]
  } {
    const bindings: PhysicsBinding[] = []
    const bumperBodies: PhysicsBody[] = []
    const bumperVisuals: BumperVisual[] = []
    const meshes: Mesh[] = []

    const slingMat = this.matLib.getNeonSlingshotMaterial()

    for (const { pos, rot } of SLINGSHOT_SPECS) {
      this.createSlingshot(new Vector3(pos.x, pos.y, pos.z), rot, slingMat, bindings, bumperBodies, bumperVisuals, meshes)
    }

    return { bindings, bumperBodies, bumperVisuals, meshes }
  }

  private createSlingshot(
    pos: Vector3,
    rot: number,
    mat: import('@babylonjs/core/Materials/standardMaterial').StandardMaterial | import('@babylonjs/core/Materials/PBR/pbrMaterial').PBRMaterial,
    bindings: PhysicsBinding[],
    bumperBodies: PhysicsBody[],
    bumperVisuals: BumperVisual[],
    meshes: Mesh[]
  ): void {
    const mesh = MeshBuilder.CreateBox('sling', { width: 0.5, height: 2, depth: 4 }, this.scene)
    mesh.rotation.y = rot
    mesh.position.copyFrom(pos)
    mesh.material = mat

    const b = authorSlingshot(this.world, this.rapier, pos, rot)

    bindings.push({ mesh, rigidBody: b })
    bumperBodies.push(b)
    bumperVisuals.push({ mesh, body: b, hitTime: 0, sweep: 0 })
    meshes.push(mesh)
    this.meshes.push(mesh)
    this.bodies.push(b)
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
