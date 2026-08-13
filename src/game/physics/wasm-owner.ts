import type * as RAPIER from '@dimforge/rapier3d-compat'

import type { BumperVisual, PhysicsBinding } from '../../game-elements/types'
import { WASM_PHYSICS, PhysicsConfig, GameConfig } from '../../config'
import { WasmPhysicsEngine } from '../../wasm'
import { exportRapierBodyToWasm } from './wasm-static-export'

/** Blade half-length / radius approximation matching object-flippers.ts's cuboid collider. */
const FLIPPER_PROXY_RADIUS = 0.3
const FLIPPER_PROXY_HALF_HEIGHT = 1.55

interface PlainQuat { x: number; y: number; z: number; w: number }
interface PlainVec3 { x: number; y: number; z: number }

/**
 * -90° rotation about Z: maps the native capsule's local +Y segment axis onto
 * the flipper blade's local +X (long) axis. Same fixed remap for both flippers —
 * the left/right asymmetry already lives in the blade collider's own world
 * translation/rotation, not in this constant.
 */
const CAPSULE_AXIS_TO_BLADE_AXIS: PlainQuat = { x: 0, y: 0, z: -Math.SQRT1_2, w: Math.SQRT1_2 }

/** Hamilton product a*b — applies b first, then a. Mirrors native/src/MathTypes.h Quat::operator*. */
function quatMultiply(a: PlainQuat, b: PlainQuat): PlainQuat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

function cross(a: PlainVec3, b: PlainVec3): PlainVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

/**
 * WasmOwner — WASM owns ball simulation and static table geometry.
 *
 * Rapier rigid bodies remain as handle-space puppets for mesh interpolation and
 * scoring dispatch, but table static colliders are disabled while WASM runs.
 * Flipper joints/motors continue to run entirely in Rapier — each tick their
 * live blade pose and point-velocity are mirrored into a kinematic capsule
 * proxy body in WASM (see syncFlipperProxies) so the WASM-owned ball collides
 * with flippers correctly, with momentum transfer on a flick (Phase 2c-A).
 */
export class WasmOwner {
  private engine: WasmPhysicsEngine
  private rapierToWasm = new Map<RAPIER.RigidBody, number>()
  private wasmToRapier = new Map<number, RAPIER.RigidBody>()
  private bumperWasmIds = new Set<number>()
  private ballBodies = new Set<RAPIER.RigidBody>()
  private flipperProxyIds = new Map<RAPIER.RigidBody, number>()
  private disabledRapierBodies = new Set<RAPIER.RigidBody>()
  private groundAdded = false

  constructor(engine: WasmPhysicsEngine) {
    this.engine = engine
  }

  clear(): void {
    for (const id of this.rapierToWasm.values()) {
      this.engine.removeBody(id)
    }
    for (const id of this.flipperProxyIds.values()) {
      this.engine.removeBody(id)
    }
    this.rapierToWasm.clear()
    this.wasmToRapier.clear()
    this.bumperWasmIds.clear()
    this.ballBodies.clear()
    this.flipperProxyIds.clear()
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
      this.engine.addStaticPlane(
        { x: plane.normal.x, y: plane.normal.y, z: plane.normal.z },
        plane.distance,
        plane.friction
      )
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
        friction: GameConfig.physics.surfaces.bumper.friction,
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
        friction: PhysicsConfig.ball.friction,
        linearDamping: PhysicsConfig.ball.linearDamping,
        angularDamping: PhysicsConfig.ball.angularDamping,
        bodyType: 0,
      })
      this.track(body, id)
      this.ballBodies.add(body)
      this.disableRapierBody(body)
    }

    // Kinematic capsule proxies mirroring each flipper's live blade pose (Phase 2c-A).
    // The Rapier flipper body/joint/motor is left fully enabled and keeps driving the
    // visual mesh — only the ball is WASM-owned, so we mirror the flipper's resulting
    // pose into WASM each tick (syncFlipperProxies) rather than disabling it here.
    for (const body of flipperBodies) {
      const collider = body.collider(0)
      const position = collider ? collider.translation() : body.translation()
      const id = this.engine.createBody({
        position,
        velocity: { x: 0, y: 0, z: 0 },
        mass: 0,
        radius: FLIPPER_PROXY_RADIUS,
        capsuleHalfHeight: FLIPPER_PROXY_HALF_HEIGHT,
        shape: 'capsule',
        restitution: PhysicsConfig.flipper.restitution,
        friction: PhysicsConfig.flipper.friction,
        linearDamping: 0,
        bodyType: 2,
      })
      this.wasmToRapier.set(id, body)
      this.flipperProxyIds.set(body, id)
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

  /**
   * Mirror each flipper's live Rapier blade pose + point-velocity into its
   * WASM kinematic capsule proxy. Called once per physics tick, immediately
   * before the WASM step, so the proxy tracks the joint/motor-driven blade
   * exactly as Rapier resolved it this frame.
   */
  syncFlipperProxies(flipperBodies: RAPIER.RigidBody[]): void {
    for (const body of flipperBodies) {
      const id = this.flipperProxyIds.get(body)
      if (id === undefined) continue

      const collider = body.collider(0)
      if (!collider) continue

      const pos = collider.translation()
      const rot = collider.rotation()
      const worldRot = quatMultiply(rot, CAPSULE_AXIS_TO_BLADE_AXIS)

      const origin = body.translation()
      const r = { x: pos.x - origin.x, y: pos.y - origin.y, z: pos.z - origin.z }
      const pointVel = cross(body.angvel(), r)
      const linvel = body.linvel()

      this.engine.setBodyPosition(id, pos.x, pos.y, pos.z)
      this.engine.setBodyRotation(id, worldRot.x, worldRot.y, worldRot.z, worldRot.w)
      this.engine.setVelocity(
        id,
        linvel.x + pointVel.x,
        linvel.y + pointVel.y,
        linvel.z + pointVel.z
      )
      const omega = body.angvel()
      this.engine.setAngularVelocity(id, omega.x, omega.y, omega.z)
    }
  }

  syncFromWasm(rapier: typeof RAPIER | null): void {
    if (!rapier) return
    for (const body of this.ballBodies) {
      const id = this.rapierToWasm.get(body)
      if (id === undefined) continue
      const pos = this.engine.getPosition(id)
      const vel = this.engine.getVelocity(id)
      const rot = this.engine.getRotation(id)
      const ang = this.engine.getAngularVelocity(id)
      body.setTranslation(new rapier.Vector3(pos.x, pos.y, pos.z), true)
      body.setLinvel(new rapier.Vector3(vel.x, vel.y, vel.z), true)
      body.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true)
      body.setAngvel(new rapier.Vector3(ang.x, ang.y, ang.z), true)
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
