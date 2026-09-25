import type { PhysicsBody } from '../../core/physics-api'

import type { BumperVisual } from '../../game-elements/types'
import { WASM_PHYSICS, PhysicsConfig, GameConfig } from '../../config'
import type { WasmSimEngine } from '../../wasm/wasm-sim-engine'
import type { WasmContactBridge } from './collision-dispatch'

/**
 * WasmMirror — keeps a small WASM physics world in sync with the Rapier ball and
 * bumper bodies so the C++ engine can simulate the ball+bumper subset while the
 * rest of the game continues to use the original Rapier bodies/handles.
 */
export class WasmMirror implements WasmContactBridge {
  private engine: WasmSimEngine
  private rapierToWasm = new Map<PhysicsBody, number>()
  private wasmToRapier = new Map<number, PhysicsBody>()
  private bumperRadius = new Map<PhysicsBody, number>()
  private groundAdded = false

  constructor(engine: WasmSimEngine) {
    this.engine = engine
  }

  clear(): void {
    for (const id of this.rapierToWasm.values()) {
      this.engine.removeBody(id)
    }
    this.rapierToWasm.clear()
    this.wasmToRapier.clear()
    this.bumperRadius.clear()
    this.groundAdded = false
  }

  rebuild(
    ballBodies: PhysicsBody[],
    bumperBodies: PhysicsBody[],
    bumperVisuals: BumperVisual[]
  ): void {
    this.clear()

    const plane = WASM_PHYSICS.tunables.groundPlane
    if (!this.groundAdded) {
      this.engine.addStaticPlane(
        { x: plane.normal.x, y: plane.normal.y, z: plane.normal.z },
        plane.distance,
        plane.friction
      )
      this.groundAdded = true
    }

    // Map bumper visuals by body handle so we can recover the original scale/radius.
    const visualByBody = new Map<number, BumperVisual>()
    for (const vis of bumperVisuals) {
      visualByBody.set(vis.body.handle, vis)
    }

    for (const body of bumperBodies) {
      const vis = visualByBody.get(body.handle)
      const scale = vis ? vis.mesh.scaling.x : 1.0
      const radius = 0.4 * scale
      const id = this.engine.createBody({
        position: body.translation(),
        velocity: { x: 0, y: 0, z: 0 },
        mass: 0,
        radius,
        restitution: PhysicsConfig.surfaces.bumper.restitution,
        friction: PhysicsConfig.surfaces.bumper.friction,
        linearDamping: 0,
        bodyType: 1, // Static
      })
      this.track(body, id)
      this.bumperRadius.set(body, radius)
    }

    for (const body of ballBodies) {
      const id = this.engine.createBody({
        position: body.translation(),
        velocity: body.linvel(),
        mass: GameConfig.ball.mass,
        radius: GameConfig.ball.radius,
        restitution: PhysicsConfig.ball.restitution,
        friction: PhysicsConfig.ball.friction,
        linearDamping: PhysicsConfig.ball.linearDamping,
        angularDamping: PhysicsConfig.ball.angularDamping,
        bodyType: 0, // Dynamic
      })
      this.track(body, id)
    }
  }

  syncToWasm(): void {
    for (const [body, id] of this.rapierToWasm) {
      const pos = body.translation()
      this.engine.setBodyPosition(id, pos.x, pos.y, pos.z)
      // Only dynamic bodies get velocity synced; bumpers are static.
      if (!this.bumperRadius.has(body)) {
        const vel = body.linvel()
        this.engine.setVelocity(id, vel.x, vel.y, vel.z)
        const ang = body.angvel()
        this.engine.setAngularVelocity(id, ang.x, ang.y, ang.z)
      }
    }
  }

  syncFromWasm(): void {
    for (const [body, id] of this.rapierToWasm) {
      if (this.bumperRadius.has(body)) continue
      const pos = this.engine.getPosition(id)
      const vel = this.engine.getVelocity(id)
      const rot = this.engine.getRotation(id)
      const ang = this.engine.getAngularVelocity(id)
      body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true)
      body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true)
      body.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true)
      body.setAngvel({ x: ang.x, y: ang.y, z: ang.z }, true)
    }
  }

  /** Degrade-only: the mirrored Rapier body a WASM id stands for. */
  getRapierBody(wasmId: number): PhysicsBody | undefined {
    return this.wasmToRapier.get(wasmId)
  }

  /** Mirror contacts dispatch in Rapier's key space: the mirrored body's own handle. */
  resolveContactId(wasmId: number): { body: PhysicsBody; key: number } | null {
    const body = this.wasmToRapier.get(wasmId)
    return body ? { body, key: body.handle } : null
  }

  private track(body: PhysicsBody, id: number): void {
    this.rapierToWasm.set(body, id)
    this.wasmToRapier.set(id, body)
  }
}
