import type * as RAPIER from '@dimforge/rapier3d-compat'

import type { BumperVisual } from '../../game-elements/types'
import { WASM_PHYSICS, PhysicsConfig, GameConfig } from '../../config'
import { WasmPhysicsEngine } from '../../wasm'

/**
 * WasmMirror — keeps a small WASM physics world in sync with the Rapier ball and
 * bumper bodies so the C++ engine can simulate the ball+bumper subset while the
 * rest of the game continues to use the original Rapier bodies/handles.
 */
export class WasmMirror {
  private engine: WasmPhysicsEngine
  private rapierToWasm = new Map<RAPIER.RigidBody, number>()
  private wasmToRapier = new Map<number, RAPIER.RigidBody>()
  private bumperRadius = new Map<RAPIER.RigidBody, number>()
  private groundAdded = false

  constructor(engine: WasmPhysicsEngine) {
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
    ballBodies: RAPIER.RigidBody[],
    bumperBodies: RAPIER.RigidBody[],
    bumperVisuals: BumperVisual[]
  ): void {
    this.clear()

    const plane = WASM_PHYSICS.tunables.groundPlane
    if (!this.groundAdded) {
      this.engine.addStaticPlane({ x: plane.normal.x, y: plane.normal.y, z: plane.normal.z }, plane.distance)
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
        restitution: PhysicsConfig.bumper.restitution,
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
        linearDamping: PhysicsConfig.ball.linearDamping,
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
      }
    }
  }

  syncFromWasm(rapier: typeof RAPIER | null): void {
    if (!rapier) return
    for (const [body, id] of this.rapierToWasm) {
      if (this.bumperRadius.has(body)) continue
      const pos = this.engine.getPosition(id)
      const vel = this.engine.getVelocity(id)
      body.setTranslation(new rapier.Vector3(pos.x, pos.y, pos.z), true)
      body.setLinvel(new rapier.Vector3(vel.x, vel.y, vel.z), true)
    }
  }

  getRapierBody(wasmId: number): RAPIER.RigidBody | undefined {
    return this.wasmToRapier.get(wasmId)
  }

  private track(body: RAPIER.RigidBody, id: number): void {
    this.rapierToWasm.set(body, id)
    this.wasmToRapier.set(id, body)
  }
}
