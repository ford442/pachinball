// Main GameObjects orchestrator
import { Scene, Vector3, Mesh, AbstractMesh, MeshBuilder, TransformNode, StandardMaterial, Color3 } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { GameConfig } from '../config'
import type { PhysicsBinding, BumperVisual } from '../game-elements/types'
import { FlipperBuilder } from './object-flippers'
import { BumperBuilder } from './object-bumpers'
import { WallBuilder } from './object-walls'
import { RailBuilder } from './object-rails'
import { PachinkoBuilder } from './object-pachinko'
import { DecorationBuilder } from './object-decoration'
import type { GameObjectRefs } from './object-types'

export class GameObjects {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private config: typeof GameConfig
  private bindings: PhysicsBinding[] = []
  private bumperVisuals: BumperVisual[] = []
  private bumperBodies: RAPIER.RigidBody[] = []
  private targetBodies: RAPIER.RigidBody[] = []
  private targetMeshes: Mesh[] = []
  private targetActive: boolean[] = []
  private targetRespawnTimer: number[] = []
  private flipperLeftJoint: RAPIER.ImpulseJoint | null = null
  private flipperRightJoint: RAPIER.ImpulseJoint | null = null
  private deathZoneBody: RAPIER.RigidBody | null = null
  private pinballMeshes: AbstractMesh[] = []

  // Sub-builders
  private flipperBuilder: FlipperBuilder
  private bumperBuilder: BumperBuilder
  private wallBuilder: WallBuilder
  private railBuilder: RailBuilder
  private pachinkoBuilder: PachinkoBuilder
  private decorationBuilder: DecorationBuilder

  // References
  private refs: GameObjectRefs = {
    flippers: new Map(),
    bumpers: new Map(),
    walls: [],
    rails: [],
    pins: []
  }

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    config: typeof GameConfig
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.config = config

