import { Scene, Vector3, MeshBuilder, Mesh, AbstractMesh } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { GameConfig } from '../config'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding } from '../game-elements/types'

export class PachinkoBuilder {
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

  createPachinkoField(
    center: Vector3 = new Vector3(0, 0.5, 6),
    width: number = 24,
    height: number = 22
  ): {
    bindings: PhysicsBinding[]
    targetBodies: RAPIER.RigidBody[]
    targetMeshes: Mesh[]
    targetActive: boolean[]
    targetRespawnTimer: number[]
    meshes: AbstractMesh[]
    pins: AbstractMesh[]
  } {
    const bindings: PhysicsBinding[] = []
    const targetBodies: RAPIER.RigidBody[] = []
    const targetMeshes: Mesh[] = []
    const targetActive: boolean[] = []
    const targetRespawnTimer: number[] = []
    const meshes: AbstractMesh[] = []
    const pins: AbstractMesh[] = []

    // Enhanced peg material with map-reactive emissive tips
    const pinMat = this.matLib.getEnhancedPinMaterial()

    // Dense pachinko grid
    const rows = 10
    const cols = 13
    const spacingX = width / cols
    const spacingZ = height / rows

    const pegHeight = 1.5
    const baseRadius = 0.12
    const topRadius = 0.06
    const avgRadius = (baseRadius + topRadius) / 2

    // ================================================================
    // INSTANCED PINS – create 3 LOD template meshes once, then
    // stamp instances for every grid position.  All instances share
    // the same vertex buffer → O(LOD_levels) draw-calls instead of
    // O(pin_count).
    // ================================================================

    const buildTemplate = (suffix: string, tess: number, capSeg: number, bevelTess: number): Mesh => {
      const cyl = MeshBuilder.CreateCylinder(`pinT_${suffix}`, {
        diameterTop: topRadius * 2,
        diameterBottom: baseRadius * 2,
        height: pegHeight,
        tessellation: tess,
      }, this.scene) as Mesh

      const cap = MeshBuilder.CreateSphere(`pinCapT_${suffix}`, {
        diameter: topRadius * 2.2,
        slice: 0.5,
        segments: capSeg,
      }, this.scene) as Mesh
      cap.position.y = pegHeight / 2 - 0.02

      const bevel = MeshBuilder.CreateTorus(`pinBevelT_${suffix}`, {
        diameter: baseRadius * 2.3,
        thickness: 0.025,
        tessellation: bevelTess,
      }, this.scene) as Mesh
      bevel.position.y = -pegHeight / 2 + 0.03
      bevel.rotation.x = Math.PI / 2

      // Merge sub-meshes into a single draw-call-efficient mesh at origin
      const merged = Mesh.MergeMeshes([cyl, cap, bevel], true, true, undefined, false, true)!
      merged.material = pinMat
      merged.isPickable = false
      merged.isVisible = false  // template is hidden; instances render
      return merged
    }

    const pinHigh = buildTemplate('high', 12, 10, 10)
    const pinMed  = buildTemplate('med',   8,  6,  8)
    const pinLow  = buildTemplate('low',   6,  4,  6)

    pinHigh.addLODLevel(12, pinMed)
    pinHigh.addLODLevel(25, pinLow)
    pinHigh.addLODLevel(50, null)

    // Track templates so they are disposed and toggled with the scene
    meshes.push(pinHigh, pinMed, pinLow)

    for (let r = 0; r < rows; r++) {
      const offsetX = (r % 2 === 0) ? 0 : spacingX / 2
      for (let c = 0; c < cols; c++) {
        const x = center.x - (width / 2) + c * spacingX + offsetX
        const z = center.z - (height / 2) + r * spacingZ
        // Skip center area for the main catcher/target
        if (Math.abs(x) < 2.5 && Math.abs(z - center.z) < 2.5) continue

        // Instance inherits geometry + LOD from template; each instance
        // gets its own world transform but shares one vertex buffer.
        const inst = pinHigh.createInstance(`pin_${r}_${c}`)
        inst.position.set(x, 0.4, z)
        inst.isPickable = false
        // Static object: lock the world matrix in GPU memory
        inst.freezeWorldMatrix()

        const body = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.4, z)
        )
        this.world.createCollider(
          this.rapier.ColliderDesc.cylinder(pegHeight / 2, avgRadius)
            .setRestitution(0.65)
            .setFriction(0.1),
          body
        )

        // Fixed bodies are skipped in the physics-sync loop; the binding
        // is kept only so the body is reachable via getBindings() if needed.
        bindings.push({ mesh: inst, rigidBody: body })
        meshes.push(inst)
        pins.push(inst)
      }
    }

    // Catcher in the center of the pachinko field
    const catcher = MeshBuilder.CreateTorus('catcher', { diameter: 2.5, thickness: 0.2 }, this.scene)
    catcher.position.set(center.x, 0.2, center.z)
    catcher.material = this.matLib.getCatcherMaterial()

    const catchBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, 0.2, center.z)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cylinder(0.5, 1.0)
        .setSensor(true)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      catchBody
    )

    targetBodies.push(catchBody)
    targetMeshes.push(catcher)
    targetActive.push(true)
    targetRespawnTimer.push(0)
    meshes.push(catcher)

    return {
      bindings,
      targetBodies,
      targetMeshes,
      targetActive,
      targetRespawnTimer,
      meshes,
      pins
    }
  }
}
