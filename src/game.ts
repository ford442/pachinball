import {
  ArcRotateCamera,
  Color3,
  HemisphericLight,
  MeshBuilder,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { Nullable } from '@babylonjs/core/types'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type * as RAPIER from '@dimforge/rapier3d-compat'

const GRAVITY = new Vector3(0, -9.81, 0)

interface PhysicsBinding {
  mesh: TransformNode
  rigidBody: RAPIER.RigidBody
}

export class Game {
  private readonly engine: Engine | WebGPUEngine
  private scene: Nullable<Scene> = null
  private rapier: typeof RAPIER | null = null
  private world: RAPIER.World | null = null
  private bindings: PhysicsBinding[] = []
  private flipperBody: RAPIER.RigidBody | null = null
  private ready = false

  constructor(engine: Engine | WebGPUEngine) {
    this.engine = engine
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if ('initAsync' in this.engine) {
      await this.engine.initAsync()
    }

    this.scene = new Scene(this.engine)
    this.scene.clearColor = Color3.Black().toColor4(1)

    const camera = new ArcRotateCamera('camera', Math.PI / 2.5, 1, 25, new Vector3(0, 1, 0), this.scene)
    camera.attachControl(canvas, true)

    new HemisphericLight('light', new Vector3(0.3, 1, 0.3), this.scene)

    await this.initPhysics()
    this.buildScene()

    this.scene.onBeforeRenderObservable.add(() => {
      this.stepPhysics()
    })

    this.engine.runRenderLoop(() => {
      this.scene?.render()
    })

    window.addEventListener('keydown', this.onKeyDown)
    this.ready = true
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    this.scene?.dispose()
    this.world?.free()
    this.scene = null
    this.world = null
    this.rapier = null
    this.bindings = []
    this.flipperBody = null
    this.ready = false
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || !this.ready || !this.flipperBody || !this.rapier) return
    const torque = new this.rapier.Vector3(0, 80, 0)
    this.flipperBody.applyTorqueImpulse(torque, true)
  }

  private async initPhysics(): Promise<void> {
    if (this.rapier) return
    this.rapier = await import('@dimforge/rapier3d-compat')
    await this.rapier.init()
    this.world = new this.rapier.World(new this.rapier.Vector3(GRAVITY.x, GRAVITY.y, GRAVITY.z))
  }

  private buildScene(): void {
    if (!this.scene || !this.world || !this.rapier) {
      throw new Error('Scene or physics not initialized')
    }

    const ground = MeshBuilder.CreateGround('ground', { width: 20, height: 20 }, this.scene)
    ground.position.y = -1
    const groundBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, -1, 0))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(10, 0.1, 10), groundBody)
    this.bindings.push({ mesh: ground, rigidBody: groundBody })

    const ball = MeshBuilder.CreateSphere('ball', { diameter: 1 }, this.scene)
    ball.position.set(0, 5, 0)
    const ballBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.dynamic().setTranslation(0, 5, 0))
    this.world.createCollider(this.rapier.ColliderDesc.ball(0.5).setRestitution(0.7), ballBody)
    this.bindings.push({ mesh: ball, rigidBody: ballBody })

    const flipper = MeshBuilder.CreateBox('flipper', { width: 3, depth: 0.5, height: 0.3 }, this.scene)
    flipper.rotationQuaternion = Quaternion.Identity()
    flipper.position.set(-4, -0.5, 0)

    const flipperBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic().setTranslation(-4, -0.5, 0)
    )
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(1.5, 0.15, 0.25).setFriction(0.9), flipperBody)
    this.bindings.push({ mesh: flipper, rigidBody: flipperBody })
    this.flipperBody = flipperBody

    const anchorBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(-4, -0.5, 0))

    const hinge = this.rapier.JointData.revolute(
      new this.rapier.Vector3(-1.5, 0, 0),
      new this.rapier.Vector3(0, 0, 0),
      new this.rapier.Vector3(0, 1, 0)
    )

    const joint = this.world.createImpulseJoint(hinge, anchorBody, flipperBody, true)
    joint.configureMotorVelocity(0, 400)
  }

  private stepPhysics(): void {
    if (!this.world || !this.scene || !this.rapier) return

    this.world.step()

    for (const binding of this.bindings) {
      const translation = binding.rigidBody.translation()
      const rotation = binding.rigidBody.rotation()
      binding.mesh.position.set(translation.x, translation.y, translation.z)
      binding.mesh.rotationQuaternion = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
    }
  }
}