    this.flipperBuilder = new FlipperBuilder(scene, world, rapier, config)
    this.bumperBuilder = new BumperBuilder(scene, world, rapier)
    this.wallBuilder = new WallBuilder(scene, world, rapier, config)
    this.railBuilder = new RailBuilder(scene, world, rapier, config)
    this.pachinkoBuilder = new PachinkoBuilder(scene, world, rapier, config)
    this.decorationBuilder = new DecorationBuilder(scene, world, rapier, config)
  }

  createCabinetDecoration(): void {
    this.decorationBuilder.createCabinetDecoration()
    // Collect bindings and meshes from decoration builder
    this.bindings.push(...this.decorationBuilder.getBindings())
    this.pinballMeshes.push(...this.decorationBuilder.getPinballMeshes())
  }

  createGround(): void {
    const ground = this.wallBuilder.createGround()
    if (ground.binding) {
      this.bindings.push(ground.binding)
    }
    this.pinballMeshes.push(...ground.meshes)
  }

  createFlipperRamps(): void {
    const result = this.railBuilder.createFlipperRamps()
    this.pinballMeshes.push(...result.meshes)
  }

  createWalls(): void {
    const result = this.wallBuilder.createWalls()
    this.bindings.push(...result.bindings)
    this.pinballMeshes.push(...result.meshes)
    this.refs.walls = result.meshes
  }

  createDrainRails(): void {
    const result = this.railBuilder.createDrainRails()
    this.pinballMeshes.push(...result.meshes)
  }

  createDeathZone(): void {
    this.deathZoneBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(0, -2, -14)
    )
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(20, 2, 2)
        .setSensor(true)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      this.deathZoneBody
    )

    const deathZoneVis = MeshBuilder.CreateBox('deathZoneVis', { width: 40, height: 0.1, depth: 4 }, this.scene)
    deathZoneVis.position.set(0, -2, -14)
    const deathMat = new StandardMaterial('deathMat', this.scene)
    deathMat.emissiveColor = Color3.Red()
    deathMat.alpha = 0.2
    deathZoneVis.material = deathMat
  }

  createFlippers(): { left: RAPIER.ImpulseJoint; right: RAPIER.ImpulseJoint } {
    const result = this.flipperBuilder.createFlippers()
    
    for (const [key, value] of result.flippers) {
      this.refs.flippers.set(key, value)
    }
    this.bindings.push(...result.bindings)
    this.pinballMeshes.push(...result.meshes)
    
    this.flipperLeftJoint = result.leftJoint
    this.flipperRightJoint = result.rightJoint

    return {
      left: this.flipperLeftJoint,
      right: this.flipperRightJoint
    }
  }

  createBumpers(): void {
    const result = this.bumperBuilder.createBumpers()
    for (const [key, value] of result.bumpers) {
      this.refs.bumpers.set(key, value)
    }
    this.bindings.push(...result.bindings)
    this.bumperBodies.push(...result.bumperBodies)
    this.bumperVisuals.push(...result.bumperVisuals)
    this.pinballMeshes.push(...result.meshes)
  }

  createPachinkoField(center?: Vector3, width?: number, height?: number): void {
    const result = this.pachinkoBuilder.createPachinkoField(center, width, height)
    this.bindings.push(...result.bindings)
    this.targetBodies.push(...result.targetBodies)
    this.targetMeshes.push(...result.targetMeshes)
    this.targetActive.push(...result.targetActive)
    this.targetRespawnTimer.push(...result.targetRespawnTimer)
    this.pinballMeshes.push(...result.meshes)
    this.refs.pins = result.pins
  }

  createSlingshots(): void {
    const result = this.wallBuilder.createSlingshots()
    this.bindings.push(...result.bindings)
    this.bumperBodies.push(...result.bumperBodies)
    this.bumperVisuals.push(...result.bumperVisuals)
    this.pinballMeshes.push(...result.meshes)
  }

  updateBumpers(dt: number): void {
    this.bumperBuilder.updateBumpers(dt, this.bumperVisuals)
  }

  updateTargets(dt: number): void {
    for (let i = 0; i < this.targetActive.length; i++) {
      if (!this.targetActive[i]) {
        this.targetRespawnTimer[i] -= dt
        if (this.targetRespawnTimer[i] <= 0) {
          this.targetActive[i] = true
          this.targetMeshes[i].isVisible = true
        }
      } else {
        const pulse = Math.sin(performance.now() * 0.005) * 0.1 + 1
        this.targetMeshes[i].scaling.set(pulse, pulse, pulse)
      }
    }
  }

  activateBumperHit(body: RAPIER.RigidBody): void {
    const vis = this.bumperVisuals.find(v => v.body === body)
    if (vis) {
      vis.hitTime = 0.2
    }
  }

  setBumperState(state: 'IDLE' | 'REACH' | 'FEVER' | 'JACKPOT' | 'ADVENTURE'): void {
    this.bumperBuilder.setBumperState(state, this.bumperVisuals)
  }

  updateBumperColors(mapColorHex: string): void {
    this.bumperBuilder.updateBumperColors(mapColorHex, this.bumperVisuals)
  }

  deactivateTarget(body: RAPIER.RigidBody): boolean {
    const idx = this.targetBodies.indexOf(body)
    if (idx !== -1 && this.targetActive[idx]) {
      this.targetActive[idx] = false
      this.targetMeshes[idx].isVisible = false
      this.targetRespawnTimer[idx] = this.config.gameplay.targetRespawnTime
      return true
    }
    return false
  }

  resetTargets(): void {
    this.targetActive.fill(true)
    this.targetRespawnTimer.fill(0)
    this.targetMeshes.forEach(m => {
      m.isVisible = true
      m.scaling.set(1, 1, 1)
    })
  }

  getBindings(): PhysicsBinding[] {
    return this.bindings
  }

  getBumperBodies(): RAPIER.RigidBody[] {
    return this.bumperBodies
  }

  getBumperVisuals(): BumperVisual[] {
    return this.bumperVisuals
  }

  getTargetBodies(): RAPIER.RigidBody[] {
    return this.targetBodies
  }

  getDeathZoneBody(): RAPIER.RigidBody | null {
    return this.deathZoneBody
  }

  getFlipperJoints(): { left: RAPIER.ImpulseJoint | null; right: RAPIER.ImpulseJoint | null } {
    return {
      left: this.flipperLeftJoint,
      right: this.flipperRightJoint
    }
  }

  getPinballMeshes(): AbstractMesh[] {
    return this.pinballMeshes
  }

  getFlipper(name: string): { mesh: TransformNode; body: RAPIER.RigidBody; joint: RAPIER.ImpulseJoint } | undefined {
    return this.refs.flippers.get(name)
  }

  getAllFlippers(): Map<string, { mesh: TransformNode; body: RAPIER.RigidBody; joint: RAPIER.ImpulseJoint }> {
    return this.refs.flippers
  }

  getBumper(name: string): Mesh | undefined {
    return this.refs.bumpers.get(name)
  }

  getAllBumpers(): Map<string, Mesh> {
    return this.refs.bumpers
  }

  addBinding(binding: PhysicsBinding): void {
    this.bindings.push(binding)
  }

  removeBinding(rigidBody: RAPIER.RigidBody): void {
    const idx = this.bindings.findIndex(b => b.rigidBody === rigidBody)
    if (idx !== -1) {
      this.bindings[idx].mesh.dispose()
      this.bindings.splice(idx, 1)
    }
  }

  dispose(): void {
    this.bumperBuilder.dispose()
    this.pinballMeshes.forEach(m => m.dispose())
    this.bindings = []
    this.bumperVisuals = []
    this.bumperBodies = []
    this.targetBodies = []
    this.targetMeshes = []
    this.targetActive = []
    this.targetRespawnTimer = []
    this.pinballMeshes = []
  }
}
