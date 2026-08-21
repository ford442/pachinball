import type * as RAPIER from '@dimforge/rapier3d-compat'

import type { BumperVisual, PhysicsBinding, InputFrame } from '../../game-elements/types'
import { WASM_PHYSICS, PhysicsConfig, GameConfig } from '../../config'
import { WasmPhysicsEngine } from '../../wasm'
import { exportRapierBodyToWasm } from './wasm-static-export'
import { getPhysicsTuningValue } from '../../game-elements/physics-tuning'

/** Blade half-length / radius approximation matching object-flippers.ts's cuboid collider. */
const FLIPPER_PROXY_RADIUS = 0.3
const FLIPPER_PROXY_HALF_HEIGHT = 1.55
const FLIPPER_MASS = 2.0

interface PlainQuat { x: number; y: number; z: number; w: number }

/**
 * -90° rotation about Z: maps the native capsule's local +Y segment axis onto
 * the flipper blade's local +X (long) axis.
 */
const CAPSULE_AXIS_TO_BLADE_AXIS: PlainQuat = { x: 0, y: 0, z: -Math.SQRT1_2, w: Math.SQRT1_2 }
/** Inverse of CAPSULE_AXIS_TO_BLADE_AXIS (+90° about Z) for Rapier puppet sync. */
const BLADE_AXIS_TO_CAPSULE_AXIS: PlainQuat = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }

function quatMultiply(a: PlainQuat, b: PlainQuat): PlainQuat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

interface FlipperHinge {
  rapierBody: RAPIER.RigidBody
  wasmId: number
  hingeId: number
  isRight: boolean
  anchor: { x: number; y: number; z: number }
}

/**
 * WasmOwner — WASM owns ball simulation, static table geometry, and flipper hinges.
 *
 * Rapier rigid bodies remain as handle-space puppets for mesh interpolation and
 * scoring dispatch. Table statics, bumpers, balls, and flippers are disabled in
 * Rapier while WASM runs. Adventure-mode bodies stay on Rapier.
 */
export class WasmOwner {
  private engine: WasmPhysicsEngine
  private rapierToWasm = new Map<RAPIER.RigidBody, number>()
  private wasmToRapier = new Map<number, RAPIER.RigidBody>()
  private bumperWasmIds = new Set<number>()
  private ballBodies = new Set<RAPIER.RigidBody>()
  private flippers: FlipperHinge[] = []
  private disabledRapierBodies = new Set<RAPIER.RigidBody>()
  private groundAdded = false
  private leftPressed = false
  private rightPressed = false
  private leftHoldTime = 0
  private rightHoldTime = 0

  constructor(engine: WasmPhysicsEngine) {
    this.engine = engine
  }

