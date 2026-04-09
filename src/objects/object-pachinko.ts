import { Scene, Vector3, MeshBuilder, Mesh } from '@babylonjs/core'
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
    meshes: Mesh[]
    pins: Mesh[]
  } {
    const bindings: PhysicsBinding[] = []
    const targetBodies: RAPIER.RigidBody[] = []
    const targetMeshes: Mesh[] = []
    const targetActive: boolean[] = []
    const targetRespawnTimer: number[] = []
    const meshes: Mesh[] = []
    const pins: Mesh[] = []

    // Enhanced peg material with map-reactive emissive tips
    const pinMat = this.matLib.getEnhancedPinMaterial()

    // Dense pachinko grid
    const rows = 10
    const cols = 13
    const spacingX = width / cols
    const spacingZ = height / rows

    for (let r = 0; r < rows; r++) {
      const offsetX = (r % 2 === 0) ? 0 : spacingX / 2
      for (let c = 0; c < cols; c++) {
        const x = center.x - (width / 2) + c * spacingX + offsetX
        const z = center.z - (height / 2) + r * spacingZ
        // Skip center area for the main catcher/target
        if (Math.abs(x) < 2.5 && Math.abs(z - center.z) < 2.5) continue

        const pegHeight = 1.5
        const baseRadius = 0.12
        const topRadius = 0.06

        // ================================================================
        // ENHANCED PEG - Tapered cylinder with rounded top and base bevel
        // ================================================================

        // Main tapered body
        const pin = MeshBuilder.CreateCylinder(`pin_${r}_${c}`, {
          diameterTop: topRadius * 2,
          diameterBottom: baseRadius * 2,
          height: pegHeight,
          tessellation: 12
        }, this.scene)
        pin.position.set(x, 0.4, z)
        pin.material = pinMat

        // Rounded top cap
        const pinCap = MeshBuilder.CreateSphere(`pinCap_${r}_${c}`, {
          diameter: topRadius * 2.2,
          slice: 0.5,
          segments: 10
        }, this.scene)
        pinCap.position.set(x, 0.4 + pegHeight / 2 - 0.02, z)
        pinCap.material = pinMat

        // Base bevel ring for visual polish
        const pinBevel = MeshBuilder.CreateTorus(`pinBevel_${r}_${c}`, {
          diameter: baseRadius * 2.3,
          thickness: 0.025,
          tessellation: 10
        }, this.scene)
        pinBevel.position.set(x, 0.4 - pegHeight / 2 + 0.03, z)
        pinBevel.rotation.x = Math.PI / 2
        pinBevel.material = pinMat

        const body = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.4, z)
        )

        // Thin collider matching tapered shape
        const avgRadius = (baseRadius + topRadius) / 2
        this.world.createCollider(
          this.rapier.ColliderDesc.cylinder(pegHeight / 2, avgRadius)
            .setRestitution(0.65)
            .setFriction(0.1),
          body
        )

        bindings.push({ mesh: pin, rigidBody: body })
        meshes.push(pin, pinCap, pinBevel)
        pins.push(pin)
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
