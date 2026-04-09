import { Scene, Vector3, MeshBuilder, Mesh, Quaternion, StandardMaterial, Color3 } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { GameConfig } from '../config'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding, BumperVisual } from '../game-elements/types'

export class WallBuilder {
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

  createGround(): { binding: PhysicsBinding | null; meshes: Mesh[] } {
    const groundMat = this.matLib.getPlayfieldMaterial()
    const meshes: Mesh[] = []

    const ground = MeshBuilder.CreateGround('ground', { width: GameConfig.table.width, height: GameConfig.table.height }, this.scene) as Mesh
    ground.position.set(0, -1, 5)
    ground.material = groundMat

    const groundBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(0, -1, 5)
    )
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(GameConfig.table.width / 2, 0.1, GameConfig.table.height / 2), groundBody)

    const binding: PhysicsBinding = { mesh: ground, rigidBody: groundBody }

    // Flipper zone visibility enhancement (disabled in reduced motion mode)
    if (!GameConfig.camera.reducedMotion) {
      const flipperGlow = MeshBuilder.CreateGround('flipperGlow', { width: 10, height: 6 }, this.scene)
      flipperGlow.position.set(0, -0.95, -7)
      const glowMat = new StandardMaterial('flipperGlowMat', this.scene)
      glowMat.diffuseColor = Color3.Black()
      glowMat.emissiveColor = Color3.FromHexString('#001133')
      glowMat.alpha = 0.3
      flipperGlow.material = glowMat
      meshes.push(flipperGlow)
    }

    meshes.push(ground)
    return { binding, meshes }
  }

  createWalls(): { bindings: PhysicsBinding[]; meshes: Mesh[] } {
    const bindings: PhysicsBinding[] = []
    const meshes: Mesh[] = []

    // Use MaterialLibrary for smoked glass walls
    const wallMat = this.matLib.getSmokedGlassMaterial()
    const wallH = GameConfig.table.wallHeight

    // 1. Outer Walls
    this.createWall(new Vector3(-10, wallH, 5), new Vector3(0.2, 5, 32), wallMat, bindings, meshes)
    this.createWall(new Vector3(11.5, wallH, 5), new Vector3(0.2, 5, 32), wallMat, bindings, meshes)
    this.createWall(new Vector3(0.75, wallH, 20.5), new Vector3(22.5, 5, 1.0), wallMat, bindings, meshes) // Top

    // 2. Drain / Plunger Base Walls
    this.createWall(new Vector3(10.5, wallH, -10.5), new Vector3(1.9, 5, 1.0), wallMat, bindings, meshes) // Plunger Base

    // 3. Shortened Plunger Lane Guide
    this.createWall(
      new Vector3(9.5, wallH, GameConfig.table.laneGuideZ),
      new Vector3(0.2, 5, GameConfig.table.laneGuideLength),
      wallMat,
      bindings,
      meshes
    )

    // 4. Create Corner Wedges
    this.createCornerWedges(wallH, bindings, meshes)

    return { bindings, meshes }
  }

  private createCornerWedges(height: number, bindings: PhysicsBinding[], meshes: Mesh[]): void {
    const wedgeSize = GameConfig.table.wedgeSize
    const thickness = GameConfig.table.wedgeThickness

    const wedgeMat = this.matLib.getBrushedMetalMaterial()

    // Calculate diagonal width
    const diagWidth = Math.sqrt(2 * (wedgeSize * wedgeSize))

    const createWedge = (name: string, x: number, z: number, rotationY: number) => {
      const wedge = MeshBuilder.CreateBox(name, {
        width: diagWidth,
        height: height,
        depth: thickness
      }, this.scene)

      wedge.position.set(x, 1, z)
      wedge.rotation.y = rotationY
      wedge.material = wedgeMat

      const q = Quaternion.FromEulerAngles(0, rotationY, 0)
      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.fixed()
          .setTranslation(x, 1, z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      )

      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(diagWidth / 2, height / 2, thickness / 2)
          .setRestitution(0.5),
        body
      )

      bindings.push({ mesh: wedge, rigidBody: body })
      meshes.push(wedge)
    }

    // Top Left Corner Calculation
    const tlX = -10 + (wedgeSize / 2)
    const tlZ = 20.5 - (wedgeSize / 2)
    createWedge('wedgeTL', tlX, tlZ, -Math.PI / 4) // 45 degrees

    // Top Right Corner Calculation
    const trX = 11.5 - (wedgeSize / 2)
    const trZ = 20.5 - (wedgeSize / 2)
    createWedge('wedgeTR', trX, trZ, Math.PI / 4) // -45 degrees
  }

  private createWall(
    pos: Vector3,
    size: Vector3,
    mat: import('@babylonjs/core').StandardMaterial | import('@babylonjs/core').PBRMaterial,
    bindings: PhysicsBinding[],
    meshes: Mesh[]
  ): void {
    const w = MeshBuilder.CreateBox('w', { width: size.x, height: size.y * 2, depth: size.z }, this.scene)
    w.position.copyFrom(pos)
    w.material = mat

    const b = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(size.x / 2, size.y, size.z / 2)
        .setFriction(0.1),
      b
    )

    bindings.push({ mesh: w, rigidBody: b })
    meshes.push(w)
  }

  createSlingshots(): {
    bindings: PhysicsBinding[]
    bumperBodies: RAPIER.RigidBody[]
    bumperVisuals: BumperVisual[]
    meshes: Mesh[]
  } {
    const bindings: PhysicsBinding[] = []
    const bumperBodies: RAPIER.RigidBody[] = []
    const bumperVisuals: BumperVisual[] = []
    const meshes: Mesh[] = []

    const slingMat = this.matLib.getNeonSlingshotMaterial()

    this.createSlingshot(new Vector3(-6.5, 0, -3), -Math.PI / 6, slingMat, bindings, bumperBodies, bumperVisuals, meshes)
    this.createSlingshot(new Vector3(6.5, 0, -3), Math.PI / 6, slingMat, bindings, bumperBodies, bumperVisuals, meshes)

    return { bindings, bumperBodies, bumperVisuals, meshes }
  }

  private createSlingshot(
    pos: Vector3,
    rot: number,
    mat: import('@babylonjs/core').StandardMaterial | import('@babylonjs/core').PBRMaterial,
    bindings: PhysicsBinding[],
    bumperBodies: RAPIER.RigidBody[],
    bumperVisuals: BumperVisual[],
    meshes: Mesh[]
  ): void {
    const mesh = MeshBuilder.CreateBox('sling', { width: 0.5, height: 2, depth: 4 }, this.scene)
    mesh.rotation.y = rot
    mesh.position.copyFrom(pos)
    mesh.material = mat

    const q = Quaternion.FromEulerAngles(0, rot, 0)
    const b = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(0.25, 1, 2)
        .setRestitution(1.5)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      b
    )

    bindings.push({ mesh, rigidBody: b })
    bumperBodies.push(b)
    bumperVisuals.push({ mesh, body: b, hitTime: 0, sweep: 0 })
    meshes.push(mesh)
  }
}
