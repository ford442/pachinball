import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Scene } from '@babylonjs/core/scene'
import { supportsPinFields, type PhysicsApi, type PhysicsBody, type PhysicsWorldSink } from '../core/physics-api'
import { resolvePinField } from '../core/pin-field'
import { GameConfig } from '../config'
import type { PinLattice } from '../game-elements/daily-cascade-layout'
import {
  PEG_BASE_RADIUS,
  PEG_COLLIDER_RADIUS,
  PEG_FRICTION,
  PEG_HEIGHT,
  PEG_RESTITUTION,
  PEG_TOP_RADIUS,
  PIN_Y,
  pachinkoPinFieldSpec,
  pinInKeepOut,
} from './pachinko-pin-field'
import { COLLISION_GROUP_PRESETS } from '../game-elements/physics'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding } from '../game-elements/types'

interface PinPlacement {
  x: number
  z: number
  name: string
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
    center: Vector3 = new Vector3(0, 0.5, 6),
    width: number = 24,
    height: number = 22,
    pinPositions?: { x: number; z: number }[],
    pinLattice?: PinLattice,
  ): {
    bindings: PhysicsBinding[]
    targetBodies: PhysicsBody[]
    targetMeshes: Mesh[]
    targetActive: boolean[]
    targetRespawnTimer: number[]
    meshes: AbstractMesh[]
    pins: AbstractMesh[]
  } {
    const bindings: PhysicsBinding[] = []
    const targetBodies: PhysicsBody[] = []
    const targetMeshes: Mesh[] = []
    const targetActive: boolean[] = []
    const targetRespawnTimer: number[] = []
    const meshes: AbstractMesh[] = []
    const pins: AbstractMesh[] = []

    // Enhanced peg material with map-reactive emissive tips
    const pinMat = this.matLib.getEnhancedPinMaterial()

    const pegHeight = PEG_HEIGHT
    const baseRadius = PEG_BASE_RADIUS
    const topRadius = PEG_TOP_RADIUS

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
    this.meshes.push(pinHigh, pinMed, pinLow)

    // ================================================================
    // PHYSICS – one pin-field descriptor for the whole lattice. The C++
    // owner (WasmTableWorld) takes it as ONE collider and exports it with a
    // single addPinField; Rapier has no such shape, so there every pin is
    // its own fixed cylinder. The visual instances come from the same
    // resolver either way, so they sit exactly on the pins that collide.
    // ================================================================
    const spec = pachinkoPinFieldSpec(center, width, height, pinPositions, pinLattice)
    const placements: PinPlacement[] = spec
      ? resolvePinField(spec).map((pin) => ({
          x: pin.position.x,
          z: pin.position.z,
          name: pinPositions?.length ? `pin_seed_${pin.row}_${pin.col}` : `pin_${pin.row}_${pin.col}`,
        }))
      : this.offLatticePlacements(pinPositions ?? [])

    let fieldBody: PhysicsBody | null = null
    if (spec && supportsPinFields(this.world)) {
      fieldBody = this.world.createPinField(spec)
      this.bodies.push(fieldBody)
    }

    for (const { x, z, name } of placements) {
      const inst = pinHigh.createInstance(name)
      inst.position.set(x, PIN_Y, z)
      inst.isPickable = false
      inst.freezeWorldMatrix()

      // Every instance binds to the one field body where there is one: the
      // body is fixed (no pose sync), and table enable/disable still finds it.
      const body = fieldBody ?? this.createPinBody(x, z)
      bindings.push({ mesh: inst, rigidBody: body })
      meshes.push(inst)
      pins.push(inst)
      this.meshes.push(inst)
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
        .setCollisionGroups(COLLISION_GROUP_PRESETS.SENSOR)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      catchBody
    )

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
      pins
    }
  }

  /** A Rapier-path pin (or an off-lattice seeded one): its own fixed cylinder. */
  private createPinBody(x: number, z: number): PhysicsBody {
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(x, PIN_Y, z)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cylinder(PEG_HEIGHT / 2, PEG_COLLIDER_RADIUS)
        .setRestitution(PEG_RESTITUTION)
        .setFriction(PEG_FRICTION)
        .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
      body
    )
    this.bodies.push(body)
    return body
  }

  /** Seeded positions with no lattice to fit: filter the keep-outs and place each pin. */
  private offLatticePlacements(pinPositions: readonly { x: number; z: number }[]): PinPlacement[] {
    const placements: PinPlacement[] = []
    pinPositions.forEach((p, i) => {
      if (!pinInKeepOut(p.x, p.z)) placements.push({ x: p.x, z: p.z, name: `pin_seed_${i}` })
    })
    return placements
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
