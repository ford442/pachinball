import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Scene } from '@babylonjs/core/scene'
import type { PhysicsApi, PhysicsBody, PhysicsWorldSink } from '../core/physics-api'
import { GameConfig } from '../config'
import type { PinLattice, SeededPinField } from '../cascade/daily-cascade-layout'
import { PEG_BASE_RADIUS, PEG_HEIGHT, PEG_TOP_RADIUS, PIN_Y } from './pachinko-pin-field'
import { authorPachinkoField, PACHINKO_FIELD } from '../table/table-colliders'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding } from '../game-elements/types'
import { setPinLatticeInstances } from './pin-lattice'

interface PinPlacement {
  x: number
  z: number
}

export class PachinkoBuilder {
  private scene: Scene
  private world: PhysicsWorldSink
  private rapier: PhysicsApi

  private matLib: ReturnType<typeof getMaterialLibrary>
  private meshes: AbstractMesh[] = []
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

  createPachinkoField(
    center: Vector3 = new Vector3(PACHINKO_FIELD.center.x, PACHINKO_FIELD.center.y, PACHINKO_FIELD.center.z),
    width: number = PACHINKO_FIELD.width,
    height: number = PACHINKO_FIELD.height,
    pinPositions?: { x: number; z: number }[],
    pinLattice?: PinLattice,
    seededField?: SeededPinField,
  ): {
    bindings: PhysicsBinding[]
    targetBodies: PhysicsBody[]
    targetMeshes: Mesh[]
    targetActive: boolean[]
    targetRespawnTimer: number[]
    meshes: AbstractMesh[]
    /** `[latticeMesh]` — every pin is one instance of it. Empty when the layout has no pins. */
    pins: AbstractMesh[]
    /**
     * Every pin collider's body: the one pin-field body on the C++ owner, else one fixed body
     * per pin. Only the first is bound to the lattice mesh, so table enable/disable and the
     * C++ export reach the rest through this list.
     */
    pinBodies: PhysicsBody[]
  } {
    const bindings: PhysicsBinding[] = []
    const targetBodies: PhysicsBody[] = []
    const targetMeshes: Mesh[] = []
    const targetActive: boolean[] = []
    const targetRespawnTimer: number[] = []
    const meshes: AbstractMesh[] = []
    const pins: AbstractMesh[] = []
    const pinBodies: PhysicsBody[] = []

    // Enhanced peg material with map-reactive emissive tips
    const pinMat = this.matLib.getEnhancedPinMaterial()

    const pegHeight = PEG_HEIGHT
    const baseRadius = PEG_BASE_RADIUS
    const topRadius = PEG_TOP_RADIUS

    // ================================================================
    // PINS – ONE mesh for the whole lattice. Its instances are a static
    // thin-instance matrix buffer built below from `resolvePinField`, so the
    // lattice is a single scene node and a single draw call.
    //
    // It used to be an InstancedMesh per pin over three LOD templates. LOD is
    // per mesh, not per instance, so a thin-instance lattice cannot keep it:
    // one geometry is used, the 'med' one. From the fixed table camera 87 of
    // 91 vanilla pins were on 'low' and 4 on 'med' ('high' was never chosen),
    // so this is the same or finer everywhere.
    // ================================================================

    const buildTemplate = (tess: number, capSeg: number, bevelTess: number): Mesh => {
      const cyl = MeshBuilder.CreateCylinder('pinT', {
        diameterTop: topRadius * 2,
        diameterBottom: baseRadius * 2,
        height: pegHeight,
        tessellation: tess,
      }, this.scene)

      const cap = MeshBuilder.CreateSphere('pinCapT', {
        diameter: topRadius * 2.2,
        slice: 0.5,
        segments: capSeg,
      }, this.scene)
      cap.position.y = pegHeight / 2 - 0.02

      const bevel = MeshBuilder.CreateTorus('pinBevelT', {
        diameter: baseRadius * 2.3,
        thickness: 0.025,
        tessellation: bevelTess,
      }, this.scene)
      bevel.position.y = -pegHeight / 2 + 0.03
      bevel.rotation.x = Math.PI / 2

      // Merge the parts into ONE mesh with ONE submesh (the last argument, multiMultiMaterials,
      // is false: `true` made a submesh per part, and each submesh is its own instanced draw).
      const merged = Mesh.MergeMeshes([cyl, cap, bevel], true, true, undefined, false, false)!
      merged.name = 'pachinkoPins'
      merged.material = pinMat
      return merged
    }

    // ================================================================
    // PHYSICS – one pin-field descriptor for the whole lattice. The C++
    // owner (WasmTableWorld) takes it as ONE collider and exports it with a
    // single addPinField; Rapier has no such shape, so there every pin is
    // its own fixed cylinder. The visual instances come from the same
    // resolver either way, so they sit exactly on the pins that collide.
    // ================================================================
    const field = authorPachinkoField(this.world, this.rapier, center, width, height, pinPositions, pinLattice, seededField)
    const placements: PinPlacement[] = field.placements
    pinBodies.push(...field.pinBodies)
    this.bodies.push(...field.pinBodies)

    if (placements.length > 0) {
      const lattice = buildTemplate(8, 6, 8)
      setPinLatticeInstances(
        lattice,
        placements.map(({ x, z }) => ({ x, y: PIN_Y, z })),
        undefined,
        'pachinko pin lattice',
      )

      // One binding for the lattice, to the first pin body (the field body on the owner). Every
      // pin body is fixed, so pose sync skips it and the mesh stays at the origin; the binding
      // only keeps the mesh and a collider findable together. Table enable/disable reaches the
      // other pin bodies through `pinBodies`, and the mesh through `meshes`.
      bindings.push({ mesh: lattice, rigidBody: pinBodies[0] })
      meshes.push(lattice)
      pins.push(lattice)
      this.meshes.push(lattice)
    }

    // Catcher in the center of the pachinko field
    const catcher = MeshBuilder.CreateTorus('catcher', { diameter: 2.5, thickness: 0.2 }, this.scene)
    catcher.position.set(center.x, 0.2, center.z)
    catcher.material = this.matLib.getCatcherMaterial()

    const catchBody = field.catchBody

    targetBodies.push(catchBody)
    targetMeshes.push(catcher)
    targetActive.push(true)
    targetRespawnTimer.push(0)
    meshes.push(catcher)
    this.meshes.push(catcher)
    this.bodies.push(catchBody)

    return {
      bindings,
      targetBodies,
      targetMeshes,
      targetActive,
      targetRespawnTimer,
      meshes,
      pins,
      pinBodies,
    }
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
