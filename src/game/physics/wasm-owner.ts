import type * as RAPIER from '@dimforge/rapier3d-compat'

import type { BumperVisual, PhysicsBinding } from '../../game-elements/types'
import { WASM_PHYSICS, PhysicsConfig, GameConfig } from '../../config'
import { WasmPhysicsEngine } from '../../wasm'
import { exportRapierBodyToWasm } from './wasm-static-export'

/**
 * WasmOwner — WASM owns ball simulation and static table geometry.
 *
 * Rapier rigid bodies remain as handle-space puppets for mesh interpolation and
 * scoring dispatch, but table static colliders are disabled while WASM runs.
 * Flipper joints continue to live in Rapier (Phase 2c will add motor parity).
 */
export class WasmOwner {
  private engine: WasmPhysicsEngine
  private rapierToWasm = new Map<RAPIER.RigidBody, number>()
  private wasmToRapier = new Map<number, RAPIER.RigidBody>()
  private bumperWasmIds = new Set<number>()
  private ballBodies = new Set<RAPIER.RigidBody>()
  private disabledRapierBodies = new Set<RAPIER.RigidBody>()
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
    this.bumperWasmIds.clear()
    this.ballBodies.clear()
    this.restoreRapierBodies()
    this.groundAdded = false
  }

  rebuild(
    ballBodies: RAPIER.RigidBody[],
    bumperBodies: RAPIER.RigidBody[],
    bumperVisuals: BumperVisual[],
    staticBindings: PhysicsBinding[],
    flipperBodies: RAPIER.RigidBody[]
  ): void {
    this.clear()

    const plane = WASM_PHYSICS.tunables.groundPlane
    if (!this.groundAdded) {
      this.engine.addStaticPlane({ x: plane.normal.x, y: plane.normal.y, z: plane.normal.z }, plane.distance)
      this.groundAdded = true
    }

    const flipperSet = new Set(flipperBodies)
    const bumperSet = new Set(bumperBodies)
    const ballSet = new Set(ballBodies)

    // Static table geometry: walls, rails, ground, decoration — skip flippers/bumpers/balls.
    for (const binding of staticBindings) {
      const body = binding.rigidBody
      if (flipperSet.has(body) || bumperSet.has(body) || ballSet.has(body)) continue
      exportRapierBodyToWasm(body, this.engine)
    }

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
        bodyType: 1,
      })
      this.track(body, id)
      this.bumperWasmIds.add(id)
    }

    for (const body of ballBodies) {
      const id = this.engine.createBody({
        position: body.translation(),
        velocity: body.linvel(),
        mass: GameConfig.ball.mass,
        radius: GameConfig.ball.radius,
        restitution: PhysicsConfig.ball.restitution,
        linearDamping: PhysicsConfig.ball.linearDamping,
        bodyType: 0,
      })
      this.track(body, id)
      this.ballBodies.add(body)
      this.disableRapierBody(body)
    }

    // Disable static Rapier bodies that WASM now owns (walls/rails).
    for (const binding of staticBindings) {
      const body = binding.rigidBody
      if (flipperSet.has(body) || bumperSet.has(body) || ballSet.has(body)) continue
      this.disableRapierBody(body)
    }
    for (const body of bumperBodies) {
      this.disableRapierBody(body)
    }
  }

  /** Sync kinematic flipper proxies from Rapier before WASM step (Phase 2c hook). */
  syncFlipperProxies(_flipperBodies: RAPIER.RigidBody[]): void {
    // Flipper motor parity lands in Phase 2c — Rapier still drives flipper visuals.
  }

  syncFromWasm(rapier: typeof RAPIER | null): void {
    if (!rapier) return
    for (const body of this.ballBodies) {
      const id = this.rapierToWasm.get(body)
      if (id === undefined) continue
      const pos = this.engine.getPosition(id)
      const vel = this.engine.getVelocity(id)
      body.setTranslation(new rapier.Vector3(pos.x, pos.y, pos.z), true)
      body.setLinvel(new rapier.Vector3(vel.x, vel.y, vel.z), true)
    }
  }

  getRapierBody(wasmId: number): RAPIER.RigidBody | undefined {
    return this.wasmToRapier.get(wasmId)
  }

  isBumperWasmId(wasmId: number): boolean {
    return this.bumperWasmIds.has(wasmId)
  }

  dispose(): void {
    this.clear()
  }

  private track(body: RAPIER.RigidBody, id: number): void {
    this.rapierToWasm.set(body, id)
    this.wasmToRapier.set(id, body)
  }

  private disableRapierBody(body: RAPIER.RigidBody): void {
    if (this.disabledRapierBodies.has(body)) return
    body.setEnabled(false)
    this.disabledRapierBodies.add(body)
  }

  private restoreRapierBodies(): void {
    for (const body of this.disabledRapierBodies) {
      body.setEnabled(true)
    }
    this.disabledRapierBodies.clear()
  }
}