  clear(): void {
    for (const id of this.rapierToWasm.values()) {
      this.engine.removeBody(id)
    }
    for (const f of this.flippers) {
      this.engine.removeHinge(f.hingeId)
      this.engine.removeBody(f.wasmId)
    }
    this.rapierToWasm.clear()
    this.wasmToRapier.clear()
    this.bumperWasmIds.clear()
    this.ballBodies.clear()
    this.flippers = []
    this.restoreRapierBodies()
    this.groundAdded = false
    this.leftPressed = false
    this.rightPressed = false
    this.leftHoldTime = 0
    this.rightHoldTime = 0
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

    for (const body of flipperBodies) {
      const collider = body.collider(0)
      const pivot = body.translation()
      const com = collider ? collider.translation() : pivot
      const isRight = pivot.x >= 0
      const limits = isRight ? PhysicsConfig.flipper.rightLimits : PhysicsConfig.flipper.leftLimits

      const id = this.engine.createBody({
        position: com,
        velocity: { x: 0, y: 0, z: 0 },
        mass: FLIPPER_MASS,
        radius: FLIPPER_PROXY_RADIUS,
        capsuleHalfHeight: FLIPPER_PROXY_HALF_HEIGHT,
        shape: 'capsule',
        restitution: PhysicsConfig.flipper.restitution,
        friction: PhysicsConfig.flipper.friction,
        linearDamping: 0.5,
        angularDamping: 2,
        bodyType: 0,
      })
      this.engine.setBodyRotation(
        id,
        CAPSULE_AXIS_TO_BLADE_AXIS.x,
        CAPSULE_AXIS_TO_BLADE_AXIS.y,
        CAPSULE_AXIS_TO_BLADE_AXIS.z,
        CAPSULE_AXIS_TO_BLADE_AXIS.w
      )

      const hingeId = this.engine.createHinge({
        bodyId: id,
        worldAnchor: { x: pivot.x, y: pivot.y, z: pivot.z },
        worldAxis: { x: 0, y: 1, z: 0 },
        minAngle: limits[0],
        maxAngle: limits[1],
      })

      this.wasmToRapier.set(id, body)
      this.flippers.push({
        rapierBody: body,
        wasmId: id,
        hingeId,
        isRight,
        anchor: { x: pivot.x, y: pivot.y, z: pivot.z },
      })
      this.disableRapierBody(body)
    }

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
   * Latch flipper input and drive native hinge motors from PhysicsConfig
   * rest/active angles + stiffness/damping (same numbers as Rapier position motors).
   */
  driveFlippers(frame: InputFrame | null, dt: number): void {
    if (frame) {
      if (frame.flipperLeft !== null) this.leftPressed = frame.flipperLeft
      if (frame.flipperRight !== null) this.rightPressed = frame.flipperRight
    }
    if (this.leftPressed) this.leftHoldTime += dt
    else this.leftHoldTime = 0
    if (this.rightPressed) this.rightHoldTime += dt
    else this.rightHoldTime = 0

    for (const f of this.flippers) {
      const pressed = f.isRight ? this.rightPressed : this.leftPressed
      const hold = f.isRight ? this.rightHoldTime : this.leftHoldTime
      const holdFactor = Math.min(hold / PhysicsConfig.flipper.holdTimeDivisor, 1)
      const stiffnessMultiplier = pressed ? (1.0 + holdFactor * 0.3) : 0.8
      const dampingMultiplier = pressed ? (0.9 + holdFactor * 0.1) : 1.1
      const stiffness = getPhysicsTuningValue('flipperStiffness') * stiffnessMultiplier
      const damping = getPhysicsTuningValue('flipperDamping') * dampingMultiplier

      const target = f.isRight
        ? (pressed ? PhysicsConfig.flipper.activeAngleRad : -PhysicsConfig.flipper.restAngleRad)
        : (pressed ? -PhysicsConfig.flipper.activeAngleRad : PhysicsConfig.flipper.restAngleRad)

      const angle = this.engine.getHingeAngle(f.hingeId)
      const omega = this.engine.getAngularVelocity(f.wasmId).y
      const err = target - angle
      const targetVel = err * Math.min(stiffness / 800, 40) - (damping / 850) * omega
      this.engine.setHingeMotor(f.hingeId, targetVel, stiffness)
    }
  }

  applyBallImpulse(rapierBody: RAPIER.RigidBody, ix: number, iy: number, iz: number): void {
    const id = this.rapierToWasm.get(rapierBody)
    if (id === undefined) return
    this.engine.applyImpulse(id, ix, iy, iz)
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

    for (const f of this.flippers) {
      const rot = this.engine.getRotation(f.wasmId)
      const rapierRot = quatMultiply(rot, BLADE_AXIS_TO_CAPSULE_AXIS)
      const ang = this.engine.getAngularVelocity(f.wasmId)
      f.rapierBody.setTranslation(new rapier.Vector3(f.anchor.x, f.anchor.y, f.anchor.z), true)
      f.rapierBody.setRotation(
        { x: rapierRot.x, y: rapierRot.y, z: rapierRot.z, w: rapierRot.w },
        true
      )
      f.rapierBody.setAngvel(new rapier.Vector3(ang.x, ang.y, ang.z), true)
      f.rapierBody.setLinvel(new rapier.Vector3(0, 0, 0), true)
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
