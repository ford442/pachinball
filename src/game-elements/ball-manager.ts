import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  Color3,
  TrailMesh,
} from '@babylonjs/core'
import type { Mesh, MirrorTexture } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { GameConfig } from '../config'
import type { PhysicsBinding, CaughtBall } from './types'

export class BallManager {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private ballBody: RAPIER.RigidBody | null = null
  private ballBodies: RAPIER.RigidBody[] = []
  private caughtBalls: CaughtBall[] = []
  private mirrorTexture: MirrorTexture | null = null
  private bindings: PhysicsBinding[] = []

  constructor(scene: Scene, world: RAPIER.World, rapier: typeof RAPIER, bindings: PhysicsBinding[]) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.bindings = bindings
  }

  setMirrorTexture(texture: MirrorTexture): void {
    this.mirrorTexture = texture
  }

  createMainBall(): RAPIER.RigidBody {
    const ballMat = new StandardMaterial('ballMat', this.scene)
    ballMat.diffuseColor = Color3.White()
    ballMat.emissiveColor = new Color3(0.2, 0.2, 0.2)

    const ball = MeshBuilder.CreateSphere('ball', { diameter: 1 }, this.scene) as Mesh
    ball.material = ballMat
    
    const spawn = GameConfig.ball.spawnMain
    const ballBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setCcdEnabled(true)
    )
    
    this.world.createCollider(
      this.rapier.ColliderDesc.ball(GameConfig.ball.radius)
        .setRestitution(GameConfig.ball.restitution)
        .setFriction(GameConfig.ball.friction)
        .setActiveEvents(
          this.rapier.ActiveEvents.COLLISION_EVENTS | 
          this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS
        ),
      ballBody
    )

    this.bindings.push({ mesh: ball, rigidBody: ballBody })
    this.ballBody = ballBody
    this.ballBodies.push(ballBody)
    
    if (this.mirrorTexture?.renderList) {
      this.mirrorTexture.renderList.push(ball)
    }

    const trail = new TrailMesh("ballTrail", ball, this.scene, 0.3, 20, true)
    const trailMat = new StandardMaterial("trailMat", this.scene)
    trailMat.emissiveColor = Color3.FromHexString("#00ffff")
    trail.material = trailMat

    return ballBody
  }

  spawnExtraBalls(count: number): void {
    const spawn = GameConfig.ball.spawnPachinko
    for (let i = 0; i < count; i++) {
      const b = MeshBuilder.CreateSphere("xb", { diameter: GameConfig.ball.radius * 2 }, this.scene) as Mesh
      // Offset slightly to avoid stacking
      b.position.set(spawn.x + (Math.random() - 0.5), spawn.y + (i * 2), spawn.z)
      
      const mat = new StandardMaterial("xbMat", this.scene)
      mat.diffuseColor = Color3.Green()
      b.material = mat

      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.dynamic()
          .setTranslation(b.position.x, b.position.y, b.position.z)
      )
      
      this.world.createCollider(
        this.rapier.ColliderDesc.ball(GameConfig.ball.radius)
          .setRestitution(GameConfig.ball.restitution)
          .setFriction(GameConfig.ball.friction)
          .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
        body
      )

      this.bindings.push({ mesh: b, rigidBody: body })
      this.ballBodies.push(body)
      
      if (this.mirrorTexture?.renderList) {
        this.mirrorTexture.renderList.push(b)
      }
    }
  }

  resetBall(): void {
    if (this.ballBodies.length === 0) {
      const mat = new StandardMaterial("ballMat", this.scene)
      mat.emissiveColor = new Color3(0.2, 0.2, 0.2)
      
      const b = MeshBuilder.CreateSphere("ball", { diameter: 1 }, this.scene) as Mesh
      b.material = mat
      
      const spawn = GameConfig.ball.spawnMain
      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.dynamic().setTranslation(spawn.x, spawn.y, spawn.z)
      )
      
      this.world.createCollider(
        this.rapier.ColliderDesc.ball(GameConfig.ball.radius)
          .setRestitution(GameConfig.ball.restitution)
          .setFriction(GameConfig.ball.friction)
          .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
        body
      )

      this.ballBody = body
      this.ballBodies.push(body)
      this.bindings.push({ mesh: b, rigidBody: body })
      
      if (this.mirrorTexture?.renderList) {
        this.mirrorTexture.renderList.push(b)
      }
    } else {
      const spawn = GameConfig.ball.spawnMain
      this.ballBody!.setTranslation(new this.rapier.Vector3(spawn.x, spawn.y, spawn.z), true)
      this.ballBody!.setLinvel(new this.rapier.Vector3(0, 0, 0), true)
      this.ballBody!.setAngvel(new this.rapier.Vector3(0, 0, 0), true)
    }
  }

  removeBall(body: RAPIER.RigidBody): void {
    const idx = this.ballBodies.indexOf(body)
    if (idx !== -1) {
      this.world.removeRigidBody(body)
      this.ballBodies.splice(idx, 1)
      
      const bIdx = this.bindings.findIndex(b => b.rigidBody === body)
      if (bIdx !== -1) {
        this.bindings[bIdx].mesh.dispose()
        this.bindings.splice(bIdx, 1)
      }
    }
  }

  removeExtraBalls(): void {
    for (let i = this.ballBodies.length - 1; i >= 0; i--) {
      const rb = this.ballBodies[i]
      if (rb !== this.ballBody) {
        this.world.removeRigidBody(rb)
        this.ballBodies.splice(i, 1)
      }
    }
    
    this.bindings = this.bindings.filter(b => {
      if (!b.mesh.name.startsWith('ball')) return true
      if (b.rigidBody === this.ballBody) return true
      b.mesh.dispose()
      return false
    })
  }

  activateHologramCatch(ball: RAPIER.RigidBody, targetPos: Vector3, duration: number): void {
    ball.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true)
    this.caughtBalls.push({ body: ball, targetPos: targetPos.clone(), timer: duration })
    
    const mesh = this.bindings.find(b => b.rigidBody === ball)?.mesh as Mesh
    if (mesh && mesh.material && mesh.material instanceof StandardMaterial) {
      (mesh.material as StandardMaterial).emissiveColor = new Color3(1, 0, 0)
    }
  }

  updateCaughtBalls(dt: number, onRelease: (ball: RAPIER.RigidBody) => void): void {
    for (let i = this.caughtBalls.length - 1; i >= 0; i--) {
      const catchData = this.caughtBalls[i]
      catchData.timer -= dt

      const current = catchData.body.translation()
      const target = catchData.targetPos
      const nextX = current.x + (target.x - current.x) * 5 * dt
      const nextY = current.y + (target.y - current.y) * 5 * dt
      const nextZ = current.z + (target.z - current.z) * 5 * dt
      catchData.body.setNextKinematicTranslation({ x: nextX, y: nextY, z: nextZ })

      if (catchData.timer <= 0) {
        catchData.body.setBodyType(this.rapier.RigidBodyType.Dynamic, true)
        
        const mesh = this.bindings.find(b => b.rigidBody === catchData.body)?.mesh as Mesh
        if (mesh && mesh.material && mesh.material instanceof StandardMaterial) {
          (mesh.material as StandardMaterial).emissiveColor = new Color3(0.2, 0.2, 0.2)
        }
        
        catchData.body.applyImpulse({ x: (Math.random() - 0.5) * 5, y: 5, z: 5 }, true)
        onRelease(catchData.body)
        this.caughtBalls.splice(i, 1)
      }
    }
  }

  getBallBody(): RAPIER.RigidBody | null {
    return this.ballBody
  }

  getBallBodies(): RAPIER.RigidBody[] {
    return this.ballBodies
  }

  setBallBody(body: RAPIER.RigidBody | null): void {
    this.ballBody = body
  }

  hasBalls(): boolean {
    return this.ballBodies.length > 0
  }
}
